'use strict';
/**
 * Tests Lot 3A (#9, #10) : Signaux.gs, extraction 4 champs, rattrapage borné (15/j, frein strict 25 $),
 * radar d'expirations Google Agenda J-90/J-30 et détecteur gratuit de pièces manquantes.
 * Données 100 % fictives uniquement (`FICTIF_*`, `@exemple.test`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

const plain = (x) => JSON.parse(JSON.stringify(x));

function makeSheets(initial) {
  const sheets = Object.assign({
    Signaux: [['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation']],
    Copilote: [['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations']],
    Index: [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire']],
    Actions: [['Id', 'Horodatage', 'Type', 'Cible', 'Avant', 'Après', 'Statut', 'Détail']],
    Journal: [['Horodatage', 'Niveau', 'Source', 'Message']],
    Corrections: [['Date', 'Domaine', 'Type', 'Émetteur']],
  }, initial || {});
  const feuille_ = (nom) => {
    const rows = sheets[nom] || (sheets[nom] = [['Clé']]);
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] ? rows[0].length : 1),
      appendRow: (r) => { rows.push(r.slice()); },
      getRange: (r, c, nr, nc) => ({
        getValue: () => (rows[r - 1] ? rows[r - 1][c - 1] : ''),
        setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; },
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
  return { sheets, feuille_ };
}

function ctxSignaux(opts) {
  opts = opts || {};
  const sh = makeSheets(opts.sheets);
  const props = Object.assign({}, opts.props || {});
  const events = [];
  const mutations = [];
  const files = Object.assign({}, opts.files || {});
  const indexMem = {};
  sh.sheets.Index.slice(1).forEach((r) => { if (r[0]) indexMem[String(r[0])] = true; });

  const c = load(['Config.gs', 'Cout.gs', 'Prefiltre.gs', 'Entites.gs', 'Reset.gs', 'Missions.gs', 'Actions.gs', 'Journal.gs', 'Llm.gs', 'Agenda.gs', 'Copilote.gs', 'Signaux.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    DriveApp: {
      getFileById: (id) => {
        const f = files[id];
        if (!f) throw new Error('Introuvable ' + id);
        return {
          getId: () => id,
          getName: () => f.name || id,
          isTrashed: () => !!f.trashed,
          getSize: () => (typeof f.size === 'number' ? f.size : 1024),
          getMimeType: () => f.mimeType || 'text/plain',
          getBlob: () => ({
            getName: () => f.name || id,
            getContentType: () => f.mimeType || 'text/plain',
            getDataAsString: () => f.texte || '',
          }),
          moveTo: () => { mutations.push('moveTo:' + id); },
          setName: () => { mutations.push('setName:' + id); },
          setTrashed: () => { mutations.push('setTrashed:' + id); },
        };
      },
    },
    CalendarApp: {
      getDefaultCalendar: () => ({
        createAllDayEvent: (titre, date, o) => {
          events.push({ titre, date, description: o && o.description });
          return { getId: () => 'evt-' + events.length };
        },
      }),
    },
    Utilities: {
      newBlob: (s) => ({ getBytes: () => Buffer.from(String(s || '')), getDataAsString: () => String(s || '') }),
      formatDate: (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '/'),
      sleep: () => {},
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    ScriptApp: { getOAuthToken: () => 'JETON_FICTIF' },
  });
  c.feuille_ = sh.feuille_;
  c.journalInfo_ = (s, m) => sh.sheets.Journal.push([new Date(), 'INFO', s, m]);
  c.journalErreur_ = (s, m) => sh.sheets.Journal.push([new Date(), 'ERREUR', s, m]);
  c.indexContient_ = (k) => !!indexMem[k];
  c.indexAjouter_ = (k, r) => {
    indexMem[k] = true;
    sh.sheets.Index.push([k, new Date(), r.nom || '', r.domaine || '', r.chemin || '', r.statut || '', '', '', r.fileId || '', '', '']);
  };
  return { c, sh, props, events, mutations, files };
}

test('calculerFinGarantie_ et construireSignalDepuisClassif_ : normalisation pure, garantie bissextile et zéro texte brut', () => {
  const { c } = ctxSignaux();
  assert.strictEqual(c.calculerFinGarantie_('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(c.calculerFinGarantie_('2024-01-31', 1), '2024-02-29');
  assert.strictEqual(c.calculerFinGarantie_('2026-02-30', 12), '');
  assert.strictEqual(c.calculerFinGarantie_('2026-01-15', 0), '');

  const sig = plain(c.construireSignalDepuisClassif_(
    { fileId: 'FICTIF_SIG_01', nom: '2026-03-10_Facture_NordTech.pdf', extrait: 'CORPS CONFIDENTIEL INTERDIT' },
    {
      domaine: '02 · Finances',
      type_doc: 'Facture',
      fournisseur: '  NordTech Inc.  ',
      date_expiration: '2027-03-10',
      montant: '149,95',
      devise: 'cad',
      garantie_mois: 24,
      statut_reclamation: 'a-reclamer',
    },
    { fileId: 'FICTIF_SIG_01', domaine: '02 · Finances', chemin: '02 · Finances/Reçus & factures', nom: '2026-03-10_Facture_NordTech.pdf' }
  ));
  assert.deepStrictEqual(sig, {
    fileId: 'FICTIF_SIG_01',
    categorie: 'Facture',
    fournisseur: 'NordTech Inc.',
    domaine: '02 · Finances',
    chemin: '02 · Finances/Reçus & factures',
    dateDoc: '2026-03-10',
    dateExpiration: '2027-03-10',
    montant: 149.95,
    devise: 'CAD',
    finGarantie: '2028-03-10',
    delaiRetour: '',
    statutReclamation: 'a-reclamer',
  });
  assert.ok(!JSON.stringify(sig).includes('CORPS CONFIDENTIEL INTERDIT'));
});

test('enregistrerSignal_ (upsert par FileId) et enregistrerSignalDepuisPipeline_ (filtre non pertinent)', () => {
  const { c, sh } = ctxSignaux();
  assert.strictEqual(c.enregistrerSignalDepuisPipeline_(
    { fileId: 'FICTIF_TECH_1', nom: 'hash.bin' },
    { domaine: '_Technique', type_doc: 'Document' },
    { fileId: 'FICTIF_TECH_1', domaine: '_Technique', chemin: '_Technique', nom: 'hash.bin' }
  ), false, 'un fichier technique sans signal utile ne pollue pas Signaux');

  assert.strictEqual(c.enregistrerSignalDepuisPipeline_(
    { fileId: 'FICTIF_DOC_1', nom: '2026-05-01_Assurance_Protect.pdf' },
    { domaine: '03 · Logement & véhicule', type_doc: 'Police habitation', fournisseur: 'Protect', date_expiration: '2027-05-01', montant: 600 },
    { fileId: 'FICTIF_DOC_1', domaine: '03 · Logement & véhicule', chemin: '03 · Logement & véhicule/Logement', nom: '2026-05-01_Assurance_Protect.pdf' }
  ), true);
  assert.strictEqual(sh.sheets.Signaux.length, 2);

  // Upsert du même FileId : met à jour la ligne existante au lieu de dupliquer
  c.enregistrerSignal_({ fileId: 'FICTIF_DOC_1', categorie: 'Police habitation', fournisseur: 'Protect', domaine: '03 · Logement & véhicule', chemin: '03 · Logement & véhicule/Logement', dateDoc: '2026-05-01', dateExpiration: '2027-06-01', montant: 620, devise: 'CAD' });
  assert.strictEqual(sh.sheets.Signaux.length, 2);
  assert.strictEqual(c.lireSignaux_()[0].dateExpiration, '2027-06-01');
  assert.strictEqual(c.lireSignaux_()[0].montant, 620);
});

test('budgetSignauxDepasse_ : frein strict 25 $/mois fail-closed et compteur DriveAI_SIGNAUX_JOUR (15/j)', () => {
  const { c, props } = ctxSignaux();
  c.syntheseCoutMois_ = () => ({ appels: 10, dollars: 24.5 });
  assert.strictEqual(c.budgetSignauxDepasse_(0.1), false);
  assert.strictEqual(c.budgetSignauxDepasse_(0.5), true, 'coupé exactement à 25,00 $');
  c.syntheseCoutMois_ = () => { throw new Error('Properties HS'); };
  assert.strictEqual(c.budgetSignauxDepasse_(0), true, 'fail-closed si coûts illisibles');

  const propMock = { getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } };
  assert.strictEqual(c.lireCompteurSignauxJour_(propMock, '2026/11/24'), 0);
  assert.strictEqual(c.incrementerCompteurSignauxJour_(propMock, '2026/11/24', 3), 3);
  assert.strictEqual(props.DriveAI_SIGNAUX_JOUR, '2026/11/24|3');
  assert.strictEqual(c.lireCompteurSignauxJour_(propMock, '2026/11/25'), 0, 'rollover automatique à minuit');
});

test('rattraperSignauxCopilote_ : plafond 15/j + 3/run, frein 25 $, 04/Anna lecture seule et ligne neutre aucun', () => {
  const indexRows = [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId']];
  const files = {};
  for (let i = 1; i <= 5; i++) {
    const fid = 'FICTIF_SIGN_RAT_000' + i;
    const dom = i === 5 ? '04 · Immigration' : (i === 4 ? 'Anna' : '02 · Finances');
    const chem = dom + '/Dossier';
    indexRows.push(['drive|' + fid, new Date(), '2026-06-0' + i + '_Doc.pdf', dom, chem, 'classé', '', '', fid]);
    files[fid] = { name: '2026-06-0' + i + '_Doc.pdf', mimeType: 'text/plain', texte: 'Document test ' + i };
  }
  indexRows.push(['drive|FICTIF_TECH_SKIP_001', new Date(), 'dump.json', '_Technique', '_Technique', 'classé', '', '', 'FICTIF_TECH_SKIP_001']);
  files.FICTIF_TECH_SKIP_001 = { name: 'dump.json', mimeType: 'text/plain', texte: '{}' };

  const { c, sh, props, mutations } = ctxSignaux({ sheets: { Index: indexRows }, files });
  const auj = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  c.syntheseCoutMois_ = () => ({ appels: 1, dollars: 1.0 });
  let llmAppels = 0;
  c.extraireSignalLlm_ = (meta) => {
    llmAppels++;
    if (meta.nomFichier.indexOf('06-05') !== -1) return { categorie: 'Permis', date_expiration: '2027-02-15' };
    return {}; // aucun signal détecté → ligne neutre 'aucun'
  };

  // Run 1 : traite 3 docs max (dont 04 · Immigration et Anna en lecture seule)
  const n1 = c.rattraperSignauxCopilote_(sh.sheets.Index.slice(1), () => false);
  assert.strictEqual(n1, 3);
  assert.strictEqual(llmAppels, 3);
  assert.strictEqual(props.DriveAI_SIGNAUX_JOUR, auj + '|3');
  assert.strictEqual(mutations.length, 0, 'zéro mutation Drive sur 04 · Immigration et Anna');
  assert.strictEqual(sh.sheets.Corrections.length, 1, 'zéro écriture dans Corrections');

  const sigs = c.lireSignaux_();
  assert.ok(sigs.some((s) => s.fileId === 'FICTIF_SIGN_RAT_0005' && s.dateExpiration === '2027-02-15'));
  assert.ok(sigs.some((s) => s.fileId === 'FICTIF_SIGN_RAT_0004' && s.categorie === 'aucun'), 'ligne neutre enregistrée pour éviter la boucle');

  // Run 2 : les 3 déjà présents sont ignorés, seuls les 2 restants sont rattrapés (jamais FICTIF_TECH_SKIP_001)
  const n2 = c.rattraperSignauxCopilote_(sh.sheets.Index.slice(1), () => false);
  assert.strictEqual(n2, 2);
  assert.strictEqual(props.DriveAI_SIGNAUX_JOUR, auj + '|5');

  // Plafond quotidien 15 atteint → 0 appel LLM
  props.DriveAI_SIGNAUX_JOUR = auj + '|15';
  sh.sheets.Index.push(['drive|FICTIF_SIGN_RAT_0016', new Date(), '2026-06-16_Doc.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', 'FICTIF_SIGN_RAT_0016']);
  files.FICTIF_SIGN_RAT_0016 = { name: '2026-06-16_Doc.pdf', mimeType: 'text/plain', texte: 'Doc 16' };
  assert.strictEqual(c.rattraperSignauxCopilote_(sh.sheets.Index.slice(1), () => false), 0);

  // Frein strict 25 $/mois → 0 appel LLM
  props.DriveAI_SIGNAUX_JOUR = auj + '|0';
  c.syntheseCoutMois_ = () => ({ appels: 50, dollars: 25.0 });
  assert.strictEqual(c.rattraperSignauxCopilote_(sh.sheets.Index.slice(1), () => false), 0);
});

test('Radar d expirations (#9) : Agenda J-90/J-30 idempotent, lien Drive, titre neutre 04/Anna et cartes Copilote', () => {
  const maint = new Date();
  const dans20j = new Date(maint.getTime() + 20 * 86400000).toISOString().slice(0, 10);
  const dans60j = new Date(maint.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  const dans120j = new Date(maint.getTime() + 120 * 86400000).toISOString().slice(0, 10);

  const { c, sh, events } = ctxSignaux({
    sheets: {
      Signaux: [
        ['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation'],
        ['FICTIF_IMMI_EXP', 'Permis de travail', 'IRCC', '04 · Immigration', '04 · Immigration/Permis', '2025-12-01', dans20j, '', '', '', '', ''],
        ['FICTIF_AUTO_EXP', 'Assurance auto', 'AssureurPlus', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule', '2026-01-01', dans60j, 900, 'CAD', '', '', ''],
        ['FICTIF_LOIN_EXP', 'Passeport', 'Gouv', '01 · Administratif & identité', '01 · Administratif & identité', '2025-01-01', dans120j, '', '', '', '', ''],
      ],
    },
  });
  c.reinitialiserAgendaRun_();
  const nb = c.detecterExpirationsCopilote_(() => false, 10);
  assert.strictEqual(nb, 2, 'dans120j hors horizon 90 j');
  assert.strictEqual(events.length, 3, 'J-90 + J-30 pour dans20j, J-90 seul pour dans60j');
  const evImmi = events.find((e) => e.description.includes('FICTIF_IMMI_EXP'));
  assert.ok(evImmi && evImmi.titre.startsWith('DriveAI · Échéance document à vérifier'));
  assert.ok(!evImmi.titre.includes('IRCC') && !evImmi.titre.includes('Permis'), 'zéro détail sensible dans le titre Agenda en zone protégée');
  assert.strictEqual(evImmi.description, 'Lien Drive : https://drive.google.com/file/d/FICTIF_IMMI_EXP/view');

  // 2e passage : idempotent (0 nouvel événement Agenda, 0 nouvelle carte Copilote)
  c.reinitialiserAgendaRun_();
  assert.strictEqual(c.detecterExpirationsCopilote_(() => false, 10), 0);
  assert.strictEqual(events.length, 3);
  const cartesExp = sh.sheets.Copilote.slice(1).filter((r) => r[3] === 'expiration');
  assert.strictEqual(cartesExp.length, 2);
  assert.strictEqual(c.executerDecisionCopilote_({ id: cartesExp[0][0], decision: 'passer-auto' }).ok, false);
});

test('Détecteur gratuit de pièces manquantes (#10) : 0 $ LLM, impôts, paies via moisManquantsPaies_, relevés > 40 j et dédup Copilote', () => {
  const { c, sh } = ctxSignaux();
  const dateRef = new Date('2026-11-24T12:00:00Z');
  // 1. Aucun historique fiscal → zéro faux positif
  assert.deepStrictEqual(plain(c.detecterPiecesManquantesPure_([], [], dateRef, 40)), []);

  // 2. Historique fiscal 2024 (T4 + RL-1 + RL-31 + Avis), T4 2025 présent mais RL-1 2025 manquant ;
  //    Paies Alphatek 2026-07 et 2026-09 (2026-08 manquant) ;
  //    Relevés Bellerives 2026-08 et 2026-09 (le 2026-09-30 date de 55 j > 40 j) ;
  //    Relevés NordBanque 2026-09 et 2026-10 (2026-10-31 date de 24 j <= 40 j → ok).
  const index = [
    ['drive|FICTIF_PM_FISC_00001', new Date(), '2024_T4_Alphatek.pdf', '02 · Finances', '02 · Finances/Impôts', 'classé', '', '', 'FICTIF_PM_FISC_00001'],
    ['drive|FICTIF_PM_FISC_00002', new Date(), '2024_RL-1_Alphatek.pdf', '02 · Finances', '02 · Finances/Impôts', 'classé', '', '', 'FICTIF_PM_FISC_00002'],
    ['drive|FICTIF_PM_FISC_00003', new Date(), '2025_T4_Alphatek.pdf', '02 · Finances', '02 · Finances/Impôts', 'classé', '', '', 'FICTIF_PM_FISC_00003'],
    ['drive|FICTIF_PM_PAIE_00001', new Date(), '2026-07-15_Bulletin de paie_Alphatek.pdf', '02 · Finances', '02 · Finances/Paie', 'classé', '', '', 'FICTIF_PM_PAIE_00001'],
    ['drive|FICTIF_PM_PAIE_00002', new Date(), '2026-09-15_Bulletin de paie_Alphatek.pdf', '02 · Finances', '02 · Finances/Paie', 'classé', '', '', 'FICTIF_PM_PAIE_00002'],
    ['drive|FICTIF_PM_REL_000001', new Date(), '2026-08_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_PM_REL_000001'],
    ['drive|FICTIF_PM_REL_000002', new Date(), '2026-09_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_PM_REL_000002'],
    ['drive|FICTIF_PM_REL_000003', new Date(), '2026-09_Relevé_NordBanque.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_PM_REL_000003'],
    ['drive|FICTIF_PM_REL_000004', new Date(), '2026-10_Relevé_NordBanque.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_PM_REL_000004'],
  ];
  const manquants = plain(c.detecterPiecesManquantesPure_(index, [], dateRef, 40));
  assert.deepStrictEqual(manquants.map((x) => x.cle), ['impots-2025-rl1', 'paies-alphatek-2026-08', 'releve-bellerives']);

  // Copilote : création, déduplication au 2e passage et respect de 'ignoré'
  sh.sheets.Index.push(...index);
  const c1 = c.detecterPiecesManquantesCopilote_(index, () => false, 10);
  assert.ok(c1 >= 2);
  assert.strictEqual(c.detecterPiecesManquantesCopilote_(index, () => false, 10), 0, 'cartes piece-manquante dédupliquées via a.cle');
  const cartePm = sh.sheets.Copilote.slice(1).find((r) => r[3] === 'piece-manquante');
  assert.strictEqual(c.executerDecisionCopilote_({ id: cartePm[0], decision: 'passer-auto' }).ok, false);
  assert.strictEqual(c.executerDecisionCopilote_({ id: cartePm[0], decision: 'ignorer' }).statut, 'ignoré');
  assert.strictEqual(c.detecterPiecesManquantesCopilote_(index, () => false, 10), 0);
});

test('Non-régression Lot 3A : booléen garantie, JSON coût corrompu fail-closed, boucle null, doublon Index, taille OCR, paie & relevé invalide', () => {
  // 1. Booléen rejeté dans calculerFinGarantie_
  const { c: c0 } = ctxSignaux();
  assert.strictEqual(c0.calculerFinGarantie_('2026-01-15', true), '');
  assert.strictEqual(c0.calculerFinGarantie_('2026-01-15', false), '');

  // 2. JSON DriveAI_COUT_AAAA-MM corrompu → fail-closed (true), ainsi que LLM_BUDGET_CIBLE = 0
  const { c: cBudget, props: propsB } = ctxSignaux();
  const cleCout = cBudget.cleCoutMois_();
  propsB[cleCout] = '{JSON_CORROMPU!!!';
  assert.strictEqual(cBudget.budgetSignauxDepasse_(0), true, 'JSON coût corrompu doit bloquer en fail-closed');
  propsB[cleCout] = 'null';
  assert.strictEqual(cBudget.budgetSignauxDepasse_(0), true, 'JSON null doit bloquer en fail-closed');
  delete propsB[cleCout];
  const cibleOrig = cBudget.CONFIG.LLM_BUDGET_CIBLE;
  try {
    cBudget.CONFIG.LLM_BUDGET_CIBLE = 0;
    assert.strictEqual(cBudget.budgetSignauxDepasse_(0), true, 'budget cible 0 $ coupe dès 0 $');
  } finally {
    cBudget.CONFIG.LLM_BUDGET_CIBLE = cibleOrig;
  }

  // 3. Rattrapage : réponse 'null' → 'aucun' sans boucle, doublon récent bloque ancienne ligne classée, fichier > OCR_TAILLE_MAX ignoré
  const fidNull = 'FICTIF_RAT_NULL_0001';
  const fidDoub = 'FICTIF_RAT_DOUB_0001';
  const fidGros = 'FICTIF_RAT_GROS_0001';
  const { c: cRat, props: propsR } = ctxSignaux({
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId'],
        ['drive|' + fidDoub, new Date(), '2026-05-01_Doc.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fidDoub],
        ['drive|' + fidDoub, new Date(), '2026-05-01_Doc.pdf', '02 · Finances', '02 · Finances', 'doublon', '', '', fidDoub],
        ['drive|' + fidGros, new Date(), '2026-05-02_Archive.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fidGros],
        ['drive|' + fidNull, new Date(), '2026-05-03_Note.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fidNull],
      ],
    },
    files: {
      [fidDoub]: { name: '2026-05-01_Doc.pdf', mimeType: 'text/plain', texte: 'Doublon' },
      [fidGros]: { name: '2026-05-02_Archive.pdf', mimeType: 'text/plain', texte: 'Gros', size: 25 * 1024 * 1024 },
      [fidNull]: { name: '2026-05-03_Note.pdf', mimeType: 'text/plain', texte: 'Note sans signal' },
    },
  });
  cRat.syntheseCoutMois_ = () => ({ appels: 1, dollars: 1.0 });
  const appeles = [];
  cRat.appelAnthropicTexte_ = (m, sys, contenu) => { appeles.push(contenu); return 'null'; };
  const auj = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  assert.strictEqual(cRat.rattraperSignauxCopilote_(cRat.feuille_('Index').getRange(2, 1, 4, 9).getValues(), () => false), 1);
  assert.strictEqual(appeles.length, 1, 'seul fidNull appelle le LLM (fidDoub et fidGros exclus)');
  assert.ok(appeles[0].includes('2026-05-03_Note.pdf'));
  assert.strictEqual(propsR.DriveAI_SIGNAUX_JOUR, auj + '|1');
  const sigsRat = cRat.lireSignaux_();
  assert.ok(sigsRat.some((s) => s.fileId === fidNull && s.categorie === 'aucun'));
  assert.ok(sigsRat.some((s) => s.fileId === fidGros && s.categorie === 'aucun'));
  assert.strictEqual(cRat.rattraperSignauxCopilote_(cRat.feuille_('Index').getRange(2, 1, 4, 9).getValues(), () => false), 0, 'aucune boucle au 2e run');
  assert.strictEqual(appeles.length, 1);

  // 4. Attestation de salaire ne crée pas de faux positif paie ; date relevé invalide / mois 13 ne masque pas un retard
  const idxPieces = [
    ['drive|FICTIF_ATT_SAL_00001', new Date(), '2026-07-15_Attestation de salaire_Alphatek.pdf', '05 · Carrière', '05 · Carrière', 'classé', '', '', 'FICTIF_ATT_SAL_00001'],
    ['drive|FICTIF_BUL_PAI_00001', new Date(), '2026-09-15_Bulletin de paie_Alphatek.pdf', '02 · Finances', '02 · Finances/Paie', 'classé', '', '', 'FICTIF_BUL_PAI_00001'],
    ['drive|FICTIF_REL_OK_000001', new Date(), '2025-11_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_REL_OK_000001'],
    ['drive|FICTIF_REL_OK_000002', new Date(), '2025-12_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_REL_OK_000002'],
    ['drive|FICTIF_REL_INV_00001', new Date(), '2026-02-30_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_REL_INV_00001'],
    ['drive|FICTIF_REL_M13_00001', new Date(), '2025-13_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Banque', 'classé', '', '', 'FICTIF_REL_M13_00001'],
  ];
  const pmFev = plain(c0.detecterPiecesManquantesPure_(idxPieces, [], new Date('2026-02-15T12:00:00Z'), 40));
  assert.deepStrictEqual(pmFev.map((x) => x.cle), ['releve-bellerives'], 'mois 13 et 2026-02-30 ignorés, Attestation de salaire exclue des paies');
  const pmMars = plain(c0.detecterPiecesManquantesPure_(idxPieces, [], new Date('2026-03-15T12:00:00Z'), 40));
  assert.deepStrictEqual(pmMars.map((x) => x.cle), ['releve-bellerives'], '2026-02-30 ne retombe pas en 2026-02-28');
});

test('Non-régression R3 : epingle|/agenda|/agenda-exp| ne masquent pas déplacé, doublon reste bloqué', () => {
  const fidDep = 'FICTIF_EPINGLE_DEPL_001';
  const fidDoub = 'FICTIF_DOUB_MASQ_00001';
  const { c, sh, props } = ctxSignaux({
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId'],
        ['drive|' + fidDoub, new Date(), '2026-04-01_Facture_Fictif.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fidDoub],
        ['drive|' + fidDoub, new Date(), '2026-04-01_Facture_Fictif.pdf', '02 · Finances', '02 · Finances', 'doublon', '', '', fidDoub],
        ['drive|' + fidDep, new Date(), '2026-04-05_Assurance_Fictif.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule', 'déplacé', '', '', fidDep],
        ['epingle|' + fidDep, new Date(), '2026-04-05_Assurance_Fictif.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule', 'épinglé', '', '', fidDep],
        ['agenda|' + fidDep + '|2027-04-05', new Date(), '2026-04-05_Assurance_Fictif.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule', 'agenda', '', '', fidDep],
        ['agenda-exp|' + fidDep + '|90|2027-04-05', new Date(), '2026-04-05_Assurance_Fictif.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule', 'agenda', '', '', fidDep],
      ],
    },
    files: {
      [fidDoub]: { name: '2026-04-01_Facture_Fictif.pdf', mimeType: 'text/plain', texte: 'Doublon ignoré' },
      [fidDep]: { name: '2026-04-05_Assurance_Fictif.pdf', mimeType: 'text/plain', texte: 'Assurance fictive échéance 2027-04-05' },
    },
  });
  c.syntheseCoutMois_ = () => ({ appels: 1, dollars: 1.0 });
  const appeles = [];
  c.appelAnthropicTexte_ = (m, sys, contenu) => {
    appeles.push(contenu);
    return JSON.stringify({ categorie: 'Assurance', date_expiration: '2027-04-05', fournisseur: 'AssureurFictif' });
  };
  const auj = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  assert.strictEqual(c.rattraperSignauxCopilote_(sh.sheets.Index.slice(1), () => false), 1);
  assert.strictEqual(appeles.length, 1, 'seul fidDep appelle le LLM, fidDoub reste bloqué à 0 appel');
  assert.ok(appeles[0].includes('2026-04-05_Assurance_Fictif.pdf'));
  assert.strictEqual(props.DriveAI_SIGNAUX_JOUR, auj + '|1');
  const sig = c.lireSignaux_().find((s) => s.fileId === fidDep);
  assert.ok(sig && sig.dateExpiration === '2027-04-05' && sig.fournisseur === 'AssureurFictif');
});

test('Non-régression R3 : bornes 3/run + 15/j sur {bad/null hors panne, et break immédiat sur estPannePlateforme_()', () => {
  const auj = new Date().toISOString().slice(0, 10).replace(/-/g, '/');

  // 1. 5 docs '{bad' → Run 1 = 3 appels (auj|3), Run 2 = 2 appels (auj|5), Run 3 = 0 appel
  const idxBad = [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId']];
  const filesBad = {};
  for (let i = 1; i <= 5; i++) {
    const fid = 'FICTIF_BAD_JSON_00000' + i;
    idxBad.push(['drive|' + fid, new Date(), '2026-07-0' + i + '_Doc.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fid]);
    filesBad[fid] = { name: '2026-07-0' + i + '_Doc.pdf', mimeType: 'text/plain', texte: 'Contenu bad ' + i };
  }
  const { c: cBad, sh: shBad, props: pBad } = ctxSignaux({ sheets: { Index: idxBad }, files: filesBad });
  cBad.syntheseCoutMois_ = () => ({ appels: 1, dollars: 1.0 });
  let appelsBad = 0;
  cBad.appelAnthropicTexte_ = () => { appelsBad++; return '{bad'; };
  assert.strictEqual(cBad.rattraperSignauxCopilote_(shBad.sheets.Index.slice(1), () => false), 3);
  assert.strictEqual(appelsBad, 3);
  assert.strictEqual(pBad.DriveAI_SIGNAUX_JOUR, auj + '|3');
  assert.strictEqual(cBad.lireSignaux_().filter((s) => s.categorie === 'aucun').length, 3);

  assert.strictEqual(cBad.rattraperSignauxCopilote_(shBad.sheets.Index.slice(1), () => false), 2);
  assert.strictEqual(appelsBad, 5);
  assert.strictEqual(pBad.DriveAI_SIGNAUX_JOUR, auj + '|5');
  assert.strictEqual(cBad.lireSignaux_().filter((s) => s.categorie === 'aucun').length, 5);

  assert.strictEqual(cBad.rattraperSignauxCopilote_(shBad.sheets.Index.slice(1), () => false), 0);
  assert.strictEqual(appelsBad, 5, 'aucune boucle infinie sur {bad');

  // 2. 5 docs null (hors panne plateforme) → Run 1 = 3 appels (auj|3), Run 2 = 2 appels (auj|5), Run 3 = 0 appel ; puis plafond 15/j respecté
  const idxNull = [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId']];
  const filesNull = {};
  for (let i = 1; i <= 5; i++) {
    const fid = 'FICTIF_NULL_RET_00000' + i;
    idxNull.push(['drive|' + fid, new Date(), '2026-08-0' + i + '_Doc.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fid]);
    filesNull[fid] = { name: '2026-08-0' + i + '_Doc.pdf', mimeType: 'text/plain', texte: 'Contenu null ' + i };
  }
  const { c: cNull, sh: shNull, props: pNull, files: fNull } = ctxSignaux({ sheets: { Index: idxNull }, files: filesNull });
  cNull.syntheseCoutMois_ = () => ({ appels: 1, dollars: 1.0 });
  let appelsNull = 0;
  cNull.appelAnthropicTexte_ = () => { appelsNull++; return null; };
  assert.strictEqual(cNull.rattraperSignauxCopilote_(shNull.sheets.Index.slice(1), () => false), 3);
  assert.strictEqual(appelsNull, 3);
  assert.strictEqual(pNull.DriveAI_SIGNAUX_JOUR, auj + '|3');

  assert.strictEqual(cNull.rattraperSignauxCopilote_(shNull.sheets.Index.slice(1), () => false), 2);
  assert.strictEqual(appelsNull, 5);
  assert.strictEqual(pNull.DriveAI_SIGNAUX_JOUR, auj + '|5');

  assert.strictEqual(cNull.rattraperSignauxCopilote_(shNull.sheets.Index.slice(1), () => false), 0);
  assert.strictEqual(appelsNull, 5, 'aucune boucle infinie sur null hors panne');

  // Plafond 15/j : départ à auj|13 avec 3 nouveaux docs null → exactement 2 appels jusqu'à auj|15
  for (let i = 1; i <= 3; i++) {
    const fid = 'FICTIF_QUOTA_J_00000' + i;
    shNull.sheets.Index.push(['drive|' + fid, new Date(), '2026-08-1' + i + '_Doc.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fid]);
    fNull[fid] = { name: '2026-08-1' + i + '_Doc.pdf', mimeType: 'text/plain', texte: 'Contenu quota ' + i };
  }
  pNull.DriveAI_SIGNAUX_JOUR = auj + '|13';
  assert.strictEqual(cNull.rattraperSignauxCopilote_(shNull.sheets.Index.slice(1), () => false), 2);
  assert.strictEqual(appelsNull, 7);
  assert.strictEqual(pNull.DriveAI_SIGNAUX_JOUR, auj + '|15');

  // 3. estPannePlateforme_() : déjà active (0 appel) et déclenchée au 1er appel → break immédiat sans marquer 'aucun', puis rattrapage après réinitialisation
  const idxPanne = [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId']];
  const filesPanne = {};
  for (let i = 1; i <= 3; i++) {
    const fid = 'FICTIF_PANNE_RAT_0000' + i;
    idxPanne.push(['drive|' + fid, new Date(), '2026-09-0' + i + '_Doc.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', fid]);
    filesPanne[fid] = { name: '2026-09-0' + i + '_Doc.pdf', mimeType: 'text/plain', texte: 'Contenu panne ' + i };
  }
  const { c: cPanne, sh: shPanne, props: pPanne } = ctxSignaux({ sheets: { Index: idxPanne }, files: filesPanne });
  cPanne.syntheseCoutMois_ = () => ({ appels: 1, dollars: 1.0 });
  let appelsPanne = 0;

  // Déjà active avant le run → 0 appel
  cPanne.poserPannePlateforme_('panne déjà active');
  cPanne.appelAnthropicTexte_ = () => { appelsPanne++; return '{}'; };
  assert.strictEqual(cPanne.rattraperSignauxCopilote_(shPanne.sheets.Index.slice(1), () => false), 0);
  assert.strictEqual(appelsPanne, 0);

  // Déclenchée au 1er appel → break immédiat (1 appel, 0 ligne 'aucun', DriveAI_SIGNAUX_JOUR inchangé)
  cPanne.reinitialiserPannePlateforme_();
  cPanne.appelAnthropicTexte_ = () => {
    appelsPanne++;
    cPanne.poserPannePlateforme_('crédit épuisé test');
    return null;
  };
  assert.strictEqual(cPanne.rattraperSignauxCopilote_(shPanne.sheets.Index.slice(1), () => false), 0);
  assert.strictEqual(appelsPanne, 1, 'break immédiat dès le 1er appel qui déclenche la panne');
  assert.strictEqual(cPanne.lireSignaux_().length, 0, 'zéro ligne aucun inscrite pendant une panne plateforme');
  assert.strictEqual(pPanne.DriveAI_SIGNAUX_JOUR, undefined, 'compteur jour inchangé sur panne plateforme');

  // Rattrapage réussi au run suivant après reinitialiserPannePlateforme_()
  cPanne.reinitialiserPannePlateforme_();
  cPanne.appelAnthropicTexte_ = () => {
    appelsPanne++;
    return JSON.stringify({ categorie: 'Facture', fournisseur: 'FournisseurFictif', montant: 42, devise: 'CAD' });
  };
  assert.strictEqual(cPanne.rattraperSignauxCopilote_(shPanne.sheets.Index.slice(1), () => false), 3);
  assert.strictEqual(appelsPanne, 4);
  assert.strictEqual(pPanne.DriveAI_SIGNAUX_JOUR, auj + '|3');
  assert.strictEqual(cPanne.lireSignaux_().length, 3);
});
