# ADR-0079 — Fiabilisation du moteur (Groupe A) sans changement des règles de tri, et gel du Groupe B sous protocole de précision

- **Statut** : **accepté le 18/11/2026** (cadrage R5/R6 : correctifs de fiabilité Groupe A livrés sur le moteur actuel sous Haiku/Sonnet 5.5 ; pistes Groupe B explicitement gelées dans l’attente de `DriveAI_GEMINI_KEY` et d’audits comparatifs sur ~20 cas réels conformes à `docs/claude/11-protocole-de-precision.md`).
  **Complète** : ADR-0004 (fiabilité), ADR-0012 / ADR-0050 / ADR-0075 / ADR-0076 (tri Gmail natif), ADR-0073 (adaptateur Gemini), ADR-0077 (dédoublonnage sur preuve). **Inchangés** : ADR-0007 (rien du corps persisté), ADR-0016 (fail-safe), garde-fous §1 (`docs/claude/01-principes.md`).

## 1. Contexte et objectif

L’inspection complète du moteur Apps Script (`src/*.gs`, 38 modules) demandée au titre de l’exigence R5 a mis en évidence deux catégories distinctes d’évolutions :

1. **Groupe A (fiabilité, robustesse, dédoublonnage et observabilité)** : des défauts ou angles morts techniques qui n’altèrent aucune règle de classification documentaire ni de tri Gmail (pagination sur file mouvante, garde pré-écriture sur libellé manquant, couverture des fils lus âgés de plus de 29 jours et ré-évaluation d’un fil revenu en boîte, remontée de quota Gmail sur l’ensemble des appels, propagation de `fileId` sur les voies rapides pour tenir l’ADR-0077, journalisation de `stop_reason` et nettoyage documentaire avec `DriveAI_GEMINI_KEY` encore absente).
2. **Groupe B (règles de classement, de préservation de libellés ou changement de fournisseur LLM)** : des modifications qui changeraient la sortie de routage ou de tri sur des documents ou courriels réels. Par ailleurs, la clé `DriveAI_GEMINI_KEY` n’est pas encore posée dans les Script Properties en production.

**Objectif** : livrer immédiatement les six correctifs de fiabilité du Groupe A sur le moteur existant (`claude-haiku-5-5` / `claude-sonnet-5-5`), et geler formellement le Groupe B jusqu’à satisfaction complète du protocole de précision (`docs/claude/11-protocole-de-precision.md`).

## 2. Décision — Groupe A : correctifs de fiabilité retenus (règles inchangées)

1. **F8 — Pagination sur file mouvante (`src/TriGmail.gs`)** :
   - Dans `scanAvantTri_` et `scanCycliqueTri_`, l’index de page (`debutPage` et `DriveAI_TRI_CYCLIQUE_OFFSET`) n’avance plus de `fils.length`, mais uniquement du nombre de fils restés en boîte (`restants`, soit `r !== 'archive'`).
   - `scanAvantTri_` s’arrête dès `pageAJour || fils.length < CONFIG.PAGE_FILS_ACTIONS` ; `scanCycliqueTri_` gèle son offset si `!pageComplete` (`plafondAtteint()` ou `r === 'erreur'`), évitant ainsi de sauter des fils après archivage en cours de page.
2. **F9 — Garde pré-écriture sur libellé Gmail absent (`src/TriGmail.gs`)** :
   - Dans `trierFil_`, `decision = decisionTri_(...)` est calculée avant l’écriture `important|`, et chaque libellé requis dans `decision.libelles` qui n’est pas déjà posé (`!dejaPoses[nomLab]`) doit exister dans `libelles`.
   - En cas d’absence (`!lab`), le moteur journalise `'Libellé absent de Gmail (jamais créé par le moteur) : ...'` via `journalErreur_` et retourne `'erreur'` avant tout `important|`, `addToThread()`, `moveToArchive()` ou `indexAjouter_`. Aucun libellé n’est jamais créé ni retiré.
3. **F10 — Fils lus > 29 jours encore en boîte et retour en boîte (`src/Config.gs`, `src/TriGmail.gs`)** :
   - `CONFIG.TRI_ANCIENS_REQUETE` (`'in:inbox -is:unread older_than:29d'`) alimente `balayerBoiteAnciensLus_`, exécutée au plus une passe complète par jour (`DriveAI_TRI_ANCIENS_FINI_JOUR`) avant `nettoyerBoiteHistorique_`.
   - Elle partage `reliquatFondNonVivant_` (`PREFIXES_FOND_NON_VIVANT_` = `['DriveAI_TRI_BOITE', 'DriveAI_TRI_HISTO', 'DriveAI_TRI_ANCIENS']`) afin de préserver `TRI_FOND_RESERVE_VIVANT` (`150`) sous le plafond commun `TRI_FOND_MAX_FILS_JOUR` (`300`).
   - Dans `trierFil_`, les appels hors boîte (`trierHistoriqueArchive_`) utilisent la clé `cleHorsBoite` (`tri|<id>|<ts>|<lu|nonlu>|horsboite|<v>`) tandis que la boîte utilise `cleNominale`. Un fil déjà trié hors boîte qui revient en boîte (`isInInbox()`) est donc ré-évalué et archivé si `decision.archiver` vaut vrai, sans modifier les règles de classification.
4. **F11 — Détection des pannes/quotas Gmail et remontée `Suivi.gs` (`src/TriGmail.gs`, `src/Main.gs`)** :
   - `signalerPanneGmail_` est appelé dans `estPromoGmail_`, autour de `libellesUtilisateur_()` dans `trierFilsGmail_`, sur `isInInbox()` dans `trierHistoriqueArchive_`, sur les lectures de `trierFil_`, et **avant** `signalerPanneEcriture_` dans le bloc `catch (eEcriture)` des écritures Gmail.
   - `Main.gs` appelle `if (estPanneGmail_()) suiviSkip_('intake-gmail' / 'tri-gmail', 'quota Gmail épuisé')` pour refléter la suspension dans `Progression`. Dans `traiterGmail_`, un suivi `erreurFil` et un contrôle post-boucle (`coupe || estBudgetDepasse() || estPannePlateforme_() || estPanneGmail_()`) empêchent de marquer `fenetreAJour = true` après coupure ou erreur sur le dernier fil.
5. **F12 — Propagation `fileId` sur toutes les voies rapides (`src/Pipeline.gs`)** :
   - Dans `traiterDocument_`, `dec.fileId = idDup` (`_Doublons`), `decT.fileId = idT` (`_Technique`), `decM.fileId = idM` (`_Médias` direct), `decP.fileId = idP` (`_Médias` photo sans texte) et `decPh.fileId = idPh` (`_Médias` photo incertaine) sont renseignés avant `indexAjouter_`, rétablissant le dédoublonnage sur preuve REST (ADR-0077) pour les fichiers issus de Gmail et des partages (`shared|`).
6. **F13 — Robustesse LLM, compatibilité `DriveAI_GEMINI_KEY` absente et documentation moteur (`src/TriGmail.gs`, `src/Config.gs`, `src/Gemini.gs`, `src/Gmail.gs`, `src/README.md`)** :
   - `appelTriLlm_` journalise `stop_reason === 'refusal'` et `'max_tokens'` sans jamais exposer le corps du courriel (ADR-0007).
   - Les identifiants de modèles restent sur Anthropic 5.5 (`claude-haiku-5-5` / `claude-sonnet-5-5`), garantissant la continuité en production tant que `DriveAI_GEMINI_KEY` est absente (`sonderGemini()` échoue proprement sans basculer `DriveAI_LLM_PANNE`).
   - Les commentaires obsolètes mentionnant `gmail.readonly` sont remplacés par `gmail.modify`, et `src/README.md` inventorie l’ensemble des 38 modules `src/*.gs`.

## 3. Décision — Groupe B : évolutions gelées sous protocole de précision

Les trois évolutions suivantes restent **strictement gelées** (aucune modification du code de routage, de tri ni de modèle actif) tant que les prérequis du protocole de précision (`docs/claude/11-protocole-de-precision.md`) ne sont pas réunis :

1. **Traitement de `extraireTexte_ === null` en échec OCR (`src/Pipeline.gs:125`)** : aujourd’hui `extrait: extrait || ''` laisse le LLM classer d’après le nom et les métadonnées ; basculer vers `gererEchec_` ou `00 · À vérifier` modifie la décision de routage et interagit avec la future lecture multimodale (étape 9).
2. **Préservation du libellé existant au passage `nonlu → lu` sans `TriAppris` (`src/TriGmail.gs:1163-1167, 1299-1301`)** : vérifier `dejaPoses` contre `candidats` pour ne pas re-catégoriser un fil déjà étiqueté manuellement exige un audit comparatif sur des fils réels.
3. **Bascule des modèles vers Gemini (`src/Config.gs:20-21, 46`, étape 5 ADR-0073 / ADR-0074)** : le passage à `gemini-3.5-flash-lite` et `gemini-3.8-flash` (verrouillé par `test/gemini.test.js`) demeure bloqué jusqu’à ce que Marc pose `DriveAI_GEMINI_KEY` par `setProperties(obj, false)`, valide `sonderGemini()`, puis conduise l’audit comparatif sur ~20 documents réels (`DryRunV2`) et le ré-audit du tri (`action=audit-tri` via `auditerTriSujetCorpsDetail_`, incluant `TRI_HISTO_REQUETE` selon ADR-0076) avant un ADR dédié.

## 4. Impact quotas, coûts et risques

- **Coût supplémentaire** : **0 $** (aucun appel LLM ajouté sur le chemin nominal, aucun service payant ajouté).
- **Scopes OAuth** : inchangés dans `src/appsscript.json` (`test/scopes.test.js` vert).
- **Confidentialité (ADR-0007)** : aucune écriture du corps des courriels dans `Index`, `Journal` ou les propriétés.
- **Quotas Gmail** : `balayerBoiteAnciensLus_` est strictement borné par `reliquatFondNonVivant_`, ce qui garantit la réserve vivante `TRI_FOND_RESERVE_VIVANT` (150 fils/jour) à l’intérieur de `TRI_FOND_MAX_FILS_JOUR` (300 fils/jour) et la limite d’une passe complète par jour.

## 5. Alternatives écartées

- **Appliquer les règles Groupe B sans audit comparatif sur ~20 cas réels** : écarté — contraire à `docs/claude/11-protocole-de-precision.md` et susceptible d’introduire des régressions silencieuses sur le routage ou l’étiquetage Gmail.
- **Allouer un quota quotidien séparé pour `balayerBoiteAnciensLus_` hors `TRI_FOND_MAX_FILS_JOUR`** : écarté — risquerait de dépasser l’enveloppe commune définie par l’ADR-0076 et d’affamer le scan cyclique vivant.

## 6. Méthode de test et preuve attendue

- **Suites unitaires et garde-fous locaux (`c:\dev\DriveAI`)** :
  - `test/tri-gmail.test.js` (pagination `scanAvantTri_`, garde pré-écriture F9 et contre-épreuve `dejaPoses`, retour en boîte `horsboite`, `balayerBoiteAnciensLus_`, détection quota dans `estPromoGmail_` et écriture) ;
  - `test/pas-suspect.test.js` (`scanCycliqueTri_` sur file mouvante) ;
  - `test/quota-gmail.test.js` (`trierFilsGmail_` et `traiterGmail_` `erreurFil`) ;
  - `test/doublon-porteur.test.js` (propagation `fileId` sur les 5 voies rapides + dédup ADR-0077) ;
  - `test/tri-sujet-corps.test.js` (`stop_reason` `refusal` / `max_tokens`) ;
  - `test/gemini.test.js` (compatibilité avec `DriveAI_GEMINI_KEY` absente) ;
  - `test/audit-logique.test.js` (préparation d’audit en lecture seule).
- **Preuve attendue en production après fusion (`clasp push`)** : exécution nominale sans erreur dans `Journal` et `Progression`, aucun basculement intempestif en quarantaine lors d’un quota Gmail, et `Index` renseigné avec `fileId` sur les dépôts en voie rapide.
