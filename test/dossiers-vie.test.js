'use strict';
/**
 * ADR-0081 (vague 4a) — Dossiers de vie existants et liens mails ↔ Drive (`DossiersVie.gs`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));

function fakeSheetStore(initialSheets) {
  const sheets = {};
  for (const [name, rows] of Object.entries(initialSheets || {})) {
    sheets[name] = rows.map((r) => [...r]);
  }
  const makeSheetObj = (name) => ({
    getName: () => name,
    getLastRow: () => sheets[name].length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => sheets[name].slice(r - 1, r - 1 + nr).map((l) => l.slice(c - 1, c - 1 + nc)),
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          sheets[name][r - 1 + i] = [...vals[i]];
        }
      },
    }),
    appendRow: (row) => { sheets[name].push([...row]); },
  });
  return {
    rows: sheets,
    ss: {
      getSheetByName: (name) => (sheets[name] ? makeSheetObj(name) : null),
      insertSheet: (name) => {
        if (!sheets[name]) sheets[name] = [];
        return makeSheetObj(name);
      },
    },
    creerOnglet: (ss, name, cols) => {
      if (!sheets[name]) sheets[name] = [cols];
    },
  };
}

test('normaliserCleDossierVie_ : ignore spéciaux/_ et retire les années finales', () => {
  const c = load(['DossiersVie.gs']);

  assert.strictEqual(c.normaliserCleDossierVie_(''), null);
  assert.strictEqual(c.normaliserCleDossierVie_('_Doublons/Hydro-Exemple'), null);
  assert.strictEqual(c.normaliserCleDossierVie_('_Technique/script'), null);
  assert.strictEqual(c.normaliserCleDossierVie_('_Médias/Photo'), null);
  assert.strictEqual(c.normaliserCleDossierVie_('02 · Finances'), null);
  assert.strictEqual(c.normaliserCleDossierVie_('02 · Finances/2025'), null);

  assert.deepStrictEqual(
    plain(c.normaliserCleDossierVie_('02 · Finances/Hydro-Exemple/2025')),
    { chemin: '02 · Finances/Hydro-Exemple', domaine: '02 · Finances', entite: 'Hydro-Exemple' }
  );
  assert.deepStrictEqual(
    plain(c.normaliserCleDossierVie_('05 · Carrière / Alphatek')),
    { chemin: '05 · Carrière/Alphatek', domaine: '05 · Carrière', entite: 'Alphatek' }
  );
});

test('construireDossiersVie_ : agrège les lignes classées et formate les dates', () => {
  const c = load(['DossiersVie.gs']);
  const lignes = [
    ['k1', new Date('2026-08-15T10:00:00Z'), 'doc1.pdf', '02 · Finances', '02 · Finances/Hydro-Exemple/2026', 'classé'],
    ['k2', '2026-10-02T09:00:00Z', 'doc2.pdf', '02 · Finances', '02 · Finances/Hydro-Exemple', 'classé'],
    ['k3', '2026-11-01T00:00:00Z', 'doc3.pdf', '_Doublons', '_Doublons/Hydro-Exemple', 'doublon'],
    ['k4', '2026-11-05T00:00:00Z', 'doc4.pdf', '05 · Carrière', '05 · Carrière/Alphatek', 'quarantaine'],
    ['k5', '2026-09-20T00:00:00Z', 'doc5.pdf', '03 · Logement', '03 · Logement/Bellerives', 'classé'],
  ];

  const dossiers = plain(c.construireDossiersVie_(lignes));
  assert.strictEqual(dossiers.length, 2);
  assert.strictEqual(dossiers[0].chemin, '02 · Finances/Hydro-Exemple');
  assert.strictEqual(dossiers[0].nbDocs, 2);
  assert.strictEqual(dossiers[0].dernierDate, '2026-10-02');
  assert.strictEqual(dossiers[1].chemin, '03 · Logement/Bellerives');
  assert.strictEqual(dossiers[1].nbDocs, 1);
  assert.strictEqual(dossiers[1].dernierDate, '2026-09-20');
});

test('chercherDossiersVie_ et formaterContexteDossiersVie_ : classement par pertinence et plafond 3', () => {
  const c = load(['DossiersVie.gs']);
  const dossiers = [
    { chemin: '02 · Finances/Hydro-Exemple', domaine: '02 · Finances', entite: 'Hydro-Exemple', jetons: ['hydro', 'exemple'], nbDocs: 8, dernierDate: '2026-10-12' },
    { chemin: '03 · Logement/Bellerives', domaine: '03 · Logement', entite: 'Bellerives', jetons: ['bellerives'], nbDocs: 2, dernierDate: '2026-09-01' },
    { chemin: '05 · Carrière/Alphatek', domaine: '05 · Carrière', entite: 'Alphatek', jetons: ['alphatek'], nbDocs: 5, dernierDate: '2026-11-01' },
    { chemin: '03 · Véhicule/Garage Central', domaine: '03 · Véhicule', entite: 'Garage Central', jetons: ['garage', 'central'], nbDocs: 3, dernierDate: '2026-07-04' },
    { chemin: '02 · Finances/Banque Exemple', domaine: '02 · Finances', entite: 'Banque Exemple', jetons: ['banque', 'exemple'], nbDocs: 1, dernierDate: '2026-05-01' },
  ];

  const vides = c.chercherDossiersVie_({ expediteur: 'autre@inconnu.test', sujet: 'Bonjour', nom: 'note.pdf' }, dossiers, 3);
  assert.strictEqual(vides.length, 0);
  assert.strictEqual(c.formaterContexteDossiersVie_(vides), '');

  const match = plain(c.chercherDossiersVie_({
    expediteur: 'Facturation <factures@hydro-exemple.test>',
    sujet: 'Relevé mensuel Exemple Bellerives Central Alphatek',
    nom: 'releve.pdf',
  }, dossiers, 3));

  assert.strictEqual(match.length, 3, 'plafonné à max=3');
  assert.strictEqual(match[0].chemin, '02 · Finances/Hydro-Exemple', 'plus fort score (2 jetons + 8 docs)');

  const fmt = c.formaterContexteDossiersVie_(match.slice(0, 1));
  assert.ok(fmt.startsWith('Dossiers de vie existants dans Drive (privilégier si le document appartient au même dossier) :'));
  assert.ok(fmt.includes('- 02 · Finances/Hydro-Exemple (8 doc(s), dernier 2026-10)'));
});

test('dossiersVieCache_ : charge 1×/run et survit à une panne Sheet', () => {
  const store = fakeSheetStore({
    Index: [
      ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut'],
      ['k1', '2026-10-01', 'f1.pdf', '05 · Carrière', '05 · Carrière/Alphatek', 'classé'],
    ],
  });
  let lectures = 0;
  const ssProxy = {
    getSheetByName: (name) => {
      lectures++;
      return store.ss.getSheetByName(name);
    },
  };

  const c = load(['DossiersVie.gs'], { ss_: () => ssProxy });
  c.reinitialiserDossiersVieCache_();
  assert.strictEqual(c.dossiersVieCache_().length, 1);
  assert.strictEqual(c.dossiersVieCache_().length, 1);
  assert.strictEqual(lectures, 1, 'Index relu une seule fois par run');

  c.reinitialiserDossiersVieCache_();
  assert.strictEqual(c.dossiersVieCache_().length, 1);
  assert.strictEqual(lectures, 2);

  // Panne Sheet → ne lève jamais et renvoie []
  const cPanne = load(['DossiersVie.gs'], {
    ss_: () => { throw new Error('Sheet hors ligne'); },
  });
  assert.deepStrictEqual(plain(cPanne.dossiersVieCache_()), []);
});

test('enregistrerLienMailDrive_ : écrit Liens (adresse nue seule), filtre non-Gmail et non-classé, tolère panne Sheet', () => {
  const store = fakeSheetStore({});
  const erreurs = [];
  const c = load(['TriGmail.gs', 'DossiersVie.gs'], {
    ss_: () => store.ss,
    creerOnglet_: store.creerOnglet,
    journalErreur_: (s, m) => erreurs.push([s, m]),
  });

  assert.ok(Array.isArray(c.COLONNES_LIENS) && c.COLONNES_LIENS.length === 8);

  // Ignorés : non-classé ou source non-Gmail
  c.enregistrerLienMailDrive_({ cle: 'depots|1', expediteur: 'a@exemple.test' }, { fileId: 'f1', statut: 'classé', domaine: '02 · Finances', chemin: '02 · Finances/Alphatek', nom: 'fact.pdf' });
  c.enregistrerLienMailDrive_({ cle: 'gmail|1', threadId: 't1', messageId: 'm1', expediteur: 'a@exemple.test' }, { fileId: 'f1', statut: 'doublon', domaine: '_Doublons', chemin: '_Doublons', nom: 'fact.pdf' });
  assert.strictEqual(store.rows.Liens, undefined);

  // Gmail avec messageId/threadId et format "Nom <adresse>" → adresse nue seule
  c.enregistrerLienMailDrive_({
    cle: 'm1|0|facture.pdf|120',
    threadId: 'thr-101',
    messageId: 'msg-202',
    expediteur: 'Service Client <Factures@Alphatek.Test>',
  }, {
    fileId: 'file-abc',
    statut: 'classé',
    domaine: '05 · Carrière',
    chemin: '05 · Carrière/Alphatek',
    nom: '2026-11-23_Contrat_Alphatek.pdf',
  });

  assert.strictEqual(store.rows.Liens.length, 2);
  const ligne = store.rows.Liens[1];
  assert.ok(ligne[0] instanceof Date);
  assert.strictEqual(ligne[1], 'thr-101');
  assert.strictEqual(ligne[2], 'msg-202');
  assert.strictEqual(ligne[3], 'factures@alphatek.test');
  assert.strictEqual(ligne[4], '05 · Carrière');
  assert.strictEqual(ligne[5], '05 · Carrière/Alphatek');
  assert.strictEqual(ligne[6], 'file-abc');
  assert.strictEqual(ligne[7], '2026-11-23_Contrat_Alphatek.pdf');

  // Panne Sheet lors de l'écriture → journalErreur_ 1×/run, jamais bloquant
  const cErr = load(['TriGmail.gs', 'DossiersVie.gs'], {
    ss_: () => { throw new Error('Sheet HS'); },
    journalErreur_: (s, m) => erreurs.push([s, m]),
  });
  cErr.reinitialiserDossiersVieCache_();
  cErr.enregistrerLienMailDrive_({ threadId: 't1', messageId: 'm1', expediteur: 'a@test' }, { fileId: 'f1', statut: 'classé' });
  cErr.enregistrerLienMailDrive_({ threadId: 't2', messageId: 'm2', expediteur: 'a@test' }, { fileId: 'f2', statut: 'classé' });
  assert.strictEqual(erreurs.length, 1, 'une seule erreur journalisée par run');
});

test('intégration Pipeline + Llm + Main + DossiersVie : injecte les dossiers existants et consigne le lien', () => {
  const store = fakeSheetStore({
    Index: [
      ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut'],
      ['ex-1', '2026-10-10', '2026-10-10_Contrat_Alphatek.pdf', '05 · Carrière', '05 · Carrière/Alphatek', 'classé'],
    ],
  });
  const payloadsLlm = [];
  const fakeEnv = {
    feuille_: (nom) => {
      if (nom === 'Liens' && !store.rows.Liens) {
        store.creerOnglet(store.ss, 'Liens', ['Horodatage', 'ThreadId', 'MessageId', 'Expéditeur', 'Domaine', 'Chemin', 'FileId', 'Fichier']);
      }
      return store.ss.getSheetByName(nom);
    },
    ss_: () => store.ss,
    creerOnglet_: store.creerOnglet,
    cleAttachement_: (m, i, p) => (typeof m.getId === 'function' ? m.getId() : 'm') + '|' + i + '|' + p.getName() + '|' + p.getSize(),
    indexContient_: () => false,
    estDoublon_: () => false,
    indexAjouter_: () => {},
    extraireTexte_: () => 'Contrat de travail Alphatek',
    exemplesFewShot_: () => '',
    estPannePlateforme_: () => false,
    signalerRetablissement_: () => {},
    enregistrerUsage_: () => {},
    cleLlm_: () => 'cle-fictive',
    creerRaccourcisEntites_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'DriveAI_ANTHROPIC_KEY' ? 'cle-fictive' : null),
      }),
    },
    UrlFetchApp: {
      fetch: (_url, opts) => {
        const body = JSON.parse(opts.payload);
        payloadsLlm.push(body.messages[0].content);
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            content: [{
              type: 'text',
              text: JSON.stringify({
                domaine: '05 · Carrière',
                categorie: 'Emploi & Carrière',
                entite: 'Alphatek',
                type_doc: 'Contrat',
                date_doc: '2026-11-20',
                emetteur: 'Alphatek',
                sensible: false,
                confiance: 0.95,
              }),
            }],
            usage: { input_tokens: 100, output_tokens: 40 },
          }),
        };
      },
    },
    deposer_: () => 'file-pj-999',
    empreinteBlob_: () => 'md5-test',
    extension_: () => 'pdf',
    estTechnique_: () => false,
    estMediaDirect_: () => false,
    estPhoto_: () => false,
    estNomNonDocumentaire_: () => false,
    domainesAutorises_: () => ['05 · Carrière', '02 · Finances'],
    categoriesConnues_: () => ['Emploi & Carrière'],
    enrichirClassifDepuisNom_: () => {},
    incrementerEchec_: () => 1,
    notifierEchec_: (s, m) => assert.fail('notifierEchec_ inattendu: ' + s + ' / ' + m),
    deciderRoutage_: () => ({
      statut: 'classé',
      dossierId: 'dos-alphatek',
      domaine: '05 · Carrière',
      chemin: '05 · Carrière/Alphatek',
      nom: '2026-11-20_Contrat_Alphatek.pdf',
    }),
  };

  const c = load([
    'Config.gs', 'Cout.gs', 'Prefiltre.gs', 'Ocr.gs', 'DriveRest.gs',
    'Gemini.gs', 'Llm.gs', 'Pipeline.gs', 'TriGmail.gs', 'DossiersVie.gs', 'Main.gs',
  ], fakeEnv);
  c.CONFIG.ANALYSE_V2 = false;
  c.reinitialiserDossiersVieCache_();
  c.gererEchec_ = (_s, msg) => assert.fail('gererEchec_ inattendu: ' + msg);

  const fakeMsg = {
    getId: () => 'msg-555',
    getThread: () => ({ getId: () => 'thr-444' }),
    getFrom: () => 'RH Alphatek <rh@alphatek.test>',
    getSubject: () => 'Contrat signé',
    getDate: () => new Date('2026-11-20T12:00:00Z'),
  };
  const fakePj = {
    getName: () => 'contrat_alphatek.pdf',
    getSize: () => 1024,
    copyBlob: () => ({
      getBytes: () => [1, 2, 3],
      getName: () => 'contrat_alphatek.pdf',
      getContentType: () => 'application/pdf',
    }),
  };

  c.traiterPjGmail_(fakeMsg, 0, fakePj);

  assert.strictEqual(payloadsLlm.length, 1);
  assert.ok(payloadsLlm[0].indexOf('Nom du fichier :') === 0);
  assert.ok(payloadsLlm[0].includes('Dossiers de vie existants dans Drive'));
  assert.ok(payloadsLlm[0].includes('05 · Carrière/Alphatek'));
  assert.strictEqual(store.rows.Liens.length, 2);
  assert.strictEqual(store.rows.Liens[1][1], 'thr-444');
  assert.strictEqual(store.rows.Liens[1][2], 'msg-555');
  assert.strictEqual(store.rows.Liens[1][3], 'rh@alphatek.test');
  assert.strictEqual(store.rows.Liens[1][6], 'file-pj-999');

  // Compatibilité mock sans getThread ni dossier correspondant → prompt inchangé sans ligne vide ajoutée
  c.traiterPjGmail_({
    getFrom: () => 'inconnu@autre.test',
    getSubject: () => 'Note diverse',
    getDate: () => new Date('2026-11-20T12:00:00Z'),
    getId: () => 'msg-777',
  }, 0, {
    getName: () => 'note_diverse.pdf',
    getSize: () => 512,
    copyBlob: () => ({
      getBytes: () => [4, 5, 6],
      getName: () => 'note_diverse.pdf',
      getContentType: () => 'application/pdf',
    }),
  });
  assert.strictEqual(payloadsLlm.length, 2);
  assert.ok(!payloadsLlm[1].includes('Dossiers de vie existants'));
  assert.ok(payloadsLlm[1].includes('Sujet : Note diverse\nExtrait du contenu'));
});
