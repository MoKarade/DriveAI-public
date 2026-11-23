# Déploiement DriveAI — Phase 1, étape par étape

> Comment faire tourner le moteur (`src/`) dans ton compte Google. ~20 min la première fois.
> Tenu à jour à chaque évolution du moteur.

---

## ⚡ Déploiement 100 % automatique (à configurer UNE fois, ~3 min)

> Objectif : **plus jamais de `clasp push` ni de fonction à lancer à la main.** Après ce réglage
> unique, chaque évolution mergée sur `main` est **déployée toute seule** chez toi (GitHub Action
> `clasp push`), et le moteur **rejoue automatiquement** les dépôts partis en revue quand la logique
> de classement change (`CONFIG.VERSION`). Le scan tourne déjà tout seul toutes les 10 min
> (`CONFIG.TICK_MINUTES` ; l'intervalle se ré-applique seul au déploiement, sans re-`installerTrigger`).
>
> **Depuis le 2026-07-31 (ADR-0032, C28-43) : le DERNIER geste manuel a disparu.**
> - `installerTrigger` après un merge moteur : **fait par la CI** (`deploy.yml` appelle l'action
>   `assurer-trigger` de la web app juste après le redéploiement, et confirme par un signal
>   indépendant — un `ok:true` nu ne suffit pas). C'était le geste qui garantissait que le
>   déclencheur exécute bien le NOUVEAU code (sans lui : prod figée ~4 jours vécue, CI verte).
> - `lancerResetTout()` pour accélérer le grand rangement : **fait par la CI**
>   (`pousser-reset.yml`, toutes les 15 min), qui pousse les mêmes passes que tes clics — hors du
>   quota des déclencheurs, donc sans jamais rogner sur le budget du tick. Le pilote **s'arrête
>   tout seul** à la convergence. Les fonctions un-clic restent disponibles comme filet, mais tu
>   n'as plus aucune raison de les lancer.
>
> Aucun nouveau secret à configurer : le pilote réutilise `DRIVEAI_WEBAPP_URL` +
> `DRIVEAI_SYNC_SECRET` (secret CI dédié, propriété du script + secret GitHub).

**Pourquoi une config manuelle unique ?** Déployer dans *ton* compte Google exige un identifiant que
toi seul peux générer — personne d'autre ne peut y accéder (c'est une protection). Tu le déposes une
fois dans GitHub (chiffré), et c'est fini.

1. **Génère l'identifiant clasp** (en local, une fois) :
   ```bash
   npm install -g @google/clasp
   clasp login          # autorise avec TON compte Google
   cat ~/.clasprc.json  # copie tout le contenu affiché
   ```
2. **Récupère l'ID du script** : ouvre `.clasp.json` (créé par `clasp create`/`clasp clone`) → champ
   `scriptId`. *(Ou dans l'éditeur Apps Script : Paramètres du projet → « ID ».)*
3. **Dépose-les comme secrets GitHub** : repo `DriveAI` → **Settings → Secrets and variables →
   Actions → New repository secret** :
   - `CLASPRC_JSON` = le contenu de `~/.clasprc.json` (étape 1) ;
   - `SCRIPT_ID` = le `scriptId` (étape 2).
4. **C'est tout.** À la prochaine PR mergée, l'Action **Deploy** pousse le code automatiquement.
   *(Tant que les secrets sont absents, l'Action ne fait rien et reste verte — aucun échec.)*

> ⚠️ Sécurité : `~/.clasprc.json` contient un jeton OAuth Google. Il vit **uniquement** dans les
> secrets GitHub (chiffrés), jamais dans le code. Pour révoquer : `clasp logout` + retire le secret.

Le reste de ce document (voies A/B manuelles) reste valable comme repli ou pour le tout premier
déploiement (création du projet Apps Script, clé Anthropic, trigger).

## Prérequis

- Ton compte Google (celui qui possède le Drive « Nouvelle structure 2026 »).
- Une **clé API Anthropic** (la *nouvelle* — l'ancienne, partagée en chat, est à révoquer).
- Pour la voie clasp : **Node.js** installé (`node -v`).

---

## Voie A — clasp (recommandée : synchronisée avec le repo)

### 1. Installer et connecter clasp
```bash
npm install -g @google/clasp
clasp login           # ouvre le navigateur → autorise avec TON compte Google
```

### 2. Activer l'API Apps Script (une fois)
Va sur **https://script.google.com/home/usersettings** et active **« Google Apps Script API »**.

### 3. Créer le projet Apps Script lié au repo
Depuis la racine du repo (qui contient `src/`) :
```bash
clasp create --type standalone --title "DriveAI" --rootDir src
```
- Cela crée le projet et un fichier `.clasp.json` (déjà gitignoré).
- ⚠️ Si clasp écrase `src/appsscript.json`, restaure le nôtre : `git checkout src/appsscript.json`.
  *(Alternative : copie `.clasp.json.example` → `.clasp.json`, mets le `scriptId` d'un projet créé à la main.)*

### 4. Pousser le code
```bash
clasp push        # téléverse src/*.gs + appsscript.json
```
Puis **ouvre l'éditeur** : copie-colle dans ton navigateur l'URL affichée par `clasp create`
(`https://script.google.com/d/<scriptId>/edit`). *(La commande `clasp open` n'existe plus en
clasp v3 ; selon ta version, `clasp open-script` peut aussi fonctionner.)*

### 5. (OCR) Rien à activer
L'OCR appelle l'API Drive **en REST via `UrlFetchApp`** (scope `drive` déjà accordé) — **aucun
service avancé à activer**. Si un jour le `Journal` montre des `ERREUR OCR : HTTP 403`, c'est que
l'API Drive du projet est désactivée : panneau **Services** (＋) → ajoute **Drive API** une fois.

### 6. Mettre la clé API (jamais dans le code)
> ⚠️ **Jamais par l'interface « Propriétés du script »** sur un projet déjà installé : elle n'affiche que les 50 premières
> propriétés et a ÉCRASÉ les autres le 24/10/2026. Poser ou changer une clé = un fichier temporaire `tmp.gs` dans l'éditeur,
> une fonction nommée qui appelle `PropertiesService.getScriptProperties().setProperties({ NOM: 'valeur' }, false)`
> (`false` = ne rien effacer), l'exécuter, puis **supprimer le fichier**. La valeur ne finit jamais dans un commit ni un message.

- Nom : `DriveAI_GEMINI_KEY` (ADR-0073) — clé de l'API Gemini, **palier payant** (crédit prépayé, plafond 20 $/mois), créée
  dans Google AI Studio. Avant la bascule (étape 5), elle sert à la sonde `sonderGemini` (éditeur → exécuter → un `OK` par
  modèle). Absente : panne de compte, aucun document compté en échec.
- Nom : `DriveAI_ANTHROPIC_KEY` — clé Anthropic, lue tant que des modèles `claude-…` sont appelés (retirée à l'étape 5).
- Nom : `DriveAI_EMAIL` — **destinataire des alertes et du résumé hebdo** (check-up 2026-07-03 :
  `Session.getEffectiveUser()` exige un scope absent du manifeste, donc sans cette propriété AUCUN
  mail ne part — le Journal trace « pose la Script Property DriveAI_EMAIL »).
  Valeur : ton adresse Gmail.
- ⚠️ **Scope `gmail.modify` (chantier #16, mergé le 2026-07-06)** : son déploiement gèle TOUS les
  déclencheurs jusqu'à une **ré-autorisation manuelle** — ouvrir l'éditeur Apps Script
  (script.google.com), sélectionner `tickDriveAI`, « Exécuter », accepter le nouvel écran de
  consentement. Le code ne peut NI supprimer un mail, NI toucher au Spam, NI créer/retirer un
  libellé (verrou CI `surface-gmail-ecriture`). Après ré-autorisation, vérifier la reprise par
  signaux Drive indépendants (heartbeat Sheet, premiers libellés posés). Règle générale : toute PR
  qui étend un scope porte `do-not-merge` et ne se merge qu'avec Marc disponible dans la foulée.

### 7. Installer le déclencheur (10 min) — PREMIÈRE INSTALLATION SEULEMENT
> ⚠️ Cette étape ne vaut que pour la **toute première** mise en route (elle sert surtout à déclencher
> l'écran de consentement OAuth, qu'un déclencheur automatique ne peut pas demander à ta place).
> Ensuite, la CI réinstalle le déclencheur à chaque merge moteur (ADR-0032) — plus jamais à la main.

Dans l'éditeur, sélectionne la fonction **`installerTrigger`** dans la barre d'outils → **Exécuter**.
- Google affiche un écran de **consentement** listant les autorisations (Gmail lecture seule,
  Drive, requêtes externes, Sheets, envoi de mail, gestion des déclencheurs). **Autorise.**
- Vérifie : icône **Déclencheurs** (réveil) → un déclencheur `tickDriveAI` toutes les 10 min.
- *(La fréquence vit dans `CONFIG.TICK_MINUTES` ; si tu la changes plus tard, le moteur réinstalle
  le déclencheur tout seul au déploiement suivant — pas besoin de relancer `installerTrigger`.)*

### 8. C'est en route
Au premier passage, DriveAI crée la Google Sheet **« DriveAI — État »** (son ID est stocké dans
la propriété `DriveAI_SHEET_ID`). Onglets : `Entités`, `Index`, `Journal`, `Revue`.

---

## Voie B — sans clasp (copier-coller)

1. **https://script.google.com** → **Nouveau projet** → renomme-le « DriveAI ».
2. Paramètres du projet → coche **« Afficher le fichier manifeste appsscript.json dans l'éditeur »**.
3. Pour chaque fichier de `src/` (`Config.gs`, `Gmail.gs`, `Ocr.gs`, `Llm.gs`, `Router.gs`,
   `Journal.gs`, `Main.gs`), crée un fichier de même nom et **colle le contenu**.
4. Ouvre `appsscript.json` dans l'éditeur et colle le contenu de `src/appsscript.json`.
5. Services (＋) → ajoute **Drive API** (v2).
6. Clés `DriveAI_ANTHROPIC_KEY` et `DriveAI_GEMINI_KEY` : par `setProperties(obj, false)`, voir la voie A §6.
7. Exécute **`installerTrigger`** → autorise les scopes.

---

## Tester (recette de la DoD Phase 1)

> Astuce : pour ne pas attendre 10 min, exécute **`tickDriveAI`** à la main dans l'éditeur.

1. **Cas nominal** — envoie-toi un mail avec une **PJ PDF** (ex. une facture Hydro-Québec).
   Lance `tickDriveAI`. Attendu : un fichier `AAAA-MM-JJ_Facture_Hydro-Quebec.pdf` apparaît dans
   `02 · Finances/<année>` (ou le bon domaine), et une ligne « classé » dans l'onglet `Journal`.
2. **Cas ambigu** — une PJ peu lisible part dans **`00 · À vérifier`** avec un nom
   `[REVUE] confiance 0.xx — … — …` ; une ligne apparaît dans l'onglet `Revue`.
3. **Zone protégée** — un courrier d'immigration (ex. IRCC) va **toujours** dans
   `00 · À vérifier`, jamais rangé auto.
4. **Idempotence** — relance `tickDriveAI` : aucune PJ déjà traitée n'est re-déposée (vérifie
   l'onglet `Index`).
5. **Échec** — coupe la clé API (mauvaise valeur), relance : tu reçois un **mail d'alerte** et une
   ligne `ERREUR` dans `Journal`. Remets la bonne clé.

---

## Audit du tri sujet + corps (ADR-0075 ; 6b allumée le 06/11/2026, ré-audit après la bascule Gemini)

**Sans geste de Marc (depuis le 06/11/2026, « fais tout toi »)** : Actions → « Pilote de la web app (rangement, audit
du tri) » → Run workflow → `action = audit-tri`. Préalable unique : le workflow doit être **activé** dans l'onglet
Actions (désactivé à la main le 24/09/2026, quand le cron du reset a cessé de servir ; GitHub refuse un lancement sur
un workflow désactivé). Le run (sur le PC, secrets `DRIVEAI_WEBAPP_URL` + `DRIVEAI_SYNC_SECRET` déjà en place) POSTe
`action=audit-tri` à la web app, qui exécute `auditerTriSujetCorpsDetail_` sous le verrou du tick (mêmes portes, même
onglet, lecture pure, au plus une fois par heure ; fenêtre rendue si rien n'a tourné) et rend des COMPTEURS (fils
comparés, accords, ⏰ nouveaux, ⏰ retirés) et, par ligne qui diverge, sa ligne dans l'onglet, les verdicts, la zone et
les portes. Au journal CI : ces compteurs et ces lignes, jamais un sujet, un domaine ni un libellé. Le run est rouge si
l'audit n'a pas tourné ou n'a rien comparé (panne LLM, tick en cours, anti-rafale, secret refusé, version servie sans
l'action). Ce que le journal permet de juger seul : les accords et le nombre de ⏰ nouveaux. Ce qu'il ne permet pas :
dire si une ligne qui diverge avait raison, ni si un ⏰ nouveau tombe sur un relevé ou un reçu (il faut le sujet) :
pour cela, le fil Claude fait lire les lignes citées de l'onglet « Audit tri » sur le PC de Marc (fil PC), jamais par
la CI, puis écrit le verdict (ADR-0075 §3) avec sa preuve.

**À la main (filet)** : éditeur Apps Script → fonction `auditerTriSujetCorps` → Exécuter (≈ 20 fils, quelques cents
comptés sous `audit-tri`, AUCUNE écriture Gmail ni Index ; refuse de tourner pendant une panne LLM). Lire l'onglet
`Audit tri` de la Sheet « DriveAI — État » : une ligne par fil, catégorie et « à traiter » d'aujourd'hui contre ceux
de demain, portes fermées (jamais le corps). Sur chaque ligne où « Important aujourd'hui » et « À traiter sujet+corps »
divergent, la colonne « Verdict Marc » dit qui a raison (oui = le mail méritait ⏰). 6b passe si « demain » a raison au
moins aussi souvent qu'« aujourd'hui », et aucun ⏰ nouveau sur un relevé, un reçu ou une promo. Le oui vaut pour le
modèle qui a produit l'onglet : si la bascule Gemini (étape 5) passe avant 6b, relancer l'audit. L'onglet se supprime
à la main après lecture.

## Phase 2 — dépôt manuel & référentiel d'entités

> Déployée par le même `git pull && clasp push`. **Aucun nouveau scope** à autoriser.

### Dépôt manuel (`00 · À trier`)
Glisse n'importe quel fichier dans le dossier **`00 · À trier`**. Au tick suivant (ou via
`tickDriveAI`), il est analysé comme une PJ Gmail puis **déplacé** (jamais copié, jamais effacé)
vers son dossier de destination — ou vers `00 · À vérifier` s'il est ambigu/sensible.
*(Les fichiers Google natifs — Docs/Sheets déposés — sont laissés en place : déposer des PDF/images.)*

### Référentiel d'entités (onglet `Entités`)
Pour ranger au niveau **entité** (un dossier par logement, banque, diplôme…), DriveAI s'appuie sur
l'onglet **`Entités`** (colonnes auto-créées : `Entité | Domaine | Catégorie | Type | Statut |
Dossier ID | Ajoutée le`).

1. Quand DriveAI rencontre une **entité inconnue**, il ajoute une ligne **pré-remplie** avec
   `Statut = en_attente` et envoie le document en revue (aucun dossier créé).
2. Pour **valider** : passe le `Statut` de la ligne à **`validée`** (corrige le nom/type si besoin).
   Types reconnus pour les sous-dossiers fixes : `Logement`, `Véhicule`, `Compte financier`, `Diplôme`.
3. Au tick suivant, DriveAI **crée le dossier d'entité** + ses sous-dossiers fixes et y range les
   documents de cette entité. (Pour re-router un document déjà classé ailleurs : onglet
   **Corrections** de l'app web — déplacement immédiat + apprentissage.)

### Doublons & multi-entités
- Un fichier dont le **contenu** est déjà présent (même empreinte) est **écarté dans `_Doublons`**
  (déplacement seul, **jamais effacé**).
- Un document concernant **plusieurs entités connues** est rangé une fois (entité primaire) avec un
  **raccourci Drive** dans les autres (jamais de copie).

---

## Phase 3 — tâches & agenda (remplace l'agent mail externe de Marc) — RETIRÉE le 05/11/2026 (ADR-0074)

> **Section historique.** Depuis le 05/11/2026 (ADR-0074, étape 3), DriveAI ne crée plus ni tâche ni
> rendez-vous : `Tasks.gs`, `Calendar.gs`, `GoogleApi.gs`, `JetonHubperso.gs` et l'extraction
> d'intentions sont retirés ; depuis le 06/11/2026 (ADR-0075 6b) l'analyse d'importance séparée l'est aussi :
> c'est le tri Gmail qui pose ⏰ « À traiter » sur le sujet et le corps. Rien
> de ce qui suit n'est à faire ni à tester ; le texte est gardé pour lire les anciens Journaux.
>
> Déployée par le même `git pull && clasp push` automatique. **Nouveaux scopes** (Tasks +
> Calendar) → **une seule ré-autorisation manuelle** est nécessaire (voir ci-dessous), c'est la
> SEULE action que Marc doit faire pour cette phase.

### Ce que ça fait
DriveAI scanne désormais **tous les mails récents** (pas seulement ceux avec pièce jointe) pour
détecter des **actions à faire** (« payer avant le 15 », « renvoyer le formulaire ») et des
**rendez-vous datés** (« RDV le 3 juillet à 14h »), et crée automatiquement :
- une **tâche Google Tasks** (liste par défaut) pour une action/échéance ;
- un **événement Google Calendar** (agenda principal) pour un rendez-vous avec date ET heure.

Création **100 % automatique**, zéro validation. Pré-filtre à 3 étages (mots-clés gratuits → zone
protégée gratuite → mini-check Haiku peu coûteux) avant toute extraction complète, pour rester
largement sous le budget de 10 $/mois (~1-4 $/mois estimé pour ce flux). Les mails immigration/
fiscaux ne génèrent **jamais** de tâche/événement (garde-fou §1, indépendant du LLM) — ils restent
gérés par le classement documentaire existant.

### ⚠️ Action manuelle unique : ré-autoriser les nouveaux scopes

L'ajout des scopes `tasks` et `calendar.events` au manifeste (`appsscript.json`) signifie que le
**déclencheur existant** (`tickDriveAI`, toutes les 10 min) va se mettre à échouer avec une erreur
d'autorisation dès que le nouveau code est déployé — Apps Script exige un consentement explicite
pour toute nouvelle permission, et un déclencheur automatique ne peut pas le demander tout seul.

**Pour réautoriser (30 secondes, une seule fois)** :
1. Ouvre l'éditeur Apps Script du projet DriveAI.
2. Dans la barre d'outils, sélectionne n'importe quelle fonction (ex. `installerTrigger`) → **Exécuter**.
3. Google affiche l'écran de consentement avec les **2 nouvelles autorisations** (Tasks, Calendar) en
   plus des précédentes. **Autorise.**
4. C'est tout — le déclencheur existant reprend normalement au tick suivant, plus besoin de
   relancer quoi que ce soit après cette étape unique.

*(Tant que cette ré-autorisation n'est pas faite, le `Journal` affichera des erreurs sur le flux
« Intentions » uniquement — le classement documentaire des Phases 1-2, lui, continue de tourner
normalement : ce nouveau scope n'affecte pas les permissions déjà accordées.)*

> **Chantier #6 (formulaire de correction) — même procédure, scope `forms`.** L'ajout de
> `https://www.googleapis.com/auth/forms` (création + lecture du formulaire de correction, ADR-0003)
> exige la **même ré-autorisation unique** que ci-dessus : au prochain déploiement, exécute une
> fonction depuis l'éditeur Apps Script et **autorise** le nouvel accès Forms. Au premier tick après
> autorisation, DriveAI **crée le formulaire tout seul** (find-or-create) et journalise son URL
> (`Journal`, source « Corrections ») ; l'URL apparaît aussi dans le **résumé hebdo**. Tant que le
> scope n'est pas accordé, seule la lecture des corrections échoue (enveloppée d'un try/catch) — le
> classement continue normalement.

### Tester
1. Envoie-toi un mail avec un objet du type « Rendez-vous chez le dentiste le 15 juillet à 14h ».
   Lance `tickDriveAI`. Attendu : un événement apparaît dans Google Calendar (agenda principal).
2. Envoie-toi un mail « Penser à renouveler le passeport avant fin août » — **attendu : RIEN n'est
   créé** (zone protégée, mot-clé « passeport ») — vérifie une ligne `intention-zone-protegee`
   dans l'onglet `Index`.
3. Envoie-toi un mail anodin sans action (« Voici les photos des vacances ») — attendu : aucune
   tâche/événement créé (`intention-aucune` dans `Index`).
4. Relance `tickDriveAI` : aucun doublon de tâche/événement (vérifie Tasks/Calendar directement).

---

## Phase 4 — app web (tableau de bord + corrections, ADR-0008)

L'app (`app/`, React/Vite/TS) parle directement aux API Google avec **ton** jeton (login Google) ;
rien n'est public, aucun secret embarqué côté navigateur. Depuis **C28-14 (session durable)**, elle
embarque 4 petites **fonctions serverless Vercel** (`api/login|callback|refresh|logout`, à la racine
du dépôt) qui portent le flux OAuth « Authorization Code » : tu te connectes **une fois**, le
refresh token vit dans un cookie **HttpOnly chiffré** (invisible au JavaScript), et l'app renouvelle
son jeton d'accès en silence — plus jamais de reconnexion.

### 1. Client OAuth (Google Cloud, une fois)
1. Dans le **même projet Google Cloud** que le script Apps Script : **API et services → Identifiants
   → Créer → ID client OAuth → Application Web** (ou ouvre le client existant).
2. **URI de redirection autorisés** (C28-14, flux code) :
   `https://<ton-domaine>.vercel.app/api/callback` + `http://localhost:5173/api/callback` (dev).
   Les « Origines JavaScript » de l'époque GIS ne servent plus.
3. **Code secret du client** : note le `Client secret` (génère-le s'il n'existe pas) — il va dans
   Vercel à l'étape 2, jamais dans le code ni dans le navigateur.
4. **Écran de consentement** : type Externe, ajoute `prenom.nom@exemple.com` en **utilisateur test**
   (l'app peut rester en mode « test » — usage perso).
5. Active les API **Google Sheets** et **Google Drive** dans ce projet (probablement déjà fait).

### 2. Projet Vercel (une fois)
1. **Import du repo GitHub** — la config est portée par `vercel.json` à la racine (build de `app/`,
   fonctions serverless de `api/`). **Root Directory = racine du dépôt** (pas `app`).
2. **Variables d'environnement (Settings → Environment Variables)** — les **7** sont REQUISES
   (zéro configuration client, C28-20/ADR-0021 : l'app ne demande PLUS rien au premier lancement,
   tout vient du serveur via `/api/config`) :
   - `GOOGLE_CLIENT_ID` — l'ID client OAuth de l'étape 1 ;
   - `GOOGLE_CLIENT_SECRET` — son code secret ;
   - `COOKIE_SECRET` — longue chaîne aléatoire (ex. `openssl rand -hex 32`) qui chiffre le cookie ;
   - `ALLOWED_EMAIL` — `prenom.nom@exemple.com` : **le PROPRIÉTAIRE**. Depuis l'étape 3 de
     l'ADR 0001 de Hubperso, ce n'est plus « la seule adresse admise » mais « celle qui entre
     toujours, SANS dépendre du hub ». Indispensable : une panne du hub ne doit jamais enfermer
     Marc dehors de sa propre app. Les autres personnes s'accordent depuis la page
     d'administration du hub (`exemple.com/administration`), app par app — elles n'apparaissent
     jamais ici, et se retirent au même endroit ;
   - `SPREADSHEET_ID` — l'ID de la Google Sheet d'état ;
   - `WEBAPP_URL` — l'URL `/exec` de la web app Apps Script (bouton « Vérifier maintenant ») ;
   - `WEBAPP_SECRET` — la valeur de la Script Property `DriveAI_WEBAPP_SECRET` ;
   - `SENTRY_DSN` — OPTIONNELLE (#495) : le DSN du projet Sentry `driveai` (Réglages > Client Keys).
     Sans elle, Sentry reste éteint et rien ne change. Avec elle, les fonctions Vercel
     (`/api/hub/summary`, accès au hub) et le navigateur (via `/api/config`, session
     exigée) signalent leurs erreurs, SANS donnée personnelle : voir `docs/claude/06-deploiement.md`.
   Les anciennes `VITE_SPREADSHEET_ID` / `VITE_WEBAPP_*` ne servent plus (elles figeaient la
   config au BUILD ; supprime-les si présentes).

   **`HUB_TOKEN` devient nécessaire pour inviter quelqu'un d'autre que le propriétaire.** Elle
   restait optionnelle tant qu'elle ne servait qu'au widget du hub (voir plus bas) ; elle sert
   désormais AUSSI dans l'autre sens — c'est le jeton avec lequel DriveAI demande au hub
   « cette adresse a-t-elle le droit d'entrer chez moi ? » (`api/_accesHub.ts`). Sans elle,
   DriveAI fonctionne normalement **pour le propriétaire seul** : toute autre adresse est
   refusée, échec fermé. Aucun secret nouveau à créer, c'est la même valeur qu'en face
   (`HUB_TOKEN_DRIVEAI` côté Hubperso).

   **`HUB_URL`** — OPTIONNELLE. Défaut : le domaine PARENT du domaine de production du projet
   (variable système Vercel `VERCEL_PROJECT_PRODUCTION_URL`, `api/_domaine.ts`), jamais écrit dans le code.
   Sans elle, et si le domaine de production est un `*.vercel.app`, l'appel au hub est refusé (échec fermé :
   le jeton ne part pas). À ne poser que pour pointer un déploiement de test du hub.

   **Variable OPTIONNELLE — intégration hub perso** (`GET /api/hub/summary`, widget DriveAI sur
   `exemple.com`) :
   - `HUB_TOKEN` — secret partagé avec le hub. Le hub l'envoie dans le header `x-hub-token` ; le
     endpoint le compare en temps constant. **Absente → l'endpoint répond `503 hub disabled`**
     (échec fermé, intégration désactivée) : DriveAI fonctionne normalement sans elle. Génère une
     valeur longue aléatoire (`openssl rand -hex 32`), pose-la **à l'identique** ici et dans la
     config du hub. Jamais en dur dans le code. Pour révoquer : change la valeur des deux côtés.

   Depuis C28-27 (métriques réelles), le endpoint relaie vers la web app Apps Script
   (`action=hub-summary`) avec `WEBAPP_URL` + `WEBAPP_SECRET` **déjà configurées ci-dessus** —
   AUCUNE variable nouvelle. Sans elles, le summary reste « building » (honnête) ; web app en
   panne → `500 Moteur indisponible` (jamais de donnée partielle). **Prise d'effet côté Apps
   Script après le merge** (leçon 07-15) : ouvre l'éditeur Apps Script → Déployer → Gérer les
   déploiements → ✏ Modifier → Version : « Nouvelle version » → Déployer, puis exécute
   `installerTrigger` (fichier `Main.gs`) — sinon la web app sert l'ANCIEN code et le widget
   reste « building ». Signal indépendant de réussite : `GET /api/hub/summary` (avec le jeton)
   renvoie `status:"ok"` et un `dataAsOf` frais.

   > **⚠ Le déploiement de l'étape 3 coûte UNE reconnexion, une seule fois.** La session porte
   > désormais l'adresse en plus du refresh token — sans elle, impossible de savoir à qui
   > appartient un cookie, donc impossible de revérifier son accès à chaque appel. Les cookies
   > de l'ANCIEN format sont donc refusés (401) : l'app rebascule toute seule sur l'écran de
   > connexion, il n'y a rien à faire à la main. C'est ce qui rend la révocation réelle — sans
   > ça, retirer un accès depuis l'administration du hub n'aurait mordu qu'à l'expiration du
   > cookie, c'est-à-dire au bout d'un an.

   > **⚠ En posant ces variables (déploiement de C28-20), RÉGÉNÈRE aussi `COOKIE_SECRET`**
   > (nouvelle valeur `openssl rand -hex 32`). Les cookies de session posés AVANT le verrou
   > d'identité (valables 1 an) ne sont vérifiés qu'à leur CRÉATION : sans rotation, une session
   > antérieure d'un autre compte contournerait le verrou et obtiendrait la config. La rotation
   > invalide toutes les sessions existantes — tu te reconnectes une fois, c'est tout.

### 2 bis. Firebase (ADR-0078, projet `driveai-d762b`, plan Blaze) — remplace Vercel pour l'app

Hosting sert `app/dist` ; six fonctions (`functions/`, région us-central1, 2 instances au plus, 256 Mo) portent `/api/login`,
`callback`, `refresh`, `logout`, `config` et `sante` (`firebase.json`). Rien n'est déployé tant que ces gestes ne sont pas faits ;
`api/` et `vercel.json` restent en place jusqu'à un oui explicite de Marc.

1. **Client OAuth (Marc, console Google Cloud, projet de l'app)** : ajouter `https://driveai-d762b.web.app/api/callback` aux
   « URI de redirection autorisés » (puis celle du domaine perso quand il existera ; son DNS est un geste de Marc).
2. **Secrets** (valeurs jamais affichées ni écrites dans le dépôt) : `firebase functions:secrets:set GOOGLE_CLIENT_SECRET`,
   `COOKIE_SECRET` (une chaîne aléatoire d'au moins 32 octets) et `WEBAPP_SECRET` (la valeur de la propriété Apps Script
   `DriveAI_WEBAPP_SECRET`). Trois versions sur les six gratuites de Secret Manager.
3. **Paramètres** : `functions/.env.driveai-d762b` (non versionné, `.env.*` est ignoré) avec `GOOGLE_CLIENT_ID`, `ALLOWED_EMAIL`,
   `SPREADSHEET_ID`, `WEBAPP_URL` (et `SENTRY_DSN` si utilisé).
4. **Déployer** depuis la racine : `npm --prefix app ci && npm --prefix app run build && npx firebase-tools deploy`.
5. **Plafonds de coût** : budget d'alerte posé (8 $ CAD, alertes à 50, 90 et 100 %, vu le 18/11/2026) ; après le premier
   déploiement, ajouter un plafond de dépense Cloud Functions (Console Firebase → Utilisation et facturation, fonction « Preview »).
6. **Prouver** : `GET https://driveai-d762b.web.app/api/sante` rend `200 {"ok":true}` ; connexion puis chargement de l'app.

Une session Vercel (cookie `driveai_rt`) n'est pas reprise : une reconnexion, une fois.

### 3. Se connecter (une seule fois)
Ouvre l'URL Vercel → « Se connecter avec Google » → consentement (identité + Sheets + Drive ;
Tasks/Calendar ne sont plus demandés depuis le 05/11/2026, ADR-0074). Le callback vérifie que le compte est bien `ALLOWED_EMAIL` avant de poser la
session ; l'app charge ensuite sa config depuis `/api/config` — **rien à saisir**. Le jeton
d'accès (~1 h) vit en sessionStorage et se **renouvelle tout seul** via `/api/refresh` ;
le refresh token reste dans son cookie HttpOnly chiffré (1 an). « Se déconnecter » détruit le cookie.

> **Garde-fous embarqués (miroir testé du moteur, CI)** : l'app ne peut **rien supprimer** (aucun
> chemin DELETE dans le code — verrouillé par test), ne **détache jamais** un document de
> `04 · Immigration` (remontée d'ancêtres multi-parents, échec fermé), n'applique un reclassement
> que si le nom suit la convention, et **journalise chaque correction** dans l'onglet `Corrections`
> (le moteur apprend, few-shot ADR-0003).

---

## Dépannage

| Symptôme | Cause probable | Fix |
|----------|----------------|-----|
| `Clé API absente…` | `DriveAI_ANTHROPIC_KEY` non définie | `setProperties(obj, false)` (§6) |
| `PANNE DE COMPTE API (HTTP 401, gemini-…)` | `DriveAI_GEMINI_KEY` absente ou invalide | `setProperties(obj, false)` (§6), puis `sonderGemini` |
| `PANNE DE COMPTE API (HTTP 402, gemini-…)` | crédit prépayé Gemini épuisé [À vérifier à la sonde : le code réel à zéro n'est pas documenté] | Google AI Studio → Facturation (geste de Marc) |
| `ERREUR OCR : HTTP 403` / `ERREUR Drive : HTTP 403` | API Drive du projet désactivée | panneau **Services** (＋) → ajoute **Drive API** une fois (§5) |
| `HTTP 401` dans `Journal` | clé Anthropic invalide/révoquée | mets la nouvelle clé |
| Rien ne se range | pas de PJ récente, ou tout part en revue | vérifie `Journal`/`Revue` ; baisse `SEUIL_CONFIANCE` après observation |
| OCR vide sur un PDF | PDF non textuel + OCR Drive limité | normal ; le LLM classe sur les métadonnées |
| Exécution coupée à ~6 min | volume élevé | normal : le reste est repris au tick suivant (garde-temps) |
| Doc « mis en quarantaine » (mail d'alerte) | échec LLM/placement 3 fois de suite (souvent une panne transitoire) | il n'est plus re-tenté pour ne pas tourner en boucle ; pour le relancer, exécute **`dequarantaine`** dans l'éditeur (retire les quarantaines + relance le pipeline) |

---

## Après le déploiement

- **Mesurer le coût** (`P1-09`) : observe l'usage Anthropic sur quelques jours, extrapole au mois,
  confirme < 10 $/mois (estimé ~1–3 $/mois à volume perso).
- **Calibrer** `SEUIL_CONFIANCE` (0.80 au départ) dans `src/Config.gs` selon le taux de revue.
- Quand la Phase 1 est validée → **Phase 2** (`/phase 2`).


## Bouton « Vérifier maintenant » (chantier #20) — déploiement de la web app (une fois)

1. Éditeur Apps Script → ⚙ Paramètres du projet → Propriétés du script → **Ajouter** :
   `DriveAI_WEBAPP_SECRET` = une longue chaîne aléatoire (invente-la).
2. Éditeur → **Déployer → Nouveau déploiement → Application Web** :
   « Exécuter en tant que : **Moi** », « Accès : **Tout le monde** » (le secret fait le contrôle,
   l'anti-rafale limite à 1 demande/min, et le pire abus possible = lancer le tick normal).
   Copier l'**URL /exec**.
3. Dans l'app → ⚙ Configuration : coller l'URL et le secret. Le bouton « ⟳ Vérifier maintenant »
   apparaît dans la barre : le moteur passe dans la minute (déclencheur ponctuel auto-nettoyé).

### ⚡ Redéploiement de la web app : AUTOMATIQUE, et vérifié en prod

> ✅ **Il n'y a plus de « Nouvelle version → Déployer » à faire à la main.** Le secret
> `WEBAPP_DEPLOYMENT_ID` est en place, et `deploy.yml` enchaîne à chaque merge sur `main` :
> `clasp push` → `clasp deploy -i $WEBAPP_DEPLOYMENT_ID` → réinstallation du déclencheur.
> Vérifié sur le run du 19/08/2026 (commit `efcfd1b`) : les étapes « Redéployer la web app
> (/exec inchangé) » et « Assurer le déclencheur (fin du geste manuel) » sont vertes toutes
> les deux. **L'URL /exec ne change pas** — rien à retoucher dans l'app ni dans Vercel.
>
> ⚠️ **Une version Apps Script par redéploiement, plafond de 200.** Depuis le 15/10/2026, l'étape
> « Le moteur a-t-il changé ? » compare le push à l'état précédent de `main` et ne redéploie la web
> app que si `src/` a bougé (`appsscript.json` y vit). Une PR qui ne touche que `app/`, `docs/` ou
> `test/` ne consomme donc plus de version. En cas de doute (lancement manuel, commit précédent
> introuvable), on redéploie. Limite connue : si un redéploiement échoue puis qu'un push sans
> changement de `src/` suit, `/exec` reste sur l'ancienne version jusqu'au prochain changement de
> `src/` ou à un lancement manuel de `deploy.yml`.
>
> **Le run est rouge si `/exec` ne sert pas le commit déployé.** `deploy.yml` écrit le SHA court du
> commit dans `src/Version.gs` avant `clasp push` (jamais committé), `versionPilote_()` le renvoie
> (`5min|t7|<sha>`), et la dernière étape compare la réponse d'`assurer-trigger` au SHA de CE run.
> Elle ne s'applique que si le run vient de créer une version. Un redéploiement qui échoue (plafond
> de 200 atteint, par exemple) laisse déjà le run rouge à l'étape « Redéployer la web app » : il faut
> alors supprimer d'anciennes versions dans Apps Script (« Historique du projet »), aucune API ne le permet.

**Pourquoi ce paragraphe existe encore.** Une web app Apps Script est figée sur une VERSION :
`clasp push` met le CODE à jour, pas le déploiement servi par `/exec`. Tant que le redéploiement
était manuel, ce décalage a coûté cher plusieurs fois — chantier #21 (recherche IA), #27 (miroir
Drive), C28-06 (`analyse-ciblee` retombait sur l'action par défaut), C28-30 (le chat renvoyait une
bulle VIDE, aucune erreur). Le symptôme est toujours le même et il ne ressemble pas à un problème
de déploiement : une réponse **sans les derniers champs ou comportements ajoutés**, sans rien de
rouge nulle part. C'est le mode de panne qu'il faut garder en tête, pas le geste qui le corrigeait.

**Ce qui reste vrai malgré l'automatisation** :

- Le pipeline ne tourne que sur `main`. Un `clasp push` lancé à la main (`workflow_dispatch` de
  `deploy.yml` sur une branche, pour itérer vite) pousse le code **sans** redéployer : sur une
  branche, `/exec` sert toujours l'ancienne version. C'est le seul cas où le piège subsiste.
- Si le secret `WEBAPP_DEPLOYMENT_ID` venait à disparaître, `deploy.yml` sauterait l'étape et on
  reviendrait silencieusement au régime manuel : **Déployer → Gérer les déploiements → ✏ Modifier
  → Version : Nouvelle version → Déployer**. Le job resterait VERT — c'est la seule raison de
  garder la manœuvre écrite ici.
- Devant un doute, juger par un **signal indépendant** (l'action nouvelle marche, le champ neuf
  arrive), jamais par le vert du job : le vert dit « poussé », pas « servi ».

Rappel de contexte : la **recherche IA** (Documents → Recherche DriveAI → « ✨ Recherche IA »)
passe par cette même web app — même secret, bornée à 50 questions/jour, ~0,002 $/question (Haiku),
~3 $/mois au plafond.

## Miroir Drive du dépôt (ADR-0017) — ABANDONNÉ (2026-09-28)

Marc n'en veut plus (NotebookLM abandonné). L'action `sync-miroir` et `src/Miroir.gs` sont retirés
du moteur ; le workflow `sync-drive.yml` est désactivé puis supprimé à part (chemin protégé).
`DriveAI_SYNC_SECRET` reste UTILE : il garde `pousser-reset`, `assurer-trigger` et `audit-tri` (pilote CI).
Après retrait, **redéployer la web app** (Apps Script → Déployer → Gérer les déploiements →
Nouvelle version), sinon l'ancienne action `sync-miroir` répond encore. Le dossier Drive
`_Miroir du dépôt` peut être mis à la corbeille à la main.

## Rattrapage des photos mal classées (incident « Boreale », 2026-07-06)

Après le merge du chantier #20 : éditeur Apps Script → fonction `rattraperMediasMalClasses`
→ Exécuter. Borné (25 images/run) — relancer si le Journal dit « restent à traiter ».
Déplacement seul vers `_Médias` (jamais de suppression), zone protégée/sensible jamais touchée.
