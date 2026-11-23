'use strict';
// qualite/seuils.json (racine) n'est qu'une copie lisible des seuils de couverture du cliquet
// de app/qualite/seuils.json, pour la grille de conformité. Deux valeurs qui divergent = un
// cliquet faux : ce test les garde identiques.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

const lire = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const couverture = (j) =>
  Object.fromEntries(Object.entries(j.portes).filter(([k]) => k.startsWith("couverture.")));

test("les seuils de couverture de la racine sont ceux de app/qualite/seuils.json", () => {
  const racine = couverture(lire("qualite/seuils.json"));
  assert.ok(Object.keys(racine).length > 0, "aucun seuil couverture.* à la racine");
  assert.deepStrictEqual(
    racine,
    couverture(lire("app/qualite/seuils.json")),
    "qualite/seuils.json diverge de app/qualite/seuils.json : reporter les valeurs",
  );
});
