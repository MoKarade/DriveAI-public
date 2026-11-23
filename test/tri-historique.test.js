'use strict';
/**
 * ADR-0076 (étape 7 de l'ADR-0074) : tri de l'HISTORIQUE ARCHIVÉ sans libellé sous UN plafond quotidien
 * commun aux trois campagnes de fond du tri (cyclique, nettoyage profond, historique).
 * Verrous : file mouvante, jamais d'archivage ni de désarchivage hors boîte, plafond commun qui n'affame
 * jamais l'intake (il ne touche que les campagnes de FOND), terminaison à deux passes propres, ré-armement.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctxPur = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
const MAX = ctxPur.CONFIG.TRI_FOND_MAX_FILS_JOUR;
const RESERVE = ctxPur.CONFIG.TRI_FOND_RESERVE_VIVANT;
const PAGE = ctxPur.CONFIG.PAGE_FILS_ACTIONS;
const JOUR = '2026/07/15';

// Contexte à ARCHIVES MUTABLES : GmailApp.search sert une tranche des archives sans libellé ; trierFil_
// RETIRE du résultat tout fil 'traite' (il vient de recevoir un libellé : file mouvante réelle).
function ctxHisto(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  let archives = (opts.archives || []).slice(); // [{ id, action }]
  const props = Object.assign({ DriveAI_TRI_HISTO_VERSION: String(c.CONFIG.TRI_REGLES_VERSION) }, opts.props);
  const recherches = [];
  const effacements = [];
  const appels = []; // arguments reçus par trierFil_
  const erreurs = [], infos = []; // lignes de Journal
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; effacements.push(k); },
  }) };
  c.GmailApp = { search: (req, offset, n) => {
    recherches.push({ req, offset, n });
    if (opts.panne) throw new Error(opts.panne);
    return archives.slice(offset, offset + n).map((x) => ({ getId: () => x.id, isInInbox: () => x.id === 'EN-BOITE' }));
  } };
  c.trierFil_ = (fil, candidats, libelles, verifierBoite, horsBoite) => {
    appels.push({ id: fil.getId(), verifierBoite, horsBoite });
    if (fil.getId() === 'EN-BOITE') throw new Error('un fil en boîte ne passe jamais par trierFil_ hors boîte');
    const item = archives.find((x) => x.id === fil.getId());
    const r = item ? item.action : 'deja';
    if (r === 'traite') archives = archives.filter((x) => x.id !== fil.getId()); // étiqueté : quitte `has:nouserlabels`
    return r;
  };
  c.signalerPanneGmail_ = opts.signalerPanneGmail_ || (() => false);
  c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = (s, m) => erreurs.push(m);
  c.journalInfo_ = (s, m) => infos.push(m);
  c.dateGmail_ = () => opts.jour || JOUR;
  return { c, props, recherches, effacements, appels, erreurs, infos, archives: () => archives };
}
const etat = () => ({ traites: 0, attentes: 0 });

/* ---------- plafond COMMUN (filsFondLusJour_, PURE) ---------- */

test('filsFondLusJour_ : somme des trois compteurs du JOUR seulement (un compteur d\'hier vaut 0)', () => {
  const kv = {
    DriveAI_TRI_CYCLIQUE_JOUR: JOUR, DriveAI_TRI_CYCLIQUE_FILS_JOUR: '100',
    DriveAI_TRI_BOITE_JOUR: '2026/07/14', DriveAI_TRI_BOITE_FILS_JOUR: '150', // hier : ignoré
    DriveAI_TRI_HISTO_JOUR: JOUR, DriveAI_TRI_HISTO_FILS_JOUR: '25',
  };
  const props = { getProperty: (k) => (k in kv ? kv[k] : null) };
  assert.strictEqual(ctxPur.filsFondLusJour_(props, JOUR), 125);
  assert.strictEqual(ctxPur.filsFondLusJour_({ getProperty: () => null }, JOUR), 0);
});

test('plafond commun : les fils lus par le CYCLIQUE et le NETTOYAGE PROFOND ferment l\'historique sans recherche', () => {
  const { c, recherches, props } = ctxHisto({
    props: { DriveAI_TRI_CYCLIQUE_JOUR: JOUR, DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(MAX - 100),
      DriveAI_TRI_BOITE_JOUR: JOUR, DriveAI_TRI_BOITE_FILS_JOUR: '100' },
    archives: [{ id: 'x', action: 'traite' }],
  });
  c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.strictEqual(recherches.length, 0, 'plafond du jour consommé par les autres campagnes = zéro appel Gmail');
  assert.ok(!('DriveAI_TRI_HISTO_FILS_JOUR' in props), 'rien lu, rien compté');
  assert.notStrictEqual(props.DriveAI_TRI_HISTO, 'terminé', 'campagne intacte, reprise demain');
});

function ctxFond(props) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const tailles = [];
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) };
  c.GmailApp = { search: (req, offset, n) => { tailles.push(n); return []; } };
  c.trierFil_ = () => 'deja';
  c.signalerPanneGmail_ = () => false; c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = () => {}; c.journalInfo_ = () => {};
  c.dateGmail_ = () => JOUR;
  return { c, tailles };
}

test('plafond commun dans l\'autre sens : l\'historique lu ce matin RÉTRÉCIT la page du cyclique et du nettoyage profond', () => {
  // Cyclique 150 + historique 147 lus → reliquat commun = 3 → page de 3, pas PAGE_FILS_ACTIONS.
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const props = { DriveAI_TRI_CYCLIQUE_JOUR: JOUR, DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(RESERVE),
    DriveAI_TRI_HISTO_JOUR: JOUR, DriveAI_TRI_HISTO_FILS_JOUR: String(MAX - RESERVE - 3), DriveAI_TRI_CYCLIQUE_OFFSET: '0' };
  const tailles = [];
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) };
  c.GmailApp = { search: (req, offset, n) => { tailles.push(n); return []; } };
  c.trierFil_ = () => 'deja';
  c.signalerPanneGmail_ = () => false; c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = () => {}; c.journalInfo_ = () => {};
  c.dateGmail_ = () => JOUR;
  c.scanCycliqueTri_(etat(), () => false, [], {});
  assert.deepStrictEqual(tailles, [3], 'cyclique borné au reliquat COMMUN');
  // Nettoyage profond : même reliquat.
  props.DriveAI_TRI_BOITE_VERSION = String(c.CONFIG.TRI_REGLES_VERSION);
  c.nettoyerBoiteHistorique_(etat(), () => false, [], {});
  assert.deepStrictEqual(tailles, [3, 3], 'nettoyage profond borné au reliquat COMMUN');
  assert.ok(PAGE > 3);
});

test('RÉSERVE du vivant : boîte + historique ne prennent jamais plus de MAX − RÉSERVE ; le cyclique garde sa page pleine', () => {
  // Les deux campagnes non vivantes ont déjà consommé toute leur part (150) : l'historique et le nettoyage
  // profond rendent la main SANS recherche, le cyclique obtient encore une page entière (reliquat commun 150).
  const props = { DriveAI_TRI_BOITE_JOUR: JOUR, DriveAI_TRI_BOITE_FILS_JOUR: '100',
    DriveAI_TRI_HISTO_JOUR: JOUR, DriveAI_TRI_HISTO_FILS_JOUR: String(MAX - RESERVE - 100),
    DriveAI_TRI_BOITE_VERSION: String(ctxPur.CONFIG.TRI_REGLES_VERSION), DriveAI_TRI_HISTO_VERSION: String(ctxPur.CONFIG.TRI_REGLES_VERSION) };
  const { c, tailles } = ctxFond(props);
  c.trierHistoriqueArchive_(etat(), () => false, [], {});
  c.nettoyerBoiteHistorique_(etat(), () => false, [], {});
  assert.deepStrictEqual(tailles, [], 'part non vivante épuisée : zéro recherche (C28-21 : priorité au vivant)');
  c.scanCycliqueTri_(etat(), () => false, [], {});
  assert.deepStrictEqual(tailles, [PAGE], 'le cyclique n\'est jamais affamé par les campagnes non vivantes');
  assert.strictEqual(ctxPur.reliquatFondNonVivant_({ getProperty: () => null }, JOUR), MAX - RESERVE, 'journée vierge : la part non vivante vaut MAX − RÉSERVE');
});

/* ---------- trierHistoriqueArchive_ ---------- */

test('trierHistoriqueArchive_ : requête FIGÉE (archives sans libellé utilisateur), trierFil_ appelé HORS boîte, sans vérification de boîte', () => {
  const { c, recherches, appels } = ctxHisto({ archives: [{ id: 'x', action: 'deja' }] });
  c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.strictEqual(recherches[0].req, 'has:nouserlabels -in:inbox -in:sent -in:drafts -in:chats');
  assert.strictEqual(recherches[0].req, c.CONFIG.TRI_HISTO_REQUETE);
  assert.deepStrictEqual(appels[0], { id: 'x', verifierBoite: false, horsBoite: true });
});

test('trierHistoriqueArchive_ : FILE MOUVANTE — l\'offset n\'avance que des fils RESTÉS sans libellé ; tout fil LU compte au plafond', () => {
  // Page [T(traite), R(deja)] : T reçoit un libellé et quitte le résultat, R reste → offset avance de 1.
  const { c, props, recherches } = ctxHisto({ archives: [{ id: 'T', action: 'traite' }, { id: 'R', action: 'deja' }] });
  const e = etat();
  c.trierHistoriqueArchive_(e, () => false, [], {});
  assert.deepStrictEqual(recherches.map((r) => r.offset), [0, 1], 'offset avancé des seuls restants');
  assert.strictEqual(e.traites, 1);
  assert.deepStrictEqual([props.DriveAI_TRI_HISTO_JOUR, props.DriveAI_TRI_HISTO_FILS_JOUR], [JOUR, '2'], 'JOUR + FILS_JOUR écrits ensemble');
  assert.strictEqual(props.DriveAI_TRI_HISTO_PASSE_SALE, undefined, 'passe finie avec activité : marque consommée');
  assert.ok(!('DriveAI_TRI_HISTO_PASSES_PROPRES' in props));
});

test('trierHistoriqueArchive_ : convergence — DEUX passes propres consécutives → « terminé », puis coût nul', () => {
  const ctx = ctxHisto({ archives: [{ id: 'T', action: 'traite' }, { id: 'R', action: 'deja' }] });
  ctx.c.trierHistoriqueArchive_(etat(), () => false, [], {}); // passe 1 : activité
  assert.notStrictEqual(ctx.props.DriveAI_TRI_HISTO, 'terminé');
  ctx.c.trierHistoriqueArchive_(etat(), () => false, [], {}); // passe 2 : R seul, propre (même jour : 2 lus sur 150, reliquat intact)
  assert.strictEqual(ctx.props.DriveAI_TRI_HISTO_PASSES_PROPRES, '1');
  ctx.c.trierHistoriqueArchive_(etat(), () => false, [], {}); // passe 3 : propre → terminé
  assert.strictEqual(ctx.props.DriveAI_TRI_HISTO, 'terminé', 'un restant « deja » ne bloque jamais la fin');
  const n = ctx.recherches.length;
  ctx.c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.strictEqual(ctx.recherches.length, n, '« terminé » = aucune recherche (coût nul ensuite)');
});

test('trierHistoriqueArchive_ : RÉ-ARMEMENT au bump de TRI_REGLES_VERSION — état effacé AVANT la 1re recherche, « terminé » rouvert', () => {
  const { c, props, effacements, recherches, infos } = ctxHisto({
    props: { DriveAI_TRI_HISTO: 'terminé', DriveAI_TRI_HISTO_VERSION: 'r-ancienne', DriveAI_TRI_HISTO_OFFSET: '77', DriveAI_TRI_HISTO_PASSES_PROPRES: '2' },
    archives: [{ id: 'x', action: 'deja' }],
  });
  c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.deepStrictEqual(effacements.slice(0, 5), ['DriveAI_TRI_HISTO', 'DriveAI_TRI_HISTO_ANCRE', 'DriveAI_TRI_HISTO_OFFSET', 'DriveAI_TRI_HISTO_PASSE_SALE', 'DriveAI_TRI_HISTO_PASSES_PROPRES']);
  assert.strictEqual(props.DriveAI_TRI_HISTO_VERSION, String(c.CONFIG.TRI_REGLES_VERSION));
  assert.strictEqual(recherches[0].offset, 0, 'repart du haut');
  assert.ok(infos.some((m) => /RÉ-ARMÉ/.test(m)));
});

test('trierHistoriqueArchive_ : PREMIER armement (aucune version posée) → version écrite, aucune ligne « RÉ-ARMÉ » (rien n\'a jamais passé)', () => {
  const { c, props, infos } = ctxHisto({ props: { DriveAI_TRI_HISTO_VERSION: undefined }, archives: [] });
  delete props.DriveAI_TRI_HISTO_VERSION;
  c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.strictEqual(props.DriveAI_TRI_HISTO_VERSION, String(c.CONFIG.TRI_REGLES_VERSION));
  assert.ok(!infos.some((m) => /RÉ-ARMÉ/.test(m)), 'la première ligne que lit Marc est vraie');
});

test('trierHistoriqueArchive_ : un fil dont un message est EN boîte (requête évaluée par message) est laissé aux scans de la boîte, compté restant', () => {
  const { c, props, appels, recherches } = ctxHisto({ archives: [{ id: 'EN-BOITE', action: 'traite' }, { id: 'R', action: 'deja' }] });
  c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.deepStrictEqual(appels.map((a) => a.id), ['R'], 'jamais trierFil_ hors boîte sur un fil en boîte (ADR-0050 : il doit pouvoir être archivé)');
  assert.deepStrictEqual(recherches.map((r) => r.offset), [0, 2], 'compté restant : l\'offset avance');
  assert.strictEqual(props.DriveAI_TRI_HISTO_FILS_JOUR, '2', 'lu quand même (coût quota réel)');
});

test('trierHistoriqueArchive_ : page interrompue par le garde-temps → offset INCHANGÉ ; fil en erreur → page rejouée, jamais sauté', () => {
  const e = etat();
  const a = ctxHisto({ props: { DriveAI_TRI_HISTO_OFFSET: '40' }, archives: Array.from({ length: 45 }, (_, i) => ({ id: 'f' + i, action: 'deja' })) });
  // Le garde-temps mord après 2 fils : ceux-ci sont comptés (lus), l'offset ne bouge pas.
  let lus = 0; const trier = a.c.trierFil_; a.c.trierFil_ = (...args) => { lus++; return trier(...args); };
  a.c.trierHistoriqueArchive_(e, () => lus >= 2, [], {});
  assert.strictEqual(a.props.DriveAI_TRI_HISTO_OFFSET, '40');
  assert.strictEqual(a.props.DriveAI_TRI_HISTO_FILS_JOUR, '2', 'les fils LUS comptent, page complétée ou non');
  const b = ctxHisto({ archives: [{ id: 'ok', action: 'deja' }, { id: 'malade', action: 'erreur' }] });
  b.c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.deepStrictEqual(b.recherches.map((r) => r.offset), [0], 'erreur → offset figé, rejeu au tick suivant');
});

test('trierHistoriqueArchive_ : quota Gmail en panne → offset inchangé, aucune erreur journalisée ; autre erreur → journalisée', () => {
  const a = ctxHisto({ panne: 'Service invoked too many times', signalerPanneGmail_: () => true, props: { DriveAI_TRI_HISTO_OFFSET: '12' } });
  a.c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.strictEqual(a.props.DriveAI_TRI_HISTO_OFFSET, '12');
  assert.strictEqual(a.erreurs.length, 0);
  const b = ctxHisto({ panne: 'boom' });
  b.c.trierHistoriqueArchive_(etat(), () => false, [], {});
  assert.ok(b.erreurs[0].includes('boom'));
});

test('trierHistoriqueArchive_ : les attentes (TRI_MAX_ATTENTES) bornent aussi la page', () => {
  const { c, recherches } = ctxHisto({ archives: [{ id: 'x', action: 'deja' }] });
  c.trierHistoriqueArchive_({ traites: 0, attentes: c.CONFIG.TRI_MAX_ATTENTES }, () => false, [], {});
  assert.strictEqual(recherches.length, 0);
});

/* ---------- trierFil_ hors boîte : jamais d'archivage ---------- */

test('trierFil_ hors boîte : un fil archivé LU reçoit son libellé mais n\'est JAMAIS archivé ni désarchivé (rendu \'traite\', pas \'archive\')', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  c.ecarteParMotsCles_ = () => false; // Prefiltre.gs non chargé ici
  const labels = [], archives = [], ajouts = [];
  c.journalErreur_ = () => {}; c.journalInfo_ = () => {};
  c.indexContient_ = () => false; c.indexAjouter_ = (cle) => ajouts.push(cle);
  c.toucheZoneProtegee_ = () => false; c.piecesJointes_ = () => []; c.estPannePlateforme_ = () => false;
  c.estPromoGmail_ = () => true; c.analyserFil_ = () => ({ categorie: 'Finance', suspect: false, aTraiter: false });
  const appris = [];
  c.incrementerEchec_ = () => 1; c.tronquer_ = (t) => t; c.apprendreTri_ = (adresse) => appris.push(adresse);
  c.feuille_ = () => ({ getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} });
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) };
  const libelles = {}; ['Finance', 'À vérifier', '⚠️ Suspect', '⏰ À traiter'].forEach((n) => { libelles[n] = { getName: () => n, addToThread: () => labels.push(n) }; });
  const vieux = Date.now() - 400 * 86400000; // 2025 : hors fenêtre → cas (a), tri complet sans attendre
  const message = { getId: () => 'M', getFrom: () => 'Banque <x@banque.com>', getSubject: () => 'Relevé', getHeader: () => '', getPlainBody: () => 'x' };
  const fil = { getId: () => 'F', isInInbox: () => false, getLastMessageDate: () => new Date(vieux), isUnread: () => false,
    getLabels: () => [], getMessages: () => [message], moveToArchive: () => archives.push('F') };
  const r = c.trierFil_(fil, ['Finance'], libelles, false, true);
  assert.strictEqual(r, 'traite');
  assert.deepStrictEqual(labels, ['Finance']);
  assert.deepStrictEqual(archives, [], 'jamais moveToArchive hors boîte');
  assert.ok(ajouts.some((k) => k.startsWith('tri|F|')), 'idempotence par l\'Index');
  assert.deepStrictEqual(appris, [], 'hors boîte : jamais d\'apprentissage d\'expéditeur (un mail lu en 2021 n\'est pas un geste de Marc)');
  // Le même fil EN boîte (chemin historique) est bien archivé ET appris : la différence vient du seul paramètre.
  const r2 = c.trierFil_({ ...fil, getId: () => 'G', isInInbox: () => true, moveToArchive: () => archives.push('G') }, ['Finance'], libelles, true);
  assert.deepStrictEqual([r2, archives, appris], ['archive', ['G'], ['x@banque.com']]);
});

/* ---------- intégration dans trierFilsGmail_ ---------- */

function ctxTick(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const ordre = [];
  c.journalErreur_ = () => {}; c.journalInfo_ = () => {};
  c.budgetCampagnesAtteint_ = opts.budget || (() => false);
  c.estPannePlateforme_ = () => false; c.estPanneGmail_ = () => false;
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) };
  c.GmailApp = { getUserLabels: () => [], search: () => [] };
  c.appliquerPasSuspect_ = () => ordre.push('pasSuspect');
  c.scanAvantTri_ = () => ordre.push('avant');
  c.scanCycliqueTri_ = () => ordre.push('cyclique');
  c.scanArriereTri_ = () => ordre.push('arriere');
  c.nettoyerBoiteHistorique_ = () => ordre.push('boite');
  c.trierHistoriqueArchive_ = () => ordre.push('histo');
  return { c, ordre };
}

test('trierFilsGmail_ : l\'historique archivé passe en TOUT dernier, après le nettoyage profond', () => {
  const { c, ordre } = ctxTick({});
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(ordre.slice(-2), ['boite', 'histo']);
});

test('trierFilsGmail_ : frein campagnes §2.6 atteint → ni nettoyage profond ni historique (le courrier NEUF passe toujours)', () => {
  const { c, ordre } = ctxTick({ budget: () => true });
  c.trierFilsGmail_(() => false);
  assert.ok(ordre.includes('avant') && !ordre.includes('boite') && !ordre.includes('histo'));
});

test('trierFilsGmail_ : garde-temps atteint → l\'historique ne démarre pas', () => {
  const { c, ordre } = ctxTick({});
  c.trierFilsGmail_(() => true);
  assert.ok(!ordre.includes('histo'));
});

/* ---------- constantes : l'ancien plafond par campagne n'existe plus ---------- */

test('Config : UN plafond de fond, les anciens plafonds par campagne ont DISPARU (jamais deux vérités)', () => {
  assert.strictEqual(typeof ctxPur.CONFIG.TRI_FOND_MAX_FILS_JOUR, 'number');
  assert.ok(ctxPur.CONFIG.TRI_FOND_MAX_FILS_JOUR >= 300, 'enveloppe d\'hier (150 + 150) jamais redescendue');
  assert.ok(RESERVE >= 150 && RESERVE < MAX, 'le vivant garde au moins ses 150 d\'hier, sans tout prendre');
  assert.strictEqual(ctxPur.CONFIG.TRI_CYCLIQUE_MAX_FILS_JOUR, undefined);
  assert.strictEqual(ctxPur.CONFIG.TRI_BOITE_MAX_FILS_JOUR, undefined);
});
