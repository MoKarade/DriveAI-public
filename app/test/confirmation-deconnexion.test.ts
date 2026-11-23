// Carte 13 (15/10) : « Se déconnecter ? » avant la déconnexion (Réglages).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messageDeconnexion } from '../src/confirmation';

const src = readFileSync(new URL('../src/vues/Reglages.tsx', import.meta.url), 'utf8');

describe('confirmation — déconnexion', () => {
  it('messages FR/EN', () => {
    expect(messageDeconnexion('fr')).toBe('Se déconnecter ?');
    expect(messageDeconnexion('en')).toBe('Sign out?');
  });
  it('le bouton passe par confirmer avant onDeconnexion', () => {
    expect(src).toMatch(/if \(confirmer\(messageDeconnexion\(langue\)\)\) onDeconnexion\(\)/);
    expect(src).not.toMatch(/onClick=\{onDeconnexion\}/);
  });
});
