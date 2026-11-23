/**
 * api/_sante.ts — GET /api/sante : la route de santé que la fumée de production commune sonde après chaque déploiement
 * (workflow `fumee.yml` de MoKarade/.github). Tâche #775.
 *
 *   200 { ok: true }                       le serveur a de quoi ouvrir une session (variables OAuth présentes)
 *   503 { ok: false, cause: 'config' }     une variable manque : un site « en ligne » qui ne peut pas faire entrer personne
 *   405 autre méthode que GET et HEAD
 *
 * Publique (la fumée n'a pas de session) donc sans rien d'interne : ni nom de variable, ni valeur, ni version. La cause est un
 * mot fixe de 20 lettres au plus, le seul que la fumée recopie dans son journal public. `Cache-Control: no-store`.
 *
 * Servie par la fonction `api/login.ts` : `api/` compte déjà 12 fonctions (plafond du plan Hobby), donc pas de 13e ; `vercel.json`
 * réécrit `/api/sante` vers `/api/login?cible=sante`.
 */

import { Requete, Reponse, lireEnv, repondreJson } from './_lib';

/** `?cible=sante` : posé par la réécriture de `vercel.json`, jamais par la page. Base factice : l'hôte de la requête n'importe pas. */
export function visePartageSante(req: Requete): boolean {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams.get('cible') === 'sante';
  } catch {
    return false;
  }
}

export function repondreSante(req: Requete, res: Reponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    repondreJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!lireEnv()) {
    repondreJson(res, 503, { ok: false, cause: 'config' });
    return;
  }
  repondreJson(res, 200, { ok: true });
}
