'use strict';
/**
 * Tests du moteur proactif Copilote (Lot 2A : #5 cascade & #6 anti-doublons/vides/corbeille).
 * Données 100 % fictives uniquement (`FICTIF_*`, `@exemple.test`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

function makeSheetHarness(initial) {
  const sheets = Object.assign({
    Copilote: [['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations']],
    Index: [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire']],
    Actions: [['Id', 'Horodatage', 'Type', 'Cible', 'Avant', 'Après', 'Statut', 'Détail']],
    Journal: [['Horodatage', 'Niveau', 'Source', 'Message']],
    Entités: [['Domaine', 'Entité', 'Type', 'Statut', 'Dossier ID', 'Variante', 'Vu', 'Maj', 'Note']],
  }, initial || {});
  const sheetObj = (nom) => {
    const rows = sheets[nom] || (sheets[nom] = [['Clé']]);
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] ? rows[0].length : 1),
      appendRow: (r) => { rows.push(r.slice()); },
      getRange: (r, c, nr, nc) => ({
        getValue: () => (rows[r - 1] ? rows[r - 1][c - 1] : ''),
        setValue: (v) => {
          while (rows.length < r) rows.push([]);
          rows[r - 1][c - 1] = v;
        },
        setValues: (mat) => {
          for (let i = 0; i < mat.length; i++) {
            while (rows.length < r + i) rows.push([]);
            for (let j = 0; j < mat[i].length; j++) rows[r + i - 1][c + j - 1] = mat[i][j];
          }
        },
        getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map((row) => {
          const out = [];
          for (let k = 0; k < (nc || 1); k++) out.push(row[c - 1 + k]);
          return out;
        }),
      }),
    };
  };
  return { sheets, feuille_: sheetObj };
}

function makeDriveHarness(filesMap, foldersMap) {
  const moves = [];
  const patches = [];
  const wrapFolder = (id) => {
    const d = foldersMap[id];
    if (!d) throw new Error('Dossier introuvable ' + id);
    return {
      getId: () => d.id,
      getName: () => d.name,
      isTrashed: () => !!d.trashed,
      getParents: () => {
        if (d.throwParents) throw new Error('Accès parents refusé');
        return iter((d.parents || []).map(wrapFolder));
      },
      getFiles: () => iter((d.files || []).map((fid) => wrapFile(fid))),
      getFolders: () => iter((d.folders || []).map((sid) => wrapFolder(sid))),
      createFolder: (nom) => {
        const nid = 'FICTIF_CREATED_' + nom.replace(/\s+/g, '_');
        foldersMap[nid] = { id: nid, name: nom, parents: [d.id], files: [], folders: [] };
        d.folders = d.folders || [];
        d.folders.push(nid);
        return wrapFolder(nid);
      },
    };
  };
  const wrapFile = (id) => {
    const f = filesMap[id];
    if (!f) throw new Error('Fichier introuvable ' + id);
    return {
      getId: () => f.id,
      getName: () => f.name,
      isTrashed: () => !!f.trashed,
      getParents: () => {
        if (f.throwParents) throw new Error('Accès parents refusé');
        return iter((f.parents || []).map(wrapFolder));
      },
    };
  };
  return {
    moves,
    patches,
    DriveApp: {
      getFolderById: wrapFolder,
      getFileById: wrapFile,
      getRootFolder: () => wrapFolder('FICTIF_ROOT'),
    },
    deplacerEtRenommer_: (fid, dst, src, nom) => {
      moves.push({ fid, dst, src, nom });
      const obj = filesMap[fid] || foldersMap[fid];
      if (!obj) return false;
      obj.parents = [dst];
      if (foldersMap[src] && foldersMap[src].files) foldersMap[src].files = foldersMap[src].files.filter((x) => x !== fid);
      if (foldersMap[src] && foldersMap[src].folders) foldersMap[src].folders = foldersMap[src].folders.filter((x) => x !== fid);
      if (foldersMap[dst]) {
        if (filesMap[fid]) { foldersMap[dst].files = foldersMap[dst].files || []; foldersMap[dst].files.push(fid); }
        else { foldersMap[dst].folders = foldersMap[dst].folders || []; foldersMap[dst].folders.push(fid); }
      }
      return true;
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const body = opts && opts.payload ? JSON.parse(opts.payload) : {};
        patches.push({ url, method: opts && opts.method, body });
        const m = /files\/([^/?]+)/.exec(url);
        if (m) {
          const id = decodeURIComponent(m[1]);
          if (filesMap[id] && typeof body.trashed === 'boolean') filesMap[id].trashed = body.trashed;
        }
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: 'ok', trashed: false }) };
      },
    },
  };
}

function ctxCopilote(opts) {
  opts = opts || {};
  const sh = makeSheetHarness(opts.sheets);
  const files = Object.assign({}, opts.files);
  const folders = Object.assign({
    FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [], files: [], folders: [] },
    FICTIF_TECH: { id: 'FICTIF_TECH', name: '_Technique', parents: ['FICTIF_ROOT'], files: [], folders: [] },
  }, opts.folders);
  const dr = makeDriveHarness(files, folders);
  const props = Object.assign({ DriveAI_TECHNIQUE_ID: 'FICTIF_TECH' }, opts.props);

  const c = load(['Config.gs', 'Entites.gs', 'DriveRest.gs', 'Maintenance.gs', 'VeilleDrive.gs', 'Fusion.gs', 'Reorg.gs', 'Actions.gs', 'Journal.gs', 'Copilote.gs'], {
    DriveApp: dr.DriveApp,
    UrlFetchApp: dr.UrlFetchApp,
    ScriptApp: { getOAuthToken: () => 'JETON_FICTIF' },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
  });
  c.feuille_ = sh.feuille_;
  c.journalInfo_ = (s, m) => sh.sheets.Journal.push([new Date(), 'INFO', s, m]);
  c.journalErreur_ = (s, m) => sh.sheets.Journal.push([new Date(), 'ERREUR', s, m]);
  c.deplacerEtRenommer_ = dr.deplacerEtRenommer_;
  c.dossierTechnique_ = () => dr.DriveApp.getFolderById('FICTIF_TECH');
  c.sousDossier_ = (parent, nom) => {
    const it = parent.getFolders();
    while (it.hasNext()) {
      const f = it.next();
      if (f.getName() === nom && !f.isTrashed()) return f;
    }
    return parent.createFolder(nom);
  };
  return { c, sh, dr, files, folders, props };
}

test('candidatsCascade_ : regroupe les docs dispersés et exclut zones protégées, système et epingle|', () => {
  const { c } = ctxCopilote();
  const lignes = [
    ['drive|FICTIF_DOC_0000000001', new Date(), '2025-01-10_Facture_FournisseurX.pdf', '02 · Finances', '02 · Finances/Divers', 'classé', '', '', 'FICTIF_DOC_0000000001'],
    ['drive|FICTIF_DOC_0000000002', new Date(), '2025-02-10_Facture_FournisseurX.pdf', '04 · Immigration', '04 · Immigration/Preuves', 'classé', '', '', 'FICTIF_DOC_0000000002'],
    ['drive|FICTIF_DOC_0000000003', new Date(), '2025-03-10_Facture_FournisseurX.pdf', 'Anna', 'Anna/Sante', 'manuel', '', '', 'FICTIF_DOC_0000000003'],
    ['drive|FICTIF_DOC_0000000004', new Date(), '2025-04-10_Facture_FournisseurX.pdf', '00 · À trier', '00 · À trier', 'classé', '', '', 'FICTIF_DOC_0000000004'],
    ['drive|FICTIF_DOC_0000000005', new Date(), '2025-05-10_Facture_FournisseurX.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/FournisseurX', 'classé', '', '', 'FICTIF_DOC_0000000005'],
    ['drive|FICTIF_DOC_0000000006', new Date(), '2025-06-10_Facture_FournisseurX.pdf', '08 · Perso & projets', '08 · Perso & projets/Vrac', 'déplacé', '', '', 'FICTIF_DOC_0000000006'],
    // FICTIF_DOC_0000000001 déplacé plus tard vers _Technique → sa dernière ligne prime donc exclu
    ['drive|FICTIF_DOC_0000000001', new Date(), '2025-01-10_Facture_FournisseurX.pdf', '_Technique', '_Technique', 'déplacé', '', '', 'FICTIF_DOC_0000000001'],
    ['drive|FICTIF_DOC_0000000007', new Date(), '2025-07-10_Facture_FournisseurX.pdf', '02 · Finances', '02 · Finances/Archives', 'classé', '', '', 'FICTIF_DOC_0000000007'],
  ];
  const res = c.candidatsCascade_(lignes, '03 · Logement & véhicule', '03 · Logement & véhicule/FournisseurX', 'FICTIF_CIBLE', 'FournisseurX', { FICTIF_DOC_0000000007: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.map((r) => r.fileId))), ['FICTIF_DOC_0000000006']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.candidatsCascade_(lignes, '04 · Immigration', '04 · Immigration/X', 'FICTIF_04', 'FournisseurX', {}))), []);
});

test('serialiserActionCopilote_ : borne ActionJson <= 500 caractères sans PII', () => {
  const { c } = ctxCopilote();
  const ids = Array.from({ length: 40 }, (_, i) => 'FICTIF_LONG_FILE_ID_' + String(i).padStart(8, '0'));
  const json = c.serialiserActionCopilote_({ cibleId: 'FICTIF_CIBLE', ids });
  assert.ok(json.length <= 500, 'ActionJson <= 500 chars (' + json.length + ')');
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.cibleId, 'FICTIF_CIBLE');
  assert.ok(parsed.ids.length >= 1 && parsed.ids.length < 40);
});

test('proposerCascadeDossier_ : déduplique, respecte aParentProtege_ strict et epingle|, exécute et annule en 1 clic', () => {
  const { c, sh, dr } = ctxCopilote({
    folders: {
      FICTIF_DOM03: { id: 'FICTIF_DOM03', name: '03 · Logement & véhicule', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_CIBLE'] },
      FICTIF_CIBLE: { id: 'FICTIF_CIBLE', name: 'FournisseurX', parents: ['FICTIF_DOM03'], files: [], folders: [] },
      FICTIF_VRAC: { id: 'FICTIF_VRAC', name: 'Vrac', parents: ['FICTIF_ROOT'], files: ['FICTIF_FILE_OK_00000001', 'FICTIF_FILE_EP_00000002', 'FICTIF_FILE_ST_00000003'], folders: [] },
    },
    files: {
      FICTIF_FILE_OK_00000001: { id: 'FICTIF_FILE_OK_00000001', name: '2025-01-01_Facture_FournisseurX.pdf', parents: ['FICTIF_VRAC'], trashed: false },
      FICTIF_FILE_EP_00000002: { id: 'FICTIF_FILE_EP_00000002', name: '2025-02-01_Facture_FournisseurX.pdf', parents: ['FICTIF_VRAC'], trashed: false },
      FICTIF_FILE_ST_00000003: { id: 'FICTIF_FILE_ST_00000003', name: '2025-03-01_Facture_FournisseurX.pdf', parents: ['FICTIF_VRAC'], trashed: false, throwParents: true },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|FICTIF_FILE_OK_00000001', new Date(), '2025-01-01_Facture_FournisseurX.pdf', '08 · Perso & projets', '08 · Perso & projets/Vrac', 'classé', '', '', 'FICTIF_FILE_OK_00000001'],
        ['drive|FICTIF_FILE_EP_00000002', new Date(), '2025-02-01_Facture_FournisseurX.pdf', '08 · Perso & projets', '08 · Perso & projets/Vrac', 'classé', '', '', 'FICTIF_FILE_EP_00000002'],
        ['epingle|FICTIF_FILE_EP_00000002', new Date(), '2025-02-01_Facture_FournisseurX.pdf', '08 · Perso & projets', '08 · Perso & projets/Vrac', 'manuel', '', '', 'FICTIF_FILE_EP_00000002'],
        ['drive|FICTIF_FILE_ST_00000003', new Date(), '2025-03-01_Facture_FournisseurX.pdf', '08 · Perso & projets', '08 · Perso & projets/Vrac', 'classé', '', '', 'FICTIF_FILE_ST_00000003'],
      ],
    },
  });

  const id1 = c.proposerCascadeDossier_({
    domaine: '03 · Logement & véhicule',
    chemin: '03 · Logement & véhicule/FournisseurX',
    parentId: 'FICTIF_CIBLE',
    emetteurOuSujet: 'FournisseurX',
  });
  const id2 = c.proposerCascadeDossier_({
    domaine: '03 · Logement & véhicule',
    chemin: '03 · Logement & véhicule/FournisseurX',
    parentId: 'FICTIF_CIBLE',
    emetteurOuSujet: 'FournisseurX',
  });
  assert.ok(id1);
  assert.strictEqual(id2, id1, 'déduplication des cartes ouvertes');
  assert.strictEqual(sh.sheets.Copilote.length, 2);
  const action = JSON.parse(sh.sheets.Copilote[1][7]);
  assert.deepStrictEqual(action.ids, ['FICTIF_FILE_OK_00000001'], 'epingle| et fail-closed exclus');

  const exec = c.executerDecisionCopilote_({ id: id1, decision: 'executer' });
  assert.strictEqual(exec.ok, true);
  assert.strictEqual(exec.statut, 'appliqué');
  assert.strictEqual(exec.actionIds.length, 1);
  assert.strictEqual(exec.nbValidations, 1);
  assert.strictEqual(exec.proposerAuto, false);
  assert.strictEqual(dr.moves.length, 1);
  assert.strictEqual(dr.moves[0].dst, 'FICTIF_CIBLE');

  // Annulation 1-clic via Actions.gs
  const undo = c.annulerAction_(exec.actionIds[0]);
  assert.strictEqual(undo.ok, true);
  assert.strictEqual(dr.moves.length, 2);
  assert.strictEqual(dr.moves[1].dst, 'FICTIF_VRAC');
});

test('alerte-corbeille (#6) : inclut 04 · Immigration et Anna, restaure via REST PATCH sans déplacer et reste non annulable', () => {
  const { c, sh, dr, files } = ctxCopilote({
    folders: {
      FICTIF_04: { id: 'FICTIF_04', name: '04 · Immigration', parents: ['FICTIF_ROOT'], files: ['FICTIF_IMMI_TRASH_0001'] },
      FICTIF_ANNA: { id: 'FICTIF_ANNA', name: 'Anna', parents: ['FICTIF_ROOT'], files: ['FICTIF_ANNA_TRASH_0002'] },
    },
    files: {
      FICTIF_IMMI_TRASH_0001: { id: 'FICTIF_IMMI_TRASH_0001', name: '2026-01-15_Permis_IRCC.pdf', parents: ['FICTIF_04'], trashed: true },
      FICTIF_ANNA_TRASH_0002: { id: 'FICTIF_ANNA_TRASH_0002', name: '2026-02-01_Assurance_Clinique.pdf', parents: ['FICTIF_ANNA'], trashed: true },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|FICTIF_IMMI_TRASH_0001', new Date(), '2026-01-15_Permis_IRCC.pdf', '04 · Immigration', '04 · Immigration/Permis', 'corbeillé', '', '', 'FICTIF_IMMI_TRASH_0001'],
        ['drive|FICTIF_ANNA_TRASH_0002', new Date(), '2026-02-01_Assurance_Clinique.pdf', 'Anna', 'Anna/Sante', 'corbeillé', '', '', 'FICTIF_ANNA_TRASH_0002'],
      ],
    },
  });
  c.CONFIG.DOMAINES = { '04 · Immigration': 'FICTIF_04' };
  c.domainesVeilleNonProteges_ = () => [];

  const etape = c.executerEtapeCopilote_(() => false);
  assert.strictEqual(etape.creees, 2, '2 alertes corbeille créées pour 04 · Immigration et Anna');
  const cartes = sh.sheets.Copilote.slice(1);
  const cImmi = cartes.find((r) => r[4] === '04 · Immigration');
  const cAnna = cartes.find((r) => r[4] === 'Anna');
  assert.ok(cImmi && cImmi[3] === 'alerte-corbeille');
  assert.ok(cAnna && cAnna[3] === 'alerte-corbeille');

  // passer-auto interdit sur alerte-corbeille
  assert.strictEqual(c.executerDecisionCopilote_({ id: cImmi[0], decision: 'passer-auto' }).ok, false);

  // restaurer fonctionne sur 04 · Immigration via REST PATCH { trashed: false } sans déplacer ni renommer
  const r = c.executerDecisionCopilote_({ id: cImmi[0], decision: 'restaurer' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.statut, 'appliqué');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.actionIds)), [], 'restaurer non annulable (aucune action Actions)');
  assert.strictEqual(dr.moves.length, 0, 'zéro déplacement');
  assert.strictEqual(dr.patches.length, 1);
  assert.strictEqual(dr.patches[0].body.trashed, false);
  assert.strictEqual(files.FICTIF_IMMI_TRASH_0001.trashed, false);
  assert.strictEqual(sh.sheets.Actions.length, 1, 'aucune entrée Actions ajoutée');
});

test('doublon-dossier et dossier-vide (#6) : détection, déplacement sûr vers _Technique/Dossiers vides et mode auto >= 3 validations', () => {
  const { c, sh, dr } = ctxCopilote({
    folders: {
      FICTIF_DOM05: { id: 'FICTIF_DOM05', name: '05 · Carrière', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_EMP1', 'FICTIF_EMP2', 'FICTIF_VIDE'] },
      FICTIF_EMP1: { id: 'FICTIF_EMP1', name: 'Employeur', parents: ['FICTIF_DOM05'], files: [], folders: [] },
      FICTIF_EMP2: { id: 'FICTIF_EMP2', name: 'Employeurs', parents: ['FICTIF_DOM05'], files: ['F_CV'], folders: [] },
      FICTIF_VIDE: { id: 'FICTIF_VIDE', name: 'Brouillons Divers', parents: ['FICTIF_DOM05'], files: [], folders: [] },
    },
    files: {
      F_CV: { id: 'F_CV', name: '2026-01-01_CV_Fictif.pdf', parents: ['FICTIF_EMP2'], trashed: false },
    },
  });
  c.CONFIG.DOMAINES = { '05 · Carrière': 'FICTIF_DOM05' };
  c.domainesVeilleNonProteges_ = () => [{ nom: '05 · Carrière', id: 'FICTIF_DOM05' }];
  c.collecterSousDossiersFusion_ = () => [
    { nom: 'Employeur', id: 'FICTIF_EMP1', nfiles: 0 },
    { nom: 'Employeurs', id: 'FICTIF_EMP2', nfiles: 1 },
    { nom: 'Brouillons Divers', id: 'FICTIF_VIDE', nfiles: 0 },
  ];

  const res = c.executerEtapeCopilote_(() => false);
  assert.ok(res.creees >= 2);
  const cartes = sh.sheets.Copilote.slice(1);
  const cVide = cartes.find((r) => r[3] === 'dossier-vide' && r[7].includes('FICTIF_VIDE'));
  const cDoub = cartes.find((r) => r[3] === 'doublon-dossier');
  assert.ok(cVide, 'carte dossier-vide créée');
  assert.ok(cDoub, 'carte doublon-dossier créée');

  // Simulation de 2 validations préexistantes → la 3e déclenche proposerAuto: true
  sh.sheets.Copilote[cartes.indexOf(cVide) + 1][9] = 2;
  const exVide = c.executerDecisionCopilote_({ id: cVide[0], decision: 'executer' });
  assert.strictEqual(exVide.ok, true);
  assert.strictEqual(exVide.nbValidations, 3);
  assert.strictEqual(exVide.proposerAuto, true);
  assert.strictEqual(dr.moves.length, 1);
  assert.strictEqual(dr.moves[0].fid, 'FICTIF_VIDE');
  assert.strictEqual(c.annulerAction_(exVide.actionIds[0]).ok, true, 'dossier-vide réversible en 1 clic');

  // passer-auto -> auto -> desactiver-auto -> proposé -> ignorer -> ignoré
  assert.strictEqual(c.executerDecisionCopilote_({ id: cDoub[0], decision: 'passer-auto' }).statut, 'auto');
  assert.strictEqual(c.executerDecisionCopilote_({ id: cDoub[0], decision: 'desactiver-auto' }).statut, 'proposé');
  assert.strictEqual(c.executerDecisionCopilote_({ id: cDoub[0], decision: 'ignorer' }).statut, 'ignoré');
});

test('executerEtapeCopilote_ : respecte COPILOTE_ACTIF: false et exécute les cartes cascade en mode auto', () => {
  const { c, sh, dr } = ctxCopilote({
    folders: {
      FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_CIBLE'] },
      FICTIF_CIBLE: { id: 'FICTIF_CIBLE', name: 'BanqueX', parents: ['FICTIF_DOM02'], files: [], folders: [] },
      FICTIF_AUTRE: { id: 'FICTIF_AUTRE', name: 'Autre', parents: ['FICTIF_ROOT'], files: ['F_AUTO'], folders: [] },
    },
    files: {
      F_AUTO: { id: 'F_AUTO', name: '2026-01-01_Releve_BanqueX.pdf', parents: ['FICTIF_AUTRE'], trashed: false },
    },
    sheets: {
      Copilote: [
        ['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations'],
        ['cop-auto-1', new Date(), 'carte', 'cascade', '02 · Finances', '02 · Finances/BanqueX', 'Cascade auto',
          JSON.stringify({ cibleId: 'FICTIF_CIBLE', ids: ['F_AUTO'] }), 'auto', 3],
      ],
    },
  });
  c.domainesVeilleNonProteges_ = () => [];

  c.CONFIG.COPILOTE_ACTIF = false;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.executerEtapeCopilote_(() => false))), { traitees: 0, creees: 0 });

  c.CONFIG.COPILOTE_ACTIF = true;
  const r = c.executerEtapeCopilote_(() => false);
  assert.strictEqual(r.traitees, 1);
  assert.strictEqual(dr.moves.length, 1);
  assert.strictEqual(sh.sheets.Copilote[1][8], 'appliqué');
});
