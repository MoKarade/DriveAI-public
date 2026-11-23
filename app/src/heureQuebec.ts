/**
 * heureQuebec.ts — carte 14 (15/10) : afficher une heure du moteur (ISO en UTC, « …Z ») en heure du
 * Québec (America/Toronto, été/hiver gérés par Intl). Fonction pure. Texte sans fuseau explicite ou
 * illisible : rendu tel quel (« T » → espace), jamais deviné ni converti à tort.
 */

const AVEC_FUSEAU = /(Z|[+-]\d{2}:?\d{2})$/i;

export function heureQuebec(iso: string): string {
  const brut = iso.trim();
  if (!AVEC_FUSEAU.test(brut)) return brut.replace('T', ' ');
  const d = new Date(brut);
  if (Number.isNaN(d.getTime())) return brut.replace('T', ' ');
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const v = (type: string) => p.find((x) => x.type === type)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')} ${v('hour')}:${v('minute')}`;
}
