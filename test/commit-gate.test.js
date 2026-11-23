// test/commit-gate.test.js — porte de commit (modèle commun de l'Atelier, kit 1.13.0), adapté des tests du kit
// (modeles/qualite/tests/commit-gate.test.mjs et commit-gate-powershell.test.mjs).
// Ce qui est vérifié ici :
//   1. le branchement dans .claude/settings.json : hook PreToolUse sur CHAQUE outil shell (Bash ET PowerShell), sur aucun autre ;
//   2. la configuration DriveAI (scripts/hooks/commit-gate.json) : valide, 3 étapes attendues, doc seule sans effet ;
//   3. de bout en bout : un faux dépôt temporaire (git init + git add, sans commit) reçoit une copie du hook DE CE DÉPÔT et une
//      configuration de test dont les étapes sont de petits fichiers Node laissant un témoin. Le dépôt DriveAI n'est jamais touché.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const RACINE = path.join(__dirname, "..");
const HOOKS = path.join(RACINE, "scripts", "hooks");

// ── 1. branchement ─────────────────────────────────────────────────────────────────────────────
/** Un matcher de hook Claude Code est une expression régulière sur le nom de l'outil, appliquée au nom ENTIER. */
const couvre = (matcher, outil) => new RegExp(`^(?:${matcher})$`).test(outil);

test("réglage : le hook commit-gate est branché une fois, sur Bash ET PowerShell, et sur aucun autre outil", () => {
  const reglage = JSON.parse(readFileSync(path.join(RACINE, ".claude", "settings.json"), "utf8"));
  const hooks = (reglage.hooks?.PreToolUse ?? []).filter((h) => (h.hooks ?? []).some((x) => /commit-gate\.mjs/.test(x.command ?? "")));
  assert.equal(hooks.length, 1, "un seul branchement du hook");
  for (const outil of ["Bash", "PowerShell"]) assert.ok(couvre(hooks[0].matcher, outil), `${outil} non couvert par « ${hooks[0].matcher} »`);
  for (const outil of ["Read", "Edit", "Write", "Glob", "Grep", "PowerShellX", "XBash"]) assert.ok(!couvre(hooks[0].matcher, outil), `${outil} ne doit pas déclencher la porte`);
  // Kit 1.18.0 : lanceur `node -e` — racine du dépôt par `git rev-parse --show-toplevel` (repli CLAUDE_PROJECT_DIR), chemin ABSOLU de la porte,
  // commande sans « git » laissée passer, code de sortie 2 conservé. Le texte exact du lanceur est vérifié par verifier-copies (copie fidèle du modèle).
  const lanceur = hooks[0].hooks[0].command;
  assert.match(lanceur, /^node -e "/);
  assert.match(lanceur, /rev-parse/);
  assert.match(lanceur, /CLAUDE_PROJECT_DIR/);
  assert.match(lanceur, /scripts.*hooks.*commit-gate\.mjs|'scripts','hooks','commit-gate\.mjs'/);
  // Les hooks déjà en place restent branchés.
  for (const evenement of ["SessionStart", "PostToolUse", "Stop"]) assert.ok((reglage.hooks?.[evenement] ?? []).length > 0, `${evenement} a disparu`);
});

// ── 2. configuration DriveAI ───────────────────────────────────────────────────────────────────
test("configuration DriveAI : valide pour le modèle commun, étapes moteur + app (tests, build), doc seule sans effet", async () => {
  const lib = await import(require("node:url").pathToFileURL(path.join(HOOKS, "lib", "analyseCommande.mjs")).href);
  const config = lib.validerConfigGate(JSON.parse(readFileSync(path.join(HOOKS, "commit-gate.json"), "utf8")));
  assert.deepEqual(config.etapes.map((e) => e.commande), [
    ["npm", "test"],
    ["npm", "--prefix", "app", "test"],
    ["npm", "--prefix", "app", "run", "build"],
  ]);
  assert.equal(lib.toucheLeGate(["docs/adr/0001.md", "HANDOVER.md"], config.sansEffet), false);
  assert.equal(lib.toucheLeGate(["docs/a.md", "src/Router.gs"], config.sansEffet), true);
  assert.equal(lib.toucheLeGate(["app/src/corbeille.ts"], config.sansEffet), true);
  for (const f of ["package.json", "app/package-lock.json", "app/tsconfig.json", "app/vite.config.ts", "app/vitest.config.ts", "app/index.html", "app/src/index.css"]) {
    assert.ok(lib.estConfigGlobale(f, config.configGlobale), f);
  }
  assert.equal(lib.estConfigGlobale("app/src/App.tsx", config.configGlobale), false);
});

// ── 3. bout en bout sur un faux dépôt ──────────────────────────────────────────────────────────
// Les étapes lancent de petits FICHIERS du faux dépôt (la configuration refuse `node -e` : exécution en ligne interdite).
const SCRIPTS = {
  "temoin.cjs": "require('fs').appendFileSync(process.argv[2], 'x');",
  // ⚠️ `process.exitCode`, jamais `process.exit()` : sur un tube, stderr est asynchrone, et `process.exit()` jetait ce qui
  // n'était pas encore parti (sortie coupée vers l100-l400, ~1 fois sur 3 sous charge). Le script mentait, pas le hook.
  "echec500.cjs": "for (let i = 0; i < 500; i++) console.error('l' + i); process.exitCode = 1;",
  "args.cjs": "require('fs').writeFileSync('args', process.argv.slice(2).join('|'));",
};
const temoin = (nom) => ["node", "temoin.cjs", nom];
const echec = () => ["node", "echec500.cjs"];

/** Faux dépôt : hook de CE dépôt copié dans scripts/hooks/, configuration donnée, fichiers indexés. */
function depot({ config, fichiers = ["src/a.gs"], brut = null }) {
  const d = mkdtempSync(path.join(tmpdir(), "gate-driveai-"));
  execFileSync("git", ["init", "-q", d]);
  writeFileSync(path.join(d, ".git", "info", "exclude"), "scripts/\ntemoin.cjs\nechec500.cjs\nargs.cjs\nt\nt1\nt2\napres\nargs\npwned\npwned2\n");
  for (const [nom, code] of Object.entries(SCRIPTS)) writeFileSync(path.join(d, nom), code);
  const hooks = path.join(d, "scripts", "hooks");
  mkdirSync(path.join(hooks, "lib"), { recursive: true });
  cpSync(path.join(HOOKS, "commit-gate.mjs"), path.join(hooks, "commit-gate.mjs"));
  cpSync(path.join(HOOKS, "lib", "analyseCommande.mjs"), path.join(hooks, "lib", "analyseCommande.mjs"));
  if (brut !== null) writeFileSync(path.join(hooks, "commit-gate.json"), brut);
  else if (config) writeFileSync(path.join(hooks, "commit-gate.json"), JSON.stringify(config));
  for (const f of fichiers) {
    mkdirSync(path.join(d, f, ".."), { recursive: true });
    writeFileSync(path.join(d, f), "x\n");
  }
  execFileSync("git", ["-C", d, "add", "-A"]);
  return d;
}
const lancer = (d, entree) => spawnSync(process.execPath, [path.join(d, "scripts", "hooks", "commit-gate.mjs")], { cwd: d, input: entree, encoding: "utf8", timeout: 60000 });
const commande = (d, command, tool_name = "Bash") => lancer(d, JSON.stringify({ tool_name, tool_input: { command } }));
const nettoyer = (d) => rmSync(d, { recursive: true, force: true });
const CONFIG = (etapes, extra = {}) => ({ etapes, ...extra });

test("un texte qui cite « git commit » (heredoc) sort avec 0 sans rien lancer ni lire la configuration", () => {
  const d = depot({ brut: "{pas du json" });
  try {
    const r = commande(d, "cat > r.md <<EOF\nnous ferons git commit ensuite\nEOF");
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
  } finally { nettoyer(d); }
});

test("entrée illisible : BLOQUE (échec fermé) ; appel sans commande : 0", () => {
  const d = depot({ config: CONFIG([{ nom: "e", commande: temoin("t") }]) });
  try {
    const r = lancer(d, "pas du json");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /illisible/);
    assert.equal(lancer(d, JSON.stringify({ tool_input: {} })).status, 0);
  } finally { nettoyer(d); }
});

test("kit 1.15.0 : un BOM UTF-8 en tête (pipe de Windows PowerShell 5.1) est toléré ; un JSON réellement invalide reste BLOQUÉ", () => {
  const d = depot({ config: CONFIG([{ nom: "tests moteur", commande: echec() }]) });
  try {
    const avecBom = "﻿" + JSON.stringify({ tool_name: "PowerShell", tool_input: { command: "git commit -m x" } });
    const r = lancer(d, avecBom);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Commit bloqué : tests moteur a échoué/);   // bloqué par la PORTE, plus pour « entrée illisible »
    const casse = lancer(d, "﻿﻿{}");
    assert.equal(casse.status, 2);
    assert.match(casse.stderr, /illisible/);
  } finally { nettoyer(d); }
});

test("configuration absente, illisible ou invalide : le commit est BLOQUÉ (échec fermé)", () => {
  for (const [nom, brut] of [["absente", null], ["json cassé", "{pas du json"], ["sans étape", "{\"etapes\": []}"],
    ["chaîne shell", JSON.stringify(CONFIG([{ nom: "x", commande: "npm test" }]))],
    ["programme interdit", JSON.stringify(CONFIG([{ nom: "x", commande: ["bash", "-c", "true"] }]))],
    ["exécution en ligne", JSON.stringify(CONFIG([{ nom: "x", commande: ["node", "-e", "1"] }]))]]) {
    const d = depot({ brut, config: null });
    try {
      const r = commande(d, "git commit -m x");
      assert.equal(r.status, 2, nom);
      assert.match(r.stderr, /configuration illisible ou invalide/, nom);
    } finally { nettoyer(d); }
  }
});

test("étapes vertes : commit autorisé et TOUTES les étapes ont tourné", () => {
  const d = depot({ config: CONFIG([{ nom: "un", commande: temoin("t1") }, { nom: "deux", commande: temoin("t2") }]) });
  try {
    const r = commande(d, "git commit -m x");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(path.join(d, "t1")) && existsSync(path.join(d, "t2")));
  } finally { nettoyer(d); }
});

test("étape rouge : commit BLOQUÉ (2), message clair, sortie plafonnée, étapes suivantes non lancées", () => {
  const d = depot({ config: CONFIG([{ nom: "tests moteur", commande: echec() }, { nom: "apres", commande: temoin("apres") }]) });
  try {
    const r = commande(d, "git commit -m x");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Commit bloqué : tests moteur a échoué/);
    assert.match(r.stderr, /sortie=1/);
    assert.match(r.stderr, /l499/);
    assert.doesNotMatch(r.stderr, /\nl0\n/);                        // seule la FIN est gardée
    assert.equal(existsSync(path.join(d, "apres")), false);
  } finally { nettoyer(d); }
});

test("commit de documentation seule : le gate ne tourne pas ; un source avec la doc : il tourne", () => {
  const cfg = CONFIG([{ nom: "e", commande: temoin("t") }], { sans_effet: ["\\.md$", "^docs/"] });
  const docs = depot({ config: cfg, fichiers: ["docs/a.md", "HANDOVER.md"] });
  try {
    assert.equal(commande(docs, "git commit -m x").status, 0);
    assert.equal(existsSync(path.join(docs, "t")), false);
  } finally { nettoyer(docs); }
  const src = depot({ config: cfg, fichiers: ["docs/a.md", "src/Router.gs"] });
  try {
    assert.equal(commande(src, "git commit -m x").status, 0);
    assert.equal(existsSync(path.join(src, "t")), true);
  } finally { nettoyer(src); }
});

test("git add + commit dans la même commande : les fichiers ajoutés comptent (index encore vide au moment du hook)", () => {
  const d = depot({ config: CONFIG([{ nom: "e", commande: temoin("t") }]), fichiers: [] });
  try {
    mkdirSync(path.join(d, "src"), { recursive: true });
    writeFileSync(path.join(d, "src", "nouveau.gs"), "x\n");
    assert.equal(commande(d, "git add src/nouveau.gs && git commit -m x").status, 0);
    assert.equal(existsSync(path.join(d, "t")), true);
  } finally { nettoyer(d); }
});

test("analyse incertaine (chemin hostile, enveloppe, cd) : suite complète, jamais « pas un commit »", () => {
  for (const c of ["git add -- 'a&b' && git commit -m x", "bash -c 'git commit -m x'", "cd sous && git commit -m x", 'git commit -m "non fermé']) {
    const d = depot({ config: CONFIG([{ nom: "e", commande: temoin("t") }]), fichiers: ["docs/a.md"] });
    try {
      assert.equal(commande(d, c).status, 0, c);
      assert.equal(existsSync(path.join(d, "t")), true, c);
    } finally { nettoyer(d); }
  }
});

test("SANS shell : un « ; » ou un « $() » dans un argument reste UN argument (rien n'est interprété)", () => {
  const d = depot({ config: CONFIG([{ nom: "e", commande: ["node", "args.cjs", "a; touch pwned", "$(touch pwned2)"] }]) });
  try {
    assert.equal(commande(d, "git commit -m x").status, 0);
    assert.equal(existsSync(path.join(d, "pwned")), false);
    assert.equal(existsSync(path.join(d, "pwned2")), false);
    assert.equal(existsSync(path.join(d, "args")), true);
  } finally { nettoyer(d); }
});

// ── PowerShell (29/09) : un git commit lancé par l'outil PowerShell passait sans contrôle avec un matcher « Bash » seul ─────
test("un git commit lancé par l'outil PowerShell est BLOQUÉ comme par Bash (même champ, mêmes règles)", () => {
  const d = depot({ config: CONFIG([{ nom: "tests moteur", commande: echec() }]) });
  try {
    for (const outil of ["Bash", "PowerShell"]) {
      const r = commande(d, "git commit -m x", outil);
      assert.equal(r.status, 2, outil);
      assert.match(r.stderr, /Commit bloqué : tests moteur a échoué/, outil);
    }
  } finally { nettoyer(d); }
});

test("formes PowerShell réalistes d'un commit : toutes BLOQUÉES quand une étape est rouge", () => {
  const d = depot({ config: CONFIG([{ nom: "tests moteur", commande: echec() }]) });
  try {
    for (const c of ["git add -A; git commit -m 'x'", 'git commit -m "x"', "git -C . commit -m x", "git commit -m @'\nmessage\n'@", "git commit -F message.txt"]) {
      assert.equal(commande(d, c, "PowerShell").status, 2, c);
    }
  } finally { nettoyer(d); }
});

test("un outil non shell (Read, Edit) n'est pas touché : sortie 0, rien de lancé", () => {
  const d = depot({ config: CONFIG([{ nom: "e", commande: temoin("t") }]) });
  try {
    for (const [tool_name, tool_input] of [["Read", { file_path: "src/a.gs" }], ["Edit", { file_path: "src/a.gs", old_string: "x", new_string: "git commit -m x" }]]) {
      const r = lancer(d, JSON.stringify({ tool_name, tool_input }));
      assert.equal(r.status, 0, tool_name);
      assert.equal(r.stderr, "", tool_name);
    }
    assert.equal(existsSync(path.join(d, "t")), false);
  } finally { nettoyer(d); }
});
