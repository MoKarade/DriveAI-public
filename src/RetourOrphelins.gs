/**
 * RetourOrphelins.gs — rend leur place aux ORPHELINS de `_Doublons` (#468 point 2, ADR-0047 §8).
 *
 * Contexte. La validation par empreinte (Doublons.gs) a constaté que, sur les 1 076 fichiers écartés
 * dans `_Doublons`, 19 n'ont AUCUN exemplaire classé ailleurs : ce sont les seuls exemplaires de
 * leur contenu. Les laisser dans `_Doublons`, c'est les ranger comme des doublons alors qu'ils n'en
 * sont pas. Marc a tranché (19/10/2026) : on les remet en circulation, DÉPLACEMENT SEUL, aucune
 * suppression.
 *
 * Pourquoi le pipeline et pas un « retour à l'origine ». Un orphelin n'a plus d'origine connue (c'est
 * le sens du mot : le rapport ne porte que son id et son empreinte). La seule destination
 * défendable est celle que l'analyse documentaire donnerait aujourd'hui à ce contenu : on le repasse
 * donc à `traiterDocument_`, avec `ignorerDoublon: true` (sans quoi son empreinte, déjà dans l'Index,
 * le renverrait dans `_Doublons` — un aller-retour sans fin).
 *
 * Garde-fous (par ordre de gravité) :
 *  1. AUCUNE suppression ni mise à la corbeille : le fichier change de dossier (et de nom), point.
 *  2. Le verdict « orphelin » date de la campagne ; l'ADR §8 exige de re-vérifier AU MOMENT de l'acte.
 *     On re-balaie donc le Drive (même critère que la campagne : `estExemplaireSurvivant_`) et on ne
 *     bouge que les fichiers dont l'empreinte n'a TOUJOURS aucun exemplaire classé ailleurs. Un
 *     balayage incomplet (erreur de page, budget) ABANDONNE : rien n'est déplacé sur un Drive à
 *     moitié lu.
 *  3. Le fichier doit être encore SEUL dans `_Doublons`, et son md5 doit être celui du rapport.
 *  4. Idempotence : clé d'Index `retour-orphelin|<fileId>`, posée par le pipeline à la fin du
 *     traitement (ou par nous quand on écarte). Un fichier traité ne l'est jamais deux fois.
 *  5. Interrupteur CONFIG + Property de fin : la fonction est un ONE-SHOT, elle s'éteint seule.
 *
 * Coût : un appel LLM par orphelin (≈ 0,026 $/document, ≈ 0,5 $ pour 19), par lots de
 * `CONFIG.RETOUR_ORPHELINS_LOT`, sous le frein budget des campagnes.
 */

var CLE_RETOUR_ORPHELIN = 'retour-orphelin|';
var PROP_RETOUR_ORPHELINS = 'DriveAI_RETOUR_ORPHELINS';
var PROP_RETOUR_ORPHELINS_COMPTE = 'DriveAI_RETOUR_ORPHELINS_COMPTE'; // JSON {rendus, ecartes} CUMULÉS, lus par la ligne de Santé
var STATUT_RETOUR_ECARTE = 'retour orphelin écarté';

/**
 * PURE — les orphelins déclarés par le rapport de la campagne.
 * @param {Array<Array>} lignes  lignes de l'onglet `RapportDoublons` (sans l'en-tête), colonnes
 *   `COLONNES_RAPPORT_DOUBLONS` : Fichier, ID, Empreinte, Verdict, Preuve, Horodaté.
 * @return {Array<{nom:string, id:string, empreinte:string}>} sans id ni empreinte ⇒ ignoré (on ne
 *   devine pas : un orphelin sans empreinte n'a pas de preuve de unicité à re-vérifier).
 */
function orphelinsDuRapport_(lignes) {
  var res = [];
  (lignes || []).forEach(function (l) {
    if (String(l[3] || '') !== VERDICT_DOUBLON_ORPHELIN) return;
    var id = String(l[1] || '');
    var empreinte = String(l[2] || '');
    if (!id || !empreinte) return;
    res.push({ nom: String(l[0] || ''), id: id, empreinte: empreinte });
  });
  return res;
}

/**
 * PURE — faut-il remettre CE fichier en circulation maintenant ?
 * @param {{id:string, empreinte:string}} orphelin
 * @param {{parents:(string[]|null), md5:string, doublonsId:string, jumeaux:Object<string,string>,
 *          dejaRetournes:Object<string,string>}} etat
 *   `parents` null = illisible ; `jumeaux` = empreinte → id d'un exemplaire classé trouvé par le
 *   balayage de CE run ; `dejaRetournes` = empreinte → id d'un orphelin de même contenu déjà rendu.
 * @return {{agir:boolean, definitif:boolean, raison:string}}
 *   `definitif` : la décision ne changera pas au prochain tick (on l'inscrit pour converger) ;
 *   sinon on réessaie (lecture illisible, panne passagère).
 */
function decisionRetourOrphelin_(orphelin, etat) {
  if (!etat.parents) {
    return { agir: false, definitif: false, raison: 'fichier illisible (parents indisponibles)' };
  }
  if (etat.parents.length !== 1 || etat.parents[0] !== etat.doublonsId) {
    return { agir: false, definitif: true, raison: 'n\'est plus seul dans `_Doublons` — déjà déplacé ou rattaché' };
  }
  if (!etat.md5) {
    return { agir: false, definitif: false, raison: 'empreinte courante indisponible' };
  }
  if (etat.md5 !== orphelin.empreinte) {
    return { agir: false, definitif: true, raison: 'contenu modifié depuis le rapport (empreinte différente)' };
  }
  if (etat.jumeaux[orphelin.empreinte]) {
    return { agir: false, definitif: true,
      raison: 'exemplaire classé ailleurs : ' + etat.jumeaux[orphelin.empreinte] + ' — vrai doublon, reste dans `_Doublons`' };
  }
  if (etat.dejaRetournes[orphelin.empreinte]) {
    return { agir: false, definitif: true,
      raison: 'même contenu qu\'un orphelin déjà rendu : ' + etat.dejaRetournes[orphelin.empreinte] };
  }
  return { agir: true, definitif: true, raison: 'seul exemplaire du contenu' };
}

/**
 * PURE — choisit le lot de CE tick : les orphelins non encore inscrits à l'Index, dans l'ordre du
 * rapport, plafonnés. Rend aussi le reste à faire (pour la clôture).
 * @param {Array<{id:string}>} orphelins
 * @param {function(string):boolean} dejaInscrit  clé d'Index → présence
 * @param {number} taille
 * @return {{lot:Array, restants:number}}
 */
function lotRetourOrphelins_(orphelins, dejaInscrit, taille) {
  var aFaire = orphelins.filter(function (o) { return !dejaInscrit(CLE_RETOUR_ORPHELIN + o.id); });
  return { lot: aFaire.slice(0, Math.max(0, taille)), restants: aFaire.length };
}

/**
 * Balaie TOUT le Drive (propriétaire « me », hors dossiers) et rend, pour les seules empreintes
 * demandées, l'id d'un exemplaire classé hors `_Doublons`/zone d'attente. LÈVE sur toute erreur de
 * page et rend `null` si le budget coupe avant la dernière page : dans les deux cas l'appelant ne
 * déplace RIEN (un faux « pas de jumeau » est le pire résultat possible ici).
 * @param {string[]} empreintes
 * @param {string} doublonsId
 * @param {function():boolean} garde
 * @return {Object<string,string>|null}
 */
function jumeauxClassesParEmpreinte_(empreintes, doublonsId, garde) {
  var voulues = {};
  empreintes.forEach(function (e) { voulues[e] = true; });
  var trouves = {};
  var transit = [CONFIG.DOSSIERS.A_TRIER];
  var q = "trashed = false and 'me' in owners and mimeType != 'application/vnd.google-apps.folder'";
  var champs = 'nextPageToken,files(id,md5Checksum,parents)';
  var jeton = '';
  while (true) {
    if (garde()) return null;
    var page = pageListeDrive_(urlListeDrive_(q, champs, jeton, CONFIG.DOUBLONS_TAILLE_PAGE));
    page.files.forEach(function (fi) {
      if (!voulues[fi.md5Checksum]) return;
      if (estExemplaireSurvivant_(fi, doublonsId, transit) && !trouves[fi.md5Checksum]) {
        trouves[fi.md5Checksum] = fi.id;
      }
    });
    jeton = page.nextPageToken;
    if (!jeton) return trouves;
  }
}

/**
 * ÉTAPE DE TICK — un lot d'orphelins. Enveloppée par l'appelant (Main.gs) ; sans effet une fois la
 * Property de fin posée (1 lecture Property par tick, coût nul).
 * @param {function():boolean} estBudgetDepasse
 */
function retournerOrphelinsDoublons_(estBudgetDepasse) {
  if (!CONFIG.RETOUR_ORPHELINS_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_RETOUR_ORPHELINS)) return; // terminé : court-circuit

  var rapport = feuilleRapportDoublons_();
  var dern = rapport.getLastRow();
  var lignes = dern < 2 ? [] : rapport.getRange(2, 1, dern - 1, COLONNES_RAPPORT_DOUBLONS.length).getValues();
  var orphelins = orphelinsDuRapport_(lignes);
  var sel = lotRetourOrphelins_(orphelins, indexContient_, CONFIG.RETOUR_ORPHELINS_LOT);

  if (sel.restants === 0) {
    props.setProperty(PROP_RETOUR_ORPHELINS, dateGmail_(new Date()));
    journalInfo_('RetourOrphelins', 'Retour des orphelins TERMINÉ : ' + orphelins.length +
      ' orphelins du rapport, tous inscrits à l\'Index (rangés ou écartés avec leur raison).');
    return;
  }
  if (estBudgetDepasse()) return;

  var doublonsId = idDoublonsSansCreer_();
  if (!doublonsId) return; // plus de `_Doublons` : rien à rendre, et surtout rien à créer

  // Re-vérification à l'acte (ADR-0047 §8) : un balayage COMPLET, ou rien.
  var jumeaux;
  try {
    jumeaux = jumeauxClassesParEmpreinte_(sel.lot.map(function (o) { return o.empreinte; }),
      doublonsId, estBudgetDepasse);
  } catch (e) {
    journalErreur_('RetourOrphelins', 'Balayage de re-vérification impossible — aucun orphelin déplacé : ' + e);
    return;
  }
  if (jumeaux === null) {
    journalInfo_('RetourOrphelins', 'Balayage de re-vérification coupé par le budget — aucun orphelin déplacé, repris au prochain tick.');
    return;
  }

  var dejaRetournes = {};
  var rendus = 0, ecartes = 0;
  for (var i = 0; i < sel.lot.length; i++) {
    if (estBudgetDepasse() || estPannePlateforme_()) break;
    var o = sel.lot[i];
    var cle = CLE_RETOUR_ORPHELIN + o.id;
    var f = null, nom = o.nom, parents = null, md5 = '', taille = 0, date = new Date();
    try {
      f = DriveApp.getFileById(o.id);
      nom = f.getName();
      var it = f.getParents();
      parents = [];
      while (it.hasNext()) parents.push(it.next().getId());
      md5 = metadonneesMd5_(o.id);
      taille = f.getSize();
      date = f.getLastUpdated();
    } catch (eLecture) {
      // Introuvable ou illisible : on le DIT et on réessaie au tick suivant, sans rien inscrire.
      journalErreur_('RetourOrphelins', 'Orphelin illisible (' + o.id + ') : ' + eLecture);
      parents = null;
    }
    var d = decisionRetourOrphelin_(o, {
      parents: parents, md5: md5, doublonsId: doublonsId, jumeaux: jumeaux, dejaRetournes: dejaRetournes
    });
    if (!d.agir) {
      if (d.definitif) {
        indexAjouter_(cle, { statut: STATUT_RETOUR_ECARTE, nom: nom, domaine: '', chemin: '' }, '');
        journalInfo_('RetourOrphelins', 'Orphelin écarté (non déplacé) : ' + nom + ' — ' + d.raison);
        ecartes++;
      }
      continue;
    }
    dejaRetournes[o.empreinte] = o.id;
    var blobMemo = null;
    traiterDocument_({
      cle: cle,
      fileId: o.id, // DriveAI#898 : empreinte et taille par REST (ADR-0077) ; le md5 déjà lu ci-dessus est transmis
      metaRest: md5 ? { taille: taille, md5: String(md5).toLowerCase() } : null, // md5 toujours présent ici (decisionRetourOrphelin_ refuse sans empreinte) ; null = forme défensive
      nom: nom,
      taille: taille,
      expediteur: '',
      sujet: 'Retour d\'un orphelin de _Doublons',
      date: date,
      ignorerDoublon: true, // son empreinte est déjà dans l'Index : sans ce bypass il repartirait dans `_Doublons`
      blob: function () { if (blobMemo === null) blobMemo = f.getBlob(); return blobMemo; },
      placer: function (dossierId, nouveauNom) {
        return deplacerEtRenommer_(o.id, dossierId, doublonsId, nouveauNom) ? o.id : '';
      }
    });
    if (indexContient_(cle)) rendus++;
  }
  cumulerCompteRetourOrphelins_(props, rendus, ecartes);
  journalInfo_('RetourOrphelins', 'Lot : ' + rendus + ' traité(s) par le pipeline, ' + ecartes +
    ' écarté(s) ; reste ' + Math.max(0, sel.restants - rendus - ecartes) + ' sur ' + orphelins.length + '.');
}

/**
 * md5 COURANT d'un fichier (métadonnée Drive, sans lire le contenu). '' si indisponible : la
 * décision refuse alors d'agir (« empreinte courante indisponible ») au lieu de supposer.
 * @param {string} fileId
 * @return {string}
 */
function metadonneesMd5_(fileId) {
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=md5Checksum', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() !== 200) return '';
  return String(JSON.parse(rep.getContentText()).md5Checksum || '');
}

/**
 * Cumule les compteurs du retour des orphelins (Property JSON), pour que la ligne de Santé puisse
 * DIRE où en est le one-shot sans relire le Journal ni l'Index. Un compteur illisible repart de 0.
 * @param {GoogleAppsScript.Properties.Properties} props
 * @param {number} rendus
 * @param {number} ecartes
 */
function cumulerCompteRetourOrphelins_(props, rendus, ecartes) {
  var cumul = lireCompteRetourOrphelins_(props);
  cumul.rendus += Number(rendus) || 0;
  cumul.ecartes += Number(ecartes) || 0;
  props.setProperty(PROP_RETOUR_ORPHELINS_COMPTE, JSON.stringify(cumul));
}

/**
 * @param {GoogleAppsScript.Properties.Properties} props
 * @return {{rendus:number, ecartes:number}}
 */
function lireCompteRetourOrphelins_(props) {
  try {
    var brut = JSON.parse(props.getProperty(PROP_RETOUR_ORPHELINS_COMPTE) || '{}');
    return { rendus: Number(brut.rendus) || 0, ecartes: Number(brut.ecartes) || 0 };
  } catch (e) {
    return { rendus: 0, ecartes: 0 };
  }
}

/**
 * Suffixe de la ligne de Santé « Doublons » : où en est le retour des orphelins. PUR.
 * '' quand l'étape est éteinte et n'a rien fait (rien à dire).
 * @param {boolean} actif  `CONFIG.RETOUR_ORPHELINS_ACTIF`
 * @param {string} termineLe  valeur de la Property de fin ('' tant que ce n'est pas fini)
 * @param {{rendus:number, ecartes:number}} compte
 * @return {string}
 */
function suffixeSanteRetourOrphelins_(actif, termineLe, compte) {
  var c = compte || { rendus: 0, ecartes: 0 };
  var bilan = c.rendus + ' remis en circulation, ' + c.ecartes + ' écartés avec leur raison';
  if (termineLe) return ' · retour des orphelins : terminé ✅ le ' + termineLe + ' (' + bilan + ')';
  if (!actif) return c.rendus || c.ecartes ? ' · retour des orphelins : arrêté (CONFIG) — ' + bilan : '';
  return ' · retour des orphelins : en cours (' + bilan + ')';
}
