'use strict';
/**
 * Entités & sous-dossiers par type.
 *  - `normaliserCle_` (Entites.gs) : matching insensible casse/accents/espaces.
 *  - `sousDossierPourType_` (Router.gs) : type_doc → sous-dossier d'entité, MAIS seulement s'il
 *    appartient au schéma FIXE du type d'entité (garde-fou « pas de dossier hors schéma »).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);

test('normaliserCle_ : minuscules, sans accents, espaces compactés', () => {
  assert.strictEqual(ctx.normaliserCle_('Éléctricité De France'), 'electricite de france');
  assert.strictEqual(ctx.normaliserCle_('  IRCC  '), 'ircc');
  assert.strictEqual(ctx.normaliserCle_('Bellerives\t\n  Banque'), 'bellerives banque');
  assert.strictEqual(ctx.normaliserCle_(null), '');
});

test('normaliserCle_ : apostrophes (droite ET typographique U+2019) → espace, matching uniforme', () => {
  assert.strictEqual(ctx.normaliserCle_('Avis d’imposition'), 'avis d imposition'); // U+2019
  assert.strictEqual(ctx.normaliserCle_("Avis d'imposition"), 'avis d imposition');  // U+0027
  assert.strictEqual(ctx.normaliserCle_('l’IUT'), 'l iut');
});

test('cleEntite_ : domaine|entité normalisés (évite les collisions inter-domaines)', () => {
  assert.strictEqual(ctx.cleEntite_('05 · Carrière', 'IUT UNIVA'), ctx.normaliserCle_('05 · Carrière') + '|' + 'iut univa');
});

test('sousDossierPourType_ : type mappé ET présent au schéma → le sous-dossier', () => {
  assert.strictEqual(ctx.sousDossierPourType_('Facture', 'Logement'), 'Factures');
  assert.strictEqual(ctx.sousDossierPourType_('Relevé', 'Compte financier'), 'Relevés');
  assert.strictEqual(ctx.sousDossierPourType_('Bail', 'Logement'), 'Bail & contrat');
});

test('sousDossierPourType_ : mapping insensible à la casse/aux accents', () => {
  assert.strictEqual(ctx.sousDossierPourType_('FACTURE', 'Logement'), 'Factures');
  assert.strictEqual(ctx.sousDossierPourType_('relevé', 'Compte financier'), 'Relevés');
});

test('sousDossierPourType_ : type mappé mais HORS schéma du type d\'entité → null (garde-fou)', () => {
  // « Relevé » → « Relevés », mais « Relevés » n\'est pas dans le schéma « Logement ».
  assert.strictEqual(ctx.sousDossierPourType_('Relevé', 'Logement'), null);
});

test('sousDossierPourType_ : type inconnu → null (racine d\'entité, pas de dossier inventé)', () => {
  assert.strictEqual(ctx.sousDossierPourType_('Truc bizarre', 'Logement'), null);
  assert.strictEqual(ctx.sousDossierPourType_('Facture', 'Type inexistant'), null);
});

test('correctionValideUneEntite_ (C6-04) : entité + domaine requis pour valider une entité', () => {
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: 'Zephyr', domaine: '03 · Logement & véhicule' }), true);
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: 'Zephyr', domaine: '' }), false); // domaine manquant → pas de routage
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: '', domaine: '02 · Finances' }), false);
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: '   ', domaine: '02 · Finances' }), false); // trim
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: 'Zephyr' }), false); // domaine absent
  assert.strictEqual(ctx.correctionValideUneEntite_(null), false);
});

test('entitesValideesParCle_ / entitesValideesOuNull_ : même carte, deux réponses à « la lecture a-t-elle abouti ? »', () => {
  // C28-93 : le routage doit continuer à recevoir la carte PARTIELLE construite avant l'exception
  // (dégradation réversible : le document part à plat, le run suivant le reprend), tandis que les
  // consommateurs qui écrivent du DÉFINITIF — une proposition de corbeille — ont besoin de savoir
  // que la lecture a échoué. Mutation : faire rendre `{}` à `entitesValideesParCle_` sur exception
  // (ce qu'une première écriture faisait) ⇒ l'assertion « partielle » tombe.
  const c = load(['Config.gs', 'Entites.gs']);
  const lignes = [
    { entite: 'Alphatek', domaine: '05 · Carrière', statut: 'validee', dossierId: 'ID1' },
    { entite: 'POISON', domaine: '05 · Carrière', statut: 'validee', dossierId: 'ID2' },
    { entite: 'Jamais lue', domaine: '05 · Carrière', statut: 'validee', dossierId: 'ID3' },
  ];
  c.entitesCache_ = () => ({ lignes: lignes, parCle: {} });
  c.estValidee_ = () => true;
  c.journalErreur_ = () => {};
  const vrai = c.cleCanoniqueEntite_;
  c.cleCanoniqueEntite_ = (d, e) => { if (e === 'POISON') throw new Error('libellé pathologique'); return vrai(d, e); };

  const partielle = c.entitesValideesParCle_();
  assert.strictEqual(Object.keys(partielle).length, 1, 'ce qui a été lu AVANT l\'exception reste utilisable');
  assert.strictEqual(c.entitesValideesOuNull_(), null, 'mais la lecture n\'a PAS abouti, et ça se dit');

  // Cas nominal : les deux rendent la même chose.
  c.cleCanoniqueEntite_ = vrai;
  assert.strictEqual(Object.keys(c.entitesValideesParCle_()).length, 3);
  assert.strictEqual(Object.keys(c.entitesValideesOuNull_()).length, 3);
});


function mockFeuilleEntites(lignesInit) {
  const rows = [
    ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'],
    ...(lignesInit || []),
  ];
  return {
    rows,
    sheet: {
      getLastRow: () => rows.length,
      getLastColumn: () => rows[0].length,
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValue: () => (rows[r - 1] && rows[r - 1][c - 1] !== undefined ? rows[r - 1][c - 1] : ''),
        setValue: (v) => {
          if (!rows[r - 1]) rows[r - 1] = [];
          rows[r - 1][c - 1] = v;
        },
        getValues: () => rows.slice(r - 1, r - 1 + nr).map((l) => Array.from({ length: nc }, (_, k) => (l[c - 1 + k] !== undefined ? l[c - 1 + k] : ''))),
        setValues: (vals) => {
          for (let i = 0; i < vals.length; i++) rows[r - 1 + i] = [...vals[i]];
        },
      }),
      appendRow: (arr) => rows.push([...arr]),
    },
  };
}

test('entiteValideeParDossierId_ : trouve l entité validée, exclut zones protégées et tolère mocks minimaux', () => {
  const store = mockFeuilleEntites([
    ['Alphatek', '05 · Carrière', 'Emploi & Carrière', 'Employeur', 'validée', 'DIR_ALPHA', '2026-10-01', '', 2],
    ['MIFI', '04 · Immigration', '', '', 'validée', 'DIR_IMMIG', '2026-10-01', '', 1],
    ['PersoAnna', 'Anna', '', '', 'validée', 'DIR_ANNA', '2026-10-01', '', 1],
    ['EnAttente', '05 · Carrière', '', '', 'en_attente', 'DIR_WAIT', '2026-10-01', '', 1],
  ]);
  const c = load(['Config.gs', 'Entites.gs'], {});
  c.feuille_ = () => store.sheet;
  c.reinitialiserEntitesCache_();

  const ok = c.entiteValideeParDossierId_('DIR_ALPHA');
  assert.strictEqual(ok.entite, 'Alphatek');
  assert.strictEqual(c.entiteValideeParDossierId_('DIR_IMMIG'), null);
  assert.strictEqual(c.entiteValideeParDossierId_('DIR_ANNA'), null);
  assert.strictEqual(c.entiteValideeParDossierId_('DIR_WAIT'), null);
  assert.strictEqual(c.entiteValideeParDossierId_(''), null);

  // Mock minimal (sans getLastColumn) : dégrade en null sans lever
  const cMin = load(['Config.gs', 'Entites.gs'], {});
  cMin.feuille_ = () => ({ getLastRow: () => 1 });
  cMin.reinitialiserEntitesCache_();
  assert.strictEqual(cMin.entiteValideeParDossierId_('DIR_ALPHA'), null);
});

test('renommerEntiteDepuisDossier_ : renomme, garde variante anti-doublon, route et gère aller-retour', () => {
  const store = mockFeuilleEntites([
    ['Alphatek', '05 · Carrière', 'Emploi & Carrière', 'Employeur', 'validée', 'DIR_ALPHA', '2026-10-01', '', 3],
    ['Bellerives', '03 · Logement & véhicule', 'Logement', 'Logement', 'validée', 'DIR_BELL', '2026-10-01', '', 2],
    ['MIFI', '04 · Immigration', '', '', 'validée', 'DIR_IMMIG', '2026-10-01', '', 1],
  ]);
  const c = load(['Config.gs', 'Entites.gs'], {});
  c.feuille_ = () => store.sheet;
  c.dossiersExistantsDomaine_ = () => ({ alphatek: 'DIR_ALPHA', betatek: 'DIR_ALPHA' });
  c.reinitialiserEntitesCache_();

  // Gardes : zones protégées, système, collision, inconnu
  assert.strictEqual(c.renommerEntiteDepuisDossier_('MIFI', 'MIFI Nouveau', '04 · Immigration'), false);
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Perso', 'Autre', 'Anna'), false);
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Alphatek', '_Technique', '05 · Carrière'), false);
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Alphatek', 'Bellerives', '03 · Logement & véhicule'), false);
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Inconnue', 'Nouvelle', '05 · Carrière'), false);

  // 1) Renommage Alphatek → Betatek
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Alphatek', 'Betatek', '05 · Carrière'), true);
  assert.strictEqual(store.rows[1][0], 'Betatek');
  assert.strictEqual(store.rows[1][7], 'alias : Alphatek');
  assert.strictEqual(store.rows.length, 5);
  assert.strictEqual(store.rows[4][0], 'Alphatek');
  assert.strictEqual(store.rows[4][4], 'variante de : Betatek');

  // L'ancien nom est bloqué contre toute re-création en entité
  const nbAvant = store.rows.length;
  c.entiteEnAttenteAjouter_({ domaine: '05 · Carrière', entite: 'Alphatek', categorie: 'Emploi & Carrière' });
  assert.strictEqual(store.rows.length, nbAvant, 'Alphatek bloqué par variante de : Betatek');

  // Routage (resoudreEntite_ et entitesValideesParCle_) résout l'ancien nom vers le dossier renommé
  const resAncien = c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Alphatek' });
  assert.strictEqual(resAncien.etat, 'connue');
  assert.strictEqual(resAncien.dossierId, 'DIR_ALPHA');
  assert.strictEqual(resAncien.entite, 'Betatek');

  const valMap = c.entitesValideesParCle_();
  assert.strictEqual(valMap[c.cleCanoniqueEntite_('05 · Carrière', 'Alphatek')].dossierId, 'DIR_ALPHA');
  assert.strictEqual(valMap[c.cleCanoniqueEntite_('05 · Carrière', 'Betatek')].dossierId, 'DIR_ALPHA');

  // Rechargement à froid : ne doit pas écraser l'entrée validée
  c.reinitialiserEntitesCache_();
  const resRech = c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Betatek' });
  assert.strictEqual(resRech.etat, 'connue');
  assert.strictEqual(resRech.dossierId, 'DIR_ALPHA');

  // 2) Aller-retour Betatek → Alphatek
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Betatek', 'Alphatek', '05 · Carrière'), true);
  assert.strictEqual(store.rows[1][0], 'Alphatek');
  assert.strictEqual(store.rows[1][7], 'alias : Alphatek, Betatek');
  assert.strictEqual(store.rows[4][4], 'refusée (remplacée par renommage)');
  assert.strictEqual(store.rows[5][0], 'Betatek');
  assert.strictEqual(store.rows[5][4], 'variante de : Alphatek');

  c.reinitialiserEntitesCache_();
  assert.strictEqual(c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Alphatek' }).etat, 'connue');
  assert.strictEqual(c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Betatek' }).dossierId, 'DIR_ALPHA');
});

test('renommerEntiteDepuisDossier_ : collision intra-domaine, suffixe juridique Omega Inc., en_attente homonyme et blocage générique', () => {
  const store = mockFeuilleEntites([
    ['Alphatek', '05 · Carrière', 'Emploi & Carrière', 'Employeur', 'validée', 'DIR_ALPHA', '2026-10-01', '', 3],
    ['Gamma', '05 · Carrière', 'Emploi & Carrière', 'Employeur', 'validée', 'DIR_GAMMA', '2026-10-01', '', 2],
    ['Delta', '05 · Carrière', 'Emploi & Carrière', 'Employeur', 'validée', 'DIR_DELTA', '2026-10-01', '', 2],
    ['Zeta', '05 · Carrière', 'Emploi & Carrière', 'Employeur', 'en_attente', '', '2026-10-01', '', 1],
  ]);
  const c = load(['Config.gs', 'Entites.gs'], {});
  c.feuille_ = () => store.sheet;
  c.reinitialiserEntitesCache_();

  // 1) Collision intra-domaine bloquée et libellé générique bloqué
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Alphatek', 'Gamma', '05 · Carrière'), false);
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Alphatek', 'Banque', '05 · Carrière'), false);

  // 2) Renommage Delta → Omega Inc. : resoudreEntite_('Omega') trouve 'Omega Inc.' à chaud et après rechargement
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Delta', 'Omega Inc.', '05 · Carrière'), true);
  const resChaud = c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Omega' });
  assert.strictEqual(resChaud.etat, 'connue');
  assert.strictEqual(resChaud.entite, 'Omega Inc.');
  assert.strictEqual(resChaud.dossierId, 'DIR_DELTA');

  c.reinitialiserEntitesCache_();
  const resFroid = c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Omega' });
  assert.strictEqual(resFroid.etat, 'connue');
  assert.strictEqual(resFroid.entite, 'Omega Inc.');
  assert.strictEqual(resFroid.dossierId, 'DIR_DELTA');

  // 3) Renommage Omega Inc. → Zeta (déjà présent en en_attente) : l'ancienne ligne en_attente passe en refusée
  assert.strictEqual(c.renommerEntiteDepuisDossier_('Omega Inc.', 'Zeta', '05 · Carrière'), true);
  assert.strictEqual(store.rows[4][4], 'refusée (remplacée par renommage)');
  assert.strictEqual(c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Zeta' }).etat, 'connue');
  assert.strictEqual(c.resoudreEntite_({ domaine: '05 · Carrière', entite: 'Zeta' }).dossierId, 'DIR_DELTA');
});
