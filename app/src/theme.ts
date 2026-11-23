/**
 * theme.ts — gestion du thème visuel (P2-1 : sombre par défaut, clair « Google Light » optionnel).
 *
 * Module de logique pure sans aucun import `.tsx`, calqué sur `i18n.ts` avec gardes strictes
 * lorsque `localStorage` ou `document` est indisponible ou lève une exception.
 */

/** Identifiant de thème supporté par l'application. */
export type ThemeApp = 'sombre' | 'clair';

/** Thème par défaut conservé à l'ouverture (ADR design sombre). */
export const THEME_DEFAUT: ThemeApp = 'sombre';

/** Clé de persistance locale du thème choisi dans Réglages. */
export const CLE_THEME = 'driveai.theme';

/** Lit le thème persisté dans `localStorage`, avec repli sûr vers `'sombre'`. */
export function lireTheme(): ThemeApp {
  try {
    if (typeof localStorage === 'undefined') return THEME_DEFAUT;
    const brut = localStorage.getItem(CLE_THEME);
    return brut === 'clair' || brut === 'sombre' ? brut : THEME_DEFAUT;
  } catch {
    return THEME_DEFAUT;
  }
}

/** Enregistre le thème dans `localStorage` sans jamais lever d'exception si le stockage refuse. */
export function enregistrerTheme(theme: ThemeApp): void {
  const valide: ThemeApp = theme === 'clair' ? 'clair' : THEME_DEFAUT;
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CLE_THEME, valide);
  } catch {
    /* stockage indisponible ou quota atteint : dégradation silencieuse */
  }
}

/** Applique `data-theme` et `color-scheme` sur `documentElement` (`sombre` retire `data-theme`). */
export function appliquerThemeDom(
  theme: ThemeApp,
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
): void {
  if (!doc?.documentElement) return;
  const valide: ThemeApp = theme === 'clair' ? 'clair' : THEME_DEFAUT;
  if (doc.documentElement.dataset) {
    if (valide === 'clair') doc.documentElement.dataset.theme = 'clair';
    else delete doc.documentElement.dataset.theme;
  }
  if (doc.documentElement.style) {
    doc.documentElement.style.colorScheme = valide === 'clair' ? 'light' : 'dark';
  }
}

/** Lit le thème mémorisé, l'applique au DOM au démarrage et retourne le thème actif. */
export function initialiserTheme(): ThemeApp {
  const theme = lireTheme();
  appliquerThemeDom(theme);
  return theme;
}
