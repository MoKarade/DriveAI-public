'use strict';
/**
 * Chantier #16 (ADR-0012) — tri Gmail natif : la décision PURE porte toutes les règles de Marc ;
 * l'orchestration est vérifiée sur : idempotence par ÉTAT (fil|ts|lu — un mail lu APRÈS son tri
 * est re-trié donc archivé), attente sur panne TRANSITOIRE du modèle, écritures bornées (libellés existants seuls,
 * jamais de création), archivage réversible, rattrapage du stock par ancre FIXE + offset sur
 * ensemble figé, panne d'écriture SYSTÉMIQUE (stoppe le run, aucun échec imputé aux fils).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));
const ctxPur = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
const V = '|' + ctxPur.CONFIG.TRI_REGLES_VERSION; // ADR-0050 : la version des règles clôt chaque clé `tri|…|lu`

/* ---------- decisionTri_ (pure — les règles de Marc) ---------- */

test('decisionTri_ : SUSPECT prime sur tout — libellé ⚠️ seul, jamais archivé', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Finance', important: true, suspect: true,
    zoneProtegee: false, promoDeterministe: true, entierementLu: true });
  assert.deepStrictEqual(plain(d), { libelles: ['⚠️ Suspect'], archiver: false, statut: 'suspect' });
});

test('decisionTri_ : catégorie introuvable → À vérifier (jamais « le plus probable ») ; ADR-0050 : archivé si LU, reste si non lu', () => {
  const nonLu = ctxPur.decisionTri_({ categorie: null, important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: false });
  assert.deepStrictEqual(plain(nonLu.libelles), ['À vérifier']);
  assert.strictEqual(nonLu.archiver, false, 'non lu : reste sous les yeux');
  const d = ctxPur.decisionTri_({ categorie: null, important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: true });
  assert.deepStrictEqual(plain(d), { libelles: ['À vérifier'], archiver: true, statut: 'tri-a-verifier' }, 'ADR-0050 : lu ⇒ archivé, la catégorie inconnue reste un libellé');
});

test('decisionTri_ : mail LU → libellé + archivé (règle générale de Marc)', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Finance/Impôt', important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: true });
  assert.deepStrictEqual(plain(d), { libelles: ['Finance/Impôt'], archiver: true, statut: 'trié' });
});

test('decisionTri_ : mail NON LU (non promo) → libellé, reste en boîte', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Achats', important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: false });
  assert.strictEqual(d.archiver, false);
});

test('decisionTri_ : promo DÉTERMINISTE non lue → archivée quand même (règle Cowork confirmée)', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Abonnements', important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: true, entierementLu: false });
  assert.strictEqual(d.archiver, true);
});

test('decisionTri_ : ZONE PROTÉGÉE — jamais archivée par le chemin promo, mais archivée si LUE (choix Marc)', () => {
  const nonLue = ctxPur.decisionTri_({ categorie: 'Immigration', important: false, suspect: false,
    zoneProtegee: true, promoDeterministe: true, entierementLu: false });
  assert.strictEqual(nonLue.archiver, false); // promo-path interdit en zone protégée
  const lue = ctxPur.decisionTri_({ categorie: 'Immigration', important: false, suspect: false,
    zoneProtegee: true, promoDeterministe: false, entierementLu: true });
  assert.strictEqual(lue.archiver, true);     // « archivés seulement si ouverts par moi »
});

test('decisionTri_ : IMPORTANT → ⏰ ajouté ; ADR-0050 : archivé si LU (⏰ n\'ancre plus), reste si non lu', () => {
  const lu = ctxPur.decisionTri_({ categorie: 'Administration', important: true, suspect: false,
    zoneProtegee: false, promoDeterministe: true, entierementLu: true });
  assert.deepStrictEqual(plain(lu.libelles), ['Administration', '⏰ À traiter']);
  assert.strictEqual(lu.archiver, true, 'le libellé ⏰ est la liste de tâches, plus la boîte');
  const nonLu = ctxPur.decisionTri_({ categorie: 'Administration', important: true, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: false });
  assert.deepStrictEqual(plain(nonLu.libelles), ['Administration', '⏰ À traiter']);
  assert.strictEqual(nonLu.archiver, false, 'non lu : inchangé');
});

test('decisionTri_ ADR-0050 : « À vérifier » + IMPORTANT → ⏰ ajouté (le seul marqueur qui survit à l\'archivage)', () => {
  const d = ctxPur.decisionTri_({ categorie: null, important: true, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: true });
  assert.deepStrictEqual(plain(d.libelles), ['À vérifier', '⏰ À traiter']);
  assert.strictEqual(d.archiver, true);
  assert.strictEqual(d.statut, 'tri-a-verifier');
});

test('decisionTri_ ADR-0050 : promo déterministe SANS catégorie, non lue → reste en boîte (jamais archivée sur un doute)', () => {
  const d = ctxPur.decisionTri_({ categorie: null, important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: true, entierementLu: false });
  assert.deepStrictEqual(plain(d.libelles), ['À vérifier']);
  assert.strictEqual(d.archiver, false);
});

/* ---------- heuristiques & primitives pures ---------- */

test('heuristiquePhishing_ : PJ EXÉCUTABLE seule suffit ; PJ DOUTEUSE seulement combinée (revue ronde 2)', () => {
  assert.strictEqual(ctxPur.heuristiquePhishing_('Bonjour', ['malware.exe']), true);       // exécutable seul
  assert.strictEqual(ctxPur.heuristiquePhishing_('Bonjour', ['photos.zip']), false);       // .zip anodin (photographe)
  assert.strictEqual(ctxPur.heuristiquePhishing_('URGENT : compte suspendu', ['doc.zip']), true); // douteuse + urgence
  assert.strictEqual(ctxPur.heuristiquePhishing_('Vérifiez votre compte', ['page.html']), true);  // douteuse + credentiels
  assert.strictEqual(ctxPur.heuristiquePhishing_('URGENT : vérifiez votre compte', []), true);    // urgence ET credentiels
  assert.strictEqual(ctxPur.heuristiquePhishing_('URGENT : réunion demain', []), false);   // urgence seule
  assert.strictEqual(ctxPur.heuristiquePhishing_('Changement de mot de passe effectué', []), false); // credentiels seuls
  assert.strictEqual(ctxPur.heuristiquePhishing_('Relevé mensuel', ['releve.pdf']), false);
});

test('adresseExpediteur_ : adresse nue, minuscule — JAMAIS le nom affiché (usurpable)', () => {
  assert.strictEqual(ctxPur.adresseExpediteur_('PayPal Sécurité <ARNAQUE@evil.ru>'), 'arnaque@evil.ru');
  assert.strictEqual(ctxPur.adresseExpediteur_('info@exemple.test'), 'info@exemple.test');
});

test('parserMiniCategorie_ : catégorie acceptée SEULEMENT si dans la liste (exacte)', () => {
  const valides = ['Finance', 'Finance/Impôt'];
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Finance/Impôt","suspect":false}', valides)),
    { categorie: 'Finance/Impôt', suspect: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Impôts","suspect":false}', valides)),
    { categorie: null, suspect: false }); // inventée → doute
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('illisible', valides)),
    { categorie: null, suspect: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Finance","suspect":true}', valides)),
    { categorie: 'Finance', suspect: true });
});

test('parserMiniCategorie_ : variante accents/casse → rend le nom EXACT du libellé de Marc', () => {
  const valides = ['Finance/Impôt', 'Administration/Amende'];
  assert.strictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"finance/impot","suspect":false}', valides)).categorie,
    'Finance/Impôt');
  assert.strictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"ADMINISTRATION/AMENDE","suspect":false}', valides)).categorie,
    'Administration/Amende');
  assert.strictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Impôts et taxes","suspect":false}', valides)).categorie,
    null); // vraie invention → doute, comme avant
});

/* ---------- orchestration (mocks) ---------- */

function ctxTri(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const calls = { index: { ...(opts.index || {}) }, ajouts: [], labels: [], archives: [], journaux: [], getMessages: 0,
    // rattrapage ET nettoyage profond (C28-22) OFF par défaut : les tests des scans AVANT/cyclique/
    // demande ne doivent pas les déclencher (comme DriveAI_TRI_RATTRAPAGE, on pose leur « terminé »).
    props: { DriveAI_TRI_RATTRAPAGE: 'terminé', DriveAI_TRI_BOITE: 'terminé', DriveAI_TRI_HISTO: 'terminé',
      DriveAI_TRI_BOITE_VERSION: String(c.CONFIG.TRI_REGLES_VERSION), DriveAI_TRI_HISTO_VERSION: String(c.CONFIG.TRI_REGLES_VERSION),
      ...(opts.props || {}) } };
  c.journalErreur_ = (s, m) => calls.journaux.push(m);
  c.journalInfo_ = () => {};
  c.budgetCampagnesAtteint_ = opts.budgetCampagnesAtteint_ || (() => false); // frein §2.6 (Cout.gs non chargé)
  c.indexContient_ = (cle) => !!calls.index[cle];
  c.indexAjouter_ = (cle, r) => { calls.index[cle] = true; calls.ajouts.push({ cle, statut: r.statut }); };
  c.toucheZoneProtegee_ = opts.zoneProtegee || (() => false);
  c.piecesJointes_ = opts.piecesJointes_ || (() => []);
  c.estPannePlateforme_ = () => false;
  c.estPromoGmail_ = opts.estPromoGmail_ || (() => true); // par défaut : la catégorie Gmail confirme le header
  c.miniCategorie_ = opts.miniCategorie_ || (() => ({ categorie: 'Finance', suspect: false }));
  // ADR-0075 6b : le tri analyse sujet + corps en UN appel (`analyserFil_`). Les scénarios de ce fichier
  // portent sur l'orchestration, pas sur le verdict « à traiter » (tri-sujet-corps.test.js) : le doublon
  // de `miniCategorie_` sert de modèle, sans verdict.
  c.analyserFil_ = (exp, sujet, corps, libs) => { const r = c.miniCategorie_(exp, sujet, libs); return r === null ? null : { categorie: r.categorie, suspect: r.suspect, aTraiter: false }; };
  c.ecarteParMotsCles_ = () => false; // Prefiltre.gs non chargé ici
  c.incrementerEchec_ = (cle) => { calls.echecs = calls.echecs || {}; calls.echecs[cle] = (calls.echecs[cle] || 0) + 1; return calls.echecs[cle]; };
  c.tronquer_ = (t) => t;
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => calls.props[k] ?? null,
    setProperty: (k, v) => { calls.props[k] = v; },
    deleteProperty: (k) => { delete calls.props[k]; },
  }) };
  c.feuille_ = () => ({ getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} });
  const labelObjs = {};
  for (const n of ['Finance', 'Abonnements', 'À vérifier', '⚠️ Suspect', '⏰ À traiter']) {
    labelObjs[n] = { getName: () => n, addToThread: opts.addToThread || ((t) => calls.labels.push({ label: n, fil: t.__id })) };
  }
  c.GmailApp = {
    getUserLabels: () => Object.values(labelObjs),
    search: (q, debut) => (debut === 0 ? opts.fils || [] : []),
  };
  return { c, calls };
}

function filMock(calls, { id, ts, dernierMsgId, expediteur, sujet, nonLu, unsubscribe, horsBoite }) {
  return {
    __id: id,
    getId: () => id,
    isInInbox: () => !horsBoite,
    getLastMessageDate: () => new Date(ts),
    isUnread: () => !!nonLu,
    getLabels: () => [],
    getMessages: () => {
      calls.getMessages++;
      return [{
        getId: () => dernierMsgId,
        getFrom: () => expediteur,
        getSubject: () => sujet,
        getHeader: (h) => (h === 'List-Unsubscribe' && unsubscribe ? '<mailto:u@x>' : ''),
        getPlainBody: () => 'corps anodin',
      }];
    },
    moveToArchive: () => calls.archives.push(id),
  };
}

test('tri : fil déjà trié dans CET état (fil|ts|lu) → sauté SANS charger les messages', () => {
  const { c, calls } = (() => {
    const r = ctxTri({ index: { ['tri|F1|1000|lu' + V]: true }, fils: [] });
    r.c.GmailApp.search = (q, d) => (d === 0 ? [filMock(r.calls, { id: 'F1', ts: 1000, dernierMsgId: 'M1', expediteur: 'a@b.c', sujet: 'x' })] : []);
    return r;
  })();
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.getMessages, 0); // aucun chargement
  assert.deepStrictEqual(calls.labels, []);
});

test('tri : mail LU APRÈS son tri initial → RE-trié (clé |nonlu ≠ |lu) et cette fois ARCHIVÉ', () => {
  const { c, calls } = ctxTri({ index: { ['tri|G1|500|nonlu' + V]: true, 'intention|MG1': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'G1', ts: 500, dernierMsgId: 'MG1', expediteur: 'a@b.c', sujet: 'x' })] : []); // isUnread=false : Marc l'a ouvert
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.archives), ['G1']); // le cœur du rôle Cowork : lu ⇒ boîte propre
  assert.deepStrictEqual(plain(calls.ajouts), [{ cle: 'tri|G1|500|lu' + V, statut: 'trié' }]);
});

test('tri : fil HORS fenêtre intentions (clé impossible à jamais) → trié SANS attendre — jamais un « attend » permanent (revue C28-24)', () => {
  const { c, calls } = ctxTri({});
  // Âge dérivé de la CONSTANTE (jamais « 30 » en dur) : un jour AU-DELÀ de la fenêtre intentions.
  const jours = Number(/newer_than:(\d+)d/.exec(c.CONFIG.GMAIL_REQUETE_ACTIONS)[1]);
  const ts = Date.now() - (jours + 1) * 24 * 3600 * 1000;
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'FV', ts, dernierMsgId: 'MV', expediteur: 'Zephyr <f@zephyr.example>', sujet: 'Facture' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels.map((l) => l.label), ['Finance'], 'libellé posé sans clé intention|');
  assert.deepStrictEqual(calls.archives, ['FV'], 'fil LU ancien → archivé (l\'objectif C28-24 sur le stock)');
  assert.ok(calls.ajouts.some((a) => a.cle === `tri|FV|${ts}|lu${V}` && a.statut === 'trié'));
});

test('estHorsFenetreIntentions_ : bornes dérivées de la CONSTANTE ; requête sans fenêtre → statu quo (attendre)', () => {
  const jours = Number(/newer_than:(\d+)d/.exec(ctxPur.CONFIG.GMAIL_REQUETE_ACTIONS)[1]);
  const maintenant = 1_800_000_000_000;
  const unJour = 24 * 3600 * 1000;
  assert.strictEqual(ctxPur.estHorsFenetreIntentions_(maintenant - (jours - 1) * unJour, maintenant), false, 'dans la fenêtre');
  assert.strictEqual(ctxPur.estHorsFenetreIntentions_(maintenant - (jours + 1) * unJour, maintenant), true, 'au-delà');
  const sansFenetre = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  sansFenetre.CONFIG.GMAIL_REQUETE_ACTIONS = 'label:tout'; // fenêtre illisible
  assert.strictEqual(sansFenetre.estHorsFenetreIntentions_(0, maintenant), false, 'illisible → on attend (prudent)');
});

test('tri : fil lu + catégorie sûre → libellé posé + archivé + indexé « trié »', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M3': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F3', ts: 3000, dernierMsgId: 'M3', expediteur: 'banque@bellerives.com', sujet: 'Relevé' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels), [{ label: 'Finance', fil: 'F3' }]);
  assert.deepStrictEqual(plain(calls.archives), ['F3']);
  assert.deepStrictEqual(plain(calls.ajouts), [{ cle: 'tri|F3|3000|lu' + V, statut: 'trié' }]);
});

test('tri : mail IMPORTANT (ligne important| d\'hier à l\'Index) → ⏰ ajouté, jamais ré-écrit ; ADR-0050 : archivé car LU', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M4': true, 'important|M4': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F4', ts: 4000, dernierMsgId: 'M4', expediteur: 'x@y.z', sujet: 'Réponds-moi' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['Finance', '⏰ À traiter']);
  assert.deepStrictEqual(calls.archives, ['F4'], 'ADR-0050 : ⏰ est un libellé, plus une ancre');
});

test('tri : promo déterministe (header + catégorie Gmail) NON LUE → archivée ; en zone protégée → JAMAIS', () => {
  const cas1 = ctxTri({ index: { 'intention|M5': true } });
  cas1.c.GmailApp.search = (q, d) => (d === 0 ? [filMock(cas1.calls, { id: 'F5', ts: 5000, dernierMsgId: 'M5', expediteur: 'promo@shop.com', sujet: 'Soldes', nonLu: true, unsubscribe: true })] : []);
  cas1.c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(cas1.calls.archives), ['F5']);

  const cas2 = ctxTri({ index: { 'intention|M6': true }, zoneProtegee: () => true });
  cas2.c.GmailApp.search = (q, d) => (d === 0 ? [filMock(cas2.calls, { id: 'F6', ts: 6000, dernierMsgId: 'M6', expediteur: 'ircc@canada.ca', sujet: 'Votre dossier', nonLu: true, unsubscribe: true })] : []);
  cas2.c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(cas2.calls.archives, []);
});

test('tri : header List-Unsubscribe SEUL (forgeable) sans catégorie Gmail → PAS une promo, reste en boîte', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M5b': true }, estPromoGmail_: () => false });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F5b', ts: 5500, dernierMsgId: 'M5b', expediteur: 'phish@evil.ru', sujet: 'Notre lettre', nonLu: true, unsubscribe: true })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, []); // un phishing « déguisé en newsletter » n'est jamais masqué
});

test('tri : catégorie LLM inconnue → À vérifier, pas d\'apprentissage ; ADR-0050 : archivé car LU', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M7': true }, miniCategorie_: () => ({ categorie: null, suspect: false }) });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F7', ts: 7000, dernierMsgId: 'M7', expediteur: 'inconnu@x.y', sujet: 'Divers' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['À vérifier']);
  assert.deepStrictEqual(calls.archives, ['F7'], 'ADR-0050 : « À vérifier » est un libellé, plus une ancre');
  assert.deepStrictEqual(plain(calls.ajouts), [{ cle: 'tri|F7|7000|lu' + V, statut: 'tri-a-verifier' }]);
});

test('tri : table apprise → catégorie SANS appel LLM', () => {
  let llm = 0;
  const { c, calls } = ctxTri({ index: { 'intention|M8': true }, miniCategorie_: () => { llm++; return { categorie: 'Finance', suspect: false }; } });
  c.feuille_ = (nom) => (nom === 'TriAppris'
    ? { getLastRow: () => 2, getRange: () => ({ getValues: () => [['promo@shop.com', 'Abonnements']] }), appendRow: () => {} }
    : { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} }); // Confiance VIDE (appris ≠ confiance, C28-19)
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F8', ts: 8000, dernierMsgId: 'M8', expediteur: 'Shop <PROMO@shop.com>', sujet: 'Infos' })] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(llm, 0);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['Abonnements']);
});

test('tri : PJ exécutable → ⚠️ Suspect par l\'heuristique SEULE, sans dépenser un appel LLM', () => {
  let llm = 0;
  const { c, calls } = ctxTri({ index: { 'intention|M9': true },
    miniCategorie_: () => { llm++; return { categorie: 'Finance', suspect: false }; },
    piecesJointes_: () => [{ getName: () => 'facture.exe' }] });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F9x', ts: 9000, dernierMsgId: 'M9', expediteur: 'x@y.z', sujet: 'Facture' })] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(llm, 0);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['⚠️ Suspect']);
  assert.deepStrictEqual(calls.archives, []);
});

test('tri : plafond TRI_MAX_FILS_PAR_RUN respecté (écritures bornées par run)', () => {
  const { c, calls } = ctxTri({});
  c.CONFIG.TRI_MAX_FILS_PAR_RUN = 2;
  const fils = [];
  for (let i = 0; i < 5; i++) {
    calls.index['intention|MM' + i] = true;
    fils.push(filMock(calls, { id: 'FF' + i, ts: 100 + i, dernierMsgId: 'MM' + i, expediteur: 'a@b.c', sujet: 's' }));
  }
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.ajouts.length, 2);
});

test('tri : plafond TRI_MAX_ATTENTES — une page de fils « en attente » ne re-facture pas sans borne', () => {
  const { c, calls } = ctxTri({ miniCategorie_: () => null }); // panne TRANSITOIRE du modèle → tous « attend »
  c.CONFIG.TRI_MAX_ATTENTES = 2;
  const fils = [];
  for (let i = 0; i < 5; i++) {
    fils.push(filMock(calls, { id: 'AT' + i, ts: Date.now() - 1000 - i, dernierMsgId: 'MA' + i, expediteur: 'a@b.c', sujet: 's' }));
  }
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.getMessages, 2); // le 3ᵉ fil n'est même pas chargé
});

/* ---------- scan ARRIÈRE (rattrapage du stock — ancre FIXE + offset sur ensemble figé) ---------- */

test('rattrapage : ancre/borne posées UNE fois, lot complet → OFFSET avance, page vide → « terminé »', () => {
  const { c, calls } = ctxTri({ index: { 'intention|MA1': true, 'intention|MA2': true }, props: {} });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
  c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN = 0; // épinglé : le cyclique (C28-19) a ses propres tests
  const anciens = [
    filMock(calls, { id: 'A1', ts: 1111, dernierMsgId: 'MA1', expediteur: 'a@b.c', sujet: 's1' }),
    filMock(calls, { id: 'A2', ts: 2222, dernierMsgId: 'MA2', expediteur: 'a@b.c', sujet: 's2' }),
  ];
  let requeteArriere = null;
  let appels = 0;
  // appel 0 = scan AVANT (vide : rien de neuf) ; appel 1 = scan ARRIÈRE (le stock) ; ensuite vide.
  c.GmailApp.search = (q) => {
    const n = appels++;
    if (n === 1) { requeteArriere = q; return anciens; }
    return [];
  };
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.ajouts.length, 2);
  assert.match(calls.props.DriveAI_TRI_ANCRE, /^\d{4}\/\d{2}\/\d{2}$/);   // ancre FIXE posée une fois
  assert.match(calls.props.DriveAI_TRI_BORNE, /^\d{4}\/\d{2}\/\d{2}$/);   // borne basse (ancre − 31 j)
  assert.strictEqual(requeteArriere, 'after:' + calls.props.DriveAI_TRI_BORNE + ' before:' + calls.props.DriveAI_TRI_ANCRE); // ensemble FIGÉ (deux dates fixes)
  assert.strictEqual(calls.props.DriveAI_TRI_OFFSET, '2');                 // lot complet → l'offset avance
  assert.strictEqual(calls.props.DriveAI_TRI_RATTRAPAGE, 'terminé');       // page vide → figé, coût nul ensuite
});

test('rattrapage : un fil du lot ATTEND (panne transitoire du modèle) → OFFSET inchangé (le lot est rejoué, idempotent)', () => {
  const { c, calls } = ctxTri({ props: {}, miniCategorie_: (exp, sujet) => (sujet === 'panne' ? null : { categorie: 'Finance', suspect: false }) });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
  c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN = 0; // épinglé : le cyclique (C28-19) a ses propres tests
  const tsB1 = Date.now() - 1000;
  const anciens = [
    filMock(calls, { id: 'B1', ts: tsB1, dernierMsgId: 'MB1', expediteur: 'a@b.c', sujet: 's' }),
    filMock(calls, { id: 'B2', ts: Date.now() - 2000, dernierMsgId: 'MB2', expediteur: 'a@b.c', sujet: 'panne' }), // le modèle ne répond pas
  ];
  let appels = 0;
  c.GmailApp.search = () => (appels++ === 1 ? anciens : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.props.DriveAI_TRI_OFFSET, undefined);      // pas d'avance
  assert.strictEqual(calls.props.DriveAI_TRI_RATTRAPAGE, undefined);  // pas de faux « terminé »
  assert.strictEqual(calls.index[`tri|B1|${tsB1}|lu${V}`], true);         // l'acquis du lot est gardé (rejeu gratuit)
});

test('rattrapage : fil déjà HORS boîte → sauté sans chargement ni coût, l\'offset avance quand même', () => {
  const { c, calls } = ctxTri({ props: {} });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
  c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN = 0; // épinglé : le cyclique (C28-19) a ses propres tests
  const anciens = [
    filMock(calls, { id: 'H1', ts: 100, dernierMsgId: 'MH1', expediteur: 'a@b.c', sujet: 's', horsBoite: true }),
    filMock(calls, { id: 'H2', ts: 200, dernierMsgId: 'MH2', expediteur: 'a@b.c', sujet: 's', horsBoite: true }),
  ];
  let appels = 0;
  c.GmailApp.search = () => (appels++ === 1 ? anciens : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.getMessages, 0);                  // « boîte propre » : l'archivé d'avant ne coûte rien
  assert.strictEqual(calls.props.DriveAI_TRI_OFFSET, '2');
  assert.strictEqual(calls.props.DriveAI_TRI_RATTRAPAGE, 'terminé');
});

/* ---------- durcissements revue flotte ---------- */

test('fil portant DÉJÀ ⏰ (message antérieur important) → ⏰ honoré (jamais re-posé) ; ADR-0050 : archivé car LU', () => {
  const { c, calls } = ctxTri({ index: { 'intention|MC1': true } });
  const fil = filMock(calls, { id: 'C1', ts: 100, dernierMsgId: 'MC1', expediteur: 'a@b.c', sujet: 'Re: suivi' });
  fil.getLabels = () => [{ getName: () => '⏰ À traiter' }];
  c.GmailApp.search = (q, d) => (d === 0 ? [fil] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, ['C1'], 'ADR-0050 : le ⏰ déjà posé reste, le fil lu sort');
  assert.deepStrictEqual(calls.labels.map((l) => l.label), ['Finance'], 'le ⏰ n\'est pas ré-écrit (déjà posé)');
});

test('SUSPECT recalibré — G1 : un signal suspect du LLM sur le PROPRE mail de Marc est IGNORÉ (on ne se phishe pas)', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MSelf': true },
    miniCategorie_: () => ({ categorie: 'Finance', suspect: true }), // le LLM flague à tort « demande urgente »
  });
  // Fil dont l'unique message vient de Marc (son propre envoi) → ref = Marc, adresse = propriétaire.
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'SELF', ts: 100, dernierMsgId: 'MSelf', expediteur: 'Marc <proprietaire@exemple.com>', sujet: 'demande urgente de documents' })] : []);
  c.trierFilsGmail_(() => false);
  assert.ok(!calls.labels.some((l) => l.label === '⚠️ Suspect'), 'jamais ⚠️ Suspect sur son propre mail');
});

test('SUSPECT recalibré — G2 : expéditeur DÉJÀ APPRIS non requalifié suspect par le LLM seul (chemin normal)', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MLearn': true },
    miniCategorie_: () => ({ categorie: 'Finance', suspect: true }), // faux positif LLM (mail transactionnel légitime)
  });
  c.feuille_ = () => ({ getLastRow: () => 2, getRange: () => ({ getValues: () => [['app@bellerivesinsurance.com', 'Finance']] }), appendRow: () => {} });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'LRN', ts: 100, dernierMsgId: 'MLearn', expediteur: 'Bellerives <app@bellerivesinsurance.com>', sujet: 'Code to log on' })] : []);
  c.trierFilsGmail_(() => false);
  assert.ok(!calls.labels.some((l) => l.label === '⚠️ Suspect'), 'expéditeur de confiance : le LLM seul ne le flague plus');
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['Finance']);
});

test('SUSPECT recalibré — PJ .exe sur un expéditeur APPRIS reste ⚠️ (l\'heuristique déterministe prime sur G2)', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MExe': true },
    miniCategorie_: () => ({ categorie: 'Finance', suspect: false }),
    piecesJointes_: () => [{ getName: () => 'facture.exe' }],
  });
  c.feuille_ = (nom) => (nom === 'TriAppris'
    ? { getLastRow: () => 2, getRange: () => ({ getValues: () => [['connu@banque.com', 'Finance']] }), appendRow: () => {} }
    : { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} }); // Confiance VIDE (appris ≠ confiance, C28-19)
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'EXE', ts: 100, dernierMsgId: 'MExe', expediteur: 'connu@banque.com', sujet: 'Facture' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['⚠️ Suspect']);
});

test('promo NON LUE d\'une adresse APPRISE → le signal suspect LLM est QUAND MÊME redemandé (anti-empoisonnement)', () => {
  let llm = 0;
  const { c, calls } = ctxTri({
    index: { 'intention|MD1': true },
    miniCategorie_: () => { llm++; return { categorie: 'Abonnements', suspect: true }; }, // le LLM flaire l'arnaque
  });
  c.feuille_ = (nom) => (nom === 'TriAppris'
    ? { getLastRow: () => 2, getRange: () => ({ getValues: () => [['promo@shop.com', 'Abonnements']] }), appendRow: () => {} }
    : { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} }); // Confiance VIDE (appris ≠ confiance, C28-19)
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'D1', ts: 100, dernierMsgId: 'MD1', expediteur: 'promo@shop.com', sujet: 'Offre', nonLu: true, unsubscribe: true })] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(llm, 1);                                    // re-vérifié malgré la table
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['⚠️ Suspect']);
  assert.deepStrictEqual(calls.archives, []);                    // pas masqué de la boîte
});

test('fil malade → compté puis ABANDONNÉ après 3 essais (une seule annonce, plus jamais re-journalisé)', () => {
  const { c, calls } = ctxTri({});
  const malade = { getId: () => 'MAL', isInInbox: () => true, getLastMessageDate: () => { throw new Error('boom'); } };
  c.GmailApp.search = (q, d) => (d === 0 ? [malade] : []);
  c.trierFilsGmail_(() => false); // essai 1
  c.trierFilsGmail_(() => false); // essai 2
  c.trierFilsGmail_(() => false); // essai 3 → abandon
  assert.strictEqual(calls.index['tri-abandon|MAL|'], true); // marqueur SANS ts (le ts n'a jamais pu être lu)
  assert.strictEqual(calls.journaux.filter((j) => j.includes('ABANDONNÉ')).length, 1);
  const avant = calls.journaux.length;
  c.trierFilsGmail_(() => false); // désormais sauté en 'deja' AVANT de relire la date
  assert.strictEqual(calls.journaux.length, avant);
});

test('PANNE D\'ÉCRITURE Gmail (scope/API) → SYSTÉMIQUE : le run s\'arrête, AUCUN échec imputé aux fils', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MP1': true, 'intention|MP2': true },
    addToThread: () => { throw new Error('insufficient scope'); },
  });
  const fils = [
    filMock(calls, { id: 'P1', ts: 100, dernierMsgId: 'MP1', expediteur: 'a@b.c', sujet: 's' }),
    filMock(calls, { id: 'P2', ts: 200, dernierMsgId: 'MP2', expediteur: 'a@b.c', sujet: 's' }),
  ];
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.ajouts, []);                       // rien de « fini » — tout sera rejoué
  assert.strictEqual(calls.echecs, undefined);                    // AUCUN échec compté par fil (≠ quarantaine)
  assert.strictEqual(calls.getMessages, 1);                       // le 2ᵉ fil n'est même pas chargé (run stoppé)
  assert.strictEqual(calls.journaux.filter((j) => j.includes('PANNE D\'ÉCRITURE')).length, 1);
  c.reinitialiserPanneEcriture_();                                // le tick suivant redonne sa chance
  calls.journaux.length = 0;
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.journaux.filter((j) => j.includes('PANNE D\'ÉCRITURE')).length, 1); // re-signalée, pas silencieuse
});

/* ---------- durcissements lentilles 2-3 ---------- */

test('mini-appel TRANSITOIREMENT en échec (null) → clé NON consommée, fil re-tenté (jamais « À vérifier » pour une panne)', () => {
  const { c, calls } = ctxTri({ index: { 'intention|ME1': true }, miniCategorie_: () => null });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'E1', ts: 100, dernierMsgId: 'ME1', expediteur: 'x@y.z', sujet: 's' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels, []);
  assert.deepStrictEqual(calls.ajouts, []); // rien d'indexé → re-tenté au prochain tick
});

test('fil où MARC a répondu en dernier → catégorisé sur le message de l\'AUTRE, jamais appris sur sa propre adresse', () => {
  const appris = [];
  const { c, calls } = ctxTri({ index: { 'intention|MF2': true } });
  c.apprendreTri_ = (adresse, lib) => appris.push({ adresse, lib });
  let vuExpediteur = null;
  c.miniCategorie_ = (exp) => { vuExpediteur = exp; return { categorie: 'Finance', suspect: false }; };
  const fil = {
    __id: 'F9', getId: () => 'F9', isInInbox: () => true,
    getLastMessageDate: () => new Date(900), isUnread: () => false,
    getLabels: () => [],
    getMessages: () => [
      { getId: () => 'MF1', getFrom: () => 'Banque <conseiller@banque.com>', getSubject: () => 'Votre dossier',
        getHeader: () => '', getPlainBody: () => 'x' },
      { getId: () => 'MF2', getFrom: () => 'Marc <proprietaire@exemple.com>', getSubject: () => 'Re: Votre dossier',
        getHeader: () => '', getPlainBody: () => 'x' },
    ],
    moveToArchive: () => calls.archives.push('F9'),
  };
  c.GmailApp.search = (q, d) => (d === 0 ? [fil] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(vuExpediteur, 'Banque <conseiller@banque.com>'); // référence = l'AUTRE partie
  assert.deepStrictEqual(plain(appris), [{ adresse: 'conseiller@banque.com', lib: 'Finance' }]);
});

/* (Tri À LA DEMANDE C28-16/C28-24 : RETIRÉ — ADR-0031, bouton disparu en C28-41 PR1.) */

test('trierFil_ (catch) : quota Gmail mort EN COURS de page → panne de PLATEFORME, AUCUN échec imputé au fil, une seule annonce', () => {
  const { c, calls } = ctxTri({ fils: [] });
  const filQuota = { getId: () => 'FQ', isInInbox: () => true,
    getLastMessageDate: () => { throw new Error('Service invoked too many times for one day: gmail.'); } };
  c.GmailApp.search = (q, d) => (d === 0 ? [filQuota] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.echecs, undefined, 'aucun échec compté par fil (leçon « classer par ORIGINE »)');
  assert.ok(!calls.journaux.some((j) => j.includes('Fil non trié')), 'pas de ligne d\'échec par fil');
  assert.ok(calls.journaux.some((j) => j.includes('QUOTA GMAIL')), 'la suspension est signalée UNE fois');
  assert.strictEqual(calls.props.DriveAI_GMAIL_QUOTA !== undefined, true, 'suspension persistée');
});

/* ---------- C28-22 (ADR-0022) : nettoyage PROFOND de la boîte (> 30 j) ---------- */

// Contexte à INBOX MUTABLE : GmailApp.search sert une tranche de l'inbox ; trierFil_ RETIRE de
// l'inbox tout fil 'archive' (file mouvante réelle). C'est ce qui permet de tracer la convergence.
function ctxBoite(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  let inbox = (opts.inbox || []).slice(); // [{ id, action }]
  const props = Object.assign({ DriveAI_TRI_BOITE_VERSION: String(c.CONFIG.TRI_REGLES_VERSION) }, opts.props);
  const recherches = [];
  const effacements = []; // clés passées à deleteProperty (le ré-armement s'y prouve, pas sur l'état final)
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; effacements.push(k); },
  }) };
  c.GmailApp = { search: (req, offset, n) => {
    recherches.push({ req, offset, n });
    effacements.push('<recherche>'); // jalon : ce qui est effacé AVANT la 1re recherche vient du ré-armement
    return inbox.slice(offset, offset + n).map((x) => ({ getId: () => x.id }));
  } };
  c.trierFil_ = (fil) => {
    const id = fil.getId();
    const item = inbox.find((x) => x.id === id);
    const r = item ? item.action : 'deja';
    if (r === 'archive') inbox = inbox.filter((x) => x.id !== id); // quitte la boîte
    return r;
  };
  c.signalerPanneGmail_ = () => false;
  c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  c.dateGmail_ = () => opts.jour || '2026/07/15';
  return { c, props, recherches, effacements, inbox: () => inbox };
}

const etatBoite = () => ({ traites: 0, attentes: 0 });

test('nettoyerBoiteHistorique_ : requête FIGÉE in:inbox before:<ancre −29 j>, ancre posée UNE fois', () => {
  const { c, props, recherches } = ctxBoite({ inbox: [{ id: 'x', action: 'deja' }] });
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(recherches[0].req, 'in:inbox before:2026/07/15');
  assert.strictEqual(props.DriveAI_TRI_BOITE_ANCRE, '2026/07/15');
});

test('nettoyerBoiteHistorique_ : FILE MOUVANTE — l\'offset n\'avance que des fils RESTÉS en boîte (archivés retirés)', () => {
  // Page [A(archive), R(deja)] : A quitte la boîte, R reste → offset avance de 1, pas de 2.
  const { c, props, recherches } = ctxBoite({ inbox: [{ id: 'A', action: 'archive' }, { id: 'R', action: 'deja' }] });
  const etat = etatBoite();
  c.nettoyerBoiteHistorique_(etat, () => false, [], {});
  assert.deepStrictEqual(recherches.map((r) => r.offset), [0, 1], 'offset avancé des seuls restants (1)');
  assert.strictEqual(etat.traites, 1, 'A archivé compté');
  assert.strictEqual(props.DriveAI_TRI_BOITE_FILS_JOUR, '2', 'les 2 fils LUS comptés (coût quota réel)');
});

test('nettoyerBoiteHistorique_ : convergence — vieux lus archivés en une passe, puis DEUX passes propres → « terminé »', () => {
  const inbox = [
    { id: 'A', action: 'archive' }, { id: 'B', action: 'deja' },
    { id: 'C', action: 'archive' }, { id: 'D', action: 'deja' }, // B,D non-archivables : restent
  ];
  const ctx = ctxBoite({ inbox });
  // Passe 1 (avec activité : A,C archivés) → offset remis à 0, passes propres réinitialisées.
  ctx.c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.deepStrictEqual(ctx.inbox().map((x) => x.id), ['B', 'D'], 'A et C ont quitté la boîte');
  assert.ok(!('DriveAI_TRI_BOITE_PASSES_PROPRES' in ctx.props), 'activité → compteur de passes propres réinitialisé');
  assert.notStrictEqual(ctx.props.DriveAI_TRI_BOITE, 'terminé');
  // Passe 2 (rien à faire : B,D « deja ») → 1re passe propre.
  ctx.props.DriveAI_TRI_BOITE_JOUR = '2026/07/14'; // reliquat quotidien ré-ouvert (nouveau jour)
  ctx.c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(ctx.props.DriveAI_TRI_BOITE_PASSES_PROPRES, '1');
  // Passe 3 (toujours rien) → 2e passe propre consécutive → campagne TERMINÉE.
  ctx.props.DriveAI_TRI_BOITE_JOUR = '2026/07/13';
  ctx.c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(ctx.props.DriveAI_TRI_BOITE, 'terminé', 'les non-archivables restants ne bloquent jamais la fin');
});

test('nettoyerBoiteHistorique_ : plafond quotidien atteint → retour immédiat SANS recherche, campagne intacte', () => {
  const MAX = ctxPur.CONFIG.TRI_FOND_MAX_FILS_JOUR; // dérivé de la CONSTANTE (plafond COMMUN, ADR-0076)
  const { c, props, recherches } = ctxBoite({
    props: { DriveAI_TRI_BOITE_JOUR: '2026/07/15', DriveAI_TRI_BOITE_FILS_JOUR: String(MAX) },
    inbox: [{ id: 'x', action: 'archive' }],
  });
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(recherches.length, 0, 'plafond du jour atteint = zéro appel Gmail');
  assert.notStrictEqual(props.DriveAI_TRI_BOITE, 'terminé', 'campagne non soldée — reprise demain');
});

test('nettoyerBoiteHistorique_ : campagne « terminé » → aucune recherche (coût nul ensuite)', () => {
  const { c, recherches } = ctxBoite({ props: { DriveAI_TRI_BOITE: 'terminé' }, inbox: [{ id: 'x', action: 'archive' }] });
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(recherches.length, 0);
});

test('trierFilsGmail_ : le nettoyage profond est GATÉ sur le frein campagnes §2.6 (jamais quand le budget est atteint)', () => {
  const { c, calls } = ctxTri({ props: {}, budgetCampagnesAtteint_: () => true }); // frein actif, deep clean ré-activé (pas de 'terminé')
  delete calls.props.DriveAI_TRI_BOITE;
  let deepCleanAppele = false;
  c.nettoyerBoiteHistorique_ = () => { deepCleanAppele = true; };
  c.GmailApp.search = () => [];
  c.trierFilsGmail_(() => false);
  assert.strictEqual(deepCleanAppele, false, 'frein campagnes atteint → pas de nettoyage profond');
});

/* ---------- ADR-0050 : rétroactivité par la VERSION des règles ---------- */

test('ADR-0050 : ancienne clé SANS version à l\'Index → le fil est RE-TRIÉ sous les règles courantes (archivé) et la clé VERSIONNÉE posée', () => {
  // Le piège §9 « verdict keyé » : sans version dans la clé, les ~90 fils déjà triés n\'auraient
  // JAMAIS été réévalués et Marc n\'aurait vu aucune différence.
  const { c, calls } = ctxTri({ index: { 'tri|F1|1000|lu': true, 'tri|F1|1000|lu|deg': true, 'intention|M1': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F1', ts: 1000, dernierMsgId: 'M1', expediteur: 'a@b.c', sujet: 'x' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, ['F1'], 'réévalué : archivé sous ADR-0050');
  assert.deepStrictEqual(plain(calls.ajouts), [{ cle: 'tri|F1|1000|lu' + V, statut: 'trié' }]);
  assert.ok(calls.getMessages >= 1, 'le fil a bien été rechargé (pas un « deja »)');
});

test('ADR-0050 : la clé VERSIONNÉE présente → « deja », rien rechargé (le cliquet tient sous la version courante)', () => {
  const { c, calls } = ctxTri({ index: { ['tri|F1|1000|lu' + V]: true, 'intention|M1': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F1', ts: 1000, dernierMsgId: 'M1', expediteur: 'a@b.c', sujet: 'x' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, []);
  assert.deepStrictEqual(calls.ajouts, []);
  assert.strictEqual(calls.getMessages, 0, 'aucun chargement');
});

test('ADR-0050 : nettoyage profond RÉ-ARMÉ quand la version des règles change — tout l\'état effacé, ANCRE comprise', () => {
  const infos = [];
  const { c, props, recherches, effacements } = ctxBoite({
    props: { DriveAI_TRI_BOITE: 'terminé', DriveAI_TRI_BOITE_ANCRE: '2026/06/01', DriveAI_TRI_BOITE_OFFSET: '7',
      DriveAI_TRI_BOITE_PASSE_SALE: 'oui', DriveAI_TRI_BOITE_PASSES_PROPRES: '1', DriveAI_TRI_BOITE_VERSION: 'r1-perimee' },
    inbox: [{ id: 'A', action: 'archive' }],
  });
  c.journalInfo_ = (src, m) => infos.push(m);
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(props.DriveAI_TRI_BOITE_VERSION, String(c.CONFIG.TRI_REGLES_VERSION), 'version courante posée');
  assert.strictEqual(recherches[0].req, 'in:inbox before:2026/07/15', 'ANCRE re-posée (l\'ancienne aurait laissé un trou)');
  assert.strictEqual(recherches[0].offset, 0, 'offset reparti de zéro');
  assert.notStrictEqual(props.DriveAI_TRI_BOITE, 'terminé', 'le « terminé » d\'anciennes règles ne vaut plus');
  // Revue flotte : l'état FINAL ne prouve rien (l'activité de la passe re-pose PASSE_SALE, et la fin de
  // passe efface PASSES_PROPRES de toute façon) — on vérifie les APPELS deleteProperty faits AVANT la
  // première recherche, une clé par une : c'est le ré-armement, et lui seul, qui est prouvé.
  const avantRecherche = effacements.slice(0, effacements.indexOf('<recherche>'));
  for (const k of ['DriveAI_TRI_BOITE', 'DriveAI_TRI_BOITE_ANCRE', 'DriveAI_TRI_BOITE_OFFSET',
    'DriveAI_TRI_BOITE_PASSE_SALE', 'DriveAI_TRI_BOITE_PASSES_PROPRES']) {
    assert.ok(avantRecherche.includes(k), 'effacé par le ré-armement, avant toute recherche : ' + k +
      ' (sans PASSES_PROPRES, « terminé » tomberait après UNE passe propre au lieu de deux)');
  }
  assert.ok(infos.some((m) => /RÉ-ARMÉ/.test(m)), 'journalisé');
});

test('ADR-0050 : même version → le « terminé » est respecté, ZÉRO recherche (le ré-armement n\'est pas une boucle)', () => {
  const { c, props, recherches } = ctxBoite({
    props: { DriveAI_TRI_BOITE: 'terminé', DriveAI_TRI_BOITE_ANCRE: '2026/06/01' },
    inbox: [{ id: 'A', action: 'archive' }],
  });
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(recherches.length, 0);
  assert.strictEqual(props.DriveAI_TRI_BOITE, 'terminé');
  assert.strictEqual(props.DriveAI_TRI_BOITE_ANCRE, '2026/06/01', 'rien effacé');
});

/* ---------- Groupe A : F8 (file mouvante), F9 (garde libellé), F10 (>29j & retour boîte), F11 (quota) ---------- */

test('F8 — scanAvantTri_ : file mouvante — un archivage sur la page 0 n\'escamote pas le premier fil de la page suivante', () => {
  const { c, calls } = ctxTri({});
  const PAGE = c.CONFIG.PAGE_FILS_ACTIONS;
  const inbox = [];
  for (let i = 1; i <= PAGE + 2; i++) {
    const id = 'F' + String(i).padStart(2, '0');
    const nonLu = i >= 6 && i <= PAGE; // F01..F05 lus (archivés), F06..F20 non lus (restent), F21..F22 lus (page suivante)
    const fil = filMock(calls, {
      id, ts: 1000 + i, dernierMsgId: 'M' + i,
      expediteur: 'Banque <contact@banque.exemple>', sujet: 'Relevé ' + i, nonLu,
    });
    fil.moveToArchive = () => {
      calls.archives.push(id);
      const idx = inbox.indexOf(fil);
      if (idx !== -1) inbox.splice(idx, 1); // retrait immédiat du résultat in:inbox
    };
    inbox.push(fil);
  }
  const debuts = [];
  c.GmailApp.search = (q, debut, n) => {
    if (q !== c.CONFIG.TRI_REQUETE) return [];
    debuts.push(debut);
    return inbox.slice(debut, debut + n);
  };
  c.scanAvantTri_({ traites: 0, attentes: 0 }, () => false, ['Finance'], c.GmailApp.getUserLabels().reduce((acc, l) => { acc[l.getName()] = l; return acc; }, {}));
  assert.ok(calls.archives.includes('F01') && calls.archives.includes('F05'), 'les 5 premiers lus sont archivés');
  assert.ok(calls.archives.includes('F21') && calls.archives.includes('F22'), 'F21 et F22 glissés en indices 15..16 ne sont PAS escamotés');
  assert.strictEqual(debuts[0], 0);
  assert.strictEqual(debuts[1], 15, 'la page 1 repart exactement du nombre de fils restés en boîte (15)');
});

test('F9 — trierFil_ : libellé cible ABSENT de Gmail → erreur journalisée, AUCUN moveToArchive ni indexAjouter_', () => {
  const sousCas = [
    { nom: 'catégorie nulle (À vérifier absent)', manquant: 'À vérifier', analyse: { categorie: null, suspect: false, aTraiter: false } },
    { nom: 'multi-libellés (⏰ À traiter absent)', manquant: '⏰ À traiter', analyse: { categorie: 'Finance', suspect: false, aTraiter: true } },
    { nom: 'suspect (⚠️ Suspect absent)', manquant: '⚠️ Suspect', analyse: { categorie: 'Finance', suspect: true, aTraiter: false } },
  ];
  for (const sc of sousCas) {
    const { c, calls } = ctxTri({});
    c.analyserFil_ = () => sc.analyse;
    const libelles = {};
    for (const n of ['Finance', 'Abonnements', 'À vérifier', '⚠️ Suspect', '⏰ À traiter']) {
      if (n === sc.manquant) continue;
      libelles[n] = { getName: () => n, addToThread: (t) => calls.labels.push({ label: n, fil: t.__id }) };
    }
    const fil = filMock(calls, { id: 'FL9', ts: Date.now() - 1000, dernierMsgId: 'ML9', expediteur: 'Banque <c@banque.exemple>', sujet: 'Avis' });
    const r = c.trierFil_(fil, ['Finance', 'Abonnements'], libelles, false);
    assert.strictEqual(r, 'erreur', sc.nom + ' : doit retourner erreur');
    assert.deepStrictEqual(calls.archives, [], sc.nom + ' : aucun moveToArchive');
    assert.deepStrictEqual(calls.labels, [], sc.nom + ' : aucune écriture partielle de libellé');
    assert.deepStrictEqual(calls.ajouts, [], sc.nom + ' : aucune clé important| ou tri| écrite à l\'Index');
    assert.ok(calls.journaux.some((j) => j.includes('Libellé absent de Gmail')), sc.nom + ' : erreur journalisée');
  }
});

test('F9 — trierFil_ : libellé déjà posé sur le fil (dejaPoses) même absent de la carte → archivage maintenu', () => {
  const { c, calls } = ctxTri({});
  c.analyserFil_ = () => ({ categorie: 'Finance', suspect: false, aTraiter: true });
  const libelles = {
    Finance: { getName: () => 'Finance', addToThread: (t) => calls.labels.push({ label: 'Finance', fil: t.__id }) },
  };
  const fil = filMock(calls, { id: 'FL9b', ts: 5100, dernierMsgId: 'ML9b', expediteur: 'Banque <c@banque.exemple>', sujet: 'Avis' });
  fil.getLabels = () => [{ getName: () => '⏰ À traiter' }];
  const r = c.trierFil_(fil, ['Finance'], libelles, false);
  assert.strictEqual(r, 'archive');
  assert.deepStrictEqual(calls.archives, ['FL9b']);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['Finance']);
  assert.ok(calls.ajouts.some((a) => a.cle === 'tri|FL9b|5100|lu' + V));
});

test('F10 — trierFil_ : fil trié hors boîte (trierHistoriqueArchive_) puis revenu en boîte (isInInbox) → ré-évalué et archivé', () => {
  const { c, calls } = ctxTri({});
  const libelles = {};
  for (const n of ['Finance', 'À vérifier', '⚠️ Suspect', '⏰ À traiter']) {
    libelles[n] = { getName: () => n, addToThread: (t) => calls.labels.push({ label: n, fil: t.__id }) };
  }
  const filHors = filMock(calls, { id: 'F10', ts: 5000, dernierMsgId: 'M10', expediteur: 'Banque <c@banque.exemple>', sujet: 'Relevé', horsBoite: true });
  const r1 = c.trierFil_(filHors, ['Finance'], libelles, false, true);
  assert.strictEqual(r1, 'traite');
  assert.deepStrictEqual(calls.archives, []);
  assert.ok(calls.ajouts.some((a) => a.cle === 'tri|F10|5000|lu|horsboite' + V), 'clé hors boîte distincte sous préfixe tri|<id>|');

  // Retour en boîte sans nouveau message ni bascule non-lu : doit être ré-évalué et archivé.
  const filRetour = filMock(calls, { id: 'F10', ts: 5000, dernierMsgId: 'M10', expediteur: 'Banque <c@banque.exemple>', sujet: 'Relevé', horsBoite: false });
  const r2 = c.trierFil_(filRetour, ['Finance'], libelles, false, false);
  assert.strictEqual(r2, 'archive');
  assert.deepStrictEqual(calls.archives, ['F10']);
  assert.ok(calls.ajouts.some((a) => a.cle === 'tri|F10|5000|lu' + V));

  // Contre-épreuve : un nouvel appel en archive ou en boîte reste 'deja' sans re-coût.
  const msgsAvant = calls.getMessages;
  assert.strictEqual(c.trierFil_(filHors, ['Finance'], libelles, false, true), 'deja');
  assert.strictEqual(c.trierFil_(filRetour, ['Finance'], libelles, false, false), 'deja');
  assert.strictEqual(calls.getMessages, msgsAvant);
});

test('F10 — trierFil_ : fil déjà indexé |lu| revenu en boîte → ré-archivé sans doublon Index ; suspect et non-lu préservés', () => {
  const statutParCle = {
    ['tri|F10ret|5000|lu' + V]: 'trié',
    ['tri|F10susp|6000|lu' + V]: 'suspect',
    ['tri|F10nonlu|7000|nonlu' + V]: 'trié',
  };
  const { c, calls } = ctxTri({
    index: {
      ['tri|F10ret|5000|lu' + V]: true,
      ['tri|F10susp|6000|lu' + V]: true,
      ['tri|F10nonlu|7000|nonlu' + V]: true,
    },
  });
  c.lireLigneIndex_ = (cle) => (statutParCle[cle] ? { cle, statut: statutParCle[cle] } : null);
  const libelles = {};
  for (const n of ['Finance', 'À vérifier', '⚠️ Suspect', '⏰ À traiter']) {
    libelles[n] = { getName: () => n, addToThread: (t) => calls.labels.push({ label: n, fil: t.__id }) };
  }

  // a) Retour en boîte d'un fil |lu| déjà trié : ré-archivé, sans doublon dans Index, puis 'deja' hors boîte.
  let enBoite = true;
  const filRetour = filMock(calls, {
    id: 'F10ret', ts: 5000, dernierMsgId: 'M10ret',
    expediteur: 'Banque <conseiller@banque-exemple.test>', sujet: 'Relevé mensuel', nonLu: false,
  });
  filRetour.isInInbox = () => enBoite;
  filRetour.moveToArchive = () => { enBoite = false; calls.archives.push('F10ret'); };
  assert.strictEqual(c.trierFil_(filRetour, ['Finance'], libelles, false, false), 'archive');
  assert.deepStrictEqual(plain(calls.archives), ['F10ret']);
  assert.deepStrictEqual(calls.ajouts, [], 'aucun doublon Index quand le statut est inchangé');
  const msgsAvant = calls.getMessages;
  assert.strictEqual(c.trierFil_(filRetour, ['Finance'], libelles, false, false), 'deja');
  assert.strictEqual(calls.getMessages, msgsAvant, 'une fois archivé, aucun rechargement');

  // b) Fil |lu| au statut 'suspect' resté en boîte : conservé en boîte sans rechargement ni archivage.
  const filSuspect = filMock(calls, {
    id: 'F10susp', ts: 6000, dernierMsgId: 'M10susp',
    expediteur: 'Alerte <alerte@banque-exemple.test>', sujet: 'Avis sécurité', nonLu: false,
  });
  assert.strictEqual(c.trierFil_(filSuspect, ['Finance'], libelles, false, false), 'deja');
  assert.strictEqual(calls.getMessages, msgsAvant);
  assert.deepStrictEqual(plain(calls.archives), ['F10ret']);

  // c) Fil |nonlu| au statut 'trié' resté en boîte : conservé en boîte sans rechargement ni archivage.
  const filNonLu = filMock(calls, {
    id: 'F10nonlu', ts: 7000, dernierMsgId: 'M10nonlu',
    expediteur: 'Banque <conseiller@banque-exemple.test>', sujet: 'Nouvel avis', nonLu: true,
  });
  assert.strictEqual(c.trierFil_(filNonLu, ['Finance'], libelles, false, false), 'deja');
  assert.strictEqual(calls.getMessages, msgsAvant);
  assert.deepStrictEqual(plain(calls.archives), ['F10ret']);
});

test('F10 — balayerBoiteAnciensLus_ : fil lu > 29 j encore en boîte après fin du nettoyage profond → archivé sous plafond commun', () => {
  const { c, calls } = ctxTri({
    index: { ['tri|OLD_READ|1000|nonlu' + V]: true },
    props: {
      DriveAI_TRI_RATTRAPAGE: 'terminé',
      DriveAI_TRI_BOITE: 'terminé',
      DriveAI_TRI_BOITE_VERSION: String(load(['Config.gs']).CONFIG.TRI_REGLES_VERSION),
      DriveAI_TRI_HISTO: 'terminé',
    },
  });
  c.dateGmail_ = () => '2026/07/15';
  const oldRead = filMock(calls, { id: 'OLD_READ', ts: 1000, dernierMsgId: 'MOLD', expediteur: 'Banque <c@banque.exemple>', sujet: 'Ancien lu', nonLu: false });
  const reqs = [];
  c.GmailApp.search = (q, offset, n) => {
    reqs.push({ q, offset, n });
    if (q === c.CONFIG.TRI_ANCIENS_REQUETE && offset === 0) return [oldRead];
    return [];
  };
  c.trierFilsGmail_(() => false);
  assert.ok(reqs.some((r) => r.q === c.CONFIG.TRI_ANCIENS_REQUETE), 'requête TRI_ANCIENS_REQUETE exécutée');
  assert.ok(calls.archives.includes('OLD_READ'), 'fil lu > 29 j archivé');
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_FINI_JOUR, '2026/07/15', 'passe du jour soldée');
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_FILS_JOUR, '1', 'compté dans le plafond de fond');

  // Plafond non vivant épuisé : 0 recherche sur TRI_ANCIENS_REQUETE.
  const MAX = c.CONFIG.TRI_FOND_MAX_FILS_JOUR;
  const RES = c.CONFIG.TRI_FOND_RESERVE_VIVANT;
  const { c: c2, calls: calls2 } = ctxTri({
    props: {
      DriveAI_TRI_BOITE_JOUR: '2026/07/15',
      DriveAI_TRI_BOITE_FILS_JOUR: String(MAX - RES),
    },
  });
  c2.dateGmail_ = () => '2026/07/15';
  let ancienAppele = false;
  c2.GmailApp.search = (q) => { if (q === c2.CONFIG.TRI_ANCIENS_REQUETE) ancienAppele = true; return []; };
  c2.balayerBoiteAnciensLus_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(ancienAppele, false, 'zéro recherche quand la part non vivante est épuisée (réserve du vivant préservée)');
});

test('F11 — trierFil_ (écriture) : erreur quota Gmail sur addToThread/moveToArchive → signalerPanneGmail_ (2h), PAS PANNE D\'ÉCRITURE', () => {
  const { c, calls } = ctxTri({
    addToThread: () => { throw new Error('Exception: Service invoked too many times for one day: gmail.'); },
  });
  const fils = [
    filMock(calls, { id: 'Q1', ts: 100, dernierMsgId: 'MQ1', expediteur: 'a@exemple.com', sujet: 's1' }),
    filMock(calls, { id: 'Q2', ts: 200, dernierMsgId: 'MQ2', expediteur: 'a@exemple.com', sujet: 's2' }),
  ];
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.ok('DriveAI_GMAIL_QUOTA' in calls.props, 'suspension 2h persistée');
  assert.ok(calls.journaux.some((j) => j.includes('QUOTA GMAIL')), 'quota signalé');
  assert.ok(!calls.journaux.some((j) => j.includes('PANNE D\'ÉCRITURE')), 'pas de fausse panne de scope');
  assert.strictEqual(calls.echecs, undefined, 'aucun échec imputé au fil');
  assert.strictEqual(calls.getMessages, 1, 'arrêt immédiat dès Q1 via estPanneGmail_()');
});

test('F11 — estPromoGmail_ : erreur quota Gmail → signalerPanneGmail_ appelée (jamais avalée en silence)', () => {
  const props = {};
  const journaux = [];
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    GmailApp: {
      search: () => { throw new Error('Service invoked too many times for one day: gmail.'); },
    },
  });
  c.journalErreur_ = (s, m) => journaux.push(m);
  c.journalInfo_ = () => {};
  c.reinitialiserPromoSetCache_();
  c.chargerPanneGmail_();
  const res = c.estPromoGmail_('F_PROMO');
  assert.strictEqual(res, false, 'échec fermé : jamais promo en erreur');
  assert.strictEqual(c.estPanneGmail_(), true, 'panne Gmail activée');
  assert.ok('DriveAI_GMAIL_QUOTA' in props, 'suspension persistée');
  assert.ok(journaux.some((j) => j.includes('QUOTA GMAIL')));
});

/* ---------- Tier 5 : non-régression BUG-2 / BUG-5 et couverture TriGmail.gs ---------- */

test('BUG-2 — balayerBoiteAnciensLus_ : un "attend" transitoire empêche FINI_JOUR et fige OFFSET (simple et multi-pages)', () => {
  // Cas 1 : page unique (< taille) avec un fil en 'attend' → ni FINI_JOUR ni perte de reprise.
  const { c, calls } = ctxTri({
    props: { DriveAI_TRI_ANCIENS_OFFSET: '0' },
  });
  c.dateGmail_ = () => '2026/07/15';
  let repond = false;
  c.analyserFil_ = () => (repond ? { categorie: 'Finance', suspect: false, aTraiter: false } : null);
  const filAncien = filMock(calls, {
    id: 'ANC_ATT', ts: 1000, dernierMsgId: 'MANC',
    expediteur: 'Banque <avis@banque-exemple.test>', sujet: 'Ancien relevé', nonLu: false,
  });
  c.GmailApp.search = (q, offset) => (offset === 0 && !calls.archives.includes('ANC_ATT') ? [filAncien] : []);

  const etat1 = { traites: 0, attentes: 0 };
  c.balayerBoiteAnciensLus_(etat1, () => false, ['Finance'], {
    Finance: { getName: () => 'Finance', addToThread: () => {} },
  });
  assert.strictEqual(etat1.attentes, 1);
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_FINI_JOUR, undefined, 'FINI_JOUR ne doit PAS être posé sur attend');
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_FILS_JOUR, '1');

  // Tick suivant : le LLM répond → le fil est archivé et FINI_JOUR est posé.
  repond = true;
  const etat2 = { traites: 0, attentes: 0 };
  c.balayerBoiteAnciensLus_(etat2, () => false, ['Finance'], {
    Finance: { getName: () => 'Finance', addToThread: () => {} },
  });
  assert.ok(calls.archives.includes('ANC_ATT'), 'le fil en attente est repris et archivé au tick suivant');
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_FINI_JOUR, '2026/07/15');

  // Cas 2 : multi-pages (fils.length === taille) avec 'attend' → OFFSET ne doit pas sauter le fil en 'attend'.
  const { c: cMulti, calls: callsMulti } = ctxTri({
    props: { DriveAI_TRI_ANCIENS_OFFSET: '0' },
  });
  cMulti.CONFIG.PAGE_FILS_ACTIONS = 2;
  cMulti.dateGmail_ = () => '2026/07/15';
  cMulti.analyserFil_ = (exp) => (exp.includes('attend') ? null : { categorie: 'Finance', suspect: false, aTraiter: false });
  const fStay = filMock(callsMulti, { id: 'M_STAY', ts: 10, dernierMsgId: 'MM1', expediteur: 'x@exemple.test', sujet: 'Lu', nonLu: true });
  const fWait = filMock(callsMulti, { id: 'M_WAIT', ts: 20, dernierMsgId: 'MM2', expediteur: 'attend@exemple.test', sujet: 'Att', nonLu: false });
  cMulti.GmailApp.search = (q, offset) => (offset === 0 ? [fStay, fWait] : []);
  const etatMulti = { traites: 0, attentes: 0 };
  cMulti.balayerBoiteAnciensLus_(etatMulti, () => false, ['Finance'], {
    Finance: { getName: () => 'Finance', addToThread: () => {} },
    'À vérifier': { getName: () => 'À vérifier', addToThread: () => {} },
  });
  assert.strictEqual(etatMulti.attentes, 1);
  assert.strictEqual(callsMulti.props.DriveAI_TRI_ANCIENS_OFFSET, '0', 'multi-pages : OFFSET figé sur attend');
  assert.strictEqual(callsMulti.props.DriveAI_TRI_ANCIENS_FINI_JOUR, undefined);
});

test('balayerBoiteAnciensLus_ : pagination multi-pages (fils.length === taille) → avance OFFSET des seuls restants sans FINI_JOUR puis termine', () => {
  const { c, calls } = ctxTri({});
  c.CONFIG.PAGE_FILS_ACTIONS = 2;
  c.dateGmail_ = () => '2026/07/15';
  const fLu = filMock(calls, { id: 'P1_LU', ts: 100, dernierMsgId: 'MP1', expediteur: 'Banque <c@banque-exemple.test>', sujet: 'Relevé', nonLu: false });
  const fNonLu = filMock(calls, { id: 'P1_NL', ts: 200, dernierMsgId: 'MP2', expediteur: 'Banque <c@banque-exemple.test>', sujet: 'Avis', nonLu: true });
  const fPage2 = filMock(calls, { id: 'P2_LU', ts: 300, dernierMsgId: 'MP3', expediteur: 'Banque <c@banque-exemple.test>', sujet: 'Solde', nonLu: false });
  const offsetsVus = [];
  c.GmailApp.search = (q, offset) => {
    offsetsVus.push(offset);
    if (offset === 0) return [fLu, fNonLu];
    if (offset === 1) return [fPage2];
    return [];
  };
  const libelles = { Finance: { getName: () => 'Finance', addToThread: () => {} } };
  const etat = { traites: 0, attentes: 0 };
  c.balayerBoiteAnciensLus_(etat, () => false, ['Finance'], libelles);
  assert.deepStrictEqual(offsetsVus, [0, 1], 'P1_LU archivé → offset avance de 1 seul restant (P1_NL)');
  assert.deepStrictEqual(calls.archives, ['P1_LU', 'P2_LU']);
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_OFFSET, '0');
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_FINI_JOUR, '2026/07/15');
});

test('BUG-5 — libellesUtilisateur_ : exception sur getUserLabels() laisse le cache à null ; 2e appel publie tous les libellés', () => {
  const c = load(['Config.gs', 'TriGmail.gs']);
  let doitLever = true;
  c.GmailApp = {
    getUserLabels: () => {
      if (doitLever) throw new Error('panne transitoire Gmail');
      return [{ getName: () => 'Finance' }, { getName: () => 'À vérifier' }];
    },
  };
  c.reinitialiserLibellesCache_();
  c.reinitialiserTriApprisCache_();
  c.reinitialiserConfianceCache_();
  assert.throws(() => c.libellesUtilisateur_(), /panne transitoire/);
  doitLever = false;
  const carte = c.libellesUtilisateur_();
  assert.deepStrictEqual(Object.keys(carte).sort(), ['Finance', 'À vérifier'], 'le cache n\'est pas resté figé à {}');
});

test('estPromoGmail_ : pagination de la 2e page à partir de 100 fils', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  c.reinitialiserPromoSetCache_();
  c.signalerPanneGmail_ = () => false;
  const page1 = Array.from({ length: 100 }, (_, i) => ({ getId: () => 'PROMO_' + i }));
  const page2 = [{ getId: () => 'PROMO_PAGE2' }];
  const appels = [];
  c.GmailApp = {
    search: (req, start, count) => {
      appels.push({ req, start, count });
      return start === 0 ? page1 : page2;
    },
  };
  assert.strictEqual(c.estPromoGmail_('PROMO_PAGE2'), true);
  assert.strictEqual(c.estPromoGmail_('INCONNU'), false);
  assert.strictEqual(appels.length, 2);
  assert.strictEqual(appels[1].start, 100);
});

test('TriGmail : gestion d\'erreur quota vs non-quota sur search et libellesUtilisateur_', () => {
  // 1. trierFilsGmail_ propage une erreur non-quota de libellesUtilisateur_().
  const { c: cLib } = ctxTri({});
  cLib.GmailApp.getUserLabels = () => { throw new Error('erreur interne Gmail'); };
  assert.throws(() => cLib.trierFilsGmail_(() => false), /erreur interne Gmail/);

  // 2. scanAvantTri_, scanCycliqueTri_, balayerBoiteAnciensLus_, nettoyerBoiteHistorique_ sur erreur non-quota et quota.
  for (const fn of ['scanAvantTri_', 'scanCycliqueTri_', 'balayerBoiteAnciensLus_', 'nettoyerBoiteHistorique_']) {
    const { c: cNonQuota, calls: callsNQ } = ctxTri({
      props: { DriveAI_TRI_BOITE: '', DriveAI_TRI_BOITE_VERSION: String(load(['Config.gs']).CONFIG.TRI_REGLES_VERSION) },
    });
    cNonQuota.dateGmail_ = () => '2026/07/15';
    cNonQuota.signalerPanneGmail_ = () => false;
    cNonQuota.GmailApp.search = () => { throw new Error('timeout recherche'); };
    cNonQuota[fn]({ traites: 0, attentes: 0 }, () => false, [], {});
    assert.strictEqual(callsNQ.journaux.length, 1, fn + ' : erreur non-quota journalisée');

    const { c: cQuota, calls: callsQ } = ctxTri({
      props: { DriveAI_TRI_BOITE: '', DriveAI_TRI_BOITE_VERSION: String(load(['Config.gs']).CONFIG.TRI_REGLES_VERSION) },
    });
    cQuota.dateGmail_ = () => '2026/07/15';
    cQuota.signalerPanneGmail_ = () => true;
    cQuota.GmailApp.search = () => { throw new Error('Service invoked too many times for one day: gmail.'); };
    cQuota[fn]({ traites: 0, attentes: 0 }, () => false, [], {});
    assert.strictEqual(callsQ.journaux.length, 0, fn + ' : quota géré par signalerPanneGmail_ sans journalErreur_');
  }
});

test('trierFil_ : fil malade en lecture répétée → tri-abandon|<id>|<ts> après QUARANTAINE_MAX puis "deja"', () => {
  const { c, calls } = ctxTri({});
  const max = c.CONFIG.QUARANTAINE_MAX;
  const filMalade = {
    getId: () => 'FIL_MALADE',
    isInInbox: () => true,
    getLastMessageDate: () => new Date(123456),
    isUnread: () => false,
    getLabels: () => [],
    getMessages: () => { throw new Error('message corrompu'); },
  };
  for (let i = 1; i < max; i++) {
    assert.strictEqual(c.trierFil_(filMalade, ['Finance'], {}, false), 'erreur');
  }
  assert.ok(!calls.index['tri-abandon|FIL_MALADE|123456']);
  assert.strictEqual(c.trierFil_(filMalade, ['Finance'], {}, false), 'erreur');
  assert.strictEqual(calls.index['tri-abandon|FIL_MALADE|123456'], true, 'abandon inscrit à QUARANTAINE_MAX');
  assert.ok(calls.journaux.some((j) => j.includes('Fil ABANDONNÉ')));
  assert.strictEqual(c.trierFil_(filMalade, ['Finance'], {}, false), 'deja', 'ticks suivants sautés');

  // Fil dont getLastMessageDate() lève → tri-abandon|<id>| vérifié avant lecture de la date.
  const filDateCassee = {
    getId: () => 'FIL_SANS_DATE',
    isInInbox: () => true,
    getLastMessageDate: () => { throw new Error('date illisible'); },
  };
  for (let i = 0; i < max; i++) {
    assert.strictEqual(c.trierFil_(filDateCassee, ['Finance'], {}, false), 'erreur');
  }
  assert.strictEqual(calls.index['tri-abandon|FIL_SANS_DATE|'], true);
  assert.strictEqual(c.trierFil_(filDateCassee, ['Finance'], {}, false), 'deja');
});

/* ---------- P0-4 : compteur quotidien DriveAI_TRI_ARCHIVES_* et plafond commun ---------- */

test('P0-4 — DriveAI_TRI_ARCHIVES_FILS_JOUR : incrémenté uniquement sur moveToArchive(), cumulé le jour même, remis à 0 à minuit', () => {
  let jourCourant = '2026/07/15';
  const { c, calls } = ctxTri({
    piecesJointes_: (m) => (m && m.__pj ? m.__pj : []),
  });
  c.dateGmail_ = () => jourCourant;

  const filArchive = filMock(calls, {
    id: 'ARC_1', ts: 1000, dernierMsgId: 'M_ARC_1',
    expediteur: 'Banque <avis@banque-exemple.test>', sujet: 'Relevé mensuel', nonLu: false,
  });
  const filNonLu = filMock(calls, {
    id: 'TRAITE_1', ts: 1001, dernierMsgId: 'M_TRAITE_1',
    expediteur: 'Banque <avis@banque-exemple.test>', sujet: 'Avis à lire', nonLu: true,
  });
  const filSuspect = filMock(calls, {
    id: 'SUSPECT_1', ts: 1002, dernierMsgId: 'M_SUSPECT_1',
    expediteur: 'Inconnu <alerte@domaine-exemple.test>', sujet: 'Urgent', nonLu: false,
  });
  filSuspect.getMessages = () => {
    calls.getMessages++;
    return [{
      getId: () => 'M_SUSPECT_1',
      getFrom: () => 'Inconnu <alerte@domaine-exemple.test>',
      getSubject: () => 'Urgent',
      getPlainBody: () => '',
      getDate: () => new Date(1002),
      getHeader: () => '',
      __pj: [{ getName: () => 'facture.exe', getContentType: () => 'application/octet-stream' }],
    }];
  };

  let filsCourants = [filArchive, filNonLu, filSuspect];
  c.GmailApp.search = (q, offset) => (q === c.CONFIG.TRI_REQUETE && offset === 0 ? filsCourants : []);

  // Tick 1 : 1 seul archivé sur 3 fils ('traite' et '⚠️ Suspect' non comptés).
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.archives), ['ARC_1']);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_JOUR, '2026/07/15');
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '1');

  // Tick 2 le même jour : cumul 1 + 2 = 3.
  filsCourants = [
    filMock(calls, { id: 'ARC_2', ts: 2000, dernierMsgId: 'M_ARC_2', expediteur: 'Banque <avis@banque-exemple.test>', sujet: 'Relevé 2', nonLu: false }),
    filMock(calls, { id: 'ARC_3', ts: 2001, dernierMsgId: 'M_ARC_3', expediteur: 'Banque <avis@banque-exemple.test>', sujet: 'Relevé 3', nonLu: false }),
  ];
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_JOUR, '2026/07/15');
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '3');

  // Tick 3 après minuit : réinitialisation à 1.
  jourCourant = '2026/07/16';
  filsCourants = [
    filMock(calls, { id: 'ARC_4', ts: 3000, dernierMsgId: 'M_ARC_4', expediteur: 'Banque <avis@banque-exemple.test>', sujet: 'Relevé 4', nonLu: false }),
  ];
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_JOUR, '2026/07/16');
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '1');

  // Tick 4 sans aucun archivage (fil en erreur sur getMessages) : compteur inchangé.
  const filErr = {
    getId: () => 'ERR_1', isInInbox: () => true, getLastMessageDate: () => new Date(4000),
    isUnread: () => false, getLabels: () => [], getMessages: () => { throw new Error('panne lecture'); },
  };
  filsCourants = [filErr];
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '1');
});

test('P0-4 — scans directs + flush finally sur plafondAtteint() + exclusion de trierHistoriqueArchive_ (horsBoite=true)', () => {
  const { c, calls } = ctxTri({
    props: {
      DriveAI_TRI_RATTRAPAGE: '',
      DriveAI_TRI_BOITE: '',
      DriveAI_TRI_BOITE_VERSION: String(load(['Config.gs']).CONFIG.TRI_REGLES_VERSION),
      DriveAI_TRI_HISTO: '',
      DriveAI_TRI_HISTO_VERSION: String(load(['Config.gs']).CONFIG.TRI_REGLES_VERSION),
    },
  });
  c.dateGmail_ = () => '2026/07/15';
  const libelles = c.GmailApp.getUserLabels().reduce((acc, l) => { acc[l.getName()] = l; return acc; }, {});

  // 1. scanAvantTri_ interrompu par plafondAtteint() après 1 archivage → finally persiste 1.
  const f1 = filMock(calls, { id: 'SC_AV_1', ts: 100, dernierMsgId: 'MAV1', expediteur: 'Banque <a@banque.exemple>', sujet: 'S1', nonLu: false });
  const f2 = filMock(calls, { id: 'SC_AV_2', ts: 101, dernierMsgId: 'MAV2', expediteur: 'Banque <a@banque.exemple>', sujet: 'S2', nonLu: false });
  c.GmailApp.search = (q, off) => (off === 0 ? [f1, f2] : []);
  const etatAv = { traites: 0, attentes: 0 };
  c.scanAvantTri_(etatAv, () => etatAv.traites >= 1, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '1');

  // 2. scanCycliqueTri_ archive 1 fil → cumul à 2.
  const fCyc = filMock(calls, { id: 'SC_CYC_1', ts: 200, dernierMsgId: 'MCYC1', expediteur: 'Banque <a@banque.exemple>', sujet: 'SC', nonLu: false });
  c.GmailApp.search = (q, off) => (off === 0 ? [fCyc] : []);
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '2');

  // 3. balayerBoiteAnciensLus_ archive 1 fil → cumul à 3.
  const fAnc = filMock(calls, { id: 'SC_ANC_1', ts: 300, dernierMsgId: 'MANC1', expediteur: 'Banque <a@banque.exemple>', sujet: 'SA', nonLu: false });
  c.GmailApp.search = (q, off) => (off === 0 ? [fAnc] : []);
  c.balayerBoiteAnciensLus_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '3');

  // 4. nettoyerBoiteHistorique_ archive 1 fil → cumul à 4.
  const fBoite = filMock(calls, { id: 'SC_BOI_1', ts: 400, dernierMsgId: 'MBOI1', expediteur: 'Banque <a@banque.exemple>', sujet: 'SB', nonLu: false });
  c.GmailApp.search = (q, off) => (off === 0 ? [fBoite] : []);
  c.nettoyerBoiteHistorique_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '4');

  // 5. appliquerPasSuspect_ archive 1 fil → cumul à 5.
  const fPs = filMock(calls, { id: 'SC_PS_1', ts: 500, dernierMsgId: 'MPS1', expediteur: 'Banque <a@banque.exemple>', sujet: 'SP', nonLu: false });
  calls.props['DriveAI_PAS_SUSPECT|SC_PS_1'] = '1';
  const origGetProps = c.PropertiesService.getScriptProperties;
  c.PropertiesService = {
    getScriptProperties: () => Object.assign(origGetProps(), { getProperties: () => ({ ...calls.props }) }),
  };
  c.purgerClesTriIndex_ = () => {};
  c.GmailApp.getThreadById = (id) => (id === 'SC_PS_1' ? fPs : null);
  c.appliquerPasSuspect_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '5');

  // 6. scanArriereTri_ archive 1 fil → cumul à 6.
  const fArr = filMock(calls, { id: 'SC_ARR_1', ts: 600, dernierMsgId: 'MARR1', expediteur: 'Banque <a@banque.exemple>', sujet: 'SR', nonLu: false });
  let arrPage = 0;
  c.GmailApp.search = () => (arrPage++ === 0 ? [fArr] : []);
  c.scanArriereTri_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '6');

  // 7. trierHistoriqueArchive_ (horsBoite=true) ne déclenche jamais moveToArchive() ni DriveAI_TRI_ARCHIVES_FILS_JOUR.
  const fHisto = filMock(calls, { id: 'SC_HIS_1', ts: 700, dernierMsgId: 'MHIS1', expediteur: 'Banque <a@banque.exemple>', sujet: 'SH', nonLu: false, horsBoite: true });
  c.GmailApp.search = (q, off) => (off === 0 ? [fHisto] : []);
  c.trierHistoriqueArchive_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '6', 'horsBoite=true ne s\'archive jamais');

  // 8. Gardes enregistrerArchivesJour_ (props null, nb <= 0, et valeurs corrompues négatives/non finies).
  c.enregistrerArchivesJour_(null, 5, '2026/07/15');
  c.enregistrerArchivesJour_(c.PropertiesService.getScriptProperties(), 0, '2026/07/15');
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '6');

  calls.props.DriveAI_TRI_ARCHIVES_JOUR = '2026/07/15';
  calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR = '-5';
  c.enregistrerArchivesJour_(c.PropertiesService.getScriptProperties(), 2, '2026/07/15');
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '2');

  calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR = 'Infinity';
  c.enregistrerArchivesJour_(c.PropertiesService.getScriptProperties(), 3, '2026/07/15');
  assert.strictEqual(calls.props.DriveAI_TRI_ARCHIVES_FILS_JOUR, '3');
});

test('P0-4 — filsFondLusJour_ somme DriveAI_TRI_ANCIENS sous plafond commun <= 300/j', () => {
  const { c } = ctxTri({
    props: {
      DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/15',
      DriveAI_TRI_CYCLIQUE_FILS_JOUR: '50',
      DriveAI_TRI_BOITE_JOUR: '2026/07/15',
      DriveAI_TRI_BOITE_FILS_JOUR: '100',
      DriveAI_TRI_HISTO_JOUR: '2026/07/15',
      DriveAI_TRI_HISTO_FILS_JOUR: '80',
      DriveAI_TRI_ANCIENS_JOUR: '2026/07/15',
      DriveAI_TRI_ANCIENS_FILS_JOUR: '70',
    },
  });
  c.dateGmail_ = () => '2026/07/15';
  const props = c.PropertiesService.getScriptProperties();
  assert.strictEqual(c.filsFondLusJour_(props, '2026/07/15'), 300);
  assert.strictEqual(c.filsFondLusJour_(null, '2026/07/15'), 0, 'props null sans erreur');

  let recherche = false;
  c.GmailApp.search = () => { recherche = true; return []; };
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  c.balayerBoiteAnciensLus_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(recherche, false, 'plafond commun 300/j respecté sans aucune recherche Gmail');
});

test('GAP-6 — filsFondLusJour_, reliquatFondNonVivant_ et compteurs journaliers ignorent les valeurs négatives ou infinies', () => {
  const JOUR = '2026/07/15';
  const MAX = ctxPur.CONFIG.TRI_FOND_MAX_FILS_JOUR;
  const RES = ctxPur.CONFIG.TRI_FOND_RESERVE_VIVANT;

  // 1. Propriétés corrompues ('-50', 'Infinity', '-Infinity', 'NaN', 'abc') neutralisées à 0.
  const { c, calls } = ctxTri({
    props: {
      DriveAI_TRI_CYCLIQUE_JOUR: JOUR,
      DriveAI_TRI_CYCLIQUE_FILS_JOUR: '-50',
      DriveAI_TRI_BOITE_JOUR: JOUR,
      DriveAI_TRI_BOITE_FILS_JOUR: '100',
      DriveAI_TRI_HISTO_JOUR: JOUR,
      DriveAI_TRI_HISTO_FILS_JOUR: 'Infinity',
      DriveAI_TRI_ANCIENS_JOUR: JOUR,
      DriveAI_TRI_ANCIENS_FILS_JOUR: '-Infinity',
      DriveAI_TRI_BOITE_VERSION: String(ctxPur.CONFIG.TRI_REGLES_VERSION),
      DriveAI_TRI_HISTO_VERSION: String(ctxPur.CONFIG.TRI_REGLES_VERSION),
    },
  });
  c.dateGmail_ = () => JOUR;
  const props = c.PropertiesService.getScriptProperties();
  assert.strictEqual(c.filsFondLusJour_(props, JOUR), 100, '-50 ne soustrait pas et Infinity ne contamine pas');
  assert.strictEqual(c.filsFondLusJour_(props, JOUR, ['DriveAI_TRI_CYCLIQUE']), 0, '-50 borné à 0');
  assert.strictEqual(c.filsFondLusJour_(props, JOUR, ['DriveAI_TRI_HISTO']), 0, 'Infinity borné à 0');
  assert.strictEqual(
    c.reliquatFondNonVivant_(props, JOUR),
    Math.min(MAX - 100, MAX - RES - 100),
    'reliquatFondNonVivant_ reste fini et respecte la part non vivante sans soustraction négative'
  );

  // 2. Même avec un compteur valide à 0 et les autres corrompus, reliquatFondNonVivant_ n'est jamais -Infinity ni > MAX - RES.
  calls.props.DriveAI_TRI_CYCLIQUE_FILS_JOUR = 'Infinity';
  calls.props.DriveAI_TRI_BOITE_FILS_JOUR = '-50';
  calls.props.DriveAI_TRI_HISTO_FILS_JOUR = 'NaN';
  calls.props.DriveAI_TRI_ANCIENS_FILS_JOUR = 'abc';
  assert.strictEqual(c.filsFondLusJour_(props, JOUR), 0);
  assert.strictEqual(c.reliquatFondNonVivant_(props, JOUR), MAX - RES);

  // 3. Reprise de chaque campagne après corruption '-50' ou 'Infinity' : repart de 0 avant d'ajouter filsLus.
  const libelles = c.GmailApp.getUserLabels().reduce((acc, l) => { acc[l.getName()] = l; return acc; }, {});
  calls.props.DriveAI_TRI_BOITE = '';
  calls.props.DriveAI_TRI_HISTO = '';
  calls.props.DriveAI_TRI_CYCLIQUE_FILS_JOUR = '-50';
  const fCyc = filMock(calls, { id: 'GAP6_CYC', ts: 100, dernierMsgId: 'MGC1', expediteur: 'Banque <a@banque.exemple>', sujet: 'C', nonLu: true });
  c.GmailApp.search = (q, off) => (off === 0 ? [fCyc] : []);
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_CYCLIQUE_FILS_JOUR, '1');

  calls.props.DriveAI_TRI_ANCIENS_FILS_JOUR = 'Infinity';
  const fAnc = filMock(calls, { id: 'GAP6_ANC', ts: 200, dernierMsgId: 'MGA1', expediteur: 'Banque <a@banque.exemple>', sujet: 'A', nonLu: true });
  c.GmailApp.search = (q, off) => (off === 0 ? [fAnc] : []);
  c.balayerBoiteAnciensLus_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_ANCIENS_FILS_JOUR, '1');

  calls.props.DriveAI_TRI_BOITE_FILS_JOUR = '-50';
  const fBoi = filMock(calls, { id: 'GAP6_BOI', ts: 300, dernierMsgId: 'MGB1', expediteur: 'Banque <a@banque.exemple>', sujet: 'B', nonLu: true });
  c.GmailApp.search = (q, off) => (off === 0 ? [fBoi] : []);
  c.nettoyerBoiteHistorique_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_BOITE_FILS_JOUR, '1');

  calls.props.DriveAI_TRI_HISTO_FILS_JOUR = 'Infinity';
  const fHis = filMock(calls, { id: 'GAP6_HIS', ts: 400, dernierMsgId: 'MGH1', expediteur: 'Banque <a@banque.exemple>', sujet: 'H', nonLu: false, horsBoite: true });
  let histoPage = 0;
  c.GmailApp.search = () => (histoPage++ === 0 ? [fHis] : []);
  c.trierHistoriqueArchive_({ traites: 0, attentes: 0 }, () => false, ['Finance'], libelles);
  assert.strictEqual(calls.props.DriveAI_TRI_HISTO_FILS_JOUR, '1');
});

test('#19 trierFil_ : priorité des règles en 1 phrase actives (auto), zéro retrait de libellé et protection zone protégée', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Copilote.gs', 'QuestionsRegles.gs']);
  const ajouts = [];
  const poses = [];
  const archives = [];
  c.reinitialiserBrouillonsTri_();
  c.reinitialiserEscaladeTri_();
  c.reinitialiserReglesGmailCache_();
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  c.budgetCampagnesAtteint_ = () => false;
  c.estHorsFenetreIntentions_ = () => false;
  c.indexContient_ = () => false;
  c.indexAjouter_ = (k, r) => ajouts.push({ cle: k, ...plain(r) });
  c.toucheZoneProtegee_ = (t) => /IRCC/.test(t);
  c.ecarteParMotsCles_ = () => false;
  c.piecesJointes_ = () => [];
  c.estPannePlateforme_ = () => false;
  c.estPromoGmail_ = () => false;
  c.apprendreTri_ = () => {};
  c.triApprisCache_ = () => ({});
  c.confianceCache_ = () => ({});
  c.ficheCache_ = () => ({});
  c.lireCartesCopilote_ = () => [{
    id: 'cop-reg-1',
    type: 'regle-auto',
    domaine: '02 · Finances',
    chemin: '02 · Finances',
    statut: 'auto',
    actionJson: JSON.stringify({
      cle: 'regle|hydro',
      si: { mots: ['hydro'] },
      alors: { canal: 'gmail', action: 'libeller', libelle: 'Finance', important: true, archiver: false },
      auto: true,
    }),
  }];
  let llmAppels = 0;
  c.analyserFil_ = () => { llmAppels++; return null; };
  const labObj = (nom) => ({ getName: () => nom, addToThread: (t) => poses.push({ nom, fil: t.getId() }) });
  const libelles = { Finance: labObj('Finance'), 'À vérifier': labObj('À vérifier'), '⚠️ Suspect': labObj('⚠️ Suspect'), '⏰ À traiter': labObj('⏰ À traiter') };

  const fil = {
    getId: () => 'FIL_REG_1',
    isInInbox: () => true,
    getLastMessageDate: () => new Date(1000),
    isUnread: () => true,
    getLabels: () => [],
    getMessages: () => [{ getId: () => 'M_REG_1', getFrom: () => 'Factures <f@exemple.test>', getSubject: () => 'Facture Hydro mensuelle', getHeader: () => '', getPlainBody: () => 'Détail', isDraft: () => false }],
    moveToArchive: () => archives.push('FIL_REG_1'),
  };
  const res = c.trierFil_(fil, ['Finance'], libelles, false, false);
  assert.strictEqual(res, 'traite');
  assert.strictEqual(llmAppels, 0, 'règle auto prioritaire évite un appel LLM inutile');
  assert.deepStrictEqual(poses.map((p) => p.nom), ['Finance', '⏰ À traiter']);
  assert.strictEqual(archives.length, 0);
});
