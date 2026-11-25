/**
 * suite-exigences.spec.ts — Suite E2E boîte noire (Playwright, MODE_MOCK) dérivée des
 * exigences `ORIGINAL_REQUEST.md`, `docs/PROPOSITIONS-AMELIORATIONS-APP.md` (§1–§3),
 * `TEST_INFRA.md` et `SCOPE.md`.
 *
 * Couverture systématique en 4 niveaux (Tiers 1–4) sur `F-E2E-1..F-E2E-4` et `P0-1..P2-3` :
 *  - `@baseline` : invariants du socle (navigation, Ariane, zéro débordement, zéro appel Google/API, i18n).
 *  - `@contrat-r1` : recherche globale multi-dossiers & recherche récursive scopée, bascule de portée.
 *  - `@contrat-r2` : barre-basse 4 colonnes (`P0-2` / Lot 1B), cibles tactiles >= 44×44 px, esthétique et 0 erreur stricte.
 *  - `@contrat-r3` : vue `État` lisible hors `<details class="avance">`, coûts sans `TOTAL LLM`, cohérence `Aujourd’hui ↔ État`.
 *  - `@lot-r4` : couverture Tiers 1–4 de `P0-1`..`P2-3` (Omnibox, `État`/`Réglages`, `Réorg` sur accueil,
 *    télémétrie `P0-4`, puces `.gf-chip`, Ariane `P1-2`, pastilles `Index`/copie lien/création dossier `P1-3`,
 *    navigation découplée `P1-4`, thème clair `P2-1`, robustesse `P2-2`).
 *
 * Zéro import depuis `../src/`, aucun test sauté/isolé/différé, zéro donnée personnelle, tout en français.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  type SectionFr,
  type ThemeE2E,
  preparerApp,
  verifierAucuneErreur,
  allerSection,
  choisirTheme,
  auditerCiblesTactiles,
  mesurerDebordement,
  attendreListingPret,
  stabiliserRendu,
  executerRechercheExplorateur,
  ouvrirDossierParNom,
  boutonDossierOmnibox,
  installerMockPressePapier,
} from './outils';

/** Localise dynamiquement un contrôle de bascule de portée (« Dans « … » » / « Tout le Drive »). */
function trouverBoutonPortee(page: Page, cible: 'dossier' | 'tout') {
  const motif = cible === 'dossier'
    ? /dans ce dossier|dossier courant|ce dossier|dans\s*«/i
    : /tout drive|tout le drive|partout/i;
  return page.locator('.documents button, .documents [role="radio"], .documents [role="tab"], .documents label').filter({ hasText: motif }).first();
}

/**
 * Vérifie que `État` expose un compteur numérique de file de revue cohérent avec `À faire`
 * sur `Aujourd’hui` (`nbAFaireAccueil`, ou total consolidé `fileRevue.total >= nbAFaireAccueil`),
 * sans être court-circuité par le libellé statique `Tris à vérifier`.
 */
function verifierCoherenceFileRevue(texteEtat: string, nbAFaireAccueil: number): void {
  const lignes = texteEtat
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const idxRevue = lignes.findIndex((l) => /(à revoir|file de revue)/i.test(l));
  if (idxRevue !== -1) {
    const nums = lignes[idxRevue].match(/\d+/g)?.map(Number) ?? [];
    if (nums.length > 0) {
      expect(
        Math.max(...nums),
        `Compteur « À revoir » (${lignes[idxRevue]}) incohérent avec Aujourd’hui (${nbAFaireAccueil})`,
      ).toBeGreaterThanOrEqual(nbAFaireAccueil);
      return;
    }
    if (idxRevue > 0 && /^\d+$/.test(lignes[idxRevue - 1])) {
      expect(
        Number(lignes[idxRevue - 1]),
        `Compteur « À revoir » (${lignes[idxRevue - 1]}) incohérent avec Aujourd’hui (${nbAFaireAccueil})`,
      ).toBeGreaterThanOrEqual(nbAFaireAccueil);
      return;
    }
  }

  let somme = 0;
  let nbLignesDetail = 0;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (/tris?\s+à\s+vérifier/i.test(l)) continue;
    if (!/(suspect|à vérifier|à traiter|réorg|reorg)/i.test(l)) continue;
    nbLignesDetail++;
    const m = l.match(/\d+/);
    if (m) {
      somme += Number(m[0]);
    } else if (i > 0 && /^\d+$/.test(lignes[i - 1])) {
      somme += Number(lignes[i - 1]);
    }
  }

  expect(
    nbLignesDetail,
    `Aucun compteur numérique de file de revue trouvé dans État (attendu >= ${nbAFaireAccueil})`,
  ).toBeGreaterThan(0);
  expect(
    somme,
    `Total file de revue (${somme}) inférieur au compteur Aujourd’hui (${nbAFaireAccueil})`,
  ).toBeGreaterThanOrEqual(nbAFaireAccueil);
}

/** Explore récursivement depuis `Mon Drive` pour trouver un dossier de niveau 2 et un fichier descendant. */
async function decouvrirSousArbreDeuxNiveaux(page: Page): Promise<{
  parentNom: string;
  enfantNom: string;
  fichierCible: string | null;
} | null> {
  const dossiersRacine = await page.locator('.documents .ligne.clic[role="button"] .t b').allTextContents();
  for (const nomRacine of dossiersRacine) {
    await ouvrirDossierParNom(page, nomRacine);
    const sousDossiers = await page.locator('.documents .ligne.clic[role="button"] .t b').allTextContents();
    for (const nomSousDossier of sousDossiers) {
      await ouvrirDossierParNom(page, nomSousDossier);
      const fichiersN2 = await page.locator('.documents .ligne a.lien-ligne b').allTextContents();
      if (fichiersN2.length > 0) {
        return { parentNom: nomRacine, enfantNom: nomSousDossier, fichierCible: fichiersN2[0] };
      }
      const sousSousDossiers = await page.locator('.documents .ligne.clic[role="button"] .t b').allTextContents();
      if (sousSousDossiers.length > 0) {
        return { parentNom: nomRacine, enfantNom: nomSousDossier, fichierCible: null };
      }
      const btnParent = page.locator('nav[aria-label="Chemin"] button', { hasText: nomRacine });
      await expect(btnParent).toBeVisible();
      await btnParent.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await btnParent.click();
      await attendreListingPret(page);
    }
    const btnRacine = page.locator('nav[aria-label="Chemin"] button', { hasText: 'Mon Drive' });
    await expect(btnRacine).toBeVisible();
    await btnRacine.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await btnRacine.click();
    await attendreListingPret(page);
  }
  return null;
}

/** Ouvre la palette globale Omnibox via `Ctrl+K` et attend son champ de saisie focalisé. */
async function ouvrirOmniboxClavier(page: Page) {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Recherche rapide' });
  await expect(dialog).toBeVisible();
  const champ = dialog.locator('form.gf-omnibox-pill input[type="search"]');
  await expect(champ).toBeFocused();
  return { dialog, champ };
}

/** Vérifie la distinction de surface `.carte` vs `body`, bordure >= 1 px et icônes SVG non vides. */
async function auditerSurfacesEtIcones(page: Page, contexte: string): Promise<void> {
  const styleAudit = await page.evaluate(() => {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const carte = document.querySelector('.carte');
    const carteStyle = carte ? getComputedStyle(carte) : null;
    const estVisible = (el: Element): boolean => {
      if (el.getClientRects().length === 0) return false;
      for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        const st = getComputedStyle(cur);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
      }
      return true;
    };
    const icones = Array.from(document.querySelectorAll('svg.icone')).filter(estVisible);
    const iconesVides = icones.filter((s) => {
      const r = s.getBoundingClientRect();
      return r.width <= 0 || r.height <= 0;
    }).length;
    const imagesCassees = Array.from(document.querySelectorAll('img')).filter((img) => !img.complete || img.naturalWidth === 0).length;
    return {
      bodyBg,
      carteBg: carteStyle?.backgroundColor ?? '',
      carteBordLargeur: parseFloat(carteStyle?.borderTopWidth ?? '0'),
      nbIcones: icones.length,
      iconesVides,
      imagesCassees,
    };
  });
  expect(styleAudit.carteBg, `${contexte} : .carte sans fond`).not.toBe('');
  expect(styleAudit.carteBg, `${contexte} : .carte indiscernable du body`).not.toBe(styleAudit.bodyBg);
  expect(styleAudit.carteBordLargeur, `${contexte} : bordure .carte < 1px`).toBeGreaterThanOrEqual(1);
  expect(styleAudit.nbIcones, `${contexte} : aucune icône SVG visible`).toBeGreaterThan(0);
  expect(styleAudit.iconesVides, `${contexte} : icône SVG vide`).toBe(0);
  expect(styleAudit.imagesCassees, `${contexte} : image cassée`).toBe(0);
}

/* ============================================================================
 * BLOC 1 — F-E2E-1 & F-E2E-2 : Invariants existants (@baseline)
 * ============================================================================ */

test.describe('F-E2E-1 & F-E2E-2 — Invariants explorateur (@baseline)', () => {
  test('F-E2E-1 & F-E2E-2 @baseline — explorateur racine, Ariane, champ recherche, requête vide et dossier', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Documents');

    await test.step('[F-E2E-1][T1.1] Présence du champ de recherche à la racine Mon Drive', async () => {
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toBeVisible();
      await expect(ariane).toContainText('Mon Drive');
      const champ = page.locator('.documents').getByRole('textbox', { name: /Rechercher/i });
      await expect(champ).toBeVisible();
      await expect(champ).toBeEnabled();
      await expect(page.locator('.documents .ligne.clic[role="button"]').first()).toBeVisible();
    });

    await test.step('[F-E2E-1][T2.1] Requête vide ou espaces seuls préserve le listing sans erreur', async () => {
      const avant = await page.locator('.documents .ligne.clic[role="button"]').count();
      await executerRechercheExplorateur(page, '   ');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Chemin', exact: true })).toBeVisible();
      expect(await page.locator('.documents .ligne.clic[role="button"]').count()).toBe(avant);
    });

    await test.step('[F-E2E-2][T1.1] Descente dans 02 · Finances met à jour l’Ariane et garde la recherche visible', async () => {
      await ouvrirDossierParNom(page, '02 · Finances');
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toContainText('Mon Drive');
      await expect(ariane).toContainText('02 · Finances');
      await expect(page.locator('.documents').getByRole('textbox', { name: /Rechercher/i })).toBeVisible();
    });

    await test.step('[F-E2E-2][T1.2] Clic sur Mon Drive dans l’Ariane restaure la racine', async () => {
      await page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: 'Mon Drive' }).click();
      await attendreListingPret(page);
      await expect(page.locator('.documents .ligne.clic[role="button"]', { hasText: '00 · À trier' })).toBeVisible();
    });

    await test.step('[F-E2E-2][T2.1] Ouverture d’un dossier sans enfant ou de 03 · Logement & véhicule garde la recherche accessible', async () => {
      await ouvrirDossierParNom(page, '03 · Logement & véhicule');
      await expect(page.getByRole('navigation', { name: 'Chemin', exact: true })).toContainText('03 · Logement & véhicule');
      await expect(page.locator('.documents').getByRole('textbox', { name: /Rechercher/i })).toBeVisible();
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      expect(await page.locator('.documents .carte.lignes .ligne').count()).toBeGreaterThan(0);
    });

    verifierAucuneErreur(journal);
  });
});

/* ============================================================================
 * BLOC 2 — F-E2E-1 : Contrats recherche globale (@contrat-r1)
 * ============================================================================ */

test.describe('F-E2E-1 — Contrats recherche globale (@contrat-r1)', () => {
  test('F-E2E-1 @contrat-r1 — recherche globale multi-dossiers, ouverture dossier et effacement', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Documents');

    await test.step('[F-E2E-1][T1.2] Recherche globale d’un document depuis la racine sans appel réseau ni erreur', async () => {
      await executerRechercheExplorateur(page, 'Relevé');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .ariane')).toContainText(/résultat\(s\)/i);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
    });

    await test.step('[F-E2E-1][T1.3] Recherche globale d’un terme transversal retourne des documents de plusieurs dossiers', async () => {
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
      await executerRechercheExplorateur(page, 'pdf');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
      await expect(page.locator('.documents .ligne', { hasText: 'scan-sans-nom.pdf' })).toBeVisible();
    });

    await test.step('[F-E2E-1][T1.4] Clic sur un dossier retourné par la recherche ouvre ce dossier et met à jour l’Ariane', async () => {
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
      await executerRechercheExplorateur(page, 'Finances');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      const dossierRes = page.locator('.documents .ligne.clic[role="button"]', { hasText: '02 · Finances' }).first();
      await expect(dossierRes).toBeVisible();
      await dossierRes.click();
      await attendreListingPret(page);
      await expect(page.getByRole('navigation', { name: 'Chemin', exact: true })).toContainText('02 · Finances');
    });

    await test.step('[F-E2E-1][T1.5] Bouton ✕ Effacer réinitialise la recherche et restaure la liste des dossiers', async () => {
      await page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: 'Mon Drive' }).click();
      await attendreListingPret(page);
      await executerRechercheExplorateur(page, 'scan-sans-nom');
      await expect(page.locator('.documents .ligne', { hasText: 'scan-sans-nom.pdf' })).toBeVisible();
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
      await expect(page.getByRole('navigation', { name: 'Chemin', exact: true })).toBeVisible();
      await expect(page.locator('.documents .ligne.clic[role="button"]', { hasText: '02 · Finances' })).toBeVisible();
    });

    verifierAucuneErreur(journal);
  });

  test('F-E2E-1 @contrat-r1 — limites : casse/accents, aucun résultat, caractères spéciaux et compteur', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Documents');

    await test.step('[F-E2E-1][T2.2] Recherche insensible à la casse et aux accents (releve trouve Relevé)', async () => {
      await executerRechercheExplorateur(page, 'releve');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
    });

    await test.step('[F-E2E-1][T2.3] Requête sans correspondance affiche Aucun résultat. sans bannière d’erreur', async () => {
      await executerRechercheExplorateur(page, 'zxy-introuvable-999');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .ariane')).toContainText(/0\s+résultat\(s\)/i);
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');
    });

    await test.step('[F-E2E-1][T2.4] Caractères spéciaux, apostrophes et guillemets gérés proprement', async () => {
      await executerRechercheExplorateur(page, "facture 'exemple' \"test\" \\ & %");
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');
    });

    await test.step('[F-E2E-1][T2.5] Compteur affiché cohérent avec les lignes rendues et double validation protégée', async () => {
      const champ = page.locator('.documents').getByRole('textbox', { name: /Rechercher/i });
      await champ.fill('pdf');
      await champ.press('Enter');
      await champ.press('Enter');
      await attendreListingPret(page);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      const entete = (await page.locator('.documents .ariane').textContent()) ?? '';
      const match = entete.match(/(\d+)\s+résultat\(s\)/i);
      expect(match, `Compteur manquant dans : ${entete}`).not.toBeNull();
      const nb = Number(match![1]);
      expect(nb).toBeGreaterThanOrEqual(2);
      expect(await page.locator('.documents .carte.lignes .ligne:not(.vide)').count()).toBe(nb);
    });

    verifierAucuneErreur(journal);
  });
});

/* ============================================================================
 * BLOC 3 — F-E2E-2 : Contrats recherche récursive dans chaque dossier (@contrat-r1)
 * ============================================================================ */

test.describe('F-E2E-2 — Contrats recherche dans chaque dossier (@contrat-r1)', () => {
  test('F-E2E-2 @contrat-r1 — arborescence >= 2 niveaux, recherche scopée et bascule de portée', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Documents');

    let parentNom = '';
    let enfantNom = '';
    let fichierCible: string | null = null;

    await test.step('[F-E2E-2][T1.3] Arborescence mockée possède >= 2 niveaux de dossiers imbriqués et Ariane complet', async () => {
      const decouvert = await decouvrirSousArbreDeuxNiveaux(page);
      expect(decouvert, 'Contrat M2 non satisfait : aucun sous-dossier imbriqué de niveau 2 trouvé dans ENFANTS_MOCK').not.toBeNull();
      parentNom = decouvert!.parentNom;
      enfantNom = decouvert!.enfantNom;
      fichierCible = decouvert!.fichierCible;

      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toContainText('Mon Drive');
      await expect(ariane).toContainText(parentNom);
      await expect(ariane).toContainText(enfantNom);
    });

    await test.step('[F-E2E-2][T1.4] Recherche scopée « Dans ce dossier » exclut les fichiers d’autres branches', async () => {
      const btnDossier = trouverBoutonPortee(page, 'dossier');
      await expect(btnDossier, 'Contrôle de portée « Dans ce dossier » absent dans un sous-dossier').toBeVisible();
      await btnDossier.click();

      const termeHorsBranche = parentNom.includes('À trier') ? 'Relevé' : 'scan-sans-nom';
      await executerRechercheExplorateur(page, termeHorsBranche);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');
    });

    await test.step('[F-E2E-2][T1.5] Bascule explicite « Dans ce dossier » ↔ « Tout le Drive » élargit puis resserre les résultats', async () => {
      const btnTout = trouverBoutonPortee(page, 'tout');
      await expect(btnTout, 'Contrôle de portée « Tout le Drive » absent').toBeVisible();
      await btnTout.click();
      await attendreListingPret(page);

      const fichierAttendu = parentNom.includes('À trier') ? '2026-06-28_Relevé_Bellerives.pdf' : 'scan-sans-nom.pdf';
      await expect(page.locator('.documents .ligne', { hasText: fichierAttendu })).toBeVisible();

      const btnDossier = trouverBoutonPortee(page, 'dossier');
      await btnDossier.click();
      await attendreListingPret(page);
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');
    });

    await test.step('[F-E2E-2][T2.3] Recherche récursive depuis le niveau 1 retrouve un document d’un sous-dossier niveau 2', async () => {
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
      await page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: parentNom }).click();
      await attendreListingPret(page);

      const btnDossier = trouverBoutonPortee(page, 'dossier');
      await expect(btnDossier).toBeVisible();
      await btnDossier.click();

      const termeCible = fichierCible
        ? fichierCible.replace(/\.[a-z0-9]+$/i, '').split(/[_\s-]+/).find((m) => m.length >= 4) ?? fichierCible
        : enfantNom;
      await executerRechercheExplorateur(page, termeCible);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .ligne', { hasText: fichierCible ?? enfantNom }).first()).toBeVisible();
    });

    verifierAucuneErreur(journal);
  });

  test('F-E2E-2 @contrat-r1 — limites : hors cible local, effacement sans perte de contexte et changement Ariane', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Documents');

    await test.step('[F-E2E-2][T2.2] Recherche locale dans 00 · À trier ne voit pas Relevé puis le trouve en Tout le Drive', async () => {
      await ouvrirDossierParNom(page, '00 · À trier');
      const btnDossier = trouverBoutonPortee(page, 'dossier');
      await expect(btnDossier).toBeVisible();
      await btnDossier.click();

      await executerRechercheExplorateur(page, 'Relevé');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');

      await trouverBoutonPortee(page, 'tout').click();
      await attendreListingPret(page);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
    });

    await test.step('[F-E2E-2][T2.4] Effacement de la recherche dans un dossier conserve le dossier courant dans l’Ariane', async () => {
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
      await attendreListingPret(page);
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toBeVisible();
      await expect(ariane).toContainText('00 · À trier');
      await expect(page.locator('.documents .ligne', { hasText: 'scan-sans-nom.pdf' })).toBeVisible();
    });

    await test.step('[F-E2E-2][T2.5] Remontée via Ariane vers Mon Drive puis recherche globale fonctionne sans état périmé', async () => {
      await page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: 'Mon Drive' }).click();
      await attendreListingPret(page);
      await executerRechercheExplorateur(page, 'Relevé');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
    });

    verifierAucuneErreur(journal);
  });
});

/* ============================================================================
 * BLOC 4 — F-E2E-3 : Interface FinanceAI/Google, Viewports & Cibles >= 44 px
 * ============================================================================ */

test.describe('F-E2E-3 — Coquille, Viewports, Cibles >= 44 px & Esthétique', () => {
  test('F-E2E-3 @baseline — navigation 5 vues, coquille adaptative et zéro fuite réseau Google/API', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[F-E2E-3][T1.2] Coquille adaptative PC (rail) vs Mobile (barre haute & barre basse)', async () => {
      const etatCoquille = await page.evaluate(() => {
        const visible = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).display !== 'none' : false;
        };
        return {
          rail: visible('.rail'),
          barreHaute: visible('.barre-haute'),
          barreBasse: visible('nav.barre-basse'),
        };
      });
      if (tel) {
        expect(etatCoquille.rail).toBe(false);
        expect(etatCoquille.barreHaute).toBe(true);
        expect(etatCoquille.barreBasse).toBe(true);
      } else {
        expect(etatCoquille.rail).toBe(true);
        expect(etatCoquille.barreHaute).toBe(false);
        expect(etatCoquille.barreBasse).toBe(false);
      }
    });

    await test.step('[F-E2E-3][T1.1] Navigation complète entre Aujourd’hui, Copilote, Documents, État et Réglages', async () => {
      await allerSection(page, testInfo, 'Copilote');
      await expect(page.getByRole('heading', { level: 1, name: 'Copilote' })).toBeVisible();

      await allerSection(page, testInfo, 'Documents');
      await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

      await allerSection(page, testInfo, 'État');
      await expect(page.locator('.tuiles-3').getByText('documents classés')).toBeVisible();

      await allerSection(page, testInfo, 'Réglages');
      await expect(page.getByRole('combobox', { name: 'Fréquence des passages' })).toBeVisible();

      await allerSection(page, testInfo, 'Aujourd’hui');
      await expect(page.getByRole('heading', { name: /À faire/i })).toBeVisible();
    });

    await test.step('[F-E2E-3][T2.5] Zéro erreur JS/page et zéro requête sortante vers googleapis.com ou /api/', async () => {
      verifierAucuneErreur(journal);
    });
  });

  test('F-E2E-3 @baseline — débordement nul 1440 / 390 / 320×568 / 320×844, police 24 px et téléphone couché 844×390', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[F-E2E-3][T2.1] Zéro débordement horizontal sur les 5 vues (1440×900 PC / 390×844, 320×568 & 320×844 Mobile)', async () => {
      const fenetres = tel
        ? [{ w: 390, h: 844 }, { w: 320, h: 568 }, { w: 320, h: 844 }]
        : [{ w: 1440, h: 900 }];
      for (const { w, h } of fenetres) {
        await page.setViewportSize({ width: w, height: h });
        for (const section of ['Aujourd’hui', 'Copilote', 'Documents', 'État', 'Réglages'] as SectionFr[]) {
          await allerSection(page, testInfo, section);
          const m = await mesurerDebordement(page);
          expect(m.page, `${section} (${w}×${h}) déborde horizontalement de ${m.page}px`).toBeLessThanOrEqual(0);
        }
      }
    });

    await test.step('[F-E2E-3][T2.2] Police agrandie 24 px : zéro débordement page ni texte hors .carte', async () => {
      await page.setViewportSize({ width: tel ? 320 : 1440, height: tel ? 844 : 900 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      for (const section of ['Aujourd’hui', 'Copilote', 'Documents', 'État', 'Réglages'] as SectionFr[]) {
        await allerSection(page, testInfo, section);
        const m = await mesurerDebordement(page);
        expect(m.page, `${section} (police 24px) déborde de ${m.page}px`).toBeLessThanOrEqual(0);
        expect(m.horsCarte, `${section} (police 24px) sort de .carte de ${m.horsCarte}px`).toBeLessThanOrEqual(1);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    });

    await test.step('[F-E2E-3][T2.3] Téléphone couché 844×390 : barre basse visible, rail masqué, zéro débordement', async () => {
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.getByRole('navigation', { name: 'Sections (mobile)', exact: true })).toBeVisible();
      const mesure = await page.evaluate(() => {
        const de = document.documentElement;
        const rail = document.querySelector('.rail');
        return {
          debord: de.scrollWidth - de.clientWidth,
          railAffiche: rail ? getComputedStyle(rail).display !== 'none' : false,
        };
      });
      expect(mesure.debord).toBeLessThanOrEqual(0);
      expect(mesure.railAffiche).toBe(false);
    });

    verifierAucuneErreur(journal);
  });

  test('F-E2E-3 @contrat-r2 — barre-basse 4 colonnes (P0-2 / Lot 1B), cibles tactiles >= 44×44 px et esthétique (2 thèmes)', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[F-E2E-3][T1.3] nav.barre-basse possède exactement 4 boutons et 4 colonnes (repeat(4, minmax(0, 1fr))) en mobile', async () => {
      if (!tel) {
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const nav = page.getByRole('navigation', { name: 'Sections (mobile)', exact: true });
      await expect(nav).toBeVisible();
      const infosGrille = await nav.evaluate((el) => {
        const cols = getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
        const libelles = Array.from(el.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
        return { nbPistes: cols.length, pistes: cols, nbBoutons: libelles.length, libelles };
      });
      expect(infosGrille.nbBoutons).toBe(4);
      expect(infosGrille.libelles).toEqual(['Aujourd’hui', 'Copilote', 'Documents', 'État']);
      expect(infosGrille.nbPistes, `Grille attendue à 4 colonnes, observé : ${infosGrille.pistes.join(' ')}`).toBe(4);
      if (!tel) {
        await page.setViewportSize({ width: 1440, height: 900 });
      }
    });

    await test.step('[F-E2E-3][T1.4] Toutes les cibles interactives visibles respectent >= 44×44 px sur les 5 vues dans les 2 thèmes', async () => {
      for (const theme of ['sombre', 'clair'] as ThemeE2E[]) {
        await choisirTheme(page, testInfo, theme);
        for (const section of ['Aujourd’hui', 'Copilote', 'Documents', 'État', 'Réglages'] as SectionFr[]) {
          await allerSection(page, testInfo, section);
          await auditerCiblesTactiles(page, `${testInfo.project.name}/${theme}/${section}`);
          if (section === 'Documents') {
            await ouvrirDossierParNom(page, '02 · Finances');
            await auditerCiblesTactiles(page, `${testInfo.project.name}/${theme}/Documents/02 · Finances`);
          }
        }
      }
      await choisirTheme(page, testInfo, 'sombre');
    });

    await test.step('[F-E2E-3][T1.5] Surfaces FinanceAI/Google distinctes, bordures visibles et icônes SVG fonctionnelles (sombre & clair)', async () => {
      for (const theme of ['sombre', 'clair'] as ThemeE2E[]) {
        await choisirTheme(page, testInfo, theme);
        await allerSection(page, testInfo, 'Aujourd’hui');
        await auditerSurfacesEtIcones(page, `${testInfo.project.name}/${theme}/Aujourd’hui`);
      }
    });

    verifierAucuneErreur(journal);
  });

  test('F-E2E-3 @contrat-r2 — zéro erreur console et réseau strict (aucune exception analytics dev)', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo, { autoriserAnalyticsDev: false });

    await test.step('[F-E2E-3][T2.4] Parcours des 5 vues avec 0 console.error, 0 pageerror, 0 requestfailed et 0 HTTP >= 400', async () => {
      await allerSection(page, testInfo, 'Copilote');
      await allerSection(page, testInfo, 'Documents');
      await allerSection(page, testInfo, 'État');
      await allerSection(page, testInfo, 'Réglages');
      await allerSection(page, testInfo, 'Aujourd’hui');
      verifierAucuneErreur(journal);
    });
  });
});

/* ============================================================================
 * BLOC 5 — F-E2E-4 : Vue d'état claire sans donnée inventée & i18n
 * ============================================================================ */

test.describe('F-E2E-4 — Vue d’état claire & i18n', () => {
  test('F-E2E-4 @baseline — Aujourd’hui, tuiles KPI État, contrôles Réglages et bascule FR ↔ EN', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[F-E2E-4][T2.5] Accueil Aujourd’hui affiche À faire, Derniers classements et lien Documents ›', async () => {
      await expect(page.getByRole('heading', { name: /À faire/i })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Derniers classements/i })).toBeVisible();
      await page.getByRole('button', { name: /Documents ›/i }).click();
      await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    });

    await test.step('[F-E2E-4][T1.1] État affiche les 3 tuiles KPI dérivées de l’Index et Télémétrie', async () => {
      await allerSection(page, testInfo, 'État');
      const tuiles = page.locator('.tuiles-3 .tuile');
      await expect(tuiles).toHaveCount(3);
      const nbDocs = Number((((await tuiles.nth(0).locator('b').textContent()) ?? '').replace(/\s+/g, '')));
      const nbMails = Number((((await tuiles.nth(1).locator('b').textContent()) ?? '').replace(/\s+/g, '')));
      expect(nbDocs).toBeGreaterThanOrEqual(5);
      await expect(tuiles.nth(0)).toContainText('documents classés');
      expect(nbMails).toBeGreaterThanOrEqual(2);
      await expect(tuiles.nth(1)).toContainText('mails triés');
      await expect(tuiles.nth(2)).toContainText(/ce mois/i);
      await expect(tuiles.nth(2)).toContainText(/\$/);
    });

    await test.step('[F-E2E-4][T2.3] Réglages expose Fréquence des passages (5/10/15/30 min), Thème et Se déconnecter', async () => {
      await allerSection(page, testInfo, 'Réglages');
      const selectFreq = page.getByRole('combobox', { name: 'Fréquence des passages' });
      await expect(selectFreq).toBeVisible();
      const valeurs = await selectFreq.locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
      expect(valeurs).toEqual(['5', '10', '15', '30']);
      await expect(page.getByRole('group', { name: 'Thème' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
    });

    await test.step('[F-E2E-4][T1.5] Bascule de langue Français → English → Français sur Réglages et État/Status', async () => {
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      const btnStatus = nav.getByRole('button', { name: 'Status', exact: true });
      await expect(btnStatus).toBeVisible();
      await btnStatus.click();

      const tuilesKpi = page.locator('.tuiles-3');
      await expect(tuilesKpi.getByText('documents filed')).toBeVisible();
      await expect(tuilesKpi.getByText('emails sorted')).toBeVisible();

      if (tel) {
        await page.locator('.barre-haute').getByRole('button', { name: 'Settings', exact: true }).click();
      } else {
        await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Français', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
      await allerSection(page, testInfo, 'État');
      await expect(tuilesKpi.getByText('documents classés')).toBeVisible();
      await expect(tuilesKpi.getByText('mails triés')).toBeVisible();
    });

    verifierAucuneErreur(journal);
  });

  test('F-E2E-4 @contrat-r3 — état moteur lisible sans Avancé, Compte LLM, Tri Gmail, revue et erreurs 7j', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'État');

    await test.step('[F-E2E-4][T1.2] Dernier passage daté, Compte LLM, Tri Gmail visibles et Avancé absent', async () => {
      await expect(page.locator('details.avance')).toHaveCount(0);

      const textePage = (await page.locator('main.contenu').innerText()) ?? '';
      expect(textePage).not.toMatch(/État du moteur inconnu/i);
      expect(textePage, 'Dernier passage daté absent').toMatch(/(il y a \d+|Dernière passe|2026-\d{2}-\d{2})/i);
      expect(textePage, 'Statut Compte LLM / Analyse IA absent').toMatch(/(Compte LLM|Analyse IA)/i);
      expect(textePage, 'Statut Tri Gmail absent').toMatch(/Tri Gmail/i);
    });

    await test.step('[F-E2E-4][T1.3] File de revue consolidée et erreurs 7 jours visibles sans débordement', async () => {
      const textePage = (await page.locator('main.contenu').innerText()) ?? '';
      expect(textePage, 'File de revue absente').toMatch(/(à revoir|file de revue|à vérifier|suspect|important)/i);
      expect(textePage, 'Indicateur erreurs 7 jours absent').toMatch(/erreur.*7\s*j|7\s*jours/i);
      const debord = await mesurerDebordement(page);
      expect(debord.page).toBeLessThanOrEqual(0);
    });

    verifierAucuneErreur(journal);
  });

  test('F-E2E-4 @contrat-r3 — tuile budget, suivi archivage honnête et cohérence Aujourd’hui ↔ État', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    let nbAFaireAccueil = 0;
    await test.step('[F-E2E-4][T2.2] Lecture des compteurs sur Aujourd’hui et vérification de cohérence avec État', async () => {
      const badge = page.locator('.titre-liste .badge').first();
      await expect(badge).toBeVisible();
      nbAFaireAccueil = Number(((await badge.textContent()) ?? '').trim());
      expect(nbAFaireAccueil).toBeGreaterThan(0);

      await allerSection(page, testInfo, 'État');
      const textePage = await page.locator('main.contenu').innerText();
      verifierCoherenceFileRevue(textePage, nbAFaireAccueil);
    });

    await test.step('[F-E2E-4][T1.4] Budget mensuel dans KPI + Total relevé, panneau Avancé absent', async () => {
      await expect(page.locator('details.avance')).toHaveCount(0);
      await expect(page.locator('.tuiles-3')).toContainText('16,42 $');
      await expect(page.getByText('Total relevé')).toBeVisible();
    });

    await test.step('[F-E2E-4][T2.1] Suivi d’archivage explicite et honnête : tri_archives_jour mesuré (18), aucun total inventé', async () => {
      const texteMain = await page.locator('main.contenu').innerText();
      expect(texteMain, 'Mention explicite du suivi d’archivage absente de État').toMatch(/archiv/i);
      expect(texteMain, 'Un total fictif d’archivés ne doit jamais être inventé').not.toMatch(/\b(214|1\s*842)\s+archiv/i);
      await expect(page.locator('.statut-cellule', { hasText: 'Fils archivés aujourd’hui' })).toContainText('18');
    });

    verifierAucuneErreur(journal);
  });
});

/* ============================================================================
 * BLOC 6 — Lot R4 Tiers 1 & 2 : P0-1..P2-2 (couverture par exigence)
 * ============================================================================ */

test.describe('P0-1 — Recherche globale rapide Omnibox (Ctrl+K) (@lot-r4)', () => {
  test('P0-1 Tier 1 @lot-r4 — déclencheurs, raccourci Ctrl+K, recherche Drive, saut dossier/écran et fermeture', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[P0-1][T1.1] Bouton recherche rapide visible sur toutes les vues et >= 44×44 px', async () => {
      for (const section of ['Aujourd’hui', 'Copilote', 'Documents', 'État', 'Réglages'] as SectionFr[]) {
        await allerSection(page, testInfo, section);
        const declencheur = tel
          ? page.locator('.barre-haute').getByRole('button', { name: 'Recherche rapide (Ctrl+K)', exact: true })
          : page.locator('.rail').getByRole('button', { name: 'Recherche rapide (Ctrl+K)', exact: true });
        await expect(declencheur).toBeVisible();
        const box = await declencheur.boundingBox();
        expect(box, `Bouton recherche sans boîte sur ${section}`).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(43.5);
        expect(box!.height).toBeGreaterThanOrEqual(43.5);
      }
    });

    await test.step('[P0-1][T1.2] Ctrl+K ouvre la fenêtre avec pilule .gf-omnibox-pill focalisée depuis chaque écran', async () => {
      for (const section of ['Aujourd’hui', 'Copilote', 'État', 'Réglages', 'Documents'] as SectionFr[]) {
        await allerSection(page, testInfo, section);
        const { dialog } = await ouvrirOmniboxClavier(page);
        await expect(dialog.locator('form.gf-omnibox-pill')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
      }
    });

    await test.step('[P0-1][T1.3] Saisie Relevé affiche résultats Drive sans requête réseau externe', async () => {
      await allerSection(page, testInfo, 'Aujourd’hui');
      const { dialog, champ } = await ouvrirOmniboxClavier(page);
      await champ.fill('Relevé');
      await champ.press('Enter');
      await expect(dialog.getByText('Dans Drive')).toBeVisible();
      await expect(dialog.getByText('2026-06-28_Relevé_Bellerives.pdf')).toBeVisible();
      await expect(dialog.getByText('2026-05-31_Relevé_Bellerives.pdf')).toBeVisible();
      await expect(boutonDossierOmnibox(dialog, 'Relevés')).toBeVisible();
    });

    await test.step('[P0-1][T1.4] Clic sur le dossier Relevés ouvre Documents avec Ariane complet ; saut vers État fonctionne', async () => {
      const dialog = page.getByRole('dialog', { name: 'Recherche rapide' });
      await boutonDossierOmnibox(dialog, 'Relevés').click();
      await expect(dialog).toHaveCount(0);
      await attendreListingPret(page);
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toBeVisible();
      await expect(ariane).toContainText('Mon Drive');
      await expect(ariane).toContainText('02 · Finances');
      await expect(ariane).toContainText('Bellerives');
      await expect(ariane).toContainText('Relevés');

      const { dialog: d2 } = await ouvrirOmniboxClavier(page);
      await d2.getByRole('button', { name: 'État', exact: true }).click();
      await expect(d2).toHaveCount(0);
      await expect(page.locator('.tuiles-3').getByText('documents classés')).toBeVisible();
    });

    await test.step('[P0-1][T1.5] Fermeture propre par Escape, bouton Fermer et clic sur .feuille-fond', async () => {
      const { dialog: dA } = await ouvrirOmniboxClavier(page);
      await dA.getByRole('button', { name: 'Fermer', exact: true }).click();
      await expect(dA).toHaveCount(0);

      const { dialog: dB } = await ouvrirOmniboxClavier(page);
      await page.locator('.feuille-fond').click({ position: { x: 8, y: 8 } });
      await expect(dB).toHaveCount(0);
    });

    verifierAucuneErreur(journal);
  });

  test('P0-1 Tier 2 @lot-r4 — limites : requête blanche, introuvable, accents, focus input, 320×568/1440×900 & ADR-0007', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[P0-1][T2.1] Requête blanche ou < 2 caractères n’affiche pas de faux résultats Drive', async () => {
      const { dialog, champ } = await ouvrirOmniboxClavier(page);
      await champ.fill('   ');
      await expect(dialog.getByText(/Tape au moins 2 caractères/i)).toBeVisible();
      await expect(dialog.locator('.omnibox-section-titre', { hasText: 'Dans Drive' })).toHaveCount(0);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
    });

    await test.step('[P0-1][T2.2] Requête sans correspondance affiche Aucun résultat. sans alerte', async () => {
      const dialog = page.getByRole('dialog', { name: 'Recherche rapide' });
      const champ = dialog.locator('form.gf-omnibox-pill input[type="search"]');
      await champ.fill('zxy-introuvable-999');
      await champ.press('Enter');
      await expect(dialog.getByText('Aucun résultat.')).toBeVisible();
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
    });

    await test.step('[P0-1][T2.3] Normalisation accents et casse : releve et HYDRO-QUÉBEC', async () => {
      const dialog = page.getByRole('dialog', { name: 'Recherche rapide' });
      const champ = dialog.locator('form.gf-omnibox-pill input[type="search"]');
      await champ.fill('releve');
      await champ.press('Enter');
      await expect(dialog.getByText('2026-06-28_Relevé_Bellerives.pdf')).toBeVisible();

      await champ.fill('HYDRO-QUÉBEC');
      await champ.press('Enter');
      await expect(dialog.getByText('2026-07-01_Facture_Hydro-Québec.pdf')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    await test.step('[P0-1][T2.4] Ctrl+K depuis un input actif et double Ctrl+K pour bascule sans conflit', async () => {
      await allerSection(page, testInfo, 'Documents');
      const champDoc = page.locator('.documents').getByRole('textbox', { name: /Rechercher/i });
      await champDoc.click();
      await expect(champDoc).toBeFocused();
      const { dialog } = await ouvrirOmniboxClavier(page);
      await page.keyboard.press('Control+k');
      await expect(dialog).toHaveCount(0);
    });

    await test.step('[P0-1][T2.5] Omnibox à 320×568 / 1440×900 (sombre & clair) : 0 débordement, >= 44 px, ADR-0007 sans fuite storage', async () => {
      if (tel) {
        await page.setViewportSize({ width: 320, height: 568 });
      }
      for (const theme of ['sombre', 'clair'] as ThemeE2E[]) {
        await choisirTheme(page, testInfo, theme);
        const { dialog, champ } = await ouvrirOmniboxClavier(page);
        await champ.fill('Relevé');
        await champ.press('Enter');
        await expect(dialog.getByText('2026-06-28_Relevé_Bellerives.pdf')).toBeVisible();
        expect((await mesurerDebordement(page)).page, `Omnibox déborde (${theme})`).toBeLessThanOrEqual(0);
        await auditerCiblesTactiles(page, `${testInfo.project.name}/Omnibox/${theme}`);
        await page.keyboard.press('Escape');
      }
      const clesStorage = await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
        contenu: JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
      }));
      expect(clesStorage.contenu).not.toMatch(/Relevé_Bellerives|Hydro-Québec/i);
    });

    verifierAucuneErreur(journal);
  });
});

test.describe('P0-2 — Onglet État séparé & Réglages recentré (@lot-r4)', () => {
  test('P0-2 Tier 1 & 2 @lot-r4 — séparation État/Réglages, pastille-moteur, i18n, viewports, répétition et cohérence', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[P0-2][T1.1][T1.2][T1.3] 4 onglets principaux, contenu État complet et Réglages épuré', async () => {
      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      await expect(nav.getByRole('button', { name: 'Aujourd’hui', exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'Copilote', exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'Documents', exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'État', exact: true })).toBeVisible();

      await allerSection(page, testInfo, 'État');
      await expect(page.getByRole('heading', { name: 'État du moteur' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /À revoir/i })).toBeVisible();
      await expect(page.locator('.tuiles-3')).toContainText('16,42 $');
      await expect(page.locator('details.avance')).toHaveCount(0);

      await allerSection(page, testInfo, 'Réglages');
      await expect(page.getByText('Moteur et synchronisation')).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Fréquence des passages' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Thème' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Langue' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
      await expect(page.locator('.tuiles-3')).toHaveCount(0);
      await expect(page.getByText(/Coûts par poste/i)).toHaveCount(0);

      // Refonte Synchro + Passage immédiat : retour visuel immédiat dans Réglages et État sans erreur
      await page.getByTitle('Rafraîchir').click();
      await expect(page.locator('[role="status"]', { hasText: /Actualisé à/ })).toBeVisible();
      await page.getByRole('button', { name: 'Lancer un passage', exact: true }).click();
      await expect(page.locator('[role="status"]', { hasText: /Passage programmé/ })).toBeVisible();

      await allerSection(page, testInfo, 'État');
      await expect(page.locator('.moteur-bandeau')).toBeVisible();
      await expect(page.locator('.moteur-bandeau')).not.toContainText('clic pour le détail');
      await page.getByTitle('Rafraîchir').click();
      await expect(page.locator('[role="status"]', { hasText: /Actualisé à/ })).toBeVisible();
      await page.getByRole('button', { name: 'Lancer un passage', exact: true }).click();
      await expect(page.locator('[role="status"]', { hasText: /Passage programmé/ })).toBeVisible();
    });

    await test.step('[P0-2][T1.4] button.pastille-moteur navigue vers État depuis Aujourd’hui et Documents', async () => {
      await allerSection(page, testInfo, 'Aujourd’hui');
      await page.locator('button.pastille-moteur:visible').first().click();
      await expect(page.getByRole('heading', { name: 'État', exact: true })).toBeVisible();

      await allerSection(page, testInfo, 'Documents');
      await page.locator('button.pastille-moteur:visible').first().click();
      await expect(page.getByRole('heading', { name: 'État', exact: true })).toBeVisible();
    });

    await test.step('[P0-2][T1.5] Bascule Français ↔ English met à jour État ↔ Status et Réglages ↔ Settings', async () => {
      await allerSection(page, testInfo, 'Réglages');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();

      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      const btnStatus = nav.getByRole('button', { name: 'Status', exact: true });
      await expect(btnStatus).toBeVisible();
      await btnStatus.click();
      await expect(page.getByRole('heading', { level: 1, name: 'Status', exact: true })).toBeVisible();

      const btnSettings = tel
        ? page.locator('.barre-haute').getByRole('button', { name: 'Settings', exact: true })
        : nav.getByRole('button', { name: 'Settings', exact: true });
      await btnSettings.click();
      await page.getByRole('button', { name: 'Français', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Réglages', exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'État', exact: true })).toBeVisible();
    });

    await test.step('[P0-2][T2.1] [P0-2][T2.2] Onglets à 320×568, 320×844 (24 px) et 844×390 sans débordement et >= 44×44 px', async () => {
      try {
        if (tel) {
          for (const vp of [{ width: 320, height: 568 }, { width: 320, height: 844 }]) {
            await page.setViewportSize(vp);
            await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
            await stabiliserRendu(page);
            const m = await mesurerDebordement(page);
            expect(m.page, `Onglets P0-2 débordent en ${vp.width}×${vp.height} @ 24px`).toBeLessThanOrEqual(0);
            expect(m.horsCarte).toBeLessThanOrEqual(1);
            await auditerCiblesTactiles(page, `P0-2/${vp.width}x${vp.height}@24px`);
          }
          await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        }

        await page.setViewportSize({ width: 844, height: 390 });
        await stabiliserRendu(page);
        const coquillePaysage = await page.evaluate(() => {
          const barre = document.querySelector('nav.barre-basse');
          const rail = document.querySelector('.rail');
          const cols = barre ? getComputedStyle(barre).gridTemplateColumns.trim().split(/\s+/).filter(Boolean) : [];
          return {
            nbBoutons: barre ? barre.querySelectorAll('button').length : 0,
            nbPistes: cols.length,
            railAffiche: rail ? getComputedStyle(rail).display !== 'none' : false,
          };
        });
        expect(coquillePaysage.nbBoutons).toBe(4);
        expect(coquillePaysage.nbPistes).toBe(4);
        expect(coquillePaysage.railAffiche).toBe(false);
        expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      } finally {
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.setViewportSize(tel ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      }
    });

    await test.step('[P0-2][T2.3] [P0-2][T2.4] [P0-2][T2.5] Aller-retour rapide, contraste 2 thèmes et cohérence Aujourd’hui ↔ État', async () => {
      const sequence: SectionFr[] = ['Aujourd’hui', 'Copilote', 'Documents', 'État', 'Réglages', 'État', 'Aujourd’hui'];
      for (const s of sequence) {
        await allerSection(page, testInfo, s);
      }
      const badge = page.locator('.titre-liste .badge').first();
      await expect(badge).toBeVisible();
      const nbAFaireAccueil = Number(((await badge.textContent()) ?? '').trim());
      expect(nbAFaireAccueil).toBeGreaterThan(0);

      for (const theme of ['sombre', 'clair'] as ThemeE2E[]) {
        await choisirTheme(page, testInfo, theme);
        await auditerSurfacesEtIcones(page, `${testInfo.project.name}/${theme}/Réglages`);
        await allerSection(page, testInfo, 'État');
        await auditerSurfacesEtIcones(page, `${testInfo.project.name}/${theme}/État`);
        verifierCoherenceFileRevue(await page.locator('main.contenu').innerText(), nbAFaireAccueil);
      }
    });

    verifierAucuneErreur(journal);
  });
});

test.describe('P0-3 — Visibilité Réorg & dossiers vides sur Aujourd’hui (@lot-r4)', () => {
  test('P0-3 Tier 1 & 2 @lot-r4 — encart Réorg, verrou 2 <section>, redirection, zéro action destructive & i18n', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[P0-3][T1.1][T1.2][T1.5][T2.1] 2 <section> strictes, ligne Réorg visible, zéro dossier vide inventé, zéro bouton destructif', async () => {
      await expect(page.locator('.accueil > section')).toHaveCount(2);
      const sectionAFaire = page.locator('.accueil > section').nth(0);
      await expect(sectionAFaire.getByRole('heading', { name: /À faire/i })).toBeVisible();
      await expect(page.locator('.accueil > section').nth(1).getByRole('heading', { name: /Derniers classements/i })).toBeVisible();

      const btnReorg = sectionAFaire.getByRole('button', { name: /1 proposition\(s\) de réorganisation à valider/i });
      await expect(btnReorg).toBeVisible();
      await expect(btnReorg).toContainText('Voir dans Documents');

      const texteAccueil = await page.locator('.accueil').innerText();
      expect(texteAccueil).not.toMatch(/dossier\(s\)\s+vide\(s\)/i);
      expect(texteAccueil).not.toMatch(/\b(Corbeiller|Supprimer|Tout déplacer)\b/i);
    });

    await test.step('[P0-3][T1.3][T1.4][T2.5] Bouton Réorg >= 44 px redirige vers Documents ; retour conserve 2 <section>', async () => {
      const btnReorg = page.locator('.accueil > section').nth(0).getByRole('button', { name: /proposition\(s\) de réorganisation/i });
      const box = await btnReorg.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(43.5);
      expect(box!.height).toBeGreaterThanOrEqual(43.5);

      await btnReorg.click();
      await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
      await expect(page.locator('.propositions .prop-carte').first()).toBeVisible();

      await allerSection(page, testInfo, 'Aujourd’hui');
      await expect(page.locator('.accueil > section')).toHaveCount(2);
    });

    await test.step('[P0-3][T2.2][T2.3][T2.4] Traduction EN, contraste clair/sombre et police 24 px sans débordement', async () => {
      await choisirTheme(page, testInfo, 'clair');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      const btnToday = nav.getByRole('button', { name: 'Today', exact: true });
      await btnToday.click();

      await expect(page.locator('.accueil > section').nth(0)).toContainText('1 reorg proposal(s) to review');
      await expect(page.locator('.accueil > section').nth(0)).toContainText('View in Documents');
      await auditerSurfacesEtIcones(page, `${testInfo.project.name}/clair/Aujourd’hui-EN`);

      await page.setViewportSize({ width: tel ? 320 : 1440, height: tel ? 568 : 900 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      const m = await mesurerDebordement(page);
      expect(m.page).toBeLessThanOrEqual(0);
      expect(m.horsCarte).toBeLessThanOrEqual(1);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    });

    verifierAucuneErreur(journal);
  });
});

test.describe('P0-4 — Télémétrie moteur & app dans État (@lot-r4)', () => {
  test('P0-4 Tier 1 & 2 @lot-r4 — tri_archives_jour, plafond commun 300/j, largeurs bornées, zéro NaN et FR ↔ EN', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await allerSection(page, testInfo, 'État');

    await test.step('[P0-4][T1.1][T1.2][T1.3] Compteurs tri_archives_jour (18), tri_fond_fils_jour (171), tri_anciens_fils_jour (12) et note mesurée honnête', async () => {
      const celluleArchives = page.locator('.statut-cellule', { hasText: 'Fils archivés aujourd’hui' });
      await expect(celluleArchives).toBeVisible();
      await expect(celluleArchives.locator('b')).toHaveText('18');
      await expect(page.locator('.note-archivage')).toContainText('Compteur quotidien mesuré');
      const texteEtat = await page.locator('main.contenu').innerText();
      expect(texteEtat).not.toMatch(/\b(214|1\s*842)\s+archiv/i);
    });

    await test.step('[P0-4][T1.4][T2.1][T2.2][T2.5] Panneau Avancé absent et largeurs .jauge > i [0,100]% sans NaN/Infinity', async () => {
      await expect(page.locator('details.avance')).toHaveCount(0);

      const largeurs = await page.evaluate(() => {
        const resultats: string[] = [];
        for (const barre of document.querySelectorAll('.jauge > i')) {
          resultats.push((barre as HTMLElement).style.width);
        }
        return resultats;
      });
      expect(largeurs.length).toBeGreaterThan(0);
      for (const w of largeurs) {
        expect(w).not.toMatch(/NaN|Infinity/i);
        const pct = parseFloat(w);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }

      const texteComplet = await page.locator('main.contenu').innerText();
      expect(texteComplet).not.toMatch(/\b(NaN|Infinity)\b/);
    });

    await test.step('[P0-4][T1.5] [P0-4][T2.3] [P0-4][T2.4] État à 320×568 & 320×844 (16 px / 24 px) et 844×390 en thèmes sombre & clair + EN', async () => {
      const verifierEtatResponsive = async (themeLibelle: string) => {
        const fenetres = tel
          ? [
              { w: 320, h: 568, polices: ['16px', '24px'] },
              { w: 320, h: 844, polices: ['16px', '24px'] },
              { w: 844, h: 390, polices: ['24px'] },
            ]
          : [{ w: 1440, h: 900, polices: ['16px', '24px'] }];
        try {
          for (const { w, h, polices } of fenetres) {
            await page.setViewportSize({ width: w, height: h });
            for (const police of polices) {
              await page.evaluate((p) => { document.documentElement.style.fontSize = p; }, police);
              await stabiliserRendu(page);
              const mesure = await mesurerDebordement(page);
              expect(
                mesure.page,
                `[${themeLibelle}] État déborde de ${mesure.page} px à ${w}×${h} (${police})`,
              ).toBeLessThanOrEqual(0);
              expect(
                mesure.horsCarte,
                `[${themeLibelle}] État sort de .carte de ${mesure.horsCarte} px à ${w}×${h} (${police})`,
              ).toBeLessThanOrEqual(1);
            }
          }
        } finally {
          await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
          await page.setViewportSize(tel ? { width: 390, height: 844 } : { width: 1440, height: 900 });
        }
      };

      await verifierEtatResponsive('sombre');

      // Bascule thème clair + English puis contrôle identique
      await choisirTheme(page, testInfo, 'clair');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      const btnStatus = nav.getByRole('button', { name: 'Status', exact: true });
      await btnStatus.click();

      await expect(page.locator('.statut-cellule', { hasText: 'Threads archived today' })).toContainText('18');
      await expect(page.locator('details.avance')).toHaveCount(0);
      await verifierEtatResponsive('clair-EN');
    });

    verifierAucuneErreur(journal);
  });
});

test.describe('P1-1 — Filtres rapides .gf-chip côté client (@lot-r4)', () => {
  test('P1-1 Tier 1 & 2 @lot-r4 — 5 puces, filtrage en mémoire, état vide, >= 44 px, 320×568 et FR ↔ EN', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';
    await allerSection(page, testInfo, 'Documents');

    await test.step('[P1-1][T1.1][T2.2] 5 puces .gf-chip visibles avec taille >= 44×44 px', async () => {
      const barre = page.locator('.documents .filtres-rapides.gf-chips');
      await expect(barre).toBeVisible();
      const libelles = await barre.locator('.gf-chip').allTextContents();
      expect(libelles.map((s) => s.trim())).toEqual(['Tout', 'Dossiers', 'PDF', 'À vérifier', 'Confiance < 50 %']);
      await expect(barre.getByRole('button', { name: 'Tout', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await auditerCiblesTactiles(page, `${testInfo.project.name}/P1-1-chips`);
    });

    await test.step('[P1-1][T1.2][T2.1] Puce Dossiers sur Mon Drive puis PDF (état vide propre)', async () => {
      const barre = page.locator('.documents .filtres-rapides.gf-chips');
      await barre.getByRole('button', { name: 'Dossiers', exact: true }).click();
      await expect(page.locator('.documents .carte.lignes .ligne.clic')).toHaveCount(3);

      await barre.getByRole('button', { name: 'PDF', exact: true }).click();
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);

      await barre.getByRole('button', { name: 'Tout', exact: true }).click();
      await expect(page.locator('.documents .carte.lignes .ligne.clic')).toHaveCount(3);
    });

    await test.step('[P1-1][T1.3] Puce PDF sur résultats de recherche Relevé masque le dossier Relevés', async () => {
      await executerRechercheExplorateur(page, 'Relevé');
      await expect(page.locator('.documents .ligne.clic', { hasText: 'Relevés' })).toBeVisible();
      await page.locator('.documents .filtres-rapides.gf-chips').getByRole('button', { name: 'PDF', exact: true }).click();
      await expect(page.locator('.documents .ligne.clic', { hasText: 'Relevés' })).toHaveCount(0);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
      await expect(page.locator('.documents .ligne', { hasText: '2026-05-31_Relevé_Bellerives.pdf' })).toBeVisible();
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
    });

    await test.step('[P1-1][T1.4][T1.5][T2.4] Dans 00 · À trier : À vérifier, Confiance < 50 % et retour Tout', async () => {
      await ouvrirDossierParNom(page, '00 · À trier');
      const barre = page.locator('.documents .filtres-rapides.gf-chips');

      await barre.getByRole('button', { name: 'À vérifier', exact: true }).click();
      await expect(barre.getByRole('button', { name: 'À vérifier', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.documents .ligne', { hasText: 'Scan_illisible_01.pdf' })).toBeVisible();
      await expect(page.locator('.documents .ligne', { hasText: 'export-facebook.html' })).toHaveCount(0);

      await barre.getByRole('button', { name: 'Confiance < 50 %', exact: true }).click();
      await expect(page.locator('.documents .ligne', { hasText: '2026-07_Reçu_Clinique.pdf' })).toBeVisible();
      await expect(page.locator('.documents .ligne', { hasText: 'Scan_illisible_01.pdf' })).toHaveCount(0);

      await barre.getByRole('button', { name: 'Tout', exact: true }).click();
      await expect(page.locator('.documents .ligne', { hasText: 'export-facebook.html' })).toBeVisible();
    });

    await test.step('[P1-1][T2.3][T2.5] 320×568 police 24 px sans débordement et traduction EN en thème clair', async () => {
      await choisirTheme(page, testInfo, 'clair');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      const btnDocs = nav.getByRole('button', { name: 'Documents', exact: true });
      await btnDocs.click();
      await attendreListingPret(page);

      const libellesEn = await page.locator('.documents .filtres-rapides.gf-chips .gf-chip').allTextContents();
      expect(libellesEn.map((s) => s.trim())).toEqual(['All', 'Folders', 'PDF', 'To check', 'Confidence < 50%']);

      await page.setViewportSize({ width: tel ? 320 : 1440, height: tel ? 568 : 900 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      const m = await mesurerDebordement(page);
      expect(m.page).toBeLessThanOrEqual(0);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    });

    verifierAucuneErreur(journal);
  });
});

test.describe('P1-2 — Parent & reconstruction exacte du fil d’Ariane (@lot-r4)', () => {
  test('P1-2 Tier 1 & 2 @lot-r4 — .ligne-parent sur résultats, Ariane niveau 3 depuis Explorateur & Omnibox, remontée ancêtres', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';
    await allerSection(page, testInfo, 'Documents');

    await test.step('[P1-2][T1.1][T1.2] Recherche Relevés affiche parent Bellerives puis reconstruit Mon Drive › 02 · Finances › Bellerives › Relevés', async () => {
      await executerRechercheExplorateur(page, 'Relevés');
      const ligneReleves = page.locator('.documents .ligne.clic[role="button"]', { hasText: 'Relevés' }).first();
      await expect(ligneReleves).toBeVisible();
      await expect(ligneReleves.locator('.ligne-parent')).toHaveText('Bellerives');

      await ligneReleves.click();
      await attendreListingPret(page);
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      const etapes = await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents();
      expect(etapes.map((s) => s.trim())).toEqual(['Mon Drive', '02 · Finances', 'Bellerives', 'Relevés']);
      await expect(page.locator('.documents .ligne', { hasText: '2026-05-31_Relevé_Bellerives.pdf' })).toBeVisible();
    });

    await test.step('[P1-2][T1.4][T1.5][T2.1] Remontée Bellerives › 02 · Finances, recherche scopée puis ouverture niveau 1 sans doublon', async () => {
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await ariane.getByRole('button', { name: 'Bellerives', exact: true }).click();
      await attendreListingPret(page);
      expect((await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim())).toEqual(['Mon Drive', '02 · Finances', 'Bellerives']);

      await ariane.getByRole('button', { name: '02 · Finances', exact: true }).click();
      await attendreListingPret(page);
      await executerRechercheExplorateur(page, 'Relevés');
      await page.locator('.documents .ligne.clic[role="button"]', { hasText: 'Relevés' }).first().click();
      await attendreListingPret(page);
      expect((await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim())).toEqual(['Mon Drive', '02 · Finances', 'Bellerives', 'Relevés']);

      await ariane.getByRole('button', { name: 'Mon Drive', exact: true }).click();
      await attendreListingPret(page);
      await executerRechercheExplorateur(page, 'Finances');
      await page.locator('.documents .ligne.clic[role="button"]', { hasText: '02 · Finances' }).first().click();
      await attendreListingPret(page);
      expect((await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim())).toEqual(['Mon Drive', '02 · Finances']);
    });

    await test.step('[P1-2][T1.3][T2.2][T2.4][T2.5] Ouverture Relevés et 12 rue Exemple depuis Omnibox Ctrl+K puis retour Mon Drive', async () => {
      await allerSection(page, testInfo, 'État');
      const { dialog, champ } = await ouvrirOmniboxClavier(page);
      await champ.fill('Relevés');
      await champ.press('Enter');
      await boutonDossierOmnibox(dialog, 'Relevés').click();
      await expect(dialog).toHaveCount(0);
      await attendreListingPret(page);

      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toBeVisible();
      expect((await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim())).toEqual(['Mon Drive', '02 · Finances', 'Bellerives', 'Relevés']);
      await expect(page.getByText(/Chemin parent exact indisponible/i)).toHaveCount(0);

      await trouverBoutonPortee(page, 'tout').click();
      await executerRechercheExplorateur(page, '12 rue Exemple');
      await page.locator('.documents .ligne.clic[role="button"]', { hasText: '12 rue Exemple' }).first().click();
      await attendreListingPret(page);
      expect((await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim())).toEqual(['Mon Drive', '03 · Logement & véhicule', '12 rue Exemple']);

      await ariane.getByRole('button', { name: 'Mon Drive', exact: true }).click();
      await attendreListingPret(page);
      await expect(page.locator('.documents .ligne.clic[role="button"]')).toHaveCount(3);
    });

    await test.step('[P1-2][T2.3] Ariane multi-niveaux à 320×568 police 24 px sans débordement', async () => {
      await executerRechercheExplorateur(page, 'Relevés');
      await page.locator('.documents .ligne.clic[role="button"]', { hasText: 'Relevés' }).first().click();
      await attendreListingPret(page);
      await page.setViewportSize({ width: tel ? 320 : 1440, height: tel ? 568 : 900 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      const m = await mesurerDebordement(page);
      expect(m.page).toBeLessThanOrEqual(0);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    });

    verifierAucuneErreur(journal);
  });
});

test.describe('P1-3 — Pastilles Index, Copier le lien & Création dossier (@lot-r4)', () => {
  test('P1-3 Tier 1 & 2 @lot-r4 — pastilles, copier lien (succès), bandeau .ok création dossier & Escape/vide', async ({ page }, testInfo) => {
    await installerMockPressePapier(page, 'succes');

    const journal = await preparerApp(page, testInfo);
    expect(await page.evaluate(() => typeof navigator.clipboard?.writeText)).toBe('function');
    const tel = testInfo.project.name === 'tel';
    await allerSection(page, testInfo, 'Documents');

    await test.step('[P1-3][T1.1][T1.2][T1.5] Pastilles .pastille-index, bouton Copier le lien >= 44 px et bouton Déplacer', async () => {
      await ouvrirDossierParNom(page, '00 · À trier');
      const ligneClinique = page.locator('.documents .ligne', { hasText: '2026-07_Reçu_Clinique.pdf' });
      await expect(ligneClinique.locator('.pastille-index', { hasText: 'Classé' })).toBeVisible();
      await expect(ligneClinique.locator('.pastille-index', { hasText: 'Confiance faible' })).toBeVisible();

      const ligneScan = page.locator('.documents .ligne', { hasText: 'Scan_illisible_01.pdf' });
      await expect(ligneScan.locator('.pastille-index', { hasText: 'À vérifier' })).toBeVisible();

      const btnCopier = ligneClinique.locator('button.bouton-copier');
      await expect(btnCopier).toBeVisible();
      const boxCopier = await btnCopier.boundingBox();
      expect(boxCopier).not.toBeNull();
      expect(boxCopier!.width).toBeGreaterThanOrEqual(43.5);
      expect(boxCopier!.height).toBeGreaterThanOrEqual(43.5);

      const btnDeplacer = ligneClinique.getByRole('button', { name: /Déplacer : 2026-07_Reçu_Clinique\.pdf/ });
      await expect(btnDeplacer).toBeVisible();
      await expect(ligneClinique.locator('a.lien-ligne')).toHaveAttribute('href', /drive\.google\.com/);
    });

    await test.step('[P1-3][T1.3] Clic sur Copier le lien copie l’URL Drive et active .copie-ok', async () => {
      const ligneClinique = page.locator('.documents .ligne', { hasText: '2026-07_Reçu_Clinique.pdf' });
      const btnCopier = ligneClinique.locator('button.bouton-copier');
      await btnCopier.click();
      await expect(btnCopier).toHaveClass(/copie-ok/);
      await expect(btnCopier).toContainText('Lien copié');
      const valeurCopiee = await page.evaluate(() => (window as unknown as { __copieE2E?: string }).__copieE2E ?? '');
      expect(valeurCopiee).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/f-009\/view/);
    });

    await test.step('[P1-3][T2.2][T2.3][T1.4][T2.5] Création dossier : bouton désactivé à vide, Escape ferme, Créer affiche .bandeau-ok', async () => {
      await page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: 'Mon Drive', exact: true }).click();
      await attendreListingPret(page);
      await ouvrirDossierParNom(page, '02 · Finances');

      await page.locator('.documents').getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
      const champNom = page.getByPlaceholder('Nom du dossier…');
      await expect(champNom).toBeVisible();
      const btnCreer = page.locator('.creation-dossier').getByRole('button', { name: 'Créer', exact: true });
      await expect(btnCreer).toBeDisabled();

      await champNom.press('Escape');
      await expect(champNom).toHaveCount(0);

      await page.locator('.documents').getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
      await page.getByPlaceholder('Nom du dossier…').fill('Dossier Test E2E');
      await expect(btnCreer).toBeEnabled();
      await btnCreer.click();

      const bandeau = page.locator('.documents p.ok.bandeau-ok[role="status"]');
      await expect(bandeau).toBeVisible();
      await expect(bandeau).toContainText('Dossier créé : Dossier Test E2E');
      await expect(page.locator('.documents .ligne.clic', { hasText: 'Dossier Test E2E' })).toBeVisible();
    });

    await test.step('[P1-3][T2.4][T2.5] Lisibilité en thème clair et absence de débordement à 320×568 police 24 px', async () => {
      await choisirTheme(page, testInfo, 'clair');
      await allerSection(page, testInfo, 'Documents');
      await ouvrirDossierParNom(page, '00 · À trier');
      try {
        await page.setViewportSize({ width: tel ? 320 : 1440, height: tel ? 568 : 900 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        await stabiliserRendu(page);
        const m = await mesurerDebordement(page);
        expect(m.page).toBeLessThanOrEqual(0);
        expect(m.horsCarte).toBeLessThanOrEqual(1);
      } finally {
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.setViewportSize(tel ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      }
    });

    verifierAucuneErreur(journal);
  });

  test('[P1-3][T2.1] P1-3 Tier 2 @lot-r4 — rejet du presse-papiers géré gracieusement sans pageerror', async ({ page }, testInfo) => {
    await installerMockPressePapier(page, 'rejet');

    const journal = await preparerApp(page, testInfo);
    expect(await page.evaluate(() => typeof navigator.clipboard?.writeText)).toBe('function');
    await allerSection(page, testInfo, 'Documents');
    await ouvrirDossierParNom(page, '00 · À trier');

    const btnCopier = page.locator('.documents .ligne', { hasText: '2026-07_Reçu_Clinique.pdf' }).locator('button.bouton-copier');
    await btnCopier.click();

    await expect(page.locator('.documents p.variante.erreur[role="status"]')).toContainText('Copie impossible — ouvre le lien directement');
    verifierAucuneErreur(journal);
  });
});

test.describe('P2-1 & P2-2 & P1-4 — Thème clair, persistance, robustesse & navigation découplée (@lot-r4)', () => {
  test('P2-1 Tier 1 & 2 @lot-r4 — défaut sombre, bascule clair, persistance reload(), contrastes/cibles/viewports, neon et i18n', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[P2-1][T1.1][T1.2][T1.3] Défaut sombre puis passage à Clair', async () => {
      const initial = await page.evaluate(() => ({
        themeStorage: localStorage.getItem('driveai.theme'),
        datasetTheme: document.documentElement.dataset.theme,
        colorScheme: document.documentElement.style.colorScheme,
      }));
      expect(initial.themeStorage).toBeNull();
      expect(initial.datasetTheme).toBeUndefined();
      expect(initial.colorScheme).toBe('dark');

      await choisirTheme(page, testInfo, 'clair');
      expect(await page.evaluate(() => localStorage.getItem('driveai.theme'))).toBe('clair');
      await auditerSurfacesEtIcones(page, `${testInfo.project.name}/P2-1-clair`);
    });

    await test.step('[P2-1][T1.4][T1.5] Persistance après page.reload() puis retour à Sombre', async () => {
      await page.reload();
      await expect(page.getByText('Chargement…')).toHaveCount(0);
      const apresReloadClair = await page.evaluate(() => ({
        datasetTheme: document.documentElement.dataset.theme,
        colorScheme: document.documentElement.style.colorScheme,
        stocke: localStorage.getItem('driveai.theme'),
      }));
      expect(apresReloadClair.datasetTheme).toBe('clair');
      expect(apresReloadClair.colorScheme).toBe('light');
      expect(apresReloadClair.stocke).toBe('clair');

      await choisirTheme(page, testInfo, 'sombre');
      await page.reload();
      await expect(page.getByText('Chargement…')).toHaveCount(0);
      const apresReloadSombre = await page.evaluate(() => ({
        datasetTheme: document.documentElement.dataset.theme,
        colorScheme: document.documentElement.style.colorScheme,
      }));
      expect(apresReloadSombre.datasetTheme).toBeUndefined();
      expect(apresReloadSombre.colorScheme).toBe('dark');
    });

    await test.step('[P2-1][T2.2] [P2-1][T2.3] [P2-1][T2.4] Thème clair : cibles >= 44 px, contraste surfaces et 0 débordement multi-viewports + Omnibox', async () => {
      await choisirTheme(page, testInfo, 'clair');
      for (const section of ['Aujourd’hui', 'Copilote', 'Documents', 'État', 'Réglages'] as SectionFr[]) {
        await allerSection(page, testInfo, section);
        await auditerSurfacesEtIcones(page, `${testInfo.project.name}/P2-1-clair/${section}`);
        await auditerCiblesTactiles(page, `${testInfo.project.name}/P2-1-clair/${section}`);
        expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      }

      const { dialog } = await ouvrirOmniboxClavier(page);
      await auditerCiblesTactiles(page, `${testInfo.project.name}/P2-1-clair/Omnibox`);
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      try {
        if (tel) {
          for (const vp of [
            { w: 320, h: 568, f: '16px' },
            { w: 320, h: 844, f: '24px' },
            { w: 844, h: 390, f: '16px' },
          ]) {
            await page.setViewportSize({ width: vp.w, height: vp.h });
            await page.evaluate((p) => { document.documentElement.style.fontSize = p; }, vp.f);
            await stabiliserRendu(page);
            const m = await mesurerDebordement(page);
            expect(m.page, `Thème clair déborde à ${vp.w}×${vp.h} (${vp.f})`).toBeLessThanOrEqual(0);
            expect(m.horsCarte).toBeLessThanOrEqual(1);
          }
        } else {
          await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
          await stabiliserRendu(page);
          const m = await mesurerDebordement(page);
          expect(m.page).toBeLessThanOrEqual(0);
          expect(m.horsCarte).toBeLessThanOrEqual(1);
        }
      } finally {
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.setViewportSize(tel ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      }
      await choisirTheme(page, testInfo, 'sombre');
    });

    await test.step('[P2-1][T2.5] Traduction EN du sélecteur de thème dans Réglages', async () => {
      await allerSection(page, testInfo, 'Réglages');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      const groupeEn = page.getByRole('group', { name: 'Theme' });
      await expect(groupeEn).toBeVisible();
      await expect(groupeEn.getByRole('button', { name: 'Dark', exact: true })).toBeVisible();
      await expect(groupeEn.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Français', exact: true }).click();
    });

    verifierAucuneErreur(journal);
  });

  test('[P2-1][T2.1] P2-1 Tier 2 @lot-r4 — localStorage corrompu ("neon") replie silencieusement vers sombre', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('driveai.theme', 'neon');
    });
    const journal = await preparerApp(page, testInfo);
    const etatDom = await page.evaluate(() => ({
      datasetTheme: document.documentElement.dataset.theme,
      colorScheme: document.documentElement.style.colorScheme,
    }));
    expect(etatDom.datasetTheme).toBeUndefined();
    expect(etatDom.colorScheme).toBe('dark');
    verifierAucuneErreur(journal);
  });

  test('P2-2 Tier 1 & 2 @lot-r4 — micro-robustesse UI (5 Tier 1 + 5 Tier 2)', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    await test.step('[P2-2][T1.1] Bascule de portée pendant recherche active (Dans « 02 · Finances » ↔ Tout le Drive)', async () => {
      await allerSection(page, testInfo, 'Documents');
      await ouvrirDossierParNom(page, '02 · Finances');
      const btnDossier = trouverBoutonPortee(page, 'dossier');
      const btnTout = trouverBoutonPortee(page, 'tout');

      await btnDossier.click();
      await executerRechercheExplorateur(page, 'scan-sans-nom');
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');

      await btnTout.click();
      await attendreListingPret(page);
      await expect(btnTout).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.documents .ligne', { hasText: 'scan-sans-nom.pdf' })).toBeVisible();
    });

    await test.step('[P2-2][T2.1] [P2-2][T2.2] Double-clic portée active (no-op) et oscillations rapides sans résultats périmés', async () => {
      const btnDossier = trouverBoutonPortee(page, 'dossier');
      const btnTout = trouverBoutonPortee(page, 'tout');

      await btnDossier.click();
      await btnDossier.click();
      await attendreListingPret(page);
      await expect(btnDossier).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');

      await btnTout.click();
      await btnDossier.click();
      await btnTout.click();
      await btnDossier.click();
      await btnTout.click();
      await attendreListingPret(page);
      await expect(btnTout).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.documents .ligne', { hasText: 'scan-sans-nom.pdf' })).toBeVisible();
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
    });

    await test.step('[P2-2][T1.3] [P2-2][T1.4] Bouton recherche et bouton Créer désactivés à vide ou espaces seuls', async () => {
      const champRecherche = page.locator('.documents').getByRole('textbox', { name: /Rechercher/i });
      const btnSoumettre = page.locator('.documents button.recherche-soumettre');
      await champRecherche.fill('');
      await expect(btnSoumettre).toBeDisabled();
      await champRecherche.fill('   ');
      await expect(btnSoumettre).toBeDisabled();
      await champRecherche.fill('Relevé');
      await expect(btnSoumettre).toBeEnabled();
      await champRecherche.fill('');

      await page.locator('.documents').getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
      const champDossier = page.getByPlaceholder('Nom du dossier…');
      const btnCreer = page.locator('.creation-dossier').getByRole('button', { name: 'Créer', exact: true });
      await expect(btnCreer).toBeDisabled();
      await champDossier.fill('   ');
      await expect(btnCreer).toBeDisabled();
      await champDossier.fill('Nom Valide E2E');
      await expect(btnCreer).toBeEnabled();
      await champDossier.press('Escape');
      await expect(champDossier).toHaveCount(0);
    });

    await test.step('[P2-2][T1.2] [P2-2][T2.3] Gardes division/zéro sur .jauge > i et zéro NaN/Infinity/undefined dans État & Réglages', async () => {
      await allerSection(page, testInfo, 'État');
      await expect(page.locator('details.avance')).toHaveCount(0);

      const largeurs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.jauge > i')).map((b) => (b as HTMLElement).style.width),
      );
      expect(largeurs.length).toBeGreaterThan(0);
      for (const w of largeurs) {
        expect(w).not.toMatch(/NaN|Infinity|undefined/i);
        const pct = parseFloat(w);
        expect(Number.isFinite(pct)).toBe(true);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }

      const texteEtat = await page.locator('main.contenu').innerText();
      expect(texteEtat).not.toMatch(/\b(NaN|Infinity|undefined)\b/);
    });

    await test.step('[P2-2][T1.5] [P2-2][T2.4] FrequenceLigne (select 5/10/15/30 + repli sûr), zéro NaN/undefined dans Réglages & clic idempotent sur thème actif', async () => {
      await allerSection(page, testInfo, 'Réglages');
      const selectFreq = page.getByRole('combobox', { name: 'Fréquence des passages' });
      await expect(selectFreq).toBeVisible();
      await expect(selectFreq).toBeEnabled();
      await expect(selectFreq).toHaveValue('5');
      const options = await selectFreq.locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
      expect(options).toEqual(['5', '10', '15', '30']);

      await selectFreq.selectOption('10');
      await expect(selectFreq).toHaveValue('5');
      await expect(selectFreq).toBeEnabled();

      const texteReglages = await page.locator('main.contenu').innerText();
      expect(texteReglages).not.toMatch(/\b(NaN|Infinity|undefined)\b/);

      const groupeTheme = page.getByRole('group', { name: 'Thème' });
      const btnSombre = groupeTheme.getByRole('button', { name: 'Sombre', exact: true });
      await btnSombre.click();
      await expect(btnSombre).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    });

    await test.step('[P2-2][T2.5] Requête longue et caractères spéciaux dans Explorateur et Omnibox sans crash ni débordement', async () => {
      const requeteDifficile = 'a'.repeat(180) + ' \' " <> & % \\ / ? #';
      await allerSection(page, testInfo, 'Documents');
      await executerRechercheExplorateur(page, requeteDifficile);
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);

      const { dialog, champ } = await ouvrirOmniboxClavier(page);
      await champ.fill(requeteDifficile);
      await champ.press('Enter');
      await expect(dialog.getByText('Aucun résultat.')).toBeVisible();
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

    verifierAucuneErreur(journal);
  });

  test('P1-4 Tier 1 & 2 @lot-r4 — navigation découplée sans cycle (5 Tier 1 + 5 Tier 2)', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';
    const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });

    await test.step('[P1-4][T1.1] Aujourd’hui → Documents via Documents ›', async () => {
      await page.getByRole('button', { name: /Documents ›/i }).click();
      await attendreListingPret(page);
      await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    });

    await test.step('[P1-4][T1.2] Aujourd’hui → Documents via encart Réorg', async () => {
      await allerSection(page, testInfo, 'Aujourd’hui');
      await page.locator('.accueil > section').nth(0).getByRole('button', { name: /proposition\(s\) de réorganisation/i }).click();
      await attendreListingPret(page);
      await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
      await expect(page.locator('.propositions .prop-carte').first()).toBeVisible();
    });

    await test.step('[P1-4][T1.3] Aujourd’hui → État via PastilleMoteur', async () => {
      await allerSection(page, testInfo, 'Aujourd’hui');
      await page.locator('button.pastille-moteur:visible').first().click();
      await expect(page.getByRole('heading', { name: 'État', exact: true })).toBeVisible();
    });

    await test.step('[P1-4][T1.4] Documents → État via PastilleMoteur', async () => {
      await allerSection(page, testInfo, 'Documents');
      await page.locator('button.pastille-moteur:visible').first().click();
      await expect(page.getByRole('heading', { name: 'État', exact: true })).toBeVisible();
    });

    await test.step('[P1-4][T1.5] État → Réglages → Aujourd’hui via la coquille de navigation', async () => {
      await allerSection(page, testInfo, 'Réglages');
      await expect(page.getByRole('heading', { level: 1, name: 'Réglages', exact: true })).toBeVisible();
      await allerSection(page, testInfo, 'Aujourd’hui');
      await expect(page.getByRole('heading', { name: /À faire/i })).toBeVisible();
    });

    await test.step('[P1-4][T2.1] [P1-4][T2.2] Navigation rapide sur les 5 vues et préservation de l’état actif (.actif)', async () => {
      const parcours: SectionFr[] = ['Copilote', 'Documents', 'État', 'Réglages', 'Aujourd’hui', 'Copilote', 'État', 'Documents', 'Aujourd’hui'];
      for (const s of parcours) {
        await allerSection(page, testInfo, s);
        if (tel && s === 'Réglages') {
          await expect(page.locator('.barre-haute').getByRole('button', { name: 'Réglages', exact: true })).toHaveClass(/\bactif\b/);
        } else {
          await expect(nav.getByRole('button', { name: s, exact: true })).toHaveClass(/\bactif\b/);
        }
      }
    });

    await test.step('[P1-4][T2.3] Sauts d’écran découplés depuis l’Omnibox Ctrl+K', async () => {
      for (const cible of ['Copilote', 'Documents', 'État', 'Réglages', 'Aujourd’hui'] as SectionFr[]) {
        const { dialog } = await ouvrirOmniboxClavier(page);
        await dialog.getByRole('button', { name: cible, exact: true }).click();
        await expect(dialog).toHaveCount(0);
        if (cible === 'Documents') await attendreListingPret(page);
        await expect(page.getByRole('heading', { level: 1, name: cible, exact: true })).toBeVisible();
      }
    });

    await test.step('[P1-4][T2.4] Navigation découplée en langue English (Today → Documents → Status → Settings → Today)', async () => {
      await allerSection(page, testInfo, 'Réglages');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await nav.getByRole('button', { name: 'Today', exact: true }).click();
      await page.getByRole('button', { name: /Documents ›/i }).click();
      await attendreListingPret(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Documents', exact: true })).toBeVisible();
      await page.locator('button.pastille-moteur:visible').first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Status', exact: true })).toBeVisible();

      const btnSettings = tel
        ? page.locator('.barre-haute').getByRole('button', { name: 'Settings', exact: true })
        : nav.getByRole('button', { name: 'Settings', exact: true });
      await btnSettings.click();
      await page.getByRole('button', { name: 'Français', exact: true }).click();
      await nav.getByRole('button', { name: 'Aujourd’hui', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Aujourd’hui', exact: true })).toBeVisible();
    });

    await test.step('[P1-4][T2.5] Transitions découplées en thème clair à 320×568 (tel) / 1440×900 (pc) sans débordement', async () => {
      await choisirTheme(page, testInfo, 'clair');
      try {
        if (tel) {
          await page.setViewportSize({ width: 320, height: 568 });
        }
        await allerSection(page, testInfo, 'Aujourd’hui');
        await page.locator('.accueil > section').nth(0).getByRole('button', { name: /proposition\(s\) de réorganisation/i }).click();
        await attendreListingPret(page);
        expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);

        await page.locator('button.pastille-moteur:visible').first().click();
        await expect(page.getByRole('heading', { level: 1, name: 'État', exact: true })).toBeVisible();
        expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      } finally {
        await page.setViewportSize(tel ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      }
      await choisirTheme(page, testInfo, 'sombre');
    });

    verifierAucuneErreur(journal);
  });
});

/* ============================================================================
 * BLOC 7 — Tier 3 : Combinaisons par paires (Pairwise, 12+ paires)
 * ============================================================================ */

test.describe('Tier 3 — Interactions combinatoires par paires', () => {
  test('Tier 3 P3 @baseline — bascule langue FR/EN × Explorateur, État & fil d’Ariane', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await test.step('[Tier3][P3] Passage en English dans Réglages met à jour État (Status), Documents (My Drive) puis retour Français', async () => {
      await allerSection(page, testInfo, 'Réglages');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      await expect(nav.getByRole('button', { name: 'Status', exact: true })).toBeVisible();

      const btnDocs = nav.getByRole('button', { name: 'Documents', exact: true });
      await expect(btnDocs).toBeVisible();
      await btnDocs.click();
      await attendreListingPret(page);

      await expect(page.getByRole('navigation', { name: 'Path', exact: true })).toContainText('My Drive');
      await expect(page.locator('.documents').getByPlaceholder('Search a document…')).toBeVisible();

      if (tel) {
        await page.locator('.barre-haute').getByRole('button', { name: 'Settings', exact: true }).click();
      } else {
        await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Français', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'État', exact: true })).toBeVisible();
    });

    verifierAucuneErreur(journal);
  });

  test('Tier 3 P1 @contrat-r1 @contrat-r2 — recherche scopée → Tout le Drive avec audit tactile >= 44 px', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    await test.step('[Tier3][P1] Recherche scopée puis Tout le Drive dans 02 · Finances sans débordement et cibles >= 44 px', async () => {
      await allerSection(page, testInfo, 'Documents');
      await ouvrirDossierParNom(page, '02 · Finances');
      const btnDossier = trouverBoutonPortee(page, 'dossier');
      await expect(btnDossier, 'Contrôle de portée « Dans ce dossier » absent').toBeVisible();
      await btnDossier.click();
      await executerRechercheExplorateur(page, 'scan-sans-nom');
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');

      const btnTout = trouverBoutonPortee(page, 'tout');
      await expect(btnTout, 'Contrôle de portée « Tout le Drive » absent').toBeVisible();
      await btnTout.click();
      await attendreListingPret(page);
      await expect(page.locator('.documents .ligne', { hasText: 'scan-sans-nom.pdf' })).toBeVisible();

      const debord = await mesurerDebordement(page);
      expect(debord.page).toBeLessThanOrEqual(0);
      await auditerCiblesTactiles(page, `${testInfo.project.name}/Tier3-P1`);
    });

    verifierAucuneErreur(journal);
  });

  test('Tier 3 P2 @contrat-r1 @contrat-r2 — sous-dossier niveau 2 + résultats sur 320×844 police 24 px', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    await test.step('[Tier3][P2] Descente niveau 2 et recherche active à 320×844 (tel) ou 1440×900 (pc) police 24 px sans débordement', async () => {
      if (testInfo.project.name === 'tel') {
        await page.setViewportSize({ width: 320, height: 844 });
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      await allerSection(page, testInfo, 'Documents');
      const decouvert = await decouvrirSousArbreDeuxNiveaux(page);
      expect(decouvert).not.toBeNull();
      await executerRechercheExplorateur(page, decouvert!.fichierCible ? decouvert!.fichierCible.slice(0, 4) : 'pdf');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);

      const m = await mesurerDebordement(page);
      expect(m.page).toBeLessThanOrEqual(0);
      expect(m.horsCarte).toBeLessThanOrEqual(1);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    });

    verifierAucuneErreur(journal);
  });

  test('Tier 3 P4 @contrat-r2 @contrat-r3 — vue État sans Avancé × cibles >= 44 px × zéro débordement', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    await test.step('[Tier3][P4] État sans section Avancé conforme 44×44 px et sans débordement', async () => {
      await allerSection(page, testInfo, 'État');
      const texteAvant = await page.locator('main.contenu').innerText();
      expect(texteAvant).toMatch(/(Compte LLM|Analyse IA)/i);
      expect(texteAvant).toMatch(/Tri Gmail/i);

      await expect(page.locator('details.avance')).toHaveCount(0);

      const m = await mesurerDebordement(page);
      expect(m.page).toBeLessThanOrEqual(0);
      await auditerCiblesTactiles(page, `${testInfo.project.name}/Tier3-P4`);
    });

    verifierAucuneErreur(journal);
  });

  test('Tier 3 P5 @contrat-r1 @contrat-r3 — cohérence Derniers classements (Aujourd’hui) × Recherche Documents', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    await test.step('[Tier3][P5] Document affiché dans Derniers classements sur Aujourd’hui retrouvable dans Documents', async () => {
      const libellesRecents = await page.locator('.accueil section').nth(1).locator('.ligne b.mono').allTextContents();
      expect(libellesRecents.length).toBeGreaterThan(0);
      expect(libellesRecents).toContain('2026-06-28_Relevé_Bellerives.pdf');

      await allerSection(page, testInfo, 'Documents');
      await executerRechercheExplorateur(page, 'Bellerives');
      await expect(page.locator('[role="alert"]')).toHaveCount(0);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
    });

    verifierAucuneErreur(journal);
  });

  test('Tier 3 P6 @contrat-r1 @contrat-r2 — téléphone couché 844×390 dans sous-dossier avec recherche active', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    await test.step('[Tier3][P6] Paysage 844×390 dans 02 · Finances + recherche active sans rail ni débordement', async () => {
      await page.setViewportSize({ width: 844, height: 390 });
      const nav = page.getByRole('navigation', { name: 'Sections (mobile)', exact: true });
      await expect(nav).toBeVisible();
      await nav.getByRole('button', { name: 'Documents' }).click();
      await ouvrirDossierParNom(page, '02 · Finances');
      await executerRechercheExplorateur(page, 'Relevé');
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
      const railVisible = await page.evaluate(() => {
        const rail = document.querySelector('.rail');
        return rail ? getComputedStyle(rail).display !== 'none' : false;
      });
      expect(railVisible).toBe(false);
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
    });

    verifierAucuneErreur(journal);
  });

  test('Tier 3 P7–P12 @lot-r4 @tier3 — paires transversales Lot R4 (thème clair, Omnibox × Ariane, .gf-chip × portée, création × recherche)', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo, { theme: 'clair' });
    const tel = testInfo.project.name === 'tel';

    await test.step('[Tier3][P7] Thème clair × 5 vues : surfaces distinctes, cibles >= 44 px et 0 débordement', async () => {
      for (const section of ['Aujourd’hui', 'Copilote', 'Documents', 'État', 'Réglages'] as SectionFr[]) {
        await allerSection(page, testInfo, section);
        await auditerSurfacesEtIcones(page, `${testInfo.project.name}/Tier3-P7/${section}`);
        await auditerCiblesTactiles(page, `${testInfo.project.name}/Tier3-P7/${section}`);
        expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      }
    });

    await test.step('[Tier3][P8] Omnibox Ctrl+K × P1-2 Ariane profond × thème clair', async () => {
      const { dialog, champ } = await ouvrirOmniboxClavier(page);
      await champ.fill('Relevés');
      await champ.press('Enter');
      await boutonDossierOmnibox(dialog, 'Relevés').click();
      await expect(dialog).toHaveCount(0);
      await attendreListingPret(page);
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toBeVisible();
      expect((await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim()))
        .toEqual(['Mon Drive', '02 · Finances', 'Bellerives', 'Relevés']);
    });

    await test.step('[Tier3][P9] .gf-chip × recherche scopée dans 02 · Finances', async () => {
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await ariane.getByRole('button', { name: '02 · Finances', exact: true }).click();
      await attendreListingPret(page);
      await trouverBoutonPortee(page, 'dossier').click();
      await executerRechercheExplorateur(page, 'Bellerives');
      await expect(page.locator('.documents .ligne.clic', { hasText: 'Bellerives' })).toBeVisible();
      await page.locator('.documents .filtres-rapides.gf-chips').getByRole('button', { name: 'PDF', exact: true }).click();
      await expect(page.locator('.documents .ligne.clic', { hasText: 'Bellerives' })).toHaveCount(0);
      await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
    });

    await test.step('[Tier3][P10] P0-3 Réorg Aujourd’hui × Documents × thème clair', async () => {
      await allerSection(page, testInfo, 'Aujourd’hui');
      await page.locator('.accueil > section').nth(0).getByRole('button', { name: /proposition\(s\) de réorganisation/i }).click();
      await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    });

    await test.step('[Tier3][P11] P0-4 État × 320×568 / 1440×900 × thème clair', async () => {
      await allerSection(page, testInfo, 'État');
      await expect(page.locator('details.avance')).toHaveCount(0);
      if (tel) {
        await page.setViewportSize({ width: 320, height: 568 });
      }
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      if (tel) {
        await page.setViewportSize({ width: 390, height: 844 });
      }
    });

    await test.step('[Tier3][P12] P1-3 création dossier .bandeau-ok × recherche immédiate du dossier créé × Ariane', async () => {
      await allerSection(page, testInfo, 'Documents');
      const btnMonDrive = page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: 'Mon Drive', exact: true });
      if (await btnMonDrive.count() > 0) {
        await btnMonDrive.click();
        await attendreListingPret(page);
      }
      await page.locator('.documents').getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
      await page.getByPlaceholder('Nom du dossier…').fill('SousDossier Paire E2E');
      await page.locator('.creation-dossier').getByRole('button', { name: 'Créer', exact: true }).click();
      await expect(page.locator('.documents p.ok.bandeau-ok[role="status"]')).toContainText('SousDossier Paire E2E');

      await executerRechercheExplorateur(page, 'SousDossier Paire E2E');
      await page.locator('.documents .ligne.clic[role="button"]', { hasText: 'SousDossier Paire E2E' }).first().click();
      await attendreListingPret(page);
      expect((await page.getByRole('navigation', { name: 'Chemin', exact: true }).locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim()))
        .toEqual(['Mon Drive', 'SousDossier Paire E2E']);
    });

    verifierAucuneErreur(journal);
  });
});

/* ============================================================================
 * BLOC 8 — Tier 4 : Parcours utilisateurs réels bout-en-bout (S1 à S6)
 * ============================================================================ */

test.describe('Tier 4 — Parcours utilisateurs bout-en-bout S1 à S6', () => {
  test('Tier 4 S1 @contrat-r1 @contrat-r2 — investigation documentaire multi-niveaux et élargissement à tout Drive', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    let parentNom = '';
    let enfantNom = '';
    let fichierCible: string | null = null;

    await test.step('[S1.1] Démarrage sur Aujourd’hui et transition vers Documents', async () => {
      await expect(page.getByRole('heading', { name: /À faire/i })).toBeVisible();
      await allerSection(page, testInfo, 'Documents');
      await expect(page.getByRole('navigation', { name: 'Chemin', exact: true })).toContainText('Mon Drive');
    });

    await test.step('[S1.2] Descente dans un sous-dossier de niveau 2 avec vérification du fil d’Ariane', async () => {
      const decouvert = await decouvrirSousArbreDeuxNiveaux(page);
      expect(decouvert).not.toBeNull();
      parentNom = decouvert!.parentNom;
      enfantNom = decouvert!.enfantNom;
      fichierCible = decouvert!.fichierCible;
      const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
      await expect(ariane).toContainText(parentNom);
      await expect(ariane).toContainText(enfantNom);
    });

    await test.step('[S1.3] Recherche scopée négative sur une autre branche puis positive sur le sous-arbre local', async () => {
      const btnDossier = trouverBoutonPortee(page, 'dossier');
      await expect(btnDossier, 'Contrôle de portée « Dans ce dossier » absent').toBeVisible();
      await btnDossier.click();
      const horsBranche = parentNom.includes('À trier') ? 'Relevé' : 'scan-sans-nom';
      await executerRechercheExplorateur(page, horsBranche);
      await expect(page.locator('.documents .carte.lignes')).toContainText('Aucun résultat.');

      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
      await page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: parentNom }).click();
      await attendreListingPret(page);

      const termeLocal = fichierCible
        ? fichierCible.replace(/\.[a-z0-9]+$/i, '').split(/[_\s-]+/).find((m) => m.length >= 4) ?? fichierCible
        : enfantNom;
      await executerRechercheExplorateur(page, termeLocal);
      await expect(page.locator('.documents .ligne', { hasText: fichierCible ?? enfantNom }).first()).toBeVisible();
    });

    await test.step('[S1.4] Élargissement à Tout le Drive pour retrouver un fichier d’une autre branche', async () => {
      const horsBranche = parentNom.includes('À trier') ? 'Relevé' : 'scan-sans-nom';
      await executerRechercheExplorateur(page, horsBranche);
      const btnTout = trouverBoutonPortee(page, 'tout');
      await expect(btnTout, 'Contrôle de portée « Tout le Drive » absent').toBeVisible();
      await btnTout.click();
      await attendreListingPret(page);
      const attendu = parentNom.includes('À trier') ? '2026-06-28_Relevé_Bellerives.pdf' : 'scan-sans-nom.pdf';
      await expect(page.locator('.documents .ligne', { hasText: attendu })).toBeVisible();
    });

    await test.step('[S1.5] Effacement et remontée complète vers Mon Drive par l’Ariane', async () => {
      await page.locator('.documents .ariane-resultats').getByRole('button', { name: /Effacer/i }).click();
      await attendreListingPret(page);
      await page.getByRole('navigation', { name: 'Chemin', exact: true }).getByRole('button', { name: 'Mon Drive' }).click();
      await attendreListingPret(page);
      await expect(page.locator('.documents .ligne.clic[role="button"]', { hasText: '02 · Finances' })).toBeVisible();
    });

    await test.step('[S1.6] Contrôle final : zéro débordement, cibles >= 44 px et 0 erreur réseau/console', async () => {
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      await auditerCiblesTactiles(page, `${testInfo.project.name}/S1`);
      verifierAucuneErreur(journal);
    });
  });

  test('Tier 4 S2 @contrat-r2 @contrat-r3 — audit complet santé moteur, file de revue, coûts et bascule FR/EN (État ↔ Réglages)', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';
    let badgeAFaire = 0;

    await test.step('[S2.1] Lecture des compteurs sur Aujourd’hui puis ouverture de État via la pastille moteur', async () => {
      const badge = page.locator('.titre-liste .badge').first();
      await expect(badge).toBeVisible();
      badgeAFaire = Number(((await badge.textContent()) ?? '').trim());
      expect(badgeAFaire).toBeGreaterThan(0);

      const pastille = page.locator('button.pastille-moteur:visible').first();
      await expect(pastille).toBeVisible();
      await pastille.click();
      await expect(page.locator('.tuiles-3').getByText('documents classés')).toBeVisible();
    });

    await test.step('[S2.2] Audit de la vue État sans Avancé : dernier passage, Compte LLM, Tri Gmail et erreurs 7j', async () => {
      await expect(page.locator('details.avance')).toHaveCount(0);
      const textePage = (await page.locator('main.contenu').innerText()) ?? '';
      expect(textePage).not.toMatch(/État du moteur inconnu/i);
      expect(textePage).toMatch(/(Compte LLM|Analyse IA)/i);
      expect(textePage).toMatch(/Tri Gmail/i);
      expect(textePage).toMatch(/erreur.*7\s*j|7\s*jours/i);
    });

    await test.step('[S2.3] Cohérence file de revue et mention honnête d’archivage (tri_archives_jour = 18) sans donnée inventée', async () => {
      const texteMain = await page.locator('main.contenu').innerText();
      verifierCoherenceFileRevue(texteMain, badgeAFaire);
      expect(texteMain).toMatch(/archiv/i);
      expect(texteMain).not.toMatch(/\b(214|1\s*842)\s+archiv/i);
      await expect(page.locator('.statut-cellule', { hasText: 'Fils archivés aujourd’hui' })).toContainText('18');
    });

    await test.step('[S2.4] Budget mensuel KPI, Total relevé et absence du panneau Avancé', async () => {
      await expect(page.locator('details.avance')).toHaveCount(0);
      await expect(page.locator('.tuiles-3')).toContainText('16,42 $');
      await expect(page.getByText('Total relevé')).toBeVisible();
    });

    await test.step('[S2.5] Bascule Français → English dans Réglages puis vérification Status (État) et retour Français', async () => {
      await allerSection(page, testInfo, 'Réglages');
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();

      const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
      const btnStatus = nav.getByRole('button', { name: 'Status', exact: true });
      await btnStatus.click();

      const tuilesKpi = page.locator('.tuiles-3');
      await expect(tuilesKpi.getByText('documents filed')).toBeVisible();
      await expect(tuilesKpi.getByText('emails sorted')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Engine status' })).toBeVisible();
      await expect(page.locator('details.avance')).toHaveCount(0);

      if (tel) {
        await page.locator('.barre-haute').getByRole('button', { name: 'Settings', exact: true }).click();
      } else {
        await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Français', exact: true }).click();
      await allerSection(page, testInfo, 'État');
      await expect(tuilesKpi.getByText('documents classés')).toBeVisible();
      await expect(tuilesKpi.getByText('mails triés')).toBeVisible();
    });

    await test.step('[S2.6] Contrôle final : cibles >= 44 px, zéro débordement et 0 erreur console/réseau', async () => {
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
      await auditerCiblesTactiles(page, `${testInfo.project.name}/S2`);
      verifierAucuneErreur(journal);
    });
  });

  test('Tier 4 S3 @lot-r4 @tier4 — triage matinal & recherche rapide Ctrl+K vers Relevés puis remontée', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);

    await expect(page.locator('.accueil > section').nth(0)).toContainText('1 proposition(s) de réorganisation à valider');
    const { dialog, champ } = await ouvrirOmniboxClavier(page);
    await champ.fill('Relevés');
    await champ.press('Enter');
    await boutonDossierOmnibox(dialog, 'Relevés').click();
    await expect(dialog).toHaveCount(0);
    await attendreListingPret(page);

    const ariane = page.getByRole('navigation', { name: 'Chemin', exact: true });
    await expect(ariane).toBeVisible();
    expect((await ariane.locator('.ariane-etape > button, .ariane-etape > b').allTextContents()).map((s) => s.trim()))
      .toEqual(['Mon Drive', '02 · Finances', 'Bellerives', 'Relevés']);

    await ariane.getByRole('button', { name: '02 · Finances', exact: true }).click();
    await attendreListingPret(page);
    await expect(page.locator('.documents .ligne', { hasText: '2026-06-28_Relevé_Bellerives.pdf' })).toBeVisible();
    verifierAucuneErreur(journal);
  });

  test('Tier 4 S4 @lot-r4 @tier4 — actions Explorateur : filtres .gf-chip, pastilles Index, copie lien & création dossier', async ({ page }, testInfo) => {
    await installerMockPressePapier(page, 'succes');
    const journal = await preparerApp(page, testInfo);
    expect(await page.evaluate(() => typeof navigator.clipboard?.writeText)).toBe('function');
    await allerSection(page, testInfo, 'Documents');
    await ouvrirDossierParNom(page, '00 · À trier');

    const barre = page.locator('.documents .filtres-rapides.gf-chips');
    await barre.getByRole('button', { name: 'Confiance < 50 %', exact: true }).click();
    const ligneClinique = page.locator('.documents .ligne', { hasText: '2026-07_Reçu_Clinique.pdf' });
    await expect(ligneClinique.locator('.pastille-index', { hasText: 'Classé' })).toBeVisible();
    await ligneClinique.locator('button.bouton-copier').click();
    await expect(ligneClinique.locator('button.bouton-copier')).toHaveClass(/copie-ok/);

    await barre.getByRole('button', { name: 'Tout', exact: true }).click();
    await page.locator('.documents').getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
    await page.getByPlaceholder('Nom du dossier…').fill('Scénario S4 Dossier');
    await page.locator('.creation-dossier').getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page.locator('.documents p.ok.bandeau-ok[role="status"]')).toContainText('Scénario S4 Dossier');
    await auditerCiblesTactiles(page, `${testInfo.project.name}/S4`);
    verifierAucuneErreur(journal);
  });

  test('Tier 4 S5 @lot-r4 @tier4 — personnalisation complète Clair + English + reload() puis retour Sombre + Français', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    const tel = testInfo.project.name === 'tel';

    await choisirTheme(page, testInfo, 'clair');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.reload();
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expect(page.getByText('Chargement…')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('clair');

    const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
    for (const labelEn of ['Today', 'Copilot', 'Documents', 'Status']) {
      const btn = nav.getByRole('button', { name: labelEn, exact: true });
      await btn.click();
      expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);
    }
    if (tel) {
      await page.locator('.barre-haute').getByRole('button', { name: 'Settings', exact: true }).click();
    } else {
      await nav.getByRole('button', { name: 'Settings', exact: true }).click();
    }
    expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Français', exact: true }).click();
    await choisirTheme(page, testInfo, 'sombre');
    await expect(nav.getByRole('button', { name: 'Aujourd’hui', exact: true })).toBeVisible();
    verifierAucuneErreur(journal);
  });

  test('Tier 4 S6 @lot-r4 @tier4 — parcours contraint Omnibox + .gf-chip + État + Réglages (320×568, 320×844@24px, 844×390) 2 thèmes + 0 fuite', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo, { autoriserAnalyticsDev: false });
    const tel = testInfo.project.name === 'tel';

    const configurations = tel
      ? [
          { libelle: '320x568@16px', w: 320, h: 568, police: '16px', verifierPaysage: false },
          { libelle: '320x844@24px', w: 320, h: 844, police: '24px', verifierPaysage: false },
          { libelle: '844x390@16px', w: 844, h: 390, police: '16px', verifierPaysage: true },
        ]
      : [
          { libelle: '1440x900@16px', w: 1440, h: 900, police: '16px', verifierPaysage: false },
          { libelle: '1440x900@24px', w: 1440, h: 900, police: '24px', verifierPaysage: false },
        ];

    try {
      for (const theme of ['sombre', 'clair'] as ThemeE2E[]) {
        await choisirTheme(page, testInfo, theme);

        for (const cfg of configurations) {
          await page.setViewportSize({ width: cfg.w, height: cfg.h });
          await page.evaluate((p) => { document.documentElement.style.fontSize = p; }, cfg.police);
          await stabiliserRendu(page);

          if (cfg.verifierPaysage) {
            await expect(page.getByRole('navigation', { name: 'Sections (mobile)', exact: true })).toBeVisible();
            const railVisible = await page.evaluate(() => {
              const rail = document.querySelector('.rail');
              return rail ? getComputedStyle(rail).display !== 'none' : false;
            });
            expect(railVisible).toBe(false);
          }

          // 1. Omnibox ouverte + recherche
          const { dialog, champ } = await ouvrirOmniboxClavier(page);
          await champ.fill('Relevé');
          await champ.press('Enter');
          await expect(dialog.getByText('2026-06-28_Relevé_Bellerives.pdf')).toBeVisible();
          await stabiliserRendu(page);
          const mOmnibox = await mesurerDebordement(page);
          expect(mOmnibox.page, `[S6][${theme}][${cfg.libelle}] Omnibox déborde`).toBeLessThanOrEqual(0);
          await auditerCiblesTactiles(page, `S6/${theme}/${cfg.libelle}/Omnibox`);
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);

          // 1b. Copilote (Lot 1B)
          await allerSection(page, testInfo, 'Copilote');
          await stabiliserRendu(page);
          const mCopilote = await mesurerDebordement(page);
          expect(mCopilote.page, `[S6][${theme}][${cfg.libelle}] Copilote déborde`).toBeLessThanOrEqual(0);
          expect(mCopilote.horsCarte).toBeLessThanOrEqual(1);
          await auditerCiblesTactiles(page, `S6/${theme}/${cfg.libelle}/Copilote`);

          // 2. Documents + filtrage .gf-chip
          await allerSection(page, testInfo, 'Documents');
          const barre = page.locator('.documents .filtres-rapides.gf-chips');
          await barre.getByRole('button', { name: 'Dossiers', exact: true }).click();
          await expect(page.locator('.documents .carte.lignes .ligne.clic')).toHaveCount(3);
          await barre.getByRole('button', { name: 'Tout', exact: true }).click();
          await stabiliserRendu(page);
          const mDocs = await mesurerDebordement(page);
          expect(mDocs.page, `[S6][${theme}][${cfg.libelle}] Documents déborde`).toBeLessThanOrEqual(0);
          expect(mDocs.horsCarte).toBeLessThanOrEqual(1);
          await auditerCiblesTactiles(page, `S6/${theme}/${cfg.libelle}/Documents`);

          // 3. État sans panneau Avancé
          await allerSection(page, testInfo, 'État');
          await expect(page.locator('details.avance')).toHaveCount(0);
          await stabiliserRendu(page);
          const mEtat = await mesurerDebordement(page);
          expect(mEtat.page, `[S6][${theme}][${cfg.libelle}] État déborde`).toBeLessThanOrEqual(0);
          expect(mEtat.horsCarte).toBeLessThanOrEqual(1);
          await auditerCiblesTactiles(page, `S6/${theme}/${cfg.libelle}/État`);

          // 4. Réglages
          await allerSection(page, testInfo, 'Réglages');
          await stabiliserRendu(page);
          const mReglages = await mesurerDebordement(page);
          expect(mReglages.page, `[S6][${theme}][${cfg.libelle}] Réglages déborde`).toBeLessThanOrEqual(0);
          expect(mReglages.horsCarte).toBeLessThanOrEqual(1);
          await auditerCiblesTactiles(page, `S6/${theme}/${cfg.libelle}/Réglages`);
        }

        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await page.setViewportSize(tel ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      }
    } finally {
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      await page.setViewportSize(tel ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    }

    verifierAucuneErreur(journal);
  });

  test('Lot 1B @lot-1b — onglet Copilote, synthèse semaine, fil « Ce qui a bougé dans ton Drive » et filtres', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Copilote');

    await expect(page.getByRole('heading', { level: 1, name: 'Copilote', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Actions utiles de la semaine' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Ce qui a bougé dans ton Drive/ })).toBeVisible();

    const filtres = page.getByRole('group', { name: 'Filtrer les mouvements Drive' });
    await expect(filtres.getByRole('button', { name: 'Tous', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await filtres.getByRole('button', { name: 'Dossiers', exact: true }).click();
    await expect(page.locator('.copilote-vue .carte.lignes')).toContainText('02 · Finances/Bellerives/Relevés');

    await filtres.getByRole('button', { name: 'Apprentissages', exact: true }).click();
    await expect(page.locator('.copilote-vue .carte.lignes')).toContainText('Correction enregistrée');

    await filtres.getByRole('button', { name: 'Fichiers', exact: true }).click();
    await expect(page.locator('.copilote-vue .carte.lignes')).toContainText('2026-07-06_Devis_Garage Exemple.pdf');

    await filtres.getByRole('button', { name: 'Tous', exact: true }).click();
    await auditerCiblesTactiles(page, `${testInfo.project.name}/Lot1B/Copilote`);
    expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: /Ouvrir Documents/ }).click();
    await attendreListingPret(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Documents', exact: true })).toBeVisible();

    verifierAucuneErreur(journal);
  });

  test('Lot 2B @lot-2b — cartes proactives Copilote, démarche en cours, Regrouper + Annuler et cibles >= 44px', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Copilote');

    await expect(page.getByRole('heading', { name: /Propositions et démarches/ })).toBeVisible();
    await expect(page.getByText('Regrouper 2 doc(s) « Bellerives »')).toBeVisible();
    await expect(page.getByText('Document en corbeille : 2026-07_Permis.pdf')).toBeVisible();
    await expect(page.getByRole('link', { name: /2026-07_Permis\.pdf/ })).toBeVisible();

    await auditerCiblesTactiles(page, `${testInfo.project.name}/Lot2B/Copilote`);
    expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Regrouper', exact: true }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Action annulée');

    verifierAucuneErreur(journal);
  });

  test('Lot 3B @lot-3b — sections Expirations, Factures, Argent à récupérer, Marquer réclamé et cibles >= 44px', async ({ page }, testInfo) => {
    const journal = await preparerApp(page, testInfo);
    await allerSection(page, testInfo, 'Copilote');

    await expect(page.getByRole('heading', { name: /Expirations & pièces manquantes/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Factures & abonnements/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Argent à récupérer/ })).toBeVisible();
    await expect(page.getByText(/Hausse facture Cablonet/)).toBeVisible();
    await expect(page.getByText(/À réclamer : .*170/)).toBeVisible();

    await auditerCiblesTactiles(page, `${testInfo.project.name}/Lot3B/Copilote`);
    expect((await mesurerDebordement(page)).page).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Marquer réclamé', exact: true }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByText(/À réclamer : .*45/)).toBeVisible();

    verifierAucuneErreur(journal);
  });
});
