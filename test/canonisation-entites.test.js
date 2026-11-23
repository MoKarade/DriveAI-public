'use strict';
/**
 * CANONICALISATION & FUSION D'ENTITÉS (refonte 2026-07-07) — né du désordre RÉEL observé dans le
 * Drive de Marc (285 entités) : lui-même ×4, des génériques, la même chose éclatée (« Ford Modela »
 * / « Ford Modela 2011 » / « Ford Modela SE 2011 » ; une adresse en 6 variantes ; « Bellerives » en
 * 5 ; « tatek robotek » = OCR corrompu). Ces fonctions PURES ramènent chaque entité réelle à UNE
 * forme canonique, sans jamais fusionner deux entités DIFFÉRENTES (Ford ≠ Ford Modela, années/villes).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs']);

/* ---------- estProprietaireMarc_ : Marc n'est jamais l'entité d'un doc d'organisation ---------- */

test('estProprietaireMarc_ : reconnaît Marc sous ses variantes, rejette les autres', () => {
  for (const oui of ['Marc Alex Dominique Exemple', 'Marc A. Exemple', 'Exemple, Marc', 'Marc EXEMPLE']) {
    assert.strictEqual(ctx.estProprietaireMarc_(oui), true, `« ${oui} » = Marc`);
  }
  // Rejetés : autres personnes, et « M. Exemple »/« Baptiste Exemple » (un autre Exemple de la
  // famille ne doit PAS être confondu avec Marc — il reste une entité/titulaire légitime).
  for (const non of ['Sophie Tremblay', 'Exemple Hydro', 'Marc Tremblay', 'M. Exemple',
    'Baptiste Julien Patrick Exemple', 'Bellerives', '']) {
    assert.strictEqual(ctx.estProprietaireMarc_(non), false, `« ${non} » ≠ Marc`);
  }
});

/* ---------- retirerSuffixeJuridique_ ---------- */

test('retirerSuffixeJuridique_ : retire un suffixe FINAL, jamais un « SA » interne', () => {
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Anthropic PBC'), 'Anthropic');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Bellerives Inc.'), 'Bellerives');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('ALPHATEK Inc'), 'ALPHATEK');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Air Transat'), 'Air Transat');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Sassone'), 'Sassone'); // ne mange pas un « SA » interne
});

/* ---------- canoniserVehicule_ : marque + modèle seuls ---------- */

test('canoniserVehicule_ : retire année et finition, garde marque + modèle', () => {
  assert.strictEqual(ctx.canoniserVehicule_('Ford Modela SE 2011'), 'Ford Modela');
  assert.strictEqual(ctx.canoniserVehicule_('Ford Modela 2011'), 'Ford Modela');
  assert.strictEqual(ctx.canoniserVehicule_('Marquex Modelx'), 'Marquex Modelx');
  assert.strictEqual(ctx.canoniserVehicule_('Ford'), 'Ford');
});

/* ---------- canoniserAdresse_ : les 6 variantes d'une adresse → une forme ---------- */

test('canoniserAdresse_ : réduit à « numéro voie, ville », retire compléments et code postal', () => {
  assert.strictEqual(ctx.canoniserAdresse_('1201 Rue Exemple Alpha, App. 5, Québec Z9Z 9Z9'), '1201 Rue Exemple Alpha, Québec');
  assert.strictEqual(ctx.canoniserAdresse_('1201 Rue Exemple Alpha, Québec Z9Z 9Z9'), '1201 Rue Exemple Alpha, Québec');
  assert.strictEqual(ctx.canoniserAdresse_('12 4th Ave Exemple, Quebec'), '12 4e Avenue Exemple, Quebec');
  assert.strictEqual(ctx.canoniserAdresse_('Bellerives'), 'Bellerives'); // pas une adresse → inchangé
});

/* ---------- corrigerOcrConnu_ ---------- */

test('corrigerOcrConnu_ : corrige une corruption connue, n\'invente jamais', () => {
  assert.strictEqual(ctx.corrigerOcrConnu_('tatek robotek'), 'Betatek');
  assert.strictEqual(ctx.corrigerOcrConnu_('betatek robotek'), 'Betatek');
  assert.strictEqual(ctx.corrigerOcrConnu_('Bellerives'), 'Bellerives'); // absent de la table → inchangé
});

/* ---------- canoniserEntite_ : l'orchestrateur (le résultat visible) ---------- */

test('canoniserEntite_ : ramène chaque cas réel à sa forme canonique', () => {
  assert.strictEqual(ctx.canoniserEntite_('Ford Modela SE 2011'), 'Ford Modela');
  assert.strictEqual(ctx.canoniserEntite_('Bellerives Inc.'), 'Bellerives');
  assert.strictEqual(ctx.canoniserEntite_('tatek robotek'), 'Betatek');
  assert.strictEqual(ctx.canoniserEntite_('  hydro   quebec '), 'Hydro Quebec');
  assert.strictEqual(ctx.canoniserEntite_('IRCC'), 'IRCC'); // acronyme préservé
});

test('canoniserEntite_ : rejette (null) les génériques et le propriétaire', () => {
  assert.strictEqual(ctx.canoniserEntite_('banque'), null);
  assert.strictEqual(ctx.canoniserEntite_('cours de physique'), null);
  assert.strictEqual(ctx.canoniserEntite_('Marc EXEMPLE'), null);
  assert.strictEqual(ctx.canoniserEntite_(''), null);
  assert.strictEqual(ctx.canoniserEntite_(null), null);
});

/* ---------- cleCanoniqueEntite_ : la clé de déduplication ---------- */

test('cleCanoniqueEntite_ : deux variantes de la même entité partagent la clé', () => {
  assert.strictEqual(
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Modela 2011'),
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Modela SE 2011'));
  assert.strictEqual(
    ctx.cleCanoniqueEntite_('02 · Finances', 'Bellerives Inc.'),
    ctx.cleCanoniqueEntite_('02 · Finances', 'Bellerives'));
  assert.strictEqual(ctx.cleCanoniqueEntite_('02 · Finances', 'banque'), null); // générique → pas de clé
});

test('cleCanoniqueEntite_ : deux MODÈLES/marques différents ne collisionnent pas', () => {
  assert.notStrictEqual(
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Modela'),
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Focus'));
  assert.notStrictEqual(
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Modela'),
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Marquec Corolla'));
});

test('cleCanoniqueEntite_ : les variantes ANNÉE/FINITION d\'un même modèle fusionnent (choix : plainte Ford Modela)', () => {
  // Décision assumée : « Ford Modela »/« 2011 »/« SE 2011 » = UNE voiture. Corollaire documenté :
  // « Marquex Modelx 2014 » et « 2017 » fusionnent aussi au niveau modèle (Marc peut les re-séparer).
  const k = ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Marquex Modelx');
  assert.strictEqual(ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Marquex Modelx 2014'), k);
  assert.strictEqual(ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Marquex Modelx 2017'), k);
});

/* ---------- estFusionnableEntite_ durci : Ford ≠ Ford Modela ---------- */

test('estFusionnableEntite_ durci : « Ford » (marque seule) NE fusionne PAS avec « Ford Modela » (modèle)', () => {
  assert.strictEqual(ctx.estFusionnableEntite_('Ford', 'Ford Modela'), false);
  assert.strictEqual(ctx.estFusionnableEntite_('Marquex', 'Marquex Modelx'), false);
  // mais un complément GÉNÉRIQUE reste fusionnable (le cas Bellerives des tests existants)
  assert.strictEqual(ctx.estFusionnableEntite_('Bellerives', 'carte de crédit Bellerives'), true);
  assert.strictEqual(ctx.estFusionnableEntite_('banque Bellerives', 'Bellerives'), true);
  // et les adresses (≥2 jetons courts) ne sont pas visées par la garde
  assert.strictEqual(ctx.estFusionnableEntite_('1201 rue Exemple Alpha', '1201 Rue Exemple Alpha, App. 5, Québec'), true);
});
