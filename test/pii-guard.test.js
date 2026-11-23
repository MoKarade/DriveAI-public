'use strict';
/**
 * Verrou « aucune donnée personnelle dans le dépôt » (tâche MoKarade/DriveAI#497).
 *
 * Règle du projet (15/10/2026) : rien de personnel en ligne — ni code, ni tests, ni fixtures, ni docs.
 * Or ce dépôt est, par nature, la carte du Drive de Marc ; l'état de départ n'est pas à zéro. Ce garde
 * est donc un CLIQUET : `pii-baseline.json` donne, fichier par fichier, ce qui reste à retirer.
 *   - un fichier qui dépasse sa ligne de base (ou un fichier neuf avec une trouvaille) fait échouer ;
 *   - un fichier qui descend sous sa ligne de base fait AUSSI échouer, tant que la base n'est pas
 *     abaissée : le progrès ne recule pas. On la réécrit avec `PII_ECRIRE_BASE=1 npm test`.
 * Le jour où la base est `{}`, le scan ne trouve plus rien : c'est le « Fini quand » de #497.
 *
 * PORTÉE — écrite ici plutôt que promise ailleurs :
 *   - il détecte des FORMES (identifiant de dossier Drive, adresse municipale, courriel de messagerie
 *     publique, téléphone, coordonnées GPS, code postal) et des MOTS CONNUS (liste hachée) ;
 *   - un nom propre que la liste ne connaît pas lui échappe ; les captures d'écran (PNG) ne sont pas lues ;
 *   - la liste de mots est HACHÉE : la publier en clair serait elle-même la fuite. Pour y ajouter un mot :
 *     `node test/pii-guard.test.js --hacher "mot ou phrase"` puis coller l'empreinte dans `pii-mots.json`.
 *   - la sortie n'imprime JAMAIS le texte trouvé (un journal de CI public est « en ligne ») : seulement
 *     le fichier, la ligne et la catégorie.
 * Données fictives attendues : `12 rue Exemple`, `prenom.nom@exemple.com`, `418-555-0100`.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');
const FICHIER_BASE = path.join(__dirname, 'pii-baseline.json');
const FICHIER_MOTS = path.join(__dirname, 'pii-mots.json');

/** Empreinte 53 bits (cyrb53) : rapide, pas cryptographique — elle masque la liste, elle ne protège rien d'autre. */
function empreinte(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** minuscules, sans accents, mots de [a-z0-9] — la forme sous laquelle on compare. */
function mots(ligne) {
  return ligne.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

if (require.main === module && process.argv[2] === '--hacher') {
  console.log(empreinte(mots(process.argv[3] || '').join(' ')));
  process.exit(0);
}

const WEBMAIL = /[\w.+-]+@(?:gmail|hotmail|outlook|yahoo|icloud|proton(?:mail)?|live|msn)\.[a-z.]+/gi;
const RUE = /\b\d{1,5}(?:-\d{1,5})?,? (?:[A-Za-zÀ-ÿ0-9'.]+ ){0,2}?(?:rue|av\.?|avenue|rte|route|boul\.?|boulevard|chemin(?= (?:de|des|du|d')))(?=[\s,.;:)»"'`]|$)/gi;
const RUE_FICTIVE = /^\s+(?:(?:de la|des|du|de|d')\s*)?(?:exemple|fictive?|test)\b/i;
const TEL = /(?<!\d)\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g;
const TEL_FICTIF = /\b555[ .-]01\d\d\b/;
const GPS = /-?\d{1,3}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,}/g;
const CODE_POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d\b/g;
const ID_DRIVE = /(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{27,43}(?![A-Za-z0-9_-])/g;

function estIdDrive(s) {
  return /[0-9]/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && !/^1[0-9a-f]{39}$/.test(s);
}

/** Trouvailles d'une ligne : liste de catégories (jamais le texte). */
function scannerLigne(ligne, motsConnus, longueurs) {
  const trouve = [];
  for (const m of ligne.matchAll(WEBMAIL)) {
    if (!/exemple|example|test|fictif|mock|invalide/i.test(m[0])) trouve.push('courriel');
  }
  for (const m of ligne.matchAll(RUE)) {
    if (!RUE_FICTIVE.test(ligne.slice(m.index + m[0].length))) trouve.push('adresse');
  }
  for (const m of ligne.matchAll(TEL)) {
    if (!TEL_FICTIF.test(m[0])) trouve.push('téléphone');
  }
  if (ligne.match(GPS)) trouve.push('coordonnées');
  for (const m of ligne.matchAll(CODE_POSTAL)) { void m; trouve.push('code postal'); }
  for (const m of ligne.matchAll(ID_DRIVE)) { if (estIdDrive(m[0])) trouve.push('identifiant Drive'); }
  const w = mots(ligne);
  for (const n of longueurs) {
    for (let i = 0; i + n <= w.length; i++) {
      if (motsConnus.has(empreinte(w.slice(i, i + n).join(' ')))) trouve.push('mot connu');
    }
  }
  return trouve;
}

function fichiersVersionnes() {
  const lister = (args) => execFileSync('git', args, { cwd: RACINE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const sortie = lister(['ls-files']) + '\n' + lister(['ls-files', '--others', '--exclude-standard']);
  return [...new Set(sortie.split('\n').map((f) => f.trim()).filter(Boolean))]
    .filter((f) => !/\.(png|jpe?g|gif|ico|woff2?|ttf|otf|pdf)$/i.test(f))
    .filter((f) => !/(^|\/)package-lock\.json$/.test(f))
    // Le garde et sa liste hachée : le premier contient les motifs qu'il cherche, la seconde n'est que du bruit.
    .filter((f) => f !== 'test/pii-guard.test.js' && f !== 'test/pii-mots.json' && f !== 'test/pii-baseline.json')
    .filter((f) => fs.existsSync(path.join(RACINE, f)));
}

function scanner() {
  const motsConnus = new Set(JSON.parse(fs.readFileSync(FICHIER_MOTS, 'utf8')).empreintes);
  const longueurs = [3, 2, 1];
  const parFichier = {};
  const lignes = {};
  for (const f of fichiersVersionnes()) {
    const texte = fs.readFileSync(path.join(RACINE, f), 'utf8');
    const l = texte.split('\n');
    for (let i = 0; i < l.length; i++) {
      const t = scannerLigne(l[i], motsConnus, longueurs);
      if (!t.length) continue;
      parFichier[f] = (parFichier[f] || 0) + 1;
      (lignes[f] = lignes[f] || []).push({ ligne: i + 1, categories: [...new Set(t)] });
    }
  }
  return { parFichier, lignes };
}

test('le scan de données personnelles ne progresse pas (cliquet, #497)', () => {
  const { parFichier, lignes } = scanner();
  if (process.env.PII_DETAIL === '1') {   // aide au nettoyage : fichier:ligne:catégories, jamais le texte
    for (const f of Object.keys(lignes).sort()) for (const x of lignes[f]) console.log(`PII ${f}:${x.ligne}:${x.categories.join('+')}`);
  }
  if (process.env.PII_ECRIRE_BASE === '1') {
    const tri = Object.fromEntries(Object.entries(parFichier).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(FICHIER_BASE, JSON.stringify(tri, null, 1) + '\n');
    return;
  }
  const base = JSON.parse(fs.readFileSync(FICHIER_BASE, 'utf8'));
  const hausse = [];
  const baisse = [];
  for (const f of new Set([...Object.keys(parFichier), ...Object.keys(base)])) {
    const reel = parFichier[f] || 0;
    const prevu = base[f] || 0;
    if (reel > prevu) {
      const det = (lignes[f] || []).slice(0, 8).map((x) => `${x.ligne}:${x.categories.join('+')}`).join(' ');
      hausse.push(`${f} : ${reel} ligne(s) pour ${prevu} permise(s) [${det}]`);
    } else if (reel < prevu) {
      baisse.push(`${f} : ${reel} < ${prevu}`);
    }
  }
  assert.deepStrictEqual(hausse, [],
    'Donnée personnelle ajoutée (texte non imprimé exprès). Remplacer par une valeur fictive :\n' + hausse.join('\n'));
  assert.deepStrictEqual(baisse, [],
    'Du progrès : abaisser la ligne de base avec `PII_ECRIRE_BASE=1 npm test`.\n' + baisse.join('\n'));
});

test('le scan reconnaît chaque forme surveillée (et laisse passer le fictif)', () => {
  const nul = new Set();
  const cat = (s) => scannerLigne(s, nul, []);
  assert.deepStrictEqual(cat('rendez-vous au 12 rue Exemple demain'), []);
  assert.deepStrictEqual(cat('écrire à prenom.nom@exemple.com ou 418-555-0100'), []);
  assert.deepStrictEqual(cat('habite au 1234 rue des Lilas'), ['adresse']);
  assert.deepStrictEqual(cat('contact : quelquun@gmail.com'), ['courriel']);
  assert.deepStrictEqual(cat('appeler le 418 123 4567'), ['téléphone']);
  assert.deepStrictEqual(cat('position 46.812345, -71.205678'), ['coordonnées']);
  assert.deepStrictEqual(cat('code H0H 0H0'), ['code postal']);
  assert.deepStrictEqual(cat('dossier 1Abcdefghij0123456789ABCDEFGHIJ_-x'), ['identifiant Drive']);
  assert.deepStrictEqual(cat('sha 1' + 'a'.repeat(39)), []);
  const connu = new Set([empreinte('mot secret')]);
  assert.deepStrictEqual(scannerLigne('un Mot-Secret ici', connu, [2, 1]), ['mot connu']);
});
