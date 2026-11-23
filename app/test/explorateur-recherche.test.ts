/**
 * explorateur-recherche.test.ts — couverture R1/R2 de l'explorateur :
 * helpers purs de portée (racine vs sous-dossier), rendu initial SSR et verrous UX/tactiles.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Explorateur,
  porteeParDefaut,
  estRechercheScopee,
  optionsRecherchePourPortee,
  cleTroncatureRecherche,
  clePlaceholderRecherche,
} from '../src/vues/Explorateur';

const lire = (c: string) => readFileSync(fileURLToPath(new URL(c, import.meta.url)), 'utf8');

describe('Explorateur — helpers de portée (R1)', () => {
  it('porteeParDefaut choisit tout le Drive à la racine et le dossier courant dans un sous-dossier', () => {
    expect(porteeParDefaut('root')).toBe('tout');
    expect(porteeParDefaut('dossier-finances')).toBe('dossier');
  });

  it('estRechercheScopee est vrai uniquement hors racine et en portée dossier', () => {
    expect(estRechercheScopee('root', 'dossier')).toBe(false);
    expect(estRechercheScopee('root', 'tout')).toBe(false);
    expect(estRechercheScopee('dossier-finances', 'dossier')).toBe(true);
    expect(estRechercheScopee('dossier-finances', 'tout')).toBe(false);
  });

  it('optionsRecherchePourPortee transmet { dossierId } uniquement en mode scopé', () => {
    expect(optionsRecherchePourPortee('root', 'tout')).toBeUndefined();
    expect(optionsRecherchePourPortee('root', 'dossier')).toBeUndefined();
    expect(optionsRecherchePourPortee('dossier-finances', 'tout')).toBeUndefined();
    expect(optionsRecherchePourPortee('dossier-finances', 'dossier')).toEqual({ dossierId: 'dossier-finances' });
  });

  it('cleTroncatureRecherche et clePlaceholderRecherche distinguent scopé vs global', () => {
    expect(cleTroncatureRecherche(true)).toBe('resultatsIncomplets');
    expect(cleTroncatureRecherche(false)).toBe('resultatsTronques');
    expect(clePlaceholderRecherche(true)).toBe('rechercherDansDossierPlaceholder');
    expect(clePlaceholderRecherche(false)).toBe('rechercherPlaceholder');
  });
});

describe('Explorateur — rendu SSR & contrats UX/R2', () => {
  it('rend la barre de recherche en pilule, les filtres rapides, le bouton soumettre et le fil d’Ariane permanent', () => {
    const html = renderToStaticMarkup(createElement(Explorateur, { langue: 'fr' }));
    expect(html).toContain('<h1 class="gf-page-titre">Documents</h1>');
    expect(html).toContain('class="recherche gf-omnibox-pill"');
    expect(html).toContain('type="submit" class="recherche-soumettre"');
    expect(html).toContain('aria-label="Filtres rapides"');
    expect(html).toContain('class="gf-chip actif" aria-pressed="true">Tout</button>');
    expect(html).toContain('>Dossiers</button>');
    expect(html).toContain('>PDF</button>');
    expect(html).toContain('>À vérifier</button>');
    expect(html).toContain('>Confiance &lt; 50 %</button>');
    expect(html).toContain('aria-label="Chemin"');
    expect(html).toContain('Mon Drive');
  });

  it('transmet optionsRecherchePourPortee à rechercherDrive et relance la recherche au clic de portée', () => {
    const src = lire('../src/vues/Explorateur.tsx');
    expect(src).toContain('rechercherDrive(propre, optionsRecherchePourPortee(dossier.id, porteeCible))');
    expect(src).toMatch(/function changerPortee\([\s\S]*void chercher\(requeteEnCoursRef\.current \|\| requeteLancee \|\| texte, nouvelle, true\)/);
    expect(src).toContain('idRequeteRef');
    expect(src).toContain('libelleParentEnCache(');
    expect(src).toContain('resoudreCheminDossier(');
    // Un seul conteneur .ariane contenant <nav className="ariane-fil"> toujours visible
    expect(src.match(/className="ariane"/g)).toHaveLength(1);
  });

  it('garantit >= 44px sur les cibles tactiles et troncature de .portee-texte dans styles.css', () => {
    const css = lire('../src/styles.css');
    for (const sel of ['.icone-bouton', '.icone-bouton.petit', '.pilule-portee', '.recherche-soumettre', '.ariane button', '.gf-chip', '.documents .bouton-copier']) {
      const idx = css.indexOf(sel);
      expect(idx, `sélecteur ${sel} manquant`).toBeGreaterThan(-1);
      expect(css.slice(idx, idx + 320)).toMatch(/min-height:\s*44px/);
    }
    expect(css).toContain('.pilule-portee .portee-texte');
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('.bandeau-ok');
  });
});
