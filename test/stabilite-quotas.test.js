'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

test('stabilite-quotas : lecture, cumul et rollover à minuit des budgets quotidiens en ms', () => {
  const c = load(['Config.gs', 'Suivi.gs', 'Main.gs']);
  const mem = {};
  const props = {
    getProperty: (k) => (k in mem ? mem[k] : null),
    setProperty: (k, v) => { mem[k] = String(v); },
  };

  assert.strictEqual(c.lireBudgetMsJour_(props, 'K', '2026/11/24'), 0);
  assert.strictEqual(c.ajouterBudgetMsJour_(props, 'K', '2026/11/24', 90000), 90000);
  assert.strictEqual(c.ajouterBudgetMsJour_(props, 'K', '2026/11/24', 30000), 120000);
  assert.strictEqual(c.lireBudgetMsJour_(props, 'K', '2026/11/24'), 120000);
  assert.strictEqual(c.lireBudgetMsJour_(props, 'K', '2026/11/25'), 0, 'rollover minuit remet le compteur à 0');

  // Valeurs corrompues ou négatives ignorées sans erreur
  mem.CORR = '2026/11/24|-50';
  assert.strictEqual(c.lireBudgetMsJour_(props, 'CORR', '2026/11/24'), 0);
  assert.strictEqual(c.ajouterBudgetMsJour_(props, 'K', '2026/11/24', -100), 120000);
  assert.strictEqual(c.ajouterBudgetMsJour_(props, 'K', '2026/11/24', NaN), 120000);

  // Seuils par défaut : 78 min/j pour le quota Google, 60 min/j pour le rangement
  assert.strictEqual(c.estQuotaTickJourAtteint_(77 * 60000), false);
  assert.strictEqual(c.estQuotaTickJourAtteint_(78 * 60000), true);
  assert.strictEqual(c.estBudgetRangementJourAtteint_(59 * 60000), false);
  assert.strictEqual(c.estBudgetRangementJourAtteint_(60 * 60000), true);
});

test('stabilite-quotas : rangement borné à 90s/tick ne bloque plus intake-depots, et coupe-circuit 78 min/j épargne le flux critique', () => {
  const mem = {};
  const appels = { rangement: 0, depots: 0, partages: 0, tri: 0, reorg: 0, sync: 0, sante: 0 };
  let rangementEstDepassePendantRun = null;

  let horloge = 1764000000000;
  const FakeDate = class extends Date {
    constructor(...a) { super(...(a.length ? a : [horloge])); }
    static now() { return horloge; }
  };

  const c = load(['Config.gs', 'Suivi.gs', 'Main.gs'], {
    Date: FakeDate,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in mem ? mem[k] : null),
        setProperty: (k, v) => { mem[k] = String(v); },
        deleteProperty: (k) => { delete mem[k]; },
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    journalInfo_: () => {},
    journalErreur_: () => {},
  });

  c.etatProfilPrive_ = () => ({ etat: 'ok', raison: '' });
  for (const fn of [
    'reinitialiserIndexCache_', 'reinitialiserEntitesCache_', 'reinitialiserCorrectionsCache_',
    'reinitialiserEscalades_', 'chargerPannePlateforme_', 'chargerPanneGmail_',
    'reinitialiserTriApprisCache_', 'reinitialiserConfianceCache_', 'reinitialiserFicheCache_',
    'reinitialiserEscaladeTri_', 'reinitialiserBrouillonsTri_', 'reinitialiserLibellesCrees_', 'reinitialiserLibellesCache_',
    'reinitialiserPromoSetCache_', 'reinitialiserPanneEcriture_', 'reinitialiserUsage_',
    'reinitialiserFreinBudget_', 'assurerIntervalleTick_', 'assurerTriggerResume_',
    'assurerTriggerChienDeGarde_', 'assurerNomsDomaines_', 'appliquerRejeuSiNouvelleVersion_',
    'dequarantainerLignes_', 'seedEntitesMarc_', 'creerDossiersEntitesValidees_',
    'appliquerCurationEntites_', 'appliquerRelancesQuarantaine_', 'lireEtAppliquerCorrections_',
    'appliquerCorrectionsManuelles_', 'majProgressions_', 'majTelemetrie_', 'majCouts_',
    'majResumeHub_', 'majHistoriqueVrac_', 'majValidationDoublons_', 'bornerJournal_',
    'majProgressionsFinTick_', 'flushUsage_', 'traiterGmail_', 'apprendreFiche_',
    'traiterGmailHistorique_', 'appliquerMigrationTaxonomie_', 'appliquerReanalyseCiblee_',
    'appliquerDryRunV2_', 'appliquerComparaisonV2_', 'retournerOrphelinsDoublons_',
  ]) {
    c[fn] = () => {};
  }
  c.majSante_ = () => { appels.sante++; };
  c.estPannePlateforme_ = () => false;
  c.estPanneGmail_ = () => false;
  c.budgetCampagnesAtteint_ = () => false;
  c.resetEnCours_ = () => false;
  c.rangementTermine_ = () => false;
  c.nbFichiersATrier_ = () => 5;
  c.etatResolutionFileId_ = () => 'terminé';
  c.panneResolutionFileId_ = () => ({ depuisMs: 0 });
  c.resolutionFileIdDoitTourner_ = () => false;
  c.gMissionsJour_ = () => null;
  c.gMissionsAmont03_ = () => null;
  for (const fn of [
    'appliquerPlanConsolidation_', 'genererPlanConsolidation_', 'executerMission_',
    'appliquerPlanFusion_', 'rassemblerReset_', 'placerReset_',
    'appliquerReset04Interne_', 'analyserReliquatReset_',
  ]) {
    c[fn] = () => {};
  }

  // Rangement simule 95 s d'exécution : doit voir son estBudgetDepasse passer à true à 90 s sans dépasser le budget global 180 s.
  c.appliquerRangementInitial_ = (estDepasse) => {
    appels.rangement++;
    assert.strictEqual(estDepasse(), false);
    horloge += 95000;
    rangementEstDepassePendantRun = estDepasse();
  };
  c.traiterDepots_ = () => { appels.depots++; };
  c.collecterPartages_ = () => { appels.partages++; };
  c.trierFilsGmail_ = () => { appels.tri++; };
  c.etapeReorg_ = () => { appels.reorg++; };
  c.synchroniserIndex_ = () => { appels.sync++; };

  c.tickDriveAI();
  assert.strictEqual(appels.rangement, 1);
  assert.strictEqual(rangementEstDepassePendantRun, true, 'rangement doit couper à 90s/tick');
  assert.strictEqual(appels.depots, 1, 'intake-depots doit passer dans le même tick');
  assert.strictEqual(appels.partages, 1, 'intake-partages doit passer dans le même tick');
  assert.strictEqual(appels.tri, 1, 'tri-gmail doit passer');
  assert.strictEqual(appels.reorg, 1, 'reorg doit passer');
  assert.strictEqual(appels.sync, 1, 'reconciliation-index doit passer');
  assert.strictEqual(appels.sante, 1);

  const aujourdhui = c.budgetJourDate_();
  assert.strictEqual(c.lireBudgetMsJour_({ getProperty: (k) => mem[k] }, 'DriveAI_RANGEMENT_JOUR_MS', aujourdhui), 95000);
  assert.ok(c.lireBudgetMsJour_({ getProperty: (k) => mem[k] }, 'DriveAI_TICK_JOUR_MS', aujourdhui) >= 95000);

  // Run 2 : si DriveAI_TICK_JOUR_MS >= 78 min/j, rangement/reorg/sync sont sautés, tri-gmail et sante restent actifs.
  mem.DriveAI_TICK_JOUR_MS = aujourdhui + '|' + (78 * 60000);
  c.tickDriveAI();
  assert.strictEqual(appels.rangement, 1, 'rangement sauté sous quota jour Google');
  assert.strictEqual(appels.reorg, 1, 'reorg sauté sous quota jour Google');
  assert.strictEqual(appels.sync, 1, 'reconciliation-index sauté sous quota jour Google');
  assert.strictEqual(appels.tri, 2, 'tri-gmail reste actif jusqu à minuit');
  assert.strictEqual(appels.sante, 2, 'sante reste actif');
});
