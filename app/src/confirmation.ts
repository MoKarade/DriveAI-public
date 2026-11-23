/**
 * confirmation.ts — cartes 7, 8, 13, 17 (15/10) : demander « sûr ? » avant un geste en masse ou
 * difficile à défaire. Le texte est une fonction pure (testable) ; `confirmer` ne fait qu'appeler la
 * boîte du navigateur. Pas de boîte disponible (tests, rendu serveur) : on NE confirme PAS (échec fermé).
 */

import { Langue } from './i18n';

/** Pluriel simple FR/EN : « 1 proposition » / « 12 propositions ». */
function pluriel(n: number, singulier: string, plur: string): string {
  return `${n} ${n === 1 ? singulier : plur}`;
}

export function messageToutValider(n: number, langue: Langue): string {
  return langue === 'fr'
    ? `Valider ${n === 1 ? 'la proposition' : `les ${pluriel(n, 'proposition', 'propositions')}`} ?`
    : `Approve ${pluriel(n, 'proposal', 'proposals')}?`;
}

export function messageToutCorbeiller(n: number, langue: Langue): string {
  return langue === 'fr'
    ? `Mettre ${pluriel(n, 'dossier vide', 'dossiers vides')} à la corbeille ?`
    : `Move ${pluriel(n, 'empty folder', 'empty folders')} to the trash?`;
}

export function messageDeconnexion(langue: Langue): string {
  return langue === 'fr' ? 'Se déconnecter ?' : 'Sign out?';
}

/** Vrai seulement si Marc répond oui. Sans boîte de dialogue : faux. */
export function confirmer(message: string): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  return window.confirm(message);
}
