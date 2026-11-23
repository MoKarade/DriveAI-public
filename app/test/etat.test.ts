/**
 * Parsers de l'état (etat.ts) : interprétation des lignes Sheet PAR EN-TÊTES réels
 * (jamais d'index en dur — miroir de colonnesEntites_), file « en attente », colonne A1.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  interpreterIndex,
  domainesDepuisIndex,
  filtrerIndex,
  statutsDepuisIndex,
  anneesDepuisIndex,
  fileIdDepuisCle,
  indexParFileId,
  lienDrivePourLigne,
  lignesImportants,
  lienGmailPourLigne,
  ageMoteurMinutes,
  fraicheurMoteur,
  statutLisible,
  formaterAgeMinutes,
  nettoyerDetailSante,
  cleErreurJournal,
  grouperErreursJournal,
  CLE_NON_DOCUMENT_SYNTHESE,
  lireErreursVues,
  enregistrerErreursVues,
  interpreterActions,
} from '../src/etat';

describe('cleEtatIndex : dédup des familles reset/campagne (revue de fond 2026-07-31)', () => {
  it('regroupe drive| et toutes les lignes tri33*/reanalyse/nonroute d\'un même fichier sur la même identité', () => {
    const id = 'FILE123';
    expect(cleEtatIndex('drive|' + id)).toBe('fichier|' + id);
    expect(cleEtatIndex('tri33|t3|' + id)).toBe('fichier|' + id);
    expect(cleEtatIndex('tri33p|t3|v2|' + id)).toBe('fichier|' + id);
    expect(cleEtatIndex('tri33llm|t3|v2|' + id)).toBe('fichier|' + id);
    expect(cleEtatIndex('tri33-04|t3|' + id)).toBe('fichier|' + id);
    expect(cleEtatIndex('reanalyse|m2|' + id)).toBe('fichier|' + id);
    expect(cleEtatIndex('nonroute|v2|' + id)).toBe('fichier|' + id);
    // Non touchés : le tri Gmail reste par FIL, les marqueurs gardent leur propre identité.
    expect(cleEtatIndex('tri|FIL9|123|lu')).toBe('fil|FIL9');
    expect(cleEtatIndex('intention|MSG1')).toBe('intention|MSG1');
    expect(cleEtatIndex('tri-abandon|FIL9|123')).toBe('tri-abandon|FIL9|123');
  });

  it('statutLisible : un doc RANGÉ par le reset compte comme « classé » (sinon disparaît de « derniers classements »)', () => {
    expect(statutLisible('tri33-route')).toBe('classé');
    expect(statutLisible('tri33-04-route')).toBe('classé');
    expect(statutLisible('tri33-doublon')).toBe('doublon');
    expect(statutLisible('tri33-reste')).toBe('à trier');
    // Statuts produit inchangés ; gardes rares gardent leur libellé technique.
    expect(statutLisible('classé')).toBe('classé');
    expect(statutLisible('tri33-protege')).toBe('tri33-protege');
  });

  it('interpreterIndex : un doc routé par le reset (tri33-route) est lu comme « classé »', () => {
    const [l] = interpreterIndex([['tri33p|t3|v2|F1', '2026-01-03', 'a.pdf', '02 · Finances', 'Relevés', 'tri33-route']]);
    expect(l.statut).toBe('classé');
  });

  it('etatCourantIndex : un fichier avec plusieurs états successifs n\'apparaît qu\'UNE fois (la plus récente) — plus de « +N » gonflé', () => {
    const lignes = interpreterIndex([
      ['drive|F1', '2026-01-01', 'a.pdf', '00 · À trier', '', 'à trier'],
      ['tri33|t3|F1', '2026-01-02', 'a.pdf', '02 · Finances', '_TRI', 'tri33-rassemble'],
      ['tri33p|t3|v2|F1', '2026-01-03', 'a.pdf', '02 · Finances', 'Relevés', 'tri33-route'],
    ]);
    const courant = etatCourantIndex(lignes);
    const pourF1 = courant.filter((l) => (l.cle || '').includes('F1'));
    expect(pourF1.length).toBe(1); // une seule entrée pour le fichier (sinon compté 3× dans « +N aujourd'hui »)
    expect(pourF1[0].cle).toBe('tri33p|t3|v2|F1'); // l'état le plus récent
  });
});

describe('interpreterIndex + domainesDepuisIndex', () => {
  it('lit les lignes non vides et liste les domaines observés', () => {
    const lignes = interpreterIndex([
      ['k1', '2026-01-01', 'a.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k2', '2026-01-02', 'b.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k3', '2026-01-03', 'c.pdf', '03 · Logement & véhicule', 'chemin', 'classé'],
      ['', '', '', '', '', ''], // ligne vide ignorée
    ]);
    expect(lignes).toHaveLength(3);
    expect(domainesDepuisIndex(lignes)).toEqual(['02 · Finances', '03 · Logement & véhicule']);
  });
});

describe('recherche structurée (C9-07) — filtres purs sur l’Index', () => {
  const LIGNES = interpreterIndex([
    ['drive|F1', '2026-06-01', '2024-03-05_Facture_Hydro-Québec.pdf', '03 · Logement & véhicule', '03/Logement — X/Factures/2024', 'classé'],
    ['msg|1|a|9', '2026-06-02', '2024-03_Relevé_Bellerives.pdf', '02 · Finances', '02/Bellerives/Relevés/2024', 'classé'],
    ['migre|m1|F3', '2026-07-01', '2021_Diplôme_Institut-Exemple.pdf', '06 · Études & diplômes', '06/Institut', 'classé'],
    ['drive|F4', '2026-07-02', '2024-04-01_Facture_Hydro-Québec.pdf', '03 · Logement & véhicule', '03/…', 'doublon'],
  ]);

  it('filtre par texte (nom OU chemin, insensible casse/accents)', () => {
    expect(filtrerIndex(LIGNES, { texte: 'hydro-quebec' })).toHaveLength(2);
    expect(filtrerIndex(LIGNES, { texte: 'RELEVES' }).map((l) => l.fichier)).toEqual(['2024-03_Relevé_Bellerives.pdf']); // via le chemin
  });

  it('filtre par domaine + statut + année (ET combiné)', () => {
    expect(filtrerIndex(LIGNES, { domaine: '03 · Logement & véhicule', statut: 'classé' })).toHaveLength(1);
    expect(filtrerIndex(LIGNES, { annee: '2024' })).toHaveLength(3);
    expect(filtrerIndex(LIGNES, { annee: '2021' })).toHaveLength(1);
  });

  it('sans critère → tout', () => {
    expect(filtrerIndex(LIGNES, {})).toHaveLength(4);
  });

  it('sélecteurs : domaines/statuts/années observés', () => {
    expect(statutsDepuisIndex(LIGNES)).toEqual(['classé', 'doublon']);
    expect(anneesDepuisIndex(LIGNES)).toEqual(['2024', '2021']); // récentes d'abord
  });
});

describe('fileIdDepuisCle + indexParFileId + lienDrivePourLigne', () => {
  it.each([
    ['drive|ABC123', 'ABC123'],
    ['drive|f-002', 'f-002'],
    ['migre|m1|XYZ', 'XYZ'],
    ['tri33|t3|F1', 'F1'],
    ['tri33p|t3|v2|F1', 'F1'],
    ['tri33llm|t3|v2|F1', 'F1'],
    ['tri33-04|t3|F1', 'F1'],
    ['reanalyse|m2|F1', 'F1'],
    ['nonroute|v2|F1', 'F1'],
    ['shared|ORIG', ''],       // l'ID est celui de l'ORIGINAL partagé, pas de la copie classée
    ['msgid|0|a.pdf|99', ''],  // clé Gmail : pas de fileId
    ['tri|F1|100|lu', ''],
    ['dryrunv2|r1|d1', ''],
    ['', ''],
    ['drive|', ''],
    ['drive|a|b', ''],
    ['migre||XYZ', ''],
    ['migre|m1|', ''],
    ['tri33|t3|', ''],
    ['tri33||F1', ''],
    ['tri33', ''],
  ])('%s → %s', (cle, attendu) => {
    expect(fileIdDepuisCle(cle)).toBe(attendu);
  });

  it('indexParFileId : indexe toutes les familles fichier et conserve la dernière ligne chronologique', () => {
    const lignes = interpreterIndex([
      ['drive|F1', '2026-07-01', 'a.pdf', '00', '00', 'à trier', '', ''],
      ['tri33p|t3|v2|F1', '2026-07-02', 'a.pdf', '02', '02/2026', 'tri33-route', '', '0.45'],
      ['reanalyse|m2|F2', '2026-07-03', 'b.pdf', '05', '05/Reçus', 'à vérifier', '', ''],
      ['nonroute|v2|F3', '2026-07-03', 'c.pdf', '', '00', 'à vérifier', '', ''],
      ['shared|ORIG', '2026-07-03', 'partage.pdf', '', '', 'classé', '', ''],
      ['dryrunv2|r1|F1', '2026-07-04', 'a.pdf', '', '', 'dry-run', '', ''],
      ['tri|FIL1|100|lu', '2026-07-04', 'mail', '', '', 'trié', '', ''],
    ]);
    const parId = indexParFileId(lignes);
    expect([...parId.keys()]).toEqual(['F1', 'F2', 'F3']);
    expect(parId.get('F1')?.statut).toBe('classé');
    expect(parId.get('F1')?.confiance).toBe('0.45');
    expect(parId.get('F2')?.statut).toBe('à vérifier');
    expect(parId.get('F3')?.statut).toBe('à vérifier');
    expect(parId.has('ORIG')).toBe(false);
  });

  it('lien direct quand la clé porte l’ID, recherche Drive sinon', () => {
    const [directe, indirecte] = interpreterIndex([
      ['drive|F1', '', 'a.pdf', '', '', 'classé'],
      ['msg|1|b|9', '', '2024-03_Relevé_Bellerives.pdf', '', '', 'classé'],
    ]);
    expect(lienDrivePourLigne(directe)).toBe('https://drive.google.com/file/d/F1/view');
    expect(lienDrivePourLigne(indirecte)).toContain('drive/search?q=');
    expect(lienDrivePourLigne(indirecte)).toContain(encodeURIComponent('"2024-03_Relevé_Bellerives.pdf"'));
  });
});


describe('fraîcheur moteur (C28-41 : pastille topbar + page Moteur)', () => {
  const maintenant = new Date(2026, 6, 31, 12, 0); // 2026-07-31 12:00 locale

  it('ageMoteurMinutes : parse l’heure LOCALE du « Dernier passage OK », null si illisible', () => {
    expect(ageMoteurMinutes(['Dernier passage OK : 2026-07-31 11:48'], maintenant)).toBe(12);
    expect(ageMoteurMinutes(['Dernier passage OK : 2026-07-31 12:05'], maintenant)).toBe(0); // horloge en avance → jamais négatif
    expect(ageMoteurMinutes(['autre ligne'], maintenant)).toBeNull();
    expect(ageMoteurMinutes([], maintenant)).toBeNull();
  });

  it('fraicheurMoteur : seuils DÉRIVÉS du tick réglé (jamais des valeurs du jour)', () => {
    const tick = 5;
    const seuilRetard = Math.max(20, tick * 4);
    const seuilMort = Math.max(90, tick * 18);
    const sante = (min: number) => {
      const d = new Date(maintenant.getTime() - min * 60000);
      const p = (n: number) => String(n).padStart(2, '0');
      return [`Dernier passage OK : ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`];
    };
    expect(fraicheurMoteur(sante(seuilRetard - 1), maintenant, tick)).toBe('ok');
    expect(fraicheurMoteur(sante(seuilRetard + 1), maintenant, tick)).toBe('retard');
    expect(fraicheurMoteur(sante(seuilMort + 1), maintenant, tick)).toBe('mort');
    expect(fraicheurMoteur([], maintenant, tick)).toBe('inconnu'); // données absentes ⇒ jamais un faux vert
  });

  it('tick 30 min : les seuils s’étirent avec le réglage (pas de fausse alerte)', () => {
    const sante = ['Dernier passage OK : 2026-07-31 11:00']; // il y a 60 min
    expect(fraicheurMoteur(sante, maintenant, 5)).toBe('retard'); // 60 > 20
    expect(fraicheurMoteur(sante, maintenant, 30)).toBe('ok');    // 60 ≤ 120
  });
});

describe('mails importants (C14)', () => {
  const lignes = interpreterIndex([
    ['tache|MA|h1', '2026-07-01', 'Payer Hydro', '', '', 'tache'],
    ['event|MB|h2', '2026-07-02', 'RDV garage', '', '', 'evenement'],
    ['important|MC', '2026-07-02', 'Réponds-moi stp', '', '', 'important'],
    ['intention|MD', '2026-07-02', 'Newsletter', '', '', 'intention-ecartee'],
    ['drive|X', '2026-07-02', '2026-07-01_Facture_Zephyr.pdf', '02 · Finances', 'x', 'classé'],
  ]);

  it('lignesImportants : seulement le statut important', () => {
    expect(lignesImportants(lignes).map((l) => l.cle)).toEqual(['important|MC']);
  });

  it('lienGmailPourLigne : messageId extrait des clés mail — jamais pour un document', () => {
    expect(lienGmailPourLigne(lignes[0])).toBe('https://mail.google.com/mail/#all/MA');
    expect(lienGmailPourLigne(lignes[2])).toBe('https://mail.google.com/mail/#all/MC');
    expect(lienGmailPourLigne(lignes[3])).toBe('https://mail.google.com/mail/#all/MD');
    expect(lienGmailPourLigne(lignes[4])).toBe(''); // drive| : pas un mail
  });
});

/* ---------- App v3 (C19-04) : signaux du tri + tuiles Aujourd'hui ---------- */

import {
  lignesSuspects,
  traitesLeJour,
  coutDepuisSante,
  dernierPassageDepuisSante,
} from '../src/etat';

describe('tri Gmail visible (C19-04)', () => {
  const brut = [
    ['tri|F1|100|lu', '2026-07-06 14:32', 'Relevé juin — Hydro-Québec', '', '', 'trié'],
    ['tri|F2|200|nonlu', '2026-07-06 14:31', 'Soldes — MEC', '', '', 'trié'],
    ['tri|F3|300|lu', '2026-07-05 09:00', 'Confirmation — Clinique', '', '', 'tri-a-verifier'],
    ['tri|F4|400|nonlu', '2026-06-20 08:00', 'Vieux fil', '', '', 'trié'],
    ['tri|F5|500|nonlu', '2026-07-06 12:00', '« Compte suspendu »', '', '', 'suspect'],
    ['drive|X', '2026-07-06 13:35', '2026-07-06_Attestation_DriveAI.txt', '08 · Perso & projets', '', 'classé'],
  ];
  const lignes = interpreterIndex(brut);

  it('lignesSuspects : seulement les ⚠, récents d\'abord', () => {
    expect(lignesSuspects(lignes).map((l) => l.fichier)).toEqual(['« Compte suspendu »']);
  });

  it('lienGmailPourLigne couvre les clés tri| (threadId, jamais le ts)', () => {
    expect(lienGmailPourLigne(lignes[0])).toBe('https://mail.google.com/mail/#all/F1');
  });

  it('traitesLeJour : jour calendaire LOCAL', () => {
    expect(traitesLeJour(lignes, new Date('2026-07-06T23:00:00'))).toBe(4);
    expect(traitesLeJour(lignes, new Date('2026-07-05T01:00:00'))).toBe(1);
  });
});

describe('tuiles Santé (C19-04)', () => {
  it('coutDepuisSante : parse « 7.34 $ (2296 appels) », virgule tolérée, null si absent', () => {
    expect(coutDepuisSante(['Santé DriveAI', 'Coût LLM 2026-07 : 7.34 $  (2296 appels)  ·  cible < 10 $/mois  ✅']))
      .toEqual({ dollars: 7.34, appels: 2296 });
    expect(coutDepuisSante(['Coût LLM 2026-07 : 7,34 $ (12 appels)'])).toEqual({ dollars: 7.34, appels: 12 });
    expect(coutDepuisSante(['rien ici'])).toBeNull();
  });

  it('dernierPassageDepuisSante : extrait la date, \'\' si absent', () => {
    expect(dernierPassageDepuisSante(['Dernier passage OK : 2026-07-06 13:01'])).toBe('2026-07-06 13:01');
    expect(dernierPassageDepuisSante(['autre'])).toBe('');
  });
});

/* ---------- App v4 (C28-18) : progression LIVE des opérations ---------- */

describe('progression live (C28-18)', () => {
  it('interpreterProgression : base vide → null (indéterminé), nombres parsés, lignes vides sautées', async () => {
    const { interpreterProgression } = await import('../src/etat');
    const lignes = interpreterProgression([
      ['migration', 'Migration taxonomie (m1)', '812', '1209', 'documents', 'en cours', '2026-07-10T19:00:00'],
      ['histo-gmail', 'Historique Gmail (PJ)', '4520', '', 'fils', 'suspendu (quota Gmail)', '2026-07-10T19:00:00'],
      ['', '', '', '', '', '', ''], // reliquat nettoyé par le moteur
    ]);
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatchObject({ cle: 'migration', traites: 812, base: 1209, unite: 'documents' });
    expect(lignes[1].base).toBeNull();
    expect(lignes[1].statut).toBe('suspendu (quota Gmail)');
    // TOLÉRANCE 7 colonnes (C28-44 : transition moteur pas encore redéployé) : champs H-J vides.
    expect(lignes[0]).toMatchObject({ detail: '', derniereActivite: '', derniereErreur: '' });
  });

  it('interpreterProgression (C28-44) : les 10 colonnes — Détail, Dernière activité, Dernière erreur', async () => {
    const { interpreterProgression } = await import('../src/etat');
    const [l] = interpreterProgression([
      ['tri-gmail', 'Tri de la boîte Gmail', '', '', 'fils', 'suspendu (reset en cours)',
        '2026-08-13T19:00:00', 'reset en cours', '2026-08-13 18:55', '13/08 07:12 — quota Gmail mort'],
    ]);
    expect(l).toMatchObject({
      cle: 'tri-gmail', statut: 'suspendu (reset en cours)', detail: 'reset en cours',
      derniereActivite: '2026-08-13 18:55', derniereErreur: '13/08 07:12 — quota Gmail mort',
    });
  });

  it('ilYA (C28-45) : « il y a X » depuis le format CONTRÔLÉ dd/MM HH:mm — passage d\'année géré, non-match → null', async () => {
    const { ilYA } = await import('../src/etat');
    const maintenant = new Date(2026, 7, 13, 16, 30); // 13 août 2026, 16:30 locale
    expect(ilYA('13/08 16:26', maintenant, 'fr')).toBe('il y a 4 min');
    expect(ilYA('13/08 14:30', maintenant, 'en')).toBe('2 h ago');
    expect(ilYA('11/08 16:30', maintenant, 'fr')).toBe('il y a 2 j');
    // Passage d'année : « 31/12 » vu le 2 janvier = il y a 2 jours, jamais dans le futur.
    expect(ilYA('31/12 12:00', new Date(2027, 0, 2, 12, 0), 'fr')).toBe('il y a 2 j');
    expect(ilYA('8/13/2026', maintenant, 'fr')).toBeNull(); // ancien format Date → repli brut
    expect(ilYA('', maintenant, 'fr')).toBeNull();
    // Cas dégénéré (revue C28-45) : activité « future » de plus d'1 h (fuseau navigateur ≫ fuseau
    // script) → la bascule année-1 donnerait « il y a ~365 j » — on rend null (repli brut honnête).
    expect(ilYA('13/08 19:45', maintenant, 'fr')).toBeNull();
  });

  it('estUtileProgression (C28-46) : problèmes/complétions/progrès réels VISIBLES — accompli, désactivé, jamais vu et routines sans compteur en VEILLE', async () => {
    const { estUtileProgression } = await import('../src/etat');
    const op = (statut: string, base: number | null, traites: number) =>
      ({ cle: 'x', operation: 'X', traites, base, unite: '', statut, horodate: '', detail: '', derniereActivite: '', derniereErreur: '', type: '', dernierePasse: '', finEstimee: '' });
    // Toujours visibles : problèmes, complétions, recensement, progrès réel.
    expect(estUtileProgression(op('erreur', null, 0))).toBe(true);
    expect(estUtileProgression(op('suspendu (panne API (compte))', null, 0))).toBe(true);
    expect(estUtileProgression(op('terminé', 100, 100))).toBe(true);
    expect(estUtileProgression(op('recensement', null, 0))).toBe(true);
    expect(estUtileProgression(op('en cours', 1207, 312))).toBe(true);
    expect(estUtileProgression(op('en pause (budget du jour épuisé)', 9, 6))).toBe(true);
    expect(estUtileProgression(op('en cours', null, 4520))).toBe(true); // compteur sans total (histo) = progrès réel
    // Veille : accompli, désactivée, jamais vue — MÊME avec compteur (à jour prime) — et routines.
    expect(estUtileProgression(op('à jour (plan drainé — attend la génération)', 1858, 1858))).toBe(false);
    expect(estUtileProgression(op('à jour (déjà fait)', null, 0))).toBe(false);
    expect(estUtileProgression(op('désactivée', null, 0))).toBe(false);
    expect(estUtileProgression(op('jamais vue', null, 0))).toBe(false);
    expect(estUtileProgression(op('en cours', null, 0))).toBe(false); // routine qui tourne sans compteur
    expect(estUtileProgression(op('en pause (budget de tick épuisé)', null, 0))).toBe(false);
    // C28-50 (demande Marc « je ne vois pas toutes les missions ») : une mission convergée AVEC
    // reliquat reste EN AVANT — N fichiers attendent un affinage de règles, ce n'est pas fini.
    expect(estUtileProgression(op('à jour (50 non apparié(s))', 54, 4))).toBe(true);
    expect(estUtileProgression(op('à jour (1 non apparié(s))', null, 0))).toBe(true);
  });

  it('complementStatut (C28-50) : la parenthèse terminale du statut, imbrication comprise — sinon vide', async () => {
    const { complementStatut } = await import('../src/etat');
    // Parenthèses IMBRIQUÉES : « apparié(s) » — une regex non-gourmande aurait coupé à « apparié(s ».
    expect(complementStatut('à jour (50 non apparié(s))')).toBe('50 non apparié(s)');
    expect(complementStatut('en pause (budget du jour épuisé)')).toBe('budget du jour épuisé');
    expect(complementStatut('terminé')).toBe('');
    expect(complementStatut('')).toBe('');
    expect(complementStatut('à jour (x) puis du texte')).toBe(''); // parenthèse non TERMINALE → rien
  });

  it('dateActivite (C28-45) : max par TIMESTAMP parsé — jamais un tri lexicographique jour-major', async () => {
    const { dateActivite } = await import('../src/etat');
    const maintenant = new Date(2026, 7, 13, 16, 30);
    const juil = dateActivite('31/07 10:00', maintenant)!;
    const aout = dateActivite('13/08 16:26', maintenant)!;
    // Lexicographiquement '31/07…' > '13/08…' — par timestamp, août gagne (le bug qu'on interdit).
    expect(aout.getTime()).toBeGreaterThan(juil.getTime());
  });

  it('familleStatut : préfixes FR stables → famille visuelle (pastille jamais couleur seule)', async () => {
    const { familleStatut } = await import('../src/etat');
    expect(familleStatut('en cours')).toBe('encours');
    expect(familleStatut('recensement')).toBe('recensement');
    expect(familleStatut('en attente (après m1)')).toBe('attente');
    expect(familleStatut('suspendu (quota Gmail)')).toBe('suspendu');
    expect(familleStatut('suspendu (panne API)')).toBe('suspendu');
    expect(familleStatut('en pause (frein budget)')).toBe('pause');
    expect(familleStatut('en pause (budget de tick épuisé)')).toBe('pause'); // raisons C28-44
    expect(familleStatut('terminé')).toBe('termine');
    // C28-44 : les statuts du suivi générique — erreur = pastille critique ; jamais vue /
    // désactivée = neutres (ce n'est PAS un problème).
    expect(familleStatut('erreur')).toBe('erreur');
    expect(familleStatut('jamais vue')).toBe('inactif');
    expect(familleStatut('désactivée')).toBe('inactif');
    // C28-45 : « à jour » = neutre-POSITIF (one-shot accompli, plan drainé en attente d'amont).
    expect(familleStatut('à jour (déjà fait)')).toBe('ajour');
    expect(familleStatut('à jour (plan drainé — attend la génération)')).toBe('ajour');
    expect(familleStatut('suspendu (reset en cours)')).toBe('suspendu');
    expect(familleStatut('statut inconnu du futur')).toBe('encours'); // repli neutre
  });
});

/* ---------- App v4 (C28-17) : zone Attention de l'accueil ---------- */

describe('lignesAVerifier (C28-17)', () => {
  it('seulement le statut « à vérifier » (fail-safe ADR-0016), récents d\'abord', async () => {
    const { lignesAVerifier } = await import('../src/etat');
    const lignes = interpreterIndex([
      ['drive|A', '2026-07-09', 'scan_sans_faits.pdf', '', '00 · À vérifier', 'à vérifier'],
      ['drive|B', '2026-07-10', '2026-07-01_Facture_Zephyr.pdf', '02 · Finances', 'x', 'classé'],
      ['drive|C', '2026-07-10', 'photo_floue.jpg', '', '00 · À vérifier', 'à vérifier'],
      ['drive|D', '2026-07-10', 'd.pdf', '', '', 'quarantaine'], // quarantaine ≠ à vérifier (sa propre liste)
    ]);
    expect(lignesAVerifier(lignes).map((l) => l.fichier)).toEqual(['photo_floue.jpg', 'scan_sans_faits.pdf']);
  });
});

describe('confiance (#17, C19-07)', () => {
  it('interpreterIndex lit la colonne H ; estConfianceBasse < 0,5 (virgule tolérée, vide = jamais)', async () => {
    const { estConfianceBasse } = await import('../src/etat');
    const lignes = interpreterIndex([
      ['drive|A', '2026-07-06', 'A.pdf', '02', '', 'classé', 'md5', '0.92'],
      ['drive|B', '2026-07-06', 'B.pdf', '02', '', 'classé', 'md5', '0,44'],
      ['drive|C', '2026-07-06', 'C.pdf', '02', '', 'classé', 'md5', ''],
      ['drive|D', '2026-07-06', 'D.pdf', '02', '', 'classé'],
      ['drive|E', '2026-07-06', 'E.pdf', '02', '', 'classé', 'md5', '   '],
      ['drive|F', '2026-07-06', 'F.pdf', '02', '', 'classé', 'md5', 'NaN'],
      ['drive|G', '2026-07-06', 'G.pdf', '02', '', 'classé', 'md5', '-Infinity'],
    ]);
    expect(lignes[0].confiance).toBe('0.92');
    expect(estConfianceBasse(lignes[0])).toBe(false);
    expect(estConfianceBasse(lignes[1])).toBe(true);
    expect(estConfianceBasse(lignes[2])).toBe(false);
    expect(estConfianceBasse(lignes[3])).toBe(false);
    expect(estConfianceBasse(lignes[4])).toBe(false);
    expect(estConfianceBasse(lignes[5])).toBe(false);
    expect(estConfianceBasse(lignes[6])).toBe(false);
  });
});

describe('signaux Santé (C19-08)', () => {
  it('quotaGmailEpuise : erreur quota Gmail DU JOUR seulement', async () => {
    const { quotaGmailEpuise, interpreterJournal } = await import('../src/etat');
    const j = interpreterJournal([
      ['2026-07-06 12:55', 'ERREUR', 'Gmail', 'Recherche impossible : Service invoked too many times for one day: gmail.'],
      ['2026-07-05 08:00', 'ERREUR', 'Gmail', 'Service invoked too many times for one day: gmail.'],
    ]);
    expect(quotaGmailEpuise(j, new Date('2026-07-06T18:00:00'))).toBe(true);
    expect(quotaGmailEpuise(j.slice(1), new Date('2026-07-06T18:00:00'))).toBe(false);
  });

  it('erreursRecentes : fenêtre glissante, niveau ERREUR seul', async () => {
    const { erreursRecentes, interpreterJournal } = await import('../src/etat');
    const j = interpreterJournal([
      ['2026-07-06 12:00', 'ERREUR', 'X', 'a'],
      ['2026-07-06 12:01', 'INFO', 'X', 'b'],
      ['2026-06-01 12:00', 'ERREUR', 'X', 'c'],
    ]);
    expect(erreursRecentes(j, 7, new Date('2026-07-06T18:00:00'))).toBe(1);
  });
});

/* ---------- État COURANT de l'Index (P1/C28-02) ---------- */

import { cleEtatIndex, etatCourantIndex } from '../src/etat';

describe('cleEtatIndex : identité d\'état par entité réelle', () => {
  it.each([
    ['tri|F1|100|lu', 'fil|F1'],           // le FIL, jamais le ts/lu (une ligne PAR état)
    ['tri|F1|200|nonlu', 'fil|F1'],
    ['drive|ABC', 'fichier|ABC'],
    ['shared|ABC', 'fichier|ABC'],
    ['migre|m1|ABC', 'fichier|ABC'],       // re-traitement du MÊME fichier → même identité
    ['18c9ab12f3e4d5a6|0|a.pdf|99', '18c9ab12f3e4d5a6|0|a.pdf|99'], // PJ Gmail (messageId brut) : clé = identité, jamais fusionnée
    ['important|MC', 'important|MC'],
    ['dryrunv2|d1|ABC', 'dryrunv2|d1|ABC'], // rapport dry-run : JAMAIS l'identité du fichier
  ])('%s → %s', (cle, attendu) => {
    expect(cleEtatIndex(cle)).toBe(attendu);
  });
});

describe('etatCourantIndex : la section Suspects redevient honnête (C28-13)', () => {
  it('un fil suspect à T1 puis trié à T2 disparaît de lignesSuspects', () => {
    const lignes = interpreterIndex([
      ['tri|F1|100|nonlu', '2026-07-06 12:00', '« Compte suspendu »', '', '', 'suspect'],
      ['tri|F2|150|lu', '2026-07-06 13:00', 'Autre fil louche', '', '', 'suspect'],
      ['tri|F1|200|lu', '2026-07-07 09:00', '« Compte suspendu »', '', '', 'trié'], // Marc a tranché
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(2);
    expect(lignesSuspects(courant).map((l) => l.cle)).toEqual(['tri|F2|150|lu']);
  });

  it('drive| puis migre| du même fichier fusionnent — la ligne la plus récente gagne', () => {
    const lignes = interpreterIndex([
      ['drive|F9', '2026-06-01', 'scan.pdf', '', '', 'quarantaine'],
      ['migre|m1|F9', '2026-07-01', '2024-03-05_Facture_Zephyr.pdf', '03 · Logement & véhicule', 'x', 'classé'],
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(1);
    expect(courant[0].statut).toBe('classé'); // plus aucune trace « quarantaine » dans l'état courant
  });

  it('une entité re-traitée est RÉ-INSÉRÉE en fin de liste (ordre = chronologie, les vues « récents » en dépendent)', () => {
    const lignes = interpreterIndex([
      ['tri|F1|100|nonlu', '2026-07-01', 'Vieux fil', '', '', 'trié'],
      ['drive|F2', '2026-07-02', 'b.pdf', '02 · Finances', 'x', 'classé'],
      ['tri|F1|200|lu', '2026-07-08', 'Vieux fil (re-trié auj.)', '', '', 'trié'], // re-traité APRÈS F2
    ]);
    // Sans ré-insertion, une Map garderait F1 à sa position INITIALE (avant F2) → il sortirait
    // des listes « récents » bornées (.reverse().slice(0, N)) alors qu'il est le plus frais.
    expect(etatCourantIndex(lignes).map((l) => l.cle)).toEqual(['drive|F2', 'tri|F1|200|lu']);
  });

  it('réconciliation (P3) : une ligne « déplacé » puis « corbeillé » du MÊME fichier remplace l\'état affiché', () => {
    const lignes = interpreterIndex([
      ['drive|X', '2024-01-01', 'vieux.pdf', '02 · Finances', '02/X', 'classé'],
      ['drive|X', '2025-01-01', 'nouveau.pdf', '02 · Finances', 'DriveAI/02/Y', 'déplacé'], // appendée par synchroniserIndex_
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(1);
    expect(courant[0].fichier).toBe('nouveau.pdf');
    expect(courant[0].statut).toBe('déplacé');
  });

  it('une ligne dryrunv2| n\'écrase JAMAIS l\'état réel du fichier', () => {
    const lignes = interpreterIndex([
      ['drive|F5', '2026-07-01', 'a.pdf', '02 · Finances', 'x', 'classé'],
      ['dryrunv2|d1|F5', '2026-07-08', 'a.pdf', '', '', 'dry-run'],
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(2); // les deux survivent : identités distinctes
    expect(courant.find((l) => l.cle === 'drive|F5')?.statut).toBe('classé');
  });
});

/* ---------- Réorg IA (C21-05) ---------- */

import {
  interpreterReorg,
  derniereDemandeReorg,
  demandeReorgEnEchecAffichable,
  actionsDuPlan,
  actionsProposeesChat,
  actionsRefuseesReorg,
  plagesContigues,
  lignesVideCandidat,
  lignesVideBloquee,
} from '../src/etat';

describe('Réorg IA (C21-05)', () => {
  const brut = [
    ['demande-1', 'demande', '', '', '', 'proposé', 'Synthèse.', 'T1'],
    ['reorg|demande-1|1', 'deplacer', 'idC', '08/Vrac', '03/Vrac', 'proposé', 'raison', 'T1'],
    ['reorg|demande-1|2', 'renommer', 'idB', '03/Marqued', '03/Marqued Modeled', 'validé', '', 'T1'],
    ['', '', '', '', '', '', '', ''], // ligne vide ignorée
    ['demande-2', 'demande', '', '', '', 'analyse demandée', 'tout', 'T2'],
  ];

  it('interpreterReorg : lignes numérotées (Sheet), vides ignorées', () => {
    const lignes = interpreterReorg(brut);
    expect(lignes).toHaveLength(4);
    expect(lignes[0].ligneSheet).toBe(2);
    expect(lignes[3].ligneSheet).toBe(6); // la ligne vide ne décale pas la numérotation
  });

  it('derniereDemandeReorg : la plus récente (celle que le moteur traite)', () => {
    const lignes = interpreterReorg(brut);
    expect(derniereDemandeReorg(lignes)?.cle).toBe('demande-2');
    expect(derniereDemandeReorg([])).toBeNull();
  });

  it('demandeReorgEnEchecAffichable : masque portée trop large obsolète, conserve les autres échecs', () => {
    expect(demandeReorgEnEchecAffichable(null)).toBe(false);
    const proposee = interpreterReorg([
      ['d1', 'demande', '', 'tout', '', 'proposé', 'OK', 'T1'],
    ])[0]!;
    expect(demandeReorgEnEchecAffichable(proposee)).toBe(false);
    const tropLarge = interpreterReorg([
      ['d2', 'demande', '', 'tout', '', 'échec', 'portée trop large (> 250 dossiers) — choisis un dossier', 'T2'],
    ])[0]!;
    expect(demandeReorgEnEchecAffichable(tropLarge)).toBe(false);
    const autreEchec = interpreterReorg([
      ['d3', 'demande', '', 'tout', '', 'échec', 'portée refusée : zone protégée (04 · Immigration)', 'T3'],
    ])[0]!;
    expect(demandeReorgEnEchecAffichable(autreEchec)).toBe(true);
  });

  it('actionsDuPlan : préfixe strict reorg|<cléDemande>|', () => {
    const lignes = interpreterReorg(brut);
    expect(actionsDuPlan(lignes, 'demande-1')).toHaveLength(2);
    expect(actionsDuPlan(lignes, 'demande-2')).toHaveLength(0);
    expect(actionsDuPlan(lignes, 'demande')).toHaveLength(0); // pas de demi-préfixe
  });

  it('actionsProposeesChat : lignes chatreorg| PROPOSÉES seules, sans demande, plus récentes d’abord', () => {
    const avecChat = interpreterReorg([
      ...brut,
      ['chatreorg|1799999999100|1', 'deplacer-fichier', 'F1→D1', 'nas.txt', 'Réseau', 'proposé', 'range', 'T3'],
      ['chatreorg|1799999999200|1', 'creer', '→P1', '', 'Véhicule/Garage', 'proposé', '', 'T4'],
      ['chatreorg|1799999999050|1', 'deplacer-fichier', 'F2→D2', 'vieux.pdf', 'Archives', 'validé', '', 'T2'], // décidé → exclu
    ]);
    const chat = actionsProposeesChat(avecChat);
    // ts réels (13 chiffres, largeur fixe) : ordre lexical décroissant == plus récent d'abord ; validé exclu.
    expect(chat.map((c) => c.cle)).toEqual(['chatreorg|1799999999200|1', 'chatreorg|1799999999100|1']);
    // N’attrape jamais les lignes du plan réorg classique (préfixe reorg|…).
    expect(chat.every((c) => c.cle.startsWith('chatreorg|'))).toBe(true);
    expect(actionsProposeesChat(interpreterReorg(brut))).toHaveLength(0);
  });

  it('actionsRefuseesReorg : refus/échecs du plan courant + chat, jamais les proposées/validées/appliquées', () => {
    const lignes = interpreterReorg([
      ...brut,
      ['reorg|demande-1|3', 'deplacer', 'idD', '04/Visa', '01/Visa', 'refusé (zone protégée)', 'parent protégé ou système', 'T1'],
      ['reorg|demande-1|4', 'creer', '→P', '', '03/Garage', 'appliqué', '', 'T1'],
      ['reorg|demande-0|1', 'deplacer', 'idE', 'a', 'b', 'échec', 'vieux plan', 'T0'], // autre plan → exclu
      ['chatreorg|1799999999100|1', 'deplacer-fichier', 'F1→D1', 'nas.txt', 'Réseau', 'échec', 'fichier introuvable', 'T3'],
      ['chatreorg|1799999999200|1', 'renommer', 'idF', '03/Marqued', '03/Marqued', 'refusé (structure)', 'nom réservé', 'T4'],
      ['chatreorg|1799999999300|1', 'creer', '→P2', '', 'X', 'proposé', '', 'T5'],
    ]);
    expect(actionsRefuseesReorg(lignes, 'demande-1').map((l) => l.cle)).toEqual([
      'chatreorg|1799999999200|1', 'chatreorg|1799999999100|1', 'reorg|demande-1|3',
    ]);
    // Sans plan courant : le chat seul.
    expect(actionsRefuseesReorg(lignes, null).map((l) => l.cle)).toEqual(['chatreorg|1799999999200|1', 'chatreorg|1799999999100|1']);
    expect(actionsRefuseesReorg(interpreterReorg(brut), 'demande-1')).toHaveLength(0);
  });

  it('plagesContigues : regroupe, dédoublonne, trie — jamais une ligne non ciblée', () => {
    expect(plagesContigues([5, 3, 4, 9, 3])).toEqual([{ debut: 3, fin: 5 }, { debut: 9, fin: 9 }]);
    expect(plagesContigues([])).toEqual([]);
    expect(plagesContigues([7])).toEqual([{ debut: 7, fin: 7 }]);
  });

  it('lignesVideCandidat / lignesVideBloquee : filtre « Bloqués » (idée acceptée par Marc, 29/09)', () => {
    // Format réel d'une ligne « dossier-vide » (ConsolidationExec.gs/Reorg.gs) :
    // [clé, 'dossier-vide', id, chemin actuel, '', statut, détail, horodaté].
    const lignes = interpreterReorg([
      ['videcandidat|1', 'dossier-vide', 'id1', '08/Vrac/Ancien', '', 'vide-candidat', '', 'T1'],
      ['videcandidat|2', 'dossier-vide', 'id2', '08/Vrac/Repris', '', 'vide-repris', 'redevenu vide', 'T1'],
      ['videcandidat|3', 'dossier-vide', 'id3', '04/Immigration/X', '', 'vide-protégé', '', 'T1'],
      ['videcandidat|4', 'dossier-vide', 'id4', '03/Ancien', '', 'vide-droits-refusés', '', 'T1'],
      ['videcandidat|5', 'dossier-vide', 'id5', '02/Disparu', '', 'vide-disparu', '', 'T1'],
      ['videcandidat|6', 'dossier-vide', 'id6', '08/Corbeillé', '', 'corbeillé', '', 'T1'],
      // une action de réorg ordinaire ne compte JAMAIS comme un dossier vide, même à statut proche.
      ['reorg|demande-1|1', 'deplacer', 'idX', 'a', 'b', 'vide-candidat', '', 'T1'],
    ]);
    expect(lignesVideCandidat(lignes).map((l) => l.id)).toEqual(['id1']);
    const bloques = lignesVideBloquee(lignes);
    expect(bloques.map((l) => l.id)).toEqual(['id2', 'id3', 'id4', 'id5']);
    // `corbeillé` (succès) et `vide-candidat` (encore en attente) ne sont jamais des BLOCAGES.
    expect(bloques.some((l) => l.statut === 'corbeillé')).toBe(false);
    expect(bloques.some((l) => l.statut === 'vide-candidat')).toBe(false);
  });
});

/* ---------- Télémétrie coûts & quotas (C28-24) ---------- */

import { interpreterTelemetrie } from '../src/etat';

describe('interpreterTelemetrie', () => {
  const brut = [
    ['quota_gmail_etat', 'suspendu', '', 'Reprise vers 16:45'],
    ['gmail_histo_fils_jour', '150', 'fils', 'Plafond 150/j'],
    ['tri_cyclique_fils_jour', '84', 'fils', 'Plafond 150/j'],
    ['tri_boite_fils_jour', '45', 'fils', 'Plafond 150/j'],
    ['llm_cout_mois', '16.42', '$', 'Frein campagnes à 110 $'],
    ['llm_appels_mois', '5210', 'appels', ''],
  ];

  it('lit les clés STABLES du moteur : état quota, jauges du jour (plafond depuis le Détail), coût vs frein', () => {
    const t = interpreterTelemetrie(brut);
    expect(t.presente).toBe(true);
    expect(t.quotaSuspendu).toBe(true);
    expect(t.quotaDetail).toBe('Reprise vers 16:45');
    expect(t.cycliqueJour).toEqual({ lus: 84, plafond: 150 });
    expect(t.histoJour).toEqual({ lus: 150, plafond: 150 });
    expect(t.boiteJour).toEqual({ lus: 45, plafond: 150 });
    expect(t.coutDollars).toBe(16.42);
    expect(t.freinDollars).toBe(110);
    expect(t.appelsMois).toBe(5210);
  });

  it('onglet vide (moteur pas encore passé) → presente: false, aucun nombre inventé', () => {
    const t = interpreterTelemetrie([]);
    expect(t.presente).toBe(false);
    expect(t.coutDollars).toBeNull();
    expect(t.appelsMois).toBeNull();
  });

  it('quota actif + lignes partielles/illisibles → valeurs sûres (jamais NaN)', () => {
    const t = interpreterTelemetrie([
      ['quota_gmail_etat', 'actif', '', ''],
      ['tri_cyclique_fils_jour', 'zéro', 'fils', 'sans nombre'],
      ['llm_cout_mois', '3,50', '$', 'Frein campagnes à 110 $'],
    ]);
    expect(t.quotaSuspendu).toBe(false);
    expect(t.quotaDetail).toBe('');
    expect(t.cycliqueJour).toEqual({ lus: 0, plafond: null }); // illisible → 0 / sans borne
    expect(t.coutDollars).toBe(3.5); // virgule décimale FR tolérée
  });

  it('GAP-6 : valeurs négatives ou non finies (-5, -12, Infinity) normalisées à null (—) / 0', () => {
    const t = interpreterTelemetrie([
      ['tri_archives_jour', '-5', 'fils/jour', ''],
      ['tri_anciens_fils_jour', '-12', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_fond_fils_jour', 'Infinity', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_cyclique_fils_jour', '-8', 'fils', 'Plafond 300/j'],
      ['llm_cout_mois', '-3.5', '$', 'Frein campagnes à 110 $'],
      ['llm_appels_mois', 'Infinity', 'appels', ''],
    ]);
    expect(t.archivesJour).toBeNull();
    expect(t.anciensFilsJour).toBeNull();
    expect(t.anciensJour).toBeNull();
    expect(t.fondFilsJour).toBeNull();
    expect(t.fondJour).toBeNull();
    expect(t.cycliqueJour).toEqual({ lus: 0, plafond: 300 });
    expect(t.coutDollars).toBeNull();
    expect(t.appelsMois).toBeNull();

    // Somme de repli sans tri_fond_fils_jour : ignore les valeurs négatives/infinies
    const tRepli = interpreterTelemetrie([
      ['tri_cyclique_fils_jour', '-10', 'fils', 'Plafond 300/j'],
      ['tri_boite_fils_jour', 'Infinity', 'fils', 'Plafond 300/j'],
    ]);
    expect(tRepli.fondFilsJour).toBeNull();
    expect(tRepli.fondJour).toBeNull();
  });
});

/* ---------- Coûts par poste (C28-58) — graphique « Réglages » (idée Marc, 29/09) ---------- */

import { interpreterCouts } from '../src/etat';

describe('interpreterCouts', () => {
  it('lit Poste|Appels|Coût $|Part, préserve l\'ORDRE du moteur (déjà trié, du plus gros au plus petit)', () => {
    const lignes = interpreterCouts([
      ['rattrapage-piece', '2080', '22.7741', '81.2 %'],
      ['reanalyse', '216', '2.3341', '8.3 %'],
      ['app:chat-assistant', '8', '0.0790', '0.3 %'],
    ]);
    expect(lignes).toEqual([
      { poste: 'rattrapage-piece', appels: 2080, dollars: 22.7741, part: 81.2 },
      { poste: 'reanalyse', appels: 216, dollars: 2.3341, part: 8.3 },
      { poste: 'app:chat-assistant', appels: 8, dollars: 0.079, part: 0.3 },
    ]);
    // L'ORDRE d'entrée survit tel quel — aucun `.sort()` ajouté côté app (le moteur trie déjà).
    expect(lignes.map((l) => l.poste)).toEqual(['rattrapage-piece', 'reanalyse', 'app:chat-assistant']);
  });

  it('la ligne « non ventilé » (Appels = « — ») rend appels: null, jamais 0 ni NaN', () => {
    const lignes = interpreterCouts([
      ['rattrapage-piece', '2080', '22.77', '81.2 %'],
      ['(non ventilé — antérieur au détail, ou non attribué)', '—', '1.23', '4.4 %'],
    ]);
    expect(lignes[1].appels).toBeNull();
    expect(lignes[1].dollars).toBe(1.23);
    expect(lignes[1].part).toBe(4.4);
  });

  it('onglet vide (moteur pas encore passé au détail) → liste vide, jamais une erreur', () => {
    expect(interpreterCouts([])).toEqual([]);
    // Lignes vides intercalées (comme les autres onglets) : ignorées.
    expect(interpreterCouts([['', '', '', ''], ['x', '1', '0.5', '50 %']])).toHaveLength(1);
  });

  it('valeurs illisibles → 0, jamais NaN (même garde que les autres interpréteurs)', () => {
    const [l] = interpreterCouts([['poste-x', 'abc', 'pas-un-nombre', 'beaucoup']]);
    expect(l.dollars).toBe(0);
    expect(l.part).toBe(0);
    expect(l.appels).toBe(0); // texte non numérique ≠ « — » : 0, pas null (seul le tiret veut dire « pas d'appels »)
  });
});

describe('câblage du graphique « Coûts par poste » dans Etat.tsx (idée Marc, 29/09)', () => {
  const RACINE_SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
  const etatVue = readFileSync(join(RACINE_SRC, 'vues', 'Etat.tsx'), 'utf8');
  const etatGlobal = readFileSync(join(RACINE_SRC, 'etatGlobal.tsx'), 'utf8');

  it('etatGlobal.tsx lit l\'onglet Coûts et l\'expose dans DonneesEtat', () => {
    expect(etatGlobal).toContain("coutsBrut: string[][]");
    expect(etatGlobal).toContain("lirePlage('Coûts',");
    expect(etatGlobal).toContain('coutsBrut: couts');
  });

  it('Etat.tsx s’appuie sur syntheseEtat et ne rend plus le panneau Avancé', () => {
    expect(etatVue).toContain('syntheseEtat(donnees');
    expect(etatVue).not.toContain('details className="avance"');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compteursIndex,
  importantsAFaire,
  erreursDesDerniersJours,
  STATUT_IMPORTANT_FAIT,
  SEUIL_CONFIANCE_BASSE,
  interpreterSante,
  interpreterCoutsResume,
  interpreterProgression,
  syntheseEtat,
  type EtatSante,
  type EtatCompteLlm,
  type EtatTriGmailSante,
  type LigneMaintenanceSante,
  type Telemetrie,
  type ResumeCouts,
  type DonneesEtatBrutes,
  type OptionsSyntheseEtat,
  type SyntheseEtat,
  LigneIndex as LI,
  LigneJournal as LJ,
} from '../src/etat';
import { plageMock } from '../src/mockData';

const li = (cle: string, statut: string, traiteLe = '2026-09-09 10:00'): LI =>
  ({ cle, traiteLe, fichier: cle, domaine: '', chemin: '', statut, confiance: '' });

describe('compteursIndex (v7 Réglages : trois chiffres depuis l’Index, pas depuis Santé)', () => {
  it('compte les documents classés et les fils triés, ignore le reste', () => {
    const lignes = [
      li('drive|F1', 'classé'), li('1a|0|x.pdf|12', 'classé'), li('drive|F2', 'à vérifier'), li('drive|F3', 'doublon'),
      li('tri|T1|1|lu', 'trié'), li('tri|T2|2|lu', 'tri-a-verifier'), li('tri|T3|3|lu', 'suspect'),
      li('important|M1', 'important'), li('intention|M2', 'classé'), li('tri-abandon|T4', 'classé'),
    ];
    expect(compteursIndex(lignes)).toEqual({ documentsClasses: 2, mailsTries: 2 });
    expect(compteursIndex([])).toEqual({ documentsClasses: 0, mailsTries: 0 });
  });
});

describe('importantsAFaire (accueil v7 : fenêtre 7 j + « fait »)', () => {
  const maintenant = new Date('2026-09-09T12:00:00');
  it('garde les ⏰ récents non faits, récents d’abord ; écarte les vieux et les « fait »', () => {
    const lignes = [
      li('important|A', 'important', '2026-09-08 09:00'),
      li('important|B', 'important', '2026-08-20 09:00'),     // > 7 j : sorti tout seul
      li('important|C', STATUT_IMPORTANT_FAIT, '2026-09-09 09:00'), // marqué fait par l’app
      li('important|D', 'important', '2026-09-09 08:00'),
    ];
    expect(importantsAFaire(lignes, maintenant).map((l) => l.cle)).toEqual(['important|D', 'important|A']);
    expect(importantsAFaire(lignes, maintenant, 30).map((l) => l.cle)).toEqual(['important|D', 'important|B', 'important|A']);
  });
});

describe('erreursDesDerniersJours (filtrage source retirée Hub)', () => {
  it('ne garde que les ERREUR datées dans la fenêtre et exclut la source retirée Hub', () => {
    const maintenant = new Date('2026-09-09T12:00:00');
    const lj = (date: string, niveau: string, source = 's'): LJ => ({ date, niveau, source, message: 'm' } as LJ);
    const journal = [
      lj('2026-09-08 10:00', 'ERREUR', 'OCR'),
      lj('2026-09-09 11:00', 'ERREUR', 'Hub'),
      lj('2026-08-01 10:00', 'ERREUR', 'TriGmail'),
      lj('2026-09-09 10:00', 'INFO', 'Pipeline'),
      lj('n/a', 'ERREUR', 'TriGmail'),
    ];
    const res = erreursDesDerniersJours(journal, 7, maintenant);
    expect(res).toHaveLength(1);
    expect(res[0]!.source).toBe('OCR');
  });
});

describe('erreurs vues (cleErreurJournal, lireErreursVues, enregistrerErreursVues)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cleErreurJournal est déterministe, distingue chaque erreur et ne fuit pas le texte brut', () => {
    const a: LJ = { date: '11/19/2026 11:46:40', niveau: 'ERREUR', source: 'OCR', message: 'Facture confidentielle' };
    const b: LJ = { date: '11/19/2026 11:46:40', niveau: 'ERREUR', source: 'OCR', message: 'Autre message' };
    const c: LJ = { date: '11/19/2026 11:47:00', niveau: 'ERREUR', source: 'OCR', message: 'Facture confidentielle' };
    expect(cleErreurJournal(a)).toBe(cleErreurJournal({ ...a }));
    expect(cleErreurJournal(a)).not.toBe(cleErreurJournal(b));
    expect(cleErreurJournal(a)).not.toBe(cleErreurJournal(c));
    expect(cleErreurJournal(a)).not.toContain('Facture confidentielle');
    expect(cleErreurJournal({ date: 'd', niveau: 'ERREUR', source: 'S', message: '' })).toMatch(/^d\|S\|/);
  });

  it('lireErreursVues et enregistrerErreursVues gèrent cycle complet, FIFO 64, suppression si vide et pannes localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(lireErreursVues()).toEqual([]);
    expect(() => enregistrerErreursVues(['k1'])).not.toThrow();

    const stock = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stock.get(k) ?? null,
      setItem: (k: string, v: string) => stock.set(k, v),
      removeItem: (k: string) => stock.delete(k),
    });

    const trop = Array.from({ length: 70 }, (_, i) => `k${i}`);
    enregistrerErreursVues(['k0', ...trop, '']);
    const lus = lireErreursVues();
    expect(lus).toHaveLength(64);
    expect(lus[0]).toBe('k6');
    expect(lus[63]).toBe('k69');

    enregistrerErreursVues([]);
    expect(stock.has('driveai.erreursVues')).toBe(false);
    expect(lireErreursVues()).toEqual([]);

    stock.set('driveai.erreursVues', 'json-invalide');
    expect(lireErreursVues()).toEqual([]);
    stock.set('driveai.erreursVues', JSON.stringify({ pas: 'tableau' }));
    expect(lireErreursVues()).toEqual([]);

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    });
    expect(lireErreursVues()).toEqual([]);
    expect(() => enregistrerErreursVues(['x'])).not.toThrow();
    expect(() => enregistrerErreursVues([])).not.toThrow();
  });
});

/* ---------- F5 : Parsers d'état complets & syntheseEtat (R3) ---------- */

describe('interpreterSante (EtatSante — format Journal.gs)', () => {
  it('parse le format 11 lignes complet : dernière passe, Compte LLM, Tri Gmail et 4 lignes maintenance', () => {
    const brut = [
      ['Dernier passage OK : 2026-07-06 14:12'],
      ['Documents au catalogue (Index) : 1842'],
      ['Coût LLM 2026-07 : 16.42 $  (5210 appels)  ·  cible < 10 $/mois  ⚠️ DÉPASSÉE'],
      ['Rangement ancien Drive : terminé ✅'],
      ['Tri Gmail : ✅ normal (libellés + archivage)'],
      ['Compte LLM : actif'],
      ['Doublons (validation par empreinte) : terminée ✅'],
      ['Historique Gmail : en cours'],
      ['Re-datation de 06 : en attente — après rangement'],
      ['Résolution des identifiants (C49-16) : ✅ terminée — 124 retrouvés'],
      ['Mis à jour : Mon Jul 06 2026'],
    ];
    const s: EtatSante = interpreterSante(brut);
    expect(s.lignes).toHaveLength(11);
    expect(s.dernierePasseOk).toBe('2026-07-06 14:12');
    const llm: EtatCompteLlm = s.compteLlm;
    expect(llm).toEqual({ statut: 'actif', detail: 'actif' });
    const tri: EtatTriGmailSante = s.triGmailSante;
    expect(tri).toEqual({ statut: 'normal', detail: '✅ normal (libellés + archivage)' });
    const maint: LigneMaintenanceSante[] = s.maintenanceSante;
    expect(maint.map((m) => m.cle)).toEqual(['rangement', 'doublons', 'reanalyse', 'resolutionFileId']);
    expect(maint[0].detail).toBe('terminé ✅');
  });

  it('détecte les pannes LLM et l’arrêt du Tri Gmail', () => {
    const s = interpreterSante([
      ['Tri Gmail : ⛔ À L\'ARRÊT (panne de compte LLM) — aucun tri ce tick'],
      ['Compte LLM : ⛔ panne depuis 10:15 (re-sonde ≤ 10:45)'],
    ]);
    expect(s.compteLlm.statut).toBe('panne');
    expect(s.triGmailSante.statut).toBe('arret');
  });

  it('repli fermé sur états indéterminés, illisibles ou onglet vide', () => {
    const indet = interpreterSante([
      ['Tri Gmail : état indéterminé (lecture de l\'état impossible)'],
      ['Compte LLM : indéterminé (lecture impossible)'],
      ['Compte LLM inconnu : texte libre'],
    ]);
    expect(indet.compteLlm.statut).toBe('inconnu');
    expect(indet.triGmailSante.statut).toBe('inconnu');

    const autre = interpreterSante([
      ['Compte LLM : en attente de vérification'],
      ['Tri Gmail : statut non reconnu'],
    ]);
    expect(autre.compteLlm.statut).toBe('inconnu');
    expect(autre.triGmailSante.statut).toBe('inconnu');

    const vide = interpreterSante([]);
    expect(vide).toEqual({
      lignes: [],
      dernierePasseOk: '',
      compteLlm: { statut: 'inconnu', detail: '' },
      triGmailSante: { statut: 'inconnu', detail: '' },
      maintenanceSante: [],
    });
  });
});

describe('interpreterTelemetrie (tri_histo_fils_jour)', () => {
  it('lit tri_histo_fils_jour et triHistoJour quand présents, null sinon ou si non numérique', () => {
    const avec: Telemetrie = interpreterTelemetrie([
      ['quota_gmail_etat', 'actif', '', ''],
      ['tri_cyclique_fils_jour', '10', 'fils', 'Plafond commun 150/j'],
      ['gmail_histo_fils_jour', '20', 'fils', 'Plafond 150/j'],
      ['tri_boite_fils_jour', '5', 'fils', 'Plafond commun 150/j'],
      ['tri_histo_fils_jour', '30', 'fils', 'Plafond commun 150/j'],
      ['llm_cout_mois', '4.2', '$', 'Frein campagnes à 110 $'],
      ['llm_appels_mois', '120', 'appels', ''],
    ]);
    expect(avec.triHistoFilsJour).toBe(30);
    expect(avec.triHistoJour).toEqual({ lus: 30, plafond: 150 });
    expect(avec.freinDollars).toBe(110);

    const sans = interpreterTelemetrie([['quota_gmail_etat', 'actif', '', '']]);
    expect(sans.triHistoFilsJour).toBeNull();
    expect(sans.triHistoJour).toBeNull();

    const nonNum = interpreterTelemetrie([['tri_histo_fils_jour', 'n/a', 'fils', 'Plafond 150/j']]);
    expect(nonNum.triHistoFilsJour).toBeNull();
    expect(nonNum.triHistoJour).toEqual({ lus: 0, plafond: 150 });

    for (const val of ['—', '', '   ', 'NaN', 'Infinity']) {
      const t = interpreterTelemetrie([
        ['llm_cout_mois', val, '$', 'Frein campagnes à 110 $'],
        ['llm_appels_mois', val, 'appels', ''],
      ]);
      expect(t.coutDollars).toBeNull();
      expect(t.appelsMois).toBeNull();
    }

    const zero = interpreterTelemetrie([
      ['llm_cout_mois', '0', '$', ''],
      ['llm_appels_mois', '0', 'appels', ''],
    ]);
    expect(zero.coutDollars).toBe(0);
    expect(zero.appelsMois).toBe(0);
  });
});

describe('interpreterCoutsResume + exclusion TOTAL LLM', () => {
  it('sépare TOTAL LLM des postes dans interpreterCoutsResume et l’exclut de interpreterCouts', () => {
    const brut = [
      ['TOTAL LLM 2026-07', '2671', '26.12', '100 %'],
      ['rattrapage-piece', '2080', '22.7741', '81.2 %'],
      ['(non ventilé — antérieur au détail)', '—', '0.50', '1.9 %'],
    ];
    const resume: ResumeCouts = interpreterCoutsResume(brut);
    expect(resume.total).toEqual({
      poste: 'TOTAL LLM 2026-07',
      appels: 2671,
      dollars: 26.12,
      part: 100,
    });
    expect(resume.postes.map((p) => p.poste)).toEqual([
      'rattrapage-piece',
      '(non ventilé — antérieur au détail)',
    ]);
    expect(interpreterCouts(brut)).toEqual(resume.postes);
  });
});

describe('syntheseEtat (R3 — zéro donnée inventée)', () => {
  const maintenant = new Date(2026, 6, 6, 14, 15); // 2026-07-06 14:15 locale

  it('agrège tous les statuts Index (hors marqueurs dryrunv2|), Gmail, file de revue, coûts et erreurs', () => {
    expect(SEUIL_CONFIANCE_BASSE).toBe(0.5);
    const index = etatCourantIndex(interpreterIndex([
      ['drive|d1', '2026-07-06T14:00:00', '2026-07-01_A.pdf', '02', 'x', 'classé', 'h1', '0.92'],
      ['tri33p|t1|v2|d2', '2026-07-06T14:02:00', '2026-07-01_B.pdf', '02', 'x', 'tri33-route', 'h2', '0.41'],
      ['drive|d3', '2026-07-05T10:00:00', 'C.pdf', '', '00 · À trier', 'à trier', '', ''],
      ['drive|d4', '2026-07-06T11:00:00', 'D.pdf', '', '00 · À vérifier', 'à vérifier', '', ''],
      ['drive|d5', '2026-07-04T10:00:00', 'E.pdf', '', '_Doublons', 'doublon', '', ''],
      ['drive|d6', '2026-07-04T10:00:00', 'F.pdf', '08', '08', 'manuel', '', ''],
      ['drive|d7', '2026-07-04T10:00:00', 'G.pdf', '', '', 'quarantaine', '', ''],
      ['drive|d8', '2026-07-04T10:00:00', 'H.html', '', '_Technique', 'technique', '', ''],
      ['drive|d9', '2026-07-04T10:00:00', 'I.jpg', '', '_Médias', 'média', '', ''],
      ['drive|d10', '2026-07-04T10:00:00', 'J.pdf', '', '', 'natif', '', ''],
      ['dryrunv2|r1|d1', '2026-07-06T14:05:00', '2026-07-01_A.pdf', '', '', 'dry-run', '', ''],
      ['tri|fil1|100|1', '2026-07-06T09:00:00', 'Facture', '', '', 'trié', '', ''],
      ['tri|fil2|200|1', '2026-07-06T09:05:00', 'Confirmation', '', '', 'tri-a-verifier', '', ''],
      ['tri|fil3|300|0', '2026-07-06T09:10:00', 'Alerte suspecte', '', '', 'suspect', '', ''],
      ['tri-abandon|fil4|400', '2026-07-06T09:15:00', '', '', '', 'tri-erreur', '', ''],
      ['important|m1', '2026-07-06T08:00:00', 'Important', '', '', 'important', '', ''],
    ]));

    const donnees: DonneesEtatBrutes = {
      index,
      santeBrut: [
        ['Dernier passage OK : 2026-07-06 14:12'],
        ['Tri Gmail : ✅ normal (libellés + archivage)'],
        ['Compte LLM : actif'],
        ['Rangement ancien Drive : terminé ✅'],
      ],
      journalBrut: [
        ['2026-07-06 12:00', 'ERREUR', 'TriGmail', 'Service invoked too many times for one day: gmail.'],
        ['2026-06-15 12:00', 'ERREUR', 'Pipeline', 'Vieille erreur'],
      ],
      reglagesBrut: [['TICK_MINUTES', '5']],
      telemetrieBrut: [
        ['quota_gmail_etat', 'suspendu', '', 'Reprise vers 16:45'],
        ['tri_cyclique_fils_jour', '20', 'fils', 'Plafond commun 150/j'],
        ['gmail_histo_fils_jour', '50', 'fils', 'Plafond 150/j'],
        ['tri_boite_fils_jour', '10', 'fils', 'Plafond commun 150/j'],
        ['tri_histo_fils_jour', '30', 'fils', 'Plafond commun 150/j'],
        ['llm_cout_mois', '12.5', '$', 'Frein campagnes à 110 $'],
        ['llm_appels_mois', '320', 'appels', ''],
      ],
      coutsBrut: [
        ['TOTAL LLM 2026-07', '320', '12.50', '100 %'],
        ['tri-gmail', '200', '8.00', '64 %'],
      ],
      reorgBrut: [
        ['dem-1', 'demande', '', 'tout', '', 'proposé', '', '2026-07-06T10:00:00'],
        ['reorg|dem-1|1', 'deplacer', 'x1', 'a', 'b', 'proposé', '', '2026-07-06T10:01:00'],
        ['reorg|dem-1|2', 'renommer', 'x2', 'a', 'b', 'refusé (zone protégée)', '', '2026-07-06T10:02:00'],
        ['chatreorg|1799999999100|1', 'creer', 'x3', '', 'c', 'proposé', '', '2026-07-06T10:03:00'],
        ['vide|1', 'dossier-vide', 'v1', '08/Vide', '', 'vide-candidat', '', '2026-07-06T10:04:00'],
        ['vide|2', 'dossier-vide', 'v2', '04/Prot', '', 'vide-protégé', '', '2026-07-06T10:05:00'],
      ],
    };

    const opts: OptionsSyntheseEtat = {
      maintenant,
      progression: interpreterProgression([
        ['migration', 'Migration', '812', '1209', 'documents', 'en cours', '2026-07-06T14:10:00', '', '06/07 14:10', '', 'campagne', '+23 documents · il y a 4 min', 'reste 397'],
        ['done', 'Fini', '10', '10', 'documents', 'à jour (déjà fait)', '2026-07-06T14:10:00', '', '06/07 14:00', '', 'maintenance', '', ''],
      ]),
    };

    const syn: SyntheseEtat = syntheseEtat(donnees, opts);
    expect(syn.moteur.fraicheur).toBe('ok');
    expect(syn.moteur.ageMinutes).toBe(3);
    expect(syn.moteur.compteLlm.statut).toBe('actif');
    expect(syn.moteur.triGmailSante.statut).toBe('normal');
    expect(syn.moteur.progressionDisponible).toBe(true);
    expect(syn.moteur.campagnesActives).toBe(1);
    expect(syn.moteur.dernieresPassesProgression).toHaveLength(1);

    expect(syn.fichiers).toEqual({
      total: 10,
      classe: 2,
      aTrier: 1,
      aVerifier: 1,
      doublon: 1,
      manuel: 1,
      quarantaineOuErreur: 1,
      technique: 1,
      media: 1,
      autres: 1,
      confianceBasse: 1,
      traitesAujourdhui: 3,
    });

    expect(syn.gmail.tries).toBe(1);
    expect(syn.gmail.aVerifier).toBe(1);
    expect(syn.gmail.totalTries).toBe(2);
    expect(syn.gmail.suspects).toBe(1);
    expect(syn.gmail.erreurs).toBe(1);
    expect(syn.gmail.importantsAFaire).toBe(1);
    expect(syn.gmail.jauges.triHistoLus).toBe(30);
    expect(syn.gmail.jauges.triHisto).toEqual({ lus: 30, plafond: 150 });
    expect(syn.gmail.jauges.anciensLus).toBeNull();
    expect(syn.gmail.jauges.anciens).toBeNull();
    expect(syn.gmail.jauges.fondLus).toBe(60);
    expect(syn.gmail.jauges.fond).toEqual({ lus: 60, plafond: 150 });
    expect(syn.gmail.archivage).toEqual({ suiviIndexDisponible: false, triGmailActif: true, archivesJour: null });

    expect(syn.fileRevue).toEqual({
      suspects: 1,
      aVerifier: 1,
      importants: 1,
      reorgDisponible: true,
      reorgPropositions: 2,
      reorgRefus: 1,
      videsCandidats: 1,
      videsBloquees: 1,
      total: 6,
    });

    expect(syn.quotasCouts.coutMoisDollars).toBe(12.5);
    expect(syn.quotasCouts.appelsMois).toBe(320);
    expect(syn.quotasCouts.freinDollars).toBe(110);
    expect(syn.quotasCouts.totalCouts?.poste).toBe('TOTAL LLM 2026-07');
    expect(syn.quotasCouts.postes).toHaveLength(1);

    expect(syn.erreurs.nbJournal7j).toBe(1);
    expect(syn.erreurs.quotaGmailJournalAujourdhui).toBe(true);
    expect(syn.erreurs.nbReorgRefus).toBe(1);
  });

  it('sans Télémétrie / Réorg / Progression ni lignes Santé : aucune donnée inventée (null / inconnu / false)', () => {
    const syn = syntheseEtat({
      index: [],
      santeBrut: [['Coût LLM 2026-07 : 7.34 $  (2296 appels)']],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    }, { maintenant });

    expect(syn.moteur.fraicheur).toBe('inconnu');
    expect(syn.moteur.ageMinutes).toBeNull();
    expect(syn.moteur.progressionDisponible).toBe(false);
    expect(syn.moteur.campagnesActives).toBeNull();
    expect(syn.gmail.telemetriePresente).toBe(false);
    expect(syn.gmail.jauges.triHistoLus).toBeNull();
    expect(syn.gmail.jauges.triHisto).toBeNull();
    expect(syn.gmail.jauges.anciensLus).toBeNull();
    expect(syn.gmail.jauges.anciens).toBeNull();
    expect(syn.gmail.jauges.fondLus).toBeNull();
    expect(syn.gmail.jauges.fond).toBeNull();
    expect(syn.gmail.archivage).toEqual({ suiviIndexDisponible: false, triGmailActif: null, archivesJour: null });
    expect(syn.fileRevue.reorgDisponible).toBe(false);
    expect(syn.fileRevue.reorgPropositions).toBeNull();
    expect(syn.fileRevue.videsCandidats).toBeNull();
    expect(syn.erreurs.nbReorgRefus).toBeNull();
    // Repli Santé pour coûts quand Télémétrie absente
    expect(syn.quotasCouts.coutMoisDollars).toBe(7.34);
    expect(syn.quotasCouts.appelsMois).toBe(2296);

    const toutVide = syntheseEtat({
      index: [],
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    }, { maintenant });
    expect(toutVide.quotasCouts.coutMoisDollars).toBeNull();
    expect(toutVide.quotasCouts.appelsMois).toBeNull();
  });

  it('jeu de données mockData.ts reste cohérent avec syntheseEtat (zéro NaN, TOTAL LLM séparé)', () => {
    const syn = syntheseEtat({
      index: etatCourantIndex(interpreterIndex(plageMock('Index', 'A2:H'))),
      santeBrut: plageMock('Santé', 'A2:A'),
      journalBrut: plageMock('Journal', 'A2:D'),
      reglagesBrut: plageMock('Réglages', 'A2:B2'),
      telemetrieBrut: plageMock('Télémétrie', 'A2:D30'),
      coutsBrut: plageMock('Coûts', 'A2:D40'),
      reorgBrut: plageMock('Réorg', 'A2:H'),
    }, {
      maintenant,
      progression: interpreterProgression(plageMock('Progression', 'A2:M')),
    });

    expect(syn.moteur.compteLlm.statut).toBe('actif');
    expect(syn.moteur.triGmailSante.statut).toBe('normal');
    expect(syn.moteur.dernierePasseOk).toBe('2026-07-06 14:12');
    expect(syn.moteur.maintenanceSante.length).toBeGreaterThanOrEqual(4);
    expect(syn.gmail.jauges.triHistoLus).toBe(30);
    expect(syn.gmail.jauges.anciensLus).toBe(12);
    expect(syn.gmail.jauges.anciens).toEqual({ lus: 12, plafond: 300 });
    expect(syn.gmail.jauges.fondLus).toBe(171);
    expect(syn.gmail.jauges.fond).toEqual({ lus: 171, plafond: 300 });
    expect(syn.gmail.archivage.archivesJour).toBe(18);
    expect(syn.gmail.archivage.suiviIndexDisponible).toBe(false);
    expect(syn.quotasCouts.totalCouts?.poste).toBe('TOTAL LLM 2026-07');
    expect(syn.quotasCouts.postes.some((p) => p.poste.startsWith('TOTAL LLM'))).toBe(false);
    expect(syn.fichiers.confianceBasse).toBeGreaterThanOrEqual(1);
    expect(syn.fichiers.aVerifier).toBeGreaterThanOrEqual(1);
    expect(syn.fichiers.aTrier).toBeGreaterThanOrEqual(1);
    expect(syn.gmail.aVerifier).toBeGreaterThanOrEqual(1);
    expect(syn.gmail.erreurs).toBeGreaterThanOrEqual(1);
    expect(syn.fileRevue.reorgPropositions).toBe(1);
  });

  it('non-régression M2 : repli coût Santé sur « — », isolation suspects tri|, tickMinutes borné, marqueurs techniques exclus', () => {
    const syn = syntheseEtat({
      index: interpreterIndex([
        ['drive|doc1', '2026-07-06T12:00:00', 'Doc.pdf', '02', '02', 'classé', 'h1', '   '],
        ['tri|fil1|100|0', '2026-07-06T12:00:00', 'Suspect tri', '', '', 'suspect', '', ''],
        ['dryrunv2|r1|1', '2026-07-06T12:00:00', 'Fuite dryrun', '', '', 'suspect', '', ''],
        ['conso|c1', '2026-07-06T12:00:00', 'Plan conso', '', '', 'consolidation-plan', '', ''],
        ['consoexec|ce1', '2026-07-06T12:00:00', 'Exec conso', '', '', 'consolidé', '', ''],
        ['dryruncmp|dc1', '2026-07-06T12:00:00', 'Cmp', '', '', 'dry-run cmp', '', ''],
        ['epingle|e1', '2026-07-06T12:00:00', 'Epingle', '', '', 'épinglé', '', ''],
        ['fusion|fu1', '2026-07-06T12:00:00', 'Fusion', '', '', 'fusionné', '', ''],
      ]),
      santeBrut: [['Coût LLM 2026-07 : 7.34 $  (2296 appels)']],
      journalBrut: [],
      reglagesBrut: [['TICK_MINUTES', '-5']],
      telemetrieBrut: [
        ['llm_cout_mois', '—', '$', 'Frein campagnes à 110 $'],
        ['llm_appels_mois', '—', 'appels', ''],
      ],
      coutsBrut: [],
    }, { maintenant });

    expect(syn.quotasCouts.coutMoisDollars).toBe(7.34);
    expect(syn.quotasCouts.appelsMois).toBe(2296);
    expect(syn.gmail.suspects).toBe(1);
    expect(syn.fileRevue.suspects).toBe(1);
    expect(syn.fileRevue.total).toBe(1);
    expect(syn.moteur.tickMinutes).toBe(5);
    expect(syn.fichiers.total).toBe(1);
    expect(syn.fichiers.autres).toBe(0);
    expect(syn.fichiers.confianceBasse).toBe(0);

    for (const mauvaisTick of ['0', 'NaN', 'Infinity', '']) {
      const sTick = syntheseEtat({
        index: [],
        santeBrut: [],
        journalBrut: [],
        reglagesBrut: [['TICK_MINUTES', mauvaisTick]],
        telemetrieBrut: [],
        coutsBrut: [],
      }, { maintenant });
      expect(sTick.moteur.tickMinutes).toBe(5);
    }

    const sTickValide = syntheseEtat({
      index: [],
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [['TICK_MINUTES', '15']],
      telemetrieBrut: [],
      coutsBrut: [],
    }, { maintenant });
    expect(sTickValide.moteur.tickMinutes).toBe(15);
  });
});

describe('durcissement Tier 5 : valeurs corrompues, Infinity, virgules FR et isolation suspects', () => {
  it('BUG-3 : lignesSuspects exclut dryrunv2| et toute clé hors tri|', () => {
    const lignes = interpreterIndex([
      ['dryrunv2|r1|1', '2026-07-06 12:00', 'Fuite dryrun', '', '', 'suspect'],
      ['drive|f1', '2026-07-06 12:01', 'Doc.pdf', '', '', 'suspect'],
      ['tri|f1|100|0', '2026-07-06 12:02', 'Fil suspect 1', '', '', 'suspect'],
      ['tri|f2|200|0', '2026-07-06 12:03', 'Fil suspect 2', '', '', 'suspect'],
    ]);
    expect(lignesSuspects(lignes).map((l) => l.cle)).toEqual(['tri|f2|200|0', 'tri|f1|100|0']);
  });

  it('BUG-5 : coutDepuisSante rejette un montant malformé (« 1..2 ») au lieu de fuiter NaN', () => {
    expect(coutDepuisSante(['Coût LLM 2026-07 : 1..2 $ (10 appels)'])).toBeNull();
    expect(coutDepuisSante(['Coût LLM 2026-07 : ... $ (10 appels)'])).toBeNull();
    expect(coutDepuisSante([
      'Coût LLM 2026-07 : 1..2 $ (10 appels)',
      'Coût LLM 2026-07 : 4,50 $ (12 appels)',
    ])).toEqual({ dollars: 4.5, appels: 12 });
  });

  it('BUG-6 : interpreterProgression, interpreterTelemetrie et interpreterCoutsResume rejettent Infinity/blancs et tolèrent la virgule FR', () => {
    const prog = interpreterProgression([
      ['m1', 'Migration', 'Infinity', '   ', 'documents', 'en cours', ''],
      ['m2', 'Re-analyse', '10', 'Infinity', 'documents', 'en cours', ''],
      ['m3', 'Tri', '5', 'abc', 'fils', 'en cours', ''],
      ['m4', 'Virgule', '12,5', '100', 'documents', 'en cours', ''],
    ]);
    expect(prog[0]).toMatchObject({ cle: 'm1', traites: 0, base: null });
    expect(prog[1]).toMatchObject({ cle: 'm2', traites: 10, base: null });
    expect(prog[2]).toMatchObject({ cle: 'm3', traites: 5, base: null });
    expect(prog[3]).toMatchObject({ cle: 'm4', traites: 12.5, base: 100 });

    const tele = interpreterTelemetrie([
      ['tri_cyclique_fils_jour', '12,5', 'fils', 'Plafond 150/j'],
      ['tri_boite_fils_jour', 'Infinity', 'fils', 'Plafond 150/j'],
      ['tri_histo_fils_jour', '12,5', 'fils', 'Plafond 150/j'],
    ]);
    expect(tele.cycliqueJour).toEqual({ lus: 12.5, plafond: 150 });
    expect(tele.boiteJour).toEqual({ lus: 0, plafond: 150 });
    expect(tele.triHistoFilsJour).toBe(12.5);

    const couts = interpreterCoutsResume([
      ['poste-inf', 'Infinity', 'Infinity', 'Infinity %'],
    ]);
    expect(couts.postes).toEqual([{ poste: 'poste-inf', appels: 0, dollars: 0, part: 0 }]);
  });

  it('bords syntheseEtat & cleEtatIndex : tri| sans segment et options.reorg sans ligne demande', () => {
    expect(cleEtatIndex('tri|')).toBe('tri|');
    const syn = syntheseEtat({
      index: [],
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    }, {
      maintenant: new Date('2026-07-06T12:00:00Z'),
      reorg: [
        {
          ligneSheet: 2,
          cle: 'chatreorg|2026-07-06|1',
          type: 'deplacer',
          id: 'd1',
          cheminActuel: 'A',
          cheminPropose: 'B',
          statut: 'proposé',
          detail: 'proposition chat',
          horodate: '2026-07-06T11:00:00Z',
        },
        {
          ligneSheet: 3,
          cle: 'chatreorg|2026-07-06|2',
          type: 'deplacer',
          id: 'd2',
          cheminActuel: 'C',
          cheminPropose: 'D',
          statut: 'refusé (zone protégée)',
          detail: 'protégé',
          horodate: '2026-07-06T11:05:00Z',
        },
      ],
    });
    expect(syn.fileRevue.reorgDisponible).toBe(true);
    expect(syn.fileRevue.reorgPropositions).toBe(1);
    expect(syn.fileRevue.reorgRefus).toBe(1);
  });
});

import { t, type CleTexte } from '../src/i18n';

describe('P0-4 Télémétrie : archivesJour, anciensJour, fondJour (zéro 0 inventé)', () => {
  it('lit directement tri_archives_jour, tri_anciens_fils_jour et tri_fond_fils_jour', () => {
    const tele = interpreterTelemetrie([
      ['tri_cyclique_fils_jour', '84', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_boite_fils_jour', '45', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_histo_fils_jour', '30', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_anciens_fils_jour', '12', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_fond_fils_jour', '171', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_archives_jour', '18', 'fils/jour', 'Fils archivés par le moteur aujourd’hui'],
    ]);
    expect(tele.archivesJour).toBe(18);
    expect(tele.anciensFilsJour).toBe(12);
    expect(tele.anciensJour).toEqual({ lus: 12, plafond: 300 });
    expect(tele.fondFilsJour).toBe(171);
    expect(tele.fondJour).toEqual({ lus: 171, plafond: 300 });
  });

  it('calcule la somme consolidée de repli si tri_fond_fils_jour est absent et >= 1 composante est numérique', () => {
    const tele = interpreterTelemetrie([
      ['tri_cyclique_fils_jour', '40', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_anciens_fils_jour', '15', 'fils/jour', 'Plafond commun 300/j'],
    ]);
    expect(tele.fondFilsJour).toBe(55);
    expect(tele.fondJour).toEqual({ lus: 55, plafond: 300 });
    expect(tele.archivesJour).toBeNull();
  });

  it('n’invente jamais 0 si les clés sont absentes ou non numériques (— / n/a / zéro)', () => {
    const vide = interpreterTelemetrie([]);
    expect(vide.archivesJour).toBeNull();
    expect(vide.anciensFilsJour).toBeNull();
    expect(vide.anciensJour).toBeNull();
    expect(vide.fondFilsJour).toBeNull();
    expect(vide.fondJour).toBeNull();

    const sansFond = interpreterTelemetrie([
      ['quota_gmail_etat', 'actif', '', ''],
      ['tri_cyclique_fils_jour', 'zéro', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_anciens_fils_jour', '—', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_archives_jour', 'n/a', 'fils/jour', ''],
    ]);
    expect(sansFond.archivesJour).toBeNull();
    expect(sansFond.anciensFilsJour).toBeNull();
    expect(sansFond.anciensJour).toBeNull();
    expect(sansFond.fondFilsJour).toBeNull();
    expect(sansFond.fondJour).toBeNull();

    const fondInvalide = interpreterTelemetrie([
      ['tri_cyclique_fils_jour', '10', 'fils/jour', 'Plafond commun 300/j'],
      ['tri_fond_fils_jour', '—', 'fils/jour', 'Plafond commun 300/j'],
    ]);
    expect(fondInvalide.fondFilsJour).toBeNull();
    expect(fondInvalide.fondJour).toBeNull();
  });
});

describe('i18n R4 — parité FR/EN et jetons des 39 nouvelles clés', () => {
  const CLES_R4: CleTexte[] = [
    'rechercheRapide',
    'omniboxTitre',
    'omniboxPlaceholder',
    'omniboxIndice',
    'omniboxEcrans',
    'omniboxResultatsDrive',
    'omniboxOuvrirDossier',
    'etat',
    'sousTitreEtat',
    'sousTitrePreferences',
    'reorgAccueilLibelle',
    'videsAccueilLibelle',
    'voirDansDocuments',
    'triArchivesJour',
    'jaugeAnciensLus',
    'jaugeFondTri',
    'archivageMesureNote',
    'filtresRapides',
    'filtreTout',
    'filtreDossiers',
    'filtrePdf',
    'filtreAVerifier',
    'filtreConfianceBasse',
    'dossierParent',
    'arianeApproximatif',
    'copierLien',
    'lienCopie',
    'lienCopieEchec',
    'dossierCreeOk',
    'badgeIndexClasse',
    'badgeIndexATrier',
    'badgeIndexAVerifier',
    'badgeIndexDoublon',
    'badgeIndexManuel',
    'badgeIndexQuarantaine',
    'badgeIndexConfianceBasse',
    'themeLibelle',
    'themeSombre',
    'themeClair',
  ];

  it('toutes les clés R4 sont non vides en FR et EN et préservent les jetons {n} et {nom}', () => {
    expect(CLES_R4).toHaveLength(39);
    for (const cle of CLES_R4) {
      expect(t(cle, 'fr').trim().length, `fr.${cle}`).toBeGreaterThan(0);
      expect(t(cle, 'en').trim().length, `en.${cle}`).toBeGreaterThan(0);
    }
    expect(t('reorgAccueilLibelle', 'fr')).toContain('{n}');
    expect(t('reorgAccueilLibelle', 'en')).toContain('{n}');
    expect(t('videsAccueilLibelle', 'fr')).toContain('{n}');
    expect(t('videsAccueilLibelle', 'en')).toContain('{n}');
    expect(t('dossierCreeOk', 'fr')).toContain('{nom}');
    expect(t('dossierCreeOk', 'en')).toContain('{nom}');
    expect(t('sousTitreReglages', 'fr').trim().length).toBeGreaterThan(0);
  });

  it('formaterAgeMinutes et nettoyerDetailSante (refonte État)', () => {
    expect(formaterAgeMinutes(-5, 'fr')).toBe('il y a 0 min');
    expect(formaterAgeMinutes(12, 'fr')).toBe('il y a 12 min');
    expect(formaterAgeMinutes(12, 'en')).toBe('12 min ago');
    expect(formaterAgeMinutes(125, 'fr')).toBe('il y a 2 h');
    expect(formaterAgeMinutes(125, 'en')).toBe('2 h ago');
    expect(formaterAgeMinutes(3000, 'fr')).toBe('il y a 2 j');
    expect(formaterAgeMinutes(3000, 'en')).toBe('2 d ago');
    expect(formaterAgeMinutes(Number.NaN, 'fr')).toBe('il y a 0 min');

    expect(nettoyerDetailSante('')).toBe('');
    expect(nettoyerDetailSante('✅ normal (libellés + archivage)')).toBe('normal (libellés + archivage)');
    expect(nettoyerDetailSante('⛔  À L’ARRÊT   ⚠️')).toBe('À L’ARRÊT');
    expect(nettoyerDetailSante('terminée ⏳  (2026-07-05)')).toBe('terminée (2026-07-05)');
  });

  it('ADR-0081 (vague 2c) : brouillon|<id> exclu de la synthèse documents et grouperErreursJournal regroupe les occurrences identiques', () => {
    expect(CLE_NON_DOCUMENT_SYNTHESE.test('brouillon|M1')).toBe(true);
    const syn = syntheseEtat({
      index: [
        { cle: 'drive|d1', traiteLe: '2026-11-23T12:00:00', fichier: 'Doc.pdf', domaine: '02', chemin: '02', statut: 'classé', confiance: '0.9' },
        { cle: 'brouillon|M1', traiteLe: '2026-11-23T12:01:00', fichier: 'Sujet', domaine: 'Administration', chemin: '', statut: 'brouillon', confiance: '' },
      ],
      santeBrut: [],
      journalBrut: [],
      reglagesBrut: [],
      telemetrieBrut: [],
      coutsBrut: [],
    });
    expect(syn.fichiers.classe).toBe(1);

    const groupes = grouperErreursJournal([
      { date: '11/20/2026 00:16:38', niveau: 'ERREUR', source: 'TriGmail', message: 'Réponse tri tronquée' },
      { date: '11/20/2026 01:00:00', niveau: 'ERREUR', source: 'OCR', message: 'Autre erreur' },
      { date: '11/21/2026 00:11:30', niveau: 'ERREUR', source: 'TriGmail', message: 'Réponse tri tronquée' },
    ]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0].derniere.date).toBe('11/21/2026 00:11:30');
    expect(groupes[0].occurrences).toBe(2);
    expect(groupes[0].cles).toHaveLength(2);
    expect(groupes[1].derniere.source).toBe('OCR');
    expect(groupes[1].occurrences).toBe(1);
  });

  it('ADR-0081 (vague 3b) : interpreterActions trie du plus récent au plus ancien, filtre IDs invalides, expose annulable et annulerActionMoteur', async () => {
    const actions = interpreterActions([
      ['mauvais-id', '2026-11-23', 'drive-deplacer', 'F0', '', '', 'appliqué', ''],
      ['act-100001', '2026-11-23 15:00:00', 'gmail-libelle', 'Voyages', '', 'Voyages', 'appliqué', 'Libellé créé'],
      ['act-100002', '2026-11-23 15:05:00', 'drive-deplacer', 'F1', '{"parentId":"A","nom":"brut.pdf"}', '{"parentId":"B","nom":"2026-11-23_Facture.pdf"}', 'annulé', 'Classement'],
      ['act-100003', '2026-11-23 15:10:00', 'drive-renommer', 'F2', '{"nom":"ancien.pdf"}', '{"nom":"nouveau.pdf"}', 'appliqué', 'Renommage'],
      ['act-100004', '2026-11-23 15:12:00', 'drive-deplacer', 'F3', '{"parentId":"A","nom":"scan.pdf"}', 'json-invalide', 'appliqué', 'Détail secours'],
    ]);
    expect(actions.map((a) => a.id)).toEqual(['act-100004', 'act-100003', 'act-100002', 'act-100001']);
    expect(actions[0].annulable).toBe(true);
    expect(actions[0].resume).toBe('scan.pdf');
    expect(actions[1].annulable).toBe(true);
    expect(actions[1].resume).toBe('nouveau.pdf');
    expect(actions[2].annulable).toBe(false);
    expect(actions[3].annulable).toBe(false);
    expect(actions[3].resume).toBe('Voyages');

    const { chargerConfigServeur } = await import('../src/config');
    const { annulerActionMoteur } = await import('../src/google');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        spreadsheetId: 's',
        webappUrl: 'https://script.google.com/macros/s/X/exec',
        webappSecret: 'sec',
      }),
    })));
    await chargerConfigServeur();
    const faux = vi.fn<typeof fetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: 'Action annulée.' }),
    }) as unknown as Response);
    vi.stubGlobal('fetch', faux);
    expect(await annulerActionMoteur('act-100003')).toBe('Action annulée.');
    expect(String(faux.mock.calls[0]?.[0])).toContain('action=annuler-action');
    vi.unstubAllGlobals();
  });
});
