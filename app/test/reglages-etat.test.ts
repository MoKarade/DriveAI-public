/**
 * reglages-etat.test.ts — couverture R2, R3 & R4 (P0-2, P0-3, P0-4, P2-1, P2-2) :
 * rendu réel via react-dom/server de Etat.tsx (état sain, panne/erreurs, télémétrie P0-4,
 * gardes de division P2-2, Sheet vide sans chiffre inventé), Reglages.tsx (préférences et thème
 * P2-1), AujourdHui.tsx (2 sections préservées + visibilité Réorg/vides P0-3), zéro #hex hors
 * blocs :root, barre-basse à 4 colonnes et zéro emoji UI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { interpreterIndex, interpreterProgression, type LigneProgression } from '../src/etat';
import { plageMock } from '../src/mockData';
import type { DonneesEtat } from '../src/etatGlobal';

const mockEtat = vi.hoisted(() => ({
  donnees: null as DonneesEtat | null,
  progression: [] as LigneProgression[],
  erreur: '',
  synchroA: new Date('2026-07-06T14:12:00Z') as Date | null,
  rafraichir: vi.fn(async () => {}),
}));

vi.mock('../src/etatGlobal', () => ({
  useEtatGlobal: () => ({
    donnees: mockEtat.donnees,
    erreur: mockEtat.erreur,
    synchroA: mockEtat.synchroA,
    rafraichir: mockEtat.rafraichir,
  }),
  useProgressionLive: () => mockEtat.progression,
}));

import { Etat } from '../src/vues/Etat';
import { Reglages } from '../src/vues/Reglages';
import { AujourdHui } from '../src/vues/AujourdHui';

const lire = (c: string) => readFileSync(fileURLToPath(new URL(c, import.meta.url)), 'utf8');

function donneesMockCompletes(): DonneesEtat {
  return {
    index: interpreterIndex(plageMock('Index', 'A2:H')),
    santeBrut: plageMock('Santé', 'A1:A'),
    journalBrut: plageMock('Journal', 'A2:D'),
    reglagesBrut: plageMock('Réglages', 'A2:B'),
    telemetrieBrut: plageMock('Télémétrie', 'A2:D'),
    coutsBrut: plageMock('Coûts', 'A2:D'),
    reorgBrut: plageMock('Réorg', 'A2:H'),
  };
}

describe('Etat.tsx — affichage clair de l’état (P0-2, P0-4, P2-2) sans donnée inventée', () => {
  beforeEach(() => {
    mockEtat.donnees = donneesMockCompletes();
    mockEtat.progression = interpreterProgression(plageMock('Progression', 'A2:M'));
  });

  it('état sain mocké (FR & EN) : expose Compte LLM, Tri Gmail, dernière passe, erreurs 7j, file À revoir, P0-4 et sans Avancé', () => {
    const htmlFr = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));

    expect(htmlFr).not.toContain('État du moteur inconnu');
    expect(htmlFr).toContain('2026-07-06 14:12');
    expect(htmlFr).toContain('Compte LLM');
    expect(htmlFr).toContain('Actif');
    expect(htmlFr).toContain('Tri Gmail');
    expect(htmlFr).toContain('Normal');
    expect(htmlFr).toContain('Erreurs · 7 jours');
    expect(htmlFr).toContain('À revoir');
    expect(htmlFr).toContain('En cours maintenant');
    expect(htmlFr).not.toContain('Maintenance Drive');
    expect(htmlFr).toContain('Comment DriveAI classe et trie');
    expect(htmlFr).toContain('Drive — classement des documents');
    expect(htmlFr).toContain('Toute facture ou reçu payé va en 02 · Finances');
    expect(htmlFr).toContain('00 · Raccourcis, restic-pc, univers');
    expect(htmlFr).toContain('aucun mot de passe ou secret en clair');
    expect(htmlFr).toContain('Gmail — tri des courriels');
    expect(htmlFr).toContain('Appels LLM ce mois');
    expect(htmlFr).toContain('Frein campagnes');
    expect(htmlFr).toContain('Fils archivés aujourd’hui');
    expect(htmlFr).toContain('18');
    expect(htmlFr).toContain('Compteur quotidien mesuré à l’exécution du tri');
    expect(htmlFr).not.toContain('class="avance"');
    expect(htmlFr).not.toContain('Campagnes en cours');
    expect(htmlFr).not.toContain('Quota Gmail du jour');
    expect(htmlFr).not.toContain('Coûts par poste');

    // Une campagne désactivée ou terminée avec dernierePasse reste masquée de En cours maintenant
    mockEtat.progression = [
      ...mockEtat.progression,
      { cle: 'conso', operation: 'Consolidation ancienne', traites: 1, base: 10, unite: 'domaines', statut: 'désactivée', horodate: '', detail: '', derniereActivite: '', derniereErreur: '', type: 'campagne', dernierePasse: '+1 domaines · il y a 2 h', finEstimee: '' },
      { cle: 'res', operation: 'Ancienne terminée', traites: 5, base: 5, unite: 'docs', statut: 'terminé', horodate: '', detail: '', derniereActivite: '', derniereErreur: '', type: 'campagne', dernierePasse: '+5 docs · il y a 10 j', finEstimee: '' },
    ];
    const htmlFiltre = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));
    expect(htmlFiltre).not.toContain('Consolidation ancienne');
    expect(htmlFiltre).not.toContain('Ancienne terminée');
    expect(htmlFiltre).toContain('Migration taxonomie (m1)');

    // Parité EN
    const htmlEn = renderToStaticMarkup(createElement(Etat, { langue: 'en' }));
    expect(htmlEn).toContain('LLM account');
    expect(htmlEn).toContain('Gmail sorting');
    expect(htmlEn).toContain('Needs review');
    expect(htmlEn).toContain('Every invoice or paid receipt goes to 02 · Finances');
    expect(htmlEn).toContain('00 · Raccourcis, restic-pc, univers');
    expect(htmlEn).toContain('no plaintext passwords or secrets');
    expect(htmlEn).toContain('Threads archived today');
    expect(htmlEn).toContain('How DriveAI files and sorts');
    expect(htmlEn).not.toContain('Drive maintenance');
    expect(htmlEn).not.toContain('class="avance"');
  });

  it('état dégradé / panne : remonte Compte LLM en panne, Tri Gmail à l’arrêt et erreurs 7j (hors Hub)', () => {
    const d = donneesMockCompletes();
    const aujourdhuiIso = new Date().toISOString().slice(0, 19);
    d.santeBrut = [
      ['Dernier passage OK : 2026-07-06 14:12'],
      ['Compte LLM : ⛔ panne (quota API)'],
      ['Tri Gmail : ⛔ À L’ARRÊT (erreur écriture)'],
    ];
    d.journalBrut = [
      [aujourdhuiIso, 'ERREUR', 'TriGmail', 'Échec application libellé'],
      [aujourdhuiIso, 'ERREUR', 'Hub', 'MàJ résumé hub impossible'],
    ];
    mockEtat.donnees = d;

    const html = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));
    expect(html).toContain('Points d’attention');
    expect(html).toContain('En panne');
    expect(html).toContain('À l’arrêt');
    expect(html).toContain('Échec application libellé');
    expect(html).not.toContain('MàJ résumé hub impossible');
  });

  it('onglets vides ou clés P0-4 absentes : affiche — / Inconnu sans jamais inventer 0 $ ni barre factice', () => {
    mockEtat.donnees = {
      index: [],
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
      reorgBrut: undefined,
    };
    mockEtat.progression = [];

    const htmlVide = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));
    expect(htmlVide).toContain('État du moteur inconnu');
    expect(htmlVide).toContain('Inconnu');
    expect(htmlVide).toContain('—');
    expect(htmlVide).toContain('ne sont pas comptés séparément dans l’Index');
    expect(htmlVide).not.toContain('0,00');
    expect(htmlVide).not.toContain('Réorganisation à valider');

    // Télémétrie présente mais sans tri_archives_jour
    const d = donneesMockCompletes();
    d.telemetrieBrut = [
      ['quota_gmail_etat', 'actif', '', ''],
      ['llm_cout_mois', '1.25', '$', ''],
    ];
    mockEtat.donnees = d;
    const htmlSansP04 = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));
    expect(htmlSansP04).toContain('ne sont pas comptés séparément dans l’Index');
    expect(htmlSansP04).not.toContain('class="avance"');
  });

  it('non-régression BUG-4, BUG-5 & gardes P2-2 : coût 0, part négative et NaN ne produisent ni null%, ni NaN%, ni width:-', () => {
    const d = donneesMockCompletes();
    d.santeBrut = [
      ['Dernier passage OK : 2026-07-06 14:12'],
      ['Coût LLM 2026-07 : 1..2 $  (10 appels)'],
    ];
    d.telemetrieBrut = [
      ['quota_gmail_etat', 'actif', '', ''],
      ['llm_cout_mois', '0', '$', 'Frein campagnes à 10 $'],
    ];
    d.coutsBrut = [
      ['poste-negatif', '3', '0.50', '-10 %'],
    ];
    mockEtat.donnees = d;
    mockEtat.progression = [
      {
        cle: 'op-zero',
        operation: 'Opération base zéro',
        traites: 0,
        base: 0,
        unite: 'documents',
        statut: 'en cours',
        horodate: '2026-07-06T14:10:00',
        detail: '',
        derniereActivite: '',
        derniereErreur: '',
        type: 'campagne',
        dernierePasse: '',
        finEstimee: '',
      },
    ];

    const html = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));
    expect(html).not.toContain('width:null%');
    expect(html).not.toContain('width:NaN%');
    expect(html).not.toContain('width:Infinity%');
    expect(html).not.toMatch(/style="width:-\d/);
    expect(html).not.toContain('NaN');
    expect(html).toContain('style="width:0%"');
  });

  it('couverture Etat : chargement null, operationsEnDifficulte (sans hub-resume), refus réorg et dossiers bloqués', () => {
    mockEtat.donnees = null;
    mockEtat.progression = [];
    const htmlNull = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));
    expect(htmlNull).toContain('État');
    expect(htmlNull).toContain('Chargement…');

    const d = donneesMockCompletes();
    const aujourdhuiIso = new Date().toISOString().slice(0, 19);
    d.journalBrut = [
      [aujourdhuiIso, 'ERREUR', 'Hub', 'MàJ résumé hub impossible'],
    ];
    d.reorgBrut = [
      ['r1', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
      ['reorg|r1|2', 'deplacer', 'd-x', 'A', 'B', 'refusé (zone protégée)', 'protégé', '2026-07-05T12:01:00'],
      ['reorg|r1|3', 'dossier-vide', 'd-v', 'V', '', 'vide-protégé', 'protégé', '2026-07-05T12:02:00'],
    ];
    mockEtat.donnees = d;
    mockEtat.progression = [
      { cle: 'hub-resume', operation: 'Résumé hub (widget)', traites: 0, base: null, unite: '', statut: 'erreur', horodate: '', detail: '', derniereActivite: '', derniereErreur: 'No item', type: 'observabilite', dernierePasse: '', finEstimee: '' },
      { cle: 'c5', operation: 'Suspendue detail', traites: 1, base: 10, unite: 'docs', statut: 'suspendu', horodate: '', detail: 'quota interne', derniereActivite: '', derniereErreur: '06/07 12:00 — échec', type: 'campagne', dernierePasse: '', finEstimee: '' },
      { cle: 'c8', operation: 'Erreur op', traites: 3, base: 10, unite: 'docs', statut: 'erreur', horodate: '', detail: 'timeout', derniereActivite: '06/07 14:00', derniereErreur: '06/07 14:00 — timeout', type: 'campagne', dernierePasse: '', finEstimee: 'reste 7' },
    ];

    const html = renderToStaticMarkup(createElement(Etat, { langue: 'fr' }));
    expect(html).toContain('Actions réorg refusées');
    expect(html).toContain('Dossiers bloqués');
    expect(html).toContain('Total relevé');
    expect(html).toContain('Erreur op');
    expect(html).toContain('Suspendue detail');
    expect(html).not.toContain('Résumé hub (widget)');
    expect(html).not.toContain('MàJ résumé hub impossible');
  });
});

describe('Reglages.tsx — préférences (P0-2 & P2-1)', () => {
  it('rend uniquement les préférences et la bascule de thème (avec donnees === null et complètes)', () => {
    mockEtat.donnees = null;
    mockEtat.progression = [];
    const htmlNull = renderToStaticMarkup(
      createElement(Reglages, { langue: 'fr', onLangue: () => {}, onDeconnexion: () => {}, theme: 'sombre', onTheme: () => {} }),
    );
    expect(htmlNull).toContain('Chargement…');
    expect(htmlNull).toContain('Fréquence des passages');
    expect(htmlNull).toContain('Thème');
    expect(htmlNull).toContain('Sombre');
    expect(htmlNull).toContain('Clair');
    expect(htmlNull).toContain('aria-pressed="true"');
    expect(htmlNull).toContain('Se déconnecter');
    expect(htmlNull).not.toContain('État du moteur');
    expect(htmlNull).not.toContain('Coûts par poste');

    mockEtat.donnees = donneesMockCompletes();
    const htmlClairEn = renderToStaticMarkup(
      createElement(Reglages, { langue: 'en', onLangue: () => {}, onDeconnexion: () => {}, theme: 'clair', onTheme: () => {} }),
    );
    expect(htmlClairEn).toContain('Settings');
    expect(htmlClairEn).toContain('Theme');
    expect(htmlClairEn).toContain('Dark');
    expect(htmlClairEn).toContain('Light');
    expect(htmlClairEn).not.toContain('Engine status');
  });
});

describe('AujourdHui.tsx & conformité visuelle R2/R4', () => {
  beforeEach(() => {
    mockEtat.donnees = donneesMockCompletes();
    mockEtat.progression = [];
  });

  it('conserve strictement 2 <section> dans .accueil et rend le bouton Documents ›', () => {
    const html = renderToStaticMarkup(
      createElement(AujourdHui, { langue: 'fr', onAller: () => {} }),
    );
    const sections = html.match(/<section\b/g) ?? [];
    expect(sections).toHaveLength(2);
    expect(html).toContain('À faire');
    expect(html).toContain('Derniers classements');
    expect(html).toContain('aria-label="Documents ›"');
  });

  it('P0-3 : affiche les propositions Réorg et dossiers vides uniquement si > 0, sans action destructive ni 3e <section>', () => {
    const d = donneesMockCompletes();
    d.index = [];
    d.reorgBrut = [
      ['r1', 'demande', '', 'tout', '', 'exécuté', 'tout', '2026-07-05T12:00:00'],
      ['reorg|r1|1', 'deplacer', 'd-1', 'Factures', 'Finances', 'proposé', 'rangement', '2026-07-05T12:01:00'],
      ['reorg|r1|2', 'dossier-vide', 'd-2', 'Vieux dossier', '', 'vide-candidat', 'vide', '2026-07-05T12:02:00'],
    ];
    mockEtat.donnees = d;

    const htmlActif = renderToStaticMarkup(
      createElement(AujourdHui, { langue: 'fr', onAller: () => {} }),
    );
    expect(htmlActif.match(/<section\b/g) ?? []).toHaveLength(2);
    expect(htmlActif).toContain('<span class="badge">2</span>');
    expect(htmlActif).toContain('1 proposition(s) de réorganisation à valider');
    expect(htmlActif).toContain('1 dossier(s) vide(s) à traiter');
    expect(htmlActif).toContain('Voir dans Documents');
    expect(htmlActif).not.toContain('Corbeille');
    expect(htmlActif).not.toContain('Tout valider');

    // À 0 : aucune mention Réorg / dossiers vides sur Aujourd'hui
    d.reorgBrut = [];
    const htmlZero = renderToStaticMarkup(
      createElement(AujourdHui, { langue: 'fr', onAller: () => {} }),
    );
    expect(htmlZero).toContain('Rien à faire');
    expect(htmlZero).not.toContain('Voir dans Documents');
  });

  it('non-régression BUG-3 : une ligne dryrunv2|...|suspect ne fuit pas dans AujourdHui', () => {
    const d = donneesMockCompletes();
    d.reorgBrut = [];
    d.index = interpreterIndex([
      ['dryrunv2|r1|1', '2026-07-06T12:00:00', 'Fuite dryrun suspect', '', '', 'suspect', '', ''],
    ]);
    mockEtat.donnees = d;
    const html = renderToStaticMarkup(
      createElement(AujourdHui, { langue: 'fr', onAller: () => {} }),
    );
    expect(html).not.toContain('Fuite dryrun suspect');
    expect(html).toContain('Rien à faire');
    expect(html).not.toContain('<span class="badge">');
  });

  it('couverture AujourdHui : chargement null, état vide, incidentCritique LLM/TriGmail et débordements > 5', () => {
    mockEtat.donnees = null;
    expect(renderToStaticMarkup(createElement(AujourdHui, { langue: 'fr', onAller: () => {} }))).toContain('Chargement…');

    // État vide complet
    mockEtat.donnees = {
      index: [],
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    };
    const htmlVide = renderToStaticMarkup(createElement(AujourdHui, { langue: 'fr', onAller: () => {} }));
    expect(htmlVide).toContain('Rien à faire');
    expect(htmlVide).toContain('Rien de classé pour l’instant.');

    // Incidents critiques + > 5 suspects / à vérifier / importants
    const d = donneesMockCompletes();
    d.reorgBrut = [];
    const maintenantIso = new Date().toISOString().slice(0, 19);
    const lignes: string[][] = [];
    for (let i = 1; i <= 6; i++) {
      lignes.push([`tri|sus-${i}|100|0`, '2026-07-06T10:00:00', `Suspect ${i}`, '', '', 'suspect', '', '']);
      lignes.push([`drive|av-${i}`, '2026-07-06T10:00:00', `DocAVerifier_${i}.pdf`, '', '00 · À vérifier', 'à vérifier', '', '']);
      lignes.push([`important|imp-${i}`, maintenantIso, `MailImportant_${i}`, '', '', 'important', '', '']);
    }
    d.index = interpreterIndex(lignes);
    d.santeBrut = [['Compte LLM : ⛔ panne']];
    mockEtat.donnees = d;

    const htmlPanneLlm = renderToStaticMarkup(createElement(AujourdHui, { langue: 'fr', onAller: () => {} }));
    expect(htmlPanneLlm).toContain('Compte LLM : En panne');
    expect(htmlPanneLlm).toContain('+1 autres mails suspects');
    expect(htmlPanneLlm).toContain('+1 autres documents à vérifier');
    expect(htmlPanneLlm).toContain('+1 autres mails à traiter');
    expect(htmlPanneLlm).toContain('<span class="badge">18</span>');

    d.santeBrut = [['Compte LLM : actif'], ['Tri Gmail : ⛔ À L’ARRÊT']];
    const htmlArretTri = renderToStaticMarkup(createElement(AujourdHui, { langue: 'fr', onAller: () => {} }));
    expect(htmlArretTri).toContain('Tri Gmail : À l’arrêt');
  });

  it('styles.css n’a aucun #hex littéral hors blocs :root, déclare le thème clair et passe barre-basse à 4 colonnes', () => {
    const css = lire('../src/styles.css');
    const sansRoot = css.replace(/:root(?:\[data-theme="[^"]+"\])?\s*\{[\s\S]*?\n\}/g, '');
    expect(sansRoot.length, 'suppression :root trop agressive — scan vacueux').toBeGreaterThan(css.length * 0.5);
    expect(sansRoot.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css).toContain(':root[data-theme="clair"]');
    expect(css).toMatch(/nav\.barre-basse\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('aucun emoji brut dans composants/ ni vues/', () => {
    const fichiers = [
      '../src/composants/UI.tsx',
      '../src/composants/Suspects.tsx',
      '../src/composants/Omnibox.tsx',
      '../src/vues/Reorg.tsx',
      '../src/vues/Explorateur.tsx',
      '../src/vues/AujourdHui.tsx',
      '../src/vues/Copilote.tsx',
      '../src/vues/Etat.tsx',
      '../src/vues/Reglages.tsx',
    ];
    for (const f of fichiers) {
      const contenu = lire(f);
      expect(contenu, `emoji brut détecté dans ${f}`).not.toMatch(/[🗑🚫⏳⛔✅]/u);
    }
  });
});
