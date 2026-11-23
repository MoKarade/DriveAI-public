/**
 * bouton-fermer.test.ts — carte 2 (15/10) : un bouton qui ne fait que cacher l'erreur s'appelle
 * « Fermer », pas « Réessayer ». Verrou de source (les tests tournent en `node`, sans rendu).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lire = (c: string) => readFileSync(fileURLToPath(new URL(c, import.meta.url)), 'utf8');

describe('« Fermer » quand le bouton ne fait que cacher l\'erreur', () => {
  for (const f of ['../src/vues/AujourdHui.tsx', '../src/composants/Suspects.tsx']) {
    it(`${f} : pas de « Réessayer » qui ne fait que vider l'erreur`, () => {
      const src = lire(f);
      expect(src).not.toMatch(/onReessayer=\{\(\) => setErreur\(''\)\}/);
      expect(src).toMatch(/onFermer=\{\(\) => setErreur\(''\)\}/);
    });
  }

  it('BanniereErreur : onFermer affiche le mot « Fermer » (clé fermer)', () => {
    const src = lire('../src/composants/UI.tsx');
    expect(src).toMatch(/onFermer\?: \(\) => void/);
    expect(src).toMatch(/t\('fermer', langue\)/);
  });
});
