/**
 * api/login.ts — départ du flux OAuth « Authorization Code » (session durable, C28-14).
 * Redirige vers le consentement Google avec `access_type=offline` + `prompt=consent`
 * (indispensables : sans eux Google n'émet PAS de refresh token) et un `state` anti-CSRF
 * posé en cookie Lax (relu par /api/callback au retour).
 *
 * Sert aussi `/api/sante` (`api/_sante.ts`) : une seule fonction pour les deux routes (plafond de 12 fonctions du plan Hobby).
 */

import {
  Requete,
  Reponse,
  SCOPES,
  SCOPES_IDENTITE,
  COOKIE_ETAT,
  lireEnv,
  origine,
  poserCookie,
  rediriger,
  repondreJson,
  jetonAleatoire,
} from './_lib';
import { repondreSante, visePartageSante } from './_sante';

export default function handler(req: Requete, res: Reponse): void {
  // `vercel.json` réécrit `/api/sante` vers `/api/login?cible=sante` : la santé ne pose aucun cookie et ne redirige jamais.
  if (visePartageSante(req)) {
    repondreSante(req, res);
    return;
  }

  const env = lireEnv();
  if (!env) {
    repondreJson(res, 500, {
      erreur: 'Configuration serveur incomplète : GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / COOKIE_SECRET (variables d\'environnement Vercel).',
    });
    return;
  }

  const etat = jetonAleatoire();
  poserCookie(res, req, COOKIE_ETAT, etat, 600, 'Lax'); // 10 min — le temps du consentement

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('redirect_uri', `${origine(req)}/api/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  // `openid email` (C28-20) : Google émet un id_token → /api/callback vérifie que le compte
  // connecté est bien celui de Marc (ALLOWED_EMAIL) avant de poser la session.
  url.searchParams.set('scope', `${SCOPES_IDENTITE} ${SCOPES}`);
  url.searchParams.set('state', etat);
  rediriger(res, url.toString());
}
