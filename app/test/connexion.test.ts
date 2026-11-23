import { describe, it, expect } from 'vitest';
import { motifEchecDepuisUrl } from '../src/connexion';

describe('motifEchecDepuisUrl', () => {
  it("rend le motif du serveur, nettoyé, quand le retour est en échec", () => {
    expect(motifEchecDepuisUrl('?auth=echec&motif=echange%3Ainvalid_client')).toBe('echange:invalid_client');
    expect(motifEchecDepuisUrl('?auth=echec&motif=%3Cb%3Ex%20y%3C%2Fb%3E')).toBe('bxyb');
    expect(motifEchecDepuisUrl('?auth=echec')).toBe('');
  });

  it("rend null hors échec (aucun message)", () => {
    expect(motifEchecDepuisUrl('')).toBeNull();
    expect(motifEchecDepuisUrl('?erreur=acces_refuse')).toBeNull();
    expect(motifEchecDepuisUrl('?auth=config')).toBeNull();
  });

  it("borne la longueur du motif", () => {
    expect(motifEchecDepuisUrl(`?auth=echec&motif=${'a'.repeat(200)}`)).toHaveLength(60);
  });
});
