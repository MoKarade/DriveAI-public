'use strict';
/**
 * Chantier #14 (ADR-0010 §3) — mails importants au résumé hebdo. La ligne Index `important|<id>` est
 * écrite par le tri Gmail lui-même depuis l'ADR-0075 6b (2026-11-06 ; l'analyse d'importance
 * séparée, `Intentions.gs` et son mini-check, est retirée — ses tests avec elle).
 *  - `statsSemaine_` : collecte des mails importants, plafonnée, avec total.
 *  - `construireResume_` : section « À traiter », absente si vide.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// Les objets créés DANS le bac à sable vm ont un autre Object.prototype que ceux du test :
// on normalise par JSON avant deepStrictEqual (comparaison de STRUCTURE, pas de realm).
const plain = (o) => JSON.parse(JSON.stringify(o));

/* ---------- statsSemaine_ : collecte plafonnée + construireResume_ ---------- */

function ctxResume(lignes) {
  const c = load(['Config.gs', 'Resume.gs']);
  c.feuille_ = () => ({
    getLastRow: () => lignes.length + 1,
    getRange: (debut, col, nb, ncols) => ({
      getValues: () => lignes.slice(debut - 2, debut - 2 + nb).map((l) => l.slice(col - 1, col - 1 + ncols)),
    }),
  });
  return c;
}

function ligne(cle, date, nom, statut) {
  return [cle, date, nom, '', '', statut];
}

test('statsSemaine_ : collecte les importants dans la fenêtre (messageId extrait de la clé) ; les lignes intention-* historiques vont en « autres »', () => {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const vieux = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const c = ctxResume([
    ligne('intention|MA', hier, 'Newsletter', 'intention-ecartee'),
    ligne('intention|MC', hier, 'Réponds-moi stp', 'intention-importante'),
    ligne('important|MC', hier, 'Réponds-moi stp', 'important'),
    ligne('important|VIEUX', vieux, 'Hors fenêtre', 'important'), // hors fenêtre → ignoré
    ligne('tache|MA|h1', hier, 'Payer Hydro', 'tache'), // ligne HISTORIQUE (création retirée, ADR-0074) → Autres
    ligne('drive|X', hier, '2026-07-01_Facture_Zephyr.pdf', 'classé'),
  ]);
  const s = c.statsSemaine_(7);
  assert.strictEqual('mailsAnalyses' in s, false, 'ADR-0075 6b : plus de statut intention-* écrit, donc plus de compteur (no fake data)');
  assert.strictEqual(s.autres, 3, 'les deux lignes intention-* historiques et la ligne tache vont en « autres »');
  assert.strictEqual('actions' in s, false, 'plus de collecte « Actions & RDV »');
  assert.deepStrictEqual(plain(s.aTraiter), [{ sujet: 'Réponds-moi stp', messageId: 'MC' }]);
  assert.strictEqual(s.aTraiterTotal, 1);
  assert.strictEqual(s.importants, 1);
  // « important » ne pollue pas le bucket Autres ; la vieille ligne `tache` et les deux `intention-*` y vont (vérifié plus haut)
});

test('statsSemaine_ : collecte PLAFONNÉE mais totaux exacts (« … et N de plus »)', () => {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const lignes = [];
  for (let i = 0; i < 20; i++) lignes.push(ligne('important|M' + i, hier, 'Sujet ' + i, 'important'));
  const c = ctxResume(lignes);
  const s = c.statsSemaine_(7);
  assert.strictEqual(s.aTraiter.length, c.CONFIG.RESUME_IMPORTANTS_MAX);
  assert.strictEqual(s.aTraiterTotal, 20);
});

test('construireResume_ : section « À traiter » (avec lien Gmail), débordement affiché ; plus de « Actions & RDV » ni de compteurs Tasks/Calendar', () => {
  const c = load(['Config.gs', 'Resume.gs']);
  const s = {
    classe: 1, doublon: 0,
    technique: 0, media: 0, quarantaine: 0, importants: 12, autres: 0, total: 3,
    aTraiter: [{ sujet: 'Réponds-moi stp', messageId: 'MC' }],
    aTraiterTotal: 12,
  };
  const corps = c.construireResume_(s, 0, { dollars: 1.5, appels: 10 }, 7, '🟢', '');
  assert.ok(corps.includes('📌 À traiter'));
  assert.ok(corps.includes('Réponds-moi stp — https://mail.google.com/mail/#all/MC'));
  assert.ok(corps.includes('… et 11 de plus'));
  assert.ok(!corps.includes('Mails analysés'), 'ADR-0075 6b : la ligne « Mails analysés (importance) » est retirée');
  assert.ok(!corps.includes('Actions & RDV') && !corps.includes('Tâches créées') && !corps.includes('Événements créés'),
    'ADR-0074 : rien n\'est créé, le résumé ne l\'annonce plus');
});

test('construireResume_ : section ABSENTE quand il n\'y a rien (pas de bruit)', () => {
  const c = load(['Config.gs', 'Resume.gs']);
  const s = {
    classe: 0, doublon: 0,
    technique: 0, media: 0, quarantaine: 0, importants: 0, autres: 0, total: 0,
    aTraiter: [], aTraiterTotal: 0,
  };
  const corps = c.construireResume_(s, 0, { dollars: 0, appels: 0 }, 7, '🟢', '');
  assert.ok(!corps.includes('À traiter'));
});
