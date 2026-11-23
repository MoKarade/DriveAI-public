/**
 * seuil-telephone.test.ts — VERROU du seuil « téléphone » de `styles.css` (coquille : barre d'onglets
 * basse). Jusqu'au 05/11/2026 il était écrit à deux endroits (`styles.css` et `Agenda.tsx`, vue
 * Liste/Grille) et les deux avaient divergé une fois — 720 px côté JS, 760 px côté CSS. L'Agenda
 * est parti (ADR-0074) ; il reste UN seuil, et ce test garde sa forme : le téléphone COUCHÉ (761 à
 * 900 px de large, 520 px de haut au plus) doit toujours recevoir la coquille téléphone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

describe('seuil téléphone : la coquille', () => {
  it('le téléphone COUCHÉ (761 à 900 px de large, 520 px de haut au plus) reçoit la coquille téléphone', () => {
    // Un iPhone couché fait 812 ou 844 px de large : au seuil de 760 px seul il recevait la coquille PC
    // (rail latéral, pas de barre d'onglets). Le second terme du media query le range avec le téléphone.
    const css = lire('../src/styles.css');
    expect(css).toMatch(/@media \(max-width: 760px\), \(max-width: 900px\) and \(max-height: 520px\) \{\s*\/\* hauteur RÉELLE de la barre basse/);
  });
});

/**
 * ⚠️ ÉCRIT APRÈS UN DÉFAUT MESURÉ, le 17/09. Une règle ajoutée pour AGRANDIR les cases du
 * panneau « à moitié » disait `min-height: var(--cible)` — un jeton de Hubperso, qui n'existe
 * pas dans ce dépôt. Une `var()` non résolue ne « retombe » pas sur la règle précédente : elle
 * rend la déclaration invalide au calcul, et la propriété prend sa valeur INITIALE. Mesuré au
 * navigateur : les cases faisaient 26 px au lieu de 44, donc la règle censée les agrandir les
 * avait RAPETISSÉES — et rien ne le signale, ni le build, ni les tests, ni l'œil sur un écran
 * large. C'est le mode de panne « une règle ignorée ne laisse aucune trace » du §9.
 */
describe('aucune variable CSS fantôme', () => {
  it('toute var(--x) employée est DÉFINIE dans la feuille', () => {
    const css = lire('../src/styles.css');
    // On lit la source DÉCOMMENTÉE : les commentaires de cette feuille CITENT des jetons pour
    // les expliquer (« `--cible` est un jeton de Hubperso »), et les compter comme des usages
    // ferait rougir la garde sur sa propre explication (piège SCAN-QUI-MATCHE-LA-PROSE, §9).
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code.length, 'décommentage trop agressif — scan vacueux').toBeGreaterThan(css.length * 0.5);

    const definies = new Set([...code.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!));
    expect(definies.size, 'aucune variable définie — le scan ne mesure rien').toBeGreaterThan(10);

    // Un usage avec REPLI (`var(--x, 12px)`) est légitime : il ne peut pas tomber en `auto`.
    const sansRepli = [...code.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]!);
    const fantomes = [...new Set(sansRepli)].filter((v) => !definies.has(v));
    expect(fantomes, `variables employées mais jamais définies : ${fantomes.join(', ')}`).toEqual([]);
  });
});
