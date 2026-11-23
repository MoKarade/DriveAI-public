# Journal du HANDOVER : « Ce qui reste à faire côté Marc » (ancien §4)

> Déplacé tel quel depuis `HANDOVER.md` (PR b du plan #468, 21/10/2026). Historique, pas une liste à jour : la liste vivante est l'ensemble des issues `qui:marc`.

> Objectif **full auto**. Les secrets de déploiement sont posés — il ne reste qu'une ré-autorisation
> à venir (Phase 3) et deux rappels de fond.

0. ✅ **LEVÉ le 23/09 au soir — Marc a purgé les versions Apps Script.** Le `deploy.yml`
   relancé à 21:11 UTC est vert de bout en bout, et le moteur tourne sur le nouveau code :
   **mesuré** au tick de 21:14 UTC, la Santé publie `Mémoire — comptes : 343/0/2734|2782/613|0|…`
   et `Import — file : 2974/4240` — deux lignes que seule la nouvelle version écrit. Le récit
   ci-dessous reste, parce que le plafond de 200 versions se REMPLIRA de nouveau (une version
   par merge) et qu'il le fera sans prévenir.

   *(Récit d'origine :)* 🔴🔴 **BLOQUANT — PLUS AUCUN CHANGEMENT DU MOTEUR N'ATTEINT LA PRODUCTION.**

   ⚠️ **Mesuré à nouveau le 23/09 à 15:27** : la Santé de production ne porte toujours pas
   `Import — file`, et `Lecture — file` y arrive au format d'avant C49-23. Rien n'a bougé. Ce
   blocage retient désormais AUSSI la ligne `Mémoire — comptes` livrée le 23/09 : l'onglet
   Avancement affiche alors un bandeau qui NOMME les lignes manquantes et le geste, au lieu du
   « pas encore publié » qui se lisait comme une panne de la campagne. **La moitié DriveAI de
   l'écran, elle, est juste sans ce geste** — c'est pour ça que le parseur a été rendu tolérant
   au format que la production écrit réellement.

   Apps Script a
   atteint sa limite de 200 versions ; `deploy.yml` échoue depuis le 21/09 à 20:39 UTC :
   `Cannot create more versions: Script has reached the limit of 200 versions. To create more,
   delete a version from the project history page.`

   ⚠️⚠️ **C'est une PANNE, pas un pense-bête.** Première rédaction : « sans conséquence pour
   C49-23 ». Deuxième : « corrigé, ça repartira au prochain merge ». **Les deux sont fausses**,
   et c'est la mesure qui les a réfutées, pas un raisonnement. Le moteur tourne sur le code
   d'AVANT C49-23 : tout ce qui est mergé depuis est vert, en ligne sur `main`, et invisible en
   production.

   ⚠️⚠️ **CETTE ENTRÉE A AFFIRMÉ LE CONTRAIRE PENDANT QUELQUES HEURES, ET C'ÉTAIT FAUX.**
   Première rédaction : « le CODE du projet est à jour, donc **le tick exécute la nouvelle
   version** ». Re-mesuré sur les ticks de **20:38 et 20:44 UTC** — le second est postérieur au
   push de 20:39:36 — la ligne de Santé que C49-23 venait d'ajouter (`Import — file`) est
   **ABSENTE** : la Santé en porte toujours 18, pas 19. Le moteur tournait bien sur l'ANCIEN
   code. La règle du §9 s'applique telle quelle : un re-check qui contredit un « prouvé »
   antérieur se corrige immédiatement, là où il a été écrit.

   **Ce qui marche, ce qui ne marche pas, et POURQUOI** — les trois étapes se lisent séparément :
   - ✅ **`clasp push` RÉUSSIT** (20:39:31 → 20:39:36, les 40 fichiers listés). Le CODE du projet
     Apps Script est bien à jour.
   - ❌ **`clasp deploy -i $WEBAPP_DEPLOYMENT_ID` ÉCHOUE** (20:39:36 → 20:39:44). La web app
     `/exec` reste figée sur sa version épinglée. C'est le piège n° 4 du `CLAUDE.md` §9 : au
     prochain lot qui touche `WebApp.gs`, l'app et le miroir appelleront une version qui ignore
     la nouvelle action — réponse `{ok:true}` SANS le champ attendu, zéro erreur, panne muette.
   - ⏭️ **« Assurer le déclencheur » a été SAUTÉE** — `conclusion: "skipped"` dans l'API des jobs
     (run 35652410816, étape 9), LU et non déduit. Sa condition était
     `if: steps.guard.outputs.ready == 'true'`, sans `always()` : GitHub Actions saute une étape
     dès qu'une étape amont a échoué, quelle que soit sa condition. Or c'est CETTE étape qui
     supprime/recrée le déclencheur, donc **la seule chose qui force Apps Script à recharger le
     code** (piège n° 3). Le `clasp push` vert ne suffit pas, et c'est écrit dans le workflow
     depuis toujours.

   ⚠️ **Ce défaut-là est plus large que les 200 versions** : N'IMPORTE QUEL échec du
   redéploiement de la web app — quota, réseau, secret retiré — faisait sauter l'étape en
   silence. **Corrigé** : la condition est désormais
   `if: always() && steps.push.outcome == 'success'`, gardée par `test/pilote-ci.test.js`
   (3 mutations rouges).

   ⚠️⚠️ **ET LE CORRECTIF, MESURÉ, NE SUFFIT PAS — c'est le troisième étage de la même panne.**
   Le merge de ce correctif (run 35653862869) s'est déroulé exactement comme prévu : push ✅,
   deploy ❌ (200 versions), **déclencheur ✅ — l'étape a TOURNÉ** et a rendu
   « Déclencheur réinstallé — version servie : 5min|t7 ». Et le moteur exécute toujours l'ancien
   code : `Import — file` reste ABSENTE de la Santé aux ticks de **21:00 et 21:04 UTC**, tous
   deux postérieurs à la réinstallation de 20:54:12. Deux ticks, 18 lignes, pas 19.

   **Pourquoi, et jusqu'où on peut l'affirmer.** La réinstallation passe par `/exec`
   (`action=assurer-trigger`) — or c'est précisément `/exec` qui est figée. Le déclencheur est
   donc recréé PAR l'ancienne version. Deux mécanismes expliqueraient la suite, et **rien ici ne
   permet de les départager** : soit un déclencheur créé depuis un déploiement épinglé reste sur
   cette version, soit ce qui a TOUJOURS forcé le rechargement est le `clasp deploy` lui-même
   (création d'une version), et non la réinstallation du déclencheur — auquel cas le commentaire
   du workflow décrivait depuis le début un mécanisme qu'il n'avait jamais isolé. Ce qui est
   MESURÉ, et qui suffit pour agir : **tant que `clasp deploy` échoue, le moteur ne recharge
   pas.**

   ⚠️ **Le « signal indépendant » de la CI ne pouvait pas voir ça.** `versionPilote_()` rend
   `CONFIG.TICK_MINUTES + '|' + CONFIG.RESET_TABLE_VERSION` — deux constantes inchangées depuis
   des semaines. Il prouve que `/exec` CONNAÎT l'action (piège n° 4), jamais qu'elle sert le
   code du jour. Proposition, non faite : y mettre une empreinte qui change à chaque
   déploiement. Au BACKLOG sous `[C49-24]`, en attente d'un feu vert.

   **LE GESTE, ET IL N'APPARTIENT QU'À MARC** (frontière d'exécution — une session ne peut ni
   déployer ni exécuter dans Apps Script) : ouvrir le projet Apps Script → **Historique du
   projet** (« Project history ») → **supprimer d'anciennes versions**. En retirer une centaine
   remet de la marge pour des mois. ⚠️ Les versions ANCIENNES ne servent plus à rien une fois
   qu'aucun déploiement ne les épingle ; celle que porte le déploiement `/exec` courant, si.

   **Raccourci qui débloque le moteur tout de suite, sans purge** : ouvrir le projet Apps Script
   dans l'éditeur et exécuter `installerTrigger` (fichier `Main.gs`) — c'est le geste d'origine
   du piège n° 3, et il tourne sur le HEAD, pas sur `/exec`. Ça rattrape le moteur ; ça ne
   débloque PAS `/exec`, donc la purge reste à faire.

   ⚠️ **C'est le PREMIER échec** : les cinq runs précédents du même jour sont verts (`d6c7afc`,
   `51d6b4f`, `12c4fd6`, `58fe166`). La 200ᵉ version vient d'être créée — chaque merge en crée
   une, donc **tous les merges suivants échoueront à la même étape** tant que rien n'est purgé.

1. ~~**Phase 3 (à venir, une fois)**~~ — **clos le 05/11/2026** (ADR-0074 : Tasks et Calendar retirés, aucun
   scope à autoriser). Reste un geste de moindre privilège, jamais pressé, en trois temps et dans cet ordre :
   (a) compte Google → Sécurité → « Applications tierces ayant accès au compte » → révoquer l'accès du client
   « DriveAI » (celui du projet GCP hubperso, ADR-0041) ; (b) console GCP, projet hubperso → Identifiants →
   supprimer ce client OAuth ; (c) éditeur Apps Script → Propriétés du script → effacer les sept Properties
   `DriveAI_HUBPERSO_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH`, `_ACCES`, `_ECHEC`, `_REDIRECT`, `_STATE`. Le moteur ne
   les lit plus : rien ne casse si ce geste attend.
   Ancien texte : l'ajout des scopes Google Tasks/Calendar va déclencher un **nouvel
   écran de consentement Google** au prochain déploiement. Une seule ré-autorisation (un clic) sera
   nécessaire — DriveAI ne peut pas le faire à sa place (frontière d'exécution). Sera annoncé clairement
   le moment venu, avec une fonction « un clic » dédiée si possible.
2. 🔑 **Révoquer l'ancienne clé Anthropic** partagée dans le chat (compromise), si pas déjà fait.
2 bis. 🧠 **L'envoi vers la Mémoire** (chantier #48, ADR-0059 phase 0) — **ÇA TRANSPORTE**, et
   c'est mesuré : le 2026-09-16 à 10:40 (Québec), une passe a fait accepter **2 348 faits**
   (`refuses: 0`, plus 52 `dejaPresents` qui prouvent la déduplication par empreinte), et
   MemoryAI affiche **2 725 faits en attente** — N1 1 691 · N2 1 027 · N3 84. `MEMOIRE_PUSH`
   est allumé depuis le matin (décision du propriétaire, C28-117 bis) et les deux jetons sont posés.
   Le reste des ~19 900 documents entre tick après tick (`fin: "budget"` est le cas normal :
   la passe s'arrête au budget et reprend au tick suivant), sans un appel LLM.
   ⚠️ **Il a fallu TROIS causes empilées pour y arriver, chacune masquée par la précédente** —
   et les trois étaient silencieuses :
   1. un **nom de champ faux** (`niveau` au lieu de `niveau_propose`) : 4 000 faits refusés en
      `champ_inconnu`, dans des HTTP 200, sans une ligne au Journal. Corrigé par C28-118, qui
      ajoute aussi le motif de refus NOMMÉ au Journal au lieu d'un compteur muet ;
   2. une **rotation de jeton à moitié faite** (nouvelle valeur côté Vercel, ancienne côté
      Apps Script) : `Jeton refusé (401)` à chaque tick ;
   3. un **onglet d'éditeur ouvert avant le `clasp push`**, qui a réécrit le projet avec sa
      copie périmée — déploiement vert, fichier listé, et l'ancien code qui tourne quand même.
      Réglé en fermant l'éditeur, re-poussant (run 346), puis rouvrant une page neuve.
      Cf. `CLAUDE.md` §9, entrée dédiée : ce n'est PAS le piège (3), c'en est l'inverse.
   ⚠️ **MESURÉ, et la réponse était NON : le tick ne poussait rien** (C28-135). À 11:13, une
   heure après la passe manuelle et ~12 ticks plus tard, la Mémoire portait **zéro fait de
   plus** (2 834 au total ; les seules variations venaient des validations de Marc). Le moteur
   tournait pourtant normalement — heartbeat à 11:10, toutes les missions actives — et le
   Journal ne portait **aucune erreur Mémoire depuis 13:58 UTC**. Deux causes, livrées ensemble :
   1. **l'étape était en FIN de `finally`**, donc dernière servie sur le reliquat de budget
      TAIL d'un tick qui l'avait déjà dépensé. REMONTÉE avant l'historique du vrac (sweep
      quotidienne) et la validation des doublons (campagne TERMINÉE) : l'ORDRE prime sur les
      budgets, incident de la consolidation du 23/07 mot pour mot ;
   2. **elle ne DISAIT rien en sortant** : « rien à envoyer », « jamais atteinte » et
      « suspendue » avaient le même symptôme, le silence. `DriveAI_MEMOIRE_FIN` porte désormais
      `<ISO>|<motif>|<envoyés/acceptés/déjà>|<ligne>/<dernière>`, une seule fonction l'écrit
      pour qu'aucun `return` ne l'oublie, et la ligne de Santé « Mémoire (inventaire) » le rend
      lisible sans rien exécuter — donc via `etat_moteur`.
   Elle a aussi reçu son **budget quotidien** (4 min/j, PRÉLEVÉES sur l'historique Gmail 12 → 8) :
   elle tournait jusqu'ici sans aucune constante, donc l'invariant d'enveloppe était aveugle à
   elle — l'angle mort de C28-42, re-payé.
   ⚠️ **C28-137 — LE CHEMIN MANUEL EXISTE ENFIN, et il se DIT** (16/09, demande de Marc). Le
   jeton a été réparé dans l'après-midi, mais le budget Mémoire du jour était déjà épuisé (4 min
   sur 4, brûlées par les trois refus de 13 h 50–13 h 58) : plus rien à tester avant minuit, et
   **aucune fonction pour forcer une passe** — `diagnosticMemoire`, celle qui avait poussé
   2 348 faits le matin, n'a jamais existé dans le dépôt. `opts.manuel` était pourtant lu en
   trois endroits de `passeMemoire_` et passé par personne. Désormais : ouvrir `Memoire.gs` →
   **`pousserMemoireMaintenant`** → Exécuter. Hors budget quotidien, bornée par
   `CONFIG.BUDGET_MS` (4,5 min), et elle rend son compte dans le journal d'exécution.
   ⚠️⚠️ **Et la ligne de Santé DIT maintenant qu'une passe était manuelle** — 5ᵉ champ de
   `DriveAI_MEMOIRE_FIN`, ajouté en QUEUE. Sans lui, une passe lancée à la main est
   indiscernable d'un tick qui travaille : c'est exactement ce qui a fait conclure « le canal
   marche » le 16/09 au matin, alors que l'automatique n'envoyait rien. **Une main ne prouve
   jamais qu'un déclencheur tourne, et la surface doit le rappeler à celui qui la lit.**

   ⚠️ **À VÉRIFIER APRÈS LE DÉPLOIEMENT** (et c'est la seule preuve qui compte, piège 3) : la
   ligne « Mémoire (inventaire) » de Santé doit cesser de dire « aucune passe enregistrée », et
   `aValider`/le total des faits de MemoryAI doit MONTER entre deux ticks, sans qu'une main y
   touche. ⚠️ **Fermer tous les onglets de l'éditeur Apps Script AVANT le `clasp push`** — c'est
   la cause n° 3 ci-dessus, et elle se reproduit à l'identique.
   Pour mémoire, les deux gestes de pose — il ne se passe rien tant que les deux ne sont pas
   faits, le flag allumé sans jeton n'ouvrant rien par construction :
   1. dans MemoryAI (Vercel → `memory-ai` → Environment Variables) poser
      `MEMORYAI_TOKEN_DRIVEAI_ECRITURE` = `openssl rand -base64 24`, puis **redéployer**
      (Vercel fige les variables au build) ;
   2. dans l'éditeur Apps Script de DriveAI : **Paramètres du projet → Propriétés du script** →
      `DriveAI_MEMORYAI_TOKEN` = **la même valeur**.
   ⚠️ Si cet écran ne permet pas la saisie, le repli est une fonction TEMPORAIRE créée dans
   l'éditeur (`PropertiesService.getScriptProperties().setProperty(...)`), exécutée une fois puis
   SUPPRIMÉE — jamais committée, et jamais laissée en place pendant qu'un `clasp deploy` tourne :
   il figerait le secret dans une version archivée du projet.
   ⚠️ **Ce que ça fait sortir du compte Google** : pour chaque document classé, son `fileId`, son
   type, son année, son émetteur (sauf documents d'immigration et d'identité) et son domaine.
   Jamais un corps, jamais un montant, jamais un numéro. La liste est fermée et testée.
   ⚠️ **Comment savoir que ça marche** — pas le run vert, mais le compteur : Propriétés du script →
   `DriveAI_MEMOIRE_EMIS` doit MONTER, et les faits apparaissent dans `/a-valider` de MemoryAI.
   Si `DriveAI_MEMOIRE_SUSPENDU_RAISON` existe, elle dit ce qui bloque.
   ⚠️ ~~**La file « à valider » va atteindre ~19 000**~~ — **TRANCHÉ le 16/09 par Marc**, côté
   MemoryAI (son ADR 0003, PR #18 fusionnée) : un fait MÉCANIQUE — couple (extracteur, prédicat)
   en liste fermée, ici `moteur-inventaire-v1` × `document.existe` — entre directement en
   `valide`, et le stock déjà posé a été rattrapé par migration. La règle porte sur la
   PROVENANCE, jamais sur le contenu : ce fait n'a jamais vu de modèle, il n'y a rien à relire.
   Le NIVEAU reste dérivé par le code, donc **rien de ce que DriveAI envoie ne devient plus
   accessible**. Conséquence pour ce dépôt : les ~19 000 faits à venir n'engorgent plus rien, et
   la file ne garde que ce qu'un modèle a DÉDUIT.
2 ter. **L'envoi des PIÈCES vers la Mémoire** (chantier #49, ADR-0061) — **LIVRÉ, DÉPLOYÉ,
   et ÉTEINT**. Le 16/09 au soir, les lots C49-1, C49-1 bis et C49-2 bis sont fusionnés (PR #364)
   et `deploy.yml` est vert. Une **pièce** n'est pas un fait : elle fait sortir ce qu'un papier
   CONTIENT — son type, son émetteur, ses dates, son titulaire, ses champs structurés, **numéros
   d'identité compris**, pour Marc et pour ses proches. C'est la frontière que l'ADR-0061 franchit.
   ⚠️ **Rien ne part tant que `CONFIG.PIECE_PUSH` vaut `false`**, et ce n'est pas de la prudence
   décorative : `traiterDocument_` a **huit appelants**, dont `Reset.gs` et `Migration.gs`.
   Allumer ce drapeau ne re-tarife pas seulement le flux vivant — ça re-tarife **les campagnes en
   cours**, exactement comme `ANALYSE_V2` qui a doublé un mois de budget en une nuit.
   **Deux gestes, dans cet ordre, et le second est la porte :**
   1. **C49-3 — l'audit sur 100 documents stratifiés.** Ce n'est pas une étape, c'est une PORTE :
      si l'extraction se trompe sur des numéros d'identité, il vaut mieux le savoir sur 100 papiers
      que 19 900. ⚠️ **Le JUGEMENT ne peut pas être franchi depuis une session Claude** — le moteur
      tourne dans le compte Google de Marc — **et il ne peut pas non plus s'automatiser** : un
      pré-juge par un second modèle partagerait l'OCR du premier, donc il verrait les erreurs de
      raisonnement et jamais celles de LECTURE, les seules qui comptent sur `01` et `04`. Proposé
      le 17/09, écarté par Marc. Ce qui a été automatisé, c'est le GESTE ; le verdict reste le sien.

      **Depuis le 17/09, Marc n'a PLUS RIEN à lancer dans l'éditeur** (sa demande : « je veux rien
      lancer dans appscript ») :
      - **l'extraction se termine seule.** `etapeAuditPiece_` est une étape du tick : elle TERMINE
        l'échantillon en cours et s'éteint d'elle-même à zéro restant (sa gate lit le compteur que
        la passe écrit). Budget 8 min/j, ~48 documents par jour. ⚠️ Elle **n'amorce JAMAIS** :
        tirer cent documents, c'est lancer une campagne LLM que personne n'a demandée. Composer un
        NOUVEL échantillon reste `auditPiecesMaintenant` — le seul geste d'éditeur qui subsiste, et
        il ne sert qu'à en relancer un autre plus tard ;
      ⚠️ **RE-EXTRACTION du 17/09 (`AUDIT_PIECE_TAG = 'c49-3-b'`)** : le premier passage a écrit
      « [object Object] » dans la colonne Champs — les valeurs extraites sont des listes
      `{libelle, valeur}` et un `String()` naïf les a aplaties — et il n'écrivait pas le RÉSUMÉ.
      Les 100 lignes étaient donc INJUGEABLES. Le tag les remet à « à faire » au premier tick et
      **efface les verdicts déjà posés** (les notes restent) : un verdict rendu sur une ligne
      illisible ne dit rien de l'extraction, et le garder fausserait le seul chiffre que la porte
      mesure. Bumper ce tag est la façon de refaire l'échantillon en cours, sans rien lancer.
      ⚠️⚠️ **Et ce tag n'a RIEN déclenché pendant deux ticks — mesuré le 17/09 à 11:09.** La gate
      du tick s'éteignait sur « 0 restant » sans lire le tag, or la ré-extraction vit DANS la
      passe : le remède était INERTE, et l'interblocage se refermait tout seul (plus d'étape ⇒
      plus de tag lu ⇒ plus de lignes remises ⇒ plus jamais d'étape). Corrigé par une gate PURE
      (`auditDoitTourner_`) qui consulte le compteur ET le tag. Second défaut du même lot, pire :
      la sortie « budget du jour épuisé » relisait le compteur PERSISTÉ — elle aurait réécrit
      « 0 restants » sur 100 lignes fraîchement vidées, fermant la gate pour de bon sur des cartes
      VIDES. Les restants se comptent désormais dans la FEUILLE (`compterAFaireAudit_`).
      ⚠️ **Le jugement est CHAMP PAR CHAMP sur les « à moitié »** (demande de Marc, 17/09). Un
      clic sur « À moitié » ouvre neuf cases (type, émetteur, date, titulaire, montants, numéros,
      personnes, lieux, résumé) et le compte s'affiche en haut : « titulaire 8 · numéros 1 ».
      C'est ce tableau qui décide d'un correctif — « 12 documents à moitié » n'en oriente aucun,
      et surtout ne dit pas si les erreurs touchent des libellés ou des NUMÉROS D'IDENTITÉ.
      Enregistrer sans cocher reste possible : « je ne sais pas dire lequel » est une réponse
      honnête, et forcer une case ferait cocher n'importe quoi. La liste vit en DEUX exemplaires
      (`CHAMPS_JUGEABLES_AUDIT` côté moteur, `CHAMPS_JUGEABLES` côté app) et un test lit le `.gs`
      pour exiger qu'elles soient identiques — les deux moitiés se déploient séparément.
      - **le jugement se fait dans l'app** : `drive.exemple.com` → engrenage → **« Vérifier »**.
        Un document à la fois, plein écran, trois boutons (`Juste` / `À moitié` / `Faux`), le
        RÉSUMÉ que le modèle a écrit du document — c'est lui qui dit s'il l'a COMPRIS, là où les
        champs disent seulement ce qu'il en a tiré — et le lien qui ouvre le papier à côté. Le verdict s'écrit directement dans la Sheet ; le compte et le
        taux de justesse s'affichent en haut. La carte n'apparaît que s'il y a un audit en cours, et
        cette information vient de la ligne de SANTÉ déjà chargée — savoir s'il y a quelque chose à
        vérifier ne coûte aucune requête ;
      - **`verdictAuditPieces`** compte toujours, depuis l'éditeur, mais il ne sert plus : l'app
        affiche le même compte. ⚠️ « non jugé » y reste une catégorie à part, des deux côtés — un
        tableau à moitié rempli ne ressemble pas à un audit qui a échoué ;
      - **`viderAuditPieces`** efface le rapport. L'onglet porte des valeurs extraites de vrais
        papiers : il est TEMPORAIRE, et c'est pour ça que son effaceur est livré avec lui.
      ⚠️ **Où lire l'avancement sans rien exécuter** : la ligne de Santé **« Audit des pièces
      (C49-3) »** — restants, motif de la dernière passe, minutes consommées. Elle distingue
      « jamais tourné » de « rien à faire », et elle DIT si la dernière passe était MANUELLE :
      sans ça, on conclut « le tick tourne » sur la preuve d'une main (leçon du 16/09).
      ⚠️ **Les 11 min/j sont PRÊTÉES** par la réconciliation Index (`SYNC_BUDGET_JOUR_MS` 12 → 4 → 1,
      demande de Marc le 17/09 : « accélère »). Le donneur est au BOUT : il ne peut pas descendre à
      zéro — une campagne perpétuelle à budget nul tourne à vide en silence, et
      `test/orchestration.test.js` le verrouille désormais (il ne l'était nulle part : la mutation
      « donneur à 0 » était VERTE). Ce que ça achète, mesuré : ~33 documents/jour au lieu de ~24.
      ⚠️ **Et un SECOND donneur, le même jour** (« prends aussi sur l'historique Gmail ») : cette
      campagne TERMINÉE descend de 8 à **2 min**, son plancher MESURÉ — à zéro elle devient muette
      (20 de ses tests rougissent), à 2 aucun. L'audit tourne donc à **17 min/j**, soit ~51
      documents/jour. C'est le maximum atteignable sans DÉSACTIVER une campagne, ce qui serait une
      décision et non un réglage.
      ⚠️ Le budget de l'audit ayant deux donneurs, la PROVENANCE de chaque minute est écrite
      (`AUDIT_PIECE_PART_SYNC_MIN` 11 + `AUDIT_PIECE_PART_GMAIL_MIN` 6 = 17) et un test exige que
      les parts remplissent le budget : une minute sans donneur nommé passerait entre les deux
      gardes de paire, chacun ne regardant que le sien.
      ⚠️ *(Récit du 17/09, gardé tel quel. Ces deux constantes n'existent plus : C49-20 les a
      remplacées le 21/09 par la table `AUDIT_PIECE_DONNEURS_MIN`, qui nomme HUIT donneurs pour
      58 min/j. Le mécanisme — chaque minute a un donneur nommé — est inchangé.)*
      **À RENDRE quand l'audit est fini.** ⚠️ **Cette liste a été fausse DEUX FOIS** — une
      première le 17/09 (elle disait « `SYNC` 4 → 12 et `AUDIT_PIECE` 8 → 0 » alors que deux
      réallocations étaient passées depuis), une seconde le 21/09, où C49-20 lui a ajouté sept
      donneurs sans qu'elle bouge. Elle ne porte donc plus AUCUN chiffre : la recette de
      restitution se lit dans **`CONFIG.AUDIT_PIECE_DONNEURS_MIN`** (`src/Config.gs`), qui est la
      seule source du compte — rendre à chaque donneur exactement ce qu'il y est inscrit, remettre
      son `*_ACTIF` à true pour les sept campagnes arrêtées, et ramener
      `AUDIT_PIECE_BUDGET_JOUR_MS` à 0. L'étape ne consomme plus rien une fois éteinte, mais sa
      CONSTANTE continue de peser sur l'invariant d'enveloppe, et une enveloppe faussement chargée
      fait renoncer à la réallocation suivante.
      ⚠️ Une recette écrite au présent rote : celle-ci est désormais DÉRIVÉE, et les gardes de
      paire de `test/orchestration.test.js` refuseront toute restitution partielle.
      ⚠️ **L'échantillon est ÉGALITAIRE entre domaines, pas au prorata du stock** — sinon
      `02 · Finances` raflerait les cent lignes et `04 · Immigration` en aurait deux.
      ⚠️ **`04` et `01` ont leur TITULAIRE et leurs CHAMPS masqués** (arbitrage de Marc, 17/09,
      contre ma recommandation) : seule la FORME s'écrit (« 9 chiffres »). Le type, l'émetteur
      et les dates restent lisibles. **Conséquence assumée** : sur ces deux domaines l'audit ne
      constate que la présence et la forme — un numéro bien formé mais FAUX passe, et ce sont
      justement les deux domaines où l'erreur coûte le plus cher. Pour les juger vraiment, il
      faut ouvrir le document par le lien, à côté du tableau.
      ⚠️ **Coût** : une extraction Haiku par document, soumise au frein `LLM_BUDGET_CAMPAGNES`
      comme n'importe quelle campagne — la passe sort avec le motif « frein budget LLM atteint »
      plutôt que de le franchir. **Rien n'est envoyé à la Mémoire** : l'audit est LOCAL, et il
      le reste même une fois `PIECE_PUSH` allumé.
   1 bis. **C49-4 étape A — COMBIEN de documents, mesuré au lieu d'être supposé** (17/09,
      demande de Marc : « commencer à mettre en place la lecture de tout mon Drive »).
      Tout le reste de C49-4 — la durée de la campagne, son coût, le budget à lui prélever —
      se dérive d'UN nombre que personne n'avait mesuré : combien des documents de l'Index sont
      des PAPIERS. **« 20 346 » est le compte de l'Index, pas celui du périmètre** : il porte
      des photos, des exports, des vidéos, des archives. Annoncer une durée là-dessus serait un
      chiffre inventé, et la §9 a déjà payé deux fois « un seuil écrit avant sa mesure ».
      - `src/PerimetrePiece.gs` : une passe **ONE-SHOT** (gate par tag, `PERIMETRE_PIECE_TAG`),
        qui lit l'Index en un `getValues` et publie le compte par DOMAINE et par EXTENSION.
      - **Aucun appel LLM, aucune lecture de contenu, aucun octet qui sort du compte Google.**
        C'est pour ça qu'elle peut être livrée AVANT la porte C49-3, qui garde l'ENVOI.
      - **Pas de `*_BUDGET_JOUR_MS`, et c'est une décision** : une constante coûterait sa minute
        TOUS LES JOURS pour une mesure qui se fait une fois. Un test le verrouille — si l'étape
        devient un jour perpétuelle, il tombe, et c'est là qu'il faudra nommer un donneur.
      - ⚠️ **L'exclusion est FERMÉE, l'inclusion est OUVERTE** : on écarte une liste écrite
        d'extensions qui ne peuvent porter aucun texte (vidéo, son, archive) et tout le reste est
        candidat, y compris l'inconnu. Dans l'autre sens, une extension oubliée SOUS-compte le
        périmètre — donc sous-estime la durée et le coût — et l'écart ne se verrait qu'une fois
        la campagne lancée. Sur-compter se voit tout de suite et ne coûte rien.
      - ⚠️ **Le compte est une BORNE HAUTE, pas une prévision**, et la ligne de Santé le DIT :
        « ce fichier peut porter du texte » n'est pas « il en porte ». Le taux réel se lit dans
        les « sans texte » de l'audit C49-3 — c'est LUI qui convertira la borne en prévision.
      - **Où le lire sans rien exécuter** : la ligne de Santé **« Périmètre des pièces (C49-4) »**
        (candidats / classés / lignes d'Index, écartés, tête par domaine, date de mesure). Le
        détail COMPLET — tous les domaines, toutes les extensions — se lit par
        `PerimetrePiece.gs` → `diagnosticPerimetrePiece` → Exécuter : lecture seule, rien de
        persisté, rien d'envoyé.
      ⚠️⚠️ **MESURÉ LE 17/09 (recompté à 17:27 sous `c49-4-b`), ET LE RÉSULTAT DÉPLACE DEUX
      CHIFFRES QUE TOUT L'ÉCOSYSTÈME CITAIT.** La ligne de Santé rend : **3 972 papiers
      candidats sur 4 240 documents classés, 26 550 lignes d'Index, 268 écartés**, plus
      **734 lignes classées SANS fileId de clé** — le plancher, ci-dessous.
      - **« 20 346 » n'est PAS un compte de documents.** C'est
        `Object.keys(_indexCache).length` (`Journal.gs`), donc le nombre de CLÉS d'Index toutes
        natures confondues — plans de consolidation, dry-run, fusion, quarantaine, zones
        protégées. Le chiffre des documents RANGÉS et identifiables est 4 240.
      - **« ~19 900 » (la cible de l'inventaire Mémoire, écrite dans l'ADR 0003 de MemoryAI, son
        `CLAUDE.md` et ici) vient de cette même confusion.** `faitInventaireMemoire_` applique
        EXACTEMENT les deux mêmes conditions que ce comptage — clé porteuse d'un fileId, statut
        `class*`. Sa cible réelle est donc du même ordre que 4 240, et ses 2 725 faits ne sont
        pas 14 % du but mais **~64 %**. [Probable — même prédicat lu dans les deux fichiers.]
      - ⚠️⚠️ **ET LE 4 240 EST LUI-MÊME UN PLANCHER, pour une raison qui n'est pas l'extension
        mais la CLÉ.** `fileIdDeCleIndex_` n'accepte que quatre préfixes (`drive`, `tri33p`,
        `migre`, `reanalyse`) ; la clé d'une pièce jointe Gmail est
        `<messageId>|<rang>|<nom>|<taille>` (`cleAttachement_`) et n'en porte aucun. **Tout
        document entré par Gmail — l'intake PRINCIPAL du moteur — est invisible à ce comptage
        ET au canal de la Mémoire**, bien qu'il soit rangé et porte un vrai fileId. Ces lignes
        se COMPTENT désormais (`classeesSansFileId`) et la ligne de Santé dit « PLANCHER » quand
        il y en a : une population qu'on ne sait pas viser doit au moins se dire.
      - ⚠️ **`04` et `01` sont TOUJOURS nommés** (`PREFIXES_DOMAINE_DECISIF_PIECE`), même à zéro.
        Au premier usage réel ils ne figuraient dans AUCUN des six plus gros domaines (`06`=1169,
        `02`=976, `08`=857, `05`=531, `03`=284, `01`=87) : **`04` vaut 23**, il est trop PETIT
        pour survivre à une troncature par volume, et c'est exactement le premier que Marc
        pousse. Une surface bornée qui cache le seul chiffre pour lequel on l'a écrite ne mesure
        rien.
      - **Conséquence pratique pour Marc** : sa première tranche (`04` + `01`) pèse **110
        documents** — la centaine, pas le millier. C'est peu cher à essayer, ce qui va dans le
        sens de son choix.
      - ⚠️ **TAG BUMPÉ EN `c49-4-b`** (17/09, demande de Marc). Le correctif ci-dessus ne
        change QUE la façon de mesurer ; la gate étant un tag déjà posé, rien ne recalculait
        tout seul, et la Santé aurait réaffiché la mesure de `c49-4-a` indéfiniment — juste
        dans ses chiffres, muette sur le plancher et sur `04`/`01`. **Un correctif de mesure
        n'existe que quand la mesure est refaite.** Le recomptage coûte une lecture de l'Index,
        aucun appel LLM, et rien ne sort du compte Google.

      ⚠️ **Ce que cette étape NE fait pas** : lire les documents. C'est le lot suivant, et il
      commencera par `04 · Immigration` et `01 · Administratif & identité` — **choix de Marc du
      17/09, contre ma recommandation** : voir tout de suite ce que la Mémoire sait des pièces
      d'identité, quitte à s'arrêter avant d'avoir dépensé si le résultat est mauvais. Son retour en
      arrière (retirer une pièce déjà partie) n'existait pas ; il a été livré le même jour côté
      MemoryAI (`/pieces`, PR #26).

   1 ter. **C49-5 étape B — le RATTRAPAGE du stock, `04` puis `01`** (17/09, `src/RattrapagePiece.gs`).
      ⚠️⚠️ **LA VOIE : TRANCHÉE PAR MARC LE 17/09 — « garde ta voie, 110 docs c'est peu pour
      l'instant ».** Ce module prend la voie que la Q1 de l'ADR-0061 avait écartée (le tick
      Apps Script plutôt que le runner GitHub) ; il a été livré en brouillon POUR CETTE RAISON,
      et le propriétaire a tranché avant tout allumage. L'ADR est **amendé**, pas révoqué (§9, Q1) : la Q1
      reste la voie du rattrapage COMPLET, cette tranche-ci reste ici. Ce qui l'a rendue bon
      marché, et ce que l'ADR prévoyait en toutes lettres : la prémisse « compté en mois »
      portait sur **19 900** documents, mesurés depuis à **3 972** (C49-4), et la tranche n'en
      pèse que **110** — ~18 min de quota à 10 s/document, sur les 11 min/j déjà prélevées.
      ⚠️ La voie du tick est la frontière **ÉTROITE** : seuls les champs sortent, aucun texte
      intégral ne transite par un runner pour ces 110 documents.
      ⚠️ **Le « pour l'instant » de Marc est DANS le code, pas seulement dans sa phrase** : les
      3 862 papiers restants retombent sous la Q1, et l'idempotence de ce module (200 `fileId`
      dans une Script Property) refuse une tranche plus grande plutôt que de le découvrir en
      production.
      ⚠️ **LE POINT QUI N'ÉTAIT PAS ÉVIDENT, ET QUI CHANGE LE LOT** : allumer `PIECE_PUSH`
      n'aurait RIEN envoyé de ce que Marc veut voir. Le canal des pièces
      (`pousserPieceApresClassement_`) n'a qu'un appelant, `Pipeline.gs`, juste après le
      classement : il ne voit que le FLUX VIVANT. Les papiers de `04`+`01` sont rangés depuis
      des semaines, ils ne repasseront jamais par `traiterDocument_` — le tableau aurait
      affiché « canal actif » pendant que le stock restait invisible.
      - **Comment c'est bâti** : une campagne qui relit l'Index, choisit les documents de la
        tranche DANS L'ORDRE des préfixes (`04` épuisé avant `01` — c'est la demande, pas un
        effet de tri), et les fait passer par la MÊME fonction que le flux vivant. Mêmes gardes
        (`verdictPiece_`), même mise en forme (`pieceMemoire_`), même envoi : un papier rattrapé
        arrive à la Mémoire exactement comme un papier classé aujourd'hui.
      - **Deux interrupteurs, un seul canal** : `PIECE_PUSH` reste `false` (décision du propriétaire du
        17/09, « le rattrapage seul ») et `RATTRAPAGE_PIECE_TAG` gouverne la campagne. Allumer
        le flux vivant re-tarifierait les HUIT sites d'appel de `traiterDocument_`, dont
        `Reset.gs` et `Migration.gs` : c'est le piège d'`ANALYSE_V2`, qui a doublé un mois en
        une nuit. Ici ce qui part est une LISTE fermée, donc un coût borné avant de partir.
      - ⚠️ **LIVRÉ ÉTEINT, et la porte est celle de l'ADR-0061** : `RATTRAPAGE_PIECE_TAG` vaut
        `''`. Le propriétaire a choisi « après le jugement de l'audit ». Le code ne DÉDUIT pas ce jugement
        d'un compteur de verdicts — il peut en juger quarante et s'arrêter ; poser une valeur
        dans le tag, c'est dire « j'ai jugé, vas-y ». Et l'étape refuse en plus de démarrer tant
        que l'audit a des documents à extraire (`resteAuditPiece_ !== 0`).
      - **Aucune addition à l'enveloppe des 63 min/j** : la campagne n'a AUCUNE constante
        `*_BUDGET_JOUR_MS` à elle (un test l'exige dans les deux fichiers). Elle consomme le
        budget des PIÈCES déjà prélevé en C49-3 — même constante, même Property — et les deux
        étapes sont mutuellement exclusives. Il n'y a donc aucun transfert à verrouiller.
      - **Ce qu'on marque, et ce qu'on ne marque JAMAIS** : un verdict propre au document (sans
        texte, extraction vide, refus de la Mémoire) se marque « fait » — sinon la même photo
        illisible serait re-téléchargée et re-extraite à chaque passe, à vie. Une PANNE DE CANAL
        (jeton, suspension, frein, réseau, plafond) ne se marque pas et arrête la boucle :
        marquer là perdrait le document POUR TOUJOURS, puisqu'il ne reviendrait ni par le
        rattrapage ni par le flux. La table énumère les VERDICTS, pas les pannes — un motif
        inconnu tombe donc du côté sûr.
      - ⚠️ **Le coupe-circuit Drive** : une lecture impossible est un verdict du document
        (droits, fichier disparu), mais TROIS d'affilée ne le sont plus — un scope perdu ou un
        throttle les fait toutes échouer. Au troisième, la passe s'arrête ET retire les marques
        déjà posées, sinon le coupe-circuit protégerait le troisième document et pas les deux
        premiers.
      - ⚠️ **L'idempotence tient dans une Script Property, donc elle a un plafond** (200 `fileId`,
        mesuré au plafond contre les ~9 Ko). L'étape REFUSE une tranche plus grande au lieu de
        découvrir la limite en production — une Property qui déborde lève à l'écriture, et la
        campagne re-paierait alors une extraction par document à chaque passe sans jamais
        avancer. **La tranche suivante (3 862 papiers) ne tiendra JAMAIS ici** : l'élargir
        exigera un autre mécanisme, et c'est écrit plutôt que découvert.
      - **Où le lire sans rien exécuter** : la ligne de Santé **« Rattrapage des pièces
        (C49-5) »** — restants, dernière passe (faits/échecs/sans texte), motif de fin, et
        **qui l'a lancée** (`par le tick` / `lancée à la main`). Le détail et le COÛT d'une
        tranche AVANT de la dépenser : `RattrapagePiece.gs` → `diagnosticRattrapagePiece` →
        Exécuter (lecture seule, rien de persisté, rien d'envoyé).
      - **Le chemin manuel** : `RattrapagePiece.gs` → `rattraperPiecesMaintenant` → Exécuter.
        Hors budget quotidien et hors porte de l'audit — c'est le geste de Marc — mais PAS hors
        garde-temps, jeton, suspension ni frein en dollars. Il existe pour la raison de C28-137 :
        un `opts` lu par le moteur et passé par personne est une intention jamais livrée, et on
        s'en aperçoit le jour où le budget du tick est épuisé.
      - ⚠️ **ARMÉ LE 17/09** (`c49-5-a`) : Marc a jugé l'audit — « ok jugé, pose le tag, extrait
        tous les docs aujd ». La porte de la §7 de l'ADR-0061 est levée PAR LUI, jamais déduite
        d'un compteur de verdicts. ⚠️ Bumper ce tag ensuite REFAIT toute la tranche : la liste
        des faits est écrite SOUS le tag, donc chaque document re-coûte son appel Haiku.
      - ⚠️⚠️ **« TOUS LES DOCS AUJOURD'HUI » NE PASSE PAS PAR LE TICK, ET IL FAUT LE DIRE.** Le
        budget quotidien des pièces était **déjà épuisé** au moment de l'armement (17,2 des
        17 min consommées par l'audit) : le tick ne fera donc **rien** aujourd'hui, et il
        reprendra demain avec ses 11 min — soit ~66 documents/jour à 10 s l'un, donc les 110 en
        **deux jours**. Le seul chemin pour aujourd'hui est **manuel**, et il demande
        **~4 exécutions** : `RattrapagePiece.gs` → `rattraperPiecesMaintenant` → Exécuter, le
        mur d'Apps Script étant à 6 min et `CONFIG.BUDGET_MS` à 4,5 (≈ 27 documents par
        exécution). La fonction annonce à chaque fois combien il RESTE.
      - ⚠️ **Les deux plafonds « 5 par run » ne s'appliquent plus au chemin manuel** (C28-33 :
        « un budget calibré pour UN CHEMIN d'exécution ne doit ni brider, ni être consommé par,
        un AUTRE chemin »). Cinq documents protègent un tick de 5 min qui a dix autres étapes à
        servir ; imposés à un geste que Marc lance lui-même, ils lui demanderaient **vingt-deux**
        exécutions. Ce que `manuel` ne lève JAMAIS, et qui est re-évalué à chaque document : le
        garde-temps, le jeton, la suspension, la panne de plateforme et le frein en DOLLARS.
   2. Seulement ensuite, et dans CET ordre : **poser `CONFIG.RATTRAPAGE_PIECE_TAG`** (la tranche
      `04`+`01`, C49-5 ci-dessus), juger ce qui est arrivé dans MemoryAI `/pieces` — le retrait
      y existe depuis la PR #26 —, puis seulement `CONFIG.PIECE_PUSH = true` pour le flux vivant.
      ⚠️ Cette ligne annonçait « le rattrapage (C49-4) par le runner » jusqu'au 17/09 : il n'y a
      pas de runner, et C49-4 ne fait que COMPTER. Le rattrapage est C49-5 et il tourne dans le
      tick.
   ⚠️ **Comment savoir que le code a PRIS EFFET** — pas le run vert (piège 3, et son inverse, la
   cause n° 3 du 2 bis) : la ligne de Santé **« Mémoire (pièces) »** doit apparaître dans
   `etat_moteur`, DISTINCTE de « Mémoire (inventaire) ». Les deux canaux tombent pour des raisons
   différentes et l'un coûte un appel LLM par document, l'autre aucun : une seule ligne pour les
   deux ferait disparaître la panne du plus cher derrière la santé du plus simple.
   ⚠️ **Le signal du CANAL passe avant celui du DOCUMENT** : une photo sans texte
   (« sans-texte », « non-classé ») n'écrase JAMAIS un « jeton refusé » à l'écran, et
   `DriveAI_PIECE_DERNIER_REFUS` n'est jamais effacé par un succès. C'est la seule chose qu'on
   cherche quand le canal a l'air de marcher — le 16/09, 4 000 faits ont été refusés dans des
   HTTP 200.
   ⚠️ **Décision d'architecture prise sans feu vert** : l'envoi est **immédiat**, un POST par
   document, là où l'inventaire batche par 50. L'alternative écartée — accumuler puis pousser —
   obligerait à garder le texte OCR de plusieurs papiers entre deux ticks, c'est-à-dire un stock
   de contenu personnel hors de la Mémoire que rien ne protège et que personne ne purge.
   `CLAUDE.md` §9 interdit de persister le corps d'un document, et l'ADR-0061 a levé la sortie
   VERS la Mémoire, jamais le stockage local.
3. *(`P1-09` — fait)* le coût LLM réel est désormais **mesuré** (`Cout.gs`, tokens `usage` agrégés
   par mois) et **affiché chaque semaine** dans le résumé hebdo automatique (`Resume.gs`). Plus besoin
   d'estimer : à observer sur le 1er mois réel pour confirmer < 10 $/mois.

### Améliorations en cours (demandées par Marc le 2026-06-30, après la mise en prod de Phase 3)
Marc a demandé 4 chantiers d'amélioration ; ordre de livraison :
1. **Visibilité + coût réel** (`P1-09`/`P1-10`) — ✅ codé, revue flotte 🟢 (quotas + code-reviewer) :
   `Cout.gs` (mesure des tokens) + `Resume.gs` (résumé hebdo auto par mail, déclencheur auto-installé
   `assurerTriggerResume_`, aucun nouveau scope).
2. **Quarantaine après N échecs** — ✅ codé (`Journal.gs` onglet `Échecs` + compteur cross-tick,
   `Pipeline.gs` `gererEchec_`, `CONFIG.QUARANTAINE_MAX=3`). Un doc en échec persistant est compté ;
   après 3 essais → Index `quarantaine` (plus jamais re-OCRisé) + 1 alerte. Échecs intermédiaires :
   `journalErreur_` sans mail (anti-spam, au lieu d'un mail par tick). Compté aussi dans le résumé hebdo.
   Récupération après panne transitoire : `dequarantaine()` (Maintenance.gs, un clic) re-traite les
   docs quarantinés à tort. Revue flotte 🟢 (file-checker idempotence + apps-script-quota I/O, CONFORME).
3. **Filtre d'utilité des PJ** — ⬜ à faire (écarter signatures/logos/pubs avant OCR/LLM).
4. **Classement plus fin** — ⬜ à faire (enrichir catégories/sous-dossiers + entités ; prudent, dégrader
   jamais bloquer).

### Correctifs prod du 2026-07-01 (session marathon, après mise en prod Phase 3)
- **Pipeline gelé (hotfix, #24)** : `appliquerRangementInitial_` tournait avant l'intake et sans try/catch
  → une erreur de collecte gelait tout le tick (file `00·À trier` figée des heures). Corrigé : drainer avant
  d'alimenter + maintenance auto enveloppée. Diagnostiqué par le CODE + signaux Drive (cache Sheet figé).
- **Lecture Office (P1-13, #25)** : les `.docx/.ppt` partaient tous en revue « OCR vide » (extracteur limité
  aux PDF/images) → conversion Google native ajoutée → CV/TP/présentations classés. Bump VERSION = re-tri auto.
- **Sensibles auto-classés (P1-14)** : *décision Marc* — `sensible`/zone protégée ne routent plus en revue
  (classés dans leur domaine ; doublon sensible → `_Doublons`, 1 exemplaire gardé). `CLAUDE.md` §1 réécrit.
  Garde-fous conservés : aucune suppression, non-détachement de 04. Seul `domaine inconnu` reste en revue.
- **Vérif prod** : le cache de lecture de la Sheet est resté figé toute la session → tout vérifié par
  **recherche Drive directe** (contenu des dossiers par `parentId`, `modifiedTime`). Résultat confirmé :
  CV → 05·Carrière, doublons → `_Doublons`, revue vidée du faux sensible.

### Hotfix « pipeline gelé » (2026-07-01, découvert en regardant le ménage en prod)
La file `00·À trier` stagnait : ~20 vieux fichiers déplacés par le grand rangement y sont restés des heures
sans être classés, et plus rien n'était traité (le moteur écrivait pourtant son état chaque tick). Cause :
dans `tickDriveAI`, `appliquerRangementInitial_` tournait AVANT l'intake **et** n'était pas enveloppé de
try/catch — le `try` de `tickDriveAI` n'a qu'un `finally`, donc une exception dans la collecte (walk de
l'ancien Drive) **tuait tout le tick avant Gmail/dépôts/intentions**, à chaque tick. Correctif : (1) rejeu +
rangement + `creerDossiersEntitesValidees_` enveloppés de try/catch (une erreur ne peut plus geler l'intake) ;
(2) rangement déplacé APRÈS l'intake, `if (!estBudgetDepasse())` → **drainer avant d'alimenter** ; (3) scan
Gmail durci par fil. Revue flotte 🟢 (apps-script-quota + code-reviewer). Diagnostic fait **par lecture du code
+ recherche Drive directe** (le cache de lecture de la Sheet étant figé toute la session). Leçon consignée.

### Doublons → `_Doublons` (P1-12, décidé par Marc le 2026-06-30 en regardant la prod)
La vérif prod (via recherche Drive directe, le cache de lecture Sheet étant figé) a montré que le grand
rangement **marche** (vieux fichiers déplacés vers `00·À trier`, docs renommés+classés) MAIS que la file
de revue se **saturait de `[REVUE] doublon`** (ancien Drive plein de copies : relevés Employeur A, docs scolaires
2018). Sur choix de Marc (option « dossier _Doublons + log »), les doublons NON sensibles vont maintenant
dans `_Doublons` (déplacement seul, jamais supprimé) au lieu de la revue ; un doublon **sensible** reste en
revue (§1 prioritaire dans `Router.deciderRoutage_`). `nettoyerDoublonsRevue()` (un clic) balaie les doublons
déjà accumulés en revue. ✅ codé, revue flotte (sécurité + file-checker + structure-keeper).

> Steady-state désormais **100 % automatique** : nouveaux mails + dépôts traités par le trigger 10 min ;
> mes changements de code déployés par l'Action ; reclassement après recalibrage par l'auto-rejeu.
> Le `rejouerLaRevue` manuel reste dispo (c'est le seul endroit qui met des copies Gmail à la corbeille).

