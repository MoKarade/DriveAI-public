// @vitest-environment jsdom
/**
 * vues-dom.test.ts — tests d'interaction DOM (@testing-library/react + jsdom) pour les vues
 * principales : `AujourdHui` (`P0-3`), `Documents` + `Explorateur` + `ReorgVue` (`P1-1`,
 * `P1-2`, `P1-3`), `Etat` (`P0-4`) et `Reglages` (`P2-1`).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import {
  interpreterIndex,
  interpreterProgression,
  type LigneIndex,
  type LigneProgression,
} from '../src/etat';
import type { DonneesEtat } from '../src/etatGlobal';
import type { ElementDrive, Etape } from '../src/explorateur';
import { plageMock } from '../src/mockData';
import type { CheminDossierResolu, OptionsRechercheDrive, PageDrive, ResultatRechercheDrive } from '../src/google';

const mockEtat = vi.hoisted(() => ({
  donnees: null as DonneesEtat | null,
  progression: [] as LigneProgression[],
  erreur: '',
  synchroA: new Date('2026-07-06T14:12:00Z') as Date | null,
  rafraichir: vi.fn(async () => {}),
}));

const spies = vi.hoisted(() => ({
  connecte: true,
  lirePlage: vi.fn<(onglet: string, plage: string) => Promise<string[][]>>(),
  ecrireCellule: vi.fn<(onglet: string, cellule: string, valeur: string) => Promise<void>>(),
  ecrireColonnePlage: vi.fn<
    (onglet: string, colonne: string, debut: number, valeurs: string[]) => Promise<void>
  >(),
  ajouterLigne: vi.fn<(onglet: string, ligne: (string | number)[]) => Promise<void>>(),
  marquerPasSuspect: vi.fn<(threadId: string) => Promise<string>>(),
  demanderPassageMoteur: vi.fn<() => Promise<string>>(),
  listerEnfants: vi.fn<(dossierId: string, pageToken?: string) => Promise<PageDrive>>(),
  rechercherDrive: vi.fn<
    (texte: string, options?: OptionsRechercheDrive) => Promise<ResultatRechercheDrive>
  >(),
  creerDossier: vi.fn<(nom: string, parentId: string) => Promise<ElementDrive>>(),
  deplacerFichierManuel: vi.fn<
    (args: { fileId: string; nouveauParent: string; nomCible?: string }) => Promise<boolean>
  >(),
  libelleParentEnCache: vi.fn<
    (
      element: Pick<ElementDrive, 'parents'>,
      options?: { nomRacine?: string; nomsSupplementaires?: ReadonlyMap<string, string> },
    ) => string | null
  >(),
  resoudreCheminDossier: vi.fn<
    (
      dossier: string | { id: string; nom?: string; name?: string; parents?: string[] },
      options?: { nomRacine?: string; maxProfondeur?: number },
    ) => Promise<CheminDossierResolu>
  >(),
  corbeillerDossierVide: vi.fn<(folderId: string) => Promise<void>>(),
}));

vi.mock('../src/etatGlobal', () => ({
  useEtatGlobal: () => ({
    donnees: mockEtat.donnees,
    erreur: mockEtat.erreur,
    synchroA: mockEtat.synchroA,
    rafraichir: mockEtat.rafraichir,
  }),
  useProgressionLive: () => mockEtat.progression,
}));

vi.mock('../src/config', () => ({
  lireConfig: () => ({ spreadsheetId: 'feuille-mock', webappUrl: '', webappSecret: '' }),
  chargerConfigServeur: vi.fn(async () => true),
}));

vi.mock('../src/google', () => ({
  MARQUEUR_DROITS_FICHIER: 'droits-insuffisants-sur-element',
  estConnecte: () => spies.connecte,
  lirePlage: spies.lirePlage,
  ecrireCellule: spies.ecrireCellule,
  ecrireColonnePlage: spies.ecrireColonnePlage,
  ajouterLigne: spies.ajouterLigne,
  marquerPasSuspect: spies.marquerPasSuspect,
  demanderPassageMoteur: spies.demanderPassageMoteur,
  listerEnfants: spies.listerEnfants,
  rechercherDrive: spies.rechercherDrive,
  creerDossier: spies.creerDossier,
  deplacerFichierManuel: spies.deplacerFichierManuel,
  libelleParentEnCache: spies.libelleParentEnCache,
  resoudreCheminDossier: spies.resoudreCheminDossier,
}));

vi.mock('../src/corbeille', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../src/corbeille')>();
  return {
    ...reel,
    corbeillerDossierVide: spies.corbeillerDossierVide,
  };
});

import { AujourdHui } from '../src/vues/AujourdHui';
import { Documents } from '../src/vues/Documents';
import { Explorateur } from '../src/vues/Explorateur';
import { ReorgVue } from '../src/vues/Reorg';
import { Etat } from '../src/vues/Etat';
import { Reglages } from '../src/vues/Reglages';

function dateHorodatageRecent(): string {
  return new Date().toISOString().slice(0, 19);
}

function datePasseRecent(): string {
  const d = new Date(Date.now() - 2 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function donneesBase(surcharges?: Partial<DonneesEtat>): DonneesEtat {
  return {
    index: interpreterIndex(plageMock('Index', 'A2:H')),
    santeBrut: [
      [`Dernier passage OK : ${datePasseRecent()}`],
      ['Documents au catalogue (Index) : 1842'],
      ['Coût LLM 2026-07 : 8.42 $  (1210 appels)  ·  cible < 10 $/mois'],
      ['Tri Gmail : ✅ normal (libellés + archivage)'],
      ['Compte LLM : actif'],
    ],
    journalBrut: [],
    reglagesBrut: [['TICK_MINUTES', '5']],
    telemetrieBrut: plageMock('Télémétrie', 'A2:D'),
    coutsBrut: plageMock('Coûts', 'A2:D'),
    reorgBrut: [],
    ...surcharges,
  };
}

function ligne(
  cle: string,
  fichier: string,
  statut: string,
  extras?: Partial<LigneIndex>,
): LigneIndex {
  return {
    cle,
    traiteLe: dateHorodatageRecent(),
    fichier,
    domaine: '',
    chemin: '',
    statut,
    confiance: '',
    ...extras,
  };
}

function creerDataTransfert() {
  const magasin = new Map<string, string>();
  return {
    effectAllowed: 'all',
    clearData: () => magasin.clear(),
    setData: (type: string, valeur: string) => {
      magasin.set(type, valeur);
    },
    getData: (type: string) => magasin.get(type) ?? '',
  };
}

function reinitialiserSpies() {
  spies.connecte = true;
  mockEtat.donnees = donneesBase();
  mockEtat.progression = interpreterProgression(plageMock('Progression', 'A2:M'));
  mockEtat.erreur = '';
  mockEtat.synchroA = new Date('2026-07-06T14:12:00Z');
  mockEtat.rafraichir.mockReset().mockResolvedValue(undefined);

  spies.lirePlage.mockReset().mockResolvedValue([]);
  spies.ecrireCellule.mockReset().mockResolvedValue(undefined);
  spies.ecrireColonnePlage.mockReset().mockResolvedValue(undefined);
  spies.ajouterLigne.mockReset().mockResolvedValue(undefined);
  spies.marquerPasSuspect.mockReset().mockResolvedValue('ok');
  spies.demanderPassageMoteur.mockReset().mockResolvedValue('passage lancé');
  spies.listerEnfants.mockReset().mockResolvedValue({
    elements: [
      {
        id: 'dos-finances',
        name: '02 · Finances',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
        modifiedTime: '2026-07-05T10:00:00Z',
      },
      {
        id: 'f-classe',
        name: 'Facture_Electricite.pdf',
        mimeType: 'application/pdf',
        parents: ['root'],
        size: '20480',
        modifiedTime: '2026-07-06T10:00:00Z',
        webViewLink: 'https://drive.google.com/file/d/f-classe/view',
      },
      {
        id: 'f-export',
        name: 'export-brut.html',
        mimeType: 'text/html',
        parents: ['root'],
        size: '15400',
        modifiedTime: '2026-07-04T19:01:12Z',
      },
    ],
  });
  spies.rechercherDrive.mockReset().mockResolvedValue({ elements: [], tronque: false });
  spies.creerDossier.mockReset().mockImplementation(async (nom: string, parentId: string) => ({
    id: `dos-${nom}`,
    name: nom,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
    modifiedTime: '2026-07-06T12:00:00Z',
  }));
  spies.deplacerFichierManuel.mockReset().mockResolvedValue(true);
  spies.libelleParentEnCache.mockReset().mockImplementation((el, opts) => {
    const p = el.parents?.[0];
    if (!p) return null;
    if (p === 'root') return opts?.nomRacine ?? 'Mon Drive';
    if (p === 'dos-finances') return '02 · Finances';
    if (p === 'dos-releves') return 'Relevés';
    return opts?.nomsSupplementaires?.get(p) ?? null;
  });
  spies.resoudreCheminDossier.mockReset().mockImplementation(async (dossier, opts) => {
    const id = typeof dossier === 'string' ? dossier : dossier.id;
    const nom = typeof dossier === 'string' ? id : (dossier.nom ?? dossier.name ?? id);
    const racine: Etape = { id: 'root', nom: opts?.nomRacine ?? 'Mon Drive' };
    if (id === 'root') return { etapes: [racine], approximatif: false };
    return { etapes: [racine, { id: 'dos-finances', nom: '02 · Finances' }, { id, nom }], approximatif: false };
  });
  spies.corbeillerDossierVide.mockReset().mockResolvedValue(undefined);
}

describe('Vues principales — interactions DOM (P0-3, P0-4, P1-1..P1-3, P2-1)', () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    reinitialiserSpies();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
  });

  describe('AujourdHui.tsx — P0-3 et actions optimistes', () => {
    it('affiche Chargement… quand donnees === null', () => {
      mockEtat.donnees = null;
      render(createElement(AujourdHui, { langue: 'fr', onAller: vi.fn() }));
      expect(screen.getByText('Chargement…')).toBeDefined();
    });

    it('P0-3 : affiche conditionnellement Réorg et dossiers vides (2 <section>, zéro bouton destructif) et route vers Documents', () => {
      const onAller = vi.fn();
      mockEtat.donnees = donneesBase({
        index: [],
        reorgBrut: [
          ['r1', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
          ['reorg|r1|1', 'action', 'd1', 'A', 'B', 'proposé', 'déplacer', '2026-07-05T12:01:00'],
          ['reorg|r1|2', 'action', 'd2', 'C', 'D', 'proposé', 'fusion', '2026-07-05T12:02:00'],
          ['v1', 'dossier-vide', 'dv1', '08 · Perso/Vide1', '', 'vide-candidat', '', '2026-07-05T12:03:00'],
        ],
      });

      const { container, rerender } = render(
        createElement(AujourdHui, { langue: 'fr', onAller }),
      );

      expect(container.querySelectorAll('.accueil > section')).toHaveLength(2);
      expect(container.querySelector('.badge')?.textContent).toBe('3');
      const ligneReorg = screen.getByRole('button', {
        name: /2 proposition\(s\) de réorganisation à valider · 1 dossier\(s\) vide\(s\) à traiter/,
      });
      expect(screen.queryByRole('button', { name: /Corbeille/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Tout valider/ })).toBeNull();

      fireEvent.click(ligneReorg);
      expect(onAller).toHaveBeenCalledWith('documents');

      // Cas reorg seul (> 0) avec 0 dossier vide
      mockEtat.donnees = donneesBase({
        index: [],
        reorgBrut: [
          ['r2', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
          ['reorg|r2|1', 'action', 'd1', 'A', 'B', 'proposé', 'déplacer', '2026-07-05T12:01:00'],
        ],
      });
      rerender(createElement(AujourdHui, { langue: 'fr', onAller }));
      expect(screen.getByText('1 proposition(s) de réorganisation à valider')).toBeDefined();
      expect(screen.queryByText(/dossier\(s\) vide\(s\)/)).toBeNull();

      // Cas dossier vide seul (> 0) avec 0 proposition réorg
      mockEtat.donnees = donneesBase({
        index: [],
        reorgBrut: [
          ['v2', 'dossier-vide', 'dv2', '08 · Perso/Vide2', '', 'vide-candidat', '', '2026-07-05T12:03:00'],
        ],
      });
      rerender(createElement(AujourdHui, { langue: 'fr', onAller }));
      expect(screen.getByText('1 dossier(s) vide(s) à traiter')).toBeDefined();
      expect(screen.queryByText(/proposition\(s\) de réorganisation/)).toBeNull();

      // Cas 0 / absent (reorgBrut undefined) : ligne absente et « Rien à faire » affiché
      mockEtat.donnees = donneesBase({ index: [], reorgBrut: undefined });
      rerender(createElement(AujourdHui, { langue: 'fr', onAller }));
      expect(screen.queryByText('Voir dans Documents')).toBeNull();
      expect(screen.getByText('Rien à faire')).toBeDefined();
    });

    it('gère Pas suspect (masquage optimiste + rollback) et Fait (masquage optimiste + rollback) et les boutons de routage', async () => {
      const onAller = vi.fn();
      mockEtat.donnees = donneesBase({
        santeBrut: [
          [`Dernier passage OK : ${datePasseRecent()}`],
          ['Compte LLM : panne (quota)'],
          ['Tri Gmail : ✅ normal'],
        ],
        index: [
          ligne('tri|fil-dom-ok|1751610000|0', 'Suspect Succès', 'suspect'),
          ligne('tri|fil-dom-ko|1751610001|0', 'Suspect Échec', 'suspect'),
          ligne('tri|fil-dom-temoin|1751610002|0', 'Suspect Témoin', 'suspect'),
          ligne('important|msg-dom-ok', 'Mail Important OK', 'important'),
          ligne('important|msg-dom-ko', 'Mail Important Échec', 'important'),
        ],
      });

      const { container } = render(createElement(AujourdHui, { langue: 'fr', onAller }));

      // Bandeau incident critique -> route vers 'etat'
      const banniereIncident = screen.getByRole('status');
      expect(banniereIncident.textContent).toContain('Compte LLM : En panne');
      fireEvent.click(within(banniereIncident).getByRole('button', { name: 'État' }));
      expect(onAller).toHaveBeenCalledWith('etat');

      // Bouton Documents › -> route vers 'documents'
      fireEvent.click(screen.getByRole('button', { name: 'Documents ›' }));
      expect(onAller).toHaveBeenCalledWith('documents');

      // Pas suspect succès : disparaît immédiatement et badge décrémente (5 -> 4)
      expect(container.querySelector('.badge')?.textContent).toBe('5');
      const ligneSuspectOk = screen.getByText('Suspect Succès').closest('.alerte-suspect')!;
      fireEvent.click(within(ligneSuspectOk as HTMLElement).getByRole('button', { name: 'Pas suspect' }));
      await waitFor(() => {
        expect(spies.marquerPasSuspect).toHaveBeenCalledWith('fil-dom-ok');
      });
      expect(screen.queryByText('Suspect Succès')).toBeNull();
      expect(container.querySelector('.badge')?.textContent).toBe('4');

      // Pas suspect échec : rollback + BanniereErreur fermable via Fermer
      spies.marquerPasSuspect.mockRejectedValueOnce(new Error('Google API 500 : échec'));
      const ligneSuspectKo = screen.getByText('Suspect Échec').closest('.alerte-suspect')!;
      fireEvent.click(within(ligneSuspectKo as HTMLElement).getByRole('button', { name: 'Pas suspect' }));

      const alerteSuspect = await screen.findByRole('alert');
      expect(alerteSuspect.textContent).toContain('Google est en panne');
      expect(screen.getByText('Suspect Échec')).toBeDefined();
      fireEvent.click(within(alerteSuspect).getByRole('button', { name: 'Fermer' }));
      expect(screen.queryByRole('alert')).toBeNull();

      // Fait succès : disparaît et appelle ajouterLigne('Index', ...)
      fireEvent.click(screen.getByRole('button', { name: 'Fait : Mail Important OK' }));
      await waitFor(() => {
        expect(spies.ajouterLigne).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByText('Mail Important OK')).toBeNull();

      // Fait échec : rollback + BanniereErreur
      spies.ajouterLigne.mockRejectedValueOnce(new Error('Google API 503 : indisponible'));
      fireEvent.click(screen.getByRole('button', { name: 'Fait : Mail Important Échec' }));
      const alerteFait = await screen.findByRole('alert');
      expect(alerteFait.textContent).toContain('Google est en panne');
      expect(screen.getByText('Mail Important Échec')).toBeDefined();
    });

    it('GAP-P2-1 & GAP-P2-5 : conserve la bannière d’erreur si le dernier suspect échoue et bloque le double-clic rapide sur Fait', async () => {
      let rejeterSuspect!: (err: Error) => void;
      spies.marquerPasSuspect.mockImplementationOnce(
        () => new Promise<string>((_, reject) => { rejeterSuspect = reject; }),
      );
      mockEtat.donnees = donneesBase({
        index: [
          ligne('tri|fil-unique|1751610000|0', 'Unique Suspect', 'suspect'),
          ligne('important|msg-double', 'Mail Double Clic', 'important'),
        ],
      });

      const { container } = render(createElement(AujourdHui, { langue: 'fr', onAller: vi.fn() }));
      expect(container.querySelectorAll('.accueil > section')).toHaveLength(2);

      // Clic sur le dernier suspect : disparaît immédiatement (optimiste)
      fireEvent.click(screen.getByRole('button', { name: 'Pas suspect' }));
      expect(screen.queryByText('Unique Suspect')).toBeNull();

      // Rejet serveur : la ligne revient ET la bannière d'erreur reste visible (pas perdue au démontage)
      await act(async () => {
        rejeterSuspect(new Error('Google API 500 : indisponible'));
      });
      const alerte = await screen.findByRole('alert');
      expect(alerte.textContent).toContain('Google est en panne');
      expect(screen.getByText('Unique Suspect')).toBeDefined();
      expect(container.querySelectorAll('.accueil > section')).toHaveLength(2);

      // Double-clic rapide synchrone sur Fait : ajouterLigne n'est appelé qu'une seule fois
      const btnFait = screen.getByRole('button', { name: 'Fait : Mail Double Clic' });
      fireEvent.click(btnFait);
      fireEvent.click(btnFait);
      await waitFor(() => {
        expect(spies.ajouterLigne).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Explorateur.tsx — P1-1, P1-2, P1-3 et interactions Drive', () => {
    it('P1-1 : applique les 5 puces .gf-chip sur le listing et les résultats de recherche sans appel réseau supplémentaire', async () => {
      mockEtat.donnees = donneesBase({
        index: [
          ligne('drive|f-classe', 'Facture_Electricite.pdf', 'classé', { confiance: '0.95' }),
          ligne('drive|f-verif', 'Scan_A_Verifier.pdf', 'à vérifier', { confiance: '' }),
          ligne('drive|f-faible', 'Recu_Confiance_Basse.pdf', 'classé', { confiance: '0.42' }),
        ],
      });
      spies.listerEnfants.mockResolvedValue({
        elements: [
          {
            id: 'dos-finances',
            name: '02 · Finances',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['root'],
          },
          {
            id: 'f-classe',
            name: 'Facture_Electricite.pdf',
            mimeType: 'application/pdf',
            parents: ['root'],
          },
          {
            id: 'f-verif',
            name: 'Scan_A_Verifier.pdf',
            mimeType: 'application/pdf',
            parents: ['root'],
          },
          {
            id: 'f-faible',
            name: 'Recu_Confiance_Basse.pdf',
            mimeType: 'application/pdf',
            parents: ['root'],
          },
          {
            id: 'f-export',
            name: 'export-brut.html',
            mimeType: 'text/html',
            parents: ['root'],
          },
        ],
      });

      const { container } = render(createElement(Explorateur, { langue: 'fr' }));
      await waitFor(() => {
        expect(screen.getByText('Facture_Electricite.pdf')).toBeDefined();
      });
      expect(spies.listerEnfants).toHaveBeenCalledTimes(1);

      const barreFiltres = screen.getByRole('group', { name: 'Filtres rapides' });
      const puces = within(barreFiltres).getAllByRole('button');
      expect(puces.map((b) => b.textContent)).toEqual([
        'Tout',
        'Dossiers',
        'PDF',
        'À vérifier',
        'Confiance < 50 %',
      ]);
      expect(puces[0]!.getAttribute('aria-pressed')).toBe('true');

      // Dossiers uniquement
      fireEvent.click(within(barreFiltres).getByRole('button', { name: 'Dossiers' }));
      expect(screen.getByText('02 · Finances')).toBeDefined();
      expect(screen.queryByText('Facture_Electricite.pdf')).toBeNull();
      expect(screen.queryByText('export-brut.html')).toBeNull();

      // PDF uniquement (exclut dossier et .html)
      fireEvent.click(within(barreFiltres).getByRole('button', { name: 'PDF' }));
      expect(screen.queryByText('02 · Finances')).toBeNull();
      expect(screen.queryByText('export-brut.html')).toBeNull();
      expect(screen.getByText('Facture_Electricite.pdf')).toBeDefined();

      // À vérifier
      fireEvent.click(within(barreFiltres).getByRole('button', { name: 'À vérifier' }));
      expect(screen.getByText('Scan_A_Verifier.pdf')).toBeDefined();
      expect(screen.queryByText('Facture_Electricite.pdf')).toBeNull();

      // Confiance < 50 %
      fireEvent.click(within(barreFiltres).getByRole('button', { name: 'Confiance < 50 %' }));
      expect(screen.getByText('Recu_Confiance_Basse.pdf')).toBeDefined();
      expect(screen.queryByText('Scan_A_Verifier.pdf')).toBeNull();
      expect(spies.listerEnfants).toHaveBeenCalledTimes(1);
      expect(spies.rechercherDrive).not.toHaveBeenCalled();

      // Recherche puis filtrage sur les résultats + Effacer réinitialise à Tout
      fireEvent.click(within(barreFiltres).getByRole('button', { name: 'Tout' }));
      spies.rechercherDrive.mockResolvedValueOnce({
        elements: [
          {
            id: 'f-classe',
            name: 'Facture_Electricite.pdf',
            mimeType: 'application/pdf',
            parents: ['dos-finances'],
          },
          {
            id: 'f-export',
            name: 'export-brut.html',
            mimeType: 'text/html',
            parents: ['root'],
          },
        ],
        tronque: false,
      });

      const champRech = screen.getByRole('textbox', { name: 'Rechercher' });
      fireEvent.change(champRech, { target: { value: 'e' } });
      fireEvent.submit(champRech.closest('form')!);

      await waitFor(() => {
        expect(container.querySelector('.ariane-resultats')?.textContent).toContain('2 résultat(s)');
      });

      fireEvent.click(within(barreFiltres).getByRole('button', { name: 'PDF' }));
      expect(container.querySelector('.ariane-resultats')?.textContent).toContain('1 / 2 résultat(s)');

      fireEvent.click(within(barreFiltres).getByRole('button', { name: 'À vérifier' }));
      expect(container.querySelector('.ariane-resultats')?.textContent).toContain('0 / 2 résultat(s)');
      expect(screen.getByText('Aucun résultat.')).toBeDefined();

      // Effacer remet la puce active sur Tout
      const zoneResultats = container.querySelector('.ariane-resultats') as HTMLElement;
      fireEvent.click(within(zoneResultats).getByRole('button', { name: 'Effacer' }));
      expect(within(barreFiltres).getByRole('button', { name: 'Tout' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('P1-2 : affiche le parent sans appel N+1, résout le fil d’Ariane depuis recherche/cible et affiche le repli si rejet', async () => {
      spies.rechercherDrive.mockResolvedValueOnce({
        elements: [
          {
            id: 'dos-releves',
            name: 'Relevés',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['dos-finances'],
          },
          {
            id: 'f-racine',
            name: 'Note_Racine.pdf',
            mimeType: 'application/pdf',
            parents: ['root'],
          },
        ],
        tronque: false,
      });
      spies.resoudreCheminDossier.mockResolvedValueOnce({
        etapes: [
          { id: 'root', nom: 'Mon Drive' },
          { id: 'dos-finances', nom: '02 · Finances' },
          { id: 'dos-bellerives', nom: 'Bellerives' },
          { id: 'dos-releves', nom: 'Relevés' },
        ],
        approximatif: false,
      });

      const onCibleConsommee = vi.fn();
      const { container, rerender } = render(
        createElement(Explorateur, { langue: 'fr', onCibleConsommee }),
      );
      await waitFor(() => {
        expect(spies.listerEnfants).toHaveBeenCalledTimes(1);
      });

      const champRech = screen.getByRole('textbox', { name: 'Rechercher' });
      fireEvent.change(champRech, { target: { value: 'Relevés' } });
      fireEvent.submit(champRech.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText('Note_Racine.pdf')).toBeDefined();
      });

      // Zéro requête listerEnfants N+1 pour afficher .ligne-parent
      expect(spies.listerEnfants).toHaveBeenCalledTimes(1);
      const parentsAffiches = Array.from(container.querySelectorAll('.ligne-parent')).map(
        (n) => n.textContent,
      );
      expect(parentsAffiches).toContain('02 · Finances');
      expect(parentsAffiches).toContain('Mon Drive');

      // Clic sur le dossier trouvé dans la recherche -> fil d'Ariane exact
      fireEvent.click(screen.getByText('Relevés').closest('[role="button"]')!);
      await waitFor(() => {
        const ariane = container.querySelector('nav.ariane-fil')!;
        expect(ariane.textContent).toBe('Mon Drive›02 · Finances›Bellerives›Relevés');
      });

      // Passage par cibleExplorateur avec rejet de resoudreCheminDossier -> repli + onCibleConsommee
      spies.resoudreCheminDossier.mockRejectedValueOnce(new Error('Google API 403 : ascendance'));
      rerender(
        createElement(Explorateur, {
          langue: 'fr',
          cibleExplorateur: {
            cible: { id: 'dos-inaccessible', nom: 'Dossier Isolé', parents: ['x'] },
            jeton: 42,
          },
          onCibleConsommee,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('Chemin parent exact indisponible')).toBeDefined();
        expect(onCibleConsommee).toHaveBeenCalledWith(42);
      });

      // GAP-P2-4 : vrai resoudreCheminDossier (sans mock) sur 403 ancêtre -> approximatif: true -> bannière visible
      const reelGoogle = await vi.importActual<typeof import('../src/google')>('../src/google');
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/refresh') {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ token: 'jeton-reel' }), text: async () => '{}' } as unknown as Response;
        }
        if (url.includes('/files/root?fields=id')) {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: 'racine-reelle' }), text: async () => '{}' } as unknown as Response;
        }
        if (url.includes('/files/parent-403')) {
          return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}), text: async () => 'interdit' } as unknown as Response;
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ files: [] }), text: async () => '{}' } as unknown as Response;
      }));
      reelGoogle.seDeconnecter();
      await reelGoogle.tenterRestaurationSession();
      spies.resoudreCheminDossier.mockImplementationOnce(reelGoogle.resoudreCheminDossier);

      rerender(
        createElement(Explorateur, {
          langue: 'fr',
          cibleExplorateur: {
            cible: { id: 'dos-403-reel', nom: 'Sous-dossier 403', parents: ['parent-403'] },
            jeton: 43,
          },
          onCibleConsommee,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('Chemin parent exact indisponible')).toBeDefined();
        expect(onCibleConsommee).toHaveBeenCalledWith(43);
      });
    });

    it('P1-3 : affiche les pastilles Index, gère Copier le lien (succès + repli) et le bandeau .bandeau-ok de création', async () => {
      mockEtat.donnees = donneesBase({
        index: [
          ligne('drive|f-classe', 'Facture_Electricite.pdf', 'classé', { confiance: '0.45' }),
          ligne('drive|f-tech', 'export-brut.html', 'technique', { confiance: '' }),
        ],
      });
      spies.listerEnfants.mockResolvedValue({
        elements: [
          {
            id: 'f-classe',
            name: 'Facture_Electricite.pdf',
            mimeType: 'application/pdf',
            parents: ['root'],
            webViewLink: 'https://drive.google.com/file/d/f-classe/view',
          },
          {
            id: 'f-tech',
            name: 'export-brut.html',
            mimeType: 'text/html',
            parents: ['root'],
          },
          {
            id: 'f-hors-index',
            name: 'Brouillon_Sans_Index.pdf',
            mimeType: 'application/pdf',
            parents: ['root'],
          },
        ],
      });

      const writeText = vi.fn(async () => {});
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      const { container } = render(createElement(Explorateur, { langue: 'fr' }));
      await waitFor(() => {
        expect(screen.getByText('Facture_Electricite.pdf')).toBeDefined();
      });

      // Pastilles Index : Classé + Confiance faible sur f-classe, Technique sur f-tech, 0 sur f-hors-index
      const ligneClasse = screen.getByText('Facture_Electricite.pdf').closest('.ligne')!;
      expect(within(ligneClasse as HTMLElement).getByText('Classé')).toBeDefined();
      expect(within(ligneClasse as HTMLElement).getByText('Confiance faible')).toBeDefined();

      const ligneTech = screen.getByText('export-brut.html').closest('.ligne')!;
      expect(within(ligneTech as HTMLElement).getByText('Technique')).toBeDefined();

      const ligneHorsIndex = screen.getByText('Brouillon_Sans_Index.pdf').closest('.ligne')!;
      expect(ligneHorsIndex.querySelectorAll('.pastille-index')).toHaveLength(0);

      // Copier le lien avec presse-papiers actif -> "Lien copié", puis retour après 2500 ms
      vi.useFakeTimers();
      const btnCopier = screen.getByRole('button', {
        name: 'Copier le lien : Facture_Electricite.pdf',
      });
      await act(async () => {
        fireEvent.click(btnCopier);
      });
      expect(writeText).toHaveBeenCalledWith('https://drive.google.com/file/d/f-classe/view');
      expect(screen.getByRole('button', { name: 'Lien copié : Facture_Electricite.pdf' })).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(screen.getByRole('button', { name: 'Copier le lien : Facture_Electricite.pdf' })).toBeDefined();

      // Presse-papiers rejeté -> message repli role="status", effacé après 4000 ms
      writeText.mockRejectedValueOnce(new Error('refus'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copier le lien : export-brut.html' }));
      });
      expect(screen.getByRole('status').textContent).toContain(
        'Copie impossible — ouvre le lien directement',
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(screen.queryByText('Copie impossible — ouvre le lien directement')).toBeNull();

      // Création de dossier : Escape annule sans appeler creerDossier
      fireEvent.click(screen.getByRole('button', { name: 'Nouveau dossier' }));
      const champDossier = screen.getByRole('textbox', { name: 'Nouveau dossier' });
      fireEvent.change(champDossier, { target: { value: 'Temporaire' } });
      fireEvent.keyDown(champDossier, { key: 'Escape' });
      expect(spies.creerDossier).not.toHaveBeenCalled();

      // Création de dossier confirmée -> bandeau .bandeau-ok effacé après 4000 ms
      fireEvent.click(screen.getByRole('button', { name: 'Nouveau dossier' }));
      const champDossier2 = screen.getByRole('textbox', { name: 'Nouveau dossier' });
      fireEvent.change(champDossier2, { target: { value: 'Assurances' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
      });
      expect(spies.creerDossier).toHaveBeenCalledWith('Assurances', 'root');
      const bandeauOk = container.querySelector('.bandeau-ok');
      expect(bandeauOk?.textContent).toContain('Dossier créé : Assurances');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(container.querySelector('.bandeau-ok')).toBeNull();
    });

    it('gère navigation clavier, portée dans un sous-dossier, pagination, déplacement manuel et glisser-déposer', async () => {
      spies.listerEnfants.mockImplementation(async (dossierId: string, pageToken?: string) => {
        if (dossierId === 'dos-finances') {
          return {
            elements: [
              {
                id: 'f-sous',
                name: 'Releve_SousDossier.pdf',
                mimeType: 'application/pdf',
                parents: ['dos-finances'],
              },
            ],
          };
        }
        if (pageToken === 'jeton-page-2') {
          return {
            elements: [
              {
                id: 'f-page2',
                name: 'Page2_Document.pdf',
                mimeType: 'application/pdf',
                parents: ['root'],
              },
            ],
          };
        }
        return {
          elements: [
            {
              id: 'dos-finances',
              name: '02 · Finances',
              mimeType: 'application/vnd.google-apps.folder',
              parents: ['root'],
            },
            {
              id: 'f-page1',
              name: 'Page1_Document.pdf',
              mimeType: 'application/pdf',
              parents: ['root'],
            },
          ],
          suivant: 'jeton-page-2',
        };
      });

      const { container } = render(createElement(Explorateur, { langue: 'fr' }));
      await waitFor(() => {
        expect(screen.getByText('Page1_Document.pdf')).toBeDefined();
      });

      // À la racine, pas de bascule de portée
      expect(screen.queryByRole('group', { name: 'Portée de la recherche' })).toBeNull();

      // Pagination "Afficher plus"
      fireEvent.click(screen.getByRole('button', { name: 'Afficher plus' }));
      await waitFor(() => {
        expect(screen.getByText('Page2_Document.pdf')).toBeDefined();
      });

      // Déplacement manuel : ouverture puis Annuler
      fireEvent.click(screen.getByRole('button', { name: 'Déplacer : Page1_Document.pdf' }));
      expect(container.querySelector('.bandeau-deplacement')).not.toBeNull();
      fireEvent.click(within(container.querySelector('.bandeau-deplacement') as HTMLElement).getByRole('button', { name: 'Annuler' }));
      expect(container.querySelector('.bandeau-deplacement')).toBeNull();

      // Déplacement manuel réel : sélectionner Page1_Document.pdf, entrer dans 02 · Finances via Enter, puis Déposer ici
      fireEvent.click(screen.getByRole('button', { name: 'Déplacer : Page1_Document.pdf' }));
      const ligneFinances = screen.getByText('02 · Finances').closest('[role="button"]')!;
      fireEvent.keyDown(ligneFinances, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByText('Releve_SousDossier.pdf')).toBeDefined();
      });

      // Bascule de portée visible uniquement dans le sous-dossier
      const groupePortee = screen.getByRole('group', { name: 'Portée de la recherche' });
      expect(within(groupePortee).getByRole('button', { name: 'Dans « 02 · Finances »' })).toBeDefined();
      expect((screen.getByRole('textbox', { name: 'Rechercher' }) as HTMLInputElement).placeholder).toBe(
        'Rechercher dans ce dossier…',
      );

      // Recherche active + changement de portée relance rechercherDrive avec { dossierId: undefined }
      spies.rechercherDrive
        .mockResolvedValueOnce({ elements: [], tronque: false })
        .mockResolvedValueOnce({ elements: [], tronque: false });
      const champRech = screen.getByRole('textbox', { name: 'Rechercher' });
      fireEvent.change(champRech, { target: { value: 'Releve' } });
      fireEvent.submit(champRech.closest('form')!);
      await waitFor(() => {
        expect(spies.rechercherDrive).toHaveBeenCalledWith('Releve', { dossierId: 'dos-finances' });
      });

      fireEvent.click(within(groupePortee).getByRole('button', { name: 'Tout le Drive' }));
      await waitFor(() => {
        expect(spies.rechercherDrive).toHaveBeenCalledWith('Releve', undefined);
      });

      // Déposer ici -> deplacerFichierManuel + bandeau .ok "Déplacé"
      fireEvent.click(screen.getByRole('button', { name: 'Déposer ici · 02 · Finances' }));
      await waitFor(() => {
        expect(spies.deplacerFichierManuel).toHaveBeenCalledWith({
          fileId: 'f-page1',
          nouveauParent: 'dos-finances',
          nomCible: '02 · Finances',
        });
        expect(screen.getByText(/Déplacé : Page1_Document\.pdf → 02 · Finances/)).toBeDefined();
      });

      // Glisser-déposer sur l'étape "Mon Drive" du fil d'Ariane + payload malformé ignoré
      const ligneReleve = screen.getByText('Releve_SousDossier.pdf').closest('.ligne')!;
      const dt = creerDataTransfert();
      fireEvent.dragStart(ligneReleve, { dataTransfer: dt });
      expect(dt.getData('application/x-driveai-fichier')).toContain('f-sous');

      const etapeRacine = within(container.querySelector('nav.ariane-fil') as HTMLElement).getByRole(
        'button',
        { name: 'Mon Drive' },
      );
      fireEvent.drop(etapeRacine, { dataTransfer: dt });
      await waitFor(() => {
        expect(spies.deplacerFichierManuel).toHaveBeenCalledWith({
          fileId: 'f-sous',
          nouveauParent: 'root',
          nomCible: 'Mon Drive',
        });
      });

      // Payload JSON invalide : aucun appel supplémentaire
      const appelsAvant = spies.deplacerFichierManuel.mock.calls.length;
      const dtInvalide = creerDataTransfert();
      dtInvalide.setData('application/x-driveai-fichier', '{json-invalide');
      fireEvent.drop(etapeRacine, { dataTransfer: dtInvalide });
      expect(spies.deplacerFichierManuel).toHaveBeenCalledTimes(appelsAvant);

      // Clic sur l'étape Mon Drive du fil d'Ariane ramène à la racine
      fireEvent.click(etapeRacine);
      await waitFor(() => {
        expect(screen.queryByRole('group', { name: 'Portée de la recherche' })).toBeNull();
      });
    });
  });

  describe('Documents.tsx et ReorgVue — propositions, refus et corbeille dossiers vides', () => {
    it('Documents rend ReorgVue au-dessus d’Explorateur', async () => {
      spies.lirePlage.mockResolvedValueOnce([
        ['r1', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
        ['reorg|r1|1', 'action', 'd1', 'A', 'B', 'proposé', 'fusion', '2026-07-05T12:01:00'],
      ]);
      const { container } = render(createElement(Documents, { langue: 'fr' }));
      await waitFor(() => {
        expect(container.querySelector('.propositions')).not.toBeNull();
        expect(container.querySelector('.documents')).not.toBeNull();
      });
      const prop = container.querySelector('.propositions')!;
      const docs = container.querySelector('.documents')!;
      expect(prop.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('valide/écarte en unitaire et en lot, acquitte un refus, corbeille en lot avec confirmation et déplie Bloqués', async () => {
      spies.lirePlage.mockResolvedValue([
        ['r1', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
        ['reorg|r1|1', 'action', 'd1', 'Dossier A', 'Dossier B', 'proposé', 'fusion', '2026-07-05T12:01:00'],
        ['reorg|r1|2', 'action', 'd2', 'Dossier C', 'Dossier D', 'proposé', 'deplacer', '2026-07-05T12:02:00'],
        ['reorg|r1|3', 'action', 'd3', 'Dossier E', 'Dossier F', 'proposé', 'renommer', '2026-07-05T12:03:00'],
        ['reorg|r1|4', 'action', 'd4', '04 · Immigration/X', 'Y', 'refusé (zone protégée)', 'interdit', '2026-07-05T12:04:00'],
        ['vc|1', 'dossier-vide', 'v-1', '08 · Perso/VideA', '', 'vide-candidat', '', '2026-07-05T12:05:00'],
        ['vc|2', 'dossier-vide', 'v-2', '08 · Perso/VideB', '', 'vide-candidat', '', '2026-07-05T12:06:00'],
        ['vc|3', 'dossier-vide', 'v-3', '08 · Perso/VideC', '', 'vide-candidat', '', '2026-07-05T12:07:00'],
        ['vb|1', 'dossier-vide', 'v-b', '04 · Immigration/Docs', '', 'vide-protégé', '', '2026-07-05T12:08:00'],
      ]);

      render(createElement(ReorgVue, { langue: 'fr' }));
      await waitFor(() => {
        expect(screen.getByText('À valider')).toBeDefined();
      });

      // Validation unitaire de la première proposition (ligne Sheet 3)
      const boutonsValider = screen.getAllByRole('button', { name: 'Valider' });
      fireEvent.click(boutonsValider[0]!);
      await waitFor(() => {
        expect(spies.ecrireCellule).toHaveBeenCalledWith('Réorg', 'F3', 'validé');
      });
      expect(screen.queryByText('Dossier A')).toBeNull();

      // Tout valider : confirm=false annule
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      fireEvent.click(screen.getByRole('button', { name: 'Tout valider' }));
      expect(spies.ecrireColonnePlage).not.toHaveBeenCalled();

      // Tout valider : confirm=true écrit la plage F4:F5
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Tout valider' }));
      });
      expect(spies.ecrireColonnePlage).toHaveBeenCalledWith('Réorg', 'F', 4, ['validé', 'validé']);

      // Refus acquitté via OK (ligne Sheet 6)
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      await waitFor(() => {
        expect(spies.ecrireCellule).toHaveBeenCalledWith('Réorg', 'F6', 'écarté');
      });

      // Dossier vide unitaire -> Corbeille (30 j) sur v-1 (ligne Sheet 7)
      const btnsCorbeille = screen.getAllByRole('button', { name: 'Corbeille (30 j)' });
      fireEvent.click(btnsCorbeille[0]!);
      await waitFor(() => {
        expect(spies.corbeillerDossierVide).toHaveBeenCalledWith('v-1');
        expect(spies.ecrireCellule).toHaveBeenCalledWith('Réorg', 'F7', 'corbeillé');
      });

      // Tout corbeiller (2) : confirm=false annule, puis confirm=true vide et garde le bilan visible
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      fireEvent.click(screen.getByRole('button', { name: 'Tout corbeiller (2)' }));
      expect(spies.corbeillerDossierVide).toHaveBeenCalledTimes(1);

      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Tout corbeiller (2)' }));
      });
      await waitFor(() => {
        expect(screen.getByText(/2 dossier\(s\) mis à la corbeille/)).toBeDefined();
      });

      // Bloqués (1) : aria-expanded false -> true et révèle la raison
      const btnBloques = screen.getByRole('button', { name: 'Bloqués (1)' });
      expect(btnBloques.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(btnBloques);
      expect(btnBloques.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('Dossiers bloqués (refusés par le dernier passage)')).toBeDefined();
      expect(screen.getByText(/Protégé ou nécessaire au classement/)).toBeDefined();

      // GAP-P2-6 : chaque mutation Réorg réussie (Valider, Tout valider, OK, Corbeille, Tout corbeiller) appelle rafraichir()
      expect(mockEtat.rafraichir).toHaveBeenCalledTimes(5);
    });

    it('masque portée trop large et Bloqués orphelin sans vide-candidat, mais permet d’acquitter un autre échec', async () => {
      spies.lirePlage.mockResolvedValueOnce([
        ['r1', 'demande', '', 'tout', '', 'échec', 'portée trop large (> 250 dossiers) — choisis un dossier', '2026-07-22T13:18:10Z'],
        ['vb|1', 'dossier-vide', 'v-b', '02 · Finances', '', 'vide-protégé', 'protégé', '2026-09-13T10:00:00Z'],
      ]);
      const { unmount } = render(createElement(ReorgVue, { langue: 'fr' }));
      await waitFor(() => {
        expect(spies.lirePlage).toHaveBeenCalledWith('Réorg', 'A2:H');
      });
      await waitFor(() => {
        expect(document.querySelector('.propositions')).not.toBeNull();
      });
      expect(screen.queryByText(/portée trop large/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Bloqués/i })).toBeNull();
      unmount();

      spies.lirePlage.mockResolvedValueOnce([
        ['r2', 'demande', '', 'id-imm', '', 'échec', 'portée refusée : zone protégée (04 · Immigration)', '2026-07-23T12:00:00Z'],
      ]);
      render(createElement(ReorgVue, { langue: 'fr' }));
      await waitFor(() => {
        expect(screen.getByText(/zone protégée/)).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
      await waitFor(() => {
        expect(spies.ecrireCellule).toHaveBeenCalledWith('Réorg', 'F2', 'écarté');
      });
    });
  });

  describe('Etat.tsx — P0-4, tuiles, alertes sans Hub ni panneau Avancé', () => {
    it('affiche les 3 tuiles, les alertes actives (hors Hub/hub-resume), P0-4 (tri_archives_jour) et n’affiche pas Avancé', () => {
      mockEtat.donnees = donneesBase({
        santeBrut: [
          [`Dernier passage OK : ${datePasseRecent()}`],
          ['Compte LLM : panne (quota dépassé)'],
          ['Tri Gmail : ✅ normal'],
        ],
        journalBrut: [
          [dateHorodatageRecent(), 'ERREUR', 'Pipeline', 'Erreur simulée de test'],
          [dateHorodatageRecent(), 'ERREUR', 'Hub', 'MàJ résumé hub impossible'],
        ],
      });
      mockEtat.progression = [
        ...mockEtat.progression,
        {
          cle: 'conso-off',
          operation: 'Ancienne consolidation arrêtée',
          traites: 1,
          base: 5,
          unite: 'domaines',
          statut: 'désactivée',
          horodate: dateHorodatageRecent(),
          detail: '',
          derniereActivite: '19/11 10:00',
          derniereErreur: '',
          type: 'campagne',
          dernierePasse: '+1 domaines · il y a 2 h',
          finEstimee: '',
        },
        {
          cle: 'hub-resume',
          operation: 'Résumé hub (widget)',
          traites: 0,
          base: null,
          unite: '',
          statut: 'erreur',
          horodate: dateHorodatageRecent(),
          detail: '',
          derniereActivite: '19/11 11:49',
          derniereErreur: '19/11 11:49 — No item with the given ID',
          type: 'observabilite',
          dernierePasse: '',
          finEstimee: '',
        },
      ];

      const { container } = render(createElement(Etat, { langue: 'fr' }));

      // Épuration : ni Maintenance Drive ni ancienne campagne désactivée ; carte explicative présente
      expect(screen.queryByText('Maintenance Drive')).toBeNull();
      expect(screen.queryByText('Ancienne consolidation arrêtée')).toBeNull();
      expect(screen.getByText('En cours maintenant')).toBeDefined();
      expect(screen.getByRole('region', { name: 'Comment DriveAI classe et trie' })).toBeDefined();

      // 3 tuiles principales
      expect(container.querySelectorAll('.tuiles-3 .tuile')).toHaveLength(3);
      expect(screen.getByText('documents classés')).toBeDefined();
      expect(screen.getByText('mails triés')).toBeDefined();
      const regionAlertes = screen.getByRole('region', { name: 'Points d’attention' });
      expect(regionAlertes).toBeDefined();
      expect(within(regionAlertes).getByText('Erreur simulée de test')).toBeDefined();
      expect(within(regionAlertes).queryByText('Résumé hub (widget)')).toBeNull();
      expect(within(regionAlertes).queryByText(/MàJ résumé hub impossible/)).toBeNull();

      // P0-4 : compteur quotidien mesuré d'archives + note mesurée
      expect(screen.getByText('Fils archivés aujourd’hui')).toBeDefined();
      expect(screen.getByText('18')).toBeDefined();
      expect(screen.getByText(/Compteur quotidien mesuré à l’exécution du tri/)).toBeDefined();

      // Section Avancé complètement retirée
      expect(container.querySelector('details.avance')).toBeNull();
      expect(screen.queryByText('Avancé')).toBeNull();

      // Bouton Vu : masque l'alerte localement (sans PII), met à jour le compteur et permet de réafficher
      const btnVu = within(regionAlertes).getByRole('button', { name: /Vu — Pipeline/i });
      fireEvent.click(btnVu);
      expect(within(regionAlertes).queryByText('Erreur simulée de test')).toBeNull();
      const stockVu = localStorage.getItem('driveai.erreursVues') ?? '';
      expect(stockVu.length).toBeGreaterThan(2);
      expect(stockVu).not.toContain('Erreur simulée de test');

      const btnReafficher = screen.getByRole('button', { name: /1 masquée\(s\) — réafficher/i });
      fireEvent.click(btnReafficher);
      expect(within(regionAlertes).getByText('Erreur simulée de test')).toBeDefined();
      expect(localStorage.getItem('driveai.erreursVues')).toBeNull();
    });

    it('P0-4 replis honnêtes : affiche — si compteurs absents et zéro NaN/Infinity', () => {
      mockEtat.donnees = donneesBase({
        telemetrieBrut: [
          ['tri_cyclique_fils_jour', '10', 'fils', 'Plafond 0/j'],
        ],
      });
      const { container, rerender } = render(createElement(Etat, { langue: 'fr' }));
      expect(screen.getByText(/ne sont pas comptés séparément dans l’Index/)).toBeDefined();
      const carteStats = screen.getByText('Fils archivés aujourd’hui').closest('.statut-cellule')!;
      expect(carteStats.textContent).toContain('—');
      expect(container.textContent).not.toContain('NaN');
      expect(container.textContent).not.toContain('Infinity');

      // Télémétrie totalement vide : pas de bloc Quota Gmail du jour
      mockEtat.donnees = donneesBase({ telemetrieBrut: [] });
      rerender(createElement(Etat, { langue: 'fr' }));
      expect(screen.queryByText('Quota Gmail du jour')).toBeNull();
    });

    it('refonte État : Rafraîchir (succès & erreur), Lancer un passage, bandeau héros sans clic pour le détail et raccourcis À revoir', async () => {
      const onAller = vi.fn();
      mockEtat.donnees = donneesBase({
        santeBrut: [
          ['Dernier passage OK : 2026-07-06 14:12'],
          ['Compte LLM : actif'],
          ['Tri Gmail : ✅ normal (libellés + archivage)'],
        ],
        index: [
          ligne('drive|f-ok', 'Doc_Ok.pdf', 'classé'),
          ligne('drive|f-av', 'Doc_AV.pdf', 'à vérifier'),
          ligne('tri|fil-sus|100|0', 'Suspect.eml', 'suspect'),
        ],
        reorgBrut: [
          ['r1', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
          ['reorg|r1|1', 'action', 'd1', 'A', 'B', 'proposé', 'fusion', '2026-07-05T12:01:00'],
        ],
      });

      const { rerender } = render(createElement(Etat, { langue: 'fr', onAller }));

      // Bandeau héros sans « clic pour le détail » ni âge brut illisible
      const bandeau = screen.getByRole('region', { name: 'État du moteur' });
      expect(bandeau.textContent).not.toContain('clic pour le détail');
      expect(bandeau.textContent).toMatch(/il y a \d+ j/);

      // Boutons d'accès rapide dans À revoir -> Aujourd'hui et Documents
      fireEvent.click(screen.getByRole('button', { name: 'Voir Aujourd’hui' }));
      expect(onAller).toHaveBeenCalledWith('aujourdhui');
      fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Documents' }));
      expect(onAller).toHaveBeenCalledWith('documents');

      // Rafraîchir succès
      await act(async () => {
        fireEvent.click(screen.getByTitle('Rafraîchir'));
      });
      expect(mockEtat.rafraichir).toHaveBeenCalledWith(true);
      expect(screen.getByRole('status').textContent).toContain('Actualisé à');

      // Lancer un passage : succès puis échec
      spies.demanderPassageMoteur.mockResolvedValueOnce('déjà demandé il y a moins d’une minute');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Lancer un passage' }));
      });
      expect(spies.demanderPassageMoteur).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/déjà demandé il y a moins d’une minute/)).toBeDefined();

      spies.demanderPassageMoteur.mockRejectedValueOnce(new Error('Google API 503 : indisponible'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Lancer un passage' }));
      });
      expect(screen.getByRole('alert').textContent).toContain('Google est en panne');

      // Rafraîchir avec erreur globale remontée par FournisseurEtat : jamais de faux « Actualisé à »
      mockEtat.erreur = 'Google API 429 : quota';
      rerender(createElement(Etat, { langue: 'fr', onAller }));
      await act(async () => {
        fireEvent.click(screen.getByTitle('Rafraîchir'));
      });
      expect(screen.getAllByRole('alert').some((el) => /Trop de demandes/.test(el.textContent ?? ''))).toBe(true);
      expect(screen.queryByText(/Actualisé à/)).toBeNull();
    });
  });

  describe('Reglages.tsx — P2-1 autonome et interactions préférences', () => {
    it('reste utilisable quand donnees === null, met à jour ou restaure la fréquence, gère thème local, langue segmentée, synchro, passage immédiat et déconnexion', async () => {
      const onLangue = vi.fn();
      const onDeconnexion = vi.fn();
      mockEtat.donnees = null;

      const { rerender } = render(
        createElement(Reglages, { langue: 'fr', onLangue, onDeconnexion }),
      );
      expect(screen.getByText('Chargement…')).toBeDefined();
      expect(screen.getByText('Moteur et synchronisation')).toBeDefined();
      expect(screen.getByText('Apparence et langue')).toBeDefined();
      expect(screen.getByText('Compte et session')).toBeDefined();
      expect(screen.queryByText('Hub')).toBeNull();
      expect(screen.queryByText('Retour au hub')).toBeNull();

      // Thème autonome (sans prop onTheme) -> fallback themeLocal
      fireEvent.click(screen.getByRole('button', { name: 'Clair' }));
      expect(localStorage.getItem('driveai.theme')).toBe('clair');
      expect(document.documentElement.dataset.theme).toBe('clair');

      // Langue segmentée : clic sur Français (déjà active) = no-op, clic sur English appelle onLangue
      fireEvent.click(screen.getByRole('button', { name: 'Français' }));
      expect(onLangue).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
      expect(onLangue).toHaveBeenCalledTimes(1);

      // Déconnexion : confirm=false ne déconnecte pas, confirm=true appelle onDeconnexion
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
      expect(onDeconnexion).not.toHaveBeenCalled();

      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
      fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
      expect(onDeconnexion).toHaveBeenCalledTimes(1);

      // Synchro : disabled et aria-busy="true" pendant l'appel, confirmation avec secondes en finally
      let resoudreSynchro!: () => void;
      mockEtat.rafraichir.mockImplementationOnce(
        () => new Promise<void>((r) => { resoudreSynchro = r; }),
      );
      const btnSynchro = screen.getByTitle('Rafraîchir');
      fireEvent.click(btnSynchro);
      expect((btnSynchro as HTMLButtonElement).disabled).toBe(true);
      expect(btnSynchro.getAttribute('aria-busy')).toBe('true');

      await act(async () => {
        resoudreSynchro();
      });
      expect((btnSynchro as HTMLButtonElement).disabled).toBe(false);
      expect(btnSynchro.getAttribute('aria-busy')).toBe('false');
      expect(screen.getByRole('status').textContent).toContain('Actualisé à');

      // Synchro en erreur globale : affiche l'erreur et non Actualisé à
      mockEtat.erreur = 'Failed to fetch';
      await act(async () => {
        fireEvent.click(btnSynchro);
      });
      expect(screen.getByRole('alert').textContent).toContain('Pas de réseau');
      mockEtat.erreur = '';

      // Passage immédiat depuis Réglages : succès puis erreur
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Lancer un passage' }));
      });
      expect(spies.demanderPassageMoteur).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Passage programmé/)).toBeDefined();

      spies.demanderPassageMoteur.mockRejectedValueOnce(new Error('Web app 503'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Lancer un passage' }));
      });
      expect(screen.getByText(/Web app 503/)).toBeDefined();

      // Données chargées : changement de fréquence 5 -> 15 (succès) puis 15 -> 30 (échec -> rollback à 15)
      mockEtat.donnees = donneesBase({ reglagesBrut: [['TICK_MINUTES', '5']] });
      rerender(createElement(Reglages, { langue: 'fr', onLangue, onDeconnexion }));

      const selectFreq = screen.getByRole('combobox', {
        name: 'Fréquence des passages',
      }) as HTMLSelectElement;
      expect(selectFreq.value).toBe('5');

      await act(async () => {
        fireEvent.change(selectFreq, { target: { value: '15' } });
      });
      expect(spies.ecrireCellule).toHaveBeenNthCalledWith(1, 'Réglages', 'A2', 'TICK_MINUTES');
      expect(spies.ecrireCellule).toHaveBeenNthCalledWith(2, 'Réglages', 'B2', '15');
      expect(screen.getByText('✓ au prochain passage')).toBeDefined();
      expect(selectFreq.value).toBe('15');

      spies.ecrireCellule.mockRejectedValueOnce(new Error('Quota Sheets dépassé'));
      await act(async () => {
        fireEvent.change(selectFreq, { target: { value: '30' } });
      });
      expect(selectFreq.value).toBe('15');
      expect(screen.getByText(/Quota Sheets dépassé/)).toBeDefined();
    });
  });
});
