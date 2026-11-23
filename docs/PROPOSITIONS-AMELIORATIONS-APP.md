# Propositions d’améliorations — Application web DriveAI

> **Document de propositions (exigence R4)** soumis à la validation de Marc avant tout développement.
> Les 11 propositions application (`P0-1` à `P2-3`, sections 1 à 3) ont été implémentées. Coût supplémentaire : **0 $**.
> Les pistes moteur touchant aux règles de tri ou de classement sont isolées en **section 4** sous protocole de précision (`docs/claude/11-protocole-de-precision.md`).

## Tableau récapitulatif de décision rapide

| ID | Priorité | Proposition | Complexité | Coût | Statut |
|---|---|---|---|---|---|
| `P0-1` | P0 | Barre de recherche globale rapide (`Ctrl+K` / `⌘K`) accessible partout | Moyenne | 0 $ | Implémenté |
| `P0-2` | P0 | Onglet dédié « État » séparé des « Réglages » | Moyenne | 0 $ | Implémenté |
| `P0-3` | P0 | Visibilité des propositions `Réorg` et dossiers vides sur `Aujourd’hui` | Faible | 0 $ | Implémenté |
| `P0-4` | P0 | Compteur réel des mails archivés et jauge unifiée `fond / 300` (`Télémétrie` → app) | Faible–moyenne | 0 $ | Implémenté |
| `P1-1` | P1 | Filtres rapides en pilules dans `Explorateur` et sur les résultats de recherche | Faible | 0 $ | Implémenté |
| `P1-2` | P1 | Chemin parent réel et fil d’Ariane exact depuis la recherche globale | Moyenne | 0 $ | Implémenté |
| `P1-3` | P1 | Badges de statut Index, bouton « Copier le lien » et confirmation de création de dossier | Faible | 0 $ | Implémenté |
| `P1-4` | P1 | Suppression du cycle d’import `App.tsx ↔ AujourdHui.tsx` (0 violation d’architecture) | Très faible | 0 $ | Implémenté |
| `P2-1` | P2 | Bascule thème clair optionnel (« Google Light ») dans `Réglages` | Faible–moyenne | 0 $ | Implémenté |
| `P2-2` | P2 | Nettoyage du code mort (`knip` à 0) et micro-robustesse UI post-M3 | Très faible | 0 $ | Implémenté |
| `P2-3` | P2 | Modernisation optionnelle des tests d’interaction UI (`jsdom` + `@testing-library/react`) | Moyenne | 0 $ | Implémenté |

---

## 1. Priorité P0 — Impact immédiat (visibilité, fiabilité, accès rapide)

### `P0-1` — Barre de recherche globale rapide (`Ctrl+K` / `⌘K`) accessible depuis toute l’application
- **Références vérifiées** : `app/src/App.tsx:168-224` (coquille sans champ de recherche), `app/src/vues/Explorateur.tsx:275-297` (recherche présente uniquement dans l’onglet `Documents`), `app/src/google.ts:548-588` (`rechercherDrive`).
- **Problème / besoin** : Pour retrouver un document ou un dossier pendant la consultation de `Aujourd’hui` ou `Réglages`, il faut d’abord changer d’onglet vers `Documents`.
- **Comportement proposé** : Ajouter un bouton compact « Rechercher (`⌘K`) » dans le rail ordinateur et dans la barre haute mobile, ouvrant une fenêtre de recherche légère en pilule (`.gf-omnibox-pill`) permettant soit de sauter vers un écran/dossier, soit d’exécuter `rechercherDrive(texte)` directement et d’ouvrir le fichier dans Drive ou le dossier dans `Explorateur`.
- **Complexité / risque** : Moyenne · Faible risque (réutilise `rechercherDrive` et `MODE_MOCK`, sans nouvelle API).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Respect strict ADR-0007 (recherche Drive native, aucun corps persisté), cibles tactiles `>= 44 px`, zéro `#hex` hors `:root`, test E2E en `MODE_MOCK` sans appel réseau externe.
- **Statut : Implémenté**

### `P0-2` — Onglet dédié « État » séparé des « Réglages »
- **Références vérifiées** : `app/src/App.tsx:27,34,185-224` (`SECTIONS_NAV = ['aujourdhui', 'documents']`), `app/src/vues/Reglages.tsx:56-495` (607 lignes mêlant santé moteur, file de revue, quotas, coûts et préférences), `app/src/styles.css` (`nav.barre-basse`).
- **Problème / besoin** : La vue `Réglages` rassemble à la fois le suivi quotidien de la santé du moteur et les paramètres rares (fréquence, langue, synchronisation, déconnexion). Passer par l’icône d’engrenage pour vérifier l’état du moteur reste peu intuitif.
- **Comportement proposé** : Promouvoir un troisième onglet principal **`État`** (`Aujourd’hui · Documents · État`) dédié au tableau de santé (`syntheseEtat`, incidents actifs, quotas Gmail, coûts par poste, erreurs 7 jours, campagnes en cours), et recentrer `Réglages` sur les préférences (`FrequenceLigne`, langue, synchronisation, déconnexion). Passer `nav.barre-basse` à `repeat(3, minmax(0, 1fr))` sur mobile.
- **Complexité / risque** : Moyenne · Risque faible à modéré (implique la mise à jour explicite de verrous de tests UI existants).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Mettre à jour de manière justifiée `app/test/reglages-etat.test.ts:78-80,167` (`repeat(3, ...)` et rubriques sorties de `<details class="avance">` si déplacées vers `État`), vérifier `seuil-telephone.test.ts` et l’absence de débordement mobile (`320 px` / `390 px`), avec cibles `>= 44 px`.
- **Statut : Implémenté**

### `P0-3` — Visibilité des propositions `Réorg` et des dossiers vides directement sur `Aujourd’hui`
- **Références vérifiées** : `app/src/vues/AujourdHui.tsx:94,107` (`syn` calcule `syn.fileRevue`, mais `nbAFaire` ignore `reorgPropositions` et `videsCandidats`), `app/src/etatGlobal.tsx:83,89` (`reorgBrut` déjà chargé), `app/src/vues/Documents.tsx:17` (`ReorgVue`).
- **Problème / besoin** : Si le moteur ou une future passe de fusions propose des rangements à valider ou signale des dossiers vides à corbeiller, rien sur l’écran d’accueil `Aujourd’hui` ne le signale tant que l’onglet `Documents` n’est pas ouvert.
- **Comportement proposé** : Afficher sur `Aujourd’hui` (uniquement lorsque `reorgPropositions > 0` ou `videsCandidats > 0`) une ligne ou un encart actionnable dans `À faire` (ex. « N réorganisation(s) à valider · M dossier(s) vide(s) ») avec un accès direct vers `Documents`. Ne rien afficher à `0` ou lorsque la donnée est absente.
- **Complexité / risque** : Faible · Très faible risque (données déjà chargées par `FournisseurEtat` et agrégées dans `syntheseEtat`).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Préserver le verrou `app/test/reglages-etat.test.ts:152-160` (strictement 2 `<section>` dans `.accueil` — intégrer dans la liste `À faire` existante ou un bandeau `<div>`), aucune action destructive depuis l’accueil, cibles `>= 44 px`.
- **Statut : Implémenté**

### `P0-4` — Compteur réel des mails archivés et suivi unifié des campagnes de fond (`Télémétrie` moteur → app)
- **Références vérifiées** : `src/TriGmail.gs:1310-1311` (`trierFil_` retourne `'archive'` sans compteur quotidien écrit en Sheet), `src/TriGmail.gs:786-844` (`balayerBoiteAnciensLus_` garde `DriveAI_TRI_ANCIENS_FILS_JOUR` hors `Télémétrie`), `src/Journal.gs:804-815` (`lignesTelemetrie_`), `app/src/etat.ts:914-917,1079-1084` (`suiviIndexDisponible: false`), `app/src/vues/Reglages.tsx:364` (`archivageHonneteNote`).
- **Problème / besoin** : L’onglet `Index` ne distingue pas les fils archivés des autres fils triés ; par honnêteté (« no fake data »), l’application affiche aujourd’hui une note explicative sans chiffre d’archivage. De plus, la campagne `balayerBoiteAnciensLus_` (> 29 jours) n’apparaît pas encore dans `Télémétrie`, et l’issue `#892` prévoit une jauge unique `fond : somme / 300`.
- **Comportement proposé** : Côté moteur (`Journal.gs` / `TriGmail.gs`), publier dans `Télémétrie` les compteurs quotidiens mesurés `tri_archives_jour` (fils effectivement archivés le jour même via `moveToArchive()`) et `tri_anciens_fils_jour`, ainsi que la somme consolidée des campagnes de fond sous le plafond commun `300/j` (`#892`). Côté application (`etat.ts` + vue d’état), afficher ce compteur quotidien mesuré en conservant `—` s’il est absent.
- **Complexité / risque** : Faible à moyenne · Faible risque (télémétrie additive seule, **zéro modification des règles de tri ou de classement**).
- **Impact coût** : `0 $` strictement (lignes ajoutées à l’écriture existante de `Télémétrie`).
- **Garde-fous** : Ne jamais déduire rétroactivement un total historique d’archivage absent d’`Index`, réutiliser la Property existante `DriveAI_TRI_ANCIENS_FILS_JOUR`, maintenir verts `test/orchestration.test.js` et `npm test` (racine + `app/`).
- **Statut : Implémenté**

---

## 2. Priorité P1 — Ergonomie, cohérence Drive / FinanceAI et architecture

### `P1-1` — Filtres rapides (pilules) dans `Explorateur` et sur les résultats de recherche
- **Références vérifiées** : `app/src/etat.ts:211-252,418-426` (`filtrerIndex`, `domainesDepuisIndex`, `statutsDepuisIndex`, `anneesDepuisIndex`, `estConfianceBasse` déjà testés mais non branchés dans les vues), `app/src/vues/Explorateur.tsx:255,392-426`.
- **Problème / besoin** : Lorsqu’un dossier ou une recherche renvoie jusqu’à 50 ou 100 éléments, aucun filtre rapide ne permet d’isoler les dossiers, les PDF ou les fichiers marqués `À vérifier` / confiance basse.
- **Comportement proposé** : Ajouter sous la barre de recherche une rangée compacte de puces (`.gf-chip`) : `Tout`, `Dossiers`, `PDF`, `À vérifier`, `Confiance < 50 %`, appliquée côté client sur la liste affichée et l’Index déjà en mémoire (zéro appel réseau supplémentaire).
- **Complexité / risque** : Faible · Faible risque (fonctions pures déjà testées dans `etat.ts`).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Zéro débordement horizontal sur mobile (`320 px` / `390 px`), cibles `>= 44 px`, sobriété visuelle alignée FinanceAI sans réintroduire d’onglets complexes.
- **Statut : Implémenté**

### `P1-2` — Chemin parent réel et fil d’Ariane exact depuis la recherche globale
- **Références vérifiées** : `app/src/google.ts:451` (`CHAMPS_ELEMENT` n’inclut pas `parents`), `app/src/vues/Explorateur.tsx:163-170` (`ouvrirDossier` empile par approximation le dossier trouvé sur le fil d’Ariane courant).
- **Problème / besoin** : Un résultat issu d’une recherche dans `Tout le Drive` n’indique pas dans quel dossier parent (ex. `02 · Finances` ou `Bellerives`) il réside, et l’ouverture d’un dossier trouvé affiche un fil d’Ariane approximatif.
- **Comportement proposé** : Ajouter `parents` à `CHAMPS_ELEMENT` (sans requête supplémentaire) pour exploiter le cache ou remonter l’ascendance uniquement au clic d’ouverture d’un dossier via `remonterAscendance`, afin d’afficher un fil d’Ariane exact (`Mon Drive › … › Dossier`).
- **Complexité / risque** : Moyenne · Faible risque (veille aux quotas Drive : ne jamais lancer de requête parent N+1 pour les 50 résultats d’un coup).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Zéro requête N+1 sur la liste complète des résultats, compatibilité complète avec `MODE_MOCK` (`mockData.ts`).
- **Statut : Implémenté**

### `P1-3` — Badges de statut Index, bouton « Copier le lien » et confirmation de création de dossier
- **Références vérifiées** : `app/src/vues/Explorateur.tsx:186-199` (`creer()` sans bandeau de succès), `app/src/vues/Explorateur.tsx:413-424` (ligne fichier sans statut Index ni copie de lien), `app/src/etatGlobal.tsx:19` (`donnees.index` déjà en mémoire).
- **Problème / besoin** : Dans l’explorateur, l’utilisateur ne voit pas si un fichier est `Classé` ou `À vérifier`, doit ouvrir Drive pour copier son lien, et ne reçoit aucune confirmation visuelle après la création d’un dossier.
- **Comportement proposé** : Croiser en mémoire chaque fichier affiché avec son statut `Index` sous forme de pastille discrète, ajouter une action secondaire `>= 44 px` « Copier le lien » (`navigator.clipboard.writeText` avec repli gracieux), et afficher un bandeau `.ok` temporaire après `creerDossier` sur le modèle de `statutDepot` (`Explorateur.tsx:352`).
- **Complexité / risque** : Faible · Très faible risque (données `Index` déjà en mémoire, zéro appel réseau).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Conserver `explorateur-depot.test.ts`, cibles `>= 44 px`, zéro `#hex` hors `:root`, lisibilité sur écran `320 px`.
- **Statut : Implémenté**

### `P1-4` — Suppression du cycle d’import `App.tsx ↔ AujourdHui.tsx` (0 violation d’architecture)
- **Références vérifiées** : `app/src/App.tsx:23,27` (`import { AujourdHui }`, `export type Section`), `app/src/vues/AujourdHui.tsx:16` (`import type { Section } from '../App'`), `app/.dependency-cruiser.cjs:10-14` (`pas-de-cycle`), `app/qualite/seuils.json:36-38` (`architecture.violations: max 1`).
- **Problème / besoin** : Un unique cycle de type entre `App.tsx` et `AujourdHui.tsx` maintient le compteur `architecture.violations` à `1` au lieu de `0`.
- **Comportement proposé** : Déplacer `export type Section` (et `SECTIONS_NAV` si pertinent) dans un module dédié sans import de vue `.tsx` (ex. `app/src/navigation.ts`), puis resserrer le cliquet `app/qualite/seuils.json` à `0` via `npm run portes:maj`.
- **Complexité / risque** : Très faible · Risque fonctionnel nul (type TypeScript pur).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : `app/qualite/seuils.json` étant un chemin protégé (`AGENTS.md`), le resserrement du seuil à `0` nécessite l’autorisation ou le contrôle Garde-fou vert lors de la PR dédiée.
- **Statut : Implémenté**

---

## 3. Priorité P2 — Confort, maintenance et outillage

### `P2-1` — Bascule thème clair optionnel (« Google Light ») dans `Réglages`
- **Références vérifiées** : `app/src/styles.css:6-74` (toutes les couleurs centralisées en variables CSS dans `:root`, `html { color-scheme: dark; }`), `app/test/reglages-etat.test.ts:163-166` (regex vérifiant 0 `#hex` hors `:root`).
- **Problème / besoin** : L’application n’offre actuellement qu’un thème sombre. Un mode clair optionnel de style Google faciliterait la lecture en plein jour sur mobile.
- **Comportement proposé** : Ajouter un sélecteur `Thème : Sombre / Clair` dans `Réglages` (mémorisé localement comme la langue dans `i18n.ts`), en conservant le thème sombre par défaut et en définissant des variables claires conformes WCAG AA / 1.4.11.
- **Complexité / risque** : Faible à moyenne · Faible risque si les variables CSS sont strictement isolées.
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Point de vigilance vérifié — `app/test/reglages-etat.test.ts:165` extrait uniquement le premier bloc `:root { ... }` avant de contrôler l’absence de `#hex` ; il faudra adapter proprement le motif aux blocs de variables thématisées (ex. `:root[data-theme="clair"]`) sans affaiblir l’interdiction hors variables, et vérifier les captures Playwright en clair et sombre.
- **Statut : Implémenté**

### `P2-2` — Nettoyage du code mort (`knip` à 0) et micro-robustesse UI post-M3
- **Références vérifiées** : `app/src/corbeille.ts:158` (`Duplicate exports (1): CORBEILLE_MAX_PANNES|CORBEILLE_PREMIERE_ECRITURE` remonté par `npx knip`), `app/src/explorateur.ts:78-87` (`iconePourMime` non utilisée en UI, testée uniquement dans `explorateur.test.ts:104-108`), `app/src/vues/Explorateur.tsx:181` (`changerPortee` ignore `enCours` avant la fin de la première requête), `app/src/vues/Reglages.tsx:446,579,595` (divisions par `j.plafond` / `op.base` sans garde explicite `> 0`). *(Note : `SEUIL_CONFIANCE_BASSE` n’est plus du code mort depuis M2.)*
- **Problème / besoin** : Ramener `knip` à `0` anomalie et fermer deux cas limites CSS/asynchrone relevés lors de la revue M3.
- **Comportement proposé** : Unifier l’export dans `corbeille.ts` (en adaptant `corbeille.test.ts` sans l’affaiblir), trancher sur le retrait d’`iconePourMime`, ajouter `|| enCours` dans `changerPortee`, et borner `j.plafond > 0 ? ... : 0` dans `Reglages.tsx`.
- **Complexité / risque** : Très faible · Risque négligeable.
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Aucun test désactivé ou affaibli (`corbeille.test.ts` référence `CORBEILLE_PREMIERE_ECRITURE`), maintien de `npm run portes` et de la couverture au-dessus des seuils.
- **Statut : Implémenté**

### `P2-3` — Modernisation optionnelle des tests d’interaction UI (`jsdom` + `@testing-library/react`)
- **Références vérifiées** : `app/package.json:21-34`, `app/vite.config.ts:10` (`environment: 'node'`), `app/test/{bouton-fermer,explorateur-depot,reglages-etat,seuil-telephone}.test.ts` (tests statiques par regex et `renderToStaticMarkup`).
- **Problème / besoin** : Les interactions React côté client (clics, `useEffect`, transitions d’état) ne sont testées aujourd’hui qu’en E2E Playwright (`app/e2e/`) ou par rendu serveur statique ; des tests unitaires DOM rendraient la boucle de retour plus rapide.
- **Comportement proposé** : Évaluer l’ajout ciblé de `jsdom` et `@testing-library/react` en `devDependencies` uniquement, tout en conservant Playwright pour la validation navigateur réelle.
- **Complexité / risque** : Moyenne · Encadrée par la politique des dépendances d’`AGENTS.md` (modification de `package.json` sur demande explicite uniquement, `npm audit --omit=dev` à `0`).
- **Impact coût** : `0 $` strictement.
- **Garde-fous** : Conserver intacts les tests statiques existants (`seuil-telephone.test.ts`, `corbeille.test.ts`), `npm audit --omit=dev` = `0`, aucune régression sur les tests `node`.
- **Statut : Implémenté**

---

## 4. Hors périmètre R4 — Pistes moteur (R5 Groupe B) et chantiers Roadmap en attente d’audit / décision de Marc

Ces pistes ne relèvent pas des améliorations d’interface R4 ; toute évolution des règles de tri ou de classement exige d’abord un audit comparatif en lecture seule sur ~20 cas réels et un ADR (`docs/claude/11-protocole-de-precision.md`), ou la pose préalable d’un prérequis matériel par Marc :

1. **`R5-B1` — Traitement de `extraireTexte_ === null` en échec OCR (`src/Pipeline.gs:125`)** : aujourd’hui `extrait: extrait || ''` laisse le modèle classer d’après le nom et les métadonnées seuls ; basculer vers `gererEchec_` ou `00 · À vérifier` modifie les règles de routage et interagit avec la future lecture multimodale (étape 9). *Prérequis : audit comparatif ~20 documents réels + ADR.*
2. **`R5-B2` — Préservation du libellé existant au passage `nonlu → lu` sans entrée `TriAppris` (`src/TriGmail.gs:1163-1167,1299-1301`)** : éviter une re-catégorisation lorsqu’un libellé utilisateur valide est déjà posé sur le fil. *Prérequis : audit comparatif ~20 fils réels + ADR.*
3. **`R5-B3` — Bascule LLM vers Gemini (`src/Config.gs:20-21,46`, étape 5 ADR-0073/0074)** : remplacer `claude-haiku-5-5` / `claude-sonnet-5-5` par `gemini-3.5-flash-lite` / `gemini-3.8-flash` après pose par Marc de `DriveAI_GEMINI_KEY`, exécution de `sonderGemini()`, audit comparatif ~20 documents (`DryRunV2`) et ré-audit du tri (`action=audit-tri`, incluant `TRI_HISTO_REQUETE`).
4. **`RM-1` — Racine zéro (étape 11, `docs/PASSATION-ANTIGRAVITY.md §3.5`) et rebranchement des fusions / réorg (`app/src/vues/Reorg.tsx:8,392`, étape 12)** : recensement en lecture seule et QCM de structure soumis à Marc, puis réactivation des cartes de fusion à valider.

---

## 5. Comment valider

Pour autoriser le développement d’une ou plusieurs propositions R4 ci-dessus, il suffit d’indiquer les identifiants retenus (par exemple : `OK P0-1, P0-2, P1-4` ou `OK P0 tout`). Aucune proposition de ce document ne sera codée ni déployée sans validation préalable explicite de Marc.
