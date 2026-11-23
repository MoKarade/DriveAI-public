// Carte 12 (15/10) : fréquence des passages — « Enregistrement… », retour à l'ancienne valeur si échec.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';

const src = readFileSync(new URL('../src/vues/Reglages.tsx', import.meta.url), 'utf8');

describe('Réglages — fréquence', () => {
  it('affiche Enregistrement… et grise la liste pendant l\'écriture', () => {
    expect(src).toMatch(/setStatut\('encours'\)/);
    expect(src).toMatch(/disabled=\{statut === 'encours'\}/);
    expect(t('enregistrement', 'fr')).toBe('Enregistrement…');
    expect(t('enregistrement', 'en')).toBe('Saving…');
  });
  it("revient à l'ancienne valeur si l'écriture échoue", () => {
    expect(src).toMatch(/const ancienne = tick/);
    expect(src).toMatch(/catch \(e\) \{\s*setTick\(ancienne\)/);
  });
});
