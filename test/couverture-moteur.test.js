'use strict';
/**
 * Cliquet de couverture du moteur (.github/ci/couverture-moteur.mjs, #493) : le calcul est PUR et
 * se teste sans relancer la suite. Le test « seuil » est prouvé par mutation : baisser le seuil
 * versionné sous la barre de ce test, ou retirer le contrôle de la CI, le fait rougir.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const charger = () => import('../.github/ci/couverture-moteur.mjs');

const LCOV = [
  'TN:', 'SF:src/Main.gs', 'LF:100', 'LH:40', 'end_of_record',
  'SF:src/Cout.gs', 'LF:50', 'LH:50', 'end_of_record',
  'SF:test/harness.js', 'LF:1000', 'LH:1000', 'end_of_record',
  'SF:scripts/hooks/lib/x.mjs', 'LF:10', 'LH:0', 'end_of_record',
].join('\n');

test('lireLcov : ne compte QUE les fichiers src/*.gs (les tests et scripts ne gonflent pas la couverture)', async () => {
  const { lireLcov } = await charger();
  const m = lireLcov(LCOV);
  assert.deepStrictEqual(m, { fichiers: 2, trouvees: 150, couvertes: 90, pourcent: 60 });
});

test('juger : sous le seuil = rouge, au seuil = vert, rapport sans .gs = rouge (jamais « 100 % »)', async () => {
  const { juger, lireLcov } = await charger();
  const m = lireLcov(LCOV);
  assert.strictEqual(juger(m, 61).ok, false);
  assert.match(juger(m, 61).raison, /60 % < seuil 61 %/);
  assert.strictEqual(juger(m, 60).ok, true);
  const vide = lireLcov('SF:test/harness.js\nLF:10\nLH:10\nend_of_record');
  assert.strictEqual(vide.pourcent, null);
  assert.strictEqual(juger(vide, 0).ok, false, 'aucun .gs vu : instrument cassé, pas une couverture parfaite');
});

test('resserrer : monte sur la mesure (dixième inférieur), ne descend jamais', async () => {
  const { resserrer } = await charger();
  assert.strictEqual(resserrer({ pourcent: 87.66 }, 86), 87.6);
  assert.strictEqual(resserrer({ pourcent: 80 }, 86), 86, 'une mesure plus basse ne desserre pas le cliquet');
  assert.strictEqual(resserrer({ pourcent: null }, 86), 86);
});

test('le seuil versionné existe, est un nombre plausible, et la CI appelle le contrôle', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(RACINE, '.github', 'ci', 'couverture-moteur.json'), 'utf8'));
  assert.ok(typeof cfg.lignes.min === 'number' && cfg.lignes.min >= 80 && cfg.lignes.min <= 100,
    'seuil de couverture du moteur : ' + cfg.lignes.min);
  const ci = fs.readFileSync(path.join(RACINE, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(ci.includes('node .github/ci/couverture-moteur.mjs'),
    'ci.yml doit lancer le cliquet de couverture du moteur (job « Tests unitaires », sans `paths:`)');
});
