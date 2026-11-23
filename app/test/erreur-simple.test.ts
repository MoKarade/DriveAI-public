/**
 * erreur-simple.test.ts — carte 1 (15/10) : le bandeau rouge dit une phrase simple, pas « Error: Google API 403 : {…} ».
 */
import { describe, it, expect } from 'vitest';
import { erreurSimple } from '../src/erreurSimple';
import { MARQUEUR_DROITS_FICHIER, messageQuota } from '../src/google';

describe('erreurSimple', () => {
  it('droits refusés sur un fichier (marqueur canonique)', () => {
    const brut = `Error: Google API 403 : ${MARQUEUR_DROITS_FICHIER} : {"error":{"errors":[{"reason":"insufficientFilePermissions"}]}}`;
    expect(erreurSimple(brut, 'fr')).toBe('Google refuse l\'accès à ce fichier');
    expect(erreurSimple(brut, 'en')).toBe('Google refuses access to this file');
  });

  it('403 sans marqueur : accès refusé, sans jargon', () => {
    expect(erreurSimple('Error: Google API 403 : {"error":"x"}', 'fr')).toBe('Google refuse l\'accès');
  });

  it('trop de demandes (message de quota existant et 429)', () => {
    expect(erreurSimple(`Error: ${messageQuota('https://www.googleapis.com/drive/v3/files')}`, 'fr'))
      .toBe('Trop de demandes à Google : réessaie dans quelques secondes');
    expect(erreurSimple('Google API 429 : x', 'en')).toBe('Too many requests to Google: try again in a few seconds');
  });

  it('pas de réseau', () => {
    expect(erreurSimple('TypeError: Failed to fetch', 'fr')).toBe('Pas de réseau : vérifie ta connexion');
    expect(erreurSimple('TypeError: NetworkError when attempting to fetch resource.', 'en'))
      .toBe('No network: check your connection');
  });

  it('panne côté Google (5xx)', () => {
    expect(erreurSimple('Error: Google API 503 : <html>', 'fr')).toBe('Google est en panne, réessaie plus tard');
  });

  it('non connecté', () => {
    expect(erreurSimple('Error: Non connecté', 'fr')).toBe('Tu n\'es plus connecté : reconnecte-toi');
  });

  it('message inconnu : gardé tel quel, sans le préfixe « Error: »', () => {
    expect(erreurSimple('Error: quelque chose de précis', 'fr')).toBe('quelque chose de précis');
  });

  it('message vide : reste vide', () => {
    expect(erreurSimple('', 'fr')).toBe('');
  });
});
