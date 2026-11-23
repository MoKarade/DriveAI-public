/**
 * connexion.ts — lecture PURE du retour de /api/callback sur l'écran de connexion (#689).
 * `/?auth=echec&motif=…` : le motif est un code court (celui de Google, ou l'étape) posé par
 * le serveur ; on ne l'affiche qu'après l'avoir réduit à des caractères sûrs.
 */

/** `null` = pas un retour en échec ; sinon le motif nettoyé ('' si le serveur n'en a pas donné). */
export function motifEchecDepuisUrl(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get('auth') !== 'echec') return null;
  return (params.get('motif') ?? '').replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 60);
}
