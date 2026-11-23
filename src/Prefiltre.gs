/**
 * Prefiltre.gs — Gardes DÉTERMINISTES du tri Gmail (ADR-0075), gratuites, avant tout appel LLM.
 *
 * Deux étages :
 *   1. `ecarteParMotsCles_` — déterministe (expéditeur/sujet) : porte `ecarte` du verdict « à traiter ».
 *   2. `toucheZoneProtegee_` — déterministe (expéditeur/sujet/corps). Défense en profondeur du
 *      garde-fou §1 (immigration/fiscal), INDÉPENDANTE du jugement du LLM.
 * (L'étage 3, le mini-check d'importance sur sujet seul, est parti avec `Intentions.gs` le
 * 2026-11-06 : le tri décide « à traiter » sur sujet + corps, ADR-0075 6b.)
 */

/**
 * Étage 1 — filtre déterministe sur expéditeur/sujet. Gratuit.
 * @param {string} expediteur
 * @param {string} sujet
 * @return {boolean} vrai si le mail doit être écarté SANS appel LLM.
 */
function ecarteParMotsCles_(expediteur, sujet) {
  return contientMotif_((expediteur || '') + ' ' + (sujet || ''), CONFIG.PREFILTRE_MOTIFS_REJET);
}

/**
 * Garde-fou §1, défense en profondeur : vrai si le texte touche l'immigration/le statut ou la
 * fiscalité. Indépendant du `sensible` renvoyé par le LLM — sert de filet AVANT (on n'envoie même
 * pas le mail à l'extraction) et peut aussi re-vérifier la réponse du LLM en sortie.
 * @param {string} texte
 * @return {boolean}
 */
function toucheZoneProtegee_(texte) {
  return contientMotif_(texte || '', CONFIG.MOTS_CLES_PROTEGES_INTENTIONS);
}

/** @return {boolean} vrai si `texte` (normalisé, insensible à la casse) contient un des `motifs`. */
function contientMotif_(texte, motifs) {
  var t = texte.toLowerCase();
  for (var i = 0; i < motifs.length; i++) {
    if (correspondMotif_(t, motifs[i].toLowerCase())) return true;
  }
  return false;
}

/**
 * Un motif COURT (≤ 4 caractères — sigles type « arc », « csq », « visa ») n'est reconnu qu'en
 * MOT ENTIER : en sous-chaîne libre, « arc » matcherait « Marc » (le prénom de l'utilisateur !)
 * et « cra » matcherait « écran » — un faux positif neutraliserait silencieusement la création
 * de tâches/événements sur un grand nombre de mails anodins (même piège que « sensible » trop
 * large, cf. LESSONS « garde-fou étroit »). Un motif plus long reste en sous-chaîne simple
 * (suffisamment spécifique pour qu'une sous-chaîne soit déjà un signal fiable).
 * @param {string} texteMinuscule
 * @param {string} motifMinuscule
 * @return {boolean}
 */
function correspondMotif_(texteMinuscule, motifMinuscule) {
  if (motifMinuscule.length > 4) return texteMinuscule.indexOf(motifMinuscule) !== -1;
  var echappe = motifMinuscule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-zà-ÿ0-9])' + echappe + '($|[^a-zà-ÿ0-9])').test(texteMinuscule);
}
