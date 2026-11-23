/**
 * ActionsMoteur.tsx — helpers partagés de synchro et passage immédiat moteur (`Etat` & `Reglages`).
 */
import { useState } from 'react';
import { demanderPassageMoteur } from '../google';
import { erreurSimple } from '../erreurSimple';
import { Langue, t } from '../i18n';

export interface RetourSynchro { type: 'ok' | 'erreur' | 'aucun'; texte: string; }

/** Formate une heure avec secondes pour distinguer deux synchros rapprochées. */
export function formaterHeureExacte(date: Date | null, langue: Langue): string {
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(langue === 'fr' ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Retour après clic sur Synchro / Rafraîchir (erreur toujours prioritaire). */
export function messageRetourSynchro(args: {
  enCours: boolean; tente: boolean; dateAffichee: Date | null;
  erreurLocale: string; erreurGlobale: string; langue: Langue;
}): RetourSynchro {
  if (args.enCours || !args.tente) return { type: 'aucun', texte: '' };
  const brut = args.erreurLocale || args.erreurGlobale;
  if (brut) return { type: 'erreur', texte: `${t('erreur', args.langue)} : ${erreurSimple(brut, args.langue).slice(0, 180)}` };
  if (!args.dateAffichee) return { type: 'aucun', texte: '' };
  return { type: 'ok', texte: t('synchroAJour', args.langue).replace('{heure}', formaterHeureExacte(args.dateAffichee, args.langue)) };
}

/** Déclenche un passage immédiat du moteur (`action=tick`) avec état UI. */
export function usePassageMoteur(langue: Langue) {
  const [enCours, setEnCours] = useState(false);
  const [retour, setRetour] = useState('');
  const [erreur, setErreur] = useState('');

  async function lancer() {
    if (enCours) return;
    setEnCours(true);
    setRetour('');
    setErreur('');
    try {
      const propre = (await demanderPassageMoteur()).trim();
      setRetour(propre && propre !== 'passage lancé' ? `${t('passageLanceOk', langue)} (${propre})` : t('passageLanceOk', langue));
    } catch (e) {
      setErreur(`${t('erreur', langue)} : ${erreurSimple(String(e), langue).slice(0, 180)}`);
    } finally {
      setEnCours(false);
    }
  }

  return { enCours, retour, erreur, lancer };
}
