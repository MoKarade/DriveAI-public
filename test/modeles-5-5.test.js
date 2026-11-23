'use strict';
/**
 * Génération 5.5 — modèles, réglages de requête, plus aucun ancien identifiant.
 *
 * Ce que la 5.5 change et que ces tests verrouillent : `temperature`/`top_p`/`top_k`/`budget_tokens`
 * sont rejetés (400) ; la réflexion est active par défaut et se paie sur `max_tokens` ; Haiku 5.5
 * accepte `thinking:{type:'disabled'}`, Sonnet 5.5 le refuse (400) et veut `between_tools`.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');

const SRC = path.join(__dirname, '..', 'src');
const sources = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs'));

test('aucun ancien modèle dans le moteur : Haiku 4.x, Sonnet 4.x et Sonnet 5 (sans .5) sont retirés', () => {
  const restes = [];
  for (const f of sources) {
    const txt = fs.readFileSync(path.join(SRC, f), 'utf8');
    // Un identifiant d'API : `claude-` + famille + génération. `claude-sonnet-5-5` reste permis.
    const re = /claude-(?:haiku-[1-4][-.\d]*|sonnet-[1-4][-.\d]*|opus-[1-4][-.\d]*|sonnet-5(?![-\d])|haiku-5(?![-\d])|3[-.\d]*-\w+)/g;
    let m;
    while ((m = re.exec(txt))) restes.push(f + ' : ' + m[0]);
  }
  assert.deepStrictEqual(restes, []);
});

test('les modèles configurés sont ceux de la génération 5.5', () => {
  const c = load(['Config.gs']);
  assert.strictEqual(c.CONFIG.LLM_MODELE, 'claude-haiku-5-5');
  assert.strictEqual(c.CONFIG.LLM_MODELE_FALLBACK, 'claude-sonnet-5-5');
  assert.strictEqual(c.CONFIG.ANALYSE_V2_MODELE, 'claude-sonnet-5-5');
});

test('avecReglages_ : Haiku 5.5 sans réflexion, effort bas ; le corps est complété, pas copié', () => {
  const c = load(['Config.gs']);
  const corps = { model: 'claude-haiku-5-5', max_tokens: 40 };
  const rendu = c.avecReglages_(corps, 'claude-haiku-5-5');
  assert.strictEqual(rendu, corps);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rendu.thinking)), { type: 'disabled' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rendu.output_config)), { effort: 'low' });
});

test('avecReglages_ : Sonnet 5.5 REFUSE `disabled` — `between_tools`, effort moyen', () => {
  const c = load(['Config.gs']);
  const r = c.avecReglages_({}, 'claude-sonnet-5-5');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.thinking)), { type: 'between_tools' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.output_config)), { effort: 'medium' });
});

test('avecReglages_ : un modèle hors 5.5 ne reçoit AUCUN champ qu\'il ne connaît pas', () => {
  const c = load(['Config.gs']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.avecReglages_({ a: 1 }, 'claude-haiku-4-5'))), { a: 1 });
});

test('tout appel à l\'API passe par avecReglages_, et aucun n\'envoie temperature/top_p/top_k', () => {
  let appels = 0;
  for (const f of sources) {
    const txt = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (!txt.includes('api.anthropic.com/v1/messages')) continue;
    // Les corps JSON de l'API : `payload: JSON.stringify(avecReglages_(` ; un corps nu est refusé.
    const nus = txt.match(/payload: JSON\.stringify\((?!avecReglages_\()(?:\{\s*model:|corps\))/g) || [];
    assert.deepStrictEqual(nus, [], f + ' : un corps d\'appel Anthropic part sans réglages');
    appels += (txt.match(/avecReglages_\(/g) || []).length;
    assert.ok(!/\b(?:temperature|top_p|top_k|budget_tokens)\s*:/.test(txt), f + ' : paramètre rejeté par la 5.5');
  }
  // 9 → 7 → 6 (ADR-0074) → 5 (ADR-0075 6b : le mini-check d'importance est parti avec Intentions.gs).
  assert.ok(appels >= 4, 'les quatre corps d\'appel (' + appels + ')');
});

function ctxLlm(modeleReponse) {
  const c = load(['Config.gs', 'Llm.gs'], { tronquer_: (s, n) => String(s == null ? '' : s).slice(0, n) });
  const vus = [];
  c.estPannePlateforme_ = () => false;
  c.getCleAnthropic_ = () => 'clé-test';
  c.signalerRetablissement_ = () => {};
  c.enregistrerUsage_ = () => {};
  c.fetchAvecRetry_ = (url, options) => {
    vus.push(JSON.parse(options.payload));
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        content: [{ type: 'text', text: '{"ok":true}' }],
        usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn',
      }),
    };
  };
  return { c, vus };
}

test('appelAnthropicTexte_ (Haiku 5.5) part sans réflexion, effort bas, sans temperature', () => {
  const { c, vus } = ctxLlm();
  c.appelAnthropicTexte_('claude-haiku-5-5', 'système', 'contenu', 64);
  assert.strictEqual(vus.length, 1);
  assert.deepStrictEqual(vus[0].thinking, { type: 'disabled' });
  assert.deepStrictEqual(vus[0].output_config, { effort: 'low' });
  assert.strictEqual(vus[0].temperature, undefined);
});

test('appelAnthropicV2_ (Sonnet 5.5) part en between_tools, effort moyen', () => {
  const { c, vus } = ctxLlm();
  c.appelAnthropicV2_('claude-sonnet-5-5', { nomFichier: 'a.pdf', extrait: 'x' }, c.PROMPT_PASSE1, null);
  assert.deepStrictEqual(vus[0].thinking, { type: 'between_tools' });
  assert.deepStrictEqual(vus[0].output_config, { effort: 'medium' });
});
