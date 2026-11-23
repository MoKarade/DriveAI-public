/**
 * google-drive.test.ts — le client Google de l'app (`src/google.ts`) : session, enveloppe `api()`,
 * lectures et écritures Sheets, lectures Drive. Tout le réseau est bouchonné (`fetch`), aucun
 * appel réel. Ces chemins sont ceux que l'app garde après l'ADR-0074 (plus d'assistant, plus de
 * MCP) : ils portent l'explorateur, les corrections et la Santé.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tenterRestaurationSession, estConnecte, seDeconnecter, abonnerSessionExpiree, api,
  lirePlage, viderCachePlages, viderCachesDrive, lireProgressionLive, ecrireCellule, ecrireColonnePlage,
  ajouterLigne, lireFichier, remonterAscendance, listerEnfants, rechercherDrive, creerDossier, deplacerFichierManuel, chargerGardes,
  indexContientCle, MARQUEUR_DROITS_FICHIER, DRIVE, messageQuota,
  type OptionsRechercheDrive, type ResultatRechercheDrive,
} from '../src/google';
import { MIME_DOSSIER } from '../src/explorateur';
import { chargerConfigServeur } from '../src/config';

const CONFIG = { spreadsheetId: 'feuille', webappUrl: 'https://script.google.com/macros/s/X/exec', webappSecret: 'sec' };

type Reponse = { status: number; corps: unknown };
const rep = (status: number, corps: unknown): Response => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => corps,
  text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)),
} as unknown as Response);

/** Routeur de `fetch` : chaque appel est noté (url, options) et reçoit la réponse de `routes`. */
let appels: { url: string; options?: RequestInit }[];
let routes: (url: string, options?: RequestInit) => Reponse;
function brancherFetch(): void {
  appels = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    appels.push({ url, options });
    const r = routes(url, options);
    return rep(r.status, r.corps);
  }));
}

/** Session connectée : /api/config puis /api/refresh servis, jeton posé. */
async function connecter(): Promise<void> {
  routes = (url) => {
    if (url === '/api/config') return { status: 200, corps: CONFIG };
    if (url === '/api/refresh') return { status: 200, corps: { token: 'jeton-test' } };
    return { status: 500, corps: 'route inattendue ' + url };
  };
  await chargerConfigServeur();
  seDeconnecter();
  appels = [];
  expect(await tenterRestaurationSession()).toBe(true);
}

beforeEach(async () => {
  brancherFetch();
  await connecter();
  viderCachePlages();
  appels = [];
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('session', () => {
  it('restauration silencieuse : /api/refresh rend un jeton ⇒ connecté ; déconnexion ⇒ jeton effacé et /api/logout appelé', async () => {
    expect(estConnecte()).toBe(true);
    seDeconnecter();
    expect(estConnecte()).toBe(false);
    expect(appels.map((a) => a.url)).toContain('/api/logout');
    expect(appels.find((a) => a.url === '/api/logout')?.options?.method).toBe('POST');
  });

  it('restauration : 401 ou corps sans jeton ⇒ false, sans exception', async () => {
    seDeconnecter();
    routes = (url) => (url === '/api/refresh' ? { status: 401, corps: {} } : { status: 500, corps: '' });
    expect(await tenterRestaurationSession()).toBe(false);
    routes = (url) => (url === '/api/refresh' ? { status: 200, corps: {} } : { status: 500, corps: '' });
    expect(await tenterRestaurationSession()).toBe(false);
    expect(estConnecte()).toBe(false);
  });

  it('restauration : réseau coupé ⇒ false (traité comme « pas de session »)', async () => {
    seDeconnecter();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await tenterRestaurationSession()).toBe(false);
  });
});

describe('api() : l\'enveloppe des appels Google', () => {
  it('pose le Bearer et rend le JSON', async () => {
    routes = () => ({ status: 200, corps: { ok: 1 } });
    expect(await api<{ ok: number }>('https://www.googleapis.com/x')).toEqual({ ok: 1 });
    const h = appels[0].options?.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer jeton-test');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('401 ⇒ rafraîchissement silencieux UNE fois puis rejeu avec le jeton frais', async () => {
    let n = 0;
    routes = (url) => {
      if (url === '/api/refresh') return { status: 200, corps: { token: 'jeton-frais' } };
      n += 1;
      return n === 1 ? { status: 401, corps: '' } : { status: 200, corps: { apres: true } };
    };
    expect(await api('https://www.googleapis.com/y')).toEqual({ apres: true });
    const dernier = appels[appels.length - 1];
    expect((dernier.options?.headers as Record<string, string>).Authorization).toBe('Bearer jeton-frais');
    expect(appels.filter((a) => a.url === '/api/refresh')).toHaveLength(1);
  });

  it('401 et rafraîchissement impossible ⇒ session purgée, rappel « expirée », erreur explicite', async () => {
    const expiree = vi.fn();
    abonnerSessionExpiree(expiree);
    routes = (url) => (url === '/api/refresh' ? { status: 401, corps: {} } : { status: 401, corps: '' });
    await expect(api('https://www.googleapis.com/z')).rejects.toThrow('Session expirée');
    expect(expiree).toHaveBeenCalledTimes(1);
    expect(estConnecte()).toBe(false);
  });

  it('non connecté ⇒ refus avant tout réseau', async () => {
    seDeconnecter();
    appels = [];
    await expect(api('https://www.googleapis.com/z')).rejects.toThrow('Non connecté');
    expect(appels).toHaveLength(0);
  });

  it('403 throttle Drive ⇒ message de quota ; 403 droits sur l\'élément ⇒ marqueur canonique ; autre ⇒ code + corps', async () => {
    routes = () => ({ status: 403, corps: '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}' });
    await expect(api(`${DRIVE}/a`)).rejects.toThrow(messageQuota(`${DRIVE}/a`));
    routes = () => ({ status: 403, corps: '{"error":{"errors":[{"reason":"insufficientFilePermissions"}]}}' });
    await expect(api(`${DRIVE}/a`)).rejects.toThrow(MARQUEUR_DROITS_FICHIER);
    routes = () => ({ status: 500, corps: 'boum' });
    await expect(api(`${DRIVE}/a`)).rejects.toThrow('Google API 500 : boum');
    routes = () => ({ status: 429, corps: '' });
    await expect(api('https://sheets.googleapis.com/v4/x')).rejects.toThrow('quota par minute');
  }, 20000);
});

describe('Sheets : lectures en cache, écritures qui invalident', () => {
  it('lirePlage lit une fois puis sert le cache ; viderCachePlages(onglet) ne vide que cet onglet', async () => {
    routes = (url) => ({ status: 200, corps: { values: [[url.includes('Index') ? 'i' : 'j']] } });
    expect(await lirePlage('Index', 'A2:A')).toEqual([['i']]);
    expect(await lirePlage('Index', 'A2:A')).toEqual([['i']]);
    expect(await lirePlage('Journal', 'A2:B')).toEqual([['j']]);
    expect(appels).toHaveLength(2);
    expect(appels[0].url).toContain(`/feuille/values/${encodeURIComponent('Index!A2:A')}`);
    viderCachePlages('Index');
    await lirePlage('Index', 'A2:A');
    await lirePlage('Journal', 'A2:B');
    expect(appels).toHaveLength(3);
  });

  it('une plage sans valeurs rend [] ; lireProgressionLive contourne le cache', async () => {
    routes = () => ({ status: 200, corps: {} });
    expect(await lirePlage('Vide', 'A1:B')).toEqual([]);
    expect(await lireProgressionLive()).toEqual([]);
    expect(await lireProgressionLive()).toEqual([]);
    expect(appels).toHaveLength(3);
    expect(appels[1].url).toContain(encodeURIComponent('Progression!A2:M'));
  });

  it('ecrireCellule : PUT RAW sur la cellule, cache de l\'onglet invalidé', async () => {
    routes = () => ({ status: 200, corps: { values: [['avant']] } });
    expect(await lirePlage('Entites', 'E2:E')).toEqual([['avant']]);
    await ecrireCellule('Entites', 'E2', 'validée');
    const put = appels[1];
    expect(put.options?.method).toBe('PUT');
    expect(put.url).toContain(`${encodeURIComponent('Entites!E2')}?valueInputOption=RAW`);
    expect(JSON.parse(String(put.options?.body))).toEqual({ values: [['validée']] });
    await lirePlage('Entites', 'E2:E');
    expect(appels).toHaveLength(3); // relu après l'écriture
  });

  it('ecrireColonnePlage : rien pour une liste vide ; sinon UN PUT sur la plage contiguë', async () => {
    routes = () => ({ status: 200, corps: {} });
    await ecrireColonnePlage('Réorg', 'F', 3, []);
    expect(appels).toHaveLength(0);
    await ecrireColonnePlage('Réorg', 'F', 3, ['validé', 'écarté']);
    expect(appels).toHaveLength(1);
    expect(appels[0].url).toContain(encodeURIComponent('Réorg!F3:F4'));
    expect(JSON.parse(String(appels[0].options?.body))).toEqual({ values: [['validé'], ['écarté']] });
  });

  it('ajouterLigne : POST append RAW en fin d\'onglet', async () => {
    routes = () => ({ status: 200, corps: {} });
    await ajouterLigne('Corrections', ['a', 2]);
    expect(appels[0].options?.method).toBe('POST');
    expect(appels[0].url).toContain(`${encodeURIComponent('Corrections!A1')}:append?valueInputOption=RAW`);
    expect(JSON.parse(String(appels[0].options?.body))).toEqual({ values: [['a', 2]] });
  });

  it('indexContientCle lit la colonne OUVERTE A2:A de l\'Index', async () => {
    routes = () => ({ status: 200, corps: { values: [['drive|1'], ['gmail|2'], []] } });
    expect(await indexContientCle('gmail|2')).toBe(true);
    expect(await indexContientCle('drive|9')).toBe(false);
    expect(appels).toHaveLength(1);
    expect(appels[0].url).toContain(encodeURIComponent('Index!A2:A'));
  });
});

describe('Drive : fichiers, ascendance, listages', () => {
  const arbre: Record<string, string[]> = { f1: ['d2'], d2: ['d1'], d1: ['racine'], racine: [] };
  const routeDrive = (url: string): Reponse => {
    const m = /\/files\/([^/?]+)/.exec(url);
    if (!m) return { status: 500, corps: 'url ' + url };
    const id = m[1];
    if (!(id in arbre)) return { status: 404, corps: 'absent' };
    return { status: 200, corps: { id, name: 'n-' + id, parents: arbre[id] } };
  };

  it('lireFichier demande les champs utiles à la corbeille ; remonterAscendance remonte toute la chaîne', async () => {
    routes = routeDrive;
    const f = await lireFichier('f1');
    expect(f).toEqual({ id: 'f1', name: 'n-f1', parents: ['d2'] });
    expect(appels[0].url).toContain('ownedByMe');
    const asc = await remonterAscendance('f1');
    expect(asc.complete).toBe(true);
    expect([...asc.ids].sort()).toEqual(['d1', 'd2', 'racine']);
    // Les ascendances de DOSSIERS sont mémoïsées : une seconde remontée ne relit que le fichier.
    const avant = appels.length;
    await remonterAscendance('f1');
    expect(appels.length).toBe(avant + 1);
  });

  it('remonterAscendance : fichier illisible ⇒ vide et incomplet ; branche illisible ⇒ incomplète (échec fermé)', async () => {
    routes = routeDrive;
    expect(await remonterAscendance('inconnu')).toEqual({ ids: [], complete: false });
    routes = (url) => (url.includes('/files/dX') ? { status: 403, corps: 'non' } : { status: 200, corps: { id: 'f2', parents: ['dX'] } });
    viderCachePlages();
    const asc = await remonterAscendance('f2');
    expect(asc.complete).toBe(false);
    expect(asc.ids).toEqual(['dX']);
  });

  it('remonterAscendance : cycle simple et cycle multi-parents terminent en O(V) avec complete: false', async () => {
    // 1. Cycle simple : d1 -> ['d2'], d2 -> ['d1']
    viderCachePlages();
    appels = [];
    routes = (url) => {
      if (url.includes('/files/f-cyc1')) return { status: 200, corps: { id: 'f-cyc1', parents: ['d1'] } };
      if (url.includes('/files/d1')) return { status: 200, corps: { id: 'd1', parents: ['d2'] } };
      if (url.includes('/files/d2')) return { status: 200, corps: { id: 'd2', parents: ['d1'] } };
      return { status: 404, corps: 'absent' };
    };
    const ascSimple = await remonterAscendance('f-cyc1');
    expect(ascSimple.complete).toBe(false);
    expect([...ascSimple.ids].sort()).toEqual(['d1', 'd2']);
    expect(appels.length).toBeLessThanOrEqual(3);

    // 2. Cycle multi-parents : d1 -> ['d1', 'd2'], d2 -> ['d1', 'd2'] (sans garde, 2^profondeurMax appels)
    viderCachePlages();
    appels = [];
    routes = (url) => {
      if (url.includes('/files/f-cyc-multi')) return { status: 200, corps: { id: 'f-cyc-multi', parents: ['d1', 'd2'] } };
      if (url.includes('/files/d1')) return { status: 200, corps: { id: 'd1', parents: ['d1', 'd2'] } };
      if (url.includes('/files/d2')) return { status: 200, corps: { id: 'd2', parents: ['d1', 'd2'] } };
      return { status: 404, corps: 'absent' };
    };
    const ascMulti = await remonterAscendance('f-cyc-multi', 50);
    expect(ascMulti.complete).toBe(false);
    expect([...ascMulti.ids].sort()).toEqual(['d1', 'd2']);
    expect(appels.length).toBeLessThanOrEqual(3);
  });

  it('listerEnfants : requête bornée, cache par (dossier, page), jeton de page transmis', async () => {
    routes = (url) => ({ status: 200, corps: url.includes('pageToken=p2') ? { files: [{ id: 'b' }] } : { files: [{ id: 'a' }], nextPageToken: 'p2' } });
    const p1 = await listerEnfants('root');
    expect(p1.elements.map((e) => e.id)).toEqual(['a']);
    expect(p1.suivant).toBe('p2');
    expect(appels[0].url).toContain('pageSize=100');
    expect(appels[0].url).toContain('orderBy=folder%2Cname');
    await listerEnfants('root');
    expect(appels).toHaveLength(1);
    const p2 = await listerEnfants('root', 'p2');
    expect(p2.elements.map((e) => e.id)).toEqual(['b']);
    expect(p2.suivant).toBeUndefined();
    viderCachesDrive();
    await listerEnfants('root');
    expect(appels).toHaveLength(3);
  });

  it('rechercherDrive : une page de 50, `tronque` dit s\'il en reste', async () => {
    routes = () => ({ status: 200, corps: { files: [{ id: 'x' }], nextPageToken: 'suite' } });
    const r: ResultatRechercheDrive = await rechercherDrive('facture');
    expect(r.tronque).toBe(true);
    expect(r.elements.map((e) => e.id)).toEqual(['x']);
    expect(appels[0].url).toContain('pageSize=50');
    routes = () => ({ status: 200, corps: {} });
    expect(await rechercherDrive('rien')).toEqual({ elements: [], tronque: false });
  });

  it('rechercherDrive : requête vide/espaces ne fait aucun appel réseau et dossierId === "root" reste global', async () => {
    expect(await rechercherDrive('')).toEqual({ elements: [], tronque: false });
    expect(await rechercherDrive('   ', { dossierId: 'd1' })).toEqual({ elements: [], tronque: false });
    expect(appels).toHaveLength(0);

    routes = () => ({ status: 200, corps: { files: [{ id: 'f1', name: 'Facture.pdf', mimeType: 'application/pdf' }] } });
    const optsRoot: OptionsRechercheDrive = { dossierId: 'root' };
    const r = await rechercherDrive('facture', optsRoot);
    expect(r.elements.map((e) => e.id)).toEqual(['f1']);
    expect(appels).toHaveLength(1);
    const q = new URL(appels[0].url).searchParams.get('q') ?? '';
    expect(q).not.toContain('in parents');
  });

  it('rechercherDrive scopé : collecte BFS récursive sur 3 niveaux, tri dossiers d’abord, cache portée et invalidation', async () => {
    const sousDossiers: Record<string, string[]> = {
      d1: ['d2', 'd3'],
      d2: ['d4'],
      d3: [],
      d4: [],
    };
    routes = (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(MIME_DOSSIER)) {
        const ids: string[] = [];
        for (const parent of Object.keys(sousDossiers)) {
          if (q.includes(`'${parent}' in parents`)) ids.push(...sousDossiers[parent]);
        }
        return { status: 200, corps: { files: ids.map((id) => ({ id })) } };
      }
      return {
        status: 200,
        corps: {
          files: [
            { id: 'f1', name: 'Facture.pdf', mimeType: 'application/pdf' },
            { id: 'd-match', name: 'Factures', mimeType: MIME_DOSSIER },
          ],
        },
      };
    };

    const r1 = await rechercherDrive('facture', { dossierId: 'd1' });
    expect(r1.tronque).toBe(false);
    expect(r1.elements.map((e) => e.id)).toEqual(['d-match', 'f1']);
    const requetes1 = appels.map((a) => new URL(a.url).searchParams.get('q') ?? '');
    expect(requetes1.filter((q) => q.includes(MIME_DOSSIER))).toHaveLength(3);
    expect(requetes1[requetes1.length - 1]).toContain("'d1' in parents or 'd2' in parents or 'd3' in parents or 'd4' in parents");

    // 2ᵉ recherche dans le même dossier : cachePortee réutilisé (aucun nouvel appel qSousDossiers).
    appels = [];
    await rechercherDrive('bail', { dossierId: 'd1' });
    const requetes2 = appels.map((a) => new URL(a.url).searchParams.get('q') ?? '');
    expect(requetes2.filter((q) => q.includes(MIME_DOSSIER))).toHaveLength(0);
    expect(requetes2).toHaveLength(1);

    // viderCachesDrive() invalide cachePortee : la BFS repart.
    viderCachesDrive();
    appels = [];
    await rechercherDrive('reçu', { dossierId: 'd1' });
    const requetes3 = appels.map((a) => new URL(a.url).searchParams.get('q') ?? '');
    expect(requetes3.filter((q) => q.includes(MIME_DOSSIER))).toHaveLength(3);
  });

  it('rechercherDrive scopé : découpage en lots de 10 parents, déduplication, cycles et troncatures', async () => {
    const douze = Array.from({ length: 12 }, (_, i) => `s${String(i + 1).padStart(2, '0')}`);
    routes = (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(MIME_DOSSIER)) {
        if (q.includes("'d1' in parents")) {
          return { status: 200, corps: { files: douze.map((id) => ({ id })) } };
        }
        return { status: 200, corps: { files: [] } };
      }
      if (q.includes("'d1' in parents")) {
        return { status: 200, corps: { files: [{ id: 'f-commun', name: 'B_Commun.pdf', mimeType: 'application/pdf' }] } };
      }
      return {
        status: 200,
        corps: {
          files: [
            { id: 'f-commun', name: 'B_Commun.pdf', mimeType: 'application/pdf' },
            { id: 'f-deux', name: 'A_Deux.pdf', mimeType: 'application/pdf' },
          ],
          nextPageToken: 'suite',
        },
      };
    };

    const r = await rechercherDrive('commun', { dossierId: 'd1' });
    expect(r.tronque).toBe(true);
    expect(r.elements.map((e) => e.id)).toEqual(['f-deux', 'f-commun']);
    const qs = appels.map((a) => new URL(a.url).searchParams.get('q') ?? '');
    // Niveau 1 (d1) + Niveau 2 (12 sous-dossiers -> 2 lots de 10 + 2) = 3 appels BFS
    expect(qs.filter((q) => q.includes(MIME_DOSSIER))).toHaveLength(3);
    // 13 dossiers au total (d1 + 12) -> 2 lots de recherche (10 + 3)
    expect(qs.filter((q) => !q.includes(MIME_DOSSIER))).toHaveLength(2);

    // Cycle + doublon multi-parents ne déclenchent pas de faux tronque quand maxSousDossiers = compte unique exact.
    viderCachesDrive();
    appels = [];
    routes = (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(MIME_DOSSIER)) {
        if (q.includes("'d1' in parents")) return { status: 200, corps: { files: [{ id: 'd2' }, { id: 'd2' }, { id: 'd1' }] } };
        return { status: 200, corps: { files: [{ id: 'd1' }] } };
      }
      return { status: 200, corps: { files: [{ id: 'f-ok', name: 'Ok.pdf', mimeType: 'application/pdf' }] } };
    };
    const rCycle = await rechercherDrive('ok', { dossierId: 'd1', maxSousDossiers: 2 });
    expect(rCycle.tronque).toBe(false);

    // Plafond maxSousDossiers dépassé -> tronque: true mais recherche exécutée sur les dossiers collectés.
    viderCachesDrive();
    routes = (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(MIME_DOSSIER)) {
        return { status: 200, corps: { files: [{ id: 'd2' }, { id: 'd3' }, { id: 'd4' }, { id: 'd5' }] } };
      }
      return { status: 200, corps: { files: [{ id: 'f-cap', name: 'Cap.pdf', mimeType: 'application/pdf' }] } };
    };
    const rCap = await rechercherDrive('cap', { dossierId: 'd1', maxSousDossiers: 3 });
    expect(rCap.tronque).toBe(true);
    expect(rCap.elements.map((e) => e.id)).toEqual(['f-cap']);

    // nextPageToken sur qSousDossiers -> tronque: true.
    viderCachesDrive();
    routes = (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(MIME_DOSSIER)) return { status: 200, corps: { files: [{ id: 'd2' }], nextPageToken: 'p2' } };
      return { status: 200, corps: { files: [] } };
    };
    const rBfsPage = await rechercherDrive('x', { dossierId: 'd1' });
    expect(rBfsPage.tronque).toBe(true);

    // Échec BFS -> rejette et ne met rien en cache (le prochain appel retente la BFS).
    viderCachesDrive();
    let echecBfs = true;
    routes = (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(MIME_DOSSIER) && echecBfs) return { status: 500, corps: 'panne' };
      if (q.includes(MIME_DOSSIER)) return { status: 200, corps: { files: [] } };
      return { status: 200, corps: { files: [{ id: 'f-apres', name: 'Apres.pdf', mimeType: 'application/pdf' }] } };
    };
    await expect(rechercherDrive('apres', { dossierId: 'd1' })).rejects.toThrow('Google API 500');
    echecBfs = false;
    const rReprise = await rechercherDrive('apres', { dossierId: 'd1' });
    expect(rReprise.elements.map((e) => e.id)).toEqual(['f-apres']);
  });

  it('rechercherDrive scopé : lot exact de 100 sous-dossiers sans nextPageToken ni troncature, et garde NaN/Infinity sur maxSousDossiers', async () => {
    const cent = Array.from({ length: 100 }, (_, i) => ({ id: `k${i}` }));
    routes = (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(MIME_DOSSIER)) {
        if (q.includes("'big' in parents")) return { status: 200, corps: { files: cent } };
        if (q.includes("'k0' in parents")) return { status: 200, corps: { files: [{ id: 'petit-enfant' }] } };
        return { status: 200, corps: { files: [] } };
      }
      if (q.includes("'petit-enfant' in parents")) {
        return { status: 200, corps: { files: [{ id: 'f-petit', name: 'PetitEnfant.pdf', mimeType: 'application/pdf' }] } };
      }
      return { status: 200, corps: { files: [] } };
    };
    const rCent = await rechercherDrive('petit', { dossierId: 'big', maxSousDossiers: 200 });
    expect(rCent.tronque).toBe(false);
    expect(rCent.elements.map((e) => e.id)).toEqual(['f-petit']);

    // NaN et Infinity sur maxSousDossiers doivent retomber au plafond sûr par défaut (80) sans boucle infinie.
    for (const mauvais of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      viderCachesDrive();
      let appelsBfs = 0;
      routes = (url) => {
        const q = new URL(url).searchParams.get('q') ?? '';
        if (q.includes(MIME_DOSSIER)) {
          appelsBfs++;
          const m = /'d-(\d+)' in parents/.exec(q);
          const idx = m ? Number(m[1]) : 0;
          if (idx < 95) return { status: 200, corps: { files: [{ id: `d-${idx + 1}` }] } };
          return { status: 200, corps: { files: [] } };
        }
        return { status: 200, corps: { files: [] } };
      };
      const rBorne = await rechercherDrive('test', { dossierId: 'd-0', maxSousDossiers: mauvais });
      expect(rBorne.tronque).toBe(true);
      expect(appelsBfs).toBeLessThanOrEqual(80);
    }
  });

  it('creerDossier : nom vide refusé sans réseau ; sinon POST d\'un dossier sous le parent, listages invalidés', async () => {
    await expect(creerDossier('   ', 'p')).rejects.toThrow('Nom de dossier vide');
    expect(appels).toHaveLength(0);
    routes = () => ({ status: 200, corps: { id: 'nouveau', name: 'Garage' } });
    const d = await creerDossier(' Garage ', 'parent1');
    expect(d.id).toBe('nouveau');
    expect(appels[0].options?.method).toBe('POST');
    expect(JSON.parse(String(appels[0].options?.body))).toEqual({
      name: 'Garage', mimeType: 'application/vnd.google-apps.folder', parents: ['parent1'],
    });
  });
});

describe('deplacerFichierManuel & garde-fous Drive (Tier 5)', () => {
  const GARDES = ['dossier-immigration'];
  const attendreTraces = () => new Promise((r) => setTimeout(r, 15));
  const estGardesApp = (url: string) => url.includes('gardes-app');
  const repGardesOk: Reponse = { status: 200, corps: { ok: true, racinesProtegees: GARDES, idsStructurels: ['s1'] } };

  it('chargerGardes : échec fermé si ok:false ou listes vides, puis reprend sur appel suivant', async () => {
    routes = () => ({ status: 200, corps: { ok: false, erreur: 'profil absent' } });
    await expect(chargerGardes()).rejects.toThrow('Garde-fous indisponibles (profil absent)');

    routes = () => ({ status: 200, corps: { ok: true, racinesProtegees: [], idsStructurels: ['s1'] } });
    await expect(chargerGardes()).rejects.toThrow('repères manquants');

    routes = () => repGardesOk;
    expect(await chargerGardes()).toEqual({ racinesProtegees: GARDES, idsStructurels: ['s1'] });
  });

  it('refuse le déplacement d’un dossier ou d’une racine protégée sans muter Drive', async () => {
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/dos-1')) return { status: 200, corps: { id: 'dos-1', name: 'Finances', mimeType: MIME_DOSSIER, parents: ['root-id'] } };
      if (url.includes('/files/dossier-immigration')) return { status: 200, corps: { id: 'dossier-immigration', name: 'Doc.pdf', mimeType: 'application/pdf', parents: ['root-id'] } };
      return { status: 200, corps: {} };
    };
    await expect(deplacerFichierManuel({ fileId: 'dos-1', nouveauParent: 'cible', racinesProtegees: GARDES }))
      .rejects.toThrow('seuls les FICHIERS');
    await expect(deplacerFichierManuel({ fileId: 'dossier-immigration', nouveauParent: 'cible', racinesProtegees: GARDES }))
      .rejects.toThrow('seuls les FICHIERS');
    expect(appels.filter((a) => a.options?.method === 'PATCH')).toHaveLength(0);
  });

  it('refuse la zone protégée (04 · Immigration) et l’ascendance illisible (échec fermé)', async () => {
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/f-imm')) return { status: 200, corps: { id: 'f-imm', name: 'Passeport.pdf', mimeType: 'application/pdf', parents: ['sous-imm'] } };
      if (url.includes('/files/sous-imm')) return { status: 200, corps: { parents: ['dossier-immigration'] } };
      if (url.includes('/files/dossier-immigration')) return { status: 200, corps: { parents: [] } };
      return { status: 500, corps: 'inattendu' };
    };
    await expect(deplacerFichierManuel({ fileId: 'f-imm', nouveauParent: 'cible', racinesProtegees: GARDES }))
      .rejects.toThrow('zone-protegee');

    viderCachePlages();
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/f-illisible')) return { status: 200, corps: { id: 'f-illisible', name: 'Scan.pdf', mimeType: 'application/pdf', parents: ['parent-403'] } };
      if (url.includes('/files/parent-403')) return { status: 403, corps: 'interdit' };
      return { status: 500, corps: 'inattendu' };
    };
    await expect(deplacerFichierManuel({ fileId: 'f-illisible', nouveauParent: 'cible', racinesProtegees: GARDES }))
      .rejects.toThrow('zone-protegee');
    expect(appels.filter((a) => a.options?.method === 'PATCH')).toHaveLength(0);
  });

  it('refuse le redépôt dans « 00 · À trier » d’un fichier déjà indexé, mais autorise s’il ne l’est pas (sans écrire statut manuel)', async () => {
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/f-deja')) return { status: 200, corps: { id: 'f-deja', name: 'Facture.pdf', mimeType: 'application/pdf', parents: ['d-src'] } };
      if (url.includes('/files/d-src')) return { status: 200, corps: { parents: [] } };
      if (url.includes('Index!A2%3AA') || url.includes(encodeURIComponent('Index!A2:A'))) {
        return { status: 200, corps: { values: [['drive|f-deja']] } };
      }
      return { status: 200, corps: {} };
    };
    await expect(deplacerFichierManuel({
      fileId: 'f-deja', nouveauParent: 'd-atrier', nomCible: '00 · À trier', racinesProtegees: GARDES,
    })).rejects.toThrow('Déjà traité par DriveAI');
    expect(appels.filter((a) => a.options?.method === 'PATCH')).toHaveLength(0);

    // Non encore indexé vers 00 · À trier : PATCH exécuté, Journal écrit, PAS de ligne Index `manuel`.
    viderCachePlages();
    appels = [];
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/f-neuf')) return { status: 200, corps: { id: 'f-neuf', name: 'Neuf.pdf', mimeType: 'application/pdf', parents: ['d-src'] } };
      if (url.includes('/files/d-src')) return { status: 200, corps: { parents: [] } };
      if (url.includes(encodeURIComponent('Index!A2:A'))) return { status: 200, corps: { values: [] } };
      return { status: 200, corps: {} };
    };
    expect(await deplacerFichierManuel({
      fileId: 'f-neuf', nouveauParent: 'd-atrier', nomCible: '00 · À trier', racinesProtegees: GARDES,
    })).toBe(true);
    await attendreTraces();
    expect(appels.some((a) => a.options?.method === 'PATCH')).toBe(true);
    expect(appels.some((a) => a.url.includes(encodeURIComponent('Journal!A1')))).toBe(true);
    expect(appels.some((a) => a.url.includes(encodeURIComponent('Index!A1')))).toBe(false);
  });

  it('résout l’alias root, détecte le no-op déjà en place, et nettoie les multi-parents + traces Index/Journal (repli et en-têtes dynamiques)', async () => {
    // 1. Repli ORDRE_DEFAUT quand Index!A1:H1 échoue, plus résolution root & no-op.
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/root?fields=id')) return { status: 200, corps: { id: 'racine-reelle' } };
      if (url.includes('/files/f-enplace')) return { status: 200, corps: { id: 'f-enplace', name: 'Ok.pdf', mimeType: 'application/pdf', parents: ['racine-reelle'] } };
      if (url.includes('/files/racine-reelle')) return { status: 200, corps: { parents: [] } };
      if (url.includes(encodeURIComponent('Index!A2:A'))) return { status: 200, corps: { values: [] } };
      return { status: 200, corps: {} };
    };
    expect(await deplacerFichierManuel({ fileId: 'f-enplace', nouveauParent: 'root', racinesProtegees: GARDES })).toBe(false);
    expect(appels.filter((a) => a.options?.method === 'PATCH')).toHaveLength(0);

    // 2. Déplacement multi-parents avec Index!A1:H1 vide → repli ORDRE_DEFAUT, puis en-têtes dynamiques.
    viderCachePlages();
    appels = [];
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/f-multi')) return { status: 200, corps: { id: 'f-multi', name: 'Multi.pdf', mimeType: 'application/pdf', parents: ['racine-reelle', 'ancien-2'] } };
      if (url.includes('/files/ancien-2')) return { status: 200, corps: { parents: [] } };
      if (url.includes(encodeURIComponent('Index!A2:A'))) return { status: 200, corps: { values: [] } };
      if (url.includes(encodeURIComponent('Index!A1:H1'))) return { status: 500, corps: 'illisible' };
      return { status: 200, corps: {} };
    };
    expect(await deplacerFichierManuel({ fileId: 'f-multi', nouveauParent: 'root', racinesProtegees: GARDES })).toBe(true);
    await attendreTraces();
    // root déjà mémorisé : aucun second appel /files/root.
    expect(appels.filter((a) => a.url.includes('/files/root?fields=id'))).toHaveLength(0);
    const patch = appels.find((a) => a.options?.method === 'PATCH');
    expect(patch?.url).toContain('removeParents=ancien-2');
    expect(patch?.url).not.toContain('addParents=');
    const appendIndex1 = appels.find((a) => a.url.includes(encodeURIComponent('Index!A1')) && a.options?.method === 'POST');
    expect(appendIndex1).toBeDefined();
    const ligneDefaut = JSON.parse(String(appendIndex1?.options?.body)).values[0] as string[];
    expect(ligneDefaut[0]).toBe('drive|f-multi');
    expect(ligneDefaut[2]).toBe('Multi.pdf');
    expect(ligneDefaut[5]).toBe('manuel');

    // 3. En-têtes dynamiques lus dans Index!A1:H1 et mémoïsés pour les déplacements suivants.
    viderCachePlages();
    appels = [];
    routes = (url) => {
      if (estGardesApp(url)) return repGardesOk;
      if (url.includes('/files/f-dyn')) return { status: 200, corps: { id: 'f-dyn', name: 'Dyn.pdf', mimeType: 'application/pdf', parents: ['ancien-1'] } };
      if (url.includes('/files/ancien-1')) return { status: 200, corps: { parents: [] } };
      if (url.includes(encodeURIComponent('Index!A2:A'))) return { status: 200, corps: { values: [] } };
      if (url.includes(encodeURIComponent('Index!A1:H1'))) return { status: 200, corps: { values: [['Statut', 'Fichier', 'Clé', 'Traité le']] } };
      return { status: 200, corps: {} };
    };
    expect(await deplacerFichierManuel({ fileId: 'f-dyn', nouveauParent: 'cible-d', racinesProtegees: GARDES })).toBe(true);
    await attendreTraces();
    const appendIndexDyn = appels.find((a) => a.url.includes(encodeURIComponent('Index!A1')) && a.options?.method === 'POST');
    const ligneDyn = JSON.parse(String(appendIndexDyn?.options?.body)).values[0] as string[];
    expect(ligneDyn[0]).toBe('manuel');
    expect(ligneDyn[1]).toBe('Dyn.pdf');
    expect(ligneDyn[2]).toBe('drive|f-dyn');
    expect(ligneDyn[3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
