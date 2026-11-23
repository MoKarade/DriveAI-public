/**
 * App.tsx — coquille v8 (P0-1, P0-2, P1-4, P2-1) : le téléphone d'abord.
 * TROIS sections dans la navigation principale (Aujourd’hui · Documents · État) ; Réglages est
 * atteint par l'engrenage de la barre haute sur téléphone et par le bas du rail sur PC ;
 * recherche rapide globale (`Ctrl+K` / `⌘K`) accessible depuis le rail PC et la barre haute mobile.
 * Depuis C28-20 (ADR-0021) : pas d'écran de configuration — la config vient de /api/config
 * après connexion, seul le compte ALLOWED_EMAIL ouvre une session.
 */

import { useEffect, useRef, useState } from 'react';
import { chargerConfigServeur, lireConfig } from './config';
import { brancherSentry } from './sentry';
import { seConnecter, estConnecte, seDeconnecter, abonnerSessionExpiree, tenterRestaurationSession } from './google';
import { FournisseurEtat, useEtatGlobal } from './etatGlobal';
import { BanniereErreur } from './composants/UI';
import { Icone, NomIcone } from './composants/Icone';
import { Omnibox } from './composants/Omnibox';
import { motifEchecDepuisUrl } from './connexion';
import { Langue, langueCourante, changerLangue, t } from './i18n';
import { EtatMoteur, fraicheurMoteur, dernierPassageDepuisSante, interpreterSante } from './etat';
import { type CibleNavigationExplorateur, type Section, SECTIONS_NAV } from './navigation';
import { ThemeApp, appliquerThemeDom, enregistrerTheme, initialiserTheme } from './theme';
import { AujourdHui } from './vues/AujourdHui';
import { Documents } from './vues/Documents';
import type { NavigationExplorateurDemandee } from './vues/Explorateur';
import { Etat } from './vues/Etat';
import { Reglages } from './vues/Reglages';

const ICONES: Record<Section, NomIcone> = {
  aujourdhui: 'aujourdhui',
  documents: 'documents',
  etat: 'horloge',
  reglages: 'reglages',
};

/**
 * Verrou d'identité (C28-20) : /api/callback renvoie ici avec `?erreur=acces_refuse` quand le
 * compte Google connecté n'est pas celui autorisé (ALLOWED_EMAIL) — aucun cookie n'a été posé.
 * Lecture PURE (StrictMode double-invoque les initialiseurs) ; le nettoyage d'URL vit dans un
 * useEffect au montage.
 */
function accesRefuseDepuisUrl(): boolean {
  return new URLSearchParams(window.location.search).get('erreur') === 'acces_refuse';
}

export function App() {
  const [langue, setLangue] = useState<Langue>(langueCourante());
  const [theme, setTheme] = useState<ThemeApp>(() => initialiserTheme());
  const [connecte, setConnecte] = useState(estConnecte());
  const [pret, setPret] = useState(false); // config serveur chargée (gate des vues)
  const [accesRefuse] = useState(accesRefuseDepuisUrl);
  const [echecConnexion] = useState(() => motifEchecDepuisUrl(window.location.search));
  const [erreur, setErreur] = useState('');

  // Nettoie l'URL (?erreur=acces_refuse) après le premier rendu — pas de re-affichage au F5.
  useEffect(() => {
    if (accesRefuse || echecConnexion !== null) window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- au montage uniquement
  }, []);

  // Session vraiment morte (le rafraîchissement silencieux a échoué) → écran de connexion,
  // au lieu de vues qui échouent en boucle. Un simple jeton d'une heure périmé ne passe plus ici.
  useEffect(() => {
    abonnerSessionExpiree(() => setConnecte(false));
  }, []);

  // Restauration SILENCIEUSE au chargement (C28-14) : le cookie HttpOnly de session (posé au
  // premier consentement) rend un jeton frais sans clic ni popup — « se connecter une fois ».
  useEffect(() => {
    if (!connecte) {
      void tenterRestaurationSession().then((ok) => { if (ok) setConnecte(true); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- au montage uniquement
  }, []);

  // Config SERVEUR (C28-20, ADR-0021) : dès que la session existe, /api/config délivre l'ID de
  // la Sheet et la web app — plus aucune saisie. Un échec (cookie mort entre-temps, variables
  // Vercel incomplètes) ramène à l'écran de connexion avec l'explication, plutôt que des vues
  // qui échoueraient en boucle.
  useEffect(() => {
    if (!connecte) { setPret(false); return; }
    void chargerConfigServeur().then((ok) => {
      if (ok) { brancherSentry(lireConfig().sentryDsn); setPret(true); return; }
      setConnecte(false);
      setErreur(t('configIndisponible', langueCourante()));
    });
  }, [connecte]);

  function basculerLangue() {
    const l: Langue = langue === 'fr' ? 'en' : 'fr';
    changerLangue(l);
    setLangue(l);
  }

  function changerTheme(nouveau: ThemeApp) {
    enregistrerTheme(nouveau);
    appliquerThemeDom(nouveau);
    setTheme(nouveau);
  }

  function deconnexion() {
    seDeconnecter();
    setConnecte(false);
  }

  async function connexion() {
    setErreur('');
    try {
      // En réel la page NAVIGUE vers /api/login (le await n'y revient pas) ; en mode mock E2E
      // seConnecter pose le jeton bouchonné et on bascule l'état localement.
      await seConnecter();
      setConnecte(estConnecte());
    } catch (e) {
      setErreur(String(e));
    }
  }

  if (connecte && pret) {
    return (
      <FournisseurEtat>
        <Coquille
          langue={langue}
          onLangue={basculerLangue}
          onDeconnexion={deconnexion}
          theme={theme}
          onTheme={changerTheme}
        />
      </FournisseurEtat>
    );
  }

  // Écran de connexion / chargement : le logo, une phrase, un bouton. Rien d'autre.
  return (
    <div className="app connexion">
      <div className="centre">
        <p className="logo grand"><b>Drive</b>AI</p>
        <p className="sous-titre">{t('sousTitre', langue)}</p>
        {!connecte && (
          <>
            <button className="principal" onClick={connexion}>{t('connexion', langue)}</button>
            {accesRefuse && <p className="erreur">{t('accesRefuse', langue)}</p>}
            {echecConnexion !== null && (
              <p className="erreur">{t('connexionEchec', langue)}{echecConnexion ? ` (${echecConnexion})` : ''}</p>
            )}
            {erreur && <p className="erreur">{erreur}</p>}
          </>
        )}
        {connecte && !pret && <p className="chargement">{t('chargement', langue)}</p>}
        <button className="discret lien-langue" onClick={basculerLangue}>
          {langue === 'fr' ? 'English' : 'Français'}
        </button>
      </div>
    </div>
  );
}

/**
 * Coquille connectée (dans le FournisseurEtat — la pastille moteur et la bannière d'erreur
 * globale lisent l'état partagé) : barre haute (téléphone), rail (PC), contenu, onglets bas,
 * et fenêtre de recherche rapide globale (`Omnibox`).
 */
function Coquille({ langue, onLangue, onDeconnexion, theme, onTheme }: {
  langue: Langue;
  onLangue: () => void;
  onDeconnexion: () => void;
  theme: ThemeApp;
  onTheme: (t: ThemeApp) => void;
}) {
  const { erreur, rafraichir } = useEtatGlobal();
  const [section, setSection] = useState<Section>('aujourdhui');
  const [cibleExplorateur, setCibleExplorateur] = useState<NavigationExplorateurDemandee | null>(null);
  const jetonNavRef = useRef(0);
  const [omniboxOuverte, setOmniboxOuverte] = useState(false);
  const omniboxOuverteRef = useRef(omniboxOuverte);
  omniboxOuverteRef.current = omniboxOuverte;
  const declencheurOmniboxRef = useRef<HTMLElement | null>(null);

  function allerA(s: Section) {
    setCibleExplorateur(null);
    setSection(s);
    window.scrollTo({ top: 0 });
  }

  function ouvrirOmnibox() {
    declencheurOmniboxRef.current = document.activeElement as HTMLElement | null;
    setOmniboxOuverte(true);
  }

  function fermerOmnibox() {
    setOmniboxOuverte(false);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => declencheurOmniboxRef.current?.focus());
    }
  }

  function ouvrirDossierDepuisOmnibox(cible: CibleNavigationExplorateur) {
    jetonNavRef.current += 1;
    setCibleExplorateur({ cible, jeton: jetonNavRef.current });
    setSection('documents');
    window.scrollTo({ top: 0 });
  }

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (omniboxOuverteRef.current) fermerOmnibox();
        else ouvrirOmnibox();
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, []);

  return (
    <div className="app">
      {/* Téléphone seulement (le rail porte le logo sur PC). */}
      <header className="barre-haute">
        <p className="logo"><b>Drive</b>AI</p>
        <div className="header-actions">
          <PastilleMoteur langue={langue} onOuvrir={() => allerA('etat')} />
          <button
            type="button"
            className="icone-bouton"
            aria-label={`${t('rechercheRapide', langue)} (Ctrl+K)`}
            title={`${t('rechercheRapide', langue)} (Ctrl+K / ⌘K)`}
            onClick={ouvrirOmnibox}
          >
            <Icone nom="recherche" />
          </button>
          <button
            type="button"
            className={'icone-bouton' + (section === 'reglages' ? ' actif' : '')}
            aria-label={t('reglages', langue)}
            title={t('reglages', langue)}
            onClick={() => allerA('reglages')}
          >
            <Icone nom="reglages" />
          </button>
        </div>
      </header>

      <div className="corps-app">
        {/* PC seulement. */}
        <nav className="rail" aria-label="Sections">
          <p className="logo"><b>Drive</b>AI</p>
          <button
            type="button"
            className="rail-recherche"
            aria-label={`${t('rechercheRapide', langue)} (Ctrl+K)`}
            title={`${t('rechercheRapide', langue)} (Ctrl+K / ⌘K)`}
            onClick={ouvrirOmnibox}
          >
            <Icone nom="recherche" />
            <span>{t('rechercheRapide', langue)}</span>
            <kbd className="omnibox-raccourci" aria-hidden="true">⌘K</kbd>
          </button>
          {SECTIONS_NAV.map((s) => (
            <button key={s} className={section === s ? 'actif' : ''} onClick={() => allerA(s)}>
              <Icone nom={ICONES[s]} />
              <span>{t(s, langue)}</span>
            </button>
          ))}
          <div className="rail-espace" />
          <button className={section === 'reglages' ? 'actif' : ''} onClick={() => allerA('reglages')}>
            <Icone nom="reglages" />
            <span>{t('reglages', langue)}</span>
          </button>
          <PastilleMoteur langue={langue} onOuvrir={() => allerA('etat')} etendue />
        </nav>

        <main className="contenu">
          <div className="vue-active" key={section}>
            {erreur && (
              <div className="bandeau-global">
                <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => void rafraichir(true)} />
              </div>
            )}
            {section === 'aujourdhui' && <AujourdHui langue={langue} onAller={allerA} />}
            {section === 'documents' && (
              <Documents
                langue={langue}
                cibleExplorateur={cibleExplorateur}
                onCibleConsommee={(jeton) =>
                  setCibleExplorateur((courant) => (courant?.jeton === jeton ? null : courant))
                }
              />
            )}
            {section === 'etat' && <Etat langue={langue} onAller={allerA} />}
            {section === 'reglages' && (
              <Reglages
                langue={langue}
                onLangue={onLangue}
                onDeconnexion={onDeconnexion}
                theme={theme}
                onTheme={onTheme}
              />
            )}
          </div>
        </main>
      </div>

      {/* Téléphone seulement : les trois sections principales, toujours au pouce. */}
      <nav className="barre-basse" aria-label="Sections (mobile)">
        {SECTIONS_NAV.map((s) => (
          <button key={s} className={section === s ? 'actif' : ''} onClick={() => allerA(s)}>
            <Icone nom={ICONES[s]} />
            <span>{t(s, langue)}</span>
          </button>
        ))}
      </nav>

      {omniboxOuverte && (
        <Omnibox
          langue={langue}
          onAller={allerA}
          onOuvrirDossier={ouvrirDossierDepuisOmnibox}
          onFermer={fermerOmnibox}
        />
      )}
    </div>
  );
}

/**
 * Pastille moteur (C28-41, décision Marc « pastille discrète ») : point vert/ambre/rouge dérivé
 * du « Dernier passage OK » de l'onglet Santé + de la fréquence de tick réglée. Discrète tant
 * que tout va bien ; un clic ouvre l'onglet État pour le détail. Jamais un faux vert : données
 * absentes ⇒ gris « inconnu ». `etendue` (rail PC) affiche l'état en toutes lettres.
 */
function PastilleMoteur({ langue, onOuvrir, etendue }: { langue: Langue; onOuvrir: () => void; etendue?: boolean }) {
  const { donnees } = useEtatGlobal();
  const sante = donnees ? interpreterSante(donnees.santeBrut) : null;
  const lignes = sante ? sante.lignes : [];
  const tick = Number(donnees?.reglagesBrut?.[0]?.[1]) || 5;
  const etatBase: EtatMoteur = donnees ? fraicheurMoteur(lignes, new Date(), tick) : 'inconnu';
  const incidentCritique = sante?.compteLlm.statut === 'panne' || sante?.triGmailSante.statut === 'arret';
  const etat: EtatMoteur = etatBase === 'ok' && incidentCritique ? 'retard' : etatBase;
  const titres: Record<EtatMoteur, string> = {
    ok: t('moteurVivant', langue),
    retard: t('moteurRetard', langue),
    mort: t('moteurSilencieux', langue),
    inconnu: t('moteurInconnu', langue),
  };
  const courts: Record<EtatMoteur, string> = {
    ok: t('moteurCourtOk', langue),
    retard: t('moteurCourtRetard', langue),
    mort: t('moteurCourtMort', langue),
    inconnu: t('moteurCourtInconnu', langue),
  };
  const passage = sante?.dernierePasseOk || dernierPassageDepuisSante(lignes);
  const detailsIncidents = [
    sante?.compteLlm.statut === 'panne' ? `${t('compteLlmLibelle', langue)} : ${t('compteLlmPanne', langue)}` : '',
    sante?.triGmailSante.statut === 'arret' ? `${t('triGmailLibelle', langue)} : ${t('triGmailArret', langue)}` : '',
  ].filter(Boolean).join(' · ');
  const infoBulle = [
    titres[etat],
    passage ? `${t('dernierPassage', langue)} ${passage}` : '',
    detailsIncidents,
  ].filter(Boolean).join(' — ');
  return (
    <button
      className={`pastille-moteur ${etat}`}
      aria-label={titres[etat]}
      title={infoBulle}
      onClick={onOuvrir}
    >
      <span className="pm-point" aria-hidden="true" />
      <span className="pm-libelle">{etendue ? titres[etat] : courts[etat]}</span>
    </button>
  );
}
