'use strict';
/**
 * DriveAI#814 / ADR-0072 — une empreinte qui n'identifie rien n'est ni écrite à l'Index ni comparée.
 * L'empreinte d'un natif Google est le MD5 de son texte exporté : deux natifs vides ou quasi vides la partagent. Le drapeau
 * `ignorerDoublon` protégeait le natif lui-même mais l'empreinte était quand même inscrite, et un autre contenu vide
 * (fichier de 0 octet, pièce jointe vide) était ensuite jugé « déjà vu » et jeté en `_Doublons`.
 *
 * Trois étages : PUR (`empreinteUtilisable_`) · lecture (`estDoublon_`) · CHEMIN (`traiterDocument_`, `traiterFichierDepose_`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const VIDE = 'd41d8cd98f00b204e9800998ecf8427e'; // MD5 du contenu vide
const AUTRE = '0123456789abcdef0123456789abcdef';

/* ---------- PUR ---------- */

test('empreinteUtilisable_ : une empreinte d\'un contenu qui identifie quelque chose passe telle quelle', () => {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  assert.strictEqual(ctx.empreinteUtilisable_(AUTRE, false), AUTRE);
  assert.strictEqual(ctx.empreinteUtilisable_(AUTRE), AUTRE);
});

test('empreinteUtilisable_ : MD5 du vide, drapeau non identifiante ou empreinte absente → \'\'', () => {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  assert.strictEqual(ctx.empreinteUtilisable_(VIDE, false), '', 'MD5 du contenu vide');
  assert.strictEqual(ctx.empreinteUtilisable_(AUTRE, true), '', 'natif quasi vide : le MD5 est celui d\'un texte court');
  assert.strictEqual(ctx.empreinteUtilisable_('', false), '');
  assert.strictEqual(ctx.empreinteUtilisable_(undefined, false), '');
});

/* ---------- Lecture : estDoublon_ ---------- */

test('estDoublon_ : le MD5 du vide n\'est JAMAIS un doublon, même inscrit à l\'Index avant le correctif', () => {
  const ctx = load(['Config.gs', 'Journal.gs']);
  ctx._empreintesCache = {};
  ctx._empreintesCache[VIDE] = true;
  ctx._empreintesCache[AUTRE] = true;
  assert.strictEqual(ctx.estDoublon_(VIDE), false);
  assert.strictEqual(ctx.estDoublon_(AUTRE), true, 'témoin : une autre empreinte connue reste un doublon');
  assert.strictEqual(ctx.estDoublon_('INCONNUE'), false);
});

/* ---------- CHEMIN : traiterDocument_ ---------- */

/** Pipeline monté pour s'arrêter à l'écriture d'Index du chemin « technique » (une écriture, avec l'empreinte). */
function ctxPipeline(empreinteCalculee, dejaVue) {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const ecritures = [];
  const doublons = [];
  ctx.journalInfo_ = () => {};
  ctx.estPannePlateforme_ = () => false;
  ctx.indexContient_ = () => false;
  ctx.empreinteBlob_ = () => empreinteCalculee;
  ctx.estDoublon_ = (e) => dejaVue.indexOf(e) !== -1;
  ctx.porteurVivantDe_ = () => ({ vivant: true, fileId: 'EXEMPLAIRE_VIVANT_000001' });
  ctx.metaFichierRest_ = () => ({ taille: null, md5: empreinteCalculee }); // ADR-0077 : l'exemplaire porte la même empreinte
  ctx.doublonRapide_ = (nom) => { doublons.push(nom); return { dossierId: 'DUP', nom: 'dup_' + nom, statut: 'doublon', domaine: '', chemin: '' }; };
  ctx.estTechnique_ = () => true;
  ctx.routageTechnique_ = (nom) => ({ dossierId: 'TECH', nom: nom, statut: 'technique', domaine: '', chemin: '_Technique' });
  ctx.extension_ = () => '.gdoc';
  ctx.indexAjouter_ = (cle, dec, empreinte) => ecritures.push({ cle, statut: dec.statut, empreinte });
  ctx.gererEchec_ = () => {};
  const src = (extra) => Object.assign({
    cle: 'drive|N1', nom: 'vide', taille: 0, date: new Date('2026-07-01T00:00:00Z'),
    blob: () => ({}), placer: () => 'ID',
  }, extra || {});
  return { ctx, ecritures, doublons, src };
}

test('traiterDocument_ : natif au texte quasi vide → AUCUNE empreinte écrite à l\'Index', () => {
  const { ctx, ecritures, src } = ctxPipeline(AUTRE, []);
  ctx.traiterDocument_(src({ empreinteNonIdentifiante: true }));
  assert.strictEqual(ecritures.length, 1);
  assert.strictEqual(ecritures[0].empreinte, '', 'la colonne Empreinte reste vide');
});

test('traiterDocument_ : fichier vide (MD5 du vide) → rien d\'écrit et pas jugé doublon d\'un autre vide', () => {
  const { ctx, ecritures, doublons, src } = ctxPipeline(VIDE, [VIDE]);
  ctx.traiterDocument_(src());
  assert.strictEqual(doublons.length, 0, 'pas de fast-path doublon');
  assert.strictEqual(ecritures[0].statut, 'technique', 'le pipeline normal a poursuivi');
  assert.strictEqual(ecritures[0].empreinte, '');
});

test('traiterDocument_ : contenu qui identifie quelque chose, déjà vu → doublon ET empreinte écrite (comportement d\'avant)', () => {
  const { ctx, ecritures, doublons, src } = ctxPipeline(AUTRE, [AUTRE]);
  ctx.traiterDocument_(src());
  assert.strictEqual(doublons.length, 1, 'le fast-path doublon marche toujours');
  assert.strictEqual(ecritures[0].statut, 'doublon');
  assert.strictEqual(ecritures[0].empreinte, AUTRE);
  const neuf = ctxPipeline(AUTRE, []);
  neuf.ctx.traiterDocument_(neuf.src());
  assert.strictEqual(neuf.ecritures[0].empreinte, AUTRE, 'un contenu inédit voit son empreinte inscrite');
});

/* ---------- CHEMIN : l'intake pose le drapeau ---------- */

function ctxDepose(texte) {
  const docs = [];
  const ctx = load(['Config.gs', 'Intake.gs'], {
    DriveApp: {
      getFileById: () => ({
        getMimeType: () => 'application/vnd.google-apps.document',
        getName: () => 'natif',
        getSize: () => 0,
        getLastUpdated: () => new Date(1e12),
      }),
    },
    Utilities: { newBlob: (t) => ({ texte: t }) },
  });
  ctx.exportNatifMime_ = () => 'text/plain';
  ctx.exporterTexteNatif_ = () => texte;
  ctx.traiterDocument_ = (src) => docs.push(src);
  return { ctx, docs };
}

test('traiterFichierDepose_ : natif vide ou sous le seuil → empreinteNonIdentifiante posé', () => {
  [ '', 'x'.repeat(19) ].forEach((texte) => {
    const { ctx, docs } = ctxDepose(texte);
    ctx.traiterFichierDepose_('ID');
    assert.strictEqual(docs[0].empreinteNonIdentifiante, true, 'texte de ' + texte.length + ' car.');
  });
});

test('traiterFichierDepose_ : natif au texte exploitable → empreinte identifiante, fast-path doublon intact', () => {
  const { ctx, docs } = ctxDepose('x'.repeat(20));
  ctx.traiterFichierDepose_('ID');
  assert.strictEqual(docs[0].empreinteNonIdentifiante, false);
  assert.strictEqual(docs[0].ignorerDoublon, false);
});

/* ---------- CHEMIN COMPLET : deux natifs au texte vide, Index réel en mémoire ---------- */

test('deux natifs au texte vide puis un fichier de 0 octet : aucune empreinte écrite, aucun n\'est jugé doublon', () => {
  const rows = [['Clé', 'Date', 'Nom', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId']];
  const feuille = {
    getLastRow: () => rows.length,
    appendRow: (l) => rows.push(l),
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const l = [];
          for (let j = 0; j < (nc || 1); j++) { const v = (rows[r - 1 + i] || [])[c - 1 + j]; l.push(v === undefined ? '' : v); }
          out.push(l);
        }
        return out;
      },
      getValue: () => (rows[r - 1] || [])[c - 1],
      setValue: (v) => { rows[r - 1][c - 1] = v; },
    }),
  };
  const ctx = load(['Config.gs', 'Journal.gs', 'Pipeline.gs']);
  ctx.feuille_ = () => feuille;
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = () => {};
  ctx.estPannePlateforme_ = () => false;
  ctx.porteurVivantDe_ = () => ({ vivant: true, fileId: 'EXEMPLAIRE_VIVANT_000001' });
  ctx.metaFichierRest_ = () => ({ taille: null, md5: VIDE });
  ctx.estTechnique_ = () => true;
  ctx.routageTechnique_ = (nom) => ({ dossierId: 'TECH', nom: nom, statut: 'technique', domaine: '', chemin: '_Technique' });
  ctx.extension_ = () => '.gdoc';
  ctx.gererEchec_ = () => {};
  ctx.empreinteBlob_ = () => VIDE; // texte exporté vide, puis fichier vide : toujours le MD5 du vide
  const src = (cle, extra) => Object.assign({
    cle, nom: cle, taille: 0, date: new Date('2026-07-01T00:00:00Z'), blob: () => ({}), placer: () => 'ID',
  }, extra || {});
  ctx.traiterDocument_(src('drive|N1', { empreinteNonIdentifiante: true }));
  ctx.traiterDocument_(src('drive|N2', { empreinteNonIdentifiante: true }));
  ctx.traiterDocument_(src('drive|ZERO'));
  const donnees = rows.slice(1);
  assert.strictEqual(donnees.length, 3);
  donnees.forEach((l) => {
    assert.strictEqual(l[5], 'technique', l[0] + ' : poursuit le pipeline, pas un doublon');
    assert.strictEqual(l[6], '', l[0] + ' : colonne Empreinte vide');
  });
});
