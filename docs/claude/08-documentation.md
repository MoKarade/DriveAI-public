<!-- Extrait de l'ancien CLAUDE.md (§ 8. Documentation (où vit quoi)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Documentation (où vit quoi)

## 8. Documentation (où vit quoi)

| Fichier | Contenu |
|---|---|
| `HANDOVER.md` | **L'état RÉEL** : chantier en cours, ce qui tourne, ce qui attend un geste de Marc. À lire en premier pour reprendre. |
| `BACKLOG.md` | Un renvoi vers les issues du dépôt, où vit le reste à faire (une tâche = une issue `niveau:tâche`). |
| `PLAN.md` | Le découpage en phases et le « pourquoi » de chacune. |
| `docs/adr/` | Les décisions architecturales, `NNNN-slug.md`. Obligatoire AVANT toute modif du classement (§11). |
| `docs/ARCHITECTURE.md` | Comment les morceaux tiennent ensemble : moteur, Sheet, app, broker. |
| `docs/TAXONOMY.md` | L'arborescence cible et ses règles. |
| `docs/NAMING.md` | La convention de nommage des fichiers classés. |
| `docs/COUTS.md` | Tout ce qui coûte quelque chose, et la ventilation par usage. |
| `docs/DEPLOIEMENT.md` · `docs/RUNBOOK.md` | Déployer, et quoi faire quand ça casse. |
| `docs/LESSONS.md` | Le journal brut des leçons ; les règles durables remontent en §9. |
| `docs/WORKFLOW.md` · `docs/GUIDE.md` | La flotte d'agents, le guide d'usage (le serveur MCP et `docs/MCP.md` sont retirés depuis l'ADR-0074). |

La structure est commune aux huit dépôts du hub — elle est fixée dans
[`conventions/STRUCTURE-DEPOT.md`](https://github.com/MoKarade/claude-config/blob/main/conventions/STRUCTURE-DEPOT.md)
du dépôt `claude-config`, et nulle part ailleurs.

⚠️ **L'état courant ne s'écrit PAS dans ce fichier.** Il a porté « **Phase courante : 0 —
scaffolding & automatisation. Le moteur Apps Script (Phase 1) n'est pas encore écrit** » jusqu'au
2026-08-20, alors que le moteur tournait toutes les 5 minutes sur plus de 16 000 documents depuis
des semaines et qu'on venait d'y merger de la comptabilité de coûts. Personne ne l'a vu : un
fichier chargé à CHAQUE session est aussi un fichier que plus personne ne relit. L'état vit dans
`HANDOVER.md`, qui a un rituel de mise à jour (`/handover`, hook `Stop`) ; `CLAUDE.md` ne porte que
ce qui reste vrai d'une session à l'autre.
