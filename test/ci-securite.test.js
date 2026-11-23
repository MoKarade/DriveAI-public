'use strict';
/**
 * Verrous de l'outillage de sécurité de la CI (DriveAI#801, ancien BACKLOG C28-139).
 *
 * gitleaks est téléchargé en binaire (jamais vu par Dependabot) et semgrep installé par pip : sans ces
 * verrous, une version vulnérable y reste sans que rien ne rougisse (gitleaks 8.28.0 portait la
 * CVE-2026-63728). Le plancher de gitleaks se relève à la main, avec l'empreinte de la release.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const PLANCHER_GITLEAKS = [8, 30, 1];
const versionDe = (v) => v.split('.').map(Number);
const auMoins = (v, plancher) => {
  for (let i = 0; i < 3; i++) {
    if (v[i] !== plancher[i]) return v[i] > plancher[i];
  }
  return true;
};

test('CI sécurité : la version de gitleaks téléchargée n\'est pas plus ancienne que le plancher', () => {
  const ci = lire('.github/workflows/ci.yml');
  const m = ci.match(/releases\/download\/v(\d+\.\d+\.\d+)\/gitleaks_(\d+\.\d+\.\d+)_linux_x64\.tar\.gz/);
  assert.ok(m, 'ci.yml doit télécharger l\'archive officielle de gitleaks');
  assert.strictEqual(m[1], m[2], 'le tag et le nom d\'archive doivent porter la même version');
  assert.ok(auMoins(versionDe(m[1]), PLANCHER_GITLEAKS),
    'gitleaks ' + m[1] + ' est plus ancien que le plancher ' + PLANCHER_GITLEAKS.join('.'));
  assert.match(ci, /echo "[0-9a-f]{64}  gitleaks\.tgz" \| sha256sum -c -/, 'l\'empreinte SHA256 doit rester vérifiée');
});

test('CI sécurité : semgrep vient de requirements-ci.txt, épinglé, et Dependabot (pip) le suit', () => {
  const ci = lire('.github/workflows/ci.yml');
  assert.match(ci, /pip install --quiet --only-binary :all: -r requirements-ci\.txt/);
  assert.doesNotMatch(ci, /semgrep==/, 'plus de version de semgrep écrite dans un run: (Dependabot ne la verrait pas)');
  assert.match(lire('requirements-ci.txt'), /^semgrep==\d+\.\d+\.\d+$/m, 'semgrep doit être épinglé à une version exacte');
  assert.match(lire('.github/dependabot.yml'), /package-ecosystem: pip\n\s+directory: \//);
});
