/**
 * api/_sentry.ts — remontée des erreurs SERVEUR vers Sentry, sans paquet npm et sans donnée
 * personnelle (tâche #495).
 *
 * ZÉRO dépendance, par CONSTRUCTION (voir _lib.ts et la règle `api-sans-paquet-npm` : le projet
 * Vercel n'installe rien, un `@sentry/node` importé ici casserait la production). On parle donc
 * directement à l'entrée « envelope » de Sentry avec `fetch`, et on construit nous-mêmes un
 * événement MINIMAL. Moins il y a de champs, moins il y a de fuite possible.
 *
 * Donnée personnelle (décision de Marc, 15/10/2026 : aucune donnée perso en ligne ; DriveAI manipule
 * les documents de Marc) : l'événement ne contient que le nom de l'erreur, un message réduit (voir
 * `messagePublic`), la pile et l'étiquette de la source. Jamais de requête, d'en-tête, de cookie, de
 * corps, d'adresse IP, d'utilisateur, de fil d'Ariane ni de contexte. Verrou : app/test/sentry.test.ts.
 *
 * Sans `SENTRY_DSN`, rien ne part et rien ne change : un déploiement non configuré se comporte comme
 * avant. Un échec d'envoi ne lève JAMAIS (on ne casse pas une réponse pour un rapport d'erreur).
 */

/** Le DSN décomposé : où poster, et la clé publique. */
export interface DsnSentry {
  urlEnveloppe: string;
}

/**
 * `https://<clé>@<hôte>/<projet>` → URL d'envelope. Refuse tout ce qui n'est pas du https avec une
 * clé et un identifiant de projet numérique (échec fermé : un DSN douteux = Sentry éteint).
 */
export function lireDsn(brut: string | undefined): DsnSentry | null {
  const texte = brut?.trim();
  if (!texte) return null;
  let url: URL;
  try {
    url = new URL(texte);
  } catch {
    return null;
  }
  const cle = url.username;
  const segments = url.pathname.split('/').filter(Boolean);
  const projet = segments.pop();
  if (url.protocol !== 'https:' || !cle || !projet || !/^\d+$/.test(projet)) return null;
  const prefixe = segments.length > 0 ? `/${segments.join('/')}` : '';
  const params = new URLSearchParams({ sentry_version: '7', sentry_key: cle, sentry_client: 'driveai-sans-sdk/1' });
  return { urlEnveloppe: `https://${url.host}${prefixe}/api/${projet}/envelope/?${params.toString()}` };
}

const LONGUEUR_MAX_MESSAGE = 120;

/**
 * Message d'erreur réduit à ce qu'on peut envoyer sans risque. Un message de DriveAI peut citer le
 * corps d'une réponse Google (`Google API 403 : …` — noms de fichiers, adresses) : on ne GARDE donc
 * que ce qui précède le premier « : », puis on masque ce qui ressemble à une adresse, une URL, un
 * identifiant Drive ou un texte entre guillemets, et on coupe.
 */
export function messagePublic(brut: unknown): string {
  const texte = typeof brut === 'string' ? brut : brut instanceof Error ? brut.message : '';
  // URL et adresses d'abord : une URL contient des « : » qui fausseraient la coupe.
  const masque = texte
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[courriel]');
  const avant = masque.split(':')[0] ?? '';
  return avant
    .replace(/[A-Za-z0-9_-]{25,}/g, '[id]')
    // Texte entre guillemets (ouvrant précédé d'un blanc ou d'une ponctuation : une apostrophe
    // française comme « c'est » n'en ouvre pas) : gardé seulement s'il ressemble à un nom de
    // variable du code (`reading 'items'`), masqué sinon (ça peut être un nom de fichier).
    .replace(/(^|[\s(\[,;=])(["'«])([^"'»]*)(["'»])(?!\w)/g,
      (tout, avantOuvre: string, ouvre: string, dedans: string, ferme: string) =>
        /^[A-Za-z_$][\w$]{0,30}$/.test(dedans) ? tout : `${avantOuvre}${ouvre}…${ferme}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LONGUEUR_MAX_MESSAGE);
}

function nomPublic(erreur: unknown): string {
  const nom = erreur instanceof Error ? erreur.name : '';
  return /^[A-Za-z][A-Za-z0-9_.$]{0,59}$/.test(nom) ? nom : 'Error';
}

interface Trame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
}

/** Pile V8 → trames Sentry (la plus ancienne d'abord). Rend [] si le format est inconnu. */
export function trames(pile: string | undefined): Trame[] {
  const resultat: Trame[] = [];
  for (const ligne of (pile ?? '').split('\n')) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(ligne);
    if (!m) continue;
    const [, fonction, fichier, l, c] = m;
    resultat.push({
      filename: (fichier ?? '').split('?')[0] ?? '',
      ...(fonction ? { function: fonction } : {}),
      lineno: Number(l),
      colno: Number(c),
    });
  }
  return resultat.reverse().slice(-50);
}

export interface OptionsEvenement {
  /** Où l'erreur est survenue (étiquette fixe choisie par le code, jamais une donnée). */
  source: string;
  environnement: string;
  plateforme?: 'node' | 'javascript';
  /** Injectables pour les tests. */
  identifiant?: string;
  maintenantMs?: number;
}

/** L'événement Sentry MINIMAL. Tout champ absent d'ici ne peut pas fuiter. */
export function construireEvenement(erreur: unknown, options: OptionsEvenement): Record<string, unknown> {
  const identifiant = options.identifiant ?? crypto.randomUUID().replace(/-/g, '');
  const frames = trames(erreur instanceof Error ? erreur.stack : undefined);
  return {
    event_id: identifiant,
    timestamp: (options.maintenantMs ?? Date.now()) / 1000,
    platform: options.plateforme ?? 'node',
    level: 'error',
    environment: options.environnement,
    tags: { source: options.source },
    exception: {
      values: [{
        type: nomPublic(erreur),
        value: messagePublic(erreur),
        ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
      }],
    },
  };
}

/** Enveloppe Sentry : en-tête, en-tête d'élément, événement — trois lignes JSON. */
export function construireEnveloppe(evenement: Record<string, unknown>, maintenantMs: number = Date.now()): string {
  return [
    JSON.stringify({ event_id: evenement.event_id, sent_at: new Date(maintenantMs).toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(evenement),
  ].join('\n');
}

export interface ResultatEnvoi {
  /** Sentry a répondu par un code 2xx. */
  livre: boolean;
  /** Code HTTP de Sentry, absent si aucune réponse. */
  statut?: number;
  /** Identifiant de l'événement (vide si rien n'a été construit). */
  id: string;
}

export interface OptionsEnvoi extends Omit<OptionsEvenement, 'identifiant' | 'maintenantMs'> {
  delaiMs?: number;
  fetchImpl?: typeof fetch;
}

/** Envoie UNE erreur. Ne lève jamais : sans DSN valide ou en cas d'échec réseau, `livre` est faux. */
export async function envoyerErreur(
  dsnBrut: string | undefined,
  erreur: unknown,
  options: OptionsEnvoi,
): Promise<ResultatEnvoi> {
  const dsn = lireDsn(dsnBrut);
  if (!dsn) return { livre: false, id: '' };
  const evenement = construireEvenement(erreur, options);
  const id = String(evenement.event_id);
  try {
    const rep = await (options.fetchImpl ?? fetch)(dsn.urlEnveloppe, {
      method: 'POST',
      body: construireEnveloppe(evenement),
      signal: AbortSignal.timeout(options.delaiMs ?? 2000),
    });
    return { livre: rep.status >= 200 && rep.status < 300, statut: rep.status, id };
  } catch {
    return { livre: false, id };
  }
}

/**
 * Signale une erreur des fonctions Vercel. À appeler avec `await` AVANT de répondre (une fonction
 * serverless peut être gelée dès la réponse envoyée). Plafond de 2 s, jamais d'exception.
 * La console ne reçoit que le code HTTP de l'échec, jamais le DSN.
 */
export async function signalerErreurServeur(source: string, erreur: unknown): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn?.trim()) return;
  const r = await envoyerErreur(dsn, erreur, {
    source,
    environnement: process.env.VERCEL_ENV ?? 'inconnu',
    plateforme: 'node',
  });
  if (!r.livre) console.error(`[sentry] envoi impossible (${source}), code HTTP : ${r.statut ?? 'aucun'}`);
}
