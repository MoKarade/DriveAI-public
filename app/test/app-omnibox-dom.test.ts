// @vitest-environment jsdom
/**
 * app-omnibox-dom.test.ts — tests d'interaction DOM (@testing-library/react + jsdom)
 * pour la coquille complète `<App />` : authentification, navigation à 4 onglets + engrenage
 * `Réglages` (`P0-2`), barre de recherche globale `Omnibox` (`Ctrl+K`/`⌘K`, `P0-1`), saut vers
 * `Explorateur` avec fil d'Ariane exact (`P1-2`), bandeau d'erreur global et persistance du
 * thème clair/sombre (`P2-1`).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';
import {
  rechercherDansArbreMock,
  resoudreArianeDansArbreMock,
  type ElementDrive,
} from '../src/explorateur';
import { ENFANTS_MOCK, plageMock } from '../src/mockData';
import type { CheminDossierResolu, OptionsRechercheDrive, PageDrive, ResultatRechercheDrive } from '../src/google';

type ArbreMock = Record<string, ElementDrive[]>;

const mockEtatGoogle = vi.hoisted(() => ({
  connecte: true,
  configOk: true,
  sessionExpireeCb: null as (() => void) | null,
  lirePlageErreur: '' as string,
  echecChargementReorg: false,
}));

const spiesGoogle = vi.hoisted(() => ({
  seConnecter: vi.fn(async () => {}),
  seDeconnecter: vi.fn(() => {}),
  tenterRestaurationSession: vi.fn(async () => false),
  chargerConfigServeur: vi.fn(async () => true),
  lirePlage: vi.fn<(onglet: string, plage: string) => Promise<string[][]>>(),
  lireProgressionLive: vi.fn<() => Promise<string[][]>>(),
  rechercherDrive: vi.fn<(texte: string, options?: OptionsRechercheDrive) => Promise<ResultatRechercheDrive>>(),
  listerEnfants: vi.fn<(dossierId: string, pageToken?: string) => Promise<PageDrive>>(),
  resoudreCheminDossier: vi.fn<
    (
      dossier: string | { id: string; nom?: string; name?: string; parents?: string[] },
      options?: { nomRacine?: string; maxProfondeur?: number },
    ) => Promise<CheminDossierResolu>
  >(),
  creerDossier: vi.fn(async (nom: string, parentId: string): Promise<ElementDrive> => ({
    id: `dossier-cree-${nom}`,
    name: nom,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
    modifiedTime: '2026-07-06T15:00:00Z',
  })),
  deplacerFichierManuel: vi.fn(async () => true),
  ecrireCellule: vi.fn(async () => {}),
  ecrireColonnePlage: vi.fn(async () => {}),
  ajouterLigne: vi.fn(async () => {}),
  marquerPasSuspect: vi.fn(async () => 'ok'),
  demanderPassageMoteur: vi.fn(async () => 'passage lancé'),
  annulerActionMoteur: vi.fn(async () => 'Action annulée.'),
  viderCachePlages: vi.fn(() => {}),
}));

function libelleParentMock(
  element: Pick<ElementDrive, 'parents'>,
  options?: { nomRacine?: string; nomsSupplementaires?: ReadonlyMap<string, string> },
): string | null {
  const parentId = element.parents?.[0];
  if (!parentId) return null;
  const nomRacine = options?.nomRacine ?? 'Mon Drive';
  if (parentId === 'root') return nomRacine;
  const sup = options?.nomsSupplementaires?.get(parentId);
  if (sup) return sup;
  for (const liste of Object.values(ENFANTS_MOCK as ArbreMock)) {
    for (const item of liste) {
      if (item.id === parentId) return item.name;
    }
  }
  return null;
}

vi.mock('../src/config', () => ({
  lireConfig: () => ({ spreadsheetId: 'feuille-mock', webappUrl: '', webappSecret: '' }),
  chargerConfigServeur: spiesGoogle.chargerConfigServeur,
}));

vi.mock('../src/google', () => ({
  MARQUEUR_DROITS_FICHIER: 'droits-insuffisants-sur-element',
  estConnecte: () => mockEtatGoogle.connecte,
  seConnecter: spiesGoogle.seConnecter,
  seDeconnecter: spiesGoogle.seDeconnecter,
  tenterRestaurationSession: spiesGoogle.tenterRestaurationSession,
  abonnerSessionExpiree: (cb: () => void) => {
    mockEtatGoogle.sessionExpireeCb = cb;
  },
  lirePlage: spiesGoogle.lirePlage,
  lireProgressionLive: spiesGoogle.lireProgressionLive,
  rechercherDrive: spiesGoogle.rechercherDrive,
  listerEnfants: spiesGoogle.listerEnfants,
  resoudreCheminDossier: spiesGoogle.resoudreCheminDossier,
  libelleParentEnCache: libelleParentMock,
  creerDossier: spiesGoogle.creerDossier,
  deplacerFichierManuel: spiesGoogle.deplacerFichierManuel,
  ecrireCellule: spiesGoogle.ecrireCellule,
  ecrireColonnePlage: spiesGoogle.ecrireColonnePlage,
  ajouterLigne: spiesGoogle.ajouterLigne,
  marquerPasSuspect: spiesGoogle.marquerPasSuspect,
  demanderPassageMoteur: spiesGoogle.demanderPassageMoteur,
  annulerActionMoteur: spiesGoogle.annulerActionMoteur,
  executerDecisionCopilote: vi.fn(async (id: string) => ({ ok: true, id, statut: 'appliqué', actionIds: [], nbValidations: 1, proposerAuto: false, message: 'OK' })),
  viderCachePlages: spiesGoogle.viderCachePlages,
}));

import { App } from '../src/App';

let descripteurOffsetParentOriginal: PropertyDescriptor | undefined;

function installerStubOffsetParent() {
  if (!descripteurOffsetParentOriginal) {
    descripteurOffsetParentOriginal = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetParent',
    );
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return (this as HTMLElement).hasAttribute('hidden') ? null : document.body;
    },
  });
}

function restaurerStubOffsetParent() {
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')) return;
  if (descripteurOffsetParentOriginal) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', descripteurOffsetParentOriginal);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  }
}

function creerPromesseControlee<T>() {
  let resoudre!: (valeur: T) => void;
  let rejeter!: (raison?: unknown) => void;
  const promesse = new Promise<T>((res, rej) => {
    resoudre = res;
    rejeter = rej;
  });
  return { promesse, resoudre, rejeter };
}

function reinitialiserMocksParDefaut() {
  mockEtatGoogle.connecte = true;
  mockEtatGoogle.configOk = true;
  mockEtatGoogle.sessionExpireeCb = null;
  mockEtatGoogle.lirePlageErreur = '';
  mockEtatGoogle.echecChargementReorg = false;

  spiesGoogle.seConnecter.mockReset().mockImplementation(async () => {
    mockEtatGoogle.connecte = true;
  });
  spiesGoogle.seDeconnecter.mockReset().mockImplementation(() => {
    mockEtatGoogle.connecte = false;
  });
  spiesGoogle.tenterRestaurationSession.mockReset().mockResolvedValue(false);
  spiesGoogle.chargerConfigServeur.mockReset().mockImplementation(async () => mockEtatGoogle.configOk);

  spiesGoogle.lirePlage.mockReset().mockImplementation(async (onglet: string, plage: string) => {
    if (mockEtatGoogle.lirePlageErreur && onglet === 'Index') {
      throw new Error(mockEtatGoogle.lirePlageErreur);
    }
    return plageMock(onglet, plage);
  });
  spiesGoogle.lireProgressionLive.mockReset().mockImplementation(async () =>
    plageMock('Progression', 'A2:M'),
  );
  spiesGoogle.rechercherDrive.mockReset().mockImplementation(
    async (texte: string, options?: OptionsRechercheDrive) =>
      rechercherDansArbreMock(ENFANTS_MOCK as ArbreMock, texte, options),
  );
  spiesGoogle.listerEnfants.mockReset().mockImplementation(async (dossierId: string) => ({
    elements: (ENFANTS_MOCK[dossierId] ?? []) as ElementDrive[],
  }));
  spiesGoogle.resoudreCheminDossier.mockReset().mockImplementation(
    async (dossier, options) => {
      const id = typeof dossier === 'string' ? dossier : dossier.id;
      const nomInitial = typeof dossier === 'string' ? undefined : (dossier.nom ?? dossier.name);
      return {
        etapes: resoudreArianeDansArbreMock(
          ENFANTS_MOCK as ArbreMock,
          id,
          options?.nomRacine ?? 'Mon Drive',
          nomInitial,
        ),
        approximatif: false,
      };
    },
  );
  spiesGoogle.viderCachePlages.mockReset();
}

async function monterAppConnectee() {
  const rendu = render(createElement(App));
  await waitFor(() => {
    expect(rendu.container.querySelector('.accueil')).not.toBeNull();
  });
  return rendu;
}

describe('App.tsx — coquille, Omnibox (P0-1), navigation 4 onglets (P0-2 / Lot 1B) et thème (P2-1)', () => {
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
    reinitialiserMocksParDefaut();
  });

  afterEach(() => {
    cleanup();
    restaurerStubOffsetParent();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
  });

  describe('Authentification et bannière globale', () => {
    it('affiche l’écran de connexion hors session, le message acces_refuse et la bascule de langue', async () => {
      mockEtatGoogle.connecte = false;
      window.history.replaceState(null, '', '/?erreur=acces_refuse');
      const rendu = render(createElement(App));

      expect(screen.getByRole('button', { name: 'Se connecter avec Google' })).toBeDefined();
      expect(screen.getByText(/ce compte Google n’est pas autorisé/)).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'English' }));
      expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
      await waitFor(() => {
        expect(spiesGoogle.seConnecter).toHaveBeenCalledTimes(1);
        expect(rendu.container.querySelector('.accueil')).not.toBeNull();
      });

      window.history.replaceState(null, '', '/');
    });

    it('affiche le bandeau d’erreur global quand FournisseurEtat échoue et relance rafraichir(true) sur Réessayer', async () => {
      mockEtatGoogle.lirePlageErreur = 'Google API 503 : service indisponible';
      const { container } = render(createElement(App));

      await waitFor(() => {
        expect(container.querySelector('.bandeau-global')).not.toBeNull();
      });
      const bandeau = container.querySelector('.bandeau-global')!;
      expect(bandeau.textContent).toContain('Google est en panne');

      mockEtatGoogle.lirePlageErreur = '';
      fireEvent.click(within(bandeau as HTMLElement).getByRole('button', { name: 'Réessayer' }));

      await waitFor(() => {
        expect(spiesGoogle.viderCachePlages).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.bandeau-global')).toBeNull();
        expect(container.querySelector('.accueil')).not.toBeNull();
      });
    });
  });

  describe('P0-2 — Navigation à 4 onglets, engrenage Réglages et PastilleMoteur', () => {
    it('affiche exactement 4 onglets principaux dans le rail et la barre basse, Réglages séparé via engrenage', async () => {
      const { container } = await monterAppConnectee();

      const rail = container.querySelector('nav.rail') as HTMLElement;
      const barreBasse = container.querySelector('nav.barre-basse') as HTMLElement;
      const barreHaute = container.querySelector('header.barre-haute') as HTMLElement;

      const ongletsBasse = Array.from(barreBasse.querySelectorAll('button'));
      expect(ongletsBasse.map((b) => b.textContent?.trim())).toEqual([
        'Aujourd’hui',
        'Copilote',
        'Documents',
        'État',
      ]);
      expect(within(barreBasse).queryByText('Réglages')).toBeNull();

      // Bascule vers Copilote via la barre basse
      fireEvent.click(within(barreBasse).getByRole('button', { name: 'Copilote' }));
      await waitFor(() => {
        expect(container.querySelector('.copilote-vue')).not.toBeNull();
      });
      expect(screen.getByRole('heading', { level: 1, name: 'Copilote' })).toBeDefined();
      expect(within(barreBasse).getByRole('button', { name: 'Copilote' }).className).toContain('actif');

      // Bascule vers Documents via la barre basse
      fireEvent.click(within(barreBasse).getByRole('button', { name: 'Documents' }));
      await waitFor(() => {
        expect(container.querySelector('.documents')).not.toBeNull();
      });
      expect(within(barreBasse).getByRole('button', { name: 'Documents' }).className).toContain('actif');

      // Bascule vers État via le rail PC
      fireEvent.click(within(rail).getByRole('button', { name: 'État' }));
      await waitFor(() => {
        expect(screen.getAllByText('Migration taxonomie (m1)').length).toBeGreaterThan(0);
      });
      expect(screen.getByRole('heading', { level: 1, name: 'État' })).toBeDefined();
      expect(within(rail).getByRole('button', { name: 'État' }).className).toContain('actif');

      // Ouverture de Réglages via l’engrenage de la barre haute mobile : .actif quitte les 4 onglets principaux
      const btnEngrenageMobile = within(barreHaute).getByRole('button', { name: 'Réglages' });
      fireEvent.click(btnEngrenageMobile);
      expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeDefined();
      expect(btnEngrenageMobile.className).toContain('actif');
      for (const b of ongletsBasse) {
        expect(b.className).not.toContain('actif');
      }

      // PastilleMoteur route vers État
      fireEvent.click(within(barreHaute).getByRole('button', { name: /Moteur/ }));
      await waitFor(() => {
        expect(screen.getAllByText('Migration taxonomie (m1)').length).toBeGreaterThan(0);
      });
      expect(screen.getByRole('heading', { level: 1, name: 'État' })).toBeDefined();
    });
  });

  describe('P0-1 — Omnibox globale (raccourcis, debounce, recherche Drive, piège Tab et focus)', () => {
    it('s’ouvre par Ctrl+K, Meta+K, bouton rail et bouton barre haute, et se ferme via Escape, fond ou 2e Ctrl+K', async () => {
      const { container } = await monterAppConnectee();

      // Ouverture via Ctrl+K
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const dialogue = screen.getByRole('dialog', { name: 'Recherche rapide' });
      expect(dialogue.getAttribute('aria-modal')).toBe('true');
      const champ = within(dialogue).getByRole('searchbox');
      expect(document.activeElement).toBe(champ);

      // Fermeture via 2e Ctrl+K
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      expect(screen.queryByRole('dialog')).toBeNull();

      // Ouverture via Meta+K puis fermeture via clic sur le fond (.feuille-fond)
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
      expect(screen.getByRole('dialog')).toBeDefined();
      fireEvent.click(container.querySelector('.feuille-fond')!);
      expect(screen.queryByRole('dialog')).toBeNull();

      // Ouverture via le bouton du rail puis restauration du focus au retour (requestAnimationFrame)
      vi.useFakeTimers();
      const btnRail = container.querySelector('nav.rail button.rail-recherche') as HTMLButtonElement;
      btnRail.focus();
      fireEvent.click(btnRail);
      expect(screen.getByRole('dialog')).toBeDefined();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30);
      });
      expect(document.activeElement).toBe(btnRail);
      vi.useRealTimers();

      // Ouverture via le bouton mobile de la barre haute puis fermeture via bouton Fermer
      const btnMobile = container.querySelector(
        'header.barre-haute button[aria-label*="Recherche rapide"]',
      ) as HTMLButtonElement;
      fireEvent.click(btnMobile);
      const diagMobile = screen.getByRole('dialog');
      fireEvent.click(within(diagMobile).getByRole('button', { name: 'Fermer' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('n’appelle pas rechercherDrive sous 2 caractères, attend 220 ms de debounce ou lance immédiatement au submit', async () => {
      await monterAppConnectee();
      vi.useFakeTimers();

      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const dialogue = screen.getByRole('dialog');
      const champ = within(dialogue).getByRole('searchbox');

      // 1 caractère : 0 appel + indice visible
      fireEvent.change(champ, { target: { value: 'a' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(spiesGoogle.rechercherDrive).not.toHaveBeenCalled();
      expect(within(dialogue).getByText(/au moins 2 caractères/)).toBeDefined();

      // 2+ caractères : pas encore appelé à 219 ms, appelé à 220 ms
      fireEvent.change(champ, { target: { value: 'Facture' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(219);
      });
      expect(spiesGoogle.rechercherDrive).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(spiesGoogle.rechercherDrive).toHaveBeenCalledTimes(1);
      expect(spiesGoogle.rechercherDrive).toHaveBeenCalledWith('Facture');
      expect(within(dialogue).getByText('2026-07-01_Facture_Hydro-Québec.pdf')).toBeDefined();

      // Bouton Effacer remet le champ à vide et redonne le focus au champ
      const btnEffacer = within(dialogue).getByRole('button', { name: 'Effacer' });
      fireEvent.click(btnEffacer);
      expect((champ as HTMLInputElement).value).toBe('');
      expect(document.activeElement).toBe(champ);

      // Soumission immédiate annule le debounce et lance rechercherDrive sans attendre 220 ms
      fireEvent.change(champ, { target: { value: 'Bellerives' } });
      const form = dialogue.querySelector('form')!;
      await act(async () => {
        fireEvent.submit(form);
      });
      expect(spiesGoogle.rechercherDrive).toHaveBeenCalledTimes(2);
      expect(spiesGoogle.rechercherDrive).toHaveBeenLastCalledWith('Bellerives');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      // Aucun double appel dû au minuteur annulé
      expect(spiesGoogle.rechercherDrive).toHaveBeenCalledTimes(2);
    });

    it('filtre les écrans sans accent, saute vers État et ouvre un dossier dans Explorateur avec fil d’Ariane exact (P1-2)', async () => {
      const { container } = await monterAppConnectee();

      // Saut vers l'écran État via filtre sans accent "ét"
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const dialogue = screen.getByRole('dialog');
      const champ = within(dialogue).getByRole('searchbox');
      fireEvent.change(champ, { target: { value: 'ét' } });
      fireEvent.click(within(dialogue).getByRole('button', { name: 'État' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: 'État' })).toBeDefined();

      // Saut vers l'écran Copilote depuis l'Omnibox
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const diagCopilote = screen.getByRole('dialog');
      fireEvent.change(within(diagCopilote).getByRole('searchbox'), { target: { value: 'copi' } });
      fireEvent.click(within(diagCopilote).getByRole('button', { name: 'Copilote' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: 'Copilote' })).toBeDefined();

      // Saut vers le dossier "Relevés" dans Explorateur depuis l'Omnibox
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const diag2 = screen.getByRole('dialog');
      const champ2 = within(diag2).getByRole('searchbox');
      fireEvent.change(champ2, { target: { value: 'Relevés' } });
      await act(async () => {
        fireEvent.submit(diag2.querySelector('form')!);
      });

      const btnDossier = await within(diag2).findByRole('button', { name: /Relevés/ });
      fireEvent.click(btnDossier);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(container.querySelector('.documents')).not.toBeNull();
        const ariane = container.querySelector('nav.ariane-fil')!;
        expect(ariane.textContent).toContain('Mon Drive');
        expect(ariane.textContent).toContain('02 · Finances');
        expect(ariane.textContent).toContain('Bellerives');
        expect(ariane.textContent).toContain('Relevés');
      });
    });

    it('piège le focus au clavier avec Tab / Shift+Tab, ignore les réponses périmées, gère erreur et tronque', async () => {
      await monterAppConnectee();
      installerStubOffsetParent();

      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      const dialogue = screen.getByRole('dialog');

      // Piège Tab : dernier focusable -> premier (Fermer) ; Shift+Tab sur premier -> dernier
      const focusables = Array.from(
        dialogue.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)',
        ),
      );
      expect(focusables.length).toBeGreaterThan(2);
      const premier = focusables[0]!;
      const dernier = focusables[focusables.length - 1]!;

      dernier.focus();
      expect(document.activeElement).toBe(dernier);
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(document.activeElement).toBe(premier);

      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(dernier);

      // Réponses asynchrones dans le désordre : la plus ancienne est ignorée
      const req1 = creerPromesseControlee<ResultatRechercheDrive>();
      const req2 = creerPromesseControlee<ResultatRechercheDrive>();
      spiesGoogle.rechercherDrive
        .mockImplementationOnce(() => req1.promesse)
        .mockImplementationOnce(() => req2.promesse);

      const champ = within(dialogue).getByRole('searchbox');
      const form = dialogue.querySelector('form')!;
      fireEvent.change(champ, { target: { value: 'ancien' } });
      await act(async () => {
        fireEvent.submit(form);
      });
      fireEvent.change(champ, { target: { value: 'recent' } });
      await act(async () => {
        fireEvent.submit(form);
      });

      await act(async () => {
        req2.resoudre({
          elements: [
            {
              id: 'doc-recent',
              name: 'Doc_Recent.pdf',
              mimeType: 'application/pdf',
              parents: ['root'],
              size: '1024',
              modifiedTime: '2026-07-06T12:00:00Z',
            },
          ],
          tronque: true,
        });
      });
      await waitFor(() => {
        expect(within(dialogue).getByText('Doc_Recent.pdf')).toBeDefined();
      });
      expect(within(dialogue).getByText('50 premiers — précise ta recherche')).toBeDefined();

      // La réponse 1 arrive après : elle ne doit pas écraser Doc_Recent.pdf
      await act(async () => {
        req1.resoudre({
          elements: [
            {
              id: 'doc-obsolete',
              name: 'Doc_Obsolete.pdf',
              mimeType: 'application/pdf',
              parents: ['root'],
            },
          ],
          tronque: false,
        });
      });
      expect(within(dialogue).getByText('Doc_Recent.pdf')).toBeDefined();
      expect(within(dialogue).queryByText('Doc_Obsolete.pdf')).toBeNull();

      // Erreur réseau sur rechercherDrive -> BanniereErreur fermable avec Fermer
      spiesGoogle.rechercherDrive.mockRejectedValueOnce(new Error('Google API 500 : erreur interne'));
      fireEvent.change(champ, { target: { value: 'panne' } });
      await act(async () => {
        fireEvent.submit(form);
      });
      const alerte = await within(dialogue).findByRole('alert');
      expect(alerte.textContent).toContain('Google est en panne');
      fireEvent.click(within(alerte).getByRole('button', { name: 'Fermer' }));
      expect(within(dialogue).queryByRole('alert')).toBeNull();
    });
  });

  describe('P2-1 — Bascule et persistance du thème Clair / Sombre dans App', () => {
    it('démarre en sombre, bascule vers Clair dans Réglages, persiste dans localStorage au remontage, puis revient à Sombre', async () => {
      const premierRendu = await monterAppConnectee();
      const rail = premierRendu.container.querySelector('nav.rail')!;
      fireEvent.click(within(rail as HTMLElement).getByRole('button', { name: 'Réglages' }));

      const btnSombre = screen.getByRole('button', { name: 'Sombre' });
      const btnClair = screen.getByRole('button', { name: 'Clair' });
      expect(btnSombre.getAttribute('aria-pressed')).toBe('true');
      expect(btnClair.getAttribute('aria-pressed')).toBe('false');
      expect(document.documentElement.dataset.theme).toBeUndefined();
      expect(document.documentElement.style.colorScheme).toBe('dark');

      fireEvent.click(btnClair);
      expect(localStorage.getItem('driveai.theme')).toBe('clair');
      expect(document.documentElement.dataset.theme).toBe('clair');
      expect(document.documentElement.style.colorScheme).toBe('light');
      expect(btnClair.getAttribute('aria-pressed')).toBe('true');
      expect(btnSombre.getAttribute('aria-pressed')).toBe('false');

      // Remontage de l'app : le thème Clair est restauré depuis localStorage
      premierRendu.unmount();
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = '';

      const secondRendu = await monterAppConnectee();
      expect(document.documentElement.dataset.theme).toBe('clair');
      expect(document.documentElement.style.colorScheme).toBe('light');

      fireEvent.click(
        within(secondRendu.container.querySelector('nav.rail') as HTMLElement).getByRole('button', {
          name: 'Réglages',
        }),
      );
      expect(screen.getByRole('button', { name: 'Clair' }).getAttribute('aria-pressed')).toBe('true');

      fireEvent.click(screen.getByRole('button', { name: 'Sombre' }));
      expect(localStorage.getItem('driveai.theme')).toBe('sombre');
      expect(document.documentElement.dataset.theme).toBeUndefined();
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('FournisseurEtat + Synchro : un clic sur Rafraîchir pendant une lecture en vol attend réellement le rejeu forcé', async () => {
      const premiereLectureIndex = creerPromesseControlee<string[][]>();
      let appelIndex = 0;
      spiesGoogle.lirePlage.mockImplementation(async (onglet: string, plage: string) => {
        if (onglet === 'Index') {
          appelIndex++;
          if (appelIndex === 1) return premiereLectureIndex.promesse;
        }
        return plageMock(onglet, plage);
      });

      const rendu = render(createElement(App));
      // Attendre que chargerConfigServeur() monte la coquille tandis que le 1er chargement Index reste en vol
      await screen.findByRole('navigation', { name: 'Sections' });
      const rail = rendu.container.querySelector('nav.rail') as HTMLElement;
      fireEvent.click(within(rail).getByRole('button', { name: 'Réglages' }));

      const btnSynchro = screen.getByTitle('Rafraîchir');
      fireEvent.click(btnSynchro);
      expect(btnSynchro.getAttribute('aria-busy')).toBe('true');
      // Tant que la 1re lecture n'a pas fini, aucun faux « Actualisé à » et pas encore de viderCachePlages
      expect(screen.queryByText(/Actualisé à/)).toBeNull();
      expect(spiesGoogle.viderCachePlages).not.toHaveBeenCalled();

      // La 1re lecture se termine : FournisseurEtat enchaîne avec le rejeu forcé avant de libérer le bouton
      await act(async () => {
        premiereLectureIndex.resoudre(plageMock('Index', 'A2:H'));
      });

      await waitFor(() => {
        expect(spiesGoogle.viderCachePlages).toHaveBeenCalledTimes(1);
        expect(appelIndex).toBe(2);
        expect(btnSynchro.getAttribute('aria-busy')).toBe('false');
        expect(screen.getByRole('status').textContent).toContain('Actualisé à');
      });
    });
  });
});
