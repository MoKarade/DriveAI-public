'use strict';
/**
 * Boucle d'apprentissage (ADR-0003 §3, chantier #5) — sélection few-shot PURE :
 * pertinence par émetteur, top-N borné, formatage du bloc d'exemples. La lecture de l'onglet et
 * l'injection dans le prompt LLM ne sont pas testées ici (effectful) — seule la logique pure l'est.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// Corrections.gs réutilise normaliserCle_/tokensEntite_ d'Entites.gs.
const ctx = load(['Config.gs', 'Entites.gs', 'Corrections.gs']);

const metaZephyr = { nomFichier: 'facture Zephyr janvier.pdf', expediteur: 'contact@zephyr.example', sujet: 'Votre facture' };

test('scoreCorrection_ : émetteur présent dans le doc → 1 ; absent → 0', () => {
  assert.strictEqual(ctx.scoreCorrection_(metaZephyr, { emetteur: 'Zephyr' }), 1);
  assert.strictEqual(ctx.scoreCorrection_(metaZephyr, { emetteur: 'Bellerives' }), 0);
  assert.strictEqual(ctx.scoreCorrection_(metaZephyr, { emetteur: '' }), 0);
  assert.strictEqual(ctx.scoreCorrection_({ nomFichier: '', expediteur: '', sujet: '' }, { emetteur: 'Zephyr' }), 0);
});

test('scoreCorrection_ : recouvrement partiel des jetons d\'émetteur', () => {
  // « Caisse Bellerives » vs un doc qui ne mentionne que « bellerives » → 1 jeton sur 2 = 0.5
  const meta = { nomFichier: 'releve bellerives.pdf', expediteur: 'x@y.com', sujet: '' };
  assert.strictEqual(ctx.scoreCorrection_(meta, { emetteur: 'Caisse Bellerives' }), 0.5);
});

test('correctionsPertinentes_ : ne garde que les pertinents, triés, bornés à maxN', () => {
  const corrections = [
    { emetteur: 'Bellerives', domaine: '02 · Finances' },
    { emetteur: 'Zephyr', domaine: '03 · Logement & véhicule' },
    { emetteur: 'Hydro-Québec', domaine: '03 · Logement & véhicule' }
  ];
  const r = ctx.correctionsPertinentes_(metaZephyr, corrections, 3, ctx.CONFIG.FEWSHOT_SEUIL);
  assert.strictEqual(r.length, 1);        // seul Zephyr matche ce document
  assert.strictEqual(r[0].emetteur, 'Zephyr');
});

test('correctionsPertinentes_ : maxN borne le nombre d\'exemples (borne de coût)', () => {
  // 4 émetteurs DISTINCTS tous présents dans le doc → 4 pertinents (score 1). maxN=2 doit en couper 2.
  const meta = { nomFichier: 'zephyr hydro bellerives cablonet.pdf', expediteur: '', sujet: '' };
  const corrections = [
    { emetteur: 'Zephyr', domaine: 'A' }, { emetteur: 'Hydro', domaine: 'B' },
    { emetteur: 'Bellerives', domaine: 'C' }, { emetteur: 'Cablonet', domaine: 'D' }
  ];
  const r = ctx.correctionsPertinentes_(meta, corrections, 2, ctx.CONFIG.FEWSHOT_SEUIL);
  assert.strictEqual(r.length, 2); // 4 candidats pertinents, mais borné à maxN=2
});

test('blocFewShot_ : saute une correction sans aucune cible (pas de ligne dégénérée)', () => {
  assert.strictEqual(ctx.blocFewShot_([{ emetteur: 'Zephyr' }]), ''); // émetteur seul, rien à apprendre
  const bloc = ctx.blocFewShot_([{ emetteur: 'Vide' }, { emetteur: 'Zephyr', domaine: '03 · Logement & véhicule' }]);
  assert.ok(bloc.indexOf('Vide') === -1);          // la correction sans cible est écartée
  assert.ok(bloc.indexOf('Émetteur « Zephyr »') !== -1);
});

test('blocFewShot_ : vide si aucune correction ; sinon liste lisible', () => {
  assert.strictEqual(ctx.blocFewShot_([]), '');
  assert.strictEqual(ctx.blocFewShot_(null), '');
  const bloc = ctx.blocFewShot_([{ emetteur: 'Zephyr', domaine: '03 · Logement & véhicule', entite: 'Zephyr' }]);
  assert.ok(bloc.indexOf('Émetteur « Zephyr »') !== -1);
  assert.ok(bloc.indexOf('domaine « 03 · Logement & véhicule »') !== -1);
  assert.ok(bloc.indexOf('entité « Zephyr »') !== -1);
});

test('cleCorrection_ : normalise pour l\'idempotence (casse/accents/apostrophes)', () => {
  const a = ctx.cleCorrection_({ emetteur: 'Zephyr', domaine: 'A', categorie: '', entite: 'É', type: '' });
  const b = ctx.cleCorrection_({ emetteur: 'zephyr', domaine: 'a', categorie: '', entite: 'e', type: '' });
  assert.strictEqual(a, b);
});
