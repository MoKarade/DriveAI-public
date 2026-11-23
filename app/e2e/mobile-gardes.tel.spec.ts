/**
 * mobile-gardes.tel.spec.ts — garde-fous exclusifs au téléphone (`*.tel.spec.ts` filtré sur `tel`
 * via `testIgnore` dans `playwright.config.ts`, sans aucun test sauté).
 *
 * Couvre :
 * - Absence de débordement horizontal et de texte hors `.carte` à 390×844, 320×568 et 320×844
 *   (polices 16px et 24px), sur les 4 vues + Omnibox ouverte, en thèmes sombre et clair.
 * - Téléphone couché 844×390 sur les 4 vues : barre basse 3 colonnes visible, rail masqué,
 *   zéro débordement horizontal, en thèmes sombre et clair.
 */
import { test, expect } from '@playwright/test';
import {
  preparerApp,
  allerSection,
  choisirTheme,
  mesurerDebordement,
  attendreListingPret,
  stabiliserRendu,
  verifierAucuneErreur,
  type SectionFr,
  type ThemeE2E,
} from './outils';

const SECTIONS: SectionFr[] = ['Aujourd’hui', 'Documents', 'État', 'Réglages'];
const THEMES: ThemeE2E[] = ['sombre', 'clair'];

test('téléphone : aucune section ni omnibox ne déborde en largeur (390×844, 320×568, 320×844, polices 16px/24px, sombre et clair)', async ({ page }, testInfo) => {
  const journal = await preparerApp(page, testInfo);

  for (const theme of THEMES) {
    await choisirTheme(page, testInfo, theme);

    for (const { largeur, hauteur } of [
      { largeur: 390, hauteur: 844 },
      { largeur: 320, hauteur: 568 },
      { largeur: 320, hauteur: 844 },
    ]) {
      await page.setViewportSize({ width: largeur, height: hauteur });

      for (const policeRacine of ['16px', '24px']) {
        await page.evaluate((p) => {
          document.documentElement.style.fontSize = p;
        }, policeRacine);

        for (const section of SECTIONS) {
          await allerSection(page, testInfo, section);
          if (section === 'Documents') {
            await attendreListingPret(page);
          }
          await stabiliserRendu(page);
          const mesure = await mesurerDebordement(page);
          expect(
            mesure.page,
            `[${theme}] ${section} déborde de ${mesure.page} px en ${largeur}×${hauteur} (police ${policeRacine})`,
          ).toBeLessThanOrEqual(0);
          expect(
            mesure.horsCarte,
            `[${theme}] ${section} sort de sa carte de ${Math.round(mesure.horsCarte)} px en ${largeur}×${hauteur} (police ${policeRacine})`,
          ).toBeLessThanOrEqual(1);
        }
      }

      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
    }

    // Contrôle Omnibox ouverte à 320×568 dans chaque thème
    await page.setViewportSize({ width: 320, height: 568 });
    await allerSection(page, testInfo, 'Aujourd’hui');
    const btnOmnibox = page.locator('.barre-haute').getByRole('button', { name: 'Recherche rapide (Ctrl+K)', exact: true });
    await expect(btnOmnibox).toBeVisible();
    await btnOmnibox.click();
    const dialog = page.getByRole('dialog', { name: 'Recherche rapide' });
    await expect(dialog).toBeVisible();
    const champOmnibox = dialog.locator('form.gf-omnibox-pill input[type="search"]');
    await expect(champOmnibox).toBeFocused();
    await champOmnibox.fill('Relevé');
    await champOmnibox.press('Enter');
    await expect(dialog.getByText('2026-06-28_Relevé_Bellerives.pdf')).toBeVisible();
    const mesureOmnibox = await mesurerDebordement(page);
    expect(mesureOmnibox.page, `[${theme}] Omnibox déborde à 320×568`).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }

  verifierAucuneErreur(journal);
});

test('téléphone couché 844×390 : barre d’onglets 3 colonnes visible, rail masqué, zéro débordement (sombre et clair)', async ({ page }, testInfo) => {
  const journal = await preparerApp(page, testInfo);

  for (const theme of THEMES) {
    await choisirTheme(page, testInfo, theme);
    await page.setViewportSize({ width: 844, height: 390 });

    const nav = page.getByRole('navigation', { name: 'Sections (mobile)', exact: true });
    await expect(nav).toBeVisible();

    const structureCoquille = await page.evaluate(() => {
      const barre = document.querySelector('nav.barre-basse');
      const rail = document.querySelector('.rail');
      const cols = barre ? getComputedStyle(barre).gridTemplateColumns.trim().split(/\s+/).filter(Boolean) : [];
      return {
        nbBoutons: barre ? barre.querySelectorAll('button').length : 0,
        nbPistes: cols.length,
        railAffiche: rail ? getComputedStyle(rail).display !== 'none' : false,
      };
    });

    expect(structureCoquille.nbBoutons, `[${theme}] 3 boutons attendus dans nav.barre-basse`).toBe(3);
    expect(structureCoquille.nbPistes, `[${theme}] 3 colonnes CSS attendues dans nav.barre-basse`).toBe(3);
    expect(structureCoquille.railAffiche, `[${theme}] le rail latéral PC est encore affiché en 844×390`).toBe(false);

    for (const section of SECTIONS) {
      await allerSection(page, testInfo, section);
      if (section === 'Documents') {
        await attendreListingPret(page);
      }
      await stabiliserRendu(page);
      const mesure = await mesurerDebordement(page);
      expect(mesure.page, `[${theme}] ${section} déborde de ${mesure.page} px en 844×390`).toBeLessThanOrEqual(0);
    }
  }

  verifierAucuneErreur(journal);
});

test('GAP-P2-2 téléphone 320×568@24px : .erreur-item .date ISO 24 car. ne déborde ni de la page ni de sa carte', async ({ page }, testInfo) => {
  const iso24 = new Date().toISOString();
  await page.route('**/src/mockData.ts*', async (route) => {
    const rep = await route.fetch();
    const corps = await rep.text();
    const cible = corps.includes('"2026-07-06T13:55:20"')
      ? '"2026-07-06T13:55:20"'
      : "'2026-07-06T13:55:20'";
    const modifie = corps.replace(
      cible,
      `"${iso24}", "ERREUR", "TriGmail", "Erreur critique simulée sur mobile"], [${cible}`,
    );
    expect(modifie, 'Injection ERREUR dans mockData.ts E2E échouée').not.toBe(corps);
    await route.fulfill({ response: rep, body: modifie });
  });

  const journal = await preparerApp(page, testInfo);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px';
  });

  await allerSection(page, testInfo, 'État');
  await stabiliserRendu(page);

  const dateErreur = page.locator('.erreur-item .date').first();
  await expect(dateErreur).toBeVisible();
  await expect(dateErreur).toContainText(iso24);

  const mesure = await mesurerDebordement(page);
  expect(mesure.page, `.erreur-item .date déborde en largeur (${mesure.page} px)`).toBeLessThanOrEqual(0);
  expect(mesure.horsCarte, `.erreur-item .date sort de sa carte (${mesure.horsCarte} px)`).toBeLessThanOrEqual(1);

  verifierAucuneErreur(journal);
});
