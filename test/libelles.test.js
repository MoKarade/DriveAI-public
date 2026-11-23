'use strict';
/**
 * ADR-0081 (vague 3d) — Hiérarchie 10 libellés principaux + sous-libellés, plafond 50 au total,
 * et remplacement complet avec preuves (`Libelles.gs`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('compterStructureLibelles_ et autoriserCreationLibelle_ : 10 principaux max, 50 libellés max, spéciaux exclus', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const dixPrincipaux = [
    'Finance', 'Scolarité', 'Logement', 'Achats', 'Administration',
    'Sécurité', 'Santé', 'Voyages', 'Emploi', 'Perso',
    'À vérifier', '⚠️ Suspect', '⏰ À traiter',
  ];

  const stats = plain(c.compterStructureLibelles_(dixPrincipaux));
  assert.strictEqual(stats.total, 10, 'les 3 spéciaux sont exclus du total');
  assert.strictEqual(stats.nbPrincipaux, 10);

  // Au plafond de 10 principaux : un 11e principal est refusé, un sous-libellé sous principal existant passe
  assert.deepStrictEqual(
    plain(c.autoriserCreationLibelle_('Loisirs', dixPrincipaux)),
    { ok: false, raison: 'plafond-principaux' }
  );
  assert.deepStrictEqual(
    plain(c.autoriserCreationLibelle_('Finance/Banque', dixPrincipaux)),
    { ok: true, raison: '' }
  );
  assert.deepStrictEqual(
    plain(c.autoriserCreationLibelle_('Loisirs/Sport', dixPrincipaux)),
    { ok: false, raison: 'principal-inconnu' }
  );

  // Au plafond de 50 libellés au total : toute nouvelle création est refusée
  const cinquante = ['Finance', 'Santé', 'Voyages'];
  for (let i = 1; cinquante.length < 50; i++) cinquante.push('Finance/Sous_' + i);
  assert.strictEqual(c.compterStructureLibelles_(cinquante).total, 50);
  assert.deepStrictEqual(
    plain(c.autoriserCreationLibelle_('Finance/Extra', cinquante)),
    { ok: false, raison: 'plafond-total' }
  );
});

test('creerLibelleAutonome_ : refuse au-delà de 10 principaux (nouveau principal) ou 50 total', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Actions.gs']);
  const crees = [];
  c.reinitialiserLibellesCrees_();
  c.budgetCampagnesAtteint_ = () => false;
  c.dateGmail_ = () => '2026/11/23';
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.enregistrerAction_ = () => 'act-lib1';
  c.PropertiesService = {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }),
  };
  c.GmailApp = {
    createLabel: (nom) => { crees.push(nom); return { getName: () => nom }; },
  };

  const libelles = {};
  const candidats = [];
  for (const r of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']) {
    libelles[r] = { getName: () => r };
    candidats.push(r);
  }

  assert.strictEqual(c.creerLibelleAutonome_('NouveauPrincipal', candidats, libelles), '');
  assert.strictEqual(c.creerLibelleAutonome_('P1/Factures', candidats, libelles), 'P1/Factures');
  assert.deepStrictEqual(crees, ['P1/Factures']);
});

test('validerPreuveRemplacement_ : exige preuves >= 5 fils + motif, protège spéciaux et plafond 10 principaux', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Libelles.gs']);
  const existants = [
    'Finance', 'Scolarité', 'Logement', 'Achats', 'Administration',
    'Sécurité', 'Santé', 'Voyages', 'Emploi', 'Perso', 'Voyage',
  ];

  assert.strictEqual(c.validerPreuveRemplacement_('Voyage', 'Voyages', { motif: 'abc', filsObserves: 8 }, existants).ok, false);
  assert.strictEqual(c.validerPreuveRemplacement_('Voyage', 'Voyages', { motif: 'doublon exact prouvé', filsObserves: 4 }, existants).ok, false);
  assert.strictEqual(c.validerPreuveRemplacement_('⚠️ Suspect', 'Voyages', { motif: 'doublon exact prouvé', filsObserves: 10 }, existants).ok, false);
  assert.strictEqual(c.validerPreuveRemplacement_('Voyage', 'Voyage', { motif: 'doublon exact prouvé', filsObserves: 10 }, existants).ok, false);

  // Fusion vers libellé existant autorisée même à 11 racines actuelles
  assert.strictEqual(c.validerPreuveRemplacement_('Voyage', 'Voyages', { motif: 'regroupement prouvé', filsObserves: 7 }, existants).ok, true);

  // Nouveau libellé principal refusé si sansAncien laisse >= 10 principaux
  assert.strictEqual(c.validerPreuveRemplacement_('Voyage', 'AutreRacine', { motif: 'renommage prouvé', filsObserves: 7 }, existants).ok, false);
  // Sous-libellé sous principal existant accepté
  assert.strictEqual(c.validerPreuveRemplacement_('Voyage', 'Voyages/Vols', { motif: 'sous-catégorie plus précise', filsObserves: 7 }, existants).ok, true);
});

test('remplacerLibelle_ : pose nouveau AVANT retrait ancien, maj TriAppris, supprime ancien une fois vide et journalise Actions', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Actions.gs', 'Libelles.gs']);
  c.CONFIG = Object.assign({}, c.CONFIG, { TRI_REMPLACEMENT_LOT_FILS: 2 });

  const filsAncien = [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }];
  const journalOps = [];
  const actions = [];
  let deleted = false;
  let resetsTriAppris = 0;

  const labelAncien = {
    getThreads: (start, max) => filsAncien.slice(start, start + max),
    removeFromThread: (f) => {
      journalOps.push('remove:' + f.id);
      const idx = filsAncien.indexOf(f);
      if (idx !== -1) filsAncien.splice(idx, 1);
    },
    deleteLabel: () => { deleted = true; journalOps.push('deleteLabel'); },
  };
  const labelNouveau = {
    addToThread: (f) => { journalOps.push('add:' + f.id); },
  };

  const triApprisRows = [
    ['Adresse', 'Libellé', 'Appris le'],
    ['a@exemple.test', 'Voyage', '2026-11-01'],
    ['b@exemple.test', 'Finance', '2026-11-01'],
  ];
  const feuilleTriAppris = {
    getLastRow: () => triApprisRows.length,
    getRange: (r, col, nr, nc) => ({
      getValues: () => triApprisRows.slice(r - 1, r - 1 + nr).map((l) => l.slice(col - 1, col - 1 + nc)),
      setValue: (v) => { triApprisRows[r - 1][col - 1] = v; },
    }),
  };

  c.feuille_ = () => feuilleTriAppris;
  c.reinitialiserTriApprisCache_ = () => { resetsTriAppris++; };
  c.reinitialiserLibellesCache_ = () => {};
  c.journalInfo_ = () => {};
  c.enregistrerAction_ = (t, cible, av, ap, det) => { actions.push({ t, cible, av, ap, det }); return 'act-sw1'; };
  c.GmailApp = {
    getUserLabelByName: (n) => (n === 'Voyage' ? labelAncien : (n === 'Voyages' ? labelNouveau : null)),
    createLabel: () => labelNouveau,
  };

  const existants = ['Voyage', 'Voyages', 'Finance'];
  const preuve = { motif: 'doublon singulier/pluriel prouvé', filsObserves: 6 };

  // Lot 1 (max 2 fils) : reste T3 → pas encore deleteLabel
  const r1 = plain(c.remplacerLibelle_('Voyage', 'Voyages', preuve, () => false, existants));
  assert.deepStrictEqual(r1, { ok: true, termine: false, migres: 2 });
  assert.strictEqual(deleted, false);
  assert.strictEqual(triApprisRows[1][1], 'Voyages');
  assert.strictEqual(resetsTriAppris, 1);

  // Lot 2 (T3) : 0 restant → deleteLabel + action journalisée
  const r2 = plain(c.remplacerLibelle_('Voyage', 'Voyages', preuve, () => false, existants));
  assert.deepStrictEqual(r2, { ok: true, termine: true, migres: 1 });
  assert.strictEqual(deleted, true);
  assert.deepStrictEqual(journalOps, [
    'add:T1', 'remove:T1',
    'add:T2', 'remove:T2',
    'add:T3', 'remove:T3',
    'deleteLabel',
  ]);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].t, 'gmail-libelle-remplacer');
  assert.strictEqual(actions[0].av, 'Voyage');
  assert.strictEqual(actions[0].ap, 'Voyages');
});

test('planifierRemplacementLibelle_ + traiterRemplacementLibelleEnCours_ : frein 30 $, reprise et nettoyage', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Actions.gs', 'Libelles.gs']);
  const props = {};
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }),
  };
  let frein = true;
  let passes = 0;
  c.budgetCampagnesAtteint_ = () => frein;
  c.libellesUtilisateur_ = () => ({ Ancien: {}, Nouveau: {} });
  c.remplacerLibelle_ = () => { passes++; return { ok: true, termine: true, migres: 5 }; };

  const planOk = plain(c.planifierRemplacementLibelle_('Ancien', 'Nouveau', 'meilleur regroupement prouvé', 8, ['Ancien', 'Nouveau']));
  assert.strictEqual(planOk.ok, true);
  assert.ok(props[c.LIBELLE_SWITCH_PROP]);

  // Sous frein budget 30 $ : différé sans perdre la demande
  c.traiterRemplacementLibelleEnCours_(() => false);
  assert.strictEqual(passes, 0);
  assert.ok(props[c.LIBELLE_SWITCH_PROP]);

  // Budget levé : exécute et nettoie
  frein = false;
  c.traiterRemplacementLibelleEnCours_(() => false);
  assert.strictEqual(passes, 1);
  assert.strictEqual(c.LIBELLE_SWITCH_PROP in props, false);
});
