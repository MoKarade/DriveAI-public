/**
 * Gemini.gs — Fournisseur LLM Google (API Gemini, `generateContent`), ADR-0073 (étape 4 de l'ADR-0074).
 * Le moteur parle « format Anthropic » partout ; ce module TRADUIT à la frontière réseau : `fetchAvecRetry_` et
 * `fetchLlmDirect_` (Llm.gs) aiguillent un modèle `gemini-…` vers `fetchGemini_`. Le fournisseur se choisit par
 * le NOM DU MODÈLE (`Config.gs`). Aucun appel d'outil (chat retiré, ADR-0074 étape 2) : un bloc inconnu LÈVE.
 * Traductions PURES ; seul `fetchGemini_` fait du réseau (`UrlFetchApp`, aucun nouveau scope OAuth).
 * Sécurité : clé `DriveAI_GEMINI_KEY` (Script Properties, posée par `setProperties(obj, false)`, jamais par
 * l'interface) en en-tête `x-goog-api-key`, JAMAIS dans l'URL (les URL finissent dans les journaux). Clé absente =
 * panne de compte (HTTP 401 synthétique), jamais un échec imputé au document.
 */

var GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

/** Clé API Gemini (Script Properties), ou '' si absente. Jamais en dur. */
function getCleGemini_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('DriveAI_GEMINI_KEY') || '').trim(); }
  catch (e) { journalErreur_('LLM', 'Script Properties illisibles (clé Gemini) : ' + e); return ''; }
}

/** Vrai dès que l'API a refusé `thinkingConfig` dans cette exécution : plus de rejeu (quota, Journal). */
var _geminiSansReflexion = false;

/** Réponse factice (même interface que HTTPResponse pour les champs que le moteur lit). */
function reponseSynthetique_(code, corps) {
  return { getResponseCode: function () { return code; }, getContentText: function () { return corps; } };
}

/** PURE. Le prompt système, qu'il soit une chaîne ou une liste de blocs texte. */
function texteSystemeGemini_(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  var morceaux = [];
  for (var i = 0; i < system.length; i++) {
    if (system[i] && typeof system[i].text === 'string') morceaux.push(system[i].text);
  }
  return morceaux.join('\n\n');
}

/**
 * PURE. Traduit un corps de requête Anthropic (model, max_tokens, system, messages) en requête
 * `generateContent`. Pris en charge : texte, images et PDF en base64. Tout autre bloc LÈVE.
 * @param {Object} [cfg]  CONFIG (marge, niveau de réflexion) ; défaut : CONFIG global
 */
function versRequeteGemini_(corps, cfg) {
  var c = cfg || CONFIG;
  var req = { contents: [], generationConfig: {} };

  var sys = texteSystemeGemini_(corps.system);
  if (sys) req.systemInstruction = { parts: [{ text: sys }] };

  var messages = corps.messages || [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var parts = [];
    if (typeof m.content === 'string') {
      parts.push({ text: m.content });
    } else {
      var blocs = m.content || [];
      for (var j = 0; j < blocs.length; j++) {
        var b = blocs[j];
        if (!b) continue;
        if (b.type === 'text') {
          parts.push({ text: String(b.text == null ? '' : b.text) });
        } else if (b.type === 'image' || b.type === 'document') {
          if (!b.source || b.source.type !== 'base64') {
            throw new Error('Gemini : bloc ' + b.type + ' non base64 non pris en charge');
          }
          parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
        } else {
          throw new Error('Gemini : type de bloc non pris en charge : ' + b.type);
        }
      }
    }
    if (parts.length) req.contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: parts });
  }

  // La réflexion se paie sur le plafond de sortie : sans marge, une réponse courte mais « réfléchie »
  // serait coupée avant son JSON. La marge n'est PAS facturée si elle n'est pas consommée.
  req.generationConfig.maxOutputTokens = (Number(corps.max_tokens) || 1024) + (Number(c.GEMINI_MARGE_SORTIE) || 0);
  if (c.GEMINI_THINKING_LEVEL && !_geminiSansReflexion) req.generationConfig.thinkingConfig = { thinkingLevel: c.GEMINI_THINKING_LEVEL };
  return req;
}

/** Raisons d'arrêt qui valent un refus du modèle (contenu bloqué), pas une réponse. */
var GEMINI_FIN_REFUS = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'LANGUAGE'];

/**
 * PURE. Traduit une réponse `generateContent` en `{content:[{type:'text'}], stop_reason, usage}` (format
 * Anthropic). Les jetons de réflexion comptent en SORTIE (facturés ainsi) ; le cache lu sort de l'entrée.
 */
function depuisReponseGemini_(data) {
  var d = data || {};
  var cand = d.candidates && d.candidates[0];
  var parts = (cand && cand.content && cand.content.parts) || [];
  var content = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p || p.thought === true) continue; // résumé de réflexion : jamais montré
    if (typeof p.text === 'string') content.push({ type: 'text', text: p.text });
  }

  var fin = cand && cand.finishReason;
  var bloque = !cand && d.promptFeedback && d.promptFeedback.blockReason;
  var stop = 'end_turn';
  if (bloque || GEMINI_FIN_REFUS.indexOf(fin) !== -1) stop = 'refusal';
  else if (fin === 'MAX_TOKENS') stop = 'max_tokens';

  var um = d.usageMetadata || {};
  var prompt = Number(um.promptTokenCount) || 0;
  var cache = Number(um.cachedContentTokenCount) || 0;
  return {
    content: content,
    stop_reason: stop,
    usage: {
      input_tokens: Math.max(0, prompt - cache),
      output_tokens: (Number(um.candidatesTokenCount) || 0) + (Number(um.thoughtsTokenCount) || 0),
      cache_creation_input_tokens: 0, // le cache de Gemini est implicite : aucune écriture facturée à part
      cache_read_input_tokens: cache
    }
  };
}

/**
 * UN appel Gemini, format Anthropic en entrée et en sortie. `transport(url, options)` fait le réseau :
 * `fetchBrut_` (retry, null sur exception) ou `UrlFetchApp.fetch` direct (lève). Une erreur HTTP passe
 * telle quelle (le corps sert `detecterPannePlateforme_`). Rend null si le réseau est mort.
 */
function fetchGemini_(options, modele, transport) {
  var cle = getCleGemini_();
  if (!cle) {
    return reponseSynthetique_(401, JSON.stringify({ error: { status: 'GEMINI_KEY_ABSENTE',
      message: 'Clé absente : pose DriveAI_GEMINI_KEY dans les Script Properties (docs/DEPLOIEMENT.md §6).' } }));
  }
  var req;
  try {
    req = versRequeteGemini_(JSON.parse(options.payload));
  } catch (e) {
    journalErreur_('LLM', 'Requête Gemini impossible à construire (' + modele + ') : ' + e);
    return null;
  }
  var url = GEMINI_URL_BASE + modele + ':generateContent';
  var opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': cle },
    payload: JSON.stringify(req),
    muteHttpExceptions: true
  };
  var rep = transport(url, opts, modele);
  if (!rep) return null;

  // Filet : l'API refuse le réglage de réflexion → UN rejeu sans lui (puis plus jamais dans cette
  // exécution), pas tous les documents en échec.
  if (rep.getResponseCode() === 400 && req.generationConfig.thinkingConfig &&
      /thinking/i.test(String(rep.getContentText()))) {
    journalInfo_('LLM', 'Gemini a refusé le réglage de réflexion (' + modele + ') — rejeu sans lui.');
    _geminiSansReflexion = true;
    delete req.generationConfig.thinkingConfig;
    opts.payload = JSON.stringify(req);
    rep = transport(url, opts, modele);
    if (!rep) return null;
  }

  if (rep.getResponseCode() !== 200) return rep;
  var data;
  try { data = JSON.parse(rep.getContentText()); } catch (e) { return rep; } // 200 illisible : l'appelant journalise « non-JSON »
  return reponseSynthetique_(200, JSON.stringify(depuisReponseGemini_(data)));
}

/**
 * Sonde manuelle (éditeur Apps Script) : prouve la clé et le réglage de réflexion pour les deux modèles AVANT la
 * bascule (étape 5). Quelques centièmes de cent ; aucun document touché ; ne passe JAMAIS par la détection de panne
 * (une clé fausse ne suspend pas la production, encore sur Anthropic). Hors du verrou du tick : quelques centièmes
 * de coût peuvent se perdre si un tick écrit le même mois au même instant — accepté pour une sonde.
 */
function sonderGemini() {
  if (!getCleGemini_()) return 'Clé DriveAI_GEMINI_KEY absente : rien n\'a été appelé (docs/DEPLOIEMENT.md §6).';
  var direct = function (u, o) { return UrlFetchApp.fetch(u, o); };
  var rapport = [];
  reinitialiserUsage_();
  var modeles = [CONFIG.GEMINI_MODELE_PETIT, CONFIG.GEMINI_MODELE_GRAND];
  for (var i = 0; i < modeles.length; i++) {
    var corps = { model: modeles[i], max_tokens: 16, system: 'Réponds uniquement par le mot OK.', messages: [{ role: 'user', content: 'ping' }] };
    var ligne;
    try {
      var rep = fetchGemini_({ payload: JSON.stringify(corps) }, modeles[i], direct);
      if (!rep) ligne = 'ÉCHEC (requête impossible, voir le Journal)';
      else if (rep.getResponseCode() !== 200) ligne = 'ÉCHEC HTTP ' + rep.getResponseCode() + ' : ' + tronquer_(rep.getContentText(), 160);
      else { var data = JSON.parse(rep.getContentText()); enregistrerUsage_(modeles[i], data.usage); ligne = tronquer_(texteReponse_(data).trim(), 20) || '(réponse vide)'; }
    } catch (e) { ligne = 'ÉCHEC réseau : ' + e; }
    rapport.push(modeles[i] + ' : ' + ligne);
  }
  try { flushUsage_(); } catch (e) { rapport.push('coût non enregistré : ' + e); }
  var texte = rapport.join('\n');
  journalInfo_('Gemini', 'Sonde : ' + texte.replace(/\n/g, ' | '));
  return texte;
}
