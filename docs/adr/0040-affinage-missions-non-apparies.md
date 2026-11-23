# ADR-0040 — Affinage des règles de missions : les 89 non-appariés (C28-51)

- **Statut** : accepté + implémenté (2026-08-17, même jour — décisions Marc intégrées, c49-2
  livré) — demande Marc : « je peux rien y faire… je veux pouvoir régler ça direct ou que tu
  règles toi. »
- **Révision** : la structure PAR VÉHICULE (§3a) RÉVOQUE les catégories TRANSVERSES
  `Véhicules/<catégorie>` du t4 (décision 2026-07-31) — un document de véhicule sans véhicule
  identifiable n'a plus de fourre-tout : le flux (table pure) rend null (à plat au domaine +
  rapport), la mission tranche par fenêtre de POSSESSION. Tests t4 réécrits sur les mêmes noms
  réels, nouvelle intention.
- **Décideur** : Marc (options structurelles ci-dessous) ; exécution Claude.
- **Périmètre** : missions `vehicule` (50 refus), `logement` (18), `dispatch-03` (21) —
  `MISSIONS_REGLES_VERSION` c49-1 → **c49-2** (les refus keyés se ré-évaluent TOUS au bump).
  Zéro LLM (pure I/O Drive) ; budget quotidien missions inchangé (10 min/j partagé).

## 1. Problème — pourquoi 89 refus (preuves Drive du 17/08)

1. **Logements : les documents sont nommés par BAILLEUR, jamais par adresse.** Les bails de la
   source portent « NEQ-B Québec inc », « NEQ-A Québec inc », « Personne A »,
   « Tribunal administratif du logement », « Gestionnaire étranger A »… — l'appariement par jetons
   d'ADRESSE ne peut pas les voir. 18 refus mécaniques.
2. **Véhicules : pas de dossier Marque K dans la cible.** `Véhicule` = {Véhicule C, Véhicule A,
   Véhicule B} alors que la SOURCE contient un dossier `Marque K` plein — tout document Marque K était sans
   cible. Et 4 sous-dossiers GÉNÉRIQUES (Contraventions, Assurance auto, Recherche & achat,
   Entretien & réparations) ne se rattachent à AUCUN véhicule par le nom : refus légitimes de
   l'appariement par véhicule, mais sans chemin de sortie.
3. **Dispatch-03 : hétérogène.** Formulaires de l'association de propriétaires/Bailleur F, consentements d'un
   service aux propriétaires, locations ponctuelles d'un loueur (véhicule, pas logement), vente d'un concessionnaire,
   correspondance Gestionnaire A — un seul mécanisme (adresse) ne peut pas trancher tout ça.
4. **STRUCTUREL (trouvé pendant la recon) : la table du flux route encore 03 vers `Logements/…`
   et `Véhicules/…` (PLURIEL)** — les dossiers mêmes que les missions VIDENT. Le geste symétrique
   (leçon C28-26, appliqué en PR2 pour 05/02) n'a jamais été fait pour 03 : tout document 03
   classé par le flux ré-alimente une source de mission. Ping-pong latent, à corriger ICI.
5. **Split Bailleur A** : la mission d'aujourd'hui a envoyé les documents émis par « Bailleur A Groupe
   Immobilier » dans `Logement/Bailleur A` pendant que les documents nommés par
   adresse allaient dans `Logement/Logement A` — MÊME logement, deux dossiers, même
   sous-structure {Bail & contrat, Factures, Correspondance, État des lieux & photos, Assurance}.

## 2. Preuves d'appariement bailleur → logement (jamais deviné)

| Émetteur | Logement | Preuve |
|---|---|---|
| Bailleur A | Logement A | Taxonomie (« Logement A (Bailleur A) ») + contenu du dossier |
| NEQ-A Québec inc | Logement A | Accord PPA daté (NEQ-A) ↔ « Échange courriel annexe bail Logement A compte bancaire PPA » du **même jour**, déjà classé dans Logement A |
| Bailleur C | Logement B | Contrat daté ↔ « Contrat location chambre Logement B » du **même jour**, déjà classé dans Logement B |
| Gestionnaire étranger A | Anciens logements | Pays F, année F (échange Université étrangère A) |
| Prénom NOM / Ville A | Anciens logements | Bail Ville A (Pays F) |
| NEQ-B Québec inc (Personne B) | Logement C | **PROUVÉ PAR CONTENU** (PoC 17/08) : la résiliation porte « Prénom NOM, Logement C, Ville G » |
| Personne A | Logement A | **PROUVÉ PAR CONTENU** (PoC 17/08) : sa reconduction est adressée « Prénom NOM Logement A » et signe « NEQ-A Quebec inc. Bailleur A » — les TROIS émetteurs sont le même bailleur |
| Tribunal administratif du logement | générique | JAMAIS un bailleur : routage par FENÊTRE DE DATES seule, sinon refus |

Fenêtres d'occupation prouvées (chevauchements RÉELS — le bailleur prime, la fenêtre n'est un
filet que pour les émetteurs génériques ET une fenêtre UNIQUE) : Logement B (une fenêtre de dates) ;
Logement A (jusqu'à la remise des clés) ; Logement C (jusqu'à la résiliation)
; Logement D (bail en cours). ⚠️ Logement A chevauche Logement C ET Logement D : un
document TAL d'une période de chevauchement est AMBIGU par date seule ⇒ refus (honnête), sauf bailleur au nom.

Règle de construction : un émetteur n'entre dans la table qu'avec une **preuve datée** (document
déjà classé du même jour / même période dans le dossier cible, ou adresse lue dans le contenu au
PoC). Aucune entrée « probable ». Les fenêtres de dates (`fenetresOccupation_`) restent le filet
pour les émetteurs génériques (TAL, Hydro-Québec…).

## 3. Décisions proposées

### 3a. `Véhicule` — composition cible (DÉCISION MARC, 2026-08-17)

**Structure PAR VÉHICULE** (réponse du propriétaire, qui remplace mes options A/B) :
`Véhicule/{Véhicule C, Marque K, Véhicule A, Véhicule B}` (4 ≤ 7 ✔), et DANS chaque véhicule les 4
catégories `{Contraventions, Assurance auto, Entretien & réparations, Recherche & achat}`
(4 ≤ 7 ✔ — ≤ 7 respecté à tous les niveaux par construction). Catégories créées à la DEMANDE
(find-or-create au placement — jamais 16 squelettes vides).

Résolution d'un document : (1) **nom** (jeton de véhicule, mot entier) ; sinon (2) **fenêtre de
POSSESSION par date** — le patron `logementParDate_` appliqué aux véhicules (`vehiculeParDate_`),
fenêtres dérivées des documents DÉJÀ classés par véhicule (achat/vente/immatriculation datés) ;
chevauchement = ambigu = refus. La CATÉGORIE vient du sous-dossier SOURCE (un fichier de
`Véhicules/Contraventions` va en `<véhicule>/Contraventions`) ou du type du nom.

**Véhicule C 2014 : essai seulement (décision Marc)** — pas de dossier ; la capture
Marketplace reste refusée + rapportée (aucun véhicule possédé ne peut l'accueillir sans deviner).
Les locations ponctuelles Enterprise : véhicule non possédé → refus + rapport (même logique).

### 3b. `Logement` — table bailleur + unification Bailleur A

Table §2 (module `employeurDuNom_`-like : `bailleurDuNom_`, apparierUnique_ MOT ENTIER, ambigu =
refus) consommée par mission-logement, dispatch-03 ET le flux 03. **Unification** : le contenu de
`Logement/Bailleur A` fusionne dans `Logement/Logement A` (sous-dossiers homonymes
fusionnés, mêmes gardes que FusionExec : moveTo seul, multi-parents = refus), Bailleur A peint en ROUGE
une fois vide. La table du flux garde UN nœud par logement (nom = adresse).

### 3c. Geste symétrique 03 (le structurel du §1.4)

`STRUCTURE_CIBLE_RESET['03 · Logement & véhicule']` : `Logements` → **`Logement`** (enfants =
adresses + Anciens logements), `Véhicules` → **`Véhicule`** (composition §3a), les nœuds pluriels
RETIRÉS avec verrou d'ABSENCE (patron « Recherche d'emploi », PR2). `cheminCibleReset_` : le domaine 03 achemine
par la MÊME table bailleur/véhicule que les missions. `Contrats`/`Correspondance` (filets 03)
restent pour l'inconnu — mais un document apparié va au logement/véhicule.

### 3d. Reliquat indécidable → surface app (PR séparée, à évaluer)

Ce que AUCUNE règle ne tranche (formulaires de l'association de propriétaires sans adresse…) reste refusé + rapporté.
Option app : liste des non-appariés (onglet `NonApparies` écrit à la convergence) + choix de
destination + Valider → intention exécutée par le moteur au tick (gardes §1/§2). À chiffrer après
le bump : si < 15 restants, le glisser-déposer manuel de Marc suffit (déjà possible, sans risque).

## 4. Garde-fous & risques

- Verdict POSITIF = déplacement définitif (leçon C28-49) ⇒ table à PREUVES seulement, mot entier,
  ambigu = refus. Les 2 mappings « à prouver » n'entrent qu'après lecture du contenu au PoC.
- Fusion Bailleur A : mêmes gardes que #47 (jamais une ancre structurelle en source, multi-parents
  refusés, rouge seulement sur vide strict).
- §8 : audit PoC sur les **89 noms réels** (avant/après, table rendue) AVANT de coder le pipeline ;
  ≥ 3 cas qui doivent RESTER refusés (TAL sans date exploitable, formulaire de l'association de propriétaires, capture Véhicule C tant
  que Marc n'a pas tranché) ; revue flotte AVANT merge ; mutations sur chaque nouveau prédicat.
- Impact quotas : une passe complète re-évalue ~89 fichiers + fusion Bailleur A (~30 fichiers) — < 5 min
  I/O au total, dans le budget quotidien existant.

## 5. Découpage

- **PR1 (c49-2)** : table bailleur (preuves §2, dont 2 complétées par LECTURE DE CONTENU) +
  canons partagés (`logementDuBailleur_`, `vehiculeDuNom_`) + structure PAR VÉHICULE (décision
  Marc) + Marque K + geste symétrique 03 + drainage Bailleur A + bump version + tests/mutations. **Trace
  §8-2** : l'audit sur du réel a eu lieu EN SESSION le 17/08 (listings Drive des 7 sources +
  des 5 cibles logement, lecture du contenu des 2 bails ambigus) — les tests c49-2 encodent ces
  MÊMES noms réels (CAS, t4 réécrits, reconduction/résiliation/quittance).
- **BUMP c49-3 planifié (post-drainage)** : le gate de complétude des fenêtres véhicule (revue
  finale — router par fenêtre sur un jeu incomplet aurait été un faux positif définitif) fait
  que les génériques datés du run 1 sont REFUSÉS tant que Marque K n'a pas sa fenêtre. Une fois le
  drainage nominal convergé (Marque K rempli par les fichiers nommés), bumper c49-3 re-présente ces
  refus aux fenêtres mûres. Vérifier AUSSI au déploiement : aucune entité validée du référentiel
  ne pointe encore (Dossier ID) le double Bailleur A ou un ancien chemin pluriel.
- **PR2 (option)** : surface app « résolution manuelle » si le reliquat post-c49-3 le justifie.
