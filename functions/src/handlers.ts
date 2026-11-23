/**
 * functions/src/handlers.ts — les fonctions de session de DriveAI sur Firebase (portage de `api/login|callback|
 * refresh|logout|config|_sante`, ADR-0078). Chaque handler reçoit sa configuration et un `Echange` (l'appel à
 * Google) : aucun réseau, aucune variable d'environnement lue ici — c'est ce qui les rend testables.
 *
 * Comportements CONSERVÉS : échec fermé (cookie absent, forgé ou périmé = 401 sans rien apprendre), verrou
 * d'identité au callback ET à chaque refresh/config (le secret de la web app ne sort qu'à une session valide),
 * `Cache-Control: no-store` partout. Comportement RETIRÉ : le hub (plus d'invité, propriétaire seul).
 */

import {
  Config, Requete, Reponse, ReponseToken, SCOPES, SCOPES_IDENTITE, ETAT_S, SESSION_S,
  aLeDroitDEntrer, chiffrer, configOAuthComplete, effacerCookieSession, emailDepuisIdToken, encoderEtat,
  encoderSession, jetonAleatoire, lireCookieClair, lireEtat, lireSession, origine, parametres,
  poserCookieSession, rediriger, repondreJson,
} from './lib';

/** L'appel à Google, injectable : `lib.ts` fournit les vrais, les tests des faux. */
export interface Echange {
  echangerCode(cfg: Config, code: string, redirectUri: string): Promise<ReponseToken>;
  rafraichir(cfg: Config, refreshToken: string): Promise<ReponseToken>;
}

/** Motif d'échec : un code court sûr (jamais un secret), pour l'URL et le journal. */
function motifSur(v: string | null | undefined): string {
  return (v ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'inconnu';
}

function echec(res: Reponse, motif: string): void {
  console.error(`[callback] connexion refusée : ${motif}`);
  rediriger(res, `/?auth=echec&motif=${encodeURIComponent(motif)}`);
}

export function login(req: Requete, res: Reponse, cfg: Config): void {
  if (!configOAuthComplete(cfg)) {
    repondreJson(res, 500, { erreur: 'Configuration serveur incomplète (paramètres ou secrets Firebase).' });
    return;
  }
  const etat = jetonAleatoire();
  poserCookieSession(res, req, chiffrer(encoderEtat(etat), cfg.cookieSecret), ETAT_S);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', `${origine(req)}/api/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline'); // sans eux, pas de refresh token
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', `${SCOPES_IDENTITE} ${SCOPES}`);
  url.searchParams.set('state', etat);
  rediriger(res, url.toString());
}

export async function callback(req: Requete, res: Reponse, cfg: Config, google: Echange): Promise<void> {
  if (!configOAuthComplete(cfg)) { rediriger(res, '/?auth=config'); return; }
  const params = parametres(req);
  const code = params.get('code');
  const etat = params.get('state');
  const clair = lireCookieClair(req, cfg);
  const etatAttendu = clair ? lireEtat(clair) : null;
  effacerCookieSession(res, req); // usage unique, succès ou échec

  if (!code || !etat || !etatAttendu || etat !== etatAttendu) {
    echec(res, !code ? `code-absent:${motifSur(params.get('error'))}` : !etatAttendu ? 'etat-cookie-absent' : 'etat-different');
    return;
  }
  const jetons = await google.echangerCode(cfg, code, `${origine(req)}/api/callback`);
  if (!jetons.refresh_token) {
    echec(res, jetons.error ? `echange:${motifSur(jetons.error)}` : 'sans-refresh-token');
    return;
  }
  const email = jetons.id_token ? emailDepuisIdToken(jetons.id_token) : null;
  if (!email || !aLeDroitDEntrer(email, cfg)) {
    rediriger(res, '/?erreur=acces_refuse'); // aucun cookie de session posé
    return;
  }
  poserCookieSession(res, req, chiffrer(encoderSession({ rt: jetons.refresh_token, email }), cfg.cookieSecret), SESSION_S);
  rediriger(res, '/');
}

export async function refresh(req: Requete, res: Reponse, cfg: Config, google: Echange): Promise<void> {
  if (!configOAuthComplete(cfg)) {
    repondreJson(res, 500, { erreur: 'Configuration serveur incomplète (paramètres ou secrets Firebase).' });
    return;
  }
  const clair = lireCookieClair(req, cfg);
  if (clair === null) {
    repondreJson(res, 401, { erreur: 'Aucune session' });
    return;
  }
  const session = lireSession(clair);
  if (!session) {
    effacerCookieSession(res, req); // état de connexion resté, forgé, ou ancien format : reconnexion propre
    repondreJson(res, 401, { erreur: 'Session illisible — reconnexion nécessaire' });
    return;
  }
  if (!aLeDroitDEntrer(session.email, cfg)) {
    effacerCookieSession(res, req);
    repondreJson(res, 403, { erreur: 'Accès retiré pour ce compte' });
    return;
  }
  const jetons = await google.rafraichir(cfg, session.rt);
  if (!jetons.access_token) {
    effacerCookieSession(res, req); // `invalid_grant` : révoqué ou expiré côté Google
    repondreJson(res, 401, { erreur: jetons.error ?? 'Session révoquée — reconnexion nécessaire' });
    return;
  }
  repondreJson(res, 200, { token: jetons.access_token, expireDansS: jetons.expires_in ?? 3600 });
}

export function logout(req: Requete, res: Reponse): void {
  effacerCookieSession(res, req);
  repondreJson(res, 200, { ok: true });
}

export function config(req: Requete, res: Reponse, cfg: Config): void {
  if (!configOAuthComplete(cfg)) {
    repondreJson(res, 500, { erreur: 'Configuration serveur incomplète (paramètres ou secrets Firebase).' });
    return;
  }
  // Session D'ABORD : un anonyme reçoit 401 sans rien apprendre. Revérifiée à chaque appel : c'est cet endpoint
  // qui délivre le secret de la web app.
  const clair = lireCookieClair(req, cfg);
  const session = clair ? lireSession(clair) : null;
  if (!session) {
    repondreJson(res, 401, { erreur: 'Aucune session' });
    return;
  }
  if (!aLeDroitDEntrer(session.email, cfg)) {
    repondreJson(res, 403, { erreur: 'Accès retiré pour ce compte' });
    return;
  }
  if (!cfg.spreadsheetId || !cfg.webappUrl || !cfg.webappSecret) {
    repondreJson(res, 500, { erreur: 'Configuration serveur incomplète : SPREADSHEET_ID / WEBAPP_URL / WEBAPP_SECRET.' });
    return;
  }
  const sentryDsn = cfg.sentryDsn.trim();
  repondreJson(res, 200, {
    spreadsheetId: cfg.spreadsheetId, webappUrl: cfg.webappUrl, webappSecret: cfg.webappSecret,
    ...(sentryDsn ? { sentryDsn } : {}),
  });
}

/** GET /api/sante : publique, sans rien d'interne — la fumée de production la sonde après chaque déploiement. */
export function sante(req: Requete, res: Reponse, cfg: Config): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    repondreJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!configOAuthComplete(cfg)) {
    repondreJson(res, 503, { ok: false, cause: 'config' });
    return;
  }
  repondreJson(res, 200, { ok: true });
}
