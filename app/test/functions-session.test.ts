/**
 * functions-session.test.ts — les fonctions de session Firebase (`functions/src`, ADR-0078), à leur point
 * d'application réel : les handlers, avec un faux Google (aucun réseau) et le chiffrement RÉEL.
 * Verrous : le cookie est UN SEUL, nommé `__session` (Hosting arrache les autres) ; le verrou d'identité tient au
 * callback ET à chaque refresh/config ; un anonyme n'apprend rien ; l'état de connexion n'est jamais une session.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { callback, config, login, logout, refresh, sante, type Echange } from '../../functions/src/handlers';
import {
  COOKIE_SESSION, chiffrer, dechiffrer, encoderEtat, encoderSession, lireEtat, lireSession, type Config,
} from '../../functions/src/lib';

const CFG: Config = {
  clientId: 'id-test', clientSecret: 'secret-test', cookieSecret: 'cookie-secret-test',
  emailAutorise: 'Marc.Exemple@Gmail.com', spreadsheetId: 'feuille-fictive', webappUrl: 'https://exemple.test/exec',
  webappSecret: 'secret-webapp-fictif', sentryDsn: '',
};

interface Res extends ServerResponse { entetes: Record<string, unknown>; corps: string }

function faux(): Res {
  const entetes: Record<string, unknown> = {};
  const res = {
    statusCode: 0, entetes, corps: '',
    setHeader(n: string, v: unknown) { entetes[n] = v; },
    end(c?: string) { res.corps = c ?? ''; },
  };
  return res as unknown as Res;
}

function req(url: string, cookie?: string, methode = 'GET'): IncomingMessage {
  return {
    url, method: methode,
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'driveai.test', ...(cookie ? { cookie } : {}) },
  } as unknown as IncomingMessage;
}

const cookieDe = (clair: string) => `${COOKIE_SESSION}=${encodeURIComponent(chiffrer(clair, CFG.cookieSecret))}`;
const sessionDe = (email: string, rt = 'rt-google') => cookieDe(encoderSession({ rt, email }));
const idToken = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.y`;
const poseDans = (res: Res) => String(res.entetes['Set-Cookie'] ?? '');
const valeurPosee = (res: Res) => decodeURIComponent(poseDans(res).split(';')[0].split('=').slice(1).join('='));

function google(partiel: Partial<Echange> = {}): Echange {
  return {
    echangerCode: vi.fn().mockResolvedValue({}),
    rafraichir: vi.fn().mockResolvedValue({ access_token: 'acces-frais', expires_in: 3000 }),
    ...partiel,
  };
}

describe('login', () => {
  it('pose UN cookie __session chiffré (état, 10 min, HttpOnly, Secure, Lax) et envoie le même état à Google', () => {
    const res = faux();
    login(req('/api/login'), res, CFG);
    const vers = new URL(String(res.entetes.Location));
    expect(vers.hostname).toBe('accounts.google.com');
    expect(vers.searchParams.get('redirect_uri')).toBe('https://driveai.test/api/callback');
    expect(vers.searchParams.get('access_type')).toBe('offline');
    const pose = poseDans(res);
    expect(pose.startsWith(`${COOKIE_SESSION}=`)).toBe(true);
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600']) expect(pose).toContain(a);
    expect(lireEtat(dechiffrer(valeurPosee(res), CFG.cookieSecret)!)).toBe(vers.searchParams.get('state'));
  });
  it('configuration incomplète → 500 sans redirection', () => {
    const res = faux();
    login(req('/api/login'), res, { ...CFG, clientSecret: '' });
    expect(res.statusCode).toBe(500);
    expect(res.entetes.Location).toBeUndefined();
  });
});

describe('callback — verrou d\'identité et anti-CSRF', () => {
  const retour = (cookie?: string) => req('/api/callback?code=code-google&state=etat-1', cookie);
  const bon = { refresh_token: 'rt-google', id_token: idToken({ email: 'marc.exemple@gmail.com', email_verified: true }) };

  it('propriétaire (casse différente) → session posée (1 an) et retour à l\'app', async () => {
    const res = faux();
    await callback(retour(cookieDe(encoderEtat('etat-1'))), res, CFG, google({ echangerCode: vi.fn().mockResolvedValue(bon) }));
    expect(res.entetes.Location).toBe('/');
    expect(poseDans(res)).toContain('Max-Age=31536000');
    expect(lireSession(dechiffrer(valeurPosee(res), CFG.cookieSecret)!)).toEqual({ rt: 'rt-google', email: 'marc.exemple@gmail.com' });
  });
  it('compte étranger → aucun cookie de session, /?erreur=acces_refuse', async () => {
    const res = faux();
    const etranger = { ...bon, id_token: idToken({ email: 'intrus@exemple.com', email_verified: true }) };
    await callback(retour(cookieDe(encoderEtat('etat-1'))), res, CFG, google({ echangerCode: vi.fn().mockResolvedValue(etranger) }));
    expect(res.entetes.Location).toBe('/?erreur=acces_refuse');
    expect(poseDans(res)).toContain('Max-Age=0');
  });
  it('email non vérifié ou id_token absent → refus fermé, aucun cookie de session', async () => {
    for (const jetons of [
      { ...bon, id_token: idToken({ email: 'marc.exemple@gmail.com', email_verified: false }) },
      { refresh_token: 'rt-google' },
    ]) {
      const res = faux();
      await callback(retour(cookieDe(encoderEtat('etat-1'))), res, CFG, google({ echangerCode: vi.fn().mockResolvedValue(jetons) }));
      expect(res.entetes.Location).toBe('/?erreur=acces_refuse');
      expect(poseDans(res)).toContain('Max-Age=0');
    }
  });
  it('adresse autorisée non configurée → échec FERMÉ : jamais d\'échange de code ni de session', async () => {
    const res = faux(); const g = google({ echangerCode: vi.fn().mockResolvedValue(bon) });
    await callback(retour(cookieDe(encoderEtat('etat-1'))), res, { ...CFG, emailAutorise: '' }, g);
    expect(res.entetes.Location).toBe('/?auth=config');
    expect(g.echangerCode).not.toHaveBeenCalled();
    expect(poseDans(res)).toBe('');
  });
  it('état absent, différent ou cookie forgé → échec sans échange de code', async () => {
    const g = google();
    const cas: Array<[string | undefined, string]> = [
      [undefined, 'etat-cookie-absent'],
      [cookieDe(encoderEtat('autre')), 'etat-different'],
      [`${COOKIE_SESSION}=forge`, 'etat-cookie-absent'],
    ];
    for (const [cookie, motif] of cas) {
      const res = faux();
      await callback(retour(cookie), res, CFG, g);
      expect(res.entetes.Location).toBe(`/?auth=echec&motif=${motif}`);
    }
    expect(g.echangerCode).not.toHaveBeenCalled();
  });
  it('pas de refresh token → jamais de demi-session ; le motif de Google est nommé', async () => {
    const res = faux();
    await callback(retour(cookieDe(encoderEtat('etat-1'))), res, CFG, google({ echangerCode: vi.fn().mockResolvedValue({ error: 'invalid_client' }) }));
    expect(res.entetes.Location).toBe('/?auth=echec&motif=echange%3Ainvalid_client');
    expect(poseDans(res)).toContain('Max-Age=0');
  });
});

describe('refresh', () => {
  const POST = (cookie?: string) => req('/api/refresh', cookie, 'POST');
  it('session du propriétaire → access token frais', async () => {
    const res = faux(); const g = google();
    await refresh(POST(sessionDe('marc.exemple@gmail.com')), res, CFG, g);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.corps)).toEqual({ token: 'acces-frais', expireDansS: 3000 });
    expect(g.rafraichir).toHaveBeenCalledWith(CFG, 'rt-google');
  });
  it('sans cookie → 401 ; cookie d\'ÉTAT de connexion pris pour une session → 401 + purge, aucun appel à Google', async () => {
    const g = google();
    const a = faux(); await refresh(POST(), a, CFG, g);
    expect(a.statusCode).toBe(401);
    const b = faux(); await refresh(POST(cookieDe(encoderEtat('etat-1'))), b, CFG, g);
    expect(b.statusCode).toBe(401);
    expect(poseDans(b)).toContain('Max-Age=0');
    expect(g.rafraichir).not.toHaveBeenCalled();
  });
  it('accès retiré (adresse ≠ propriétaire) → 403 + purge ; jeton révoqué côté Google → 401 + purge', async () => {
    const g = google();
    const a = faux(); await refresh(POST(sessionDe('intrus@exemple.com')), a, CFG, g);
    expect(a.statusCode).toBe(403);
    expect(poseDans(a)).toContain('Max-Age=0');
    expect(g.rafraichir).not.toHaveBeenCalled();
    const b = faux();
    await refresh(POST(sessionDe('marc.exemple@gmail.com')), b, CFG, google({ rafraichir: vi.fn().mockResolvedValue({ error: 'invalid_grant' }) }));
    expect(b.statusCode).toBe(401);
    expect(JSON.parse(b.corps).erreur).toBe('invalid_grant');
    expect(poseDans(b)).toContain('Max-Age=0');
  });
});

describe('config — le secret de la web app ne sort qu\'à une session valide', () => {
  it('anonyme → 401 sans le moindre secret, même si la configuration est incomplète', () => {
    const a = faux(); config(req('/api/config'), a, CFG);
    expect(a.statusCode).toBe(401);
    expect(a.corps).not.toContain(CFG.webappSecret);
    const b = faux(); config(req('/api/config'), b, { ...CFG, webappSecret: '' });
    expect(b.statusCode).toBe(401);
  });
  it('propriétaire → configuration complète (le DSN Sentry seulement s\'il existe)', () => {
    const a = faux(); config(req('/api/config', sessionDe('marc.exemple@gmail.com')), a, CFG);
    expect(JSON.parse(a.corps)).toEqual({ spreadsheetId: 'feuille-fictive', webappUrl: 'https://exemple.test/exec', webappSecret: 'secret-webapp-fictif' });
    const b = faux(); config(req('/api/config', sessionDe('marc.exemple@gmail.com')), b, { ...CFG, sentryDsn: ' https://dsn.test/1 ' });
    expect(JSON.parse(b.corps).sentryDsn).toBe('https://dsn.test/1');
  });
  it('étranger → 403 ; web app non configurée → 500 nommant les variables, sans valeur', () => {
    const a = faux(); config(req('/api/config', sessionDe('intrus@exemple.com')), a, CFG);
    expect(a.statusCode).toBe(403);
    expect(a.corps).not.toContain(CFG.webappSecret);
    const b = faux(); config(req('/api/config', sessionDe('marc.exemple@gmail.com')), b, { ...CFG, webappUrl: '' });
    expect(b.statusCode).toBe(500);
    expect(b.corps).toContain('WEBAPP_URL');
  });
});

describe('logout et santé', () => {
  it('logout efface le cookie __session', () => {
    const res = faux(); logout(req('/api/logout', undefined, 'POST'), res);
    expect(poseDans(res)).toMatch(/^__session=;.*Max-Age=0/);
  });
  it('santé : 200 si la configuration OAuth est complète, 503 « config » sinon, 405 hors GET/HEAD, jamais rien d\'interne', () => {
    const a = faux(); sante(req('/api/sante'), a, CFG);
    expect(a.statusCode).toBe(200);
    const b = faux(); sante(req('/api/sante'), b, { ...CFG, cookieSecret: '' });
    expect(b.statusCode).toBe(503);
    expect(JSON.parse(b.corps)).toEqual({ ok: false, cause: 'config' });
    const c = faux(); sante(req('/api/sante', undefined, 'POST'), c, CFG);
    expect(c.statusCode).toBe(405);
    expect(a.corps + b.corps).not.toContain(CFG.clientSecret);
  });
});
