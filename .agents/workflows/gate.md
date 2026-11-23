---
description: Lancer le gate complet du moteur DriveAI (et de l'app si touchée) avant tout push
---

# /gate — vérifier avant de pousser

Depuis la racine du dépôt. Un seul échec = pas de push. Jamais un test sauté, jamais un seuil baissé.

1. Syntaxe des modules Apps Script :
   `npm run lint`
2. Tests du moteur (attendu au 06/11/2026 : 1 497 tests, 0 échec) :
   `node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"`
3. Couverture du moteur (seuil 86 %, cliquet : ne redescend jamais) :
   `node .github/ci/couverture-moteur.mjs`
4. Index de la documentation à jour (sinon `node .github/ci/generer-index.mjs` le réécrit) :
   `node .github/ci/generer-index.mjs --verifier`
5. Longueurs plafonnées (`CLAUDE.md` ≤ 60 lignes, `HANDOVER.md` ≤ 300 lignes) :
   `node .github/ci/verifier-longueur.mjs`
6. Aucun secret, structure du dépôt complète :
   `bash .github/scripts/secret-scan.sh . && bash .github/scripts/check-structure.sh .`
7. Si `app/` est touchée :
   `cd app && npm run test && npm run build && npm run portes`
8. Taille de la PR (≈ 400 lignes au plus hors tests ; au-delà, découper ou demander `derogation-taille` à Marc) :
   `git diff --shortstat origin/main -- . ':!test/*'`
9. Juste avant le push : `git fetch origin main` ; si `main` a bougé, fusionner, relancer le gate, puis pousser.
