// Syntaxe des .gs : un .gs cassé fige le déploiement clasp (deploy.yml).
// `node --check` ignore l'extension .gs, donc chaque fichier est copié en .js dans un dossier
// temporaire. Ne vérifie QUE la syntaxe (pas les globals Google). C'est le « lint » du dépôt :
// il n'a pas d'ESLint, et un script `lint` vide ne prouverait rien.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const SRC = "src";
const tmp = mkdtempSync(join(tmpdir(), "syntaxe-gs-"));
let echecs = 0;
try {
  for (const f of readdirSync(SRC).filter((n) => n.endsWith(".gs"))) {
    const cible = join(tmp, `${basename(f, ".gs")}.js`);
    copyFileSync(join(SRC, f), cible);
    try {
      execFileSync(process.execPath, ["--check", cible], { stdio: "pipe" });
    } catch (e) {
      echecs += 1;
      console.error(`❌ Syntaxe : ${f}\n${e.stderr?.toString() ?? e.message}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(echecs ? 1 : 0);
