'use strict';
/**
 * DriveAI#893 / ADR-0077 — un fichier n'est écarté en `_Doublons` que sur EMPREINTE ET TAILLE, face à un exemplaire
 * PROUVÉ vivant, avec la preuve écrite (Index J « Taille », K « Exemplaire », ligne de Journal). Deux quasi-homonymes de
 * contenu différent ne sont jamais fusionnés ; un exemplaire modifié depuis son classement (Index périmé) ne fait plus
 * écarter un dépôt ; les fichiers au-delà de `OCR_TAILLE_MAX` sont enfin vus, par le `md5Checksum` que Drive calcule.
 *
 * Quatre étages :
 *   - PUR : `metaDepuisReponseDrive_`, `tailleOctets_`, `jugerDoublon_` ;
 *   - Drive REST (UrlFetchApp mocké) : `metaFichierRest_` ;
 *   - source : `metaDoublon_` (REST avant les octets, blob jamais téléchargé pour rien) ;
 *   - CHEMIN : `traiterDocument_` écarte ou poursuit, et écrit la preuve.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ID_DEPOT = 'DEPOT000000000000000001';
const ID_VIVANT = 'VIVANT00000000000000001';
const MD5 = '9e107d9d372bb6826bd81d3542a419d6';
const memeForme = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);

/* ---------- PUR : lecture de la réponse Drive, taille exploitable ---------- */

test('metaDepuisReponseDrive_ : size (chaîne) et md5Checksum (hex minuscule) ; natif → null et vide', () => {
  const ctx = load(['Config.gs', 'DriveRest.gs']);
  memeForme(ctx.metaDepuisReponseDrive_({ size: '48213', md5Checksum: MD5.toUpperCase() }), { taille: 48213, md5: MD5, corbeille: false, parents: [] });
  memeForme(ctx.metaDepuisReponseDrive_({}), { taille: null, md5: '', corbeille: false, parents: [] }, 'un Google Doc n\'a ni size ni md5');
  memeForme(ctx.metaDepuisReponseDrive_({ size: 'abc', md5Checksum: 7 }), { taille: null, md5: '', corbeille: false, parents: [] }, 'valeurs mal formées → inconnues');
  memeForme(ctx.metaDepuisReponseDrive_(null), { taille: null, md5: '', corbeille: false, parents: [] });
  // DriveAI#897 : la preuve de vie voyage dans la même réponse
  memeForme(ctx.metaDepuisReponseDrive_({ trashed: true, parents: ['P1', 'P2'] }), { taille: null, md5: '', corbeille: true, parents: ['P1', 'P2'] });
  memeForme(ctx.metaDepuisReponseDrive_({ trashed: 'true', parents: 'P1' }), { taille: null, md5: '', corbeille: false, parents: [] }, 'corbeille : booléen strict ; parents : tableau ou rien');
});

test('tailleOctets_ : entier > 0 seulement ; 0, négatif, NaN, chaîne → null (inconnue)', () => {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  assert.strictEqual(ctx.tailleOctets_(10), 10);
  assert.strictEqual(ctx.tailleOctets_(10.7), 10);
  assert.strictEqual(ctx.tailleOctets_(0), null);
  assert.strictEqual(ctx.tailleOctets_(-1), null);
  assert.strictEqual(ctx.tailleOctets_('10'), null);
  assert.strictEqual(ctx.tailleOctets_(NaN), null);
  assert.strictEqual(ctx.tailleOctets_(undefined), null);
});

/* ---------- PUR : le verdict ---------- */

test('jugerDoublon_ : doublon SEULEMENT si exemplaire prouvé, même empreinte Drive aujourd\'hui ET même taille', () => {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const depot = { taille: 48213, origine: 'rest' };
  const vivant = { vivant: true, fileId: ID_VIVANT };
  const j = (meta, porteur, metaPorteur) => ctx.jugerDoublon_(MD5, meta, porteur, metaPorteur);

  memeForme(j(depot, vivant, { taille: 48213, md5: MD5 }), { doublon: true, exemplaire: ID_VIVANT, raison: '' }, 'même md5, même taille');
  assert.strictEqual(j(depot, vivant, { taille: null, md5: MD5 }).doublon, true, 'taille de l\'exemplaire inconnue : non comparable, le md5 fait foi');
  assert.strictEqual(j({ taille: null, origine: 'octets' }, vivant, { taille: 48213, md5: MD5 }).doublon, true, 'taille du dépôt inconnue : idem');

  let v = j(depot, vivant, { taille: 48214, md5: MD5 });
  assert.strictEqual(v.doublon, false, 'taille différente → jamais fusionnés');
  assert.ok(/taille différente \(48213 o déposé, 48214 o classé/.test(v.raison), v.raison);

  v = j(depot, vivant, { taille: 48213, md5: 'autre' });
  assert.strictEqual(v.doublon, false, 'l\'exemplaire a changé depuis son classement : l\'Index est périmé');
  assert.ok(/a changé depuis son classement/.test(v.raison), v.raison);

  v = j(depot, { vivant: false, fileId: '' }, null);
  assert.strictEqual(v.doublon, false);
  assert.ok(/exemplaire disparu/.test(v.raison), v.raison);

  v = j(depot, { vivant: true, fileId: '' }, null);
  assert.strictEqual(v.doublon, false, 'ADR-0070 disait « doublon dans le doute » ; ADR-0077 exige une preuve');
  assert.ok(/aucun exemplaire vivant prouvé/.test(v.raison), v.raison);

  v = j(depot, vivant, null);
  assert.strictEqual(v.doublon, false, 'REST en panne sur l\'exemplaire : rien n\'est prouvé');
  assert.ok(/illisible dans Drive/.test(v.raison), v.raison);
  assert.strictEqual(v.exemplaire, ID_VIVANT, 'l\'exemplaire interrogé reste nommé dans la raison');
});

test('jugerDoublon_ : natif Google — deux exports entiers identiques font foi, la taille n\'est pas comparée', () => {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const vivant = { vivant: true, fileId: ID_VIVANT };
  const natif = { taille: null, md5: '' }; // Drive n'a ni size ni md5 pour un Google Doc
  assert.strictEqual(ctx.jugerDoublon_(MD5, { taille: null, origine: 'texte' }, vivant, natif).doublon, true, 'natif contre natif');
  const v = ctx.jugerDoublon_(MD5, { taille: 48213, origine: 'octets' }, vivant, natif);
  assert.strictEqual(v.doublon, false, 'un dépôt BINAIRE ne peut pas être prouvé doublon d\'un natif');
  assert.ok(/sans empreinte Drive \(natif\)/.test(v.raison), v.raison);
  const v2 = ctx.jugerDoublon_(MD5, { taille: null, origine: 'texte' }, vivant, { taille: 48213, md5: 'autre' });
  assert.strictEqual(v2.doublon, false, 'un export natif contre un binaire d\'empreinte différente : non');
});

/* ---------- Drive REST ---------- */

function ctxRest(reponse) {
  const ctx = load(['Config.gs', 'DriveRest.gs']);
  const appels = [];
  ctx.ScriptApp = { getOAuthToken: () => 'jeton' };
  ctx.UrlFetchApp = {
    fetch: (url, options) => {
      appels.push({ url, options });
      if (reponse instanceof Error) throw reponse;
      return { getResponseCode: () => reponse.code, getContentText: () => reponse.corps };
    },
  };
  ctx.journalErreur_ = () => {};
  return { ctx, appels };
}

test('metaFichierRest_ : files.get?fields=trashed,parents,size,md5Checksum en GET, jeton Bearer, sans télécharger le contenu', () => {
  const { ctx, appels } = ctxRest({ code: 200, corps: JSON.stringify({ size: '48213', md5Checksum: MD5, trashed: false, parents: ['RANGEMENT'] }) });
  memeForme(ctx.metaFichierRest_(ID_VIVANT), { taille: 48213, md5: MD5, corbeille: false, parents: ['RANGEMENT'] });
  assert.strictEqual(appels.length, 1);
  assert.ok(appels[0].url.startsWith('https://www.googleapis.com/drive/v3/files/' + ID_VIVANT + '?fields='), appels[0].url);
  assert.ok(/fields=trashed%2Cparents%2Csize%2Cmd5Checksum/.test(appels[0].url), 'preuve de vie ET empreinte en un appel (#897) : ' + appels[0].url);
  assert.ok(!/alt=media/.test(appels[0].url), 'jamais le contenu');
  assert.strictEqual(appels[0].options.method, 'get');
  assert.strictEqual(appels[0].options.headers.Authorization, 'Bearer jeton');
  assert.strictEqual(appels[0].options.muteHttpExceptions, true);
});

test('metaFichierRest_ : HTTP ≠ 200, JSON cassé ou exception → null, jamais de levée, erreur journalisée UNE fois par run', () => {
  const r404 = ctxRest({ code: 404, corps: '{}' });
  const erreurs = [];
  r404.ctx.journalErreur_ = (s, m) => erreurs.push(m);
  assert.strictEqual(r404.ctx.metaFichierRest_(ID_VIVANT), null);
  assert.strictEqual(r404.ctx.metaFichierRest_(ID_DEPOT), null);
  assert.strictEqual(erreurs.length, 1, 'signalée une fois par run, pas à chaque fichier');
  assert.ok(/HTTP 404/.test(erreurs[0]) && erreurs[0].includes(ID_VIVANT), erreurs[0]);
  assert.strictEqual(ctxRest({ code: 200, corps: '{pas du json' }).ctx.metaFichierRest_(ID_VIVANT), null);
  assert.strictEqual(ctxRest(new Error('réseau')).ctx.metaFichierRest_(ID_VIVANT), null);
});

/* ---------- source : metaDoublon_ ---------- */

function ctxMeta(rest) {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const appels = { rest: [], blob: 0 };
  ctx.metaFichierRest_ = (id) => { appels.rest.push(id); return rest; };
  ctx.empreinteBlob_ = () => MD5;
  const src = (extra) => Object.assign({
    cle: 'drive|' + ID_DEPOT, nom: 'doc.pdf', taille: 48213,
    blob: () => { appels.blob++; return { octets: true }; },
  }, extra || {});
  return { ctx, appels, src };
}

test('metaDoublon_ : avec fileId, Drive répond → empreinte et taille de REST, le blob n\'est JAMAIS téléchargé', () => {
  const { ctx, appels, src } = ctxMeta({ taille: 48213, md5: MD5 });
  const m = ctx.metaDoublon_(src({ fileId: ID_DEPOT, taille: 40000 /* getSize périmé : REST fait foi */ }));
  assert.strictEqual(m.empreinte, MD5);
  assert.strictEqual(m.origine, 'rest');
  assert.strictEqual(m.taille, 48213);
  assert.strictEqual(m.blob, null);
  assert.strictEqual(appels.blob, 0);
  memeForme(appels.rest, [ID_DEPOT]);
});

test('metaDoublon_ : au-delà de OCR_TAILLE_MAX, un fichier avec fileId a quand même son empreinte (vidéo déposée deux fois)', () => {
  const { ctx, appels, src } = ctxMeta({ taille: 300 * 1024 * 1024, md5: MD5 });
  const m = ctx.metaDoublon_(src({ fileId: ID_DEPOT, taille: 300 * 1024 * 1024 }));
  assert.strictEqual(m.empreinte, MD5);
  assert.strictEqual(appels.blob, 0, 'une vidéo de 300 Mo n\'est jamais téléchargée');
});

test('metaDoublon_ : REST en panne → repli sur le MD5 des octets (sous la borne), blob rendu pour l\'OCR', () => {
  const { ctx, appels, src } = ctxMeta(null);
  const m = ctx.metaDoublon_(src({ fileId: ID_DEPOT }));
  assert.strictEqual(m.empreinte, MD5);
  assert.strictEqual(m.origine, 'octets');
  assert.strictEqual(m.taille, 48213);
  assert.ok(m.blob && m.blob.octets, 'le blob téléchargé est rendu');
  assert.strictEqual(appels.blob, 1);
});

test('metaDoublon_ : sans fileId (pièce jointe Gmail) → octets, sans appel REST ; trop gros sans fileId → rien', () => {
  const { ctx, appels, src } = ctxMeta({ taille: 1, md5: 'x' });
  const m = ctx.metaDoublon_(src({ cle: 'msg|0|doc.pdf|48213' }));
  assert.strictEqual(m.origine, 'octets');
  assert.strictEqual(appels.rest.length, 0);
  const gros = ctx.metaDoublon_(src({ cle: 'msg|0|video.mov|999', taille: ctx.CONFIG.OCR_TAILLE_MAX + 1 }));
  assert.strictEqual(gros.empreinte, '');
  assert.strictEqual(gros.origine, '');
  assert.strictEqual(appels.blob, 1, 'le gros fichier n\'a pas été téléchargé');
});

test('metaDoublon_ : natif Google (`src.natif`) → export haché, origine texte, taille NON comparable, Drive pas interrogé', () => {
  const { ctx, appels, src } = ctxMeta({ taille: null, md5: '' });
  const m = ctx.metaDoublon_(src({ fileId: ID_DEPOT, natif: true, taille: 1200 /* caractères, pas des octets */ }));
  assert.strictEqual(m.empreinte, MD5);
  assert.strictEqual(m.origine, 'texte');
  assert.strictEqual(m.taille, null, 'jamais un nombre de caractères dans la colonne Taille');
  assert.strictEqual(appels.rest.length, 0, 'Drive n\'a ni md5 ni taille pour un natif : aucun appel');
});

test('metaDoublon_ : ADR-0072 tenu — empreinte non identifiante ou MD5 du vide (même par REST) → aucune empreinte', () => {
  const { ctx, appels, src } = ctxMeta({ taille: 0, md5: 'd41d8cd98f00b204e9800998ecf8427e' });
  const m = ctx.metaDoublon_(src({ fileId: ID_DEPOT }));
  assert.strictEqual(m.empreinte, '');
  assert.strictEqual(m.origine, '');
  ctx.metaFichierRest_ = (id) => { appels.rest.push(id); return { taille: 48213, md5: MD5 }; };
  const n = ctx.metaDoublon_(src({ fileId: ID_DEPOT, empreinteNonIdentifiante: true }));
  assert.strictEqual(n.empreinte, '', 'le drapeau du descripteur suffit, même si Drive aurait un md5');
  assert.strictEqual(appels.rest.length, 1, 'un natif quasi vide n\'interroge même pas Drive');
});

test('metaDoublon_ : `src.metaRest` (md5 et taille déjà dans un files.list, partages) → aucun files.get ; size "0" → taille inconnue', () => {
  const { ctx, appels, src } = ctxMeta({ taille: 1, md5: 'jamais lu' });
  const m = ctx.metaDoublon_(src({ fileId: ID_DEPOT, metaRest: { taille: 48213, md5: MD5 } }));
  assert.strictEqual(m.empreinte, MD5);
  assert.strictEqual(m.origine, 'rest');
  assert.strictEqual(m.taille, 48213);
  assert.strictEqual(appels.rest.length, 0, 'la liste a déjà donné md5 et taille');
  assert.strictEqual(appels.blob, 0);
  const z = ctx.metaDoublon_(src({ fileId: ID_DEPOT, metaRest: { taille: 0, md5: MD5 }, taille: 0 }));
  assert.strictEqual(z.taille, null, 'jamais 0 dans la colonne Taille : « inconnue »');
});

/* ---------- CHEMIN : traiterDocument_ ---------- */

/**
 * Pipeline minimal : le dépôt (fileId, REST) a l'empreinte MD5 ; l'Index la connaît ; `porteur` et `metaPorteur`
 * pilotent ce que Drive dit de l'exemplaire. `classifier_` rend null : la preuve qu'on a poursuivi.
 */
function ctxChemin(o) {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const calls = { places: [], echecs: [], index: [], infos: [], rest: [], blob: 0 };
  ctx.journalInfo_ = (s, m) => calls.infos.push(m);
  ctx.estPannePlateforme_ = () => false;
  ctx.indexContient_ = () => false;
  ctx.metaFichierRest_ = (id) => { calls.rest.push(id); return id === ID_DEPOT ? o.metaDepot : o.metaPorteur; };
  ctx.empreinteBlob_ = () => MD5;
  ctx.estDoublon_ = () => true;
  ctx.porteurVivantDe_ = () => o.porteur;
  ctx.doublonRapide_ = (nom) => ({ dossierId: 'DUP', nom: 'dup_' + nom, statut: 'doublon', domaine: '', chemin: '_Doublons' });
  ctx.indexAjouter_ = (cle, dec, empreinte, trace) => calls.index.push({ cle, statut: dec.statut, empreinte, trace });
  ctx.estTechnique_ = () => false;
  ctx.estMediaDirect_ = () => false;
  ctx.estPhoto_ = () => false;
  ctx.extension_ = () => '.pdf';
  ctx.extraireTexte_ = () => '';
  ctx.classifier_ = () => null;
  ctx.gererEchec_ = (src, motif) => calls.echecs.push(motif);
  const src = Object.assign({
    cle: 'drive|' + ID_DEPOT, fileId: ID_DEPOT, nom: 'Facture_mars.pdf', taille: 48213, date: new Date('2026-11-05T00:00:00Z'),
    blob: () => { calls.blob++; return {}; },
    placer: (dossierId, nom) => { calls.places.push({ dossierId, nom }); return 'X'; },
  }, o.src || {});
  return { ctx, calls, src };
}

test('traiterDocument_ : vrai doublon (même md5, même taille, exemplaire prouvé) → _Doublons avec la preuve écrite', () => {
  const { ctx, calls, src } = ctxChemin({
    metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: ID_VIVANT }, metaPorteur: { taille: 48213, md5: MD5 },
  });
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.places.length, 1);
  assert.strictEqual(calls.places[0].dossierId, 'DUP');
  assert.strictEqual(calls.index.length, 1);
  assert.strictEqual(calls.index[0].statut, 'doublon');
  assert.strictEqual(calls.index[0].empreinte, MD5);
  memeForme(calls.index[0].trace, { taille: 48213, exemplaire: ID_VIVANT }, 'Index J = taille, K = exemplaire vivant');
  assert.ok(calls.infos.some((m) => m.includes('doublon → _Doublons : dup_Facture_mars.pdf') && m.includes('taille 48213 o') &&
    m.includes('empreinte ' + MD5) && m.includes('exemplaire vivant ' + ID_VIVANT)), JSON.stringify(calls.infos));
  assert.strictEqual(calls.blob, 0, 'aucun téléchargement : REST a tout donné');
  memeForme(calls.rest, [ID_DEPOT, ID_VIVANT], 'deux lectures de métadonnées, une par fichier');
  assert.strictEqual(calls.echecs.length, 0);
});

test('traiterDocument_ : un fichier déjà classé que Marc remet dans À trier n\'est JAMAIS son propre doublon', () => {
  // Classé par Gmail (clé `msg|…`, Index I = son fileId) puis remis dans « À trier » : pas de ligne `drive|<id>`, donc pas
  // de `redepot|` ni d'`ignorerDoublon` ; l'exemplaire « vivant » que l'Index nomme est le fichier lui-même.
  const { ctx, calls, src } = ctxChemin({
    metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: ID_DEPOT }, metaPorteur: { taille: 48213, md5: MD5 },
  });
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.places.length, 0, 'pas en _Doublons');
  memeForme(calls.echecs, ['classification impossible'], 'il suit le pipeline normal');
  memeForme(calls.rest, [ID_DEPOT], 'l\'exemplaire n\'est pas relu : c\'est le dépôt');
  assert.ok(calls.infos.some((m) => /le fichier lui-même/.test(m) && /traité normalement/.test(m)), JSON.stringify(calls.infos));
});

test('traiterDocument_ (#897) : 3 copies du même exemplaire → la preuve de vie a déjà lu l\'exemplaire, AUCUN files.get de plus', () => {
  const metaPorteur = { taille: 48213, md5: MD5, corbeille: false, parents: ['RANGEMENT'] };
  const { ctx, calls, src } = ctxChemin({
    metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: ID_VIVANT, meta: metaPorteur }, metaPorteur,
  });
  ['A', 'B', 'C'].forEach((n) => ctx.traiterDocument_(Object.assign({}, src, { cle: 'drive|' + ID_DEPOT + n, fileId: ID_DEPOT })));
  assert.strictEqual(calls.places.length, 3, 'les trois copies partent en _Doublons');
  assert.strictEqual(calls.rest.filter((id) => id === ID_VIVANT).length, 0, 'l\'exemplaire a été lu par la preuve de vie (`porteur.meta`), jamais relu');
  assert.strictEqual(calls.rest.filter((id) => id === ID_DEPOT).length, 3, 'chaque dépôt est lu');
});

test('traiterDocument_ : porteur nommé SANS meta (ancien appelant) → l\'exemplaire est relu, une fois par dépôt', () => {
  const { ctx, calls, src } = ctxChemin({
    metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: ID_VIVANT }, metaPorteur: { taille: 48213, md5: MD5 },
  });
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.places.length, 1);
  assert.strictEqual(calls.rest.filter((id) => id === ID_VIVANT).length, 1);
});

test('traiterDocument_ : quasi-homonyme de TAILLE différente → classé normalement, jamais fusionné', () => {
  const { ctx, calls, src } = ctxChemin({
    metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: ID_VIVANT }, metaPorteur: { taille: 51000, md5: MD5 },
  });
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.places.length, 0, 'pas en _Doublons');
  memeForme(calls.echecs, ['classification impossible'], 'preuve : il est allé jusqu\'au classement');
  assert.ok(calls.infos.some((m) => /taille différente \(48213 o déposé, 51000 o classé/.test(m) && /traité normalement/.test(m)), JSON.stringify(calls.infos));
});

test('traiterDocument_ : exemplaire modifié depuis son classement (md5 Drive ≠ Index) → classé normalement', () => {
  const { ctx, calls, src } = ctxChemin({
    metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: ID_VIVANT }, metaPorteur: { taille: 48213, md5: 'ffff' },
  });
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.places.length, 0);
  assert.ok(calls.infos.some((m) => /a changé depuis son classement/.test(m)));
});

test('traiterDocument_ : exemplaire vivant NON prouvé (doute ADR-0070) ou illisible → classé normalement', () => {
  let c = ctxChemin({ metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: '' }, metaPorteur: null });
  c.ctx.traiterDocument_(c.src);
  assert.strictEqual(c.calls.places.length, 0);
  assert.ok(c.calls.infos.some((m) => /aucun exemplaire vivant prouvé/.test(m)));
  memeForme(c.calls.rest, [ID_DEPOT], 'sans exemplaire nommé, Drive n\'est pas interrogé une 2e fois');

  c = ctxChemin({ metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: true, fileId: ID_VIVANT }, metaPorteur: null });
  c.ctx.traiterDocument_(c.src);
  assert.strictEqual(c.calls.places.length, 0);
  assert.ok(c.calls.infos.some((m) => /illisible dans Drive/.test(m)));
});

test('traiterDocument_ : vidéo de 300 Mo déposée deux fois → enfin vue comme doublon, sans la télécharger', () => {
  const gros = 300 * 1024 * 1024;
  const { ctx, calls, src } = ctxChemin({
    metaDepot: { taille: gros, md5: MD5 }, porteur: { vivant: true, fileId: ID_VIVANT }, metaPorteur: { taille: gros, md5: MD5 },
    src: { nom: 'VID_20260501.mp4', taille: gros, blob: () => { throw new Error('getBlob sur 300 Mo : hors mémoire'); } },
  });
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.places.length, 1);
  assert.strictEqual(calls.places[0].dossierId, 'DUP');
  assert.strictEqual(calls.echecs.length, 0);
});

test('traiterDocument_ : fichier inédit → une seule lecture REST (le dépôt), la taille écrite à l\'Index J', () => {
  const { ctx, calls, src } = ctxChemin({ metaDepot: { taille: 48213, md5: MD5 }, porteur: { vivant: false, fileId: '' }, metaPorteur: null });
  ctx.estDoublon_ = () => false;
  ctx.estTechnique_ = () => true;
  ctx.routageTechnique_ = (nom) => ({ dossierId: 'TECH', nom, statut: 'technique', domaine: '', chemin: '_Technique' });
  ctx.traiterDocument_(src);
  memeForme(calls.rest, [ID_DEPOT]);
  assert.strictEqual(calls.index.length, 1);
  memeForme(calls.index[0].trace, { taille: 48213, exemplaire: '' });
  assert.strictEqual(calls.blob, 0, 'un fichier technique n\'est plus téléchargé pour rien');
});

test('traiterDocument_ : la borne OCR lit la taille REST quand getSize a échoué (0) — un gros binaire n\'est pas téléchargé', () => {
  const gros = 300 * 1024 * 1024;
  const { ctx, calls, src } = ctxChemin({ metaDepot: { taille: gros, md5: MD5 }, porteur: { vivant: false, fileId: '' }, metaPorteur: null, src: { taille: 0 } });
  ctx.estDoublon_ = () => false;
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.blob, 0, 'getBlob sur 300 Mo lèverait : la taille REST borne l\'OCR');
  memeForme(calls.echecs, ['classification impossible']);
});

/* ---------- Index : colonnes J et K ---------- */

function feuilleIndexVide() {
  const rows = [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId']];
  return {
    rows,
    getLastRow: () => rows.length,
    appendRow: (l) => rows.push(l),
    getRange: (r, c, nr, nc) => ({
      getValue: () => (rows[r - 1] || [])[c - 1],
      setValue: (v) => { rows[r - 1][c - 1] = v; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) { const s = rows[r - 1 + i] || []; const l = []; for (let j = 0; j < (nc || 1); j++) l.push(s[c - 1 + j] === undefined ? '' : s[c - 1 + j]); out.push(l); }
        return out;
      },
    }),
  };
}

test('Index : chargerIndexCache_ répare les en-têtes J « Taille » et K « Exemplaire » d\'un Index existant', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const f = feuilleIndexVide();
  ctx.feuille_ = () => f;
  ctx.reinitialiserIndexCache_();
  ctx.chargerIndexCache_();
  assert.strictEqual(f.rows[0][9], 'Taille');
  assert.strictEqual(f.rows[0][10], 'Exemplaire');
});

test('Index : indexAjouter_ écrit la taille (J) sur toute ligne et l\'exemplaire (K) sur un doublon ; vide sans trace', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  const f = feuilleIndexVide();
  ctx.feuille_ = () => f;
  ctx.reinitialiserIndexCache_();
  ctx.indexAjouter_('drive|' + ID_DEPOT, { statut: 'doublon', nom: 'dup.pdf', domaine: '', chemin: '_Doublons' }, MD5,
    { taille: 48213, exemplaire: ID_VIVANT });
  ctx.indexAjouter_('drive|AUTRE', { statut: 'classé', nom: 'a.pdf', domaine: '02', chemin: '02', fileId: 'F' }, 'e2', { taille: 10, exemplaire: '' });
  ctx.indexAjouter_('msg|0|x|1', { statut: 'quarantaine', nom: 'x', domaine: '', chemin: '' });
  memeForme(f.rows[1].slice(9), [48213, ID_VIVANT]);
  memeForme(f.rows[2].slice(9), [10, '']);
  memeForme(f.rows[3].slice(9), ['', ''], 'sans trace (quarantaine, tri) : colonnes vides, 11 cellules quand même');
  assert.strictEqual(f.rows[3].length, 11);
});
