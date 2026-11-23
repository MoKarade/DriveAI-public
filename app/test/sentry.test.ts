/**
 * sentry.test.ts — verrou de la remontée d'erreurs (tâche #495).
 *
 * Trois promesses : (1) sans DSN valide rien ne part et rien ne change, (2) même avec un DSN aucune
 * donnée personnelle ne part (message réduit, aucun champ de requête ni d'utilisateur), (3) un
 * échec d'envoi ne casse jamais l'appelant. Le côté serveur (api/_sentry.ts, sans paquet npm) et le
 * côté navigateur (src/sentry.ts) doivent produire le MÊME événement.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as serveur from '../../api/_sentry';
import * as navigateur from '../src/sentry';

const DSN = 'https://cle-publique@o123.ingest.exemple.test/4567';
const lire = (chemin: string): string => readFileSync(resolve(__dirname, chemin), 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  navigateur.reinitialiserSentryPourTest();
});

// Les deux copies doivent se comporter pareil : on déroule les mêmes cas sur chacune.
const COPIES = [
  ['api/_sentry.ts (serveur)', serveur],
  ['src/sentry.ts (navigateur)', navigateur],
] as const;

describe.each(COPIES)('%s — DSN, message, pile', (_nom, m) => {
  it('lireDsn : https + clé + projet numérique, sinon éteint', () => {
    expect(m.lireDsn(DSN)?.urlEnveloppe).toBe(
      'https://o123.ingest.exemple.test/api/4567/envelope/?sentry_version=7&sentry_key=cle-publique&sentry_client=driveai-sans-sdk%2F1',
    );
    expect(m.lireDsn('https://cle@exemple.test/prefixe/9')?.urlEnveloppe).toContain('https://exemple.test/prefixe/api/9/envelope/');
    for (const mauvais of [undefined, '', '   ', 'pas une url', 'http://cle@exemple.test/1', 'https://exemple.test/1',
      'https://cle@exemple.test/', 'https://cle@exemple.test/abc']) {
      expect(m.lireDsn(mauvais), String(mauvais)).toBeNull();
    }
  });

  it('messagePublic : coupe au premier « : » (le corps d\'une réponse Google ne part pas)', () => {
    expect(m.messagePublic(new Error('Google API 403 : droits-fichier : {"error":{"message":"File Document-Fictif-A.pdf"}}')))
      .toBe('Google API 403');
    expect(m.messagePublic('Déplacement refusé (garde-fous) : Dossier Immigration 2026')).toBe('Déplacement refusé (garde-fous)');
  });

  it('messagePublic : masque adresses, URL, identifiants Drive et textes entre guillemets', () => {
    expect(m.messagePublic('Échec pour prenom.nom@exemple.test')).toBe('Échec pour [courriel]');
    expect(m.messagePublic('Appel vers https://exemple.test/page?jeton=abc impossible')).toBe('Appel vers [url] impossible');
    expect(m.messagePublic(`Dossier ${'A1'.repeat(17)} introuvable`)).toBe('Dossier [id] introuvable');
    expect(m.messagePublic('Fichier "Relevé de banque mars.pdf" illisible')).toBe('Fichier "…" illisible');
  });

  it('messagePublic : garde un nom de variable du code et les apostrophes françaises', () => {
    expect(m.messagePublic("Cannot read properties of undefined (reading 'items')")).toBe("Cannot read properties of undefined (reading 'items')");
    expect(m.messagePublic("Web app injoignable, c'est le déploiement qu'il faut revoir")).toBe("Web app injoignable, c'est le déploiement qu'il faut revoir");
  });

  it('messagePublic : borné à 120 caractères ; une valeur qui n\'est pas une erreur donne vide', () => {
    expect(m.messagePublic('mot '.repeat(200))).toHaveLength(120);
    expect(m.messagePublic(undefined)).toBe('');
    expect(m.messagePublic({ message: 'objet quelconque' })).toBe('');
  });

  it('trames : pile V8 → trames, la plus ancienne d\'abord, requête retirée du fichier', () => {
    const pile = [
      'Error: boum',
      '    at fonctionB (/var/task/api/b.js:10:5)',
      '    at https://exemple.test/assets/app.js?v=1:20:7',
      'ligne inconnue',
    ].join('\n');
    expect(m.trames(pile)).toEqual([
      { filename: 'https://exemple.test/assets/app.js', lineno: 20, colno: 7 },
      { filename: '/var/task/api/b.js', function: 'fonctionB', lineno: 10, colno: 5 },
    ]);
    expect(m.trames(undefined)).toEqual([]);
  });

  it('construireEvenement : UNIQUEMENT les champs prévus, jamais de requête, utilisateur ni contexte', () => {
    const erreur = new TypeError('Google API 500 : corps avec Relevé-banque-perso.pdf');
    const evenement = m.construireEvenement(erreur, { source: 'essai', environnement: 'test', identifiant: 'a'.repeat(32), maintenantMs: 1_700_000_000_000 });
    expect(Object.keys(evenement).sort()).toEqual(
      ['environment', 'event_id', 'exception', 'level', 'platform', 'tags', 'timestamp']);
    const brut = JSON.stringify(evenement);
    for (const interdit of ['request', 'user', 'breadcrumbs', 'contexts', 'extra', 'server_name', 'ip_address', 'cookies', 'headers']) {
      expect(brut, interdit).not.toContain(`"${interdit}"`);
    }
    expect(brut).not.toContain('Relevé');
    expect((evenement.exception as { values: { type: string; value: string }[] }).values[0]).toMatchObject({
      type: 'TypeError', value: 'Google API 500',
    });
    expect(evenement.timestamp).toBe(1_700_000_000);
  });

  it('construireEvenement : un nom d\'erreur douteux devient « Error »', () => {
    const erreur = new Error('x');
    erreur.name = 'Passeport de Marc <script>';
    const v = (m.construireEvenement(erreur, { source: 's', environnement: 'e' }).exception as { values: { type: string }[] }).values[0];
    expect(v?.type).toBe('Error');
  });

  it('construireEnveloppe : trois lignes JSON (en-tête, type, événement), sans DSN ni clé', () => {
    const evenement = m.construireEvenement(new Error('x'), { source: 's', environnement: 'e', identifiant: 'b'.repeat(32) });
    const lignes = m.construireEnveloppe(evenement, 1_700_000_000_000).split('\n');
    expect(lignes).toHaveLength(3);
    expect(JSON.parse(lignes[0] ?? '')).toEqual({ event_id: 'b'.repeat(32), sent_at: '2023-11-14T22:13:20.000Z' });
    expect(JSON.parse(lignes[1] ?? '')).toEqual({ type: 'event' });
    expect(JSON.parse(lignes[2] ?? '')).toEqual(evenement);
    expect(lignes.join('\n')).not.toContain('cle-publique');
  });
});

describe('parité serveur / navigateur', () => {
  it('le même événement, à la plateforme près', () => {
    const erreur = new RangeError("Fichier \"Contrat bail.pdf\" refusé par marc@exemple.test : détail");
    const commun = { source: 'parite', environnement: 'test', identifiant: 'c'.repeat(32), maintenantMs: 1_700_000_000_000 };
    const a = serveur.construireEvenement(erreur, { ...commun, plateforme: 'node' });
    const b = navigateur.construireEvenement(erreur, commun);
    expect({ ...a, platform: 'x' }).toEqual({ ...b, platform: 'x' });
    expect(a.platform).toBe('node');
    expect(b.platform).toBe('javascript');
    expect(serveur.messagePublic(erreur)).toBe(navigateur.messagePublic(erreur));
    expect(serveur.lireDsn(DSN)).toEqual(navigateur.lireDsn(DSN));
  });
});

describe('serveur — envoi', () => {
  const options = { source: 'essai', environnement: 'test', plateforme: 'node' as const };

  it('sans DSN valide : aucun appel réseau', async () => {
    const faux = vi.fn();
    for (const dsn of [undefined, '', 'http://cle@exemple.test/1']) {
      const r = await serveur.envoyerErreur(dsn, new Error('x'), { ...options, fetchImpl: faux as unknown as typeof fetch });
      expect(r).toEqual({ livre: false, id: '' });
    }
    expect(faux).not.toHaveBeenCalled();
  });

  it('2xx → livré, enveloppe postée sur l\'URL du DSN avec l\'identifiant rendu', async () => {
    const faux = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    const r = await serveur.envoyerErreur(DSN, new Error('boum'), { ...options, fetchImpl: faux as unknown as typeof fetch });
    expect(r.livre).toBe(true);
    expect(r.statut).toBe(200);
    expect(r.id).toMatch(/^[0-9a-f]{32}$/);
    const [url, init] = faux.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(serveur.lireDsn(DSN)?.urlEnveloppe);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain(r.id);
  });

  it('refus de Sentry (429) ou réseau coupé → non livré, JAMAIS d\'exception', async () => {
    const refus = vi.fn(async () => new Response('', { status: 429 }));
    expect((await serveur.envoyerErreur(DSN, new Error('x'), { ...options, fetchImpl: refus as unknown as typeof fetch })).livre).toBe(false);
    const coupe = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const r = await serveur.envoyerErreur(DSN, new Error('x'), { ...options, fetchImpl: coupe as unknown as typeof fetch });
    expect(r.livre).toBe(false);
    expect(r.statut).toBeUndefined();
  });

  it('signalerErreurServeur : sans SENTRY_DSN, rien ne part ; avec, une requête, étiquetée par source', async () => {
    const faux = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', faux);
    vi.stubEnv('SENTRY_DSN', '');
    await serveur.signalerErreurServeur('hub-summary', new Error('x'));
    expect(faux).not.toHaveBeenCalled();

    vi.stubEnv('SENTRY_DSN', DSN);
    vi.stubEnv('VERCEL_ENV', 'production');
    await serveur.signalerErreurServeur('hub-summary', new Error('Moteur en panne : détail'));
    expect(faux).toHaveBeenCalledTimes(1);
    const corps = String((faux.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(corps).toContain('"source":"hub-summary"');
    expect(corps).toContain('"environment":"production"');
    expect(corps).not.toContain('détail');
  });

  it('signalerErreurServeur : un échec d\'envoi n\'écrit que le code HTTP, jamais le DSN, et ne lève pas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    vi.stubEnv('SENTRY_DSN', DSN);
    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(serveur.signalerErreurServeur('acces-hub', new Error('x'))).resolves.toBeUndefined();
    expect(journal).toHaveBeenCalledTimes(1);
    expect(String(journal.mock.calls[0]?.[0])).toContain('403');
    expect(String(journal.mock.calls[0]?.[0])).not.toContain('cle-publique');
    journal.mockRestore();
  });
});

describe('navigateur — rapporteur', () => {
  it('sans DSN : rien ne part', async () => {
    const faux = vi.fn();
    const signaler = navigateur.creerRapporteur(undefined, { fetchImpl: faux as unknown as typeof fetch });
    expect(await signaler(new Error('x'))).toBe(false);
    expect(faux).not.toHaveBeenCalled();
  });

  it('une même erreur n\'est envoyée qu\'une fois, et au plus 5 événements par page', async () => {
    const faux = vi.fn(async () => new Response('{}', { status: 200 }));
    const signaler = navigateur.creerRapporteur(DSN, { fetchImpl: faux as unknown as typeof fetch });
    expect(await signaler(new Error('pareil'))).toBe(true);
    expect(await signaler(new Error('pareil'))).toBe(false);
    for (let i = 0; i < 10; i += 1) await signaler(new Error(`différent ${i}`));
    expect(faux).toHaveBeenCalledTimes(navigateur.MAX_EVENEMENTS_PAR_PAGE);
  });

  it('envoie un événement « navigateur » sans donnée personnelle ; un échec réseau ne lève pas', async () => {
    const faux = vi.fn(async () => new Response('{}', { status: 200 }));
    const signaler = navigateur.creerRapporteur(DSN, { fetchImpl: faux as unknown as typeof fetch, environnement: 'production' });
    await signaler(new Error('Google API 403 : Relevé-perso.pdf'));
    const corps = String((faux.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(corps).toContain('"source":"navigateur"');
    expect(corps).not.toContain('Relevé');

    const coupe = navigateur.creerRapporteur(DSN, { fetchImpl: (async () => { throw new Error('hors ligne'); }) as unknown as typeof fetch });
    await expect(coupe(new Error('autre'))).resolves.toBe(false);
  });

  it('brancherSentry : inactif sans DSN, sinon deux écouteurs, une seule fois', () => {
    const cible = { addEventListener: vi.fn() };
    expect(navigateur.brancherSentry(undefined, cible as never)).toBe(false);
    expect(cible.addEventListener).not.toHaveBeenCalled();

    expect(navigateur.brancherSentry(DSN, cible as never)).toBe(true);
    expect(cible.addEventListener.mock.calls.map((c) => c[0])).toEqual(['error', 'unhandledrejection']);
    expect(navigateur.brancherSentry(DSN, cible as never)).toBe(false);
    expect(cible.addEventListener).toHaveBeenCalledTimes(2);
  });

  it('les écouteurs signalent l\'erreur de la page et le rejet non traité', async () => {
    const faux = vi.fn(async () => new Response('{}', { status: 200 }));
    const ecouteurs: Record<string, (e: unknown) => void> = {};
    const cible = { addEventListener: (type: string, f: (e: unknown) => void) => { ecouteurs[type] = f; } };
    navigateur.brancherSentry(DSN, cible as never, { fetchImpl: faux as unknown as typeof fetch });
    ecouteurs.error?.({ error: new Error('de la page') });
    ecouteurs.unhandledrejection?.({ reason: new Error('rejet') });
    await vi.waitFor(() => expect(faux).toHaveBeenCalledTimes(2));
  });
});

describe('branchement', () => {
  it('le serveur signale le canal moteur et l\'accès au hub, via signalerErreurServeur', () => {
    expect(lire('../../api/hub/summary.ts')).toContain("signalerErreurServeur('hub-summary', err)");
    expect(lire('../../api/_accesHub.ts')).toContain("signalerErreurServeur('acces-hub', erreur)");
  });

  it('l\'app branche Sentry avec le DSN de /api/config, jamais avec une variable de build', () => {
    expect(lire('../src/App.tsx')).toContain('brancherSentry(lireConfig().sentryDsn)');
    expect(lire('../src/sentry.ts')).not.toMatch(/import\.meta\.env/);
  });

  it('aucun fichier n\'envoie de donnée personnelle par défaut ni n\'importe un SDK Sentry', () => {
    for (const chemin of ['../../api/_sentry.ts', '../src/sentry.ts']) {
      const texte = lire(chemin);
      expect(texte, chemin).not.toMatch(/from\s+['"]@sentry\//);
      expect(texte, chemin).not.toMatch(/sendDefaultPii|user\s*:|ip_address|breadcrumbs\s*:/);
    }
  });
});
