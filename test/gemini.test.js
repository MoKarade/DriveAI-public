'use strict';
/**
 * Gemini (ADR-0073, étape 4 de l'ADR-0074) — le moteur parle « format Anthropic » partout ; `Gemini.gs`
 * traduit à la frontière réseau. Ces tests verrouillent : la traduction de la requête (texte, image,
 * PDF), celle de la réponse (jetons, arrêts), l'aiguillage par NOM de modèle, la clé (en-tête, jamais
 * l'URL), la panne de compte, et le comptage du coût. Zéro réseau : `UrlFetchApp` est factice.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');

const plat = (x) => JSON.parse(JSON.stringify(x));
const M = 1e6;
const SRC = path.join(__dirname, '..', 'src');

function ctx(extra) {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'Gemini.gs'], Object.assign({
    tronquer_: (s, n) => String(s == null ? '' : s).slice(0, n),
    journalInfo_: () => {},
    journalErreur_: () => {},
  }, extra || {}));
  c.estPannePlateforme_ = () => false;
  c.signalerRetablissement_ = () => {};
  return c;
}

function propriete(cle, valeur) {
  return { getScriptProperties: () => ({ getProperty: (k) => (k === cle ? valeur : null), setProperty: () => {} }) };
}

function reponseHttp(code, corps) {
  return { getResponseCode: () => code, getContentText: () => (typeof corps === 'string' ? corps : JSON.stringify(corps)) };
}

const CORPS_MIN = JSON.stringify({ max_tokens: 5, messages: [{ role: 'user', content: 'x' }] });

/* ---------- aiguillage par nom de modèle ---------- */

test('estModeleGemini_ : par le NOM du modèle, rien d\'autre', () => {
  const c = ctx();
  assert.strictEqual(c.estModeleGemini_('gemini-3.8-flash'), true);
  assert.strictEqual(c.estModeleGemini_('gemini-3.5-flash-lite'), true);
  assert.strictEqual(c.estModeleGemini_('claude-sonnet-5-5'), false);
  assert.strictEqual(c.estModeleGemini_(''), false);
  assert.strictEqual(c.estModeleGemini_(undefined), false);
});

test('cleLlm_ : Gemini ne demande JAMAIS la clé Anthropic (elle peut ne plus exister) ; Claude oui', () => {
  const c = ctx();
  c.getCleAnthropic_ = () => { throw new Error('clé Anthropic absente'); };
  assert.strictEqual(c.cleLlm_('gemini-3.8-flash'), '');
  assert.throws(() => c.cleLlm_('claude-haiku-5-5'), /absente/);
});

test('CONFIG : cette étape ne change AUCUN modèle appelé (la bascule est l\'étape 5) ; les deux Gemini sont nommés', () => {
  const { CONFIG } = ctx();
  assert.ok(/^claude-/.test(CONFIG.LLM_MODELE) && /^claude-/.test(CONFIG.LLM_MODELE_FALLBACK) && /^claude-/.test(CONFIG.ANALYSE_V2_MODELE));
  assert.strictEqual(CONFIG.GEMINI_MODELE_PETIT, 'gemini-3.5-flash-lite');
  assert.strictEqual(CONFIG.GEMINI_MODELE_GRAND, 'gemini-3.8-flash');
});

/* ---------- requête : Anthropic → Gemini ---------- */

test('versRequeteGemini_ : système en chaîne ou en blocs, rôles, plafond + marge, réflexion', () => {
  const c = ctx();
  const cfg = { GEMINI_MARGE_SORTIE: 2048, GEMINI_THINKING_LEVEL: 'low' };
  const r = plat(c.versRequeteGemini_({
    model: 'gemini-3.8-flash', max_tokens: 1400,
    system: [{ type: 'text', text: 'Sois bref.', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Salut' }, { role: 'user', content: 'Merci' }],
  }, cfg));
  assert.deepStrictEqual(r.systemInstruction, { parts: [{ text: 'Sois bref.' }] });
  assert.deepStrictEqual(r.contents.map((x) => x.role), ['user', 'model', 'user']);
  assert.deepStrictEqual(r.contents[0].parts, [{ text: 'Bonjour' }]);
  assert.strictEqual(r.generationConfig.maxOutputTokens, 1400 + 2048);
  assert.deepStrictEqual(r.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.ok(!JSON.stringify(r).includes('cache_control'), 'le marqueur de cache Anthropic ne part pas chez Google');
  assert.ok(!JSON.stringify(r).includes('anthropic'), 'rien du format Anthropic ne part chez Google');

  const s = plat(c.versRequeteGemini_({ max_tokens: 10, system: 'Texte simple', messages: [{ role: 'user', content: 'x' }] }, cfg));
  assert.deepStrictEqual(s.systemInstruction, { parts: [{ text: 'Texte simple' }] });
});

test('versRequeteGemini_ : une image et un PDF base64 deviennent inlineData, dans l\'ordre ; sans niveau, pas de réflexion', () => {
  const c = ctx();
  const r = plat(c.versRequeteGemini_({
    max_tokens: 500,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Papier :' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'SlBH' } },
    ] }],
  }, {}));
  assert.deepStrictEqual(r.contents[0].parts, [
    { text: 'Papier :' },
    { inlineData: { mimeType: 'application/pdf', data: 'UERG' } },
    { inlineData: { mimeType: 'image/jpeg', data: 'SlBH' } },
  ]);
  assert.ok(!('thinkingConfig' in r.generationConfig), 'sans niveau configuré, aucun réglage de réflexion');
  assert.strictEqual(r.generationConfig.maxOutputTokens, 500, 'sans marge configurée, le plafond est celui demandé');
});

test('versRequeteGemini_ : un bloc inconnu, un appel d\'outil ou une image par URL LÈVE (jamais ignoré en silence)', () => {
  const c = ctx();
  assert.throws(() => c.versRequeteGemini_({ max_tokens: 1, messages: [{ role: 'user', content: [{ type: 'video' }] }] }, {}), /non pris en charge/);
  assert.throws(() => c.versRequeteGemini_({ max_tokens: 1, messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'x', input: {} }] }] }, {}), /non pris en charge/);
  assert.throws(() => c.versRequeteGemini_({ max_tokens: 1, messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'url', url: 'https://exemple.test/a.png' } }] }] }, {}), /non base64/);
});

/* ---------- réponse : Gemini → Anthropic ---------- */

test('depuisReponseGemini_ : texte + jetons — réflexion comptée en SORTIE, cache sorti de l\'ENTRÉE', () => {
  const c = ctx();
  const r = plat(c.depuisReponseGemini_({
    candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 400, candidatesTokenCount: 50, thoughtsTokenCount: 30 },
  }));
  assert.deepStrictEqual(r.content, [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }]);
  assert.strictEqual(r.stop_reason, 'end_turn');
  assert.deepStrictEqual(r.usage, { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 400 });
  assert.strictEqual(c.texteReponse_(r), '{"a":1}', 'les consommateurs existants lisent le résultat sans changer');
});

test('depuisReponseGemini_ : arrêts — plafond, refus (sécurité ou prompt bloqué), résumé de réflexion jamais montré', () => {
  const c = ctx();
  assert.strictEqual(c.depuisReponseGemini_({ candidates: [{ content: { parts: [{ text: 'cou' }] }, finishReason: 'MAX_TOKENS' }] }).stop_reason, 'max_tokens');
  assert.strictEqual(c.depuisReponseGemini_({ candidates: [{ finishReason: 'SAFETY' }] }).stop_reason, 'refusal');
  assert.strictEqual(c.depuisReponseGemini_({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }).stop_reason, 'refusal');
  const r = plat(c.depuisReponseGemini_({ candidates: [{ content: { parts: [{ text: 'pense…', thought: true }, { text: 'réponse' }] }, finishReason: 'STOP' }] }));
  assert.strictEqual(c.texteReponse_(r), 'réponse');
  // Réponse vide : aucun plantage, aucun usage inventé.
  const v = plat(c.depuisReponseGemini_({}));
  assert.deepStrictEqual(v.content, []);
  assert.deepStrictEqual(v.usage, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
});

/* ---------- fetchGemini_ : clé, en-tête, URL, rejeu de la réflexion ---------- */

test('fetchGemini_ : clé ABSENTE → 401 synthétique = panne de compte (jamais un échec du document), AUCUN réseau', () => {
  let reseau = 0;
  const c = ctx({ PropertiesService: propriete('DriveAI_GEMINI_KEY', null), UrlFetchApp: { fetch: () => { reseau++; return reponseHttp(200, {}); } } });
  const rep = c.fetchAvecRetry_('https://api.anthropic.com/v1/messages', { payload: CORPS_MIN }, 'gemini-3.8-flash');
  assert.strictEqual(rep.getResponseCode(), 401);
  assert.strictEqual(c.detecterPannePlateforme_(rep.getResponseCode(), rep.getContentText()), true);
  assert.strictEqual(reseau, 0);
});

test('fetchAvecRetry_ : un modèle Gemini part chez Google, clé en EN-TÊTE (jamais dans l\'URL), réponse rendue au format Anthropic', () => {
  const vus = [];
  const c = ctx({
    PropertiesService: propriete('DriveAI_GEMINI_KEY', 'cle-secrete-test'),
    UrlFetchApp: { fetch: (url, o) => { vus.push({ url, o }); return reponseHttp(200, { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } }); } },
  });
  const rep = c.fetchAvecRetry_('https://api.anthropic.com/v1/messages',
    { method: 'post', headers: { 'x-api-key': '' }, payload: JSON.stringify({ model: 'gemini-3.8-flash', max_tokens: 16, system: 'S', messages: [{ role: 'user', content: 'ping' }] }) },
    'gemini-3.8-flash');
  assert.strictEqual(vus.length, 1);
  assert.strictEqual(vus[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.ok(!vus[0].url.includes('cle-secrete-test'), 'la clé ne doit JAMAIS figurer dans l\'URL');
  assert.strictEqual(vus[0].o.headers['x-goog-api-key'], 'cle-secrete-test');
  assert.ok(!('x-api-key' in vus[0].o.headers), 'aucune clé Anthropic ne part chez Google');
  assert.strictEqual(vus[0].o.muteHttpExceptions, true);
  const data = JSON.parse(rep.getContentText());
  assert.strictEqual(c.texteReponse_(data), 'OK');
  assert.strictEqual(data.usage.input_tokens, 10);
});

test('fetchAvecRetry_ : un modèle Claude part TOUJOURS chez Anthropic, inchangé (retry compris)', () => {
  const vus = [];
  let n = 0;
  const c = ctx({ Utilities: { sleep: () => {} }, UrlFetchApp: { fetch: (url, o) => { vus.push({ url, o }); n++; return reponseHttp(n === 1 ? 529 : 200, { content: [] }); } } });
  const rep = c.fetchAvecRetry_('https://api.anthropic.com/v1/messages', { method: 'post', headers: { 'x-api-key': 'k' }, payload: '{}' }, 'claude-haiku-5-5');
  assert.strictEqual(vus[0].url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(vus[0].o.headers['x-api-key'], 'k');
  assert.strictEqual(vus.length, 2, 'un 529 est rejoué une fois, comme avant');
  assert.strictEqual(rep.getResponseCode(), 200);
});

test('fetchAvecRetry_ : réseau mort sur un modèle Gemini → null et échec systémique compté, comme pour Claude', () => {
  const c = ctx({ PropertiesService: propriete('DriveAI_GEMINI_KEY', 'k'), UrlFetchApp: { fetch: () => { throw new Error('DNS'); } } });
  c.reinitialiserPannePlateforme_();
  assert.strictEqual(c.fetchAvecRetry_('u', { payload: CORPS_MIN }, 'gemini-3.5-flash-lite'), null);
});

test('fetchLlmDirect_ : sans retry, LÈVE sur exception réseau (le pré-filtre gère lui-même l\'échec) ; Gemini traduit', () => {
  const c = ctx({
    PropertiesService: propriete('DriveAI_GEMINI_KEY', 'k'),
    UrlFetchApp: { fetch: () => { throw new Error('DNS'); } },
  });
  assert.throws(() => c.fetchLlmDirect_('https://api.anthropic.com/v1/messages', { payload: '{}' }, 'claude-haiku-5-5'), /DNS/);
  assert.throws(() => c.fetchLlmDirect_('u', { payload: CORPS_MIN }, 'gemini-3.5-flash-lite'), /DNS/);
});

test('fetchGemini_ : si l\'API refuse le réglage de réflexion (400), UN rejeu sans lui — pas un échec de tous les documents', () => {
  const corps = [];
  const c = ctx({
    PropertiesService: propriete('DriveAI_GEMINI_KEY', 'k'),
    UrlFetchApp: { fetch: (url, o) => {
      const req = JSON.parse(o.payload); corps.push(req);
      return req.generationConfig.thinkingConfig
        ? reponseHttp(400, { error: { message: 'Unknown name "thinkingLevel": Cannot find field.' } })
        : reponseHttp(200, { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] });
    } },
  });
  const rep = c.fetchAvecRetry_('u', { payload: CORPS_MIN }, 'gemini-3.8-flash');
  assert.strictEqual(rep.getResponseCode(), 200);
  assert.strictEqual(corps.length, 2);
  assert.ok(corps[0].generationConfig.thinkingConfig && !corps[1].generationConfig.thinkingConfig);
});

test('fetchGemini_ : une autre erreur 400 passe telle quelle (corps lisible pour le journal) ; pas de rejeu', () => {
  let n = 0;
  const c = ctx({
    PropertiesService: propriete('DriveAI_GEMINI_KEY', 'k'),
    UrlFetchApp: { fetch: () => { n++; return reponseHttp(400, { error: { message: 'Request payload size exceeds the limit' } }); } },
  });
  const rep = c.fetchAvecRetry_('u', { payload: CORPS_MIN }, 'gemini-3.8-flash');
  assert.strictEqual(rep.getResponseCode(), 400);
  assert.match(rep.getContentText(), /payload size/);
  assert.strictEqual(n, 1);
});

test('fetchGemini_ : un 200 illisible passe tel quel (l\'appelant journalise « non-JSON »), un bloc intraduisible rend null sans réseau', () => {
  let reseau = 0;
  const c = ctx({ PropertiesService: propriete('DriveAI_GEMINI_KEY', 'k'), UrlFetchApp: { fetch: () => { reseau++; return reponseHttp(200, '<html>'); } } });
  const rep = c.fetchAvecRetry_('u', { payload: CORPS_MIN }, 'gemini-3.8-flash');
  assert.strictEqual(rep.getContentText(), '<html>');
  assert.strictEqual(c.fetchAvecRetry_('u', { payload: JSON.stringify({ max_tokens: 1, messages: [{ role: 'user', content: [{ type: 'video' }] }] }) }, 'gemini-3.8-flash'), null);
  assert.strictEqual(reseau, 1);
});

/* ---------- panne de compte ---------- */

test('detecterPannePlateforme_ : crédit prépayé épuisé (402), clé invalide, droit refusé → panne ; erreurs normales → non', () => {
  const c = ctx();
  assert.strictEqual(c.detecterPannePlateforme_(402, 'Payment Required'), true);
  assert.strictEqual(c.detecterPannePlateforme_(400, '{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid. Please pass a valid API key.","details":[{"reason":"API_KEY_INVALID"}]}}'), true);
  assert.strictEqual(c.detecterPannePlateforme_(403, '{"error":{"status":"PERMISSION_DENIED"}}'), true);
  assert.strictEqual(c.detecterPannePlateforme_(403, 'forbidden'), false);
  assert.strictEqual(c.detecterPannePlateforme_(400, '{"error":{"message":"Request payload size exceeds the limit"}}'), false);
  assert.strictEqual(c.detecterPannePlateforme_(429, 'RESOURCE_EXHAUSTED'), false, '429 reste une série systémique, pas une panne immédiate');
});

test('signalerPannePlateforme_ : le message dit où recharger — Gemini pour un modèle Gemini, Anthropic sinon', () => {
  const messages = [];
  const c = ctx({ PropertiesService: propriete('x', null) });
  c.journalErreur_ = (s, m) => messages.push(m);
  c.reinitialiserPannePlateforme_();
  c.signalerPannePlateforme_(402, 'Payment Required', 'gemini-3.8-flash');
  assert.match(messages[0], /DriveAI_GEMINI_KEY/);
  assert.ok(!/console\.anthropic\.com/.test(messages[0]));
  c.reinitialiserPannePlateforme_();
  c.signalerPannePlateforme_(400, 'credit balance', 'claude-haiku-5-5');
  assert.match(messages[1], /Anthropic/);
});

/* ---------- de bout en bout, par les fonctions du moteur ---------- */

test('appelAnthropicTexte_ sur un modèle Gemini : texte rendu, jetons rangés dans la famille Gemini (pas Haiku, pas Sonnet)', () => {
  const c = ctx({
    PropertiesService: propriete('DriveAI_GEMINI_KEY', 'k'),
    UrlFetchApp: { fetch: () => reponseHttp(200, { candidates: [{ content: { parts: [{ text: 'bonjour' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: M, candidatesTokenCount: M, cachedContentTokenCount: 0 } }) },
  });
  c.reinitialiserUsage_();
  assert.strictEqual(c.appelAnthropicTexte_('gemini-3.8-flash', 'S', 'C', 100), 'bonjour');
  const s = plat(c.usageRunSnapshot_());
  assert.strictEqual(s.g38in, M);
  assert.strictEqual(s.g38out, M);
  assert.strictEqual(s.s55in + s.h55in + s.gl35in, 0);
});

test('sonderGemini : clé absente → aucun appel, aucune panne posée ; clé présente → un rapport par modèle, HTTP ≠ 200 lisible, DriveAI_LLM_PANNE JAMAIS écrite', () => {
  const ecrits = [];
  let cle = null;
  const props = { getProperty: (k) => (k === 'DriveAI_GEMINI_KEY' ? cle : null), setProperty: (k, v) => ecrits.push(k), deleteProperty: () => {} };
  let appels = 0;
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'Gemini.gs'], {
    tronquer_: (s, n) => String(s == null ? '' : s).slice(0, n), journalInfo_: () => {}, journalErreur_: () => {},
    PropertiesService: { getScriptProperties: () => props },
    UrlFetchApp: { fetch: (u) => { appels++; return /flash-lite/.test(u)
      ? reponseHttp(200, { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } })
      : reponseHttp(403, { error: { status: 'PERMISSION_DENIED' } }); } },
  });
  assert.match(c.sonderGemini(), /absente/);
  assert.strictEqual(appels, 0);
  cle = 'k';
  const r = c.sonderGemini();
  assert.match(r, /gemini-3\.5-flash-lite : OK/);
  assert.match(r, /gemini-3\.8-flash : ÉCHEC HTTP 403/);
  assert.strictEqual(appels, 2);
  assert.ok(!ecrits.includes('DriveAI_LLM_PANNE'), 'une sonde ratée ne suspend jamais le moteur de production');
  assert.strictEqual(c.estPannePlateforme_(), false);
  assert.ok(ecrits.some((k) => /^DriveAI_COUT_/.test(k)), 'le coût réel de la sonde est compté');
  c.UrlFetchApp = { fetch: () => { throw new Error('DNS'); } };
  assert.match(c.sonderGemini(), /ÉCHEC réseau : Error: DNS/);
  assert.ok(!ecrits.includes('DriveAI_LLM_PANNE') && !ecrits.includes('DriveAI_LLM_ECHECS_SYST'));
});

test('fetchGemini_ : le refus de la réflexion est mémorisé pour l\'exécution (un seul rejeu, pas un par appel) ; le transport reçoit le modèle', () => {
  const vus = [];
  const c = ctx({
    PropertiesService: propriete('DriveAI_GEMINI_KEY', 'k'),
    UrlFetchApp: { fetch: (url, o) => { vus.push(JSON.parse(o.payload)); return vus[vus.length - 1].generationConfig.thinkingConfig
      ? reponseHttp(400, { error: { message: 'thinking_level not supported' } })
      : reponseHttp(200, { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }); } },
  });
  c.fetchAvecRetry_('u', { payload: CORPS_MIN }, 'gemini-3.5-flash-lite');
  c.fetchAvecRetry_('u', { payload: CORPS_MIN }, 'gemini-3.5-flash-lite');
  assert.strictEqual(vus.length, 3, '2 appels pour le premier (refus + rejeu), 1 seul pour le second');
  assert.ok(!vus[2].generationConfig.thinkingConfig);
  const modeles = [];
  c.fetchBrut_ = (u, o, m) => { modeles.push(m); return reponseHttp(200, {}); };
  c.fetchAvecRetry_('u', { payload: CORPS_MIN }, 'gemini-3.8-flash');
  assert.deepStrictEqual(modeles, ['gemini-3.8-flash'], 'fetchBrut_ journalise et compte les échecs réseau par modèle');
});

/* ---------- coût ---------- */

test('prefixeUsage_ : flash-lite avant flash ; un Gemini inconnu tombe dans le plus CHER (budget surestimé, jamais sous-estimé)', () => {
  const c = ctx();
  assert.strictEqual(c.prefixeUsage_('gemini-3.5-flash-lite'), 'gl35');
  assert.strictEqual(c.prefixeUsage_('gemini-3.8-flash'), 'g38');
  assert.strictEqual(c.prefixeUsage_('gemini-9-futur'), 'g38');
  assert.strictEqual(c.prefixeUsage_('claude-sonnet-5-5'), 's55');
  assert.strictEqual(c.prefixeUsage_('claude-haiku-5-5'), 'h55');
});

test('coutDollars_ : un million de jetons de chaque sorte, au prix de la grille Gemini', () => {
  const c = ctx();
  const p = c.CONFIG.LLM_PRIX;
  assert.strictEqual(c.coutDollars_({ g38in: M }), p.gemini38_in);
  assert.strictEqual(c.coutDollars_({ g38out: M }), p.gemini38_out);
  assert.strictEqual(c.coutDollars_({ g38cr: M }), p.gemini38_cr);
  assert.strictEqual(c.coutDollars_({ gl35in: M }), p.geminil35_in);
  assert.strictEqual(c.coutDollars_({ gl35out: M }), p.geminil35_out);
  assert.strictEqual(p.gemini38_cw, 0, 'le cache de Gemini est implicite : aucune écriture facturée à part');
});

test('PRIX relevés le 05/11/2026 : Gemini 3.8 Flash 0,75/3,75 $, 3.5 Flash-Lite 0,30/2,50 $ — et RELEVER au 01/01/2027', () => {
  const p = ctx().CONFIG.LLM_PRIX;
  if (Date.now() < Date.UTC(2027, 0, 1)) {
    assert.strictEqual(p.gemini38_in, 0.75);
    assert.strictEqual(p.gemini38_out, 3.75);
    assert.strictEqual(p.gemini38_cr, 0.075);
  } else {
    // Le palier promotionnel est fini : Google annonce 1,50 $ / 7,50 $ / 0,15 $. Relire la page des tarifs.
    assert.ok(p.gemini38_in >= 1.5 && p.gemini38_out >= 7.5 && p.gemini38_cr >= 0.15,
      'RELEVER gemini38_* dans Config.gs : le tarif du 05/11/2026 expire le 31/12/2026');
  }
  assert.strictEqual(p.geminil35_in, 0.3);
  assert.strictEqual(p.geminil35_out, 2.5);
});

test('jetonsParFamille_ : les deux familles Gemini sont publiées (nombres seulement) ; un mois d\'avant Gemini donne 0, pas NaN', () => {
  const c = ctx();
  const j = plat(c.jetonsParFamille_({ g38in: 5, g38out: 6, g38cw: 0, g38cr: 7, gl35in: 1, gl35out: 2 }));
  assert.deepStrictEqual(j.gemini38, { entree: 5, sortie: 6, cacheEcrit: 0, cacheLu: 7 });
  assert.deepStrictEqual(j.gemini35lite, { entree: 1, sortie: 2, cacheEcrit: 0, cacheLu: 0 });
  assert.deepStrictEqual(plat(c.jetonsParFamille_({ h55in: 3 })).gemini38, { entree: 0, sortie: 0, cacheEcrit: 0, cacheLu: 0 });
});

test('lireCoutMois_ / coutDollarsDelta_ / syntheseCoutMois_ : un mois enregistré AVANT Gemini se relit sans NaN, le delta compte Gemini', () => {
  const c = ctx();
  const t = c.lireCoutMois_({ getProperty: () => JSON.stringify({ hin: 1, h55in: 2, appels: 3 }) }, 'k');
  assert.strictEqual(t.g38in, 0);
  assert.strictEqual(t.gl35cr, 0);
  assert.ok(Number.isFinite(c.coutDollars_(t)));
  assert.strictEqual(c.coutDollarsDelta_({}, { gl35out: M }), c.CONFIG.LLM_PRIX.geminil35_out);
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ g38in: 5, gl35out: 7 }) }) };
  assert.strictEqual(c.syntheseCoutMois_().tokens, 12);
});

/* ---------- verrous de source ---------- */

test('VERROU : aucun site d\'appel ne lit la clé Anthropic en direct — tous passent par cleLlm_ (sinon Gemini seul planterait)', () => {
  const hors = [];
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.gs'))) {
    const txt = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (!txt.includes('api.anthropic.com/v1/messages')) continue;
    if (/'x-api-key':\s*getCleAnthropic_\(\)/.test(txt)) hors.push(f);
  }
  assert.deepStrictEqual(hors, []);
});

test('VERROU : tout appel LLM passe par fetchAvecRetry_ ou fetchLlmDirect_ — aucun UrlFetchApp direct vers Anthropic', () => {
  const hors = [];
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.gs'))) {
    const txt = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (/UrlFetchApp\.fetch\(\s*'https:\/\/api\.anthropic\.com/.test(txt)) hors.push(f);
  }
  assert.deepStrictEqual(hors, []);
});

test('VERROU : la clé Gemini n\'est jamais écrite en dur ni dans une URL ; aucun scope OAuth ajouté par cette étape', () => {
  const txt = fs.readFileSync(path.join(SRC, 'Gemini.gs'), 'utf8');
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(txt), 'aucune clé en dur');
  assert.ok(!/[?&]key=/.test(txt), 'la clé voyage en en-tête, jamais en paramètre d\'URL');
  const manifeste = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
  assert.ok(manifeste.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'), 'UrlFetchApp suffit');
  assert.ok(!manifeste.oauthScopes.some((s) => /generative|aiplatform|cloud-platform/.test(s)), 'aucun scope Google AI');
});

test('F13 — compatibilité production sans DriveAI_GEMINI_KEY : pipeline V2 + tri Gmail tournent sur Claude sans lire ni échouer sur DriveAI_GEMINI_KEY', () => {
  const urls = [];
  const props = { DriveAI_ANTHROPIC_KEY: 'k' }; // DriveAI_GEMINI_KEY absente
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'Gemini.gs', 'Gmail.gs', 'TriGmail.gs'], {
    tronquer_: (s, n) => String(s == null ? '' : s).slice(0, n),
    journalInfo_: () => {},
    journalErreur_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    UrlFetchApp: {
      fetch: (url) => {
        urls.push(url);
        return reponseHttp(200, {
          content: [{ type: 'text', text: '{"categorie":"Finance","suspect":false,"aTraiter":false}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      },
    },
  });
  c.reinitialiserPannePlateforme_();
  c.reinitialiserUsage_();
  const resTri = plat(c.analyserFil_('Banque <c@banque.exemple>', 'Relevé', 'Votre relevé est prêt.', ['Finance']));
  assert.deepStrictEqual(resTri, { categorie: 'Finance', suspect: false, aTraiter: false });
  const resTexte = c.appelAnthropicTexte_(c.CONFIG.ANALYSE_V2_MODELE, 'S', 'C', 100);
  assert.ok(typeof resTexte === 'string' && resTexte.length > 0);
  assert.ok(urls.every((u) => u === 'https://api.anthropic.com/v1/messages'), 'tous les appels restent sur Anthropic');
  assert.match(c.sonderGemini(), /absente/);
  assert.strictEqual(urls.length, 2, 'sonderGemini sans clé ne fait aucun appel réseau');
  assert.strictEqual(c.estPannePlateforme_(), false);
  assert.ok(!('DriveAI_LLM_PANNE' in props));

  // Un modèle Gemini sans DriveAI_GEMINI_KEY déclenche proprement la panne plateforme (retour null, 0 réseau).
  c.CONFIG.LLM_MODELE = 'gemini-3.5-flash-lite';
  const resSansCle = c.analyserFil_('Banque <c@banque.exemple>', 'Relevé', 'Contenu', ['Finance']);
  assert.strictEqual(resSansCle, null, 'transitoire → aucune clé Index consommée');
  assert.strictEqual(c.estPannePlateforme_(), true);
  assert.strictEqual(urls.length, 2, 'zéro appel réseau quand DriveAI_GEMINI_KEY est absente');
});

test('Config.gs — getCleAnthropic_() lève si absente et cleLlm_() retourne "" pour Gemini sans clé Anthropic', () => {
  const props = {};
  const c = load(['Config.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
      }),
    },
  });
  assert.throws(() => c.getCleAnthropic_(), /DriveAI_ANTHROPIC_KEY/);
  assert.throws(() => c.cleLlm_('claude-sonnet-5-5'), /DriveAI_ANTHROPIC_KEY/);
  assert.strictEqual(c.cleLlm_('gemini-3.5-flash-lite'), '');

  props.DriveAI_ANTHROPIC_KEY = 'k';
  assert.strictEqual(c.getCleAnthropic_(), 'k');
  assert.strictEqual(c.cleLlm_('claude-sonnet-5-5'), 'k');
});
