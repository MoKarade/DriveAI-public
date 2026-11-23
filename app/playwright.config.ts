/**
 * playwright.config.ts — configuration E2E de l'UI (captures CI et suite d'exigences).
 *
 * C'est ICI (et seulement ici) que `VITE_E2E_MOCK=true` est injectée : le serveur de dev Vite
 * lancé par Playwright sert l'app en MODE MOCK (auth bouchonnée, données locales de mockData.ts,
 * aucun appel aux vraies API Google — voir google.ts). Un build Vercel/production ne passe
 * JAMAIS par ce fichier : la variable y est absente, le mode mock y est du code mort.
 *
 * DEUX tailles (v7, ADR-0051) : « pc » 1440 × 900 et « tel » 390 × 844 (iPhone courant, tactile).
 * Le filtrage des specs propres au mobile (`*.tel.spec.ts`) ou au PC (`*.pc.spec.ts`) passe par
 * `testIgnore` afin de ne jamais sauter de test conditionnellement.
 */
import { defineConfig } from '@playwright/test';

const PORT = 5173;
// Liaison explicite sur IPv4 127.0.0.1 : sous Windows/Node, `localhost` fait écouter Vite
// uniquement sur `[::1]`, ce qui provoque des `ERR_CONNECTION_REFUSED` intermittents sous
// charge parallèle de Chromium.
const HOTE = '127.0.0.1';
const URL_SERVEUR = `http://${HOTE}:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results',
  timeout: 60_000,
  retries: 0,
  // Plafonner les workers évite de saturer les sockets loopback de `vite dev` ESM sans masquer
  // les instabilités par des `retries`.
  workers: process.env.CI ? 2 : 3,
  // Les captures sont un ARTEFACT à consulter, pas une comparaison de pixels : 1 seul navigateur.
  use: {
    baseURL: URL_SERVEUR,
    // Environnements où un Chromium système est fourni SANS les navigateurs de la version
    // épinglée de Playwright (ex. sandbox de dev) : `PLAYWRIGHT_CHROMIUM_EXE=/chemin/chrome`.
    // En CI GitHub, la variable est absente — `npx playwright install` fournit le navigateur.
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXE
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXE } }
      : {}),
  },
  projects: [
    {
      name: 'pc',
      testIgnore: /.*\.tel\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'tel',
      testIgnore: /.*\.pc\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `npx --no-install vite --host ${HOTE} --port ${PORT} --strictPort`,
    url: URL_SERVEUR,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { VITE_E2E_MOCK: 'true' },
  },
});
