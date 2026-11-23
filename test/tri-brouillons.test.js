'use strict';
/**
 * ADR-0081 (vague 2b) — résumés courts d'une ligne des mails à traiter + brouillons de réponse Gmail.
 * Verrouille :
 *  - le champ `resume` de `parserAnalyseFil_` (gardé si aTraiter=true, vidé sinon, normalisé et tronqué) ;
 *  - toutes les portes pures de `doitCreerBrouillon_` ;
 *  - le parseur `parserBrouillon_` ;
 *  - l'intégration dans `trierFil_` (`important|<id>` avec `chemin: resume`, vide en zone protégée,
 *    `createDraftReply` jamais envoyé ni écrit dans Index/Journal, idempotent via `isDraft` et `brouillon|<id>`) ;
 *  - le verrou de surface : aucun envoi ni réponse directe dans `TriGmail.gs`.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));
const ctxPur = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
const LIB = ['Finance', 'Administration'];

test('parserAnalyseFil_ : resume gardé si aTraiter=true, vidé sinon, espaces normalisés et tronqué à TRI_RESUME_MAX_CARS', () => {
  const longTxt = 'Action '.repeat(40);
  const ok = plain(ctxPur.parserAnalyseFil_(JSON.stringify({
    categorie: 'Administration', suspect: false, aTraiter: true,
    resume: '  Confirmer\nle   rendez-vous  \n  ' + longTxt,
  }), LIB));
  assert.strictEqual(ok.aTraiter, true);
  assert.ok(ok.resume.startsWith('Confirmer le rendez-vous '), ok.resume);
  assert.ok(!/[\r\n]/.test(ok.resume));
  assert.strictEqual(ok.resume.length, ctxPur.CONFIG.TRI_RESUME_MAX_CARS);

  const nonATraiter = plain(ctxPur.parserAnalyseFil_(JSON.stringify({
    categorie: 'Finance', suspect: false, aTraiter: false, resume: 'Ne doit pas passer',
  }), LIB));
  assert.strictEqual(nonATraiter.resume, '');

  const nul = plain(ctxPur.parserAnalyseFil_(JSON.stringify({
    categorie: 'Finance', suspect: false, aTraiter: true, resume: null,
  }), LIB));
  assert.strictEqual(nul.resume, '');
});

test('doitCreerBrouillon_ : toutes les portes (flag, important, sécurité, doublon, budget, plafond par run)', () => {
  const base = {
    important: true, suspect: false, zoneProtegee: false, promoDeterministe: false,
    estMoi: false, ecarte: false, marcEnDernier: false, ancien: false, horsBoite: false,
    dejaBrouillon: false, aDejaUnBrouillonDansFil: false, freinBudget: false, brouillonsCeRun: 0,
  };
  assert.strictEqual(ctxPur.doitCreerBrouillon_(base), true);

  for (const cle of [
    'suspect', 'zoneProtegee', 'promoDeterministe', 'estMoi', 'ecarte',
    'marcEnDernier', 'ancien', 'horsBoite', 'dejaBrouillon', 'aDejaUnBrouillonDansFil', 'freinBudget',
  ]) {
    assert.strictEqual(ctxPur.doitCreerBrouillon_({ ...base, [cle]: true }), false, cle + ' bloque le brouillon');
  }

  assert.strictEqual(ctxPur.doitCreerBrouillon_({ ...base, important: false }), false);
  assert.strictEqual(ctxPur.doitCreerBrouillon_(null), false);
  assert.strictEqual(
    ctxPur.doitCreerBrouillon_({ ...base, brouillonsCeRun: ctxPur.CONFIG.TRI_BROUILLON_MAX_PAR_RUN }),
    false,
    'plafond par run atteint'
  );

  const off = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  off.CONFIG.TRI_BROUILLON_ACTIF = false;
  assert.strictEqual(off.doitCreerBrouillon_(base), false, 'flag CONFIG désactivé');
});

test('parserBrouillon_ : JSON valide, markdown, null, troncature 1500 et repli null', () => {
  assert.strictEqual(ctxPur.parserBrouillon_('{"reponse":"Bonjour, oui merci."}'), 'Bonjour, oui merci.');
  assert.strictEqual(ctxPur.parserBrouillon_('```json\n{"reponse":"  Merci beaucoup.  "}\n```'), 'Merci beaucoup.');
  assert.strictEqual(ctxPur.parserBrouillon_('{"reponse":null}'), null);
  assert.strictEqual(ctxPur.parserBrouillon_('{"reponse":"   "}'), null);
  assert.strictEqual(ctxPur.parserBrouillon_('pas json'), null);
  assert.strictEqual(ctxPur.parserBrouillon_(''), null);

  const tropLong = 'a'.repeat(2000);
  assert.strictEqual(ctxPur.parserBrouillon_(JSON.stringify({ reponse: tropLong })).length, 1500);
});

function creerContexteTriComplet({
  analyse = { categorie: 'Administration', suspect: false, aTraiter: true, resume: 'Confirmer votre présence vendredi' },
  reponseBrouillon = '{"reponse":"Bonjour, je confirme ma présence vendredi. Cordialement, Marc"}',
  zoneProtegee = () => false,
  indexInitial = {},
} = {}) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const ajouts = [];
  const index = { ...indexInitial };
  const brouillons = [];
  const labels = [];
  const journaux = [];
  c.reinitialiserBrouillonsTri_();
  c.reinitialiserEscaladeTri_();
  c.journalErreur_ = (s, m) => journaux.push(m);
  c.journalInfo_ = () => {};
  c.budgetCampagnesAtteint_ = () => false;
  c.estHorsFenetreIntentions_ = () => false;
  c.indexContient_ = (k) => !!index[k];
  c.indexAjouter_ = (k, r) => { index[k] = true; ajouts.push({ cle: k, ...plain(r) }); };
  c.toucheZoneProtegee_ = zoneProtegee;
  c.ecarteParMotsCles_ = () => false;
  c.piecesJointes_ = () => [];
  c.estPannePlateforme_ = () => false;
  c.estPromoGmail_ = () => false;
  c.apprendreTri_ = () => {};
  c.triApprisCache_ = () => ({});
  c.confianceCache_ = () => ({});
  c.ficheCache_ = () => ({});
  c.tronquer_ = (t, n) => String(t).slice(0, n);
  c.signalerRetablissement_ = () => {};
  c.enregistrerUsage_ = () => {};
  c.cleLlm_ = () => 'k';
  c.avecReglages_ = (p) => p;
  c.texteReponse_ = (d) => d.content[0].text;
  c.analyserFil_ = () => analyse;
  c.fetchAvecRetry_ = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ content: [{ type: 'text', text: reponseBrouillon }], usage: {} }),
  });

  const labelObjs = {};
  for (const nom of ['Administration', 'Finance', 'À vérifier', '⚠️ Suspect', '⏰ À traiter']) {
    labelObjs[nom] = { getName: () => nom, addToThread: (t) => labels.push({ nom, fil: t.getId() }) };
  }
  return { c, ajouts, index, brouillons, labels, journaux, labelObjs };
}

function creerFilBrouillon(brouillons, {
  id = 'F1', msgId = 'M1', exp = 'Contact <contact@exemple.test>',
  sujet = 'Confirmation demandée', corps = 'Pouvez-vous confirmer vendredi ?',
  labels = [], hasDraftMsg = false, createDraftThrows = null,
} = {}) {
  const msgs = [{
    getId: () => msgId, getFrom: () => exp, getSubject: () => sujet,
    getHeader: () => '', getPlainBody: () => corps, isDraft: () => false,
  }];
  if (hasDraftMsg) {
    msgs.push({
      getId: () => msgId + '-draft', getFrom: () => 'proprietaire@exemple.com', getSubject: () => sujet,
      getHeader: () => '', getPlainBody: () => 'Brouillon existant', isDraft: () => true,
    });
  }
  return {
    getId: () => id, isInInbox: () => true, getLastMessageDate: () => new Date(1000),
    isUnread: () => true, getLabels: () => labels.map((n) => ({ getName: () => n })),
    getMessages: () => msgs, moveToArchive: () => {},
    createDraftReply: (txt) => {
      if (createDraftThrows) throw createDraftThrows;
      brouillons.push({ id, txt });
    },
  };
}

test('trierFil_ : important| porte chemin=resume, createDraftReply appelé une fois, brouillon|<id> indexé SANS texte du brouillon', () => {
  const w = creerContexteTriComplet();
  const fil = creerFilBrouillon(w.brouillons);
  const res = w.c.trierFil_(fil, ['Administration', 'Finance'], w.labelObjs, false, false);
  assert.strictEqual(res, 'traite');

  const imp = w.ajouts.find((a) => a.cle === 'important|M1');
  assert.ok(imp);
  assert.strictEqual(imp.chemin, 'Confirmer votre présence vendredi');
  assert.strictEqual(w.brouillons.length, 1);
  assert.match(w.brouillons[0].txt, /je confirme ma présence vendredi/);

  const br = w.ajouts.find((a) => a.cle === 'brouillon|M1');
  assert.ok(br && br.statut === 'brouillon' && br.domaine === 'Administration');
  assert.ok(!JSON.stringify(w.ajouts).includes('je confirme ma présence'), 'ADR-0007 : texte du brouillon jamais dans Index');
  assert.ok(!JSON.stringify(w.journaux).includes('je confirme ma présence'), 'ADR-0007 : texte du brouillon jamais dans Journal');

  // Second passage sur le même message (clé `brouillon|M1` déjà présente) : pas de second brouillon.
  w.ajouts.length = 0;
  w.c.trierFil_(creerFilBrouillon(w.brouillons, { id: 'F1b', msgId: 'M1' }), ['Administration', 'Finance'], w.labelObjs, false, false);
  assert.strictEqual(w.brouillons.length, 1, 'idempotent via brouillon|<id>');
});

test('trierFil_ : zone protégée → résumé vide et aucun brouillon ; fil avec isDraft() → aucun second brouillon', () => {
  const wZone = creerContexteTriComplet({
    zoneProtegee: (t) => /IRCC/.test(t),
    analyse: { categorie: 'Administration', suspect: false, aTraiter: true, resume: 'Répondre' },
  });
  const filZone = creerFilBrouillon(wZone.brouillons, { id: 'FZ', msgId: 'MZ', corps: 'Votre dossier IRCC' });
  wZone.c.trierFil_(filZone, ['Administration'], wZone.labelObjs, false, false);
  assert.strictEqual(wZone.brouillons.length, 0, 'jamais de brouillon en zone protégée');
  assert.ok(!wZone.ajouts.some((a) => a.cle.startsWith('important|') && a.chemin), 'aucun résumé écrit en zone protégée');

  const wDraft = creerContexteTriComplet();
  const filDraft = creerFilBrouillon(wDraft.brouillons, { id: 'FD', msgId: 'MD', hasDraftMsg: true });
  wDraft.c.trierFil_(filDraft, ['Administration'], wDraft.labelObjs, false, false);
  assert.strictEqual(wDraft.brouillons.length, 0, 'isDraft() déjà présent → aucun nouveau brouillon');
});

test('trierFil_ : erreur Gmail sur createDraftReply → journalisée, fil tout de même trié et compteur inchangé', () => {
  const w = creerContexteTriComplet();
  const fil = creerFilBrouillon(w.brouillons, { createDraftThrows: new Error('Service Gmail erreur') });
  const res = w.c.trierFil_(fil, ['Administration'], w.labelObjs, false, false);
  assert.strictEqual(res, 'traite');
  assert.ok(w.journaux.some((j) => /Brouillon différé/.test(j)));
  assert.ok(!w.ajouts.some((a) => a.cle.startsWith('brouillon|')), 'clé brouillon| non consommée sur échec');
});

test('verrou de surface : TriGmail.gs n\'appelle jamais sendEmail, reply, replyAll, forward ni .send(', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'TriGmail.gs'), 'utf8');
  for (const interdit of [/sendEmail/, /\.reply\s*\(/, /\.replyAll\s*\(/, /\.forward\s*\(/, /\.send\s*\(/]) {
    assert.ok(!interdit.test(code), 'motif interdit trouvé dans TriGmail.gs : ' + interdit);
  }
});
