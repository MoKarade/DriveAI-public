'use strict';
/**
 * Chien de garde (ADR-0004) — `actionChienDeGarde_` : machine PURE à 3 états.
 * détecter → réparer (1×) → (si toujours en panne) alerter (1×). Les clés d'épisode évitent
 * de réparer/alerter en boucle : on n'agit qu'une fois par épisode de panne (heartbeat figé).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Main.gs', 'Resume.gs']);
const SEUIL = 45 * 60 * 1000; // 45 min
const T = 1_000_000_000_000;  // un « maintenant » de référence (ms)

test('moteur qui tourne (heartbeat frais) → rien', () => {
  assert.strictEqual(ctx.actionChienDeGarde_(T, T - 60_000, SEUIL, 0, 0), 'rien');          // 1 min
  assert.strictEqual(ctx.actionChienDeGarde_(T, T - SEUIL, SEUIL, 0, 0), 'rien');           // pile au seuil (<=)
});

test('jamais tourné (pas de heartbeat) → rien (pas de fausse alerte au démarrage)', () => {
  assert.strictEqual(ctx.actionChienDeGarde_(T, 0, SEUIL, 0, 0), 'rien');
});

test('silencieux au-delà du seuil, 1re détection → reparer', () => {
  const dernierTick = T - (SEUIL + 60_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, dernierTick, SEUIL, 0, 0), 'reparer');
});

test('toujours en panne après une réparation déjà tentée pour cet épisode → alerter', () => {
  const dernierTick = T - (SEUIL + 60_000);
  // repareTick == dernierTick : on a déjà réparé pour CE heartbeat, il n'a pas bougé → escalade.
  assert.strictEqual(ctx.actionChienDeGarde_(T, dernierTick, SEUIL, dernierTick, 0), 'alerter');
});

test('déjà alerté pour cet épisode → rien (pas de spam)', () => {
  const dernierTick = T - (SEUIL + 60_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, dernierTick, SEUIL, dernierTick, dernierTick), 'rien');
});

test('nouvel épisode (heartbeat différent des marqueurs) → reparer à nouveau', () => {
  // Le moteur avait repris (nouveau heartbeat) puis re-planté : repare/alerteTick pointent l'ANCIEN épisode.
  const ancien = T - 10 * SEUIL;
  const nouveauMaisEnPanne = T - (SEUIL + 60_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, nouveauMaisEnPanne, SEUIL, ancien, ancien), 'reparer');
});

test('escalade complète d\'un épisode : reparer → alerter → rien', () => {
  const dt = T - (SEUIL + 120_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, dt, SEUIL, 0, 0), 'reparer');    // 1er passage
  assert.strictEqual(ctx.actionChienDeGarde_(T, dt, SEUIL, dt, 0), 'alerter');   // 2e passage (réparé, tjs en panne)
  assert.strictEqual(ctx.actionChienDeGarde_(T, dt, SEUIL, dt, dt), 'rien');     // 3e passage (déjà alerté)
});

/* --- État du système (résumé hebdo, ADR-0004 point 4) --- */

test('etatSysteme_ : heartbeat frais → actif avec l\'âge en minutes', () => {
  const s = ctx.etatSysteme_(T - 12 * 60000, T, SEUIL);
  assert.ok(s.includes('🟢') && s.includes('12 min'));
});

test('etatSysteme_ : au-delà du seuil → silencieux', () => {
  const s = ctx.etatSysteme_(T - (SEUIL + 5 * 60000), T, SEUIL);
  assert.ok(s.includes('🔴') && s.includes('silencieux'));
});

test('etatSysteme_ : jamais de heartbeat → démarrage, pas de faux « silencieux »', () => {
  const s = ctx.etatSysteme_(0, T, SEUIL);
  assert.ok(s.includes('démarrage') && !s.includes('🔴'));
});

/* ---------- #22 : validation PURE du réglage de tick (donnée utilisateur) ---------- */
test('validerTickMinutes_ : whitelist stricte 5/10/15/30 — jamais < 5, jamais une valeur libre', () => {
  assert.strictEqual(ctx.validerTickMinutes_(5), 5);
  assert.strictEqual(ctx.validerTickMinutes_('10'), 10);
  assert.strictEqual(ctx.validerTickMinutes_(30), 30);
  assert.strictEqual(ctx.validerTickMinutes_(1), null);   // 1440 runs/j : interdit
  assert.strictEqual(ctx.validerTickMinutes_(7), null);   // valeur non admise par Apps Script
  assert.strictEqual(ctx.validerTickMinutes_(''), null);
  assert.strictEqual(ctx.validerTickMinutes_('abc'), null);
  assert.strictEqual(ctx.validerTickMinutes_(-5), null);
});

/* ---------- Tier 5 : comportement réel Main.gs (chienDeGarde, déclencheurs, intervalles, domaines) ---------- */

function ctxMainTriggers(opts) {
  opts = opts || {};
  const props = Object.assign({}, opts.props);
  const triggers = (opts.triggers || []).slice();
  const journaux = { info: [], erreur: [] };
  const opsTriggers = [];
  let nextId = 100;

  const creerTrigger = (fn) => {
    const id = 'TR_' + (++nextId);
    const obj = { getHandlerFunction: () => fn, getUniqueId: () => id };
    const builder = {
      timeBased: () => builder,
      everyMinutes: (m) => {
        opsTriggers.push({ op: 'everyMinutes', fn, m });
        return builder;
      },
      onWeekDay: () => builder,
      atHour: () => builder,
      create: () => {
        if (opts.createJette) throw new Error('quota déclencheurs');
        triggers.push(obj);
        opsTriggers.push({ op: 'create', fn, id });
        return obj;
      },
    };
    return builder;
  };

  const c = load(['Config.gs', 'Main.gs'], {
    PropertiesService: {
      getScriptProperties: () => {
        if (opts.propsJette) throw new Error('PropertiesService HS');
        return {
          getProperty: (k) => (k in props ? props[k] : null),
          setProperty: (k, v) => { props[k] = String(v); },
          deleteProperty: (k) => { delete props[k]; },
        };
      },
    },
    ScriptApp: {
      WeekDay: { MONDAY: 'MONDAY', SUNDAY: 'SUNDAY' },
      getProjectTriggers: () => {
        if (opts.getTriggersJette) throw new Error('ScriptApp HS');
        return triggers.slice();
      },
      deleteTrigger: (t) => {
        opsTriggers.push({ op: 'delete', fn: t.getHandlerFunction(), id: t.getUniqueId() });
        const idx = triggers.indexOf(t);
        if (idx !== -1) triggers.splice(idx, 1);
      },
      newTrigger: (fn) => creerTrigger(fn),
    },
    journalInfo_: (s, m) => {
      if (opts.journalInfoJette) throw new Error('Sheet HS pendant log');
      journaux.info.push({ s, m });
    },
    journalErreur_: (s, m) => journaux.erreur.push({ s, m }),
    feuille_: (nom) => {
      if (opts.feuilleJette) throw new Error('Sheet illisible');
      return {
        getRange: () => ({ getValue: () => opts.b2Value }),
      };
    },
    DriveApp: opts.DriveApp || {},
  });
  return { c, props, triggers, journaux, opsTriggers };
}

test('chienDeGarde() : réparation réussie, faux positif évité si installerTrigger lève après création, escalade alerte, zéro exception', () => {
  const vieuxTick = Date.now() - 60 * 60 * 1000;

  // 1. Auto-réparation nominale : recrée le trigger tickDriveAI et pose DriveAI_WATCHDOG_REPARE.
  const nom = ctxMainTriggers({ props: { DriveAI_LAST_TICK: String(vieuxTick) } });
  nom.c.chienDeGarde();
  assert.strictEqual(nom.props.DriveAI_WATCHDOG_REPARE, String(vieuxTick));
  assert.strictEqual(nom.props.DriveAI_WATCHDOG_ALERTE, undefined);
  assert.ok(nom.triggers.some((t) => t.getHandlerFunction() === 'tickDriveAI'));
  assert.ok(nom.journaux.info.some((j) => j.m.includes('auto-réparation')));

  // 2. installerTrigger() crée le déclencheur PUIS lève sur journalInfo_ → presenceTriggerTick_() évite une fausse alerte.
  const fauxPos = ctxMainTriggers({
    props: { DriveAI_LAST_TICK: String(vieuxTick) },
    journalInfoJette: true,
  });
  fauxPos.c.chienDeGarde();
  assert.strictEqual(fauxPos.props.DriveAI_WATCHDOG_REPARE, String(vieuxTick), 'réparation confirmée par presenceTriggerTick_()');
  assert.strictEqual(fauxPos.props.DriveAI_WATCHDOG_ALERTE, undefined, 'aucune fausse alerte');
  assert.strictEqual(fauxPos.journaux.erreur.length, 0);

  // 3. Échec total (impossible de créer le déclencheur, aucun tickDriveAI présent) → alerte immédiate.
  const echec = ctxMainTriggers({
    props: { DriveAI_LAST_TICK: String(vieuxTick) },
    createJette: true,
  });
  echec.c.chienDeGarde();
  assert.strictEqual(echec.props.DriveAI_WATCHDOG_ALERTE, String(vieuxTick));
  assert.strictEqual(echec.journaux.erreur.length, 1);
  assert.match(echec.journaux.erreur[0].m, /Moteur silencieux/);

  // 4. Épisode déjà réparé sans effet (repare == dernierTick) → escalade vers alerter.
  const esc = ctxMainTriggers({
    props: { DriveAI_LAST_TICK: String(vieuxTick), DriveAI_WATCHDOG_REPARE: String(vieuxTick) },
  });
  esc.c.chienDeGarde();
  assert.strictEqual(esc.props.DriveAI_WATCHDOG_ALERTE, String(vieuxTick));
  assert.strictEqual(esc.journaux.erreur.length, 1);

  // 5. Même si PropertiesService lève → aucune exception propagée par chienDeGarde().
  const crash = ctxMainTriggers({ propsJette: true });
  assert.doesNotThrow(() => crash.c.chienDeGarde());
  assert.strictEqual(crash.c.presenceTriggerTick_(), false); // getTriggers non cassé mais vide
  const crashTrig = ctxMainTriggers({ getTriggersJette: true });
  assert.strictEqual(crashTrig.c.presenceTriggerTick_(), false);
});

test('assurerIntervalleTick_() & intervalleTickVoulu_() : lecture Réglages!B2, repli sûr et ordre create-then-delete', () => {
  // 1. intervalleTickVoulu_() valide vs invalide/illisible.
  const rValide = ctxMainTriggers({ b2Value: 15 });
  assert.strictEqual(rValide.c.intervalleTickVoulu_(), 15);
  const rInvalide = ctxMainTriggers({ b2Value: 2 });
  assert.strictEqual(rInvalide.c.intervalleTickVoulu_(), rInvalide.c.CONFIG.TICK_MINUTES);
  const rErr = ctxMainTriggers({ feuilleJette: true });
  assert.strictEqual(rErr.c.intervalleTickVoulu_(), rErr.c.CONFIG.TICK_MINUTES);

  // 2. assurerIntervalleTick_() : déjà à la bonne valeur → aucune opération trigger.
  const meme = ctxMainTriggers({
    b2Value: 10,
    props: { DriveAI_TICK_MINUTES: '10' },
  });
  meme.c.assurerIntervalleTick_();
  assert.strictEqual(meme.opsTriggers.length, 0);

  // 3. Changement (5 → 15) : CRÉE le nouveau trigger AVANT de supprimer l'ancien, conserve chienDeGarde.
  const ancienTick = { getHandlerFunction: () => 'tickDriveAI', getUniqueId: () => 'OLD_TICK' };
  const garde = { getHandlerFunction: () => 'chienDeGarde', getUniqueId: () => 'KEEP_WD' };
  const chg = ctxMainTriggers({
    b2Value: 15,
    props: { DriveAI_TICK_MINUTES: '5' },
    triggers: [ancienTick, garde],
  });
  chg.c.assurerIntervalleTick_();
  assert.strictEqual(chg.props.DriveAI_TICK_MINUTES, '15');
  const idxCreate = chg.opsTriggers.findIndex((o) => o.op === 'create' && o.fn === 'tickDriveAI');
  const idxDelete = chg.opsTriggers.findIndex((o) => o.op === 'delete' && o.id === 'OLD_TICK');
  assert.ok(idxCreate !== -1 && idxDelete !== -1 && idxCreate < idxDelete, 'create-then-delete respecté');
  assert.strictEqual(chg.triggers.length, 2, 'nouveau tick + chienDeGarde conservé');
  assert.ok(chg.triggers.some((t) => t.getUniqueId() === 'KEEP_WD'));

  // 4. assurerTriggerChienDeGarde_() : idempotent si déjà présent.
  chg.opsTriggers.length = 0;
  chg.c.assurerTriggerChienDeGarde_();
  assert.strictEqual(chg.opsTriggers.length, 0);
});

test('assurerNomsDomaines_() : renomme uniquement les dossiers divergents, tolère une erreur, et pose le tag', () => {
  const renommes = [];
  const domKeys = Object.keys(load(['Config.gs']).CONFIG.DOMAINES);
  const premier = domKeys[0];
  const deuxieme = domKeys[1];
  const { c, props, journaux } = ctxMainTriggers({
    DriveApp: {
      getFolderById: (id) => {
        if (id === c.CONFIG.DOMAINES[deuxieme]) throw new Error('dossier inaccessible');
        return {
          getName: () => (id === c.CONFIG.DOMAINES[premier] ? 'Ancien Nom' : domKeys.find((k) => c.CONFIG.DOMAINES[k] === id)),
          setName: (n) => renommes.push({ id, n }),
        };
      },
    },
  });
  c.assurerNomsDomaines_();
  assert.deepStrictEqual(renommes, [{ id: c.CONFIG.DOMAINES[premier], n: premier }]);
  assert.strictEqual(props.DriveAI_NOMS_DOMAINES, c.CONFIG.NOMS_DOMAINES_TAG);
  assert.strictEqual(journaux.erreur.length, 1);

  // 2e appel : tag déjà posé → aucun accès Drive.
  c.DriveApp = { getFolderById: () => { throw new Error('ne doit pas être rappelé'); } };
  c.assurerNomsDomaines_();
});
