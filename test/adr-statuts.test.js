// test/adr-statuts.test.js — chaque ADR dit son statut en clair, et l'index docs/adr/README.md le répète sans le contredire.
// Lancer : node --test test/adr-statuts.test.js   (zéro dépendance)
// Trois écritures de la ligne coexistent dans les ADR (« - **Statut** : », « **Date** : … · **Statut** : », « * **Statut** : ») ;
// on les lit toutes, sans migrer les fichiers : seul le premier mot compte.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const RACINE = join(__dirname, "..");
const DOSSIER = join(RACINE, "docs", "adr");
const lire = (f) => readFileSync(join(DOSSIER, f), "utf8").replace(/\r\n/g, "\n");

const STATUTS = ["proposé", "accepté", "abandonné", "abrogé"];
// Pièces jointes de l'ADR 0059 : ni décision ni statut.
const ANNEXES = ["0059-annexe-critique.md", "0059-annexe-gmail-scopes.md"];

const adr = readdirSync(DOSSIER).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();

// Premier mot de la ligne « Statut » des 16 premières lignes (null si absente).
function statutDe(fichier) {
  const entete = lire(fichier).split("\n").slice(0, 16).join("\n");
  const m = entete.match(/\*\*Statut\*\*\s*:\s*([^\n]+)/);
  if (!m) return null;
  return m[1].replace(/[*⛔_`]/g, "").trim().split(/[\s·—(:+]/)[0].toLowerCase();
}

function lignesIndex() {
  const lignes = lire("README.md").split("\n").filter((l) => /^\| \[\d{4}\]\(/.test(l));
  return lignes.map((l) => {
    const c = l.split("|").map((x) => x.trim());
    return { fichier: /\(([^)]+)\)/.exec(c[1])[1], statut: c[3].toLowerCase(), liens: c[4] };
  });
}

test("chaque ADR (hors annexes) porte une ligne « Statut » dont le premier mot est connu", () => {
  for (const f of adr.filter((x) => !ANNEXES.includes(x))) {
    const s = statutDe(f);
    assert.ok(s, `${f} : pas de ligne « **Statut** : » dans ses 16 premières lignes`);
    assert.ok(STATUTS.includes(s), `${f} : statut « ${s} » inconnu (attendus : ${STATUTS.join(", ")})`);
  }
});

test("l'index docs/adr/README.md a une ligne par ADR, sans doublon ni fichier fantôme", () => {
  const index = lignesIndex();
  const fichiers = index.map((l) => l.fichier);
  assert.deepEqual([...fichiers].sort(), adr, "index et dossier divergent");
  assert.equal(new Set(fichiers).size, fichiers.length, "une ADR figure deux fois dans l'index");
  for (const f of fichiers) assert.ok(existsSync(join(DOSSIER, f)), `${f} : le lien de l'index ne mène à rien`);
});

test("le statut de l'index est celui de l'ADR (annexes : « annexe »)", () => {
  for (const l of lignesIndex()) {
    const attendu = ANNEXES.includes(l.fichier) ? "annexe" : statutDe(l.fichier);
    assert.equal(l.statut, attendu, `${l.fichier} : index « ${l.statut} », ADR « ${attendu} »`);
  }
});

test("un ADR abandonné ou abrogé dit dans l'index pourquoi ou par quoi", () => {
  for (const l of lignesIndex()) {
    if (["abandonné", "abrogé"].includes(l.statut)) assert.ok(l.liens.length > 10, `${l.fichier} : colonne « Liens et précisions » vide`);
    if (l.statut === "abrogé") assert.match(l.liens, /abrogé par \d{4}/, `${l.fichier} : l'ADR qui l'abroge n'est pas nommé`);
  }
});

test("les ADR cités dans « Liens et précisions » existent", () => {
  const numeros = new Set(adr.map((f) => f.slice(0, 4)));
  for (const l of lignesIndex()) {
    for (const n of l.liens.match(/\b\d{4}\b/g) || []) {
      if (/^20\d\d$/.test(n)) continue; // une année (« 2026-09-28 »)
      assert.ok(numeros.has(n), `${l.fichier} : l'ADR ${n} cité n'existe pas`);
    }
  }
});
