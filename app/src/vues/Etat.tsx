/**
 * Etat.tsx — onglet principal « État » (P0-2, P0-4, P2-2) refondu :
 *  - Barre d'actions directes : Rafraîchir les données + Lancer un passage moteur
 *  - Bandeau héros de santé du moteur (âge formaté, dernière lecture, 3 pastilles clés)
 *  - Alertes actives en priorité haute
 *  - Trois tuiles KPI + jauge budget mensuel (sans donnée inventée : absent => « — »)
 *  - Grille Bento « État du moteur » / « À revoir » (raccourcis Aujourd'hui/Documents)
 *  - Suivi symétrique des classements et du tri Gmail
 */

import { useState } from 'react';
import type { Section } from '../navigation';
import { useEtatGlobal, useProgressionLive } from '../etatGlobal';
import { formaterHeureExacte, messageRetourSynchro, usePassageMoteur } from '../composants/ActionsMoteur';
import { EntetePage, IndicateurChargement } from '../composants/UI';
import { Icone } from '../composants/Icone';
import {
  EtatMoteur,
  LigneJournal,
  syntheseEtat,
  SyntheseEtat,
  familleStatut,
  FamilleStatut,
  formaterAgeMinutes,
  nettoyerDetailSante,
  cleErreurJournal,
  lireErreursVues,
  enregistrerErreursVues,
} from '../etat';
import { formaterMontant } from '../explorateur';
import { CleTexte, Langue, t } from '../i18n';

const BUDGET_CROISIERE = 10; // cible < 10 $/mois en croisière (CLAUDE.md §1.6)
const ERREURS_MAX = 8;

export function Etat({ langue, onAller }: { langue: Langue; onAller?: (s: Section) => void }) {
  const { donnees, erreur, synchroA, rafraichir } = useEtatGlobal();
  const progression = useProgressionLive();
  const [synchroEnCours, setSynchroEnCours] = useState(false);
  const [synchroTente, setSynchroTente] = useState(false);
  const [erreurSynchro, setErreurSynchro] = useState('');
  const [synchroLocaleA, setSynchroLocaleA] = useState<Date | null>(null);
  const [erreursVues, setErreursVues] = useState<string[]>(lireErreursVues);
  const passageAction = usePassageMoteur(langue);

  function marquerErreurVue(l: LigneJournal) {
    const cle = cleErreurJournal(l);
    setErreursVues((prev) => {
      const maj = Array.from(new Set([...prev, cle]));
      enregistrerErreursVues(maj);
      return maj;
    });
  }

  function reafficherErreursVues() {
    enregistrerErreursVues([]);
    setErreursVues([]);
  }

  const maintenant = new Date();
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';

  function lancerSynchro() {
    if (synchroEnCours) return;
    setSynchroTente(true);
    setErreurSynchro('');
    setSynchroEnCours(true);
    void rafraichir(true)
      .then(() => setSynchroLocaleA(new Date()))
      .catch((e) => setErreurSynchro(String(e)))
      .finally(() => setSynchroEnCours(false));
  }

  const retourSynchro = messageRetourSynchro({
    enCours: synchroEnCours,
    tente: synchroTente,
    dateAffichee: synchroLocaleA ?? synchroA,
    erreurLocale: erreurSynchro,
    erreurGlobale: erreur,
    langue,
  });

  const barreActions = (
    <div className="etat-entete-actions">
      <button
        type="button"
        className="discret bouton-icone-texte"
        disabled={synchroEnCours}
        aria-busy={synchroEnCours}
        title={t('rafraichir', langue)}
        onClick={lancerSynchro}
      >
        <span className={synchroEnCours ? 'icone-tourne' : undefined} aria-hidden="true">
          <Icone nom="rafraichir" />
        </span>
        <span>{synchroEnCours ? t('synchroEnCoursLibelle', langue) : t('rafraichir', langue)}</span>
      </button>
      <button
        type="button"
        className="bouton-ligne principal"
        disabled={passageAction.enCours}
        aria-busy={passageAction.enCours}
        onClick={() => void passageAction.lancer()}
      >
        <Icone nom="horloge" />
        <span>{passageAction.enCours ? t('lancementPassage', langue) : t('lancerPassage', langue)}</span>
      </button>
    </div>
  );

  if (!donnees) {
    return (
      <div className="colonnes">
        <EntetePage etiquette="DriveAI" titre={t('etat', langue)} sousTitre={t('sousTitreEtat', langue)} actions={barreActions} />
        {retourSynchro.type !== 'aucun' && (
          <p className={retourSynchro.type === 'erreur' ? 'erreur bandeau-erreur' : 'ok bandeau-ok'} role={retourSynchro.type === 'erreur' ? 'alert' : 'status'}>
            {retourSynchro.texte}
          </p>
        )}
        <IndicateurChargement langue={langue} />
      </div>
    );
  }

  const syn: SyntheseEtat = syntheseEtat(donnees, { progression, maintenant });

  const etat: EtatMoteur = syn.moteur.fraicheur;
  const passage = syn.moteur.dernierePasseOk;
  const age = syn.moteur.ageMinutes;
  const titresEtat: Record<EtatMoteur, CleTexte> = {
    ok: 'moteurVivant', retard: 'moteurCourtRetard', mort: 'moteurCourtMort', inconnu: 'moteurInconnu',
  };

  const operationsEnDifficulte = progression.filter((op) => {
    if (op.cle === 'hub-resume') return false;
    const f = familleStatut(op.statut);
    return f === 'erreur' || f === 'suspendu';
  });
  const vuesSet = new Set(erreursVues);
  const erreursNonVues = syn.erreurs.journal7j.filter((l) => !vuesSet.has(cleErreurJournal(l)));
  const nbErreursVisibles = erreursNonVues.length;
  const nbErreursMasquees = syn.erreurs.journal7j.length - nbErreursVisibles;
  const erreurs = erreursNonVues.slice(-ERREURS_MAX).reverse();
  const passesEnCours = syn.moteur.dernieresPassesProgression.filter((op) => {
    const f = familleStatut(op.statut);
    return f === 'encours' || f === 'recensement';
  });

  const aAlertesActives =
    syn.moteur.compteLlm.statut === 'panne'
    || syn.moteur.triGmailSante.statut === 'arret'
    || syn.gmail.quotaSuspendu
    || syn.erreurs.quotaGmailJournalAujourdhui
    || nbErreursVisibles > 0
    || (syn.erreurs.nbReorgRefus ?? 0) > 0
    || operationsEnDifficulte.length > 0;

  const classeCompteLlm = syn.moteur.compteLlm.statut === 'actif'
    ? 'ok'
    : syn.moteur.compteLlm.statut === 'panne' ? 'crit' : 'douce';
  const libelleCompteLlm = syn.moteur.compteLlm.statut === 'actif'
    ? t('compteLlmActif', langue)
    : syn.moteur.compteLlm.statut === 'panne' ? t('compteLlmPanne', langue) : t('compteLlmInconnu', langue);
  const detailCompteLlm = nettoyerDetailSante(syn.moteur.compteLlm.detail);

  const classeTriGmail = syn.moteur.triGmailSante.statut === 'normal'
    ? 'ok'
    : syn.moteur.triGmailSante.statut === 'arret' ? 'crit' : 'douce';
  const libelleTriGmail = syn.moteur.triGmailSante.statut === 'normal'
    ? t('triGmailNormal', langue)
    : syn.moteur.triGmailSante.statut === 'arret' ? t('triGmailArret', langue) : t('triGmailInconnu', langue);
  const detailTriGmail = nettoyerDetailSante(syn.moteur.triGmailSante.detail);

  const coutAffiche = syn.quotasCouts.coutMoisDollars;
  const coutMesure = coutAffiche !== null && Number.isFinite(coutAffiche);
  const pctBudget = coutMesure ? Math.max(0, Math.min(100, (coutAffiche / BUDGET_CROISIERE) * 100)) : null;

  const archivesJour = syn.gmail.archivage.archivesJour;
  const archivesMesurees = archivesJour !== null && Number.isFinite(archivesJour);
  const lectureAffiche = synchroA ?? synchroLocaleA;

  const actionsAccueilUrgentes = syn.fileRevue.suspects + syn.fileRevue.aVerifier + syn.fileRevue.importants;
  const actionsDocumentsDisponibles =
    syn.fileRevue.aVerifier + (syn.fileRevue.reorgPropositions ?? 0) + (syn.fileRevue.videsCandidats ?? 0);

  return (
    <div className="colonnes etat-vue">
      <EntetePage
        etiquette="DriveAI"
        titre={t('etat', langue)}
        sousTitre={t('sousTitreEtat', langue)}
        badge={passage ? <span className="gf-quote-badge">{t('dernierePasseLibelle', langue)} : {passage}</span> : undefined}
        actions={barreActions}
      />

      {retourSynchro.type !== 'aucun' && (
        <p className={retourSynchro.type === 'erreur' ? 'erreur bandeau-erreur' : 'ok bandeau-ok'} role={retourSynchro.type === 'erreur' ? 'alert' : 'status'}>
          {retourSynchro.texte}
        </p>
      )}
      {passageAction.retour && <p className="ok bandeau-ok" role="status">{passageAction.retour}</p>}
      {passageAction.erreur && <p className="erreur bandeau-erreur" role="alert">{passageAction.erreur}</p>}

      <section className={`carte moteur-bandeau ${etat}`} aria-label={t('etatMoteurTitre', langue)}>
        <div className="moteur-bandeau-principal">
          <div className="moteur-bandeau-titre-ligne">
            <span className="pm-point" aria-hidden="true" />
            <b className="moteur-bandeau-titre">{t(titresEtat[etat], langue)}</b>
          </div>
          <p className="moteur-bandeau-meta">
            {passage ? `${t('dernierePasseLibelle', langue)} : ${passage}` : t('moteurInconnu', langue)}
            {age !== null && <> · {formaterAgeMinutes(age, langue)}</>}
            {lectureAffiche && <> · {t('derniereLecture', langue).replace('{heure}', formaterHeureExacte(lectureAffiche, langue))}</>}
          </p>
        </div>
        <div className="moteur-bandeau-pastilles">
          <span className={`pastille ${classeCompteLlm}`}>{t('compteLlmLibelle', langue)} · {libelleCompteLlm}</span>
          <span className={`pastille ${classeTriGmail}`}>{t('triGmailLibelle', langue)} · {libelleTriGmail}</span>
          <span className={`pastille ${nbErreursVisibles > 0 ? 'crit' : 'ok'}`}>
            {t('erreurs7j', langue)} · {nbErreursVisibles}
          </span>
        </div>
      </section>

      {aAlertesActives && (
        <section className="carte alerte-etat" role="region" aria-label={t('alertesActivesTitre', langue)}>
          <h2>
            <Icone nom="alerte" className="erreur" />
            {t('alertesActivesTitre', langue)}
          </h2>
          <div className="etat-lignes">
            {syn.moteur.compteLlm.statut === 'panne' && (
              <div className="etat-ligne">
                <span>{t('compteLlmLibelle', langue)}</span>
                <span className="etat-valeur">
                  <span className="pastille crit">{t('compteLlmPanne', langue)}</span>
                  {detailCompteLlm && <span className="variante">{detailCompteLlm}</span>}
                </span>
              </div>
            )}
            {syn.moteur.triGmailSante.statut === 'arret' && (
              <div className="etat-ligne">
                <span>{t('triGmailLibelle', langue)}</span>
                <span className="etat-valeur">
                  <span className="pastille crit">{t('triGmailArret', langue)}</span>
                  {detailTriGmail && <span className="variante">{detailTriGmail}</span>}
                </span>
              </div>
            )}
            {(syn.gmail.quotaSuspendu || syn.erreurs.quotaGmailJournalAujourdhui) && (
              <div className="etat-ligne">
                <span>{t('quotaGmailResume', langue)}</span>
                <span className="etat-valeur">
                  <span className="pastille attn">{t('quotaEtatSuspendu', langue)}</span>
                  <span className="variante">{syn.gmail.quotaDetail || t('noteQuota', langue)}</span>
                </span>
              </div>
            )}
            {operationsEnDifficulte.map((op) => (
              <div key={op.cle} className="etat-ligne">
                <span>{op.operation}</span>
                <span className="etat-valeur">
                  <span className="pastille crit">{t(LIBELLES_STATUT[familleStatut(op.statut)], langue)}</span>
                  {(op.derniereErreur || op.detail) && <span className="variante">{op.derniereErreur || op.detail}</span>}
                </span>
              </div>
            ))}
            {(syn.erreurs.nbReorgRefus ?? 0) > 0 && (
              <div className="etat-ligne">
                <span>{t('reorgRefusesLibelle', langue)}</span>
                <span className="etat-valeur">
                  <span className="pastille crit">{syn.erreurs.nbReorgRefus}</span>
                </span>
              </div>
            )}
          </div>
          {erreurs.length > 0 && (
            <div className="erreurs-liste">
              {erreurs.map((l: LigneJournal, i) => {
                const cle = cleErreurJournal(l);
                return (
                  <div key={`${cle}-${i}`} className="erreur-item">
                    <span className="date">{l.date}</span>
                    <span className="pastille crit">{l.source}</span>
                    <span className="erreur-msg">{l.message}</span>
                    <button
                      type="button"
                      className="discret bouton-icone-texte erreur-vu"
                      aria-label={`${t('marquerVu', langue)} — ${l.source} ${l.date}`}
                      onClick={() => marquerErreurVue(l)}
                    >
                      <Icone nom="coche" />
                      <span>{t('marquerVu', langue)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="tuiles-3 gf-quote-strip">
        <div className="tuile">
          <b>{syn.fichiers.classe.toLocaleString(locale)}</b>
          <small>{t('documentsClasses', langue)}</small>
          {syn.fichiers.traitesAujourdhui > 0 && (
            <span className="d ok">+{syn.fichiers.traitesAujourdhui} {t('aujourdhuiCourt', langue)}</span>
          )}
        </div>
        <div className="tuile">
          <b>{syn.gmail.totalTries.toLocaleString(locale)}</b>
          <small>{t('filsTries', langue)}</small>
          {archivesMesurees && archivesJour > 0 && (
            <span className="d ok">+{archivesJour} {t('aujourdhuiCourt', langue)}</span>
          )}
        </div>
        <div className="tuile">
          <b>{coutMesure ? formaterMontant(coutAffiche, locale) : '—'}</b>
          <small>{t('coutMoisCourt', langue)} · {formaterMontant(BUDGET_CROISIERE, locale, 0)}</small>
          {pctBudget !== null && (
            <div className="jauge" role="img" aria-label={`${formaterMontant(coutAffiche!, locale)} / ${formaterMontant(BUDGET_CROISIERE, locale, 0)}`}>
              <i className={coutAffiche! >= BUDGET_CROISIERE ? 'pleine' : undefined} style={{ width: `${pctBudget}%` }} />
            </div>
          )}
        </div>
      </div>

      <section className="carte etat-bento-gauche">
        <h2>{t('etatMoteurTitre', langue)}</h2>
        <div className="etat-lignes">
          <div className="etat-ligne">
            <span>{t('dernierePasseLibelle', langue)}</span>
            <span className="etat-valeur"><b>{passage || '—'}</b></span>
          </div>
          <div className="etat-ligne">
            <span>{t('compteLlmLibelle', langue)}</span>
            <span className="etat-valeur">
              <span className={`pastille ${classeCompteLlm}`}>{libelleCompteLlm}</span>
              {detailCompteLlm && detailCompteLlm.toLowerCase() !== libelleCompteLlm.toLowerCase() && (
                <span className="variante">{detailCompteLlm}</span>
              )}
            </span>
          </div>
          <div className="etat-ligne">
            <span>{t('triGmailLibelle', langue)}</span>
            <span className="etat-valeur">
              <span className={`pastille ${classeTriGmail}`}>{libelleTriGmail}</span>
              {detailTriGmail && detailTriGmail.toLowerCase() !== libelleTriGmail.toLowerCase() && (
                <span className="variante">{detailTriGmail}</span>
              )}
            </span>
          </div>
          <div className="etat-ligne">
            <span>{t('erreurs7j', langue)}</span>
            <span className="etat-valeur">
              <span className={`pastille ${nbErreursVisibles > 0 ? 'crit' : 'ok'}`}>
                {nbErreursVisibles}
              </span>
              {nbErreursVisibles === 0 && nbErreursMasquees === 0 && <span className="variante">{t('aucuneErreur7j', langue)}</span>}
              {nbErreursMasquees > 0 && (
                <button type="button" className="discret bouton-icone-texte" onClick={reafficherErreursVues}>
                  <span>{t('reafficherErreursVues', langue).replace('{n}', String(nbErreursMasquees))}</span>
                </button>
              )}
            </span>
          </div>
          <div className="etat-ligne">
            <span>{t('operationsActivesLibelle', langue)}</span>
            <span className="etat-valeur"><b>{syn.moteur.campagnesActives !== null ? syn.moteur.campagnesActives : '—'}</b></span>
          </div>
          <div className="etat-ligne">
            <span>{t('appelsMois', langue)}</span>
            <span className="etat-valeur">
              <b>{syn.quotasCouts.appelsMois !== null && Number.isFinite(syn.quotasCouts.appelsMois) ? syn.quotasCouts.appelsMois.toLocaleString(locale) : '—'}</b>
            </span>
          </div>
          <div className="etat-ligne">
            <span>{t('freinCampagnes', langue)}</span>
            <span className="etat-valeur">
              <b>{syn.quotasCouts.freinDollars !== null && Number.isFinite(syn.quotasCouts.freinDollars) ? formaterMontant(syn.quotasCouts.freinDollars, locale, 0) : '—'}</b>
            </span>
          </div>
          {syn.quotasCouts.totalCouts && (
            <div className="etat-ligne">
              <span>{t('totalCoutsLibelle', langue)}</span>
              <span className="etat-valeur">
                <b>{Number.isFinite(syn.quotasCouts.totalCouts.dollars) ? formaterMontant(syn.quotasCouts.totalCouts.dollars, locale) : '—'}</b>
                <span className="variante">{syn.quotasCouts.totalCouts.poste}</span>
              </span>
            </div>
          )}
        </div>

        {passesEnCours.length > 0 && (
          <div className="etat-sousbloc">
            <h3>{t('enCoursMaintenantTitre', langue)}</h3>
            <div className="etat-lignes">
              {passesEnCours.map((op) => (
                <div key={op.cle} className="etat-ligne">
                  <span>{op.operation}</span>
                  <span className="etat-valeur"><b>{op.dernierePasse}</b></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="carte etat-classements">
        <h2>{t('statutsIndexTitre', langue)}</h2>
        <div className="statuts-grille">
          <div className="statut-cellule ton-ok"><b>{syn.fichiers.classe.toLocaleString(locale)}</b><span>{t('statutClasse', langue)}</span></div>
          <div className="statut-cellule"><b>{syn.fichiers.aTrier.toLocaleString(locale)}</b><span>{t('statutATrier', langue)}</span></div>
          <div className={'statut-cellule' + (syn.fichiers.aVerifier > 0 ? ' ton-attn' : '')}><b>{syn.fichiers.aVerifier.toLocaleString(locale)}</b><span>{t('aVerifierCourt', langue)}</span></div>
          <div className="statut-cellule"><b>{syn.fichiers.doublon.toLocaleString(locale)}</b><span>{t('statutDoublon', langue)}</span></div>
          <div className="statut-cellule"><b>{syn.fichiers.manuel.toLocaleString(locale)}</b><span>{t('statutManuel', langue)}</span></div>
          <div className={'statut-cellule' + (syn.fichiers.quarantaineOuErreur > 0 ? ' ton-crit' : '')}><b>{syn.fichiers.quarantaineOuErreur.toLocaleString(locale)}</b><span>{t('statutErreur', langue)}</span></div>
          <div className={'statut-cellule' + (syn.fichiers.confianceBasse > 0 ? ' ton-attn' : '')}><b>{syn.fichiers.confianceBasse.toLocaleString(locale)}</b><span>{t('statutConfianceBasse', langue)}</span></div>
          <div className="statut-cellule"><b>{syn.fichiers.technique.toLocaleString(locale)}</b><span>{t('statutTechnique', langue)}</span></div>
          <div className="statut-cellule"><b>{syn.fichiers.media.toLocaleString(locale)}</b><span>{t('statutMedia', langue)}</span></div>
        </div>

        <div className="etat-sousbloc">
          <h3>{t('triGmailLibelle', langue)}</h3>
          <div className="statuts-grille">
            <div className="statut-cellule ton-ok"><b>{syn.gmail.tries.toLocaleString(locale)}</b><span>{t('triFilsTriesLibelle', langue)}</span></div>
            <div className={'statut-cellule' + (syn.gmail.aVerifier > 0 ? ' ton-attn' : '')}><b>{syn.gmail.aVerifier.toLocaleString(locale)}</b><span>{t('triAVerifier', langue)}</span></div>
            <div className={'statut-cellule' + (syn.gmail.suspects > 0 ? ' ton-attn' : '')}><b>{syn.gmail.suspects.toLocaleString(locale)}</b><span>{t('triSuspects', langue)}</span></div>
            <div className={'statut-cellule' + (syn.gmail.erreurs > 0 ? ' ton-crit' : '')}><b>{syn.gmail.erreurs.toLocaleString(locale)}</b><span>{t('triErreurs', langue)}</span></div>
            <div className={'statut-cellule' + (syn.gmail.importantsAFaire > 0 ? ' ton-accent' : '')}><b>{syn.gmail.importantsAFaire.toLocaleString(locale)}</b><span>{t('mailATraiter', langue)}</span></div>
            <div className="statut-cellule">
              <b>{archivesMesurees ? archivesJour.toLocaleString(locale) : '—'}</b>
              <span>{t('triArchivesJour', langue)}</span>
            </div>
          </div>
          <p className="variante note-archivage">
            {t(archivesMesurees ? 'archivageMesureNote' : 'archivageHonneteNote', langue)}
          </p>
        </div>
      </section>

      <section className="carte etat-revue-carte etat-bento-droite">
        <h2>
          {t('fileRevueTitre', langue)} <span className="badge">{syn.fileRevue.total}</span>
        </h2>
        {syn.fileRevue.total === 0 && (
          <p className="revue-tout-bon">
            <span className="pastille ok">{t('toutEstAJour', langue)}</span>
          </p>
        )}
        <div className="etat-lignes">
          <div className="etat-ligne">
            <span>{t('triSuspects', langue)}</span>
            <span className="etat-valeur">
              <b className={syn.fileRevue.suspects > 0 ? 'attention' : undefined}>{syn.fileRevue.suspects}</b>
            </span>
          </div>
          <div className="etat-ligne">
            <span>{t('aVerifierCourt', langue)}</span>
            <span className="etat-valeur">
              <b className={syn.fileRevue.aVerifier > 0 ? 'attention' : undefined}>{syn.fileRevue.aVerifier}</b>
            </span>
          </div>
          <div className="etat-ligne">
            <span>{t('mailATraiter', langue)}</span>
            <span className="etat-valeur">
              <b className={syn.fileRevue.importants > 0 ? 'accent' : undefined}>{syn.fileRevue.importants}</b>
            </span>
          </div>
          {syn.fileRevue.reorgDisponible && (
            <>
              <div className="etat-ligne">
                <span>{t('reorgAValider', langue)}</span>
                <span className="etat-valeur"><b>{syn.fileRevue.reorgPropositions ?? '—'}</b></span>
              </div>
              <div className="etat-ligne">
                <span>{t('dossiersVidesCourt', langue)}</span>
                <span className="etat-valeur"><b>{syn.fileRevue.videsCandidats ?? '—'}</b></span>
              </div>
              {(syn.fileRevue.videsBloquees ?? 0) > 0 && (
                <div className="etat-ligne">
                  <span>{t('videsBloqueesLibelle', langue)}</span>
                  <span className="etat-valeur"><b>{syn.fileRevue.videsBloquees}</b></span>
                </div>
              )}
              {(syn.fileRevue.reorgRefus ?? 0) > 0 && (
                <div className="etat-ligne">
                  <span>{t('reorgRefusesLibelle', langue)}</span>
                  <span className="etat-valeur"><b className="erreur">{syn.fileRevue.reorgRefus}</b></span>
                </div>
              )}
            </>
          )}
        </div>
        {onAller && (actionsAccueilUrgentes > 0 || actionsDocumentsDisponibles > 0) && (
          <div className="etat-actions-revue">
            {actionsAccueilUrgentes > 0 && (
              <button type="button" className="discret bouton-icone-texte" onClick={() => onAller('aujourdhui')}>
                <span>{t('ouvrirAujourdhui', langue)}</span>
                <Icone nom="chevron" />
              </button>
            )}
            {actionsDocumentsDisponibles > 0 && (
              <button type="button" className="discret bouton-icone-texte" onClick={() => onAller('documents')}>
                <span>{t('ouvrirDocuments', langue)}</span>
                <Icone nom="chevron" />
              </button>
            )}
          </div>
        )}
      </section>

      <section className="carte etat-logique" aria-label={t('logiqueTitre', langue)}>
        <h2>{t('logiqueTitre', langue)}</h2>
        <div className="logique-grille">
          <div className="logique-bloc">
            <h3><Icone nom="dossier" /> {t('logiqueDriveTitre', langue)}</h3>
            <ul className="logique-liste">
              {([
                ['logiqueDriveSourcesTitre', 'logiqueDriveSourcesTexte'],
                ['logiqueDriveFiltresTitre', 'logiqueDriveFiltresTexte'],
                ['logiqueDriveAnalyseTitre', 'logiqueDriveAnalyseTexte'],
                ['logiqueDriveSecuriteTitre', 'logiqueDriveSecuriteTexte'],
              ] as const).map(([titreCle, texteCle]) => (
                <li key={titreCle}><b>{t(titreCle, langue)} :</b> {t(texteCle, langue)}</li>
              ))}
            </ul>
          </div>
          <div className="logique-bloc">
            <h3><Icone nom="mail" /> {t('logiqueGmailTitre', langue)}</h3>
            <ul className="logique-liste">
              {([
                ['logiqueGmailPerimetreTitre', 'logiqueGmailPerimetreTexte'],
                ['logiqueGmailLibellesTitre', 'logiqueGmailLibellesTexte'],
                ['logiqueGmailArchivageTitre', 'logiqueGmailArchivageTexte'],
                ['logiqueGmailSecuriteTitre', 'logiqueGmailSecuriteTexte'],
              ] as const).map(([titreCle, texteCle]) => (
                <li key={titreCle}><b>{t(titreCle, langue)} :</b> {t(texteCle, langue)}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

const LIBELLES_STATUT: Record<FamilleStatut, CleTexte> = {
  encours: 'stEnCours', recensement: 'stRecensement', attente: 'stEnAttente',
  suspendu: 'stSuspendu', pause: 'stPause', termine: 'stTermine',
  erreur: 'stErreur', inactif: 'stInactif', ajour: 'stAJour',
};
