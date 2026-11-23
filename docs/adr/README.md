# Décisions d'architecture (ADR) — DriveAI

Ce dossier trace les **décisions structurantes** de DriveAI : le *quoi* et surtout le *pourquoi*.
Format léger inspiré des *Architecture Decision Records* (Michael Nygard).

Chaque ADR : **Statut · Contexte · Décision · Conséquences · Alternatives écartées.**
Statuts normalisés (le premier mot de la ligne `Statut` de chaque ADR, vérifié par `test/adr-statuts.test.js`) :
`Proposé` · `Accepté` · `Abandonné` · `Abrogé` (les annexes ne portent pas de statut). Le détail d’avancement (« livré en #338 »,
« code sous flag éteint ») vit dans l’ADR lui-même, pas dans cet index ; la colonne « Liens et précisions » ne garde que ce
qui relie les ADR entre eux (révise, complète, remplace, abroge).

Numéro 0059 porté par trois fichiers : le cadrage et ses deux annexes (A critique, B Gmail et Drive). Les annexes sont des pièces
jointes, pas des décisions.

> ⚠️ Un ADR **Accepté** peut décrire une **cible** pas encore livrée, ou une cible livrée depuis (sa ligne `Statut`
> peut dater). Le comportement réellement codé vit dans `docs/TAXONOMY.md`, `docs/NAMING.md` et `src/` : en cas de doute, le
> code fait foi. Quand une PR rattrape un ADR, elle met à jour la ligne `Statut` de l’ADR et la doc touchée.

## Index

| ADR | Titre | Statut | Liens et précisions |
|-----|-------|--------|---------------------|
| [0001](0001-cadrage-produit.md) | Cadrage produit : vision, priorités, contraintes | Accepté |  |
| [0002](0002-refonte-taxonomie-entites-nommage.md) | Refonte : taxonomie, entités & nommage | Accepté | révisé par 0031 (§4) |
| [0003](0003-controle-correction.md) | Contrôle & correction (et apprentissage) | Accepté |  |
| [0004](0004-fiabilite.md) | Fiabilité totale (zéro babysitting) | Accepté |  |
| [0005](0005-sources-entree.md) | Sources d'entrée | Accepté |  |
| [0006](0006-architecture-qualite.md) | Architecture & qualité (tests, testabilité, état lisible) | Accepté |  |
| [0007](0007-securite-vie-privee.md) | Sécurité & vie privée | Accepté | révisé par 0012 (Gmail) et 0057 (une glose) |
| [0008](0008-app-web-recherche-controle.md) | App web (Phase 4) : recherche, contrôle & tableau de bord | Accepté | révisé par 0031 |
| [0009](0009-qualite-entites-medias.md) | Qualité du moteur : entités propres & médias bruts | Accepté |  |
| [0010](0010-mails-historique-visibilite.md) | Mails : historique complet, visibilité Phase 3, mails importants | Accepté | révisé par 0050 (§3) · 0075 (§3, mini-check absorbé par le tri) |
| [0011](0011-app-v2-curation.md) | App web v2 : curation efficace & confort | Accepté |  |
| [0012](0012-tri-gmail-natif.md) | Tri Gmail natif : libellés + archivage (levée contrôlée de la lecture seule) | Accepté | révisé par 0075 (catégorie sur sujet + corps) |
| [0013](0013-app-v3-direction-b.md) | App v3 : refonte complète, direction « Salle des machines » (B) | Accepté | complète 0008, 0011 · remplacé visuellement par 0019 puis 0051 |
| [0014](0014-corbeille-dossiers-vides.md) | Corbeille des dossiers devenus VIDES : révision ÉTROITE du garde-fou §2 | Accepté | révise CLAUDE.md §2.2 · complète 0013 · révisé par 0025 |
| [0015](0015-activation-analyse-v2.md) | Analyse documentaire v2 (Sonnet 2 passes) : durcissement + PRÉ-REQUIS d'activation | Accepté | complète 0002, 0004 |
| [0016](0016-fail-safe-hybride-revue-ultra-stricte.md) | Fail-safe : ré-introduction ULTRA-STRICTE de `00 · À vérifier` (révision §2.1) | Accepté | révise CLAUDE.md §2.1 |
| [0017](0017-miroir-drive-du-depot.md) | Miroir texte du dépôt vers Drive (accès de partout + NotebookLM) | Abandonné | abandonné le 2026-09-28 (plus de miroir NotebookLM ; code et workflow retirés) |
| [0018](0018-reanalyse-ciblee-v2.md) | Activation de l'analyse v2 + campagne de RE-ANALYSE CIBLÉE (C26-08) | Accepté |  |
| [0019](0019-app-v4-accueil-centralise.md) | App v4 : accueil tout-en-un & hiérarchie de l'attention (C28-17) | Accepté | remplace l'éclatement de 0013 · remplacé en partie par 0026 et 0051 |
| [0020](0020-curation-mails-confiance.md) | Curation des mails : table de Confiance, balayage cyclique & intentions élargies | Accepté | révisé par 0076 (plafond commun aux campagnes de fond, réserve du vivant) |
| [0021](0021-zero-config-verrou-identite.md) | Zéro configuration client & verrou d'identité ALLOWED_EMAIL | Accepté |  |
| [0022](0022-fiabilite-intentions-nettoyage.md) | Fiabilité des intentions & nettoyage profond de la boîte | Abrogé | révisé par lui-même (C28-48) et par 0049 · abrogé par 0074 (extraction et création retirées, analyse d'importance conservée) · plafond du nettoyage profond fondu dans 0076 |
| [0023](0023-taxonomie-a-plat.md) | Taxonomie à PLAT par défaut (abandon de la profondeur forcée) + campagne de consolidation | Accepté | révisé par 0030 et 0052 · sa décision 4 révisée par 0024 |
| [0024](0024-execution-consolidation.md) | Exécution automatique du plan de consolidation + entités par SEED | Accepté | complète 0023, révise sa décision 4 |
| [0025](0025-nettoyage-agressif.md) | Nettoyage agressif & corbeillage en lot (batch) | Accepté | révise 0014 · complète 0023, 0024 |
| [0026](0026-assistant-chat.md) | Onglet Assistant : chat Claude (Q&A sur fichiers + opérations de dossiers) | Abrogé | remplace la section réorg de 0019 · abrogé par 0074 (chat à outils retiré, bandeau « À valider » conservé) |
| [0027](0027-limite-sous-dossiers.md) | Limite cognitive des sous-dossiers (~7, loi de Miller) | Accepté | complète 0023, 0002 |
| [0028](0028-routage-topologique-par-id.md) | Routage TOPOLOGIQUE : le `Dossier ID` prime sur le chemin textuel | Accepté | complète 0023, 0002 |
| [0029](0029-reorg-auto.md) | Campagne de réorganisation AUTOMATIQUE (limites cognitives) | Abrogé | abrogé par 0031 (code retiré, historique conservé) |
| [0030](0030-reset-tri.md) | RESET complet : rassemblement `_TRI 2026`, dédup par contenu, nouvelle structure ≤ 7 | Accepté | révise 0023 |
| [0031](0031-arret-propositions-spontanees.md) | Arrêt de toute proposition SPONTANÉE du moteur (entités, réorg auto) + retrait des demandes ponctuelles orphelines | Accepté | révise 0029, 0002 §4, 0008 |
| [0032](0032-pilote-ci.md) | Pilote CI : plus AUCUN lancement à la main, et un débit supérieur au manuel | Accepté |  |
| [0033](0033-unification-cheminCibleVivant.md) | Unification du rangement : le flux vivant adopte la structure Reset validée | Accepté |  |
| [0034](0034-2e-passe-conditionnelle.md) | 2ᵉ passe conditionnelle (économie ~½ du coût v2), sous flag, à valider sur du réel | Proposé | code livré sous flag éteint ; activation à valider par Marc |
| [0035](0035-retrait-reset-deadlock.md) | Retrait du reset (deadlock `resetEnCours_` perpétuel) + re-génération consolidation | Accepté |  |
| [0036](0036-fusion-dossiers-doublons.md) | Fusion des dossiers d'entité en double/synonymes (dry-run validé, PR1) | Accepté |  |
| [0037](0037-fusion-execution.md) | Exécution du plan de fusion des dossiers en double (#47 PR2, gardée) | Accepté |  |
| [0038](0038-suivi-generique-operations.md) | Suivi générique et fiable de TOUTES les opérations du tick (Progression v2) | Accepté |  |
| [0039](0039-missions-curation.md) | Missions de curation (C28-49) : le rangement fin, dossier par dossier, piloté par Marc | Accepté |  |
| [0040](0040-affinage-missions-non-apparies.md) | Affinage des règles de missions : les 89 non-appariés (C28-51) | Accepté |  |
| [0041](0041-tasks-calendar-projet-hubperso.md) | Tasks & Calendar via le projet GCP hubperso (jeton OAuth dédié) | Abrogé | abrogé par 0074 (Tasks, Calendar et jeton hubperso retirés) |
| [0042](0042-mcp-driveai.md) | MCP DriveAI : connecteur claude.ai (recherche, état, réorg, intentions) | Abrogé | abrogé par 0074 (connecteur retiré) |
| [0043](0043-tri-gmail-decouple-des-intentions.md) | Le tri Gmail ne meurt plus quand les intentions sont suspendues | Abrogé | abrogé par 0075 (6b, 06/11/2026 : plus d'analyse d'importance séparée, mode dégradé retiré) · 0049 (§2.1, lui-même abrogé par 0074) |
| [0044](0044-affinage-non-apparies-decisions-marc.md) | Affinage des non-appariés : 8 décisions du propriétaire (2026-08-19) | Accepté | complète 0039, 0040 |
| [0045](0045-inventaire-documents-vers-financeai.md) | Un inventaire de documents pour FinanceAI, et pourquoi ce n'est PAS un auto-apply | Abandonné | jamais codé ; abandonné par 0074 (FinanceAI hors périmètre) |
| [0046](0046-mission-identite.md) | Mission identité : ce que le Drive montre, et pourquoi la mission ne déplacera pas tout | Proposé | complète 0039, 0044 |
| [0047](0047-validation-doublons-par-empreinte.md) | `_Doublons` : valider par empreinte avant de croire la détection | Accepté | complète 0039, 0016 |
| [0048](0048-drainage-documents-id.md) | Drainer `Documents ID`, et pourquoi ce ne peut pas être un déplacement | Accepté | complète 0046, 0047 |
| [0049](0049-decoupler-tri-et-creation-intentions.md) | Une panne d'agenda ne gèle plus l'archivage de la boîte | Abrogé | révise 0043 §2.1 et 0022 · complète 0041, 0043 · abrogé par 0074 (plus de création d'agenda) |
| [0050](0050-un-fil-lu-sort-de-la-boite.md) | Un fil LU sort de la boîte : ⏰ et « À vérifier » deviennent des libellés, plus des ancres | Accepté | révise 0010 §3 · complète 0043, 0049 · révisé par 0076 (archivage EN boîte seulement) |
| [0051](0051-app-v7-le-telephone-d-abord.md) | App v7 : le téléphone d'abord, une colonne, zéro phrase inutile | Accepté | remplace visuellement 0013, 0019 |
| [0052](0052-plus-de-fichiers-a-plat.md) | Plus aucun fichier à plat à la racine d'un domaine (2026-09-13) | Accepté | révise 0023 · complète 0033, 0044, 0030 |
| [0053](0053-la-liste-des-dossiers-vides.md) | La liste des dossiers vides ne propose plus ce que le moteur recrée | Accepté |  |
| [0054](0054-realloquer-le-budget-de-runtime.md) | Réallouer le budget de runtime vers le vrai goulot | Accepté |  |
| [0055](0055-la-structure-des-ecoles-est-celle-de-marc.md) | La structure des écoles, c'est celle de Marc | Accepté |  |
| [0056](0056-finaliser-avant-le-prochain-chantier.md) | Finaliser avant le prochain chantier | Accepté |  |
| [0057](0057-le-hub-voit-ce-que-le-moteur-fait.md) | Le hub voit ce que le moteur FAIT, et un nom de fichier quitte le compte de Marc | Accepté | révise une glose de 0007 |
| [0058](0058-une-paie-vit-en-finances.md) | Une paie vit en Finances, quel que soit l'avis du LLM | Accepté |  |
| [0059](0059-annexe-critique.md) | Annexe A : critique de complétude de la carte de l'écosystème | Annexe | pièce jointe de 0059-assistant-transversal-cadrage |
| [0059](0059-annexe-gmail-scopes.md) | Annexe B : qui accède à Gmail et à Drive, et à quel prix | Annexe | pièce jointe de 0059-assistant-transversal-cadrage |
| [0059](0059-assistant-transversal-cadrage.md) | L'assistant qui me connaît : cadrage de l'assistant personnel transversal | Accepté | cadrage ; annexes A et B ci-dessous · révisé par 0061 (§4 points 1 et 3) · canal retiré par 0074 |
| [0060](0060-le-code-suit-le-drive-de-marc-06.md) | Le code suit le Drive de Marc : Cégep A, la garde de création, Online course | Accepté |  |
| [0061](0061-le-contenu-des-documents-quitte-le-compte.md) | Le CONTENU des documents quitte le compte, et ce qu'on obtient en échange | Accepté | révise 0059 §4 points 1 et 3 · canal retiré par 0074 |
| [0062](0062-arreter-les-sept-campagnes-et-rendre-leurs-minutes.md) | Arrêter sept campagnes, et rendre leurs 41 min/j à la lecture des papiers | Accepté |  |
| [0063](0063-lire-l-image-du-papier.md) | Lire l'IMAGE du papier (Sonnet 5), et l'auditer sur vingt avant la campagne | Accepté | retiré par 0074 |
| [0064](0064-envoyer-les-exports-messenger-a-la-memoire.md) | Envoyer les exports Messenger à la Mémoire, par lots, allumé le 24/10/2026 | Accepté | jumeau de l'ADR 0020 de MemoryAI · retiré par 0074 |
| [0065](0065-relire-les-papiers-a-l-aveugle-pour-la-memoire.md) | Relire les papiers à l'aveugle pour la Mémoire (seconde lecture) | Accepté | jumeau de l'ADR 0026 de MemoryAI · retiré par 0074 |
| [0066](0066-envoyer-l-agenda-du-jour-a-la-memoire.md) | Envoyer l'agenda du jour à la Mémoire (lecture étroite, livré éteint) | Accepté | révise 0022 · jumeau de l'ADR 0029 de MemoryAI · retiré par 0074 |
| [0067](0067-passer-aux-modeles-5-5.md) | Passer le moteur aux modèles 5.5 et retirer les anciens | Accepté | révise 0061 et 0063 (choix de modèle) · révisé par 0073 (fournisseur) |
| [0068](0068-relire-vingt-papiers-par-l-image.md) | Relire 20 papiers « illisibles » par leur image (essai) | Accepté | prolonge 0065 · jumeau de l'ADR 0026 de MemoryAI · retiré par 0074 |
| [0069](0069-partager-l-etat-de-lia-par-le-hub.md) | Partager l'état de LIA avec le hub : relais serveur par jeton d'app | Abrogé | complète DriveAI#650 · abrogé par 0074 (LIA retirée) |
| [0070](0070-ne-pas-jeter-en-doublon-sans-exemplaire-vivant.md) | Ne pas jeter en `_Doublons` un fichier dont plus aucun exemplaire n'est vivant | Accepté | prolonge 0047 · protocole de précision · révisé par 0077 (« dans le doute » n'est plus un doublon ; l'exemplaire vivant est nommé) |
| [0071](0071-re-traiter-un-fichier-que-marc-remet-dans-a-trier.md) | Re-traiter une fois un fichier classé que Marc remet dans `00 · À trier` | Accepté | prolonge 0026 · protocole de précision |
| [0072](0072-ne-pas-inscrire-l-empreinte-d-un-contenu-vide.md) | Ne pas inscrire à l'Index l'empreinte d'un contenu qui n'identifie rien | Accepté | prolonge 0070 · protocole de précision · tenu par 0077 (même par REST) |
| [0073](0073-passer-le-moteur-a-l-api-gemini.md) | Passer le moteur de l'API Anthropic à l'API Gemini (adaptateur, aucun modèle changé) | Accepté | révise 0067 (fournisseur) · étape 4 de 0074 · protocole de précision à l'étape 5 |
| [0074](0074-relancer-driveai-sur-une-base-epuree.md) | Relancer DriveAI sur une base épurée : trois fonctions, Gemini, et le terrain pour Antigravity | Accepté | retire le canal Mémoire (0059, 0061, 0063, 0064, 0065, 0066, 0068) · abandonne 0045 · abroge 0026, 0042, 0069 (étape 2) et 0022, 0041, 0049 (étape 3) |
| [0075](0075-trier-les-mails-sur-sujet-et-corps.md) | Le tri Gmail lit le sujet ET le corps et décide « à traiter » lui-même (6a : drapeau OFF + audit ; 6b allumée le 06/11/2026, drapeau retiré, r3) | Accepté | étape 6 de 0074 · révise 0012, 0010 · abroge 0043 · protocole de précision · porte « hors fenêtre » ajoutée par 0076 |
| [0076](0076-trier-l-historique-archive-sous-un-plafond-unique.md) | Trier tout l'historique Gmail (lus, archivés, sans libellé) sous UN plafond quotidien qui n'affame jamais l'intake | Accepté | étape 7 de 0074 · révise 0020, 0022 (plafonds C28-21/C28-22), 0050 (en boîte seulement) · n'entre pas dans l'enveloppe de 0074 §2.6 (§2.8) |
| [0077](0077-ecarter-un-doublon-sur-taille-et-empreinte.md) | Écarter un doublon seulement sur taille ET empreinte, face à un exemplaire prouvé vivant, avec la preuve écrite | Accepté | étape 8 de 0074 · révise 0070 (plus de doublon « dans le doute », l'exemplaire est nommé) · prolonge 0072 · protocole de précision |
| [0078](0078-app-et-session-sur-firebase-blaze.md) | L'écran et la session de DriveAI sur Firebase (plan Blaze, plafonds bas) | Accepté | complète 0074 (§2 point 5) · remplace Vercel pour `app/` et `api/` |
| [0079](0079-fiabilisation-moteur-et-gel-regles-tri.md) | Fiabilisation du moteur (Groupe A) et gel des règles de tri (Groupe B) | Accepté | complète 0004, 0012, 0050, 0073, 0075, 0076, 0077 · protocole de précision |
| [0080](0080-referentiel-classement-9-piliers.md) | Alignement sur le référentiel de classement & nommage à 9 piliers | Accepté | complète 0002, 0030, 0033, 0052, 0058 · protocole de précision |

Voir aussi `docs/ROADMAP.md` (ordre d'implémentation), `docs/RUNBOOK.md` (exploitation) et `docs/GUIDE.md` (usage).
