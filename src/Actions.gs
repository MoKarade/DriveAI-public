/**
 * Actions.gs — Journal des actions autonomes et réversibles (ADR-0081, vague 3a).
 *
 * Chaque mutation importante posée par le moteur (déplacement Drive, création de libellé
 * Gmail, création de dossier…) est consignée avec son état Avant/Après dans l'onglet `Actions`
 * (métadonnées seules, jamais de contenu de document ni de corps de mail : ADR-0007).
 *
 * Annulation 1-clic : rétablit l'état antérieur par déplacement ou renommage inverse.
 * Aucune suppression automatique n'est jamais exécutée sur un fichier ni un libellé.
 */

var COLONNES_ACTIONS = ['Id', 'Horodatage', 'Type', 'Cible', 'Avant', 'Après', 'Statut', 'Détail'];

var _actionsErreurSignaleeRun = false;

/**
 * Valide un identifiant d'action (donnée utilisateur reçue par HTTP ou lue depuis la Sheet). PURE.
 * @param {*} id
 * @return {string} identifiant valide, ou ''
 */
function validerActionId_(id) {
  if (typeof id !== 'string') return '';
  return /^act-[A-Za-z0-9_-]{6,64}$/.test(id) ? id : '';
}

/**
 * Sérialise l'état Avant ou Après d'une action pour l'onglet `Actions` (métadonnées bornées). PURE.
 * @param {*} val
 * @return {string}
 */
function serialiserEtatAction_(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.slice(0, 300);
  try {
    return JSON.stringify(val).slice(0, 500);
  } catch (e) {
    return '';
  }
}

/**
 * Parse un état sérialisé de l'onglet `Actions` vers un objet JSON non null. PURE.
 * @param {*} brut
 * @return {?Object}
 */
function parserEtatAction_(brut) {
  if (typeof brut !== 'string' || !brut) return null;
  try {
    var o = JSON.parse(brut);
    return (o && typeof o === 'object') ? o : null;
  } catch (e) {
    return null;
  }
}

/**
 * Génère un identifiant unique d'action conforme à `validerActionId_`.
 * @return {string}
 */
function nouvelIdAction_() {
  var horo = Date.now().toString(36);
  var alea = (Math.random().toString(36) + '000000').slice(2, 8);
  return 'act-' + horo + '-' + alea;
}

/**
 * Journalise une action effectuée par le moteur dans l'onglet `Actions`.
 * Best-effort : une erreur Sheet ne doit jamais bloquer le pipeline ; elle est signalée une fois.
 * @param {string} type
 * @param {string} cible
 * @param {*} avant
 * @param {*} apres
 * @param {string=} detail
 * @return {string} l'identifiant créé, ou '' si l'écriture a échoué
 */
function enregistrerAction_(type, cible, avant, apres, detail) {
  var id = nouvelIdAction_();
  try {
    feuille_('Actions').appendRow([
      id,
      new Date(),
      String(type || ''),
      String(cible || ''),
      serialiserEtatAction_(avant),
      serialiserEtatAction_(apres),
      'appliqué',
      String(detail || '').slice(0, 200)
    ]);
    return id;
  } catch (e) {
    if (!_actionsErreurSignaleeRun) {
      _actionsErreurSignaleeRun = true;
      try { journalErreur_('Actions', 'Écriture dans Actions impossible : ' + e); } catch (e2) { }
    }
    return '';
  }
}

/**
 * Exécute l'opération inverse d'une action réversible (déplacement ou renommage Drive).
 * @param {string} type
 * @param {string} cible
 * @param {?Object} avant
 * @param {?Object} apres
 * @return {{ok:boolean, erreur:(string|undefined)}}
 */
function executerAnnulationType_(type, cible, avant, apres) {
  if (type === 'drive-deplacer') {
    if (!cible || !avant || !avant.parentId || !avant.nom || !apres || !apres.parentId) {
      return { ok: false, erreur: 'données incomplètes pour annuler le déplacement' };
    }
    if (!deplacerEtRenommer_(cible, avant.parentId, apres.parentId, avant.nom)) {
      return { ok: false, erreur: 'déplacement inverse refusé par Drive' };
    }
    return { ok: true };
  }
  if (type === 'drive-renommer') {
    if (!cible || !avant || !avant.nom) {
      return { ok: false, erreur: 'données incomplètes pour annuler le renommage' };
    }
    if (!renommer_(cible, avant.nom)) {
      return { ok: false, erreur: 'renommage inverse refusé par Drive' };
    }
    return { ok: true };
  }
  return {
    ok: false,
    erreur: 'annulation non prise en charge pour ce type (' + type + ') — aucune suppression automatique'
  };
}

/**
 * Annule une action enregistrée dans l'onglet `Actions` (idempotent si déjà annulée).
 * Refuse toute suppression automatique ; seuls les déplacements et renommages Drive sont rétablis.
 * @param {string} actionId
 * @return {{ok:boolean, actionId:(string|undefined), type:(string|undefined), dejaAnnule:(boolean|undefined), message:(string|undefined), erreur:(string|undefined)}}
 */
function annulerAction_(actionId) {
  var id = validerActionId_(actionId);
  if (!id) return { ok: false, erreur: 'actionId invalide' };

  var f = feuille_('Actions');
  var dern = f.getLastRow();
  if (dern < 2) return { ok: false, erreur: 'action introuvable' };

  var lignes = f.getRange(2, 1, dern - 1, 8).getValues();
  var idx = -1;
  for (var i = lignes.length - 1; i >= 0; i--) {
    if (String(lignes[i][0]) === id) { idx = i; break; }
  }
  if (idx === -1) return { ok: false, erreur: 'action introuvable' };

  var ligne = lignes[idx];
  var statut = String(ligne[6] || '');
  if (statut === 'annulé') {
    return { ok: true, dejaAnnule: true, actionId: id, message: 'Action déjà annulée.' };
  }
  if (statut !== 'appliqué') {
    return { ok: false, erreur: 'action non annulable (' + statut + ')' };
  }

  var type = String(ligne[2] || '');
  var cible = String(ligne[3] || '');
  var avant = parserEtatAction_(ligne[4]);
  var apres = parserEtatAction_(ligne[5]);
  var res = executerAnnulationType_(type, cible, avant, apres);
  if (!res.ok) return res;

  f.getRange(idx + 2, 7).setValue('annulé');
  try { journalInfo_('Actions', 'Action annulée (' + id + ', ' + type + ').'); } catch (e) { }
  return { ok: true, actionId: id, type: type, message: 'Action annulée.' };
}
