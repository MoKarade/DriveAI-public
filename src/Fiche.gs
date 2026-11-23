/**
 * Fiche.gs — la FICHE du propriétaire (ADR-0081, vague 1) : ce que DriveAI APPREND de ses habitudes,
 * sans jamais lui demander de ranger à la main.
 *
 * Pour chaque expéditeur (adresse nue, jamais le nom affiché — usurpable) on compte, au fil des jours,
 * combien de fils le propriétaire a LUS, auxquels il a RÉPONDU, qu'il a ÉTOILÉS, ou qu'il a laissés
 * partir SANS LES LIRE. De ces compteurs sort un niveau d'importance (haut / moyen / bas / inconnu) que
 * la vague 2 donnera au tri pour mieux décider.
 *
 * VIE PRIVÉE (ADR-0007, inchangée) : seuls des COMPTEURS et l'adresse nue sont écrits, dans l'onglet
 * `Fiche` de la Sheet du propriétaire (comme `TriAppris`). Ni le sujet, ni le corps, ni le contenu d'une
 * pièce jointe ne sont lus ni écrits ici : on ne regarde que des signaux d'usage (lu, étoile, réponse).
 * Lecture seule côté Gmail : aucune écriture, aucun libellé, aucune archive.
 */

var COLONNES_FICHE = ['Adresse', 'Fils vus', 'Lus', 'Répondus', 'Étoilés', 'Sans lire', 'Dernier fil', 'Mis à jour'];
var FICHE_CURSEUR_PROP = 'DriveAI_FICHE_CURSEUR';

/**
 * Signaux d'usage d'UN fil, PUR. `adresse` = l'expéditeur externe du fil (rien si le propriétaire est
 * seul à écrire).
 * @param {{adresse:string, nonLu:boolean, etoile:boolean, marcARepondu:boolean, dansBoite:boolean}} fil
 * @return {{adresse:string, lu:number, repondu:number, etoile:number, sansLire:number}}
 */
function signauxFil_(fil) {
  return {
    adresse: String(fil.adresse || '').toLowerCase(),
    lu: fil.nonLu ? 0 : 1,
    repondu: fil.marcARepondu ? 1 : 0,
    etoile: fil.etoile ? 1 : 0,
    // Parti de la boîte sans avoir été lu : le propriétaire l'a laissé filer (ou le tri l'a archivé).
    sansLire: (fil.nonLu && !fil.dansBoite) ? 1 : 0
  };
}

/**
 * Ajoute les signaux d'un fil à la ligne de l'expéditeur, PUR. Rend une NOUVELLE ligne
 * { vus, lus, repondus, etoiles, sansLire, dernier, maj }.
 */
function fusionnerFiche_(ligne, s, dernierFilMs, maintenantMs) {
  var l = ligne || { vus: 0, lus: 0, repondus: 0, etoiles: 0, sansLire: 0, dernier: 0 };
  return {
    vus: l.vus + 1,
    lus: l.lus + s.lu,
    repondus: l.repondus + s.repondu,
    etoiles: l.etoiles + s.etoile,
    sansLire: l.sansLire + s.sansLire,
    dernier: Math.max(l.dernier || 0, dernierFilMs || 0),
    maj: maintenantMs
  };
}

/**
 * Importance d'un expéditeur selon SES habitudes, PURE. Une réponse pèse le plus, puis une étoile,
 * puis une simple lecture ; un fil laissé sans lire retire un point. Moins de 3 fils vus = « inconnu » :
 * on n'apprend rien d'un seul échantillon (jamais deviné).
 * @return {{niveau:string, score:number}}  niveau : 'haut' | 'moyen' | 'bas' | 'inconnu'
 */
function importanceFiche_(ligne) {
  if (!ligne || ligne.vus < 3) return { niveau: 'inconnu', score: 0 };
  var brut = 3 * ligne.repondus + 2 * ligne.etoiles + ligne.lus - ligne.sansLire;
  var score = Math.max(0, Math.min(1, brut / (3 * ligne.vus)));
  var niveau = score >= 0.6 ? 'haut' : (score >= 0.25 ? 'moyen' : 'bas');
  return { niveau: niveau, score: Math.round(score * 100) / 100 };
}

/** Signaux d'un fil Gmail réel (lecture seule). null = fil sans expéditeur externe. */
function signauxDepuisFilGmail_(fil, proprio) {
  var messages = fil.getMessages();
  var externe = '';
  var marcARepondu = false;
  var etoile = false;
  for (var i = 0; i < messages.length; i++) {
    var adresse = adresseExpediteur_(messages[i].getFrom());
    if (adresse === proprio) marcARepondu = true;
    else if (!externe) externe = adresse;
    if (messages[i].isStarred()) etoile = true;
  }
  if (!externe) return null;
  return signauxFil_({ adresse: externe, nonLu: fil.isUnread(), etoile: etoile,
    marcARepondu: marcARepondu, dansBoite: fil.isInInbox() });
}

/**
 * Étape du tick `fiche-apprentissage` : lit les fils dont le dernier message est postérieur au curseur
 * (au plus `FICHE_MAX_FILS` par run), met à jour les compteurs de l'onglet `Fiche`, avance le curseur.
 * Un fil n'est compté qu'une fois par nouveau message. Ne lève pas : un échec est journalisé par l'appelant.
 * @param {function():boolean} estBudgetDepasse
 * @return {number} nombre de fils appris
 */
function apprendreFiche_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  var maintenant = Date.now();
  var curseur = parseInt(props.getProperty(FICHE_CURSEUR_PROP), 10);
  if (!curseur) curseur = maintenant - CONFIG.FICHE_FENETRE_JOURS * 86400000;
  var proprio = (CONFIG.PROPRIETAIRE_EMAIL || '').toLowerCase();
  var fils = GmailApp.search('newer_than:' + CONFIG.FICHE_FENETRE_JOURS + 'd', 0, CONFIG.FICHE_MAX_FILS);
  var feuille = feuille_('Fiche');
  var dernier = feuille.getLastRow();
  var lignes = {};   // adresse → { rang, ligne }
  if (dernier >= 2) {
    var v = feuille.getRange(2, 1, dernier - 1, 8).getValues();
    for (var i = 0; i < v.length; i++) {
      if (!v[i][0]) continue;
      lignes[String(v[i][0])] = { rang: i + 2, ligne: {
        vus: Number(v[i][1]) || 0, lus: Number(v[i][2]) || 0, repondus: Number(v[i][3]) || 0,
        etoiles: Number(v[i][4]) || 0, sansLire: Number(v[i][5]) || 0, dernier: Number(v[i][6]) || 0 } };
    }
  }
  var modifies = {};
  var nouveauCurseur = curseur;
  var appris = 0;
  for (var k = 0; k < fils.length; k++) {
    if (estBudgetDepasse()) break;
    var dernierMs = fils[k].getLastMessageDate().getTime();
    if (dernierMs <= curseur) break; // la recherche rend les plus récents d'abord : le reste est déjà appris
    var s = signauxDepuisFilGmail_(fils[k], proprio);
    if (dernierMs > nouveauCurseur) nouveauCurseur = dernierMs;
    if (!s) continue;
    var cible = lignes[s.adresse] || { rang: 0, ligne: null };
    cible.ligne = fusionnerFiche_(cible.ligne, s, dernierMs, maintenant);
    lignes[s.adresse] = cible;
    modifies[s.adresse] = true;
    appris++;
  }
  var adresses = Object.keys(modifies);
  for (var a = 0; a < adresses.length; a++) {
    var c = lignes[adresses[a]];
    var rangee = [[adresses[a], c.ligne.vus, c.ligne.lus, c.ligne.repondus, c.ligne.etoiles, c.ligne.sansLire,
      c.ligne.dernier, new Date(c.ligne.maj)]];
    if (c.rang) {
      feuille.getRange(c.rang, 1, 1, 8).setValues(rangee);
    } else {
      feuille.appendRow(rangee[0]);
    }
  }
  if (nouveauCurseur > curseur) props.setProperty(FICHE_CURSEUR_PROP, String(nouveauCurseur));
  if (appris > 0) journalInfo_('Fiche', appris + ' fil(s) appris, ' + adresses.length + ' expéditeur(s) mis à jour');
  return appris;
}
