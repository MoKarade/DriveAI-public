'use strict';
/**
 * DriveAI#817 — `rattraperMediasMalClasses` DÉPLACE (removeParents) : il ne doit jamais sortir une
 * pièce de la zone protégée (§1, `CONFIG.DOMAINES_PROTEGES`) vers `_Médias`. Deux gardes, chacune
 * AVANT l'OCR et le LLM :
 *   - le domaine inscrit à l'Index (colonne D) ;
 *   - la remontée d'ancêtres du fichier (`aParentProtege_`, stricte).
 * Le cas nominal de la fonction est une photo SANS texte (OCR < MEDIAS_OCR_MAX_CARS), donc le seul
 * contrôle sous `texte.length >= …` (`toucheZoneProtegee_`) ne l'atteint jamais : sans ces deux
 * gardes, une photo de passeport rangée sous 04 sortait vers `_Médias` (audit sécurité 2026-09-10).
 * Le test « témoin » prouve que le montage atteint bien le déplacement : sans lui, les deux autres
 * seraient verts même si la fonction ne déplaçait plus rien.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, fakeFolder, iter } = require('./harness');

const DOM_PROTEGE = '04 · Immigration';
const ID_RACINE_04 = 'RACINE_04';
const ID_MEDIAS = 'DOSSIER_MEDIAS';

/**
 * Monte un contexte avec UNE ligne d'Index « classé » (photo récente) et un faux fichier Drive.
 * @param {Object} o  { domaine: valeur de la colonne D, parents: dossiers parents du fichier }
 * @return {{ctx: Object, deplacements: Array, ecritures: Array, ocr: number[]}}
 */
function monter(o) {
  const ctx = load(['Config.gs', 'Router.gs', 'Maintenance.gs']);
  ctx.CONFIG.DOMAINES[DOM_PROTEGE] = ID_RACINE_04; // ensembleDomainesProteges_() lit cet ID
  const deplacements = [];
  const ecritures = [];
  const ocr = [];
  // A=Clé, B=Traité le, C=Fichier, D=Domaine, E=Chemin, F=Statut
  const ligne = ['drive|F1', new Date('2026-09-01T00:00:00'), 'IMG_2734.jpg', o.domaine, 'x', 'classé'];
  ctx.feuille_ = () => ({
    getLastRow: () => 2,
    getRange: (l, c, n, w) => ({
      getValues: () => [ligne.slice(c - 1, c - 1 + w)],
      setValues: (vals) => ecritures.push([l, c, vals]),
    }),
  });
  ctx.dossierMedias_ = () => ({ getId: () => ID_MEDIAS });
  const fichier = {
    getParents: () => iter(o.parents),
    getBlob: () => ({}),
    getSize: () => 1000,
  };
  ctx.DriveApp = { getFileById: () => fichier };
  ctx.extraireTexte_ = (blob) => { ocr.push(1); return ''; }; // photo SANS texte : le cas nominal
  ctx.deplacerEtRenommer_ = (id, vers, depuis, nom) => { deplacements.push([id, vers, depuis, nom]); return true; };
  return { ctx, deplacements, ecritures, ocr };
}

test('témoin : photo hors zone protégée, OCR vide → déplacée vers _Médias (le montage atteint le déplacement)', () => {
  const m = monter({ domaine: '08 · Perso & projets', parents: [fakeFolder('AUTRE', [])] });
  m.ctx.rattraperMediasMalClasses();
  assert.strictEqual(m.deplacements.length, 1, 'sans quoi les deux tests suivants seraient vides');
  assert.strictEqual(m.deplacements[0][1], ID_MEDIAS);
  // JSON : le tableau vient du contexte vm (autre realm), deepStrictEqual comparerait les prototypes.
  assert.strictEqual(JSON.stringify(m.ecritures[0][2]), JSON.stringify([['', '_Médias', 'média']]));
});

test('ne rétrograde pas une pièce de la zone protégée : domaine 04 à l\'Index → ni OCR, ni déplacement', () => {
  const m = monter({ domaine: DOM_PROTEGE, parents: [fakeFolder('AUTRE', [])] });
  m.ctx.rattraperMediasMalClasses();
  assert.deepStrictEqual(m.deplacements, [], 'une pièce 04 ne sort jamais vers _Médias');
  assert.deepStrictEqual(m.ecritures, [], 'la ligne d\'Index reste « classé »');
  assert.strictEqual(m.ocr.length, 0, 'écartée AVANT tout coût (OCR/LLM)');
});

test('ne rétrograde pas une pièce de la zone protégée : parent sous la racine 04 (colonne D vide ou fausse)', () => {
  // La colonne D peut être vide ou périmée ; seule la remontée d'ancêtres voit alors la zone protégée.
  const sousSousDossier = fakeFolder('SOUS', [fakeFolder('INTERMEDIAIRE', [fakeFolder(ID_RACINE_04, [])])]);
  const m = monter({ domaine: '', parents: [sousSousDossier] });
  m.ctx.rattraperMediasMalClasses();
  assert.deepStrictEqual(m.deplacements, [], 'ancêtre protégé → pas de déplacement');
  assert.deepStrictEqual(m.ecritures, []);
  assert.strictEqual(m.ocr.length, 0, 'écartée AVANT l\'OCR');
});

test('échoue-fermé : parents illisibles → abstention, jamais un déplacement à l\'aveugle', () => {
  const m = monter({ domaine: '', parents: [] });
  m.ctx.DriveApp = { getFileById: () => ({
    getParents: () => { throw new Error('getParents indisponible (racine/Drive partagé simulé)'); },
    getBlob: () => ({}),
    getSize: () => 1000,
  }) };
  m.ctx.rattraperMediasMalClasses();
  assert.deepStrictEqual(m.deplacements, [], 'dans le doute (mode strict), on ne détache pas');
});
