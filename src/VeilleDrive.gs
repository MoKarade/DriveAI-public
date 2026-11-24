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

/** Vrai si une entrée de `changes.list` est à ignorer d'emblée (retirée, raccourci, script, système). PURE. */
function estChangementDriveIgnorable_(ch, idsIgnores) {
  if (!ch || ch.removed || !ch.file || !ch.file.id) return true;
  if (idsIgnores && idsIgnores[ch.file.id]) return true;
  var mime = String(ch.file.mimeType || '');
  if (mime === 'application/vnd.google-apps.shortcut' || mime === 'application/vnd.google-apps.script') return true;
  return estFichierExcluVeille_(ch.file.name);
}

/** Vrai si un ancêtre appartient à une zone jamais touchée ni ré-aspirée vers `00 · À trier`. PURE. */
function estSousZoneIgnoreeVeille_(nomsAncetres) {
  var zones = {
    'anna': true,
    '04 · immigration': true,
    '_technique': true,
    '_doublons': true,
    '_médias': true,
    '00 · à trier': true,
    '00 · à vérifier': true,
    'données & exports': true
  };
  var liste = nomsAncetres || [];
  for (var i = 0; i < liste.length; i++) {
    var k = String(liste[i] || '').trim().toLowerCase();
    if (zones[k]) return true;
  }
  return false;
}

/** Formate un chemin logique d'arborescence (retire `Mon Drive` puis `Marc` en tête, segments joints par `/`). PURE. */
function formaterCheminLogiqueVeille_(segments) {
  var propre = [];
  var liste = segments || [];
  for (var i = 0; i < liste.length; i++) {
    var seg = String(liste[i] == null ? '' : liste[i]).trim();
    if (seg) propre.push(seg);
  }
  if (propre.length && propre[0].toLowerCase() === 'mon drive') propre.shift();
  if (propre.length && propre[0].toLowerCase() === 'marc') propre.shift();
  return propre.join('/');
}

/** Extrait le nom de domaine en tête d'un chemin logique (`05 · Carrière/...` → `'05 · Carrière'`). PURE. */
function domaineDeCheminVeille_(chemin) {
  var parts = String(chemin == null ? '' : chemin).split('/');
  var tete = String(parts[0] || '').trim();
  return /^0[1-9]\s*·/.test(tete) ? tete : '';
}

/** Vrai si le statut d'Index autorise une mise à jour automatique vers `déplacé`/`corbeillé`. PURE. */
function statutSyncVeilleAutorise_(statut) {
  var s = String(statut == null ? '' : statut).trim();
  if (!s || s === 'quarantaine' || s === 'à vérifier') return false;
  if (typeof STATUTS_SYNC_INDEX !== 'undefined') return STATUTS_SYNC_INDEX[s] === true;
  return { 'classé': true, 'doublon': true, 'média': true, 'technique': true, 'déplacé': true, 'manuel': true, 'corbeillé': true }[s] === true;
}

function cheminDossierVeille_(dirObj) {
  var segments = [];
  try {
    var vus = {};
    var did = dirObj.getId();
    if (did) vus[did] = true;
    var courant = null;
    var parents = dirObj.getParents();
    courant = parents.hasNext() ? parents.next() : null;
    for (var n = 0; courant && n < 8; n++) {
      var cid = courant.getId();
      if (cid && vus[cid]) break;
      if (cid) vus[cid] = true;
      segments.unshift(courant.getName());
      var ps = courant.getParents();
      courant = ps.hasNext() ? ps.next() : null;
    }
    segments.push(dirObj.getName());
  } catch (e) { }
  return { chemin: formaterCheminLogiqueVeille_(segments), ancetresEtNom: segments };
}

function synchroniserFichierIndexVeille_(fid, nomActuel, cheminConstat, disparu) {
  if (!fid || typeof lireLigneIndex_ !== 'function' || typeof decisionSyncIndex_ !== 'function' ||
      typeof indexAjouter_ !== 'function') return null;
  var cle = typeof derniereCleIndexPourFileId_ === 'function' ? derniereCleIndexPourFileId_(fid) : '';
  if (!cle && typeof indexContient_ === 'function' && indexContient_('drive|' + fid)) cle = 'drive|' + fid;
  if (!cle) return null;

  var lig = lireLigneIndex_(cle);
  if (!lig || !statutSyncVeilleAutorise_(lig.statut)) return null;

  var dec = decisionSyncIndex_(
    { nom: lig.nom, chemin: lig.chemin, statut: lig.statut },
    { existe: !disparu, corbeille: Boolean(disparu), nom: nomActuel, chemin: cheminConstat }
  );
  if (!dec) return null;

  var cheminBrut = String(dec.chemin || cheminConstat || '');
  var cheminFinal = formaterCheminLogiqueVeille_(cheminBrut.split('/')) || dec.chemin || lig.chemin;
  var domaineFinal = domaineDeCheminVeille_(cheminFinal) || lig.domaine || '';
  var nomFinal = dec.nom || nomActuel || lig.nom;

  indexAjouter_('drive|' + fid, {
    statut: dec.statut,
    domaine: domaineFinal,
    chemin: cheminFinal,
    nom: nomFinal,
    fileId: fid
  });
  if (dec.statut === 'déplacé' && typeof indexContient_ === 'function' && !indexContient_('epingle|' + fid) &&
      String(cheminFinal).indexOf('00 · À trier') !== 0) {
    indexAjouter_('epingle|' + fid, {
      statut: 'épinglé',
      nom: nomFinal,
      domaine: domaineFinal,
      chemin: cheminFinal,
      fileId: fid
    });
  }
  return { statut: dec.statut, chemin: cheminFinal, nom: nomFinal };
}

function synchroniserArborescenceDossierVeille_(dirObj, cheminBase, maxSync, garde) {
  var maxProfondeur = 6;
  var maxSousDossiers = (typeof CONFIG !== 'undefined' && CONFIG.VEILLE_DOSSIER_MAX_SOUS_DOSSIERS) || 30;
  var plafondSync = maxSync > 0 ? maxSync : 0;
  var maj = 0;
  var tronque = false;
  if (!dirObj || plafondSync <= 0) return { maj: 0, tronque: plafondSync <= 0 };

  var file = [{ dossier: dirObj, chemin: cheminBase, profondeur: 0 }];
  var vus = {};
  var sousDossiersVus = 0;

  while (file.length && sousDossiersVus < maxSousDossiers && maj < plafondSync && !garde()) {
    var courant = file.shift();
    var did = courant.dossier.getId();
    if (vus[did]) continue;
    vus[did] = true;
    sousDossiersVus++;

    var itF = courant.dossier.getFiles();
    while (itF.hasNext() && maj < plafondSync && !garde()) {
      var f = itF.next();
      try { if (f.isTrashed && f.isTrashed()) continue; } catch (eTr) { }
      if (synchroniserFichierIndexVeille_(f.getId(), f.getName(), courant.chemin, false)) maj++;
    }
    if (itF.hasNext()) tronque = true;

    if (courant.profondeur < maxProfondeur && maj < plafondSync && !garde()) {
      var itD = courant.dossier.getFolders();
      while (itD.hasNext() && !garde()) {
        var sd = itD.next();
        var sdNom = sd.getName();
        if (estSousZoneIgnoreeVeille_([sdNom]) || vus[sd.getId()]) continue;
        var sdChemin = courant.chemin ? courant.chemin + '/' + sdNom : sdNom;
        file.push({ dossier: sd, chemin: sdChemin, profondeur: courant.profondeur + 1 });
      }
    } else if (courant.profondeur >= maxProfondeur) {
      tronque = true;
    }
  }
  if (file.length > 0 || sousDossiersVus >= maxSousDossiers) tronque = true;
  return { maj: maj, tronque: tronque };
}

function nomsAncetresItemVeille_(item) {
  var noms = [];
  var vus = {};
  try {
    var pile = [];
    var it = item.getParents();
    while (it.hasNext()) pile.push(it.next());
    var pas = 0;
    while (pile.length && pas < 20) {
      pas++;
      var d = pile.shift();
      var did = d.getId();
      if (vus[did]) continue;
      vus[did] = true;
      noms.push(d.getName());
      var ps = d.getParents();
      while (ps.hasNext()) pile.push(ps.next());
    }
  } catch (e) { }
  return noms;
}

function idsIgnoresChangementsVeille_() {
  var set = {};
  if (typeof CONFIG === 'undefined') return set;
  if (CONFIG.SHEET_ID) set[CONFIG.SHEET_ID] = true;
  if (CONFIG.DOSSIERS) {
    if (CONFIG.DOSSIERS.A_TRIER) set[CONFIG.DOSSIERS.A_TRIER] = true;
    if (CONFIG.DOSSIERS.A_VERIFIER) set[CONFIG.DOSSIERS.A_VERIFIER] = true;
  }
  return set;
}

/**
 * Suivi direct des changements Drive via Changes API v3 (jamais bloquant, jeton avancé après succès).
 * @return {number} nombre d'éléments déplacés
 */
function suivreChangementsDrive_(aTrier, racineDrive, proteges, maxRestant, garde) {
  if (typeof CONFIG !== 'undefined' && CONFIG.VEILLE_CHANGES_ACTIF === false) return 0;
  if (typeof fetchDriveAvecRetry_ !== 'function' || typeof obtenirJetonChangementsDrive_ !== 'function' ||
      typeof listerChangementsDrive_ !== 'function') return 0;
  if (typeof UrlFetchApp === 'undefined' || typeof PropertiesService === 'undefined') return 0;

  var props = PropertiesService.getScriptProperties();
  var token = String(props.getProperty('DriveAI_CHANGES_TOKEN') || '');
  if (!token) {
    var initial = obtenirJetonChangementsDrive_();
    if (initial) {
      props.setProperty('DriveAI_CHANGES_TOKEN', initial);
      try { journalInfo_('VeilleDrive', 'Suivi direct des changements Drive initialisé (jeton actif).'); } catch (e) { }
    }
    return 0;
  }

  var idsIgnores = idsIgnoresChangementsVeille_();
  var exclusSup = (typeof CONFIG !== 'undefined' && CONFIG.VEILLE_DRIVE_EXCLUS) || [];
  var syncRestant = (typeof CONFIG !== 'undefined' && CONFIG.VEILLE_SYNC_MAX_FICHIERS_PAR_RUN) || 40;
  var racineId = racineDrive.getId();
  var deplaces = 0;

  for (var page = 0; page < 2 && deplaces < maxRestant && !garde(); page++) {
    var rep = listerChangementsDrive_(token, 50);
    if (!rep.ok) break;
    var liste = rep.changes || [];
    for (var i = 0; i < liste.length && deplaces < maxRestant && !garde(); i++) {
      var ch = liste[i];
      if (estChangementDriveIgnorable_(ch, idsIgnores)) continue;
      var meta = ch.file;
      var fid = String(meta.id);
      var cleExist = (typeof derniereCleIndexPourFileId_ === 'function' && derniereCleIndexPourFileId_(fid)) ||
        (typeof indexContient_ === 'function' && indexContient_('drive|' + fid) ? 'drive|' + fid : '');

      if (cleExist) {
        if (typeof constaterEtatDrive_ === 'function') {
          var constat = constaterEtatDrive_(fid);
          var resFich = synchroniserFichierIndexVeille_(
            fid,
            constat.nom || meta.name,
            constat.chemin,
            !constat.existe || constat.corbeille
          );
          if (resFich) {
            try {
              journalInfo_('VeilleDrive', 'Changement direct détecté : ' + resFich.nom + ' → ' + (resFich.chemin || resFich.statut));
            } catch (eLog) { }
          }
        }
        continue;
      }

      if (meta.trashed) continue;

      if (meta.mimeType === 'application/vnd.google-apps.folder') {
        var parentsMeta = Array.isArray(meta.parents) ? meta.parents : [];
        if (parentsMeta.indexOf(racineId) !== -1) {
          var cibleType = cibleDossierRacineVeille_(meta.name, exclusSup);
          if (cibleType) {
            var dest = cibleType === 'exports'
              ? dossierExportsVeille_()
              : (typeof dossierTechnique_ === 'function' ? dossierTechnique_() : null);
            if (dest) {
              try {
                if (deplacerObjetVeille_(DriveApp.getFolderById(fid), dest, true, 'Veille directe racine (' + cibleType + ')')) deplaces++;
              } catch (eDir) { journaliserErreurVeille_('Dossier change inaccessible', eDir); }
            }
            continue;
          }
        }
        if (!estDossierExcluRacineVeille_(meta.name, exclusSup)) {
          try {
            var dirObj = DriveApp.getFolderById(fid);
            var infoDir = cheminDossierVeille_(dirObj);
            if (!estSousZoneIgnoreeVeille_(infoDir.ancetresEtNom) && !estSousZoneIgnoreeVeille_(nomsAncetresItemVeille_(dirObj))) {
              var sync = syncRestant > 0 && !garde()
                ? synchroniserArborescenceDossierVeille_(dirObj, infoDir.chemin, syncRestant, garde)
                : { maj: 0, tronque: syncRestant <= 0 };
              syncRestant = Math.max(0, syncRestant - sync.maj);
              var libDir = infoDir.chemin || meta.name;
              var msgDir = sync.maj > 0
                ? 'Dossier modifié : ' + libDir + ' (' + sync.maj + ' document(s) mis à jour dans le catalogue' + (sync.tronque ? ', plafond atteint' : '') + ')'
                : 'Dossier modifié : ' + libDir + ' (arborescence à jour)';
              journalInfo_('VeilleDrive', msgDir);
            }
          } catch (eInfoDir) { }
        }
        continue;
      }

      var epingle = typeof indexContient_ === 'function' && indexContient_('epingle|' + fid);
      if (!estFichierNouveauAClasserVeille_(meta.name, fid, false, epingle)) continue;
      try {
        var fObj = DriveApp.getFileById(fid);
        if (proteges && typeof aParentProtege_ === 'function' && aParentProtege_(fObj, proteges, true)) continue;
        if (estSousZoneIgnoreeVeille_(nomsAncetresItemVeille_(fObj))) continue;
        if (deplacerObjetVeille_(fObj, aTrier, false, 'Veille directe changement → 00 · À trier')) deplaces++;
      } catch (eFich) {
        journaliserErreurVeille_('Fichier change inaccessible', eFich);
      }
    }

    var prochain = rep.nextPageToken || rep.newStartPageToken;
    if (prochain && prochain !== token) {
      token = prochain;
      try { props.setProperty('DriveAI_CHANGES_TOKEN', token); } catch (eProp) { }
    }
    if (!rep.nextPageToken) break;
  }

  return deplaces;
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

  try {
    deplaces += suivreChangementsDrive_(aTrier, racineDrive, proteges, maxRun - deplaces, garde);
  } catch (eChanges) {
    journaliserErreurVeille_('Suivi direct des changements impossible', eChanges);
  }

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
