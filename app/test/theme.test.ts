// @vitest-environment jsdom
/**
 * theme.test.ts — tests unitaires de la gestion de thème (P2-1) sous environnement jsdom.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  THEME_DEFAUT,
  CLE_THEME,
  type ThemeApp,
  lireTheme,
  enregistrerTheme,
  appliquerThemeDom,
  initialiserTheme,
} from '../src/theme';

describe('theme.ts (P2-1 — sombre par défaut, clair optionnel)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
  });

  it('expose les constantes attendues (THEME_DEFAUT = sombre, CLE_THEME = driveai.theme)', () => {
    const defaut: ThemeApp = THEME_DEFAUT;
    expect(defaut).toBe('sombre');
    expect(CLE_THEME).toBe('driveai.theme');
  });

  it('lireTheme : stockage vide → repli vers sombre', () => {
    expect(lireTheme()).toBe('sombre');
  });

  it('lireTheme : retourne clair ou sombre quand une valeur valide est stockée', () => {
    localStorage.setItem(CLE_THEME, 'clair');
    expect(lireTheme()).toBe('clair');

    localStorage.setItem(CLE_THEME, 'sombre');
    expect(lireTheme()).toBe('sombre');
  });

  it('lireTheme : valeur invalide en stockage → repli vers sombre', () => {
    for (const invalide of ['bleu', '', 'dark', 'light', 'CLAIR']) {
      localStorage.setItem(CLE_THEME, invalide);
      expect(lireTheme(), `valeur=${invalide}`).toBe('sombre');
    }
  });

  it('lireTheme : localStorage absent ou getItem qui lève → repli sûr sans exception', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(lireTheme()).toBe('sombre');

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => {},
    });
    expect(lireTheme()).toBe('sombre');
  });

  it('enregistrerTheme : persiste clair et sombre sous CLE_THEME, normalise une valeur invalide', () => {
    enregistrerTheme('clair');
    expect(localStorage.getItem(CLE_THEME)).toBe('clair');
    expect(lireTheme()).toBe('clair');

    enregistrerTheme('sombre');
    expect(localStorage.getItem(CLE_THEME)).toBe('sombre');
    expect(lireTheme()).toBe('sombre');

    enregistrerTheme('invalide' as ThemeApp);
    expect(localStorage.getItem(CLE_THEME)).toBe('sombre');
  });

  it('enregistrerTheme : localStorage absent ou setItem qui lève → aucune exception', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => enregistrerTheme('clair')).not.toThrow();

    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('QuotaExceededError'); },
    });
    expect(() => enregistrerTheme('clair')).not.toThrow();
  });

  it('appliquerThemeDom : clair pose data-theme="clair" et colorScheme="light" ; sombre retire data-theme et pose colorScheme="dark"', () => {
    appliquerThemeDom('clair');
    expect(document.documentElement.dataset.theme).toBe('clair');
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair');
    expect(document.documentElement.style.colorScheme).toBe('light');

    appliquerThemeDom('sombre');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('appliquerThemeDom : tolère document absent ou incomplet et fonctionne avec un document factice minimal', () => {
    expect(() => appliquerThemeDom('clair', undefined)).not.toThrow();
    expect(() => appliquerThemeDom('clair', {} as Document)).not.toThrow();

    const docFactice = {
      documentElement: {
        dataset: {} as Record<string, string | undefined>,
        style: {} as { colorScheme?: string },
      },
    } as unknown as Document;

    appliquerThemeDom('clair', docFactice);
    expect(docFactice.documentElement.dataset.theme).toBe('clair');
    expect(docFactice.documentElement.style.colorScheme).toBe('light');

    appliquerThemeDom('sombre', docFactice);
    expect(docFactice.documentElement.dataset.theme).toBeUndefined();
    expect(docFactice.documentElement.style.colorScheme).toBe('dark');
  });

  it('initialiserTheme : lit le thème mémorisé, l’applique au DOM et le retourne', () => {
    expect(initialiserTheme()).toBe('sombre');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    enregistrerTheme('clair');
    expect(initialiserTheme()).toBe('clair');
    expect(document.documentElement.dataset.theme).toBe('clair');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
