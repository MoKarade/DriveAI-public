# HANDOVER — DriveAI

> **État courant du projet, tenu à jour à chaque session.** Lis-moi en premier pour reprendre
> le travail sans contexte. Le « pourquoi » détaillé est dans `PLAN.md` ; le découpage dans
> `BACKLOG.md` ; le déploiement dans `docs/DEPLOIEMENT.md`.

## 19/11/2026 : synchro fiable, lancement de passage immédiat et refonte Réglages + État (`#949`, `#952`)

- **Bouton `Synchro` & passage immédiat (`#949`, PR `#950` fusionnée `df2f92a`)** : `etatGlobal.tsx` attend désormais la lecture réelle lors des rafraîchissements concurrents et réveille `useProgressionLive()` ; `ActionsMoteur.tsx` + `demanderPassageMoteur` (`action=tick`) ajoutent un retour horodaté à la seconde (`Actualisé à HH:MM:SS`) et le déclenchement immédiat d'un passage moteur ; `Reglages.tsx` est restructuré en 3 cartes (`Moteur et synchronisation`, `Apparence et langue`, `Compte et session`).
- **Refonte page `État` (`#952`)** : barre d'actions `Rafraîchir` / `Lancer un passage` dans l'en-tête, bandeau héros `.moteur-bandeau` sans « clic pour le détail » ni âge brut (`formaterAgeMinutes`, `nettoyerDetailSante`), jauge budget mensuel, grille Bento 2 colonnes (`État du moteur | À revoir`) avec raccourcis vers `Aujourd'hui` et `Documents`, et grille de statuts symétrique (3 / 2 / 1 colonnes). Déployé sur Firebase Hosting (`driveai-d762b.web.app`).
- **Retrait section Hub (`#955`)** : suppression du bloc Hub dans `Reglages.tsx`, retrait de `urlHub` / `HUB_URL` (`config.ts`), des clés `retourHub` / `descHub` (`i18n.ts`) et de `.lien-bouton` (`styles.css`), et désactivation de l'étape moteur `hub-resume` (`CONFIG.HUB_RESUME_ACTIF = false` dans `Config.gs` / `Main.gs`, gate en tête). `api/`, `vercel.json` et `WebApp.gs` conservés.
- **Retrait section `Avancé` & filtrage alertes Hub retirées (`#958`)** : suppression complète de `<details class="avance">` et de `Operation`/`noteStatut` dans `Etat.tsx` (`styles.css` nettoyé des classes `.avance*`/`.op-*`/`.ligne-jauge`/`.ligne-cout`), et masquage de la source `Hub` (`erreursDesDerniersJours` dans `etat.ts`) + clé `hub-resume` (`operationsEnDifficulte` dans `Etat.tsx`) dans `Points d'attention` et `Erreurs · 7 jours`. `src/`, `i18n.ts` et `app/qualite/` intacts.
- **Bouton `Vu` sur les alertes Journal dans `État` (`#961`)** : `cleErreurJournal`, `lireErreursVues` et `enregistrerErreursVues` (`etat.ts`, stockage local `driveai.erreursVues` borné à 64 entrées et haché FNV-1a sans PII) permettent dans `Etat.tsx` de masquer une alerte ponctuelle déjà réglée et de la réafficher en un clic depuis `Erreurs · 7 jours`.
- **Épuration `État` & carte explicative Drive/Gmail (`#964`)** : suppression de `Maintenance Drive` et filtrage de `En cours maintenant` sur les statuts réellement actifs (`encours` / `recensement`) dans `Etat.tsx`, et ajout de la carte permanente « Comment DriveAI classe et trie » (FR/EN dans `i18n.ts`, `.logique-grille` dans `styles.css`). `src/`, `api/`, `etat.ts` et `app/qualite/` intacts.
- **Déblocage tri Gmail & contournement réorg 250 dossiers (`#967`)** : `Main.gs` passe `tri-gmail` sur le budget tail `estBudgetDepasseStandard` (4,5 min, évitant la famine sous `ANALYSE_V2` à 3 min) ; `Reorg.gs` borne `inventaireDossiers_` en largeur (`REORG_DOSSIERS_MAX` = 250, `tronque: true`) au lieu d'échouer en `trop-large` ; `etat.ts` / `Reorg.tsx` masquent l'échec obsolète `portée trop large`, rendent les autres échecs acquittables (`OK` → `écarté`) et conditionnent `Bloqués (N)` à `carteVidesVisible`. `app/qualite/` intact.
- **Référentiel 9 piliers (`ADR-0080`, `#970` PR `#971`, `#973` PR `#974`, `#976`) & domaine personnalisé secondaire** : mise en conformité des nouveaux flux entrants sans migration de masse (`Router.gs` nommage au jour/mois/année + règle stricte factures → `02 · Finances` hors `04` sanctuarisé ; `Llm.gs` double passe alignée ; `Reset.gs` + `Maintenance.gs` + `Reorg.gs` arborescence exacte des 9 domaines, exclusions `00 · Raccourcis` / `restic-pc` / `univers`, `Logement/<Adresse>/Assurance habitation`, `Vehicule/<Nom>[/sousDossiers]` ; carte `État` FR/EN mise à jour dans `i18n.ts`). Domaine personnalisé secondaire basculé vers Firebase Hosting (`driveai-d762b`, DNS uniquement + callback OAuth Google Cloud). `PROFIL_VERSION = 6` conservé (`driveai-profil-prive.json` synchronisé sur Drive hors Git).
- **Fiche du propriétaire (ADR-0081, vague 1, #10)** : nouvelle étape `fiche-apprentissage` (`Fiche.gs`, après le tri, lecture seule) qui compte par expéditeur (adresse nue) les fils lus, répondus, étoilés ou laissés sans lire dans l'onglet `Fiche` ; `importanceFiche_` en tire `haut`/`moyen`/`bas`/`inconnu` (inconnu sous 3 fils). Aucun contenu de mail lu ni écrit.
- **Budget 25 $/30 $ et tri Gmail enrichi (ADR-0081, vague 2a, #12)** : `Config.gs` passe la cible affichée (`LLM_BUDGET_CIBLE`) à 25 $/mois (`Journal.gs`, `Resume.gs`) et le frein automatique mode économique (`LLM_BUDGET_CAMPAGNES`) à 30 $/mois ; `ficheCache_()` charge l'importance apprise 1×/run ; `TriGmail.gs` enrichit `analyserFil_` (`contexteFil_` : habitude Fiche, noms de PJ, court extrait des messages précédents hors zone protégée) et escalade en cas de doute (`categorie === null`, hors suspect) vers `LLM_MODELE_FALLBACK` sous plafond par run (`TRI_ESCALADE_MAX_PAR_RUN`) et sous le frein 30 $.
- **Résumés d'une ligne et brouillons de réponse Gmail (ADR-0081, vague 2b, #14)** : `TriGmail.gs` génère un résumé court (fait dérivé ≤ 140 car., jamais en zone protégée) posé sur `important|<id>`, et prépare des brouillons Gmail (`createDraftReply`, jamais envoyés, bornés à `TRI_BROUILLON_MAX_PAR_RUN` = 3/tick, coupés au frein 30 $ et hors zone protégée/promo/no-reply/fil ayant déjà un brouillon) indexés sous `brouillon|<id>` sans jamais écrire leur contenu.
- **Affichage résumés, budget 25 $ et groupement erreurs `Vu` (ADR-0081, vague 2c, #16)** : `etat.ts` exclut `brouillon|` de `CLE_NON_DOCUMENT_SYNTHESE` et ajoute `grouperErreursJournal` ; `AujourdHui.tsx` affiche le résumé d'une ligne (`l.chemin`) sous les courriels à traiter ; `Etat.tsx` aligne `BUDGET_CROISIERE` à 25 $ et regroupe les erreurs identiques avec un badge `×N` et masquage groupé en un clic `Vu`.
- **Journal des actions réversibles, annulation 1-clic et libellés autonomes (ADR-0081, vague 3a, #18)** : `Actions.gs` consigne déplacements Drive (`Intake.gs`) et créations de libellés Gmail dans l'onglet `Actions` (métadonnées seules, zéro suppression) ; `WebApp.gs` expose `action=annuler-action` (secret app, verrou, idempotent) pour rétablir `drive-deplacer` / `drive-renommer` ; `TriGmail.gs` autorise la création encadrée d'un libellé Gmail (`TRI_CREER_LIBELLE_*`, validateur strict, coupée au frein 30 $ et hors zone protégée/suspect).
- **Journal des actions récentes et bouton `Annuler` dans l'app (ADR-0081, vague 3b, #20)** : `etatGlobal.tsx` lit l'onglet `Actions`, `etat.ts` ajoute `interpreterActions`, `google.ts` expose `annulerActionMoteur`, `Etat.tsx` affiche les actions récentes avec le bouton `Annuler` (44 px, zéro `#hex`) et met à jour le texte explicatif des libellés Gmail (`i18n.ts`).
- **Réorganisation autonome encadrée et suivi passif des infolettres (ADR-0081, vague 3c, #22)** : `Reorg.gs` journalise ses mutations dans `Actions` et exécute en mode autonome encadré (`REORG_AUTO_ACTIF`, `REORG_AUTO_MAX_PAR_RUN: 3`) les actions sûres (`creer`, `renommer`, `deplacer`, jamais `fusionner`/`dossier-vide` ni `04`), coupées au frein 30 $ ; `TriGmail.gs` repère le lien HTTPS officiel `List-Unsubscribe` des infolettres jamais lues (`Fiche` = `bas`) dans `Actions` et `Index` (`tri|unsub|`) sans requête sortante.
- **Hiérarchie 10 principaux / plafond 50 et remplacement avec preuves des libellés Gmail (ADR-0081, vague 3d, #24)** : `Config.gs` / `TriGmail.gs` bornent les créations à 10 principaux et 50 libellés au total (sous-libellés seuls au-delà de 10) ; `Libelles.gs` exécute des remplacements reprenables validés par preuves (`addToThread` avant retrait, maj `TriAppris`, suppression finale une fois vide, journal `Actions`, verrou `surface-gmail-ecriture.test.js` strictement borné).
- **Dossiers de vie existants et liens mails ↔ Drive (ADR-0081, vague 4a, #26)** : `DossiersVie.gs` charge 1×/run depuis `Index` les dossiers d'entités classés pour enrichir le contexte LLM (`Pipeline.gs` / `Llm.gs`) et consigne dans l'onglet `Liens` le lien entre chaque PJ Gmail (`Main.gs`) et le document classé (adresse nue seule, ADR-0007).
- **Relecture progressive de l'ancien Drive journalisée avec Annuler (ADR-0081, vague 4b, #28)** : `Migration.gs` (`placerAvecJournalAction_`) consigne désormais chaque renommage et déplacement de l'existant dans l'onglet `Actions` (`drive-renommer` / `drive-deplacer`), rendant la relecture annulable en 1 clic ; `Config.gs` rallume `REANALYSE_ACTIF` (`8 min/j` sous frein `30 $`, `04` toujours exclu).

## 18/11/2026 : implémentation des 11 propositions R4 (`P0-1`–`P2-3`) — Omnibox, onglet État, télémétrie, cycle nul, thème clair et tests DOM

- **`P0-1`–`P0-4`** : `Omnibox.tsx` (`Ctrl+K` / `⌘K`, `.gf-omnibox-pill`, `rechercherDrive`, compatible `MODE_MOCK`, éphémère en mémoire per ADR-0007) ; onglet principal dédié `État` (`Etat.tsx`, `nav.barre-basse` 3 colonnes `Aujourd’hui · Documents · État`, `Reglages.tsx` recentré sur les préférences via l’engrenage) ; visibilité conditionnelle des propositions `Réorg` et dossiers vides sur `AujourdHui.tsx` (2 `<section>` préservées, aucune action destructive) ; télémétrie additive `tri_archives_jour`, `tri_anciens_fils_jour` et `tri_fond_fils_jour` sous plafond commun `300/j` (`#892`, `Journal.gs` / `TriGmail.gs` → `etat.ts` / `Etat.tsx`, repli `—` si absent, zéro modification des règles de tri/classement).
- **`P1-1`–`P1-4`** : pilules rapides `.gf-chip` (`Explorateur.tsx`), `parents` ajouté à `CHAMPS_ELEMENT` + libellé parent en cache (0 requête N+1) et fil d’Ariane exact (`google.ts`), pastilles de statut `Index` + « Copier le lien » (`>= 44 px`) + bandeau `.bandeau-ok` de création de dossier, cycle `App.tsx ↔ AujourdHui.tsx` supprimé via `app/src/navigation.ts` (`architecture.violations` = `0`).
- **`P2-1`–`P2-3`** : bascule thème clair optionnel (« Google Light », `app/src/theme.ts`, sombre par défaut, contrôle `#hex` adapté), `knip` ramené à `0` (`corbeille.ts`, retrait d’`iconePourMime`, gardes `enCours` et `> 0`), ajout ciblé en `devDependencies` de `jsdom` et `@testing-library/react` (`app/test/app-omnibox-dom.test.ts`, `app/test/vues-dom.test.ts`, `app/test/i18n.test.ts`), seuils `app/qualite/seuils.json` resserrés via `npm run portes:maj` (`code_mort` = `0`, `architecture` = `0`). Section 4 (`R5-B1`..`RM-1`) maintenue hors périmètre. Tests : **1 542 verts** à la racine (`50/50` E2E moteur, couverture moteur **90,3 %**) ; **544 verts** dans `app/` (`38` fichiers, `build`, `portes` seuils **97,7 % / 94,9 % / 86,2 %**, `knip` `0`, `depcruise` `0`, `npm audit --omit=dev` `0`) ; **83** E2E Playwright (`pc` + `tel`, thèmes sombre et clair).

## 18/11/2026 : améliorations app web (R1–R4), fiabilisation moteur Groupe A (R5) et gel Groupe B (ADR-0079)

- **Moteur (R5 Groupe A, ADR-0079)** : `src/TriGmail.gs` (pagination sur file mouvante dans `scanAvantTri_` / `scanCycliqueTri_`, garde pré-écriture sur libellé absent avant `important|` / archivage / `Index`, balayage borné `balayerBoiteAnciensLus_` > 29 j sous `reliquatFondNonVivant_`, ré-évaluation `cleHorsBoite` au retour en boîte, `signalerPanneGmail_` sur promo/lectures/écritures et `stop_reason` dans `appelTriLlm_`) ; `src/Main.gs` (`suiviSkip_` sur quota Gmail et garde `erreurFil` dans `traiterGmail_`) ; `src/Pipeline.gs` (`fileId` propagé sur les 5 voies rapides pour tenir l’ADR-0077) ; `src/README.md` (38 modules). Les règles Groupe B (`Pipeline.gs:125`, préservation `nonlu → lu`, bascule Gemini étape 5) restent gelées sous `docs/claude/11-protocole-de-precision.md` (`DriveAI_GEMINI_KEY` encore absente ; Claude 5.5 actif). Tests : **1 535 verts** (`0` échec, `0` sauté ; E2E moteur `48/48`), couverture moteur **90,2 %**.
- **Application web (`app/`, R1–R3)** : recherche globale et récursive par dossier (`rechercherDrive` + bascule dossier/tout Drive + fil d’Ariane conservé dans `Explorateur.tsx`) ; esthétique alignée FinanceAI et Google épuré (`styles.css` 0 `#hex` hors `:root`, `nav.barre-basse` 2 colonnes, cibles `>= 44 px`, icônes SVG) ; vue d’état lisible sans donnée inventée (`syntheseEtat` dans `etat.ts`, `Reglages.tsx`, `AujourdHui.tsx`, note honnête sur l’archivage). Tests : **468 verts** (38 fichiers), `build` et `portes` OK (couverture cœur **96,8 %**), Playwright `1440×900` et `390×844` sans erreur.
- **Propositions R4 (`docs/PROPOSITIONS-AMELIORATIONS-APP.md`)** : 11 pistes (`P0-1`..`P2-3`, coût `0 $`) implémentées (voir entrée ci-dessus) ; section 4 (`R5-B1`..`RM-1`) maintenue hors périmètre.

## 18/11/2026 : app et session sur Firebase Blaze, étape 1 — les fonctions de session portées dans `functions/` (ADR-0078)

Marc (18/11) : Firebase complet, plan **Blaze**, clé Gemini plus tard (elle vit dans Apps Script : aucun lien). `functions/src/`
porte `login`, `callback`, `refresh`, `logout`, `config`, `sante` (handlers purs injectés avec leur configuration et un faux
Google, `lib.ts` sans dépendance) ; un seul cookie `__session` (Hosting retire les autres) ; propriétaire seul (hub retiré).
Verrous : `app/test/functions-session.test.ts`, `app/test/firebase-config.test.ts`. `index.ts` (2 instances au plus, 256 Mo — 128 Mio dépassé à 136 Mio au démarrage à froid Node 22 le 18/11 —, trois
secrets), `firebase.json` (Hosting + réécritures `/api/*` + en-têtes de Vercel) et `.firebaserc` (`driveai-d762b`, Blaze, budget d'alerte 8 $ CAD
vu le 18/11) sont prêts. Rien déployé, rien supprimé (`api/` et `vercel.json` restent). CI des PR sur les machines GitHub (choix de Marc 18/11 ; `RUNNER_CI` = `pc` pour revenir au PC ; détail et quota dans `docs/couts-ci.md`). Reste, gestes de Marc : URI de redirection OAuth,
secrets, plafond Functions (`docs/DEPLOIEMENT.md` §2 bis), puis déploiement et preuve.

## 06/11/2026 : relance sur une base épurée, étape 13 — le dossier de passation à Antigravity (#917)

Marc (06/11 15:51Z) : « corrige bugs ensuite prépare pour que je donne à Antigravity tout ». `docs/PASSATION-ANTIGRAVITY.md`
dit ce que DriveAI fait, où en est chaque étape de l'ADR-0074 §6, ce qui reste dans l'ordre avec son « Fini quand »
(étape 5 Gemini derrière la clé de Marc, ré-audit du tri après la bascule, 9 multimodal, 10 dates, 11 racine zéro + QCM,
12 fusions, app vers Firebase Spark seulement), les gestes de Marc, les garde-fous mot pour mot et où tout vit.
`.agents/rules/driveai.md` (règles toujours actives, format Antigravity) et `.agents/workflows/gate.md`,
`livrer-une-tache.md` (slash-commandes) rendent le dépôt reprenable sans fil Claude ; `AGENTS.md` (Jules) reste. Non
vérifié : la détection de `.agents/` par la version d'Antigravity de Marc (repli : copier la règle dans `GEMINI.md`).

## 06/11/2026 : relance sur une base épurée, suite de l'étape 8 — fileId sur les descripteurs de Migration, Reset et RetourOrphelins (#898)

Les quatre descripteurs sous `ignorerDoublon` (`src/Migration.gs` ×2, `src/Reset.gs` reliquat, `src/RetourOrphelins.gs`) portent
`fileId` : `metaDoublon_` lit taille et empreinte par `files.get` (ADR-0077), le blob n'est matérialisé que pour l'OCR, à toute
taille ; les orphelins transmettent en plus le md5 déjà lu (`metaRest`), donc aucun second appel. Pas de drapeau `natif` : la
migration exclut les natifs en amont, et pour un natif du reliquat de reset le md5 REST est vide, donc repli sur l'export
haché comme avant (comportement inchangé) ; un orphelin sans md5 est refusé avant le pipeline (`decisionRetourOrphelin_`). Aucun commentaire de `Reset.gs` ni `Consolidation.gs` ne décrivait le
hachage local de ces chemins : rien à mettre au présent. Verrous : `test/migration.test.js`, `test/reset-llm.test.js`,
`test/retour-orphelins.test.js` (« empreinte lue par REST, blob jamais téléchargé pour un gros fichier »).

## 06/11/2026 : relance sur une base épurée, suite de l'étape 8 — preuve de vie et empreinte en UN `files.get`, 403 de quota rejoués (#897)

`metaFichierRest_` (`src/DriveRest.gs`) demande `trashed,parents,size,md5Checksum` : la preuve de vie d'un exemplaire
(ADR-0070) et son empreinte (ADR-0077) viennent du même appel. `etatPorteurDoublon_` (`src/Journal.gs`) est pure sur ces
métadonnées (plus aucun `DriveApp.getFileById`), `etatPorteurBorne_` garde la lecture en mémoire par fileId
(`metaPorteurRun_`, plafond `PORTEUR_VERIF_MAX_RUN` inchangé), `porteurVivantDe_` rend `meta` avec l'exemplaire nommé et
`verdictDoublon_` (`src/Pipeline.gs`) compare le md5 sans second appel (son mémo local disparaît). `fetchDriveAvecRetry_`
rejoue aussi, une fois après 1 s, un 403 dont le corps dit `rateLimitExceeded` (`userRateLimitExceeded` compris : l'API
Drive signale le débit en 403), jamais un 403 de droit ni `dailyLimitExceeded`. Verrous : `test/drive-rest.test.js` (neuf),
`test/doublon-porteur.test.js`, `test/doublon-taille.test.js`. Reste : #898 (fileId sur Migration, Reset, RetourOrphelins).

## 06/11/2026 : relance sur une base épurée, étape 6b — le tri sujet + corps est allumé, Intentions.gs est retiré (ADR-0075 §6, #915)

Verdict de l'audit sur fils réels lu sur DriveAI#890 (run 42243831891, 20 fils, Haiku 5.5) : critère (b) tenu (zéro ⏰ neuf
sur relevé, reçu ou promo), critère (a) sans contre-exemple mais non éprouvé (aucun mail important dans l'échantillon) ;
réserve : relancer l'audit avec des fils ⏰ dans `TRI_AUDIT_REQUETE` après la bascule Gemini (étape 5). Le drapeau
`TRI_SUJET_CORPS` est RETIRÉ de `src/Config.gs` (pas mis à `true`), `TRI_REGLES_VERSION` passe à `r3` : chaque fil de la
fenêtre 30 j est réévalué UNE fois avec lecture du corps, étalé par `TRI_MAX_FILS_PAR_RUN` et les plafonds quotidiens.
Retirés : `src/Intentions.gs` (scan d'importance séparé, étape `intentions` du tick, ligne du registre `Suivi.gs`),
`miniCheckMail_`/`parserMiniCheck_` (`src/Prefiltre.gs`, qui ne garde que les deux étages déterministes), `pageFilsActions_`
(`src/Gmail.gs`), `intentionsSuspendues_` et le paramètre « analyse indisponible » de `decisionTri_` (`src/TriGmail.gs`),
les clés `INTENTIONS_*` et `LLM_MAX_TOKENS_MINICHECK`, `test/intentions-fiabilite.test.js`. `trierFil_` ne lit plus
`intention|` : un seul chemin d'analyse (`analyserFil_`), panne transitoire = `'attend'`, requête refusée = doute.
`miniCategorie_` reste, pour la colonne « hier » de l'audit seulement. ADR-0043 abrogé. Le résumé hebdo ne compte plus
« Mails analysés (importance) » (statuts `intention-*` plus écrits : le chiffre aurait décru vers 0, no fake data). La
passe d'audit sur `TRI_HISTO_REQUETE` (ADR-0076) n'a pas été faite avant 6b : reportée au ré-audit après Gemini. Surface verrouillée :
`test/surface-moteur.test.js` (liste `retirees`). Réserve ouverte : DriveAI#914 (catégorie vide ou hors liste → doute).

## 06/11/2026 : relance sur une base épurée, étape 6 ter — l'audit du tri lancé par la CI, sans geste de Marc (#907)

Marc, 05/11 : « fais tout toi ». `action=audit-tri` dans `src/WebApp.gs` (secret CI `DriveAI_SYNC_SECRET`, anti-rafale
60 min rendue si rien n'a tourné, verrou du tick `acquerirVerrouReset_`, `actionAuditTri_`) appelle
`auditerTriSujetCorpsDetail_` (`src/TriGmail.gs`, même audit que l'éditeur, même onglet, garde-temps avec marge
`PILOTE_MARGE_DOC_MS`) et rend des COMPTEURS (`fils`, accords, `nouveaux`, `retires`) et des métadonnées par ligne qui
diverge (ligne de l'onglet, libellés, verdicts, portes) : jamais un sujet, un domaine ni un corps. `pousser-reset.yml`
prend l'entrée `action` (`pousser-reset` par défaut, `audit-tri`) avec les MÊMES secrets, aucune nouvelle référence ;
au journal : compteurs et lignes sans libellé ; run rouge si l'audit n'a pas tourné ou n'a rien comparé. **Le workflow
est désactivé sur GitHub depuis le 24/09/2026 : à activer une fois (onglet Actions, ou `gh workflow enable`).** Le fil
Claude déclenche, lit les compteurs, et fait lire les lignes citées de l'onglet sur le PC (fil PC) pour juger l'ADR-0075
§3 (révisé). Filet : `auditerTriSujetCorps()` dans l'éditeur, inchangée. Verrous : `test/pilote-ci.test.js`,
`test/tri-sujet-corps.test.js`. Le oui vaut pour le modèle qui a produit l'onglet (relancer après la bascule Gemini).

## État au 18/11/2026 (15 lignes au plus, à mettre à jour à chaque session)

- **Moteur** : en production, `etat_moteur` du 23/10 (14 h 29 heure du Québec) donne `profilPrive.etat = ok` (100 réglages, profil privé v6), un dernier passage OK et le tri Gmail normal. Le profil v6 est en place depuis le 23/10 (13 h 59) ; l'ancien reste dans le Drive sous un nom de sauvegarde.
- **Chantier en cours : #468**, rendre le dépôt publiable. Point 2 prouvé (retour des orphelins de `_Doublons` : terminé le 20/10, 19 remis en circulation, 0 écartés, lu dans la Santé). Point 3 (nom de fournisseur réel retiré du code) : PR #600 fusionnée le 21/10 avec la bascule du profil privé en v5 (voir `docs/PROFIL-PRIVE.md`), à vérifier dans la Santé (`etat_moteur`, outil MCP, est retiré depuis l'ADR-0074). Point 4 (récits personnels rendus neutres) : en cours, par PR (plan en six PR, une à la fois, au 21/10 : journal du HANDOVER et commentaire de `Config.gs` fusionnés, gabarit de PR et index des ADR fusionnés ; données perso : documents rendus fictifs (véhicules, parcours scolaire, adresse web, projet GCP), le code gardait ses valeurs réelles jusqu’à la version 6 du profil privé). Au 22/10 : commentaires de `src/` rendus fictifs (PR #648) ; marques de véhicule, règles du reset, URL de MemoryAI et véhicules communs passés dans le profil v6 (`PROFIL_VERSION_ATTENDUE` = 6, voir `docs/PROFIL-PRIVE.md`), moteur et tests sans valeur réelle ; le domaine du hub n’est plus écrit dans `api/` ni `app/` (déduit du domaine de production, `api/_domaine.ts`), et `test/pii-baseline.json` est à `{}` : plus aucune ligne détectée. Reste la publication : un dépôt neuf sans historique, préparé dans `commun/publication/2026-10-23_driveai-depot-neuf-bloc-ton-pc.md` (geste du fil PC après l’« Autorisé » du propriétaire).
- **Cache de prompt du chat (28/10/2026, tâche #730 ; chat retiré le 05/11/2026 par l'ADR-0074)** : `appelAnthropicMessages_` (`src/Llm.gs`) marquait le bloc système (couvre les outils) et le dernier `tool_result` ; l'historique de l'appelant n'est jamais marqué. Les appels Haiku courts (Piece, mini-check, intentions, relecture) restaient sous le minimum cachable de Haiku 4.5 (4 096 jetons) : la 5.5 descend à 512 jetons, voir la ligne suivante. **Preuve attendue** : `scr` > 0 sur une ligne du chat dans `DriveAI_COUT_AAAA-MM`.
- **Modèles 5.5 (28/10/2026, tâche #734, ADR-0067)** : tout le moteur tourne sur `claude-haiku-5-5` et `claude-sonnet-5-5` ; plus aucun ancien identifiant dans `src/` (verrou `test/modeles-5-5.test.js`). `avecReglages_` (`src/Config.gs`) pose les réglages de la 5.5 : pas de `temperature`, Haiku sans réflexion, Sonnet en `between_tools` (il refuse `disabled`), `effort` posé ; plafonds de jetons relevés (tokenizer ~30 % plus bavard). `Cout.gs` : compteurs `h55*` et `s55*` aux prix du 28/10 (0,10/0,50 et 2/10) ; `h`, `s`, `s5` restent pour les mois déjà comptés. Étiquettes d'extracteur (`haiku-4.5-piece-v2`…) inchangées : noms de lignée que lisait la Mémoire (canal retiré le 05/11/2026, ADR-0074). **Preuve** (limite API levée le 28/10 ; lue par l'outil MCP `etat_moteur`, retiré le 05/11/2026 par l'ADR-0074, `jetonsParFamille_` reste dans `Cout.gs`) : `couts.jetons` (`haiku55`, `sonnet55`, `anciens` : entrée, sortie, cache écrit, cache lu ; nombres seulement, `jetonsParFamille_` dans `Cout.gs`), ce qui permettait de lire la famille réellement appelée et `cacheLu` sans toucher aux Script Properties. Restait : un appel Haiku 5.5 réel (au prochain fichier ou courriel), audit du protocole de précision sur ~20 documents réels ; le point « `cacheLu` > 0 sur un tour de chat » tombe avec le chat (retiré le 05/11/2026). Un tour de chat 5.5 avait répondu sans 400 le 28/10 (poste `app:chat-assistant`).
- **Fusion** : Mergify, voir `CLAUDE.md` « Git et CI » ; un push sur `main` qui touche `src/` déploie le moteur (`deploy.yml`).
- **Tests** : `npm test` à la racine (`1 542` verts au 18/11/2026, couverture moteur `90,3 %`), `cd app && npm run test && npm run build && npm run portes` (`544` verts dans `38` fichiers au 18/11/2026, seuils `97,7 %` / `94,9 %` / `86,2 %`, `knip` `0`, `architecture` `0`, `83` E2E Playwright).
- **Logo** (22/10, DriveAI#639) : l'icône est le logo série A (arborescence de dossiers, `#60A5FA` sur tuile `#0B0D12`) : `app/public/icone.svg` et les PNG 192, 512, maskable, apple-touch ; `index.html` et le manifeste n'ont pas changé. La marque dans l'app est du texte (`DriveAI`), le service worker ne met rien en cache ; PWA installée : Android/PC se rafraîchissent seuls, iPhone : retirer puis rajouter l'icône.
- **LIA retirée** (05/11/2026, ADR-0074, DriveAI#883) : plus d'assistant dans l'app, plus de `api/lia/*` ; l'historique (DriveAI#650, #725, #771, #796) reste ci-dessous à titre de récit.
- **Canal vers MemoryAI retiré** (05/11/2026, ADR-0074, DriveAI#881) : Messenger (#664), seconde lecture (#678), essai par l'image (#740), troisième lecture (#759), agenda du jour (#679), inventaire et pièces (ADR-0059/0061) ne sont plus dans le moteur ni dans l'app. Leurs récits restent dans `docs/journal/` et les leçons.
- **Où est le reste** : entrées datées de juillet à octobre 2026 dans `docs/journal/handover-entrees-datees.md` ; ancien §4 « côté Marc » dans `docs/journal/handover-a-faire-marc.md` ; ancien §7 dans `docs/journal/handover-historique-sessions.md`. Ce fichier reste court (verrou : `test/structure-doc.test.js`, 300 lignes au plus).

## 1. TL;DR (où on en est)

- **LIA (lia-ui v0.42.2, DriveAI#725)** : DriveAI épingle `@mokarade/lia-ui` v0.42.2 (sha pelé `9852596`), seul changement (`app/package.json`, `app/package-lock.json`). v0.42.1 ne rapprochait la discussion de l'onglet de celle de l'état partagé qu'à la première lecture, et seulement si la partagée était ouverte : une discussion fermée sur le hub était réécrasée par celle, plus ancienne, d'un onglet. v0.42.2 rapproche à chaque lecture (la plus récente gagne, fermée ailleurs = fermée ici) et écrit toujours la plus récente des deux. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, puis relevé du PC (lia-ui#144).
- **LIA (lia-ui v0.42.1, DriveAI#714)** : DriveAI épingle `@mokarade/lia-ui` v0.42.1 (sha pelé `b8967ec`), seul changement (`app/package.json`, `app/package-lock.json`). Au montage, la discussion de l'onglet était datée « maintenant » et passait devant celle de l'état partagé : une question posée sur le hub ne se retrouvait pas dans CarAI. v0.42.1 range le vrai instant avec la discussion de l'onglet, et la plus récente gagne à la première lecture de l'état. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, puis relevé du PC (lia-ui#140).
- **LIA (lia-ui v0.42.0, DriveAI#708)** : DriveAI épingle `@mokarade/lia-ui` v0.42.0 (sha pelé `cff04f4`), seul changement (`app/package.json`, `app/package-lock.json`). v0.40.0 : les marques `[→lien]` d'une réponse de LIA deviennent une ligne « Sources » de petits liens (https, sans identifiants). v0.41.0 : le chat reste dans l'écran visible et ne se replace plus à chaque image. v0.41.1 : la bulle se place sans glisser quand la taille ou l'écran change et grandit vers le haut dans la moitié basse. v0.42.0 : la hauteur gagnée à chaque réponse est découverte en 280 ms depuis le bord fixe (sans ombre coupée, rien en mouvement réduit). Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, bundle servi (chunks compris) contenant `inset(-24px)` sur l'app web, puis mesure sur la page de connexion publique ; la tâche reste ouverte jusque-là.
- **Phase 0** (scaffolding & automatisation) : ✅ mergée.
- **Phase 1** (le cœur : Gmail → analyse → classement) : ✅ codée, revue par la flotte, mergée sur `main`.
- **Automatisation live** : CI, 8 agents, boucle de leçons, `CLAUDE.md` auto-évolutif ; la fusion est décrite
  dans `CLAUDE.md`, « Git et CI » (Mergify), jamais ici.
- **DriveAI tourne** : déployé dans Apps Script chez Marc, validé end-to-end le 2026-06-23
  (~25 docs traités : Gmail → OCR → LLM → routage → Index/Revue ; idempotence/nommage confirmés).
- **Recalibrage appliqué** : le 1er run marquait presque tout `sensible` → tout en revue. Le
  prompt vise désormais la zone protégée stricte (immigration + fiscal) ; le reste s'auto-classe.
- **Phase 2 codée** : seconde source d'intake (`00·À trier`, fichiers **déplacés** jamais copiés),
  routage à l'**entité** via le référentiel `Entités` (colonnes + `Statut` auto-réparées), entité
  inconnue → ligne `en_attente` pré-remplie + revue, création des dossiers d'entité + sous-dossiers
  fixes après validation (Statut = « validée »), multi-entités en raccourcis Drive, doublons signalés
  (empreinte MD5). Modules ajoutés : `Entites.gs`, `Intake.gs`, `Pipeline.gs`, `DriveRest.gs`.
- **Full auto (P2.2)** : Action GitHub **Deploy** (`clasp push` auto sur merge `main`, via secrets
  `CLASPRC_JSON`/`SCRIPT_ID`) + **auto-rejeu** sur bump de `CONFIG.VERSION` (renvoie les dépôts en
  revue vers `00·À trier`, borné/réversible). Après le réglage unique des 2 secrets, Marc ne fait plus
  ni `clasp push` ni `rejouerLaRevue`. **Validé en réel le 2026-06-26** (auto-déploiement + auto-rejeu
  ont reclassé 5 dépôts sans intervention).
- **P2.3** : `SEUIL_CONFIANCE` abaissé **0.80 → 0.50** (sur demande de Marc) ; l'auto-rejeu reprend
  désormais aussi les `[REVUE] confiance …` (2e passe, déplacement seul). La zone protégée
  (`[REVUE] sensible`) n'est **jamais** reprise (garde-fou §1) : passeports/immigration/fiscal restent
  en revue par conception.
- **P2.5 (escalade)** : la confiance basse n'envoie plus en revue — elle déclenche une **analyse
  approfondie** (Sonnet ×3, consensus de domaine) puis le doc est **classé au meilleur endroit**.
  Seuls restent en revue : zone protégée + domaine introuvable. Coût borné (plafond d'escalades/run,
  fallback simple sur échec Haiku, docs sensibles non escaladés). Revue flotte 🟢 (sécurité + coût).
- **fix CI/CD** : l'auto-déploiement était muet (merge bot ne déclenche pas `on: push` ; clasp casse en
  Node 22). Réparé : auto-merge **dispatche** Deploy ; Node 20. **Vérifier les runs de l'Action Deploy.**
- **P2.6 (grand rangement auto)** : sur demande de Marc (« tout mon Drive reclassé/renommé/au bon
  endroit »), un rangement initial **zéro clic** gated par `CONFIG.RANGEMENT_TAG` renvoie au fil des ticks
  tout le contenu « en vrac » (nom non `AAAA-MM-JJ_`) des domaines NON protégés vers `00·À trier` ; le
  pipeline le reprend (OCR → analyse approfondie → renommage → classement, sous-dossiers créés au besoin).
  Borné (`RANGEMENT_MAX_PAR_RUN` + garde-temps), reprenable (tag figé seulement quand une passe ne collecte
  plus rien), **déplacement seul** (aucune corbeille), et **zone protégée écartée** même pour un fichier
  multi-parents (garde un parent dans `04 · Immigration` ⇒ jamais détaché). Re-audité flotte 🟢 (sécurité
  BLOQUANT levé + garde-temps). `_Archive 2025` non concernée. Lançable aussi à la main (`rangerToutLeDrive`).
- **P2.7 (ancien Drive + garde-fou OCR vide)** : Marc a désigné son vrai « ancien Drive » — le dossier
  racine **« ancienne racine »** (pas `_Archive 2025`, qui n'existe pas chez lui). Branché sur le
  grand rangement via `CONFIG.RANGEMENT_RACINES_SUP` (tag `r2`). Un audit sécurité a détecté un trou
  réel : un vieux scan à nom neutre (`IMG_NNNN.jpg`) dont l'OCR échoue pouvait recevoir `sensible=false`
  sans aucun signal et être classé auto — violation potentielle du garde-fou §1 sur un passeport/doc
  fiscal. Corrigé : tout DÉPÔT (manuel ou rangement — jamais une PJ Gmail, qui garde expéditeur/sujet)
  dont l'extrait OCR fait moins de `CONFIG.OCR_MIN_CARS_EXPLOITABLE` (20) caractères part en revue
  (« sensibilité indéterminable (OCR vide) »), priorité la plus haute dans `motifDeRevue_`. Re-audité
  flotte 🟢 (security-auditor CONFORME, file-checker : pas de sur-blocage, seuil raisonnable).
- **Secrets déploiement déjà posés.** Les 2 secrets GitHub (`CLASPRC_JSON`, `SCRIPT_ID`) sont **déjà
  configurés** côté Marc — confirmé par des runs `Deploy` réels (`clasp push` réussi, code visible en
  prod). Le tableau « reste à faire » ci-dessous est mis à jour en conséquence : **rien côté secrets**.
- **fix-pipeline (file `00·À trier` gelée)** : `appliquerRangementInitial_` tournait AVANT l'intake et
  SANS try/catch → un plantage de sa collecte gelait tout le tick (Gmail + dépôts + intentions sautés) →
  ~20 fichiers stagnaient des heures dans `00·À trier`. Corrigé : maintenance auto (rejeu, rangement)
  **enveloppée de try/catch**, et on **DRAINE (Gmail+dépôts) AVANT d'ALIMENTER** (rangement passe après,
  si budget). Vérifié en prod par recherche Drive : la file s'est vidée après déploiement.
- **P1-13 (lecture des fichiers Office)** : diagnostic prod (recherche Drive) — les `.docx`/`.ppt` de Marc
  (CV, TP, présentations) partaient TOUS en revue « sensibilité indéterminable (OCR vide) » car `Ocr.gs` ne
  lisait que text/PDF/images ; un `.docx` → texte vide → garde-fou OCR-vide → revue. Corrigé : `extraireTexte_`
  convertit désormais Word/PowerPoint/Excel en Google natif (Docs/Slides/Sheets, conversion sans OCR) → vrai
  texte → classés correctement. `VERSION` bumpée **P2.5 → P2.8** ⇒ re-tri auto de la revue existante (Office
  classés, vieux `[REVUE] doublon` → `_Doublons`, sensibles re-détectés → revue). Re-audité flotte 🟢.
- **Décision actée (propriétaire, 2026-07-01) :** les docs **sensibles** (immigration/fiscal) sont auto-classés dans leur
  domaine, comme le reste (`docs/TAXONOMY.md`, « Documents sensibles »). Restent interdits : la suppression, la sortie
  d'un fichier hors de `04 · Immigration`, et un doublon sensible va dans `_Doublons`. (Cette entrée disait « en attente
  de sa confirmation » ; relevé le 2026-10-19, la décision était déjà prise.)
- **Phase 3 codée** (remplace l'agent mail externe de Marc). Scan de **tous** les mails récents
  (pas seulement avec PJ, `GMAIL_REQUETE_ACTIONS`) → pré-filtre 3 étages (mots-clés gratuit → zone
  protégée gratuit, défense en profondeur indépendante du LLM → mini-check Haiku ~10 tokens) →
  extraction d'intentions LLM (`PROMPT_INTENTIONS`) → routage **échéance → Google Tasks**, **rdv
  daté → Google Calendar**, création **100 % auto** (zéro validation), liste Tasks par défaut +
  agenda principal. Nouveaux fichiers : `GoogleApi.gs`, `Tasks.gs`, `Calendar.gs`, `Prefiltre.gs`,
  `Intentions.gs`. Idempotence à 2 niveaux (message + intention) ; ID client Calendar déterministe
  par `(messageId, contenu)` (rejeu après coupure → 409 = succès, jamais de doublon) ; risque
  résiduel documenté sur les tâches (Tasks API sans ID client, même compromis que la copie Gmail).
  **Re-audité par la flotte (4 spécialistes, 2 passes)** : sécurité 🟢, coût LLM 🟢 (~1-4 $/mois
  estimé), idempotence 🟢, quotas — 1er passage **BLOQUANT** (pagination par offset numérique
  stagnait au-delà de ~200 messages sur une fenêtre Gmail mouvante : un nouveau mail en tête décale
  tous les offsets, donc redémarrer à 0 chaque tick ne progressait jamais dans l'historique), corrigé
  par un scan à deux voies (avant : offset 0, capte le mail neuf ; arrière : date absolue persistée,
  insensible aux décalages d'offset), 2e passage 🟢 CONFORME. **Seule action manuelle de Marc à
  venir : une ré-autorisation Google unique** (nouvel écran de consentement après l'ajout des scopes
  Tasks/Calendar) — cf. `docs/DEPLOIEMENT.md` § Phase 3.

## 2. Avancement par phase

| Phase | Périmètre | État |
|-------|-----------|------|
| 0 | Scaffolding & automatisation | ✅ mergée (PR #1) |
| 1 | Moteur Apps Script (Gmail, OCR, LLM, routage domaine/catégorie, revue) | ✅ mergée (PR #2) |
| 2 | Dépôt manuel `00 · À trier` + référentiel d'entités + dossiers granulaires | voir l'épopée dans `BACKLOG.md` |
| 3 | Tâches & agenda (Tasks/Calendar, remplace l'agent mail externe de Marc) | voir l'épopée dans `BACKLOG.md` |
| 4 | Recherche + dashboard (app web Vercel) | ✅ réalisée (`BACKLOG.md`, épopée Phase 4) |

Détail des tâches : `BACKLOG.md`.

## 3. Décisions actées (ne pas re-litiger)

- **Legacy révisé (2026-06-30)** : la décision initiale « Option A » supposait un dossier `_Archive 2025`
  qui n'existe pas chez Marc — son ancien Drive est en fait la racine **« ancienne racine »**. Sur
  demande explicite de Marc (« classe tout mon ancien drive »), elle est désormais INCLUSE dans le grand
  rangement auto (`CONFIG.RANGEMENT_RACINES_SUP`), avec le garde-fou OCR-vide renforcé (cf. P2.7 ci-dessus).
- **Gmail** : `gmail.modify` sert à poser un libellé **existant** sur un fil et à l'archiver, rien d'autre (règle complète : `docs/claude/01-principes.md`, ADR-0012 et ADR-0050). L'idempotence reste portée par l'`Index` (clé `messageId|i|nom|taille`).
- **Merge** : voir `CLAUDE.md`, « Git et CI » (Mergify fusionne en squash une PR sortie du brouillon quand les contrôles
  sont verts ; un chemin protégé passe aussi par le « Garde-fou »). Historique : auto-merge ajouté le 24/09/2026 (décision
  du propriétaire), remplacé par Mergify le 15/10/2026.
- **Portes qualité et sécurité de l'Atelier (S6, 24/09/2026)** — jobs **Qualité** et **Sécurité** du workflow CI,
  donc requis pour la fusion. Les seuils (typage, tests, couverture, code mort, architecture) vivent dans UN seul
  fichier, le cliquet `app/qualite/seuils.json` : rien ne recule, `npm run portes` dans `app/` les vérifie et
  `npm run portes:maj` les resserre ; aucun chiffre n'est recopié ici. Sécurité : gitleaks sur l'historique fusionné
  (HEAD) + Semgrep (TypeScript, React, secrets, OWASP), bloquants. Le moteur `src/*.gs` garde son filet
  `node --test`. Dependabot hebdomadaire (npm `app/` + actions).
- **Modèles LLM** : les modèles et leurs replis font foi dans `CONFIG` (`src/Config.gs` : `LLM_MODELE`, `LLM_MODELE_FALLBACK`, `ANALYSE_V2_MODELE` ; `CHAT_MODELE` est parti avec le chat, ADR-0074), jamais recopiés ici.
- **Scopes** : la liste qui fait foi est `oauthScopes` dans `src/appsscript.json` (moteur) et `SCOPES` dans `api/_lib.ts` (app) ; Tasks et Calendar ne sont plus demandés nulle part depuis le 05/11/2026 (ADR-0074 ; l'ancien jeton hubperso de l'ADR-0041 est retiré). Cf. `docs/ARCHITECTURE.md`.

## 4. Ce qui reste à faire côté Marc

Déplacé dans `docs/journal/handover-a-faire-marc.md` (historique). La liste vivante est l'ensemble des issues `qui:marc`.

## 5. Blocages / risques connus

- **Connexion impossible (#689, 26/10/2026)** : retour sur `/?auth=echec` après Google. Cause lue dans les journaux Vercel (`[callback] connexion refusée : echange:invalid_client`) : le `GOOGLE_CLIENT_SECRET` de Vercel (9 sept.) n'est plus accepté par Google, le client OAuth « Hubperso » n'ayant plus qu'un secret actif depuis le 23/10 [relevé du PC]. Le secret valide se pose dans Vercel + Infisical ; une variable Vercel ne s'applique qu'au build suivant. `/api/callback` ajoute `&motif=` et l'écran de connexion l'affiche (`app/src/connexion.ts`).
- **Commits « Unverified »** sur GitHub : la clé de signature de l'environnement Claude est vide
  (0 octet) → signature impossible. Cosmétique, sans impact.
- **Ruleset `claude/**`** : la règle « Require status checks » bloquait le *push initial*
  (œuf-poule), retirée par Marc. Le check CI s'appelle **« Validation du scaffolding »** (pas `ci`).
- **Phase 1, limites assumées** : volume très élevé (> ~une page de fils / 15 min) traité sur
  plusieurs ticks ; une classification en échec persistant est re-notifiée et n'est déposée nulle
  part (re-tentée tant que le mail est dans la fenêtre 30 j). À revisiter si gênant.
- **Cadence 10 min & quota (audit)** : les comptes Gmail grand public ont ~90 min/jour de temps de
  déclencheur. À 10 min (144 ticks/j), la plupart sont des no-op, mais ~20 runs « pleins » (jusqu'au
  garde-temps `BUDGET_MS` 4.5 min) suffiraient à l'épuiser. Volume perso de Marc → marge large. Si une
  journée chargée coupe les triggers, revenir à `TICK_MINUTES: 15` ou baisser `BUDGET_MS` (reprise au
  tick suivant déjà en place). Le déclencheur se ré-installe seul au déploiement (création avant purge).
- **Phase 2, limites assumées** (relevées par la flotte, non bloquantes) : (a) un document en échec
  LLM/placement persistant est re-OCRisé + re-classé à **chaque** tick (pas de quarantaine après N
  échecs → coût) ; (b) la **copie Gmail** et les **raccourcis multi-entités** ne sont pas idempotents
  au rejeu (un rejeu après coupure entre placement et Index peut dupliquer le fichier/raccourci — c'est
  le compromis « Index en dernier ») ; (c) la **file de revue = le dossier** `00·À vérifier` : un dépôt
  routé en revue est bien dans le dossier même si une coupure empêche la ligne `Revue`/`Index`.

## 6. Comment reprendre

- `/review` — passer un diff à la flotte d'agents.
- `/lesson "…"` — consigner une leçon.
- `/handover` — régénérer ce fichier à partir de l'état courant.
- `/ship` — commit + push + PR draft.

## 7. Historique des sessions

Déplacé dans `docs/journal/handover-historique-sessions.md`.
