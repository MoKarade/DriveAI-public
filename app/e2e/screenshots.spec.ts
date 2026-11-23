/**
 * screenshots.spec.ts — photographie les 4 écrans de l'app en MODE MOCK (VITE_E2E_MOCK=true,
 * injectée par playwright.config.ts), dans les DEUX thèmes (sombre par défaut et clair P2-1),
 * sur les deux projets (« pc » 1440×900 et « tel » 390×844).
 * Les images atterrissent dans `e2e-screenshots/` et sont remontées en artifact GitHub (.github/workflows/ci.yml).
 *
 * Aucun test sauté : les contrôles propres au téléphone vivent dans `mobile-gardes.tel.spec.ts`.
 */
import { test } from '@playwright/test';
import {
  preparerApp,
  allerSection,
  choisirTheme,
  auditerCiblesTactiles,
  attendreListingPret,
  stabiliserRendu,
  verifierAucuneErreur,
  type SectionFr,
} from './outils';

const SECTIONS: Array<{ fichier: string; libelle: SectionFr }> = [
  { fichier: '1-aujourdhui', libelle: 'Aujourd’hui' },
  { fichier: '2-documents', libelle: 'Documents' },
  { fichier: '3-etat', libelle: 'État' },
  { fichier: '4-reglages', libelle: 'Réglages' },
];

test('captures des 4 écrans — thème sombre par défaut (mode mock)', async ({ page }, testInfo) => {
  const tel = testInfo.project.name === 'tel';
  const journal = await preparerApp(page, testInfo);

  for (const { fichier, libelle } of SECTIONS) {
    await allerSection(page, testInfo, libelle);
    if (libelle === 'Documents') {
      await attendreListingPret(page);
    }
    await stabiliserRendu(page);
    await auditerCiblesTactiles(page, `${testInfo.project.name}/sombre/${libelle}`);
    await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}-${fichier}.png`, fullPage: !tel });
  }

  verifierAucuneErreur(journal);
});

test('captures des 4 écrans — thème clair (P2-1, mode mock)', async ({ page }, testInfo) => {
  const tel = testInfo.project.name === 'tel';
  const journal = await preparerApp(page, testInfo);
  await choisirTheme(page, testInfo, 'clair');

  for (const { fichier, libelle } of SECTIONS) {
    await allerSection(page, testInfo, libelle);
    if (libelle === 'Documents') {
      await attendreListingPret(page);
    }
    await stabiliserRendu(page);
    await auditerCiblesTactiles(page, `${testInfo.project.name}/clair/${libelle}`);
    await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}-clair-${fichier}.png`, fullPage: !tel });
  }

  verifierAucuneErreur(journal);
});
