# ADR-0074 — Relancer DriveAI sur une base épurée : trois fonctions, Gemini, et le terrain pour Antigravity

- **Statut** : **accepté le 05/11/2026** par Marc (brief du 05/11/2026 dans le fil « Relancer DriveAI sur une base
  épurée », puis ses dix-neuf réponses de cadrage, 16:21Z). Mission DriveAI#880, première tâche DriveAI#881.
  **Amont** : ADR-0059, 0061, 0063, 0064, 0065, 0066, 0068 (le canal vers la Mémoire, que cet ADR retire) ; ADR-0045
  (inventaire FinanceAI, jamais codé, abandonné ici) ; ADR-0042 (connecteur MCP) et ADR-0069 (LIA), retirés par la
  PR suivante ; ADR-0067 (modèles 5.5), remplacé par la bascule Gemini. Le numéro **0073** est réservé à l'adaptateur
  Gemini (PR DriveAI#873 du 02/11/2026, fermée sans fusion, à reprendre : sa branche porte déjà l'ADR et ses tests).
  Analyse et plan : `/mnt/project-files/driveai/2026-11-05_relance-epuree-analyse-plan-questions.md` (projet Apps).

## 1. Problème et objectif

Au 05/11/2026 le moteur fait 59 modules Apps Script (≈ 35 400 lignes) pour un produit qui s'est élargi d'un mois sur
l'autre : l'alimentation de MemoryAI (inventaire, pièces, audit, périmètre, rattrapage, vision, Messenger, deux
relectures, agenda, avancement), un serveur MCP, le relais de LIA, les intentions vers Tasks et Calendar, un inventaire
pour FinanceAI jamais livré. Chaque ajout a pris du budget quotidien (54 des 63 min/j de l'enveloppe allaient à
l'audit des pièces), du runtime, des lignes de Santé (26) et des écrans. Pendant ce temps la précision du rangement
n'a pas été re-mesurée depuis l'ADR-0052, et le tri Gmail lit encore l'expéditeur et le sujet seulement.

Marc coupe les coûts depuis le 02/11/2026 : Vercel bloque les apps jusqu'au 03/12 (dépassement du CPU gratuit),
MemoryAI et le hub sont retirés du paysage, Claude Max n'est pas reconduit. La suite de l'écosystème se construit
dans Antigravity (IDE agentique de Google) avec Firebase ; DriveAI reste sur Apps Script parce que c'est le seul
moteur qui tourne sans serveur et sans coût, et qu'il garde l'accès natif à Gmail et au Drive.

**Objectif** : un moteur qui ne fait plus que trois choses, et les fait mieux : (a) traiter les mails entrants et
leurs pièces jointes, (b) trier Gmail nativement, (c) ranger le Drive, automatiquement et à la main. Tout le reste
sort. Le LLM devient Gemini, payant, derniers modèles. Le dépôt est préparé pour qu'Antigravity le reprenne.

## 2. Décision

1. **Trois fonctions, rien d'autre.** Sortent du moteur, du dépôt et de l'app : le canal vers la Mémoire (cette PR :
   `Memoire.gs`, `Piece.gs`, `PieceVision.gs`, `AuditPiece.gs`, `AuditVision.gs`, `PerimetrePiece.gs`,
   `RattrapagePiece.gs`, `HistoriqueImport.gs`, `EnvoiMessenger.gs`, `RelecturePiece.gs`, `RelectureImage.gs`,
   `TroisiemeLecture.gs`, `AgendaMemoire.gs`, `AvancementMemoire.gs`, les onglets Lecture et Audit de l'app) ; le
   serveur MCP, le chat à outils et le relais LIA (PR suivante) ; les intentions, Tasks, Calendar et l'onglet Agenda
   (PR dédiée) ; l'inventaire FinanceAI (ADR-0045 abandonné, jamais codé). Dans l'app ne restent que le contrôle du
   moteur, l'explorateur et la recherche du Drive, l'assistant de réorganisation et la gestion des corrections.
   Un retrait n'efface aucune donnée : les onglets Sheet déjà créés restent, le moteur cesse seulement de les créer
   et de les remplir.
2. **Gemini remplace Anthropic, entièrement.** Appels par `UrlFetchApp` (aucun nouveau scope OAuth), clé dans la
   Script Property `DriveAI_GEMINI_KEY` posée par Marc (jamais par un fil, jamais cherchée dans un coffre), palier
   PAYANT (le palier gratuit réutilise les requêtes et exclut les données personnelles), budget de 20 $/mois.
   Modèles : les derniers (au 05/11/2026 : `gemini-3.8-flash` et `gemini-3.5-flash-lite` ; `gemini-2.5-*` est
   déprécié et redirigé dès le 01/12/2026). Sortie JSON native (`responseMimeType` et `responseSchema`), l'analyse
   défensive gardée en filet. `Cout.gs` porte la grille de prix pour que `LLM_BUDGET_CAMPAGNES` reste exact.
   L'adaptateur est celui de DriveAI#873 (ADR-0073), sans outils (le chat à outils part avec le MCP).
3. **Le rangement du Drive devient le cœur.** Lecture multimodale native (PDF et images envoyés à Gemini quand le
   texte OCR est pauvre ou le fichier sous la limite) ; dédoublonnage infaillible (`_Doublons` seulement sur taille
   ET `md5Checksum` ou contenu réel, deux quasi-homonymes de contenu différent ne sont jamais fusionnés) ; zéro
   atterrissage à la racine d'un domaine (invariant D1 de l'ADR-0052, mesuré avant d'être durci, choix de structure
   soumis à Marc en QCM) ; nommage `AAAA-MM-JJ_Type_Émetteur.ext` avec recoupement des dates (document, nom
   d'origine, réception) ; détection et proposition de fusion des dossiers en double ou orphelins. Un gros
   nettoyage initial, puis l'automatique. Chaque changement de routage ou de tri passe par le protocole de
   précision sur un échantillon réel (`docs/claude/11-protocole-de-precision.md`).
4. **Le tri Gmail lit le sujet ET le corps**, sans jamais persister le corps (ADR-0007), pose uniquement des
   libellés existants, couvre tout l'historique (lus, archivés, sans libellé) par balayage cyclique sous un seul
   plafond quotidien qui n'affame jamais l'intake des pièces jointes récentes. Garde-fous inchangés : aucune
   suppression de mail ni de fichier, aucun retrait de libellé, `04 · Immigration` sanctuarisé, idempotence par
   l'onglet `Index`.
5. **Le terrain pour Antigravity.** Le dépôt gagne `AGENTS.md`, `.agents/rules/` et des workflows lisibles par
   Antigravity (dernière PR du plan) ; la documentation dit où tout vit pour qu'un agent reprenne sans fil Claude.
   Firebase (plan Spark seulement ; Blaze = oui écrit de Marc) reçoit ce qui a besoin d'un serveur, plus tard.
6. **Les budgets ne grandissent pas.** Les 62 min/j libérées par le canal Mémoire (54 audit, 8 inventaire) ne sont
   pas réallouées d'office : la réconciliation Index↔Drive reprend ses 11 min prêtées (1 → 12), les 51 autres
   retournent à la marge. Chaque campagne neuve (tri historique, doublons, fusions) les prendra par son nom, dans sa
   PR, en remontant l'enveloppe verrouillée par `test/orchestration.test.js` (12 min/j après cette PR).

## 3. Ce que cette décision ne règle pas

- La clé Gemini et le compte de facturation sont des gestes de Marc : tant qu'ils ne sont pas faits, la bascule (étape 5
  du plan ; l'adaptateur de l'étape 4 ne change aucun modèle) reste en brouillon et le moteur tourne sur Anthropic.
- Les preuves en ligne de l'app et de `api/` attendent la levée du blocage Vercel (03/12/2026) ; le moteur Apps
  Script n'est pas touché par ce blocage.
- Les données déjà envoyées à MemoryAI ne sont pas rappelées : c'est MemoryAI (retirée) qui les porte.
- Les leçons (`docs/claude/lecons.md`, `docs/LESSONS.md`) gardent les récits des modules retirés : c'est de
  l'histoire, pas un état.

## 4. Impact quotas, coût et risques

- **Runtime** : moins d'étapes dans le tick (audit, vision, rattrapage, périmètre, inventaire, Messenger, trois
  relectures, agenda, historique d'import) et 12 lignes de Santé au lieu de 26 : une écriture Sheet plus courte par
  tick, aucune lecture de Property pour les campagnes retirées.
- **Coût LLM** : les lectures de pièces (Haiku puis Sonnet, jusqu'à 100 $ de plafond vision) disparaissent ; après la
  bascule, Gemini 3.8 Flash coûte 0,75 $ / 3,75 $ par million de jetons jusqu'au 31/12/2026 (puis 1,50 $ / 7,50 $),
  3.5 Flash-Lite 0,30 $ / 2,50 $ ; le frein mensuel passe à 20 $ et il est mesuré, jamais estimé.
- **Risque** : une fonction retirée qui serait encore appelée en travers d'un module. Filet : `test/surface-moteur.test.js`
  charge tout le moteur ; l'inventaire des étapes et des budgets (`test/orchestration.test.js`) refuse une constante ou une
  étape orpheline ; la revue de flotte passe sur chaque PR.

## 5. Alternatives écartées

- **Réécrire DriveAI dans AI Studio ou Firebase** (plan du 02/11/2026) : perd l'accès natif à Gmail et au Drive sans
  serveur, et tout ce que les 72 ADR ont appris. Remplacé par cette relance en place.
- **Garder le canal Mémoire éteint derrière des flags** : les flags restent du code à tester, des budgets dans
  l'enveloppe et des lignes de Santé. Un code éteint qu'on ne relira plus est du poids, pas une option.
- **Palier gratuit de Gemini** : exclu par ses conditions (réutilisation des requêtes, revue humaine, pas de données
  personnelles).

## 6. Plan (une PR par tâche, mission DriveAI#880)

1. Cet ADR et la purge du canal Mémoire (DriveAI#881). 2. MCP, chat à outils, LIA, inventaire FinanceAI. 3. Intentions,
Tasks, Calendar, onglet Agenda (avant l'adaptateur : `extraireIntentions_` appelle le modèle, le porter vers Gemini pour le
supprimer ensuite serait du travail perdu). Précision du 05/11/2026 (DriveAI#885) : `Intentions.gs` n'est PAS supprimé à cette
étape, il est réduit à l'analyse d'importance (mini-check → libellé ⏰ « À traiter », clé `important|`) parce que l'archivage du
tri Gmail et l'accueil de l'app en dépendent ; la règle de décision du tri ne change pas. L'étape 6 absorbe cette analyse dans
le tri sujet + corps, sous le protocole de précision ; ne pas « finir le travail » avant. 4. Adaptateur Gemini (reprise de #873, ADR-0073). 5. Bascule de la
classification et retrait de la clé Anthropic (audit sur 20 documents réels). 6. Tri Gmail sujet + corps en JSON structuré.
7. Tri de l'historique complet sous plafond unique. 8. Doublons par taille et MD5 REST, preuve écrite. 9. Lecture
multimodale. 10. Dates et nommage. 11. Mesure puis durcissement de la racine zéro (QCM à Marc). 12. Fusions de
dossiers proposées dans l'app. 13. Docs et terrain Antigravity.
