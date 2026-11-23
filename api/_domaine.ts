/**
 * _domaine.ts — adresses PUBLIQUES du déploiement, sans aucune valeur en dur (tâche #468).
 *
 * Source : la variable système Vercel `VERCEL_PROJECT_PRODUCTION_URL` (le domaine de production du
 * projet : posé par Vercel, jamais par la requête — un en-tête `Host` forgé ne peut pas rediriger le
 * jeton du hub). `HUB_URL` surcharge l'adresse du hub (déploiement de test, autre domaine).
 *
 * ⚠️ Un domaine `*.vercel.app` n'est JAMAIS pris pour celui de l'écosystème : dériver « le parent »
 * de `projet.vercel.app` enverrait le jeton du hub à `vercel.app`. Dans ce cas (ou sans la variable)
 * les fonctions rendent '' et l'appelant échoue FERMÉ.
 */

/** Hôte nu (sans protocole ni barre finale) d'une valeur d'environnement, ou ''. */
function hoteNu(valeur: string | undefined): string {
  return (valeur ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

function estHoteUtilisable(hote: string): boolean {
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(hote) && hote.includes('.') && !hote.endsWith('.vercel.app');
}

/** Origine publique de l'app (`https://<hôte>`), ou '' si inconnue. PURE. */
export function origineApp(env: NodeJS.ProcessEnv = process.env): string {
  const hote = hoteNu(env.VERCEL_PROJECT_PRODUCTION_URL);
  return estHoteUtilisable(hote) ? `https://${hote}` : '';
}

/**
 * Origine du hub : `HUB_URL` si fournie, sinon le domaine parent de l'app (`sous.domaine.tld` →
 * `domaine.tld`). '' si rien de sûr ne se déduit. PURE.
 */
export function origineHub(env: NodeJS.ProcessEnv = process.env): string {
  const surcharge = (env.HUB_URL ?? '').trim().replace(/\/+$/, '');
  if (surcharge) return surcharge;
  const hote = hoteNu(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (!estHoteUtilisable(hote)) return '';
  const parent = hote.split('.').slice(1).join('.');
  return parent.includes('.') ? `https://${parent}` : '';
}
