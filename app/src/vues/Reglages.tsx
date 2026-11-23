/**
 * Reglages.tsx — préférences applicatives (P0-2, P2-1) : fréquence des passages du moteur,
 * choix du thème (sombre par défaut / clair « Google Light »), langue, synchronisation manuelle
 * et déconnexion. La santé du moteur, les quotas et les coûts vivent dans `Etat.tsx`.
 * Les réglages indépendants de la Sheet restent utilisables même quand `!donnees` (ex. erreur 403).
 */

import { useState } from 'react';
import { confirmer, messageDeconnexion } from '../confirmation';
import { ecrireCellule } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { formaterHeureExacte, messageRetourSynchro, usePassageMoteur } from '../composants/ActionsMoteur';
import { EntetePage, IndicateurChargement } from '../composants/UI';
import { Icone } from '../composants/Icone';
import { Langue, t } from '../i18n';
import { ThemeApp, appliquerThemeDom, enregistrerTheme, lireTheme } from '../theme';

// Whitelist 5/10/15/30 — les mêmes valeurs que le moteur accepte (validerTickMinutes_).
const TICKS_MINUTES = [5, 10, 15, 30];

export function Reglages({ langue, onLangue, onDeconnexion, theme, onTheme }: {
  langue: Langue;
  onLangue: () => void;
  onDeconnexion: () => void;
  theme?: ThemeApp;
  onTheme?: (t: ThemeApp) => void;
}) {
  const { donnees, erreur, synchroA, rafraichir } = useEtatGlobal();
  const [synchroEnCours, setSynchroEnCours] = useState(false); // icône synchro tourne pendant le rafraîchissement
  const [synchroTente, setSynchroTente] = useState(false);
  const [erreurSynchro, setErreurSynchro] = useState('');
  const [synchroLocaleA, setSynchroLocaleA] = useState<Date | null>(null);
  const [themeLocal, setThemeLocal] = useState<ThemeApp>(lireTheme);
  const passage = usePassageMoteur(langue);
  const heureSynchro = formaterHeureExacte(synchroA ?? synchroLocaleA, langue);
  const retourSynchro = messageRetourSynchro({
    enCours: synchroEnCours, tente: synchroTente, dateAffichee: synchroLocaleA ?? synchroA,
    erreurLocale: erreurSynchro, erreurGlobale: erreur, langue,
  });
  const themeActif = theme ?? themeLocal;

  function choisirTheme(nouveau: ThemeApp) {
    if (onTheme) {
      onTheme(nouveau);
    } else {
      enregistrerTheme(nouveau);
      appliquerThemeDom(nouveau);
      setThemeLocal(nouveau);
    }
  }

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

  // Les réglages qui ne dépendent PAS de la Sheet (thème, langue, synchro, déconnexion) restent
  // accessibles même quand la première lecture échoue (403 de scope, quota) — se déconnecter pour
  // re-consentir est justement le remède (revue flotte PR 0, 🟠).
  const blocsReglages = (
    <>
      <section className="carte">
        <h2><Icone nom="horloge" /> {t('sectionMoteurSynchro', langue)}</h2>
        <div className="reglage-lignes">
          <div className="reglage-ligne">
            <div className="reglage-info">
              <b>{t('synchro', langue)}</b>
              <small>{t('derniereLecture', langue).replace('{heure}', heureSynchro)} · {t('descSynchro', langue)}</small>
              {retourSynchro.type !== 'aucun' && (
                <p className={`reglage-retour ${retourSynchro.type}`} role={retourSynchro.type === 'erreur' ? 'alert' : 'status'}>
                  {retourSynchro.texte}
                </p>
              )}
            </div>
            <div className="reglage-controle">
              <button type="button" className="discret bouton-icone-texte" disabled={synchroEnCours} aria-busy={synchroEnCours} title={t('rafraichir', langue)} onClick={lancerSynchro}>
                <span className={synchroEnCours ? 'icone-tourne' : undefined} aria-hidden="true"><Icone nom="rafraichir" /></span>
                <span>{synchroEnCours ? t('synchroEnCoursLibelle', langue) : t('rafraichir', langue)}</span>
              </button>
            </div>
          </div>
          <div className="reglage-ligne">
            <div className="reglage-info">
              <b>{t('passageImmediatLibelle', langue)}</b>
              <small>{t('descPassageImmediat', langue)}</small>
              {passage.retour && <p className="reglage-retour ok" role="status">{passage.retour}</p>}
              {passage.erreur && <p className="reglage-retour erreur" role="alert">{passage.erreur}</p>}
            </div>
            <div className="reglage-controle">
              <button type="button" className="bouton-ligne principal" disabled={passage.enCours} aria-busy={passage.enCours} onClick={() => void passage.lancer()}>
                <Icone nom="horloge" />
                <span>{passage.enCours ? t('lancementPassage', langue) : t('lancerPassage', langue)}</span>
              </button>
            </div>
          </div>
          {/* `key` : remonté quand la valeur réelle arrive (le composant existe déjà avant les données). */}
          <FrequenceLigne key={donnees?.reglagesBrut?.[0]?.[1] ?? ''} langue={langue} valeurInitiale={donnees?.reglagesBrut?.[0]?.[1] ?? ''} />
        </div>
      </section>

      <section className="carte">
        <h2><Icone nom="reglages" /> {t('sectionApparence', langue)}</h2>
        <div className="reglage-lignes">
          <div className="reglage-ligne">
            <div className="reglage-info">
              <b>{t('themeLibelle', langue)}</b>
              <small>{t('descTheme', langue)}</small>
            </div>
            <div className="reglage-controle">
              <div className="portee-bascule" role="group" aria-label={t('themeLibelle', langue)}>
                {(['sombre', 'clair'] as const).map((th) => (
                  <button key={th} type="button" className={'pilule-portee' + (themeActif === th ? ' actif' : '')} aria-pressed={themeActif === th} onClick={() => choisirTheme(th)}>
                    <span className="portee-texte">{t(th === 'sombre' ? 'themeSombre' : 'themeClair', langue)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="reglage-ligne">
            <div className="reglage-info">
              <b>{t('langueLibelle', langue)}</b>
              <small>{t('descLangue', langue)}</small>
            </div>
            <div className="reglage-controle">
              <div className="portee-bascule" role="group" aria-label={t('langueLibelle', langue)}>
                {(['fr', 'en'] as const).map((l) => (
                  <button key={l} type="button" className={'pilule-portee' + (langue === l ? ' actif' : '')} aria-pressed={langue === l} onClick={() => { if (langue !== l) onLangue(); }}>
                    <span className="portee-texte">{l === 'fr' ? 'Français' : 'English'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="carte">
        <h2><Icone nom="cadenas" /> {t('sectionCompte', langue)}</h2>
        <div className="reglage-lignes">
          <div className="reglage-ligne">
            <div className="reglage-info">
              <b>{t('session', langue)}</b>
              <small>{t('descSession', langue)}</small>
            </div>
            <div className="reglage-controle">
              <button type="button" className="discret danger" onClick={() => { if (confirmer(messageDeconnexion(langue))) onDeconnexion(); }}>{t('deconnexion', langue)}</button>
            </div>
          </div>
        </div>
      </section>
    </>
  );

  return (
    <div className="colonnes">
      <EntetePage etiquette="DriveAI" titre={t('reglages', langue)} sousTitre={t('sousTitrePreferences', langue)} />
      {!donnees && <IndicateurChargement langue={langue} />}
      {blocsReglages}
    </div>
  );
}

/**
 * Fréquence des passages (#22, choix Marc : UN réglage global). L'app écrit `Réglages!A2:B2`
 * (contrat de position fixe) ; le moteur relit au tick suivant et ré-installe son déclencheur
 * (assurerIntervalleTick_). Jamais de saisie libre.
 */
function FrequenceLigne({ langue, valeurInitiale }: { langue: Langue; valeurInitiale: string }) {
  const initiale = TICKS_MINUTES.includes(Number(valeurInitiale)) ? String(Number(valeurInitiale)) : '5';
  const [tick, setTick] = useState(initiale);
  const [statut, setStatut] = useState('');

  async function changer(v: string) {
    if (statut === 'encours') return; // une écriture à la fois
    const ancienne = tick;
    setTick(v);
    setStatut('encours');
    try {
      // A2 réécrit aussi (auto-réparation si la clé a été effacée à la main).
      await ecrireCellule('Réglages', 'A2', 'TICK_MINUTES');
      await ecrireCellule('Réglages', 'B2', v);
      setStatut('ok');
    } catch (e) {
      setTick(ancienne); // l'écriture a échoué : on revient à la valeur réellement enregistrée
      setStatut(String(e));
    }
  }

  return (
    <div className="reglage-ligne">
      <div className="reglage-info">
        <b>{t('frequenceTick', langue)}</b>
        <small>{t('descFrequenceTick', langue)}</small>
        {statut === 'encours' && <p className="reglage-retour" role="status">{t('enregistrement', langue)}</p>}
        {statut === 'ok' && <p className="reglage-retour ok" role="status">{t('reglageOk', langue)}</p>}
        {statut && statut !== 'ok' && statut !== 'encours' && <p className="reglage-retour erreur" role="alert">{statut.slice(0, 80)}</p>}
      </div>
      <div className="reglage-controle">
        <select value={tick} disabled={statut === 'encours'} onChange={(e) => changer(e.target.value)} aria-label={t('frequenceTick', langue)}>
          {TICKS_MINUTES.map((m) => (
            <option key={m} value={String(m)}>{t('toutesLes', langue)} {m} min</option>
          ))}
        </select>
      </div>
    </div>
  );
}
