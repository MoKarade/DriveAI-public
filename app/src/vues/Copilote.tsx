/**
 * Copilote.tsx — onglet Copilote (Lot 1B : socle « Actions utiles de la semaine » #20
 * et fil « Ce qui a bougé dans ton Drive » #4 avec filtres rapides).
 */

import { Fragment, useState, type FormEvent } from 'react';
import type { Section } from '../navigation';
import { useEtatGlobal } from '../etatGlobal';
import { annulerActionMoteur, creerPackCopilote, executerDecisionCopilote, gererRegleCopilote, majChecklistCopilote, poserQuestionCopilote, type DecisionCopilote, type ReponseCopilotePack, type ReponseCopiloteQuestion } from '../google';
import { BanniereErreur, EntetePage, IndicateurChargement } from '../composants/UI';
import { Fiche360 } from '../composants/Fiche360';
import { Icone, type NomIcone } from '../composants/Icone';
import { construireActionsSemaine, construireFiches360, construireVueSignauxCopilote, extraireMouvementsDrive, filtrerMouvementsDrive, formaterMontantSignal, interpreterCartesCopilote, interpreterChecklistsCopilote, interpreterEntites, interpreterLiens, interpreterReglesCopilote, interpreterSignaux, liensPourCarte, peutPasserEnAuto, syntheseSemaineCopilote, urlDriveSure, type CarteCopilote, type CategorieMouvementDrive, type ChecklistCopilote, type FiltreMouvementDrive, type MouvementDrive, type RegleCopilote, type SignalRepli, type TypeCarteCopilote } from '../copilote';
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
  const [question, setQuestion] = useState('');
  const [reponseQ, setReponseQ] = useState<ReponseCopiloteQuestion | null>(null);
  const [cochesLocaux, setCochesLocaux] = useState<Record<string, boolean>>({});
  const [packsCrees, setPacksCrees] = useState<Record<string, ReponseCopilotePack>>({});
  const [phraseRegle, setPhraseRegle] = useState('');
  const [reglesLocaux, setReglesLocaux] = useState<Record<string, { auto?: boolean; supprime?: boolean }>>({});
  const [reglesCreees, setReglesCreees] = useState<RegleCopilote[]>([]);
  if (!donnees) return <IndicateurChargement langue={langue} />;

  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const tousMouvements = extraireMouvementsDrive(donnees, { limite: Number.MAX_SAFE_INTEGER });
  const synthese = syntheseSemaineCopilote(tousMouvements);
  const mouvements = tousMouvements.slice(0, 50);
  const visibles = filtrerMouvementsDrive(mouvements, filtre);
  const liens = interpreterLiens(donnees.liensBrut);
  const signaux = interpreterSignaux(donnees.signauxBrut);
  const vue = construireVueSignauxCopilote(interpreterCartesCopilote(donnees.copiloteBrut), signaux, statutsLocaux);
  const checklists = interpreterChecklistsCopilote(donnees.copiloteBrut, cochesLocaux);
  const fiches = construireFiches360({ index: donnees.index, signaux, liens, entites: interpreterEntites(donnees.entitesBrut) });
  const reglesBase = interpreterReglesCopilote(donnees.copiloteBrut, reglesLocaux);
  const idsBase = new Set(reglesBase.map((r) => r.id));
  const regles = [...reglesCreees.filter((r) => !idsBase.has(r.id) && !reglesLocaux[r.id]?.supprime).map((r) => ({ ...r, auto: reglesLocaux[r.id]?.auto ?? r.auto })), ...reglesBase];
  const actionsSemaine = construireActionsSemaine({ vueSignaux: vue, checklists, regles, fiches });
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
  const soumettreQuestion = (e: FormEvent) => { e.preventDefault(); const q = question.trim().slice(0, 300); if (q) void executer('question', async () => setReponseQ(await poserQuestionCopilote(q))); };
  const basculerCheck = (c: ChecklistCopilote, cle: string, coche: boolean) => executer(`chk-${c.id}-${cle}`, async () => {
    const rep = await majChecklistCopilote({ checklistId: c.id, demarche: c.demarche, item: cle, coche });
    setCochesLocaux((prev) => ({ ...prev, [`${c.id}|${cle}`]: coche })); setRetour({ texte: rep.message || t('copiloteActionOk', langue), actionIds: [] });
  });
  const lancerPack = (cle: string, pack: string, fileIds?: string[], titre?: string) => executer(`pack-${cle}`, async () => {
    const rep = await creerPackCopilote({ pack, ...(fileIds?.length ? { fileIds } : {}), ...(titre ? { titre } : {}) });
    setPacksCrees((prev) => ({ ...prev, [cle]: rep })); setRetour({ texte: rep.message || t('copiloteActionOk', langue), actionIds: [] });
  });
  const soumettreRegle = (e: FormEvent) => {
    e.preventDefault(); const p = phraseRegle.trim().slice(0, 240);
    if (p.length >= 5) void executer('regle-creer', async () => {
      const rep = await gererRegleCopilote({ mode: 'creer', phrase: p }); setPhraseRegle('');
      if (rep.regleId) setReglesCreees((prev) => [{ id: rep.regleId!, phrase: p, domaine: '', chemin: '', auto: Boolean(rep.auto), validations: 0, statut: rep.auto ? 'auto' : 'proposé', canal: 'les-deux', action: 'deplacer', zoneProtegee: false }, ...prev.filter((x) => x.id !== rep.regleId)]);
      setRetour({ texte: rep.message || t('copiloteActionOk', langue), actionIds: [] });
    });
  };
  const agirRegle = (r: RegleCopilote, mode: 'basculer-auto' | 'supprimer-auto') => executer(`reg-${r.id}`, async () => {
    const rep = await gererRegleCopilote({ mode, regleId: r.id });
    setReglesLocaux((prev) => ({ ...prev, [r.id]: mode === 'supprimer-auto' ? { supprime: true } : { auto: rep.auto ?? !r.auto } }));
    setRetour({ texte: rep.message || t('copiloteActionOk', langue), actionIds: [] });
  });

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
        {actionsSemaine.length > 0 && <>
          <p className="explication"><b>{t('copiloteSemaineActions', langue)}</b></p>
          <ul className="copilote-liste">{actionsSemaine.map((a) => <li key={a.id}><span className={'pastille ' + (a.priorite === 1 ? 'attn' : a.priorite === 2 ? 'cat' : 'douce')}>P{a.priorite}</span><span><b>{a.titre}</b>{a.detail ? ` · ${a.detail}` : ''}</span></li>)}</ul>
        </>}
        <div className="copilote-pied">
          <p className="explication">{t('copiloteSemaineNote', langue)}</p>
          <button type="button" className="bouton-ligne" onClick={() => onAller('documents')}>
            {t('ouvrirDocuments', langue)} <Icone nom="chevron" className="chev" />
          </button>
        </div>
      </section>

      <BanniereErreur langue={langue} erreur={erreurAction} onFermer={() => setErreurAction('')} />
      {retour && <p className="bandeau-ok" role="status"><span>{retour.texte}</span>{retour.actionIds.length > 0 && <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void annulerDerniere(retour.actionIds)}>{t('annulerAction', langue)}</button>}</p>}

      <section className="copilote-cartes">
        <form className="recherche" onSubmit={soumettreQuestion}>
          <Icone nom="recherche" className="chev" />
          <input type="search" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('copiloteQuestionPlaceholder', langue)} aria-label={t('copiloteQuestionPlaceholder', langue)} />
          <button type="submit" className="recherche-soumettre" disabled={enCoursId !== null || !question.trim()}>{t('copiloteQuestionBtn', langue)}</button>
        </form>
        {reponseQ && (
          <article className="prop-carte">
            <div className="prop-tete"><Icone nom="copilote" className="accent" /><b>{reponseQ.reponse}</b><span className="sp" /><span className="pastille douce">{t(reponseQ.llmUtilise ? 'copiloteQuestionIa' : 'copiloteQuestionLocal', langue)}</span></div>
            {reponseQ.sources && reponseQ.sources.length > 0 && <div className="copilote-liens">{reponseQ.sources.map((s, i) => { const u = urlDriveSure(s.lien); return u ? <a key={`${s.fileId ?? i}`} className="bouton-ligne" href={u} target="_blank" rel="noreferrer">{s.nom} <Icone nom="externe" className="chev" /></a> : <span key={`${s.fileId ?? i}`} className="pastille douce">{s.nom}</span>; })}</div>}
          </article>
        )}
      </section>

      <section className="copilote-cartes">
        <h2 className="titre-liste">{t('copiloteProactifTitre', langue)}{vue.propositions.length > 0 && <span className="badge">{vue.propositions.length}</span>}</h2>
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

      <section className="copilote-cartes">
        <h2 className="titre-liste">{t('copiloteChecklistsTitre', langue)}{checklists.length > 0 && <span className="badge">{checklists.length}</span>}</h2>
        {checklists.length === 0 ? <p className="explication">{t('copiloteChecklistsVide', langue)}</p> : checklists.map((c) => {
          const packRes = packsCrees[c.id], packUrl = urlDriveSure(packRes?.dossierUrl), fids = c.items.map((x) => x.fileId).filter((x): x is string => Boolean(x));
          return (<article key={c.id} className="prop-carte">
            <div className="prop-tete"><Icone nom="coche" className="accent" /><b>{c.titre}</b><span className="sp" /><span className="pastille douce">{c.faits}/{c.total}</span>{c.termine && <span className="pastille ok">{t('copiloteTermineBadge', langue)}</span>}</div>
            <div className="copilote-checklist">{c.items.map((it) => (
              <button key={it.cle} type="button" role="checkbox" aria-checked={it.fait} className="copilote-check-item" disabled={enCoursId !== null} onClick={() => void basculerCheck(c, it.cle, !it.fait)}>
                <span className={'copilote-case' + (it.fait ? ' coche' : '')}>{it.fait && <Icone nom="coche" className="chev" />}</span>
                <span className="copilote-check-lib">{it.libelle}{it.nb ? ` (${it.nb})` : ''}</span>
              </button>
            ))}</div>
            <div className="prop-actions">
              <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void lancerPack(c.id, c.packCle, fids, c.titre)}><Icone nom="dossier" className="chev" /> {t('copilotePackBtn', langue)}</button>
              {packUrl && <a className="bouton-ligne" href={packUrl} target="_blank" rel="noreferrer">{t('copilotePackPret', langue).replace('{n}', String(packRes?.nbRaccourcis ?? 0))} <Icone nom="externe" className="chev" /></a>}
            </div>
          </article>);
        })}
      </section>
      <Fiche360 langue={langue} locale={locale} fiches={fiches} enCours={enCoursId !== null} packsCrees={packsCrees} onCreerPack={(cle, pack, fids, titre) => void lancerPack(cle, pack, fids, titre)} />
      <section className="copilote-cartes">
        <h2 className="titre-liste">{t('copiloteReglesTitre', langue)}{regles.length > 0 && <span className="badge">{regles.length}</span>}</h2>
        <form className="recherche" onSubmit={soumettreRegle}><Icone nom="plus" className="chev" /><input type="text" maxLength={240} value={phraseRegle} onChange={(e) => setPhraseRegle(e.target.value)} placeholder={t('copiloteReglePlaceholder', langue)} aria-label={t('copiloteReglePlaceholder', langue)} /><button type="submit" className="recherche-soumettre" disabled={enCoursId !== null || phraseRegle.trim().length < 5}>{t('copiloteRegleCreer', langue)}</button></form>
        {regles.length === 0 ? <p className="explication">{t('copiloteReglesVide', langue)}</p> : regles.map((r) => (
          <article key={r.id} className="prop-carte">
            <div className="prop-tete"><Icone nom="copilote" className="accent" /><b>{r.phrase}</b><span className="sp" /><span className="pastille douce">{t('copiloteRegleVal', langue).replace('{n}', String(r.validations))}</span><span className={r.auto ? 'pastille ok' : 'pastille douce'}>{t(r.auto ? 'copiloteBadgeAuto' : 'copiloteReglePropose', langue)}</span>{r.zoneProtegee && <span className="pastille attn"><Icone nom="cadenas" className="chev" /> {t('copiloteLectureSeule', langue)}</span>}</div>
            {(r.chemin || r.domaine) && <div className="prop-chemin">{r.chemin || r.domaine}</div>}
            <div className="prop-actions">
              {!r.zoneProtegee && <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void agirRegle(r, 'basculer-auto')}>{t(r.auto ? 'copiloteRegleCouper' : 'copiloteRegleActiver', langue)}</button>}
              <button type="button" className="bouton-ligne" disabled={enCoursId !== null} onClick={() => void agirRegle(r, 'supprimer-auto')}>{t('copiloteRegleSuppr', langue)}</button>
            </div>
          </article>
        ))}
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
