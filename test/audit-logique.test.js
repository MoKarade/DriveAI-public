'use strict';
/**
 * PHASE AUDIT (PoC) — protocole de précision de Marc, phase 1 : exécuter la logique de décision sur
 * un échantillon de ~20 DOCUMENTS RÉELS (dérivés des 38 docs de la preuve #26, vrais noms + domaines
 * lus dans le Drive de Marc) AVANT de valider un changement de tri. Rend le tableau
 * [nom | domaine | émetteur | type | verdict fail-safe] et PROUVE que le fail-safe (ADR-0016) ne se
 * déclenche QUE sur du tout-NULL — jamais sur un document réel normal (anti-saturation §2.1).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs', 'Router.gs']);

// 20 documents RÉELS (noms tels que lus dans le Drive lors de la preuve #26) + leur domaine classé.
// L'émetteur/type sont dérivés du nom (« Inconnu » ⇒ champ absent, comme le produirait l'analyse).
const REELS = [
  ["2026-06-29_Photo d'identité_Inconnu.jpeg", '01 · Administratif & identité'],
  ['2017-12-19_Attestation_Inconnu.pdf', '01 · Administratif & identité'],
  ['2022-03-04_Attestation_CNAM.pdf', '01 · Administratif & identité'],
  ['2026-06-16_Relevé_Inconnu.pdf', '02 · Finances'],
  ['2026-06-09_Attestation_Banque Marnex (CMF).pdf', '02 · Finances'],
  ['2016-03-03_Reçu_TPE.jpg', '02 · Finances'],
  ['2026-06-23_Réclamation_Bellerives Assurances Générales.pdf', '03 · Logement & véhicule'],
  ['2026-01-22_Attestation_CCI Paris Ile-de-France.pdf', '04 · Immigration'],
  ['2025-05-27_Attestation_Alphatek.pdf', '04 · Immigration'],
  ['2019-09-17_Passeport_Préfecture du Nord.pdf', '04 · Immigration'],
  ['2026-06-30_Lettre de motivation_Inconnu.docx', '05 · Carrière'],
  ['2026-06-01_CV_Marc Exemple.pdf', '05 · Carrière'],
  ['2018-06-01_CV_Marc Exemple.pdf', '05 · Carrière'],
  ['2026-06-30_Devoir_Inconnu.docx', '06 · Études & diplômes'],
  ['2026-06-16_Certification professionnelle_CORVIA.pdf', '06 · Études & diplômes'],
  ["2020-07-09_Attestation_Université du Plateau - Côte d'Opale.pdf", '06 · Études & diplômes'],
  ['2018-10-03_Revue de presse_Europresse.pdf', '07 · Perso & projets'],
  ['2026-06-30_Questionnaire_TM MECA.png', '07 · Perso & projets'],
  ['2026-07-01_Itinéraire de voyage_SNCF.jpg', '08 · Perso & projets'],
  ['2026-07-01_Note manuscrite_Inconnu.jpg', '08 · Perso & projets'],
];

// Dérive une classification plausible d'un nom « AAAA-MM-JJ_Type_Émetteur.ext » (comme la sortie LLM).
function classifDepuisNom(nom, domaine) {
  const base = nom.replace(/\.[^.]+$/, '');
  const seg = base.split('_');
  const type = seg[1] || null;
  const emetteurBrut = seg.slice(2).join('_');
  const emetteur = (!emetteurBrut || /inconnu/i.test(emetteurBrut)) ? null : emetteurBrut;
  return { domaine: domaine, type_doc: type, emetteur: emetteur };
}

test('AUDIT (PoC) : le fail-safe ne se déclenche sur AUCUN document réel (anti-saturation prouvée)', () => {
  const lignes = REELS.map(([nom, dom]) => {
    const c = classifDepuisNom(nom, dom);
    const vide = ctx.estClassificationVide_(c);
    return { nom: nom.slice(0, 40), domaine: dom.slice(0, 22), emetteur: c.emetteur || '—', type: c.type_doc || '—', verdict: vide ? 'À VÉRIFIER' : 'classé' };
  });
  // Tableau lisible pour Marc (protocole phase 1) — visible avec `node --test` en mode verbeux.
  console.table(lignes);

  const enRevue = lignes.filter((l) => l.verdict === 'À VÉRIFIER');
  assert.strictEqual(enRevue.length, 0,
    'AUCUN document réel ne doit partir en revue : ' + enRevue.map((l) => l.nom).join(', '));
});

test('AUDIT (PoC) : contre-épreuve — une analyse réellement VIDE, elle, part bien en revue', () => {
  // Le seul cas qui déclenche : aucune extraction exploitable (réponse LLM quasi vide mais parsable).
  assert.strictEqual(ctx.estClassificationVide_({ domaine: null, emetteur: null, type_doc: null }), true);
  assert.strictEqual(ctx.estClassificationVide_({ domaine: 'xxx', emetteur: '', type_doc: '' }), true);
});

/* ---------- AUDIT AXE 2 (ADR-0025 §8) : aplatissement des candidatures + exports de mails ---------- */

test('AUDIT AXE 2 (ADR-0025) : une candidature (05, entreprise VISÉE) route en CV & lettres, un employeur réel garde son arbre Reset', () => {
  const meta = { nomFichier: '2026-06-30_Lettre de motivation_Airbus.docx' };
  // Même si la PASSE 1 a proposé sousDossier:'Airbus' (entreprise de candidature), le référentiel
  // (validees vide = rien de validé) l'ignore → classement à plat. Le dossier fantôme ne peut plus naître.
  const cand = ctx.planRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'Lettre de motivation', emetteur: 'Airbus', sousDossier: 'Airbus' },
    meta, '2026-06-30', '.docx', {});
  console.table([{ cas: 'candidature Airbus', type: cand.type, sousDossier: cand.sousDossier === '' ? '(à plat)' : cand.sousDossier }]);
  assert.strictEqual(cand.type, 'classé');
  // ADR-0033 : la candidature va dans l'arbre Reset (CV & lettres), JAMAIS un dossier d'entreprise.
  assert.strictEqual(cand.sousDossier, 'CV & lettres/Lettres de motivation (Archives)', 'candidature 05 → CV & lettres/Lettres de motivation (Archives)');
  assert.ok(cand.sousDossier.indexOf('Airbus') === -1, 'jamais un dossier au nom de l\'entreprise visée');

  // Contraste : un employeur RÉEL garde son arbre Reset (la granularité utile reste). Le verrou « SI validé
  // au référentiel » n'est PAS prouvé ici : voir le test suivant.
  const cle = ctx.cleCanoniqueEntite_('05 · Carrière', 'Alphatek');
  // ⚠️ FIGURANT CHANGÉ : ce test prouve que l'employeur VALIDÉ garde son dossier, pas le sort des
  // paies. Depuis ADR-0058, une paie QUITTE `05` par construction — elle ne pouvait donc plus
  // exercer le sujet de ce test. On prend un type que Marc a explicitement laissé en `05`
  // (« attestation d'emploi reste dans 05 ») : le sujet est intact, le figurant est juste devenu
  // légitime. Flipper l'attendu aurait gardé le test vert en lui faisant prouver autre chose.
  const valide = ctx.planRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'Attestation d\'emploi', emetteur: 'Alphatek', sousDossier: 'Alphatek' },
    { nomFichier: '2026-06-30_Attestation d\'emploi_Alphatek.pdf' }, '2026-06-30', '.pdf', { [cle]: 'Alphatek' });
  // ⚠️ CE QUE CETTE ASSERTION PROUVE VRAIMENT (🟡 revue structure ADR-0058) : que le document
  // atterrit dans l'arbre de l'employeur. Elle ne prouve PAS le « SI VALIDÉ au référentiel » du
  // titre — `cheminCibleReset_` résout ici, donc `planRoutageV2_` retourne AVANT de lire
  // `validees` ; remplacer la carte par `{}` laisse ce test vert. C'était DÉJÀ le cas avec l'ancien
  // figurant (une paie 05 passait par la même branche) : le changement n'a rien cassé, mais mon
  // commentaire précédent (« le sujet est intact ») certifiait une propriété que l'assertion ne
  // tient pas. La propriété est prouvée par le test suivant (nom que la table refuse de router).
  assert.ok(valide.sousDossier.indexOf('Employeurs/Alphatek') === 0,
    'un employeur → arbre Reset Employeurs/X (granularité utile, structure validée) : ' + valide.sousDossier);
});

test('AUDIT AXE 2 (ADR-0025) : le référentiel est CONSULTÉ — un nom que la table refuse n\'a un dossier d\'entité que si Marc l\'a validée', () => {
  // « Document » n'est dans aucune liste de la table : `cheminCibleReset_` rend null, donc
  // `planRoutageV2_` atteint le repli où `validees` est réellement lu (contrairement au test
  // précédent, qui retourne avant). Entité fictive au nom inconnu de toute règle.
  const dom = '05 · Carrière';
  const nom = '2024-03-01_Document_Zorbex.pdf';
  assert.strictEqual(ctx.cheminCibleReset_(dom, nom), null,
    'pré-condition : la table refuse, sinon ce test ne consulte plus le référentiel');
  const classif = () => ({ domaine: dom, type_doc: 'Document', emetteur: 'Zorbex', sousDossier: 'Zorbex' });
  const cle = ctx.cleCanoniqueEntite_(dom, 'Zorbex');
  const validee = {}; validee[cle] = { nom: 'Zorbex', dossierId: '' };
  const avec = ctx.planRoutageV2_(classif(), { nomFichier: nom }, '2024-03-01', '.pdf', validee);
  const sans = ctx.planRoutageV2_(classif(), { nomFichier: nom }, '2024-03-01', '.pdf', {});
  assert.strictEqual(avec.sousDossier, 'Zorbex', 'entité validée → son dossier');
  assert.notStrictEqual(sans.sousDossier, 'Zorbex', 'référentiel vide → AUCUN dossier d\'entité (ADR-0023 révisé)');
});

test('AUDIT AXE 2 (ADR-0025) : un export de MAIL n\'est plus dumpé en _Technique (classé au domaine)', () => {
  const cas = [
    { nom: 'Message_Inconnu.html', taille: 200000, attenduExport: false },
    { nom: 'Correspondance_Inconnu.html', taille: 200000, attenduExport: false },
    { nom: '2026-06-30_Courriel_Untel.html', taille: 200000, attenduExport: false },
    // Contre-épreuves (non-régression) : les VRAIS exports de données restent des exports → _Technique.
    { nom: 'facebook_data.html', taille: 200000, attenduExport: true },
    { nom: 'your_information_messages.html', taille: 200000, attenduExport: true },
    { nom: 'navigation_2024.html', taille: 200000, attenduExport: true }, // gros HTML sans émetteur
    // Fils de conversation Facebook (singulier + chiffre) : RESTENT des exports (revue code-reviewer).
    { nom: 'message_1.html', taille: 200000, attenduExport: true },
    { nom: 'message_12.html', taille: 200000, attenduExport: true },
    { nom: 'conversation_3.html', taille: 200000, attenduExport: true },
    // Une facture .html légitime (émetteur, petite) n'a jamais été un export.
    { nom: '2024-03_Facture_Zephyr.html', taille: 5000, emetteur: 'Zephyr', attenduExport: false },
  ];
  const lignes = cas.map((c) => {
    const est = ctx.estExportDonnees_({ nomFichier: c.nom, taille: c.taille, emetteur: c.emetteur });
    return { fichier: c.nom.slice(0, 34), export: est, attendu: c.attenduExport, ok: est === c.attenduExport };
  });
  console.table(lignes);
  assert.ok(lignes.every((l) => l.ok), 'exports mail exclus, exports sociaux conservés : ' +
    lignes.filter((l) => !l.ok).map((l) => l.fichier).join(', '));

  // Bout-en-bout : un mail de correspondance porté par un domaine n'est PLUS un non-document.
  const nd = ctx.decisionNonDocument_(
    { domaine: '01 · Administratif & identité', type_doc: 'Correspondance', emetteur: null },
    { nomFichier: 'Message_Inconnu.html', taille: 200000 });
  assert.strictEqual(nd.estNonDoc, false, 'le mail repart au pipeline (classé), pas en _Technique');
});

/* ---------- AUDIT (PoC §8.5, C28-19/ADR-0020) : table de Confiance vs signaux suspects ---------- */

const ctxSuspect = load(['Config.gs', 'TriGmail.gs']);

test('AUDIT (PoC C28-19) : les faux positifs RÉELS redeviennent sains via la Confiance — même le ⚠ déjà posé', () => {
  // Les faux positifs constatés dans la boîte de Marc (Index du 2026-07-13). `llm: true` +
  // `dejaPoseSuspect: true` reproduisent leur état vécu (marqués ⚠, libellé posé).
  const REELS_SUSPECTS = [
    { cas: 'Alerte de sécurité (Google)', sujet: 'Alerte de sécurité', pj: [] },
    { cas: 'Code 2FA Bellerives Assurances', sujet: 'Code to log on to Bellerives Insurance Home-Auto', pj: [] },
    { cas: 'Fwd: Diplôme de Exemple Marc', sujet: 'Fwd: Diplôme de Exemple Marc', pj: [] },
    { cas: 'Partage de données Google → Claude', sujet: 'Vous avez partagé certaines données de votre compte Google avec Claude', pj: [] },
    { cas: 'Réclamation Bellerives (documents)', sujet: 'Bellerives Assurances Generales: Documents concernant votre réclamation', pj: [] },
  ];
  const lignes = REELS_SUSPECTS.map((r) => {
    const heuristique = ctxSuspect.heuristiquePhishing_(r.sujet, r.pj);
    const signaux = { heuristique, llm: true, estMoi: false, appris: false, cheminDangereux: false, dejaPoseSuspect: true };
    const avant = ctxSuspect.decisionSuspect_(Object.assign({ deConfiance: false }, signaux));
    const apres = ctxSuspect.decisionSuspect_(Object.assign({ deConfiance: true }, signaux));
    return { cas: r.cas, heuristique, avant: avant ? '⚠ suspect' : 'sain', apresClic: apres ? '⚠ suspect' : 'sain' };
  });
  console.table(lignes); // tableau lisible pour Marc (protocole phase 1)
  assert.ok(lignes.every((l) => l.avant === '⚠ suspect'), 'reproduit le vécu : tous marqués ⚠ avant le clic');
  assert.ok(lignes.every((l) => l.apresClic === 'sain'),
    'la confiance outrepasse le LLM, l\'heuristique ET le libellé ⚠ déjà posé');
});

test('AUDIT (PoC C28-19) : contre-épreuve — le phishing d\'un expéditeur NON marqué de confiance reste ⚠', () => {
  const heuristique = ctxSuspect.heuristiquePhishing_('URGENT : vérifiez vos identifiants', ['facture.zip']);
  assert.strictEqual(heuristique, true, 'urgence + identifiants + PJ douteuse = heuristique déterministe');
  assert.strictEqual(ctxSuspect.decisionSuspect_({
    deConfiance: false, heuristique: heuristique, llm: false, estMoi: false,
    appris: false, cheminDangereux: false, dejaPoseSuspect: false,
  }), true, 'sans clic de Marc, rien ne change : le vrai phishing reste marqué');
});

/* ---------- AUDIT COMPARATIF ADR-0080 (protocole 11, ~24 documents représentatifs fictifs) ---------- */

test('AUDIT ADR-0080 : comparaison avant/après sur ~24 cas représentatifs (nommage jour, factures 02, sanctuaire 04)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs', 'Router.gs']);
  const metaDoc = (nom, opts) => Object.assign(
    { nomFichier: nom, taille: 50000, extraitOcr: 'contenu documentaire complet '.repeat(4), emetteur: '' },
    opts || {});

  const ECHANTILLON = [
    { cas: 'Facture électricité (LLM→03)', avant: '03 · Énergie', attenduDom: '02 · Finances', attenduSub: 'Reçus & factures/2026', attenduNom: '2026-01-18_Facture électricité_Hydro-Québec.pdf',
      date: '2026-01-18', classif: { domaine: '03 · Logement & véhicule', type_doc: 'Facture électricité', emetteur: 'Hydro-Québec', date_doc: '2026-01-18' } },
    { cas: 'Facture télécom (LLM→01)', avant: '01 · Contrats', attenduDom: '02 · Finances', attenduSub: 'Reçus & factures/2026', attenduNom: '2026-02-10_Facture_Mobile Boreale.pdf',
      date: '2026-02-10', classif: { domaine: '01 · Administratif & identité', type_doc: 'Facture', emetteur: 'Mobile Boreale', date_doc: '2026-02-10' } },
    { cas: 'Facture optométrie (LLM→07)', avant: '07 · Factures', attenduDom: '02 · Finances', attenduSub: 'Reçus & factures/2026', attenduNom: '2026-04-02_Facture_Optométrie Exemple.pdf',
      date: '2026-04-02', classif: { domaine: '07 · Santé', type_doc: 'Facture', emetteur: 'Optométrie Exemple', date_doc: '2026-04-02' } },
    { cas: 'Facture pharmacie (LLM→07)', avant: '07 · Factures', attenduDom: '02 · Finances', attenduSub: 'Reçus & factures/2026', attenduNom: '2026-05-03_Facture_Pharmacie Exemple.pdf',
      date: '2026-05-03', classif: { domaine: '07 · Santé', type_doc: 'Facture', emetteur: 'Pharmacie Exemple', date_doc: '2026-05-03' } },
    { cas: 'Facture garage (LLM→03)', avant: '03 · Véhicule', attenduDom: '02 · Finances', attenduSub: 'Reçus & factures/2026', attenduNom: '2026-03-11_Facture_Garage Modelb.pdf',
      date: '2026-03-11', classif: { domaine: '03 · Logement & véhicule', type_doc: 'Facture', emetteur: 'Garage Modelb', date_doc: '2026-03-11' } },
    { cas: 'Facture SaaS/API (LLM→08)', avant: '08 · Projets', attenduDom: '02 · Finances', attenduSub: 'Reçus & factures/2026/Abonnements SaaS & API', attenduNom: '2026-06-05_Facture_Outil SaaS.pdf',
      date: '2026-06-05', classif: { domaine: '08 · Perso & projets', type_doc: 'Facture', emetteur: 'Outil SaaS', date_doc: '2026-06-05' } },
    { cas: 'Reçu amende payée (LLM→03)', avant: '03 · Véhicule', attenduDom: '02 · Finances', attenduSub: 'Reçus & factures/2026', attenduNom: '2026-04-14_Reçu de paiement_Ville Exemple.pdf',
      date: '2026-04-14', classif: { domaine: '03 · Logement & véhicule', type_doc: 'Reçu de paiement', emetteur: 'Ville Exemple', date_doc: '2026-04-14' } },
    { cas: 'Bulletin de paie (jour + libellé)', avant: 'AAAA-MM_Paie', attenduDom: '02 · Finances', attenduSub: 'Revenus & paie/Alphatek', attenduNom: '2026-02-19_Bulletin de paie_Alphatek.pdf',
      date: '2026-02-19', classif: { domaine: '05 · Carrière', type_doc: 'Bulletin de paie', emetteur: 'Alphatek', date_doc: '2026-02-19' } },
    { cas: 'T4 2025 reçu en 2026 (année fiscale)', avant: '02 · Impôts', attenduDom: '02 · Finances', attenduSub: 'Impôts & déclarations/2025', attenduNom: '2025_T4_Alphatek.pdf',
      date: '2026-02-28', classif: { domaine: '05 · Carrière', type_doc: 'T4', emetteur: 'Alphatek', date_doc: '2025-12-31' } },
    { cas: 'RL-1 2025 (année fiscale)', avant: '02 · Impôts', attenduDom: '02 · Finances', attenduSub: 'Impôts & déclarations/2025', attenduNom: '2025_Relevé 1_Betatek.pdf',
      date: '2026-02-28', classif: { domaine: '05 · Carrière', type_doc: 'RL-1', emetteur: 'Betatek', date_doc: '2025-12-31' } },
    { cas: 'RL-31 2025 (Impôts)', avant: '02 · Impôts', attenduDom: '02 · Finances', attenduSub: 'Impôts & déclarations/2025', attenduNom: '2025_Relevé 31_Groupe Immobilier Alphaimmo.pdf',
      date: '2026-02-28', classif: { domaine: '02 · Finances', type_doc: 'RL-31', emetteur: 'Groupe Immobilier Alphaimmo', date_doc: '2025-12-31' } },
    { cas: 'Relevé bancaire mensuel', avant: '02 · Relevés', attenduDom: '02 · Finances', attenduSub: 'Relevés/2026', attenduNom: '2026-03_Relevé_Bellerives.pdf',
      date: '2026-03-31', classif: { domaine: '02 · Finances', type_doc: 'Relevé compte courant', emetteur: 'Bellerives', date_doc: '2026-03-31' } },
    { cas: 'Courrier bancaire', avant: '02 · Banques', attenduDom: '02 · Finances', attenduSub: 'Banques/Bellerives', attenduNom: '2025-11-04_Avis modification compte_Bellerives.pdf',
      date: '2025-11-04', classif: { domaine: '02 · Finances', type_doc: 'Avis modification compte', emetteur: 'Bellerives', date_doc: '2025-11-04' } },
    { cas: 'Contrat de bail (non-facture)', avant: '03 · Logement', attenduDom: '03 · Logement & véhicule', attenduSub: 'Logement/1204 avenue Fictive Prairie, Québec', attenduNom: '2025-07-01_Bail_1204 avenue Fictive Prairie.pdf',
      date: '2025-07-01', classif: { domaine: '03 · Logement & véhicule', type_doc: 'Bail', emetteur: '1204 avenue Fictive Prairie', date_doc: '2025-07-01' } },
    { cas: 'Assurance habitation (adresse assurée)', avant: '03 · Assur. hab', attenduDom: '03 · Logement & véhicule', attenduSub: 'Logement/1204 avenue Fictive Prairie, Québec/Assurance habitation', attenduNom: '2026-07-01_Police habitation (1204 Prairie)_Fidelia-MUTA.pdf',
      date: '2026-07-01', classif: { domaine: '03 · Logement & véhicule', type_doc: 'Police habitation (1204 Prairie)', emetteur: 'Fidelia-MUTA', sousDossier: '1204 avenue Fictive Prairie', date_doc: '2026-07-01' } },
    { cas: 'Assurance auto', avant: '03 · Véhicule', attenduDom: '03 · Logement & véhicule', attenduSub: 'Véhicule/VW Modelb/Assurance & sinistres', attenduNom: '2026-04-01_Certificat assurance auto_Modelb Igo.pdf',
      date: '2026-04-01', classif: { domaine: '03 · Logement & véhicule', type_doc: 'Certificat assurance auto', emetteur: 'Modelb Igo', date_doc: '2026-04-01' } },
    { cas: 'Assurance voyage', avant: '09 · Assur. voy', attenduDom: '09 · Voyages', attenduSub: 'Assurances voyage', attenduNom: '2026-05-12_Attestation assurance voyage_AssureurX.pdf',
      date: '2026-05-12', classif: { domaine: '09 · Voyages', type_doc: 'Attestation assurance voyage', emetteur: 'AssureurX', date_doc: '2026-05-12' } },
    { cas: 'Ordonnance médicale (non-facture)', avant: '07 · Santé', attenduDom: '07 · Santé', attenduSub: 'Dossier médical & vaccins', attenduNom: '2026-03-10_Ordonnance_Clinique Exemple.pdf',
      date: '2026-03-10', classif: { domaine: '07 · Santé', type_doc: 'Ordonnance', emetteur: 'Clinique Exemple', date_doc: '2026-03-10' } },
    { cas: 'Diplôme (granularité jour)', avant: 'AAAA_Diplôme', attenduDom: '06 · Études & diplômes', attenduSub: 'Diplômes & relevés officiels', attenduNom: '2020-07-01_Diplôme_UNIVA.pdf',
      date: '2020-07-01', classif: { domaine: '06 · Études & diplômes', type_doc: 'Diplôme', emetteur: 'UNIVA', date_doc: '2020-07-01' } },
    { cas: 'CV envoyé (granularité jour)', avant: 'AAAA_CV', attenduDom: '05 · Carrière', attenduSub: 'CV & lettres/CV & modèles', attenduNom: '2026-06-01_CV_Marc Exemple.pdf',
      date: '2026-06-01', classif: { domaine: '05 · Carrière', type_doc: 'CV', descripteur: 'Marc Exemple', date_doc: '2026-06-01' } },
    { cas: 'Facture en 04 · Immigration (sanctuaire)', avant: '04 · Immigration', attenduDom: '04 · Immigration', attenduSub: 'IRCC (fédéral)', attenduNom: '2026-02-15_Facture_IRCC.pdf',
      date: '2026-02-15', classif: { domaine: '04 · Immigration', type_doc: 'Facture', emetteur: 'IRCC', date_doc: '2026-02-15' } },
    { cas: 'Passeport d\'un proche (proposé 04→01)', avant: '01 · Id/Autres', attenduDom: '01 · Administratif & identité', attenduSub: 'Pièces d\'identité & permis/Autres/Lise Modèle', attenduNom: '2019-02-01_Passeport_Lise Modèle.pdf',
      date: '2019-02-01', classif: { domaine: '04 · Immigration', estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Lise Modèle', date_doc: '2019-02-01' } },
    { cas: 'Courriel reçu (participe passé, non-facture)', avant: '01 · Corresp.', attenduDom: '01 · Administratif & identité', attenduSub: 'Correspondance', attenduNom: '2026-03-01_Courriel reçu_Administration Exemple.pdf',
      date: '2026-03-01', classif: { domaine: '01 · Administratif & identité', type_doc: 'Courriel reçu', emetteur: 'Administration Exemple', date_doc: '2026-03-01' } },
  ];

  const rapport = ECHANTILLON.map((item) => {
    const ext = item.attenduNom.match(/(\.[A-Za-z0-9]+)$/)[1];
    const plan = c.planRoutageV2_(Object.assign({}, item.classif), metaDoc(item.attenduNom, { emetteur: item.classif.emetteur || '' }), item.date, ext, {});
    assert.strictEqual(plan.type, 'classé', item.cas);
    assert.strictEqual(plan.domaine, item.attenduDom, item.cas + ' domaine');
    assert.strictEqual(plan.sousDossier, item.attenduSub, item.cas + ' sousDossier');
    assert.strictEqual(plan.nom, item.attenduNom, item.cas + ' nom');
    return { cas: item.cas, avant: item.avant, apresDom: plan.domaine.slice(0, 14), apresSub: plan.sousDossier, nom: plan.nom.slice(0, 42) };
  });
  console.table(rapport);
  assert.ok(rapport.length >= 20, 'audit comparatif d\'au moins 20 cas représentatifs');
});
