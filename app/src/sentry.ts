/**
 * sentry.ts — remontée des erreurs du NAVIGATEUR vers Sentry, sans paquet npm et sans donnée
 * personnelle (tâche #495).
 *
 * Pourquoi une copie de api/_sentry.ts plutôt qu'un import : la règle d'architecture
 * `navigateur-sans-code-serveur` interdit à src/ d'importer api/, et le SDK officiel alourdirait
 * l'app et enverrait des fils d'Ariane (URL, console) qui peuvent contenir des noms de fichiers.
 * Les deux copies produisent le MÊME événement : app/test/sentry.test.ts le vérifie.
 *
 * Donnée personnelle (décision de Marc, 15/10/2026 : aucune donnée perso en ligne) : l'événement ne
 * contient que le nom de l'erreur, un message réduit (`messagePublic`), la pile et la source. Les
 * messages de l'app citent parfois une réponse Google (`Google API 403 : …`) : tout ce qui suit le
 * premier « : » est donc coupé AVANT l'envoi. Jamais de page visitée, d'utilisateur ni de contexte.
 *
 * Le DSN vient de /api/config (variable Vercel `SENTRY_DSN`, session exigée) ; absent, Sentry reste
 * éteint. Un DSN n'est pas un secret fort (il est lisible par tout navigateur qui charge l'app).
 */

interface DsnSentry {
  urlEnveloppe: string;
}

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

export function messagePublic(brut: unknown): string {
  const texte = typeof brut === 'string' ? brut : brut instanceof Error ? brut.message : '';
  // URL et adresses d'abord : une URL contient des « : » qui fausseraient la coupe.
  const masque = texte
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[courriel]');
  const avant = masque.split(':')[0] ?? '';
  return avant
    .replace(/[A-Za-z0-9_-]{25,}/g, '[id]')
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
  source: string;
  environnement: string;
  identifiant?: string;
  maintenantMs?: number;
}

export function construireEvenement(erreur: unknown, options: OptionsEvenement): Record<string, unknown> {
  const identifiant = options.identifiant ?? crypto.randomUUID().replace(/-/g, '');
  const frames = trames(erreur instanceof Error ? erreur.stack : undefined);
  return {
    event_id: identifiant,
    timestamp: (options.maintenantMs ?? Date.now()) / 1000,
    platform: 'javascript',
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

export function construireEnveloppe(evenement: Record<string, unknown>, maintenantMs: number = Date.now()): string {
  return [
    JSON.stringify({ event_id: evenement.event_id, sent_at: new Date(maintenantMs).toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(evenement),
  ].join('\n');
}

/** Au plus ce nombre d'événements par chargement de page : une boucle d'erreurs ne doit pas inonder Sentry. */
export const MAX_EVENEMENTS_PAR_PAGE = 5;

export interface OptionsRapporteur {
  environnement?: string;
  maximum?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fabrique la fonction qui signale une erreur. Sans DSN valide elle ne fait rien. Une même erreur
 * (nom + message réduit) n'est envoyée qu'une fois par page ; au-delà du plafond, plus rien ne part.
 * Ne lève jamais (un échec d'envoi ne doit ni casser l'app ni relancer le gestionnaire d'erreurs).
 */
export function creerRapporteur(
  dsnBrut: string | undefined,
  options: OptionsRapporteur = {},
): (erreur: unknown) => Promise<boolean> {
  const dsn = lireDsn(dsnBrut);
  const deja = new Set<string>();
  const maximum = options.maximum ?? MAX_EVENEMENTS_PAR_PAGE;
  return async (erreur) => {
    if (!dsn || deja.size >= maximum) return false;
    const cle = `${nomPublic(erreur)}|${messagePublic(erreur)}`;
    if (deja.has(cle)) return false;
    deja.add(cle);
    try {
      const rep = await (options.fetchImpl ?? fetch)(dsn.urlEnveloppe, {
        method: 'POST',
        body: construireEnveloppe(construireEvenement(erreur, {
          source: 'navigateur',
          environnement: options.environnement ?? 'production',
        })),
        keepalive: true,
      });
      return rep.status >= 200 && rep.status < 300;
    } catch {
      return false;
    }
  };
}

/** Ce dont `brancherSentry` a besoin de `window` (injectable pour les tests). */
export interface CibleErreurs {
  addEventListener(type: 'error', ecouteur: (e: { error?: unknown; message?: string }) => void): void;
  addEventListener(type: 'unhandledrejection', ecouteur: (e: { reason?: unknown }) => void): void;
}

let dejaBranche = false;

/**
 * Branche le signalement sur les erreurs non rattrapées de la page. Idempotent, sans effet sans DSN.
 * Rend vrai quand Sentry est actif.
 */
export function brancherSentry(
  dsn: string | undefined,
  cible: CibleErreurs = window,
  options: OptionsRapporteur = {},
): boolean {
  if (!lireDsn(dsn) || dejaBranche) return false;
  dejaBranche = true;
  const signaler = creerRapporteur(dsn, options);
  cible.addEventListener('error', (e) => { void signaler(e.error ?? new Error(e.message ?? 'Error')); });
  cible.addEventListener('unhandledrejection', (e) => { void signaler(e.reason); });
  return true;
}

/** Pour les tests : permet de rebrancher. */
export function reinitialiserSentryPourTest(): void {
  dejaBranche = false;
}
