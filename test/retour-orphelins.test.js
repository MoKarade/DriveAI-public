'use strict';
/**
 * retour-orphelins.test.js — retour des orphelins de `_Doublons` (#468 point 2, ADR-0047 §8).
 *
 * Verrouille : la décision PURE (qui bouge, qui reste), l'orchestration (balayage de re-vérification
 * COMPLET ou rien ; un lot par tick ; fin posée une fois tout inscrit) et l'invariant NON NÉGOCIABLE :
 * aucune suppression, jamais.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { load } = require('./harness');

const RAPPORT_ENTETE = ['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté'];

function ctxPur() { return load(['Config.gs', 'Doublons.gs', 'RetourOrphelins.gs']); }

/* ---------- PURES ---------- */

test('orphelinsDuRapport_ : ne garde que les « orphelin » avec id ET empreinte — jamais de devinette', () => {
  const c = ctxPur();
  const res = c.orphelinsDuRapport_([
    ['a.pdf', 'F1', 'AAA', 'orphelin', 'x', ''],
    ['b.pdf', 'F2', 'BBB', 'confirmé', 'x', ''],
    ['c.pdf', 'F3', 'CCC', 'indéterminé', 'x', ''],
    ['d.pdf', 'F4', '', 'orphelin', 'x', ''],     // sans empreinte : pas de preuve à re-vérifier
    ['e.pdf', '', 'EEE', 'orphelin', 'x', ''],    // sans id : on ne sait pas quoi déplacer
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res)), [{ nom: 'a.pdf', id: 'F1', empreinte: 'AAA' }]);
});

test('decisionRetourOrphelin_ : seul exemplaire, seul dans `_Doublons`, empreinte inchangée ⇒ agir', () => {
  const c = ctxPur();
  const o = { id: 'F1', empreinte: 'AAA' };
  const base = { parents: ['DBL'], md5: 'AAA', doublonsId: 'DBL', jumeaux: {}, dejaRetournes: {} };
  assert.strictEqual(c.decisionRetourOrphelin_(o, base).agir, true);
});

test('decisionRetourOrphelin_ : chaque raison de NE PAS bouger, et lesquelles sont définitives', () => {
  const c = ctxPur();
  const o = { id: 'F1', empreinte: 'AAA' };
  const base = { parents: ['DBL'], md5: 'AAA', doublonsId: 'DBL', jumeaux: {}, dejaRetournes: {} };
  const avec = (patch) => c.decisionRetourOrphelin_(o, Object.assign({}, base, patch));

  let d = avec({ parents: null });
  assert.deepStrictEqual([d.agir, d.definitif], [false, false], 'illisible : on réessaie, on n\'inscrit rien');
  d = avec({ parents: ['DBL', 'DOM02'] });
  assert.deepStrictEqual([d.agir, d.definitif], [false, true], 'rattaché ailleurs');
  d = avec({ parents: ['DOM02'] });
  assert.deepStrictEqual([d.agir, d.definitif], [false, true], 'déjà sorti de `_Doublons`');
  d = avec({ md5: '' });
  assert.deepStrictEqual([d.agir, d.definitif], [false, false], 'empreinte courante inconnue : on réessaie');
  d = avec({ md5: 'ZZZ' });
  assert.deepStrictEqual([d.agir, d.definitif], [false, true], 'contenu modifié depuis le rapport');
  d = avec({ jumeaux: { AAA: 'G9' } });
  assert.deepStrictEqual([d.agir, d.definitif], [false, true], 'un exemplaire classé existe : vrai doublon');
  assert.ok(/G9/.test(d.raison), 'la raison NOMME le jumeau');
  d = avec({ dejaRetournes: { AAA: 'F0' } });
  assert.deepStrictEqual([d.agir, d.definitif], [false, true], 'même contenu qu\'un orphelin déjà rendu');
});

test('lotRetourOrphelins_ : saute les inscrits, plafonne le lot, compte le reste', () => {
  const c = ctxPur();
  const orphelins = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  const inscrits = { 'retour-orphelin|B': true };
  const r = c.lotRetourOrphelins_(orphelins, (k) => inscrits[k] === true, 2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.lot)), [{ id: 'A' }, { id: 'C' }]);
  assert.strictEqual(r.restants, 3);
});

/* ---------- ORCHESTRATION ---------- */

function faireOnglet(lignes) {
  const data = [RAPPORT_ENTETE.slice()].concat(lignes);
  return {
    getLastRow: () => data.length,
    getRange: (ligne, col, nb, larg) => ({
      getValues: () => data.slice(ligne - 1, ligne - 1 + nb).map((r) => r.slice(col - 1, col - 1 + larg)),
      setValues: () => {},
    }),
  };
}

/**
 * @param {Object} o
 *   orphelins : [{id, nom, empreinte, md5?, parents?}]  (md5 courant et parents par défaut = ceux du rapport)
 *   survivants : fichiers rendus par le balayage [{id, md5Checksum, parents}]
 *   pagesEnErreur : le balayage répond 500
 *   garde : fonction de budget
 */
function ctxOrch(o) {
  const store = Object.assign({ DriveAI_DOUBLONS_ID: 'DBL' }, o.props);
  const P = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
  };
  const index = {};
  const appels = [];     // appels à traiterDocument_
  const deplacements = [];
  const logs = [];
  const fichiers = {};
  o.orphelins.forEach((f) => { fichiers[f.id] = f; });
  const lignes = o.orphelins.map((f) => [f.nom, f.id, f.empreinte, 'orphelin', 'aucun exemplaire', '']);
  const onglet = faireOnglet(lignes);
  const c = load(['Config.gs', 'Doublons.gs', 'RetourOrphelins.gs'], {
    PropertiesService: { getScriptProperties: () => P },
    dateGmail_: () => '2026/10/19',
    journalInfo_: (s, m) => logs.push(['INFO', s, m]),
    journalErreur_: (s, m) => logs.push(['ERREUR', s, m]),
    tronquer_: (s) => String(s),
    jetonDrive_: () => 'jeton',
    estPannePlateforme_: () => false,
    feuille_: () => onglet,
    indexContient_: (k) => index[k] === true,
    indexAjouter_: (k, res) => { index[k] = true; logs.push(['INDEX', k, res.statut]); },
    DriveApp: {
      getFolderById: (id) => ({ getId: () => id }),
      getFileById: (id) => {
        const f = fichiers[id];
        if (!f) throw new Error('introuvable ' + id);
        return {
          getName: () => f.nom,
          getSize: () => 1234,
          getLastUpdated: () => new Date('2026-01-02T00:00:00Z'),
          getBlob: () => ({ id }),
          getParents: () => {
            const ps = f.parents || ['DBL'];
            let i = 0;
            return { hasNext: () => i < ps.length, next: () => ({ getId: () => ps[i++] }) };
          },
        };
      },
    },
    fetchDriveAvecRetry_: (url) => {
      const m = /\/files\/([^?]+)\?fields=md5Checksum/.exec(url);
      if (m) {
        const f = fichiers[m[1]];
        return { getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ md5Checksum: f ? (f.md5 !== undefined ? f.md5 : f.empreinte) : '' }) };
      }
      if (o.pagesEnErreur) return { getResponseCode: () => 500, getContentText: () => 'panne' };
      return { getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ files: o.survivants || [] }) };
    },
    deplacerEtRenommer_: (id, vers, depuis, nom) => { deplacements.push({ id, vers, depuis, nom }); return true; },
    traiterDocument_: (src) => {
      appels.push(src);
      const idDest = src.placer('DOM02', '2026-01-02_Type_Emetteur.pdf');
      if (idDest) index[src.cle] = true;
    },
  });
  return { c, store, index, appels, deplacements, logs };
}

const ORPH = (id, empreinte, extra) => Object.assign({ id, nom: id + '.pdf', empreinte }, extra);

test('retournerOrphelinsDoublons_ : un orphelin sans jumeau passe au pipeline (ignorerDoublon) et SORT de `_Doublons`', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA')] });
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 1);
  // DriveAI#898 : le descripteur porte le fileId et le md5 déjà lu par REST (aucun second files.get, aucun blob).
  assert.strictEqual(t.appels[0].fileId, 'F1');
  assert.strictEqual(JSON.stringify(t.appels[0].metaRest), JSON.stringify({ taille: 1234, md5: 'aaa' }));
  const p = load(['Config.gs', 'Pipeline.gs']);
  let rest = 0, blobs = 0;
  p.metaFichierRest_ = () => { rest++; return null; };
  const m = p.metaDoublon_(Object.assign({}, t.appels[0], { taille: 60 * 1024 * 1024, blob: () => { blobs++; return {}; } }));
  assert.strictEqual(m.origine, 'rest');
  assert.strictEqual(m.empreinte, 'aaa');
  assert.strictEqual(rest + blobs, 0, 'gros fichier : ni second files.get ni téléchargement');
  assert.strictEqual(t.appels[0].cle, 'retour-orphelin|F1');
  assert.strictEqual(t.appels[0].ignorerDoublon, true, 'sans ce bypass il repartirait dans `_Doublons`');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.deplacements)),
    [{ id: 'F1', vers: 'DOM02', depuis: 'DBL', nom: '2026-01-02_Type_Emetteur.pdf' }]);
});

test('re-vérification à l\'acte : un exemplaire classé a APPARU depuis le rapport ⇒ on ne déplace RIEN', () => {
  const t = ctxOrch({
    orphelins: [ORPH('F1', 'AAA')],
    survivants: [{ id: 'G1', md5Checksum: 'AAA', parents: ['DOM02'] }],
  });
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 0);
  assert.strictEqual(t.deplacements.length, 0);
  assert.strictEqual(t.index['retour-orphelin|F1'], true, 'inscrit « écarté » pour converger');
  assert.ok(t.logs.some((l) => l[0] === 'INFO' && /G1/.test(l[2])), 'le journal NOMME le jumeau trouvé');
});

test('un jumeau qui n\'est que dans `00 · À trier` ne compte pas (zone d\'attente) — l\'orphelin revient', () => {
  const aTrier = load(['Config.gs']).CONFIG.DOSSIERS.A_TRIER;
  const t = ctxOrch({
    orphelins: [ORPH('F1', 'AAA')],
    survivants: [{ id: 'G1', md5Checksum: 'AAA', parents: [aTrier] }],
  });
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 1);
});

test('une page du balayage en ERREUR ⇒ aucun déplacement, rien d\'inscrit (jamais un Drive à moitié lu)', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA')], pagesEnErreur: true });
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 0);
  assert.strictEqual(t.deplacements.length, 0);
  assert.deepStrictEqual(Object.keys(t.index), []);
  assert.ok(t.logs.some((l) => l[0] === 'ERREUR' && /aucun orphelin déplacé/.test(l[2])));
});

test('budget épuisé AVANT la fin du balayage ⇒ aucun déplacement (balayage complet ou rien)', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA')] });
  let appelsGarde = 0;
  // 1er appel (avant le balayage) : ok ; 2e (dans le balayage) : coupé.
  t.c.retournerOrphelinsDoublons_(() => ++appelsGarde > 1);
  assert.strictEqual(t.appels.length, 0);
  assert.strictEqual(t.deplacements.length, 0);
});

test('contenu modifié depuis le rapport (md5 courant ≠ empreinte) ⇒ écarté, pas déplacé', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA', { md5: 'ZZZ' })] });
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 0);
  assert.strictEqual(t.index['retour-orphelin|F1'], true);
});

test('fichier introuvable ⇒ journalisé et RÉESSAYÉ (rien d\'inscrit), jamais avalé', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA')] });
  t.c.DriveApp.getFileById = () => { throw new Error('introuvable'); };
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 0);
  assert.deepStrictEqual(Object.keys(t.index), []);
  assert.ok(t.logs.some((l) => l[0] === 'ERREUR' && /illisible/.test(l[2])));
});

test('deux orphelins de MÊME contenu : un seul est rendu, l\'autre reste (c\'est un vrai doublon)', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA'), ORPH('F2', 'AAA')] });
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 1);
  assert.strictEqual(t.appels[0].cle, 'retour-orphelin|F1');
  assert.strictEqual(t.index['retour-orphelin|F2'], true, 'F2 inscrit écarté');
});

test('un lot par tick : le plafond est respecté, et la fin n\'est posée qu\'une fois TOUT inscrit', () => {
  const orph = [1, 2, 3, 4, 5, 6, 7].map((n) => ORPH('F' + n, 'H' + n));
  const t = ctxOrch({ orphelins: orph });
  t.c.CONFIG.RETOUR_ORPHELINS_LOT = 3;
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 3);
  assert.strictEqual(t.store.DriveAI_RETOUR_ORPHELINS, undefined);
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 6);
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 7);
  assert.strictEqual(t.store.DriveAI_RETOUR_ORPHELINS, undefined, 'tout est traité mais la fin se constate au tick suivant');
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.store.DriveAI_RETOUR_ORPHELINS, '2026/10/19');
  const avant = t.appels.length;
  t.c.retournerOrphelinsDoublons_(() => false); // court-circuit terminal
  assert.strictEqual(t.appels.length, avant);
});

test('idempotence : un orphelin déjà inscrit à l\'Index n\'est jamais repassé au pipeline', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA'), ORPH('F2', 'BBB')] });
  t.index['retour-orphelin|F1'] = true;
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.deepStrictEqual(t.appels.map((a) => a.cle), ['retour-orphelin|F2']);
});

test('interrupteur CONFIG éteint ⇒ no-op TOTAL (aucune lecture, aucun appel)', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA')] });
  t.c.CONFIG.RETOUR_ORPHELINS_ACTIF = false;
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 0);
  assert.strictEqual(t.logs.length, 0);
});

test('une panne de plateforme (crédit LLM) coupe le lot : rien n\'est inscrit, tout reprend au rétablissement', () => {
  const t = ctxOrch({ orphelins: [ORPH('F1', 'AAA')] });
  t.c.estPannePlateforme_ = () => true;
  t.c.retournerOrphelinsDoublons_(() => false);
  assert.strictEqual(t.appels.length, 0);
  assert.deepStrictEqual(Object.keys(t.index), []);
});

/* ---------- INVARIANTS STRUCTURELS ---------- */

function codeSansCommentaires(fichier) {
  const brut = fs.readFileSync(require.resolve(fichier), 'utf8');
  return brut.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}

test('INVARIANT : RetourOrphelins.gs ne SUPPRIME rien — ni corbeille, ni suppression, ni partage', () => {
  const src = codeSansCommentaires('../src/RetourOrphelins.gs');
  [/setTrashed\s*\(/, /removeFile\s*\(/, /\.setName\s*\(/, /\.moveTo\s*\(/, /trashed"?\s*:\s*true/i,
    /method\s*:\s*['"](delete|post)['"]/i, /createFolder\s*\(/, /createFile\s*\(/, /makeCopy\s*\(/,
    /setSharing\s*\(/, /addEditor\s*\(/, /addViewer\s*\(/, /dossierDoublons_\s*\(/,
  ].forEach((re) => assert.ok(!re.test(src), 'interdit dans RetourOrphelins.gs : ' + re));
  // Le SEUL verbe REST d'écriture autorisé passe par la délégation de déplacement existante.
  assert.ok(/deplacerEtRenommer_\s*\(/.test(src));
});

test('INVARIANT : le pipeline est appelé avec ignorerDoublon: true (anti aller-retour vers `_Doublons`)', () => {
  const src = codeSansCommentaires('../src/RetourOrphelins.gs');
  assert.ok(/ignorerDoublon\s*:\s*true/.test(src));
});

test('câblage : le tick appelle retournerOrphelinsDoublons_ sous gates + try/catch (une panne ne bloque rien)', () => {
  const src = codeSansCommentaires('../src/Main.gs');
  const i = src.indexOf('retournerOrphelinsDoublons_(');
  assert.ok(i > 0, 'le tick appelle l\'étape');
  const avant = src.slice(Math.max(0, i - 300), i);
  assert.ok(/CONFIG\.RETOUR_ORPHELINS_ACTIF/.test(avant) && /gFreinCampagnes\(\)/.test(avant));
  const apres = src.slice(i, i + 300);
  assert.ok(/catch \(e\)/.test(apres) && /journalErreur_\('RetourOrphelins'/.test(apres));
});

/* ---------- LIGNE DE SANTÉ ---------- */

test('suffixeSanteRetourOrphelins_ : en cours / terminé / arrêté / muet, sans jamais inventer un compte', () => {
  const c = ctxPur();
  const zero = { rendus: 0, ecartes: 0 };
  assert.match(c.suffixeSanteRetourOrphelins_(true, '', zero), /en cours \(0 remis en circulation, 0 écartés/);
  assert.match(c.suffixeSanteRetourOrphelins_(true, '2026/10/19', { rendus: 17, ecartes: 2 }),
    /terminé ✅ le 2026\/10\/19 \(17 remis en circulation, 2 écartés/);
  assert.strictEqual(c.suffixeSanteRetourOrphelins_(false, '', zero), '', 'éteint et rien fait : rien à dire');
  assert.match(c.suffixeSanteRetourOrphelins_(false, '', { rendus: 5, ecartes: 0 }), /arrêté \(CONFIG\) — 5 remis/);
});

test('compte du retour des orphelins : cumul d\'un lot à l\'autre, et un compteur illisible repart de 0', () => {
  const c = ctxPur();
  const mem = {};
  const props = { getProperty: (k) => (k in mem ? mem[k] : null), setProperty: (k, v) => { mem[k] = v; } };
  c.cumulerCompteRetourOrphelins_(props, 5, 0);
  c.cumulerCompteRetourOrphelins_(props, 4, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.lireCompteRetourOrphelins_(props))), { rendus: 9, ecartes: 1 });
  mem.DriveAI_RETOUR_ORPHELINS_COMPTE = '{pas du json';
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.lireCompteRetourOrphelins_(props))), { rendus: 0, ecartes: 0 });
});

test('texteSanteDoublons_ porte le suffixe du retour des orphelins', () => {
  const mem = { DriveAI_DOUBLONS_PHASE: 'fini', DriveAI_DOUBLONS_BILAN: JSON.stringify({ total: 3, confirmes: 2, orphelins: 1, indetermines: 0, le: '2026/08/22' }) };
  const c = load(['Config.gs', 'Doublons.gs', 'RetourOrphelins.gs'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in mem ? mem[k] : null), setProperty: (k, v) => { mem[k] = v; } }) }
  });
  const ligne = c.texteSanteDoublons_();
  assert.match(ligne, /terminée ✅ le 2026\/08\/22/);
  assert.match(ligne, /retour des orphelins : en cours/);
});
