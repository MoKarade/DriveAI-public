'use strict';
/**
 * ADR-0081 (vague 3c) — Réorganisation autonome encadrée des dossiers Drive (`Reorg.gs`),
 * journalisation dans `Actions` (round-trip annulable), et suivi passif des liens officiels
 * d'infolettres jamais lues (`TriGmail.gs`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('estActionReorgAutoSure_ et actionsProposeesAuto_ : filtre strict des propositions sûres', () => {
  const c = load(['Config.gs', 'Reorg.gs']);
  const lignes = [
    ['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté'],
    ['r|1', 'creer', '→P1', '', '02 · Finances/Banques', 'proposé', 'créer', 'T'],
    ['r|2', 'renommer', 'D1', '08/Vrac', '08/Archives', 'proposé', 'renommer', 'T'],
    ['r|3', 'deplacer', 'D2→P2', '08/D2', '03/D2', 'proposé', 'déplacer', 'T'],
    ['r|4', 'fusionner', 'D3→D4', '08/D3', '02/D4', 'proposé', 'fusionner interdit auto', 'T'],
    ['r|5', 'dossier-vide', 'D5', '08/Vide', '', 'proposé', 'jamais auto', 'T'],
    ['r|6', 'deplacer-fichier', 'F1→P2', 'doc.pdf', '02', 'proposé', 'fichier hors portée', 'T'],
    ['r|7', 'renommer', 'D6', '08/A', '08/B', 'validé', 'déjà validé', 'T'],
    ['r|8', 'creer', '→', '', '02/SansCible', 'proposé', 'cible manquante', 'T'],
    ['r|9', 'deplacer', 'D7→', '08/X', '02/X', 'proposé', 'cible manquante', 'T'],
  ];

  const cands = plain(c.actionsProposeesAuto_(lignes));
  assert.deepStrictEqual(cands.map((x) => x.cle), ['r|1', 'r|2', 'r|3']);
  assert.strictEqual(c.estActionReorgAutoSure_(null), false);
});

function creerFeuilleReorg(lignesInit) {
  const lignes = [
    ['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté'],
    ...lignesInit,
  ];
  const feuille = {
    getLastRow: () => lignes.length,
    getDataRange: () => ({ getValues: () => lignes }),
    getRange: (r, col) => ({
      setValue: (v) => { lignes[r - 1][col - 1] = v; },
    }),
  };
  return { feuille, lignes };
}

test('appliquerReorgAuto_ : applique jusqu’à REORG_AUTO_MAX_PAR_RUN, consigne dans Actions, respecte 04 et le frein 30 $', () => {
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const c = load(['Config.gs', 'Actions.gs', 'Reorg.gs']);
  c.CONFIG = Object.assign({}, c.CONFIG, { REORG_AUTO_ACTIF: true, REORG_AUTO_MAX_PAR_RUN: 2 });

  const { feuille, lignes } = creerFeuilleReorg([
    ['r|1', 'creer', '→P1', '', '02 · Finances/Impôts', 'proposé', 'créer', 'T'],
    ['r|2', 'renommer', 'D1', '08/Vieux', '08/Archives', 'proposé', 'renommer', 'T'],
    ['r|3', 'deplacer', 'D2→P1', '08/B', '02/B', 'proposé', 'déplacer', 'T'],
    ['r|4', 'renommer', 'D_PROT', '04/Sub', '04/Autre', 'proposé', 'protégé', 'T'],
  ]);
  const actionsEcrites = [];
  const feuilleActions = {
    appendRow: (row) => actionsEcrites.push(row),
  };
  const dossiers = {
    P1: {
      getId: () => 'P1', getName: () => 'Finances',
      getFoldersByName: () => iter([]),
      createFolder: (n) => ({ getId: () => 'NEW_' + n, getName: () => n }),
      getParents: () => iter([]),
    },
    D1: {
      _nom: 'Vieux',
      getId: () => 'D1',
      getName() { return this._nom; },
      setName(n) { this._nom = n; },
      getParents: () => iter([{ getId: () => 'P0', getName: () => '08', getParents: () => iter([]) }]),
    },
    D2: {
      getId: () => 'D2', getName: () => 'B',
      getParents: () => iter([{ getId: () => 'P0', getName: () => '08', getParents: () => iter([]) }]),
      moveTo: () => {},
    },
    D_PROT: {
      getId: () => 'D_PROT', getName: () => 'Sub',
      getParents: () => iter([]),
      setName: () => { throw new Error('ne doit jamais muter 04'); },
    },
  };

  c.feuille_ = (nom) => (nom === 'Actions' ? feuilleActions : feuille);
  c.ensembleDomainesProteges_ = () => ({ IMM: true });
  c.ensembleIntouchables_ = () => ({});
  c.aParentProtege_ = (d) => d.getId() === 'D_PROT';
  c.chaineMonteVersProtege_ = () => false;
  c.estSegmentStructurel_ = () => false;
  c.budgetCampagnesAtteint_ = () => false;
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.DriveApp = { getFolderById: (id) => dossiers[id] };

  const reste1 = c.appliquerReorgAuto_(feuille, lignes, () => false);
  assert.strictEqual(reste1, true, 'plafond REORG_AUTO_MAX_PAR_RUN=2 laisse le reliquat au tick suivant');
  assert.strictEqual(lignes[1][5], 'appliqué');
  assert.strictEqual(lignes[2][5], 'appliqué');
  assert.strictEqual(lignes[3][5], 'proposé', '3e action pas encore exécutée');
  assert.strictEqual(actionsEcrites.length, 2);
  assert.strictEqual(actionsEcrites[0][2], 'drive-dossier');
  assert.strictEqual(actionsEcrites[1][2], 'drive-renommer');

  // Frein budget 30 $ : rien ne tourne
  c.budgetCampagnesAtteint_ = () => true;
  assert.strictEqual(c.appliquerReorgAuto_(feuille, lignes, () => false), false);
  assert.strictEqual(lignes[3][5], 'proposé');

  // Reprise sous budget OK : exécute r|3 et refuse D_PROT en zone protégée
  c.budgetCampagnesAtteint_ = () => false;
  const reste2 = c.appliquerReorgAuto_(feuille, lignes, () => false);
  assert.strictEqual(reste2, false);
  assert.strictEqual(lignes[3][5], 'appliqué');
  assert.strictEqual(lignes[4][5], 'refusé (zone protégée)');
  assert.strictEqual(actionsEcrites.length, 3, 'D_PROT refusé n\'écrit aucune action');
  assert.strictEqual(actionsEcrites[2][2], 'drive-deplacer');
});

test('aller-retour Réorg → Actions → annulerAction_ : renommage et déplacement réellement annulables', () => {
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const c = load(['Config.gs', 'Actions.gs', 'Reorg.gs']);
  const rowsActions = [
    ['Id', 'Horodatage', 'Type', 'Cible', 'Avant', 'Après', 'Statut', 'Détail'],
  ];
  const feuilleActions = {
    getLastRow: () => rowsActions.length,
    appendRow: (row) => rowsActions.push(row),
    getRange: (r, col, nr, nc) => ({
      getValues: () => rowsActions.slice(r - 1, r - 1 + nr).map((l) => l.slice(col - 1, col - 1 + nc)),
      setValue: (v) => { rowsActions[r - 1][col - 1] = v; },
    }),
  };
  const appelsDrive = [];
  c.feuille_ = () => feuilleActions;
  c.deplacerEtRenommer_ = (id, vers, depuis, nom) => { appelsDrive.push({ type: 'dep', id, vers, depuis, nom }); return true; };
  c.renommer_ = (id, nom) => { appelsDrive.push({ type: 'ren', id, nom }); return true; };
  c.aParentProtege_ = () => false;
  c.chaineMonteVersProtege_ = () => false;
  c.estSegmentStructurel_ = () => false;
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.DriveApp = {
    getFolderById: (id) => ({
      getId: () => id,
      getName: () => (id === 'D1' ? 'AncienNom' : 'Cible'),
      setName: () => {},
      moveTo: () => {},
      getParents: () => iter([{ getId: () => 'P_OLD', getName: () => 'Orig', getParents: () => iter([]) }]),
    }),
  };

  assert.strictEqual(c.appliquerUneAction_({ type: 'renommer', source: 'D1', cheminPropose: '08/NouveauNom' }, {}, {}, () => false).statut, 'appliqué');
  assert.strictEqual(c.appliquerUneAction_({ type: 'deplacer', source: 'D1', cible: 'P_NEW', cheminPropose: '02/AncienNom' }, {}, {}, () => false).statut, 'appliqué');

  assert.strictEqual(rowsActions.length, 3);
  const resRen = plain(c.annulerAction_(rowsActions[1][0]));
  const resDep = plain(c.annulerAction_(rowsActions[2][0]));
  assert.strictEqual(resRen.ok, true);
  assert.strictEqual(resDep.ok, true);
  assert.deepStrictEqual(appelsDrive, [
    { type: 'ren', id: 'D1', nom: 'AncienNom' },
    { type: 'dep', id: 'D1', vers: 'P_OLD', depuis: 'P_NEW', nom: 'AncienNom' },
  ]);
});

test('extraireLienDesabonnement_ : HTTPS strict + RFC 8058 One-Click, rejette http/mailto/script', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  assert.deepStrictEqual(
    plain(c.extraireLienDesabonnement_('<mailto:unsub@exemple.test>, <https://exemple.test/desabo?id=1>', 'List-Unsubscribe=One-Click')),
    { url: 'https://exemple.test/desabo?id=1', oneClick: true }
  );
  assert.deepStrictEqual(
    plain(c.extraireLienDesabonnement_('https://exemple.test/out', '')),
    { url: 'https://exemple.test/out', oneClick: false }
  );
  assert.strictEqual(c.extraireLienDesabonnement_('<http://exemple.test/insec>, <mailto:a@b.c>', ''), null);
  assert.strictEqual(c.extraireLienDesabonnement_('<javascript:alert(1)>', ''), null);
  assert.strictEqual(c.extraireLienDesabonnement_('<https://exemple.test/' + 'a'.repeat(300) + '>', ''), null);
  assert.strictEqual(c.extraireLienDesabonnement_('', ''), null);
});

test('trierFil_ : consigne le lien officiel d’infolettre si Fiche=bas, idempotent, jamais hors Fiche=bas/zone protégée/suspect, 0 fetch', () => {
  function runInfolettre(opts) {
    const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Actions.gs']);
    const index = Object.assign({}, opts.indexInit || {});
    const ajouts = [];
    const actions = [];
    let fetchCalls = 0;
    c.UrlFetchApp = { fetch: () => { fetchCalls++; throw new Error('aucune requête HTTP sortante autorisée'); } };
    c.reinitialiserLibellesCrees_();
    c.reinitialiserBrouillonsTri_();
    c.reinitialiserEscaladeTri_();
    c.budgetCampagnesAtteint_ = () => false;
    c.estHorsFenetreIntentions_ = () => false;
    c.indexContient_ = (k) => !!index[k];
    c.indexAjouter_ = (k, r) => { index[k] = true; ajouts.push({ cle: k, ...plain(r) }); };
    c.toucheZoneProtegee_ = () => !!opts.zoneProtegee;
    c.ecarteParMotsCles_ = () => false;
    c.piecesJointes_ = () => [];
    c.estPannePlateforme_ = () => false;
    c.estPromoGmail_ = () => true;
    c.triApprisCache_ = () => ({ 'info@lettre.test': 'Infolettres' });
    c.confianceCache_ = () => ({});
    c.ficheCache_ = () => ({ 'info@lettre.test': { niveau: opts.ficheNiveau || 'bas', score: 0 } });
    c.apprendreTri_ = () => {};
    c.journalInfo_ = () => {};
    c.journalErreur_ = () => {};
    c.enregistrerAction_ = (t, cible, av, ap, det) => { actions.push({ t, cible, ap, det }); return 'act-unsub1'; };
    c.analyserFil_ = () => ({ categorie: 'Infolettres', suspect: !!opts.suspect, aTraiter: false, resume: '' });

    const libelles = {
      Infolettres: { getName: () => 'Infolettres', addToThread: () => {} },
      '⚠️ Suspect': { getName: () => '⚠️ Suspect', addToThread: () => {} },
    };
    const fil = {
      getId: () => 'FIL_NEWS_1',
      isInInbox: () => true,
      isUnread: () => true,
      getLastMessageDate: () => new Date(1000),
      getLabels: () => [],
      getMessages: () => [{
        getId: () => 'MSG_N1',
        getFrom: () => 'Info <info@lettre.test>',
        getSubject: () => 'Édition hebdomadaire',
        getHeader: (h) => (h === 'List-Unsubscribe'
          ? (opts.headerUnsub !== undefined ? opts.headerUnsub : '<https://lettre.test/unsub?t=abc>')
          : (h === 'List-Unsubscribe-Post' ? 'List-Unsubscribe=One-Click' : '')),
        getPlainBody: () => 'Nouvelles.',
        isDraft: () => false,
      }],
      moveToArchive: () => {},
    };
    c.trierFil_(fil, ['Infolettres'], libelles, false, !!opts.horsBoite);
    return { ajouts, actions, fetchCalls };
  }

  const ok = runInfolettre({ ficheNiveau: 'bas' });
  assert.strictEqual(ok.fetchCalls, 0);
  const unsubIdx = ok.ajouts.find((a) => a.cle === 'tri|unsub|info@lettre.test');
  assert.ok(unsubIdx);
  assert.strictEqual(unsubIdx.statut, 'infolettre-desabo');
  assert.strictEqual(unsubIdx.chemin, 'https://lettre.test/unsub?t=abc');
  assert.deepStrictEqual(ok.actions, [{
    t: 'gmail-infolettre',
    cible: 'info@lettre.test',
    ap: 'https://lettre.test/unsub?t=abc',
    det: 'Infolettre jamais lue — lien officiel repéré (1-clic RFC 8058)',
  }]);

  // Idempotent si tri|unsub|<adresse> déjà présent
  const deja = runInfolettre({ ficheNiveau: 'bas', indexInit: { 'tri|unsub|info@lettre.test': true } });
  assert.strictEqual(deja.actions.length, 0);

  // Pas enregistré si Fiche != bas, en zone protégée ou suspect
  assert.strictEqual(runInfolettre({ ficheNiveau: 'haut' }).actions.length, 0);
  assert.strictEqual(runInfolettre({ ficheNiveau: 'bas', zoneProtegee: true }).actions.length, 0);
  assert.strictEqual(runInfolettre({ ficheNiveau: 'bas', suspect: true }).actions.length, 0);
});
