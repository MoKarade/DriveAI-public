<!-- Extrait de l'ancien CLAUDE.md (§ 7. Intégration hub (widget DriveAI sur exemple.com)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Intégration hub (widget DriveAI sur exemple.com)

## 7. Intégration hub (widget DriveAI sur exemple.com)

DriveAI expose un résumé au **hub perso** (`exemple.com`) via **un seul endpoint** :
`GET /api/hub/summary` (`api/hub/summary.ts`, serverless Vercel). URL canonique de l'app :
**`https://drive.exemple.com`**.

- **Contrat** : `@mokarade/hub-contract` v1 (devDependency de `app/`, épinglé sur `#v1.5.0` — zod 4 — le 2026-10-16 ; source : `app/package.json`). La forme du payload est
  **inlinée** dans `api/hub/summary.ts` (api/ reste **zéro dépendance npm par construction**) et
  **verrouillée** par le VRAI schéma du package (`validateSummary()` + `buildingSummary()`) dans
  `app/test/hub-summary.test.ts`. Toute évolution du contrat passe par le package (bump de version
  + re-pin), **jamais** par une divergence locale.
- **Auth (échec fermé)** : le hub envoie le header `x-hub-token`. Comparaison en **temps constant**
  (digests SHA-256 + `timingSafeEqual`). `HUB_TOKEN` (variable d'env Vercel, jamais en dur) absent
  → **503** `hub disabled` ; jeton absent/faux → **401** ; méthode ≠ GET → **405**. Réponse toujours
  `Cache-Control: no-store`.
- **HONNÊTETÉ (no-fake-data)** : le point de bascule est `api/hub/_engineState.ts` →
  `getEngineState()`, qui interroge la web app Apps Script (`action=hub-summary`, gardée par le
  secret partagé `WEBAPP_SECRET` — aucun nouveau secret) et rend des **métadonnées seulement**
  (compteurs, horodatage, avancement des campagnes, ADR-0007) — jamais un CONTENU de document.
  ⚠️ Cette puce écrivait « jamais un nom de fichier » jusqu'au 14/09/2026 : c'était une glose plus
  stricte que l'ADR-0007, dont le §2 liste `Fichier` parmi les métadonnées légitimes. Depuis
  l'**ADR-0057**, le nom du dernier document classé est publié — et sous une contrainte précise :
  il voyage dans le bloc `details` du contrat, **JAMAIS dans `metrics`**, parce que Hubperso
  persiste les métriques (table `releves`, 90 jours) et pas les détails. Un test le verrouille.
  Trois retours, trois
  sens **distincts** : `null` (intégration non branchée, ou moteur jamais passé) ⇒ summary
  `status:"building"` ; `throw` (canal branché mais EN PANNE — réseau, HTTP, JSON illisible) ⇒
  **500**, jamais une donnée partielle ; sinon les vrais chiffres. Le serverless Vercel n'accède
  toujours **pas** à la Sheet : c'est le moteur qui la lit, et l'app la lit côté navigateur avec le
  jeton OAuth de Marc (ADR-0007).
  *(Cette puce a affirmé « **Phase 0 (aujourd'hui)** : il renvoie `null` » jusqu'au 2026-08-20,
  alors que le broker servait des métriques réelles depuis la Phase 1 — C28-27, 21/07. Un état
  transitoire écrit au présent rote sans prévenir.)*
- **Règle de maintenance** : toute nouvelle métrique se branche dans `getEngineState()` **et** passe
  par le contrat. Ne **jamais** casser le schéma (toute évolution passe par `hub-contract` : bump de
  version + re-pin, jamais une divergence locale) ni publier de donnée fabriquée — `building` tant
  que rien de réel n'est disponible vaut mieux qu'un chiffre plausible.
- **QUOTA — le broker met en cache (60 s), et c'est structurel.** Le hub poll ce endpoint
  **toutes les 15 s** tant qu'un onglet est ouvert, alors que le moteur ne recalcule le résumé
  qu'**une fois par tick** (`CONFIG.TICK_MINUTES = 5`, persisté dans `DriveAI_HUB_SUMMARY`).
  Sans cache, 19 polls sur 20 déclenchaient une exécution Apps Script pour renvoyer des octets
  identiques — sur un budget **DUR de 90 min/jour** de temps d'exécution, partagé avec le tick
  lui-même. `_engineState.ts` garde donc le dernier état lu pendant 60 s. Aucune fraîcheur perdue
  (la donnée bouge toutes les 5 min) et `dataAsOf` continue d'exposer la fraîcheur réelle.
  ⚠️ Les **pannes ne sont jamais mises en cache** — un `throw` doit rester observable et le
  prochain appel doit réessayer. ⚠️ Cache de **process** : vide au démarrage à froid, non partagé
  entre instances → taux de succès partiel, ce qui reste tout bénéfice (chaque succès = une
  exécution économisée). Toute nouvelle voie d'appel depuis le hub doit se poser la même question.

### LIA et le connecteur MCP sont retirés (ADR-0074, 05/11/2026)

LIA (tâche #650, état partagé #771, ADR-0069) et le connecteur MCP (ADR-0042, `src/Mcp.gs`, `api/mcp/*`, OAuth
`api/_mcpOauth.ts`) sont retirés par la PR 2 du plan de l'ADR-0074, avec le chat à outils `chat-assistant` (ADR-0026) et
la recherche IA `recherche-ia` du `doPost`. Plus aucun appel LLM ne part de la web app ni de `api/` ; `api/` ne compte
plus que 6 fonctions (plafond Hobby : 12) et `vercel.json` ne réécrit plus que `/api/sante`. Le résumé du hub
(`api/hub/summary.ts`, action `hub-summary`) ne bouge pas. Les Script Properties `DriveAI_MCP_SECRET` et les variables
Vercel `MCP_ENGINE_SECRET` restent en place sans être lues (`HUB_URL`, elle, sert toujours à `aAccesHub`) (geste de Marc, jamais pressé) ; le
`repository_dispatch` `note-lia` de `.github/workflows/reacteur.yml` (chemin protégé) reste inerte. Ce que LIA et le MCP
faisaient se lit dans les ADR cités et dans `docs/journal/`.

### Le canal vers MemoryAI est retiré (ADR-0074, 05/11/2026)

Les exports Messenger (#664, ADR-0064), la seconde lecture des papiers (#678, ADR-0065), l'essai de relecture par l'image
(#740, ADR-0068), la troisième lecture (#759) et l'agenda du jour (#679, ADR-0066), comme l'inventaire et les pièces
(ADR-0059, 0061), ne sont plus dans le moteur : modules, étapes du tick, clés `CONFIG`, lignes de Santé et écrans retirés par
DriveAI#881. MemoryAI sort de l'écosystème (décision de Marc du 02/11/2026, confirmée le 05/11). Ce que ces canaux faisaient
et pourquoi se lit dans les ADR cités et dans `docs/journal/`.
