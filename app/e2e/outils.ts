/**
 * outils.ts — aides E2E partagées pour la suite Playwright DriveAI (MODE_MOCK).
 *
 * Tout symbole exporté ici est consommé par les fichiers `.spec.ts` (`npx knip` = 0).
 * Aucun import depuis `../src/`, aucune donnée personnelle ni secret.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export type SectionFr = 'Aujourd’hui' | 'Documents' | 'État' | 'Réglages';
export type ThemeE2E = 'sombre' | 'clair';

interface JournalErreurs {
  erreursConsole: string[];
  erreursPage: string[];
  requetesInterdites: string[];
  requetesEchouees: string[];
  reponsesHttpErreur: string[];
}

/** Vérifie si un évènement console/réseau correspond au blocage CSP connu de `@vercel/analytics` en `vite dev`. */
function estBlocageAnalyticsDev(texteOuUrl: string): boolean {
  return texteOuUrl.includes('va.vercel-scripts.com');
}

/** Attache les capteurs console, pageerror et réseau sur la page active. */
function attacherCapteurs(
  page: Page,
  options: { autoriserAnalyticsDev: boolean } = { autoriserAnalyticsDev: true },
): JournalErreurs {
  const journal: JournalErreurs = {
    erreursConsole: [],
    erreursPage: [],
    requetesInterdites: [],
    requetesEchouees: [],
    reponsesHttpErreur: [],
  };

  page.on('pageerror', (err) => {
    journal.erreursPage.push(String(err));
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const texte = msg.text();
    if (options.autoriserAnalyticsDev && estBlocageAnalyticsDev(texte)) return;
    journal.erreursConsole.push(texte);
  });

  page.on('request', (req) => {
    const url = req.url();
    if (/googleapis\.com/i.test(url) || /\/api\//i.test(url)) {
      journal.requetesInterdites.push(`${req.method()} ${url}`);
    }
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    if (options.autoriserAnalyticsDev && estBlocageAnalyticsDev(url)) return;
    journal.requetesEchouees.push(`${req.method()} ${url} (${req.failure()?.errorText ?? 'échec'})`);
  });

  page.on('response', (res) => {
    const url = res.url();
    if (res.status() >= 400) {
      if (options.autoriserAnalyticsDev && estBlocageAnalyticsDev(url)) return;
      journal.reponsesHttpErreur.push(`${res.status()} ${url}`);
    }
  });

  return journal;
}

/** Initialise le viewport cible (`1440×900` sur `pc`, `390×844` sur `tel`) et ouvre l'app. */
export async function preparerApp(
  page: Page,
  testInfo: TestInfo,
  options?: { autoriserAnalyticsDev?: boolean; theme?: ThemeE2E },
): Promise<JournalErreurs> {
  if (options?.theme === 'clair') {
    await page.addInitScript(() => {
      localStorage.setItem('driveai.theme', 'clair');
    });
  }
  if (testInfo.project.name === 'pc') {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const journal = attacherCapteurs(page, { autoriserAnalyticsDev: options?.autoriserAnalyticsDev ?? true });
  await page.goto('/');
  const tel = testInfo.project.name === 'tel';
  const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
  await expect(nav).toBeVisible();
  await expect(page.getByText('Chargement…')).toHaveCount(0);
  return journal;
}

/** Vérifie qu'aucune erreur console, JS ou fuite réseau Google/API n'a eu lieu. */
export function verifierAucuneErreur(journal: JournalErreurs): void {
  expect(journal.erreursPage, `Erreurs JS non gérées : ${journal.erreursPage.join(' | ')}`).toEqual([]);
  expect(journal.erreursConsole, `Erreurs console : ${journal.erreursConsole.join(' | ')}`).toEqual([]);
  expect(journal.requetesInterdites, `Requêtes Google/API interdites : ${journal.requetesInterdites.join(' | ')}`).toEqual([]);
  expect(journal.requetesEchouees, `Requêtes réseau échouées : ${journal.requetesEchouees.join(' | ')}`).toEqual([]);
  expect(journal.reponsesHttpErreur, `Réponses HTTP >= 400 : ${journal.reponsesHttpErreur.join(' | ')}`).toEqual([]);
}

/** Navigue vers une des 4 sections en respectant la coquille PC (`rail`) ou mobile (`barre-basse` / `barre-haute`). */
export async function allerSection(page: Page, testInfo: TestInfo, section: SectionFr): Promise<void> {
  const tel = testInfo.project.name === 'tel';
  if (tel && section === 'Réglages') {
    const bouton = page.locator('.barre-haute').getByRole('button', { name: 'Réglages', exact: true });
    await expect(bouton).toBeVisible();
    await bouton.click();
  } else {
    const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
    const bouton = nav.getByRole('button', { name: section, exact: true });
    await expect(bouton).toBeVisible();
    await bouton.click();
  }
  await expect(page.getByText('Chargement…')).toHaveCount(0);
  await expect(page.locator('main.contenu .vue-active')).toBeVisible();
  if (section === 'Documents') {
    await attendreListingPret(page);
  }
}

/** Attend la stabilisation du rendu (polices prêtes et fin des animations/transitions CSS finies). */
export async function stabiliserRendu(page: Page): Promise<void> {
  await expect(page.locator('main.contenu .vue-active')).toBeVisible();
  await page.evaluate(async () => {
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      await document.fonts.ready;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (typeof document.getAnimations === 'function') {
      const finies = document.getAnimations().filter((a) => {
        const iter = a.effect?.getComputedTiming().iterations;
        return typeof iter === 'number' && Number.isFinite(iter);
      });
      await Promise.all(finies.map((a) => a.finished.catch(() => {})));
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  });
}

/** Cible un bouton dossier exclusivement dans la section Drive de l'Omnibox (hors sauts d'écrans). */
export function boutonDossierOmnibox(dialog: Locator, nomDossier: string): Locator {
  return dialog
    .locator('.omnibox-liste > div')
    .filter({ has: dialog.page().locator('.omnibox-section-titre', { hasText: /Dans Drive|In Drive/ }) })
    .locator('button.ligne.texte')
    .filter({ hasText: nomDossier });
}

/** Installe un mock déterministe de `navigator.clipboard.writeText` sans avaler un échec de configuration. */
export async function installerMockPressePapier(page: Page, mode: 'succes' | 'rejet'): Promise<void> {
  await page.addInitScript((m) => {
    (window as unknown as { __copieE2E?: string }).__copieE2E = '';
    const fauxPressePapier = {
      writeText: (txt: string) => {
        if (m === 'rejet') {
          return Promise.reject(new Error('Permission presse-papiers refusée (simulation)'));
        }
        (window as unknown as { __copieE2E?: string }).__copieE2E = txt;
        return Promise.resolve();
      },
    };
    const desc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    if (!desc || desc.configurable) {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: fauxPressePapier });
      return;
    }
    const proto = Object.getPrototypeOf(navigator);
    const protoDesc = proto ? Object.getOwnPropertyDescriptor(proto, 'clipboard') : undefined;
    if (!protoDesc || protoDesc.configurable) {
      Object.defineProperty(proto, 'clipboard', { configurable: true, get: () => fauxPressePapier });
      return;
    }
    throw new Error('Impossible d’installer le mock navigator.clipboard');
  }, mode);
}

/** Sélectionne un thème dans Réglages (`sombre` ou `clair`) et valide son application sur le DOM. */
export async function choisirTheme(page: Page, testInfo: TestInfo, theme: ThemeE2E): Promise<void> {
  await allerSection(page, testInfo, 'Réglages');
  const groupeTheme = page.getByRole('group', { name: 'Thème' });
  await expect(groupeTheme).toBeVisible();
  const libelle = theme === 'clair' ? 'Clair' : 'Sombre';
  const bouton = groupeTheme.getByRole('button', { name: libelle, exact: true });
  await expect(bouton).toBeVisible();
  await bouton.click();
  await expect(bouton).toHaveAttribute('aria-pressed', 'true');
  const etatDom = await page.evaluate(() => ({
    datasetTheme: document.documentElement.dataset.theme,
    colorScheme: document.documentElement.style.colorScheme,
  }));
  if (theme === 'clair') {
    expect(etatDom.datasetTheme).toBe('clair');
    expect(etatDom.colorScheme).toBe('light');
  } else {
    expect(etatDom.datasetTheme).toBeUndefined();
    expect(etatDom.colorScheme).toBe('dark');
  }
}

/** Audite les dimensions tactiles (`>= 44×44 px`, tolérance sous-pixel 43,5 px) de tous les contrôles visibles. */
export async function auditerCiblesTactiles(page: Page, contexte: string): Promise<void> {
  const tropPetits = await page.evaluate(() => {
    const selecteur = 'button, a[href], input, select, summary, [role="button"]';
    const violations: Array<{ balise: string; texte: string; largeur: number; hauteur: number }> = [];
    for (const el of document.querySelectorAll(selecteur)) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const detailsParent = el.closest('details');
      if (detailsParent && !detailsParent.open && el.tagName.toLowerCase() !== 'summary') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < 43.5 || rect.height < 43.5) {
        const libelle = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.className || '').trim().slice(0, 60);
        violations.push({
          balise: el.tagName.toLowerCase(),
          texte: libelle,
          largeur: Math.round(rect.width * 10) / 10,
          hauteur: Math.round(rect.height * 10) / 10,
        });
      }
    }
    return violations;
  });

  expect(
    tropPetits,
    `${contexte} — cibles interactives < 44×44 px : ${JSON.stringify(tropPetits)}`,
  ).toEqual([]);
}

/** Mesure le débordement horizontal de la page et le dépassement texte hors `.carte`. */
export async function mesurerDebordement(page: Page): Promise<{ page: number; horsCarte: number }> {
  return page.evaluate(() => {
    const de = document.documentElement;
    let horsCarte = 0;
    const estRogne = (el: Element, carte: Element): boolean => {
      for (let p = el.parentElement; p && p !== carte; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('.carte *')) {
      const carte = el.closest('.carte');
      if (!carte || el.children.length > 0 || estRogne(el, carte)) continue;
      const depassement = el.getBoundingClientRect().right - carte.getBoundingClientRect().right;
      if (depassement > horsCarte) horsCarte = depassement;
    }
    return { page: de.scrollWidth - de.clientWidth, horsCarte };
  });
}

/** Attend la fin du chargement d'un dossier dans l'explorateur. */
export async function attendreListingPret(page: Page): Promise<void> {
  await expect(page.locator('.documents .carte.lignes .ligne.vide', { hasText: 'Chargement…' })).toHaveCount(0);
}

/** Soumet une recherche dans l'explorateur (scopée à `.documents`) et attend la fin de l'exécution. */
export async function executerRechercheExplorateur(page: Page, terme: string): Promise<void> {
  const champ = page.locator('.documents').getByRole('textbox', { name: /Rechercher/i });
  await expect(champ).toBeVisible();
  await champ.fill(terme);
  await champ.press('Enter');
  await attendreListingPret(page);
}

/** Ouvre un dossier par clic dans la liste de l'explorateur. */
export async function ouvrirDossierParNom(page: Page, nom: string): Promise<void> {
  const ligne = page.locator('.documents .ligne.clic[role="button"]', { hasText: nom }).first();
  await expect(ligne).toBeVisible();
  await ligne.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await ligne.click();
  await attendreListingPret(page);
}
