/**
 * WebApp.gs — pont HTTP entre l'app (SPA)/GitHub Actions et le moteur. Actions :
 *
 *  - (défaut) « Vérifier maintenant » (#20) : déclencheur PONCTUEL du tick (idempotent,
 *    LockService, garde-temps) — réponse non lue par l'app (no-cors).
 *  - `action=pas-suspect`, `hub-summary`, `gardes-app`, `annuler-action` : actions de l'app (secret web app), sans
 *    aucun appel LLM. L'app POSTe en Content-Type text/plain (requête « simple », pas de
 *    préflight) — Apps Script renvoie alors un CORS lisible (`*`).
 *    (La recherche IA, le chat à outils et les actions `mcp-*` du connecteur MCP ont été RETIRÉS
 *    par l'ADR-0074 le 05/11/2026 : plus aucun appel LLM ne part d'ici.)
 *  - `action=pousser-reset` (ADR-0032) : GitHub Actions pousse UNE passe du grand rangement,
 *    exécutée SYNCHRONEMENT ici — hors du quota des DÉCLENCHEURS, comme un clic de Marc dans
 *    l'éditeur. ⚠️ Ne JAMAIS router vers `actionTickPonctuel_` (elle CRÉE un déclencheur, donc
 *    consommerait le quota que tout ce montage protège). Secret CI.
 *  - `action=assurer-trigger` (ADR-0032) : ré-installe le déclencheur après un déploiement —
 *    remplace le dernier geste manuel de Marc. Secret CI.
 *  - `action=audit-tri` (ADR-0075 §3, Marc le 05/11/2026 : « fais tout toi ») : lance l'audit du tri sujet + corps
 *    (lecture pure, onglet « Audit tri ») et ne rend que des COMPTEURS et des métadonnées. Secret CI.
 *
 * Secrets — DEUX, jamais confondus (le 3ᵉ, `DriveAI_MCP_SECRET`, est parti avec le MCP, ADR-0074) :
 *  - `DriveAI_WEBAPP_SECRET` (défaut, pas-suspect, hub-summary, gardes-app, annuler-action) : exposé côté NAVIGATEUR par conception
 *    (app/src/config.ts — « la sécurité vient du login Google, pas du secret »).
 *  - `DriveAI_SYNC_SECRET` (pousser-reset, assurer-trigger, audit-tri) : DÉDIÉ, JAMAIS exposé
 *    à un navigateur — connu seulement de GitHub Actions (secret CI) et du script.
 *    ⚠️ POUVOIR RÉEL s'il fuit, énoncé sans euphémisme (corrigé en revue C28-43 — la version
 *    précédente prétendait « jamais une lecture de document », ce qui était FAUX) : faire avancer le rangement, donc DÉPLACER et RENOMMER
 *    des documents classés ; écrire l'état (Index/Journal/Reset) ; déclencher un OCR et l'envoi de
 *    TEXTE DE DOCUMENT à l'API Anthropic aux frais de Marc (borné par le frein §2.6 et par
 *    `PILOTE_BUDGET_JOUR_MS`) ; réinstaller les déclencheurs ; monopoliser le verrou du moteur ; lancer
 *    l'audit du tri (sujet + corps de 20 fils envoyés au modèle, au plus une fois par heure).
 *    Restent IMPOSSIBLES : toute suppression, toute sortie de `04 · Immigration`, et toute
 *    EXFILTRATION (les réponses ne portent que des compteurs et, pour l'audit du tri, des métadonnées de
 *    classement : libellés, verdicts, portes — jamais un contenu de document ni de mail).
 *
 * Garde-fous communs : anti-rafale par action, plafonds bornés, sortie whitelistée par un
 * parseur strict (fonctions PURES testées).
 *
 * `doGet` : AUCUNE action GET — une page neutre, toujours. L'app et la CI ne parlent au moteur qu'en
 * POST. (Le callback de consentement OAuth du projet hubperso, ADR-0041, qui était l'unique action
 * GET, est parti avec Tasks/Calendar : ADR-0074, 05/11/2026.)
 */

function doGet() {
  return ContentService.createTextOutput('DriveAI');
}

/* ---------- Mémo de requête : une demande rejouée ne s'exécute pas deux fois (C28-133) ---------- */

/**
 * Durée de vie du mémo d'une requête d'app. Assez long pour couvrir les rejeux du navigateur
 * (3 essais, quelques secondes), assez court pour ne rien garder : ce n'est pas un cache de
 * réponses, c'est un filet anti-double-exécution.
 */
var WEBAPP_MEMO_TTL_S = 600;

/**
 * Clé de mémo d'une requête d'app. PURE — rend '' quand il n'y a rien à mémoriser.
 *
 * POURQUOI (revue flotte C28-133, DEUX agents en convergence). L'app rejoue un POST `/exec` quand
 * Google refuse de servir la réponse. Or un POST `/exec` est une chaîne à DEUX segments :
 * `script.google.com/…/exec` EXÉCUTE le script puis répond 302 vers `…googleusercontent.com/…/echo`,
 * qui ne fait plus que SERVIR la sortie. `fetch` suit la redirection, donc le statut que le
 * navigateur voit est celui du SECOND segment : un 404 peut aussi bien vouloir dire « je n'ai pas
 * pu ouvrir le déploiement » (rien n'a tourné) que « je n'arrive pas à te livrer la sortie »
 * (TOUT a tourné, et Anthropic a été payé). **Le client ne peut pas distinguer les deux.**
 *
 * Sans ce mémo, un rejeu de l'ancien `chat-assistant` (retiré par l'ADR-0074) refacturait un tour
 * de Sonnet et appendait une SECONDE fois les mêmes propositions dans l'onglet Réorg. Le mémo
 * reste pour les actions qui écrivent (`pas-suspect`) : un rejeu ne doit rien ré-exécuter.
 *
 * Le mémo déplace la garantie là où elle est OBSERVABLE — dans le moteur, qui SAIT s'il a déjà
 * tourné — au lieu de la déduire d'un code HTTP ambigu. C'est §9 : « un verdict se prend sur une
 * LECTURE, jamais sur l'échec d'une MUTATION ».
 *
 * L'identifiant est contraint (charset + longueur) : il entre dans une clé de cache, il ne peut pas
 * être une chaîne arbitraire venue du réseau.
 * @param {string} action
 * @param {*} requestId
 * @return {string} clé, ou '' si la requête n'est pas mémorisable
 */
function cleMemoRequete_(action, requestId) {
  if (!action || typeof requestId !== 'string') return '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return '';
  return 'rep|' + action + '|' + requestId;
}

/** `requestId` du corps POST, sans jamais laisser un corps illisible casser la requête. PURE-ish. */
function requestIdDeRequete_(e) {
  try {
    var c = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : null;
    return c && typeof c.requestId === 'string' ? c.requestId : '';
  } catch (err) { return ''; }
}

/** Lecture du mémo. Un cache indisponible n'est JAMAIS une panne : on ré-exécute, comme avant. */
function memoLire_(cle) {
  if (!cle) return null;
  try { return CacheService.getScriptCache().get(cle); } catch (err) { return null; }
}

/** Écriture du mémo, enveloppée pour la même raison (et la valeur peut dépasser la taille admise). */
function memoEcrire_(cle, valeur) {
  if (!cle) return;
  try { CacheService.getScriptCache().put(cle, valeur, WEBAPP_MEMO_TTL_S); } catch (err) { }
}

/** Vrai si le secret DÉDIÉ (distinct de celui de l'app) est valide pour cette requête. */
function verifierSecretSync_(e) {
  var attendu = PropertiesService.getScriptProperties().getProperty('DriveAI_SYNC_SECRET');
  var recu = e && e.parameter ? e.parameter.secret : '';
  return !!(attendu && recu && recu === attendu);
}

function doPost(e) {
  var reponse = { ok: false };
  try {
    var action = e && e.parameter ? e.parameter.action : '';
    // Ventilation du coût LLM (C28-58) : les appels déclenchés par l'app ne passent par
    // AUCUNE étape de tick — sans ce marquage ils tomberaient tous dans « (hors étape) ». On les
    // attribue à leur action (`pas-suspect`, `gardes-app`…), ce qui est
    // exactement la granularité utile : Marc voit ce que SES demandes coûtent, séparément du
    // travail automatique. Aucune restauration nécessaire : une exécution de web app sert UNE
    // requête, puis meurt.
    // Enveloppé : la COMPTABILITÉ ne doit jamais pouvoir faire échouer une requête de Marc
    // (et `Suivi.gs` peut ne pas être chargé dans un contexte de test ciblé).
    try { poserOperationCourante_(action ? 'app:' + action : 'app:(sans action)'); } catch (eOp) { }
    if (action === 'pousser-reset') {
      reponse = verifierSecretSync_(e)
        ? (antiRafalePilote_('DriveAI_DERNIER_PILOTE', CONFIG.TICK_MINUTES * 60 * 1000)
          ? pousserResetPilote_()
          : { ok: true, termine: false, rondes: 0, progres: false, message: 'passe trop rapprochée — ignorée' })
        : { ok: false, erreur: 'refusé' };
    } else if (action === 'assurer-trigger') {
      reponse = verifierSecretSync_(e)
        ? (antiRafalePilote_('DriveAI_DERNIER_ASSURE_TRIGGER', 10 * 60 * 1000)
          ? actionAssurerTrigger_()
          : { ok: true, version: versionPilote_(), message: 'déclencheur déjà assuré il y a moins de 10 min' })
        : { ok: false, erreur: 'refusé' };
    } else if (action === 'audit-tri') {
      reponse = verifierSecretSync_(e)
        ? (antiRafalePilote_('DriveAI_DERNIER_AUDIT_TRI', 60 * 60 * 1000)
          ? actionAuditTri_()
          : { ok: true, version: versionPilote_(), lance: false, message: 'audit déjà lancé il y a moins de 60 min' })
        : { ok: false, erreur: 'refusé' };
    } else {
      var attendu = PropertiesService.getScriptProperties().getProperty('DriveAI_WEBAPP_SECRET');
      var recu = e && e.parameter ? e.parameter.secret : '';
      if (!attendu || !recu || recu !== attendu) {
        reponse.erreur = 'refusé';
      } else {
        // Mémo AVANT toute action : un rejeu de la MÊME requête logique rend la réponse déjà
        // calculée, sans rappeler le modèle, sans ré-écrire une ligne, et sans toucher
        // l'anti-rafale (on sort ici, avant l'action). Seules les réponses RÉUSSIES
        // sont mémorisées : un `ok:false` (budget, anti-rafale) n'a rien exécuté de coûteux, et
        // le figer rendrait à Marc une erreur périmée à chaque essai.
        var cleMemo = cleMemoRequete_(action, requestIdDeRequete_(e));
        var memo = memoLire_(cleMemo);
        if (memo) {
          try {
            var dejaFait = JSON.parse(memo);
            dejaFait.memo = true; // dit à l'app qu'elle relit, au lieu de le lui faire deviner
            return ContentService.createTextOutput(JSON.stringify(dejaFait))
              .setMimeType(ContentService.MimeType.JSON);
          } catch (eMemo) { /* mémo illisible : on ré-exécute, jamais on n'échoue */ }
        }
        if (action === 'pas-suspect') {
          reponse = actionPasSuspect_(e);
        } else if (action === 'hub-summary') {
          reponse = actionHubSummary_();
        } else if (action === 'gardes-app') {
          reponse = actionGardesApp_();
        } else if (action === 'annuler-action') {
          reponse = actionAnnulerAction_(e);
        } else if (action === 'copilote-executer') {
          reponse = actionCopiloteExecuter_(e);
        } else if (action === 'copilote-pack') {
          reponse = actionCopilotePack_(e);
        } else if (action === 'copilote-checklist') {
          reponse = actionCopiloteChecklist_(e);
        } else if (action === 'copilote-question') {
          reponse = actionCopiloteQuestion_(e);
        } else if (action === 'copilote-regle') {
          reponse = actionCopiloteRegle_(e);
        } else {
          reponse = actionTickPonctuel_();
        }
        if (reponse && reponse.ok === true) memoEcrire_(cleMemo, JSON.stringify(reponse));
      }
    }
  } catch (err) {
    reponse.erreur = String(err);
  }
  return ContentService.createTextOutput(JSON.stringify(reponse))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Pilote CI (ADR-0032) : ré-installation du déclencheur, sans Marc ---------- */

/**
 * Ré-installe le déclencheur temporel — EXACTEMENT ce que Marc faisait à la main dans l'éditeur
 * après chaque merge moteur (`Main.gs` → `installerTrigger`). Appelée par `deploy.yml` APRÈS
 * `clasp push` + `clasp deploy`, elle ferme le piège de déploiement (3) : un `clasp push` vert ne
 * garantit pas que le déclencheur exécute le NOUVEAU code — supprimer/recréer le déclencheur le
 * force (prod figée ~4 j vécue, CI verte, zéro erreur).
 *
 * Le champ `version` de la réponse est le SIGNAL INDÉPENDANT attendu par la CI : s'il manque, c'est
 * que la web app `/exec` sert encore une version qui ne connaît pas cette action (piège (4) : l'appel
 * tombe alors dans le `else` du `doPost` et « réussit » en silence) — le workflow le détecte au lieu
 * de conclure à tort que le déclencheur a été réinstallé.
 */
function actionAssurerTrigger_() {
  installerTrigger();
  return {
    ok: true,
    version: versionPilote_(),
    message: 'déclencheur réinstallé (' + CONFIG.TICK_MINUTES + ' min) — plus aucun geste manuel requis'
  };
}

/**
 * Audit du tri sujet + corps (ADR-0075 §3) lancé par la CI (`pousser-reset.yml`, entrée `action=audit-tri`) :
 * remplace le geste de Marc dans l'éditeur (05/11/2026 : « fais tout toi »). Lecture pure côté moteur (aucune
 * écriture Gmail ni Index), bornée par `BUDGET_MS` (< 6 min de web app). La réponse ne porte que des compteurs
 * et des métadonnées (`auditerTriSujetCorpsDetail_`) : le détail reste dans l'onglet « Audit tri ».
 * `lance:false` = panne LLM, l'audit n'a pas tourné (le workflow sort en rouge, pas en silence).
 */
function actionAuditTri_() {
  // Même verrou que le tick et le pilote (`acquerirVerrouReset_`, LockService) : sans lui, l'audit tournerait EN
  // PARALLÈLE d'un tick — deux séries d'appels au modèle, un 429 de l'audit compté dans la série du tick (panne posée),
  // et deux `flushUsage_` concurrents dont l'un perdrait son coût. Verrou pris → tick en cours : on ne lance pas.
  var verrou = acquerirVerrouReset_('actionAuditTri_');
  if (!verrou) {
    rendreFenetrePilote_('DriveAI_DERNIER_AUDIT_TRI');
    return { ok: true, version: versionPilote_(), lance: false, message: 'tick en cours — audit non lancé, réessayer dans une minute' };
  }
  var r;
  try {
    r = auditerTriSujetCorpsDetail_();
  } catch (e) {
    rendreFenetrePilote_('DriveAI_DERNIER_AUDIT_TRI'); // rien n'a tourné jusqu'au bout : l'heure n'est pas due
    throw e;
  } finally {
    verrou.releaseLock();
  }
  if (r.refuse) rendreFenetrePilote_('DriveAI_DERNIER_AUDIT_TRI');
  return { ok: true, version: versionPilote_(), lance: !r.refuse, audit: r };
}

/** Rend la fenêtre anti-rafale consommée par `antiRafalePilote_` quand l'action n'a finalement PAS tourné. */
function rendreFenetrePilote_(cle) {
  PropertiesService.getScriptProperties().deleteProperty(cle);
}

/**
 * Empreinte de la version SERVIE par `/exec` — signal indépendant pour la CI (piège de déploiement (4)).
 * Se termine par le SHA court du commit déployé (`Version.gs`, rempli par la CI) : les deux premiers
 * morceaux ne bougent presque jamais et prouvent seulement que `/exec` CONNAÎT l'action ; le SHA
 * prouve qu'elle sert le code du jour. `typeof` : `Version.gs` peut être absent d'un contexte de test.
 */
function versionPilote_() {
  var commit = (typeof COMMIT_DEPLOYE === 'string' && COMMIT_DEPLOYE) ? COMMIT_DEPLOYE : 'inconnu';
  return String(CONFIG.TICK_MINUTES) + 'min|' + CONFIG.RESET_TABLE_VERSION + '|' + commit;
}

/**
 * Anti-rafale dédié aux actions du pilote (l'en-tête de ce fichier le promet pour TOUTE action —
 * cette promesse doit être CODÉE, pas seulement écrite). Deux abus concrets qu'il ferme, pour qui
 * détiendrait le secret CI : `assurer-trigger` en boucle fait `delete`+`create` du déclencheur, donc
 * en le rappelant plus vite que `TICK_MINUTES` le tick ne se déclencherait JAMAIS (gel silencieux) ;
 * `pousser-reset` en rafale monopoliserait le verrou et affamerait le flux vivant.
 * @return {boolean} vrai si l'appel peut procéder (et la fenêtre est alors consommée).
 */
function antiRafalePilote_(cle, intervalleMs) {
  var props = PropertiesService.getScriptProperties();
  var dernier = Number(props.getProperty(cle)) || 0;
  if (Date.now() - dernier < intervalleMs) return false;
  props.setProperty(cle, String(Date.now()));
  return true;
}

/* ---------- Action par défaut : passage immédiat (#20) ---------- */

function actionTickPonctuel_() {
  var reponse = { ok: false };
  var props = PropertiesService.getScriptProperties();
  var dernier = Number(props.getProperty('DriveAI_DERNIER_PONCTUEL')) || 0;
  if (Date.now() - dernier < 60 * 1000) {
    reponse.ok = true;
    reponse.message = 'déjà demandé il y a moins d’une minute';
  } else {
    props.setProperty('DriveAI_DERNIER_PONCTUEL', String(Date.now()));
    ScriptApp.newTrigger('tickPonctuel').timeBased().after(1000).create();
    journalInfo_('WebApp', 'Passage immédiat demandé depuis l’app.');
    reponse.ok = true;
    reponse.message = 'passage lancé';
  }
  return reponse;
}

/** Cible du déclencheur ponctuel : nettoie ses déclencheurs puis lance le tick normal. */
function tickPonctuel() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'tickPonctuel') ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* best-effort — le tick prime */ }
  tickDriveAI();
}

/* (Actions « analyse-ciblee », « demande-tri », « demande-intentions » : RETIRÉES par
   l'ADR-0031 — leurs boutons n'existent plus depuis la refonte C28-41 PR1. Les scans
   AUTOMATIQUES du tick sont inchangés.) */

/**
 * « PAS SUSPECT » 1-clic (C28-19, ADR-0020) : apprend l'expéditeur DE CONFIANCE (onglet
 * `Confiance`, dédupliqué) et dépose la demande de re-tri (Property `DriveAI_PAS_SUSPECT`,
 * liste additive) consommée par le tick SOUS SON VERROU — JAMAIS de suppression de lignes
 * d'Index ici : doPost court en concurrence du run (déviation documentée vs plan C28-19).
 * Le libellé ⚠ Gmail du fil n'est jamais retiré (§2.3) : le moteur l'ignore désormais.
 * PAS d'anti-rafale (C28-24, décision Marc) : Marc retire souvent PLUSIEURS suspects d'affilée —
 * l'action est bon marché (1 lecture de fil + 2 écritures idempotentes/dédupliquées), la
 * validation stricte du threadId et la liste additive bornent déjà tout abus.
 */
function actionPasSuspect_(e) {
  var props = PropertiesService.getScriptProperties();

  var threadId = '';
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    threadId = validerThreadId_(corps.threadId);
  } catch (err) {
    threadId = '';
  }
  if (!threadId) return { ok: false, erreur: 'threadId invalide' };

  // Lecture du fil (adresse de l'expéditeur) — même règle de référence que le tri : le dernier
  // message qui ne vient PAS de Marc (sinon un fil où il a répondu apprendrait SA propre adresse).
  var adresse = '';
  try {
    var fil = GmailApp.getThreadById(threadId);
    if (!fil) return { ok: false, erreur: 'fil introuvable' };
    var messages = fil.getMessages();
    var proprio = (CONFIG.PROPRIETAIRE_EMAIL || '').toLowerCase();
    for (var i = messages.length - 1; i >= 0; i--) {
      var a = adresseExpediteur_(messages[i].getFrom());
      if (a && a !== proprio) { adresse = a; break; }
    }
  } catch (err) {
    if (signalerPanneGmail_(err)) return { ok: false, erreur: 'QUOTA_GMAIL' };
    return { ok: false, erreur: 'fil illisible : ' + err };
  }
  if (!adresse) return { ok: false, erreur: 'expéditeur introuvable sur ce fil' };

  apprendreConfiance_(adresse);

  // Demande de re-tri : une Property PAR fil — écriture ATOMIQUE (revue flotte C28-24). Sans
  // anti-rafale, deux doPost concurrents s'écrasaient sur la LISTE partagée (lecture → push →
  // écriture : dernier écrivain gagnant, clic perdu en SILENCE — l'app masque la ligne de façon
  // optimiste). Le LockService est indisponible ici : le tick le tient jusqu'à ~6 min. Le
  // threadId ne peut pas contenir `|` (validerThreadId_) — l'espace de clés est sûr.
  props.setProperty('DriveAI_PAS_SUSPECT|' + threadId, '1');

  journalInfo_('WebApp', 'Pas-suspect : « ' + adresse + ' » ajouté à Confiance (fil re-trié au prochain passage).');
  actionTickPonctuel_(); // passage immédiat — le fil est re-jugé « sain » dans la ~minute
  return { ok: true, message: 'Expéditeur de confiance : ' + adresse + ' — le fil est re-trié dans la minute.' };
}

/**
 * Annule une action réversible consignée dans l'onglet `Actions` (ADR-0081, vague 3a).
 * Protégé par `DriveAI_WEBAPP_SECRET`, idempotent via le mémo `cleMemoRequete_` et le statut
 * `annulé`, et sérialisé par `LockService` pour éviter toute course avec un tick Drive.
 */
function actionAnnulerAction_(e) {
  var actionId = '';
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    actionId = validerActionId_(corps.actionId);
  } catch (err) {
    actionId = '';
  }
  if (!actionId) return { ok: false, erreur: 'actionId invalide' };

  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) {
    return { ok: false, erreur: 'moteur occupé — réessayer dans une minute' };
  }
  try {
    return annulerAction_(actionId);
  } finally {
    verrou.releaseLock();
  }
}

/** Exécute une décision Copilote (`action=copilote-executer`), sérialisée par verrou script. */
function actionCopiloteExecuter_(e) {
  var corps;
  try { corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return { ok: false, erreur: 'corps JSON invalide' }; }
  var id = corps && typeof corps.id === 'string' ? corps.id.trim() : '';
  var decision = corps && typeof corps.decision === 'string' ? corps.decision.trim() : '';
  if (!id || !/^[A-Za-z0-9_-]{3,64}$/.test(id)) return { ok: false, erreur: 'id invalide' };
  if (!{ 'executer': 1, 'restaurer': 1, 'ignorer': 1, 'reclame': 1, 'passer-auto': 1, 'desactiver-auto': 1 }[decision]) {
    return { ok: false, erreur: 'decision invalide' };
  }
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) return { ok: false, erreur: 'moteur occupé — réessayer dans une minute' };
  try { return executerDecisionCopilote_({ id: id, decision: decision }); }
  finally { verrou.releaseLock(); }
}

/** Crée un Pack Drive par raccourcis (`action=copilote-pack`), sérialisé par verrou script. */
function actionCopilotePack_(e) {
  var corps;
  try { corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return { ok: false, erreur: 'corps JSON invalide' }; }
  var pack = corps && typeof corps.pack === 'string' ? corps.pack.trim() : '';
  var titre = corps && typeof corps.titre === 'string' ? corps.titre.trim() : '';
  var fileIds = corps && Array.isArray(corps.fileIds) ? corps.fileIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
  if ((!pack && !fileIds.length) || pack.length > 80 || titre.length > 80 || fileIds.length > 25) return { ok: false, erreur: 'paramètres pack invalides' };
  if (fileIds.some(function (x) { return !/^[A-Za-z0-9_-]{3,80}$/.test(x); })) return { ok: false, erreur: 'fileId invalide' };
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) return { ok: false, erreur: 'moteur occupé — réessayer dans une minute' };
  try { return typeof creerPackCopilote_ === 'function' ? creerPackCopilote_({ pack: pack, fileIds: fileIds.length ? fileIds : null, titre: titre }) : { ok: false, erreur: 'module packs absent' }; }
  finally { verrou.releaseLock(); }
}

/** Met à jour une checklist ou un plan changement de vie (`action=copilote-checklist`), sous verrou script. */
function actionCopiloteChecklist_(e) {
  var corps;
  try { corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return { ok: false, erreur: 'corps JSON invalide' }; }
  var checklistId = corps && typeof corps.checklistId === 'string' ? corps.checklistId.trim() : '';
  var demarche = corps && typeof corps.demarche === 'string' ? corps.demarche.trim() : '';
  var item = corps && typeof corps.item === 'string' ? corps.item.trim() : '';
  if ((!checklistId && !demarche) || (checklistId && !/^[A-Za-z0-9_-]{3,64}$/.test(checklistId)) || demarche.length > 60 || item.length > 80 ||
    (corps.coche !== undefined && typeof corps.coche !== 'boolean')) return { ok: false, erreur: 'paramètres checklist invalides' };
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) return { ok: false, erreur: 'moteur occupé — réessayer dans une minute' };
  try { return typeof executerChecklistCopilote_ === 'function' ? executerChecklistCopilote_({ checklistId: checklistId, demarche: demarche, item: item, coche: corps.coche }) : { ok: false, erreur: 'module checklists absent' }; }
  finally { verrou.releaseLock(); }
}

/** Répond à une question en langage naturel sur métadonnées structurées (`action=copilote-question`). */
function actionCopiloteQuestion_(e) {
  var corps;
  try { corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return { ok: false, erreur: 'corps JSON invalide' }; }
  var q = corps && typeof corps.question === 'string' ? corps.question.trim() : '';
  if (!q) return { ok: false, erreur: 'question requise' };
  if (q.length > 300) return { ok: false, erreur: 'question trop longue (max 300 car.)' };
  try { if (typeof poserOperationCourante_ === 'function') poserOperationCourante_('app:copilote-question'); } catch (eOp) {}
  return typeof repondreQuestionCopilote_ === 'function' ? repondreQuestionCopilote_({ question: q }) : { ok: false, erreur: 'module questions absent' };
}

/** Crée, bascule auto ou désactive une règle en 1 phrase (`action=copilote-regle`), sous verrou script. */
function actionCopiloteRegle_(e) {
  var corps;
  try { corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return { ok: false, erreur: 'corps JSON invalide' }; }
  var mode = corps && typeof corps.mode === 'string' ? corps.mode.trim() : '';
  var regleId = corps && typeof corps.regleId === 'string' ? corps.regleId.trim() : '';
  var phrase = corps && typeof corps.phrase === 'string' ? corps.phrase.trim() : '';
  if (!{ 'creer': 1, 'basculer-auto': 1, 'supprimer-auto': 1 }[mode]) return { ok: false, erreur: 'mode invalide' };
  if (mode === 'creer' && (phrase.length < 5 || phrase.length > 240)) return { ok: false, erreur: 'phrase invalide' };
  if (mode !== 'creer' && !/^[A-Za-z0-9_-]{3,64}$/.test(regleId)) return { ok: false, erreur: 'regleId invalide' };
  try { if (typeof poserOperationCourante_ === 'function') poserOperationCourante_('app:copilote-regle'); } catch (eOp) {}
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) return { ok: false, erreur: 'moteur occupé — réessayer dans une minute' };
  try { return typeof executerRegleCopilote_ === 'function' ? executerRegleCopilote_({ mode: mode, regleId: regleId, phrase: phrase }) : { ok: false, erreur: 'module regles absent' }; }
  finally { verrou.releaseLock(); }
}

/* ---------- Résumé pour le hub perso (C28-27, CLAUDE.md §6 bis) ---------- */

/**
 * Métadonnées du moteur pour le widget du hub — servies au BROKER Vercel
 * (`api/hub/_engineState.ts`), JAMAIS directement au hub (le jeton `x-hub-token` est vérifié
 * côté Vercel ; ici c'est `DriveAI_WEBAPP_SECRET` qui garde la porte, comme les autres actions).
 * ADR-0007 : 4 compteurs + 1 horodatage — aucun nom de fichier, aucun contenu.
 *
 * LECTURE SEULE d'une Property PRÉ-CALCULÉE au tick (`DriveAI_HUB_SUMMARY`, cf. majResumeHub_) :
 * le calcul (getValues Index+Journal + liste Drive de la file) dépassait le délai du broker Vercel
 * quand il était fait à chaque appel → 500 en boucle (C28-27, mise en service). Ici, réponse en ms.
 * Property absente (aucun tick depuis le déploiement) → `lastRunAt:null` : le broker rend « building »
 * honnête (no-fake-data). Échec fermé : toute exception remonte au try/catch du doPost.
 */
function actionHubSummary_() {
  var brut = PropertiesService.getScriptProperties().getProperty('DriveAI_HUB_SUMMARY');
  var etat = brut ? JSON.parse(brut) : null;
  if (!etat || typeof etat !== 'object') {
    return { ok: true, etat: { reviewQueueCount: 0, filedLast7d: 0, errorsLast7d: 0, lastRunAt: null } };
  }
  return { ok: true, etat: etat };
}

/**
 * Repères des garde-fous que l'APPLICATION WEB doit connaître (miroir TS, ADR-0008) : la racine de
 * la zone protégée et les deux dossiers à ID fixe du router. Ils viennent du PROFIL PRIVÉ du
 * moteur — le dépôt ne les porte plus (mission #497). L'app les demande au moment d'agir et REFUSE
 * de muter Drive sans eux : un défaut vide serait une zone protégée ouverte, jamais un repli.
 * ECHEC FERMÉ : profil non appliqué ou repère manquant → `ok:false`, aucun identifiant fictif rendu.
 * @return {{ok: boolean, erreur: (string|undefined), racinesProtegees: (string[]|undefined), idsStructurels: (string[]|undefined)}}
 */
function actionGardesApp_() {
  var etat = etatProfilPrive_();
  if (!etat || etat.etat !== 'ok') return { ok: false, erreur: 'profil-prive-' + (etat ? etat.etat : 'absent') };
  var valide = function (id) { return typeof id === 'string' && id.length > 0 && id.indexOf('FICTIF_') !== 0; };
  var racines = (CONFIG.DOMAINES_PROTEGES || []).map(function (d) { return CONFIG.DOMAINES[d]; }).filter(valide);
  var cat = CONFIG.CATEGORIES['03 · Logement & véhicule'] || {};
  var structurels = [cat['Logement'], cat['Véhicule']].filter(valide);
  if (racines.length !== (CONFIG.DOMAINES_PROTEGES || []).length || racines.length === 0 || structurels.length !== 2) {
    return { ok: false, erreur: 'reperes-incomplets' };
  }
  return { ok: true, racinesProtegees: racines, idsStructurels: structurels };
}

/* ---------- Avancement des missions publié au hub (HUB-MISSIONS, ADR-0057) ---------- */

/**
 * Nombre d'opérations de fond publiées au hub, au plus.
 *
 * 6 et pas 8 : le contrat `hub-contract` v1.3 plafonne une section de détail à 8 lignes, et
 * DriveAI compte aujourd'hui une quinzaine de campagnes — le plafond du contrat serait donc
 * atteint AVANT celui-ci, et un dépassement fait REJETER le résumé entier (le hub afficherait
 * « réponse invalide », c'est-à-dire accuserait l'app d'une panne qu'elle n'a pas). Garder deux
 * lignes de marge sous le plafond du contrat est ce qui rend ce rejet impossible.
 *
 * Ce qui est tronqué n'est pas tu : `missionsOmises` porte le compte, et le hub l'affiche.
 */
var HUB_MISSIONS_MAX = 6;
// Lignes de Progression lues au plus pour le résumé (hier `MCP_PROGRESSION_MAX` du connecteur MCP, retiré par l'ADR-0074).
var HUB_PROGRESSION_MAX = 60;

/** Lit les lignes de données d'un onglet, bornées à `maxLignes` (jamais l'onglet entier). */
function lireOngletBorne_(nom, maxLignes) {
  var f = feuille_(nom);
  var dern = f.getLastRow();
  if (dern < 2) return [];
  var n = Math.min(dern - 1, maxLignes);
  return f.getRange(2, 1, n, f.getLastColumn()).getValues();
}

/**
 * Lit la QUEUE d'un onglet qui ne grandit que par ajout : l'en-tête + les `maxLignes` dernières
 * lignes de données (jamais l'onglet entier). Pendant de `lireOngletBorne_`, qui lit la TÊTE.
 * `complet` = la fenêtre couvre tout l'onglet (rien n'est resté hors fenêtre). Onglet vide :
 * `lignes` vide et `complet`. `maxLignes` = Infinity relit l'onglet entier (repli du résumé hub).
 * @return {{lignes: Array[], complet: boolean}}
 */
function lireQueueOngletBornee_(nom, maxLignes) {
  var f = feuille_(nom);
  var dern = f.getLastRow();
  if (dern < 2) return { lignes: [], complet: true };
  var col = f.getLastColumn();
  var n = Math.min(dern - 1, maxLignes);
  var entete = f.getRange(1, 1, 1, col).getValues();
  var queue = f.getRange(dern - n + 1, 1, n, col).getValues();
  return { lignes: entete.concat(queue), complet: n === dern - 1 };
}

/**
 * Longueurs maximales des textes publiés. Le contrat a ses propres plafonds (40 pour un libellé,
 * 80 pour une précision) et c'est le BROKER qui les applique — ici on borne la Property, pas
 * l'affichage.
 *
 * ⚠️ POURQUOI BORNER ICI AUSSI. `DriveAI_HUB_SUMMARY` est une Script Property : Apps Script
 * refuse au-delà de ~9 Ko par valeur, et un registre voisin de ce même moteur est déjà à
 * 8 377 octets. Un `setProperty` refusé ne casse pas le tick — il laisse le hub servir
 * ÉTERNELLEMENT le dernier résumé écrit, sans que rien ne soit rouge : exactement la panne
 * silencieuse que tout le reste de ce fichier existe pour supprimer.
 */
var HUB_TEXTE_MAX = 90;
var HUB_NOM_FICHIER_MAX = 200;

/**
 * Budget de la Property `DriveAI_HUB_SUMMARY`, en octets de JSON.
 *
 * 8 000 sous les ~9 Ko d'Apps Script : la marge n'est pas de la superstition, c'est ce qui
 * absorbe un champ additif ajouté par une session future sans qu'elle ait à connaître ce
 * plafond. Au-delà, `majResumeHub_` republie SANS les missions (cf. son garde de taille) plutôt
 * que de tenter une écriture qui échouerait.
 */
var HUB_SUMMARY_MAX_OCTETS = 8000;

/** Tronque en signalant la troncature — jamais une coupe muette qui passe pour la valeur. */
function tronquerHub_(valeur, max) {
  var t = String(valeur === null || valeur === undefined ? '' : valeur);
  return t.length <= max ? t : t.slice(0, max - 1) + '\u2026';
}

/**
 * Avancement des campagnes de fond, tiré des lignes BRUTES de l'onglet Progression. PURE (testée).
 *
 * ── POURQUOI L'ONGLET PROGRESSION ET PAS LES PROPERTIES ─────────────────────────────
 *
 * Les compteurs bruts vivent bien dans les Properties (`chargerEtatMissions_`), mais le STATUT
 * lisible (« en pause (frein budget) »), le reste à faire et l'estimation de fin sont calculés
 * par `lignesProgression_` (Journal.gs) — avec, dedans, tout ce que cette fonction a appris à ne
 * PAS dire : pas d'horizon sur une campagne en pause, pas de date de fin sur une mission
 * convergée à reliquat. Recalculer ces phrases ici donnerait un SECOND jugement sur la même
 * réalité, et c'est le premier qui divergerait sans que personne ne le voie. L'onglet est réécrit
 * en entier à chaque tick, juste AVANT `majResumeHub_` (ordre du `finally`, Main.gs) : le relire
 * publie exactement ce que Marc voit dans l'app.
 *
 * Seules les lignes de `type` « campagne » entrent : le rangement, les missions de curation, la
 * consolidation, les resets. Les lignes de flux (intake, tri Gmail) et d'observabilité n'ont pas
 * d'avancement — publier « Progression (cet onglet) · terminé » serait du bruit.
 *
 * ORDRE : les opérations ACTIVES d'abord, puis les « terminé » récents, et à l'intérieur de
 * chaque groupe l'ordre de l'onglet — qui est celui du tick, donc la priorité. Trier par
 * avancement ou par activité ferait danser les lignes d'un relevé à l'autre pour une information
 * qui, elle, ne change pas.
 *
 * @param {Array<Array>} lignesProgression  lignes de données (13 col, cf. COLONNES_PROGRESSION)
 * @param {number=} max  plafond (défaut HUB_MISSIONS_MAX)
 * @return {{liste: Array<Object>, omises: number}}
 */
function missionsPourHub_(lignesProgression, max) {
  var plafond = typeof max === 'number' && max >= 0 ? max : HUB_MISSIONS_MAX;
  var retenues = (lignesProgression || []).filter(function (l) {
    return l && String(l[10] || '') === 'campagne' && String(l[1] || '') !== '';
  }).map(function (l) {
    var statut = tronquerHub_(l[5], HUB_TEXTE_MAX);
    return {
      nom: tronquerHub_(l[1], HUB_TEXTE_MAX),
      traites: nombreProgressionHub_(l[2]),
      base: nombreProgressionHub_(l[3]),
      unite: tronquerHub_(l[4], 20),
      statut: statut,
      finEstimee: tronquerHub_(l[12], HUB_TEXTE_MAX),
      fini: statut === 'terminé'
    };
  });
  var actives = retenues.filter(function (m) { return !m.fini; });
  var finies = retenues.filter(function (m) { return m.fini; });
  var ordonnees = actives.concat(finies);
  return {
    liste: ordonnees.slice(0, plafond),
    omises: Math.max(0, ordonnees.length - plafond)
  };
}

/**
 * Cellule de compteur de Progression → nombre, ou `null` quand elle est VIDE.
 *
 * `null` et `0` ne disent pas la même chose : une campagne au RECENSEMENT n'a pas encore de base
 * (`''`), une campagne qui n'a rien traité en a une et vaut 0. Les confondre afficherait
 * « 0 / 0 · en cours » sur une campagne qui compte encore ses fichiers.
 */
function nombreProgressionHub_(cellule) {
  if (cellule === '' || cellule === null || cellule === undefined) return null;
  var n = Number(cellule);
  return isNaN(n) ? null : n;
}

/**
 * Pré-calcule les métriques du widget hub et les persiste (Property `DriveAI_HUB_SUMMARY`, JSON
 * borné par `HUB_SUMMARY_MAX_OCTETS` ≪ 9 Ko). Appelée UNE fois par tick, dans le finally, ENVELOPPÉE (Main.gs) :
 * un échec ne bloque jamais l'intake. Le calcul (getValues + liste Drive) est ici sans risque de
 * délai — le tick a son propre garde-temps. `lastRunAt` = heartbeat DriveAI_LAST_TICK (écrit juste
 * avant dans le même finally). ADR-0007 : métadonnées seulement.
 */
function majResumeHub_() {
  var props = PropertiesService.getScriptProperties();
  var lastTick = Number(props.getProperty('DriveAI_LAST_TICK')) || 0;
  // THROTTLE (C28-34, 2026-07-31) : ce calcul relisait l'Index ENTIER + le Journal entier (depuis
  // DriveAI#806 : leur QUEUE seulement, repli sur l'onglet entier si la fenêtre ne suffit pas). Le
  // Journal est borné (20 000), l'Index NE L'EST PAS (append-only, §2) — il est à ~10 800 lignes et
  // le reset en ajoute ~2 par fichier. Le faire à CHAQUE tick (×288/j) est devenu le plus gros poste du socle
  // non budgété, au point de retarder le heartbeat (constaté : 24 min de retard le 2026-07-31).
  // Le widget hub n'a aucun besoin d'une fraîcheur à la minute : on recalcule au plus 1×/15 min.
  // La Property n'est écrite qu'APRÈS un calcul réussi (une panne rejoue au tick suivant).
  var dernierCalcul = Number(props.getProperty('DriveAI_HUB_MAJ_MS')) || 0;
  var precedent = lireResumeHubPersiste_(props);
  // Le calcul CHER est dû s'il n'a jamais eu lieu, si l'intervalle est écoulé, OU s'il n'existe
  // aucun résumé exploitable sur quoi bâtir un rafraîchissement partiel : republier un résumé
  // troué serait pire que de refaire le calcul (no-fake-data). Ce dernier cas s'auto-guérit — une
  // fois recalculé, l'horodatage repart et le throttle reprend.
  var lourdDu = !dernierCalcul || !precedent ||
    (Date.now() - dernierCalcul) >= CONFIG.HUB_RESUME_INTERVALLE_MS;
  // SÉPARER LE CHER DU FRAIS (C28-59, retour Marc « dans hubperso c'est pas à jour ») : le throttle
  // ci-dessus protégeait le quota, mais il gelait AUSSI les champs qui ne coûtent RIEN — dont
  // `lastRunAt`, que le hub affiche comme la fraîcheur de la donnée (`dataAsOf`). Résultat : le
  // widget annonçait un retard pouvant aller jusqu'à 15 min (+ 60 s de cache broker) alors que le
  // moteur venait de passer. Un indicateur de FRAÎCHEUR qui est lui-même périmé ne sert à rien.
  // Désormais : les compteurs CHERS (Index + Journal entiers, comptage Drive) restent throttlés à
  // 15 min ; les champs à coût nul (dernier passage, coût LLM du mois, activité Gmail du jour,
  // quota) sont rafraîchis à CHAQUE tick. L'écart résiduel ne porte donc plus que sur des
  // agrégats à 7 JOURS, pour qui 15 min valent 0,15 % de la fenêtre.
  var compte = lourdDu
    ? compterMetriquesHubBorne_(lireQueueOngletBornee_, Date.now())
    // Le dernier document classé vient de l'Index : il est donc du côté CHER, et se reporte tel
    // quel quand le calcul n'a pas lieu. Il porte SA PROPRE date (`lastFiledAt`), ce qui le rend
    // insensible au report — « il y a 22 min » reste vrai même publié par un tick qui n'a pas
    // relu l'Index, là où un « à l'instant » sans date aurait vieilli en silence.
    : {
      classes7j: precedent.filedLast7d, erreurs7j: precedent.errorsLast7d,
      dernierClasse: precedent.lastFiledAt
        ? {
          ts: Date.parse(String(precedent.lastFiledAt)),
          nom: String(precedent.lastFiledName || ''),
          domaine: String(precedent.lastFiledDomain || '')
        }
        : null
    };
  var lastFiled = compte.dernierClasse || null;
  // Avancement des campagnes — côté FRAIS (partage cher/frais de C28-59) : l'onglet Progression
  // vient d'être réécrit par `majProgressions_` dans le même `finally`, et une lecture bornée de
  // ~50 lignes n'a rien de commun avec la relecture de l'Index ENTIER que le throttle protège.
  // C'est aussi ce que Marc veut voir BOUGER : une mission gelée quinze minutes de plus que la
  // réalité est exactement la plainte qui a motivé C28-59.
  //
  // Try DÉDIÉ, comme le cumul de coût : une panne de lecture de l'onglet ne doit pas emporter les
  // compteurs ni le dernier document classé avec elle.
  var missions = { liste: [], omises: 0 };
  try {
    missions = missionsPourHub_(lireOngletBorne_('Progression', HUB_PROGRESSION_MAX), HUB_MISSIONS_MAX);
  } catch (e) {
    journalErreur_('Hub', 'Avancement des campagnes indisponible : ' + e);
  }
  // Coûts & quotas (bloc `usage` du hub) : coût LLM CUMULÉ + coût du MOIS + activité Gmail
  // du jour + état du quota Gmail. Métadonnées agrégées seulement (ADR-0007). Enveloppé :
  // une panne de mesure ne doit pas priver le hub des 4 compteurs.
  //
  // LES DEUX, et pas seulement le mois : le hub refuse d'additionner des montants qui ne
  // couvrent pas la même période. En ne publiant que le mois courant, DriveAI l'empêchait
  // d'afficher un total unique (FinanceAI publie un cumul). Le cumul devient donc le COÛT
  // publié, et le mois devient un QUOTA avec son budget pour limite — rien n'est perdu.
  //
  // Ces mesures sont à COÛT NUL (lecture de Properties) : elles sont donc du côté FRAIS du
  // partage cher/frais de C28-59 ci-dessus, rafraîchies à chaque tick.
  var llmCostTotalUsd = null, llmCostMonthUsd = null, llmBudgetCampagnesUsd = null;
  var gmailThreadsToday = null, gmailQuotaSuspended = false;
  // Le cumul a SON PROPRE try : il lit les Properties EN BLOC (`getProperties`), là où le reste
  // les lit une par une. Sous le même try, une panne de cette lecture-là aurait emporté le coût
  // du mois et l'activité Gmail avec elle — le hub aurait perdu tout le bloc `usage` pour une
  // mesure qui n'en est qu'une partie.
  try {
    llmCostTotalUsd = syntheseCoutTotal_().dollars;
  } catch (e) {
    journalErreur_('Hub', 'Cumul de coût indisponible : ' + e);
  }
  try {
    llmCostMonthUsd = syntheseCoutMois_().dollars;
    // Le seuil vient de CONFIG, jamais recopié côté Vercel : Marc le rajuste en éditant
    // Config.gs (10 → 30 → 65 → 110 → 10 depuis juillet). Une constante dupliquée dans le
    // broker aurait dérivé au premier rajustement, en affichant une jauge fausse sans rien
    // casser — exactement le genre de mensonge silencieux qu'on s'interdit.
    llmBudgetCampagnesUsd = CONFIG.LLM_BUDGET_CAMPAGNES;
    var aujourdhui = dateGmail_(new Date());
    gmailThreadsToday =
      compteurFilsJour_(props, 'DriveAI_GMAIL_HISTO', aujourdhui) +
      compteurFilsJour_(props, 'DriveAI_TRI_CYCLIQUE', aujourdhui) +
      compteurFilsJour_(props, 'DriveAI_TRI_BOITE', aujourdhui);
    var quotaDepuis = Number(props.getProperty('DriveAI_GMAIL_QUOTA')) || 0;
    gmailQuotaSuspended = !!quotaDepuis && Date.now() - quotaDepuis < CONFIG.GMAIL_QUOTA_RESONDE_MS;
  } catch (e) {
    journalErreur_('Hub', 'Mesure usage indisponible : ' + e);
  }
  var etat = {
    reviewQueueCount: lourdDu ? compterDossierRevue_() : precedent.reviewQueueCount,
    filedLast7d: compte.classes7j,
    errorsLast7d: compte.erreurs7j,
    lastRunAt: lastTick ? new Date(lastTick).toISOString() : null,
    // Champs additifs (bloc usage) : le broker Vercel les mappe si présents, les ignore sinon.
    // `llmCostTotalUsd` est ADDITIF : une web app pas encore redéployée ne le publie pas, et
    // le broker retombe alors proprement sur le mois (aucune version à synchroniser).
    llmCostTotalUsd: llmCostTotalUsd,
    llmCostMonthUsd: llmCostMonthUsd,
    llmBudgetCampagnesUsd: llmBudgetCampagnesUsd,
    gmailThreadsToday: gmailThreadsToday,
    gmailQuotaSuspended: gmailQuotaSuspended,
    // AVANCEMENT DES CAMPAGNES + DERNIER DOCUMENT CLASSÉ (HUB-MISSIONS, ADR-0057). Champs ADDITIFS :
    // un broker pas encore redéployé les ignore, il ne tombe pas.
    //
    // ⚠️ Le NOM DE FICHIER est une révision assumée de la doctrine, pas un oubli : l'ADR-0007 §2
    // liste `Fichier` parmi les métadonnées légitimes de l'Index, mais jusqu'ici aucun nom ne
    // SORTAIT du compte Google de Marc. L'ADR-0057 tranche la question et fixe le garde-fou qui
    // compte : le nom voyage dans `details`, JAMAIS dans `metrics` — le hub ne persiste que les
    // métriques (table `releves`), donc aucun nom de document de Marc n'atterrit dans sa base.
    missions: missions.liste,
    missionsOmises: missions.omises,
    lastFiledName: lastFiled && lastFiled.nom ? tronquerHub_(lastFiled.nom, HUB_NOM_FICHIER_MAX) : null,
    lastFiledDomain: lastFiled && lastFiled.domaine ? tronquerHub_(lastFiled.domaine, HUB_TEXTE_MAX) : null,
    lastFiledAt: lastFiled && isFinite(lastFiled.ts) ? new Date(lastFiled.ts).toISOString() : null
  };
  // GARDE DE TAILLE — échec fermé appliqué à la Property. Un `setProperty` au-delà de ~9 Ko est
  // REFUSÉ par Apps Script : le tick continuerait, et le hub servirait éternellement le dernier
  // résumé écrit sans que rien ne soit rouge. On sacrifie donc la partie OPTIONNELLE (l'avancement
  // des campagnes, le plus gros poste) plutôt que le résumé entier, et on le DIT au Journal —
  // sinon la dégradation serait elle-même silencieuse.
  var charge = JSON.stringify(etat);
  if (charge.length > HUB_SUMMARY_MAX_OCTETS) {
    journalErreur_('Hub', 'Résumé hub trop volumineux (' + charge.length + ' octets) : avancement des campagnes retiré.');
    etat.missions = [];
    etat.missionsOmises = missions.liste.length + missions.omises;
    charge = JSON.stringify(etat);
  }
  props.setProperty('DriveAI_HUB_SUMMARY', charge);
  // L'horodatage du calcul CHER n'avance QUE quand il a réellement eu lieu : sinon un
  // rafraîchissement bon marché repousserait indéfiniment le recalcul des compteurs 7 jours,
  // qui ne seraient alors jamais mis à jour (le throttle deviendrait un gel).
  if (lourdDu) props.setProperty('DriveAI_HUB_MAJ_MS', String(Date.now()));
}

/**
 * Dernier résumé hub persisté, ou `null` s'il n'existe pas / est illisible. Lecture seule.
 * @param {Properties} props
 * @return {?Object}
 */
function lireResumeHubPersiste_(props) {
  try {
    var brut = props.getProperty('DriveAI_HUB_SUMMARY');
    if (!brut) return null;
    var o = JSON.parse(brut);
    // Un résumé sans ses compteurs chers ne peut pas servir de base à un rafraîchissement partiel :
    // on préfère refaire le calcul complet plutôt que de republier des trous (no-fake-data).
    return o && typeof o.filedLast7d === 'number' && typeof o.errorsLast7d === 'number' &&
      typeof o.reviewQueueCount === 'number' ? o : null;
  } catch (e) { return null; }
}

/**
 * Taille RÉELLE de la file de revue = fichiers du dossier `00 · À vérifier` (source de vérité :
 * l'Index garde ses lignes `à vérifier` même après que Marc a vidé la file — compter l'Index
 * ne redescendrait jamais). Boucle bornée (plafond) : la file est ~vide en régime normal
 * (ADR-0016, revue = exception rare) — le plafond ne borne que le cas pathologique.
 */
function compterDossierRevue_() {
  var fichiers = DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER).getFiles();
  var n = 0;
  while (fichiers.hasNext() && n < 500) {
    fichiers.next();
    n++;
  }
  return n;
}

/**
 * Une fenêtre de queue (`{lignes, complet}`, cf. `lireQueueOngletBornee_`) suffit-elle à compter les
 * 7 derniers jours ? Oui si elle couvre tout l'onglet, ou si sa PREMIÈRE ligne de données est déjà
 * antérieure au seuil (l'onglet n'a que des ajouts : tout ce qui est plus récent est derrière).
 * Date illisible = non (repli sur la lecture entière, jamais un compte tronqué). PURE (testée).
 * @param {{lignes: Array[], complet: boolean}} fen
 * @param {number} colDate  index de la colonne Date (Index : 1 ; Journal : 0)
 * @param {number} seuilMs
 * @return {boolean}
 */
function fenetreCouvre7j_(fen, colDate, seuilMs) {
  if (fen.complet) return true;
  var premiere = fen.lignes[1];
  if (!premiere) return false;
  var ts = tsCellule_(premiere[colDate]);
  return !isNaN(ts) && ts < seuilMs;
}

/**
 * Même résultat que `compterMetriquesHub_` sur les onglets entiers, en ne lisant que leur QUEUE
 * (DriveAI#806). `lire(nom, maxLignes)` rend `{lignes, complet}` (injecté : `lireQueueOngletBornee_`
 * en production, un faux dans les tests). Repli sur l'onglet entier, par onglet, si la fenêtre ne
 * remonte pas à 7 jours, et pour l'Index si elle ne contient aucun document classé nommé :
 * « aucun document classé » serait faux (cf. `compterMetriquesHub_`). Suppose l'Index et le Journal
 * en ordre chronologique d'ajout, ce que garantit leur écriture par ajout.
 * @param {function(string, number): {lignes: Array[], complet: boolean}} lire
 * @param {number} maintenantMs
 * @return {{classes7j:number, erreurs7j:number, dernierClasse:?Object}}
 */
function compterMetriquesHubBorne_(lire, maintenantMs) {
  var seuil = maintenantMs - 7 * 24 * 60 * 60 * 1000;
  var idx = lire('Index', CONFIG.HUB_FENETRE_INDEX);
  var jr = lire('Journal', CONFIG.HUB_FENETRE_JOURNAL);
  var lignesIndex = idx.lignes, lignesJournal = jr.lignes;
  if (!fenetreCouvre7j_(idx, 1, seuil)) lignesIndex = lire('Index', Infinity).lignes;
  if (!fenetreCouvre7j_(jr, 0, seuil)) lignesJournal = lire('Journal', Infinity).lignes;
  var compte = compterMetriquesHub_(lignesIndex, lignesJournal, maintenantMs);
  if (!compte.dernierClasse && lignesIndex === idx.lignes && !idx.complet) {
    compte = compterMetriquesHub_(lire('Index', Infinity).lignes, lignesJournal, maintenantMs);
  }
  return compte;
}

/**
 * Compte, sur les lignes BRUTES de l'Index et du Journal (`getDataRange().getValues()`,
 * en-têtes incluses), les documents CLASSÉS et les ERREURS des 7 derniers jours. PURE (testée).
 * Schémas réels : Index = [clé, Date, nom, domaine, chemin, STATUT(5), empreinte, confiance] ;
 * Journal = [Date(0), NIVEAU(1), source, message]. Les cellules datetime arrivent en objets
 * Date (tsCellule_ absorbe Date ou chaîne). Un document re-classé par une campagne (`migre|…`)
 * ou redéposé (`drive|…`) compte UNE fois : clés normalisées par cleDocumentIndex_.
 * @param {Array[]} lignesIndex
 * @param {Array[]} lignesJournal
 * @param {number} maintenantMs
 * @return {{classes7j:number, erreurs7j:number}}
 */
function compterMetriquesHub_(lignesIndex, lignesJournal, maintenantMs) {
  var seuil = maintenantMs - 7 * 24 * 60 * 60 * 1000;

  var parDocument = {};
  // Le DERNIER document classé se cherche sur TOUT l'Index, jamais sur la fenêtre de 7 jours :
  // « rien de classé depuis douze jours » est une information — « aucun document classé »
  // serait faux, et c'est précisément le genre de vide qui se lit comme une panne.
  var dernierClasse = null;
  for (var i = 1; i < lignesIndex.length; i++) {
    var ligne = lignesIndex[i];
    if (String(ligne[5]) !== 'classé') continue;
    var ts = tsCellule_(ligne[1]);
    if (isNaN(ts)) continue;
    var nomFichier = String(ligne[2] || '');
    // Un nom VIDE ne remplace pas un nom connu : une ligne d'Index sans colonne `Fichier` (il en
    // existe, écrites par des campagnes anciennes) effacerait sinon le seul nom publiable.
    if (nomFichier && (dernierClasse === null || ts > dernierClasse.ts)) {
      dernierClasse = { ts: ts, nom: nomFichier, domaine: String(ligne[3] || '') };
    }
    if (ts < seuil) continue;
    parDocument[cleDocumentIndex_(String(ligne[0]))] = true;
  }
  var classes7j = Object.keys(parDocument).length;

  var erreurs7j = 0;
  for (var j = 1; j < lignesJournal.length; j++) {
    if (String(lignesJournal[j][1]) !== 'ERREUR') continue;
    var tsJ = tsCellule_(lignesJournal[j][0]);
    if (!isNaN(tsJ) && tsJ >= seuil) erreurs7j++;
  }

  return { classes7j: classes7j, erreurs7j: erreurs7j, dernierClasse: dernierClasse };
}

/**
 * Normalise une clé d'Index vers l'identité du DOCUMENT qu'elle vise, pour dédoublonner les
 * comptes (le même fichier re-classé par une campagne ne compte pas deux fois). PURE (testée).
 * `drive|<fileId>` / `shared|<fileId>` → `doc|<fileId>` ; `migre|<tag>|<fileId>` → `doc|<fileId>` ;
 * toute autre clé (PJ Gmail `messageId|i|nom|taille`…) reste elle-même (déjà unique par document).
 * @param {string} cle
 * @return {string}
 */
function cleDocumentIndex_(cle) {
  var seg = cle.split('|');
  if ((seg[0] === 'drive' || seg[0] === 'shared') && seg[1]) return 'doc|' + seg[1];
  if (seg[0] === 'migre' && seg[2]) return 'doc|' + seg[2];
  return cle;
}

/**
 * Horodatage ms d'une cellule Sheet : objet Date (`getValues()` sur une colonne datetime) ou
 * chaîne ISO — NaN si illisible. PURE (testée).
 * @param {*} v
 * @return {number}
 */
function tsCellule_(v) {
  if (v instanceof Date) return v.getTime();
  return Date.parse(String(v));
}

/**
 * Valide un threadId Gmail (donnée UTILISATEUR via HTTP) : hexadécimal court, jamais un
 * séparateur de clé d'Index (`|`) — il entre dans le préfixe `tri|<id>|` purgé par le tick.
 * PURE (testée). @return {string} threadId propre, ou ''
 */
function validerThreadId_(brut) {
  var t = String(brut || '').trim();
  return /^[a-zA-Z0-9]{8,32}$/.test(t) ? t : '';
}
