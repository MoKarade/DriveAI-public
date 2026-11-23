# Coûts CI — DriveAI

**Dépôt PRIVÉ** (`gh api repos/MoKarade/DriveAI` : `private`, re-vérifié le 29/09/2026 par gerant —
corrige la mesure du 26/09/2026 ci-dessous, qui disait `isPrivate: false` et était donc FAUSSE ou
périmée ; ce fichier avait fait suivre l'erreur telle quelle). Branche par défaut réelle **main**
(le checkout local `C:\dev\DriveAI` est sur une branche `claude/`, à ignorer).
GitHub Actions **COMPTE les minutes** sur un dépôt privé (2 000/mois en GitHub Free, partagées
entre tous les dépôts privés du compte — cf. `C:\dev\CLAUDE.md` §Économie de tokens de l'Atelier,
« épuisées le 23/09 »). L'objectif de coût des autres dépôts S'APPLIQUE ici. Modèle :
`modeles/couts/couts.md` de l'Atelier. Les coûts LLM de l'app sont dans `docs/COUTS.md`.
⚠️ Les lignes « Exceptions au gabarit » ci-dessous supposaient encore la prémisse PUBLIQUE ;
corrigées à leur tour ci-dessous (source : `COPIES.md`, racine du dépôt).

## Où tournent les contrôles (choix de Marc, 18/11/2026)
- **Machines GitHub par défaut** (`ubuntu-latest`) ; la variable de dépôt `RUNNER_CI` = `pc` ramène `ci.yml`, `garde-fou.yml`, `impact.yml`, `reacteur.yml`, `graphe.yml`, `preuve-miroir.yml` et `sentry-essai.yml` sur le robot du PC, sans PR. Depuis le 19/11/2026 (choix de Marc), `deploy.yml` et `pousser-reset.yml` tournent aussi sur `ubuntu-latest` par défaut (`RUNNER_CI` = `pc` pour revenir au PC).
- **Quota** (lu le 18/11/2026 sur la page de facturation de Marc) : GitHub Pro, 3 000 minutes Actions/mois partagées entre tous ses dépôts privés ; budget Actions à 0 $, « Usage blocked » : au quota les jobs s'arrêtent, rien n'est facturé. Aucune ligne d'usage hébergé en novembre à cette date.
- **Coût d'un run** [Supposition, calculé sur les durées du robot du 10/11/2026] : ≈ 18 minutes (11 jobs arrondis à la minute), ≈ 50 par PR fusionnée (run de PR, file de fusion, push sur `main`). À mesurer sur la page d'usage après quelques PR ; quota épuisé = `RUNNER_CI` = `pc`.
- **En suspens** : « Sécurité commune » (OSV, zizmor, gitleaks) et « Conformité » viennent de MoKarade/.github, qui choisit le PC pour un dépôt privé et n'a pas d'entrée `runner` ; ils ne sont pas requis (ruleset et Mergify), mais restent en file si le PC est éteint. À faire : ajouter l'entrée là-bas, puis repiner `ci.yml`.

## Runs GitHub Actions (information)
Mesure : `node modeles/couts/compter-runs.mjs MoKarade/DriveAI 2026-09` (lecture seule ; liste limitée à 1 000 runs : le mois peut être incomplet ; la durée de calendrier compte l'attente et n'est pas une facturation) :

| Workflow | Déclencheurs | Runs en 09/2026 (mesuré) | Échoués | Rôle |
|---|---|---|---|---|
| Auto-merge | workflow_run 238 | 238 | 0 | Fusion automatique (propre au dépôt, NON modifié par cette PR ; garde de chemins : #422). |
| CI | pull_request 182, push 47 | 229 | 11 | Validation, tests moteur, app, captures, qualité, sécurité. |
| Deploy | push 47, dispatch 54 | 101 | 6 | `clasp push` du moteur. NON touché. |
| Sync Drive (miroir NotebookLM) | push 47, dispatch 52 | 99 | 15 | Miroir Drive ABANDONNÉ (2026-09-28) : workflow désactivé, suppression à part. |
| Dependabot Updates | dynamique 19 | 19 | 0 | Mises à jour. |

## Crons
- Aucun cron GitHub Actions dans `ci.yml` ni `auto-merge.yml` (événementiel).

## Exceptions au gabarit
| Quoi | Raison | Condition de retour |
|---|---|---|
| ~~Dépôt PUBLIC : pas de kit d'auto-merge...~~ **PÉRIMÉ** — Dépôt PRIVÉ : kit d'auto-merge de l'Atelier **1.9.1**, profil **prive** ADOPTÉ (`COPIES.md`, depuis le 2026-09-28) : `fusionner.mjs` fusionne (pas d'armement natif en dépôt privé Free) ; `.github/workflows/armement-auto-merge.yml` du kit délibérément NON copié pour cette raison | Le dépôt était privé dès l'adoption du kit ; cette ligne du gabarit datait d'avant et n'avait pas suivi | aucune — déjà fait |
| Pas de voie rapide « docs seules » dans la CI | La condition de retour ci-dessous est ATTEINTE (dépôt privé, minutes comptées) mais l'adoption n'a pas suivi : `.github/ci/voie-rapide.mjs` existe comme gabarit dans le kit de l'Atelier (`COPIES.md` : « hors lot, non copié ») — une vraie économie de minutes disponible, pas encore prise | Condition remplie le 2026-09-28 (passage en privé), jamais revérifiée depuis | Décision de Marc/gerant : adopter `voie-rapide.mjs` (même rigueur que l'adoption du kit auto-merge — hors périmètre de cette correction de doc) |
| Actions non épinglées par SHA (`@v7`) | Hors périmètre du lot allégé | PR dédiée (comme Hubperso#87) |
| `docs/COUTS.md` existe déjà (coûts LLM) : le modèle s'appelle ici `docs/couts-ci.md` | Deux noms qui ne diffèrent que par la casse se percutent sous Windows | aucune |
| `ignoreCommand` Vercel ajouté (`.github/ci/ignore-command.mjs`) | Absent avant ; pas de préversion pour PR de docs seules ni dependabot, production jamais sautée, build en cas de doute ; depuis #494 (2026-10-16) seule `main` se déploie (`git.deploymentEnabled` : `**` et `*` coupés, `main` activé), donc aucune branche n'a de préversion ; l'`ignoreCommand` reste le filet pour `main` | aucune |
| 4 passages personnels de l'ancien CLAUDE.md sortis du dépôt (lignes 1150, 1335 à 1338, 1433, 1454 de l'ancien fichier) | Dépôt public : mentions de documents d'identité de Marc ; remplacés par une ligne neutre, texte gardé dans une liste privée hors git | Décision de Marc sur l'historique git (les passages y restent) |
