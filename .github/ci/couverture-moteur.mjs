// couverture-moteur.mjs — cliquet de couverture du MOTEUR Apps Script (src/*.gs).
// Les portes qualité de `app/` (app/qualite/portes.mjs) ne mesurent que l'app web et api/ ; le moteur,
// qui est le gros du code, avait « son propre filet » mais aucun chiffre. Ici : le MÊME principe de
// cliquet — le seuil part de la mesure du jour, une PR qui fait reculer la couverture est rouge,
// et `--maj` ne fait que le resserrer.
//
//   node .github/ci/couverture-moteur.mjs        → lance les tests du moteur avec couverture, juge
//   node .github/ci/couverture-moteur.mjs --maj  → resserre le seuil sur la mesure (jamais l'inverse)
//
// Sans dépendance : Node seul (`--experimental-test-coverage` + reporter lcov). Lignes de `src/*.gs`
// seulement : les tests chargent les .gs dans un bac à sable `vm` avec leur chemin comme `filename`
// (test/harness.js), c'est ce qui rend ces fichiers visibles pour la couverture.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FICHIER_SEUIL = join(RACINE, ".github", "ci", "couverture-moteur.json");

/** PURE : lignes trouvées / couvertes d'un rapport lcov, restreintes aux fichiers `src/*.gs`. */
export function lireLcov(texte) {
  let trouvees = 0, couvertes = 0, fichiers = 0, dansMoteur = false;
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (ligne.startsWith("SF:")) {
      dansMoteur = /(^|[\\/])src[\\/][^\\/]+\.gs$/.test(ligne.slice(3));
      if (dansMoteur) fichiers++;
    } else if (dansMoteur && ligne.startsWith("LF:")) trouvees += Number(ligne.slice(3)) || 0;
    else if (dansMoteur && ligne.startsWith("LH:")) couvertes += Number(ligne.slice(3)) || 0;
  }
  const pourcent = trouvees ? Math.round((1000 * couvertes) / trouvees) / 10 : null;
  return { fichiers, trouvees, couvertes, pourcent };
}

/** PURE : verdict du cliquet. Une mesure absente (aucun .gs vu) est un ÉCHEC nommé, jamais un « 100 % ». */
export function juger(mesure, seuilMin) {
  if (mesure.pourcent === null || mesure.fichiers === 0) {
    return { ok: false, raison: "aucun fichier src/*.gs dans le rapport de couverture — instrument cassé, pas une couverture de 100 %" };
  }
  if (mesure.pourcent < seuilMin) {
    return { ok: false, raison: `couverture du moteur ${mesure.pourcent} % < seuil ${seuilMin} % (le cliquet ne recule pas)` };
  }
  return { ok: true, raison: `couverture du moteur ${mesure.pourcent} % ≥ seuil ${seuilMin} %` };
}

/** PURE : le seuil resserré sur une mesure (au dixième inférieur) — jamais plus bas que l'actuel. */
export function resserrer(mesure, seuilMin) {
  if (mesure.pourcent === null) return seuilMin;
  return Math.max(seuilMin, Math.floor(mesure.pourcent * 10) / 10);
}

function mesurer() {
  const dossier = mkdtempSync(join(tmpdir(), "couverture-moteur-"));
  const lcov = join(dossier, "moteur.lcov");
  const r = spawnSync(process.execPath, [
    "--test", "--experimental-test-coverage", "--test-coverage-include=src/**/*.gs",
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=lcov", `--test-reporter-destination=${lcov}`,
    ...readdirTests(),
  ], { cwd: RACINE, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    const fin = ((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-25).join("\n");
    throw new Error(`les tests du moteur échouent (code ${r.status}) — la couverture n'est pas jugée sur un moteur rouge. Fin de la sortie :\n${fin}`);
  }
  return lireLcov(readFileSync(lcov, "utf8"));
}

function readdirTests() {
  return readdirSync(join(RACINE, "test")).filter((f) => f.endsWith(".test.js")).sort().map((f) => `test/${f}`);
}

function main() {
  const config = JSON.parse(readFileSync(FICHIER_SEUIL, "utf8"));
  const mesure = mesurer();
  console.log(`Moteur (src/*.gs) : ${mesure.couvertes}/${mesure.trouvees} lignes couvertes dans ${mesure.fichiers} fichiers = ${mesure.pourcent} %`);
  const verdict = juger(mesure, config.lignes.min);
  if (process.argv.includes("--maj")) {
    if (!verdict.ok) { console.error(`REFUSÉ : ${verdict.raison}`); process.exit(1); }
    const neuf = resserrer(mesure, config.lignes.min);
    if (neuf !== config.lignes.min) {
      config.lignes.min = neuf;
      writeFileSync(FICHIER_SEUIL, JSON.stringify(config, null, 2) + "\n");
      console.log(`Seuil resserré : ${neuf} %`);
    } else console.log("Seuil inchangé.");
    return;
  }
  console.log(verdict.ok ? `OK  ${verdict.raison}` : `ÉCHEC  ${verdict.raison}`);
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`ÉCHEC  ${e.message}`); process.exit(1); }
}
