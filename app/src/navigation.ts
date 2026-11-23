/**
 * navigation.ts — contrat de navigation de la coquille (P1-4, P0-2, P0-1).
 *
 * Module de logique pure sans aucun import `.tsx` (règle `logique-sans-ecran`) afin de
 * rompre le cycle d'import `App.tsx ↔ AujourdHui.tsx`.
 */

/** Identifiant d'écran dans la coquille applicative. */
export type Section = 'aujourdhui' | 'documents' | 'etat' | 'reglages';

/** Trois onglets principaux de navigation (Aujourd’hui · Documents · État) ; Réglages reste à part. */
export const SECTIONS_NAV: readonly Section[] = ['aujourdhui', 'documents', 'etat'] as const;

/** Cible d'ouverture directe d'un dossier dans Documents / Explorateur (ex. depuis la recherche globale). */
export interface CibleNavigationExplorateur {
  id: string;
  nom: string;
  parents?: string[];
}
