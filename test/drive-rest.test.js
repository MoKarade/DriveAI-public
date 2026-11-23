'use strict';
/**
 * DriveAI#897 — `fetchDriveAvecRetry_` (src/DriveRest.gs) rejoue UNE fois (1 s) les réponses transitoires : 429, 5xx
 * et le 403 de QUOTA de l'API Drive (`userRateLimitExceeded` / `rateLimitExceeded`, que Drive signale en 403 et non en
 * 429). Un 403 de DROIT (`insufficientFilePermissions`, `forbidden`) ou de quota JOURNALIER (`dailyLimitExceeded`)
 * n'est jamais rejoué : il ne changerait pas en une seconde. Jamais de boucle : deux réponses transitoires rendent la
 * seconde, après deux appels exactement.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctxFetch(reponses) {
  const ctx = load(['Config.gs', 'DriveRest.gs']);
  const appels = [];
  const dodos = [];
  ctx.Utilities = { sleep: (ms) => dodos.push(ms) };
  ctx.UrlFetchApp = {
    fetch: (url, options) => {
      appels.push({ url, options });
      const r = reponses[Math.min(appels.length - 1, reponses.length - 1)];
      return { getResponseCode: () => r.code, getContentText: () => r.corps || '' };
    },
  };
  return { ctx, appels, dodos };
}

const QUOTA = JSON.stringify({ error: { code: 403, errors: [{ domain: 'usageLimits', reason: 'userRateLimitExceeded', message: 'User Rate Limit Exceeded' }] } });
const DROIT = JSON.stringify({ error: { code: 403, errors: [{ domain: 'global', reason: 'insufficientFilePermissions', message: 'The user does not have sufficient permissions for this file.' }] } });
const JOUR = JSON.stringify({ error: { code: 403, errors: [{ domain: 'usageLimits', reason: 'dailyLimitExceeded', message: 'Daily Limit Exceeded' }] } });

test('403 rateLimitExceeded → rejoué UNE fois après 1 s, la seconde réponse est rendue', () => {
  const { ctx, appels, dodos } = ctxFetch([{ code: 403, corps: QUOTA }, { code: 200, corps: '{"id":"X"}' }]);
  const rep = ctx.fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files/X', { method: 'get' });
  assert.strictEqual(rep.getResponseCode(), 200);
  assert.strictEqual(appels.length, 2);
  assert.deepStrictEqual(dodos, [1000]);
});

test('403 de DROIT → jamais rejoué (un seul appel, la réponse est rendue telle quelle)', () => {
  const { ctx, appels, dodos } = ctxFetch([{ code: 403, corps: DROIT }, { code: 200, corps: '{}' }]);
  const rep = ctx.fetchDriveAvecRetry_('u', {});
  assert.strictEqual(rep.getResponseCode(), 403);
  assert.strictEqual(appels.length, 1, 'un droit manquant ne change pas en une seconde');
  assert.deepStrictEqual(dodos, []);
});

test('403 dailyLimitExceeded (quota du JOUR) → pas rejoué : attendre une seconde ne sert à rien', () => {
  const { ctx, appels } = ctxFetch([{ code: 403, corps: JOUR }, { code: 200, corps: '{}' }]);
  assert.strictEqual(ctx.fetchDriveAvecRetry_('u', {}).getResponseCode(), 403);
  assert.strictEqual(appels.length, 1);
});

test('429 et 5xx → rejoués une fois ; 200 et 404 → jamais ; le rejeu est BORNÉ à un (deux 403 de quota → deux appels, pas trois)', () => {
  assert.strictEqual(ctxFetch([{ code: 429 }, { code: 200 }]).appels.length, 0, 'témoin : rien avant l\'appel');
  let c = ctxFetch([{ code: 429 }, { code: 200 }]); c.ctx.fetchDriveAvecRetry_('u', {}); assert.strictEqual(c.appels.length, 2);
  c = ctxFetch([{ code: 503 }, { code: 200 }]); c.ctx.fetchDriveAvecRetry_('u', {}); assert.strictEqual(c.appels.length, 2);
  c = ctxFetch([{ code: 200 }]); c.ctx.fetchDriveAvecRetry_('u', {}); assert.strictEqual(c.appels.length, 1);
  c = ctxFetch([{ code: 404, corps: 'rateLimitExceeded' }]); c.ctx.fetchDriveAvecRetry_('u', {}); assert.strictEqual(c.appels.length, 1, 'le mot seul ne suffit pas : il faut un 403');
  c = ctxFetch([{ code: 403, corps: QUOTA }, { code: 403, corps: QUOTA }, { code: 200 }]);
  assert.strictEqual(c.ctx.fetchDriveAvecRetry_('u', {}).getResponseCode(), 403, 'la seconde réponse est rendue, pas une troisième tentée');
  assert.strictEqual(c.appels.length, 2);
});

test('estReponseDriveTransitoire_ : corps illisible → pas transitoire (jamais de levée)', () => {
  const { ctx } = ctxFetch([]);
  assert.strictEqual(ctx.estReponseDriveTransitoire_({ getResponseCode: () => 403, getContentText: () => { throw new Error('x'); } }), false);
  assert.strictEqual(ctx.estReponseDriveTransitoire_({ getResponseCode: () => 500, getContentText: () => '' }), true);
});
