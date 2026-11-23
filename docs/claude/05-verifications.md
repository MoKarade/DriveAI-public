<!-- Extrait de l'ancien CLAUDE.md (§ 5. Vérifications avant commit), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Vérifications avant commit

## 5. Vérifications avant commit

```bash
node --test test/*.test.js            # moteur : logique pure, zéro dépendance
cd app && npm test && npm run build   # app web : vitest + tsc --noEmit + vite build
node .github/ci/couverture-moteur.mjs # cliquet de couverture du moteur (lignes de src/*.gs)
```

Le cliquet du moteur (`.github/ci/couverture-moteur.json`, mesure du 2026-10-16 : 86,7 % des lignes
de `src/*.gs`) ne recule pas : `--maj` le resserre quand la mesure monte, le baisser demande une
décision de Marc. Celui de l'app (lignes, branches, code mort) vit dans `app/qualite/seuils.json`.

Plus, si un `.gs` a bougé — **un `.gs` à la syntaxe cassée fige le déploiement `clasp`**, et ça ne
se voit ni dans les tests du moteur (qui ne chargent pas tous les fichiers) ni dans le build de
l'app :

```bash
tmp=$(mktemp -d); for f in src/*.gs; do cp "$f" "$tmp/$(basename "$f" .gs).js"; done
for j in "$tmp"/*.js; do node --check "$j" || echo "❌ $(basename "$j" .js).gs"; done
```

La **CI** (`.github/workflows/ci.yml`) rejoue exactement ce gate, plus les tripwires de surface
(scan de secrets, `surface-gmail-ecriture`, `trashed: true` confiné à `app/src/corbeille.ts`) et
les captures E2E en mode mock. Chaque job est borné par `timeout-minutes` : sans lui, le défaut
GitHub est de **six heures** — vécu 2× le 19/08, `playwright install` figé > 20 min retenant le
merge sans rien afficher.

**SonarCloud** n'est plus utilisé (décision de Marc, 15/10/2026) : sa config
`.sonarcloud.properties` a été retirée du dépôt.
