'use strict';
/**
 * Verrou des fixtures de noms de fichiers (tâche MoKarade/DriveAI#479) : aucun nom réel du Drive
 * dans git, et le chemin pour refaire un corpus fictif est un SCRIPT rejouable, pas du travail à la main.
 *
 * Deux protections complémentaires du verrou « données personnelles » (`pii-guard.test.js`, qui ne
 * reconnaît que des formes et des mots connus) :
 *   1. un ratchet STRUCTUREL : chaque nom des fixtures a la forme que produit
 *      `scripts/anonymiser-corpus.js` (émetteur `Émetteur fictif NNN`, dossier `… fictif …`) ou figure
 *      dans `noms-libres-autorises.json`. Un vrai nom qui réapparaît n'a pas cette forme : le test
 *      échoue SANS avoir besoin de le connaître d'avance ;
 *   2. le script lui-même, testé sur une entrée inventée ici.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  pseudonymiserCorpus, estDansLeDepot, FORME_NOM, EMETTEUR_FICTIF, DOSSIER_FICTIF, DOSSIERS_GENERIQUES,
} = require('../scripts/anonymiser-corpus.js');

const DIR = path.join(__dirname, 'fixtures');
const FIXTURES = fs.readdirSync(DIR).filter((f) => /^(vrac-racines|deja-ranges)-.*\.json$/.test(f));
const LIBRES = JSON.parse(fs.readFileSync(path.join(DIR, 'noms-libres-autorises.json'), 'utf8')).noms;

function parcourir(corpus, fn) {
  for (const domaine of Object.keys(corpus)) {
    if (domaine.startsWith('_')) continue;
    const v = corpus[domaine];
    if (Array.isArray(v)) v.forEach((n) => fn(n, null, domaine));
    else for (const sous of Object.keys(v)) v[sous].forEach((n) => fn(n, sous, domaine));
  }
}

test('les fixtures de noms de fichiers sont repérées (anti-vacuité du verrou)', () => {
  assert.ok(FIXTURES.length >= 2, 'le motif ne voit plus les fixtures : ' + FIXTURES.join(', '));
  assert.ok(LIBRES.length > 0);
});

test('#479 — chaque nom des fixtures est fictif (forme du script) ou explicitement autorisé', () => {
  const libres = new Set(LIBRES);
  const fautifs = [];
  let vus = 0;
  for (const f of FIXTURES) {
    parcourir(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')), (nom, sous) => {
      vus++;
      const m = FORME_NOM.exec(nom);
      const fictif = m && EMETTEUR_FICTIF.test(m[3]);
      if (!fictif && !libres.has(nom)) fautifs.push(f + ' : nom');
      if (sous) {
        sous.split('/').forEach((seg) => {
          if (!(DOSSIERS_GENERIQUES.includes(seg) || DOSSIER_FICTIF.test(seg) || /fictif|Exemple/.test(seg))) {
            fautifs.push(f + ' : sous-dossier');
          }
        });
      }
    });
  }
  assert.ok(vus > 500, 'le parcours ne voit presque rien : ' + vus);
  // Jamais le texte fautif dans le message : un journal de CI public est « en ligne ».
  assert.deepStrictEqual(fautifs.slice(0, 5), [],
    fautifs.length + ' entrée(s) ne sont ni fictives ni autorisées. Régénère la fixture avec ' +
    '`node scripts/anonymiser-corpus.js <releve-reel-hors-depot.json> <fixture>` ; pour un nom générique ' +
    'à garder tel quel, l\'ajouter à test/fixtures/noms-libres-autorises.json est un acte de revue.');
});

test('#479 — la liste des noms libres autorisés ne grossit pas sans qu\'on le voie', () => {
  // Un cliquet : l'élargir exige de changer ce nombre ici, donc de le dire dans la PR.
  assert.ok(LIBRES.length <= 37, 'noms libres autorisés : ' + LIBRES.length + ' (borne 37) — revue nécessaire');
});

// ---- le script, sur une entrée INVENTÉE ici (aucune donnée du Drive) ----
const BRUT = {
  _lisezmoi: 'note',
  '03 · Logement & véhicule': {
    'Logement/Rue Inventée 9': [
      '2024-01-28_Avis de reconduction_Agence Lambda.pdf',
      '2024-01-28_Avis de reconduction_Agence Lambda_2.pdf',
      '2025_Facture_Société Omega.png',
    ],
  },
  '05 · Carrière': ['2025-02_Contrat_Société Omega.pdf', 'Mon CV perso.docx', 'Journal de tri (agent)'],
};

test('#479 — le script garde date et type, remplace émetteurs, noms libres et sous-dossiers', () => {
  const s = pseudonymiserCorpus(BRUT, ['Journal de tri (agent)']);
  const json = JSON.stringify(s);
  for (const reel of ['Agence Lambda', 'Société Omega', 'Rue Inventée', 'Mon CV perso']) {
    assert.ok(!json.includes(reel), 'un nom réel a survécu');
  }
  assert.strictEqual(s._lisezmoi, 'note');
  const logement = s['03 · Logement & véhicule'];
  assert.deepStrictEqual(Object.keys(logement), ['Logement/Dossier fictif 001']);
  const noms = logement['Logement/Dossier fictif 001'];
  assert.ok(noms.includes('2024-01-28_Avis de reconduction_Émetteur fictif 001.pdf'));
  assert.ok(noms.includes('2024-01-28_Avis de reconduction_Émetteur fictif 001_2.pdf'), 'même émetteur = même numéro, suffixe gardé');
  assert.ok(noms.includes('2025_Facture_Émetteur fictif 002.png'));
  assert.ok(s['05 · Carrière'].includes('2025-02_Contrat_Émetteur fictif 002.pdf'), 'un émetteur garde son numéro d\'un dossier à l\'autre');
  assert.ok(s['05 · Carrière'].includes('Fichier libre fictif 001.docx'));
  assert.ok(s['05 · Carrière'].includes('Journal de tri (agent)'), 'nom libre autorisé conservé');
});

test('#479 — déterministe (ordre d\'entrée sans effet) et rejouable sur sa propre sortie', () => {
  const a = pseudonymiserCorpus(BRUT, ['Journal de tri (agent)']);
  const inverse = JSON.parse(JSON.stringify(BRUT));
  inverse['05 · Carrière'].reverse();
  inverse['03 · Logement & véhicule']['Logement/Rue Inventée 9'].reverse();
  const trie = (c) => JSON.parse(JSON.stringify(c, (k, v) => (Array.isArray(v) ? v.slice().sort() : v)));
  assert.deepStrictEqual(trie(pseudonymiserCorpus(inverse, ['Journal de tri (agent)'])), trie(a),
    'mêmes numéros quel que soit l\'ordre d\'entrée');
  assert.deepStrictEqual(pseudonymiserCorpus(a, ['Journal de tri (agent)']), a, 'rejouer sur la sortie ne change rien');
});

test('#479 — rejouer sur les fixtures versionnées ne les modifie pas (le script et le verrou concordent)', () => {
  for (const f of FIXTURES) {
    const brut = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.deepStrictEqual(pseudonymiserCorpus(brut, LIBRES), brut, f);
  }
});

test('#479 — le script refuse un relevé réel posé DANS le dépôt, et écrit hors dépôt', () => {
  assert.strictEqual(estDansLeDepot(path.join(__dirname, 'fixtures', 'x.json')), true);
  assert.strictEqual(estDansLeDepot(path.join(os.tmpdir(), 'x.json')), false);
  const script = path.join(__dirname, '..', 'scripts', 'anonymiser-corpus.js');
  const dedans = spawnSync(process.execPath, [script, path.join(__dirname, 'fixtures', 'vrac-racines-2026-09-13.json'), path.join(os.tmpdir(), 'sortie-refus.json')]);
  assert.strictEqual(dedans.status, 2);
  assert.match(String(dedans.stderr), /Refus/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-'));
  fs.writeFileSync(path.join(dir, 'brut.json'), JSON.stringify(BRUT));
  execFileSync(process.execPath, [script, path.join(dir, 'brut.json'), path.join(dir, 'fictif.json')]);
  const sortie = JSON.parse(fs.readFileSync(path.join(dir, 'fictif.json'), 'utf8'));
  assert.ok(!JSON.stringify(sortie).includes('Agence Lambda'));
  fs.rmSync(dir, { recursive: true, force: true });
});
