# Architecture technique — DriveAI

> `apps-script-quota` et `security-auditor` s'appuient sur ce document.

## Vue d'ensemble

```
┌──────────────┐  trigger 10 min   ┌──────────────────────┐
│  Gmail (PJ)  │ ────────────────▶ │  Apps Script (moteur) │
│ 00·À trier   │                   │  Gmail / Drive / Ocr  │
│ Partagés (📎)│                   │  Llm / Router / Journal│
                                   └───────────┬───────────┘
                                               │ UrlFetchApp
                                               ▼
                                   ┌──────────────────────┐
                                   │  API Anthropic (Haiku) │
                                   └──────────────────────┘
                                               │
                  état / index / journal       ▼
┌──────────────┐               ┌──────────────────────────┐
│ App web      │ ◀───────────▶ │  Google Sheet (DB légère) │
│ React / Vite │  Vercel /     │  Entités · Index · Journal·│
│ (`app/`)     │  Firebase     │  Revue · Télémétrie · Coûts│
└──────────────┘  (ADR-0078)   └──────────────────────────┘
```

## Composants

### Moteur — Google Apps Script (Phases 1–3)
- **Pourquoi** : triggers temporels natifs ; accès Gmail/Drive *en tant que Marc* (pas d'OAuth
  serveur à gérer) ; gratuit ; pas d'infra à héberger.
- **Modules Phase 1–2** : `Config.gs`, `Gmail.gs`, `Ocr.gs`, `Llm.gs`, `Gemini.gs` (ADR-0073), `Router.gs`,
  `Journal.gs`, `Main.gs`, `Pipeline.gs`, `Intake.gs`, `TriGmail.gs` (tri natif sur sujet + corps, règles `r3` depuis le 06/11/2026, ADR-0075), `Partages.gs` (source #3 : fichiers
  partagés, ADR-0005), `Entites.gs`, `DriveRest.gs`,
  `Maintenance.gs`, `Migration.gs` (chantier #8 : campagne de re-classement de l'existant vers
  la taxonomie courante, gatée `MIGRATION_TAG`). Voir `BACKLOG.md`.
- **Importance des mails** (ex-Phase 3) : depuis le 06/11/2026 (ADR-0075 6b) c'est le tri Gmail lui-même
  (`TriGmail.gs`, `analyserFil_`) qui décide « à traiter » sur le sujet ET le corps, pose ⏰ et la clé
  `important|`. `Prefiltre.gs` ne garde que les deux étages déterministes (mots-clés, zone protégée).
  `Intentions.gs` (scan séparé, mini-check) est retiré, comme `GoogleApi.gs`, `Tasks.gs`, `Calendar.gs`,
  `JetonHubperso.gs` et l'extraction d'intentions (05/11/2026, ADR-0074) : DriveAI ne crée plus ni tâche
  ni rendez-vous.
- **Modules observabilité** : `Cout.gs` (mesure réelle du coût LLM — tokens `usage` agrégés par mois
  dans une Script Property), `Resume.gs` (résumé hebdomadaire par mail — **envoi coupé** depuis le 2026-09-07, `CONFIG.MAILS_ACTIFS`, C28-75 : docs classés / en
  revue / mails analysés / erreurs / coût mesuré du mois ; déclencheur hebdo auto-installé, scope
  `script.send_mail` existant).
- **Scopes** (`appsscript.json` → `oauthScopes`), moindre privilège — chaque scope est justifié :
  - `gmail.modify` *(chantier #16, ADR-0012 — remplace `gmail.readonly`)* — lecture des mails + PJ,
    et les SEULES écritures du tri : poser un libellé EXISTANT sur un fil, archiver (réversible).
    Corbeille/Spam/suppression/création-destruction-retrait de libellés : INTERDITS par le verrou
    CI `surface-gmail-ecriture` (check requis qui gate `main`).
  - `drive` — créer/déplacer dans Drive, OCR via conversion.
  - `script.external_request` — `UrlFetchApp` vers l'API du modèle (Anthropic, puis Gemini : ADR-0074).
  - `spreadsheets` — état (Index/Journal/Revue/Entités).
  - `script.send_mail` — **notifications d'échec à soi-même** (`MailApp`, envoi *as-self*, pas un
    scope d'envoi tiers). Requis par la DoD Phase 1 (« notif mail immédiate »).
  - `script.scriptapp` — installation/ajustement du déclencheur (`ScriptApp.newTrigger`, `CONFIG.TICK_MINUTES`). Requis par la DoD.
  - *(Phase 3, retirée le 05/11/2026, ADR-0074)* `.../auth/tasks` et `.../auth/calendar.events` ne
    sont plus demandés nulle part : ni dans le manifeste (ils passaient par le jeton du projet GCP
    hubperso, ADR-0041, hors manifeste), ni dans l'app (`api/_lib.ts`, verrou `app/test/bff.test.ts`).
    Le moteur n'appelle plus aucune API Google par REST hors Drive (verrous `test/scopes.test.js` et la liste
    `retirees` de `test/surface-moteur.test.js`).
  - *(Chantier #6, ADR-0003)* `.../auth/forms` — création + lecture du **mini-formulaire de correction**
    (`FormApp.create` + `getResponses`). `forms.currentonly` est **inapplicable** ici (il ne couvre que
    `getActiveForm()` d'un script *lié* à un formulaire, ni `create` ni `openById` en script standalone).
    ⚠️ Portée : `forms` donne accès en lecture/écriture à **tous** les formulaires du compte — intrinsèque
    à `FormApp`. Piste plus étroite (future) : API Forms REST via `UrlFetchApp` avec `forms.body` +
    `forms.responses.readonly` (cf. leçon « API Google via REST »). Aucune suppression de formulaire.
- **Idempotence par l'Index, jamais par un libellé** : même avec `gmail.modify` (#16), l'état
  « déjà traité » est porté **uniquement par l'`Index`** (clé `messageId|i|nom|taille` pour les PJ,
  `tri|fil|ts|lu` pour le tri) — un libellé est une donnée UTILISATEUR, pas un marqueur d'état.
  La fenêtre 30 jours est paginée pour ne pas affamer les anciens fils. *(Correction audit
  2026-07-06 : `gmail.labels` ne permettrait PAS de poser un libellé sur un fil — ce scope ne gère
  que les DÉFINITIONS de libellés ; la pose exige `gmail.modify`, introduit par le chantier #16.)*
- **Clé API** : Script Properties `DriveAI_ANTHROPIC_KEY`, lue via `PropertiesService`.
  Clé `DriveAI_GEMINI_KEY` prévue pour l'étape 5 (ADR-0073, adaptateur `src/Gemini.gs` prêt, pas encore posée en prod).
  Jamais en dur, jamais commitée.

### État — Google Sheet
Base de données légère, lisible/éditable à la main, partagée entre Apps Script et l'app web.
- `Entités` — référentiel (Phase 2).
- `Index` — catalogue des docs classés + tags (sert la recherche Phase 4 + l'idempotence).
  Colonnes : Clé · Traité le · Fichier · Domaine · Chemin · Statut · Empreinte (MD5) · Confiance · FileId ·
  Taille (octets, ADR-0077) · Exemplaire (fileId de l'exemplaire vivant qui a fait écarter un doublon, ADR-0077).
  Statuts : `classé`, `revue`, `doublon`, `quarantaine` ; `intention-*` (lignes historiques de l'analyse
  d'importance, retirée le 06/11/2026, ADR-0075 6b) ;
  `tache`/`evenement` ne sont plus écrits depuis le 05/11/2026 (lignes historiques conservées).
- `Journal` — log d'exécution + erreurs.
- `Revue` — file d'attente avec suggestions (option « riche » vs nom de fichier ; cf. `PLAN.md` §7).
- `Échecs` — compteur d'échecs par document (quarantaine après `QUARANTAINE_MAX` essais ; n'est touché
  qu'en cas d'échec, jamais sur le chemin nominal).
- `Progression` — barre de chargement (texte) du grand rangement de l'ancien Drive : `[███░░░] N %`,
  « X classés / Total · reste ». Recensement une fois du total « en vrac », cumul des fichiers sortis ;
  reset auto quand `RANGEMENT_TAG` change (cf. `Maintenance.majProgression_`).

### LLM — API Anthropic
- **Haiku** par défaut (le moins cher). **Sonnet** en fallback ponctuel sur cas ambigu.
- Appel via `UrlFetchApp` (POST JSON). Prompt système de classification → **JSON strict**
  (schéma dans `PLAN.md` §4). Parsing robuste (try/catch, retry léger).
- Pré-filtre déterministe (expéditeur/type) en réserve si la facture grimpe.

### Interface — App web React/Vite/TS (`app/`) sur Vercel et Firebase (`functions/`, ADR-0078)
- Dashboard de revue + recherche globale rapide (`Omnibox` `Ctrl+K` / `⌘K`) et par dossier (`rechercherDrive`) + onglet dédié `État` sans donnée inventée (`syntheseEtat`, télémétrie `tri_archives_jour` et campagnes de fond) + `Réglages` avec thème sombre/clair optionnel (`navigation.ts`, `theme.ts`), interface harmonisée style Google / FinanceAI, bilingue FR/EN.
- Lit/écrit l'état via l'API Google Sheets, Drive ou les routes `/api/*` (`api/` conservé sur Vercel ; portage en préparation dans `functions/src/` sous Firebase Blaze, ADR-0078).
- **Inutile aux Phases 1–3** : la revue passe par le dossier `00 · À vérifier`.

## Quotas & robustesse (Apps Script)
- Limiter le scan Gmail à `newer_than:30d`, traiter **par lots**.
- Prévoir les coupures de quota (UrlFetch, conversions Drive, temps d'exécution 6 min).
- **Idempotence** : portée uniquement par l'`Index`, jamais par un label Gmail
  (clé `messageId|i|nom|taille` pour les PJ, `important|messageId` pour le verdict « à traiter » du tri,
  `tri|fil|ts|lu|r3` en boîte ou `tri|fil|ts|lu|horsboite|r3` hors boîte dans `TriGmail.gs` pour le tri #16 — ADR-0079 ; `intention|messageId` n'est plus écrite depuis le 06/11/2026 ; `tache|…` / `event|…` ne sont plus
  écrites depuis le 05/11/2026) ; vérification AVANT tout traitement ; propagation de `fileId` sur toutes les voies rapides de `Pipeline.gs` (ADR-0077 / ADR-0079).
- **Pagination sur fenêtre mouvante (Phase 3)** : un offset numérique seul dérive quand de
  nouveaux mails s'insèrent en tête à chaque tick (`newer_than:30d` n'est pas un jeu de résultats
  stable). Le tri (`TriGmail.gs`) combine un scan « avant » (`scanAvantTri_`, s'arrête dès une page
  entièrement déjà indexée), un balayage cyclique borné (`scanCycliqueTri_`, ADR-0020 ; ces deux scans n'avancent l'index que des fils restés en boîte), un scan
  « arrière » (`scanArriereTri_`) ancré sur une DATE ABSOLUE persistée (jamais un offset) qui avance
  strictement vers le passé, et un balayage borné des fils lus > 29 j encore en boîte (`balayerBoiteAnciensLus_` sous `TRI_ANCIENS_REQUETE` et `reliquatFondNonVivant_`, ADR-0079). (`Intentions.gs`, qui faisait de même, est retiré depuis le 06/11/2026.)
- Aucune suppression automatique. Aucune écriture hors des dossiers cibles (Drive) ; plus aucun
  appel à Tasks ni à Calendar depuis le 05/11/2026 (ADR-0074).

## Sécurité
- Moindre privilège (scopes ci-dessus). Gmail : `gmail.modify` pour poser un libellé existant et archiver, rien d'autre (ADR-0012).
- Notifications système via `MailApp` sur le propre compte (pas un scope d'envoi tiers).
- Zone protégée (immigration + fiscal) jamais rangée auto — appliquée dans `Router.gs`.
- **Zone protégée (tri Gmail et classement)** : `Prefiltre.gs` (`toucheZoneProtegee_`) teste
  expéditeur/sujet/corps contre une liste de mots-clés immigration/fiscalité, INDÉPENDAMMENT du
  jugement du LLM (défense en profondeur). En zone protégée, `TriGmail.gs` (`analyserFil_` /
  `trierFil_`) analyse sur le sujet seul (jamais le corps envoyé au modèle) et ne pose jamais ⏰
  « À traiter » (ADR-0074 / ADR-0075) ; côté fichiers, `Router.gs` garde les documents en zone
  protégée.
