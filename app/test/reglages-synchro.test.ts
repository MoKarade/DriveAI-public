// Carte 11 (15/10) : l'icône ⟳ tourne pendant le rafraîchissement, sans animation si mouvement réduit.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/vues/Reglages.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('Réglages — synchro', () => {
  it("marque l'état en cours et le relâche (finally)", () => {
    expect(src).toMatch(/setSynchroEnCours\(true\)/);
    expect(src).toMatch(/finally\(\(\) => setSynchroEnCours\(false\)\)/);
    expect(src).toMatch(/icone-tourne/);
  });
  it("n'anime que si le mouvement n'est pas réduit", () => {
    expect(css).toMatch(/prefers-reduced-motion: no-preference\)\s*\{\s*\.icone-tourne \{ animation: tourne-synchro/);
  });
});
