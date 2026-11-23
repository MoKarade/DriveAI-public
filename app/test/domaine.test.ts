/**
 * domaine.test.ts — adresses publiques déduites de l'environnement (api/_domaine.ts), tâche #468.
 * Aucun domaine n'est écrit en dur : ni le code ni ces tests ne nomment le vrai.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { origineApp, origineHub } from '../../api/_domaine';

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('origineApp', () => {
  it('prend le domaine de production posé par Vercel, avec ou sans protocole', () => {
    expect(origineApp(env({ VERCEL_PROJECT_PRODUCTION_URL: 'drive.exemple.com' }))).toBe('https://drive.exemple.com');
    expect(origineApp(env({ VERCEL_PROJECT_PRODUCTION_URL: ' https://Drive.Exemple.com/ ' }))).toBe('https://drive.exemple.com');
  });

  it('rend \'\' sans variable, pour un domaine *.vercel.app ou une valeur qui n\'est pas un hôte', () => {
    expect(origineApp(env({}))).toBe('');
    expect(origineApp(env({ VERCEL_PROJECT_PRODUCTION_URL: 'projet-abc.vercel.app' }))).toBe('');
    expect(origineApp(env({ VERCEL_PROJECT_PRODUCTION_URL: 'pirate.test/chemin?x=1' }))).toBe('');
    expect(origineApp(env({ VERCEL_PROJECT_PRODUCTION_URL: 'localhost' }))).toBe('');
  });
});

describe('origineHub', () => {
  it('HUB_URL l\'emporte, sans barre finale', () => {
    expect(origineHub(env({ HUB_URL: 'https://hub.test/', VERCEL_PROJECT_PRODUCTION_URL: 'drive.exemple.com' }))).toBe('https://hub.test');
  });

  it('sinon le domaine PARENT de l\'app', () => {
    expect(origineHub(env({ VERCEL_PROJECT_PRODUCTION_URL: 'drive.exemple.com' }))).toBe('https://exemple.com');
  });

  it('échec fermé : jamais vercel.app (le jeton du hub ne part pas là), jamais un parent sans point', () => {
    expect(origineHub(env({ VERCEL_PROJECT_PRODUCTION_URL: 'projet-abc.vercel.app' }))).toBe('');
    expect(origineHub(env({ VERCEL_PROJECT_PRODUCTION_URL: 'exemple.com' }))).toBe('');
    expect(origineHub(env({}))).toBe('');
  });
});

describe('config (chargerConfigServeur / lireConfig)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('lireConfig lève avant chargement puis chargerConfigServeur met en cache avec sentryDsn optionnel', async () => {
    vi.resetModules();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('réseau coupé'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ spreadsheetId: 'feuille-1', sentryDsn: 'https://exemple.invalid/1' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { lireConfig, chargerConfigServeur } = await import('../src/config');
    expect(() => lireConfig()).toThrow(/Configuration non chargée/);
    expect(await chargerConfigServeur()).toBe(false);
    expect(await chargerConfigServeur()).toBe(false);
    expect(await chargerConfigServeur()).toBe(false);

    expect(await chargerConfigServeur()).toBe(true);
    expect(lireConfig()).toEqual({
      spreadsheetId: 'feuille-1',
      webappUrl: '',
      webappSecret: '',
      sentryDsn: 'https://exemple.invalid/1',
    });
    expect(await chargerConfigServeur()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
