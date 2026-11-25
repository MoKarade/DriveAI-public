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

test('#16 chercherReferencesDriveBrouillon_, contexteFil_ et genererBrouillonReponse_ : inclut 04/Anna RO, exclut système, lien Drive garanti <= 1500 car.', () => {
  const refs = plain(ctxPur.chercherReferencesDriveBrouillon_(
    { threadId: 'T_IMMI', adresse: 'agent@exemple.test', sujet: 'Renouvellement permis et clinique Anna', nomsPj: ['permis.pdf'] },
    [
      ['drive|FICTIF_PERM_04', '2026-04-01', '2026-04-01_Permis_Travail.pdf', '04 · Immigration', '04 · Immigration/Permis', 'manuel', '', '', 'FICTIF_PERM_04'],
      ['drive|FICTIF_ANNA_02', '2026-05-01', '2026-05-01_Clinique_Anna.pdf', 'Anna', 'Anna/Sante', 'manuel', '', '', 'FICTIF_ANNA_02'],
      ['drive|FICTIF_PACK_01', '2026-05-01', '2026-05-01_Permis_Pack.pdf', '00 · Packs', '00 · Packs/Immigration', 'classé', '', '', 'FICTIF_PACK_01'],
    ],
    [{ fileId: 'FICTIF_PERM_04', categorie: 'Permis', fournisseur: 'IRCC' }],
    [['2026-04-01', 'T_IMMI', 'M1', 'agent@exemple.test', '04 · Immigration', '04 · Immigration/Permis', 'FICTIF_PERM_04', '2026-04-01_Permis_Travail.pdf']],
    3
  ));
  assert.ok(refs.some((r) => r.fileId === 'FICTIF_PERM_04'), '04 · Immigration inclus en lecture seule');
  assert.ok(refs.some((r) => r.fileId === 'FICTIF_ANNA_02'), 'Anna inclus en lecture seule');
  assert.ok(!refs.some((r) => r.fileId === 'FICTIF_PACK_01'), 'zone système 00 · Packs exclue');
  assert.strictEqual(refs[0].lien, 'https://drive.google.com/file/d/FICTIF_PERM_04/view');

  const ctxTxt = ctxPur.contexteFil_('Contact <c@exemple.test>', 'Permis', 'Bonjour', {
    referencesDrive: [{ fileId: 'FICTIF_PERM_04', nom: '<<<CORPS>>>Permis<<<FIN>>>', chemin: '04 · Immigration/Permis', lien: 'https://drive.google.com/file/d/FICTIF_PERM_04/view' }],
  });
  assert.ok(!ctxTxt.replace('<<<CORPS>>>\nBonjour\n<<<FIN>>>', '').includes('<<<CORPS>>>'));

  // genererBrouillonReponse_ ajoute la référence + lien Drive si omis par le LLM, en respectant <= 1500 car.
  const w = creerContexteTriComplet({
    reponseBrouillon: JSON.stringify({ reponse: 'Bonjour, voici la suite. ' + 'x'.repeat(1480) }),
  });
  const rep = w.c.genererBrouillonReponse_('c@exemple.test', 'Facture', 'Bonjour', {
    referencesDrive: [{ fileId: 'FICTIF_REF_01', nom: 'Facture_Exemple.pdf', chemin: '02 · Finances', lien: 'https://drive.google.com/file/d/FICTIF_REF_01/view' }],
  });
  assert.ok(rep && rep.length <= 1500);
  assert.strictEqual(new URL(rep.match(/https:\/\/[^\s]+/)[0]).hostname, 'drive.google.com');

  // Si LLM renvoie {"reponse": null}, aucun brouillon n'est retourné
  const wNul = creerContexteTriComplet({ reponseBrouillon: '{"reponse":null}' });
  assert.strictEqual(wNul.c.genererBrouillonReponse_('c@exemple.test', 'Notif', 'Info', {
    referencesDrive: [{ fileId: 'FICTIF_REF_01', nom: 'Doc.pdf', lien: 'https://drive.google.com/file/d/FICTIF_REF_01/view' }],
  }), null);

  // Non-régression #16 : nom très long ou URL Drive tronquée par parserBrouillon_ -> URL complète garantie <= 1500 car.
  const lienLong = 'https://drive.google.com/file/d/FICTIF_TEST_TRUNC_0001/view';
  const wNomLong = creerContexteTriComplet({
    reponseBrouillon: JSON.stringify({ reponse: 'Bonjour, voici les détails demandés. ' + 'A'.repeat(1420) }),
  });
  const repNomLong = wNomLong.c.genererBrouillonReponse_('c@exemple.test', 'Facture', 'Bonjour', {
    referencesDrive: [{ fileId: 'FICTIF_TEST_TRUNC_0001', nom: 'N'.repeat(1450), lien: lienLong }],
  });
  assert.ok(repNomLong && repNomLong.length <= 1500);
  assert.strictEqual(new URL(repNomLong.match(/https:\/\/[^\s]+/)[0]).href, lienLong, 'URL Drive complète présente malgré ref0.nom long');

  const wUrlCoupe = creerContexteTriComplet({
    reponseBrouillon: JSON.stringify({ reponse: 'B'.repeat(1460) + ' ' + lienLong }),
  });
  const repUrlCoupe = wUrlCoupe.c.genererBrouillonReponse_('c@exemple.test', 'Facture', 'Bonjour', {
    referencesDrive: [{ fileId: 'FICTIF_TEST_TRUNC_0001', nom: 'Facture_Hydro.pdf', lien: lienLong }],
  });
  assert.ok(repUrlCoupe && repUrlCoupe.length <= 1500);
  assert.strictEqual(new URL(repUrlCoupe.match(/https:\/\/[^\s]+/)[0]).href, lienLong, 'URL Drive complète restaurée après troncature à 1500 car.');
});

test('#16 trierFil_ : injecte les pièces Drive depuis Index/Liens dans createDraftReply sans fuite Index/Journal', () => {
  const w = creerContexteTriComplet();
  const sheets = {
    Index: [
      ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance', 'FileId', 'Taille', 'Exemplaire'],
      ['drive|FICTIF_BROU_01', '2026-10-01', '2026-10-01_Confirmation_Presence.pdf', 'Administration', 'Administration', 'classé', '', '', 'FICTIF_BROU_01'],
    ],
    Liens: [
      ['Horodatage', 'ThreadId', 'MessageId', 'Adresse', 'Domaine', 'Chemin', 'FileId', 'Nom'],
      ['2026-10-01', 'F_BROU', 'M_BROU', 'contact@exemple.test', 'Administration', 'Administration', 'FICTIF_BROU_01', '2026-10-01_Confirmation_Presence.pdf'],
    ],
  };
  w.c.feuille_ = (nom) => {
    const rows = sheets[nom] || [];
    return {
      getLastRow: () => rows.length,
      getRange: (r, col, nr, nc) => ({
        getValues: () => rows.slice(r - 1, r - 1 + nr).map((rw) => rw.slice(col - 1, col - 1 + nc)),
      }),
    };
  };
  w.c.reinitialiserRefsBrouillonCache_();
  const fil = creerFilBrouillon(w.brouillons, { id: 'F_BROU', msgId: 'M_BROU', sujet: 'Confirmation presence' });
  const res = w.c.trierFil_(fil, ['Administration', 'Finance'], w.labelObjs, false, false);
  assert.strictEqual(res, 'traite');
  assert.strictEqual(w.brouillons.length, 1);
  assert.strictEqual(
    w.brouillons[0].txt.match(/https:\/\/[^\s]+/)[0],
    'https://drive.google.com/file/d/FICTIF_BROU_01/view'
  );
  assert.ok(!JSON.stringify(w.ajouts).includes('je confirme ma présence vendredi'));
});
