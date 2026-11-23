/**
 * reorg-cartes.test.ts — cartes 6 à 8 (15/10) sur la vue Réorganisation : verrous de source
 * (les tests tournent en `node`, sans rendu).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/vues/Reorg.tsx', import.meta.url)), 'utf8');

describe('Réorg : écriture d\'une proposition (carte 6)', () => {
  it('poserStatut prend la main (enCours) le temps de l\'écriture, et la rend en finally', () => {
    const m = src.match(/async function poserStatut\([\s\S]*?\n  }\n/);
    expect(m).not.toBeNull();
    const corps = m![0];
    expect(corps).toMatch(/if \(enCours\) return/);
    expect(corps).toMatch(/setEnCours\(true\)/);
    expect(corps).toMatch(/finally \{\s*setEnCours\(false\)/);
  });
  it('les boutons Valider / Écarter sont grisés pendant l\'écriture', () => {
    expect(src).toMatch(/disabled=\{enCours\} onClick=\{\(\) => poserStatut\(a, 'validé'\)\}/);
    expect(src).toMatch(/disabled=\{enCours\} onClick=\{\(\) => poserStatut\(a, 'écarté'\)\}/);
  });
});
