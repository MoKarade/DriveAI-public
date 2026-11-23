# ADR-0080 — Alignement sur le référentiel de classement & nommage à 9 piliers

- **Statut** : **Accepté** (19/11/2026 — déploiement progressif en 2 PR sous `#880`, applicable aux nouveaux documents entrants et à l’écran `État`, sans migration de masse).
  **Complète** : ADR-0002 (taxonomie & nommage), ADR-0030 (structure cible), ADR-0033 (unification flux ↔ table), ADR-0052 (zéro fichier à plat), ADR-0058 (domicile des paies et feuillets). **Inchangés** : ADR-0007 (vie privée), ADR-0016 (fail-safe), garde-fous §1 (`docs/claude/01-principes.md`, zéro suppression, `04 · Immigration` sanctuarisé).

## 1. Contexte et cadrage

L’arborescence Google Drive du propriétaire suit désormais un référentiel unifié à 9 piliers (`01` à `09`) doté de règles explicites de nommage, d’aiguillage des factures, de destination des assurances et d’exclusions techniques. Or, le moteur DriveAI conservait encore l’ancienne arborescence cible et d’anciennes conventions (bulletins de paie nommés `AAAA-MM_Paie_…`, factures énergie/santé routées sous `03` ou `07`, sous-dossiers obsolètes recréés par nom à chaque nouveau classement).

Arbitrages validés avec le propriétaire le 19/11/2026 :

1. **Portée sur les fichiers** : appliquer les nouvelles règles **uniquement aux nouveaux documents entrants** (pièces jointes Gmail, dépôts `00 · À trier`, documents partagés récents) et mettre à jour la carte explicative « Comment DriveAI classe et trie » dans l’application web (`État`). **Aucune migration ni déplacement de masse** sur les dossiers déjà rangés.
2. **Périmètre d’espace** : rester sur l’espace principal du propriétaire ; les pièces des tiers et proches dans cet espace sont orientées vers les sous-dossiers `Autres` avec `<Prénom Nom>` en fin de fichier.
3. **Zéro donnée personnelle dans le dépôt** : tout exemple dans le code, les prompts, la documentation et les tests reste fictif (`Alphatek`, `Betatek`, `Bellerives`, `CMF`, `1201 rue Exemple Alpha`, `Lise Modèle`) ; les libellés réels vivent exclusivement dans `driveai-profil-prive.json` sur Drive (hors Git).

## 2. Décisions

### 2.1 Règle stricte des factures (la nature prime sur le thème)

Toutes les factures et tous les reçus de paiement (énergie, télécom/Internet, santé/optométrie/pharmacie, achats en ligne, amendes payées, abonnements SaaS & API) sont dirigés **exclusivement** vers `02 · Finances / Reçus & factures / <Année>` (et `2026/Abonnements SaaS & API` pour les outils logiciels datés 2026+, ou `Autres` sans année lisible), **jamais** vers `03 · Logement & véhicule`, `07 · Santé` ni `01 · Administratif & identité`.

Garde-fous et frontières :
- `04 · Immigration` demeure **sanctuarisé** : aucun document classé en `04` n’en sort automatiquement ;
- les bulletins de paie et pièces d’identité conservent leurs règles dédiées ;
- les baux, contrats initiaux, polices d’assurance, garanties constructeur, certificats d’immatriculation, rapports d’inspection, ordonnances, analyses et décomptes d’assurance santé (hors factures) restent dans leur pilier thématique (`01`, `03`, `07`).
- Les participes passés de courrier (« Courriel reçu ») et factures disqualifiées par leur nature non-dépense ne sont pas détournés.

### 2.2 Standard de nommage par périodicité (`DATE_Nature précise_Émetteur ou Titulaire.ext`)

- **Granularité jour (`AAAA-MM-JJ_`)** : `Bulletin de paie` (`AAAA-MM-JJ_Bulletin de paie_<Employeur>.ext`), factures et reçus, contrats, baux, polices d’assurance, courriers, actes notariés, billets, pièces d’identité, permis de conduire, **diplômes** et **CV envoyés**. Toujours utiliser la date réelle du document (émission, signature ou paie), jamais la date de scan ou de téléchargement.
- **Granularité mois (`AAAA-MM_`)** : relevés périodiques mensuels (`Relevé`, basculant sur `AAAA-MM-JJ_` si plusieurs relevés couvrent le même mois).
- **Granularité année (`AAAA_`)** : feuillets fiscaux et déclarations annuelles (`T4`, `Relevé 1` / `RL-1`, `Relevé 31` / `RL-31`, `T5` / `RL-3`, `T183` / `TP-1000`, `Avis de cotisation`, `Déclaration de revenus`, `Avis d'imposition`), en utilisant **l’année fiscale d’imposition des revenus** (ex. un `T4` reçu en février 2026 pour les revenus 2025 s’écrit `2025_Feuillet T4_Alphatek.pdf` et se range dans `Impôts & déclarations/2025`).
- `Relevé de notes` / `Bulletin de notes` et travaux scolaires (`TP`, `Devoir`, `Examen`, `Cours`) conservent la granularité annuelle ; seuls les gabarits vierges réutilisables (modèle de CV) sont sans date.

### 2.3 Matrice des assurances (5 destinations) et piège adresse postale

Les prompts 2 passes (`src/Llm.gs`) et le routage orientent chaque assurance selon l’objet assuré :
1. **Habitation** → `03 · Logement & véhicule / Logement / <Adresse assurée> / Assurance habitation` (lire la rubrique « Emplacement du risque assuré », jamais l’adresse postale d’expédition) ;
2. **Auto & remplacement** → `03 · Logement & véhicule / Véhicule / <Véhicule>` (ou ses sous-dossiers configurés d’assurance/sinistres) ;
3. **Voyage** → `09 · Voyages / Assurances voyage` ;
4. **Santé & régime public** → `07 · Santé / Assurances santé` (hors factures) ;
5. **Prévoyance & crédit** → `02 · Finances / Assurances & prévoyance`.

### 2.4 Arborescence cible 9 piliers et exemption nominative

La table `structureCibleReset_()` et le routage reflètent exactement les 9 piliers actuels :
- `01 · Administratif & identité` (5 nœuds) : `Pièces d'identité & permis` (+ `Autres`, pièces du propriétaire directement à la racine du dossier), `État civil & notarial` (+ `Autres`), `Attestations & contrats` (+ `Autres`), `Correspondance` (+ `Autres`), `Sécurité & codes` ;
- `02 · Finances` (**8 nœuds, exemption nominative déclarée dans `exemptionsPlafondReset_()`**) : `Banques` (+ `Autres`), `Relevés` (`2023`–`2026`), `Reçus & factures` (`2021`–`2026` dont `2026/Abonnements SaaS & API`, + `Autres`), `Impôts & déclarations`, `Assurances & prévoyance`, `Placements & crypto`, `Revenus & paie` (un dossier plat par employeur, jamais de sous-dossiers d’années), `Budgets & suivi` ;
- `03 · Logement & véhicule` (2 nœuds racine) : `Logement/<Adresse>/Assurance habitation` + `Anciens logements`, et `Véhicule/<Véhicule>` (plat par défaut, sous-dossiers configurables sur un véhicule) + `Recherche & achat` ; aucun dossier énergie/contrats/correspondance/travaux résiduel à la racine de `03` ;
- `04 · Immigration` (5 nœuds internes, sanctuarisé) : `Résidence permanente` (`Boulot`, `Identité`, `Études & Diplômes`, `Formulaires, fiscalité & preuves RP`), `Permis de travail & EIMT`, `IRCC (fédéral)`, `MIFI (Québec)`, `Autres` ;
- `05 · Carrière` (4 nœuds) : `Employeurs/<Employeur>` (à plat, contrats/offres/avenants/attestations RH uniquement — jamais de bulletins de paie), `Entreprise — MRic (SCI)`, `CV & lettres` (`CV & modèles`, `Lettres de motivation (Archives)`), `Recherche d'emploi` ;
- `06 · Études & diplômes` (4 nœuds) : `Diplômes & relevés officiels`, `Archives scolaires/<École>`, `Formations en ligne — Google AI Essentials` (à la racine de `06`), `Autres` ;
- `07 · Santé` (3 nœuds) : `Dossier médical & vaccins` (hors factures), `Assurances santé`, `Autres` ;
- `08 · Perso & projets` (6 nœuds) : `Projets` (`DriveAI`, projet personnel, `Autres`), `Photographie & souvenirs` (`RAW Canon R50 (2024)`, `Photos souvenirs`), `Sport & sorties`, `Jeux vidéo & captures`, `Schémas & technique`, `Données & exports` ;
- `09 · Voyages` (3 nœuds) : `Par voyage` (`Brésil`, `Chine`, `Finlande`, `Pérou`, `Québec — Visite famille (2025-2026)`), `Réservations & billets` (`2020–2023`, `2024`, `2025`, `2026`, `Autres`), `Assurances voyage`.

### 2.5 Exclusions techniques et sécurité des secrets

- `estExcluDuReset_()` exclut désormais `restic-pc`, `univers` (nom exact, jamais un mot comme « université ») et `00 · Raccourcis…` en plus de `DriveAI`, `Rapports agent` et `00 · Guide` ; `Maintenance.gs` et `Reorg.gs` s’abstiennent d’explorer ou de proposer ces dossiers.
- Aucun mot de passe, code de secours 2FA ni phrase secrète crypto en clair ne doit être encouragé ou stocké : `Sécurité & codes` conserve uniquement des identifiants matériels (IMEI, série, MAC) et clés publiques.
- Compatibilité profil privé : `PROFIL_VERSION_ATTENDUE` reste à `6` afin qu’aucun tick automatique ne soit sauté entre le déploiement du code et la synchronisation de `driveai-profil-prive.json` sur Drive.

## 3. Impact coûts, quotas et risques

- **Coût et quotas** : **0 $** supplémentaire ; le pipeline 2 passes (`ANALYSE_V2`, Sonnet ×2/doc) et les plafonds quotidiens restent inchangés.
- **Scopes OAuth** : inchangés (`src/appsscript.json`).
- **Risques identifiés** :
  - un libellé contenant « reçu » au participe passé (`Courriel reçu`) pourrait être détourné vers `02 · Finances` : mitigé par exclusion explicite de courrier/message/lettre sans mot de facture/paiement ;
  - une facture légitimement archivée sous `04 · Immigration` pourrait en être sortie : mitigé par verrou explicite `c.domaine !== '04 · Immigration'` avant la règle stricte des factures ;
  - un écart entre noms de dossiers du Drive réel et `driveai-profil-prive.json` recréerait un dossier homonyme : mitigé par vérification caractère pour caractère des noms de dossiers et synchronisation du profil privé sur Drive en PR 2.

## 4. Audit comparatif et méthode de preuve

Conformément à `docs/claude/11-protocole-de-precision.md` :
- **Audit comparatif (~20 cas représentatifs fictifs)** ajouté dans `test/audit-logique.test.js` : compare avant/après (nommage, domaine et cible) sur factures Hydro/télécom/pharmacie/optométrie/garage/SaaS/amende, bulletin de paie, T4 reçu en N+1 pour l’année fiscale N, RL-1, RL-31, suivi budgétaire, relevé mensuel, courrier bancaire, assurances (habitation, auto, voyage, santé), ordonnance, diplôme, CV, permis `04` protégé et pièce de proche.
- **Livraison en 2 PR** sous `#880` :
  - PR 1 : ADR-0080, nommage, règle stricte des factures, prompts LLM, exclusions techniques, audit ~20 cas ;
  - PR 2 : arborescence 9 piliers (`Reset.gs`/`Router.gs`), carte explicative `État` (`app/src/i18n.ts`), synchronisation de `driveai-profil-prive.json` sur Drive et vérification en production.
