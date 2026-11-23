// Carte 16 (15/10) : la pastille moteur dit son état en mots sur téléphone et l'annonce au lecteur d'écran.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';

const src = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('PastilleMoteur', () => {
  it("annonce l'état complet au lecteur d'écran", () => {
    expect(src).toMatch(/aria-label=\{titres\[etat\]\}/);
  });
  it("montre l'état en mots même hors rail PC", () => {
    expect(src).toMatch(/etendue \? titres\[etat\] : courts\[etat\]/);
  });
  it('textes courts FR et EN', () => {
    expect(t('moteurCourtRetard', 'fr')).toBe('Moteur en retard');
    expect(t('moteurCourtRetard', 'en')).toBe('Engine lagging');
  });
  it("redirige le clic vers l'onglet État", () => {
    expect(src).toMatch(/onOuvrir=\{\(\) => allerA\('etat'\)\}/);
  });
});
