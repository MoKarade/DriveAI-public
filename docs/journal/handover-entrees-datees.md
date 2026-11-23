# Journal du HANDOVER : entrées datées (juillet à octobre 2026)

> Déplacé tel quel depuis le haut de `HANDOVER.md` (PR b du plan #468, 21/10/2026). Plus récent en haut.
> Le texte est conservé, pas réécrit : pour l'état courant, lire `HANDOVER.md`.
> Entrées du 28/10/2026 déplacées le 29/10/2026 (HANDOVER.md au plafond de 300 lignes, DriveAI#814).
> Entrées du 29/10/2026 déplacées le 05/11/2026 (même plafond, ADR-0074 étape 3) ; entrée « étape 1 » du 05/11 déplacée le 05/11 (ADR-0077). Entrées « étape 3 » et « étape 4 » du 05/11 déplacées le 06/11/2026 (étape 6b, #898). Entrée « étape 6a » du 05/11 déplacée le 18/11/2026 (même plafond, ADR-0078). Entrées « étape 6a bis » (05/11), « étape 7 » (05/11) et « étape 8 (#893) » (06/11) déplacées le 18/11/2026 (même plafond, ADR-0079 et mise à jour app/moteur).

## 06/11/2026 : relance sur une base épurée, étape 8 — un doublon n'est écarté que sur taille ET empreinte, avec la preuve (ADR-0077, #893)

`traiterDocument_` (`src/Pipeline.gs`) lit d'abord `size` et `md5Checksum` dans Drive (`metaFichierRest_`, `src/DriveRest.gs`,
métadonnées seules, à toute taille : une vidéo déposée deux fois est enfin vue) quand le descripteur porte `src.fileId`
(dépôt Drive, natif, partage, Documents ID) ; le MD5 local des octets n'est qu'un repli (pièce jointe Gmail, REST en panne),
et le blob n'est plus téléchargé pour un technique, un média ou un doublon. Un dépôt n'est écarté en `_Doublons` que si
`porteurVivantDe_` (`src/Journal.gs`, ADR-0070 révisé) NOMME un exemplaire prouvé vivant, que le md5 Drive d'aujourd'hui de
cet exemplaire est l'empreinte de l'Index (sinon il a changé depuis son classement) et que les tailles coïncident
(`jugerDoublon_`, pure ; natif : export entier identique, taille non comparée). « Dans le doute » n'est plus un doublon :
le fichier est classé normalement. Preuve écrite : Index J « Taille », K « Exemplaire » (en-têtes réparés au premier
tick), Journal « doublon → _Doublons : … (taille N o, empreinte …, exemplaire vivant <fileId>) » ou « … mais taille
différente → traité normalement ». Aucun appel LLM ajouté, un `files.get` par dépôt Drive (aucun pour un natif ni un
partage) et un par exemplaire relu par exécution ; `PORTEUR_VERIF_MAX_RUN` 15 → 150 (= `INTAKE_PAGE`). Un fichier remis
qui est son propre exemplaire n'est jamais « doublon de lui-même ». **Preuve attendue en prod** : en-têtes J/K sur
l'onglet Index après le premier tick ; au premier doublon, une ligne `doublon` avec J et K remplis. **Restes** : #897
(`files.get?fields=trashed,parents,size,md5Checksum` à la place de `getFileById`, rejeu des 403 de quota Drive) ; #898
(`fileId` sur les descripteurs de `Migration`, `Reset`, `RetourOrphelins`, qui hachent encore en local sous
`ignorerDoublon`) ; relecture de l'export d'un natif modifié (ADR-0077 §4, sans issue). Verrou : `test/doublon-taille.test.js`.

## 05/11/2026 : relance sur une base épurée, étape 7 — tout l'historique archivé sans libellé, sous UN plafond (ADR-0076, #891)

`trierHistoriqueArchive_` (`src/TriGmail.gs`), en tout dernier du tri : `has:nouserlabels -in:inbox -in:sent -in:drafts
-in:chats`, file mouvante (un fil étiqueté quitte le résultat, l'offset n'avance que des restants), libellés existants
seuls, **jamais** d'archivage ni de désarchivage hors boîte (`trierFil_(…, horsBoite)`), jamais de ⏰ hors fenêtre
(porte `ancien` partagée tri + audit), deux passes propres → `DriveAI_TRI_HISTO = terminé`, ré-armée au bump de
`TRI_REGLES_VERSION`, jamais d'apprentissage d'expéditeur hors boîte, un fil dont un message est en boîte est laissé
aux scans de la boîte. **Un seul plafond** `TRI_FOND_MAX_FILS_JOUR` = 300 sur la somme cyclique + nettoyage profond +
historique (`filsFondLusJour_`), avec `TRI_FOND_RESERVE_VIVANT` = 150 gardés au cyclique (`reliquatFondNonVivant_`) ;
`TRI_CYCLIQUE_MAX_FILS_JOUR` et `TRI_BOITE_MAX_FILS_JOUR` n'existent plus. Le scan AVANT et l'intake restent hors
plafond. Télémétrie : nouvelle clé `tri_histo_fils_jour`, Détail « Plafond commun 300/j ». Aucun geste de Marc.
**Preuve attendue en prod** (lendemain du merge) : `tri_histo_fils_jour` > 0 dans Télémétrie, ligne de Journal de la
première passe. **Restes à faire** (tâche de suite) : jauge unique « fond : somme/300 » dans l'app (`etat.ts`,
`mockData.ts` dit encore « Plafond 150/j ») ; helper `balayerCampagneFond_` pour fondre `nettoyerBoiteHistorique_` et
`trierHistoriqueArchive_` (≈ 45 lignes jumelles) ; une passe d'`auditerTriSujetCorps` sur `TRI_HISTO_REQUETE` (non faite avant 6b, reportée au ré-audit Gemini).
Verrou : `test/tri-historique.test.js`.

## 05/11/2026 : relance sur une base épurée, étape 6a bis — l'audit du tri sujet + corps sur fils réels (#890)

`auditerTriSujetCorps` (`src/TriGmail.gs`, éditeur Apps Script, protocole de précision §2) : 20 fils de
`TRI_AUDIT_REQUETE` (`newer_than:30d`, boîte et archivés), verdict d'aujourd'hui (mini-appel sujet seul ; important =
⏰ posé ou `important|`) contre celui de demain (`analyserFil_` par les MÊMES portes que le tri, `verdictATraiter_`),
une ligne par fil dans l'onglet temporaire `Audit tri` (domaine, sujet tronqué et vide en zone protégée, verdicts,
`portesFermees_`, colonne « Verdict Marc » vide ; jamais le corps). Lecture pure (aucune écriture Gmail ni Index),
refuse de tourner pendant une panne LLM, garde-temps `BUDGET_MS` avec écriture des lignes déjà produites, arrêt au
premier échec d'appel, pause entre deux fils, coût compté sous `audit-tri`, cellules en texte brut. Le geste de Marc
(lancer, remplir « Verdict Marc ») a été remplacé par l'étape 6 ter (#907) : la CI lance, le fil Claude juge.

## 05/11/2026 : relance sur une base épurée, étape 6a — le tri sait lire le corps, drapeau OFF (ADR-0075, #887)

`src/TriGmail.gs` gagne `analyserFil_` (UN appel sur expéditeur + sujet + corps balisé, balises neutralisées dans le
corps → `{categorie, suspect, aTraiter}` ; `promptTriFil_` = la catégorisation d'hier, désormais `promptCategorie_`, + la
règle « à traiter » du mini-check #14), `parserAnalyseFil_` (« à traiter » fermé par défaut), les portes PURES
`besoinATraiter_` / `verdictATraiter_` (une seule définition d'« important », reprise par l'audit #890), `appelTriLlm_`
(transport partagé avec `miniCategorie_` ; 400/404/413/422 = doute pour l'analyse seule) et `messageReference_`. Sous
`CONFIG.TRI_SUJET_CORPS` (OFF, livré ainsi ; dépassé par 6b le 06/11/2026, voir plus haut) : `trierFil_` n'attend plus `intention|`, décide le suspect AVANT « à
traiter », pose ⏰ et la ligne `important|` lui-même sur son verdict neuf seulement, analyse sur sujet seul et jamais ⏰
en zone protégée, ne lit le corps et n'appelle que si un verdict peut valoir vrai (jamais sur ⏰ posé, `important|`
écrit, promo, pré-filtre, mail de Marc, Marc en dernier). Rien du corps n'est jamais écrit (verrou
`test/tri-sujet-corps.test.js`, 14 tests). Suite : #890 (audit manuel `auditerTriSujetCorps` sur 20 fils réels, geste de
Marc, ADR-0075 §3), puis 6b : drapeau ON, `TRI_REGLES_VERSION` → `r3`, retrait d'`Intentions.gs` et du mode dégradé
ADR-0043 (`analyseIndisponible`, clés `|deg`, `intentionsSuspendues_`), étape `intentions` de `Main.gs`, Santé. ⚠️ ON
seul doublerait la facture. Drapeau OFF = comportement d'hier à l'identique (testé, mini-appel figé).

## 05/11/2026 : relance sur une base épurée, étape 4 — le moteur sait parler à l'API Gemini, aucun modèle changé (ADR-0073)

Étape 4 du plan de l'ADR-0074 (§6), reprise de la PR #873 (02/11/2026) sur le moteur épuré. `src/Gemini.gs` traduit à la
frontière réseau : `fetchAvecRetry_` et `fetchLlmDirect_` (`src/Llm.gs`) aiguillent tout modèle `gemini-…` vers
`fetchGemini_` (texte, images et PDF en base64 ; jetons de réflexion en sortie, cache déduit de l'entrée ; refus ; panne
401/402/403). Les cinq sites d'appel lisent leur en-tête par `cleLlm_` (vide pour Gemini : la clé Anthropic peut
disparaître à l'étape 5). `Cout.gs` compte deux familles (`g38`, `gl35`), `CONFIG.LLM_PRIX` porte la grille du 05/11/2026
(le 3.8 Flash double le 01/01/2027, `test/gemini.test.js` rougit ce jour-là). **Aucun nom de modèle n'a changé, aucun scope
OAuth ajouté** : le moteur tourne comme avant. Reste, dans l'ordre (ADR-0073 §5) : la clé `DriveAI_GEMINI_KEY` et le crédit
prépayé (gestes de Marc, `docs/DEPLOIEMENT.md` §6, par `setProperties(obj, false)` jamais par l'interface), `sonderGemini`
dans l'éditeur, l'audit de précision sur ~20 documents, puis l'étape 5 (noms de modèles, retrait de la clé Anthropic).
`sonderGemini` ne passe jamais par la détection de panne (une clé fausse ne suspend pas la production) et une sonde sans clé n'appelle rien.
À l'étape 5 aussi : les mentions « API Anthropic » de `docs/RUNBOOK.md`, `docs/ARCHITECTURE.md` et la liste de `.claude/agents/security-auditor.md`
(clé Gemini, palier payant obligatoire). Piège : le petit modèle Gemini coûte 3 à 5 fois plus que Haiku, le gain n'est que sur le grand ;
le prépaiement AI Studio est [Probable] (doc « Billing » relue le 05/11), le code HTTP à solde nul reste à lire à la sonde. Tests : `test/gemini.test.js` (29).

## 05/11/2026 : relance sur une base épurée, étape 3 — Tasks, Calendar, jeton hubperso et extraction d'intentions retirés (ADR-0074, DriveAI#885)

PR 3 du plan de l'ADR-0074 (§6). Côté moteur : `src/Tasks.gs`, `src/Calendar.gs`, `src/GoogleApi.gs` et `src/JetonHubperso.gs`
sont supprimés, avec l'extraction d'intentions de `Llm.gs` (`PROMPT_INTENTIONS`, `extraireIntentions_`), la sonde de
configuration, le callback OAuth de `doGet` (qui ne rend plus que « DriveAI ») et les clés `CONFIG` associées
(`PANNE_CONFIG_*`, `HUBPERSO_ECHEC_DURABLE_MS`, `CREATIONS_MAX_PAR_RUN`, `LLM_MAX_TOKENS_INTENTIONS`, `EVENT_DUREE_MIN_DEFAUT`,
`RESUME_ACTIONS_MAX`). `src/Intentions.gs` reste, réduit à l'**analyse d'importance** : scan des mails récents → pré-filtre →
gardes (zone protégée, phishing, promo non lue) → `miniCheckMail_` → libellé ⏰ « À traiter » et clé `important|<id>`, statuts
`intention-importante` / `intention-ecartee` / `intention-zone-protegee`. Les noms (`traiterIntentionsMail_`, étape `intentions`,
clé `intention|`) sont gardés pour la continuité de l'Index et du tri : `TriGmail.gs` n'attend plus que `intention|` (le marqueur
`analyse|` de l'ADR-0049 disparaît) et son mode dégradé (ADR-0043) reste. Le drapeau `DriveAI_INTENTIONS_RETARD` reste écrit et lu : `c:<offset>` sur une coupe (plafond), `d` /
`cp:` seulement sur REPRISE (mini-check en échec, message laissé sans clé) ; plus jamais sur différé ni panne d'API de création.
Revue de flotte : un mini-check en échec rend `null` et n'est plus un verdict (avant, « pas important » par défaut devenait
terminal et le tri archivait sans ⏰) ; borné par `QUARANTAINE_MAX` puis `intention-abandonnee`. Transition : les messages
encore dans la fenêtre de 30 jours qui ne portent qu'une ligne `analyse|` (différés de l'ADR-0049) sont ré-analysés une fois
(un mini-check chacun, sous `INTENTIONS_MAX_PAR_RUN`), puis convergent ; rien n'est supprimé. Santé passe de 12 à 11 lignes (la ligne « API Tasks & Calendar » part) ; le résumé hebdo compte
les mails analysés au lieu des tâches et événements. Côté Vercel : `api/_lib.ts` ne demande plus `tasks`, `calendar.events` ni
`calendar.readonly` (réduction seule : aucun nouveau scope, verrou `app/test/bff.test.ts`). Côté app : l'onglet Agenda
(`vues/Agenda.tsx`, `agenda.ts`, `agendasStore.ts`, `composants/Creation.tsx`), les tâches du jour et « Ma journée » de l'accueil,
la section Tasks/Calendar de `google.ts`, 35 clés i18n, les mocks, le CSS et l'icône sont retirés ; la navigation a deux entrées
(Aujourd'hui · Documents) et Playwright photographie trois écrans. ADR 0022, 0041 et 0049 passent « Abrogé par 0074 » ;
`docs/HUBPERSO.md` est supprimé. L'analyse d'importance sera absorbée par le tri Gmail à l'étape 6 (protocole de précision sur
échantillon réel à ce moment-là : la règle de décision du tri ne change pas ici). Restent en place sans être lues : les sept Script
Properties `DriveAI_HUBPERSO_*` (`CLIENT_ID`, `CLIENT_SECRET`, `REFRESH`, `ACCES`, `ECHEC`, `REDIRECT`, `STATE`), dont un refresh
token qui porte encore `tasks` + `calendar.events` : un privilège inutilisé se révoque, il ne s'ignore pas (revue sécurité) ; le
geste de Marc, jamais pressé, est écrit dans `docs/journal/handover-a-faire-marc.md` (révoquer le consentement dans le compte
Google, supprimer le client OAuth « DriveAI » du projet GCP hubperso, effacer les sept Properties). Les lignes `tache|` / `event|`
déjà dans l'Index ne sont ni relues ni supprimées. Aucune suppression de mail, de fichier ni de libellé ; aucun nouveau scope.

## 05/11/2026 : relance sur une base épurée, étape 1 — le canal vers la Mémoire est retiré (ADR-0074, DriveAI#881)

Décision de Marc (brief du 05/11, mission DriveAI#880) : DriveAI ne fait plus que trois choses (mails entrants et pièces
jointes, tri Gmail natif, rangement du Drive), passe à Gemini (payant, 20 $/mois, derniers modèles), et se prépare pour
Antigravity. Cette PR retire quatorze modules (`Memoire`, `Piece`, `PieceVision`, `AuditPiece`, `AuditVision`,
`PerimetrePiece`, `RattrapagePiece`, `HistoriqueImport`, `EnvoiMessenger`, `RelecturePiece`, `RelectureImage`,
`TroisiemeLecture`, `AgendaMemoire`, `AvancementMemoire`), leurs étapes du tick, leurs clés de `CONFIG`, quatorze lignes de
Santé (26 → 12), les onglets Lecture et Audit de l'app (128 clés i18n, le CSS, l'icône) et quinze fichiers de tests.
Budgets : `SYNC_BUDGET_JOUR_MS` reprend ses 12 min, l'enveloppe des campagnes est verrouillée à 12 min/j (les 51 min
libérées retournent à la marge, à reprendre par nom dans les PR suivantes). Les onglets Sheet déjà créés
(`AuditPiece`, `HistoriqueImport`, `PiecesFaites`) ne sont plus créés ni remplis, jamais supprimés ; de même, les Script
Properties du canal (`DriveAI_MEMORYAI_TOKEN`, `DriveAI_MEMOIRE_*`, `DriveAI_AUDIT_PIECE_*`, `DriveAI_MESSENGER_*`,
`DriveAI_RELECTURE_*`, `DriveAI_AGENDA_ETAT`…) restent dans le projet Apps Script sans être lues (les retirer est un geste
de Marc, jamais pressé), et les « à faire » du canal dans `docs/journal/handover-a-faire-marc.md` sont clos. Rien n'est servi
différemment sur Vercel (bloqué jusqu'au 03/12) ; le moteur se déploie par `deploy.yml`. Suite : purge MCP/LIA, purge des
intentions, adaptateur Gemini (reprise de #873), bascule, tri Gmail sujet + corps, historique, doublons, multimodal, dates,
racine zéro, fusions, terrain Antigravity. Plan complet : `docs/adr/0074-relancer-driveai-sur-une-base-epuree.md` §6.

## 05/11/2026 : relance sur une base épurée, étape 2 — MCP, chat à outils, LIA et inventaire FinanceAI retirés (ADR-0074, DriveAI#883)

PR 2 du plan de l'ADR-0074 (§6). Moteur : `src/Mcp.gs` (ADR-0042), le chat à outils `chat-assistant` (ADR-0026) et la
recherche IA `recherche-ia` quittent `WebApp.gs`, `Llm.gs` et `Config.gs` ; `doPost` ne sert plus que `pas-suspect`,
`hub-summary`, `gardes-app` et le tick ponctuel, sans aucun appel LLM ; les lecteurs bornés `lireOngletBorne_` et
`lireQueueOngletBornee_` passent dans `WebApp.gs`. Vercel : `api/mcp/*`, `api/_mcpOauth.ts`, `api/lia/ask.ts` et
`api/_lia*.ts` supprimés, `vercel.json` ne déclare plus que `api/hub/summary.ts` (`api/` : 6 fonctions). App : LIA
(`@mokarade/lia-ui`, `app/src/lia.ts`, `liaEtat.ts`) retirée, plus aucune entrée IA. L'inventaire FinanceAI (ADR-0045)
n'avait jamais été codé. ADR 0026, 0042 et 0069 « Abrogé par 0074 » ; `docs/MCP.md` supprimé. Conséquence connue : la
demande d'analyse de réorganisation (onglet Réorg, `Reorg.gs`) n'a plus d'entrée depuis l'app ; à rebrancher dans la PR
« fusions de dossiers ». Restent sans être lus : `DriveAI_MCP_SECRET`, les variables Vercel du MCP et de LIA, le
`repository_dispatch` `note-lia` de `reacteur.yml` (chemin protégé, inerte).

## 29/10/2026 : le résumé du hub ne relit plus l'Index entier (DriveAI#806)

`majResumeHub_` (`src/WebApp.gs`) calcule ses compteurs « chers » (classés et erreurs sur 7 jours, dernier document classé) sur la QUEUE de l'Index (3 000 lignes, `CONFIG.HUB_FENETRE_INDEX`) et du Journal (4 000, `CONFIG.HUB_FENETRE_JOURNAL`), lue par `lireQueueOngletBornee_` (`src/Mcp.gs` ; depuis le 05/11/2026 : `src/WebApp.gs`), au lieu de `getDataRange()`. Garde-fou de justesse : si la fenêtre ne remonte pas à 7 jours, ou si l'Index n'y montre aucun document classé, l'onglet est relu en entier : une fenêtre trop petite coûte du temps, jamais un chiffre faux. Hypothèse : Index et Journal sont écrits par ajout, dans l'ordre. Les tailles de fenêtre ne sont pas calibrées sur le rythme réel de l'Index ; à ajuster si le repli se déclenche à chaque tick. Tests dans `test/webapp.test.js` (équivalence sur 10 000 lignes, lecture bornée, replis). Aucun coût.

## 29/10/2026 : la panne du compte LLM a sa propre ligne dans Santé (DriveAI#805)

`majSante_` (`src/Journal.gs`) écrit maintenant 26 lignes (12 depuis le 05/11/2026, ADR-0074) : « Compte LLM : actif | ⛔ panne depuis HH:MM (re-sonde ≤ HH:MM) | indéterminé (lecture impossible) », lue sur la Property `DriveAI_LLM_PANNE` par `lirePanneCompteLlm_` (`src/Llm.gs`). Une Property illisible donne « indéterminé », jamais « actif ». Aucun octet de Property en plus. Le test figé passe de 25 à 26 lignes, justifié dans `test/sante.test.js`, avec trois tests (trois états, lecture de la Property, lecture cassée).

## 29/10/2026 : l'audit vision lancé à la main prend le verrou du tick (DriveAI#802)

`auditerVisionMaintenant` (`src/AuditVision.gs`) prend `LockService.getScriptLock().tryLock(10 * 1000)` comme `rattraperPiecesMaintenant` : verrou pris, il répond « un tick tourne — relance dans 5 minutes » sans appel LLM ; il le rend dans le `finally`. Test `VERROU` dans `test/piece-vision.test.js` (rouge si le `tryLock` est retiré). Aucun coût, aucune campagne relancée.

## 29/10/2026 : le téléphone couché reçoit la coquille téléphone (DriveAI#807)

Le seuil « téléphone » est maintenant `(max-width: 760px), (max-width: 900px) and (max-height: 520px)`, écrit à l'identique dans `app/src/styles.css` (les quatre blocs qui portaient 760 px seul) et `SEUIL_TELEPHONE` de `app/src/vues/Agenda.tsx` (vue retirée le 05/11/2026, ADR-0074 : il ne reste que le seuil CSS). Un iPhone couché (812 ou 844 × 390) a donc la barre d'onglets basse, pas de rail latéral, et la vue Liste/Grille de l'Agenda. Verrous : `app/test/seuil-telephone.test.ts` (compare la condition complète, rouge si un seul des deux fichiers bouge) et le scénario Playwright 844 × 390 de `app/e2e/screenshots.spec.ts` (barre visible, rail masqué, aucune largeur en trop ; rouge avant le changement).

## 29/10/2026 : chaque étape du tick a un budget quotidien classé ou une exception nommée (DriveAI#811)

`test/orchestration.test.js` (test « INVENTAIRE des étapes ») énumère tous les `etapeSuivie_('...')` du code et exige que chacun soit classé : une constante `*_BUDGET_JOUR_MS` lue hors `Config.gs`, ou une exception avec sa raison (`migration`, `rangement`, `dryrun-v2`, `dryrun-cmp` n'ont pas de budget du jour ; les étapes du flux vivant sont déclarées comme telles). Ajouter une étape sans l'inscrire rougit le test (vérifié en ajoutant une étape factice). Aucun code du moteur modifié, aucune campagne relancée.

## 29/10/2026 : un agenda en erreur ne vide plus la vue (DriveAI#810)

(Retiré le 05/11/2026 avec l'Agenda, ADR-0074.) `lireAgendas` (`app/src/agenda.ts`) lisait chaque agenda coché puis les Tâches avec `Promise.allSettled` : l'échec d'un seul est nommé dans une bannière en place (Agenda) ou dans la bannière de l'accueil (Aujourd'hui, qui ne dit alors plus « rien à faire »), les autres événements restent affichés. Seul le cas « rien n'a répondu » garde la bannière pleine avec « Réessayer ». Les deux effets ont un drapeau `annule` : une réponse périmée n'écrase plus la récente. Tests : `app/test/agenda.test.ts` (bloc `lireAgendas`).

## 29/10/2026 : gitleaks 8.30.1 et semgrep suivi par Dependabot (DriveAI#801)

Le job « Sécurité (secrets · analyse statique) » télécharge gitleaks 8.30.1 (empreinte de la release officielle, relue le 29/10) au lieu de 8.28.0, qui portait la CVE-2026-63728. Semgrep est épinglé dans `requirements-ci.txt` (racine) et `.github/dependabot.yml` suit désormais l'écosystème `pip`. `test/ci-securite.test.js` échoue si la version de gitleaks passe sous le plancher écrit en clair ou si semgrep reprend une version en ligne dans `ci.yml`. gitleaks reste hors de portée de Dependabot (binaire téléchargé) : le plancher se relève à la main.

## 29/10/2026 : lia-ui re-pinné de v0.48.0 à v0.48.2 (DriveAI#796)

`app/package.json` et `app/package-lock.json` passent à `github:MoKarade/lia-ui#v0.48.2` (commit `524f7b1`). La v0.48.1 (lia-ui#166) garde la discussion de LIA après 2 minutes sans geste au lieu de la fermer et de l'effacer partout (état partagé compris) ; la v0.48.2 (lia-ui#168) fait que toucher le corps de LIA cache le chat sans effacer la discussion (seuls ✕ et Échap l'effacent). Rien d'autre ne change dans `app/` (566 tests, build et portes verts). Reste : le relevé du PC sur la production (poser une question à LIA, attendre plus de 3 minutes, recharger : la discussion est là, et aussi sur le hub).

## 29/10/2026 : la corbeille en lot lit « 404 sur tout » comme une panne (DriveAI#813)

Avec le mauvais compte Google, chaque appel de la corbeille répond 404, et `corbeillerLot` (`app/src/corbeille.ts`) classait chaque ligne `vide-disparu` pour de bon, sans alerte. Désormais `CORBEILLE_MAX_PANNES` (5) réponses 404 d'affilée dès la première ligne du lot, sans aucune autre réponse entre, coupent le lot (`interrompu = 'pannes'`, `derniereCause` « 404 sur tout : mauvais compte ? ») et ne marquent rien : ces lignes restent candidates. Un seul résultat différent avant le seuil (corbeille réussie, autre verdict, panne) prouve que le compte est le bon : les 404 déjà vus sont alors classés `vide-disparu` comme avant. Trois tests dans `app/test/corbeille.test.ts`. Aucun changement d'écran : le message existant « Lot interrompu » affiche la cause.

## 29/10/2026 : la fumée de production commune est branchée, avec sa route de santé (DriveAI#775)

`.github/workflows/fumee.yml` appelle le workflow commun `fumee.yml` de MoKarade/.github (épinglé par SHA) après chaque déploiement de production réussi, ou à la main (« Run workflow »), et sonde l'app en ligne : `/api/sante` rend `{ "ok": true }`, `/api/hub/summary` refuse sans jeton puis répond avec `HUB_TOKEN`, `/api/login` redirige vers Google (l'entrée de la connexion : l'app est une page statique, `/login` rend 404, lu en production le 29/10). La route de santé (`api/_sante.ts`) est publique et ne dit rien d'interne : 200 si les trois variables OAuth sont là, sinon 503 `{ ok: false, cause: "config" }`. `api/` compte déjà 12 fonctions (plafond du plan Hobby) : la santé est servie par `api/login.ts` (`vercel.json` réécrit `/api/sante` vers `/api/login?cible=sante`), comme l'état de LIA l'est par `ask`. `app/test/sante.test.ts` verrouille la route, la réécriture, le plafond et le workflow. **L'adresse de production n'est pas écrite dans le workflow** (le garde de données personnelles refuse le nom de domaine) : elle vient de la variable du dépôt GitHub `URL_PRODUCTION`, et sans elle le job est sauté, pas rouge. Une fumée rouge DEMANDE le retour en arrière de la production, donc l'armement se fait dans cet ordre, par le PC : (1) secret `HUB_TOKEN` du dépôt = la valeur du projet Vercel `driveai` ; (2) variable `URL_PRODUCTION` = l'adresse de production, https ; (3) « Run workflow » à la main, tableau lu vert dans le résumé du job ; (4) seulement ensuite le secret `HUB_DISPATCH_TOKEN` (retour en arrière automatique). Preuve de la tâche : le workflow `Fumée de production` vert sur un déploiement de production réel, et `curl -s https://<domaine de production>/api/sante` rend `{"ok":true}`.

## 29/10/2026 : la feuille de route et les sept ADR de conception disent ce qui est livré (DriveAI#816)

`docs/ROADMAP.md` n'a plus de ligne « à faire » ou « en cours » : #5 à #8 et #10 à #15 passent à ✅, #17 est absorbé par #19, #18 (auto-validation à 3 occurrences) est codé puis coupé le 2026-07-17 (`CONFIG.ENTITES_AUTO_VALIDATION: false`). Les ADR 0003, 0005, 0008, 0009, 0010, 0011 et 0012 disent « implémenté » et nomment ce qui a été retiré ou révisé depuis (ADR-0031, 0043, 0050, 0051). Le renvoi vers les lignes `P1-01 → P1-20` pointe sur `git show dd5e4fe:BACKLOG.md`. Docs seules : rien n'est déployé.

## 29/10/2026 : une gate d'étape qui lève laisse une trace (DriveAI#803)

`etapeSuivie_` (`src/Suivi.gs`) enveloppe maintenant l'évaluation des gates : une gate qui lève (le comptage Drive `nbFichiersATrier_` de l'étape `rangement`, par exemple) est enregistrée comme erreur de l'étape (`et`/`e`, statut « erreur »), `onErreur` est appelé s'il existe, l'étape n'est pas exécutée et le tick continue. Avant, l'exception remontait sans trace et la ligne de suivi gardait l'état du tick précédent. Deux tests dans `test/suivi.test.js` (rouges si le `try` est retiré) ; ADR-0038 §b mise à jour. Aucun coût.

## 29/10/2026 : le rattrapage de « _Médias » ne rétrograde pas une pièce protégée, verrouillé par un test (DriveAI#817)

`rattraperMediasMalClasses` (`src/Maintenance.gs`) déplace des photos vers `_Médias`. Ses deux gardes de zone protégée (domaine 04 à l'Index, colonne D ; remontée d'ancêtres stricte `aParentProtege_`) existaient mais aucun test de comportement ne les tenait : `test/rattrapage-medias.test.js` (4 tests) les exerce avec une photo SANS texte, le cas nominal de la fonction. Chaque garde retirée seule rend un test rouge ; un test témoin prouve que le montage atteint bien le déplacement. Aucun changement de `src/`. ADR-0047 §7 : la date « Traité le » des trois fichiers a été relevée dans la Sheet le 29/10/2026 (relevé PC) : toutes antérieures au garde-fou du 10/09/2026 (30/06 au 31/07).

## 29/10/2026 : quota Gmail épuisé = « suspendu », plus « en cours » (DriveAI#804)

`intake-gmail`, `intentions` et `tri-gmail` (`src/Main.gs`) portent la gate partagée `gPanneGmail` (`estPanneGmail_() ? 'quota Gmail épuisé' : null`, 18 caractères pour 24 permis). Avant, ces trois étapes sortaient en silence sur le quota, s'enregistraient « ok » et la ligne Progression restait « en cours ». Elles affichent maintenant « suspendu (quota Gmail épuisé) ». Les `if (estPanneGmail_()) return` internes restent (appels hors tick, panne en cours de run). Tests : `test/progression.test.js` (les trois lignes, quota posé puis levé) et `test/orchestration.test.js` (définition unique, gate présente sur les trois étapes), rouges sans le changement.

## 29/10/2026 : un contenu dont plus aucun exemplaire n'existe n'est plus jeté en `_Doublons` (DriveAI#809, ADR-0070)

`traiterDocument_` (`src/Pipeline.gs`) demande maintenant à `empreinteAUnPorteurVivant_` (`src/Journal.gs`) si un exemplaire de l'empreinte existe ENCORE avant d'envoyer un fichier en `_Doublons`. Avant : « déjà vue » suffisait, donc un fichier classé puis corbeillé, redéposé, partait en `_Doublons` sans aucune copie classée. Maintenant : il n'est écarté du doublon que si TOUS les exemplaires connus sont prouvés morts (corbeille, ou seul parent `_Doublons`) ; exemplaire vivant, inconnu, lecture qui échoue ou budget épuisé : doublon, comme avant. Le classement lui-même ne change pas (aucun domaine, entité ni nom touché), donc pas d'audit sur documents réels (ADR-0070 §5).

- **Coût** : aucun appel LLM ajouté. L'Index est relu (colonnes A, F, G, I) une seule fois par run et seulement si un doublon se présente ; au plus `PORTEUR_VERIF_MAX_RUN` (15) contrôles Drive par run, `PORTEUR_CANDIDATS_MAX` (5) exemplaires par empreinte.
- **À lire en production** : la ligne du journal `Pipeline` « exemplaire disparu (corbeille ou _Doublons) → contenu traité normalement ».
- **Limite assumée** : un exemplaire supprimé pour de bon lève comme une panne, donc reste « inconnu » (doublon). Seules la corbeille et `_Doublons` sont couvertes.
- **Tests** : `test/doublon-porteur.test.js` (17), rouges si on retire la décision, si la corbeille ne prouve plus rien ou si une lecture qui échoue compte pour « mort ». Suite : #808 et #814 touchent le même couloir (`Pipeline.gs`, `Journal.gs`), une seule à la fois.

## 29/10/2026 : le frein des campagnes LLM passe de 40 à 20 $ (DriveAI#849)

`CONFIG.LLM_BUDGET_CAMPAGNES` (`src/Config.gs`) vaut 20 $, décision de Marc du 29/10/2026 (« Ok 20$ », ligne 1 de DriveAI#818 ; le relais disait « option A », mais A vaut 10 $ et B vaut 20 $ : le chiffre de Marc a été suivi). Le frein était atteint à 40,90 $ ; il n'arrête que les campagnes, jamais le flux vivant. La ligne Santé « Frein campagnes à 20 $ » et le résumé du hub lisent la constante. Comptes de coût inchangés.

## 29/10/2026 : un fichier classé que Marc remet dans `00 · À trier` est re-traité une fois (DriveAI#808, ADR-0071)

`traiterDepots_` (`src/Intake.gs`) sautait tout fichier dont la clé `drive|<id>` était à l'Index : une remise par Marc ne servait à rien. Maintenant, si la DERNIÈRE ligne d'Index du fichier dit qu'il a été placé ailleurs (statut `classé`, `à vérifier`, `doublon`, `technique` ou `média`, avec un chemin), `cleRedepot_` rend la clé `redepot|<id>|<n>` et le fichier passe par `traiterDocument_` avec `ignorerDoublon` (son empreinte est déjà connue). Les résidents légitimes (quarantaine, natif, zone protégée) restent en place.

- **Écart avec la tâche** : elle proposait `getLastUpdated` > inscription d'Index. [Probable] un déplacement ne change pas `modifiedTime` : le signal n'aurait jamais tiré sur un simple glisser-déposer. L'Index fait foi (ADR-0071 §2).
- **Coût** : aucune cellule de plus sur le chemin chaud (le numéro de ligne vient de la colonne A déjà lue). Au plus `REDEPOT_VERIF_MAX_RUN` (10) relectures de 6 cellules par run ; un résident jugé est mémorisé (Script Property `DriveAI_REDEPOT_RESIDENTS`, 300 entrées) et ne coûte plus rien. Un appel LLM par remise réelle.
- **À lire en production** : la ligne du journal `Intake` « Re-dépôt détecté » puis une ligne d'Index `redepot|<id>|1`. [À vérifier] Aucune remise réelle n'a encore eu lieu : seuls les tests couvrent le comportement.
- **Tests** : `test/redepot.test.js` (19), 13 gardes retirées une à une, chacune fait rougir un test. Suite : #814 touche le même couloir (`Pipeline.gs`, `Journal.gs`).

## 29/10/2026 : l'empreinte d'un contenu vide n'est plus écrite à l'Index ni jugée doublon (DriveAI#814, ADR-0072)

L'empreinte d'un Google natif est le MD5 de son texte exporté : deux natifs vides ou quasi vides la partageaient. `ignorerDoublon` protégeait le natif lui-même, mais son empreinte était écrite à l'Index (le drapeau n'y survit pas), et un fichier de 0 octet ou une pièce jointe vide était ensuite jugé « déjà vu » puis jeté en `_Doublons`. Maintenant `empreinteUtilisable_` (`src/Pipeline.gs`) rend `''` pour le MD5 du contenu vide (`CONFIG.EMPREINTE_CONTENU_VIDE`) et pour un natif que l'intake marque `empreinteNonIdentifiante` (texte sous `OCR_MIN_CARS_EXPLOITABLE`) : rien n'est écrit, rien n'est comparé. `estDoublon_` (`src/Journal.gs`) répond `false` pour le MD5 du vide même s'il traîne dans l'Index. Le classement ne change pas.

- **Limite assumée** : les lignes déjà écrites pour un natif de 1 à 19 caractères ne sont pas reconnaissables (la longueur du texte est perdue). Seul le MD5 du vide est filtré à la lecture. Risque résiduel : un contenu identique, très court, déposé par un autre chemin.
- **Effet voulu** : deux fichiers vides ne sont plus « doublons » l'un de l'autre, ils suivent le pipeline normal.
- **Coût** : aucun appel Google ni LLM de plus.
- **Tests** : `test/empreinte-vide.test.js` (9), 7 gardes retirées une à une, chacune fait rougir au moins un test. Suite : #814 était la dernière tâche du couloir `Pipeline.gs` / `Journal.gs` (#809, #808 faites).

## 28/10/2026 : la grille de conformité lit un gate, un seuil, un audit et un Node à la racine (DriveAI#777)

Le job `conformite` (DriveAI#492) lit la racine et sortait rouge sur quatre points alors que l'app tournait bien. Corrigé sans toucher au cliquet d'`app/` : `package.json` racine expose `typecheck` et `build` (ils délèguent à `app/`) et `lint` (= `scripts/syntaxe-gs.mjs`, la syntaxe des `.gs` ; le dépôt n'a pas d'ESLint, un `lint` vide ne prouverait rien) ; `qualite/seuils.json` à la racine est une copie des seuils `couverture.*` d'`app/qualite/seuils.json`, et `test/seuils-racine.test.js` rougit si les deux divergent (après un `npm run portes:maj`, reporter les valeurs) ; la CI lance `npm audit --omit=dev` dans `app/` (0 vulnérabilité au 28/10/2026) ; `.nvmrc` (24) et `engines.node` posés. Mesure locale de la grille : lignes 3, 4 et 7 vertes, plus aucune cause « aucun npm audit ». Restent rouges, chacune avec sa tâche : 5 et 9 (DriveAI#775), 11 (DriveAI#774), contrat hub (DriveAI#778) ; lignes 1 et 2 par décision.

## 28/10/2026 : BACKLOG.md réduit à un renvoi vers les issues (DriveAI#774)

`BACKLOG.md` passe de 1 591 lignes à 9 : un renvoi vers les issues du dépôt, comme CarAI (CarAI#138). L'ancien contenu reste lisible par `git show dd5e4fe:BACKLOG.md`. Ses entrées encore ouvertes (19 sections, une centaine de lignes « non corrigé » ou « reste ouvert », la plupart de juillet à septembre) ne sont PAS recopiées une à une ici : les trier demande de relire le code, c'est la tâche DriveAI#782, sans quoi on aurait créé des dizaines d'issues périmées. `CLAUDE.md` et `docs/claude/08-documentation.md` disent maintenant où vit le reste à faire. Ligne 11 de la grille de conformité : verte.

## 28/10/2026 : lia-ui re-pinné de v0.47.0 à v0.48.0 (DriveAI#788)

`app/package.json` et `app/package-lock.json` passent à `github:MoKarade/lia-ui#v0.48.0` (commit `b0c8524`). La v0.47.1 relit l'état partagé de LIA toutes les 2 minutes et à l'écran ; la v0.48.0 lit les barres HTML (lia-ui#164) : « Explique-moi ça » sur une barre de l'entonnoir « Du Drive à la mémoire » (onglet Avancement) cite désormais les libellés et les proportions écrites. Rien d'autre ne change dans `app/` (538 tests, build et portes verts). Reste : le relevé du PC sur la production, qui refait la question sur une barre.

## 28/10/2026 : contrat du hub re-pinné de v1.5.0 à v1.6.0 (DriveAI#778)

`app/package.json` et `app/package-lock.json` passent à `@mokarade/hub-contract#v1.6.0` (commit `df97e9f`). La v1.6.0 ajoute le catalogue d'actions de l'assistant, optionnel : `validateSummary` et le format du fil des summaries sont inchangés, `CONTRACT_VERSION` reste 1, mêmes dépendances (`zod` ^4.6.7). `api/` reste sans dépendance et inline la forme du contrat ; `app/test/hub-summary.test.ts` verrouille la correspondance avec le vrai schéma et passe. `npm ci` installe bien 1.6.0 ; `app` : 538 tests, typecheck et portes verts.

## 28/10/2026 : l'état partagé de LIA branché dans l'app web (DriveAI#771)

Une seule LIA, un seul état (Marc, 23/10/2026) : la discussion, l'humeur et les envies de LIA suivent maintenant le hub (donc MemoryAI) au lieu de rester dans le navigateur. `GET|PUT /api/lia/etat` (`api/_liaEtatRoute.ts`) revérifie la session comme `ask`, refuse un invité (403, aucun appel au hub), juge le corps (16 Ko, forme d'un état) puis relaie `{hub}/api/lia/etat` avec `x-hub-token` et `x-lia-proprietaire: 1` (`api/_liaEtat.ts`). Hub muet, 401 ou 403 du hub, réponse hors contrat : 503, LIA garde son état local. `app/src/main.tsx` passe `etat: etatSansLectureCachee(etatHttp('/api/lia/etat'), () => document.hidden)` (`app/src/liaEtat.ts` : onglet caché = aucune lecture). **Pas de 13e fonction Vercel** : `api/` en compte déjà 12 (plafond du plan Hobby), donc la route est servie par `api/lia/ask.ts` : `vercel.json` réécrit `/api/lia/etat` vers `/api/lia/ask?cible=etat`, la garde de session est partagée (`api/_liaSession.ts`). Limite connue : `api/` ne peut pas importer `validerEtat` de lia-ui (aucun `node_modules` à la racine au build), donc DriveAI juge la forme et le hub juge l'état en entier avant MemoryAI. Tests : `app/test/lia-etat.test.ts` (relais, route, invité, 401, 403, 413, hub muet, adaptateur, nombre de fonctions). Preuve de production : voir l'issue.

## 28/10/2026 : contrôles communs branchés dans la CI (DriveAI#492), robot du PC gardé (DriveAI#491 abandonnée)

DriveAI reste privé (Marc, 28/10/2026 ; MoKarade/.github#16 fermée). Les workflows communs de MoKarade/.github (`securite.yml`, `conformite.yml`, `fumee.yml`) choisissent déjà le robot du PC pour un dépôt privé : le blocage « ubuntu-latest en dur » de #492 n'existe plus. `ci.yml` appelle maintenant `securite-commune` (OSV-Scanner sur `app/package-lock.json`, zizmor non bloquant ; le job `securite` que `.mergify.yml` exige reste tel quel) et `conformite` (`bloquant: false`, le tableau s'écrit dans le résumé du job). #491 (« retirer le robot du PC ») est abandonnée : sur un dépôt privé, le robot est voulu, et `deploy.yml` (clasp) ne tourne que là. Premier relevé de la grille sur la PR #776 : 4 vertes, 9 rouges, 2 sans objet. Chaque rouge a sa suite : lignes 1 et 2 (dépôt privé, `deploy.yml` et `pousser-reset.yml` sur le robot du PC) rouges PAR DÉCISION, à signaler au fil .github pour qu'une décision de dépôt privé les rende « sans objet » ; ligne 3, 4, 6 (npm audit), 7 (Node) : DriveAI#777 ; ligne 7 (contrat hub v1.5.0 → v1.6.0) : DriveAI#778 ; lignes 5 et 9 (fumée, route de santé) : DriveAI#775 ; ligne 9 (dépendance `@sentry/*`) : décision à part, pas de nouvelle dépendance sans en parler ; ligne 11 (`BACKLOG.md` à un renvoi) : DriveAI#774. Lancer la grille avec `racine: app` ne marche pas (elle perd `vercel.json`, ligne 8). Passer `conformite` à `bloquant: true` quand la grille est verte. Preuve : le job `conformite` tourne sur la PR et écrit son tableau.

## 28/10/2026 : l'état de LIA sera partagé par un relais à jeton d'app (DriveAI#696, ADR-0069, mission MoKarade/.github#557)

Cadrage seulement, aucun code. DriveAI a son propre cookie (`driveai_rt`), donc elle ne peut pas relayer `/api/lia/etat` du hub avec la session du hub comme les autres apps. Décision (ADR-0069) : `api/lia/etat.ts` revérifie la session comme `ask`, puis appelle le hub avec `HUB_TOKEN` ; le hub doit d'abord accepter ce jeton sur sa route d'état (il ne l'accepte aujourd'hui que sur `ask`). Deux tâches : une dans Hubperso, une dans DriveAI qui l'attend. D'ici là, LIA garde son état local dans le navigateur de DriveAI. Preuve : ADR fusionnée, tâches créées sous la mission.

## 28/10/2026 : lia-ui v0.47.0, LIA lit les graphiques et ne scanne que sur demande (DriveAI#768, mission MoKarade/.github#575)

Épingle `@mokarade/lia-ui` v0.47.0 (sha pelé `7f1d7bb`), seul changement (`app/package.json`, lock). Marc, 28/10/2026 : « l'assistant voit toujours pas les graphes » et « l'animation de scan uniquement sur ce que je lui ai demandé ». v0.47.0 : LIA lit un graphique SVG (titre, axes, légende, valeurs écrites) sans code chez l'app ; les graphiques dessinés sur un `<canvas>` restent illisibles (limite connue). v0.46.0 : le scan des nanobots ne joue que sur ce que Marc a demandé d'analyser. v0.45.x et v0.44.x arrivent avec. Rien à brancher. Preuve : déploiement `READY` sur le commit fusionné, puis relevé du PC (question sur un graphique : la réponse cite les libellés écrits).

## 28/10/2026 : l'ancien assistant est retiré de l'app, tout passe par LIA (DriveAI#732, mission MoKarade/.github#575)

Marc, 28/10/2026 : « enlever le bouton de l'ancien assistant, supprimer la page et tout ce qui concerne une IA dans les pages, tout passe par LIA ». Retirés de `app/` : l'onglet et la vue Assistant (`vues/Assistant.tsx`, historique de chat, puces), le bouton « IA » de la recherche et le bouton ✨ « analyser » de l'explorateur, les appels `rechercheIA` et `envoyerMessageChat` (`google.ts`), `requeteDepuisPlan`, les textes « selon l'IA », les clés i18n et le CSS `chat-*`, la dépendance `react-markdown`, `messageEffacerConversation`. La navigation passe à QUATRE entrées (Aujourd'hui, Agenda, Documents, Lecture). Les rangements que LIA propose restent, à valider PAR ACTION : `ReorgVue` s'affiche maintenant en bandeau « À valider » en haut de Documents (vide = caché), avec les dossiers vides à corbeiller ; aucune suppression, aucune donnée touchée, aucun rangement sans le oui de Marc. `ReorgVue` ne demande plus d'analyse : la demande passe par LIA. **Pas touché** : le moteur `src/*.gs` et `api/mcp/index.ts` (les actions `chat-assistant` et `recherche-ia` servent encore `question_documents` du MCP ; les retirer = une tâche à part). **Reste** : le titre du pas CI « Captures des 5 écrans » (`.github/workflows/ci.yml`, chemin protégé) dit encore 5 ; l'app en montre 4. Preuve : déploiement de production `READY`, puis capture du PC (4 onglets, bandeau « À valider » quand des propositions existent).

## 28/10/2026 : lia-ui v0.44.2, le menu de LIA reste dans l'élément cliqué (DriveAI#754, mission MoKarade/.github#575)

Épingle `@mokarade/lia-ui` v0.44.2 (sha pelé `8881751`), seul changement (`app/package.json`, lock). Quand le menu du clic droit s'ouvre sur un élément précis (carte, bloc), il se place maintenant dans la zone de cet élément au lieu de glisser hors de lui. Rien à brancher côté app. Preuve : déploiement de production `READY` sur le commit fusionné, puis relevé du PC (clic droit sur un élément de Documents).

## 28/10/2026 : lia-ui v0.43.0, le clic droit de LIA marche partout (DriveAI#743, mission MoKarade/.github#575)

Épingle `@mokarade/lia-ui` v0.43.0 (sha pelé `c0f1ff7`), seul changement (`app/package.json`, lock). Marc, 28/10/2026 : « faut qu'il marche partout ». Le clic droit (et l'appui long) de LIA s'ouvre maintenant sur le fond de page, dans une fenêtre modale `<dialog>.showModal()`, et même quand un gestionnaire de la page bloque le menu natif ; les champs de saisie gardent le menu du navigateur. Rien à brancher. Preuve : déploiement de production `READY` sur le commit fusionné, puis relevé du PC (lia-ui#147).


>
> **🟨 — 2026-10-19 : #468 (point 3), le dernier nom de fournisseur réel codé en dur devient fictif.** `Reset.gs` portait en dur le dossier et le jeton d'un fournisseur d'énergie resté à part ; ils sont lus maintenant dans `PARCOURS.fournisseurs.energieAnciens` (`Config.gs`, valeur fictive `Zephyr`), et tests et docs disent `Zephyr`. Le mot est verrouillé par une empreinte dans `test/pii-mots.json` (mutation vérifiée : un mot réintroduit fait tomber `pii-guard`). **`PROFIL_VERSION_ATTENDUE` passe à 5** : le profil privé doit porter `energieAnciens` (vrai dossier, vrais jetons) et `"PROFIL_VERSION": 5` AVANT la fusion, sinon le moteur saute les ticks (échec fermé, `etat_moteur` = `incomplet`). Voir `docs/PROFIL-PRIVE.md`.
>
> **🟨 — 2026-10-19 : #468 points 2 et 4, les orphelins de `_Doublons` retournent à leur place et les récits personnels sont neutralisés.** `src/RetourOrphelins.gs` (one-shot, 5 par tick,
> sous le frein budget) repasse au pipeline les orphelins du rapport `RapportDoublons`, déplacement seul, après un balayage complet de re-vérification (ADR-0047 §8 bis). Aucune suppression
> (verrouillé par `test/retour-orphelins.test.js`). Fin : Property `DriveAI_RETOUR_ORPHELINS` ; à vérifier après déploiement : l'onglet `Index` (clés `retour-orphelin|…`) et `_Doublons`.
> Point 4 (décision du propriétaire : « tout fictif ») : six passages qui racontaient un fait de la vie de Marc deviennent neutres (BACKLOG, HANDOVER, ADR-0030, deux commentaires de test).
>
> **🟩 — 2026-10-17 : #592, restes du balayage avant publication.** Une ville d'exemple réelle dans `test/qualite-entites.test.js` devient « Ville Exemple », et `HANDOVER.md` ne cite plus une clé nommée d'après un employeur. Les jetons de `MISSIONS_BAILLEURS` (`src/Config.gs`) ont été comparés un à un au profil privé v4 : aucun n'est identique à une valeur réelle, le moteur n'a donc pas changé et le profil reste en version 4.
>
> **🟧 — 2026-10-16 : #587, les noms de fournisseurs d'énergie et de téléphone ont quitté le dépôt (profil v4 en place depuis le 2026-10-16 vers 19 h 55, heure du Québec : `etat_moteur` donne `profilPrive.etat = ok`, 83 réglages).** Ces noms
> sont des paramètres du profil privé (`PARCOURS.fournisseurs`, `MISSIONS_FOURNISSEURS_ENERGIE`, `MISSIONS_ANNEES02_DOMAINES` : fictifs par défaut,
> voir `docs/PROFIL-PRIVE.md`) ; `Reset.gs` les lit à l'appel (Hydro-Québec reste : seul fournisseur possible au Québec). `PROFIL_VERSION_ATTENDUE`
> passe à 4 : tant que le profil de Marc n'est pas en version 4, le tick est SAUTÉ (échec fermé), rien n'est mal rangé. Bascule faite après le déploiement
> (même méthode que #578 : fichier préparé sous un autre nom, puis échange). Preuve d'équivalence faite en local :
> les ANCIENS tests (noms réels) rejoués contre le nouveau moteur portant les valeurs réelles passent à 1732/1736 ; les 4 autres sont les tests de la
> version 3 attendue ; et le profil v4 appliqué au nouveau `CONFIG` rend exactement les valeurs de l'ancien (énergie, années 02). Verrou : `test/pii-mots.json` connaît ces noms.
>
> **🟧 — 2026-10-16 : #578, les noms de banques et d'assureurs ont quitté le dépôt (EN ATTENTE du profil v3 de Marc).** Banques, assureurs
> et leurs graphies sont des paramètres du profil privé (`PARCOURS.finance`, `MISSIONS_ASSUREURS` : fictifs par défaut, voir
> `docs/PROFIL-PRIVE.md`) ; `Reset.gs` les lit à l'appel. `PROFIL_VERSION_ATTENDUE` passe à 3 : tant que le profil de Marc n'est pas en
> version 3, le tick est SAUTÉ (échec fermé), rien n'est mal rangé. ⚠️ À FAIRE AVANT de fusionner : déposer le profil v3 dans le Drive.
> Preuve d'équivalence faite en local : les ANCIENS tests (noms réels) rejoués contre le nouveau moteur + un profil portant les anciens
> noms passent à 1730/1733 ; les 3 autres sont les tests de la version 2 attendue. Le titre de la question « Émetteur » du formulaire de
> corrections change (l'exemple est fictif) : le formulaire déjà créé garde l'ancien, donc `champEmetteur_` lit tout titre qui commence par
> « Émetteur ». Les captures de `docs/captures/` sont refaites sur la maquette sans nom réel. Verrou : `test/pii-mots.json` connaît ces noms.
>
> **✅ — 2026-10-16 : #495, les erreurs de production vont dans Sentry, sans donnée personnelle.** Envoi direct à Sentry sans SDK (`api/_sentry.ts` côté serveur, `app/src/sentry.ts` côté navigateur) parce que `api/` n'installe aucun paquet npm ; message réduit, aucun champ de requête ni d'utilisateur. Sans `SENTRY_DSN` rien ne part. Preuve : workflow manuel « Essai Sentry » (accusé HTTP 2xx de Sentry). Reste à Marc : poser `SENTRY_DSN` dans Vercel (.github#24). Détail : `docs/claude/06-deploiement.md`.
>
> **✅ — 2026-10-16 : #494, plus aucune préversion Vercel.** `vercel.json` ne déployait que hors `claude/*` ; `feature/*`, `dependabot/*` et les branches de Jules créaient encore une préversion, qui use le quota partagé. `git.deploymentEnabled` coupe maintenant tout (`**`, `*`) sauf `main`, comme Hubperso et MemoryAI ; la production se déploie toujours au merge. Conséquence : une PR ne se vérifie plus sur une URL de préversion, seulement par la CI. Verrou : `test/structure-doc.test.js`. Détail : `docs/claude/06-deploiement.md`.
>
> **✅ — 2026-10-16 : #493, la couverture du moteur entre au cliquet.** L'app avait déjà son cliquet (`app/qualite/seuils.json`,
> job « Qualité ») mais le moteur `src/*.gs`, le gros du code, n'avait aucun chiffre. `.github/ci/couverture-moteur.mjs` relance
> `node --test` avec la couverture intégrée de Node (zéro dépendance), ne compte que les lignes de `src/*.gs` et compare à
> `.github/ci/couverture-moteur.json` (mesure du jour : 86,7 % ; seuil posé à 86,0 pour absorber la dérive entre versions de Node,
> à resserrer avec `--maj` après le premier chiffre de la CI). Appelé dans le job « Tests unitaires ». `test/harness.js` passe
> désormais le chemin complet comme `filename` du `vm` : sans cela V8 ne rattache pas la couverture aux fichiers.
>
> **✅ — 2026-10-16 : #562, `app/` passe au contrat hub v1.5.0 (zod 4).** `app/package.json` et le lockfile pointent sur
> `hub-contract#v1.5.0` (commit `440a301`) ; l'arbre n'a plus qu'un seul zod (4.6.7, celui de knip est dédupliqué). `api/` reste
> sans dépendance (le schéma y est inliné, verrouillé par `app/test/hub-summary.test.ts`, 477 tests verts sous zod 4).
>
> **✅ — 2026-10-16 : #466, l'heure des étapes de la Progression n'a plus un tick de retard (C28-60).** L'onglet est écrit par
> l'étape `progression`, au milieu du `finally` : `telemetrie`, `hub-resume`, `historique-vrac` et `journal-borne` montraient donc
> l'heure du tick précédent. `majProgressionsFinTick_` (Journal.gs, appelée dans Main.gs après `journal-borne`, avant le flush)
> ré-écrit ces seules lignes avec la même `lignesProgression_` ; les étapes visées sont DÉRIVÉES de l'ordre du registre
> (`registreApresProgression_`). Écarté : déplacer `progression` en fin de tick (le résumé hub relit l'onglet « fraîchement
> réécrit » et les index de la Property de suivi suivent l'ordre du registre). Pas d'`etapeSuivie_` (registre saturé).
>
> **✅ — 2026-10-16 : #482, quatre mentions périmées corrigées.** Commentaire de `deploy.yml` (fusion par Mergify, plus `auto-merge`),
> en-tête de `test/structure-doc.test.js` (dépôt privé), commande `/lesson` (écrit dans `docs/claude/lecons.md`), et l'ID C28-135 en
> double : la ligne « timeout des appels /exec » devient C28-140 (BACKLOG, `app/src/google.ts`, `app/test/webapp-rejeu.test.ts`).
> `dependabot.yml` était déjà à jour.
>
> **✅ — 2026-10-16 : #475, la Réorg « créer » ignore les homonymes à la corbeille.** `appliquerUneAction_` (type `creer`) ne
> compte plus qu'un homonyme VIVANT (`getFoldersByName` rend aussi les corbeillés) : avec un seul homonyme corbeillé, le dossier
> est créé au lieu de répondre « appliqué » sans rien faire ; si `isTrashed()` lève, l'exception sort (l'appelant dit « échec »).
> Verrou : test dans `test/chat-reorg.test.js` (rouge si le filtre saute). Moteur : déploiement par `deploy.yml`.
>
> **✅ — 2026-10-16 : #474, les caches Entités et Index ne sont plus visibles à moitié remplis.** `chargerEntitesCache_` et
> `chargerIndexCache_` remplissent des variables locales et ne publient (`_entitesCache`, `_indexCache`, `_empreintesCache`,
> `_empreintesParIdCache`) qu'une fois la lecture finie : une Sheet qui lève à mi-parcours laisse le cache à `null` (« je ne sais
> pas ») et l'appel suivant relit ou lève, au lieu de croire qu'une entité n'existe pas ou qu'un fichier n'a jamais été traité.
> Verrou : `test/caches-pas-a-moitie.test.js` (rouge si l'affectation revient en tête). Moteur : déploiement par `deploy.yml`.
>
> **✅ — 2026-10-16 : #484, le test « étape rouge, sortie plafonnée » du commit-gate est stable.** La cause n'était pas le hook :
> le script d'échec du test écrivait 500 lignes sur stderr puis appelait `process.exit(1)`, et sur un tube stderr est asynchrone,
> donc `process.exit()` jetait la fin (sortie coupée vers l100-l400). Il pose maintenant `process.exitCode = 1`. Mesuré avant :
> 21 échecs sur 40 passages sous charge ; après : 0 sur 40 et 20 passages consécutifs verts.
>
> **✅ — 2026-10-16 : #472, chaque papier du rattrapage est noté tout de suite.** `etapeRattrapagePiece_`
> écrit dans `PiecesFaites` après chaque papier (sauf les marques que le coupe-circuit peut encore retirer :
> lectures Drive impossibles et série de refus vision, `separerFaitsAEcrire_`), au lieu de tout écrire en fin de run :
> un run tué au mur des 6 min ne fait plus relire ni repayer jusqu'à cinq papiers. Le chrono part aussi AVANT la
> lecture de l'Index, qui compte donc dans le budget du jour et dans le plafond du run. Moteur : déploiement par `deploy.yml`.
>
> **🟦 EN COURS — 2026-10-15 : retirer les données personnelles du dépôt (tâche #497, prio 1).**
> Décision du propriétaire du 15/10 : rien de personnel en ligne, tout dans son Drive ; les tests et
> fixtures passent aux données fictives. L'état de départ n'est pas à zéro (adresses, noms
> d'employeurs et d'écoles, identifiants de dossiers Drive, vrais noms de fichiers, dans le moteur,
> les tests et les docs). **Tranche 1 livrée : le verrou** `test/pii-guard.test.js`, un CLIQUET :
> `test/pii-baseline.json` dit, fichier par fichier, ce qui reste à retirer ; une trouvaille de plus
> fait échouer la CI, et il faut abaisser la base à chaque nettoyage (`PII_ECRIRE_BASE=1 npm test`).
> Il ne dit jamais le texte trouvé (journal de CI public). Les mots connus sont HACHÉS dans
> `test/pii-mots.json` (ajout : `node test/pii-guard.test.js --hacher "mot"`). Fini quand la base vaut `{}`.
> ⚠️ Le moteur (`src/Config.gs`, `Missions.gs`, `Reset.gs`, `Entites.gs`) se sert de ces valeurs pour
> ranger le vrai Drive : les remplacer par du fictif SANS un profil privé le casserait. La suite est
> découpée en tâches (fixtures, tests, docs, moteur) ; le moteur est un chemin protégé, Marc le fusionne.
> **Tranche 2 livrée (#513) : les deux fixtures de `test/fixtures/` sont fictives** (mêmes dates et
> mêmes types qu'au relevé du 13/09, émetteurs et dossiers inventés). Conséquence mesurée : les
> règles par ENTITÉ (bailleurs, écoles) ne reconnaissent plus rien dans le corpus, donc les nombres
> de `test/racine-domaine.test.js` (06 : 327 → 347, table : 174 → 153) ne mesurent que les règles par
> TYPE et par DATE, et la borne « au moins 5 déménagements » du test D8 est retirée. Elles reviennent
> avec le profil privé du moteur (#515).
>
> **Tranche 1 de #515 : les identifiants Drive ont quitté le moteur.** `CONFIG` ne porte que des
> `FICTIF_…` ; les vrais sont dans un fichier du Drive de Marc (`driveai-profil-prive.json`, trouvé par son nom;
> Script Property `DriveAI_PROFIL_ID` en option) (mode d'emploi : `docs/PROFIL-PRIVE.md`). Sans profil lisible le tick est sauté
> (échec fermé) et `etat_moteur` le dit. Restent : noms propres et logique par entité (tranche 2).
>
> **Tâche #514 livrée : les docs (`docs/`, `HANDOVER.md`, `BACKLOG.md`) n'ont plus de ligne dans la base du verrou.**
> Les vrais noms (employeurs, écoles, bailleurs, véhicules, adresses, personnes, courriels, identifiants
> de dossiers Drive) y sont remplacés par des valeurs génériques (`Employeur A`, `Cégep A`, `Logement B`,
> `Véhicule A`, `Personne A`, `<id Drive>`), sans toucher aux raisons des décisions. Vocabulaire à réutiliser
> tel quel dans le moteur (tranche 2 de #515). ⚠️ Le verrou ne connaît que des mots HACHÉS : un nom qu'il ne
> connaît pas peut subsister dans un doc ; les noms trouvés pendant ce nettoyage, qui figurent encore dans
> `src/` et `test/`, seront ajoutés à `test/pii-mots.json` avec les tâches qui les retirent.
>
> **Tranche 2 de #515 et tâche #516 livrées : le dépôt ne porte plus aucun nom réel, `test/pii-baseline.json` vaut `{}`.**
> Employeurs, bailleurs, véhicules, écoles, personnes et adresses sont des paramètres du profil privé
> (`CONFIG.PARCOURS` et `MISSIONS_*`, valeurs fictives par défaut : Alphatek, Betatek, 1201 rue Exemple Alpha…).
> Le profil porte `"PROFIL_VERSION": 2` : sans elle l'état est `incomplet` et le tick est sauté (un profil de
> tranche 1 ne suffit plus). L'app web lit ses repères de zone protégée auprès du moteur (action `gardes-app`)
> et refuse toute modification de Drive sans eux. ⚠️ À FAIRE AVANT de fusionner : déposer le profil v2 dans le
> Drive de Marc (`docs/PROFIL-PRIVE.md`). Preuve d'équivalence faite en local : les anciens tests (noms réels)
> rejoués contre le nouveau moteur + le vrai profil passent à 1650/1690 ; les 40 autres sont des tests de
> contenu de dépôt (hooks, workflows, docs) ou qui nomment d'anciennes clés (nommées d'après des employeurs), aucun écart de routage.
> Piège trouvé par cette preuve : un objet du profil dont les clés sont des noms propres exige `"$remplace": true`,
> sinon ses clés sont ignorées en silence.
>
> **🟦 EN COURS — 2026-09-29 : hygiène de dépôt + 6 petits correctifs moteur (fil parallèle,
> demandé par gerant — ne remplace pas le repère C49-32 ci-dessous).** Aucune ligne de classement
> touchée. Deux branches PRÊTES, AUCUNE PR encore (minutes GitHub épuisées jusqu'au 01/10) :
> `agence/driveai-14/main-vert` (7/7 — `.gitattributes` + tripwire ADR-0014 relocalisé vers
> `docs/claude/01-principes.md`, cf. C28-138) et `agence/driveai-14/corrections-moteur`, qui
> fusionne EN PLUS `main-vert` (C28-104/132/134/135/136/108 + `.gitattributes`, détail dans
> BACKLOG.md) — **7/7 autonome, quel que soit l'ordre de fusion des deux PR le 01/10**.
> **Cause racine trouvée et probablement valable pour les 9 dépôts de l'atelier** : ce dépôt
> n'avait AUCUN `.gitattributes` — un checkout Windows (`core.autocrlf=true`) convertit alors des
> fichiers texte en CRLF, et une regex qui suppose `\n` littéral cesse de matcher EN SILENCE
> (5 tests touchés ici, la CI — runners Linux — restait verte). À faire au 01/10 : ouvrir les
> 2 PR (`--base main` explicite), dans n'importe quel ordre.
>
> **🟦 EN COURS — 2026-09-25 : C49-32, « lis tout tout tout ». REPRENDRE ICI.** La tranche de
> 200 est faite (4,09 $, ~2 ¢/papier : 173 lus, 17 illisibles, 3 sans texte, 7 en échec). Marc a
> levé la limite de nombre (`VISION_TRANCHE_MAX: 0`). Restent les deux bornes d'argent : arrêt dur
> à 100 $ (projection ~55 $ pour les ~2 500 restants) et frein mensuel à 40 $, qui étale la fin
> sur octobre. À lire après déploiement : la ligne « Rattrapage des pièces » ne dit plus
> « tranche atteinte » et le compteur de papiers repart.
>
> **✅ — 2026-09-24 : C49-30, la tranche relue en VISION. REPRENDRE ICI.** L'audit de
> C49-29 est fait (20/20, 0,57 $ pour 16 papiers, ADR-0063 §8). La tranche relit tout en Sonnet 5
> (tag `v3-a`), les PDF qui ont du texte partent en texte. Elle **s'arrête seule à 200 papiers**
> (`tranche-plafond`) et attend l'OK de Marc ; arrêt dur à 100 $ ; frein mensuel inchangé (40 $).
> À lire après déploiement : la ligne « Rattrapage des pièces » (dépense, coût moyen par papier).
>
> **✅ 2026-09-24 : C49-29 (L1), la lecture VISION — audit terminé.** Sonnet 5 lit
> l'IMAGE des papiers (ADR-0063). Un audit sur 20 papiers tourne seul après déploiement (onglet
> `AuditVision`, ligne de Santé « Audit vision (L1) ») ; le rattrapage Haiku est en PAUSE tant
> qu'il est armé. Ordre de déploiement : **MemoryAI #70 d'abord** (rang 3 de la lignée), puis
> celui-ci. Rien ne part en campagne avant le verdict de Marc sur l'audit.
>
> **🟦 EN COURS — 2026-09-23 : C49-26, la tranche « tout le reste » (PR #403). REPRENDRE ICI.**
> Lecture élargie à `05 → 03 → 08 → 06`, puis `07` et `09`, sans relire `04 + 01 + 02`. Envoi à la
> Mémoire **4 → 8 min/j**, pris aux pièces (**58 → 54**) ; l'enveloppe reste à 63. Le périmètre
> compte les documents DISTINCTS, et se recompte chaque jour. La revue a trouvé quatre défauts qui
> mordaient ce lot (double lecture payée, campagne bloquée par trois fichiers supprimés, envoi qui
> jetait ce qu'il avait lu, dossiers vides affichés « terminés ») : corrigés, détail dans BACKLOG.
> À mesurer après déploiement : « Lecture — file » annonce **EN COURS 05**, et le recompte publie
> les documents distincts. Ce qui suit (lot du 21/09) reste vrai, hors les nombres de budget.
>
> **🟦 2026-09-21 : la lecture des papiers se REGARDE.**
>
> **DERNIER LOT — C49-20 : sept campagnes arrêtées, 41 min/j rendues à la lecture des papiers.**
> Décision du propriétaire du 21/09, sur la mesure du jour. Consolidation (16 + 8), re-datation de 06 (8),
> historique du vrac (4), historique Gmail (2), doublons (1) et missions (2) sont ARRÊTÉES par
> leur interrupteur ; leurs minutes vont à `AUDIT_PIECE_BUDGET_JOUR_MS`, **17 → 58 min/j**.
> L'enveloppe reste à 63 : c'est une réallocation. Détail et alternative écartée dans l'ADR-0062.
>
> ⚠️ **La re-datation est arrêtée EN COURS** (108/466, fin estimée au 25/10) : ce n'est pas le
> ménage d'une campagne finie. Sa ligne de Santé garde son avancement à l'écran. Pour la
> reprendre : `REANALYSE_ACTIF: true` **et** lui rendre des minutes (le gate refuse l'un sans
> l'autre).
>
> ⚠️ **L'ARRÊT SE DIT MAINTENANT DANS TOUTES LES SURFACES** (correctif des revues de flotte,
> 21/09). Première rédaction : les sept interrupteurs étaient câblés dans le tick et la Santé, et
> la vérification des lignes de Progression était renvoyée au déploiement. Mesuré avant de
> déployer : **trois sur sept** ne disaient rien — la re-datation « en cours · vers le 01/10 », la
> consolidation « en pause · **reprise demain** » (son `budgetEpuise` vaut `0 >= 0`, donc vrai à
> jamais), l'historique du vrac « en cours ». Les trois partaient jusqu'au **widget hubperso**.
> C'est corrigé et tenu par des tests ; le mot est **`désactivée`**, la seule chaîne que
> `familleStatut` (`app/src/etat.ts`) apparie — par ÉGALITÉ.
>
> ✅ **MESURÉ le 21/09 sur le tick de 19:32 UTC** (le déploiement a fini ~19:30) : « Audit des
> pièces » annonce **18.3 des 58 min/j**, l'historique Gmail **« donneur À SEC : ses 20 min/j sont
> DÉJÀ prêtées »**, la re-datation **« arrêtée (CONFIG, C49-20) — 108 / 466 documents au moment de
> l'arrêt »**, et la Progression rend `désactivée` **sans** date de fin ni « reprise demain ».
> ⚠️ La mesure prise 9 minutes plus tôt décrivait l'ANCIEN code (tick de 19:23 UTC) et ne valait
> rien : c'est exactement le piège §9 « une mesure lancée juste après un déploiement peut mesurer
> l'ANCIEN ». Toujours lire « Dernier passage OK » AVANT de conclure quoi que ce soit.
>
> ⚠️ **Et cette mesure a trouvé une régression du lot, corrigée dans la foulée** : éteindre les
> doublons effaçait leur BILAN (1 076 écartés, dont **19 ORPHELINS** — les fichiers dont il
> n'existe qu'un exemplaire). Le prédicat `!DOUBLONS_ACTIF` vivait en TÊTE de
> `ligneSanteDoublons_` : C49-20 l'a rendu atteignable. Corrigé avec le même arbitrage que la
> re-datation — un arrêt délibéré garde son livrable à l'écran.
>
> **LOT PRÉCÉDENT — C49-18 : l'OCR rejoue ses appels IDEMPOTENTS, et seulement ceux-là.**
> `fetchDriveAvecRetry_` existe depuis la phase 2 ; `Ocr.gs` ne l'employait nulle part. Les deux
> exports et la suppression du temporaire le prennent désormais — un 503 passager ne fige plus un
> document sous `ocr-echec`, qui est une issue DÉFINITIVE. ⚠️ **L'upload multipart, lui, ne
> rejoue PAS, et c'est gardé** : il CRÉE un fichier, un 5xx peut arriver après la création, et un
> rejeu fabriquerait un `DriveAI_extract_temp` orphelin qu'on ne pourrait plus supprimer.
>
> ⚠️ **À DIRE EN CLAIR : ce lot ne corrige pas les erreurs OCR observées en production.** Le
> Journal du 21/09 ne porte aucun `Export natif HTTP` ; ses deux erreurs OCR (`Conversion HTTP
> 400` et `HTTP 500`) sont à l'upload, le seul appel qui ne peut pas rejouer. Le correctif est un
> filet, pas une récupération chiffrée. Ce qui répare vraiment la perte mesurée est `[C49-19]` —
> porter l'ORIGINE de l'échec pour qu'un 500 transitoire ne marque plus le document « fait » —
> et il n'est PAS fait : hors du périmètre donné.
>
> **C49-16 EST EN PRODUCTION ET TOURNE** (mesuré le 21/09 à 14:33 via `etat_moteur`) :
> « 14 retrouvés · 26 sans preuve · 695 à examiner ». La campagne de lecture avance aussi —
> `04` ✅ (23), `01` à 78/87, puis `02` (964).
>
> **LOT PRÉCÉDENT — C49-16 : 734 documents CLASSÉS que le canal ne savait pas DÉSIGNER.**
> C'est le **lot A** du plan « tout le Drive », fait avant de demander l'OK sur le reste.
> `fileIdDeCleIndex_` déduit l'identifiant Drive de la CLÉ d'Index et n'accepte que quatre
> préfixes ; la clé d'une pièce jointe Gmail — l'intake PRINCIPAL — n'en porte aucun. Ces
> lignes étaient donc invisibles au comptage du périmètre, au rattrapage et au canal Mémoire,
> alors que les documents sont rangés depuis des mois. ⚠️ **734 est un PLANCHER**, pas un total.
>
> Deux moitiés livrées ensemble, parce qu'une seule ne répare rien : le pipeline pose désormais
> le `fileId` en **9ᵉ colonne** de l'Index (ajoutée EN QUEUE — les plages de lecture de l'app
> ont été RECENSÉES, elles s'arrêtent à `H`), et `src/ResolutionFileId.gs` RETROUVE celui des
> lignes déjà écrites, par recherche Drive. Le prédicat **refuse dans le doute** : un mauvais
> identifiant enverrait un papier de Marc à la Mémoire sous l'identité d'un autre.
>
> **Ce qui se passera tout seul au prochain déploiement** : la passe tourne dans le tick, AVANT
> le rattrapage et le périmètre (elle leur fournit leurs entrées), 40 lignes par run, sans
> prélever une minute de budget quotidien à personne. La ligne de Santé « Résolution des
> identifiants (C49-16) » dit où elle en est et POURQUOI elle refuse — « introuvable »,
> « ambigu » et « empreinte-differente » appellent trois gestes différents.
>
> ⚠️ **La revue adversariale a trouvé TROIS bloquants que le gate ne pouvait pas voir** (1 526
> cas verts sur les trois). Tous corrigés dans la même PR, tous prouvés par mutation. Le plus
> grave : le `fileId` ne voyageait PAS jusqu'à la Mémoire depuis le rattrapage — le lot aurait
> donc été **inerte sur son seul consommateur vivant, en payant un appel Haiku par document et
> en les marquant « faits » définitivement**, `04` en premier. Les deux autres : un curseur qui
> sautait 40 lignes sur une coupure au premier item (« ✅ terminée » sur 60 documents lus sur
> 100), et un verdict irréversible pris sur un simple NOM de dossier (`2025` existe sous les
> neuf domaines). Détail complet dans `BACKLOG.md`.
>
> ⚠️ **À VÉRIFIER après le run `deploy.yml`** : que la ligne de Santé quitte « jamais passée »,
> et que le périmètre re-compté fasse tomber son PLANCHER. Tant que ce n'est pas mesuré, le
> correctif n'est pas fini (§9 : une réparation se mesure, elle ne se déduit pas d'un merge).
>
> **En une phrase** : la campagne tourne (le 500 de la Mémoire est réparé, mesuré — le canal a
> accepté 5 pièces à 14:47 UTC et la télémétrie `rattrapage-piece` est passée de 1 à 6 appels),
> et l'onglet **Lecture** de l'app répond désormais aux cinq questions que Marc a posées trois
> fois : ce qui est lu **à la seconde**, quel dossier, dans quel ordre, à quelle vitesse, et ce
> que le moteur n'a pas pu lire.
>
> ⚠️ **Quatre de ces cinq questions n'avaient AUCUNE réponse dans le moteur** — pas mal
> affichée : absente. Mesuré avant d'écrire une ligne : l'en-cours n'existait pas (l'état ne
> s'écrivait qu'APRÈS lecture), l'ordre `04 → 01 → 02` n'était publié nulle part, et
> `PiecesFaites` n'avait pas de colonne `Domaine`. C'est le lot C49-14 qui les pose.
>
> **Ce que le propriétaire a tranché le 21/09** (deux questions cliquées) :
> - **« On garde un point par jour »** — contre ma recommandation d'un point par heure pendant
>   une campagne active. Conséquence ASSUMÉE et DITE à l'écran : la courbe et l'estimé
>   n'apparaissent pas avant demain, et la phrase de l'app explique que c'est la cadence de la
>   mesure, pas une panne.
> - **« La tranche, puis tout le Drive en dessous »** — deux chiffres distincts, jamais fondus
>   en un pourcentage unique.
>
> **Ce qui reste à surveiller** : la courbe n'aura son deuxième point qu'au prochain jour où la
> campagne tourne (`HistoriqueImport` écrit un point par JOUR, et le tag a été bumpé
> aujourd'hui). Un écran qui reste sans courbe demain soir est un signal, pas une patience.
>
> **Puis, le même jour, deux bugs PRÉEXISTANTS signés et corrigés sur feu vert (« fais les 3
> points ») :**
> - **C49-11 — l'OCR était mangé par le CSS.** Sur un export HTML, les 12 000 caractères du
>   budget partaient en feuille de style AVANT d'atteindre la moindre donnée : le modèle
>   répondait quand même, en devinant. Mesuré sur le vrai fichier du Drive (18 685 octets) par
>   l'outil du moteur DÉPLOYÉ — l'extrait servi était du `<style>` de bout en bout, coupé en
>   plein milieu d'une règle CSS. Périmètre : **151 papiers Facebook** au moins, plus tout autre
>   HTML. Le balisage se retire désormais AVANT la troncature (`src/Ocr.gs`, trois fonctions
>   PURES). ⚠️ **Le correctif n'est pas de relever la borne** : 12 000 caractères de CSS coûtent
>   exactement le même argent que 12 000 caractères de texte.
>   ⚠️ **Mesuré APRÈS le redéploiement** (run `deploy.yml` 377), même `fileId` : titre, auteur,
>   date de génération et le contenu, **zéro caractère de CSS**. Et la mesure a RÉFUTÉ deux
>   phrases que j'avais écrites dans le ticket — le nom du fichier (un `fileId` fait foi, pas un
>   nom recopié) et « il porte probablement la date de naissance », qui n'était que l'hallucination
>   du modèle recitée comme un indice. Les deux sont corrigées dans `BACKLOG.md`.
> - **C49-15 — la Santé nommait TROIS compteurs pour QUATRE chiffres** (« 3/0/1/1
>   (faits/échecs/sans texte) »). Le quatrième — les documents dont la PHOTO est à refaire —
>   n'avait pas de nom, donc il se lisait comme un chiffre de trop.
>
> ⚠️ **Le troisième point ne peut PAS être fait à la place de Marc** : `C49-3`, l'audit sur 100
> documents stratifiés, est un VERDICT HUMAIN — la porte de l'ADR-0061 §7. L'extraction est
> automatique et terminée ; le jugement se fait dans l'app (engrenage → « Vérifier », un
> document à la fois). Un pré-juge automatique a été proposé et ÉCARTÉ : il partagerait l'OCR
> de l'extracteur, donc il ne verrait aucune erreur de LECTURE.

> **🟦 HISTORIQUE — 2026-09-18 : C49-5, le rattrapage des pièces `04` + `01`.**
>
> **En une phrase** : la tranche est **TERMINÉE** — le tick a fini les 55 restants dans la nuit
> (Santé du 18/09 15:57 UTC : « 0 restants · tranche terminée »), et **78 pièces** sont arrivées
> dans la Mémoire. Il ne reste aucun geste automatique : **c'est à Marc de juger** avant
> d'élargir la campagne au reste du Drive.
>
> ⚠️ **Un écart de 32 n'est expliqué par aucun chiffre lisible** : 110 documents traités,
> 78 pièces produites (`04` = 23, `01` = 55 dont une en niveau 2). Les 32 autres sont
> normalement des « sans texte » et des échecs — quatre lectures Drive impossibles sont tracées
> au Journal du 17/09 — mais **le signal ne porte que la DERNIÈRE passe**, jamais le cumul, donc
> personne ne peut le confirmer d'ici. C'est la même lacune que le point 2 ci-dessous, vue de
> plus loin : la campagne dit « terminée » sans dire ce qu'elle a produit. [À vérifier]
>
> **Le geste manuel, gardé pour mémoire** (il n'y a plus rien à rattraper sur cette tranche,
> mais il resservira si Marc élargit — et la session ne peut pas exécuter Apps Script) :
> `script.google.com` → projet DriveAI → fichier **`RattrapagePiece.gs`** → fonction
> **`rattraperPiecesMaintenant`** → Exécuter. ~25 documents par passe (garde-temps 4,5 min), donc
> **~2 passes** pour finir. La fonction annonce le reste à chaque fois. Lecture seule avant de
> dépenser : `diagnosticRattrapagePiece`.
> ⚠️ **Fermer TOUS les onglets de l'éditeur Apps Script avant d'ouvrir une page neuve** — un
> onglet ouvert avant un `clasp push` ré-enregistre sa copie périmée et annule le déploiement
> (§9, vécu le 16/09).
> ⚠️ Le TICK, lui, ne reprendra **que demain** : le budget quotidien des pièces (11 min, partagé
> avec l'audit) était déjà épuisé le 17/09 à 17,2/17 min. À 11 min/j il fait ~66 documents/jour.
>
> **Ce qui a été livré le 17/09** (trois PR, toutes fusionnées et déployées) :
> - **#375** — `src/RattrapagePiece.gs` : la campagne. Le canal des pièces n'avait qu'un appelant
>   (`Pipeline.gs`, après classement) donc ne voyait que le FLUX VIVANT ; allumer `PIECE_PUSH`
>   n'aurait rien envoyé du stock déjà classé.
> - **#376** — le tag `RATTRAPAGE_PIECE_TAG: 'c49-5-a'` (Marc a jugé l'audit : « ok jugé, pose le
>   tag »), et les DEUX plafonds « 5 par run » levés sur le chemin manuel (C28-33).
> - **#377** — correctif d'un bug que #375 avait introduit, attrapé par son propre signal : voir
>   ci-dessous.
>
> ⚠️⚠️ **LE BUG DU 17/09 18:35, À CONNAÎTRE AVANT DE TOUCHER À CE MODULE.** La Santé a annoncé
> « 0 restants · ✅ tranche terminée » avec 85 papiers restants. Les sorties précoces écrivaient
> `restantsRattrapage_(props) || 0` : `null` (« je ne sais pas ») devenait zéro, la gate du tick
> relisait ce zéro et **éteignait la campagne à vie**. Corrigé (#377) : le motif de fin s'écrit
> toujours, le compteur **seulement quand il a été mesuré**, et un reste inconnu se sérialise
> VIDE (jamais `'0'` ni `'null'` — `Number('')` vaut zéro). Leçon en §9 du `CLAUDE.md` et récit
> complet dans `docs/LESSONS.md`.
>
> **Ce qui est arrivé dans la Mémoire, vérifié le 17/09** : `04 · Immigration` **COMPLET, 23/23**
> (c'est ce que Marc voulait voir en premier), `01` en cours. Les papiers de `04`/`01` sont en
> **niveau 3** : seuls domaine, dates et pointeur sont servis, le contenu ne l'est pas — la
> frontière de l'ADR-0061 tient. Marc juge et retire sur `memoryai.exemple.com/pieces`.
>
> **⬜ OUVERT, à vérifier par la prochaine session** :
> 1. ~~**Le coût LLM n'a pas bougé**~~ — **FAUX, re-mesuré le 18/09 16:00 UTC** : le compteur
>    est passé de 476 à **539 appels** et de 2,52 à **2,85 $**. Ce n'était pas un compteur mort,
>    c'était de la télémétrie en retard. Ce qui RESTE ouvert est une question plus étroite :
>    l'extraction des pièces ne porte **aucune étiquette d'étape** et tombe donc dans le poste
>    « (hors étape) » (113 appels, 0,49 $ ce mois) — le coût est compté, il n'est pas
>    ATTRIBUÉ. Tant qu'il y est, on ne peut pas chiffrer ce que cette campagne coûte avant
>    d'élargir. [Probable]
> 2. **La ligne manuelle n'affiche pas les ACCEPTÉES** — `rattraperPiecesMaintenant` rend
>    « N faits » sans dire combien la Mémoire a acceptés. Un refus de contrat passerait pour un
>    succès (la panne du 16/09 en plus discret). Vérifié À LA MAIN le 17/09 : 24 envoyés,
>    24 arrivés. À corriger dans un petit lot.
> 3. ~~**243 papiers « sans domaine »**, origine inconnue~~ — **ÉLUCIDÉ le 18/09** : ils sont
>    2 645 maintenant, et c'est l'INVENTAIRE (`document.existe`, 2 730 faits acceptés), pas le
>    canal des pièces. `memoryai_papiers_facettes` compte les deux ensemble, d'où la confusion.
>    Rien à corriger : le compte des pièces se lit par DOMAINE, jamais sur le total.
> 4. **4 lectures Drive impossibles** pendant les passes (18:38, 18:40, 18:45, 18:47) : fichiers
>    dont l'identifiant ne répond plus. Isolées (le coupe-circuit exige 3 d'affilée), comptées en
>    échecs et marquées — elles ne reviendront pas. Rien à faire, mais c'est dit.
> 5. **Le trou des PJ Gmail** (C49-4) : 734 lignes classées dont la clé ne porte pas de `fileId`
>    sont invisibles au comptage ET au canal Mémoire. Décision à prendre par Marc — ça touche
>    `fileIdDeCleIndex_`, donc l'inventaire déjà en production. **Rien n'a été fait dessus.**
> 6. **La suite de la campagne** : les 3 862 autres papiers retombent sous la Q1 de l'ADR-0061
>    (le runner GitHub). ⚠️ L'idempotence de C49-5 (200 `fileId` dans une Script Property)
>    **ne passera JAMAIS à cette échelle** — l'étape refuse une tranche plus grande. Voir
>    l'amendement du 17/09 en §9 de l'ADR-0061.
>
> **L'audit C49-3 est TERMINÉ lui aussi** (Santé : « 0 restants · les 100 documents sont
> extraits — à toi de juger »). Les cartes se jugent dans l'app : `drive.exemple.com` →
> engrenage → « Vérifier ». C'était la porte de l'ADR-0061 §7, et elle est franchie.
>
> ⚠️ **Les check-ins programmés meurent avec la session qui les a créés.** Celui du 18/09
> 16:00 UTC a bien tiré et son verdict est écrit ci-dessus ; aucun autre n'est armé, et une
> nouvelle session n'en hériterait pas. Les deux campagnes étant à zéro, il n'y a plus rien à
> surveiller automatiquement — ce qui reste sont des DÉCISIONS de Marc.
>
> **🟦 EN COURS — 2026-09-15 : le « gros chantier » de Marc — l'assistant qui me connaît (C28-128, ADR-0059 ACCEPTÉ).**
> Marc l'a décrit le 15/09 : un assistant « 1000× plus intelligent » qui lit ses documents et ses mails
> au fil de l'eau, se constitue une base de connaissances, est connecté à toutes ses apps (et aux
> futures), visuel, le même dans chaque app, « secure au max ». Fait ce jour : lecture parallèle des
> **9 dépôts** (clonés sous `/home/user/…`), critique de complétude, panel de **5 architectures**
> (MCP-first, nouvelle app, hub-cerveau, fédéré sans stock, local RTX), **3 juges** (sécurité 7/8/4,5,
> coût 8/7,5/7, fidélité 8 pour la nouvelle app), synthèse ⇒ **`docs/adr/0059-assistant-transversal-cadrage.md`**
> + deux annexes (les 13 invariants en conflit ; le mur Gmail et le chiffrage). Retenu : une app neuve
> `memoire.exemple.com`, base de faits chiffrée à 4 niveaux, zéro jeton détenu, MCP + widget iframe,
> alimentée par le moteur à coût marginal. **Rien n'est codé** : 10 questions posées à Marc (§8 de
> l'ADR), 14 invariants à lever un par un (§4). **Le propriétaire a tranché** (15/09, choix cliquables) : nouvelle
> app ✔ ; **tout le stock** lu sur le PC (95-195 $ Haiku ou 0 $ Ollama — écart avec la reco) ; **tous les
> mails** (écart : mécanisme révisé = Takeout MBOX sur le PC pour le stock + moteur pour le flux, jamais
> de corps dans Drive) ; **adresse servie aux apps à périmètre** (écart : défaut OFF, `domicile` +
> `niveau_max ≥ 2` explicites par app). Mails : « Takeout pour l'historique, moteur pour le flux » (confirmé).
> Les 6 autres questions = recommandations. Phase 0 retenue :
> « claude.ai a une mémoire et sait où sont mes 19 427 documents ». ✅ **Le dépôt existe depuis le 15/09 18:07, et il s'appelle `<identifiant>/MemoryAI`** (privé), pas
> `memoire` comme l'ADR l'anticipait ; son projet Vercel `memory-ai` est déjà lié. Le brief de
> démarrage a été remis à Marc (`BRIEF-MEMOIRE-PHASE-0.md`). Le sous-domaine servi reste à trancher.
> ⚠️ Deux faits d'infra tranchés en chemin : Vercel = **Hobby** [Certain, `list_teams` 15/09] (les
> docs CarAI/FinanceAI disant « Pro » sont périmées) ; le moteur tique à **~30 min** et non 5 (cadence
> = `Réglages!B2`, `Main.gs:240`) — **c'est un CHOIX de Marc (« oui, c'est moi, laisse 30 »)** : ne pas le
> « corriger ». C28-99 clos (gain réel : génération 1/9 → 4/9).
>
> **✅ RÉGLÉ — 2026-09-15 soir : « Web app 404 » sur l'assistant (C28-133).** Marc : « erreur 404 quand
> je fais une demande à l'assistant ». Texte exact demandé avant toute hypothèse : **« Web app 404 »**.
> ⚠️ **Ma première lecture de la preuve était FAUSSE et la revue l'a réfutée** — j'avais conclu
> « transitoire » parce que le compteur `app:chat-assistant` passait de 4 à 8 « appels réussis » ; ce
> compteur compte des appels ANTHROPIC, et un tour de chat en vaut 1 à 7. « +4 » colle tout autant à
> « UN tour a tourné en entier, a été payé, et Marc n'a reçu qu'un 404 ».
> **Cause** : un POST `/exec` a deux segments (exécution, puis 302 vers l'écho qui sert la sortie) ;
> `fetch` suit la redirection, donc un 404 ne dit PAS si le script a tourné. Le client ne peut pas
> trancher — la garantie devait venir du moteur.
> **Livré en deux parties indissociables** : le moteur mémorise la réponse d'une requête réussie sous
> son `requestId` (10 min) et la re-sert à un rejeu ; l'app rejoue 3 fois avec le MÊME identifiant, et
> chaque appelant déclare sa rejouabilité obligatoirement.
> ⚠️ **Fenêtre de déploiement** : le mémo vit dans le moteur. Entre le déploiement Vercel et celui
> d'Apps Script (quelques dizaines de secondes, même commit), un rejeu ré-exécuterait. C'est pourquoi
> les deux parties sont dans le MÊME merge, et jamais l'une sans l'autre.
>
> **✅ RÉGLÉ — 2026-09-15 : « Tout corbeiller » ne se gèle plus sur un refus de droits (C28-129).**
> Marc a collé la cause exacte, et elle clôt trois jours de diagnostic : `403 : The user does not have
> sufficient permissions for this file.` Les dossiers vides restants **ne lui appartiennent pas** (autre
> compte) — aucun réessai ne peut aboutir. Le code les traitait en panne transitoire : 5 d'affilée, le
> coupe-circuit tombait, « 53 non tentés — réessaie dans quelques minutes ». Désormais c'est un
> **verdict par ligne** (`vide-droits-refusés`), la ligne quitte la liste avec sa raison et le lot va au
> bout ; le bilan dit combien et ce qu'il faut faire. La désambiguïsation des trois sens du `403`
> (throttle / scope perdu / droits sur l'élément) se fait dans `api()` sur le corps ENTIER — le champ
> `errors[].reason` tombe après la troncature d'affichage — et l'aval ne lit qu'un marqueur canonique.
> **Revue flotte (code + sécurité) intégrée.** Le verdict se prend désormais sur une LECTURE : l'app
> demande `capabilities(canTrash)` et `ownedByMe` à Drive et refuse le dossier AVANT toute mutation —
> l'ordre qu'ADR-0014 exige, au lieu d'apprendre le refus par l'échec du PATCH. Trois états, échec fermé :
> oui / non (verdict) / Drive n'a rien dit (panne, la ligne reste). Un marqueur de droits rencontré pendant
> la LECTURE est neutralisé — « je n'ai pas pu lire » n'est jamais un verdict (le 🔴 de C28-93). Garde-fou
> ADR-0014 déclaré INTACT par l'audit : `verdictCorbeille` inchangé, `trashed: true` toujours confiné.
> ⚠️ **Ce que Marc verra au prochain clic** : les dossiers d'un autre compte seront retirés de la liste,
> PAS supprimés. Pour les faire disparaître de son Drive, il faut le compte qui les possède.
>
> **🟦 EN COURS — 2026-09-15 : ADR-0060, le code suit le Drive de Marc en `06` (C28-126/127).** Marc :
> « `Cégep A (année G2)` fait foi », « crée `Online course` », « vas-y ». Livré en revue flotte :
> libellé + ID réel dans `ecoles06`, garde de création remplacée par un find-only structurel (la cause
> du dossier créé à vide : `SEED_ENTITES` rend « une entité vise la source » vrai à vie), règle
> `formation en ligne` (5 natifs à plat), mission `ecoles-archives06c` (re-pointe l'entité — qui vise déjà
> le dossier vide `(2019)`, pas la coquille : `anciensNoms` la ramène), `RESET_TABLE_VERSION` t7.
> Revue flotte intégrée (2 🔴 : les 4 sites d'appel du tag oubliés + l'entité orpheline). ⚠️ `conso-4`
> (4/9, ordre 01→04→05→06) NON bumpée : les 5 « formation en ligne » partent sous `conso-4` si le moteur
> est déployé avant qu'elle atteigne `06`, sinon à un bump — ou tout de suite si Marc les glisse.
> **Consigne à Marc après merge** : laisser `c` converger, vérifier dans `Entités` que `Cégep De
> Cégep A` porte `…`, PUIS corbeiller à la main `(année G1)`, `Lycée A Lycée A` et la coquille
> (rien ne les proposera : ils n'ont jamais été vidés par le classement).
>
> **🟥 OUVERT — 2026-09-15 : la mission écoles dit « terminé », et sa cible déclarée est VIDE.**
>
> Relevé Drive du 15/09 (listing par `parentId` — `search_files` retarde). Mission `ecoles-archives06`
> à **`traites: 5 / base: 5`, statut `terminé`**. Ce qui MARCHE : la racine de `06` ne porte plus
> aucun dossier d'école, et l'ancienne source `Cégep A` est une coquille **entièrement
> vide** (ses 5 sous-dossiers vérifiés un par un). Ce qui ne va PAS — `Archives scolaires` diverge de
> `STRUCTURE_CIBLE_RESET` en **trois** points (C28-126) : `Cégep A (année G1)` a été créé
> **À VIDE** le 15/09 à 04:38 UTC alors que deux commentaires du code promettent « jamais à vide » ;
> les **9 documents Cégep A réels** sont dans `Cégep A (année G2)`, graphie qui n'existe
> **nulle part** dans `src/` ; et `Online course — formation en ligne` est déclaré mais absent,
> ses 5 documents Google natifs à plat à la racine de `06`.
> ⚠️ Le test censé verrouiller « les noms == le relevé Drive » compare la table à un corpus **figé** :
> il ne voit pas cette dérive et il est resté vert. Une mission « terminée » sur un compteur ne prouve
> rien — c'est le CONTENU qui l'a dit.
> Le suivi quotidien (routine) est **supprimé** : la mission a convergé, la suite est du backlog.
>
> **⏸️ EN ATTENTE DE MARC — « Tout corbeiller » : le 403.** Marc, 14/09 au soir : « j'ai toujours
> l'erreur 403 ». Vérifié de mon côté : l'app en ligne EST le code C28-121 (mon build local du SHA
> déployé produit `index-D7t6Aai6.js`, le fichier exact que sert le site ; le service worker est un
> passe-plat SANS cache). Un 403 qui n'est pas un throttle ressort en clair (`Google API 403 : <200
> car. du corps>`), et `statutRefusCorbeille` le classe `null` ⇒ ligne re-tentée, compteur de pannes
> +1, **coupure à 5 d'affilée** — mot pour mot « il s'arrête seul sans rien supprimer ».
> **Piste TROUVÉE, non prouvée** : 5 dossiers d'école **vides** que Marc **ne possède pas**
> (`prenom.nom@exemple.com`) — « Dossier A », « Dossier B », « Dossier C », « Notes année L1 », « Notes
> année L2 ». Un dossier non possédé ne peut pas être corbeillé : 403 `insufficientFilePermissions`,
> définitif. Cinq dossiers, coupe-circuit à cinq. ⚠️ **Je ne peux pas confirmer que ce sont ceux-là**
> que la liste propose — la ligne « Cause exacte : … » de Marc tranche en un coup d'œil.
> **Défaut RÉEL indépendant de la cause** : un 403 PERMANENT est traité comme une panne passagère
> (aucune branche ne le reconnaît) ⇒ la ligne ne quitte jamais la liste et le lot meurt au 5ᵉ.
> Correctif = patron C28-93 (un refus n'est pas une panne). **Pas codé : j'attends la ligne d'erreur**,
> pour ne pas diagnostiquer une troisième fois à l'aveugle.
>
> **🟦 EN COURS — 2026-09-14 (soir) : deux demandes de Marc, dont un diagnostic que j'ai eu FAUX.**
>
> **1 · « mes paies ne devraient pas arriver dans employeur mais seulement dans finances »**
> (ADR-0058, C28-122 — **livré et EN LIGNE**). Puis, sur mes deux questions :
> « **rl-1 aussi dans finances, attestation d'emploi reste dans 05** ». AUDIT du Drive réel avant
> d'écrire : **UNE seule paie mal classée** (`2026-09_Paie_Employeur A Inc..pdf`, `05/Employeurs/Employeur A`,
> déposée le 14/09 à 18:00 par le FLUX) — Employeur B n'en a aucune, Organisme d’emploi A est bien en 02.
> C'est une FUITE, pas une migration. Cause : les MISSIONS connaissent la règle (« le domicile UNIQUE
> des paies est 02 »), le FLUX prend le domaine du LLM — et une paie NOMME un employeur, donc le LLM
> répond « 05 ». Les missions rangeaient, le flux dé-rangeait, et comme les missions convergent puis
> s'arrêtent, c'est le flux qui avait le dernier mot. Correctif : domaine dérivé du TYPE, même patron
> que les pièces d'identité. ⚠️ **Deux faits MESURÉS** : le numéro du feuillet ne survit pas au
> renommage (« Relevé 1 » → « Relevé »), donc (a) le prédicat lit AUSSI le `type_doc` brut, (b) un
> RL-1 atterrissait dans `Revenus & paie/<employeur>` et **pas** dans `Impôts & déclarations` — bien
> « dans finances », pas le bon sous-dossier. ⚠️ **Corrigé dans le même lot (C28-123)**, et non renvoyé
> au backlog comme cette ligne l'annonçait d'abord : la revue a montré pire (employeur HORS table ⇒
> `02 · Finances/Relevés/AAAA`, parmi les relevés BANCAIRES ; employeur connu ⇒ pollution de
> `RapportPaies`, un RL-1 MASQUANT une paie réellement manquante). Deux règles de nommage ont suffi.
> Marc a ensuite tranché « **oui le t4 aussi dans finances** » : le T4 (fédéral) suit le RL-1
> (provincial) — même employeur, même mode de panne —, granularité ANNUELLE, prédicat DÉDIÉ (pas
> `estTypeFiscalReset_`, qui matche `taxe` et attraperait un compte de taxes municipales de `03`).
> **`T4A` reste NON couvert** : autre feuillet, revenus hors emploi salarié, Marc a nommé le T4.
>
> **2 · « Tout corbeiller » : mon diagnostic était FAUX, et Marc l'a réfuté.** Premier rapport :
> « 56 dossiers n'ont pas été tentés » ⇒ j'ai conclu au quota Sheets, chiffres à l'appui (C28-119,
> régulateur de cadence — qui reste utile, le plafond est réel). Second rapport : « **après 4 dossiers
> il s'arrête seul sans rien supprimer** » ⇒ **ça exclut Sheets** : sous cette hypothèse les dossiers
> PARTENT à la corbeille et seuls les statuts échouent (`corbeilles: 56, sheetKo: 5`). « Rien de
> supprimé » est la signature du canal **DRIVE** (`corbeilles: 0, aReessayer: 5`).
> ⚠️ **LA CAUSE RACINE EST INCONNUE.** Ne rien conclure avant de l'avoir LUE. Ce qui a permis deux
> diagnostics à l'aveugle : le message de l'exception était JETÉ — `statutRefusCorbeille` rend `null`
> pour un quota, un 403 de droits, une ascendance illisible ET une coupure réseau (ce qui est JUSTE,
> une incertitude ne devient pas un verdict) mais les rend indistinguables à l'écran. **C28-121** :
> `BilanLot.derniereCause` porte désormais le message, sur les DEUX canaux, et l'écran l'affiche.
> Hypothèse la plus compatible, **NON vérifiée** : `ascendance-illisible` (il rend `null`, donc compte
> comme une PANNE — 5 d'affilée coupent le lot sans rien supprimer).
>
> **PR #348** (C28-119/121/122/123) : **MERGÉE le 14/09 à 21:42 UTC** (squash `86d2c94`) sur
> autorisation explicite de Marc (« ok merge la quand la revue est finie »). L'API GitHub a rationné
> la sortie du brouillon **9 fois** en trois heures — un check-in ré-armé y est finalement arrivé.
> **LES DEUX CIBLES sont déployées** : `deploy.yml` run 34900324341 vert (clasp push + `clasp deploy`
> + réinstallation du déclencheur) et Vercel `dpl_AibCSa7…` **READY** en production sur ce même SHA.
> ⚠️ **Déploiement vert ≠ effet pris** (§9, piège 3) : le SEUL signal indépendant sera le prochain
> clic de Marc sur « Tout corbeiller », qui portera « Cause exacte : … », et la prochaine paie/RL-1/T4
> qui arrivera par le flux. Rien n'est prouvé avant.
>
> **🟦 EN COURS — 2026-09-14 (suite) : finaliser avant le prochain chantier (ADR-0056).**
> Marc : « j'ai un gros chantier que je veux faire mais d'abord regarde ce qu'il faut finaliser »,
> puis quatre décisions et un « go ». Trois lots livrés ensemble.
>
> **A · « Tout corbeiller » n'a jamais marché — et le code, lui, marchait.** Mesuré AVANT de toucher
> à quoi que ce soit : l'app en ligne sert EXACTEMENT le build courant (même empreinte de fichier que
> la compilation locale ⇒ le correctif de C28-93 EST déployé), les 112 lignes existent avec le bon
> statut, Marc voit « 🗑 Tout corbeiller (112) » actif. Or TOUS les chemins de `corbeillerLot`
> produisent un affichage : le code ne PEUT pas être silencieux. Ce qui l'était, c'est **l'endroit** —
> bilan, erreur et progression rendus en TÊTE de la carte, bouton en BAS, 112 lignes plus loin. Marc
> cliquait, le compte rendu s'affichait hors de son écran. Zone de retour désormais **collante en bas
> de carte**, et plus aucun `return` muet. ⚠️ C28-93 avait vérifié son effet sur le COMPTEUR du moteur
> (124 → 112), jamais sur ce que l'ÉCRAN montre après l'action.
>
> **B · Les deux dossiers collège/lycée fusionnent** en `Collège & Lycée — divers (années C)`
> (dossier Drive renommé ; `Lycée A (années L)` devient une SOURCE de la mission).
> `Archives scolaires` repasse à 7 enfants ⇒ son exemption au plafond est RETIRÉE. ⚠️ **La fenêtre
> reste celle des années L** : l'étendre d'une année chevaucherait la prépa et rendrait toute cette année
> inclassable par la date — signalé, le propriétaire a confirmé.
>
> **C · Re-datation des 328 de `06`** (`c26-08` → `c28-92`, cibles réduites à `06`, ~8,6 $). Et le
> trou qu'on ne pouvait pas laisser en rallumant cette campagne : **elle n'avait aucun budget
> quotidien**, donc rien ne bornait sa journée et elle échappait à l'invariant d'enveloppe.
> `REANALYSE_BUDGET_JOUR_MS: 8 min` **prélevées** sur l'historique Gmail (20 → 12) — la réallocation
> que C28-70 attendait faute de preuve, et c'est le MOTEUR qui l'écrit (« terminée ✅ — ses 20 min/j
> sont RÉALLOUABLES »). Enveloppe inchangée à 63 min/j.
>
> **REVUE FLOTTE ADVERSARIALE — 2ᵉ passe : 3 🔴 de plus, tous intégrés avant le merge.**
> (1) La campagne descendait **tout le sous-arbre de `06`**, pas les 328 fichiers à plat : elle
> aurait fait repasser par le flux ce que C28-90/C28-105 venaient de ranger — y compris les dossiers
> de MARC — et le flux ne connaît ni D8, ni D9, ni D10, donc un nom muet repartait **à plat à la
> racine du domaine**. Coût ×2 à ×3 au passage. ⇒ `REANALYSE_RACINE_SEULE`. (2) La carte du compte
> rendu **se démontait au succès complet** (0 candidat restant ⇒ plus rien pour rendre le bilan) —
> C28-93 déplacé d'un cran. ⇒ prédicat pur `carteVidesVisible`. (3) La zone collante se rendait
> **sous la barre d'onglets du téléphone**. Plus : le dossier Lycée A passait de CIBLE à SOURCE sous
> le MÊME tag (les fichiers déjà déplacés n'auraient jamais été repris) ⇒ tag `…06b` ; et aucune
> marge avant le mur (un document LLM lancé dans la dernière minute est TUÉ, le `finally` ne tourne
> pas, le budget fuit) ⇒ `PILOTE_MARGE_DOC_MS`.
>
> **✅ DÉPLOYÉ ET VÉRIFIÉ PAR SIGNAL INDÉPENDANT (14/09 15:58, relevé `etat_moteur`).** `deploy.yml`
> vert sur `01f509f`, ET le moteur écrit la preuve : ligne `Re-analyse v2 (c28-92)` **née** dans
> Progression (C28-112 se répare exactement comme diagnostiqué — le tag neuf rend `termine` faux, et
> `pousser` crée enfin la ligne), ligne de Santé « Re-datation de 06 : en cours », et
> « Historique Gmail : terminée ✅ — ses **12** min/j sont RÉALLOUABLES (**8 min déjà prêtées à la
> re-analyse**) ». Frein à 40 $ : décision du propriétaire, respectée.
>
> ⚠️ **LA BASE RECENSÉE EST 466, PAS 328 — +42 %.** Le chiffre de l'ADR venait du recensement
> C28-88 ; la mesure du moteur, elle, est exhaustive et faite aujourd'hui. Conséquences, toutes
> dérivées de 466 × 0,0261 $ : **~12,2 $ au lieu de 8,6 $**, et **19 à 30 jours** au lieu de 14 à 21.
> Le frein à 40 $ garde 3,3× de marge, donc rien ne s'arrête — mais l'écart n'est PAS expliqué et
> doit l'être (C28-120) : soit la racine de `06` s'est regarnie depuis le 13/09, soit le prédicat de
> collecte est plus large que « les fichiers à plat mal datés ». C'est le §9 mot pour mot : « un
> chiffre-titre n'est jamais une promesse de gain tant qu'il n'est pas mesuré sur le corpus ».
>
> ⚠️ **Deux choses NON encore prouvées en prod**, à ne pas déclarer : (a) la campagne est à
> `0 / 466` — elle vient de finir son recensement, aucun document n'a encore été re-daté ; (b) **D11
> n'a pas encore été exercée** — la génération de consolidation en est à 2 domaines sur 9 et n'a pas
> atteint `06`.
>
> **REVUE FLOTTE — 3ᵉ PASSE (code · sécurité · quotas) : 2 🔴 de plus, et CINQ mutations jouées par
> les agents ont SURVÉCU.** C'est la leçon du lot : une correction n'existe que si une mutation la
> fait tomber, et il faut la jouer **sur le point d'appel**, pas seulement sur la fonction pure.
> (1) **La marge de démarrage protégeait le mauvais budget** — retranchée du sous-budget local
> (2 min) alors que le terme qui mord est le garde-temps du TICK (3 min), qui n'en avait aucune. Un
> document pris à 179 s franchit le mur DUR de 6 min : l'exécution est TUÉE, le `finally` ne tourne
> pas, ~4 min sur 8 échappent au compteur, et le MÊME document repart au tick suivant sans rien pour
> l'arrêter. (2) **La convergence était devenue topologique** : « plus rien à la racine de `06` ».
> Mais la consolidation passe AVANT, avec 24 min/j contre 8, en pure I/O — elle pouvait emporter les
> 328 fichiers classés sur leur date FAUSSE, après quoi la campagne écrivait « terminée ✅ » sans
> avoir rien re-daté… et `finaliserCompteurCampagne_` EFFAÇAIT le compteur qui l'aurait dit. ⇒ D11
> (la racine d'un domaine en cours de re-datation ne se vide pas sous la campagne, levée seule à la
> convergence) + compteur honnête. (3) 🟠 **la re-datation pouvait DÉTRUIRE une bonne date** :
> `getLastUpdated()` en référence, donc `2015-06-12_Bulletin_Lyceea.pdf` → `2026-…`, hors fenêtre,
> figé sous une clé de SUCCÈS — l'inverse du but de la campagne. (4) 🟠 trois verrous **promis mais
> inexistants** : le drapeau STRICT du garde `04` (mutation survivante, mock qui ne lisait pas ses
> arguments), la ligne de Santé qui ne disait que 2 causes d'arrêt sur 6, et le tripwire de l'app
> contournable par la forme conjonctive — le bug C28-110 réintroduit, au vert.
>
> **Vérifications** : 1306 tests moteur · 281 tests app + build · syntaxe `.gs` · **27 mutations,
> 27 attrapées** (dont 8 qui avaient d'abord survécu et ont exigé d'écrire le test manquant). ⚠️ Dont la garde « racine seule », qui n'était couverte par **AUCUN** test au
> premier jet : la retirer laissait toute la suite verte. Son test observe le CHEMIN (`getFolders`
> jamais appelé), pas la taille du résultat. Trois tests qui MENTAIENT sont tombés et ont été
> corrigés : `majSante_` affirmait dériver les 20 min de CONFIG en écrivant `20` en dur — son propre
> commentaire avait prédit qu'il tomberait « le jour où les 20 min sont réallouées ».
>
> **Ce que ça coûte vraiment** : **14 à 21 jours** [Probable] — 8 min/j ÷ **20-30 s par document**
> (le chiffre MESURÉ du projet pour OCR + Sonnet v2, `Config.gs`) = 16 à 24 documents/jour pour 328.
> Elle tourne en fond, ce n'est pas l'affaire de quelques jours. Et la réallocation est neutre **au tableau** (63 min/j), pas dans la machine : le
> donneur était TERMINÉ, il ne consommait plus rien — le moteur va donc réellement consommer
> **+8 min/j** sur les ~90 min/j d'Apps Script. Marge confortable, mais l'invariant somme des
> PLAFONDS, jamais de la consommation.
>
> **Ouverts** : C28-111 (re-analyse de `03`/`08` parkée — à reprendre ou à clore avec Marc),
> **C28-115 — à trancher par Marc** : le frein LLM est à **40 $** pour une campagne annoncée à
> 8,6 $ (4,6× le besoin) ; c'est un filet anti-emballement, pas un budget, mais si la mesure dérape
> rien ne s'arrêtera avant 40 $. C28-113 (`migration` et les `dryrun-*` ont le même trou de budget
> quotidien) et C28-114 (`chargerIndexCache_` publie son cache avant de l'avoir rempli) sont notés,
> **non corrigés** — hors périmètre. C28-112 est **diagnostiqué et se répare tout seul** : la ligne
> manquait parce que `pousser` refuse de créer une ligne pour une campagne déjà « terminée »
> (C26-08 l'était sans en avoir jamais eu une) ; le tag neuf la fait naître au prochain tick. C28-86
> ne demande plus rien au code — Marc met les 2 fichiers illisibles à la poubelle lui-même, et la
> mission Carrière convergera d'elle-même.

> **🟦 HISTORIQUE — 2026-09-14 : C28-105, la structure des écoles, c'est celle de Marc (ADR-0055).**
> Marc, capture d'écran à l'appui : « j'ai la bonne structure pour les écoles déjà, **continue à
> rajouter là-dedans au lieu de mettre à la racine du projet** », puis « et **décale prépa et cégep
> là-dedans** en reprenant la bonne structure ».
>
> ⚠️ **Ce lot RE-INVERSE la mission d'école, un jour après l'avoir inversée.** Le 13/09, à une
> question qui opposait les deux structures, Marc avait répondu « mes 5 dossiers d'école » et
> `archives06` était devenue `retour-ecoles06` (l'archive rendait son contenu aux dossiers de la
> racine) ; elle a déplacé **~45 fichiers** dans ce sens. La demande du 14/09 dit l'inverse et elle
> est plus précise, parce qu'elle vient d'une capture : **les 7 dossiers qu'il montre ne sont pas à
> la racine de `06`, ce sont les enfants d'`Archives scolaires`**, qu'il a créés le 29/05/2026. Les
> 6 dossiers d'école de la racine, eux, ont TOUS été créés par le moteur (07→08/2026). Relevé dans
> Drive le 14/09, pas déduit. Rien n'est perdu : la seule mutation est le déplacement.
>
> **Ce qui change.** (1) La table du flux ne porte plus aucune école à la racine de `06` : elle
> porte `Archives scolaires` et, dessous, les 8 dossiers de Marc — la racine passe de 9 à
> **3 enfants** (`Archives scolaires`, `Autres établissements`, `Diplômes & relevés officiels`).
> (2) Les libellés du routage DEVIENNENT ses noms (`Lycée A (années L)`,
> `Prépa A (années P)`, `Université A — Diplôme U (années U)`, `École d’ingénieurs A — Cycle ingénieur (années E)`),
> plutôt qu'une table de correspondance — deux noms pour la même chose, c'est le piège des deux
> canonicaliseurs qui divergent. (3) `Cégep A (année G1)` est créé PAR NOM au patron de
> Marc, au premier fichier déplacé, jamais à vide. (4) La mission devient **`ecoles-archives06`**
> (tag et clé NEUFS, sinon les ~45 déjà déplacés portent une clé de SUCCÈS et ne reviennent
> jamais) : les 6 dossiers de la racine sont les SOURCES, les archives les CIBLES.
>
> **`IUT A` part avec.** Marc n'a nommé que prépa et cégep, mais c'est un dossier d'école
> que le moteur s'est créé le 23/08 à côté de `Diplôme U Université A Ville E` (l'IUT A EST l'Université A) ;
> ses 5 fichiers sont des documents du Diplôme U. Signalé ici et dans l'ADR §3.5, pas fait en silence.
>
> **La revue flotte a rendu 2 🔴 et 6 🟠, tous intégrés AVANT le merge — et les trois plus graves
> n'étaient pas visibles depuis le diff.** (1) La consolidation **démantelait la sous-structure de
> Marc** : une école nommée est un signal FORT, donc ni D8 ni D9 ne mordent entre deux frères de
> même profondeur — `…/École d’ingénieurs A — …/MFE` se vidait dans `…/Cours & travaux`, et
> `…/Collège & Lycée — divers` partait vers la RACINE de `06`, l'inverse mot pour mot de la demande.
> D'où **D10** (« on ne réorganise jamais l'intérieur de la structure de Marc ») et la déclaration
> de ses **14 dossiers thématiques** dans la table — sans quoi, étant VIDES, ils seraient proposés à
> la corbeille, c'est-à-dire sa plainte d'origine appliquée à sa propre structure. (2)
> **`estSourceDisparue_` ne reconnaissait pas le message RÉEL de Drive** (qui dit « absent OU pas le
> droit » en une seule phrase), et son test s'en protégeait en tronquant la chaîne : les sources de
> `vehicule`/`logement`, corbeillées le 12/09, auraient à leur purge (~12/10) empêché toute
> convergence, donc bloqué `dispatch03` à vie, heartbeat vert. (3) Le **tripwire des libellés
> d'école était devenu TAUTOLOGIQUE** — une mutation du libellé Lycée A survivait aux 1289 tests et
> aurait créé un dossier jumeau au premier document.
>
> Retirés en conséquence : le **bump de `MISSIONS_REGLES_VERSION`** (inutile — tag neuf — et il
> aurait invalidé les clés de SUCCÈS des 8 missions) et la **peinture rouge des 6 dossiers vidés**
> (elle reposait sur « rien ne les recrée », faux tant que `SEED_ENTITES` valide 6 écoles dans
> `06` — C28-106). Ajoutés : la garde §1.2 « jamais de dépôt dans une corbeille » dans le runner de
> missions, et `repointerEntitesLot_` (1 lecture de l'onglet `Entités` au lieu de 6).
>
> ⚠️ **Horizon corrigé** : les 8 missions se partagent **2 min/jour**, pas 9 — l'ADR l'avait écrit
> faux d'un facteur 4,5. Les ~190-250 fichiers mettront **~5 à 10 jours** [Probable].
>
> **Ce qui est verrouillé.** `Archives scolaires` a 8 enfants > 7 (et `École d’ingénieurs A — …` en a 16) : l'exemption au plafond est
> **nommée** (`RESET_EXEMPTIONS_PLAFOND`) et testée à la valeur près — l'alternative (omettre de la
> table les 3 dossiers qu'aucune règle ne vise) aurait rendu le plafond faux en silence. Les noms
> sont comparés au relevé Drive caractère par caractère ET doivent survivre inchangés à `champ_`
> (un `_` créerait un dossier jumeau sans une erreur). Les cibles de la mission == les écoles que
> le routage sait nommer (dérivé de `RESET_FENETRES_ECOLE`, pas recopié). **12 mutations jouées, 12
> attrapées** : exemption non consultée, nom divergent d'un caractère, préfixe retiré, `_` dans un
> nom, cible de mission hors table, école du routage sans mission — puis, après la revue : D10
> neutralisée, ordre de `estSourceDisparue_` remis à l'envers, garde corbeille retirée, garde
> structure retirée, libellé Lycée A divergent, cégep créé à vide.
>
> **Le corpus `deja-ranges` le montre** : les 5 fichiers réellement dans `06/Cégep A`
> suivent la nouvelle structure, et le test le vérifie **à l'école près** — un fichier du cégep qui
> partirait chez l'Université A fait toujours échouer la CI.
>
> ⚠️ **Question toujours ouverte (C28-90)** : le propriétaire a dit « Lycée A c'est genre <années L> », son
> dossier s'appelle `Lycée A (années L)` et il a aussi
> `Collège & Lycée — divers (années C)`. Les deux ne peuvent pas être vrais (les années L,
> c'est aussi la prépa). La FENÊTRE n'a pas bougé — ~26 fichiers, tous dans `06`, récupérables.
>
> ⚠️ `CONSOLIDATION_TAG` n'est **pas** bumpé : `conso-4` est en cours (102/162 au 13/09) et un bump
> la relancerait de zéro sur 18 700 documents. Les fichiers déjà dans les dossiers d'école sont
> déménagés par la mission, pas par la consolidation.
>
> **🟦 HISTORIQUE — 2026-09-13 (suite) : C28-89, les deux arbitrages de Marc appliqués (ADR-0052 §7).**
> #338 est **mergé** (`main` = 0d53c8a) et **déployé** : `deploy.yml` run #324 vert sur les deux
> cibles. Marc a ensuite tranché D6 et D7, et ce lot les livre.
>
> **D6 · `06 · Études`** — Marc a donné son parcours : « École d’ingénieurs A <années E> Université A <ville> <années U>
> Lycée B <années B> », puis, à la question sur les deux écoles manquantes, « Cégep A
> c'est <année G1> **en même temps que Université A** et Lycée A c'est genre <années L> ».
> `RESET_FENETRES_ECOLE` + `ecoleParDateReset_` (PURE) — même idiome que les fenêtres d'occupation
> des logements (ADR-0040), bornées au MOIS à la convention sept → août : sans ce découpage,
> 83 fichiers tombaient dans deux fenêtres et étaient refusés pour rien.
> ⚠️ **La fenêtre de Cégep A ne sert pas à PLACER, elle sert à EMPÊCHER de placer.** Tout
> document de 2019 tombe dans deux fenêtres et reste non attribué : 28 fichiers de moins placés,
> et zéro mal placé. C'est LA raison pour laquelle la question valait d'être posée — sans elle, les
> documents de Cégep A seraient partis chez l'Université A avec une clé de SUCCÈS, en silence et sans
> retour. Ordre de décision : nom de l'école → marqueur de niveau/filière (« niveau X », « code de filière »,
> « filière », « 1ʳᵉ année ») → fenêtre. **143 des 475 placés, sur les 5 écoles** : 34 par un FAIT
> écrit dans le nom, 109 par les fenêtres.
>
> **D7 · `03 · Logement`** — « fusionner Contrats + Modèles ». `Modèles & formulaires` disparaît de
> la structure, sa place va à `Travaux & équipements`. Les 6 formulaires réellement présents dans
> l'ancien nœud sont tous locatifs : `Contrats` est leur place. La mission `dispatch03` suit dans le
> MÊME commit, sinon elle recréait le nœud PAR NOM à chaque passage pendant que le flux rangeait
> ailleurs. **6 des 8 restants placés** (les 2 derniers ne sont pas de l'équipement : une capture
> d'annonce, une liste d'achats pour le VÉHICULE).
>
> **Bilan : 347 des 683 — et 204 sur 208 hors `06`.**
>
> **Revue flotte sur D6/D7 : 2 agents, 2 🔴 + 10 🟠/🟡 intégrés.** Ce qui a failli passer :
> `STRUCTURE_CIBLE_RESET` écrivait `Lycée A` alors que le dossier RÉEL de Marc
> s'appelle `Lycée A` — **l minuscule**. `getFoldersByName` est sensible à la casse :
> un second dossier serait né à côté du sien et 143 fichiers y seraient partis (le « Logement C »
> vs « Logement C » de `03`, en pire). Et la fenêtre de Cégep A ne suffisait pas : le dossier réel
> contient des fichiers bien au-delà de la fenêtre, donc 5 documents de cégep partaient chez
> l'Université A et l'École d’ingénieurs A. D'où `vetoCollegialReset_`. Sept marqueurs sur neuf avaient une contribution
> NULLE mesurée (dont `svt`, qui produisait une contradiction dans le corpus : deux fichiers du même
> jour, même événement, deux écoles) et quatre étaient INATTEIGNABLES — il n'en reste que deux.
> Deux tests ne prouvaient rien : l'un asserte `String(null).length > 0` (toujours vrai), l'autre
> était devenu tautologique en changeant sa valeur attendue.

> **🟦 EN COURS — 2026-09-14 : C28-99, réallouer le temps d'exécution vers le vrai goulot (ADR-0054).**
> Marc : « fais la réallocation, jveux utiliser le temps dispo au max ».
>
> **Mesuré avant de bouger quoi que ce soit.** La génération du plan de consolidation consomme ses
> 10 min/j EN ENTIER sans terminer un seul domaine (1 sur 9, aucun progrès depuis 18 h) — et c'est
> elle qui alimente tout l'aval : l'exécuteur affiche « plan drainé 372/372, attend la génération »,
> donc ses 12 min DORMENT, et la racine `08 · Perso & projets` reste à 116 fichiers en vrac. La
> campagne Doublons, elle, est TERMINÉE — lu dans la ligne de Santé du moteur, pas supposé.
>
> **Transfert `10/12/3` → `16/8/1`** : la génération gagne **+60 % de débit**, l'enveloppe
> reset-OFF reste à **63 min/j** pour un plafond de 65. Aucune minute créée — §9 « réallouer,
> JAMAIS augmenter » : au-delà du mur de ~90 min/j, TOUS les déclencheurs gèlent, chien de garde
> compris (C28-29).
>
> Les deux verrous de COUPLE (exec↔fusion 2026-08-11, gen↔missions C28-49) devenaient faux dès
> qu'un transfert traverse les deux paires : remplacés par un verrou de **BLOC** (somme des cinq
> campagnes qui se prêtent du budget = 27 min/j), plus l'interdit « campagne ACTIVE à budget 0 »
> (une campagne à 0 est MUETTE, no-op silencieux). 5 mutations jouées.
>
> ⚠️ **À VÉRIFIER DANS 24 H** (c'est la contrepartie du transfert) : ouvrir `Diagnostic.gs` →
> `etatCampagnesRangement` dans l'éditeur Apps Script. Si la génération affiche **`16/16 ÉPUISÉ`**,
> le budget était bien le frein et le gain est réel. Si elle affiche `2-4/16` avec l'exécuteur à
> `8/8 ÉPUISÉ`, c'est la **contre-pression** qui a mordu (elle coupe la génération quand l'exécuteur
> accumule 150 lignes de retard) : il faut alors rendre les 4 minutes à l'exécuteur. Ce risque est
> borné par le plafond de RATIO ajouté au passage — `génération ≤ 2 × exécution` — parce qu'en août
> 2026, à ce ratio exact, la contre-pression avait déjà étranglé la génération.
>
> ⚠️ **Ce qui n'est PAS réalloué, et c'est le plus gros** : les **20 min/j** de l'historique Gmail.
> §1.6 interdit de la déclarer finie sans lire son compteur, et le compteur qui tranche — les
> MINUTES consommées — n'existait nulle part. *(Correction apportée en revue : j'avais écrit que la
> campagne « n'était visible nulle part ». Faux — l'onglet Progression lui consacre une ligne depuis
> C28-44, avec un statut à quatre valeurs. Je l'avais cherchée dans un export TRONQUÉ de la Sheet et
> conclu de son absence qu'elle n'existait pas.)*
>
> Livré : **sa ligne dans l'onglet Santé** — statut RICHE (partagé avec la Progression : une seule
> règle, deux surfaces), minutes ET fils du jour. Les trois précautions comptent autant que la ligne :
> une campagne SUSPENDUE ou EN PAUSE affichait « en cours · 0 min », ce qui se lit « prends ses
> 20 minutes » — elle dit maintenant « elle ne PEUT pas consommer » ; les DEUX plafonds sont affichés
> (c'est celui des fils/jour qui mord en régime normal, donc à plein régime elle peut n'afficher que
> 0,4 des 20 min) ; et une lecture en panne rend « illisible », jamais « terminée ».
>
> Au prochain tick, la réponse sera écrite. ⚠️ Mais **ses minutes ne pourront pas doubler la
> génération** : le plafond de ratio l'interdit. Une réallocation saine ressemblerait à « −6 à
> l'historique, +4 à la génération, +2 à l'exécution » — vérifié par mutation.

> **✅ MERGÉ, DÉPLOYÉ ET VÉRIFIÉ EN PRODUCTION — 2026-09-14 : C28-93.**
> PR #341 mergée (`88e8458`), `deploy.yml` #327 vert (clasp push + redéploiement de la web app +
> réinstallation du déclencheur). Et le signal INDÉPENDANT, lu dans l'onglet `Réorg` deux ticks
> après le déploiement — parce qu'un run vert ne prouve pas que le tick exécute le nouveau code
> (§9, piège 3) : **la liste est passée de 124 à 112 propositions**, et les **12 lignes retirées**
> sont exactement celles qui n'auraient jamais dû y être :
> `02 · Finances`, `05 · Carrière` (noms de racine de domaine) · `Employeur A` (×2), `Projets`,
> `Candidatures`, `Employeur B`, `Éditeur logiciel`, `DriveAI` (nœuds de la table) ·
> `IUT A`, `Cégep A`, `Société d'automatisation` (entités validées).
> Chacune porte son motif : « la taxonomie recrée « X » au premier document [filtre-vides c2893-1
> → vide-protégé] ». Aucune mutation Drive : seuls des statuts ont changé.
> ⚠️ Les 112 restantes attendent UN clic de Marc sur « Tout corbeiller » — le moteur ne corbeille
> toujours rien (ADR-0014, §1.2).
>
> **Le détail du chantier :**
> Marc : « il me propose trop de dossiers à mettre en poubelle, même des dossiers utiles — fais un
> nettoyage et améliore », puis, sur le reste : « **supprime tous les vides** ».
>
> **Compté, pas supposé** : 124 dossiers proposés dans l'onglet `Réorg`, tous vidés entre le 1er et
> le 15 août par le grand rangement, aucun depuis. Dedans : deux dossiers NOMMÉS comme des domaines
> (`02 · Finances`, `05 · Carrière`), SIX noms que la table recrée — sept lignes, `Employeur A`
> y figurant deux fois — (`Employeur A`, `Projets`, `Employeur B`, `DriveAI`, `Éditeur logiciel`,
> `Candidatures`), une entité du référentiel, des
> doublons de nom sans chemin (deux `Mémoire`, deux `Exercices`, quatre graphies d'`IUT A`), et au moins un dossier qui **n'existe plus** (404).
>
> ⚠️ **Le défaut qui rendait la liste inutilisable EN ENTIER** : le bouton « Tout corbeiller (124) »
> bouclait dans un `try` unique — la PREMIÈRE exception arrêtait tout. Le premier de la liste étant
> un dossier nommé `02 · Finances`, refusé par son nom, **le bouton ne corbeillait rien**, et
> l'erreur ne parlait que de lui.
>
> **Livré** (ADR-0053) : (1) le moteur ne propose plus ce que la TAXONOMIE sait recréer — garde par
> CAPACITÉ (`estNoeudRecreable_`, la table répond elle-même, à toute profondeur), jamais une liste
> d'exceptions ; (2) le constat porte le CHEMIN COMPLET, pas le nom nu ; (3) un refus ne stoppe plus
> le lot : il classe SA ligne (`vide-disparu` / `vide-repris` / `vide-protégé`) et le lot continue,
> avec un bilan chiffré — et ce qu'on ne sait pas conclure (réseau, quota) reste candidat plutôt que
> de devenir un verdict.
>
> ⚠️ **Ce que ça ne fait pas** : le moteur ne corbeille toujours rien. La mutation reste dans
> `app/src/corbeille.ts`, au clic de Marc, avec re-vérification live (ADR-0014, §1.2 — non
> négociable). « Supprime tous les vides » = **un** clic sur « Tout corbeiller », qui traite
> maintenant les 124 lignes au lieu de s'arrêter sur la première.
> ⚠️ La peinture rouge dans Drive reste telle quelle (choix de Marc, 13/09) : deux canaux de
> proposition coexistent, la couleur et la liste.
>
> **2ᵉ REVUE FLOTTE (code · sécurité · quotas) — 1 🔴 trouvé par DEUX agents en convergence, plus
> 6 🟠. Tout corrigé avant le merge, 7 mutations jouées.**
>
> 🔴 **La garde ne s'appliquait qu'aux FUTURS constats.** `estNoeudRecreable_` n'avait qu'un site
> d'appel, sur le chemin d'ÉCRITURE. Les 124 lignes d'août étaient déjà dans l'onglet, qui est
> append-only — et c'est le MÊME lot qui rendait le bouton opérant. Au clic, `Employeur A` (×2),
> `Projets`, `Employeur B`, `DriveAI`, `Éditeur logiciel`, `Candidatures` et `IUT A`
> seraient partis à la corbeille : exactement les « dossiers utiles » de la plainte de Marc.
> Corriger le flux sans nettoyer le stock rendait le défaut EFFECTIF au lieu de le fermer. D'où une
> passe one-shot VERSIONNÉE (`filtrerVidesCandidatsRecreables_`) qui ré-applique la garde au stock
> — statuts seuls, aucune mutation Drive.
>
> 🟠 **Le référentiel d'entités échoue OUVERT** : `entitesValideesParCle_` avale son exception et
> rend `{}`. Bonne dégradation pour le ROUTAGE (classement à plat, réversible) ; faux verdict
> DÉFINITIF pour une proposition de corbeille. C'est le symétrique EXACT du 🔴 `ascendance-illisible`
> côté app, resté ouvert côté moteur.
> 🟠 **Un SECOND producteur** de lignes `videcandidat|` (les fusions validées dans l'app) ne passait
> par aucune garde — alors que l'ADR affirmait le contraire.
> 🟠 **§1.2** : `sousDossier_` rendait aussi les dossiers **CORBEILLÉS** (`getFoldersByName` les
> inclut). Un dossier corbeillé redevenait cible de classement, et les documents déposés dedans
> étaient purgés AVEC lui à 30 jours — une suppression automatique. Pré-existant, rendu
> ATTEIGNABLE par ce lot ; fermé ici plutôt que renvoyé au backlog.
> 🟠 **Un lot écourté rendait le même bilan qu'un lot complet** (session morte à la 40ᵉ sur 124 :
> rien ne disait que 84 lignes n'avaient jamais été tentées) ; 🟠 **aucun coupe-circuit** — sous un
> 429 généralisé, ~2 000 requêtes partaient en rafale sur un quota partagé avec le moteur ;
> 🟠 **`vide-repris` figeait un fait RÉVISABLE** (un dossier re-vidé n'était plus jamais proposé).
>
> **Trois bugs PRÉ-EXISTANTS relevés et NON corrigés** (§6 — au backlog, pas dans ce lot) :
> C28-94 (`chargerEntitesCache_` publie son cache avant de l'avoir lu — c'est ce qui force
> l'abstention sur un référentiel « vide »), C28-95 (deux remontées d'ancêtres pour une),
> C28-96 (le scope `.../auth/forms` n'est documenté nulle part).
>
> **3ᵉ PASSE (code · sécurité), sur le delta seul — 🟢 sur les garde-fous, et 6 🟠 de plus.**
>
> 🟠 **Les deux CÂBLAGES du delta n'étaient gardés par aucun test** — prouvé par mutation chez la
> revue : retirer l'appel à `filtrerVidesCandidatsRecreables_`, puis celui à `proposerSourceFusion_`,
> laissait 1268/1268 verts. C'est la forme EXACTE du 🔴 d'origine (une fonction testée, appelée à un
> seul endroit) : le lot corrigeait le symptôme et reconduisait la cause. Deux tests d'orchestration.
> 🟠 **Le correctif §1.2 gardait la FEUILLE de la chaîne, pas ses RACINES.** `dossierDomaineAuto_` et
> `dossierRacineParNom_` résolvent par un ID mémorisé en Script Property, qui SURVIT au corbeillage :
> Marc corbeille `_Doublons` depuis Drive, le moteur continue d'y envoyer chaque doublon, et 30 jours
> plus tard Drive purge le dossier AVEC son contenu — §1.1(c), sur la population dont C28-49 PR4 a
> mesuré qu'elle contenait 1 076 fichiers dont trois passeports.
> 🟠 **Le verdict du filtre était DÉFINITIF et non versionné** : un bump pouvait retirer une
> proposition, jamais la rendre — alors que C28-89 a réellement retiré `Modèles & formulaires` de la
> table. Le détail porte désormais la marque du filtre et son tag.
> 🟠 **Les deux producteurs ne rendaient pas le même verdict** : `Employeur A` refusé par l'un, proposé
> par l'autre dès que la cible portait le même nom, puis défait par le filtre au bump suivant. Règle
> alignée, exception supprimée.
> 🟠 **`dernierSegment_` sur un nom contenant `/`** — Drive l'autorise : « Impôts/Archives » se
> lisait « Archives », un nœud de la table, et la ligne était retirée à tort et DÉFINITIVEMENT.
> 🟠 **Le coupe-circuit ne surveillait que Drive** : un 429 côté Sheets laissait le lot aller au bout,
> 124 dossiers corbeillés et 124 statuts perdus, sans que rien ne le dise.
>
> Plus : le garde-temps manquant dans la boucle d'écritures, un instantané de l'onglet qui pouvait
> écraser ce que l'app venait d'y écrire, `ctx.proteges || {}` qui faisait échouer le garde §1
> OUVERT, `entitesValideesParCle_` qui avait cessé de rendre sa carte PARTIELLE, et trois
> commentaires qui promettaient ce que le code ne tient pas.
>
> **Deux bugs PRÉ-EXISTANTS de plus au backlog** : C28-97 (une abstention de constat n'est jamais
> rattrapée — arbitrage assumé, écrit en ADR-0053 D11), C28-98 (les autres résolveurs par nom
> ignorent la corbeille — aucun n'ouvre de chemin vers une suppression automatique).
>
> **4ᵉ PASSE — 3 🟠, dont une RÉGRESSION introduite par le lot précédent.**
>
> 🟠 **Le discriminant « un chemin commence par une racine de domaine » est FAUX pour l'inventaire à
> PORTÉE.** Quand Marc clique « Analyser la structure » sur un dossier, les chemins produits sont
> `Employeur A/Projets` — sans racine. Lus en bloc, `Projets` et `Candidatures` redevenaient proposables
> à la corbeille : les noms MÊMES de sa plainte. Les deux lectures sont désormais essayées, et un
> seul « oui » suffit à refuser. Conséquence assumée : un dossier réellement nommé `Impôts/Archives`
> n'est plus proposé — un dossier vide qui subsiste coûte moins qu'un dossier utile corbeillé.
> 🟠 **La marque du filtre ne portait que son tag**, alors que l'app n'écrit QUE la colonne F. Une
> ligne que Marc avait fait refuser par Drive redevenait candidate à CHAQUE bump, réapparaissait
> dans sa liste, échouait encore — sans qu'il puisse s'en débarrasser. La marque porte maintenant le
> statut écrit, donc toute écriture de l'app rend son verdict définitif.
> 🟠 **Le câblage du verdict révisable n'était exercé par aucun test** : deux mutations restaient
> vertes sur 1278 tests. C'est le défaut de la 3ᵉ passe, reproduit sur le câblage neuf.
>
> Plus 4 🟡 : un jsdoc orphelin, l'horodatage de la ligne ré-armée, `avancement` resté hors du try
> d'écran, et la comparaison d'entité **sensible à la casse** alors que le décompte du 13/09 contient
> quatre graphies d'`IUT A` — elle est désormais normalisée (casse, accents, apostrophes).
>
> **Vérifications** : 1279 tests moteur · 270 tests app · `node --check` sur les 41 `.gs` ·
> `npm run build` · **22 mutations** jouées et restaurées par copie de sauvegarde (jamais
> `git checkout`).

> **✅ MERGÉ, DÉPLOYÉ ET VÉRIFIÉ EN PRODUCTION — 2026-09-13 19:25 UTC : le rattrapage TOURNE.**
> PR #339 mergée (`a2f4373`), `deploy.yml` run #325 vert (clasp push + redéploiement de la web app
> + réinstallation du déclencheur). Et le signal INDÉPENDANT, lu 1 h après le merge — parce qu'un
> run vert ne prouve pas que le tick exécute le nouveau code (piège 3) :
>
> | signal | avant | après 1 h |
> |---|---:|---:|
> | racine `01 · Administratif & identité` | 13 fichiers | **1** |
> | racine `08 · Perso & projets` | 116 | ≥ 100 (son domaine n'est pas encore passé) |
> | Index (documents au catalogue) | 18 525 | **18 701** |
>
> `etat_moteur` montre les deux étapes de la campagne sous le NOUVEAU tag : « Consolidation —
> génération du plan (**conso-4**) » à 1/9 domaines, « exécution du plan (**conso-4**) » à
> 102/162 lignes avec « +60 lignes · il y a 0 min ». Le plan a donc bien été purgé puis re-généré,
> et l'exécuteur applique. La liste d'erreurs du moteur est VIDE, et la panne de config Calendar du
> 08/09 ne s'y trouve plus.
>
> ⚠️ **La mission `retour-ecoles06` n'a pas encore tourné** : elle apparaît bien (donc le renommage
> et l'inversion sont déployés) mais à « en pause (budget du jour épuisé) — reprise demain ». C'est
> attendu et c'est le prix de la réallocation : les missions sont passées à 2 min/jour, et le
> budget du 13/09 était consommé avant le déploiement. Les 139 fichiers repartent vers les écoles
> demain. ⚠️ Tant qu'elle n'est pas passée, le corpus `deja-ranges` ne peut pas couvrir les
> 4 marquages « signal faible » (la population est encore dans les archives) — à régénérer ensuite.
>
> ⚠️ Le battement de cœur affichait 29 min de retard juste avant le déploiement (13:57 local à
> 14:26). Après, il est reparti (15:11 pour une lecture à 15:25). À re-regarder si l'écart
> réapparaît : le tick est censé passer toutes les 5 minutes.

> **🟦 HISTORIQUE — 2026-09-13 : C28-90, le rattrapage du stock est LANCÉ.**
> Marc : « fais la préparation de C28-90 et lance le rattrapage ». La préparation d'abord, le
> conflit de structure de `06` tranché par Marc ensuite, et le bump `conso-3 → conso-4` seulement
> après. Marc a aussi choisi « lance direct » plutôt que de relire le plan.
>
> **Fait** : (1) budget réalloué, consolidation 2 → 10 min/j repris aux missions (10 → 2, toutes
> terminées) — le couple reste à 12 min/j, réallocation et non hausse d'enveloppe ; (2) les règles
> que les missions étaient seules à connaître sont remontées dans la règle partagée — le flux vise
> désormais `Assurance habitation/<Assureur>` et `Énergie & services/<Fournisseur>` via le MÊME
> `bucketEmetteur_` que `dispatch03`, et les 4 buckets sont déclarés dans la table ; (3) **D9 — on
> ne remonte jamais un fichier vers un de ses ancêtres**. Mesuré sur le Drive réel : sans cette
> garde, les 6 sous-dossiers thématiques de `Logement/Logement A` et les 4 buckets d'émetteur
> créés le 12/09 étaient remontés d'un cran, sans validation ligne à ligne.
>
> **Le conflit qui a fait attendre le bump.** Les 4 nœuds d'école visés par D6 étaient EXACTEMENT
> les 4 sources de la mission `archives06`, dont l'objet était de les VIDER vers des archives aux
> autres noms (`Université A — Diplôme U`, `Prépa A`…) et qui les déclarait `sourcesJetables` — donc peints
> en rouge pour suppression. Son commentaire disait « le flux ne les recrée pas, il vise l'archive » :
> vrai du chemin par ENTITÉ, FAUX du chemin par TABLE, qui résout par NOM. Avant D6 la contradiction
> portait sur 11 fichiers ; D6 la portait à 143.
> **Le propriétaire a tranché : « mes 5 dossiers d'école ».** La mission est INVERSÉE dans le même commit —
> l'archive rend son contenu à l'école — avec un tag et une clé NEUFS (`retour-ecoles06`), sans quoi
> les fichiers déjà déplacés dans l'autre sens portaient une clé de SUCCÈS et n'auraient jamais été
> repris. `sourcesJetables` passe à `[]` : `Archives scolaires` contient trois autres dossiers que la
> mission ne touche pas, et peindre en rouge un parent partiellement vidé est le défaut « tracer ce
> qui se passe si l'utilisateur OBÉIT au signal ».
>
> **`CONSOLIDATION_TAG` : conso-3 → conso-4.** Les 683 sont ré-évalués sous les règles courantes ;
> 347 ont une cible. `CONSOLIDATION_EXEC_ACTIF` reste à `true` (déplacement seul, aucune suppression).
>
> ⚠️ **À CONFIRMER par Marc** : il a dit « Lycée A c'est **genre** <années L> », mais
> deux dossiers qu'il a nommés lui-même disent `Lycée A (années L)` et
> `Collège & Lycée — divers (années C)`. Si la seconde lecture est la bonne, ~26 fichiers du
> début de la période partent chez Lycée A alors qu'ils sont du collège. La fenêtre retenue est celle qu'il a
> ÉNONCÉE ; le doute est écrit. Conséquence bornée : 26 fichiers dans le mauvais dossier, tous
> dans `06`, récupérables par un bump de règles.
>
> **La revue sécurité a BLOQUÉ le merge, et c'est elle qui a rendu le lancement sûr.** Verdict 🔴
> sur trois défauts, tous reproduits sur le code réel, tous corrigés avant le merge :
> (1) le drapeau « signal faible » (D8) n'était posé que sur DEUX des chemins décidés par le seul
> TYPE — les filets internes de la table (`Contrats`, `Correspondance`, `Travaux & équipements`,
> `Véhicule/À attribuer`) rendaient une cible non marquée, donc gagnante contre un rangement
> existant : **16 des 36 fichiers ciblés de `03`, soit 44 %**, traversaient la garde sans être vus ;
> (2) **ni D8 ni D9 n'étaient rejouées au moment du `moveTo`** — l'exécuteur recalculait la cible
> mais jugeait la position sur l'instantané du plan : les deux gardes n'existaient qu'au dry-run,
> alors que les missions et le flux tournent APRÈS lui dans le même tick ; (3) **D9 n'avait aucun
> test** — neutralisée, la suite restait verte à 1241/1241, et son jsdoc annonçait « (testée) ».
> Correctifs : le drapeau est posé PAR la ligne qui décide (`faibleReset_`) et recueilli, jamais
> re-dérivé ; `decisionConsolidation_` — la MÊME fonction que le plan — est rappelée avant chaque
> mutation ; D8/D9 sont testées aux deux niveaux. **Les cinq correctifs sont prouvés par mutation.**
>
> Quatre 🟠 corrigés dans la foulée : le rouge « bon pour suppression » posé sur les 4 dossiers
> d'école par l'ancienne mission n'avait **aucun chemin de retour** (`depeindreCiblesRemplies_` le
> retire au premier run, sur les dossiers qui ne sont plus vides) ; l'exécuteur pouvait appliquer les
> lignes de `conso-3` sous la clé `conso-4` au premier tick du bump (garde de tag) ; le vocabulaire
> des cours volait `<école>/Administratif` (« Fiche d'inscription », « Convention de stage ») ; et le
> corpus de preuve ne contenait pas la population que D9 protège — les 2 sous-dossiers thématiques
> réels de `Logement A` y sont, et neutraliser D9 fait désormais tomber le test de corpus.
>
> **La contre-revue a rouvert le dossier, et c'est la bonne nouvelle.** Les trois 🔴 du premier tour
> étaient bien fermés, mais deux portes restaient ouvertes — dont une plus large que celles qu'on
> venait de fermer. (1) **Une cible VIDE remontait les fichiers à la RACINE du domaine** : quand
> aucune règle ne sait placer un document, la décision proposait de le sortir de son dossier pour
> le mettre à plat — l'inverse exact de ce que tu as demandé. Mesuré sur le corpus réel, en plaçant
> les 475 noms de `06` dans un dossier d'école (ce que `retour-ecoles06` est en train de faire) :
> **332 repartaient à la racine ; maintenant 0**. Défaut pré-existant, mais ce lot en faisait
> l'autorité au moment du déplacement — et un test ajouté au premier tour le figeait en contrat.
> (2) **Le retrait du rouge ne s'exécutait jamais** : il était posé au premier run, avant le
> drainage, alors que les dossiers sont rouges *parce qu'*ils sont vides — la passe ne faisait rien
> et le drapeau « c'est fait » était consommé quand même. Il vit désormais à la CONVERGENCE de la
> mission (quand elle a fini de verser), avant le drapeau de fin, et une passe coupée ne conclut
> pas. (3) Quatre filets par type de `01`/`06` n'étaient pas marqués « signal faible », dont celui
> qui envoyait **le passeport d'un proche rangé sous `Autres/<personne>` dans le dossier d'identité
> de Marc** dès que son prénom n'est pas dans le nom.
>
> **Troisième passe : 🟢 sur les garde-fous, et le retrait du rouge réécrit une fois de plus.** §1
> (04, aucune suppression) et la convergence de la campagne vérifiés par exécution ; les 4 marquages
> « signal faible » ne coûtent **aucun** rangement attendu (mesuré sur les 683 : 0 régression). Mais
> le retrait du rouge, posé à la convergence de la mission, ne pouvait toujours pas marcher : **la
> mission n'est pas la seule à remplir ces dossiers** — la consolidation y enverra 143 fichiers
> pendant des semaines APRÈS, quand plus aucun run n'y revient (reproduit : 20 ticks après
> remplissage, 0 dé-peint). C'est maintenant une **sonde quotidienne** indépendante de la mission,
> qui s'arrête quand plus rien n'est vide (ou après un mois — un dossier vide depuis un mois l'est
> pour de bon, et son rouge est alors VRAI). Au passage : ce chemin-là était le seul à pouvoir
> boucler sans filet anti-brûlage et à affamer les 5 autres missions.
>
> ⚠️ **Honnêteté sur la preuve** : les 4 marquages n'ont aucune couverture sur données RÉELLES —
> 0 des 683 noms du corpus les déclenche, et les fichiers qu'ils protègent (ceux déjà dans tes
> dossiers d'école) sont aujourd'hui **absents de Drive**, l'ancienne mission les ayant tous envoyés
> aux archives. La preuve tient sur des noms réalistes en test. Quand `retour-ecoles06` aura rendu
> leur contenu aux écoles, le corpus pourra être régénéré et cette classe deviendra mesurable.
>
> Vérifié dans Drive plutôt que déduit : le libellé `Lycée A` de la table et le dossier
> réel de Marc sont **identiques octet pour octet** (NFC, apostrophe droite) — pas de dossier jumeau
> par normalisation Unicode. La couleur réelle des 4 dossiers, elle, **n'est pas lisible** par l'API
> dont je dispose (`folderColorRgb` n'est pas exposé) : la dé-peinture est donc posée sans condition
> préalable, ce qui est sans risque (elle ne touche que des dossiers NON vides).
>
> ⚠️ **À VÉRIFIER EN PROD après déploiement** (le vrai signal, jamais le statut du run) : le plan de
> consolidation doit se REMPLIR (onglet `PlanConsolidation` purgé puis re-généré sous `conso-4`),
> puis les racines de domaine doivent se VIDER — `08 · Perso & projets` (115 au 13/09) et
> `01 · Administratif & identité` (13) sont les deux compteurs les plus lisibles.
>
> **Ce qui reste, et ce que « lit et classe mieux » veut dire (C28-92).** 328 fichiers de `06`, dont
> **239 datés `2026`** : la date de RÉCEPTION, faute de date lisible à l'import. Le nom est épuisé
> (15 marqueurs sur 349 mesurés). La lecture LLM a bien un travail utile ici, mais **pas celui qu'on
> croyait** : elle ne trouvera pas l'école (prouvé sur deux documents ouverts), elle trouvera la
> **DATE** — le TP de physique lu pendant l'analyse porte une date de l'époque dans son en-tête. Re-dater
> suffit à les faire tomber dans les fenêtres de D6. C'est la campagne `reanalyse` existante,
> ≈ 8,6 $, dans l'enveloppe approuvée. À livrer APRÈS C28-90 (sans rattrapage du stock, un document
> re-daté resterait là où il est).
>
> **✅ MERGÉ ET DÉPLOYÉ — 2026-09-13 : C28-87 (chantier #47), « pas de fichiers libres » — ADR-0052 (#338).**
> Marc : « je veux mes 01 02 03 etc et pour chaque des sous dossiers **mais pas de fichiers
> libres** » ; en cas d'hésitation : « qu'ça aille dans les bons sous dossiers **ou que ça me
> propose des sous sous dossiers à créer** ». Il avait aussi approuvé une campagne LLM de
> rattrapage « ~8-10 $ une fois » et le rangement interne de `04`.
>
> **Le recensement a changé le problème.** Comptage EXHAUSTIF des enfants directs de chaque racine
> de domaine (API Drive, 13/09) : **683** fichiers libres, pas ~300 — et **475 sont dans
> `06 · Études`**. La table de routage actuelle n'en plaçait que **13 (1,9 %)**.
>
> ⚠️ **La campagne LLM approuvée n'aurait PAS marché, et elle n'a pas été lancée.** En `06`, toute
> la table est gatée sur l'identification de l'ÉCOLE. Mesure : **0 nom sur 475** porte un jeton
> d'établissement — et deux documents ont été LUS avant de chiffrer quoi que ce soit (« TP de sciences »,
> « Notes de cours ») : en-tête = prénoms d'élèves + date,
> corps = la matière, **aucun établissement non plus dans le contenu**. Les 475 × 0,0261 $ ≈ 12,4 $
> auraient rendu le même `null`. Le seul signal qui les rattacherait à une école est l'ANNÉE croisée
> au parcours de Marc (une suite d’établissements, du lycée à l’École d’ingénieurs A), que DriveAI ne connaît pas et ne doit
> pas deviner (§1).
>
> **Ce qui est livré** : `bucketTypeDomaine_` (PURE, `src/Reset.gs`) — un repli PAR TYPE vers un
> nœud **qui existe déjà** dans `STRUCTURE_CIBLE_RESET`, intercalé entre le repli par entité validée
> et la racine. Branché dans `sousCheminDomaine_`, donc UNE règle pour ses deux consommateurs (flux
> vivant + consolidation). Volontairement **hors** de `cheminCibleReset_`, qui sert aussi de garde
> par CAPACITÉ aux missions (« le flux fait autorité DANS 02 ») : lui apprendre à tout placer aurait
> tué les sorties inter-domaines, en silence. Deux nœuds ajoutés là où il y avait de la place :
> `09/Préparation & guides` et `04/Pièces d'identité` (INTERNE à 04, aucune sortie représentable).
> **209 des 683 placés — 95 % hors `06` — pour zéro appel LLM** (31 par la table, 178 par le repli).
>
> ⚠️ **Ce chiffre est un POTENTIEL mesuré sur corpus, PAS un effet en production.** Les 683 portent
> déjà une clé de SUCCÈS `conso|conso-3|<fileId>` posée avec « OK — racine du domaine », et la
> génération du plan de consolidation sort au premier `if` (campagne terminée 9/9 le 16/08). Rien de
> l'EXISTANT ne bougera tant que `CONFIG.CONSOLIDATION_TAG` n'est pas bumpé — **C28-90**, qui exige
> aussi de rendre à la consolidation son budget quotidien (2 min/j depuis C28-49) et de faire
> remonter dans la règle partagée les placements que les missions `03` calculent seules. C'est une
> décision du propriétaire sur le quota runtime. Ce qui prend effet IMMÉDIATEMENT : les **nouvelles
> arrivées** — la racine cesse de se remplir.
>
> **Revue flotte (3 agents en parallèle, avant merge) : 3 🔴 + 8 🟠 intégrés.** Les trois 🔴
> convergeaient : (1) aucun consommateur actif ne reverrait les 683 — le commit, l'ADR et ce
> document écrivaient « 198 placés » au passé accompli, corrigé partout ; (2) l'effet annoncé sur
> `04` était nul, parce que le seul mutateur autorisé dans la zone protégée (`reorganiserInterne04_`)
> résout sa cible par `cheminCibleReset_` et pas par le repli — la règle d'identité a donc été
> ajoutée DANS la table, sinon le nœud `04/Pièces d'identité` n'avait aucun producteur ; (3) le
> corpus ne mesurait que la population où tout déplacement est un gain (la racine), jamais les
> ~15 700 fichiers DÉJÀ rangés sur lesquels le repli agira vraiment. D'où **D8** : la cible du repli
> est marquée `faible`, et la consolidation refuse alors de déplacer un fichier déjà rangé. Mesuré
> avant la garde : 2 des 15 fichiers de `03/Logement/Logement A` partaient vers `Correspondance`.
> Plus 6 collisions de motifs reproductibles, et un bug de la table EXISTANTE : « saint-fictif »
> n'appariait rien depuis toujours (`normaliserCle_` conserve les traits d'union).
>
> **Reste ouvert** : C28-90 (le bump, décision du propriétaire) et C28-91 (l'audit sécurité signale que la
> fixture de 683 noms réels emporte dans git des données de santé identifiantes et des noms de tiers
> — aucun contenu, aucun identifiant, mais un commit est irréversible).
>
> **Reste à Marc (2 arbitrages, ADR-0052 D6/D7)** : `06` et `03` sont tous deux PLEINS à 7 nœuds,
> donc accueillir leurs 464 + 8 fichiers demande une décision de structure. Pour `06`, la revue
> flotte a proposé une **option C** qui a un précédent validé par Marc dans ce dépôt : une table
> `ANNEES_ECOLE` (une suite d’établissements, du lycée à l’École d’ingénieurs A), exactement comme les fenêtres d'occupation
> des logements (« regarde les dates pour déterminer », ADR-0040) — l'année du nom désigne l'école si
> et seulement si elle tombe dans UNE seule fenêtre, sinon refus. Zéro fichier déjà classé déplacé,
> aucun nœud ajouté. Tant que Marc n'a pas tranché, ces fichiers restent à plat et
> `test/racine-domaine.test.js` le CONSTATE (compteurs 464 et 8, chacun commenté avec sa décision)
> plutôt que de le masquer par une exception.
>
> **✅ TERMINÉ — 2026-09-12 : C28-84 / C28-85 (chantier #46), mergé en #336 et VÉRIFIÉ EN PROD.**
> Marc : « analyse tout et peaufine », puis « toutes les missions qui ont pas fini, finis-les ; pose
> des questions pour tout ». Trois audits en parallèle (app, moteur, sécurité) sur tout le dépôt,
> leurs correctifs, puis les 4 missions de rangement bloquées sur ~28 fichiers « non appariés ».
> **Ce qui a été DÉCIDÉ par Marc** (jamais deviné — les fichiers ont été lus dans Drive d'abord) :
> alias de bailleurs Gestionnaire A/Bailleur D → Logement A et Bailleur E → Logement C ; assurances et énergie rangées par
> ÉMETTEUR quand aucun logement n'est nommé ; 12 placements manuels par identité pour les documents
> sans signal (dont les 3 signatures notariales → `01/État civil & notarial`, PAS un nœud « Donation »
> dans 02, qui est plein 7/7) ; les paies restent dans `02 · Revenus & paie`.
> ⚠️ **Correction importante** : les 3 « paies en double » de Employeur A n'en étaient pas — ce sont
> trois semaines d'août. La vérification d'empreinte annoncée avant écartement est ce qui a évité de
> supprimer deux vraies paies ; l'option que ma question proposait était fausse.
> ⚠️ **Constat prod du 12/09** : 6 des sources « jetables » (4 véhicule, 2 logement) N'EXISTENT PLUS
> dans le Drive — Marc les a supprimées après que le moteur les a peintes en rouge. Sans le correctif
> « source disparue = source vide », le bump `c50-1` condamnait ces 2 missions à ne jamais converger.
> **Déploiement vérifié sur les DEUX cibles** : `deploy.yml` run #322 vert (clasp push + redéploiement
> de la web app + déclencheur réinstallé) et Vercel `dpl_CUJ5Xqf…` READY pour `8f48115`, alias
> `drive.exemple.com`. Et surtout le **signal INDÉPENDANT** (piège 3 : un run vert ne prouve pas que
> le tick exécute le nouveau code) — l'état lu par le MCP à 15:20, soit 5 minutes après :
> mission logements **terminé** (25/25, elle avait 10 non appariés), dispatch03 20/20 avec
> « +8 fichiers il y a 0 min » après 22 jours sans bouger, archives06 (139/139) et paies (10/10)
> réapparues, carrière 166/169 « +23 fichiers il y a 0 min », Index 18 462 → 18 504. Les règles c50-1
> tournent.
> **Reste ouvert** : 3 fichiers en carrière (dont les 2 illisibles — Marc doit dire à quoi ils
> correspondent) et tout C28-86. ⚠️ La mission paies porte encore une erreur du 19/08
> (« Cannot read properties of null ») : antérieure à ce chantier, à re-regarder si elle revient.
>
> **🎯 SUITE — 2026-09-10 : C28-83, l'app ne déborde plus sur téléphone (#335).** Marc : « la page
> agenda marche pas bien pour le tel, ça me fait dézoomer sinon je vois pas tout », puis « je dois
> slide à droite pour tout voir », dans les deux vues. DEUX défauts distincts, tous deux mesurés au
> navigateur avant/après (jamais déduits du code) : (a) la PAGE ENTIÈRE s'élargissait — une piste
> `1fr` vaut `minmax(auto, 1fr)`, donc un mot insécable (titre de tâche, nom de fichier, n° de police
> d'assurance) lui impose sa largeur min-content : 441 px pour 390 px d'écran, +67 px de débordement
> avec le réglage système « texte plus grand » ; corrigé par `minmax(0, 1fr)` sur `.colonnes` +
> `overflow-wrap: anywhere` sur `.contenu` ; (b) la grille de l'Agenda passait sous la barre
> d'onglets (40 à 119 px selon l'écran), deux défilements pour une seule journée ; corrigé par un
> en-tête plus dense (177 → 114 px, zones tactiles gardées ≥ 24 px) et une hauteur bornée à la place
> réellement disponible en `dvh`, avec un plancher pour le PAYSAGE. Deux garde-fous E2E téléphone
> prouvés par mutation. ⚠️ Leçon du jour, à ne pas perdre : **une capture d'écran à 2× fait lire des
> pixels d'image pour des pixels CSS** — mon premier diagnostic (« en-tête de 485 px ») était faux
> d'un facteur 2 et a été corrigé en mesurant dans le navigateur.
>
> **✅ CHANTIER TERMINÉ — 2026-09-09 (soir) : REFONTE APP v7 « le téléphone d'abord » (C28-82 / ADR-0051), en ligne.**
> Marc : « l'interface est pas du tout intuitive, trop de texte, trop de déchets, trop moche, pas
> assez simple, pas assez beau — refonte visuelle et utilitaire, parfaite pour téléphone et PC ».
> Diagnostic sur captures RÉELLES (mode mock, 390 px et 1 280 px — la CI ne photographiait qu'à
> 1 280 : l'heure sur trois lignes, le champ « Rec », l'agenda ouvert à minuit n'avaient jamais été
> vus) ; maquettes des cinq écrans publiées (artefact « Refonte DriveAI v7 »,
> https://claude.ai/code/artifact/<identifiant>) ; **4 réponses cliquées** :
> ambiance **B « Nuit »** (sombre nettoyé — PAS la recommandation A claire) · PC en **une colonne +
> rail** · accueil **comme aujourd'hui, en plus propre** · Moteur → **Réglages, 3 chiffres +
> « Avancé » replié**. Plan : six PR livrables seules (BACKLOG chantier refonte v7).
> **PR 0 (socle) livrée sur la branche** : coquille `App.tsx` (barre haute + onglets bas / rail +
> colonne 760 px), `Icone.tsx`, polices auto-hébergées (CSP `'self'`), `Sidebar`/`MiniCalendrier`
> supprimés (« Mes agendas » en puces + « + » dans l'Agenda), `Moteur.tsx` → `Reglages.tsx` + carte
> Compte (langue, synchro, hub, déconnexion, garde-fous), tokens v7, **captures CI à deux tailles**.
> **PR 1 (accueil + réglages) livrée dans la MÊME PR #331** — Marc, 21:50 : « encore trop de texte
> trop de blabla, quelques boutons simples qui fonctionnent, toutes les tâches finies à la poubelle ».
> Accueil = À faire (une ligne, un bouton) + Ma journée (si RDV) + Derniers classements ; Réglages =
> état + 3 chiffres + lignes + « Avancé » replié (fini/à jour/désactivé = ABSENT) ; tâches cochées
> cachées dans l'Agenda ; 10 paragraphes d'explication retirés. Revue flotte PR 0 intégrée (1 🟠 :
> les réglages langue/synchro/déconnexion rendus même sans données). Captures envoyées à Marc.
> Revue flotte PR 1 intégrée (1 🔴 : les chiffres de Réglages venaient de parseurs qui ne lisaient
> que le MOCK — le vrai onglet Santé écrit « Documents au catalogue (Index) : N » ; désormais
> `compteursIndex` sur l'Index — leçon : un test qui verrouille le format du mock ne prouve rien
> sur la prod ; 3 🟠 : ⏰ fenêtrés 7 j + « Fait » (`important-fait` dans l'Index, append-only),
> erreurs vraiment sur 7 j, tâches en retard gardées). **#331 MERGÉE (auto-merge, 22:07 UTC)** :
> socle + accueil + réglages sont dans `main` → Vercel. **PR 2 (Documents)** : un champ unique
> (nom OU contenu) + « IA », dossiers/fichiers en lignes, « + », ✨ ; sous-onglets et filtres
> d'Index retirés (`Recherche.tsx` supprimé) — **#332 en revue flotte**. **PR 3 (Agenda)** codée sur
> `wip/pr3` (locale, poussée après #332) : liste par jour sur téléphone, grille ouverte à 7 h, tâches
> en lignes. **PR 4 (Assistant)** codée sur `wip/pr4` : fil plein écran, propositions en cartes
> dans le fil, historique retiré, saisie collante. **#332 (PR 2) MERGÉE 22:22 UTC** (revue : 5 🟠
> intégrés). **PR 3 + PR 4 + PR 5 (nettoyage : 82 clés i18n, CSS mort, code mort, GUIDE.md, captures
> docs) poussées ensemble dans #333** ; revue flotte : 4 🟠 intégrés (‹ › en vue Liste avançaient de
> 3 jours sur une bande de 7 ; titre du jour sous la barre haute après un tap ; commentaire CSS non
> fermé laissé par la purge ; **une action validée que le moteur refuse/rate disparaissait sans
> trace** → `actionsRefuseesReorg`, ligne rouge jusqu'à « OK ») + 🟡 (reliquats `google.ts`, 8 règles
> CSS, en-têtes, GUIDE, README captures, test journée entière multi-jours). 252 tests. **#333 MERGÉE
> 22:45 UTC (auto-merge) ; déploiement Vercel de production `READY` 22:45:39 pour `3c43912`, alias
> `drive.exemple.com` — CHANTIER #45 TERMINÉ, les cinq écrans v7 sont en ligne.** Ce qui reste HORS
> périmètre v7 (non demandé) : les vues non réécrites
> gardent quelques `.explication` ; `qSousDossiers`/`decouperEnLots` (purs, testés) n'ont plus de
> consommateur ; `_Doublons` orphelins, C28-79/81/74/70/71, #315, Lot C inchangés.
> ⚠️ Règle de session : chaque PR part en brouillon, passe la revue flotte, puis SORT du brouillon
> (sinon elle ne merge jamais — #329).
>
> **🎯 CHANTIER PRÉCÉDENT (matin) — 2026-09-09 : « mes mails sont toujours pas triés ni archivés » (C28-80 / ADR-0050).**
> Comptage exhaustif des 50 premiers fils de la boîte (MCP Gmail, 13:20 UTC) : 21 non lus, 14 ⏰,
> 17 « À vérifier », 3 suspects — le tri POSAIT ses libellés, mais le seul cas archivable (lu +
> catégorisé + sans ⏰) était vide. Chaque règle était juste ; leur union couvrait 100 % du réel.
> Décisions Marc (questions groupées) : **un fil LU sort de la boîte**, ⏰ et « À vérifier » compris
> (ils deviennent des libellés — le libellé ⏰ est la liste de tâches, plus la boîte) ; non lus
> inchangés ; ⚠️ Suspect laissé en boîte (prudence, non contredit) ; vieux stock > 30 j repassé.
> Livré : `decisionTri_` (règle), `TRI_REGLES_VERSION = 'r2'` dans la clé `tri|fil|ts|lu|r2` (sans ça
> les ~90 fils déjà triés n'auraient JAMAIS été réévalués — leçon §9), `rearmerBoiteHistorique_`
> (nettoyage profond ré-armé par version, ancre re-posée). 62 tests tri (1 204 au total), 9 mutations
> attrapées, revue flotte avant merge.
> **➜ Prise d'effet : ✅ VÉRIFIÉE par signal indépendant.** Merge `63818ea` 13:45 UTC, `deploy.yml`
> vert 13:46, premier passage du nouveau code à **13:49 UTC** : la boîte est passée de **95 fils
> (23 non lus) à 87 (23 non lus)** en un seul passage — 8 fils lus archivés, 30 clés `r2` posées
> (le plafond `TRI_MAX_FILS_PAR_RUN`, Index 18 193 → 18 223), +7 catégorisations LLM. À la cadence
> observée (~30 min par passage, pas 5), la fenêtre 30 j finit de se vider en ~2 h ; le stock > 30 j
> suit au nettoyage profond (150 fils/jour). Cible : ~26 fils en boîte (non lus + suspects).
>
> **✅ PANNE OAuth HUBPERSO CLOSE (09/09 ~15:10 EDT) — la panne du 02→09/09 est finie.** Marc a reposé
> `DriveAI_HUBPERSO_CLIENT_SECRET` puis exécuté `lierCompteHubperso` (« ✅ Compte hubperso lié »).
> Vérifié par signal indépendant à 15:26 : `etat_moteur` rend `intentionsSuspendues: false`,
> `intentionsDetail` et `intentionsSonde` VIDES — lecture LIVE des Properties, pas l'onglet Santé
> (dont le texte reste celui du passage de 15:16 jusqu'à la prochaine réécriture : un instantané
> figé n'est pas un état, piège classique de cette ligne). Les intentions différées pendant la panne
> (clés `analyse|`, verdict déjà pris, zéro LLM à repayer) se créent au rattrapage.
> ⚠️ **Deux frictions vécues, à savoir avant de redire « pose la propriété »** : (1) le bouton
> « Ajouter une propriété de script » n'apparaît plus au-delà de ~50 propriétés — il faut passer par
> `PropertiesService.getScriptProperties().setProperty(...)` exécuté une fois depuis l'éditeur ;
> (2) sur téléphone, l'éditeur auto-ferme les accolades et duplique celles d'un collage
> (`SyntaxError: Unexpected token '}'`) — la parade est de coller UNIQUEMENT le corps entre les
> accolades déjà présentes du `function myFunction() { }` par défaut.

> **CHANTIER PRÉCÉDENT — 2026-09-07 : « ça trie toujours pas mes mails » + « plus de mail de récap »**
> **(C28-75, C28-76 / ADR-0049, C28-77).** Diagnostic par le MCP `etat_moteur` RELU le jour même (mon
> relevé précédent datait de 17 jours — il aurait fait conclure faux) : le moteur tourne, pose les
> libellés, mais **n'archive plus rien depuis six jours** — « mode DÉGRADÉ » parce que la création
> Tâches/Agenda est en panne (refresh OAuth hubperso en échec « transitoire » chaque jour depuis le
> 02/09) et que cette panne suspendait TOUTE l'analyse, donc la clé `important|` que le tri attend.
> Deux décisions du propriétaire (07/09) : **garder l'analyse, ne suspendre que la création** ; **couper TOUS
> les mails**. Livré dans une seule PR (trois lots, revue flotte AVANT push) :
> - **C28-75** — `CONFIG.MAILS_ACTIFS = false` : `resumeHebdo` inerte et `assurerTriggerResume_`
>   RETIRE le déclencheur existant (le tick le réinstallait derrière Marc). Les alertes étaient déjà
>   muettes depuis le 06/07.
> - **C28-76 (ADR-0049)** — une panne de config d'API ne suspend plus que la création. Mail actionnable
>   pendant la panne ⇒ DIFFÉRÉ (`analyse|<id>`, zéro LLM), repris à l'extraction au retour. Le tri
>   accepte `analyse|` comme verdict et archive normalement. Quota Gmail : différé = « vu » pendant la
>   panne, drapeau `DriveAI_INTENTIONS_RETARD` au retour (ferme aussi un trou préexistant du mur).
> - **C28-77** — la série d'échecs du refresh est mémorisée ; au-delà de 24 h, Santé dit « EN ÉCHEC
>   depuis N j (raison : invalid_client) » + consigne, au lieu de « momentanément ».
>
> **✅ PRISE D'EFFET DE #320 VÉRIFIÉE (07/09, signal indépendant — pas le run vert, piège 3).**
> Merge `b073ae7` à 20:43 UTC, `deploy.yml` vert à 20:44 (42 fichiers, web app `@123`, déclencheur
> réinstallé). Passage moteur suivant à **20:47 UTC** : la ligne Santé « Tri Gmail » dit désormais
> « ✅ normal (libellés + archivage) — la création Tâches/Agenda est suspendue … », la ligne API
> « création Tâches/Agenda suspendue (analyse et tri continuent, ADR-0049) ». Compteur `intentions`
> passé de 17 à 52 appels en un passage (35 mini-checks sous panne, +0,014 $). Côté boîte, lu par le
> MCP Gmail à 20:51 UTC : **15 fils lus archivés en rafale** dans ce passage (historyId contigus
> 4881502→4881851, fils du 02 au 06/09 restés en boîte pendant la panne) et ⏰ posé sur les fils
> jugés importants (une plateforme de location, un service d'enregistrement) — ceux-là restent en boîte PAR DESIGN (seul Marc
> archive un ⏰). Un compte « fils lus en boîte » ne mesure donc PAS l'archivage : mesurer la
> destination (fils archivés), jamais la source. Drainage du retard sous drapeau `c:<offset>`
> (10 pages / 200 inédits par run) : quelques ticks. **Confirmé au passage de 21:10 UTC** : les trois
> derniers fils lus sans ⏰ (un fabricant, un détaillant, un service financier) archivés, il ne reste en boîte que des
> fils ⏰ ou « À vérifier » (14, tous voulus). Et la sonde a capté la RAISON de l'échec OAuth dès ce
> tick : **`invalid_client`** — le client OAuth hubperso (ID/secret) n'est plus reconnu par Google.
> C28-77 dira « EN ÉCHEC depuis 1 j (invalid_client) » dans Santé à partir du 08/09 ~20:47 UTC.
> 🟡 **Cadence des ticks : passages espacés de 11 à 31 min depuis le déploiement, runs LONGS, cause
> NON établie (constat 22:35 UTC).** Passages OK : 20:47, 21:10, 21:21, 21:52, 22:21 UTC. Fait qui
> pèse : la télémétrie s'écrit à CHAQUE tick mais en toute fin du `finally`, derrière le garde-temps
> standard — elle a été SAUTÉE à 3 passages sur 5 (20:47, 21:10, 22:21), donc ces runs ont dépassé
> `CONFIG.BUDGET_MS` (4,5 min). Des runs de 4,5-6 min avec un déclencheur à 5 min ⇒ ticks sautés
> (« Run précédent encore actif », ligne INFO invisible au MCP) ou runs TUÉS au mur des 6 min.
> ⚠️ Correction d'une affirmation de #323 : « avant, ~5 min prouvée par la télémétrie » était FAUX —
> la télémétrie ne prouve rien sur la cadence d'avant, je n'ai AUCUNE mesure de la cadence
> pré-déploiement. Trois hypothèses, non départagées d'ici : (a) réglage app — `assurerIntervalleTick_`
> ré-applique `Réglages!B2` (5/10/15/30) au premier tick après que `deploy.yml` a réinstallé un 5 min,
> une cadence de 15-30 min serait alors VOULUE ; (b) travail de queue par design (réconciliation,
> BUDGET TAIL jusqu'au mur 4,5 min) + verrou ⇒ cadence effective 10 min, pas 30 ; (c) une étape
> rallongée par #320 (tri : le court-circuit `|deg` est levé hors panne, borné à 20 attentes/run —
> ne devrait pas coûter des minutes). Pas « bloqué » : les passages aboutissent, archivent,
> cataloguent (Index 18128 → 18144). La suspension config-api a expiré à 21:33 UTC et s'est
> RE-POSÉE à 21:51 (`invalid_client`) après une extraction de différé, comme prévu par ADR-0049.
> **Ce qui tranche, deux clics de Marc** : (1) éditeur Apps Script → « Exécutions » : durée des runs
> `tickDriveAI` et « Exceeded maximum execution time » ; (2) app → Moteur → Réglages (ou éditeur →
> Déclencheurs) : l'intervalle réellement installé.
> **3ᵉ contrôle (23:36 UTC) : rythme ~30 min identifié.** Passages OK : 20:47, 21:10, 21:21, 21:52,
> 22:21, 22:41, 23:11 UTC — depuis 21:21, des écarts de 29-31 min (et deux de 20). C'est la signature
> de l'hypothèse (a) : un déclencheur à 30 min, valeur admise par `validerTickMinutes_`, ré-appliqué
> depuis `Réglages!B2` au premier tick d'après-déploiement. [Probable] Les runs restent longs
> (télémétrie encore sautée à 23:11). Rien de perdu. Contrôles automatiques ARRÊTÉS : la confirmation
> est à Marc (app → Moteur → Réglages, ou éditeur → Déclencheurs). Si le réglage dit 5 min, alors
> l'hypothèse tombe et le panneau « Exécutions » redevient le seul juge.
>
> **✅ RIEN NE T'ATTEND** — la panne OAuth est CLOSE (secret reposé + `lierCompteHubperso` le 09/09,
> suspension levée vérifiée à 15:26), et C28-78 est tranchée : #314 ROUVERTE contre `main` (Marc,
> 09/09) — le brouillon est enfin un vrai frein à l'auto-merge, **dans `main` depuis 6871a68** ;
> #313 abandonnée (remplacée par #316) ; #315 non reprise, à rouvrir par `git cherry-pick -n e6430bc`
> si le quota Vercel redevient un sujet.
> ⚠️ **Conséquence immédiate, déjà vécue** : une PR ouverte en BROUILLON ne se fusionne plus toute
> seule — **#329 s'est bloquée elle-même**. Le run auto-merge #412 est sorti VERT en refusant :
> « PR #329 est en BROUILLON (isDraft=true) → auto-merge REFUSÉ ». J'avais écrit l'inverse (« elle
> sera la dernière à sortir du brouillon toute seule ») en me fiant à `on: workflow_run` = « lit la
> version de `main` » : le log prouve que le job a exécuté la version portée par la PR, alors que
> `main` portait encore `gh pr ready`. Sortie du brouillon puis mergée à la main.
> ➜ **Pour toute PR à venir** : la sortir du brouillon quand la CI est verte et la revue passée,
> sinon elle reste ouverte indéfiniment, sans rien de rouge nulle part.
>
> **Aussi appris ce jour** : la campagne `_Doublons` est **terminée** (22/08) — verdict définitif
> **19 ORPHELINS**, 1 054 confirmés, 3 indéterminés. « Tout rapatrier » porte donc sur 19 fichiers
> (chantier distinct, non entamé). Et mon alerte du 21/08 sur le plafond de 40 $ est **périmée** :
> le mois a tourné, compteur à 0,16 $ ; `Re-analyse v2 (c26-08)` n'apparaît plus dans les missions
> — à vérifier (finie ou coupée ?) avant d'y toucher, jamais déduit.

> **CHANTIER PRÉCÉDENT — C28-49 PR4 « Valider `_Doublons` par empreinte » (ADR-0047).**
> **#308 MERGÉE** (`294b270`), déployée, et **PRISE D'EFFET VÉRIFIÉE** par signal indépendant :
> la ligne Santé « Doublons (validation par empreinte) » existe et **progresse** — au 21/08 08:51,
> « balayage du Drive **2/2** — 1076 écartés inventoriés, 1054 déjà confirmés ». Le **1076**
> recoupe EXACTEMENT le comptage Drive fait à la main avant la livraison.
> ⚠️ **La campagne n'a PAS prononcé son verdict.** `ligneSanteDoublons_` affiche `passes + 1` :
> « 2/2 » veut dire *une* passe complète faite, la seconde EN COURS. Le mot « ORPHELINS » n'apparaît
> qu'en phase `PHASE_DOUBLONS_FINI` (« terminée ✅ … X confirmés, Y ORPHELINS, Z indéterminés »), et
> le code EXIGE deux passes complètes avant d'accorder le moindre orphelin — `files.list` étant
> paginé, une passe seule prononcerait sur une preuve d'absence trouée. Donc : **au plus 22
> candidats, aucun orphelin établi à ce jour.**
> **Ce que l'inventaire EXHAUSTIF du 2026-08-20 a montré :
> `_Doublons` contient 1 076 fichiers, et certains sont le SEUL exemplaire de leur contenu** —
> les 3 passeports de Marc y sont, de tailles DIFFÉRENTES (donc pas copies l'un de l'autre) ;
> le contenu d'un bulletin du Lycée A y est en double et n'existe nulle part ailleurs.
> Cause, lisible dans le code : `_empreintesCache` est un **ensemble** d'empreintes sans notion de
> lieu, donc `estDoublon_` répond à « déjà vu ? » et jamais à « encore là ? » — un fichier déjà
> indexé et re-présenté devient doublon de LUI-MÊME, et rien ne relit jamais `_Doublons`.
>
> La campagne `src/Doublons.gs` est **STRICTEMENT lecture seule** (tripwire de test : aucun
> `moveTo`, aucun renommage, aucun LLM). Elle rend un verdict par fichier — `confirmé` / `orphelin`
> / `indéterminé` — dans l'onglet `RapportDoublons`, à partir du `md5Checksum` de l'API Drive (et
> **pas** de l'Index, qui n'attache une empreinte à un fileId que pour certaines clés : une PJ Gmail
> y est invisible et son exemplaire classé aussi).
> **Elle ne rapatrie RIEN, et c'est délibéré** (ADR-0047 §4) : un orphelin n'a pas de cible
> calculable sans LLM, ce qui coûterait jusqu'à 28 $ — sur un cumul déjà à 12,28 $ — et passerait
> SOUS le frein budgétaire (l'intake de `00 · À trier` est du flux vivant, jamais gaté). Le livrable
> est le **compte exact**, pour que Marc décide avec le prix devant les yeux.
>
> ⚠️ **Deux mesures à connaître avant d'ajouter quoi que ce soit au tick.**
> (1) Le **registre de suivi C28-44 est SATURÉ** : 8 377 des 8 500 octets, 42 clés à ~199 — il reste
> 123 octets, une 43ᵉ étape le ferait déborder. La campagne se rend donc visible par une ligne
> **Santé**, pas par Progression (backlog C28-71).
> (2) L'**enveloppe reset-OFF passe de 60 à 63 min/j** pour un plafond de 65 : il ne reste que
> 2 min/j. `GMAIL_HISTO_BUDGET_JOUR_MS` (20 min/j) est le donneur évident mais sa fin n'est que
> « probable » — la prouver avant de réallouer (backlog C28-70).
>
> **Mesuré, donc PAS fait** : `_Technique` (398 fichiers) n'a **qu'un seul** nom documentaire, posé
> exprès par la règle D12 — aucune mission à y construire. `_Médias` (1 308 fichiers) : le nom n'y
> prouve rien (les `Relevé_Inconnu.mp4` sont des vidéos), mais **trois** fichiers démentent la
> promesse de C20-01 (fiscal ARC, deux pièces d'identité) → constat écrit, backlog C28-69.
>
> **➜ C28-72 — corrigé, et mon premier diagnostic était FAUX.** ⚠️ Cette section a affirmé que
> « le flux range en `01/<TYPE>`, la table en `Pièces d'identité/Marc` : deux règles qui divergent ».
> **Faux.** Le flux DÉLÈGUE à la table depuis ADR-0033 (`deciderRoutageV2_` étape 4, sous tripwire
> de convergence) — vérifié en EXÉCUTANT la règle sur les noms réels. Le vrai défaut était le
> **REPLI** (étape 5) : quand la table rend `null` — refus voulu, titulaire ni Marc ni autorité ni
> personne déclarée — le flux retombait sur un dossier de TYPE au niveau 1 du domaine. D'où
> `01 · Administratif/Permis de conduire`, créé le 12/08 pour un permis de tiers.
> Correctif livré : `repliIdentite_`, règle PARTAGÉE par le flux ET la consolidation, qui dégrade
> vers un nœud EXISTANT de `STRUCTURE_CIBLE_RESET` (`Pièces d'identité`, `Résidence permanente`,
> `Assurances santé`) — jamais un frère de niveau 1 invisible du plafond ≤ 7.
> ⚠️ **La revue flotte a trouvé que le correctif était INOPÉRANT sans un second geste** :
> `cheminCibleConsolidation_` calculait encore la cible par TYPE, et la consolidation est ACTIVE et
> auto-exécutante — elle aurait re-créé le nœud que la PR supprime, silencieusement, CI verte. Le
> cas « tiers non déclaré » est désormais dans le corpus des deux tripwires, avec sa garde
> anti-tautologie (on assert d'abord que la table REFUSE le nom).
> **La mission identité (PR3) peut donc bien réutiliser la règle du flux : celle-ci EST la table.**

> **➜ 👉 UN GESTE T'ATTEND — C28-73 est LIVRÉ, il ne manque qu'un clic.**
> Ouvre l'éditeur Apps Script → **`DocumentsID.gs`** → fonction **`drainerDocumentsID`** → Exécuter.
> Elle draine les 15 fichiers de `Documents ID` vers `Pièces d'identité` en les faisant passer par
> le pipeline (donc RENOMMÉS au format canonique). ~0,39 $, idempotente : la relancer ne re-traite
> rien. Elle écrit son bilan dans le **journal d'exécution de l'éditeur** (`Logger.log`) et dans la
> Sheet. ⚠️ **Compte 2 ou 3 clics, pas un** : sous Sonnet 2 passes, 15 documents prennent 5 à 7,5 min
> et un run est borné — relance jusqu'à lire « TERMINÉ ».
> ⚠️ **Ce que ça implique** : le contenu de ces 15 fichiers (2 NAS, 4 passeports, cartes d'identité,
> permis) sera lu par l'OCR puis envoyé à l'API Anthropic pour classement. Ils étaient hors
> arborescence, donc jamais lus jusqu'ici. C'est le transit qu'ADR-0007 assume pour tout document —
> mais tu as choisi une destination, pas un moyen, alors autant que ce soit dit.
> ✅ **DÉPLOYÉE** — #311 mergée (`e45788d`) et `deploy.yml` vert le 21/08 à 12:56 UTC, vérifié sur
> trois signaux : `src/DocumentsID.gs` figure NOMMÉMENT dans les 42 fichiers poussés ; la web app
> est redéployée `@113` ; et le champ `version` rendu par `assurer-trigger` (`5min|t5`) — qui
> n'existe QUE dans une version connaissant l'action — prouve que `/exec` sert le nouveau code et
> non l'ancien (piège 4). Ouvrir l'éditeur est par ailleurs le remède exact au piège 3.
> Pourquoi manuelle plutôt qu'automatique : le registre de suivi est SATURÉ (aucune 43ᵉ étape de
> tick possible) et l'enveloppe runtime est à 63/65 min/j. Une campagne de tick pour 15 fichiers
> one-shot consommerait les deux ressources les plus rares du moteur — pour un travail qui tient en
> deux ou trois clics.
>
> **⚠️ MESURE DU 21/08 — le plafond de 40 $ arrêtera c26-08 AVANT la fin, à ~74 documents du but.**
> Le plafond a été porté à 40 $ le 20/08 (§1.6) sur un coût unitaire **mesuré alors à 0,0261 $/doc**.
> Ce coût est aujourd'hui de **0,0361 $/doc — +38 %**. Trois routes indépendantes, dont un contrôle
> croisé exact :
> - ventilation : 6,52557 $ / (362 appels ÷ 2 par doc) = **0,0361 $/doc** ;
> - delta du mois : (17,27 − 10,70) $ / 181 docs = **0,0363 $/doc** ;
> - **recoupement** : le compteur d'APPELS (362 ÷ 2 = 181) et le compteur de PROGRESSION
>   (503 − 322 = 181) donnent le même nombre de documents. C'est ce qui valide l'hypothèse
>   « 2 appels par document » sur laquelle repose le calcul, et exclut les retries.
>
> Conséquence arithmétique : 40 − 17,27 = 22,73 $ de marge ⇒ **630 documents finançables** ⇒ le frein
> tombe à **1 133 / 1 207**, soit **74 documents avant la fin**. Finir les 704 restants demanderait
> **25,38 $**, donc un plafond d'environ **43 $**.
> ⚠️ Et l'app continuera d'afficher « ~7 j · vers le 27/08 » : une projection extrapole le PASSÉ et
> ne peut pas connaître un blocage FUTUR (leçon C28-47). Le garde ne supprime la projection que
> lorsque le statut est DÉJÀ `suspendu|en pause`. La campagne s'arrêtera donc un ou deux jours avant
> la date affichée, et « en pause » se lira comme un état normal.
> **Décision du propriétaire** (le plafond vit dans `Config.gs`, §1.6) : relever à ~43 $ pour finir c26-08,
> ou laisser le frein faire son office et terminer en septembre. Rien n'a été touché.

> **➜ CHANTIER — C28-73, drainage de `Documents ID` (ADR-0048).** Décisions du propriétaire du
> 20/08 obtenues (4 questions). Le fait qui commande la conception, mesuré AVANT tout code : les 15
> noms hérités ne sont pas canoniques, donc `cheminCibleConsolidation_` les cible à la **racine de
> `01`** — un simple déplacement vers `Pièces d'identité/Marc` serait défait au tick suivant par la
> consolidation, et les passeports finiraient à plat. Le drainage passe donc par `traiterDocument_`
> (renommage + classement), avec `ignorerDoublon: true` obligatoire. ~0,39 $. `NAS` se livre en même
> temps, des DEUX côtés (types + table).
>
> **`_Doublons` : le propriétaire a choisi « tout rapatrier, quel que soit le prix ».** Le compte réel change
> l'ordre de grandeur — **1 076 inventoriés, 1 054 confirmés**, donc **au plus 22 candidats**, soit
> moins d'un euro et non les 28 $ annoncés. ⚠️ **« Candidats », pas « orphelins »** : la campagne en
> est à sa 2ᵉ passe et n'a rien prononcé (cf. plus haut). Ne pas chiffrer le rapatriement sur 22
> avant de lire la ligne « terminée ✅ » — c'est exactement la faute que §1.6 documente (« ne pas
> déclarer une campagne finie sans lire son compteur »).

> **🎯 CHANTIER PRÉCÉDENT — C28-62 « Affinage des non-appariés » (ADR-0044) : TERMINÉ.**
> Les 4 PR sont mergées (#300, #304, #305) et **#307** (C28-65) l'est aussi, déployé à 15:32 EDT.
> ⚠️ **L'effet de #305 et #307 n'est PAS encore observable en prod** : toutes les missions sont
> « en pause — budget du jour épuisé » depuis 12:28 EDT, soit trois heures AVANT le merge. À
> vérifier à la reprise de demain par signal Drive indépendant — jamais au déploiement vert
> (piège 3). Compteurs du 20/08 : véhicules **57/57**, archives scolaires **131/131**,
> employeurs & CV **114**, logements 25/35, dossiers-années 2/26.
> Marc : « y'en a beaucoup en attente d'affinage, pose-moi des questions » → **12 décisions**
> (ADR-0044), découpées en 4 PR. **PR1 (#300) et PR2 (#304) sont MERGÉES *et* VÉRIFIÉES EN PROD**
> par signal indépendant Drive le 2026-08-20 (pas par un déploiement vert — piège 3) :
> `Véhicule/À attribuer` créé à 15:44, `Locations` a reçu les 3 contrats d'un loueur à 16:21, les
> **deux** dossiers `Marque K` sont vides ; les **7 `Relevé_Employeur B`** sont arrivés dans
> `02/Revenus & paie/Employeur B` à 16:29-16:30, et `05/Recherche d'emploi` **se REMPLIT** (offre
> d'emploi + invitation d'entretien) au lieu de se vider — c'était le risque du geste symétrique.
> PR3 (décision 6) et PR4 (décision 7) ont été livrées dans **#305**, mergée.
>
> **⚠️ Ce que PR4 a coûté en revue, à connaître avant d'y toucher.** Deux revues indépendantes ont
> trouvé qu'un `Avis d'imposition_SCI SCI A` **quittait `02 · Finances` pour `05 · Carrière`** sur le
> seul jeton « mric », à clé de SUCCÈS donc définitivement. Correctif : `routerFinance02_` a
> **deux étages et l'ORDRE est la règle** — (1) le FLUX fait autorité dans 02, (2) sortie
> inter-domaines ; sinon refus keyé. Le repli local a été mesuré MORT (0 cas sur 11) et retiré. Une garde
> par LISTE de types réservés a été écrite puis JETÉE (elle ratait ce cas même). Et le « tripwire de
> convergence » livré au premier jet était **TAUTOLOGIQUE** (il comparait `cheminCibleReset_` avec
> elle-même) : remplacé par un verrou d'ORDRE. Leçons consignées (CLAUDE.md §9).
>
> **⚠️ DEUX RÉPONSES DE MARC QUI INTERAGISSENT — à trancher avant de coder.** Le 20/08 il a demandé
> (a) de **fondre « Reçus & factures » dans « Relevés »** pour libérer un nœud dans `02` (qui est
> PLEIN à 7) et (b) d'y ranger la `Note de frais_Prénom NOM`. Or (a) fait **disparaître** la
> cible de (b). Lecture cohérente proposée : faire (a) d'abord, puis (b) vise le nouvel emplacement.
> ⚠️ (a) n'est PAS un changement de règle mais une **réorganisation de masse** (déplacement de
> fichiers déjà classés, `IDS.recusFactures02`, buckets d'année, table + flux + mission) : à
> séquencer avec Marc, jamais en effet de bord d'une PR de routage.
>
> **Autres gestes en attente de Marc** : (1) les **4 fichiers sur l'appartement** (échanges avec le
> propriétaire) que PR1 a déplacés vers `Véhicule/Recherche & achat` — ils y
> étaient déjà mal rangés à la SOURCE et la règle « le dossier source fait foi » a rendu l'erreur
> définitive ; décision du propriétaire : les remettre dans `03/Correspondance`. (2) `Bailleur F` =
> **Logement A** (réponse du propriétaire) : l'ajouter à `MISSIONS_BAILLEURS` range son DPA *et* ses 2
> formulaires de demande de location.

>
> **CHANTIER PRÉCÉDENT — C28-49 « Missions de curation » (brief Marc 2026-08-17, ADR-0039).**
> Marc a spécifié le rangement FIN dossier par dossier (véhicules, logements, archives scolaires,
> employeurs, paies, impôts, identité, _Technique/_Médias/_Doublons, vrac des racines) et veut
> UNE MISSION PAR TÂCHE, visible dans l'app avec l'avancement réel, et les dossiers vidés peints
> en ROUGE pour choisir lui-même ce qu'il supprime (le moteur ne supprime JAMAIS, §2). Ses trois
> réponses d'arbitrage : (1) rouge = oui ; (2) paies = « je n'ai absolument pas toutes les
> paies » + un sous-dossier PAR EMPLOYEUR (⇒ domicile UNIQUE `02/Revenus & paie/<Employeur>` +
> rapport des mois MANQUANTS — PR2) ; (3) identité = permis + passeport + « tout ce que tu
> pourras trouver d'autre » (PR3, 04 · Immigration = PROPOSITIONS seulement, jamais déplacé).
> **PR1 ✅ (#278, mergée + déployée le 17/08, signal indépendant vérifié)** ; **PR2 livrée**
> (paies par employeur + RapportPaies des mois manquants, carrière/employeurs, dossiers-années 02,
> impôts par année — 4 missions de plus sur le MÊME budget partagé, ordre = priorité). Revue
> flotte PR2 (2 rondes + passe finale code-reviewer/structure-keeper) appliquée : convergenceApres,
> sourcesJetables, errC séparé, RapportPaies borné, geste SYMÉTRIQUE sur la table du flux (paie →
> `Revenus & paie/<emp>`, fiscal → `Impôts/<AAAA>`, nœud « Recherche d'emploi » RETIRÉ + verrou
> d'absence), `anneePlausible_` UNIFIÉE (1990-2100, les deux bornes testées), borne ≤ 7 des
> employeurs CODÉE, TAXONOMY.md réaligné. La MÊME PR livre **C28-50** (retour Marc du 17/08 sur la
> page Moteur de l'app) : les missions convergées à reliquat (« à jour (N non apparié(s)) »)
> restent EN AVANT au lieu de disparaître dans la veille repliée — c'était la réponse à « je ne
> vois pas toutes les missions » — + note précise du reliquat, interrupteur « Masquer les finis »,
> erreurs du Journal repliées par défaut. **INCIDENT flux Gmail (14-17/08, diagnostiqué le 17 au soir)** : API Tasks jamais activée
> dans le projet GCP par défaut CACHÉ → intentions suspendues → TRI mort par ricochet (il attend
> `intention|` par fil) — l'intake PJ, lui, marche (talon Employeur A classé en 25 min). Correctif
> **C28-52 PR1 (ADR-0041, décision Marc corrigée le soir : « le projet HUBPERSO seulement »)** :
> Tasks/Calendar + sonde passent par un jeton OAuth du PROJET HUBPERSO (`JetonHubperso.gs` —
> consentement unique, refresh token en Script Properties, échec fermé, scopes du manifeste
> INCHANGÉS ; renommage intégral jobai→hubperso livré AVANT toute liaison). ⚠️ Reprise =
> **geste Marc une fois** : suivre `docs/HUBPERSO.md` (client OAuth Web dans hubperso,
> 2 Properties, `lierCompteHubperso`, 1 clic de consentement) — la sonde lève ensuite la
> suspension TOUTE SEULE
> (≤ 13 min) et le tri Gmail repart avec les intentions. **Liaison FAITE par Marc le 19/08 vers 14:20**
> (« ✅ Compte hubperso lié »), après deux correctifs trouvés au PREMIER usage réel : `doGet` ne
> recevait jamais le marqueur `hubperso=1` (Google n'ajoute que `code`+`state` — #289), puis la
> sonde restait `indetermine (Tasks) — HTTP 400` parce qu'un identifiant sondé UNIQUE servait aux
> deux API (valide en base32hex pour Calendar, impossible en base64url pour Tasks) : verdict
> stérile ⇒ **reprise RAPIDE (≤ 13 min) supprimée en silence** (la suspension finissait par
> expirer d'elle-même après 24 h — jamais un blocage éternel, mais une reprise tardive et à
> l'aveugle, avec un message Santé PÉRIMÉ entre-temps). Corrigé (un identifiant PAR API + le
> POURQUOI persisté + la cause démentie remplacée, seulement par une RÉPONSE d'API et jamais par
> un 401). ✅ **VÉRIFIÉ EN PROD le 19/08 15:38** (PR #291 déployée à 15:37) : Santé affiche
> « API Tasks & Calendar : ✅ actives (sondées le 19/08 15:38) », `intentionsSuspendues:false`,
> et le **tri Gmail est reparti** (`tri_cyclique_fils_jour` 0 → 20 dans le tick suivant). Les DEUX
> API répondent 404 — le verdict `active` l'exige — donc Tasks ET Calendar sont bien activées dans
> hubperso, ce que l'état d'avant le correctif ne permettait pas de conclure. La suspension s'est
> levée SEULE, sans geste de Marc, comme prévu. Le rappel automatique (Routine
> `<identifiant>`) a été SUPPRIMÉ (liaison faite).** **C28-53 (ADR-0042) — MCP DriveAI** (demande Marc 2026-08-19 « je
> veux un mcp ») : connecteur claude.ai servi par le Vercel existant (`api/mcp/*`, OAuth 2.1 porté
> du patron FinanceAI éprouvé), 6 outils derrière un 3ᵉ secret `DriveAI_MCP_SECRET`/`MCP_ENGINE_SECRET`
> (`src/Mcp.gs` : état moteur+missions+erreurs+mail+panne LLM, recherche/lecture, question, réorg
> proposée, intentions). Revue flotte PR1 appliquée (injection formule Sheets neutralisée dans
> `parserActionsChat_` — ferme chat ET MCP ; anti-saturation Property ; `versionMcp` sur exception ;
> en-tête « pouvoir réel »). Geste Marc : `docs/MCP.md` (2 clés Vercel + secret partagé + connecteur
> claude.ai). PR2 (passerelle Vercel) EN REVUE flotte au moment du handover — pas encore poussée.
> **C28-51 (ADR-0040)** enchaîné le soir même sur le
> retour « je peux rien y faire » : les 89 non-appariés diagnostiqués sur PREUVES (bails nommés
> par BAILLEUR — Personne A = NEQ-A = Bailleur A → Logement A ; NEQ-B → Logement C —, Marque K sans cible,
> pluriels 03 encore dans la table du flux) → c49-2 : tables canoniques bailleurs/véhicules,
> catégories PAR véhicule (décision Marc), fenêtres de possession, drainage du double Bailleur A, geste
> symétrique 03. Au déploiement, le bump ré-évalue TOUS les refus keyés. Incident
> attrapé au merge de PR1 : dispatch de Deploy avalé par un 503 (#279 le durcit — retry + run
> rouge sur échec final ; un 503 jumeau sur `gh pr view` a ensuite tué l'automerge de #281 —
> durcissement généralisé à TOUTES les commandes gh, mergé). Socle PR1 : 4 missions 03/06 (`mission-vehicule`,
> `mission-logement`, `mission-dispatch-03`, `mission-archives-06`) — budget 10 min/j RÉALLOUÉ de
> la conso-gen terminée (couple 12 min verrouillé), idempotence versionnée, convergence sur passe
> vide, appariement par jetons + fenêtres de dates (ambigu = laissé + rapporté, jamais deviné),
> re-pointage du référentiel d'entités à la convergence d'archives-06. PR2-PR4 : voir BACKLOG
> C28-49 et les tâches #38-40. IDs des dossiers épinglés dans `CONFIG.MISSIONS_IDS` (recon du
> 17/08). NB : Marc a déjà supprimé lui-même les dossiers vides + `_TRI 2026` + l'ancien dossier
> `Employeur B` (contenu déversé à la racine de 05 — la mission Carrière PR2 le re-range).
>
> **⚠️ TOUJOURS BLOQUÉ CÔTÉ MARC — API Google Tasks NON ACTIVÉE (depuis le 14/08).** La sonde
> C28-48 tourne et CONFIRME toutes les 13 min : `desactivee (Tasks)`, projet GCP **(numéro non reproduit ici)**
> (lien d'activation affiché dans l'onglet `Santé`). Les intentions mail (tâches/RDV depuis les
> mails) sont gelées tant que Marc n'a pas cliqué « ACTIVER » — Calendar sera sondée dans la
> foulée (la sonde s'arrête à la première API refusée). Le mécanisme C28-48 s'est validé en prod :
> suspension rafraîchie par sonde confirmante (affiche « depuis 17/08 09:41 », pas 14/08),
> verdict de dernière sonde visible, reprise automatique ≤ 13 min après activation.
>
> **📊 ÉTAT PROD — rafraîchi au 2026-08-17 09:42 (lu sur la DONNÉE)** : consolidation TERMINÉE
> (exec 2620/2620, gen 9/9 le 16/08) ; Index **15 706** docs (+615 en 3 j) ; vrac `08 · Perso`
> 998 → **798** puis PLAT depuis le 16 (le drain s'est arrêté avec la conso — c'est la mission
> « vrac des racines » PR3 qui prendra le relais) ; `06 · Études` figé à 447 ; coût LLM du mois
> **10,43 $** (frein campagnes toujours actif). Instantané précédent (14/08), gardé pour la
> traçabilité :** (1) **La ré-analyse c26-08 est BLOQUÉE** à 322/1207 (27 %) : coût LLM du mois
> **10,22 $** > frein campagnes **10 $** (`LLM_BUDGET_CAMPAGNES`, redescendu de 110 le 01/08 par la
> checklist ADR-0018) ⇒ pas de reprise avant le 1er septembre sauf décision du propriétaire. (2) **Le vrac
> baisse enfin** : `08 · Perso` 998 → **839** (−159 en un jour) ; la consolidation draine
> (`consolidation-exec` 2221/2221 « à jour », `consolidation-gen` 6/9 en pause budget du jour).
> (3) **C28-44/45/46 confirmés EN PROD sur la donnée** : en-tête 11 colonnes (`K1 = Type`), types
> remplis, activité au format `dd/MM HH:mm`, statuts polis (« à jour (déjà fait) », « désactivée »,
> « à jour (plan drainé — attend la génération) »).
>
> **📧 GMAIL — inventaire complet (2026-08-14).** 4 mécanismes ACTIFS, aucun interrupteur ON/OFF
> Gmail : intake PJ (`traiterGmail_`), tri de boîte (`trierFilsGmail_`), intentions
> (`traiterIntentionsMail_`), historique PJ (`traiterGmailHistorique_`). Écritures limitées à
> « poser un libellé EXISTANT » + « archiver » (verrou CI `surface-gmail-ecriture`, 9 motifs ;
> corbeille/spam/création-retrait de libellé/REST interdits à jamais). Campagnes : historique PJ
> finit sur « 2 passes complètes sans rien collecter » ; scan cyclique du tri = PERPÉTUEL par
> conception (état mutable) ; nettoyage profond de boîte finit sur 2 passes sans activité.
> **DEUX POINTS OUVERTS** : (a) **intentions EN ERREUR depuis le 14/08 07:51** — « config-api
> Calendar » ⇒ aucune tâche/RDV créée depuis les mails tant que ça dure (suspension propre +
> re-sonde ; cause à trouver — tâche dédiée) ; (b) **historique Gmail probablement TERMINÉ**
> (absent de Progression, 0 fil/j) mais NON confirmé — ses **20 min/j** resteraient immobilisées
> pour rien (tâche dédiée : confirmer par signal indépendant PUIS réallouer, jamais augmenter).
>
> **🚧 EN COURS AU 2026-08-13 (soir) — C28-45 : polish du suivi (retour Marc, captures à l'appui).**
> Marc : « tellement de trucs en cours mais rien n'est fini, aucun indicateur d'où ça en est,
> aucun indicateur si ça bloque d'autres tâches, c'est vraiment pas peaufiné ». Quatre reproches
> fondés + 2 gloses FAUSSES sur ses captures (pause « budget du jour » de conso-gen glosée frein
> LLM ; dé-quarantaine « déjà fait » en rouge-suspendu). Implémenté (moteur + app, une PR,
> transition tolérante — en revue flotte) : colonne `Type` (K, append) publiée par le moteur pour
> que l'app COMPACTE les ~25 routines (« ✓ N routines en bonne santé », dépliable — seules les
> anormales remontent) ; `Dernière activité` en TEXTE contrôlé `dd/MM HH:mm` (la cellule Date
> ressortait « 8/13/2026 » SANS heure en FORMATTED_VALUE) + « il y a X min » côté app (`ilYA`,
> pur, passage d'année géré) ; statut conso-exec « à jour (plan drainé — attend la génération) »
> au lieu de « en cours · 100 % » + note de dépendance ; famille `ajour` neutre-positive ; gates
> CONFIG des dry-runs (« désactivée » au lieu d'« en cours » à vide) ; gloses budget du JOUR /
> budget de TICK / frein LLM désormais distinctes. 897 moteur + 181 app + build verts.
>
> **✨ ITÉRATIONS PRODUIT AU 2026-08-13 SOIR — C28-45 (#273, mergée) et C28-46 (en cours) : le
> suivi devient LISIBLE, sur retours directs de Marc (captures).** C28-45 : colonne `Type` (K),
> « Dernière activité » en texte contrôlé `dd/MM HH:mm` (une cellule Date sortait sans l'heure en
> FORMATTED_VALUE), conso-exec « à jour (plan drainé — attend la génération) » au lieu de « en
> cours · 100 % », « déjà fait » plus jamais rouge, dry-runs OFF → « désactivée », gloses budget du
> JOUR ≠ frein LLM (deux gloses FAUSSES sur captures corrigées) ; revue : 2 vraies prises (plage
> `A2:K` sans laquelle le compactage était mort ; max lexicographique jour-major faux en début de
> mois). C28-46 (demande : « seulement l'utile, regrouper l'inactif, cliquable, cachable, barres à
> progrès réels ») : tri par UTILITÉ (`estUtileProgression`, PURE — problèmes/complétions/progrès
> réels visibles ; à jour/désactivée/jamais vue/routines sans compteur → groupe VEILLE replié,
> choix mémorisé localStorage, explication par tâche au CLIC ; barre indéterminée restreinte au
> recensement). `<details open>` CONTRÔLÉ (state+onToggle — sinon le re-render du poll 15 s
> refermait le groupe sous la souris).
>
> **🚧 CHANTIER CLOS AU 2026-08-13 — C28-44 : suivi GÉNÉRIQUE et fiable de toutes les
> opérations du tick (ADR-0038, plan product-manager en 5 PRs).** Demande Marc : « je veux que ça
> marche pour tout type de tâche que l'app fait et je veux que ce soit beaucoup plus fiable » — le
> suivi (onglet `Progression`) était codé en dur pour 6 campagnes alors que le tick exécute ~34
> étapes ; aucune fraîcheur par opération (impossible de distinguer « en cours » de « gelé ») ;
> erreurs par étape invisibles de l'app ; l'app lit une plage FIGÉE `A2:G30`. **PR1 LIVRÉE** :
> fondations PURES non branchées (`src/Suivi.gs` : registre de 34 étapes, wrapper `etapeSuivie_`
> — gates ordonnées, erreur vue AVANT les catch custom, re-levée identitaire sinon — codec Property
> `DriveAI_SUIVI_OPS` borné) + ADR-0038 + 16 tests. Deux prises RÉELLES de la boucle
> test/revue AVANT tout déploiement : (1) le test au plafond DÉRIVÉ a attrapé mes troncatures
> initiales (60/40 → 9 751 octets > limite ~9 Ko ; resserrées à 40/28) ; (2) la revue
> apps-script-quota a attrapé l'ÉCHAPPEMENT JSON qui faussait ce même plafond (`"`/`\`/contrôles
> pèsent 2-6 caractères une fois échappés → neutralisation `suiviTexte_` + filet dur au flush +
> test re-dérivé, prouvés par mutation). **PR2 LIVRÉE** : les 34 étapes de `tickDriveAI` wrappées
> (gates NOMMÉES aux prédicats identiques — verrouillées au caractère près + unicité —, catchs
> custom préservés verbatim, étapes NUES de l'intake re-levées à identité d'objet, bloc R2 conservé
> avec `else` de 19 skips enregistrés, gate `dequarantaine` anti-throw, flush EN DERNIER du
> finally). Revue flotte ×3 : apps-script-quota 🟢 (équivalence des gates vérifiée + confirmation
> git qu'aucun prédicat I/O n'a migré d'un try vers une gate ; a exigé le tripwire d'APPARTENANCE
> au bloc R2 — fait, mutation-prouvé par déplacement réel d'une étape), code-reviewer 🟢 (a exigé :
> fenêtre anti-`if` inline sur les invariants négatifs reset/reorg, unicité des définitions de
> gates, ordre registre=wraps sans `.sort()` — faits), file-checker 🟢 (intake strictement intact,
> ordre C28-15 préservé ; résiduel assumé : une gate qui lève sort sans trace, trou PRÉ-existant
> documenté — durcissement optionnel plus tard). Les tripwires d'orchestration historiques
> convertis vers `gatesDe(cle)` : RENFORCÉS, pas affaiblis. **PR3 LIVRÉE** : l'onglet `Progression`
> itère le REGISTRE (une ligne par opération, ordre d'exécution) — 7→10 colonnes avec `Horodaté`
> MAINTENU en G (l'app v6 qui lit `A2:G30` continue de lire exactement les 7 mêmes colonnes
> pendant la transition, consommateurs indexés 0-6 valides tels quels) ; migration d'en-tête sur
> la DERNIÈRE colonne (`J1`), chemin atteignable (majProgressions_ chaque tick), SANS effacer les
> lignes v2 (7 premières colonnes identiques) ; les 6 campagnes riches gardent leurs statuts
> historiques, tout le reste dérive de `statutDepuisSuivi_` (dernier événement gagne, erreur
> prioritaire à égalité). Revue flotte : quota 🟢 (5/5, migration auto-réparante), code-reviewer
> 🟠→🟢 (vraie prise : `indexOf('budget') === 0` ratait « frein budget campagnes » → famille
> « suspendu » glosée « panne » par l'app pour un simple frein — corrigé en `!== -1` + test ; ADR
> réaligné ; nit « — » pendouillant corrigé ; coordonnées d'en-tête assertées). ⚠️ Transitoire
> jusqu'à PR4 : l'app v6 affiche les ~23 nouvelles lignes avec une pastille NEUTRE (statuts
> `erreur`/`jamais vue`/`désactivée` inconnus de `familleStatut`) — une op en erreur paraît « en
> cours » dans l'APP (l'onglet Sheet, lui, dit vrai) → merger PR4 rapidement. **PR4 LIVRÉE** :
> l'app lit la plage OUVERTE `A2:J` (fin de la borne `A2:G30` — leçon §7), interprète les
> 10 colonnes (TOLÉRANTE aux 7 anciennes), familles de statut étendues (`erreur` → pastille
> critique, `jamais vue`/`désactivée` → neutres), la RAISON EXACTE du skip publiée par le moteur
> PRIME sur les gloses génériques (avec la glose-consigne en plus quand elle est reconnaissable —
> quota/panne/budget), « Dernière activité » et « Dernière erreur » (rouge) affichées par
> opération, les opérations sans compteur n'affichent ni compte ni barre (exception :
> `recensement` garde sa barre indéterminée — revue). Revue code-reviewer 🟢 (2 suggestions 🟡
> intégrées). 180 tests app + build + 897 moteur. **CHANTIER CLOS (PR5 = clôture)** : la moitié
> « compteurs du jour du flux vivant » de la PR5 est ABANDONNÉE par décision documentée (ADR-0038
> §2f) — les jauges Télémétrie affichent DÉJÀ ces compteurs avec leurs plafonds sur la MÊME page
> Moteur ; recopier = duplication de surface, et l'intake n'a pas de compteur quotidien (en créer
> = le « comptage parallèle » que le plan interdisait). BACKLOG C28-44 → ✅ (#268/#269/#270/#271).
> **VÉRIFICATION PROD RESTANTE (self-serve, prochain check)** : lire l'onglet `Progression` réel
> après quelques ticks — en-tête 10 colonnes (`J1 = Dernière erreur`), ~34 lignes, raisons de skip
> plausibles — la seule preuve qui compte est la DONNÉE réelle post-merge, jamais le diff (§7). *(Anciennes notes PR3 ci-dessous conservées pour trace : )* PR3 (rendu Sheet 7→10
> colonnes, migration d'en-tête sur chemin ATTEIGNABLE — `assurerEnteteProgression_` teste
> `A1==='Clé'`, vrai avant/après : tester la DERNIÈRE colonne), PR4 (app : plage OUVERTE `A2:J`,
> rendu générique, fraîcheur/erreur/skip, tolérance colonnes absentes), PR5 (flux vivant via les
> accumulateurs Télémétrie — jamais un comptage parallèle — + docs vivants).
>
> **⚙️ ÉTAT AU 2026-08-13 — Vercel Pro : `maxDuration` épinglé + budget hub-summary
> ajusté (gain modeste, pas une résolution).** Marc a pris Vercel Pro. `GET /api/hub/summary` a un
> incident réel et déjà documenté : ~27 timeouts sur 3 semaines (« aborted due to timeout »), causés
> par des réveils à froid (cold start) de la web app Apps Script parfois > 4,8 s. L'ancien
> `TIMEOUT_MS = 8000` était plafonné par le mur Hobby implicite (~10 s). Épinglé explicitement
> `maxDuration: 20` (`vercel.json`, bloc `functions` — la bonne convention pour un projet SANS
> framework Next.js, `export const maxDuration` étant une convention Next.js inerte ici) et remonté
> `TIMEOUT_MS` à 8700. **Mais le vrai goulot reste ailleurs** : le hub (exemple.com, un AUTRE
> dépôt hors de portée de cette session) abandonne lui-même côté client à 9 s — au-delà, peu importe
> le budget DriveAI, le hub a déjà renoncé. Gain réel : marge modeste (~700 ms), PAS une résolution
> complète — celle-ci exige de relever aussi le budget du hub, dans son propre dépôt. Revue
> code-reviewer 🟡→🟢 (1 commentaire périmé corrigé, ailleurs dans le même fichier). 18/18 tests
> (`app/test/hub-summary.test.ts`).
>
> **Vercel Pro — ce qui a été vérifié/tenté et le résultat.** (1) Aucun geste manuel requis pour le
> déploiement moteur/trigger (déjà automatisé, ADR-0032, re-confirmé). (2) Protection des previews
> par MOT DE PASSE tentée → refusée par l'API (« Advanced Deployment Protection n'est pas activée »),
> un add-on payant SÉPARÉ de Pro, non achetable via les outils MCP disponibles (seul `siem` l'est) —
> à faire par Marc directement dans le dashboard Vercel s'il le souhaite vraiment. **Mais la
> protection SSO Vercel (gratuite) est DÉJÀ active** sur tous les déploiements sauf le domaine custom
> `drive.exemple.com` — les previews `*.vercel.app` exigent déjà une connexion au compte Vercel de
> Marc pour être vues. Un mot de passe n'apporterait de valeur que pour partager un lien preview avec
> quelqu'un HORS de ce compte.
>
> **🩹 ÉTAT AU 2026-08-13 — CORRECTIF #2 : la réparation de l'en-tête `Erreur`
> (colonne E de `HistoriqueVrac`) ne s'exécutait JAMAIS en prod.** Trouvé en vérifiant les données
> RÉELLES juste après le merge du correctif #1 ci-dessous (self-serve, lecture directe du Sheet) :
> l'en-tête était toujours à 4 colonnes malgré le correctif. Cause : la réparation vivait dans
> `initialiserSheet_` (Journal.gs), qui n'est appelée QUE (a) à la création initiale de la Sheet
> d'état, ou (b) via `feuille_(nom)` seulement si l'onglet nommé est ABSENT — or `HistoriqueVrac`
> existe déjà en prod depuis PR #263, donc ce chemin ne se déclenche jamais pour lui. Code mort.
> Déplacé dans `majHistoriqueVrac_` (HistoriqueVrac.gs), le SEUL endroit qui écrit réellement dans
> cet onglet à chaque tick où il y a quelque chose à écrire — chemin confirmé atteignable (les
> lignes du 12 et du 13/08 viennent d'être écrites par ce même chemin). Revue flotte 🟢🟢 (apps-
> script-quota + code-reviewer). 871 tests. **Leçon** : une réparation d'en-tête promise « comme
> `Index!H1` » doit être vérifiée sur le MÊME critère qu'`Index!H1` — être sur un chemin qui
> s'exécute VRAIMENT, pas juste être présente dans le diff.
>
> **🩹 ÉTAT AU 2026-08-13 — CORRECTIF #1 : erreur de lecture Drive ≠ vrai zéro dans le
> vrac.** Confirmé en prod le jour même en lisant `HistoriqueVrac` (self-serve) : `06 · Études &
> diplômes` avait inscrit **0** le 2026-08-12, alors que ce domaine contenait **≥400 fichiers réels**
> observés la veille par pagination Drive directe. Cause : `compterVracRacineDomaine_`
> (Diagnostic.gs) avalait toute exception et rendait `{n:0, tronque:false}` — indistinguable d'un
> domaine réellement vide, et ce faux 0 s'écrivait pour TOUJOURS dans `HistoriqueVrac`
> (append-only, jamais réécrit contrairement à `Progression`/`Santé`). Corrigé : la fonction rend
> désormais `{n, tronque, erreur}` ; le diagnostic un-clic affiche « ERREUR DE LECTURE » au lieu
> d'un chiffre pour ce domaine (exclu de `totalVrac`) ; `HistoriqueVrac` gagne une 5ᵉ colonne
> `Erreur` et laisse `Vrac` VIDE (jamais `0`) quand `erreur:true` — un domaine en erreur n'interrompt
> pas la sweep quotidienne des autres domaines. 869 tests.
>
> **Données réelles au 2026-08-13** (2 jours accumulés, trop tôt pour une tendance) : la plupart des
> domaines sont stables (01, 02, 04, 05, 07, 09 inchangés), `03 · Logement` +1, `08 · Perso` (~998
> fichiers, le plus gros) +2 — **le vrac ne baisse encore nulle part**, à surveiller sur plus de
> jours avant de conclure.
>
> **Rappel déploiement (re-confirmé aujourd'hui) : AUCUN geste manuel de Marc.** `deploy.yml`
> (ADR-0032/C28-43) redéploie le code, la web app ET réinstalle le déclencheur automatiquement à
> CHAQUE merge sur `main`, vérifié par signal indépendant (champ `version` de la réponse). Le run
> déclenché par le merge de PR #264 l'a reconfirmé (« Déclencheur réinstallé — version servie :
> 5min|t4 »). Seule exception structurelle (contrainte Google, pas une lacune) : l'ajout d'un
> NOUVEAU scope OAuth exige une ré-autorisation interactive que la CI ne peut pas scripter — Marc en
> serait prévenu avant le merge le cas échéant.
>
> **📈 ÉTAT AU 2026-08-12 — JOURNAL QUOTIDIEN DU VRAC PAR DOMAINE.** Marc : « pour
> chaque dossier je veux un détail journalier de l'avancement jusqu'à la fin ». Nouveau
> `src/HistoriqueVrac.gs` : sweep QUOTIDIENNE (Property de garde, une seule fois/jour, curseur de
> domaine reprenable si le budget coupe), compte le vrac de CHAQUE domaine (réutilise
> `compterVracRacineDomaine_`, Diagnostic.gs) et APPEND une ligne par domaine à un nouvel onglet
> `HistoriqueVrac` (`[Date, Domaine, Vrac, Tronqué]`, jamais réécrit — c'est la série temporelle
> elle-même, contrairement à `Progression`/`Santé` qui se réécrivent chaque tick). Tourne MÊME
> pendant un reset (aucune mutation, zéro conflit avec « une seule main déplace »). Câblé dans le
> `finally` du tick (Main.gs), budget TAIL (I/O pur, jamais de LLM). **Revue flotte AVANT merge,
> intégrée** : apps-script-quota 🔴→🟢 a trouvé un bug RÉEL — ma première version SÉPARAIT la
> sélection des domaines (pure, aucune I/O) de leur comptage (le vrai travail Drive), donc le
> garde-temps de 2 min ne coupait JAMAIS réellement : soit 0 domaine, soit TOUS d'un coup sans
> coupure — risque concret sur `08 · Perso` (~1000 fichiers) juste avant la libération du
> LockService (mur dur 6 min). Corrigé : le garde-temps est vérifié AVANT CHAQUE domaine, DANS la
> même boucle que le comptage (patron déjà correct de `etatCampagnesRangement`, Diagnostic.gs) ;
> `trancheHistoriqueVrac_` supprimée, remplacée par `ligneHistoriqueVrac_` (formatage pur d'UNE
> ligne). Ajouté aussi : budget QUOTIDIEN persisté (`budgetJourHistoriqueVrac_`, 4 min/j — comme
> les autres campagnes, un plafond par RUN ne borne pas la journée si la sweep doit reprendre sur
> plusieurs ticks) — compté dans l'enveloppe reset-OFF (60 min/j ≤ 65, prouvé par mutation).
> **Démarre à partir d'AUJOURD'HUI** — aucune donnée rétroactive possible (pas de machine à remonter
> le temps sur le Drive) ; la tendance jour par jour deviendra utile après quelques jours
> d'accumulation. 867 tests.
> Reste à Marc, comme toujours : redéployer (`Main.gs → installerTrigger`) pour que la 1ʳᵉ sweep
> tourne dès le prochain tick.
>
> **🔭 ÉTAT AU 2026-08-12 — OBSERVABILITÉ SELF-SERVE : la consolidation rejoint l'onglet
> `Progression`, plus besoin que Marc copie-colle un diagnostic.** Marc (« je veux rien avoir à faire à
> la main, tu devrais pouvoir voir toi ») avait raison de pousser : `read_file_content` (Drive MCP) SAIT
> lire la Sheet d'état en lecture seule — mais les gros onglets (`PlanConsolidation` 1236+ lignes,
> `Index`) sont TRONQUÉS par cet outil (seules les ~356 premières lignes, les plus ANCIENNES, jamais les
> plus récentes) ; le petit onglet clé/valeur ("Santé") passe intact et a révélé un piège : « Rangement
> ancien Drive : terminé ✅ » parle de `rangementTermine_()` (l'ANCIENNE campagne R3, close depuis des
> semaines) — **PAS** de la consolidation en cours (`conso-3`, qui draine encore `08 · Perso`, 996
> fichiers à plat). Un statut mal lu aurait annoncé à tort « c'est fini ». Correctif DURABLE : `conso-gen`
> et `conso-exec` rejoignent `Progression` (Journal.gs, `majProgressions_`/`lignesProgression_`) — MÊME
> patron qu'existant (une seule écriture Sheet/tick, déjà budgétée, zéro coût supplémentaire), MÊMES
> lectures que `etatCampagnesRangement` (domaines épuisés/total, curseur/total lignes du plan,
> `resetEnCours_()`, budget du jour épuisé) — gardes DÉDIÉES (`statutConsolidation_`, jamais le frein LLM
> `$`, jamais `estPannePlateforme_` : la conso est de l'I/O pur `moveTo`/hash, pas des appels Sonnet).
> `Progression` est un petit onglet TOUJOURS lisible en entier (jamais tronqué) → je peux désormais lire
> l'état de la consolidation MOI-MÊME, à tout moment, sans que Marc touche à quoi que ce soit. **Revue
> flotte AVANT merge, intégrée** : apps-script-quota 🟠→🟢 (une version antérieure appelait
> `indexContient_` par domaine à CHAQUE tick sans court-circuit — une fois la génération finie, ce
> calcul devenait le SEUL déclencheur restant de `chargerIndexCache_` [scan >10 800 lignes] ; corrigé
> par le MÊME court-circuit « déjà fini → ne relis plus rien » que `genererPlanConsolidation_`) ;
> code-reviewer 🟠→🟢 (le curseur d'exécution omettait le `− 1`, n° de ligne physique vs lignes de
> données — sans ça, Progression et le diagnostic un-clic auraient affiché des chiffres DIFFÉRENTS
> pour la même réalité). 858 tests. Reste HORS de portée sans Marc (Script Properties, aucune API ne
> les expose) : le détail ms du budget quotidien consommé — mais ce n'est plus nécessaire pour
> répondre « ça avance ou c'est bloqué ? ».
>
> **🟢 ÉTAT AU 2026-08-11 — DRAINAGE CONFIRMÉ (diagnostic prod) + ACCÉLÉRÉ ×2 par RÉALLOCATION sûre.**
> Marc a déployé (`installerTrigger` le 09/08, PR #259 mergée) puis exécuté `etatCampagnesRangement` le 11/08. Verdict
> **CERTAIN** (lecture de l'état DÉPLOYÉ, plus l'index Drive qui retarde) : **pas de deadlock** (`resetEnCours_()=false`) ;
> génération conso **5/9 domaines épuisés** (01-05), reste 06/07/08/09 ; exec **budget jour 6/6 ÉPUISÉ** (draine à fond),
> **1086/1236 lignes** appliquées (525 déplacements). **PREUVE du drainage : `05·Carrière` 155 → 26 fichiers à plat.**
> (Ma note du 06/08 « n'avance pas » était vraie ALORS — le fix n'était pas encore déployé ; une fois déployé, ça draine.)
> **Reste surtout `08·Perso` = 996 fichiers à plat** (pas encore examiné par la génération) + `06·Études` 155 ; les autres
> domaines sont bas (01=7, 03=15, 05=26, 07=11, 09=35 ; 04=18 protégé ; 02=0). **Le goulot = l'EXÉCUTEUR** (6 min/j
> épuisé) ; la génération est idle-throttlée par la contre-pression (2,3/12). Donc le levier de débit = l'exec.
> **ACCÉLÉRATION (décision Marc « accélère, réalloc sûre ») :** `CONSOLIDATION_EXEC_BUDGET_JOUR_MS` **6 → 12 min/j**,
> les +6 min PRIS sur `FUSION_EXEC_BUDGET_JOUR_MS` (parké **6 → 0**, campagne OFF, gate `!FUSION_EXEC_ACTIF` en tête) ⇒
> **enveloppe reset-OFF INCHANGÉE (56 min/j ≤ 65**, invariant `orchestration.test.js`, **prouvé par mutation** : exec→30
> casse le test). RÉALLOCATION, jamais AUGMENTATION (leçon §7 / C28-29 = gel de TOUS les déclencheurs). ⚠ **À la
> RÉACTIVATION de la fusion** (#47) : remettre 6 à `FUSION_EXEC` **ET** redescendre `CONSOLIDATION_EXEC` à 6. **Reste à
> Marc** : (1) **redéployer** (`Main.gs → installerTrigger`) pour charger le nouveau budget ; (2) re-`etatCampagnesRangement`
> dans quelques jours → 05 doit rester bas et 08 commencer à descendre. **Levier ×N de plus, SI besoin** : réallouer
> `GMAIL_HISTO` (20 min) **si** la campagne historique est finie — à CONFIRMER d'abord (étendre le diagnostic au histo,
> ne jamais affamer une campagne encore active). Revue flotte AVANT merge (apps-script-quota 🟢 +
> code-reviewer 🟢) : enveloppe INCHANGÉE prouvée par mutation + verrou du COUPLE exec↔fusion (=12 min,
> ferme le trou near-gel 62 que l'agrégat ≤65 ne voit pas) + interdit « campagne active à budget 0 ». 854 tests.
>
> **🔎 ÉTAT AU 2026-08-06 (superseded — voir 2026-08-11) — RE-CHECK DU DRAIN : il n'avance PAS ; je livre le VRAI diagnostic un-clic.**
> Re-sondage du Drive réel (aujourd'hui, `list_recent_files` + noms réels de `05·Carrière`). **Le moteur VIT**
> (heartbeat Sheet 15:31 ; 2 PJ Smartcar auto-classées à 14:29 avec noms propres → intake OK). **MAIS le drain du
> legacy dans `05·Carrière` N'AVANCE PAS** : la racine 05 garde **~150 fichiers GELÉS depuis le 27/07** (aucun
> `modifiedTime` du 5–6/08), dont **~30–40 `Lettre de motivation`** (règle `Reset.gs:333` → `CV & lettres`) et une
> pile de **`Paie_Employeur A`** (`Employeur A` = entité VALIDÉE → `Employeurs/Employeur A`). Ils DEVRAIENT bouger et ne bougent
> pas. Donc la note du 2026-08-05 « la consolidation DRAINE (prouvé) » était **TROP OPTIMISTE** — corrigée ici :
> le drain est **incomplet et non visiblement progressif** depuis la levée du deadlock. **Cause de l'incertitude
> récurrente** : la fonction `diagnosticRangement2` que je citais **n'a JAMAIS été commitée** — chaque « check »
> retombait sur l'index de recherche Drive (qui RETARDE) → verdict incertain. **Correctif à la racine (ce commit)** :
> `src/Diagnostic.gs` → **`etatCampagnesRangement()`** — VRAI diagnostic un-clic LECTURE SEULE (zéro mutation, zéro
> budget consommé) qui dump reset / conso génération (tag fini ? budget jour, domaines épuisés) / conso exec
> (curseur, plan par action, RESTE à appliquer) + comptage du vrac par racine de domaine. **Hypothèse la plus
> probable** (à trancher par la fonction) : la génération `conso-3` (tag fraîchement bumpé ⇒ re-hachage total, MD5 =
> goulot, 12 min/j) **n'a pas encore atteint 05** ; l'accélérateur **#258** (réutilise l'empreinte connue au lieu de
> re-hacher) est **mergé mais PAS déployé** (piège 3). **Reste à Marc — UNE session éditeur** : (1) `Main.gs` →
> `installerTrigger` → Exécuter (charge #258 + le diagnostic) ; (2) `Diagnostic.gs` → `etatCampagnesRangement` →
> Exécuter → me coller le journal → il dira « lent (arrive à 05) » vs « bloqué » de façon CERTAINE. NE PAS ré-activer
> le reset ; NE PAS cranker les budgets conso (marge de gel FINE, C28-29). Revue flotte 🟢/🟢
> (apps-script-quota + code-reviewer) intégrée : émission défensive par section, lecture STRICTE
> `getSheetByName` (rien créé), unités alignées. 853 tests.
>
> **✅ ÉTAT AU 2026-08-05 (CORRIGÉ le 2026-08-06, voir note du jour) — deadlock levé ; drainage NON confirmé.** Marc a
> exécuté `installerTrigger` (~17:49 UTC) → le code frais (RESET_ACTIF=false) a chargé. Diagnostic un-clic
> `diagnosticRangement2` (lecture seule, donné en chat, NON commité) : `resetEnCours_()=false`,
> `CONSOLIDATION_ACTIF/EXEC_ACTIF=true`, `CONSO_TAG=conso-3`, budget conso du jour consommé
> (`DriveAI_CONSO_JOUR=…|720672` ≈ 12 min), exec drainé (curseur 137/136 lignes). **Preuve du drainage** :
> `05·Carrière/CV & lettres` (id Drive) contient **~60 CV/lettres CORRECTEMENT rangés** — la conso
> route bien 05 dans ses buckets. La racine 05 garde ~141 fichiers à plat : **reliquat en cours de
> drainage PACÉ** (12 min/j de budget), pas un bug — mon estimation antérieure « backlog jamais drainé »
> était FAUSSE (audit `cheminCibleReset_` sur 100 noms réels : 87 routent vers un bucket, ils bougeront).
> L'ancien code (reset) re-gonflait les racines aujourd'hui (`RESET_RASS_JOUR=…|1200218` = 20 min) AVANT
> le clic → 05 était monté 116→141 ; reset OFF, ça draine net. **Reste à Marc** : (1) NE PAS ré-activer le
> reset (RESET_ACTIF reste false) ; (2) laisser tourner ~1-3 j (drainage pacé) ; (3) le « trop de
> DOSSIERS » = doublons de dossiers (#47 fusion : `Employeur A` racine vs `Employeurs/Employeur A`, `Alternance`
> ×4…) → `genererPlanFusion` + curer `PlanFusion` + `FUSION_EXEC_ACTIF`. **⚠️ NE PAS cranker les budgets
> conso** pour accélérer : l'enveloppe reset-OFF est déjà à ~56 min/j (invariant plafond 65,
> `orchestration.test.js`) + socle ~20 → marge FINE au mur ~90 (leçon C28-29, gel). **Piste durable
> ouverte** : automatiser le reload post-`clasp push` (`clasp run installerTrigger` dans `deploy.yml`)
> pour que le piège 3 ne se reproduise plus (nécessite l'API Apps Script activée — à confirmer avec Marc).
> **À VÉRIFIER dans 1 j** : re-sonder la racine 05 (doit être &lt; 141, idéalement bien moins) ; si ça
> PLAFONNE, alors bug de débit à creuser (§8).
>
> **⚡⚡⚡⚡⚡⚡⚡⚡ ÉTAT AU 2026-08-05 (suite) — CHANTIER #47 PR2 : EXÉCUTION DE LA FUSION (ADR-0037).**
> Décision Marc « fais tout toi ». **`src/FusionExec.gs`** applique le `PlanFusion` curé : chaque ligne
> SOURCE `Fusionner` fond les FICHIERS DIRECTS du dossier dans la CIBLE de son groupe. **GATÉ OFF**
> (`FUSION_EXEC_ACTIF=false`) : ne bouge un seul fichier qu'au feu vert de Marc. `moveTo` seule mutation
> (verrou de surface). Garde-fous hérités de `ConsolidationExec` + §2.1b : 04 INTERNE (source ET cible
> re-vérifiées sous 04, échec-fermé), multi-parents jamais déplacés, zone protégée hors-04 jamais détachée,
> ancre STRUCTURELLE refusée en SOURCE (sauf dédup de même nom) ET jamais cible de re-pointage, entités
> re-pointées (C21-06), coquilles vides → `vide-candidat` (app), idempotent par ID, borné/reprenable,
> branché APRÈS la consolidation, gaté `!resetEnCours_()`. **Revue flotte 4 spécialistes AVANT merge,
> intégrée** : security-auditor 🟢 conforme ; + garde source structurelle à la mutation (structure-keeper),
> convergence sur move en échec + tests orchestrateur (code-reviewer), stall ≥cap + invariant d'enveloppe
> C28-42 prouvé par mutation (quota/sécurité). **844 tests.** Reste à Marc : déployer, générer/curer le
> plan (PR1), puis allumer `FUSION_EXEC_ACTIF`. Détails ADR-0037.
>
> **⚡⚡⚡⚡⚡⚡⚡⚡ ÉTAT AU 2026-08-05 (suite) — CHANTIER #47 PR1 : FUSION DES DOSSIERS EN DOUBLE (ADR-0036).**
> Sondage post-incident du Drive réel (MCP + diagnostic un-clic exhaustif) : zones critiques SAINES
> (`00·À trier` vide, `00·À vérifier` vide = §2 tient, `_Doublons` normal) MAIS pollution structurelle :
> **83 dossiers en trop / 37 clusters** de doublons-synonymes d'entités (organisme d'immigration 1×5, organisme d'immigration 2×2, IUT A
> éclaté ×10, Employeur A/Employeur A Inc., dossiers de banque VIDES à retirer…) + 181/353 sous-dossiers sans
> fichier direct. Décision Marc : « dry-run de fusion que je valide ». **PR1 livrée (dry-run SEUL, ZÉRO
> mutation)** : `src/Fusion.gs` — `genererPlanFusion` un-clic écrit l'onglet `PlanFusion` (clustering PUR
> union-find : clé canonique + jetons + acronyme commun ; cible = dossier au plus de fichiers ; Action
> défaut `À VALIDER`). RADAR à **faux positifs assumés** (IUT B ≠ IUT A, groupés par « IUT ») →
> Marc CURE la colonne Action LIGNE PAR LIGNE. Verrou de surface « zéro mutation dans Fusion.gs ».
> **Revue flotte intégrée** (code-reviewer ✅ ; apps-script-quota : garde-temps par sous-dossier, purge
> crash-safe, message honnête ; structure-keeper : (1) **veto millésime** `anneesDistinctes_` en tête de
> `dossiersLies_` — `Modèle D an 1` ≠ `2017`, sinon la clé canonique les fondait car `canoniserVehicule_`
> retire l'année ; (2) **ancre structurelle non vidable** — `cibleFusion_` garde un bucket du reset comme
> cible, `lignesPlanFusion_` écarte l'ancre-source `Ignorer (structurel)`). **819 tests**. **PR2 (à venir)** :
> `appliquerPlanFusion_` gardé (moveTo seul, match STRICT `Fusionner` par ligne source, 04 INTERNE §2.1b,
> §1 + multi-parents par mutation, **re-pointage `Entités.Dossier ID` C21-06**, cible = nom canonique,
> coordination `reorganiserInterne04_`, vide-candidat) — détails dans ADR-0036 §4.
>
> **⚡⚡⚡⚡⚡⚡⚡⚡ ÉTAT AU 2026-08-05 — INCIDENT « RANGEMENT BLOQUÉ » (ADR-0035).** Marc : « ça fait
> plusieurs jours, tri 2026 = 5 dossiers vides, nouvelle structure encore en vrac, ça marche pas ».
> Diagnostic (Drive réel + fonction un-clic + 2 investigations) : **DEADLOCK structurel**. Le reset
> (ADR-0030) ne converge JAMAIS sur un Drive vivant — le rassemblement re-collecte chaque intake ⇒
> `examines` jamais 0 ⇒ `resetEnCours_()` true à vie ⇒ **la consolidation (seul re-rangeur des racines
> de domaine) suspendue à vie** ⇒ **305 fichiers legacy à plat** non re-rangés (05·Carrière 116, 08 102,
> 06 42, 09 32…) + doublons d'entité (Employeur A : 4 lignes, `Dossier ID` vide → `estValidee_` false →
> re-point mort). Décision Marc : **« applique directement »**. Fix (ADR-0035) : `RESET_ACTIF=false`
> (casse le deadlock, la conso + histo/migration/réanalyse/réconciliation reprennent) + bump
> `CONSOLIDATION_TAG conso-2→conso-3` (purge le plan périmé, re-évalue tout sous `t4` → les 305
> deviennent des « Déplacer », `moveTo` seul, cible `cheminCibleReset_` partagée = zéro ping-pong, §2
> intact). Tripwire de valeur `RESET_ACTIF===false` + « ne pas rallumer sans drapeau domaine-épuisé ».
> **Suivi** : réparer l'onglet Entités (statut lu comme date) + fusionner les dossiers Employeur A en double.
> 802 tests. Frontière : Claude ne déploie pas — Marc merge/déploie, ça draine sur quelques ticks.
>
> **⚡⚡⚡⚡⚡⚡⚡⚡ ÉTAT AU 2026-08-01 — CHANTIER #44 : AUDIT DE FOND + correctifs par VAGUES.**
> Marc : « analyse approfondie pour empêcher tous les bugs, lags, faux positifs… enchaîne tout
> jusqu'à la fin ». 6 agents en parallèle → ~40 trouvailles. Décisions cliquées : rangement UNIFIER
> (flux vivant = structure validée, conso coupée) ; coût OPTIMISER (2ᵉ passe conditionnelle + cache) ;
> alertes tout dans l'app (pas de mail). **Vagues 1a/1b/1app MERGÉES** (#239/#240/#241) : prompt chat
> réparé, auto-merge sécurisé (fork rejeté), reset honore l'épinglage + converge sur fichier empoisonné
> (`ecarterEchecMutationReset_` + `tentes`), « Inconnu » éradiqué du nom, passeport accepté, panne
> réseau comptée ; **app** : page Moteur honnête (Journal `A2:D` — plus « 0 erreur » à tort), chat
> survit au F5, double-clic gardé, accueil rafraîchi, dédup clés reset (`cleEtatIndex`+`statutLisible`),
> agendas reprise sur erreur. **Vague 2 ✅ (#242, perf/anti-gel)** : `chargerIndexCache_` A+G (payload
> ÷3,5), scan PJ Gmail mur « page à jour » **+ filet `DriveAI_GMAIL_PJ_RETARD`** (revue `apps-script-quota`
> 🔴 : sans lui le backlog des pages 1+ était perdu après reprise post-panne/rafale — mur désactivé tant
> qu'un backlog est possible, drainage complet puis reprise ; mutation prouvée) **+ I/O Property de ce
> filet enveloppée** (revue `code-reviewer` 🟡 : `traiterGmail_` appelé nu dans l'intake, un blip Property
> aurait avorté le tick — dégrade sans throw), trace horaire durée du tick.
> **Vague 3a ✅ (#243, coût)** : prompt caching du prompt SYSTÈME v2 + comptabilité étendue aux tokens
> cache (budget §2.6 honnête) ; gain honnête ~8-16 % campagnes / ≈ nul flux épars (revue `llm-cost-optimizer`).
> **Vague 3b ✅ (#244, UNIFICATION)** — le gros morceau : le flux vivant ET la consolidation DÉLÈGUENT
> leur sous-chemin à `cheminCibleReset_` (comme le reset) → convergence prouvée sur 20 docs réels
> (100 %→0 divergence), tripwires flux↔reset + flux↔conso. 2 revues flotte (régression 2027→Archives
> évitée ; **04 range en interne — RATIFIÉ Marc**, jamais de sortie de 04). **Vague 3c ✅** : frein
> budget `LLM_BUDGET_CAMPAGNES` **110→10** (#245, cruise), re-pointage entités périmées (#245, dédup
> run-scope réelle après revue), **few-shot v2 câblé** (#246 — les corrections de Marc atteignent enfin
> le classement live), **2ᵉ passe conditionnelle** (#247, ADR-0034 — gate `passe1SuffisammentSure_`
> **flag OFF**, garde §2 auto-suffisante ; activation subordonnée à un dry-run 1↔2 passes présenté à Marc).
> **CHANTIER #44 CLÔTURÉ.** 772 tests. Reste seulement des non-bloquants (BACKLOG « Reliquat »).
> ⚠ Chaque merge moteur : le pilote CI ré-installe le déclencheur seul.
>
> **SUITE #44 — DRY-RUN COMPARAISON 1↔2 PASSES LIVRÉ (ADR-0034 §5).** La preuve promise par le #247
> existe : interrupteur DÉDIÉ `CONFIG.DRYRUN_CMP_ACTIF` (OFF) qui, allumé, rejoue **les deux passes**
> sur l'échantillon réel du dry-run et écrit l'onglet **`DryRunV2Compare`** — par doc : gate
> (sauterait la passe 2 ?), placement 1 passe vs 2 passes, champs corrigés, et surtout les **faux
> négatifs `sensible`** (passe 1 `false` → passe 2 `true`, mesurés SÉPARÉMENT car `sensible` ne route
> pas → invisible côté placement) + un **verdict** (`saut sûr` / `SAUT RISQUÉ — placement changé` /
> `SAUT RISQUÉ — sensible raté` / `2 passes`). ZÉRO mutation (tripwire DryRunV2.gs inchangé), coût
> Sonnet ×2/doc sous le frein `LLM_BUDGET_CAMPAGNES`, clé `dryruncmp|<tag>|fileId`, convergence
> `DriveAI_DRYRUNCMP`. Logique PURE testée (`test/comparaison-passes.test.js`). **802 tests.**
> **Revue flotte AVANT merge (4 spécialistes), 0 🔴, correctifs intégrés** : 🟠 panne plateforme
> mid-tick jamais imputée au doc (`if estPannePlateforme_ → rien marqué` + break, leçon §7) ;
> 🟠 passe 2 muette ≠ « saut sûr » (verdict `non concluant`, `p2` brut exposé) ; 🟠 GAIN mesuré
> (snapshot inter-passes → colonnes « Coût passe 1/2 », gain réel = Σ coût p2 des sautés / Σ total,
> jamais le « −50 % » nominal) ; 🟠 `validees` passé aux deux plans (une correction d'entité compte
> comme placement changé) ; 🟡 agrégat de synthèse au convergence (taux avec bons dénominateurs,
> leçon §7), `routageHorsDomaine` dans champs divergents, tripwire anti-`UrlFetchApp`. Le flag prod
> `ANALYSE_V2_2E_PASSE_CONDITIONNELLE` reste OFF : Marc allume `DRYRUN_CMP_ACTIF`, lit la synthèse +
> `DryRunV2Compare`, et n'active la 2ᵉ passe que si `SAUT RISQUÉ` (placement ET sensible, parmi les
> SAUTÉS) est négligeable (§8). Reste condition d'allumage : le filet déterministe `toucheZoneProtegee_`
> dans le gate (ADR-0034 §5-3), à livrer AVEC l'activation ; et vérifier la marge du frein avant lancer.
>
> **⚡⚡⚡⚡⚡⚡⚡ ÉTAT AU 2026-07-31 (nuit) — C28-43 : LE PILOTE CI (ADR-0032) — Marc ne lance PLUS RIEN.**
> Marc : « je veux plus jamais avoir à lancer à la main, je veux que TU fasses le lancement
> `lancerResetTout`, et que ça marche encore plus vite que si je le faisais à la main ». Deux gestes
> restaient, et le second était AUSSI le plafond de vitesse : `installerTrigger` après chaque merge
> moteur, et `lancerResetTout()` (une exécution MANUELLE porte le drapeau `manuel` — ni gatée ni
> comptée, car hors du quota des DÉCLENCHEURS ~90 min/j : seuls ses clics dépassaient les 50 min/j
> du tick). **GitHub Actions devient le pilote**, par le canal `/exec` déjà prouvé (miroir Drive,
> 140 runs verts, secrets déjà posés — ZÉRO configuration pour Marc). Livré : action
> `assurer-trigger` (appelée par `deploy.yml` après `clasp deploy`, confirmée par un signal
> INDÉPENDANT `version` — ferme le piège (3) « clasp push vert ≠ code pris en effet ») ; action
> `pousser-reset` → `pousserResetPilote_` (4 phases dont la passe LLM du reliquat, mode `manuel`,
> mur 3,5 min, verrou partagé, arrêt sur `pilotageTermineReset_()` = I/O **ET** reliquat drainé).
> ⚠️ INVARIANT VITAL (testé) : le travail est exécuté SYNCHRONEMENT dans le `doPost` — passer par
> `actionTickPonctuel_` (qui CRÉE un déclencheur) consommerait le quota que tout ce montage
> protège. Workflow `pousser-reset.yml` : cron */15, 2 passes, **pause 6 min > TICK_MINUTES** (la
> fenêtre de tick garantie = ce qui empêche d'affamer le flux vivant), arrêt seul à convergence,
> dépôt PUBLIC (minutes Actions gratuites — vérifié).
> **⚠️ REVUE FLOTTE (🔴 sécurité, 🟠 quotas) — 5 BLOQUANTS corrigés avant merge, et le PARI requalifié.**
> Le pari « runtime de web app hors du quota des déclencheurs » est un **INDICE, pas une mesure** :
> le précédent C28-33 prouve seulement que des compteurs INTERNES bridaient à tort le chemin manuel,
> et **CLAUDE.md §6bis (#235, mergé le même jour) tient ce quota pour PARTAGÉ**. D'où trois filets :
> `PILOTE_BUDGET_JOUR_MS` **30 min/j** (borne la casse si le pari est faux), **détecteur de gel**
> (ticks muets ⇒ passe refusée + alerte — le pilote ne masque plus, il révèle ; il n'écrit donc
> JAMAIS `DriveAI_LAST_MANUEL`, qui aurait rendu le chien de garde muet des jours durant), et **ms
> journalisées** pour trancher empiriquement. Autres bloquants : coût LLM du pilote jamais compté
> (frein 110 $ aveugle → `reinitialiserUsage_`/`flushUsage_`), quarantaine prématurée du reliquat
> (3 essais en 2 min ⇒ perte définitive et silencieuse → mémoire des tentés), anti-rafale absent
> (`assurer-trigger` en boucle = tick jamais déclenché). Débit réel **×1,6**, pas ×13 — assumé et
> documenté : la constante est faite pour être relevée par Marc, données à l'appui. 739 tests,
> 2 bloquants prouvés par MUTATION ;
> coût LLM TOTAL inchangé (clé versionnée : chaque doc payé une seule fois — pousser ne coûte pas
> plus cher, ça arrive plus tôt). 731 tests. ⚠️ Note repo : la branche par DÉFAUT est
> `claude/compassionate-brahmagupta-e49tqa`, pas `main` — les crons GitHub ne tournent que depuis
> la branche par défaut ; ici sans conséquence (le fichier est sur les deux), mais à remettre sur
> `main` un jour pour l'hygiène.
>
> **⚡⚡⚡⚡⚡⚡⚡ ÉTAT AU 2026-07-31 (nuit) — AUDIT DE FOND (#44) + Vague 1a en revue.** Marc : « lance une
> analyse approfondie pour empêcher tous les bugs, lags, faux positifs ». 6 agents adversariaux
> (moteur, sécurité, app, intake, classement, taxonomie). **Socle §2 sain et PROUVÉ** (tests verts
> exécutés) : aucune suppression possible, zone 04 inviolable, secrets cloisonnés, aucun contenu de
> doc qui fuite. Vrais risques trouvés (croisés entre agents) : **règles de rangement divergentes**
> (flux vivant vs reset vs conso — 10 cas/12 ; la conso va DÉFAIRE la structure validée dès la
> convergence du reset) ; **corrections de Marc SANS effet** (few-shot mort sous v2) ; **prompt chat
> tronqué** (ASI) ; **auto-merge détournable** (fork) ; **socle O(Index) + scan Gmail complet** →
> risque de gel 90 min/j sans alarme ; **page Moteur lit le mauvais bout du Journal** (« 0 erreur »
> faux — ta plainte « jamais à jour ») ; filets intake manquants (épinglage, re-dépôt manuel, fichier
> empoisonné). **3 décisions Marc cliquées** : unifier le rangement + couper la conso ; optimiser le
> coût (2ᵉ passe conditionnelle + cache) ; alertes dans l'app seulement. Livraison par VAGUES (BACKLOG
> #44), chaque vague = 1 PR revue. **Vague 1a livrée (PR #239, revue en cours, do-not-merge)** : prompt
> chat réparé (test contenu + mutation), auto-merge durci (origine PR), reset honore `epingle|`.
> 741 tests. ⚠ Vercel rouge sur #239 = rate-limit du plan GRATUIT (>100 déploiements/j), PAS un bug,
> ce diff ne touche pas l'app — se réinitialise en 24 h (peut retenir le merge si check requis).
>
> **⚡⚡⚡⚡⚡⚡ ÉTAT AU 2026-07-31 (soir) — C28-42 : PASSE LLM DU RELIQUAT (ADR-0030 PR5, clic Marc).**
> Marc : « ya encore beaucoup de fichiers en mode inconnu mais rien se passe pour eux ». Diagnostic :
> deux populations — (a) les `_Inconnu` déjà CLASSÉS (la campagne m2-inconnu, suspendue pendant le
> reset, les reprendra SEULE à la convergence) ; (b) les **non-routables de `_TRI 2026`** (~134 au
> rapport `Reset`) qui n'avaient AUCUN chemin : la PR5 de l'ADR-0030 n'était jamais construite —
> c'était le vrai trou. Marc a cliqué « **Passe LLM ciblée** » (~2-5 $ one-shot accepté). Livré
> (cette branche) : amendement ADR-0030 + `analyserReliquatReset_`/`analyserPageReliquatReset_`/
> `analyserFichierReliquat_` (src/Reset.gs) + bloc tick AVANT migration (Main.gs, try/catch, gates
> `RESET_ACTIF` + `!estBudgetDepasse()` + `!budgetCampagnesAtteint_()`) + `RESET_LLM_MAX_PAR_RUN: 6`.
> La TABLE d'abord (`cheminCibleReset_` non-null ⇒ jamais de LLM), pipeline COMPLET `traiterDocument_`
> avec les 3 verrous du re-traitement (clé `tri33llm|<tag>|<version>|<fileId>`, `ignorerDoublon: true`,
> placement DIRECT — jamais de transit par `00 · À trier`), gardes §1 re-vérifiées à la mutation,
> drapeau terminal `DriveAI_RESET_LLM` aligné sur `finPlacementReset_()`. **Revue flotte (4 agents,
> AVANT merge)** : sécurité 🟢 ; quotas 🔴/coût 🟠/code-reviewer 🟠 unanimes sur le même trou — ma
> « réallocation du créneau LLM » était une fiction en ms/JOUR (migration/réanalyse/dry-run n'ont pas
> de budget quotidien), le drainage aurait concentré 50-130 min de runtime sur UN jour → gel C28-29.
> Corrigé : **`RESET_LLM_BUDGET_JOUR_MS` 12 min/j** (ms réelles persistées, patron des 3 phases),
> réalloué DANS l'enveloppe 50 min/j du reset (placement 22→14, 04 8→4), sommé dans l'invariant
> d'orchestration, **prouvé par mutation** (cp, jamais git checkout) ; bloc PR5 remonté AVANT
> l'historique Gmail (priorité du créneau post-reset — `resetTermine_` peut basculer avant le
> drainage) ; 🟡 : `nom`+`getId` dans le try, tripwire `reset-exec` amendé (indirections
> `renommer_`/`deplacerEtRenommer_` réservées à la sous-section PR5), ADR honnête (borne 200
> fichiers ≈ 8 $, couper `RESET_ACTIF` gèle aussi le drainage, pas d'un-clic — voulu). Drainage
> ~3-4 j. 719 tests verts (9 dédiés `reset-llm.test.js`). ⚠ Déploiement : **Marc ré-exécute
> `installerTrigger`** après ce merge moteur.
>
> **⚡⚡⚡⚡⚡ ÉTAT AU 2026-07-31 (après-midi) — C28-41 : REFONTE COMPLÈTE DE L'APP (décisions Marc,
> 12 réponses cliquées).** Marc (photos) : « l'app est vraiment pas superbe… supprime [actions
> rapides + opérations en cours] et le code en lien… plus de propositions de dossiers quand je
> demande pas… supprime l'onglet apprentissage (garde la logique)… coûts & quotas jamais à jour…
> santé me sert à rien… je veux mon agenda family… change l'UI en entier ». Plan en 3 PR
> (BACKLOG #41). **PR1 (cette branche) : refonte UI complète** — design v6 sombre réécrit
> (styles.css), **5 sections** (Aujourd'hui · Agenda · Documents · Assistant · **Moteur**),
> nouvelle page `Moteur.tsx` (état + coût LLM **horodaté** « données du moteur · il y a X min » —
> la vraie réponse au « jamais à jour » : pendant le reset, le quota runtime gèle des ticks
> l'après-midi, la donnée VIEILLIT et maintenant ça se VOIT — + progression, quota Gmail,
> dernières erreurs, réglage de fréquence), accueil v6 (ma journée Calendar/Tasks + derniers
> classements + alertes SEULEMENT s'il y en a + tuile coût), **pastille moteur** dans la topbar
> (`fraicheurMoteur`, seuils dérivés du tick réglé — jamais un faux vert). SUPPRIMÉS (app) :
> PanneauActions, OperationsLive, Apprentissage (reclassement manuel compris — décision Marc :
> il range dans Drive, le moteur apprend de ses corrections observées), Coûts & quotas, Santé ;
> lectures Sheet `Entités`+`TriAppris` retirées du cycle (payload −). **PR1 MERGÉE (#231).**
> **PR2 MERGÉE (#232) : agenda multi-agendas Family** — scope APP `calendar.readonly`
> (api/_lib.ts ; l'écriture reste bornée à `calendar.events`, verrou bff.test) ; « Mes agendas »
> RÉEL (calendarList : cases, couleurs, choix persisté — `agendasStore.ts`, 1 chargement/session
> partagé Agenda/accueil/création) ; événements fusionnés PAR agenda coché, couleur de l'agenda
> sur chaque bloc ; sélecteur d'agenda à la CRÉATION (principal par défaut). ⚠ Jeton d'avant le
> scope → calendarList 403 détecté (`SCOPE_AGENDAS`), repli agenda principal + invite « Se
> reconnecter » dans la sidebar. **⚠ Marc : se reconnecter UNE fois pour voir Family.**
> **PR3 MERGÉE (#233) : moteur — plus AUCUNE proposition spontanée (ADR-0031, §8 ; ABROGE
> l'ADR-0029).** `entiteEnAttenteAjouter_` = OBSERVATION seule (dossier Drive existant → ligne
> validée liée ; sinon ZÉRO écriture — tripwire) ; campagne réorg AUTO retirée (Main/Reorg/
> Config + skip-list ; `compterSousDossiersRegroupables_` et `chercherLigneFusionnable_` retirés
> aussi — ORPHELINS, le décompte des prompts est INLINE dans `inventaireDossiers_` [revue
> flotte : mes docs les croyaient vivants, le grep a tranché]) ;
> actions web app orphelines retirées (`demande-tri`/`demande-intentions`/`analyse-ciblee`) +
> consommateurs tick (`scanDemandeTri_`, `balayerAnalyseCiblee_`, fenêtre forcée intentions,
> `forcerSondeQuotaGmail_`) ; Progression/Télémétrie épurées (app alignée atomiquement).
> ROUTAGE INTOUCHÉ (entités validées + ADR-0016 intacts) ; les ~98 lignes `en_attente` héritées
> restent des données inertes (aucune suppression, la curation les assainit). 710 tests moteur ;
> revue flotte faite AVANT merge : 🟢 sécurité · 🟢 quotas · code-reviewer « prêt après 2 🟠 »
> (les 2 corrigés + 4 🟡). ⚠ Transition (revue) : une ligne `demande-auto-*` héritée encore au
> statut « analyse demandée » dans l'onglet Réorg déclencherait UNE dernière analyse Sonnet
> après déploiement (bornée, une fois) — la solder à la main si visible. ⚠ Déploiement :
> `clasp push` auto au merge — **Marc : ré-exécuter `installerTrigger`** (Extensions →
> Apps Script) pour prise d'effet certaine.
>
> **⚡⚡⚡⚡ ÉTAT AU 2026-07-31 (matin) — ACCÉLÉRATION (#229) + ÉTAT RÉEL MESURÉ.** Marc : « ça peut
> pas aller plus vite ? je veux que tout soit fini avant la fin de la journée ». **Constaté dans les
> ARTEFACTS** (onglet `Santé` + Index, jamais estimé — leçon du 30/07) : rassemblement entamé sur
> **4 domaines** (`01`, `02`, `03`, `05` le 31/07 06:42) ; **rangement de l'ancien Drive TERMINÉ** ;
> **10 830** documents au catalogue ; **coût LLM du mois 76,87 $** (11 112 appels — plafond campagnes
> 110 $, le reset n'y contribue PAS : routage par le nom) ; **~160 non routés** sous `t2` en attente
> des règles `t3` (#228). ⚠️ **Heartbeat à 24 min de retard** (dernier passage 08:12 pour un tick de
> 5 min) — premier signe du poste C28-34.
> **Livré dans #229, aucun levier n'augmente un budget** (leçon §7 « réallouer, jamais augmenter » —
> le gel de TOUS les déclencheurs reste le risque à ne jamais prendre) :
> (1) plafonds d'ITEMS par run 60→400 / 80→300 / 40→150 — le garde-temps (vérifié à CHAQUE item, y
> compris dans les collectes récursives) reste la vraie borne, inchangé. ⚠️ **Gain réel ≈ +5 %, pas
> ×5** : la revue #229 a réfuté mon raisonnement initial (« du budget accordé non consommé ») — les
> budgets/jour sont comptés en **ms CONSOMMÉES**, donc un run qui coupait tôt ne perdait rien, le
> reliquat partait au tick suivant. Le relèvement n'amortit que le coût FIXE de setup par run.
> (2) migration/réanalyse/dry-run suspendues pendant le reset — gain de DÉBIT nul (elles étaient déjà
> sautées par le budget de tick), mais gain réel de MARGE anti-gel et de COÛT LLM (`m2-inconnu`
> facturait du Sonnet ×2 à 76,87 $/110 $) ; `etapeReorg_` reste libre (travail validé par Marc).
> (3) **C28-34 fait** : `majResumeHub_` throttlé à 1×/15 min. C'est **le vrai levier** : il relisait
> l'Index ENTIER + le Journal ×288/j, soit ~24-72 min/j sur une enveloppe de ~90 — le reset ne
> recevait probablement pas ses 50 min/j. Vérification par signal indépendant : la Property
> `DriveAI_RESET_PLACE_JOUR` doit désormais atteindre `22*60*1000` chaque jour ; sinon le quota mord
> encore.
> (4) **DÉBIT PAR ITEM (revue #229, le levier qui vaut plus que les 3 autres)** : `empreinteBlob_`
> (téléchargement des octets) n'est plus appelée quand l'empreinte est déjà au plan de consolidation
> ou à l'Index (`empreinteReutiliseeReset_`) — un bump de `RESET_TABLE_VERSION` ne re-hashe donc plus
> rien ; cibles et dossiers de domaine mémoïsés par run (2-4 appels Drive/fichier économisés) ; borne
> de hash propre au reset (`RESET_HASH_TAILLE_MAX` 5 Mo < OCR 20 Mo) pour ne pas franchir le mur 6 min
> sur le dernier item ; rotation du Journal reportée si le tick est chargé.
> (5) **`lancerResetTout` réparé** : avec des plafonds hauts, la 1ʳᵉ phase mangeait les 4,5 min et le
> placement n'était JAMAIS atteint (le clic « tout faire » ne produisait plus aucune structure). Le
> mur est maintenant PARTAGÉ entre les 3 phases (`gardePartReset_`/`partPhaseReset_`).
> ✅ **CORRIGÉ dans #229** : l'app lisait `Index!A2:H20000` (fenêtre DURE, ancrée en TÊTE) alors que
> l'Index est à 10 830 et grossit de 2 lignes par fichier traité — le seuil allait être franchi DANS
> LA JOURNÉE et l'app aurait gelé EN SILENCE. Fenêtre désormais OUVERTE (`A2:H`).
> **DIT À MARC honnêtement** : en automatique seul, « tout fini aujourd'hui » est hors d'atteinte
> (placement ≈ 530-1 100 fichiers/jour pour ~10 000 restants). Le levier décisif reste
> `lancerResetTout()` dans l'éditeur (HORS quota des déclencheurs, débridé depuis #225) : ~4,5 min de
> travail plein par lancement, enchaînables ; ~13 lancements finissent le RASSEMBLEMENT (~1 h 30), le
> placement complet demanderait ~6 h de clics et couperait Gmail/dépôts pendant toute la séance (le
> verrou fait sauter les ticks).
>
> **⚡⚡⚡ ÉTAT AU 2026-07-30 (soir) — LE RESET AVANCE SEUL, 1ᵉʳ RELIQUAT TRAITÉ.** Constaté par
> signaux Drive : `_TRI 2026` contient 3 sous-dossiers de provenance (`01` 29/07 18:23, `02` 29/07
> 18:41, `03` 30/07 06:11) — le rassemblement descend domaine par domaine. Le placement tourne
> (`03 · Logement/Logements/Logement A (Bailleur A)` créé 30/07 08:41 avec ses
> contrats ; `Logements/Anciens logements` avec `Logement B`), et **04 a été réorganisée EN INTERNE**
> (29/07 19:42 : `Organisme d'immigration 1 (fédéral)`, `Organisme d'immigration 2 (provincial)`, `Permis de travail & autorisation` ; `Agence`
> laissé en place — cas ambigu banque/immigration, jamais tranché d'office). Sheet d'état écrite à
> 18:12 le 30/07 ⇒ **pas de gel du quota** (le point de surveillance C28-34 est bon pour l'instant).
> **#225** (un-clic hors budget quotidien) et **#226** (réallocation ×2,5 : histo Gmail 20 + sync 12 +
> conso 18 suspendus pendant le reset ⇒ 50 min/j au reset, enveloppe INCHANGÉE) sont MERGÉES.
> **#227 (PR3) EN REVUE** : Personne C (validation Marc) + « codes de récupération », et surtout la
> **VERSION DE TABLE** dans la clé de placement — sans quoi tout affinage futur des règles serait
> resté SANS EFFET (la clé fige aussi les verdicts « non routé »). Voir la leçon du 2026-07-30.
> **Question ouverte pour Marc** : `Extrait Kbis`/`Registre des bénéficiaires effectifs` (SCI SCI A)
> — règle vers `01/Attestations & certificats`, ou déplacement manuel vers `05/Entreprise — SCI A` ?
>
> **⚡⚡ ÉTAT AU 2026-07-30 (soir) — RELIQUAT LU EN PROD, STRUCTURE COMPLÉTÉE (#228, en revue).**
> Lecture de l'onglet `Reset` de la Sheet d'état : **134 fichiers non routés** + 25 quasi-doublons.
> ⚠️ CORRECTION d'une annonce erronée de la veille (« une dizaine ») — elle venait de l'inspection
> d'UN SEUL dossier `_TRI` alors que le rapport exhaustif existait déjà. Répartition : `03` 63
> (surtout `Contrat` 18 / `Correspondance` 16), `02` 36 (dont `Paie` 10), `01` 10.
> **Diagnostic** : pas des règles manquantes — des **dossiers manquants dans la structure validée**.
> Décisions du propriétaire (2026-07-30) implémentées en #228 : `02` → « Revenus & paie » (place prise sur
> « Donations & successions », seul nœud JAMAIS créé — vérifié dans Drive, donc aucun dossier rempli
> touché ; donations → « Impôts & déclarations ») ; `03` → « Contrats » + « Correspondance » (6 nœuds,
> filets EN DERNIER pour ne rien voler aux règles par entité). Garde `paie` ⊂ `paiement` (type EXACT)
> vérifiée par mutation. `RESET_TABLE_VERSION` → **t3** ⇒ le reliquat se re-tente TOUT SEUL au
> prochain passage, sans re-déplacer le rangé. **#227 MERGÉE** au passage (mécanisme de version +
> Personne C + codes de récupération ; son correctif BLOQUANT : le drapeau de FIN DE PHASE devait
> lui aussi porter la version, sinon le mécanisme mourait en silence à la convergence).
> **Où lire le reliquat** : onglet **`Reset`** de la **Google Sheet « DriveAI — État »** (PAS une vue
> de l'app — confusion créée par le mot « onglet », `Réorg` existant dans les deux).
>
> **⚡⚡ ÉTAT AU 2026-07-29 (soir) — LE RESET TOURNE EN PROD.** #223 (PR1) et #224 (PR2) sont MERGÉES
> et déployées. Marc a lancé `lancerResetTout()` dans l'éditeur : **vérifié par signaux Drive
> indépendants** — `_TRI 2026` créé (18:23:19), `_TRI 2026/01 · Administratif & identité` rempli, puis
> la structure cible créée sous 01 (`État civil & notarial` 18:25:44, `Attestations & certificats`
> 18:26:21) avec des fichiers réellement placés dedans. Un run manuel = ~4 min (mur Apps Script) et
> n'a traité qu'une partie de **01** ; il reste 8 domaines. Les anciens dossiers de 01 (Passeport, Zephyr,
> Correspondance**s**…) se vident au fur et à mesure — leurs coquilles vides ne partent à la corbeille
> que sur le CLIC de Marc dans l'app (jamais le moteur, ADR-0014).
> **#225 MERGÉE** — défaut révélé par ce 1ᵉʳ run réel : les fonctions UN-CLIC étaient bornées par les
> budgets QUOTIDIENS du TICK (20 min/j), alors qu'une exécution d'éditeur est HORS du quota des
> déclencheurs → (a) Marc bloqué jusqu'au lendemain après ~4-5 relances, (b) pire, son run manuel
> consommait le budget du tick et affamait l'automatique. Correctif : drapeau `manuel` sur les 3 phases
> (ni gaté, ni compté ; seul le mur 6 min de son exécution borne). Revue quota intégrée avant merge :
> anti-spin sur ronde stérile (le placement pouvait spinner 4,5 min à vide — son tag ne se pose
> qu'après le rassemblement, donc le break ne tirait jamais), garde « jamais par un déclencheur »,
> et `DriveAI_LAST_MANUEL` pour que le chien de garde ne crie pas « moteur silencieux » à tort.
>
> **⚡ PR #226 EN REVUE (do-not-merge) — LE RESET AUTO ~2,5× PLUS RAPIDE, ZÉRO CLIC.** Demande Marc
> « je veux que tu le fasses toi automatiquement » : le reset EST déjà automatique (tick) — ce qui le
> rendait lent était son budget de 20 min/j. Option choisie par Marc : **RÉALLOCATION**, jamais
> augmentation. `traiterGmailHistorique_` (20) et `synchroniserIndex_` (12) rejoignent conso-2 (12+6) et
> la réorg auto dans les campagnes gatées par `!resetEnCours_()` ; le reset passe à 20/22/8 = **50 min/j**
> = EXACTEMENT les 50 min/j libérés. L'enveloppe de runtime ne bouge pas ⇒ aucun risque de gel des
> déclencheurs (le piège C28-29). Invariant verrouillé par test **et vérifié par mutation**. Toutes les
> campagnes suspendues reprennent SEULES à la convergence. 704 tests verts.
>
> **PROCHAINE ACTION MARC : AUCUNE.** Le reset avance seul à chaque tick. Optionnel pour accélérer
> encore : `Reset.gs` → `lancerResetTout()` → Exécuter, en rafale (le Journal dit où ça en est, et
> « RESET TERMINÉ » à la fin). À la fin, consulter l'onglet **`Reset`** (quasi-doublons probables +
> fichiers non routés restés en `_TRI`) et l'onglet **`Réorg`** (`vide-candidat` → corbeille au clic).
> ⚠️ **À VÉRIFIER après déploiement de #226 par signal INDÉPENDANT** (leçon §7) : le heartbeat ne doit
> pas se figer l'après-midi (sinon le quota runtime est trop serré → redescendre les budgets du reset).
> **À SAVOIR pendant une séance de relances** (revue quota #225) : chaque un-clic tient le verrou du
> moteur ~4,5 min et le tick est à 5 min → pendant la séance, **le flux vivant est en pause** (PJ
> Gmail, dépôts, tri) ; rien n'est perdu, tout est re-scanné après. Le chien de garde ne criera PAS
> « moteur silencieux » à tort : les un-clic écrivent `DriveAI_LAST_MANUEL` et le watchdog prend le
> plus récent des deux signaux de vie.
>
> **ÉTAT AU 2026-07-29 — C28-33 (RESET COMPLET DU DRIVE) : PR1 MERGÉE (#223), PR2 FAITE.** Décision
> Marc : tout rassembler dans `_TRI 2026`, écarter les doublons, repartir sur une structure ≤ 7
> sous-dossiers/niveau (ADR-0030). **PR1** (mergée) : structure cible validée par Marc + routage PUR
> par le nom (`cheminCibleReset_`, zéro LLM — 97 % des fichiers conformes) + tests (revue adversariale
> 3 lentilles intégrée avant merge, 18 cas de non-régression). **PR2** (branche courante) : campagnes
> I/O DIRECTES — rassemblement 01-09 (04 exclu) → `_TRI 2026/<domaine>`, dédup par empreinte + rapport
> quasi-doublons/non-routés (onglet `Reset`), placement par la règle PURE avec re-pointage des
> `Entités.Dossier ID`, réorganisation INTERNE de 04 (**CLAUDE.md §2.1(b) révisé ATOMIQUEMENT** — la
> sortie de 04 reste NON négociable, seul l'INTERNE est désormais permis, verrouillé par un tripwire
> constitution↔code). **conso-2 et la réorg auto C28-32 sont AUTOMATIQUEMENT SUSPENDUES pendant le
> reset** (`resetEnCours_`, ADR-0030 « Transition ») et reprennent seules à la fin. Fonctions UN-CLIC
> pour Marc (`lancerResetTout()` dans l'éditeur Apps Script — hors quota des déclencheurs, le plus
> rapide) + branchement tick automatique (budget tail ; ~50 min/j le temps du reset depuis la
> réallocation #226 — RÉALLOUÉS depuis les campagnes suspendues, enveloppe inchangée).
> **Reste à faire côté Marc une fois déployé** : lancer `lancerResetTout()` plusieurs fois dans
> l'éditeur (ou laisser les ticks avancer seuls, plus lent) jusqu'à ce que le Journal dise « RESET
> TERMINÉ » ; consulter l'onglet `Reset` (quasi-doublons + non-routés) et l'onglet `Réorg`
> (`vide-candidat`) pour les décisions manuelles. 682 tests moteur.
>
> **⚡ ÉTAT AU 2026-07-24 (soir) — C28-30 COMPLET + LIVE.** Les 3 PR du chatbot sont MERGÉES
> (#202 moteur · #203 opérations dossiers/épinglé · #204 UI onglet Assistant) ; le chat RÉPOND en prod.
> Suivis mergés : **#206** (troncature corrigée `CHAT_MAX_TOKENS` 1500→4000 + itérations 4→6 + prompt
> qui FORCE `proposer_reorg` ; plafond retiré `CHAT_COUT_JOUR_MAX` 0,33→10 $/j = filet anti-emballement
> seul ; **auto-redéploiement web app** `clasp deploy -i $WEBAPP_DEPLOYMENT_ID`) ; **#207** (bloc usage
> hub : coûts/quotas) ; **#208 HOTFIX** — l'auto-`clasp deploy` cassait l'accès web app (« Failed to
> fetch » + Sync Drive rouge) car `appsscript.json` ne pinnait pas `webapp.access` → épinglé
> `ANYONE_ANONYMOUS`/`USER_DEPLOYING`. Marc a posé le secret `WEBAPP_DEPLOYMENT_ID` → **chaque merge
> moteur redéploie /exec tout seul** (plus de « Nouvelle version » à la main). **Reste à confirmer par
> signal RÉEL** (Marc teste) : le chat finit ses phrases ET propose des opérations validables à droite ;
> l'accès web app est bien revenu (chat OK + Sync Drive vert). Piège appris : CLAUDE.md §7 pièges
> auto-déploiement #5. Détail des 3 PR ci-dessous.
>
> **UX ASSISTANT (retours d'usage Marc 2026-07-24, plan architecte NotebookLM, 3 PR).** **PR1 FAITE**
> (branche courante) : (a) `actionChatAssistant_` renvoie `actionsProposees` (vrai si `proposer_reorg`
> appelé) → l'app invalide le cache `Réorg` + remonte `ReorgVue` (`key`) SEULEMENT alors — corrige
> « propositions pas à jour » ; (b) historique du chat en **sessionStorage** (survit au F5, meurt à la
> fermeture d'onglet, jamais localStorage — arbitrage ADR-0007 de l'architecte) + bouton « Effacer le
> chat ». 632 tests moteur + 189 app + build. **PR1 MERGÉE (#210).** **PR2 FAITE (branche courante,
> revue flotte 🟢 sécurité)** : réponses en **Markdown** (`react-markdown` ^10, sans `rehype-raw` → HTML
> inerte, URLs `javascript:` neutralisées ; liens `target=_blank rel=noopener`) ; fenêtre type claude.ai
> (`.chat-fil` plus haute + `min-height`) ; indicateur de chargement TRÈS visible (`.chat-loader` 3 points
> animés + « Analyse en cours… (jusqu'à 1 min) », `prefers-reduced-motion`). **PR3 FAITE (branche courante)** :
> troncature de l'historique chat aux `CHAT_HISTORIQUE_MAX` (13) derniers messages avant l'envoi à
> Anthropic (`tronquerHistoriqueChat_` PURE, coupe sur frontière paire → `user` en tête ; dernier message
> conservé) — réduit tokens + latence ET corrige un bug latent (un chat > 20 messages était REJETÉ →
> cassait ; désormais tronqué). 634 tests moteur. NB : ré-exécuter `npm install` dans `app/` après un
> checkout frais (#207 a re-pinné `@mokarade/hub-contract` v1.1 — sinon tsc casse sur `usage` ; et
> react-markdown est désormais une dépendance à installer).
> **SUITE UX COMPLÈTE ET MERGÉE : #210 (PR1) · #211 (PR2) · #212 (PR3)** — reste à confirmer par un
> test RÉEL de Marc dans l'app.
>
> **⚡ C28-31 — LIMITE COGNITIVE DES DOSSIERS (~7), demande Marc 2026-07-28 : « je veux un maximum de
> genre 7 dossiers par dossiers ».** Plan architecte NotebookLM, 2 PR. **ADR-0027** : règle des **7 ± 2**
> appliquée de façon **ASYNCHRONE** — la Réorg IA et le Chat *proposent* un regroupement thématique
> (ex. « Anciens employeurs »), **Marc valide** ; le **flux vivant n'est JAMAIS bloqué** (sinon deux
> logiques de classement concurrentes divergent → re-déplacements en boucle, et « granularité =
> enrichissement, jamais frein »). `Router.gs`/`Consolidation.gs` **INTOUCHÉS**. Exemptions : années
> « AAAA », noms de schéma, zone `04 · Immigration`. **PR1 MERGÉE (#215)** : ADR-0027 + seuils
> (`REORG_MAX_SOUS_DOSSIERS_IDEAL` 7 / `_TOLERANCE` 9) + flag pur dans `resumeArborescence_`
> (« ⚠️ TROP DE DOSSIERS, À REGROUPER », émis au-delà de la tolérance SEULEMENT → 0 token de plus sur
> un dossier sain ; champ absent ⇒ aucun flag). **PR2 (branche courante)** : `inventaireDossiers_`
> calcule `nbSousDossiers` en ne comptant QUE les sous-dossiers **regroupables** (années/schémas exclus
> via `estSegmentStructurel_` — la whitelist `parserPropositionReorg_` rejette toute mutation d'un
> segment structurel, les compter ferait proposer des actions systématiquement rejetées) ; règle « loi
> de Miller » ajoutée à `promptReorg_` et `promptChatAssistant_`. **LIMITE CONNUE (découverte à
> l'implémentation)** : un dossier créé n'a pas encore de numéro (Réorg) ni d'ID (Chat) → « créer le
> parent + y déplacer » est **impossible en un seul plan** ; le regroupement prend **2 tours** (tour 1 :
> créer, validé par Marc ; tour 2 : déplacer dedans). Les deux prompts l'énoncent explicitement pour
> éviter des actions invalides.
>
> **⚠️ C28-31 a été GELÉ puis REPRIS : la revue a trouvé que le regroupement ne pouvait pas converger.**
> Le moteur retrouvait le dossier d'une entité **par NOM**, en enfant DIRECT du domaine → un dossier
> regroupé était re-créé à plat par le flux vivant, la consolidation ressortait les fichiers, puis
> proposait de **corbeiller le dossier vidé**. L'ADR-0027 §4 affirmait le contraire (corrigé, marqué
> FAUX). Prérequis livré : **ADR-0028 — routage TOPOLOGIQUE** (#216 logique pure, #217 I/O + docs) :
> le `Dossier ID` du référentiel prime sur le chemin ; **un seul résolveur** (`dossierEntiteParId_`)
> pour le flux vivant ET l'exécution du plan (divergence impossible par construction) ; **4 replis par
> nom** (pas d'ID, ID mort, dossier **CORBEILLÉ** — sinon perte silencieuse à 30 j —, hors domaine) ;
> chemin RÉEL inscrit dans l'Index. **C28-31 repris ensuite** avec les corrections des deux revues :
> `TYPES_IDENTITE` (Passeport, Permis…) ajoutés à `estSegmentStructurel_` (trou de convergence
> INDÉPENDANT : la réorg pouvait les déplacer, le router les recréait) ; prompt Réorg qui RÉUTILISE un
> regroupement existant au lieu d'en créer un second ; seuils interpolés depuis la CONFIG ; règle chat
> conditionnée (le chat n'a aucun outil listant un dossier — il ne doit pas AFFIRMER une saturation) ;
> décompte aligné sur ce que le LLM voit vraiment. **Verrous ajoutés en revue** : `fusionner` interdit
> sur un dossier d'entité (il le DÉTRUIT et re-pointerait `Entités.Dossier ID` vers le fourre-tout —
> le regroupement passe toujours par `deplacer`) ; année/type d'identité jamais CIBLE d'un déplacement.
> **C28-31 MERGÉ (#215, #218).**
>
> **⚡ C28-32 — CAMPAGNE DE RÉORG AUTOMATIQUE (ADR-0029). ⛔ ABROGÉE le 2026-07-31 (ADR-0031,
> C28-41 PR3 — code retiré, `REORG_AUTO_*` disparus de la CONFIG ; historique ci-dessous).**
> Constat déclencheur : la règle des ~7 ne
> s'appliquait qu'À LA DEMANDE (`appliquerReorgIA_` sort sans ligne `demande`) → le Drive ne
> convergeait jamais seul. Le moteur DÉPOSE désormais lui-même la demande sur un dossier saturé
> (`genererDemandeReorgAuto_`) ; le pipeline existant fait le reste ; **rien ne s'applique sans la
> validation de Marc**. Régulation « zéro spam » : **1 scan/jour** ET **« assiette propre »** (aucune
> demande en cours) → séquentiel. Convergence : **skip-list 30 j** si le LLM ne propose aucun
> regroupement (sinon même dossier re-choisi chaque jour), entrées expirées purgées. Le jour est
> consommé dès qu'un scan ABOUTIT même sans cible (anti re-scan 288×/j), PAS si l'inventaire est
> interrompu. Branché JUSTE APRÈS `etapeReorg_` (assiette fraîchement soldée ; l'analyse LLM a lieu au
> tick SUIVANT — jamais inventaire + Sonnet dans le même run). **PR1 mergée (#219)** ; **PR2 = branche
> courante**. 650 tests moteur. **Cadence : `REORG_AUTO_MAX_JOUR` = 3** (décision Marc « accélère »,
> révise 1) — un dossier peut être aéré dans la JOURNÉE s'il valide au fil de l'eau. Doit rester
> ≤ `REORG_MAX_JOUR` (5, plafond des analyses LLM, compteur distinct) : au-delà les demandes
> s'empileraient sans être analysées. Le vrai facteur limitant reste la VALIDATION de Marc.
>
> **2026-07-24 — C28-30 : onglet ASSISTANT (chatbot Claude), PR1/3 (plan architecte NotebookLM,
> ADR-0026).** Marc veut un assistant conversationnel : (A) Q&A qui RETROUVE et LIT ses fichiers
> (« donne mon NAS » → cherche, lit, extrait) ; (B) opérations de dossiers par chat (créer/fusionner/
> déplacer/renommer + « organiser un dossier ») via la réorg GARDÉE (C21-06), aperçu + validation par
> fichier. Remplace la page réorg. **PR1 FAITE (moteur, cœur chat LECTURE SEULE)** : `Llm.gs`
> `appelAnthropicMessages_` (un tour `/v1/messages`) + `appelAnthropicChat_` (boucle Tool Use bornée
> `CHAT_TOOL_ITERATIONS_MAX`, sans I/O Drive — l'exécution des outils est un callback) ; `WebApp.gs`
> action `chat-assistant` (garde secret existant) + 3 outils LECTURE (`recherche_nom`/
> `recherche_contenu`/`lire_fichier`, bornés) ; plafond QUOTIDIEN `CHAT_COUT_JOUR_MAX` **0,33 $**
> (échec fermé ; revue llm-cost : 0,50 aurait plafonné à 15 $/mois > cible §2.6) + anti-rafale ;
> ADR-0007 (rien du contenu persisté — historique éphémère côté navigateur, texte lu en transit
> Claude seul). Revue flotte : **security-auditor 🟢** (lecture seule réelle, injection Drive
> échappée, budget échec fermé — 2 notes écrites dans l'ADR : temp OCR de `lire_fichier`, exposition
> délibérée du contenu sensible à la demande) ; **llm-cost 🟠→corrigé** (cap 0,50→0,33 ; suivi :
> prompt caching = plus gros levier, après vérif doc Anthropic) ; **code-reviewer 🟠×2→corrigés**
> (garde-temps de boucle `CHAT_BUDGET_MS` 4 min contre le mur 6 min ; tour final garde `tools` +
> `tool_choice:{type:'none'}` au lieu de retirer `tools`). Tests `chat-assistant.test.js` (9) +
> surface. 617 tests. **PR2 FAITE (moteur, opérations dossiers/fichiers)** : outil `proposer_reorg`
> (`WebApp.gs`, whiteliste PURE `parserActionsChat_`, écrit des lignes `proposé` dans l'onglet `Réorg`,
> N'APPLIQUE RIEN — le chat ne mute jamais le Drive) ; action `deplacer-fichier` (`Reorg.gs`
> `appliquerDeplacerFichier_` — `getFileById(source).moveTo(cible)`, garde §1 STRICTE échec-fermé
> SOURCE — jamais détacher un fichier de 04 — ET CIBLE, appliquée par `appliquerUneAction_` sur
> validation Marc) ; convergence « épinglé Marc » = clé DÉDIÉE Index `epingle|<fileId>` (le plan
> supposait `indexLire_('drive|…').statut` INEXISTANT → namespace dédié checkable par `indexContient_`)
> IGNORÉE par les 4 campagnes de re-rangement (consolidation, migration, réanalyse, grand rangement).
> Tests `chat-reorg.test.js`. 631 tests. **PR3 FAITE (UI)** : `app/src/vues/Assistant.tsx` (NOUVEAU) —
> onglet de PREMIER NIVEAU 💬 (App.tsx `SECTIONS`/`ICONES` + Sidebar auto ; la « Réorg IA » QUITTE
> `Documents.tsx` → l'Assistant remplace la page réorg). Chat éphémère (`envoyerMessageChat` → doPost
> `chat-assistant`, rien persisté ADR-0007) + `ReorgVue` embarquée : les propositions du chat
> (`chatreorg|…`, nouveau helper pur `actionsProposeesChat`) s'y valident PAR ACTION ; refresh
> `signalRafraichir`+`viderCachePlages('Réorg')` après chaque réponse. 2 actions rapides (suggérer/
> organiser) + compteur budget (`actionChatAssistant_` renvoie `coutJour`/`plafond`). i18n FR/EN,
> capture e2e. 188 tests app + build vert. **⚠ CHANTIER C28-30 COMPLET (3 PR)** — reste à VÉRIFIER en
> prod après déploiement (Marc) : l'onglet Assistant répond, propose, et Marc valide → le moteur
> applique au tick. Le chat est un flux SUR-DEMANDE (pas un tick) : pas d'`installerTrigger` requis
> pour lui, mais le déploiement `clasp push` doit passer (auto au merge).
>
> **⚠️ 2026-07-23 (soir) — INCIDENT FAMINE consolidation + correctif « BUDGET TAIL » (C28-29).**
> Vérification PROD (signaux Drive) après C28-28 : le grand nettoyage NE DRAÎNAIT TOUJOURS PAS —
> 02·Finances gardait ~40 vieux dossiers banques/émetteurs, 03 ~20, INTACTS 2 jours malgré 2
> `installerTrigger` + l'accélération. **Cause (code, `src/Main.gs`)** : `appliquerPlanConsolidation_`
> + `genererPlanConsolidation_` étaient EN DERNIER dans le tick, gatés par le budget de tick 3 min
> (`estBudgetDepasse`), APRÈS l'intake + campagnes legacy + `synchroniserIndex_` (« perpétuelle sur le
> reliquat ») → tout mangé avant, consolidation SAUTÉE chaque tick (heartbeat vert, zéro drainage). =
> anti-patron leçon §7 « tôt + gated, PAS en dernier ». **Correctif (plan NotebookLM)** : remontée de
> la consolidation juste après le flux vivant + « BUDGET TAIL » (`estBudgetDepasseStandard`, mur
> Apps Script 4,5 min réservé à l'I/O Drive pur sans risque LLM — le flux vivant reste borné à 3 min,
> la consolidation n'utilise que le reliquat → garantie à chaque tick sans lui voler une ms).
> `test/orchestration.test.js` fige l'ordre + le garde. 607 tests. **⚠ Marc : ré-exécuter
> `installerTrigger` après merge ; signal PROD : 02/03 se vident (tri « dernière modification »).**
> Note ADR-0024 (bis). Diagnostic clé : un budget quotidien ne sert à rien si le gate PAR TICK coupe
> l'étape avant qu'elle démarre — l'ORDRE prime sur les budgets. **Correctif quota (revue
> apps-script-quota 🟠, suivi PR)** : maintenant que la consolidation tourne VRAIMENT (jusqu'à 32
> min/j au lieu de ~0), l'agrégat runtime aurait pu frôler le quota ~90 min/j (flux + `finally` ×288
> + campagnes) → GEL de tous les déclencheurs. Budgets consolidation REDESCENDUS gen 20→12 / exec
> 12→6 min/j (18 min/j, drainage en ~2-3 j, marge confortable). ⚠ à surveiller : `DriveAI_LAST_TICK`
> ne doit pas se figer l'après-midi ; redescendre davantage (ou histo/sync) si le heartbeat gèle.
> **2026-07-23 — C28-28 « c'est toujours un bordel » (plan architecte NotebookLM, 3 axes, 3 PR).**
> Marc a coché 3 priorités (vider l'ancien à fond ; fichiers mal classés ; encore trop de dossiers),
> PAS « valider d'un coup d'œil » → plus d'automatisation, pas de gate manuel. Plan validé (ADR-0025,
> révise ADR-0014 pour le corbeillage en LOT). **PR1 (axes 2&3, classement + audit §8)** : prompt v2
> — candidature (05, entreprise VISÉE) jamais une entité → à plat (renfort du verrou référentiel qui
> route déjà à plat, PROUVÉ par l'audit) ; `estExportDonnees_` (Router) exclut les exports de MAILS
> (`Message_`/`Correspondance_`/`Courriel_`…) du dump `_Technique` → classés au domaine (placé APRÈS le
> filtre social : un vrai export Messenger « messages » reste `_Technique` ; `Relevé_` hors périmètre,
> ambigu). Audit §8 sur réel + contre-épreuves (export social conservé, facture .html non-export).
> 601 tests. **PR1 MERGÉE (#196)** ; revue flotte : structure-keeper CONFORME, code-reviewer 🟠 (la
> regex mail capturait les fils Facebook `message_1.html`/`conversation_3.html`) → **hotfix folddé
> dans PR2** (lookahead `(?!_?\d)` + contre-épreuves). **PR2 (axe 1 moteur) FAITE** :
> `ConsolidationExec.gs` — après chaque `moveTo`, le dossier QUITTÉ devenu STRICTEMENT vide (hors
> protégé/intouchable/structurel) est inscrit `vide-candidat` dans l'onglet Réorg (même format que la
> fusion, dédupliqué, lazy 1 lecture/run) — CONSTAT seul, JAMAIS de suppression ; enveloppé (ne bloque
> jamais le déplacement). TAXONOMY retouché. 605 tests. **PR2 MERGÉE (#197)** ; revue flotte :
> security-auditor 🟢 (aucune suppression, zone 04 intacte) + apps-script-quota RAS — 2 durcissements
> 🟡 folddés dans PR3 : garde §1 de `detecterDossierVide_` par REMONTÉE d'ancêtres
> (`chaineMonteVersProtege_`, placée APRÈS la vacuité = zéro coût sur le cas dominant) + lecture
> Réorg colonne A seule (÷8 payload). **PR3 (axe 1 app) FAITE** : bouton « Tout corbeiller » dans
> `Reorg.tsx` (affiché si ≥ 2) — boucle SÉQUENTIELLE sur `corbeillerDossierVide` (MÊME re-vérif live
> `verdictCorbeille` par dossier), arrêt propre à la 1ʳᵉ violation en nommant où, progrès gardé ; le
> moteur ne corbeille toujours RIEN. i18n FR/EN, tsc propre, 187 tests app (aucune-suppression vert).
> **C28-28 COMPLET (3 PR).** Marc : ré-exécuter `installerTrigger` après merge pour le moteur PR2.
> **2026-07-23 — MOTEUR RÉVEILLÉ + accélération (C28-26-ACCEL).** Marc a exécuté `installerTrigger` :
> prise d'effet VÉRIFIÉE par signaux indépendants (lecture Drive) — heartbeat frais (Sheet d'état
> 13:32), `00·À trier` VIDE (intake sain), dossiers d'entités seed créés aux racines de domaine (dont
> « Logement B » RÉUTILISÉ sans doublon), `02·Finances` se remplit PAR ANNÉE (2022/2025/2026 —
> paies, T4, relevés, contrats courtiers), zéro dossier par banque, zéro doublon créé. **Constat** :
> rangement de fond correct mais LENT (goulot = la GÉNÉRATION du plan, pas l'exécution) et beaucoup de
> vieux dossiers de `03` pas encore drainés. **Décision Marc « accélérer »** → hausse des budgets
> QUOTIDIENS (`Config.gs` seul, aucune logique de classement) : génération 12→20 min/j (le vrai levier)
> + plafond 40→60/run ; exécution 6→12 min/j (juste assez pour ne jamais devenir le goulot) + plafond
> 60→100/run ; per-run exec inchangé (2 min, < garde-temps). **Enveloppe agrégée = 64 min/j** (histo 20
> + gen 20 + exec 12 + sync 12), marge ~26 min sous le quota runtime ~90 min/j — intake PRIORITAIRE.
> Revue flotte quota (garde ADR-0024) : 🟠 → à VÉRIFIER par signal indépendant (heartbeat qui ne se
> fige pas l'après-midi) et REDESCENDRE (exec 6 / gen 12) une fois le drainage fini. **⚠ Marc :
> ré-exécuter `installerTrigger` une fois cette PR mergée** pour que le nouveau budget prenne effet.
> **2026-07-09 — C26-08 LANCÉE (ADR-0018) : ANALYSE_V2 allumé + campagne ciblée 03/08 ; crédit
> rechargé (100 $) ; dry-run clos ; fusion 07→08 et incident Sheet SOLDÉS ; artefacts rangés
> sous 08 ; C28-14 session durable de l'app LIVRÉE ET VALIDÉE en prod.**
> • **⚠️ 2026-07-15 — INCIDENT DÉPLOIEMENT résolu : le moteur tournait du VIEUX code depuis ~4 j.**
>   Symptôme (Marc) : « Coûts & quotas vide » + quota Gmail toujours épuisé. Cause : `clasp push`
>   vert MAIS le déclencheur time-based exécutait la version chargée avant le 13/07 (onglet
>   `Télémétrie` jamais créé, `MIGRATION_TAG` figé sur `m1` au lieu de `m2-inconnu`, plafonds
>   C28-21 jamais appliqués — zéro erreur). Les features FRONTEND (Vercel) shippaient bien, seul le
>   MOTEUR était figé. RÉSOLU : Marc a ouvert l'éditeur (Extensions → Apps Script) + exécuté
>   `installerTrigger` → code frais activé, `Télémétrie` créé, Progression sur `m2-inconnu`, stable
>   sur plusieurs ticks (pas de « projet fantôme »). **Le déclencheur est repassé à 30 min** (réglage
>   Marc du matin) — abaisser dans les Réglages si besoin de rapidité. Quota Gmail du compte
>   réellement à sec pour le 15/07 (vidé par le vieux code) → recharge la nuit, plafonds désormais
>   actifs. Leçon durable ajoutée (CLAUDE.md §7, 3ᵉ piège auto-déploiement : vérifier la PRISE
>   D'EFFET par signal indépendant, pas le run vert).
> • **2026-07-21 — C28-26-EXEC (suite) : correctifs revue flotte (PR-C) — MERGÉE (#189).**
>   Le lot moteur COMPLET (taxonomie à plat + seed + exécuteur + correctifs) est sur `main` ;
>   **reste à Marc : `installerTrigger` (Extensions → Apps Script) pour réveiller le moteur** —
>   signal de prise d'effet INDÉPENDANT : l'onglet `PlanConsolidation` se remplit en `conso-2`,
>   les dossiers d'entités seed apparaissent aux racines de domaine, plus aucun dossier d'émetteur
>   créé. Puis validation corbeille des dossiers vidés dans l'app (ADR-0014). NB fusion de
>   rattrapage : `main` avait avancé (#186–#188) → merge `origin/main`, artefact d'auto-merge
>   corrigé (appel `appliquerPlanConsolidation_` DUPLIQUÉ dans Main.gs — leçon consignée). 4 agents. 🔴 principal
>   (code-reviewer) : le plan conso-1 a pu se générer AVANT le seed (4 jours de cibles pré-seed :
>   dossiers de banque, noms périmés) → (1) **cible RECALCULÉE au moment du move** (règle unique +
>   référentiel COURANT — la colonne Cible n'est qu'une trace ; `decouperCiblePlan_` retirée) ;
>   (2) **rotation de tag `conso-2`** (purge du plan périmé + curseurs à zéro, dans le générateur).
>   Quotas : échec compté **≤ 1×/JOUR** (abandon = 3 jours distincts, jamais 3 ticks) ; enveloppe
>   quotidienne exec 10→6 min (agrégat campagnes < quota runtime) ; **exec AVANT gen** + contre-
>   pression `CONSOLIDATION_BACKLOG_MAX` (drainer avant d'alimenter) ; court-circuit terminal.
>   Sécurité : refus des IDs de **dossier** (ligne forgée), motifs élargis, tripwire repo-wide
>   anti-FUITE (`setSharing`/`addEditor`/`addViewer`). Structure : réutilisation des dossiers à
>   casse divergente (« Logement B » minuscule existant), **alias MV↔Marque V**
>   (canoniserVehicule_), TAXONOMY retouché ×3, ADR-0024 « révise ADR-0023 D4 ». 595 tests.
> • **2026-07-21 — C28-26-EXEC : « c'est toi qui le fais » (ADR-0024, 2 PR).** Décision Marc
>   (verbatim : changer tout LIVE, pas de dossier par banque, ajout de dossiers sécurisé/utile
>   seulement — dérogation §4 assumée, revue flotte en garde-fou). **PR-A #185 (mergée)** : seed
>   one-shot des 15 entités RÉELLES validées par le code (4 logements : Logement A, Logement B,
>   Logement C, Logement D ; Véhicule A, Véhicule B,
>   Véhicule C ; Employeur B, Employeur A ; 6 écoles) + DÉVALIDATION des entités 02 (« pas de dossier
>   par banque », statut tracé) + auto-validation ≥3 vues COUPÉE (`ENTITES_AUTO_VALIDATION:
>   false`) + prompts sans banque. **PR-B** : NOUVEAU `src/ConsolidationExec.gs` — applique
>   Déplacer/Doublon du PlanConsolidation au fil de l'eau : `moveTo` SEULE mutation (verrou de
>   surface), §1 re-vérifiée STRICTE par mutation, multi-parents jamais déplacé, cible parsée/
>   validée (`decouperCiblePlan_` — jamais un chemin arbitraire), curseur append-only, abandon
>   tracé à 3 échecs (curseur jamais gelé), budgets 2 min/run + 10 min/j (ms réelles),
>   `CONSOLIDATION_EXEC_ACTIF: false` = suspension immédiate. Les dossiers VIDÉS restent pour la
>   corbeille APP (clic Marc, ADR-0014 — non négociable). 587 tests. **⚠ Marc : `installerTrigger`
>   pour activer, puis le Drive se transforme tout seul ; sources NotebookLM à ajouter :
>   `src/ConsolidationExec.gs`, `docs/adr/0024-execution-consolidation.md`.**
> • **2026-07-17 — C28-26 : campagne de consolidation ALLUMÉE (`CONSOLIDATION_ACTIF: true`).**
>   Correctifs revue flotte mergés (#183) → allumage (« continue », Marc). Le moteur GÉNÈRE le plan
>   dans l'onglet `PlanConsolidation` (~12 min/j max, dry-run PUR — rien ne bouge). ⚠ PRISE D'EFFET :
>   le déclencheur doit charger le nouveau code — Marc ouvre l'éditeur Apps Script + exécute
>   `installerTrigger` ; signal indépendant = l'onglet `PlanConsolidation` se remplit. Fin de
>   campagne = Journal « Plan de consolidation TERMINÉ (tag conso-1) ». ENSUITE : Marc valide le
>   plan (+ ses entités dans l'app + liste des logements) → chantier d'EXÉCUTION des déplacements
>   (séparé, avec re-vérif §1 par mutation, jamais codé sans nouveau plan §4).
> • **2026-07-16 — C28-26 (suite) : correctifs revue flotte (PR3).** 4 agents, verdicts convergents ;
>   tout corrigé avant tout allumage : (1) 🔴 `entitesValideesParCle_` mort-né (`chargerEntitesCache_`
>   ne retourne rien → `entitesCache_()`) ; (2) 🔴 verrou « entité majeure » re-branché sur le champ
>   GATÉ `sousDossier` + **verrou RÉFÉRENTIEL** : un dossier d'entité n'existe QUE si l'entité est
>   VALIDÉE (demande initiale de Marc) ; (3) 🔴 matérialisation d'entités → racine du domaine SANS
>   squelette ; (4) 🔴 arbitrage Marc « **entité OU année** » (02/Bellerives sans année, tout-venant
>   02/2026) → RÈGLE UNIQUE `sousCheminDomaine_` (Router.gs) partagée flux vivant ↔ consolidation +
>   TRIPWIRE test (divergence = « Déplacer » en boucle) ; (5) 🔴 budget QUOTIDIEN de campagne
>   (12 min/j, ms réelles persistées `DriveAI_CONSO_JOUR`) + garde de collecte à mi-budget
>   (anti-plateau) + domaines épuisés `conso|<tag>|dom|<nom>` (anti re-walk) ; (6) 🟠 empreinte
>   JAMAIS dans l'Index (auto-doublon intake), identité scopée à son domaine dans la cible, raison
>   §1 honnête, motifs anti-mutation élargis. `docs/TAXONOMY.md` RÉÉCRIT (à plat, règle unique,
>   interdits, campagne), ADR-0023 révisé. 575 tests moteur. **L'allumage de `CONSOLIDATION_ACTIF`
>   attend le merge de ces correctifs.** Notes : raccourcis multi-entités = abandon ACTÉ (hérités
>   « Ignoré ») ; suffixes anti-écrasement `_2` ciblés à plat (connu) ; toujours en attente de Marc :
>   liste exacte des LOGEMENTS (validation des entités 03).
> • **2026-07-16 — C28-26 : refonte de l'arborescence — plan architecte EXÉCUTÉ (ADR-0023, 2 PR).**
>   Retour Marc : « trop le bordel ». Recensement réel (13 agents) →
>   `docs/diagnostics/2026-07-16-recensement-drive.md` (~499 dossiers dont ~102 vides, ~2 880
>   fichiers dont ~1 357 à plat et ~909 Inconnu). **PR1 #181 (mergée)** : classement à PLAT par
>   défaut — `sousDossierPourNom_` sans replis émetteur/catégorie/« Divers » (entité MAJEURE
>   canonisée, type d'identité, ou '' = racine du domaine), `deciderRoutageV2_` route '' à la
>   racine (le 2ᵉ repli « Divers » aurait neutralisé le fix), prompts v2 alignés aux 3 endroits.
>   **PR2** : campagne de CONSOLIDATION dry-run — NOUVEAU `src/Consolidation.gs` (plan → onglet
>   `PlanConsolidation` ; cible = domaine [+/AAAA si 02] [+/entité VALIDÉE] sinon plat ; identité →
>   dossier de TYPE ; doublons par empreinte de CAMPAGNE (jamais l'Index — auto-doublon ; jamais
>   les Properties — ~93 Ko > 9 Ko) ; garde §1 STRICTE → « Ignoré » avec constat ; convergence
>   `conso|<tag>|fileId` ; « terminé » sur passe vide). Flag `CONSOLIDATION_ACTIF: false` —
>   **Marc l'allume** (Réglages/Config) pour générer le plan, le VALIDE, puis l'exécution des
>   déplacements sera un chantier séparé. 572 tests moteur. **⚠ Marc : ajouter `src/Consolidation.gs`
>   aux sources NotebookLM.** À fournir : liste exacte des LOGEMENTS (pour valider les entités 03).
> • **2026-07-15 — C28-22 correctifs revue flotte (moteur + app + ADR).** Trois correctifs sur le
>   chantier C28-22 (déjà mergé, PR #175/#176/#177) : (1) le compteur 3-strikes d'abandon
>   d'intention (`creerIntentionIdempotente_`) est re-clé sur `api-intention|<messageId>` (avant :
>   sur le contenu incluant le titre LLM) — le titre Sonnet 2-passes fluctue d'un run à l'autre →
>   une clé par contenu ne convergeait jamais (mail re-tenté à vie, quota Gmail drainé, la panne
>   même que C28-22 bornait) ; journal désormais 1× (`=== seuil`). Compromis assumé : sémantique
>   PAR MESSAGE (compteur partagé entre intentions d'un même mail — une intention légitime rare peut
>   être perdue sur un mail ≥ 3 intentions en fenêtre de panne). (2) Nouvelle jauge télémétrie
>   `tri_boite_fils_jour` (nettoyage profond de la boîte) — moteur `lignesTelemetrie_`/`majTelemetrie_`
>   + app `interpreterTelemetrie`/Quotas (4ᵉ jauge de « Coûts & quotas »). (3) ADR-0022 aligné sur le
>   code (`−29 j`) + limite de `heuristiquePhishing_` documentée. 560 tests moteur + 179 app.
>   **Revue flotte (3 agents) : 🟢 sécurité, 🟢 quotas (convergence garantie), code-reviewer « prêt à
>   merger ».** Note hors-scope à suivre : le chemin EXTRACTION (`extraireIntentions_` null persistant)
>   n'est pas borné par un 3-strikes (pré-existant, atténué par `estPannePlateforme_`) — candidat au
>   prochain tour. À trancher avec Marc (archi) : budget Gmail AGRÉGÉ vs plafonds par-scan séparés.
> • **2026-07-15 — HUB : `GET /api/hub/summary` (widget DriveAI sur le hub perso, MERGÉ PR #178).**
>   100 % additif (aucune touche au moteur, à `app/` hors URL, ni aux scopes). NOUVEAUX
>   fichiers : `api/hub/summary.ts` (jeton `x-hub-token` temps constant → 503 hub disabled / 401 /
>   405, `Cache-Control:no-store`, forme du contrat `@mokarade/hub-contract` v1 inlinée car api/ =
>   zéro-dep) + `api/hub/_engineState.ts` (`getEngineState()` → `null` en Phase 0). Ancien
>   `api/hub-summary.ts` (+ rewrite `vercel.json`) SUPPRIMÉ au profit de la route native
>   `/api/hub/summary`. Phase 0 = summary honnête `status:"building"` (zéro métrique inventée —
>   les vraies données vivent dans la Sheet, lue côté navigateur, ADR-0007). Verrou
>   `app/test/hub-summary.test.ts` (VRAI schéma `validateSummary`/`buildingSummary`). URL canonique
>   **`https://drive.exemple.com`**. Marc a demandé « merge vite » → mergé (Vercel déploie en prod
>   sur push `main`). **⚠ Reste à ACTIVER côté Marc** (l'endpoint répond `503 hub disabled` tant que
>   non fait — échec fermé, sûr) : (1) poser `HUB_TOKEN` (Vercel, `openssl rand -hex 32`, même valeur
>   côté hub) ; (2) brancher le domaine `drive.exemple.com` sur le projet Vercel. Phase 1 (brancher
>   `getEngineState()` sur le Sheet) = tâche BACKLOG `HUB-P1`, bloquée par le moteur. **⚠ Marc :
>   ajouter `api/hub/summary.ts` + `api/hub/_engineState.ts` aux sources NotebookLM.**
> • **2026-07-15 — C28-25 : Cockpit Unique (plan architecte, PR #173)** : onglet « Mails » SUPPRIMÉ,
>   fusionné dans « Aujourd'hui ». Le seul bloc utile restant (20 derniers fils triés + ➕ création
>   de tâche/RDV depuis un fil) rapatrié en carte REPLIABLE (fermée par défaut, compte visible) ;
>   `Mails.tsx` supprimé (tuiles/suspects déjà dans l'accueil, table apprise dans Apprentissage) ;
>   barre basse mobile promeut Apprentissage (4 boutons + Plus) ; E2E 7→6 sections. Pur front, 174
>   tests app. **⚠ Marc : retirer `Mails.tsx` des sources NotebookLM.**
> • **2026-07-15 — C28-24 : UX instantanée + archivage total des lus + télémétrie (plan
>   architecte NotebookLM, 3 PR #167/#168/#169)** : (1) tri à la demande recentré — requête
>   FIGÉE `in:inbox is:read` (TOUS les mails lus, plus de fenêtre), offset de file MOUVANTE
>   (n'avance que des fils restés en boîte — `trierFil_` rapporte `'archive'`), plafond
>   quotidien 500 fils lus/j (patron C28-21), suspects ⚠/importants ⏰ toujours protégés par
>   `decisionTri_` ; (2) « pas suspect » instantané — anti-rafale 5 s RETIRÉ côté moteur,
>   tuiles/zone Attention re-rendues AU CLIC (store `useSuspectsVisibles`) ; (3) progression
>   SUR PLACE — OperationsLive vit dans PanneauActions ; (4) sidebar repliable en rail
>   d'icônes (☰, persistée) + table apprise déplacée vers Apprentissage (repliable) ;
>   (5) NOUVEL onglet Sheet `Télémétrie` (majTelemetrie_ au finally du tick) + NOUVELLE vue
>   « Coûts & quotas » (jauges des 3 scans plafonnés, coût LLM vs frein, note honnête : quota
>   Gmail FIXE ~20 000 lectures/j). 534 tests moteur + 174 tests app. NOUVEAU fichier :
>   `app/src/vues/Quotas.tsx` (source NotebookLM à ajouter par Marc).
> • **2026-07-10 — C28-18 retours Marc appliqués (#143/#144)** : « resté bloqué, manque d'info,
>   qualité visuelle » → deux langages visuels (ruban ANIMÉ = ça travaille ; piste RAYÉE statique
>   = à l'arrêt), note d'explication sous chaque état non trivial, heure moteur en tête, compteurs
>   non informatifs masqués, plafond 99 % hors vraie fin. Contre-vérif prod : m1 n'était PAS
>   bloquée (phase de recensement puis reprise, 5 docs re-classés 16:47-16:52) ; son recensement
>   coupé au budget a posé une base partielle (0) — la re-base absorbe, « terminé » viendra sur
>   passe vide puis C26-08 s'enchaîne seule.
> • **2026-07-15 — C28-23 : app v5 « Material Dark » + Agenda clone Google Agenda (plan
>   architecte NotebookLM, 3 PR #161/#162/#163)** : demande Marc (capture GCal fournie) « que
>   l'agenda ressemble exactement à ça et que le style de l'app épouse entièrement ce style
>   google », cadré par 12 questions. Livré : thème SOMBRE seul (theme.ts supprimé), layout
>   topbar + sidebar façon Google (FAB + Créer, mini-calendrier qui pilote le grand Agenda —
>   dateAgenda remontée dans App, « Mes agendas » trompe-l'œil sans scope §2.3), menu avatar ;
>   Agenda : grille horaire ABSOLUE Jour/Semaine/Mois (Semaine défaut), rangée toute-la-journée
>   multi-jours, ligne « maintenant », couleurs par type, mobile 3 jours glissants, clic-créneau
>   → création pré-remplie, popover d'événement/tâche façon GCal. Pur front, aucun scope, 171
>   tests app, captures E2E inspectées à chaque PR. NOUVEAUX fichiers : composants/Sidebar.tsx,
>   composants/MiniCalendrier.tsx (sources NotebookLM à ajouter par Marc).
> • **2026-07-14 — C28-22 : cadrage (boucle Tasks 403, arnaques → tâches, anciens mails)** :
>   l'API Google Tasks n'est PAS activée dans le projet GCP (403 depuis le 07/07, re-tenté à
>   chaque tick → quota Gmail drainé) ; mails d'ARNAQUE « Google Cloud 10 USD » transformés en
>   tâches par les intentions élargies ; mails en boîte > 30 j couverts par AUCUN scan. Actions
>   Marc : spammer les arnaques PUIS activer l'API Tasks (console GCP). Prompt NotebookLM livré
>   (plan d'implémentation attendu : échecs Tasks/Calendar bornés + garde suspect→jamais de
>   tâche + campagne arrière > 30 j).
> • **2026-07-13 — C28-21 : quota Gmail rendu au flux vivant + migration recentrée (plan
>   architecte NotebookLM, 2 PR)** : retours Marc « aucun mail archivé » (attente : lu ⇒ archivé
>   en ~min) + « tellement de fichiers Inconnu ». Diagnostic : quota Gmail drainé EN CONTINU par
>   la passe de VÉRIFICATION historique (964 fils re-parcourus depuis l'offset 0 à chaque retour
>   de quota — re-mort en 8 s-6 min, 2-11 fils triés/j) ; 2 944 fichiers « Inconnu » (v1) avec m1
>   à ~50-90 docs/j et c26-08 en attente derrière. Livré : (1) PR #153 — `estAMigrer_` ne
>   collecte QUE les noms portant « Inconnu » (tag `m2-inconnu`, barre re-recensée, c26-08
>   enchaîne à sa fin) ; (2) PR #154 — plafonds QUOTIDIENS dans l'unité réelle :
>   `GMAIL_HISTO_MAX_FILS_JOUR` 150 + `TRI_CYCLIQUE_MAX_FILS_JOUR` 150 (compteurs persistés par
>   jour, retour immédiat sans recherche au plafond ; fils comptés même sur page interrompue ;
>   page cyclique rétrécie au reliquat). Attendu dès demain : le tri/archivage vit TOUTE la
>   journée (~96 % du quota au flux vivant), la demande « Tri 7 j/100 fils » de Marc se sert au
>   retour du quota (~03h) ; m2-inconnu finit en jours puis c26-08 draine 03/08.
> • **2026-07-13 — C28-20 : zéro configuration client + verrou d'identité (ADR-0021, plan
>   NotebookLM)** : demande Marc « je veux rien avoir à mettre, juste mon compte Google ».
>   Livré : `/api/login` demande en plus `openid email` ; `/api/callback` compare l'email VÉRIFIÉ
>   de l'`id_token` à la variable Vercel `ALLOWED_EMAIL` — mismatch ⇒ AUCUN cookie, bannière
>   « accès refusé » ; NOUVEAU `api/config.ts` délivre `SPREADSHEET_ID`/`WEBAPP_URL`/
>   `WEBAPP_SECRET` (env Vercel) aux seules sessions au cookie déchiffrable (401 sinon) ;
>   `app/src/config.ts` refondu en mémoire de module (`chargerConfigServeur()` après connexion) —
>   écran Configuration, localStorage et `VITE_*` SUPPRIMÉS ; App.tsx séquence connexion → config
>   → vues. Scopes du MOTEUR Apps Script inchangés (aucune ré-autorisation). `session.test.ts`
>   INTACT, +6 tests bff + 5 tests handler callback (revue flotte : « promesse de verrou =
>   verrou codé »). **⚠ Marc doit poser 4 variables Vercel : `ALLOWED_EMAIL`
>   (prenom.nom@exemple.com), `SPREADSHEET_ID`, `WEBAPP_URL`, `WEBAPP_SECRET` — ET RÉGÉNÉRER
>   `COOKIE_SECRET` au même moment (trou de migration relevé en revue : un cookie de session
>   posé AVANT le verrou resterait valable 1 an et passerait /api/config ; la rotation invalide
>   tout, une reconnexion suffit). docs/DEPLOIEMENT.md §Phase 4 ; sans les variables,
>   « configuration indisponible » après connexion.**
> • **2026-07-13 — C28-19 : curation des mails (ADR-0020, plan NotebookLM)** : retours Marc
>   « facture sans tâche / lus non archivés / trop de faux suspects / pas de bouton ». Livré :
>   prompts intentions ÉLARGIS (facture à payer / action requise ⇒ tâche Tasks + ⏰ en boîte) ;
>   `scanCycliqueTri_` (offset persistant qui fait le tour de la boîte 30 j en ~30-60 min — un
>   fil lu tardivement finit TOUJOURS re-trié donc archivé ; scan avant + mur conservés pour la
>   latence du neuf, déviation documentée) ; onglet `Confiance` + `decisionSuspect_` PURE
>   (le clic « ✓ Pas suspect » de l'app apprend l'expéditeur — outrepasse heuristique, LLM et ⚠
>   déjà posé ; le libellé Gmail physique reste, §2.3) ; `actionPasSuspect_` (doPost) + purge/
>   re-tri sous le verrou du tick. Audit §8.5 sur les 5 faux positifs réels. **⚠ Marc doit
>   REDÉPLOYER la web app (« Nouvelle version ») pour activer le bouton.** La règle d'archivage
>   est INCHANGÉE (archivé une fois lu — décision re-confirmée).
> • **2026-07-10 — C28-18 : progression LIVE des opérations (plan NotebookLM)** : l'onglet
>   `Progression` devient un tableau multi-opérations (7 colonnes) écrit UNE fois par tick dans le
>   `finally` (`majProgressions_` — les avancées partielles d'un run interrompu comptent aussi) ;
>   l'app le lit en poll dédié 15 s HORS cache (≈ 4 req/min, ~1 % du quota Sheets) et l'accueil
>   affiche un widget par opération : barres m1/C26-08 (bases posées par un recensement DÉDIÉ,
>   filet du compte partiel), tri/intentions à la demande (x/plafond, instantané « solde » si servi
>   en un tick), historique Gmail (indéterminé), statuts dérivés en toutes lettres (suspendu quota
>   Gmail / pause frein budget / en attente après m1 / terminé, purge 48 h). L'ancienne barre texte
>   du rangement est retirée (état Properties conservé). Attention au 1ᵉʳ tick post-déploiement :
>   m1 marque une pause de 1-3 ticks (recensement de sa base) avant de reprendre.
> • **2026-07-10 — C28-17 : accueil v4 « cockpit central » (ADR-0019, plan NotebookLM)** : Marc
>   trouvait le bouton de tri « trop inaccessible, trop bas » et le dashboard « trop compliqué ».
>   Accueil TOUT-EN-UN en 3 zones : (1) `composants/PanneauActions.tsx` PARTAGÉ (accueil + haut de
>   Mails) — « Vérifier maintenant » remonté du header + intentions 30 j + tri paramétré + analyse
>   ciblée ; (2) zone ATTENTION (contour ambré) — suspects, documents « à vérifier » (nouveau
>   sélecteur `lignesAVerifier`), entités à valider avec « Aller valider » → Apprentissage ; tout
>   vide ⇒ « Tout est à jour ✅ » ; (3) zone ACTIVITÉ discrète (l'existant v3). Décisions Marc :
>   Trier/Analyser/Vérifier en 1 clic (pas la Recherche IA), priorité au « à faire », mobile et
>   desktop à parts égales. Vérifié par captures (desktop + 390px). Purement front — rien à
>   redéployer côté moteur.
> • **2026-07-10 — C28-16 : panneau « Analyser & trier » (vue Mails)** : Marc déclenche à la
>   demande les intentions (30 j complets, mur déjà-vu ignoré) et le tri Gmail PARAMÉTRÉ
>   (fenêtre 1/7/30 j, archiver oui/non, plafond de fils) — demandes posées par la web app
>   (`demande-tri`/`demande-intentions`), consommées par le tick en TÊTE du flux vivant,
>   étalées sur plusieurs ticks (offsets persistés). Clic pendant une suspension de quota =
>   UNE re-sonde forcée ; toujours mort → « QUOTA_GMAIL » affiché en clair avec l'heure de
>   reprise. **✅ VALIDÉ en prod par Marc (« ok ça a lancé »)** après redéploiement de la web
>   app et correction du secret/URL (piège : « Nouveau déploiement » CHANGE l'URL `/exec`).
> • **2026-07-10 — C28-15 : mails ni triés ni archivés → ordre d'équité strict + suspension
>   quota Gmail (plan NotebookLM, décisions Marc « équilibre strict » + « tout rattraper »)** :
>   le quota d'appels Gmail mourait dès ~08h10 (campagne historique) et le tri était affamé
>   toute la journée (4-17 fils/j au lieu de ~90). Correctifs : intentions + tri REMONTÉS avant
>   toutes les campagnes dans le tick ; suspension persistée `DriveAI_GMAIL_QUOTA` (re-sonde 2 h,
>   patron R2) câblée dans TOUS les scans Gmail ; budget quotidien de l'historique 60 → 20 min/j
>   (déviation documentée : la page fait 10 fils, le frein 50 fils/run du plan est inerte seul) +
>   frein `GMAIL_HISTO_MAX_FILS_PAR_RUN`. Attendu : tri fiable dès demain matin ; l'historique
>   finit plus lentement (prix accepté). ✅ Vérifié en prod le 10/07 : UNE ligne « QUOTA GMAIL
>   ÉPUISÉ » à 11:10 puis silence (suspension propre, fini le re-spam) ; rattrapage cette nuit.
> • **2026-07-10 — frein campagnes 65 → 110 $ (décision Marc « b », révision ADR-0018)** : m1 a
>   basculé en v2 avec l'allumage du flag (coût/doc ×10 — 54,59 $ au compteur le 10/07 matin,
>   1 209 docs migrés, 0 « Inconnu » produit par la v2 depuis la reprise). À 65 $ tout se serait
>   suspendu jusqu'au 1ᵉʳ août ; Marc préfère finir cette semaine (~40-50 $ restants : fin m1
>   puis C26-08 sur 03/08). Stock `_Inconnu` restant : 1 210 docs, drainé par les 2 campagnes.
>   REDESCENDRE le plafond à 10 à la fin (le Journal dira « Re-analyse v2 ciblée terminée »).
> • **C28-14 — session durable (« me connecter une fois »)** : fini GIS — flux Authorization Code
>   via 4 fonctions serverless Vercel (`api/` racine, zéro dépendance), refresh token en cookie
>   HttpOnly CHIFFRÉ (COOKIE_SECRET), access token en sessionStorage (verrou session.test.ts
>   INTACT), restauration silencieuse au chargement + rejeu auto sur 401, clientId retiré du
>   client. **Configuré et VALIDÉ par Marc le 2026-07-09** (URI de redirection
>   `https://app.exemple.com/api/callback`, 3 variables Vercel posées, Redeploy fait,
>   test « onglet fermé/rouvert → connecté sans clic » concluant). Détail : DEPLOIEMENT.md §Phase 4.
> • **C26-08 CODÉE (décision Marc « go 2ᵉ option », plan NotebookLM, ADR-0018)** :
>   `ANALYSE_V2: true` (flux vivant en Sonnet 2 passes), `DRYRUN_V2_ACTIF: false` (clos),
>   `LLM_BUDGET_CAMPAGNES` 30 → **65 $** (temporaire — **redescendre à 10 à la fin de C26-08**,
>   checklist dans l'ADR). Campagne `reanalyse|c26-08|` sur `REANALYSE_CIBLES` = `03 · Logement`
>   (186 docs) + `08 · Perso` (738 docs) ≈ 24 $ : même mécanique que m1, démarre SEULE à la fin
>   de m1 (garde `DriveAI_MIGRATION`), 03/08 exclus de m1 dès ce merge (jamais payés 2×).
>   Fin de campagne = Journal « Re-analyse v2 ciblée terminée (tag « c26-08 ») ».
> • **C26-07 TERMINÉ (100/100 le 08-07 18:33, coût mesuré 2,61 $)** — rapport avant/après complet
>   livré à Marc (artifact « Dry-run v2 — preuve avant/après »). Chiffres : **0 fail-safe** (la revue
>   reste l'exception, 0/100), confiance médiane 0,93 (2 docs < 0,7), 22 changements de domaine
>   proposés dont 3 refusés par le garde zone protégée (§2.1b) → **19 applicables**, 62 renommages
>   (titulaire sur les papiers d'identité : `Passeport_Préfecture…` → `Passeport_Prénom NOM`),
>   76 sous-dossiers d'entité, 24 non-documents écartés (`_Médias`/`_Technique`).
> • **Panne de crédit Anthropic du 08-07 ~21:40 → rechargée par Marc le 09-07 ~14h** (HTTP 400
>   « credit balance » à chaque re-sonde horaire pendant ~16 h ; le filet R2 a fonctionné : sources
>   suspendues, re-sonde 1×/h, AUCUNE quarantaine à tort, zéro coût brûlé). Reprise auto ≤ 1 h
>   après recharge — vérifier par signaux Drive (docs classés au Journal, file À trier qui bouge).
>   Nota : le Journal répétait « 12 document(s) re-classé(s) (m1) » chaque heure PENDANT la panne —
>   libellé trompeur (soumissions qui échouent vite, rien d'inscrit), comportement correct ;
>   les nouveaux messages Réanalyse disent « soumis » (correctif appliqué à C26-08, pas à m1).
> • **Fusion « 07 · Perso & projets » → 08 SOLDÉE** : `terminerFusionDomaine07` exécutée par Marc
>   (11 Entités + 349 Domaine + 340 Chemin ré-étiquetés) ; contre-vérifiée sur export xlsx —
>   0 occurrence restante dans Entités et les colonnes Domaine/Chemin (survivances = historiques
>   inoffensives : noms `[REVUE]` de juin, onglet Revue pré-ADR-0016, bilan Journal).
> • **Incident Sheet 100 % clos** : Sheet incident renommée puis CORBEILLÉE par Marc (réparation
>   re-portée avant), `DriveAI_extract_temp` (orphelin d'une coupure — `Ocr.gs` le supprime
>   normalement en `finally`) corbeillé aussi.
> • **Artefacts DriveAI rangés sous `08 · Perso & projets/DriveAI`** (demande Marc, plan NotebookLM
>   validé + contre-vérifié dans le code) : Sheet d'état, projet Apps Script, formulaire de
>   correction — tous natifs Google (invisibles des collecteurs, `Maintenance.gs:291`) et résolus
>   par ID (aucun code touché, zéro interruption vérifiée par heartbeat post-déplacement).
>   **`_Doublons` et `_Miroir du dépôt` restent à la racine de `Nouvelle structure 2026`** : les
>   collecteurs de masse parcourent récursivement chaque domaine — les nicher sous 08 ferait
>   aspirer leur contenu vers `00 · À trier`. Règle : jamais de fichier NON-natif sous `08/DriveAI`.
> • Rangement ancien Drive : 100 % (2 802/2 802, terminé ✅). Captures : `captures-app.pdf` arrivé
>   dans le miroir (sync #39) — source NotebookLM à ajouter par Marc.
>
> **2026-07-08 (fin de soirée) — ANOMALIES PROD corrigées (PR #126).** Deux constats chiffrés sur
> l'état réel : (1) ~9 fichiers « Access denied » re-tentés par le rangement à CHAQUE tick →
> `deplacerVersATrier_` passe les échecs par `gererEchec_` (quarantaine après 3, clé `drive|` qui
> stoppe la re-collecte — la Relance app = chemin de retour) et inscrit les fichiers protégés une
> fois (`zone protégée`) ; (2) domaine AUTO erroné « 07 · Perso & projets » (340 docs) doublonnant
> le canonique 08 → **`fusionnerDomaine07PersoVers08`** (Maintenance.gs, one-shot manuel,
> reprenable) : **Marc doit l'exécuter dans l'éditeur APRÈS le merge et AVANT C26-08.** Aussi :
> quota Gmail du jour épuisé par l'incident (tri en pause, reprise auto ~03:00) ; 93 % des docs
> classés sont à la RACINE de leur domaine (2 421/2 607 — attendu en v1, c'est C26-08 qui rangera
> en sous-dossiers) ; dry-run 33/100, surveillance horaire armée.
>
> **2026-07-08 (soir) — PLANS P1/P2/P3 EXÉCUTÉS + ⚠ INCIDENT PROD (Sheet d'état recréée à vide).**
> • **⚠ INCIDENT (ouvert, décision Marc attendue)** : à 02:34 EDT, un échec TRANSITOIRE de
>   `SpreadsheetApp.openById` (dégradation Google, `Access denied: DriveApp` en rafale au même
>   moment) a déclenché le fail-open de `getSheetEtat_` (src/Config.gs:524) : **nouvelle Sheet
>   « DriveAI — État » créée VIDE + `DriveAI_SHEET_ID` écrasé**. Depuis : le moteur tourne sur la
>   NOUVELLE Sheet (Index reparti de 0 — 254 lignes re-faites, ~87 PJ Gmail re-déposées en
>   copies/doublons dans Drive, file d'entités re-proposée, TriAppris re-appris, +~0,8 $ LLM) ;
>   l'ancienne Sheet (4 385 lignes, les validations de Marc) est ORPHELINE — et l'**app de Marc
>   pointe toujours l'ancienne** (ses gestes n'atteignent plus le moteur). Le dry-run v2 écrit
>   dans la NOUVELLE (démarré après la bascule — pas de fork pour lui). AUCUNE perte définitive
>   (append-only, rien de supprimé). Correctif + fusion d'état = prompt NotebookLM généré (règle
>   §4), plan architecte validé puis EXÉCUTÉ. IDs : ancienne
>   `<id Drive>`, nouvelle
>   `<id Drive>`. Livré : `getSheetEtat_` ÉCHEC FERMÉ (jamais
>   de re-création quand l'ID existe — tripwire `test/sheet-etat.test.js`) + `reparerIncidentSheet`
>   (Maintenance.gs, SANS `_` final sinon masquée de l'éditeur) : réparation UN CLIC — inédits
>   re-portés dans l'ancienne Sheet, copies de rejeu écartées dans `_Doublons` (protégés laissés
>   en place, original jamais touché grâce au filtre date de création), Journal+DryRunV2 fusionnés,
>   bascule `DriveAI_SHEET_ID`, marqueur d'idempotence DUR (jamais 2 passages).
>   **RESTE : Marc exécute `reparerIncidentSheet` dans l'éditeur Apps Script après le merge.**
> • **P1 (#122, mergé)** : jeton GIS en sessionStorage (verrou source-scan `session.test.ts`),
>   fournisseur d'état GLOBAL (`etatGlobal.tsx`, 5 min + ⟳), Index servi en ÉTAT COURANT
>   (`etatCourantIndex` — suspects honnêtes, C28-13), badge « Synchro HH:MM », dates formatées.
> • **P2 (#123, mergé)** : vue Agenda Mois/**Semaine** (`grilleSemaine`), carte « Créer » en tête
>   + composant réutilisable, « ➕ » par fil Gmail (modale pré-remplie + marqueur
>   `intention-manuel|<threadId>` que le moteur saute — préfixe DÉDIÉ, collision threadId=1er
>   messageId évitée), **analyse ciblée des mails** (formulaire → `action=analyse-ciblee` →
>   `balayerAnalyseCiblee_`, campagne frein-budget/plafonds, anti-plateau, offset lié à la
>   requête). **⚠ Marc doit redéployer la web app (Nouvelle version)** pour activer l'action.
> • **P3 (en PR)** : drag-and-drop accéléré (ascendances dossiers mémoïsées, invalidation de
>   cache par onglet, traces Sheet en tâche de fond) + **réconciliation Index↔Drive**
>   (`synchroniserIndex_`, campagne perpétuelle bornée/convergente, statuts `déplacé`/`corbeillé`).
> • Dry-run v2 : continue de remplir l'onglet `DryRunV2` (nouvelle Sheet) — validation Marc
>   attendue avant C26-08.
>
> **2026-07-08 (après-midi) — GROSSE RAFALE : dry-run LANCÉ, 3 plans NotebookLM exécutés,
> captures E2E, miroir COMPLET à plat.** Sur feu vert de Marc, PR #114-#120 toutes mergées :
> • **Dry-run v2 EN COURS** (`DRYRUN_V2_ACTIF: true`, #114) — l'onglet Sheet `DryRunV2` se
>   remplit (~100 docs, ~3-6 $) ; à valider par Marc, puis C26-08. Repasser le flag à false après.
> • **P5 (#115)** : panne API DURABLE (429/529/5xx en série, seuil `LLM_ECHECS_SYST_MAX`) → même
>   suspension/reprise auto que la panne de crédit. • **P4 (#118)** : canonicalisation des entités
>   sur le chemin VIVANT + « reality check » Drive (`dossiersExistantsDomaine_`) + curation
>   rétroactive (tag `c2`) — la file d'apprentissage se nettoie seule (« NOM Prénom » déjà
>   refusé en prod). • **C28-14 (#116)** : captures d'écran des 6 sections à chaque push (mode
>   mock `VITE_E2E_MOCK`, artifact CI `e2e-screenshots`, zéro fuite prod prouvée). • **Miroir
>   révisé 2× (#117, #119)** : À PLAT (`src---Router.gs.txt` — NotebookLM sélectionne sur un
>   niveau) puis COMPLET (binaires utiles pdf/png/jpg/svg en base64 + PATCH REST en place ;
>   allowlist stricte). • **2 fixes d'incident sync (#119, #120)** : les pannes transitoires
>   d'Apps Script /exec ont DEUX signatures (404 ET 200+HTML « doGet ») → succès d'un lot = JSON
>   `ok:true`, rejoué 3×, échec réel = run rouge (leçon durable CLAUDE.md §7). RESTE : Marc doit
>   refaire « Nouvelle version » (web app figée pré-#119) pour le binaire svg ; plans NotebookLM
>   **P1** (session+fraîcheur+UI), **P2** (agenda/tâches-mails), **P3** (vitesse+réconciliation
>   Index↔Drive) validés, À EXÉCUTER. Chantier #28 = table de triage des 13 retours (BACKLOG).
>
> **2026-07-08 (matin) — GOUVERNANCE : analyse déléguée à NotebookLM (règle stricte, CLAUDE.md
> §4).** Marc a dicté (PR #111) : NotebookLM (qui lit le miroir Drive) = analyse architecturale &
> décision ; Claude = exécution. Pour toute nouvelle tâche de code : générer un prompt NotebookLM
> copiable, s'ARRÊTER, attendre le plan validé collé par Marc — voir CLAUDE.md §4 (⛔). S'ajoute :
> nouveau fichier créé ⇒ prévenir Marc d'ajouter la source NotebookLM (CLAUDE.md §3). Le triage
> factuel des 13 retours produit de Marc est au chantier #28 du BACKLOG.
>
> **2026-07-07 (nuit) — ADR-0017 : MIROIR DRIVE du dépôt (accès de partout + NotebookLM) — TERMINÉ.**
> Marc a d'abord demandé de remplacer GitHub par Drive comme dépôt — refusé et expliqué
> techniquement (Drive n'a pas de sémantique git, tout le CI/CD en dépend). Vrai besoin clarifié :
> accès de partout (déjà GitHub web/mobile) + une copie DANS Drive parce que **NotebookLM lit ses
> sources depuis Drive**. Livré : `src/Miroir.gs` écrit une copie `.txt` de TOUT le dépôt dans
> `_Miroir du dépôt` (Drive de Marc), via la web app déjà déployée (`doPost`, action
> `sync-miroir`) — **aucun nouveau scope OAuth**. Secret DÉDIÉ `DriveAI_SYNC_SECRET` (Property),
> JAMAIS le même que `DriveAI_WEBAPP_SECRET`. Workflow `.github/workflows/sync-drive.yml`
> dispatché par `auto-merge.yml` (comme `deploy.yml`). Mergé (PR #107), +12 tests (`miroir.test.js`).
> **Config Marc faite** (Property + 2 secrets GitHub + accès web app « Tout le monde »). Le PREMIER
> SYNC RÉEL a révélé 3 pièges invisibles hors prod, tous corrigés (PR #108, voir leçon
> `docs/LESSONS.md` 2026-07-07 « Miroir Drive : 2 pièges curl » + leçon durable `CLAUDE.md` §7) :
> 1. **405 systématique** — `curl -X POST -L` verrouillait POST sur la redirection 302 d'Apps
>    Script (`/exec` → `script.googleusercontent.com/macros/echo`, qui n'accepte que HEAD/GET).
>    Corrigé : retrait de `-X POST`.
> 2. **« Argument list too long »** sur les gros lots — payload passé en argument shell dépassait
>    `ARG_MAX`. Corrigé : payload écrit dans un fichier, `--data-binary @fichier`.
> 3. **Secret « refusé » persistant** malgré 2 vérifications de Marc — pas un problème de secret :
>    diagnostic temporaire (longueurs comparées, jamais le contenu) a révélé que la web app
>    `/exec` servait une version FIGÉE (piège déjà documenté `docs/DEPLOIEMENT.md`, confirmé
>    s'appliquer aussi à un déploiement `workflow_dispatch` sur une branche). Résolu par le
>    redéploiement manuel de Marc (Nouvelle version).
> **Validé en prod à 2 reprises** : sync complet (169 fichiers, 0 ignoré, 0 erreur) une fois sur la
> branche (code de diagnostic retiré avant merge), puis une seconde fois sur `main` après le merge
> #108 + le `clasp push` auto + le redéploiement manuel de Marc — confirmant que le pipeline
> complet (push → CI verte → auto-merge → dispatch `deploy.yml` → redéploiement manuel) fonctionne
> de bout en bout. Le miroir Drive (`_Miroir du dépôt`) est maintenant à jour et se resynchronisera
> à chaque merge sur `main`. Chantier #27 clos.
>
> **2026-07-07 (soir) — Chantier #26 : REFONTE de l'analyse documentaire (demande Marc « fiabilité
> maximale »).** Diagnostic prod accablant (65,6 % d'émetteurs « Inconnu », vols → Administratif,
> exports Facebook jusqu'en Immigration, 285 entités en vrac — le propriétaire lui-même ×4, Véhicule A ×3).
> Conçu + validé par workflow (14/14 cas, revue adversariale 7 correctifs), PUIS **prouvé sur 38 vrais
> documents en 2 itérations** (artifact avant/après présenté à Marc, qui a validé). La v2 tient les 2
> exigences RELEVÉES de Marc : **0 « Inconnu »** (descripteur précis à la place) et **0 document à la
> racine d'un domaine** (tout en sous-dossier, entité unifiée d'abord — « l'IUT = 1 seul dossier » ;
> captures sans valeur → `_Médias`). LEÇON HONNÊTE de la preuve : **0/21 émetteurs réellement récupérés**
> — la plupart des « Inconnu » sont LÉGITIMES (CV/notes/devoirs perso sans émetteur) ; le vrai gain est
> la CORRECTNESS (bon domaine : 11 corrigés ; non-docs écartés ; identité par type ; entités fusionnées ;
> descripteurs parlants), pas le remplissage d'émetteur. **LIVRÉ + testé (fondations pures, interrupteur
> éteint, 337 tests, PR #92→102)** : `09 · Voyages` ; canonicalisation/fusion d'entités
> (`canoniserEntite_`, `estProprietaireMarc_`, `cleCanoniqueEntite_`, `estFusionnableEntite_` durci
> Marque X≠Véhicule A) ; titulaire/identité + anti-écrasement ; descripteur (jamais Inconnu) +
> `sousDossierPourNom_` ; `decisionNonDocument_` (identité jamais média-isée, export jamais sous 04).
> **C26-05 + C26-06 CODÉS (2026-07-07 soir), DERRIÈRE LE FLAG `CONFIG.ANALYSE_V2` (= false)** — le
> flux vivant reste sur Haiku 1 passe tant que Marc n'a pas donné son FEU VERT. **C26-05** (`Llm.gs`) :
> prompts `PROMPT_PASSE1`/`PROMPT_PASSE2` (issus de la preuve validée), `classifierDeuxPasses_` +
> `appelAnthropicV2_` (Sonnet ×2, anti-régression passe2→passe1), parser étendu `normaliserChampsV2_`
> (réponse Haiku laissée INTACTE), texte OCR moins tronqué (`ANALYSE_V2_OCR_MAX_CARS` 12000). **C26-06**
> (`Router.gs`/`Pipeline.gs`) : `planRoutageV2_` (cœur PUR) + `deciderRoutageV2_` (I/O) — non-document
> écarté (jamais un domaine, jamais 04), identité par type, sous-dossier obligatoire (entité unifiée),
> nom via `nommerDocument_` (jamais « Inconnu »), anti-écrasement `garantirNomUnique_`. Gate au Pipeline
> `CONFIG.ANALYSE_V2 ? deciderRoutageV2_ : deciderRoutage_`. **Coût correctement compté Sonnet** (le frein
> §2.6 pausera la campagne). **MERGÉ PR #104** (revue flotte : sécurité 🟢, code/quotas OK). **DURCI
> ensuite (ADR-0015, PR suivante)** sur retours de revue, toujours flag ÉTEINT : (1) `parserClassification_`
> tolère `domaine:null` pour un NON-document v2 (sinon quarantaine à tort d'un export) ; (2) prompt v2
> clarifié (non-doc → `domaine` peut rester null) ; (3) garde-temps abaissé sous v2 `budgetMsRun_()`
> (`ANALYSE_V2_BUDGET_MS` 180 s, anti-mur 6 min + anti-2ᵉ-copie) ; (4) sous-dossier v2 assaini par
> `champ_`. **PRÉ-REQUIS d'allumage (ADR-0015)** : campagnes closes, plafond budget revu, surveillance
> runtime/coût, feu vert coût de Marc. +5 tests (parser non-doc, garde-temps), **359 verts. RESTE :
> C26-07** dry-run à grande échelle (obligatoire, protocole §2) ; **C26-08** campagne de re-analyse
> (budget/jour, déplacement seul, reprenable) ; **C26-09** app + §6 budget. ⚠️ **NE PAS allumer
> `ANALYSE_V2` ni lancer la campagne sans le feu vert coût de Marc** (~×10-20/doc ; campagne ~70-100 $).
>
> **✅ CONFLIT RÉSOLU → FAIL-SAFE HYBRIDE (2026-07-07, ADR-0016, décision Marc « hybride ultra-strict »).**
> Son « Protocole de précision » voulait rouvrir `00 · À vérifier` (contredisait §2.1). Réconcilié :
> un doc part en revue **UNIQUEMENT si l'analyse est TOUT-NULL** — `domaine` inconnu **ET** `emetteur`
> **ET** `type_doc` tous absents (`estClassificationVide_`, PURE). Un seul fait présent ⇒ classé au mieux.
> La conjonction **ET** = anti-saturation (leçon vécue). Livré ATOMIQUEMENT : ADR-0016 + CLAUDE.md §2.1
> révisé + §8 (protocole de précision) + code (`deciderRoutage_` live + `planRoutageV2_`, garde identité)
> + tests. **Preuve (protocole phase 1)** : `test/audit-logique.test.js` prouve **0/20 documents réels**
> déclenchés (anti-saturation), contre-épreuve OK. Faux-positifs historiques (CV/note/export) en
> non-régression. **370 tests verts.** PR **draft + `do-not-merge`** (révision de garde-fou → attend le
> feu vert explicite de Marc pour merger). Reste : consolidation docs (project-status.md/coding-standards.md)
> sur feu vert ; C26-07/08/09 (dry-run + campagne + app) inchangés.
>
> **2026-07-07 — Tri Gmail : recalibration du signal ⚠️ Suspect (demande Marc « trop de suspects »).**
> 14 fils marqués ⚠️, dont 13 FAUX POSITIFS (alertes Google/Anthropic, codes 2FA + réclamations
> Bellerives, le propre mail envoyé de Marc, sa famille). Cause : le prompt LLM assimilait
> « urgence/identifiants/paiement » à du phishing → tout mail transactionnel légitime flaggé. Refonte
> (workflow validé par 3 juges : 14 → ~1 faux positif, 8/8 phishing détectés) : prompt haute-barre
> (suspect exige un signal de TROMPERIE sur l'IDENTITÉ du domaine — sosie/typosquat, webmail posant en
> institution, arnaque manifeste — jamais le ton) + 2 gardes déterministes (G1 : le mail de Marc jamais
> suspect ; G2 : expéditeur déjà appris jamais requalifié par le LLM seul, sauf chemin dangereux promo).
> Signal DMARC ABANDONNÉ (la revue sécu a trouvé une injection de prompt possible). Le moteur ne retire
> jamais un libellé (garde-fou) → Marc décoche à la main les 14 existants (recherche `label:"⚠️ Suspect"`).
> 310 tests. **EN COURS (demande Marc, priorité)** : refonte MAJEURE de l'analyse documentaire (65 %
> d'émetteurs « Inconnu », mauvais domaines, entités en vrac — Marc lui-même ×4, génériques, doublons
> Véhicule A ×3). Décisions actées : Sonnet + 2 passes + texte complet ; re-analyser tout l'existant
> (~2400 docs, ~80-150 $) ; reconstruire entités (fusion variantes) + taxonomie (ajout domaine 09
> Voyages) ; documents d'identité groupés PAR TYPE (dossier « Passeport »/« Permis » contenant Marc ET
> les autres — PAS de dossier _Tiers). Workflow de conception en cours.
>
> Antérieur — **2026-07-07 — Correctif R3 : « la file 00·À trier ne se draine pas »
> (demande Marc).** Diagnostic par signaux indépendants (listing Drive + export xlsx de la Sheet) :
> un PDF déposé est resté 11 h (~130 ticks) — QUATRE causes cumulées : (1) famine d'équité (le
> rangement re-alimente la file, l'itérateur Drive sert les récents d'abord) ; (2) 32 quarantainés
> de la panne du 01-07 sautés en silence à vie ; (3) 2 Google Sheets natifs sans lecteur ; (4)
> **budget §2.6 CREVÉ (15,62 $ le 07-07)**. Livré (BACKLOG § Correctif R3, R3-01→05) : page
> d'intake = TRAITABLES seulement + FIFO ancien→récent (tri avant troncature) ; dé-quarantaine AUTO
> one-shot (`DEQUARANTAINE_TAG`, noyau `dequarantainerLignes_('drive|')` — jamais `dequarantaine()`
> depuis le tick : réentrance), ré-armée par un rétablissement de panne ; natifs Docs/Sheets/Slides
> classés (export texte REST, empreinte sur texte ENTIER, `ignorerDoublon` sous 20 cars ; échec
> d'export = échec compté ; type sans export = indexé `natif`) ; **frein budget campagnes**
> (`LLM_BUDGET_CAMPAGNES` : rangement/historique/migration en pause au-delà — le flux vivant dont
> la file de Marc CONTINUE ; **plafond relevé 10 → 30 $ le 07-07, décision Marc « je veux que tu
> continues le tri au complet » → le rattrapage reprend et finit ce mois-ci ; cible croisière
> < 10 $ maintenue, §2.6 révisé**). Revue flotte 4 agents :
> 3 bloquants réels corrigés (306 tests). À VÉRIFIER post-déploiement par signaux Drive : PDF
> `<id Drive>` classé, 32 quarantainés relancés, 2 Sheets natifs classés.
> Info : racine sup `…` (RANGEMENT_RACINES_SUP) inaccessible. Rappel Marc encore ouvert :
> lancer `rattraperMediasMalClasses()` si pas fait.
>
> Antérieur — **2026-07-06 (soir)** — **C16 LIVRÉ : tri Gmail natif (ADR-0012), scope
> `gmail.modify`.** PR #66 (2 rondes adversariales, 4 lentilles) : `TriGmail.gs` — libellés existants
> + archivage réversible au fil de l'eau, idempotence par ÉTAT (`tri|fil|ts|lu/nonlu` : un mail lu
> APRÈS son tri est re-trié donc archivé), rattrapage du stock 30 j par ancre FIXE + offset (ensemble
> figé), phishing → `⚠️ Suspect` (reste en boîte), promos non lues archivées sur signaux DÉTERMINISTES
> (List-Unsubscribe ET catégorie Gmail), table `TriAppris` (apprentissage restreint anti-empoisonnement),
> panne d'écriture SYSTÉMIQUE, verrou CI durci (corbeille/Spam/suppression/retrait de libellés interdits,
> service avancé + REST Gmail bannis, tripwire scope↔CLAUDE.md). Constitution §2.3 mise à jour (la
> lecture seule est levée, décision Marc). **Après le merge : ré-autorisation manuelle par Marc
> (tickDriveAI) obligatoire — tous les déclencheurs sont gelés d'ici là** ; puis vérifier la reprise
> par signaux Drive et les premiers libellés ; ensuite Marc supprime sa tâche Cowork. Suivi prod (vérifié par Journal exporté, 13h ET) :
> ✅ **Crédit API rétabli et VÉRIFIÉ de bout en bout le 6/7 13:35 ET** (sonde : fichier test déposé
> dans 00·À trier → classé au 1ᵉʳ tick « 2026-07-06_Attestation_DriveAI.txt → 08·Perso », coût 7,33→7,34 $).
> Découverte : **90 documents quarantainés à tort** pendant la panne du 2/7 (dont ~68 médias Messenger
> coincés dans 00·À trier → file ≥ 40 → rangement AFFAMÉ depuis le 2/7) — `dequarantaine()` est LE geste
> qui débloque : médias → _Médias (sans LLM), file < 40, le rangement (804 restants) reprend. Historique
> de l'épisode : la recharge n'avait pas pris effet avant ~13h le 6/7 — — 291 « PANNE DE COMPTE (400 credit balance) »
> depuis le 5/7 00:00, zéro « RÉTABLI » ; Marc doit vérifier console.anthropic.com → Billing (bon
> workspace ? paiement passé ? crédits API ≠ abonnement Claude). Conséquence : quota Gmail du jour
> re-épuisé à 07:25 par les runs stériles du matin (code pré-R2 encore déployé à ce moment-là) ;
> reset ~03h ET. Le tri #16 est correctement différé (« Tri Gmail différé », l'intake n'est pas bloqué)
> et ne montrera ses premiers libellés qu'après quota + crédit rétablis. `dequarantaine()` et Script
> Property `DriveAI_EMAIL` toujours à poser côté Marc (131 alertes perdues + résumé hebdo perdu le 6/7). Chantiers suivants
> actés : #18 (entités auto-validées à 3 occurrences) puis #17 (confiance visible dans l'app).
>
> **Suite 2026-07-06 (fin de journée)** : `dequarantaine()` + `DriveAI_EMAIL` posés par Marc → drainage
> VÉRIFIÉ en direct (68→47 fichiers en 10 min, reçus Marque K photographiés OCR+classés) ; rangement reprend
> dès que la file < 40. Tri Gmail : démarre seul au reset de quota (~03h ET). **Chantier #19 lancé —
> App v3** (refonte complète, cadrage 4 réponses du propriétaire) : maquette « trois directions » livrée
> (artifact), attente du choix A/B/C. Voir BACKLOG #19.
>
> **2026-07-06 (nuit) — CHANTIER #19 LIVRÉ : App v3 « Salle des machines » complète** (PR #73→#78,
> une PR par étape, app utilisable à chaque merge) : socle tokens sombre/clair + 6 sections + mobile ;
> Aujourd'hui (tuiles, suspects/tris cliquables → Gmail) ; Agenda (grille mois réelle, tâches Google
> cochables, création directe — scopes APP tasks+calendar.events, consentement navigateur au prochain
> login) ; Mails (tri #16 visible, TriAppris corrigeable par vidage de cellules) ; Documents +
> **confiance #17** (colonne H Index côté moteur, badge + filtre côté app, verrou vie-privée à
> 8 colonnes) ; Santé (quota Gmail dérivé du Journal, quarantaine+relance). Verrou app durci :
> jamais DELETE, jamais status:cancelled, jamais /clear. Chantier #18 (entités auto à 3) = prochain.
>
> **2026-07-06 (fin de soirée) — #20 livré** : incident « Personne T » corrigé (garde de confiance photo
> + `rattraperMediasMalClasses()` à lancer par Marc), retry 429, cache lecture 60 s, tooltip graphe,
> bouton « Vérifier maintenant » (web app à déployer — DEPLOIEMENT.md). Nouvelles demandes Marc à
> cadrer : #21 explorateur Drive + réorg IA (⚠ suppression de dossiers ↔ §2), #22 fréquences
> configurables, #23 peaufinage UI (Agenda façon Google Calendar). Questions posées.
>
> **Cadrage acté (réponses Marc, fin de session 06-07)** : #21 réorg IA = proposition → validation →
> déplacements seuls + corbeille des dossiers VIDES validée (révision étroite §2, ADR-0014 à écrire) ;
> #22 = un réglage global du tick via l'app/Sheet ; #23 = Agenda façon GCal + plus aéré + transitions.
> Ordre conseillé : #23 → #22 → #21 → #18. Rappels Marc : lancer `rattraperMediasMalClasses` +
> déployer la web app (DEPLOIEMENT.md) ; tri Gmail démarre seul ~03h.
>
> **#23 livré** (PR #81 : Agenda façon GCal, interface aérée, transitions). **#22 livré** : carte
> « Réglages » dans Santé (select 5/10/15/30 min) → `Réglages!A2:B2` de la Sheet (onglet seedé par
> le moteur) → `assurerIntervalleTick_` applique au tick suivant via `intervalleTickVoulu_()` +
> whitelist `validerTickMinutes_` (jamais < 5 min, invalide → CONFIG). Restent : #21 (ADR-0014 +
> constitution même commit + revue flotte) puis #18.
>
> **Chantier #21 lancé** — plan product-manager en 7 PR consigné au BACKLOG (état dans un onglet
> `Réorg`, corbeille des dossiers vides côté APP au clic validé, réorg de masse côté moteur).
> **C21-01 livré** : explorateur Drive lecture seule (sous-onglets Documents = Drive | Recherche
> DriveAI, fil d'Ariane, recherche nom+plein texte, portée « dans ce dossier » bornée et honnête).
> Revue flotte passée (sécurité + code, correctifs intégrés). **C21-02 livré** : création rapide
> de dossiers + déplacement manuel de fichiers (drag souris + mode « Déplacer → Déposer ici »),
> verdict `deplacementSeul` (nom conservé, zone protégée inconditionnelle), parades intake
> (ligne Index statut `manuel`, refus de redépôt dans 00·À trier, pas de dossier dans 00·À trier).
> Revue flotte 4 agents, correctifs intégrés. **C21-03 livré** : recherche IA (Documents →
> Recherche DriveAI → « ✨ ») — question libre → doPost (`action=recherche-ia`, POST text/plain
> lisible = CORS levé) → Haiku → plan whitelisté → filtres + plein texte. Bornes : 5 s, 50 appels
> servis/jour (~3 $/mois max), panne API sans consommer le plafond. ⚠ Marc : REDÉPLOYER la web
> app en nouvelle version (DEPLOIEMENT.md) pour activer la recherche IA. **C21-04 livré** :
> `Reorg.gs` (phase PROPOSITION — inventaire BFS borné zone-protégée-exclue-par-ancêtres,
> UN appel Haiku, plan whitelisté racines-intouchables, onglet `Réorg`, essais rendus sur
> budget/panne, 5 analyses/jour max). Revue flotte 4 agents, 3 bloquants corrigés. Prochain :
> **C21-05 livré** : vue « ✨ Réorg IA » (Documents) — demande d'analyse (aussi depuis
> l'Explorateur, portée dossier), plan avant/après, Valider/Écarter ligne/masse (plages
> contiguës), historique. **C21-06 livré** : le moteur APPLIQUE les actions validées
> (deplacer/fusionner/creer/renommer de dossiers — jamais de suppression), re-vérif zone
> protégée par mutation (identité + ascendance), fusion collecte-puis-mutation reprenable,
> re-pointage Entités avant le « fini », vide-candidat inscrit. **C21-07 livré (CHANTIER #21
> COMPLET)** : ADR-0014 + CLAUDE.md §2 révisé + corbeille.ts + tripwire bidirectionnel + verrou
> de surface DRIVE ajouté au moteur, en UN commit — revue flotte bloquante passée (2 trous réels
> fermés : promesse de verrou moteur non codée ; dossiers à ID fixe corbeillables). L'app offre
> désormais : explorateur façon Drive (naviguer/chercher/IA/créer/glisser-déposer), réorg IA
> (analyser → valider → le moteur applique → corbeille des vides au clic). ⚠ Marc : redéployer
> la web app en nouvelle version (recherche IA) — DEPLOIEMENT.md. **#18 livré** : entités
> en_attente vues ≥ 3 fois auto-validées au tick (dossier créé au même run), jamais en zone
> protégée, jamais contre une réédition de Marc (garde dossierId) ; annulation = Statut →
> « refusée » ; signalées au résumé hebdo. LE PLAN ACTÉ (#23 → #22 → #21 → #18) EST COMPLET.
>
> Antérieur — **2026-07-01 (soir)** : **BRAINSTORM PRODUIT COMPLET → dossier de conception (8 ADR).**
> Session de conception « niveau pro » avec Marc : **8 ADR** (`docs/adr/0001`→`0008`), **roadmap priorisée à
> 9 chantiers** (`docs/ROADMAP.md`), runbook (`docs/RUNBOOK.md`) et guide (`docs/GUIDE.md`). Socle #1 =
> **fondation testable** (logique pure isolée des appels Google + filet de tests CI + Journal borné/onglet
> `Santé`, ADR-0006). Décisions clés : sources = **fichiers partagés** (0005) ; vie privée = **métadonnées
> seulement dans l'état** — *vérifié sur le code*, aucun corps de doc stocké (0007) ; app web Phase 4 =
> recherche/dashboard/corrections, login Google, plein texte via l'index natif Drive (0008). **Prochain pas
> concret : implémenter le chantier #1** (fondation testable). ⚠️ Rien de tout ça n'est encore CODÉ — les ADR
> décrivent la CIBLE. **Le grand rangement de l'ancien Drive tourne toujours en fond** (vivant, vérifié par
> signaux Drive : fichiers renommés/déplacés en continu). Antérieur ce jour : **PLUS DE FILE DE REVUE : un
> seul dossier d'arrivée + nom final
> direct** (P1-16, décision Marc « je veux juste un dossier ; le nom attribué doit être direct le dernier » :
> `00 · À vérifier` supprimé du pipeline, TOUT classé au mieux avec nom propre, domaine introuvable →
> `DOMAINE_DEFAUT` ; barre fiabilisée via recensement léger + « recensement en cours » visible dès le 1ᵉʳ tick ;
> `VERSION` P3.0). Marc peut supprimer à la main le dossier vide `00 · À vérifier`. Antérieur : P1-14 (sensibles
> auto-classés), P1-15 (rangement TÔT gated file-basse + barre `[███░░░] N %`, `RANGEMENT_TAG` r1→r2), Phase 2 +
> full auto en prod, Phase 3 codée. Les **2 secrets GitHub sont posés** — rien côté secrets. **Reste côté Marc
> pour Phase 3 : une ré-autorisation Google unique** (scopes Tasks/Calendar) au prochain déploiement.
>
> 🔴 **P1-17 (fix majeur, diagnostic prod)** : « le moteur ne range plus rien / est muet » n'était PAS le
> déclencheur (il tournait, mais à vide). VRAIE cause : la collecte du rangement (`aParentProtege_`→`getParents()`)
> LEVAIT une exception sur « Ancienne structure » (racine `…`, Drive partagé) → 0 fichier collecté → le
> code prenait `collectes===0` pour « TERMINÉ » et FIGEAIT le rangement (`DriveAI_RANGEMENT` posé) → tous les
> ticks suivants sautaient le rangement. Fix : walk parent-protégé défensif (détection positive, jamais
> d'exception propagée), collecte par-fichier enveloppée, une collecte en erreur ⇒ `reste=true` (jamais un
> faux « terminé »), `RANGEMENT_TAG` r2→r3 (relance). **Après déploiement P1-17 : faire tourner 1 tick** (auto
> ~10 min, ou `tickDriveAI` à la main pour l'immédiat) puis vérifier par signaux Drive que « Ancienne structure »
> se vide et que les domaines se remplissent de `AAAA-MM-JJ_`. NB : le déclencheur EST sain (il firait à vide
> car le rangement était figé « terminé ») — pas besoin de re-`installerTrigger`.

---

> **C28-54/55 (19/08 soir) — l'incident a livré ses deux chantiers.** (1) **ADR-0043** : le tri
> Gmail ne meurt plus quand les intentions sont suspendues (mode DÉGRADÉ — libellés oui, archivage
> non, clé `|deg` RÉVISABLE au retour ; Santé dit l'état en TROIS niveaux : normal / dégradé /
> à l'arrêt). (2) **C28-55** : scopes `tasks` et `calendar.events` retirés du manifeste (inutilisés
> depuis ADR-0041) + `test/scopes.test.js`, verrou bidirectionnel du moindre privilège.
> ⚠️ Le retrait ne révoque PAS l'autorisation déjà accordée dans le compte Google de Marc — geste
> à sa main (myaccount.google.com → connexions tierces → supprimer l'accès, puis `installerTrigger`
> pour re-consentir ; le moteur est ARRÊTÉ entre les deux).
> **Reste au backlog, remonté par la revue quotas :** le scan AVANT du tri n'a aucun plafond
> QUOTIDIEN (théorique 8 640 fils/j) — à border dans son unité comme ses pairs ; et un fil trié en
> dégradé qui sort de la fenêtre 30 j avant le retour des intentions garde ses libellés dégradés
> sans jamais être archivé (mode d'échec SÛR, mais dette invisible).

