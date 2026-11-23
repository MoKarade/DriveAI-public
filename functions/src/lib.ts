/**
 * functions/src/lib.ts — boîte à outils des fonctions Firebase (portage de `api/_lib.ts`, ADR-0078).
 *
 * ZÉRO dépendance : seuls `node:crypto` et le `fetch` global. `index.ts` (qui, lui, dépend de
 * `firebase-functions`) ne fait que brancher ces briques ; elles restent testables sans réseau.
 *
 * ⚠️ UN SEUL COOKIE, `__session` : derrière Firebase Hosting, tout autre cookie est ARRACHÉ de la requête
 * avant d'atteindre la fonction (doc « Manage cache behavior », lue le 18/11/2026). Sur Vercel il y en avait
 * deux (`driveai_rt` et `driveai_oauth_etat`) ; ici le même cookie porte, tour à tour, l'état anti-CSRF du
 * consentement (10 min) puis la session (1 an). Il est toujours CHIFFRÉ (AES-256-GCM), HttpOnly, Secure.
 * SameSite=Lax (et non plus Strict pour la session) : le cookie d'état doit survivre au retour de
 * accounts.google.com, et c'est le même cookie. Le jeton de rafraîchissement n'est jamais lisible par le JS.
 *
 * Périmètre OAuth INCHANGÉ (Sheets + Drive, jamais Gmail) : toute extension = décision de Marc.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Requete = IncomingMessage;
export type Reponse = ServerResponse;

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
].join(' ');
/** `openid email` : Google émet un id_token dont l'adresse sert au verrou d'identité du callback. */
export const SCOPES_IDENTITE = 'openid email';

export const COOKIE_SESSION = '__session';
export const ETAT_S = 10 * 60;
export const SESSION_S = 365 * 24 * 60 * 60;

/** Configuration des fonctions : lue par `index.ts` (paramètres et secrets Firebase), passée aux handlers. */
export interface Config {
  clientId: string;
  clientSecret: string;
  cookieSecret: string;
  /** Adresse du propriétaire : seule admise (le hub est retiré, plus d'invité). */
  emailAutorise: string;
  spreadsheetId: string;
  webappUrl: string;
  webappSecret: string;
  sentryDsn: string;
}

/** Les trois valeurs sans lesquelles personne ne peut ouvrir de session. */
export function configOAuthComplete(c: Config): boolean {
  return Boolean(c.clientId && c.clientSecret && c.cookieSecret && c.emailAutorise);
}

/* ---------- Requête / réponse ---------- */

function premiere(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Origine PUBLIQUE de la requête (derrière Hosting : x-forwarded-host = le domaine de l'app). */
export function origine(req: Requete): string {
  const proto = premiere(req.headers['x-forwarded-proto']) ?? 'https';
  const hote = premiere(req.headers['x-forwarded-host']) ?? premiere(req.headers.host) ?? '';
  return `${proto}://${hote}`;
}

export function parametres(req: Requete): URLSearchParams {
  return new URL(req.url ?? '/', origine(req)).searchParams;
}

export function repondreJson(res: Reponse, code: number, corps: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

export function rediriger(res: Reponse, vers: string): void {
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', vers);
  res.end();
}

/* ---------- Cookie unique ---------- */

export function lireCookies(req: Requete): Record<string, string> {
  const brut = premiere(req.headers.cookie) ?? '';
  const cookies: Record<string, string> = {};
  for (const morceau of brut.split(';')) {
    const egal = morceau.indexOf('=');
    if (egal === -1) continue;
    const nom = morceau.slice(0, egal).trim();
    if (!nom) continue;
    try { cookies[nom] = decodeURIComponent(morceau.slice(egal + 1).trim()); } catch { /* valeur illisible : ignorée */ }
  }
  return cookies;
}

export function poserCookieSession(res: Reponse, req: Requete, valeur: string, maxAgeS: number): void {
  const attributs = [
    `${COOKIE_SESSION}=${encodeURIComponent(valeur)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeS}`,
  ];
  if (origine(req).startsWith('https://')) attributs.push('Secure');
  res.setHeader('Set-Cookie', attributs.join('; '));
}

export function effacerCookieSession(res: Reponse, req: Requete): void {
  poserCookieSession(res, req, '', 0);
}

/* ---------- Chiffrement (AES-256-GCM, clé dérivée de COOKIE_SECRET) ---------- */

function cle(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Sortie : base64url(iv | tag | chiffré) — auto-contenue, authentifiée. */
export function chiffrer(texte: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cle(secret), iv);
  const chiffre = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), chiffre]).toString('base64url');
}

/** null si corrompu ou forgé — jamais d'exception. `authTagLength: 16` : sans lui Node accepte une étiquette raccourcie. */
export function dechiffrer(b64: string, secret: string): string | null {
  try {
    const brut = Buffer.from(b64, 'base64url');
    const d = createDecipheriv('aes-256-gcm', cle(secret), brut.subarray(0, 12), { authTagLength: 16 });
    d.setAuthTag(brut.subarray(12, 28));
    return Buffer.concat([d.update(brut.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function jetonAleatoire(): string {
  return randomBytes(16).toString('hex');
}

/* ---------- Contenu du cookie : un état OU une session ---------- */

export interface Session {
  rt: string;
  email: string;
}

export function encoderEtat(etat: string): string {
  return JSON.stringify({ etat });
}

export function encoderSession(session: Session): string {
  return JSON.stringify(session);
}

/** L'état anti-CSRF d'un cookie déchiffré, ou null (c'est une session, ou illisible). */
export function lireEtat(clair: string): string | null {
  try {
    const brut = JSON.parse(clair) as { etat?: unknown };
    return typeof brut.etat === 'string' && brut.etat ? brut.etat : null;
  } catch {
    return null;
  }
}

/** La session d'un cookie déchiffré, ou null : sans refresh token ET adresse, aucune revérification n'est possible. */
export function lireSession(clair: string): Session | null {
  try {
    const brut = JSON.parse(clair) as { rt?: unknown; email?: unknown };
    if (typeof brut.rt !== 'string' || !brut.rt.trim()) return null;
    if (typeof brut.email !== 'string' || !brut.email.trim()) return null;
    return { rt: brut.rt, email: brut.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}

/** Le cookie de la requête, déchiffré ; null s'il manque, est forgé ou a changé de clé. */
export function lireCookieClair(req: Requete, cfg: Config): string | null {
  const brut = lireCookies(req)[COOKIE_SESSION];
  return brut ? dechiffrer(brut, cfg.cookieSecret) : null;
}

/** Le propriétaire seul (comparaison en minuscules, sans réseau). */
export function aLeDroitDEntrer(email: string | null | undefined, cfg: Config): boolean {
  const adresse = (email ?? '').trim().toLowerCase();
  const proprietaire = cfg.emailAutorise.trim().toLowerCase();
  return adresse !== '' && proprietaire !== '' && adresse === proprietaire;
}

/* ---------- Jetons Google ---------- */

export interface ReponseToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
}

/**
 * Adresse VÉRIFIÉE d'un id_token. Pas de vérification de signature : le jeton vient DIRECTEMENT de l'échange
 * code→token sur oauth2.googleapis.com en HTTPS, jamais du client. `email_verified === false` est refusé.
 */
export function emailDepuisIdToken(idToken: string): string | null {
  try {
    const morceaux = idToken.split('.');
    if (morceaux.length !== 3) return null;
    const p = JSON.parse(Buffer.from(morceaux[1], 'base64url').toString('utf8')) as { email?: string; email_verified?: boolean };
    if (!p.email || p.email_verified === false) return null;
    return p.email.toLowerCase();
  } catch {
    return null;
  }
}

async function appelToken(corps: Record<string, string>): Promise<ReponseToken> {
  const rep = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corps).toString(),
  });
  return (await rep.json().catch(() => ({ error: `HTTP ${rep.status}` }))) as ReponseToken;
}

export async function echangerCode(cfg: Config, code: string, redirectUri: string): Promise<ReponseToken> {
  return appelToken({ grant_type: 'authorization_code', code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri });
}

export async function rafraichirAccessToken(cfg: Config, refreshToken: string): Promise<ReponseToken> {
  return appelToken({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
}
