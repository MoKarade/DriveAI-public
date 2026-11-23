/**
 * AujourdHui.tsx — accueil v7 (C28-82 PR1, ADR-0051 ; Marc 2026-09-09 : « quelques boutons simples
 * à comprendre et qui fonctionnent, moins de déchets, tout ce qui est fini à la poubelle »).
 * Deux listes, aucune phrase :
 *  1. À FAIRE — ce qui demande sa main : mails suspects (« Pas suspect »), documents « à vérifier »
 *     (lien Drive), mails ⏰ à traiter (lien Gmail, « Fait »). Une ligne = une chose, au plus un
 *     bouton. Vide ⇒ une seule ligne « Rien à faire ».
 *  2. CLASSÉ RÉCEMMENT — la preuve que le moteur range (lien Drive).
 * Le coût LLM a quitté l'accueil (Réglages). Ce qui est FINI n'est jamais affiché : un ⏰ marqué
 * « Fait » disparaît, un suspect marqué « pas suspect » disparaît (masquage optimiste, Suspects.tsx).
 * Les tâches du jour et « Ma journée » (Google Tasks + Calendar) sont parties le 05/11/2026
 * (ADR-0074) : l'accueil ne lit plus que l'Index — plus aucune API Google hors Sheets.
 */

import { useState, useSyncExternalStore } from 'react';
import type { Section } from '../navigation';
import { ajouterLigne } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement, BanniereErreur, EntetePage } from '../composants/UI';
import { ListeSuspects, useSuspectsVisibles } from '../composants/Suspects';
import { Icone } from '../composants/Icone';
import {
  CLE_NON_DOCUMENT_SYNTHESE,
  LigneIndex,
  lignesSuspects,
  lignesAVerifier,
  importantsAFaire,
  STATUT_IMPORTANT_FAIT,
  syntheseEtat,
  lienDrivePourLigne,
  lienGmailPourLigne,
} from '../etat';
import { formaterDateCourte } from '../explorateur';
import { Langue, t } from '../i18n';

const CLASSEMENTS_RECENTS = 5;
const SUSPECTS_MAX = 5;
const A_VERIFIER_MAX = 5;
const IMPORTANTS_MAX = 5;
const IMPORTANTS_JOURS = 7; // au-delà, un ⏰ sort tout seul de « À faire » (même fenêtre que le résumé)

/**
 * « Fait » sur un mail ⏰ : masqué à toute la SESSION, pas au composant. En `useState`, le masque
 * mourait au changement d'onglet (`key={section}` remonte la vue) et le mail réapparaissait, l'Index
 * n'étant relu que toutes les 5 minutes — le clic n'avait pas l'air de tenir (audit app 2026-09-10).
 * Même patron que `masquesSession` de `Suspects.tsx`, avec son mini-store abonné.
 */
const faitsSession = new Set<string>();
const abonnesFaits = new Set<() => void>();
let versionFaits = 0;

function marquerFait(cle: string, fait: boolean) {
  if (fait) faitsSession.add(cle); else faitsSession.delete(cle);
  versionFaits++;
  abonnesFaits.forEach((cb) => cb());
}

function useFaitsSession(): Set<string> {
  useSyncExternalStore(
    (cb) => { abonnesFaits.add(cb); return () => { abonnesFaits.delete(cb); }; },
    () => versionFaits,
    () => versionFaits,
  );
  return faitsSession;
}

export function AujourdHui({ langue, onAller }: { langue: Langue; onAller: (s: Section) => void }) {
  const { donnees } = useEtatGlobal();
  const [erreur, setErreur] = useState('');
  const importantsFaits = useFaitsSession(); // « Fait » optimiste, à l'échelle de la session
  const suspects = useSuspectsVisibles(donnees ? lignesSuspects(donnees.index) : []);

  /**
   * « Fait » sur un mail ⏰ : l'app n'a pas de scope Gmail (elle ne peut ni lire ni archiver le
   * fil) — elle ajoute une ligne `important|<id>` au statut `important-fait` dans l'Index : l'état
   * courant de la clé change, le mail sort de « À faire » ; le moteur, qui ne juge que la présence
   * de la clé, ne re-marque jamais ce mail. Aucune suppression, une ligne ajoutée (append-only).
   */
  async function importantFait(l: LigneIndex) {
    if (faitsSession.has(l.cle)) return;
    setErreur('');
    marquerFait(l.cle, true); // OPTIMISTE
    try {
      const quand = new Date().toISOString().slice(0, 16).replace('T', ' ');
      await ajouterLigne('Index', [l.cle, quand, l.fichier, '', '', STATUT_IMPORTANT_FAIT, '', '']);
    } catch (e) {
      marquerFait(l.cle, false);
      setErreur(String(e));
    }
  }

  if (!donnees) return <IndicateurChargement langue={langue} />;

  const maintenant = new Date();
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const syn = syntheseEtat(donnees, { maintenant });

  // Documents seuls (les lignes mail / marqueurs techniques ne sont pas des documents).
  const docs = donnees.index.filter((l) => !CLE_NON_DOCUMENT_SYNTHESE.test(l.cle));
  const classements = docs.filter((l) => l.statut === 'classé').slice(-CLASSEMENTS_RECENTS).reverse();
  const aujourdhui = syn.fichiers.traitesAujourdhui;
  // Compter AVANT de tronquer : le badge annonçait 5 là où 30 documents attendaient, et rien dans
  // l'app ne montrait les 25 autres depuis que les filtres d'Index ont disparu (audit app 2026-09-10).
  const aVerifierTous = lignesAVerifier(docs);
  const aVerifier = aVerifierTous.slice(0, A_VERIFIER_MAX);
  const importantsTous = importantsAFaire(donnees.index, maintenant, IMPORTANTS_JOURS)
    .filter((l) => !importantsFaits.has(l.cle));
  const importants = importantsTous.slice(0, IMPORTANTS_MAX);
  const reorgPropositions = syn.fileRevue.reorgPropositions ?? 0;
  const videsCandidats = syn.fileRevue.videsCandidats ?? 0;
  const nbAFaire = suspects.length + aVerifierTous.length + importantsTous.length + reorgPropositions + videsCandidats;
  const incidentCritique = syn.moteur.compteLlm.statut === 'panne' || syn.moteur.triGmailSante.statut === 'arret';

  return (
    <div className="accueil">
      <EntetePage
        etiquette="DriveAI"
        titre={t('aujourdhui', langue)}
        sousTitre={t('sousTitreAccueil', langue)}
        badge={<span className="gf-quote-badge">{maintenant.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
      />

      {incidentCritique && (
        <div className="carte alerte-etat" role="status">
          <div className="alerte-etat-ligne">
            <span className="pastille crit">{t('alertesActivesTitre', langue)}</span>
            <span className="alerte-etat-texte">
              {syn.moteur.compteLlm.statut === 'panne'
                ? `${t('compteLlmLibelle', langue)} : ${t('compteLlmPanne', langue)}`
                : `${t('triGmailLibelle', langue)} : ${t('triGmailArret', langue)}`}
            </span>
            <button type="button" className="bouton-ligne" onClick={() => onAller('etat')}>
              {t('etat', langue)} <Icone nom="chevron" className="chev" />
            </button>
          </div>
        </div>
      )}

      {/* ---------- 1. À faire ---------- */}
      <section>
        <h2 className="titre-liste">
          {t('aFaire', langue)}
          {nbAFaire > 0 && <span className="badge">{nbAFaire}</span>}
          <span className="h2-note">{maintenant.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </h2>
        <BanniereErreur langue={langue} erreur={erreur} onFermer={() => setErreur('')} />
        <div className="carte lignes">
          <ListeSuspects langue={langue} suspects={suspects} max={SUSPECTS_MAX} />
          {suspects.length > SUSPECTS_MAX && (
            <div className="ligne">
              <Icone nom="alerte" className="attention" />
              <span className="t"><b>{t('autresSuspects', langue).replace('{n}', String(suspects.length - SUSPECTS_MAX))}</b></span>
            </div>
          )}
          {aVerifier.map((l: LigneIndex) => (
            <a key={l.cle} className="ligne" href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer">
              <Icone nom="fichier" className="erreur" />
              <span className="t">
                <b className="mono">{l.fichier}</b>
                <small>{t('aVerifierCourt', langue)} · {formaterDateCourte(l.traiteLe, locale)}</small>
              </span>
              <Icone nom="externe" className="chev" />
            </a>
          ))}
          {aVerifierTous.length > aVerifier.length && (
            <button className="ligne texte" onClick={() => onAller('documents')}>
              <Icone nom="fichier" className="erreur" />
              <span className="t"><b>{t('autresAVerifier', langue).replace('{n}', String(aVerifierTous.length - aVerifier.length))}</b></span>
              <Icone nom="chevron" className="chev" />
            </button>
          )}
          {importants.map((l: LigneIndex) => (
            <div key={l.cle} className="ligne">
              <Icone nom="horloge" className="accent" />
              <a className="t lien-ligne" href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer">
                <b>{l.fichier}</b>
                <small>{t('mailATraiter', langue)} · {formaterDateCourte(l.traiteLe, locale)}</small>
              </a>
              <button className="bouton-ligne" aria-label={`${t('fait', langue)} : ${l.fichier}`} onClick={() => void importantFait(l)}>
                <Icone nom="coche" /> {t('fait', langue)}
              </button>
            </div>
          ))}
          {importantsTous.length > importants.length && (
            <div className="ligne">
              <Icone nom="horloge" className="accent" />
              <span className="t"><b>{t('autresMails', langue).replace('{n}', String(importantsTous.length - importants.length))}</b></span>
            </div>
          )}
          {(reorgPropositions > 0 || videsCandidats > 0) && (
            <button type="button" className="ligne texte" onClick={() => onAller('documents')}>
              <Icone nom="dossier" className="accent" />
              <span className="t">
                <b>
                  {[
                    reorgPropositions > 0 ? t('reorgAccueilLibelle', langue).replace('{n}', String(reorgPropositions)) : '',
                    videsCandidats > 0 ? t('videsAccueilLibelle', langue).replace('{n}', String(videsCandidats)) : '',
                  ].filter(Boolean).join(' · ')}
                </b>
                <small>{t('voirDansDocuments', langue)}</small>
              </span>
              <Icone nom="chevron" className="chev" />
            </button>
          )}
          {/* Tout vient de l'Index, déjà lu (sinon l'indicateur de chargement s'affiche plus haut) :
              « Rien à faire » n'est jamais une affirmation prise sur une lecture partielle. */}
          {nbAFaire === 0 && <p className="ligne vide">{t('rienAFaire', langue)}</p>}
        </div>
      </section>

      {/* ---------- 2. Classé récemment ---------- */}
      <section>
        <h2 className="titre-liste">
          {t('derniersClassements', langue)}
          {aujourdhui > 0 && <span className="h2-note ok">+{aujourdhui} {t('aujourdhuiCourt', langue)}</span>}
          <button
            className="lien"
            aria-label={`${t('documents', langue)} ›`}
            onClick={() => onAller('documents')}
          >
            {t('documents', langue)} <Icone nom="chevron" className="chev" />
          </button>
        </h2>
        <div className="carte lignes">
          {classements.length === 0 && <p className="ligne vide">{t('aucunClassement', langue)}</p>}
          {classements.map((l: LigneIndex) => (
            <a key={l.cle} className="ligne" href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer">
              <Icone nom="fichier" />
              <span className="t">
                <b className="mono">{l.fichier}</b>
                <small>{l.domaine}</small>
              </span>
              <Icone nom="externe" className="chev" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
