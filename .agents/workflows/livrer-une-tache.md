---
description: Livrer une tâche DriveAI de bout en bout (issue, branche, PR, vert, preuve « Acceptée »)
---

# /livrer-une-tache — du besoin à la preuve

Règle qui fait foi : `docs/cycle-de-vie-tache.md` du dépôt MoKarade/.github. Résumé opérationnel :

1. **L'issue** : une tâche `niveau:tâche` rattachée à la mission ouverte (sous-issue), corps Avant / Après /
   **Fini quand (exécutable : une commande et son résultat attendu)** / Fichiers touchés / Source / Attend (numéro de
   TÂCHE, jamais de PR). Pose l'étiquette `en-cours` avant la première PR. Ne prends jamais une issue `qui:marc`,
   `bloqué`, `jules` ou `preuve-attendue`. Un bug trouvé en chemin devient SA propre issue, jamais corrigé dans la PR en cours.
2. **La branche** : `git fetch origin main && git checkout -B <prefixe>/<slug> origin/main`. Jamais de push sur `main`.
3. **Coder** : petit et ciblé, dans les « Fichiers touchés » annoncés ; commit à chaque étape validée, message en français
   préfixé (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`), avec `(#<issue>)`. Doc touchée dans la même PR.
   Changement de classement ou de tri : protocole de précision AVANT (`docs/claude/11-protocole-de-precision.md`).
4. **Gate** : `/gate`, tout vert, puis `git push -u origin <branche>`.
5. **La PR** : en brouillon, base `main`, titre au verbe préfixé ; corps avec `Tâche : #<n>` (obligatoire, le Garde-fou
   rougit sans), Avant / Après / Comment / Fini quand. **Jamais** `Closes`, `Fixes` ni `Resolves`. Assigner MoKarade.
6. **Vert** : la CI tourne sur le robot du PC de Marc (dépôt privé) ; PC éteint = la PR attend. Rouge = priorité
   absolue : reproduire, corriger, pousser (« instable » n'est pas une cause). CI verte → sortir du brouillon ; Mergify
   fusionne en squash si le Garde-fou est vert (chemins protégés rouges = Marc fusionne). Taille > 400 lignes hors tests =
   étiquette `derogation-taille` accordée par Marc, puis relancer le job Garde-fou.
7. **Preuve** (la tâche n'est finie qu'ici) : si `src/` a changé, le job « Déploiement — clasp push (Apps Script) » de
   `deploy.yml` doit être vert sur le commit fusionné ; LIRE ensuite le « Fini quand » en production (Journal, Santé,
   réponse réelle), puis écrire sur l'issue, à ce format exact, et la fermer `completed` :
   `**Acceptée** — PR #p fusionnée (<sha court>), déploiement READY (<run id>), preuve : <ce qui a été LU et le résultat>`
   (sans code servi : `sans déploiement : <raison>`). Un doute (« probable », « pas lu ») n'est pas une preuve : l'issue
   serait rouverte `preuve-manquante`. Impossible à lire tout de suite (geste de Marc, cron) : étiquette `preuve-attendue`
   + ligne `**Preuve attendue** : AAAA-MM-JJ HH:MM (heure du Québec) — événement`, sans fermer.
8. **Rendre compte** à Marc en 1 à 3 lignes : ce qui change pour lui, le lien, la preuve, ce qui reste ou ce qu'il doit
   faire (heures du Québec). Un geste de Marc = issue `qui:marc` avec « Geste : … » en commentaire.
