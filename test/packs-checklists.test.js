'use strict';
/**
 * Tests Lot 4A — Checklists automatiques (#13), Plan « Changement de vie » (#14) et Packs 1-clic (#15).
 * Données 100 % fictives uniquement (`FICTIF_*`, `@exemple.test`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

const ID44 = (tag) => ('FICTIF_' + tag + '_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8').slice(0, 44);
const plain = (x) => JSON.parse(JSON.stringify(x));

function makeSheetEnv(initial) {
  const sheets = Object.assign({
    Copilote: [['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations']],
    Index: [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire']],
    Signaux: [['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation']],
    Liens: [['Horodatage', 'ThreadId', 'MessageId', 'Expéditeur', 'Domaine', 'Chemin', 'FileId', 'Fichier']],
    Entités: [['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois']],
    Journal: [['Horodatage', 'Niveau', 'Source', 'Message']],
  }, initial || {});
  const sheetObj = (nom) => {
    const rows = sheets[nom] || (sheets[nom] = [['Clé']]);
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] ? rows[0].length : 1),
      appendRow: (r) => { rows.push(r.slice()); },
      getRange: (r, c, nr, nc) => ({
        getValue: () => (rows[r - 1] ? rows[r - 1][c - 1] : ''),
        setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; },
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

function makeDrivePacksEnv(filesMap, foldersMap) {
  const shortcuts = [];
  const moves = [];
  const renames = [];
  const props = new Map();
  let throwRest = false;

  const wrapFolder = (id) => {
    const d = foldersMap[id];
    if (!d) throw new Error('Dossier absent ' + id);
    const w = {
      getId: () => d.id,
      getName: () => d.name,
      isTrashed: () => !!d.trashed,
      getParents: () => iter((d.parents || []).map(wrapFolder)),
      getFoldersByName: (nom) => iter((d.folders || []).map((sid) => foldersMap[sid]).filter((x) => x && x.name === nom).map((x) => wrapFolder(x.id))),
      createFolder: (nom) => {
        const nid = 'FICTIF_DIR_' + nom.replace(/\s+/g, '_');
        foldersMap[nid] = { id: nid, name: nom, parents: [d.id], folders: [], files: [] };
        d.folders = d.folders || [];
        d.folders.push(nid);
        return wrapFolder(nid);
      },
    };
    if (d.withGetUrl) w.getUrl = () => 'https://drive.google.com/drive/folders/' + d.id;
    return w;
  };
  const wrapFile = (id) => {
    const f = filesMap[id];
    if (!f) throw new Error('Fichier absent ' + id);
    return {
      getId: () => f.id,
      getName: () => f.name,
      isTrashed: () => !!f.trashed,
      getParents: () => iter((f.parents || []).map(wrapFolder)),
      moveTo: () => { moves.push(id); },
      setName: () => { renames.push(id); },
    };
  };

  return {
    shortcuts, moves, renames, props,
    setThrowRest: (v) => { throwRest = v; },
    overrides: {
      ScriptApp: { getOAuthToken: () => 'tok' },
      Utilities: { sleep: () => {} },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => (props.has(k) ? props.get(k) : null),
          setProperty: (k, v) => { props.set(k, String(v)); },
        }),
      },
      DriveApp: {
        getFolderById: wrapFolder,
        getFileById: wrapFile,
        getRootFolder: () => wrapFolder('FICTIF_ROOT'),
      },
      UrlFetchApp: {
        fetch: (url, opts) => {
          if (throwRest) throw new Error('réseau coupé');
          const m = (opts && opts.method ? String(opts.method) : 'get').toLowerCase();
          if (m === 'post') {
            const body = JSON.parse(opts.payload || '{}');
            shortcuts.push({ targetId: body.shortcutDetails && body.shortcutDetails.targetId, parentId: body.parents && body.parents[0], name: body.name });
            return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: 'FICTIF_SC_' + shortcuts.length }) };
          }
          const q = new URL(String(url)).searchParams.get('q') || '';
          const pm = /'([^']+)' in parents/.exec(q);
          const pid = pm ? pm[1] : '';
          const exist = shortcuts.filter((s) => s.parentId === pid).map((s) => ({ shortcutDetails: { targetId: s.targetId } }));
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ files: exist }) };
        },
      },
    },
  };
}

test('indexerDocumentsVivantsPacks_ : déduplique, exclut zones système, inclut 04/Anna et trie par dateDoc fiable', () => {
  const c = load(['Config.gs', 'Journal.gs', 'VeilleDrive.gs', 'PacksChecklists.gs']);
  const f1 = ID44('01'), f2 = ID44('02'), f3 = ID44('03'), f4 = ID44('04'), f5 = ID44('05');
  const idx = [
    ['epingle|' + f1, new Date('2026-11-20'), 'x.pdf', '02 · Finances', '02 · Finances', 'épinglé', '', '', f1],
    ['agenda|t1|2026-12-01', new Date('2026-11-20'), 'Echeance', '02 · Finances', '2026-12-01', 'agenda', '', '', ''],
    ['tri|t2|1|lu', new Date('2026-11-20'), 'Tri', '02 · Finances', '02 · Finances', 'tri', '', '', ''],
    ['drive|' + f1, new Date('2026-01-10'), '2026-01-10_Bail_Bellerives.pdf', '00 · À trier', '00 · À trier', 'classé', '', '', f1],
    ['drive|' + f1, new Date('2026-09-01'), '2026-09-01_Bail_Bellerives.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Bellerives', 'déplacé', '', '', f1],
    ['drive|' + f2, new Date('2026-11-10'), '2025-05-01_Permis_IRCC.pdf', '04 · Immigration', '04 · Immigration/Permis', 'manuel', '', '', f2],
    ['drive|' + f3, new Date('2026-11-15'), '2026-10_Recu_CliniqueExemple.pdf', 'Anna', 'Anna/Sante', 'manuel', '', '', f3],
    ['drive|' + f4, new Date('2026-11-18'), '2026-11-18_Pack.pdf', '00 · Packs', '00 · Packs/2026-11-18_Logement', 'classé', '', '', f4],
    ['drive|' + f5, new Date('2026-11-19'), '2019_Diplome_UnivExemple.pdf', '05 · Carrière', '05 · Carrière/Diplomes', 'classé', '', '', f5],
  ];
  const sig = [{ fileId: f2, dateDoc: '2026-08-15', dateExpiration: '2027-08-15', categorie: 'Permis IRCC', fournisseur: 'IRCC' }];
  const docs = plain(c.indexerDocumentsVivantsPacks_(idx, sig));
  assert.strictEqual(docs.length, 4);
  assert.deepStrictEqual(docs.map((d) => d.fileId), [f3, f1, f2, f5]);
  assert.strictEqual(docs[0].dateDoc, '2026-10-31'); // 2026-10 -> fin de mois
  assert.strictEqual(docs[2].dateDoc, '2026-08-15'); // Signaux.dateDoc prime
  assert.strictEqual(docs[3].dateDoc, '2019-01-01'); // vieux doc re-classé garde 2019
});

test('Checklists (#13) : auto-cochage, expiration ignorée, ActionJson <= 500 avec fileId 44 car., sync non destructive', () => {
  const env = makeSheetEnv();
  const c = load(['Config.gs', 'Journal.gs', 'Copilote.gs', 'PacksChecklists.gs']);
  c.feuille_ = env.feuille_;
  const ref = new Date('2026-11-25T12:00:00Z');
  const fBail = ID44('BAIL'), fAssur = ID44('ASSU'), fPass = ID44('PASS'), fPaie = ID44('PAIE'), fRib = ID44('RIB1'), fExp = ID44('EXPI');
  const docs = [
    { fileId: fBail, nom: '2026-06-01_Bail_Logement.pdf', domaine: '03 · Logement & véhicule', chemin: '03 · Logement & véhicule/Bail', dateDoc: '2026-06-01', dateExpiration: '', categorie: 'Bail', fournisseur: 'Bellerives' },
    { fileId: fAssur, nom: '2026-06-02_Assurance habitation_AssurNord.pdf', domaine: '03 · Logement & véhicule', chemin: '03 · Logement & véhicule/Assurance', dateDoc: '2026-06-02', dateExpiration: '', categorie: 'Assurance habitation', fournisseur: 'AssurNord' },
    { fileId: fExp, nom: '2020-01-01_Passeport_IRCC.pdf', domaine: '04 · Immigration', chemin: '04 · Immigration/Passeport', dateDoc: '2020-01-01', dateExpiration: '2025-01-01', categorie: 'Passeport', fournisseur: 'IRCC' },
    { fileId: fPass, nom: '2025-02-01_Passeport_Etat.pdf', domaine: '04 · Immigration', chemin: '04 · Immigration/Passeport', dateDoc: '2025-02-01', dateExpiration: '2030-02-01', categorie: 'Passeport', fournisseur: 'Etat' },
    { fileId: fPaie, nom: '2026-10-15_Bulletin de paie_Alphatek.pdf', domaine: '05 · Carrière', chemin: '05 · Carrière/Alphatek', dateDoc: '2026-10-15', dateExpiration: '', categorie: 'Bulletin de paie', fournisseur: 'Alphatek' },
    { fileId: fRib, nom: '2026-01-05_Identite bancaire_BanqueExemple.pdf', domaine: '02 · Finances', chemin: '02 · Finances/Banque', dateDoc: '2026-01-05', dateExpiration: '', categorie: 'RIB', fournisseur: 'BanqueExemple' },
  ];
  const cartes = plain(c.analyserChecklistsCopilotePure_(docs, [['2026-10-15', 'thr-1', 'm1', 'paie@alphatek.test', '05 · Carrière', '05 · Carrière/Alphatek', fPaie, 'paie.pdf']], ref));
  assert.strictEqual(cartes.length, 5);
  const log = cartes.find((x) => x.action.cle === 'chk|logement');
  assert.strictEqual(log.action.items.every((it) => it.ok === 1), true);
  assert.strictEqual(log.action.items.find((it) => it.k === 'ident').f, fPass, 'le passeport expiré est ignoré au profit du valide');
  const jsonBorne = c.serialiserPackAction_(log.action);
  assert.ok(jsonBorne.length <= 500, 'ActionJson <= 500 avec 5 fileId de 44 car. : ' + jsonBorne.length);

  // Sync : crée, puis gère manuel + terminé + ignoré sans doublon ni écrasement
  const idxRows = docs.map((d) => ['drive|' + d.fileId, new Date(d.dateDoc), d.nom, d.domaine, d.chemin, 'classé', '', '', d.fileId]);
  assert.strictEqual(c.detecterChecklistsCopilote_(idxRows, () => false, 10), 5);
  assert.strictEqual(env.sheets.Copilote.length, 6);

  const rowLog = env.sheets.Copilote.find((r) => r[3] === 'checklist' && JSON.parse(r[7]).cle === 'chk|logement');
  assert.strictEqual(rowLog[8], 'terminé');
  // Décochage manuel d'un item sur une carte déjà terminée -> passe actif, m=1 préservé au re-scan
  const repU = plain(c.executerChecklistCopilote_({ checklistId: rowLog[0], item: 'bail', coche: false }));
  assert.strictEqual(repU.ok, true);
  assert.strictEqual(repU.statut, 'actif');
  assert.strictEqual(c.detecterChecklistsCopilote_(idxRows, () => false, 10), 0);
  const rowLogApres = env.sheets.Copilote.find((r) => r[0] === rowLog[0]);
  assert.strictEqual(rowLogApres[8], 'actif');
  assert.strictEqual(JSON.parse(rowLogApres[7]).items.find((x) => x.k === 'bail').ok, 0, 'décochage manuel préservé');

  // Statut ignoré respecté (ni recréé ni modifiable via executerChecklistCopilote_)
  const rowVoy = env.sheets.Copilote.find((r) => r[3] === 'checklist' && JSON.parse(r[7]).cle === 'chk|voyage');
  c.executerDecisionCopilote_({ id: rowVoy[0], decision: 'ignorer' });
  assert.strictEqual(c.detecterChecklistsCopilote_(idxRows, () => false, 10), 0);
  assert.strictEqual(env.sheets.Copilote.filter((r) => r[3] === 'checklist' && JSON.parse(r[7]).cle === 'chk|voyage').length, 1);
  const repIgn = plain(c.executerChecklistCopilote_({ checklistId: rowVoy[0], item: 'pass', coche: true }));
  assert.strictEqual(repIgn.ok, false);
  assert.strictEqual(repIgn.erreur, 'checklist ignorée');

  // pass-auto bloqué sur checklist
  assert.strictEqual(c.executerDecisionCopilote_({ id: rowLog[0], decision: 'passer-auto' }).ok, false);

  // Coche via demarche sans item ni coche explicite + bascule toggle
  const repDem = plain(c.executerChecklistCopilote_({ demarche: 'Logement', item: 'bail' }));
  assert.strictEqual(repDem.ok, true);
  assert.strictEqual(repDem.statut, 'terminé');
  assert.strictEqual(c.executerChecklistCopilote_({ checklistId: 'inexistant', item: 'bail' }).ok, false);
});

test('Checklists (#13) : multi-ticks (valide -> inchangé sans m:1 -> expiré repasse à ok:0) et 5 fileId de 44 car. conservés', () => {
  const env = makeSheetEnv();
  const c = load(['Config.gs', 'Journal.gs', 'Copilote.gs', 'PacksChecklists.gs']);
  c.feuille_ = env.feuille_;
  const f1 = ID44('CHK1'), f2 = ID44('CHK2'), f3 = ID44('CHK3'), f4 = ID44('CHK4'), f5 = ID44('CHK5');
  const sigRows = [{ fileId: f3, dateDoc: '2026-01-01', dateExpiration: '2028-01-01', categorie: 'Passeport', fournisseur: 'Etat' }];
  c.lireSignauxPacks_ = () => sigRows;
  const idx = [
    ['drive|' + f1, new Date('2026-10-01'), '2026-10-01_Bail_Logement.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Bail', 'classé', '', '', f1],
    ['drive|' + f2, new Date('2026-10-01'), '2026-10-01_Assurance habitation_Assur.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Assurance', 'classé', '', '', f2],
    ['drive|' + f3, new Date('2026-10-01'), '2026-01-01_Passeport_Etat.pdf', '04 · Immigration', '04 · Immigration/Passeport', 'classé', '', '', f3],
    ['drive|' + f4, new Date('2026-10-01'), '2026-10-01_Bulletin de paie_Alphatek.pdf', '05 · Carrière', '05 · Carrière/Alphatek', 'classé', '', '', f4],
    ['drive|' + f5, new Date('2026-10-01'), '2026-10-01_RIB_Banque.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', f5],
  ];

  // Conservation des 5 fileId de 44 car. sur les 5 démarches (même si 5 items complets)
  const tousDocs5 = [
    { fileId: f1, nom: '2026-10-01_Bail_CV_T4_Permis.pdf', domaine: '03 · Logement & véhicule', chemin: '03 · Logement & véhicule', dateDoc: '2026-10-01', dateExpiration: '', categorie: '', fournisseur: '' },
    { fileId: f2, nom: '2026-10-01_Assurance habitation_Assurance voyage_Contrat_RL1.pdf', domaine: '05 · Carrière', chemin: '05 · Carrière', dateDoc: '2026-10-01', dateExpiration: '', categorie: '', fournisseur: '' },
    { fileId: f3, nom: '2026-10-01_Passeport_Diplome_RL31.pdf', domaine: '04 · Immigration', chemin: '04 · Immigration', dateDoc: '2026-10-01', dateExpiration: '', categorie: '', fournisseur: '' },
    { fileId: f4, nom: '2026-10-01_Bulletin de paie_Billet_Avis de cotisation_Emploi.pdf', domaine: '02 · Finances', chemin: '02 · Finances', dateDoc: '2026-10-01', dateExpiration: '', categorie: '', fournisseur: '' },
    { fileId: f5, nom: '2026-10-01_Identite bancaire_Visa_Recu_Naissance.pdf', domaine: '02 · Finances', chemin: '02 · Finances', dateDoc: '2026-10-01', dateExpiration: '', categorie: '', fournisseur: '' },
  ];
  c.analyserChecklistsCopilotePure_(tousDocs5, [], new Date('2026-11-25')).forEach((carte) => {
    const js = c.serialiserPackAction_(carte.action);
    assert.ok(js.length <= 500, carte.action.cle + ' <= 500 (' + js.length + ')');
    const items = JSON.parse(js).items;
    assert.strictEqual(items.every((it) => it.f && it.f.length === 44), true, 'tous les fileId de 44 car. conservés sur ' + carte.action.cle);
  });

  // Tick 1 : valide -> ok:1 sans m:1
  assert.strictEqual(c.detecterChecklistsCopilote_(idx, () => false, 10), 5);
  const rowLog1 = env.sheets.Copilote.find((r) => r[3] === 'checklist' && JSON.parse(r[7]).cle === 'chk|logement');
  const ident1 = JSON.parse(rowLog1[7]).items.find((x) => x.k === 'ident');
  assert.strictEqual(ident1.ok, 1);
  assert.strictEqual(ident1.m, undefined);

  // Tick 2 : inchangé -> reste ok:1 et toujours sans m:1
  assert.strictEqual(c.detecterChecklistsCopilote_(idx, () => false, 10), 0);
  const ident2 = JSON.parse(rowLog1[7]).items.find((x) => x.k === 'ident');
  assert.strictEqual(ident2.ok, 1);
  assert.strictEqual(ident2.m, undefined);

  // Tick 3 : document expiré -> repasse automatiquement à ok:0 et statut actif
  sigRows[0].dateExpiration = '2020-01-01';
  assert.strictEqual(c.detecterChecklistsCopilote_(idx, () => false, 10), 0);
  const ident3 = JSON.parse(rowLog1[7]).items.find((x) => x.k === 'ident');
  assert.strictEqual(ident3.ok, 0);
  assert.strictEqual(ident3.f, undefined);
  assert.strictEqual(rowLog1[8], 'actif');
});

test('Plan « Changement de vie » (#14) : vrais organismes 18 mois sans PII, vieux doc ignoré, confirmations préservées', () => {
  const env = makeSheetEnv();
  const c = load(['Config.gs', 'Journal.gs', 'Entites.gs', 'VeilleDrive.gs', 'Copilote.gs', 'PacksChecklists.gs']);
  c.feuille_ = env.feuille_;
  const ref = new Date('2026-11-25T12:00:00Z');
  const fHydro = ID44('HYDR'), fOld = ID44('OLDD'), fImmi = ID44('IMMI'), fAnna = ID44('ANNA'), fAddr = ID44('ADDR'), fMarc = ID44('MARC');
  const docs = [
    { fileId: fHydro, nom: '2026-10-01_Facture_Hydro-Exemple Inc..pdf', domaine: '02 · Finances', chemin: '02 · Finances/Hydro-Exemple', dateDoc: '2026-10-01', dateExpiration: '', categorie: 'Facture', fournisseur: 'Hydro-Exemple Inc.' },
    { fileId: fImmi, nom: '2026-09-15_Lettre_IRCC.pdf', domaine: '04 · Immigration', chemin: '04 · Immigration/IRCC', dateDoc: '2026-09-15', dateExpiration: '', categorie: 'Courrier', fournisseur: 'IRCC' },
    { fileId: fAnna, nom: '2026-08-10_Recu_Clinique Exemple.pdf', domaine: 'Anna', chemin: 'Anna/Clinique Exemple', dateDoc: '2026-08-10', dateExpiration: '', categorie: 'Reçu', fournisseur: 'Clinique Exemple' },
    { fileId: fOld, nom: '2020-05-01_Diplome_AncienneEcole.pdf', domaine: '05 · Carrière', chemin: '05 · Carrière/AncienneEcole', dateDoc: '2020-05-01', dateExpiration: '', categorie: 'Diplôme', fournisseur: 'AncienneEcole' },
    { fileId: fAddr, nom: '2026-07-01_Facture.pdf', domaine: '03 · Logement & véhicule', chemin: '03 · Logement & véhicule/123 rue Exemple', dateDoc: '2026-07-01', dateExpiration: '', categorie: 'Facture', fournisseur: '123 rue Exemple' },
    { fileId: fMarc, nom: '2026-07-01_Identite.pdf', domaine: '01 · Identité', chemin: '01 · Identité', dateDoc: '2026-07-01', dateExpiration: '', categorie: 'Identité', fournisseur: c.CONFIG.PARCOURS.titulaire.prenom + ' ' + c.CONFIG.PARCOURS.titulaire.nom },
  ];
  const liens = [
    [new Date(), 'thr-h1', 'm1', 'facturation@hydro-exemple.test', '02 · Finances', '02 · Finances/Hydro-Exemple', fHydro, 'f.pdf'],
    [new Date(), 'thr-a1', 'm2', 'fictif.webmail@gmail.com', 'Anna', 'Anna/Clinique Exemple', fAnna, 'r.pdf'],
  ];
  const entites = [
    ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut'],
    ['Hydro-Exemple', '02 · Finances', 'Énergie', 'Fournisseur', 'validée'],
  ];
  const orgs = plain(c.extraireOrganismesActifs18MoisPure_(docs, liens, entites, ref));
  assert.deepStrictEqual(orgs.map((o) => o.nom), ['Hydro-Exemple', 'IRCC', 'Clinique Exemple']);
  assert.deepStrictEqual(orgs[0].domainesMail, ['hydro-exemple.test']);
  assert.deepStrictEqual(orgs[2].domainesMail, [], 'webmail jamais exposé');
  assert.ok(!JSON.stringify(orgs).includes('@'), 'aucune adresse courriel exposée');

  // Bornage <= 500 car. avec 20 organismes longs
  const vingtOrgs = Array.from({ length: 20 }, (_, i) => ({ k: 'org' + i, n: 'Organisme Tres Long Numero ' + i, ok: 0, nb: 2 }));
  const j20 = c.serialiserPackAction_({ cle: 'chg|18m', orgs: vingtOrgs });
  assert.ok(j20.length <= 500 && JSON.parse(j20).orgs.length > 0);

  // Sync + coche manuelle préservée
  env.sheets.Index.push(
    ['drive|' + fHydro, new Date('2026-10-01'), '2026-10-01_Facture_Hydro-Exemple Inc..pdf', '02 · Finances', '02 · Finances/Hydro-Exemple', 'classé', '', '', fHydro],
    ['drive|' + fImmi, new Date('2026-09-15'), '2026-09-15_Lettre_IRCC.pdf', '04 · Immigration', '04 · Immigration/IRCC', 'manuel', '', '', fImmi]
  );
  assert.strictEqual(c.detecterChangementVieCopilote_(env.sheets.Index.slice(1), () => false, 5), 1);
  const rowChg = env.sheets.Copilote.find((r) => r[3] === 'changement-vie');
  assert.ok(rowChg);
  const rCoche = plain(c.executerChecklistCopilote_({ checklistId: rowChg[0], item: 'IRCC', coche: true }));
  assert.strictEqual(rCoche.ok, true);
  assert.strictEqual(rCoche.statut, 'actif');
  // Re-détection préserve la confirmation IRCC
  assert.strictEqual(c.detecterChangementVieCopilote_(env.sheets.Index.slice(1), () => false, 5), 0);
  const rowChg2 = env.sheets.Copilote.find((r) => r[3] === 'changement-vie');
  assert.strictEqual(JSON.parse(rowChg2[7]).orgs.find((o) => o.n === 'IRCC').ok, 1);
  assert.strictEqual(c.executerChecklistCopilote_({ checklistId: rowChg[0], item: 'Hydro-Exemple', coche: true }).statut, 'terminé');
  assert.strictEqual(c.executerChecklistCopilote_({ checklistId: rowChg[0], item: 'Inexistant', coche: true }).ok, false);
});

test('Plan « Changement de vie » (#14) : >= 15 organismes avec collisions 14+ car., cohérence titre/ActionJson, persistance terminé, catégories & fin de mois', () => {
  const env = makeSheetEnv();
  const c = load(['Config.gs', 'Journal.gs', 'Entites.gs', 'VeilleDrive.gs', 'Copilote.gs', 'PacksChecklists.gs']);
  c.feuille_ = env.feuille_;
  c.CONFIG.CATEGORIES['02 · Finances'] = { 'Reçus & factures': 'FICTIF_CAT_RECUS' };

  // Cas fin de mois 2026-08-31 -> seuil 2025-02-28 (pas 2025-03-03) et exclusion CONFIG.CATEGORIES
  const docsFinMois = [
    { fileId: ID44('FM1'), nom: '2025-02-28_Facture_OrgFinMois.pdf', domaine: '02 · Finances', chemin: '02 · Finances/OrgFinMois', dateDoc: '2025-02-28', dateExpiration: '', categorie: 'Facture', fournisseur: 'OrgFinMois' },
    { fileId: ID44('FM2'), nom: '2026-08-01_Facture.pdf', domaine: '02 · Finances', chemin: '02 · Finances/Reçus & factures', dateDoc: '2026-08-01', dateExpiration: '', categorie: 'Facture', fournisseur: '' },
  ];
  const resFinMois = plain(c.extraireOrganismesActifs18MoisPure_(docsFinMois, [], [], new Date('2026-08-31T12:00:00Z')));
  assert.deepStrictEqual(resFinMois.map((o) => o.nom), ['OrgFinMois']);

  // >= 15 organismes dont 2 partageant > 14 car. de préfixe
  const noms = [
    'Assurance Habitation Alpha',
    'Assurance Habitation Beta',
    ...Array.from({ length: 14 }, (_, i) => 'Organisme Actif Long ' + String(i + 1).padStart(2, '0')),
  ];
  const auj = new Date().toISOString().slice(0, 10);
  const idx = noms.map((nom, i) => {
    const fid = ID44('O' + String(i).padStart(2, '0'));
    return ['drive|' + fid, new Date(), auj + '_Facture_' + nom + '.pdf', '02 · Finances', '02 · Finances/' + nom, 'classé', '', '', fid];
  });
  assert.strictEqual(c.detecterChangementVieCopilote_(idx, () => false, 5), 1);
  const row = env.sheets.Copilote.find((r) => r[3] === 'changement-vie');
  const parsed = JSON.parse(row[7]);
  assert.ok(row[7].length <= 500 && parsed.orgs.length > 0 && parsed.orgs.length < noms.length);
  assert.strictEqual(new Set(parsed.orgs.map((o) => o.k)).size, parsed.orgs.length, 'toutes les clés k sont uniques');
  assert.strictEqual(row[6], 'Plan Changement de vie (0/' + parsed.orgs.length + ')', 'titre cohérent avec ActionJson tronqué');

  // Cocher tous les organismes conservés -> terminé, et re-scan garde terminé + clés distinctes
  parsed.orgs.forEach((o, idxO) => {
    const rep = plain(c.executerChecklistCopilote_({ checklistId: row[0], item: o.k, coche: true }));
    assert.strictEqual(rep.ok, true);
    assert.strictEqual(rep.statut, idxO === parsed.orgs.length - 1 ? 'terminé' : 'actif');
  });
  assert.strictEqual(c.detecterChangementVieCopilote_(idx, () => false, 5), 0);
  assert.strictEqual(row[8], 'terminé', 'statut terminé préservé au re-scan');
  assert.strictEqual(row[6], 'Plan Changement de vie (' + parsed.orgs.length + '/' + parsed.orgs.length + ')');
});

test('Packs 1-clic (#15) : raccourcis seuls (incl. 04 et Anna en lecture seule), idempotence, repli URL et exclusions', () => {
  const fImmi = ID44('P_IMMI'), fAnna = ID44('P_ANNA'), fTech = ID44('P_TECH'), fTrash = ID44('P_TRAS');
  const folders = {
    FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [], folders: ['FICTIF_MARC'] },
    FICTIF_MARC: { id: 'FICTIF_MARC', name: 'Marc', parents: ['FICTIF_ROOT'], folders: ['FICTIF_DOSSIERS_A_TRIER', 'FICTIF_D04', 'FICTIF_TECH'] },
    FICTIF_DOSSIERS_A_TRIER: { id: 'FICTIF_DOSSIERS_A_TRIER', name: '00 · À trier', parents: ['FICTIF_MARC'], folders: [] },
    FICTIF_D04: { id: 'FICTIF_D04', name: '04 · Immigration', parents: ['FICTIF_MARC'], folders: [] },
    FICTIF_ANNA: { id: 'FICTIF_ANNA', name: 'Anna', parents: ['FICTIF_ROOT'], folders: [] },
    FICTIF_TECH: { id: 'FICTIF_TECH', name: '_Technique', parents: ['FICTIF_MARC'], folders: [] },
  };
  const files = {
    [fImmi]: { id: fImmi, name: '2026-05-01_Permis_IRCC.pdf', parents: ['FICTIF_D04'], trashed: false },
    [fAnna]: { id: fAnna, name: '2026-06-01_Passeport_Anna.pdf', parents: ['FICTIF_ANNA'], trashed: false },
    [fTech]: { id: fTech, name: 'config.json', parents: ['FICTIF_TECH'], trashed: false },
    [fTrash]: { id: fTrash, name: '2026-01-01_Passeport_Vieux.pdf', parents: ['FICTIF_D04'], trashed: true },
  };
  const envSheet = makeSheetEnv({
    Index: [
      ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId'],
      ['drive|' + fImmi, new Date('2026-05-01'), '2026-05-01_Permis_IRCC.pdf', '04 · Immigration', '04 · Immigration', 'manuel', '', '', fImmi],
      ['drive|' + fAnna, new Date('2026-06-01'), '2026-06-01_Passeport_Anna.pdf', 'Anna', 'Anna', 'manuel', '', '', fAnna],
    ],
  });
  const drv = makeDrivePacksEnv(files, folders);
  const c = load(['Config.gs', 'Journal.gs', 'DriveRest.gs', 'Router.gs', 'Copilote.gs', 'PacksChecklists.gs'], drv.overrides);
  c.feuille_ = envSheet.feuille_;
  c.journalInfo_ = (s, m) => envSheet.sheets.Journal.push([new Date(), 'INFO', s, m]);
  c.journalErreur_ = (s, m) => envSheet.sheets.Journal.push([new Date(), 'ERREUR', s, m]);

  // Mode auto 'immigration' : sélectionne 04 + Anna en lecture seule, 0 moveTo/setName, repli URL
  const r1 = plain(c.creerPackCopilote_({ pack: 'immigration' }));
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.nbRaccourcis, 2);
  assert.strictEqual(r1.dossierUrl, 'https://drive.google.com/drive/folders/' + encodeURIComponent(r1.dossierId));
  assert.strictEqual(drv.moves.length, 0);
  assert.strictEqual(drv.renames.length, 0);
  assert.strictEqual(drv.shortcuts.length, 2);
  assert.strictEqual(folders['FICTIF_MARC'].folders.some((id) => folders[id].name === '00 · Packs'), true);

  // Idempotence au 2e appel : aucun nouveau POST raccourci
  const r2 = plain(c.creerPackCopilote_({ pack: 'immigration' }));
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.nbRaccourcis, 2);
  assert.strictEqual(drv.shortcuts.length, 2);

  // Mode fileIds explicites : rejette _Technique et corbeille, garde fImmi
  const r3 = plain(c.creerPackCopilote_({ pack: 'custom', fileIds: [fTech, fTrash, fImmi], titre: 'Dossier IRCC' }));
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(r3.nbRaccourcis, 1);

  // Aucun fichier éligible -> ok:false
  assert.strictEqual(c.creerPackCopilote_({ pack: 'custom', fileIds: [fTech, fTrash] }).ok, false);

  // Mode pack libre par mot-clé ('clinique' / 'passeport') et dossier avec getUrl natif
  const rLibre = plain(c.creerPackCopilote_({ pack: 'passeport' }));
  assert.strictEqual(rLibre.ok, true);
  assert.strictEqual(rLibre.nbRaccourcis, 1);

  // Résilience erreur réseau UrlFetchApp -> ok:false, nbRaccourcis:0, journalise et ne plante pas
  drv.setThrowRest(true);
  const rErr = plain(c.creerPackCopilote_({ pack: 'custom', fileIds: [fImmi], titre: 'Test Reseau' }));
  assert.strictEqual(rErr.ok, false);
  assert.strictEqual(rErr.nbRaccourcis, 0);
  assert.strictEqual(rErr.erreur, 'création des raccourcis impossible');
  assert.ok(envSheet.sheets.Journal.some((row) => row[1] === 'ERREUR' && row[2] === 'Packs'));
});

test('Packs 1-clic (#15) + WebApp doPost : HTTP 500 sur tous les raccourcis rend ok:false et non mémorisé au rejeu requestId', () => {
  const fImmi = ID44('W_IMMI');
  const folders = {
    FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'Mon Drive', parents: [], folders: ['FICTIF_MARC'] },
    FICTIF_MARC: { id: 'FICTIF_MARC', name: 'Marc', parents: ['FICTIF_ROOT'], folders: ['FICTIF_DOSSIERS_A_TRIER', 'FICTIF_D04'] },
    FICTIF_DOSSIERS_A_TRIER: { id: 'FICTIF_DOSSIERS_A_TRIER', name: '00 · À trier', parents: ['FICTIF_MARC'], folders: [] },
    FICTIF_D04: { id: 'FICTIF_D04', name: '04 · Immigration', parents: ['FICTIF_MARC'], folders: [] },
  };
  const files = { [fImmi]: { id: fImmi, name: '2026-05-01_Permis_IRCC.pdf', parents: ['FICTIF_D04'], trashed: false } };
  const drv = makeDrivePacksEnv(files, folders);
  const cache = {};
  let postCalls = 0;
  drv.overrides.UrlFetchApp = {
    fetch: (_url, opts) => {
      const m = (opts && opts.method ? String(opts.method) : 'get').toLowerCase();
      if (m === 'post') {
        postCalls++;
        return { getResponseCode: () => 500, getContentText: () => 'err' };
      }
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ files: [] }) };
    },
  };
  drv.overrides.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k === 'DriveAI_WEBAPP_SECRET' ? 'SECRET' : (drv.props.has(k) ? drv.props.get(k) : null)),
      setProperty: (k, v) => { drv.props.set(k, String(v)); },
    }),
  };
  drv.overrides.CacheService = { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) };
  drv.overrides.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  drv.overrides.ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };

  const c = load(['Config.gs', 'Journal.gs', 'DriveRest.gs', 'Router.gs', 'Copilote.gs', 'PacksChecklists.gs', 'WebApp.gs'], drv.overrides);
  c.journalErreur_ = () => {};
  c.poserOperationCourante_ = () => {};

  const req = {
    parameter: { action: 'copilote-pack', secret: 'SECRET' },
    postData: { contents: JSON.stringify({ pack: 'custom', fileIds: [fImmi], titre: 'Test500', requestId: 'reqPack500_01' }) },
  };
  const r1 = JSON.parse(c.doPost(req));
  const r2 = JSON.parse(c.doPost(req));
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.nbRaccourcis, 0);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.memo, undefined, 'échec 500 jamais mémorisé au rejeu');
  assert.strictEqual(Object.keys(cache).length, 0);
  assert.ok(postCalls >= 2, 'rejeu a bien ré-essayé');
});
