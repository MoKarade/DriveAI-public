/**
 * api/callback.ts — retour du consentement Google (session durable, C28-14).
 * Vérifie le `state` anti-CSRF, échange le code contre les jetons, CHIFFRE le refresh token
 * dans le cookie HttpOnly `driveai_rt` (1 an, SameSite=Strict), puis redirige vers l'app.
 * L'access token n'est JAMAIS passé dans l'URL (historique navigateur) : l'app le récupère
 * proprement via /api/refresh au chargement.
 */

import {
  Requete,
  Reponse,
  COOKIE_ETAT,
  lireEnv,
  origine,
  parametres,
  lireCookies,
  effacerCookie,
  poserCookieRefresh,
  chiffrer,
  encoderSession,
  echangerCode,
  emailDepuisIdToken,
  rediriger,
} from './_lib';
import { aLeDroitDEntrer } from './_accesHub';

/**
 * Retour au login avec le MOTIF de l'échec, jamais un secret : un code d'erreur court (ceux de
 * Google : `invalid_client`, `redirect_uri_mismatch`, `access_denied`…) ou le nom de l'étape.
 * Avant, `/?auth=echec` seul ne distinguait pas un cookie d'état perdu d'un secret client périmé.
 */
function echec(res: Reponse, motif: string): void {
  console.error(`[callback] connexion refusée : ${motif}`);
  rediriger(res, `/?auth=echec&motif=${encodeURIComponent(motif)}`);
}

/** Réduit un texte venu de l'extérieur à un code court sûr à journaliser et à mettre dans l'URL. */
function motifSur(v: string | null | undefined): string {
  return (v ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'inconnu';
}

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const env = lireEnv();
  if (!env) { rediriger(res, '/?auth=config'); return; }

  const params = parametres(req);
  const code = params.get('code');
  const etat = params.get('state');
  const etatAttendu = lireCookies(req)[COOKIE_ETAT];
  effacerCookie(res, req, COOKIE_ETAT); // usage unique, succès ou échec

  // state absent/différent = requête forgée (CSRF) ou consentement périmé → retour à l'écran
  // de connexion, échec FERMÉ (jamais d'échange de code sans preuve d'origine).
  if (!code || !etat || !etatAttendu || etat !== etatAttendu) {
    echec(res, !code ? `code-absent:${motifSur(params.get('error'))}` : !etatAttendu ? 'etat-cookie-absent' : 'etat-different');
    return;
  }

  const jetons = await echangerCode(env, code, `${origine(req)}/api/callback`);
  if (!jetons.refresh_token) {
    // Pas de refresh token (erreur d'échange, ou consentement partiel) : sans lui la session
    // durable n'existe pas — on repart au login plutôt que de poser une demi-session.
    echec(res, jetons.error ? `echange:${motifSur(jetons.error)}` : 'sans-refresh-token');
    return;
  }

  // Verrou d'identité (C28-20, ADR-0021 ; élargi par l'ADR 0001 de Hubperso, étape 3).
  //
  // CE QUI A CHANGÉ : ce n'est plus « seule ALLOWED_EMAIL entre », mais « le PROPRIÉTAIRE
  // (ALLOWED_EMAIL, sans réseau) ou toute personne à qui le hub a accordé DriveAI ». La
  // liste vit dans le hub et se gère depuis sa page d'administration — plus besoin d'éditer
  // une variable Vercel pour inviter quelqu'un, ni de se souvenir de la remettre pour le
  // retirer.
  //
  // CE QUI N'A PAS CHANGÉ : l'échec reste FERMÉ. Email absent, illisible, ou refusé ⇒ AUCUN
  // cookie posé, retour à l'écran de connexion. Et ce n'est plus la SEULE barrière : la
  // session porte désormais l'adresse, et /api/config comme /api/refresh la revérifient à
  // chaque appel — sans quoi un accès retiré survivrait un an dans un cookie.
  const email = jetons.id_token ? emailDepuisIdToken(jetons.id_token) : null;
  if (!email || !(await aLeDroitDEntrer(email))) {
    rediriger(res, '/?erreur=acces_refuse');
    return;
  }

  poserCookieRefresh(
    res,
    req,
    chiffrer(encoderSession({ rt: jetons.refresh_token, email }), env.cookieSecret),
  );
  rediriger(res, '/');
}
