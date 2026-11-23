/**
 * gardes-app.test.ts — l'app ne porte plus aucun identifiant Drive (mission #497) : la racine de
 * la zone protégée et les dossiers à ID fixe lui viennent du moteur. Ce qui compte ici n'est pas
 * le cas nominal mais l'ÉCHEC FERMÉ : sans repères, aucune mutation de Drive ne doit partir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CONFIG = { spreadsheetId: 's', webappUrl: 'https://script.google.com/macros/s/X/exec', webappSecret: 'sec' };

const reponse = (corps: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corps,
} as unknown as Response);

const OK = { ok: true, racinesProtegees: ['R1'], idsStructurels: ['S1', 'S2'] };

async function charger() {
  vi.resetModules(); // le mémo de session est un état de module : un test = un module neuf
  vi.stubGlobal('fetch', vi.fn(async () => reponse(CONFIG)));
  const { chargerConfigServeur } = await import('../src/config');
  await chargerConfigServeur();
  return import('../src/google');
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('chargerGardes — repères demandés au moteur, échec fermé', () => {
  it('cas nominal : rend les repères et les mémorise (un seul appel pour la session)', async () => {
    const g = await charger();
    const faux = vi.fn(async (..._a: unknown[]) => reponse(OK));
    vi.stubGlobal('fetch', faux);
    expect(await g.chargerGardes()).toEqual({ racinesProtegees: ['R1'], idsStructurels: ['S1', 'S2'] });
    await g.chargerGardes();
    expect(faux).toHaveBeenCalledTimes(1);
    expect(String(faux.mock.calls[0][0])).toContain('action=gardes-app');
  });

  it('le moteur répond ok:false (profil non appliqué) → exception, pas de repères inventés', async () => {
    const g = await charger();
    vi.stubGlobal('fetch', vi.fn(async () => reponse({ ok: false, erreur: 'profil-prive-absent' })));
    await expect(g.chargerGardes()).rejects.toThrow(/profil-prive-absent/);
  });

  it('listes vides ou absentes malgré ok:true → exception (une zone protégée vide est une zone ouverte)', async () => {
    for (const corps of [
      { ok: true },
      { ok: true, racinesProtegees: [], idsStructurels: ['S1'] },
      { ok: true, racinesProtegees: ['R1'], idsStructurels: [] },
    ]) {
      const g = await charger();
      vi.stubGlobal('fetch', vi.fn(async () => reponse(corps)));
      await expect(g.chargerGardes()).rejects.toThrow(/Garde-fous indisponibles/);
    }
  });

  it('un échec n\'est JAMAIS mémorisé : le geste suivant retente', async () => {
    const g = await charger();
    const faux = vi.fn()
      .mockResolvedValueOnce(reponse({ ok: false, erreur: 'profil-prive-absent' }))
      .mockResolvedValue(reponse(OK));
    vi.stubGlobal('fetch', faux);
    await expect(g.chargerGardes()).rejects.toThrow();
    expect((await g.chargerGardes()).racinesProtegees).toEqual(['R1']);
  });
});
