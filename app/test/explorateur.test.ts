/**
 * explorateur.test.ts — logique pure de l'explorateur Drive (C21-01).
 * Les clauses `q` sont de la construction de requête sur donnée UTILISATEUR : l'échappement
 * est testé au caractère près (backslash AVANT l'apostrophe — même piège que chercherParNom).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MIME_DOSSIER,
  echapperQ,
  qEnfants,
  qRecherche,
  qSousDossiers,
  decouperEnLots,
  estDossier,
  estDossierATrier,
  trierElements,
  pousserEtape,
  couperA,
  formaterTaille,
  formaterDateCourte,
  formaterMontant,
  rechercherDansArbreMock,
  FILTRES_EXPLORATEUR,
  filtrerElementsDrive,
  resoudreArianeDansArbreMock,
  type FiltreExplorateur,
  ElementDrive,
} from '../src/explorateur';
import { ENFANTS_MOCK, plageMock } from '../src/mockData';
import { interpreterIndex, etatCourantIndex, indexParFileId } from '../src/etat';
import {
  listerEnfants,
  libelleParentEnCache,
  resoudreCheminDossier,
  tenterRestaurationSession,
  seDeconnecter,
  viderCachePlages,
} from '../src/google';
import { chargerConfigServeur } from '../src/config';

const el = (name: string, mimeType = 'application/pdf', extra: Partial<ElementDrive> = {}): ElementDrive =>
  ({ id: name, name, mimeType, ...extra });

describe('echapperQ — injection de clause fermée', () => {
  it('échappe le backslash AVANT l’apostrophe (l’ordre inverse ré-ouvre le quote)', () => {
    expect(echapperQ("l'été")).toBe("l\\'été");
    expect(echapperQ('a\\b')).toBe('a\\\\b');
    // Le cas piège : `\'` brut doit devenir `\\\'` (backslash neutralisé PUIS apostrophe échappée).
    expect(echapperQ("a\\'b")).toBe("a\\\\\\'b");
  });
});

describe('clauses q', () => {
  it('qEnfants : enfants directs, corbeille exclue', () => {
    expect(qEnfants('root')).toBe("'root' in parents and trashed = false");
  });
  it('qRecherche sans portée : nom OU plein texte', () => {
    expect(qRecherche(' facture ')).toBe(
      "(name contains 'facture' or fullText contains 'facture') and trashed = false",
    );
  });
  it('qRecherche avec portée : clause parents en OR, parenthésée', () => {
    expect(qRecherche('marqued', ['a', 'b'])).toBe(
      "(name contains 'marqued' or fullText contains 'marqued') and trashed = false and ('a' in parents or 'b' in parents)",
    );
  });
  it('qSousDossiers : ne remonte que des dossiers non corbeillés', () => {
    expect(qSousDossiers(['x'])).toBe(
      `('x' in parents) and mimeType = '${MIME_DOSSIER}' and trashed = false`,
    );
  });
});

describe('decouperEnLots', () => {
  it('découpe sans perdre ni altérer', () => {
    const src = [1, 2, 3, 4, 5];
    expect(decouperEnLots(src, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(src).toHaveLength(5); // copie, jamais de mutation
    expect(decouperEnLots([], 3)).toEqual([]);
  });

  it('non-régression BUG-8 : normalise taille <= 0, NaN, Infinity et flottants sans boucle infinie', () => {
    expect(decouperEnLots([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    expect(decouperEnLots([1, 2], -4)).toEqual([[1], [2]]);
    expect(decouperEnLots([1, 2], Number.NaN)).toEqual([[1], [2]]);
    expect(decouperEnLots([1, 2], Number.POSITIVE_INFINITY)).toEqual([[1], [2]]);
    expect(decouperEnLots([1, 2, 3, 4, 5], 2.9)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('trierElements — façon Google Drive', () => {
  it('dossiers d’abord, puis alphabétique insensible et numérique', () => {
    const tries = trierElements([
      el('zzz.pdf'),
      el('Beta', MIME_DOSSIER),
      el('alpha.pdf'),
      el('Ancien', MIME_DOSSIER),
      el('doc 10.pdf'),
      el('doc 2.pdf'),
    ]);
    expect(tries.map((e) => e.name)).toEqual(['Ancien', 'Beta', 'alpha.pdf', 'doc 2.pdf', 'doc 10.pdf', 'zzz.pdf']);
  });
  it('copie défensive', () => {
    const src = [el('b'), el('a')];
    trierElements(src);
    expect(src.map((e) => e.name)).toEqual(['b', 'a']);
  });
});

describe('fil d’Ariane', () => {
  const ariane = [{ id: 'root', nom: 'Mon Drive' }, { id: 'x', nom: '03 · Auto' }];
  it('pousserEtape ajoute en bout (copie)', () => {
    expect(pousserEtape(ariane, { id: 'y', nom: 'Marqued' })).toHaveLength(3);
    expect(ariane).toHaveLength(2);
  });
  it('couperA remonte à l’étape cliquée, id inconnu → inchangé', () => {
    expect(couperA(ariane, 'root')).toEqual([{ id: 'root', nom: 'Mon Drive' }]);
    expect(couperA(ariane, 'inconnu')).toBe(ariane);
  });
});

describe('affichage', () => {
  it('estDossier : vrai pour les dossiers Drive, faux pour les fichiers', () => {
    expect(estDossier({ mimeType: MIME_DOSSIER })).toBe(true);
    expect(estDossier({ mimeType: 'application/pdf' })).toBe(false);
  });
  it('formaterTaille : absent (fichiers Google) → « — », sinon unités lisibles', () => {
    expect(formaterTaille(undefined)).toBe('—');
    expect(formaterTaille('abc')).toBe('—');
    expect(formaterTaille('-5')).toBe('—');
    expect(formaterTaille('0')).toBe('0 o');
    expect(formaterTaille('512')).toBe('512 o');
    expect(formaterTaille('2048')).toBe('2 Ko');
    expect(formaterTaille(String(3 * 1024 * 1024))).toBe('3.0 Mo');
    expect(formaterTaille(String(1024 * 1024 * 1024))).toBe('1.0 Go');
  });
  it('formaterMontant (FR/EN) et garde non-fini BUG-5 → « — »', () => {
    expect(formaterMontant(16.42, 'fr-CA')).toMatch(/16,42\s*\$/);
    expect(formaterMontant(16.42, 'en-CA')).toBe('$16.42');
    expect(formaterMontant(Number.NaN, 'fr-CA')).toBe('—');
    expect(formaterMontant(Number.POSITIVE_INFINITY, 'fr-CA')).toBe('—');
    expect(formaterMontant(Number.NEGATIVE_INFINITY, 'en-CA')).toBe('—');
  });
  it('formaterDateCourte : ISO illisible → « — »', () => {
    expect(formaterDateCourte(undefined)).toBe('—');
    expect(formaterDateCourte('pas-une-date')).toBe('—');
    expect(formaterDateCourte('2026-07-06T12:00:00Z')).toContain('2026');
  });
});

describe('estDossierATrier (parades intake C21-02 — reconnu par NOM, accents/casse neutralisés)', () => {
  it.each([
    ['00 · À trier', true],
    ['À trier', true],
    ['a trier', true],
    ['03 · Logement & véhicule', false],
    ['_Doublons', false],
    ['Mon Drive', false],
    ['', false],
  ])('%s → %s', (nom, attendu) => {
    expect(estDossierATrier(nom)).toBe(attendu);
  });
});

describe('rechercherDansArbreMock (F1/F2 mode mock)', () => {
  const arbre = ENFANTS_MOCK as Record<string, ElementDrive[]>;

  it('ENFANTS_MOCK contient au moins 2 niveaux de sous-dossiers sous root', () => {
    const finances = arbre['dossier-finances'] ?? [];
    const bellerives = finances.find((e) => e.id === 'dossier-finances-bellerives');
    expect(bellerives).toBeDefined();
    const sousBellerives = arbre['dossier-finances-bellerives'] ?? [];
    expect(sousBellerives.some((e) => e.id === 'dossier-finances-bellerives-releves')).toBe(true);
    expect((arbre['dossier-finances-bellerives-releves'] ?? []).some((e) => e.id === 'f-003')).toBe(true);
  });

  it('requête vide ou espaces → liste vide sans troncature', () => {
    expect(rechercherDansArbreMock(arbre, '')).toEqual({ elements: [], tronque: false });
    expect(rechercherDansArbreMock(arbre, '   ', { dossierId: 'dossier-finances' })).toEqual({ elements: [], tronque: false });
  });

  it('recherche globale (sans dossierId ou root) parcourt tout l’arbre', () => {
    const r1 = rechercherDansArbreMock(arbre, 'relevé');
    expect(r1.tronque).toBe(false);
    expect(r1.elements.map((e) => e.id)).toEqual(['dossier-finances-bellerives-releves', 'f-003', 'f-002']);

    const r2 = rechercherDansArbreMock(arbre, 'facture', { dossierId: 'root' });
    expect(r2.elements.map((e) => e.id)).toEqual(['f-001']);
  });

  it('recherche scopée dans un dossier : récursive, insensible casse/accents et isolée', () => {
    const fin = rechercherDansArbreMock(arbre, 'releve', { dossierId: 'dossier-finances' });
    expect(fin.tronque).toBe(false);
    expect(fin.elements.map((e) => e.id)).toEqual(['dossier-finances-bellerives-releves', 'f-003', 'f-002']);

    const bailDansFinances = rechercherDansArbreMock(arbre, 'bail', { dossierId: 'dossier-finances' });
    expect(bailDansFinances).toEqual({ elements: [], tronque: false });

    const log = rechercherDansArbreMock(arbre, 'devis', { dossierId: 'dossier-logement' });
    expect(log.elements.map((e) => e.id)).toEqual(['f-008']);
    expect(rechercherDansArbreMock(arbre, 'hydro', { dossierId: 'dossier-logement' })).toEqual({ elements: [], tronque: false });
  });

  it('respecte maxSousDossiers et borne à 50 résultats avec tronque: true', () => {
    const borne = rechercherDansArbreMock(arbre, 'relevé', { dossierId: 'dossier-finances', maxSousDossiers: 2 });
    expect(borne.tronque).toBe(true);
    expect(borne.elements.some((e) => e.id === 'f-002')).toBe(true);

    const grosArbre: Record<string, ElementDrive[]> = {
      root: Array.from({ length: 55 }, (_, i) => ({
        id: `doc-${i}`,
        name: `Facture_${String(i).padStart(2, '0')}.pdf`,
        mimeType: 'application/pdf',
      })),
    };
    const r = rechercherDansArbreMock(grosArbre, 'facture');
    expect(r.elements).toHaveLength(50);
    expect(r.tronque).toBe(true);
  });

  it('ignore les cycles de dossiers dans l’arbre mock', () => {
    const cyclique: Record<string, ElementDrive[]> = {
      d1: [
        { id: 'd2', name: 'Sous', mimeType: MIME_DOSSIER },
        { id: 'f1', name: 'Facture_d1.pdf', mimeType: 'application/pdf' },
      ],
      d2: [
        { id: 'd1', name: 'Boucle', mimeType: MIME_DOSSIER },
        { id: 'f2', name: 'Facture_d2.pdf', mimeType: 'application/pdf' },
      ],
    };
    const r = rechercherDansArbreMock(cyclique, 'facture', { dossierId: 'd1', maxSousDossiers: 2 });
    expect(r.tronque).toBe(false);
    expect(r.elements.map((e) => e.id)).toEqual(['f1', 'f2']);
  });

  it('normalise maxSousDossiers face à NaN, Infinity et valeurs <= 0 sur une chaîne profonde', () => {
    const chaine: Record<string, ElementDrive[]> = {};
    for (let i = 0; i < 90; i++) {
      const enfants: ElementDrive[] = [
        { id: `doc-${i}`, name: `Doc_${i}.pdf`, mimeType: 'application/pdf' },
      ];
      if (i < 89) {
        enfants.push({ id: `d-${i + 1}`, name: `Dossier_${i + 1}`, mimeType: MIME_DOSSIER });
      }
      chaine[`d-${i}`] = enfants;
    }

    for (const mauvais of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = rechercherDansArbreMock(chaine, 'Doc_89', { dossierId: 'd-0', maxSousDossiers: mauvais });
      expect(r.tronque).toBe(true);
      expect(r.elements).toEqual([]);
    }

    const rZero = rechercherDansArbreMock(chaine, 'Doc_', { dossierId: 'd-0', maxSousDossiers: 0 });
    expect(rZero.tronque).toBe(true);
    expect(rZero.elements.map((e) => e.id)).toEqual(['doc-0']);
  });
});

describe('P1-1 : filtrerElementsDrive (côté client en mémoire)', () => {
  const elements: ElementDrive[] = [
    { id: 'd-1', name: '02 · Finances', mimeType: MIME_DOSSIER },
    { id: 'f-ok', name: 'ok.pdf', mimeType: 'application/pdf' },
    { id: 'f-verif', name: 'verif.pdf', mimeType: 'application/pdf' },
    { id: 'f-bas', name: 'bas.pdf', mimeType: 'application/pdf' },
    { id: 'f-seuil', name: 'seuil.pdf', mimeType: 'application/pdf' },
    { id: 'f-html', name: 'export.html', mimeType: 'text/html' },
    { id: 'd-piege', name: 'Dossier_Index_Piege', mimeType: MIME_DOSSIER },
  ];

  const parId = indexParFileId(interpreterIndex([
    ['drive|f-ok', '2026-07-06', 'ok.pdf', '02', '02', 'classé', '', '0.92'],
    ['tri33p|t1|v2|f-verif', '2026-07-06', 'verif.pdf', '', '00', 'à vérifier', '', ''],
    ['reanalyse|m2|f-bas', '2026-07-06', 'bas.pdf', '05', '05', 'classé', '', '0,45'],
    ['drive|f-seuil', '2026-07-06', 'seuil.pdf', '05', '05', 'classé', '', '0,50'],
    ['nonroute|v2|f-html', '2026-07-06', 'export.html', '', '', 'technique', '', ''],
    ['drive|d-piege', '2026-07-06', 'Dossier_Index_Piege', '', '', 'à vérifier', '', '0.10'],
  ]));

  it('couvre les 5 pilules FILTRES_EXPLORATEUR et exclut les dossiers des filtres fichier', () => {
    const ordre: readonly FiltreExplorateur[] = FILTRES_EXPLORATEUR;
    expect(ordre).toEqual(['tout', 'dossiers', 'pdf', 'a-verifier', 'confiance-basse']);

    expect(filtrerElementsDrive(elements, 'tout', parId)).toHaveLength(elements.length);
    expect(filtrerElementsDrive(elements, 'dossiers', parId).map((e) => e.id)).toEqual(['d-1', 'd-piege']);
    expect(filtrerElementsDrive(elements, 'pdf', parId).map((e) => e.id)).toEqual([
      'f-ok', 'f-verif', 'f-bas', 'f-seuil',
    ]);
    expect(filtrerElementsDrive(elements, 'a-verifier', parId).map((e) => e.id)).toEqual(['f-verif']);
    expect(filtrerElementsDrive(elements, 'confiance-basse', parId).map((e) => e.id)).toEqual(['f-bas']);
  });

  it('gère indexParId absent sans erreur et aligne mockData (00 · À trier)', () => {
    expect(filtrerElementsDrive(elements, 'a-verifier', undefined)).toEqual([]);
    expect(filtrerElementsDrive(elements, 'confiance-basse', undefined)).toEqual([]);

    const mockIndex = indexParFileId(etatCourantIndex(interpreterIndex(plageMock('Index', 'A2:H'))));
    const aTrier = (ENFANTS_MOCK['dossier-a-trier'] ?? []) as ElementDrive[];
    expect(filtrerElementsDrive(aTrier, 'pdf', mockIndex).map((e) => e.id)).toEqual(['f-100', 'f-009', 'f-010']);
    expect(filtrerElementsDrive(aTrier, 'a-verifier', mockIndex).map((e) => e.id)).toEqual(['f-010']);
    expect(filtrerElementsDrive(aTrier, 'confiance-basse', mockIndex).map((e) => e.id)).toEqual(['f-009']);
  });
});

describe('P1-2 : resoudreArianeDansArbreMock, libelleParentEnCache et resoudreCheminDossier', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('resoudreArianeDansArbreMock : reconstruit le chemin multi-niveaux, protège des cycles et gère les inconnus', () => {
    const arbre = ENFANTS_MOCK as Record<string, ElementDrive[]>;
    expect(resoudreArianeDansArbreMock(arbre, 'root')).toEqual([{ id: 'root', nom: 'Mon Drive' }]);
    expect(resoudreArianeDansArbreMock(arbre, 'dossier-finances-bellerives-releves', 'My Drive')).toEqual([
      { id: 'root', nom: 'My Drive' },
      { id: 'dossier-finances', nom: '02 · Finances' },
      { id: 'dossier-finances-bellerives', nom: 'Bellerives' },
      { id: 'dossier-finances-bellerives-releves', nom: 'Relevés' },
    ]);
    expect(resoudreArianeDansArbreMock(arbre, 'inconnu', 'Mon Drive', 'Orphelin')).toEqual([
      { id: 'root', nom: 'Mon Drive' },
      { id: 'inconnu', nom: 'Orphelin' },
    ]);

    const cyclique: Record<string, ElementDrive[]> = {
      root: [{ id: 'd1', name: 'D1', mimeType: MIME_DOSSIER }],
      d1: [{ id: 'd2', name: 'D2', mimeType: MIME_DOSSIER }],
      d2: [{ id: 'd1', name: 'D1', mimeType: MIME_DOSSIER }],
    };
    expect(resoudreArianeDansArbreMock(cyclique, 'd-absent')).toEqual([
      { id: 'root', nom: 'Mon Drive' },
      { id: 'd-absent', nom: 'd-absent' },
    ]);
  });

  it('live mode : libelleParentEnCache fait 0 requête réseau et resoudreCheminDossier réutilise le cache + dégrade proprement sur 403/cycle', async () => {
    const appels: string[] = [];
    let modeErreur403 = false;
    let modeCycle = false;

    const metaDossiers: Record<string, { id: string; name: string; mimeType: string; parents: string[] }> = {
      'd-fin': { id: 'd-fin', name: '02 · Finances', mimeType: MIME_DOSSIER, parents: ['racine-reelle'] },
      'd-bel': { id: 'd-bel', name: 'Bellerives', mimeType: MIME_DOSSIER, parents: ['d-fin'] },
      'd-rel': { id: 'd-rel', name: 'Relevés', mimeType: MIME_DOSSIER, parents: ['d-bel'] },
      'd-vide': { id: 'd-vide', name: '', mimeType: MIME_DOSSIER, parents: ['racine-reelle'] },
    };

    const rep = (status: number, corps: unknown): Response => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => corps,
      text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)),
    } as unknown as Response);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      appels.push(url);
      if (url === '/api/config') {
        return rep(200, { spreadsheetId: 's', webappUrl: 'https://x/exec', webappSecret: 'sec' });
      }
      if (url === '/api/refresh') return rep(200, { token: 'jeton' });
      if (url === '/api/logout') return rep(200, {});
      if (url.includes('/files/root?fields=id')) return rep(200, { id: 'racine-reelle' });
      if (modeErreur403 && url.includes('/files/d-403')) return rep(403, 'interdit');
      if (modeCycle) {
        if (url.includes('/files/cyc-1')) return rep(200, { id: 'cyc-1', name: 'C1', mimeType: MIME_DOSSIER, parents: ['cyc-2'] });
        if (url.includes('/files/cyc-2')) return rep(200, { id: 'cyc-2', name: 'C2', mimeType: MIME_DOSSIER, parents: ['cyc-1'] });
      }
      if (url.includes('q=') && url.includes('in+parents')) {
        return rep(200, {
          files: [
            { id: 'd-fin', name: '02 · Finances', mimeType: MIME_DOSSIER, parents: ['racine-reelle'] },
          ],
        });
      }
      const m = /\/files\/([^/?]+)/.exec(url);
      if (m && m[1] in metaDossiers) return rep(200, metaDossiers[m[1]]);
      return rep(404, 'absent');
    }));

    await chargerConfigServeur();
    seDeconnecter();
    await tenterRestaurationSession();
    viderCachePlages();
    appels.length = 0;

    // 1. Avant tout cache : libelleParentEnCache rend null (et 'Mon Drive' pour 'root') avec 0 appel réseau.
    expect(libelleParentEnCache({ parents: ['root'] })).toBe('Mon Drive');
    expect(libelleParentEnCache({ parents: ['d-fin'] })).toBeNull();
    expect(libelleParentEnCache({ parents: ['d-extra'] }, {
      nomsSupplementaires: new Map([['d-extra', 'Dossier local']]),
    })).toBe('Dossier local');
    expect(appels).toHaveLength(0);

    // 2. listerEnfants remplit passivement cacheDossiersMeta pour les dossiers confirmés.
    await listerEnfants('root');
    expect(libelleParentEnCache({ parents: ['d-fin'] })).toBe('02 · Finances');
    const appelsAvant = appels.length;
    expect(libelleParentEnCache({ parents: ['d-fin'] })).toBe('02 · Finances');
    expect(appels).toHaveLength(appelsAvant); // 0 requête supplémentaire

    // 3. resoudreCheminDossier : remonte jusqu'à racine-reelle en exploitant le cache (d-fin déjà connu).
    appels.length = 0;
    const ariane = await resoudreCheminDossier({ id: 'd-rel', name: 'Relevés', parents: ['d-bel'] });
    expect(ariane).toEqual({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'd-fin', nom: '02 · Finances' },
        { id: 'd-bel', nom: 'Bellerives' },
        { id: 'd-rel', nom: 'Relevés' },
      ],
      approximatif: false,
    });
    // Seuls /files/root?fields=id et /files/d-bel sont appelés (d-rel fourni, d-fin déjà en cache).
    expect(appels).toHaveLength(2);
    expect(libelleParentEnCache({ parents: ['racine-reelle'] })).toBe('Mon Drive');

    // 4. Second appel : 100 % servi par cacheDossiersMeta (0 appel réseau).
    appels.length = 0;
    expect(await resoudreCheminDossier({ id: 'd-rel', name: 'Relevés', parents: ['d-bel'] })).toEqual(ariane);
    expect(appels).toHaveLength(0);

    // 5. 403 sur un ancêtre → dégradation gracieuse sans lever d'exception, avec approximatif: true.
    modeErreur403 = true;
    expect(await resoudreCheminDossier({ id: 'd-feuille', name: 'Feuille', parents: ['d-403'] })).toEqual({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'd-feuille', nom: 'Feuille' },
      ],
      approximatif: true,
    });
    modeErreur403 = false;

    // 6. Cycle sur les parents → boucle bornée, approximatif: true.
    modeCycle = true;
    const arianeCycle = await resoudreCheminDossier('cyc-1', { maxProfondeur: 10 });
    expect(arianeCycle).toEqual({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'cyc-2', nom: 'C2' },
        { id: 'cyc-1', nom: 'C1' },
      ],
      approximatif: true,
    });
    modeCycle = false;

    // 7. GAP-4 : id blanc/espaces n'émet aucun appel réseau et nom vide n'empoisonne pas le cache parent.
    appels.length = 0;
    expect(await resoudreCheminDossier('   ')).toEqual({
      etapes: [{ id: 'root', nom: 'Mon Drive' }],
      approximatif: false,
    });
    expect(appels).toHaveLength(0);

    // Vérifie aussi que libelleParentEnCache n'est pas empoisonné par name: '' même si cacheDossiersMeta a été interrogé.
    const arianeVide = await resoudreCheminDossier({ id: 'd-vide', name: '', parents: ['racine-reelle'] });
    expect(arianeVide).toEqual({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'd-vide', nom: 'd-vide' },
      ],
      approximatif: false,
    });
    expect(libelleParentEnCache({ parents: ['d-vide'] })).toBeNull();
    // Et un nom vide passé sur un dossier déjà mémorisé ne l'écrase pas.
    expect((await resoudreCheminDossier({ id: 'd-rel', name: '', parents: ['d-bel'] })).etapes[3]).toEqual({
      id: 'd-rel',
      nom: 'Relevés',
    });
    expect(libelleParentEnCache({ parents: ['d-rel'] })).toBe('Relevés');

    // 8. Plafond maxProfondeur atteint avant racine → approximatif: true.
    expect(await resoudreCheminDossier({ id: 'd-rel', name: 'Relevés', parents: ['d-bel'] }, { maxProfondeur: 1 })).toEqual({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'd-rel', nom: 'Relevés' },
      ],
      approximatif: true,
    });
  });

  it('MODE_MOCK : resoudreCheminDossier, libelleParentEnCache et creerDossier fonctionnent sans aucun fetch', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_E2E_MOCK', 'true');
    const fetchEspion = vi.fn(async () => { throw new Error('réseau interdit en MODE_MOCK'); });
    vi.stubGlobal('fetch', fetchEspion);

    const googleMock = await import('../src/google');
    googleMock.viderCachePlages();

    expect(googleMock.libelleParentEnCache({ parents: ['dossier-finances-bellerives'] })).toBe('Bellerives');
    expect(await googleMock.resoudreCheminDossier('dossier-finances-bellerives-releves')).toEqual({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'dossier-finances', nom: '02 · Finances' },
        { id: 'dossier-finances-bellerives', nom: 'Bellerives' },
        { id: 'dossier-finances-bellerives-releves', nom: 'Relevés' },
      ],
      approximatif: false,
    });

    const cree = await googleMock.creerDossier('Factures 2026', 'dossier-finances');
    expect(cree.mimeType).toBe(MIME_DOSSIER);
    expect(cree.parents).toEqual(['dossier-finances']);
    const enfants = await googleMock.listerEnfants('dossier-finances');
    expect(enfants.elements.some((e) => e.id === cree.id && e.name === 'Factures 2026')).toBe(true);
    expect(await googleMock.resoudreCheminDossier(cree)).toEqual({
      etapes: [
        { id: 'root', nom: 'Mon Drive' },
        { id: 'dossier-finances', nom: '02 · Finances' },
        { id: cree.id, nom: 'Factures 2026' },
      ],
      approximatif: false,
    });
    expect(fetchEspion).not.toHaveBeenCalled();
  });
});
