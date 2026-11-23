/**
 * explorateur.ts — logique PURE de l'explorateur Drive (C21-01, chantier #21).
 *
 * Tout ce qui se calcule sans réseau vit ici et est testé : construction des clauses `q`
 * de l'API Drive (échappement strict — backslash AVANT l'apostrophe, comme `chercherParNom`),
 * tri façon Google Drive (dossiers d'abord), fil d'Ariane, découpage des recherches scopées
 * en lots de parents (les `q` ont une taille bornée ; `in parents` ne voit que les enfants
 * DIRECTS, la portée « dans ce dossier » est donc une liste de sous-dossiers collectée à part).
 */

import { estConfianceBasse, type LigneIndex } from './etat';

export const MIME_DOSSIER = 'application/vnd.google-apps.folder';

export interface ElementDrive {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

/** Une étape du fil d'Ariane (id de dossier + nom affiché). */
export interface Etape {
  id: string;
  nom: string;
}

/** Échappe une valeur pour une clause `q` Drive — backslash d'abord, sinon `\` réactive le `'`. */
export function echapperQ(texte: string): string {
  return texte.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Enfants directs d'un dossier, corbeille exclue. */
export function qEnfants(dossierId: string): string {
  return `'${echapperQ(dossierId)}' in parents and trashed = false`;
}

/**
 * Recherche comme la barre Google Drive : nom OU plein texte (index natif — ADR-0007, aucun
 * corps stocké par l'app). `parents` (optionnel) borne aux enfants directs de ces dossiers.
 */
export function qRecherche(texte: string, parents?: string[]): string {
  const sain = echapperQ(texte.trim());
  const base = `(name contains '${sain}' or fullText contains '${sain}') and trashed = false`;
  if (!parents || parents.length === 0) return base;
  const clause = parents.map((p) => `'${echapperQ(p)}' in parents`).join(' or ');
  return `${base} and (${clause})`;
}

/** Sous-dossiers d'un lot de parents (sert à la collecte bornée de la portée). */
export function qSousDossiers(parents: string[]): string {
  const clause = parents.map((p) => `'${echapperQ(p)}' in parents`).join(' or ');
  return `(${clause}) and mimeType = '${MIME_DOSSIER}' and trashed = false`;
}

/** Découpe en lots de `taille` (dernier lot plus court). Copie — n'altère jamais l'entrée. */
export function decouperEnLots<T>(items: T[], taille: number): T[][] {
  const pas = Number.isFinite(taille) && taille >= 1 ? Math.floor(taille) : 1;
  const lots: T[][] = [];
  for (let i = 0; i < items.length; i += pas) lots.push(items.slice(i, i + pas));
  return lots;
}

export function estDossier(e: Pick<ElementDrive, 'mimeType'>): boolean {
  return e.mimeType === MIME_DOSSIER;
}

/** Tri façon Google Drive : dossiers d'abord, puis alphabétique insensible (copie défensive). */
export function trierElements(elements: ElementDrive[]): ElementDrive[] {
  return elements.slice().sort((a, b) => {
    const da = estDossier(a) ? 0 : 1;
    const db = estDossier(b) ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true });
  });
}

/** Entre dans un dossier : nouvelle étape en bout de fil (copie). */
export function pousserEtape(ariane: Etape[], etape: Etape): Etape[] {
  return [...ariane, etape];
}

/** Remonte à une étape du fil (clic sur l'Ariane) : coupe tout ce qui suit. Id inconnu → inchangé. */
export function couperA(ariane: Etape[], id: string): Etape[] {
  const i = ariane.findIndex((e) => e.id === id);
  return i === -1 ? ariane : ariane.slice(0, i + 1);
}

/** Taille lisible (l'API renvoie `size` en chaîne d'octets ; absent pour les fichiers Google). */
export function formaterTaille(size?: string): string {
  const n = Number(size);
  if (!size || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

/**
 * Le dossier d'arrivée du moteur (`00 · À trier`) — reconnu par NOM normalisé (l'app ne connaît
 * pas son ID). Sert aux parades intake C21-02 : pas de création de dossier dedans (trou noir,
 * l'intake ne descend pas), refus d'y REdéposer un fichier déjà traité (il s'y enliserait).
 */
export function estDossierATrier(nom: string): boolean {
  const n = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return n.includes('a trier');
}

/** Date courte (jour) depuis un ISO Drive ; illisible → « — ». */
export function formaterDateCourte(iso?: string, locale = 'fr-CA'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Montant en dollars, dans la langue de l'interface : « 16,42 $ » en français (virgule décimale,
 * espace insécable avant le symbole), « $16.42 » en anglais. `toFixed(2) + ' $'` rendait « 16.42 $ »
 * même en français — repéré en relisant l'écran Réglages (2026-09-10).
 */
export function formaterMontant(valeur: number, locale = 'fr-CA', decimales = 2): string {
  if (!Number.isFinite(valeur)) return '—';
  // USD : les coûts viennent de l'API Anthropic, jamais d'un montant canadien.
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(valeur);
}

const MAX_RESULTATS_MOCK = 50;
const MAX_SOUS_DOSSIERS_MOCK_DEFAUT = 80;

function normaliserRecherche(texte: string): string {
  return texte.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Recherche pure sur l'arbre mock (`ENFANTS_MOCK`) pour `MODE_MOCK` (Playwright / démo locale).
 * Sans `dossierId` (ou `'root'`), parcourt tout l'arbre ; avec un `dossierId`, collecte en BFS
 * les sous-dossiers jusqu'à `maxSousDossiers` puis filtre tous les éléments directs collectés.
 */
export function rechercherDansArbreMock(
  enfantsParDossier: Record<string, ElementDrive[]>,
  texte: string,
  options?: { dossierId?: string; maxSousDossiers?: number },
): { elements: ElementDrive[]; tronque: boolean } {
  const aiguille = normaliserRecherche(texte);
  if (!aiguille) return { elements: [], tronque: false };

  const vus = new Map<string, ElementDrive>();
  let tronque = false;

  if (!options?.dossierId || options.dossierId === 'root') {
    for (const liste of Object.values(enfantsParDossier)) {
      for (const el of liste) {
        if (normaliserRecherche(el.name).includes(aiguille) && !vus.has(el.id)) {
          vus.set(el.id, el);
        }
      }
    }
  } else {
    const brutPlafond = options?.maxSousDossiers;
    const plafond = typeof brutPlafond === 'number' && Number.isFinite(brutPlafond)
      ? Math.max(1, Math.floor(brutPlafond))
      : MAX_SOUS_DOSSIERS_MOCK_DEFAUT;
    const dossiersVus = new Set<string>([options.dossierId]);
    const ordreDossiers: string[] = [options.dossierId];
    const file: string[] = [options.dossierId];

    while (file.length > 0 && !tronque) {
      const courant = file.shift()!;
      for (const el of enfantsParDossier[courant] ?? []) {
        if (!estDossier(el)) continue;
        if (dossiersVus.has(el.id)) continue;
        if (ordreDossiers.length >= plafond) {
          tronque = true;
          break;
        }
        dossiersVus.add(el.id);
        ordreDossiers.push(el.id);
        file.push(el.id);
      }
    }

    for (const id of ordreDossiers) {
      for (const el of enfantsParDossier[id] ?? []) {
        if (normaliserRecherche(el.name).includes(aiguille) && !vus.has(el.id)) {
          vus.set(el.id, el);
        }
      }
    }
  }

  const tries = trierElements(Array.from(vus.values()));
  if (tries.length > MAX_RESULTATS_MOCK) {
    return { elements: tries.slice(0, MAX_RESULTATS_MOCK), tronque: true };
  }
  return { elements: tries, tronque };
}

/** Filtres rapides côté client dans Explorateur et sur les résultats de recherche (P1-1). */
export type FiltreExplorateur = 'tout' | 'dossiers' | 'pdf' | 'a-verifier' | 'confiance-basse';

/** Liste ordonnée des pilules de filtre rapide. */
export const FILTRES_EXPLORATEUR: readonly FiltreExplorateur[] = [
  'tout',
  'dossiers',
  'pdf',
  'a-verifier',
  'confiance-basse',
] as const;

/**
 * Filtre en mémoire les éléments Drive déjà chargés (P1-1 — zéro appel réseau).
 * Les filtres orientés documents (`pdf`, `a-verifier`, `confiance-basse`) excluent les dossiers.
 */
export function filtrerElementsDrive(
  elements: ElementDrive[],
  filtre: FiltreExplorateur,
  indexParId?: ReadonlyMap<string, LigneIndex>,
): ElementDrive[] {
  switch (filtre) {
    case 'tout':
      return elements.slice();
    case 'dossiers':
      return elements.filter(estDossier);
    case 'pdf':
      return elements.filter((e) => !estDossier(e) && e.mimeType === 'application/pdf');
    case 'a-verifier':
      return elements.filter((e) => !estDossier(e) && indexParId?.get(e.id)?.statut === 'à vérifier');
    case 'confiance-basse':
      return elements.filter((e) => {
        if (estDossier(e)) return false;
        const ligne = indexParId?.get(e.id);
        return ligne !== undefined && estConfianceBasse(ligne);
      });
  }
}

/**
 * Reconstruit le fil d'Ariane exact d'un dossier dans l'arbre mock (`ENFANTS_MOCK`) via un BFS
 * protégé contre les cycles depuis `'root'` (P1-2, compatibilité `MODE_MOCK`).
 */
export function resoudreArianeDansArbreMock(
  enfantsParDossier: Record<string, ElementDrive[]>,
  dossierId: string,
  nomRacine = 'Mon Drive',
  nomCible?: string,
): Etape[] {
  const racine: Etape = { id: 'root', nom: nomRacine };
  if (!dossierId || dossierId === 'root') return [racine];

  const vus = new Set<string>(['root']);
  const file: Etape[][] = [[racine]];

  while (file.length > 0) {
    const chemin = file.shift()!;
    const courant = chemin[chemin.length - 1];
    for (const el of enfantsParDossier[courant.id] ?? []) {
      if (!estDossier(el) || vus.has(el.id)) continue;
      const suivant: Etape[] = [...chemin, { id: el.id, nom: el.name }];
      if (el.id === dossierId) return suivant;
      vus.add(el.id);
      file.push(suivant);
    }
  }

  return [racine, { id: dossierId, nom: nomCible ?? dossierId }];
}
