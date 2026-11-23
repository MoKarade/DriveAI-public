/**
 * Explorateur.tsx — DOCUMENTS v7 (C28-82 PR2, ADR-0051) : UNE recherche, des dossiers en liste.
 * Le champ unique cherche dans Drive par nom OU contenu (`rechercherDrive`, index natif de Drive —
 * DriveAI ne stocke aucun corps). Les deux sous-onglets de la v6 (« Drive » / « Recherche
 * DriveAI » avec ses filtres domaine / année / statut / confiance) disparaissent — Marc, 09/09 :
 * « quelques boutons simples, moins de déchets ». Reste : navigation par dossiers (fil d'Ariane),
 * création rapide de dossier (« + »), déplacement MANUEL d'un fichier (glisser-déposer à la souris,
 * « Déplacer → Déposer ici » au doigt). Plus de bouton IA ici (LIA retirée par l'ADR-0074). Nom conservé,
 * verdict garde-fous `deplacementSeul` (zone protégée inconditionnelle). Aucune suppression nulle part.
 */

import { useEffect, useRef, useState } from 'react';
import {
  listerEnfants,
  rechercherDrive,
  creerDossier,
  deplacerFichierManuel,
  libelleParentEnCache,
  resoudreCheminDossier,
  type CheminDossierResolu,
  OptionsRechercheDrive,
  PageDrive,
} from '../google';
import {
  ElementDrive,
  Etape,
  FILTRES_EXPLORATEUR,
  FiltreExplorateur,
  estDossier,
  filtrerElementsDrive,
  trierElements,
  pousserEtape,
  couperA,
  formaterTaille,
  formaterDateCourte,
} from '../explorateur';
import { estConfianceBasse, indexParFileId, type LigneIndex } from '../etat';
import { useEtatGlobal } from '../etatGlobal';
import type { CibleNavigationExplorateur } from '../navigation';
import { Icone } from '../composants/Icone';
import { BanniereErreur, EntetePage } from '../composants/UI';
import { CleTexte, Langue, t } from '../i18n';

export interface NavigationExplorateurDemandee {
  cible: CibleNavigationExplorateur;
  jeton: number;
}

const CLES_FILTRE: Record<FiltreExplorateur, CleTexte> = {
  tout: 'filtreTout',
  dossiers: 'filtreDossiers',
  pdf: 'filtrePdf',
  'a-verifier': 'filtreAVerifier',
  'confiance-basse': 'filtreConfianceBasse',
};

type ClassePastilleIndex = 'ok' | 'cat' | 'attn' | 'crit' | 'douce';

interface PastilleIndex {
  libelle: string;
  classe: ClassePastilleIndex;
}

function pastillesIndex(ligne: LigneIndex | undefined, langue: Langue): PastilleIndex[] {
  if (!ligne) return [];
  const out: PastilleIndex[] = [];
  const statut = ligne.statut.trim();
  switch (statut) {
    case 'classé':
      out.push({ libelle: t('badgeIndexClasse', langue), classe: 'ok' });
      break;
    case 'à trier':
      out.push({ libelle: t('badgeIndexATrier', langue), classe: 'cat' });
      break;
    case 'à vérifier':
      out.push({ libelle: t('badgeIndexAVerifier', langue), classe: 'attn' });
      break;
    case 'doublon':
      out.push({ libelle: t('badgeIndexDoublon', langue), classe: 'douce' });
      break;
    case 'manuel':
      out.push({ libelle: t('badgeIndexManuel', langue), classe: 'cat' });
      break;
    case 'quarantaine':
      out.push({ libelle: t('badgeIndexQuarantaine', langue), classe: 'crit' });
      break;
    case 'technique':
      out.push({ libelle: t('badgeIndexTechnique', langue), classe: 'douce' });
      break;
    case 'erreur':
      out.push({ libelle: t('badgeIndexErreur', langue), classe: 'crit' });
      break;
    case 'média':
      out.push({ libelle: t('badgeIndexMedia', langue), classe: 'douce' });
      break;
    default:
      if (statut) out.push({ libelle: statut, classe: 'douce' });
      break;
  }
  if (estConfianceBasse(ligne)) {
    out.push({ libelle: t('badgeIndexConfianceBasse', langue), classe: 'attn' });
  }
  return out;
}

// Type MIME PROPRIÉTAIRE : un drag venu d'ailleurs (autre onglet, autre app) est structurellement
// invisible — seul un drag démarré ICI porte ce type.
const TYPE_DRAG = 'application/x-driveai-fichier';

export type PorteeRecherche = 'dossier' | 'tout';

export function porteeParDefaut(dossierId: string): PorteeRecherche {
  return dossierId === 'root' ? 'tout' : 'dossier';
}

export function estRechercheScopee(dossierId: string, portee: PorteeRecherche): boolean {
  return dossierId !== 'root' && portee === 'dossier';
}

export function optionsRecherchePourPortee(
  dossierId: string,
  portee: PorteeRecherche,
): OptionsRechercheDrive | undefined {
  return estRechercheScopee(dossierId, portee) ? { dossierId } : undefined;
}

export function cleTroncatureRecherche(scopee: boolean): 'resultatsIncomplets' | 'resultatsTronques' {
  return scopee ? 'resultatsIncomplets' : 'resultatsTronques';
}

export function clePlaceholderRecherche(
  scopee: boolean,
): 'rechercherDansDossierPlaceholder' | 'rechercherPlaceholder' {
  return scopee ? 'rechercherDansDossierPlaceholder' : 'rechercherPlaceholder';
}

export function Explorateur({
  langue,
  cibleExplorateur,
  onCibleConsommee,
}: {
  langue: Langue;
  cibleExplorateur?: NavigationExplorateurDemandee | null;
  onCibleConsommee?: (jeton: number) => void;
}) {
  const { donnees } = useEtatGlobal();
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const [ariane, setAriane] = useState<Etape[]>([{ id: 'root', nom: t('monDrive', langue) }]);
  const [arianeApproximatif, setArianeApproximatif] = useState(false);
  const [elements, setElements] = useState<ElementDrive[]>([]);
  const [suivant, setSuivant] = useState<string | undefined>();
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const [rafraichir, setRafraichir] = useState(0); // re-liste le dossier courant après une écriture
  const [enChargementPlus, setEnChargementPlus] = useState(false);

  // Recherche unique : scopée au dossier courant par défaut dans un sous-dossier, globale à la racine.
  const [texte, setTexte] = useState('');
  const [portee, setPortee] = useState<PorteeRecherche>('tout');
  const [filtre, setFiltre] = useState<FiltreExplorateur>('tout');
  const [resultats, setResultats] = useState<ElementDrive[] | null>(null);
  const [tronque, setTronque] = useState(false);         // la page Drive (50) ou collecte BFS n'a pas tout rendu
  const [requeteLancee, setRequeteLancee] = useState(''); // ce qui a VRAIMENT été cherché (la saisie peut avoir changé depuis)
  const [enCours, setEnCours] = useState(false);
  const idRequeteRef = useRef(0);
  const requeteEnCoursRef = useRef('');
  const idListingRef = useRef(0);
  const idNavArianeRef = useRef(0);
  const demonteRef = useRef(false);

  // Création de dossier, déplacement, copie de lien.
  const [creation, setCreation] = useState<'' | 'ouvert' | 'encours'>('');
  const [nomDossier, setNomDossier] = useState('');
  const [dossierCree, setDossierCree] = useState('');
  const [aDeplacer, setADeplacer] = useState<ElementDrive | null>(null); // mode « Déplacer → Déposer ici »
  const [survolDepot, setSurvolDepot] = useState(''); // id du dossier survolé pendant un drag
  const [statutDepot, setStatutDepot] = useState(''); // '' | 'ok:…'
  const [depotEnCours, setDepotEnCours] = useState(false); // déplacement en cours : bouton grisé
  const [lienCopieId, setLienCopieId] = useState('');
  const [erreurCopie, setErreurCopie] = useState(false);
  const minuteurCopieRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minuteurCreationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dossier = ariane[ariane.length - 1];
  const scopee = estRechercheScopee(dossier.id, portee);

  useEffect(() => {
    demonteRef.current = false;
    return () => {
      demonteRef.current = true;
      idNavArianeRef.current += 1;
      if (minuteurCopieRef.current !== null) {
        clearTimeout(minuteurCopieRef.current);
        minuteurCopieRef.current = null;
      }
      if (minuteurCreationRef.current !== null) {
        clearTimeout(minuteurCreationRef.current);
        minuteurCreationRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // L'ancien listing (et SURTOUT son pageToken, lié à sa requête d'origine) est purgé tout de
    // suite ; `actif` et `idListingRef` neutralisent une réponse (initiale ou chargerPlus) arrivée
    // après un changement de dossier ou un rafraîchissement plus rapide.
    let actif = true;
    idListingRef.current += 1;
    setEnChargementPlus(false);
    setElements([]);
    setSuivant(undefined);
    setCharge(false);
    setErreur('');
    (async () => {
      try {
        const page = await listerEnfants(dossier.id);
        if (!actif) return;
        setElements(trierElements(page.elements));
        setSuivant(page.suivant);
        setCharge(true);
      } catch (e) {
        if (actif) setErreur(String(e));
      }
    })();
    return () => { actif = false; };
  }, [dossier.id, rafraichir]);

  async function chargerPlus() {
    if (!suivant || enChargementPlus) return;
    const epoch = idListingRef.current;
    setEnChargementPlus(true);
    try {
      const page: PageDrive = await listerEnfants(dossier.id, suivant);
      if (epoch !== idListingRef.current) return;
      setElements((xs) => trierElements([...xs, ...page.elements]));
      setSuivant(page.suivant);
    } catch (e) {
      if (epoch !== idListingRef.current) return;
      setErreur(String(e));
    } finally {
      if (epoch === idListingRef.current) setEnChargementPlus(false);
    }
  }

  /** Recherche Drive par nom ou contenu (index natif Google), scopée au dossier ou sur tout le Drive. */
  async function chercher(requete = texte, porteeCible = portee, forcer = false) {
    const propre = requete.trim();
    if (!propre) return;
    if (!forcer && enCours) return; // deux Entrée rapides = une seule recherche
    const reqId = ++idRequeteRef.current;
    requeteEnCoursRef.current = propre;
    setEnCours(true);
    setErreur('');
    try {
      const r = await rechercherDrive(propre, optionsRecherchePourPortee(dossier.id, porteeCible));
      if (reqId !== idRequeteRef.current) return;
      setResultats(r.elements);
      setTronque(r.tronque);
      setRequeteLancee(propre);
    } catch (e) {
      if (reqId !== idRequeteRef.current) return;
      setErreur(String(e));
    } finally {
      if (reqId === idRequeteRef.current) {
        setEnCours(false);
        requeteEnCoursRef.current = '';
      }
    }
  }

  function effacerRecherche(garderTexte = false, reinitialiserFiltre = false) {
    idRequeteRef.current += 1;
    requeteEnCoursRef.current = '';
    setEnCours(false);
    if (!garderTexte) setTexte('');
    setResultats(null);
    setTronque(false);
    setRequeteLancee('');
    if (reinitialiserFiltre) setFiltre('tout');
  }

  async function naviguerVersDossierExact(
    cible: CibleNavigationExplorateur,
    onTermine?: () => void,
  ) {
    const navId = ++idNavArianeRef.current;
    effacerRecherche(false, true);
    setCreation('');
    setADeplacer(null);
    setSurvolDepot('');
    setArianeApproximatif(false);
    setPortee(porteeParDefaut(cible.id));

    const racine: Etape = { id: 'root', nom: t('monDrive', langue) };
    const provisoire: Etape[] = cible.id === 'root'
      ? [racine]
      : [racine, { id: cible.id, nom: cible.nom }];
    setAriane(provisoire);

    try {
      const chemin: CheminDossierResolu = await resoudreCheminDossier(
        { id: cible.id, nom: cible.nom, parents: cible.parents },
        { nomRacine: t('monDrive', langue) },
      );
      if (demonteRef.current || navId !== idNavArianeRef.current) return;
      setAriane(chemin.etapes);
      setArianeApproximatif(chemin.approximatif);
    } catch {
      if (demonteRef.current || navId !== idNavArianeRef.current) return;
      setAriane(provisoire);
      setArianeApproximatif(true);
    } finally {
      if (!demonteRef.current && navId === idNavArianeRef.current) {
        onTermine?.();
      }
    }
  }

  useEffect(() => {
    if (!cibleExplorateur) return;
    let actif = true;
    const { cible, jeton } = cibleExplorateur;
    void naviguerVersDossierExact(cible, () => {
      if (actif) onCibleConsommee?.(jeton);
    });
    return () => {
      actif = false;
      idNavArianeRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché uniquement sur un nouveau jeton de navigation
  }, [cibleExplorateur?.jeton]);

  function ouvrirDossier(e: ElementDrive) {
    if (resultats !== null) {
      void naviguerVersDossierExact({ id: e.id, nom: e.name, parents: e.parents });
      return;
    }
    idNavArianeRef.current += 1;
    effacerRecherche(false, true);
    setArianeApproximatif(false);
    setPortee(porteeParDefaut(e.id));
    setAriane((a) => pousserEtape(a, { id: e.id, nom: e.name }));
  }

  function allerEtape(id: string) {
    idNavArianeRef.current += 1;
    effacerRecherche(false, true);
    setArianeApproximatif(false);
    setPortee(porteeParDefaut(id));
    setAriane((a) => couperA(a, id));
  }

  function changerPortee(nouvelle: PorteeRecherche) {
    if (nouvelle === portee) return;
    setPortee(nouvelle);
    if (resultats !== null || requeteLancee !== '' || enCours) {
      const active = (requeteEnCoursRef.current || requeteLancee || texte).trim();
      if (active) {
        void chercher(requeteEnCoursRef.current || requeteLancee || texte, nouvelle, true);
      } else {
        effacerRecherche(true);
      }
    }
  }

  async function creer() {
    const nom = nomDossier.trim();
    if (!nom || creation === 'encours') return;
    setCreation('encours');
    setErreur('');
    setDossierCree('');
    if (minuteurCreationRef.current !== null) {
      clearTimeout(minuteurCreationRef.current);
      minuteurCreationRef.current = null;
    }
    try {
      const cree = await creerDossier(nom, dossier.id);
      if (demonteRef.current) return;
      setNomDossier('');
      setCreation('');
      setDossierCree(cree?.name || nom);
      minuteurCreationRef.current = setTimeout(() => {
        minuteurCreationRef.current = null;
        if (!demonteRef.current) setDossierCree('');
      }, 4000);
      setRafraichir((n) => n + 1);
    } catch (e) {
      if (!demonteRef.current) {
        setErreur(String(e));
        setCreation('ouvert');
      }
    }
  }

  async function copierLien(e: ElementDrive) {
    if (minuteurCopieRef.current !== null) {
      clearTimeout(minuteurCopieRef.current);
      minuteurCopieRef.current = null;
    }
    setErreurCopie(false);
    const lien = e.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(e.id)}/view`;
    try {
      const pressePapier = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!pressePapier || typeof pressePapier.writeText !== 'function') {
        throw new Error('clipboard-indisponible');
      }
      await pressePapier.writeText(lien);
      if (demonteRef.current) return;
      setLienCopieId(e.id);
      minuteurCopieRef.current = setTimeout(() => {
        minuteurCopieRef.current = null;
        if (!demonteRef.current) setLienCopieId('');
      }, 2500);
    } catch {
      if (demonteRef.current) return;
      setLienCopieId('');
      setErreurCopie(true);
      minuteurCopieRef.current = setTimeout(() => {
        minuteurCopieRef.current = null;
        if (!demonteRef.current) setErreurCopie(false);
      }, 4000);
    }
  }

  /** Déplace `fichier` vers `cible` (drag-and-drop OU mode « Déposer ici »). */
  async function deposer(fichier: ElementDrive, cibleId: string, cibleNom: string) {
    if (depotEnCours) return; // un seul déplacement à la fois
    setDepotEnCours(true);
    setStatutDepot('');
    setErreur('');
    try {
      const deplace = await deplacerFichierManuel({ fileId: fichier.id, nouveauParent: cibleId, nomCible: cibleNom });
      setADeplacer(null);
      if (!deplace) return; // déjà en place — rien à annoncer, rien à rafraîchir
      setStatutDepot(`ok:${fichier.name} → ${cibleNom}`);
      effacerRecherche(false);
      setRafraichir((n) => n + 1);
    } catch (e) {
      setErreur(String(e)); // dans le bandeau d'erreur (message simple)
    } finally {
      setDepotEnCours(false);
    }
  }

  function surDragStart(ev: React.DragEvent, e: ElementDrive) {
    // La ligne porte un LIEN : sans ça le navigateur y met `text/uri-list` et un dépôt manqué
    // (hors dossier) NAVIGUE vers le fichier Drive (revue flotte PR 2).
    ev.dataTransfer.clearData();
    ev.dataTransfer.setData(TYPE_DRAG, JSON.stringify({ id: e.id, name: e.name }));
    ev.dataTransfer.effectAllowed = 'move';
  }

  function surDrop(ev: React.DragEvent, cible: ElementDrive | Etape) {
    ev.preventDefault();
    setSurvolDepot('');
    try {
      const brut = ev.dataTransfer.getData(TYPE_DRAG);
      if (!brut) return;
      const { id, name } = JSON.parse(brut) as { id: string; name: string };
      if (typeof id !== 'string' || !id) return;
      const cibleId = cible.id;
      const cibleNom = 'nom' in cible ? cible.nom : cible.name;
      if (id === cibleId) return;
      void deposer({ id, name, mimeType: '' }, cibleId, cibleNom);
    } catch {
      /* payload étranger malformé : ignoré */
    }
  }

  /** Cible de dépôt (dossier ou étape de l'Ariane) : les mêmes trois gestionnaires partout. */
  function propsDepot(cible: ElementDrive | Etape) {
    return {
      onDragOver: (ev: React.DragEvent) => { ev.preventDefault(); setSurvolDepot(cible.id); },
      onDragLeave: () => setSurvolDepot(''),
      onDrop: (ev: React.DragEvent) => surDrop(ev, cible),
    };
  }

  const indexParId = indexParFileId(donnees?.index ?? []);
  const sourceAffichee = resultats ?? elements;
  const affiches = filtrerElementsDrive(sourceAffichee, filtre, indexParId);
  const nomRacine = t('monDrive', langue);
  const nomsAriane = resultats !== null
    ? new Map(ariane.filter((a) => a.id !== 'root').map((a) => [a.id, a.nom]))
    : undefined;

  return (
    <div className="documents">
      <EntetePage
        etiquette="DriveAI"
        titre={t('documents', langue)}
        sousTitre={t('sousTitreDocuments', langue)}
        actions={(
          <button
            className="icone-bouton"
            aria-label={t('nouveauDossier', langue)}
            title={t('nouveauDossier', langue)}
            onClick={() => setCreation((c) => (c === '' ? 'ouvert' : ''))}
          >
            <Icone nom="plus" />
          </button>
        )}
      />

      <form className="recherche gf-omnibox-pill" onSubmit={(e) => { e.preventDefault(); void chercher(); }}>
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={t(clePlaceholderRecherche(scopee), langue)}
          aria-label={t('rechercher', langue)}
          enterKeyHint="search"
        />
        {texte && (
          <button type="button" className="icone-bouton petit recherche-effacer" aria-label={t('effacer', langue)} onClick={() => effacerRecherche(false, true)}>
            <Icone nom="fermer" />
          </button>
        )}
        <button
          type="submit"
          className="recherche-soumettre"
          aria-label={t('rechercher', langue)}
          title={t('rechercher', langue)}
          disabled={!texte.trim() || enCours}
        >
          <Icone nom="recherche" />
        </button>
      </form>

      {dossier.id !== 'root' && (
        <div className="portee-bascule gf-subtab-bar" role="group" aria-label={t('porteeRecherche', langue)}>
          <button
            type="button"
            className={`pilule-portee gf-subtab-pill ${portee === 'dossier' ? 'actif gf-subtab-pill-active' : ''}`}
            aria-pressed={portee === 'dossier'}
            onClick={() => changerPortee('dossier')}
          >
            <span className="portee-texte">{t('porteeDossierNom', langue).replace('{nom}', dossier.nom)}</span>
          </button>
          <button
            type="button"
            className={`pilule-portee gf-subtab-pill ${portee === 'tout' ? 'actif gf-subtab-pill-active' : ''}`}
            aria-pressed={portee === 'tout'}
            onClick={() => changerPortee('tout')}
          >
            {t('porteeToutDrive', langue)}
          </button>
        </div>
      )}

      <div className="filtres-rapides gf-chips" role="group" aria-label={t('filtresRapides', langue)}>
        {FILTRES_EXPLORATEUR.map((f) => (
          <button
            key={f}
            type="button"
            className={`gf-chip${filtre === f ? ' actif' : ''}`}
            aria-pressed={filtre === f}
            onClick={() => setFiltre(f)}
          >
            {t(CLES_FILTRE[f], langue)}
          </button>
        ))}
      </div>

      {creation !== '' && (
        <div className="ligne-formulaire creation-dossier">
          <input
            autoFocus
            value={nomDossier}
            onChange={(e) => setNomDossier(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void creer();
              if (e.key === 'Escape') { setCreation(''); setNomDossier(''); }
            }}
            placeholder={t('nomDossierPlaceholder', langue)}
            aria-label={t('nouveauDossier', langue)}
          />
          <button onClick={() => void creer()} disabled={!nomDossier.trim() || creation === 'encours'}>
            {creation === 'encours' ? t('chargement', langue) : t('creerBouton', langue)}
          </button>
          <button className="discret icone-bouton" onClick={() => { setCreation(''); setNomDossier(''); }} aria-label={t('annulerBouton', langue)}>
            <Icone nom="fermer" />
          </button>
        </div>
      )}

      {aDeplacer && (
        <p className="bandeau-deplacement">
          <Icone nom="deplacer" /> <b>{aDeplacer.name}</b>
          <span className="sp" />
          <button disabled={depotEnCours} onClick={() => void deposer(aDeplacer, dossier.id, dossier.nom)}>
            {depotEnCours ? t('chargement', langue) : `${t('deposerIci', langue)} · ${dossier.nom}`}
          </button>
          <button className="discret" onClick={() => setADeplacer(null)}>{t('annulerBouton', langue)}</button>
        </p>
      )}
      {statutDepot.startsWith('ok:') && (
        <p className="ok icone-ligne"><Icone nom="coche" /> {t('deplaceOk', langue)} : {statutDepot.slice(3)}</p>
      )}
      {dossierCree && (
        <p className="ok bandeau-ok icone-ligne" role="status">
          <Icone nom="coche" /> {t('dossierCreeOk', langue).replace('{nom}', dossierCree)}
        </p>
      )}
      {erreurCopie && (
        <p className="variante erreur" role="status">{t('lienCopieEchec', langue)}</p>
      )}
      <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => setRafraichir((n) => n + 1)} />

      <div className="ariane">
        <nav className="ariane-fil" aria-label={t('cheminAriane', langue)}>
          {ariane.map((e, i) => (
            <span key={e.id} className="ariane-etape">
              {i > 0 && <span className="ariane-sep" aria-hidden="true">›</span>}
              {i === ariane.length - 1 ? (
                <b className={survolDepot === e.id ? 'depot-survol' : ''} {...propsDepot(e)}>{e.nom}</b>
              ) : (
                <button
                  type="button"
                  className={`discret ${survolDepot === e.id ? 'depot-survol' : ''}`}
                  onClick={() => allerEtape(e.id)}
                  {...propsDepot(e)}
                >
                  {e.nom}
                </button>
              )}
            </span>
          ))}
        </nav>
        {arianeApproximatif && (
          <p className="variante">{t('arianeApproximatif', langue)}</p>
        )}
        {resultats && (
          <div className="ariane-resultats">
            <b>
              {filtre !== 'tout' ? `${affiches.length} / ${resultats.length}` : resultats.length} {t('resultats', langue)}
              {tronque && ` · ${t(cleTroncatureRecherche(scopee), langue)}`}
            </b>
            {requeteLancee && requeteLancee !== texte.trim() && <span className="variante">« {requeteLancee} »</span>}
            <span className="sp" />
            <button type="button" className="discret" onClick={() => effacerRecherche(false, true)}>
              <Icone nom="fermer" /> {t('effacer', langue)}
            </button>
          </div>
        )}
      </div>

      <div className="carte lignes">
        {enCours && <p className="ligne vide">{t('chargement', langue)}</p>}
        {!charge && !resultats && !erreur && !enCours && <p className="ligne vide">{t('chargement', langue)}</p>}
        {(charge || resultats) && affiches.length === 0 && !enCours && (
          <p className="ligne vide">{resultats || filtre !== 'tout' ? t('aucunResultat', langue) : t('dossierVide', langue)}</p>
        )}
        {affiches.map((e) => {
          const parentNom = resultats !== null
            ? libelleParentEnCache(e, { nomRacine, nomsSupplementaires: nomsAriane })
            : null;
          if (estDossier(e)) {
            return (
              <div
                key={e.id}
                className={`ligne clic ${survolDepot === e.id ? 'depot-survol' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => ouvrirDossier(e)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ouvrirDossier(e); } }}
                {...propsDepot(e)}
              >
                <Icone nom="dossier" className="accent" />
                <span className="t">
                  <b>{e.name}</b>
                  {parentNom && (
                    <span className="ligne-meta">
                      <small className="ligne-parent" title={`${t('dossierParent', langue)} : ${parentNom}`}>
                        {parentNom}
                      </small>
                    </span>
                  )}
                </span>
                <Icone nom="chevron" className="chev" />
              </div>
            );
          }
          const ligneIndex = indexParId.get(e.id);
          const pastilles = pastillesIndex(ligneIndex, langue);
          const lienFichier = e.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(e.id)}/view`;
          const copieActive = lienCopieId === e.id;
          return (
            <div key={e.id} className="ligne" draggable onDragStart={(ev) => surDragStart(ev, e)} onDragEnd={() => setSurvolDepot('')}>
              <Icone nom="fichier" />
              <a className="t lien-ligne" href={lienFichier}
                target="_blank" rel="noreferrer noopener" title={t('ouvrirDansDrive', langue)} draggable={false}>
                <b className="mono">{e.name}</b>
                <span className="ligne-meta">
                  {parentNom && (
                    <small className="ligne-parent" title={`${t('dossierParent', langue)} : ${parentNom}`}>
                      {parentNom}
                    </small>
                  )}
                  <small>{formaterDateCourte(e.modifiedTime, locale)} · {formaterTaille(e.size)}</small>
                  {pastilles.map((p, idx) => (
                    <span key={`${p.classe}-${idx}`} className={`pastille pastille-index ${p.classe}`}>
                      {p.libelle}
                    </span>
                  ))}
                </span>
              </a>
              <div className="ligne-actions">
                <button
                  type="button"
                  className={`discret bouton-copier${copieActive ? ' copie-ok' : ''}`}
                  aria-label={`${copieActive ? t('lienCopie', langue) : t('copierLien', langue)} : ${e.name}`}
                  title={t('copierLien', langue)}
                  onClick={() => void copierLien(e)}
                >
                  <Icone nom={copieActive ? 'coche' : 'externe'} />
                  <span>{copieActive ? t('lienCopie', langue) : t('copierLien', langue)}</span>
                </button>
                <button type="button" className="icone-bouton petit" aria-label={`${t('deplacer', langue)} : ${e.name}`} title={t('deplacerTitre', langue)}
                  onClick={() => { setADeplacer(e); setStatutDepot(''); }}>
                  <Icone nom="deplacer" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {!resultats && suivant && (
        <button className="discret charger-plus" onClick={() => void chargerPlus()} disabled={enChargementPlus}>
          {enChargementPlus ? t('chargement', langue) : t('chargerPlus', langue)}
        </button>
      )}
    </div>
  );
}
