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
    try { const p = r[7] ? JSON.parse(String(r[7])) : null; if (p && typeof p === 'object' && !Array.isArray(p)) action = { ...(p as CarteCopilote['action']), ...('echeances' in p ? { echeances: Array.isArray(p.echeances) ? p.echeances.map(String) : undefined } : {}) }; } catch { /* ignore */ }
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
  const fidsCouverts = new Set<string>(), fidsMasques = new Set<string>(), totParDev = new Map<string, { montant: number; nbRecus: number }>();
  const marquerFids = (s: Set<string>, c: CarteCopilote) => { if (c.action.fileId) s.add(c.action.fileId); for (const f of c.action.ids ?? []) if (f) s.add(f); };
  const addTot = (dev: string, mt: number, nb: number) => { const cur = totParDev.get(dev) ?? { montant: 0, nbRecus: 0 }; cur.montant += mt; cur.nbRecus += nb; totParDev.set(dev, cur); };
  for (const raw of cartes) {
    const loc = statutsLocaux[raw.id];
    if (loc === 'appliqué' || loc === 'ignoré' || loc === 'reclamé') { if (TYPES_EXP.has(raw.type) || TYPES_FAC.has(raw.type) || TYPES_ARG.has(raw.type)) marquerFids(fidsMasques, raw); continue; }
    const c: CarteCopilote = (loc === 'auto' || loc === 'proposé' || loc === 'actif') ? { ...raw, statut: loc } : raw;
    if (TYPES_EXP.has(c.type)) { expirations.push(c); marquerFids(fidsCouverts, c); }
    else if (TYPES_FAC.has(c.type)) { factures.push(c); marquerFids(fidsCouverts, c); }
    else if (TYPES_ARG.has(c.type)) { argent.push(c); marquerFids(fidsCouverts, c); if (c.type === 'remboursement') addTot(String(c.action.devise || 'CAD').trim().toUpperCase() || 'CAD', typeof c.action.montantTotal === 'number' && Number.isFinite(c.action.montantTotal) ? c.action.montantTotal : 0, typeof c.action.nbRecus === 'number' && c.action.nbRecus > 0 ? c.action.nbRecus : (c.action.ids?.length || 1)); }
    else propositions.push(c);
  }
  const signauxRepli: SignalRepli[] = [], vus = new Set<string>();
  for (const s of signaux) {
    if (!s.fileId || vus.has(s.fileId) || s.categorie === 'aucun' || fidsCouverts.has(s.fileId) || fidsMasques.has(s.fileId)) continue;
    vus.add(s.fileId);
    const lienDrive = `https://drive.google.com/file/d/${encodeURIComponent(s.fileId)}/view`, chemin = s.chemin || s.domaine, nom = s.fournisseur || s.categorie || s.fileId;
    if (s.statutReclamation === 'a-reclamer') { signauxRepli.push({ id: `sig-recl-${s.fileId}`, section: 'argent', fileId: s.fileId, titre: nom, chemin, ...(s.montant ? { montant: s.montant } : {}), devise: s.devise, lienDrive }); addTot(s.devise, s.montant ?? 0, 1); continue; }
    const jExp = diffJoursSignal(s.dateExpiration, maintenant), jRet = diffJoursSignal(s.delaiRetour, maintenant), jGar = diffJoursSignal(s.finGarantie, maintenant);
    if (!Number.isNaN(jExp) && jExp >= 0 && jExp <= 90) signauxRepli.push({ id: `sig-exp-${s.fileId}`, section: 'expiration', fileId: s.fileId, titre: `${s.categorie || s.fournisseur || s.fileId} (${s.dateExpiration})`, chemin, devise: s.devise, lienDrive });
    if (!Number.isNaN(jRet) && jRet >= 0 && jRet <= 7) signauxRepli.push({ id: `sig-ret-${s.fileId}`, section: 'argent', fileId: s.fileId, titre: `${nom} (${s.delaiRetour})`, chemin, ...(s.montant ? { montant: s.montant } : {}), devise: s.devise, lienDrive });
    else if (!Number.isNaN(jGar) && jGar >= 0 && jGar <= 30) signauxRepli.push({ id: `sig-gar-${s.fileId}`, section: 'argent', fileId: s.fileId, titre: `${nom} (${s.finGarantie})`, chemin, ...(s.montant ? { montant: s.montant } : {}), devise: s.devise, lienDrive });
  }
  const totauxAReclamer = [...totParDev.entries()].filter(([, v]) => v.nbRecus > 0).sort(([a], [b]) => a.localeCompare(b)).map(([devise, v]) => ({ devise, montant: Math.round(v.montant * 100) / 100, nbRecus: v.nbRecus }));
  return { propositions, expirations, factures, argent, signauxRepli, totauxAReclamer };
}

/** Retourne jusqu'à `limite` liens Drive/Gmail associés à une carte Copilote (PURE). */
export function liensPourCarte(carte: CarteCopilote, liens: readonly LienMailDrive[], limite = 4): LienMailDrive[] {
  const tids = new Set(carte.action.tids ?? []), fids = new Set([...(carte.action.ids ?? []), ...(carte.action.fileId ? [carte.action.fileId] : [])]), vus = new Set<string>(), out: LienMailDrive[] = [];
  for (const l of liens) {
    const cle = `${l.threadId}|${l.fileId}`;
    if (!vus.has(cle) && (tids.has(l.threadId) || fids.has(l.fileId) || (!!carte.chemin && (l.chemin === carte.chemin || l.chemin.startsWith(`${carte.chemin}/`))))) { vus.add(cle); out.push(l); if (out.length >= limite) break; }
  }
  return out;
}

/** Vrai si la carte peut basculer en mode automatique (PURE). */
export function peutPasserEnAuto(carte: CarteCopilote): boolean {
  if (carte.statut !== 'proposé' || carte.validations < 3 || !TYPES_AUTO.has(carte.type)) return false;
  return ![carte.domaine, ...carte.chemin.split('/')].some((s) => { const n = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); return !!n && (ZONES_PROT_COPILOTE.has(n) || n.startsWith('_') || /^00\s*·/.test(n)); });
}
