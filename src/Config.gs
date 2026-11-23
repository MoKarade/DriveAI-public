/**
 * Config.gs — Configuration centrale de DriveAI (Phase 1).
 *
 * Aucune donnée secrète ici : la clé API vit dans les Script Properties
 * (`DriveAI_ANTHROPIC_KEY`). Les IDs de dossiers viennent de docs/TAXONOMY.md.
 */

var CONFIG = {
  // Version du comportement de CLASSEMENT. À incrémenter UNIQUEMENT quand une
  // évolution change la façon de ranger (prompt, routage, seuils, schémas) — PAS à
  // chaque commit (sinon coût LLM/quota inutile). Au tick suivant un déploiement, si
  // la version stockée diffère, le moteur renvoie automatiquement les copies LEGACY parties
  // en revue (avant P1-16) vers 00·À trier pour reclassement (cf. Main.appliquerRejeuSiNouvelleVersion_)
  // — borné, réversible, sans toucher aux PJ Gmail ni aux docs déjà classés. Zéro clic.
  VERSION: 'P3.0',

  // --- Seuils & modèle ---
  SEUIL_CONFIANCE: 0.50,                 // sous ce seuil → analyse approfondie (escalade Sonnet), puis
                                         // classé au mieux — plus jamais de file de revue (décision Marc)
  LLM_MODELE: 'claude-haiku-5-5',        // Haiku par défaut (le moins cher)
  LLM_MODELE_FALLBACK: 'claude-sonnet-5-5', // fallback ponctuel si Haiku échoue
  LLM_MAX_TOKENS: 600,                   // marge : le tokenizer de la 5.5 compte ~30 % de jetons en plus
  LLM_OCR_MAX_CARS: 4000,                // troncature de l'extrait envoyé au LLM (coût)
  // GEMINI (ADR-0073). Fournisseur choisi par le NOM du modèle ci-dessus (`gemini-…` = Google via `Gemini.gs`) :
  // l'étape 4 ne change AUCUN modèle, la bascule est l'étape 5. PETIT = tri, mini-check ; GRAND = 2 passes, escalade.
  GEMINI_MODELE_PETIT: 'gemini-3.5-flash-lite', // « Stable », page des modèles relevée le 05/11/2026
  GEMINI_MODELE_GRAND: 'gemini-3.8-flash',      // « New », le Flash le plus capable, même relevé
  GEMINI_THINKING_LEVEL: 'low',           // thinkingConfig.thinkingLevel ; refusé par l'API → rejeu sans ; '' = non envoyé
  GEMINI_MARGE_SORTIE: 2048,              // la réflexion se paie sur maxOutputTokens ; non facturée si inutilisée
  // Export texte d'un fichier Google natif (R3). Le hash de doublon porte sur le texte ENTIER
  // (tronqué à 4000, deux gros CSV au même en-tête = « doublons » — faux) ; la borne large ne
  // protège que la mémoire. Sous le seuil MIN, jamais de fast-path doublon (MD5 d'un export
  // vide/quasi vide = collision garantie entre documents différents sans texte).
  NATIF_EXPORT_MAX_CARS: 2000000,
  OCR_MIN_CARS_EXPLOITABLE: 20,
  EMPREINTE_CONTENU_VIDE: 'd41d8cd98f00b204e9800998ecf8427e', // MD5 du contenu vide : n'identifie aucun document (ADR-0072), jamais écrite à l'Index ni jugée doublon

  // --- REFONTE #26 : analyse en 2 passes (extraction + vérification adversariale) ---
  // Chantier #26 (demande Marc 2026-07-07 : « fiabilité maximale, Sonnet 2 passes, quitte à coûter
  // plus cher »). ALLUMÉ 2026-07-09 (ADR-0018) : FEU VERT explicite de Marc après la preuve dry-run
  // C26-07 (100 docs réels, 0 fail-safe, confiance médiane 0,93, 0,026 $/doc — onglet DryRunV2).
  // Quand ON : `classifierDeuxPasses_` (Llm.gs) remplace `classifier_`, et `deciderRoutageV2_`
  // (Router.gs) remplace `deciderRoutage_` — schéma étendu (non-document, identité par type, entité
  // unifiée, descripteur jamais « Inconnu », sous-dossier obligatoire). OFF ⇒ pipeline Haiku 1 passe.
  ANALYSE_V2: true,
  ANALYSE_V2_MODELE: 'claude-sonnet-5-5',   // les 2 passes tournent sur Sonnet (fiabilité > coût, quand ON)
  ANALYSE_V2_MAX_TOKENS: 1400,              // schéma étendu (15 champs) → marge large (un JSON tronqué = doc en échec)
  ANALYSE_V2_OCR_MAX_CARS: 12000,           // texte envoyé au LLM moins tronqué qu'en Haiku (4000) — analyse plus fine
  // 2ᵉ PASSE CONDITIONNELLE (Vague 3c, décision Marc « Optimiser ») : sauter la passe 2 adversariale
  // quand la passe 1 est SÛRE et COMPLÈTE (économie ~moitié du coût v2). ÉTEINT par défaut : c'est un
  // compromis de CORRECTNESS (la passe 2 conteste et corrige) → à VALIDER sur du réel (dry-run
  // comparant 1 passe vs 2 passes) AVANT allumage, comme le flag ANALYSE_V2 lui-même (§8). Le gate
  // `passe1SuffisammentSure_` refuse TOUJOURS de sauter pour un doc SENSIBLE (immigration/fiscal, §2),
  // un non-document, une pièce d'identité, ou une confiance < seuil / des faits manquants.
  ANALYSE_V2_2E_PASSE_CONDITIONNELLE: false,
  ANALYSE_V2_SEUIL_1PASSE: 0.9,             // confiance MINIMALE de la passe 1 pour oser sauter la passe 2
  // Escalade : si Haiku rend une confiance < SEUIL (et doc NON sensible), on relance
  // une analyse approfondie avec Sonnet, plusieurs passes, et on garde la meilleure (consensus
  // de domaine puis confiance max). 3 passes (impair → vote utile). Borné pour le budget
  // (< 10 $/mois) : ne concerne que les cas peu sûrs, et plafonné par run ci-dessous.
  LLM_ESCALADE_PASSES: 3,
  LLM_ESCALADE_MAX_PAR_RUN: 8,            // abaissé (25→8) pour ACCÉLÉRER le rangement de masse : l'escalade
                                          // Sonnet ×3 est le plus gros coût-temps/tick ; au-delà on garde le
                                          // résultat Haiku (« classer au mieux », décision Marc). Débit ↑.
  // Prix Anthropic par MILLION de tokens (input/output), pour MESURER le coût réel (Cout.gs, P1-09).
  // À ajuster si la grille de prix change. Relevé le 2026-10-28 sur la page des tarifs Anthropic :
  // Haiku 5.5 : 0,10 $/0,50 $ ; Sonnet 5.5 : 2 $/10 $ (relecture de cache 0,10 $).
  // Prompt caching (Vague 3, décision Marc « Optimiser ») : écriture cache = ×1,25 du prix input,
  // lecture cache = ×0,10. Le prompt SYSTÈME (constant, gros) est mis en cache → les appels suivants
  // dans la fenêtre TTL (~5 min, campagnes/lots) ne repaient l'input système qu'à 10 %. Ces champs
  // DOIVENT exister pour que `coutDollars_` compte les tokens cache (sinon budget sous-estimé §2.6).
  LLM_PRIX: {
    // Génération 5.5 : les SEULS modèles appelés aujourd'hui (écriture de cache = ×1,25 l'entrée).
    haiku55_in: 0.1, haiku55_out: 0.5, haiku55_cw: 0.125, haiku55_cr: 0.01,
    sonnet55_in: 2, sonnet55_out: 10, sonnet55_cw: 2.5, sonnet55_cr: 0.1,
    // Gemini (ADR-0073), palier PAYANT, page des tarifs relevée le 2026-11-05. ⚠️ 3.8 Flash : 0,75 $ / 3,75 $
    // (cache lu 0,075 $) JUSQU'AU 31/12/2026, puis 1,50 $ / 7,50 $ / 0,15 $ dès le 01/01/2027 (`test/gemini.test.js`
    // rougit ce jour-là). Réflexion facturée en sortie ; cache implicite, aucune écriture facturée (`cw` = 0).
    gemini38_in: 0.75, gemini38_out: 3.75, gemini38_cw: 0, gemini38_cr: 0.075,
    // Gemini 3.5 Flash-Lite : 0,30 $ / 2,50 $, cache 0,03 $ (aucune hausse annoncée).
    geminil35_in: 0.3, geminil35_out: 2.5, geminil35_cw: 0, geminil35_cr: 0.03,
    // HISTORIQUE — plus aucun appel n'y est rangé ; ces prix servent à chiffrer les mois DÉJÀ comptés
    // dans `DriveAI_COUT_AAAA-MM` (Haiku 4.5, Sonnet 4.6, Sonnet 5). Ne pas les retirer : le cumul
    // publié au hub (`syntheseCoutTotal_`) en dépend.
    haiku_in: 1, haiku_out: 5, haiku_cw: 1.25, haiku_cr: 0.1,
    sonnet_in: 3, sonnet_out: 15, sonnet_cw: 3.75, sonnet_cr: 0.3,
    sonnet5_in: 2, sonnet5_out: 10, sonnet5_cw: 2.5, sonnet5_cr: 0.2,
  },
  // FREIN BUDGET des CAMPAGNES (R3, garde-fou §2.6 rendu EFFECTIF — vécu : 15,62 $ le 7 juillet,
  // le grand rangement churnait l'ancien Drive toute la nuit) : au-delà de ce coût MENSUEL mesuré,
  // les campagnes de MASSE (grand rangement, migration, historique Gmail) se mettent en pause
  // jusqu'au mois suivant — le FLUX VIVANT (Gmail 30 j, dépôts, partages, tri)
  // continue, lui. Relevé 10 → 30 (décision Marc 2026-07-07 : « je veux que tu continues le tri
  // au complet »), puis 30 → 65 (décision Marc 2026-07-09, ADR-0018 : campagne C26-08 ciblée
  // ~924 docs ≈ 24 $ en plus des 27 $ du mois entamé), puis 65 → 110 (décision Marc 2026-07-10,
  // « b » — révision ADR-0018 : m1 re-analyse désormais en V2 depuis l'allumage du flag, coût/doc
  // ×10 non chiffré dans le plan initial ; 54,59 $ au compteur le 10/07 au matin, finir m1 +
  // C26-08 ≈ 40-50 $ de plus, dans le crédit disponible). Les campagnes de RATTRAPAGE sont un
  // coût one-shot ; la cible < 10 $/mois reste celle du régime de croisière — Marc REDESCEND ce
  // plafond à 10 (en éditant cette ligne) à la fin de C26-08. Jamais 0/Infinity : le frein reste
  // le filet anti-emballement (boucle de re-OCR, erreur de convergence).
  // 110 → 10 (décision Marc 2026-08-01, Vague 3c : ENCADRER au 1er août — le compteur mensuel est
  // remis à 0 au nouveau mois, m1 + C26-08 sont finies, retour au régime de croisière < 10 $/mois ;
  // la checklist ADR-0018 est bouclée). Si une campagne de rattrapage devait reprendre, Marc relève
  // ponctuellement cette ligne (le frein est un FILET, jamais un gate du flux vivant).
  //
  // 10 → 30 puis 30 → 40 (décisions Marc 2026-08-20, à une demi-heure d'intervalle : « monte le
  // frein a 30 pour finir la campagne », puis « monte a 40 » après avoir lu le calcul ci-dessous
  // — 30 laissait ~146 documents sur le carreau).
  //
  // ⚠️ LA LIGNE DU 01/08 CI-DESSUS EST FAUSSE SUR UN POINT, et c'est ce qui a mené ici :
  // « m1 + C26-08 sont finies ». C26-08 ne l'était pas. Elle était à 322 documents sur 1207 le
  // 13/08 à 16 h 36, et le frein l'a mise en pause — constaté par le MCP le 20/08. Une campagne
  // déclarée terminée qui ne l'est pas ne se signale pas toute seule : elle se met simplement à
  // ne plus avancer, et le tableau de bord affiche « en pause » comme un état normal.
  //
  // POURQUOI 40 ET PAS 30, au coût MESURÉ de l'ADR-0018 (0,0261 $/doc, pas une estimation) :
  //     885 documents restants × 0,0261 $ = 23,10 $
  //   + 10,70 $ déjà dépensés au 20/08        = 33,80 $ pour aller au bout
  //   + flux vivant, < 0,50 $/j × 11 j        ≈ 39,30 $ au pire d'ici la fin du mois
  // 30 aurait fait retomber le frein après ~739 des 885 documents restants — la campagne se
  // serait remise en pause à ~146 du but, et il aurait fallu y revenir. 40 couvre la campagne
  // ENTIÈRE plus le flux vivant du reste du mois, avec ~0,70 $ de marge.
  //
  // ⚠️ À REDESCENDRE À 10 UNE FOIS C26-08 TERMINÉE — mais cette fois en LISANT le compteur de la
  // campagne, pas en la déclarant finie (c'est l'erreur du 01/08 documentée juste au-dessus).
  // Le régime de croisière reste < 10 $/mois ; 40 est un plafond de rattrapage, pas une cible.
  //
  // 40 → 20 (décision Marc 2026-10-29 11:57Z, « Ok 20$ », DriveAI#818 ligne 1 ; recommandation : 10, il a
  // choisi 20). La raison du 40 — la ré-analyse C26-08 — a disparu avec l'ADR-0062 ; le frein était
  // atteint à 40,90 $ le 29/10. 20 laisse de la place à la lecture des papiers (plafond propre
  // `VISION_PLAFOND_DOLLARS`) sans rouvrir le plafond de rattrapage : le régime de croisière reste < 10 $.
  // 20 → 25 $/mois cible, frein automatique mode économique à 30 $/mois (décision Marc 23/11/2026, ADR-0081).
  LLM_BUDGET_CIBLE: 25,                   // cible mensuelle de référence affichée dans Santé et Résumé (ADR-0081)
  LLM_BUDGET_CAMPAGNES: 30,               // frein automatique mode économique (coupe campagnes et escalades, ADR-0081)
  // C28-75 (décision Marc 2026-09-07) : plus AUCUN mail du moteur. Le résumé hebdo était le seul
  // envoi restant (les alertes de panne sont muettes depuis le 2026-07-06, `notifierEchec_`). À
  // `false`, `resumeHebdo` n'envoie rien ET `assurerTriggerResume_` SUPPRIME le déclencheur
  // existant — sans cette seconde moitié, un déclencheur déjà posé continuerait de partir chaque
  // lundi, et le tick le réinstallait de toute façon (Main.gs). Le calcul du résumé reste
  // disponible dans l'app (onglet Santé / Progression) ; seul le MAIL disparaît.
  MAILS_ACTIFS: false,
  // Résumé hebdomadaire automatique (mail récap à soi-même, scope script.send_mail existant).
  RESUME_JOUR: 'MONDAY',                  // jour du déclencheur hebdo (WeekDay Apps Script)
  RESUME_HEURE: 8,                        // heure locale d'envoi
  RESUME_JOURS: 7,                        // fenêtre d'activité résumée (jours)
  // Chantiers #13-#14 (ADR-0010 §2-3) : plafonds d'AFFICHAGE des nouvelles sections du résumé
  // hebdo (anti-bruit, décision Marc : jamais de notification immédiate, le résumé suffit).
  RESUME_IMPORTANTS_MAX: 10,              // « À traiter » : mails importants listés au maximum
  RESUME_MAX_LIGNES: 15000,               // ne lit que les N dernières lignes Index/Journal (le
                                          // Journal grossit vite : borne la lecture hebdo, large
                                          // marge devant une semaine d'un usage personnel)

  // Journal borné (ADR-0006) : le Journal grossit sans fin → illisible (incident 2026-07-01, débogage
  // gêné par une Sheet énorme + tronquée). Le Journal oscille entre `MAX` et `MAX + MARGE` lignes : la
  // rotation ne se déclenche qu'au-delà de `MAX + MARGE` (purge en lot, pas ligne-à-ligne à chaque tick)
  // et ramène à `MAX`. Le PLANCHER post-rotation (`MAX`) doit rester > `RESUME_MAX_LIGNES` pour que le
  // résumé hebdo lise toujours une fenêtre complète (20000 > 15000 ✔). Purge de LOG (rotation
  // d'historique), jamais de documents ni de l'Index (§2 intact).
  JOURNAL_MAX_LIGNES: 20000,
  JOURNAL_MARGE: 5000,
  JOURNAL_REPORTS_MAX: 20,                // la rotation du Journal peut être REPORTÉE quand le tick a
                                          // déjà consommé son garde-temps (le deleteRows en lot coûte
                                          // 10-30 s et tombe en fin de finally, cf. bornerJournal_).
                                          // Au-delà de N reports consécutifs, on rotationne QUAND MÊME :
                                          // un report silencieux et indéfini figerait la rotation.

  // Intervalle du déclencheur temporel (minutes). Valeurs Apps Script admises : 1, 5, 10, 15, 30.
  // Modifiable à chaud : au tick suivant un déploiement, le moteur réinstalle le déclencheur
  // au nouvel intervalle tout seul (cf. Main.assurerIntervalleTick_). Aucun re-installerTrigger manuel.
  TICK_MINUTES: 5,

  // Chien de garde (ADR-0004) : un 2ᵉ déclencheur léger et quasi-infaillible surveille le heartbeat
  // du tick principal (`DriveAI_LAST_TICK`). Si le moteur est silencieux depuis > `WATCHDOG_SEUIL_MS`,
  // il tente de RÉ-INSTALLER le déclencheur principal (auto-réparation) ; s'il ne peut pas (ou si la
  // panne persiste après réparation), il envoie UNE alerte. Le seuil dépasse largement l'intervalle du
  // tick (5 min) pour ne jamais alerter sur un simple retard/quota momentané. Valeurs everyMinutes : 30.
  WATCHDOG_MINUTES: 30,                  // intervalle du déclencheur chien de garde
  WATCHDOG_SEUIL_MS: 45 * 60 * 1000,     // moteur « silencieux » au-delà → auto-réparation puis alerte

  // Quarantaine : après ce nombre d'échecs CUMULÉS sur un même document (LLM ou placement) — le
  // compteur n'est pas remis à zéro, mais un doc qui réussit quitte le scan donc la distinction
  // avec « consécutifs » est sans effet — on cesse de le re-tenter à chaque tick (re-OCR/re-LLM =
  // coût + spam mail). Il est marqué « quarantaine » dans l'Index (donc sauté) + UNE seule alerte
  // mail. Les échecs intermédiaires ne journalisent qu'une ligne (pas de mail), anti-spam. Pour
  // re-tenter un doc quarantiné à tort (panne transitoire), lancer `dequarantaine()` (Maintenance.gs).
  QUARANTAINE_MAX: 3,
  // Dé-quarantaine AUTOMATIQUE one-shot (R3, 2026-07-07) : tant que le tag stocké
  // (`DriveAI_DEQUARANTAINE`) diffère, le tick relance UNE fois tous les quarantainés (les
  // 3 échecs datant d'une panne de compte sont des faux positifs — vécu : 32 fichiers de la
  // panne du 1ᵉʳ juillet sautés en silence pendant 6 jours). Le RÉTABLISSEMENT d'une panne
  // efface aussi la Property → re-déclenche tout seul après chaque panne. Bumper le tag rejoue.
  DEQUARANTAINE_TAG: 'q1',

  // Panne de COMPTE API persistée (R2, check-up 2026-07-06) : pendant une panne (crédit/clé), les
  // SOURCES du tick sont suspendues (Gmail/dépôts/partages/campagnes/tri) — sinon les scans
  // re-parcourent toute la fenêtre à chaque tick SANS rien marquer et brûlent le quota de lecture
  // Gmail quotidien (vécu : 4 j de panne crédit → quota Gmail épuisé, moteur re-bloqué 24 h de plus
  // APRÈS la recharge). Re-sonde automatique : au plus un run « normal » par fenêtre ci-dessous.
  LLM_PANNE_RESONDE_MS: 60 * 60 * 1000,
  // (Les pannes de CONFIGURATION d'API Google — Tasks/Calendar non activées, jeton hubperso — et
  // leurs sondes, C28-22/C28-48/ADR-0041, sont parties avec la création de tâches et de rendez-vous :
  // ADR-0074, 05/11/2026.)
  // Panne API DURABLE (C28-12, plan NotebookLM P5) : une panne plateforme d'une AUTRE signature
  // que crédit/clé (529 « overloaded » Anthropic prolongé, 429 persistant, 5xx) doit finir par
  // déclencher la MÊME suspension que la panne de compte — sinon chaque document brûle ses essais
  // sur une API saturée (fausses quarantaines + spam Journal, scénario du 2026-07-02 par une autre
  // porte). Seuil = nombre d'APPELS LLM consécutifs en échec 429/529/5xx (tous documents confondus,
  // persisté entre les ticks) avant de déclarer la panne. Un hoquet isolé (1-2 échecs) reste un
  // échec normal (retry/fallback existants) — « classer les échecs par ORIGINE avant de compter ».
  LLM_ECHECS_SYST_MAX: 3,

  // --- Gmail (intake des pièces jointes) & lots ---
  // Idempotence des PJ assurée par l'Index (clé messageId|i|nom|taille), PAS par un
  // label Gmail : ce flux ne modifie jamais les fils (le tri vit dans TriGmail.gs).
  GMAIL_REQUETE: 'has:attachment newer_than:30d',
  // --- Chantier #12 (ADR-0010 §1) : HISTORIQUE Gmail complet, ancre FIXE + offset ---
  // Le scan récent ci-dessus ne voit que 30 j. Ce scan-ci parcourt tout l'historique : une ancre
  // posée UNE fois (`before:<ancre>`, Property) fige l'ensemble de recherche → l'offset persistant
  // est sûr (leçon « pagination mouvante » : le mouvant est interdit, pas l'offset). L'ORDRE peut
  // toutefois bouger (fil ravivé, suppression) : la campagne ne se fige « terminé » qu'après une
  // passe de VÉRIFICATION propre (offset 0 → page vide sans rien collecter) — coût nul ensuite.
  GMAIL_REQUETE_HISTO_BASE: 'has:attachment',
  GMAIL_HISTO_PAGE_FILS: 10,              // fils par page de recherche
  // Plafond de PJ INÉDITES traitées par run : borne le PIC d'un run (mur des 6 min). « Inédite » =
  // clé absente de l'Index — un doublon MD5 compte donc (copyBlob + hash + placement `_Doublons` :
  // pas gratuit ; conservateur). Seules les PJ déjà INDEXÉES sont gratuites (métadonnées seules).
  GMAIL_HISTO_MAX_PJ_INEDITES: 2,
  // Budget QUOTIDIEN de la campagne (2ᵉ contre-vérification) : le plafond par run ne borne PAS la
  // journée — 288 ticks × 20-30 s = 96-144 min/j, soit PLUS que le quota runtime des déclencheurs
  // (~90 min/j, compte gratuit) : tous les déclencheurs (chien de garde inclus) seraient gelés
  // chaque après-midi de campagne. On compte les ms RÉELLEMENT consommées par jour (Properties).
  // Redescendu 60 → 20 min/j (C28-15, décision Marc « équilibre strict » 2026-07-10) : à 60 min/j
  // la campagne épuisait le quota d'APPELS Gmail journalier dès ~08h10 (804 erreurs « too many
  // times » le 06/07) et le TRI vivant était affamé toute la journée (4-17 fils triés/j). Le quota
  // d'appels est PARTAGÉ : la seule protection du tri est de borner la consommation TOTALE de la
  // campagne, pas seulement son runtime. La campagne finit plus lentement — c'est le prix accepté.
  // ⚠️ ARRÊTÉE le 21/09 (C49-20). Elle était TERMINÉE et le moteur le disait lui-même
  // (« ses 2 min/j sont RÉALLOUABLES »). Elle n'avait aucun interrupteur : seule la Property
  // `DriveAI_GMAIL_HISTO = terminé` l'arrêtait, donc un bump de campagne la relançait sans
  // qu'on puisse dire non. L'interrupteur est le geste qui manquait.
  GMAIL_HISTO_ACTIF: false,
  GMAIL_HISTO_PRETEES_MIN: 20,            // minutes DÉJÀ prêtées par ce donneur (ADR-0056, puis C28-135 :
                                          // 8 → 12, les 4 nouvelles vont à la Mémoire ; puis C49-3 :
                                          // 8 → 12, les 4 nouvelles vont à la Mémoire). La ligne de
                                          // santé les DIT, sinon la prochaine session lit « ses 12 min/j
                                          // sont RÉALLOUABLES » exactement comme celle-ci a lu « 20 » et
                                          // prête une seconde fois les mêmes minutes (🟡 revue sécurité).
                                          // ⚠️ C49-3 a ESSAYÉ de prendre ici et a reculé : à 0, 20 de ses
                                          // tests rougissent — un budget quotidien nul rend la campagne
                                          // MUETTE (`consommeJour 0 >= 0` court-circuite), et ces tests
                                          // encodent la conception inverse. Ce qui reste est un plancher
                                          // de fonctionnement, pas un solde à finir : la vider exige de
                                          // la DÉSACTIVER d'abord, ce qui est une décision, pas un geste.
  // ⚠️ 8 → 2 (C49-3, 17/09, demande de Marc « prends aussi sur l'historique Gmail ») : 6 min de
  // plus pour l'audit des pièces. MESURÉ avant d'écrire, comme la fois précédente : à 2 min la
  // campagne n'est PAS muette (aucun de ses vingt tests ne rougit) — c'est à ZÉRO qu'elle le
  // devient. 2 min est donc son plancher de fonctionnement, pas un reliquat arbitraire.
  GMAIL_HISTO_BUDGET_JOUR_MS: 0 * 60 * 1000, // 20 → 12 (ADR-0056) → 8 (C28-135) → 2 : min prêtées à la
                                          // re-analyse ciblée de `06`, puis 4 à la Mémoire. Donneur
                                          // choisi parce que le moteur ÉCRIT « Historique Gmail :
                                          // terminée ✅ — ses N min/j sont RÉALLOUABLES » : une campagne
                                          // finie rend ses minutes, et c'est SA ligne de santé qui le
                                          // dit, pas une supposition (re-LU le 16/09 avant de prélever).
  // Frein d'appels API par RUN (C28-15) : au plus N fils PARCOURUS par run (lus depuis Gmail,
  // indexés ou non) — les passes de VÉRIFICATION re-lisent des fils entiers « pour rien » côté
  // quota d'appels (les PJ indexées sont gratuites côté LLM, PAS côté Gmail). NB : une page fait
  // GMAIL_HISTO_PAGE_FILS (10) fils — ce frein ne borne donc que si la page grossit un jour ;
  // c'est le budget quotidien ci-dessus qui porte la protection principale.
  GMAIL_HISTO_MAX_FILS_PAR_RUN: 50,
  // Plafond QUOTIDIEN de fils lus par la campagne historique (C28-21, plan architecte) : le budget
  // en ms ci-dessus ne borne PAS un quota d'APPELS — la passe de VÉRIFICATION, « gratuite » côté
  // traitement (Index), lit des centaines de fils en 20 min et drainait le quota Gmail du compte
  // en continu (vécu 11-13/07 : re-mort en 8 s-6 min à chaque re-sonde, tri affamé toute la
  // journée). ~150 fils ≈ 2 % du quota : le flux vivant garde l'essentiel, la campagne s'étire de
  // quelques jours — prix accepté. Compté dans SON unité (fils), persisté par jour.
  GMAIL_HISTO_MAX_FILS_JOUR: 150,
  // Suspension PERSISTÉE sur quota Gmail épuisé (C28-15, patron panne de compte LLM R2) : quand
  // Google répond « Service invoked too many times for one day: gmail. », TOUS les scans Gmail
  // sont suspendus (Property DriveAI_GMAIL_QUOTA) puis re-sondés après ce délai — sans elle,
  // chaque tick re-brûlait des appels en pure perte (267 lignes d'erreur le matin du 10/07).
  GMAIL_QUOTA_RESONDE_MS: 2 * 60 * 60 * 1000,
  PAGE_FILS: 20,                         // taille de page de la recherche Gmail
  BUDGET_MS: 4.5 * 60 * 1000,            // garde-temps (exécution Apps Script < 6 min)
  // Sous ANALYSE_V2 (Sonnet ×2/doc, 12000 car., retries possibles), un document est BEAUCOUP plus
  // long ; le garde-temps est abaissé pour qu'un doc pire-cas démarré juste sous le budget finisse
  // LOIN du mur dur des 6 min (ADR-0015) — la fenêtre placer→Index reste éloignée du kill (anti 2ᵉ
  // copie au rejeu). Le reste est repris au tick suivant. Inerte tant que ANALYSE_V2 est false.
  ANALYSE_V2_BUDGET_MS: 3 * 60 * 1000,

  // --- Fenêtre des mails récents (ex-analyse d'importance, retirée le 06/11/2026, ADR-0075 6b : c'est le tri qui
  // décide « à traiter ») : `GMAIL_REQUETE_ACTIONS` ne sert plus qu'à dériver la fenêtre (`joursFenetreIntentions_`,
  // porte `ancien` du tri) ; `PAGE_FILS_ACTIONS` n'a plus de lecteur dans le moteur.
  GMAIL_REQUETE_ACTIONS: 'newer_than:30d',
  PAGE_FILS_ACTIONS: 20,                  // taille de page de cette recherche

  // --- Chantier #16 (ADR-0012) : tri Gmail natif (libellés + archivage réversible) ---
  // Périmètre du tri : la BOÎTE seulement (revue flotte : sans in:inbox, le stock paierait des
  // mini-appels pour des fils DÉJÀ archivés par Marc/l'ancien Cowork — hors objectif « boîte propre »).
  TRI_REQUETE: 'newer_than:30d in:inbox',
  TRI_MAX_FILS_PAR_RUN: 30,               // écritures Gmail bornées par run (quotas)
  TRI_CYCLIQUE_PAGES_PAR_RUN: 1,          // C28-19 : pages du scan CYCLIQUE par tick — borne les
                                          // LECTURES Gmail dans leur unité (leçon quota partagé) ;
                                          // 1 page de 20 fils/tick ⇒ tour de la fenêtre 30 j ≈ 30-60 min
  // ADR-0076 (étape 7 de l'ADR-0074) : UN SEUL plafond QUOTIDIEN de fils LUS par les campagnes de FOND du tri
  // (cyclique 30 j, nettoyage profond de la boîte, historique archivé) = 150 + 150 d'hier (C28-21, C28-22),
  // enveloppe inchangée. Sans plafond : 1 page × 288 ticks ≈ 5 760 lectures/j sur le quota PARTAGÉ. Chaque
  // campagne garde SON compteur (Télémétrie), le reliquat est COMMUN, servi dans l'ordre du tick. Le scan AVANT
  // (courrier neuf) reste hors plafond ; l'intake des PJ passe AVANT le tri dans le tick et garde le quota.
  TRI_FOND_MAX_FILS_JOUR: 300,
  // Réserve du VIVANT (revue de flotte, leçon C28-21 « un quota partagé se répartit par PRIORITÉ ») : les
  // campagnes NON vivantes (nettoyage profond, historique) ne consomment ensemble que MAX − RÉSERVE fils/j ; le
  // cyclique (fenêtre de 30 j) garde donc au moins RÉSERVE fils/j, et tout ce que les autres n'ont pas pris.
  TRI_FOND_RESERVE_VIVANT: 150,
  // Historique ARCHIVÉ sans libellé (ADR-0076) : tout ce que ni la boîte ni le scan arrière n'ont jamais vu. Un
  // fil étiqueté quitte le résultat (file mouvante) ; jamais de ⏰ hors fenêtre, jamais d'archivage.
  TRI_HISTO_REQUETE: 'has:nouserlabels -in:inbox -in:sent -in:drafts -in:chats',
  // Balayage quotidien borné des fils LUS âgés > 29 j encore en boîte (chevauchement 1 j avec TRI_REQUETE ;
  // `-is:unread` garantit que tous les messages du fil sont lus ; compte dans `TRI_FOND_MAX_FILS_JOUR`).
  TRI_ANCIENS_REQUETE: 'in:inbox -is:unread older_than:29d',
  TRI_MAX_ATTENTES: 20,                   // fils « en attente » (panne LLM transitoire) chargés par run (borne
                                          // la re-facture de lecture — revue flotte, classe R2)
  // (Le NETTOYAGE PROFOND, C28-22 / ADR-0022, `in:inbox before:<ancre−29 j>`, compte dans TRI_FOND_MAX_FILS_JOUR
  // depuis l'ADR-0076. Pas de budget ms dédié : ni OCR ni hash — la borne en FILS + le garde-temps partagé + le
  // frein campagnes §2.6 suffisent.)
  TRI_REGLES_VERSION: 'r3',               // ADR-0050 (2026-09-09) : VERSION des règles du tri, dans la clé
                                          // d'idempotence `tri|fil|ts|lu|<v>` ET dans le ré-armement du
                                          // nettoyage profond (`DriveAI_TRI_BOITE_VERSION`) et de l'historique
                                          // archivé (`DriveAI_TRI_HISTO_VERSION`, ADR-0076). r1 = implicite
                                          // (⏰ / « À vérifier » jamais archivés) ; r2 = « un fil LU sort de
                                          // la boîte » ; r3 (ADR-0075 6b, 2026-11-06) = le tri lit le sujet ET
                                          // le corps et décide « à traiter » lui-même. Bumper = chaque fil de la fenêtre est réévalué UNE
                                          // fois (leçon §9 « verdict keyé sous version ») — tout changement
                                          // de RÈGLE d'archivage sans bump ne toucherait aucun fil déjà trié.
  LLM_MAX_TOKENS_MINICAT: 96,             // mini-appel catégorie : JSON {categorie, suspect} — marge pour le plus long libellé + clôture markdown
  // ADR-0075 (étape 6 de l'ADR-0074) : le tri lit le SUJET ET LE CORPS et décide « à traiter » lui-même, en UN appel.
  // Allumé en 6b (2026-11-06, verdict de l'audit sur fils réels lu sur DriveAI#890) : le drapeau `TRI_SUJET_CORPS`
  // et l'analyse d'importance séparée (`Intentions.gs`, étape `intentions`) sont retirés ; `TRI_REGLES_VERSION` = r3.
  LLM_MAX_TOKENS_TRI: 300,                // JSON {categorie, suspect, aTraiter} — relevé de 120 à 300 : claude-haiku-5-5 tronquait la réponse
  // ADR-0081 (vague 2) : escalade vers le modèle complexe (LLM_MODELE_FALLBACK) en cas de doute sur la catégorie.
  TRI_ESCALADE_ACTIF: true,               // active l'escalade Sonnet quand catégorie = null (hors suspect, coupée au frein)
  TRI_ESCALADE_MAX_PAR_RUN: 5,            // borne temps et coût des escalades tri par tick
  // ADR-0081 (vague 2b) : résumé court (1 ligne) des mails à traiter et brouillons de réponse (jamais envoyés).
  TRI_RESUME_MAX_CARS: 140,               // longueur max du résumé dérivé enregistré avec `important|` (ADR-0007)
  TRI_BROUILLON_ACTIF: true,              // prépare un brouillon Gmail (createDraftReply, jamais d'envoi) si réponse attendue
  TRI_BROUILLON_MAX_PAR_RUN: 3,           // borne temps, coût LLM et quota Gmail des brouillons par tick
  LLM_MAX_TOKENS_BROUILLON: 350,          // plafond de sortie d'un brouillon de réponse court
  // ADR-0081 (vague 1) : la fiche du propriétaire apprend ses habitudes (lu, répondu, étoilé) fil après fil.
  FICHE_MAX_FILS: 60,                     // fils lus par run (lecture seule, borne le coût Gmail du tick)
  FICHE_FENETRE_JOURS: 3,                 // premier passage : on apprend les 3 derniers jours, ensuite le curseur fait foi
  TRI_AUDIT_FILS: 20,                     // fils réels lus par l'audit manuel (≈ 2 appels chacun, aucune écriture)
  TRI_AUDIT_REQUETE: 'newer_than:30d',    // l'audit lit boîte ET archivés : les relevés/promos déjà triés sont
                                          // ceux du critère « zéro ⏰ nouveau » (l'audit n'écrit rien, le coût
                                          // des fils archivés — raison du `in:inbox` de TRI_REQUETE — ne joue pas)
  // Noms EXACTS des libellés spéciaux existants dans le Gmail de Marc (vérifiés le 2026-07-06).
  TRI_LIBELLES: { A_VERIFIER: 'À vérifier', SUSPECT: '⚠️ Suspect', A_TRAITER: '⏰ À traiter' },
  // Heuristiques phishing DÉTERMINISTES, étroites (le signal LLM complète). Deux niveaux
  // (revue flotte, ronde 2) : une PJ EXÉCUTABLE est suspecte SEULE (aucun envoi légitime attendu) ;
  // une PJ DOUTEUSE (.zip d'un photographe, facture .html) ne l'est que COMBINÉE à un signal
  // d'urgence ou de demande d'identifiants — sinon les vrais mails satureraient ⚠️ Suspect.
  TRI_PJ_EXECUTABLES: ['.exe', '.scr'],
  TRI_PJ_DOUTEUSES: ['.zip', '.html', '.htm'],
  // Adresse de MARC : un fil dont le DERNIER message vient de lui n'apprend jamais dans TriAppris
  // (anti auto-empoisonnement : ses propres réponses ne « votent » pas pour une catégorie).
  // Valeur FICTIVE : l'adresse réelle vient du profil privé (docs/PROFIL-PRIVE.md).
  PROPRIETAIRE_EMAIL: 'proprietaire@exemple.com',
  TRI_MOTS_URGENCE: ['urgent', 'immédiat', 'dernier rappel', 'compte suspendu', 'sera suspendu'],
  TRI_MOTS_CREDENTIELS: ['mot de passe', 'password', 'identifiant', 'vérifiez votre compte',
    'confirmez votre identité', 'coordonnées bancaires', 'carte de crédit'],
  RESUME_SUSPECTS_MAX: 10,                // « ⚠️ Suspects » listés au résumé hebdo (en tête)
  RESUME_NEWSLETTERS_MAX: 10,             // « newsletters jamais ouvertes » listées au résumé
  TRI_NEWSLETTERS_SEUIL: 3,               // n fils promo non lus (30 j) pour qualifier un expéditeur
  // Pré-filtre déterministe (avant tout appel LLM) : un expéditeur/sujet qui matche l'un de ces
  // motifs (recherche insensible à la casse) est écarté sans coût — newsletters/notifs/pubs.
  // Liste ÉTROITE et à haute confiance (faux positif = action manquée) ; le mini-check LLM
  // rattrape les cas moins évidents. Cf. LESSONS « garde-fou étroit, calibré sur du réel ».
  PREFILTRE_MOTIFS_REJET: [
    'no-reply', 'noreply', 'donotreply', 'ne-pas-repondre',
    'newsletter', 'unsubscribe', 'desabonner', 'désabonner',
    'notifications@', 'notification@'
  ],
  LLM_CORPS_MAX_CARS: 3000,               // troncature du corps de mail envoyé au LLM (coût)
  // Défense en profondeur (garde-fou §1, indépendante du jugement du LLM) : si l'expéditeur,
  // le sujet OU le corps touche un de ces mots-clés, le mail n'est JAMAIS mis en avant (⏰, « À
  // traiter »), quoi que renvoie le LLM, et le tri le traite en zone protégée (`toucheZoneProtegee_`,
  // lue aussi par Router.gs, Pipeline.gs et Maintenance.gs). Le mail reste géré par le classement
  // documentaire existant.
  // Motifs ≤ 4 caractères (arc, csq, cra...) sont reconnus en MOT ENTIER seulement
  // (cf. Prefiltre.correspondMotif_) — jamais en sous-chaîne libre (« arc » dans « Marc »).
  MOTS_CLES_PROTEGES_INTENTIONS: [
    'ircc', 'csq', 'visa', 'passeport', 'arc', 'cra',
    'résidence permanente', 'residence permanente', 'permis de travail', 'permis de séjour',
    'permis de sejour', "statut d'immigration", 'statut immigration',
    'impôt', 'impot', 'déclaration de revenus', 'declaration de revenus',
    'avis de cotisation', 'revenu québec', 'revenu quebec', 'agence du revenu'
  ],
  OCR_TAILLE_MAX: 20 * 1024 * 1024,      // au-delà : pas d'OCR (mémoire) → métadonnées seules

  // --- Chantier #7 : fichiers PARTAGÉS avec Marc (source d'intake #3, ADR-0005) ---
  // Traitement automatique des partages RÉCENTS (fenêtre glissante, comme Gmail). Un fichier partagé
  // n'appartient pas à Marc → DriveAI en fait une COPIE dans son arbo (l'original reste chez la personne).
  // Aucun nouveau scope OAuth : `drive` couvre déjà la lecture des fichiers partagés.
  PARTAGES_ACTIF: true,                   // interrupteur de la source (coupe la collecte sans retirer le code)
  PARTAGES_FENETRE_JOURS: 30,             // fenêtre de récence (comme Gmail) — borne naturellement le scan
  PARTAGES_MAX_PAR_RUN: 15,               // plafond de fichiers COPIÉS par run (pas de rafale ; storage-aware)
  PARTAGES_PAGE: 100,                     // taille de page REST files.list
  // Garde de TAILLE propre aux partages : contrairement aux PJ Gmail (plafonnées ~25 Mo), un fichier
  // partagé n'a aucune borne. Au-delà de ce seuil on ne COPIE pas (téléchargement complet coûteux, storage) :
  // on saute avec une ligne Journal (visibilité, jamais un silence). Large devant un vrai document.
  PARTAGES_TAILLE_MAX: 50 * 1024 * 1024,  // 50 Mo

  // ALLOWLIST stricte de types « document » (anti-bruit + anti-storage, ADR-0005 §Garde-fous) : PDF + Office.
  // Les images (`image/*`) sont acceptées à part (scans). Tout le reste — vidéo, audio, Google natif
  // collaboratif (Docs/Sheets/Slides), archives — est IGNORÉ (jamais copié).
  PARTAGES_MIME_DOC: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // .docx
    'application/msword',                                                         // .doc
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',          // .xlsx
    'application/vnd.ms-excel',                                                   // .xls
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',  // .pptx
    'application/vnd.ms-powerpoint',                                              // .ppt
    'application/vnd.oasis.opendocument.text',                                    // .odt
    'application/vnd.oasis.opendocument.spreadsheet',                             // .ods
    'application/vnd.oasis.opendocument.presentation'                             // .odp
  ],
  STORAGE_SEUIL: 0.95,                    // ≥ 95 % du quota (compte gratuit = 15 Go) → on cesse de COPIER
                                          // (jamais de suppression) + alerte unique ; reprise auto quand ça baisse

  // --- Dossiers (IDs : docs/TAXONOMY.md) ---
  DOSSIERS: {
    A_TRIER: 'FICTIF_DOSSIERS_A_TRIER',
    A_VERIFIER: 'FICTIF_DOSSIERS_A_VERIFIER'
  },

  // Version du schéma de profil effectivement chargée (0 = valeurs fictives, aucun profil). Voir PROFIL_VERSION_ATTENDUE.
  PROFIL_VERSION: 0,

  DOMAINES: {
    '01 · Administratif & identité': 'FICTIF_DOMAINES_01_ADMINISTRATIF_IDENTITE',
    '02 · Finances': 'FICTIF_DOMAINES_02_FINANCES',
    '03 · Logement & véhicule': 'FICTIF_DOMAINES_03_LOGEMENT_VEHICULE',
    '04 · Immigration': 'FICTIF_DOMAINES_04_IMMIGRATION',
    '05 · Carrière': 'FICTIF_DOMAINES_05_CARRIERE',
    '06 · Études & diplômes': 'FICTIF_DOMAINES_06_ETUDES_DIPLOMES',
    // Perso renuméroté 07 → 08 (ADR-0002 : 07 est désormais « Santé »). MÊME dossier (ID inchangé) ;
    // `assurerNomsDomaines_` renomme le dossier physique pour coller à cette clé (zéro clic, réversible).
    '08 · Perso & projets': 'FICTIF_DOMAINES_08_PERSO_PROJETS'
  },

  // Synchronisation des NOMS de dossiers de domaine avec les clés de DOMAINES ci-dessus (self-healing).
  // Bumper ce tag rejoue le renommage (ex. après un renumérotage). Gated par une Script Property → ~1 fois.
  NOMS_DOMAINES_TAG: 's1',                // s1 : renumérote « 07 · Perso » → « 08 · Perso » (07 = Santé)

  // Garde anti-variantes (ADR-0002 §4) : score de similarité minimal (0..1) au-delà duquel une nouvelle
  // entité proposée est signalée comme VARIANTE possible d'une entité existante (« Bellerives » vs « Caisse
  // Bellerives »), pour fusion en 1 clic par Marc. Suggestion seulement — jamais de fusion automatique.
  SEUIL_VARIANTE: 0.6,

  // Curation one-shot de la file d'entités (#10, ADR-0009) : tant que le tag stocké
  // (`DriveAI_CURATION_ENTITES`) diffère, chaque tick passe la file `en_attente` au filtre
  // anti-génériques + au regroupement de variantes (statuts seulement — AUCUN document touché,
  // 100 % réversible en rééditant le Statut). Bumper le tag rejoue une curation complète.
  CURATION_ENTITES_TAG: 'c2',            // c2 (P4/C28-10) : rejoue la curation avec la passe 1.5
                                          // (canonicalisation rétroactive) sur la file actuelle de Marc

  // Boucle d'apprentissage (ADR-0003 §3) : à chaque classement, on injecte dans le prompt les
  // corrections passées les PLUS PROCHES (même émetteur) comme exemples few-shot. Borné pour le coût
  // (< 10 $/mois) : au plus FEWSHOT_MAX exemples, et seulement au-dessus de FEWSHOT_SEUIL de pertinence
  // (proportion des jetons d'émetteur retrouvés dans le doc) — pas de bruit sur des émetteurs sans rapport.
  FEWSHOT_MAX: 3,
  FEWSHOT_SEUIL: 0.6,

  // Canal de correction (ADR-0003 §1, chantier #6) : nombre max de corrections APPLIQUÉES (écrites) par
  // run (le reste est repris au tick suivant — anti-rafale, borné comme les autres lots ; les réponses
  // en double/invalides ne comptent pas et sont bornées par le garde-temps). Usage perso : largement
  // suffisant, Marc soumet quelques corrections à la fois.
  CORRECTIONS_MAX_PAR_RUN: 20,

  // Sous-dossiers de catégorie connus (Phase 1 : seuls ceux de 03).
  CATEGORIES: {
    '03 · Logement & véhicule': {
      'Logement': 'FICTIF_CATEGORIES_03_LOGEMENT_VEHICULE_LOGEMENT',
      'Véhicule': 'FICTIF_CATEGORIES_03_LOGEMENT_VEHICULE_VEHICULE'
    }
  },

  // Domaines à fort volume → sous-dossier par année (AAAA) créé au besoin.
  DOMAINES_PAR_ANNEE: ['02 · Finances'],

  // Zone protégée : domaines jamais rangés auto (garde-fou non négociable).
  DOMAINES_PROTEGES: ['04 · Immigration'],

  // C49-16 — RETROUVER le `fileId` des lignes d'Index qui n'en portent pas.
  // ⚠️ POURQUOI ce tag existe : la clé d'une pièce jointe Gmail est
  // `<messageId>|<rang>|<nom>|<taille>` — elle ne contient AUCUN identifiant Drive, alors que
  // les quatre autres préfixes (`drive|`, `tri33p|`, `migre|`, `reanalyse|`) finissent par le
  // leur. Tout ce qui DÉSIGNE un document par son fileId (réconciliation, doublons, fusions ;
  // hier aussi le canal Mémoire, retiré par l'ADR-0074) était donc aveugle à ces lignes :
  // 734 documents CLASSÉS mesurés le 17/09/2026.
  // ⚠️ Bumper ce tag REFAIT la résolution, y compris pour les lignes déjà REFUSÉES (elles
  // portent `!<motif>|<tag>` dans la colonne) : c'est un verdict NÉGATIF, donc révisable par
  // version, exactement comme le refus de routage de C28-33. Un fileId déjà TROUVÉ, lui, n'est
  // jamais retouché — c'est un fait, pas une règle.
  // ⚠️ AUCUN `*_BUDGET_JOUR_MS` : passe ONE-SHOT (~734 recherches Drive, quelques minutes UNE
  // fois), pas une campagne. Lui prélever une minute par
  // jour à une voisine coûterait plus cher que ce qu'elle consomme, et l'enveloppe est verrouillée
  // à la minute près par `test/orchestration.test.js`.
  RESOLUTION_FILEID_TAG: 'c49-16-a',
  // ⚠️ SOUS-BUDGET PAR RUN — ajouté après revue. Sans plafond propre, elle recevait
  // `estBudgetDepasse` (3 min de budget de TICK) et pouvait consommer tout le reliquat, affamant
  // les étapes placées après elle. Ses voisines ont toutes le leur : doublons 90 s, missions 90 s.
  // ⚠️ Ce n'est PAS un budget QUOTIDIEN : la passe reste one-shot (~20 runs au total), donc elle
  // ne prélève aucune minute à l'enveloppe des campagnes (`test/orchestration.test.js`).
  RESOLUTION_FILEID_BUDGET_MS: 60 * 1000,
  // Plafond d'items par run. Il ne borne PAS la journée (le tag et l'extinction s'en chargent) :
  // il borne le pire cas d'UN run, et le sous-budget ci-dessus coupe avant lui en pratique.
  RESOLUTION_FILEID_MAX_PAR_RUN: 40,
  // Espacement de la re-sonde après une panne. Une heure : assez pour qu'un throttle Drive
  // passe, assez court pour qu'une panne guérie ne coûte pas une journée de campagne.
  RESOLUTION_FILEID_RESONDE_MS: 60 * 60 * 1000,

  // Domaine par défaut (catch-all) quand le LLM ne rend pas un domaine valide. Décision Marc
  // 2026-07-01 : plus de file de revue — un document non classable est rangé AU MIEUX ici (avec
  // son nom final propre), jamais laissé en limbo. « Administratif » = bucket générique le plus sûr.
  DOMAINE_DEFAUT: '01 · Administratif & identité',
  // ADR-0058 — domicile UNIQUE des revenus d'employeur (paies, RL-1). Constante et non littéral :
  // le libellé sert de CLÉ dans `CONFIG.DOMAINES` et `STRUCTURE_CIBLE_RESET`, donc une graphie qui
  // dérive d'un point d'usage à l'autre ne rend pas une erreur — elle rend `undefined`, c'est-à-dire
  // une cible vide (§9, « CONFIG.DOMAINES ne contient que les domaines FIXES »).
  DOMAINE_REVENUS: '02 · Finances',

  // Domaines AUTO-créés (ADR-0002 §3) : nouveaux domaines sans ID en dur — le dossier est trouvé/créé
  // par le code À CÔTÉ des domaines existants (find-or-create, cf. Router.dossierDomaineAuto_), zéro clic.
  // Ils sont autorisés dans le prompt LLM (domainesAutorises_) et routés comme les 7 domaines fixes.
  // 09 · Voyages ajouté (refonte 2026-07-07, demande Marc) : vols, trains, hôtels, réservations,
  // locations de voyage — le domaine manquant qui éparpillait les billets dans Administratif/Perso.
  DOMAINES_AUTO: ['07 · Santé', '09 · Voyages'],

  // Fichiers TECHNIQUES (ADR-0002 §3, `_Technique` hors domaines) : code, CAO — écartés du classement
  // documentaire (ni OCR ni LLM : ce ne sont pas des documents à classer par domaine). Rangés dans
  // `_Technique` (find-or-create à côté de `_Doublons`) pour ne pas polluer les domaines. Détection par
  // EXTENSION uniquement (jamais PDF/Office/images/CSV, qui peuvent être de vrais documents).
  EXT_TECHNIQUES: [
    '.java', '.class', '.jar', '.py', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php',
    '.sh', '.sql', '.m', '.ino', '.v', '.vhd',                         // code
    '.step', '.stp', '.stl', '.igs', '.iges', '.dwg', '.dxf', '.obj', '.fbx', '.blend', '.sldprt', '.ipt' // CAO
  ],

  // --- Chantier #11 : MÉDIAS BRUTS (ADR-0009 §2, `_Médias` hors domaines) ---
  // Un média personnel manifeste est écarté SANS LLM : vidéo/audio/gif TOUJOURS (jamais un document) ;
  // photo SEULEMENT si nom non-documentaire (export Facebook, IMG_…) ET OCR vide — l'OCR reste le juge :
  // un scan de passeport nommé IMG_2734.jpg contient du texte → il garde son analyse complète (§1).
  EXT_MEDIAS_DIRECT: [
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.wmv',   // vidéo
    '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',                    // audio
    '.gif'                                                              // animation (jamais un scan)
  ],
  EXT_PHOTOS: ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff'],
  MEDIAS_OCR_MAX_CARS: 20,               // extrait OCR sous ce seuil = « photo sans texte »
  // Exports de compte (Facebook/Instagram…) : un gros HTML/JSON de navigation, jamais un document
  // (refonte 2026-07-07). Au-delà de ce poids ET sans émetteur identifié, un .html/.htm est traité
  // comme un export → _Technique (une facture .html légitime porte un émetteur et reste plus petite).
  EXPORT_TAILLE_MIN: 40000,
  // Incident « Boreale » (2026-07-06) : photo de plat classée « Reçu de dépôt_Boreale » — l'OCR avait
  // lu les étiquettes de bouteilles (> 20 cars) et le LLM a inventé un document. Le seuil OCR reste
  // BAS (un passeport mal photographié doit atteindre le juge, §1) ; c'est la CONFIANCE du verdict
  // qui tranche : une PHOTO au nom NON documentaire classée sous ce seuil n'est JAMAIS « classée au
  // mieux » → _Médias (réversible, nom conservé). Exception : zone protégée/sensible — jamais
  // rétrogradée en média (un passeport à 0,6 reste classé dans son domaine).
  MEDIAS_CONFIANCE_MIN: 0.7,

  // --- Auto-validation des entités fréquentes (#18, décision Marc : seuil 3) ---
  ENTITES_AUTO_SEUIL: 3,                  // vue ≥ N fois → auto-validée (dossier créé au même tick)
  ENTITES_AUTO_MAX_PAR_RUN: 5,            // bornée par run (le reste au tick suivant)

  // --- Réorg IA (#21, C21-04) : proposition de réorganisation des DOSSIERS ---
  REORG_DOSSIERS_MAX: 250,                // inventaire borné en largeur (BFS) : au-delà, limité aux 250 premiers dossiers (niveaux supérieurs)
  REORG_EXEMPLES_PAR_DOSSIER: 3,          // noms de fichiers donnés en exemple au LLM (métadonnées seules)
  REORG_ACTIONS_MAX: 40,                  // un plan reste digeste — au-delà, tronqué
  REORG_ESSAIS_MAX: 3,                    // tentatives par demande (inventaire/LLM) avant « échec »
  REORG_MAX_JOUR: 5,                      // plafond quotidien d'appels LLM de réorg (borne une app boguée qui re-demanderait en boucle)
  REORG_FUSION_LOT: 40,                   // éléments déplacés par run lors d'une FUSION (reprenable — garde-temps partagé)
  // Lignes `vide-candidat` re-filtrées par run par la passe one-shot C28-93 (écritures Sheet
  // seules, aucun appel Drive). 200 couvre d'un coup le stock connu (124 lignes au 13/09) ; le
  // reliquat éventuel est repris au tick suivant, le tag ne se posant qu'à passe complète.
  REORG_VIDES_FILTRE_LOT: 200,
  ROUTAGE_PROFONDEUR_MAX: 8,              // ADR-0028 : niveaux max remontés pour vérifier qu'un dossier d'entité est bien SOUS son domaine (anti-cycle multi-parents) — au-delà, repli par nom
  REORG_MAX_SOUS_DOSSIERS_IDEAL: 7,       // loi de Miller (ADR-0027) : au-delà, un dossier devient illisible. CIBLE affichée au LLM, jamais un blocage du flux vivant
  REORG_MAX_SOUS_DOSSIERS_TOLERANCE: 9,   // 7 ± 2 : seuil à partir duquel la Réorg PROPOSE un regroupement thématique (on n'embête pas Marc pour un 8e dossier). Sont exclus du décompte TOUS les segments STRUCTURELS — années « AAAA », schémas d'entité, types de pièce d'identité (estSegmentStructurel_) — et les racines système (ADR-0027)
  LLM_MAX_TOKENS_REORG: 4000,             // 40 actions pretty-printées + synthèse SANS troncature (analyse ≈ 0,02 $, à la demande seulement)

  // --- Phase 2 : référentiel d'entités ---
  // Dossier d'entrée scanné pour le dépôt manuel (réutilise A_TRIER ci-dessus).
  INTAKE_SCAN_MAX: 400,                   // fichiers PARCOURUS par run pour composer la page (mur de skips borné)
  INTAKE_PAGE: 150,                       // nb de fichiers de 00·À trier traités par run (50→150 pour le
                                          // rangement de masse : chaque tick utilise tout son budget-temps
                                          // au lieu de s'arrêter à 50 — le garde-temps reste la vraie borne)
  REDEPOT_VERIF_MAX_RUN: 10,              // lectures de ligne d'Index au plus par run pour juger un résident de 00·À trier (ADR-0071) ; au-delà : au tick suivant
  REDEPOT_MEMO_MAX: 300,                  // résidents déjà jugés mémorisés (Script Property) pour ne plus les relire
  REJEU_PAGE: 100,                        // nb de dépôts renvoyés par run lors d'un auto-rejeu
  RANGEMENT_MAX_PAR_RUN: 60,              // grand rangement : nb de fichiers renvoyés vers 00·À trier par run
                                          // (200→60 : la boucle de déplacement fait la re-vérif §1 stricte
                                          // par fichier ; bornée à 60, elle laisse ~3 min de budget/tick à
                                          // l'INTAKE — sinon le rangement affame le classement, cf. P1-19)
  RANGEMENT_SEUIL_FILE: 40,               // ne collecte de NOUVEAUX fichiers que si 00·À trier en a moins
                                          // (drainer avant d'alimenter, sans affamer ni déborder la file)
  RANGEMENT_RECENS_ESSAIS_MAX: 3,         // barre de progression : nb de recensements incomplets tolérés
                                          // avant d'accepter un compte PARTIEL comme base (anti-blocage
                                          // sur un Drive énorme — la re-base/finalisation corrigent l'écart)

  // ---- Campagne de CONSOLIDATION de l'arborescence (C28-26, ADR-0023 — Consolidation.gs) ----
  CONSOLIDATION_ACTIF: false,           // ARRÊTÉE le 21/09 (C49-20, décision de Marc). Ses 16 min/j
                                          // vont à la lecture des papiers.
                                          // ⚠️ Ce qui suit décrit ce qu'elle FAIT UNE FOIS RALLUMÉE — allumée
                                          // le 2026-07-17 (« continue », post-correctifs revue flotte #183),
                                          // éteinte le 21/09 : interrupteur du DRY-RUN (génération du plan
                                          // SEULE), le moteur remplit l'onglet PlanConsolidation (~12 min/j
                                          // max, AUCUNE mutation Drive). Repasser à true pour la reprendre —
                                          // et lui rendre son budget, revenu à la marge depuis l'ADR-0074.
  CONSOLIDATION_TAG: 'conso-4',           // tag de campagne (clé de convergence `conso|<tag>|<fileId>`).
                                          // conso-3 → conso-4 (2026-09-13, C28-90, demande de Marc
                                          // « lance le rattrapage ») : les 683 fichiers à plat aux
                                          // racines de domaine portent une clé de SUCCÈS conso-3
                                          // posée avec « OK — racine du domaine », donc ADR-0052 ne
                                          // les aurait JAMAIS revus. Le bump les ré-évalue sous les
                                          // règles courantes : 347 d'entre eux ont désormais une
                                          // cible. TROIS gardes rendent ce bump sûr, toutes posées
                                          // dans ce chantier et prouvées par mutation :
                                          //  · D8 — une cible issue du seul TYPE ne déplace jamais
                                          //    un fichier déjà rangé dans un sous-dossier ;
                                          //  · D9 — on ne REMONTE jamais un fichier vers un de ses
                                          //    ancêtres (mesuré : sans elle, les 6 thèmes de
                                          //    d'un logement et les 4 buckets d'émetteur
                                          //    du 12/09 remontaient d'un cran) ;
                                          //  · une école DÉDUITE d'une fenêtre de scolarité est un
                                          //    signal FAIBLE, au même titre que le repli par type.
                                          // Et le conflit de structure de `06` a été tranché par
                                          // Marc AVANT le bump (ADR-0052 §9) : la mission qui vidait
                                          // ses dossiers d'école a été INVERSÉE, elle les remplit.
                                          // conso-1 → conso-2 (revue flotte 2026-07-21) : le plan conso-1
                                          // a pu se générer AVANT le seed des entités (cibles pré-seed :
                                          // dossiers de banque, noms périmés) — le bump purge et re-génère
                                          // conso-2 → conso-3 (2026-08-05, incident rangement bloqué) : le
                                          // plan conso-2 a été généré AVANT/pendant le deadlock reset — il a
                                          // pu recenser les 305 fichiers legacy comme « OK » (sous une table
                                          // antérieure à t4) ou dans des domaines déjà « épuisés » ⇒ jamais
                                          // re-déplacés. Le bump purge le plan périmé + remet les curseurs et
                                          // RE-ÉVALUE TOUT sous t4 ⇒ les 305 flat-mais-routables deviennent
                                          // des lignes « Déplacer » (cible `cheminCibleReset_`, exécutées
                                          // automatiquement, `moveTo` seul, §2 intact). Voir ADR-0035.
                                          // tout avec le référentiel courant (rotation dans genererPlan…)
  CONSOLIDATION_BUDGET_MS: 3 * 60 * 1000, // sous-budget PROPRE par run (le hash MD5 lit les octets — sans
                                          // cette borne, un run mangerait le budget des étapes suivantes)
  CONSOLIDATION_BUDGET_JOUR_MS: 0 * 60 * 1000, // budget QUOTIDIEN en ms RÉELLES persistées (leçon §7 :
                                          // ⚡ 10 → 16 (RÉALLOCATION C28-99, demande Marc « jveux utiliser le temps
                                          // dispo au max »). MESURÉ avant de bouger quoi que ce soit : la génération
                                          // consomme ses 10 min/j EN ENTIER sans finir un seul domaine (1/9 depuis
                                          // 18 h), et c'est ELLE qui alimente tout le reste — l'exécuteur a drainé
                                          // ses 372 lignes et affiche « attend la génération », donc ses 12 min
                                          // dorment. Les 6 min viennent de LÀ (4) et des doublons TERMINÉS (2) :
                                          // enveloppe reset-OFF INCHANGÉE (63 min/j à l'époque, 12 depuis l'ADR-0074), pur transfert. RÉALLOUER,
                                          // JAMAIS AUGMENTER (§9 / C28-29 : au-delà du mur runtime, TOUS les
                                          // déclencheurs gèlent, chien de garde compris).
                                          // un plafond par RUN ne borne pas la JOURNÉE — ×288 ticks > quota
                                          // runtime ~90 min/j ; patron GMAIL_HISTO/SYNC_BUDGET_JOUR_MS).
                                          // 20 → 12 min (REDESCENTE, revue quota C28-29) ; puis 12 → 2 min
                                          // (RÉALLOCATION C28-49, ADR-0039) : la génération est TERMINÉE
                                          // (9/9 domaines le 16/08) — ses 10 min partent aux MISSIONS de
                                          // curation (MISSIONS_BUDGET_JOUR_MS).
                                          // ⚠️ Ce COUPLE n'est plus verrouillé comme tel (C28-99) : le verrou
                                          // porte désormais sur l'ÉGALITÉ de la somme des HUIT campagnes
                                          // (63 min/j à l'époque, 12 depuis l'ADR-0074, orchestration.test.js). Un couple devenait faux dès
                                          // qu'un transfert traversait deux paires — et il REFUSAIT des
                                          // réallocations parfaitement neutres.
                                          // 2026-09-13, C28-90 : LE JOUR EST VENU. 2 → 10 min, repris aux
                                          // missions (10 → 2), qui sont toutes terminées ou à jour. Le
                                          // couple reste à 12 min/j — c'est une RÉALLOCATION, jamais une
                                          // hausse de l'enveloppe (leçon §9). Les missions gardent 2 min :
                                          // assez pour réagir à un fichier neuf, et `MISSIONS_BUDGET_JOUR_MS`
                                          // à 0 avec `MISSIONS_ACTIF` vrai serait un no-op silencieux.
  CONSOLIDATION_MAX_PAR_RUN: 60,          // fichiers ajoutés au plan par run (40 → 60 ; le coût réel = le hash)
  // Exécution du plan (ConsolidationExec.gs, ADR-0024 — décision Marc 2026-07-17 « change tout live ») :
  CONSOLIDATION_EXEC_ACTIF: false,        // ARRÊTÉE le 21/09 (C49-20). 8 min/j rendues.
                                          // ⚠️ Ce qui suit décrit ce qu'elle FAIT UNE FOIS RALLUMÉE : applique
                                          // Déplacer/Doublon du PlanConsolidation (moveTo seul, §1 re-vérifiée
                                          // par mutation) — false = suspension immédiate
  CONSOLIDATION_EXEC_BUDGET_MS: 2 * 60 * 1000,        // sous-budget par run — reste STRICTEMENT < garde-temps de
                                          // tick (ANALYSE_V2_BUDGET_MS 3 min) pour ne pas affamer le reste du
                                          // tick ; le débit journalier vient du budget QUOTIDIEN (moveTo cheap)
  CONSOLIDATION_EXEC_BUDGET_JOUR_MS: 0 * 60 * 1000,   // budget QUOTIDIEN en ms réelles persistées.
                                          // ⚡ 12 → 8 (RÉALLOCATION C28-99) : PRÊTEUR cette fois, et pour une raison
                                          // mesurée — le plan est DRAINÉ (372/372, statut « attend la génération »),
                                          // l'exécuteur tourne donc à vide pendant que la génération étouffe. Il a
                                          // drainé 372 lignes avec 12 min ; à 8 min il en drainera encore ~250/j,
                                          // très au-delà de ce qu'une génération à 1 domaine/j peut produire. Les
                                          // 4 min sont RENDUES dès que l'exécuteur redevient le goulot (le test de
                                          // bloc ci-dessous force l'arbitrage : on ne peut pas les rendre sans les
                                          // reprendre à quelqu'un).
                                          // 6 → 12 min (RÉALLOCATION 2026-08-11, décision Marc « accélère, réalloc
                                          // sûre »). Le diagnostic un-clic `etatCampagnesRangement` a PROUVÉ sur la
                                          // prod que l'exécuteur EST désormais le goulot : budget jour 6/6 ÉPUISÉ,
                                          // génération throttlée par la contre-pression (2,3/12 min seulement) — elle
                                          // n'alimente plus car l'exec n'a pas rattrapé (plan de 1236 lignes, 525
                                          // déplacements). C'est l'INVERSE de l'hypothèse C28-29 (« exec pas le
                                          // goulot »), vraie quand la conso ne tournait pas encore. Preuve du
                                          // drainage : 05·Carrière 155 → 26 fichiers à plat ; reste surtout 08·Perso
                                          // (996). Les +6 min sont PRIS sur FUSION_EXEC (parké à 0, campagne OFF) ⇒
                                          // enveloppe reset-OFF INCHANGÉE (histo 20 + gen 12 + exec 12 + sync 12 +
                                          // fusion 0 = 56 min/j ≤ 65, invariant orchestration.test.js). RÉALLOCATION,
                                          // jamais AUGMENTATION (leçon §7 / C28-29 : au-delà de ~90 min/j de runtime,
                                          // gel de TOUS les déclencheurs, chien de garde inclus).
  CONSOLIDATION_EXEC_MAX_PAR_RUN: 100,    // lignes du plan consommées par run au maximum (60 → 100 ; moveTo cheap)
  CONSOLIDATION_BACKLOG_MAX: 150,         // contre-pression : la GÉNÉRATION s'arrête si l'exécuteur a plus
                                          // de N lignes de retard (drainer avant d'alimenter, tôt + gated)

  // ---- C28-33 (ADR-0030) : RESET complet — rassemblement `_TRI 2026`, dédup, placement, 04 interne ----
  // Décision Marc 2026-07-29 (structure validée en PR1). Exécution DIRECTE (comme ConsolidationExec,
  // « change tout live ») : déplacement seul (§2), jamais de suppression. Trois phases indépendantes,
  // chacune bornée + reprenable + convergente (clé dédiée, « terminé » seulement sur une passe qui ne
  // collecte plus rien). Pendant le reset (résetEnCours_ = true), conso-2 (génération + exécution), la
  // réorg auto C28-32, l'historique Gmail ET la réconciliation Index sont SUSPENDUES (ADR-0030
  // « Transition ») — leur budget quotidien est donc LIBRE : les budgets ci-dessous ne s'AJOUTENT pas à
  // l'enveloppe agrégée, ils la REMPLACENT le temps du reset (jamais un risque de gel du quota ~90 min/j).
  //
  // ⚡ RÉALLOCATION (décision Marc 2026-07-29 : « je veux que tu le fasses toi automatiquement » — c'est
  // déjà le cas via le tick ; ce qu'il demande, c'est que l'AUTO aille vite). On ne RELÈVE PAS
  // l'enveloppe totale (ce serait le piège du gel documenté en C28-29) : on RÉALLOUE ce que les
  // campagnes suspendues libèrent — conso-2 gen 12 + exec 6, histo Gmail 20, sync Index 12 = 50 min/j.
  // Reset 20 → 50 min/j (≈ 2,5× plus rapide) en restant SOUS l'enveloppe d'avant (elle valait déjà 50).
  // Invariant verrouillé par test (`test/orchestration.test.js` : reset ≤ somme des libérés).
  // À VÉRIFIER par signal indépendant (heartbeat non figé l'après-midi) — leçon §7.
  // C28-34 (2026-07-31) : intervalle MINIMAL entre deux recalculs du résumé hub. Le calcul relit
  // l'Index ENTIER (non borné, ~10 800 lignes et croissant) + le Journal ; à chaque tick (×288/j)
  // il domine le socle non budgété et retarde le heartbeat. Le widget n'a pas besoin d'être à la
  // minute — 15 min divisent le coût par ~3 sans perte perceptible.
  // Retiré par ADR-0078 (hub supprimé, demande Marc 19/11/2026) : éteint l'étape `hub-resume`
  // du tick pour éviter les lectures inutiles et l'erreur « Hub » au Journal (dossier revue absent).
  HUB_RESUME_ACTIF: false,
  HUB_RESUME_INTERVALLE_MS: 15 * 60 * 1000,
  // FENÊTRE DE QUEUE du calcul cher (DriveAI#806) : le résumé ne relit plus l'Index ni le Journal en
  // entier, seulement leurs N DERNIÈRES lignes (l'Index n'a que des ajouts : son coût grandissait
  // sans fin). Si la fenêtre ne remonte pas jusqu'à 7 jours en arrière, ou ne contient aucun
  // document classé, `compterMetriquesHubBorne_` relit l'onglet entier : une fenêtre trop petite
  // coûte donc du temps, jamais un chiffre faux.
  HUB_FENETRE_INDEX: 3000,
  HUB_FENETRE_JOURNAL: 4000,
  // RETIRÉ 2026-08-05 (incident « rangement bloqué ») : le reset a matériellement fini sa migration
  // one-time (bacs `_TRI 2026` vides, `04` convergé) MAIS il ne se clôt JAMAIS seul sur un Drive
  // vivant — le rassemblement n'a aucun drapeau « domaine épuisé » (contrairement à la consolidation),
  // sa seule fin est `examines===0` sur une passe complète, et l'intake tourne AVANT lui à chaque tick
  // ⇒ il re-collecte les nouveaux fichiers ⇒ `examines≥1` perpétuel ⇒ `DriveAI_RESET_RASSEMBLEMENT`
  // jamais posé ⇒ `resetEnCours_()` reste true À VIE ⇒ la consolidation (le seul re-rangeur des racines
  // de domaine) reste suspendue à vie (deadlock, ~1 semaine, 305 fichiers legacy à plat non re-rangés).
  // Le flux vivant + la consolidation rangent désormais seuls. ⚠️ NE PAS RE-PASSER à true sans corriger
  // d'abord la convergence du rassemblement (drapeau « domaine épuisé », comme la conso), sinon le
  // deadlock revient. Voir ADR-0035.
  RESET_ACTIF: false,                     // false = suspension immédiate de TOUTES les phases (comme CONSOLIDATION_EXEC_ACTIF)
  RESET_TAG: 'tri33',                     // bumper relance une campagne complète (re-parcourt tout, additive)
  // Version de la TABLE de routage (`STRUCTURE_CIBLE_RESET` + `cheminCibleReset_`). Entre dans la clé
  // d'idempotence du PLACEMENT : la bumper re-tente le RELIQUAT resté dans `_TRI 2026` après un
  // affinage des règles, SANS toucher à ce qui est déjà rangé (la collecte du placement n'itère que
  // sur `_TRI 2026/<domaine>` — un fichier placé n'y est plus, il n'est donc jamais re-présenté).
  // À bumper à CHAQUE modification des règles de routage, sinon les non-routés resteraient marqués
  // « déjà tenté » à vie et l'affinage serait sans effet (constaté au 1ᵉʳ reliquat réel, 2026-07-30).
  RESET_TABLE_VERSION: 't7',              // t7 (ADR-0060, 2026-09-15) : Valdor = le dossier de Marc
                                          // `CEGEP - Valdor (2020)` + règle `ai essentials`.
                                          // t6 (ADR-0055, 2026-09-14) : les écoles de `06` passent sous
                                          // `Archives scolaires` et prennent les noms de dossier de Marc.
                                          // RESET_ACTIF=false, donc aucun redémarrage de campagne : le bump
                                          // ACQUITTE la dette pour le jour où le reset repartirait.
                                          // t5 (ADR-0044, 2026-08-20) : « Marqued » RETIRÉ du nœud Véhicule (il le
                                          // faisait RECRÉER par nom pendant que la mission le dissout →
                                          // ping-pong), + les 3 dossiers COMMUNS « Recherche & achat »,
                                          // « Locations » et « À attribuer » déclarés dans la table. Ce bump ACQUITTE
                                          // aussi la dette laissée par C28-51 (ADR-0040), qui avait révoqué le
                                          // transversal t4 de 03 SANS bump parce que la campagne était terminée
                                          // et RESET_ACTIF=false : le jour où le reset repart, les refus keyés
                                          // sous t4 seront enfin ré-évalués sous les règles courantes.
                                          // t4 : 03 « Véhicules/{Entretien & réparations, Assurance auto,
                                          // Recherche & achat, Contraventions} » — décision Marc 2026-07-31
                                          // sur le reliquat réel (~64 fichiers auto sans dossier d'accueil).
                                          // t3 : 02 « Revenus & paie » (remplace le nœud jamais créé
                                          // « Donations & successions ») + 03 « Contrats »/« Correspondance »
                                          // — décisions Marc 2026-07-30 sur le reliquat réel (134 non routés).
                                          // t2 : + Anna specimen (pièces d'identité), + codes de récupération

  RESET_TRI_NOM: '_TRI 2026',             // racine de rassemblement, à côté de `_Doublons`/`_Technique` (préfixe _ = invisible des scans vivants)
  // PLAFONDS PAR RUN — relevés le 2026-07-31. Ce n'est PAS une augmentation de budget : le
  // garde-temps (3 min/run, vérifié À CHAQUE item) reste la VRAIE borne, inchangé, et le budget
  // QUOTIDIEN est compté en MS RÉELLEMENT CONSOMMÉES — un run qui coupait tôt sur le plafond
  // d'items ne « perdait » donc rien : le reliquat de ms restait disponible au tick suivant.
  // ⚠ CORRECTION d'une affirmation antérieure (revue #229) : relever ces plafonds n'augmente PAS
  // le débit journalier (≈ +5 %, par simple amortissement du coût FIXE de setup par run —
  // `ensembleDomainesProteges_`, lecture du plan, `entitesValideesParCle_`). Le débit reste fixé
  // par les budgets/jour ci-dessous. Ces plafonds ne bornent que la mémoire (tableau d'IDs) et la
  // granularité de reprise.
  RESET_HASH_TAILLE_MAX: 5 * 1024 * 1024, // borne PROPRE au reset pour `empreinteBlob_` (< OCR_TAILLE_MAX
                                          // = 20 Mo) : hasher un blob de 20 Mo coûte 10-60 s et peut
                                          // franchir le mur des 6 min sur le DERNIER item d'un run (revue
                                          // #229). Un doublon exact > 5 Mo reste RAPPORTÉ par
                                          // `signalerQuasiDoublonReset_` — jamais perdu, juste non déplacé.
  RESET_RASSEMBLEMENT_MAX_PAR_RUN: 400,   // fichiers déplacés vers `_TRI 2026/<domaine>` par run
  RESET_RASSEMBLEMENT_BUDGET_JOUR_MS: 20 * 60 * 1000, // 8 → 20 (il ALIMENTE le placement : jamais l'affamer)
  RESET_PLACEMENT_MAX_PAR_RUN: 300,       // fichiers dédupliqués/routés depuis `_TRI 2026` par run (pas d'OCR/LLM — cheap)
  RESET_PLACEMENT_BUDGET_JOUR_MS: 14 * 60 * 1000,     // 22 → 14 (revue flotte C28-42 : quasi convergé — le
                                          // reliquat n'existe que parce que le routable est PLACÉ ; le bump de
                                          // table ne ré-ouvre qu'un petit lot) — les 8 min vont à la passe LLM
  RESET_04_MAX_PAR_RUN: 150,              // fichiers réorganisés EN INTERNE sous 04 par run
  RESET_04_BUDGET_JOUR_MS: 4 * 60 * 1000,             // 8 → 4 (revue flotte C28-42 : 04 est petite et converge
                                          // la première) — les 4 min vont à la passe LLM
  RESET_LLM_MAX_PAR_RUN: 6,               // ADR-0030 PR5 (décision Marc 2026-07-31) : fichiers du RELIQUAT
                                          // non-routable passés au PIPELINE COMPLET (OCR + Sonnet v2) par
                                          // run — ~20-30 s/doc ; le garde-temps du tick (3 min) reste la
                                          // vraie borne par run, ce plafond ne règle que la granularité
  RESET_LLM_BUDGET_JOUR_MS: 12 * 60 * 1000, // budget QUOTIDIEN en ms RÉELLES persistées (revue flotte
                                          // C28-42 : « un plafond par RUN ne borne pas la JOURNÉE » — sans
                                          // lui, le drainage du reliquat concentrait 50-130 min de runtime
                                          // sur UN jour → gel C28-29). RÉALLOUÉ dans l'enveloppe 50 min/j du
                                          // reset (placement 22→14, 04 8→4), sommé dans l'invariant
                                          // d'orchestration (prouvé par mutation). Reliquat ~70-134 docs
                                          // → drainé en ~3-4 jours
  // --- PILOTE CI (ADR-0032, décision Marc 2026-07-31 « plus jamais lancer à la main, et plus vite ») ---
  PILOTE_ACTIF: true,                     // interrupteur : false ⇒ l'action web app `pousser-reset` refuse
                                          // (le tick continue seul, aux budgets quotidiens habituels)
  PILOTE_BUDGET_MS: 3.5 * 60 * 1000,      // durée MAX d'UNE passe poussée. Sous le mur des 6 min avec de la
                                          // marge (la réponse HTTP doit repartir avant le timeout /exec), et
                                          // < PILOTE_PAUSE_S côté CI pour garantir une fenêtre au tick.
  PILOTE_MARGE_DOC_MS: 60 * 1000,         // ne JAMAIS démarrer un document LLM dans la dernière minute :
                                          // OCR + 2 appels Sonnet avec retry peuvent coûter 1-3 min et le
                                          // garde n'est évalué qu'AVANT de prendre le document (sinon on
                                          // dépasse le `--max-time` de la CI, voire le mur dur des 6 min)
  PILOTE_BUDGET_JOUR_MS: 30 * 60 * 1000,  // BORNE DU PARI (revue flotte C28-43) : ADR-0032 suppose que le
                                          // runtime d'une WEB APP est hors du quota « Triggers total runtime »
                                          // (~90 min/j) — c'est un INDICE, pas une mesure, et CLAUDE.md §6bis
                                          // (#235) tient ce quota pour PARTAGÉ. Si le pari est faux, cette
                                          // constante borne la casse à ~30 min/j au lieu de ~13 h/j. Départ
                                          // PRUDENT : à relever par Marc une fois le heartbeat observé sain
                                          // plusieurs jours (les ms réelles sont journalisées à chaque passe)
  PILOTE_STERILES_MAX: 20,                // passes consécutives sans progrès (≈ 2,5 h) avant alerte + veille :
                                          // un état bloqué mais « non terminé » ferait sinon tourner ~192
                                          // walks récursifs complets par jour pour rien, workflow tout vert
  SEED_ENTITES_TAG: 'seed-1',             // seed one-shot des entités de Marc (Entites.seedEntitesMarc_)
  ENTITES_AUTO_VALIDATION: false,         // auto-validation « vue ≥ 3 fois » COUPÉE (décision Marc
                                          // 2026-07-17 : « l'ajout de dossiers vraiment sécurisé,
                                          // utile seulement ») — seuls le seed, le formulaire de
                                          // correction et l'app valident désormais une entité
  PROGRESSION_PURGE_MS: 48 * 60 * 60 * 1000, // C28-18 : une ligne « terminé » de l'onglet Progression
                                          // reste visible 48 h (Marc voit la fin), puis est purgée —
                                          // l'onglet ne montre que le PRÉSENT, l'histoire vit au Journal
  // Grand rangement initial AUTO (zéro clic) : tant que le tag stocké (Script Property
  // `DriveAI_RANGEMENT`) diffère de celui-ci, le moteur renvoie au fil des ticks TOUT le contenu
  // « en vrac » des domaines vers 00·À trier pour reclassement/renommage (cf. Main.appliquerRangementInitial_).
  // Borné/run, reprenable, déplacement seul (jamais de suppression). Bumper ce tag relance un rangement complet.
  RANGEMENT_TAG: 'r3',                    // r3 : relance après le fix « collecte avortée → faux terminé »
                                          // (r2 s'était figé « terminé » sans rien ranger — cf. P1-17)
  // Racines SUPPLÉMENTAIRES à reclasser en plus des 7 domaines (ancien Drive). Tout leur contenu
  // « en vrac » est renvoyé dans 00·À trier puis re-classé par le pipeline (mêmes garde-fous : zone
  // protégée multi-parents, format normalisé sauté, garde-temps).
  // VIDE depuis 2026-07-07 (décision Marc « retire ») : la racine « Ancienne structure »
  // (1W3b0…) est devenue INACCESSIBLE (supprimée/déplacée par Marc). Son `getFolderById` levait à
  // chaque passe ⇒ `erreurCollecte=true` ⇒ `reste=true` permanent ⇒ le rangement ne pouvait plus
  // jamais figer « terminé » (barre bloquée à 99 %). Le rattrapage étant fini (2796/2796 classés,
  // 0 restant), on retire la racine : la prochaine passe collecte 0 sans erreur ⇒ « terminé » + 100 %.
  // Ré-ajouter un ID ici (et bumper RANGEMENT_TAG) relancerait un rangement sur cette racine.
  RANGEMENT_RACINES_SUP: [],
  // Réconciliation Index↔Drive (C28-07, plan P3) : campagne de fond perpétuelle, lecture seule.
  SYNC_LIGNES_PAR_RUN: 50,            // lignes d'Index re-visitées par tick (sur le reliquat de budget)
  // ⚠️ 12 → 4 → 1 (C49-3, 17/09) : 11 min prêtées à l'audit des pièces, le SEUL poste de l'enveloppe
  // qui ne tient aucun délai — la réconciliation Index↔Drive est PERPÉTUELLE et en LECTURE SEULE.
  // ⚠️ 1 → 12 (ADR-0074, 05/11/2026) : l'audit des pièces est RETIRÉ avec le canal Mémoire, la
  // dotation historique est RENDUE. Les 43 autres minutes de l'audit (prises aux sept campagnes
  // arrêtées par C49-20) ne vont à personne : elles retournent à la marge sous le mur, et chaque
  // campagne neuve de l'ADR-0074 les prendra par son nom (`test/orchestration.test.js`, enveloppe
  // à 12 min/j).
  // ⚠️ Jamais 0 : à zéro, cette campagne PERPÉTUELLE tournerait à vide en silence (§9).
  SYNC_BUDGET_JOUR_MS: 12 * 60 * 1000, // budget QUOTIDIEN en ms RÉELLES (leçon §7 : ~90 min/j de runtime partagé — jamais un compteur d'items)
  SYNC_AGE_MIN_H: 48,                 // une ligne plus fraîche que ça n'a pas eu le temps de dériver — pas de vérif Drive

  // --- Chantier #8 : MIGRATION de l'existant vers la nouvelle taxonomie (ADR-0002) ---
  // Re-classe les documents DÉJÀ CLASSÉS (avant le nommage par type, les entités, 07·Santé, le few-shot)
  // en les repassant au pipeline complet, EN PLACE (déplacement/renommage seul — jamais via 00·À trier :
  // leur clé Index `drive|`/`messageId|` existante y bloquerait le re-traitement). Idempotence et
  // convergence par une clé DÉDIÉE `migre|<tag>|fileId` : chaque document est re-traité UNE fois par
  // campagne ; la campagne se fige quand une passe complète ne collecte plus rien. Zone protégée (04)
  // exclue de la collecte ET revérifiée avant mutation. Bumper le tag relance une campagne complète —
  // utile après une validation d'entités en masse (les docs rangés au domaine redescendent aux entités).
  MIGRATION_TAG: 'm2-inconnu',            // m2-inconnu (C28-21) : périmètre RÉDUIT aux fichiers dont le nom
                                          // contient « Inconnu » (estAMigrer_) — sous le mur des ~90 min/j de
                                          // runtime, re-traiter TOUT l'ancien Drive prendrait des mois ; les
                                          // mal-classés bien nommés de 03/08 sont rattrapés par c26-08 ensuite.
                                          // (m1 : 1ʳᵉ migration — nommage par type + entités + 07·Santé + few-shot)
  MIGRATION_MAX_PAR_RUN: 12,              // docs re-traités (OCR+LLM complets, lourds) par run — le flux
                                          // VIVANT (intake) garde la priorité ; campagne finie en fond
  MIGRATION_BUDGET_MS: 2 * 60 * 1000,     // sous-budget PAR TICK de la migration (< BUDGET_MS) : protège le
                                          // quota JOURNALIER des triggers (~90 min/j, compte gratuit) — sans
                                          // lui, la campagne épuiserait le quota en quelques heures et
                                          // l'intake serait mort le reste de la journée

  // --- C26-08 (ADR-0018) : RE-ANALYSE v2 CIBLÉE des domaines mal classés ---
  // Décision Marc 2026-07-09 (« go 2 ») après la preuve dry-run C26-07 : re-passe au pipeline v2
  // (Sonnet 2 passes) les SEULS domaines où l'échantillon a montré un fort taux de mal-classés
  // (03 : 9 propositions/12 ; 08 : 4/11) — ~924 docs ≈ 24 $ au coût mesuré (0,026 $/doc).
  // Même mécanique éprouvée que la migration (clé dédiée additive `reanalyse|<tag>|fileId`,
  // convergence par passe vide, zone protégée revérifiée, ignorerDoublon), avec 2 différences :
  // la collecte itère UNIQUEMENT sur REANALYSE_CIBLES, et la campagne ne démarre qu'après la FIN
  // de m1 (une seule campagne de masse à la fois — les collecteurs se marcheraient dessus).
  // Ces domaines sont exclus de m1 dès ce merge : jamais payés DEUX fois (v1 puis v2).
  // ⚠️ RE-CIBLÉE le 2026-09-14 (C28-92, ADR-0056, feu vert de Marc « oui »). Le travail utile de la
  // lecture LLM sur `06` n'est PAS de trouver l'école — C28-88 a prouvé qu'elle ne la trouve pas —
  // c'est de trouver la DATE : 239 des 328 fichiers à plat portent `2026`, la date de RÉCEPTION
  // faute de date lisible à l'import, alors que le document lui-même porte la sienne dans son
  // en-tête. Re-datés, ils tombent dans les fenêtres de scolarité (ADR-0052 D6) et se rangent seuls.
  // 328 × 0,0261 $ ≈ 8,6 $, dans l'enveloppe approuvée, sous le frein `LLM_BUDGET_CAMPAGNES`.
  // ⚠️ `03` et `08` SORTENT des cibles : la collecte n'itère QUE sur cette liste, donc le coût reste
  // borné à `06`. Leurs clés `reanalyse|c26-08|<fileId>` survivent — reprendre C26-08 un jour se
  // fera par un NOUVEAU tag + ces domaines remis ici. Ce qui est parké est DIT (backlog C28-111) :
  // le compteur de C26-08 n'est pas lisible d'ici (sa ligne Progression est absente), mais la
  // ventilation LLM de septembre montre ZÉRO dépense de re-analyse — rien d'actif n'est interrompu.
  // ⚠️ ARRÊTÉE le 21/09 (C49-20, décision de Marc) alors qu'elle était EN COURS — 108/466, fin
  // estimée au 25/10. Ce n'est donc pas le ménage d'une campagne finie : c'est un arrêt
  // délibéré, sur la mesure du 21/09 — elle consommait 57,5 % du budget LLM du mois (2,33 $ /
  // 216 appels) pour +2 documents en 14 h, sur des documents DÉJÀ classés. Rallumer = remettre
  // ce flag à true ET lui rendre du budget quotidien (le verrou refuse l'un sans l'autre).
  REANALYSE_ACTIF: false,
  REANALYSE_TAG: 'c28-92',                // bumper le tag relance une campagne complète (re-facture)
  REANALYSE_CIBLES: ['06 · Études & diplômes'],
  // ⚠️ RACINE SEULE (🔴 revue sécurité ADR-0056). `REANALYSE_CIBLES` borne le DOMAINE, jamais la
  // POPULATION : la collecte était récursive, donc la campagne aurait ramassé tout l'arbre `06` —
  // y compris ce que C28-90/C28-105 venaient d'y ranger et les dossiers que MARC a construits — et
  // les aurait fait repasser par `planRoutageV2_`, qui calcule la cible depuis le seul NOM et ne
  // consulte AUCUNE des gardes du déjà-rangé (elles vivent dans `decisionConsolidation_`). Un
  // document dont le nom n'apprend rien serait reparti À PLAT à la racine du domaine.
  // Borner à la racine ramène le rayon d'action à ce que l'ADR décrit ET à ce que Marc a chiffré.
  REANALYSE_RACINE_SEULE: true,
  REANALYSE_BUDGET_MS: 2 * 60 * 1000,     // sous-budget PAR TICK (même famille que MIGRATION_BUDGET_MS) ;
                                          // la page réutilise MIGRATION_MAX_PAR_RUN (docs lourds/run)
  // Budget QUOTIDIEN, en ms RÉELLES persistées (ADR-0056). Il MANQUAIT : la campagne n'avait qu'un
  // plafond par tick, donc rien ne bornait sa journée, et elle était invisible de l'invariant
  // d'enveloppe. PRÉLEVÉ, jamais ajouté (§9 « réallouer, jamais augmenter ») : 8 min reprises à
  // `GMAIL_HISTO_BUDGET_JOUR_MS` (20 → 12), dont le moteur DIT lui-même « terminée ✅ — ses 20 min/j
  // sont RÉALLOUABLES ». C'est la réallocation que C28-70 attendait faute de preuve : la preuve est
  // désormais écrite par le moteur, pas supposée. La somme de l'enveloppe restait EXACTEMENT 63 min/j (12 depuis l'ADR-0074).
  // ⚠️ C49-3 a ESSAYÉ de prendre 4 min ici et a reculé, sur la foi d'un test : à 4 min de plafond,
  // la marge de démarrage (`PILOTE_MARGE_DOC_MS`, 1 min) devient 25 % du budget au lieu de 12,5 %,
  // et le reliquat perdu chaque jour double. Le commentaire du code le disait — « ≤ 1 min sur 8 » —
  // et il serait devenu faux en silence. Un budget ne se coupe pas en deux sans relire ce que sa
  // taille garantissait ailleurs.
  REANALYSE_BUDGET_JOUR_MS: 0 * 60 * 1000,

  // --- C26-07 (ADR-0015) : PREUVE dry-run avant/après du pipeline v2, sur un échantillon RÉEL ---
  // Prérequis à la campagne C26-08 et à l'allumage de ANALYSE_V2. Interrupteur DÉDIÉ, distinct
  // d'ANALYSE_V2 : n'affecte JAMAIS le flux vivant (Haiku 1 passe reste actif tant qu'ANALYSE_V2
  // est éteint). Exécute classifierDeuxPasses_ + planRoutageV2_ (PUR, aucune I/O) sur un échantillon
  // stratifié, écrit l'avant/après dans l'onglet Sheet « DryRunV2 » — NE DÉPLACE NI NE RENOMME RIEN.
  // Coût réel engagé quand ON (Sonnet ×2/doc, ~0,03-0,04 $/doc, ADR-0015) : n'allumer qu'après feu
  // vert explicite de Marc sur la taille de l'échantillon (docs/RUNBOOK.md).
  // ALLUMÉ 2026-07-08 (feu vert Marc : ~100 docs, ~3-6 $) ; CLOS 2026-07-09 : onglet DryRunV2
  // rempli (100/100, coût 2,61 $) et validé par Marc → « go » à C26-08 (ADR-0018). Rebrancher
  // exige un NOUVEAU tag (re-facture, décision explicite).
  DRYRUN_V2_ACTIF: false,
  DRYRUN_V2_TAG: 'd1',                    // bumper relance un NOUVEL échantillon (re-facture, décision explicite)
  DRYRUN_V2_TAILLE: 100,                  // taille cible de l'échantillon global (marge 50-150, à confirmer avec Marc)
  DRYRUN_V2_MAX_PAR_DOMAINE: 15,          // plafond par domaine — anti-déséquilibre (un domaine énorme n'écrase pas les autres)
  DRYRUN_V2_MAX_PAR_RUN: 8,               // docs traités (OCR + Sonnet ×2, lourds) par tick — flux vivant reste prioritaire
  DRYRUN_V2_BUDGET_MS: 2 * 60 * 1000,     // sous-budget PAR TICK (même famille que MIGRATION_BUDGET_MS)

  // Dry-run de COMPARAISON 1↔2 passes (ADR-0034 §5, Vague 3c) : PREUVE avant d'allumer
  // `ANALYSE_V2_2E_PASSE_CONDITIONNELLE`. Interrupteur DÉDIÉ (OFF par défaut) : quand ON, réutilise
  // l'échantillon STRATIFIÉ du dry-run (même corpus, DRYRUN_V2_TAG) mais exécute TOUJOURS les DEUX
  // passes par document (jamais le gate en prod), écrit dans l'onglet `DryRunV2Compare` — pour CHAQUE
  // doc : décision du gate (sauterait la passe 2 ?), divergence de PLACEMENT 1 passe vs 2 passes, et
  // surtout les FAUX NÉGATIFS `sensible` (passe 1 false → passe 2 true). ZÉRO mutation Drive (même
  // garantie que le dry-run). Coût réel (Sonnet ×2/doc) : compté sous le frein LLM_BUDGET_CAMPAGNES.
  // N'allumer qu'au feu vert de Marc (re-facture le corpus). Clé de convergence DÉDIÉE `dryruncmp|<tag>|fileId`.
  DRYRUN_CMP_ACTIF: false,
  DRYRUN_CMP_TAG: 'c1',                    // bumper relance une NOUVELLE comparaison (re-facture, décision explicite)
  DRYRUN_CMP_MAX_PAR_RUN: 8,              // docs comparés (OCR + Sonnet ×2) par tick — flux vivant reste prioritaire
  DRYRUN_CMP_BUDGET_MS: 2 * 60 * 1000,    // sous-budget PAR TICK (identique au dry-run : même coût-temps Sonnet ×2)

  // Fusion des dossiers d'entité en double (Chantier #47, ADR-0036). PR1 = dry-run un-clic
  // `genererPlanFusion` (LECTURE SEULE + écriture de l'onglet PlanFusion). Bornes du scan lecture.
  FUSION_MAX_SOUSDOSSIERS: 500,           // sous-dossiers directs listés par domaine (borne haute)
  FUSION_MAX_FICHIERS_COMPTE: 200,        // fichiers directs comptés par sous-dossier (assez pour « vide/peu/beaucoup »)
  // Exécution du plan curé (FusionExec.gs, ADR-0037 — PR2). GATÉE OFF : ne tourne qu'au feu vert de
  // Marc. `moveTo` seule mutation ; §1/04-interne/multi-parents gardés ; entités re-pointées ;
  // coquilles vides → vide-candidat (app). Campagne ONE-SHOT (bump `FUSION_EXEC_TAG` pour re-évaluer).
  FUSION_EXEC_ACTIF: false,               // false = suspension immédiate (comme CONSOLIDATION_EXEC_ACTIF)
  FUSION_EXEC_TAG: 'fusionexec-1',        // tag de campagne (clés `fusionexec|<tag>|<fileId>` / `fusrow|<tag>|<sourceId>`)
  FUSION_EXEC_BUDGET_MS: 2 * 60 * 1000,   // sous-budget par run — < garde-temps de tick (ne pas affamer le reste)
  FUSION_EXEC_BUDGET_JOUR_MS: 0 * 60 * 1000, // PARKÉ à 0 (RÉALLOCATION 2026-08-11) : ses 6 min sont prêtés à
                                          // CONSOLIDATION_EXEC tant que la fusion est OFF (le gate `!FUSION_EXEC_ACTIF`
                                          // en TÊTE de `appliquerPlanFusion_` retourne AVANT toute lecture de ce
                                          // budget — 0 est donc inoffensif ici). ⚠ À LA RÉACTIVATION de la fusion
                                          // (FUSION_EXEC_ACTIF=true) : lui redonner du budget en le PRENANT à une
                                          // autre campagne, jamais en l'ajoutant. Le test d'ÉGALITÉ (somme des huit
                                          // = 12 min/j depuis l'ADR-0074) force l'arbitrage — inutile de citer ici des valeurs qui se
                                          // périment : ce commentaire l'a fait (« redescendre l'exec de 12 à 6 »
                                          // alors qu'il est à 8, relevé en revue C28-99). Pure I/O (moveTo).
  FUSION_EXEC_MAX_SOURCES_PAR_RUN: 40,    // dossiers source drainés par run au maximum (moveTo cheap, reprenable)
  FUSION_EXEC_MAX_FICHIERS_PAR_SOURCE: 500, // fichiers directs collectés-puis-déplacés par source et par run

  // Journal QUOTIDIEN du vrac par domaine (HistoriqueVrac.gs, demande Marc 2026-08-12 : suivi
  // jour par jour jusqu'à la fin du drainage). LECTURE SEULE (comptage `compterVracRacineDomaine_`,
  // Diagnostic.gs) — une seule sweep COMPLÈTE par jour (gardée par Property, jamais 2×/j), curseur
  // de domaine reprenable si le budget coupe en cours de route (garde-temps vérifié AVANT CHAQUE
  // domaine, jamais une sélection non bornée — revue flotte apps-script-quota). Onglet append-only
  // (série temporelle, jamais écrasé — patron PlanConsolidation/PlanFusion, pas Progression/Santé
  // qui réécrivent). Tourne MÊME pendant un reset (aucune mutation, pas de conflit avec « une seule
  // main déplace »).
  HISTORIQUE_VRAC_ACTIF: false,           // ARRÊTÉE le 21/09 (C49-20). 4 min/j rendues.
  HISTORIQUE_VRAC_BUDGET_MS: 2 * 60 * 1000,      // sous-budget par run — pur listing Drive, jamais de LLM
  HISTORIQUE_VRAC_BUDGET_JOUR_MS: 0 * 60 * 1000, // budget QUOTIDIEN en ms réelles persistées (leçon §7 :
                                          // un plafond par RUN ne borne pas la JOURNÉE si la sweep doit
                                          // reprendre sur plusieurs ticks) — compté dans l'enveloppe
                                          // reset-OFF (orchestration.test.js).

  // ---------- DRAINAGE de `Documents ID` (C28-73, ADR-0048 — décision Marc 2026-08-20) ----------
  // Structure créée à la main en 2023, HORS arborescence DriveAI, qui double partiellement
  // `01 · Administratif & identité/Pièces d'identité` : 15 fichiers dont les 2 NAS et 4 passeports.
  // Périmètre par IDENTITÉ (IDs fixes), jamais par nom : cette campagne RENOMME et DÉPLACE, se
  // tromper de périmètre n'y est pas rattrapable d'un clic. Vider la liste = campagne inerte.
  DOCUMENTS_ID: {
    tag: 'd1',                                          // bump = re-drainage complet
    maxParRun: 30,                                      // plafond d'items par run — toutes les campagnes
                                                        // voisines en ont un (MIGRATION_MAX_PAR_RUN,
                                                        // RESET_LLM_MAX_PAR_RUN…). 15 fichiers réels,
                                                        // mais rien n'empêche Marc d'en déposer 500.
    racine: 'FICTIF_DOCUMENTS_ID_RACINE',        // `Documents ID` (fiche d'état civil à sa racine)
    sousDossiers: [
      'FICTIF_DOCUMENTS_ID_SOUSDOSSIERS_0',              // Carte ID (3)
      'FICTIF_DOCUMENTS_ID_SOUSDOSSIERS_1',              // NAS (2)
      'FICTIF_DOCUMENTS_ID_SOUSDOSSIERS_2',              // Passeport (4)
      'FICTIF_DOCUMENTS_ID_SOUSDOSSIERS_3',              // Carte vitale (1)
      'FICTIF_DOCUMENTS_ID_SOUSDOSSIERS_4',              // Permis (4)
    ],
  },

  // ---------- VALIDATION de `_Doublons` par empreinte (C28-49 PR4, ADR-0047) ----------
  // Campagne STRICTEMENT lecture seule : aucun moveTo, aucun renommage, aucun appel LLM. Elle
  // re-pose la question que `estDoublon_` ne pose pas — « un exemplaire est-il ENCORE classé ? » —
  // et écrit un verdict par fichier écarté dans l'onglet `RapportDoublons`.
  // ADR-0070 — « cette empreinte déjà vue a-t-elle ENCORE un exemplaire ? » (flux vivant, pas la campagne ci-dessous).
  PORTEUR_VERIF_MAX_RUN: 150,             // lectures Drive (`files.get`, preuve de vie + empreinte, #897) au plus par run = INTAKE_PAGE : une page pleine de doublons se prouve en entier ; au-delà : « inconnu », donc exemplaire non prouvé → traité normalement (ADR-0077)
  PORTEUR_CANDIDATS_MAX: 5,               // exemplaires vérifiés au plus pour UNE empreinte (les plus récents d'abord, arrêt au premier vivant) ; au-delà, on ne peut pas les prouver tous morts
  DOUBLONS_ACTIF: false,                  // ARRÊTÉE le 21/09 (C49-20) — terminée le 22/08. 1 min/j rendue.
  DOUBLONS_TABLE_VERSION: 'd1',           // bump = rapport remis à zéro et TOUT re-validé (les verdicts
                                          // dépendent d'un état MUTABLE — un jumeau peut avoir bougé
                                          // depuis : « verdict révisable, jamais figé à vie », leçon §9)
  DOUBLONS_TAILLE_PAGE: 1000,             // `files.list` — 1000 est le maximum de l'API ; ~17 pages pour
                                          // un Drive de 16 600 fichiers, sans télécharger un seul octet
                                          // (le md5Checksum vient des MÉTADONNÉES)
  DOUBLONS_PASSES_MIN: 2,                 // balayages COMPLETS exigés avant de prononcer un « orphelin » :
                                          // `files.list` paginé n'est pas un instantané et n'a pas
                                          // d'ordre stable — un fichier déplacé entre deux pages peut
                                          // n'apparaître dans AUCUNE, et une preuve d'ABSENCE trouée
                                          // fabriquerait un faux orphelin (revue flotte, ADR-0047 §5)
  DOUBLONS_BUDGET_MS: 90 * 1000,          // sous-budget par run (pur listing REST + 1 écriture Sheet/page)
  DOUBLONS_BUDGET_JOUR_MS: 0 * 60 * 1000, // budget QUOTIDIEN en ms réelles persistées. 0 est VOULU : la campagne
                                          // est TERMINÉE (« terminée ✅ le 2026/08/22 — 1076 écartés » dans la
                                          // Santé) et arrêtée (`DOUBLONS_ACTIF: false`, C49-20) ; sa dernière
                                          // minute était prêtée à l'audit des pièces (retiré par l'ADR-0074,
                                          // elle est revenue à la marge). Le test d'enveloppe de
                                          // orchestration.test.js verrouille la somme des budgets à 12 min/j.
                                          // ⚠️ Pour RÉACTIVER la campagne (bump de `DOUBLONS_TABLE_VERSION`) :
                                          // une campagne ACTIVE à budget 0 est MUETTE (no-op silencieux, c'est
                                          // l'interdit verrouillé par le test) ; il faut alors reprendre la
                                          // minute à l'audit dans la table, dans la même PR.

  // ---------- RETOUR DES ORPHELINS de `_Doublons` (#468 point 2, ADR-0047 §8) ----------
  // ONE-SHOT : rend leur place aux 19 fichiers que la validation a trouvés SEULS de leur contenu,
  // par le pipeline (déplacement seul, jamais de suppression). S'éteint seul (Property
  // `DriveAI_RETOUR_ORPHELINS`) ; le passer à false suspend immédiatement. Voir RetourOrphelins.gs.
  RETOUR_ORPHELINS_ACTIF: true,
  RETOUR_ORPHELINS_LOT: 5,                // orphelins traités par tick (1 appel LLM chacun)

  // ---------- MISSIONS de curation (C28-49, ADR-0039 — brief Marc 2026-08-17) ----------
  MISSIONS_ACTIF: false,                  // ARRÊTÉE le 21/09 (C49-20) — dernière production il y a 32 j.
                                          // 2 min/j rendues. false = suspension immédiate de TOUTES les missions.
  // c49-3 (ADR-0044 §4, véhicules) puis c49-4 (§5, les 39 de « employeurs & CV ») — l'historique
  // inline s'arrêtait à c49-2 alors que la valeur avait bougé deux fois (revue code PR2).
  MISSIONS_REGLES_VERSION: 'c50-1',       // ⚠️ PAS de bump pour ADR-0055, et c'est délibéré (revue
                                          // flotte C28-105) : `ecoles-archives06` porte un TAG NEUF, donc
                                          // ses clés sont fraîches par construction. Aucun AUTRE routeur de
                                          // mission n'a changé (`dispatch03` lit `cheminCibleReset_('03…')`,
                                          // `annees02`/`impots` lisent `02` — la branche modifiée est `06`).
                                          // Bumper aurait invalidé les clés de SUCCÈS des 8 missions et leur
                                          // drapeau FINI : re-collecte complète de toutes les sources et
                                          // rapport des paies re-gaté, sur 2 min/j partagées, sans rien
                                          // rouvrir d'utile.
                                          // DANS la clé d'idempotence : un refus (non apparié) se fige
                                          // sous CETTE version — affiner les règles = bump ⇒ ré-évaluation
                                          // (leçon C28-33 « verdict négatif révisable, jamais figé à vie »)
                                          // c49-2 (C28-51, ADR-0040) : tables bailleurs + véhicules,
                                          // catégories par véhicule — les 89 refus c49-1 se ré-évaluent.
                                          // c50-1 (2026-09-12, réponses de Marc) : alias de bailleurs
                                          // (agence et propriétaires → leur logement) et filet par
                                          // ÉMETTEUR pour assurances et énergie — les ~28 refus des
                                          // missions logement/dispatch03/carrière se ré-évaluent.
  MISSIONS_BUDGET_MS: 90 * 1000,          // sous-budget par run (pure I/O moveTo — reste < mur standard)
  MISSIONS_BUDGET_JOUR_MS: 0 * 60 * 1000, // budget QUOTIDIEN partagé entre missions, ms RÉELLES persistées.
                                          // RÉALLOUÉ (jamais ajouté) : les 10 min viennent de
                                          // CONSOLIDATION_BUDGET_JOUR_MS (12 → 2, gen terminée le 16/08).
                                          // Couple missions+conso-gen = 12 min/j verrouillé par test.
  MISSIONS_MAX_PAR_RUN: 60,               // plafond d'items par passe (le garde-temps borne déjà le coût)
  MISSIONS_ERREURS_MAX: 12,               // runs CONSÉCUTIFS en erreur de collecte avant de ne réessayer
                                          // qu'1×/jour (revue quotas : un ID supprimé/mal épinglé brûlerait
                                          // sinon 10 min/j à vie) — toute passe saine remet à zéro
  MISSIONS_PROFONDEUR_MAX: 6,             // profondeur de collecte (revue code : à 2, des fichiers restaient
                                          // INVISIBLES et la mission se déclarait « terminée » en les ignorant
                                          // — au-delà de la borne, signalé + mission maintenue OUVERTE)
  MISSIONS_FENETRE_MARGE_MS: 30 * 24 * 60 * 60 * 1000, // ± 30 j autour des dates observées d'un logement
  MISSIONS_DEPEINTURE_MAX_JOURS: 30,      // sonde de dé-peinture : passes AVANT d'abandonner (§9 —
                                          // un « chemin de retour » sans fin est un coût sans fin)
  MISSIONS_COULEUR_VIDE: '#f83a22',       // ROUGE Drive (palette standard) : « vidé, bon pour suppression »
                                          // — un SIGNAL pour Marc, jamais une suppression (§2)
  // IDs ÉPINGLÉS des dossiers de Marc (recon du 2026-08-17). Par ID et jamais par NOM : un renommage
  // ne doit pas re-router les missions vers un autre dossier (identité = invariant, leçon getSheetEtat_).
  MISSIONS_IDS: {
    // 03 · Logement & véhicule — cibles GAGNANTES choisies par Marc :
    vehiculeCible: 'FICTIF_CATEGORIES_03_LOGEMENT_VEHICULE_VEHICULE',   // « Véhicule » (un dossier par véhicule du canon + le véhicule isolé créé)
    // Les deux dossiers « Marqued » CRÉÉS PAR LE MOTEUR sous c49-2 (constatés dans le Drive le
    // 2026-08-20, 3 fichiers au total) : sources à DISSOUDRE vers « Recherche & achat ». Sans
    // ça, retirer Marqued du canon les laisserait orphelins À VIE — aucune mission ne les couvre
    // (revue C28-62). Une fois vidés, `sourcesJetables` les peint en rouge pour que Marc les ôte.
    vehiculeRechercheA: 'FICTIF_MISSIONS_IDS_VEHICULERECHERCHEA',      // « Véhicule/Marqued »
    vehiculeRechercheB: 'FICTIF_MISSIONS_IDS_VEHICULERECHERCHEB', // « Véhicule/<2ᵉ véhicule du canon>/Marqued » (comparatif d'occasion)
    logementCible: 'FICTIF_CATEGORIES_03_LOGEMENT_VEHICULE_LOGEMENT',   // « Logement » (5 adresses)
    // sources à VIDER :
    vehiculesPluriel: 'FICTIF_MISSIONS_IDS_VEHICULESPLURIEL', // « Véhicules »
    vehiculeIsole: 'FICTIF_MISSIONS_IDS_VEHICULEISOLE',    // « Marquec Modelc » posé à la racine de 03
    logementsPluriel: 'FICTIF_MISSIONS_IDS_LOGEMENTSPLURIEL', // « Logements »
    // C28-51 (ADR-0040 §3b) : le SPLIT ALPHAIMMO — même logement dans deux dossiers de la cible. La
    // mission `logement` draine le double vers l'adresse (sous-dossiers homonymes fusionnés).
    logementA: 'FICTIF_MISSIONS_IDS_LOGEMENTA',     // Logement/<1ʳᵉ adresse> (l'adresse GAGNANTE)
    logementADouble: 'FICTIF_MISSIONS_IDS_LOGEMENTADOUBLE', // Logement/« Groupe Immobilier Alphaimmo » (le double à vider)
    contrats03: 'FICTIF_MISSIONS_IDS_CONTRATS03',
    correspondance03: 'FICTIF_MISSIONS_IDS_CORRESPONDANCE03',
    assuranceHab03: 'FICTIF_MISSIONS_IDS_ASSURANCEHAB03',
    energieServices03: 'FICTIF_MISSIONS_IDS_ENERGIESERVICES03',
    // 06 · Études — SENS RE-INVERSÉ le 2026-09-14 (ADR-0055, demande de Marc : « j'ai la bonne
    // structure pour les écoles déjà, continue à rajouter là-dedans au lieu de mettre à la racine
    // du projet » + « décale prépa et cégep là-dedans »). Relevé Drive du 14/09 : les 7 dossiers de
    // sa capture ne sont PAS à la racine de `06`, ce sont les enfants d'`Archives scolaires`, qu'il
    // a créés lui-même le 29/05/2026. Les dossiers d'école de la RACINE, eux, ont tous été créés
    // par le MOTEUR (07→08/2026). C'est donc la racine qui se vide dans l'archive, pas l'inverse.
    // ⚠️ RÉVISE la décision du 13/09 (`archives06` → `retour-ecoles06`, « mes 5 dossiers d'école »),
    // qui portait sur une question ; celle-ci porte sur une capture d'écran de la structure réelle.
    // ⚠️ Le libellé de GAUCHE est le dossier de la RACINE (source, moteur), celui de DROITE le
    // dossier de MARC (cible). `cibleNom` est le nom EXACT du nœud de `STRUCTURE_CIBLE_RESET`
    // (tripwire : une règle, deux consommateurs) ; `cible` est son ID quand le dossier EXISTE déjà.
    // (ADR-0060) Le cégep vise DÉSORMAIS PAR ID le dossier que Marc utilise. L'ancienne cible sans
    // ID a été créée À VIDE par `repointerEcoles06_` le 15/09 : sa garde « une ligne du référentiel
    // vise la source » était vraie par CONFIGURATION (le seed des entités y écrit ce dossier), pas
    // par mouvement. À la convergence, une cible sans ID n'est plus JAMAIS créée — seulement
    // trouvée si elle existe.
    archivesScolaires: 'FICTIF_MISSIONS_IDS_ARCHIVESSCOLAIRES', // 06/« Archives scolaires » (dossier de Marc)
    // Les noms d'école viennent de `PARCOURS.ecoles` (profil privé) : ces `cibleNom` doivent leur
    // être ÉGAUX, au caractère près (tripwire de test).
    ecoles06: [
      { src: 'FICTIF_MISSIONS_IDS_ECOLES06_0_SRC', cible: 'FICTIF_MISSIONS_IDS_ECOLES06_0_CIBLE', cibleNom: 'Collège & Lycée — divers (2014-2018)' },        // lycée A
      // (ADR-0056) L'ANCIEN dossier d'archive de Marc devient lui aussi une SOURCE : il se vide
      // dans le dossier fusionné. C'est la seule paire dont la source est un dossier à LUI —
      // elle existe parce que c'est LUI qui a demandé la fusion (« fusionne en un 2014-2018 »).
      { src: 'FICTIF_MISSIONS_IDS_ECOLES06_1_SRC', cible: 'FICTIF_MISSIONS_IDS_ECOLES06_0_CIBLE', cibleNom: 'Collège & Lycée — divers (2014-2018)' },        // ancien dossier du lycée A
      { src: 'FICTIF_MISSIONS_IDS_ECOLES06_2_SRC', cible: 'FICTIF_MISSIONS_IDS_ECOLES06_2_CIBLE', cibleNom: 'Prépa Alpha (2017-2018)' },                  // prépa
      { src: 'FICTIF_MISSIONS_IDS_ECOLES06_3_SRC', cible: 'FICTIF_MISSIONS_IDS_ECOLES06_3_CIBLE', cibleNom: 'UNIVA — DUT ZETA (2018-2020)' },            // DUT
      // Dossier d'école que le MOTEUR s'est créé le 23/08 à côté du précédent (c'est la MÊME
      // école, et `ecoleParNomReset_` envoie déjà ses marqueurs vers ce nœud). Marc n'a nommé que
      // prépa et cégep — c'est signalé dans l'ADR §3.5, pas fait en silence : c'est un dossier
      // d'école à la racine de `06`, donc exactement ce que sa première phrase demande de faire
      // disparaître.
      { src: 'FICTIF_MISSIONS_IDS_ECOLES06_4_SRC', cible: 'FICTIF_MISSIONS_IDS_ECOLES06_3_CIBLE', cibleNom: 'UNIVA — DUT ZETA (2018-2020)' },            // doublon moteur de l'école du DUT
      // `anciensNoms` (revue structure ADR-0060) : le 15/09 à 04:38, l'ancien code a re-pointé
      // l'entité du cégep vers le dossier VIDE `(2019)` qu'il venait de créer — la ligne du
      // référentiel ne porte plus la source, elle porte l'orphelin. La passe `c` doit AUSSI ramener
      // cet ID-là vers le dossier de Marc, sinon le flux (repli par entité) remplit `(2019)`.
      { src: 'FICTIF_MISSIONS_IDS_ECOLES06_5_SRC', cible: 'FICTIF_MISSIONS_IDS_ECOLES06_5_CIBLE', cibleNom: 'CEGEP - Valdor (2020)', anciensNoms: ['Cégep de Valdor (2019)'] }, // cégep → le dossier de Marc (ADR-0060)
      { src: 'FICTIF_MISSIONS_IDS_ECOLES06_6_SRC', cible: 'FICTIF_MISSIONS_IDS_ECOLES06_6_CIBLE', cibleNom: 'CORVIA — Ingénieur XSIR (2020-2023)' },     // école d'ingénieurs
    ],
    // ---- PR2 (Carrière + Finances, recon du 17/08) ----
    revenusPaie: 'FICTIF_MISSIONS_IDS_REVENUSPAIE',       // 02/« Revenus & paie » (cible paies, par employeur)
    employeurA: 'FICTIF_MISSIONS_IDS_EMPLOYEURA',  // 05/Employeurs/<1ᵉʳ employeur principal> (vrac plat à trier)
    employeurB: 'FICTIF_MISSIONS_IDS_EMPLOYEURB', // 05/Employeurs/<2ᵉ employeur principal>
    carriereRacine: 'FICTIF_DOMAINES_05_CARRIERE',     // racine 05 (ex-dump du 2ᵉ employeur principal)
    cvLettres: 'FICTIF_MISSIONS_IDS_CVLETTRES',          // 05/« CV & lettres » (CV, lettres, candidatures)
    employeurs05: 'FICTIF_MISSIONS_IDS_EMPLOYEURS05',       // 05/« Employeurs » (parent des employeurs principaux et d'« Autres employeurs »)
    rechercheEmploi: 'FICTIF_MISSIONS_IDS_RECHERCHEEMPLOI',    // 05/« Recherche d'emploi » — CIBLE du recrutement
    alternanceStages: 'FICTIF_MISSIONS_IDS_ALTERNANCESTAGES',   // 05/« Alternance & stages » — CIBLE (école, projets d'études)
    // (ADR-0044 D10, 2026-08-20) : ce dossier était DISSOUS vers « CV & lettres ». Marc a été
    // averti du conflit et a confirmé son choix de le RECRÉER — le geste est donc SYMÉTRIQUE :
    // la fusion est retirée de la mission ET de la table du flux, sinon ping-pong garanti.
    impotsDeclarations: 'FICTIF_MISSIONS_IDS_IMPOTSDECLARATIONS', // 02/« Impôts & déclarations » (par année)
    banques02: 'FICTIF_MISSIONS_IDS_BANQUES02',      // réservé PR3 (mission racines — routage bancaire)
    releves02: 'FICTIF_MISSIONS_IDS_RELEVES02',
    recusFactures02: 'FICTIF_MISSIONS_IDS_RECUSFACTURES02',
    assurances02: 'FICTIF_MISSIONS_IDS_ASSURANCES02',
    // Les 12 dossiers-années à VIDER (racine de 02) — l'année ACCOMPAGNE l'ID : c'est le repli
    // de routage des documents fiscaux dont le nom ne porte pas d'année.
    annees02: [
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_0_ID', annee: '2003' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_1_ID', annee: '2015' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_2_ID', annee: '2016' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_3_ID', annee: '2017' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_4_ID', annee: '2019' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_5_ID', annee: '2020' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_6_ID', annee: '2021' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_7_ID', annee: '2022' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_8_ID', annee: '2023' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_9_ID', annee: '2024' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_10_ID', annee: '2025' },
      { id: 'FICTIF_MISSIONS_IDS_ANNEES02_11_ID', annee: '2026' },
    ],
  },
  // Employeurs CANONIQUES (PR2) : nom du sous-dossier de « Revenus & paie » / d'« Employeurs » +
  // jetons d'appariement (MOT ENTIER, leçon C28-49). Un émetteur hors table = refus, jamais deviné.
  // ⚠️ COUPLAGE DE VERSIONS (revue structure-keeper PR2) : cette table est lue par les MISSIONS
  // (employeurDuNom_) ET par la table de routage du flux (cheminCibleReset_, branche paie) —
  // toute modification exige de bumper MISSIONS_REGLES_VERSION (ré-évaluer les refus keyés), et
  // RESET_TABLE_VERSION aussi si la campagne reset est relancée un jour (RESET_ACTIF).
  // Bornée ≤ 7 par test (enfants dynamiques de « Revenus & paie », jumeau RESET_PERSONNES_AUTRES).
  // ===== CORRECTIONS MANUELLES (C28-65) — « remets ces fichiers-là à cet endroit-là ».
  // Le seul mécanisme du projet qui déplace par IDENTITÉ plutôt que par règle. Il existe parce
  // qu'une règle ne peut PAS tout couvrir : sur les 4 conversations que la mission véhicule a
  // emportées à tort, 2 ne portent aucun mot de logement dans leur nom — seulement un nom de
  // personne. Marc SAIT de quoi elles parlent, le moteur non ; sa décision est donc déclarée ici,
  // fichier par fichier, avec la raison.
  // ⚠️ Ce mécanisme n'est PAS une porte dérobée : `moveTo` seul (jamais de suppression), zone
  // protégée re-vérifiée à la SOURCE **et** à la CIBLE avant chaque mutation, clé d'idempotence
  // par fichier, et un tag one-shot. Ajouter une entrée = une décision de Marc, jamais une
  // inférence — sinon c'est du classement déguisé, qui échappe à toutes les règles testées.
  CORRECTIONS_MANUELLES_TAG: 'corr-1',
  CORRECTIONS_MANUELLES: [
    // Les 4 conversations avec le propriétaire, parties dans « Véhicule/Recherche & achat » parce
    // qu'elles dormaient déjà dans « Véhicules/Recherche & achat » (décision Marc 2026-08-20 :
    // → `03 · Logement & véhicule/Correspondance`).
    { id: 'FICTIF_CORRECTIONS_MANUELLES_0_ID', cible: 'FICTIF_MISSIONS_IDS_CORRESPONDANCE03',
      quoi: 'SMS proprio — fuite bec de bain, plombier, visite appartement' },
    { id: 'FICTIF_CORRECTIONS_MANUELLES_1_ID', cible: 'FICTIF_MISSIONS_IDS_CORRESPONDANCE03',
      quoi: 'SMS propriétaire — visite appartement, coupure internet' },
    { id: 'FICTIF_CORRECTIONS_MANUELLES_2_ID', cible: 'FICTIF_MISSIONS_IDS_CORRESPONDANCE03',
      quoi: 'Conversation avec le propriétaire A (aucun mot de logement dans le nom)' },
    { id: 'FICTIF_CORRECTIONS_MANUELLES_3_ID', cible: 'FICTIF_MISSIONS_IDS_CORRESPONDANCE03',
      quoi: 'Conversation avec la gestionnaire B (aucun mot de logement dans le nom)' },
  ],

  // (ADR-0044 §7, décision 7) Les « dossiers-années » de 02 ne sont PAS fiscaux : ce sont des
  // fourre-tout. Chaque non-fiscal part vers son VRAI domaine. Cette table ne choisit QUE le
  // DOMAINE — le SOUS-CHEMIN est calculé par `cheminCibleReset_`, LA règle du flux vivant (contrainte
  // explicite de Marc : jamais une seconde formule ; la convergence est alors garantie PAR
  // CONSTRUCTION, pas asserée après coup). Le flux refuse ⇒ la mission refuse (clé versionnée,
  // révisable), jamais un dépôt à la racine du domaine d'arrivée.
  // `jetons` = MOT ENTIER ; `motifs` = sous-chaîne MULTI-MOTS (pour les noms sans sigle).
  // Prouvée sur les 24 fichiers RÉELS des 12 dossiers-années, jamais sur un échantillon.
  MISSIONS_ANNEES02_DOMAINES: [
    { domaine: '01 · Administratif & identité', jetons: ['boreale', 'fournisseury'], motifs: [],
      // ⚠️ « boreale mobile » N'EST PAS exclu : c'est bien un opérateur télécom, donc la bonne
      // cible. Ne sont exclues que les branches du groupe qui n'ont rien à voir. Les vrais noms
      // vivent dans le profil privé (tâche #587) ; le jeton ici est celui de `PARCOURS.fournisseurs.telecom`.
      exclusions: ['boreale atlantic', 'boreale radio', 'boreale megastore'] },
    { domaine: '05 · Carrière', jetons: ['mric', 'prigris'], motifs: ['statuts de societe civile', 'statuts de constitution', 'statuts constitutifs'] },
    { domaine: '07 · Santé', jetons: [], motifs: ['regime de sante etranger'] },
  ],
  MISSIONS_EMPLOYEURS: [
    { nom: 'Alphatek', jetons: ['alphatek'] },
    { nom: 'Betatek', jetons: ['betatek', 'robotek'] },
    { nom: 'Hopitalex', jetons: ['hopitalex'] },
    // Un 4ᵉ employeur ajouté le 2026-09-12 : Marc a demandé un dossier à son nom (note de démission).
    // Au CANON et pas dans « Autres employeurs » pour que ses éventuelles paies aillent dans
    // `02/Revenus & paie/<employeur>` plutôt que dans le commun — sinon le dossier de 05 et les paies de
    // 02 raconteraient deux histoires. Comme Hopitalex, il n'a pas d'ID de dossier sous 05 : le
    // routeur refuse (révisable) plutôt que de créer, et c'est l'épingle qui place LE document.
    { nom: 'Gammatek', jetons: ['gammatek'] },
  ],
  // Employeurs OCCASIONNELS, sans dossier à eux (ADR-0044 D11, décision Marc 2026-08-20 : « plutôt
  // qu'un dossier par nom à un seul fichier »). Ils partagent UN commun, des DEUX côtés :
  // `05/Employeurs/Autres employeurs` et, pour les PAIES, `02/Revenus & paie/Autres employeurs`.
  // ⚠️ C'est ce partage qui tient la règle des ≤ 7 enfants de « Revenus & paie » : 3 canoniques + 1
  // commun, au lieu de 3 + 5. Prouvés par les fichiers réels lus le 2026-08-20.
  MISSIONS_EMPLOYEURS_AUTRES: [
    // 🔴 Jetons MULTI-MOTS, et il le faut (revue code C28-62 PR2) : chacun des deux mots seul est
    // un mot courant — « Bilan_Orbite professionnelle » (un document d'accompagnement carrière,
    // dont le dossier `Formation & bilans` existe précisément) partait chez « Autres employeurs »,
    // à clé de SUCCÈS des deux côtés. Même collision qu'un jeton d'adresse contenu dans un mot
    // plus long (C28-49). `apparierUnique_` compare du texte normalisé espacé : un jeton
    // multi-mots y fonctionne tel quel, et DISCRIMINE.
    { nom: 'Algopaie', jetons: ['algopaie'] },
    { nom: 'Delta Crest', jetons: ['delta crest'] },
    { nom: 'Orbite-Emploi', jetons: ['orbite emploi'] },
  ],
  MISSIONS_EMPLOYEURS_COMMUN: 'Autres employeurs',
  // Bailleurs CANONIQUES (C28-51, ADR-0040 §2) : les documents de logement sont nommés par
  // BAILLEUR, jamais par adresse — chaque entrée est PROUVÉE par contenu (l'ADR porte la preuve
  // datée ; trois émetteurs aux noms différents peuvent être le MÊME bailleur). Le canon = le NOM
  // RÉEL du dossier sous « Logement » : résolu PAR NOM parmi
  // les cibles listées — dossier renommé ⇒ refus (jamais un doublon créé par la table).
  // Jetons MOT ENTIER (apparierUnique_) ; ambigu / hors table = refus, jamais deviné.
  // ASSUREURS et FOURNISSEURS d'énergie (décisions Marc, 2026-09-12 : « par assureur », « par
  // fournisseur »). Ces documents-là ne nomment AUCUN logement — ils dormaient à plat dans les
  // filets `03 · Assurance habitation` et `03 · Énergie & services` faute de règle. Le bucket est
  // créé SOUS le dossier filet lui-même (nœud pérenne, jamais peint en rouge) : le classement par
  // logement reste prioritaire, ceci n'est que le filet de second rang.
  // Jetons = MOT ENTIER (`apparierUnique_`), jamais une sous-chaîne : « muta » ne doit pas matcher
  // un mot plus long, et « fidelia-muta » est une graphie du même assureur.
  // ÉPINGLES — décisions prises FICHIER PAR FICHIER avec Marc (2026-09-12), par IDENTITÉ Drive et
  // non par règle : ces documents ne portent aucun signal généralisable, et une règle déduite de
  // trois cas en égarerait d'autres. Clé = fileId (stable), valeur = { cibleId } ou
  // { cibleParentId, cibleNom } + sousDossier optionnel. Une épingle prime sur toute règle.
  // ⚠️ Un fichier absent (supprimé, déplacé à la main) ne gêne rien : l'épingle ne s'applique que
  // si la collecte le présente encore.
  MISSIONS_EPINGLES: {
    // Les 3 documents « C26-08 » (notes d'automatisme, graphique d'expéditions, mémo de
    // maintenance) : documentation métier que la règle enverrait dans `_Technique` — Marc les veut
    // chez l'employeur concerné. La règle `_Technique` reste inchangée pour tout le reste.
    'FICTIF_MISSIONS_EPINGLES_CLE1': { cibleId: 'employeurA' },
    'FICTIF_MISSIONS_EPINGLES_CLE2': { cibleId: 'employeurA' },
    'FICTIF_MISSIONS_EPINGLES_CLE3': { cibleId: 'employeurA' },
    // Les 3 signatures détachées d'un notaire : ce n'est pas de la carrière — c'est un
    // virement familial passé devant avocat (réponse de Marc, 2026-09-12). Rien dans le fichier ne
    // le disait : 1,4 ko de PKCS#7, aucun texte. D'où l'épingle plutôt qu'une règle.
    // ⚠️ Marc avait dit « 02 · Finances / Donation » ; ce N'EST PAS ce qui est codé, et c'est
    // volontaire : `02 · Finances` est PLEIN (7/7, docs/TAXONOMY.md — contrainte ≤ 7 non
    // négociable, ADR-0027), le nœud « Donations & successions » y a justement été RETIRÉ le
    // 2026-07-30, et la taxonomie tranche déjà ce cas : versant FISCAL → `02/Impôts &
    // déclarations`, versant NOTARIAL (les actes, donc ces signatures) → `01/État civil &
    // notarial`, qui existe dans la structure cible. Créer « Donation » aurait fait 8 nœuds dans
    // 02, hors table — donc invisible du test ≤ 7 et proposable à la corbeille par la Réorg.
    'FICTIF_MISSIONS_EPINGLES_CLE4': { cibleParentId: 'domaine:01 · Administratif & identité', cibleNom: 'État civil & notarial' },
    'FICTIF_MISSIONS_EPINGLES_CLE5': { cibleParentId: 'domaine:01 · Administratif & identité', cibleNom: 'État civil & notarial' },
    'FICTIF_MISSIONS_EPINGLES_CLE6': { cibleParentId: 'domaine:01 · Administratif & identité', cibleNom: 'État civil & notarial' },
    // Déductions tirées du CONTENU et validées par Marc : projet d'études (sprint Scrum en équipe,
    // Java/C/SQL/Web) et documents d'école → « Alternance & stages ».
    'FICTIF_MISSIONS_EPINGLES_CLE7': { cibleId: 'alternanceStages' }, // planning de sprint d'un stage
    'FICTIF_MISSIONS_EPINGLES_CLE8': { cibleId: 'alternanceStages' }, // lettre de recommandation de l'école d'ingénieurs
    'FICTIF_MISSIONS_EPINGLES_CLE9': { cibleId: 'alternanceStages' }, // invitation d'un professeur de l'école d'ingénieurs
    // Recrutement (test de personnalité passé en entretien, prospection d'employeurs).
    'FICTIF_MISSIONS_EPINGLES_CLE10': { cibleId: 'rechercheEmploi' },  // questionnaire d'un test de personnalité
    'FICTIF_MISSIONS_EPINGLES_CLE11': { cibleId: 'rechercheEmploi' },  // prospection employeurs
    // Note manuscrite « raisons de démission » : Marc veut un dossier à ce nom d'employeur (réponse
    // du 2026-09-12). Pour que ce ne soit pas un dossier ORPHELIN à un seul fichier — ce que la
    // règle ADR-0044 D11 refuse — son nom est AUSSI ajouté au canon des employeurs ci-dessus :
    // les prochains documents y tomberont par la règle, sans épingle.
    'FICTIF_MISSIONS_EPINGLES_CLE12': { cibleParentId: 'employeurs05', cibleNom: 'Gammatek' },
  },
  // Assureurs d'habitation : valeurs FICTIVES ; les vrais noms vivent dans le profil privé (docs/PROFIL-PRIVE.md).
  MISSIONS_ASSUREURS: [
    { bucket: 'Bellerives', jetons: ['bellerives'] },
    { bucket: 'MUTA', jetons: ['muta', 'fidelia'] },
  ],
  MISSIONS_FOURNISSEURS_ENERGIE: [
    { bucket: 'Hydro-Québec', jetons: ['hydro'] }, // `normaliserMission_` réduit à [a-z0-9] espacés :
                                                  // un jeton accentué ou tireté ne matcherait jamais.
    { bucket: 'Energie Aurore', jetons: ['aurore'] }, // valeur FICTIVE ; la vraie vit dans le profil privé (tâche #587)
  ],
  MISSIONS_BAILLEURS: [
    // Une graphie de plus du même bailleur (réponse de Marc, 2026-08-20) : range d'un coup son DPA
    // et ses 2 formulaires de demande de location, jusqu'ici bloqués faute d'adresse connue
    // (ADR-0044 §7.3). L'agence et le propriétaire du 1ᵉʳ logement ont été ajoutés le 2026-09-12
    // (réponses de Marc) : 3 captures de correspondance bloquées faute d'adresse dans le nom.
    { logement: '1201 rue Exemple Alpha', jetons: ['alphaimmo', '9111', '2222', 'pinard', 'xa8', 'gestimax', 'verlaine'] },
    // La gestionnaire du 2ᵉ logement, ajoutée le 2026-09-12 (réponse de Marc).
    { logement: '1202 rte Fictive Rivage', jetons: ['9333', '4444', 'prouvet'] },
    { logement: '1203 av. Exemple Lisiere, Québec', jetons: ['sauvage', 'ayette'] },
    { logement: 'Anciens logements', jetons: ['rette', 'tuoloinen', 'villeneuve'] },
  ],
  // Véhicules CANONIQUES (C28-51, ADR-0040 §3a — décision Marc : un dossier PAR véhicule, les
  // catégories DEDANS). Jetons = le MODÈLE, JAMAIS la marque : « marquec » matcherait le modèle
  // 2014 (essai, jamais achetée — décision Marc) vers le bZ, la marque du 2ᵉ véhicule enverrait la
  // capture d'annonce d'un CONCESSIONNAIRE dans son dossier — à clé de SUCCÈS, donc définitif (leçon C28-49).
  // Sert AUSSI à créer une cible absente (Marqued n'existait pas dans « Véhicule »).
  // ⚠️ Marqued RETIRÉ le 19/08 (ADR-0044, décision du propriétaire : une simple recherche d'achat).
  MISSIONS_VEHICULES: [
    { nom: 'Marquec Modelc', jetons: ['modelc', 'modelcx'] },
    { nom: 'Ford Modela', jetons: ['modela'] },
    { nom: 'VW Modelb', jetons: ['modelb'],
      sousDossiers: { achatEntretien: 'Achat, immatriculation & entretien', assuranceSinistres: 'Assurance & sinistres' } },
  ],
  // Dossiers COMMUNS sous « Véhicule » (ADR-0044) — au même niveau que les véhicules, pas sous eux.
  //  - `sources` : sous-dossiers d'origine dont le contenu y va EN BLOC ;
  //  - `jetons`  : MOT ENTIER dans le nom du document (`communVehiculeDuNom_`), consulté par le
  //    FLUX VIVANT *et* par les missions — une seule règle, N consommateurs. Sans les jetons, un
  //    document « Marqued » arrivant par le flux tombait à PLAT à la racine de `03` (revue C28-62).
  // « À attribuer » (décision Marc 2026-08-20) remplace le repli par DATE, retiré : mesuré sur le
  // Drive réel, les fenêtres dérivées des fichiers déjà classés sont INUTILISABLES ici — le 1ᵉʳ
  // véhicule est VIDE (aucune date ⇒ aucune fenêtre ⇒ la gate de complétude ne peut PAS être
  // satisfaite) et celle du 2ᵉ court de 2019 à 2026. Grouper sans deviner plutôt que
  // deviner mal : les documents sans véhicule identifiable attendent là que Marc les réparte.
  MISSIONS_VEHICULE_COMMUNS: [
    { nom: 'Recherche & achat', sources: ['Marqued'], jetons: ['marqued', 'modeled'] }, // `modeled` : jeton de l'ex-entrée Marqued du canon — le PERDRE renvoyait « Garage Modeled » à plat dans 03 (revue C28-62)
    { nom: 'Locations', sources: [], jetons: [] },   // alimenté par la DÉTECTION de location
    { nom: 'À attribuer', sources: [], jetons: [] }, // filet : aucun véhicule identifiable
  ],
  // Catégories PAR VÉHICULE (décision Marc) — sous-dossiers créés À LA DEMANDE, jamais 16
  // squelettes vides. Ces noms sont AUSSI les sous-dossiers sources de « Véhicules » à dissoudre.
  MISSIONS_CATEGORIES_VEHICULE: ['Contraventions', 'Assurance auto', 'Entretien & réparations', 'Recherche & achat'],

  // ===== PARCOURS — le vocabulaire PERSONNEL du propriétaire (noms de personnes, d'employeurs,
  // d'adresses, d'écoles). Les valeurs ci-dessous sont FICTIVES : les vraies vivent dans le profil
  // privé (`driveai-profil-prive.json`, docs/PROFIL-PRIVE.md) et remplacent ce bloc au chargement.
  // Le code ne contient aucun de ces noms : il lit CE bloc, à l'APPEL (jamais au chargement d'un
  // fichier — l'ordre de chargement face à `Config.gs` n'est pas garanti).
  // ⚠️ Un tableau du profil REMPLACE le tableau d'ici en bloc : le profil doit donc fournir chaque
  // liste ENTIÈRE. Les noms de dossier sont comparés au caractère près (`getFoldersByName` est
  // sensible à la casse) : ils doivent être ceux du Drive.
  PARCOURS: {
    // Le propriétaire. `prenom` + `nom` = ce qui désigne SA pièce d'identité ; `autresPrenoms` =
    // ses autres prénoms d'usage (jamais une entité/émetteur d'un document d'organisation).
    titulaire: { prenom: 'Marc', nom: 'Exemple', autresPrenoms: ['alex', 'dominique'] },
    // Proches dont la pièce d'identité va dans `Pièces d'identité/Autres/<libellé>`. Clé = nom
    // normalisé (minuscules, sans accents), valeur = libellé du dossier. Liste EXPLICITE, jamais devinée.
    personnesAutres: {
      'lise modele': 'Lise Modèle',
      'paul echantillon': 'Paul ECHANTILLON',
      'anna specimen': 'Anna Specimen',
    },
    // Les employeurs qui ont un dossier sous `05/Employeurs`. `marqueur` = sous-chaîne (sans
    // accents, minuscules) cherchée dans l'ÉMETTEUR. L'ORDRE est celui des ID `employeurA`, `employeurB`.
    employeursNoeuds: [
      { nom: 'Alphatek', marqueur: 'alphatek' },
      { nom: 'Betatek', marqueur: 'betatek' },
    ],
    // Corruptions OCR récurrentes d'un nom d'employeur → forme canonique (clé = nom normalisé).
    correctionsOcr: { 'tatek robotek': 'Betatek', 'betatek robotek': 'Betatek' },
    // Les logements : `noeud` = nom EXACT du dossier sous `03/Logement` ; `mots` = mots ENTIERS et
    // `motifs` = sous-chaînes (normalisés) qui désignent ce logement dans un nom de fichier.
    // Doit rester ÉGAL aux noms de `MISSIONS_BAILLEURS` (tripwire de test).
    logements: [
      { noeud: '1204 avenue Fictive Prairie, Québec', mots: ['prairie'], motifs: [] },
      { noeud: '1202 rte Fictive Rivage', mots: ['rivage'], motifs: [] },
      { noeud: '1201 rue Exemple Alpha', mots: ['1201'], motifs: ['exemple alpha'] },
      { noeud: '1203 av. Exemple Lisiere, Québec', mots: ['lisiere'], motifs: [] },
    ],
    // Mots ENTIERS qui désignent un logement ANCIEN (dossier `Anciens logements`).
    anciensLogementsMots: ['villeancienne'],
    // Les écoles de `06/Archives scolaires`, dans l'ordre chronologique. `libelle` = nom EXACT du
    // dossier ; `brut` = nœud déclaré SANS sous-dossier ; `concours` = reçoit en plus « Concours » ;
    // `thematiques` = sous-dossiers que Marc a créés lui-même ; `fenetre` = [année, mois, année,
    // mois] de scolarité (septembre → août) ou null ; `exemptionPlafond` = dépasse 7 enfants, et
    // le dépassement est DÉCLARÉ.
    ecoles: [
      { cle: 'college', libelle: 'Collège & Lycée — divers (2014-2018)', fenetre: [2014, 9, 2017, 8] },
      { cle: 'lycee', libelle: 'Lycée — Gustave Delta — Physique-Chimie (TP)', brut: true },
      { cle: 'prepa', libelle: 'Prépa Alpha (2017-2018)', concours: true, fenetre: [2017, 9, 2018, 8] },
      { cle: 'dut', libelle: 'UNIVA — DUT ZETA (2018-2020)', thematiques: ['ZETA 1 (2018-2019)', 'ZETA 2 (2019-2020)'], fenetre: [2018, 9, 2020, 8] },
      { cle: 'cegep', libelle: 'CEGEP - Valdor (2020)', brut: true, fenetre: [2019, 1, 2019, 12] },
      { cle: 'ingenieur', libelle: 'CORVIA — Ingénieur XSIR (2020-2023)', fenetre: [2020, 9, 2023, 8], exemptionPlafond: true,
        thematiques: ['Mémoire de fin d\'études', 'Génie logiciel', 'Algorithmique', 'Réseaux', 'Automatique',
          'Modélisation 2D', 'Sécurité des échanges', 'Stage Zetaco', 'Échange international',
          'Projet Java', 'Anglais', 'Robotique'] },
    ],
    // Marqueurs de NOM (normalisés, sans accents) qui désignent chaque école dans un nom de fichier.
    // Testés dans l'ordre de `ecoleParNomReset_`. `filiere` = mot de la filière du DUT (« zeta »,
    // « zeta 1 », « zeta2 »).
    marqueursEcole: {
      college: ['collegea', 'lyceea'],
      autresAvant: ['college', 'maisonx'],
      prepa: ['gustave delta', 'prepalpha', 'kholle', ' colles', 'concours avenir', 'profuno', 'prof deux', 'profrois', 'profquatre', 'profcinq'],
      dut: ['iut', 'univa', 'plateau', 'saint orme', 'cote d argent'],
      cegep: ['valdor'],
      ingenieur: ['corvia'],
      autresApres: ['saint fictif', 'hamx', 'hamy', 'ecolex', 'ecoley', 'campusz', 'ecolew', 'villex', 'maisonx', 'lyceev', 'villey', 'academiex', 'centrex'],
      filiere: ['zeta'],
    },
    // Entités validées d'office au seed (`seedEntitesMarc_`) : libellés en forme CANONIQUE.
    seedEntites: [
      { domaine: '03 · Logement & véhicule', entite: '1201 Rue Exemple Alpha' },
      { domaine: '03 · Logement & véhicule', entite: '1203 Avenue Exemple Lisiere' },
      { domaine: '03 · Logement & véhicule', entite: '1202 Route Fictive Rivage' },
      { domaine: '03 · Logement & véhicule', entite: '1204 Avenue Fictive Prairie' },
      { domaine: '03 · Logement & véhicule', entite: 'Ford Modela' },
      { domaine: '03 · Logement & véhicule', entite: 'VW Modelb' },
      { domaine: '03 · Logement & véhicule', entite: 'Marquec Modelc' },
      { domaine: '05 · Carrière', entite: 'Betatek' },
      { domaine: '05 · Carrière', entite: 'Alphatek' },
      { domaine: '06 · Études & diplômes', entite: 'Lycée Lyceea' },
      { domaine: '06 · Études & diplômes', entite: 'Lycée Delta' },
      { domaine: '06 · Études & diplômes', entite: 'IUT Du Plateau' },
      { domaine: '06 · Études & diplômes', entite: 'Cégep De Valdor' },
      { domaine: '06 · Études & diplômes', entite: 'CORVIA' },
      { domaine: '06 · Études & diplômes', entite: 'HAMX' },
    ],
    // La FINANCE du propriétaire (banques, assureurs) : noms FICTIFS ici, les vrais dans le profil privé
    // (tâche #578, `PROFIL_VERSION` 3). Même règle que le reste de `PARCOURS` : un tableau du profil
    // REMPLACE celui d'ici en bloc, et un `dossier` est comparé au caractère près à celui du Drive.
    finance: {
      // Les banques qui ont un dossier sous `02/Banques`. `jetons` = SOUS-CHAÎNES (normalisées, sans accents)
      // cherchées dans l'ÉMETTEUR ; l'ORDRE est celui des tests de `cheminCibleReset_`.
      banques: [
        { dossier: 'Bellerives', jetons: ['bellerives'] },
        { dossier: 'Bourselune', jetons: ['bourselune'] },
        { dossier: 'Banque Transpolaire', jetons: ['transpolaire'] },
        { dossier: 'CMF', jetons: ['cmf', 'credit mondial'] },
      ],
      // Émetteurs bancaires étrangers regroupés sous `02/Banques/Banques France` (sous-chaînes normalisées).
      banquesFrance: ['societe federale', 'banque de riviere', 'banque marnex', 'bcque', 'banque 10099'],
      // L'assureur dont les contrats vivent sous `03/Contrats & fournisseurs/<dossier>` (jetons : sous-chaînes).
      assureurContrats: { dossier: 'Fidelia-MUTA', jetons: ['muta'] },
      // Jetons d'émetteur (sous-chaînes) qui désignent un assureur AUTO / un assureur VOYAGE.
      assureursAuto: ['igo', 'assureurx'],
      assureursVoyage: ['assureurx'],
    },
    // Les fournisseurs d'ÉNERGIE et de TÉLÉPHONE du propriétaire : noms FICTIFS ici, les vrais dans le profil privé
    // (tâche #587, `PROFIL_VERSION` 4 ; `energieAnciens` ajouté en version 5, tâche #468). `energieContrats` : le dossier de `03/Contrats & fournisseurs` d'un fournisseur
    // d'énergie ; `telecom` : celui de l'opérateur télécom (ses `exclusions` sont dans `MISSIONS_ANNEES02_DOMAINES`, UNE table,
    // lue par la mission ET par le flux). `jetons` = SOUS-CHAÎNES normalisées cherchées dans l'ÉMETTEUR. Un tableau du profil
    // REMPLACE celui d'ici en bloc, et un `dossier` est comparé au caractère près à celui du Drive.
    fournisseurs: {
      energieContrats: { dossier: 'Energie Aurore', jetons: ['aurore'] },
      telecom: { dossier: 'Mobile Boreale', jetons: ['boreale'] },
      // Le fournisseur d'énergie dont le dossier de `03/Contrats & fournisseurs` est resté à part (tâche #468 : son nom réel
      // n'est plus codé en dur). Ses `jetons` rejoignent ceux de l'énergie dans le flux de reset.
      energieAnciens: { dossier: 'Zephyr', jetons: ['zephyr'] },
    },
    // Mots génériques d'ENTITÉ propres au propriétaire (version 6, tâche #468) : ils s'ajoutent au lexique
    // fixe de `Entites.gs` (jamais une entité à proposer). Tableau du profil = REMPLACE celui d'ici.
    lexiqueEntites: ['prepalpha'],
    // Les véhicules : `marques` = premier mot (normalisé) d'un nom qui désigne un véhicule ; `alias` = marque
    // → forme courte du dossier (« marquee Modelb » → « VW Modelb ») ; `cibleIsole` = le dossier de
    // `Véhicule` que reçoit en bloc le dossier isolé `vehiculeIsole` (doit être ÉGAL à un nom de `MISSIONS_VEHICULES`).
    // Le profil doit mettre `"$remplace": true` dans `alias` (clés inconnues d'ici sinon ignorées).
    vehicules: {
      marques: ['ford', 'marquex', 'marquec', 'marquee', 'vw', 'mazda', 'marqued', 'yamaha',
        'nissan', 'hyundai', 'chevrolet', 'bmw', 'audi', 'mercedes', 'peugeot', 'renault', 'citroen',
        'fiat', 'jeep', 'dodge', 'ram', 'gmc', 'subaru', 'lexus', 'acura', 'volvo', 'tesla'],
      alias: { marquee: 'VW' },
      cibleIsole: 'Marquec Modelc',
    },
    // Règles du RESET (`cheminCibleReset_`) propres au propriétaire (version 6, tâche #468). Les noms ci-dessous
    // sont FICTIFS ; les vrais vivent dans le profil privé. Un tableau du profil REMPLACE celui d'ici en bloc.
    //  - `fournisseurAutre` : un fournisseur de `03/Contrats & fournisseurs` (`jetons` = sous-chaînes d'ÉMETTEUR) ;
    //  - `projetPerso` : un dossier sous `08/Projets`, en plus de « DriveAI » (`motifs` = sous-chaînes du nom) ;
    //  - `santeEtrangere` : motifs multi-mots d'un régime de santé étranger (toujours « Assurances santé », jamais du fiscal) ;
    //  - `feuilletsFiscaux` : MOTS ENTIERS d'un feuillet fiscal (jamais un relevé de compte) ;
    //  - `courtiers` : MOTS ENTIERS d'un courtier (« Placements & crypto ») ;
    //  - `hopitaux` : motifs d'un hôpital ou centre de santé, en plus des mots génériques ;
    //  - `voyagesSupp` : motifs qui s'ajoutent aux mots du dossier `Par voyage/<dossier>` (le dossier existe déjà dans l'arbre).
    reset: {
      fournisseurAutre: { dossier: 'Fournisseur Y', jetons: ['fournisseury'] },
      projetPerso: { dossier: 'Projet C', motifs: ['projet c'] },
      santeEtrangere: ['regime de sante etranger'],
      feuilletsFiscaux: ['t9999'],
      courtiers: ['courtierx'],
      hopitaux: ['hopitalex'],
      voyagesSupp: [{ dossier: 'Finlande', motifs: ['transporteurz'] }],
    },
  },

  // Schémas de sous-dossiers FIXES créés à la validation d'une entité (docs/TAXONOMY.md).
  // Clé = Type d'entité ; valeur = liste ordonnée de sous-dossiers.
  SCHEMAS_ENTITE: {
    'Logement': ['Bail & contrat', 'Factures', 'Assurance', 'État des lieux & photos', 'Correspondance'],
    'Véhicule': ['Achat & financement', 'Assurance', 'Entretien & réparations', 'Immatriculation (SAAQ)'],
    'Compte financier': ['Relevés', 'Contrats & produits', 'Correspondance'],
    'Diplôme': ['Diplôme & attestation', 'Relevés de notes', 'Mémoire & travaux']
  },

  // Sous-dossiers d'entité à découper PAR ANNÉE (fort volume).
  SOUS_DOSSIERS_PAR_ANNEE: ['Factures', 'Relevés'],

  // Aiguillage type_doc → sous-dossier d'entité (heuristique ; sinon racine d'entité).
  // Clés en minuscules sans accents (cf. normaliserCle_).
  SOUS_DOSSIER_PAR_TYPE: {
    'facture': 'Factures',
    'releve': 'Relevés',
    'bail': 'Bail & contrat',
    'contrat': 'Bail & contrat',
    'assurance': 'Assurance',
    'etat des lieux': 'État des lieux & photos',
    'entretien': 'Entretien & réparations',
    'reparation': 'Entretien & réparations',
    'immatriculation': 'Immatriculation (SAAQ)',
    'diplome': 'Diplôme & attestation',
    'attestation': 'Diplôme & attestation',
    'releve de notes': 'Relevés de notes',
    'bulletin': 'Relevés de notes',
    'memoire': 'Mémoire & travaux'
  },

  // Les deux classeurs d'état de l'incident du 2026-07-08, pour `reparerIncidentSheet` (Maintenance.gs).
  // Valeurs réelles dans le profil privé : ce sont des identifiants de fichiers du Drive.
  INCIDENT_SHEET: {
    ancienne: 'FICTIF_INCIDENT_SHEET_ANCIENNE',
    nouvelle: 'FICTIF_INCIDENT_SHEET_NOUVELLE'
  }
};

/* ---------- Profil privé : les valeurs propres au Drive de Marc, hors du dépôt (#497, #515) ----------
 * Ce fichier ne porte que des VALEURS FICTIVES (`FICTIF_…`) : un identifiant de dossier Drive, c'est
 * la carte de son Drive. Les vraies valeurs vivent dans un fichier JSON du Drive du propriétaire,
 * désigné par la Script Property `DriveAI_PROFIL_ID` (un identifiant seul : une Script Property est
 * plafonnée à 9 Ko) ou, à défaut, trouvé par son NOM dans le Drive de l'utilisateur du script
 * (`trouverFichierProfil_`) : aucun geste dans l'éditeur n'est requis. Même schéma que `CONFIG`, partiel : seules les
 * clés présentes dans le profil et déjà présentes dans `CONFIG` sont superposées, au chargement,
 * avant tout autre fichier. Un objet marqué `"$remplace": true` remplace l'objet de `CONFIG` en bloc
 * (utile quand ce sont les CLÉS qui sont des identifiants). Mode d'emploi : docs/PROFIL-PRIVE.md.
 * ÉCHEC FERMÉ : profil absent ou illisible ⇒ les valeurs fictives restent, `tickDriveAI` refuse de
 * tourner et la Santé le dit. Jamais de repli sur d'autres valeurs, jamais de contenu journalisé. */
var PROFIL_PRIVE_PROP = 'DriveAI_PROFIL_ID';
var PROFIL_PRIVE_NOM = 'driveai-profil-prive.json';
var PROFIL_PRIVE_CACHE = 'DriveAI_PROFIL_PRIVE';
var PROFIL_PRIVE_CACHE_S = 300;   // un profil modifié est vu au plus 5 min plus tard ; seuls les SUCCÈS sont mis en cache

/** Type JSON d'une valeur (distingue tableau et null). PUR. */
function typeProfil_(v) {
  return Array.isArray(v) ? 'tableau' : v === null ? 'nul' : typeof v === 'object' ? 'objet' : typeof v;
}

/**
 * Superpose `profil` à `cible` (modifiée en place), clé par clé. PUR (aucune I/O, aucun texte de
 * valeur dans le rapport : seulement des chemins). Une clé absente de `cible`, ou de type différent,
 * est IGNORÉE et listée — le profil ne peut ni ajouter de réglage ni en changer la nature.
 * @return {{appliques:number, ignores:string[]}} le `rapport` passé en paramètre
 */
function fusionnerProfil_(cible, profil, chemin, rapport) {
  Object.keys(profil).forEach(function (k) {
    if (k === '$remplace') return;
    var ici = chemin ? chemin + '.' + k : k;
    if (!Object.prototype.hasOwnProperty.call(cible, k)) { rapport.ignores.push(ici); return; }
    var a = cible[k];
    var b = profil[k];
    var t = typeProfil_(a);
    if (t !== typeProfil_(b)) { rapport.ignores.push(ici); return; }
    if (t === 'objet') {
      if (b.$remplace === true) {
        var copie = JSON.parse(JSON.stringify(b));
        delete copie.$remplace;
        cible[k] = copie;
        rapport.appliques++;
      } else {
        fusionnerProfil_(a, b, ici, rapport);
      }
    } else {
      cible[k] = b;
      rapport.appliques++;
    }
  });
  return rapport;
}

/**
 * Lit le profil privé (I/O). Ne lève JAMAIS : le chargement de ce fichier ne doit pas casser tout le
 * moteur. @return {{etat:'ok'|'absent'|'illisible', profil:?Object, raison:string}}
 */
/**
 * Où est le fichier du profil ? 1) la Script Property `DriveAI_PROFIL_ID`, si elle existe (priorité) ;
 * 2) sinon, par son NOM (`PROFIL_PRIVE_NOM`) dans le Drive de l'utilisateur du script, ce qui évite
 * tout geste dans l'éditeur (les propriétés y sont parfois grisées). Défense : seul un fichier dont le
 * PROPRIÉTAIRE est l'utilisateur du script compte (un fichier du même nom partagé par un tiers est
 * ignoré), et deux candidats valent un refus plutôt qu'un choix au hasard.
 * @return {{etat:string, raison:string, fichier:?Object}} `absent` = aucun candidat, `illisible` = ambigu.
 */
function trouverFichierProfil_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROFIL_PRIVE_PROP);
  if (id) return { etat: 'ok', raison: '', fichier: DriveApp.getFileById(id) };
  // L'utilisateur du script = propriétaire de la racine de SON Drive. `Session.getEffectiveUser()` exigerait
  // l'autorisation `userinfo.email`, absente de appsscript.json (et en ajouter une obligerait à ré-autoriser).
  var moi = String(DriveApp.getRootFolder().getOwner().getEmail() || '').toLowerCase();
  var it = DriveApp.getFilesByName(PROFIL_PRIVE_NOM);
  var candidats = [];
  while (it.hasNext()) {
    var f = it.next();
    var proprio = f.getOwner();
    if (f.isTrashed() || !proprio || !moi || String(proprio.getEmail() || '').toLowerCase() !== moi) continue;
    candidats.push(f);
  }
  if (candidats.length === 0) return { etat: 'absent', raison: '', fichier: null };
  if (candidats.length > 1) return { etat: 'illisible', raison: candidats.length + ' fichiers « ' + PROFIL_PRIVE_NOM + ' » à vous : en garder un seul', fichier: null };
  return { etat: 'ok', raison: '', fichier: candidats[0] };
}

function lireProfilPrive_() {
  try {
    var cache = null;
    var texte = null;
    try { cache = CacheService.getScriptCache(); texte = cache.get(PROFIL_PRIVE_CACHE); } catch (e) { cache = null; }
    var duCache = !!texte;
    if (!texte) {
      var fichier = trouverFichierProfil_();
      if (fichier.etat !== 'ok') return { etat: fichier.etat, profil: null, raison: fichier.raison };
      texte = fichier.fichier.getBlob().getDataAsString();
    }
    var profil = JSON.parse(texte);
    if (typeProfil_(profil) !== 'objet') {
      return { etat: 'illisible', profil: null, raison: 'le profil n\'est pas un objet JSON' };
    }
    if (cache && !duCache) { try { cache.put(PROFIL_PRIVE_CACHE, texte, PROFIL_PRIVE_CACHE_S); } catch (e) { /* trop gros : on relira */ } }
    return { etat: 'ok', profil: profil, raison: '' };
  } catch (e) {
    return { etat: 'illisible', profil: null, raison: String(e && e.message ? e.message : e).slice(0, 200) };
  }
}

/**
 * Version du schéma de profil que ce code exige. Le profil la déclare (`"PROFIL_VERSION": 6`) pour
 * dire « j'ai TOUS les blocs » : sans elle, un profil écrit pour une version plus ancienne laisserait
 * les valeurs FICTIVES des blocs récents (`PARCOURS`, `MISSIONS_*`…) et le moteur rangerait sur des
 * noms qui n'existent pas. Une valeur fictive silencieusement active est pire qu'un tick sauté.
 * À incrémenter chaque fois qu'un bloc réel devient obligatoire ; docs/PROFIL-PRIVE.md.
 */
var PROFIL_VERSION_ATTENDUE = 6;

/** Applique le profil à `CONFIG` au chargement. @return {{etat:string, raison:string, appliques:number, ignores:string[]}} */
function appliquerProfilPrive_() {
  var lu = lireProfilPrive_();
  if (lu.etat !== 'ok') return { etat: lu.etat, raison: lu.raison, appliques: 0, ignores: [] };
  var r = fusionnerProfil_(CONFIG, lu.profil, '', { appliques: 0, ignores: [] });
  if (CONFIG.PROFIL_VERSION !== PROFIL_VERSION_ATTENDUE) {
    // Échec fermé : même effet qu'un profil absent (tick sauté, `gardes-app` refuse), mais la raison dit quoi faire.
    return { etat: 'incomplet', raison: 'profil de version ' + CONFIG.PROFIL_VERSION + ', ce code exige la version ' + PROFIL_VERSION_ATTENDUE + ' (blocs récents manquants : voir docs/PROFIL-PRIVE.md)', appliques: r.appliques, ignores: r.ignores };
  }
  return { etat: 'ok', raison: '', appliques: r.appliques, ignores: r.ignores };
}

var PROFIL_PRIVE_ETAT = appliquerProfilPrive_();

/** État du profil pour `tickDriveAI` et la Santé : jamais de contenu, seulement l'état et des chemins. */
function etatProfilPrive_() {
  return PROFIL_PRIVE_ETAT;
}

/** Liste des domaines autorisés (pour le prompt et la validation) : les 7 fixes + les auto-créés.
 *  Triée (préfixes `NN ·` → ordre 01→08) pour un prompt LLM lisible, même avec les domaines auto. */
function domainesAutorises_() {
  return Object.keys(CONFIG.DOMAINES).concat(CONFIG.DOMAINES_AUTO || []).sort();
}

/**
 * Garde-temps effectif du run : abaissé quand un document du tick peut passer par le pipeline
 * Sonnet ×2 (documents bien plus longs) pour tenir le mur dur des 6 min avec de la marge
 * (ADR-0015). Couvre `ANALYSE_V2` (flux vivant), `DRYRUN_V2_ACTIF` (C26-07) ET `DRYRUN_CMP_ACTIF`
 * (comparaison 1↔2 passes, ADR-0034) : ces campagnes exécutent EXACTEMENT le même pipeline lourd
 * (Sonnet ×2) alors qu'`ANALYSE_V2` reste ÉTEINT par construction (interrupteurs dédiés) — sans ce
 * OU, elles tourneraient avec le budget calibré Haiku (270 s) au lieu des 180 s prévus pour ce
 * coût-temps, revue llm-cost-optimizer #26. Haiku seul (aucun ON) → budget nominal. PUR.
 * @return {number} millisecondes
 */
function budgetMsRun_() {
  return (CONFIG.ANALYSE_V2 || CONFIG.DRYRUN_V2_ACTIF || CONFIG.DRYRUN_CMP_ACTIF)
    ? CONFIG.ANALYSE_V2_BUDGET_MS : CONFIG.BUDGET_MS;
}

/** Catégories connues (Phase 1), pour borner la sortie du LLM. */
function categoriesConnues_() {
  var noms = [];
  Object.keys(CONFIG.CATEGORIES).forEach(function (dom) {
    Object.keys(CONFIG.CATEGORIES[dom]).forEach(function (c) {
      if (noms.indexOf(c) === -1) noms.push(c);
    });
  });
  return noms;
}

/**
 * Réglages de requête de la génération 5.5, ajoutés au corps d'un appel. PURE (testée) : le corps
 * passé est complété et rendu, jamais copié.
 *
 * ⚠️ Ce que la 5.5 change, et pourquoi chaque ligne est là :
 *  - `temperature`, `top_p`, `top_k`, `budget_tokens` sont REJETÉS (400) : aucun appel n'en envoie.
 *  - la réflexion est ACTIVE par défaut et se paie sur `max_tokens` : sur un appel court (classement
 *    à 400 jetons, mini-check à 40) elle mangerait la réponse, qui sortirait tronquée, donc invalide.
 *  - Haiku 5.5 accepte `thinking:{type:'disabled'}` ; Sonnet 5.5 le REFUSE (400) : `between_tools`
 *    ne réfléchit qu'entre deux outils, donc jamais sur un appel sans outil.
 *  - `effort` borne ce qui reste : `low` pour lire/classer avec Haiku, `medium` avec Sonnet.
 * Un modèle hors 5.5 ne reçoit rien (jamais un champ qu'il ne connaît pas). Le 3ᵉ paramètre `chat`
 * (le chat gardait la réflexion pour enchaîner des outils) est parti avec le chat, ADR-0074.
 * @param {Object} corps
 * @param {string} modele
 * @return {Object} le même corps
 */
function avecReglages_(corps, modele) {
  var m = String(modele);
  if (m.indexOf('haiku-5-5') !== -1) {
    corps.thinking = { type: 'disabled' };
    corps.output_config = { effort: 'low' };
  } else if (m.indexOf('sonnet-5-5') !== -1) {
    corps.thinking = { type: 'between_tools' };
    corps.output_config = { effort: 'medium' };
  }
  return corps;
}

/**
 * Clé API Anthropic — lue depuis les Script Properties, jamais en dur.
 * @return {string}
 */
function getCleAnthropic_() {
  var cle = PropertiesService.getScriptProperties().getProperty('DriveAI_ANTHROPIC_KEY');
  if (!cle) {
    throw new Error('Clé API absente : définis DriveAI_ANTHROPIC_KEY dans les Script Properties.');
  }
  return cle;
}

/** Vrai pour un identifiant de modèle Gemini (ADR-0073). PURE. */
function estModeleGemini_(modele) {
  return /^gemini-/.test(String(modele));
}

/**
 * Valeur de l'en-tête `x-api-key` des sites d'appel. Pour Gemini, la vraie clé est posée par
 * `fetchGemini_` (en-tête `x-goog-api-key`) : on rend '' ici pour qu'un site d'appel ne lève pas
 * quand la clé Anthropic n'existe plus (étape 5). Pour Anthropic : comportement inchangé (lève si absente).
 */
function cleLlm_(modele) {
  return estModeleGemini_(modele) ? '' : getCleAnthropic_();
}

/**
 * Classeur d'état (Entités / Corrections / Index / Journal / Échecs / Santé / Progression).
 * Auto-créé au premier run UNIQUEMENT si DriveAI_SHEET_ID est ABSENT (première installation).
 *
 * ÉCHEC FERMÉ (incident 2026-07-08, leçon durable §7) : « absente » ≠ « inaccessible ». Un
 * `openById` qui échoue TRANSITOIREMENT (panne API Google, blip d'accès) ne doit JAMAIS
 * recréer la ressource ni écraser son ID — c'est arrivé une fois : nouvelle Sheet VIDE créée
 * en plein tick, tout l'état forké en silence (~87 PJ re-déposées, validations orphelines).
 * On lève : le run échoue proprement, le tick suivant réessaie. L'IDENTITÉ de la Sheet d'état
 * est un invariant (verrou : test/sheet-etat.test.js).
 * @return {Spreadsheet}
 */
function getSheetEtat_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DriveAI_SHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Panne API Google ou accès refusé à la Sheet d\'état. Abandon pour protéger l\'idempotence : ' + e);
    }
  }
  var ss = SpreadsheetApp.create('DriveAI — État');
  props.setProperty('DriveAI_SHEET_ID', ss.getId());
  initialiserSheet_(ss);
  return ss;
}
