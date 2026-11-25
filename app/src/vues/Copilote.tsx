/**
 * Copilote.tsx — onglet Copilote (Lot 1B : socle « Actions utiles de la semaine » #20
 * et fil « Ce qui a bougé dans ton Drive » #4 avec filtres rapides).
 */

import { Fragment, useState } from 'react';
import type { Section } from '../navigation';
import { useEtatGlobal } from '../etatGlobal';
import { annulerActionMoteur, executerDecisionCopilote, type DecisionCopilote } from '../google';
import { BanniereErreur, EntetePage, IndicateurChargement } from '../composants/UI';
import { Icone, type NomIcone } from '../composants/Icone';
import {
  construireVueSignauxCopilote, extraireMouvementsDrive, filtrerMouvementsDrive, formaterMontantSignal,
  interpreterCartesCopilote, interpreterLiens, interpreterSignaux, liensPourCarte, peutPasserEnAuto, syntheseSemaineCopilote,
  type CarteCopilote, type CategorieMouvementDrive, type FiltreMouvementDrive, type MouvementDrive, type SignalRepli, type TypeCarteCopilote,
} from '../copilote';
import { formaterDateCourte } from '../explorateur';
import { t, type CleTexte, type Langue } from '../i18n';

const FILTRES: ReadonlyArray<{ id: FiltreMouvementDrive; cle: CleTexte }> = [
  { id: 'tous', cle: 'copiloteFiltreTous' },
  { id: 'dossier', cle: 'copiloteFiltreDossiers' },
  { id: 'fichier', cle: 'copiloteFiltreFichiers' },
  { id: 'apprentissage', cle: 'copiloteFiltreApprentissages' },
];
const ICONES_CATEGORIE: Record<CategorieMouvementDrive, NomIcone> = { dossier: 'dossier', fichier: 'fichier', apprentissage: 'coche' };
const PASTILLES_CATEGORIE: Record<CategorieMouvementDrive, { classe: string; cle: CleTexte }> = {
  dossier: { classe: 'pastille cat', cle: 'copiloteBadgeDossier' },
  fichier: { classe: 'pastille douce', cle: 'copiloteBadgeFichier' },
  apprentissage: { classe: 'pastille ok', cle: 'copiloteBadgeApprentissage' },
};
const TYPES_CARTE_UI: Record<TypeCarteCopilote, { icone: NomIcone; badge: CleTexte; actionCle?: CleTexte; decision?: DecisionCopilote }> = {
  cascade: { icone: 'deplacer', badge: 'copiloteTypeCascade', actionCle: 'copiloteActionRegrouper', decision: 'executer' },
  'doublon-dossier': { icone: 'dossier', badge: 'copiloteTypeDoublon', actionCle: 'copiloteActionFusionner', decision: 'executer' },
  'dossier-vide': { icone: 'dossier', badge: 'copiloteTypeVide', actionCle: 'copiloteActionArchiver', decision: 'executer' },
  'alerte-corbeille': { icone: 'alerte', badge: 'copiloteTypeCorbeille', actionCle: 'copiloteActionRestaurer', decision: 'restaurer' },
  'demarche-active': { icone: 'copilote', badge: 'copiloteTypeDemarche' },
  expiration: { icone: 'horloge', badge: 'copiloteTypeExpiration' },
  'piece-manquante': { icone: 'alerte', badge: 'copiloteTypePieceManquante' },
  'facture-hausse': { icone: 'alerte', badge: 'copiloteTypeFactureHausse' },
  'facture-doublon': { icone: 'fichier', badge: 'copiloteTypeFactureDoublon' },
  renouvellement: { icone: 'horloge', badge: 'copiloteTypeRenouvellement' },
  remboursement: { icone: 'coche', badge: 'copiloteTypeRemboursement', actionCle: 'copiloteActionReclame', decision: 'reclame' },
  'retour-garantie': { icone: 'horloge', badge: 'copiloteTypeRetourGarantie' },
};

function metaMouvement(m: MouvementDrive, locale: string): string {
  const dateFormatee = formaterDateCourte(m.date, locale);
  return [m.chemin, m.detail, dateFormatee !== '—' ? dateFormatee : m.date].filter(Boolean).join(' · ');
}

export function Copilote({ langue, onAller }: { langue: Langue; onAller: (s: Section) => void }) {
  const { donnees, rafraichir } = useEtatGlobal();
  const [filtre, setFiltre] = useState<FiltreMouvementDrive>('tous');
  const [enCoursId, setEnCoursId] = useState<string | null>(null);
  const [statutsLocaux, setStatutsLocaux] = useState<Record<string, string>>({});
  const [retour, setRetour] = useState<{ texte: string; actionIds: string[] } | null>(null);
  const [erreurAction, setErreurAction] = useState('');
  if (!donnees) return <IndicateurChargement langue={langue} />;

  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const tousMouvements = extraireMouvementsDrive(donnees, { limite: Number.MAX_SAFE_INTEGER });
  const synthese = syntheseSemaineCopilote(tousMouvements);
  const mouvements = tousMouvements.slice(0, 50);
  const visibles = filtrerMouvementsDrive(mouvements, filtre);
  const liens = interpreterLiens(donnees.liensBrut);
  const vue = construireVueSignauxCopilote(interpreterCartesCopilote(donnees.copiloteBrut), interpreterSignaux(donnees.signauxBrut), statutsLocaux);
  const repliExp = vue.signauxRepli.filter((s) => s.section === 'expiration'), repliArg = vue.signauxRepli.filter((s) => s.section === 'argent');
  const totalArgent = vue.totauxAReclamer.map((x) => formaterMontantSignal(x.montant, x.devise, locale)).join(' + ');
  const rendreRepli = (s: SignalRepli) => (
    <article key={s.id} className="prop-carte">
      <div className="prop-tete"><Icone nom={s.section === 'expiration' ? 'horloge' : 'coche'} className="accent" /><b>{s.titre}</b><span className="sp" />{s.montant ? <span className="pastille ok">{formaterMontantSignal(s.montant, s.devise, locale)}</span> : null}<span className="pastille douce">{t(s.section === 'expiration' ? 'copiloteTypeExpiration' : 'copiloteAReclamerBadge', langue)}</span></div>
      {s.chemin && <div className="prop-chemin">{s.chemin}</div>}
      <div className="prop-actions"><a className="bouton-ligne" href={s.lienDrive} target="_blank" rel="noreferrer">{t('copiloteOuvrirFichier', langue)} <Icone nom="externe" className="chev" /></a></div>
    </article>
  );

  async function executer(cle: string, fn: () => Promise<void>) {
    if (enCoursId) return;
    setEnCoursId(cle); setErreurAction('');
    try { await fn(); void rafraichir(true).catch(() => {}); } catch (e) { setErreurAction(String(e)); } finally { setEnCoursId(null); }
  }
  const agir = (id: string, decision: DecisionCopilote) => executer(id, async () => {
    setRetour(null); const rep = await executerDecisionCopilote(id, decision);
    if (rep.statut) setStatutsLocaux((prev) => ({ ...prev, [id]: rep.statut! }));
    setRetour({ texte: rep.message || t('copiloteActionOk', langue), actionIds: rep.actionIds ?? [] });
  });
  const annulerDerniere = (actionIds: string[]) => actionIds.length ? executer('undo', async () => {
    for (const aid of actionIds) await annulerActionMoteur(aid);
    setRetour({ texte: t('actionAnnuleeOk', langue), actionIds: [] });
  }) : Promise.resolve();

  return (
    <div className="colonnes copilote-vue">
      <EntetePage etiquette="DriveAI" titre={t('copilote', langue)} sousTitre={t('sousTitreCopilote', langue)} />

      <section className="carte">
        <h2>{t('copiloteSemaineTitre', langue)}</h2>
        <div className="tuiles-3">
          <div className="tuile"><b>{synthese.totalMouvements}</b><small>{t('copiloteStatMouvements', langue)}</small></div>
          <div className="tuile"><b>{synthese.dossiers}</b><small>{t('copiloteStatDossiers', langue)}</small></div>
          <div className="tuile"><b>{synthese.apprentissages}</b><small>{t('copiloteStatApprentissages', langue)}</small></div>
        </div>
        <div className="copilote-pied">
          <p className="explication">{t('copiloteSemaineNote', langue)}</p>
          <button type="button" className="bouton-ligne" onClick={() => onAller('documents')}>
            {t('ouvrirDocuments', langue)} <Icone nom="chevron" className="chev" />
          </button>
        </div>
      </section>

      <section className="copilote-cartes">
        <h2 className="titre-liste">{t('copiloteProactifTitre', langue)}{vue.propositions.length > 0 && <span className="badge">{vue.propositions.length}</span>}</h2>
        <BanniereErreur langue={langue} erreur={erreurAction} onFermer={() => setErreurAction('')} />
        {retour && <p className="bandeau-ok" role="status"><span>{retour.texte}</span>{retour.actionIds.length > 0 && <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void annulerDerniere(retour.actionIds)}>{t('annulerAction', langue)}</button>}</p>}
        {(() => {
          const rendreCarte = (c: CarteCopilote) => {
            const cfg = TYPES_CARTE_UI[c.type], assoc = liensPourCarte(c, liens), echs = Array.isArray(c.action.echeances) ? c.action.echeances : [];
            return (
              <article key={c.id} className="prop-carte">
                <div className="prop-tete"><Icone nom={cfg.icone} className="accent" /><b>{c.titre}</b><span className="sp" /><span className="pastille douce">{t(cfg.badge, langue)}</span>{c.statut === 'auto' && <span className="pastille ok">{t('copiloteBadgeAuto', langue)}</span>}</div>
                {(c.chemin || c.domaine) && <div className="prop-chemin">{c.chemin || c.domaine}</div>}
                {c.type === 'demarche-active' && <>
                  <small>{t('copiloteDemarcheResume', langue).replace('{docs}', String(c.action.nbDocs ?? (c.action.ids?.length || 0))).replace('{mails}', String(c.action.tids?.length || assoc.length))}{echs.length ? ` · ${echs.join(', ')}` : ''}</small>
                  {assoc.length > 0 && <div className="copilote-liens">{assoc.map((l) => <a key={`${l.threadId}|${l.fileId}`} className="bouton-ligne" href={`https://drive.google.com/file/d/${encodeURIComponent(l.fileId)}/view`} target="_blank" rel="noreferrer">{l.fichier || l.expediteur} <Icone nom="externe" className="chev" /></a>)}</div>}
                </>}
                <div className="prop-actions">
                  {cfg.actionCle && cfg.decision && <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void agir(c.id, cfg.decision!)}>{t(cfg.actionCle, langue)}</button>}
                  {c.type !== 'demarche-active' && c.action.fileId && <a className="bouton-ligne" href={`https://drive.google.com/file/d/${encodeURIComponent(c.action.fileId)}/view`} target="_blank" rel="noreferrer">{t('copiloteOuvrirFichier', langue)} <Icone nom="externe" className="chev" /></a>}
                  <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void agir(c.id, 'ignorer')}>{t('copiloteActionIgnorer', langue)}</button>
                  {c.statut === 'auto' ? <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void agir(c.id, 'desactiver-auto')}>{t('copiloteDesactiverAuto', langue)}</button> : peutPasserEnAuto(c) ? <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void agir(c.id, 'passer-auto')}>{t('copilotePasserAuto', langue)}</button> : null}
                </div>
              </article>
            );
          };
          return (<>
            {vue.propositions.length === 0 ? <p className="explication">{t('copiloteAucuneCarte', langue)}</p> : <div className="propositions">{vue.propositions.map(rendreCarte)}</div>}
            {[
              { titre: t('copiloteExpirationsTitre', langue), vide: t('copiloteExpirationsVide', langue), items: vue.expirations, repli: repliExp },
              { titre: t('copiloteFacturesTitre', langue), vide: t('copiloteFacturesVide', langue), items: vue.factures, repli: [] as SignalRepli[] },
              { titre: t('copiloteArgentTitre', langue), vide: t('copiloteArgentVide', langue), items: vue.argent, repli: repliArg, total: totalArgent },
            ].map((sec) => (
              <Fragment key={sec.titre}>
                <h2 className="titre-liste">{sec.titre}{(sec.items.length + sec.repli.length) > 0 && <span className="badge">{sec.items.length + sec.repli.length}</span>}{sec.total && <span className="pastille copilote-total-argent">{t('copiloteTotalAReclamer', langue).replace('{total}', sec.total)}</span>}</h2>
                {(sec.items.length + sec.repli.length) === 0 ? <p className="explication">{sec.vide}</p> : <div className="propositions">{sec.items.map(rendreCarte)}{sec.repli.map(rendreRepli)}</div>}
              </Fragment>
            ))}
          </>);
        })()}
      </section>

      <section>
        <h2 className="titre-liste">
          {t('copiloteFilTitre', langue)}
          {visibles.length > 0 && <span className="badge">{visibles.length}</span>}
        </h2>
        <div className="gf-chips" role="group" aria-label={t('copiloteFiltresLabel', langue)} style={{ marginBottom: '0.65rem' }}>
          {FILTRES.map((f) => (
            <button key={f.id} type="button" className={'gf-chip' + (filtre === f.id ? ' actif' : '')} aria-pressed={filtre === f.id} onClick={() => setFiltre(f.id)}>
              {t(f.cle, langue)}
            </button>
          ))}
        </div>
        <div className="carte lignes">
          {visibles.length === 0 && (
            <p className="ligne vide">{mouvements.length === 0 ? t('copiloteAucunMouvement', langue) : t('copiloteAucunFiltre', langue)}</p>
          )}
          {visibles.map((m) => {
            const pastille = PASTILLES_CATEGORIE[m.categorie];
            const contenu = (
              <>
                <Icone nom={ICONES_CATEGORIE[m.categorie]} className={m.categorie === 'dossier' ? 'accent' : undefined} />
                <span className="t">
                  <b className={m.categorie === 'fichier' ? 'mono' : undefined}>{m.titre}</b>
                  <small>{metaMouvement(m, locale)}</small>
                </span>
                <span className="copilote-badges">
                  <span className={pastille.classe}>{t(pastille.cle, langue)}</span>
                  {m.annule && <span className="pastille attn">{t('actionStatutAnnule', langue)}</span>}
                </span>
                {m.lienDrive && <Icone nom="externe" className="chev" />}
              </>
            );
            return m.lienDrive
              ? <a key={m.id} className="ligne" href={m.lienDrive} target="_blank" rel="noreferrer">{contenu}</a>
              : <div key={m.id} className="ligne">{contenu}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
