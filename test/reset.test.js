'use strict';
/**
 * RESET C28-33 (ADR-0030) — partie PURE (PR1) : la structure cible respecte « ≤ 7 par niveau,
 * récursif » (contrainte DÉRIVÉE de la table, jamais d'une valeur du jour), le routage par le NOM
 * envoie les fichiers RÉELS de l'inventaire 2026-07-29 vers des nœuds EXISTANTS de la table, un nom
 * non routable rend null (le fichier RESTE dans `_TRI 2026` — jamais deviné), et les artefacts du
 * moteur sont exclus. Les campagnes I/O (rassemblement/dédup/placement/04 interne) = PR2.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// Entites.gs : normaliserCle_ ; Consolidation.gs : analyserNomClasse_ — dépendances RÉELLES du
// routage (pas de stub : c'est le contrat inter-module qu'on teste).
const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
const MAX = 7;

/* ---------- Structure cible : ≤ 7 partout, dérivé de la table ---------- */

test('STRUCTURE_CIBLE_RESET : aucun niveau ne dépasse 7 sous-dossiers (récursif) — la demande de Marc', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(
    ctx.verifierStructureCibleReset_(ctx.structureCibleReset_(), MAX))), []);
  // Les 9 domaines validés sont tous là (dont 04, restructurée en INTERNE — ADR-0030 §4).
  assert.strictEqual(Object.keys(ctx.structureCibleReset_()).length, 9);
  assert.ok(ctx.structureCibleReset_()['04 · Immigration']);
});

test('verifierStructureCibleReset_ : détecte bien une violation (le validateur mord)', () => {
  const trop = {};
  for (let i = 0; i < MAX + 1; i++) trop['d' + i] = {};
  const v = JSON.parse(JSON.stringify(ctx.verifierStructureCibleReset_({ X: trop }, MAX)));
  assert.strictEqual(v.length, 1);
  // Dérivé de MAX (leçon §7 : jamais une valeur du jour en dur dans un test paramétré par la constante).
  assert.match(v[0], new RegExp('^X : ' + (MAX + 1) + ' sous-dossiers$'));
});

/* ---------- Toute cible routée EXISTE dans la table (jamais un chemin inventé) ---------- */

function cibleExiste(domaine, chemin) {
  // Chemin dynamique autorisé : Pièces d'identité & permis/Autres/<personne> (le parent doit exister).
  const segs = chemin.split('/');
  let noeud = ctx.structureCibleReset_()[domaine];
  for (let i = 0; i < segs.length; i++) {
    if (noeud[segs[i]] === undefined) {
      if (i === segs.length - 1 && segs.slice(0, i).join('/') === 'Pièces d\'identité & permis/Autres') return true;
      // Années DYNAMIQUES d'« Impôts & déclarations » ou « Relevés » : segments AAAA assumés.
      if (i === segs.length - 1 &&
        (segs.slice(0, i).join('/') === 'Impôts & déclarations' || segs.slice(0, i).join('/') === 'Relevés') &&
        /^(19|20)\d{2}$/.test(segs[i])) return true;
      return i === segs.length - 1 && segs.slice(0, i).join('/') === 'Revenus & paie' &&
        (ctx.CONFIG.MISSIONS_EMPLOYEURS.some((emp) => emp.nom === segs[i]) ||
          segs[i] === ctx.CONFIG.MISSIONS_EMPLOYEURS_COMMUN);
    }
    noeud = noeud[segs[i]];
  }
  return true;
}

// Noms RÉELS relevés par l'inventaire (12 agents, 2026-07-29) : [domaine d'origine, nom, cible attendue].
const CAS = [
  // 01 — identité à plat sous « Pièces d'identité & permis » pour Marc, `/Autres/<proche>` pour les proches
  ['01 · Administratif & identité', '2020-01-01_Passeport_Marc Exemple.pdf', 'Pièces d\'identité & permis'],
  ['01 · Administratif & identité', '2017-04-19_Carte nationale d\'identité_Préfecture du Nord_2.pdf', 'Pièces d\'identité & permis'],
  ['01 · Administratif & identité', '2019-02-01_Passeport_Lise Modèle.pdf', 'Pièces d\'identité & permis/Autres/Lise Modèle'],
  ['01 · Administratif & identité', '2022-09-01_Carte d\'identité_Paul ECHANTILLON.jpg', 'Pièces d\'identité & permis/Autres/Paul ECHANTILLON'],
  ['01 · Administratif & identité', '2021-03-15_Acte de naissance_Mairie de Lille.pdf', 'État civil & notarial'],
  ['01 · Administratif & identité', '2021-01-06_Attestation titulaire de contrat_Zephyr.pdf', 'Attestations & contrats'],
  ['01 · Administratif & identité', '2024-02-01_Contrat_Energie Aurore.pdf', 'Attestations & contrats'],
  ['01 · Administratif & identité', '2023-05-10_Lettre_Préfecture Du Nord.pdf', 'Correspondance'],
  // 02 — relevés par année (nœud ouvert), reçus vers Autres hors 2021–2026
  ['02 · Finances', '2026-03_Relevé_Bellerives.pdf', 'Relevés/2026'],
  ['02 · Finances', '2015-01_Relevé_CMF.pdf', 'Relevés/2015'],
  ['02 · Finances', '2026-01-10_Facture_Fournisseury.pdf', 'Reçus & factures/2026'],
  ['02 · Finances', '2019-06_Reçu_Hifi & Foto Koch.pdf', 'Reçus & factures/Autres'],
  ['02 · Finances', '2025-05_Avis d\'imposition_Revenu Québec.pdf', 'Impôts & déclarations/2025'],
  ['02 · Finances', '2024-01_Contrat_Bellerives Securities.pdf', 'Placements & crypto'],
  ['02 · Finances', '2022-08_Attestation_Bourselune Banque.pdf', 'Banques/Bourselune'],
  ['02 · Finances', '2010-04_Courrier_Banque Marnex.pdf', 'Banques/Autres'],
  // ADR-0044 §7 / ADR-0080 — budgets → Budgets & suivi, vrac banque → Banques/Autres
  ['02 · Finances', '2026-07-29_Tableau de suivi budgétaire_Marc et Anna.xlsx', 'Budgets & suivi'],
  ['02 · Finances', '2026-07-06_Suivi de livraison_DoorDash.jpg', 'Reçus & factures/2026'],
  ['02 · Finances', '2025-06-01_Avenant aux conditions générales_CourtierX S.A..pdf', 'Placements & crypto'],
  ['02 · Finances', '2026-07-01_Confirmation de virement_Crédit Mutuel.jpg', 'Banques/Autres'],
  ['02 · Finances', '2025-12-31_Formulaire T9999 — Bilan de vérification du revenu étranger_ARC.pdf', 'Impôts & déclarations/2025'],
  ['01 · Administratif & identité', '2022-12-14_Conditions générales de vente_Fournisseury GmbH.pdf', 'Attestations & contrats'],
  ['05 · Carrière', '2026-03-09_Statuts de société civile_PRIGRIS.pdf', 'Entreprise — MRic (SCI)'],
  ['07 · Santé', '2025-11-15_Attestation de versement_Régime de santé étranger.pdf', 'Assurances santé'],
  // Non-régressions de la MÊME passe : les nouvelles règles ne volent personne.
  ['02 · Finances', '2024-09-01_Reçu_Débit préautorisé Hydro-Québec.pdf', 'Reçus & factures/2024'],
  ['02 · Finances', '2024-06-01_Mandat de courtage_Groupe Assurance Vézina.pdf', 'Assurances & prévoyance'],
  ['02 · Finances', '2024-06_Assurance_Bellerives.pdf', 'Assurances & prévoyance'],
  ['02 · Finances', '2024-03_Relevé d\'impôt_Revenu Québec.pdf', 'Impôts & déclarations/2024'],
  ['02 · Finances', '2025-06-01_Relevé de compte_NCourtierxBank.pdf', 'Relevés/2025'],
  // 03 — logements & véhicules
  ['03 · Logement & véhicule', '2024-05_Bail_1204 avenue Fictive Prairie.pdf', 'Logement/1204 avenue Fictive Prairie, Québec'],
  ['03 · Logement & véhicule', '2025-07_Quittance_Groupe Immobilier Alphaimmo.pdf', 'Logement/1201 rue Exemple Alpha'],
  ['03 · Logement & véhicule', '2026-02-04_Convention de résiliation de bail_9333-4444 Québec inc.pdf', 'Logement/1202 rte Fictive Rivage'],
  ['03 · Logement & véhicule', '2023-01_Facture_Modelb Québec.pdf', 'Véhicule/VW Modelb/Achat, immatriculation & entretien'],
  ['03 · Logement & véhicule', '2023-01_Facture_Marqued Québec.pdf', 'Véhicule/Recherche & achat'],
  ['03 · Logement & véhicule', '2025-03-01_Facture_Garage Modeled.pdf', 'Véhicule/Recherche & achat'],
  ['03 · Logement & véhicule', '2026-04-10_Contrat de location de véhicule_Enterprise.pdf', 'Véhicule/Autres'],
  ['03 · Logement & véhicule', '2025-03-01_Facture_Garage Modelb.pdf', 'Véhicule/VW Modelb/Achat, immatriculation & entretien'],
  // 04 — routage INTERNE seulement
  ['04 · Immigration', '2024-11_Permis de travail_IRCC.pdf', 'Permis de travail & EIMT'],
  ['04 · Immigration', '2025-02_Lettre_Immigration, Réfugiés Et Citoyenneté Canada.pdf', 'IRCC (fédéral)'],
  ['04 · Immigration', '2023-09_Demande_Ministère De l\'Immigration, De La Francisation Et De l\'Intégration (MIFI).pdf', 'MIFI (Québec)'],
  ['04 · Immigration', '2015-01_Relevé_Agence Nord Ouest.pdf', null],
  // 05 — Employeurs à plat (ADR-0080), CV & lettres à 2 sous-dossiers
  ['05 · Carrière', '2026-06_Bulletin de paie_Alphatek.pdf', 'Employeurs/Alphatek'],
  ['05 · Carrière', '2024-03_Contrat de travail_BETATEK ROBOTEK INC..pdf', 'Employeurs/Betatek'],
  ['05 · Carrière', '2026-01-05_Lettre_Schneider Electric.pdf', 'CV & lettres/Lettres de motivation (Archives)'],
  ['05 · Carrière', '2022-02_Candidature_Arkema Honfleur.pdf', 'CV & lettres/Lettres de motivation (Archives)'],
  ['05 · Carrière', 'CV — Marc Exemple (modifiable)', 'CV & lettres/CV & modèles'],
  ['05 · Carrière', 'Suivi recherche emploi - Québec', 'Recherche d\'emploi'],
  // 06 — par ÉCOLE (liste de Marc), formation en ligne et Autres à la racine de 06
  ['06 · Études & diplômes', '2019-06_Diplôme_Baccalauréat.pdf', 'Diplômes & relevés officiels'],
  ['06 · Études & diplômes', '2021-01_Relevé de notes_UNIVA.pdf', 'Diplômes & relevés officiels'],
  ['06 · Études & diplômes', '2020-11_Kholle_Mr Têtard.pdf', 'Archives scolaires/Prépa Alpha (2017-2018)/Examens & khôlles'],
  ['06 · Études & diplômes', '2022-03_TP_IUT Du Plateau Côte d\'Opale.pdf', 'Archives scolaires/UNIVA — DUT ZETA (2018-2020)/Cours & travaux'],
  ['06 · Études & diplômes', '2024-09_Attestation_Cégep de Valdor.pdf', 'Archives scolaires/CEGEP - Valdor (2020)'],
  ['06 · Études & diplômes', '2023-05_Projet_CORVIA.pdf', 'Archives scolaires/CORVIA — Ingénieur XSIR (2020-2023)/Cours & travaux'],
  ['06 · Études & diplômes', '2021-09_Convention_Hamx University Of Applied Sciences.pdf', 'Autres'],
  // 07 — 3 dossiers (factures → 02 en flux ; ici cheminCibleReset_('07', ...))
  ['07 · Santé', '2024-10_Compte rendu_Docteur Régine Braouezec.pdf', 'Dossier médical & vaccins'],
  ['07 · Santé', '2020-02_Attestation_CNAM.pdf', 'Assurances santé'],
  // 08
  ['08 · Perso & projets', '2023-08_Schéma_Alimentation 12V.pdf', 'Schémas & technique'],
  // 09 — réservations par année (2020–2023 regroupé) ; Par voyage
  ['09 · Voyages', '2023-08-07_Confirmation de réservation_Air Canada.pdf', 'Réservations & billets/2020\u20132023'],
  ['09 · Voyages', '2025-06-03_Confirmation de réservation_Air Canada.pdf', 'Réservations & billets/2025'],
  ['09 · Voyages', '2025-01-20_Confirmation de réservation_PeruRail.pdf', 'Par voyage/Pérou'],
  ['09 · Voyages', '2024-08-01_Contrat d\'assurance_AssureurX.pdf', 'Assurances voyage'],
  // ---- Non-régression revue PR1
  ['02 · Finances', '2025-03_Avis de remboursement_Revenu Québec.pdf', 'Impôts & déclarations/2025'],
  ['02 · Finances', '2024-02_Reçu de contribution REER_Bellerives.pdf', 'Reçus & factures/2024'],
  ['02 · Finances', '2025-02_Feuillet T4_Alphatek.pdf', 'Impôts & déclarations/2025'],
  ['02 · Finances', '2023-11_Contrat_Bellerives Assurance.pdf', 'Assurances & prévoyance'],
  ['02 · Finances', '2013-04_Courrier_Crédit Mondial Et Commercial.pdf', 'Banques/CMF'],
  ['01 · Administratif & identité', '2023-06_Conditions générales_GMF La Sauvegarde.pdf', null],
  ['01 · Administratif & identité', '2022-01_Codes de sauvegarde_Google.pdf', 'Sécurité & codes'],
  ['01 · Administratif & identité', '2018-07_Passeport_Consulat Général De France À Québec.pdf', 'Pièces d\'identité & permis'],
  ['03 · Logement & véhicule', '2016-09_Bail_Résidence Villeancienne.pdf', 'Logement/Anciens logements'],
  ['03 · Logement & véhicule', '2015-03_Facture_Marquee Modelb.pdf', 'Véhicule/VW Modelb/Achat, immatriculation & entretien'],
  ['04 · Immigration', '2022-05_CAQ_Gouvernement Du Québec.pdf', 'MIFI (Québec)'],
  ['05 · Carrière', '2023-02_Lettre d\'information_Bellerives.pdf', null],
  ['05 · Carrière', 'Archive candidatures 2021-2025', 'Recherche d\'emploi'],
  ['06 · Études & diplômes', '2013-09_Certificat de scolarité_Collège Gustave Delta.pdf', 'Autres'],
  ['06 · Études & diplômes', '2021-03_Attestation_UNIVA CEL Maisonx.pdf', 'Autres'],
  ['06 · Études & diplômes', '2020-01_Programme de colles_Semaine 12.pdf', 'Archives scolaires/Prépa Alpha (2017-2018)/Examens & khôlles'],
  ['09 · Voyages', '2024-05-14_Billet_La Machine De l\'Île.pdf', 'Réservations & billets/2024'],
  ['09 · Voyages', '2023-10-12_Visa_Chine.pdf', 'Par voyage/Chine'],
  // ---- t3
  ['02 · Finances', '2026-06_Paie_Alphatek Inc..pdf', 'Revenus & paie/Alphatek'],
  ['02 · Finances', '2025-12_Déclaration_Donation-partage.pdf', 'Impôts & déclarations/2025'],
];

test('cheminCibleReset_ : les noms RÉELS de l\'inventaire routent vers la cible attendue', () => {
  for (const [dom, nom, attendu] of CAS) {
    const obtenu = ctx.cheminCibleReset_(dom, nom);
    assert.strictEqual(obtenu, attendu, dom + ' | ' + nom + ' → ' + obtenu + ' (attendu ' + attendu + ')');
  }
});

test('cheminCibleReset_ : toute cible NON nulle du jeu de cas existe dans la table (jamais un chemin inventé)', () => {
  for (const [dom, nom] of CAS) {
    const chemin = ctx.cheminCibleReset_(dom, nom);
    if (chemin !== null) assert.ok(cibleExiste(dom, chemin), dom + ' | ' + nom + ' → cible absente de la table : ' + chemin);
  }
});

test('cheminCibleReset_ : non routable → null (reste en _TRI, jamais deviné) ; domaine inconnu → null', () => {
  assert.strictEqual(ctx.cheminCibleReset_('08 · Perso & projets', 'IMG_20240101_123456.jpg'), null);
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', 'sans-nom-classe.bin'), null);
  assert.strictEqual(ctx.cheminCibleReset_('99 · Inconnu', '2026-01_Facture_Zephyr.pdf'), null);
});

test('identité 01 : personne INCONNUE → null (jamais devinée chez Marc) ; autorité/Marc → Pièces d\'identité & permis', () => {
  const d = '01 · Administratif & identité';
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05_Passeport_Sophie Durand.pdf'), null,
    'proche non listé : reste en _TRI au rapport, jamais dans le dossier de Marc');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-06_Permis de conduire_SAAQ.pdf'), 'Pièces d\'identité & permis');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2020-01-01_Passeport_Marc Exemple.pdf'), 'Pièces d\'identité & permis');
});

test('personnesAutres du profil : bornée par la contrainte ≤ 7 (le validateur EXEMPTE ces enfants dynamiques — la promesse doit être CODÉE)', () => {
  // `verifierStructureCibleReset_` exempte explicitement `Pièces d'identité/Autres/<personne>` en
  // disant qu'ils sont « bornés par la liste personnesAutres du profil ». Rien ne bornait cette liste :
  // à 8 personnes, l'invariant constitutionnel « ≤ 7 par niveau » sautait SANS faire échouer la CI
  // (leçon §7 « promesse de verrou = verrou codé dans le même commit », relevé en revue #227).
  assert.ok(Object.keys(ctx.CONFIG.PARCOURS.personnesAutres).length <= MAX,
    'ajouter une 8ᵉ personne casserait le ≤ 7 de `Pièces d\'identité/Autres` : créer un regroupement d\'abord');
});

test('MISSIONS_EMPLOYEURS : bornée par la contrainte ≤ 7 (jumeau du verrou personnesAutres — revue structure-keeper PR2)', () => {
  // « Revenus & paie/<employeur> » est la 2ᵉ famille d'enfants dynamiques exemptée du validateur :
  // même promesse, même verrou codé — un 8ᵉ employeur casserait le ≤ 7 sans faire échouer la CI.
  assert.ok(ctx.CONFIG.MISSIONS_EMPLOYEURS.length + 1 <= MAX,
    'canoniques + le commun « Autres employeurs » : un 7ᵉ canonique casserait le ≤ 7');
  // ADR-0044 D11 : les employeurs OCCASIONNELS ne comptent PAS dans cette borne, justement parce
  // qu'ils partagent UN dossier. Le verrou : ils ne doivent jamais être promus canoniques en
  // douce (sinon la borne saute sans que rien n'échoue).
  const canon = ctx.CONFIG.MISSIONS_EMPLOYEURS.map((e) => e.nom);
  ctx.CONFIG.MISSIONS_EMPLOYEURS_AUTRES.forEach((e) => assert.ok(canon.indexOf(e.nom) === -1,
    'un employeur occasionnel ne doit pas figurer AUSSI dans le canon : ' + e.nom));
  // Jetons alphabétiques, MULTI-MOTS AUTORISÉS : la contrainte porte sur le NUMÉRIQUE
  // (`apparierUnique_` reçoit du texte brut, un jeton chiffré matcherait un composant de date),
  // pas sur les espaces — et c'est justement le multi-mots qui rend `delta crest` /
  // `orbite emploi` DISCRIMINANTS (revue code C28-62 PR2).
  ctx.CONFIG.MISSIONS_EMPLOYEURS_AUTRES.forEach((e) => e.jetons.forEach((j) =>
    assert.match(j, /^[a-z]+( [a-z]+)*$/, 'jeton non alphabétique : ' + j)));
  // …et un CONTRE-EXEMPLE par employeur : le charset ne prouve pas la discrimination. Ces noms
  // sont ceux qui partaient à tort chez « Autres employeurs » avec des jetons d'un seul mot.
  [['2021-01_Bilan_Trajectoire professionnelle.pdf', 'Orbite-Emploi'],
    ['2020-01_Facture_Crest Toothpaste.pdf', 'Delta Crest'],
  ].forEach(([nom, emp]) => assert.strictEqual(ctx.employeurAutreDuNom_(nom), null,
    'mot courant ⇒ jamais ' + emp + ' : ' + nom));
  // Contre-épreuve positive : les vrais noms matchent toujours.
  assert.strictEqual(ctx.employeurAutreDuNom_('2026-07-01_Attestation_Delta Crest.jpg'), 'Delta Crest');
  assert.strictEqual(ctx.employeurAutreDuNom_('2026-01_Paie_Orbite-Emploi.PDF'), 'Orbite-Emploi');
});

test('identité 01 : Anna specimen a son dossier (validation Marc 2026-07-30) — le nom RÉEL du reliquat, suffixe `_2` inclus', () => {
  const d = '01 · Administratif & identité';
  // Nom EXACT resté en `_TRI 2026/01` (le suffixe `_2` de dédup fait partie du tiers analysé).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2022-09-07_Passeport_Anna specimen_2.pdf'),
    'Pièces d\'identité & permis/Autres/Anna Specimen');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2019-03_Carte d\'identité_Anna specimen.pdf'),
    'Pièces d\'identité & permis/Autres/Anna Specimen');
  // La garde reste ENTIÈRE pour les autres : ajouter une personne n'ouvre pas la porte aux inconnus.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05_Passeport_Sophie Durand.pdf'), null);
});

test('01 : codes de RÉCUPÉRATION → Sécurité & codes (le pluriel n\'est pas couvert par le singulier)', () => {
  const d = '01 · Administratif & identité';
  // Nom RÉEL resté en `_TRI 2026/01` faute de règle (constaté 2026-07-30).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-06-29_Codes de récupération_Codes de récupération authentification double facteur.txt'),
    'Sécurité & codes');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-01_Code de récupération_Google.txt'), 'Sécurité & codes');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Mot de passe_Coffre.txt'), 'Sécurité & codes');
  // Non-régression : « La Sauvegarde » reste un ASSUREUR, jamais un code de sécurité.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2023-06_Conditions générales_GMF La Sauvegarde.pdf'), null);
});

test('05 : motif « ute » EXACT seulement — un émetteur qui le contient par hasard reste non routé (revue PR1)', () => {
  assert.strictEqual(ctx.cheminCibleReset_('05 · Carrière', '2024-01_Lettre_Communauté Métropolitaine.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_('05 · Carrière', '2019-05_Lettre_UTE.pdf'), 'CV & lettres/Lettres de motivation (Archives)');
});

test('05 : « Recherche d\'emploi » + structure 05 à 4 piliers (ADR-0044 D10 / ADR-0080)', () => {
  const n05 = ctx.structureCibleReset_()['05 · Carrière'];
  assert.ok(n05['Recherche d\'emploi'], 'le nœud est de retour dans la table cible');
  assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(n05['CV & lettres']))),
    ['CV & modèles', 'Lettres de motivation (Archives)'], 'CV & lettres garde ses 2 sous-dossiers');
  const carriere = ctx.tableMissions_().filter((m) => m.tag === 'carriere')[0];
  const IDS = ctx.CONFIG.MISSIONS_IDS;
  assert.ok(carriere.sources.indexOf(IDS.rechercheEmploi) === -1,
    'le dossier n\'est plus une SOURCE (sinon la mission le vide pendant que le flux le remplit)');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(carriere.sourcesJetables)), [],
    'plus aucune source peinte en rouge');
  const D = '05 · Carrière';
  assert.strictEqual(ctx.cheminCibleReset_(D, '2026-07-06_Offre d\'emploi_Cégep Garneau.jpg'), 'Recherche d\'emploi');
  assert.strictEqual(ctx.cheminCibleReset_(D, '2022-12-19_Invitation d\'entretien_Betatek robotek.ics'), 'Recherche d\'emploi');
  assert.strictEqual(ctx.cheminCibleReset_(D, '2026-01-01_CV_Marc Exemple.pdf'), 'CV & lettres/CV & modèles');
  assert.ok(Object.keys(JSON.parse(JSON.stringify(n05))).length <= MAX, 'règle des ≤ ' + MAX);
});

test('06 : la table des écoles se construit depuis SOUS_DOSSIERS_ECOLE_RESET et le profil (une seule source, revue PR1)', () => {
  // (ADR-0055) Les écoles vivent sous `Archives scolaires`, le dossier de MARC, et portent SES
  // noms. `getFoldersByName` est SENSIBLE À LA CASSE et aux tirets CADRATINS : un libellé qui
  // diffère d'un caractère crée un dossier jumeau à côté du sien.
  const table = JSON.parse(JSON.stringify(
    ctx.structureCibleReset_()['06 · Études & diplômes'][ctx.RACINE_ARCHIVES_ECOLE_RESET]));
  const attendu = JSON.parse(JSON.stringify(ctx.SOUS_DOSSIERS_ECOLE_RESET));
  const thematiquesProfil = (cle) => JSON.parse(JSON.stringify(
    ctx.CONFIG.PARCOURS.ecoles.filter((e) => e.cle === cle)[0].thematiques));
  // Les 4 standard sont TOUJOURS là, dans l'ordre de la constante — une seule source. Ce qui suit
  // (le « Concours » de la prépa, les sous-dossiers THÉMATIQUES de Marc) s'y AJOUTE, jamais s'y
  // substitue : la garde qui protège ses dossiers de la corbeille ne doit pas défaire la taxonomie.
  for (const ecole of ['Collège & Lycée — divers (2014-2018)']) {
    assert.deepStrictEqual(Object.keys(table[ecole]), attendu, ecole);
  }
  // (ADR-0060) `CEGEP - Valdor (2020)` est le dossier de Marc, 9 fichiers À PLAT, « aucun fichier
  // ne bouge » : déclaré SANS sous-dossier, et `cheminCibleReset_` le laisse à plat.
  assert.deepStrictEqual(Object.keys(table['CEGEP - Valdor (2020)']), []);
  for (const ecole of ['UNIVA — DUT ZETA (2018-2020)', 'CORVIA — Ingénieur XSIR (2020-2023)']) {
    assert.deepStrictEqual(Object.keys(table[ecole]).slice(0, attendu.length), attendu, ecole);
  }
  assert.deepStrictEqual(Object.keys(table['Prépa Alpha (2017-2018)']), attendu.concat(['Concours']));
  // Les thématiques de MARC (relevé Drive du 14/09), déclarées pour ne pas être proposées à la
  // corbeille ni mutées par la réorg — dérivées de la constante, jamais recopiées.
  assert.deepStrictEqual(Object.keys(table['CORVIA — Ingénieur XSIR (2020-2023)']).slice(attendu.length),
    thematiquesProfil('ingenieur'));
  assert.deepStrictEqual(Object.keys(table['UNIVA — DUT ZETA (2018-2020)']).slice(attendu.length),
    thematiquesProfil('dut'));
});

test('ADR-0055 / ADR-0080 — exemptions nommées au plafond ≤ 7 (02 Finances + CORVIA)', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.exemptionsPlafondReset_())), [
    '02 · Finances',
    '06 · Études & diplômes/Archives scolaires/CORVIA — Ingénieur XSIR (2020-2023)',
  ]);
  const vraies = ctx.exemptionsPlafondReset_;
  ctx.exemptionsPlafondReset_ = () => [];
  try {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(
      ctx.verifierStructureCibleReset_(ctx.structureCibleReset_(), MAX))), [
      '02 · Finances : 8 sous-dossiers',
      '06 · Études & diplômes/Archives scolaires/CORVIA — Ingénieur XSIR (2020-2023) : 16 sous-dossiers',
    ]);
  } finally { ctx.exemptionsPlafondReset_ = vraies; }
});

test('ADR-0055 — une règle, deux consommateurs : les cibles de la mission == les écoles du routage', () => {
  // Le flux (`cheminCibleReset_`) classe DANS les dossiers de Marc ; la mission `ecoles-archives06`
  // y VERSE le contenu des dossiers que le moteur s'était créés à la racine de `06`. Si les deux
  // listes divergent d'un nom, l'un remplit ce que l'autre ne vise pas — c'est la leçon C28-26
  // (« deux formules équivalentes écrites séparément divergent toujours quelque part »).
  // Les deux bornes sont DÉRIVÉES, jamais recopiées : les fenêtres de scolarité d'un côté, la
  // table d'alias de l'autre.
  const paires = ctx.CONFIG.MISSIONS_IDS.ecoles06;
  const archives = ctx.structureCibleReset_()['06 · Études & diplômes'][ctx.RACINE_ARCHIVES_ECOLE_RESET];
  for (const p of paires) {
    assert.ok(Object.prototype.hasOwnProperty.call(archives, p.cibleNom),
      'cible de mission absente de la table : ' + p.cibleNom);
  }
  const cibles = Array.from(new Set(paires.map((p) => p.cibleNom))).sort();
  const ecolesRoutees = Array.from(new Set(ctx.fenetresEcoleReset_().map((f) => f.ecole))).sort();
  assert.deepStrictEqual(cibles, ecolesRoutees,
    'toute école que le routage sait nommer doit recevoir le contenu de son dossier de racine');
  // Une source ne peut pas être sa propre cible (la mission tournerait en rond). ⚠️ AUCUNE n'est
  // déclarée JETABLE : peindre les dossiers vidés « bon pour suppression » reposait sur un invariant
  // non démontré (C28-106), et depuis ADR-0056 l'une des sources est un dossier de MARC.
  for (const p of paires) assert.notStrictEqual(p.src, p.cible);
  // ⚠️ ET une SOURCE n'est la cible d'AUCUNE autre paire (🟠 revue code ADR-0056). L'invariant
  // n'avait pas de sens tant que les cibles étaient pures ; il en a un depuis que la fusion fait
  // d'un ancien dossier d'archive une source. Sans lui : les fichiers du lycée atterrissent dans le
  // dossier intermédiaire, y reçoivent une clé de SUCCÈS, et n'iront JAMAIS dans le dossier
  // fusionné — fusion à moitié faite, silencieuse, mission « TERMINÉE ». Mutation : remettre
  // l'ancien ID en `cible` sur la 1ʳᵉ paire ⇒ ce test tombe.
  const ciblesDeclarees = {};
  for (const p of paires) { if (p.cible) ciblesDeclarees[p.cible] = true; }
  for (const p of paires) {
    assert.ok(!ciblesDeclarees[p.src],
      'une SOURCE ne peut pas être la cible d\'une autre paire (le fichier y serait keyé en ' +
      'SUCCÈS et ne repartirait jamais) : ' + p.src);
  }
  const sources = Array.from(paires).map((p) => p.src).sort();
  assert.strictEqual(sources.join('|'), Array.from(new Set(sources)).sort().join('|'),
    'chaque dossier de racine est une source UNIQUE');
});

test('estExcluDuReset_ : artefacts du moteur et dossiers techniques (ADR-0080) exclus ; documents normaux jamais exclus', () => {
  assert.strictEqual(ctx.estExcluDuReset_('DriveAI — État'), true);
  assert.strictEqual(ctx.estExcluDuReset_('DriveAI — Corriger un classement'), true);
  assert.strictEqual(ctx.estExcluDuReset_('Rapports agent — tri Gmail'), true);
  assert.strictEqual(ctx.estExcluDuReset_('00 · Guide de rangement (lis-moi)'), true);
  assert.strictEqual(ctx.estExcluDuReset_('00 · Raccourcis & pièces liées'), true);
  assert.strictEqual(ctx.estExcluDuReset_('restic-pc'), true);
  assert.strictEqual(ctx.estExcluDuReset_('univers'), true);
  assert.strictEqual(ctx.estExcluDuReset_('universite'), false, 'nom exact pour univers, jamais universite');
  assert.strictEqual(ctx.estExcluDuReset_('2026-01_Facture_Zephyr.pdf'), false);
  assert.strictEqual(ctx.estExcluDuReset_(''), false);
});

test('estFactureOuRecuPaiementReset_ (ADR-0080) : capture factures/reçus et exclut paies, fiscal, contrats, médical, courriels', () => {
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-01-18_Facture électricité_Hydro-Québec.pdf', 'Facture électricité'), true);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-02-10_Reçu de paiement_Mobile Boreale.pdf', 'Reçu de paiement'), true);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-03-01_Invoice_Cloud Vendor.pdf', 'Invoice'), true);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-04-01_Facture_Clinique Optométrie.pdf', 'Facture'), true);
  // Disqualifiants stricts
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-03-01_Courriel reçu_Administration.pdf', 'Courriel reçu'), false);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-03-01_Contrat_Mobile Boreale.pdf', 'Contrat'), false);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-03-01_Ordonnance_Clinique.pdf', 'Ordonnance'), false);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-03-01_Quittance_Bailleur.pdf', 'Quittance'), false);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2026-03-15_Bulletin de paie_Alphatek.pdf', 'Bulletin de paie'), false);
  assert.strictEqual(ctx.estFactureOuRecuPaiementReset_('2025_T4_Alphatek.pdf', 'T4'), false);
});

/* ---------- t3 : décisions Marc du 2026-07-30 sur le RELIQUAT RÉEL (134 non routés) ---------- */

test('02 : bulletins de paie → Revenus & paie — type EXACT, JAMAIS la sous-chaîne « paie » ⊂ « paiement »', () => {
  const d = '02 · Finances';
  // Noms RÉELS du reliquat (onglet Reset, 2026-07-30) — PAR EMPLOYEUR depuis C28-49 PR2 (décision
  // Marc « séparé par employeur ») : même canon que mission-paies (`employeurDuNom_`).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-06_Paie_Alphatek Inc..pdf'), 'Revenus & paie/Alphatek');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-01_Paie_Betatek robotek Inc..pdf'), 'Revenus & paie/Betatek');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-01_Paie_Hopitalex de la Capitale-Nationale.pdf'), 'Revenus & paie/Hopitalex');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-03_Bulletin de paie_Alphatek.pdf'), 'Revenus & paie/Alphatek');
  // Le motif ANCRÉ sur le mot couvre plus large que des égalités exactes (revue #228).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-07_Sommaire de paie_Alphatek.pdf'), 'Revenus & paie/Alphatek');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-02_Attestation de salaire_Hopitalex.pdf'), 'Revenus & paie/Hopitalex');
  // Employeur HORS table → racine « Revenus & paie » (jamais deviné, jamais un dossier inventé).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2018-04_Paie_Boulangerie Dupont.pdf'), 'Revenus & paie');
  // ⚠ LE piège : « paie » est une sous-chaîne de « paiement ». Un paiement n'est PAS un salaire.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-07-01_Confirmation de paiement_Crédit Mutuel.pdf'), null,
    'un « paiement » ne doit JAMAIS être pris pour un bulletin de paie');
  // ⚠⚠ LE piège au carré (attrapé en revue #228) : « relevé de paiement » COMMENCE par « relevé de
  // paie » — une 1ʳᵉ version le routait en Revenus & paie alors que c'est un relevé. Dénomination
  // courante (Hydro-Québec, Retraite Québec, assureurs) et la règle passe AVANT « Relevés ».
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-11_Relevé de paiement_Hydro-Québec.pdf'), 'Relevés/2024',
    'un « relevé de paiement » est un RELEVÉ, jamais un bulletin de paie');
  // Non-régression : les feuillets FISCAUX restent fiscaux, pas de la paie.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Feuillet T4_Alphatek.pdf'), 'Impôts & déclarations/2025');
});

test('02 : feuillets québécois RL-1 / RL-31 → Impôts, PAS Relevés (correction d\'un commentaire faux, revue #228)', () => {
  const d = '02 · Finances';
  // `t = 'releve 1'` matchait la règle « Relevés » (placée AVANT la règle fiscale) : le RL-1, feuillet
  // de revenus d'emploi québécois, atterrissait avec les relevés BANCAIRES. Vu les 10 bulletins de
  // paie Alphatek/Betatek du reliquat, le cas est probable.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Relevé 1_Alphatek.pdf'), 'Impôts & déclarations/2025');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Relevé 31_Groupe Immobilier Alphaimmo.pdf'), 'Impôts & déclarations/2025');
  // Motif ANCRÉ sur le nombre : un relevé bancaire ordinaire n'est jamais capturé.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-03_Relevé_Bellerives.pdf'), 'Relevés/2026');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-03_Relevé 10_Bellerives.pdf'), 'Relevés/2026');
});

test('02 : donations/successions → Impôts & déclarations (le nœud dédié a cédé sa place, versant notarial couvert par 01)', () => {
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2025-12_Déclaration_Donation-partage.pdf'), 'Impôts & déclarations/2025');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2024-03_Attestation_Succession Exemple.pdf'), 'Impôts & déclarations/2024');
  // Année du NOM implausible (bornes dérivées d'`anneePlausible_`, LA règle partagée flux ↔
  // missions : 1990-2100) → RACINE, jamais un dossier-année inventé — mission-impots reprendra si
  // une règle future l'éclaire. Les DEUX bornes testées (revue structure-keeper PR2 : deux
  // fenêtres écrites séparément avaient déjà divergé).
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2103-01_Avis d\'imposition_Revenu Québec.pdf'), 'Impôts & déclarations');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '1989-01_Avis d\'imposition_Trésor Public.pdf'), 'Impôts & déclarations');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '1990-01_Avis d\'imposition_Trésor Public.pdf'), 'Impôts & déclarations/1990');
  // La table ne doit PLUS porter le nœud retiré (sinon dossier fantôme jamais alimenté).
  assert.ok(!ctx.structureCibleReset_()['02 · Finances']['Donations & successions'],
    'nœud retiré de la table cible');
  assert.ok(ctx.structureCibleReset_()['02 · Finances']['Revenus & paie'], 'et remplacé par Revenus & paie');
});

test('03 : pas de fourre-tout Contrats/Correspondance à la racine — les règles entité/véhicule priment', () => {
  const d = '03 · Logement & véhicule';
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-03-09_Contrat_Inconnu.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-05_Consentement_Propriétaire.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_(d, '2023-02_Correspondance_Syndic.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_(d, '2022-11_Avis de séjour_Camping.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-07_Contrat_Groupe Immobilier Alphaimmo.pdf'),
    'Logement/1201 rue Exemple Alpha');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-01_Contrat_1204 avenue Fictive Prairie.pdf'),
    'Logement/1204 avenue Fictive Prairie, Québec');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2023-05_Contrat_Marqued Québec.pdf'), 'Véhicule/Recherche & achat');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-01-01_Contrat de location de véhicule_VW Modelb.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-05_Bail_Résidence X.pdf'), null);
});

/* ---------- 03 c49-2 (ADR-0040 §3a/§3c) : catégories PAR VÉHICULE — le transversal t4 est
 * RÉVOQUÉ par la décision Marc 2026-08-17. Un document de véhicule SANS véhicule identifiable
 * n'a PLUS de fourre-tout : le flux (table pure) rend null (à plat au domaine + rapport) — la
 * MISSION ne devine plus non plus : le repli par date est RETIRÉ (ADR-0044 §4). Noms RÉELS. --- */

test('c49-2 · 03 : un document de véhicule NOMMÉ va dans SON véhicule (sous-dossiers si configurés, plat sinon)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  assert.strictEqual(c.cheminCibleReset_(D, '2025-03-01_Facture_Garage Modelb.pdf'),
    'Véhicule/VW Modelb/Achat, immatriculation & entretien');
  assert.strictEqual(c.cheminCibleReset_(D, '2023-06-20_Contrat de vente véhicule d\'occasion_Modelb.pdf'),
    'Véhicule/VW Modelb/Achat, immatriculation & entretien');
  assert.strictEqual(c.cheminCibleReset_(D, '2026-04-10_Contrat de location de véhicule_Enterprise.pdf'),
    'Véhicule/Autres');
  assert.notStrictEqual(c.cheminCibleReset_(D, '2022-11_Avis de séjour_Camping.pdf'), 'Véhicule/Autres');
  assert.notStrictEqual(c.cheminCibleReset_(D, '2018-10-15_Formulaire de demande de location_CORPIQ.pdf'),
    'Véhicule/Autres');
  assert.strictEqual(c.cheminCibleReset_(D, '2023-11-13_Soumission d\'assurance automobile_Modelb Bellerives.pdf'),
    'Véhicule/VW Modelb/Assurance & sinistres');
  assert.strictEqual(c.cheminCibleReset_(D, '2015-03_Facture_Marquee Modelb.pdf'),
    'Véhicule/VW Modelb/Achat, immatriculation & entretien');
  assert.strictEqual(c.cheminCibleReset_(D, '2024-03_Facture_Ford Modela.pdf'), 'Véhicule/Ford Modela');
});

test('c49-2 · 03 : SANS véhicule identifiable → Autres / null si générique — noms réels t4', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  [
    '2023-10-02_Facture_Garage Charlesbourg Certi-Pro.jpg',
    '2023-11-13_Soumission d\'assurance automobile_Bellerives Assurances.pdf',
    '2026-06-29_Carte d\'assurance_Bellerives Assurances.jpg',
    '2026-07-01_Capture d\'écran_Drummondville Marquee.jpg',
    '2026-07-01_Facture_Marquec.jpg',
    '2025-01-01_Assurance habitation_Bellerives.pdf',
    '2025-01-01_Assurance habitation_Intact.pdf',
    '2023-11-01_Réclamation_Boreale.png',
  ].forEach((nom) => assert.strictEqual(c.cheminCibleReset_(D, nom), null, nom));
  [
    '2023-06-27_Constat d\'infraction_Ville de Québec.jpg',
    '2026-07-06_Constat d\'infraction_Municipalité de Thetford Mines.jpg',
    '2026-07-20_Certificat d\'immatriculation_Société de l\'assurance automobile du Québec.jpg',
  ].forEach((nom) => assert.strictEqual(c.cheminCibleReset_(D, nom), 'Véhicule/Autres', nom));
  assert.strictEqual(c.cheminCibleReset_(D, '2025-01-01_Assurance habitation 1204 avenue Fictive Prairie_Bellerives.pdf'),
    'Logement/1204 avenue Fictive Prairie, Québec/Assurance habitation');
});

test('t4 · 03 : le ferroviaire reste en _TRI — le reset ne peut PAS changer de domaine', () => {
  // Marc veut ces fichiers en « 08 · Perso & projets/Voyages ». `cheminCibleReset_` rend un chemin
  // RELATIF au domaine d'ORIGINE : un fichier venu de 03 ne peut aller que sous 03. On préfère donc
  // null (reste en _TRI, RAPPORTÉ) à un mauvais rangement — « Recherche-Devis » contient « devis »
  // et serait sinon capturé par le filet « Contrats ».
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  ['2026-07-01_Billet_SNCF.jpg', '2026-07-01_Billet de train_SNCF.jpg',
    '2026-07-01_Confirmation de réservation_SNCF.jpg', '2026-07-01_Recherche-Devis_SNCF.jpg',
    '2026-07-07_Résultats de recherche tarifaire_SNCF.jpg']
    .forEach((nom) => assert.strictEqual(c.cheminCibleReset_(D, nom), null, nom));
});

test('c49-2 · 03 : les règles par ENTITÉ/BAILLEUR gardent la priorité sur les types génériques', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  // Un document de véhicule va chez SON véhicule (catégorie par l'atelier), jamais dans un filet.
  assert.strictEqual(c.cheminCibleReset_(D, '2025-03-01_Facture_Garage Modelb.pdf'),
    'Véhicule/VW Modelb/Achat, immatriculation & entretien');
  // Un document ALPHAIMMO part chez SON logement (table bailleur) même si son type est « Annonce ».
  assert.strictEqual(c.cheminCibleReset_(D, '2026-01-01_Annonce_Groupe Immobilier Alphaimmo.pdf'),
    'Logement/1201 rue Exemple Alpha');
  // Le nœud du split n'existe plus : verrous d'ABSENCE des pluriels (patron « Recherche d'emploi »).
  const n03 = ctx.structureCibleReset_()['03 · Logement & véhicule'];
  assert.ok(!n03['Logements'] && !n03['Véhicules'],
    'les pluriels sont RETIRÉS de la table (les missions les vident — ping-pong sinon)');
  assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(n03['Véhicule']['VW Modelb']))),
    ['Achat, immatriculation & entretien', 'Assurance & sinistres']);
  assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(n03['Véhicule']['Marquec Modelc']))), []);
  // ADR-0044 — même patron que les pluriels : un bucket de cette table est RECRÉÉ PAR NOM, donc
  // garder « Marqued » ici pendant que la mission le dissout produirait un ping-pong.
  assert.ok(!n03['Véhicule']['Marqued'], 'Marqued retiré de la table (sinon recréé par nom à chaque classement)');
  const vehicules = JSON.parse(JSON.stringify(ctx.CONFIG.MISSIONS_VEHICULES)).map((v) => v.nom);
  vehicules.forEach((v) => assert.ok(n03['Véhicule'][v], 'chaque véhicule du canon a son nœud : ' + v));
  assert.deepStrictEqual(
    Object.keys(JSON.parse(JSON.stringify(n03['Véhicule']))).filter((n) => !vehicules.includes(n)),
    ['Autres', 'Recherche & achat'], 'les communs Véhicule de la structure 9 piliers');
  // ⚠️ LE VRAI VERROU N'EST PAS LA TABLE. `estAncreStructurelleFusion_` ne regarde que le PREMIER
  // NIVEAU de STRUCTURE_CIBLE_RESET[domaine] : un nœud imbriqué sous « Véhicule » n'y est jamais
  // protégé (et la collecte de Fusion.gs n'est même pas récursive). Ce qui protège réellement les
  // communs, c'est `estSegmentStructurel_` — l'inventaire de la RÉORG, lui, est récursif (BFS) et
  // proposerait de fusionner un dossier que 2 producteurs recréent PAR NOM. Une version antérieure
  // de ce test assertait la présence dans la table en la COMMENTANT « c'est ce qui en fait des
  // ancres » : un proxy qui n'impliquait pas la propriété (leçon « promesse de verrou = verrou
  // codé dans le même commit »).
  // (le verrou lui-même est asserté dans `reorg.test.js`, où `estSegmentStructurel_` est chargé)

  assert.ok(Object.keys(JSON.parse(JSON.stringify(n03['Véhicule']))).length <= MAX,
    'règle des ≤ ' + MAX + ' nœuds (dérivée de la constante, jamais du littéral du jour)');
});

/* ---------- ADR-0058 — une paie vit en Finances, quel que soit l'avis du LLM ---------- */

test('ADR-0058 : estRevenuEmployeurReset_ reconnaît les paies et le RL-1, et RIEN d\'autre', () => {
  // Demande de Marc, mot pour mot : « mes paies ne devraient pas arriver dans employeur mais
  // seulement dans finances », puis « rl-1 aussi dans finances, attestation d'emploi reste dans 05 ».
  const f = ctx.estRevenuEmployeurReset_;
  const n = (t) => '2026-06-30_' + t + '_Alphatek.pdf';
  // (a) Les graphies de paie — toutes couvertes par le prédicat PARTAGÉ `estTypePaieReset_`.
  for (const t of ['Paie', 'Bulletin de paie', 'Fiche de paie', 'Feuille de paie',
    'Bulletin de salaire', 'Sommaire de paie', 'Relevé de paie']) {
    assert.strictEqual(f(n(t)), true, t);
  }
  // (b) Le RL-1, qui est émis par l'EMPLOYEUR : même mode de panne exactement.
  //     ⚠️ Lu sur le TYPE BRUT et pas sur le nom : `nommerDocument_` réduit « Relevé 1 » à
  //     « Relevé » — le « 1 », sur lequel le prédicat de feuillet est ANCRÉ, a déjà disparu du nom
  //     final. Mesuré, pas supposé. C'est la seule raison pour laquelle le second argument existe.
  assert.strictEqual(f(n('Relevé 1')), true, 'RL-1 quand le nom conserve le numéro');
  // ⚠️ LA GRAPHIE « RL-1 » EST COUVERTE, et sans divergence — correction d'un raisonnement que la
  //     revue a retourné. Je voulais laisser le cas de côté au motif qu'élargir le prédicat partagé
  //     créerait une divergence : c'est l'INVERSE. Le correctif ne touche pas le prédicat du tout,
  //     il CANONICALISE au renommage (`RL-1` → `Relevé 1`), donc tous les consommateurs voient le
  //     même texte — une seule règle, N consommateurs.
  assert.strictEqual(f('2026_Relevé 1_Alphatek.pdf', 'RL-1'), true, 'graphie « RL-1 » couverte');
  assert.strictEqual(f('2026_Relevé_Alphatek.pdf', 'Relevé 1'), true, 'RL-1 via le type BRUT');
  assert.strictEqual(f('2026_Relevé_Alphatek.pdf', ''), false,
    'sans le type brut, un « Relevé » nu n\'est PAS un feuillet — il pourrait être bancaire');
  // (c) ⚠️ LE PIÈGE #228, en test bloquant : « paiement » n'est PAS « paie ». Un faux positif ici
  //     enverrait des reçus de dépense dans les revenus — et le verdict qui DÉPLACE est définitif
  //     de fait (§9), donc il se prouve dans les deux sens.
  for (const t of ['Reçu de paiement', 'Paiement préautorisé', 'Relevé de paiement',
    'Avis de paiement', 'Confirmation de paiement']) {
    assert.strictEqual(f(n(t)), false, t);
  }
  // (b bis) LE T4, décision de Marc du 14/09 : « oui le t4 aussi dans finances ». Tout salarié
  //     québécois reçoit chaque année un T4 (fédéral) ET un RL-1 (provincial), émis par le MÊME
  //     employeur, avec exactement le même mode de panne.
  assert.strictEqual(f(n('T4')), true);
  assert.strictEqual(f(n('Feuillet T4')), true);
  assert.strictEqual(f('2026_Relevé_X.pdf', 'T4'), true, 'reconnu aussi par le type BRUT');
  //     ⚠️ ET LA BORNE QUE LA REVUE A SIGNALÉE : surtout pas `estTypeFiscalReset_`, qui connaît
  //     déjà `t4` mais matche AUSSI `taxe`/`taxes` en mot entier — il attraperait un « Compte de
  //     taxes municipales », qui relève de `03`. Un verdict qui DÉPLACE est définitif de fait.
  assert.strictEqual(f(n('Compte de taxes municipales')), false, 'la taxe municipale relève de 03');
  assert.strictEqual(f(n('Avis d\'imposition')), false, 'un avis d\'imposition n\'est pas un revenu d\'employeur');
  //     `T4A` est un AUTRE feuillet (revenus hors emploi salarié) : Marc a nommé le T4.
  assert.strictEqual(f(n('T4A')), false, 'T4A : autre feuillet, décision non prise');

  // (c bis) ⚠️ LA FRONTIÈRE QUE MARC A POSÉE, trouvée par la revue structure. « Attestation de
  //     salaire », « Assurance salaire », « Preuve de salaire » sont des documents de CARRIÈRE — du
  //     même genre que l'attestation d'emploi qu'il garde en `05`. Or `schemaNommage_` les renomme
  //     TOUS en « Paie » : le mot qui disqualifie a disparu du nom, et il a disparu pour les AUTRES
  //     consommateurs du prédicat partagé aussi. Le type BRUT est le seul endroit où il existe
  //     encore. Sans ce test, un document que Marc veut en `05` partait en Finances, renommé
  //     « Paie », indistinguable d'un vrai bulletin.
  for (const t of ['Attestation de salaire', 'Assurance salaire', 'Preuve de salaire',
    'Demande d\'assurance salaire', 'Certificat de salaire', 'Réclamation assurance salaire']) {
    assert.strictEqual(f('2026-09_Paie_Alphatek.pdf', t), false, t + ' doit rester hors des revenus');
  }
  // …et la disqualification ne mord QUE sur le type brut : un vrai bulletin reste un vrai bulletin.
  assert.strictEqual(f('2026-09_Paie_Alphatek.pdf', 'Bulletin de salaire'), true);
  assert.strictEqual(f('2026-09_Paie_Alphatek.pdf', ''), true, 'sans type brut : comportement d\'avant');

  // (d) Ce que Marc laisse en `05`, explicitement.
  for (const t of ['Attestation d\'emploi', 'Lettre d\'embauche', 'Contrat de travail',
    'CV', 'Lettre de motivation', 'Document professionnel']) {
    assert.strictEqual(f(n(t)), false, t);
  }
  // (e) ⚠️ RL-31 EXCLU : émis par le PROPRIÉTAIRE (occupation d'un logement), pas par l'employeur.
  //     Marc a nommé le RL-1. Le prédicat partagé `estFeuilletFiscalReset_` couvre les deux : la
  //     soustraction est EXPLICITE, et elle se teste.
  assert.strictEqual(f(n('Relevé 31')), false, 'RL-31 : propriétaire, pas employeur');
  assert.strictEqual(f('2026_Relevé_X.pdf', 'Relevé 31'), false, 'RL-31 exclu AUSSI par le type brut');
  assert.strictEqual(ctx.estFeuilletFiscalReset_('releve 31'), true,
    'le prédicat PARTAGÉ le couvre toujours — c\'est bien une soustraction, pas une divergence');
  // (f) Et un relevé BANCAIRE n'est pas un revenu d'employeur : `estReleveDePaie_` est volontairement
  //     ABSENT de ce prédicat (ADR-0044 D9 n'est sûr qu'avec un employeur garanti, ce que le flux n'a pas).
  assert.strictEqual(f('2026-06-30_Relevé bancaire_Bellerives.pdf'), false);
  assert.strictEqual(f('2026-06-30_Relevé_Bellerives.pdf'), false);
});

test('ADR-0058 : le FLUX envoie la paie en Finances même quand le LLM répond « 05 »', () => {
  // Le défaut vécu, reproduit : `2026-09_Paie_Alphatek Inc..pdf` classé le 14/09 dans
  // `05 · Emploi & carrière/Employeurs/Alphatek`. Une paie NOMME un employeur, donc le LLM répond
  // « 05 » — ce n'est pas absurde, c'est la mauvaise règle pour ce type-là.
  const r = require('./harness').load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs',
    'Missions.gs', 'Router.gs', 'Llm.gs']);
  const plan = (type) => r.planRoutageV2_(
    { domaine: '05 · Carrière', type_doc: type, emetteur: 'Alphatek', sousDossier: 'Alphatek' },
    { nomFichier: 'x.pdf' }, '2026-09-01', '.pdf', {});
  const paie = plan('Paie');
  assert.strictEqual(paie.domaine, r.CONFIG.DOMAINE_REVENUS, 'la paie quitte 05 : ' + paie.domaine);
  assert.ok(paie.sousDossier.indexOf('Revenus & paie') === 0, paie.sousDossier);
  const t4 = plan('T4');
  assert.strictEqual(t4.domaine, r.CONFIG.DOMAINE_REVENUS, 'le T4 aussi : ' + t4.domaine);
  assert.ok(t4.sousDossier.indexOf('Impôts & déclarations') === 0, t4.sousDossier);
  const rl1 = plan('Relevé 1');
  assert.strictEqual(rl1.domaine, r.CONFIG.DOMAINE_REVENUS, 'le RL-1 aussi : ' + rl1.domaine);
  // ⚠️ CORRIGÉ SUITE À LA REVUE STRUCTURE : le numéro du feuillet est désormais CONSERVÉ au
  // renommage (deux règles dans `schemaNommage_`, avant la règle « relevé » générique), donc le
  // RL-1 atterrit dans le bon sous-dossier FISCAL. Avant ce correctif il tombait dans
  // `Revenus & paie/<employeur>` — ou, employeur hors table, dans `Relevés/AAAA`, c'est-à-dire
  // PARMI LES RELEVÉS BANCAIRES, ce que le code lui-même déclare interdit.
  assert.ok(rl1.sousDossier.indexOf('Impôts & déclarations') === 0, rl1.sousDossier);
  // …et l'employeur HORS TABLE atterrit au même endroit : la cible ne dépend plus de l'employeur.
  const rl1Inconnu = r.planRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'Relevé 1', emetteur: 'Entreprise Inconnue SARL' },
    { nomFichier: 'x.pdf' }, '2026-09-01', '.pdf', {});
  assert.ok(rl1Inconnu.sousDossier.indexOf('Impôts & déclarations') === 0, rl1Inconnu.sousDossier);
  // …et ce que Marc garde en `05` y RESTE : la règle n'élargit rien.
  const attest = plan('Attestation d\'emploi');
  assert.strictEqual(attest.domaine, '05 · Carrière', attest.domaine);
  // Un « Avis de paiement » n'est ni une paie ni une facture : il reste en 05. Un « Reçu de paiement », lui,
  // n'est PAS une paie (Revenus & paie reste faux), mais la règle stricte des factures (ADR-0080) l'envoie
  // dans Reçus & factures (jamais Revenus & paie).
  const avis = plan('Avis de paiement');
  assert.strictEqual(avis.domaine, '05 · Carrière', 'un « paiement » n\'est pas une paie : ' + avis.domaine);
  const recu = plan('Reçu de paiement');
  assert.strictEqual(recu.domaine, '02 · Finances', recu.domaine);
  assert.strictEqual(recu.sousDossier, 'Reçus & factures/2026');
});

test('ADR-0058 : le NOM d\'un feuillet porte son identité et son année (sinon il finit chez les paies)', () => {
  // ⚠️ Mutation SURVIVANTE au premier jet : retirer la règle de nommage du T4 ne cassait rien, parce
  // que `T4` et `Feuillet T4` se routent déjà bien dans `02`. Ce que la règle achète VRAIMENT, et
  // qui n'était testé nulle part : (a) les graphies où le numéro est noyé, (b) la GRANULARITÉ.
  const r = require('./harness').load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs',
    'Missions.gs', 'Router.gs', 'Llm.gs']);
  const nom = (type) => r.nommerDocument_(
    { domaine: '05 · Carrière', type_doc: type, emetteur: 'Alphatek' }, '2026-09-01', '.pdf');
  // (a) « Relevé T4 » : sans la règle, `schemaNommage_` le réduit à « Relevé » — le T4 disparaît et
  //     le fichier part chez les PAIES au lieu des impôts. Même piège que « Relevé 1 ».
  assert.strictEqual(r.cheminCibleReset_('02 · Finances', nom('Relevé T4')).indexOf('Impôts & déclarations'), 0,
    nom('Relevé T4') + ' → ' + r.cheminCibleReset_('02 · Finances', nom('Relevé T4')));
  assert.strictEqual(r.cheminCibleReset_('02 · Finances', nom('Relevé 1')).indexOf('Impôts & déclarations'), 0);
  // (b) GRANULARITÉ : un feuillet est ANNUEL. Sans la règle, un « T4 » nu était daté au JOUR —
  //     `2026-09-01_T4_…` — ce qui n'a aucun sens pour un document qui couvre l'année entière, et
  //     produit un nom différent selon le jour où il arrive.
  for (const t of ['T4', 'Feuillet T4', 'Relevé T4', 'Relevé 1', 'RL-1']) {
    assert.match(nom(t), /^2026_/, t + ' doit être daté à l\'ANNÉE : ' + nom(t));
  }
  // …et un relevé BANCAIRE reste mensuel : la règle du feuillet passe avant, sans l'écraser.
  assert.match(nom('Relevé bancaire'), /^2026-09_/, nom('Relevé bancaire'));
});

test('ADR-0058 : une seule règle, deux consommateurs — le domaine forcé est CELUI que la table sait router', () => {
  // Tripwire de convergence NON tautologique : on ne compare pas le forçage à lui-même, on vérifie
  // que le domaine choisi est une CLÉ RÉELLE de la table de routage. Un libellé qui dérive ne rend
  // pas une erreur — il rend `undefined`, c'est-à-dire une cible VIDE (§9).
  assert.ok(ctx.structureCibleReset_()[ctx.CONFIG.DOMAINE_REVENUS],
    'DOMAINE_REVENUS doit être une clé de STRUCTURE_CIBLE_RESET');
  assert.ok(ctx.CONFIG.DOMAINES[ctx.CONFIG.DOMAINE_REVENUS],
    'DOMAINE_REVENUS doit être un domaine FIXE (avec un ID), jamais un domaine AUTO');
  // Et la table sait effectivement placer une paie dans ce domaine — sinon le forçage l'enverrait
  // à plat à la racine de `02`, ce qui serait une régression silencieuse.
  const cible = ctx.cheminCibleReset_(ctx.CONFIG.DOMAINE_REVENUS, '2026-09-01_Paie_Alphatek.pdf');
  assert.ok(cible && cible.indexOf('Revenus & paie') === 0, 'cible : ' + cible);
});
