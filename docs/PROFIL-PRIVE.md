# Profil privé du moteur

Le dépôt ne contient plus aucun identifiant réel de dossier Drive (mission #497). `CONFIG`
(`src/Config.gs`) porte des valeurs FICTIVES (`FICTIF_<CHEMIN>`) ; les vraies valeurs vivent dans
un fichier JSON du Drive du propriétaire, que le moteur superpose à `CONFIG` au chargement.

## Mécanique

1. Le fichier JSON du profil s'appelle `driveai-profil-prive.json` et vit dans le Drive de l'utilisateur
   du script. `trouverFichierProfil_` le trouve par son nom, en ne retenant que les fichiers dont il est
   PROPRIÉTAIRE (un fichier du même nom partagé par un tiers est ignoré) ; deux candidats ⇒ refus
   (`illisible`). Option : la Script Property `DriveAI_PROFIL_ID` (identifiant du fichier, pas son
   contenu : une propriété est limitée à environ 9 Ko) passe avant la recherche par nom.
2. Au chargement de `Config.gs`, `appliquerProfilPrive_` lit ce fichier (`DriveApp`) et superpose
   `fusionnerProfil_(CONFIG, profil)`. Un succès est mis en cache 300 s ; **un échec ne l'est jamais**.
3. `etatProfilPrive_()` rend `absent`, `illisible`, `incomplet` ou `ok`, avec le nombre de valeurs appliquées et
   les CHEMINS ignorés. Jamais une valeur. (Il était exposé par l'outil MCP `etat_moteur`, retiré par l'ADR-0074.)

## Échec fermé

Sans profil lisible (`absent`, `illisible` ou `incomplet`), `tickDriveAI` saute le tick et le journalise : le
moteur ne range rien dans des dossiers `FICTIF_…`. Rétablir le profil suffit, rien à rejouer.

**Version du profil.** Le profil déclare `"PROFIL_VERSION": 6`. Si elle manque ou diffère de
`PROFIL_VERSION_ATTENDUE` (`Config.gs`), l'état est `incomplet` : les valeurs sont appliquées mais le tick
est sauté. Sans ce garde, un profil écrit pour une version plus ancienne laisserait les valeurs fictives
des blocs récents (`PARCOURS`, `MISSIONS_*`) actives, et le moteur rangerait sur des noms qui n'existent pas.
À incrémenter chaque fois qu'un bloc réel devient obligatoire.

## Schéma du fichier

Même forme que `CONFIG`, limitée aux clés à remplacer. Règles de `fusionnerProfil_` :

- une feuille (texte, nombre, tableau) du profil remplace celle de `CONFIG` ;
- un objet est fusionné clé par clé ;
- une clé inconnue de `CONFIG`, ou d'un autre type, est IGNORÉE et listée par son chemin ;
- `"$remplace": true` dans un objet le remplace en bloc : nécessaire quand ses CLÉS sont des
  identifiants (`MISSIONS_EPINGLES`, `MISSIONS_IDS`) ou des noms propres (`PARCOURS.personnesAutres`,
  `PARCOURS.correctionsOcr`), qui n'existent pas dans le fictif. ⚠️ Sans lui, ces clés sont ignorées en silence
  (visibles seulement dans `ignores`).

Blocs actuellement portés : `DOSSIERS`, `DOMAINES`, `CATEGORIES`, `DOCUMENTS_ID`, `MISSIONS_IDS`,
`CORRECTIONS_MANUELLES`, `MISSIONS_EPINGLES`, `INCIDENT_SHEET`, et depuis la version 2 : `PROFIL_VERSION`,
`PROPRIETAIRE_EMAIL`, `MISSIONS_EMPLOYEURS`, `MISSIONS_EMPLOYEURS_AUTRES`, `MISSIONS_BAILLEURS`,
`MISSIONS_VEHICULES` et `PARCOURS`. La **version 3** (tâche #578) y ajoute `MISSIONS_ASSUREURS` et `PARCOURS.finance`. La **version 4** (tâche #587) y ajoute `PARCOURS.fournisseurs`, et le profil doit porter `MISSIONS_FOURNISSEURS_ENERGIE` et `MISSIONS_ANNEES02_DOMAINES` avec les vrais noms. La **version 5** (tâche #468) y ajoute `PARCOURS.fournisseurs.energieAnciens`. La **version 6** (tâche #468) renomme trois clés de `MISSIONS_IDS` (`vehiculeIsole`, `vehiculeRechercheA`, `vehiculeRechercheB`, qui portaient une marque) et y ajoute `MEMOIRE_URL`, `MISSIONS_VEHICULE_COMMUNS` (valeurs réelles) et trois blocs de `PARCOURS` : `lexiqueEntites`, `vehicules` et `reset` (voir « Règles du reset, marques et lexique »).

`PARCOURS` regroupe ce qui décrit la vie de Marc : `titulaire` (prénom, autres prénoms, nom),
`personnesAutres` (pièces d'identité des proches), `employeursNoeuds` et `correctionsOcr`, `logements`
(un nœud par adresse, avec les mots qui la désignent) et `anciensLogementsMots`, `ecoles` (libellé, fenêtre de
scolarité, sous-dossiers thématiques) et `marqueursEcole` (mots qui désignent chaque établissement dans un
nom de fichier), `seedEntites`. Les valeurs par défaut sont fictives (Alphatek, Betatek, 1201 rue Exemple Alpha…).

### `PARCOURS.finance` et `MISSIONS_ASSUREURS` (version 3)

Les noms de banques et d'assureurs ne sont plus dans le moteur (ni dans les tests, ni dans les docs) : ils vivent
ici, et `Reset.gs` les lit à l'appel (`CONFIG.PARCOURS.finance`, `CONFIG.MISSIONS_ASSUREURS`). Forme (valeurs FICTIVES) :

```json
"MISSIONS_ASSUREURS": [ { "bucket": "Bellerives", "jetons": ["bellerives"] }, { "bucket": "MUTA", "jetons": ["muta", "fidelia"] } ],
"PARCOURS": { "finance": {
  "banques": [ { "dossier": "Bellerives", "jetons": ["bellerives"] }, { "dossier": "CMF", "jetons": ["cmf", "credit mondial"] } ],
  "banquesFrance": ["societe federale", "bcque"],
  "assureurContrats": { "dossier": "Fidelia-MUTA", "jetons": ["muta"] },
  "assureursAuto": ["assureur1", "assureur2"],
  "assureursVoyage": ["assureur2"]
} }
```

- `banques` : un dossier sous `02/Banques` par entrée ; `jetons` sont des SOUS-CHAÎNES (sans accents, minuscules) cherchées dans
  l'émetteur, et **l'ordre est celui des tests** (la première qui correspond gagne) ; `dossier` est comparé au caractère près.
- `banquesFrance` : émetteurs regroupés sous `Banques/Banques France`. `assureurContrats` : le dossier de `Contrats & fournisseurs`.
- `assureursAuto` / `assureursVoyage` : jetons d'émetteur qui font classer un document en assurance auto / voyage.
- ⚠️ Un tableau du profil REMPLACE celui d'ici : fournir chaque liste ENTIÈRE. Sans ces blocs, la version passe à `incomplet`
  (un profil resté en version 2 en est dépourvu) et le tick est sauté : le moteur ne range jamais sur des noms fictifs.

### `PARCOURS.fournisseurs`, `MISSIONS_FOURNISSEURS_ENERGIE` et `MISSIONS_ANNEES02_DOMAINES` (version 4)

Les noms des fournisseurs d'énergie et de téléphone ne sont plus dans le moteur (ni dans les tests, ni dans les docs) :
`Reset.gs` les lit à l'appel. Hydro-Québec reste dans `MISSIONS_FOURNISSEURS_ENERGIE` (seul fournisseur possible au Québec).
Forme (valeurs FICTIVES) :

```json
"MISSIONS_FOURNISSEURS_ENERGIE": [ { "bucket": "Hydro-Québec", "jetons": ["hydro"] }, { "bucket": "Energie Aurore", "jetons": ["aurore"] } ],
"MISSIONS_ANNEES02_DOMAINES": [ { "domaine": "01 · Administratif & identité", "jetons": ["boreale", "revendeur"], "motifs": [],
  "exclusions": ["boreale atlantic", "boreale radio", "boreale megastore"] } ],
"PARCOURS": { "fournisseurs": {
  "energieContrats": { "dossier": "Energie Aurore", "jetons": ["aurore"] },
  "energieAnciens": { "dossier": "Zephyr", "jetons": ["zephyr"] },
  "telecom": { "dossier": "Mobile Boreale", "jetons": ["boreale"] }
} }
```

- `MISSIONS_FOURNISSEURS_ENERGIE` : un dossier par fournisseur sous `03/Énergie & services`, dans l'ordre ; ses `jetons` servent aussi à
  reconnaître l'émetteur dans le flux.
- `energieContrats` / `telecom` : le dossier de `Contrats & fournisseurs` d'un fournisseur d'énergie / de l'opérateur télécom.
  `dossier` est comparé au caractère près à celui du Drive.
- `energieAnciens` (**version 5**, tâche #468) : le dossier de `Contrats & fournisseurs` d'un second fournisseur d'énergie, resté à part.
  Son nom réel était codé en dur dans `Reset.gs` ; il vit maintenant ici. Ses `jetons` rejoignent ceux de l'énergie dans le flux de reset.
  Sans lui dans le profil, le moteur prendrait le dossier FICTIF par défaut : d'où le passage de `PROFIL_VERSION_ATTENDUE` à 5.
- `MISSIONS_ANNEES02_DOMAINES` : UNE table, lue par la mission (sortie des dossiers-années de 02) ET par le flux ; les `exclusions`
  d'un jeton (marque ombrelle : billets d'avion, radio…) s'y trouvent. Le jeton du télécom (`telecom.jetons`) doit y figurer.
- ⚠️ Un tableau du profil REMPLACE celui d'ici : fournir chaque liste ENTIÈRE (y compris les autres entrées de
  `MISSIONS_ANNEES02_DOMAINES`). Sans ces blocs la version est `incomplet` et le tick est sauté.

## Règles du reset, marques et lexique (version 6)

Les dernières valeurs réelles que le moteur portait en dur (marques de véhicule, un fournisseur, un projet, un courtier,
un hôpital, un régime de santé étranger, un feuillet fiscal, un voyage) vivent maintenant dans `PARCOURS`. Le code les
lit à l'appel ; les valeurs par défaut sont fictives. Forme (valeurs FICTIVES) :

```json
"PARCOURS": {
  "lexiqueEntites": ["motgenerique"],
  "vehicules": { "marques": ["ford", "marquex"], "alias": { "$remplace": true, "marquee": "VW" }, "cibleIsole": "Marquec Modelc" },
  "reset": {
    "fournisseurAutre": { "dossier": "Fournisseur Y", "jetons": ["fournisseury"] },
    "projetPerso": { "dossier": "Projet C", "motifs": ["projet c"] },
    "santeEtrangere": ["regime de sante etranger"],
    "feuilletsFiscaux": ["t9999"],
    "courtiers": ["courtierx"],
    "hopitaux": ["hopitalex"],
    "voyagesSupp": [{ "dossier": "Finlande", "motifs": ["transporteurz"] }]
  }
}
```

- `lexiqueEntites` : mots génériques en plus du lexique fixe de `Entites.gs` (jamais une entité à proposer).
- `vehicules.marques` : premier mot d'un nom qui désigne un véhicule ; `alias` : marque vers forme courte du dossier
  (mettre `"$remplace": true`, sinon les clés absentes d'ici sont ignorées) ; `cibleIsole` : le dossier de `Véhicule` qui reçoit
  en bloc le dossier isolé de `03` (égal à un nom de `MISSIONS_VEHICULES`, tripwire de test).
- `reset.fournisseurAutre` / `projetPerso` : un dossier de `Contrats & fournisseurs` et un dossier de `08/Projets` (placé après « DriveAI »).
- `reset.santeEtrangere` (motifs multi-mots), `feuilletsFiscaux` et `courtiers` (mots entiers), `hopitaux` (motifs, en plus des mots génériques),
  `voyagesSupp` (motifs qui s'ajoutent à ceux du dossier `Par voyage/<dossier>`, qui existe déjà dans l'arbre).
- `MEMOIRE_URL` (version 6) n'est plus lue depuis l'ADR-0074 (05/11/2026, canal Mémoire retiré) : un profil qui la porte encore est accepté, la clé est ignorée.
- Preuve d'équivalence faite avant la fusion : `CONFIG` d'avant (profil v5) et d'après (profil v6) identiques sauf la version et ces trois blocs,
  et mêmes sorties (chemins du reset, véhicules, entités génériques, employeurs, finance, écoles) sur 9 986 libellés tirés des anciens tests.

## Mise en place

1. Déposer `driveai-profil-prive.json` dans le Drive du propriétaire (jamais dans le dépôt, jamais dans une PR).
2. Vérifier que le tick tourne : la Santé (onglet `Santé` de la Sheet, écran Moteur de l'app) ne dit plus « profil privé absent » (`etatProfilPrive_().etat` vaut `ok` ; l'outil MCP `etat_moteur` qui l'exposait est retiré depuis l'ADR-0074).

Aucun réglage dans l'éditeur Apps Script n'est nécessaire. Le fichier doit exister AVANT la fusion de
la PR qui retire les identifiants du code, sinon les ticks sont sautés jusqu'à son dépôt.

## L'application web

L'app ne porte plus aucun identifiant Drive. La racine de la zone protégée et les deux dossiers à ID fixe
(`Logement`, `Véhicule`) lui viennent du moteur : action `gardes-app` de la web app (`actionGardesApp_`),
qui les lit dans le profil, puis `chargerGardes` (`app/src/google.ts`), mémoïsé pour la session sauf échec.
ÉCHEC FERMÉ : profil non appliqué, repère manquant ou fictif ⇒ le moteur répond `ok:false`, l'app refuse
tout déplacement et toute mise à la corbeille (`profil-absent`). Lecture et affichage restent possibles.

## Ce que ça ne couvre pas

- Les noms propres qui ne sont pas des paramètres du moteur : commentaires et documents d'historique
  (ADR, HANDOVER) ont été rendus fictifs ou génériques ; le détail réel n'est que dans le profil.
- Les prompts envoyés au LLM (`Llm.gs` ; `Piece.gs` jusqu'à son retrait par l'ADR-0074) n'emploient plus le nom complet du propriétaire ni
  d'exemples réels : le comportement du modèle peut en différer légèrement.
- Les identités qui ne sont pas hachées dans `test/pii-mots.json` (noms de sociétés civiles immobilières,
  lieux de voyage) : le garde ne peut pas les voir.

## Documents fictifs, code encore réel (suite de #468, 21/10/2026)

- Dans la documentation, les modèles de véhicules, les filières et les années du parcours scolaire, l'adresse web
  personnelle et le numéro du projet GCP par défaut sont écrits en fictif : `Véhicule C`, `Marque K`, `années L`,
  `exemple.com`. Les vraies valeurs ne sont PAS dans les documents.
- Elles sont encore en clair dans `src/`, `test/`, `api/` et `app/` (règles de missions, fenêtres d'écoles, URL
  fonctionnelles). Le garde `test/pii-guard.test.js` les connaît (empreintes) et en tient le compte dans
  `test/pii-baseline.json` : ce compte ne peut que descendre. Les retirer demande une nouvelle version du profil
  privé et un passage par le protocole de précision (`docs/claude/11-protocole-de-precision.md`), PR à part.
