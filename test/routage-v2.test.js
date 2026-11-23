'use strict';
/**
 * ROUTAGE V2 (refonte #26, C26-06) — cœur PUR `planRoutageV2_` : décide TYPE de placement (non-document
 * vs classé), domaine, sous-dossier et nom, à partir du schéma étendu de l'analyse 2 passes. Aucune I/O
 * Drive (l'enveloppe `deciderRoutageV2_` fait le find-or-create). Vérifie les exigences de Marc :
 * non-document écarté (jamais un domaine, jamais 04), identité PAR TYPE, tout en sous-dossier, jamais
 * « Inconnu ». Fonctions PURES.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs', 'Router.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

// meta minimale attendue par decisionNonDocument_ (nom, taille, extrait OCR, émetteur).
const meta = (nom, opts) => Object.assign({ nomFichier: nom, taille: 100000, extraitOcr: 'texte lisible du document '.repeat(4), emetteur: '' }, opts || {});

/* ---------- Non-documents : écartés hors domaines, JAMAIS un domaine ---------- */

test('planRoutageV2_ : export de données HTML → _Technique (jamais un domaine)', () => {
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, routageHorsDomaine: '_Technique', domaine: '08 · Perso & projets' },
    meta('votre information facebook.html', { taille: 500000, emetteur: '' }), '2026-07-01', '.html');
  assert.strictEqual(p.type, 'non-doc');
  assert.strictEqual(p.routage, '_Technique');
  assert.strictEqual(p.domaine, undefined); // aucun domaine pour un non-document
});

test('planRoutageV2_ : capture sans texte → _Médias', () => {
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, domaine: '08 · Perso & projets' },
    meta('Screenshot_20260701.png', { extraitOcr: '' }), '2026-07-01', '.png');
  assert.strictEqual(p.type, 'non-doc');
  assert.strictEqual(p.routage, '_Médias');
});

test('planRoutageV2_ : GARDE dominante — une pièce d\'identité en image n\'est JAMAIS écartée', () => {
  // Le LLM se trompe (estNonDocument=true) mais c'est une identité → distinguerVraiScan_ prime → classé.
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, estDocumentIdentite: true, sousDossierType: 'Passeport',
      titulaire: 'Marc Exemple', domaine: '01 · Administratif & identité' },
    meta('IMG_2734.jpg', { extraitOcr: '' }), '2019-09-17', '.jpg');
  assert.strictEqual(p.type, 'classé');
});

test('planRoutageV2_ : un vrai scan (facture + émetteur), même OCR pauvre, reste CLASSÉ', () => {
  const p = ctx.planRoutageV2_(
    { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Hydro-Québec' },
    meta('recu.jpg', { extraitOcr: '' }), '2026-03-01', '.jpg');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.domaine, '02 · Finances');
});

/* ---------- Pièces d'identité : par TYPE, titulaire dans le nom, domaine dérivé du type ---------- */

test('planRoutageV2_ : passeport d\'un TIERS non déclaré → `Pièces d\'identité` (repli), titulaire dans le nom', () => {
  // Même si le LLM propose 04, le passeport se range en 01 (conteneur partagé Marc + proches).
  // « Sophie Tremblay » n'est pas dans `RESET_PERSONNES_AUTRES` : `cheminCibleReset_` rend `null`
  // — refus VOULU (« jamais deviné » : le passeport d'un proche non listé ne finit pas chez Marc).
  // Le flux retombe donc sur son repli. Cette assertion attendait `'Passeport'`, c'est-à-dire un
  // dossier de TYPE au niveau 1 du domaine : elle ENCODAIT le défaut C28-72, celui qui a fabriqué
  // `01 · Administratif/Permis de conduire` le 2026-08-12 pour un permis de tiers. Le repli dégrade
  // désormais DANS le conteneur canonique — le nom du fichier porte déjà le type et le titulaire.
  const p = ctx.planRoutageV2_(
    { estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Sophie Tremblay',
      domaine: '04 · Immigration', date_doc: '2020-01-01' },
    meta('passeport.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.domaine, '01 · Administratif & identité');
  assert.strictEqual(p.sousDossier, 'Pièces d\'identité & permis');
  assert.strictEqual(p.nom, '2020-01-01_Passeport_Sophie Tremblay.pdf');
  // PRÉMISSE asservie (revue code F3) : le commentaire ci-dessus AFFIRME que la table refuse ce nom,
  // rien ne le vérifiait. Si elle se mettait à l'attribuer, ce test passerait par la DÉLÉGATION et
  // cesserait de verrouiller le repli — vert, et vide (patron §9 : la même ligne est un verrou ou
  // une tautologie selon le code qu'elle observe).
  assert.strictEqual(ctx.cheminCibleReset_('01 · Administratif & identité', p.nom), null,
    'la table doit REFUSER ce nom, sinon ce test n\'exerce plus le repli');
  // Et on observe le CHEMIN, pas seulement la valeur : la branche table pose `segments`, le repli non.
  assert.ok(!p.segments, 'chemin REPLI — la branche déléguée aurait posé `segments`');
});

test('planRoutageV2_ : passeport de MARC → la TABLE attribue, le repli ne sert même pas', () => {
  // Contre-épreuve du test précédent : quand la table SAIT attribuer, c'est elle qui décide (étape 4,
  // délégation sous tripwire), et la cible est le dossier de la personne — pas le conteneur nu.
  // Sans ce test, on ne saurait pas si `Pièces d'identité` ci-dessus vient du repli ou de la table.
  const p = ctx.planRoutageV2_(
    { estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Marc Exemple',
      emetteur: 'Marc Exemple', date_doc: '2020-01-01' },
    meta('passeport.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.domaine, '01 · Administratif & identité');
  assert.strictEqual(p.sousDossier, 'Pièces d\'identité & permis');
  assert.deepStrictEqual(plat(p.segments), ['Pièces d\'identité & permis'],
    'chemin TABLE — c\'est `segments` qui distingue les deux chemins d\'exécution, pas la valeur');
});

test('planRoutageV2_ : carte de résident permanent → domaine 04, arbre Reset (reste dans la zone protégée)', () => {
  const p = ctx.planRoutageV2_(
    { estDocumentIdentite: true, sousDossierType: 'Carte de résident permanent', titulaire: 'Marc Exemple', date_doc: '2024-05-02' },
    meta('carte.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.domaine, '04 · Immigration');
  // ADR-0033 : le flux délègue au Reset, DANS le domaine 04 (jamais une sortie de 04 — garde-fou §2).
  assert.strictEqual(p.sousDossier, 'Résidence permanente');
});

/* ---------- Documents normaux (ADR-0023, arbitrage « entité OU année ») : à PLAT par défaut ;
 * sous-dossier = entité VALIDÉE au référentiel (sans année), sinon AAAA pour les domaines par
 * année, sinon racine. Le verrou : SANS carte de validées, JAMAIS de dossier d'entité. ---------- */

// Carte des entités VALIDÉES de test (comme entitesValideesParCle_ : {nom, dossierId}, ADR-0028).
const validees = {};
validees[ctx.cleCanoniqueEntite_('02 · Finances', 'Bellerives')] = { nom: 'Bellerives', dossierId: 'ID_DESJ' };

test('planRoutageV2_ : ADR-0033 — un relevé va dans l\'arbre Reset (Relevés/AAAA), plus dans un dossier d\'entité', () => {
  const classif = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Bellerives', sousDossier: 'Bellerives Inc.', date_doc: '2026-03-15' };
  const avecCarte = ctx.planRoutageV2_(classif, meta('releve.pdf', { emetteur: 'Bellerives' }), '2026-03-15', '.pdf', validees);
  assert.strictEqual(avecCarte.sousDossier, 'Relevés/2026',      // délègue au Reset : banque regroupe par TYPE (décision Marc)
    'une banque validée regroupe désormais par TYPE (Relevés/AAAA), plus par entité');
  assert.strictEqual(avecCarte.nom, '2026-03_Relevé_Bellerives.pdf'); // relevé = granularité mois
  assert.strictEqual(avecCarte.dossierIdCible, '',
    'chemin thématique multi-niveaux → PAS d\'ID d\'entité (le chemin EST la structure, résolu segment par segment)');

  // La validation de l'entité ne change plus le chemin d'un doc que le Reset sait router (convergence).
  const sansCarte = ctx.planRoutageV2_(classif, meta('releve.pdf', { emetteur: 'Bellerives' }), '2026-03-15', '.pdf');
  assert.strictEqual(sansCarte.sousDossier, 'Relevés/2026', 'validé ou non, le relevé va au MÊME endroit (Reset)');
});

test('planRoutageV2_ : émetteur ponctuel → jamais un dossier par marchand (année en 02, racine ailleurs)', () => {
  // ADR-0023 : l'ancien repli `emetteur` créait un dossier par émetteur au 1er fichier
  // (Zephyr, Fournisseury, Mobile Boreale… — recensement 2026-07-16).
  const en02 = ctx.planRoutageV2_(
    { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Fournisseury', date_doc: '2026-01-10' },
    meta('facture.pdf', { emetteur: 'Fournisseury' }), '2026-01-10', '.pdf', validees);
  assert.strictEqual(en02.sousDossier, 'Reçus & factures/2026', 'facture → arbre Reçus & factures/AAAA (Reset), jamais un dossier Fournisseury');
  assert.ok(/Fournisseury/.test(en02.nom), 'l\'émetteur reste dans le NOM : ' + en02.nom);

  const en05 = ctx.planRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'Lettre', emetteur: 'Schneider Electric', date_doc: '2026-01-05' },
    meta('lettre.pdf', { emetteur: 'Schneider Electric' }), '2026-01-05', '.pdf', validees);
  assert.strictEqual(en05.sousDossier, 'CV & lettres/Lettres de motivation (Archives)', 'une lettre de démarche → CV & lettres/Lettres de motivation (Archives), jamais un dossier d\'entreprise');
});

test('planRoutageV2_ : ni émetteur ni titulaire → descripteur dans le nom (JAMAIS « Inconnu »), classé À PLAT (la catégorie LLM ne fait plus de dossier)', () => {
  const p = ctx.planRoutageV2_(
    { domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'Devoir algorithmique Python', sousDossier: 'Devoirs', date_doc: '2026-06-30' },
    meta('TP4.docx'), '2026-06-30', '.docx', validees);
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.sousDossier, '', 'une catégorie (« Devoirs ») ne crée plus de dossier — à plat (ADR-0023)');
  assert.ok(!/inconnu/i.test(p.nom), 'le nom ne doit jamais contenir « Inconnu » : ' + p.nom);
  assert.ok(/Devoir algorithmique Python/.test(p.nom), 'le descripteur doit être dans le nom : ' + p.nom);
});

test('planRoutageV2_ : ADR-0033 — un type reconnu par le Reset crée son dossier thématique (Schéma → Schémas & technique)', () => {
  const p = ctx.planRoutageV2_(
    { domaine: '08 · Perso & projets', type_doc: 'Schéma' },
    meta('schema.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.sousDossier, 'Schémas & technique', 'le Reset route « Schéma » → 08/Schémas & technique : ' + JSON.stringify(p));
});

test('planRoutageV2_ : une pièce d\'identité (personne reconnue) → arbre Reset Pièces d\'identité & permis…', () => {
  const p = ctx.planRoutageV2_(
    { estDocumentIdentite: true, sousDossierType: 'Permis de conduire', titulaire: 'Marc Exemple', date_doc: '2023-02-01' },
    meta('permis.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.sousDossier, 'Pièces d\'identité & permis'); // ADR-0033 / ADR-0080
});

/* ---------- Domaine hors-liste → domaine par défaut (jamais de limbo) ---------- */

test('planRoutageV2_ : domaine LLM hors-liste → domaine par défaut (hors facture/paie/identité)', () => {
  const p = ctx.planRoutageV2_(
    { domaine: 'Bidon inexistant', type_doc: 'Attestation', emetteur: 'Zephyr', date_doc: '2026-01-10' },
    meta('attestation.pdf', { emetteur: 'Zephyr' }), '2026-07-07', '.pdf');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.domaine, ctx.CONFIG.DOMAINE_DEFAUT);
});

test('planRoutageV2_ (ADR-0080) : règle stricte des factures → 02 · Finances, 04 · Immigration intouchée, non-factures préservées', () => {
  // Énergie / télécom / santé en facture ou reçu → 02 · Finances / Reçus & factures/AAAA
  for (const cas of [
    { domaine: '03 · Logement & véhicule', type_doc: 'Facture', emetteur: 'Hydro-Québec', date: '2026-01-18' },
    { domaine: '07 · Santé', type_doc: 'Facture optométrie', emetteur: 'Clinique Exemple', date: '2026-04-02' },
    { domaine: '01 · Administratif & identité', type_doc: 'Reçu de paiement', emetteur: 'Mobile Boreale', date: '2026-05-10' },
  ]) {
    const p = ctx.planRoutageV2_(cas, meta('doc.pdf', { emetteur: cas.emetteur }), cas.date, '.pdf', {});
    assert.strictEqual(p.domaine, '02 · Finances', cas.type_doc + ' doit converger en 02');
    assert.strictEqual(p.sousDossier, 'Reçus & factures/2026', cas.type_doc);
  }
  // 04 · Immigration sanctuarisée : même une facture reste en 04
  const imm = ctx.planRoutageV2_(
    { domaine: '04 · Immigration', type_doc: 'Facture', emetteur: 'IRCC', date_doc: '2026-02-15' },
    meta('frais_ircc.pdf'), '2026-02-15', '.pdf', {});
  assert.strictEqual(imm.domaine, '04 · Immigration');
  // Non-factures et participe passé « Courriel reçu » préservés dans leur domaine
  const ord = ctx.planRoutageV2_(
    { domaine: '07 · Santé', type_doc: 'Ordonnance', emetteur: 'Clinique Exemple', date_doc: '2026-03-01' },
    meta('ord.pdf'), '2026-03-01', '.pdf', {});
  assert.strictEqual(ord.domaine, '07 · Santé');
  const bail = ctx.planRoutageV2_(
    { domaine: '03 · Logement & véhicule', type_doc: 'Bail', emetteur: '1204 avenue Fictive Prairie', date_doc: '2026-07-01' },
    meta('bail.pdf'), '2026-07-01', '.pdf', {});
  assert.strictEqual(bail.domaine, '03 · Logement & véhicule');
  const courrielRecu = ctx.planRoutageV2_(
    { domaine: '01 · Administratif & identité', type_doc: 'Courriel reçu', emetteur: 'Administration Exemple', date_doc: '2026-03-01' },
    meta('mail.pdf'), '2026-03-01', '.pdf', {});
  assert.strictEqual(courrielRecu.domaine, '01 · Administratif & identité');
});

test('planRoutageV2_ : un non-document est écarté hors domaines (aucun domaine porté)', () => {
  // Domaine NON protégé + média sans texte → la garde dominante ne s'applique pas → écarté en _Médias.
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, routageHorsDomaine: '_Médias', domaine: '08 · Perso & projets' },
    meta('WhatsApp Image 2026.jpeg', { extraitOcr: '' }), '2026-07-01', '.jpeg');
  assert.strictEqual(p.type, 'non-doc');
  assert.strictEqual(p.routage, '_Médias');
  assert.strictEqual(plat(p).domaine, undefined); // un non-document ne porte jamais de domaine
});

/* ---------- ADR-0028 : résolution TOPOLOGIQUE du dossier d'entité (par ID) ---------- */

// Faux dossier Drive minimal : id, nom, parent, état corbeille.
const dossierF = (id, nom, parent, corbeille) => ({
  getId: () => id,
  getName: () => nom,
  isTrashed: () => !!corbeille,
  getParents: () => { let i = 0; const p = parent ? [parent] : []; return { hasNext: () => i < p.length, next: () => p[i++] }; },
});

test('segmentsSousDomaine_ : chemin RÉEL sous le domaine, null si le domaine n\'est pas un ancêtre', () => {
  const dom = dossierF('DOM', '05 · Carrière', null);
  const groupe = dossierF('G', 'Anciens employeurs', dom);
  const entite = dossierF('E', 'Alphatek', groupe);

  assert.deepStrictEqual(plat(ctx.segmentsSousDomaine_(dom, 'DOM')), [], 'le domaine lui-même : aucun segment');
  assert.deepStrictEqual(plat(ctx.segmentsSousDomaine_(groupe, 'DOM')), ['Anciens employeurs']);
  assert.deepStrictEqual(plat(ctx.segmentsSousDomaine_(entite, 'DOM')), ['Anciens employeurs', 'Alphatek'],
    'chemin réel — c\'est lui qui part dans l\'Index (sinon la sync le juge « déplacé »)');

  // Hors domaine → null (= repli par nom) : jamais classer un document hors de son domaine.
  const autre = dossierF('X', 'Ailleurs', dossierF('DOM2', '08 · Perso', null));
  assert.strictEqual(ctx.segmentsSousDomaine_(autre, 'DOM'), null);
  // Chaîne illisible → null (échec fermé côté décision, repli côté classement).
  const casse = dossierF('K', 'Cassé', null);
  casse.getParents = () => { throw new Error('parents illisibles'); };
  assert.strictEqual(ctx.segmentsSousDomaine_(casse, 'DOM'), null);
});

test('dossierEntiteParId_ : refuse un dossier CORBEILLÉ, hors domaine, ou un ID mort (repli par nom)', () => {
  const dom = dossierF('DOM', '05 · Carrière', null);
  const vivant = dossierF('E', 'Alphatek', dom);
  const corbeille = dossierF('T', 'Alphatek', dom, true);
  const par = { E: vivant, T: corbeille };
  ctx.DriveApp = { getFolderById: (id) => { if (!par[id]) throw new Error('introuvable'); return par[id]; } };

  assert.deepStrictEqual(plat(ctx.dossierEntiteParId_('E', dom).segments), ['Alphatek']);
  assert.strictEqual(ctx.dossierEntiteParId_('T', dom), null,
    'corbeillé (ADR-0014) : y ranger un document le ferait purger à 30 j — perte silencieuse');
  assert.strictEqual(ctx.dossierEntiteParId_('MORT', dom), null, 'ID mort → repli, jamais une exception');
  assert.strictEqual(ctx.dossierEntiteParId_('', dom), null, 'pas d\'ID au référentiel → repli par nom');
  assert.strictEqual(ctx.dossierEntiteParId_(null, dom), null);
});

test('sousCheminDomaine_ : la RÈGLE UNIQUE rend {nom, id} — id SEULEMENT pour une entité validée', () => {
  const dom = ctx.CONFIG.DOMAINES_PAR_ANNEE[0];
  // C28-72 : le cas « type d'identité → dossier de TYPE » a été RETIRÉ de cette règle. Il rendait un
  // nœud de niveau 1 HORS `STRUCTURE_CIBLE_RESET`, invisible du validateur ≤ 7 — c'est lui qui a
  // fabriqué `01 · Administratif/Permis de conduire` en prod. Le paramètre est supprimé, pas
  // neutralisé : on vérifie ici qu'il est bel et bien IGNORÉ, pour qu'un appelant distrait qui le
  // passerait encore ne ressuscite pas le dossier de type.
  assert.deepStrictEqual(plat(ctx.sousCheminDomaine_({ domaine: dom, typeIdentite: 'Passeport' })),
    { nom: '', id: '' }, 'paramètre retiré : un `typeIdentite` résiduel ne route plus rien');
  assert.deepStrictEqual(plat(ctx.sousCheminDomaine_({ domaine: dom, entite: { nom: 'Bellerives', dossierId: 'ID_D' } })),
    { nom: 'Bellerives', id: 'ID_D' });
  assert.deepStrictEqual(plat(ctx.sousCheminDomaine_({ domaine: dom, annee: '2026' })), { nom: '2026', id: '' });
  assert.deepStrictEqual(plat(ctx.sousCheminDomaine_({ domaine: dom })), { nom: '', id: '' }, 'à plat');
  // Branche de tolérance : une entité passée en CHAÎNE vaut un id vide (repli par nom, jamais un id inventé).
  assert.deepStrictEqual(plat(ctx.sousCheminDomaine_({ domaine: dom, entite: 'Bellerives' })),
    { nom: 'Bellerives', id: '' });
});
