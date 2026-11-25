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

  const c = load(['Config.gs', 'Entites.gs', 'DriveRest.gs', 'Maintenance.gs', 'VeilleDrive.gs', 'Fusion.gs', 'Reorg.gs', 'Actions.gs', 'Journal.gs', 'Copilote.gs', 'Signaux.gs'], {
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


test('protection Drive physique : bloque Anna, les 6 zones système et 04 · Immigration même avec fiche Copilote/Index falsifiée', () => {
  const zones = ['Anna', '00 · À trier', '00 · À vérifier', '_Technique', '_Doublons', '_Médias', 'Données & exports', '04 · Immigration'];
  const folders = {
    FICTIF_EXT_DOM: { id: 'FICTIF_EXT_DOM', name: '05 · Carrière', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_EXT_CIBLE'] },
    FICTIF_EXT_CIBLE: { id: 'FICTIF_EXT_CIBLE', name: 'CibleExterne', parents: ['FICTIF_EXT_DOM'], files: ['FICTIF_EXT_FILE_0001'], folders: [] },
  };
  const files = {
    FICTIF_EXT_FILE_0001: { id: 'FICTIF_EXT_FILE_0001', name: '2026-01-01_Doc_Fictif.pdf', parents: ['FICTIF_EXT_CIBLE'], trashed: false },
  };
  const cartes = [['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations']];
  zones.forEach((z, idx) => {
    const zId = 'FICTIF_ZONE_' + idx;
    const subId = 'FICTIF_ZSUB_' + idx;
    const fId = 'FICTIF_ZFILE_' + String(idx).padStart(4, '0');
    folders[zId] = { id: zId, name: z, parents: ['FICTIF_ROOT'], files: [], folders: [subId] };
    folders[subId] = { id: subId, name: 'SousDossier', parents: [zId], files: [fId], folders: [] };
    files[fId] = { id: fId, name: '2026-02-01_Doc_' + idx + '.pdf', parents: [subId], trashed: false };
    cartes.push(['cop-cas-' + idx, new Date(), 'carte', 'cascade', '05 · Carrière', '05 · Carrière/Faux', 'Cascade',
      JSON.stringify({ cibleId: 'FICTIF_EXT_CIBLE', ids: [fId] }), 'proposé', 0]);
    cartes.push(['cop-doub-' + idx, new Date(), 'carte', 'doublon-dossier', '05 · Carrière', '05 · Carrière/Faux', 'Doublon',
      JSON.stringify({ sourceId: subId, cibleId: 'FICTIF_EXT_CIBLE' }), 'proposé', 0]);
    const emptyId = 'FICTIF_ZEMPTY_' + idx;
    folders[emptyId] = { id: emptyId, name: 'VideFictif', parents: [zId], files: [], folders: [] };
    folders[zId].folders.push(emptyId);
    cartes.push(['cop-vide-' + idx, new Date(), 'carte', 'dossier-vide', '05 · Carrière', '05 · Carrière/Faux', 'Vide',
      JSON.stringify({ dossierId: emptyId }), 'proposé', 0]);
  });
  // Carte cascade visant à déplacer un fichier externe VERS Anna
  cartes.push(['cop-into-anna', new Date(), 'carte', 'cascade', '05 · Carrière', '05 · Carrière/VersAnna', 'VersAnna',
    JSON.stringify({ cibleId: 'FICTIF_ZSUB_0', ids: ['FICTIF_EXT_FILE_0001'] }), 'proposé', 0]);

  const { c, dr } = ctxCopilote({ folders, files, sheets: { Copilote: cartes } });
  zones.forEach((_, idx) => {
    assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-cas-' + idx, decision: 'executer' }).ok, false);
    assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-doub-' + idx, decision: 'executer' }).ok, false);
    assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-vide-' + idx, decision: 'executer' }).ok, false);
  });
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-into-anna', decision: 'executer' }).ok, false);
  assert.strictEqual(dr.moves.length, 0, 'zéro déplacement Drive autorisé depuis ou vers Anna/zones système');

  // Index obsolète pointant vers 02 · Finances alors que le fichier est physiquement dans Anna
  const stale = ctxCopilote({
    folders: {
      FICTIF_ANNA: { id: 'FICTIF_ANNA', name: 'Anna', parents: ['FICTIF_ROOT'], files: ['FICTIF_ANNA_STALE_01'], folders: [] },
      FICTIF_FIN: { id: 'FICTIF_FIN', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_CIB'] },
      FICTIF_CIB: { id: 'FICTIF_CIB', name: 'FournisseurY', parents: ['FICTIF_FIN'], files: [], folders: [] },
    },
    files: {
      FICTIF_ANNA_STALE_01: { id: 'FICTIF_ANNA_STALE_01', name: '2026-01-10_Facture_FournisseurY.pdf', parents: ['FICTIF_ANNA'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|FICTIF_ANNA_STALE_01', new Date(), '2026-01-10_Facture_FournisseurY.pdf', '02 · Finances', '02 · Finances/Divers', 'classé', '', '', 'FICTIF_ANNA_STALE_01'],
      ],
    },
  });
  assert.strictEqual(stale.c.proposerCascadeDossier_({
    domaine: '02 · Finances', chemin: '02 · Finances/FournisseurY', parentId: 'FICTIF_CIB', emetteurOuSujet: 'FournisseurY',
  }), '', 'fichier physiquement dans Anna ignoré malgré un Index obsolète');
});

test('cartes ignorées non recréées et >= 15 alertes ouvertes n’affament pas cascade/doublon-dossier', () => {
  const folders = {
    FICTIF_DOM05: { id: 'FICTIF_DOM05', name: '05 · Carrière', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_EMP1', 'FICTIF_EMP2'] },
    FICTIF_EMP1: { id: 'FICTIF_EMP1', name: 'Employeur', parents: ['FICTIF_DOM05'], files: ['FICTIF_F_EMP'], folders: [] },
    FICTIF_EMP2: { id: 'FICTIF_EMP2', name: 'Employeurs', parents: ['FICTIF_DOM05'], files: ['FICTIF_CAS_CIB_00001'], folders: [] },
    FICTIF_VRAC: { id: 'FICTIF_VRAC', name: 'Vrac', parents: ['FICTIF_ROOT'], files: ['FICTIF_CAS_DOC_00001'], folders: [] },
    FICTIF_CORB: { id: 'FICTIF_CORB', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: [] },
  };
  const files = {
    FICTIF_F_EMP: { id: 'FICTIF_F_EMP', name: '2026-01-01_Contrat_Fictif.pdf', parents: ['FICTIF_EMP1'], trashed: false },
    FICTIF_CAS_DOC_00001: { id: 'FICTIF_CAS_DOC_00001', name: '2026-01-05_FournisseurZ_Facture.pdf', parents: ['FICTIF_VRAC'], trashed: false },
    FICTIF_CAS_CIB_00001: { id: 'FICTIF_CAS_CIB_00001', name: '2026-01-06_Facture_FournisseurZ.pdf', parents: ['FICTIF_EMP2'], trashed: false },
  };
  const index = [
    ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
    ['drive|FICTIF_CAS_DOC_00001', new Date(), '2026-01-05_FournisseurZ_Facture.pdf', '08 · Perso & projets', '08 · Perso & projets/Vrac', 'classé', '', '', 'FICTIF_CAS_DOC_00001'],
    ['drive|FICTIF_CAS_CIB_00001', new Date(), '2026-01-06_Facture_FournisseurZ.pdf', '05 · Carrière', '05 · Carrière/Employeurs', 'classé', '', '', 'FICTIF_CAS_CIB_00001'],
  ];
  const copilote = [['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations']];
  for (let i = 0; i < 16; i++) {
    const tid = 'FICTIF_TRASH_OPEN_' + String(i).padStart(4, '0');
    files[tid] = { id: tid, name: '2026-01-01_Doc_' + i + '.pdf', parents: ['FICTIF_CORB'], trashed: true };
    folders.FICTIF_CORB.files.push(tid);
    index.push(['drive|' + tid, new Date(), files[tid].name, '02 · Finances', '02 · Finances/Divers', 'corbeillé', '', '', tid]);
    copilote.push(['cop-open-' + i, new Date(), 'carte', 'alerte-corbeille', '02 · Finances', '02 · Finances/Divers', 'Corbeille', JSON.stringify({ fileId: tid }), 'proposé', 0]);
  }
  const { c, sh } = ctxCopilote({ folders, files, sheets: { Index: index, Copilote: copilote } });
  c.domainesVeilleNonProteges_ = () => [{ nom: '05 · Carrière', id: 'FICTIF_DOM05' }];
  c.collecterSousDossiersFusion_ = () => [
    { nom: 'Employeur', id: 'FICTIF_EMP1', nfiles: 1 },
    { nom: 'Employeurs', id: 'FICTIF_EMP2', nfiles: 1 },
  ];

  const r1 = c.executerEtapeCopilote_(() => false);
  assert.strictEqual(r1.creees, 2, 'cascade et doublon-dossier créés malgré 16 alertes corbeille ouvertes');
  const cas = sh.sheets.Copilote.slice(1).find((r) => r[3] === 'cascade');
  const doub = sh.sheets.Copilote.slice(1).find((r) => r[3] === 'doublon-dossier');
  assert.ok(cas && doub);

  // Ignorer alerte-corbeille, cascade et doublon-dossier → jamais recréés au tick suivant
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-open-0', decision: 'ignorer' }).statut, 'ignoré');
  assert.strictEqual(c.executerDecisionCopilote_({ id: cas[0], decision: 'ignorer' }).statut, 'ignoré');
  assert.strictEqual(c.executerDecisionCopilote_({ id: doub[0], decision: 'ignorer' }).statut, 'ignoré');
  const nbAvant = sh.sheets.Copilote.length;
  const r2 = c.executerEtapeCopilote_(() => false);
  assert.strictEqual(r2.creees, 0);
  assert.strictEqual(sh.sheets.Copilote.length, nbAvant, 'aucune carte ignorée recréée');
});

test('transitions d’état, auto-déplacement dossier-vide, 0-move guard, doublon-dossier Index/corbeille et JSON <= 500', () => {
  const { c, sh, dr } = ctxCopilote({
    folders: {
      FICTIF_DOM05: { id: 'FICTIF_DOM05', name: '05 · Carrière', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_SRC', 'FICTIF_DST', 'FICTIF_TRASHED'] },
      FICTIF_SRC: { id: 'FICTIF_SRC', name: 'Employeur', parents: ['FICTIF_DOM05'], files: ['FICTIF_MOVE_0001'], folders: [] },
      FICTIF_DST: { id: 'FICTIF_DST', name: 'Employeurs', parents: ['FICTIF_DOM05'], files: [], folders: [] },
      FICTIF_TRASHED: { id: 'FICTIF_TRASHED', name: 'Corbeille', parents: ['FICTIF_DOM05'], files: [], folders: [], trashed: true },
      FICTIF_TECH_CUSTOM: { id: 'FICTIF_TECH_CUSTOM', name: 'TechSansPrefixe', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_VIDES_DIR'] },
      FICTIF_VIDES_DIR: { id: 'FICTIF_VIDES_DIR', name: 'Dossiers vides', parents: ['FICTIF_TECH_CUSTOM'], files: [], folders: ['FICTIF_DEJA_ARCHIVE'] },
      FICTIF_DEJA_ARCHIVE: { id: 'FICTIF_DEJA_ARCHIVE', name: 'VideDejaArchive', parents: ['FICTIF_VIDES_DIR'], files: [], folders: [] },
    },
    files: {
      FICTIF_MOVE_0001: { id: 'FICTIF_MOVE_0001', name: '2026-01-01_Contrat_Fictif.pdf', parents: ['FICTIF_SRC'], trashed: false },
    },
    sheets: {
      Copilote: [
        ['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations'],
        ['cop-app', new Date(), 'carte', 'cascade', '05 · Carrière', '05 · Carrière/Employeurs', 'Déjà appliqué',
          JSON.stringify({ cibleId: 'FICTIF_DST', ids: ['FICTIF_MOVE_0001'] }), 'appliqué', 2],
        ['cop-ign', new Date(), 'carte', 'cascade', '05 · Carrière', '05 · Carrière/Employeurs', 'Ignoré',
          JSON.stringify({ cibleId: 'FICTIF_DST', ids: ['FICTIF_MOVE_0001'] }), 'ignoré', 0],
        ['cop-zero', new Date(), 'carte', 'cascade', '05 · Carrière', '05 · Carrière/Employeurs', 'Zéro move',
          JSON.stringify({ cibleId: 'FICTIF_DST', ids: ['FICTIF_INEXISTANT'] }), 'proposé', 1],
        ['cop-v-self', new Date(), 'carte', 'dossier-vide', '05 · Carrière', '05 · Carrière/Vide', 'Déjà archivé',
          JSON.stringify({ dossierId: 'FICTIF_DEJA_ARCHIVE' }), 'proposé', 0],
        ['cop-d-trash', new Date(), 'carte', 'doublon-dossier', '05 · Carrière', '05 · Carrière/Corbeille', 'Corbeillé',
          JSON.stringify({ sourceId: 'FICTIF_SRC', cibleId: 'FICTIF_TRASHED' }), 'proposé', 0],
        ['cop-d-ok', new Date(), 'carte', 'doublon-dossier', '05 · Carrière', '05 · Carrière/Employeur', 'Fusion valide',
          JSON.stringify({ sourceId: 'FICTIF_SRC', cibleId: 'FICTIF_DST' }), 'proposé', 0],
      ],
    },
  });
  c.dossierTechnique_ = () => dr.DriveApp.getFolderById('FICTIF_TECH_CUSTOM');

  // Re-exécution / desactiver-auto sur cartes déjà traitées ou non auto refusées
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-app', decision: 'executer' }).ok, false);
  assert.strictEqual(sh.sheets.Copilote[1][9], 2, 'Validations inchangé sur carte déjà appliquée');
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-ign', decision: 'executer' }).ok, false);
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-zero', decision: 'desactiver-auto' }).ok, false);

  // 0-move guard sur cascade
  const rZero = c.executerDecisionCopilote_({ id: 'cop-zero', decision: 'executer' });
  assert.strictEqual(rZero.ok, false);
  assert.strictEqual(sh.sheets.Copilote[3][8], 'proposé');
  assert.strictEqual(sh.sheets.Copilote[3][9], 1);

  // dossier-vide déjà dans Dossiers vides refusé (pas de self-move addParents === removeParents)
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-v-self', decision: 'executer' }).ok, false);

  // doublon-dossier cible en corbeille refusé
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-d-trash', decision: 'executer' }).ok, false);

  // doublon-dossier valide écrit le chemin DESTINATION dans Index
  const rOk = c.executerDecisionCopilote_({ id: 'cop-d-ok', decision: 'executer' });
  assert.strictEqual(rOk.ok, true);
  assert.strictEqual(sh.sheets.Index[1][4], '05 · Carrière/Employeurs', 'Index enregistre le chemin cible');

  // serialiserActionCopilote_ produit toujours du JSON valide <= 500 chars
  const tropLong = c.serialiserActionCopilote_({ cibleId: 'FICTIF_CIBLE', ids: ['FICTIF_' + 'A'.repeat(510)] });
  assert.ok(tropLong.length <= 500);
  assert.deepStrictEqual(JSON.parse(tropLong), {});

  // troncature echeances / tids / ids / orgs / items avant repli '{}'
  const longDem = c.serialiserActionCopilote_({
    chemin: '04 · Immigration/Permis',
    ids: ['ID1', 'ID2', 'ID3'],
    tids: Array.from({ length: 40 }, (_, i) => 'thread_' + i + '_abcdef'),
    echeances: Array.from({ length: 20 }, (_, i) => '2026-08-' + String(i + 10)),
  });
  assert.ok(longDem.length <= 500);
  const parsedDem = JSON.parse(longDem);
  assert.strictEqual(parsedDem.chemin, '04 · Immigration/Permis');
  assert.ok(Array.isArray(parsedDem.ids) && parsedDem.ids.length >= 1);

  const longOrgs = c.serialiserActionCopilote_({
    cle: 'chg|18m',
    orgs: Array.from({ length: 22 }, (_, i) => ({ k: 'o' + i, n: 'Org ' + i, ok: 0, nb: 1 })),
  });
  assert.ok(longOrgs.length <= 500 && longOrgs !== '{}');
  assert.ok(JSON.parse(longOrgs).orgs.length > 0 && JSON.parse(longOrgs).orgs.length < 22);
});

test('demarche-active (#7) : >= 3 mvts / 7 j, inclut 04 · Immigration & Anna (0 écriture Drive), exclut zones système, dédup & refus passer-auto', () => {
  const maint = Date.now();
  const jour = 24 * 3600 * 1000;
  const echFuture = new Date(maint + 30 * jour).toISOString().slice(0, 10);
  const echPassee = new Date(maint - 10 * jour).toISOString().slice(0, 10);
  const { c, sh, dr } = ctxCopilote({
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId'],
        // 3 docs récents dans 04 · Immigration/Permis/2026 (+ 1 épingle et 1 doublon de fid)
        ['drive|FICTIF_IMMI_DOC_0001', new Date(maint - 1 * jour), '2026-07-09_Form_IRCC.pdf', '04 · Immigration', '04 · Immigration/Permis/2026', 'classé', '', '', 'FICTIF_IMMI_DOC_0001'],
        ['drive|FICTIF_IMMI_DOC_0002', new Date(maint - 2 * jour), '2026-07-08_Recu_IRCC.pdf', '04 · Immigration', '04 · Immigration/Permis/2026', 'déplacé', '', '', 'FICTIF_IMMI_DOC_0002'],
        ['epingle|FICTIF_IMMI_DOC_0002', new Date(maint - 2 * jour), '2026-07-08_Recu_IRCC.pdf', '04 · Immigration', '04 · Immigration/Permis/2026', 'épinglé', '', '', 'FICTIF_IMMI_DOC_0002'],
        ['drive|FICTIF_IMMI_DOC_0003', new Date(maint - 3 * jour), '2026-07-07_Lettre_IRCC.pdf', '04 · Immigration', '04 · Immigration/Permis', 'manuel', '', '', 'FICTIF_IMMI_DOC_0003'],
        // Anna : 3 docs (1 trop ancien > 7 j, 3 dans la fenêtre)
        ['drive|FICTIF_ANNA_DOC_0000', new Date(maint - 10 * jour), '2026-06-30_Doc_Anna.pdf', 'Anna', 'Anna/Sante', 'classé', '', '', 'FICTIF_ANNA_DOC_0000'],
        ['drive|FICTIF_ANNA_DOC_0001', new Date(maint - 1 * jour), '2026-07-09_Doc1_Anna.pdf', 'Anna', 'Anna/Sante', 'classé', '', '', 'FICTIF_ANNA_DOC_0001'],
        ['drive|FICTIF_ANNA_DOC_0002', new Date(maint - 2 * jour), '2026-07-08_Doc2_Anna.pdf', 'Anna', 'Anna/Sante', 'classé', '', '', 'FICTIF_ANNA_DOC_0002'],
        ['drive|FICTIF_ANNA_DOC_0003', new Date(maint - 3 * jour), '2026-07-07_Doc3_Anna.pdf', 'Anna', 'Anna/Sante', 'classé', '', '', 'FICTIF_ANNA_DOC_0003'],
        // < 3 mvts : ignoré
        ['drive|FICTIF_FIN_DOC_00001', new Date(maint - 1 * jour), '2026-07-09_Fac.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_FIN_DOC_00001'],
        ['drive|FICTIF_FIN_DOC_00002', new Date(maint - 2 * jour), '2026-07-08_Fac.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_FIN_DOC_00002'],
        // Zone système exclue même avec 3 mvts
        ['drive|FICTIF_SYS_DOC_00001', new Date(maint - 1 * jour), 'a.pdf', '_Technique', '_Technique/Logs', 'classé', '', '', 'FICTIF_SYS_DOC_00001'],
        ['drive|FICTIF_SYS_DOC_00002', new Date(maint - 1 * jour), 'b.pdf', '_Technique', '_Technique/Logs', 'classé', '', '', 'FICTIF_SYS_DOC_00002'],
        ['drive|FICTIF_SYS_DOC_00003', new Date(maint - 1 * jour), 'c.pdf', '_Technique', '_Technique/Logs', 'classé', '', '', 'FICTIF_SYS_DOC_00003'],
        // Échéance future + passée
        ['agenda|THR_IMMI|' + echFuture, new Date(maint), 'DriveAI · Échéance', 'Immigration', echFuture, 'agenda', '', '', ''],
        ['agenda|THR_IMMI|' + echPassee, new Date(maint), 'DriveAI · Passée', 'Immigration', echPassee, 'agenda', '', '', ''],
      ],
      Liens: [
        ['Horodatage', 'ThreadId', 'MessageId', 'Expéditeur', 'Domaine', 'Chemin', 'FileId', 'Fichier'],
        [new Date(maint), 'THR_IMMI', 'MSG_1', 'portail@exemple.test', '04 · Immigration', '04 · Immigration/Permis/2026', 'FICTIF_IMMI_DOC_0001', '2026-07-09_Form_IRCC.pdf'],
      ],
    },
  });

  const pure = JSON.parse(JSON.stringify(c.analyserDemarchesCopilote_(sh.sheets.Index.slice(1), sh.sheets.Liens.slice(1), maint, 7, 3)));
  assert.strictEqual(pure.length, 2);
  const immi = pure.find((d) => d.chemin === '04 · Immigration/Permis');
  const anna = pure.find((d) => d.chemin === 'Anna/Sante');
  assert.ok(immi && immi.nbMvts === 3 && immi.nbDocs === 3);
  assert.deepStrictEqual(immi.tids, ['THR_IMMI']);
  assert.deepStrictEqual(immi.echeances, [echFuture]);
  assert.ok(anna && anna.nbMvts === 3 && anna.nbDocs === 4);

  // Vérifie 0 écriture Drive, déduplication au 2e appel et respect 'ignoré'
  c.domainesVeilleNonProteges_ = () => [];
  const r1 = c.detecterDemarcheEnCours_(sh.sheets.Index.slice(1), () => false, 10);
  assert.strictEqual(r1, 2);
  assert.strictEqual(dr.moves.length, 0);
  const r2 = c.detecterDemarcheEnCours_(sh.sheets.Index.slice(1), () => false, 10);
  assert.strictEqual(r2, 0, 'carte demarche-active dédupliquée par chemin');
  const cImmi = sh.sheets.Copilote.find((r) => r[3] === 'demarche-active' && r[5] === '04 · Immigration/Permis');
  assert.ok(cImmi && cImmi[8] === 'actif');
  assert.ok(!cImmi[7].includes('portail@exemple.test'), 'zéro adresse/corps dans ActionJson');

  // Refus passer-auto et executer sur demarche-active ; ignorer respecté au passage suivant
  assert.strictEqual(c.executerDecisionCopilote_({ id: cImmi[0], decision: 'passer-auto' }).ok, false);
  assert.strictEqual(c.executerDecisionCopilote_({ id: cImmi[0], decision: 'executer' }).ok, false);
  assert.strictEqual(c.executerDecisionCopilote_({ id: cImmi[0], decision: 'ignorer' }).statut, 'ignoré');
  assert.strictEqual(c.detecterDemarcheEnCours_(sh.sheets.Index.slice(1), () => false, 10), 0);
});

test('Lot 3A Copilote : déduplication piece-manquante par a.cle, respect ignoré et refus passer-auto sur expiration/piece-manquante', () => {
  const { c, sh } = ctxCopilote();
  const r1 = c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'piece-manquante', domaine: '02 · Finances', chemin: '02 · Finances',
    titre: 'Pièce fiscale 2025 manquante : RL-1', action: { cle: 'impots-2025-rl1', typePiece: 'impots' },
  });
  const r2 = c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'piece-manquante', domaine: '02 · Finances', chemin: '02 · Finances',
    titre: 'Pièce fiscale 2025 manquante : RL-1', action: { cle: 'impots-2025-rl1', typePiece: 'impots' },
  });
  assert.strictEqual(r1.cree, true);
  assert.strictEqual(r2.cree, false);
  assert.strictEqual(r2.id, r1.id);

  assert.strictEqual(c.executerDecisionCopilote_({ id: r1.id, decision: 'passer-auto' }).ok, false);
  assert.strictEqual(c.executerDecisionCopilote_({ id: r1.id, decision: 'ignorer' }).statut, 'ignoré');
  assert.strictEqual(c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'piece-manquante', domaine: '02 · Finances', chemin: '02 · Finances',
    titre: 'Pièce fiscale 2025 manquante : RL-1', action: { cle: 'impots-2025-rl1', typePiece: 'impots' },
  }).cree, false, 'une carte piece-manquante ignorée n est pas recréée');

  const rExp = c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'expiration', domaine: '04 · Immigration', chemin: '04 · Immigration/Permis',
    titre: 'Échéance à vérifier', action: { fileId: 'FICTIF_EXP_99', dateExpiration: '2027-01-10', joursRestants: 20 },
  });
  assert.strictEqual(c.executerDecisionCopilote_({ id: rExp.id, decision: 'passer-auto' }).ok, false);
  sh.sheets.Index.push(['drive|FICTIF_OK', new Date(), 'doc.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', 'FICTIF_OK']);
  assert.strictEqual(typeof c.executerEtapeCopilote_(() => false).creees, 'number');
});

test('Lot 3B Copilote : decision reclame (incl. Anna/04 sans mutation Drive), blocage passer-auto et re-creation remboursement', () => {
  const { c, sh, dr } = ctxCopilote({
    sheets: {
      Signaux: [
        ['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation'],
        ['FICTIF_ANNA_REC_01', 'Reçu clinique', 'Clinique Exemple', 'Anna', 'Anna/Sante', '2026-11-10', '', 95, 'CAD', '', '', 'a-reclamer'],
        ['FICTIF_IMMI_REC_02', 'Frais médical', 'Clinique IRCC', '04 · Immigration', '04 · Immigration/Santé', '2026-11-12', '', 55, 'CAD', '', '', 'a-reclamer'],
      ],
    },
  });
  c.domainesVeilleNonProteges_ = () => [];

  // exécution de detecterArgentOublieCopilote_ : crée carte remboursement
  const nb = c.detecterArgentOublieCopilote_(() => false, 10);
  assert.strictEqual(nb, 1);
  const carteRemb = sh.sheets.Copilote.slice(1).find((r) => r[3] === 'remboursement');
  assert.ok(carteRemb);

  // passer-auto refusé sur tous les types Lot 3B
  ['facture-hausse', 'facture-doublon', 'renouvellement', 'remboursement', 'retour-garantie'].forEach((tp, idx) => {
    const r = c.enregistrerCarteCopilote_({
      categorie: 'carte', type: tp, domaine: '02 · Finances', chemin: '02 · Finances',
      titre: 'Test ' + tp, action: { cle: 'test-' + idx },
    });
    const auto = c.executerDecisionCopilote_({ id: r.id || carteRemb[0], decision: 'passer-auto' });
    assert.strictEqual(auto.ok, false, 'passer-auto bloqué sur ' + tp);
  });

  // decision reclame fonctionne même si la carte vise Anna/04 · Immigration (0 mutation Drive)
  const repRec = c.executerDecisionCopilote_({ id: carteRemb[0], decision: 'reclame' });
  assert.strictEqual(repRec.ok, true);
  assert.strictEqual(repRec.statut, 'reclamé');
  assert.strictEqual(dr.moves.length, 0);
  assert.strictEqual(sh.sheets.Signaux[1][11], 'reclame');
  assert.strictEqual(sh.sheets.Signaux[2][11], 'reclame');

  // Re-création remboursement : une carte ignorée ne bloque PAS l'arrivée d'un nouveau reçu
  const rIgn = c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'remboursement', domaine: '05 · Santé', chemin: '05 · Santé',
    titre: 'Remboursement 1', action: { cle: 'remboursement|EUR', ids: ['F_EUR_1'], montantTotal: 40, devise: 'EUR', nbRecus: 1 },
  });
  assert.strictEqual(c.executerDecisionCopilote_({ id: rIgn.id, decision: 'ignorer' }).statut, 'ignoré');
  assert.strictEqual(c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'remboursement', domaine: '05 · Santé', chemin: '05 · Santé',
    titre: 'Remboursement 1', action: { cle: 'remboursement|EUR', ids: ['F_EUR_1'], montantTotal: 40, devise: 'EUR', nbRecus: 1 },
  }).cree, false);
  assert.strictEqual(c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'remboursement', domaine: '05 · Santé', chemin: '05 · Santé',
    titre: 'Remboursement 2', action: { cle: 'remboursement|EUR', ids: ['F_EUR_1', 'F_EUR_2'], montantTotal: 90, devise: 'EUR', nbRecus: 2 },
  }).cree, true, 'un nouveau reçu recrée la carte remboursement');
});

test('#19 serialiserActionCopilote_, regle-auto (sync ActionJson.auto & passage auto à 3 validations) et priorité dans executerEtapeCopilote_', () => {
  const { c, sh } = ctxCopilote({
    sheets: {
      Copilote: [
        ['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations'],
        ['cop-reg-1', new Date(), 'regle', 'regle-auto', '02 · Finances', '02 · Finances/Banque', 'Si banque alors Finances',
          JSON.stringify({ cle: 'regle|banque', si: { mots: ['banque'] }, alors: { canal: 'drive', action: 'deplacer' }, phrase: 'Si banque alors Finances', auto: false, validations: 0 }), 'proposé', 0],
      ],
    },
  });
  c.domainesVeilleNonProteges_ = () => [];

  // serialiserActionCopilote_ tronque phrase/mots pour rester <= 500 sans retomber sur '{}'
  const longRegle = { cle: 'regle|long', si: { mots: Array.from({ length: 20 }, (_, i) => 'motclef' + i) }, alors: { canal: 'drive' }, phrase: 'Si ' + 'long '.repeat(80), auto: false };
  const sJson = c.serialiserActionCopilote_(longRegle);
  assert.ok(sJson.length <= 500 && sJson !== '{}', 'ActionJson borné sans repli {}');
  assert.strictEqual(JSON.parse(sJson).cle, 'regle|long');

  // passer-auto / desactiver-auto synchronisent ActionJson.auto
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-reg-1', decision: 'passer-auto' }).statut, 'auto');
  assert.strictEqual(JSON.parse(sh.sheets.Copilote[1][7]).auto, true);
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-reg-1', decision: 'desactiver-auto' }).statut, 'proposé');
  assert.strictEqual(JSON.parse(sh.sheets.Copilote[1][7]).auto, false);

  // 3 validations sur regle-auto -> passage automatique en statut 'auto' + action.auto = true
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-reg-1', decision: 'executer' }).statut, 'proposé');
  assert.strictEqual(c.executerDecisionCopilote_({ id: 'cop-reg-1', decision: 'executer' }).statut, 'proposé');
  const v3 = c.executerDecisionCopilote_({ id: 'cop-reg-1', decision: 'executer' });
  assert.strictEqual(v3.ok, true);
  assert.strictEqual(v3.nbValidations, 3);
  assert.strictEqual(v3.proposerAuto, true);
  assert.strictEqual(v3.statut, 'auto');
  assert.strictEqual(JSON.parse(sh.sheets.Copilote[1][7]).auto, true);

  // executerEtapeCopilote_ appelle appliquerReglesDriveCopilote_ en priorité
  let ordrePriorite = false;
  c.appliquerReglesDriveCopilote_ = () => { ordrePriorite = true; return { traitees: 1, creees: 1 }; };
  const etape = c.executerEtapeCopilote_(() => false);
  assert.strictEqual(ordrePriorite, true);
  assert.strictEqual(etape.traitees, 1);
  assert.ok(etape.creees >= 1);
});
