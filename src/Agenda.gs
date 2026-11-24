/**
 * Agenda.gs — Rappels d'échéance automatiques dans Google Agenda (ADR-0081, vague 5).
 *
 * Crée un événement journée entière idempotent (`agenda|<filId>|<echeance>` dans `Index`)
 * lorsqu'un courriel sain annonce une vraie échéance future.
 * Zéro copie du contenu d'un courriel (ADR-0007) ; chaque rappel créé est consigné dans
 * `Actions` et tout échec d'autorisation ou d'API reste non bloquant (1 alerte/run).
 */

var _agendaCreesCeRun = 0;
var _agendaErreurSignaleeRun = false;

/**
 * Réinitialise les compteurs d'événements Agenda au début d'un tick.
 */
function reinitialiserAgendaRun_() {
  _agendaCreesCeRun = 0;
  _agendaErreurSignaleeRun = false;
}

/**
 * Valide une date d'échéance `"AAAA-MM-JJ"` comprise entre `dateRef` et `AGENDA_HORIZON_JOURS`. PURE.
 * @param {?Object} analyse
 * @param {Date} [dateRef]
 * @return {string} date validée `"AAAA-MM-JJ"`, ou `''`
 */
function extraireEcheanceAgenda_(analyse, dateRef) {
  if (!analyse || typeof analyse.echeance !== 'string') return '';
  var brut = analyse.echeance.trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(brut);
  if (!m) return '';
  var an = Number(m[1]);
  var mois = Number(m[2]);
  var jour = Number(m[3]);
  var cibleUtc = Date.UTC(an, mois - 1, jour);
  var verif = new Date(cibleUtc);
  if (verif.getUTCFullYear() !== an || verif.getUTCMonth() !== mois - 1 || verif.getUTCDate() !== jour) {
    return '';
  }
  var ref = dateRef instanceof Date && !isNaN(dateRef.getTime()) ? dateRef : new Date();
  var refUtc = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  var diffJours = (cibleUtc - refUtc) / 86400000;
  var horizon = typeof CONFIG !== 'undefined' && CONFIG.AGENDA_HORIZON_JOURS ? CONFIG.AGENDA_HORIZON_JOURS : 365;
  if (diffJours < 0 || diffJours > horizon) return '';
  return brut;
}

/**
 * Construit un titre court et sûr pour Google Agenda sans exposer de contenu sensible. PURE.
 * @param {?Object} analyse
 * @param {string} [categorie]
 * @param {boolean} [zoneProtegee]
 * @return {string}
 */
function construireTitreAgenda_(analyse, categorie, zoneProtegee) {
  var cat = String(categorie || '').trim();
  if (zoneProtegee) {
    return ('DriveAI · Échéance ' + (cat || 'à vérifier')).slice(0, 80);
  }
  var res = analyse && typeof analyse.resume === 'string'
    ? analyse.resume.replace(/\s+/g, ' ').trim()
    : '';
  var titre = 'DriveAI · ' + (cat || 'Échéance') + (res ? ' — ' + res : '');
  return titre.slice(0, 80);
}

/**
 * Crée un rappel journée entière dans Google Agenda si l'échéance et toutes les gardes passent.
 * Défauts locaux (`AGENDA_ACTIF = true`, `AGENDA_MAX_PAR_RUN = 3`, `AGENDA_HORIZON_JOURS = 365`), surchargeables via `CONFIG`.
 * Idempotent via `Index`, journalisé dans `Actions`, jamais bloquant pour `tri-gmail`.
 * @param {string} filId
 * @param {Object} analyse
 * @param {Object} opts  `{ categorie, zoneProtegee, suspect, promoDeterministe, horsBoite, freinBudget, dateRef }`
 * @return {string} identifiant d'événement créé, ou `''`
 */
function creerRappelEcheanceAgenda_(filId, analyse, opts) {
  if (typeof CONFIG !== 'undefined' && CONFIG.AGENDA_ACTIF === false) return '';
  var maxRun = typeof CONFIG !== 'undefined' && CONFIG.AGENDA_MAX_PAR_RUN ? CONFIG.AGENDA_MAX_PAR_RUN : 3;
  if (_agendaCreesCeRun >= maxRun) return '';
  if (!filId || !opts || opts.freinBudget || opts.suspect || opts.promoDeterministe || opts.horsBoite) {
    return '';
  }

  var echeance = extraireEcheanceAgenda_(analyse, opts.dateRef || new Date());
  if (!echeance) return '';

  var cle = 'agenda|' + filId + '|' + echeance;
  if (typeof indexContient_ === 'function' && indexContient_(cle)) return '';

  var titre = construireTitreAgenda_(analyse, opts.categorie, !!opts.zoneProtegee);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(echeance);
  var dateEvt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var desc = typeof lienGmail_ === 'function' ? ('Lien Gmail : ' + lienGmail_(filId)) : '';

  try {
    var cal = CalendarApp.getDefaultCalendar();
    var ev = cal.createAllDayEvent(titre, dateEvt, desc ? { description: desc } : {});
    var eventId = ev && typeof ev.getId === 'function' ? String(ev.getId() || '') : '';
    _agendaCreesCeRun++;
    if (typeof indexAjouter_ === 'function') {
      indexAjouter_(cle, {
        statut: 'agenda',
        nom: titre,
        domaine: String(opts.categorie || ''),
        chemin: echeance
      });
    }
    if (typeof enregistrerAction_ === 'function') {
      enregistrerAction_('agenda-creer', eventId || ('evt-' + filId), '',
        { titre: titre, date: echeance }, 'fil:' + filId);
    }
    return eventId || cle;
  } catch (e) {
    if (!_agendaErreurSignaleeRun) {
      _agendaErreurSignaleeRun = true;
      if (typeof journalErreur_ === 'function') {
        journalErreur_('Agenda', 'Autorisation Google Agenda requise (ré-autoriser le script une fois) : ' + e);
      }
    }
    return '';
  }
}
