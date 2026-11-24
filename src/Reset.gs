/**
 * Reset.gs — RESET complet du Drive (C28-33, ADR-0030) : partie PURE (PR1).
 *
 * Décision Marc 2026-07-29 : tout rassembler dans `_TRI 2026`, écarter les doublons, repartir sur
 * une structure NEUVE où chaque niveau a ≤ 7 sous-dossiers (récursif). Structure cible AMENDÉE puis
 * validée par Marc (pièces d'identité Marc/Autres ; un dossier par logement ; Employeurs = les deux
 * employeurs principaux seuls ; 06 par ÉCOLE ; 04 restructurée en INTERNE — jamais de sortie
 * automatique). Les NOMS de personnes, d'employeurs, d'adresses et d'écoles ne sont pas dans ce
 * fichier : ils viennent de `CONFIG.PARCOURS` (profil privé).
 *
 * Ce module PR1 ne contient AUCUN I/O : la table `STRUCTURE_CIBLE_RESET` (source de vérité, ≤ 7
 * verrouillé par test DÉRIVÉ de la table) et le routage PUR `cheminCibleReset_` (par le NOM :
 * 97 % des fichiers sont conformes `AAAA[-MM[-JJ]]_Type_Émetteur.ext` — inventaire 2026-07-29).
 * Un fichier NON ROUTÉ rend null : il RESTE dans `_TRI 2026` (visible, compté au rapport) — jamais
 * un classement deviné. Les campagnes I/O (rassemblement, dédup, placement, 04 interne) = PR2.
 */

/* ================= STRUCTURE CIBLE (validée par Marc, ≤ 7 par niveau) ================= */

/** Sous-dossiers standard d'une ÉCOLE (06). Prépa reçoit en plus « Concours ». */
var SOUS_DOSSIERS_ECOLE_RESET = ['Cours & travaux', 'Examens & khôlles', 'Résultats', 'Administratif'];

/**
 * RACINE des écoles dans `06` (ADR-0055, demande de Marc 2026-09-14 : « j'ai la bonne structure
 * pour les écoles déjà, continue à rajouter là-dedans au lieu de mettre à la racine du projet »).
 * Les dossiers d'école ne vivent plus à la racine du domaine : ils sont les enfants de CE dossier,
 * que MARC a créé le 29/05/2026 et dont les noms lui appartiennent.
 * ⚠️ `Autres établissements` et `Diplômes & relevés officiels` ne sont PAS des écoles : ce sont les
 * deux nœuds de TAXONOMIE de `06`, et ils restent à sa racine.
 */
var RACINE_ARCHIVES_ECOLE_RESET = 'Archives scolaires';

/**
 * EXEMPTIONS DÉCLARÉES au plafond « ≤ 7 enfants par niveau » (ADR-0030), par chemin EXACT.
 *
 * ⚠️ Une exemption n'est pas une tolérance : c'est une décision NOMMÉE, testée à la valeur près.
 * Le principe : on DÉCLARE tout ce qui existe dans le Drive de Marc — l'alternative, omettre de la
 * table les dossiers qu'aucune règle ne vise, rendrait le plafond FAUX en silence (« une cible
 * ABSENTE de la table rend `verifierStructureCibleReset_` aveugle au ≤ 7 RÉEL », vécu en `01`) —
 * et quand le compte dépasse 7, le dépassement est NOMMÉ ici plutôt que toléré.
 * ⚠️ `Archives scolaires` a porté une exemption jusqu'à ADR-0056 (8 enfants) ; la fusion des deux
 * dossiers de collège/lycée l'a ramené à 7, et l'exemption a été RETIRÉE. Une exemption devenue
 * inutile se retire : gardée, elle couvrirait en silence le prochain dépassement.
 */
function exemptionsPlafondReset_() {
  // 12 sous-dossiers thématiques de MARC + les 4 standard = 16. Le dépassement est le SIEN, et le
  // DÉCLARER est précisément ce qui protège ses dossiers de la liste « dossiers vides » et de la
  // réorg. (une école à 2 thèmes + 4 standard = 6 reste sous le plafond ⇒ pas d'exemption.)
  // ⚠️ `Archives scolaires` N'Y EST PLUS (ADR-0056) : la fusion des deux dossiers de collège/lycée
  // le ramène de 8 à 7 enfants, donc SOUS le plafond. Une exemption qui n'est plus nécessaire se
  // retire — sinon elle couvre en silence le prochain dépassement, celui que personne n'a décidé.
  var exemptions = ['02 · Finances']; // ADR-0080 : 8 piliers financiers (dont Budgets & suivi)
  return exemptions.concat(CONFIG.PARCOURS.ecoles.filter(function (e) { return e.exemptionPlafond; }).map(function (e) {
    return '06 · Études & diplômes/' + RACINE_ARCHIVES_ECOLE_RESET + '/' + e.libelle;
  }));
}

/** Les 4 catégories PAR VÉHICULE (décision Marc 2026-08-17, ADR-0040 §3a). Littéral LOCAL et non
 * CONFIG.MISSIONS_CATEGORIES_VEHICULE : la table se construit au CHARGEMENT du fichier, dont
 * l'ordre n'est pas garanti face à Config.gs — l'ÉGALITÉ des deux listes est verrouillée par
 * tripwire de test (deux artefacts qui doivent bouger ensemble, leçon §7). */
var CATEGORIES_VEHICULE_RESET = ['Contraventions', 'Assurance auto', 'Entretien & réparations', 'Recherche & achat'];

/** Construit le nœud d'un véhicule (les 4 catégories) depuis la constante. PURE. */
function categoriesVehiculeReset_() {
  var n = {};
  for (var i = 0; i < CATEGORIES_VEHICULE_RESET.length; i++) n[CATEGORIES_VEHICULE_RESET[i]] = {};
  return n;
}

/**
 * Construit le nœud d'une école depuis la constante (UNE source — revue PR1). PURE.
 * @param {boolean} avecConcours  la prépa reçoit en plus « Concours »
 * @param {Array<string>=} thematiques  les sous-dossiers que MARC a créés lui-même dans SON
 *   dossier d'archive (ADR-0055). Aucune règle ne ROUTE vers eux : les DÉCLARER sert à ne pas les
 *   DÉFAIRE — la garde de capacité (`noeudsTableReset_` → `estNoeudRecreable_`) les retire alors de
 *   la liste « dossiers vides » de l'app, et `estSegmentStructurel_` / `estAncreStructurelleFusion_`
 *   les refusent comme source de réorg ou de fusion.
 *   ⚠️ Ils sont VIDES aujourd'hui (relevé Drive du 14/09 : l'ancienne mission `archives06` avait
 *   versé leur contenu vers la racine de `06`) — c'est-à-dire exactement la population que l'app
 *   proposerait de corbeiller si on ne les déclarait pas. C'est la plainte d'origine de Marc :
 *   « il me propose trop de dossiers à mettre en poubelle même des dossiers utiles ».
 */
function ecoleReset_(avecConcours, thematiques) {
  var n = {};
  for (var i = 0; i < SOUS_DOSSIERS_ECOLE_RESET.length; i++) n[SOUS_DOSSIERS_ECOLE_RESET[i]] = {};
  if (avecConcours) n['Concours'] = {};
  (thematiques || []).forEach(function (t) { n[t] = {}; });
  return n;
}

/**
 * Le nœud d'une ÉCOLE de `CONFIG.PARCOURS.ecoles`, avec les sous-dossiers THÉMATIQUES que Marc a
 * créés lui-même (relevé Drive du 14/09). PURE.
 */
function noeudEcoleReset_(ecole) {
  return ecole.brut ? {} : ecoleReset_(!!ecole.concours, ecole.thematiques);
}

/** Construit les sous-dossiers d'un véhicule : plat par défaut, ou 2 sous-dossiers si `v.sousDossiers` est défini (ADR-0080). PURE. */
function sousDossiersVehiculeReset_(v) {
  if (!v || !v.sousDossiers) return {};
  var n = {};
  if (v.sousDossiers.achatEntretien) n[v.sousDossiers.achatEntretien] = {};
  if (v.sousDossiers.assuranceSinistres) n[v.sousDossiers.assuranceSinistres] = {};
  return n;
}

/** `Archives scolaires` : les écoles du profil (ADR-0080 : la formation en ligne vit à la racine de 06). PURE. */
function archivesScolairesReset_() {
  var n = {};
  CONFIG.PARCOURS.ecoles.forEach(function (e) { n[e.libelle] = noeudEcoleReset_(e); });
  return n;
}

/** `Logement` : un dossier par adresse du profil (avec `Assurance habitation`) + `Anciens logements`. PURE. */
function noeudsLogementsReset_() {
  var n = {};
  CONFIG.PARCOURS.logements.forEach(function (l) { n[l.noeud] = { 'Assurance habitation': {} }; });
  n['Anciens logements'] = {};
  return n;
}

/** `Véhicule` : les véhicules du canon (à plat sauf mention `sousDossiers`) + `Autres` + `Recherche & achat`. PURE. */
function noeudsVehiculeReset_() {
  var n = {};
  CONFIG.MISSIONS_VEHICULES.forEach(function (v) { n[v.nom] = sousDossiersVehiculeReset_(v); });
  n['Autres'] = {}; n['Recherche & achat'] = {};
  return n;
}

/** `Employeurs` : les employeurs du profil, à plat (ADR-0080). PURE. */
function noeudsEmployeursReset_() {
  var n = {};
  CONFIG.PARCOURS.employeursNoeuds.forEach(function (e) { n[e.nom] = {}; });
  return n;
}

/** `Banques` : une entrée par banque active du profil (`PARCOURS.finance.banques`), puis `Autres`. PURE. */
function noeudsBanquesReset_() {
  var n = {};
  CONFIG.PARCOURS.finance.banques.forEach(function (b) { n[b.dossier] = {}; });
  n['Autres'] = {};
  return n;
}

var _structureCibleCache = null;

/**
 * La table cible, construite À L'APPEL depuis `CONFIG` (jamais au chargement du fichier : l'ordre
 * de chargement face à `Config.gs` n'est pas garanti, et le profil privé y est appliqué). PURE.
 * Mémorisée tant que `CONFIG.PARCOURS` est le même objet.
 * @return {Object} domaine → arbre de sous-dossiers
 */
function structureCibleReset_() {
  var source = CONFIG.PARCOURS;
  if (_structureCibleCache && _structureCibleCache.source === source) return _structureCibleCache.table;
  var table = {
    '01 · Administratif & identité': {
      'Pièces d\'identité & permis': { 'Autres': {} },
      'État civil & notarial': { 'Autres': {} },
      'Attestations & contrats': { 'Autres': {} },
      'Correspondance': { 'Autres': {} },
      'Sécurité & codes': {},
    },
    '02 · Finances': {
      'Banques': noeudsBanquesReset_(),
      'Relevés': { '2026': {}, '2025': {}, '2024': {}, '2023': {} },
      'Reçus & factures': {
        '2026': { 'Abonnements SaaS & API': {} },
        '2025': {}, '2024': {}, '2023': {}, '2022': {}, '2021': {}, 'Autres': {},
      },
      'Impôts & déclarations': {},
      'Assurances & prévoyance': {},
      'Placements & crypto': {},
      // « Revenus & paie » REMPLACE « Donations & successions » (décision Marc 2026-07-30, sur le
      // reliquat réel : 10 bulletins de paie bloqués faute de dossier d'accueil). 02 était PLEIN à 7 :
      // la place est prise sur le seul nœud que le reset n'avait JAMAIS créé (vérifié dans Drive —
      // aucun fichier n'y a été routé), donc AUCUN dossier déjà rempli n'est touché. Les rares
      // donations/successions vont désormais en « Impôts & déclarations » (leur versant fiscal) ;
      // leur versant NOTARIAL est déjà couvert par `01 · État civil & notarial`.
      'Revenus & paie': {},
      'Budgets & suivi': {},
    },
    '03 · Logement & véhicule': {
      // GESTE SYMÉTRIQUE C28-51 (ADR-0040 §3c) : les nœuds PLURIELS « Logements »/« Véhicules »
      // sont RETIRÉS — les missions 03 les VIDENT et les peignent en rouge ; les garder ici les
      // ferait RECRÉER par nom à chaque classement (ping-pong, leçon Fusion #47 — même geste que
      // « Recherche d'emploi » en 05). Le flux vise les cibles SINGULIER de Marc, aux NOMS RÉELS
      // des dossiers Drive (find-or-create PAR NOM).
      'Logement': noeudsLogementsReset_(),
      'Véhicule': noeudsVehiculeReset_(),
    },
    // 04 : structure INTERNE (ADR-0030 §4) — les fichiers ne sortent JAMAIS de 04 automatiquement.
    '04 · Immigration': {
      'Résidence permanente': {
        'Boulot': {},
        'Identité': {},
        'Études & Diplômes': {},
        'Formulaires, fiscalité & preuves RP': {},
      },
      'Permis de travail & EIMT': {},
      'IRCC (fédéral)': {},
      'MIFI (Québec)': {},
      'Autres': {},
    },
    '05 · Carrière': {
      'Employeurs': noeudsEmployeursReset_(),
      'Entreprise — MRic (SCI)': {},
      'CV & lettres': { 'CV & modèles': {}, 'Lettres de motivation (Archives)': {} },
      'Recherche d\'emploi': {},
    },
    '06 · Études & diplômes': {
      // ⚠️ LES NOMS CI-DESSOUS SONT CEUX DE MARC, relevés dans son Drive le 14/09 — tirets
      // CADRATINS (—), parenthèses et casse compris. `sousDossier_` résout par `getFoldersByName`,
      // qui est SENSIBLE À LA CASSE : une casse différente, ou un tiret simple à la place
      // du cadratin, et le moteur crée un SECOND dossier à côté du sien — exactement comme
      // « <n> route <rue> » à côté de « <n> rte <rue> » (leçon vécue en 03).
      // Deux tests le verrouillent : les noms == le relevé Drive, et chacun survit à `champ_`.
      // 7 enfants depuis ADR-0056 (la fusion des deux dossiers de collège/lycée) : SOUS le plafond,
      // donc plus aucune exemption pour ce niveau. Celle de l'école d'ingénieurs (16 enfants) demeure,
      // elle, dans `exemptionsPlafondReset_` — nommée, jamais une omission silencieuse.
      'Diplômes & relevés officiels': {},
      'Archives scolaires': archivesScolairesReset_(),
      'Formations en ligne — Google AI Essentials': {},
      'Autres': {},
    },
    '07 · Santé': {
      'Dossier médical & vaccins': {},
      'Assurances santé': {},
      'Autres': {},
    },
    '08 · Perso & projets': {
      'Projets': {}, // rempli ci-dessous : « DriveAI », `PARCOURS.reset.projetPerso`, puis « Autres »
      'Photographie & souvenirs': { 'RAW Canon R50 (2024)': {}, 'Photos souvenirs': {} },
      'Sport & sorties': {},
      'Jeux vidéo & captures': {},
      'Schémas & technique': {},
      'Données & exports': {},
    },
    '09 · Voyages': {
      'Par voyage': {
        'Brésil': {},
        'Chine': {},
        'Finlande': {},
        'Pérou': {},
        'Québec — Visite famille (2025-2026)': {},
      },
      'Réservations & billets': { '2026': {}, '2025': {}, '2024': {}, '2020\u20132023': {}, 'Autres': {} },
      'Assurances voyage': {},
    },
  };
  var projets = {};
  projets['DriveAI'] = {};
  projets[source.reset.projetPerso.dossier] = {};
  projets['Autres'] = {};
  table['08 · Perso & projets']['Projets'] = projets;
  _structureCibleCache = { source: source, table: table };
  return table;
}

/**
 * Vérifie la contrainte « ≤ maxParNiveau enfants à CHAQUE niveau » sur toute la table. Rend la
 * liste des violations (chemin : n) — vide = conforme. PURE (le test dérive ses cas de la table,
 * jamais d'une valeur du jour — leçon §7).
 * EXEMPTION EXPLICITE (revue PR1) : le niveau RACINE (les 9 domaines 01→09, préexistants et validés
 * par Marc avec la structure) n'est PAS compté — la contrainte porte sur l'INTÉRIEUR des domaines.
 * Trois familles d'enfants DYNAMIQUES vivent hors table (C28-49 PR2) : « Pièces d'identité/
 * Autres/<personne> » (bornée par PARCOURS.personnesAutres, testée ≤ 7), « Revenus & paie/
 * <employeur> » (bornée par CONFIG.MISSIONS_EMPLOYEURS, testée ≤ 7) et « Impôts & déclarations/
 * <AAAA> » (années réelles — > 7 ASSUMÉ, même statut structurel que les buckets Relevés/AAAA).
 */
function verifierStructureCibleReset_(structure, maxParNiveau) {
  var violations = [];
  var marcher = function (noeud, chemin) {
    var enfants = Object.keys(noeud || {});
    if (enfants.length > maxParNiveau && exemptionsPlafondReset_().indexOf(chemin) === -1) {
      violations.push(chemin + ' : ' + enfants.length + ' sous-dossiers');
    }
    for (var i = 0; i < enfants.length; i++) marcher(noeud[enfants[i]], chemin + '/' + enfants[i]);
  };
  Object.keys(structure || {}).forEach(function (dom) { marcher(structure[dom], dom); });
  return violations;
}

/* ================= ROUTAGE PAR LE NOM (PUR) ================= */

/** Vrai si la clé normalisée contient l'UN des motifs (déjà normalisés). PURE. */
function resetContient_(cle, motifs) {
  for (var i = 0; i < motifs.length; i++) { if (cle.indexOf(motifs[i]) !== -1) return true; }
  return false;
}

/**
 * MOT ENTIER dans une clé normalisée. PURE. `resetContient_` est une SOUS-CHAÎNE (« rib » ⊂
 * « contribution », « avis » ⊂ « avise ») : dès qu'un jeton est court, c'est celui-ci qu'il faut.
 * @param {string} cle @param {string} mot @return {boolean}
 */
function resetMotEntier_(cle, mot) {
  // ÉCHAPPEMENT obligatoire : la fonction est au contrat inter-modules, donc offerte à la
  // réutilisation — sans lui, un motif contenant un métacaractère ('a.c') apparierait 'abc'
  // (vérifié en revue). Le coût est nul, l'oubli serait silencieux.
  var m = String(mot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + m + '([^a-z0-9]|$)').test(String(cle || ''));
}

/** Vrai si la clé normalisée contient l'UN des mots, en MOT ENTIER. PURE. */
function resetMotEntierUn_(cle, mots) {
  for (var i = 0; i < mots.length; i++) { if (resetMotEntier_(cle, mots[i])) return true; }
  return false;
}

/**
 * Exclusions déclarées pour un JETON de `MISSIONS_ANNEES02_DOMAINES` (ADR-0044 §7). PURE (testée).
 * UNE table, DEUX consommateurs : la mission (sortie inter-domaines) et le flux (règle d'émetteur).
 * @param {string} jeton @return {string[]}
 */
function exclusionsSortie02_(jeton) {
  var sortie = [];
  (CONFIG.MISSIONS_ANNEES02_DOMAINES || []).forEach(function (r) {
    if ((r.jetons || []).indexOf(jeton) === -1) return;
    (r.exclusions || []).forEach(function (x) { if (sortie.indexOf(x) === -1) sortie.push(x); });
  });
  return sortie;
}

/**
 * Vrai si le TYPE est FISCAL (ADR-0044 §7, revue finale PR4). PURE (testée).
 *
 * ⚠️ UNE seule règle, DEUX consommateurs — c'est tout l'objet de cette fonction. Le vocabulaire
 * fiscal était écrit deux fois : la table `TYPES_FISCAUX_MISSIONS` côté mission, et une liste en
 * dur ici. Quand le flux est devenu l'autorité dans 02, c'est la version la plus PAUVRE qui a
 * gagné : « Relevé fiscal », « Relevé annuel fiscal » et « Relevé de cotisation » partaient chez
 * les relevés BANCAIRES (l'exclusion ne portait que sur le mot « impôt »), à clé de SUCCÈS donc
 * définitivement. C'est la limite de la garde par CAPACITÉ : elle est complète SI la règle
 * partagée est juste — sinon elle hérite de ses fautes en silence.
 *
 * « declaration » seul est VOLONTAIREMENT absent : il volerait « Relevé de déclaration de
 * sinistre ». La locution complète « declaration de revenus » est là, elle, sans ambiguïté.
 * @param {string} t  segment TYPE normalisé @return {boolean}
 */
function estTypeFiscalReset_(t) {
  // LOCUTIONS d'abord — `resetContient_` est une SOUS-CHAÎNE, donc le singulier couvre le pluriel
  // (« relevé de cotisationS », la forme la plus courante chez l'URSSAF et les mutuelles, est
  // capturée par « releve de cotisation »). C'est justement ce que l'ancienne version, qui testait
  // le MOT ENTIER « cotisation », ne faisait pas.
  // ⚠️ « cotisation » NU est banni : il volait les appels de prime d'ASSURANCE (« Appel de
  // cotisation_Fidelia-MUTA » partait dans les impôts) et ceux d'un régime de santé étranger, qui est de la santé.
  // ⚠️ « declaration » NU est banni aussi : il volerait « Relevé de déclaration de sinistre ».
  if (resetContient_(t, ['avis d imposition', 'avis de cotisation', 'releve de cotisation',
    'declaration de revenus', 'declaration des revenus', 'declaration d impot'])) return true;
  var mots = ['impot', 'impots', 'fiscal', 'fiscale', 'fiscaux', 'taxe', 'taxes', 'feuillet', 'feuillets', 't4'];
  for (var i = 0; i < mots.length; i++) if (resetMotEntier_(t, mots[i])) return true;
  return false;
}

/**
 * Année → nom de sous-dossier d'un nœud à années. L'année si elle existe dans le nœud ; sinon, une
 * année POSTÉRIEURE au dernier bucket figé rend SON PROPRE segment (`2027`), une année ANTÉRIEURE
 * tombe dans `Archives`.
 * ADR-0033 (revue structure-keeper) : les buckets de `STRUCTURE_CIBLE_RESET` sont un instantané
 * HISTORIQUE (2021-2026 + Archives) conçu pour le grand rangement one-shot. Depuis l'unification, le
 * FLUX VIVANT délègue ici — et il AVANCE dans le temps : sans ce forward, tout relevé/reçu/billet de
 * 2027+ atterrirait dans `Archives` (= « ancien », faux). On laisse donc l'année courante et à venir
 * créer son dossier (léger dépassement ≤ 7 au fil des ans, ASSUMÉ vs un mauvais rangement ; la
 * fenêtre glissante avec purge est une évolution possible, cf. ADR-0033 §6). Le PASSÉ reste borné.
 */
function resetBucketAnnee_(annee, noeudAnnees) {
  if (annee && noeudAnnees && noeudAnnees[annee]) return annee;
  var a = parseInt(annee, 10);
  if (noeudAnnees && noeudAnnees['2020\u20132023'] && a >= 2020 && a <= 2023 && String(a) === String(annee)) {
    return '2020\u20132023';
  }
  var repli = noeudAnnees && noeudAnnees['Autres'] ? 'Autres'
    : (noeudAnnees && noeudAnnees['Archives'] ? 'Archives' : '');
  if (!a || String(a) !== String(annee)) return repli;
  if (repli) {
    var maxAnnee = 0;
    for (var k in noeudAnnees) { var n = parseInt(k, 10); if (String(n) === k && n > maxAnnee) maxAnnee = n; }
    return a > maxAnnee ? String(a) : repli; // postérieure aux buckets → son segment ; antérieure → Autres/Archives
  }
  return String(a); // nœud annuel ouvert sans Archives ni Autres (ex. Relevés) → année directe
}

/**
 * Plausibilité d'une année (`AAAA`, 1990-2100) — LA règle PARTAGÉE flux ↔ missions (revue
 * structure-keeper PR2 : deux fenêtres écrites séparément divergeaient déjà — 1900-2099 ici,
 * 1990-2100 côté mission — la graine exacte de C28-26). Vit ICI (et pas dans Missions.gs) parce
 * que Missions.gs dépend déjà de Reset.gs, jamais l'inverse : les contextes de test qui chargent
 * Reset.gs seul restent autonomes. Consommateurs : `cheminImpotsReset_`, `anneeDuNomMission_` et
 * `moisManquantsPaies_` (Missions.gs). PURE.
 */
function anneePlausible_(annee) {
  var s = String(annee || '');
  if (!/^\d{4}$/.test(s)) return false;
  var a = Number(s);
  return a >= 1990 && a <= 2100;
}

/* Prédicats de TYPE partagés flux ↔ missions (revue finale PR2 : `routerFinance02_` ré-écrivait
 * séparément trois règles que le flux possédait déjà — RL-1/31, RIB, « salaire » — et divergeait
 * sur chacune, à clé de SUCCÈS côté mission donc DÉFINITIF. Leçon C28-26 : une seule règle, deux
 * consommateurs). Segment TYPE normalisé (minuscules sans accents, mots séparés par espaces). */

/** Bulletin de paie/salaire — MOT entier, jamais « paiement » (piège #228). PURE. */
function estTypePaieReset_(t) {
  return /(^| )(paie|paye|salaire)( |$)/.test(t);
}

/**
 * Feuillet **T4** (fédéral) — MOT ENTIER, jamais « T4A ». PURE.
 *
 * Décision de Marc, 14/09 : « oui le t4 aussi dans finances ». Tout salarié québécois reçoit chaque
 * année un T4 (fédéral) ET un RL-1 (provincial), émis par le MÊME employeur, avec EXACTEMENT le même
 * mode de panne : le LLM voit un employeur et route en `05`.
 * ⚠️ PRÉDICAT DÉDIÉ, et non `estTypeFiscalReset_` (qui connaît déjà `t4`) : celui-là matche aussi
 * `taxe`/`taxes` en mot entier et attraperait un « Compte de taxes municipales », qui relève de `03`
 * (🟠 revue structure). Un verdict qui DÉPLACE est définitif de fait : le prédicat vise juste.
 * ⚠️ `t4a` est un AUTRE feuillet (revenus autres qu'un emploi salarié) : `resetMotEntier_` le laisse
 * de côté par construction, et Marc a nommé le T4. Élargir serait une décision, pas un effet de bord.
 */
function estFeuilletT4Reset_(t) {
  return resetMotEntier_(t, 't4');
}

/** Relevé 31 SEUL (occupation d'un logement, émis par le PROPRIÉTAIRE). PURE. */
function estRl31Reset_(t) {
  return /(^| )releve 31( |$)/.test(t);
}

/**
 * Ce document est-il un REVENU D'EMPLOYEUR ? (ADR-0058 — décision de Marc.)
 *
 * Son domaine est alors `02 · Finances`, quel que soit le domaine rendu par le LLM. Pourquoi c'est
 * nécessaire : une paie NOMME un employeur dans son en-tête, donc le LLM répond « 05 · Emploi &
 * carrière » — ce qui n'est pas absurde, c'est simplement la mauvaise règle pour ce type-là. Les
 * MISSIONS de curation le savaient déjà (« le domicile UNIQUE des paies est 02 ») ; le FLUX, non.
 * Résultat vécu : les missions rangeaient, le flux dé-rangeait, et comme les missions convergent
 * puis s'arrêtent, c'est le flux qui avait le dernier mot sur tout ce qui arrive désormais.
 *
 * ⚠️ DÉRIVE LE TYPE PAR LA MÊME FONCTION que `cheminCibleReset_` (`analyserNomClasse_` +
 * `normaliserCle_`), sur le nom FINAL que celui-ci recevra ensuite : la convergence flux↔reset est
 * STRUCTURELLE, pas une coïncidence à re-vérifier (§9, C28-26).
 *
 * ⚠️ RL-31 EXCLU, explicitement. `estFeuilletFiscalReset_` couvre RL-1 ET RL-31 ; on le RÉUTILISE en
 * lui soustrayant le 31 plutôt que d'écrire une deuxième règle qui divergera au premier ajout. Le
 * RL-31 est émis par le PROPRIÉTAIRE (occupation d'un logement), pas par l'employeur : il n'a pas
 * le mode de panne « le LLM voit un employeur et route en 05 », et le tirer vers `02` serait un
 * changement que Marc n'a pas demandé — il a nommé le RL-1.
 *
 * ⚠️ `estReleveDePaie_` N'EST PAS ICI. ADR-0044 D9 en fait une paie mensuelle, mais UNIQUEMENT parce
 * qu'un employeur est déjà garanti par le contexte de la mission. Au point de décision du flux,
 * cette garantie n'existe pas : l'appliquer ici capturerait les relevés BANCAIRES. §9, « l'asymétrie
 * des verdicts commande la sévérité du prédicat » — un verdict qui DÉPLACE est définitif de fait,
 * donc le prédicat est strict et, dans le doute, refuse.
 * ⚠️ LE NUMÉRO DU FEUILLET NE SURVIT PAS AU RENOMMAGE. Mesuré : `nommerDocument_` réduit
 * « Relevé 1 » à « Relevé » dans le nom final — le « 1 », sur lequel `estFeuilletFiscalReset_` est
 * ANCRÉ, a donc déjà disparu quand on lit le nom. Le type BRUT du LLM est le seul endroit où il
 * reste. On lit donc les deux, et seulement pour le feuillet : les paies, elles, traversent le
 * renommage intactes et restent jugées sur le nom — là où la convergence avec `cheminCibleReset_`
 * est structurelle. Élargir le chemin « type brut » aux paies relâcherait un verdict qui DÉPLACE,
 * sans rien gagner (§9, l'asymétrie des verdicts commande la sévérité du prédicat).
 * PURE (testée).
 * @param {string} nom  nom FINAL du document (`AAAA-MM-JJ_Type_Émetteur.ext`)
 * @param {string=} typeBrut  `type_doc` rendu par le LLM, avant renommage
 */
function estRevenuEmployeurReset_(nom, typeBrut) {
  var b = normaliserCle_(typeBrut || '');
  // ⚠️ DISQUALIFIANTS LUS SUR LE TYPE BRUT, et ils passent EN PREMIER (🟠 revue structure ADR-0058).
  // « Attestation de salaire », « Assurance salaire », « Preuve de salaire » sont des documents de
  // CARRIÈRE — la frontière que Marc a posée en disant « attestation d'emploi reste dans 05 ». Or
  // `schemaNommage_` les renomme TOUS en « Paie » : mesuré, `Attestation de salaire` devient
  // `2026-09_Paie_Alphatek.pdf`. Le mot qui disqualifie a donc DÉJÀ disparu quand on lit le nom —
  // et il a disparu pour les AUTRES consommateurs du prédicat partagé aussi, qui ne lisent que des
  // noms. Le type brut du LLM est le SEUL endroit où l'information existe encore : c'est là que la
  // distinction se fait, pas ailleurs (§9, « un verdict pris sur la donnée RICHE ne se re-dérive
  // jamais depuis sa forme APPAUVRIE »).
  if (b && estDisqualifieCommeRevenuReset_(b)) return false;
  var t = normaliserCle_(analyserNomClasse_(nom).type || '');
  if (estTypePaieReset_(t)) return true;
  if (estFeuilletT4Reset_(t)) return true;                       // décision Marc 14/09
  if (estFeuilletFiscalReset_(t) && !estRl31Reset_(t)) return true;
  if (!b) return false;
  return estFeuilletT4Reset_(b) || (estFeuilletFiscalReset_(b) && !estRl31Reset_(b));
}

/**
 * Ce type BRUT contient-il un mot qui le disqualifie comme revenu, malgré « salaire » ? PURE.
 *
 * Une ATTESTATION de salaire prouve qu'on est payé ; elle ne dit pas ce qu'on a été payé ce
 * mois-ci. Elle sert à une banque, à la CNESST, à un assureur — c'est un document de carrière, du
 * même genre que l'attestation d'emploi que Marc garde explicitement en `05`. Même chose pour
 * l'assurance salaire (invalidité), qui relève des assurances.
 * ⚠️ N'agit QUE sur le type brut : ces mots ne survivent pas au renommage, donc le nom final ne
 * peut pas les voir. Si le type brut manque, on retombe sur le comportement d'avant — assumé.
 */
function estDisqualifieCommeRevenuReset_(b) {
  var mots = ['attestation', 'assurance', 'preuve', 'certificat', 'demande', 'reclamation'];
  for (var i = 0; i < mots.length; i++) if (resetMotEntier_(b, mots[i])) return true;
  return false;
}

/** Feuillet fiscal québécois RL-1/RL-31 — ANCRÉ sur le nombre (jamais « Relevé 10 »). PURE. */
function estFeuilletFiscalReset_(t) {
  return /(^| )releve (1|31)( |$)/.test(t);
}

/** Relevé d'IDENTITÉ bancaire (RIB) — des coordonnées, jamais un relevé de compte. PURE. */
function estRibReset_(t) {
  return t.indexOf('releve d identite bancaire') !== -1;
}

/**
 * Règle stricte des factures et reçus de paiement (ADR-0080) : la nature prime sur le thème.
 * Retourne vrai pour toute facture ou reçu de paiement (énergie, télécom, santé, achats, SaaS,
 * amendes payées) qui doit converger vers `02 · Finances / Reçus & factures`, à l'exclusion des
 * pièces d'identité, paies, feuillets fiscaux, baux/contrats, ordonnances, décomptes et courriels
 * (« Courriel reçu » = participe passé de recevoir, jamais un reçu de paiement). PURE (testée).
 * @param {string} nom  nom FINAL du document (`AAAA-MM-JJ_Type_Émetteur.ext`)
 * @param {string=} typeBrut  `type_doc` brut rendu par le LLM avant renommage
 * @return {boolean}
 */
function estFactureOuRecuPaiementReset_(nom, typeBrut) {
  var t = normaliserCle_(analyserNomClasse_(nom).type || '');
  var b = normaliserCle_(typeBrut || '');
  var disqualifiants = ['contrat', 'bail', 'police', 'garantie', 'immatriculation', 'carte grise',
    'inspection', 'attestation', 'devis', 'soumission', 'avenant', 'conditions generales',
    'ordonnance', 'prescription', 'analyse', 'examen', 'compte rendu', 'resultat', 'decompte',
    'releve de soins', 'budget', 'quittance', 'billet', 'confirmation de reservation', 'itineraire'];
  var estDisqualifie = function (s) {
    if (!s) return false;
    if (estTypeFiscalReset_(s) || estFeuilletFiscalReset_(s) || estFeuilletT4Reset_(s) ||
        estTypePaieReset_(s) || estDocumentIdentiteReset_(s)) return true;
    for (var i = 0; i < disqualifiants.length; i++) {
      var d = disqualifiants[i];
      if (d.indexOf(' ') !== -1 ? s.indexOf(d) !== -1 : resetMotEntier_(s, d)) return true;
    }
    return false;
  };
  if (estDisqualifie(t) || estDisqualifie(b)) return false;
  var motsPositifs = ['facture', 'factures', 'invoice', 'recu', 'recus', 'receipt'];
  var locutionsPositives = ['facturation', 'note de frais', 'amende payee', 'preuve de paiement', 'recu de paiement'];
  var contientCourrierSansFacture = function (s) {
    return resetMotEntierUn_(s, ['courriel', 'mail', 'message', 'lettre']) &&
      !resetMotEntierUn_(s, ['facture', 'factures', 'invoice', 'paiement']);
  };
  var estPositif = function (s) {
    if (!s) return false;
    if (resetContient_(s, locutionsPositives)) return true;
    if (contientCourrierSansFacture(s)) return false;
    return resetMotEntierUn_(s, motsPositifs);
  };
  return estPositif(t) || estPositif(b);
}

/**
 * « Impôts & déclarations »/<année> — PAR ANNÉE depuis C28-49 PR2 (décision Marc « séparé par
 * années avec tous les documents pour chaque année ») : MÊME segment (AAAA nu) que mission-impots
 * (`anneeDuNomMission_` côté mission, `seg.annee` côté flux — même valeur : l'année du NOM,
 * même plausibilité : `anneePlausible_`).
 * Année absente/implausible → racine (mission-impots la reprendra si une règle future l'éclaire).
 */
function cheminImpotsReset_(seg) {
  var a = seg && seg.annee ? String(seg.annee) : '';
  return anneePlausible_(a) ? 'Impôts & déclarations/' + a : 'Impôts & déclarations';
}

/**
 * Personnes « Autres » connues (pièces d'identité) : `CONFIG.PARCOURS.personnesAutres`, clé
 * normalisée → libellé de dossier. Liste EXPLICITE, jamais devinée : une pièce d'identité dont le
 * titulaire n'est pas ici (et qui n'est pas émise par une autorité) reste en `_TRI` au rapport —
 * c'est Marc qui tranche, à qui appartient le dossier. Une 3ᵉ personne a été ajoutée sur sa
 * validation (2026-07-30, après remontée du reliquat réel).
 */

/**
 * Dossiers/fichiers JAMAIS touchés par le reset (en plus des `00 ·`, `_…` et de la zone gérée à
 * part) : artefacts du moteur identifiés par NOM. PURE.
 */
function estExcluDuReset_(nom) {
  var propre = String(nom == null ? '' : nom).trim();
  return /^(DriveAI|Rapports agent|00 · Guide|00 · Raccourcis)/.test(propre) ||
    /^(restic-pc|univers)$/.test(propre) ||
    /^(\.git|node_modules|__pycache__|\.venv|venv|Takeout|Sauvegardes|Colab Notebooks|Google AI Studio|_Archive)$/.test(propre);
}

/**
 * FENÊTRES DE SCOLARITÉ de Marc (ADR-0052 D6, décision du 2026-09-13 : les années de chaque école,
 * données dans `CONFIG.PARCOURS.ecoles`). MÊME IDIOME que `fenetresOccupation_`/`logementParDate_`
 * (Missions.gs, ADR-0040, demande de Marc « regarde les dates pour déterminer ») : une table que
 * MARC a validée, pas une inférence du moteur — au même titre que `MISSIONS_BAILLEURS` ou
 * `PARCOURS.personnesAutres`.
 *
 * Bornes en MOIS, à la convention de l'année SCOLAIRE (septembre → août) : c'est ce qui rend les
 * fenêtres DISJOINTES, alors que les années nues de Marc se chevauchent aux charnières (2018 est à
 * la fois la fin d'Delta et le début de l'UNIVA). Sans ce découpage, 83 des 464 fichiers de `06`
 * tombaient dans deux fenêtres et étaient refusés pour rien.
 */
function fenetresEcoleReset_() {
  // ⚠️ LE LIBELLÉ DE LA 1ʳᵉ ÉCOLE DIT 2014-2018, SA FENÊTRE S'ARRÊTE EN 2017-08 — et c'est voulu
  // (ADR-0056, confirmé par Marc : « 2014-2017 c'est bon »). Étendre la fenêtre jusqu'en 2018 la
  // ferait CHEVAUCHER celle de la prépa (2017-09 → 2018-08) : tout document de cette année-là
  // tomberait dans deux fenêtres et serait REFUSÉ — l'année de prépa deviendrait inclassable par la
  // date. Le nom du dossier couvre la période de ses documents ; la fenêtre, elle, doit rester disjointe.
  // ⚠️ LE CÉGEP CHEVAUCHE L'ÉCOLE DU DUT, ET C'EST VOULU (Marc : « le cégep c'est 2019 en même temps
  // que le DUT »). La fenêtre n'est donc PAS là pour placer — elle est là pour EMPÊCHER de placer :
  // tout document de 2019 tombe dans deux fenêtres et se voit REFUSÉ, au lieu d'être attribué au
  // DUT par défaut. C'est 28 fichiers de moins placés, et zéro mal placé. Sans cette ligne,
  // l'omission du cégep aurait été SILENCIEUSE : le moteur aurait rangé ses documents chez le DUT
  // avec une clé de SUCCÈS, donc sans retour possible.
  // (ADR-0060) Le NOM du dossier du cégep dit « (2020) », la FENÊTRE reste 2019 : le nom est le
  // dossier de Marc, la fenêtre borne des DOCUMENTS — et elle ne sert qu'à refuser.
  return CONFIG.PARCOURS.ecoles.filter(function (e) { return e.fenetre; }).map(function (e) {
    return { ecole: e.libelle, debut: e.fenetre[0] * 12 + e.fenetre[1], fin: e.fenetre[2] * 12 + e.fenetre[3] };
  });
}

/**
 * ÉCOLE déduite de la DATE du nom — `null` dès qu'il y a le moindre doute. PURE.
 *
 * Le verdict est POSITIF et DÉPLACE le fichier hors du périmètre de collecte : il est donc
 * définitif de fait, et le prédicat doit être STRICT (leçon §9, « l'asymétrie des verdicts commande
 * la sévérité du prédicat »). D'où deux niveaux de sévérité selon ce que le nom porte :
 *  - date COMPLÈTE (`AAAA-MM`) → le mois doit tomber dans EXACTEMENT une fenêtre ;
 *  - ANNÉE SEULE → l'année CIVILE ENTIÈRE doit tenir dans une seule fenêtre. Une année à cheval sur
 *    deux écoles (2017, 2018, 2020, 2023) refuse — on ne devine pas de quel semestre il s'agit.
 * Hors de toute fenêtre ⇒ `null` : c'est ce qui protège les 239 fichiers datés `2026` (la date de
 * RÉCEPTION, faute de date lisible dans le document) d'être rattachés à une école au hasard.
 * @param {string} nom @return {?string} libellé d'école de `STRUCTURE_CIBLE_RESET['06 · …']`
 */
function ecoleParDateReset_(nom) {
  var m = /^(\d{4})(?:-(\d{2}))?/.exec(String(nom == null ? '' : nom).trim());
  if (!m || !anneePlausible_(m[1])) return null;
  var an = Number(m[1]);
  var trouve = null;
  var fenetres = fenetresEcoleReset_();
  for (var i = 0; i < fenetres.length; i++) {
    var f = fenetres[i], dedans;
    if (m[2]) {
      var mois = Number(m[2]);
      if (mois < 1 || mois > 12) return null; // mois illisible : on ne retombe pas sur l'année
      dedans = (an * 12 + mois) >= f.debut && (an * 12 + mois) <= f.fin;
    } else {
      dedans = (an * 12 + 1) >= f.debut && (an * 12 + 12) <= f.fin; // l'année ENTIÈRE dans la fenêtre
    }
    if (dedans) { if (trouve) return null; trouve = f.ecole; } // deux fenêtres ⇒ ambigu ⇒ refus
  }
  return trouve;
}

/** Le libellé EXACT du dossier de l'école `cle` (`CONFIG.PARCOURS.ecoles`). PURE. @return {string} */
function libelleEcoleReset_(cle) {
  var ecoles = CONFIG.PARCOURS.ecoles;
  for (var i = 0; i < ecoles.length; i++) { if (ecoles[i].cle === cle) return ecoles[i].libelle; }
  throw new Error('École inconnue du profil : ' + cle);
}

/**
 * ÉCOLE reconnue DANS LE NOM (ADR-0052 D6) : l'établissement lui-même, ou un marqueur de NIVEAU /
 * FILIÈRE qui ne peut appartenir qu'à lui. C'est un FAIT écrit, donc il prime sur toute déduction.
 * Extrait de `cheminCibleReset_` pour que la consolidation puisse distinguer « école SUE » d'« école
 * DÉDUITE » sans re-dériver le verdict depuis une forme appauvrie (leçon §9). PURE.
 * @param {string} nom @return {?string} libellé EXACT d'un nœud de `STRUCTURE_CIBLE_RESET['06 · …']`
 */
function ecoleParNomReset_(nom) {
  var tout = normaliserCle_(nom);
  var sansTiret = tout.replace(/-/g, ' '); // `normaliserCle_` CONSERVE les traits d'union
  var M = CONFIG.PARCOURS.marqueursEcole;
  var libelle = libelleEcoleReset_;
  // --- L'ÉTABLISSEMENT, nommé.
  if (resetContient_(tout, M.college)) return libelle('college');
  // Un collège homonyme d'une école du parcours et une maison d'accueil rattachée à l'école du
  // DUT ne sont PAS la prépa/le DUT : testés AVANT leurs mots-pièges.
  if (resetContient_(tout, M.autresAvant)) return 'Autres';
  if (resetContient_(tout, M.prepa)) return libelle('prepa');
  if (resetContient_(sansTiret, M.dut)) return libelle('dut');
  if (resetContient_(tout, M.cegep)) return libelle('cegep');
  // (ADR-0060 / ADR-0080) Les 4 documents Google natifs « AI Essentials — … » vivent à la racine de 06.
  if (/(^|[^a-z0-9])ai essentials([^a-z0-9]|$)/.test(tout)) return 'Formations en ligne — Google AI Essentials';
  if (resetContient_(tout, M.ingenieur)) return libelle('ingenieur');
  if (resetContient_(sansTiret, M.autresApres)) return 'Autres';

  // --- Le NIVEAU ou la FILIÈRE, qui ne désignent qu'une école dans le parcours de Marc.
  // ⚠️ Tous ANCRÉS en mot entier. « seconde » est aussi une unité de temps et « terminale » un
  // terme d'électrotechnique — dans un corpus fait à 80 % de TP de physique et d'électronique
  // (revue flotte). Le verdict déplace le fichier : dans le doute, il doit refuser.
  // ⚠️ « svt » a été RETIRÉ : c'est une MATIÈRE, pas un niveau, et elle s'enseigne aussi au collège
  // — hors de toute fenêtre. Preuve dans le corpus réel : deux fichiers du MÊME jour décrivant le
  // MÊME événement (répartition des groupes de langues du 2017-09-07) partaient dans DEUX écoles
  // différentes, l'un par « svt », l'autre par la fenêtre. L'un des deux était faux par construction.
  // Il ne reste que les DEUX marqueurs dont la contribution est MESURÉE sur le corpus réel :
  // la filière du DUT (19 fichiers) et « 1ʳᵉ … » (3 bulletins). `profuno`, `kholle`, `concours avenir` et `iut`
  // ont été RETIRÉS d'ici : les listes par NOM ci-dessus les captent déjà, donc ces tests étaient
  // INATTEIGNABLES — le bloc paraissait couvrir 13 signaux, il en appliquait 5 (revue flotte).
  // `2nde`, `seconde`, `terminale`, `svt`, `colle`, `colles`, `dut` ont été retirés pour l'autre
  // raison : contribution NULLE mesurée, et risque non nul (« 30 secondes » dans un TP de physique,
  // « borne terminale » en électrotechnique, « Seconde Guerre mondiale » en histoire). Un prédicat
  // qui ne gagne rien et peut se tromper ne mérite pas d'exister.
  for (var i = 0; i < M.filiere.length; i++) {
    if (new RegExp('(^|[^a-z0-9])' + M.filiere[i] + ' ?[12]?([^a-z0-9]|$)').test(sansTiret)) return libelle('dut');
  }
  if (/(^|[^a-z0-9])1 ?ere([^a-z0-9]|$)/.test(sansTiret)) return libelle('college');
  return null;
}

/**
 * VETO COLLÉGIAL QUÉBÉCOIS (revue flotte, C28-90) — le nom crie « cégep » sans nommer
 * l'établissement : aucune fenêtre n'a le droit de trancher. PURE.
 *
 * Pourquoi il faut un veto plutôt qu'une fenêtre plus large : Marc a dit « Valdor c'est 2019 en
 * même temps que l'UNIVA », mais le dossier RÉEL du cégep contient des fichiers de
 * 2018-08 à 2025-01 (relevé le 13/09). Étendre la fenêtre rendrait l'UNIVA inattribuable sur toute
 * la période ; le veto, lui, ne coûte que les documents qui se désignent eux-mêmes comme collégiaux.
 * Sans lui, 5 documents du corpus (« Direction du Cégep » 2020-03, « Message MIO » 2020-10…)
 * partaient chez l'UNIVA et chez CORVIA avec une clé de SUCCÈS — le mode de panne exact que la
 * fenêtre de Valdor était censée éviter, décalé de trois mois.
 * `mio` = la messagerie Omnivox des cégeps ; `sram` = le service d'admission collégiale.
 * @param {string} nom @return {boolean}
 */
function vetoCollegialReset_(nom) {
  var tout = normaliserCle_(nom).replace(/-/g, ' ');
  return resetContient_(tout, ['cegep', 'collegial', 'omnivox', 'centre de services scolaire',
    'commission scolaire']) || resetMotEntier_(tout, 'mio') || resetMotEntier_(tout, 'sram');
}

/**
 * Pose le marqueur « cible FAIBLE » (ADR-0052 D8) PUIS rend le chemin — un seul geste, pour que le
 * drapeau ne puisse jamais se désolidariser du `return` qu'il qualifie. PURE : elle écrit dans
 * l'objet `detail` que l'APPELANT lui passe, jamais dans un état global.
 *
 * FAIBLE = « ce chemin ne vient QUE du TYPE du document, et sa destination est un FOURRE-TOUT ».
 * Un tel filet sait CE QUE C'EST, jamais À QUI ni À QUOI le document se rattache : il a le droit de
 * sortir un fichier de la RACINE d'un domaine, jamais de le retirer d'un sous-dossier où une
 * mission — ou Marc — l'a rangé.
 *
 * ⚠️ LE CRITÈRE EST LA DESTINATION, pas seulement le prédicat (arbitrage explicite, revue de code
 * C28-90 🟠 3 — l'ADR-0052 §10 le détaille site par site). Sont FAIBLES les nets dont la cible est
 * un fourre-tout du domaine (`Contrats`, `Correspondance`, `Travaux & équipements`,
 * `Attestations & certificats`, `Véhicule/À attribuer`) : ils disent « je ne sais pas à quoi ça se
 * rattache ». Restent FORTS les nets dont la cible est le domicile THÉMATIQUE de ce type de
 * document (`État civil & notarial`, `Diplômes & relevés officiels`, `Pièces d'identité/…`) : ils
 * disent « je sais exactement ce que c'est, et ce genre de document vit ICI » — c'est une décision
 * de taxonomie, pas un aveu d'ignorance, et elle doit garder le pouvoir de rassembler.
 *
 * ⚠️ Pourquoi un marqueur et pas une re-lecture du chemin rendu : `'Contrats'` ne dit pas si c'est
 * l'entité ou le type qui a répondu. Re-dériver le verdict de sa forme appauvrie est la leçon §9
 * (« un verdict pris sur la donnée RICHE ne se re-dérive jamais depuis sa forme APPAUVRIE ») — et
 * c'est exactement ce que faisait la 1ʳᵉ version du drapeau « école » (revue sécurité C28-90 : il
 * se posait aussi sur la branche `Diplômes & relevés officiels`, qui rend AVANT tout calcul d'école).
 * @param {?Object} detail  objet de sortie passé à `cheminCibleReset_` (absent = personne n'écoute)
 * @param {string} chemin
 * @return {string} `chemin`, inchangé
 */
function marquerFaibleReset_(detail, chemin) {
  if (detail) detail.faible = true;
  return chemin;
}

/**
 * CHEMIN CIBLE d'un fichier dans la NOUVELLE structure — par le NOM seul, zéro LLM.
 * @param {string} domaine  domaine d'ORIGINE (enregistré au rassemblement, clé `tri33|`)
 * @param {string} nom      nom actuel du fichier
 * @param {Object=} detail  objet de SORTIE optionnel : reçoit `faible = true` quand la cible ne
 *   vient que du TYPE du document (ADR-0052 D8, `marquerFaibleReset_`). Les appelants qui n'en passent pas
 *   (le reset, les missions) voient exactement le comportement d'avant.
 * @return {?string} chemin relatif au domaine (« Banques/Bellerives ») — null = NON ROUTÉ : le
 *   fichier RESTE dans `_TRI 2026` (rapport → affinage de table ou passe LLM) ; pour 04 (jamais
 *   rassemblée) null = reste À SA PLACE dans 04. Jamais deviné.
 */
function cheminCibleReset_(domaine, nom, detail) {
  var s = structureCibleReset_()[domaine];
  if (!s) return null;
  var seg = analyserNomClasse_(nom);
  var t = normaliserCle_(seg.type || '');
  var e = normaliserCle_(seg.tiers || '');
  var tout = normaliserCle_(nom);

  if (domaine === '01 · Administratif & identité') {
    // « numero d assurance sociale » ajouté avec `TYPES_IDENTITE` (ADR-0048) : sans lui, un NAS
    // canoniquement nommé n'aurait PAS de cible ici et serait tombé au repli — le type et la table
    // se livrent ensemble, c'est « une seule règle, deux consommateurs » appliqué au vocabulaire.
    // Vocabulaire EXTRAIT dans `estDocumentIdentiteReset_` (ADR-0052 D3) : la branche `04` du repli
    // par type le consomme aussi. Deux listes écrites séparément divergent au premier ajout.
    var autres01 = CONFIG.PARCOURS.personnesAutres;
    var proche01 = function () {
      for (var p in autres01) { if (e.indexOf(p) !== -1) return autres01[p]; }
      return '';
    };
    if (estDocumentIdentiteReset_(t)) {
      var nomProche = proche01();
      if (nomProche) return 'Pièces d\'identité & permis/Autres/' + nomProche;
      // Titulaire reconnu OU autorité émettrice ; un tiers inconnu qui ressemble à une personne rend null.
      var titulaire = CONFIG.PARCOURS.titulaire;
      if (e.indexOf(normaliserCle_(titulaire.prenom)) !== -1 && e.indexOf(normaliserCle_(titulaire.nom)) !== -1) return 'Pièces d\'identité & permis';
      // TITULAIRE DÉDUIT, donc FAIBLE (revue sécurité C28-90) : ici le nom ne dit PAS à qui est la
      // pièce — on suppose Marc parce que l'émetteur est une autorité (ou absent). C'est vrai pour
      // un document à la racine ; ça ne l'est plus face à un rangement existant, et un passeport
      // rangé sous `Pièces d\'identité/Autres/<proche>` partait chez Marc.
      if (e === '' || resetContient_(e, ['prefecture', 'saaq', 'societe de l assurance', 'ramq', 'gouvernement', 'republique', 'mairie', 'ministere', 'service', 'consulat', 'ambassade'])) {
        return marquerFaibleReset_(detail, 'Pièces d\'identité & permis');
      }
      return null;
    }
    // Le TYPE seul est FAIBLE, l'ÉMETTEUR notarial est FORT — deux `return` plutôt qu'un, parce que
    // le drapeau qualifie la RÈGLE qui a répondu, pas la destination (revue : le même dossier
    // portait un drapeau opposé selon le chemin d'arrivée).
    if (resetContient_(e, ['office notarial', 'notaire'])) return proche01() ? 'État civil & notarial/Autres' : 'État civil & notarial';
    if (resetContient_(t, ['acte de naissance', 'acte de mariage', 'fiche d etat civil',
      'fiche individuelle', 'livret de famille'])) {
      return proche01() ? 'État civil & notarial/Autres' : marquerFaibleReset_(detail, 'État civil & notarial');
    }
    if (resetContient_(t, ['attestation', 'certificat'])) {
      return proche01() ? 'Attestations & contrats/Autres' : marquerFaibleReset_(detail, 'Attestations & contrats');
    }
    var fournisseurs = CONFIG.PARCOURS.fournisseurs;
    if (resetContient_(e, fournisseurs.energieAnciens.jetons) || resetContient_(e, fournisseurs.energieContrats.jetons)) {
      return 'Attestations & contrats';
    }
    // MÊME exclusion que la table des missions — et LUE DEPUIS ELLE, pas recopiée : deux listes
    // écrites séparément divergent (une entrée ajoutée d'un côté serait invisible de l'autre),
    // c'est la graine exacte du défaut que cette PR corrige ailleurs. L'opérateur télécom peut être une marque
    // OMBRELLE : Atlantic (aérien), Radio, Megastore n'ont rien du télécom — Mobile, si.
    var exclusionsTelecom = [];
    fournisseurs.telecom.jetons.forEach(function (j) { exclusionsTelecom = exclusionsTelecom.concat(exclusionsSortie02_(j)); });
    if (resetContient_(e, fournisseurs.telecom.jetons) && !resetContient_(tout, exclusionsTelecom)) {
      return 'Attestations & contrats';
    }
    var fournisseurAutre = CONFIG.PARCOURS.reset.fournisseurAutre;
    if (resetContient_(e, fournisseurAutre.jetons) || resetContient_(e, ['tesco', 'transport scolaire']) ||
        resetContient_(e, CONFIG.PARCOURS.finance.assureurContrats.jetons) || e === 'ino') {
      return 'Attestations & contrats';
    }
    if (resetContient_(t, ['contrat', 'avenant'])) {
      return proche01() ? 'Attestations & contrats/Autres' : marquerFaibleReset_(detail, 'Attestations & contrats');
    }
    // Le pluriel n'est PAS couvert par le singulier (« codes de … » ne contient pas « code de … ») :
    // chaque forme est listée. `codes de recuperation`/`double facteur` ajoutés sur le reliquat réel
    // du 2026-07-30 (fichier resté en _TRI faute de règle).
    if (resetContient_(tout, ['code de securite', 'codes de securite', 'code de recuperation',
      'codes de recuperation', 'mot de passe', 'double facteur', 'authentification a deux facteurs']) ||
        (tout.indexOf('sauvegarde') !== -1 && e.indexOf('gmf') === -1)) return 'Sécurité & codes'; // GMF La Sauvegarde = un ASSUREUR (revue)
    if (resetContient_(t, ['lettre', 'courrier', 'correspondance', 'mise en demeure'])) {
      return proche01() ? 'Correspondance/Autres' : marquerFaibleReset_(detail, 'Correspondance');
    }
    return null;
  }

  if (domaine === '02 · Finances') {
    // ⚠️ EN TÊTE, avant toute règle : un régime de santé étranger est un régime de SANTÉ
    // (décision Marc). « 02 ne la revendique pas » ne se conditionne pas à sept règles amont — un
    // « Appel de cotisation_RegimeX » tombait sinon dans la branche fiscale et restait en Finances,
    // pendant qu'un « Bordereau de cotisations_RegimeX » sortait vers 07 : deux destins pour la même
    // caisse, à un pluriel près (revue finale PR4).
    if (resetContient_(tout, CONFIG.PARCOURS.reset.santeEtrangere)) return null;
    // FEUILLETS FISCAUX québécois AVANT « Relevés » : le RL-1 (revenus d'emploi) et le RL-31
    // (logement) sont des documents d'IMPÔT, pas des relevés bancaires — sans cette ligne,
    // `t = 'releve 1'` partait dans `Relevés/AAAA` (correction du commentaire de revue : je l'avais
    // affirmé couvert par la règle fiscale, à tort — elle est APRÈS). Motif ANCRÉ sur le nombre pour
    // ne jamais toucher « Relevé 10 » ou un relevé bancaire ordinaire. « Relevé d'emploi » n'est PAS
    // inclus : c'est un document de CARRIÈRE (05), à trancher avec Marc s'il s'en présente.
    if (estFeuilletFiscalReset_(t)) return cheminImpotsReset_(seg);
    // PAIE — motif ANCRÉ SUR LE MOT, jamais une sous-chaîne : « paie » est contenu dans
    // « paiement », et un « Relevé de paiement » (Hydro-Québec, Retraite Québec, assureurs) n'est
    // PAS un bulletin de salaire. Ma 1ʳᵉ version testait `t === 'paie'` (exact, correct) MAIS aussi
    // `resetContient_(t, [… 'releve de paie'])` — qui rouvrait le piège en grand puisque
    // « releve de paiement » COMMENCE par « releve de paie » (attrapé en revue #228).
    // Même idiome que `Router.schemaNommage_`/`devinerTypeDepuisNom_`, et c'est précisément le motif
    // qui produit le libellé `_Paie_` au renommage : une seule règle de mot aux deux bouts de la
    // chaîne. Couvre paie / bulletin de paie / fiche de paie / feuille de paie / relevé de paie /
    // bulletin de salaire / sommaire de paie… et exclut « paiement » par construction.
    // PAR EMPLOYEUR depuis C28-49 PR2 (décision Marc « un sous-dossier par employeur ») : MÊME
    // canon que mission-paies (`employeurDuNom_`, Missions.gs — une seule règle, deux
    // consommateurs). Émetteur hors table → racine (comme avant), jamais deviné.
    if (estTypePaieReset_(t)) {
      var employeurPaie = employeurDuNom_(e) ||
        (employeurAutreDuNom_(nom) ? CONFIG.MISSIONS_EMPLOYEURS_COMMUN : '');
      return employeurPaie ? 'Revenus & paie/' + employeurPaie : 'Revenus & paie';
    }
    // (ADR-0044 D9) Un « Relevé_<employeur> » SANS numéro est une PAIE mensuelle — MÊME règle que
    // la mission carrière, sinon la consolidation recalculerait « Relevés/AAAA » et enverrait la
    // paie chez les relevés BANCAIRES (revue structure C28-62 PR2 : divergence prouvée).
    // La garantie de sûreté est l'EMPLOYEUR connu, jamais le type seul.
    if (estReleveDePaie_(t)) {
      var empReleve = employeurDuNom_(e) ||
        (employeurAutreDuNom_(nom) ? CONFIG.MISSIONS_EMPLOYEURS_COMMUN : '');
      if (empReleve) return 'Revenus & paie/' + empReleve;
    }
    // ===== (ADR-0044 §7) Règles nées du reliquat RÉEL des dossiers-années — décisions de Marc.
    // Budgets & tableaux de bord → « Relevés » par année (choix de Marc : ils restent en Finances).
    if (resetContient_(t, ['tableau de bord budgetaire', 'tableau de suivi budgetaire',
      'suivi budgetaire', 'budget previsionnel', 'suivi de depenses', 'plan financier']) || t === 'budget') {
      return 'Budgets & suivi';
    }
    // Achats en ligne (captures) → une preuve d'achat reste une pièce de dépense.
    if (resetContient_(t, ['suivi de livraison', 'fiche produit', 'bon de commande'])) {
      return 'Reçus & factures/' + resetBucketAnnee_(seg.annee, s['Reçus & factures']);
    }
    // Feuillet fiscal canadien de revenus étrangers — ni « impot » ni « t4 » dans son nom.
    // Reste ICI (avant « relevé ») : c'est un FEUILLET fiscal, jamais un relevé de compte.
    if (resetMotEntierUn_(tout, CONFIG.PARCOURS.reset.feuilletsFiscaux)) return cheminImpotsReset_(seg);
    // ⚠️ « relevé d'IMPÔT » est FISCAL, pas bancaire : sans cette exclusion, il partait en
    // « Relevés » ici alors que la mission le range en « Impôts » — divergence PRÉ-EXISTANTE
    // trouvée par la revue PR4, que la consolidation aurait défaite à chaque passage.
    if (t.indexOf('releve') !== -1 && !estRibReset_(t) && !estTypeFiscalReset_(t)) {
      var bRel = resetBucketAnnee_(seg.annee, s['Relevés']);
      return bRel ? 'Relevés/' + bRel : 'Relevés';
    }
    // Fiscal (dont les feuillets québécois T4/Relevé 1) et remboursements d'IMPÔT (revue : 'bourse'
    // ⊂ « remboursement » envoyait les remboursements en Placements — jamais de motif court sur tout).
    if (estTypeFiscalReset_(t) ||
        (t.indexOf('remboursement') !== -1 && e.indexOf('revenu') !== -1)) return cheminImpotsReset_(seg);
    // Donations/successions → versant FISCAL (le versant notarial est couvert par `01 · État civil
    // & notarial`, où les actes partent déjà). Le nœud dédié a cédé sa place à « Revenus & paie ».
    if (resetContient_(tout, ['donation', 'succession'])) return cheminImpotsReset_(seg);
    // Assurance AVANT le rattrapage bancaire (revue : « Bellerives Assurance » partait en Banques).
    if (resetContient_(tout, ['assurance vie', 'prevoyance']) || e.indexOf('assurance') !== -1 ||
        t.indexOf('assurance') !== -1) return 'Assurances & prévoyance'; // le TYPE compte autant que l'émetteur (revue PR4 : « Assurance_Bellerives » partait en Banques)
    if (resetContient_(tout, ['tether', 'usdt', 'crypto', 'securities', 'boursier', 'bourse de', 'portefeuille'])) return 'Placements & crypto';
    var banqueDe = function () {
      var bs = CONFIG.PARCOURS.finance.banques;
      for (var ib = 0; ib < bs.length; ib++) {
        if (resetContient_(e, bs[ib].jetons)) return 'Banques/' + bs[ib].dossier;
      }
      if (resetContient_(e, CONFIG.PARCOURS.finance.banquesFrance)) return 'Banques/Autres';
      return '';
    };
    // 'rib' n'est plus une sous-chaîne (revue : ⊂ « contribution »/« distribution ») : type exact.
    if (t === 'rib' || resetContient_(tout, ['coordonnees bancaires', 'releve d identite bancaire', 'chequier']) || t.indexOf('cheque') !== -1) {
      return banqueDe() || 'Banques/Autres';
    }
    if (resetContient_(t, ['recu', 'facture', 'remboursement'])) {
      var bFact = resetBucketAnnee_(seg.annee, s['Reçus & factures']);
      if (s['Reçus & factures'][bFact] && s['Reçus & factures'][bFact]['Abonnements SaaS & API'] &&
          resetContient_(tout, ['saas', 'openai', 'anthropic', 'cursor', 'cloudflare', 'vercel', 'github', 'google one', 'google workspace', 'google cloud', 'adobe', 'spotify', 'notion', 'linear'])) {
        return 'Reçus & factures/' + bFact + '/Abonnements SaaS & API';
      }
      return 'Reçus & factures/' + bFact;
    }
    // Banque — placé ICI (après fiscal, assurance et reçus), jamais plus haut : testé trop tôt et
    // sur le NOM COMPLET, « Reçu_Débit préautorisé Hydro-Québec » partait en Banques au lieu des
    // reçus, le MODE DE PAIEMENT cité dans l'émetteur décidant du classement (revue PR4).
    // Testés sur le NOM COMPLET : la POSITION suffit à empêcher le vol (mesuré en revue), et
    // restreindre au seul TYPE faisait perdre tous les noms HORS CONVENTION — « Confirmation de
    // virement CMF.pdf », « Spécimen de signature CMF.pdf » — qui sont précisément la matière du
    // reset et de la consolidation.
    if (resetContient_(tout, ['confirmation de virement', 'specimen de signature',
      'bordereau de numerisation', 'simulation de pret', 'debit preautorise',
      'retrait bancaire preautorise'])) return banqueDe() || 'Banques/Autres';
    // Courtage & courtier — placés ICI, tout en bas : « courtage » est un mot de MÉTIER partagé
    // (assurance, immobilier), et une FACTURE d'un courtier reste une pièce de dépense. Testés
    // après assurance ET après reçus, ils ne volent plus personne (revue PR4).
    // Un courtier (`PARCOURS.reset.courtiers`) est une MARQUE, ancrée en MOT ENTIER (court : « NCourtierxBank » contiendrait « courtierx »).
    if (t.indexOf('courtage') !== -1 || resetMotEntierUn_(tout, CONFIG.PARCOURS.reset.courtiers)) return 'Placements & crypto';
    return banqueDe() || null;
  }

  if (domaine === '03 · Logement & véhicule') {
    // GESTE SYMÉTRIQUE C28-51 (ADR-0040 §3c) : cibles SINGULIER aux noms RÉELS ; le canon des
    // véhicules (`vehiculeDuNom_`) et des bailleurs (`logementDuBailleur_`, table PROUVÉE par
    // contenu) est PARTAGÉ avec les missions — une seule règle, deux consommateurs (C28-26).
    // LOGEMENT — par ADRESSE dans le texte, en MOT ENTIER (revue structure-keeper C28-51 :
    // « lisiere » en sous-chaîne matchait « Lisierex » — la collision MÊME de la leçon C28-49,
    // sur un verdict de FLUX donc définitif)…
    // Frontières NON-ALPHANUMÉRIQUES (pas un padding d'espaces : `normaliserCle_` garde points
    // et tirets — « lisiere.pdf » doit matcher, « lisierex » jamais). Mots alphanumériques only.
    var motEntier = function (mot) { return resetMotEntier_(tout, mot); }; // jumeau migré (revue PR4)
    var estAssurHab = !vehiculeDuNom_(tout) && t.indexOf('assurance auto') === -1 &&
      !resetContient_(tout, ['vehicule', 'automobile']) &&
      (tout.indexOf('assurance') !== -1 || t.indexOf('police d assurance') !== -1 ||
       t.indexOf('police habitation') !== -1 || resetContient_(e, CONFIG.PARCOURS.finance.assureurContrats.jetons));
    var logements = CONFIG.PARCOURS.logements;
    for (var li = 0; li < logements.length; li++) {
      var lg = logements[li];
      if (lg.mots.some(motEntier) || lg.motifs.some(function (m) { return tout.indexOf(m) !== -1; })) {
        return estAssurHab ? 'Logement/' + lg.noeud + '/Assurance habitation' : 'Logement/' + lg.noeud;
      }
    }
    if (CONFIG.PARCOURS.anciensLogementsMots.some(motEntier)) return 'Logement/Anciens logements'; // stock réel (revue)
    // …sinon par BAILLEUR (les bails sont nommés par bailleur, jamais par adresse — ADR-0040 §2).
    var logementBailleur = logementDuBailleur_(tout);
    if (logementBailleur) {
      return (estAssurHab && logementBailleur !== 'Anciens logements')
        ? 'Logement/' + logementBailleur + '/Assurance habitation' : 'Logement/' + logementBailleur;
    }
    // VÉHICULE — canon partagé ('marquec' n'est pas un jeton : un modèle jamais acheté matcherait
    // le bZ), puis la CATÉGORIE de Marc par le type (à plat dans le véhicule si aucune).
    // LOCATION de véhicule (ADR-0044) — AVANT le canon des véhicules, pour la même raison que
    // dans les missions : une voiture louée n'est pas un véhicule de Marc. MÊME prédicat pur, pour
    // que le reset et les missions ne se renvoient pas la balle (leçon « une seule règle »).
    // Dossier COMMUN reconnu par le NOM (ADR-0044 : « Marqued compris ») — MÊME table que les
    // missions. Sans lui, un document « Marqued » arrivant par le FLUX tombait à PLAT à la racine de
    // `03`, c'est-à-dire dans le vrac que `HistoriqueVrac` compte comme dette (revue C28-62).
    // Le nom BRUT est passé aux prédicats partagés (comme les missions) : `tout` est déjà passé
    // par `normaliserCle_`, et faire dépendre un prédicat partagé d'une SECONDE normalisation en
    // amont est un couplage fragile — les deux fonctions peuvent évoluer séparément.
    var communNom = communVehiculeDuNom_(nom);
    if (communNom) return communNom === 'Recherche & achat' ? 'Véhicule/Recherche & achat' : 'Véhicule/Autres';
    var vehicule = vehiculeDuNom_(tout);
    // AMBIGU : « location » + un véhicule DU CANON, c'est peut-être un BAIL/une LOA sur le
    // véhicule de Marc, pas la location d'une voiture tierce. Refus (révisable) plutôt qu'un
    // déplacement définitif au mauvais endroit — MÊME arbitrage que la mission (une seule règle).
    if (estLocationVehicule_(nom)) return vehicule ? null : 'Véhicule/Autres';
    // Magasinage qui n'a PAS abouti (décision Marc 2026-08-20, sur le contrat « Garage Exemple ») :
    // un contrat de VENTE dont aucun véhicule du canon n'est nommé n'appartient à aucun véhicule
    // de Marc — il va au COMMUN, jamais deviné par la date. Conditionné à `!vehicule` : dès qu'un
    // véhicule est reconnu, la règle par véhicule ci-dessous garde la priorité.
    if (!vehicule && resetContient_(tout, ['vente vehicule', 'vente de vehicule',
      'vehicule d occasion', 'voiture d occasion'])) return 'Véhicule/Recherche & achat';
    if (vehicule) {
      var cfgVehicule = null;
      var vehs = CONFIG.MISSIONS_VEHICULES || [];
      for (var vi = 0; vi < vehs.length; vi++) {
        if (vehs[vi].nom === vehicule) { cfgVehicule = vehs[vi]; break; }
      }
      if (cfgVehicule && cfgVehicule.sousDossiers) {
        if (t.indexOf('assurance') !== -1 || t.indexOf('sinistre') !== -1 || t.indexOf('reclamation') !== -1 ||
            resetContient_(e, ['assurance', 'insurance'].concat(CONFIG.PARCOURS.finance.assureursAuto))) {
          return 'Véhicule/' + vehicule + '/' + cfgVehicule.sousDossiers.assuranceSinistres;
        }
        return 'Véhicule/' + vehicule + '/' + cfgVehicule.sousDossiers.achatEntretien;
      }
      return 'Véhicule/' + vehicule;
    }
    if (resetContient_(t, ['immatriculation', 'carte grise', 'constat d infraction', 'contravention', 'amende']) ||
        e.indexOf('saaq') !== -1) return marquerFaibleReset_(detail, 'Véhicule/Autres');
    return null;
  }

  // 04 : routage INTERNE seulement (ADR-0030 §4) — jamais appliqué à un fichier hors de 04, et
  // jamais de sortie : un fichier de 04 non routé reste À SA PLACE (pas dans _TRI).
  if (domaine === '04 · Immigration') {
    if (resetContient_(tout, ['mifi', 'francisation', 'caq', 'certificat d acceptation', 'diversite et de l inclusion'])) return 'MIFI (Québec)';
    if (resetContient_(tout, ['permis de travail', 'eimt', 'ptet'])) return 'Permis de travail & EIMT';
    if (resetContient_(tout, ['residence permanente', 'resident permanent'])) {
      if (resetContient_(tout, ['emploi', 'boulot', 'attestation d emploi', 'employeur', 'paie'])) return 'Résidence permanente/Boulot';
      if (resetContient_(tout, ['etude', 'diplome', 'scolarite', 'releve de notes'])) return 'Résidence permanente/Études & Diplômes';
      if (resetContient_(tout, ['formulaire', 'fiscal', 'impot', 't4', 'releve 1', 'preuve']) ||
          /(^|[^a-z0-9])imm[ -]?\d{4}/.test(tout)) {
        return 'Résidence permanente/Formulaires, fiscalité & preuves RP';
      }
      return 'Résidence permanente';
    }
    if (estDocumentIdentiteReset_(t)) return 'Résidence permanente/Identité';
    if (resetContient_(tout, ['ircc', 'citoyennete', 'citizenship', 'immigration'])) return 'IRCC (fédéral)';
    if (resetContient_(t, ['formulaire', 'lettre', 'correspondance'])) return 'Autres';
    return null;
  }

  if (domaine === '05 · Carrière') {
    if (estTypeRecrutement_(t, nom) || tout.indexOf('suivi recherche') !== -1 ||
        tout.indexOf('archive candidatures') !== -1) return 'Recherche d\'emploi';
    if (t === 'cv' || tout.indexOf('cv') === 0 || resetContient_(tout, ['curriculum'])) return 'CV & lettres/CV & modèles';
    if (resetContient_(tout, ['lettre de motivation']) || t.indexOf('candidature') !== -1 || e === 'ute' ||
        resetContient_(e, ['arkema', 'eaton', 'siemens', 'schneider', 'wiio', 'bluewrist', 'pierre fabre', 'lactalis', 'gravelines', 'cnpe'])) {
      return 'CV & lettres/Lettres de motivation (Archives)';
    }
    var principaux = CONFIG.PARCOURS.employeursNoeuds;
    for (var pi = 0; pi < principaux.length; pi++) {
      if (e.indexOf(principaux[pi].marqueur) !== -1) return 'Employeurs/' + principaux[pi].nom; // plat (ADR-0080)
    }
    // (ADR-0044 §7) Les statuts CONSTITUTIFS de la SCI : le nom de l'entité varie (« PRIGRIS »,
    // « SCI famille Exemple », « MRic »), le TYPE ne varie pas. Décision Marc : les 4 sont la même
    // société. Testé sur le type, donc AVANT la règle par émetteur, qui n'en attrape que la moitié.
    if (resetContient_(t, ['statuts de societe civile', 'statuts de constitution', 'statuts constitutifs'])) {
      return 'Entreprise — MRic (SCI)';
    }
    if (resetMotEntier_(e, 'mric') || /(^|[^a-z0-9])m[ .]ric([^a-z0-9]|$)/.test(e)) return 'Entreprise — MRic (SCI)'; // ancré (revue PR4 : « m ric » ⊂ « wilhelm ricard »)
    return null;
  }

  if (domaine === '06 · Études & diplômes') {
    // FAIBLE (arbitrage C28-90, après mesure) : ce nœud centralise les diplômes, et il le fait très
    // bien depuis la RACINE du domaine — c'est là que sont les 683. Mais il est décidé par le seul
    // TYPE, et le laisser fort lui donnait le pouvoir de VIDER les dossiers d'école de Marc, que la
    // mission remplit dans le même tick (mesuré : `…/CORVIA — …/Administratif` vers `Diplômes & relevés
    // officiels`). Une campagne ne défait pas ce qu'une autre construit dans le même tick.
    // ⚠️ Ce nœud reste à la RACINE de `06`, jamais sous `Archives scolaires` (ADR-0055) : un
    // diplôme se range par TYPE, pas par établissement — c'est ce qui lui permet de rassembler.
    if (resetContient_(t, ['diplome', 'releve de notes', 'bulletin', 'attestation de reussite'])) {
      return marquerFaibleReset_(detail, 'Diplômes & relevés officiels');
    }
    // ORDRE (ADR-0052 D6) : le NOM est un FAIT, la fenêtre une DÉDUCTION — et une déduction ne
    // contredit jamais un fait. Le VETO québécois s'intercale entre les deux : quand le nom crie
    // « cégep » sans nommer l'établissement, aucune fenêtre n'a le droit de trancher.
    var ecole = ecoleParNomReset_(nom);
    // Le drapeau FAIBLE est posé ICI, par la ligne qui DÉDUIT — pas plus haut (la branche
    // `Diplômes & relevés officiels` rend avant tout calcul d'école : elle ne le portera jamais),
    // pas plus bas (les quatre sous-dossiers de fin l'héritent tous, quel que soit le type).
    if (!ecole && !vetoCollegialReset_(nom)) {
      ecole = ecoleParDateReset_(nom);
      if (ecole) ecole = marquerFaibleReset_(detail, ecole);
    }
    if (!ecole) return null;
    if (ecole === 'Autres' || ecole === 'Autres établissements') return 'Autres';
    if (ecole === 'Formations en ligne — Google AI Essentials') return 'Formations en ligne — Google AI Essentials';
    // (ADR-0055) TOUTE école vit sous `Archives scolaires` — le préfixe est posé ICI, en UN seul
    // endroit, après le seul `return` qui ne désigne pas une école (`Autres établissements` est un
    // nœud de taxonomie du domaine, pas un établissement de Marc). Un préfixe recopié sur chacun
    // des six `return` ci-dessous se serait désolidarisé au premier ajout de règle.
    var base = RACINE_ARCHIVES_ECOLE_RESET + '/' + ecole;
    // (ADR-0060, revue code) Un nœud déclaré SANS enfant (`{}`) reste À PLAT : c'est la structure
    // de Marc telle qu'il la tient (`CEGEP - Valdor (2020)`, `Online course`), qu'ADR-0055 dit
    // immuable à toute profondeur. Sans ce retour, la cascade ci-dessous fabriquait un
    // `/Cours & travaux` que sa table ne déclare pas — premier nœud `{}` qu'une règle par nom atteint.
    var structure = structureCibleReset_();
    var noeud = structure[domaine] && structure[domaine][RACINE_ARCHIVES_ECOLE_RESET];
    if (noeud && noeud[ecole] && Object.keys(noeud[ecole]).length === 0) return base;
    if (t.indexOf('concours') !== -1 && ecole === libelleEcoleReset_('prepa')) return base + '/Concours';
    if (resetContient_(t, ['examen', 'devoir surveille', 'controle', 'partiel', 'kholle', 'colles']) || t === 'ds') return base + '/Examens & khôlles';
    // ⚠️ ADMINISTRATIF AVANT COURS & TRAVAUX (revue sécurité C28-90) : le vocabulaire des cours
    // contient « fiche » et « cours » en SOUS-CHAÎNE, et il est passé devant `Résultats` dans ce
    // même lot — « Fiche d'inscription_CORVIA » et « Attestation de suivi de cours » quittaient
    // donc `<école>/Administratif` pour `<école>/Cours & travaux`. Une inscription, une convention
    // de stage ou une attestation sont des actes ADMINISTRATIFS, quel que soit le mot « cours »
    // qu'ils citent ; l'ordre est ce qui l'exprime. MESURÉ sur les 480 noms de 06 du corpus :
    // ZÉRO document bascule (aucun n'est à la fois administratif et « cours ») — le réordonnancement
    // ferme une classe démontrée sur des noms réalistes, il ne rejoue pas le corpus existant.
    if (resetContient_(t, ['certificat de scolarite', 'inscription', 'convention', 'attestation'])) return base + '/Administratif';
    // ⚠️ COURS & TRAVAUX AVANT RÉSULTATS. « note » est une sous-chaîne, et « Notes de cours » —
    // 68 fichiers du corpus — atterrissait dans `/Résultats`. Défaut PRÉ-EXISTANT, mais ce chantier
    // fait passer ~110 fichiers de plus dans cette cascade : le corriger ici coûte une ligne, le
    // laisser aurait coûté un dossier de résultats rempli de cours (revue flotte).
    // Vocabulaire ÉLARGI aux familles réellement majoritaires du corpus (mesuré le 13/09) :
    // 93 « exercice », 82 « TP / travail pratique / rapport de TP », 71 « devoir », 68 « cours ».
    // Sans « travail pratique » ni « exercice », les deux plus gros paquets restaient à la RACINE
    // de leur école — placés, mais pas rangés.
    if (resetContient_(t, ['cours', 'fiche', 'travaux', 'travail pratique', 'projet', 'memoire',
      'devoir', 'exercice', 'corrige', 'correction', 'enonce', 'schema', 'support de cours',
      'laboratoire', 'protocole']) || t === 'td' || t === 'tp' ||
        /(^| )tp\d*( |$)/.test(t) || /(^| )tps?( |$)/.test(t)) return base + '/Cours & travaux';
    if (resetContient_(t, ['resultat', 'note', 'evaluation'])) return base + '/Résultats';
    return base; // racine de l'école : mieux que _TRI, l'école est sûre
  }

  if (domaine === '07 · Santé') {
    if (resetContient_(t, ['consultation', 'ordonnance', 'compte rendu', 'resultat', 'analyse',
      'examen', 'radiographie', 'vaccin', 'vaccination']) ||
        resetContient_(tout, ['medecine scolaire', 'medecine du travail', 'aptitude', 'carnet de sante']) ||
        resetContient_(e, ['hopital', 'chu', 'cisss', 'clinique', 'centre hospitalier'].concat(CONFIG.PARCOURS.reset.hopitaux))) {
      return 'Dossier médical & vaccins';
    }
    // (ADR-0044 §7) Un régime de santé étranger est un régime d'ASSURANCE santé, mais
    // son nom ne contient pas « assurance » : motif multi-mots (aucune collision possible).
    if (resetContient_(tout, CONFIG.PARCOURS.reset.santeEtrangere)) return 'Assurances santé';
    if (resetContient_(tout, ['cnam', 'ramq', 'assurance'])) return 'Assurances santé';
    return null;
  }

  if (domaine === '08 · Perso & projets') {
    if (tout.indexOf('driveai') !== -1) return 'Projets/DriveAI';
    var projetPerso = CONFIG.PARCOURS.reset.projetPerso;
    if (resetContient_(tout, projetPerso.motifs)) return 'Projets/' + projetPerso.dossier;
    if (resetMotEntier_(tout, 'canon') || resetContient_(tout, ['.cr3', '.cr2']) ||
        (resetMotEntier_(tout, 'raw') && tout.indexOf('photo') !== -1)) {
      return 'Photographie & souvenirs/RAW Canon R50 (2024)';
    }
    if (resetContient_(tout, ['photo', 'souvenir', 'classe de neige'])) return 'Photographie & souvenirs/Photos souvenirs';
    if (resetMotEntier_(tout, 'sport') || resetContient_(tout, ['sortie', 'randonnee', 'concert', 'theatre', 'musee', 'festival', 'cinema', 'loisir', 'evenement'])) {
      return 'Sport & sorties';
    }
    if (resetContient_(tout, ['jeu video', 'jeux video', 'steam', 'nintendo', 'playstation', 'xbox']) ||
        t.indexOf('capture') !== -1) return 'Jeux vidéo & captures';
    if (resetContient_(t, ['schema', 'plan', 'diagramme', 'guide'])) return 'Schémas & technique';
    if (resetContient_(tout, ['export', 'donnees'])) return 'Données & exports';
    if (t.indexOf('projet') !== -1) return 'Projets/Autres';
    return null;
  }

  if (domaine === '09 · Voyages') {
    if (resetContient_(tout, ['assurance'].concat(CONFIG.PARCOURS.finance.assureursVoyage))) return 'Assurances voyage';
    if (resetContient_(tout, ['bresil', 'brazil', 'rio de janeiro', 'sao paulo'])) return 'Par voyage/Brésil';
    // ' chine' : jamais « machine » (revue). Mais normaliserCle_ garde les underscores : un émetteur
    // exact « _Chine.pdf » n'a PAS d'espace devant → l'égalité sur l'émetteur couvre ce cas.
    if (resetContient_(tout, [' chine', 'zhongguo']) || tout.indexOf('chine') === 0 || e === 'chine') return 'Par voyage/Chine';
    if (resetContient_(tout, ['finlande', 'finnair', 'finnlines', 'viking line', 'vr group', 'vr yhtyma', 'chemins de fer finlandais', 'helsinki']) || e === 'vr') return 'Par voyage/Finlande';
    var voyagesSupp = CONFIG.PARCOURS.reset.voyagesSupp;
    for (var iv = 0; iv < voyagesSupp.length; iv++) {
      if (s['Par voyage'][voyagesSupp[iv].dossier] && resetContient_(tout, voyagesSupp[iv].motifs)) {
        return 'Par voyage/' + voyagesSupp[iv].dossier;
      }
    }
    if (resetContient_(tout, ['perurail', 'perou', 'machu', 'cusco'])) return 'Par voyage/Pérou';
    if (tout.indexOf('visite famille') !== -1) return 'Par voyage/Québec — Visite famille (2025-2026)';
    if (resetContient_(t, ['confirmation de reservation', 'confirmation de vol', 'billet', 'carte d embarquement', 'carte d acces a bord', 'itineraire', 'reservation'])) {
      return 'Réservations & billets/' + resetBucketAnnee_(seg.annee, s['Réservations & billets']);
    }
    return null;
  }

  return null;
}

/* =================================================================================================
 * ADR-0052 — REPLI PAR TYPE : la racine d'un domaine n'est plus une cible de classement.
 * ================================================================================================= */

/**
 * Familles de TYPE communes à plusieurs domaines. Déclarées UNE fois : le même mot
 * (« attestation », « courriel ») se retrouvait sinon recopié domaine par domaine, et c'est
 * exactement la graine des divergences qu'ADR-0044 §7 a dû corriger ailleurs. PURE.
 *
 * ⚠️ Testées sur le segment TYPE normalisé par `normaliserCle_`, qui **conserve les traits
 * d'union** : « rendez-vous » s'écrit donc avec son trait d'union ici (vérifié — la variante
 * « rendez vous » n'apparie rien, et son absence a coûté 2 fichiers au premier jet du PoC).
 */
var BUCKET_TYPE_CORRESPONDANCE = ['courriel', 'courrier', 'lettre', 'correspondance', 'message',
  'echange', 'avis', 'notification', 'convocation', 'mise en demeure', 'reponse', 'demande',
  'relance', 'confirmation', 'rappel', 'constat', 'contravention', 'amende', 'note juridique'];
var BUCKET_TYPE_ATTESTATION = ['attestation', 'certificat', 'justificatif', 'extrait', 'registre',
  'kbis', 'carte de membre'];
var BUCKET_TYPE_FORMULAIRE = ['formulaire', 'guide', 'notice', 'mentions legales', 'annexe',
  'reglement', 'tableau informatif', 'modele', 'questionnaire', 'fiche de renseignements',
  'manuel', 'procedure', 'protocole'];

/**
 * REPLI PAR TYPE (ADR-0052 D2) — dernier échelon de dégradation AVANT la racine du domaine.
 *
 * Appelée par `sousCheminDomaine_` (Router.gs), donc par le flux vivant ET par la consolidation :
 * **une seule règle, deux consommateurs** (leçon §9). Elle s'exécute quand tout ce qui précède a
 * échoué — table `cheminCibleReset_`, repli d'identité, entité VALIDÉE, année — c'est-à-dire quand
 * on ne sait pas À QUI ni À QUOI le document se rattache, mais qu'on sait encore CE QUE C'EST.
 *
 * ⚠️ Volontairement **hors** de `cheminCibleReset_`, bien que ce soit le point le plus naturel :
 * cette fonction-là sert aussi de garde par CAPACITÉ aux missions (« le flux fait autorité DANS 02 :
 * ce qu'il sait placer y reste », Missions.gs). Lui apprendre à tout placer rendrait la garde
 * toujours vraie et tuerait les SORTIES inter-domaines des missions, en silence. On élargit ici la
 * capacité de CLASSEMENT, jamais celle de REVENDICATION.
 *
 * CONTRAT : le chemin rendu EXISTE dans `STRUCTURE_CIBLE_RESET[domaine]` (verrouillé par test — la
 * fonction ne peut pas inventer de dossier), ou `''` quand le type lui-même n'apprend rien. Elle ne
 * change JAMAIS de domaine : elle ne peut donc pas faire sortir un fichier de `04` (§1.1b). PURE.
 *
 * @param {string} domaine  domaine DÉJÀ décidé (le repli ne le remet jamais en cause)
 * @param {string} nom      nom FINAL du document (`AAAA-MM-JJ_Type_Émetteur.ext`)
 * @return {string} chemin relatif au domaine, ou '' si le type n'apprend rien
 */
function bucketTypeDomaine_(domaine, nom) {
  var s = structureCibleReset_()[domaine];
  if (!s) return '';
  var seg = analyserNomClasse_(nom);
  // ⚠️ `normaliserCle_` CONSERVE les traits d'union (« lisiere.pdf » doit matcher, « lisierex »
  // jamais). Pour un repli qui compare des LOCUTIONS, c'est un piège à double sens : « rendez-vous »
  // et « rendez vous », « compte-rendu » et « compte rendu » sont deux graphies également
  // courantes, et un motif écrit dans l'une ne voit jamais l'autre. Un seul motif par locution
  // suffit donc à condition de NEUTRALISER le trait d'union ICI, au seul point de comparaison —
  // plutôt que de doubler chaque entrée de chaque liste, ce qui se périmerait au premier ajout.
  // Ne concerne QUE cette fonction : `cheminCibleReset_` garde la clé brute, ses motifs sont ancrés.
  var sansTiret = function (v) { return normaliserCle_(v || '').replace(/-/g, ' '); };
  var t = sansTiret(seg.type);
  var tout = sansTiret(nom);
  // ARTEFACTS D'AGENT déposés dans `08` (« Journal de tri (agent) », « Rapport de passe »,
  // « Rapport global cumulatif », « Registre documents » — 22 au recensement du 13/09). Ils sont
  // hors convention de nommage : `analyserNomClasse_` ne leur trouve NI date NI type, donc ils
  // passeraient la garde `!t` ci-dessous et resteraient à plat. Reconnus sur le NOM COMPLET, le
  // seul cas de cette fonction — c'est assumé : ce sont des PRODUCTIONS de machine, un ensemble
  // clos dont les libellés ne varient pas (par opposition à un document reçu, dont le vocabulaire
  // évolue et pour lequel une liste de noms se périmerait).
  if (domaine === '08 · Perso & projets' &&
      /^(Journal de tri|Rapport de passe|Rapport global cumulatif|Registre documents)\b/.test(String(nom || '').trim())) {
    return 'Données & exports';
  }

  // 04 · Immigration : CATCH-ALL assumé (voir la branche plus bas) — évalué AVANT la garde `!t`,
  // parce que dans un domaine d'où rien ne sort jamais, un nœud général vaut mieux que la racine,
  // y compris pour un nom hors convention.
  if (domaine === '04 · Immigration') {
    return estDocumentIdentiteReset_(t) ? 'Résidence permanente/Identité' : 'Autres';
  }

  if (!t) return ''; // sans segment TYPE lisible, le nom n'apprend rien — jamais deviné
  var annee = function (noeud) { return resetBucketAnnee_(seg.annee, s[noeud]); };

  if (domaine === '01 · Administratif & identité') {
    if (resetContient_(t, ['etat civil', 'naissance', 'mariage', 'filiation', 'livret de famille',
      'notari'])) return 'État civil & notarial';
    if (resetContient_(t, BUCKET_TYPE_ATTESTATION) || resetContient_(t, BUCKET_TYPE_FORMULAIRE) ||
        resetContient_(t, ['contrat', 'avenant'])) return 'Attestations & contrats';
    if (resetContient_(t, BUCKET_TYPE_CORRESPONDANCE)) return 'Correspondance';
    return '';
  }

  /* 02 · Finances n'a PAS de branche ici, et c'est une décision, pas un oubli. Une première version
   * en posait une « pour l'avenir » ; elle était MORTE par construction, et un filet qui ne peut pas
   * se déclencher est pire que pas de filet — il fait croire que le domaine est couvert (trouvé en
   * revue). Deux raisons cumulées : `sousCheminDomaine_` route 02 par l'ANNÉE avant d'arriver ici
   * (`CONFIG.DOMAINES_PAR_ANNEE === ['02 · Finances']`), et quand l'année manque, le TYPE manque
   * aussi — `analyserNomClasse_` n'extrait un type que d'un nom qui COMMENCE par `AAAA`, donc la
   * garde `!t` coupe avant. Faire primer le TYPE sur l'ANNÉE en 02 serait un changement de politique
   * de classement : son propre ADR (§11.1). Constat cohérent : 02 est le seul domaine à n'avoir
   * AUCUN fichier à plat au recensement du 13/09. */

  if (domaine === '03 · Logement & véhicule') {
    if (t.indexOf('assurance') !== -1 &&
        (resetContient_(tout, ['automobile', 'vehicule', 'voiture', 'vignette', 'saaq']) ||
         resetMotEntier_(tout, 'auto'))) {
      return 'Véhicule/Autres';
    }
    return '';
  }

  /* 04 · Immigration est traitée PLUS HAUT (avant la garde `!t`). RÉORGANISATION INTERNE (§1.1b) :
   * pièce d'identité → `Pièces d'identité`, tout le reste → `Formulaires & correspondance`. Les deux
   * cibles sont des nœuds DE 04 : aucune sortie n'est représentable ici, pas même par erreur.
   * Le catch-all est une DÉCISION, pas une facilité : 04 est le domaine d'où rien ne sort jamais
   * automatiquement, donc y laisser un fichier à la racine n'a aucune contrepartie de prudence —
   * contrairement à 06, où entasser sous un mauvais libellé aurait un coût réel. */

  if (domaine === '05 · Carrière') {
    if (t === 'cv' || resetContient_(t, ['curriculum'])) return 'CV & lettres/CV & modèles';
    if (resetContient_(t, ['lettre de motivation', 'candidature'])) return 'CV & lettres/Lettres de motivation (Archives)';
    return '';
  }

  // 06 : domaine PLEIN (7 nœuds), et les 475 travaux scolaires du recensement n'ont PAS d'école
  // identifiable — ni dans le nom (0/475), ni dans le contenu (deux documents lus). Leur accueil
  // demande un nœud de plus, donc un arbitrage de Marc (ADR-0052 D6, options A/B). Tant qu'il n'a
  // pas tranché, le repli REFUSE plutôt que de les entasser dans « Autres », qui
  // veut dire « un autre établissement », pas « établissement inconnu ».
  if (domaine === '06 · Études & diplômes') return '';

  if (domaine === '07 · Santé') {
    // « rendez vous » et « compte rendu » s'écrivent SANS trait d'union ici : la clé de comparaison
    // les a déjà neutralisés (voir `sansTiret` en tête), donc UN motif couvre les deux graphies.
    if (resetContient_(t, ['consultation', 'ordonnance', 'rendez vous', 'compte rendu', 'carnet',
      'vaccination', 'prescription', 'suivi medical', 'resultat', 'analyse', 'examen',
      'radiographie', 'bilan', 'depistage']) ||
        resetContient_(tout, ['scolaire', 'du travail', 'aptitude', 'covid', 'sensibilisation'])) {
      return 'Dossier médical & vaccins';
    }
    if (t.indexOf('assurance') !== -1 || t.indexOf('mutuelle') !== -1 || t.indexOf('cotisation') !== -1) {
      return 'Assurances santé';
    }
    if (resetContient_(t, BUCKET_TYPE_CORRESPONDANCE) || resetContient_(t, BUCKET_TYPE_FORMULAIRE) ||
        resetContient_(t, ['etiquette', 'document informatif', 'fiche produit'])) {
      return 'Autres';
    }
    return '';
  }

  if (domaine === '08 · Perso & projets') {
    if (t.indexOf('capture') !== -1 || resetMotEntier_(t, 'jeu')) return 'Jeux vidéo & captures';
    if (resetContient_(t, ['schema', 'plan de', 'diagramme', 'carte mentale', 'catalogue technique',
      'patron', 'croquis', 'fiche produit', 'fiche technique', 'fiche d installation',
      'fiche de dimensions', 'document technique', 'code source', 'liste d inventaire',
      'infographie', 'dessin', 'maquette'])) return 'Schémas & technique';
    // Les artefacts d'agent déposés dans 08 (« Journal de tri (agent) », « Rapport de passe »,
    // « Rapport global cumulatif », « Registre documents » — 22 au recensement) n'ont PAS de
    // segment TYPE : ils sont reconnus sur le NOM COMPLET, seul cas de ce bloc.
    if (resetContient_(t, ['tableur', 'feuille de calcul', 'export', 'registre', 'rapport',
      'donnees', 'base de donnees', 'classeur', 'simulation', 'budget', 'fichier',
      'statistique', 'releve'])) return 'Données & exports';
    if (resetContient_(t, ['photo', 'souvenir'])) return 'Photographie & souvenirs/Photos souvenirs';
    if (resetMotEntier_(t, 'sport') || resetContient_(t, ['sortie', 'loisir', 'evenement', 'tournoi',
      'menu', 'recette', 'billet', 'ticket', 'reservation'])) return 'Sport & sorties';
    return '';
  }

  if (domaine === '09 · Voyages') {
    if (resetContient_(t, ['billet', 'e-ticket', 'e tickets', 'reservation', 'itineraire',
      'carte d embarquement', 'recu', 'facture', 'confirmation', 'capture etat du vol', 'bagage'])
        || resetMotEntier_(t, 'vol')) return 'Réservations & billets/' + annee('Réservations & billets');
    if (t.indexOf('assurance') !== -1) return 'Assurances voyage';
    return '';
  }

  return '';
}

/**
 * Vrai si le TYPE désigne une PIÈCE D'IDENTITÉ. MÊME vocabulaire que la branche `01` de
 * `cheminCibleReset_` — extrait ici pour que `04` (ADR-0052 D3) le consomme au lieu de le recopier :
 * une seconde liste divergerait au premier ajout (leçon §9, « une seule règle, deux consommateurs »).
 * PURE.
 * @param {string} t  segment TYPE normalisé @return {boolean}
 */
function estDocumentIdentiteReset_(t) {
  return resetContient_(t, ['passeport', 'carte nationale d identite', 'carte d identite',
    'permis de conduire', 'carte d assurance maladie', 'carte vitale', 'carte de resident',
    'numero d assurance sociale']);
}

/* =================================================================================================
 * PR2 — CAMPAGNES I/O (C28-33, ADR-0030 §Exécution + §Transition) : rassemblement récursif vers
 * `_TRI 2026/<domaine>`, dédup par empreinte (+ rapport quasi-doublons), placement par
 * `cheminCibleReset_`, réorganisation INTERNE de 04 (CLAUDE.md §2.1b révisé, PR2). Exécution DIRECTE
 * (décision Marc « change tout live », comme ConsolidationExec) : déplacement seul (§2, jamais de
 * suppression), §1 re-vérifiée par mutation, multi-parents jamais déplacés. Patron « campagne bornée
 * reprenable » partout : collecte lecture seule → mutation par lots, garde-temps, plafond/run, budget
 * QUOTIDIEN en ms réelles persistées, tag de convergence (« passe qui ne collecte plus rien »).
 * ================================================================================================= */

/**
 * Le budget QUOTIDIEN d'une phase (`RESET_*_BUDGET_JOUR_MS`) protège le quota RUNTIME des
 * DÉCLENCHEURS (~90 min/j, compte gratuit) — il ne concerne QUE le tick. Une exécution UN-CLIC
 * depuis l'éditeur Apps Script est HORS de ce quota (c'est sa raison d'être, ADR-0030 §Exécution) :
 * lui appliquer le même budget causait DEUX effets pervers (constatés au 1ᵉʳ run réel de Marc,
 * 2026-07-29) — (1) après quelques relances manuelles, Marc était BLOQUÉ jusqu'au lendemain sans
 * qu'aucun quota réel ne soit en cause ; (2) pire, son run manuel CONSOMMAIT le budget du tick, donc
 * l'automatique ne faisait plus rien de la journée : le manuel affamait l'auto. D'où le drapeau
 * `manuel` porté par les 3 phases : ni gaté, ni compté — seul le mur des 6 min de l'exécution
 * manuelle elle-même la borne (garde passé par l'appelant). Le tick, lui, est inchangé.
 */

/** Consommation du budget QUOTIDIEN d'une phase du reset (ms réelles persistées `AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourReset_(props, cle, aujourdhui) {
  var brut = String(props.getProperty(cle) || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/** Domaines soumis au rassemblement/placement : tous SAUF 04 (ADR-0030 §4 — jamais rassemblée). PUR. */
function domainesRassemblesReset_() {
  return Object.keys(CONFIG.DOMAINES).concat(CONFIG.DOMAINES_AUTO || [])
    .filter(function (d) { return d !== '04 · Immigration'; });
}

/**
 * Valeur du drapeau de fin du PLACEMENT. Elle porte la VERSION DE TABLE, contrairement aux deux
 * autres phases (revue #227 — BLOQUANT) : le drapeau de phase EST une clé d'idempotence, en gros.
 * Sans la version, il est testé AVANT que les clés par fichier ne soient construites — une fois le
 * placement convergé, bumper `RESET_TABLE_VERSION` ne re-présenterait plus RIEN, en silence, et le
 * seul contournement (bumper `RESET_TAG`) serait DESTRUCTEUR (les clés du rassemblement n'ont pas de
 * version : tout le Drive repartirait dans `_TRI` pour un cycle complet).
 *
 * DISSYMÉTRIE VOULUE : les drapeaux du RASSEMBLEMENT et de 04 ne prennent PAS la version — leurs
 * clés PAR FICHIER n'en portent pas non plus, et l'y ajouter relancerait un rassemblement complet.
 * Seul le placement dépend de la table de routage, donc seul son drapeau la suit.
 *
 * EFFET DE BORD ASSUMÉ d'un bump : `resetTermine_()` repasse à faux ⇒ conso-2, réorg auto,
 * historique Gmail et réconciliation Index sont RE-SUSPENDUS le temps de la re-convergence
 * (« une seule main déplace à la fois », ADR-0030 « Transition »). C'est une décision, pas une
 * surprise : re-trancher le reliquat coûte une courte pause aux campagnes de fond.
 */
function finPlacementReset_() {
  return CONFIG.RESET_TAG + '|' + CONFIG.RESET_TABLE_VERSION;
}

/** Vrai si TOUTES les phases du reset sont terminées pour le tag (et la version, côté placement). */
function resetTermine_() {
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  return props.getProperty('DriveAI_RESET_RASSEMBLEMENT') === tag &&
    props.getProperty('DriveAI_RESET_PLACEMENT') === finPlacementReset_() &&
    props.getProperty('DriveAI_RESET_04') === tag;
}

/**
 * Vrai si le reset est EN COURS (ADR-0030 « Transition ») : conso-2 (génération + exécution) et la
 * réorg auto C28-32 doivent alors être SUSPENDUES — une seule main déplace à la fois, sinon le flux
 * concurrent re-remplit ce que le reset vide (non-convergence structurelle, leçon §7 C28-26). Le
 * flux VIVANT n'est JAMAIS suspendu (garde-fou §2.6) — seules les CAMPAGNES le sont. `RESET_ACTIF:
 * false` (suspension manuelle par Marc) libère IMMÉDIATEMENT conso-2/réorg-auto.
 */
function resetEnCours_() {
  return !!CONFIG.RESET_ACTIF && !resetTermine_();
}

/* ---------- Rassemblement : domaines 01-09 (04 exclu) → `_TRI 2026/<domaine>` ---------- */

/** Renvoie (ou crée) la racine `_TRI 2026`, à côté de `_Doublons`/`_Technique` (racine DriveAI). */
function dossierTriReset_() {
  return dossierRacineParNom_(CONFIG.RESET_TRI_NOM, 'DriveAI_TRI_ID');
}

/** Renvoie (ou crée) le sous-dossier de provenance d'un domaine sous `_TRI 2026`. */
function dossierTriDomaineReset_(domaine) {
  return sousDossier_(dossierTriReset_(), domaine);
}

/**
 * Mémoïsation PAR RUN des dossiers résolus par domaine (revue #229) : `dossierTriDomaineReset_` et
 * `DriveApp.getFolderById(idDomaine_(…))` coûtent 2 appels Drive et étaient refaits POUR CHAQUE
 * FICHIER, alors qu'il y a ≤ 9 domaines. Sans cache disponible (`ctx` absent), retombe sur l'appel
 * direct — jamais un changement de comportement, seulement moins d'allers-retours.
 * @param {string} domaine
 * @param {Object} ctx
 * @param {boolean} [tri]  vrai = dossier de provenance sous `_TRI 2026` ; faux = racine du domaine
 */
function dossierDomaineMemo_(domaine, ctx, tri) {
  var cle = (tri ? 'tri:' : 'dom:') + domaine;
  if (ctx && ctx.dossiersDomaine && ctx.dossiersDomaine[cle]) return ctx.dossiersDomaine[cle];
  var d = tri ? dossierTriDomaineReset_(domaine) : DriveApp.getFolderById(idDomaine_(domaine));
  if (ctx) {
    if (!ctx.dossiersDomaine) ctx.dossiersDomaine = {};
    ctx.dossiersDomaine[cle] = d;
  }
  return d;
}

/**
 * Collecte récursive des fichiers d'un domaine ENCORE à rassembler (clé `tri33|<tag>|id` absente —
 * prédicat de convergence, filtré À LA COLLECTE : un mur de déjà-faits n'occupe aucune place de
 * page). Lecture seule, bornée par `max` et le garde-temps. `etat.complet` passe à false dès que le
 * walk s'arrête AVANT la fin de l'arbre (garde ou page pleine) — seule une passe entièrement
 * parcourue peut déclarer la campagne terminée (patron `collecterConsolidation_`).
 */
function collecterRassemblementReset_(dossier, ids, max, estBudgetDepasse, tag, etat) {
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try {
      var f = fi.next();
      if (estExcluDuReset_(f.getName())) continue;
      if (indexContient_('epingle|' + f.getId())) continue; // épinglé par Marc (chat) → immunisé (ADR-0026 ; les autres campagnes le testent déjà)
      if (indexContient_('tri33|' + tag + '|' + f.getId())) continue;
      ids.push(f.getId());
    } catch (e) {
      etat.complet = false;
      journalErreur_('Reset', 'Fichier ignoré à la collecte du rassemblement (' + e + ')');
    }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try { collecterRassemblementReset_(fo.next(), ids, max, estBudgetDepasse, tag, etat); }
    catch (e) { etat.complet = false; journalErreur_('Reset', 'Sous-dossier ignoré à la collecte (' + e + ')'); }
  }
}

/**
 * Déplace UN fichier depuis un domaine vers `_TRI 2026/<domaine>`. §1 STRICT re-vérifiée juste avant
 * (échec-fermé — un fichier PARTAGÉ collecté hors 04 peut avoir un second parent sous 04) : abstention
 * si indéterminable. MULTI-PARENTS jamais déplacé (prudence, patron ConsolidationExec — `moveTo`-style
 * détacherait tous les autres parents). Clé `tri33|<tag>|id` posée APRÈS le déplacement (ordre des
 * écritures d'état) — le domaine d'ORIGINE est en métadonnée (jamais le contenu, ADR-0007) : la phase
 * de PLACEMENT le lit directement via le sous-dossier `_TRI 2026/<domaine>` parcouru, pas l'Index.
 * @return {boolean} vrai si RÉELLEMENT déplacé ce call (faux si déjà en place, protégé ou multi-parents).
 */
function rassemblerUnFichier_(fileId, domaine, tag, proteges, ctx) {
  var cle = 'tri33|' + tag + '|' + fileId;
  if (indexContient_(cle)) return false; // déjà rassemblé (rejeu)
  var f;
  try { f = DriveApp.getFileById(fileId); }
  catch (e) {
    indexAjouter_(cle, { statut: 'tri33-absent', nom: fileId, domaine: domaine, chemin: '' }, '');
    return false;
  }
  var nom = f.getName();
  if (aParentProtege_(f, proteges, true)) {
    journalInfo_('Reset', 'Fichier en zone protégée ignoré au rassemblement (non déplacé) : ' + nom);
    indexAjouter_(cle, { statut: 'tri33-protege', nom: nom, domaine: domaine, chemin: '' }, '');
    return false;
  }
  if (nbParentsBorne_(f) > 1) {
    journalInfo_('Reset', 'Multi-parents, jamais déplacé au rassemblement : ' + nom);
    indexAjouter_(cle, { statut: 'tri33-multiparents', nom: nom, domaine: domaine, chemin: '' }, '');
    return false;
  }

  var cible = dossierDomaineMemo_(domaine, ctx, true);
  var cibleId = cible.getId();
  var ancienParent = null;
  try { var parents = f.getParents(); if (parents.hasNext()) ancienParent = parents.next(); } catch (e) { ancienParent = null; }

  var deplace = false;
  if (!(ancienParent && ancienParent.getId() === cibleId)) {
    cible.addFile(f); // ajoute la cible AVANT de retirer (jamais orphelin)
    if (ancienParent) {
      try { ancienParent.removeFile(f); }
      catch (e) { journalErreur_('Reset', 'Retrait de l\'ancien parent impossible (' + nom + ') : ' + e); }
    }
    deplace = true;
  }
  indexAjouter_(cle, { statut: 'tri33-rassemble', nom: nom, domaine: domaine, chemin: CONFIG.RESET_TRI_NOM + '/' + domaine }, '');
  if (ancienParent && ancienParent.getId() !== cibleId) {
    try { detecterDossierVide_(ancienParent, ctx); }
    catch (e) { journalErreur_('Reset', 'Détection coquille vide (rassemblement) différée : ' + e); }
  }
  return deplace;
}

/**
 * Échec de MUTATION Drive pendant le reset (rassemblement/placement). Sans ce compteur, un fichier
 * qui lève SYSTÉMATIQUEMENT à `addFile`/`removeFile` (permission d'un tiers, blip Drive prolongé)
 * était RE-COLLECTÉ à chaque passe — sa clé de succès n'étant jamais posée : le reset ne convergeait
 * JAMAIS, `resetTermine_()` restait faux, et toutes les campagnes gatées `!resetEnCours_()` (histo
 * Gmail, migration, réanalyse, conso, réconciliation) demeuraient suspendues À VIE, heartbeat vert
 * (revue de fond 2026-07-31). Ici on COMPTE l'échec (onglet Échecs, patron `gererEchec_`) et, au-delà
 * de `QUARANTAINE_MAX`, on inscrit la clé (même clé que le succès aurait posée) avec un statut
 * d'écart → la collecte le skippe → convergence. Récupérable : un bump de `RESET_TAG` (rassemblement)
 * ou de `RESET_TABLE_VERSION` (placement) le re-présente. PAS de garde panne-plateforme (un échec
 * `addFile` Drive n'est pas une panne de compte LLM — sinon une panne LLM figerait la convergence I/O).
 *
 * `tentes` (leçon §7, revue Vague 1b) : compter PAR PASSE, jamais PAR RE-RENCONTRE. Sous le pilote /
 * les un-clic, un même fichier est re-collecté à CHAQUE ronde (sa clé n'est posée qu'à l'écart) — sans
 * cette mémoire d'exécution, un blip Drive TRANSITOIRE brûlerait ses 3 essais en quelques secondes
 * (écart à tort). Avec `tentes`, l'incrément est plafonné à 1 par exécution → atteindre `QUARANTAINE_MAX`
 * exige 3 exécutions distinctes (ticks/invocations espacés). Le tick (1 passe/tick) est déjà correct.
 */
function ecarterEchecMutationReset_(cle, nom, message, tentes) {
  if (tentes) {
    if (tentes[cle]) { journalErreur_('Reset', 'Échec mutation reset (déjà compté cette exécution, ' + (nom || '?') + ') : ' + message); return; }
    tentes[cle] = true;
  }
  var n = incrementerEchec_(cle);
  if (n >= CONFIG.QUARANTAINE_MAX) {
    indexAjouter_(cle, { statut: 'tri33-ecart', domaine: '', chemin: '', nom: nom || '' });
    journalErreur_('Reset', 'Fichier écarté du reset après ' + n + ' échecs de mutation (' + (nom || '?') + ') : ' + message);
  } else {
    journalErreur_('Reset', 'Échec mutation reset ' + n + '/' + CONFIG.QUARANTAINE_MAX + ' (' + (nom || '?') + ') : ' + message);
  }
}

/** UNE passe bornée de rassemblement (tous domaines confondus). @return {{examines, deplaces, complet}} */
function rassemblerUnePageReset_(estBudgetDepasse, proteges, ctx, tentes) {
  var tag = CONFIG.RESET_TAG;
  var domaines = domainesRassemblesReset_();
  var ids = []; // [{id, domaine}]
  var etat = { complet: true };
  for (var i = 0; i < domaines.length; i++) {
    if (estBudgetDepasse() || ids.length >= CONFIG.RESET_RASSEMBLEMENT_MAX_PAR_RUN) { etat.complet = false; break; }
    var dom = domaines[i];
    var racine;
    try { racine = DriveApp.getFolderById(idDomaine_(dom)); }
    catch (e) {
      journalErreur_('Reset', 'Domaine illisible au rassemblement (' + dom + ') : ' + e);
      etat.complet = false;
      continue;
    }
    var idsDom = [];
    collecterRassemblementReset_(racine, idsDom, CONFIG.RESET_RASSEMBLEMENT_MAX_PAR_RUN - ids.length, estBudgetDepasse, tag, etat);
    for (var j = 0; j < idsDom.length; j++) ids.push({ id: idsDom[j], domaine: dom });
  }
  var deplaces = 0;
  for (var k = 0; k < ids.length; k++) {
    if (estBudgetDepasse()) { etat.complet = false; break; }
    try { if (rassemblerUnFichier_(ids[k].id, ids[k].domaine, tag, proteges, ctx)) deplaces++; }
    catch (e) {
      etat.complet = false;
      // Compté + écarté après N échecs : sinon ce fichier bloquerait la convergence du reset À VIE.
      ecarterEchecMutationReset_('tri33|' + tag + '|' + ids[k].id, ids[k].id, String(e), tentes);
    }
  }
  return { examines: ids.length, deplaces: deplaces, complet: etat.complet };
}

/**
 * ÉTAPE DE TICK : rassemblement, gatée flag + budgets (run + quotidien en ms réelles).
 * @param {function():boolean} estBudgetDepasse
 * @param {boolean} [manuel]  exécution UN-CLIC depuis l'éditeur — voir le bloc « budget QUOTIDIEN
 *   vs exécution UN-CLIC » en tête de section (ni gaté, ni compté).
 * @return {?{examines:number, deplaces:number, complet:boolean}} résultat de la passe (null si la
 *   phase n'a rien tenté) — l'appelant UN-CLIC s'arrête sur une ronde stérile.
 */
function rassemblerReset_(estBudgetDepasse, manuel, tentes) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  if (props.getProperty('DriveAI_RESET_RASSEMBLEMENT') === tag) return; // déjà terminé pour ce tag
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_RASS_JOUR', aujourdhui);
  if (!manuel && consommeJour >= CONFIG.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS) return; // repris demain

  // `tentes` (leçon §7) : mémoire des échecs de mutation PAR EXÉCUTION. Fourni par le pilote/un-clic
  // (partagé entre rondes) ; en tick (1 passe) un local frais suffit.
  tentes = tentes || {};
  var debut = Date.now();
  // En MANUEL, seul le garde de l'appelant (mur 6 min de SON exécution) borne le run.
  var budgetRun = manuel ? Infinity
    : Math.min(CONFIG.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS - consommeJour, 3 * 60 * 1000);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  try {
    var proteges = ensembleDomainesProteges_();
    var ctx = { proteges: proteges };
    var r = rassemblerUnePageReset_(garde, proteges, ctx, tentes);
    if (r.deplaces) journalInfo_('Reset', r.deplaces + ' fichier(s) rassemblé(s) vers ' + CONFIG.RESET_TRI_NOM + ' (reset).');
    if (r.complet && r.examines === 0) {
      props.setProperty('DriveAI_RESET_RASSEMBLEMENT', tag);
      journalInfo_('Reset', 'Rassemblement TERMINÉ (tag « ' + tag + ' ») — plus rien à déplacer vers ' + CONFIG.RESET_TRI_NOM + '.');
    }
    return r; // l'appelant UN-CLIC s'arrête sur une ronde STÉRILE (revue quota : anti-spin)
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_RASS_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- Placement : dédup + routage depuis `_TRI 2026/<domaine>` ---------- */

/**
 * Inscrit (DÉDUPLIQUÉ) une ligne au rapport `Reset` — même patron que `inscrireDossierVideCandidat_`
 * (ConsolidationExec.gs) : le set des clés existantes est chargé UNE fois par run (lazy, sur `ctx`).
 * Colonnes : Clé | Type | Nom | Domaine | Cible | Statut | Détail | Horodaté.
 */
function inscrireLigneReset_(cle, type, nom, domaine, cible, statut, detail, ctx) {
  var feuille = feuille_('Reset');
  if (!ctx.lignesConnues) {
    ctx.lignesConnues = {};
    var dern = feuille.getLastRow();
    var cles = dern >= 1 ? feuille.getRange(1, 1, dern, 1).getValues() : [];
    for (var i = 0; i < cles.length; i++) {
      var k = String(cles[i][0]);
      if (k) ctx.lignesConnues[k] = true;
    }
  }
  if (ctx.lignesConnues[cle]) return;
  feuille.appendRow([cle, type, nom, domaine, cible, statut, detail, new Date().toISOString()]);
  ctx.lignesConnues[cle] = true;
}

/**
 * QUASI-doublon probable (même nom NORMALISÉ, taille DIFFÉRENTE — hors de portée du hash exact,
 * ADR-0030 §2) : jamais déplacé, RAPPORT seul, tranché par Marc. Comparaison bornée au MÊME domaine
 * d'origine (deux homonymes de domaines différents ne sont pas nécessairement liés). Mémoire de
 * campagne (`ctx.taillesVues`, ce run) — best-effort, jamais une preuve ; le hash exact reste la
 * SEULE dédup qui déplace un fichier.
 *
 * `hashee` (revue code C28-33) : une taille IDENTIQUE ne prouve « déjà couvert par le hash » que si
 * LES DEUX fichiers comparés ont RÉELLEMENT été hashés (`empreinteBlob_` n'est jamais appelée
 * au-delà de `CONFIG.OCR_TAILLE_MAX`, cf. `placerUnFichierReset_`) — sinon, deux gros fichiers
 * homonymes de même taille mais de contenu DIFFÉRENT passeraient inaperçus des deux dédups (ni le
 * hash exact, jamais calculé, ni ce rapport, court-circuité à tort par l'égalité de taille seule).
 */
function signalerQuasiDoublonReset_(nom, taille, hashee, fileId, domaine, ctx) {
  var cleTaille = domaine + '|' + normaliserCle_(nom);
  if (!ctx.taillesVues) ctx.taillesVues = {};
  var vu = ctx.taillesVues[cleTaille];
  if (vu === undefined) { ctx.taillesVues[cleTaille] = { taille: taille, hashee: hashee }; return; }
  if (vu.taille === taille && vu.hashee && hashee) return; // tailles égales ET LES DEUX hashées → déjà couvert
  // Clé VERSIONNÉE (revue #227) : sans la version, un cas résolu par un affinage de table garderait
  // sa ligne « à trancher » à vie et le rapport que Marc lit surévaluerait le reliquat.
  inscrireLigneReset_('quasidoublon|' + CONFIG.RESET_TABLE_VERSION + '|' + fileId, 'quasi-doublon', nom, domaine, '', 'doublon-probable',
    'même nom, taille ' + (vu.taille === taille ? 'identique mais NON confirmée par hash' : 'différente') +
    ' (' + taille + ' vs ' + vu.taille + ' octets)', ctx);
}

/** Fichier NON ROUTÉ (ADR-0030 §3) : reste dans `_TRI`, RAPPORTÉ — jamais deviné. */
function signalerNonRouteReset_(nom, fileId, domaine, ctx) {
  // Clé VERSIONNÉE (revue #227) : chaque version de table produit son instantané HONNÊTE du
  // reliquat. Sans ça, un fichier non routé en t1 puis correctement placé en t2 resterait affiché
  // « aucune règle ne matche » — on écrirait des règles t3 pour des cas déjà résolus.
  inscrireLigneReset_('nonroute|' + CONFIG.RESET_TABLE_VERSION + '|' + fileId, 'non-routé', nom, domaine, CONFIG.RESET_TRI_NOM + '/' + domaine,
    'reste en _TRI', 'aucune règle de la structure cible du reset ne matche ce nom — affiner la table ou décision Marc', ctx);
}

/**
 * Empreinte du fichier SANS re-télécharger ses octets quand elle est DÉJÀ connue — d'abord le plan de
 * consolidation (`ctx.empreintesConnues`, lu une fois par run), puis l'Index (`empreinteConnueParId_`,
 * qui couvre le flux vivant `drive|…` ET les placements d'une version de table précédente : bumper
 * `RESET_TABLE_VERSION` ne re-hashe donc RIEN). `empreinteBlob_` reste le SEUL producteur : toute
 * valeur réutilisée en vient, la sémantique de dédup est inchangée (revue #229).
 *
 * Borne de taille PROPRE au reset (`RESET_HASH_TAILLE_MAX`, 5 Mo) et non `OCR_TAILLE_MAX` (20 Mo) :
 * hasher 20 Mo coûte 10-60 s et peut franchir le mur des 6 min sur le dernier item d'un run. Au-delà,
 * empreinte vide ⇒ jamais déplacé comme doublon, mais `signalerQuasiDoublonReset_` le RAPPORTE (le
 * flag `hashee` transmet honnêtement « non hashé », donc aucun cas n'est court-circuité à tort).
 */
function empreinteReutiliseeReset_(f, ctx) {
  // 🔴 EXCLUSION des fichiers Google NATIFS (revue sécurité #229) — sans elle, ce commit enverrait
  // des ORIGINAUX dans `_Doublons`. Pour un natif, l'empreinte inscrite à l'Index par l'intake N'EST
  // PAS le hash du fichier : `Intake.gs` hashe le TEXTE EXPORTÉ (`Utilities.newBlob(texte, …)`).
  // L'intake le sait — c'est la raison d'être de son flag `ignorerDoublon` (« deux exports vides
  // partagent le même MD5 ») — mais ce flag NE SURVIT PAS dans l'Index. Deux Sheets quasi vides y
  // portent donc le même MD5 : réutilisée ici, cette valeur ferait partir le second en `_Doublons`.
  // On ne hashe pas non plus le blob d'un natif (export PDF : deux documents vides peuvent
  // coïncider, et `getSize()` vaut 0 donc la borne de taille ne protège rien). Empreinte vide ⇒
  // JAMAIS déplacé comme doublon — le sens sûr ; le quasi-doublon reste RAPPORTÉ par le nom.
  // Illisible ⇒ traité comme natif (échec-fermé : on s'abstient plutôt que de risquer un déplacement).
  var mime;
  try { mime = String(f.getMimeType() || ''); } catch (e) { return ''; }
  if (mime.indexOf('application/vnd.google-apps') === 0) return '';

  var id = f.getId();
  var connue = (ctx && ctx.empreintesConnues && ctx.empreintesConnues[id]) || empreinteConnueParId_(id);
  if (connue) return String(connue);
  try { if (f.getSize() <= CONFIG.RESET_HASH_TAILLE_MAX) return empreinteBlob_(f.getBlob()); }
  catch (e) { return ''; }
  return '';
}

/**
 * Résout (find-or-create) le dossier cible d'un sous-chemin STRUCTUREL (`cheminCibleReset_`) sous un
 * domaine. Quand le DERNIER segment correspond à une ENTITÉ VALIDÉE de ce domaine (ex. « Bellerives »,
 * « Alphatek ») dont le `Dossier ID` pointait encore l'ANCIEN emplacement, celui-ci est RE-POINTÉ vers
 * le nouveau dossier (ADR-0030 « Transition » — sinon le flux vivant router route vers un dossier
 * mort/vide dès le tick suivant, ADR-0028). Réutilise `repointerEntites_` (Reorg.gs, déjà testé pour
 * la fusion) ; `ctx.repointes` déduplique les écritures Sheet redondantes dans le run.
 */
function resoudreCibleReset_(domaineDossier, domaine, sousChemin, ctx) {
  // Mémoïsation par run (revue #229) : `sousDossier_` fait 1-2 appels Drive PAR SEGMENT, refaits pour
  // chaque fichier alors qu'il n'y a que quelques dizaines de chemins cibles distincts. Le re-pointage
  // ci-dessous est déjà idempotent par `ctx.repointes` ; le sauter sur un chemin déjà résolu est donc
  // sans effet de bord.
  var cleMemo = domaine + '/' + sousChemin;
  if (ctx.ciblesResolues && ctx.ciblesResolues[cleMemo]) return ctx.ciblesResolues[cleMemo];

  var segments = sousChemin.split('/');
  var dossier = domaineDossier;
  for (var i = 0; i < segments.length; i++) dossier = sousDossier_(dossier, segments[i]);
  if (ctx.ciblesResolues) ctx.ciblesResolues[cleMemo] = dossier;

  var dernier = segments[segments.length - 1];
  var cle = cleCanoniqueEntite_(domaine, dernier);
  if (cle && ctx.validees && ctx.validees[cle] && ctx.validees[cle].dossierId &&
      ctx.validees[cle].dossierId !== dossier.getId() && !ctx.repointes[ctx.validees[cle].dossierId]) {
    try {
      repointerEntites_(ctx.validees[cle].dossierId, dossier.getId());
      ctx.repointes[ctx.validees[cle].dossierId] = true;
    } catch (e) { journalErreur_('Reset', 'Re-pointage d\'entité différé (' + dernier + ') : ' + e); }
  }
  return dossier;
}

/**
 * Traite UN fichier de `_TRI 2026/<domaine>` : §1 RE-VÉRIFIÉE STRICTE (échec-fermé) + multi-parents
 * EXCLUS (revue sécurité C28-33 : le rassemblement et le placement sont deux campagnes SÉPARÉES,
 * bornées chacune par son propre budget quotidien — un fichier peut donc attendre des JOURS dans
 * `_TRI` avant d'être placé ; pendant cette fenêtre, un geste Drive normal de Marc (« Ajouter à un
 * dossier ») peut lui donner un second parent sous 04 · Immigration. Sans cette re-vérification, un
 * `removeFile` sur le mauvais parent détacherait le fichier de la zone protégée — même garde que
 * `rassemblerUnFichier_`/`reorganiserInterne04_`, jamais une exception de phase), PUIS dédup par
 * empreinte (campagne, seedée depuis `empreintesPlanConsolidation_` — réutilisation des empreintes
 * déjà connues de conso-2), PUIS routage PAR LE NOM (`cheminCibleReset_`, zéro LLM). Doublon EXACT →
 * `_Doublons` (déplacement seul, §2). Non routé (null) → reste dans `_TRI`, rapporté. Clé
 * `tri33p|<tag>|<versionTable>|id` posée dans TOUS les cas (convergence : un fichier non-routé n'est
 * jamais re-hashé à chaque run) — la VERSION DE TABLE en fait partie pour que l'affinage des règles
 * puisse re-tenter le reliquat, cf. `CONFIG.RESET_TABLE_VERSION`.
 * @return {boolean} vrai si RÉELLEMENT déplacé ce call.
 */
function placerUnFichierReset_(f, domaine, cle, ctx) {
  var nom = f.getName();
  var cheminTri = CONFIG.RESET_TRI_NOM + '/' + domaine;
  if (aParentProtege_(f, ctx.proteges, true)) {
    journalInfo_('Reset', 'Fichier en zone protégée ignoré au placement (non déplacé) : ' + nom);
    indexAjouter_(cle, { statut: 'tri33p-protege', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    return false;
  }
  if (nbParentsBorne_(f) > 1) {
    journalInfo_('Reset', 'Multi-parents, jamais déplacé au placement : ' + nom);
    indexAjouter_(cle, { statut: 'tri33p-multiparents', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    return false;
  }

  var statut = 'tri33-reste';
  var cheminFinal = cheminTri;
  var ancienParent = null;
  try { var pp = f.getParents(); if (pp.hasNext()) ancienParent = pp.next(); } catch (e) { ancienParent = null; }

  var empreinte = empreinteReutiliseeReset_(f, ctx);

  var doublonDe = (empreinte && ctx.empreintesVues[empreinte] && ctx.empreintesVues[empreinte] !== f.getId())
    ? ctx.empreintesVues[empreinte] : null;
  if (empreinte && !ctx.empreintesVues[empreinte]) ctx.empreintesVues[empreinte] = f.getId();

  var cibleDossier = null;
  if (doublonDe) {
    cibleDossier = dossierDoublons_();
    statut = 'tri33-doublon';
    cheminFinal = '_Doublons';
  } else {
    signalerQuasiDoublonReset_(nom, f.getSize(), !!empreinte, f.getId(), domaine, ctx);
    var sousChemin = cheminCibleReset_(domaine, nom);
    if (sousChemin) {
      cibleDossier = resoudreCibleReset_(dossierDomaineMemo_(domaine, ctx), domaine, sousChemin, ctx);
      statut = 'tri33-route';
      cheminFinal = domaine + '/' + sousChemin;
    } else {
      signalerNonRouteReset_(nom, f.getId(), domaine, ctx);
    }
  }

  var deplace = false;
  if (cibleDossier) {
    var cibleId = cibleDossier.getId();
    if (!(ancienParent && ancienParent.getId() === cibleId)) {
      cibleDossier.addFile(f);
      if (ancienParent) {
        try { ancienParent.removeFile(f); }
        catch (e) { journalErreur_('Reset', 'Retrait ancien parent (placement) impossible (' + nom + ') : ' + e); }
      }
      deplace = true;
    }
  }
  indexAjouter_(cle, { statut: statut, nom: nom, domaine: domaine, chemin: cheminFinal }, empreinte);
  if (ancienParent && cibleDossier && ancienParent.getId() !== cibleDossier.getId()) {
    try { detecterDossierVide_(ancienParent, ctx); }
    catch (e) { journalErreur_('Reset', 'Détection coquille vide (placement) différée : ' + e); }
  }
  return deplace;
}

/** UNE passe bornée de placement (tous domaines confondus). @return {{examines, deplaces, complet}} */
function placerUnePageReset_(estBudgetDepasse, ctx, tentes) {
  var tag = CONFIG.RESET_TAG;
  var racine = dossierTriReset_();
  var domaines = domainesRassemblesReset_();
  var examines = 0, deplaces = 0, complet = true;
  for (var i = 0; i < domaines.length; i++) {
    if (estBudgetDepasse() || examines >= CONFIG.RESET_PLACEMENT_MAX_PAR_RUN) { complet = false; break; }
    var dom = domaines[i];
    var sousTri;
    try { sousTri = racine.getFoldersByName(dom); }
    catch (e) { complet = false; continue; }
    if (!sousTri.hasNext()) continue; // rien rassemblé pour ce domaine (ou déjà entièrement placé)
    var dossierDom = sousTri.next();
    var fi;
    try { fi = dossierDom.getFiles(); } catch (e) { complet = false; continue; }
    while (fi.hasNext()) {
      if (estBudgetDepasse() || examines >= CONFIG.RESET_PLACEMENT_MAX_PAR_RUN) { complet = false; break; }
      var f;
      try { f = fi.next(); } catch (e) { complet = false; break; }
      // La VERSION DE TABLE entre dans la clé : bumper `RESET_TABLE_VERSION` re-tente le placement
      // du RELIQUAT après un affinage des règles. Sans risque de défaire le travail fait : la
      // collecte n'itère QUE sur `_TRI 2026/<domaine>` — un fichier déjà placé n'y est plus, donc
      // il n'est jamais re-présenté, quelle que soit la version.
      var cle = 'tri33p|' + tag + '|' + CONFIG.RESET_TABLE_VERSION + '|' + f.getId();
      if (indexContient_(cle)) continue; // déjà tenté — gratuit, n'occupe pas la page
      examines++;
      try { if (placerUnFichierReset_(f, dom, cle, ctx)) deplaces++; }
      catch (e) {
        complet = false;
        var nomEch = ''; try { nomEch = f.getName(); } catch (e2) { /* nom best-effort */ }
        ecarterEchecMutationReset_(cle, nomEch, String(e), tentes); // sinon re-collecté à vie → placement jamais fini
      }
    }
  }
  return { examines: examines, deplaces: deplaces, complet: complet };
}

/**
 * ÉTAPE DE TICK : placement, gatée flag + budgets. « Terminé » posé UNIQUEMENT si le rassemblement
 * l'est AUSSI pour ce tag (patron `appliquerPlanConsolidation_` — l'exécution ne peut pas se figer
 * « fini » tant que la génération peut encore alimenter la file, sinon de nouveaux fichiers rassemblés
 * plus tard ne seraient plus jamais placés).
 */
function placerReset_(estBudgetDepasse, manuel, tentes) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  // Drapeau VERSIONNÉ (cf. finPlacementReset_) : un bump de table RÉ-OUVRE la phase, sinon le
  // mécanisme de version serait neutralisé ici, avant même la construction des clés par fichier.
  if (props.getProperty('DriveAI_RESET_PLACEMENT') === finPlacementReset_()) return;
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_PLACE_JOUR', aujourdhui);
  if (!manuel && consommeJour >= CONFIG.RESET_PLACEMENT_BUDGET_JOUR_MS) return;

  tentes = tentes || {}; // mémoire des échecs de mutation par exécution (leçon §7 ; cf. rassemblerReset_)
  var debut = Date.now();
  var budgetRun = manuel ? Infinity
    : Math.min(CONFIG.RESET_PLACEMENT_BUDGET_JOUR_MS - consommeJour, 3 * 60 * 1000);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  try {
    var plan = empreintesPlanDeuxSens_(); // UNE lecture → les deux sens (revue #229)
    var ctx = {
      proteges: ensembleDomainesProteges_(),
      validees: entitesValideesParCle_(),
      empreintesVues: plan.parEmpreinte,   // empreinte → 1er porteur (dédup)
      empreintesConnues: plan.parId,       // fileId → empreinte (ne PAS re-télécharger les octets)
      repointes: {},
      ciblesResolues: {},                  // sous-chemin → dossier (mémoïsation, cf. resoudreCibleReset_)
    };
    var r = placerUnePageReset_(garde, ctx, tentes);
    if (r.deplaces) journalInfo_('Reset', r.deplaces + ' fichier(s) traité(s) au placement (reset).');
    if (r.complet && r.examines === 0) {
      if (props.getProperty('DriveAI_RESET_RASSEMBLEMENT') === tag) {
        props.setProperty('DriveAI_RESET_PLACEMENT', finPlacementReset_());
        journalInfo_('Reset', 'Placement TERMINÉ (' + finPlacementReset_() + ') — rassemblement également fini.');
      } else {
        // État STABLE « oisif mais tag impossible » (le placement ne se fige qu'après le
        // rassemblement) : c'est exactement le cas où une boucle un-clic spinnerait à vide — d'où
        // la sortie sur ronde stérile côté appelant (le `return r` ci-dessous).
        journalInfo_('Reset', 'Placement à jour pour cette passe — rassemblement encore en cours, repris au tick suivant.');
      }
    }
    return r;
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_PLACE_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- Passe LLM du RELIQUAT (ADR-0030 PR5, décision Marc 2026-07-31) ---------- */

/**
 * Analyse UN fichier du reliquat par le PIPELINE COMPLET (patron `reanalyserFichier_`, C26-08) :
 * OCR → analyse v2 → routage v2 → fail-safe ADR-0016 → renommage conventionnel. Les 3 verrous du
 * re-traitement (leçon §7) : clé de campagne dédiée (posée par `traiterDocument_` sous `cle`),
 * `ignorerDoublon: true` (le placement a écrit l'empreinte à l'Index — sans bypass, « doublon de
 * lui-même » → tout partirait en `_Doublons`), placement DIRECT (`deplacerEtRenommer_`, jamais de
 * transit par `00 · À trier`). Gardes de mutation IDENTIQUES au placement : zone protégée re-vérifiée
 * ici (fenêtre multi-jours dans `_TRI`), multi-parents jamais déplacé.
 * @return {boolean} vrai si le pipeline a été invoqué.
 */
function analyserFichierReliquat_(f, domaine, nom, cle, proteges) {
  var cheminTri = CONFIG.RESET_TRI_NOM + '/' + domaine;
  if (aParentProtege_(f, proteges, true)) { // STRICT : abstention si indéterminable (jamais détacher, §1)
    indexAjouter_(cle, { statut: 'tri33llm-protege', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    journalInfo_('Reset', 'Reliquat en zone protégée ignoré (non touché) : ' + nom);
    return false;
  }
  if (nbParentsBorne_(f) > 1) {
    indexAjouter_(cle, { statut: 'tri33llm-multiparents', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    journalInfo_('Reset', 'Reliquat multi-parents, jamais déplacé : ' + nom);
    return false;
  }
  var fileId, parentId, taille, date;
  try {
    // TOUTES les lectures de métadonnées dans le try : un fichier devenu illisible entre la collecte
    // et ici est mis en quarantaine (compteur d'échecs), jamais re-collecté à vie ni bloquant.
    fileId = f.getId();
    var parents = f.getParents();
    parentId = parents.hasNext() ? parents.next().getId() : '';
    taille = f.getSize();
    date = f.getLastUpdated();
  } catch (e) {
    gererEchec_({ cle: cle, nom: nom || 'reliquat' }, 'document illisible (reliquat reset) : ' + e);
    return false;
  }
  var blobMemo = null;
  function blobUneFois_() {
    if (blobMemo === null) blobMemo = f.getBlob();
    return blobMemo;
  }
  traiterDocument_({
    cle: cle,
    fileId: fileId, // DriveAI#898 : empreinte et taille lues par REST (ADR-0077), le blob n'est matérialisé que pour l'OCR
    nom: nom,
    taille: taille,
    expediteur: '',
    sujet: 'Reliquat reset (ADR-0030 PR5)',
    date: date,
    ignorerDoublon: true, // son empreinte est déjà à l'Index (écrite au placement) — pas « doublon de lui-même »
    blob: blobUneFois_,
    placer: function (dossierId, nouveauNom) {
      if (dossierId === parentId) return renommer_(fileId, nouveauNom) ? fileId : ''; // déjà au bon endroit
      return deplacerEtRenommer_(fileId, dossierId, parentId, nouveauNom) ? fileId : '';
    }
  });
  return true;
}

/**
 * UNE passe bornée sur le reliquat : les fichiers de `_TRI 2026/<domaine>` que la TABLE ne route
 * PAS (`cheminCibleReset_` null — prédicat PUR, gratuit ; un routable est laissé au PLACEMENT,
 * beaucoup moins cher). Convergence : un fichier traité SORT de `_TRI` (classé, `_Technique`,
 * `_Médias` ou `00 · À vérifier` par le fail-safe) → jamais re-collecté ; les gardes (protégé,
 * multi-parents) posent une clé VERSIONNÉE — un affinage de table les re-tente, jamais le déjà-sorti.
 * @return {{examines:number, complet:boolean}}
 */
function analyserPageReliquatReset_(garde, proteges, tentes) {
  var tag = CONFIG.RESET_TAG;
  var racine = dossierTriReset_();
  var domaines = domainesRassemblesReset_();
  var examines = 0, complet = true;
  for (var i = 0; i < domaines.length; i++) {
    if (garde() || examines >= CONFIG.RESET_LLM_MAX_PAR_RUN) { complet = false; break; }
    var dom = domaines[i];
    var sousTri;
    try { sousTri = racine.getFoldersByName(dom); }
    catch (e) { complet = false; continue; }
    if (!sousTri.hasNext()) continue;
    var fi;
    try { fi = sousTri.next().getFiles(); } catch (e) { complet = false; continue; }
    while (fi.hasNext()) {
      if (garde() || examines >= CONFIG.RESET_LLM_MAX_PAR_RUN) { complet = false; break; }
      var f;
      try { f = fi.next(); } catch (e) { complet = false; break; }
      var nom = '', fid = '';
      // Nom ET id dans le même try : un fichier devenu illisible ici ne doit jamais avorter la page.
      try { nom = f.getName(); fid = f.getId(); } catch (e) { complet = false; continue; }
      if (cheminCibleReset_(dom, nom)) continue; // routable par la table → au placement, jamais au LLM
      var cle = 'tri33llm|' + tag + '|' + CONFIG.RESET_TABLE_VERSION + '|' + fid;
      if (indexContient_(cle)) continue; // déjà tenté (garde) — gratuit, n'occupe pas la page
      // Déjà tenté dans CETTE exécution (pilote CI) : un échec transitoire ne doit pas consommer ses
      // 3 essais en quelques minutes (quarantaine définitive, sans chemin de retour pour `tri33llm|`).
      // Les essais suivants auront lieu aux passes SUIVANTES, espacées — leçon « compter par PASSE ».
      if (tentes && tentes[cle]) continue;
      if (tentes) tentes[cle] = true;
      examines++;
      try { analyserFichierReliquat_(f, dom, nom, cle, proteges); }
      catch (e) { complet = false; journalErreur_('Reset', 'Analyse du reliquat différée (' + nom + ') : ' + e); }
    }
  }
  return { examines: examines, complet: complet };
}

/**
 * ÉTAPE DE TICK : passe LLM du reliquat. Campagne de FOND ⇒ budget QUOTIDIEN en ms réelles
 * persistées (`DriveAI_RESET_LLM_JOUR`, patron des 3 autres phases — revue flotte C28-42 : « un
 * plafond par RUN ne borne pas la JOURNÉE », sans lui le drainage concentrait 50-130 min de
 * runtime sur UN jour → gel C28-29, chien de garde inclus). Budget RÉALLOUÉ dans l'enveloppe
 * 50 min/j du reset (placement 22→14, 04 8→4), sommé dans l'invariant d'orchestration ; le frein
 * campagnes §2.6 et la panne plateforme (R2) la suspendent. JAMAIS gatée par `resetEnCours_()`
 * (réciproque vitale) : elle tourne PENDANT le reset et après, jusqu'au drainage. Pas de chemin
 * UN-CLIC (voulu : jamais de boucle Sonnet non bornée en manuel — le drainage suit le tick).
 * Drapeau terminal versionné = la MÊME chaîne que le placement (`finPlacementReset_`), posé sur
 * passe vide UNIQUEMENT quand le placement est terminé (avant, le rassemblement peut encore
 * alimenter `_TRI`) → coût nul ensuite (1 lecture de Property par tick) ; un bump de table le
 * ré-ouvre avec le placement.
 */
function analyserReliquatReset_(estBudgetDepasse, manuel, tentes) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_RESET_LLM') === finPlacementReset_()) return; // reliquat drainé
  if (estPannePlateforme_()) return; // panne de COMPTE API : aucun doc touché, re-sonde ailleurs (R2)
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_LLM_JOUR', aujourdhui);
  // `manuel` (un-clic éditeur / PILOTE CI ADR-0032) : ni gaté, ni compté — le budget quotidien
  // protège le quota des DÉCLENCHEURS, dont ces chemins ne font pas partie. Le coût $ est borné
  // ailleurs et ne change PAS : plafond d'items par passe + clé versionnée (chaque doc payé une
  // seule fois par version de table) + frein campagnes §2.6, tous conservés ci-dessous.
  if (!manuel && consommeJour >= CONFIG.RESET_LLM_BUDGET_JOUR_MS) return; // budget du jour épuisé — repris demain
  var debut = Date.now();
  var budgetRun = manuel ? Infinity : CONFIG.RESET_LLM_BUDGET_JOUR_MS - consommeJour;
  var garde = function () {
    return estBudgetDepasse() || budgetCampagnesAtteint_() || estPannePlateforme_() ||
      (Date.now() - debut) > budgetRun;
  };
  if (garde()) return; // avant `debut` compté : un tick sans créneau ne consomme rien
  try {
    var r = analyserPageReliquatReset_(garde, ensembleDomainesProteges_(), tentes);
    if (r.examines) journalInfo_('Reset', r.examines + ' fichier(s) du reliquat passés au pipeline (LLM).');
    if (r.complet && r.examines === 0 &&
        props.getProperty('DriveAI_RESET_PLACEMENT') === finPlacementReset_()) {
      props.setProperty('DriveAI_RESET_LLM', finPlacementReset_());
      journalInfo_('Reset', 'Reliquat LLM DRAINÉ (' + finPlacementReset_() + ') — plus rien de non-routable dans ' + CONFIG.RESET_TRI_NOM + '.');
    }
    return r;
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_LLM_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- 04 · Immigration : réorganisation INTERNE (CLAUDE.md §2.1b révisé, ADR-0030 §4) ---------- */

/** Racine de 04 · Immigration — TOUTE cible interne est construite depuis CE dossier (jamais un chemin arbitraire). */
function dossierRacine04Reset_() {
  return DriveApp.getFolderById(CONFIG.DOMAINES['04 · Immigration']);
}

/**
 * Résout (find-or-create) une cible INTERNE à 04. Construite STRUCTURELLEMENT depuis la racine 04
 * (`dossierRacine04Reset_`, jamais depuis un ID/chemin fourni par l'appelant) : par construction, il
 * est IMPOSSIBLE de renvoyer un dossier hors de 04 (CLAUDE.md §2.1b).
 */
function dossierInterne04Reset_(sousChemin) {
  var segments = sousChemin.split('/');
  var dossier = dossierRacine04Reset_();
  for (var i = 0; i < segments.length; i++) dossier = sousDossier_(dossier, segments[i]);
  return dossier;
}

function collecterInterne04Reset_(dossier, ids, max, estBudgetDepasse, tag, etat) {
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try {
      var f = fi.next();
      if (estExcluDuReset_(f.getName())) continue;
      if (indexContient_('epingle|' + f.getId())) continue; // épinglé par Marc → jamais réorganisé même à l'intérieur de 04 (ADR-0026)
      if (indexContient_('tri33-04|' + tag + '|' + f.getId())) continue;
      ids.push(f.getId());
    } catch (e) { etat.complet = false; journalErreur_('Reset', 'Fichier ignoré à la collecte 04 interne (' + e + ')'); }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try { collecterInterne04Reset_(fo.next(), ids, max, estBudgetDepasse, tag, etat); }
    catch (e) { etat.complet = false; journalErreur_('Reset', 'Sous-dossier ignoré à la collecte 04 interne (' + e + ')'); }
  }
}

/**
 * Réorganise UN fichier de 04 EN INTERNE (CLAUDE.md §2.1b, ADR-0030 §4). Cible résolue via
 * `dossierInterne04Reset_` (construite depuis la racine 04) PUIS re-vérifiée par `segmentsSousDomaine_`
 * (défense en profondeur, échec-fermé — ADR-0028) : un échec bloque le déplacement, ne le laisse
 * jamais passer. `cheminCibleReset_('04 · Immigration', nom)` null ⇒ jamais touché (reste À SA PLACE,
 * PAS de sortie — un doc ambigu, ex. « CMF » qui pourrait être la banque, n'est jamais déplacé
 * d'office). MULTI-PARENTS jamais déplacé (même prudence que ConsolidationExec).
 * @return {boolean} vrai si RÉELLEMENT déplacé ce call.
 */
function reorganiserInterne04_(fileId, tag, ctx) {
  var cle = 'tri33-04|' + tag + '|' + fileId;
  if (indexContient_(cle)) return false;
  var f;
  try { f = DriveApp.getFileById(fileId); }
  catch (e) {
    indexAjouter_(cle, { statut: 'tri33-04-absent', nom: fileId, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }
  var nom = f.getName();

  if (nbParentsBorne_(f) > 1) {
    indexAjouter_(cle, { statut: 'tri33-04-multiparents', nom: nom, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }
  var sousChemin = cheminCibleReset_('04 · Immigration', nom);
  if (!sousChemin) {
    indexAjouter_(cle, { statut: 'tri33-04-reste', nom: nom, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }
  var cible = dossierInterne04Reset_(sousChemin);
  // Défense en profondeur (CLAUDE.md §2.1b, échec-fermé) : garanti par construction, re-vérifié quand même.
  if (!segmentsSousDomaine_(cible, CONFIG.DOMAINES['04 · Immigration'])) {
    journalErreur_('Reset', 'Cible 04-interne hors de 04 (refusé, ne devrait jamais arriver) : ' + nom);
    indexAjouter_(cle, { statut: 'tri33-04-refus', nom: nom, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }

  var cibleId = cible.getId();
  var ancienParent = null;
  try { var ps = f.getParents(); if (ps.hasNext()) ancienParent = ps.next(); } catch (e) { ancienParent = null; }
  var deplace = false;
  if (!(ancienParent && ancienParent.getId() === cibleId)) {
    cible.addFile(f);
    if (ancienParent) {
      try { ancienParent.removeFile(f); }
      catch (e) { journalErreur_('Reset', 'Retrait ancien parent 04 impossible (' + nom + ') : ' + e); }
    }
    deplace = true;
    if (ancienParent && typeof enregistrerAction_ === 'function') {
      enregistrerAction_('drive-deplacer', fileId,
        { parentId: ancienParent.getId(), nom: nom },
        { parentId: cibleId, nom: nom },
        'reorg-interne-04');
    }
  }
  indexAjouter_(cle, { statut: 'tri33-04-route', nom: nom, domaine: '04 · Immigration', chemin: '04 · Immigration/' + sousChemin }, '');
  if (ancienParent && ancienParent.getId() !== cibleId) {
    try { detecterDossierVide_(ancienParent, ctx); }
    catch (e) { journalErreur_('Reset', 'Détection coquille vide 04 différée : ' + e); }
  }
  return deplace;
}

/** UNE passe bornée de réorg interne 04. @return {{examines, deplaces, complet}} */
function reorganiserPageInterne04_(estBudgetDepasse, ctx) {
  var tag = CONFIG.RESET_TAG;
  var racine;
  try { racine = dossierRacine04Reset_(); }
  catch (e) {
    journalErreur_('Reset', 'Racine 04 illisible (04 interne) : ' + e);
    return { examines: 0, deplaces: 0, complet: false };
  }
  var ids = [];
  var etat = { complet: true };
  collecterInterne04Reset_(racine, ids, CONFIG.RESET_04_MAX_PAR_RUN, estBudgetDepasse, tag, etat);
  var deplaces = 0;
  for (var i = 0; i < ids.length; i++) {
    if (estBudgetDepasse()) { etat.complet = false; break; }
    try { if (reorganiserInterne04_(ids[i], tag, ctx)) deplaces++; }
    catch (e) { etat.complet = false; journalErreur_('Reset', '04 interne différé (' + ids[i] + ') : ' + e); }
  }
  return { examines: ids.length, deplaces: deplaces, complet: etat.complet };
}

/**
 * Réorganisation interne autonome de `04 · Immigration` (ADR-0081, vague 4c).
 * Exécute par lots bornés sous le frein budget 30 $ ; ne sort jamais de 04 et pose le tag
 * de complétion uniquement lorsqu'une passe complète ne collecte plus rien.
 * @param {function():boolean} estBudgetDepasse
 * @return {boolean} vrai si au moins un fichier reste potentiellement à traiter
 */
function appliquerReorgInterne04Autonome_(estBudgetDepasse) {
  if (!CONFIG.REORG_04_INTERNE_ACTIF) return false;
  if (typeof budgetCampagnesAtteint_ === 'function' && budgetCampagnesAtteint_()) return false;
  var budget = typeof estBudgetDepasse === 'function' ? estBudgetDepasse : function () { return false; };
  if (budget()) return false;
  if (typeof DriveApp === 'undefined' || typeof DriveApp.getFolderById !== 'function') return false;

  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.REORG_04_INTERNE_TAG || 'v4c-04';
  if (props.getProperty('DriveAI_REORG_04_INTERNE') === tag) return false;

  var racine;
  try { racine = dossierRacine04Reset_(); }
  catch (e) {
    journalErreur_('Reset', 'Racine 04 illisible (reorg interne autonome) : ' + e);
    return false;
  }

  var max = CONFIG.REORG_04_INTERNE_MAX_PAR_RUN || 10;
  var ids = [];
  var etat = { complet: true };
  collecterInterne04Reset_(racine, ids, max, budget, tag, etat);

  var deplaces = 0;
  var ctx = { proteges: ensembleDomainesProteges_() };
  for (var i = 0; i < ids.length; i++) {
    if (budget()) { etat.complet = false; break; }
    try { if (reorganiserInterne04_(ids[i], tag, ctx)) deplaces++; }
    catch (e2) {
      etat.complet = false;
      journalErreur_('Reset', 'Réorg interne 04 différée (' + ids[i] + ') : ' + e2);
    }
  }
  if (deplaces > 0) {
    journalInfo_('Reset', deplaces + ' document(s) réorganisé(s) en interne dans 04 · Immigration (' + tag + ').');
  }
  if (etat.complet && ids.length === 0) {
    props.setProperty('DriveAI_REORG_04_INTERNE', tag);
    journalInfo_('Reset', 'Réorganisation interne 04 · Immigration terminée (' + tag + ').');
    return false;
  }
  return !etat.complet || ids.length > 0;
}

/** ÉTAPE DE TICK : réorganisation interne de 04, gatée flag + budgets. */
function appliquerReset04Interne_(estBudgetDepasse, manuel) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  if (props.getProperty('DriveAI_RESET_04') === tag) return;
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_04_JOUR', aujourdhui);
  if (!manuel && consommeJour >= CONFIG.RESET_04_BUDGET_JOUR_MS) return;

  var debut = Date.now();
  var budgetRun = manuel ? Infinity
    : Math.min(CONFIG.RESET_04_BUDGET_JOUR_MS - consommeJour, 2 * 60 * 1000);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  try {
    var ctx = { proteges: ensembleDomainesProteges_() };
    var r = reorganiserPageInterne04_(garde, ctx);
    if (r.deplaces) journalInfo_('Reset', r.deplaces + ' fichier(s) réorganisé(s) EN INTERNE sous 04 (reset).');
    if (r.complet && r.examines === 0) {
      props.setProperty('DriveAI_RESET_04', tag);
      journalInfo_('Reset', '04 interne TERMINÉ (tag « ' + tag + ' »).');
    }
    return r;
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_04_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- Fonctions UN-CLIC (éditeur Apps Script, hors quota ~90 min/j des déclencheurs) ---------- */

/**
 * Acquiert le verrou partagé du tick avant une fonction UN-CLIC (revue quota C28-33) : sans lui, un
 * `tickDriveAI` déclenché PENDANT les plusieurs minutes d'une boucle manuelle tournerait en PARALLÈLE
 * sur les mêmes dossiers Drive et les mêmes Script Properties de budget — course sur
 * `DriveAI_RESET_*_JOUR` (la dernière écriture du `finally` écrase l'autre, sous-comptant le budget
 * réellement consommé) et appels Drive redondants sur un même fichier. Même patron que
 * `reparerIncidentSheet`/`fusionnerDomaine07PersoVers08` (Maintenance.gs).
 *
 * CE QUE ÇA COÛTE, honnêtement (correction de revue — le commentaire précédent datait d'avant le
 * retrait du budget quotidien) : `TICK_MINUTES` vaut 5 et une boucle manuelle tient le verrou
 * jusqu'à ~4,5 min, donc pendant une SÉANCE de relances enchaînées c'est **quasiment chaque tick**
 * qui est sauté (`tryLock(5000)` échoue → retour immédiat) — pas « quelques ticks ». Le flux vivant
 * (PJ Gmail, dépôts, intentions, tri) est donc EN PAUSE pendant la séance ; rien n'est perdu, tout
 * est re-scanné ensuite. Pour que le chien de garde ne crie pas « moteur silencieux » à tort
 * (seuil 45 min) pendant une longue séance, les un-clic écrivent `DriveAI_LAST_MANUEL` —
 * `chienDeGarde` prend le PLUS RÉCENT des deux signaux de vie (cf. Main.gs).
 * @return {?Lock} le verrou tenu, ou null si indisponible (tick en cours — appelant doit sortir tôt).
 */
function acquerirVerrouReset_(nomFonction) {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(30 * 1000)) {
    journalInfo_('Reset', nomFonction + '() : tick en cours — réessaie dans une minute (jamais en même temps qu\'un tick).');
    return null;
  }
  return verrou;
}

/**
 * Un-clic lancé DEPUIS L'ÉDITEUR, jamais par un déclencheur : le drapeau `manuel` (ni gaté, ni
 * compté) ne vaut que HORS du quota des déclencheurs. Un handler de trigger reçoit un event object
 * (`e.triggerUid`) — une exécution d'éditeur, non. Garde de construction : si quelqu'un installait
 * un jour un déclencheur sur une de ces fonctions, elle refuserait de tourner plutôt que de
 * consommer le quota des déclencheurs en se croyant « hors quota » (angle mort relevé en revue).
 */
function estAppelParDeclencheur_(e) {
  return !!(e && e.triggerUid);
}

/**
 * Vrai si une ronde de boucle un-clic n'a RIEN produit (ni examen, ni déplacement) — l'appelant
 * s'arrête alors immédiatement. Sans cette sortie, `lancerResetPlacement` spinnait jusqu'au mur des
 * 4,5 min dans l'état STABLE « placement oisif mais tag impossible » (le placement ne fige son tag
 * qu'une fois le rassemblement terminé) : chaque ronde stérile relisait tout `PlanConsolidation`
 * (~2 900 lignes) et écrivait une ligne de Journal identique — des centaines pour rien (revue quota :
 * le retrait du budget quotidien a AGGRAVÉ ce spin, qui était coupé par lui avant). PURE.
 */
function rondeSterileReset_(r) {
  return !r || (!r.examines && !r.deplaces);
}

/**
 * Garde-temps d'UNE phase à l'intérieur d'une ronde UN-CLIC : elle reçoit au plus `1/phasesRestantes`
 * du temps qui reste avant le mur de l'exécution (`CONFIG.BUDGET_MS` depuis `debut`). Sans ce partage,
 * la première phase appelée consomme TOUT le mur dès que son plafond d'items est haut, et les phases
 * suivantes ne tournent jamais (revue #229 : `lancerResetTout` dégénérait en rassemblement seul).
 * Adaptatif : une phase qui n'a rien à faire rend sa part aux suivantes. La borne GLOBALE est toujours
 * respectée (le `||` ci-dessous), donc ce partage ne peut pas retarder le mur, seulement le découper.
 * @param {number} debut  horodatage du début de L'EXÉCUTION manuelle (pas de la phase)
 * @param {number} phasesRestantes  cette phase incluse (3, 2, puis 1)
 * @return {function():boolean}
 */
function gardePartReset_(debut, phasesRestantes, murMs) {
  var mur = murMs || CONFIG.BUDGET_MS; // le pilote CI (ADR-0032) passe un mur PLUS COURT
  var t0 = Date.now();
  var part = partPhaseReset_(mur - (t0 - debut), phasesRestantes);
  return function () {
    var maintenant = Date.now();
    return (maintenant - debut) > mur || (maintenant - t0) > part;
  };
}

/**
 * Part de temps allouée à UNE phase. PURE (c'est l'arithmétique du partage, isolée pour être
 * testable sans horloge). Plus rien à distribuer ⇒ 0, donc la phase est coupée immédiatement.
 * @param {number} restantMs  temps restant avant le mur de l'exécution
 * @param {number} phasesRestantes  cette phase incluse
 */
function partPhaseReset_(restantMs, phasesRestantes) {
  return restantMs > 0 ? restantMs / Math.max(1, phasesRestantes) : 0;
}

/**
 * Signal de VIE d'une exécution manuelle (revue quota) : une séance de relances enchaînées tient le
 * verrou et fait sauter presque tous les ticks — au-delà de `WATCHDOG_SEUIL_MS` (45 min), le chien de
 * garde verrait un heartbeat figé et déclarerait « moteur silencieux » À TORT (l'épisode remonterait
 * jusqu'au résumé hebdo). `chienDeGarde` prend donc le PLUS RÉCENT de `DriveAI_LAST_TICK` et de cette
 * Property. Jamais propagé : un échec d'écriture ne doit pas casser un run manuel réussi.
 */
function marquerVieManuelleReset_() {
  try { PropertiesService.getScriptProperties().setProperty('DriveAI_LAST_MANUEL', String(Date.now())); }
  catch (e) { /* best-effort : sans ça, au pire une fausse alerte watchdog */ }
}

/* ---------- PILOTE CI (ADR-0032) : le lancement n'est plus un geste de Marc ---------- */

/**
 * Le pilotage est TERMINÉ quand les 3 phases I/O ont posé leur tag ET que le reliquat LLM est
 * drainé. `resetTermine_()` seul ne suffit PAS (le drapeau `DriveAI_RESET_LLM` n'y entre pas, à
 * dessein : les campagnes suspendues reprennent dès la convergence I/O) — s'arrêter dessus
 * laisserait le reliquat au ralenti du tick, exactement la plainte de Marc « rien ne se passe ».
 * @return {boolean}
 */
function pilotageTermineReset_() {
  if (!resetTermine_()) return false;
  return PropertiesService.getScriptProperties().getProperty('DriveAI_RESET_LLM') === finPlacementReset_();
}

/**
 * Alerte « déclencheurs muets » — au plus 1×/h (une alerte qui se répète toutes les 15 min devient
 * du bruit, et le canal mail a ses propres quotas). C'est la contrepartie du refus de passe : le
 * pilote ne masque plus le gel (ancienne écriture de `DriveAI_LAST_MANUEL`), il le SIGNALE.
 */
function alerterGelPilote_(props, lastTick) {
  var derniere = Number(props.getProperty('DriveAI_PILOTE_ALERTE_GEL')) || 0;
  if (Date.now() - derniere < 60 * 60 * 1000) return;
  props.setProperty('DriveAI_PILOTE_ALERTE_GEL', String(Date.now()));
  var minutes = Math.round((Date.now() - lastTick) / 60000);
  notifierEchec_('Pilote', 'Aucun tick depuis ' + minutes + ' min : le flux vivant (mails, dépôts) est ' +
    'probablement à l\'arrêt. Les passes de rangement sont REFUSÉES tant que ça dure — si ça persiste, ' +
    'ré-examiner l\'hypothèse « web app hors quota des déclencheurs » (ADR-0032) et ré-exécuter installerTrigger.');
}

/**
 * Compte les passes CONSÉCUTIVES sans progrès et alerte une fois passé le seuil. Sans ça, un état
 * bloqué mais « non terminé » (précédent vécu : une racine devenue inaccessible ⇒ `complet` jamais
 * vrai ⇒ drapeau jamais posé) ferait tourner ~192 passes/jour de walks récursifs complets pour zéro
 * travail, indéfiniment, avec un workflow tout vert. PURE côté décision, l'état vit dans la Property.
 * @return {boolean} vrai si la stagnation est avérée (la CI arrête d'insister)
 */
function suivreSteriliteReset_(props, aProgresse) {
  if (aProgresse) { props.deleteProperty('DriveAI_PILOTE_STERILES'); return false; }
  var n = (Number(props.getProperty('DriveAI_PILOTE_STERILES')) || 0) + 1;
  props.setProperty('DriveAI_PILOTE_STERILES', String(n));
  if (n !== CONFIG.PILOTE_STERILES_MAX) return n > CONFIG.PILOTE_STERILES_MAX; // alerte UNE seule fois
  journalErreur_('Reset', n + ' passes pilotées consécutives sans aucun progrès — rangement BLOQUÉ (ni fini, ni avançant).');
  notifierEchec_('Pilote', n + ' passes de rangement consécutives n\'ont rien produit alors que le reset n\'est pas ' +
    'terminé : quelque chose bloque (dossier inaccessible ?). Le pilote se met en veille — voir l\'onglet Journal.');
  return true;
}

/**
 * UNE passe POUSSÉE par le pilote CI (ADR-0032) — le même travail que le clic `lancerResetTout` de
 * Marc, plus la passe LLM du reliquat, déclenché par GitHub Actions au lieu de sa main.
 *
 * ⚠️ LE PARI, ÉCRIT NOIR SUR BLANC (revue flotte C28-43) : ce montage suppose que le runtime d'une
 * exécution de WEB APP ne compte pas dans le quota « Triggers total runtime » (~90 min/j) dont le
 * dépassement gèle TOUS les déclencheurs, chien de garde inclus (C28-29). C'est un INDICE, pas une
 * mesure : le précédent C28-33 prouve seulement que les compteurs INTERNES de DriveAI bridaient à
 * tort le chemin manuel, et CLAUDE.md §6bis (#235) tient ce quota pour PARTAGÉ. D'où les trois
 * filets ci-dessous, qui rendent le pari SÛR même s'il est faux :
 *   1. `PILOTE_BUDGET_JOUR_MS` — borne du RAYON D'EXPLOSION en ms réelles persistées ;
 *   2. refus + alerte si les ticks sont silencieux — le pilote DÉTECTE le gel au lieu de le masquer
 *      (il ne pose SURTOUT PAS `DriveAI_LAST_MANUEL` : ça rendrait le chien de garde muet pendant
 *      toute la campagne — il n'en a pas besoin, la fenêtre de tick est garantie par la pause CI) ;
 *   3. ms consommées journalisées — sans mesure, l'hypothèse resterait invérifiable.
 *
 * Le travail est fait ICI, SYNCHRONEMENT dans le `doPost` : passer par `actionTickPonctuel_` (qui
 * CRÉE un déclencheur) consommerait le quota protégé (verrouillé par test).
 *
 * Contexte d'exécution web app ≠ tick (patron des actions du `doPost`, hier le chat à outils) :
 * `chargerPannePlateforme_()` + compteur d'usage PROPRE (`reinitialiserUsage_`/`flushUsage_`),
 * sans quoi le coût Anthropic de la passe ne serait JAMAIS comptabilisé et le frein §2.6
 * deviendrait aveugle sur le chemin dominant.
 * @return {{ok:boolean, termine:boolean, rondes:number, progres:boolean, message:string}}
 */
function pousserResetPilote_() {
  // Le reset piloté par la CI est du travail AUTOMATIQUE : sans ce marquage, tout son coût LLM
  // atterrirait sous `app:pousser-reset` (l'étiquette posée par `doPost`) — c'est-à-dire dans la
  // famille « demandes de Marc », alors que docs/COUTS.md enseigne exactement l'inverse. Ses
  // phases ne passent par aucun `etapeSuivie_`, d'où le marquage explicite (revue flotte C28-58).
  try { poserOperationCourante_('reset-pilote'); } catch (eOp) { }
  if (!CONFIG.PILOTE_ACTIF) return { ok: false, termine: false, rondes: 0, progres: false, message: 'pilote désactivé (CONFIG.PILOTE_ACTIF)' };
  if (!CONFIG.RESET_ACTIF) return { ok: false, termine: false, rondes: 0, progres: false, message: 'RESET_ACTIF est false' };
  if (pilotageTermineReset_()) return { ok: true, termine: true, rondes: 0, progres: false, message: 'reset terminé (I/O + reliquat LLM drainé)' };

  var props = PropertiesService.getScriptProperties();
  // FILET 2 — DÉTECTEUR DE GEL : si les déclencheurs sont muets depuis plus longtemps que le seuil
  // du chien de garde, on REFUSE la passe et on alerte (le mail ne dépend d'aucun déclencheur).
  // Deux raisons : ne pas alimenter un quota peut-être partagé au moment précis où il lâche, et
  // rendre VISIBLE le scénario que ce chantier redoute — le rangement qui avance pendant que le
  // flux vivant (Gmail, dépôts) est mort. `lastTick &&` : ne bloque pas une première installation.
  var lastTick = Number(props.getProperty('DriveAI_LAST_TICK')) || 0;
  if (lastTick && Date.now() - lastTick > CONFIG.WATCHDOG_SEUIL_MS) {
    alerterGelPilote_(props, lastTick);
    return { ok: true, termine: false, rondes: 0, progres: false, gel: true,
      message: 'ticks silencieux — passe REFUSÉE (le flux vivant prime sur le rangement)' };
  }
  // FILET 1 — budget QUOTIDIEN en ms réelles (patron des phases du reset). Il ne protège pas le
  // tick (autre compteur si le pari est bon) : il borne la CASSE si le pari est mauvais.
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_PILOTE_JOUR', aujourdhui);
  if (consommeJour >= CONFIG.PILOTE_BUDGET_JOUR_MS) {
    return { ok: true, termine: false, rondes: 0, progres: false,
      message: 'budget quotidien du pilote épuisé — repris demain' };
  }

  var debut = Date.now();
  var verrou = acquerirVerrouReset_('pousserResetPilote_');
  if (!verrou) return { ok: true, termine: false, rondes: 0, progres: false, message: 'tick en cours — passe sautée (jamais en parallèle)' };
  var rondes = 0, progres = false, echecs = 0;
  // Mur de CETTE passe : le plus petit du mur par passe et du reliquat quotidien.
  var murMs = Math.min(CONFIG.PILOTE_BUDGET_MS, CONFIG.PILOTE_BUDGET_JOUR_MS - consommeJour);
  // Documents du reliquat déjà TENTÉS dans CETTE exécution : sans cette mémoire, la boucle de
  // rondes re-présente le même fichier et `gererEchec_` brûle ses 3 essais en 2 min sur un blip
  // transitoire → quarantaine DÉFINITIVE et silencieuse (la dé-quarantaine auto ne couvre pas la
  // clé `tri33llm|`). C'est aussi ce qui rend vrai le plafond « RESET_LLM_MAX_PAR_RUN par passe ».
  var tentesLlm = {};
  // Même mémoire pour les échecs de MUTATION I/O (rassemblement/placement) : sans elle, un blip Drive
  // transitoire brûlerait ses 3 essais en secondes sur les rondes du pilote (leçon §7, revue Vague 1b).
  var tentesMut = {};
  chargerPannePlateforme_();
  reinitialiserUsage_();
  try {
    var murAtteint = function () { return Date.now() - debut > murMs; };
    // Ne JAMAIS démarrer un document LLM trop tard : un doc peut coûter OCR + 2 appels Sonnet avec
    // retry (~1-3 min) et le garde n'est évalué qu'AVANT de le prendre. Sans cette marge, la passe
    // dépasse le `--max-time` de la CI (réponse perdue, warning trompeur), voire le mur dur 6 min.
    var murDemarrageLlm = Math.max(0, murMs - CONFIG.PILOTE_MARGE_DOC_MS);
    var phase = function (fn, parts, murPhase) { // try/catch PAR phase (leçon « étape secondaire enveloppée »)
      if (Date.now() - debut > murPhase) return false;
      try { return !rondeSterileReset_(fn(gardePartReset_(debut, parts, murPhase))); }
      catch (e) { echecs++; journalErreur_('Reset', 'Phase pilotée différée : ' + e); return false; }
    };
    while (!murAtteint() && !pilotageTermineReset_() && rondes < 500) {
      var progresRonde = false;
      // Part de temps PAR PHASE (revue #229) : sans ça la première phase mange tout le mur et les
      // suivantes ne tournent jamais. 4 phases désormais — la passe LLM est la dernière servie.
      if (phase(function (g) { return rassemblerReset_(g, true, tentesMut); }, 4, murMs)) progresRonde = true;
      if (phase(function (g) { return placerReset_(g, true, tentesMut); }, 3, murMs)) progresRonde = true;
      if (phase(function (g) { return appliquerReset04Interne_(g, true); }, 2, murMs)) progresRonde = true;
      if (phase(function (g) { return analyserReliquatReset_(g, true, tentesLlm); }, 1, murDemarrageLlm)) progresRonde = true;
      rondes++;
      if (progresRonde) progres = true; else break; // aucune phase n'a rien à faire → inutile de re-scanner
    }
    journalInfo_('Reset', 'Pilote CI : ' + rondes + ' ronde(s), ' + (progres ? 'progrès' : 'rien à faire') +
      ', ' + Math.round((Date.now() - debut) / 1000) + ' s consommées (mesure du pari ADR-0032).');
  } catch (e) {
    journalErreur_('Reset', 'Passe pilotée interrompue : ' + e);
    // Message GÉNÉRIQUE : la réponse finit dans un log CI PUBLIC — le détail (noms de fichiers)
    // reste au Journal privé. `erreur` absent ⇒ la CI sait que c'est TRANSITOIRE, pas permanent.
    return { ok: false, termine: false, rondes: rondes, progres: progres, message: 'passe interrompue (détail au Journal)' };
  } finally {
    try { flushUsage_(); } catch (e2) { /* mesure de coût perdue pour cette passe — accepté */ }
    props.setProperty('DriveAI_PILOTE_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
    verrou.releaseLock();
  }
  var termine = pilotageTermineReset_();
  var stagnation = suivreSteriliteReset_(props, progres || termine);
  return {
    ok: true,
    termine: termine,
    rondes: rondes,
    progres: progres,
    echecs: echecs,
    stagnation: stagnation,
    message: progres ? 'passe poussée' : 'rien à faire sur cette passe'
  };
}

/**
 * UN-CLIC combiné : rassemblement PUIS placement PUIS 04 interne, en boucle, jusqu'au mur des 6 min
 * de CETTE exécution manuelle OU la fin du reset. Le moyen le plus rapide pour Marc de faire
 * progresser le reset sans attendre les ticks (chaque tick n'avance QUE d'une page/phase, budget-gaté
 * par le flux vivant). Relancer autant de fois que nécessaire (le Journal dit où ça en est) — chaque
 * appel est repris là où le précédent s'est arrêté (clés de convergence persistées). Les budgets
 * QUOTIDIENS ne s'appliquent PAS ici (cf. le bloc « manuel » plus haut) : ils protègent le quota des
 * DÉCLENCHEURS, dont une exécution d'éditeur ne fait pas partie.
 */
function lancerResetTout(e) {
  if (estAppelParDeclencheur_(e)) return; // jamais par un déclencheur (cf. estAppelParDeclencheur_)
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerResetTout() : RESET_ACTIF est false — rien à faire.'); return; }
  // `debut` AVANT le verrou (revue quota) : `tryLock` peut consommer 30 s — non comptées, elles
  // rognaient la marge sous le mur dur des 6 min.
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerResetTout');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var tentesMut = {}; // mémoire des échecs de mutation par exécution (leçon §7)
    var rondes = 0;
    while (!estBudgetDepasse() && !resetTermine_() && rondes < 500) {
      var progres = false;
      // ⚠ Garde PAR PHASE, pas seulement le mur global (revue #229) : avec des plafonds d'items
      // hauts, la PREMIÈRE phase consomme les 4,5 min entières et les deux suivantes ne sont JAMAIS
      // atteintes — le clic « tout faire » de Marc dégénérait en rassemblement seul et ne produisait
      // plus AUCUNE structure finale visible. Chaque phase reçoit au plus sa part de ce qui reste,
      // donc le round-robin tient quel que soit le plafond d'items.
      if (!estBudgetDepasse() && !rondeSterileReset_(rassemblerReset_(gardePartReset_(debut, 3), true, tentesMut))) progres = true;
      if (!estBudgetDepasse() && !rondeSterileReset_(placerReset_(gardePartReset_(debut, 2), true, tentesMut))) progres = true;
      if (!estBudgetDepasse() && !rondeSterileReset_(appliquerReset04Interne_(gardePartReset_(debut, 1), true))) progres = true;
      rondes++;
      if (!progres) break; // AUCUNE des 3 phases n'a rien à faire → inutile de re-scanner en boucle
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerResetTout() : ' + rondes + ' ronde(s) — ' +
      (resetTermine_() ? 'RESET TERMINÉ.' : 'relancer lancerResetTout() pour continuer.'));
  } catch (e2) {
    notifierEchec_('Reset', 'Reset manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}

/** UN-CLIC ciblé : rassemblement seul, en boucle jusqu'au mur des 6 min de cette exécution. */
function lancerResetRassemblement(e) {
  if (estAppelParDeclencheur_(e)) return;
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerResetRassemblement() : RESET_ACTIF est false — rien à faire.'); return; }
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerResetRassemblement');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var tentesMut = {}; // mémoire des échecs de mutation par exécution (leçon §7)
    var rondes = 0;
    while (!estBudgetDepasse() && rondes < 500) {
      var r = rassemblerReset_(estBudgetDepasse, true, tentesMut);
      rondes++;
      if (rondeSterileReset_(r)) break; // ronde stérile (ou phase terminée/inactive) → on sort
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerResetRassemblement() : ' + rondes + ' passe(s).');
  } catch (e2) {
    notifierEchec_('Reset', 'Rassemblement manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}

/** UN-CLIC ciblé : placement seul, en boucle jusqu'au mur des 6 min de cette exécution. */
function lancerResetPlacement(e) {
  if (estAppelParDeclencheur_(e)) return;
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerResetPlacement() : RESET_ACTIF est false — rien à faire.'); return; }
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerResetPlacement');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var tentesMut = {}; // mémoire des échecs de mutation par exécution (leçon §7)
    var rondes = 0;
    while (!estBudgetDepasse() && rondes < 500) {
      var r = placerReset_(estBudgetDepasse, true, tentesMut);
      rondes++;
      // ⚠ NE PAS remplacer par un test de tag : le placement ne fige son tag qu'APRÈS la fin du
      // rassemblement — l'état « oisif mais tag impossible » est stable et spinnait jusqu'au mur.
      if (rondeSterileReset_(r)) break;
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerResetPlacement() : ' + rondes + ' passe(s).');
  } catch (e2) {
    notifierEchec_('Reset', 'Placement manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}

/** UN-CLIC ciblé : réorganisation interne de 04 seule, en boucle jusqu'au mur des 6 min de cette exécution. */
function lancerReset04Interne(e) {
  if (estAppelParDeclencheur_(e)) return;
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerReset04Interne() : RESET_ACTIF est false — rien à faire.'); return; }
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerReset04Interne');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var rondes = 0;
    while (!estBudgetDepasse() && rondes < 500) {
      var r = appliquerReset04Interne_(estBudgetDepasse, true);
      rondes++;
      if (rondeSterileReset_(r)) break;
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerReset04Interne() : ' + rondes + ' passe(s).');
  } catch (e2) {
    notifierEchec_('Reset', '04 interne manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}
