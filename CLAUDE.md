# CLAUDE.md — DriveAI

<!-- Court exprès (60 lignes, 10 Ko, verrous `test/structure-doc.test.js` et `.github/ci/verifier-longueur.mjs`). Le texte complet de l'ancien fichier (1784 lignes, 163 Ko) est dans docs/claude/ ; « CLAUDE.md §N » dans le code, les tests et les ADR
     = docs/claude/NN-*.md (numérotation inchangée : §1 = garde-fous, §9 = leçons, §11 = protocole). Rien de personnel ni de secret ici (le dépôt a été public). -->

## Contexte
- **DriveAI** range Google Drive tout seul : pièces jointes utiles des mails et fichiers déposés sont analysés par un LLM, renommés selon une convention stricte, classés dans une arborescence granulaire ; une file de revue pour les cas incertains.
- Stack : Google Apps Script (moteur, `src/*.gs`, déployé par clasp) + une Google Sheet (état) + app web React/Vite/TS sur Vercel (`app/`). LLM via l'API Anthropic ; le modèle qui fait foi est `CONFIG`.
- Dépôt privé, branche par défaut `main` ; chaque merge déploie le moteur chez Marc (`deploy.yml`). Marc valide, il ne code pas.
- État : `HANDOVER.md` (à lire en premier) ; plan : `PLAN.md` et les issues du dépôt (`BACKLOG.md` n'est qu'un renvoi) ; décisions : `docs/`.

## Commandes standard
- `npm test` (racine) : filet de tests du moteur (`node --test`, zéro dépendance). Dans `app/` : `npm run dev`, `npm run build`, `npm run test`, `npm run portes`.
- `bash .github/scripts/secret-scan.sh .` : scan de secrets ; `bash .github/scripts/check-structure.sh .` : fichiers de référence présents.
- Commandes des agents : `/phase`, `/review`, `/lesson`, `/handover`, `/ship` (`docs/claude/04-commandes.md`).

## Règles propres à DriveAI (garde-fous : `docs/claude/01-principes.md`, §1)
- **Documents sensibles : classés, jamais supprimés ni détachés** ; revue ultra-stricte seulement. **Aucune suppression automatique** (doublons écartés dans `_Doublons`, déplacement seul).
- **Moindre privilège** : scopes déclarés dans `appsscript.json`, Gmail en `gmail.modify` limité à poser un libellé existant et à archiver (`docs/claude/01-principes.md`, §1, point 3). **Aucun secret en dur** (Script Properties).
- **Idempotence** : un fichier déjà traité ne l'est pas deux fois. Budget LLM < 10 $/mois ; le coût publié au hub est le CUMUL.
- **No fake data** ; une modification du routage ou du tri suit le protocole de précision (`docs/claude/11-protocole-de-precision.md`).
- Après un merge : vérifier le **déploiement**, pas seulement la CI (`docs/claude/06-deploiement.md`). Les leçons durables : `docs/claude/lecons.md` (§9).

## Git et CI
- Branches `claude/<slug>` ; PR en brouillon pour itérer ; commits en français, préfixés ; jamais `--force` sur `main`, jamais `--no-verify`. **`gh pr create --base main` TOUJOURS explicite.**
- Mergify (configuration ajoutée le 15/10/2026) fusionne en squash une PR sortie du brouillon quand tous les contrôles sont verts. Une PR qui touche `.github/`, `scripts/hooks/`, `qualite/`, `vercel.json`, `drizzle/` ou `.env*` est fusionnée aussi quand le contrôle « Garde-fou » est vert (oui de Marc, 15/10/2026) ; rouge (test retiré ou sauté, seuil baissé, secret, migration destructive, `.mergify.yml` ou garde-fou modifié), elle attend Marc (issue `qui:marc`).
- ⚠️ Le moteur (`src/**`, `*.gs`), clasp et les instructions des agents, que gardait l'ancien `garde-chemins.mjs` (disparu), ne sont pas dans cette liste : leurs PR fusionnent seules.
- Un check requis n'a JAMAIS de `paths:`.

## Pour aller plus loin (à lire seulement si nécessaire)
- Index généré : `docs/INDEX.md` ; anciens titres -> chemins : `docs/correspondance.md`.
- Sections de l'ancien fichier : `docs/claude/` (`01-principes`, `02-conventions`, `03-workflow-git`, `04-commandes`, `05-verifications`, `06-deploiement`, `07-hub`, `08-documentation`,
  `10-style-compte-rendu`, `11-protocole-de-precision`). Leçons apprises : `docs/claude/lecons.md`.
- Coûts : CI (robot de tests du PC de Marc) `docs/couts-ci.md` ; coûts LLM `docs/COUTS.md`. Rattachement : `docs/rattachement.md`.
- Graphe de code (hooks et MCP `graphify` posés, 0 jeton ; `scripts/graphe.sh query|affected|path|explain` avant de grepper, `scripts/graphe.sh moteur …` pour le moteur `.gs`) : `docs/claude/12-graphe-code.md`.

## CI (dépôt privé)
Depuis le 18/11/2026 (choix de Marc), la CI des PR tourne sur les machines GitHub (`ubuntu-latest`, minutes du plan Pro : 3 000/mois partagées entre les dépôts privés, budget Actions à 0 $ donc jamais de facture) ; la variable de dépôt `RUNNER_CI` = `pc` ramène les contrôles sur le robot du PC (`[self-hosted, pc-marc]`), sans nouvelle PR. Un robot du PC ne doit jamais servir une PR d'un dépôt public. Depuis le 19/11/2026 (choix de Marc), `deploy.yml` et `pousser-reset.yml` suivent aussi cet interrupteur (`ubuntu-latest` par défaut, `RUNNER_CI` = `pc` pour revenir au PC). Les contrôles communs « Sécurité commune » et « Conformité » (MoKarade/.github) choisissent encore le PC : non requis, en suspens (`docs/couts-ci.md`).

## Compte-rendu
Règles de forme : instructions du projet « Apps ». Copie lisible à la demande dans `docs/COMPTE-RENDU.md` (non chargée à chaque session ; sa synchro reste vérifiée par la CI).
