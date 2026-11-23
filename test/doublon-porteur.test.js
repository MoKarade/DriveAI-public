'use strict';
/**
 * DriveAI#809 / ADR-0070 — une empreinte « déjà vue » ne vaut doublon que si un exemplaire existe ENCORE.
 * Un fichier classé puis corbeillé laissait son empreinte à l'Index : le même contenu redéposé partait en
 * `_Doublons` sans aucune copie classée. Dans le doute, aucun exemplaire n'est nommé ; depuis l'ADR-0077
 * (`test/doublon-taille.test.js`) le pipeline n'écarte rien sans exemplaire prouvé.
 *
 * Trois étages testés :
 *   - PUR : `candidatsPorteurs_`, `decisionPorteurVivant_` ;
 *   - Drive (lecture seule, `files.get` par REST depuis DriveAI#897) : `etatPorteurDoublon_` (pure), `etatPorteurBorne_` (mémo et plafond) ;
 *   - CHEMIN : `traiterDocument_` envoie en `_Doublons` ou poursuit selon l'état du porteur.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ID_A = 'AAAAAAAAAAAAAAAAAAAAAAAA'; // 24 car. : forme d'un fileId Drive plausible
const ID_B = 'BBBBBBBBBBBBBBBBBBBBBBBB';
const ID_C = 'CCCCCCCCCCCCCCCCCCCCCCCC';
const ID_DOUBLONS = 'DOSSIER_DOUBLONS_0000000';

const ligne = (cle, statut, empreinte, fileId) => ({ cle, statut, empreinte, fileId });
/** Égalité de FORME : un objet rendu par le bac à sable `vm` n'a pas le même prototype `Object` que celui du test. */
const memeForme = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);

/* ---------- PUR : candidats ---------- */

test('candidatsPorteurs_ : les exemplaires de CETTE empreinte, les plus récents d\'abord, sans doublons de fileId', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const lignes = [
    ligne('drive|' + ID_A, 'classé', 'EMP', ID_A),
    ligne('drive|' + ID_C, 'classé', 'AUTRE', ID_C),
    ligne('drive|' + ID_B, 'classé', 'EMP', ID_B),
    ligne('drive|' + ID_B + '#2', 'classé', 'EMP', ID_B), // même fichier relu : un seul candidat
  ];
  const c = ctx.candidatsPorteurs_(lignes, 'EMP');
  assert.strictEqual(JSON.stringify(c.fileIds), JSON.stringify([ID_B, ID_A]));
  assert.strictEqual(c.inconnu, false);
});

test('candidatsPorteurs_ : une ligne au statut « doublon » n\'est PAS un exemplaire classé', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const c = ctx.candidatsPorteurs_([ligne('drive|' + ID_A, 'doublon', 'EMP', ID_A)], 'EMP');
  assert.strictEqual(c.fileIds.length, 0);
  assert.strictEqual(c.inconnu, false);
});

test('candidatsPorteurs_ : ligne sans fileId déductible (ancienne pièce jointe) → porteur INCONNU', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const c = ctx.candidatsPorteurs_([ligne('gmail|msg1|piece', 'classé', 'EMP', '')], 'EMP');
  assert.strictEqual(c.inconnu, true, 'on ne peut pas dire que cet exemplaire a disparu');
});

/* ---------- PUR : décision ---------- */

test('decisionPorteurVivant_ : `vivant` faux SEULEMENT si tous les exemplaires sont prouvés morts', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const etat = (m) => (id) => m[id];
  const d = (cands, m, max) => ctx.decisionPorteurVivant_(cands, etat(m), max == null ? 5 : max).vivant;

  assert.strictEqual(d({ fileIds: [ID_A, ID_B], inconnu: false }, { [ID_A]: 'mort', [ID_B]: 'mort' }), false, 'tous morts');
  assert.strictEqual(d({ fileIds: [ID_A, ID_B], inconnu: false }, { [ID_A]: 'mort', [ID_B]: 'vivant' }), true, 'un vivant suffit');
  assert.strictEqual(d({ fileIds: [ID_A, ID_B], inconnu: false }, { [ID_A]: 'mort', [ID_B]: 'inconnu' }), true, 'un inconnu ne prouve rien');
  assert.strictEqual(d({ fileIds: [ID_A], inconnu: true }, { [ID_A]: 'mort' }), true, 'un porteur inconnu ligne à l\'Index');
  assert.strictEqual(d({ fileIds: [], inconnu: false }, {}), true, 'aucun candidat identifiable : doute (vivant, personne nommé)');
  assert.strictEqual(d({ fileIds: [ID_A, ID_B, ID_C], inconnu: false }, { [ID_A]: 'mort', [ID_B]: 'mort', [ID_C]: 'mort' }, 2), true,
    'au-delà du plafond de candidats : on ne tente pas de tous les prouver');
});

test('decisionPorteurVivant_ (ADR-0077) : nomme l\'exemplaire PROUVÉ vivant, et personne dans le doute', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const etat = (m) => (id) => m[id];
  const d = (cands, m, max) => ctx.decisionPorteurVivant_(cands, etat(m), max == null ? 5 : max);

  memeForme(d({ fileIds: [ID_A, ID_B], inconnu: false }, { [ID_A]: 'mort', [ID_B]: 'vivant' }),
    { vivant: true, fileId: ID_B }, 'le premier exemplaire prouvé vivant est nommé');
  memeForme(d({ fileIds: [ID_A, ID_B], inconnu: true }, { [ID_A]: 'mort', [ID_B]: 'vivant' }),
    { vivant: true, fileId: ID_B }, 'un porteur inconnu n\'empêche pas de trouver un vivant parmi les connus');
  memeForme(d({ fileIds: [ID_A, ID_B], inconnu: false }, { [ID_A]: 'inconnu', [ID_B]: 'vivant' }),
    { vivant: true, fileId: ID_B }, 'un exemplaire récent illisible (supprimé pour de bon) ne masque pas un vivant plus ancien');
  memeForme(d({ fileIds: [ID_A, ID_B], inconnu: false }, { [ID_A]: 'inconnu', [ID_B]: 'mort' }),
    { vivant: true, fileId: '' }, 'inconnu puis mort : doute, personne n\'est nommé');
  memeForme(d({ fileIds: [ID_A], inconnu: true }, { [ID_A]: 'mort' }),
    { vivant: true, fileId: '' }, 'seul un porteur inconnu reste : doute');
  memeForme(d({ fileIds: [], inconnu: false }, {}), { vivant: true, fileId: '' }, 'aucun candidat : doute');
  memeForme(d({ fileIds: [ID_A, ID_B, ID_C], inconnu: false }, { [ID_A]: 'mort', [ID_B]: 'vivant' }, 2),
    { vivant: true, fileId: ID_B }, 'au-delà du plafond : les `max` plus récents sont quand même contrôlés, le vivant trouvé est nommé');
  memeForme(d({ fileIds: [ID_A, ID_B, ID_C], inconnu: false }, { [ID_A]: 'mort', [ID_B]: 'mort', [ID_C]: 'vivant' }, 2),
    { vivant: true, fileId: '' }, 'au-delà du plafond, aucun vivant parmi les contrôlés : doute (jamais « tous morts »)');
  memeForme(d({ fileIds: [ID_A], inconnu: false }, { [ID_A]: 'mort' }), { vivant: false, fileId: '' }, 'tous morts');
});

test('decisionPorteurVivant_ : s\'arrête au premier exemplaire vivant (aucun contrôle Drive de plus)', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const vus = [];
  ctx.decisionPorteurVivant_({ fileIds: [ID_A, ID_B, ID_C], inconnu: false }, (id) => { vus.push(id); return 'vivant'; }, 5);
  assert.strictEqual(JSON.stringify(vus), JSON.stringify([ID_A]));
  const vus2 = [];
  ctx.decisionPorteurVivant_({ fileIds: [ID_A, ID_B, ID_C], inconnu: false }, (id) => { vus2.push(id); return 'mort'; }, 2);
  assert.strictEqual(JSON.stringify(vus2), JSON.stringify([ID_A, ID_B]), 'jamais plus de `max` contrôles pour une empreinte');
});

/* ---------- Drive : état d'un exemplaire ---------- */

/** Métadonnées Drive telles que `metaFichierRest_` les rend (DriveAI#897 : preuve de vie et empreinte en un `files.get`). */
function meta(o) {
  return { taille: o.taille === undefined ? 10 : o.taille, md5: o.md5 || 'EMP', corbeille: !!o.corbeille, parents: o.parents || [] };
}

test('etatPorteurDoublon_ (PURE, #897) : corbeille → mort ; seul parent _Doublons → mort ; ailleurs → vivant', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  assert.strictEqual(ctx.etatPorteurDoublon_(meta({ corbeille: true, parents: ['RANGEMENT'] }), ID_DOUBLONS), 'mort');
  assert.strictEqual(ctx.etatPorteurDoublon_(meta({ parents: [ID_DOUBLONS] }), ID_DOUBLONS), 'mort');
  assert.strictEqual(ctx.etatPorteurDoublon_(meta({ parents: ['RANGEMENT'] }), ID_DOUBLONS), 'vivant');
});

test('etatPorteurDoublon_ : un exemplaire aussi rangé AILLEURS que dans _Doublons est vivant', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  assert.strictEqual(ctx.etatPorteurDoublon_(meta({ parents: [ID_DOUBLONS, 'RANGEMENT'] }), ID_DOUBLONS), 'vivant');
});

test('etatPorteurDoublon_ : _Doublons introuvable → seule la corbeille prouve la mort ; sans parent connu → vivant', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  assert.strictEqual(ctx.etatPorteurDoublon_(meta({ parents: [ID_DOUBLONS] }), ''), 'vivant');
  assert.strictEqual(ctx.etatPorteurDoublon_(meta({ parents: [] }), ID_DOUBLONS), 'vivant', 'orphelin ou « partagé avec moi » : pas prouvé mort');
  assert.strictEqual(ctx.etatPorteurDoublon_({ md5: 'EMP' }, ID_DOUBLONS), 'vivant', 'champs absents : rien ne prouve la mort');
});

test('etatPorteurDoublon_ : métadonnées illisibles (null : 404, 403, réseau) → inconnu, JAMAIS mort', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  assert.strictEqual(ctx.etatPorteurDoublon_(null, ID_DOUBLONS), 'inconnu');
  assert.strictEqual(ctx.etatPorteurDoublon_(undefined, ID_DOUBLONS), 'inconnu');
});

test('etatPorteurBorne_ : UN files.get par fileId et par run, plafonné à PORTEUR_VERIF_MAX_RUN, métadonnées gardées pour le md5', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  ctx.idDoublonsSansCreer_ = () => ID_DOUBLONS;
  let lectures = 0;
  ctx.metaFichierRest_ = () => { lectures++; return meta({ corbeille: true }); };
  ctx.reinitialiserIndexCache_();

  assert.strictEqual(ctx.etatPorteurBorne_(ID_A), 'mort');
  assert.strictEqual(ctx.etatPorteurBorne_(ID_A), 'mort');
  assert.strictEqual(lectures, 1, 'le même fileId n\'est lu qu\'une fois par run');
  memeForme(ctx.metaPorteurRun_(ID_A), meta({ corbeille: true }));
  assert.strictEqual(lectures, 1, 'le md5 vient de la MÊME lecture que la preuve de vie (#897)');

  const plafond = ctx.CONFIG.PORTEUR_VERIF_MAX_RUN;
  for (let i = 1; i < plafond; i++) ctx.etatPorteurBorne_('FICHIER_' + String(i).padStart(16, '0'));
  assert.strictEqual(lectures, plafond, 'le plafond est atteint');
  assert.strictEqual(ctx.etatPorteurBorne_('ENCORE_UN_AUTRE_FICHIER_0'), 'inconnu', 'budget épuisé → inconnu (non prouvé : traité normalement, ADR-0077)');
  assert.strictEqual(lectures, plafond, 'aucune lecture au-delà du plafond');

  ctx.reinitialiserIndexCache_();
  assert.strictEqual(ctx.etatPorteurBorne_('ENCORE_UN_AUTRE_FICHIER_0'), 'mort', 'nouveau run, budget neuf');
  assert.strictEqual(lectures, plafond + 1);
});

/* ---------- porteurVivantDe_ : lecture de l'Index, une fois par run ---------- */

/** Feuille « Index » minimale : colonnes A (clé), F (statut), G (empreinte), I (fileId). */
function feuilleIndex(lignes, compteur) {
  return () => ({
    getLastRow: () => lignes.length + 1,
    getRange: (l, c, n) => ({
      getValues: () => {
        if (compteur) compteur.lectures++;
        return lignes.slice(l - 2, l - 2 + n).map((r) => [({ 1: r.cle, 6: r.statut, 7: r.empreinte, 9: r.fileId })[c]]);
      },
    }),
  });
}

test('porteurVivantDe_ : tous les exemplaires corbeillés → pas vivant (le contenu sera traité normalement)', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  ctx.journalInfo_ = () => {};
  ctx.idDoublonsSansCreer_ = () => ID_DOUBLONS;
  ctx.feuille_ = feuilleIndex([ligne('drive|' + ID_A, 'classé', 'EMP', ID_A)]);
  ctx.metaFichierRest_ = () => meta({ corbeille: true });
  ctx.reinitialiserIndexCache_();
  memeForme(ctx.porteurVivantDe_('EMP'), { vivant: false, fileId: '' });
});

test('porteurVivantDe_ : exemplaire vivant → nommé ; empreinte sans ligne classée → doute, personne', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  ctx.journalInfo_ = () => {};
  ctx.idDoublonsSansCreer_ = () => ID_DOUBLONS;
  ctx.feuille_ = feuilleIndex([ligne('drive|' + ID_A, 'classé', 'EMP', ID_A)]);
  let lectures = 0;
  ctx.metaFichierRest_ = () => { lectures++; return meta({ parents: ['RANGEMENT'], md5: 'EMP', taille: 48213 }); };
  ctx.reinitialiserIndexCache_();
  memeForme(ctx.porteurVivantDe_('EMP'), { vivant: true, fileId: ID_A, meta: meta({ parents: ['RANGEMENT'], md5: 'EMP', taille: 48213 }) }, '#897 : les métadonnées de l\'exemplaire voyagent avec lui');
  assert.strictEqual(lectures, 1, 'preuve de vie et empreinte : UN files.get');
  memeForme(ctx.porteurVivantDe_('INCONNUE'), { vivant: true, fileId: '' }, 'personne nommé : pas de meta');
});

test('porteurVivantDe_ : l\'Index n\'est lu QU\'UNE fois par run, quel que soit le nombre de doublons', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  ctx.journalInfo_ = () => {};
  ctx.idDoublonsSansCreer_ = () => ID_DOUBLONS;
  const compteur = { lectures: 0 };
  ctx.feuille_ = feuilleIndex([ligne('drive|' + ID_A, 'classé', 'EMP', ID_A)], compteur);
  ctx.metaFichierRest_ = () => meta({ corbeille: true });
  ctx.reinitialiserIndexCache_();
  ctx.porteurVivantDe_('EMP');
  const apres1 = compteur.lectures;
  ctx.porteurVivantDe_('EMP');
  ctx.porteurVivantDe_('AUTRE');
  assert.ok(apres1 > 0, 'témoin : la première question lit bien l\'Index');
  assert.strictEqual(compteur.lectures, apres1, 'les suivantes réutilisent la lecture du run');
});

test('porteurVivantDe_ : Index illisible → doute (aucun exemplaire prouvé), erreur journalisée, ne lève pas', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const erreurs = [];
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = (src, msg) => erreurs.push(msg);
  ctx.feuille_ = () => { throw new Error('Sheet indisponible'); };
  ctx.reinitialiserIndexCache_();
  memeForme(ctx.porteurVivantDe_('EMP'), { vivant: true, fileId: '' });
  assert.strictEqual(erreurs.length, 1);
  assert.ok(/aucun exemplaire prouvé/.test(erreurs[0]));
  ctx.porteurVivantDe_('EMP');
  assert.strictEqual(erreurs.length, 1, 'la panne n\'est pas rejouée à chaque doublon du run');
});

/* ---------- CHEMIN : traiterDocument_ ---------- */

/** Pipeline minimal : le contenu EST connu de l'Index ; `vivant` pilote ce que dit `porteurVivantDe_` (ADR-0077 : l'exemplaire nommé porte la même empreinte et la même taille). */
function ctxChemin(vivant) {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const calls = { placerDoublon: [], echecs: [], questions: [] };
  ctx.journalInfo_ = () => {};
  ctx.estPannePlateforme_ = () => false;
  ctx.indexContient_ = () => false;
  ctx.empreinteBlob_ = () => 'EMPREINTE';
  ctx.estDoublon_ = () => true;
  ctx.porteurVivantDe_ = (e) => { calls.questions.push(e); return { vivant, fileId: vivant ? ID_A : '' }; };
  ctx.metaFichierRest_ = () => ({ taille: 10, md5: 'EMPREINTE' });
  ctx.doublonRapide_ = (nom) => ({ dossierId: 'DUP', nom: 'dup_' + nom, statut: 'doublon', domaine: '', chemin: '' });
  ctx.indexAjouter_ = () => {};
  ctx.estTechnique_ = () => false;
  ctx.estMediaDirect_ = () => false;
  ctx.estPhoto_ = () => false;
  ctx.extension_ = () => '.pdf';
  ctx.extraireTexte_ = () => '';
  ctx.classifier_ = () => null; // stoppe le pipeline après le fast-path : preuve qu'on y est arrivé
  ctx.gererEchec_ = (src, motif) => calls.echecs.push(motif);
  const src = {
    cle: 'drive|NOUVEAU', nom: 'doc.pdf', taille: 10, date: new Date('2026-07-01T00:00:00Z'),
    blob: () => ({}),
    placer: (dossierId, nom) => { calls.placerDoublon.push({ dossierId, nom }); return 'X'; },
  };
  return { ctx, calls, src };
}

test('traiterDocument_ : contenu connu ET exemplaire vivant → _Doublons (comportement inchangé)', () => {
  const { ctx, calls, src } = ctxChemin(true);
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.placerDoublon.length, 1);
  assert.strictEqual(calls.placerDoublon[0].dossierId, 'DUP');
  assert.strictEqual(calls.questions.length, 1, 'témoin : le porteur est bien interrogé');
});

test('traiterDocument_ : contenu connu mais exemplaire DISPARU → pas jeté en _Doublons, le pipeline continue', () => {
  const { ctx, calls, src } = ctxChemin(false);
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.placerDoublon.length, 0, 'plus aucune copie classée : le fichier ne part pas en doublon');
  assert.strictEqual(JSON.stringify(calls.echecs), JSON.stringify(['classification impossible']),
    'preuve : il est allé jusqu\'au classement (mocké null)');
});

test('traiterDocument_ : contenu JAMAIS vu → aucune question au porteur (zéro lecture Drive de plus)', () => {
  const { ctx, calls, src } = ctxChemin(false);
  ctx.estDoublon_ = () => false;
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.questions.length, 0);
  assert.strictEqual(calls.placerDoublon.length, 0);
});

/* ---------- F12 : propagation fileId sur toutes les voies rapides & bout-en-bout ADR-0077 ---------- */

test('F12 — traiterDocument_ : fileId propagé à l\'Index sur TOUTES les voies rapides (_Doublons, _Technique, _Médias direct/photo/incertaine)', () => {
  const executerVoie = ({ nom, cle, idPlace, doublon, extrait, classif }) => {
    const c = load(['Config.gs', 'Pipeline.gs', 'Router.gs']);
    const indexes = [];
    c.Session = { getScriptTimeZone: () => 'UTC' };
    c.journalInfo_ = () => {};
    c.estPannePlateforme_ = () => false;
    c.indexContient_ = () => false;
    c.empreinteBlob_ = () => 'EMP_FICTIVE_01';
    c.estDoublon_ = () => !!doublon;
    c.porteurVivantDe_ = () => ({ vivant: true, fileId: 'FICTIF_VIVANT_01' });
    c.metaFichierRest_ = () => ({ taille: 123, md5: 'EMP_FICTIVE_01' });
    c.dossierDoublons_ = () => ({ getId: () => 'ID_DOUBLONS' });
    c.dossierTechnique_ = () => ({ getId: () => 'ID_TECH' });
    c.dossierMedias_ = () => ({ getId: () => 'ID_MEDIAS' });
    c.extraireTexte_ = () => (extrait === undefined ? '' : extrait);
    c.classifier_ = () => classif || null;
    c.enrichirClassifDepuisNom_ = () => {};
    c.toucheZoneProtegee_ = () => false;
    c.gererEchec_ = (s, msg) => { throw new Error('échec inattendu : ' + msg); };
    c.indexAjouter_ = (cCle, dec) => indexes.push({ cle: cCle, fileId: dec.fileId, statut: dec.statut });
    c.traiterDocument_({
      cle, nom, taille: 123, date: new Date('2026-07-01T00:00:00Z'),
      blob: () => ({}),
      placer: () => idPlace,
    });
    assert.strictEqual(indexes.length, 1, nom + ' doit indexer 1 ligne');
    return indexes[0];
  };

  assert.strictEqual(executerVoie({ nom: 'dup.pdf', cle: '19abc001|0|dup.pdf|123', idPlace: 'FICTIF_ID_DUP_001', doublon: true }).fileId, 'FICTIF_ID_DUP_001');
  assert.strictEqual(executerVoie({ nom: 'script_fictif.py', cle: '19abc002|0|script_fictif.py|123', idPlace: 'FICTIF_ID_TECH_001' }).fileId, 'FICTIF_ID_TECH_001');
  assert.strictEqual(executerVoie({ nom: 'video_vacances.mp4', cle: '19abc003|0|video_vacances.mp4|123', idPlace: 'FICTIF_ID_MED_001' }).fileId, 'FICTIF_ID_MED_001');
  assert.strictEqual(executerVoie({ nom: 'IMG_2734.jpg', cle: '19abc004|0|IMG_2734.jpg|123', idPlace: 'FICTIF_ID_PH_001', extrait: '' }).fileId, 'FICTIF_ID_PH_001');
  assert.strictEqual(executerVoie({
    nom: '987654321.jpg', cle: '19abc005|0|987654321.jpg|123', idPlace: 'FICTIF_ID_INC_001',
    extrait: 'étiquette', classif: { domaine: '02', confiance: 0.4, sensible: false },
  }).fileId, 'FICTIF_ID_INC_001');
});

test('F12 — ADR-0077 bout-en-bout Gmail → _Médias : une photo Gmail déposée sans fileId de source est ensuite reconnue comme porteur vivant', () => {
  const c = load(['Config.gs', 'Pipeline.gs', 'Journal.gs', 'Router.gs']);
  const MD5_PHOTO = 'd1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6';
  const lignesIndex = [];
  c.Session = { getScriptTimeZone: () => 'UTC' };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.estPannePlateforme_ = () => false;
  c.empreinteBlob_ = () => MD5_PHOTO;
  c.extraireTexte_ = () => '';
  c.idDoublonsSansCreer_ = () => ID_DOUBLONS;
  c.dossierDoublons_ = () => ({ getId: () => ID_DOUBLONS });
  c.dossierMedias_ = () => ({ getId: () => 'ID_MEDIAS' });
  c.metaFichierRest_ = (fid) => (fid === 'FICTIF_MEDIA_PORT_01'
    ? { taille: 1024, md5: MD5_PHOTO, corbeille: false, parents: ['ID_MEDIAS'] }
    : { taille: 1024, md5: MD5_PHOTO, corbeille: false, parents: ['ID_PARTAGE'] });
  c.feuille_ = (nom) => {
    if (nom !== 'Index') return { getLastRow: () => 1, getRange: () => ({ getValue: () => '', setValue: () => {}, getValues: () => [] }), appendRow: () => {} };
    return {
      getLastRow: () => lignesIndex.length + 1,
      getRange: (l, col, n) => ({
        getValue: () => '',
        setValue: () => {},
        getValues: () => lignesIndex.slice(l - 2, l - 2 + n).map((r) => [r[col - 1]]),
      }),
      appendRow: (row) => { lignesIndex.push(row); },
    };
  };
  c.reinitialiserIndexCache_();

  // Passe 1 : pièce jointe Gmail sans fileId de source → _Médias, fileId écrit en col I.
  c.traiterDocument_({
    cle: '19msg001|0|IMG_1001.jpg|1024', nom: 'IMG_1001.jpg', taille: 1024,
    date: new Date('2026-07-01T00:00:00Z'), blob: () => ({}),
    placer: () => 'FICTIF_MEDIA_PORT_01',
  });
  assert.strictEqual(lignesIndex.length, 1);
  assert.strictEqual(lignesIndex[0][5], 'média');
  assert.strictEqual(lignesIndex[0][8], 'FICTIF_MEDIA_PORT_01', 'colonne I FileId renseignée dès la voie rapide');

  // Passe 2 : ré-arrivée partagée avec même MD5 et taille → reconnue doublon de FICTIF_MEDIA_PORT_01.
  c.reinitialiserIndexCache_();
  let dossierCible2 = '';
  c.traiterDocument_({
    cle: 'shared|FICTIF_SHARED_02', fileId: 'FICTIF_SHARED_02', nom: 'IMG_1001_copie.jpg', taille: 1024,
    date: new Date('2026-07-02T00:00:00Z'), blob: () => ({}),
    placer: (dossierId) => { dossierCible2 = dossierId; return 'FICTIF_DUP_02'; },
  });
  assert.strictEqual(dossierCible2, ID_DOUBLONS, 'la 2e arrivée part bien dans _Doublons');
  assert.strictEqual(lignesIndex.length, 2);
  assert.strictEqual(lignesIndex[1][5], 'doublon');
  assert.strictEqual(lignesIndex[1][10], 'FICTIF_MEDIA_PORT_01', 'exemplaire vivant nommé en colonne K');
});
