'use strict';
/**
 * Couverture Tiers 5 de `Pipeline.gs` :
 *  - Sanctuaire R6 (`04 · Immigration`, zone protégée) : fast-path photo floue (< 20 car.) et garde
 *    post-LLM étendus à l'expéditeur, au sujet et à `CONFIG.DOMAINES_PROTEGES`.
 *  - Chemin nominal `ANALYSE_V2 = true` jusqu'à `deciderRoutageV2_` et `creerRaccourcisEntites_`.
 *  - Échec de `src.placer()` retournant `''` (`!fileId`) → `gererEchec_` sans `indexAjouter_`.
 *  - `gererEchec_` : incréments `1..QUARANTAINE_MAX` → quarantaine + `notifierEchec_` ; `catch (e)`
 *    de `traiterDocument_` (y compris repli `notifierEchec_` si `gererEchec_` lève).
 *  - `empreinteBlob_` : octets signés négatifs (`& 0xFF`) et repli `''` sur exception.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function creerContextePipeline(opts) {
  opts = opts || {};
  const journaux = { info: [], erreur: [], alertes: [] };
  const appels = { places: [], index: [], raccourcis: [], classif: 0, routageV2: [], echecs: 0 };
  const c = load(['Config.gs', 'Prefiltre.gs', 'Router.gs', 'Pipeline.gs'], {
    journalInfo_: (src, msg) => journaux.info.push({ src, msg }),
    journalErreur_: (src, msg) => journaux.erreur.push({ src, msg }),
    notifierEchec_: (src, msg) => journaux.alertes.push({ src, msg }),
    estPannePlateforme_: () => !!opts.pannePlateforme,
    indexContient_: () => !!opts.dejaIndexe,
    indexAjouter_: (cle, res, emp, trace) => appels.index.push({ cle, res, emp, trace }),
    incrementerEchec_: () => { appels.echecs++; return appels.echecs; },
    estDoublon_: () => !!opts.estDoublon,
    porteurVivantDe_: () => opts.porteur || { vivant: false, fileId: '' },
    extraireTexte_: () => {
      if (opts.ocrJette) throw new Error('panne OCR simulée');
      return opts.extrait !== undefined ? opts.extrait : 'Facture mensuelle exemple';
    },
    creerRaccourci_: (fid, did, nom) => {
      appels.raccourcis.push({ fid, did, nom });
      return opts.raccourciOk ? opts.raccourciOk(did) : true;
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      computeDigest: () => [1, 2, 3, 4],
      formatDate: (d) => d.toISOString().slice(0, 10),
    },
    Session: { getScriptTimeZone: () => 'UTC' },
  });
  c.dossierMedias_ = () => ({ getId: () => 'DOSSIER_MEDIAS' });
  c.dossierTechnique_ = () => ({ getId: () => 'DOSSIER_TECH' });
  c.dossierDoublons_ = () => ({ getId: () => 'DOSSIER_DOUBLONS' });
  c.CONFIG.ANALYSE_V2 = opts.analyseV2 !== undefined ? opts.analyseV2 : true;
  c.enrichirClassifDepuisNom_ = () => {};
  c.classifier_ = () => {
    appels.classif++;
    return opts.classif !== undefined ? opts.classif : {
      domaine: '02 · Finances',
      type_doc: 'Facture',
      emetteur: 'Fournisseur Exemple',
      confiance: 0.9,
      sensible: false,
    };
  };
  if (opts.deciderRoutageV2) {
    c.deciderRoutageV2_ = (classif, meta, dateRef, ext) => {
      appels.routageV2.push({ classif, meta, dateRef, ext });
      return opts.deciderRoutageV2(classif, meta, dateRef, ext);
    };
  }
  const src = Object.assign({
    cle: 'gmail|MSG_1|0|piece.jpg|128',
    nom: 'IMG_20260510.jpg',
    taille: 128,
    expediteur: 'Service <service@exemple.test>',
    sujet: 'Document transmis',
    date: new Date('2026-05-10T00:00:00Z'),
    blob: () => ({ getBytes: () => [10, 20, 30] }),
    placer: (dossierId, nom) => {
      appels.places.push({ dossierId, nom });
      return opts.placerRend !== undefined ? opts.placerRend : 'FILE_ID_1';
    },
  }, opts.src || {});
  return { c, src, appels, journaux };
}

test('R6 Sanctuaire — fast-path photo floue (< 20 car.) avec expéditeur ou sujet protégé → jamais _Médias sans LLM', () => {
  const { c, src, appels } = creerContextePipeline({
    extrait: 'Page 1',
    classif: null, // stoppe après appel LLM pour isoler le fast-path
    src: {
      nom: 'IMG_9999.jpg',
      expediteur: 'Portail IRCC <avis@ircc-exemple.test>',
      sujet: 'Mise à jour de votre demande de passeport',
    },
  });
  c.traiterDocument_(src);
  assert.strictEqual(appels.classif, 1, 'le LLM doit être consulté malgré un extrait OCR < 20 car.');
  assert.strictEqual(appels.places.length, 0, 'aucun routage vers _Médias');
});

test('R6 Sanctuaire — garde post-LLM : photo en domaine 04 · Immigration (sensible: false, confiance basse) ou sujet protégé → jamais _Médias', () => {
  const casDomaineProtege = creerContextePipeline({
    analyseV2: true,
    extrait: 'Numérisation partielle suffisamment longue pour passer le fast-path.',
    classif: { domaine: '04 · Immigration', type_doc: 'Attestation', emetteur: 'IRCC', confiance: 0.45, sensible: false },
    deciderRoutageV2: () => ({
      statut: 'classé', domaine: '04 · Immigration', chemin: '04 · Immigration/Demandes',
      nom: '2026-05-10_Attestation_IRCC.jpg', dossierId: 'DOSSIER_04',
    }),
    src: { nom: 'IMG_20260510.jpg', expediteur: 'Portail <avis@exemple.test>', sujet: 'Avis dossier' },
  });
  casDomaineProtege.c.traiterDocument_(casDomaineProtege.src);
  assert.deepStrictEqual(casDomaineProtege.appels.places, [{ dossierId: 'DOSSIER_04', nom: '2026-05-10_Attestation_IRCC.jpg' }]);
  assert.strictEqual(casDomaineProtege.appels.index[0].res.domaine, '04 · Immigration');

  const casSujetProtege = creerContextePipeline({
    analyseV2: true,
    extrait: 'Document numérisé sans mot-clé explicite dans le texte extrait.',
    classif: { domaine: '02 · Finances', type_doc: 'Avis', emetteur: 'Agence', confiance: 0.4, sensible: false },
    deciderRoutageV2: () => ({
      statut: 'classé', domaine: '02 · Finances', chemin: '02 · Finances/Impôts',
      nom: '2026-05-10_Avis_Agence.jpg', dossierId: 'DOSSIER_02',
    }),
    src: { nom: 'IMG_20260511.jpg', expediteur: 'Centre fiscal <impots@fisc-exemple.test>', sujet: 'Cotisation annuelle' },
  });
  casSujetProtege.c.traiterDocument_(casSujetProtege.src);
  assert.deepStrictEqual(casSujetProtege.appels.places, [{ dossierId: 'DOSSIER_02', nom: '2026-05-10_Avis_Agence.jpg' }]);
});

test('Pipeline ANALYSE_V2=true : routage v2 nominal + création des raccourcis multi-entités', () => {
  const { c, src, appels, journaux } = creerContextePipeline({
    analyseV2: true,
    extrait: 'Facture détaillée Hydro-Exemple 120,00 $ CAD pour entretien.',
    classif: { domaine: '03 · Logement', type_doc: 'Facture', emetteur: 'Hydro-Exemple', confiance: 0.94, sensible: false },
    deciderRoutageV2: () => ({
      statut: 'classé',
      domaine: '03 · Logement',
      chemin: '03 · Logement/Énergie',
      nom: '2026-05-10_Facture_Hydro-Exemple.pdf',
      dossierId: 'DOSSIER_03',
      autresEntites: ['ENTITE_B', 'ENTITE_C'],
    }),
    raccourciOk: (did) => did === 'ENTITE_B', // un seul réussit sur deux
    src: { nom: 'facture.pdf' },
  });
  c.traiterDocument_(src);
  assert.strictEqual(appels.routageV2.length, 1);
  assert.strictEqual(appels.routageV2[0].meta.emetteur, 'Hydro-Exemple');
  assert.deepStrictEqual(appels.raccourcis, [
    { fid: 'FILE_ID_1', did: 'ENTITE_B', nom: '2026-05-10_Facture_Hydro-Exemple.pdf' },
    { fid: 'FILE_ID_1', did: 'ENTITE_C', nom: '2026-05-10_Facture_Hydro-Exemple.pdf' },
  ]);
  assert.ok(journaux.info.some((j) => j.msg.includes('1 raccourci(s) multi-entités créé(s)')));
  assert.strictEqual(appels.index.length, 1);
  assert.strictEqual(appels.index[0].res.fileId, 'FILE_ID_1');
});

test('Pipeline : échec de src.placer() retournant "" (normal, technique, média, doublon) → gererEchec_ sans indexAjouter_', () => {
  const normal = creerContextePipeline({
    analyseV2: true,
    placerRend: '',
    deciderRoutageV2: () => ({
      statut: 'classé', domaine: '02 · Finances', chemin: '02 · Finances',
      nom: 'doc.pdf', dossierId: 'DOSSIER_02',
    }),
    src: { nom: 'doc.pdf' },
  });
  normal.c.traiterDocument_(normal.src);
  assert.strictEqual(normal.appels.index.length, 0, 'aucune inscription Index quand fileId est vide');
  assert.ok(normal.journaux.erreur.some((j) => j.msg.includes('placement Drive échoué')));

  const tech = creerContextePipeline({ placerRend: '', src: { nom: 'script.py' } });
  tech.c.traiterDocument_(tech.src);
  assert.strictEqual(tech.appels.index.length, 0);
  assert.ok(tech.journaux.erreur.some((j) => j.msg.includes('placement technique échoué')));

  const media = creerContextePipeline({ placerRend: '', src: { nom: 'clip.mp4' } });
  media.c.traiterDocument_(media.src);
  assert.strictEqual(media.appels.index.length, 0);
  assert.ok(media.journaux.erreur.some((j) => j.msg.includes('placement média échoué')));
});

test('gererEchec_ et catch(e) de traiterDocument_ : quarantaine à QUARANTAINE_MAX + repli notifierEchec_', () => {
  const { c, src, appels, journaux } = creerContextePipeline({});
  const max = c.CONFIG.QUARANTAINE_MAX;
  for (let i = 1; i < max; i++) {
    c.gererEchec_(src, 'panne transitoire ' + i);
  }
  assert.strictEqual(appels.index.length, 0, 'pas encore en quarantaine sous le seuil');
  assert.strictEqual(journaux.alertes.length, 0);
  assert.strictEqual(journaux.erreur.length, max - 1);

  c.gererEchec_(src, 'dernier échec');
  assert.strictEqual(appels.index.length, 1);
  assert.strictEqual(appels.index[0].res.statut, 'quarantaine');
  assert.strictEqual(journaux.alertes.length, 1);
  assert.match(journaux.alertes[0].msg, /mis en quarantaine/);

  // Erreur inattendue dans traiterDocument_ -> gererEchec_, et si gererEchec_ lève -> notifierEchec_.
  const casCatch = creerContextePipeline({ ocrJette: true, src: { nom: 'doc.pdf' } });
  casCatch.c.traiterDocument_(casCatch.src);
  assert.ok(casCatch.journaux.erreur.some((j) => j.msg.includes('panne OCR simulée')));

  const casDoubleEchec = creerContextePipeline({ ocrJette: true, src: { nom: 'doc.pdf' } });
  casDoubleEchec.c.gererEchec_ = () => { throw new Error('Sheet HS'); };
  casDoubleEchec.c.traiterDocument_(casDoubleEchec.src);
  assert.strictEqual(casDoubleEchec.journaux.alertes.length, 1);
  assert.match(casDoubleEchec.journaux.alertes[0].msg, /panne OCR simulée.*Sheet HS/);
});

test('empreinteBlob_ : octets signés négatifs (& 0xFF) et repli "" sur exception', () => {
  const c = load(['Config.gs', 'Pipeline.gs'], {
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      computeDigest: () => [-128, 0, 15, 16, -1],
    },
  });
  assert.strictEqual(c.empreinteBlob_({ getBytes: () => [1] }), '80000f10ff');

  c.Utilities.computeDigest = () => { throw new Error('mémoire insuffisante'); };
  assert.strictEqual(c.empreinteBlob_({ getBytes: () => [1] }), '');
});

test('Pipeline Lot 3A : appelle enregistrerSignalDepuisPipeline_ sans bloquer en cas d erreur', () => {
  const sigAppels = [];
  const casOk = creerContextePipeline({
    analyseV2: true,
    classif: { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Hydro-Exemple', date_expiration: '2027-01-01', montant: 120, confiance: 0.9, sensible: false },
    deciderRoutageV2: () => ({ statut: 'classé', domaine: '02 · Finances', chemin: '02 · Finances/Reçus', nom: '2026-05-10_Facture_Hydro-Exemple.pdf', dossierId: 'DOSSIER_02' }),
    src: { nom: 'facture.pdf' },
  });
  casOk.c.enregistrerSignalDepuisPipeline_ = (src, classif, decision) => sigAppels.push({ src, classif, decision });
  casOk.c.traiterDocument_(casOk.src);
  assert.strictEqual(sigAppels.length, 1);
  assert.strictEqual(sigAppels[0].decision.fileId, 'FILE_ID_1');

  const casErr = creerContextePipeline({
    analyseV2: true,
    deciderRoutageV2: () => ({ statut: 'classé', domaine: '02 · Finances', chemin: '02 · Finances/Reçus', nom: 'doc.pdf', dossierId: 'DOSSIER_02' }),
    src: { nom: 'doc.pdf' },
  });
  casErr.c.enregistrerSignalDepuisPipeline_ = () => { throw new Error('Signaux HS'); };
  casErr.c.traiterDocument_(casErr.src);
  assert.strictEqual(casErr.appels.index.length, 1, 'Index et Pipeline restent intacts si Signaux lève');
});
