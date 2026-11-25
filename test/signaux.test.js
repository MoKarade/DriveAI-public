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
  assert.ok(evImmi.description.includes('https://drive.google.com/file/d/FICTIF_IMMI_EXP/view'));

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
