// @vitest-environment jsdom
/**
 * copilote.test.ts — tests unitaires de `app/src/copilote.ts` et tests DOM de `Copilote.tsx` (Lot 1B).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { interpreterIndex } from '../src/etat';
import type { DonneesEtat } from '../src/etatGlobal';
import {
  construireVueSignauxCopilote,
  extraireMouvementsDrive,
  filtrerMouvementsDrive,
  formaterMontantSignal,
  interpreterCartesCopilote,
  interpreterLiens,
  interpreterSignaux,
  liensPourCarte,
  peutPasserEnAuto,
  syntheseSemaineCopilote,
} from '../src/copilote';

const mockEtat = vi.hoisted(() => ({
  donnees: null as DonneesEtat | null,
  executer: vi.fn(async (id: string, decision: string) => ({
    ok: true,
    id,
    statut: decision === 'ignorer' ? 'ignoré' : decision === 'reclame' ? 'reclamé' : decision === 'passer-auto' ? 'auto' : decision === 'desactiver-auto' ? 'proposé' : 'appliqué',
    actionIds: decision === 'executer' ? [`act-${id}`] : [],
    nbValidations: 1,
    proposerAuto: false,
    message: 'Décision appliquée.',
  })),
  annuler: vi.fn(async () => 'Action annulée.'),
}));

vi.mock('../src/etatGlobal', () => ({
  useEtatGlobal: () => ({
    donnees: mockEtat.donnees,
    erreur: '',
    synchroA: null,
    rafraichir: async () => {},
  }),
}));

vi.mock('../src/google', () => ({
  MARQUEUR_DROITS_FICHIER: 'droits-insuffisants-sur-element',
  executerDecisionCopilote: mockEtat.executer,
  annulerActionMoteur: mockEtat.annuler,
}));

import { Copilote } from '../src/vues/Copilote';

describe('copilote.ts — logique pure (extraction, filtrage, synthèse 7 j)', () => {
  it('fusionne Actions Drive et Journal (VeilleDrive, Corrections, Entités, Pipeline réel & mock, Reorg, etc.) triés du plus récent au plus ancien', () => {
    const index = interpreterIndex([
      ['drive|f-10', '2026-07-06T12:00:00', '2026-07-06_Facture_Exemple.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'abc', '0.95'],
      ['drive|f-20', '2026-07-06T11:00:00', '2026-07-05_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Bellerives', 'classé', 'def', '0.92'],
      ['drive|f-30', '2026-07-06T10:00:00', '2026-07-04_Passeport_Exemple.pdf', '04 · Immigration', '04 · Immigration/Passeport', 'manuel', 'ghi', ''],
    ]);

    const actionsBrut: string[][] = [
      ['act-111111', '2026-07-06 14:30:00', 'drive-deplacer', 'f-10', '{"nom":"a.pdf"}', '{"nom":"2026-07-06_Facture_Exemple.pdf"}', 'appliqué', 'Classement dépôt manuel'],
      ['act-222222', '2026-07-06 14:25:00', 'drive-renommer', 'f-inconnu', '{"nom":"vieux.pdf"}', '{"nom":"neuf.pdf"}', 'annulé', ''],
      ['act-333333', '2026-07-06 14:20:00', 'drive-dossier', 'd-1', '', '{"nom":"2026"}', 'appliqué', ''],
      ['act-444444', '2026-07-06 14:19:00', 'gmail-libelle', 'Voyages', '', 'Voyages', 'appliqué', 'Libellé Gmail'],
    ];

    const journalBrut: string[][] = [
      ['2026-07-06T14:29:00', 'INFO', 'VeilleDrive', 'Changement direct détecté : 2026-07-05_Relevé_Bellerives.pdf → 02 · Finances/Bellerives'],
      ['2026-07-06T14:28:00', 'INFO', 'VeilleDrive', 'Document catalogué (lecture seule) : 2026-07-04_Passeport_Exemple.pdf → 04 · Immigration/Passeport'],
      ['2026-07-06T14:27:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances/Bellerives (2 document(s) mis à jour)'],
      ['2026-07-06T14:26:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 03 · Logement'],
      ['2026-07-06T14:24:00', 'INFO', 'VeilleDrive', 'Dossier utilitaire rangé : Takeout'],
      ['2026-07-06T14:23:00', 'INFO', 'VeilleDrive', 'Fichier envoyé vers 00 · À trier'],
      ['2026-07-06T14:22:00', 'INFO', 'Corrections', 'Correction enregistrée (émetteur « Bellerives »).'],
      ['2026-07-06T14:21:00', 'INFO', 'Entités', 'Entité renommée depuis dossier : Ancien → Voiture Exemple'],
      ['2026-07-06T14:18:00', 'INFO', 'Entités', 'Dossier d\'entité créé (racine du domaine, à plat) : 02 · Finances/Cablonet'],
      ['2026-07-06T14:17:00', 'INFO', 'Pipeline', 'classé → 02 · Finances/2026 : 2026-07-06_Facture_Exemple.pdf'],
      ['2026-07-06T14:16:00', 'INFO', 'Pipeline', 'classé : 2026-07-05_Relevé_Bellerives.pdf → 02 · Finances/Bellerives'],
      ['2026-07-06T14:15:00', 'INFO', 'Pipeline', '2 raccourci(s) multi-entités créé(s) pour : Bellerives'],
      ['2026-07-06T14:14:00', 'INFO', 'Reorg', 'Dossier fusionné : Archives'],
      ['2026-07-06T14:13:00', 'INFO', 'Migration', 'Document migré vers 01 · Administratif'],
      ['2026-07-06T14:12:00', 'INFO', 'TriGmail', '3 fil(s) trié(s)'],
      ['2026-07-06T14:11:00', 'ERREUR', 'Pipeline', 'Échec OCR temporaire'],
      ['2026-07-06T14:10:00', 'INFO', 'VeilleDrive', '   '],
    ];

    const mvts = extraireMouvementsDrive({ journalBrut, actionsBrut, index });

    // TriGmail, ERREUR, message vide et gmail-libelle sont exclus -> 3 actions + 14 journal = 17
    expect(mvts).toHaveLength(17);
    expect(mvts[0]?.id).toBe('action|act-111111|3');
    expect(mvts[0]?.lienDrive).toBe('https://drive.google.com/file/d/f-10/view');
    expect(mvts[0]?.categorie).toBe('fichier');

    // VeilleDrive direct & lecture seule enrichis par index
    const veilleDirect = mvts.find((m) => m.date === '2026-07-06T14:29:00');
    expect(veilleDirect?.titre).toBe('2026-07-05_Relevé_Bellerives.pdf');
    expect(veilleDirect?.chemin).toBe('02 · Finances/Bellerives');
    expect(veilleDirect?.lienDrive).toBe('https://drive.google.com/file/d/f-20/view');

    const veilleLectureSeule = mvts.find((m) => m.date === '2026-07-06T14:28:00');
    expect(veilleLectureSeule?.detail).toBe('VeilleDrive · lecture seule');
    expect(veilleLectureSeule?.lienDrive).toBe('https://drive.google.com/file/d/f-30/view');

    // VeilleDrive Dossier modifié avec et sans parenthèses
    const dossierParens = mvts.find((m) => m.date === '2026-07-06T14:27:00');
    expect(dossierParens?.categorie).toBe('dossier');
    expect(dossierParens?.titre).toBe('02 · Finances/Bellerives');
    expect(dossierParens?.detail).toBe('2 document(s) mis à jour');

    const dossierSimple = mvts.find((m) => m.date === '2026-07-06T14:26:00');
    expect(dossierSimple?.categorie).toBe('dossier');
    expect(dossierSimple?.detail).toBe('VeilleDrive');

    // Action annulée sans fichier dans l'Index : pas de lienDrive inventé
    const actionAnnulee = mvts.find((m) => m.id === 'action|act-222222|2');
    expect(actionAnnulee?.annule).toBe(true);
    expect(actionAnnulee?.detail).toBe('drive-renommer');
    expect(actionAnnulee?.lienDrive).toBeUndefined();

    // Action drive-dossier : detail par défaut = drive-dossier
    const actionDossier = mvts.find((m) => m.id === 'action|act-333333|1');
    expect(actionDossier?.categorie).toBe('dossier');
    expect(actionDossier?.detail).toBe('drive-dossier');

    // Pipeline formats réel et mock
    const pipeReel = mvts.find((m) => m.date === '2026-07-06T14:17:00');
    expect(pipeReel?.titre).toBe('2026-07-06_Facture_Exemple.pdf');
    expect(pipeReel?.chemin).toBe('02 · Finances/2026');
    expect(pipeReel?.detail).toBe('classé');

    const pipeMock = mvts.find((m) => m.date === '2026-07-06T14:16:00');
    expect(pipeMock?.titre).toBe('2026-07-05_Relevé_Bellerives.pdf');
    expect(pipeMock?.chemin).toBe('02 · Finances/Bellerives');

    // Entités et Corrections
    expect(mvts.find((m) => m.date === '2026-07-06T14:22:00')?.categorie).toBe('apprentissage');
    const entiteRenom = mvts.find((m) => m.date === '2026-07-06T14:21:00');
    expect(entiteRenom?.categorie).toBe('apprentissage');
    expect(entiteRenom?.chemin).toBe('Voiture Exemple');
    expect(mvts.find((m) => m.date === '2026-07-06T14:18:00')?.categorie).toBe('dossier');
    expect(mvts.find((m) => m.date === '2026-07-06T14:14:00')?.categorie).toBe('dossier');
    expect(mvts.find((m) => m.date === '2026-07-06T14:13:00')?.categorie).toBe('fichier');
  });

  it('gère les dates invalides, la limite de sortie, le filtrage et la synthèse 7 jours glissants', () => {
    const mvts = extraireMouvementsDrive(
      {
        journalBrut: [
          ['date-invalide-a', 'INFO', 'Corrections', 'Apprentissage sans date valide'],
          ['2026-07-01T10:00:00', 'INFO', 'Pipeline', 'classé → 02 · Finances : Ancien.pdf'],
          ['2026-07-08T10:00:00', 'INFO', 'Corrections', 'Apprentissage récent'],
          ['2026-07-09T10:00:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances'],
          ['date-invalide-b', 'INFO', 'Pipeline', 'classé → 01 · Administratif : SansDate.pdf'],
        ],
      },
      { limite: 5 },
    );
    expect(mvts[0]?.date).toBe('2026-07-09T10:00:00');
    expect(mvts[1]?.date).toBe('2026-07-08T10:00:00');
    expect(mvts[2]?.date).toBe('2026-07-01T10:00:00');

    expect(filtrerMouvementsDrive(mvts, 'tous')).toHaveLength(5);
    expect(filtrerMouvementsDrive(mvts, 'dossier')).toHaveLength(1);
    expect(filtrerMouvementsDrive(mvts, 'fichier')).toHaveLength(2);
    expect(filtrerMouvementsDrive(mvts, 'apprentissage')).toHaveLength(2);

    const syn = syntheseSemaineCopilote(mvts, new Date('2026-07-10T12:00:00Z'));
    expect(syn).toEqual({
      totalMouvements: 2,
      fichiers: 0,
      dossiers: 1,
      apprentissages: 1,
    });

    expect(extraireMouvementsDrive({ journalBrut: [['2026-07-09T10:00:00', 'INFO', 'Corrections', 'X']] }, { limite: 0 })).toEqual([]);
  });

  it('gère parenthèses dossiers, doublons Pipeline, chemins avec :, homonymes Index, doublons Actions, dates futures et cellules non-string', () => {
    const index = interpreterIndex([
      ['drive|f-trier', '2026-07-06T10:00:00', 'facture.pdf', '00 · À trier', '00 · À trier', 'à trier', '', ''],
      ['drive|f-classe', '2026-07-06T11:00:00', 'facture.pdf', '02 · Finances', '02 · Finances/2026', 'classé', '', ''],
      ['drive|f-dup', '2026-07-06T12:00:00', '2026-07-01_Facture.pdf', '', '_Doublons', 'doublon', 'e3b0c442', ''],
      ['tri|fil-999|1751500000|1', '2026-07-06T12:00:00', 'Courriel seul.pdf', '', '', 'trié', '', ''],
      ['important|msg-999', '2026-07-06T12:00:00', 'Courriel seul.pdf', '', '', 'important', '', ''],
    ]);

    const journalBrut = [
      ['2026-07-10T11:00:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances/Banque (Perso)/Relevés (2 document(s) mis à jour dans le catalogue)'],
      ['2026-07-10T10:55:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances/Archives (2025)'],
      ['2026-07-10T10:50:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances/Archives (2025) (arborescence à jour)'],
      ['2026-07-10T10:45:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances/Bellerives (2 doc(s) (dont 1 (urgent)) mis à jour)'],
      ['2026-07-10T10:40:00', 'INFO', 'Pipeline', 'doublon → _Doublons : 2026-07-01_Facture.pdf (taille 18220 o, empreinte e3b0c442, exemplaire vivant f-1)'],
      ['2026-07-10T10:35:00', 'INFO', 'Pipeline', 'classé → 08 · Perso/Projet : Alpha : 2026-07-01_Note.pdf'],
      ['2026-07-10T10:30:00', 'INFO', 'Pipeline', 'classé → 02 · Finances : Re: Facture.pdf'],
      ['2026-07-10T10:25:00', 'INFO', 'Pipeline', 'classé → 00 · À trier : facture.pdf'],
      ['2026-07-10T10:20:00', 'INFO', 'Pipeline', 'classé → 02 · Finances/2026 : facture.pdf'],
      ['2026-07-10T10:15:00', 'INFO', 'Pipeline', 'classé → 99 · Autre : facture.pdf'],
      ['2026-07-10T10:10:00', 'INFO', 'Pipeline', 'classé → 01 · Administratif : Courriel seul.pdf'],
      [1720600000000, undefined, 'Corrections', 'Cellule numérique tolérée'],
      ['2099-01-01T00:00:00Z', 'INFO', 'Corrections', 'Date future à exclure'],
    ] as unknown as string[][];

    const actionsBrut = [
      ['act-dup111', '2026-07-10 11:01:00', 'drive-deplacer', 'f-trier', '', '{"nom":"facture.pdf"}', 'appliqué', 'Premier'],
      ['act-dup111', '2026-07-10 11:02:00', 'drive-deplacer', 'f-classe', '', '{"nom":"facture.pdf"}', 'appliqué', 'Doublon id'],
      [12345, null, 'drive-deplacer', '', '', '', 'appliqué', 'Ignoré sans crash'],
    ] as unknown as string[][];

    const mvts = extraireMouvementsDrive({ journalBrut, actionsBrut, index });
    expect(new Set(mvts.map((m) => m.id)).size).toBe(mvts.length);

    expect(mvts.find((m) => m.date === '2026-07-10T11:00:00')?.titre).toBe('02 · Finances/Banque (Perso)/Relevés');
    expect(mvts.find((m) => m.date === '2026-07-10T10:55:00')).toMatchObject({ titre: '02 · Finances/Archives (2025)', detail: 'VeilleDrive' });
    expect(mvts.find((m) => m.date === '2026-07-10T10:50:00')).toMatchObject({ titre: '02 · Finances/Archives (2025)', detail: 'arborescence à jour' });
    expect(mvts.find((m) => m.date === '2026-07-10T10:45:00')?.titre).toBe('02 · Finances/Bellerives');

    const dup = mvts.find((m) => m.date === '2026-07-10T10:40:00');
    expect(dup?.titre).toBe('2026-07-01_Facture.pdf');
    expect(dup?.chemin).toBe('_Doublons');
    expect(dup?.detail).toContain('taille 18220 o');
    expect(dup?.lienDrive).toBe('https://drive.google.com/file/d/f-dup/view');

    expect(mvts.find((m) => m.date === '2026-07-10T10:35:00')).toMatchObject({ chemin: '08 · Perso/Projet : Alpha', titre: '2026-07-01_Note.pdf' });
    expect(mvts.find((m) => m.date === '2026-07-10T10:30:00')).toMatchObject({ chemin: '02 · Finances', titre: 'Re: Facture.pdf' });

    expect(mvts.find((m) => m.date === '2026-07-10T10:25:00')?.lienDrive).toBe('https://drive.google.com/file/d/f-trier/view');
    expect(mvts.find((m) => m.date === '2026-07-10T10:20:00')?.lienDrive).toBe('https://drive.google.com/file/d/f-classe/view');
    expect(mvts.find((m) => m.date === '2026-07-10T10:15:00')?.lienDrive).toBeUndefined();
    expect(mvts.find((m) => m.date === '2026-07-10T10:10:00')?.lienDrive).toBeUndefined();
    expect(mvts.find((m) => m.titre === 'Cellule numérique tolérée')?.date).toBe('1720600000000');

    const syn = syntheseSemaineCopilote(mvts, new Date('2026-07-10T12:00:00'));
    expect(syn.totalMouvements).toBe(13); // 11 journal valides (sans future ni numérique) + 2 actions
  });

  it('couvre les cas limites B1/B2a/B2c/B3a/B3b/B4/B6 (Index multi-lignes, marqueurs non-Drive, flèches et : dans noms)', () => {
    const index = [
      ...interpreterIndex([
        ['drive|f-colon', '2026-07-10T10:00:00', '2026-07-01_Objet : Facture.pdf', '02 · Finances', '02 · Finances/2026', 'classé', '', ''],
        ['drive|f-10', '2026-07-10T10:01:00', 'facture_unique.pdf', '02 · Finances', '02 · Finances/2026', 'classé', '', ''],
        ['reanalyse|tag1|f-10', '2026-07-10T10:02:00', 'facture_unique.pdf', '02 · Finances', '02 · Finances/2026', 'classé', '', ''],
        ['dryrunv2|run1|f-10', '2026-07-10T10:03:00', 'facture_unique.pdf', '02 · Finances', '02 · Finances/2026', 'classé', '', ''],
        ['shared|orig-1', '2026-07-10T10:04:00', 'facture_unique.pdf', '02 · Finances', '02 · Finances/2026', 'classé', '', ''],
        ['messageId|msg-1', '2026-07-10T10:05:00', 'facture_unique.pdf', '02 · Finances', '02 · Finances/2026', 'classé', '', ''],
      ]),
      { cle: 12345 as unknown as string, traiteLe: '', fichier: 'Invalide.pdf', domaine: '', chemin: '', statut: '', confiance: '' },
      { cle: undefined as unknown as string, traiteLe: '', fichier: '', domaine: '', chemin: '', statut: '', confiance: '' },
    ];

    const maintenant = Date.now();
    const journalBrut: string[][] = [
      // B1 avec Index et sans Index
      ['2026-07-10T12:00:00', 'INFO', 'Pipeline', 'classé → 02 · Finances/2026 : 2026-07-01_Objet : Facture.pdf'],
      ['2026-07-10T11:59:00', 'INFO', 'Pipeline', 'classé → 02 · Finances/2026 : 2026-07-02_HorsIndex : Facture.pdf'],
      ['2026-07-10T11:58:00', 'INFO', 'Pipeline', 'classé → 02 · Finances/2026 sans deux-points'],
      // B2a dossier (2 documents) sans suffixe mis à jour
      ['2026-07-10T11:57:00', 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances/Lot (2 documents)'],
      // B2c nom contenant → (avec et sans espaces autour du séparateur)
      ['2026-07-10T11:56:00', 'INFO', 'VeilleDrive', 'Changement direct détecté : Plan A → B.pdf → 02 · Finances/Plans'],
      ['2026-07-10T11:55:00', 'INFO', 'VeilleDrive', 'Changement direct détecté : Plan C→02 · Finances'],
      // B3a/B3b : VeilleDrive sans chemin + Index append-only / dryrunv2 / shared
      ['2026-07-10T11:54:00', 'INFO', 'VeilleDrive', 'Changement direct détecté : facture_unique.pdf → classé'],
      // B4 : 50 mouvements réels récents + 1 date future (ne doit pas évincer le 50e mouvement réel)
      ...Array.from({ length: 50 }, (_, i) => [
        new Date(maintenant - (i + 1) * 60_000).toISOString(),
        'INFO',
        'Corrections',
        `Mvt_reel_${i}`,
      ]),
      ['2099-01-01T00:00:00Z', 'INFO', 'Corrections', 'Mvt_futur_evince'],
    ];

    const mvts = extraireMouvementsDrive({ journalBrut, index }, { limite: 50 });
    expect(mvts).toHaveLength(50);
    expect(mvts.some((m) => m.titre === 'Mvt_futur_evince')).toBe(false);
    expect(mvts.some((m) => m.titre === 'Mvt_reel_49')).toBe(true);

    // Vérifications B1/B2a/B2c/B3a/B3b sur extraction complète
    const tous = extraireMouvementsDrive({ journalBrut, index }, { limite: 100 });
    expect(tous.find((m) => m.date === '2026-07-10T12:00:00')).toMatchObject({
      chemin: '02 · Finances/2026',
      titre: '2026-07-01_Objet : Facture.pdf',
      lienDrive: 'https://drive.google.com/file/d/f-colon/view',
    });
    expect(tous.find((m) => m.date === '2026-07-10T11:59:00')).toMatchObject({
      chemin: '02 · Finances/2026',
      titre: '2026-07-02_HorsIndex : Facture.pdf',
    });
    expect(tous.find((m) => m.date === '2026-07-10T11:58:00')).toMatchObject({
      titre: 'classé → 02 · Finances/2026 sans deux-points',
      detail: 'Pipeline',
    });
    expect(tous.find((m) => m.date === '2026-07-10T11:57:00')).toMatchObject({
      titre: '02 · Finances/Lot (2 documents)',
      detail: 'VeilleDrive',
    });
    expect(tous.find((m) => m.date === '2026-07-10T11:56:00')).toMatchObject({
      titre: 'Plan A → B.pdf',
      chemin: '02 · Finances/Plans',
    });
    expect(tous.find((m) => m.date === '2026-07-10T11:55:00')).toMatchObject({
      titre: 'Plan C',
      chemin: '02 · Finances',
    });
    expect(tous.find((m) => m.date === '2026-07-10T11:54:00')?.lienDrive).toBe('https://drive.google.com/file/d/f-10/view');
  });
});

describe('Copilote.tsx — rendu DOM, filtres et bilinguisme FR/EN', () => {
  beforeEach(() => {
    mockEtat.donnees = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('affiche le chargement quand donnees est null puis la synthèse et le fil avec filtres', () => {
    const { rerender } = render(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    expect(screen.getByText('Chargement…')).toBeDefined();

    const maintenant = new Date();
    const recentIso = new Date(maintenant.getTime() - 3600 * 1000).toISOString();
    const onAller = vi.fn();

    mockEtat.donnees = {
      index: interpreterIndex([
        ['drive|f-1', recentIso, '2026-07-06_Facture_Exemple.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'abc', '0.95'],
      ]),
      santeBrut: [],
      journalBrut: [
        [recentIso, 'INFO', 'VeilleDrive', 'Changement direct détecté : 2026-07-06_Facture_Exemple.pdf → 02 · Finances/2026'],
        [recentIso, 'INFO', 'VeilleDrive', 'Dossier modifié : 02 · Finances/2026 (1 document mis à jour)'],
        [recentIso, 'INFO', 'Corrections', 'Correction enregistrée (émetteur « Exemple »).'],
      ],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
      actionsBrut: [
        ['act-annule1', recentIso.replace('T', ' '), 'drive-renommer', 'f-autre', '{"nom":"A.pdf"}', '{"nom":"B.pdf"}', 'annulé', 'Renommage annulé'],
      ],
    };

    rerender(createElement(Copilote, { langue: 'fr', onAller }));
    expect(screen.getByRole('heading', { level: 1, name: 'Copilote' })).toBeDefined();
    expect(screen.getByText('Actions utiles de la semaine')).toBeDefined();
    expect(screen.getByText('Ce qui a bougé dans ton Drive')).toBeDefined();
    expect(screen.getByText('Annulé')).toBeDefined();

    // Navigation vers Documents
    fireEvent.click(screen.getByRole('button', { name: /Ouvrir Documents/ }));
    expect(onAller).toHaveBeenCalledWith('documents');

    // Filtrage par Dossiers puis Apprentissages
    fireEvent.click(screen.getByRole('button', { name: 'Dossiers' }));
    expect(screen.getByText('02 · Finances/2026')).toBeDefined();
    expect(screen.queryByText('Correction enregistrée (émetteur « Exemple »).')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Apprentissages' }));
    expect(screen.getByText('Correction enregistrée (émetteur « Exemple »).')).toBeDefined();

    // Traduction EN
    rerender(createElement(Copilote, { langue: 'en', onAller }));
    expect(screen.getByRole('heading', { level: 1, name: 'Copilot' })).toBeDefined();
    expect(screen.getByText('Useful actions this week')).toBeDefined();
  });

  it('affiche les états vides propres quand aucun mouvement ou aucun résultat pour le filtre', () => {
    mockEtat.donnees = {
      index: [],
      santeBrut: [],
      journalBrut: [['date-illisible', 'INFO', 'Corrections', 'Une correction seule']],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
      actionsBrut: [],
    };
    const { rerender } = render(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    expect(screen.getByText('Une correction seule')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Dossiers' }));
    expect(screen.getByText('Aucun mouvement pour ce filtre.')).toBeDefined();

    mockEtat.donnees = {
      index: [],
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
      actionsBrut: [],
    };
    rerender(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    fireEvent.click(screen.getByRole('button', { name: 'Tous' }));
    expect(screen.getByText('Aucun mouvement Drive récent enregistré.')).toBeDefined();
  });

  it('calcule la synthèse 7 jours au-delà de 50 mouvements tout en bornant le fil UI à 50 et en excluant le futur', () => {
    const maintenant = Date.now();
    const journalBrut: string[][] = Array.from({ length: 80 }, (_, idx) => [
      new Date(maintenant - (idx + 1) * 60_000).toISOString(),
      'INFO',
      'Pipeline',
      `classé → 02 · Finances : Doc_${idx}.pdf`,
    ]);
    journalBrut.push(['2099-01-01T00:00:00Z', 'INFO', 'Corrections', 'Futur ignoré']);

    mockEtat.donnees = {
      index: [],
      santeBrut: [],
      journalBrut,
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
      actionsBrut: [],
    };

    render(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    expect(screen.getByText('80')).toBeDefined();
    expect(screen.getByText('50')).toBeDefined();
    expect(document.querySelectorAll('.copilote-vue .lignes .ligne')).toHaveLength(50);
  });
});

describe('copilote.ts & Copilote.tsx — cartes proactives & démarches (Lot 2B)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('interprète les cartes Copilote, les liens Liens, liensPourCarte et peutPasserEnAuto', () => {
    expect(interpreterCartesCopilote()).toEqual([]);
    expect(interpreterLiens()).toEqual([]);
    const cartes = interpreterCartesCopilote([
      ['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations'],
      ['c1', '2026-07-06', 'carte', 'cascade', '02 · Finances', '02 · Finances/Banque', 'Regrouper', '{"cibleId":"d1","ids":["f1"]}', 'proposé', '3'],
      ['c2', '2026-07-06', 'carte', 'alerte-corbeille', '04 · Immigration', '04 · Immigration/Permis', 'Corbeille', '{json-invalide', 'proposé', '5'],
      ['c3', '2026-07-06', 'demarche', 'demarche-active', '04 · Immigration', '04 · Immigration/Permis', 'Démarche', '{"ids":["f1","f2"],"tids":["t1"],"echeances":["2026-08-01"]}', 'actif', '0'],
      ['c4', '2026-07-06', 'carte', 'cascade', '05 · Carrière', '05 · Carrière/X', 'Fait', '{}', 'appliqué', '1'],
      ['c5', '2026-07-06', 'carte', 'inconnu', '05 · Carrière', '05 · Carrière/X', 'Type inconnu', '{}', 'proposé', '1'],
    ]);
    expect(cartes).toHaveLength(3);
    expect(cartes[1]!.action).toEqual({});
    expect(peutPasserEnAuto(cartes[0]!)).toBe(true);
    expect(peutPasserEnAuto(cartes[1]!)).toBe(false);
    expect(peutPasserEnAuto(cartes[2]!)).toBe(false);
    expect(peutPasserEnAuto({ ...cartes[0]!, domaine: '04 · Immigration', chemin: '04 · Immigration/Permis' })).toBe(false);
    expect(peutPasserEnAuto({ ...cartes[0]!, validations: 1 })).toBe(false);

    const liens = interpreterLiens([
      ['Horodatage', 'ThreadId', 'MessageId', 'Expéditeur', 'Domaine', 'Chemin', 'FileId', 'Fichier'],
      ['2026-07-06', 't1', 'm1', 'a@b.test', '04 · Immigration', '04 · Immigration/Permis', 'f1', 'Doc1.pdf'],
      ['2026-07-06', 't1', 'm1', 'a@b.test', '04 · Immigration', '04 · Immigration/Permis', 'f1', 'Doc1.pdf'],
      ['2026-07-06', 't2', 'm2', 'b@b.test', '04 · Immigration', '04 · Immigration/Permis/2026', 'f9', 'Doc9.pdf'],
    ]);
    expect(liens).toHaveLength(3);
    expect(liensPourCarte(cartes[2]!, liens, 1)).toHaveLength(1);
    expect(liensPourCarte(cartes[2]!, liens)).toHaveLength(2);
    expect(liensPourCarte({ ...cartes[1]!, chemin: '', action: { fileId: 'f1' } }, liens)).toHaveLength(1);
  });

  it('rend les cartes, exécute Regrouper + Annuler 1-clic, Passer en auto, Désactiver auto et gère une erreur', async () => {
    mockEtat.donnees = {
      index: [], santeBrut: [], journalBrut: [], reglagesBrut: [], telemetrieBrut: [], coutsBrut: [], actionsBrut: [],
      copiloteBrut: [
        ['c-cas', '2026-07-06', 'carte', 'cascade', '02 · Finances', '02 · Finances/Banque', 'Regrouper Banque', '{"cibleId":"d1","ids":["f1"]}', 'proposé', '3'],
        ['c-auto', '2026-07-06', 'carte', 'dossier-vide', '05 · Carrière', '05 · Carrière/Vide', 'Vide', '{"dossierId":"d2"}', 'auto', '4'],
        ['c-dem', '2026-07-06', 'demarche', 'demarche-active', '04 · Immigration', '04 · Immigration/Permis', 'Démarche Permis', '{"nbDocs":2,"ids":["f1"],"tids":["t1"],"echeances":["2026-09-01"]}', 'actif', '0'],
      ],
      liensBrut: [
        ['2026-07-06', 't1', 'm1', 'portail@exemple.test', '04 · Immigration', '04 · Immigration/Permis', 'f1', 'Permis.pdf'],
      ],
    };
    render(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    expect(screen.getByText('Propositions et démarches')).toBeDefined();
    expect(screen.getByText('Permis.pdf')).toBeDefined();
    expect(screen.getByText(/2 doc\(s\) · 1 courriel\(s\) · 2026-09-01/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Désactiver auto' }));
    await vi.waitFor(() => expect(mockEtat.executer).toHaveBeenCalledWith('c-auto', 'desactiver-auto'));
    await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Regrouper' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Regrouper' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Annuler' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await vi.waitFor(() => expect(mockEtat.annuler).toHaveBeenCalledWith('act-c-cas'));
    await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Passer en auto' }) as HTMLButtonElement).disabled).toBe(false));

    mockEtat.executer.mockRejectedValueOnce(new Error('Refus serveur'));
    fireEvent.click(screen.getByRole('button', { name: 'Passer en auto' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
  });
});

describe('copilote.ts & Copilote.tsx — Signaux, factures & argent oublié (Lot 3B)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('interpreterSignaux, formaterMontantSignal, durcissement echeances et blocage auto sur tous les types Signaux', () => {
    expect(interpreterSignaux()).toEqual([]);
    const sigs = interpreterSignaux([
      ['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation'],
      ['f-1', 'Reçu clinique', 'Clinique Exemple', '05 · Santé', '05 · Santé/Reçus', '2026-11-01', '', '125,50', 'cad', '', '', 'a-reclamer'],
      ['f-2', 'Facture', 'Magasin Exemple', '08 · Perso & projets', '08 · Perso & projets', '2026-11-10', '', '-10', '', '2026-12-10', '2026-11-28', ''],
      ['', 'Ignoré', 'X', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]!.montant).toBe(125.5);
    expect(sigs[0]!.devise).toBe('CAD');
    expect(sigs[1]!.montant).toBeNull();
    expect(formaterMontantSignal(125.5, 'CAD', 'fr-CA')).toContain('125');
    expect(formaterMontantSignal(12, 'INVALID', 'fr-CA')).toContain('12');

    const cartes = interpreterCartesCopilote([
      ['c-dem', '2026-11-01', 'demarche', 'demarche-active', '04 · Immigration', '04 · Immigration/Permis', 'Démarche', '{"echeances":"2026-12-01"}', 'actif', '0'],
      ['c-exp', '2026-11-01', 'carte', 'expiration', '04 · Immigration', '04 · Immigration/Permis', 'Exp', '{"fileId":"f-1"}', 'proposé', '4'],
      ['c-pm', '2026-11-01', 'carte', 'piece-manquante', '02 · Finances', '02 · Finances', 'PM', '{"cle":"impots"}', 'proposé', '4'],
      ['c-fh', '2026-11-01', 'carte', 'facture-hausse', '02 · Finances', '02 · Finances', 'Hausse', '{"fileId":"f-h"}', 'proposé', '4'],
      ['c-fd', '2026-11-01', 'carte', 'facture-doublon', '02 · Finances', '02 · Finances', 'Doublon', '{"ids":["a","b"]}', 'proposé', '4'],
      ['c-ren', '2026-11-01', 'carte', 'renouvellement', '08 · Perso & projets', '08 · Perso & projets', 'Renouv', '{"fileId":"f-r"}', 'proposé', '4'],
      ['c-remb', '2026-11-01', 'carte', 'remboursement', '05 · Santé', '05 · Santé', 'Remb', '{"ids":["f-1"],"montantTotal":125.5,"devise":"CAD","nbRecus":1}', 'proposé', '4'],
      ['c-rg', '2026-11-01', 'carte', 'retour-garantie', '08 · Perso & projets', '08 · Perso & projets', 'Garantie', '{"fileId":"f-2"}', 'proposé', '4'],
    ]);
    expect(cartes).toHaveLength(8);
    expect(cartes[0]!.action.echeances).toBeUndefined();
    for (const c of cartes) expect(peutPasserEnAuto(c), c.type).toBe(false);
  });

  it('construireVueSignauxCopilote déduplique, gère les replis Signaux avec Date injectée et agrège par devise', () => {
    const maint = new Date('2026-11-24T12:00:00Z');
    const cartes = interpreterCartesCopilote([
      ['c-remb', '2026-11-24', 'carte', 'remboursement', '05 · Santé', '05 · Santé', 'Remb CAD', '{"ids":["f-1"],"montantTotal":125,"devise":"CAD","nbRecus":1}', 'proposé', '0'],
      ['c-fac', '2026-11-24', 'carte', 'facture-hausse', '02 · Finances', '02 · Finances', 'Hausse', '{"fileId":"f-fac"}', 'proposé', '0'],
    ]);
    const signaux = interpreterSignaux([
      ['f-1', 'Reçu clinique', 'Clinique Exemple', '05 · Santé', '05 · Santé', '2026-11-01', '', '125', 'CAD', '', '', 'a-reclamer'], // déjà couvert par c-remb
      ['f-2', 'Reçu pharmacie', 'Pharma Exemple', '05 · Santé', '05 · Santé', '2026-11-05', '', '45', 'CAD', '', '', 'a-reclamer'],
      ['f-3', 'Note pro', 'Train Exemple', '05 · Carrière', '05 · Carrière', '2026-11-06', '', '30', 'USD', '', '', 'a-reclamer'],
      ['f-exp', 'Permis', 'IRCC', '04 · Immigration', '04 · Immigration', '2025-01-01', '2026-12-20', '', 'CAD', '', '', ''],
      ['f-ret', 'Achat', 'Magasin Exemple', '08 · Perso', '08 · Perso', '2026-11-20', '', '90', 'CAD', '2026-12-10', '2026-11-28', ''],
      ['f-gar', 'Achat 2', 'Magasin Exemple', '08 · Perso', '08 · Perso', '2026-10-01', '', '200', 'CAD', '2026-12-15', '2026-11-01', ''],
      ['f-aucun', 'aucun', '', '02 · Finances', '02 · Finances', '', '2026-12-01', '', 'CAD', '', '', ''],
    ]);

    const vue = construireVueSignauxCopilote(cartes, signaux, {}, maint);
    expect(vue.factures).toHaveLength(1);
    expect(vue.argent).toHaveLength(1);
    expect(vue.signauxRepli.map((s) => s.fileId)).toEqual(['f-2', 'f-3', 'f-exp', 'f-ret', 'f-gar']);
    expect(vue.totauxAReclamer).toEqual([
      { devise: 'CAD', montant: 170, nbRecus: 2 },
      { devise: 'USD', montant: 30, nbRecus: 1 },
    ]);

    // Après clic « Marquer réclamé » sur c-remb : f-1 reste masqué (non réapparu via Signaux) et CAD retombe à 45
    const vueApres = construireVueSignauxCopilote(cartes, signaux, { 'c-remb': 'reclamé' }, maint);
    expect(vueApres.argent).toHaveLength(0);
    expect(vueApres.totauxAReclamer).toEqual([
      { devise: 'CAD', montant: 45, nbRecus: 1 },
      { devise: 'USD', montant: 30, nbRecus: 1 },
    ]);
  });

  it('rend les 3 sections Signaux en FR/EN, exécute Marquer réclamé en 1 clic et tolère signauxBrut absent', async () => {
    mockEtat.donnees = {
      index: [], santeBrut: [], journalBrut: [], reglagesBrut: [], telemetrieBrut: [], coutsBrut: [], actionsBrut: [],
      copiloteBrut: [
        ['c-dem-bad', '2026-11-20', 'demarche', 'demarche-active', '04 · Immigration', '04 · Immigration', 'Démarche', '{"echeances":"malformé"}', 'actif', '0'],
        ['c-exp-1', '2026-11-20', 'carte', 'expiration', '04 · Immigration', '04 · Immigration/Permis', 'Échéance permis (J-40)', '{"fileId":"f-exp"}', 'proposé', '0'],
        ['c-fac-1', '2026-11-20', 'carte', 'facture-hausse', '02 · Finances', '02 · Finances', 'Hausse Cablonet +30 %', '{"fileId":"f-fac"}', 'proposé', '0'],
        ['c-remb-1', '2026-11-20', 'carte', 'remboursement', '05 · Santé', '05 · Santé/Reçus', 'Remboursement Clinique Exemple', '{"ids":["f-1"],"montantTotal":125,"devise":"CAD","nbRecus":1}', 'proposé', '0'],
      ],
      signauxBrut: [
        ['f-1', 'Reçu clinique', 'Clinique Exemple', '05 · Santé', '05 · Santé/Reçus', '2026-11-01', '', '125', 'CAD', '', '', 'a-reclamer'],
        ['f-2', 'Reçu pharmacie', 'Pharmacie Exemple', '05 · Santé', '05 · Santé/Reçus', '2026-11-02', '', '45', 'CAD', '', '', 'a-reclamer'],
      ],
    };

    render(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    expect(screen.getByText('Expirations & pièces manquantes')).toBeDefined();
    expect(screen.getByText('Factures & abonnements')).toBeDefined();
    expect(screen.getByText('Argent à récupérer')).toBeDefined();
    expect(screen.getByText(/À réclamer : .*170/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Marquer réclamé' }));
    await vi.waitFor(() => expect(mockEtat.executer).toHaveBeenCalledWith('c-remb-1', 'reclame'));
    await vi.waitFor(() => expect(screen.queryByText('Remboursement Clinique Exemple')).toBeNull());
    expect(screen.getByText(/À réclamer : .*45/)).toBeDefined();

    cleanup();
    mockEtat.donnees = { index: [], santeBrut: [], journalBrut: [], reglagesBrut: [], telemetrieBrut: [], coutsBrut: [], actionsBrut: [] };
    render(createElement(Copilote, { langue: 'en', onAller: () => {} }));
    expect(screen.getByText('Expirations & missing documents')).toBeDefined();
    expect(screen.getByText('Bills & subscriptions')).toBeDefined();
    expect(screen.getByText('Money to recover')).toBeDefined();
  });
});
