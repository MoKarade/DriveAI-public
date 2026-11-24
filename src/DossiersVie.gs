/**
 * DossiersVie.gs — Dossiers de vie existants et liens mails ↔ Drive (ADR-0081, vague 4a).
 *
 * 1. Charge 1×/run la carte des dossiers d'entités déjà classés dans `Index` (hors dossiers
 *    spéciaux `_`), sans aucun nouvel appel Drive, pour orienter le LLM vers les dossiers existants.
 * 2. Consigne dans l'onglet `Liens` le lien entre chaque courriel Gmail portant une pièce jointe
 *    et le document classé dans Drive (métadonnées seules, adresse nue seule : ADR-0007).
 */

var COLONNES_LIENS = ['Horodatage', 'ThreadId', 'MessageId', 'Expéditeur', 'Domaine', 'Chemin', 'FileId', 'Fichier'];

var MOTS_OUTILS_DOSSIERS_VIE_ = {
  les: 1, des: 1, une: 1, sur: 1, dans: 1, pour: 1, avec: 1, par: 1,
  mon: 1, mes: 1, vos: 1, nos: 1, aux: 1, est: 1, qui: 1, que: 1,
  the: 1, and: 1, for: 1, with: 1, from: 1, com: 1, net: 1, org: 1
};

var _dossiersVieCache = null;
var _dossiersVieErreurSignaleeRun = false;

var PROP_DOSSIERS_VIE_DIRECTS = 'DriveAI_DOSSIERS_VIE_DIRECTS';
var DOSSIERS_VIE_DIRECTS_MAX = 80;
var DOSSIERS_VIE_DIRECTS_MAX_CARS = 8000;

/**
 * Réinitialise le cache en mémoire des dossiers de vie au début d'un tick.
 */
function reinitialiserDossiersVieCache_() {
  _dossiersVieCache = null;
  _dossiersVieErreurSignaleeRun = false;
}

/**
 * Découpe un texte en jetons normalisés sans accents ni mots-outils (< 3 car. exclus). PURE.
 * @param {*} texte
 * @return {string[]}
 */
function normaliserJetonsDossier_(texte) {
  var brut = String(texte || '').toLowerCase();
  if (typeof brut.normalize === 'function') {
    brut = brut.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  var parts = brut.split(/[^a-z0-9]+/);
  var vus = {};
  var res = [];
  for (var i = 0; i < parts.length; i++) {
    var j = parts[i];
    if (j.length < 3 || MOTS_OUTILS_DOSSIERS_VIE_[j] || vus[j]) continue;
    vus[j] = true;
    res.push(j);
  }
  return res;
}

/**
 * Normalise un chemin `Index` en clé de dossier de vie `{ chemin, domaine, entite }`. PURE.
 * Ignore les dossiers spéciaux (`_`) et les chemins sans sous-dossier d'entité significatif.
 * @param {*} chemin
 * @return {?{chemin:string, domaine:string, entite:string}}
 */
function normaliserCleDossierVie_(chemin) {
  var propre = String(chemin || '').trim();
  if (!propre || propre.charAt(0) === '_') return null;
  var brutSegs = propre.split('/');
  var segs = [];
  for (var i = 0; i < brutSegs.length; i++) {
    var s = brutSegs[i].trim();
    if (s) segs.push(s);
  }
  if (segs.length < 2 || segs[0].charAt(0) === '_') return null;
  while (segs.length > 1 && /^\d{4}$/.test(segs[segs.length - 1])) {
    segs.pop();
  }
  if (segs.length < 2) return null;
  var entite = segs[segs.length - 1];
  if (entite.length < 3 || /^\d{4}$/.test(entite)) return null;
  return {
    chemin: segs.join('/'),
    domaine: segs[0],
    entite: entite
  };
}

/**
 * Formate une valeur de date issue de `Index` en `AAAA-MM-JJ`. PURE.
 * @param {*} val
 * @return {string}
 */
function formaterDateDossierVie_(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  var s = String(val || '').trim();
  return s ? s.slice(0, 10) : '';
}

/**
 * Agrège les lignes de `Index` (dernière ligne gagnante par fichier/clé) en dossiers de vie
 * (`classé`, `déplacé`, `manuel`) avec effectif et dernière date. PURE.
 * @param {Array[]} lignesIndex  lignes `[cle, traiteLe, fichier, domaine, chemin, statut]`
 * @return {Array<Object>}
 */
function construireDossiersVie_(lignesIndex) {
  if (!Array.isArray(lignesIndex)) return [];
  var dernier = {}, ordreCles = [];
  for (var i = 0; i < lignesIndex.length; i++) {
    var r = lignesIndex[i];
    if (!Array.isArray(r)) continue;
    var cleRaw = String(r[0] || '').trim();
    if (cleRaw.indexOf('epingle|') === 0) continue;
    var fid = (r[8] ? String(r[8]).trim() : '') || (typeof fileIdDeCleIndex_ === 'function' && cleRaw ? fileIdDeCleIndex_(cleRaw) : '');
    var k = fid ? 'fid|' + fid : (cleRaw ? 'cle|' + cleRaw : 'row|' + i);
    if (!(k in dernier)) ordreCles.push(k);
    dernier[k] = r;
  }
  var parChemin = {};
  var ordre = [];
  for (var j = 0; j < ordreCles.length; j++) {
    var l = dernier[ordreCles[j]];
    var st = String(l[5] || '').trim();
    if (st !== 'classé' && st !== 'déplacé' && st !== 'manuel') continue;
    var cle = normaliserCleDossierVie_(l[4]);
    if (!cle) continue;
    var jetons = normaliserJetonsDossier_(cle.entite);
    if (!jetons.length) continue;
    var dateDoc = formaterDateDossierVie_(l[1]);
    if (!parChemin[cle.chemin]) {
      parChemin[cle.chemin] = {
        chemin: cle.chemin,
        domaine: String(l[3] || cle.domaine || '').trim(),
        entite: cle.entite,
        jetons: jetons,
        nbDocs: 0,
        dernierDate: ''
      };
      ordre.push(parChemin[cle.chemin]);
    }
    var entree = parChemin[cle.chemin];
    entree.nbDocs++;
    if (dateDoc && (!entree.dernierDate || dateDoc > entree.dernierDate)) {
      entree.dernierDate = dateDoc;
    }
  }
  return ordre;
}

/**
 * Retourne les `max` dossiers de vie les plus pertinents pour un document `src`. PURE.
 * Exige au moins 1 jeton d'entité >= 4 car. (ou 2 jetons >= 3 car.) correspondant.
 * @param {Object} src
 * @param {Array<Object>} dossiers
 * @param {number} [max=3]
 * @return {Array<Object>}
 */
function chercherDossiersVie_(src, dossiers, max) {
  if (!src || !Array.isArray(dossiers) || !dossiers.length) return [];
  var limite = typeof max === 'number' && max > 0 ? max : 3;
  var reqJetons = normaliserJetonsDossier_([src.expediteur || '', src.sujet || '', src.nom || ''].join(' '));
  if (!reqJetons.length) return [];
  var ensemble = {};
  for (var i = 0; i < reqJetons.length; i++) ensemble[reqJetons[i]] = true;

  var candidats = [];
  for (var d = 0; d < dossiers.length; d++) {
    var dossier = dossiers[d];
    var jetons = dossier.jetons || [];
    var nbTotal = 0;
    var nbLong = 0;
    for (var j = 0; j < jetons.length; j++) {
      if (ensemble[jetons[j]]) {
        nbTotal++;
        if (jetons[j].length >= 4) nbLong++;
      }
    }
    if (nbLong >= 1 || nbTotal >= 2) {
      var score = nbTotal * (1 + Math.log(1 + (dossier.nbDocs || 0)) * 0.25);
      candidats.push({ dossier: dossier, score: score });
    }
  }
  candidats.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.dossier.nbDocs || 0) !== (a.dossier.nbDocs || 0)) {
      return (b.dossier.nbDocs || 0) - (a.dossier.nbDocs || 0);
    }
    return a.dossier.chemin < b.dossier.chemin ? -1 : (a.dossier.chemin > b.dossier.chemin ? 1 : 0);
  });
  var out = [];
  for (var k = 0; k < candidats.length && k < limite; k++) {
    out.push(candidats[k].dossier);
  }
  return out;
}

/**
 * Formate la liste des dossiers de vie retenus pour le contexte du prompt LLM. PURE.
 * @param {Array<Object>} correspondances
 * @return {string}
 */
function formaterContexteDossiersVie_(correspondances) {
  if (!Array.isArray(correspondances) || !correspondances.length) return '';
  var lignes = [];
  for (var i = 0; i < correspondances.length; i++) {
    var d = correspondances[i];
    var mois = d.dernierDate ? ', dernier ' + String(d.dernierDate).slice(0, 7) : '';
    lignes.push('- ' + d.chemin + ' (' + d.nbDocs + ' doc(s)' + mois + ')');
  }
  return 'Dossiers de vie existants dans Drive (privilégier si le document appartient au même dossier) :\n' +
    lignes.join('\n');
}

/** Normalise une clé de chemin de dossier de vie (déduplication). PURE. */
function cleNormDossierVie_(chemin) {
  var s = String(chemin || '').trim().toLowerCase();
  return (typeof s.normalize === 'function' ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s).replace(/\s+/g, ' ').trim();
}

var ZONES_EXCLUES_DOSSIER_VIE_ = {
  '04 · immigration': 1, 'anna': 1, '00 · a trier': 1, '00 · a verifier': 1,
  '_technique': 1, '_doublons': 1, '_medias': 1, 'donnees & exports': 1
};

/** Normalise une entrée de dossier de vie direct (null si invalide/système). PURE. */
function normaliserEntreeDossierVieDirect_(domaine, sousDossier, cheminComplet, horodatage) {
  var brut = String(cheminComplet || '').trim() || (domaine && sousDossier ? String(domaine).trim() + '/' + String(sousDossier).trim() : '');
  var cle = normaliserCleDossierVie_(brut), jetons = cle ? normaliserJetonsDossier_(cle.entite) : [];
  if (!cle || !jetons.length) return null;
  var domEff = String(domaine || cle.domaine || '').trim() || cle.domaine;
  var verif = [domEff].concat(cle.chemin.split('/'));
  for (var i = 0; i < verif.length; i++) {
    var sn = cleNormDossierVie_(verif[i]);
    if (ZONES_EXCLUES_DOSSIER_VIE_[sn] || sn.charAt(0) === '_' || /^00\s*·/.test(sn)) return null;
  }
  return { chemin: cle.chemin, domaine: domEff, entite: cle.entite, jetons: jetons, nbDocs: 0, dernierDate: formaterDateDossierVie_(horodatage || new Date()) };
}

/** Ajoute/rafraîchit `[chemin, date]` en LRU bornée (`max`, `maxCars`). PURE. */
function ajouterDossierVieDirectListe_(liste, entree, max, maxCars) {
  var lim = max > 0 ? max : DOSSIERS_VIE_DIRECTS_MAX, maxC = maxCars > 0 ? maxCars : DOSSIERS_VIE_DIRECTS_MAX_CARS;
  var cible = cleNormDossierVie_(entree && entree.chemin), out = [];
  (liste || []).forEach(function (x) {
    var ch = Array.isArray(x) ? String(x[0] || '') : String((x && x.chemin) || '');
    var dt = Array.isArray(x) ? String(x[1] || '') : String((x && x.dernierDate) || '');
    if (ch && cleNormDossierVie_(ch) !== cible) out.push([ch, dt]);
  });
  if (entree && entree.chemin) out.push([entree.chemin, entree.dernierDate || '']);
  if (out.length > lim) out = out.slice(out.length - lim);
  while (out.length > 1 && JSON.stringify(out).length > maxC) out.shift();
  return out;
}

/** Fusionne dossiers d'`Index` et directs (conserve le `nbDocs` réel d'`Index`). PURE. */
function fusionnerDossiersVie_(dossiersIndex, directs) {
  var res = [], parNorm = {};
  (dossiersIndex || []).forEach(function (d) {
    if (!d || !d.chemin) return;
    var c = { chemin: d.chemin, domaine: d.domaine, entite: d.entite, jetons: Array.isArray(d.jetons) ? d.jetons.slice() : normaliserJetonsDossier_(d.entite), nbDocs: Number(d.nbDocs) || 0, dernierDate: d.dernierDate || '' };
    parNorm[cleNormDossierVie_(c.chemin)] = c; res.push(c);
  });
  (directs || []).forEach(function (s) {
    var ent = Array.isArray(s) ? normaliserEntreeDossierVieDirect_('', '', s[0], s[1]) : (s && s.chemin ? normaliserEntreeDossierVieDirect_(s.domaine, '', s.chemin, s.dernierDate) : null);
    if (!ent) return;
    var k = cleNormDossierVie_(ent.chemin);
    if (!parNorm[k]) { parNorm[k] = ent; res.push(ent); }
    else if (ent.dernierDate && (!parNorm[k].dernierDate || ent.dernierDate > parNorm[k].dernierDate)) parNorm[k].dernierDate = ent.dernierDate;
  });
  return res;
}

function propsDossiersVieDirects_(nouvelleListe) {
  if (typeof PropertiesService === 'undefined' || typeof PropertiesService.getScriptProperties !== 'function') return [];
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props) return [];
    if (nouvelleListe !== undefined) {
      if (typeof props.setProperty === 'function') props.setProperty(PROP_DOSSIERS_VIE_DIRECTS, JSON.stringify(nouvelleListe));
      return nouvelleListe;
    }
    var parsed = JSON.parse(props.getProperty(PROP_DOSSIERS_VIE_DIRECTS) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

/** Adopte immédiatement un dossier (même vide) dans `DriveAI_DOSSIERS_VIE_DIRECTS` (LRU max 80) + maj cache. */
function enregistrerDossierVieDirect_(domaine, sousDossier, cheminComplet, horodatage) {
  var entree = normaliserEntreeDossierVieDirect_(domaine, sousDossier, cheminComplet, horodatage);
  if (!entree) return false;
  propsDossiersVieDirects_(ajouterDossierVieDirectListe_(propsDossiersVieDirects_(), entree, DOSSIERS_VIE_DIRECTS_MAX, DOSSIERS_VIE_DIRECTS_MAX_CARS));
  if (_dossiersVieCache !== null) _dossiersVieCache = fusionnerDossiersVie_(_dossiersVieCache, [entree]);
  return true;
}

/** Charge et met en cache (1×/run) `Index` + `DriveAI_DOSSIERS_VIE_DIRECTS`. Ne lève jamais. */
function dossiersVieCache_() {
  if (_dossiersVieCache !== null) return _dossiersVieCache;
  var dossiersIndex = [];
  try {
    var f = typeof feuille_ === 'function' ? feuille_('Index') : (typeof ss_ === 'function' && ss_() ? ss_().getSheetByName('Index') : null);
    var lastRow = f ? f.getLastRow() : 0;
    if (lastRow >= 2) dossiersIndex = construireDossiersVie_(f.getRange(2, 1, lastRow - 1, typeof f.getLastColumn === 'function' ? Math.min(9, Math.max(6, f.getLastColumn())) : 9).getValues());
  } catch (e) { dossiersIndex = []; }
  _dossiersVieCache = fusionnerDossiersVie_(dossiersIndex, propsDossiersVieDirects_());
  return _dossiersVieCache;
}

/**
 * Enregistre dans l'onglet `Liens` le lien entre un courriel Gmail (PJ) et son document Drive classé.
 * Écrit uniquement l'adresse nue et les métadonnées de placement (ADR-0007). Jamais bloquant.
 * @param {Object} src
 * @param {Object} decision
 */
function enregistrerLienMailDrive_(src, decision) {
  if (!src || !decision || !decision.fileId || decision.statut !== 'classé') return;
  var estGmail = !!(src.threadId || src.messageId || String(src.cle || '').indexOf('gmail|') === 0);
  if (!estGmail) return;
  var adresseNue = typeof adresseExpediteur_ === 'function'
    ? adresseExpediteur_(src.expediteur || '')
    : String(src.expediteur || '').replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
  try {
    var f = typeof feuille_ === 'function' ? feuille_('Liens') : null;
    if (!f && typeof ss_ === 'function') {
      var ss = ss_();
      if (!ss) return;
      if (typeof creerOnglet_ === 'function') creerOnglet_(ss, 'Liens', COLONNES_LIENS);
      f = ss.getSheetByName('Liens');
    }
    if (!f) return;
    f.appendRow([
      new Date(),
      src.threadId || '',
      src.messageId || '',
      adresseNue,
      decision.domaine || '',
      decision.chemin || '',
      decision.fileId,
      decision.nom || ''
    ]);
  } catch (e) {
    if (!_dossiersVieErreurSignaleeRun) {
      _dossiersVieErreurSignaleeRun = true;
      journalErreur_('DossiersVie', 'Écriture onglet Liens impossible : ' + e);
    }
  }
}
