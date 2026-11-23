/**
 * mockData.ts — fausses données LOCALES pour le mode E2E (`VITE_E2E_MOCK=true`, captures CI).
 *
 * JAMAIS actif en production : consommé uniquement par les gardes `MODE_MOCK` de google.ts
 * (variable Vite figée au build — absente du build Vercel, la branche est du code mort éliminable).
 * Aucun secret, aucune vraie donnée de Marc : un jeu réaliste et STABLE (dates fixes, jamais
 * `Date.now()` sur les données) pour que les captures d'écran soient comparables d'un run à l'autre.
 * Les formes miroir les onglets réels de la Sheet (voir src/Journal.gs `initialiserSheet_`) et
 * les structures attendues par etat.ts / explorateur.ts (Tasks et Calendar retirés le 05/11/2026, ADR-0074).
 */

/* ---------- Onglets Sheet (lignes brutes, comme `values` de l'API Sheets) ---------- */

const INDEX: string[][] = [
  // Clé | Traité le | Fichier | Domaine | Chemin | Statut | Empreinte | Confiance
  ['messageId-001|0|facture.pdf|18220', '2026-07-06T14:02:11', '2026-07-01_Facture_Hydro-Québec.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'e3b0c442', '0.95'],
  ['drive|f-002', '2026-07-06T14:07:42', '2026-06-28_Relevé_Bellerives.pdf', '02 · Finances', '02 · Finances/Bellerives/Relevés/2026', 'classé', 'a1b2c3d4', '0.91'],
  ['messageId-003|0|bail.pdf|90210', '2026-07-05T09:15:00', '2026-06-15_Bail_Immeubles Tremblay.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Logement/12 rue Exemple/Bail & contrat', 'classé', 'b4d455aa', '0.88'],
  ['drive|f-014', '2026-07-05T10:30:05', '2026-05-20_Passeport_Alex Exemple.pdf', '01 · Administratif & identité', '01 · Administratif & identité/Passeport', 'classé', 'c0ffee00', '0.97'],
  ['messageId-005|0|photo.jpg|55000', '2026-07-04T18:22:37', '2026-07-04_Photo_Copie.jpg', '', '_Doublons', 'doublon', 'e3b0c442', ''],
  ['drive|f-006', '2026-07-04T19:01:12', 'export-facebook.html', '', '_Technique', 'technique', 'deadbeef', ''],
  ['tache|msg-007|4f2a', '2026-07-03T08:45:00', 'RDV garage — pneus été', '', '', 'tache', '', ''],
  ['tri|fil-100|1751500000|1', '2026-07-02T21:14:09', 'Votre facture Cablonet de juillet', '', '', 'trié', '', ''],
  ['tri|fil-101|1751502000|0', '2026-07-02T21:16:44', 'URGENT : vérifiez vos identifiants', '', '', 'suspect', '', ''],
  ['tri|fil-101|1751590000|1', '2026-07-03T22:05:31', 'URGENT : vérifiez vos identifiants', '', '', 'trié', '', ''],
  // Suspect ENCORE en boîte (C28-19) : montre le « ✓ Pas suspect » 1-clic sur les captures CI.
  ['tri|fil103|1751610000|0', '2026-07-04T08:12:00', 'Code to log on to Bellerives Insurance', '', '', 'suspect', '', ''],
  ['important|msg-102', '2026-07-06T07:12:00', 'Renouvellement de votre assurance habitation', '', '', 'important', '', ''],
  ['drive|f-008', '2026-07-06T20:33:47', '2026-07-06_Devis_Garage Exemple.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule/Voiture Exemple/Entretien & réparations', 'classé', 'feedface', '0.84'],
  ['drive|f-009', '2026-07-06T11:15:00', '2026-07_Reçu_Clinique.pdf', '05 · Santé', '05 · Santé/Reçus', 'classé', '11223344', '0.42'],
  ['drive|f-010', '2026-07-06T11:20:00', 'Scan_illisible_01.pdf', '', '00 · À vérifier', 'à vérifier', '55667788', ''],
  ['drive|f-011', '2026-07-06T11:25:00', 'scan-sans-nom.pdf', '', '00 · À trier', 'à trier', '', ''],
  ['drive|f-012', '2026-07-05T16:10:00', 'Fichier_corrompu.pdf', '', '', 'quarantaine', '', ''],
  ['drive|f-013', '2026-07-05T17:00:00', 'Note_manuelle.pdf', '08 · Perso & projets', '08 · Perso & projets/Notes', 'manuel', '', ''],
  ['tri|fil-104|1751620000|1', '2026-07-06T09:30:00', 'Confirmation rendez-vous', '', '', 'tri-a-verifier', '', ''],
  ['tri-abandon|fil-105|1751630000', '2026-07-06T10:05:00', 'Fil en erreur temporaire', '', '', 'tri-erreur', '', ''],
];

const SANTE: string[][] = [
  ['Dernier passage OK : 2026-07-06 14:12'],
  ['Documents au catalogue (Index) : 1842'],
  ['Coût LLM 2026-07 : 16.42 $  (5210 appels)  ·  cible < 10 $/mois  ⚠️ DÉPASSÉE'],
  ['Rangement ancien Drive : terminé ✅'],
  ['Tri Gmail : ✅ normal (libellés + archivage)'],
  ['Compte LLM : actif'],
  ['Doublons (validation par empreinte) : terminée ✅ (2026-07-05)'],
  ['Historique Gmail : en cours — 45 des 150 fils/j consommés aujourd’hui'],
  ['Re-datation de 06 : terminée ✅ (2026-07-05)'],
  ['Résolution des identifiants (C49-16) : ✅ terminée — 124 retrouvés · 0 sans preuve'],
  ['Mis à jour : 2026-07-06 14:12'],
];

const JOURNAL: string[][] = [
  // Horodatage | Niveau | Source | Message
  ['2026-07-06T14:02:11', 'INFO', 'Pipeline', 'classé : 2026-07-01_Facture_Hydro-Québec.pdf → 02 · Finances/2026'],
  ['2026-07-06T14:07:42', 'INFO', 'Pipeline', 'classé : 2026-06-28_Relevé_Bellerives.pdf → 02 · Finances/Bellerives/Relevés/2026'],
  ['2026-07-06T14:10:03', 'INFO', 'TriGmail', '3 fil(s) trié(s), 1 archivé(s)'],
  ['2026-07-06T13:55:20', 'INFO', 'Résumé', 'Résumé hebdo envoyé.'],
];

const ENTETES_ENTITES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
const ENTITES: string[][] = [
  ENTETES_ENTITES,
  ['Bellerives', '02 · Finances', '', 'Compte financier', 'validée', 'dossier-bellerives', '2026-06-20', '', '14'],
  ['12 rue Exemple', '03 · Logement & véhicule', 'Logement', 'Logement', 'validée', 'dossier-appart', '2026-06-21', '', '9'],
  ['Voiture Exemple', '03 · Logement & véhicule', 'Véhicule', 'Véhicule', 'validée', 'dossier-voiture-exemple', '2026-06-22', '', '6'],
  ['Hydro-Québec', '02 · Finances', '', 'Compte financier', 'en_attente', '', '2026-07-05', '', '4'],
  ['Cablonet', '02 · Finances', '', 'Compte financier', 'en_attente', '', '2026-07-06', 'Variante possible de : Cablonet', '2'],
];

const ENTETES_CORRECTIONS = ['Fichier', 'Émetteur', 'Domaine', 'Catégorie', 'Entité', 'Type', 'Corrigé le'];
const CORRECTIONS: string[][] = [
  ENTETES_CORRECTIONS,
  ['2026-06-10_Facture_Inconnu.pdf', 'Hydro-Québec', '02 · Finances', '', 'Hydro-Québec', 'Facture', '2026-06-30'],
];

const TRI_APPRIS: string[][] = [
  // Adresse | Libellé | Appris le
  ['facturation@cablonet.com', 'Factures', '2026-07-01'],
  ['info@infolettre-exemple.com', 'Infolettres', '2026-07-02'],
];

const REORG: string[][] = [
  // Clé | Type | ID | Chemin actuel | Chemin proposé | Statut | Détail | Horodaté
  ['r1', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
  ['reorg|r1|2', 'action', 'dossier-x', '08 · Perso & projets/Vieux trucs', '08 · Perso & projets/Archives', 'proposé', 'fusion', '2026-07-05T12:01:00'],
];

const REGLAGES: string[][] = [
  ['TICK_MINUTES', '5'],
];

const TELEMETRIE: string[][] = [
  // Clé | Valeur | Unité | Détail (miroir de COLONNES_TELEMETRIE / lignesTelemetrie_, Journal.gs)
  ['quota_gmail_etat', 'suspendu', '', 'Reprise vers 16:45'],
  ['gmail_histo_fils_jour', '150', 'fils', 'Plafond 150/j'],
  ['tri_cyclique_fils_jour', '84', 'fils', 'Plafond commun 300/j'],
  ['tri_boite_fils_jour', '45', 'fils', 'Plafond commun 300/j'],
  ['tri_histo_fils_jour', '30', 'fils', 'Plafond commun 300/j'],
  ['tri_anciens_fils_jour', '12', 'fils/jour', 'Plafond commun 300/j'],
  ['tri_fond_fils_jour', '171', 'fils/jour', 'Plafond commun 300/j'],
  ['tri_archives_jour', '18', 'fils/jour', 'Fils archivés par le moteur aujourd’hui'],
  ['llm_cout_mois', '16.42', '$', 'Frein campagnes à 110 $'],
  ['llm_appels_mois', '5210', 'appels', ''],
];

const COUTS: string[][] = [
  // Poste | Appels | Coût $ | Part (miroir de COLONNES_COUTS / lignesCouts_, Journal.gs)
  ['TOTAL LLM 2026-07', '2671', '26.12', '100 %'],
  ['rattrapage-piece', '2080', '22.7741', '81.2 %'],
  ['reanalyse', '216', '2.3341', '8.3 %'],
  ['intake-gmail', '36', '0.4064', '1.4 %'],
  ['intake-depots', '12', '0.2356', '0.8 %'],
  ['tri-gmail', '174', '0.2130', '0.8 %'],
  ['intentions', '153', '0.1518', '0.5 %'],
];

const PROGRESSION: string[][] = [
  // Clé | Opération | Traités | Base | Unité | Statut | Horodaté | Détail | Dernière activité | Dernière erreur | Type | Dernière passe | Fin estimée
  ['migration', 'Migration taxonomie (m1)', '812', '1209', 'documents', 'en cours', '2026-07-06T14:10:00', '', '06/07 14:10', '', 'campagne', '+23 documents · il y a 4 min', 'reste 397 documents · ~2 j'],
  ['reanalyse', 'Re-analyse v2 (c26-08)', '0', '', 'documents', 'en attente (après m1)', '2026-07-06T14:10:00', '', '', '', 'campagne', '', ''],
  ['histo-gmail', 'Historique Gmail (PJ)', '4520', '', 'fils', 'suspendu (quota Gmail)', '2026-07-06T14:10:00', 'quota Gmail du jour épuisé', '06/07 13:45', '06/07 13:45 — Service invoked too many times', 'campagne', '', ''],
];

/** Une plage Sheet bouchonnée, par onglet (la PLAGE exacte importe peu : les vues filtrent). */
export function plageMock(onglet: string, plage: string): string[][] {
  // Les lectures d'EN-TÊTES seuls (A1:H1, A1:Z1) servent aux appends de l'app : renvoyer la 1ʳᵉ ligne.
  const enTeteSeul = /^A1:[A-Z]+1$/.test(plage);
  switch (onglet) {
    case 'Index': return enTeteSeul ? [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance']] : INDEX;
    case 'Santé': return SANTE;
    case 'Journal': return JOURNAL;
    case 'Entités': return ENTITES;
    case 'Corrections': return enTeteSeul ? [ENTETES_CORRECTIONS] : CORRECTIONS;
    case 'TriAppris': return TRI_APPRIS;
    case 'Réorg': return REORG;
    case 'Réglages': return REGLAGES;
    case 'Progression': return PROGRESSION;
    case 'Télémétrie': return TELEMETRIE;
    case 'Coûts': return COUTS;
    default: return [];
  }
}

/* ---------- Drive (explorateur) ---------- */

// Formes minimales d'ElementDrive (explorateur.ts) : id, name, mimeType, parents, size?, modifiedTime.
export const ENFANTS_MOCK: Record<string, unknown[]> = {
  root: [
    { id: 'dossier-a-trier', name: '00 · À trier', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], modifiedTime: '2026-07-06T10:00:00Z' },
    { id: 'dossier-finances', name: '02 · Finances', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], modifiedTime: '2026-07-05T10:00:00Z' },
    { id: 'dossier-logement', name: '03 · Logement & véhicule', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], modifiedTime: '2026-07-04T10:00:00Z' },
  ],
  'dossier-a-trier': [
    { id: 'f-100', name: 'scan-sans-nom.pdf', mimeType: 'application/pdf', parents: ['dossier-a-trier'], size: '90210', modifiedTime: '2026-07-06T09:00:00Z' },
    { id: 'f-009', name: '2026-07_Reçu_Clinique.pdf', mimeType: 'application/pdf', parents: ['dossier-a-trier'], size: '48120', modifiedTime: '2026-07-06T11:15:00Z' },
    { id: 'f-010', name: 'Scan_illisible_01.pdf', mimeType: 'application/pdf', parents: ['dossier-a-trier'], size: '112400', modifiedTime: '2026-07-06T11:20:00Z' },
    { id: 'f-006', name: 'export-facebook.html', mimeType: 'text/html', parents: ['dossier-a-trier'], size: '15400', modifiedTime: '2026-07-04T19:01:12Z' },
  ],
  'dossier-finances': [
    { id: 'dossier-finances-2026', name: '2026', mimeType: 'application/vnd.google-apps.folder', parents: ['dossier-finances'], modifiedTime: '2026-07-06T12:00:00Z' },
    { id: 'dossier-finances-bellerives', name: 'Bellerives', mimeType: 'application/vnd.google-apps.folder', parents: ['dossier-finances'], modifiedTime: '2026-07-05T14:00:00Z' },
    { id: 'dossier-finances-archives', name: 'Archives', mimeType: 'application/vnd.google-apps.folder', parents: ['dossier-finances'], modifiedTime: '2026-07-01T10:00:00Z' },
    { id: 'f-002', name: '2026-06-28_Relevé_Bellerives.pdf', mimeType: 'application/pdf', parents: ['dossier-finances'], size: '182200', modifiedTime: '2026-07-06T14:07:42Z' },
  ],
  'dossier-finances-2026': [
    { id: 'f-001', name: '2026-07-01_Facture_Hydro-Québec.pdf', mimeType: 'application/pdf', parents: ['dossier-finances-2026'], size: '18220', modifiedTime: '2026-07-06T14:02:11Z' },
  ],
  'dossier-finances-bellerives': [
    { id: 'dossier-finances-bellerives-releves', name: 'Relevés', mimeType: 'application/vnd.google-apps.folder', parents: ['dossier-finances-bellerives'], modifiedTime: '2026-07-05T15:00:00Z' },
  ],
  'dossier-finances-bellerives-releves': [
    { id: 'f-003', name: '2026-05-31_Relevé_Bellerives.pdf', mimeType: 'application/pdf', parents: ['dossier-finances-bellerives-releves'], size: '145000', modifiedTime: '2026-06-01T09:00:00Z' },
  ],
  'dossier-finances-archives': [],
  'dossier-logement': [
    { id: 'dossier-logement-bail', name: '12 rue Exemple', mimeType: 'application/vnd.google-apps.folder', parents: ['dossier-logement'], modifiedTime: '2026-07-04T11:00:00Z' },
    { id: 'dossier-logement-vehicule', name: 'Véhicule', mimeType: 'application/vnd.google-apps.folder', parents: ['dossier-logement'], modifiedTime: '2026-07-04T11:30:00Z' },
  ],
  'dossier-logement-bail': [
    { id: 'f-004', name: '2026-06-15_Bail_Immeubles Tremblay.pdf', mimeType: 'application/pdf', parents: ['dossier-logement-bail'], size: '90210', modifiedTime: '2026-07-05T09:15:00Z' },
  ],
  'dossier-logement-vehicule': [
    { id: 'f-008', name: '2026-07-06_Devis_Garage Exemple.pdf', mimeType: 'application/pdf', parents: ['dossier-logement-vehicule'], size: '64200', modifiedTime: '2026-07-06T20:33:47Z' },
  ],
};
