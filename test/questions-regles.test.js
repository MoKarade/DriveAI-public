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
  const c = load(['Config.gs', 'Cout.gs', 'Suivi.gs', 'Journal.gs', 'Actions.gs', 'Signaux.gs', 'PacksChecklists.gs', 'Copilote.gs', 'QuestionsRegles.gs']);
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
