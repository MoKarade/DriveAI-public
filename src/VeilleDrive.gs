/**
 * VeilleDrive.gs — Veille automatique de la racine `Mon Drive` et des nouveaux dépôts en domaines.
 *
 * Défauts locaux (`VEILLE_DRIVE_ACTIF = true`, `VEILLE_DRIVE_MAX_PAR_RUN = 15`,
 * `VEILLE_DRIVE_BUDGET_MS = 20000`), surchargeables via `CONFIG` sans modifier `Config.gs`.
 * Déplacements réversibles seuls journalisés dans `Actions`, jamais aucune suppression.
 * `Marc` (racine système), `Anna` et `04 · Immigration` (multi-parents strict) restent intouchés.
 */

var _veilleErreurSignaleeRun = false;

/** Vrai si un dossier racine doit toujours rester intouché à la racine de `Mon Drive`. PURE. */
function estDossierExcluRacineVeille_(nom, exclusSup) {
  var propre = String(nom == null ? '' : nom).trim().toLowerCase();
  if (!propre) return true;
  if (propre === 'marc' || propre === 'anna') return true;
  if (/^00\s*·/.test(propre) || /^0[1-9]\s*·/.test(propre)) return true;
  var sup = exclusSup || [];
  for (var i = 0; i < sup.length; i++) {
    if (String(sup[i] || '').trim().toLowerCase() === propre) return true;
  }
  return false;
}

/** Retourne `'exports'`, `'technique'` ou `null` pour un dossier posé à la racine `Mon Drive`. PURE. */
function cibleDossierRacineVeille_(nom, exclusSup) {
  if (estDossierExcluRacineVeille_(nom, exclusSup)) return null;
  var n = String(nom || '').trim().toLowerCase();
  if (n === 'takeout') return 'exports';
  if (n === 'colab notebooks' || n === 'google ai studio' || n === 'sauvegardes' ||
      n === '_archive' || n === 'restic-pc' || n === 'univers' || n.charAt(0) === '_') {
    return 'technique';
  }
  return null;
}

/** Vrai si un nom de fichier système/guide/profil ne doit jamais être envoyé à `00 · À trier`. PURE. */
function estFichierExcluVeille_(nom) {
  var s = String(nom == null ? '' : nom).trim();
  if (!s) return true;
  if (typeof estExcluDuReset_ === 'function' && estExcluDuReset_(s)) return true;
  return /^driveai-profil/i.test(s) || /^00\s*·/.test(s);
}

/** Vrai si un fichier libre doit être déplacé vers `00 · À trier` pour classement. PURE. */
function estFichierNouveauAClasserVeille_(nom, id, dejaIndexe, epingle) {
  if (!id || epingle || dejaIndexe) return false;
  if (estFichierExcluVeille_(nom)) return false;
  return !/^\d{4}-\d{2}-\d{2}_/.test(String(nom || '').trim());
}

function journaliserErreurVeille_(contexte, err) {
  if (_veilleErreurSignaleeRun) return;
  _veilleErreurSignaleeRun = true;
  try { journalErreur_('VeilleDrive', contexte + ' : ' + err); } catch (e) { }
}

function deplacerObjetVeille_(item, cible, estDossier, detail) {
  try {
    var cibleId = cible.getId();
    var id = item.getId();
    var nom = item.getName();
    var parentId = '';
    var parents = [];
    var it = item.getParents();
    while (it.hasNext()) {
      var p = it.next();
      if (!parentId) parentId = p.getId();
      parents.push(p);
    }
    if (parentId === cibleId && parents.length === 1) return false;
    if (typeof item.moveTo === 'function') {
      item.moveTo(cible);
    } else if (!estDossier && typeof cible.addFile === 'function') {
      cible.addFile(item);
      for (var i = 0; i < parents.length; i++) {
        if (parents[i].getId() !== cibleId && typeof parents[i].removeFile === 'function') {
          parents[i].removeFile(item);
        }
      }
    } else if (typeof deplacerEtRenommer_ === 'function') {
      if (!deplacerEtRenommer_(id, cibleId, parentId, nom)) return false;
    } else {
      return false;
    }
    if (typeof enregistrerAction_ === 'function') {
      enregistrerAction_('drive-deplacer', id, { parentId: parentId, nom: nom }, { parentId: cibleId, nom: nom }, detail);
    }
    return true;
  } catch (e) {
    journaliserErreurVeille_('Déplacement impossible', e);
    return false;
  }
}

function dossierExportsVeille_() {
  var id08 = typeof CONFIG !== 'undefined' && CONFIG.DOMAINES && CONFIG.DOMAINES['08 · Perso & projets'];
  if (id08) {
    try {
      var d08 = DriveApp.getFolderById(id08);
      var it = d08.getFoldersByName('Données & exports');
      if (it.hasNext()) return it.next();
      if (typeof racineVivanteOuCreee_ === 'function') return racineVivanteOuCreee_(d08, 'Données & exports');
    } catch (e) {
      journaliserErreurVeille_('Accès Données & exports impossible', e);
    }
  }
  return typeof dossierTechnique_ === 'function' ? dossierTechnique_() : null;
}

function deplacerFichiersLibresDossierVeille_(dossier, aTrier, proteges, maxRestant, garde, sauterIndexe, detail) {
  var deplaces = 0;
  var it = dossier.getFiles();
  while (it.hasNext() && deplaces < maxRestant && !garde()) {
    var f = it.next();
    var id = f.getId();
    var nom = f.getName();
    try { if (f.getMimeType && f.getMimeType() === 'application/vnd.google-apps.shortcut') continue; } catch (e) { }
    var dejaIndexe = sauterIndexe && typeof indexContient_ === 'function' ? indexContient_('drive|' + id) : false;
    var epingle = typeof indexContient_ === 'function' ? indexContient_('epingle|' + id) : false;
    var eligible = sauterIndexe
      ? estFichierNouveauAClasserVeille_(nom, id, dejaIndexe, epingle)
      : (!epingle && !estFichierExcluVeille_(nom));
    if (!eligible) continue;
    if (proteges && typeof aParentProtege_ === 'function' && aParentProtege_(f, proteges, true)) continue;
    if (deplacerObjetVeille_(f, aTrier, false, detail)) deplaces++;
  }
  return deplaces;
}

function domainesVeilleNonProteges_() {
  var res = [];
  if (typeof CONFIG === 'undefined' || !CONFIG.DOMAINES) return res;
  var prot = CONFIG.DOMAINES_PROTEGES || [];
  var cles = Object.keys(CONFIG.DOMAINES);
  for (var i = 0; i < cles.length; i++) {
    if (prot.indexOf(cles[i]) === -1 && CONFIG.DOMAINES[cles[i]]) res.push({ nom: cles[i], id: CONFIG.DOMAINES[cles[i]] });
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var autos = CONFIG.DOMAINES_AUTO || [];
    for (var j = 0; j < autos.length; j++) {
      if (prot.indexOf(autos[j]) !== -1) continue;
      var idAuto = props.getProperty('DriveAI_DOM_' + autos[j]);
      if (idAuto) res.push({ nom: autos[j], id: idAuto });
    }
  } catch (e) { }
  return res;
}

/**
 * Veille automatique sur la racine `Mon Drive`, le dossier `Marc/` et un domaine par tick.
 * @param {function():boolean} estBudgetDepasse
 * @return {number} nombre d'éléments déplacés
 */
function veillerDrive_(estBudgetDepasse) {
  _veilleErreurSignaleeRun = false;
  if (typeof CONFIG !== 'undefined' && CONFIG.VEILLE_DRIVE_ACTIF === false) return 0;
  if (typeof estBudgetDepasse === 'function' && estBudgetDepasse()) return 0;
  if (typeof DriveApp === 'undefined' || typeof DriveApp.getRootFolder !== 'function') return 0;
  if (typeof CONFIG === 'undefined' || !CONFIG.DOSSIERS || !CONFIG.DOSSIERS.A_TRIER) return 0;

  var maxRun = CONFIG.VEILLE_DRIVE_MAX_PAR_RUN || 15;
  var budgetMs = CONFIG.VEILLE_DRIVE_BUDGET_MS || 20000;
  var debut = Date.now();
  var garde = function () {
    return (typeof estBudgetDepasse === 'function' && estBudgetDepasse()) || (Date.now() - debut >= budgetMs);
  };

  var aTrier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_TRIER);
  var racineDrive = DriveApp.getRootFolder();
  var proteges = typeof ensembleDomainesProteges_ === 'function' ? ensembleDomainesProteges_() : {};
  var deplaces = 0;

  deplaces += deplacerFichiersLibresDossierVeille_(
    racineDrive, aTrier, proteges, maxRun - deplaces, garde, false, 'Veille racine Mon Drive → 00 · À trier'
  );

  var exclusSup = CONFIG.VEILLE_DRIVE_EXCLUS || [];
  var itDir = racineDrive.getFolders();
  while (itDir.hasNext() && deplaces < maxRun && !garde()) {
    var d = itDir.next();
    var cibleType = cibleDossierRacineVeille_(d.getName(), exclusSup);
    if (!cibleType) continue;
    var dest = cibleType === 'exports'
      ? dossierExportsVeille_()
      : (typeof dossierTechnique_ === 'function' ? dossierTechnique_() : null);
    if (!dest) continue;
    if (deplacerObjetVeille_(d, dest, true, 'Veille racine Mon Drive (' + cibleType + ')')) deplaces++;
  }

  try {
    var psATrier = aTrier.getParents();
    if (psATrier.hasNext() && deplaces < maxRun && !garde()) {
      var racineMarc = psATrier.next();
      if (racineMarc.getId() !== racineDrive.getId()) {
        deplaces += deplacerFichiersLibresDossierVeille_(
          racineMarc, aTrier, proteges, maxRun - deplaces, garde, false, 'Veille dossier Marc → 00 · À trier'
        );
      }
    }
  } catch (e) {
    journaliserErreurVeille_('Lecture parent À trier impossible', e);
  }

  var domaines = domainesVeilleNonProteges_();
  if (domaines.length && deplaces < maxRun && !garde()) {
    try {
      var props = PropertiesService.getScriptProperties();
      var idx = Number(props.getProperty('DriveAI_VEILLE_DOM_IDX')) || 0;
      if (idx >= domaines.length) idx = 0;
      var dom = domaines[idx];
      props.setProperty('DriveAI_VEILLE_DOM_IDX', String((idx + 1) % domaines.length));
      var dossierDom = DriveApp.getFolderById(dom.id);
      deplaces += deplacerFichiersLibresDossierVeille_(
        dossierDom, aTrier, proteges, maxRun - deplaces, garde, true, 'Veille domaine (' + dom.nom + ') → 00 · À trier'
      );
    } catch (e2) {
      journaliserErreurVeille_('Veille domaine impossible', e2);
    }
  }

  return deplaces;
}
