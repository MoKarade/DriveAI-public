'use strict';
/**
 * Tests unitaires Lot 4B-1 : Questions en langage naturel (#18) et Règles en 1 phrase + mode auto (#19).
 * Données 100 % fictives uniquement (`FICTIF_*`, `@exemple.test`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

const plain = (x) => JSON.parse(JSON.stringify(x));

function ctxQR(opts = {}) {
  const c = load(opts.modules || ['Config.gs', 'Cout.gs', 'Suivi.gs', 'Journal.gs', 'Actions.gs', 'Signaux.gs', 'PacksChecklists.gs', 'Copilote.gs', 'QuestionsRegles.gs']);
  const props = Object.assign({}, opts.props);
  const sheets = Object.assign({
    Index: [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire']],
    Signaux: [['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation']],
    Liens: [['Horodatage', 'ThreadId', 'MessageId', 'Adresse', 'Domaine', 'Chemin', 'FileId', 'Nom']],
    Actions: [['Id', 'Horodatage', 'Type', 'Cible', 'Avant', 'Après', 'Statut', 'Détail']],
    Entités: [['Domaine', 'Entité', 'Type', 'Statut', 'Dossier ID', 'Variante', 'Vu', 'Maj', 'Note']],
    Copilote: [['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations']],
    Journal: [['Horodatage', 'Niveau', 'Source', 'Message']],
  }, opts.sheets || {});
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
      getProperties: () => Object.assign({}, props),
    }),
  };
  c.Utilities = { formatDate: () => '2026-11' };
  c.Session = { getScriptTimeZone: () => 'America/Toronto' };
  c.feuille_ = (nom) => {
    const rows = sheets[nom] || (sheets[nom] = [['Clé']]);
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => (rows[0] ? rows[0].length : 1),
      appendRow: (r) => { rows.push(r.slice()); },
      getRange: (r, col, nr, nc) => ({
        getValue: () => (rows[r - 1] ? rows[r - 1][col - 1] : ''),
        setValue: (v) => { while (rows.length < r) rows.push([]); rows[r - 1][col - 1] = v; },
        setValues: (m) => { for (let i = 0; i < m.length; i++) { while (rows.length < r + i) rows.push([]); for (let j = 0; j < m[i].length; j++) rows[r + i - 1][col + j - 1] = m[i][j]; } },
        getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map((rw) => {
          const out = []; for (let k = 0; k < (nc || 1); k++) out.push(rw[col - 1 + k]); return out;
        }),
      }),
    };
  };
  const files = opts.files || {};
  const folders = opts.folders || {};
  const moves = [];
  const wrapFolder = (id) => {
    const d = folders[id];
    if (!d) throw new Error('Dossier absent ' + id);
    return {
      getId: () => d.id,
      getName: () => d.name,
      isTrashed: () => !!d.trashed,
      getParents: () => iter((d.parents || []).map(wrapFolder)),
      getFiles: () => iter((d.files || []).map(wrapFile)),
      getFolders: () => iter((d.folders || []).map(wrapFolder)),
      getFoldersByName: (n) => iter((d.folders || []).filter((sid) => folders[sid] && folders[sid].name === n).map(wrapFolder)),
    };
  };
  const wrapFile = (id) => {
    const f = files[id];
    if (!f) throw new Error('Fichier absent ' + id);
    return {
      getId: () => f.id,
      getName: () => f.name,
      isTrashed: () => !!f.trashed,
      getParents: () => iter((f.parents || []).map(wrapFolder)),
    };
  };
  c.DriveApp = { getFolderById: wrapFolder, getFileById: wrapFile };
  c.deplacerEtRenommer_ = (fid, dst, src, nom) => {
    moves.push({ fid, dst, src, nom });
    if (files[fid]) files[fid].parents = [dst];
    return true;
  };
  c.ensembleDomainesProteges_ = () => opts.proteges || { FICTIF_DOM04: true, FICTIF_ANNA: true, FICTIF_PACKS: true };
  c.aParentProtege_ = (it) => {
    let p = null;
    const par = it.getParents();
    if (par.hasNext()) p = par.next();
    return !!(p && (p.getName() === '04 · Immigration' || p.getName() === 'Anna' || p.getName() === '00 · Packs'));
  };
  c.sousDossierExistant_ = (par, nom) => {
    const it = par.getFoldersByName(nom);
    return it.hasNext() ? it.next() : null;
  };
  c.CONFIG.DOMAINES = opts.domaines || { '02 · Finances': 'FICTIF_DOM02', '04 · Immigration': 'FICTIF_DOM04', '05 · Carrière': 'FICTIF_DOM05' };
  return { c, props, sheets, moves };
}

test('#18 collecterSourcesQuestionPure_ : inclut 04 · Immigration et Anna en lecture seule, exclut zones système, liens encodeURIComponent', () => {
  const { c } = ctxQR();
  const sources = plain(c.collecterSourcesQuestionPure_('Quand expire mon passeport et quel reçu Anna ?', {
    index: [
      ['drive|FICTIF_TEST_PASS_00001', '2026-03-01', '2026-03-01_Passeport_IRCC.pdf', '04 · Immigration', '04 · Immigration/Identite', 'manuel', '', '', 'FICTIF_TEST_PASS_00001'],
      ['drive|FICTIF_TEST_ANNA_00001', '2026-08-10', '2026-08-10_Recu_Clinique.pdf', 'Anna', 'Anna/Sante', 'manuel', '', '', 'FICTIF_TEST_ANNA_00001'],
      ['drive|FICTIF_TEST_SYST_00001', '2026-08-10', '2026-08-10_Passeport_Temp.pdf', '_Technique', '_Technique', 'classé', '', '', 'FICTIF_TEST_SYST_00001'],
    ],
    signaux: [
      { fileId: 'FICTIF_TEST_PASS_00001', categorie: 'Passeport', fournisseur: 'IRCC', domaine: '04 · Immigration', chemin: '04 · Immigration/Identite', dateDoc: '2026-03-01', dateExpiration: '2031-03-01', montant: '', devise: '', finGarantie: '', delaiRetour: '', statutReclamation: '' },
      { fileId: 'FICTIF_TEST_ANNA_00001', categorie: 'Reçu clinique', fournisseur: 'Clinique Exemple', domaine: 'Anna', chemin: 'Anna/Sante', dateDoc: '2026-08-10', dateExpiration: '', montant: 95, devise: 'CAD', finGarantie: '', delaiRetour: '', statutReclamation: 'a-reclamer' },
    ],
    liens: [['2026-08-10', 'thr-1', 'msg-1', 'clinique@exemple.test', 'Anna', 'Anna/Sante', 'FICTIF_TEST_ANNA_00001', '2026-08-10_Recu_Clinique.pdf']],
    entites: [['02 · Finances', 'Hydro-Exemple', 'organisme', 'validee', 'FICTIF_D', 'Hydro']],
    copilote: [{ id: 'cop-1', titre: 'Expiration passeport IRCC', domaine: '04 · Immigration', chemin: '04 · Immigration', type: 'expiration', statut: 'actif' }],
    actions: [['act-1', '2026-08-10', 'drive-deplacer', 'FICTIF_TEST_ANNA_00001', '{}', '{}', 'appliqué', 'Passeport']],
  }, 6));
  const sPass = sources.find((s) => s.fileId === 'FICTIF_TEST_PASS_00001');
  const sAnna = sources.find((s) => s.fileId === 'FICTIF_TEST_ANNA_00001');
  assert.ok(sPass, '04 · Immigration inclus en lecture seule');
  assert.ok(sAnna, 'Anna inclus en lecture seule');
  assert.strictEqual(sPass.lien, 'https://drive.google.com/file/d/FICTIF_TEST_PASS_00001/view');
  assert.strictEqual(new URL(sAnna.lien).hostname, 'drive.google.com');
  assert.ok(!sources.some((s) => s.fileId === 'FICTIF_TEST_SYST_00001'), 'zone système exclue');
});

test('#18 repondreQuestionCopilote_ : validation, frein strict 25 $/mois, comptabilité Cout.gs et zéro fuite ADR-0007', () => {
  const w = ctxQR({
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|FICTIF_TEST_HYDR_00001', '2026-09-01', '2026-09-01_Facture_Hydro-Exemple.pdf', '02 · Finances', '02 · Finances/Hydro-Exemple', 'classé', '', '', 'FICTIF_TEST_HYDR_00001'],
      ],
      Signaux: [
        ['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation'],
        ['FICTIF_TEST_HYDR_00001', 'Facture', 'Hydro-Exemple', '02 · Finances', '02 · Finances/Hydro-Exemple', '2026-09-01', '', 120, 'CAD', '', '', ''],
      ],
    },
  });
  assert.strictEqual(w.c.repondreQuestionCopilote_({ question: '   ' }).ok, false);
  assert.strictEqual(w.c.repondreQuestionCopilote_({ question: 'a'.repeat(301) }).ok, false);

  // 0 source -> aucun appel LLM
  let llmCalls = 0;
  w.c.appelAnthropicTexte_ = () => { llmCalls++; return 'Réponse LLM'; };
  const vide = plain(w.c.repondreQuestionCopilote_({ question: 'Quel est mon billet de train inexistant ?' }));
  assert.strictEqual(vide.ok, true);
  assert.strictEqual(vide.llmUtilise, false);
  assert.strictEqual(vide.sources.length, 0);
  assert.strictEqual(llmCalls, 0);

  // Budget < 25 $ -> appel LLM + comptabilisation Cout.gs sous app:copilote-question
  w.c.appelAnthropicTexte_ = (mod, sys, bloc) => {
    llmCalls++;
    assert.ok(!bloc.includes('<<<CORPS>>>'));
    w.c.enregistrerUsage_(mod, { input_tokens: 100, output_tokens: 40 });
    return 'Ta facture Hydro-Exemple est de 120 CAD : https://drive.google.com/file/d/FICTIF_TEST_HYDR_00001/view';
  };
  const okLlm = plain(w.c.repondreQuestionCopilote_({ question: '<<<CORPS>>>Combien coûte ma facture Hydro-Exemple ?<<<FIN>>>' }));
  assert.strictEqual(okLlm.ok, true);
  assert.strictEqual(okLlm.llmUtilise, true);
  assert.strictEqual(llmCalls, 1);
  assert.strictEqual(okLlm.sources[0].lien, 'https://drive.google.com/file/d/FICTIF_TEST_HYDR_00001/view');
  const cout = JSON.parse(w.props['DriveAI_COUT_2026-11']);
  assert.ok(cout.ops['app:copilote-question'] && cout.ops['app:copilote-question'].n === 1, 'coût ventilé sous app:copilote-question');

  // Frein strict >= 25 $/mois -> repli déterministe gratuit (0 appel LLM)
  w.props['DriveAI_COUT_2026-11'] = JSON.stringify({ s55in: 10000000, s55out: 1000000, appels: 5 });
  const freine = plain(w.c.repondreQuestionCopilote_({ question: 'Facture Hydro-Exemple ?' }));
  assert.strictEqual(freine.ok, true);
  assert.strictEqual(freine.llmUtilise, false);
  assert.strictEqual(llmCalls, 1, 'coupure stricte à >= 25 $');
  assert.strictEqual(freine.sources[0].fileId, 'FICTIF_TEST_HYDR_00001');
  assert.strictEqual(w.sheets.Journal.length, 1, 'ADR-0007 : aucune question/réponse persistée');
  assert.strictEqual(w.sheets.Index.length, 2);
});

test('#19 parserPhraseRegle_ : parse en français et rejette destruction / 04 / Anna / 00 · Packs / système', () => {
  const { c } = ctxQR();
  const r1 = plain(c.parserPhraseRegle_('Si facture Hydro-Exemple alors ranger dans 02 · Finances/Hydro-Exemple', ['02 · Finances'], ['Finances']));
  assert.ok(r1);
  assert.strictEqual(r1.domaine, '02 · Finances');
  assert.strictEqual(r1.cible, '02 · Finances/Hydro-Exemple');
  assert.strictEqual(r1.alors.libelle, 'Finances');
  assert.ok(r1.si.mots.includes('hydro') && r1.si.mots.includes('exemple'));

  const rMail = plain(c.parserPhraseRegle_('Si mail de factures@exemple.test alors marquer important et libeller Finances', ['02 · Finances'], ['Finances']));
  assert.ok(rMail && rMail.si.exp === 'factures@exemple.test' && rMail.alors.important === true);

  for (const bad of [
    '',
    'abc',
    'a'.repeat(241),
    'Si pub alors supprimer le mail immédiatement',
    'Si spam alors mettre à la corbeille',
    'Si mail alors retirer libellé Finance',
    'Si document alors envoyer un mail automatique',
    'Si passeport alors déplacer dans 04 · Immigration',
    'Si reçu alors classer dans Anna/Sante',
    'Si document alors ranger dans 00 · Packs',
    'Si fichier alors déplacer dans _Technique',
  ]) {
    assert.strictEqual(c.parserPhraseRegle_(bad, ['02 · Finances', '04 · Immigration'], ['Finances']), null, 'rejet attendu pour: ' + bad);
  }
});

test('#19 executerRegleCopilote_, incrementerValidationRegle_, appliquerReglesGmail_ et appliquerReglesDriveCopilote_', () => {
  const w = ctxQR({
    folders: {
      FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'DriveAI', parents: [], files: [], folders: ['FICTIF_DOM02', 'FICTIF_DOM04', 'FICTIF_VRAC'] },
      FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_HYD_DIR'] },
      FICTIF_HYD_DIR: { id: 'FICTIF_HYD_DIR', name: 'Hydro-Exemple', parents: ['FICTIF_DOM02'], files: [], folders: [] },
      FICTIF_DOM04: { id: 'FICTIF_DOM04', name: '04 · Immigration', parents: ['FICTIF_ROOT'], files: ['FICTIF_TEST_IMMI_00001'], folders: [] },
      FICTIF_VRAC: { id: 'FICTIF_VRAC', name: '08 · Perso & projets', parents: ['FICTIF_ROOT'], files: ['FICTIF_TEST_DOCHYD_001'], folders: [] },
    },
    files: {
      FICTIF_TEST_DOCHYD_001: { id: 'FICTIF_TEST_DOCHYD_001', name: '2026-10-01_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_VRAC'], trashed: false },
      FICTIF_TEST_IMMI_00001: { id: 'FICTIF_TEST_IMMI_00001', name: '2026-10-01_Facture_Hydro-Exemple_Immi.pdf', parents: ['FICTIF_DOM04'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|FICTIF_TEST_DOCHYD_001', '2026-10-01', '2026-10-01_Facture_Hydro-Exemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', 'FICTIF_TEST_DOCHYD_001'],
        ['drive|FICTIF_TEST_IMMI_00001', '2026-10-01', '2026-10-01_Facture_Hydro-Exemple_Immi.pdf', '04 · Immigration', '04 · Immigration', 'manuel', '', '', 'FICTIF_TEST_IMMI_00001'],
      ],
    },
  });

  // Refus 04 · Immigration / Anna / destruction
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si passeport alors déplacer dans 04 · Immigration' }).ok, false);
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si reçu alors supprimer le fichier' }).ok, false);

  // Création en mode proposé (auto: false)
  const cr = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si facture Hydro-Exemple alors ranger dans 02 · Finances/Hydro-Exemple et marquer important' }));
  assert.strictEqual(cr.ok, true);
  assert.strictEqual(cr.auto, false);
  assert.strictEqual(w.sheets.Copilote[1][8], 'proposé');

  // En mode proposé, appliquerReglesDriveCopilote_ crée une carte cascade sans déplacer
  const rProp = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(rProp.traitees, 0);
  assert.strictEqual(rProp.creees, 1);
  assert.strictEqual(w.moves.length, 0);

  // 3 validations manuelles -> passage auto automatique
  assert.strictEqual(w.c.incrementerValidationRegle_(cr.regleId).auto, false);
  assert.strictEqual(w.c.incrementerValidationRegle_(cr.regleId).auto, false);
  const v3 = plain(w.c.incrementerValidationRegle_(cr.regleId));
  assert.strictEqual(v3.validations, 3);
  assert.strictEqual(v3.auto, true);
  assert.strictEqual(v3.statut, 'auto');

  // En mode auto, appliquerReglesGmail_ résout le libellé & important (hors zone protégée)
  const mGm = plain(w.c.appliquerReglesGmail_(w.c.lireReglesCopilote_(true), {
    expediteur: 'Billing <factures@exemple.test>', adresse: 'factures@exemple.test',
    sujet: 'Facture Hydro-Exemple octobre', nomsPj: [], zoneProtegee: false, candidats: ['Finances', 'Administration'],
  }));
  assert.ok(mGm && mGm.libelle === 'Finances' && mGm.important === true);

  // En mode auto, appliquerReglesDriveCopilote_ déplace FICTIF_TEST_DOCHYD_001 (journalisé Actions) et ignore FICTIF_TEST_IMMI_00001
  const rAuto = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(rAuto.traitees, 1);
  assert.strictEqual(w.moves.length, 1);
  assert.strictEqual(w.moves[0].fid, 'FICTIF_TEST_DOCHYD_001');
  assert.strictEqual(w.moves[0].dst, 'FICTIF_HYD_DIR');
  assert.strictEqual(w.sheets.Actions.length, 2, 'journal Actions écrit pour annulation 1-clic');

  // Annulation / désactivation 1-clic
  const off = plain(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: cr.regleId }));
  assert.strictEqual(off.ok, true);
  assert.strictEqual(off.auto, false);
  assert.strictEqual(w.sheets.Copilote[1][8], 'proposé');

  const sup = plain(w.c.executerRegleCopilote_({ mode: 'supprimer-auto', regleId: cr.regleId }));
  assert.strictEqual(sup.ok, true);
  assert.strictEqual(sup.auto, false);
  assert.strictEqual(w.sheets.Copilote[1][8], 'ignoré');
  assert.strictEqual(w.c.lireReglesCopilote_(false).length, 0);
});

test('#19 non-régression : articles français interdits, liste blanche LLM et défense en profondeur pré-injection Copilote', () => {
  const w = ctxQR({
    folders: {
      FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'DriveAI', parents: [], files: [], folders: ['FICTIF_DOM02'] },
      FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: ['FICTIF_TEST_DOCHYD_001'], folders: [] },
    },
    files: {
      FICTIF_TEST_DOCHYD_001: { id: 'FICTIF_TEST_DOCHYD_001', name: '2026-10-01_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_DOM02'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|FICTIF_TEST_DOCHYD_001', '2026-10-01', '2026-10-01_Facture_Hydro-Exemple.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', 'FICTIF_TEST_DOCHYD_001'],
      ],
    },
  });

  // Retrait de libellés avec articles / pluriels / possessifs / démonstratifs / quantificateurs / ôter et envoi e-mail bloqués
  for (const phrase of [
    'Si mail Hydro alors retirer le libellé Finances',
    'Si mail Hydro alors enlever les libellés Finances',
    'Si mail Hydro alors supprimer l\'étiquette Finances',
    'Si document Hydro alors envoyer des courriels',
    'Si mail Hydro alors envoyer un e-mail et libeller Finances',
    'Si mail Hydro alors retirer mon libellé Finances',
    'Si mail Hydro alors retirer ce libellé Finances',
    'Si mail Hydro alors retirer tous les libellés Finances',
    'Si mail Hydro alors ôter le libellé Finances',
  ]) {
    assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'creer', phrase }).ok, false, phrase);
  }

  // parserRegleViaLlm_ rejette action/canal hors liste blanche (y compris clés prototype) et libelle/domaine protégés
  w.c.appelAnthropicTexte_ = () => JSON.stringify({ mots: ['document'], canal: 'gmail', action: 'supprimer', domaine: '', cible: '', libelle: 'Finances' });
  assert.strictEqual(w.c.parserRegleViaLlm_('Si doc alors classer vite'), null);
  w.c.appelAnthropicTexte_ = () => JSON.stringify({ mots: ['document'], canal: 'gmail', action: 'toString', domaine: '', cible: '', libelle: 'Finances' });
  assert.strictEqual(w.c.parserRegleViaLlm_('Si doc alors classer vite'), null);
  w.c.appelAnthropicTexte_ = () => JSON.stringify({ mots: ['document'], canal: 'constructor', action: 'libeller', domaine: '', cible: '', libelle: 'Finances' });
  assert.strictEqual(w.c.parserRegleViaLlm_('Si doc alors classer vite'), null);
  w.c.appelAnthropicTexte_ = () => JSON.stringify({ mots: ['document'], canal: 'sms', action: 'libeller', domaine: '', cible: '', libelle: 'Finances' });
  assert.strictEqual(w.c.parserRegleViaLlm_('Si doc alors classer vite'), null);
  w.c.appelAnthropicTexte_ = () => JSON.stringify({ mots: ['document'], canal: 'gmail', action: 'libeller', domaine: '', cible: '', libelle: 'Immigration' });
  assert.strictEqual(w.c.parserRegleViaLlm_('Si doc alors classer vite'), null);
  w.c.appelAnthropicTexte_ = () => JSON.stringify({ mots: ['document'], canal: 'gmail', action: 'libeller', domaine: '', cible: '', libelle: 'Anna' });
  assert.strictEqual(w.c.parserRegleViaLlm_('Si doc alors classer vite'), null);

  // appliquerReglesGmail_ bloque une ligne Copilote pré-injectée si colonnes vides mais ActionJson protégé (incl. _Prive dans phrase)
  const reglesPiegees = [
    { id: 'cop-mal-04', domaine: '', chemin: '', statut: 'auto', actionJson: JSON.stringify({ si: { mots: ['hydro'] }, domaine: '04 · Immigration', alors: { canal: 'gmail', action: 'libeller', libelle: 'Finances' }, auto: true }) },
    { id: 'cop-mal-anna', domaine: '', chemin: '', statut: 'auto', actionJson: JSON.stringify({ si: { mots: ['hydro'] }, alors: { canal: 'gmail', action: 'libeller', libelle: 'Anna' }, auto: true }) },
    { id: 'cop-mal-alors', domaine: '', chemin: '', statut: 'auto', actionJson: JSON.stringify({ si: { mots: ['hydro'] }, alors: { canal: 'gmail', action: 'libeller', domaine: '04 · Immigration', libelle: 'Finances' }, auto: true }) },
    { id: 'cop-mal-prive', domaine: '02 · Finances', chemin: '02 · Finances', statut: 'auto', actionJson: JSON.stringify({ si: { mots: ['hydro'] }, phrase: 'Si hydro alors _Prive', domaine: '02 · Finances', cible: '02 · Finances', alors: { canal: 'gmail', action: 'libeller', libelle: 'Finances' }, auto: true }) },
  ];
  assert.strictEqual(w.c.appliquerReglesGmail_(reglesPiegees, {
    expediteur: 'Hydro <factures@exemple.test>', adresse: 'factures@exemple.test',
    sujet: 'Facture Hydro octobre', nomsPj: [], zoneProtegee: false, candidats: ['Finances', 'Anna'],
  }), null);
  assert.strictEqual(w.c.regleEstInterditeQR_(reglesPiegees[3], JSON.parse(reglesPiegees[3].actionJson)), true);

  // appliquerReglesDriveCopilote_ bloque également une ligne pré-injectée visant 04 · Immigration / 00 · Packs dans ActionJson
  w.sheets.Copilote.push(
    ['cop-drv-04', new Date(), 'regle', 'regle-auto', '', '', 'Piège', JSON.stringify({ si: { mots: ['hydro'] }, domaine: '04 · Immigration', alors: { canal: 'drive', action: 'deplacer', domaine: '04 · Immigration', cible: '04 · Immigration' }, auto: true }), 'auto', 3],
    ['cop-drv-pk', new Date(), 'regle', 'regle-auto', '', '', 'Piège', JSON.stringify({ si: { mots: ['hydro'] }, alors: { canal: 'drive', action: 'deplacer', domaine: '02 · Finances', cible: '00 · Packs' }, auto: true }), 'auto', 3]
  );
  const resDrv = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(resDrv.traitees, 0);
  assert.strictEqual(resDrv.creees, 0);
});

test('non-régression M9 Anomalie 1 : règle proposé préserve regleId/cle contre detecterCascadeTickCopilote_, zéro cascade inverse et passage auto à 3 validations', () => {
  const FH1 = 'FICTIF_TEST_HYD_00001';
  const FH2 = 'FICTIF_TEST_HYD_00002';
  const FH3 = 'FICTIF_TEST_HYD_00003';
  const FH4 = 'FICTIF_TEST_HYD_00004';
  const w = ctxQR({
    modules: ['Config.gs', 'Cout.gs', 'Suivi.gs', 'Journal.gs', 'Actions.gs', 'Entites.gs', 'VeilleDrive.gs', 'Signaux.gs', 'PacksChecklists.gs', 'Copilote.gs', 'QuestionsRegles.gs'],
    folders: {
      FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'DriveAI', parents: [], files: [], folders: ['FICTIF_DOM02'] },
      FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_HYD_DIR', 'FICTIF_AUTRE'] },
      FICTIF_HYD_DIR: { id: 'FICTIF_HYD_DIR', name: 'Hydro-Exemple', parents: ['FICTIF_DOM02'], files: [FH2], folders: [] },
      FICTIF_AUTRE: { id: 'FICTIF_AUTRE', name: 'Autre', parents: ['FICTIF_DOM02'], files: [FH1, FH3, FH4], folders: [] },
    },
    files: {
      [FH1]: { id: FH1, name: '2026-10-01_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_AUTRE'], trashed: false },
      [FH2]: { id: FH2, name: '2026-10-02_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_HYD_DIR'], trashed: false },
      [FH3]: { id: FH3, name: '2026-10-03_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_AUTRE'], trashed: false },
      [FH4]: { id: FH4, name: '2026-10-04_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_AUTRE'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|' + FH1, '2026-10-01', '2026-10-01_Facture_Hydro-Exemple.pdf', '02 · Finances', '02 · Finances/Autre', 'classé', '', '', FH1],
        ['drive|' + FH2, '2026-10-02', '2026-10-02_Facture_Hydro-Exemple.pdf', '02 · Finances', '02 · Finances/Hydro-Exemple', 'classé', '', '', FH2],
      ],
    },
  });
  w.c.domainesVeilleNonProteges_ = () => [];

  const cr = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si facture Hydro-Exemple alors classer dans 02 · Finances/Hydro-Exemple' }));
  assert.strictEqual(cr.ok, true);
  assert.strictEqual(cr.auto, false);

  w.c.executerEtapeCopilote_(() => false);
  const cartes1 = plain(w.c.lireCartesCopilote_());
  const cascades1 = cartes1.filter((x) => x.type === 'cascade' && x.statut === 'proposé');
  assert.strictEqual(cascades1.length, 1, 'aucune cascade inverse vers 02 · Finances/Autre');
  assert.strictEqual(cascades1[0].chemin, '02 · Finances/Hydro-Exemple');
  assert.strictEqual(cascades1[0].statut, 'proposé');
  const act1 = JSON.parse(cascades1[0].actionJson);
  assert.strictEqual(act1.regleId, cr.regleId);
  assert.strictEqual(act1.cle, 'regle-cas|' + cr.regleId + '|FICTIF_HYD_DIR');
  assert.strictEqual(act1.cibleId, 'FICTIF_HYD_DIR');
  assert.deepStrictEqual(act1.ids, [FH1]);

  // Un appel générique ultérieur sur le même chemin ne doit pas écraser regleId / cle
  const ecrasement = plain(w.c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'cascade', domaine: '02 · Finances', chemin: '02 · Finances/Hydro-Exemple',
    titre: 'Générique', action: { cibleId: 'FICTIF_HYD_DIR', ids: [FH1] },
  }));
  assert.strictEqual(ecrasement.id, cascades1[0].id);
  assert.strictEqual(ecrasement.cree, false);
  const actApres = JSON.parse(plain(w.c.lireCartesCopilote_()).find((x) => x.id === cascades1[0].id).actionJson);
  assert.strictEqual(actApres.regleId, cr.regleId);
  assert.strictEqual(actApres.cle, 'regle-cas|' + cr.regleId + '|FICTIF_HYD_DIR');

  // Une ancienne carte cascade générique ignorée ne bloque pas une nouvelle règle explicite, et deux règles distinctes restent isolées
  w.sheets.Copilote.push([
    'cop-ign-gen', new Date(), 'carte', 'cascade', '02 · Finances', '02 · Finances/Hydro-Exemple',
    'Ancienne cascade', JSON.stringify({ cibleId: 'FICTIF_HYD_DIR', ids: [FH1] }), 'ignoré', 0,
  ]);
  const cr2 = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si relevé Hydro-Exemple alors classer dans 02 · Finances/Hydro-Exemple' }));
  assert.strictEqual(cr2.ok, true);
  const resR2 = plain(w.c.enregistrerCarteCopilote_({
    categorie: 'carte', type: 'cascade', domaine: '02 · Finances', chemin: '02 · Finances/Hydro-Exemple',
    titre: 'Règle 2', action: { cle: 'regle-cas|' + cr2.regleId + '|FICTIF_HYD_DIR', cibleId: 'FICTIF_HYD_DIR', ids: [FH1], regleId: cr2.regleId },
  }));
  assert.strictEqual(resR2.cree, true);
  assert.notStrictEqual(resR2.id, cascades1[0].id);
  w.c.executerDecisionCopilote_({ id: resR2.id, decision: 'ignorer' });
  w.c.executerRegleCopilote_({ mode: 'supprimer-auto', regleId: cr2.regleId });

  // Validation #1 -> Validations === 1, Statut === 'proposé'
  const ex1 = plain(w.c.executerDecisionCopilote_({ id: cascades1[0].id, decision: 'executer' }));
  assert.strictEqual(ex1.ok, true);
  assert.strictEqual(w.moves[0].dst, 'FICTIF_HYD_DIR');
  let ligRegle = plain(w.c.lireCartesCopilote_()).find((x) => x.id === cr.regleId);
  assert.strictEqual(ligRegle.validations, 1);
  assert.strictEqual(ligRegle.statut, 'proposé');

  // Validation #2
  w.sheets.Index.push(['drive|' + FH3, '2026-10-03', '2026-10-03_Facture_Hydro-Exemple.pdf', '02 · Finances', '02 · Finances/Autre', 'classé', '', '', FH3]);
  w.c.executerEtapeCopilote_(() => false);
  const cas2 = plain(w.c.lireCartesCopilote_()).find((x) => x.type === 'cascade' && x.statut === 'proposé');
  assert.ok(cas2 && JSON.parse(cas2.actionJson).regleId === cr.regleId);
  assert.strictEqual(w.c.executerDecisionCopilote_({ id: cas2.id, decision: 'executer' }).ok, true);
  ligRegle = plain(w.c.lireCartesCopilote_()).find((x) => x.id === cr.regleId);
  assert.strictEqual(ligRegle.validations, 2);
  assert.strictEqual(ligRegle.statut, 'proposé');

  // Validation #3 -> passage auto
  w.sheets.Index.push(['drive|' + FH4, '2026-10-04', '2026-10-04_Facture_Hydro-Exemple.pdf', '02 · Finances', '02 · Finances/Autre', 'classé', '', '', FH4]);
  w.c.executerEtapeCopilote_(() => false);
  const cas3 = plain(w.c.lireCartesCopilote_()).find((x) => x.type === 'cascade' && x.statut === 'proposé');
  assert.ok(cas3 && JSON.parse(cas3.actionJson).regleId === cr.regleId);
  assert.strictEqual(w.c.executerDecisionCopilote_({ id: cas3.id, decision: 'executer' }).ok, true);
  ligRegle = plain(w.c.lireCartesCopilote_()).find((x) => x.id === cr.regleId);
  assert.strictEqual(ligRegle.validations, 3);
  assert.strictEqual(ligRegle.statut, 'auto');
  assert.strictEqual(JSON.parse(ligRegle.actionJson).auto, true);
});

test('non-régression M9 Anomalie 2 : zéro repli sur racine domaine ou sous-dossier partiel, support multi-niveaux existant', () => {
  const TEL1 = 'FICTIF_TEST_TEL_00001';
  const w = ctxQR({
    folders: {
      FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'DriveAI', parents: [], files: [], folders: ['FICTIF_DOM02', 'FICTIF_VRAC'] },
      FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_EXISTANT'] },
      FICTIF_EXISTANT: { id: 'FICTIF_EXISTANT', name: 'Existant', parents: ['FICTIF_DOM02'], files: [], folders: ['FICTIF_SUBVALIDE'] },
      FICTIF_SUBVALIDE: { id: 'FICTIF_SUBVALIDE', name: 'SousDossierValide', parents: ['FICTIF_EXISTANT'], files: [], folders: [] },
      FICTIF_VRAC: { id: 'FICTIF_VRAC', name: '08 · Perso & projets', parents: ['FICTIF_ROOT'], files: [TEL1], folders: [] },
    },
    files: {
      [TEL1]: { id: TEL1, name: '2026-10-01_Facture_TelecomExemple.pdf', parents: ['FICTIF_VRAC'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|' + TEL1, '2026-10-01', '2026-10-01_Facture_TelecomExemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', TEL1],
      ],
    },
  });

  // 1. Sous-dossier inexistant à 1 niveau -> 0 déplacement, 0 carte cascade
  const r1 = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si facture TelecomExemple alors déplacer dans 02 · Finances/SousDossierInexistant' }));
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: r1.regleId }).auto, true);
  w.c.executerEtapeCopilote_(() => false);
  assert.strictEqual(w.moves.length, 0);
  assert.strictEqual(plain(w.c.lireCartesCopilote_()).filter((x) => x.type === 'cascade').length, 0);
  w.c.executerRegleCopilote_({ mode: 'supprimer-auto', regleId: r1.regleId });

  // 2. Chemin multi-niveaux partiellement inexistant -> parser préserve tout, 0 déplacement (ni Existant, ni racine)
  const parsedMulti = plain(w.c.parserPhraseRegle_('Si facture TelecomExemple alors déplacer dans 02 · Finances/Existant/SousDossierInexistant', ['02 · Finances'], ['Finances']));
  assert.ok(parsedMulti);
  assert.strictEqual(parsedMulti.cible, '02 · Finances/Existant/SousDossierInexistant');
  const r2 = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si facture TelecomExemple alors déplacer dans 02 · Finances/Existant/SousDossierInexistant' }));
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: r2.regleId }).auto, true);
  w.c.executerEtapeCopilote_(() => false);
  assert.strictEqual(w.moves.length, 0);
  w.c.executerRegleCopilote_({ mode: 'supprimer-auto', regleId: r2.regleId });

  // 3. Contrôle positif multi-niveaux existant -> déplacement vers la feuille cible
  const r3 = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si facture TelecomExemple alors déplacer dans 02 · Finances/Existant/SousDossierValide' }));
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: r3.regleId }).auto, true);
  w.c.executerEtapeCopilote_(() => false);
  assert.strictEqual(w.moves.length, 1);
  assert.strictEqual(w.moves[0].dst, 'FICTIF_SUBVALIDE');
});

test('non-régression M9-2 : domaines et sous-dossiers avec &, ponctuation finale et exécution Drive auto', () => {
  const doms = {
    '01 · Administratif & identité': 'FICTIF_DOM01',
    '02 · Finances': 'FICTIF_DOM02',
    '03 · Logement & véhicule': 'FICTIF_DOM03',
    '04 · Immigration': 'FICTIF_DOM04',
    '06 · Études & diplômes': 'FICTIF_DOM06',
    '08 · Perso & projets': 'FICTIF_DOM08',
  };
  const F_HYD = 'FICTIF_TEST_AMP_00001';
  const F_BNQ = 'FICTIF_TEST_AMP_00002';
  const w = ctxQR({
    domaines: doms,
    folders: {
      FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'DriveAI', parents: [], files: [], folders: ['FICTIF_DOM01', 'FICTIF_DOM02', 'FICTIF_DOM03', 'FICTIF_DOM06', 'FICTIF_DOM08'] },
      FICTIF_DOM01: { id: 'FICTIF_DOM01', name: '01 · Administratif & identité', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_IDENT'] },
      FICTIF_IDENT: { id: 'FICTIF_IDENT', name: 'Carte', parents: ['FICTIF_DOM01'], files: [], folders: [] },
      FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_BQ_AMP'] },
      FICTIF_BQ_AMP: { id: 'FICTIF_BQ_AMP', name: 'Banque & Crédit', parents: ['FICTIF_DOM02'], files: [], folders: ['FICTIF_RELEVES'] },
      FICTIF_RELEVES: { id: 'FICTIF_RELEVES', name: 'Relevés', parents: ['FICTIF_BQ_AMP'], files: [], folders: [] },
      FICTIF_DOM03: { id: 'FICTIF_DOM03', name: '03 · Logement & véhicule', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_ENERGIE'] },
      FICTIF_ENERGIE: { id: 'FICTIF_ENERGIE', name: 'Énergie', parents: ['FICTIF_DOM03'], files: [], folders: ['FICTIF_HYDRO_EX'] },
      FICTIF_HYDRO_EX: { id: 'FICTIF_HYDRO_EX', name: 'Hydro-Exemple', parents: ['FICTIF_ENERGIE'], files: [], folders: [] },
      FICTIF_DOM06: { id: 'FICTIF_DOM06', name: '06 · Études & diplômes', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_UNIV'] },
      FICTIF_UNIV: { id: 'FICTIF_UNIV', name: 'Attestations', parents: ['FICTIF_DOM06'], files: [], folders: [] },
      FICTIF_DOM08: { id: 'FICTIF_DOM08', name: '08 · Perso & projets', parents: ['FICTIF_ROOT'], files: [F_HYD, F_BNQ], folders: ['FICTIF_PROJ'] },
      FICTIF_PROJ: { id: 'FICTIF_PROJ', name: 'Notes', parents: ['FICTIF_DOM08'], files: [], folders: [] },
    },
    files: {
      [F_HYD]: { id: F_HYD, name: '2026-11-01_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_DOM08'], trashed: false },
      [F_BNQ]: { id: F_BNQ, name: '2026-11-02_Releve_BanqueExemple.pdf', parents: ['FICTIF_DOM08'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|' + F_HYD, '2026-11-01', '2026-11-01_Facture_Hydro-Exemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', F_HYD],
        ['drive|' + F_BNQ, '2026-11-02', '2026-11-02_Releve_BanqueExemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', F_BNQ],
      ],
    },
  });

  // Tous les 4 domaines officiels avec & + sous-dossier avec & + ponctuation finale
  const casParsing = [
    ['Si document carte alors ranger dans 01 · Administratif & identité/Carte.', '01 · Administratif & identité', '01 · Administratif & identité/Carte'],
    ['Si facture hydro alors classer dans 03 · Logement & véhicule/Énergie/Hydro-Exemple.', '03 · Logement & véhicule', '03 · Logement & véhicule/Énergie/Hydro-Exemple'],
    ['Si diplôme université alors ranger dans 06 · Études & diplômes/Attestations', '06 · Études & diplômes', '06 · Études & diplômes/Attestations'],
    ['Si carnet projet alors classer dans 08 · Perso & projets/Notes', '08 · Perso & projets', '08 · Perso & projets/Notes'],
    ['Si relevé banque alors classer dans 02 · Finances/Banque & Crédit/Relevés', '02 · Finances', '02 · Finances/Banque & Crédit/Relevés'],
  ];
  for (const [phrase, expDom, expCible] of casParsing) {
    const p = plain(w.c.parserPhraseRegle_(phrase, null, []));
    assert.ok(p, 'parsing attendu pour: ' + phrase);
    assert.strictEqual(p.domaine, expDom, phrase);
    assert.strictEqual(p.cible, expCible, phrase);
  }

  // Exécution réelle auto sur domaine avec & et sous-dossier avec &
  const rHyd = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si facture Hydro-Exemple alors classer dans 03 · Logement & véhicule/Énergie/Hydro-Exemple' }));
  assert.strictEqual(rHyd.ok, true);
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: rHyd.regleId }).auto, true);

  const rBnq = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si releve banqueexemple alors classer dans 02 · Finances/Banque & Crédit/Relevés' }));
  assert.strictEqual(rBnq.ok, true);
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: rBnq.regleId }).auto, true);

  const exec = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(exec.traitees, 2);
  assert.strictEqual(w.moves.length, 2);
  assert.strictEqual(w.moves.find((m) => m.fid === F_HYD).dst, 'FICTIF_HYDRO_EX');
  assert.strictEqual(w.moves.find((m) => m.fid === F_BNQ).dst, 'FICTIF_RELEVES');
});

test('non-régression M9-2 : chemins > 50 car. et ~130 car., ActionJson <= 500 valide après 3 validations sans perdre cible ni si.mots', () => {
  const w = ctxQR({
    domaines: {
      '02 · Finances': 'FICTIF_DOM02',
      '03 · Logement & véhicule': 'FICTIF_DOM03',
      '04 · Immigration': 'FICTIF_DOM04',
    },
  });

  // Chemin > 50 caractères sans troncature
  const cible50 = '02 · Finances/Banque Exemple Du Canada/Releves Mensuels Detailles';
  const p50 = plain(w.c.parserPhraseRegle_('Si releve mensuel alors classer dans ' + cible50, null, []));
  assert.ok(p50);
  assert.strictEqual(p50.domaine, '02 · Finances');
  assert.strictEqual(p50.cible, cible50);

  // Chemin long (~130 caractères) via executerRegleCopilote_ + 3 validations
  const cibleLongue = '03 · Logement & véhicule/Service Exemple Electricite Eau Gaz Chauffage/Contrats Et Factures Mensuelles Detailles Archivees 2026';
  assert.ok(cibleLongue.length >= 125 && cibleLongue.length <= 140, 'longueur cible ~130 car.');
  const phraseLongue = 'Si facture electricite chauffage gaz eau alors ranger dans ' + cibleLongue;
  assert.ok(phraseLongue.length <= 240);

  const cr = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: phraseLongue }));
  assert.strictEqual(cr.ok, true);
  let rowRegle = w.sheets.Copilote.find((r) => r[0] === cr.regleId);
  assert.ok(rowRegle);
  assert.strictEqual(rowRegle[4], '03 · Logement & véhicule');
  assert.strictEqual(rowRegle[5], cibleLongue);
  assert.ok(String(rowRegle[7]).length <= 500, 'ActionJson initial <= 500');
  const parsedInit = JSON.parse(rowRegle[7]);
  assert.strictEqual(parsedInit.domaine, '03 · Logement & véhicule');
  assert.strictEqual(parsedInit.cible, cibleLongue);
  assert.deepStrictEqual(parsedInit.si.mots, ['facture', 'electricite', 'chauffage', 'gaz', 'eau']);

  // 3 validations via executerDecisionCopilote_ (Copilote.gs appelle serialiserActionCopilote_)
  for (let i = 0; i < 3; i++) {
    const resV = plain(w.c.executerDecisionCopilote_({ id: cr.regleId, decision: 'executer' }));
    assert.strictEqual(resV.ok, true);
  }
  rowRegle = w.sheets.Copilote.find((r) => r[0] === cr.regleId);
  assert.strictEqual(rowRegle[8], 'auto');
  assert.strictEqual(rowRegle[9], 3);
  assert.ok(String(rowRegle[7]).length <= 500, 'ActionJson après 3 validations <= 500');
  const parsedApres = JSON.parse(rowRegle[7]);
  assert.strictEqual(parsedApres.auto, true);
  assert.strictEqual(parsedApres.validations, 3);
  assert.strictEqual(parsedApres.domaine, '03 · Logement & véhicule');
  assert.strictEqual(parsedApres.cible, cibleLongue);
  assert.deepStrictEqual(parsedApres.si.mots, ['facture', 'electricite', 'chauffage', 'gaz', 'eau']);

  // Compactage serialiserRegleAction_ sur cible très longue (~190 car.) : reste <= 492 car., garde cible/domaine/si.mots
  const cibleTresLongue = '03 · Logement & véhicule/Service Exemple Electricite Eau Gaz Chauffage Climatisation Isolation/Contrats Et Factures Mensuelles Detailles Archivees 2026 Et Garages Annexes';
  const phraseTresLongue = 'Si facture electricite chauffage gaz alors ranger dans ' + cibleTresLongue;
  assert.ok(phraseTresLongue.length <= 240);
  const pTL = plain(w.c.parserPhraseRegle_(phraseTresLongue, null, []));
  assert.ok(pTL && pTL.cible === cibleTresLongue);
  const sTL = w.c.serialiserRegleAction_(pTL);
  assert.ok(sTL.length <= 492, 'ActionJson compacté <= 492 car. (observé: ' + sTL.length + ')');
  const oTL = JSON.parse(sTL);
  assert.strictEqual(oTL.domaine, '03 · Logement & véhicule');
  assert.strictEqual(oTL.cible, cibleTresLongue);
  assert.deepStrictEqual(oTL.si.mots, ['facture', 'electricite', 'chauffage', 'gaz']);
});

test('non-régression M9-2 : CONFIG.DOMAINES_AUTO (07 · Santé, 09 · Voyages), zéro création si absent/corbeillé et protections 04/Anna/Packs', () => {
  const F_SANTE = 'FICTIF_TEST_SANTE_00001';
  const F_VOY = 'FICTIF_TEST_VOY_00001';
  const F_ABS = 'FICTIF_TEST_ABS_00001';
  let creationAppelee = false;

  const folders = {
    FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'DriveAI', parents: [], files: [], folders: ['FICTIF_DOM02', 'FICTIF_DOM07', 'FICTIF_DOM09'] },
    FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [F_SANTE, F_VOY, F_ABS], folders: [] },
    FICTIF_DOM07: { id: 'FICTIF_DOM07', name: '07 · Santé', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_PHARMA'] },
    FICTIF_PHARMA: { id: 'FICTIF_PHARMA', name: 'Pharmacie', parents: ['FICTIF_DOM07'], files: [], folders: [] },
    FICTIF_DOM09: { id: 'FICTIF_DOM09', name: '09 · Voyages', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_VOLS', 'FICTIF_ASSUR_S'] },
    FICTIF_VOLS: { id: 'FICTIF_VOLS', name: 'Vols', parents: ['FICTIF_DOM09'], files: [], folders: [] },
    FICTIF_ASSUR_S: { id: 'FICTIF_ASSUR_S', name: 'Assurance santé', parents: ['FICTIF_DOM09'], files: [], folders: [] },
  };
  const w = ctxQR({
    props: {
      'DriveAI_DOM_07 · Santé': 'FICTIF_DOM07',
      'DriveAI_DOM_09 · Voyages': 'FICTIF_DOM09',
    },
    folders,
    files: {
      [F_SANTE]: { id: F_SANTE, name: '2026-11-01_Recu_Pharmacie_Exemple.pdf', parents: ['FICTIF_DOM02'], trashed: false },
      [F_VOY]: { id: F_VOY, name: '2026-11-02_Billet_Vols_Exemple.pdf', parents: ['FICTIF_DOM02'], trashed: false },
      [F_ABS]: { id: F_ABS, name: '2026-11-03_Assurance_Sante_Voyage.pdf', parents: ['FICTIF_DOM02'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|' + F_SANTE, '2026-11-01', '2026-11-01_Recu_Pharmacie_Exemple.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', F_SANTE],
        ['drive|' + F_VOY, '2026-11-02', '2026-11-02_Billet_Vols_Exemple.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', F_VOY],
        ['drive|' + F_ABS, '2026-11-03', '2026-11-03_Assurance_Sante_Voyage.pdf', '02 · Finances', '02 · Finances', 'classé', '', '', F_ABS],
      ],
    },
  });
  w.c.DriveApp.createFolder = () => { creationAppelee = true; throw new Error('createFolder interdit'); };
  w.c.dossierDomaineAuto_ = () => { creationAppelee = true; throw new Error('dossierDomaineAuto_ interdit'); };

  // Parsing : 07 · Santé/Pharmacie, 09 · Voyages/Vols, et 09 · Voyages/Assurance santé (pas capturé par 07 · Santé !)
  const pSante = plain(w.c.parserPhraseRegle_('Si recu pharmacie alors classer dans 07 · Santé/Pharmacie', null, []));
  assert.ok(pSante);
  assert.strictEqual(pSante.domaine, '07 · Santé');
  assert.strictEqual(pSante.cible, '07 · Santé/Pharmacie');

  const pVols = plain(w.c.parserPhraseRegle_('Si billet vol alors classer dans 09 · Voyages/Vols', null, []));
  assert.ok(pVols);
  assert.strictEqual(pVols.domaine, '09 · Voyages');
  assert.strictEqual(pVols.cible, '09 · Voyages/Vols');

  const pAssurFull = plain(w.c.parserPhraseRegle_('Si assurance voyage alors classer dans 09 · Voyages/Assurance santé', null, []));
  assert.ok(pAssurFull);
  assert.strictEqual(pAssurFull.domaine, '09 · Voyages');
  assert.strictEqual(pAssurFull.cible, '09 · Voyages/Assurance santé');

  const pAssurCourt = plain(w.c.parserPhraseRegle_('Si assurance voyage alors classer dans Voyages/Assurance santé', null, []));
  assert.ok(pAssurCourt);
  assert.strictEqual(pAssurCourt.domaine, '09 · Voyages');
  assert.strictEqual(pAssurCourt.cible, '09 · Voyages/Assurance santé');

  // Exécution Drive réelle avec PropertiesService (DriveAI_DOM_*)
  const rS = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si recu pharmacie alors classer dans 07 · Santé/Pharmacie' }));
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: rS.regleId }).auto, true);
  const rV = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si billet vols alors classer dans 09 · Voyages/Vols' }));
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: rV.regleId }).auto, true);

  const resOk = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(resOk.traitees, 2);
  assert.strictEqual(w.moves.find((m) => m.fid === F_SANTE).dst, 'FICTIF_PHARMA');
  assert.strictEqual(w.moves.find((m) => m.fid === F_VOY).dst, 'FICTIF_VOLS');
  assert.strictEqual(creationAppelee, false);

  // Cas Property absente ou dossier racine corbeillé : zéro déplacement, zéro création de dossier
  w.c.executerRegleCopilote_({ mode: 'supprimer-auto', regleId: rS.regleId });
  w.c.executerRegleCopilote_({ mode: 'supprimer-auto', regleId: rV.regleId });
  delete w.props['DriveAI_DOM_07 · Santé'];
  const rAbs = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si assurance voyage alors classer dans 07 · Santé/Pharmacie' }));
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: rAbs.regleId }).auto, true);
  const resAbs = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(resAbs.traitees, 0);
  assert.strictEqual(creationAppelee, false);
  w.c.executerRegleCopilote_({ mode: 'supprimer-auto', regleId: rAbs.regleId });

  // Cas dossier racine DOMAINES_AUTO corbeillé (chemCib === dom et sous-dossier)
  folders.FICTIF_DOM09.trashed = true;
  const rCorb = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si assurance voyage alors classer dans 09 · Voyages' }));
  assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: rCorb.regleId }).auto, true);
  const resCorb = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(resCorb.traitees, 0);
  assert.strictEqual(creationAppelee, false);

  // Cas positif chemCib === dom (racine DOMAINES_AUTO vivante)
  folders.FICTIF_DOM09.trashed = false;
  const resRac = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(resRac.traitees, 1);
  assert.strictEqual(w.moves.find((m) => m.fid === F_ABS).dst, 'FICTIF_DOM09');

  // Vérifications négatives continues sur 04 · Immigration, Anna, 00 · Packs, _Technique (y compris sous-chemins DOMAINES_AUTO)
  for (const interdit of [
    'Si passeport alors déplacer dans 04 · Immigration',
    'Si recu alors ranger dans Anna',
    'Si recu alors ranger dans 07 · Santé/Anna',
    'Si visa alors classer dans 09 · Voyages/04 · Immigration',
    'Si document alors classer dans 00 · Packs',
    'Si log alors déplacer dans _Technique',
  ]) {
    assert.strictEqual(w.c.parserPhraseRegle_(interdit, null, []), null, 'rejet parsing: ' + interdit);
    assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'creer', phrase: interdit }).ok, false, 'rejet création: ' + interdit);
  }
});

test("non-régression M9-2 (r2) : élisions l'archiver/l'étiqueter, apostrophes/ligatures, préfixes dossier et amorce mCib[1]", () => {
  const doms = {
    '01 · Administratif & identité': 'FICTIF_DOM01',
    '02 · Finances': 'FICTIF_DOM02',
    '08 · Perso & projets': 'FICTIF_DOM08',
  };
  const F_HYD = 'FICTIF_TEST_R2_00001';
  const F_CARTE = 'FICTIF_TEST_R2_00002';
  const F_COEUR = 'FICTIF_TEST_R2_00003';
  const F_CAT = 'FICTIF_TEST_R2_00004';
  const w = ctxQR({
    domaines: doms,
    folders: {
      FICTIF_ROOT: { id: 'FICTIF_ROOT', name: 'DriveAI', parents: [], files: [], folders: ['FICTIF_DOM01', 'FICTIF_DOM02', 'FICTIF_DOM08'] },
      FICTIF_DOM01: { id: 'FICTIF_DOM01', name: '01 · Administratif & identité', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_CARTE'] },
      FICTIF_CARTE: { id: 'FICTIF_CARTE', name: "Carte d'identité", parents: ['FICTIF_DOM01'], files: [], folders: [] },
      FICTIF_DOM02: { id: 'FICTIF_DOM02', name: '02 · Finances', parents: ['FICTIF_ROOT'], files: [], folders: ['FICTIF_HYD', 'FICTIF_CAT_EN'] },
      FICTIF_HYD: { id: 'FICTIF_HYD', name: 'Hydro-Exemple', parents: ['FICTIF_DOM02'], files: [], folders: [] },
      FICTIF_CAT_EN: { id: 'FICTIF_CAT_EN', name: 'Categorie Energie', parents: ['FICTIF_DOM02'], files: [], folders: [] },
      FICTIF_DOM08: { id: 'FICTIF_DOM08', name: '08 · Perso & projets', parents: ['FICTIF_ROOT'], files: [F_HYD, F_CARTE, F_COEUR, F_CAT], folders: ['FICTIF_COEUR'] },
      FICTIF_COEUR: { id: 'FICTIF_COEUR', name: 'Cœur & Santé', parents: ['FICTIF_DOM08'], files: [], folders: [] },
    },
    files: {
      [F_HYD]: { id: F_HYD, name: '2026-11-01_Facture_Hydro-Exemple.pdf', parents: ['FICTIF_DOM08'], trashed: false },
      [F_CARTE]: { id: F_CARTE, name: '2026-11-02_Carte_Identite_Exemple.pdf', parents: ['FICTIF_DOM08'], trashed: false },
      [F_COEUR]: { id: F_COEUR, name: '2026-11-03_Bilan_Coeur_Exemple.pdf', parents: ['FICTIF_DOM08'], trashed: false },
      [F_CAT]: { id: F_CAT, name: '2026-11-04_Compteur_Energie_Exemple.pdf', parents: ['FICTIF_DOM08'], trashed: false },
    },
    sheets: {
      Index: [
        ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
        ['drive|' + F_HYD, '2026-11-01', '2026-11-01_Facture_Hydro-Exemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', F_HYD],
        ['drive|' + F_CARTE, '2026-11-02', '2026-11-02_Carte_Identite_Exemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', F_CARTE],
        ['drive|' + F_COEUR, '2026-11-03', '2026-11-03_Bilan_Coeur_Exemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', F_COEUR],
        ['drive|' + F_CAT, '2026-11-04', '2026-11-04_Compteur_Energie_Exemple.pdf', '08 · Perso & projets', '08 · Perso & projets', 'classé', '', '', F_CAT],
      ],
    },
  });

  // 1. Clauses élidées l'archiver / l'étiqueter
  const pArch = plain(w.c.parserPhraseRegle_("Si facture hydro alors classer dans 02 · Finances/Hydro-Exemple et l'archiver", null, ['Finances']));
  assert.ok(pArch);
  assert.strictEqual(pArch.cible, '02 · Finances/Hydro-Exemple');
  assert.strictEqual(pArch.alors.archiver, true);

  const pEtiq = plain(w.c.parserPhraseRegle_("Si facture hydro alors classer dans 02 · Finances/Hydro-Exemple et l'étiqueter Finances", null, ['Finances']));
  assert.ok(pEtiq);
  assert.strictEqual(pEtiq.cible, '02 · Finances/Hydro-Exemple');
  assert.strictEqual(pEtiq.alors.libelle, 'Finances');

  // 2. Apostrophes & ligatures françaises + préfixes "dans le dossier ..." / "dans dossier ..."
  const pCarte = plain(w.c.parserPhraseRegle_("Si carte identite alors classer dans 01 · Administratif & identité/Carte d'identité", null, []));
  assert.strictEqual(pCarte.cible, "01 · Administratif & identité/Carte d'identité");

  const pCoeur = plain(w.c.parserPhraseRegle_('Si bilan coeur alors classer dans 08 · Perso & projets/Cœur & Santé', null, []));
  assert.strictEqual(pCoeur.cible, '08 · Perso & projets/Cœur & Santé');

  const pPrefLe = plain(w.c.parserPhraseRegle_('Si facture hydro alors mettre dans le dossier 02 · Finances/Hydro-Exemple', null, []));
  assert.strictEqual(pPrefLe.cible, '02 · Finances/Hydro-Exemple');

  const pPrefNu = plain(w.c.parserPhraseRegle_('Si facture hydro alors ranger dans dossier 02 · Finances/Hydro-Exemple', null, []));
  assert.strictEqual(pPrefNu.cible, '02 · Finances/Hydro-Exemple');

  // 3. Cas combinés sans polluer alors.libelle (mCib[1] uniquement)
  const pCat = plain(w.c.parserPhraseRegle_('Si compteur energie alors classer dans 02 · Finances/Categorie Energie', null, []));
  assert.strictEqual(pCat.cible, '02 · Finances/Categorie Energie');
  assert.strictEqual(pCat.alors.libelle, 'Finances');

  const pLibInconnu = plain(w.c.parserPhraseRegle_('Si facture hydro alors ranger dans 02 · Finances/Banque & Crédit/Relevés et libeller NouveauLibelle', null, []));
  assert.strictEqual(pLibInconnu.cible, '02 · Finances/Banque & Crédit/Relevés');
  assert.strictEqual(pLibInconnu.alors.libelle, 'Finances');

  // 4. Exécution réelle auto sur l'archiver, Carte d'identité, Cœur & Santé et Categorie Energie
  for (const ph of [
    "Si facture hydro alors classer dans 02 · Finances/Hydro-Exemple et l'archiver",
    "Si carte identite alors classer dans 01 · Administratif & identité/Carte d'identité",
    'Si bilan coeur alors classer dans 08 · Perso & projets/Cœur & Santé',
    'Si compteur energie alors classer dans 02 · Finances/Categorie Energie',
  ]) {
    const cr = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: ph }));
    assert.strictEqual(cr.ok, true, ph);
    assert.strictEqual(w.c.executerRegleCopilote_({ mode: 'basculer-auto', regleId: cr.regleId }).auto, true, ph);
  }
  const res = plain(w.c.appliquerReglesDriveCopilote_(w.sheets.Index.slice(1), () => false, 10));
  assert.strictEqual(res.traitees, 4);
  assert.strictEqual(w.moves.find((m) => m.fid === F_HYD).dst, 'FICTIF_HYD');
  assert.strictEqual(w.moves.find((m) => m.fid === F_CARTE).dst, 'FICTIF_CARTE');
  assert.strictEqual(w.moves.find((m) => m.fid === F_COEUR).dst, 'FICTIF_COEUR');
  assert.strictEqual(w.moves.find((m) => m.fid === F_CAT).dst, 'FICTIF_CAT_EN');
});

test("non-régression M9-2 (r2) : cas extrême 236 car. compacté <= 492 sans repli '{}' et garde négative sur executerRegleCopilote_", () => {
  const w = ctxQR({
    domaines: {
      '03 · Logement & véhicule': 'FICTIF_DOM03',
      '04 · Immigration': 'FICTIF_DOM04',
    },
  });
  const cible175 = '03 · Logement & véhicule/' + 'Abcdefghij'.repeat(15);
  const phrase236 = 'Si hydro factures@exemple-long.test, dans ' + cible175 + ' important archiver';
  assert.strictEqual(cible175.length, 175);
  assert.strictEqual(phrase236.length, 236);

  const parsed = plain(w.c.parserPhraseRegle_(phrase236, null, ['Logement']));
  assert.ok(parsed);
  assert.strictEqual(parsed.domaine, '03 · Logement & véhicule');
  assert.strictEqual(parsed.cible, cible175);
  assert.strictEqual(parsed.si.exp, 'factures@exemple-long.test');
  assert.strictEqual(parsed.alors.important, true);
  assert.strictEqual(parsed.alors.archiver, true);

  const ser = w.c.serialiserRegleAction_(parsed);
  assert.notStrictEqual(ser, '{}');
  assert.ok(ser.length <= 492, 'ActionJson <= 492 car. (observé: ' + ser.length + ')');
  const oSer = JSON.parse(ser);
  assert.ok(String(oSer.cle || '').startsWith('regle|'));
  assert.strictEqual(oSer.domaine, '03 · Logement & véhicule');
  assert.strictEqual(oSer.cible, cible175);
  assert.strictEqual(oSer.si.exp, 'factures@exemple-long.test');
  assert.deepStrictEqual(oSer.si.mots, ['hydro', 'factures', 'exemple', 'long', 'test']);
  assert.strictEqual(oSer.alors.important, true);
  assert.strictEqual(oSer.alors.archiver, true);

  // Persistance via executerRegleCopilote_ + déduplication au 2e appel + 3 validations
  const cr = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: phrase236 }));
  assert.strictEqual(cr.ok, true);
  const row = w.sheets.Copilote.find((r) => r[0] === cr.regleId);
  assert.ok(row && row[7] !== '{}' && row[7].length <= 492);
  const crDup = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: phrase236 }));
  assert.strictEqual(crDup.ok, true);
  assert.strictEqual(crDup.regleId, cr.regleId);
  assert.strictEqual(w.sheets.Copilote.length, 2);

  for (let i = 0; i < 3; i++) assert.ok(w.c.incrementerValidationRegle_(cr.regleId));
  const rowAuto = w.sheets.Copilote.find((r) => r[0] === cr.regleId);
  assert.strictEqual(rowAuto[8], 'auto');
  assert.ok(rowAuto[7] !== '{}' && rowAuto[7].length <= 500);
  const oAuto = JSON.parse(rowAuto[7]);
  assert.strictEqual(oAuto.cible, cible175);
  assert.strictEqual(oAuto.si.exp, 'factures@exemple-long.test');
  assert.deepStrictEqual(oAuto.si.mots, ['hydro', 'factures', 'exemple', 'long', 'test']);

  // Garde négative : si serialiserRegleAction_ retournait '{}', executerRegleCopilote_ refuse proprement
  const nbAvant = w.sheets.Copilote.length;
  w.c.serialiserRegleAction_ = () => '{}';
  const ref = plain(w.c.executerRegleCopilote_({ mode: 'creer', phrase: 'Si facture exemple alors classer dans 03 · Logement & véhicule/Autre' }));
  assert.strictEqual(ref.ok, false);
  assert.strictEqual(ref.regleId, '');
  assert.strictEqual(ref.auto, false);
  assert.ok(ref.erreur);
  assert.strictEqual(w.sheets.Copilote.length, nbAvant);
});
