/**
 * Copilote.tsx — onglet Copilote (Lot 1B : socle « Actions utiles de la semaine » #20
 * et fil « Ce qui a bougé dans ton Drive » #4 avec filtres rapides).
 */

import { useState } from 'react';
import type { Section } from '../navigation';
import { useEtatGlobal } from '../etatGlobal';
import { EntetePage, IndicateurChargement } from '../composants/UI';
import { Icone, type NomIcone } from '../composants/Icone';
import {
  extraireMouvementsDrive,
  filtrerMouvementsDrive,
  syntheseSemaineCopilote,
  type CategorieMouvementDrive,
  type FiltreMouvementDrive,
  type MouvementDrive,
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

function metaMouvement(m: MouvementDrive, locale: string): string {
  const dateFormatee = formaterDateCourte(m.date, locale);
  return [m.chemin, m.detail, dateFormatee !== '—' ? dateFormatee : m.date].filter(Boolean).join(' · ');
}

export function Copilote({ langue, onAller }: { langue: Langue; onAller: (s: Section) => void }) {
  const { donnees } = useEtatGlobal();
  const [filtre, setFiltre] = useState<FiltreMouvementDrive>('tous');
  if (!donnees) return <IndicateurChargement langue={langue} />;

  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const tousMouvements = extraireMouvementsDrive(donnees, { limite: Number.MAX_SAFE_INTEGER });
  const synthese = syntheseSemaineCopilote(tousMouvements);
  const mouvements = tousMouvements.slice(0, 50);
  const visibles = filtrerMouvementsDrive(mouvements, filtre);

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
