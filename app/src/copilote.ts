/**
 * copilote.ts — logique PURE de l'onglet Copilote (Lot 1B : fil « Ce qui a bougé dans ton Drive »
 * et synthèse socle « Actions utiles de la semaine »). Aucun import `.tsx` ; aucune donnée inventée.
 */

import { fileIdDepuisCle, indexParFileId, interpreterActions, interpreterJournal, lienDrivePourLigne, type LigneIndex, type LigneJournal } from './etat';

export type CategorieMouvementDrive = 'dossier' | 'fichier' | 'apprentissage';
export type FiltreMouvementDrive = 'tous' | CategorieMouvementDrive;

export interface MouvementDrive {
  id: string;
  date: string;
  categorie: CategorieMouvementDrive;
  source: 'Journal' | 'Actions';
  titre: string;
  detail: string;
  chemin?: string;
  lienDrive?: string;
  annule?: boolean;
}

export interface SyntheseSemaineCopilote {
  totalMouvements: number;
  fichiers: number;
  dossiers: number;
  apprentissages: number;
}

const SOURCES_AUTRES_DRIVE = new Set(['Reorg', 'Partages', 'Migration', 'ConsolidationExec', 'FusionExec', 'Reset']);
const REGEX_DOSSIER_VEILLE = /^(.+)\s+\((arborescence à jour|\d+\s+doc(?:ument)?(?:\(s\)|s)?\b.*\bmis à jour.*)\)$/;
const LIMITE_DEFAUT = 50;

function horodatageMs(date: unknown): number {
  const propre = String(date ?? '').trim();
  if (!propre) return Number.NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} /.test(propre) ? propre.replace(' ', 'T') : propre);
}

function couperFleche(texte: string, depuisFin = false): { gauche: string; droite?: string } {
  const sep = texte.includes(' → ') ? ' → ' : '→';
  const idx = depuisFin ? texte.lastIndexOf(sep) : texte.indexOf(sep);
  return idx === -1 ? { gauche: texte.trim() } : { gauche: texte.slice(0, idx).trim(), droite: texte.slice(idx + sep.length).trim() };
}

type BaseMouvement = Omit<MouvementDrive, 'id' | 'date' | 'source' | 'lienDrive'>;

function normaliserVeille(msg: string): BaseMouvement {
  if (msg.startsWith('Changement direct détecté : ')) {
    const { gauche, droite } = couperFleche(msg.slice('Changement direct détecté : '.length), true);
    return { categorie: 'fichier', titre: gauche || msg, detail: 'VeilleDrive', chemin: droite };
  }
  if (msg.startsWith('Document catalogué (lecture seule) : ')) {
    const { gauche, droite } = couperFleche(msg.slice('Document catalogué (lecture seule) : '.length), true);
    return { categorie: 'fichier', titre: gauche || msg, detail: 'VeilleDrive · lecture seule', chemin: droite };
  }
  if (msg.startsWith('Dossier modifié : ')) {
    const reste = msg.slice('Dossier modifié : '.length).trim();
    const m = reste.match(REGEX_DOSSIER_VEILLE);
    if (m) return { categorie: 'dossier', titre: m[1]!.trim(), detail: m[2]!.trim(), chemin: m[1]!.trim() };
    return { categorie: 'dossier', titre: reste, detail: 'VeilleDrive', chemin: reste };
  }
  return { categorie: /dossier/i.test(msg) ? 'dossier' : 'fichier', titre: msg, detail: 'VeilleDrive' };
}

function normaliserPipeline(msg: string, indexDrive: IndexDrive): BaseMouvement {
  const mockMatch = msg.match(/^([^:→]+):\s*(.+?)\s*→\s*(.+)$/); // mock : « classé : nom → chemin »
  if (mockMatch) return { categorie: 'fichier', titre: mockMatch[2]!.trim(), detail: mockMatch[1]!.trim(), chemin: mockMatch[3]!.trim() };
  const { gauche, droite } = couperFleche(msg);
  if (gauche && droite) {
    const seps: number[] = [];
    for (let i = droite.indexOf(' : '); i !== -1; i = droite.indexOf(' : ', i + 3)) seps.push(i);
    if (seps.length) {
      const choix = seps.map((i) => {
        const chemin = droite.slice(0, i).trim(), nomBrut = droite.slice(i + 3).trim();
        const dup = nomBrut.match(/^(.*?)\s+\((taille\s+[^)]*empreinte\s+[^)]*)\)$/);
        const nomDup = dup?.[1]?.trim();
        return { chemin, titre: nomDup || nomBrut, detail: nomDup ? `${gauche} · ${dup![2]!.trim()}` : gauche };
      });
      const g = choix.find((c) => indexDrive.parCheminNom.has(`${c.chemin}/${c.titre}`))
        ?? choix.find((c) => /^\d{4}-\d{2}(?:-\d{2})?_/.test(c.titre)) ?? choix[choix.length - 1]!;
      return { categorie: 'fichier', ...g };
    }
  }
  return { categorie: 'fichier', titre: msg, detail: 'Pipeline' };
}

type IndexDrive = { parCheminNom: ReadonlyMap<string, LigneIndex>; parNom: ReadonlyMap<string, LigneIndex | null> };

function normaliserJournalDrive(l: LigneJournal, idx: number, indexDrive: IndexDrive): MouvementDrive | null {
  const date = String(l.date ?? '').trim();
  const msg = String(l.message ?? '').trim();
  const src = String(l.source ?? '').trim();
  if (!msg || String(l.niveau ?? '').trim().toUpperCase() === 'ERREUR') return null;

  let base: BaseMouvement;
  if (src === 'VeilleDrive') base = normaliserVeille(msg);
  else if (src === 'Corrections') base = { categorie: 'apprentissage', titre: msg, detail: 'Corrections' };
  else if (src === 'Entités') {
    const { droite } = couperFleche(msg);
    base = { categorie: /dossier d'entité créé/i.test(msg) ? 'dossier' : 'apprentissage', titre: msg, detail: 'Entités', ...(droite ? { chemin: droite } : {}) };
  } else if (src === 'Pipeline') base = normaliserPipeline(msg, indexDrive);
  else if (SOURCES_AUTRES_DRIVE.has(src)) base = { categorie: /dossier/i.test(msg) ? 'dossier' : 'fichier', titre: msg, detail: src };
  else return null;

  const ligneIndex = base.categorie === 'fichier'
    ? (base.chemin ? indexDrive.parCheminNom.get(`${base.chemin}/${base.titre}`) : undefined) ?? (indexDrive.parNom.get(base.titre) ?? undefined)
    : undefined;
  const lienDrive = ligneIndex ? lienDrivePourLigne(ligneIndex) : undefined;
  return { id: `journal|${idx}|${date}`, date, source: 'Journal', ...base, ...(lienDrive ? { lienDrive } : {}) };
}

/** Fusionne et normalise les mouvements Drive (`Actions` + `Journal`), enrichit via `indexParFileId`/`lienDrivePourLigne` et trie. */
export function extraireMouvementsDrive(
  donnees: { journalBrut: string[][]; actionsBrut?: string[][]; index?: LigneIndex[] },
  options?: { limite?: number },
): MouvementDrive[] {
  const indexSain = (donnees.index ?? []).map((l) => ({ ...l, cle: String(l.cle ?? '').trim() }));
  const parId = indexParFileId(indexSain);
  const parCheminNom = new Map<string, LigneIndex>();
  const parNom = new Map<string, LigneIndex | null>();
  for (const l of indexSain) {
    const fichier = String(l.fichier ?? '').trim();
    const fid = fileIdDepuisCle(l.cle);
    if (!fichier || !fid) continue;
    const chemin = String(l.chemin ?? '').trim();
    if (chemin) parCheminNom.set(`${chemin}/${fichier}`, l);
    const ex = parNom.get(fichier);
    if (ex !== null) parNom.set(fichier, ex && fileIdDepuisCle(ex.cle) !== fid ? null : l);
  }

  const mouvements: MouvementDrive[] = [];
  const actionsBrutSain = (donnees.actionsBrut ?? []).map((r) => r.map((c) => String(c ?? '')));
  const actions = interpreterActions(actionsBrutSain);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.type !== 'drive-deplacer' && a.type !== 'drive-renommer' && a.type !== 'drive-dossier') continue;
    const categorie: CategorieMouvementDrive = a.type === 'drive-dossier' ? 'dossier' : 'fichier';
    const ligneIndex = categorie === 'fichier' && a.cible ? parId.get(a.cible) : undefined;
    const lienDrive = ligneIndex ? lienDrivePourLigne(ligneIndex) : undefined;
    mouvements.push({
      id: `action|${a.id}|${i}`, date: a.horodatage, categorie, source: 'Actions', titre: a.resume,
      detail: a.detail || a.type, ...(lienDrive ? { lienDrive } : {}), ...(a.statut === 'annulé' ? { annule: true } : {}),
    });
  }

  const journal = interpreterJournal(donnees.journalBrut);
  const indexDrive: IndexDrive = { parCheminNom, parNom };
  for (let i = 0; i < journal.length; i++) {
    const mvt = normaliserJournalDrive(journal[i]!, i, indexDrive);
    if (mvt) mouvements.push(mvt);
  }

  const maintenantMs = Date.now();
  mouvements.sort((a, b) => {
    const ta = horodatageMs(a.date), tb = horodatageMs(b.date);
    const aInval = Number.isNaN(ta) || ta > maintenantMs, bInval = Number.isNaN(tb) || tb > maintenantMs;
    if (aInval !== bInval) return aInval ? 1 : -1;
    return aInval ? 0 : tb - ta;
  });

  const limite = options?.limite ?? LIMITE_DEFAUT;
  return limite > 0 ? mouvements.slice(0, limite) : [];
}

/** Filtre le fil des mouvements Drive selon la catégorie demandée. PURE. */
export function filtrerMouvementsDrive(mouvements: readonly MouvementDrive[], filtre: FiltreMouvementDrive): MouvementDrive[] {
  return filtre === 'tous' ? [...mouvements] : mouvements.filter((m) => m.categorie === filtre);
}

/** Calcule les compteurs réels sur les 7 derniers jours glissants sans dates futures (zéro donnée inventée). PURE. */
export function syntheseSemaineCopilote(mouvements: readonly MouvementDrive[], maintenant: Date = new Date()): SyntheseSemaineCopilote {
  const finMs = maintenant.getTime();
  const seuil = finMs - 7 * 24 * 60 * 60 * 1000;
  let fichiers = 0, dossiers = 0, apprentissages = 0;
  for (const m of mouvements) {
    const t = horodatageMs(m.date);
    if (Number.isNaN(t) || t < seuil || t > finMs) continue;
    if (m.categorie === 'dossier') dossiers++;
    else if (m.categorie === 'apprentissage') apprentissages++;
    else fichiers++;
  }
  return { totalMouvements: fichiers + dossiers + apprentissages, fichiers, dossiers, apprentissages };
}

export type TypeCarteCopilote = 'cascade' | 'doublon-dossier' | 'dossier-vide' | 'alerte-corbeille' | 'demarche-active' | 'expiration' | 'piece-manquante' | 'facture-hausse' | 'facture-doublon' | 'renouvellement' | 'remboursement' | 'retour-garantie';
type StatutCarteCopilote = 'proposé' | 'auto' | 'actif';
export interface CarteCopilote {
  id: string; horodatage: string; categorie: string; type: TypeCarteCopilote; domaine: string; chemin: string; titre: string;
  action: { cibleId?: string; sourceId?: string; dossierId?: string; fileId?: string; ids?: string[]; tids?: string[]; echeances?: string[]; nbMvts?: number; nbDocs?: number; devise?: string; montantTotal?: number; nbRecus?: number; cle?: string; [k: string]: unknown };
  statut: StatutCarteCopilote; validations: number;
}
export interface LienMailDrive { threadId: string; expediteur: string; domaine: string; chemin: string; fileId: string; fichier: string }
export interface LigneSignal { fileId: string; categorie: string; fournisseur: string; domaine: string; chemin: string; dateDoc: string; dateExpiration: string; montant: number | null; devise: string; finGarantie: string; delaiRetour: string; statutReclamation: string }
export interface SignalRepli { id: string; section: 'expiration' | 'argent'; fileId: string; titre: string; chemin: string; montant?: number; devise: string; lienDrive: string }
const TYPES_CARTES = new Set<TypeCarteCopilote>(['cascade', 'doublon-dossier', 'dossier-vide', 'alerte-corbeille', 'demarche-active', 'expiration', 'piece-manquante', 'facture-hausse', 'facture-doublon', 'renouvellement', 'remboursement', 'retour-garantie']);
const TYPES_AUTO = new Set<TypeCarteCopilote>(['cascade', 'doublon-dossier', 'dossier-vide']);
const TYPES_EXP = new Set<TypeCarteCopilote>(['expiration', 'piece-manquante']);
const TYPES_FAC = new Set<TypeCarteCopilote>(['facture-hausse', 'facture-doublon', 'renouvellement']);
const TYPES_ARG = new Set<TypeCarteCopilote>(['remboursement', 'retour-garantie']);
const STATUTS_CARTES = new Set<StatutCarteCopilote>(['proposé', 'auto', 'actif']);
const ZONES_PROT_COPILOTE = new Set(['04 · immigration', 'anna', '00 · a trier', '00 · a verifier', '_technique', '_doublons', '_medias', 'donnees & exports']);

/** Interprète les cartes ouvertes de `Copilote!A2:J` (PURE). */
export function interpreterCartesCopilote(brut: readonly string[][] = []): CarteCopilote[] {
  return brut.flatMap((r) => {
    const id = String(r[0] ?? '').trim(), type = String(r[3] ?? '').trim() as TypeCarteCopilote, statut = String(r[8] ?? '').trim() as StatutCarteCopilote;
    if (!id || id === 'Id' || !TYPES_CARTES.has(type) || !STATUTS_CARTES.has(statut)) return [];
    let action: CarteCopilote['action'] = {};
    try { const p = r[7] ? JSON.parse(String(r[7])) : null; if (p && typeof p === 'object' && !Array.isArray(p)) action = { ...(p as CarteCopilote['action']), ...('ids' in p ? { ids: Array.isArray(p.ids) ? p.ids.map(String) : undefined } : {}), ...('tids' in p ? { tids: Array.isArray(p.tids) ? p.tids.map(String) : undefined } : {}), ...('echeances' in p ? { echeances: Array.isArray(p.echeances) ? p.echeances.map(String) : undefined } : {}) }; } catch { /* ignore */ }
    return [{ id, horodatage: String(r[1] ?? '').trim(), categorie: String(r[2] ?? '').trim(), type, domaine: String(r[4] ?? '').trim(), chemin: String(r[5] ?? '').trim(), titre: String(r[6] ?? '').trim(), action, statut, validations: Number(r[9]) || 0 }];
  });
}

/** Interprète les liens courriel ↔ Drive de `Liens!A2:H` (PURE). */
export function interpreterLiens(brut: readonly string[][] = []): LienMailDrive[] {
  return brut.flatMap((r) => {
    const threadId = String(r[1] ?? '').trim(), fileId = String(r[6] ?? '').trim();
    return threadId && threadId !== 'ThreadId' && fileId ? [{ threadId, expediteur: String(r[3] ?? '').trim(), domaine: String(r[4] ?? '').trim(), chemin: String(r[5] ?? '').trim(), fileId, fichier: String(r[7] ?? '').trim() }] : [];
  });
}

/** Interprète les lignes structurées de `Signaux!A2:L` (PURE). */
export function interpreterSignaux(brut: readonly string[][] = []): LigneSignal[] {
  return brut.flatMap((r) => {
    const fileId = String(r[0] ?? '').trim(), mtNum = r[7] != null && String(r[7]).trim() ? Number(String(r[7]).trim().replace(',', '.')) : Number.NaN, dev = String(r[8] ?? '').trim().toUpperCase();
    return !fileId || fileId === 'FileId' ? [] : [{ fileId, categorie: String(r[1] ?? '').trim(), fournisseur: String(r[2] ?? '').trim(), domaine: String(r[3] ?? '').trim(), chemin: String(r[4] ?? '').trim(), dateDoc: String(r[5] ?? '').trim(), dateExpiration: String(r[6] ?? '').trim(), montant: Number.isFinite(mtNum) && mtNum > 0 ? Math.round(mtNum * 100) / 100 : null, devise: /^[A-Z]{3}$/.test(dev) ? dev : 'CAD', finGarantie: String(r[9] ?? '').trim(), delaiRetour: String(r[10] ?? '').trim(), statutReclamation: String(r[11] ?? '').trim() }];
  });
}

/** Formate un montant dans sa devise selon la locale (PURE). */
export function formaterMontantSignal(montant: number, devise: string, locale: string): string {
  const dev = /^[A-Z]{3}$/.test(devise) ? devise : 'CAD';
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: dev, maximumFractionDigits: 2 }).format(montant); }
  catch { return `${montant.toFixed(2)} ${dev}`; }
}

function diffJoursSignal(iso: string, ref: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Number.NaN;
  const a = Number(m[1]), mo = Number(m[2]), j = Number(m[3]), d = new Date(Date.UTC(a, mo - 1, j));
  return (d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j) ? Math.round((d.getTime() - Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())) / 86400000) : Number.NaN;
}

/** Partitionne les cartes Copilote, déduplique avec `Signaux` et agrège le total à réclamer (PURE). */
export function construireVueSignauxCopilote(cartes: readonly CarteCopilote[], signaux: readonly LigneSignal[], statutsLocaux: Readonly<Record<string, string>> = {}, maintenant: Date = new Date()) {
  const propositions: CarteCopilote[] = [], expirations: CarteCopilote[] = [], factures: CarteCopilote[] = [], argent: CarteCopilote[] = [];
  const fidsCouverts = new Set<string>(), totParDev = new Map<string, { montant: number; nbRecus: number }>();
  const marquerFids = (c: CarteCopilote) => {
    const ks = c.type === 'expiration' ? ['exp'] : c.type === 'remboursement' ? ['recl'] : c.type === 'retour-garantie' ? (c.action.sousType === 'retour' ? ['ret'] : c.action.sousType === 'garantie' ? ['gar'] : ['ret', 'gar']) : [];
    const fids = [...(c.action.fileId ? [c.action.fileId] : []), ...(Array.isArray(c.action.ids) ? c.action.ids : [])];
    for (const k of ks) for (const f of fids) if (f) fidsCouverts.add(`${k}|${f}`);
  };
  const addTot = (dev: string, mt: number, nb: number) => { const cur = totParDev.get(dev) ?? { montant: 0, nbRecus: 0 }; cur.montant += mt; cur.nbRecus += nb; totParDev.set(dev, cur); };
  for (const raw of cartes) {
    const loc = statutsLocaux[raw.id];
    if (loc === 'appliqué' || loc === 'ignoré' || loc === 'reclamé') { marquerFids(raw); continue; }
    const c: CarteCopilote = (loc === 'auto' || loc === 'proposé' || loc === 'actif') ? { ...raw, statut: loc } : raw;
    if (TYPES_EXP.has(c.type)) { expirations.push(c); marquerFids(c); }
    else if (TYPES_FAC.has(c.type)) { factures.push(c); }
    else if (TYPES_ARG.has(c.type)) { argent.push(c); marquerFids(c); if (c.type === 'remboursement') addTot(String(c.action.devise || 'CAD').trim().toUpperCase() || 'CAD', typeof c.action.montantTotal === 'number' && Number.isFinite(c.action.montantTotal) ? c.action.montantTotal : 0, typeof c.action.nbRecus === 'number' && c.action.nbRecus > 0 ? c.action.nbRecus : (Array.isArray(c.action.ids) && c.action.ids.length ? c.action.ids.length : 1)); }
    else propositions.push(c);
  }
  const signauxRepli: SignalRepli[] = [], vus = new Set<string>();
  for (const s of signaux) {
    if (!s.fileId || vus.has(s.fileId) || s.categorie === 'aucun') continue;
    vus.add(s.fileId);
    const lienDrive = `https://drive.google.com/file/d/${encodeURIComponent(s.fileId)}/view`, chemin = s.chemin || s.domaine, nom = s.fournisseur || s.categorie || s.fileId;
    if (s.statutReclamation === 'a-reclamer' && !fidsCouverts.has(`recl|${s.fileId}`)) { signauxRepli.push({ id: `sig-recl-${s.fileId}`, section: 'argent', fileId: s.fileId, titre: nom, chemin, ...(s.montant ? { montant: s.montant } : {}), devise: s.devise, lienDrive }); addTot(s.devise, s.montant ?? 0, 1); }
    const jExp = diffJoursSignal(s.dateExpiration, maintenant), jRet = diffJoursSignal(s.delaiRetour, maintenant), jGar = diffJoursSignal(s.finGarantie, maintenant);
    if (!fidsCouverts.has(`exp|${s.fileId}`) && !Number.isNaN(jExp) && jExp >= 0 && jExp <= 90) signauxRepli.push({ id: `sig-exp-${s.fileId}`, section: 'expiration', fileId: s.fileId, titre: `${s.categorie || s.fournisseur || s.fileId} (${s.dateExpiration})`, chemin, devise: s.devise, lienDrive });
    if (!fidsCouverts.has(`ret|${s.fileId}`) && !Number.isNaN(jRet) && jRet >= 0 && jRet <= 7) signauxRepli.push({ id: `sig-ret-${s.fileId}`, section: 'argent', fileId: s.fileId, titre: `${nom} (${s.delaiRetour})`, chemin, ...(s.montant ? { montant: s.montant } : {}), devise: s.devise, lienDrive });
    if (!fidsCouverts.has(`gar|${s.fileId}`) && !Number.isNaN(jGar) && jGar >= 0 && jGar <= 30) signauxRepli.push({ id: `sig-gar-${s.fileId}`, section: 'argent', fileId: s.fileId, titre: `${nom} (${s.finGarantie})`, chemin, ...(s.montant ? { montant: s.montant } : {}), devise: s.devise, lienDrive });
  }
  const totauxAReclamer = [...totParDev.entries()].filter(([, v]) => v.nbRecus > 0).sort(([a], [b]) => a.localeCompare(b)).map(([devise, v]) => ({ devise, montant: Math.round(v.montant * 100) / 100, nbRecus: v.nbRecus }));
  return { propositions, expirations, factures, argent, signauxRepli, totauxAReclamer };
}

/** Retourne jusqu'à `limite` liens Drive/Gmail associés à une carte Copilote (PURE). */
export function liensPourCarte(carte: CarteCopilote, liens: readonly LienMailDrive[], limite = 4): LienMailDrive[] {
  const tids = new Set(Array.isArray(carte.action.tids) ? carte.action.tids : []), fids = new Set([...(Array.isArray(carte.action.ids) ? carte.action.ids : []), ...(carte.action.fileId ? [carte.action.fileId] : [])]), vus = new Set<string>(), out: LienMailDrive[] = [];
  for (const l of liens) {
    const cle = `${l.threadId}|${l.fileId}`;
    if (!vus.has(cle) && (tids.has(l.threadId) || fids.has(l.fileId) || (!!carte.chemin && (l.chemin === carte.chemin || l.chemin.startsWith(`${carte.chemin}/`))))) { vus.add(cle); out.push(l); if (out.length >= limite) break; }
  }
  return out;
}

const normTxt = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const estZoneProtegee = (domaine: string, chemin: string) => [domaine, ...chemin.split('/')].some((s) => { const n = normTxt(s); return !!n && (ZONES_PROT_COPILOTE.has(n) || n.startsWith('_') || /^00\s*·/.test(n)); });
const parseJsonObj = (brut: unknown): Record<string, unknown> => { try { const p = brut ? JSON.parse(String(brut)) : null; return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {}; } catch { return {}; } };
const hasProp = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** Valide strictement qu'une URL pointe vers Drive, Docs ou Gmail (PURE). */
export const urlDriveSure = (url: unknown): string | undefined => { const u = typeof url === 'string' ? url.trim() : ''; return /^https:\/\/(drive|docs|mail)\.google\.com\//.test(u) ? u : undefined; };
/** Vrai si la carte peut basculer en mode automatique (PURE). */
export const peutPasserEnAuto = (c: CarteCopilote): boolean => c.statut === 'proposé' && c.validations >= 3 && TYPES_AUTO.has(c.type) && !estZoneProtegee(c.domaine, c.chemin);

interface EntiteCopilote { entite: string; domaine: string; categorie: string; type: string; statut: string; dossierId: string; ajouteeLe: string; variante: string; vuNFois: number }
interface ItemChecklistCopilote { cle: string; libelle: string; fait: boolean; fileId?: string; nb?: number }
export interface ChecklistCopilote { id: string; type: 'checklist' | 'changement-vie'; titre: string; demarche: string; packCle: string; statut: string; items: ItemChecklistCopilote[]; faits: number; total: number; termine: boolean }
export interface RegleCopilote { id: string; phrase: string; domaine: string; chemin: string; auto: boolean; validations: number; statut: string; canal: string; action: string; zoneProtegee: boolean }
type CategorieFiche360 = 'vehicule' | 'logement' | 'employeur' | 'voyage' | 'immigration' | 'anna' | 'organisme';
export interface Fiche360 { id: string; titre: string; categorie: CategorieFiche360; domaine: string; chemin: string; lectureSeule: boolean; docs: Array<{ fileId: string; nom: string; date: string; lienDrive?: string }>; nbDocs: number; liensMail: LienMailDrive[]; echeances: Array<{ label: string; date: string }>; totalMontant: number; devise: string; fileIdsPack: string[] }
export interface ActionSemaine { id: string; priorite: 1 | 2 | 3; type: 'alerte' | 'demarche' | 'auto' | 'pack' | 'cascade'; titre: string; detail: string; packCle?: string }

/** Interprète `Entités!A2:I` en ignorant la ligne d'en-tête éventuelle (PURE). */
export function interpreterEntites(brut: readonly string[][] = []): EntiteCopilote[] {
  return brut.flatMap((r) => {
    const entite = String(r[0] ?? '').trim();
    return !entite || entite === 'Entité' ? [] : [{ entite, domaine: String(r[1] ?? '').trim(), categorie: String(r[2] ?? '').trim(), type: String(r[3] ?? '').trim(), statut: String(r[4] ?? '').trim(), dossierId: String(r[5] ?? '').trim(), ajouteeLe: String(r[6] ?? '').trim(), variante: String(r[7] ?? '').trim(), vuNFois: Number(r[8]) || 0 }];
  });
}
/** Extrait checklists par démarche (#13) et plan « Changement de vie » (#14) depuis `Copilote!A2:J` (PURE). */
export function interpreterChecklistsCopilote(copiloteBrut: readonly string[][] = [], cochesLocaux: Readonly<Record<string, boolean>> = {}): ChecklistCopilote[] {
  return copiloteBrut.flatMap((r) => {
    const id = String(r[0] ?? '').trim(), type = String(r[3] ?? '').trim(), statut = String(r[8] ?? '').trim();
    if (!id || id === 'Id' || statut === 'ignoré' || (type !== 'checklist' && type !== 'changement-vie')) return [];
    const p = parseJsonObj(r[7]), titre = String(r[6] ?? '').trim(), demarche = String(p.dem ?? titre).trim() || titre;
    const brutItems = type === 'checklist' ? (Array.isArray(p.items) ? p.items : []) : (Array.isArray(p.orgs) ? p.orgs : []);
    const items: ItemChecklistCopilote[] = brutItems.flatMap((it) => {
      if (!it || typeof it !== 'object') return [];
      const o = it as Record<string, unknown>, cle = String(o.k ?? '').trim(), libelle = String(type === 'checklist' ? (o.l ?? cle) : (o.n ?? cle)).trim();
      if (!cle || !libelle) return [];
      const kLoc = `${id}|${cle}`, fait = hasProp(cochesLocaux, kLoc) ? Boolean(cochesLocaux[kLoc]) : Boolean(o.ok);
      return [{ cle, libelle, fait, ...(o.f ? { fileId: String(o.f) } : {}), ...(typeof o.nb === 'number' ? { nb: o.nb } : {}) }];
    });
    const faits = items.filter((x) => x.fait).length, total = items.length;
    return [{ id, type, titre: titre || demarche, demarche, packCle: type === 'changement-vie' ? 'changement-vie' : normTxt(demarche), statut, items, faits, total, termine: (total > 0 && faits === total) || (total === 0 && statut === 'terminé') }];
  });
}
/** Extrait les règles en 1 phrase (#19) depuis `Copilote!A2:J` (PURE). */
export function interpreterReglesCopilote(copiloteBrut: readonly string[][] = [], etatsLocaux: Readonly<Record<string, { auto?: boolean; supprime?: boolean }>> = {}): RegleCopilote[] {
  return copiloteBrut.flatMap((r) => {
    const id = String(r[0] ?? '').trim(), type = String(r[3] ?? '').trim(), statut = String(r[8] ?? '').trim();
    if (!id || id === 'Id' || type !== 'regle-auto' || statut === 'ignoré' || etatsLocaux[id]?.supprime) return [];
    const p = parseJsonObj(r[7]), alors = parseJsonObj(p.alors), dom = String(p.domaine ?? r[4] ?? '').trim(), chm = String(p.cible ?? r[5] ?? '').trim();
    const zoneProtegee = estZoneProtegee(dom, chm), loc = hasProp(etatsLocaux, id) ? etatsLocaux[id] : undefined;
    return [{ id, phrase: String(p.phrase ?? r[6] ?? '').trim(), domaine: dom, chemin: chm, auto: !zoneProtegee && (loc?.auto ?? (statut === 'auto' || Boolean(p.auto))), validations: Math.max(Number(r[9]) || 0, Number(p.validations) || 0), statut, canal: String(alors.canal ?? 'les-deux'), action: String(alors.action ?? 'deplacer'), zoneProtegee }];
  });
}
function catFiche(domaine: string, chemin: string, type = '', cat = ''): CategorieFiche360 | null {
  const n = normTxt(`${domaine}/${chemin}/${type}/${cat}`);
  if (n.includes('04 · immigration') || n.includes('immigration')) return 'immigration';
  if (n.split('/').some((s) => s.trim() === 'anna')) return 'anna';
  if (n.includes('vehicule') || n.includes('voiture')) return 'vehicule';
  if (n.includes('logement')) return 'logement';
  if (n.includes('carriere') || n.includes('employeur')) return 'employeur';
  return n.includes('voyage') ? 'voyage' : null;
}
/** Construit les Fiches 360° par sujet de vie (#17), incluant `04 · Immigration` et `Anna` en lecture seule (PURE). */
export function construireFiches360(donnees: { index: readonly LigneIndex[]; signaux: readonly LigneSignal[]; liens: readonly LienMailDrive[]; entites: readonly EntiteCopilote[] }): Fiche360[] {
  const fiches = new Map<string, Fiche360 & { fids: Set<string>; keysMail: Set<string> }>();
  const ensure = (id: string, titre: string, categorie: CategorieFiche360, domaine: string, chemin: string) => {
    const ex = fiches.get(id); if (ex) return ex;
    const f = { id, titre, categorie, domaine, chemin, lectureSeule: categorie === 'immigration' || categorie === 'anna' || estZoneProtegee(domaine, chemin), docs: [], nbDocs: 0, liensMail: [], echeances: [], totalMontant: 0, devise: 'CAD', fileIdsPack: [], fids: new Set<string>(), keysMail: new Set<string>() };
    fiches.set(id, f); return f;
  };
  for (const e of donnees.entites) {
    if (e.statut === 'ignoré') continue;
    const cat = catFiche(e.domaine, e.entite, e.type, e.categorie) ?? 'organisme';
    if (e.statut === 'validée' || cat === 'immigration' || cat === 'anna') ensure(`${cat}|${normTxt(e.entite)}`, e.entite, cat, e.domaine, e.entite);
  }
  const matchFiche = (domaine: string, chemin: string, nom = '') => {
    const txt = normTxt(`${domaine}/${chemin}/${nom}`);
    for (const f of fiches.values()) if (txt.includes(normTxt(f.titre))) return f;
    const cat = catFiche(domaine, chemin);
    if (cat === 'immigration') return ensure('immigration|04', '04 · Immigration', 'immigration', '04 · Immigration', '04 · Immigration');
    if (cat === 'anna') return ensure('anna|anna', 'Anna', 'anna', 'Anna', 'Anna');
    const segs = chemin.split('/').map((s) => s.trim()).filter(Boolean);
    if (cat && segs.length >= 2) {
      const idx = segs.findIndex((s, i) => i > 0 && /vehicule|logement|voyage|carriere/.test(normTxt(s)));
      const titre = segs[idx >= 0 && segs[idx + 1] ? idx + 1 : 1]!;
      if (titre && !/^\d{4}$/.test(titre)) return ensure(`${cat}|${normTxt(titre)}`, titre, cat, domaine, chemin);
    }
    return null;
  };
  for (const l of donnees.index) {
    const chm = String(l.chemin ?? '').trim(), dom = String(l.domaine ?? '').trim(), fid = fileIdDepuisCle(l.cle);
    if (!fid || !chm || /^(_doublons|_technique|_medias|00\s*·)/.test(normTxt(chm))) continue;
    const f = matchFiche(dom, chm, l.fichier); if (!f) continue;
    f.nbDocs++;
    if (!f.fids.has(fid)) { f.fids.add(fid); if (f.fileIdsPack.length < 25) f.fileIdsPack.push(fid); if (f.docs.length < 5) f.docs.push({ fileId: fid, nom: l.fichier, date: l.traiteLe, lienDrive: lienDrivePourLigne(l) }); }
  }
  for (const s of donnees.signaux) {
    if (!s.fileId || s.categorie === 'aucun') continue;
    const f = matchFiche(s.domaine, s.chemin, s.fournisseur); if (!f) continue;
    if (!f.fids.has(s.fileId)) { f.fids.add(s.fileId); if (f.fileIdsPack.length < 25) f.fileIdsPack.push(s.fileId); }
    if (s.montant) { f.totalMontant = Math.round((f.totalMontant + s.montant) * 100) / 100; f.devise = s.devise; }
    for (const [label, date] of [[s.categorie || s.fournisseur || 'Échéance', s.dateExpiration], ['Garantie', s.finGarantie], ['Retour', s.delaiRetour]] as const) if (date && f.echeances.length < 6) f.echeances.push({ label, date });
  }
  for (const m of donnees.liens) {
    const f = matchFiche(m.domaine, m.chemin, m.fichier); if (!f) continue;
    const k = `${m.threadId}|${m.fileId}`;
    if (!f.keysMail.has(k) && f.liensMail.length < 4) { f.keysMail.add(k); f.liensMail.push(m); }
  }
  const ORDRE: Record<CategorieFiche360, number> = { vehicule: 0, logement: 1, employeur: 2, voyage: 3, organisme: 4, immigration: 5, anna: 6 };
  return [...fiches.values()].filter((f) => f.nbDocs > 0 || f.echeances.length > 0 || f.liensMail.length > 0 || f.lectureSeule).sort((a, b) => ORDRE[a.categorie] - ORDRE[b.categorie] || b.nbDocs - a.nbDocs).map(({ fids: _f, keysMail: _k, ...reste }) => reste);
}
/** Consolide la liste priorisée « Actions utiles de la semaine » (#20 complet, PURE). */
export function construireActionsSemaine(donnees: { vueSignaux: ReturnType<typeof construireVueSignauxCopilote>; checklists: readonly ChecklistCopilote[]; regles: readonly RegleCopilote[]; fiches: readonly Fiche360[] }): ActionSemaine[] {
  const { vueSignaux: v, checklists, regles, fiches } = donnees;
  const corb = v.propositions.filter((c) => c.type === 'alerte-corbeille').length;
  const dem = v.propositions.filter((c) => c.type === 'demarche-active').length;
  const autoCards = v.propositions.filter(peutPasserEnAuto).length;
  const autoReg = regles.filter((r) => !r.auto && !r.zoneProtegee && r.validations >= 3).length;
  const autres = v.propositions.length - corb - dem - autoCards;
  const nExp = v.expirations.length + v.signauxRepli.filter((s) => s.section === 'expiration').length;
  const nArg = v.argent.length + v.signauxRepli.filter((s) => s.section === 'argent').length;
  const out: ActionSemaine[] = [];
  if (corb > 0) out.push({ id: 'act-corb', priorite: 1, type: 'alerte', titre: 'Corbeille sensible à vérifier', detail: `${corb} fichier(s)` });
  if (nExp > 0) out.push({ id: 'act-exp', priorite: 1, type: 'alerte', titre: 'Expirations & pièces à vérifier', detail: `${nExp} élément(s)` });
  if (v.factures.length > 0) out.push({ id: 'act-fac', priorite: 1, type: 'alerte', titre: 'Alertes factures & renouvellements', detail: `${v.factures.length} alerte(s)` });
  if (nArg > 0) out.push({ id: 'act-arg', priorite: 1, type: 'alerte', titre: 'Remboursements & retours à réclamer', detail: `${nArg} dossier(s)` });
  if (dem > 0) out.push({ id: 'act-dem', priorite: 2, type: 'demarche', titre: 'Démarches en cours', detail: `${dem} active(s)` });
  for (const ch of checklists) if (!ch.termine) out.push({ id: `act-chk-${ch.id}`, priorite: 2, type: 'demarche', titre: ch.titre, detail: `${ch.faits}/${ch.total}`, packCle: ch.packCle });
  if (autoCards + autoReg > 0) out.push({ id: 'act-auto', priorite: 2, type: 'auto', titre: 'Passage en mode auto prêt', detail: `${autoCards + autoReg} geste(s) (≥ 3 val.)` });
  if (autres > 0) out.push({ id: 'act-cas', priorite: 3, type: 'cascade', titre: 'Rangement Drive proposé', detail: `${autres} proposition(s)` });
  for (const f of fiches.slice(0, 2)) if (f.fileIdsPack.length > 0) out.push({ id: `act-pack-${f.id}`, priorite: 3, type: 'pack', titre: `Pack prêt : ${f.titre}`, detail: `${f.fileIdsPack.length} doc(s)`, packCle: f.titre });
  return out.slice(0, 8);
}
