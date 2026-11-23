'use strict';
/**
 * ADR-0081 (vague 3a) — Journal des actions réversibles (`Actions.gs`), annulation 1-clic
 * (`WebApp.gs`) et création autonome et encadrée de libellés Gmail (`TriGmail.gs`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('validerActionId_ / serialiserEtatAction_ / parserEtatAction_ : validation et sérialisation pures', () => {
  const c = load(['Config.gs', 'Actions.gs']);
  assert.strictEqual(c.validerActionId_('act-m9z1abc-xy12ab'), 'act-m9z1abc-xy12ab');
  assert.strictEqual(c.validerActionId_('act-123456'), 'act-123456');
  assert.strictEqual(c.validerActionId_('act-123'), '');
  assert.strictEqual(c.validerActionId_('mauvais-id-123456'), '');
  assert.strictEqual(c.validerActionId_('act-avec|pipe123'), '');
  assert.strictEqual(c.validerActionId_(null), '');

  assert.strictEqual(c.serialiserEtatAction_(null), '');
  assert.strictEqual(c.serialiserEtatAction_(undefined), '');
  assert.strictEqual(c.serialiserEtatAction_('a'.repeat(350)).length, 300);
  const objLong = { parentId: 'D1', nom: 'b'.repeat(600) };
  assert.strictEqual(c.serialiserEtatAction_(objLong).length, 500);

  assert.deepStrictEqual(plain(c.parserEtatAction_('{"parentId":"P1","nom":"doc.pdf"}')), { parentId: 'P1', nom: 'doc.pdf' });
  assert.strictEqual(c.parserEtatAction_('pas-du-json'), null);
  assert.strictEqual(c.parserEtatAction_('"chaine"'), null);
  assert.strictEqual(c.parserEtatAction_(''), null);
});

function creerSheetActions(lignesInitiales) {
  const lignes = [
    ['Id', 'Horodatage', 'Type', 'Cible', 'Avant', 'Après', 'Statut', 'Détail'],
    ...(lignesInitiales || []),
  ];
  const feuille = {
    getLastRow: () => lignes.length,
    appendRow: (row) => lignes.push(row),
    getRange: (r, c, nr, nc) => ({
      getValues: () => lignes.slice(r - 1, r - 1 + nr).map((l) => l.slice(c - 1, c - 1 + nc)),
      setValue: (v) => { lignes[r - 1][c - 1] = v; },
    }),
  };
  return { feuille, lignes };
}

test('enregistrerAction_ + annulerAction_ : drive-deplacer réussi, idempotent au 2e appel, drive-renommer et refus sans suppression', () => {
  const { feuille, lignes } = creerSheetActions();
  const c = load(['Config.gs', 'Actions.gs']);
  const mouvements = [];
  const renommages = [];
  const infos = [];
  c.feuille_ = () => feuille;
  c.deplacerEtRenommer_ = (id, vers, depuis, nom) => {
    mouvements.push({ id, vers, depuis, nom });
    return true;
  };
  c.renommer_ = (id, nom) => { renommages.push({ id, nom }); return true; };
  c.journalInfo_ = (s, m) => infos.push(m);
  c.journalErreur_ = () => {};

  const idDep = c.enregistrerAction_(
    'drive-deplacer',
    'FICTIF_FILE_1',
    { parentId: 'FICTIF_ATRIER', nom: 'brut.pdf' },
    { parentId: 'FICTIF_FINANCES', nom: '2026-11-23_Facture_Exemple.pdf' },
    'Classement dépôt manuel'
  );
  assert.ok(/^act-[A-Za-z0-9_-]{6,64}$/.test(idDep));
  assert.strictEqual(lignes.length, 2);
  assert.strictEqual(lignes[1][6], 'appliqué');

  const r1 = plain(c.annulerAction_(idDep));
  assert.deepStrictEqual(r1, { ok: true, actionId: idDep, type: 'drive-deplacer', message: 'Action annulée.' });
  assert.deepStrictEqual(mouvements, [{ id: 'FICTIF_FILE_1', vers: 'FICTIF_ATRIER', depuis: 'FICTIF_FINANCES', nom: 'brut.pdf' }]);
  assert.strictEqual(lignes[1][6], 'annulé');
  assert.strictEqual(infos.length, 1);

  const r2 = plain(c.annulerAction_(idDep));
  assert.deepStrictEqual(r2, { ok: true, dejaAnnule: true, actionId: idDep, message: 'Action déjà annulée.' });
  assert.strictEqual(mouvements.length, 1, 'idempotent : aucun second mouvement Drive');

  const idRen = c.enregistrerAction_(
    'drive-renommer',
    'FICTIF_FILE_2',
    { nom: 'ancien.pdf' },
    { nom: 'nouveau.pdf' },
    'Renommage'
  );
  const rRen = plain(c.annulerAction_(idRen));
  assert.strictEqual(rRen.ok, true);
  assert.deepStrictEqual(renommages, [{ id: 'FICTIF_FILE_2', nom: 'ancien.pdf' }]);

  const idLab = c.enregistrerAction_('gmail-libelle', 'Voyages/Trains', '', 'Voyages/Trains', 'Libellé créé');
  const rLab = plain(c.annulerAction_(idLab));
  assert.strictEqual(rLab.ok, false);
  assert.match(rLab.erreur, /aucune suppression automatique/);
  assert.strictEqual(lignes[3][6], 'appliqué', 'jamais supprimé ni marqué annulé à tort');

  const idDos = c.enregistrerAction_('drive-dossier', 'FICTIF_DIR_9', '', { parentId: 'P', nom: 'D' }, 'Dossier créé');
  assert.strictEqual(c.annulerAction_(idDos).ok, false);
});

test('annulerAction_ et enregistrerAction_ : échec Drive préserve appliqué, Sheet en panne ne bloque pas', () => {
  const { feuille, lignes } = creerSheetActions([
    ['act-123456', new Date(), 'drive-deplacer', 'F1', '{"parentId":"A","nom":"a.pdf"}', '{"parentId":"B","nom":"b.pdf"}', 'appliqué', ''],
  ]);
  const c = load(['Config.gs', 'Actions.gs']);
  c.feuille_ = () => feuille;
  c.deplacerEtRenommer_ = () => false;
  c.journalInfo_ = () => {};
  const errs = [];
  c.journalErreur_ = (s, m) => errs.push(m);

  const res = plain(c.annulerAction_('act-123456'));
  assert.strictEqual(res.ok, false);
  assert.match(res.erreur, /refusé par Drive/);
  assert.strictEqual(lignes[1][6], 'appliqué');

  assert.strictEqual(c.annulerAction_('invalide').ok, false);
  assert.strictEqual(c.annulerAction_('act-999999').ok, false);

  c.feuille_ = () => { throw new Error('Sheet HS'); };
  assert.strictEqual(c.enregistrerAction_('drive-deplacer', 'F1', {}, {}, ''), '');
  assert.strictEqual(c.enregistrerAction_('drive-deplacer', 'F1', {}, {}, ''), '');
  assert.strictEqual(errs.length, 1, 'erreur Sheet journalisée une seule fois par run sans jeter');
});

test('WebApp action=annuler-action : secret requis, validation, verrou occupé et mémo requestId', () => {
  const c = load(['Config.gs', 'Actions.gs', 'WebApp.gs']);
  const { feuille } = creerSheetActions([
    ['act-abc12345', new Date(), 'drive-deplacer', 'F1', '{"parentId":"A","nom":"a.pdf"}', '{"parentId":"B","nom":"b.pdf"}', 'appliqué', ''],
  ]);
  const cache = {};
  let lockOk = true;
  let releaseCalls = 0;
  let driveCalls = 0;
  c.feuille_ = () => feuille;
  c.deplacerEtRenommer_ = () => { driveCalls++; return true; };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.PropertiesService = {
    getScriptProperties: () => ({ getProperty: (k) => (k === 'DriveAI_WEBAPP_SECRET' ? 'web-sec' : null) }),
  };
  c.CacheService = {
    getScriptCache: () => ({
      get: (k) => (k in cache ? cache[k] : null),
      put: (k, v) => { cache[k] = v; },
    }),
  };
  c.LockService = {
    getScriptLock: () => ({
      tryLock: () => lockOk,
      releaseLock: () => { releaseCalls++; },
    }),
  };
  c.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (t) => ({
      mime: '',
      setMimeType(m) { this.mime = m; return this; },
      contenu: t,
    }),
  };

  const post = (secret, body) => JSON.parse(c.doPost({
    parameter: { action: 'annuler-action', secret },
    postData: { contents: JSON.stringify(body) },
  }).contenu);

  assert.deepStrictEqual(post('mauvais', { actionId: 'act-abc12345' }), { ok: false, erreur: 'refusé' });
  assert.deepStrictEqual(post('web-sec', { actionId: 'x' }), { ok: false, erreur: 'actionId invalide' });

  lockOk = false;
  assert.match(post('web-sec', { actionId: 'act-abc12345', requestId: 'req_12345678' }).erreur, /occupé/);
  assert.strictEqual(driveCalls, 0);

  lockOk = true;
  const ok1 = post('web-sec', { actionId: 'act-abc12345', requestId: 'req_12345678' });
  assert.strictEqual(ok1.ok, true);
  assert.strictEqual(driveCalls, 1);
  assert.strictEqual(releaseCalls, 1);

  const ok2 = post('web-sec', { actionId: 'act-abc12345', requestId: 'req_12345678' });
  assert.strictEqual(ok2.ok, true);
  assert.strictEqual(ok2.memo, true, 'rejeu servi par mémo sans re-déplacer');
  assert.strictEqual(driveCalls, 1);
});

test('validerNomNouveauLibelle_ : règles strictes (longueur, système, spéciaux, collisions, sous-libellé)', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const existants = ['Finance', 'Assurances/Auto'];

  assert.strictEqual(c.validerNomNouveauLibelle_('  Santé  ', existants), 'Santé');
  assert.strictEqual(c.validerNomNouveauLibelle_('Voyages / Billets', existants), 'Voyages/Billets');
  assert.strictEqual(c.validerNomNouveauLibelle_('ab', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('a'.repeat(41), existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('A/B/C', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('/Debut', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('Fin/', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('A//B', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('Nom<script>', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('INBOX', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('Spam', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('CATEGORY_PROMOTIONS', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('a verifier', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('assurances/auto', existants), '');
  assert.strictEqual(c.validerNomNouveauLibelle_('financé', existants), '');
});

test('parserAnalyseFil_ et creerLibelleAutonome_ : validation, plafonds, frein budget et journalisation Actions', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Actions.gs']);
  const LIB = ['Finance'];

  const sans = plain(c.parserAnalyseFil_('{"categorie":null,"suspect":false,"aTraiter":false}', LIB));
  assert.strictEqual('nouveauLibelle' in sans, false);

  const ignoreSiCat = plain(c.parserAnalyseFil_('{"categorie":"Finance","suspect":false,"aTraiter":false,"nouveauLibelle":"Voyages"}', LIB));
  assert.strictEqual(ignoreSiCat.nouveauLibelle, undefined);

  const ignoreSiSuspect = plain(c.parserAnalyseFil_('{"categorie":null,"suspect":true,"aTraiter":false,"nouveauLibelle":"Voyages"}', LIB));
  assert.strictEqual(ignoreSiSuspect.nouveauLibelle, undefined);

  const propose = plain(c.parserAnalyseFil_('{"categorie":null,"suspect":false,"aTraiter":false,"nouveauLibelle":"Voyages / Vols"}', LIB));
  assert.strictEqual(propose.nouveauLibelle, 'Voyages/Vols');

  const props = {};
  const creatifs = [];
  const actions = [];
  let frein = false;
  c.reinitialiserLibellesCrees_();
  c.budgetCampagnesAtteint_ = () => frein;
  c.dateGmail_ = () => '2026/11/23';
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.enregistrerAction_ = (type, cible, av, ap, det) => {
    actions.push({ type, cible, av, ap, det });
    return 'act-test01';
  };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
    }),
  };
  c.GmailApp = {
    createLabel: (nom) => {
      creatifs.push(nom);
      return { getName: () => nom, addToThread: () => {} };
    },
  };

  const candidats = ['Finance'];
  const libelles = { Finance: { getName: () => 'Finance' } };

  assert.strictEqual(c.creerLibelleAutonome_('Voyages', candidats, libelles), 'Voyages');
  assert.strictEqual(candidats.includes('Voyages'), true);
  assert.ok(libelles.Voyages);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'gmail-libelle');

  assert.strictEqual(c.creerLibelleAutonome_('Loisirs', candidats, libelles), 'Loisirs');
  assert.strictEqual(c.creerLibelleAutonome_('Sport', candidats, libelles), '', 'plafond par run (2) atteint');

  c.reinitialiserLibellesCrees_();
  frein = true;
  assert.strictEqual(c.creerLibelleAutonome_('Sport', candidats, libelles), '', 'coupé au frein budget 30 $');

  frein = false;
  props.DriveAI_TRI_LIBELLES_CREES_JOUR = String(c.CONFIG.TRI_CREER_LIBELLE_MAX_JOUR);
  assert.strictEqual(c.creerLibelleAutonome_('Sport', candidats, libelles), '', 'plafond quotidien atteint');
  assert.deepStrictEqual(creatifs, ['Voyages', 'Loisirs']);
});

test('trierFil_ : crée le libellé proposé hors zone protégée/suspect, jamais en zone protégée ni sur suspect', () => {
  function setup(opts) {
    const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Actions.gs']);
    const ajouts = [];
    const crees = [];
    const actions = [];
    const appeles = [];
    const appris = [];
    c.reinitialiserLibellesCrees_();
    c.reinitialiserBrouillonsTri_();
    c.reinitialiserEscaladeTri_();
    c.budgetCampagnesAtteint_ = () => false;
    c.estHorsFenetreIntentions_ = () => false;
    c.indexContient_ = () => false;
    c.indexAjouter_ = (k, r) => ajouts.push({ cle: k, ...plain(r) });
    c.toucheZoneProtegee_ = () => !!opts.zoneProtegee;
    c.ecarteParMotsCles_ = () => false;
    c.piecesJointes_ = () => [];
    c.estPannePlateforme_ = () => false;
    c.estPromoGmail_ = () => !!opts.promo;
    c.triApprisCache_ = () => ({});
    c.confianceCache_ = () => ({});
    c.ficheCache_ = () => ({});
    c.apprendreTri_ = (adr, lib) => appris.push({ adr, lib });
    c.journalInfo_ = () => {};
    c.journalErreur_ = () => {};
    c.enregistrerAction_ = (t, cible) => { actions.push({ t, cible }); return 'act-tri01'; };
    c.analyserFil_ = () => opts.analyse;
    c.PropertiesService = {
      getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }),
    };
    const libelles = {
      Finance: { getName: () => 'Finance', addToThread: (f) => appeles.push({ lib: 'Finance', fil: f.getId() }) },
      'À vérifier': { getName: () => 'À vérifier', addToThread: (f) => appeles.push({ lib: 'À vérifier', fil: f.getId() }) },
      '⚠️ Suspect': { getName: () => '⚠️ Suspect', addToThread: (f) => appeles.push({ lib: '⚠️ Suspect', fil: f.getId() }) },
    };
    c.GmailApp = {
      createLabel: (nom) => {
        crees.push(nom);
        return { getName: () => nom, addToThread: (f) => appeles.push({ lib: nom, fil: f.getId() }) };
      },
    };
    const fil = {
      getId: () => 'FIL_AUTONOME_1',
      isInInbox: () => !opts.horsBoite,
      isUnread: () => !!opts.nonLu,
      getLastMessageDate: () => new Date(1000),
      getLabels: () => [],
      getMessages: () => [{
        getId: () => 'MSG_1',
        getFrom: () => 'Billets <billets@exemple.test>',
        getSubject: () => 'Confirmation réservation',
        getHeader: () => (opts.promo ? 'https://exemple.test/unsub' : ''),
        getPlainBody: () => 'Confirmation de trajet.',
        isDraft: () => false,
      }],
      moveToArchive: () => {},
    };
    return { c, crees, actions, appeles, appris, fil, libelles };
  }

  const ok = setup({
    nonLu: false,
    analyse: { categorie: null, suspect: false, aTraiter: false, resume: '', nouveauLibelle: 'Voyages' },
  });
  const resOk = ok.c.trierFil_(ok.fil, ['Finance'], ok.libelles, false, false);
  assert.strictEqual(resOk, 'archive');
  assert.deepStrictEqual(ok.crees, ['Voyages']);
  assert.deepStrictEqual(ok.actions, [{ t: 'gmail-libelle', cible: 'Voyages' }]);
  assert.deepStrictEqual(ok.appeles, [{ lib: 'Voyages', fil: 'FIL_AUTONOME_1' }]);
  assert.deepStrictEqual(ok.appris, [{ adr: 'billets@exemple.test', lib: 'Voyages' }]);

  const zp = setup({
    zoneProtegee: true,
    analyse: { categorie: null, suspect: false, aTraiter: false, resume: '', nouveauLibelle: 'Voyages' },
  });
  zp.c.trierFil_(zp.fil, ['Finance'], zp.libelles, false, false);
  assert.deepStrictEqual(zp.crees, [], 'jamais en zone protégée');

  const susp = setup({
    analyse: { categorie: null, suspect: true, aTraiter: false, resume: '', nouveauLibelle: 'Voyages' },
  });
  susp.c.trierFil_(susp.fil, ['Finance'], susp.libelles, false, false);
  assert.deepStrictEqual(susp.crees, [], 'jamais sur suspect');
});
