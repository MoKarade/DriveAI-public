'use strict';
/**
 * ADR-0081 §2.5 (vague 5) — Rappels d'échéance automatiques dans Google Agenda (`Agenda.gs`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));

test('extraireEcheanceAgenda_ : valide AAAA-MM-JJ future dans l horizon et rejette passées/invalides', () => {
  const c = load(['Config.gs', 'Agenda.gs']);
  const ref = new Date('2026-11-24T12:00:00Z');

  assert.strictEqual(c.extraireEcheanceAgenda_({ echeance: '2026-11-24' }, ref), '2026-11-24');
  assert.strictEqual(c.extraireEcheanceAgenda_({ echeance: ' 2026-12-15 ' }, ref), '2026-12-15');
  assert.strictEqual(c.extraireEcheanceAgenda_({ echeance: '2026-11-23' }, ref), '', 'date passée rejetée');
  assert.strictEqual(c.extraireEcheanceAgenda_({ echeance: '2027-12-31' }, ref), '', 'au-delà de 365 j rejetée');
  assert.strictEqual(c.extraireEcheanceAgenda_({ echeance: '2026-02-30' }, ref), '', '30 février invalide');
  assert.strictEqual(c.extraireEcheanceAgenda_({ echeance: '24/11/2026' }, ref), '');
  assert.strictEqual(c.extraireEcheanceAgenda_(null, ref), '');
});

test('construireTitreAgenda_ : masque les détails en zone protégée (ADR-0007)', () => {
  const c = load(['Config.gs', 'Agenda.gs']);

  assert.strictEqual(
    c.construireTitreAgenda_({ resume: 'Payer facture Hydro-Exemple' }, 'Finance', false),
    'DriveAI · Finance — Payer facture Hydro-Exemple'
  );
  assert.strictEqual(
    c.construireTitreAgenda_({ resume: 'Détail sensible IRCC à masquer' }, 'Administration/Immigration', true),
    'DriveAI · Échéance Administration/Immigration',
    'jamais de détail sensible exposé dans Agenda en zone protégée'
  );
  assert.ok(
    c.construireTitreAgenda_({ resume: 'R'.repeat(120) }, 'Finance', false).length <= 80
  );
});

test('creerRappelEcheanceAgenda_ : idempotence, plafond, frein budget, filtres et panne non bloquante', () => {
  const events = [];
  const index = {};
  const actions = [];
  const erreurs = [];

  const c = load(['Config.gs', 'Resume.gs', 'TriGmail.gs', 'Agenda.gs'], {
    indexContient_: (k) => !!index[k],
    indexAjouter_: (k, v) => { index[k] = v; },
    enregistrerAction_: (t, cible, av, ap, det) => { actions.push({ t, cible, av, ap: plain(ap), det }); },
    journalErreur_: (s, m) => { erreurs.push([s, m]); },
    CalendarApp: {
      getDefaultCalendar: () => ({
        createAllDayEvent: (titre, date, opts) => {
          events.push({ titre, date, opts });
          return { getId: () => 'evt-' + events.length };
        },
      }),
    },
  });

  const baseOpts = {
    categorie: 'Finance',
    zoneProtegee: false,
    suspect: false,
    promoDeterministe: false,
    horsBoite: false,
    freinBudget: false,
    dateRef: new Date('2026-11-24T12:00:00Z'),
  };

  c.reinitialiserAgendaRun_();

  // Ignorés : suspect, promo, horsBoite, freinBudget
  assert.strictEqual(c.creerRappelEcheanceAgenda_('t0', { echeance: '2026-12-01' }, { ...baseOpts, suspect: true }), '');
  assert.strictEqual(c.creerRappelEcheanceAgenda_('t0', { echeance: '2026-12-01' }, { ...baseOpts, promoDeterministe: true }), '');
  assert.strictEqual(c.creerRappelEcheanceAgenda_('t0', { echeance: '2026-12-01' }, { ...baseOpts, horsBoite: true }), '');
  assert.strictEqual(c.creerRappelEcheanceAgenda_('t0', { echeance: '2026-12-01' }, { ...baseOpts, freinBudget: true }), '');
  assert.strictEqual(events.length, 0);

  // Création nominal + idempotence
  const id1 = c.creerRappelEcheanceAgenda_('fil-1', { echeance: '2026-12-10', resume: 'Payer loyer' }, baseOpts);
  assert.strictEqual(id1, 'evt-1');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].titre, 'DriveAI · Finance — Payer loyer');
  assert.ok(events[0].opts.description.includes('Lien Gmail :'));
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].t, 'agenda-creer');
  assert.strictEqual(actions[0].ap.date, '2026-12-10');

  // Rejeu du même fil + même date → idempotent (0 nouvel événement)
  assert.strictEqual(c.creerRappelEcheanceAgenda_('fil-1', { echeance: '2026-12-10', resume: 'Payer loyer' }, baseOpts), '');
  assert.strictEqual(events.length, 1);

  // Plafond AGENDA_MAX_PAR_RUN = 3
  c.creerRappelEcheanceAgenda_('fil-2', { echeance: '2026-12-11', resume: 'Rdv' }, baseOpts);
  c.creerRappelEcheanceAgenda_('fil-3', { echeance: '2026-12-12', resume: 'Renouveler' }, baseOpts);
  assert.strictEqual(c.creerRappelEcheanceAgenda_('fil-4', { echeance: '2026-12-13', resume: 'Trop' }, baseOpts), '');
  assert.strictEqual(events.length, 3);

  // Panne CalendarApp (ex. scope non ré-autorisé) → 1 erreur/run max, ne lève jamais
  c.reinitialiserAgendaRun_();
  c.CalendarApp = { getDefaultCalendar: () => { throw new Error('Permission Calendar manquante'); } };
  assert.strictEqual(c.creerRappelEcheanceAgenda_('fil-5', { echeance: '2026-12-15' }, baseOpts), '');
  assert.strictEqual(c.creerRappelEcheanceAgenda_('fil-6', { echeance: '2026-12-16' }, baseOpts), '');
  assert.strictEqual(erreurs.length, 1, 'une seule erreur journalisée par run');
});

test('parserAnalyseFil_ : extrait une date echeance optionnelle sans casser la sortie par défaut', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const lib = ['Finance'];

  assert.deepStrictEqual(
    plain(c.parserAnalyseFil_('{"categorie":"Finance","suspect":false,"aTraiter":true,"resume":"Payer","echeance":"2026-12-20"}', lib)),
    { categorie: 'Finance', suspect: false, aTraiter: true, resume: 'Payer', echeance: '2026-12-20' }
  );
  assert.deepStrictEqual(
    plain(c.parserAnalyseFil_('{"categorie":"Finance","suspect":false,"echeance":null}', lib)),
    { categorie: 'Finance', suspect: false, aTraiter: false, resume: '' },
    'sans echeance valide, aucune clé echeance ajoutée'
  );
});
