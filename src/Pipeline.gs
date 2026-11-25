/**
 * Pipeline.gs — Traitement unifié d'un document, quelle que soit sa source.
 *
 * Toutes les sources (PJ Gmail, dépôt manuel `00·À trier`, fichiers partagés, migration)
 * construisent un même descripteur `src` et délèguent ici. Seul le PLACEMENT diffère (copie pour
 * Gmail, déplacement pour un dépôt) : il est fourni par `src.placer`.
 * (Plus de file de revue depuis 2026-07-01 — les sources ne fournissent plus de `placerRevue`.)
 *
 * Ordre d'écriture d'état (leçon durable) : placement → ligne Index (en dernier) :
 * une coupure rejoue le cas au lieu de le perdre.
 *
 * Descripteur `src` :
 *   { cle, nom, taille, expediteur, sujet, date:Date,
 *     blob() -> Blob,
 *     placer(dossierId, nom) -> fileId,
 *     fileId? (ADR-0077 : empreinte et taille lues dans Drive sans télécharger ; absent = hachage local des octets),
 *     metaRest? ({taille, md5} déjà lus par un `files.list`, évite le `files.get` : partages),
 *     natif? (ADR-0077 : export texte d'un natif Google, empreinte de l'export, taille non comparable),
 *     ignorerDoublon?, empreinteNonIdentifiante? }
 */

/**
 * Traite un document : idempotence → DOUBLON (fast, sans lecture) → OCR → LLM → routage → placement → Index.
 * @param {Object} src
 */
function traiterDocument_(src) {
  try {
    if (indexContient_(src.cle)) return; // déjà traité → idempotence

  // Panne de COMPTE API en cours (détectée plus tôt dans CE run) : on ne touche pas au document
  // (pas d'OCR, pas de LLM, pas de mutation) — tout reprendra au tick où le compte répond.
  if (estPannePlateforme_()) return;

    var ext = extension_(src.nom);

    // FAST PATH doublon (P1-20, ADR-0077) : l'empreinte MD5 suffit à savoir si ce CONTENU est déjà classé. Si oui →
    // « _Doublons » SANS OCR ni LLM (l'exemplaire canonique est déjà classé ailleurs). L'empreinte vient d'abord de
    // Drive (`md5Checksum` lu par REST, sans télécharger, à toute taille) ; le hachage local des octets n'est qu'un
    // repli (pièce jointe Gmail, natif exporté, REST en panne), sous la même borne que l'OCR. Le blob n'est
    // matérialisé qu'au besoin : une vidéo de 300 Mo n'est jamais téléchargée ici (P1, revue intake).
    // `src.ignorerDoublon` (migration #8, ADR-0071) : un fichier DÉJÀ CLASSÉ qu'on re-classe a son empreinte dans
    // l'Index — sans ce bypass il serait « doublon de lui-même » et tout le Drive migré partirait en `_Doublons`.
    // L'empreinte reste calculée et ré-inscrite (la détection future n'est pas affaiblie).
    // ADR-0072 : une empreinte qui n'identifie rien (contenu vide, natif quasi vide) n'est NI écrite NI comparée.
    var meta = metaDoublon_(src);
    var empreinte = meta.empreinte;
    var trace = { taille: meta.taille, exemplaire: '' }; // Index J « Taille » et K « Exemplaire » : la preuve écrite
    if (empreinte && !src.ignorerDoublon && estDoublon_(empreinte)) {
      // ADR-0070 + ADR-0077 : « déjà vue » ne suffit pas. Il faut un exemplaire PROUVÉ vivant dont l'empreinte ET la
      // taille lues dans Drive AUJOURD'HUI coïncident avec celles du dépôt ; sinon le fichier suit le pipeline normal
      // (deux quasi-homonymes de contenu différent ne sont JAMAIS fusionnés, brief de Marc du 05/11/2026).
      var verdict = verdictDoublon_(empreinte, meta, src.fileId || '');
      if (verdict.doublon) {
        var dec = doublonRapide_(src.nom, src.date, ext);
        var idDup = src.placer(dec.dossierId, dec.nom);
        if (!idDup) { gererEchec_(src, 'placement doublon échoué'); return; }
        trace.exemplaire = verdict.exemplaire;
        dec.fileId = idDup;
        indexAjouter_(src.cle, dec, empreinte, trace);
        journalInfo_('Pipeline', 'doublon → _Doublons : ' + dec.nom + ' (taille ' +
          (meta.taille === null ? 'non comparée' : meta.taille + ' o') + ', empreinte ' + empreinte +
          ', exemplaire vivant ' + verdict.exemplaire + ')');
        return;
      }
      journalInfo_('Pipeline', 'empreinte déjà vue mais ' + verdict.raison + ' → traité normalement, pas jeté en doublon : ' + src.nom);
    }

    // FICHIER TECHNIQUE (code/CAO, ADR-0002 §3) : écarté du classement documentaire (ni OCR ni LLM —
    // ce n'est pas un document à ranger par domaine) → `_Technique`, pour ne pas polluer les domaines.
    // Détection par EXTENSION seulement (jamais PDF/Office/images). Placé APRÈS le fast-path doublon
    // (un doublon technique va quand même dans `_Doublons`), AVANT tout OCR/LLM (économie de coût).
    if (estTechnique_(src.nom)) {
      var decT = routageTechnique_(src.nom, src.date, ext);
      var idT = src.placer(decT.dossierId, decT.nom);
      if (!idT) { gererEchec_(src, 'placement technique échoué'); return; }
      decT.fileId = idT;
      indexAjouter_(src.cle, decT, empreinte, trace);
      journalInfo_('Pipeline', 'technique (sans lecture) → _Technique : ' + decT.nom);
      return;
    }

    // MÉDIA BRUT direct (vidéo/audio/gif — ADR-0009 §2) : jamais un document → `_Médias` SANS OCR
    // ni LLM (l'OCR Drive ne lit pas une vidéo, le LLM n'a rien à classer). Nom d'origine conservé.
    // Placé après le fast-path doublon (un doublon de vidéo va quand même dans `_Doublons`).
    if (estMediaDirect_(src.nom)) {
      var decM = routageMedia_(src.nom);
      var idM = src.placer(decM.dossierId, decM.nom);
      if (!idM) { gererEchec_(src, 'placement média échoué'); return; }
      decM.fileId = idM;
      indexAjouter_(src.cle, decM, empreinte, trace);
      journalInfo_('Pipeline', 'média (sans lecture) → _Médias : ' + decM.nom);
      return;
    }

    // Contenu INÉDIT → lecture complète (OCR) puis classement (LLM). Blob PARESSEUX : au-delà de la borne OCR, il
    // n'est jamais matérialisé (une vidéo de 300 Mo ferait lever getBlob → quarantaine) ; sous la borne, celui que
    // `metaDoublon_` a déjà téléchargé pour hacher est réutilisé (jamais deux téléchargements).
    var tailleOcr = meta.origine === 'rest' && meta.taille !== null ? meta.taille : src.taille; // REST fait foi si lu
    var blob = meta.blob || (tailleOcr > CONFIG.OCR_TAILLE_MAX ? null : src.blob());
    var extrait = tailleOcr > CONFIG.OCR_TAILLE_MAX ? '' : extraireTexte_(blob);

    // FAST-PATH photo sans texte (ADR-0009 §2) : nom NON documentaire (export Facebook, IMG_…)
    // ET extrait OCR vide → média personnel → `_Médias` sans LLM. L'OCR reste le JUGE (§1) : un scan
    // de passeport nommé « IMG_2734.jpg » contient du texte → extrait non vide → analyse complète.
    // R1 (revue sécurité) : le fast-path exige que l'OCR ait été TENTÉ (taille <= max) — sans ça,
    // une photo > 20 Mo (scan à plat .tif) serait écartée sans que « le juge » ait siégé.
    // P2 (revue intake) : `extrait === null` = l'OCR a ÉCHOUÉ (panne transitoire) — le juge n'a pas
    // rendu de verdict → jamais de fast-path (le doc continue vers le LLM, comme avant #11).
    var zoneProtegeeMeta = typeof toucheZoneProtegee_ === 'function' &&
      toucheZoneProtegee_((src.expediteur || '') + ' ' + (src.sujet || ''));
    if (tailleOcr <= CONFIG.OCR_TAILLE_MAX && extrait !== null &&
        estPhoto_(src.nom) && estNomNonDocumentaire_(src.nom) &&
        extrait.length < CONFIG.MEDIAS_OCR_MAX_CARS && !zoneProtegeeMeta) {
      var decP = routageMedia_(src.nom);
      var idP = src.placer(decP.dossierId, decP.nom);
      if (!idP) { gererEchec_(src, 'placement média échoué'); return; }
      decP.fileId = idP;
      indexAjouter_(src.cle, decP, empreinte, trace);
      journalInfo_('Pipeline', 'photo sans texte → _Médias : ' + decP.nom);
      return;
    }

    var dossiersVie = (typeof dossiersVieCache_ === 'function' &&
        typeof chercherDossiersVie_ === 'function' &&
        typeof formaterContexteDossiersVie_ === 'function')
      ? formaterContexteDossiersVie_(chercherDossiersVie_(src, dossiersVieCache_(), 3,
          typeof pontDriveParAdresse_ === 'function' ? pontDriveParAdresse_() : null))
      : '';

    var classif = classifier_({
      nomFichier: src.nom,
      expediteur: src.expediteur || '',
      sujet: src.sujet || '',
      dossiersVie: dossiersVie,
      extrait: extrait || '' // null (échec OCR) → le LLM classe sur les métadonnées, comme avant
    });
    if (!classif) {
      // Échec LLM : compté ; re-tenté au prochain tick, ou quarantaine après N échecs.
      gererEchec_(src, 'classification impossible');
      return;
    }

    // Filet « deviner depuis le nom d'origine » (ADR-0002 §5) : si le LLM n'a pas rendu de type,
    // on le complète depuis le nom du fichier (ex. …_TP4_… → « TP ») avant le routage/nommage.
    enrichirClassifDepuisNom_(classif, src.nom);

    // Garde post-LLM (incident Boreale 2026-07-06) : une PHOTO au nom non-documentaire dont le
    // classement n'est PAS sûr n'est JAMAIS « classée au mieux » — c'est un média personnel.
    // (Un vrai reçu photographié sort avec une confiance élevée et passe.)
    if (estPhoto_(src.nom) && estNomNonDocumentaire_(src.nom) &&
        (typeof classif.confiance !== 'number' || classif.confiance < CONFIG.MEDIAS_CONFIANCE_MIN) &&
        classif.sensible !== true &&
        (CONFIG.DOMAINES_PROTEGES || []).indexOf(classif.domaine) === -1 &&
        !toucheZoneProtegee_([src.nom, src.expediteur || '', src.sujet || '', extrait || ''].join(' '))) {
      var decPh = routageMedia_(src.nom);
      var idPh = src.placer(decPh.dossierId, decPh.nom);
      if (!idPh) { gererEchec_(src, 'placement média échoué'); return; }
      decPh.fileId = idPh;
      indexAjouter_(src.cle, decPh, empreinte, trace);
      journalInfo_('Pipeline', 'photo à classement incertain (' +
        (typeof classif.confiance === 'number' ? classif.confiance : '?') + ') → _Médias : ' + decPh.nom);
      return;
    }

    // Routage : v2 (refonte #26, schéma étendu — identité par type, non-document, entité unifiée,
    // descripteur, sous-dossier obligatoire) si le flag est ON ; sinon logique historique inchangée.
    var decision = CONFIG.ANALYSE_V2
      ? deciderRoutageV2_(classif, {
          nomFichier: src.nom, taille: src.taille,
          extraitOcr: extrait || '', emetteur: classif.emetteur
        }, src.date, ext)
      : deciderRoutage_(classif, src.date, ext);
    decision.confiance = typeof classif.confiance === 'number' ? classif.confiance : ''; // #17 → Index H

    // Plus de file de revue (décision Marc 2026-07-01) : tout est CLASSÉ ('classé'), placé dans son
    // dossier cible avec son nom final propre. Un seul chemin de placement.
    var fileId = src.placer(decision.dossierId, decision.nom);

    if (!fileId) {
      // Placement Drive échoué → on n'indexe pas : compté ; re-tenté, ou quarantaine après N échecs.
      gererEchec_(src, 'placement Drive échoué');
      return;
    }
    if (decision.autresEntites && decision.autresEntites.length) {
      creerRaccourcisEntites_(fileId, decision.nom, decision.autresEntites);
    }

    // ⚠️ C49-16 — LE `fileId` SE POSE ICI, ET NULLE PART AILLEURS. C'est le seul endroit du
    // moteur où le document vient d'être PLACÉ et où son identifiant est en main ; trois lignes
    // plus haut, `src.placer` l'a rendu. Le déduire plus tard de la clé ne marche que pour
    // quatre préfixes — une pièce jointe Gmail n'en porte aucun, et c'est l'intake principal.
    decision.fileId = fileId;
    indexAjouter_(src.cle, decision, empreinte, trace);
    if (typeof enregistrerLienMailDrive_ === 'function') enregistrerLienMailDrive_(src, decision);
    if (typeof enregistrerSignalDepuisPipeline_ === 'function') {
      try { enregistrerSignalDepuisPipeline_(src, classif, decision); } catch (eSig) { }
    }
    journalInfo_('Pipeline', decision.statut + ' → ' + decision.chemin + ' : ' + decision.nom);
  } catch (e) {
    // Erreur inattendue (OCR, blob, Sheet...) : comptée comme un échec → re-tentée, ou
    // quarantaine après N échecs (évite un re-OCR/re-LLM en boucle sur un cas définitivement cassé).
    try { gererEchec_(src, String(e)); }
    catch (e2) { notifierEchec_('Pipeline', 'Échec sur « ' + src.nom + ' » : ' + e + ' / ' + e2); }
  }
}

/**
 * Gère un échec de traitement d'un document : compte les tentatives (onglet « Échecs ») et,
 * au-delà de `CONFIG.QUARANTAINE_MAX`, met le document en QUARANTAINE — inscrit « quarantaine »
 * à l'Index (donc plus jamais re-traité, plus de re-OCR/re-LLM coûteux) avec UNE seule alerte mail.
 * En-deçà du seuil, on journalise seulement (pas de mail → anti-spam) et le doc sera re-tenté.
 * @param {Object} src
 * @param {string} message  cause de l'échec (pour le Journal / l'alerte)
 */
function gererEchec_(src, message) {
  // Panne de COMPTE API (crédit/clé) ≠ échec du document : ni compteur ni quarantaine — le doc
  // reste non indexé et sera re-tenté tel quel quand le compte sera rétabli. (Sans ce garde, une
  // panne de crédit a mis ~89 docs en quarantaine à tort — check-up 2026-07-03.) Silencieux : la
  // panne elle-même est déjà journalisée une fois par run (Llm.signalerPannePlateforme_).
  if (estPannePlateforme_()) return;
  var n = incrementerEchec_(src.cle);
  if (n >= CONFIG.QUARANTAINE_MAX) {
    indexAjouter_(src.cle, { statut: 'quarantaine', domaine: '', chemin: '', nom: src.nom });
    notifierEchec_('Quarantaine', 'Document mis en quarantaine après ' + n + ' échecs : ' +
      src.nom + ' — ' + message);
  } else {
    journalErreur_('Pipeline', 'Échec ' + n + '/' + CONFIG.QUARANTAINE_MAX + ' pour « ' +
      src.nom + ' » : ' + message);
  }
}

/**
 * PURE — ADR-0072 : l'empreinte à écrire à l'Index et à comparer, ou '' si elle n'identifie rien. Le MD5 du contenu vide
 * est partagé par tous les fichiers vides, et celui d'un natif quasi vide (`src.empreinteNonIdentifiante`) par tous les
 * natifs quasi vides : les écrire ferait juger « doublon » un contenu sans rapport.
 * @param {string} empreinte  MD5 calculé ('' si indisponible)
 * @param {boolean=} nonIdentifiante  posé par la source (natif au texte trop court)
 * @return {string}
 */
function empreinteUtilisable_(empreinte, nonIdentifiante) {
  if (!empreinte || nonIdentifiante) return '';
  return empreinte === CONFIG.EMPREINTE_CONTENU_VIDE ? '' : empreinte;
}

/**
 * Empreinte MD5 du contenu (hex). Sert à repérer les doublons. '' si indisponible.
 * @param {Blob} blob
 * @return {string}
 */
function empreinteBlob_(blob) {
  try {
    var octets = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes());
    var hex = '';
    for (var i = 0; i < octets.length; i++) {
      hex += ('0' + (octets[i] & 0xFF).toString(16)).slice(-2);
    }
    return hex;
  } catch (e) {
    return ''; // hash impossible (mémoire) → pas de détection de doublon, sans planter
  }
}

/**
 * ADR-0077 — taille et empreinte du fichier DÉPOSÉ, sans le télécharger quand Drive les connaît. Ordre :
 *   (1) `md5Checksum` et `size` déjà lus par la liste (`src.metaRest`, partages) ou lus par REST (`metaFichierRest_`)
 *       quand le descripteur porte `src.fileId` et n'est pas un natif (dépôt Drive binaire, Documents ID) — à toute
 *       taille, zéro octet transféré ;
 *   (2) sinon MD5 des octets si le fichier tient sous `OCR_TAILLE_MAX` (pièce jointe Gmail, natif exporté, REST en
 *       panne) — le blob matérialisé ici est rendu pour que l'OCR ne le re-télécharge pas ;
 *   (3) sinon pas d'empreinte (gros fichier sans fileId lisible).
 * `origine` : 'rest' | 'octets' | 'texte' (`src.natif` : export d'un natif Google, dont la « taille » est un nombre de
 * caractères, donc `taille` est `null`, non comparable) | '' (aucune empreinte). ADR-0072 : une empreinte non
 * identifiante n'existe pas.
 * @param {Object} src
 * @return {{taille:(number|null), empreinte:string, origine:string, blob:?Object}}
 */
function metaDoublon_(src) {
  var meta = { taille: src.natif ? null : tailleOctets_(src.taille), empreinte: '', origine: '', blob: null };
  if (src.empreinteNonIdentifiante) return meta;
  var rest = src.metaRest || (src.fileId && !src.natif ? metaFichierRest_(src.fileId) : null); // natif : Drive n'a ni md5 ni taille
  if (rest && rest.md5) {
    meta.empreinte = empreinteUtilisable_(rest.md5, false);
    meta.origine = meta.empreinte ? 'rest' : '';
    if (rest.taille !== null) meta.taille = tailleOctets_(rest.taille);
    return meta;
  }
  if (src.taille > CONFIG.OCR_TAILLE_MAX) return meta;
  meta.blob = src.blob();
  meta.empreinte = empreinteUtilisable_(empreinteBlob_(meta.blob), false);
  if (meta.empreinte) meta.origine = src.natif ? 'texte' : 'octets';
  return meta;
}

/** PURE — ADR-0077 : une taille en octets exploitable (entier > 0), sinon `null` (inconnue, natif, illisible). */
function tailleOctets_(taille) {
  return typeof taille === 'number' && isFinite(taille) && taille > 0 ? Math.floor(taille) : null;
}

/**
 * PURE — ADR-0077 : le dépôt est-il un doublon de l'exemplaire ? OUI seulement si l'exemplaire est PROUVÉ vivant
 * (ADR-0070, jamais « dans le doute ») ET lisible dans Drive, que son md5 Drive d'AUJOURD'HUI est l'empreinte de
 * l'Index (sinon il a changé depuis son classement : l'Index est périmé) ET que les tailles coïncident quand les deux
 * sont connues. Un natif Google n'a ni taille ni md5 côté Drive : deux exports ENTIERS identiques (même empreinte) font
 * foi, la taille n'est pas comparée. Dans tous les autres cas le fichier suit le pipeline normal (classé et nommé).
 * @param {string} empreinte  empreinte du dépôt, déjà vue à l'Index
 * @param {{taille:(number|null), origine:string}} meta  du dépôt (`metaDoublon_`)
 * @param {{vivant:boolean, fileId:string}} porteur  réponse de `porteurVivantDe_` (fileId '' = non prouvé)
 * @param {{taille:(number|null), md5:string}|null} metaPorteur  `metaFichierRest_` sur l'exemplaire, null si illisible
 * @param {string=} fileIdDepot  fileId du dépôt lui-même ('' si inconnu) : un fichier n'est jamais son propre doublon
 * @return {{doublon:boolean, exemplaire:string, raison:string}}
 */
function jugerDoublon_(empreinte, meta, porteur, metaPorteur, fileIdDepot) {
  var non = function (raison) { return { doublon: false, exemplaire: porteur.fileId || '', raison: raison }; };
  if (!porteur.vivant) return non('exemplaire disparu (corbeille ou _Doublons)');
  if (!porteur.fileId) return non('aucun exemplaire vivant prouvé');
  if (fileIdDepot && porteur.fileId === fileIdDepot) {
    // Fichier déjà classé (par Gmail, un partage, Documents ID : clé d'Index différente de `drive|<id>`) que Marc remet
    // dans « À trier » : l'exemplaire « vivant » est le fichier lui-même. Remise, pas doublon (ADR-0071).
    return non('l\'exemplaire est le fichier lui-même (remise sans ligne de redépôt, ADR-0071)');
  }
  if (!metaPorteur) return non('exemplaire ' + porteur.fileId + ' illisible dans Drive');
  if (metaPorteur.md5 && metaPorteur.md5 !== empreinte) {
    return non('l\'exemplaire ' + porteur.fileId + ' a changé depuis son classement (empreinte différente)');
  }
  if (!metaPorteur.md5 && meta.origine !== 'texte') return non('exemplaire ' + porteur.fileId + ' sans empreinte Drive (natif) pour un dépôt binaire');
  var comparables = meta.origine !== 'texte' && meta.taille !== null && metaPorteur.taille !== null;
  if (comparables && meta.taille !== metaPorteur.taille) {
    return non('taille différente (' + meta.taille + ' o déposé, ' + metaPorteur.taille + ' o classé en ' + porteur.fileId + ')');
  }
  return { doublon: true, exemplaire: porteur.fileId, raison: '' };
}

/**
 * ADR-0077 — I/O : l'exemplaire vivant selon l'Index (ADR-0070) avec sa taille et son md5 lus dans Drive par la preuve
 * de vie elle-même (`porteur.meta`, DriveAI#897 : UN `files.get` par exemplaire et par run, 150 copies du même fichier
 * = un appel), puis le verdict pur. Un porteur nommé sans `meta` (ancien appelant) est relu une fois. Ne lève pas
 * (chaque lecture dégrade en « non prouvé »).
 * @param {string} empreinte
 * @param {{taille:(number|null), origine:string}} meta
 * @param {string=} fileIdDepot  fileId du dépôt ('' si inconnu)
 * @return {{doublon:boolean, exemplaire:string, raison:string}}
 */
function verdictDoublon_(empreinte, meta, fileIdDepot) {
  var porteur = porteurVivantDe_(empreinte);
  var lisible = porteur.vivant && porteur.fileId && porteur.fileId !== fileIdDepot;
  var metaPorteur = null;
  if (lisible) metaPorteur = porteur.meta !== undefined ? porteur.meta : metaFichierRest_(porteur.fileId);
  return jugerDoublon_(empreinte, meta, porteur, metaPorteur, fileIdDepot || '');
}

/**
 * Pose un raccourci du fichier dans chaque autre dossier d'entité (jamais de copie).
 * Dégrade proprement si l'API échoue (le fichier primaire reste rangé).
 * @param {string} fileId
 * @param {string} nom
 * @param {string[]} dossierIds
 */
function creerRaccourcisEntites_(fileId, nom, dossierIds) {
  var n = 0;
  for (var i = 0; i < dossierIds.length; i++) {
    if (creerRaccourci_(fileId, dossierIds[i], nom)) n++;
  }
  if (n) journalInfo_('Pipeline', n + ' raccourci(s) multi-entités créé(s) pour : ' + nom);
}
