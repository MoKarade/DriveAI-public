// Carte 14 (15/10) : l'heure de la Mémoire s'affiche en heure du Québec, pas en UTC.
import { describe, expect, it } from 'vitest';
import { heureQuebec } from '../src/heureQuebec';

describe('heureQuebec', () => {
  it('été : UTC-4', () => expect(heureQuebec('2026-10-14T18:30:00.000Z')).toBe('2026-10-14 14:30'));
  it('hiver : UTC-5', () => expect(heureQuebec('2026-12-14T18:30:00Z')).toBe('2026-12-14 13:30'));
  it('passe minuit', () => expect(heureQuebec('2026-10-15T02:05:00Z')).toBe('2026-10-14 22:05'));
  it('sans fuseau ou illisible : rendu tel quel', () => {
    expect(heureQuebec('2026-10-14T18:30:00')).toBe('2026-10-14 18:30:00');
    expect(heureQuebec('n’importe quoi')).toBe('n’importe quoi');
  });
});
