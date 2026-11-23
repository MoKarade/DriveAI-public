'use strict';
/**
 * C28-19 (ADR-0020) — curation des mails :
 *  - `decisionSuspect_` PURE : la Confiance outrepasse heuristique + LLM + libellé ⚠ déjà posé ;
 *    sans confiance, la règle 2026-07-07 est INCHANGÉE (non-régression).
 *  - `confianceCache_`/`apprendreConfiance_` : adresse nue minuscule, dédupliquée.
 *  - `scanCycliqueTri_` : offset persistant qui avance par PAGE COMPLÈTE, repart à 0 en fin de
 *    fenêtre, borné à TRI_CYCLIQUE_PAGES_PAR_RUN pages/tick (dérivé de la CONSTANTE) ; une page
 *    interrompue ne bouge pas l'offset (rejeu gratuit).
 *  - `appliquerPasSuspect_` : consommation ADDITIVE de la Property (purge Index + re-tri par fil,
 *    reste re-présenté après coupure/attente, jamais perdu).
 *  - `purgerClesTriIndex_` : ne purge QUE les clés `tri|<id>|…`, ordre décroissant, cache invalidé.
 *  - Tripwires : les prompts intentions/mini-check portent bien l'élargissement « facture à payer ».
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

/* ---------- decisionSuspect_ (PURE) ---------- */

const ctxPur = load(['Config.gs', 'TriGmail.gs']);

test('decisionSuspect_ : matrice — confiance > tout ; règle 2026-07-07 inchangée sans confiance', () => {
  const d = ctxPur.decisionSuspect_;
  const base = { deConfiance: false, heuristique: false, llm: false, estMoi: false, appris: false, cheminDangereux: false, dejaPoseSuspect: false };
  assert.strictEqual(d(base), false);
  assert.strictEqual(d({ ...base, heuristique: true }), true);
  assert.strictEqual(d({ ...base, llm: true }), true);
  assert.strictEqual(d({ ...base, llm: true, estMoi: true }), false, 'on ne se phishe pas soi-même');
  assert.strictEqual(d({ ...base, llm: true, appris: true }), false, 'expéditeur appris : signal LLM ignoré');
  assert.strictEqual(d({ ...base, llm: true, appris: true, cheminDangereux: true }), true, 'sauf chemin dangereux');
  assert.strictEqual(d({ ...base, dejaPoseSuspect: true }), true, '⚠ déjà posé conservé par défaut');
  // La CONFIANCE (clic de Marc) outrepasse chacun des trois signaux, y compris combinés.
  assert.strictEqual(d({ ...base, deConfiance: true, heuristique: true, llm: true, dejaPoseSuspect: true }), false);
});

/* ---------- confiance : cache + apprentissage dédupliqué ---------- */

function ctxConfiance(lignes) {
  const c = load(['Config.gs', 'TriGmail.gs']);
  const ajouts = [];
  c.feuille_ = (nom) => {
    assert.strictEqual(nom, 'Confiance');
    return {
      getLastRow: () => lignes.length + 1,
      getRange: (l, col, n, cols) => ({ getValues: () => lignes.map((a) => [a]) }),
      appendRow: (r) => ajouts.push(r),
    };
  };
  return { c, ajouts };
}

test('confianceCache_/apprendreConfiance_ : minuscules, dédup (cache + onglet), 1 lecture par run', () => {
  const { c, ajouts } = ctxConfiance(['no-reply@google.com']);
  assert.strictEqual(c.confianceCache_()['no-reply@google.com'], true);
  c.apprendreConfiance_('No-Reply@Google.com'); // déjà connue (casse ignorée) → aucune écriture
  assert.strictEqual(ajouts.length, 0);
  c.apprendreConfiance_('Notification@Bellerives.com');
  assert.strictEqual(ajouts.length, 1);
  assert.strictEqual(ajouts[0][0], 'notification@bellerives.com');
  c.apprendreConfiance_('notification@bellerives.com'); // double clic → toujours 1 ligne
  assert.strictEqual(ajouts.length, 1);
});

/* ---------- scanCycliqueTri_ ---------- */

function ctxCyclique(opts) {
  const c = load(['Config.gs', 'TriGmail.gs']);
  const props = Object.assign({}, opts.props);
  const recherches = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.GmailApp = { search: (req, offset, n) => { recherches.push(offset); return opts.pages(offset, n); } };
  c.signalerPanneGmail_ = () => false;
  c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = () => {};
  c.trierFil_ = opts.trierFil || (() => 'deja');
  c.dateGmail_ = () => opts.jour || '2026/07/13'; // Gmail.gs non chargé — le « jour » est piloté par le test
  return { c, props, recherches };
}

test('scanCycliqueTri_ : borné à TRI_CYCLIQUE_PAGES_PAR_RUN pages/tick, offset avancé par page complète', () => {
  const fil = (id) => ({ getId: () => id });
  const { c, props, recherches } = ctxCyclique({
    props: {},
    pages: (offset, n) => Array.from({ length: n }, (_, i) => fil('f' + (offset + i))),
  });
  const PAGES = c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN; // dérivé de la CONSTANTE, jamais de sa valeur
  const PAGE = c.CONFIG.PAGE_FILS_ACTIONS;
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(recherches.length, PAGES, 'jamais plus de pages que la constante (quota partagé)');
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, String(PAGES * PAGE));
});

test('scanCycliqueTri_ : fin de fenêtre (page vide) → offset remis à 0 (le tour repart du haut)', () => {
  const { c, props } = ctxCyclique({ props: { DriveAI_TRI_CYCLIQUE_OFFSET: '120' }, pages: () => [] });
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '0');
});

test('scanCycliqueTri_ : page interrompue par le plafond → offset INCHANGÉ (rejeu gratuit au tick suivant)', () => {
  const etat = { traites: 0, attentes: 0 };
  const { c, props } = ctxCyclique({
    props: { DriveAI_TRI_CYCLIQUE_OFFSET: '40' },
    pages: (offset, n) => Array.from({ length: n }, (_, i) => ({ getId: () => 'f' + (offset + i) })),
    trierFil: () => 'traite', // le scan compte lui-même etat.traites
  });
  c.scanCycliqueTri_(etat, () => etat.traites >= 3, [], {}); // plafond au 3ᵉ fil, page de 20
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '40', 'page incomplète → offset figé');
  assert.strictEqual(etat.traites, 3);
  // C28-21 : les fils LUS comptent au plafond quotidien MÊME sur page interrompue — le rejeu
  // re-lira ces fils, le coût de LECTURE est consommé, page complétée ou non. 3 lus : le plafond
  // du run coupe AVANT la lecture du 4ᵉ (jamais un fil lu « pour rien » de ce côté-là).
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_FILS_JOUR, '3');
});

/* ---------- C28-21 : plafond QUOTIDIEN de lectures du cyclique ---------- */

test('scanCycliqueTri_ : plafond quotidien ATTEINT → retour immédiat SANS GmailApp.search', () => {
  const MAX = load(['Config.gs']).CONFIG.TRI_FOND_MAX_FILS_JOUR; // dérivé de la CONSTANTE (plafond COMMUN, ADR-0076)
  const { c, recherches } = ctxCyclique({
    jour: '2026/07/13',
    props: { DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/13', DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(MAX) },
    pages: () => { throw new Error('aucune recherche ne doit partir au plafond'); },
  });
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(recherches.length, 0, 'plafond du jour atteint = zéro appel Gmail');
});

test('scanCycliqueTri_ : page RÉTRÉCIE au reliquat (complétable → offset avance) ; compteur remis à zéro le lendemain', () => {
  const c0 = load(['Config.gs']);
  const MAX = c0.CONFIG.TRI_FOND_MAX_FILS_JOUR;
  const PAGE = c0.CONFIG.PAGE_FILS_ACTIONS;
  const tailles = [];
  // Reliquat du jour = 3 (< PAGE) → la recherche demande 3 fils, la page se COMPLÈTE : jamais un
  // rejeu en boucle qui re-lirait la même page à chaque tick sans avancer.
  const { c, props } = ctxCyclique({
    jour: '2026/07/13',
    props: { DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/13', DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(MAX - 3), DriveAI_TRI_CYCLIQUE_OFFSET: '60' },
    pages: (offset, n) => { tailles.push(n); return Array.from({ length: n }, (_, i) => ({ getId: () => 'f' + i })); },
  });
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.ok(tailles[0] === 3 && tailles[0] < PAGE, 'page bornée au reliquat du jour');
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '63', 'page complète → offset avance');
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_FILS_JOUR, String(MAX), 'cumul du jour');
  // Lendemain : la Property JOUR ne matche plus → compteur reparti de zéro, pleine page de nouveau.
  const lendemain = ctxCyclique({
    jour: '2026/07/14',
    props: { DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/13', DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(MAX) },
    pages: (offset, n) => { tailles.push(n); return []; },
  });
  lendemain.c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(tailles[1], Math.min(PAGE, MAX), 'nouveau jour → plafond re-ouvert');
});

/* ---------- appliquerPasSuspect_ ---------- */

function ctxPasSuspect(opts) {
  const c = load(['Config.gs', 'TriGmail.gs']);
  const props = Object.assign({}, opts.props);
  const purges = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    getProperties: () => ({ ...props }), // consommation du format par clé (revue C28-24)
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.purgerClesTriIndex_ = (id) => { purges.push(id); return 2; };
  c.GmailApp = { getThreadById: (id) => (opts.filInconnu ? null : { getId: () => id }) };
  c.signalerPanneGmail_ = () => false;
  c.journalErreur_ = () => {};
  c.trierFil_ = opts.trierFil || (() => 'traite');
  return { c, props, purges };
}

test('appliquerPasSuspect_ : clés PAR FIL servies puis purgées ; l\'ANCIENNE liste JSON est consommée en compat', () => {
  const { c, props, purges } = ctxPasSuspect({ props: {
    'DriveAI_PAS_SUSPECT|fA': '1',                    // nouveau format (doPost atomique)
    DriveAI_PAS_SUSPECT: JSON.stringify(['fB', 'fA']), // héritage (fA en double → dédupliqué)
  } });
  const etat = { traites: 0, attentes: 0 };
  c.appliquerPasSuspect_(etat, () => false, [], {});
  assert.deepStrictEqual(purges.sort(), ['fA', 'fB'], 'dédupliqué entre les deux formats');
  assert.strictEqual(etat.traites, 2);
  assert.ok(!('DriveAI_PAS_SUSPECT' in props), 'liste héritée soldée');
  assert.ok(!('DriveAI_PAS_SUSPECT|fA' in props), 'clé par fil servie → purgée');
});

test('appliquerPasSuspect_ : coupure (plafond) et « attend » → le RESTE survit en clés PAR FIL pour le tick suivant', () => {
  const etat = { traites: 0, attentes: 0 };
  const { c, props } = ctxPasSuspect({
    props: { DriveAI_PAS_SUSPECT: JSON.stringify(['fA', 'fB', 'fC']) },
    trierFil: (fil) => (fil.getId() === 'fA' ? 'attend' : 'traite'),
  });
  c.appliquerPasSuspect_(etat, () => etat.traites >= 1, [], {}); // plafond après le 1ᵉʳ traité (fB)
  assert.ok(!('DriveAI_PAS_SUSPECT' in props), 'liste héritée convertie au format par fil');
  assert.strictEqual(props['DriveAI_PAS_SUSPECT|fA'], '1', '« attend » (fA) re-présenté');
  assert.strictEqual(props['DriveAI_PAS_SUSPECT|fC'], '1', 'non-atteint (fC) re-présenté');
  assert.ok(!('DriveAI_PAS_SUSPECT|fB' in props), 'servi (fB) → purgé');
});

test('appliquerPasSuspect_ : Property corrompue → purgée, jamais une boucle d\'erreurs par tick', () => {
  const { c, props } = ctxPasSuspect({ props: { DriveAI_PAS_SUSPECT: '{pas du json' } });
  c.appliquerPasSuspect_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.ok(!('DriveAI_PAS_SUSPECT' in props));
});

/* ---------- purgerClesTriIndex_ (Journal.gs) ---------- */

test('purgerClesTriIndex_ : ne purge QUE tri|<id>|…, ordre décroissant, cache du run invalidé', () => {
  const c = load(['Config.gs', 'Journal.gs']);
  const lignes = [['tri|fA|1|lu'], ['drive|fA'], ['tri|fAB|2|lu'], ['tri|fA|2|nonlu'], ['intention|fA']];
  const supprimees = [];
  c.feuille_ = () => ({
    getLastRow: () => lignes.length + 1,
    getRange: () => ({ getValues: () => lignes }),
    deleteRow: (n) => supprimees.push(n),
  });
  c._indexCache = { 'tri|fA|1|lu': true, 'tri|fA|2|nonlu': true, 'drive|fA': true };
  const n = c.purgerClesTriIndex_('fA');
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(supprimees, [5, 2], 'décroissant (pas de décalage) ; fAB/drive|/intention| intacts');
  assert.ok(!('tri|fA|1|lu' in c._indexCache) && !('tri|fA|2|nonlu' in c._indexCache));
  assert.ok(c._indexCache['drive|fA'], 'les clés documentaires ne sont JAMAIS touchées');
});

test('F8 — scanCycliqueTri_ : file mouvante — l\'offset n\'avance que des fils RESTÉS en boîte (archivés retirés) et fige sur erreur', () => {
  let inbox = ['A', 'B', 'C', 'D'];
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const props = { DriveAI_TRI_CYCLIQUE_OFFSET: '0' };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }),
  };
  c.GmailApp = {
    search: (req, offset, n) => inbox.slice(offset, offset + n).map((id) => ({ getId: () => id })),
  };
  c.signalerPanneGmail_ = () => false;
  c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = () => {};
  c.dateGmail_ = () => '2026/07/13';
  c.trierFil_ = (fil) => {
    const id = fil.getId();
    if (id === 'A' || id === 'C') {
      inbox = inbox.filter((x) => x !== id);
      return 'archive';
    }
    return 'deja';
  };
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '2', 'seuls B et D restés en boîte avancent l\'offset');
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_FILS_JOUR, '4', 'les 4 fils lus comptent au quota journalier');

  // Erreur sur un fil : offset figé (page rejouée au tick suivant).
  inbox = ['X0', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'B', 'ERR'];
  props.DriveAI_TRI_CYCLIQUE_OFFSET = '10';
  c.trierFil_ = (fil) => (fil.getId() === 'ERR' ? 'erreur' : 'deja');
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '10', 'sur erreur, l\'offset reste figé');
});

test('BUG-1 — purgerClesTriIndex_ invalide _indexLignesCache → préserve le ré-archivage F10 dans un même run', () => {
  const c = load(['Config.gs', 'Journal.gs', 'Gmail.gs', 'TriGmail.gs']);
  const V = '|' + c.CONFIG.TRI_REGLES_VERSION;
  const cleSuspect = 'tri|F_SUSP|1000|lu' + V;
  const cleRetour = 'tri|F_RET|2000|lu' + V;
  // Feuille Index simulée : ligne 2 = F_SUSP, ligne 3 = F_RET (en dessous).
  const lignesSheet = [
    [cleSuspect, new Date('2026-07-01'), 'Sujet suspect', '', '', 'suspect', '', '', '', '', ''],
    [cleRetour, new Date('2026-07-02'), 'Relevé banque', '', '', 'trié', '', '', '', '', ''],
  ];
  c.feuille_ = (nom) => {
    if (nom === 'Confiance' || nom === 'TriAppris') return { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} };
    assert.strictEqual(nom, 'Index');
    return {
      getLastRow: () => lignesSheet.length + 1,
      getRange: (row, col, numRows, numCols) => ({
        getValue: () => (col === 7 ? 'Empreinte' : col === 9 ? 'FileId' : col === 10 ? 'Taille' : col === 11 ? 'Exemplaire' : ''),
        setValue: () => {},
        getValues: () => lignesSheet.slice(row - 2, row - 2 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
      }),
      deleteRow: (row) => { lignesSheet.splice(row - 2, 1); },
      appendRow: (r) => { lignesSheet.push(r); },
    };
  };
  const props = {
    'DriveAI_PAS_SUSPECT|F_SUSP': '1',
    DriveAI_TRI_RATTRAPAGE: 'terminé',
    DriveAI_TRI_BOITE: 'terminé',
    DriveAI_TRI_BOITE_VERSION: String(c.CONFIG.TRI_REGLES_VERSION),
    DriveAI_TRI_HISTO: 'terminé',
    DriveAI_TRI_HISTO_VERSION: String(c.CONFIG.TRI_REGLES_VERSION),
    DriveAI_TRI_ANCIENS_FINI_JOUR: '2026/07/15',
  };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      getProperties: () => ({ ...props }),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }),
  };
  const archives = [];
  const labelFinance = { getName: () => 'Finance', addToThread: () => {} };
  const labelVerif = { getName: () => 'À vérifier', addToThread: () => {} };
  const creerFil = (id, ts) => ({
    getId: () => id,
    isInInbox: () => !archives.includes(id),
    getLastMessageDate: () => new Date(ts),
    isUnread: () => false,
    getLabels: () => [],
    getMessages: () => [{
      getId: () => 'M_' + id,
      getFrom: () => 'Banque <avis@banque-exemple.test>',
      getSubject: () => 'Relevé mensuel',
      getHeader: () => '',
      getPlainBody: () => 'Votre relevé est disponible.',
    }],
    moveToArchive: () => { archives.push(id); },
  });
  const filSusp = creerFil('F_SUSP', 1000);
  const filRetour = creerFil('F_RET', 2000);
  c.GmailApp = {
    getUserLabels: () => [labelFinance, labelVerif],
    getThreadById: (id) => (id === 'F_SUSP' ? filSusp : null),
    search: (q, debut) => (debut === 0 ? [filRetour] : []),
  };
  c.dateGmail_ = () => '2026/07/15';
  c.budgetCampagnesAtteint_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.estPanneGmail_ = () => false;
  c.signalerPanneGmail_ = () => false;
  c.signalerRetablissementGmail_ = () => {};
  c.toucheZoneProtegee_ = () => false;
  c.ecarteParMotsCles_ = () => false;
  c.piecesJointes_ = () => [];
  c.estPromoGmail_ = () => false;
  c.analyserFil_ = () => ({ categorie: 'Finance', suspect: false, aTraiter: false });
  c.tronquer_ = (s) => s;
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};

  // 1. Comme dans tickDriveAI (intake avant tri), le cache Index est chargé avant la purge.
  c.reinitialiserIndexCache_();
  assert.strictEqual(c.indexContient_(cleRetour), true);
  assert.strictEqual(c.indexLigneDe_(cleRetour), 3, 'avant purge : F_RET est en ligne 3');

  // 2. trierFilsGmail_ purge F_SUSP (ligne 2 → F_RET décale en ligne 2) puis traite F_RET revenu en boîte.
  c.trierFilsGmail_(() => false);
  assert.strictEqual(c.indexLigneDe_(cleRetour), 2, 'après purge : _indexLignesCache rechargé → F_RET en ligne 2');
  assert.notStrictEqual(c.lireLigneIndex_(cleRetour), null, 'lireLigneIndex_ relit la bonne ligne');
  assert.ok(archives.includes('F_RET'), 'F_RET revenu en boîte doit être ré-archivé');
});

test('appliquerPasSuspect_ : erreur getThreadById (quota vs non-quota) préserve le reste ou journalise', () => {
  const journaux = [];
  const cQuota = load(['Config.gs', 'TriGmail.gs']);
  const propsQuota = { 'DriveAI_PAS_SUSPECT|f1': '1', 'DriveAI_PAS_SUSPECT|f2': '1' };
  cQuota.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in propsQuota ? propsQuota[k] : null),
      getProperties: () => ({ ...propsQuota }),
      setProperty: (k, v) => { propsQuota[k] = String(v); },
      deleteProperty: (k) => { delete propsQuota[k]; },
    }),
  };
  cQuota.purgerClesTriIndex_ = () => 0;
  cQuota.GmailApp = { getThreadById: () => { throw new Error('Service invoked too many times for one day: gmail.'); } };
  cQuota.signalerPanneGmail_ = () => true;
  cQuota.journalErreur_ = (s, m) => journaux.push(m);
  cQuota.appliquerPasSuspect_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(propsQuota['DriveAI_PAS_SUSPECT|f1'], '1', 'quota → f1 conservé');
  assert.strictEqual(propsQuota['DriveAI_PAS_SUSPECT|f2'], '1', 'quota → f2 conservé');
  assert.strictEqual(journaux.length, 0);

  const cErr = load(['Config.gs', 'TriGmail.gs']);
  const propsErr = { 'DriveAI_PAS_SUSPECT|f1': '1' };
  cErr.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in propsErr ? propsErr[k] : null),
      getProperties: () => ({ ...propsErr }),
      setProperty: (k, v) => { propsErr[k] = String(v); },
      deleteProperty: (k) => { delete propsErr[k]; },
    }),
  };
  cErr.purgerClesTriIndex_ = () => 0;
  cErr.GmailApp = { getThreadById: () => { throw new Error('fil introuvable'); } };
  cErr.signalerPanneGmail_ = () => false;
  cErr.journalErreur_ = (s, m) => journaux.push(m);
  cErr.appliquerPasSuspect_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.ok(journaux.some((j) => j.includes('Pas-suspect inapplicable (f1)')));
});

test('BUG-R2-1 — appliquerPasSuspect_ : erreur interne trierFil_ (quota Gmail + convergence tri-abandon) préserve puis solde la clé', () => {
  // 1. Quota Gmail intercepté à l'intérieur de trierFil_ (fil.getLabels lève → return 'erreur', sans throw)
  const c = load(['Config.gs', 'Journal.gs', 'Gmail.gs', 'TriGmail.gs']);
  const V = '|' + c.CONFIG.TRI_REGLES_VERSION;
  const lignesIndex = [
    ['tri|F_Q1|1000|lu' + V, new Date('2026-07-01'), 'Avis mensuel', '', '', 'suspect', '', '', '', '', ''],
  ];
  const lignesEchecs = [];
  c.feuille_ = (nom) => {
    if (nom === 'Confiance' || nom === 'TriAppris') {
      return { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} };
    }
    if (nom === 'Échecs') {
      return {
        getLastRow: () => lignesEchecs.length + 1,
        getRange: (row, col, numRows, numCols) => ({
          getValues: () => lignesEchecs.slice(row - 2, row - 2 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
          setValues: (vals) => {
            for (let r = 0; r < vals.length; r++) {
              for (let k = 0; k < vals[r].length; k++) lignesEchecs[row - 2 + r][col - 1 + k] = vals[r][k];
            }
          },
        }),
        appendRow: (r) => { lignesEchecs.push(r); },
      };
    }
    assert.strictEqual(nom, 'Index');
    return {
      getLastRow: () => lignesIndex.length + 1,
      getRange: (row, col, numRows, numCols) => ({
        getValue: () => '',
        setValue: () => {},
        getValues: () => lignesIndex.slice(row - 2, row - 2 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
      }),
      deleteRow: (row) => { lignesIndex.splice(row - 2, 1); },
      appendRow: (r) => { lignesIndex.push(r); },
    };
  };
  const props = {
    'DriveAI_PAS_SUSPECT|F_Q1': '1',
    'DriveAI_PAS_SUSPECT|F_Q2': '1',
  };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      getProperties: () => ({ ...props }),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }),
  };

  let quotaActif = true;
  const appelsThread = [];
  const labelFinance = { getName: () => 'Finance', addToThread: () => {} };
  const creerFil = (id) => ({
    getId: () => id,
    isInInbox: () => true,
    getLastMessageDate: () => new Date(1000),
    isUnread: () => false,
    getLabels: () => {
      if (quotaActif) throw new Error('Service invoked too many times for one day: gmail.');
      return [];
    },
    getMessages: () => [{
      getId: () => 'M_' + id,
      getFrom: () => 'Banque Exemple <avis@banque-exemple.test>',
      getSubject: () => 'Relevé mensuel',
      getHeader: () => '',
      getPlainBody: () => 'Votre relevé est disponible.',
    }],
    moveToArchive: () => {},
  });
  c.GmailApp = {
    getUserLabels: () => [labelFinance],
    getThreadById: (id) => {
      appelsThread.push(id);
      return creerFil(id);
    },
  };
  c.budgetCampagnesAtteint_ = () => false;
  c.toucheZoneProtegee_ = () => false;
  c.ecarteParMotsCles_ = () => false;
  c.piecesJointes_ = () => [];
  c.estPromoGmail_ = () => false;
  c.analyserFil_ = () => ({ categorie: 'Finance', suspect: false, aTraiter: false });
  c.tronquer_ = (s) => s;
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};

  const etat1 = { traites: 0, attentes: 0 };
  c.appliquerPasSuspect_(etat1, () => false, ['Finance'], { Finance: labelFinance });
  assert.strictEqual(c.estPanneGmail_(), true, 'panne Gmail détectée dans trierFil_');
  assert.strictEqual(props['DriveAI_PAS_SUSPECT|F_Q1'], '1', 'F_Q1 conservé après retour erreur');
  assert.strictEqual(props['DriveAI_PAS_SUSPECT|F_Q2'], '1', 'F_Q2 suivant conservé sans appel Gmail');
  assert.deepStrictEqual(appelsThread, ['F_Q1'], 'boucle interrompue dès détection de panne Gmail');
  assert.strictEqual(etat1.traites, 0);

  // Rétablissement Gmail au tick suivant : chargerPanneGmail_() réinitialise l'état du run
  quotaActif = false;
  delete props.DriveAI_GMAIL_QUOTA;
  c.chargerPanneGmail_();
  const etat2 = { traites: 0, attentes: 0 };
  c.appliquerPasSuspect_(etat2, () => false, ['Finance'], { Finance: labelFinance });
  assert.strictEqual(etat2.traites, 2);
  assert.ok(!('DriveAI_PAS_SUSPECT|F_Q1' in props), 'F_Q1 soldé après rétablissement');
  assert.ok(!('DriveAI_PAS_SUSPECT|F_Q2' in props), 'F_Q2 soldé après rétablissement');

  // 2. Fil définitivement cassé (erreur non-quota) : préservé jusqu'à QUARANTAINE_MAX, puis soldé via tri-abandon
  const propsMalade = { 'DriveAI_PAS_SUSPECT|F_MALADE': '1' };
  const cMalade = load(['Config.gs', 'Journal.gs', 'Gmail.gs', 'TriGmail.gs']);
  const indexMalade = [];
  const echecsMalade = [];
  cMalade.feuille_ = (nom) => {
    if (nom === 'Échecs') {
      return {
        getLastRow: () => echecsMalade.length + 1,
        getRange: (row, col, numRows, numCols) => ({
          getValues: () => echecsMalade.slice(row - 2, row - 2 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
          setValues: (vals) => {
            for (let r = 0; r < vals.length; r++) {
              for (let k = 0; k < vals[r].length; k++) echecsMalade[row - 2 + r][col - 1 + k] = vals[r][k];
            }
          },
        }),
        appendRow: (r) => { echecsMalade.push(r); },
      };
    }
    return {
      getLastRow: () => indexMalade.length + 1,
      getRange: (row, col, numRows, numCols) => ({
        getValue: () => '',
        setValue: () => {},
        getValues: () => indexMalade.slice(row - 2, row - 2 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
      }),
      deleteRow: (row) => { indexMalade.splice(row - 2, 1); },
      appendRow: (r) => { indexMalade.push(r); },
    };
  };
  cMalade.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in propsMalade ? propsMalade[k] : null),
      getProperties: () => ({ ...propsMalade }),
      setProperty: (k, v) => { propsMalade[k] = String(v); },
      deleteProperty: (k) => { delete propsMalade[k]; },
    }),
  };
  cMalade.GmailApp = {
    getThreadById: (id) => ({
      getId: () => id,
      isInInbox: () => true,
      getLastMessageDate: () => new Date(1000),
      isUnread: () => false,
      getLabels: () => [],
      getMessages: () => { throw new Error('fil corrompu'); },
    }),
  };
  cMalade.journalInfo_ = () => {};
  cMalade.journalErreur_ = () => {};

  const maxEssais = cMalade.CONFIG.QUARANTAINE_MAX;
  for (let essai = 1; essai <= maxEssais; essai++) {
    cMalade.appliquerPasSuspect_({ traites: 0, attentes: 0 }, () => false, ['Finance'], { Finance: labelFinance });
    assert.strictEqual(propsMalade['DriveAI_PAS_SUSPECT|F_MALADE'], '1', `essai ${essai} : clé conservée`);
  }
  assert.ok(indexMalade.some((r) => r[0] === 'tri-abandon|F_MALADE|1000'), 'tri-abandon posé après QUARANTAINE_MAX');
  // Tick suivant : trierFil_ voit tri-abandon → retourne 'deja' → clé purgée proprement
  cMalade.appliquerPasSuspect_({ traites: 0, attentes: 0 }, () => false, ['Finance'], { Finance: labelFinance });
  assert.ok(!('DriveAI_PAS_SUSPECT|F_MALADE' in propsMalade), 'clé purgée après convergence tri-abandon');
});

