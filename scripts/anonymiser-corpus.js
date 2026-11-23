#!/usr/bin/env node
'use strict';
/**
 * Rend FICTIF un relevé de noms de fichiers du Drive, pour qu'il puisse servir de fixture de test.
 *
 * POURQUOI (tâche MoKarade/DriveAI#479, règle du 15/10/2026 : rien de personnel en ligne) : le
 * relevé réel du Drive ne doit JAMAIS entrer dans git (un commit est irréversible), et les noms
 * inventés à la main ne se refont pas — le jour où le relevé change, il faudrait tout retaper. Ce
 * script est le chemin REJOUABLE : le relevé réel reste hors du dépôt, on le passe en argument,
 * la sortie est la fixture versionnée.
 *
 *   node scripts/anonymiser-corpus.js <releve-reel.json> <fixture-sortie.json>
 *
 * Forme d'entrée : { "<domaine>": ["nom", …] } ou { "<domaine>": { "<sous-dossier>": ["nom", …] } }.
 * Règles (testées dans test/corpus-fictif.test.js) :
 *   - un nom `<date>_<type>_<émetteur>[_n][.ext]` garde sa date et son TYPE (c'est ce que mesurent
 *     les tests de rangement) ; l'ÉMETTEUR devient `Émetteur fictif NNN` ;
 *   - un nom qui n'a pas cette forme devient `Fichier libre fictif NNN.ext`, sauf s'il figure dans
 *     `test/fixtures/noms-libres-autorises.json` (noms génériques, revus à la main une fois) ;
 *   - les sous-dossiers deviennent `Dossier fictif NNN`, sauf les noms génériques de la taxonomie ;
 *   - la numérotation suit l'ordre trié des noms réels : la même entrée donne toujours la même sortie ;
 *   - REJOUABLE sur sa propre sortie : ce qui est déjà fictif ne bouge pas.
 *   - REFUS si le relevé réel est DANS le dépôt : la donnée réelle ne passe jamais par l'arbre git.
 */
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');
const NOMS_LIBRES = path.join(RACINE, 'test', 'fixtures', 'noms-libres-autorises.json');
const DOSSIERS_GENERIQUES = ['Logement', 'Correspondance', 'Contrats', 'Assurance habitation', 'Énergie & services'];

const FORME_NOM = /^(\d{4}(?:-\d{2}){0,2})_([^_]+)_(.+?)(_\d{1,2})?(\.[A-Za-z0-9]{1,5})?$/;
const EMETTEUR_FICTIF = /^Émetteur fictif (\d+)$/;
const LIBRE_FICTIF = /^Fichier libre fictif (\d+)(\.[A-Za-z0-9]{1,5})?$/;
const DOSSIER_FICTIF = /^Dossier fictif (\d+)$/;

const num = (n) => String(n).padStart(3, '0');

/** Attribue des numéros stables : les valeurs déjà fictives gardent le leur, les autres prennent le prochain libre. */
function numeroteur(motifFictif) {
  const pris = new Map(); // valeur réelle ou fictive → numéro
  let max = 0;
  return {
    reserver(valeurFictive) { const m = motifFictif.exec(valeurFictive); if (m) max = Math.max(max, Number(m[1])); },
    numero(valeur) {
      if (!pris.has(valeur)) pris.set(valeur, ++max);
      return pris.get(valeur);
    },
  };
}

/** PURE. @param {object} brut relevé réel @param {string[]} nomsLibres noms génériques conservés tels quels. */
function pseudonymiserCorpus(brut, nomsLibres) {
  const libres = new Set(nomsLibres || []);
  const emetteurs = numeroteur(EMETTEUR_FICTIF);
  const fichiersLibres = numeroteur(LIBRE_FICTIF);
  const dossiers = numeroteur(DOSSIER_FICTIF);

  const listes = []; // [domaine, sousDossier|null, noms[]]
  for (const domaine of Object.keys(brut)) {
    if (domaine.startsWith('_')) continue;
    const v = brut[domaine];
    if (Array.isArray(v)) listes.push([domaine, null, v]);
    else for (const sous of Object.keys(v)) listes.push([domaine, sous, v[sous]]);
  }
  // Première passe : réserver les numéros déjà fictifs, pour que rejouer ne renumérote rien.
  for (const [, sous, noms] of listes) {
    if (sous) sous.split('/').forEach((s) => dossiers.reserver(s));
    for (const n of noms) {
      const f = FORME_NOM.exec(n);
      if (f) emetteurs.reserver(f[3]); else fichiersLibres.reserver(n);
    }
  }
  const nom = (n) => {
    const f = FORME_NOM.exec(n);
    if (f) {
      const [, date, type, emetteur, suffixe, ext] = f;
      const e = EMETTEUR_FICTIF.test(emetteur) ? emetteur : 'Émetteur fictif ' + num(emetteurs.numero(emetteur));
      return date + '_' + type + '_' + e + (suffixe || '') + (ext || '');
    }
    if (libres.has(n) || LIBRE_FICTIF.test(n)) return n;
    const ext = /(\.[A-Za-z0-9]{1,5})$/.exec(n);
    return 'Fichier libre fictif ' + num(fichiersLibres.numero(n)) + (ext ? ext[1] : '');
  };
  const dossier = (s) => s.split('/').map((seg) =>
    (DOSSIERS_GENERIQUES.includes(seg) || DOSSIER_FICTIF.test(seg) || /fictif|Exemple/.test(seg))
      ? seg : 'Dossier fictif ' + num(dossiers.numero(seg))).join('/');

  // Deuxième passe : les numéros s'attribuent en ordre TRIÉ (la numérotation ne dépend pas de l'ordre
  // du fichier d'entrée), mais la sortie GARDE l'ordre d'entrée — le diff d'une régénération reste lisible.
  const cache = new Map();
  const cacheDossiers = new Map();
  const tries = listes.slice().sort((a, b) => (a[0] + '\u0000' + (a[1] || '')).localeCompare(b[0] + '\u0000' + (b[1] || ''), 'fr'));
  for (const [, sous, noms] of tries) {
    if (sous !== null && !cacheDossiers.has(sous)) cacheDossiers.set(sous, dossier(sous));
    for (const n of noms.slice().sort((a, b) => a.localeCompare(b, 'fr'))) if (!cache.has(n)) cache.set(n, nom(n));
  }
  const sortie = {};
  if (typeof brut._lisezmoi === 'string') sortie._lisezmoi = brut._lisezmoi;
  for (const [domaine, sous, noms] of listes) {
    const res = noms.map((n) => cache.get(n));
    if (sous === null) sortie[domaine] = res;
    else { sortie[domaine] = sortie[domaine] || {}; sortie[domaine][cacheDossiers.get(sous)] = res; }
  }
  return sortie;
}

/** Vrai si `chemin` est dans l'arbre du dépôt (hors `node_modules`). */
function estDansLeDepot(chemin) {
  const rel = path.relative(RACINE, path.resolve(chemin));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function principal(argv) {
  const [entree, sortie] = argv;
  if (!entree || !sortie) {
    console.error('Usage : node scripts/anonymiser-corpus.js <releve-reel.json> <fixture-sortie.json>');
    return 2;
  }
  if (estDansLeDepot(entree)) {
    console.error('Refus : le relevé RÉEL ne doit pas se trouver dans le dépôt (ni versionné, ni même posé là). Mets-le ailleurs, p. ex. dans /tmp.');
    return 2;
  }
  const brut = JSON.parse(fs.readFileSync(entree, 'utf8'));
  const libres = JSON.parse(fs.readFileSync(NOMS_LIBRES, 'utf8')).noms;
  fs.writeFileSync(sortie, JSON.stringify(pseudonymiserCorpus(brut, libres), null, 1) + '\n');
  return 0;
}

if (require.main === module) process.exit(principal(process.argv.slice(2)));

module.exports = { pseudonymiserCorpus, estDansLeDepot, FORME_NOM, EMETTEUR_FICTIF, LIBRE_FICTIF, DOSSIER_FICTIF, DOSSIERS_GENERIQUES };
