/**
 * Documents.tsx — section Documents v7 (C28-82 PR2) : UN écran, l'explorateur avec sa recherche
 * unique. Les sous-onglets « Drive / Recherche DriveAI » de la v3 (#21) et leurs filtres d'Index
 * ont disparu (décision Marc 2026-09-09 : « quelques boutons simples, moins de déchets »).
 * Depuis le 28/10/2026 il n'y a plus de bouton IA ici ni d'onglet Assistant ; LIA, qui les remplaçait,
 * est retirée depuis le 05/11/2026 (ADR-0074). Les rangements proposés par le moteur (et les dossiers vides à corbeiller) s'affichent en bandeau
 * « À valider » au-dessus de la liste (`ReorgVue`), validés PAR ACTION par Marc (C21-05, ADR-0026).
 */

import { Explorateur, type NavigationExplorateurDemandee } from './Explorateur';
import { ReorgVue } from './Reorg';
import { Langue } from '../i18n';

export function Documents({
  langue,
  cibleExplorateur,
  onCibleConsommee,
}: {
  langue: Langue;
  cibleExplorateur?: NavigationExplorateurDemandee | null;
  onCibleConsommee?: (jeton: number) => void;
}) {
  return (
    <>
      <ReorgVue langue={langue} />
      <Explorateur
        langue={langue}
        cibleExplorateur={cibleExplorateur}
        onCibleConsommee={onCibleConsommee}
      />
    </>
  );
}
