# ADR-0073 — Passer le moteur de l'API Anthropic à l'API Gemini

- **Statut** : **accepté le 02/11/2026** par Marc (« remplace par api gemini », « plus rien de Claude », palier payant
  plafonné), **confirmé le 05/11/2026** (brief de l'ADR-0074 : Gemini payant, 20 $/mois, derniers modèles). Première
  rédaction : PR DriveAI#873 (fermée sans fusion) ; reprise à l'étape 4 de l'ADR-0074 sur le moteur épuré. **Cette ADR et
  son adaptateur (étape 4) ne changent AUCUN modèle** ; la bascule et le retrait de la clé Anthropic (étape 5) attendent
  la clé, la sonde et l'audit de précision (§5).
  **Amont** : ADR-0067 (modèles 5.5, vrai jusqu'à l'étape 5) ; ADR-0074 §2 point 2 ; `docs/claude/11-protocole-de-precision.md`.

## 1. Problème et objectif

Après l'étape 3 de l'ADR-0074, le moteur appelle l'API Anthropic en cinq endroits (`Llm.gs` ×3, `Prefiltre.gs`,
`TriGmail.gs`). Marc veut tout le moteur chez Google. **Objectif** : un seul fournisseur, Gemini, sans réécrire la
logique métier ni changer ce que le classement décide.

## 2. Décision

1. **Traduction à la frontière réseau**, pas réécriture. Le moteur continue de parler « format Anthropic » (`system`,
   `messages`, `max_tokens`, réponse `content[]` / `stop_reason` / `usage`). `fetchAvecRetry_` et `fetchLlmDirect_`
   (`src/Llm.gs`) aiguillent un modèle dont le nom commence par `gemini-` vers `fetchGemini_` (`src/Gemini.gs`), qui
   traduit la requête vers `generateContent` puis la réponse vers le format Anthropic. Prompts, parseurs, gestion de
   panne et cache de décision ne bougent pas.
2. **Le fournisseur se choisit par le nom du modèle**, une ligne de `Config.gs` par rôle (`LLM_MODELE`,
   `LLM_MODELE_FALLBACK`, `ANALYSE_V2_MODELE`). Retour arrière = remettre l'ancien nom.
3. **Rôles** (étape 5) : petit (tri Gmail, mini-check d'importance) = `gemini-3.5-flash-lite` (« Stable ») ; grand
   (analyse en deux passes, escalade, relecture multimodale à l'étape 9) = `gemini-3.8-flash` (« New », le Flash le
   plus capable). Relevé sur la page des modèles le 05/11/2026 ; « derniers modèles » = Marc, 05/11/2026.
4. **Clé** : Script Property `DriveAI_GEMINI_KEY`, posée par `setProperties(obj, false)` (jamais par l'interface, qui
   écrase les autres propriétés : leçon du 24/10/2026), jamais en dur, en-tête `x-goog-api-key` (jamais dans l'URL).
   Absente : HTTP 401 synthétique, donc **panne de compte** (les sources se suspendent, aucun document n'est compté en
   échec), pas un échec de document.
5. **Plafond de dépense** : le crédit prépayé de l'API Gemini est le plafond (20 $/mois, Marc). [Probable] AI Studio
   facture le palier payant en PRÉPAIEMENT (solde séparé, rechargement manuel ou automatique au choix ; documentation
   « Billing » et billet « Prepay for the Gemini API », relus le 05/11/2026) : **ne pas activer le rechargement
   automatique**. [À vérifier à la sonde] le code HTTP rendu à solde nul (402 attendu, lu comme panne de compte ; un
   429 répété est couvert par la série systémique existante). Le frein des campagnes (`LLM_BUDGET_CAMPAGNES`) lit le
   coût Gemini comme les autres (familles `g38` et `gl35` de `Cout.gs`).
6. **Aucun nouveau scope OAuth** : `UrlFetchApp` (`script.external_request`, déjà accordé) suffit ; verrou
   `test/gemini.test.js`.
7. **Hors périmètre** : les noms `appelAnthropic*_` restent jusqu'à l'étape 5. Aucun appel d'outil n'est traduit (le
   chat à outils a quitté le moteur, ADR-0074 étape 2) ; un bloc inconnu LÈVE au lieu d'être perdu en silence.

## 3. Ce que la traduction couvre, et ses limites

- Couvert : texte, images et PDF en base64 (`inlineData`), prompt système en chaîne ou en blocs ; `cache_control` est
  ignoré (cache Gemini implicite). La réflexion se paie sur le plafond de sortie : marge `GEMINI_MARGE_SORTIE` (2 048)
  ajoutée à `max_tokens`, non facturée si inutilisée ; jetons de réflexion comptés en SORTIE, cache lu déduit de l'entrée.
- **[À vérifier par `sonderGemini`]** `generationConfig.thinkingConfig.thinkingLevel` = `low` (accepté par les deux
  modèles d'après la page « thinking » du 05/11/2026) ; si l'API le refuse, `fetchGemini_` rejoue UNE fois sans lui.

## 4. Impact quotas, coût et risques

**Coût (grille Gemini, palier payant, relevée le 05/11/2026 ; `CONFIG.LLM_PRIX`)** :

| Rôle | Avant (Anthropic) | Après (Gemini) |
|---|---|---|
| Petit | Haiku 5.5 : 0,10 $ / 0,50 $ par million de jetons | 3.5 Flash-Lite : 0,30 $ / 2,50 $ (**3 à 5 fois plus cher**) |
| Grand | Sonnet 5.5 : 2 $ / 10 $ | 3.8 Flash : 0,75 $ / 3,75 $ jusqu'au 31/12/2026, puis 1,50 $ / 7,50 $ dès le 01/01/2027 |

Le gain vient du grand modèle seulement ; sur le petit, la facture monte. Le net dépend de la part de chaque rôle
(onglet `Coûts` de la Sheet) : à relire un mois après l'étape 5. `test/gemini.test.js` rougit dès le 01/01/2027 tant
que les prix du grand modèle ne sont pas relevés.

**Vie privée** : sur le palier gratuit, Google utilise les requêtes pour améliorer ses produits ; sur le payant, non.
DriveAI lit des papiers d'immigration, fiscaux et de santé : **le palier gratuit est exclu**. **Risques** : (a) la qualité
du classement change avec le modèle, voir §5 ; (b) un crédit épuisé arrête TOUT le moteur (plus de Claude en secours),
voulu ; (c) les limites de débit montent avec la dépense cumulée : un 429 répété est lu comme panne durable (règle existante).

## 5. Méthode de test et passage à la production

- Étape 4 : `test/gemini.test.js` (traductions, aiguillage par nom, clé en en-tête, rejeu sans réflexion, panne
  401/402/403, comptage par famille, échéance du tarif, aucun scope ajouté, verrous de source : aucun site ne lit la
  clé Anthropic en direct, aucun `UrlFetchApp` direct vers Anthropic).
- **Avant l'étape 5** : (1) Marc pose `DriveAI_GEMINI_KEY` et le crédit prépayé (`docs/DEPLOIEMENT.md` §6) ; (2)
  `sonderGemini` rend OK pour les deux modèles ; (3) audit de précision sur ~20 documents réels, ancien contre nouveau
  modèle (protocole §2) ; (4) alors seulement, l'étape 5 change les noms et retire la clé Anthropic. Sans la clé, elle
  suspendrait le moteur (panne de compte, rien de perdu).
