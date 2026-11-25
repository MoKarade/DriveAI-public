/**
 * VeilleDrive.gs — Veille automatique de la racine `Mon Drive` et des nouveaux dépôts en domaines.
 *
 * Défauts locaux (`VEILLE_DRIVE_ACTIF = true`, `VEILLE_DRIVE_MAX_PAR_RUN = 15`,
 * `VEILLE_DRIVE_BUDGET_MS = 20000`), surchargeables via `CONFIG` sans modifier `Config.gs`.
 * Déplacements réversibles seuls journalisés dans `Actions`, jamais aucune suppression.
 * `Marc` (racine système) et les dossiers système (`_Technique`, `_Doublons`, `_Médias`, `00 · À trier`, `00 · À vérifier`)
 * restent intouchés ; `Anna` et `04 · Immigration` sont suivis au catalogue en lecture seule sur Drive.
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

/** Normalise un segment/zone (minuscules, sans accents, espaces compactés). PURE. */
function normaliserZoneVeille_(v) {
  if (typeof normaliserCle_ === 'function') return normaliserCle_(v);
  var t = String(v == null ? '' : v).toLowerCase();
  if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.replace(/[’ʼ´']/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Vrai si un ancêtre appartient à un dossier système technique/tampon exclu du suivi récursif. PURE. */
function estSousZoneSystemeVeille_(nomsAncetres) {
  var zones = {
    '_technique': true,
    '_doublons': true,
    '_medias': true,
    '00 · a trier': true,
    '00 · a verifier': true
  };
  var liste = nomsAncetres || [];
  for (var i = 0; i < liste.length; i++) {
    var k = normaliserZoneVeille_(liste[i]);
    if (zones[k]) return true;
  }
  return false;
}

/** Vrai si un ancêtre appartient à une zone suivie en lecture seule au catalogue (jamais déplacée sur Drive). PURE. */
function estZoneCatalogueLectureSeuleVeille_(nomsAncetres) {
  var zones = {
    'anna': true,
    '04 · immigration': true,
    'donnees & exports': true
  };
  var liste = nomsAncetres || [];
  for (var i = 0; i < liste.length; i++) {
    var k = normaliserZoneVeille_(liste[i]);
    if (zones[k]) return true;
  }
  return false;
}

/** Vrai si un ancêtre appartient à une zone jamais déplacée automatiquement vers `00 · À trier`. PURE. */
function estSousZoneIgnoreeVeille_(nomsAncetres) {
  return estSousZoneSystemeVeille_(nomsAncetres) || estZoneCatalogueLectureSeuleVeille_(nomsAncetres);
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

/** Extrait le nom de domaine en tête d'un chemin logique (`05 · Carrière/...` → `'05 · Carrière'`, `Anna/...` → `'Anna'`). PURE. */
function domaineDeCheminVeille_(chemin) {
  var parts = String(chemin == null ? '' : chemin).split('/');
  var tete = String(parts[0] || '').trim();
  if (/^0[1-9]\s*·/.test(tete)) return tete;
  if (tete.toLowerCase() === 'anna') return 'Anna';
  return '';
}

/** Vrai si le statut d'Index autorise une mise à jour automatique vers `déplacé`/`corbeillé`. PURE. */
function statutSyncVeilleAutorise_(statut) {
  var s = String(statut == null ? '' : statut).trim();
  if (!s || s === 'quarantaine' || s === 'à vérifier') return false;
  if (typeof STATUTS_SYNC_INDEX !== 'undefined') return STATUTS_SYNC_INDEX[s] === true;
  return { 'classé': true, 'doublon': true, 'média': true, 'technique': true, 'déplacé': true, 'manuel': true, 'corbeillé': true }[s] === true;
}

/** Extrait le type documentaire d'un nom classé `AAAA[-MM[-JJ]]_Type[_Tiers]`. PURE. */
function extraireTypeNomVeille_(nom) {
  var base = String(nom == null ? '' : nom).trim().replace(/\.[^./\\]+$/, '').replace(/\s*\(\d+\)$/, '').trim();
  var m = base.match(/^(\d{4})(?:-\d{2})?(?:-\d{2})?_([^_]+)(?:_(.+))?$/);
  return m ? String(m[2] || '').replace(/\s+/g, ' ').trim() : '';
}

/** Extrait l'émetteur d'un nom classé `AAAA[-MM[-JJ]]_Type_Tiers` ('' si sentinelle, générique ou propriétaire). PURE. */
function extraireEmetteurNomVeille_(nom) {
  var base = String(nom == null ? '' : nom).trim().replace(/\.[^./\\]+$/, '').replace(/\s*\(\d+\)$/, '').trim();
  var m = base.match(/^(\d{4})(?:-\d{2})?(?:-\d{2})?_([^_]+)_(.+)$/);
  if (!m) return '';
  var tiers = String(m[3] || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (tiers.length < 2) return '';
  var cle = typeof normaliserCle_ === 'function' ? normaliserCle_(tiers) : tiers.toLowerCase();
  if (/^(inconnue?|n\/?a|n a|aucune?|autres?|document|sans|non identifie|non lisible)$/.test(cle)) return '';
  if (typeof estEntiteGenerique_ === 'function' && estEntiteGenerique_(tiers)) return '';
  if (typeof estProprietaireMarc_ === 'function' && estProprietaireMarc_(tiers)) return '';
  return tiers;
}

/** Vrai si un chemin ou domaine appartient aux zones protégées/système exclues de l'apprentissage. PURE. */
function estZoneExclueApprentissageVeille_(chemin, domaine) {
  var segs = String(chemin || '').split('/').filter(Boolean);
  if (segs.length && estSousZoneIgnoreeVeille_(segs)) return true;
  var d = normaliserZoneVeille_(domaine);
  if (!d) return false;
  if (d === 'anna' || d === '04 · immigration' || d.charAt(0) === '_' || /^00\s*·/.test(d)) return true;
  var prot = typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.DOMAINES_PROTEGES) ? CONFIG.DOMAINES_PROTEGES : [];
  for (var i = 0; i < prot.length; i++) if (normaliserZoneVeille_(prot[i]) === d) return true;
  return false;
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

function cheminParentFichierVeille_(fObj) {
  try {
    var it = fObj.getParents();
    if (!it.hasNext()) return '';
    return cheminDossierVeille_(it.next()).chemin;
  } catch (e) {
    return '';
  }
}

function cataloguerLectureSeuleVeille_(fid, nom, chemin) {
  if (!fid || estFichierExcluVeille_(nom) || typeof indexAjouter_ !== 'function') return false;
  var cheminPropre = formaterCheminLogiqueVeille_(String(chemin || '').split('/')) || String(chemin || '');
  var domaine = domaineDeCheminVeille_(cheminPropre);
  indexAjouter_('drive|' + fid, {
    statut: 'manuel',
    domaine: domaine,
    chemin: cheminPropre,
    nom: nom,
    fileId: fid
  });
  return true;
}

function synchroniserFichierIndexVeille_(fid, nomActuel, cheminConstat, disparu) {
  if (!fid || typeof lireLigneIndex_ !== 'function' || typeof decisionSyncIndex_ !== 'function' ||
      typeof indexAjouter_ !== 'function') return null;
  var cle = typeof derniereCleIndexPourFileId_ === 'function' ? derniereCleIndexPourFileId_(fid) : '';
  if (!cle && typeof indexContient_ === 'function' && indexContient_('drive|' + fid)) cle = 'drive|' + fid;
  if (!cle) return null;

  var lig = lireLigneIndex_(cle);
  if (!lig || !statutSyncVeilleAutorise_(lig.statut)) return null;

  var dejaEpingle = typeof indexContient_ === 'function' && indexContient_('epingle|' + fid);
  var dec = decisionSyncIndex_(
    { nom: lig.nom, chemin: lig.chemin, statut: lig.statut },
    { existe: !disparu, corbeille: Boolean(disparu), nom: nomActuel, chemin: cheminConstat }
  );
  if (!dec) return null;

  var cheminBrut = String(dec.chemin || cheminConstat || '');
  var cheminFinal = formaterCheminLogiqueVeille_(cheminBrut.split('/')) || dec.chemin || lig.chemin;
  var domaineCible = domaineDeCheminVeille_(cheminFinal);
  var domaineFinal = domaineCible || lig.domaine || '';
  var nomFinal = dec.nom || nomActuel || lig.nom;

  indexAjouter_('drive|' + fid, {
    statut: dec.statut,
    domaine: domaineFinal,
    chemin: cheminFinal,
    nom: nomFinal,
    fileId: fid
  });
  if (dec.statut === 'déplacé' && typeof indexContient_ === 'function' && !indexContient_('epingle|' + fid) &&
      normaliserZoneVeille_(cheminFinal).indexOf('00 · a trier') !== 0) {
    indexAjouter_('epingle|' + fid, {
      statut: 'épinglé',
      nom: nomFinal,
      domaine: domaineFinal,
      chemin: cheminFinal,
      fileId: fid
    });
  }

  var srcLogique = formaterCheminLogiqueVeille_(String(lig.chemin || '').split('/')) || String(lig.chemin || '');
  var norm = normaliserZoneVeille_;
  var vraiDeplacement = Boolean(norm(srcLogique) && norm(cheminFinal) && norm(srcLogique) !== norm(cheminFinal)) &&
    !(typeof normaliserCle_ === 'function' && typeof cheminsSyncCompatibles_ === 'function' && cheminsSyncCompatibles_(srcLogique, cheminFinal));
  if (lig.statut === 'classé' && dec.statut === 'déplacé' && !disparu && !dejaEpingle && vraiDeplacement &&
      domaineCible && !estZoneExclueApprentissageVeille_(srcLogique, lig.domaine) &&
      !estZoneExclueApprentissageVeille_(cheminFinal, domaineCible) && typeof enregistrerCorrection_ === 'function') {
    var emetteur = extraireEmetteurNomVeille_(nomFinal || lig.nom);
    if (emetteur) {
      var segs = String(cheminFinal || '').split('/').filter(Boolean);
      var cat = (segs.length >= 2 && typeof CONFIG !== 'undefined' && CONFIG.CATEGORIES &&
        CONFIG.CATEGORIES[domaineCible] && CONFIG.CATEGORIES[domaineCible][segs[1]]) ? segs[1] : '';
      var dv = typeof normaliserCleDossierVie_ === 'function' ? normaliserCleDossierVie_(cheminFinal) : null;
      var ent = dv && dv.entite ? dv.entite : (segs.length >= 2 && !/^\d{4}$/.test(segs[segs.length - 1]) ? segs[segs.length - 1] : '');
      if (ent && ((cat && norm(ent) === norm(cat)) || ent.length < 3 ||
          (typeof estEntiteGenerique_ === 'function' && estEntiteGenerique_(ent)) ||
          (typeof estProprietaireMarc_ === 'function' && estProprietaireMarc_(ent)))) ent = '';
      try {
        enregistrerCorrection_({
          fichier: nomFinal, emetteur: emetteur, domaine: domaineCible,
          categorie: cat, entite: ent, type: extraireTypeNomVeille_(nomFinal || lig.nom)
        });
      } catch (eCorr) {
        journaliserErreurVeille_('Enregistrement correction impossible', eCorr);
      }
    }
  }
  return { statut: dec.statut, chemin: cheminFinal, nom: nomFinal };
}

function synchroniserArborescenceDossierVeille_(dirObj, cheminBase, maxSync, garde, cataloguerInconnus) {
  var maxProfondeur = 6;
  var maxSousDossiers = (typeof CONFIG !== 'undefined' && CONFIG.VEILLE_DOSSIER_MAX_SOUS_DOSSIERS) || 30;
  var plafondSync = maxSync > 0 ? maxSync : 0;
  var maj = 0;
  var tronque = false;
  if (!dirObj || plafondSync <= 0) return { maj: 0, tronque: plafondSync <= 0 };

  var file = [{ dossier: dirObj, chemin: cheminBase, profondeur: 0, lectureSeule: Boolean(cataloguerInconnus) }];
  var vus = {};
  var sousDossiersVus = 0;

  while (file.length && sousDossiersVus < maxSousDossiers && maj < plafondSync && !garde()) {
    var courant = file.shift();
    var did = courant.dossier.getId();
    if (vus[did]) continue;
    vus[did] = true;
    sousDossiersVus++;
    var lsCourant = Boolean(courant.lectureSeule) ||
      estZoneCatalogueLectureSeuleVeille_(String(courant.chemin || '').split('/'));

    var itF = courant.dossier.getFiles();
    while (itF.hasNext() && maj < plafondSync && !garde()) {
      var f = itF.next();
      try { if (f.isTrashed && f.isTrashed()) continue; } catch (eTr) { }
      var ffid = f.getId();
      var fnom = f.getName();
      if (synchroniserFichierIndexVeille_(ffid, fnom, courant.chemin, false)) {
        maj++;
      } else if (lsCourant) {
        var dejaIdx = (typeof derniereCleIndexPourFileId_ === 'function' && Boolean(derniereCleIndexPourFileId_(ffid))) ||
          (typeof indexContient_ === 'function' && indexContient_('drive|' + ffid));
        if (!dejaIdx && cataloguerLectureSeuleVeille_(ffid, fnom, courant.chemin)) maj++;
      }
    }
    if (itF.hasNext()) tronque = true;

    if (courant.profondeur < maxProfondeur && maj < plafondSync && !garde()) {
      var itD = courant.dossier.getFolders();
      while (itD.hasNext() && !garde()) {
        var sd = itD.next();
        var sdNom = sd.getName();
        if (estSousZoneSystemeVeille_([sdNom]) || vus[sd.getId()]) continue;
        var sdChemin = courant.chemin ? courant.chemin + '/' + sdNom : sdNom;
        file.push({
          dossier: sd,
          chemin: sdChemin,
          profondeur: courant.profondeur + 1,
          lectureSeule: lsCourant || estZoneCatalogueLectureSeuleVeille_([sdNom])
        });
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
        if (fid !== racineId) {
          try {
            var dirObj = DriveApp.getFolderById(fid);
            var infoDir = cheminDossierVeille_(dirObj);
            var ancDir = nomsAncetresItemVeille_(dirObj);
            if (infoDir.chemin && !estSousZoneSystemeVeille_(infoDir.ancetresEtNom) && !estSousZoneSystemeVeille_(ancDir)) {
              var estLectureSeule = estZoneCatalogueLectureSeuleVeille_(infoDir.ancetresEtNom) ||
                estZoneCatalogueLectureSeuleVeille_(ancDir);
              var domDir = domaineDeCheminVeille_(infoDir.chemin);
              if (!estLectureSeule && !estZoneExclueApprentissageVeille_(infoDir.chemin, domDir)) {
                var nomDir = dirObj.getName() || meta.name, ancienNomPont = '';
                if (typeof entiteValideeParDossierId_ === 'function' && typeof renommerEntiteDepuisDossier_ === 'function') {
                  try {
                    var entExist = entiteValideeParDossierId_(fid);
                    if (entExist && entExist.entite) ancienNomPont = String(entExist.entite);
                    if (entExist && nomDir && String(entExist.entite).trim() !== String(nomDir).trim()) {
                      renommerEntiteDepuisDossier_(entExist.entite, nomDir, entExist.domaine || domDir);
                    }
                  } catch (eRen) { journaliserErreurVeille_('Propagation renommage entité impossible', eRen); }
                }
                var ancienCheminPont = ancienNomPont && ancienNomPont !== nomDir ? infoDir.chemin.replace(/\/[^/]+$/, '/' + ancienNomPont) : '';
                if (typeof enregistrerDossierVieDirect_ === 'function') {
                  try { enregistrerDossierVieDirect_(domDir, nomDir, infoDir.chemin, null, ancienCheminPont); }
                  catch (eDV) { journaliserErreurVeille_('Adoption dossier vie impossible', eDV); }
                }
                if (typeof orienterPontDriveGmail_ === 'function') {
                  try { orienterPontDriveGmail_(domDir, nomDir, infoDir.chemin, ancienNomPont, fid); }
                  catch (ePont) { journaliserErreurVeille_('Pont Drive→Gmail impossible', ePont); }
                }
              }
              var sync = syncRestant > 0 && !garde()
                ? synchroniserArborescenceDossierVeille_(dirObj, infoDir.chemin, syncRestant, garde, estLectureSeule)
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

      if (estFichierExcluVeille_(meta.name)) continue;
      try {
        var fObj = DriveApp.getFileById(fid);
        var anc = nomsAncetresItemVeille_(fObj);
        if (estSousZoneSystemeVeille_(anc)) continue;
        if ((proteges && typeof aParentProtege_ === 'function' && aParentProtege_(fObj, proteges, true)) ||
            estZoneCatalogueLectureSeuleVeille_(anc)) {
          if (syncRestant > 0) {
            var chParent = cheminParentFichierVeille_(fObj);
            if (cataloguerLectureSeuleVeille_(fid, meta.name, chParent)) {
              syncRestant--;
              try {
                journalInfo_('VeilleDrive', 'Document catalogué (lecture seule) : ' + meta.name + ' → ' + (chParent || 'Mon Drive'));
              } catch (eLog2) { }
            }
          }
          continue;
        }
        var epingle = typeof indexContient_ === 'function' && indexContient_('epingle|' + fid);
        if (!estFichierNouveauAClasserVeille_(meta.name, fid, false, epingle)) continue;
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
