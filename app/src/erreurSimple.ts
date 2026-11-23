/**
 * erreurSimple.ts — traduit une erreur technique en phrase simple (carte 1, 15/10).
 * PURE : prend le texte brut (`String(e)`), rend la phrase affichée dans le bandeau rouge.
 * Un message inconnu reste lisible tel quel (sans le préfixe « Error: »), pour le diagnostic.
 */

import type { Langue } from './i18n';
import { MARQUEUR_DROITS_FICHIER } from './google';

const PHRASES = {
  fr: {
    droitsFichier: 'Google refuse l\'accès à ce fichier',
    droits: 'Google refuse l\'accès',
    quota: 'Trop de demandes à Google : réessaie dans quelques secondes',
    reseau: 'Pas de réseau : vérifie ta connexion',
    panne: 'Google est en panne, réessaie plus tard',
    deconnecte: 'Tu n\'es plus connecté : reconnecte-toi',
  },
  en: {
    droitsFichier: 'Google refuses access to this file',
    droits: 'Google refuses access',
    quota: 'Too many requests to Google: try again in a few seconds',
    reseau: 'No network: check your connection',
    panne: 'Google is down, try again later',
    deconnecte: 'You are no longer signed in: sign in again',
  },
} as const;

export function erreurSimple(brut: string, langue: Langue): string {
  if (!brut) return '';
  const p = PHRASES[langue];
  if (brut.includes(MARQUEUR_DROITS_FICHIER)) return p.droitsFichier;
  if (/Google API 403/.test(brut)) return p.droits;
  if (/Google API 429|saturé \(quota/.test(brut)) return p.quota;
  if (/Google API 5\d\d/.test(brut)) return p.panne;
  if (/Failed to fetch|NetworkError|Load failed/i.test(brut)) return p.reseau;
  if (/Non connecté/.test(brut)) return p.deconnecte;
  return brut.replace(/^Error:\s*/, '');
}
