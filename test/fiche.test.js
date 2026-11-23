'use strict';
/**
 * ADR-0081 (vague 1) — la FICHE du propriétaire : compteurs d'habitudes par expéditeur.
 * Verrouille : le calcul pur (signaux, fusion, importance — « inconnu » sous 3 fils, jamais deviné),
 * la lecture Gmail SANS écriture et SANS contenu, le curseur (un fil n'est compté qu'une fois par
 * nouveau message), le plafond de fils et le garde-temps.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));
const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Fiche.gs']);

test('signauxFil_ : lu, répondu, étoilé, et « sans lire » seulement si non lu ET sorti de la boîte', () => {
  const s = (o) => plain(c.signauxFil_(Object.assign({ adresse: 'A@B.C', nonLu: false, etoile: false, marcARepondu: false, dansBoite: true }, o)));
  assert.deepStrictEqual(s({}), { adresse: 'a@b.c', lu: 1, repondu: 0, etoile: 0, sansLire: 0 });
  assert.deepStrictEqual(s({ marcARepondu: true, etoile: true }), { adresse: 'a@b.c', lu: 1, repondu: 1, etoile: 1, sansLire: 0 });
  assert.strictEqual(s({ nonLu: true, dansBoite: true }).sansLire, 0, 'non lu mais encore en boîte : pas ignoré');
  assert.strictEqual(s({ nonLu: true, dansBoite: false }).sansLire, 1);
});

test('fusionnerFiche_ : ajoute sans muter la ligne reçue, garde le dernier fil le plus récent', () => {
  const base = { vus: 2, lus: 2, repondus: 1, etoiles: 0, sansLire: 0, dernier: 500 };
  const copie = plain(base);
  const r = plain(c.fusionnerFiche_(base, { lu: 1, repondu: 1, etoile: 1, sansLire: 0 }, 400, 999));
  assert.deepStrictEqual(r, { vus: 3, lus: 3, repondus: 2, etoiles: 1, sansLire: 0, dernier: 500, maj: 999 });
  assert.deepStrictEqual(plain(base), copie, 'entrée intacte');
  assert.strictEqual(c.fusionnerFiche_(null, { lu: 0, repondu: 0, etoile: 0, sansLire: 1 }, 7, 8).vus, 1, 'ligne inédite');
});

test('importanceFiche_ : inconnu sous 3 fils ; une réponse pèse plus qu\'une lecture ; les fils ignorés font baisser', () => {
  const L = (o) => Object.assign({ vus: 10, lus: 0, repondus: 0, etoiles: 0, sansLire: 0 }, o);
  assert.strictEqual(c.importanceFiche_(null).niveau, 'inconnu');
  assert.strictEqual(c.importanceFiche_(L({ vus: 2, repondus: 2 })).niveau, 'inconnu', 'deux fils ne prouvent rien');
  assert.strictEqual(c.importanceFiche_(L({ lus: 10, repondus: 8 })).niveau, 'haut');
  assert.strictEqual(c.importanceFiche_(L({ lus: 10 })).niveau, 'moyen', 'toujours lu, jamais répondu');
  assert.strictEqual(c.importanceFiche_(L({ lus: 1, sansLire: 8 })).niveau, 'bas');
  assert.strictEqual(c.importanceFiche_(L({ sansLire: 10 })).score, 0, 'jamais sous 0');
  assert.ok(c.importanceFiche_(L({ repondus: 10, lus: 10, etoiles: 10 })).score <= 1);
});

/* ---------- lecture Gmail simulée ---------- */

function fil(dernierMs, messages, { nonLu = false, dansBoite = true } = {}) {
  return {
    getLastMessageDate: () => new Date(dernierMs),
    getMessages: () => messages.map((m) => ({ getFrom: () => m.de, isStarred: () => !!m.etoile })),
    isUnread: () => nonLu,
    isInInbox: () => dansBoite,
  };
}

function monde(fils, { curseur = null, lignes = [] } = {}) {
  const ctx = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Fiche.gs']);
  ctx.CONFIG.PROPRIETAIRE_EMAIL = 'moi@exemple.com';
  const store = curseur === null ? {} : { DriveAI_FICHE_CURSEUR: String(curseur) };
  const recherches = [];
  const sheet = { entetes: null, lignes: lignes.map((l) => l.slice()), ecrits: [] };
  ctx.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; } }) };
  ctx.GmailApp = { search: (q, d, n) => { recherches.push({ q, d, n }); return fils; } };
  ctx.feuille_ = () => ({
    getLastRow: () => sheet.lignes.length + 1,
    getRange: (r, col, nb) => ({
      getValues: () => sheet.lignes.map((l) => l.slice()),
      setValues: (v) => { sheet.lignes[r - 2] = v[0]; sheet.ecrits.push('maj'); } }),
    appendRow: (l) => { sheet.lignes.push(l); sheet.ecrits.push('ajout'); },
  });
  const infos = [];
  ctx.journalInfo_ = (s, m) => infos.push(m);
  return { ctx, store, sheet, recherches, infos };
}

test('apprendreFiche_ : compte chaque fil, écrit des compteurs seuls, avance le curseur, ne touche à rien dans Gmail', () => {
  const maintenant = Date.now();
  const fils = [
    fil(maintenant - 1000, [{ de: 'Ami <ami@x.fr>' }, { de: 'moi@exemple.com' }], { dansBoite: false }),
    fil(maintenant - 2000, [{ de: 'Banque <info@banque.fr>', etoile: true }], { nonLu: true, dansBoite: false }),
    fil(maintenant - 3000, [{ de: 'moi@exemple.com' }]),                    // seul à écrire : ignoré
  ];
  const w = monde(fils);
  const n = w.ctx.apprendreFiche_(() => false);
  assert.strictEqual(n, 2);
  assert.strictEqual(w.recherches.length, 1);
  assert.strictEqual(w.recherches[0].n, w.ctx.CONFIG.FICHE_MAX_FILS, 'plafond de fils respecté');
  const par = Object.fromEntries(w.sheet.lignes.map((l) => [l[0], l]));
  assert.deepStrictEqual(plain(par['ami@x.fr'].slice(1, 6)), [1, 1, 1, 0, 0]);
  assert.deepStrictEqual(plain(par['info@banque.fr'].slice(1, 6)), [1, 0, 0, 1, 1]);
  for (const l of w.sheet.lignes) l.forEach((v) => assert.ok(typeof v !== 'string' || /^[^ ]+@[^ ]+$/.test(v), 'que l\'adresse nue et des nombres : ' + v));
  assert.strictEqual(w.store.DriveAI_FICHE_CURSEUR, String(maintenant - 1000), 'curseur = fil le plus récent appris');
  assert.strictEqual(w.infos.length, 1);
});

test('apprendreFiche_ : un fil déjà appris (≤ curseur) n\'est pas recompté, et un nouveau message du même expéditeur MET À JOUR sa ligne', () => {
  const t0 = Date.now() - 10000;
  const existant = [['ami@x.fr', 4, 4, 1, 0, 0, t0 - 5000, new Date(t0)]];
  const w = monde([
    fil(t0 + 5000, [{ de: 'ami@x.fr' }]),     // nouveau depuis le curseur
    fil(t0 - 1000, [{ de: 'ami@x.fr' }]),     // déjà appris → arrêt de la lecture ici
  ], { curseur: t0, lignes: existant });
  const n = w.ctx.apprendreFiche_(() => false);
  assert.strictEqual(n, 1);
  assert.strictEqual(w.sheet.lignes.length, 1, 'pas de doublon d\'adresse');
  assert.strictEqual(w.sheet.lignes[0][1], 5, 'fils vus 4 → 5');
  assert.deepStrictEqual(w.sheet.ecrits, ['maj']);
});

test('apprendreFiche_ : garde-temps — budget épuisé, rien lu, rien écrit, curseur inchangé', () => {
  const w = monde([fil(Date.now(), [{ de: 'a@b.fr' }])]);
  assert.strictEqual(w.ctx.apprendreFiche_(() => true), 0);
  assert.deepStrictEqual(w.sheet.lignes, []);
  assert.deepStrictEqual(w.store, {});
});

test('la fiche est branchée : onglet créé, étape au tick après le tri, étape au registre du suivi', () => {
  const fs = require('fs');
  const lire = (f) => fs.readFileSync(require('path').join(__dirname, '..', 'src', f), 'utf8');
  assert.match(lire('Journal.gs'), /creerOnglet_\(ss, 'Fiche', COLONNES_FICHE\)/);
  assert.match(lire('Suivi.gs'), /cle: 'fiche-apprentissage'/);
  const main = lire('Main.gs');
  const iTri = main.indexOf('trierFilsGmail_(estBudgetDepasseStandard)');
  const iFiche = main.indexOf('apprendreFiche_(estBudgetDepasseStandard)');
  assert.ok(iTri !== -1 && iFiche > iTri, 'la fiche apprend APRÈS le tri (le flux vivant d\'abord)');
});
