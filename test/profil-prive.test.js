'use strict';
/**
 * Profil privé (tâche #515 / mission #497) : `CONFIG` ne porte que des identifiants FICTIFS, les vrais
 * vivent dans un fichier JSON du Drive du propriétaire (Script Property `DriveAI_PROFIL_ID`).
 * Ce que ces tests verrouillent : la superposition (pure), l'échec fermé, le cache des seuls succès,
 * l'absence de tout identifiant réel dans `CONFIG`, et le refus de tourner sans profil.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (x) => JSON.parse(JSON.stringify(x));

/**
 * Moteur chargé avec de faux Properties/Drive/Cache/Session. `fichiers` : fichiers que Drive renvoie
 * pour le nom du profil ({contenu, proprio, corbeille}) ; `contenu` seul = un fichier à moi.
 */
function moteur(opts) {
  opts = opts || {};
  const lectures = { drive: 0 };
  const cacheStore = Object.assign({}, opts.cache);
  const props = Object.assign({}, opts.props);
  const fichiers = opts.fichiers || (opts.contenu !== undefined && !props.DriveAI_PROFIL_ID ? [{ contenu: opts.contenu }] : []);
  const blob = (contenu) => ({ getBlob: () => ({ getDataAsString: () => { lectures.drive++; return contenu; } }) });
  const overrides = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    // `Session.getEffectiveUser` exigerait `userinfo.email` (absent) : le test le fait échouer s'il est rappelé.
    Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => { throw new Error('userinfo.email non autorisé'); } },
    DriveApp: {
      getRootFolder: () => ({ getOwner: () => ({ getEmail: () => 'Marc@Exemple.com' }) }),
      getFileById: () => {
        if (opts.erreurDrive) throw new Error(opts.erreurDrive);
        return blob(opts.contenu);
      },
      getFilesByName: (nom) => {
        const l = nom === 'driveai-profil-prive.json' ? fichiers : [];
        let i = 0;
        return { hasNext: () => i < l.length, next: () => {
          const f = l[i++];
          return Object.assign(blob(f.contenu), {
            isTrashed: () => !!f.corbeille,
            getOwner: () => (f.proprio === null ? null : { getEmail: () => f.proprio || 'marc@exemple.com' }),
          });
        } };
      },
    },
    CacheService: { getScriptCache: () => ({
      get: (k) => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = v; },
    }) },
  };
  return { c: load(['Config.gs'].concat(opts.avec || []), overrides), lectures, cacheStore };
}

/* ---------- la superposition (PURE) ---------- */

test('fusionnerProfil_ : superpose feuilles, objets imbriqués et tableaux ; ne touche à rien d\'autre', () => {
  const c = load(['Config.gs']);
  const cible = { a: 'x', b: { c: 'y', d: 'z' }, t: ['1', '2'], n: 3 };
  const r = c.fusionnerProfil_(cible, { b: { c: 'Y' }, t: ['9'], n: 4 }, '', { appliques: 0, ignores: [] });
  assert.deepStrictEqual(plain(cible), { a: 'x', b: { c: 'Y', d: 'z' }, t: ['9'], n: 4 });
  assert.strictEqual(r.appliques, 3);
  assert.deepStrictEqual(plain(r.ignores), []);
});

test('fusionnerProfil_ : une clé inconnue ou d\'un autre type est IGNORÉE et listée par son chemin', () => {
  const c = load(['Config.gs']);
  const cible = { a: 'x', b: { c: 'y' }, t: ['1'] };
  const r = c.fusionnerProfil_(cible, { inconnue: 'v', a: 5, b: 'pas un objet', t: 'pas un tableau', __proto__: { pirate: 1 } },
    '', { appliques: 0, ignores: [] });
  assert.deepStrictEqual(plain(cible), { a: 'x', b: { c: 'y' }, t: ['1'] }, 'rien n\'a changé');
  assert.deepStrictEqual(plain(r.ignores).sort(), ['a', 'b', 'inconnue', 't']);
  assert.strictEqual(r.appliques, 0);
  assert.strictEqual(({}).pirate, undefined, 'aucune pollution de prototype');
});

test('fusionnerProfil_ : `$remplace` remplace l\'objet en bloc (clés = identifiants), sans le marqueur', () => {
  const c = load(['Config.gs']);
  const cible = { epingles: { FICTIF_1: { cibleId: 'x' } } };
  c.fusionnerProfil_(cible, { epingles: { $remplace: true, 'ID_REEL_A': { cibleId: 'a' }, 'ID_REEL_B': { cibleId: 'b' } } },
    '', { appliques: 0, ignores: [] });
  assert.deepStrictEqual(plain(cible), { epingles: { ID_REEL_A: { cibleId: 'a' }, ID_REEL_B: { cibleId: 'b' } } });
  // Sans le marqueur, les clés inconnues sont ignorées : on ne fabrique pas des clés par accident.
  const c2 = { epingles: { FICTIF_1: { cibleId: 'x' } } };
  const r = c.fusionnerProfil_(c2, { epingles: { ID_REEL_A: { cibleId: 'a' } } }, '', { appliques: 0, ignores: [] });
  assert.deepStrictEqual(plain(c2), { epingles: { FICTIF_1: { cibleId: 'x' } } });
  assert.deepStrictEqual(plain(r.ignores), ['epingles.ID_REEL_A']);
});

/* ---------- la lecture (I/O) : échec fermé ---------- */

test('profil absent (ni propriété ni fichier du bon nom) : les valeurs fictives restent, l\'état le dit', () => {
  const { c, lectures } = moteur({});
  assert.strictEqual(c.etatProfilPrive_().etat, 'absent');
  assert.strictEqual(lectures.drive, 0, 'aucun candidat ⇒ aucune lecture');
  assert.strictEqual(c.CONFIG.DOSSIERS.A_TRIER, 'FICTIF_DOSSIERS_A_TRIER');
});

test('profil illisible (JSON cassé, fichier introuvable, pas un objet) : valeurs fictives, état « illisible », jamais d\'exception', () => {
  for (const o of [
    { props: { DriveAI_PROFIL_ID: 'F1' }, contenu: '{pas du json' },
    { props: { DriveAI_PROFIL_ID: 'F1' }, contenu: '[1,2]' },
    { props: { DriveAI_PROFIL_ID: 'F1' }, contenu: '{}', erreurDrive: 'No item with the given ID could be found' },
  ]) {
    const { c } = moteur(o);
    assert.strictEqual(c.etatProfilPrive_().etat, 'illisible', JSON.stringify(o));
    assert.strictEqual(c.CONFIG.DOSSIERS.A_TRIER, 'FICTIF_DOSSIERS_A_TRIER');
  }
});

test('profil lisible : superposé à CONFIG AU CHARGEMENT, état « ok », rapport sans valeur', () => {
  const profil = { PROFIL_VERSION: 6, DOSSIERS: { A_TRIER: 'REEL_A_TRIER' }, INCONNU: { x: 1 } };
  const { c } = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: JSON.stringify(profil) });
  const etat = plain(c.etatProfilPrive_());
  assert.strictEqual(etat.etat, 'ok');
  assert.strictEqual(etat.appliques, 2);
  assert.deepStrictEqual(etat.ignores, ['INCONNU']);
  assert.strictEqual(c.CONFIG.DOSSIERS.A_TRIER, 'REEL_A_TRIER');
  assert.strictEqual(c.CONFIG.DOSSIERS.A_VERIFIER, 'FICTIF_DOSSIERS_A_VERIFIER', 'le reste de CONFIG est intact');
  assert.ok(!JSON.stringify(etat).includes('REEL_A_TRIER'), 'l\'état n\'emporte jamais une valeur');
});

test('profil d\'une version trop ancienne : état « incomplet », valeurs appliquées mais le tick est SAUTÉ', () => {
  for (const profil of [{ DOSSIERS: { A_TRIER: 'R' } }, { PROFIL_VERSION: 1, DOSSIERS: { A_TRIER: 'R' } }, { PROFIL_VERSION: 2, DOSSIERS: { A_TRIER: 'R' } }, { PROFIL_VERSION: 3, DOSSIERS: { A_TRIER: 'R' } }, { PROFIL_VERSION: 4, DOSSIERS: { A_TRIER: 'R' } }, { PROFIL_VERSION: 5, DOSSIERS: { A_TRIER: 'R' } }]) {
    const { c } = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: JSON.stringify(profil) });
    const etat = plain(c.etatProfilPrive_());
    assert.strictEqual(etat.etat, 'incomplet', JSON.stringify(profil));
    assert.match(etat.raison, /exige la version 6/);
  }
  const journal = [];
  const { c } = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: '{"DOSSIERS":{"A_TRIER":"R"}}', avec: ['Main.gs'] });
  c.LockService = { getScriptLock: () => { throw new Error('le verrou ne doit pas être pris'); } };
  c.journalInfo_ = (src, msg) => journal.push(src + ' | ' + msg);
  c.tickDriveAI();
  assert.strictEqual(journal.length, 1);
  assert.match(journal[0], /Profil privé incomplet — tick sauté/);
});

test('sans propriété : le fichier est trouvé par son NOM, s\'il m\'appartient (casse du courriel ignorée)', () => {
  const { c } = moteur({ fichiers: [{ contenu: '{"PROFIL_VERSION":6,"DOSSIERS":{"A_TRIER":"R"}}', proprio: 'MARC@exemple.COM' }] });
  assert.strictEqual(c.etatProfilPrive_().etat, 'ok');
  assert.strictEqual(c.CONFIG.DOSSIERS.A_TRIER, 'R');
});

test('par le nom : un fichier du même nom d\'un TIERS, sans propriétaire connu ou à la corbeille est ignoré', () => {
  for (const f of [
    { contenu: '{"DOSSIERS":{"A_TRIER":"PIRATE"}}', proprio: 'autre@exemple.com' },
    { contenu: '{"DOSSIERS":{"A_TRIER":"PIRATE"}}', proprio: null },
    { contenu: '{"DOSSIERS":{"A_TRIER":"PIRATE"}}', corbeille: true },
  ]) {
    const { c } = moteur({ fichiers: [f] });
    assert.strictEqual(c.etatProfilPrive_().etat, 'absent', JSON.stringify(f));
    assert.strictEqual(c.CONFIG.DOSSIERS.A_TRIER, 'FICTIF_DOSSIERS_A_TRIER');
  }
});

test('par le nom : deux fichiers à moi ⇒ REFUS (« illisible »), jamais un choix au hasard', () => {
  const { c } = moteur({ fichiers: [{ contenu: '{}' }, { contenu: '{}' }] });
  const e = c.etatProfilPrive_();
  assert.strictEqual(e.etat, 'illisible');
  assert.match(e.raison, /2 fichiers/);
});

test('la propriété DriveAI_PROFIL_ID, si elle existe, passe avant la recherche par nom', () => {
  const { c } = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: '{"DOSSIERS":{"A_TRIER":"PAR_ID"}}',
    fichiers: [{ contenu: '{"DOSSIERS":{"A_TRIER":"PAR_NOM"}}' }] });
  assert.strictEqual(c.CONFIG.DOSSIERS.A_TRIER, 'PAR_ID');
});

test('cache : un SUCCÈS est mis en cache (une seule lecture Drive), un échec ne l\'est jamais', () => {
  const ok = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: '{"DOSSIERS":{"A_TRIER":"R"}}' });
  assert.strictEqual(ok.lectures.drive, 1);
  assert.ok(ok.cacheStore.DriveAI_PROFIL_PRIVE, 'succès mis en cache');
  const relu = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: 'ne sera pas lu', cache: ok.cacheStore });
  assert.strictEqual(relu.lectures.drive, 0, 'servi par le cache');
  assert.strictEqual(relu.c.CONFIG.DOSSIERS.A_TRIER, 'R');
  const ko = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: '{cassé' });
  assert.deepStrictEqual(plain(ko.cacheStore), {}, 'un refus ne se met JAMAIS en cache');
});

/* ---------- le dépôt ne porte aucune vraie valeur ---------- */

test('CONFIG par défaut : tout identifiant de dossier est un placeholder FICTIF_…, jamais un identifiant Drive', () => {
  const c = load(['Config.gs']);
  const trouves = [];
  (function marche(o, chemin) {
    if (Array.isArray(o)) o.forEach((x, i) => marche(x, chemin + '[' + i + ']'));
    else if (o && typeof o === 'object') Object.keys(o).forEach((k) => { verifie(k, chemin + '{clé}'); marche(o[k], chemin + '.' + k); });
    else verifie(o, chemin);
  })(c.CONFIG, 'CONFIG');
  function verifie(v, chemin) {
    // forme d'un identifiant Drive : 28 à 44 caractères, commence par 1, chiffres + minuscules + majuscules
    if (typeof v === 'string' && /^1[A-Za-z0-9_-]{27,43}$/.test(v) && /\d/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v)) trouves.push(chemin);
  }
  assert.deepStrictEqual(trouves, [], 'identifiant Drive réel dans CONFIG (chemins) : le déplacer dans le profil privé');
});

/* ---------- le moteur refuse de tourner sans profil, et le dit ---------- */

test('tickDriveAI : sans profil privé, le tick est SAUTÉ et journalisé ; rien n\'est touché', () => {
  const journal = [];
  const c = load(['Config.gs', 'Main.gs'], {
    LockService: { getScriptLock: () => { throw new Error('le verrou ne doit pas être pris'); } },
  });
  c.journalInfo_ = (src, msg) => journal.push(src + ' | ' + msg);
  c.tickDriveAI();
  assert.strictEqual(journal.length, 1);
  assert.match(journal[0], /Profil privé absent|Profil privé illisible/);
});

/* ---------- la finance du propriétaire (banques, assureurs) : tâche #578 ---------- */

test('finance : le profil remplace banques et assureurs, et le routage suit (Reset.gs lit CONFIG, jamais un nom en dur)', () => {
  const profil = {
    PROFIL_VERSION: 6,
    MISSIONS_ASSUREURS: [{ bucket: 'Assureur Zed', jetons: ['zedassur'] }],
    PARCOURS: { finance: {
      banques: [{ dossier: 'Banque Zed', jetons: ['zedbank', 'credit zed'] }, { dossier: 'Caisse Yod', jetons: ['yod'] }],
      banquesFrance: ['banque etrangere'],
      assureurContrats: { dossier: 'Mutuelle Zed', jetons: ['mutzed'] },
      assureursAuto: ['autozed'], assureursVoyage: ['voyzed'],
    } },
  };
  const { c } = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: JSON.stringify(profil), avec: ['Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs'] });
  assert.strictEqual(c.etatProfilPrive_().etat, 'ok');
  const t = plain(c.structureCibleReset_());
  assert.deepStrictEqual(Object.keys(t['02 · Finances']['Banques']),
    ['Banque Zed', 'Caisse Yod', 'Autres'], 'les dossiers de banque viennent du profil');
  assert.ok('Assurance habitation' in t['03 · Logement & véhicule']['Logement']['Anciens logements'] === false);
  const d = (domaine, nom) => c.cheminCibleReset_(domaine, nom);
  assert.strictEqual(d('02 · Finances', '2024-03_Relevé_ZedBank.pdf'), 'Relevés/2024', 'un relevé suit le TYPE avant la banque');
  assert.strictEqual(d('02 · Finances', '2013-04_Courrier_Credit Zed.pdf'), 'Banques/Banque Zed', 'deux graphies, même banque');
  assert.strictEqual(d('02 · Finances', '2013-04_Courrier_Yod.pdf'), 'Banques/Caisse Yod');
  assert.strictEqual(d('02 · Finances', '2013-04_Courrier_Banque Etrangere.pdf'), 'Banques/Autres');
  assert.strictEqual(d('09 · Voyages', '2024-08-01_Contrat d\'assurance_VoyZed.pdf'), 'Assurances voyage');
});

test('finance : sans profil, les valeurs par défaut sont FICTIVES (aucun nom réel dans CONFIG)', () => {
  const c = load(['Config.gs']);
  const f = plain(c.CONFIG.PARCOURS.finance);
  assert.ok(f.banques.length >= 2 && f.banques.every((b) => b.dossier && b.jetons.length));
  assert.ok(f.assureurContrats.dossier && f.assureurContrats.jetons.length);
  assert.ok(c.CONFIG.MISSIONS_ASSUREURS.length >= 2);
});

/* ---------- les fournisseurs d'énergie et de téléphone du propriétaire : tâche #587 ---------- */

test('fournisseurs : le profil v6 remplace énergie, énergie historique et télécom, et le routage suit (Reset.gs lit CONFIG, jamais un nom en dur)', () => {
  const profil = {
    PROFIL_VERSION: 6,
    MISSIONS_FOURNISSEURS_ENERGIE: [{ bucket: 'Hydro-Québec', jetons: ['hydro'] }, { bucket: 'Courant Zed', jetons: ['zedcourant'] }],
    MISSIONS_ANNEES02_DOMAINES: [{ domaine: '01 · Administratif & identité', jetons: ['zedtel'], motifs: [], exclusions: ['zedtel avion'] }],
    PARCOURS: { fournisseurs: {
      energieContrats: { dossier: 'Courant Zed', jetons: ['zedcourant'] },
      energieAnciens: { dossier: 'Ancien Zed', jetons: ['zedancien'] },
      telecom: { dossier: 'Zed Mobile', jetons: ['zedtel'] },
    } },
  };
  const { c } = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: JSON.stringify(profil), avec: ['Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs'] });
  assert.strictEqual(c.etatProfilPrive_().etat, 'ok');
  const d = (domaine, nom) => c.cheminCibleReset_(domaine, nom);
  assert.strictEqual(d('01 · Administratif & identité', '2024-02-01_Contrat_ZedCourant.pdf'), 'Attestations & contrats');
  assert.strictEqual(d('01 · Administratif & identité', '2024-02-01_Contrat_ZedTel.pdf'), 'Attestations & contrats');
  assert.strictEqual(d('01 · Administratif & identité', '2024-02-01_Contrat_ZedAncien.pdf'), 'Attestations & contrats');
  assert.strictEqual(d('01 · Administratif & identité', '2024-02-01_Billet_ZedTel Avion.pdf'), null,
    'l\'exclusion du profil (marque ombrelle) est lue par le flux');
});

test('fournisseurs : sans profil, les valeurs par défaut sont FICTIVES (aucun nom réel dans CONFIG)', () => {
  const c = load(['Config.gs']);
  const f = plain(c.CONFIG.PARCOURS.fournisseurs);
  assert.ok(f.energieContrats.dossier && f.energieContrats.jetons.length);
  assert.ok(f.telecom.dossier && f.telecom.jetons.length);
  assert.ok(f.energieAnciens.dossier && f.energieAnciens.jetons.length);
  assert.ok(c.CONFIG.MISSIONS_FOURNISSEURS_ENERGIE.length >= 2);
});

/* ---------- règles du reset, marques et lexique du propriétaire : tâche #468 (version 6) ---------- */

test('version 6 : le profil remplace les règles du reset, les marques de véhicule et le lexique, et le code les LIT (aucun nom en dur)', () => {
  const profil = {
    PROFIL_VERSION: 6,
    PARCOURS: {
      lexiqueEntites: ['zedmot'],
      vehicules: { marques: ['zedmarque'], alias: { $remplace: true, zedlong: 'ZL' }, cibleIsole: 'Zed Modele' },
      reset: {
        fournisseurAutre: { dossier: 'Fourn Zed', jetons: ['fournzed'] },
        projetPerso: { dossier: 'Projet Zed', motifs: ['projet zed'] },
        santeEtrangere: ['regime zed'],
        feuilletsFiscaux: ['zedform'],
        courtiers: ['zedcourtier'],
        hopitaux: ['hopzed'],
        voyagesSupp: [{ dossier: 'Finlande', motifs: ['zedferry'] }],
      },
    },
  };
  const { c } = moteur({ props: { DriveAI_PROFIL_ID: 'F1' }, contenu: JSON.stringify(profil), avec: ['Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs'] });
  assert.strictEqual(c.etatProfilPrive_().etat, 'ok');
  const t = plain(c.structureCibleReset_());
  assert.deepStrictEqual(Object.keys(t['08 · Perso & projets']['Projets']), ['DriveAI', 'Projet Zed', 'Autres'], 'le projet du profil prend la place fixe, ordre conservé');
  const d = (domaine, nom) => c.cheminCibleReset_(domaine, nom);
  assert.strictEqual(d('01 · Administratif & identité', '2024-02-01_Contrat_FournZed.pdf'), 'Attestations & contrats');
  assert.strictEqual(d('08 · Perso & projets', '2024-02-01_Note_Projet Zed.pdf'), 'Projets/Projet Zed');
  assert.strictEqual(d('07 · Santé', '2024-02-01_Attestation_Regime Zed.pdf'), 'Assurances santé');
  assert.strictEqual(d('09 · Voyages', '2024-02-01_Billet_ZedFerry.pdf'), 'Par voyage/Finlande');
  assert.strictEqual(d('02 · Finances', '2024-02-01_Avenant_ZedCourtier.pdf'), 'Placements & crypto');
  assert.strictEqual(d('02 · Finances', '2024-02-01_Avenant_NZedCourtierBank.pdf'), null, 'MOT ENTIER : un nom qui CONTIENT le courtier ne matche pas');
  assert.strictEqual(c.estMotifVehicule_('ZedMarque Modele'), true);
  assert.strictEqual(c.estMotifVehicule_('Ford Modela'), false, 'la liste du profil REMPLACE celle par défaut');
  assert.strictEqual(c.canoniserVehicule_('ZedLong Modele 2020'), 'ZL Modele');
  assert.strictEqual(c.estEntiteGenerique_('Zedmot'), true, 'le lexique du propriétaire s\'ajoute au lexique fixe');
});

test('version 6 : sans profil, aucun nom réel dans les nouveaux blocs et la cible isolée est un véhicule déclaré', () => {
  const c = load(['Config.gs']);
  const p = plain(c.CONFIG.PARCOURS);
  assert.ok(p.vehicules.marques.length > 10 && p.vehicules.cibleIsole);
  assert.ok(c.CONFIG.MISSIONS_VEHICULES.some((v) => v.nom === p.vehicules.cibleIsole), 'tripwire : cibleIsole ∈ MISSIONS_VEHICULES');
  Object.keys(p.reset).forEach((k) => assert.ok(p.reset[k] && (Array.isArray(p.reset[k]) ? p.reset[k].length : true), 'reset.' + k + ' défini'));
});

test('Config.gs Tiers 5 : cache.put qui lève ignoré proprement, typeProfil_(null), proprio vide et domainesAutorises_', () => {
  const { iter } = require('./harness');
  const c = load(['Config.gs'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    DriveApp: {
      getRootFolder: () => ({ getOwner: () => ({ getEmail: () => '' }) }),
      getFilesByName: () => iter([{
        isTrashed: () => false,
        getOwner: () => ({ getEmail: () => 'marc@exemple.test' }),
        getBlob: () => ({ getDataAsString: () => '{"PROFIL_VERSION":6}' }),
      }]),
    },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => { throw new Error('cache plein'); },
      }),
    },
  });
  assert.strictEqual(c.typeProfil_(null), 'nul');
  assert.strictEqual(c.etatProfilPrive_().etat, 'absent', 'courriel propriétaire racine vide → refus fermé');
  c.CONFIG.DOMAINES_AUTO = ['10 · Domaine Auto'];
  assert.ok(c.domainesAutorises_().includes('10 · Domaine Auto'));
  c.CONFIG.DOMAINES_AUTO = null;
  assert.ok(Array.isArray(c.domainesAutorises_()));

  // cache.put qui lève sur lecture réussie par ID → état 'ok' quand même (erreur non-objet attrapée aussi).
  const cPut = load(['Config.gs'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'DriveAI_PROFIL_ID' ? 'ID1' : null) }) },
    DriveApp: {
      getFileById: () => ({ getBlob: () => ({ getDataAsString: () => '{"PROFIL_VERSION":6}' }) }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: () => null,
        put: () => { throw new Error('valeur trop grande'); },
      }),
    },
  });
  assert.strictEqual(cPut.etatProfilPrive_().etat, 'ok');
});
