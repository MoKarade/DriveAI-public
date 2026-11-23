/**
 * UI.tsx — petits composants MUTUALISÉS (P1/C28-03) : états de chargement et d'erreur homogènes,
 * à la place des `<p>chargement</p>` nus et des `String(e)` techniques éparpillés dans les vues.
 */

import { type ReactNode } from 'react';
import { Langue, t } from '../i18n';
import { erreurSimple } from '../erreurSimple';
import { Icone } from './Icone';

export function IndicateurChargement({ langue }: { langue: Langue }) {
  return <p className="chargement">{t('chargement', langue)}</p>;
}

/**
 * En-tête de vue épuré (aligné sur `.gf-page-header` de FinanceAI : badge mono discret,
 * titre h1 net, sous-titre et actions éventuelles à droite).
 */
export function EntetePage({ etiquette, titre, sousTitre, badge, actions }: {
  etiquette?: string;
  titre: string;
  sousTitre?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="gf-page-header">
      <div className="gf-page-header-corps">
        <div className="gf-page-header-ligne">
          {etiquette && <span className="gf-ticker-symbol">{etiquette}</span>}
          <h1 className="gf-page-titre">{titre}</h1>
          {badge}
        </div>
        {sousTitre && <p className="gf-page-sous-titre">{sousTitre}</p>}
      </div>
      {actions && <div className="gf-page-actions">{actions}</div>}
    </header>
  );
}

/**
 * Bandeau d'erreur avec « Réessayer » optionnel. Le message technique reste visible (utile au
 * diagnostic) mais borné — jamais un pavé de stack.
 */
export function BanniereErreur({ langue, erreur, onReessayer, onFermer }: {
  langue: Langue;
  erreur: string;
  onReessayer?: () => void;
  /** Cache seulement le bandeau (ne relance rien) : bouton « Fermer », pas « Réessayer ». */
  onFermer?: () => void;
}) {
  if (!erreur) return null;
  return (
    <p className="erreur bandeau-erreur" role="alert">
      <span>{t('erreur', langue)} : {erreurSimple(erreur, langue).slice(0, 200)}</span>
      {onReessayer && (
        <button className="discret" onClick={onReessayer}>
          <Icone nom="rafraichir" /> {t('reessayer', langue)}
        </button>
      )}
      {onFermer && (<button className="discret" onClick={onFermer}>{t('fermer', langue)}</button>)}
    </p>
  );
}
