/**
 * etat.ts — lecture TYPÉE de l'état DriveAI (la Google Sheet) : Santé, Index, Journal, Entités.
 *
 * PUR côté parsing (testé) : les fonctions `interpreter*` transforment des lignes brutes
 * (string[][]) en modèles — aucun appel réseau ici, `charger*` (effectful) vit dans les vues.
 * ADR-0007 : on ne lit que des MÉTADONNÉES (l'état n'a jamais contenu de corps de document).
 */

import { normaliserCle } from './garde-fous';

/* ---------- Santé (onglet lisible, lignes structurées de Journal.gs) ---------- */

export interface EtatCompteLlm {
  statut: 'actif' | 'panne' | 'inconnu';
  detail: string;
}

export interface EtatTriGmailSante {
  statut: 'normal' | 'arret' | 'inconnu';
  detail: string;
}

export interface LigneMaintenanceSante {
  cle: 'rangement' | 'doublons' | 'reanalyse' | 'resolutionFileId';
  libelle: string;
  detail: string;
  ligneComplete: string;
}

export interface Sante {
  lignes: string[];
  dernierePasseOk: string;
  compteLlm: EtatCompteLlm;
  triGmailSante: EtatTriGmailSante;
  maintenanceSante: LigneMaintenanceSante[];
}

export type EtatSante = Sante;

function parserCompteLlmSante(lignes: string[]): EtatCompteLlm {
  for (const l of lignes) {
    const m = /^Compte LLM\s*:\s*(.+)$/i.exec(l);
    if (!m) continue;
    const detail = m[1].trim();
    if (/indéterminé|illisible/i.test(detail)) return { statut: 'inconnu', detail };
    if (/^actif\b/i.test(detail)) return { statut: 'actif', detail };
    if (/panne/i.test(detail) || detail.includes('⛔')) return { statut: 'panne', detail };
    return { statut: 'inconnu', detail };
  }
  return { statut: 'inconnu', detail: '' };
}

function parserTriGmailSante(lignes: string[]): EtatTriGmailSante {
  for (const l of lignes) {
    const m = /^Tri Gmail\s*:\s*(.+)$/i.exec(l);
    if (!m) continue;
    const detail = m[1].trim();
    if (/indéterminé|illisible/i.test(detail)) return { statut: 'inconnu', detail };
    if (/À L['’]ARRÊT|panne/i.test(detail) || detail.includes('⛔')) return { statut: 'arret', detail };
    if (/\bnormal\b/i.test(detail) || detail.includes('✅')) return { statut: 'normal', detail };
    return { statut: 'inconnu', detail };
  }
  return { statut: 'inconnu', detail: '' };
}

function parserMaintenanceSante(lignes: string[]): LigneMaintenanceSante[] {
  const sorties: LigneMaintenanceSante[] = [];
  const motifs: Array<{
    cle: LigneMaintenanceSante['cle'];
    libelle: string;
    re: RegExp;
  }> = [
    { cle: 'rangement', libelle: 'Rangement ancien Drive', re: /^Rangement ancien Drive\s*:\s*(.+)$/i },
    { cle: 'doublons', libelle: 'Doublons (validation par empreinte)', re: /^Doublons(?:\s*\([^)]*\))?\s*:\s*(.+)$/i },
    { cle: 'reanalyse', libelle: 'Re-datation de 06', re: /^Re-datation de 06\s*:\s*(.+)$/i },
    { cle: 'resolutionFileId', libelle: 'Résolution des identifiants', re: /^Résolution des identifiants(?:\s*\([^)]*\))?\s*:\s*(.+)$/i },
  ];
  for (const l of lignes) {
    for (const mDef of motifs) {
      const m = mDef.re.exec(l);
      if (m) {
        sorties.push({
          cle: mDef.cle,
          libelle: mDef.libelle,
          detail: m[1].trim(),
          ligneComplete: l,
        });
        break;
      }
    }
  }
  return sorties;
}

export function interpreterSante(brut: string[][]): Sante {
  const lignes = brut.map((l) => l[0] ?? '').filter(Boolean);
  return {
    lignes,
    dernierePasseOk: dernierPassageDepuisSante(lignes),
    compteLlm: parserCompteLlmSante(lignes),
    triGmailSante: parserTriGmailSante(lignes),
    maintenanceSante: parserMaintenanceSante(lignes),
  };
}

/* ---------- Index (catalogue) ---------- */

export interface LigneIndex {
  cle: string;
  traiteLe: string;
  fichier: string;
  domaine: string;
  chemin: string;
  statut: string;
  confiance: string; // colonne H (#17) — '' pour les lignes sans classification LLM
}

/**
 * Statut PRODUIT lisible : les statuts TECHNIQUES du reset (`tri33-route`, `tri33-04-route`,
 * `tri33-doublon`, `tri33-reste`…) sont ramenés à leur sens fonctionnel. Nécessaire depuis que
 * `cleEtatIndex` regroupe les états d'un fichier sur le fichier : sans ça, un doc RANGÉ par le reset
 * (statut `tri33-route`) ne comptait plus comme « classé » → il disparaissait de « derniers
 * classements » (accueil) et polluait le sélecteur de statuts (revue Vague 1 app 2026-07-31). Les
 * gardes rares (protégé, multi-parents, écart, absent) gardent leur libellé technique. PURE.
 */
export function statutLisible(statut: string): string {
  switch (statut) {
    case 'tri33-route': case 'tri33-04-route': return 'classé';
    case 'tri33-doublon': return 'doublon';
    case 'tri33-reste': case 'tri33-04-reste': return 'à trier';
    default: return statut;
  }
}

export function interpreterIndex(brut: string[][]): LigneIndex[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({
      cle: l[0] ?? '',
      traiteLe: l[1] ?? '',
      fichier: l[2] ?? '',
      domaine: l[3] ?? '',
      chemin: l[4] ?? '',
      statut: statutLisible(l[5] ?? ''),
      confiance: l[7] ?? '',
    }));
}

/**
 * Identité d'ÉTAT d'une ligne d'Index (P1/C28-02) : l'Index est APPEND-ONLY côté moteur — un même
 * fil Gmail (clé `tri|<fil>|<ts>|<lu>`, une ligne PAR état) ou un même fichier re-traité
 * (`drive|<id>` puis `migre|<tag>|<id>`, ou ligne de réconciliation future) produit PLUSIEURS
 * lignes. Pour afficher l'ÉTAT COURANT, on regroupe par l'entité réelle : le FIL pour le tri,
 * le FICHIER pour drive/shared/migre. Les autres clés (messageId|…, tache|, important|,
 * dryrunv2|… — de simples marqueurs) restent leur propre identité : jamais fusionnées, et le
 * rapport dry-run n'écrase JAMAIS l'état réel d'un fichier. PURE.
 */
// Familles de clés dont le fileId est TOUJOURS le DERNIER segment (reset C28-33 + campagnes) : un
// même fichier y produit plusieurs lignes d'état successives (`drive|id`, puis `tri33|tag|id`,
// `tri33p|tag|version|id`, `tri33llm|…`, `tri33-04|…`, `reanalyse|tag|id`, `nonroute|version|id`).
// Sans les regrouper sur le fichier, un doc apparaissait 2-4 fois pendant le reset → « +N
// aujourd'hui » gonflé ×2-3 et recherche polluée (revue de fond 2026-07-31).
const PREFIXES_FICHIER_DERNIER_SEG = ['tri33', 'tri33p', 'tri33llm', 'tri33-04', 'reanalyse', 'nonroute'];

export function cleEtatIndex(cle: string): string {
  const seg = cle.split('|');
  if (seg[0] === 'tri' && seg[1]) return 'fil|' + seg[1];
  if ((seg[0] === 'drive' || seg[0] === 'shared') && seg[1]) return 'fichier|' + seg[1];
  if (seg[0] === 'migre' && seg[2]) return 'fichier|' + seg[2];
  if (PREFIXES_FICHIER_DERNIER_SEG.indexOf(seg[0]) !== -1 && seg.length >= 2) {
    return 'fichier|' + seg[seg.length - 1]; // le fileId clôt toujours ces clés → même fichier regroupé
  }
  return cle;
}

/**
 * ÉTAT COURANT de l'Index : pour chaque entité (fil, fichier), seule la ligne la plus RÉCENTE
 * (la plus basse dans la Sheet — l'Index est append-only chronologique) est conservée. C'est ce
 * qui rend la section « ⚠ Suspects » honnête : un fil marqué suspect PUIS trié n'apparaît plus
 * comme suspect (C28-02/13, plan P1). PURE.
 */
export function etatCourantIndex(lignes: LigneIndex[]): LigneIndex[] {
  const parCle = new Map<string, LigneIndex>();
  for (const l of lignes) {
    const k = cleEtatIndex(l.cle);
    // delete AVANT set : une Map conserve la position d'insertion INITIALE d'une clé ré-écrite,
    // or les vues supposent ordre de liste = chronologie (`.reverse().slice(0, N)` « récents ») —
    // une entité re-traitée doit donc être RÉ-INSÉRÉE en fin, pas mise à jour en place.
    parCle.delete(k);
    parCle.set(k, l);
  }
  return [...parCle.values()];
}

/* ---------- Journal (dernières activités) ---------- */

export interface LigneJournal {
  date: string;
  niveau: string;
  source: string;
  message: string;
}

export function interpreterJournal(brut: string[][]): LigneJournal[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({ date: l[0] ?? '', niveau: l[1] ?? '', source: l[2] ?? '', message: l[3] ?? '' }));
}

/** Domaines distincts observés dans l'Index (pour les sélecteurs — zéro config dupliquée). */
export function domainesDepuisIndex(lignes: LigneIndex[]): string[] {
  return Array.from(new Set(lignes.map((l) => l.domaine).filter(Boolean))).sort();
}

/* ---------- Recherche structurée (C9-07, ADR-0008 §3) — filtres PURS sur l'Index ---------- */

export interface CriteresRecherche {
  texte?: string;   // sous-chaîne (normalisée) du nom de fichier OU du chemin
  domaine?: string; // égalité stricte
  statut?: string;  // égalité stricte (classé, doublon, quarantaine…)
  annee?: string;   // année du DOCUMENT (préfixe AAAA du nom conventionnel), pas du traitement
}

/**
 * Filtre l'Index selon des critères combinés (ET). PUR — zéro appel réseau, zéro ré-indexation :
 * l'Index existant EST la base de recherche (métadonnées seules, ADR-0007).
 */
export function filtrerIndex(lignes: LigneIndex[], criteres: CriteresRecherche): LigneIndex[] {
  const texte = normaliserCle(criteres.texte ?? '');
  return lignes.filter((l) => {
    if (criteres.domaine && l.domaine !== criteres.domaine) return false;
    if (criteres.statut && l.statut !== criteres.statut) return false;
    if (criteres.annee && !l.fichier.startsWith(criteres.annee)) return false;
    if (texte && !normaliserCle(l.fichier).includes(texte) && !normaliserCle(l.chemin).includes(texte)) return false;
    return true;
  });
}

/** Statuts distincts observés (pour le sélecteur). */
export function statutsDepuisIndex(lignes: LigneIndex[]): string[] {
  return Array.from(new Set(lignes.map((l) => l.statut).filter(Boolean))).sort();
}

/** Années de DOCUMENT observées (préfixe AAAA des noms conventionnels), plus récentes d'abord. */
export function anneesDepuisIndex(lignes: LigneIndex[]): string[] {
  const annees = new Set<string>();
  for (const l of lignes) {
    const m = l.fichier.match(/^(\d{4})(-\d{2}){0,2}_/);
    if (m) annees.add(m[1]);
  }
  return Array.from(annees).sort().reverse();
}

/**
 * Extrait le fileId Drive d'une clé d'Index quand elle en porte un : `drive|<id>`,
 * `migre|<tag>|<id>` ou les familles `PREFIXES_FICHIER_DERNIER_SEG` (`tri33*`, `reanalyse`,
 * `nonroute`). `shared|<id>` porte l'ID de l'ORIGINAL partagé (pas de la copie classée) et les
 * clés Gmail / marqueurs n'en portent pas → ''.
 */
export function fileIdDepuisCle(cle: string): string {
  if (!cle) return '';
  const seg = cle.split('|');
  if (seg[0] === 'drive') {
    return seg.length === 2 ? seg[1].trim() : '';
  }
  if (seg[0] === 'migre') {
    return seg.length === 3 && seg[1].trim() !== '' ? seg[2].trim() : '';
  }
  if (PREFIXES_FICHIER_DERNIER_SEG.includes(seg[0]) && seg.length >= 2) {
    if (seg.slice(1, -1).some((s) => s.trim() === '')) return '';
    return seg[seg.length - 1].trim();
  }
  return '';
}

/**
 * Indexe les lignes d'Index par fileId Drive (O(1) pour les pastilles et filtres Explorateur).
 * Ignore les lignes sans fileId (`shared|`, `tri|`, `dryrunv2|`, etc.) ; en cas de lignes
 * multiples, la dernière rencontrée l'emporte.
 */
export function indexParFileId(lignes: LigneIndex[]): Map<string, LigneIndex> {
  const parId = new Map<string, LigneIndex>();
  for (const l of lignes) {
    const id = fileIdDepuisCle(l.cle);
    if (!id) continue;
    parId.delete(id);
    parId.set(id, l);
  }
  return parId;
}

/**
 * Lien Drive pour une ligne d'Index : le FICHIER lui-même quand la clé porte son ID, sinon une
 * recherche Drive sur le nom exact (dégradation propre — le nom conventionnel est très discriminant).
 */
export function lienDrivePourLigne(l: LigneIndex): string {
  const id = fileIdDepuisCle(l.cle);
  if (id) return `https://drive.google.com/file/d/${id}/view`;
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(`"${l.fichier}"`)}`;
}

/* ---------- Phase 3 visible (C13, ADR-0010 §2) : mails importants ---------- */

/** Mails marqués IMPORTANTS par le mini-check (#14) — clés `important|<messageId>`, `fichier` = sujet. */
export function lignesImportants(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'important').slice().reverse();
}

/** Statut posé PAR L'APP (v7, bouton « Fait ») sur la clé `important|<id>` : le mail sort de « À faire ». */
export const STATUT_IMPORTANT_FAIT = 'important-fait';

/**
 * Mails ⏰ encore À FAIRE (accueil v7) : importants, PAS marqués « fait » (une ligne `important-fait`
 * ajoutée par l'app remplace l'état courant de la clé), et vus depuis moins de `jours` jours — sans
 * fenêtre, `important|` n'étant jamais mis à jour par le moteur, la liste ne se viderait jamais
 * (revue flotte PR 1 : « déchets permanents »). Récents d'abord. PURE.
 */
export function importantsAFaire(lignes: LigneIndex[], maintenant: Date, jours = 7): LigneIndex[] {
  const seuil = maintenant.getTime() - jours * 24 * 60 * 60 * 1000;
  return lignesImportants(lignes).filter((l) => {
    const t = Date.parse(l.traiteLe);
    return !Number.isNaN(t) && t >= seuil;
  });
}

/**
 * Lien Gmail d'une ligne dont la clé porte un messageId (`important|<id>`, `tache|<id>|<hash>`,
 * `event|<id>|<hash>`, `intention|<id>`) — '' sinon. `#all` couvre aussi les mails archivés.
 */
export function lienGmailPourLigne(l: LigneIndex): string {
  const m = l.cle.match(/^(?:important|intention|tache|event|tri)\|([^|]+)/);
  return m ? `https://mail.google.com/mail/#all/${m[1]}` : '';
}

/* ---------- App v3 (C19-04, ADR-0013) : signaux du tri Gmail ---------- */

/** Fils suspects (⚠ phishing possible) — laissés en boîte par le moteur (`tri|…`), récents d'abord. */
export function lignesSuspects(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'suspect' && /^tri\|/.test(l.cle)).slice().reverse();
}

/**
 * Documents routés en « 00 · À vérifier » (fail-safe hybride ADR-0016 — analyse sans AUCUN fait
 * exploitable), récents d'abord. Zone Attention de l'accueil v4 (C28-17) : c'est le « à faire »
 * de Marc, pas une erreur du moteur.
 */
export function lignesAVerifier(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'à vérifier').slice().reverse();
}

/** Documents (hors lignes mail) traités un JOUR calendaire local donné. */
export function traitesLeJour(lignes: LigneIndex[], jour: Date): number {
  const cle = `${jour.getFullYear()}-${String(jour.getMonth() + 1).padStart(2, '0')}-${String(jour.getDate()).padStart(2, '0')}`;
  let n = 0;
  for (const l of lignes) {
    const t = Date.parse(l.traiteLe);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const c = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (c === cle) n++;
  }
  return n;
}

/**
 * Coût LLM du mois depuis l'onglet Santé (ligne « Coût LLM 2026-07 : 7.34 $  (2296 appels) … »).
 * null si la ligne manque — la tuile se dégrade proprement (jamais un faux 0 $).
 */
export function coutDepuisSante(lignesSante: string[]): { dollars: number; appels: number } | null {
  for (const l of lignesSante) {
    const m = l.match(/Coût LLM [^:]*: ([\d.,]+) \$\s*\((\d+) appels?\)/);
    if (!m) continue;
    const dollars = Number(m[1].replace(',', '.'));
    const appels = Number(m[2]);
    if (Number.isFinite(dollars) && Number.isFinite(appels)) {
      return { dollars, appels };
    }
  }
  return null;
}

/**
 * Les trois chiffres de Réglages (v7) — calculés depuis l'Index en ÉTAT COURANT (dédoublonné), pas
 * depuis l'onglet Santé : ses lignes sont du texte libre (« Documents au catalogue (Index) : N »
 * compte AUSSI les clés tri/important) et changent avec le moteur — revue flotte PR 1. PURE.
 *  - documentsClasses : documents (hors lignes mail) au statut « classé » ;
 *  - mailsTries : fils `tri|…` triés (catégorisés ou « À vérifier »).
 */
export function compteursIndex(lignes: LigneIndex[]): { documentsClasses: number; mailsTries: number } {
  let documentsClasses = 0;
  let mailsTries = 0;
  for (const l of lignes) {
    if (/^tri\|/.test(l.cle)) {
      if (l.statut === 'trié' || l.statut === 'tri-a-verifier') mailsTries++;
    } else if (!/^(intention|tache|event|important|tri-abandon)\|/.test(l.cle) && l.statut === 'classé') {
      documentsClasses++;
    }
  }
  return { documentsClasses, mailsTries };
}

/** « Dernier passage OK : … » depuis l'onglet Santé — '' si absent. */
export function dernierPassageDepuisSante(lignesSante: string[]): string {
  for (const l of lignesSante) {
    const m = l.match(/Dernier passage OK\s*:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return '';
}

/* ---------- Fraîcheur du moteur (C28-41 : pastille topbar + page Moteur) ---------- */

export type EtatMoteur = 'ok' | 'retard' | 'mort' | 'inconnu';

/**
 * Minutes écoulées depuis « Dernier passage OK : AAAA-MM-JJ HH:mm » (heure LOCALE du moteur —
 * même fuseau que le navigateur de Marc). null si la ligne manque ou est illisible : la pastille
 * dit alors « inconnu », jamais un faux vert.
 */
export function ageMoteurMinutes(lignesSante: string[], maintenant: Date): number | null {
  const texte = dernierPassageDepuisSante(lignesSante);
  const m = texte.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const diff = (maintenant.getTime() - d.getTime()) / 60000;
  if (Number.isNaN(diff)) return null;
  return Math.max(0, Math.round(diff));
}

/**
 * État de la pastille moteur, DÉRIVÉ de la fréquence de tick RÉGLÉE (jamais des valeurs du jour —
 * leçon §7 « cas dérivés de la constante ») : en retard au-delà de ~4 ticks manqués (min 20 min —
 * un run manuel de Marc tient le verrou ~5 min), silencieux au-delà de ~18 ticks (min 90 min).
 */
export function fraicheurMoteur(lignesSante: string[], maintenant: Date, tickMinutes = 5): EtatMoteur {
  const age = ageMoteurMinutes(lignesSante, maintenant);
  if (age === null) return 'inconnu';
  const tick = Number.isFinite(tickMinutes) && tickMinutes > 0 ? tickMinutes : 5;
  const seuilRetard = Math.max(20, tick * 4);
  const seuilMort = Math.max(90, tick * 18);
  if (age <= seuilRetard) return 'ok';
  if (age <= seuilMort) return 'retard';
  return 'mort';
}

/* ---------- Confiance (#17, C19-07) ---------- */

export const SEUIL_CONFIANCE_BASSE = 0.5;

/** Vrai si la ligne porte une confiance NUMÉRIQUE sous le seuil (« classé au mieux »). */
export function estConfianceBasse(l: LigneIndex): boolean {
  const brut = String(l.confiance ?? '').trim().replace(',', '.');
  if (brut === '') return false;
  const n = Number(brut);
  return Number.isFinite(n) && n < SEUIL_CONFIANCE_BASSE;
}

/* ---------- Santé v3 (C19-08) : signaux dérivés du Journal ---------- */

/** Vrai si le Journal du JOUR (local) contient une erreur de quota Gmail quotidien. */
export function quotaGmailEpuise(journal: LigneJournal[], maintenant: Date): boolean {
  const jour = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`;
  return journal.some((l) => {
    if (!l.message.includes('too many times') || !l.message.toLowerCase().includes('gmail')) return false;
    const t = Date.parse(l.date);
    if (Number.isNaN(t)) return false;
    const d = new Date(t);
    const c = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return c === jour;
  });
}

// Sources retirées (ADR-0078 / #955) : leurs erreurs historiques du Journal ne doivent plus
// polluer « Points d'attention » ni le compteur « Erreurs · 7 jours ».
const SOURCES_JOURNAL_RETIREES = new Set(['Hub']);

/** ERREURS du Journal des `jours` derniers jours, dans l'ordre du Journal. PURE. */
export function erreursDesDerniersJours(journal: LigneJournal[], jours: number, maintenant: Date): LigneJournal[] {
  const seuil = maintenant.getTime() - jours * 24 * 60 * 60 * 1000;
  return journal.filter((l) => {
    if (l.niveau !== 'ERREUR') return false;
    if (SOURCES_JOURNAL_RETIREES.has(l.source)) return false;
    const t = Date.parse(l.date);
    return !Number.isNaN(t) && t >= seuil;
  });
}

/** Nombre d'ERREURS du Journal sur les `jours` derniers jours. */
export function erreursRecentes(journal: LigneJournal[], jours: number, maintenant: Date): number {
  return erreursDesDerniersJours(journal, jours, maintenant).length;
}

const CLE_ERREURS_VUES = 'driveai.erreursVues';
const MAX_ERREURS_VUES = 64;

/**
 * Empreinte compacte d'une alerte du Journal (date + source + hachage FNV-1a 32 bits du message).
 * Ne stocke aucun texte brut ni nom de fichier dans `localStorage`. PURE.
 */
export function cleErreurJournal(l: LigneJournal): string {
  let h = 2166136261;
  const msg = String(l.message || '');
  for (let i = 0; i < msg.length; i++) {
    h ^= msg.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${l.date}|${l.source}|${(h >>> 0).toString(16)}`;
}

export interface GroupeErreurJournal {
  derniere: LigneJournal;
  occurrences: number;
  cles: string[];
}

/**
 * Regroupe les erreurs identiques `(source, message)` en conservant l'occurrence la plus récente
 * en tête, afin de ne pas noyer l'écran État sous N lignes identiques. PURE.
 */
export function grouperErreursJournal(lignes: LigneJournal[]): GroupeErreurJournal[] {
  const groupes = new Map<string, GroupeErreurJournal>();
  for (let i = lignes.length - 1; i >= 0; i--) {
    const l = lignes[i];
    const cleGroupe = `${l.source}\0${l.message}`;
    const cleItem = cleErreurJournal(l);
    const existant = groupes.get(cleGroupe);
    if (existant) {
      existant.occurrences += 1;
      existant.cles.push(cleItem);
    } else {
      groupes.set(cleGroupe, { derniere: l, occurrences: 1, cles: [cleItem] });
    }
  }
  return Array.from(groupes.values());
}

/** Lit la liste des empreintes d'alertes marquées « Vu » dans `localStorage` (repli `[]`). */
export function lireErreursVues(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const brut = localStorage.getItem(CLE_ERREURS_VUES);
    if (!brut) return [];
    const parsed = JSON.parse(brut) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .slice(-MAX_ERREURS_VUES);
  } catch {
    return [];
  }
}

/** Enregistre localement les alertes marquées « Vu » (borné FIFO à 64 entrées, sans PII). */
export function enregistrerErreursVues(cles: string[]): void {
  const propres = Array.from(
    new Set(cles.filter((x) => typeof x === 'string' && x.length > 0)),
  ).slice(-MAX_ERREURS_VUES);
  try {
    if (typeof localStorage === 'undefined') return;
    if (propres.length === 0) localStorage.removeItem(CLE_ERREURS_VUES);
    else localStorage.setItem(CLE_ERREURS_VUES, JSON.stringify(propres));
  } catch {
    /* stockage indisponible ou quota atteint : dégradation silencieuse */
  }
}

/* ---------- Réorg IA (#21, C21-05) : plan proposé par le moteur, validé ici ---------- */

export interface LigneReorg {
  ligneSheet: number; // 1-based (en-tête = 1) — cible des écritures de Statut
  cle: string;
  type: string;       // 'demande' | 'deplacer' | 'fusionner' | 'creer' | 'renommer'
  id: string;
  cheminActuel: string;
  cheminPropose: string;
  statut: string;     // demande : 'analyse demandée'|'proposé'|'échec' ; action : machine à états Reorg.gs
  detail: string;     // demande : portée puis synthèse ; action : raison du LLM
  horodate: string;
}

/** Interprète l'onglet Réorg (Clé|Type|ID|Chemin actuel|Chemin proposé|Statut|Détail|Horodaté). */
export function interpreterReorg(brut: string[][]): LigneReorg[] {
  const lignes: LigneReorg[] = [];
  for (let i = 0; i < brut.length; i++) {
    const l = brut[i];
    if (!l[0]) continue;
    lignes.push({
      ligneSheet: i + 2,
      cle: l[0] ?? '',
      type: l[1] ?? '',
      id: l[2] ?? '',
      cheminActuel: l[3] ?? '',
      cheminPropose: l[4] ?? '',
      statut: l[5] ?? '',
      detail: l[6] ?? '',
      horodate: l[7] ?? '',
    });
  }
  return lignes;
}

/** La demande d'analyse la plus récente (le moteur ne traite que celle-là). */
export function derniereDemandeReorg(lignes: LigneReorg[]): LigneReorg | null {
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (lignes[i].type === 'demande') return lignes[i];
  }
  return null;
}

/**
 * Vrai si la dernière demande de réorg en échec mérite encore l'attention de Marc.
 * L'ancien échec « portée trop large » est obsolète depuis le contournement BFS côté moteur.
 */
export function demandeReorgEnEchecAffichable(demande: LigneReorg | null): boolean {
  if (!demande || demande.statut !== 'échec') return false;
  return !/portée trop large/i.test(demande.detail);
}

/** Les actions du plan d'une demande (préfixe de clé `reorg|<cléDemande>|`). */
export function actionsDuPlan(lignes: LigneReorg[], cleDemande: string): LigneReorg[] {
  const prefixe = `reorg|${cleDemande}|`;
  return lignes.filter((l) => l.cle.startsWith(prefixe));
}

/**
 * Les opérations PROPOSÉES par l'assistant chat (C28-30 PR2) — clé `chatreorg|<ts>|<n>`, statut
 * `proposé`. Contrairement aux plans réorg (`actionsDuPlan`), elles ne dépendent d'AUCUNE ligne
 * `demande` : le chat les écrit directement dans l'onglet Réorg pour que Marc les valide par action.
 * Les plus récentes d'abord (tri décroissant sur la clé = ordre d'insertion inverse).
 */
export function actionsProposeesChat(lignes: LigneReorg[]): LigneReorg[] {
  return lignes
    .filter((l) => l.cle.startsWith('chatreorg|') && l.statut === 'proposé')
    .sort((a, b) => b.cle.localeCompare(a.cle));
}

/**
 * Les actions que Marc a VALIDÉES et que le moteur a ensuite REFUSÉES (`refusé (zone protégée)`,
 * `refusé (structure)`) ou RATÉES (`échec`) — plan courant + chat. La v7 n'affiche plus l'historique
 * des actions décidées (fini = poubelle), mais un refus n'est PAS une action finie : une carte validée
 * qui disparaît à l'instant puis échoue en silence laisserait croire qu'elle est appliquée (revue
 * flotte PR 4). Elles restent visibles jusqu'à ce que Marc les écarte (« OK ») ou qu'une nouvelle
 * analyse remplace le plan. Ordre du plan, chat en tête (plus récent d'abord).
 */
export function actionsRefuseesReorg(lignes: LigneReorg[], cleDemande: string | null): LigneReorg[] {
  const refus = (l: LigneReorg) => /^(refusé|échec)/.test(l.statut);
  const prefixe = cleDemande ? `reorg|${cleDemande}|` : null;
  const chat = lignes.filter((l) => l.cle.startsWith('chatreorg|') && refus(l)).sort((a, b) => b.cle.localeCompare(a.cle));
  const plan = prefixe ? lignes.filter((l) => l.cle.startsWith(prefixe) && refus(l)) : [];
  return [...chat, ...plan];
}

/**
 * Regroupe des numéros de lignes Sheet en PLAGES CONTIGUËS (écriture par lot de la colonne
 * Statut : une plage = un PUT — jamais un batchUpdate, jamais une ligne non sélectionnée
 * écrasée). Entrée dédupliquée et triée ici (copie).
 */
export function plagesContigues(lignesSheet: number[]): { debut: number; fin: number }[] {
  const tri = Array.from(new Set(lignesSheet)).sort((a, b) => a - b);
  const plages: { debut: number; fin: number }[] = [];
  for (const n of tri) {
    const derniere = plages[plages.length - 1];
    if (derniere && n === derniere.fin + 1) derniere.fin = n;
    else plages.push({ debut: n, fin: n });
  }
  return plages;
}

/** Les dossiers devenus VIDES par fusion, en attente de la décision corbeille de Marc (ADR-0014). */
export function lignesVideCandidat(lignes: LigneReorg[]): LigneReorg[] {
  return lignes.filter((l) => l.type === 'dossier-vide' && l.statut === 'vide-candidat');
}

/**
 * Statuts de verdict d'un dossier BLOQUÉ pour la corbeille (ADR-0014, `statutRefusCorbeille`
 * côté `corbeille.ts`) : `vide-disparu`/`vide-protégé`/`vide-droits-refusés` sont DÉFINITIFS,
 * `vide-repris` est le SEUL révisable (un dossier re-rempli peut redevenir `vide-candidat` plus
 * tard). Une fois qu'une de ces lignes quitte `videsCandidats`, elle disparaissait de TOUT écran
 * — Marc ne pouvait plus voir POURQUOI, seulement recompter (idée acceptée par Marc, 29/09).
 */
const STATUTS_CORBEILLE_BLOQUE = ['vide-disparu', 'vide-protégé', 'vide-droits-refusés', 'vide-repris'] as const;

/** Les dossiers REFUSÉS par la corbeille, avec leur verdict — filtre « Bloqués » de la vue Réorg. */
export function lignesVideBloquee(lignes: LigneReorg[]): LigneReorg[] {
  return lignes.filter((l) => l.type === 'dossier-vide' &&
    (STATUTS_CORBEILLE_BLOQUE as readonly string[]).includes(l.statut));
}

/**
 * La carte « dossiers vides » est-elle rendue ? (C28-110, 🔴 revue sécurité ADR-0056)
 *
 * Gatée sur les seuls candidats restants, elle se DÉMONTAIT au succès complet : `corbeillerLot`
 * passe chaque ligne traitée à `corbeillé`, donc à la dernière la liste devient vide, la carte
 * disparaît — et le bilan écrit juste après n'a plus rien qui le rende. Le compte rendu n'était
 * alors visible QUE s'il restait des échecs, c'est-à-dire jamais sur le cas nominal : le défaut
 * d'origine de C28-93, déplacé d'un cran. La carte reste tant qu'il y a quelque chose à DIRE ;
 * seule la LISTE dépend des candidats restants.
 */
export function carteVidesVisible(
  nbCandidats: number,
  retour: { erreur?: string | null; bilan?: string | null; avancement?: unknown },
): boolean {
  return nbCandidats > 0 || !!retour.erreur || !!retour.bilan || !!retour.avancement;
}

/* ---------- Progression LIVE des opérations (C28-18) ---------- */

/** Miroir d'une ligne de l'onglet Progression (COLONNES_PROGRESSION, Journal.gs — 10 colonnes C28-44). */
export interface LigneProgression {
  cle: string;         // clé stable ('migration', 'tri-gmail', …) — sélectionne le widget/libellé
  operation: string;   // libellé FR écrit par le moteur (repli d'affichage)
  traites: number;
  base: number | null; // null = total inconnu (historique Gmail) OU opération sans compteur → pas de barre
  unite: string;       // 'documents' | 'fils' | 'fichiers' | 'entités' | …
  statut: string;      // familles ci-dessous + 'erreur' | 'désactivée' | 'jamais vue' (C28-44)
  horodate: string;
  detail: string;          // raison du dernier SKIP ('reset en cours', 'budget de tick épuisé'…) ou ''
  derniereActivite: string; // dernier passage RÉEL, format contrôlé 'dd/MM HH:mm' — '' si jamais vue
  derniereErreur: string;   // 'dd/MM HH:mm — message' ou '' — reste visible même après un succès
  type: string;            // type du registre (flux/campagne/maintenance/demande/observabilite) — '' si ancien moteur
  dernierePasse: string;   // « +23 documents · il y a 6 min » (dernière passe PRODUCTIVE) ou ''
  finEstimee: string;      // « reste 885 documents · ~4 j · vers le 18/08 · reprise le 01/09 » ou ''
}

/**
 * Interprète l'onglet Progression (Clé|Opération|Traités|Base|Unité|Statut|Horodaté|Détail|
 * Dernière activité|Dernière erreur). PURE. TOLÉRANTE aux lignes 7 colonnes (transition
 * moteur pas encore redéployé → colonnes H-J absentes, champs vides).
 */
export function interpreterProgression(brut: string[][]): LigneProgression[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({
      cle: l[0] ?? '',
      operation: l[1] ?? '',
      traites: nombreFiniOuNull(l[2]) ?? 0,
      base: nombreFiniOuNull(l[3]),
      unite: l[4] ?? '',
      statut: l[5] ?? '',
      horodate: l[6] ?? '',
      detail: l[7] ?? '',
      derniereActivite: l[8] ?? '',
      derniereErreur: l[9] ?? '',
      type: l[10] ?? '',
      dernierePasse: l[11] ?? '',
      finEstimee: l[12] ?? '',
    }));
}

export type FamilleStatut = 'encours' | 'suspendu' | 'pause' | 'attente' | 'termine' | 'recensement'
  | 'erreur' | 'inactif' | 'ajour';

/**
 * Famille visuelle d'un statut moteur (préfixe FR stable) — pilote la pastille du widget. PURE.
 * C28-44 : + 'erreur' (dernier passage en échec — pastille critique) et 'inactif' (« jamais vue »
 * après un déploiement, « désactivée » par CONFIG — neutre, ce n'est PAS un problème).
 * C28-45 : + 'ajour' (« à jour (déjà fait) », « à jour (plan drainé — attend la génération) ») —
 * neutre-POSITIF : le travail est fait, l'opération attend légitimement (jamais une alerte).
 */
export function familleStatut(statut: string): FamilleStatut {
  if (statut === 'erreur') return 'erreur';
  if (statut === 'jamais vue' || statut === 'désactivée') return 'inactif';
  if (statut.startsWith('à jour')) return 'ajour';
  if (statut.startsWith('suspendu')) return 'suspendu';
  if (statut.startsWith('en pause')) return 'pause';
  if (statut.startsWith('en attente')) return 'attente';
  if (statut.startsWith('terminé')) return 'termine';
  if (statut.startsWith('recensement')) return 'recensement';
  return 'encours';
}

/**
 * C28-46 (demande Marc : « seulement l'utile d'affiché, avec barres de progression à progrès
 * RÉELS ; tout l'inactif regroupé, cliquable, cachable ») : une opération est UTILE — affichée en
 * avant — si c'est un PROBLÈME (erreur, suspension), une COMPLÉTION récente (terminé — purgée
 * ensuite par le moteur), un recensement transitoire, ou un travail à PROGRÈS RÉEL (compteur).
 * Tout le reste est en VEILLE : accompli (« à jour »), désactivée, jamais vue, et les routines qui
 * tournent sans compteur — regroupées, repliées, explication au clic. PURE.
 */
export function estUtileProgression(op: LigneProgression): boolean {
  const f = familleStatut(op.statut);
  if (f === 'erreur' || f === 'suspendu') return true; // un problème est TOUJOURS visible
  // C28-50 (demande Marc : « je ne vois pas toutes les missions ») : une mission convergée AVEC
  // reliquat (« à jour (N non apparié(s)) ») n'est PAS un travail accompli — N fichiers attendent
  // un affinage de règles. Elle reste EN AVANT ; seul l'« à jour » sans reste part en veille.
  if (f === 'ajour') return op.statut.includes('non apparié');
  if (f === 'inactif') return false;  // désactivée / jamais vue → veille
  if (f === 'termine' || f === 'recensement') return true;
  return op.base !== null || op.traites > 0; // progrès réel à montrer — sinon routine qui tourne
}

/**
 * Complément PRÉCIS d'un statut moteur : le contenu de sa parenthèse terminale — « à jour (50 non
 * apparié(s)) » → « 50 non apparié(s) ». La famille (pastille) perd ce détail ; l'afficher rend la
 * ligne exacte sans re-dériver quoi que ce soit (source unique : le texte écrit par le moteur).
 * Parenthèses IMBRIQUÉES gérées par « première ouvrante → fin » (jamais une regex non-gourmande,
 * qui couperait « apparié(s » — C28-50). PURE. Sans parenthèse terminale → ''.
 */
export function complementStatut(statut: string): string {
  const i = statut.indexOf('(');
  return i >= 0 && statut.endsWith(')') ? statut.slice(i + 1, -1) : '';
}

/**
 * Horodatage moteur `dd/MM HH:mm` (format CONTRÔLÉ — PR6 : le moteur écrit du TEXTE, jamais une
 * cellule Date dont le rendu dépend de la locale de la Sheet) → Date. PURE. Année : celle de
 * `maintenant`, ou la précédente si le résultat serait dans le futur (passage d'année) ; après
 * bascule, un écart > ~360 j est un cas dégénéré (fuseau navigateur ≫ fuseau script — revue
 * C28-45) → null. Non-match → null (repli : texte brut).
 */
export function dateActivite(texte: string, maintenant: Date): Date | null {
  const m = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(texte);
  if (!m) return null;
  const d = new Date(maintenant.getFullYear(), Number(m[2]) - 1, Number(m[1]), Number(m[3]), Number(m[4]));
  if (d.getTime() > maintenant.getTime() + 60 * 60 * 1000) {
    d.setFullYear(d.getFullYear() - 1);
    if (maintenant.getTime() - d.getTime() > 360 * 24 * 3600000) return null;
  }
  return d;
}

/** « il y a X » depuis un horodatage moteur `dd/MM HH:mm`. PURE. null si illisible (repli brut). */
export function ilYA(texte: string, maintenant: Date, langue: 'fr' | 'en'): string | null {
  const d = dateActivite(texte, maintenant);
  if (!d) return null;
  const min = Math.max(0, Math.round((maintenant.getTime() - d.getTime()) / 60000));
  if (min < 60) return langue === 'fr' ? `il y a ${min} min` : `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return langue === 'fr' ? `il y a ${h} h` : `${h} h ago`;
  const j = Math.round(h / 24);
  return langue === 'fr' ? `il y a ${j} j` : `${j} d ago`;
}

/* ---------- Télémétrie coûts & quotas (C28-24) ---------- */

/** Jauge quotidienne d'un scan Gmail plafonné : fils lus aujourd'hui / plafond (Détail moteur). */
interface JaugeJour {
  lus: number;
  plafond: number | null; // null = Détail illisible (jauge affichée sans borne)
}

/**
 * Miroir de l'onglet Télémétrie (COLONNES_TELEMETRIE, Journal.gs) — clés STABLES écrites par
 * `lignesTelemetrie_` côté moteur : quota_gmail_etat, gmail_histo_fils_jour,
 * tri_cyclique_fils_jour, tri_boite_fils_jour, tri_histo_fils_jour, tri_anciens_fils_jour,
 * tri_fond_fils_jour, tri_archives_jour, llm_cout_mois, llm_appels_mois.
 * (`tri_demande_fils_jour` a disparu avec le tri à la demande — ADR-0031.)
 */
export interface Telemetrie {
  presente: boolean;        // l'onglet a des lignes (faux = moteur pas encore passé depuis le déploiement)
  quotaSuspendu: boolean;
  quotaDetail: string;      // « Reprise vers HH:mm » ('' quand actif)
  cycliqueJour: JaugeJour;  // balayage cyclique du tri
  histoJour: JaugeJour;     // campagne historique (PJ)
  boiteJour: JaugeJour;     // nettoyage profond de la boîte (mails lus > 30 j, C28-22)
  triHistoFilsJour: number | null; // campagne historique du tri Gmail (null si absente/illisible)
  triHistoJour: JaugeJour | null;  // jauge complète si tri_histo_fils_jour présent
  archivesJour: number | null;     // fils archivés aujourd'hui par le moteur (null si absent)
  anciensFilsJour: number | null;  // anciens fils lus (> 29 j) aujourd'hui (null si absent)
  anciensJour: JaugeJour | null;   // jauge si tri_anciens_fils_jour numérique
  fondFilsJour: number | null;     // somme consolidée des campagnes de fond (null si aucune donnée)
  fondJour: JaugeJour | null;      // jauge consolidée sous plafond commun (300/j)
  coutDollars: number | null;
  freinDollars: number | null; // « Frein campagnes à N $ » (Détail)
  appelsMois: number | null;
}

/** Extrait le nombre d'un Détail moteur (« Plafond 500/j », « Frein campagnes à 110 $ »). */
function nombreDuDetail(detail: string): number | null {
  const m = /([\d]+(?:[.,]\d+)?)/.exec(detail ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Extrait un nombre fini depuis une cellule Télémétrie (tolère virgule ; '' / '—' / non-numérique → null). */
function nombreFiniOuNull(valeur: string | undefined): number | null {
  const brut = String(valeur ?? '').trim().replace(',', '.');
  if (brut === '') return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}

/** Extrait un nombre fini et non négatif depuis une cellule Télémétrie (< 0 / non fini → null). */
function nombrePositifOuNull(valeur: string | undefined): number | null {
  const n = nombreFiniOuNull(valeur);
  return n !== null && n >= 0 ? n : null;
}

/** Interprète l'onglet Télémétrie (Clé|Valeur|Unité|Détail). PURE (testée). */
export function interpreterTelemetrie(brut: string[][]): Telemetrie {
  const parCle: Record<string, string[]> = {};
  for (const l of brut) { if (l[0]) parCle[l[0]] = l; }

  const jauge = (cle: string): JaugeJour => ({
    lus: nombrePositifOuNull(parCle[cle]?.[1]) ?? 0,
    plafond: nombreDuDetail(parCle[cle]?.[3] ?? ''),
  });
  const quota = parCle['quota_gmail_etat'];
  const cout = parCle['llm_cout_mois'];
  const appels = parCle['llm_appels_mois'];
  const triHisto = parCle['tri_histo_fils_jour'];
  let triHistoFilsJour: number | null = null;
  let triHistoJour: JaugeJour | null = null;
  if (triHisto) {
    triHistoFilsJour = nombrePositifOuNull(triHisto[1]);
    triHistoJour = {
      lus: triHistoFilsJour ?? 0,
      plafond: nombreDuDetail(triHisto[3] ?? ''),
    };
  }

  const triArchives = parCle['tri_archives_jour'];
  const archivesJour = triArchives ? nombrePositifOuNull(triArchives[1]) : null;

  const triAnciens = parCle['tri_anciens_fils_jour'];
  const anciensFilsJour = triAnciens ? nombrePositifOuNull(triAnciens[1]) : null;
  const anciensJour: JaugeJour | null = anciensFilsJour !== null
    ? { lus: anciensFilsJour, plafond: nombreDuDetail(triAnciens[3] ?? '') }
    : null;

  const triFond = parCle['tri_fond_fils_jour'];
  let fondFilsJour: number | null = null;
  let fondJour: JaugeJour | null = null;
  if (triFond) {
    fondFilsJour = nombrePositifOuNull(triFond[1]);
    fondJour = fondFilsJour !== null
      ? { lus: fondFilsJour, plafond: nombreDuDetail(triFond[3] ?? '') }
      : null;
  } else {
    const clesFond = [
      'tri_cyclique_fils_jour',
      'tri_boite_fils_jour',
      'tri_histo_fils_jour',
      'tri_anciens_fils_jour',
    ] as const;
    const valeursFond: number[] = [];
    let plafondFond: number | null = null;
    for (const cle of clesFond) {
      const ligne = parCle[cle];
      if (!ligne) continue;
      const val = nombrePositifOuNull(ligne[1]);
      if (val !== null) {
        valeursFond.push(val);
        if (plafondFond === null) {
          plafondFond = nombreDuDetail(ligne[3] ?? '');
        }
      }
    }
    if (valeursFond.length > 0) {
      fondFilsJour = valeursFond.reduce((acc, v) => acc + v, 0);
      fondJour = { lus: fondFilsJour, plafond: plafondFond };
    }
  }

  return {
    presente: Object.keys(parCle).length > 0,
    quotaSuspendu: (quota?.[1] ?? '') === 'suspendu',
    quotaDetail: quota?.[3] ?? '',
    cycliqueJour: jauge('tri_cyclique_fils_jour'),
    histoJour: jauge('gmail_histo_fils_jour'),
    boiteJour: jauge('tri_boite_fils_jour'),
    triHistoFilsJour,
    triHistoJour,
    archivesJour,
    anciensFilsJour,
    anciensJour,
    fondFilsJour,
    fondJour,
    coutDollars: cout ? nombrePositifOuNull(cout[1]) : null,
    freinDollars: cout ? nombreDuDetail(cout[3] ?? '') : null,
    appelsMois: appels ? nombrePositifOuNull(appels[1]) : null,
  };
}

/* ---------- Coûts par poste (C28-58) — graphique « Réglages » (idée acceptée par Marc, 29/09) ---------- */

/** Une ligne de l'onglet `Coûts` (COLONNES_COUTS, Journal.gs) : un poste du coût LLM du mois. */
export interface LigneCout {
  poste: string;
  appels: number | null; // null pour la ligne « non ventilé » (Appels = '—')
  dollars: number;
  part: number;           // pourcentage (0-100), extrait de « 81.2 % »
}

export interface ResumeCouts {
  total: LigneCout | null;
  postes: LigneCout[];
}

const EST_LIGNE_TOTAL_COUTS = /^TOTAL LLM\b/i;

/**
 * Sépare la ligne synthèse `TOTAL LLM AAAA-MM` (Journal.gs:845) des postes ventilés afin d'éviter
 * un poste parasite à 100 % dans les graphiques par poste, tout en préservant l'ordre moteur.
 */
export function interpreterCoutsResume(brut: string[][]): ResumeCouts {
  let total: LigneCout | null = null;
  const postes: LigneCout[] = [];
  for (const l of brut) {
    if (!l[0]) continue;
    const appelsBrut = String(l[1] ?? '').trim();
    const ligne: LigneCout = {
      poste: l[0],
      appels: appelsBrut === '' || appelsBrut === '—' ? null : (nombreFiniOuNull(appelsBrut) ?? 0),
      dollars: nombreFiniOuNull(l[2]) ?? 0,
      part: nombreFiniOuNull(String(l[3] ?? '').replace('%', '')) ?? 0,
    };
    if (EST_LIGNE_TOTAL_COUTS.test(l[0].trim())) {
      total = ligne;
    } else {
      postes.push(ligne);
    }
  }
  return { total, postes };
}

/**
 * Interprète l'onglet `Coûts` (Poste|Appels|Coût $|Part), TRIÉ par le moteur du plus gros poste
 * au plus petit — préservé ici (aucun tri ajouté : re-trier masquerait un moteur qui aurait cessé
 * de le faire). PURE (testée). Onglet créé au premier tick : absent = table vide, pas une erreur.
 */
export function interpreterCouts(brut: string[][]): LigneCout[] {
  return interpreterCoutsResume(brut).postes;
}

/* ---------- Synthèse pure de l'état global (R3 — zéro donnée inventée) ---------- */

export interface DonneesEtatBrutes {
  index: LigneIndex[];
  santeBrut: string[][];
  journalBrut: string[][];
  reglagesBrut: string[][];
  telemetrieBrut: string[][];
  coutsBrut: string[][];
  reorgBrut?: string[][];
}

export interface OptionsSyntheseEtat {
  progression?: LigneProgression[];
  reorg?: LigneReorg[];
  maintenant?: Date;
}

export interface SyntheseEtat {
  moteur: {
    fraicheur: EtatMoteur;
    ageMinutes: number | null;
    dernierePasseOk: string;
    tickMinutes: number;
    compteLlm: EtatCompteLlm;
    triGmailSante: EtatTriGmailSante;
    maintenanceSante: LigneMaintenanceSante[];
    progressionDisponible: boolean;
    dernieresPassesProgression: Array<{
      cle: string;
      operation: string;
      dernierePasse: string;
      statut: string;
    }>;
    campagnesActives: number | null;
  };
  fichiers: {
    total: number;
    classe: number;
    aTrier: number;
    aVerifier: number;
    doublon: number;
    manuel: number;
    quarantaineOuErreur: number;
    technique: number;
    media: number;
    autres: number;
    confianceBasse: number;
    traitesAujourdhui: number;
  };
  gmail: {
    tries: number;
    aVerifier: number;
    totalTries: number;
    suspects: number;
    erreurs: number;
    importantsAFaire: number;
    telemetriePresente: boolean;
    quotaSuspendu: boolean;
    quotaDetail: string;
    jauges: {
      cyclique: JaugeJour;
      boite: JaugeJour;
      histoPj: JaugeJour;
      triHistoLus: number | null;
      triHisto: JaugeJour | null;
      anciensLus: number | null;
      anciens: JaugeJour | null;
      fondLus: number | null;
      fond: JaugeJour | null;
    };
    archivage: {
      suiviIndexDisponible: false;
      triGmailActif: boolean | null;
      archivesJour: number | null;
    };
  };
  fileRevue: {
    suspects: number;
    aVerifier: number;
    importants: number;
    reorgDisponible: boolean;
    reorgPropositions: number | null;
    reorgRefus: number | null;
    videsCandidats: number | null;
    videsBloquees: number | null;
    total: number;
  };
  quotasCouts: {
    coutMoisDollars: number | null;
    appelsMois: number | null;
    freinDollars: number | null;
    totalCouts: LigneCout | null;
    postes: LigneCout[];
  };
  erreurs: {
    journal7j: LigneJournal[];
    nbJournal7j: number;
    quotaGmailJournalAujourdhui: boolean;
    reorgRefus: LigneReorg[];
    nbReorgRefus: number | null;
  };
}

export const CLE_NON_DOCUMENT_SYNTHESE = /^(intention|tache|event|important|brouillon|tri|tri-abandon|dryrunv2|dryruncmp|conso|consoexec|epingle|fusion)\|/;

/**
 * Agrège toutes les sources brutes déjà chargées en une vue d'état cohérente sans jamais
 * inventer de métrique (les sources absentes produisent `null`, `'inconnu'` ou `false`).
 */
export function syntheseEtat(
  donnees: DonneesEtatBrutes,
  options: OptionsSyntheseEtat = {},
): SyntheseEtat {
  const maintenant = options.maintenant ?? new Date();
  const rawTick = Number(donnees.reglagesBrut?.[0]?.[1]);
  const tickMinutes = Number.isFinite(rawTick) && rawTick > 0 ? rawTick : 5;
  const sante = interpreterSante(donnees.santeBrut);
  const journal = interpreterJournal(donnees.journalBrut);
  const tele = interpreterTelemetrie(donnees.telemetrieBrut);
  const coutsResume = interpreterCoutsResume(donnees.coutsBrut);
  const coutSante = coutDepuisSante(sante.lignes);

  const docs = donnees.index.filter((l) => !CLE_NON_DOCUMENT_SYNTHESE.test(l.cle));
  let classe = 0;
  let aTrier = 0;
  let docAVerifier = 0;
  let doublon = 0;
  let manuel = 0;
  let quarantaineOuErreur = 0;
  let technique = 0;
  let media = 0;
  let confianceBasse = 0;

  for (const d of docs) {
    if (estConfianceBasse(d)) confianceBasse++;
    switch (d.statut) {
      case 'classé': classe++; break;
      case 'à trier': aTrier++; break;
      case 'à vérifier': docAVerifier++; break;
      case 'doublon': doublon++; break;
      case 'manuel': manuel++; break;
      case 'quarantaine':
      case 'erreur': quarantaineOuErreur++; break;
      case 'technique': technique++; break;
      case 'média': media++; break;
      default: break;
    }
  }
  const connus = classe + aTrier + docAVerifier + doublon + manuel + quarantaineOuErreur + technique + media;
  const autres = Math.max(0, docs.length - connus);

  const filsTri = donnees.index.filter((l) => /^tri\|/.test(l.cle));
  const tries = filsTri.filter((l) => l.statut === 'trié').length;
  const gmailAVerifier = filsTri.filter((l) => l.statut === 'tri-a-verifier').length;
  const gmailSuspects = filsTri.filter((l) => l.statut === 'suspect').length;
  const gmailErreurs = donnees.index.filter(
    (l) => /^tri-abandon\|/.test(l.cle) || l.statut === 'tri-erreur',
  ).length;
  const nbImportants = importantsAFaire(donnees.index, maintenant, 7).length;

  const progressionDisponible = options.progression !== undefined;
  const dernieresPassesProgression = (options.progression ?? [])
    .filter((op) => op.dernierePasse.trim() !== '')
    .map((op) => ({
      cle: op.cle,
      operation: op.operation,
      dernierePasse: op.dernierePasse,
      statut: op.statut,
    }));
  const campagnesActives = options.progression !== undefined
    ? options.progression.filter(estUtileProgression).length
    : null;

  const reorgLignes = options.reorg !== undefined
    ? options.reorg
    : (donnees.reorgBrut !== undefined ? interpreterReorg(donnees.reorgBrut) : null);
  const demande = reorgLignes ? derniereDemandeReorg(reorgLignes) : null;
  const reorgPropositions = reorgLignes !== null
    ? (demande ? actionsDuPlan(reorgLignes, demande.cle).filter((a) => a.statut === 'proposé').length : 0)
      + actionsProposeesChat(reorgLignes).length
    : null;
  const reorgRefusListe = reorgLignes !== null
    ? actionsRefuseesReorg(reorgLignes, demande?.cle ?? null)
    : [];
  const reorgRefus = reorgLignes !== null ? reorgRefusListe.length : null;
  const videsCandidats = reorgLignes !== null ? lignesVideCandidat(reorgLignes).length : null;
  const videsBloquees = reorgLignes !== null ? lignesVideBloquee(reorgLignes).length : null;

  const suspects = lignesSuspects(filsTri).length;
  const aVerifier = lignesAVerifier(docs).length;
  const journal7j = erreursDesDerniersJours(journal, 7, maintenant);

  return {
    moteur: {
      fraicheur: fraicheurMoteur(sante.lignes, maintenant, tickMinutes),
      ageMinutes: ageMoteurMinutes(sante.lignes, maintenant),
      dernierePasseOk: sante.dernierePasseOk,
      tickMinutes,
      compteLlm: sante.compteLlm,
      triGmailSante: sante.triGmailSante,
      maintenanceSante: sante.maintenanceSante,
      progressionDisponible,
      dernieresPassesProgression,
      campagnesActives,
    },
    fichiers: {
      total: docs.length,
      classe,
      aTrier,
      aVerifier: docAVerifier,
      doublon,
      manuel,
      quarantaineOuErreur,
      technique,
      media,
      autres,
      confianceBasse,
      traitesAujourdhui: traitesLeJour(docs, maintenant),
    },
    gmail: {
      tries,
      aVerifier: gmailAVerifier,
      totalTries: tries + gmailAVerifier,
      suspects: gmailSuspects,
      erreurs: gmailErreurs,
      importantsAFaire: nbImportants,
      telemetriePresente: tele.presente,
      quotaSuspendu: tele.quotaSuspendu,
      quotaDetail: tele.quotaDetail,
      jauges: {
        cyclique: tele.cycliqueJour,
        boite: tele.boiteJour,
        histoPj: tele.histoJour,
        triHistoLus: tele.triHistoFilsJour,
        triHisto: tele.triHistoJour,
        anciensLus: tele.anciensFilsJour,
        anciens: tele.anciensJour,
        fondLus: tele.fondFilsJour,
        fond: tele.fondJour,
      },
      archivage: {
        suiviIndexDisponible: false,
        triGmailActif: sante.triGmailSante.statut === 'normal'
          ? true
          : sante.triGmailSante.statut === 'arret' ? false : null,
        archivesJour: tele.archivesJour,
      },
    },
    fileRevue: {
      suspects,
      aVerifier,
      importants: nbImportants,
      reorgDisponible: reorgLignes !== null,
      reorgPropositions,
      reorgRefus,
      videsCandidats,
      videsBloquees,
      total: suspects + aVerifier + nbImportants + (reorgPropositions ?? 0) + (videsCandidats ?? 0),
    },
    quotasCouts: {
      coutMoisDollars: tele.presente && tele.coutDollars !== null
        ? tele.coutDollars
        : (coutSante?.dollars ?? null),
      appelsMois: tele.presente && tele.appelsMois !== null
        ? tele.appelsMois
        : (coutSante?.appels ?? null),
      freinDollars: tele.freinDollars,
      totalCouts: coutsResume.total,
      postes: coutsResume.postes,
    },
    erreurs: {
      journal7j,
      nbJournal7j: journal7j.length,
      quotaGmailJournalAujourdhui: quotaGmailEpuise(journal, maintenant),
      reorgRefus: reorgRefusListe,
      nbReorgRefus: reorgRefus,
    },
  };
}

/**
 * Formate un âge en minutes en durée lisible (min / h / j) pour l'affichage humain sur la page État.
 * PURE (testée). Protégée contre les valeurs négatives.
 */
export function formaterAgeMinutes(minutes: number, langue: 'fr' | 'en'): string {
  const propre = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (propre < 60) return langue === 'fr' ? `il y a ${propre} min` : `${propre} min ago`;
  if (propre < 48 * 60) {
    const h = Math.round(propre / 60);
    return langue === 'fr' ? `il y a ${h} h` : `${h} h ago`;
  }
  const j = Math.round(propre / (24 * 60));
  return langue === 'fr' ? `il y a ${j} j` : `${j} d ago`;
}

/**
 * Retire les pictogrammes bruts hérités des lignes libres de l'onglet Santé et normalise
 * les espaces multiples afin de garder une interface sobre dans la coquille DriveAI. PURE.
 */
export function nettoyerDetailSante(texte: string): string {
  if (!texte) return '';
  return texte
    .replace(/[\u2705\u26D4\u26A0\uFE0F\u23F3]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ---------- Actions autonomes du moteur (onglet Actions, ADR-0081 vague 3b) ---------- */

export interface LigneAction {
  id: string;
  horodatage: string;
  type: string;
  cible: string;
  avant: string;
  apres: string;
  statut: string;
  detail: string;
  annulable: boolean;
  resume: string;
}

const REGEX_ID_ACTION = /^act-[A-Za-z0-9_-]{6,64}$/;

function extraireNomEtatAction(brut: string): string {
  if (!brut || brut[0] !== '{') return '';
  try {
    const obj = JSON.parse(brut) as { nom?: unknown };
    return typeof obj.nom === 'string' ? obj.nom.trim() : '';
  } catch {
    return '';
  }
}

function resumerAction(type: string, cible: string, avant: string, apres: string, detail: string): string {
  if (type === 'drive-deplacer' || type === 'drive-renommer') {
    return extraireNomEtatAction(apres) || extraireNomEtatAction(avant) || detail || cible;
  }
  if (type === 'gmail-libelle') {
    return apres || cible || detail;
  }
  return detail || extraireNomEtatAction(apres) || extraireNomEtatAction(avant) || apres || cible;
}

/** Interprète l'onglet `Actions` (Id..Détail) : filtre les IDs invalides et rend les plus récentes en premier. PURE. */
export function interpreterActions(brut: string[][]): LigneAction[] {
  const sorties: LigneAction[] = [];
  for (const l of brut) {
    const id = (l[0] ?? '').trim();
    if (!REGEX_ID_ACTION.test(id)) continue;
    const horodatage = (l[1] ?? '').trim();
    const type = (l[2] ?? '').trim();
    const cible = (l[3] ?? '').trim();
    const avant = (l[4] ?? '').trim();
    const apres = (l[5] ?? '').trim();
    const statut = (l[6] ?? '').trim();
    const detail = (l[7] ?? '').trim();
    const annulable = statut === 'appliqué' && (type === 'drive-deplacer' || type === 'drive-renommer');
    sorties.push({
      id,
      horodatage,
      type,
      cible,
      avant,
      apres,
      statut,
      detail,
      annulable,
      resume: resumerAction(type, cible, avant, apres, detail),
    });
  }
  return sorties.reverse();
}
