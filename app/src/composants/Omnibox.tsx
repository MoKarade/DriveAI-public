/**
 * Omnibox.tsx — recherche globale rapide (`Ctrl+K` / `⌘K`, P0-1) : fenêtre modale en pilule
 * permettant de sauter vers un écran ou de rechercher dans Google Drive (`rechercherDrive`,
 * compatible `MODE_MOCK`, sans persistance ni stockage de corps — ADR-0007).
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { libelleParentEnCache, rechercherDrive } from '../google';
import { estDossier, formaterDateCourte, formaterTaille, type ElementDrive } from '../explorateur';
import { type CibleNavigationExplorateur, type Section } from '../navigation';
import { Langue, t } from '../i18n';
import { Icone, type NomIcone } from './Icone';
import { BanniereErreur, IndicateurChargement } from './UI';

const DELAI_DEBOUNCE_MS = 220;
const LONGUEUR_MIN_RECHERCHE = 2;
const ECRANS_DISPONIBLES: readonly Section[] = ['aujourdhui', 'documents', 'etat', 'reglages'];
const ICONES_ECRANS: Record<Section, NomIcone> = {
  aujourdhui: 'aujourdhui',
  documents: 'documents',
  etat: 'horloge',
  reglages: 'reglages',
};

function normaliser(texte: string): string {
  return texte.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function Omnibox({ langue, onAller, onOuvrirDossier, onFermer }: {
  langue: Langue;
  onAller: (s: Section) => void;
  onOuvrirDossier: (cible: CibleNavigationExplorateur) => void;
  onFermer: () => void;
}) {
  // État strictement éphémère en mémoire (ADR-0007 : jamais persisté dans localStorage/sessionStorage).
  const [texte, setTexte] = useState('');
  const [resultats, setResultats] = useState<ElementDrive[]>([]);
  const [tronque, setTronque] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idRequeteRef = useRef(0);
  const demonteRef = useRef(false);
  const minuteurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const textePropre = texte.trim();
  const requeteActive = textePropre.length >= LONGUEUR_MIN_RECHERCHE;

  useEffect(() => {
    demonteRef.current = false;
    inputRef.current?.focus();
    return () => {
      demonteRef.current = true;
      if (minuteurRef.current !== null) clearTimeout(minuteurRef.current);
    };
  }, []);

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFermer();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) return;
      const premier = focusables[0]!;
      const dernier = focusables[focusables.length - 1]!;
      const actif = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (actif === premier || !dialogRef.current.contains(actif)) {
          e.preventDefault();
          dernier.focus();
        }
      } else if (actif === dernier || !dialogRef.current.contains(actif)) {
        e.preventDefault();
        premier.focus();
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onFermer]);

  async function executerRecherche(terme: string) {
    const propre = terme.trim();
    if (propre.length < LONGUEUR_MIN_RECHERCHE) {
      idRequeteRef.current++;
      setResultats([]);
      setTronque(false);
      setEnCours(false);
      setErreur('');
      return;
    }
    const idRequete = ++idRequeteRef.current;
    setEnCours(true);
    setErreur('');
    try {
      const rep = await rechercherDrive(propre);
      if (demonteRef.current || idRequete !== idRequeteRef.current) return;
      setResultats(rep.elements);
      setTronque(rep.tronque);
    } catch (e) {
      if (demonteRef.current || idRequete !== idRequeteRef.current) return;
      setResultats([]);
      setTronque(false);
      setErreur(String(e));
    } finally {
      if (!demonteRef.current && idRequete === idRequeteRef.current) {
        setEnCours(false);
      }
    }
  }

  useEffect(() => {
    if (minuteurRef.current !== null) {
      clearTimeout(minuteurRef.current);
      minuteurRef.current = null;
    }
    if (textePropre.length < LONGUEUR_MIN_RECHERCHE) {
      idRequeteRef.current++;
      setResultats([]);
      setTronque(false);
      setEnCours(false);
      setErreur('');
      return;
    }
    minuteurRef.current = setTimeout(() => {
      minuteurRef.current = null;
      void executerRecherche(textePropre);
    }, DELAI_DEBOUNCE_MS);
    return () => {
      if (minuteurRef.current !== null) {
        clearTimeout(minuteurRef.current);
        minuteurRef.current = null;
      }
    };
  }, [textePropre]);

  function surSoumission(e: FormEvent) {
    e.preventDefault();
    if (minuteurRef.current !== null) {
      clearTimeout(minuteurRef.current);
      minuteurRef.current = null;
    }
    void executerRecherche(texte);
  }

  const ecransFiltres = useMemo(() => {
    const aiguille = normaliser(texte);
    if (!aiguille) return ECRANS_DISPONIBLES;
    return ECRANS_DISPONIBLES.filter((s) => normaliser(t(s, langue)).includes(aiguille));
  }, [texte, langue]);

  const nomRacine = t('monDrive', langue);

  return (
    <>
      <div className="feuille-fond" aria-hidden="true" onClick={onFermer} />
      <div
        ref={dialogRef}
        className="omnibox-conteneur"
        role="dialog"
        aria-modal="true"
        aria-label={t('omniboxTitre', langue)}
      >
        <div className="omnibox-boite">
          <div className="omnibox-entete">
            <span className="omnibox-titre">{t('omniboxTitre', langue)}</span>
            <kbd className="omnibox-raccourci" aria-hidden="true">Esc</kbd>
            <button
              type="button"
              className="icone-bouton"
              aria-label={t('fermer', langue)}
              title={t('fermer', langue)}
              onClick={onFermer}
            >
              <Icone nom="fermer" />
            </button>
          </div>

          <form className="recherche gf-omnibox-pill" onSubmit={surSoumission}>
            <Icone nom="recherche" />
            <input
              ref={inputRef}
              type="search"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              placeholder={t('omniboxPlaceholder', langue)}
              aria-label={t('omniboxTitre', langue)}
              autoComplete="off"
              spellCheck={false}
            />
            {texte && (
              <button
                type="button"
                className="icone-bouton petit recherche-effacer"
                aria-label={t('effacer', langue)}
                title={t('effacer', langue)}
                onClick={() => {
                  setTexte('');
                  inputRef.current?.focus();
                }}
              >
                <Icone nom="fermer" />
              </button>
            )}
            <button
              type="submit"
              className="recherche-soumettre"
              aria-label={t('rechercher', langue)}
              title={t('rechercher', langue)}
            >
              <Icone nom="recherche" />
            </button>
          </form>

          <div className="omnibox-liste">
            {ecransFiltres.length > 0 && (
              <div>
                <p className="omnibox-section-titre">{t('omniboxEcrans', langue)}</p>
                <div className="carte lignes">
                  {ecransFiltres.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="ligne texte"
                      onClick={() => {
                        onAller(s);
                        onFermer();
                      }}
                    >
                      <Icone nom={ICONES_ECRANS[s]} className="accent" />
                      <span className="t"><b>{t(s, langue)}</b></span>
                      <Icone nom="chevron" className="chev" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!requeteActive && (
              <p className="variante omnibox-note">{t('omniboxIndice', langue)}</p>
            )}

            {requeteActive && (
              <div>
                <p className="omnibox-section-titre">{t('omniboxResultatsDrive', langue)}</p>
                {enCours && <IndicateurChargement langue={langue} />}
                {erreur && <BanniereErreur langue={langue} erreur={erreur} onFermer={() => setErreur('')} />}
                {!enCours && !erreur && resultats.length === 0 && (
                  <div className="carte lignes">
                    <p className="ligne vide">{t('aucunResultat', langue)}</p>
                  </div>
                )}
                {!erreur && resultats.length > 0 && (
                  <div className="carte lignes">
                    {resultats.map((el) => {
                      const parentNom = libelleParentEnCache(el, { nomRacine });
                      if (estDossier(el)) {
                        const details = [parentNom, t('omniboxOuvrirDossier', langue)].filter(Boolean).join(' · ');
                        return (
                          <button
                            key={el.id}
                            type="button"
                            className="ligne texte"
                            onClick={() => {
                              onOuvrirDossier({ id: el.id, nom: el.name, parents: el.parents });
                              onFermer();
                            }}
                          >
                            <Icone nom="dossier" className="accent" />
                            <span className="t">
                              <b>{el.name}</b>
                              <small>{details}</small>
                            </span>
                            <Icone nom="chevron" className="chev" />
                          </button>
                        );
                      }
                      const meta = [
                        parentNom,
                        formaterDateCourte(el.modifiedTime, locale),
                        el.size ? formaterTaille(el.size) : '',
                      ].filter(Boolean).join(' · ');
                      const lien = el.webViewLink ?? `https://drive.google.com/file/d/${encodeURIComponent(el.id)}/view`;
                      return (
                        <a
                          key={el.id}
                          className="ligne"
                          href={lien}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={onFermer}
                        >
                          <Icone nom="fichier" />
                          <span className="t">
                            <b className="mono">{el.name}</b>
                            {meta && <small>{meta}</small>}
                          </span>
                          <Icone nom="externe" className="chev" />
                        </a>
                      );
                    })}
                  </div>
                )}
                {tronque && <p className="variante omnibox-note">{t('resultatsTronques', langue)}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
