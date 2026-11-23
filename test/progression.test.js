'use strict';
/**
 * C28-18 — progression LIVE des opérations (onglet `Progression`, rendu centralisé) :
 *  - `lignesProgression_` (PURE) : statuts dérivés des pannes/frein AVANT « en cours » ; une ligne
 *    « terminé » garde l'horodatage de sa FIN et disparaît après PROGRESSION_PURGE_MS (dérivé de la
 *    CONSTANTE, jamais de sa valeur du jour) ; une campagne finie AVANT d'avoir eu une ligne
 *    n'apparaît jamais ; les demandes soldées restent visibles par leur instantané `solde`.
 *  - `majCompteurCampagne_` : numérateur monotone, base RE-BASABLE (jamais > 100 %), no-op sans base.
 *  - `compterRestantMigration_`/`compterRestantReanalyse_` : même périmètre que leurs collectes
 *    (zone protégée et cibles C26-08 exclues de m1), bornés par le garde (partiel → complet=false).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- lignesProgression_ (PURE — Journal.gs) ---------- */

function ctxJournal() {
  // Suivi.gs : REGISTRE_OPERATIONS + statutDepuisSuivi_, consommés par lignesProgression_ (C28-44 PR3).
  return load(['Config.gs', 'Suivi.gs', 'Journal.gs']);
}

/** Appel v3 : suivi et registre explicites (suivi vide par défaut — chaque test passe le sien). */
function lignesV3(c, etat, existantes, maintenantMs, suivi) {
  return c.lignesProgression_(etat, existantes, maintenantMs, c.CONFIG.PROGRESSION_PURGE_MS,
    suivi || {}, c.REGISTRE_OPERATIONS);
}

/** État de référence : tout inactif/terminé-sans-ligne — chaque test ne touche que son opération. */
function etatVierge(c) {
  return {
    quotaGmail: false, panneApi: false, freinBudget: false, resetEnCours: false,
    rangement: { termine: true, base: null, traites: 0, tag: c.CONFIG.RANGEMENT_TAG },
    migration: { termine: true, base: null, traites: 0, tag: c.CONFIG.MIGRATION_TAG },
    reanalyse: { termine: true, enAttente: false, base: null, traites: 0, tag: c.CONFIG.REANALYSE_TAG },
    histo: { termine: true, traites: 0 },
    consolidationGen: { termine: true, base: 0, traites: 0, budgetEpuise: false, tag: c.CONFIG.CONSOLIDATION_TAG },
    consolidationExec: { termine: true, base: 0, traites: 0, budgetEpuise: false, tag: c.CONFIG.CONSOLIDATION_TAG },
  };
}

test('lignesProgression_ : campagne en cours → barre ; recensement sans base ; « en attente » avant m1', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 1209, traites: 812, tag: 'm1' };
  etat.reanalyse = { termine: false, enAttente: true, base: null, traites: 0, tag: 'c26-08' };
  etat.histo = { termine: false, traites: 4520 };
  const lignes = lignesV3(c, etat, {}, Date.now());

  const parCle = {};
  lignes.forEach((l) => { parCle[l[0]] = l; });
  assert.deepStrictEqual([parCle['migration'][2], parCle['migration'][3], parCle['migration'][4], parCle['migration'][5]], [812, 1209, 'documents', 'en cours']);
  assert.strictEqual(parCle['reanalyse'][5], 'en attente (après m1)');
  assert.deepStrictEqual([parCle['histo-gmail'][2], parCle['histo-gmail'][3], parCle['histo-gmail'][4], parCle['histo-gmail'][5]], [4520, '', 'fils', 'en cours'],
    'base inconnue (historique) → colonne Base vide, l\'app affiche un indéterminé');
  assert.ok(!('rangement' in parCle), 'campagne finie AVANT d\'avoir eu une ligne → jamais affichée');

  // Recensement : campagne active sans base posée.
  etat.migration = { termine: false, base: null, traites: 0, tag: 'm1' };
  const lignes2 = lignesV3(c, etat, {}, Date.now());
  assert.strictEqual(lignes2.find((l) => l[0] === 'migration')[5], 'recensement');
});

test('lignesProgression_ : statuts dérivés — frein budget (campagnes) et quota Gmail (opérations mail)', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.freinBudget = true;
  etat.quotaGmail = true;
  etat.migration = { termine: false, base: 100, traites: 10, tag: 'm1' };
  etat.histo = { termine: false, traites: 50 };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now())
    .forEach((l) => { parCle[l[0]] = l; });
  assert.strictEqual(parCle['migration'][5], 'en pause (frein budget)');
  assert.strictEqual(parCle['histo-gmail'][5], 'suspendu (quota Gmail)', 'le quota prime sur le frein pour Gmail');
});

test('DriveAI#804 : quota Gmail épuisé → intake-gmail et tri-gmail sont « suspendu (quota Gmail épuisé) », pas « en cours »', () => {
  // La gate est lue dans le VRAIE Main.gs (le tick ne se charge pas) puis exécutée par le vrai
  // `etapeSuivie_` : la raison qui finit dans la ligne Progression est celle que le tick pose.
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
  const m = main.match(/var gPanneGmail = (function \(\) \{[^\n]*\});/);
  assert.ok(m, 'gPanneGmail introuvable dans Main.gs');
  const CLES = ['intake-gmail', 'tri-gmail'];
  const statuts = (quota) => {
    const c = ctxJournal();
    c.suiviReset_();
    const gate = new Function('estPanneGmail_', 'return ' + m[1])(() => quota);
    let appels = 0;
    CLES.forEach((cle) => c.etapeSuivie_(cle, [gate], () => { appels++; }));
    const etat = etatVierge(c);
    etat.quotaGmail = quota;
    const suivi = c.suiviOpsFusionne_({ getProperty: () => null });
    const parCle = {};
    lignesV3(c, etat, {}, Date.now(), suivi).forEach((l) => { parCle[l[0]] = l; });
    return { appels, statuts: CLES.map((cle) => parCle[cle][5]) };
  };
  const panne = statuts(true);
  assert.strictEqual(panne.appels, 0, 'quota épuisé : aucune des deux étapes ne tourne');
  assert.deepStrictEqual(panne.statuts, CLES.map(() => 'suspendu (quota Gmail épuisé)'));
  const normal = statuts(false);
  assert.strictEqual(normal.appels, CLES.length);
  assert.deepStrictEqual(normal.statuts, CLES.map(() => 'en cours'));
});

test('lignesProgression_ : « terminé » — horodatage de FIN figé, purge dérivée de la CONSTANTE, numérateur figé', () => {
  const c = ctxJournal();
  const PURGE = c.CONFIG.PROGRESSION_PURGE_MS;
  const maintenant = Date.now();
  const etat = etatVierge(c);
  etat.migration = { termine: true, base: 1209, traites: 1209, tag: 'm1' };

  // Transition en cours → terminé : la ligne reste, horodatée MAINTENANT.
  const existEnCours = { migration: { traites: 1100, statut: 'en cours', horodateMs: maintenant - 60000 } };
  const l1 = lignesV3(c, etat, existEnCours, maintenant).find((l) => l[0] === 'migration');
  assert.strictEqual(l1[5], 'terminé');
  assert.strictEqual(l1[6].getTime(), maintenant, 'fin fraîche → horodatée au tick de la transition');

  // Déjà terminé : l'horodatage de FIN ne bouge plus (sinon jamais purgé)…
  const finMs = maintenant - (PURGE - 60000); // purge − 1 min : encore visible
  const existFini = { migration: { traites: 1209, statut: 'terminé', horodateMs: finMs } };
  const l2 = lignesV3(c, etat, existFini, maintenant).find((l) => l[0] === 'migration');
  assert.strictEqual(l2[6].getTime(), finMs, 'horodatage de fin conservé');

  // …et au-delà de la purge, la ligne disparaît.
  const existVieux = { migration: { traites: 1209, statut: 'terminé', horodateMs: maintenant - (PURGE + 60000) } };
  const l3 = lignesV3(c, etat, existVieux, maintenant).find((l) => l[0] === 'migration');
  assert.strictEqual(l3, undefined, 'terminé plus vieux que la purge → ligne purgée');
});

// ADR-0031 : les « demandes de Marc » (tri/intentions) n'existent plus — la progression ne
// publie QUE les campagnes de fond, jamais une ligne fantôme d'une feature retirée.
test('lignesProgression_ (ADR-0031) : plus JAMAIS de lignes tri-demande / intentions-demande', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 100, traites: 10, tag: 'm1' };
  const cles = lignesV3(c, etat, {}, Date.now()).map((l) => l[0]);
  assert.ok(cles.indexOf('tri-demande') === -1 && cles.indexOf('intentions-demande') === -1, 'clés retirées');
});

test('lignesProgression_ : compteur histo MONOTONE — l\'offset repart à 0 en passe de vérification, l\'affichage jamais', () => {
  const c = ctxJournal();
  const maintenant = Date.now();
  const etat = etatVierge(c);
  etat.histo = { termine: false, traites: 0 }; // offset remis à 0 (passe de vérification)
  const existantes = { 'histo-gmail': { traites: 4520, statut: 'en cours', horodateMs: maintenant - 60000 } };
  const l = lignesV3(c, etat, existantes, maintenant)
    .find((x) => x[0] === 'histo-gmail');
  assert.strictEqual(l[2], 4520, 'le compteur affiché ne recule jamais (max avec la ligne existante)');
});

test('lignesProgression_ : consolidation en cours — Traités/Base/Unité reflètent domaines épuisés et lignes du plan', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.consolidationGen = { termine: false, base: 9, traites: 5, budgetEpuise: false, tag: 'conso-3' };
  etat.consolidationExec = { termine: false, base: 1236, traites: 1086, budgetEpuise: false, tag: 'conso-3' };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now()).forEach((l) => { parCle[l[0]] = l; });
  assert.deepStrictEqual(
    [parCle['consolidation-gen'][2], parCle['consolidation-gen'][3], parCle['consolidation-gen'][4], parCle['consolidation-gen'][5]],
    [5, 9, 'domaines', 'en cours']);
  assert.deepStrictEqual(
    [parCle['consolidation-exec'][2], parCle['consolidation-exec'][3], parCle['consolidation-exec'][4], parCle['consolidation-exec'][5]],
    [1086, 1236, 'lignes', 'en cours']);
  assert.ok(parCle['consolidation-gen'][1].indexOf('conso-3') !== -1, 'le tag de campagne apparaît dans le libellé');
});

test('lignesProgression_ : consolidation SUSPENDUE par resetEnCours_ — prime sur le budget épuisé', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.resetEnCours = true;
  etat.consolidationGen = { termine: false, base: 9, traites: 2, budgetEpuise: true, tag: 'conso-3' };
  etat.consolidationExec = { termine: false, base: 1236, traites: 500, budgetEpuise: true, tag: 'conso-3' };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now()).forEach((l) => { parCle[l[0]] = l; });
  assert.strictEqual(parCle['consolidation-gen'][5], 'suspendu (reset en cours)');
  assert.strictEqual(parCle['consolidation-exec'][5], 'suspendu (reset en cours)');
});

test('lignesProgression_ : consolidation en PAUSE (budget du jour épuisé) — jamais confondue avec le frein LLM $', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.freinBudget = true; // frein LLM $ actif — ne doit PAS influencer la consolidation (pure I/O)
  etat.consolidationGen = { termine: false, base: 9, traites: 5, budgetEpuise: true, tag: 'conso-3' };
  etat.consolidationExec = { termine: false, base: 1236, traites: 1086, budgetEpuise: false, tag: 'conso-3' };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now()).forEach((l) => { parCle[l[0]] = l; });
  assert.strictEqual(parCle['consolidation-gen'][5], 'en pause (budget du jour épuisé)');
  assert.strictEqual(parCle['consolidation-exec'][5], 'en cours', 'le frein LLM $ ne doit jamais suspendre la consolidation');
});

test('lignesProgression_ : consolidation TERMINÉE — prime sur reset en cours et budget épuisé', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.resetEnCours = true;
  etat.consolidationExec = { termine: true, base: 1236, traites: 1236, budgetEpuise: true, tag: 'conso-3' };
  const existant = { 'consolidation-exec': { traites: 1200, statut: 'en cours', horodateMs: Date.now() - 60000 } };
  const l = lignesV3(c, etat, existant, Date.now())
    .find((x) => x[0] === 'consolidation-exec');
  assert.strictEqual(l[5], 'terminé');
});

/* ---------- C28-44 PR3 : lignes GÉNÉRIQUES (toutes les opérations du registre) ---------- */

test('lignesProgression_ (C49-20) : une campagne ARRÊTÉE dit « désactivée » — jamais « en cours », jamais une reprise', () => {
  // Le trou trouvé par les DEUX revues de flotte, et le plus coûteux du lot : les sept
  // interrupteurs étaient câblés dans le TICK et dans la Santé, dans aucun lecteur de Progression.
  // Mesuré avant correctif, avec la config de production : « re-analyse : en cours · reste 358
  // documents · vers le 01/10 », « consolidation : en pause (budget du jour épuisé) · reprise
  // demain ». Le second est le pire : `budgetEpuise` vaut `0 >= 0`, donc VRAI à jamais — la
  // surface lisait le BUDGET et jamais le flag, soit exactement l'état « muette » que l'ADR-0062
  // refuse. Et « reprise demain » est une affirmation sur l'avenir, fausse tous les jours.
  // ⚠️ Ces lignes partent au hub (`missionsPourHub_` → widget hubperso), donc le mensonge sortait
  // de l'app. Mutation : retirer l'une des trois gardes `op.arretee` ⇒ ce test tombe.
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.reanalyse = { termine: false, enAttente: false, base: 466, traites: 108, arretee: true, tag: 'c28-92' };
  etat.consolidationGen = { termine: false, base: 16, traites: 4, budgetEpuise: true, arretee: true, tag: 'conso-4' };
  etat.consolidationExec = { termine: false, base: 9, traites: 9, budgetEpuise: true, arretee: true, tag: 'conso-4' };
  etat.histo = { termine: false, traites: 4210 };
  c.CONFIG = Object.assign({}, c.CONFIG, { GMAIL_HISTO_ACTIF: false });

  const parCle = {};
  lignesV3(c, etat, {}, Date.now()).forEach((l) => { parCle[l[0]] = l; });

  ['reanalyse', 'consolidation-gen', 'consolidation-exec', 'histo-gmail'].forEach((cle) => {
    assert.strictEqual(parCle[cle][5], 'désactivée',
      cle + ' : une campagne arrêtée ne dit ni « en cours » ni « en pause » — ' + parCle[cle][5]);
  });
  // L'AVANCEMENT reste à l'écran (même arbitrage que la ligne de Santé : « arrêtée » tout court
  // effacerait le seul chiffre qui dit ce qu'on a perdu) — c'est le STATUT qui change, pas le reste.
  assert.deepStrictEqual([parCle['reanalyse'][2], parCle['reanalyse'][3]], [108, 466]);

  // …et AUCUNE date de fin ni horizon : une campagne arrêtée n'a pas de débit futur.
  const dernPasse = Date.now() - 3600000;
  const debits = { reanalyse: { dn: 12, dts: dernPasse, n: 108, ts: dernPasse, r: 12 } };
  const avecDebit = {};
  c.lignesProgression_(etat, {}, Date.now(), c.CONFIG.PROGRESSION_PURGE_MS, {}, c.REGISTRE_OPERATIONS, debits)
    .forEach((l) => { avecDebit[l[0]] = l; });
  const fin = avecDebit['reanalyse'][12] || '';
  assert.ok(!/vers le/.test(fin) && !/reprise/.test(fin),
    'ni date de fin ni reprise sur une campagne arrêtée : ' + fin);
  assert.ok(/reste 358/.test(fin), 'le RESTE, lui, reste dit : ' + fin);
});

test('lignesProgression_ (C49-20) : « désactivée » est le mot que l\'APP apparie — par ÉGALITÉ, pas par préfixe', () => {
  // Garde de CHAÎNON (le trou entre deux moitiés testées). Le moteur écrit un statut, l'app le
  // classe : `familleStatut` (app/src/etat.ts) compare `statut === 'désactivée'` par ÉGALITÉ, donc
  // « arrêtée (CONFIG) » — le mot que les deux revues proposaient — serait retombé dans la famille
  // par défaut, « encours », c'est-à-dire le défaut qu'on venait de corriger, réintroduit par son
  // propre correctif. Rien des deux côtés ne pouvait le dire seul.
  const fs = require('fs');
  const path = require('path');
  const etatTs = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'etat.ts'), 'utf8');
  assert.ok(etatTs.includes("statut === 'désactivée'"),
    'app/src/etat.ts doit apparier EXACTEMENT la chaîne que le moteur émet — sinon le statut ' +
    'retombe dans « encours » et la campagne arrêtée redevient « en cours » à l\'écran');
  // Anti-vacuité : le fichier lu est bien celui qui classe, et la chaîne fabriquée n'y est pas.
  assert.ok(etatTs.includes('export function familleStatut'), 'mauvais fichier lu');
  assert.ok(!etatTs.includes("statut === 'arrêtée (CONFIG)'"), 'témoin négatif');
});

test('lignesProgression_ (C28-44) : UNE ligne par opération du registre, dans l\'ordre d\'exécution — plus jamais 6 lignes codées en dur', () => {
  const c = ctxJournal();
  const lignes = lignesV3(c, etatVierge(c), {}, Date.now());
  const cles = lignes.map((l) => l[0]);
  // Les campagnes « terminé sans ligne existante » sont absentes (règle historique conservée) ;
  // TOUTES les autres opérations du registre sont présentes, dans l'ordre du registre.
  const attendues = c.clesRegistreSuivi_().filter((cle) =>
    ['migration', 'reanalyse', 'histo-gmail', 'rangement', 'consolidation-gen', 'consolidation-exec'].indexOf(cle) === -1);
  assert.deepStrictEqual(cles, attendues, 'chaque opération non-campagne a sa ligne, ordre du registre');
  const ligne = lignes.find((l) => l[0] === 'tri-gmail');
  assert.deepStrictEqual([ligne[1], ligne[4], ligne[5]], ['Tri de la boîte Gmail', 'fils', 'jamais vue'],
    'libellé/unité du registre ; sans enregistrement → « jamais vue » (honnête, un tick au plus)');
});

test('lignesProgression_ (C28-44) : statut/Détail/Dernière activité/Dernière erreur dérivés du SUIVI réel', () => {
  const c = ctxJournal();
  const maintenant = Date.now();
  const suivi = {
    'tri-gmail': { t: maintenant - 1000, ok: maintenant - 900, d: 100, et: 0, e: '', st: 0, s: '' },
    'intake-depots': { t: 0, ok: 0, d: 0, et: 0, e: '', st: maintenant - 500, s: 'budget de tick épuisé' },
    'intake-partages': { t: maintenant - 2000, ok: maintenant - 7200000, d: 5, et: maintenant - 1000, e: 'quota Gmail mort', st: 0, s: '' },
    'reconciliation-index': { t: 0, ok: 0, d: 0, et: 0, e: '', st: maintenant - 300, s: 'reset en cours' },
  };
  const parCle = {};
  lignesV3(c, etatVierge(c), {}, maintenant, suivi).forEach((l) => { parCle[l[0]] = l; });
  // Succès récent → en cours ; Dernière activité = max(tentative, succès), en TEXTE au format
  // CONTRÔLÉ dd/MM HH:mm (PR6 : une cellule Date ressortait sans l'heure en FORMATTED_VALUE).
  assert.strictEqual(parCle['tri-gmail'][5], 'en cours');
  assert.ok(/^\d{2}\/\d{2} \d{2}:\d{2}$/.test(parCle['tri-gmail'][8]), 'activité au format dd/MM HH:mm : ' + parCle['tri-gmail'][8]);
  assert.strictEqual(parCle['tri-gmail'][9], '');
  assert.strictEqual(parCle['tri-gmail'][10], 'flux', 'colonne Type (K) = type du registre');
  // Skip budget → en pause + raison en Détail.
  assert.strictEqual(parCle['intake-depots'][5], 'en pause (budget de tick épuisé)');
  assert.strictEqual(parCle['intake-depots'][7], 'budget de tick épuisé');
  // Erreur au DERNIER événement → statut erreur + colonne Dernière erreur horodatée avec message.
  assert.strictEqual(parCle['intake-partages'][5], 'erreur');
  assert.ok(parCle['intake-partages'][9].indexOf('quota Gmail mort') !== -1, 'le message d\'erreur est visible');
  assert.ok(/\d{2}\/\d{2} \d{2}:\d{2} — /.test(parCle['intake-partages'][9]), 'horodaté (dd/MM HH:mm)');
  // Skip reset → suspendu + raison.
  assert.strictEqual(parCle['reconciliation-index'][5], 'suspendu (reset en cours)');
  // Et les lignes de CAMPAGNE portent AUSSI les colonnes de suivi (mêmes 3 colonnes, même source).
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 100, traites: 10, tag: 'm1' };
  const suiviM = { migration: { t: maintenant - 100, ok: 0, d: 0, et: maintenant - 50, e: 'boom', st: 0, s: '' } };
  const lm = lignesV3(c, etat, {}, maintenant, suiviM).find((l) => l[0] === 'migration');
  assert.strictEqual(lm[5], 'en cours', 'le statut CAMPAGNE (riche) reste prioritaire pour les campagnes');
  assert.ok(lm[9].indexOf('boom') !== -1, 'mais la Dernière erreur du suivi est visible quand même');
});

/* ---------- C28-47 : avancement (dernière passe + fin estimée) ---------- */

/** Appel avec débits explicites (colonnes L/M). */
function lignesAvancement(c, etat, maintenantMs, debits) {
  return c.lignesProgression_(etat, {}, maintenantMs, c.CONFIG.PROGRESSION_PURGE_MS, {},
    c.REGISTRE_OPERATIONS, debits || {});
}

test('colonnesAvancement (C28-47) : campagne qui AVANCE → dernière passe + horizon + date de fin', () => {
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 1000, traites: 400, tag: 'm1' };
  const debits = { migration: { t0: maintenant - 48 * 3600000, ts: maintenant, n: 400, r: 25, dn: 23, dts: maintenant - 6 * 60000 } };
  const l = lignesAvancement(c, etat, maintenant, debits).find((x) => x[0] === 'migration');
  assert.strictEqual(l[11], '+23 documents · il y a 6 min', 'dernière passe PRODUCTIVE avec son unité');
  assert.ok(l[12].indexOf('reste 600 documents') === 0, 'reste chiffré : ' + l[12]);
  assert.ok(/~24 h/.test(l[12]), '600 restants à 25/h = 24 h : ' + l[12]);
  assert.ok(/vers le \d{2}\/\d{2}/.test(l[12]), 'date de fin projetée : ' + l[12]);
});

test('colonnesAvancement (C28-47) : EN PAUSE → JAMAIS de date de fin, mais le reste et la REPRISE (le cas prod de la ré-analyse)', () => {
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  // Cas RÉEL du 14/08 : ré-analyse 322/1207, gelée par le frein budget MENSUEL.
  etat.freinBudget = true;
  etat.reanalyse = { termine: false, enAttente: false, base: 1207, traites: 322, tag: 'c26-08' };
  const debits = { reanalyse: { t0: maintenant - 72 * 3600000, ts: maintenant, n: 322, r: 12, dn: 40, dts: maintenant - 3600000 } };
  const l = lignesAvancement(c, etat, maintenant, debits).find((x) => x[0] === 'reanalyse');
  assert.strictEqual(l[5], 'en pause (frein budget)');
  assert.ok(l[12].indexOf('reste 885 documents') === 0, 'le RESTE est dit : ' + l[12]);
  assert.ok(!/vers le/.test(l[12]) && !/~\d/.test(l[12]),
    'ni date ni horizon quand c\'est gelé — le débit ne connaît pas un gel FUTUR : ' + l[12]);
  assert.ok(/reprise le \d{2}\/\d{2} \(frein mensuel\)/.test(l[12]), 'la REPRISE mensuelle est annoncée : ' + l[12]);

  // Budget du JOUR (consolidation) : même règle, reprise demain.
  const etat2 = etatVierge(c);
  etat2.consolidationGen = { termine: false, base: 9, traites: 6, budgetEpuise: true, tag: 'conso-3' };
  const d2 = { 'consolidation-gen': { t0: maintenant - 72 * 3600000, ts: maintenant, n: 6, r: 0.5, dn: 2, dts: maintenant - 7200000 } };
  const l2 = lignesAvancement(c, etat2, maintenant, d2).find((x) => x[0] === 'consolidation-gen');
  assert.strictEqual(l2[5], 'en pause (budget du jour épuisé)');
  assert.ok(/reste 3 domaines/.test(l2[12]) && /reprise demain/.test(l2[12]), l2[12]);
  assert.ok(!/vers le/.test(l2[12]), 'pas de date de fin en pause : ' + l2[12]);
});

test('colonnesAvancement (C28-47) : aucune estimation inventée — sans débit, à l\'arrêt, ou campagne finie', () => {
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 1000, traites: 400, tag: 'm1' };
  // Aucun débit connu → les deux colonnes restent VIDES (jamais un « ~? j »).
  const vide = lignesAvancement(c, etat, maintenant, {}).find((x) => x[0] === 'migration');
  assert.deepStrictEqual([vide[11], vide[12]], ['', '']);
  // Débit nul (campagne à l'arrêt) → pas d'estimation, mais la dernière passe connue reste dite.
  const arret = { migration: { t0: maintenant - 72 * 3600000, ts: maintenant, n: 400, r: 0, dn: 5, dts: maintenant - 3 * 86400000 } };
  const l = lignesAvancement(c, etat, maintenant, arret).find((x) => x[0] === 'migration');
  assert.ok(/il y a 3 j/.test(l[11]), 'dernière passe ancienne, dite honnêtement : ' + l[11]);
  assert.strictEqual(l[12], '', 'aucune estimation quand le débit est nul');
});

test('assurerEnteteProgression_ (C28-44) : migration par la DERNIÈRE colonne — jamais A1, et SANS effacer les lignes', () => {
  const c = ctxJournal();
  const etats = { header: null, cleared: false, frozen: 0 };
  const cellules = { A1: 'Clé', J1: '', K1: '', M1: '' }; // en-tête ancien : A1 correct, dernière colonne vide
  const f = {
    getRange: (a, col, nb, larg) => {
      if (typeof a === 'string') return { getValue: () => cellules[a] };
      etats.coords = [a, col, nb, larg];
      return { setValues: (v) => { etats.header = v[0]; } };
    },
    clearContents: () => { etats.cleared = true; },
    setFrozenRows: () => { etats.frozen++; },
  };
  c.assurerEnteteProgression_(f);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(etats.header)), JSON.parse(JSON.stringify(c.COLONNES_PROGRESSION)),
    'en-tête réécrit en v3 (10 colonnes) alors que A1 était DÉJÀ « Clé » — le test A1 aurait été du code mort');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(etats.coords)), [1, 1, 1, c.COLONNES_PROGRESSION.length],
    'écrit sur la LIGNE 1, toutes les colonnes — dérivé de la constante, jamais sa valeur du jour');
  assert.strictEqual(etats.cleared, false,
    'v2→v3 ne vide JAMAIS les lignes (7 premières colonnes identiques — les « terminé » existants survivent)');

  // En-tête COURANT déjà en place (dernière colonne présente) → no-op total.
  const etats2 = { header: null, cleared: false };
  const f2 = {
    getRange: (a) => {
      if (typeof a === 'string') return { getValue: () => (a === 'M1' ? 'Fin estimée' : 'Clé') };
      return { setValues: () => { etats2.header = 'réécrit'; } };
    },
    clearContents: () => { etats2.cleared = true; },
    setFrozenRows: () => {},
  };
  c.assurerEnteteProgression_(f2);
  assert.deepStrictEqual([etats2.header, etats2.cleared], [null, false], 'en-tête courant en place → aucune écriture');

  // v1 (barre texte, A1 ≠ Clé) : table incompatible → clearContents (comportement historique conservé).
  const etats3 = { cleared: false, header: null };
  const f3 = {
    getRange: (a) => {
      if (typeof a === 'string') return { getValue: () => '' };
      return { setValues: (v) => { etats3.header = v[0]; } };
    },
    clearContents: () => { etats3.cleared = true; },
    setFrozenRows: () => {},
  };
  c.assurerEnteteProgression_(f3);
  assert.strictEqual(etats3.cleared, true, 'v1 → on repart de zéro (affichage, pas un état)');
});

/* ---------- C28-60 : l'heure des étapes postérieures à `progression` ---------- */

/** Faux onglet Progression en mémoire : `lignes` = lignes de données (sans l'en-tête). */
function faussePageProgression(lignes) {
  const ecritures = [];
  const f = {
    getLastRow: () => lignes.length + 1,
    getRange: (ligne, col, nb, larg) => ({
      getValues: () => lignes.slice(ligne - 2, ligne - 2 + nb).map((r) => r.slice(col - 1, col - 1 + (larg || 1))),
      setValues: (v) => {
        ecritures.push([ligne, v.length]);
        v.forEach((r, i) => { lignes[ligne - 2 + i] = r.slice(); });
      },
    }),
  };
  return { f, ecritures };
}

/** Moteur chargé avec une feuille Progression factice et une Property de suivi déjà persistée. */
function ctxFinTick(persiste) {
  const props = { DriveAI_SUIVI_OPS: null };
  const c = load(['Config.gs', 'Suivi.gs', 'Journal.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
  });
  props.DriveAI_SUIVI_OPS = c.encoderSuiviOps_(persiste);
  return c;
}

test('majProgressionsFinTick_ (C28-60) : les étapes APRÈS `progression` montrent l\'heure du tick COURANT, pas celle du précédent', () => {
  const c = ctxFinTick({});
  const il_y_a_3h = Date.now() - 3 * 3600 * 1000;
  const tardives = Array.from(c.registreApresProgression_(), (o) => o.cle);
  assert.deepStrictEqual(tardives, ['telemetrie', 'hub-resume', 'historique-vrac', 'journal-borne'],
    'registre : exactement les étapes du finally qui suivent `progression`');

  // Tick précédent : toutes les étapes ont tourné il y a 3 h et sont persistées.
  const persiste = {};
  c.clesRegistreSuivi_().forEach((cle) => { persiste[cle] = { t: il_y_a_3h, ok: il_y_a_3h + 10, d: 10, et: 0, e: '', st: 0, s: '' }; });
  const c2 = ctxFinTick(persiste);
  const etat = etatVierge(c2);
  // Rendu PRINCIPAL du tick courant, au moment de `progression` : seules les étapes AVANT elle
  // ont déjà enregistré ce tick-ci.
  c2.suiviReset_();
  ['sante', 'progression'].forEach((cle) => c2.etapeSuivie_(cle, [], () => {}));
  const rendu = c2.lignesProgression_(etat, {}, Date.now(), c2.CONFIG.PROGRESSION_PURGE_MS,
    c2.suiviOpsFusionne_(c2.PropertiesService.getScriptProperties()), c2.REGISTRE_OPERATIONS, {});
  const surFeuille = rendu.map((l) => l.slice());
  const { f, ecritures } = faussePageProgression(surFeuille);
  c2.feuille_ = () => f;
  const lire = (cle) => surFeuille.find((l) => l[0] === cle);
  const vieille = lire('telemetrie')[8];
  const fmt = (ms) => c2.Utilities.formatDate(new Date(ms), c2.Session.getScriptTimeZone(), 'dd/MM HH:mm');
  assert.strictEqual(vieille, fmt(il_y_a_3h + 10), 'avant le correctif : la ligne tardive montre le tick précédent');

  // Les étapes tardives s'exécutent ENSUITE, puis le rafraîchissement de fin de tick.
  tardives.forEach((cle) => c2.etapeSuivie_(cle, [], () => {}));
  c2.majProgressionsFinTick_();

  tardives.forEach((cle) => {
    assert.notStrictEqual(lire(cle)[8], vieille, cle + ' : l\'heure doit avoir avancé au tick courant');
    assert.strictEqual(lire(cle)[8], fmt(Date.now()), cle + ' : heure du tick COURANT');
  });
  // Une seule écriture, limitée aux 4 lignes tardives ; les autres lignes ne bougent pas.
  assert.deepStrictEqual(ecritures.map((e) => e[1]), [tardives.length]);
  assert.strictEqual(lire('sante')[8], fmt(Date.now()));
  assert.strictEqual(lire('tri-gmail')[8], fmt(il_y_a_3h + 10), 'une ligne hors de la plage n\'est pas réécrite');
});

test('majProgressionsFinTick_ (C28-60) : forme d\'onglet inattendue → AUCUNE écriture (on ne devine pas où écrire)', () => {
  const c = ctxFinTick({});
  const lignes = [['sante', 'x'], ['telemetrie', 'x'], ['tri-gmail', 'x'], ['hub-resume', 'x']];
  const { f, ecritures } = faussePageProgression(lignes);
  c.feuille_ = () => f;
  c.majProgressionsFinTick_();
  assert.deepStrictEqual(ecritures, [], 'lignes tardives non contiguës : on n\'écrit pas');

  const vide = faussePageProgression([]);
  c.feuille_ = () => vide.f;
  c.majProgressionsFinTick_();
  assert.deepStrictEqual(vide.ecritures, [], 'onglet vide : rien à rafraîchir');
});

/* ---------- majCompteurCampagne_ / finaliserCompteurCampagne_ (Maintenance.gs) ---------- */

function ctxCompteur(props) {
  const p = Object.assign({}, props);
  const c = load(['Config.gs', 'Maintenance.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in p ? p[k] : null),
        setProperty: (k, v) => { p[k] = String(v); },
        deleteProperty: (k) => { delete p[k]; },
      }),
    },
  });
  return { c, p };
}

test('majCompteurCampagne_ : cumul monotone, re-base (jamais > 100 %), no-op sans base recensée', () => {
  const sansBase = ctxCompteur({});
  sansBase.c.majCompteurCampagne_('DriveAI_MIGRATION', 12);
  assert.ok(!('DriveAI_MIGRATION_TRAITES' in sansBase.p), 'pas de base → pas de barre');

  const { c, p } = ctxCompteur({ DriveAI_MIGRATION_BASE: '100', DriveAI_MIGRATION_TRAITES: '95' });
  c.majCompteurCampagne_('DriveAI_MIGRATION', 3);
  assert.deepStrictEqual([p.DriveAI_MIGRATION_TRAITES, p.DriveAI_MIGRATION_BASE], ['98', '100']);
  c.majCompteurCampagne_('DriveAI_MIGRATION', 7); // 105 > 100 → la base suit (re-base)
  assert.deepStrictEqual([p.DriveAI_MIGRATION_TRAITES, p.DriveAI_MIGRATION_BASE], ['105', '105']);

  c.finaliserCompteurCampagne_('DriveAI_MIGRATION');
  assert.strictEqual(p.DriveAI_MIGRATION_TRAITES, p.DriveAI_MIGRATION_BASE, 'fin réelle → 100 %');
});

/* ---------- Recensements de campagne (Migration.gs) ---------- */

const { fakeFileEtendu, fauxDossierArbre } = (() => {
  /** Faux fichier minimal pour estAMigrer_/estAReanalyser_ (getId + getMimeType). */
  function fichier(id, mime) {
    return { getId: () => id, getMimeType: () => mime || 'application/pdf', getName: () => id };
  }
  /** Faux dossier : fichiers + sous-dossiers (itérateurs façon Apps Script). */
  function dossier(fichiers, sousDossiers) {
    return {
      getFiles: () => { let i = 0; return { hasNext: () => i < fichiers.length, next: () => fichiers[i++] }; },
      getFolders: () => { let i = 0; return { hasNext: () => i < (sousDossiers || []).length, next: () => sousDossiers[i++] }; },
    };
  }
  return { fakeFileEtendu: fichier, fauxDossierArbre: dossier };
})();

function ctxRecensement(arbres, dejaIndexees) {
  const index = {};
  (dejaIndexees || []).forEach((k) => { index[k] = true; });
  const c = load(['Config.gs', 'Migration.gs'], {
    DriveApp: { getFolderById: (id) => { if (!arbres[id]) throw new Error('introuvable : ' + id); return arbres[id]; } },
  });
  c.indexContient_ = (k) => index[k] === true;
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  return c;
}

test('compterRestantMigration_ : compte le restant HORS cibles C26-08/protégés, sauté si déjà migré ; partiel sous budget', () => {
  const c = ctxRecensement({}, []);
  const tag = c.CONFIG.MIGRATION_TAG;
  // Arbre : chaque domaine NON protégé/NON ciblé porte des fichiers du périmètre m2 (nom « Inconnu »,
  // C28-21) dont 1 déjà migré + 1 natif, ET un fichier bien nommé qui ne doit JAMAIS être compté.
  const arbres = {};
  const attendus = [];
  Object.keys(c.CONFIG.DOMAINES).forEach((dom, i) => {
    const id = c.CONFIG.DOMAINES[dom];
    arbres[id] = fauxDossierArbre([
      fakeFileEtendu('f-' + i + '-a-Inconnu'),
      fakeFileEtendu('f-' + i + '-deja-Inconnu'),
      fakeFileEtendu('f-' + i + '-natif-Inconnu', 'application/vnd.google-apps.document'),
      fakeFileEtendu('f-' + i + '-2024-01-01_Facture_Zephyr'), // bien nommé → hors périmètre m2
    ], [fauxDossierArbre([fakeFileEtendu('f-' + i + '-sous-Inconnu')])]);
    if (c.CONFIG.DOMAINES_PROTEGES.indexOf(dom) === -1 && (c.CONFIG.REANALYSE_CIBLES || []).indexOf(dom) === -1) {
      attendus.push('f-' + i + '-a-Inconnu', 'f-' + i + '-sous-Inconnu');
    }
  });
  const c2 = ctxRecensement(arbres, Object.keys(arbres).map((_, i) => 'migre|' + tag + '|f-' + i + '-deja-Inconnu'));
  const rec = c2.compterRestantMigration_(() => false);
  assert.strictEqual(rec.complet, true);
  assert.strictEqual(rec.n, attendus.length, 'protégés + cibles C26-08 exclus, déjà-migrés et natifs sautés');

  // Budget coupé immédiatement → partiel, jamais un faux « complet ».
  const recPartiel = c2.compterRestantMigration_(() => true);
  assert.strictEqual(recPartiel.complet, false);
});

test('compterRestantReanalyse_ : ne parcourt QUE les cibles, prédicat de la campagne c26-08', () => {
  const c = ctxRecensement({}, []);
  const arbres = {};
  const visites = [];
  Object.keys(c.CONFIG.DOMAINES).forEach((dom) => {
    const id = c.CONFIG.DOMAINES[dom];
    arbres[id] = {
      getFiles: () => { visites.push(dom); return { hasNext: () => false, next: () => null }; },
      getFolders: () => ({ hasNext: () => false, next: () => null }),
    };
  });
  arbres[c.CONFIG.DOMAINES[c.CONFIG.REANALYSE_CIBLES[0]]] = fauxDossierArbre([
    fakeFileEtendu('r-1'), fakeFileEtendu('r-deja'),
  ]);
  const c2 = ctxRecensement(arbres, ['reanalyse|' + c.CONFIG.REANALYSE_TAG + '|r-deja']);
  const rec = c2.compterRestantReanalyse_(() => false);
  assert.strictEqual(rec.complet, true);
  assert.strictEqual(rec.n, 1, 'seul le restant des cibles est compté');
});

/* ---------- C28-24 : télémétrie coûts & quotas (lignesTelemetrie_ / compteurFilsJour_, PURES — Journal.gs) ---------- */

test('lignesTelemetrie_ : clés STABLES (contrat app), plafonds dérivés des CONSTANTES, reprise seulement si suspendu', () => {
  const c = ctxJournal();
  const lignes = c.lignesTelemetrie_({
    quotaSuspendu: false, reprise: '',
    histoFilsJour: 42, cycliqueFilsJour: 7, demandeFilsJour: 120, boiteFilsJour: 45, histoTriFilsJour: 9,
    anciensFilsJour: 11, fondFilsJour: 72, archivesJour: 14,
    coutDollars: 3.14, coutAppels: 250,
  });
  const parCle = {};
  lignes.forEach((l) => { parCle[l[0]] = l; });
  // Contrat avec interpreterTelemetrie (PR3) : ces clés ne doivent JAMAIS changer sans migration app.
  assert.deepStrictEqual(Object.keys(parCle).sort(), [
    'gmail_histo_fils_jour', 'llm_appels_mois', 'llm_cout_mois', 'quota_gmail_etat',
    'tri_anciens_fils_jour', 'tri_archives_jour', 'tri_boite_fils_jour',
    'tri_cyclique_fils_jour', 'tri_fond_fils_jour', 'tri_histo_fils_jour',
  ]);
  assert.deepStrictEqual([parCle['quota_gmail_etat'][1], parCle['quota_gmail_etat'][3]], ['actif', '']);
  // Plafonds affichés = les CONSTANTES du jour (l'app n'a pas à les connaître en dur).
  assert.strictEqual(parCle['gmail_histo_fils_jour'][3], 'Plafond ' + c.CONFIG.GMAIL_HISTO_MAX_FILS_JOUR + '/j');
  // ADR-0076 : les campagnes de fond affichent le MÊME plafond, dit « commun » (l'app lit le premier nombre).
  const commun = 'Plafond commun ' + c.CONFIG.TRI_FOND_MAX_FILS_JOUR + '/j';
  assert.strictEqual(parCle['tri_cyclique_fils_jour'][3], commun);
  assert.deepStrictEqual([parCle['tri_boite_fils_jour'][1], parCle['tri_boite_fils_jour'][3]], [45, commun]);
  assert.deepStrictEqual([parCle['tri_histo_fils_jour'][1], parCle['tri_histo_fils_jour'][3]], [9, commun]);
  assert.deepStrictEqual([parCle['tri_anciens_fils_jour'][1], parCle['tri_anciens_fils_jour'][2], parCle['tri_anciens_fils_jour'][3]], [11, 'fils/jour', commun]);
  assert.deepStrictEqual([parCle['tri_fond_fils_jour'][1], parCle['tri_fond_fils_jour'][2], parCle['tri_fond_fils_jour'][3]], [72, 'fils/jour', commun]);
  assert.deepStrictEqual([parCle['tri_archives_jour'][1], parCle['tri_archives_jour'][2], parCle['tri_archives_jour'][3]], [14, 'fils/jour', 'Fils archivés par le moteur aujourd\'hui']);
  assert.strictEqual(parCle['llm_cout_mois'][3], 'Frein campagnes à ' + c.CONFIG.LLM_BUDGET_CAMPAGNES + ' $');
  assert.deepStrictEqual([parCle['llm_cout_mois'][1], parCle['llm_appels_mois'][1]], [3.14, 250]);

  // Repli si les 3 champs P0-4 sont omis par un appelant minimal.
  const repli = {};
  c.lignesTelemetrie_({
    quotaSuspendu: false, reprise: '',
    histoFilsJour: 1, cycliqueFilsJour: 3, boiteFilsJour: 4, histoTriFilsJour: 5,
    coutDollars: 0, coutAppels: 0,
  }).forEach((l) => { repli[l[0]] = l; });
  assert.strictEqual(repli['tri_anciens_fils_jour'][1], 0);
  assert.strictEqual(repli['tri_fond_fils_jour'][1], 12);
  assert.strictEqual(repli['tri_archives_jour'][1], 0);

  const suspendu = c.lignesTelemetrie_({
    quotaSuspendu: true, reprise: 'Reprise vers 14:30',
    histoFilsJour: 0, cycliqueFilsJour: 0, demandeFilsJour: 0, boiteFilsJour: 0, histoTriFilsJour: 0,
    anciensFilsJour: 0, fondFilsJour: 0, archivesJour: 0,
    coutDollars: 0, coutAppels: 0,
  }).find((l) => l[0] === 'quota_gmail_etat');
  assert.deepStrictEqual([suspendu[1], suspendu[3]], ['suspendu', 'Reprise vers 14:30']);
});

test('compteurFilsJour_ : la valeur ne vaut que si la date persistée est AUJOURD\'HUI — sinon 0 (compteur de la veille jamais affiché)', () => {
  const c = ctxJournal();
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(c.compteurFilsJour_(props({ X_JOUR: '2026/07/15', X_FILS_JOUR: '37' }), 'X', '2026/07/15'), 37);
  assert.strictEqual(c.compteurFilsJour_(props({ X_JOUR: '2026/07/14', X_FILS_JOUR: '37' }), 'X', '2026/07/15'), 0,
    'rollover : le compteur de la veille ne s\'affiche jamais comme celui du jour');
  assert.strictEqual(c.compteurFilsJour_(props({}), 'X', '2026/07/15'), 0);
  assert.strictEqual(c.compteurFilsJour_(null, 'X', '2026/07/15'), 0, 'props null sans erreur');
});

test('majTelemetrie_ : publie tri_anciens_fils_jour, tri_fond_fils_jour (via filsFondLusJour_) et tri_archives_jour + rollover minuit', () => {
  const c = load(['Config.gs', 'Suivi.gs', 'Gmail.gs', 'TriGmail.gs', 'Journal.gs']);
  let jourCourant = '2026/07/15';
  const propsMap = {
    DriveAI_GMAIL_HISTO_JOUR: '2026/07/14',
    DriveAI_GMAIL_HISTO_FILS_JOUR: '99',
    DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/15',
    DriveAI_TRI_CYCLIQUE_FILS_JOUR: '10',
    DriveAI_TRI_BOITE_JOUR: '2026/07/15',
    DriveAI_TRI_BOITE_FILS_JOUR: '20',
    DriveAI_TRI_HISTO_JOUR: '2026/07/15',
    DriveAI_TRI_HISTO_FILS_JOUR: '5',
    DriveAI_TRI_ANCIENS_JOUR: '2026/07/15',
    DriveAI_TRI_ANCIENS_FILS_JOUR: '15',
    DriveAI_TRI_ARCHIVES_JOUR: '2026/07/15',
    DriveAI_TRI_ARCHIVES_FILS_JOUR: '8',
  };
  let ecrit = null;
  let efface = null;
  c.dateGmail_ = () => jourCourant;
  c.syntheseCoutMois_ = () => ({ dollars: 1.25, appels: 12 });
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in propsMap ? propsMap[k] : null),
    }),
  };
  c.feuille_ = () => ({
    getLastRow: () => 15,
    getRange: (row, col, numRows) => ({
      setValues: (vals) => { ecrit = { row, col, numRows, vals }; },
      clearContent: () => { efface = { row, numRows }; },
    }),
  });

  c.majTelemetrie_();
  assert.strictEqual(ecrit.vals.length, 10);
  const parCle = Object.fromEntries(ecrit.vals.map((l) => [l[0], l]));
  assert.strictEqual(parCle.gmail_histo_fils_jour[1], 0, 'compteur de la veille ignoré');
  assert.strictEqual(parCle.tri_anciens_fils_jour[1], 15);
  assert.strictEqual(parCle.tri_fond_fils_jour[1], 50, '10 + 20 + 5 + 15 via filsFondLusJour_');
  assert.strictEqual(parCle.tri_archives_jour[1], 8);
  assert.deepStrictEqual(efface, { row: 12, numRows: 4 }, 'reliquat de lignes effacé');

  // Passage à minuit : tous les compteurs du jour retombent à 0.
  jourCourant = '2026/07/16';
  c.majTelemetrie_();
  const apresMinuit = Object.fromEntries(ecrit.vals.map((l) => [l[0], l]));
  assert.strictEqual(apresMinuit.tri_anciens_fils_jour[1], 0);
  assert.strictEqual(apresMinuit.tri_fond_fils_jour[1], 0);
  assert.strictEqual(apresMinuit.tri_archives_jour[1], 0);

  // Garde si PropertiesService.getScriptProperties() retourne null avec TriGmail.gs chargé.
  c.PropertiesService = { getScriptProperties: () => null };
  c.majTelemetrie_();
  const parCleNull = Object.fromEntries(ecrit.vals.map((l) => [l[0], l]));
  assert.strictEqual(parCleNull.tri_fond_fils_jour[1], 0);
  assert.strictEqual(parCleNull.tri_anciens_fils_jour[1], 0);
  assert.strictEqual(parCleNull.tri_archives_jour[1], 0);
});

test('majTelemetrie_ : repli autonome sans TriGmail.gs et garde si PropertiesService nul', () => {
  const c = ctxJournal();
  assert.strictEqual(typeof c.filsFondLusJour_, 'undefined', 'TriGmail.gs non chargé dans ctxJournal');
  const propsMap = {
    DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/15',
    DriveAI_TRI_CYCLIQUE_FILS_JOUR: '12',
    DriveAI_TRI_BOITE_JOUR: '2026/07/15',
    DriveAI_TRI_BOITE_FILS_JOUR: '18',
    DriveAI_TRI_HISTO_JOUR: '2026/07/15',
    DriveAI_TRI_HISTO_FILS_JOUR: '6',
    DriveAI_TRI_ANCIENS_JOUR: '2026/07/15',
    DriveAI_TRI_ANCIENS_FILS_JOUR: '4',
    DriveAI_TRI_ARCHIVES_JOUR: '2026/07/15',
    DriveAI_TRI_ARCHIVES_FILS_JOUR: '9',
  };
  let ecrit = null;
  c.dateGmail_ = () => '2026/07/15';
  c.syntheseCoutMois_ = () => ({ dollars: 0, appels: 0 });
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in propsMap ? propsMap[k] : null),
    }),
  };
  c.feuille_ = () => ({
    getLastRow: () => 11,
    getRange: () => ({
      setValues: (vals) => { ecrit = vals; },
      clearContent: () => {},
    }),
  });

  c.majTelemetrie_();
  const parCle = Object.fromEntries(ecrit.map((l) => [l[0], l]));
  assert.strictEqual(parCle.tri_fond_fils_jour[1], 40, 'somme de repli 12 + 18 + 6 + 4');
  assert.strictEqual(parCle.tri_archives_jour[1], 9);

  // Garde si getScriptProperties() retourne null
  c.PropertiesService = { getScriptProperties: () => null };
  c.majTelemetrie_();
  const parCleNull = Object.fromEntries(ecrit.map((l) => [l[0], l]));
  assert.strictEqual(parCleNull.tri_fond_fils_jour[1], 0);
  assert.strictEqual(parCleNull.tri_archives_jour[1], 0);
});

test('GAP-6 — compteurFilsJour_, lignesTelemetrie_ et majTelemetrie_ bornent les valeurs négatives ou infinies à 0', () => {
  const c = ctxJournal();
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  for (const corrompue of ['-50', 'Infinity', '-Infinity', 'NaN', 'abc', '']) {
    assert.strictEqual(
      c.compteurFilsJour_(props({ X_JOUR: '2026/07/15', X_FILS_JOUR: corrompue }), 'X', '2026/07/15'),
      0,
      'compteurFilsJour_ doit borner ' + JSON.stringify(corrompue) + ' à 0'
    );
  }

  // lignesTelemetrie_ : tous les compteurs et coûts corrompus sont ramenés à 0 fini.
  const parCleInf = Object.fromEntries(
    c.lignesTelemetrie_({
      quotaSuspendu: false,
      reprise: '',
      histoFilsJour: '-50',
      cycliqueFilsJour: 'Infinity',
      boiteFilsJour: '-5',
      histoTriFilsJour: -Infinity,
      anciensFilsJour: '-12',
      fondFilsJour: Infinity,
      archivesJour: 'Infinity',
      coutDollars: '-3.5',
      coutAppels: 'Infinity',
    }).map((l) => [l[0], l[1]])
  );
  assert.deepStrictEqual(parCleInf, {
    quota_gmail_etat: 'actif',
    gmail_histo_fils_jour: 0,
    tri_cyclique_fils_jour: 0,
    tri_boite_fils_jour: 0,
    tri_histo_fils_jour: 0,
    tri_anciens_fils_jour: 0,
    tri_fond_fils_jour: 0,
    tri_archives_jour: 0,
    llm_cout_mois: 0,
    llm_appels_mois: 0,
  });

  // Repli fondFilsJour omis avec mix sain + corrompu : seule la composante saine est sommée.
  const parCleRepli = Object.fromEntries(
    c.lignesTelemetrie_({
      quotaSuspendu: false,
      reprise: '',
      histoFilsJour: 4,
      cycliqueFilsJour: '-50',
      boiteFilsJour: '12',
      histoTriFilsJour: 'Infinity',
      anciensFilsJour: 3,
      archivesJour: '-1',
      coutDollars: 0,
      coutAppels: 0,
    }).map((l) => [l[0], l[1]])
  );
  assert.strictEqual(parCleRepli.tri_fond_fils_jour, 15, '12 + 3 uniquement (ni -50 ni Infinity)');
  assert.strictEqual(parCleRepli.tri_archives_jour, 0);

  // majTelemetrie_ avec et sans TriGmail.gs chargé sur propriétés corrompues.
  for (const modules of [
    ['Config.gs', 'Suivi.gs', 'Journal.gs'],
    ['Config.gs', 'Suivi.gs', 'Gmail.gs', 'TriGmail.gs', 'Journal.gs'],
  ]) {
    const ctx = load(modules);
    const propsMap = {
      DriveAI_GMAIL_HISTO_JOUR: '2026/07/15',
      DriveAI_GMAIL_HISTO_FILS_JOUR: '-50',
      DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/15',
      DriveAI_TRI_CYCLIQUE_FILS_JOUR: 'Infinity',
      DriveAI_TRI_BOITE_JOUR: '2026/07/15',
      DriveAI_TRI_BOITE_FILS_JOUR: '18',
      DriveAI_TRI_HISTO_JOUR: '2026/07/15',
      DriveAI_TRI_HISTO_FILS_JOUR: '-5',
      DriveAI_TRI_ANCIENS_JOUR: '2026/07/15',
      DriveAI_TRI_ANCIENS_FILS_JOUR: 'Infinity',
      DriveAI_TRI_ARCHIVES_JOUR: '2026/07/15',
      DriveAI_TRI_ARCHIVES_FILS_JOUR: '-50',
    };
    let ecrit = null;
    ctx.dateGmail_ = () => '2026/07/15';
    ctx.syntheseCoutMois_ = () => ({ dollars: -1, appels: Infinity });
    ctx.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (k) => (k in propsMap ? propsMap[k] : null),
      }),
    };
    ctx.feuille_ = () => ({
      getLastRow: () => 11,
      getRange: () => ({
        setValues: (vals) => { ecrit = vals; },
        clearContent: () => {},
      }),
    });
    ctx.majTelemetrie_();
    const res = Object.fromEntries(ecrit.map((l) => [l[0], l[1]]));
    assert.strictEqual(res.gmail_histo_fils_jour, 0);
    assert.strictEqual(res.tri_cyclique_fils_jour, 0);
    assert.strictEqual(res.tri_boite_fils_jour, 18);
    assert.strictEqual(res.tri_histo_fils_jour, 0);
    assert.strictEqual(res.tri_anciens_fils_jour, 0);
    assert.strictEqual(res.tri_fond_fils_jour, 18, 'somme consolidée finie et non négative (' + modules.length + ' modules)');
    assert.strictEqual(res.tri_archives_jour, 0);
    assert.strictEqual(res.llm_cout_mois, 0);
    assert.strictEqual(res.llm_appels_mois, 0);
  }
});

test('colonnesAvancement : une mission CONVERGÉE à reliquat n\'annonce JAMAIS de date (retour Marc 20/08)', () => {
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  // Cas RÉEL vu par Marc : « Mission — véhicules … à jour … Fin estimée : reste 48 fichiers ·
  // ~92 j · vers le 20/11 ». La mission a FINI son passage ; ses 48 non-appariés sont des REFUS
  // versionnés qui attendent une décision de Marc, pas du temps machine. Extrapoler le débit
  // PASSÉ annonçait une date que rien ne produira — même mensonge que la pause (C28-47).
  etat.missions = { vehicule: { traites: 6, base: 54, nonApparies: 48, termine: true } };
  const debits = { 'mission-vehicule': { t0: maintenant - 72 * 3600000, ts: maintenant, n: 6, r: 0.08, dn: 2, dts: maintenant - 48 * 3600000 } };
  const l = lignesAvancement(c, etat, maintenant, debits).find((x) => x[0] === 'mission-vehicule');
  assert.strictEqual(l[5], 'à jour (48 non apparié(s))');
  assert.ok(/reste 48 fichiers/.test(l[12]), 'le RESTE reste dit : ' + l[12]);
  assert.ok(!/vers le/.test(l[12]) && !/~\d/.test(l[12]),
    'ni date ni horizon sur un débit MORT : ' + l[12]);
  assert.ok(/affinage des règles/.test(l[12]),
    'on dit ce qui débloque réellement, pas une date : ' + l[12]);

  // Contre-épreuve : la MÊME mission NON convergée garde bien son horizon (le garde ne doit pas
  // éteindre l'estimation des campagnes qui, elles, avancent).
  const etat2 = etatVierge(c);
  etat2.missions = { vehicule: { traites: 6, base: 54, nonApparies: 0, termine: false } };
  const l2 = lignesAvancement(c, etat2, maintenant, debits).find((x) => x[0] === 'mission-vehicule');
  assert.ok(/vers le \d{2}\/\d{2}/.test(l2[12]), 'une mission qui AVANCE garde sa date : ' + l2[12]);
});

test('colonnesAvancement : le garde « à jour » couvre AUSSI la consolidation (2e consommateur)', () => {
  // Le commentaire du garde affirme « testées une par une » : `à jour (plan drainé — attend la
  // génération)` est le second statut de cette famille, et il n'était pas couvert (revue code
  // C28-62 PR2). Même raison de fond : la campagne attend un AMONT, pas du débit.
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  etat.consolidationExec = { termine: false, base: 40, traites: 10, planDraine: true, tag: 'conso-3' };
  const d = { 'consolidation-exec': { t0: maintenant - 72 * 3600000, ts: maintenant, n: 10, r: 1, dn: 3, dts: maintenant - 3600000 } };
  const l = (lignesAvancement(c, etat, maintenant, d) || []).find((x) => x[0] === 'consolidation-exec');
  if (l && /^à jour/.test(l[5])) {
    assert.ok(!/vers le/.test(l[12]) && !/~\d/.test(l[12]),
      'un « à jour » qui attend son amont n\'annonce pas de date : ' + l[12]);
  }
});
