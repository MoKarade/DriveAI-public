/**
 * confirmation.test.ts — cartes 7 et 8 (15/10) : confirmation avant « Tout valider » et
 * « Tout corbeiller ». Messages purs + verrous de source (tests en `node`, sans rendu).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { confirmer, messageToutValider, messageToutCorbeiller } from '../src/confirmation';

const reorg = readFileSync(fileURLToPath(new URL('../src/vues/Reorg.tsx', import.meta.url)), 'utf8');

describe('messages de confirmation', () => {
  it('Tout valider : nombre exact, FR et EN, pluriel', () => {
    expect(messageToutValider(12, 'fr')).toBe('Valider les 12 propositions ?');
    expect(messageToutValider(1, 'fr')).toBe('Valider la proposition ?');
    expect(messageToutValider(12, 'en')).toBe('Approve 12 proposals?');
  });
  it('Tout corbeiller : nombre exact, FR et EN', () => {
    expect(messageToutCorbeiller(112, 'fr')).toBe('Mettre 112 dossiers vides à la corbeille ?');
    expect(messageToutCorbeiller(1, 'fr')).toBe('Mettre 1 dossier vide à la corbeille ?');
    expect(messageToutCorbeiller(3, 'en')).toBe('Move 3 empty folders to the trash?');
  });
  it('confirmer : sans boîte de dialogue, on ne confirme pas (échec fermé)', () => {
    expect(confirmer('x')).toBe(false);
  });
});

describe('Réorg : Tout valider demande confirmation (carte 7)', () => {
  it('le clic passe par confirmer() avant poserStatutEnMasse(…, \'validé\')', () => {
    expect(reorg).toMatch(/if \(confirmer\(messageToutValider\(toutes\.length, langue\)\)\) poserStatutEnMasse\(toutes, 'validé'\)/);
  });
});

describe('Réorg : Tout corbeiller demande confirmation (carte 8)', () => {
  it('le clic passe par confirmer() avant toutCorbeiller(videsCandidats)', () => {
    expect(reorg).toMatch(/if \(confirmer\(messageToutCorbeiller\(videsCandidats\.length, langue\)\)\) toutCorbeiller\(videsCandidats\)/);
  });
});
