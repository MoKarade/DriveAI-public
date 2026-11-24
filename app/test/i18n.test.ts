/**
 * i18n.test.ts — parité FR/EN et intégrité des clés bilingues ajoutées pour F1/F2/R3.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { t, langueCourante, changerLangue, type CleTexte, type Langue } from '../src/i18n';

const NOUVELLES_CLES: CleTexte[] = [
  'porteeRecherche',
  'porteeDossier',
  'porteeDossierNom',
  'porteeToutDrive',
  'rechercherDansDossierPlaceholder',
  'resultatsIncomplets',
  'etatMoteurTitre',
  'compteLlmLibelle',
  'compteLlmActif',
  'compteLlmPanne',
  'compteLlmInconnu',
  'triGmailLibelle',
  'triGmailNormal',
  'triGmailArret',
  'triGmailInconnu',
  'jaugeTriHisto',
  'fileRevueTitre',
  'statutsIndexTitre',
  'statutATrier',
  'statutDoublon',
  'statutManuel',
  'statutErreur',
  'statutConfianceBasse',
  'triErreurs',
  'triAVerifier',
  'appelsMois',
  'freinCampagnes',
  'archivageHonneteNote',
  'maintenanceTitre',
  'dernierePasseLibelle',
  'statutClasse',
  'statutTechnique',
  'statutMedia',
  'triSuspects',
  'triFilsTriesLibelle',
  'alertesActivesTitre',
  'passeRecenteTitre',
  'aucuneErreur7j',
  'totalCoutsLibelle',
  'operationsActivesLibelle',
  'quotaGmailResume',
  'reorgAValider',
  'dossiersVidesCourt',
  'reorgRefusesLibelle',
  'videsBloqueesLibelle',
  'coutMoisLibelle',
  'sousTitreAccueil',
  'sousTitreDocuments',
  'sousTitreReglages',
];

const CLES_R4_COMPL: CleTexte[] = [
  'rechercheRapide',
  'omniboxTitre',
  'omniboxPlaceholder',
  'omniboxIndice',
  'omniboxEcrans',
  'omniboxResultatsDrive',
  'omniboxOuvrirDossier',
  'etat',
  'sousTitreEtat',
  'sousTitrePreferences',
  'reorgAccueilLibelle',
  'videsAccueilLibelle',
  'voirDansDocuments',
  'triArchivesJour',
  'jaugeAnciensLus',
  'jaugeFondTri',
  'archivageMesureNote',
  'filtresRapides',
  'filtreTout',
  'filtreDossiers',
  'filtrePdf',
  'filtreAVerifier',
  'filtreConfianceBasse',
  'dossierParent',
  'arianeApproximatif',
  'copierLien',
  'lienCopie',
  'lienCopieEchec',
  'dossierCreeOk',
  'badgeIndexClasse',
  'badgeIndexATrier',
  'badgeIndexAVerifier',
  'badgeIndexDoublon',
  'badgeIndexManuel',
  'badgeIndexQuarantaine',
  'badgeIndexTechnique',
  'badgeIndexErreur',
  'badgeIndexMedia',
  'badgeIndexConfianceBasse',
  'themeLibelle',
  'themeSombre',
  'themeClair',
];

const CLES_REFONTE_REGLAGES_ETAT: CleTexte[] = [
  'sectionMoteurSynchro',
  'sectionApparence',
  'sectionCompte',
  'descFrequenceTick',
  'descTheme',
  'descLangue',
  'descSynchro',
  'descPassageImmediat',
  'descSession',
  'passageImmediatLibelle',
  'lancerPassage',
  'lancementPassage',
  'passageLanceOk',
  'synchroEnCoursLibelle',
  'synchroAJour',
  'derniereLecture',
  'toutEstAJour',
  'ouvrirAujourdhui',
  'ouvrirDocuments',
];

const CLES_LOT_1B_COPILOTE: CleTexte[] = [
  'copilote',
  'sousTitreCopilote',
  'copiloteSemaineTitre',
  'copiloteSemaineNote',
  'copiloteStatMouvements',
  'copiloteStatDossiers',
  'copiloteStatApprentissages',
  'copiloteFilTitre',
  'copiloteFiltresLabel',
  'copiloteFiltreTous',
  'copiloteFiltreDossiers',
  'copiloteFiltreFichiers',
  'copiloteFiltreApprentissages',
  'copiloteBadgeDossier',
  'copiloteBadgeFichier',
  'copiloteBadgeApprentissage',
  'copiloteAucunMouvement',
  'copiloteAucunFiltre',
];

describe('i18n (FR / EN)', () => {
  it('chaque nouvelle clé F1/F2/R3 est renseignée et non vide en FR et EN', () => {
    for (const cle of NOUVELLES_CLES) {
      const fr = t(cle, 'fr');
      const en = t(cle, 'en');
      expect(fr.trim().length, `fr.${cle}`).toBeGreaterThan(0);
      expect(en.trim().length, `en.${cle}`).toBeGreaterThan(0);
    }
  });

  it('les 42 clés R4 (dont badgeIndexTechnique/Erreur/Media) sont non vides en FR et EN avec leurs jetons', () => {
    expect(CLES_R4_COMPL).toHaveLength(42);
    for (const cle of CLES_R4_COMPL) {
      const fr = t(cle, 'fr');
      const en = t(cle, 'en');
      expect(fr.trim().length, `fr.${cle}`).toBeGreaterThan(0);
      expect(en.trim().length, `en.${cle}`).toBeGreaterThan(0);
    }
    expect(t('reorgAccueilLibelle', 'fr')).toContain('{n}');
    expect(t('reorgAccueilLibelle', 'en')).toContain('{n}');
    expect(t('videsAccueilLibelle', 'fr')).toContain('{n}');
    expect(t('videsAccueilLibelle', 'en')).toContain('{n}');
    expect(t('dossierCreeOk', 'fr')).toContain('{nom}');
    expect(t('dossierCreeOk', 'en')).toContain('{nom}');
  });

  it('porteeDossierNom conserve le jeton {nom} dans les deux langues', () => {
    expect(t('porteeDossierNom', 'fr')).toContain('{nom}');
    expect(t('porteeDossierNom', 'en')).toContain('{nom}');
  });

  it('préserve les clés historiques requises par Explorateur.tsx', () => {
    expect(t('resultatsTronques', 'fr').trim().length).toBeGreaterThan(0);
    expect(t('resultatsTronques', 'en').trim().length).toBeGreaterThan(0);
  });

  it('compteLlmLibelle correspond au contrat /Compte LLM/i en français', () => {
    expect(t('compteLlmLibelle', 'fr')).toMatch(/Compte LLM/i);
    expect(t('compteLlmLibelle', 'en')).toMatch(/LLM account/i);
  });

  it('les 19 clés de refonte Réglages & État sont non vides en FR/EN avec {heure}', () => {
    expect(CLES_REFONTE_REGLAGES_ETAT).toHaveLength(19);
    for (const cle of CLES_REFONTE_REGLAGES_ETAT) {
      expect(t(cle, 'fr').trim().length, `fr.${cle}`).toBeGreaterThan(0);
      expect(t(cle, 'en').trim().length, `en.${cle}`).toBeGreaterThan(0);
    }
    expect(t('synchroAJour', 'fr')).toContain('{heure}');
    expect(t('synchroAJour', 'en')).toContain('{heure}');
    expect(t('derniereLecture', 'fr')).toContain('{heure}');
    expect(t('derniereLecture', 'en')).toContain('{heure}');
  });

  it('marquerVu, reafficherErreursVues et logique classement Drive/Gmail sont renseignées en FR/EN', () => {
    expect(t('marquerVu', 'fr').trim().length).toBeGreaterThan(0);
    expect(t('marquerVu', 'en').trim().length).toBeGreaterThan(0);
    expect(t('reafficherErreursVues', 'fr')).toContain('{n}');
    expect(t('reafficherErreursVues', 'en')).toContain('{n}');
    for (const cle of [
      'enCoursMaintenantTitre',
      'logiqueTitre',
      'logiqueDriveTitre',
      'logiqueDriveSourcesTitre',
      'logiqueDriveSourcesTexte',
      'logiqueDriveFiltresTitre',
      'logiqueDriveFiltresTexte',
      'logiqueDriveAnalyseTitre',
      'logiqueDriveAnalyseTexte',
      'logiqueDriveSecuriteTitre',
      'logiqueDriveSecuriteTexte',
      'logiqueGmailTitre',
      'logiqueGmailPerimetreTitre',
      'logiqueGmailPerimetreTexte',
      'logiqueGmailLibellesTitre',
      'logiqueGmailLibellesTexte',
      'logiqueGmailArchivageTitre',
      'logiqueGmailArchivageTexte',
      'logiqueGmailSecuriteTitre',
      'logiqueGmailSecuriteTexte',
    ] as const) {
      expect(t(cle, 'fr').trim().length, `fr.${cle}`).toBeGreaterThan(0);
      expect(t(cle, 'en').trim().length, `en.${cle}`).toBeGreaterThan(0);
    }
  });

  it('les 18 clés Copilote Lot 1B sont non vides en FR et EN', () => {
    expect(CLES_LOT_1B_COPILOTE).toHaveLength(18);
    for (const cle of CLES_LOT_1B_COPILOTE) {
      expect(t(cle, 'fr').trim().length, `fr.${cle}`).toBeGreaterThan(0);
      expect(t(cle, 'en').trim().length, `en.${cle}`).toBeGreaterThan(0);
    }
  });
});

describe('i18n — gardes localStorage (GAP-3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('langueCourante et changerLangue ne lèvent rien quand localStorage est absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(langueCourante()).toBe('fr');
    expect(() => changerLangue('en')).not.toThrow();
  });

  it('langueCourante et changerLangue tolèrent SecurityError / QuotaExceededError sur getItem/setItem', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    expect(langueCourante()).toBe('fr');
    expect(() => changerLangue('en')).not.toThrow();
  });

  it('langueCourante rejette les valeurs corrompues (es, FR, null) et garde fr/en valides', () => {
    let stock: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in stock ? stock[k]! : null),
      setItem: (k: string, v: string) => { stock[k] = v; },
    });

    for (const invalide of ['es', 'FR', 'null', '', 'en-US']) {
      stock = { 'driveai.langue': invalide };
      const l = langueCourante();
      expect(l).toBe('fr');
      expect(t('aujourdhui', l)).toBe('Aujourd’hui');
    }

    changerLangue('en');
    expect(langueCourante()).toBe('en');
    changerLangue('invalid' as Langue);
    expect(langueCourante()).toBe('fr');
  });
});
