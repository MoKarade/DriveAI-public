'use strict';
/**
 * PILOTE CI (ADR-0032, C28-43) — « plus jamais lancer à la main, et plus vite que le manuel ».
 *
 * Ce que ces tests verrouillent, dans l'ordre du risque :
 *  1. le pilote ne doit JAMAIS passer par un chemin qui CRÉE un déclencheur (sinon il consomme le
 *     quota ~90 min/j qu'il est censé contourner → gel de TOUS les déclencheurs, C28-29) ;
 *  2. il tourne en mode `manuel` (ni gaté, ni compté) — sinon il est bridé par les budgets du tick
 *     et n'apporte AUCUNE vitesse, et pire, il affamerait l'automatique (double peine C28-33) ;
 *  3. il s'arrête sur la VRAIE convergence (reliquat LLM compris), pas sur `resetTermine_()` seul ;
 *  4. il ne tourne jamais en parallèle d'un tick (verrou), et il est arrêtable par un flag ;
 *  5. la pause CI reste > TICK_MINUTES : c'est ce qui garantit que le flux vivant n'est pas affamé.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

const FICHIERS = ['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs'];
const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const PHASES = ['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'analyserReliquatReset_'];
/** Seulement les appels de PHASE (le contexte web app en pousse d'autres : usage, panne…). */
const phasesDe = (appels) => appels.filter((a) => PHASES.indexOf(a.phase) !== -1);

/** Contexte : les 4 phases mockées, verrou disponible, Properties en mémoire. */
function ctxPilote(opts) {
  opts = opts || {};
  const c = load(FICHIERS);
  // RESET_ACTIF FORCÉ dans le contexte (leçon §7 : un test d'un chemin gaté par un flag de campagne
  // FORCE ce flag ; la valeur GLOBALE — retirée à false 2026-08-05, ADR-0035 — est une décision de
  // Marc, jamais un invariant de test). Le test « refus si RESET_ACTIF=false » le remet à false lui-même.
  c.CONFIG.RESET_ACTIF = true;
  const appels = [];
  const props = Object.assign({}, opts.props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  let relaches = 0;
  c.LockService = { getScriptLock: () => ({
    tryLock: () => !opts.verrouOccupe,
    releaseLock: () => { relaches++; },
  }) };
  c.journalInfo_ = () => {};
  c.journalErreur_ = (s, m) => appels.push({ phase: 'erreur', message: m });
  c.notifierEchec_ = (s, m) => appels.push({ phase: 'alerte', message: m });
  c.dateGmail_ = () => '2026/07/31'; // vit dans Gmail.gs (non chargé)
  // Contexte d'exécution web app : compteur d'usage propre + panne plateforme (patron WebApp.gs).
  c.chargerPannePlateforme_ = () => { appels.push({ phase: 'chargerPanne' }); };
  c.reinitialiserUsage_ = () => { appels.push({ phase: 'initUsage' }); };
  c.flushUsage_ = () => { appels.push({ phase: 'flushUsage' }); };
  c.marquerVieManuelleReset_ = () => { appels.push({ phase: 'LAST_MANUEL' }); };
  // Chaque phase renvoie un résultat NON stérile une fois, puis stérile (convergence simulée).
  // `=== undefined`, jamais `||` : `{rondes: 0}` (cas « tout stérile ») doit valoir 0, pas le défaut.
  const restant = {
    rassemblerReset_: opts.rondes === undefined ? 1 : opts.rondes,
    placerReset_: 0, appliquerReset04Interne_: 0,
    analyserReliquatReset_: opts.rondesLlm === undefined ? 0 : opts.rondesLlm,
  };
  ['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'analyserReliquatReset_'].forEach((nom) => {
    // Le mock lit ses ARGUMENTS (jamais une fermeture) — sinon deux appels d'une même passe
    // seraient indiscernables (leçon C28-33 sur les mocks partagés).
    c[nom] = (garde, manuel, tentes) => {
      appels.push({ phase: nom, manuel: manuel, garde: typeof garde, tentes: tentes });
      if (restant[nom] > 0) { restant[nom]--; return { examines: 1, deplaces: 1 }; }
      return { examines: 0, deplaces: 0 };
    };
  });
  c.resetTermine_ = () => !!opts.resetTermine;
  return { c, appels, props, relachesRef: () => relaches };
}

/* ---------- 1. Le pilote ne crée JAMAIS de déclencheur (le quota qu'il contourne) ---------- */

test('SÛRETÉ QUOTA : l\'action « pousser-reset » exécute le travail SYNCHRONEMENT — jamais via actionTickPonctuel_ (qui CRÉE un déclencheur)', () => {
  const webapp = SRC('WebApp.gs');
  const i = webapp.indexOf("action === 'pousser-reset'");
  assert.ok(i !== -1, 'branche pousser-reset introuvable dans le doPost');
  const branche = webapp.slice(i, i + 220);
  assert.ok(/pousserResetPilote_\(\)/.test(branche),
    'la branche doit appeler directement le noyau synchrone');
  assert.ok(!/actionTickPonctuel_|newTrigger/.test(branche),
    'JAMAIS de création de déclencheur : ScriptApp.newTrigger consommerait le quota ~90 min/j que ' +
    'tout ce montage protège — le pilote deviendrait la cause du gel qu\'il évite (C28-29)');
  // Et le noyau lui-même ne crée aucun déclencheur.
  const reset = SRC('Reset.gs');
  const j = reset.indexOf('function pousserResetPilote_(');
  const corps = reset.slice(j, reset.indexOf('\n}', j));
  assert.ok(!/newTrigger|ScriptApp\./.test(corps), 'le noyau du pilote ne touche à aucun déclencheur');
  // Même exigence pour l'audit du tri (#907) : synchrone, sous le verrou du tick, aucun déclencheur.
  const k = webapp.indexOf('function actionAuditTri_(');
  const corpsAudit = webapp.slice(k, webapp.indexOf('\n}', k));
  assert.ok(/acquerirVerrouReset_\(/.test(corpsAudit) && /releaseLock\(\)/.test(corpsAudit), 'l\'audit prend et rend le verrou du moteur');
  assert.ok(!/newTrigger|ScriptApp\.|actionTickPonctuel_/.test(corpsAudit), 'l\'audit ne crée aucun déclencheur');
});

test('SÛRETÉ SECRET : « pousser-reset », « assurer-trigger » et « audit-tri » exigent le secret CI DÉDIÉ (jamais celui exposé au navigateur)', () => {
  const webapp = SRC('WebApp.gs');
  ["action === 'pousser-reset'", "action === 'assurer-trigger'", "action === 'audit-tri'"].forEach((motif) => {
    const i = webapp.indexOf(motif);
    assert.ok(i !== -1, motif + ' introuvable');
    const branche = webapp.slice(i, i + 500);
    assert.ok(/verifierSecretSync_\(e\)/.test(branche),
      motif + ' doit être gardée par le secret CI (DriveAI_SYNC_SECRET), jamais par DriveAI_WEBAPP_SECRET ' +
      'qui est exposé côté navigateur par conception');
    assert.ok(/erreur: 'refusé'/.test(branche), 'échec fermé si le secret ne correspond pas');
    assert.ok(/antiRafalePilote_\(/.test(branche),
      'anti-rafale OBLIGATOIRE : l\'en-tête du fichier le promet pour toute action, et sans lui ' +
      '`assurer-trigger` rappelé plus vite que TICK_MINUTES empêcherait le tick de jamais se déclencher');
  });
});

/* ---------- 1 bis. `audit-tri` (ADR-0075 §3) : l'audit du tri sans le geste de Marc ---------- */

function ctxAudit(detail, opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'WebApp.gs']);
  const props = { DriveAI_SYNC_SECRET: 'secret-ci', DriveAI_WEBAPP_SECRET: 'secret-web' };
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };
  c.poserOperationCourante_ = () => {};
  let appels = 0;
  let liberations = 0;
  c.acquerirVerrouReset_ = () => (opts.verrouPris ? null : { releaseLock: () => { liberations++; } });
  c.auditerTriSujetCorpsDetail_ = () => { appels++; if (detail instanceof Error) throw detail; return detail; };
  const post = (secret) => JSON.parse(c.doPost({ parameter: { action: 'audit-tri', secret } }));
  return { post, appels: () => appels, liberations: () => liberations, props };
}

test('audit-tri : secret CI dédié, anti-rafale d\'une heure, et la réponse ne porte que des compteurs et des métadonnées', () => {
  const detail = { texte: 'Audit tri sujet+corps : 2 fils comparés', refuse: false, panne: false, fils: 2, demandes: 2,
    accordCat: 1, accordImp: 1, interrompu: '', divergences: [{ ligne: 3, catHier: 'Finance', catDemain: 'Abonnements',
      impHier: false, impDemain: true, suspHier: false, suspDemain: false, zone: false, portes: '' }] };
  const { post, appels, liberations, props } = ctxAudit(detail);
  assert.deepStrictEqual(post('secret-web'), { ok: false, erreur: 'refusé' }, 'le secret de l\'app (exposé au navigateur) ne suffit JAMAIS');
  assert.deepStrictEqual(post('mauvais'), { ok: false, erreur: 'refusé' });
  assert.strictEqual(appels(), 0, 'rien n\'a tourné sans le bon secret');
  const r = post('secret-ci');
  assert.strictEqual(r.ok, true); assert.strictEqual(r.lance, true);
  assert.ok(/min\|/.test(r.version), 'signal indépendant de la version servie, comme assurer-trigger');
  assert.strictEqual(r.audit.fils, 2); assert.strictEqual(r.audit.divergences.length, 1); assert.strictEqual(r.audit.divergences[0].ligne, 3);
  assert.ok(!/"(sujet|domaine|corps)"/i.test(JSON.stringify(r)),
    'l\'enveloppe de la web app n\'ajoute aucune clé de contenu (le moteur lui-même est vérifié dans tri-sujet-corps.test.js)');
  assert.strictEqual(liberations(), 1, 'le verrou du moteur est pris puis rendu (jamais en même temps qu\'un tick)');
  const deuxieme = post('secret-ci');
  assert.strictEqual(deuxieme.lance, false, 'anti-rafale : pas deux audits dans l\'heure');
  assert.strictEqual(appels(), 1);
  props.DriveAI_DERNIER_AUDIT_TRI = String(Date.now() - 61 * 60 * 1000);
  assert.strictEqual(post('secret-ci').lance, true, 'la fenêtre est d\'une heure');
});

test('audit-tri : quand rien n\'a tourné (panne LLM, tick en cours, exception), la fenêtre d\'une heure est RENDUE et le verrou toujours libéré', () => {
  const vide = { texte: 'Panne LLM en cours', refuse: true, panne: true, fils: 0, demandes: 0, accordCat: 0, accordImp: 0, nouveaux: 0, retires: 0, interrompu: '', divergences: [] };
  const panne = ctxAudit(vide);
  const rp = panne.post('secret-ci');
  assert.strictEqual(rp.ok, true); assert.strictEqual(rp.lance, false, 'panne LLM : dit, jamais confondu avec un audit vide');
  assert.strictEqual(panne.props.DriveAI_DERNIER_AUDIT_TRI, undefined, 'fenêtre rendue : la relance dans l\'heure est possible');
  assert.strictEqual(panne.liberations(), 1);
  const occupe = ctxAudit(vide, { verrouPris: true });
  const ro = occupe.post('secret-ci');
  assert.strictEqual(ro.lance, false); assert.match(ro.message, /tick en cours/);
  assert.strictEqual(occupe.appels(), 0, 'verrou tenu par un tick : l\'audit ne tourne pas');
  assert.strictEqual(occupe.props.DriveAI_DERNIER_AUDIT_TRI, undefined, 'fenêtre rendue');
  const casse = ctxAudit(new Error('quota Gmail'));
  const rc = casse.post('secret-ci');
  assert.strictEqual(rc.ok, false); assert.match(rc.erreur, /quota Gmail/);
  assert.strictEqual(casse.liberations(), 1, 'verrou libéré même sur exception');
  assert.strictEqual(casse.props.DriveAI_DERNIER_AUDIT_TRI, undefined, 'fenêtre rendue sur exception');
});

test('workflow : l\'entrée `action=audit-tri` réutilise les secrets existants (aucune ligne `secrets.` ajoutée) et n\'écrit jamais un sujet au journal', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pousser-reset.yml'), 'utf8');
  const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.strictEqual((wf.match(/\bsecrets\.[A-Za-z_]/g) || []).length, 4, // la même règle que le Garde-fou (SECRETS_CI)
    'quatre références à des secrets, comme avant : en ajouter une est un geste de Marc (Garde-fou), et rien de nouveau n\'a à être exposé');
  assert.ok(/inputs\.action \|\| 'pousser-reset'/.test(code), 'sans entrée (cron, ancien lancement), le rangement reste le défaut');
  assert.ok(/options:\s*\n\s*- pousser-reset\s*\n\s*- audit-tri/.test(wf), 'les deux actions sont les seules proposées');
  const debut = code.indexOf('if [ "$ACTION" = "audit-tri" ]');
  assert.ok(debut !== -1, 'branche audit-tri introuvable');
  const bloc = code.slice(debut, code.indexOf('TERMINE=0', debut));
  assert.ok(/action=audit-tri&secret=\$\{SECRET_ENC\}/.test(bloc), 'même encodage URL du secret que le rangement');
  assert.ok(/jq -e '\.ok == true and \.lance == true'/.test(bloc), 'succès jugé au CONTENU : ok ET lance (une panne LLM rend ok:true, lance:false)');
  // TOUT ce que `jq` lit dans la réponse (compteurs, `.audit.divergences[]`, messages d'erreur) : jamais une clé de contenu.
  const lectures = [...bloc.matchAll(/jq(?: -[a-z]+)* '([^']+)'/g)].map((m) => m[1]);
  assert.ok(lectures.length >= 6, 'les lectures jq de la branche sont bien captées : ' + lectures.length);
  assert.ok(!/sujet|domaine|corps/i.test(lectures.join(' ')), 'aucune clé de contenu lue par jq : ' + lectures.join(' | '));
  assert.strictEqual((bloc.match(/exit 1/g) || []).length, 4, 'audit non lancé, sans valeur (panne ou 0 fil), refusé ou réponse inconnue ⇒ run ROUGE (jamais un avertissement)');
  assert.ok(/\.audit\.panne == true or \.audit\.fils == 0/.test(bloc), 'un audit « lancé » mais sans valeur n\'est pas un vert silencieux');
  assert.ok(!/catHier|catDemain/.test(bloc), 'les libellés Gmail de Marc ne sont pas écrits au journal CI');
  assert.ok(/exit 0/.test(bloc), 'après un audit réussi, le rangement ne tourne PAS dans le même run');
});

/* ---------- 2. Mode `manuel` : c'est TOUT l'intérêt (hors quota déclencheurs) ---------- */

test('les 4 phases sont appelées en mode MANUEL (ni gatées, ni comptées) — sinon le pilote n\'apporte aucune vitesse', () => {
  const { c, appels } = ctxPilote({ rondes: 1 });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.ok, true);
  const phases = phasesDe(appels);
  assert.ok(phases.length >= 4, 'les 4 phases doivent être servies (round-robin), vu : ' + phases.length);
  phases.forEach((a) => {
    assert.strictEqual(a.manuel, true,
      a.phase + ' doit recevoir manuel=true : les budgets QUOTIDIENS protègent le quota des ' +
      'DÉCLENCHEURS, dont la web app ne fait pas partie. Sans ce drapeau, le pilote serait bridé ET ' +
      'consommerait le budget du tick (double peine C28-33)');
    assert.strictEqual(a.garde, 'function', a.phase + ' doit recevoir un garde-temps (part du mur)');
  });
  assert.ok(['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'analyserReliquatReset_']
    .every((n) => phases.some((a) => a.phase === n)), 'la passe LLM du reliquat fait partie du pilotage (ADR-0032 §2.3)');
});

test('analyserReliquatReset_ en mode manuel : ni gatée par le budget quotidien, ni comptée dedans (mais plafond d\'items CONSERVÉ)', () => {
  const reset = SRC('Reset.gs');
  const i = reset.indexOf('function analyserReliquatReset_(');
  const corps = reset.slice(i, reset.indexOf('\n}\n', i));
  assert.ok(/function analyserReliquatReset_\(estBudgetDepasse, manuel, tentes\)/.test(reset),
    'la passe LLM accepte le drapeau manuel ET la mémoire des documents tentés (ADR-0032 §2.3)');
  assert.ok(/if \(!manuel && consommeJour >= CONFIG\.RESET_LLM_BUDGET_JOUR_MS\)/.test(corps),
    'gate quotidien coupé en manuel');
  assert.ok(/if \(!manuel\) props\.setProperty\('DriveAI_RESET_LLM_JOUR'/.test(corps),
    'comptage quotidien coupé en manuel — sinon le pilote affamerait le tick automatique (leçon C28-33 : ' +
    'les deux moitiés du drapeau, gate ET comptage, se coupent ENSEMBLE)');
  // Le coût $ reste borné par le plafond d'items, lui JAMAIS conditionné par `manuel`.
  const page = reset.slice(reset.indexOf('function analyserPageReliquatReset_('));
  assert.ok(/CONFIG\.RESET_LLM_MAX_PAR_RUN/.test(page.slice(0, page.indexOf('\n}\n'))),
    'le plafond d\'items borne le coût de CHAQUE passe, y compris poussée');
  assert.ok(!/manuel/.test(page.slice(0, page.indexOf('\n}\n'))),
    'le plafond d\'items ne doit JAMAIS être levé par le mode manuel (c\'est lui qui borne les $)');
});

/* ---------- 3. Arrêt sur la VRAIE convergence ---------- */

test('pilotageTermineReset_ exige AUSSI le drainage du reliquat LLM — s\'arrêter sur resetTermine_ seul laisserait les « Inconnu » au ralenti', () => {
  const c0 = load(FICHIERS);
  const fin = c0.CONFIG.RESET_TAG + '|' + c0.CONFIG.RESET_TABLE_VERSION;

  // I/O terminé mais reliquat NON drainé → le pilote continue.
  const partiel = ctxPilote({ resetTermine: true });
  assert.strictEqual(partiel.c.pilotageTermineReset_(), false);
  const r1 = partiel.c.pousserResetPilote_();
  assert.strictEqual(r1.termine, false, 'ne jamais déclarer « terminé » tant que le reliquat n\'est pas drainé');

  // I/O terminé ET reliquat drainé → terminé, et AUCUNE phase n'est même appelée.
  const fini = ctxPilote({ resetTermine: true, props: { DriveAI_RESET_LLM: fin } });
  const r2 = fini.c.pousserResetPilote_();
  assert.strictEqual(r2.termine, true);
  assert.strictEqual(fini.appels.length, 0, 'convergence ⇒ court-circuit total (coût nul pour les runs suivants)');
});

/* ---------- 4. Verrou, interrupteur, robustesse ---------- */

test('anti-chevauchement : si le tick tient le verrou, la passe est SAUTÉE proprement (jamais deux mutations en parallèle)', () => {
  const { c, appels } = ctxPilote({ verrouOccupe: true });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.ok, true, 'ce n\'est pas une erreur : le tick fait déjà le travail');
  assert.strictEqual(r.rondes, 0);
  assert.strictEqual(appels.length, 0, 'aucune phase ne tourne sans le verrou');
});

test('le verrou est TOUJOURS relâché, même sur une exception HORS phase (sinon le tick suivant est bloqué 6 min)', () => {
  const ctx = ctxPilote({});
  // Une exception dans une PHASE est désormais isolée (test dédié plus bas) : on éprouve ici le
  // `finally` du noyau avec un échec qui n'est PAS enveloppé par phase().
  ctx.c.journalInfo_ = () => { throw new Error('Journal indisponible'); };
  const r = ctx.c.pousserResetPilote_();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(ctx.relachesRef(), 1, 'releaseLock dans le finally');
  assert.ok(ctx.appels.some((a) => a.phase === 'erreur'), 'l\'échec est journalisé, jamais silencieux');
  assert.ok(ctx.appels.some((a) => a.phase === 'flushUsage'), 'le coût déjà engagé est tout de même persisté');
});

test('interrupteur : PILOTE_ACTIF=false ou RESET_ACTIF=false ⇒ refus IMMÉDIAT, zéro phase, zéro verrou', () => {
  const sansPilote = ctxPilote({});
  sansPilote.c.CONFIG.PILOTE_ACTIF = false;
  const r1 = sansPilote.c.pousserResetPilote_();
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(sansPilote.appels.length, 0);

  const sansReset = ctxPilote({});
  sansReset.c.CONFIG.RESET_ACTIF = false;
  const r2 = sansReset.c.pousserResetPilote_();
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(sansReset.appels.length, 0);
});

test('une ronde entièrement stérile ARRÊTE la boucle (jamais de spin qui re-scanne le Drive jusqu\'au mur)', () => {
  const { c, appels } = ctxPilote({ rondes: 0 }); // toutes les phases stériles d'emblée
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.rondes, 1, 'une seule ronde, puis sortie');
  assert.strictEqual(r.progres, false);
  assert.strictEqual(phasesDe(appels).length, 4, 'exactement un tour des 4 phases');
});

/* ---------- 6. Correctifs de la revue flotte C28-43 (chaque bloquant a son verrou) ---------- */

test('BLOQUANT sécurité : le coût LLM d\'une passe poussée est COMPTÉ (sinon le frein budget §2.6 est aveugle sur le chemin dominant)', () => {
  const { c, appels } = ctxPilote({ rondes: 1 });
  c.pousserResetPilote_();
  const noms = appels.map((a) => a.phase);
  assert.ok(noms.includes('initUsage'),
    'contexte web app ≠ tick : sans reinitialiserUsage_, l\'accumulateur reste null et AUCUNE dépense n\'est comptée');
  assert.ok(noms.includes('flushUsage'), 'le coût doit être persisté en fin de passe (finally)');
  assert.ok(noms.indexOf('initUsage') < noms.indexOf('rassemblerReset_'), 'initialisé AVANT tout travail');
  assert.ok(noms.includes('chargerPanne'),
    'sans chargerPannePlateforme_, la suspension persistée est ignorée → re-sondes en boucle pendant une panne de compte');
});

test('BLOQUANT sécurité : une passe poussée n\'écrit JAMAIS DriveAI_LAST_MANUEL (sinon le chien de garde est muet toute la campagne)', () => {
  const { c, appels, props } = ctxPilote({ rondes: 1 });
  c.pousserResetPilote_();
  assert.ok(!appels.some((a) => a.phase === 'LAST_MANUEL'),
    'le pilote tourne toutes les ~7 min pendant des jours : rafraîchir le signal de vie manuel rendrait ' +
    'l\'alerte ET l\'auto-réparation mortes pendant toute la campagne — exactement le scénario à voir');
  assert.strictEqual(props.DriveAI_LAST_MANUEL, undefined);
});

test('détecteur de GEL : ticks silencieux ⇒ passe REFUSÉE + alerte (le pilote signale le gel au lieu de le masquer)', () => {
  const c0 = load(FICHIERS);
  const vieux = String(Date.now() - (c0.CONFIG.WATCHDOG_SEUIL_MS + 60000));
  const { c, appels } = ctxPilote({ rondes: 1, props: { DriveAI_LAST_TICK: vieux } });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.gel, true);
  assert.strictEqual(r.rondes, 0);
  assert.ok(!appels.some((a) => a.phase === 'rassemblerReset_'), 'aucun travail : le flux vivant prime sur le rangement');
  assert.ok(appels.some((a) => a.phase === 'alerte'), 'une alerte part (canal mail, indépendant des déclencheurs)');

  // Tick frais → la passe tourne normalement ; première installation (pas de LAST_TICK) → jamais bloquée.
  const frais = ctxPilote({ rondes: 1, props: { DriveAI_LAST_TICK: String(Date.now()) } });
  assert.notStrictEqual(frais.c.pousserResetPilote_().gel, true);
  const neuf = ctxPilote({ rondes: 1 });
  assert.notStrictEqual(neuf.c.pousserResetPilote_().gel, true);
});

test('BORNE DU PARI : budget QUOTIDIEN en ms réelles — épuisé ⇒ aucune passe, et la consommation est persistée', () => {
  const c0 = load(FICHIERS);
  const epuise = ctxPilote({ rondes: 1, props: { DriveAI_PILOTE_JOUR: '2026/07/31|' + c0.CONFIG.PILOTE_BUDGET_JOUR_MS } });
  const r = epuise.c.pousserResetPilote_();
  assert.strictEqual(r.rondes, 0);
  assert.ok(!epuise.appels.some((a) => a.phase === 'rassemblerReset_'),
    'si le pari « web app hors quota » est faux, cette borne est tout ce qui empêche le gel');

  const actif = ctxPilote({ rondes: 1 });
  actif.c.pousserResetPilote_();
  assert.ok(String(actif.props.DriveAI_PILOTE_JOUR || '').indexOf('2026/07/31|') === 0,
    'ms réelles persistées — c\'est aussi la MESURE qui permettra de trancher le pari');
});

test('quarantaine : un document du reliquat n\'est tenté qu\'UNE fois par exécution (3 essais en 2 min = perte définitive)', () => {
  const { c, appels } = ctxPilote({ rondes: 3, rondesLlm: 3 });
  c.pousserResetPilote_();
  const llm = appels.filter((a) => a.phase === 'analyserReliquatReset_');
  assert.ok(llm.length >= 2, 'plusieurs rondes ont bien appelé la phase LLM');
  llm.forEach((a) => assert.ok(a.tentes && typeof a.tentes === 'object',
    'la mémoire des documents tentés doit être passée à CHAQUE appel : sans elle, la même exécution ' +
    'rejoue le même fichier et brûle ses 3 essais sur un blip transitoire → quarantaine sans retour'));
  assert.strictEqual(llm[0].tentes, llm[1].tentes, 'la MÊME mémoire est partagée par les rondes d\'une passe');
});

test('anti-stagnation : après PILOTE_STERILES_MAX passes sans progrès ⇒ alerte + veille (jamais 192 walks/jour pour rien)', () => {
  const c0 = load(FICHIERS);
  const MAX = c0.CONFIG.PILOTE_STERILES_MAX;
  const { c, appels, props } = ctxPilote({ rondes: 0, props: { DriveAI_PILOTE_STERILES: String(MAX - 1) } });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.stagnation, true, 'le workflow doit pouvoir arrêter d\'insister');
  assert.ok(appels.some((a) => a.phase === 'alerte'), 'Marc est prévenu que le rangement est bloqué');

  // Une passe qui PROGRESSE remet le compteur à zéro (le gate se teste par sa LIBÉRATION).
  const repart = ctxPilote({ rondes: 1, props: { DriveAI_PILOTE_STERILES: String(MAX - 1) } });
  assert.strictEqual(repart.c.pousserResetPilote_().stagnation, false);
  assert.strictEqual(repart.props.DriveAI_PILOTE_STERILES, undefined, 'compteur remis à zéro');
});

test('isolation : une phase qui lève ne tue pas les autres (leçon « étape secondaire enveloppée »)', () => {
  const ctx = ctxPilote({ rondes: 1 });
  ctx.c.rassemblerReset_ = () => { throw new Error('blip Sheet'); };
  const r = ctx.c.pousserResetPilote_();
  assert.strictEqual(r.ok, true, 'la passe survit à l\'échec d\'UNE phase');
  assert.ok(ctx.appels.some((a) => a.phase === 'placerReset_'), 'les phases suivantes tournent quand même');
  assert.ok(r.echecs >= 1, 'l\'échec est compté et journalisé');
  assert.strictEqual(ctx.relachesRef(), 1, 'verrou relâché');
});

test('la réponse renvoyée à la CI (log PUBLIC) ne porte JAMAIS le détail d\'une exception', () => {
  const ctx = ctxPilote({ rondes: 1 });
  ctx.c.journalInfo_ = () => { throw new Error('Fichier « Passeport Marc 2019.pdf » illisible'); };
  const r = ctx.c.pousserResetPilote_();
  assert.strictEqual(r.ok, false);
  assert.ok(!/Passeport/.test(JSON.stringify(r)),
    'le dépôt est PUBLIC : le détail (noms de fichiers) reste au Journal privé');
  assert.ok(!('erreur' in r), 'pas de champ `erreur` sur un échec TRANSITOIRE — sinon la CI le croit permanent et abandonne');
});

/* ---------- 5. Bornes CI : la fenêtre du tick est ce qui protège le flux vivant ---------- */

test('workflow : la PAUSE entre deux passes reste > TICK_MINUTES — c\'est la garantie que le flux vivant n\'est pas affamé', () => {
  const c = load(['Config.gs']);
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pousser-reset.yml'), 'utf8');
  const pause = Number((/PAUSE_S:\s*'(\d+)'/.exec(wf) || [])[1]);
  assert.ok(pause > 0, 'PAUSE_S introuvable dans le workflow');
  assert.ok(pause > c.CONFIG.TICK_MINUTES * 60,
    'la pause (' + pause + ' s) doit dépasser un intervalle de tick (' + c.CONFIG.TICK_MINUTES * 60 + ' s) : ' +
    'une passe tient le verrou ~3,5 min, donc sans cette fenêtre le tick serait sauté à CHAQUE fois et ' +
    'les mails/dépôts de Marc ne seraient plus traités pendant des heures');
  // Le mur d'une passe doit rester sous la pause ET sous le mur HTTP.
  assert.ok(c.CONFIG.PILOTE_BUDGET_MS < pause * 1000, 'une passe doit finir avant la fin de la pause suivante');
  assert.ok(c.CONFIG.PILOTE_BUDGET_MS < c.CONFIG.BUDGET_MS,
    'le mur du pilote reste sous celui d\'une exécution manuelle (marge pour que la réponse HTTP reparte)');
});

test('workflow : succès jugé au CONTENU (ok:true), pas au code HTTP ; et jamais `-X POST` avec `-L`', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pousser-reset.yml'), 'utf8');
  // Le tripwire porte sur le CODE EXÉCUTÉ, pas sur la doc : les commentaires CITENT `-X POST`
  // justement pour expliquer pourquoi il est interdit (une version naïve de ce test échouait sur
  // sa propre explication — un tripwire qui attrape sa documentation ne prouve rien).
  const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(/jq -e '\.ok == true'/.test(code),
    'un 200 peut porter une page HTML d\'erreur Apps Script — le seul critère fiable est le JSON');
  assert.ok(!/-X POST/.test(code),
    '`-X POST` verrouille la méthode sur la redirection /macros/echo (HEAD/GET seulement) → 405 systématique');
  assert.ok(/jq -rn --arg s "\$SECRET" '\$s\|@uri'/.test(wf), 'le secret est encodé URL (il peut contenir & ou =)');
  assert.ok(!/echo .*\$SECRET[^_]/.test(wf), 'le secret n\'est JAMAIS affiché dans un log CI public');
  assert.ok(/termine == true/.test(wf), 'le pilote doit s\'arrêter seul à la convergence');
});

test('deploy.yml : le déclencheur est réinstallé APRÈS le redéploiement de la web app, et confirmé par un SIGNAL INDÉPENDANT', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  const posDeploy = wf.indexOf('clasp deploy -i');
  const posTrigger = wf.indexOf('action=assurer-trigger');
  assert.ok(posDeploy !== -1 && posTrigger !== -1, 'étapes introuvables');
  assert.ok(posDeploy < posTrigger,
    'la web app doit être redéployée AVANT l\'appel, sinon /exec sert une version qui ignore l\'action');
  assert.ok(/\.version \| type == "string"/.test(wf),
    'confirmation par un champ que SEULE la nouvelle version renvoie — un `ok:true` nu ne prouve rien ' +
    '(l\'action inconnue tombe dans le `else` du doPost et « réussit » en silence, piège (4))');
  assert.ok(/continue-on-error: true/.test(wf), 'ne jamais faire échouer un déploiement réussi sur ce confort');
});

test('deploy.yml : le déclencheur est réinstallé dès que le CODE est poussé, même si le redéploiement de la web app échoue', () => {
  // [CI-TRIGGER-APRES-PUSH] Le 21/09/2026, `clasp deploy` a buté sur les 200 versions d'Apps
  // Script. L'étape du déclencheur portait alors `if: steps.guard.outputs.ready == 'true'` —
  // or GitHub Actions SAUTE une étape dès qu'une étape amont a échoué, quelle que soit sa
  // condition, sauf si elle contient `always()`. Le déclencheur n'a donc pas été réinstallé et
  // le tick a continué d'exécuter l'ANCIEN code (piège n° 3), mesuré sur les ticks de 20:38 et
  // 20:44 UTC. Ce qui décide du code exécuté par le TICK, c'est le PUSH — pas le deploy.
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  const posPush = wf.indexOf('clasp push --force');
  const posId = wf.indexOf('id: push');
  assert.ok(posId !== -1 && posId < posPush,
    'l\'étape qui pousse le code porte `id: push` — sans identifiant, aucune condition ne peut la citer');
  const bloc = wf.slice(wf.indexOf('- name: Assurer le déclencheur'));
  const cond = /if:\s*(.+)/.exec(bloc);
  assert.ok(cond, 'condition de l\'étape du déclencheur introuvable');
  assert.ok(/always\(\)/.test(cond[1]),
    '`always()` est ce qui empêche GitHub de SAUTER l\'étape après un `clasp deploy` rouge — ' +
    'sans lui, tout échec du redéploiement de la web app fige le moteur sur l\'ancien code, en silence');
  assert.ok(/steps\.push\.outcome == 'success'/.test(cond[1]),
    'mais uniquement quand le CODE a bien été poussé : `always()` seul réinstallerait le ' +
    'déclencheur même sur un push raté, ou quand le déploiement n\'est pas configuré');
});

test('deploy.yml : la web app n\'est redéployée que si src/ a changé, et échoue OUVERT vers le déploiement', () => {
  // [CI-VERSIONS-200] Une version Apps Script par push sur `main` remplissait le plafond de 200
  // pour des PR qui ne touchent ni src/ ni appsscript.json (qui vit dans src/).
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.ok(/fetch-depth:\s*0/.test(wf),
    'sans historique complet, le commit précédent n\'existe pas dans le clone et la comparaison est impossible');
  const posMoteur = wf.indexOf('id: moteur');
  const posDeploy = wf.indexOf('clasp deploy -i');
  assert.ok(posMoteur !== -1 && posMoteur < posDeploy, 'l\'étape de comparaison précède le redéploiement');
  const bloc = wf.slice(wf.indexOf('- name: Redéployer la web app'));
  const cond = /if:\s*(.+)/.exec(bloc);
  assert.ok(cond && /steps\.moteur\.outputs\.change == 'true'/.test(cond[1]),
    'le redéploiement dépend du résultat de la comparaison');
  const etape = wf.slice(posMoteur, posDeploy);
  assert.ok(/git diff --quiet "\$BEFORE" "\$GITHUB_SHA" -- src/.test(etape), 'la comparaison porte sur src/');
  // Échec ouvert : tout cas où l'on ne peut pas prouver « rien n'a changé » laisse change=true.
  assert.ok(/change=true\n/.test(etape) && /change=false/.test(etape));
  assert.ok((etape.match(/change=false/g) || []).length === 1,
    'un seul chemin mène à `false` : la comparaison réussie sans différence');
  assert.ok(/workflow_dispatch/.test(wf) && /"\$EVENT" != "push"/.test(etape),
    'un lancement manuel redéploie toujours');
  assert.ok(/always\(\) && steps\.push\.outcome == 'success'/.test(wf),
    'le déclencheur reste réinstallé à chaque push réussi, que la web app soit redéployée ou non');
});

test('versionPilote_ : se termine par le commit déployé, et le dit quand il est inconnu', () => {
  // [C49-24] `5min|t7` ne variait pas : il prouvait que /exec CONNAÎT l'action, jamais qu'elle sert le code du jour.
  const c = load([...FICHIERS, 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  assert.strictEqual(c.versionPilote_(), c.CONFIG.TICK_MINUTES + 'min|' + c.CONFIG.RESET_TABLE_VERSION + '|inconnu',
    'sans Version.gs chargé, le SHA est « inconnu » — jamais une chaîne vide qui passerait pour une empreinte');
  const v = load([...FICHIERS, 'Cout.gs', 'Llm.gs', 'WebApp.gs', 'Version.gs']);
  assert.strictEqual(v.versionPilote_().split('|').pop(), 'non-deploye-par-ci',
    'la valeur de repli du dépôt n\'est jamais confondue avec un SHA de CI');
});

test('deploy.yml : /exec doit servir le commit qu\'on vient de déployer, sinon le run est ROUGE', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Version.gs'), 'utf8');
  assert.ok(/^var COMMIT_DEPLOYE = '[^']*';$/m.test(src),
    'Version.gs porte la ligne exacte que la CI remplace (sed ancré sur « var COMMIT_DEPLOYE = »)');
  const posDate = wf.indexOf('- name: Dater le code poussé');
  const posPush = wf.indexOf('- name: Pousser le code');
  assert.ok(posDate !== -1 && posDate < posPush, 'le SHA est écrit AVANT clasp push, sinon le code poussé ne le porte pas');
  assert.ok(/grep -qx "var COMMIT_DEPLOYE = '\$\{GITHUB_SHA:0:7\}';" src\/Version\.gs/.test(wf),
    'la substitution est vérifiée — un sed muet publierait la valeur de repli');
  assert.ok(/rm -f \/tmp\/trigger\.json/.test(wf),
    'le runner est persistant : une réponse d\'un run précédent ne doit pas passer pour la réponse actuelle');
  const bloc = wf.slice(wf.indexOf('- name: Vérifier que /exec sert le commit déployé'));
  assert.ok(bloc.length > 0 && wf.lastIndexOf('- name:') === wf.indexOf('- name: Vérifier que /exec sert le commit déployé'),
    'la vérification est la DERNIÈRE étape (après le déclencheur, dont elle lit la réponse)');
  const cond = /if:\s*(.+)/.exec(bloc);
  assert.ok(cond && /always\(\)/.test(cond[1]) && /steps\.redeploiement\.outputs\.deploye == 'true'/.test(cond[1]),
    'elle ne s\'applique que si CE run a créé une version (sinon src/ inchangé ⇒ /exec sert légitimement l\'ancienne) ' +
    'et survit à un échec amont grâce à always()');
  assert.ok(/echo "deploye=true" >> "\$GITHUB_OUTPUT"/.test(wf) &&
    wf.indexOf('echo "deploye=true"') > wf.indexOf('clasp deploy -i'),
    '`deploye` n\'est posé qu\'APRÈS un clasp deploy réussi');
  assert.ok(/\*"\|\$attendu"\) /.test(bloc) && (bloc.match(/exit 1/g) || []).length === 2,
    'version manquante ou différente ⇒ exit 1 (rouge), jamais un simple avertissement');
});

test('deploy.yml : le job qui déploie porte « déploiement » dans son NOM — c\'est ce que lit le garde-fou de preuve', () => {
  // Le 05/11/2026, six tâches (#881 à #890) ont été rouvertes `preuve-manquante` alors que leur job de
  // déploiement était vert : `scripts/preuve.mjs` (MoKarade/.github) ne retient, dans les exécutions
  // réussies de `deploy.yml`, qu'un JOB réussi dont le nom passe /d[ée]ploy|d[ée]ploi/i. « clasp push
  // (Apps Script) » ne le passait pas. Le mot est donc une interface, pas une décoration.
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  const noms = [...wf.matchAll(/^    name: (.+)$/gm)].map((m) => m[1]);
  assert.ok(noms.length >= 1, 'aucun nom de job trouvé dans deploy.yml');
  assert.ok(noms.some((n) => /d[ée]ploy|d[ée]ploi/i.test(n)),
    'le job de déploiement doit contenir « déploiement » ou « deploy » dans `name:` : ' + noms.join(' | '));
});

/* ---------- C28-58 : le pilote est du travail AUTOMATIQUE, pas « une demande de Marc » ---------- */

test('pousserResetPilote_ : son coût LLM porte sa propre clé, jamais l\'étiquette `app:` du doPost', () => {
  // `doPost` étiquette la requête `app:pousser-reset` (famille « demandes de Marc »). Or les
  // phases du pilote ne passent par AUCUN `etapeSuivie_` : sans marquage explicite, tout le coût
  // du rangement lancé par la CI atterrissait dans `app:*` — et docs/COUTS.md enseigne
  // littéralement l'inverse (« si les postes app:* dominent, c'est le chat qui coûte »).
  const c = load([...FICHIERS, 'Suivi.gs']);
  c.CONFIG.PILOTE_ACTIF = false; // sortie immédiate : on teste le MARQUAGE, pas le rangement
  c.poserOperationCourante_('app:pousser-reset'); // ce que doPost vient de poser
  c.pousserResetPilote_();
  assert.strictEqual(c.operationCourante_(), 'reset-pilote',
    'le pilote se nomme lui-même — sinon son coût est imputé aux demandes de Marc');
});
