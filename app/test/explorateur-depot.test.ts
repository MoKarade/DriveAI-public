// Carte 9 (15/10) : « Déposer ici » grisé pendant le déplacement, erreur dans le bandeau.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/vues/Explorateur.tsx', import.meta.url), 'utf8');

describe('Explorateur — Déposer ici', () => {
  it('grise le bouton et affiche Chargement pendant le déplacement', () => {
    expect(src).toMatch(/disabled=\{depotEnCours\}/);
    expect(src).toMatch(/depotEnCours \? t\('chargement', langue\)/);
  });
  it('libère toujours le bouton (finally) et refuse un second déplacement', () => {
    expect(src).toMatch(/if \(depotEnCours\) return/);
    expect(src).toMatch(/finally \{\s*setDepotEnCours\(false\)/);
  });
  it("met l'erreur de déplacement dans le bandeau", () => {
    expect(src).toMatch(/catch \(e\) \{\s*setErreur\(String\(e\)\)/);
  });
  it('affiche un bandeau .ok temporaire après création de dossier avec nettoyage des minuteurs', () => {
    expect(src).toContain('dossierCreeOk');
    expect(src).toContain('className="ok bandeau-ok icone-ligne"');
    expect(src).toContain('clearTimeout(minuteurCreationRef.current)');
  });
});
