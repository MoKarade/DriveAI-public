/**
 * DriveRest.gs — Opérations Drive via l'API REST (UrlFetchApp), Phase 2.
 *
 * On passe par REST (et pas le « service avancé Drive ») pour la même raison que
 * l'OCR : robustesse après `clasp push`, sans activation manuelle (cf. LESSONS).
 * Scopes utilisés : drive + script.external_request (déjà déclarés).
 *
 * Garde-fous : ces helpers DÉPLACENT ou créent des RACCOURCIS — jamais de
 * suppression d'un fichier utilisateur (un déplacement n'est pas une suppression).
 */

/** @return {string} jeton OAuth du script (compte de Marc). */
function jetonDrive_() {
  return ScriptApp.getOAuthToken();
}

/**
 * Appel Drive REST avec un retry léger borné (UN rejeu, 1 s) sur erreurs transitoires : 429, 5xx, et le 403 de
 * QUOTA (`userRateLimitExceeded` / `rateLimitExceeded`, DriveAI#897 : l'API Drive signale « en faire moins » en 403,
 * pas en 429). Évite qu'un pic de quota fasse échouer un placement ou une preuve de vie et déclenche un re-OCR +
 * re-LLM complet au tick suivant. Un 403 de DROIT (`insufficientFilePermissions`, `forbidden`…) n'est jamais rejoué.
 * @param {string} url
 * @param {Object} options
 * @return {HTTPResponse}
 */
function fetchDriveAvecRetry_(url, options) {
  var rep = UrlFetchApp.fetch(url, options);
  if (estReponseDriveTransitoire_(rep)) {
    Utilities.sleep(1000);
    rep = UrlFetchApp.fetch(url, options);
  }
  return rep;
}

/**
 * PURE (lit la réponse) — DriveAI#897 : une réponse Drive qui vaut la peine d'être rejouée une fois. 429 et 5xx comme
 * toujours ; 403 seulement si le corps nomme un plafond de débit (`rateLimitExceeded`, qui couvre `userRateLimitExceeded`
 * et `sharingRateLimitExceeded`) : un `dailyLimitExceeded` (quota du jour) ou un 403 de droit ne changeraient pas en 1 s.
 * @param {HTTPResponse} rep
 * @return {boolean}
 */
function estReponseDriveTransitoire_(rep) {
  var code = rep.getResponseCode();
  if (code === 429 || (code >= 500 && code < 600)) return true;
  if (code !== 403) return false;
  var corps = '';
  try { corps = String(rep.getContentText() || ''); } catch (e) { return false; }
  return /rateLimitExceeded/i.test(corps) && !/dailyLimitExceeded/i.test(corps); // « userRateLimitExceeded » : R majuscule
}

/**
 * ADR-0077 — taille et empreinte MD5 d'un fichier LUES DANS DRIVE (`files.get`, champs `size` et `md5Checksum`), sans
 * télécharger le contenu : valable à toute taille, y compris au-delà de `OCR_TAILLE_MAX`, et c'est l'état d'AUJOURD'HUI
 * du fichier (un exemplaire modifié depuis son classement a changé de md5). Un natif Google n'a ni taille ni md5 côté
 * Drive : `{ taille: null, md5: '' }`. DriveAI#897 : le MÊME appel rapporte `trashed` et `parents`, la preuve de vie
 * d'un exemplaire (ADR-0070, `etatPorteurDoublon_`) : preuve de vie ET empreinte en UN `files.get`, plus aucun
 * `DriveApp.getFileById`. Toute panne (HTTP ≠ 200, réseau, JSON) rend `null` ; ne lève jamais.
 * @param {string} fileId
 * @return {{taille:(number|null), md5:string, corbeille:boolean, parents:string[]}|null}
 */
function metaFichierRest_(fileId) {
  try {
    var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '?fields=' + encodeURIComponent('trashed,parents,size,md5Checksum'), {
      method: 'get', headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true
    });
    if (rep.getResponseCode() !== 200) {
      signalerPanneMetaRest_(fileId, 'HTTP ' + rep.getResponseCode() + ' : ' + String(rep.getContentText()).slice(0, 120));
      return null;
    }
    return metaDepuisReponseDrive_(JSON.parse(rep.getContentText()));
  } catch (e) {
    signalerPanneMetaRest_(fileId, String(e));
    return null;
  }
}

var _panneMetaRestSignaleeRun = false;

/**
 * Une panne de `files.get` est journalisée UNE fois par run (erreur jamais avalée, sans bruit) : l'appelant dégrade
 * en « non prouvé » (classé normalement) ou en hachage local, et une panne durable (quota, 403) doit se voir.
 * @param {string} fileId
 * @param {string} detail
 */
function signalerPanneMetaRest_(fileId, detail) {
  if (_panneMetaRestSignaleeRun) return;
  _panneMetaRestSignaleeRun = true;
  journalErreur_('Drive', 'Métadonnées REST illisibles pour ' + fileId + ' (' + detail +
    ') : ce run, les doublons se jugent sans Drive (hachage local, exemplaire non prouvé). Signalé une fois par run.');
}

/**
 * PURE — ADR-0077 : `{ taille, md5 }` depuis la réponse de `files.get`. `size` arrive en chaîne décimale (absente pour
 * un natif) ; `md5Checksum` est l'hex minuscule du MD5 des octets, le même que `empreinteBlob_` (absent pour un natif).
 * @param {Object} json
 * @return {{taille:(number|null), md5:string}}
 */
function metaDepuisReponseDrive_(json) {
  var brut = json && json.size != null ? String(json.size) : '';
  var taille = /^\d+$/.test(brut) ? Number(brut) : null;
  var md5 = json && typeof json.md5Checksum === 'string' ? json.md5Checksum.toLowerCase() : '';
  var parents = [];
  if (json && Array.isArray(json.parents)) {
    for (var i = 0; i < json.parents.length; i++) if (json.parents[i]) parents.push(String(json.parents[i]));
  }
  return { taille: taille, md5: md5, corbeille: !!json && json.trashed === true, parents: parents };
}

/**
 * Déplace un fichier vers un nouveau parent et le renomme, en un seul appel.
 * Le déplacement préserve l'ID Drive (donc la clé d'idempotence reste valable).
 *
 * @param {string} fileId        fichier à déplacer
 * @param {string} nouveauParent dossier cible
 * @param {string} ancienParent  dossier d'origine (retiré des parents)
 * @param {string} nouveauNom    nouveau nom du fichier
 * @return {boolean} vrai si le déplacement a réussi.
 */
function deplacerEtRenommer_(fileId, nouveauParent, ancienParent, nouveauNom) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId +
    '?addParents=' + encodeURIComponent(nouveauParent) +
    '&removeParents=' + encodeURIComponent(ancienParent) +
    '&fields=id';
  var rep = fetchDriveAvecRetry_(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ name: nouveauNom }),
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Drive', 'Déplacement HTTP ' + rep.getResponseCode() + ' : ' +
    tronquer_(rep.getContentText(), 300));
  return false;
}

/**
 * Renomme un fichier SANS le déplacer (PATCH du nom seul). Sert à la migration (#8) quand la
 * destination calculée est le dossier COURANT : passer le même ID en addParents ET removeParents
 * serait ambigu côté API — ici on ne touche qu'au nom.
 * @param {string} fileId
 * @param {string} nouveauNom
 * @return {boolean} vrai si le renommage a réussi.
 */
function renommer_(fileId, nouveauNom) {
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=id', {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ name: nouveauNom }),
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Drive', 'Renommage HTTP ' + rep.getResponseCode() + ' : ' +
    tronquer_(rep.getContentText(), 300));
  return false;
}

/** Restaure un fichier hors corbeille via Drive REST PATCH ({ trashed: false }), sans déplacer ni renommer. */
function restaurerFichierRest_(fileId) {
  if (!fileId) return false;
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,trashed&supportsAllDrives=true', {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ trashed: false }),
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Drive', 'Restauration HTTP ' + rep.getResponseCode() + ' : ' + tronquer_(rep.getContentText(), 300));
  return false;
}

/**
 * Crée un raccourci Drive vers un fichier, dans un dossier donné.
 * Sert au multi-entités (jamais de copie physique).
 *
 * @param {string} cibleId  fichier réel pointé
 * @param {string} parentId dossier où poser le raccourci
 * @param {string} nom      nom du raccourci
 * @return {boolean} vrai si le raccourci a été créé.
 */
function creerRaccourci_(cibleId, parentId, nom) {
  // Idempotent : si un raccourci vers la MÊME cible existe déjà dans ce dossier, ne rien recréer.
  // Nécessaire depuis la migration (#8) : un doc re-classé re-crée ses raccourcis multi-entités —
  // sans ce garde, chaque campagne (ou rejeu après coupure) dupliquerait les raccourcis. Best-effort :
  // si la vérification échoue, on crée quand même (un doublon de raccourci est bénin, un manquant non).
  if (raccourciExiste_(cibleId, parentId)) return true;
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      name: nom,
      mimeType: 'application/vnd.google-apps.shortcut',
      parents: [parentId],
      shortcutDetails: { targetId: cibleId }
    }),
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Drive', 'Raccourci HTTP ' + rep.getResponseCode() + ' : ' +
    tronquer_(rep.getContentText(), 300));
  return false;
}

/**
 * Vrai si le dossier contient déjà un raccourci pointant `cibleId`. L'API ne permet pas de filtrer
 * `shortcutDetails.targetId` dans `q` → on liste les raccourcis du dossier (rarement plus de quelques-uns)
 * et on compare côté client. Ne propage jamais d'exception (false au moindre doute → l'appelant crée).
 * @param {string} cibleId
 * @param {string} parentId
 * @return {boolean}
 */
function raccourciExiste_(cibleId, parentId) {
  try {
    var q = "'" + parentId + "' in parents and mimeType = 'application/vnd.google-apps.shortcut' and trashed = false";
    var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('files(shortcutDetails/targetId)') + '&pageSize=100', {
      method: 'get', headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true
    });
    if (rep.getResponseCode() !== 200) return false;
    var fichiers = (JSON.parse(rep.getContentText()).files) || [];
    for (var i = 0; i < fichiers.length; i++) {
      if (fichiers[i].shortcutDetails && fichiers[i].shortcutDetails.targetId === cibleId) return true;
    }
  } catch (e) { /* au moindre doute : false → création (un doublon de raccourci est bénin) */ }
  return false;
}

/**
 * Obtient le jeton de départ du journal des changements Drive (`changes/startPageToken`).
 * @return {string} jeton de départ, ou `''` en cas d'erreur
 */
function obtenirJetonChangementsDrive_() {
  try {
    var url = 'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=false';
    var rep = fetchDriveAvecRetry_(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + jetonDrive_() },
      muteHttpExceptions: true
    });
    if (rep.getResponseCode() !== 200) {
      journalErreur_('Drive', 'startPageToken HTTP ' + rep.getResponseCode() + ' : ' + String(rep.getContentText() || '').slice(0, 200));
      return '';
    }
    var json = JSON.parse(rep.getContentText() || '{}');
    return String(json.startPageToken || '');
  } catch (e) {
    journalErreur_('Drive', 'startPageToken impossible : ' + e);
    return '';
  }
}

/**
 * Liste une page du journal des changements Drive depuis `pageToken`.
 * @param {string} pageToken
 * @param {number=} pageSize
 * @return {{ok:boolean, changes:Array, nextPageToken:string, newStartPageToken:string}}
 */
function listerChangementsDrive_(pageToken, pageSize) {
  var vide = { ok: false, changes: [], nextPageToken: '', newStartPageToken: '' };
  if (!pageToken) return vide;
  try {
    var taille = Number(pageSize) > 0 ? Math.min(100, Math.round(Number(pageSize))) : 50;
    var fields = 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,trashed,parents))';
    var url = 'https://www.googleapis.com/drive/v3/changes?pageToken=' + encodeURIComponent(String(pageToken)) +
      '&pageSize=' + taille + '&spaces=drive&includeItemsFromAllDrives=false&supportsAllDrives=false' +
      '&fields=' + encodeURIComponent(fields);
    var rep = fetchDriveAvecRetry_(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + jetonDrive_() },
      muteHttpExceptions: true
    });
    if (rep.getResponseCode() !== 200) {
      journalErreur_('Drive', 'changes.list HTTP ' + rep.getResponseCode() + ' : ' + String(rep.getContentText() || '').slice(0, 200));
      return vide;
    }
    var json = JSON.parse(rep.getContentText() || '{}');
    return {
      ok: true,
      changes: Array.isArray(json.changes) ? json.changes : [],
      nextPageToken: String(json.nextPageToken || ''),
      newStartPageToken: String(json.newStartPageToken || '')
    };
  } catch (e) {
    journalErreur_('Drive', 'changes.list impossible : ' + e);
    return vide;
  }
}
