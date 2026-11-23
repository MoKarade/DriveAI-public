'use strict';
/**
 * DriveAI#808 / ADR-0071 — un fichier classé que Marc REMET dans `00 · À trier` est re-traité UNE fois.
 * Avant : `Intake.gs` sautait tout fichier dont la clé `drive|<id>` était à l'Index, donc la remise ne servait à rien.
 *
 * Le signal n'est PAS la date Drive (un simple déplacement ne la change pas) mais l'Index : la dernière ligne du
 * fichier dit « placé ailleurs » alors qu'il est dans `00 · À trier`. Un résident légitime (quarantaine, natif,
 * zone protégée) ne porte pas de chemin et reste en place.
 *
 * Étages : PUR (`clesRedepot_`, `ligneEstUnPlacement_`) · Index (`lireLigneIndex_`, `cleRedepot_`, mémo, plafond) ·
 * CHEMIN (`traiterDepots_` puis `traiterFichierDepose_` jusqu'au descripteur passé au pipeline).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

const ID = 'FFFFFFFFFFFFFFFFFFFFFFFF'; // 24 car. : forme d'un fileId Drive
const ID2 = 'GGGGGGGGGGGGGGGGGGGGGGGG';
const ID3 = 'HHHHHHHHHHHHHHHHHHHHHHHH';
const ID4 = 'IIIIIIIIIIIIIIIIIIIIIIII';

const ENTETE = ['Clé', 'Date', 'Nom', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId'];
const ligne = (cle, statut, chemin, extra) => [cle, new Date(1e12), 'doc.pdf', '', chemin || '', statut, (extra && extra.empreinte) || '', '', (extra && extra.fileId) || ''];

/** Faux onglet Index : lignes[0] = en-tête ; compte les relectures de UNE ligne (6 cellules) pour prouver le mémo. */
function fauxIndex(lignes) {
  const rows = [ENTETE].concat(lignes);
  const stats = { relectures: 0, jette: false };
  const feuille = {
    rows, stats,
    getLastRow: () => rows.length,
    appendRow: (l) => rows.push(l),
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        if (nr === 1 && nc === 6) {
          stats.relectures++;
          if (stats.jette) throw new Error('Sheet indisponible (simulé)');
        }
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const src = rows[r - 1 + i] || [];
          const l = [];
          for (let j = 0; j < (nc || 1); j++) l.push(src[c - 1 + j] === undefined ? '' : src[c - 1 + j]);
          out.push(l);
        }
        return out;
      },
      getValue: () => (rows[r - 1] || [])[c - 1],
      setValue: (v) => { rows[r - 1][c - 1] = v; },
    }),
  };
  return feuille;
}

/** Un « run » : contexte neuf (caches vides) sur le MÊME Index et les MÊMES Properties que les runs précédents. */
function run(feuille, store, opts) {
  opts = opts || {};
  const ctx = load(['Config.gs', 'Journal.gs', 'Intake.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = v; },
      }),
    },
    DriveApp: { getFolderById: () => ({ getFiles: () => iter(opts.fichiers || []) }) },
  });
  ctx.feuille_ = () => feuille; // APRÈS le chargement : Config.gs définit feuille_
  // Journal.gs redéfinit les deux fonctions de journal (elles écriraient dans le faux Index) : on les capture à nouveau.
  ctx.journalInfo_ = (src, msg) => ctx.__logs.push(['INFO', src, msg]);
  ctx.journalErreur_ = (src, msg) => ctx.__logs.push(['ERREUR', src, msg]);
  if (opts.verifMax != null) ctx.CONFIG.REDEPOT_VERIF_MAX_RUN = opts.verifMax;
  return ctx;
}

const fichier = (id, ms) => ({ getId: () => id, getLastUpdated: () => new Date(ms || 1) });

/* ---------- PUR ---------- */

test('clesRedepot_ : dernière ligne = drive|id sans remise, puis redepot|id|n ; la suivante est la première absente', () => {
  const ctx = load(['Config.gs', 'Intake.gs']);
  const a = ctx.clesRedepot_(ID, () => false);
  assert.strictEqual(a.derniere, 'drive|' + ID);
  assert.strictEqual(a.suivante, 'redepot|' + ID + '|1');
  const deja = ['redepot|' + ID + '|1', 'redepot|' + ID + '|2'];
  const b = ctx.clesRedepot_(ID, (c) => deja.indexOf(c) !== -1);
  assert.strictEqual(b.derniere, 'redepot|' + ID + '|2');
  assert.strictEqual(b.suivante, 'redepot|' + ID + '|3');
});

test('clesRedepot_ : au plafond de remises → null (jamais de boucle sans fin)', () => {
  const ctx = load(['Config.gs', 'Intake.gs']);
  assert.strictEqual(ctx.clesRedepot_(ID, () => true), null);
});

test('ligneEstUnPlacement_ : les cinq statuts de placement AVEC chemin, rien d\'autre', () => {
  const ctx = load(['Config.gs', 'Intake.gs']);
  ['classé', 'à vérifier', 'doublon', 'technique', 'média'].forEach((statut) => {
    assert.strictEqual(ctx.ligneEstUnPlacement_({ statut, chemin: '04 · X/Y' }), true, statut);
    assert.strictEqual(ctx.ligneEstUnPlacement_({ statut, chemin: '' }), false, statut + ' sans chemin');
  });
  ['quarantaine', 'natif', 'zone protégée', 'consolidation-plan', 'inconnu', ''].forEach((statut) => {
    assert.strictEqual(ctx.ligneEstUnPlacement_({ statut, chemin: '04 · X/Y' }), false, statut + ' : jamais une remise');
  });
  assert.strictEqual(ctx.ligneEstUnPlacement_(null), false);
});

/* ---------- Index : lecture d'une ligne ---------- */

test('lireLigneIndex_ : rend la dernière ligne de la clé, vérifiée par sa clé', () => {
  const f = fauxIndex([ligne('drive|' + ID, 'classé', '04 · A/B')]);
  const ctx = run(f, {});
  const l = ctx.lireLigneIndex_('drive|' + ID);
  assert.strictEqual(l.statut, 'classé');
  assert.strictEqual(l.chemin, '04 · A/B');
  assert.strictEqual(ctx.lireLigneIndex_('drive|inconnu'), null);
});

test('lireLigneIndex_ : l\'onglet a bougé depuis la lecture de la colonne A → null, on ne décide pas', () => {
  const f = fauxIndex([ligne('tri|t1|1|lu', ''), ligne('drive|' + ID, 'classé', '04 · A/B')]);
  const ctx = run(f, {});
  assert.strictEqual(ctx.indexLigneDe_('drive|' + ID), 3);
  f.rows.splice(1, 1); // purge d'une ligne `tri|` : tout remonte d'un cran
  assert.strictEqual(ctx.lireLigneIndex_('drive|' + ID), null, 'la ligne 3 est maintenant vide : clé différente');
});

/* ---------- Index : décision d'une remise ---------- */

test('cleRedepot_ : dernière ligne « classé » + chemin → remise, clé redepot|id|1', () => {
  const f = fauxIndex([ligne('drive|' + ID, 'classé', '04 · A/B')]);
  const ctx = run(f, {});
  assert.strictEqual(ctx.cleRedepot_(ID), 'redepot|' + ID + '|1');
  assert.ok(ctx.__logs.some(([niv, src, msg]) => niv === 'INFO' && src === 'Intake' && /Re-dépôt détecté/.test(msg)));
});

test('cleRedepot_ : résident légitime (quarantaine, natif, zone protégée) → rien, et jugé UNE fois (mémo)', () => {
  const f = fauxIndex([
    ligne('drive|' + ID, 'quarantaine', ''),
    ligne('drive|' + ID2, 'natif', ''),
    ligne('drive|' + ID3, 'zone protégée', ''),
  ]);
  const store = {};
  const r1 = run(f, store);
  [ID, ID2, ID3].forEach((id) => assert.strictEqual(r1.cleRedepot_(id), '', id));
  assert.strictEqual(f.stats.relectures, 3, 'trois lectures de ligne au premier run');
  // Run suivant (caches neufs, mêmes Properties) : aucune relecture.
  const r2 = run(f, store);
  [ID, ID2, ID3].forEach((id) => assert.strictEqual(r2.cleRedepot_(id), '', id));
  assert.strictEqual(f.stats.relectures, 3, 'le mémo évite toute relecture : un résident ne coûte plus rien');
  assert.strictEqual(JSON.parse(store.DriveAI_REDEPOT_RESIDENTS).length, 3);
});

test('cleRedepot_ : le mémo est borné aux REDEPOT_MEMO_MAX plus récents', () => {
  const f = fauxIndex([ligne('drive|' + ID, 'natif', ''), ligne('drive|' + ID2, 'natif', ''), ligne('drive|' + ID3, 'natif', '')]);
  const store = {};
  const ctx = run(f, store);
  ctx.CONFIG.REDEPOT_MEMO_MAX = 2;
  [ID, ID2, ID3].forEach((id) => ctx.cleRedepot_(id));
  const memo = JSON.parse(store.DriveAI_REDEPOT_RESIDENTS);
  assert.strictEqual(memo.length, 2);
  assert.ok(memo[1].indexOf(ID3) === 0, 'les plus récents restent');
});

test('cleRedepot_ : plafond de lectures par run ; le reste est jugé au run suivant (rien n\'est perdu)', () => {
  const f = fauxIndex([ligne('drive|' + ID, 'natif', ''), ligne('drive|' + ID2, 'natif', ''), ligne('drive|' + ID3, 'classé', '04 · A/B')]);
  const store = {};
  const r1 = run(f, store, { verifMax: 2 });
  assert.strictEqual(r1.cleRedepot_(ID), '');
  assert.strictEqual(r1.cleRedepot_(ID2), '');
  assert.strictEqual(r1.cleRedepot_(ID3), '', 'plafond atteint : attend le tick suivant');
  assert.strictEqual(f.stats.relectures, 2);
  const r2 = run(f, store, { verifMax: 2 });
  assert.strictEqual(r2.cleRedepot_(ID3), 'redepot|' + ID3 + '|1', 'jugé au run suivant');
});

test('cleRedepot_ : relecture de ligne en échec → fichier laissé en place, erreur journalisée, rien de mémorisé', () => {
  const f = fauxIndex([ligne('drive|' + ID, 'classé', '04 · A/B')]);
  f.stats.jette = true;
  const store = {};
  const ctx = run(f, store);
  assert.strictEqual(ctx.cleRedepot_(ID), '');
  assert.ok(ctx.__logs.some(([niv, src, msg]) => niv === 'ERREUR' && src === 'Intake' && /re-dépôt en échec/.test(msg)));
  assert.strictEqual(store.DriveAI_REDEPOT_RESIDENTS, undefined, 'une panne n\'est pas un verdict');
});

test('cleRedepot_ : ligne ajoutée pendant CE run (numéro inconnu) → on ne décide pas', () => {
  const f = fauxIndex([]);
  const ctx = run(f, {});
  ctx.indexContient_('chauffe'); // le cache est chargé en début de run, AVANT toute écriture
  ctx.indexAjouter_('drive|' + ID, { statut: 'classé', chemin: '04 · A/B', nom: 'x.pdf', domaine: '04' }, 'EMP');
  assert.strictEqual(ctx.cleRedepot_(ID), '');
});

test('cleRedepot_ : la dernière ligne est celle de la dernière remise, pas drive|id', () => {
  // Remise 1 déjà traitée et le fichier reposé ailleurs ; Marc le remet encore → remise 2.
  const f1 = fauxIndex([ligne('drive|' + ID, 'classé', '04 · A/B'), ligne('redepot|' + ID + '|1', 'classé', '05 · C/D')]);
  assert.strictEqual(run(f1, {}).cleRedepot_(ID), 'redepot|' + ID + '|2');
  // Remise 1 en quarantaine : le fichier est un résident, pas une nouvelle remise (« une fois, pas deux »).
  const f2 = fauxIndex([ligne('drive|' + ID, 'classé', '04 · A/B'), ligne('redepot|' + ID + '|1', 'quarantaine', '')]);
  assert.strictEqual(run(f2, {}).cleRedepot_(ID), '');
});

test('cleRedepot_ : plafond de 20 remises → laissé en place, erreur journalisée', () => {
  const lignes = [ligne('drive|' + ID, 'classé', '04 · A/B')];
  for (let n = 1; n <= 20; n++) lignes.push(ligne('redepot|' + ID + '|' + n, 'classé', '04 · A/B'));
  const ctx = run(fauxIndex(lignes), {});
  assert.strictEqual(ctx.cleRedepot_(ID), '');
  assert.ok(ctx.__logs.some(([niv, , msg]) => niv === 'ERREUR' && /remis 20 fois/.test(msg)));
});

/* ---------- CHEMIN : traiterDepots_ ---------- */

test('traiterDepots_ : une remise est présentée au pipeline AVEC sa clé ; un résident et un fichier neuf comme avant', () => {
  const f = fauxIndex([
    ligne('drive|' + ID, 'classé', '04 · A/B'),   // remis par Marc
    ligne('drive|' + ID2, 'quarantaine', ''),     // résident
  ]);
  const ctx = run(f, {}, { fichiers: [fichier(ID, 10), fichier(ID2, 20), fichier(ID3, 30)] }); // ID3 : jamais vu
  const appels = [];
  ctx.traiterFichierDepose_ = (id, cle) => appels.push([id, cle || '']);
  ctx.traiterDepots_(() => false);
  assert.strictEqual(JSON.stringify(appels), JSON.stringify([[ID, 'redepot|' + ID + '|1'], [ID3, '']]));
});

test('traiterDepots_ : « une fois, pas deux » — la remise est traitée au run 1, plus jamais au run 2 si elle est restée là', () => {
  const f = fauxIndex([ligne('drive|' + ID, 'classé', '04 · A/B')]);
  const store = {};
  const r1 = run(f, store, { fichiers: [fichier(ID, 10)] });
  const vus1 = [];
  // Le pipeline échoue jusqu'en quarantaine (le fichier reste dans 00·À trier) : il écrit la ligne sous la clé de remise.
  r1.traiterFichierDepose_ = (id, cle) => { vus1.push(cle); r1.indexAjouter_(cle, { statut: 'quarantaine', nom: 'doc.pdf' }); };
  r1.traiterDepots_(() => false);
  assert.strictEqual(JSON.stringify(vus1), JSON.stringify(['redepot|' + ID + '|1']));
  const r2 = run(f, store, { fichiers: [fichier(ID, 10)] });
  const vus2 = [];
  r2.traiterFichierDepose_ = (id, cle) => vus2.push(cle);
  r2.traiterDepots_(() => false);
  assert.strictEqual(vus2.length, 0, 'la ligne redepot|…|1 (quarantaine) en fait un résident : pas de deuxième passage');
});

/* ---------- CHEMIN : traiterFichierDepose_ ---------- */

function ctxDepose(opts) {
  const docs = [];
  const ctx = load(['Config.gs', 'Intake.gs'], {
    DriveApp: {
      getFileById: () => ({
        getMimeType: () => opts.mime || 'application/pdf',
        getName: () => 'releve.pdf',
        getSize: () => 123,
        getLastUpdated: () => new Date(1e12),
        getBlob: () => ({ octets: true }),
      }),
    },
  });
  ctx.traiterDocument_ = (src) => docs.push(src);
  ctx.exportNatifMime_ = () => 'text/plain';
  ctx.exporterTexteNatif_ = () => 'x'.repeat(500);
  return { ctx, docs };
}

test('traiterFichierDepose_ : sans clé de remise → clé drive|, fast-path doublon intact (comportement d\'avant)', () => {
  const { ctx, docs } = ctxDepose({});
  ctx.traiterFichierDepose_(ID);
  assert.strictEqual(docs[0].cle, 'drive|' + ID);
  assert.strictEqual(docs[0].ignorerDoublon, undefined);
});

test('traiterFichierDepose_ : remise (binaire) → clé redepot|… ET ignorerDoublon (sinon : _Doublons de lui-même)', () => {
  const { ctx, docs } = ctxDepose({});
  ctx.traiterFichierDepose_(ID, 'redepot|' + ID + '|1');
  assert.strictEqual(docs[0].cle, 'redepot|' + ID + '|1');
  assert.strictEqual(docs[0].ignorerDoublon, true);
});

test('traiterFichierDepose_ : remise (Google natif exportable) → clé redepot|… ET ignorerDoublon même si le texte est long', () => {
  const { ctx, docs } = ctxDepose({ mime: 'application/vnd.google-apps.document' });
  ctx.traiterFichierDepose_(ID, 'redepot|' + ID + '|1');
  assert.strictEqual(docs[0].cle, 'redepot|' + ID + '|1');
  assert.strictEqual(docs[0].ignorerDoublon, true);
});

test('cleRedepot_ : une clé RÉÉCRITE dans ce run (ex. quarantaine) ne se juge pas sur son ancienne ligne', () => {
  const f = fauxIndex([ligne('drive|' + ID, 'classé', '04 · A/B')]);
  const ctx = run(f, {});
  ctx.indexContient_('chauffe');
  ctx.indexAjouter_('drive|' + ID, { statut: 'quarantaine', nom: 'doc.pdf' });
  assert.strictEqual(ctx.cleRedepot_(ID), '', 'l\'ancienne ligne dit « classé » ; la nouvelle (inconnue ici) l\'emporte');
});
