# Rattachement de DriveAI à l'Atelier

> Caduc depuis le 15/10/2026 : l'Atelier est arrêté. Le travail passe par une PR par tâche, les tests sur le robot du PC de Marc et la fusion par Mergify. Gardé comme historique.

- Chef de projet : `atelier-chef` (DriveAI n'a pas de session propre dans l'agence ; `atelier-git` y travaille depuis l'Atelier, dans un worktree de `origin/main`).
- Dernières PR : garde de chemins de l'auto-merge (#422, sécurité) ; structure commune allégée (CLAUDE.md court, INDEX, ignoreCommand Vercel, couts-ci.md), brouillon.
- Prochaine étape : mesurer les minutes Actions (gratuites ici) et décider avec Marc d'un ruleset sur `.github/**`.
- Dépôt PUBLIC, branche par défaut `main`, sans protection de branche ; auto-merge propre au dépôt (`workflow_run`), NON remplacé par le kit de l'Atelier.
- Décision de Marc en attente : nettoyage éventuel de l'historique git public (4 passages personnels de l'ancien CLAUDE.md).
