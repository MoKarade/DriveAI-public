'use strict';
/**
 * #474 — les caches Entités et Index ne sont jamais visibles à moitié remplis.
 * Une lecture de Sheet qui lève à mi-parcours doit laisser le cache à `null` (« je ne sais pas »),
 * pas vide ni partiel : sinon le reste du run croit qu'une entité n'existe pas, ou qu'un fichier
 * déjà traité ne l'a jamais été (donc le retraite et le repaye).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Variante possible ?', 'Vu N fois'];

function ctxEntites(c, opts) {
  // opts.leve : la lecture des données (2e getValues) lève tant que opts.leve est vrai.
  c.feuille_ = () => ({
    getLastColumn: () => ENTETES.length,
    getLastRow: () => 3,
    getRange: (l) => ({
      getValues: () => {
        if (l === 1) return [ENTETES.slice()];
        if (opts.leve) throw new Error('Service Spreadsheets: timeout');
        return [
          ['Alphatek', '01 · Travail', '', '', 'validée', 'd1', '', 1],
          ['Zephyr', '03 · Logement & véhicule', '', '', 'validée', 'd2', '', 1],
        ];
      },
      setValues: () => {},
    }),
  });
}

test('Entités : lecture en échec → exception, cache toujours null (pas de cache vide)', () => {
  const c = load(['Config.gs', 'Entites.gs']);
  const opts = { leve: true };
  ctxEntites(c, opts);
  c._entitesCache = null;
  assert.throws(() => c.entitesCache_(), /timeout/);
  assert.strictEqual(c._entitesCache, null);
  // Un second appel dans le même run ne rend PAS un référentiel vide : il relit, et lève encore.
  assert.throws(() => c.entitesCache_(), /timeout/);
  assert.strictEqual(c._entitesCache, null);
});

test('Entités : après une panne, la relecture réussie publie le cache COMPLET', () => {
  const c = load(['Config.gs', 'Entites.gs']);
  const opts = { leve: true };
  ctxEntites(c, opts);
  c._entitesCache = null;
  assert.throws(() => c.entitesCache_(), /timeout/);
  opts.leve = false;
  const cache = c.entitesCache_();
  assert.strictEqual(cache.lignes.length, 2);
  assert.strictEqual(Object.keys(cache.parCle).length, 2);
});

function ctxIndex(c, opts) {
  const cles = ['drive|aaa', 'drive|bbb', 'drive|ccc'];
  const emp = ['h1', 'h2', 'h3'];
  c.feuille_ = () => ({
    getLastRow: () => 4,
    getRange: (l, col) => ({
      getValue: () => (col === 7 ? 'Empreinte' : col === 9 ? 'FileId' : ''),
      setValue: () => {},
      getValues: () => {
        if (col === 1) return cles.map((k) => [k]);
        if (opts.leve) throw new Error('Service Spreadsheets: timeout'); // 2e lecture (empreintes) en échec
        return emp.map((e) => [e]);
      },
    }),
  });
}

test('Index : lecture des empreintes en échec → exception, les TROIS caches restent null', () => {
  const c = load(['Config.gs', 'Journal.gs']);
  const opts = { leve: true };
  ctxIndex(c, opts);
  c._indexCache = null; c._empreintesCache = null; c._empreintesParIdCache = null;
  assert.throws(() => c.indexContient_('drive|aaa'), /timeout/);
  assert.strictEqual(c._indexCache, null);
  assert.strictEqual(c._empreintesCache, null);
  assert.strictEqual(c._empreintesParIdCache, null);
  // Un fichier déjà indexé ne passe pas pour « jamais traité » au 2e appel : ça lève encore.
  assert.throws(() => c.indexContient_('drive|aaa'), /timeout/);
  assert.throws(() => c.estDoublon_('h1'), /timeout/);
});

test('Index : après une panne, la relecture réussie publie les trois caches COMPLETS', () => {
  const c = load(['Config.gs', 'Journal.gs']);
  const opts = { leve: true };
  ctxIndex(c, opts);
  c._indexCache = null; c._empreintesCache = null; c._empreintesParIdCache = null;
  assert.throws(() => c.indexContient_('drive|aaa'), /timeout/);
  opts.leve = false;
  assert.strictEqual(c.indexContient_('drive|ccc'), true);
  assert.strictEqual(c.estDoublon_('h2'), true);
  assert.strictEqual(Object.keys(c._indexCache).length, 3);
});
