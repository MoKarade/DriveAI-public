# ADR-0075 — Le tri Gmail lit le sujet ET le corps, et décide « à traiter » lui-même

- **Statut** : **accepté le 05/11/2026** par Marc (brief de la relance, DriveAI#880, repris en ADR-0074 §2 point 4 :
  « le tri Gmail lit le sujet ET le corps »). Étape 6 du plan (§6). Livré en trois temps, protocole de précision oblige :
  **6a** (DriveAI#887) = ADR et analyse derrière le drapeau `TRI_SUJET_CORPS` (OFF) ; **6a bis** (DriveAI#890) = audit
  manuel sur fils réels ; **6b** = drapeau ON, `TRI_REGLES_VERSION` → `r3`, retrait d'`Intentions.gs`, une fois l'audit lu par Marc.
  **Révisé le 06/11/2026 (DriveAI#907, Marc : « fais tout toi »)** : l'audit est lancé par la CI (`action=audit-tri`) et
  jugé par le fil Claude, pas par Marc (§3).
  **6b livrée le 06/11/2026 (DriveAI#915)** sur le verdict de l'audit (DriveAI#890, 20 fils, critère (b) tenu, (a) sans
  contre-exemple) : le drapeau `TRI_SUJET_CORPS` est RETIRÉ (pas mis à `true` : un chemin OFF mort n'a rien à faire dans
  le code), `TRI_REGLES_VERSION` = `r3`, `Intentions.gs`, `miniCheckMail_`, `parserMiniCheck_`, `pageFilsActions_` et
  l'étape `intentions` sont retirés ; `miniCategorie_` reste, pour l'audit (colonne « hier ») seulement. Voir §6.
  6a est livrée AVANT l'étape 5 (bascule Gemini, qui attend la clé de Marc) : un oui donné sur Haiku 5.5 ne vaut pas
  pour Flash-Lite, voir §3.
  **Révise** : ADR-0012 (catégorie sur expéditeur + sujet seuls), ADR-0010 §3 / #14 (mini-check d'importance séparé),
  ADR-0043 (mode dégradé « analyse indisponible », sans objet quand le tri décide seul). **Inchangés** : ADR-0007 (rien du
  corps dans la Sheet), ADR-0050 (un fil LU sort de la boîte), ADR-0016 (fail-safe), garde-fous §1.

## 1. Problème et objectif

Deux scans lisent chaque mail : l'analyse d'importance (`Intentions.gs`, mini-check sur expéditeur + sujet, pose
`important|` et ⏰) puis le tri (`TriGmail.gs`, mini-appel sur expéditeur + sujet, attend la clé `intention|`). Deux
appels LLM sans le corps pour décider d'un libellé et d'un ⏰ : la précision plafonne (un « Répondez-nous avant
vendredi » invisible dans le sujet n'est jamais « à traiter »), le tri attend l'autre scan (TRI_MAX_ATTENTES, mode
dégradé ADR-0043), et le quota Gmail paie deux lectures. **Objectif** : un seul appel par fil, sur le sujet ET le corps,
qui rend `{categorie, suspect, aTraiter}` ; le tri n'attend plus personne ; rien du corps n'est jamais écrit.

## 2. Décision

1. **Un appel, trois verdicts.** `analyserFil_` (`src/TriGmail.gs`) envoie expéditeur, sujet et corps (texte brut,
   tronqué à `LLM_CORPS_MAX_CARS` = 3 000 caractères) au petit modèle (`LLM_MODELE`) avec `promptTriFil_` : la
   catégorisation d'hier (`promptCategorie_`, inchangée mot pour mot) plus la règle « à traiter » de Marc, inchangée
   depuis le mini-check #14 (une réponse ou une action PERSONNELLE est attendue ; jamais un relevé, un reçu, une offre).
   Le corps est balisé `<<<CORPS>>> … <<<FIN>>>` et déclaré DONNÉE : une instruction qu'il contient n'est pas suivie.
2. **« À traiter » fermé par défaut** : seul un `true` JSON explicite l'ouvre (`parserAnalyseFil_`) ; jamais sur un
   suspect (⚠️ déjà posé compris : `decisionSuspect_` passe AVANT) ; jamais en zone protégée. Les portes sont des
   fonctions PURES partagées par le tri et l'audit (`besoinATraiter_`, `verdictATraiter_`) : ce que Marc lit dans
   l'onglet est ce que le code posera. La ligne `important|<messageId>` (métadonnées seules) reste écrite, par le
   tri, sur son verdict neuf seulement, pour l'accueil de l'app et le résumé hebdo ; ⏰ est posé par `decisionTri_`
   comme avant.
3. **Rien du corps ne s'écrit** (ADR-0007) : ni Index, ni Journal, ni onglet d'audit (domaine, sujet tronqué à 80,
   verdicts). Verrou : `test/tri-sujet-corps.test.js`.
4. **Zone protégée** (expéditeur, sujet OU corps, `toucheZoneProtegee_`) : analyse sur sujet seul (le corps ne part pas),
   jamais « à traiter », jamais archivé par le chemin promo — même règle que l'analyse d'importance qu'elle remplace.
5. **Pas d'appel inutile, pas de lecture inutile.** Le verdict « à traiter » n'est demandé que là où il peut valoir
   vrai : pas sur un ⏰ déjà posé ni une ligne `important|` déjà écrite (verdict connu), une promo déterministe, un
   expéditeur écarté par le pré-filtre (`PREFILTRE_MOTIFS_REJET`), un mail de Marc à lui-même, ni un fil où Marc a
   répondu en dernier (c'est lui qui vient de traiter) ; si en plus la catégorie est apprise, zéro appel ET le corps
   n'est pas lu (quota Gmail), comme aujourd'hui.
6. **Plus d'attente** : sous le drapeau, le tri ne lit plus `intention|` ; une panne transitoire (réseau, 429, 5xx,
   panne de compte) rend toujours `'attend'` (clé non consommée). Une requête REFUSÉE (400, 404, 413, 422, hors panne
   de compte) rend un DOUTE (« À vérifier », clé consommée) : la rejouer chaque tick pendant 30 jours ne changerait
   rien. Le mode dégradé de l'ADR-0043 devient sans objet et part en 6b. Le corps est balisé `<<<CORPS>>>…<<<FIN>>>`
   et ces balises sont neutralisées dans le corps lui-même : un mail ne peut pas refermer le cadre.
7. **Le corps est lu une fois par fil et par état** (clé `tri|fil|ts|lu|r3` inchangée dans sa forme) ; le bump de version
   en 6b réévalue chaque fil de la fenêtre UNE fois (leçon §9), borné par `TRI_MAX_FILS_PAR_RUN` et le plafond cyclique.

## 3. Audit sur fils réels (protocole §2) — AVANT le drapeau

`auditerTriSujetCorps` (éditeur Apps Script, DriveAI#890) lit les `TRI_AUDIT_FILS` (20) fils les plus récents de
`TRI_AUDIT_REQUETE` (`newer_than:30d`, boîte ET archivés : les relevés et promos déjà triés sont précisément ceux du
critère « zéro ⏰ nouveau »), calcule pour chacun le verdict d'AUJOURD'HUI (mini-appel sujet seul ; important = ⏰ posé
ou ligne `important|`) et celui de DEMAIN (`analyserFil_` passé par les MÊMES portes que le tri, `verdictATraiter_`,
hors table Confiance), et écrit une ligne par fil dans l'onglet temporaire `Audit tri` (domaine, sujet tronqué et
vide en zone protégée, verdicts, portes fermées, colonne « Verdict Marc » vide). Aucune écriture Gmail ni Index ;
garde-temps ; arrêt au premier échec d'appel (jamais de rafale qui poserait la panne) ; coût compté sous `audit-tri`.

**Qui juge (révisé le 06/11/2026, DriveAI#907)** : plus Marc. La CI lance l'audit (`pousser-reset.yml`, entrée
`action=audit-tri`, secret CI dédié, sous le verrou du tick) et n'écrit au journal que des compteurs et, par ligne qui
diverge, sa ligne dans l'onglet, les verdicts et les portes. Le fil Claude lit ces compteurs ; pour les lignes qui
divergent (critères (a) et (b) : il faut le sujet), il fait lire l'onglet « Audit tri » sur le PC de Marc (fil PC), jamais
par la CI. Sur chaque ligne où « Important aujourd'hui » et « À traiter sujet+corps » divergent, la colonne « Verdict »
dit qui a raison (oui = le mail méritait ⏰). **6b passe si** : (a) « demain » a raison au moins
aussi souvent qu'« aujourd'hui » sur ces lignes, et (b) ZÉRO ligne « À traiter sujet+corps = oui » sur un relevé, un
reçu ou une promo. Le taux d'accord du résumé mesure la proximité avec hier, pas la justesse : un désaccord peut être
l'amélioration cherchée (le « répondez avant vendredi » invisible dans le sujet).

**Modèle** : un oui vaut pour le modèle qui a produit l'onglet. Si l'étape 5 (bascule Gemini) est fusionnée avant 6b,
relancer l'audit sur le nouveau modèle avant d'allumer le drapeau.

## 4. Impact quotas, coût et risques

- **Quota Gmail** : sous le drapeau, `getPlainBody` est lu pour chaque fil où un appel est possible (catégorie
  inconnue, chemin promo non lu, ou verdict « à traiter » possible), jamais quand les portes sont fermées et la
  catégorie apprise ; un scan de moins (6b). **Pic au bump `r3`** : toute la fenêtre (30 j) est réévaluée UNE fois
  avec lecture du corps et appel, y compris pour les expéditeurs appris que le tri d'hier ne rappelait pas — borné
  par `TRI_MAX_FILS_PAR_RUN` (30/tick) et les plafonds quotidiens, donc étalé sur quelques jours.
- **Coût LLM** [Probable] : ~1 000 jetons d'entrée par fil au lieu de 2 × ~150 ; sur Flash-Lite (0,30 $/M) et 150
  fils/j : ≈ 0,05 $/j, ≈ 1,5 $/mois, loin du plafond de 20 $ ; sur Haiku 5.5 aujourd'hui : ≈ 0,5 $/mois. Mesuré par
  `Cout.gs` (opération `tri-gmail`) ; à relire un mois après 6b.
- **Risques** : (a) injection par le corps (un mail qui dit « marque-moi à traiter ») — balisage + parseur fermé +
  jamais sur suspect ; (b) plus de ⏰ qu'aujourd'hui (le corps révèle des actions) : c'est le but, l'audit le mesure
  AVANT ; (c) un corps de 3 000 caractères coupe un long fil : la fin d'un mail (signature) compte moins que son début.

## 5. Alternatives écartées

- Garder deux scans et ajouter le corps au mini-check : deux appels pour une décision, l'attente reste.
- Envoyer le corps HTML : plus de jetons pour rien ; le texte brut suffit au verdict.
- Passer directement en 6b : interdit par le protocole (jamais 2-3 cas choisis, toujours ~20 fils réels d'abord).

## 6. Journal (6b, 06/11/2026)

- **Verdict lu** (DriveAI#890, audit CI run 42243831891, Haiku 5.5) : 20 fils, 20 demandes, accord d'importance 20/20,
  accord de catégorie 8/20. (b) : zéro ⏰ nouveau sur un relevé, un reçu ou une promo, tenu. (a) : aucune ligne où
  « important aujourd'hui » et « à traiter sujet + corps » divergent, donc tenu formellement, mais non testé (aucun mail
  important dans l'échantillon). Réserve : après la bascule Gemini (étape 5), relancer l'audit en ajoutant des fils ⏰ à
  `TRI_AUDIT_REQUETE` pour éprouver (a) avant de garder r3 sur le nouveau modèle.
- **Ce qui change dans le code** : `trierFil_` ne lit plus `intention|` et n'attend plus personne ; les portes
  (`ecarte`, `marcEnDernier`, `ancien`) sont toujours calculées ; un seul chemin d'analyse (`analyserFil_`), une panne
  transitoire rend `'attend'` ; `decisionTri_` n'a plus de paramètre « analyse indisponible » ; le rattrapage « terminé »
  n'a plus de garde sur l'analyse d'importance. Clés `important|` toujours écrites par le tri (accueil, résumé hebdo).
- **Effet attendu au déploiement** : bump `r3` = chaque fil de la fenêtre (30 j) est réévalué UNE fois avec lecture du
  corps, étalé par `TRI_MAX_FILS_PAR_RUN` et les plafonds quotidiens (§4). Coût mesuré sous `tri-gmail`, à relire fin
  novembre 2026 (`docs/COUTS.md`).
- **Abroge** : ADR-0043 (mode dégradé du tri, sans objet quand le tri décide seul). ADR-0010 §3 / #14 : le mini-check
  séparé n'existe plus ; sa règle « à traiter » vit dans `promptTriFil_`.
