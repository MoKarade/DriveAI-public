import { useState } from 'react';
import { Icone } from './Icone';
import { formaterMontantSignal, urlDriveSure, type Fiche360 as Fiche360Type } from '../copilote';
import type { ReponseCopilotePack } from '../google';
import { t, type Langue } from '../i18n';

export function Fiche360({ langue, locale, fiches, enCours, packsCrees, onCreerPack }: {
  langue: Langue; locale: string; fiches: readonly Fiche360Type[]; enCours: boolean;
  packsCrees: Readonly<Record<string, ReponseCopilotePack>>; onCreerPack: (cle: string, pack: string, fileIds?: string[], titre?: string) => void;
}) {
  const [selId, setSelId] = useState('');
  const active = fiches.find((f) => f.id === selId) ?? fiches[0], packRes = active ? packsCrees[active.id] : undefined, packUrl = urlDriveSure(packRes?.dossierUrl);
  return (
    <section className="copilote-cartes" aria-label={t('copiloteFichesTitre', langue)}>
      <h2 className="titre-liste">{t('copiloteFichesTitre', langue)}{fiches.length > 0 && <span className="badge">{fiches.length}</span>}</h2>
      {!active ? <p className="explication">{t('copiloteFichesVide', langue)}</p> : <>
        <div className="gf-chips" role="tablist" aria-label={t('copiloteFichesTitre', langue)}>
          {fiches.map((f) => <button key={f.id} type="button" role="tab" aria-selected={f.id === active.id} className={'gf-chip' + (f.id === active.id ? ' actif' : '')} onClick={() => setSelId(f.id)}>{f.lectureSeule && <Icone nom="cadenas" className="chev" />}<span>{f.titre}</span></button>)}
        </div>
        <article className="prop-carte">
          <div className="prop-tete"><Icone nom={active.lectureSeule ? 'cadenas' : 'dossier'} className="accent" /><b>{active.titre}</b><span className="sp" />{active.domaine && <span className="pastille douce">{active.domaine}</span>}{active.lectureSeule && <span className="pastille attn"><Icone nom="cadenas" className="chev" /> {t('copiloteLectureSeule', langue)}</span>}</div>
          <div className="fiche360-stats"><span>{t('copiloteFicheDocs', langue).replace('{n}', String(active.nbDocs))}</span><span>{t('copiloteFicheEcheances', langue).replace('{n}', String(active.echeances.length))}</span>{active.totalMontant > 0 && <span>{formaterMontantSignal(active.totalMontant, active.devise, locale)}</span>}</div>
          {active.echeances.length > 0 && <ul className="copilote-liste">{active.echeances.map((e, i) => <li key={`${e.label}-${i}`}><b>{e.label}</b> · {e.date}</li>)}</ul>}
          {active.docs.length > 0 && <div className="copilote-liens">{active.docs.map((d) => { const u = urlDriveSure(d.lienDrive); return u ? <a key={d.fileId} className="bouton-ligne" href={u} target="_blank" rel="noreferrer">{d.nom} <Icone nom="externe" className="chev" /></a> : <span key={d.fileId} className="pastille douce">{d.nom}</span>; })}</div>}
          {active.liensMail.length > 0 && <ul className="copilote-liste">{active.liensMail.map((m) => <li key={`${m.threadId}|${m.fileId}`}>{m.expediteur} · {m.fichier}</li>)}</ul>}
          <div className="prop-actions">
            <button type="button" className="bouton-ligne" disabled={enCours} onClick={() => onCreerPack(active.id, active.titre, active.fileIdsPack, active.titre)}><Icone nom="dossier" className="chev" /> {t('copilotePackBtn', langue)}</button>
            {packUrl && <a className="bouton-ligne" href={packUrl} target="_blank" rel="noreferrer">{t('copilotePackPret', langue).replace('{n}', String(packRes?.nbRaccourcis ?? 0))} <Icone nom="externe" className="chev" /></a>}
          </div>
        </article>
      </>}
    </section>
  );
}
