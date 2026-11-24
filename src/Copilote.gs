/**
 * Copilote.gs — Moteur proactif : cascade (#5), anti-doublons, vides et corbeille sensible (#6).
 */
var COLONNES_COPILOTE = ['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations'];
var COPILOTE_DOSSIER_VIDES = 'Dossiers vides';
var COPILOTE_DECISIONS = { 'executer': 1, 'ignorer': 1, 'restaurer': 1, 'passer-auto': 1, 'desactiver-auto': 1 };
var COPILOTE_STATUTS_OUVERTS = { 'proposé': 1, 'auto': 1, 'actif': 1 };

function normaliserCopilote_(s) {
  if (typeof normaliserCle_ === 'function') return normaliserCle_(s);
  var t = String(s == null ? '' : s).toLowerCase();
  if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.replace(/[’ʼ´']/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Vrai si chemin ou domaine touche une zone protégée ou système (interdite aux mutations auto). PURE. */
function estZoneProtegeeCopilote_(chemin, domaine) {
  if (typeof estZoneExclueApprentissageVeille_ === 'function' && estZoneExclueApprentissageVeille_(chemin, domaine)) return true;
  var interdit = { '04 · immigration': 1, 'anna': 1, '00 · a trier': 1, '00 · a verifier': 1, '_technique': 1, '_doublons': 1, '_medias': 1, 'donnees & exports': 1 };
  var d = normaliserCopilote_(domaine);
  if (d && (interdit[d] || d.charAt(0) === '_' || /^00\s*·/.test(d))) return true;
  var segs = String(chemin || '').split('/');
  for (var i = 0; i < segs.length; i++) {
    var s = normaliserCopilote_(segs[i]);
    if (s && (interdit[s] || s.charAt(0) === '_' || /^00\s*·/.test(s))) return true;
  }
  return false;
}

/** Sérialise ActionJson en restant strictement <= 500 caractères (zéro PII). PURE. */
function serialiserActionCopilote_(obj) {
  var copie = {};
  if (obj && typeof obj === 'object') Object.keys(obj).forEach(function (k) { copie[k] = Array.isArray(obj[k]) ? obj[k].slice() : obj[k]; });
  var s = JSON.stringify(copie);
  while (s.length > 500 && Array.isArray(copie.ids) && copie.ids.length > 1) { copie.ids.pop(); s = JSON.stringify(copie); }
  return s.length <= 500 ? s : s.slice(0, 500);
}

function parserActionCopilote_(brut) {
  try { var o = brut && typeof brut === 'string' ? JSON.parse(brut) : null; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}

function cibleActionCopilote_(a) { return a ? String(a.cibleId || a.sourceId || a.dossierId || a.fileId || '') : ''; }

function correspondSujetCopilote_(sujetNorm, nom, chemin) {
  if (!sujetNorm || sujetNorm.length < 3) return false;
  var em = typeof extraireEmetteurNomVeille_ === 'function' ? normaliserCopilote_(extraireEmetteurNomVeille_(nom)) : '';
  if (em && em === sujetNorm) return true;
  var texte = normaliserCopilote_(nom) + ' ' + normaliserCopilote_(chemin);
  return new RegExp('(?:^|[^a-z0-9])' + sujetNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9])').test(texte);
}

/** PURE — Documents éligibles à un regroupement en cascade (#5) hors zones protégées, `epingle|` et `exclusions`. */
function candidatsCascade_(indexLignes, cibleDomaine, cibleChemin, cibleParentId, emetteurOuSujet, exclusions) {
  var sujetNorm = normaliserCopilote_(emetteurOuSujet);
  if (!sujetNorm || sujetNorm.length < 3 || !cibleChemin || !cibleParentId) return [];
  if (typeof estEntiteGenerique_ === 'function' && estEntiteGenerique_(emetteurOuSujet)) return [];
  if (typeof estProprietaireMarc_ === 'function' && estProprietaireMarc_(emetteurOuSujet)) return [];
  if (estZoneProtegeeCopilote_(cibleChemin, cibleDomaine)) return [];
  var excl = exclusions || {}, parId = {}, ordre = [], lignes = indexLignes || [];
  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i];
    var fid = typeof fileIdDeLigneIndex_ === 'function' ? fileIdDeLigneIndex_(l) : String(Array.isArray(l) ? (l[8] || '') : (l.fileId || ''));
    if (!fid) continue;
    if (!parId[fid]) ordre.push(fid);
    parId[fid] = {
      fileId: fid, nom: String(Array.isArray(l) ? (l[2] || '') : (l.nom || '')),
      domaine: String(Array.isArray(l) ? (l[3] || '') : (l.domaine || '')),
      chemin: String(Array.isArray(l) ? (l[4] || '') : (l.chemin || '')),
      statut: String(Array.isArray(l) ? (l[5] || '') : (l.statut || ''))
    };
  }
  var res = [], statOk = { 'classé': 1, 'déplacé': 1, 'manuel': 1 };
  for (var j = 0; j < ordre.length && res.length < 12; j++) {
    var it = parId[ordre[j]];
    if (!it || excl[it.fileId] || !statOk[it.statut] || !it.chemin || it.chemin === cibleChemin) continue;
    if (estZoneProtegeeCopilote_(it.chemin, it.domaine) || !correspondSujetCopilote_(sujetNorm, it.nom, it.chemin)) continue;
    res.push({ fileId: it.fileId, nom: it.nom, domaine: it.domaine, chemin: it.chemin });
  }
  return res;
}

function lireCartesCopilote_() {
  var f = feuille_('Copilote'), dern = f.getLastRow();
  if (dern < 2) return [];
  var vals = f.getRange(2, 1, dern - 1, COLONNES_COPILOTE.length).getValues(), out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    out.push({ row: i + 2, id: String(r[0]), horodatage: r[1], categorie: String(r[2] || ''), type: String(r[3] || ''),
      domaine: String(r[4] || ''), chemin: String(r[5] || ''), titre: String(r[6] || ''),
      actionJson: String(r[7] || ''), statut: String(r[8] || ''), validations: Number(r[9]) || 0 });
  }
  return out;
}

function enregistrerCarteCopilote_(carte) {
  var f = feuille_('Copilote'), existantes = lireCartesCopilote_();
  var json = serialiserActionCopilote_(carte.action || {}), cible = cibleActionCopilote_(carte.action);
  for (var i = 0; i < existantes.length; i++) {
    var c = existantes[i];
    if (!COPILOTE_STATUTS_OUVERTS[c.statut] || c.type !== carte.type) continue;
    var memeCible = cible && cibleActionCopilote_(parserActionCopilote_(c.actionJson)) === cible;
    if (!memeCible && !(carte.type === 'cascade' && carte.chemin && c.chemin === carte.chemin)) continue;
    if (c.actionJson !== json) {
      f.getRange(c.row, 2).setValue(new Date());
      f.getRange(c.row, 7).setValue(String(carte.titre || c.titre).slice(0, 140));
      f.getRange(c.row, 8).setValue(json);
    }
    return c.id;
  }
  var id = 'cop-' + Date.now().toString(36) + '-' + (Math.random().toString(36) + '0000').slice(2, 6);
  f.appendRow([id, new Date(), carte.categorie || 'carte', carte.type, carte.domaine || '', carte.chemin || '',
    String(carte.titre || '').slice(0, 140), json, carte.statut || 'proposé', Number(carte.validations) || 0]);
  return id;
}

function lireLignesIndexCopilote_() {
  var fi = feuille_('Index'), dern = fi.getLastRow();
  if (dern < 2) return [];
  var debut = Math.max(2, dern - ((typeof CONFIG !== 'undefined' && CONFIG.RESUME_MAX_LIGNES) || 15000) + 1);
  return fi.getRange(debut, 1, dern - debut + 1, 9).getValues();
}

function parentUniqueVivant_(fObj) {
  var it = fObj.getParents(), p = it.hasNext() ? it.next() : null;
  return (!p || it.hasNext()) ? null : p;
}

/** Propose (ou MAJ) une carte `cascade` vers `cible`. */
function proposerCascadeDossier_(cible, optLignes) {
  if (!cible || !cible.parentId || !cible.chemin || estZoneProtegeeCopilote_(cible.chemin, cible.domaine)) return '';
  var proteges = ensembleDomainesProteges_();
  try { var dc = DriveApp.getFolderById(cible.parentId); if (!dc || dc.isTrashed() || aParentProtege_(dc, proteges, true)) return ''; } catch (e) { return ''; }
  var lignes = optLignes || lireLignesIndexCopilote_(), exclusions = {};
  for (var i = 0; i < lignes.length; i++) { var fid = fileIdDeLigneIndex_(lignes[i]); if (fid && indexContient_('epingle|' + fid)) exclusions[fid] = true; }
  var cands = candidatsCascade_(lignes, cible.domaine, cible.chemin, cible.parentId, cible.emetteurOuSujet, exclusions), ids = [];
  for (var j = 0; j < cands.length; j++) {
    try {
      var f = DriveApp.getFileById(cands[j].fileId);
      if (!f || f.isTrashed() || aParentProtege_(f, proteges, true)) continue;
      var p = parentUniqueVivant_(f);
      if (p && p.getId() !== cible.parentId) ids.push(cands[j].fileId);
    } catch (eF) { }
  }
  if (!ids.length) return '';
  return enregistrerCarteCopilote_({ categorie: 'carte', type: 'cascade', domaine: cible.domaine || '', chemin: cible.chemin,
    titre: cible.titre || ('Regrouper ' + ids.length + ' doc(s) « ' + cible.emetteurOuSujet + ' »'), action: { cibleId: cible.parentId, ids: ids } });
}

function executerDeplacementCopilote_(fid, cibleId, domaine, chemin, idCarte, proteges) {
  if (!fid || indexContient_('epingle|' + fid)) return '';
  try {
    var f = DriveApp.getFileById(fid);
    if (!f || f.isTrashed() || aParentProtege_(f, proteges, true)) return '';
    var p = parentUniqueVivant_(f);
    if (!p || p.getId() === cibleId) return '';
    var nom = f.getName();
    if (!deplacerEtRenommer_(fid, cibleId, p.getId(), nom)) return '';
    indexAjouter_('drive|' + fid, { statut: 'déplacé', domaine: domaine, chemin: chemin, nom: nom, fileId: fid });
    return enregistrerAction_('drive-deplacer', fid, { parentId: p.getId(), nom: nom }, { parentId: cibleId, nom: nom }, 'Copilote ' + idCarte);
  } catch (e) { return ''; }
}

/** Exécute une décision (`executer`, `restaurer`, `ignorer`, `passer-auto`, `desactiver-auto`). */
function executerDecisionCopilote_(corps) {
  var id = corps && corps.id ? String(corps.id) : '', decision = corps && corps.decision ? String(corps.decision) : '';
  if (!id || !COPILOTE_DECISIONS[decision]) return { ok: false, erreur: 'paramètres invalides' };
  var fSheet = feuille_('Copilote'), cartes = lireCartesCopilote_(), carte = null;
  for (var i = 0; i < cartes.length; i++) if (cartes[i].id === id) { carte = cartes[i]; break; }
  if (!carte) return { ok: false, erreur: 'carte introuvable' };
  var seuil = (typeof CONFIG !== 'undefined' && CONFIG.COPILOTE_SEUIL_AUTO) || 3;
  var action = parserActionCopilote_(carte.actionJson), nbVal = carte.validations;

  if (decision === 'ignorer' || decision === 'desactiver-auto' || decision === 'passer-auto') {
    if (decision === 'passer-auto' && (carte.type === 'alerte-corbeille' || estZoneProtegeeCopilote_(carte.chemin, carte.domaine))) {
      return { ok: false, erreur: 'mode auto interdit sur cette carte' };
    }
    var ns = decision === 'ignorer' ? 'ignoré' : (decision === 'passer-auto' ? 'auto' : 'proposé');
    fSheet.getRange(carte.row, 9).setValue(ns);
    return { ok: true, id: id, statut: ns, actionIds: [], nbValidations: nbVal, proposerAuto: false, message: 'Statut mis à jour.' };
  }

  if (decision === 'restaurer') {
    var fid = String(action.fileId || '');
    if (carte.type !== 'alerte-corbeille' || !fid) return { ok: false, erreur: 'restauration invalide' };
    if (!restaurerFichierRest_(fid)) return { ok: false, erreur: 'restauration Drive refusée' };
    var nomF = '';
    try { nomF = DriveApp.getFileById(fid).getName(); } catch (eN) { }
    if (!nomF) { var cleIdx = derniereCleIndexPourFileId_(fid), ligIdx = cleIdx ? lireLigneIndex_(cleIdx) : null; nomF = ligIdx ? ligIdx.nom : fid; }
    indexAjouter_('drive|' + fid, { statut: 'manuel', domaine: carte.domaine, chemin: carte.chemin, nom: nomF, fileId: fid });
    journalInfo_('Copilote', 'Document restauré hors corbeille (' + fid + ').');
    nbVal += 1; fSheet.getRange(carte.row, 9).setValue('appliqué'); fSheet.getRange(carte.row, 10).setValue(nbVal);
    return { ok: true, id: id, statut: 'appliqué', actionIds: [], nbValidations: nbVal, proposerAuto: nbVal >= seuil, message: 'Document restauré sans déplacement.' };
  }

  if (estZoneProtegeeCopilote_(carte.chemin, carte.domaine)) return { ok: false, erreur: 'zone protégée — mutation refusée' };
  var proteges = ensembleDomainesProteges_(), intouchables = typeof ensembleIntouchables_ === 'function' ? ensembleIntouchables_() : {}, actionIds = [];

  if (carte.type === 'cascade') {
    var cibleId = String(action.cibleId || ''), ids = Array.isArray(action.ids) ? action.ids : [];
    if (!cibleId || !ids.length || proteges[cibleId] || intouchables[cibleId]) return { ok: false, erreur: 'cible invalide' };
    try { var dc = DriveApp.getFolderById(cibleId); if (!dc || dc.isTrashed() || aParentProtege_(dc, proteges, true)) return { ok: false, erreur: 'cible protégée' }; }
    catch (eDc) { return { ok: false, erreur: 'cible inaccessible' }; }
    for (var k = 0; k < ids.length; k++) { var aid = executerDeplacementCopilote_(String(ids[k]), cibleId, carte.domaine, carte.chemin, id, proteges); if (aid) actionIds.push(aid); }
  } else if (carte.type === 'doublon-dossier') {
    var srcId = String(action.sourceId || ''), dstId = String(action.cibleId || '');
    if (!srcId || !dstId || srcId === dstId || proteges[srcId] || intouchables[srcId] || proteges[dstId]) return { ok: false, erreur: 'dossiers invalides ou protégés' };
    try {
      var dSrc = DriveApp.getFolderById(srcId), dDst = DriveApp.getFolderById(dstId);
      if (aParentProtege_(dSrc, proteges, true) || aParentProtege_(dDst, proteges, true)) return { ok: false, erreur: 'zone protégée' };
      var itF = dSrc.getFiles(), aBouger = [];
      while (itF.hasNext() && aBouger.length < 30) aBouger.push(itF.next().getId());
      for (var m = 0; m < aBouger.length; m++) { var aidD = executerDeplacementCopilote_(aBouger[m], dstId, carte.domaine, carte.chemin, id, proteges); if (aidD) actionIds.push(aidD); }
    } catch (eDd) { return { ok: false, erreur: 'fusion impossible' }; }
  } else if (carte.type === 'dossier-vide') {
    var dId = String(action.dossierId || '');
    if (!dId || proteges[dId] || intouchables[dId]) return { ok: false, erreur: 'dossier protégé' };
    try {
      var dv = DriveApp.getFolderById(dId);
      if (!dv || dv.isTrashed() || aParentProtege_(dv, proteges, true)) return { ok: false, erreur: 'zone protégée' };
      if (dv.getFiles().hasNext() || dv.getFolders().hasNext()) return { ok: false, erreur: 'dossier non vide' };
      var pv = parentUniqueVivant_(dv), cibleVides = pv ? sousDossier_(dossierTechnique_(), COPILOTE_DOSSIER_VIDES) : null, nomDv = dv.getName();
      if (!pv || !deplacerEtRenommer_(dId, cibleVides.getId(), pv.getId(), nomDv)) return { ok: false, erreur: 'déplacement refusé' };
      var aidV = enregistrerAction_('drive-deplacer', dId, { parentId: pv.getId(), nom: nomDv }, { parentId: cibleVides.getId(), nom: nomDv }, 'Copilote dossier vide ' + id);
      if (aidV) actionIds.push(aidV);
    } catch (eDv) { return { ok: false, erreur: 'dossier vide inaccessible' }; }
  } else { return { ok: false, erreur: 'type non pris en charge' }; }

  nbVal += 1; fSheet.getRange(carte.row, 9).setValue('appliqué'); fSheet.getRange(carte.row, 10).setValue(nbVal);
  return { ok: true, id: id, statut: 'appliqué', actionIds: actionIds, nbValidations: nbVal, proposerAuto: nbVal >= seuil, message: 'Action exécutée (' + actionIds.length + ' élément(s)).' };
}

function detecterCorbeilleSensibleCopilote_(lignes, depasse, maxRestant) {
  var parId = {}, ordre = [], creees = 0;
  for (var i = 0; i < lignes.length; i++) {
    var fid = fileIdDeLigneIndex_(lignes[i]);
    if (!fid) continue;
    if (!parId[fid]) ordre.push(fid);
    parId[fid] = { nom: String(lignes[i][2] || ''), dom: String(lignes[i][3] || ''), chem: String(lignes[i][4] || ''), stat: String(lignes[i][5] || '') };
  }
  for (var j = ordre.length - 1; j >= 0 && creees < maxRestant && !depasse(); j--) {
    var id = ordre[j], it = parId[id];
    if (!it || it.stat !== 'corbeillé') continue;
    try {
      var f = DriveApp.getFileById(id);
      if (f && f.isTrashed()) {
        enregistrerCarteCopilote_({ categorie: 'carte', type: 'alerte-corbeille', domaine: it.dom, chemin: it.chem,
          titre: 'Document en corbeille : ' + it.nom.slice(0, 80), action: { fileId: id } });
        creees++;
      }
    } catch (e) { }
  }
  return creees;
}

function detecterDoublonsEtVidesCopilote_(depasse, maxRestant) {
  if (typeof domainesVeilleNonProteges_ !== 'function') return 0;
  var doms = domainesVeilleNonProteges_(), proteges = ensembleDomainesProteges_(), creees = 0;
  var intouchables = typeof ensembleIntouchables_ === 'function' ? ensembleIntouchables_() : {};
  var validees = typeof entitesValideesOuNull_ === 'function' ? entitesValideesOuNull_() : null;
  var quasiCle = function (n) { return normaliserCopilote_(n).replace(/([a-z0-9]{3,})s\b/g, '$1'); };
  for (var i = 0; i < doms.length && creees < maxRestant && !depasse(); i++) {
    var dom = doms[i];
    if (estZoneProtegeeCopilote_(dom.nom, dom.nom)) continue;
    var subs = typeof collecterSousDossiersFusion_ === 'function' ? collecterSousDossiersFusion_(dom.id, depasse) : [];
    var eligibles = subs.filter(function (s) { return s.nom.charAt(0) !== '_' && !/^00\s*·/.test(s.nom); });
    if (typeof clusteriserDossiers_ === 'function' && eligibles.length >= 2) {
      var clusters = clusteriserDossiers_(dom.nom, eligibles), vusSrc = {}, parQuasi = {};
      var estAncre = function (n) { return estAncreStructurelleFusion_(dom.nom, n); };
      var ajouterDoublon = function (src, cible) {
        if (creees >= maxRestant || src.id === cible.id || vusSrc[src.id] || estAncre(src.nom)) return;
        vusSrc[src.id] = true;
        enregistrerCarteCopilote_({ categorie: 'carte', type: 'doublon-dossier', domaine: dom.nom, chemin: dom.nom + '/' + src.nom,
          titre: 'Dossiers proches : ' + src.nom + ' → ' + cible.nom, action: { sourceId: src.id, cibleId: cible.id } });
        creees++;
      };
      clusters.forEach(function (cl) { var cb = cibleFusion_(cl, estAncre); cl.forEach(function (sq) { ajouterDoublon(sq, cb); }); });
      eligibles.forEach(function (dq) { var kq = quasiCle(dq.nom); if (kq) (parQuasi[kq] = parQuasi[kq] || []).push(dq); });
      Object.keys(parQuasi).forEach(function (kq) {
        if (parQuasi[kq].length < 2) return;
        var cq = cibleFusion_(parQuasi[kq], estAncre);
        parQuasi[kq].forEach(function (sq) { if (!(typeof anneesDistinctes_ === 'function' && anneesDistinctes_(sq.nom, cq.nom))) ajouterDoublon(sq, cq); });
      });
    }
    for (var v = 0; v < eligibles.length && creees < maxRestant && !depasse(); v++) {
      var sv = eligibles[v];
      if (proteges[sv.id] || intouchables[sv.id] || sv.nfiles > 0 || validees === null) continue;
      if (typeof estAncreStructurelleFusion_ === 'function' && estAncreStructurelleFusion_(dom.nom, sv.nom)) continue;
      if (Object.keys(validees).length ? (typeof estNoeudRecreablePrudent_ === 'function' && estNoeudRecreablePrudent_(sv.nom, validees))
        : (typeof estNoeudRecreable_ === 'function' && estNoeudRecreable_(sv.nom, {}))) continue;
      try {
        var dv = DriveApp.getFolderById(sv.id);
        if (!dv.isTrashed() && !dv.getFiles().hasNext() && !dv.getFolders().hasNext() && !aParentProtege_(dv, proteges, true)) {
          enregistrerCarteCopilote_({ categorie: 'carte', type: 'dossier-vide', domaine: dom.nom, chemin: dom.nom + '/' + sv.nom,
            titre: 'Dossier vide : ' + sv.nom, action: { dossierId: sv.id } });
          creees++;
        }
      } catch (eV) { }
    }
  }
  return creees;
}

function detecterCascadeTickCopilote_(lignes, depasse, maxRestant) {
  if (typeof extraireEmetteurNomVeille_ !== 'function') return 0;
  var vues = {}, creees = 0, sondees = 0;
  for (var i = lignes.length - 1; i >= 0 && creees < maxRestant && sondees < 20 && !depasse(); i--) {
    var l = lignes[i], nom = String(l[2] || ''), dom = String(l[3] || ''), chem = String(l[4] || ''), stat = String(l[5] || '');
    if ((stat !== 'classé' && stat !== 'déplacé' && stat !== 'manuel') || !chem || estZoneProtegeeCopilote_(chem, dom)) continue;
    var em = extraireEmetteurNomVeille_(nom);
    if (!em || vues[chem + '|' + normaliserCopilote_(em)]) continue;
    vues[chem + '|' + normaliserCopilote_(em)] = true;
    var fid = fileIdDeLigneIndex_(l);
    if (!fid) continue;
    sondees++;
    try {
      var f = DriveApp.getFileById(fid), p = f && !f.isTrashed() ? parentUniqueVivant_(f) : null;
      if (p && proposerCascadeDossier_({ domaine: dom, chemin: chem, parentId: p.getId(), emetteurOuSujet: em }, lignes)) creees++;
    } catch (e) { }
  }
  return creees;
}

/** Étape Copilote appelée par le tick (`Main.gs`), bornée par `COPILOTE_BUDGET_MS` et `COPILOTE_MAX_PAR_RUN`. */
function executerEtapeCopilote_(estBudgetDepasse) {
  if (typeof CONFIG === 'undefined' || !CONFIG.COPILOTE_ACTIF) return { traitees: 0, creees: 0 };
  var debut = Date.now(), budget = CONFIG.COPILOTE_BUDGET_MS || 15000, maxRun = CONFIG.COPILOTE_MAX_PAR_RUN || 15;
  var depasse = function () { return (estBudgetDepasse && estBudgetDepasse()) || (Date.now() - debut >= budget); };
  var traitees = 0, cartes = lireCartesCopilote_();
  for (var i = 0; i < cartes.length && traitees < maxRun && !depasse(); i++) {
    if (cartes[i].statut === 'auto' && cartes[i].type === 'cascade' && !estZoneProtegeeCopilote_(cartes[i].chemin, cartes[i].domaine)) {
      if (executerDecisionCopilote_({ id: cartes[i].id, decision: 'executer' }).ok) traitees++;
    }
  }
  var lignes = lireLignesIndexCopilote_(), creees = detecterCorbeilleSensibleCopilote_(lignes, depasse, maxRun);
  if (creees < maxRun && !depasse()) creees += detecterCascadeTickCopilote_(lignes, depasse, maxRun - creees);
  if (creees < maxRun && !depasse()) creees += detecterDoublonsEtVidesCopilote_(depasse, maxRun - creees);
  return { traitees: traitees, creees: creees };
}
