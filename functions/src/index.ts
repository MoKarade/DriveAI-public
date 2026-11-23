/**
 * functions/src/index.ts — branche les handlers de `handlers.ts` sur Cloud Functions (ADR-0078).
 *
 * Seul fichier qui dépend de `firebase-functions` : toute la logique vit dans `handlers.ts` / `lib.ts` (testés sans réseau).
 *
 * COÛT BORNÉ PAR CONSTRUCTION : `maxInstances` bas et mémoire minimale sur CHAQUE fonction (un seul utilisateur : deux
 * instances suffisent largement). Région us-central1 : celle dont les quotas gratuits sont documentés
 * (https://firebase.google.com/pricing, lu le 18/11/2026). Les routes publiques sont celles de `firebase.json`
 * (Hosting réécrit `/api/<nom>` vers la fonction du même nom).
 *
 * Secrets (Secret Manager, `firebase functions:secrets:set <NOM>`, valeur jamais dans le dépôt) : GOOGLE_CLIENT_SECRET,
 * COOKIE_SECRET, WEBAPP_SECRET. Le reste est en paramètres (fichier `functions/.env.<projet>`, non versionné) : aucune
 * adresse ni identifiant de Marc n'est écrit ici.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { callback, config, login, logout, refresh, sante, type Echange } from './handlers';
import { echangerCode, rafraichirAccessToken, type Config } from './lib';

// 256MiB : Node 22 consomme 130-136 Mio au démarrage à froid sur Cloud Run (503 OOM à 128MiB relevé le 18/11/2026) ; reste sous les 400 000 Go-s/mois gratuits.
setGlobalOptions({ region: 'us-central1', maxInstances: 2, memory: '256MiB', timeoutSeconds: 30 });

const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const COOKIE_SECRET = defineSecret('COOKIE_SECRET');
const WEBAPP_SECRET = defineSecret('WEBAPP_SECRET');
const GOOGLE_CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const ALLOWED_EMAIL = defineString('ALLOWED_EMAIL');
const SPREADSHEET_ID = defineString('SPREADSHEET_ID');
const WEBAPP_URL = defineString('WEBAPP_URL');
const SENTRY_DSN = defineString('SENTRY_DSN', { default: '' });

const secrets = [GOOGLE_CLIENT_SECRET, COOKIE_SECRET, WEBAPP_SECRET];

/** Lue à chaque requête (jamais à l'import : un secret n'existe qu'à l'exécution). */
function cfg(): Config {
  return {
    clientId: GOOGLE_CLIENT_ID.value(),
    clientSecret: GOOGLE_CLIENT_SECRET.value(),
    cookieSecret: COOKIE_SECRET.value(),
    emailAutorise: ALLOWED_EMAIL.value(),
    spreadsheetId: SPREADSHEET_ID.value(),
    webappUrl: WEBAPP_URL.value(),
    webappSecret: WEBAPP_SECRET.value(),
    sentryDsn: SENTRY_DSN.value(),
  };
}

const google: Echange = { echangerCode, rafraichir: rafraichirAccessToken };

export const loginFn = onRequest({ secrets }, (req, res) => login(req, res, cfg()));
export const callbackFn = onRequest({ secrets }, (req, res) => callback(req, res, cfg(), google));
export const refreshFn = onRequest({ secrets }, (req, res) => refresh(req, res, cfg(), google));
export const configFn = onRequest({ secrets }, (req, res) => config(req, res, cfg()));
export const santeFn = onRequest({ secrets }, (req, res) => sante(req, res, cfg()));
export const logoutFn = onRequest((req, res) => logout(req, res));
