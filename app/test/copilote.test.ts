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
  construireActionsSemaine,
  construireFiches360,
  construireVueSignauxCopilote,
  extraireMouvementsDrive,
  fileIdsPourChecklist,
  filtrerMouvementsDrive,
  formaterMontantSignal,
  interpreterCartesCopilote,
  interpreterChecklistsCopilote,
  interpreterEntites,
  interpreterLiens,
  interpreterReglesCopilote,
  interpreterSignaux,
  liensPourCarte,
  peutPasserEnAuto,
  syntheseSemaineCopilote,
  urlDriveSure,
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
  creerPack: vi.fn(async (opts: { pack: string; fileIds?: string[] }) => ({
    ok: true,
    dossierId: 'pack-1',
    dossierUrl: 'https://drive.google.com/drive/folders/pack-1',
    nbRaccourcis: opts.fileIds?.length || 2,
    message: 'Pack prêt.',
  })),
  majChecklist: vi.fn(async (opts: { checklistId?: string; coche?: boolean }) => ({
    ok: true,
    checklistId: opts.checklistId || 'chk-1',
    statut: opts.coche ? 'terminé' as const : 'actif' as const,
    message: 'Checklist à jour.',
  })),
  poserQuestion: vi.fn(async (q: string) => ({
    ok: true,
    reponse: `Réponse pour : ${q}`,
    llmUtilise: true,
    sources: [
      { nom: 'Bail.pdf', lien: 'https://drive.google.com/file/d/f-bail/view', fileId: 'f-bail' },
      { nom: 'Lien suspect', lien: 'javascript:alert(1)' },
    ],
  })),
  gererRegle: vi.fn(async (opts: { mode: string; regleId?: string }) => ({
    ok: true,
    regleId: opts.regleId || 'reg-new',
    auto: opts.mode === 'basculer-auto',
    message: 'Règle mise à jour.',
  })),
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
  creerPackCopilote: mockEtat.creerPack,
  majChecklistCopilote: mockEtat.majChecklist,
  poserQuestionCopilote: mockEtat.poserQuestion,
  gererRegleCopilote: mockEtat.gererRegle,
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
    expect(vue.signauxRepli.map((s) => s.id)).toEqual(['sig-recl-f-2', 'sig-recl-f-3', 'sig-exp-f-exp', 'sig-ret-f-ret', 'sig-gar-f-ret', 'sig-gar-f-gar']);
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

  it('durcit ids/tids non-tableau, préserve les signaux secondaires par fileId et couvre les champs optionnels', () => {
    const maint = new Date('2026-11-24T12:00:00Z');
    // 1. ids/tids non-tableau dans ActionJson (nombre, chaîne) : aucun crash ni itération caractère par caractère
    const cartesBrut = interpreterCartesCopilote([
      ['c-num-ids', '2026-11-24', 'carte', 'remboursement', '05 · Santé', '05 · Santé', 'Remb', '{"ids":123}', 'proposé', '0'],
      ['c-num-tids', '2026-11-24', 'demarche', 'demarche-active', '04 · Immigration', '04 · Immigration', 'Dém', '{"tids":123,"ids":"f123"}', 'actif', '0'],
      ['c-str-ids', '2026-11-24', 'carte', 'cascade', '02 · Finances', '02 · Finances', 'Cas', '{"ids":"f123","tids":"t123"}', 'proposé', '0'],
      [undefined as unknown as string],
      ['c-sparse', undefined as unknown as string, undefined as unknown as string, 'cascade', undefined as unknown as string, undefined as unknown as string, undefined as unknown as string, '', 'proposé', ''],
    ]);
    expect(cartesBrut[0]!.action.ids).toBeUndefined();
    expect(cartesBrut[1]!.action.tids).toBeUndefined();
    expect(cartesBrut[1]!.action.ids).toBeUndefined();
    expect(cartesBrut[2]!.action.ids).toBeUndefined();
    expect(cartesBrut[2]!.action.tids).toBeUndefined();

    // Même avec un objet CarteCopilote forgé sans passer par interpreterCartesCopilote : aucun TypeError
    const carteForgee = { ...cartesBrut[0]!, action: { ids: 123 as unknown as string[], tids: 123 as unknown as string[], fileId: 'f-ok' } };
    expect(() => construireVueSignauxCopilote([carteForgee], [], {}, maint)).not.toThrow();
    const liens = interpreterLiens([
      ['2026-11-24', 't1', 'm1', 'a@b.test', '05 · Santé', '05 · Santé', 'f-ok', 'Doc.pdf'],
      [undefined as unknown as string, undefined as unknown as string],
    ]);
    expect(liensPourCarte(carteForgee, liens)).toHaveLength(1);

    // 2. Signaux secondaires sur le même fileId (facture-hausse + a-reclamer, expiration + a-reclamer, retour + garantie)
    const cartesMulti = interpreterCartesCopilote([
      ['c-fh-dual', '2026-11-24', 'carte', 'facture-hausse', '02 · Finances', '02 · Finances', 'Hausse', '{"fileId":"f-dual"}', 'proposé', '0'],
      ['c-exp-dual', '2026-11-24', 'carte', 'expiration', '04 · Immigration', '04 · Immigration', 'Exp', '{"fileId":"f-exp-recl"}', 'proposé', '0'],
      ['c-ret-only', '2026-11-24', 'carte', 'retour-garantie', '08 · Perso', '08 · Perso', 'Ret', '{"fileId":"f-rg-part","sousType":"retour"}', 'proposé', '0'],
      ['c-gar-only', '2026-11-24', 'carte', 'retour-garantie', '08 · Perso', '08 · Perso', 'Gar', '{"fileId":"f-rg-gar","sousType":"garantie"}', 'proposé', '0'],
      ['c-rg-both', '2026-11-24', 'carte', 'retour-garantie', '08 · Perso', '08 · Perso', 'Both', '{"fileId":"f-rg-both"}', 'proposé', '0'],
      ['c-remb-min', '2026-11-24', 'carte', 'remboursement', '05 · Santé', '05 · Santé', 'Min', '{"ids":["f-min"]}', 'proposé', '0'],
      ['c-loc-auto', '2026-11-24', 'carte', 'cascade', '02 · Finances', '02 · Finances', 'Auto', '{}', 'proposé', '3'],
    ]);
    const sigsMulti = interpreterSignaux([
      [undefined as unknown as string],
      ['f-dual', 'Facture', 'Cablonet', '02 · Finances', '', '2026-11-01', '', '50', '', '', '', 'a-reclamer'],
      ['f-exp-recl', 'Permis', '', '04 · Immigration', '', '2025-12-01', '2026-12-10', '', 'CAD', '', '', 'a-reclamer'],
      ['f-recl-exp', '', '', '05 · Santé', '', '2026-11-01', '2026-12-15', '', 'CAD', '', '', 'a-reclamer'],
      ['f-rg-part', 'Achat', '', '08 · Perso', '', '2026-11-15', '', '', 'CAD', '2026-12-10', '2026-11-27', ''],
      ['f-rg-gar', 'Achat', '', '08 · Perso', '', '2026-11-15', '', '', 'CAD', '2026-12-10', '2026-11-27', ''],
      ['f-rg-both', 'Achat', '', '08 · Perso', '', '2026-11-15', '', '', 'CAD', '2026-12-10', '2026-11-27', ''],
      ['f-bad-date', 'Achat', '', '08 · Perso', '', '2026-11-15', '2026-02-30', '', 'CAD', '2026-02-30', '2026-02-30', ''],
    ]);
    const vue = construireVueSignauxCopilote(cartesMulti, sigsMulti, { 'c-loc-auto': 'auto' }, maint);
    expect(vue.propositions[0]!.statut).toBe('auto');
    expect(vue.signauxRepli.map((s) => s.id)).toEqual([
      'sig-recl-f-dual',
      'sig-recl-f-exp-recl',
      'sig-recl-f-recl-exp',
      'sig-exp-f-recl-exp',
      'sig-gar-f-rg-part',
      'sig-ret-f-rg-gar',
    ]);
    expect(vue.totauxAReclamer).toEqual([{ devise: 'CAD', montant: 50, nbRecus: 4 }]);

    // 3. Cas limites mouvements Drive (cellules vides, 3 homonymes, VeilleDrive sans titre)
    const mvtsLimites = extraireMouvementsDrive({
      journalBrut: [
        ['2026-11-24T11:00:00', undefined as unknown as string, 'VeilleDrive', 'Changement direct détecté :  → 02 · Finances'],
        ['2026-11-24T10:00:00', 'INFO', 'VeilleDrive', 'Document catalogué (lecture seule) :  → 04 · Immigration'],
        ['2026-11-24T09:00:00', 'INFO', 'Pipeline', 'classé → 02 · Finances : meme.pdf'],
      ],
      index: [
        { cle: 'drive|a', traiteLe: '', fichier: 'meme.pdf', domaine: '', chemin: '02 · Finances', statut: '', confiance: '' },
        { cle: 'drive|b', traiteLe: '', fichier: 'meme.pdf', domaine: '', chemin: '03 · Logement', statut: '', confiance: '' },
        { cle: 'drive|c', traiteLe: '', fichier: 'meme.pdf', domaine: '', chemin: '05 · Carrière', statut: '', confiance: '' },
        { cle: 'drive|d', traiteLe: '', fichier: '', domaine: '', chemin: '', statut: '', confiance: '' },
      ],
    });
    expect(mvtsLimites).toHaveLength(3);
  });
});

describe('copilote.ts & Copilote.tsx — Lot 4B-2 (Fiches 360°, Checklists, Packs, Questions IA, Règles & Semaine)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('urlDriveSure, interpreterEntites, interpreterChecklistsCopilote et interpreterReglesCopilote couvrent tous les cas limites', () => {
    expect(urlDriveSure('https://drive.google.com/file/d/f1/view')).toBe('https://drive.google.com/file/d/f1/view');
    expect(urlDriveSure('https://docs.google.com/document/d/d1')).toBe('https://docs.google.com/document/d/d1');
    expect(urlDriveSure('https://mail.google.com/mail/u/0/#inbox/t1')).toBe('https://mail.google.com/mail/u/0/#inbox/t1');
    expect(urlDriveSure('javascript:alert(1)')).toBeUndefined();
    expect(urlDriveSure('http://drive.google.com/file/d/1')).toBeUndefined();
    expect(urlDriveSure(null)).toBeUndefined();

    expect(interpreterEntites()).toEqual([]);
    const entites = interpreterEntites([
      ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'],
      ['Voiture Exemple', '03 · Logement & véhicule', 'Véhicule', 'Véhicule', 'validée', 'd-veh', '2026-06-20', '', '6'],
      ['Ancienne', '02 · Finances', '', 'Organisme', 'ignoré', '', '', '', '0'],
      ['', '02 · Finances'],
    ]);
    expect(entites).toHaveLength(2);
    expect(entites[0]!.vuNFois).toBe(6);

    expect(interpreterChecklistsCopilote()).toEqual([]);
    const chks = interpreterChecklistsCopilote([
      ['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations'],
      ['chk-1', '2026-07-06', 'checklist', 'checklist', '03', '03', 'Checklist Logement', '{"dem":"Logement","items":[{"k":"bail","l":"Bail","ok":1,"f":"f1"},null,{"k":"","l":"Vide"},{"k":"assur","l":"Assurance","ok":0}]}', 'actif', '0'],
      ['chg-1', '2026-07-06', 'checklist', 'changement-vie', '02', '02', 'Changement vie', '{"orgs":[{"k":"b1","n":"Bellerives","ok":0,"nb":3}]}', 'actif', '0'],
      ['chk-bad', '2026-07-06', 'checklist', 'checklist', '02', '02', 'Vide', '{malforme', 'terminé', '0'],
      ['chk-ign', '2026-07-06', 'checklist', 'checklist', '02', '02', 'Ign', '{}', 'ignoré', '0'],
    ], { 'chk-1|assur': true });
    expect(chks).toHaveLength(3);
    expect(chks[0]).toMatchObject({ faits: 2, total: 2, termine: true, packCle: 'logement' });
    expect(chks[1]).toMatchObject({ faits: 0, total: 1, termine: false, packCle: 'changement-vie' });
    expect(chks[2]!.termine).toBe(true);

    expect(interpreterReglesCopilote()).toEqual([]);
    const regs = interpreterReglesCopilote([
      ['Id', 'Horodatage', 'Catégorie', 'Type', 'Domaine', 'Chemin', 'Titre', 'ActionJson', 'Statut', 'Validations'],
      ['r-1', '2026-07-06', 'regle', 'regle-auto', '02 · Finances', '02 · Finances/Gaz', 'Gaz', '{"phrase":"Classer gaz","domaine":"02 · Finances","cible":"02 · Finances/Gaz","alors":{"canal":"drive","action":"deplacer"},"auto":false,"validations":3}', 'proposé', '2'],
      ['r-imm', '2026-07-06', 'regle', 'regle-auto', '04 · Immigration', '04 · Immigration/Permis', 'Imm', '{"auto":true}', 'auto', '5'],
      ['r-sup', '2026-07-06', 'regle', 'regle-auto', '02 · Finances', '02 · Finances', 'Suppr', '{}', 'proposé', '0'],
      ['r-ign', '2026-07-06', 'regle', 'regle-auto', '02 · Finances', '02 · Finances', 'Ign', '{}', 'ignoré', '0'],
    ], { 'r-1': { auto: true }, 'r-sup': { supprime: true } });
    expect(regs).toHaveLength(2);
    expect(regs[0]).toMatchObject({ auto: true, validations: 3, zoneProtegee: false });
    expect(regs[1]).toMatchObject({ auto: false, zoneProtegee: true });
  });

  it('construireFiches360 et construireActionsSemaine couvrent 04 · Immigration/Anna RO, plafond <= 25 fileIds et priorités P1-P3', () => {
    const index = interpreterIndex([
      ['drive|f-veh', '2026-07-06', '2026-07-06_Devis.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule/Voiture Exemple', 'classé', '', ''],
      ['drive|f-imm', '2026-07-05', '2026-07-05_Permis.pdf', '04 · Immigration', '04 · Immigration/Permis', 'manuel', '', ''],
      ['drive|f-anna', '2026-07-04', '2026-07-04_Note_Anna.pdf', '08 · Perso & projets', '08 · Perso & projets/Anna', 'manuel', '', ''],
      ['drive|f-emp', '2026-07-03', '2026-07-03_Contrat.pdf', '05 · Carrière', '05 · Carrière/Employeur Exemple', 'classé', '', ''],
      ['drive|f-voy', '2026-07-02', '2026-07-02_Billet.pdf', '08 · Perso & projets', '08 · Perso & projets/Voyages/Vacances Exemple', 'classé', '', ''],
      ['drive|f-sys', '2026-07-01', 'junk.pdf', '', '_Doublons', 'doublon', '', ''],
      ...Array.from({ length: 28 }, (_, i) => ['drive|f-bel-' + i, '2026-07-01', `2026-07_Releve_${i}.pdf`, '02 · Finances', '02 · Finances/Bellerives', 'classé', '', '']),
    ]);
    const entites = interpreterEntites([
      ['Bellerives', '02 · Finances', '', 'Compte financier', 'validée', 'd-bel', '', '', '10'],
      ['12 rue Exemple', '03 · Logement & véhicule', 'Logement', 'Logement', 'validée', 'd-log', '', '', '4'],
    ]);
    const signaux = interpreterSignaux([
      ['f-veh', 'Assurance auto', 'Assureur', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule/Voiture Exemple', '2026-07-01', '2026-09-01', '120', 'CAD', '2026-10-01', '2026-07-20', ''],
      ['f-aucun', 'aucun', '', '02 · Finances', '02 · Finances', '', '2026-09-01', '', 'CAD', '', '', ''],
    ]);
    const liens = interpreterLiens([
      ['2026-07-05', 't-imm', 'm-1', 'portail@exemple.ca', '04 · Immigration', '04 · Immigration/Permis', 'f-imm', '2026-07-05_Permis.pdf'],
    ]);
    const fiches = construireFiches360({ index, signaux, liens, entites });
    expect(fiches.find((f) => f.categorie === 'immigration')?.lectureSeule).toBe(true);
    expect(fiches.find((f) => f.categorie === 'anna')?.lectureSeule).toBe(true);
    expect(fiches.find((f) => f.titre === 'Bellerives')?.fileIdsPack.length).toBeLessThanOrEqual(25);
    expect(fiches.find((f) => f.titre === 'Voiture Exemple')).toMatchObject({ lectureSeule: false, totalMontant: 120 });

    const cartes = interpreterCartesCopilote([
      ['c-corb', '2026-07-06', 'carte', 'alerte-corbeille', '04 · Immigration', '04 · Immigration', 'Corbeille', '{}', 'proposé', '0'],
      ['c-dem', '2026-07-06', 'demarche', 'demarche-active', '03 · Logement', '03 · Logement', 'Démarche', '{}', 'actif', '0'],
      ['c-auto', '2026-07-06', 'carte', 'cascade', '02 · Finances', '02 · Finances/Bellerives', 'Cascade auto', '{}', 'proposé', '3'],
      ['c-cas', '2026-07-06', 'carte', 'cascade', '02 · Finances', '02 · Finances/Bellerives', 'Cascade', '{}', 'proposé', '1'],
      ['c-exp', '2026-07-06', 'carte', 'expiration', '04 · Immigration', '04 · Immigration', 'Expiration', '{}', 'proposé', '0'],
      ['c-fac', '2026-07-06', 'carte', 'facture-hausse', '02 · Finances', '02 · Finances', 'Hausse', '{}', 'proposé', '0'],
      ['c-arg', '2026-07-06', 'carte', 'remboursement', '05 · Santé', '05 · Santé', 'Remb', '{}', 'proposé', '0'],
    ]);
    const vueSignaux = construireVueSignauxCopilote(cartes, []);
    const checklists = interpreterChecklistsCopilote([['chk-1', '2026-07-06', 'checklist', 'checklist', '03', '03', 'Logement', '{"items":[{"k":"a","l":"A","ok":0}]}', 'actif', '0']]);
    const regles = interpreterReglesCopilote([['r-auto', '2026-07-06', 'regle', 'regle-auto', '02 · Finances', '02 · Finances', 'Règle auto prête', '{"validations":3}', 'proposé', '3']]);
    const actions = construireActionsSemaine({ vueSignaux, checklists, regles, fiches });
    expect(actions.length).toBeLessThanOrEqual(8);
    expect(actions[0]!.priorite).toBe(1);
    expect(actions.some((a) => a.type === 'auto')).toBe(true);
  });

  it('rend Questions IA, Checklists + Pack 1-clic, Fiches 360° (incl. Immigration/Anna RO) et Règles 1 phrase en FR/EN', async () => {
    mockEtat.donnees = {
      index: interpreterIndex([
        ['drive|f-veh', '2026-07-06', '2026-07-06_Devis_Garage.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule/Voiture Exemple', 'classé', '', ''],
        ['drive|f-imm', '2026-07-05', '2026-07-05_Permis.pdf', '04 · Immigration', '04 · Immigration/Permis', 'manuel', '', ''],
        ['drive|f-anna', '2026-07-04', '2026-07-04_Note_Anna.pdf', '08 · Perso & projets', '08 · Perso & projets/Anna', 'manuel', '', ''],
      ]),
      santeBrut: [], journalBrut: [], reglagesBrut: [], telemetrieBrut: [], coutsBrut: [], actionsBrut: [],
      entitesBrut: [
        ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'],
        ['Voiture Exemple', '03 · Logement & véhicule', 'Véhicule', 'Véhicule', 'validée', 'd-veh', '2026-06-20', '', '4'],
      ],
      copiloteBrut: [
        ['chk-1', '2026-07-06', 'checklist', 'checklist', '03', '03', 'Checklist Logement', '{"dem":"Logement","items":[{"k":"bail","l":"Bail signé","ok":1,"f":"f-bail"},{"k":"assur","l":"Assurance habitation","ok":0}]}', 'actif', '0'],
        ['reg-1', '2026-07-06', 'regle', 'regle-auto', '02 · Finances', '02 · Finances/Gaz', 'Classer gaz', '{"phrase":"Classer gaz dans Finances","domaine":"02 · Finances","cible":"02 · Finances/Gaz","auto":false,"validations":3}', 'proposé', '3'],
        ['reg-imm', '2026-07-06', 'regle', 'regle-auto', '04 · Immigration', '04 · Immigration/Permis', 'Imm', '{"phrase":"Règle Immigration","domaine":"04 · Immigration","cible":"04 · Immigration/Permis","auto":false,"validations":4}', 'proposé', '4'],
      ],
      signauxBrut: [
        ['f-veh', 'Assurance auto', 'Assureur', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule/Voiture Exemple', '2026-07-01', '2026-09-15', '150', 'CAD', '', '', ''],
      ],
      liensBrut: [
        ['2026-07-05', 't-imm', 'm-1', 'portail@exemple.ca', '04 · Immigration', '04 · Immigration/Permis', 'f-imm', '2026-07-05_Permis.pdf'],
      ],
    };

    const { rerender } = render(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    expect(screen.getByText('Priorités de la semaine')).toBeDefined();

    // #18 Question IA
    const champQ = screen.getByPlaceholderText('Poser une question sur vos documents…');
    fireEvent.change(champQ, { target: { value: 'Où est mon bail ?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Demander' }));
    await vi.waitFor(() => expect(screen.getByText('Réponse pour : Où est mon bail ?')).toBeDefined());
    expect(mockEtat.poserQuestion).toHaveBeenCalledWith('Où est mon bail ?');
    expect(screen.getByRole('link', { name: /Bail\.pdf/ })).toBeDefined();
    expect(screen.queryByRole('link', { name: /Lien suspect/ })).toBeNull();

    // #13 & #15 Checklist + Pack 1-clic
    const cb = screen.getByRole('checkbox', { name: /Assurance habitation/ });
    expect(cb.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(cb);
    await vi.waitFor(() => expect(cb.getAttribute('aria-checked')).toBe('true'));
    expect(mockEtat.majChecklist).toHaveBeenCalledWith({ checklistId: 'chk-1', demarche: 'Logement', item: 'assur', coche: true });

    await vi.waitFor(() => expect((screen.getAllByRole('button', { name: /Créer le pack 1-clic/ })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: /Créer le pack 1-clic/ })[0]!);
    await vi.waitFor(() => expect(screen.getByRole('link', { name: /Ouvrir le pack/ })).toBeDefined());
    expect(mockEtat.creerPack).toHaveBeenCalled();

    // #17 Fiches 360° : bascule vers 04 · Immigration (RO + Pack autorisé) et Anna (RO)
    fireEvent.click(screen.getByRole('tab', { name: /04 · Immigration/ }));
    expect(screen.getAllByText('Lecture seule').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('tab', { name: /Anna/ }));
    expect(screen.getByText('2026-07-04_Note_Anna.pdf')).toBeDefined();

    // #19 Règles : créer, basculer auto, supprimer ; reg-imm ne propose pas Mode auto
    const champR = screen.getByPlaceholderText('Ex. : classer les factures Gaz dans Finances');
    fireEvent.change(champR, { target: { value: 'Classer factures eau dans Finances' } });
    await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await vi.waitFor(() => expect(screen.getByText('Classer factures eau dans Finances')).toBeDefined());
    expect(mockEtat.gererRegle).toHaveBeenCalledWith({ mode: 'creer', phrase: 'Classer factures eau dans Finances' });

    await vi.waitFor(() => expect((screen.getAllByRole('button', { name: 'Mode auto' })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Mode auto' })[0]!);
    await vi.waitFor(() => expect(mockEtat.gererRegle).toHaveBeenCalledWith({ mode: 'basculer-auto', regleId: 'reg-new' }));
    await vi.waitFor(() => expect((screen.getAllByRole('button', { name: 'Supprimer' })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]!);
    await vi.waitFor(() => expect(screen.queryByText('Classer factures eau dans Finances')).toBeNull());

    // Vérification erreur WebApp sur question
    await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Demander' }) as HTMLButtonElement).disabled).toBe(false));
    mockEtat.poserQuestion.mockRejectedValueOnce(new Error('Quota atteint'));
    fireEvent.click(screen.getByRole('button', { name: 'Demander' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeDefined());

    rerender(createElement(Copilote, { langue: 'en', onAller: () => {} }));
    expect(screen.getByText('360° subject sheets')).toBeDefined();
    expect(screen.getByText('1-sentence rules')).toBeDefined();
  });

  it('corrige les 5 régressions R2 (isolation 04/Anna, zoneProtegee règles, Logement vs Véhicule, fileIds changement-vie, slice actions)', async () => {
    // 1 & 4. Isolation 04 · Immigration / Anna vs entités homonymes non protégées + Logement vs Véhicule
    const indexIso = interpreterIndex([
      ['drive|f-imm-visa', '2026-07-06', '2026-06-10_Visa_Travail.pdf', '04 · Immigration', '04 · Immigration/Visa', 'manuel', '', ''],
      ['drive|f-anna-auto', '2026-07-06', '2026-06-12_Assurance_Voiture_Anna.pdf', '08 · Perso & projets', '08 · Perso & projets/Anna', 'manuel', '', ''],
      ['drive|f-log-1', '2026-07-06', '2026-06-15_Bail.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Logement/12 rue Exemple', 'classé', '', ''],
      ['drive|f-veh-1', '2026-07-06', '2026-06-16_Entretien.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule/Voiture Exemple', 'classé', '', ''],
    ]);
    const entitesIso = interpreterEntites([
      ['Visa', '02 · Finances', '', 'Compte', 'validée', 'd-visa', '', '', '2'],
      ['Assurance', '02 · Finances', '', 'Organisme', 'validée', 'd-assur', '', '', '2'],
      ['12 rue Exemple', '03 · Logement & véhicule', 'Logement', 'Logement', 'validée', 'd-log', '', '', '5'],
    ]);
    const fichesIso = construireFiches360({ index: indexIso, signaux: [], liens: [], entites: entitesIso });
    expect(fichesIso.find((f) => f.titre === 'Visa')).toBeUndefined();
    expect(fichesIso.find((f) => f.titre === 'Assurance')).toBeUndefined();
    expect(fichesIso.find((f) => f.categorie === 'immigration')).toMatchObject({ lectureSeule: true, nbDocs: 1 });
    expect(fichesIso.find((f) => f.categorie === 'anna')).toMatchObject({ lectureSeule: true, nbDocs: 1 });
    expect(fichesIso.find((f) => f.titre === '12 rue Exemple')?.categorie).toBe('logement');
    expect(fichesIso.find((f) => f.titre === 'Voiture Exemple')?.categorie).toBe('vehicule');

    // Sans entité pré-déclarée : Logement/12 rue Exemple reste 'logement'
    const fichesSansEntite = construireFiches360({ index: indexIso.slice(2, 3), signaux: [], liens: [], entites: [] });
    expect(fichesSansEntite[0]?.categorie).toBe('logement');

    // 2. zoneProtegee avec "" dans ActionJson ou cible dans alors.* / phrase
    const regs = interpreterReglesCopilote([
      ['reg-empty', '2026-07-06', 'regle', 'regle-auto', '04 · Immigration', '04 · Immigration/Permis', 'Imm', '{"domaine":"","cible":"","auto":true}', 'auto', '4'],
      ['reg-alors', '2026-07-06', 'regle', 'regle-auto', '', '', 'Règle', '{"alors":{"domaine":"04 · Immigration","cible":"04 · Immigration/Permis"},"auto":true}', 'auto', '4'],
      ['reg-lib', '2026-07-06', 'regle', 'regle-auto', '', '', 'Règle', '{"alors":{"libelle":"Anna"},"auto":true}', 'proposé', '4'],
      ['reg-tech', '2026-07-06', 'regle', 'regle-auto', '', '', 'Ranger dans _Technique', '{"phrase":"Ranger dans _Technique","auto":true}', 'proposé', '4'],
    ]);
    expect(regs).toHaveLength(4);
    for (const r of regs) expect(r).toMatchObject({ zoneProtegee: true, auto: false });

    // 5. construireActionsSemaine filtre fileIdsPack.length > 0 avant .slice(0, 2)
    const actionsPacks = construireActionsSemaine({
      vueSignaux: construireVueSignauxCopilote([], []),
      checklists: [],
      regles: [],
      fiches: [
        { id: 'f0', titre: '04 · Immigration', categorie: 'immigration', domaine: '04 · Immigration', chemin: '04 · Immigration', lectureSeule: true, docs: [], nbDocs: 0, liensMail: [], echeances: [], totalMontant: 0, devise: 'CAD', fileIdsPack: [] },
        { id: 'f1', titre: 'Anna', categorie: 'anna', domaine: 'Anna', chemin: 'Anna', lectureSeule: true, docs: [], nbDocs: 0, liensMail: [], echeances: [], totalMontant: 0, devise: 'CAD', fileIdsPack: [] },
        { id: 'f2', titre: 'Bellerives', categorie: 'organisme', domaine: '02 · Finances', chemin: '02 · Finances/Bellerives', lectureSeule: false, docs: [], nbDocs: 1, liensMail: [], echeances: [], totalMontant: 0, devise: 'CAD', fileIdsPack: ['doc-1'] },
        { id: 'f3', titre: '12 rue Exemple', categorie: 'logement', domaine: '03 · Logement & véhicule', chemin: '03 · Logement & véhicule/Logement/12 rue Exemple', lectureSeule: false, docs: [], nbDocs: 1, liensMail: [], echeances: [], totalMontant: 0, devise: 'CAD', fileIdsPack: ['doc-2'] },
      ],
    });
    expect(actionsPacks.filter((a) => a.type === 'pack').map((a) => a.packCle)).toEqual(['Bellerives', '12 rue Exemple']);

    // 3. fileIdsPourChecklist pour changement-vie (incl. 04/Anna, exclut système/vide, plafond <= 25) + DOM bouton masqué si 0 match
    const chgAvecDocs = interpreterChecklistsCopilote([
      ['chg-ok', '2026-07-06', 'checklist', 'changement-vie', '', '', 'Plan changement de vie', '{"orgs":[{"k":"bel","n":"Bellerives","ok":0,"nb":2},{"k":"ircc","n":"IRCC","ok":0,"nb":1},{"k":"anna","n":"Anna","ok":0,"nb":1}]}', 'actif', '0'],
      ['chg-vide', '2026-07-06', 'checklist', 'changement-vie', '', '', 'Plan vide', '{"orgs":[{"k":"inconnu","n":"Introuvable","ok":0,"nb":1}]}', 'actif', '0'],
    ]);
    const idxPacks = interpreterIndex([
      ['drive|f-sys', '2026-07-06', '2026-07_Bellerives.pdf', '', '_Technique', 'technique', '', ''],
      ['drive|f-a-trier', '2026-07-06', '2026-07_Bellerives.pdf', '00 · À trier', '00 · À trier', 'à trier', '', ''],
      ['drive|f-sans-chm', '2026-07-06', '2026-07_Bellerives.pdf', '02 · Finances', '', 'classé', '', ''],
      ['drive|f-imm-ircc', '2026-07-06', '2026-07_Permis_IRCC.pdf', '04 · Immigration', '04 · Immigration/Permis', 'manuel', '', ''],
      ['drive|f-anna', '2026-07-06', '2026-07_Dossier_Anna.pdf', '08 · Perso & projets', '08 · Perso & projets/Anna', 'manuel', '', ''],
      ...Array.from({ length: 28 }, (_, i) => ['drive|f-bel-' + i, '2026-07-06', `2026-07_Releve_${i}.pdf`, '02 · Finances', '02 · Finances/Bellerives', 'classé', '', '']),
    ]);
    const resolved = fileIdsPourChecklist(chgAvecDocs[0]!, idxPacks);
    expect(resolved).toHaveLength(25);
    expect(resolved).toContain('f-imm-ircc');
    expect(resolved).toContain('f-anna');
    expect(resolved).not.toContain('f-sys');
    expect(resolved).not.toContain('f-a-trier');
    expect(resolved).not.toContain('f-sans-chm');
    expect(fileIdsPourChecklist(chgAvecDocs[1]!, idxPacks)).toEqual([]);

    mockEtat.donnees = {
      index: idxPacks.slice(3, 5),
      santeBrut: [], journalBrut: [], reglagesBrut: [], telemetrieBrut: [], coutsBrut: [], actionsBrut: [],
      copiloteBrut: [
        ['chg-ok', '2026-07-06', 'checklist', 'changement-vie', '', '', 'Plan actif', '{"orgs":[{"k":"ircc","n":"IRCC","ok":0,"nb":1}]}', 'actif', '0'],
        ['chg-vide', '2026-07-06', 'checklist', 'changement-vie', '', '', 'Plan sans fichier', '{"orgs":[{"k":"x","n":"Inexistant","ok":0,"nb":1}]}', 'actif', '0'],
      ],
    };
    render(createElement(Copilote, { langue: 'fr', onAller: () => {} }));
    const btnsPack = screen.getAllByRole('button', { name: /Créer le pack 1-clic/ });
    // Seul chg-ok (et non chg-vide) expose le bouton Pack (+ 1 fiche active dans Fiche360 = 2 au total, jamais 3)
    expect(btnsPack).toHaveLength(2);
    fireEvent.click(btnsPack[0]!);
    await vi.waitFor(() => expect(mockEtat.creerPack).toHaveBeenCalledWith({ pack: 'changement-vie', fileIds: ['f-imm-ircc'], titre: 'Plan actif' }));
  });
});
