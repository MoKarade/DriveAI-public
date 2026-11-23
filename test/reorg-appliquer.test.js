'use strict';
/**
 * APPLICATION DES RANGEMENTS VALIDÉS (Reorg.gs). Ces tests exerçaient `appliquerDeplacerFichier_`,
 * `appliquerUneAction_` et la convergence dans `test/chat-reorg.test.js` (chat à outils, ADR-0026) ;
 * le chat est retiré par l'ADR-0074 (05/11/2026), mais ces fonctions restent VIVANTES : elles
 * appliquent les lignes `validé` de l'onglet `Réorg` (`appliquerReorgValidee_`, bandeau « À valider »
 * de l'app) et servent `Maintenance.gs`. Verrous conservés : déplacement de FICHIER gardé (§1 source
 * ET cible, moveTo seul, épinglage), création de dossier bornée, CONVERGENCE (un fichier épinglé est
 * immunisé des campagnes de re-rangement).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');
const plat = (o) => JSON.parse(JSON.stringify(o));

function chargerReorg() {
  const c = load(['Config.gs', 'Reorg.gs']);
  // Dépendances inter-modules (Maintenance/Journal non chargés) : contrôlées par test.
  c.aParentProtege_ = (f) => f && f.__protege === true;          // source en zone protégée ?
  c.chaineMonteVersProtege_ = (d) => d && d.__protege === true;  // cible en zone protégée ?
  c._epingles = {};
  c.indexContient_ = (cle) => c._epingles[cle] === true;
  c._ajouts = [];
  c.indexAjouter_ = (cle, r) => { c._epingles[cle] = true; c._ajouts.push([cle, r.statut]); };
  return c;
}

test('appliquerDeplacerFichier_ : succès → moveTo(cible) + épinglage `epingle|<id>`', () => {
  const c = chargerReorg();
  let deplaceVers = null;
  const fichier = { getName: () => 'nas.txt', getMimeType: () => 'text/plain', moveTo: (d) => { deplaceVers = d; } };
  const cible = { getName: () => 'Réseau', getId: () => 'D1' };
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => cible };
  const r = c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {});
  assert.strictEqual(r.statut, 'appliqué');
  assert.strictEqual(deplaceVers, cible, 'moveTo appelé vers la cible');
  assert.deepStrictEqual(plat(c._ajouts), [['epingle|F1', 'épinglé']]);
});

test('appliquerDeplacerFichier_ : SOURCE qui est un DOSSIER → refusé (structure), aucun move', () => {
  const c = chargerReorg();
  let bouge = false;
  // getFileById accepte un ID de dossier → on doit refuser par le MIME (jamais reloger une racine).
  const dossierEnSource = { getName: () => '04 · Immigration', getMimeType: () => 'application/vnd.google-apps.folder', moveTo: () => { bouge = true; } };
  c.DriveApp = { getFileById: () => dossierEnSource, getFolderById: () => ({ getName: () => 'x', getId: () => 'D1' }) };
  const r = c.appliquerDeplacerFichier_({ source: 'DOMROOT', cible: 'D1' }, {});
  assert.ok(/structure/.test(r.statut), r.statut);
  assert.strictEqual(bouge, false);
  assert.strictEqual(c._ajouts.length, 0);
});

test('appliquerDeplacerFichier_ : SOURCE en zone protégée → refusé, aucun move', () => {
  const c = chargerReorg();
  let bouge = false;
  const fichier = { getName: () => 'passeport.pdf', getMimeType: () => 'application/pdf', __protege: true, moveTo: () => { bouge = true; } };
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => 'x', getId: () => 'D1' }) };
  const r = c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {});
  assert.ok(/zone protégée/.test(r.statut), r.statut);
  assert.strictEqual(bouge, false);
  assert.strictEqual(c._ajouts.length, 0);
});

test('appliquerDeplacerFichier_ : CIBLE protégée / système → refusé', () => {
  const c = chargerReorg();
  const fichier = { getName: () => 'x', getMimeType: () => 'application/pdf', moveTo: () => {} };
  // cible sous zone protégée
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => 'Titres', getId: () => 'D9', __protege: true }) };
  assert.ok(/zone protégée|système/.test(c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D9' }, {}).statut));
  // cible = file système « _… »
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => '_Doublons', getId: () => 'D8' }) };
  assert.ok(/protégée|système/.test(c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D8' }, {}).statut));
});

test('appliquerDeplacerFichier_ : fichier/cible introuvable → échec (jamais un plantage) ; idempotent', () => {
  const c = chargerReorg();
  c.DriveApp = { getFileById: () => { throw new Error('404'); }, getFolderById: () => ({ getName: () => 'x', getId: () => 'D1' }) };
  assert.strictEqual(c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {}).statut, 'échec');
  assert.strictEqual(c.appliquerDeplacerFichier_({ cible: 'D1' }, {}).statut, 'échec'); // source manquante

  // Idempotence : un rejeu (déjà épinglé) ne ré-écrit pas la clé, moveTo reste un no-op sûr.
  const c2 = chargerReorg();
  c2._epingles['epingle|F1'] = true;
  const fichier = { getName: () => 'x', getMimeType: () => 'application/pdf', moveTo: () => {} };
  c2.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => 'Réseau', getId: () => 'D1' }) };
  assert.strictEqual(c2.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {}).statut, 'appliqué');
  assert.strictEqual(c2._ajouts.length, 0, 'épinglage non dupliqué');
});

test('creer : DANS un domaine/catégorie (intouchable) → AUTORISÉ ; refusé dans 04 et dans À trier', () => {
  const c = chargerReorg();
  let cree = null;
  const parent = { getName: () => 'Véhicule', getFoldersByName: () => ({ hasNext: () => false }), createFolder: (n) => { cree = n; } };
  c.DriveApp = { getFolderById: () => parent };
  // Catégorie intouchable comme parent : créer un ENFANT ne mute pas le parent → autorisé (demande Marc).
  const ok = c.appliquerUneAction_({ type: 'creer', cible: 'CAT1', cheminPropose: 'Véhicule/Garage' }, {}, { CAT1: true }, () => false);
  assert.strictEqual(ok.statut, 'appliqué');
  assert.strictEqual(cree, 'Garage');
  // Zone protégée (04) → refusé.
  assert.ok(/protégé|zone/.test(
    c.appliquerUneAction_({ type: 'creer', cible: 'IMM', cheminPropose: 'x/y' }, { IMM: true }, {}, () => false).statut));
  // À trier → refusé (le retrait d'`intouchables` ne doit PAS ré-ouvrir la création dans l'intake).
  assert.ok(/protégé|zone/.test(
    c.appliquerUneAction_({ type: 'creer', cible: c.CONFIG.DOSSIERS.A_TRIER, cheminPropose: 'x/y' }, {}, {}, () => false).statut));
});

test('creer (#475) : un homonyme à la CORBEILLE ne compte pas → le dossier est vraiment créé', () => {
  const c = chargerReorg();
  const itere = (liste) => { let i = 0; return { hasNext: () => i < liste.length, next: () => liste[i++] }; };
  const cas = (homonymes) => {
    const cree = [];
    const parent = {
      getName: () => 'Véhicule',
      getFoldersByName: () => itere(homonymes),
      createFolder: (n) => { cree.push(n); },
    };
    c.DriveApp = { getFolderById: () => parent };
    const r = c.appliquerUneAction_({ type: 'creer', cible: 'CAT1', cheminPropose: 'Véhicule/Garage' }, {}, {}, () => false);
    return { r, cree };
  };
  const corbeille = { isTrashed: () => true };
  const vivant = { isTrashed: () => false };
  // Un seul homonyme, à la corbeille → créé.
  let o = cas([corbeille]);
  assert.strictEqual(o.r.statut, 'appliqué');
  assert.deepStrictEqual([...o.cree], ['Garage']);
  // Homonyme à la corbeille PUIS un vivant → rien à créer (idempotence au rejeu conservée).
  o = cas([corbeille, vivant]);
  assert.strictEqual(o.r.statut, 'appliqué');
  assert.strictEqual(o.cree.length, 0);
  // Aucun homonyme → créé.
  o = cas([]);
  assert.deepStrictEqual([...o.cree], ['Garage']);
  // isTrashed() lève → l'exception sort (l'appelant dit « échec »), jamais un « appliqué » muet.
  assert.throws(() => cas([{ isTrashed: () => { throw new Error('illisible'); } }]), /illisible/);
});

test('actionsValidees_ : le type deplacer-fichier est reconnu (source→cible)', () => {
  const c = load(['Config.gs', 'Reorg.gs']);
  const lignes = [
    ['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté'],
    ['chatreorg|1|1', 'deplacer-fichier', 'F1→D1', 'nas.txt', 'Réseau', 'validé', 'range', 't'],
  ];
  const v = c.actionsValidees_(lignes);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].type, 'deplacer-fichier');
  assert.strictEqual(v[0].source, 'F1');
  assert.strictEqual(v[0].cible, 'D1');
});

/* --------------------------- convergence (épinglé immunise) --------------------------- */

test('convergence : un fichier épinglé est IGNORÉ par migration / réanalyse / grand rangement', () => {
  const epingle = (cle) => cle === 'epingle|PINNED';

  const m = load(['Config.gs', 'Migration.gs']);
  m.indexContient_ = epingle;
  const pin = { getId: () => 'PINNED', getMimeType: () => 'application/pdf', getName: () => 'Inconnu doc' };
  const libre = { getId: () => 'X', getMimeType: () => 'application/pdf', getName: () => 'Inconnu doc' };
  assert.strictEqual(m.estAMigrer_(pin, 't'), false, 'épinglé → jamais migré');
  assert.strictEqual(m.estAMigrer_(libre, 't'), true, 'non épinglé « Inconnu » → migrable (pas de faux skip)');
  assert.strictEqual(m.estAReanalyser_(pin, 't'), false, 'épinglé → jamais réanalysé');
  assert.strictEqual(m.estAReanalyser_(libre, 't'), true);

  const mn = load(['Config.gs', 'Maintenance.gs']);
  mn.indexContient_ = epingle;
  assert.strictEqual(mn.estAReclasserLeger_({ getName: () => 'vrac', getId: () => 'PINNED', getMimeType: () => 'application/pdf' }), false);
  assert.strictEqual(mn.estAReclasserLeger_({ getName: () => 'vrac', getId: () => 'X', getMimeType: () => 'application/pdf' }), true);
});

test('convergence : collecterConsolidation_ saute les fichiers épinglés', () => {
  const c = load(['Config.gs', 'Consolidation.gs']);
  c.indexContient_ = (cle) => cle === 'epingle|PINNED'; // ni conso| ni autre épingle
  const f = (id) => ({ getId: () => id });
  const dossier = { getFiles: () => iterLocal([f('PINNED'), f('LIBRE')]), getFolders: () => iterLocal([]) };
  const items = [];
  c.collecterConsolidation_(dossier, '02', items, 100, () => false, 'tag', { complet: true }, {});
  assert.deepStrictEqual(items.map((i) => i.id), ['LIBRE'], 'PINNED exclu, LIBRE collecté');
});

function iterLocal(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
