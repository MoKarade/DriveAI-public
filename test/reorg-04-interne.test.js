'use strict';
/**
 * ADR-0081 §2.4 (vague 4c) — Réorganisation interne autonome de `04 · Immigration`,
 * journalisée dans `Actions` avec annulation 1-clic et coupure au frein budget 30 $.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

function fakeEnv04() {
  const actionsRows = [['Id', 'Horodatage', 'Type', 'Cible', 'Avant', 'Après', 'Statut', 'Détail']];
  const index = new Set();
  const props = {};
  const dossiers = {};
  const fichiers = {};
  const deplacements = [];

  const creerDossier = (id, nom, parentId) => {
    dossiers[id] = { id, nom, parentId, fils: [], sous: [] };
    if (parentId && dossiers[parentId]) dossiers[parentId].sous.push(id);
  };
  creerDossier('DOS_04', '04 · Immigration', null);

  const folderWrap = (id) => {
    const d = dossiers[id];
    return {
      getId: () => d.id,
      getName: () => d.nom,
      getFiles: () => iter(d.fils.map((fid) => fileWrap(fid))),
      getFolders: () => iter(d.sous.map((sid) => folderWrap(sid))),
      getFoldersByName: (nom) => {
        const match = d.sous.filter((sid) => dossiers[sid].nom === nom).map((sid) => folderWrap(sid));
        return iter(match);
      },
      createFolder: (nom) => {
        const nid = 'DOS_' + (Object.keys(dossiers).length + 1);
        creerDossier(nid, nom, d.id);
        return folderWrap(nid);
      },
      getParents: () => iter(d.parentId ? [folderWrap(d.parentId)] : []),
      addFile: (f) => {
        const fid = f.getId();
        if (!d.fils.includes(fid)) d.fils.push(fid);
        if (!fichiers[fid].parents.includes(id)) fichiers[fid].parents.push(id);
      },
      removeFile: (f) => {
        const fid = f.getId();
        d.fils = d.fils.filter((x) => x !== fid);
        fichiers[fid].parents = fichiers[fid].parents.filter((p) => p !== id);
      },
    };
  };

  const fileWrap = (id) => {
    const f = fichiers[id];
    return {
      getId: () => f.id,
      getName: () => f.nom,
      getParents: () => iter(f.parents.map((pid) => folderWrap(pid))),
    };
  };

  const ajouterFichier = (id, nom, parentId) => {
    fichiers[id] = { id, nom, parents: [parentId] };
    dossiers[parentId].fils.push(id);
  };

  const sheetActions = {
    getLastRow: () => actionsRows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => actionsRows.slice(r - 1, r - 1 + nr).map((l) => l.slice(c - 1, c - 1 + nc)),
      setValue: (v) => { actionsRows[r - 1][c - 1] = v; },
    }),
    appendRow: (row) => { actionsRows.push([...row]); },
  };

  const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Actions.gs', 'Reset.gs'], {
    DriveApp: {
      getFolderById: (id) => folderWrap(id),
      getFileById: (id) => fileWrap(id),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    feuille_: () => sheetActions,
    indexContient_: (cle) => index.has(cle),
    indexAjouter_: (cle) => { index.add(cle); },
    journalInfo_: () => {},
    journalErreur_: (_s, m) => { throw new Error('Erreur inattendue: ' + m); },
    deplacerEtRenommer_: (fid, dest, src, nom) => {
      deplacements.push({ fid, dest, src, nom });
      return true;
    },
  });
  ctx.nbParentsBorne_ = (f) => { const p = f.getParents(); let n = 0; while (p.hasNext()) { p.next(); n++; } return n; };
  ctx.sousDossier_ = (parent, nom) => { const it = parent.getFoldersByName(nom); return it.hasNext() ? it.next() : parent.createFolder(nom); };
  ctx.segmentsSousDomaine_ = () => [];
  ctx.ensembleDomainesProteges_ = () => ({ '04 · Immigration': true });
  ctx.detecterDossierVide_ = () => {};
  ctx.CONFIG.DOMAINES['04 · Immigration'] = 'DOS_04';
  return { ctx, dossiers, fichiers, actionsRows, index, props, deplacements, ajouterFichier, creerDossier };
}

test('reorganiserInterne04_ : déplace en interne, journalise Actions et reste annulable en 1 clic', () => {
  const { ctx, fichiers, actionsRows, deplacements, ajouterFichier } = fakeEnv04();
  ajouterFichier('F_IRCC', '2025-03-10_Lettre officielle_IRCC.pdf', 'DOS_04');

  const ok = ctx.reorganiserInterne04_('F_IRCC', 'v4c-04', {});
  assert.strictEqual(ok, true);
  assert.strictEqual(fichiers.F_IRCC.parents.length, 1);
  assert.notStrictEqual(fichiers.F_IRCC.parents[0], 'DOS_04');

  assert.strictEqual(actionsRows.length, 2);
  assert.strictEqual(actionsRows[1][2], 'drive-deplacer');
  assert.strictEqual(actionsRows[1][3], 'F_IRCC');
  assert.strictEqual(actionsRows[1][7], 'reorg-interne-04');

  const undo = ctx.annulerAction_(actionsRows[1][0]);
  assert.strictEqual(undo.ok, true);
  assert.strictEqual(deplacements.length, 1);
  assert.strictEqual(deplacements[0].dest, 'DOS_04');
});

test('appliquerReorgInterne04Autonome_ : lots bornés, arrêt au frein budget et convergence exacte', () => {
  const { ctx, fichiers, actionsRows, props, ajouterFichier } = fakeEnv04();
  ajouterFichier('F1', '2025-01-10_Certificat sélection_MIFI.pdf', 'DOS_04');
  ajouterFichier('F2', '2025-02-10_Lettre_IRCC.pdf', 'DOS_04');
  ajouterFichier('F3', '2025-03-10_Note diverse.pdf', 'DOS_04'); // non routable -> reste à DOS_04

  // 1. Frein budget 30 $ actif → aucune exécution
  ctx.budgetCampagnesAtteint_ = () => true;
  assert.strictEqual(ctx.appliquerReorgInterne04Autonome_(() => false), false);
  assert.strictEqual(fichiers.F1.parents[0], 'DOS_04');
  assert.strictEqual(actionsRows.length, 1);

  // 2. Lot borné à 2 fichiers max/run → traite F1 + F2, F3 reste pour le tick suivant
  ctx.budgetCampagnesAtteint_ = () => false;
  ctx.CONFIG.REORG_04_INTERNE_MAX_PAR_RUN = 2;
  assert.strictEqual(ctx.appliquerReorgInterne04Autonome_(() => false), true);
  assert.strictEqual(actionsRows.length, 3, '2 déplacements journalisés');
  assert.strictEqual(props.DriveAI_REORG_04_INTERNE, undefined, 'pas encore figé tant que la passe n est pas vide');

  // 3. Tick suivant : traite F3 (reste à DOS_04 sans action) puis tick final vide → tag posé
  assert.strictEqual(ctx.appliquerReorgInterne04Autonome_(() => false), true);
  assert.strictEqual(fichiers.F3.parents[0], 'DOS_04');
  assert.strictEqual(ctx.appliquerReorgInterne04Autonome_(() => false), false);
  assert.strictEqual(props.DriveAI_REORG_04_INTERNE, 'v4c-04');
});
