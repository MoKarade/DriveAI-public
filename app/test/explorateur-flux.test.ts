/**
 * explorateur-flux.test.ts — Harnais de hooks React léger (environnement Node) pour tester
 * les flux interactifs et les courses asynchrones de `Explorateur.tsx`, `AujourdHui.tsx` et
 * `Reglages.tsx` sans DOM externe :
 *  - BUG-1 : `changerPortee` pendant une recherche scopée initiale encore en vol (`enCours === true`)
 *  - BUG-2 : `chargerPlus` croisé entre dossiers + garde `!enCours` sur « Aucun résultat. »
 *  - `chercher` (réponses hors ordre), `creer`, `deposer`, `allerEtape`, drag-and-drop
 *  - `AujourdHui` (`importantFait` optimiste + rollback si `ajouterLigne` rejette, navigation)
 *  - `Reglages` (`FrequenceLigne`, synchro, déconnexion)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { ElementDrive } from '../src/explorateur';
import { interpreterIndex, type LigneProgression } from '../src/etat';
import type { DonneesEtat } from '../src/etatGlobal';
import { MIME_DOSSIER } from '../src/explorateur';

/* ---------- Harnais React hooks synchrone pour Vitest (environment: 'node') ---------- */

type EtatHook = { type: 'state'; valeur: unknown }
  | { type: 'ref'; valeur: { current: unknown } }
  | { type: 'effect'; deps?: unknown[]; fn?: () => void | (() => void); cleanup?: void | (() => void) };

const harnais = vi.hoisted(() => {
  const slots: EtatHook[] = [];
  let cursor = 0;
  let dirty = false;
  const pendingEffects: Array<() => void> = [];

  function reset() {
    for (const s of slots) {
      if (s.type === 'effect' && typeof s.cleanup === 'function') s.cleanup();
    }
    slots.length = 0;
    cursor = 0;
    dirty = false;
    pendingEffects.length = 0;
  }

  function depsDifferentes(a?: unknown[], b?: unknown[]): boolean {
    if (!a || !b || a.length !== b.length) return true;
    return a.some((v, i) => !Object.is(v, b[i]));
  }

  function useState<T>(init: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
    const idx = cursor++;
    if (!slots[idx]) {
      const v = typeof init === 'function' ? (init as () => T)() : init;
      slots[idx] = { type: 'state', valeur: v };
    }
    const slot = slots[idx] as Extract<EtatHook, { type: 'state' }>;
    const setter = (next: T | ((prev: T) => T)) => {
      const nouvelle = typeof next === 'function' ? (next as (prev: T) => T)(slot.valeur as T) : next;
      if (!Object.is(slot.valeur, nouvelle)) {
        slot.valeur = nouvelle;
        dirty = true;
      }
    };
    return [slot.valeur as T, setter];
  }

  function useRef<T>(init: T): { current: T } {
    const idx = cursor++;
    if (!slots[idx]) slots[idx] = { type: 'ref', valeur: { current: init } };
    return (slots[idx] as Extract<EtatHook, { type: 'ref' }>).valeur as { current: T };
  }

  function useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const idx = cursor++;
    const prev = slots[idx] as Extract<EtatHook, { type: 'effect' }> | undefined;
    if (!prev || depsDifferentes(prev.deps, deps)) {
      const slot: Extract<EtatHook, { type: 'effect' }> = prev ?? { type: 'effect' };
      slot.deps = deps;
      slot.fn = fn;
      slots[idx] = slot;
      pendingEffects.push(() => {
        if (typeof slot.cleanup === 'function') slot.cleanup();
        slot.cleanup = slot.fn?.();
      });
    }
  }

  function useSyncExternalStore<T>(
    subscribe: (cb: () => void) => () => void,
    getSnapshot: () => T,
  ): T {
    const val = getSnapshot();
    useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
    return val;
  }

  function render<P>(Comp: (p: P) => ReactNode, props: P): ReactNode {
    let tree: ReactNode = null;
    for (let tour = 0; tour < 20; tour++) {
      dirty = false;
      cursor = 0;
      tree = Comp(props);
      while (pendingEffects.length > 0) {
        const eff = pendingEffects.shift()!;
        eff();
      }
      if (!dirty) break;
    }
    return tree;
  }

  function markDirty() {
    dirty = true;
  }

  return { reset, useState, useRef, useEffect, useSyncExternalStore, render, markDirty };
});

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: harnais.useState,
    useRef: harnais.useRef,
    useEffect: harnais.useEffect,
    useSyncExternalStore: harnais.useSyncExternalStore,
  };
});

/* ---------- Mocks google / etatGlobal / confirmation ---------- */

const mockGoogle = vi.hoisted(() => ({
  listerEnfants: vi.fn(),
  rechercherDrive: vi.fn(),
  creerDossier: vi.fn(),
  deplacerFichierManuel: vi.fn(),
  ajouterLigne: vi.fn(),
  ecrireCellule: vi.fn(),
  marquerPasSuspect: vi.fn(),
  resoudreCheminDossier: vi.fn(async (dossier: string | { id: string; nom?: string; name?: string }) => {
    const id = typeof dossier === 'string' ? dossier : dossier.id;
    const nom = typeof dossier === 'string' ? dossier : (dossier.nom ?? dossier.name ?? dossier.id);
    return {
      etapes: id === 'root'
        ? [{ id: 'root', nom: 'Mon Drive' }]
        : [{ id: 'root', nom: 'Mon Drive' }, { id, nom }],
      approximatif: false,
    };
  }),
  libelleParentEnCache: vi.fn((_el: { parents?: string[] }) => null as string | null),
}));

vi.mock('../src/google', () => ({
  listerEnfants: mockGoogle.listerEnfants,
  rechercherDrive: mockGoogle.rechercherDrive,
  creerDossier: mockGoogle.creerDossier,
  deplacerFichierManuel: mockGoogle.deplacerFichierManuel,
  ajouterLigne: mockGoogle.ajouterLigne,
  ecrireCellule: mockGoogle.ecrireCellule,
  marquerPasSuspect: mockGoogle.marquerPasSuspect,
  resoudreCheminDossier: mockGoogle.resoudreCheminDossier,
  libelleParentEnCache: mockGoogle.libelleParentEnCache,
  MARQUEUR_DROITS_FICHIER: 'droits-insuffisants-sur-element',
}));

const mockEtat = vi.hoisted(() => ({
  donnees: null as DonneesEtat | null,
  progression: [] as LigneProgression[],
  erreur: '',
  synchroA: new Date('2026-07-06T14:12:00Z') as Date | null,
  rafraichir: vi.fn(async () => {}),
}));

vi.mock('../src/etatGlobal', () => ({
  useEtatGlobal: () => mockEtat,
  useProgressionLive: () => mockEtat.progression,
}));

const mockConfirm = vi.hoisted(() => ({
  confirmer: vi.fn(() => true),
  messageDeconnexion: vi.fn(() => 'Confirmer ?'),
}));

vi.mock('../src/confirmation', () => mockConfirm);

import { Explorateur } from '../src/vues/Explorateur';
import { AujourdHui } from '../src/vues/AujourdHui';
import { Reglages } from '../src/vues/Reglages';

/* ---------- Utilitaires d'inspection de l'arbre JSX ---------- */

function extraireTexte(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extraireTexte).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    if (typeof node.type === 'function') {
      // Les composants enfants (EntetePage, BanniereErreur, Icone…) n'utilisent pas de hooks.
      try {
        return extraireTexte((node.type as (p: unknown) => ReactNode)(props));
      } catch {
        return extraireTexte(props.children);
      }
    }
    return extraireTexte(props.children);
  }
  return '';
}

function trouverTous(node: ReactNode, pred: (el: ReactElement<Record<string, unknown>>) => boolean): Array<ReactElement<Record<string, unknown>>> {
  const out: Array<ReactElement<Record<string, unknown>>> = [];
  const visiter = (n: ReactNode) => {
    if (n == null || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return;
    if (Array.isArray(n)) { n.forEach(visiter); return; }
    if (isValidElement(n)) {
      const el = n as ReactElement<Record<string, unknown>>;
      if (pred(el)) out.push(el);
      if (typeof el.type === 'function') {
        try {
          visiter((el.type as (p: unknown) => ReactNode)(el.props));
          return;
        } catch { /* composant avec hooks : parcourir children seulement */ }
      }
      visiter(el.props.children as ReactNode);
    }
  };
  visiter(node);
  return out;
}

function differe<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const viderMicrotaches = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('Explorateur.tsx — flux interactifs & courses asynchrones (Tier 5)', () => {
  beforeEach(() => {
    harnais.reset();
    vi.clearAllMocks();
    mockEtat.donnees = null;
    mockGoogle.resoudreCheminDossier.mockImplementation(async (dossier: string | { id: string; nom?: string; name?: string }) => {
      const id = typeof dossier === 'string' ? dossier : dossier.id;
      const nom = typeof dossier === 'string' ? dossier : (dossier.nom ?? dossier.name ?? dossier.id);
      return {
        etapes: id === 'root'
          ? [{ id: 'root', nom: 'Mon Drive' }]
          : [{ id: 'root', nom: 'Mon Drive' }, { id, nom }],
        approximatif: false,
      };
    });
    mockGoogle.libelleParentEnCache.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('BUG-1 : changerPortee pendant une recherche scopée initiale en vol (enCours=true) invalide la requête scopée et lance la recherche globale', async () => {
    const dossierFin: ElementDrive = { id: 'd-fin', name: '02 · Finances', mimeType: MIME_DOSSIER };
    mockGoogle.listerEnfants.mockImplementation(async (id: string) => ({
      elements: id === 'root' ? [dossierFin] : [],
      suivant: undefined,
    }));

    const reqScopee = differe<{ elements: ElementDrive[]; tronque: boolean }>();
    const reqGlobale = differe<{ elements: ElementDrive[]; tronque: boolean }>();
    mockGoogle.rechercherDrive
      .mockReturnValueOnce(reqScopee.promise)
      .mockReturnValueOnce(reqGlobale.promise);

    let arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Entrer dans 02 · Finances
    const ligneFin = trouverTous(arbre, (el) => el.type === 'div' && el.props.role === 'button' && extraireTexte(el).includes('02 · Finances'))[0];
    (ligneFin.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Saisir 'facture' puis soumettre (enCours === true, resultats === null, requeteLancee === '')
    const champ = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champ.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'facture' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const form = trouverTous(arbre, (el) => el.type === 'form')[0];
    (form.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    expect(mockGoogle.rechercherDrive).toHaveBeenCalledTimes(1);
    expect(mockGoogle.rechercherDrive).toHaveBeenNthCalledWith(1, 'facture', { dossierId: 'd-fin' });
    expect(extraireTexte(arbre)).toContain('Chargement…');
    expect(extraireTexte(arbre)).not.toContain('Aucun résultat.');

    // Effacer le champ texte en vol ne doit pas empêcher changerPortee de relancer via requeteEnCoursRef.
    const champPendantVol = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champPendantVol.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Basculer sur « Tout le Drive » pendant que la requête scopée est encore en vol
    const btnTout = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el).includes('Tout le Drive'))[0];
    (btnTout.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    expect(mockGoogle.rechercherDrive).toHaveBeenCalledTimes(2);
    expect(mockGoogle.rechercherDrive).toHaveBeenNthCalledWith(2, 'facture', undefined);

    // Résoudre d'abord la requête globale, puis la requête scopée obsolète : la scopée doit être ignorée
    reqGlobale.resolve({
      elements: [{ id: 'g1', name: 'GlobalResult.pdf', mimeType: 'application/pdf' }],
      tronque: false,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    reqScopee.resolve({
      elements: [{ id: 's1', name: 'ScopedResultOnly.pdf', mimeType: 'application/pdf' }],
      tronque: false,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const texteRendu = extraireTexte(arbre);
    expect(texteRendu).toContain('GlobalResult.pdf');
    expect(texteRendu).not.toContain('ScopedResultOnly.pdf');
  });

  it('BUG-R2-1 : changerPortee pendant une 2e recherche en vol (« contrat ») après une 1re terminée (« facture ») relance « contrat »', async () => {
    const dossierFin: ElementDrive = { id: 'd-fin', name: '02 · Finances', mimeType: MIME_DOSSIER };
    mockGoogle.listerEnfants.mockImplementation(async (id: string) => ({
      elements: id === 'root' ? [dossierFin] : [],
      suivant: undefined,
    }));

    const reqFacture = differe<{ elements: ElementDrive[]; tronque: boolean }>();
    const reqContratScopee = differe<{ elements: ElementDrive[]; tronque: boolean }>();
    const reqContratGlobale = differe<{ elements: ElementDrive[]; tronque: boolean }>();
    mockGoogle.rechercherDrive
      .mockReturnValueOnce(reqFacture.promise)
      .mockReturnValueOnce(reqContratScopee.promise)
      .mockReturnValueOnce(reqContratGlobale.promise);

    let arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Entrer dans 02 · Finances
    const ligneFin = trouverTous(arbre, (el) => el.type === 'div' && el.props.role === 'button' && extraireTexte(el).includes('02 · Finances'))[0];
    (ligneFin.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // 1re recherche terminée : « facture »
    const champ1 = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champ1.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'facture' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const form1 = trouverTous(arbre, (el) => el.type === 'form')[0];
    (form1.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    reqFacture.resolve({
      elements: [{ id: 'f-fact', name: 'FactureExemple.pdf', mimeType: 'application/pdf' }],
      tronque: false,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).toContain('FactureExemple.pdf');

    // 2e recherche maintenue en vol : « contrat »
    const champ2 = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champ2.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'contrat' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const form2 = trouverTous(arbre, (el) => el.type === 'form')[0];
    (form2.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    expect(mockGoogle.rechercherDrive).toHaveBeenCalledTimes(2);
    expect(mockGoogle.rechercherDrive).toHaveBeenNthCalledWith(2, 'contrat', { dossierId: 'd-fin' });

    // Basculer vers « Tout le Drive » pendant que « contrat » est en vol → doit relancer « contrat », pas « facture »
    const btnTout = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el).includes('Tout le Drive'))[0];
    (btnTout.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    expect(mockGoogle.rechercherDrive).toHaveBeenCalledTimes(3);
    expect(mockGoogle.rechercherDrive).toHaveBeenNthCalledWith(3, 'contrat', undefined);

    // Résoudre la globale puis la scopée obsolète
    reqContratGlobale.resolve({
      elements: [{ id: 'g-contrat', name: 'GlobalContrat.pdf', mimeType: 'application/pdf' }],
      tronque: false,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    reqContratScopee.resolve({
      elements: [{ id: 's-contrat', name: 'ScopedContratObsolete.pdf', mimeType: 'application/pdf' }],
      tronque: false,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const texteFinal = extraireTexte(arbre);
    expect(texteFinal).toContain('GlobalContrat.pdf');
    expect(texteFinal).not.toContain('ScopedContratObsolete.pdf');
  });

  it('BUG-2 : chargerPlus résolu après changement de dossier ne fuit pas dans le nouveau dossier ; !enCours masque Aucun résultat pendant une nouvelle recherche', async () => {
    const dossierFin: ElementDrive = { id: 'd-fin', name: 'Finances', mimeType: MIME_DOSSIER };
    const rootP2 = differe<{ elements: ElementDrive[]; suivant?: string }>();
    const finP1 = differe<{ elements: ElementDrive[]; suivant?: string }>();

    mockGoogle.listerEnfants.mockImplementation((id: string, pageToken?: string) => {
      if (id === 'root' && !pageToken) {
        return Promise.resolve({ elements: [dossierFin], suivant: 'p2' });
      }
      if (id === 'root' && pageToken === 'p2') {
        return rootP2.promise;
      }
      if (id === 'd-fin') {
        return finP1.promise;
      }
      return Promise.resolve({ elements: [], suivant: undefined });
    });

    let arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Déclencher chargerPlus sur root (p2 reste en vol)
    const btnPlus = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el) === 'Afficher plus')[0];
    (btnPlus.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Naviguer vers d-fin avant que root p2 ne réponde
    const ligneFin = trouverTous(arbre, (el) => el.type === 'div' && el.props.role === 'button' && extraireTexte(el).includes('Finances'))[0];
    (ligneFin.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    finP1.resolve({
      elements: [{ id: 'f-bilan', name: 'Bilan.pdf', mimeType: 'application/pdf' }],
      suivant: undefined,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Maintenant root p2 répond en retard avec un fichier racine et un pageToken 'p3'
    rootP2.resolve({
      elements: [{ id: 'f-fuite', name: 'FuiteRacine.pdf', mimeType: 'application/pdf' }],
      suivant: 'p3',
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const texteApresCourse = extraireTexte(arbre);
    expect(texteApresCourse).toContain('Bilan.pdf');
    expect(texteApresCourse).not.toContain('FuiteRacine.pdf');
    expect(texteApresCourse).not.toContain('Afficher plus');

    // Re-recherche depuis un résultat vide : pendant enCours, « Aucun résultat. » ne s'affiche pas avec « Chargement… ».
    const rVide = differe<{ elements: ElementDrive[]; tronque: boolean }>();
    const rDeux = differe<{ elements: ElementDrive[]; tronque: boolean }>();
    mockGoogle.rechercherDrive.mockReturnValueOnce(rVide.promise).mockReturnValueOnce(rDeux.promise);

    const champ = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champ.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'rien' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const form = trouverTous(arbre, (el) => el.type === 'form')[0];
    (form.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    rVide.resolve({ elements: [], tronque: false });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).toContain('Aucun résultat.');

    // Lancer une deuxième recherche : enCours === true doit masquer « Aucun résultat. »
    const champ2 = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champ2.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'bilan' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const form2 = trouverTous(arbre, (el) => el.type === 'form')[0];
    (form2.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const pendantReRecherche = extraireTexte(arbre);
    expect(pendantReRecherche).toContain('Chargement…');
    expect(pendantReRecherche).not.toContain('Aucun résultat.');
    rDeux.resolve({ elements: [], tronque: false });
    await viderMicrotaches();
  });

  it('couvre creer, deposer (no-op vs succès vs erreur), surDrop, effacerRecherche et allerEtape', async () => {
    const doc: ElementDrive = { id: 'f-1', name: 'Facture.pdf', mimeType: 'application/pdf', size: '1024', modifiedTime: '2026-07-06T12:00:00Z' };
    const dossierA: ElementDrive = { id: 'd-a', name: 'Alpha', mimeType: MIME_DOSSIER };
    mockGoogle.listerEnfants.mockResolvedValue({ elements: [dossierA, doc], suivant: undefined });
    mockGoogle.creerDossier
      .mockRejectedValueOnce(new Error('droits insuffisants'))
      .mockResolvedValueOnce({ id: 'd-nouveau', name: 'Impôts', mimeType: MIME_DOSSIER });
    mockGoogle.deplacerFichierManuel
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('zone-protegee'))
      .mockResolvedValueOnce(true);

    let arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Ouvrir création de dossier, tester échec puis succès
    const btnNouveau = trouverTous(arbre, (el) => el.type === 'button' && el.props['aria-label'] === 'Nouveau dossier')[0];
    (btnNouveau.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const inputNom = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Nouveau dossier')[0];
    (inputNom.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'Impôts' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const inputNom2 = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Nouveau dossier')[0];
    (inputNom2.props.onKeyDown as (e: { key: string }) => void)({ key: 'Enter' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).toContain('droits insuffisants');

    const btnCreer = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el) === 'Créer')[0];
    (btnCreer.props.onClick as () => void)();
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(mockGoogle.creerDossier).toHaveBeenCalledWith('Impôts', 'root');
    expect(extraireTexte(arbre)).toContain('Dossier créé : Impôts');

    // Mode déplacer + drop via surDrop (payload invalide, auto-drop, no-op false, erreur, puis succès true)
    const btnDeplacer = trouverTous(arbre, (el) => el.type === 'button' && el.props['aria-label'] === 'Déplacer : Facture.pdf')[0];
    (btnDeplacer.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).toContain('Déposer ici');

    // Drag start sur le fichier pour couvrir surDragStart
    const ligneFichier = trouverTous(arbre, (el) => el.type === 'div' && el.props.draggable === true)[0];
    const dragBag: Record<string, string> = {};
    let effectAllowed = '';
    (ligneFichier.props.onDragStart as (e: { dataTransfer: { clearData: () => void; setData: (k: string, v: string) => void; effectAllowed: string } }) => void)({
      dataTransfer: {
        clearData() {},
        setData(k: string, v: string) { dragBag[k] = v; },
        set effectAllowed(v: string) { effectAllowed = v; },
        get effectAllowed() { return effectAllowed; },
      },
    });
    expect(dragBag['application/x-driveai-fichier']).toBe(JSON.stringify({ id: 'f-1', name: 'Facture.pdf' }));

    // Drop payload malformé → ignoré sans appel
    const cibleDossier = trouverTous(arbre, (el) => el.type === 'div' && el.props.role === 'button' && extraireTexte(el).includes('Alpha'))[0];
    (cibleDossier.props.onDrop as (e: { preventDefault: () => void; dataTransfer: { getData: () => string } }) => void)({
      preventDefault() {},
      dataTransfer: { getData: () => '{invalide' },
    });
    expect(mockGoogle.deplacerFichierManuel).not.toHaveBeenCalled();

    // Déposer sur le dossier courant (no-op false)
    const btnDeposer = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el).includes('Déposer ici'))[0];
    (btnDeposer.props.onClick as () => void)();
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).not.toContain('Déplacé :');

    // Sélectionner à nouveau → erreur zone protégée
    const btnDeplacer2 = trouverTous(arbre, (el) => el.type === 'button' && el.props['aria-label'] === 'Déplacer : Facture.pdf')[0];
    (btnDeplacer2.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const btnDeposer2 = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el).includes('Déposer ici'))[0];
    (btnDeposer2.props.onClick as () => void)();
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).toContain('zone-protegee');

    // Drop valide sur Alpha (succès true → setRafraichir déclenche un re-listing)
    (cibleDossier.props.onDrop as (e: { preventDefault: () => void; dataTransfer: { getData: () => string } }) => void)({
      preventDefault() {},
      dataTransfer: { getData: () => JSON.stringify({ id: 'f-1', name: 'Facture.pdf' }) },
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).toContain('Déplacé : Facture.pdf → Alpha');

    // Navigation Ariane : entrer dans Alpha au clavier puis remonter à Mon Drive
    const ligneAlpha = trouverTous(arbre, (el) => el.type === 'div' && el.props.role === 'button' && extraireTexte(el).includes('Alpha'))[0];
    (ligneAlpha.props.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)({ key: 'Enter', preventDefault() {} });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const btnRacine = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el) === 'Mon Drive')[0];
    (btnRacine.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    expect(mockGoogle.listerEnfants).toHaveBeenCalledWith('root');
  });

  it('P1-1 : filtres rapides .gf-chip filtrent en mémoire sans requête réseau, affichent l’état vide et se réinitialisent à la navigation', async () => {
    const dossierA: ElementDrive = { id: 'd-a', name: '02 · Finances', mimeType: MIME_DOSSIER };
    const docPdfVerif: ElementDrive = { id: 'f-verif', name: 'Scan_illisible.pdf', mimeType: 'application/pdf' };
    const docPdfFaible: ElementDrive = { id: 'f-faible', name: 'Recu_douteux.pdf', mimeType: 'application/pdf' };
    const docHtmlTech: ElementDrive = { id: 'f-tech', name: 'export.html', mimeType: 'text/html' };

    mockEtat.donnees = {
      index: interpreterIndex([
        ['drive|f-verif', '2026-07-06T11:20:00', 'Scan_illisible.pdf', '', '00 · À vérifier', 'à vérifier', '', ''],
        ['drive|f-faible', '2026-07-06T11:15:00', 'Recu_douteux.pdf', '05 · Santé', '', 'classé', '', '0.42'],
        ['drive|f-tech', '2026-07-04T19:01:12', 'export.html', '', '_Technique', 'technique', '', ''],
      ]),
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    };
    mockGoogle.listerEnfants.mockImplementation(async (id: string) => ({
      elements: id === 'root' ? [dossierA, docPdfVerif, docPdfFaible, docHtmlTech] : [],
      suivant: undefined,
    }));

    let arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(mockGoogle.listerEnfants).toHaveBeenCalledTimes(1);

    const cliquerFiltre = (libelle: string) => {
      const btn = trouverTous(arbre, (el) => el.type === 'button' && String(el.props.className ?? '').includes('gf-chip') && extraireTexte(el) === libelle)[0];
      (btn.props.onClick as () => void)();
      arbre = harnais.render(Explorateur, { langue: 'fr' });
    };

    // Dossiers
    cliquerFiltre('Dossiers');
    expect(extraireTexte(arbre)).toContain('02 · Finances');
    expect(extraireTexte(arbre)).not.toContain('Scan_illisible.pdf');
    expect(mockGoogle.listerEnfants).toHaveBeenCalledTimes(1);
    expect(mockGoogle.rechercherDrive).not.toHaveBeenCalled();

    // PDF
    cliquerFiltre('PDF');
    expect(extraireTexte(arbre)).toContain('Scan_illisible.pdf');
    expect(extraireTexte(arbre)).toContain('Recu_douteux.pdf');
    expect(extraireTexte(arbre)).not.toContain('export.html');
    expect(extraireTexte(arbre)).not.toContain('02 · Finances');

    // À vérifier
    cliquerFiltre('À vérifier');
    expect(extraireTexte(arbre)).toContain('Scan_illisible.pdf');
    expect(extraireTexte(arbre)).not.toContain('Recu_douteux.pdf');

    // Confiance < 50 %
    cliquerFiltre('Confiance < 50 %');
    expect(extraireTexte(arbre)).toContain('Recu_douteux.pdf');
    expect(extraireTexte(arbre)).not.toContain('Scan_illisible.pdf');

    // État vide quand aucun élément ne correspond (dossier vide ou filtre exclusif sur recherche)
    mockGoogle.rechercherDrive.mockResolvedValueOnce({
      elements: [docHtmlTech, docPdfVerif],
      tronque: false,
    });
    const champ = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champ.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'export' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const form = trouverTous(arbre, (el) => el.type === 'form')[0];
    (form.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    // Confiance < 50 % toujours actif sur résultats → 0 / 2 résultat(s) + Aucun résultat.
    expect(extraireTexte(arbre)).toContain('0 / 2 résultat(s)');
    expect(extraireTexte(arbre)).toContain('Aucun résultat.');

    // Tout → retrouve 2 résultat(s)
    cliquerFiltre('Tout');
    expect(extraireTexte(arbre)).toContain('2 résultat(s)');
    expect(extraireTexte(arbre)).toContain('export.html');

    // Navigation dans un dossier réinitialise le filtre actif à Tout
    cliquerFiltre('Dossiers');
    cliquerFiltre('Tout');
    const effacer = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el).includes('Effacer') && !String(el.props.className ?? '').includes('recherche-effacer'))[0];
    (effacer.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    cliquerFiltre('PDF');
    const btnPdf = trouverTous(arbre, (el) => el.type === 'button' && String(el.props.className ?? '').includes('gf-chip') && extraireTexte(el) === 'PDF')[0];
    expect(btnPdf.props['aria-pressed']).toBe(true);

    // Ouvrir un dossier réinitialise filtre à 'tout'
    cliquerFiltre('Tout');
    const ligneDossier = trouverTous(arbre, (el) => el.type === 'div' && el.props.role === 'button' && extraireTexte(el).includes('02 · Finances'))[0];
    cliquerFiltre('PDF');
    (ligneDossier.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const btnToutApres = trouverTous(arbre, (el) => el.type === 'button' && String(el.props.className ?? '').includes('gf-chip') && extraireTexte(el) === 'Tout')[0];
    expect(btnToutApres.props['aria-pressed']).toBe(true);
    expect(mockGoogle.listerEnfants).toHaveBeenCalledTimes(2);
  });

  it('P1-2 : affiche le parent en cache sur les résultats de recherche, reconstruit l’Ariane exact et gère Omnibox cibleExplorateur + course', async () => {
    const dossierCible: ElementDrive = {
      id: 'd-releves',
      name: 'Relevés',
      mimeType: MIME_DOSSIER,
      parents: ['d-bellerives'],
    };
    const fichierResultat: ElementDrive = {
      id: 'f-releve',
      name: 'Relevé_2026.pdf',
      mimeType: 'application/pdf',
      parents: ['d-releves'],
    };

    mockGoogle.listerEnfants.mockResolvedValue({ elements: [], suivant: undefined });
    mockGoogle.rechercherDrive.mockResolvedValue({ elements: [dossierCible, fichierResultat], tronque: false });
    mockGoogle.libelleParentEnCache.mockImplementation((el: { parents?: string[] }) =>
      el.parents?.[0] === 'd-bellerives' ? 'Bellerives' : 'Relevés');

    const resDiffere = differe<{ etapes: Array<{ id: string; nom: string }>; approximatif: boolean }>();
    mockGoogle.resoudreCheminDossier.mockReturnValueOnce(resDiffere.promise);

    let arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    // Recherche : libelleParentEnCache appelé de manière synchrone (0 listerEnfants supplémentaire)
    const champ = trouverTous(arbre, (el) => el.type === 'input' && el.props['aria-label'] === 'Rechercher')[0];
    (champ.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'Relevé' } });
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    const form = trouverTous(arbre, (el) => el.type === 'form')[0];
    (form.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    expect(mockGoogle.listerEnfants).toHaveBeenCalledTimes(1);
    expect(extraireTexte(arbre)).toContain('Bellerives');
    expect(extraireTexte(arbre)).toContain('Relevés');

    // Clic sur le dossier dans les résultats → fil d'Ariane provisoire puis exact
    const ligneDossier = trouverTous(arbre, (el) => el.type === 'div' && el.props.role === 'button' && extraireTexte(el).includes('Relevés'))[0];
    (ligneDossier.props.onClick as () => void)();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(mockGoogle.resoudreCheminDossier).toHaveBeenCalledWith(
      { id: 'd-releves', nom: 'Relevés', parents: ['d-bellerives'] },
      { nomRacine: 'Mon Drive' },
    );

    resDiffere.resolve({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'd-fin', nom: '02 · Finances' },
        { id: 'd-bellerives', nom: 'Bellerives' },
        { id: 'd-releves', nom: 'Relevés' },
      ],
      approximatif: false,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const navAriane = trouverTous(arbre, (el) => el.type === 'nav' && el.props['aria-label'] === 'Chemin')[0];
    expect(extraireTexte(navAriane)).toContain('Mon Drive');
    expect(extraireTexte(navAriane)).toContain('02 · Finances');
    expect(extraireTexte(navAriane)).toContain('Bellerives');
    expect(extraireTexte(navAriane)).toContain('Relevés');

    // Navigation via Omnibox cibleExplorateur avec jeton + repli gracieux si resoudreCheminDossier échoue
    const onConsommee = vi.fn();
    mockGoogle.resoudreCheminDossier.mockRejectedValueOnce(new Error('403'));
    arbre = harnais.render(Explorateur, {
      langue: 'fr',
      cibleExplorateur: { cible: { id: 'd-bail', nom: 'Bail', parents: ['d-logement'] }, jeton: 7 },
      onCibleConsommee: onConsommee,
    });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, {
      langue: 'fr',
      cibleExplorateur: { cible: { id: 'd-bail', nom: 'Bail', parents: ['d-logement'] }, jeton: 7 },
      onCibleConsommee: onConsommee,
    });
    expect(onConsommee).toHaveBeenCalledWith(7);
    expect(extraireTexte(arbre)).toContain('Bail');
    expect(extraireTexte(arbre)).toContain('Chemin parent exact indisponible');
  });

  it('P1-3 : affiche les pastilles Index sur les fichiers et gère Copier le lien (succès + repli sans clipboard)', async () => {
    const fClasseFaible: ElementDrive = { id: 'f-009', name: 'Recu_Clinique.pdf', mimeType: 'application/pdf' };
    const fTech: ElementDrive = { id: 'f-006', name: 'export.html', mimeType: 'text/html', webViewLink: 'https://drive.google.com/file/d/f-006/view?usp=drivesdk' };
    const fSansIndex: ElementDrive = { id: 'f-inconnu', name: 'Note_brute.txt', mimeType: 'text/plain' };

    mockEtat.donnees = {
      index: interpreterIndex([
        ['drive|f-009', '2026-07-06T11:15:00', 'Recu_Clinique.pdf', '05 · Santé', '', 'classé', '', '0.42'],
        ['drive|f-006', '2026-07-04T19:01:12', 'export.html', '', '_Technique', 'technique', '', ''],
      ]),
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    };
    mockGoogle.listerEnfants.mockResolvedValue({
      elements: [fClasseFaible, fTech, fSansIndex],
      suivant: undefined,
    });

    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    let arbre = harnais.render(Explorateur, { langue: 'fr' });
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });

    const texte = extraireTexte(arbre);
    expect(texte).toContain('Classé');
    expect(texte).toContain('Confiance faible');
    expect(texte).toContain('Technique');

    // Vérifier qu'aucune pastille n'est rendue sur le fichier hors Index
    const pastilles = trouverTous(arbre, (el) => el.type === 'span' && String(el.props.className ?? '').includes('pastille-index'));
    expect(pastilles).toHaveLength(3); // Classé + Confiance faible sur f-009, Technique sur f-006

    // Copier le lien sur f-009 (utilise l'URL Drive construite car webViewLink absent)
    const btnCopier009 = trouverTous(arbre, (el) => el.type === 'button' && el.props['aria-label'] === 'Copier le lien : Recu_Clinique.pdf')[0];
    (btnCopier009.props.onClick as () => void)();
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(writeText).toHaveBeenCalledWith('https://drive.google.com/file/d/f-009/view');
    expect(extraireTexte(arbre)).toContain('Lien copié');

    // Copier le lien sans API clipboard → repli gracieux sans exception
    vi.stubGlobal('navigator', {});
    const btnCopier006 = trouverTous(arbre, (el) => el.type === 'button' && el.props['aria-label'] === 'Copier le lien : export.html')[0];
    (btnCopier006.props.onClick as () => void)();
    await viderMicrotaches();
    arbre = harnais.render(Explorateur, { langue: 'fr' });
    expect(extraireTexte(arbre)).toContain('Copie impossible — ouvre le lien directement');
  });
});

describe('AujourdHui.tsx & Reglages.tsx — interactions boutons et formulaires (Tier 5)', () => {
  beforeEach(() => {
    harnais.reset();
    vi.clearAllMocks();
    mockEtat.progression = [];
  });

  it('AujourdHui : importantFait masque de manière optimiste et rétablit + affiche l’erreur si ajouterLigne rejette', async () => {
    const maintenantIso = new Date().toISOString().slice(0, 19);
    mockEtat.donnees = {
      index: interpreterIndex([
        ['important|msg-900', maintenantIso, 'Renouvellement bail', '', '', 'important', '', ''],
      ]),
      santeBrut: [['Compte LLM : ⛔ panne']],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    };
    const echecAjout = differe<void>();
    mockGoogle.ajouterLigne.mockReturnValueOnce(echecAjout.promise);
    const onAller = vi.fn();

    let arbre = harnais.render(AujourdHui, { langue: 'fr', onAller });
    expect(extraireTexte(arbre)).toContain('Renouvellement bail');

    // Bouton État dans le bandeau incidentCritique
    const btnEtat = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el).includes('État'))[0];
    (btnEtat.props.onClick as () => void)();
    expect(onAller).toHaveBeenCalledWith('etat');

    // Bouton Documents ›
    const btnDocs = trouverTous(arbre, (el) => el.type === 'button' && el.props['aria-label'] === 'Documents ›')[0];
    (btnDocs.props.onClick as () => void)();
    expect(onAller).toHaveBeenCalledWith('documents');

    // Cliquer sur « Fait » → masquage optimiste immédiat
    const btnFait = trouverTous(arbre, (el) => el.type === 'button' && el.props['aria-label'] === 'Fait : Renouvellement bail')[0];
    (btnFait.props.onClick as () => void)();
    arbre = harnais.render(AujourdHui, { langue: 'fr', onAller });
    expect(extraireTexte(arbre)).not.toContain('Renouvellement bail');
    expect(extraireTexte(arbre)).toContain('Rien à faire');

    // Rejet de ajouterLigne → rollback et bannière d'erreur
    echecAjout.reject(new Error('Sheets indisponible'));
    await viderMicrotaches();
    arbre = harnais.render(AujourdHui, { langue: 'fr', onAller });
    expect(extraireTexte(arbre)).toContain('Renouvellement bail');
    expect(extraireTexte(arbre)).toContain('Sheets indisponible');
  });

  it('Reglages : FrequenceLigne (succès + rollback sur échec), synchro et déconnexion', async () => {
    mockEtat.donnees = {
      index: [],
      santeBrut: [['Dernier passage OK : 2026-07-06 14:12']],
      journalBrut: [],
      reglagesBrut: [['TICK_MINUTES', '5']],
      telemetrieBrut: [],
      coutsBrut: [],
    };
    mockGoogle.ecrireCellule
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('quota écriture'));

    const onLangue = vi.fn();
    const onDeconnexion = vi.fn();
    let arbre = harnais.render(Reglages, { langue: 'fr', onLangue, onDeconnexion });

    // Changer fréquence vers 15 min (succès)
    const select1 = trouverTous(arbre, (el) => el.type === 'select')[0];
    (select1.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '15' } });
    await viderMicrotaches();
    arbre = harnais.render(Reglages, { langue: 'fr', onLangue, onDeconnexion });
    expect(mockGoogle.ecrireCellule).toHaveBeenCalledWith('Réglages', 'B2', '15');
    expect(extraireTexte(arbre)).toContain('au prochain passage');

    // Changer fréquence vers 30 min (échec → rollback à 15)
    const select2 = trouverTous(arbre, (el) => el.type === 'select')[0];
    (select2.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '30' } });
    await viderMicrotaches();
    arbre = harnais.render(Reglages, { langue: 'fr', onLangue, onDeconnexion });
    const selectApres = trouverTous(arbre, (el) => el.type === 'select')[0];
    expect(selectApres.props.value).toBe('15');
    expect(extraireTexte(arbre)).toContain('quota écriture');

    // Synchro + Déconnexion
    const btnSynchro = trouverTous(arbre, (el) => el.type === 'button' && el.props.title === 'Rafraîchir')[0];
    (btnSynchro.props.onClick as () => void)();
    await viderMicrotaches();
    expect(mockEtat.rafraichir).toHaveBeenCalledWith(true);

    const btnDeco = trouverTous(arbre, (el) => el.type === 'button' && extraireTexte(el) === 'Se déconnecter')[0];
    (btnDeco.props.onClick as () => void)();
    expect(onDeconnexion).toHaveBeenCalledTimes(1);
  });
});
