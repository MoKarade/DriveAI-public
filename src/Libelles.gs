/**
 * Libelles.gs — Bascule et remplacement avec preuves des libellés Gmail (ADR-0081, vague 3d).
 *
 * Quand des preuves montrent qu'un libellé vaut mieux qu'un autre (ou pour consolider sous
 * 10 libellés principaux / 50 au total), ce module :
 *  1. valide les preuves (`motif`, nombre minimum de fils observés) et protège les libellés spéciaux ;
 *  2. pose le nouveau libellé AVANT de retirer l'ancien sur un lot borné de fils ;
 *  3. met à jour `TriAppris` ;
 *  4. retire l'ancien libellé Gmail uniquement une fois tous ses fils reclassés, et journalise dans `Actions`.
 *
 * Aucun courriel n'est jamais supprimé.
 */

var LIBELLE_SWITCH_PROP = 'DriveAI_LIBELLE_SWITCH';

/** Vrai si `nom` désigne l'un des 3 libellés spéciaux du tri (`À vérifier`, `⚠️ Suspect`, `⏰ À traiter`). PURE. */
function estLibelleSpecialTri_(nom) {
  var n = normaliserLibelle_(nom);
  if (!n) return false;
  var spec = CONFIG.TRI_LIBELLES || {};
  for (var k in spec) {
    if (normaliserLibelle_(spec[k]) === n) return true;
  }
  return false;
}

/**
 * Valide qu'un remplacement `ancien` → `nouveau` est justifié par des preuves et respecte la hiérarchie. PURE.
 * @param {string} ancien
 * @param {string} nouveau
 * @param {{motif:string, filsObserves:number}} preuve
 * @param {string[]} [existants]
 * @return {{ok:boolean, erreur:string}}
 */
function validerPreuveRemplacement_(ancien, nouveau, preuve, existants) {
  var a = String(ancien || '').trim();
  var n = String(nouveau || '').trim();
  if (!a || !n) return { ok: false, erreur: 'libellé source ou cible manquant' };
  if (normaliserLibelle_(a) === normaliserLibelle_(n)) {
    return { ok: false, erreur: 'les deux libellés sont identiques' };
  }
  if (estLibelleSpecialTri_(a) || estLibelleSpecialTri_(n)) {
    return { ok: false, erreur: 'libellé spécial protégé' };
  }
  var motif = preuve && typeof preuve.motif === 'string' ? preuve.motif.trim() : '';
  if (motif.length < 5) return { ok: false, erreur: 'motif de preuve insuffisant' };
  var minFils = CONFIG.TRI_REMPLACEMENT_PREUVE_MIN_FILS || 5;
  if (!preuve || !(Number(preuve.filsObserves) >= minFils)) {
    return { ok: false, erreur: 'preuves insuffisantes (< ' + minFils + ' fils)' };
  }

  var liste = Array.isArray(existants) ? existants : [];
  var nNorm = normaliserLibelle_(n);
  var dejaExistant = false;
  for (var i = 0; i < liste.length; i++) {
    if (normaliserLibelle_(liste[i]) === nNorm) { dejaExistant = true; break; }
  }
  if (dejaExistant) return { ok: true, erreur: '' };

  var nomValide = validerNomNouveauLibelle_(n, liste);
  if (!nomValide) return { ok: false, erreur: 'nom cible invalide' };

  var sansAncien = [];
  var aNorm = normaliserLibelle_(a);
  for (var j = 0; j < liste.length; j++) {
    if (normaliserLibelle_(liste[j]) !== aNorm) sansAncien.push(liste[j]);
  }
  var struct = compterStructureLibelles_(sansAncien);
  var maxPrinc = CONFIG.TRI_LIBELLES_MAX_PRINCIPAUX || 10;
  var idxSlash = nomValide.indexOf('/');
  if (idxSlash === -1 && struct.nbPrincipaux >= maxPrinc) {
    return { ok: false, erreur: 'plafond de ' + maxPrinc + ' libellés principaux atteint' };
  }
  if (idxSlash !== -1) {
    var rNorm = normaliserLibelle_(nomValide.slice(0, idxSlash).trim());
    if (!struct.principaux[rNorm] && struct.nbPrincipaux >= maxPrinc) {
      return { ok: false, erreur: 'principal cible absent au plafond' };
    }
  }
  return { ok: true, erreur: '' };
}

/** Met à jour les règles apprises de `TriAppris` lors d'un remplacement de libellé. */
function migrerTriAppris_(ancienNom, nouveauNom) {
  var maj = 0;
  try {
    var f = feuille_('TriAppris');
    var dern = f.getLastRow();
    if (dern < 2) return 0;
    var v = f.getRange(2, 1, dern - 1, 2).getValues();
    var aNorm = normaliserLibelle_(ancienNom);
    for (var i = 0; i < v.length; i++) {
      if (v[i][1] && normaliserLibelle_(String(v[i][1])) === aNorm) {
        f.getRange(i + 2, 2).setValue(nouveauNom);
        maj++;
      }
    }
    if (maj > 0 && typeof reinitialiserTriApprisCache_ === 'function') {
      reinitialiserTriApprisCache_();
    }
  } catch (e) { /* best-effort */ }
  return maj;
}

/**
 * Exécute une passe reprenable de remplacement de `ancienNom` vers `nouveauNom` :
 * pose d'abord le nouveau libellé, retire l'ancien fil par fil, met à jour `TriAppris`,
 * puis retire l'ancien libellé Gmail une fois vide et consigne dans `Actions`.
 */
function remplacerLibelle_(ancienNom, nouveauNom, preuve, estBudgetDepasse, existantsOpt) {
  var existants = existantsOpt;
  if (!existants) {
    try { existants = Object.keys(libellesUtilisateur_()); } catch (e) { existants = []; }
  }
  var val = validerPreuveRemplacement_(ancienNom, nouveauNom, preuve, existants);
  if (!val.ok) return { ok: false, erreur: val.erreur };

  var ancien = GmailApp.getUserLabelByName(ancienNom);
  if (!ancien) return { ok: false, erreur: 'ancien libellé introuvable' };

  var nouveau = obtenirOuCreerLibelleRemplacement_(nouveauNom);
  if (!nouveau) return { ok: false, erreur: 'libellé cible indisponible' };

  var lot = CONFIG.TRI_REMPLACEMENT_LOT_FILS || 30;
  var fils = ancien.getThreads(0, lot);
  var migres = 0;
  for (var i = 0; i < fils.length; i++) {
    if (estBudgetDepasse && estBudgetDepasse()) break;
    nouveau.addToThread(fils[i]);
    ancien.removeFromThread(fils[i]);
    migres++;
  }

  migrerTriAppris_(ancienNom, nouveauNom);

  var restants = ancien.getThreads(0, 1);
  if (restants.length === 0) {
    ancien.deleteLabel();
    if (typeof reinitialiserLibellesCache_ === 'function') reinitialiserLibellesCache_();
    if (typeof enregistrerAction_ === 'function') {
      enregistrerAction_(
        'gmail-libelle-remplacer',
        ancienNom,
        ancienNom,
        nouveauNom,
        'Remplacé (' + migres + ' fil(s)) — ' + String(preuve.motif).trim()
      );
    }
    try {
      journalInfo_('TriGmail', 'Libellé « ' + ancienNom + ' » remplacé par « ' + nouveauNom + ' » (' + migres + ' fil(s)).');
    } catch (eLog) { }
    return { ok: true, termine: true, migres: migres };
  }
  return { ok: true, termine: false, migres: migres };
}

/** Planifie un remplacement de libellé validé, repris au fil des ticks via `PropertiesService`. */
function planifierRemplacementLibelle_(ancienNom, nouveauNom, motif, filsObserves, existantsOpt) {
  var preuve = { motif: String(motif || '').trim(), filsObserves: Number(filsObserves) || 0 };
  var existants = existantsOpt;
  if (!existants) {
    try { existants = Object.keys(libellesUtilisateur_()); } catch (e) { existants = []; }
  }
  var val = validerPreuveRemplacement_(ancienNom, nouveauNom, preuve, existants);
  if (!val.ok) return { ok: false, erreur: val.erreur };
  PropertiesService.getScriptProperties().setProperty(
    LIBELLE_SWITCH_PROP,
    JSON.stringify({ ancien: String(ancienNom).trim(), nouveau: String(nouveauNom).trim(), preuve: preuve })
  );
  return { ok: true };
}

/** Exécute une passe du remplacement planifié dans `DriveAI_LIBELLE_SWITCH` (coupée au frein 30 $). */
function traiterRemplacementLibelleEnCours_(estBudgetDepasse) {
  if (typeof budgetCampagnesAtteint_ === 'function' && budgetCampagnesAtteint_()) return;
  var props = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties)
    ? PropertiesService.getScriptProperties()
    : null;
  if (!props) return;
  var brut = props.getProperty(LIBELLE_SWITCH_PROP);
  if (!brut) return;

  var demande;
  try { demande = JSON.parse(brut); }
  catch (e) { props.deleteProperty(LIBELLE_SWITCH_PROP); return; }
  if (!demande || !demande.ancien || !demande.nouveau || !demande.preuve) {
    props.deleteProperty(LIBELLE_SWITCH_PROP);
    return;
  }

  try {
    var res = remplacerLibelle_(demande.ancien, demande.nouveau, demande.preuve, estBudgetDepasse);
    if (res.termine || (!res.ok && !(typeof estPanneGmail_ === 'function' && estPanneGmail_()))) {
      props.deleteProperty(LIBELLE_SWITCH_PROP);
    }
  } catch (eRun) {
    if (typeof signalerPanneGmail_ === 'function' && signalerPanneGmail_(eRun)) return;
    try { journalErreur_('TriGmail', 'Remplacement libellé différé : ' + eRun); } catch (e2) { }
  }
}
