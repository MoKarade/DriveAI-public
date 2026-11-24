'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

test('VeilleDrive : prédicats purs d exclusion racine et de ciblage', () => {
  const c = load(['Config.gs', 'Reset.gs', 'VeilleDrive.gs']);

  assert.strictEqual(c.estDossierExcluRacineVeille_('Anna'), true);
  assert.strictEqual(c.estDossierExcluRacineVeille_(' marc '), true);
  assert.strictEqual(c.estDossierExcluRacineVeille_('04 · Immigration'), true);
  assert.strictEqual(c.estDossierExcluRacineVeille_('PersoAutre', ['persoauth', 'PersoAutre']), true);

  assert.strictEqual(c.cibleDossierRacineVeille_('Takeout'), 'exports');
  assert.strictEqual(c.cibleDossierRacineVeille_('Colab Notebooks'), 'technique');
  assert.strictEqual(c.cibleDossierRacineVeille_('Google AI Studio'), 'technique');
  assert.strictEqual(c.cibleDossierRacineVeille_('Sauvegardes'), 'technique');
  assert.strictEqual(c.cibleDossierRacineVeille_('_Archive'), 'technique');
  assert.strictEqual(c.cibleDossierRacineVeille_('Anna'), null);
  assert.strictEqual(c.cibleDossierRacineVeille_('Marc'), null);
  assert.strictEqual(c.cibleDossierRacineVeille_('DossierInconnu'), null);

  assert.strictEqual(c.estFichierNouveauAClasserVeille_('attestation.pdf', 'f1', false, false), true);
  assert.strictEqual(c.estFichierNouveauAClasserVeille_('2026-11-24_attestation.pdf', 'f1', false, false), false);
  assert.strictEqual(c.estFichierNouveauAClasserVeille_('attestation.pdf', 'f1', true, false), false);
  assert.strictEqual(c.estFichierNouveauAClasserVeille_('attestation.pdf', 'f1', false, true), false);
  assert.strictEqual(c.estFichierNouveauAClasserVeille_('driveai-profil-prive.json', 'f1', false, false), false);
  assert.strictEqual(c.estFichierNouveauAClasserVeille_('DriveAI', 'f1', false, false), false);
});

function monterEnvVeille(opts = {}) {
  const folders = new Map();
  const files = new Map();
  const moves = [];
  const actions = [];
  const indexKeys = new Set(opts.indexKeys || []);
  const props = new Map(Object.entries(opts.props || {}));

  const regFolder = (id, name, parents) => {
    const obj = { id, name, parents: [...parents] };
    folders.set(id, obj);
    return obj;
  };
  const regFile = (id, name, parents, mimeType = 'application/pdf') => {
    const obj = { id, name, parents: [...parents], mimeType };
    files.set(id, obj);
    return obj;
  };

  regFolder('FICTIF_ROOT', 'Mon Drive', []);
  regFolder('FICTIF_MARC', 'Marc', ['FICTIF_ROOT']);
  regFolder('FICTIF_ANNA', 'Anna', ['FICTIF_ROOT']);
  regFolder('FICTIF_DOSSIERS_A_TRIER', '00 · À trier', ['FICTIF_MARC']);
  regFolder('FICTIF_TECH', '_Technique', ['FICTIF_MARC']);
  regFolder('FICTIF_DOMAINES_01_ADMINISTRATIF_IDENTITE', '01 · Administratif & identité', ['FICTIF_MARC']);
  regFolder('FICTIF_DOMAINES_04_IMMIGRATION', '04 · Immigration', ['FICTIF_MARC']);
  regFolder('FICTIF_DOMAINES_08_PERSO_PROJETS', '08 · Perso & projets', ['FICTIF_MARC']);
  regFolder('FICTIF_EXPORTS', 'Données & exports', ['FICTIF_DOMAINES_08_PERSO_PROJETS']);

  const iter = (arr) => {
    let i = 0;
    return { hasNext: () => i < arr.length, next: () => arr[i++] };
  };

  const foldW = (id) => {
    const d = folders.get(id);
    if (!d) throw new Error('Absent ' + id);
    return {
      getId: () => d.id,
      getName: () => d.name,
      getParents: () => iter(d.parents.map((p) => foldW(p))),
      getFiles: () => iter([...files.values()].filter((f) => f.parents.includes(d.id)).map((f) => fileW(f.id))),
      getFolders: () => iter([...folders.values()].filter((x) => x.parents.includes(d.id)).map((x) => foldW(x.id))),
      getFoldersByName: (n) => iter([...folders.values()].filter((x) => x.parents.includes(d.id) && x.name === n).map((x) => foldW(x.id))),
      moveTo: (dest) => {
        moves.push({ id: d.id, nom: d.name, avant: d.parents[0], apres: dest.getId() });
        d.parents = [dest.getId()];
      },
    };
  };

  const fileW = (id) => {
    const f = files.get(id);
    if (!f) throw new Error('Fichier absent ' + id);
    return {
      getId: () => f.id,
      getName: () => f.name,
      getMimeType: () => f.mimeType,
      getParents: () => iter(f.parents.map((p) => foldW(p))),
      moveTo: (dest) => {
        moves.push({ id: f.id, nom: f.name, avant: f.parents[0], apres: dest.getId() });
        f.parents = [dest.getId()];
      },
    };
  };

  const c = load(['Config.gs', 'Reset.gs', 'Maintenance.gs', 'VeilleDrive.gs'], {
    DriveApp: {
      getRootFolder: () => foldW('FICTIF_ROOT'),
      getFolderById: (id) => foldW(id),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
  });

  if (opts.cfg) Object.assign(c.CONFIG, opts.cfg);
  c.dossierTechnique_ = () => foldW('FICTIF_TECH');
  c.indexContient_ = (k) => indexKeys.has(k);
  c.enregistrerAction_ = (type, cible, avant, apres, detail) => {
    actions.push({ type, cible, avant, apres, detail });
    return 'act-test-01';
  };
  c.journalErreur_ = (src, msg) => actions.push({ erreur: src + ':' + msg });

  return { c, folders, files, regFolder, regFile, moves, actions };
}

test('VeilleDrive : déplace fichiers libres et dossiers connus, laisse Anna/Marc/04/épingle intacts', () => {
  const env = monterEnvVeille({
    indexKeys: ['epingle|f_epingle', 'drive|f_deja_indexe'],
  });
  env.regFile('f_root_pdf', 'NouveauDocument.pdf', ['FICTIF_ROOT']);
  env.regFile('f_profil', 'driveai-profil-prive.json', ['FICTIF_ROOT'], 'application/json');
  env.regFile('f_epingle', 'NePasBouger.pdf', ['FICTIF_ROOT']);
  env.regFile('f_marc_loose', 'RecuLibre.pdf', ['FICTIF_MARC']);
  env.regFolder('d_takeout', 'Takeout', ['FICTIF_ROOT']);
  env.regFolder('d_colab', 'Colab Notebooks', ['FICTIF_ROOT']);
  env.regFile('f_dom_new', 'FactureLibre.pdf', ['FICTIF_DOMAINES_01_ADMINISTRATIF_IDENTITE']);
  env.regFile('f_dom_deja_classe', '2026-11-01_Ok.pdf', ['FICTIF_DOMAINES_01_ADMINISTRATIF_IDENTITE']);
  env.regFile('f_dom_04_multi', 'TitreMulti.pdf', ['FICTIF_DOMAINES_01_ADMINISTRATIF_IDENTITE', 'FICTIF_DOMAINES_04_IMMIGRATION']);
  env.regFile('f_dom_04', 'Dossier04.pdf', ['FICTIF_DOMAINES_04_IMMIGRATION']);
  env.regFile('f_anna', 'PersoAnna.pdf', ['FICTIF_ANNA']);

  const n = env.c.veillerDrive_(() => false);
  assert.strictEqual(n, 5);
  assert.deepStrictEqual(env.folders.get('FICTIF_ANNA').parents, ['FICTIF_ROOT']);
  assert.deepStrictEqual(env.folders.get('FICTIF_MARC').parents, ['FICTIF_ROOT']);
  assert.deepStrictEqual(env.files.get('f_anna').parents, ['FICTIF_ANNA']);
  assert.deepStrictEqual(env.files.get('f_profil').parents, ['FICTIF_ROOT']);
  assert.deepStrictEqual(env.files.get('f_epingle').parents, ['FICTIF_ROOT']);
  assert.deepStrictEqual(env.files.get('f_dom_04_multi').parents, ['FICTIF_DOMAINES_01_ADMINISTRATIF_IDENTITE', 'FICTIF_DOMAINES_04_IMMIGRATION']);
  assert.deepStrictEqual(env.files.get('f_dom_04').parents, ['FICTIF_DOMAINES_04_IMMIGRATION']);
  assert.deepStrictEqual(env.files.get('f_dom_deja_classe').parents, ['FICTIF_DOMAINES_01_ADMINISTRATIF_IDENTITE']);
  assert.deepStrictEqual(env.files.get('f_root_pdf').parents, ['FICTIF_DOSSIERS_A_TRIER']);
  assert.deepStrictEqual(env.files.get('f_marc_loose').parents, ['FICTIF_DOSSIERS_A_TRIER']);
  assert.deepStrictEqual(env.files.get('f_dom_new').parents, ['FICTIF_DOSSIERS_A_TRIER']);
  assert.deepStrictEqual(env.folders.get('d_takeout').parents, ['FICTIF_EXPORTS']);
  assert.deepStrictEqual(env.folders.get('d_colab').parents, ['FICTIF_TECH']);
  assert.strictEqual(env.actions.filter((a) => a.type === 'drive-deplacer').length, 5);
});

test('VeilleDrive : respecte VEILLE_DRIVE_ACTIF=false, MAX_PAR_RUN et budget temps', () => {
  const off = monterEnvVeille({ cfg: { VEILLE_DRIVE_ACTIF: false } });
  off.regFile('f1', 'Doc.pdf', ['FICTIF_ROOT']);
  assert.strictEqual(off.c.veillerDrive_(() => false), 0);
  assert.deepStrictEqual(off.files.get('f1').parents, ['FICTIF_ROOT']);

  const borne = monterEnvVeille({ cfg: { VEILLE_DRIVE_MAX_PAR_RUN: 2 } });
  borne.regFile('f1', 'A.pdf', ['FICTIF_ROOT']);
  borne.regFile('f2', 'B.pdf', ['FICTIF_ROOT']);
  borne.regFile('f3', 'C.pdf', ['FICTIF_ROOT']);
  assert.strictEqual(borne.c.veillerDrive_(() => false), 2);
  assert.strictEqual(borne.c.veillerDrive_(() => true), 0);
});

test('VeilleDrive Changes API : prédicats purs ignorables et zones ignorées', () => {
  const c = load(['Config.gs', 'Reset.gs', 'VeilleDrive.gs']);
  assert.strictEqual(c.estChangementDriveIgnorable_(null, {}), true);
  assert.strictEqual(c.estChangementDriveIgnorable_({ removed: true, file: { id: '1', name: 'a.pdf' } }, {}), true);
  assert.strictEqual(c.estChangementDriveIgnorable_({ file: { id: 'S1', name: 'doc.pdf' } }, { S1: true }), true);
  assert.strictEqual(c.estChangementDriveIgnorable_({ file: { id: '1', name: 'lien', mimeType: 'application/vnd.google-apps.shortcut' } }, {}), true);
  assert.strictEqual(c.estChangementDriveIgnorable_({ file: { id: '1', name: 'DriveAI', mimeType: 'application/vnd.google-apps.script' } }, {}), true);
  assert.strictEqual(c.estChangementDriveIgnorable_({ file: { id: '1', name: 'driveai-profil-prive.json', mimeType: 'application/json' } }, {}), true);
  assert.strictEqual(c.estChangementDriveIgnorable_({ file: { id: '1', name: 'Reçu.pdf', mimeType: 'application/pdf' } }, {}), false);

  assert.strictEqual(c.estSousZoneIgnoreeVeille_(['Mon Drive', 'Anna', 'Perso']), true);
  assert.strictEqual(c.estSousZoneIgnoreeVeille_(['Marc', '04 · Immigration', 'MIFI']), true);
  assert.strictEqual(c.estSousZoneIgnoreeVeille_(['Marc', '08 · Perso & projets', 'Données & exports', 'Takeout']), true);
  assert.strictEqual(c.estSousZoneIgnoreeVeille_(['Marc', '02 · Finances', '2026']), false);
});

test('VeilleDrive Changes API : initialisation jeton, détection déplacement Marc, nouveau dépôt sous-dossier et erreur HTTP', () => {
  const folders = new Map([
    ['FICTIF_ROOT', { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [] }],
    ['FICTIF_MARC', { id: 'FICTIF_MARC', name: 'Marc', parents: ['FICTIF_ROOT'] }],
    ['FICTIF_ANNA', { id: 'FICTIF_ANNA', name: 'Anna', parents: ['FICTIF_ROOT'] }],
    ['FICTIF_DOSSIERS_A_TRIER', { id: 'FICTIF_DOSSIERS_A_TRIER', name: '00 · À trier', parents: ['FICTIF_MARC'] }],
    ['FICTIF_D02', { id: 'FICTIF_D02', name: '02 · Finances', parents: ['FICTIF_MARC'] }],
    ['FICTIF_D02_SUB', { id: 'FICTIF_D02_SUB', name: 'Banque', parents: ['FICTIF_D02'] }],
    ['FICTIF_D04', { id: 'FICTIF_D04', name: '04 · Immigration', parents: ['FICTIF_MARC'] }],
    ['FICTIF_TECH', { id: 'FICTIF_TECH', name: '_Technique', parents: ['FICTIF_MARC'] }],
  ]);
  const files = new Map([
    ['f_idx_marc', { id: 'f_idx_marc', name: '2026-03-01_Releve_Banque.pdf', mimeType: 'application/pdf', parents: ['FICTIF_D02_SUB'], trashed: false }],
    ['f_idx_moteur', { id: 'f_idx_moteur', name: '2026-04-01_Facture.pdf', mimeType: 'application/pdf', parents: ['FICTIF_D02'], trashed: false }],
    ['f_new_sub', { id: 'f_new_sub', name: 'ScanRecu.pdf', mimeType: 'application/pdf', parents: ['FICTIF_D02_SUB'], trashed: false }],
    ['f_anna', { id: 'f_anna', name: 'PersoAnna.pdf', mimeType: 'application/pdf', parents: ['FICTIF_ANNA'], trashed: false }],
    ['f_04', { id: 'f_04', name: 'Permis.pdf', mimeType: 'application/pdf', parents: ['FICTIF_D04'], trashed: false }],
  ]);
  const props = new Map();
  const ajoutsIndex = [];
  const actions = [];
  const infos = [];
  const erreurs = [];
  let modeHttp = 'ok';
  let changementsPage = [];

  const iter = (arr) => {
    let i = 0;
    return { hasNext: () => i < arr.length, next: () => arr[i++] };
  };
  const foldW = (id) => {
    const d = folders.get(id);
    if (!d) throw new Error('Absent ' + id);
    return {
      getId: () => d.id,
      getName: () => d.name,
      getParents: () => iter(d.parents.map(foldW)),
      getFiles: () => iter([]),
      getFolders: () => iter([]),
      getFoldersByName: () => iter([]),
      moveTo: (dest) => { d.parents = [dest.getId()]; },
    };
  };
  const fileW = (id) => {
    const f = files.get(id);
    if (!f) throw new Error('Fichier absent ' + id);
    return {
      getId: () => f.id,
      getName: () => f.name,
      getMimeType: () => f.mimeType,
      isTrashed: () => f.trashed,
      getParents: () => iter(f.parents.map(foldW)),
      moveTo: (dest) => { f.parents = [dest.getId()]; },
    };
  };
  const httpRep = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });

  const c = load(['Config.gs', 'DriveRest.gs', 'Reset.gs', 'Maintenance.gs', 'VeilleDrive.gs'], {
    ScriptApp: { getOAuthToken: () => 'tok' },
    Utilities: { sleep: () => {} },
    UrlFetchApp: {
      fetch: (url) => {
        if (String(url).includes('startPageToken')) return httpRep(200, { startPageToken: '100' });
        if (modeHttp === 'err') return httpRep(500, { error: { message: 'boom' } });
        return httpRep(200, { changes: changementsPage, newStartPageToken: '101' });
      },
    },
    DriveApp: {
      getRootFolder: () => foldW('FICTIF_ROOT'),
      getFolderById: (id) => foldW(id),
      getFileById: (id) => fileW(id),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
  });

  const indexLignes = {
    'drive|f_idx_marc': { cle: 'drive|f_idx_marc', nom: '2026-03-01_Releve_Banque.pdf', chemin: '02 · Finances', statut: 'classé' },
    'drive|f_idx_moteur': { cle: 'drive|f_idx_moteur', nom: '2026-04-01_Facture.pdf', chemin: '02 · Finances', statut: 'classé' },
  };
  c.indexContient_ = (k) => Boolean(indexLignes[k] || ajoutsIndex.some((x) => x.cle === k));
  c.lireLigneIndex_ = (k) => indexLignes[k] || null;
  c.indexAjouter_ = (cle, meta) => { ajoutsIndex.push({ cle, meta }); };
  c.enregistrerAction_ = (type, cible, avant, apres, detail) => { actions.push({ type, cible, detail }); return 'act-1'; };
  c.journalInfo_ = (src, msg) => infos.push({ src, msg });
  c.journalErreur_ = (src, msg) => erreurs.push({ src, msg });
  c.constaterEtatDrive_ = (fid) => {
    const f = files.get(fid);
    return fid === 'f_idx_marc'
      ? { existe: true, corbeille: false, nom: f.name, chemin: '02 · Finances / Banque' }
      : { existe: true, corbeille: false, nom: f.name, chemin: '02 · Finances' };
  };
  c.decisionSyncIndex_ = (ligne, constat) => (ligne.chemin !== constat.chemin ? { statut: 'déplacé', nom: constat.nom, chemin: constat.chemin } : null);
  c.dossierExportsVeille_ = () => foldW('FICTIF_TECH');
  c.dossierTechnique_ = () => foldW('FICTIF_TECH');

  // 1) Premier appel : initialise startPageToken sans rejouer
  assert.strictEqual(c.veillerDrive_(() => false), 0);
  assert.strictEqual(props.get('DriveAI_CHANGES_TOKEN'), '100');
  assert.ok(infos.some((x) => x.msg.includes('initialisé')));

  // 2) Deuxième appel sur erreur HTTP 500 : jeton préservé à '100'
  modeHttp = 'err';
  c.veillerDrive_(() => false);
  assert.strictEqual(props.get('DriveAI_CHANGES_TOKEN'), '100', 'jeton jamais avancé sur échec HTTP');
  assert.ok(erreurs.some((x) => x.msg.includes('changes.list HTTP 500')));

  // 3) Troisième appel OK : traite déplacement Marc (+ épingle), ignore déplacement moteur identique, envoie f_new_sub → À trier, ignore Anna et 04
  modeHttp = 'ok';
  changementsPage = [
    { fileId: 'f_idx_marc', file: { id: 'f_idx_marc', name: '2026-03-01_Releve_Banque.pdf', mimeType: 'application/pdf', trashed: false } },
    { fileId: 'f_idx_moteur', file: { id: 'f_idx_moteur', name: '2026-04-01_Facture.pdf', mimeType: 'application/pdf', trashed: false } },
    { fileId: 'f_new_sub', file: { id: 'f_new_sub', name: 'ScanRecu.pdf', mimeType: 'application/pdf', trashed: false } },
    { fileId: 'f_anna', file: { id: 'f_anna', name: 'PersoAnna.pdf', mimeType: 'application/pdf', trashed: false } },
    { fileId: 'f_04', file: { id: 'f_04', name: 'Permis.pdf', mimeType: 'application/pdf', trashed: false } },
  ];
  const n = c.veillerDrive_(() => false);
  assert.strictEqual(n, 1, 'seul f_new_sub est déplacé vers 00 · À trier');
  assert.strictEqual(props.get('DriveAI_CHANGES_TOKEN'), '101');
  assert.deepStrictEqual(files.get('f_new_sub').parents, ['FICTIF_DOSSIERS_A_TRIER']);
  assert.deepStrictEqual(files.get('f_anna').parents, ['FICTIF_ANNA']);
  assert.deepStrictEqual(files.get('f_04').parents, ['FICTIF_D04']);
  assert.ok(ajoutsIndex.some((x) => x.cle === 'drive|f_idx_marc' && x.meta.statut === 'déplacé'));
  assert.ok(ajoutsIndex.some((x) => x.cle === 'epingle|f_idx_marc' && x.meta.statut === 'épinglé'));
  assert.ok(ajoutsIndex.some((x) => x.cle === 'drive|f_anna' && x.meta.statut === 'manuel' && x.meta.domaine === 'Anna' && x.meta.chemin === 'Anna'));
  assert.ok(ajoutsIndex.some((x) => x.cle === 'drive|f_04' && x.meta.statut === 'manuel' && x.meta.domaine === '04 · Immigration' && x.meta.chemin === '04 · Immigration'));
  assert.ok(!ajoutsIndex.some((x) => x.cle === 'epingle|f_idx_moteur'));
  assert.strictEqual(actions.length, 1);
});

test('VeilleDrive : prédicats purs de chemin logique, domaine, zones système/lecture seule et statut synchronisable', () => {
  const c = load(['Config.gs', 'Reset.gs', 'VeilleDrive.gs']);

  assert.strictEqual(c.formaterCheminLogiqueVeille_(['Mon Drive', 'Marc', '05 · Carrière', 'Employeurs']), '05 · Carrière/Employeurs');
  assert.strictEqual(c.formaterCheminLogiqueVeille_(['mon drive', 'marc', '02 · Finances', ' ', 'Banque']), '02 · Finances/Banque');
  assert.strictEqual(c.formaterCheminLogiqueVeille_(['Mon Drive', 'Perso']), 'Perso');

  assert.strictEqual(c.domaineDeCheminVeille_('05 · Carrière/Employeurs/EntrepriseFictive'), '05 · Carrière');
  assert.strictEqual(c.domaineDeCheminVeille_('04 · Immigration/Demande'), '04 · Immigration');
  assert.strictEqual(c.domaineDeCheminVeille_('Anna/Factures'), 'Anna');
  assert.strictEqual(c.domaineDeCheminVeille_('Autre/Sous'), '');

  assert.strictEqual(c.estSousZoneSystemeVeille_(['Marc', '_Technique', 'Archives']), true);
  assert.strictEqual(c.estSousZoneSystemeVeille_(['Marc', '04 · Immigration']), false);
  assert.strictEqual(c.estZoneCatalogueLectureSeuleVeille_(['Mon Drive', 'Anna', 'Perso']), true);
  assert.strictEqual(c.estZoneCatalogueLectureSeuleVeille_(['Marc', '04 · Immigration', 'MIFI']), true);
  assert.strictEqual(c.estZoneCatalogueLectureSeuleVeille_(['Marc', '05 · Carrière']), false);

  assert.strictEqual(c.statutSyncVeilleAutorise_('classé'), true);
  assert.strictEqual(c.statutSyncVeilleAutorise_('déplacé'), true);
  assert.strictEqual(c.statutSyncVeilleAutorise_('quarantaine'), false);
  assert.strictEqual(c.statutSyncVeilleAutorise_('à vérifier'), false);
});

test('VeilleDrive + Journal : dossier modifié propage arborescence et catalogue en lecture seule sur Drive', () => {
  const F1 = 'FICTIF_ID_FICHIER_0001'; // drive|
  const F2 = 'FICTIF_ID_FICHIER_0002'; // tri33p|v2|
  const F3 = 'FICTIF_ID_FICHIER_0003'; // déjà à jour
  const F4 = 'FICTIF_ID_FICHIER_0004'; // quarantaine
  const F5 = 'FICTIF_ID_FICHIER_0005'; // non indexé brut dans le dossier déplacé

  const indexRows = [
    ['Clé', 'Date', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
    ['drive|' + F1, '2026-11-01', '2025-05-01_Contrat.pdf', '02 · Finances', '02 · Finances/Employeurs', 'classé', 'aaa', 95, F1, 100, ''],
    ['drive|' + F2, '2026-11-01', '2024-02-01_Paie.pdf', '02 · Finances', '02 · Finances/Employeurs/EntrepriseFictive', 'classé', 'bbb', 90, F2, 200, ''],
    ['tri33p|v2|' + F2, '2026-11-02', '2024-02-01_Paie.pdf', '02 · Finances', '02 · Finances/Employeurs/EntrepriseFictive', 'classé', 'bbb', 92, F2, 200, ''],
    ['drive|' + F3, '2026-11-03', '2026-01-01_Attestation.pdf', '05 · Carrière', '05 · Carrière/Employeurs', 'classé', 'ccc', 98, F3, 150, ''],
    ['drive|' + F4, '2026-11-04', 'Brouillon_Q.pdf', '05 · Carrière', '02 · Finances/Employeurs', 'quarantaine', '', '', F4, 50, ''],
  ];

  const sheetMock = {
    getLastRow: () => indexRows.length,
    getRange: (r, c, nr, nc) => ({
      getValue: () => (indexRows[r - 1] && indexRows[r - 1][c - 1] !== undefined ? indexRows[r - 1][c - 1] : ''),
      setValue: (v) => { indexRows[r - 1][c - 1] = v; },
      getValues: () => {
        const out = [];
        for (let rr = r - 1; rr < r - 1 + nr; rr++) {
          const row = indexRows[rr] || [];
          out.push(Array.from({ length: nc }, (_, k) => (row[c - 1 + k] !== undefined ? row[c - 1 + k] : '')));
        }
        return out;
      },
    }),
    appendRow: (arr) => { indexRows.push(arr); },
  };

  const folders = new Map([
    ['FICTIF_ROOT', { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [] }],
    ['FICTIF_MARC', { id: 'FICTIF_MARC', name: 'Marc', parents: ['FICTIF_ROOT'] }],
    ['FICTIF_DOSSIERS_A_TRIER', { id: 'FICTIF_DOSSIERS_A_TRIER', name: '00 · À trier', parents: ['FICTIF_MARC'] }],
    ['FICTIF_TECH', { id: 'FICTIF_TECH', name: '_Technique', parents: ['FICTIF_MARC'] }],
    ['FICTIF_D05', { id: 'FICTIF_D05', name: '05 · Carrière', parents: ['FICTIF_MARC'] }],
    ['FICTIF_EMP', { id: 'FICTIF_EMP', name: 'Employeurs', parents: ['FICTIF_D05'] }],
    ['FICTIF_EMP_ROBO', { id: 'FICTIF_EMP_ROBO', name: 'EntrepriseFictive', parents: ['FICTIF_EMP'] }],
    ['FICTIF_EMP_SYS', { id: 'FICTIF_EMP_SYS', name: '_Technique', parents: ['FICTIF_EMP'] }],
  ]);
  const files = new Map([
    [F1, { id: F1, name: '2025-05-01_Contrat.pdf', mimeType: 'application/pdf', parents: ['FICTIF_EMP'], trashed: false }],
    [F2, { id: F2, name: '2024-02-01_Paie.pdf', mimeType: 'application/pdf', parents: ['FICTIF_EMP_ROBO'], trashed: false }],
    [F3, { id: F3, name: '2026-01-01_Attestation.pdf', mimeType: 'application/pdf', parents: ['FICTIF_EMP'], trashed: false }],
    [F4, { id: F4, name: 'Brouillon_Q.pdf', mimeType: 'application/pdf', parents: ['FICTIF_EMP'], trashed: false }],
    [F5, { id: F5, name: 'BrutNonIndexe.pdf', mimeType: 'application/pdf', parents: ['FICTIF_EMP'], trashed: false }],
    ['FICTIF_ID_FICHIER_TECHIGNORE', { id: 'FICTIF_ID_FICHIER_TECHIGNORE', name: 'NotesTech.pdf', mimeType: 'application/pdf', parents: ['FICTIF_EMP_SYS'], trashed: false }],
  ]);
  const moves = [];
  const infos = [];
  const props = new Map([['DriveAI_CHANGES_TOKEN', '200']]);

  const iter = (arr) => {
    let i = 0;
    return { hasNext: () => i < arr.length, next: () => arr[i++] };
  };
  const foldW = (id) => {
    const d = folders.get(id);
    if (!d) throw new Error('Dossier absent ' + id);
    return {
      getId: () => d.id,
      getName: () => d.name,
      getParents: () => iter(d.parents.map(foldW)),
      getFiles: () => iter([...files.values()].filter((f) => f.parents.includes(d.id)).map((f) => fileW(f.id))),
      getFolders: () => iter([...folders.values()].filter((x) => x.parents.includes(d.id)).map((x) => foldW(x.id))),
      getFoldersByName: () => iter([]),
      moveTo: (dest) => { moves.push({ id: d.id, dest: dest.getId() }); d.parents = [dest.getId()]; },
    };
  };
  const fileW = (id) => {
    const f = files.get(id);
    if (!f) throw new Error('Fichier absent ' + id);
    return {
      getId: () => f.id,
      getName: () => f.name,
      getMimeType: () => f.mimeType,
      isTrashed: () => f.trashed,
      getParents: () => iter(f.parents.map(foldW)),
      moveTo: (dest) => { moves.push({ id: f.id, dest: dest.getId() }); f.parents = [dest.getId()]; },
    };
  };
  const httpRep = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });

  const c = load(['Config.gs', 'Entites.gs', 'Journal.gs', 'DriveRest.gs', 'Reset.gs', 'Maintenance.gs', 'VeilleDrive.gs'], {
    ScriptApp: { getOAuthToken: () => 'tok' },
    Utilities: { sleep: () => {} },
    UrlFetchApp: {
      fetch: () => httpRep(200, {
        changes: [
          {
            fileId: 'FICTIF_EMP',
            file: { id: 'FICTIF_EMP', name: 'Employeurs', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_D05'], trashed: false },
          },
        ],
        newStartPageToken: '201',
      }),
    },
    DriveApp: {
      getRootFolder: () => foldW('FICTIF_ROOT'),
      getFolderById: (id) => foldW(id),
      getFileById: (id) => fileW(id),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
  });

  c.reinitialiserIndexCache_();
  c.feuille_ = () => sheetMock;
  c.journalInfo_ = (src, msg) => infos.push({ src, msg });
  c.journalErreur_ = (src, msg) => { throw new Error('Erreur inattendue: ' + src + ' ' + msg); };
  c.enregistrerAction_ = () => 'act-1';
  c.dossierExportsVeille_ = () => foldW('FICTIF_TECH');
  c.dossierTechnique_ = () => foldW('FICTIF_TECH');

  assert.strictEqual(c.derniereCleIndexPourFileId_(F2), 'tri33p|v2|' + F2);

  const depl = c.veillerDrive_(() => false);
  assert.strictEqual(depl, 0, 'aucun déplacement Drive déclenché lors de la propagation d arborescence');
  assert.strictEqual(moves.length, 0);
  assert.strictEqual(props.get('DriveAI_CHANGES_TOKEN'), '201');
  assert.deepStrictEqual(files.get(F5).parents, ['FICTIF_EMP'], 'fichier brut non déplacé vers À trier');

  const ajoutF1 = indexRows.find((r, i) => i >= 6 && r[0] === 'drive|' + F1);
  assert.ok(ajoutF1, 'F1 mis à jour sous drive|F1');
  assert.strictEqual(ajoutF1[3], '05 · Carrière');
  assert.strictEqual(ajoutF1[4], '05 · Carrière/Employeurs');
  assert.strictEqual(ajoutF1[5], 'déplacé');
  assert.strictEqual(ajoutF1[8], F1);

  const ajoutF2 = indexRows.find((r, i) => i >= 6 && r[0] === 'drive|' + F2);
  assert.ok(ajoutF2, 'F2 (tri33p) propagé sous drive|F2');
  assert.strictEqual(ajoutF2[3], '05 · Carrière');
  assert.strictEqual(ajoutF2[4], '05 · Carrière/Employeurs/EntrepriseFictive');
  assert.strictEqual(ajoutF2[5], 'déplacé');
  assert.strictEqual(ajoutF2[8], F2);

  assert.ok(indexRows.some((r, i) => i >= 6 && r[0] === 'epingle|' + F1 && r[5] === 'épinglé'));
  assert.ok(indexRows.some((r, i) => i >= 6 && r[0] === 'epingle|' + F2 && r[5] === 'épinglé'));
  assert.ok(!indexRows.some((r, i) => i >= 6 && (r[0] === 'drive|' + F3 || r[0] === 'drive|' + F4 || r[0] === 'drive|FICTIF_ID_FICHIER_TECHIGNORE')));

  assert.strictEqual(c.derniereCleIndexPourFileId_(F2), 'drive|' + F2, 'cache mis à jour après indexAjouter_');
  c.reinitialiserIndexCache_();
  assert.strictEqual(c.derniereCleIndexPourFileId_(F2), 'drive|' + F2, 'cache rechargé pointe vers la nouvelle ligne drive|F2');

  assert.ok(infos.some((x) => x.msg.includes('05 · Carrière/Employeurs') && x.msg.includes('2 document(s) mis à jour dans le catalogue')));
});

test('VeilleDrive + Journal : dossier modifié sous 04 · Immigration et Anna suit le catalogue en lecture seule (0 déplacement Drive)', () => {
  const F04_IDX = 'FICTIF_ID_IMMIG_INDEXE_01';
  const F04_NEW = 'FICTIF_ID_IMMIG_NOUVEAU1';
  const FANNA_IDX = 'FICTIF_ID_ANNA_INDEXE_001';
  const FANNA_NEW = 'FICTIF_ID_ANNA_NOUVEAU_01';

  const indexRows = [
    ['Clé', 'Date', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
    ['drive|' + F04_IDX, '2026-10-01', '2025-06-01_Permis.pdf', '04 · Immigration', '04 · Immigration/Ancien', 'classé', 'aaa', 95, F04_IDX, 100, ''],
    ['drive|' + FANNA_IDX, '2026-10-02', 'FactureMaison.pdf', 'Anna', 'Anna/Ancien', 'manuel', 'bbb', '', FANNA_IDX, 120, ''],
  ];

  const sheetMock = {
    getLastRow: () => indexRows.length,
    getRange: (r, c, nr, nc) => ({
      getValue: () => (indexRows[r - 1] && indexRows[r - 1][c - 1] !== undefined ? indexRows[r - 1][c - 1] : ''),
      setValue: (v) => { indexRows[r - 1][c - 1] = v; },
      getValues: () => {
        const out = [];
        for (let rr = r - 1; rr < r - 1 + nr; rr++) {
          const row = indexRows[rr] || [];
          out.push(Array.from({ length: nc }, (_, k) => (row[c - 1 + k] !== undefined ? row[c - 1 + k] : '')));
        }
        return out;
      },
    }),
    appendRow: (arr) => { indexRows.push(arr); },
  };

  const folders = new Map([
    ['FICTIF_ROOT', { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [] }],
    ['FICTIF_MARC', { id: 'FICTIF_MARC', name: 'Marc', parents: ['FICTIF_ROOT'] }],
    ['FICTIF_ANNA', { id: 'FICTIF_ANNA', name: 'Anna', parents: ['FICTIF_ROOT'] }],
    ['FICTIF_ANNA_FAC', { id: 'FICTIF_ANNA_FAC', name: 'Factures', parents: ['FICTIF_ANNA'] }],
    ['FICTIF_DOSSIERS_A_TRIER', { id: 'FICTIF_DOSSIERS_A_TRIER', name: '00 · À trier', parents: ['FICTIF_MARC'] }],
    ['FICTIF_TECH', { id: 'FICTIF_TECH', name: '_Technique', parents: ['FICTIF_MARC'] }],
    ['FICTIF_D04', { id: 'FICTIF_D04', name: '04 · Immigration', parents: ['FICTIF_MARC'] }],
    ['FICTIF_D04_MIFI', { id: 'FICTIF_D04_MIFI', name: 'MIFI', parents: ['FICTIF_D04'] }],
  ]);
  const files = new Map([
    [F04_IDX, { id: F04_IDX, name: '2025-06-01_Permis.pdf', mimeType: 'application/pdf', parents: ['FICTIF_D04_MIFI'], trashed: false }],
    [F04_NEW, { id: F04_NEW, name: 'AccuseReception.pdf', mimeType: 'application/pdf', parents: ['FICTIF_D04_MIFI'], trashed: false }],
    [FANNA_IDX, { id: FANNA_IDX, name: 'FactureMaison.pdf', mimeType: 'application/pdf', parents: ['FICTIF_ANNA_FAC'], trashed: false }],
    [FANNA_NEW, { id: FANNA_NEW, name: 'RecuAnna.pdf', mimeType: 'application/pdf', parents: ['FICTIF_ANNA_FAC'], trashed: false }],
  ]);
  const moves = [];
  const infos = [];
  const props = new Map([['DriveAI_CHANGES_TOKEN', '300']]);

  const iter = (arr) => {
    let i = 0;
    return { hasNext: () => i < arr.length, next: () => arr[i++] };
  };
  const foldW = (id) => {
    const d = folders.get(id);
    if (!d) throw new Error('Dossier absent ' + id);
    return {
      getId: () => d.id,
      getName: () => d.name,
      getParents: () => iter(d.parents.map(foldW)),
      getFiles: () => iter([...files.values()].filter((f) => f.parents.includes(d.id)).map((f) => fileW(f.id))),
      getFolders: () => iter([...folders.values()].filter((x) => x.parents.includes(d.id)).map((x) => foldW(x.id))),
      getFoldersByName: () => iter([]),
      moveTo: (dest) => { moves.push({ id: d.id, dest: dest.getId() }); d.parents = [dest.getId()]; },
    };
  };
  const fileW = (id) => {
    const f = files.get(id);
    if (!f) throw new Error('Fichier absent ' + id);
    return {
      getId: () => f.id,
      getName: () => f.name,
      getMimeType: () => f.mimeType,
      isTrashed: () => f.trashed,
      getParents: () => iter(f.parents.map(foldW)),
      moveTo: (dest) => { moves.push({ id: f.id, dest: dest.getId() }); f.parents = [dest.getId()]; },
    };
  };
  const httpRep = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });

  const c = load(['Config.gs', 'Entites.gs', 'Journal.gs', 'DriveRest.gs', 'Reset.gs', 'Maintenance.gs', 'VeilleDrive.gs'], {
    ScriptApp: { getOAuthToken: () => 'tok' },
    Utilities: { sleep: () => {} },
    UrlFetchApp: {
      fetch: () => httpRep(200, {
        changes: [
          {
            fileId: 'FICTIF_D04_MIFI',
            file: { id: 'FICTIF_D04_MIFI', name: 'MIFI', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_D04'], trashed: false },
          },
          {
            fileId: 'FICTIF_ANNA_FAC',
            file: { id: 'FICTIF_ANNA_FAC', name: 'Factures', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_ANNA'], trashed: false },
          },
        ],
        newStartPageToken: '301',
      }),
    },
    DriveApp: {
      getRootFolder: () => foldW('FICTIF_ROOT'),
      getFolderById: (id) => foldW(id),
      getFileById: (id) => fileW(id),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
  });

  c.reinitialiserIndexCache_();
  c.feuille_ = () => sheetMock;
  c.journalInfo_ = (src, msg) => infos.push({ src, msg });
  c.journalErreur_ = (src, msg) => { throw new Error('Erreur inattendue: ' + src + ' ' + msg); };
  c.enregistrerAction_ = () => 'act-1';
  c.dossierExportsVeille_ = () => foldW('FICTIF_TECH');
  c.dossierTechnique_ = () => foldW('FICTIF_TECH');

  const depl = c.veillerDrive_(() => false);
  assert.strictEqual(depl, 0, 'zéro déplacement Drive dans 04 · Immigration et Anna');
  assert.strictEqual(moves.length, 0);
  assert.deepStrictEqual(files.get(F04_NEW).parents, ['FICTIF_D04_MIFI']);
  assert.deepStrictEqual(files.get(FANNA_NEW).parents, ['FICTIF_ANNA_FAC']);

  const maj04 = indexRows.find((r, i) => i >= 3 && r[0] === 'drive|' + F04_IDX);
  assert.ok(maj04 && maj04[4] === '04 · Immigration/MIFI' && maj04[5] === 'déplacé');

  const new04 = indexRows.find((r, i) => i >= 3 && r[0] === 'drive|' + F04_NEW);
  assert.ok(new04 && new04[3] === '04 · Immigration' && new04[4] === '04 · Immigration/MIFI' && new04[5] === 'manuel');

  const majAnna = indexRows.find((r, i) => i >= 3 && r[0] === 'drive|' + FANNA_IDX);
  assert.ok(majAnna && majAnna[3] === 'Anna' && majAnna[4] === 'Anna/Factures' && majAnna[5] === 'déplacé');

  const newAnna = indexRows.find((r, i) => i >= 3 && r[0] === 'drive|' + FANNA_NEW);
  assert.ok(newAnna && newAnna[3] === 'Anna' && newAnna[4] === 'Anna/Factures' && newAnna[5] === 'manuel');

  assert.ok(infos.some((x) => x.msg.includes('04 · Immigration/MIFI') && x.msg.includes('2 document(s) mis à jour dans le catalogue')));
  assert.ok(infos.some((x) => x.msg.includes('Anna/Factures') && x.msg.includes('2 document(s) mis à jour dans le catalogue')));
});


test('VeilleDrive : extraction pure émetteur/type et exclusion zones protégées/système', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Reset.gs', 'VeilleDrive.gs']);

  assert.strictEqual(c.extraireTypeNomVeille_('2026-03-01_Releve_Banque_Exemple.pdf'), 'Releve');
  assert.strictEqual(c.extraireEmetteurNomVeille_('2026-03-01_Releve_Banque_Exemple.pdf'), 'Banque Exemple');
  assert.strictEqual(c.extraireEmetteurNomVeille_('2026-05_Facture_Hydro-Exemple (2).pdf'), 'Hydro-Exemple');
  assert.strictEqual(c.extraireEmetteurNomVeille_('2026-05-01_Contrat.pdf'), '');
  assert.strictEqual(c.extraireEmetteurNomVeille_('2026-01-01_Facture_Inconnu.pdf'), '');
  assert.strictEqual(c.extraireEmetteurNomVeille_('2026-01-01_Facture_Document.pdf'), '');
  assert.strictEqual(c.extraireEmetteurNomVeille_('2026-01-01_Facture_Banque.pdf'), ''); // générique
  assert.strictEqual(c.extraireEmetteurNomVeille_('2026-01-01_Facture_Marc_Exemple.pdf'), ''); // propriétaire

  assert.strictEqual(c.estZoneExclueApprentissageVeille_('04 · Immigration/MIFI', '04 · Immigration'), true);
  assert.strictEqual(c.estZoneExclueApprentissageVeille_('Anna/Factures', 'Anna'), true);
  assert.strictEqual(c.estZoneExclueApprentissageVeille_('00 · À trier', ''), true);
  assert.strictEqual(c.estZoneExclueApprentissageVeille_('_Technique/Scripts', '_Technique'), true);
  assert.strictEqual(c.estZoneExclueApprentissageVeille_('_Doublons/Hydro-Exemple', '_Doublons'), true);
  assert.strictEqual(c.estZoneExclueApprentissageVeille_('_Médias/Photos', '_Médias'), true);
  assert.strictEqual(c.estZoneExclueApprentissageVeille_('08 · Perso & projets/Données & exports', '08 · Perso & projets'), true);
  assert.strictEqual(c.estZoneExclueApprentissageVeille_('05 · Carrière/Alphatek', '05 · Carrière'), false);
});

test('VeilleDrive + Corrections : apprentissage auto sur déplacement manuel et exclusions strictes', () => {
  const indexRows = [
    ['Clé', 'Date', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
    ['drive|F_APPRENDRE', '2026-10-01', '2026-10-01_Contrat_Alphatek.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h1', 90, 'F_APPRENDRE', 100, ''],
    ['drive|F_EPINGLE', '2026-10-01', '2026-10-01_Facture_Betatek.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h2', 90, 'F_EPINGLE', 100, ''],
    ['epingle|F_EPINGLE', '2026-10-02', '2026-10-01_Facture_Betatek.pdf', '02 · Finances', '02 · Finances/2026', 'épinglé', '', '', 'F_EPINGLE', '', ''],
    ['drive|F_RENOMME', '2026-10-01', '2026-10-01_Facture_Gamma.pdf', '05 · Carrière', '05 · Carrière/Gamma', 'classé', 'h3', 90, 'F_RENOMME', 100, ''],
    ['drive|F_MANUEL', '2026-10-01', '2026-10-01_Recu_Delta.pdf', '08 · Perso & projets', '08 · Perso & projets/Delta', 'manuel', 'h4', '', 'F_MANUEL', 100, ''],
    ['drive|F_VERS_04', '2026-10-01', '2026-10-01_Lettre_Epsilon.pdf', '01 · Administratif & identité', '01 · Administratif & identité/Epsilon', 'classé', 'h5', 90, 'F_VERS_04', 100, ''],
    ['drive|F_DEPUIS_04', '2026-10-01', '2026-10-01_Lettre_Zeta.pdf', '04 · Immigration', '04 · Immigration/Zeta', 'classé', 'h6', 90, 'F_DEPUIS_04', 100, ''],
    ['drive|F_VERS_ANNA', '2026-10-01', '2026-10-01_Facture_Eta.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h7', 90, 'F_VERS_ANNA', 100, ''],
    ['drive|F_VERS_TRIER', '2026-10-01', '2026-10-01_Facture_Theta.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h8', 90, 'F_VERS_TRIER', 100, ''],
    ['drive|F_VERS_DOUBLON', '2026-10-01', '2026-10-01_Facture_Iota.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h9', 90, 'F_VERS_DOUBLON', 100, ''],
    ['drive|F_CORBEILLE', '2026-10-01', '2026-10-01_Facture_Kappa.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h10', 90, 'F_CORBEILLE', 100, ''],
  ];
  const corrRows = [
    ['Fichier', 'Émetteur', 'Domaine', 'Catégorie', 'Entité', 'Type', 'Corrigé le'],
  ];
  const makeSheet = (rows) => ({
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValue: () => (rows[r - 1] && rows[r - 1][c - 1] !== undefined ? rows[r - 1][c - 1] : ''),
      setValue: (v) => { rows[r - 1][c - 1] = v; },
      getValues: () => rows.slice(r - 1, r - 1 + nr).map((l) => Array.from({ length: nc }, (_, k) => (l[c - 1 + k] !== undefined ? l[c - 1 + k] : ''))),
    }),
    appendRow: (arr) => rows.push([...arr]),
  });

  const c = load(['Config.gs', 'Entites.gs', 'Corrections.gs', 'DossiersVie.gs', 'Journal.gs', 'Maintenance.gs', 'Reset.gs', 'VeilleDrive.gs']);
  c.reinitialiserIndexCache_();
  c.reinitialiserCorrectionsCache_();
  c.feuille_ = (nom) => (nom === 'Corrections' ? makeSheet(corrRows) : makeSheet(indexRows));
  c.journalInfo_ = () => {};
  c.journalErreur_ = (src, msg) => { throw new Error(src + ': ' + msg); };

  // 1) Déplacement manuel d'un doc classé vers 05 · Carrière/Alphatek → apprend !
  const rOk = c.synchroniserFichierIndexVeille_('F_APPRENDRE', '2026-10-01_Contrat_Alphatek.pdf', 'Mon Drive/Marc/05 · Carrière/Alphatek', false);
  assert.strictEqual(rOk.statut, 'déplacé');
  assert.strictEqual(corrRows.length, 2, 'une seule correction enregistrée');
  assert.strictEqual(corrRows[1][1], 'Alphatek');
  assert.strictEqual(corrRows[1][2], '05 · Carrière');
  assert.strictEqual(corrRows[1][4], 'Alphatek');
  assert.strictEqual(corrRows[1][5], 'Contrat');
  assert.ok(c.indexContient_('epingle|F_APPRENDRE'));

  // 2) Un re-déplacement ultérieur du même fichier est ignoré (déjà épinglé + statut déplacé)
  c.synchroniserFichierIndexVeille_('F_APPRENDRE', '2026-10-01_Contrat_Alphatek.pdf', 'Mon Drive/Marc/08 · Perso & projets/Autre', false);
  assert.strictEqual(corrRows.length, 2);

  // 3) Cas exclus : déjà épinglé, renommage même dossier, statut manuel, source/cible 04/Anna/À trier/_Doublons, corbeille
  c.synchroniserFichierIndexVeille_('F_EPINGLE', '2026-10-01_Facture_Betatek.pdf', 'Mon Drive/Marc/05 · Carrière/Betatek', false);
  c.synchroniserFichierIndexVeille_('F_RENOMME', '2026-10-01_Facture_Gamma_v2.pdf', 'Mon Drive/Marc/05 · Carrière/Gamma', false);
  c.synchroniserFichierIndexVeille_('F_MANUEL', '2026-10-01_Recu_Delta.pdf', 'Mon Drive/Marc/05 · Carrière/Delta', false);
  c.synchroniserFichierIndexVeille_('F_VERS_04', '2026-10-01_Lettre_Epsilon.pdf', 'Mon Drive/Marc/04 · Immigration/Epsilon', false);
  c.synchroniserFichierIndexVeille_('F_DEPUIS_04', '2026-10-01_Lettre_Zeta.pdf', 'Mon Drive/Marc/01 · Administratif & identité/Zeta', false);
  c.synchroniserFichierIndexVeille_('F_VERS_ANNA', '2026-10-01_Facture_Eta.pdf', 'Mon Drive/Anna/Eta', false);
  c.synchroniserFichierIndexVeille_('F_VERS_TRIER', '2026-10-01_Facture_Theta.pdf', 'Mon Drive/Marc/00 · À trier', false);
  c.synchroniserFichierIndexVeille_('F_VERS_DOUBLON', '2026-10-01_Facture_Iota.pdf', 'Mon Drive/Marc/_Doublons/Iota', false);
  c.synchroniserFichierIndexVeille_('F_CORBEILLE', '2026-10-01_Facture_Kappa.pdf', 'Mon Drive/Marc/02 · Finances/2026', true);
  assert.strictEqual(corrRows.length, 2, 'aucun des cas exclus ne doit écrire dans Corrections');

  // Vérifie que le few-shot exploite immédiatement la correction apprise
  const fs = c.exemplesFewShot_({ nomFichier: 'avenant_alphatek.pdf', expediteur: 'rh@alphatek.test', sujet: 'Avenant' });
  assert.ok(fs.includes('Alphatek') && fs.includes('05 · Carrière'));
});

test('VeilleDrive + DossiersVie + Entites : dossier vide adopté à chaud et renommage d entité propagé', () => {
  const entRows = [
    ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'],
    ['Alphatek', '05 · Carrière', 'Emploi & Carrière', 'Employeur', 'validée', 'DIR_RENOMME', '2026-10-01', '', 2],
    ['MIFI', '04 · Immigration', '', '', 'validée', 'DIR_04_MIFI', '2026-10-01', '', 1],
  ];
  const idxRows = [
    ['Clé', 'Date', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
  ];
  const makeSheet = (rows) => ({
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValue: () => (rows[r - 1] && rows[r - 1][c - 1] !== undefined ? rows[r - 1][c - 1] : ''),
      setValue: (v) => { rows[r - 1][c - 1] = v; },
      getValues: () => rows.slice(r - 1, r - 1 + nr).map((l) => Array.from({ length: nc }, (_, k) => (l[c - 1 + k] !== undefined ? l[c - 1 + k] : ''))),
    }),
    appendRow: (arr) => rows.push([...arr]),
  });

  const folders = new Map([
    ['FICTIF_ROOT', { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [] }],
    ['FICTIF_MARC', { id: 'FICTIF_MARC', name: 'Marc', parents: ['FICTIF_ROOT'] }],
    ['FICTIF_DOSSIERS_A_TRIER', { id: 'FICTIF_DOSSIERS_A_TRIER', name: '00 · À trier', parents: ['FICTIF_MARC'] }],
    ['FICTIF_D05', { id: 'FICTIF_D05', name: '05 · Carrière', parents: ['FICTIF_MARC'] }],
    ['DIR_RENOMME', { id: 'DIR_RENOMME', name: 'Betatek', parents: ['FICTIF_D05'] }],
    ['DIR_VIDE_NEUF', { id: 'DIR_VIDE_NEUF', name: 'ClientVide', parents: ['FICTIF_D05'] }],
    ['FICTIF_D04', { id: 'FICTIF_D04', name: '04 · Immigration', parents: ['FICTIF_MARC'] }],
    ['DIR_04_MIFI', { id: 'DIR_04_MIFI', name: 'MIFI_Renomme', parents: ['FICTIF_D04'] }],
  ]);
  const props = new Map([['DriveAI_CHANGES_TOKEN', '500']]);
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const foldW = (id) => {
    const d = folders.get(id);
    return {
      getId: () => d.id,
      getName: () => d.name,
      getParents: () => iter(d.parents.map(foldW)),
      getFiles: () => iter([]),
      getFolders: () => iter([]),
      getFoldersByName: () => iter([]),
    };
  };

  const c = load(['Config.gs', 'Entites.gs', 'DossiersVie.gs', 'Journal.gs', 'DriveRest.gs', 'Reset.gs', 'Maintenance.gs', 'VeilleDrive.gs'], {
    ScriptApp: { getOAuthToken: () => 'tok' },
    Utilities: { sleep: () => {} },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          changes: [
            { fileId: 'DIR_RENOMME', file: { id: 'DIR_RENOMME', name: 'Betatek', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_D05'], trashed: false } },
            { fileId: 'DIR_VIDE_NEUF', file: { id: 'DIR_VIDE_NEUF', name: 'ClientVide', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_D05'], trashed: false } },
            { fileId: 'DIR_04_MIFI', file: { id: 'DIR_04_MIFI', name: 'MIFI_Renomme', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_D04'], trashed: false } },
          ],
          newStartPageToken: '501',
        }),
      }),
    },
    DriveApp: { getRootFolder: () => foldW('FICTIF_ROOT'), getFolderById: (id) => foldW(id) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
  });

  c.reinitialiserIndexCache_();
  c.reinitialiserEntitesCache_();
  c.reinitialiserDossiersVieCache_();
  c.feuille_ = (nom) => (nom === 'Entités' ? makeSheet(entRows) : makeSheet(idxRows));
  c.journalInfo_ = () => {};
  c.journalErreur_ = (src, msg) => { throw new Error(src + ': ' + msg); };
  c.dossierTechnique_ = () => foldW('FICTIF_DOSSIERS_A_TRIER');

  // Pré-charge le cache dossiers de vie AVANT le changement pour prouver la mise à jour à chaud
  assert.strictEqual(c.dossiersVieCache_().length, 0);

  c.veillerDrive_(() => false);

  // 1) DossiersVie adoptés à chaud (y compris ClientVide, jamais MIFI_Renomme de 04 · Immigration)
  const dv = JSON.parse(JSON.stringify(c.dossiersVieCache_()));
  assert.ok(dv.some((d) => d.chemin === '05 · Carrière/Betatek'));
  assert.ok(dv.some((d) => d.chemin === '05 · Carrière/ClientVide' && d.nbDocs === 0));
  assert.ok(!dv.some((d) => d.chemin.includes('04 · Immigration')));

  // 2) Entités renommée Alphatek → Betatek + variante anti-doublon ; MIFI de 04 intouchée
  assert.strictEqual(entRows[1][0], 'Betatek');
  assert.strictEqual(entRows[2][0], 'MIFI');
  assert.strictEqual(entRows[3][0], 'Alphatek');
  assert.strictEqual(entRows[3][4], 'variante de : Betatek');
});

test('VeilleDrive : ignore déplacement hors domaine et variantes sans accent/majuscule (0 correction, 0 epingle, 0 dossier, 0 entité)', () => {
  const indexRows = [
    ['Clé', 'Date', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
    ['drive|F_HORS_DOM', '2026-10-01', '2026-10-01_Facture_Alphatek.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h1', 90, 'F_HORS_DOM', 100, ''],
    ['drive|F_A_TRIER_NOACC', '2026-10-01', '2026-10-01_Facture_Betatek.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h2', 90, 'F_A_TRIER_NOACC', 100, ''],
    ['drive|F_A_TRIER_MAJ', '2026-10-01', '2026-10-01_Facture_Gamma.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h3', 90, 'F_A_TRIER_MAJ', 100, ''],
    ['drive|F_A_VERIF_NOACC', '2026-10-01', '2026-10-01_Facture_Delta.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h4', 90, 'F_A_VERIF_NOACC', 100, ''],
    ['drive|F_MEDIAS_NOACC', '2026-10-01', '2026-10-01_Facture_Epsilon.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h5', 90, 'F_MEDIAS_NOACC', 100, ''],
    ['drive|F_EXP_NOACC', '2026-10-01', '2026-10-01_Facture_Zeta.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'h6', 90, 'F_EXP_NOACC', 100, ''],
  ];
  const corrRows = [['Fichier', 'Émetteur', 'Domaine', 'Catégorie', 'Entité', 'Type', 'Corrigé le']];
  const entRows = [
    ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'],
    ['DonneesSub', '08 · Perso & projets', '', '', 'validée', 'DIR_EXP_NOACC', '2026-10-01', '', 1],
  ];
  const makeSheet = (rows) => ({
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValue: () => (rows[r - 1] && rows[r - 1][c - 1] !== undefined ? rows[r - 1][c - 1] : ''),
      setValue: (v) => { rows[r - 1][c - 1] = v; },
      getValues: () => rows.slice(r - 1, r - 1 + nr).map((l) => Array.from({ length: nc }, (_, k) => (l[c - 1 + k] !== undefined ? l[c - 1 + k] : ''))),
    }),
    appendRow: (arr) => rows.push([...arr]),
  });

  const folders = new Map([
    ['FICTIF_ROOT', { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [] }],
    ['FICTIF_MARC', { id: 'FICTIF_MARC', name: 'Marc', parents: ['FICTIF_ROOT'] }],
    ['FICTIF_DOSSIERS_A_TRIER', { id: 'FICTIF_DOSSIERS_A_TRIER', name: '00 · À trier', parents: ['FICTIF_MARC'] }],
    ['FICTIF_D08', { id: 'FICTIF_D08', name: '08 · Perso & projets', parents: ['FICTIF_MARC'] }],
    ['FICTIF_EXP_NOACC_PARENT', { id: 'FICTIF_EXP_NOACC_PARENT', name: 'Donnees & exports', parents: ['FICTIF_D08'] }],
    ['DIR_EXP_NOACC', { id: 'DIR_EXP_NOACC', name: 'TakeoutNoAcc', parents: ['FICTIF_EXP_NOACC_PARENT'] }],
    ['FICTIF_MED_NOACC_PARENT', { id: 'FICTIF_MED_NOACC_PARENT', name: '_Medias', parents: ['FICTIF_D08'] }],
    ['DIR_MED_NOACC', { id: 'DIR_MED_NOACC', name: 'PhotosNoAcc', parents: ['FICTIF_MED_NOACC_PARENT'] }],
  ]);
  const props = new Map([['DriveAI_CHANGES_TOKEN', '600']]);
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const foldW = (id) => {
    const d = folders.get(id);
    return {
      getId: () => d.id, getName: () => d.name,
      getParents: () => iter(d.parents.map(foldW)),
      getFiles: () => iter([]), getFolders: () => iter([]), getFoldersByName: () => iter([]),
    };
  };

  const c = load(['Config.gs', 'Entites.gs', 'Corrections.gs', 'DossiersVie.gs', 'Journal.gs', 'DriveRest.gs', 'Reset.gs', 'Maintenance.gs', 'VeilleDrive.gs'], {
    ScriptApp: { getOAuthToken: () => 'tok' },
    Utilities: { sleep: () => {} },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          changes: [
            { fileId: 'DIR_EXP_NOACC', file: { id: 'DIR_EXP_NOACC', name: 'TakeoutNoAcc', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_EXP_NOACC_PARENT'], trashed: false } },
            { fileId: 'DIR_MED_NOACC', file: { id: 'DIR_MED_NOACC', name: 'PhotosNoAcc', mimeType: 'application/vnd.google-apps.folder', parents: ['FICTIF_MED_NOACC_PARENT'], trashed: false } },
          ],
          newStartPageToken: '601',
        }),
      }),
    },
    DriveApp: { getRootFolder: () => foldW('FICTIF_ROOT'), getFolderById: (id) => foldW(id) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
  });

  c.reinitialiserIndexCache_();
  c.reinitialiserCorrectionsCache_();
  c.reinitialiserEntitesCache_();
  c.reinitialiserDossiersVieCache_();
  c.feuille_ = (nom) => (nom === 'Corrections' ? makeSheet(corrRows) : (nom === 'Entités' ? makeSheet(entRows) : makeSheet(indexRows)));
  c.journalInfo_ = () => {};
  c.journalErreur_ = (src, msg) => { throw new Error(src + ': ' + msg); };
  c.dossierTechnique_ = () => foldW('FICTIF_DOSSIERS_A_TRIER');

  // 1) Déplacements fichiers hors domaine et vers variantes sans accent/majuscule
  c.synchroniserFichierIndexVeille_('F_HORS_DOM', '2026-10-01_Facture_Alphatek.pdf', 'Mon Drive/PersoAutre/MesFactures', false);
  c.synchroniserFichierIndexVeille_('F_A_TRIER_NOACC', '2026-10-01_Facture_Betatek.pdf', 'Mon Drive/Marc/00 · A trier', false);
  c.synchroniserFichierIndexVeille_('F_A_TRIER_MAJ', '2026-10-01_Facture_Gamma.pdf', 'Mon Drive/Marc/00 · À TRIER', false);
  c.synchroniserFichierIndexVeille_('F_A_VERIF_NOACC', '2026-10-01_Facture_Delta.pdf', 'Mon Drive/Marc/00 · A verifier', false);
  c.synchroniserFichierIndexVeille_('F_MEDIAS_NOACC', '2026-10-01_Facture_Epsilon.pdf', 'Mon Drive/Marc/_Medias/Vacances', false);
  c.synchroniserFichierIndexVeille_('F_EXP_NOACC', '2026-10-01_Facture_Zeta.pdf', 'Mon Drive/Marc/08 · Perso & projets/Donnees & exports', false);

  assert.strictEqual(corrRows.length, 1, '0 correction écrite');
  assert.strictEqual(c.indexContient_('epingle|F_A_TRIER_NOACC'), false, '0 epingle sur 00 · A trier');
  assert.strictEqual(c.indexContient_('epingle|F_A_TRIER_MAJ'), false, '0 epingle sur 00 · À TRIER');

  // 2) Changements de dossiers sous Donnees & exports et _Medias
  c.veillerDrive_(() => false);
  assert.strictEqual(props.has('DriveAI_DOSSIERS_VIE_DIRECTS'), false, '0 dossier direct adopté');
  assert.strictEqual(entRows[1][0], 'DonneesSub', '0 renommage dans Entités');
});
