/**
 * etatGlobal.tsx — état PARTAGÉ de l'app (P1/C28-02, plan architecte validé 2026-07-08).
 *
 * Avant : chaque vue faisait son propre `lirePlage` UNE fois au montage → données figées tant
 * qu'on ne changeait pas de section (app ouverte = photo de l'ouverture, à jamais), lectures
 * redondantes, états de chargement hétérogènes. Désormais UN cycle : le fournisseur charge les
 * onglets de la Sheet en un `Promise.all`, les vues consomment, et un rafraîchissement
 * périodique (5 min — le moteur n'écrit que par ticks de 5 min) + manuel (bouton ⟳) invalide le
 * cache et relit. L'Index est servi en ÉTAT COURANT (`etatCourantIndex` : dédoublonné par
 * fil/fichier — la section Suspects redevient honnête).
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { lirePlage, lireProgressionLive, viderCachePlages } from './google';
import { LigneIndex, LigneProgression, interpreterIndex, interpreterProgression, etatCourantIndex } from './etat';

export interface DonneesEtat {
  index: LigneIndex[];       // état COURANT (dédoublonné) — les vues n'ont plus à le faire
  santeBrut: string[][];
  journalBrut: string[][];
  reglagesBrut: string[][];
  telemetrieBrut: string[][]; // onglet Télémétrie (C28-24) — page Moteur
  coutsBrut: string[][];      // onglet Coûts (C28-58) — graphique « Réglages » (idée Marc, 29/09)
  reorgBrut?: string[][];     // onglet Réorg (propositions + dossiers vides) — synthèse R3
  actionsBrut?: string[][];   // onglet Actions (ADR-0081 vague 3b) — journal réversible
  copiloteBrut?: string[][];  // onglet Copilote (Lot 2B) — cartes proactives & démarches
  liensBrut?: string[][];     // onglet Liens (Lot 2B) — courriels liés aux documents Drive
  signauxBrut?: string[][];   // onglet Signaux (Lot 3B) — factures, expirations & remboursements
}

interface EtatGlobal {
  donnees: DonneesEtat | null; // null = premier chargement pas encore abouti
  erreur: string;
  synchroA: Date | null;       // horodatage de la dernière lecture réussie (badge d'en-tête)
  rafraichir: (forcer?: boolean) => Promise<void>;
}

const Ctx = createContext<EtatGlobal>({
  donnees: null, erreur: '', synchroA: null, rafraichir: async () => {},
});

export function useEtatGlobal(): EtatGlobal {
  return useContext(Ctx);
}

const INTERVALLE_MS = 5 * 60 * 1000; // aligné sur le tick moteur — plus court ne montrerait rien de neuf
const abonnesProgression = new Set<() => void>();

export function FournisseurEtat({ children }: { children: ReactNode }) {
  const [donnees, setDonnees] = useState<DonneesEtat | null>(null);
  const [erreur, setErreur] = useState('');
  const [synchroA, setSynchroA] = useState<Date | null>(null);
  const promesseEnCours = useRef<Promise<void> | null>(null);
  const forcerSuivant = useRef(false);

  const lireCycle = useCallback(async (forcerCourant: boolean) => {
    try {
      if (forcerCourant) {
        viderCachePlages(); // relire VRAIMENT (le cache 60 s servirait la même photo)
        abonnesProgression.forEach((cb) => cb());
      }
      const [index, sante, journal, reglages, telemetrie, couts, reorg, actions, copilote, liens, signaux] = await Promise.all([
        // Fenêtre OUVERTE (`A2:H`, sans borne haute) — JAMAIS `A2:H<N>` : l'Index est append-only
        // (garde-fou §2) et le reset C28-33 y écrit DEUX lignes par fichier (`tri33|` puis `tri33p|`).
        // Une borne de TÊTE fige l'app EN SILENCE dès qu'elle est franchie (zéro erreur, zéro log :
        // Marc croirait le moteur arrêté). Repéré en revue le 2026-07-31, à ~4 600 fichiers du seuil.
        lirePlage('Index', 'A2:H'),
        lirePlage('Santé', 'A2:A'), // fenêtre OUVERTE, comme Index et Journal : `A2:A10` tenait à zéro
        // marge (9 lignes écrites pour 9 lues) et la 10ᵉ aurait disparu EN SILENCE — le défaut
        // exact déjà vécu côté connecteur MCP (retiré depuis) quand Santé est passée de 6 à 7 lignes (revue C28-99).
        // MÊME piège que l'Index (ci-dessus) : le Journal est append-only avec rotation (le moteur
        // supprime les PLUS VIEILLES au-delà de ~25 000). `A2:D5000` lisait donc les 5 000 lignes les
        // plus ANCIENNES → « 0 erreur · 7 j » en vert alors que le moteur en accumule AUJOURD'HUI
        // (revue de fond 2026-07-31). Fenêtre OUVERTE `A2:D` : les lignes récentes (en bas) sont vues.
        // (Perf de la lecture entière : traitée en Vague 2 — ancrage en queue / compteur télémétrie.)
        lirePlage('Journal', 'A2:D'),
        // Onglets créés par le moteur au premier usage — absents = table vide, pas une erreur.
        lirePlage('Réglages', 'A2:B2').catch(() => [] as string[][]),
        lirePlage('Télémétrie', 'A2:D30').catch(() => [] as string[][]),
        // Postes bornés par les opérations RÉELLES du tick (REGISTRE_OPERATIONS, ~40 au plus) —
        // même fenêtre que Télémétrie, même raison (onglet créé au premier tick, absent ≠ erreur).
        lirePlage('Coûts', 'A2:D40').catch(() => [] as string[][]),
        lirePlage('Réorg', 'A2:H').catch(() => [] as string[][]),
        lirePlage('Actions', 'A2:H').catch(() => [] as string[][]),
        lirePlage('Copilote', 'A2:J').catch(() => [] as string[][]),
        lirePlage('Liens', 'A2:H').catch(() => [] as string[][]),
        lirePlage('Signaux', 'A2:L').catch(() => [] as string[][]),
      ]);
      setDonnees({
        index: etatCourantIndex(interpreterIndex(index)),
        santeBrut: sante, journalBrut: journal,
        reglagesBrut: reglages, telemetrieBrut: telemetrie, coutsBrut: couts,
        reorgBrut: reorg,
        actionsBrut: actions,
        copiloteBrut: copilote,
        liensBrut: liens,
        signauxBrut: signaux,
      });
      setErreur('');
      setSynchroA(new Date());
    } catch (e) {
      setErreur(String(e)); // les données PRÉCÉDENTES restent affichées (bandeau + Réessayer)
    }
  }, []);

  const rafraichir = useCallback((forcer = false): Promise<void> => {
    if (promesseEnCours.current) {
      if (forcer) forcerSuivant.current = true;
      return promesseEnCours.current;
    }
    const cycle = (async () => {
      let forcerCourant = forcer;
      try {
        do {
          forcerSuivant.current = false;
          await lireCycle(forcerCourant);
          forcerCourant = true;
        } while (forcerSuivant.current);
      } finally {
        promesseEnCours.current = null;
      }
    })();
    promesseEnCours.current = cycle;
    return cycle;
  }, [lireCycle]);

  useEffect(() => {
    void rafraichir();
    const t = setInterval(() => void rafraichir(true), INTERVALLE_MS);
    return () => clearInterval(t);
  }, [rafraichir]);

  return <Ctx.Provider value={{ donnees, erreur, synchroA, rafraichir }}>{children}</Ctx.Provider>;
}

/* ---------- Progression LIVE (C28-18) ---------- */

// 15 s : le moteur écrit l'onglet Progression en FIN de tick — un poll léger dédié (petite plage,
// hors cache 60 s) montre chaque saut d'avancement sans toucher au cycle 5 min du gros état.
const PROGRESSION_POLL_MS = 15 * 1000;

/**
 * Suivi LIVE des opérations du moteur (onglet Progression). État LOCAL au composant qui l'utilise
 * (jamais dans le contexte global : son rythme est le sien). Une lecture en échec est silencieuse —
 * le poll suivant réessaie, les dernières lignes restent affichées.
 */
export function useProgressionLive(): LigneProgression[] {
  const [lignes, setLignes] = useState<LigneProgression[]>([]);
  useEffect(() => {
    let vivant = true;
    const lire = async () => {
      try {
        const brut = await lireProgressionLive();
        if (vivant) setLignes(interpreterProgression(brut));
      } catch {
        /* silencieux : réessayé au poll suivant */
      }
    };
    const relire = () => { void lire(); };
    abonnesProgression.add(relire);
    void lire();
    const t = setInterval(relire, PROGRESSION_POLL_MS);
    return () => { vivant = false; abonnesProgression.delete(relire); clearInterval(t); };
  }, []);
  return lignes;
}
