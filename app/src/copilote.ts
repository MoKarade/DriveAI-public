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

export type TypeCarteCopilote = 'cascade' | 'doublon-dossier' | 'dossier-vide' | 'alerte-corbeille' | 'demarche-active';
type StatutCarteCopilote = 'proposé' | 'auto' | 'actif';
export interface CarteCopilote {
  id: string; horodatage: string; categorie: string; type: TypeCarteCopilote; domaine: string; chemin: string; titre: string;
  action: { cibleId?: string; sourceId?: string; dossierId?: string; fileId?: string; ids?: string[]; tids?: string[]; echeances?: string[]; nbMvts?: number; nbDocs?: number };
  statut: StatutCarteCopilote; validations: number;
}
export interface LienMailDrive { threadId: string; expediteur: string; domaine: string; chemin: string; fileId: string; fichier: string }
const TYPES_CARTES = new Set<TypeCarteCopilote>(['cascade', 'doublon-dossier', 'dossier-vide', 'alerte-corbeille', 'demarche-active']);
const STATUTS_CARTES = new Set<StatutCarteCopilote>(['proposé', 'auto', 'actif']);
const ZONES_PROT_COPILOTE = new Set(['04 · immigration', 'anna', '00 · a trier', '00 · a verifier', '_technique', '_doublons', '_medias', 'donnees & exports']);

/** Interprète les cartes ouvertes de `Copilote!A2:J` (PURE). */
export function interpreterCartesCopilote(brut: readonly string[][] = []): CarteCopilote[] {
  return brut.flatMap((r) => {
    const id = String(r[0] ?? '').trim(), type = String(r[3] ?? '').trim() as TypeCarteCopilote, statut = String(r[8] ?? '').trim() as StatutCarteCopilote;
    if (!id || id === 'Id' || !TYPES_CARTES.has(type) || !STATUTS_CARTES.has(statut)) return [];
    let action: CarteCopilote['action'] = {};
    try { const p = r[7] ? JSON.parse(String(r[7])) : null; if (p && typeof p === 'object' && !Array.isArray(p)) action = p as CarteCopilote['action']; } catch { /* ignore */ }
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
  if (carte.statut !== 'proposé' || carte.validations < 3 || carte.type === 'alerte-corbeille' || carte.type === 'demarche-active') return false;
  return ![carte.domaine, ...carte.chemin.split('/')].some((s) => { const n = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); return !!n && (ZONES_PROT_COPILOTE.has(n) || n.startsWith('_') || /^00\s*·/.test(n)); });
}
