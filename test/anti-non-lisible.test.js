'use strict';
/**
 * Correctif anti-« non lisible / non identifié » et exclusion des fichiers/dossiers techniques.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));

const MODULES_ROUTER = ['Config.gs', 'Cout.gs', 'Ocr.gs', 'DriveRest.gs', 'Entites.gs', 'Consolidation.gs', 'Missions.gs', 'Reset.gs', 'Router.gs'];

test('estExcluDuReset_ : exclut les dossiers techniques et sauvegardes à la racine', () => {
  const c = load(['Config.gs', 'Reset.gs']);
  for (const nom of ['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'Takeout', 'Sauvegardes', 'Colab Notebooks', 'Google AI Studio', '_Archive']) {
    assert.strictEqual(c.estExcluDuReset_(nom), true, nom + ' doit être exclu');
  }
  assert.strictEqual(c.estExcluDuReset_('Archive personnelle'), false);
  assert.strictEqual(c.estExcluDuReset_('02 · Finances'), false);
});

test('estTechnique_ : détecte binaires Git, hex longs sans extension, fichiers cachés sans toucher aux PDF/images', () => {
  const c = load(MODULES_ROUTER);
  for (const f of [
    'pack-abc123.pack',
    'pack-abc123.rev',
    'objects.idx',
    'pre-commit.sample',
    '0123456789abcdef0123456789abcdef01234567',
    'HEAD',
    'FETCH_HEAD',
    '.gitignore',
    '.env',
  ]) {
    assert.strictEqual(c.estTechnique_(f), true, f + ' doit être routé en technique');
  }
  for (const doc of ['facture.pdf', 'recu.jpg', 'contrat.docx', 'notes', 'attestation.png']) {
    assert.strictEqual(c.estTechnique_(doc), false, doc + ' ne doit PAS être classé technique');
  }
});

test('estLibelleIllisible_ et estRenseigne_ : neutralisent les formulations « non identifié / illisible »', () => {
  const c = load(MODULES_ROUTER);
  for (const formule of [
    'Document non identifié',
    'Dépôt manuel sans contenu lisible',
    'Dépôt manuel sans contenu lisible ni métadonnées exploitables',
    'Fichier illisible sans contenu exploitable',
    'Document non identifié (contenu illisible)',
    'Nom hexadécimal sans extension',
    'Nature indéterminée',
    'Fichier à identifier',
    'Dépôt manuel non identifié',
  ]) {
    assert.strictEqual(c.estLibelleIllisible_(formule), true, formule + ' doit être rejeté');
    assert.strictEqual(c.estRenseigne_(formule), false, formule + ' ne vaut pas renseigné');
  }
  assert.strictEqual(c.estRenseigne_('Facture'), true);
  assert.strictEqual(c.estRenseigne_('Hydro-Exemple'), true);
  assert.strictEqual(c.estRenseigne_('Attestation de scolarité'), true);
});

test('planRoutageV2_ et deciderRoutageV2_ : fichier binaire/sans extension illisible → _Technique avec nom d\'origine', () => {
  const c = load(MODULES_ROUTER);
  const classifBad = {
    domaine: '01 · Administratif & identité',
    type_doc: 'Document non identifié',
    descripteur: 'Dépôt manuel sans contenu lisible',
    emetteur: null,
    entite: null,
    confiance: 0.05,
  };
  const plan = plain(c.planRoutageV2_(classifBad, { nomFichier: 'a1b2c3d4e5f60708', extraitOcr: '' }, '2026-11-24', '', {}));
  assert.deepStrictEqual(plan, { type: 'non-doc', routage: '_Technique' });

  let dossierTech = null;
  c.dossierTechnique_ = () => ({ getId: () => 'dos-tech' });
  const dec = plain(c.deciderRoutageV2_(classifBad, { nomFichier: 'blob_brut', extraitOcr: '' }, new Date('2026-11-24T12:00:00Z'), ''));
  assert.strictEqual(dec.statut, 'technique');
  assert.strictEqual(dec.chemin, '_Technique');
  assert.strictEqual(dec.nom, '2026-11-24_blob-brut');
  void dossierTech;
});

test('planRoutageV2_ et deciderRoutageV2_ : PDF sans OCR et confiance <= 0.15 → 00 · À vérifier avec nom d\'origine conservé', () => {
  const c = load(MODULES_ROUTER);
  c.dossierAVerifier_ = () => ({ getId: () => 'dos-averif' });
  const classifIllisible = {
    domaine: '08 · Perso & projets',
    type_doc: 'Document non identifié',
    descripteur: 'Fichier illisible sans contenu exploitable',
    emetteur: null,
    entite: null,
    confiance: 0.05,
  };
  const plan = plain(c.planRoutageV2_(classifIllisible, { nomFichier: 'scan-recu-2026.pdf', extraitOcr: '' }, '2026-11-24', '.pdf', {}));
  assert.strictEqual(plan.type, 'à vérifier');
  assert.strictEqual(plan.conserverNomOriginal, true);

  const dec = plain(c.deciderRoutageV2_(classifIllisible, { nomFichier: 'scan-recu-2026.pdf', extraitOcr: '' }, new Date('2026-11-24T12:00:00Z'), '.pdf'));
  assert.strictEqual(dec.statut, 'à vérifier');
  assert.strictEqual(dec.chemin, '00 · À vérifier');
  assert.strictEqual(dec.nom, 'scan-recu-2026.pdf');
});

test('planRoutageV2_ : un vrai document valide continue de se classer normalement', () => {
  const c = load(MODULES_ROUTER);
  const plan = plain(c.planRoutageV2_({
    domaine: '02 · Finances',
    type_doc: 'Facture',
    emetteur: 'Hydro-Exemple',
    date_doc: '2026-11-10',
    confiance: 0.9,
  }, { nomFichier: 'facture.pdf', extraitOcr: 'Facture mensuelle Hydro-Exemple 84,20 $', emetteur: 'Hydro-Exemple' }, '2026-11-24', '.pdf', {}));
  assert.strictEqual(plan.type, 'classé');
  assert.strictEqual(plan.domaine, '02 · Finances');
  assert.strictEqual(plan.nom, '2026-11-10_Facture_Hydro-Exemple.pdf');
});
