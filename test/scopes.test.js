'use strict';
/**
 * Verrou du MOINDRE PRIVILÈGE (CLAUDE.md §2.3) sur `src/appsscript.json`.
 *
 * Un scope OAuth déclaré est un pouvoir RÉEL accordé au script sur le compte Google de Marc, qu'il
 * s'en serve ou non. Deux dérives à empêcher, dans les DEUX sens :
 *  - un scope déclaré que PLUS AUCUN code n'utilise (vécu : `tasks` et `calendar.events` sont
 *    restés déclarés après ADR-0041, qui a basculé ces appels sur le jeton du projet hubperso —
 *    le script gardait lecture/écriture/SUPPRESSION sur les tâches et l'agenda pour rien) ;
 *  - un appel d'API qui exigerait un scope NON déclaré (le moteur planterait en prod).
 *
 * ⚠️ Ce test ne remplace pas la séquence humaine : toute modification de `oauthScopes` se fait AVEC
 * Marc (§2.3). Il empêche seulement la dérive SILENCIEUSE entre le code et le manifeste.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const manifeste = JSON.parse(fs.readFileSync(path.join(RACINE, 'src', 'appsscript.json'), 'utf8'));
const SRC = fs.readdirSync(path.join(RACINE, 'src'))
  .filter((f) => f.endsWith('.gs'))
  .map((f) => fs.readFileSync(path.join(RACINE, 'src', f), 'utf8'))
  .join('\n');

/**
 * Pour chaque scope : le MOTIF qui prouve qu'un code l'utilise VRAIMENT. Un scope sans motif
 * satisfait est un privilège gratuit ; un motif satisfait sans scope est une panne en prod.
 */
const PREUVES = {
  'https://www.googleapis.com/auth/gmail.modify': /GmailApp\./,
  'https://www.googleapis.com/auth/drive': /DriveApp\.|ScriptApp\.getOAuthToken\(\)/,
  'https://www.googleapis.com/auth/script.external_request': /UrlFetchApp\./,
  'https://www.googleapis.com/auth/spreadsheets': /SpreadsheetApp\./,
  'https://www.googleapis.com/auth/script.send_mail': /MailApp\.|\.sendEmail\(/,
  'https://www.googleapis.com/auth/script.scriptapp': /ScriptApp\.(newTrigger|getProjectTriggers|deleteTrigger)/,
  'https://www.googleapis.com/auth/forms': /FormApp\./,
  // Retirés le 19/08 (ADR-0041 §5) : les créations Tasks/Calendar passaient par le jeton OAuth du
  // projet hubperso, jamais par celui du script ; la création elle-même est retirée (ADR-0074).
  'https://www.googleapis.com/auth/tasks': /TasksApp\./,
  'https://www.googleapis.com/auth/calendar.events': /CalendarApp\./,
};

test('appsscript.json : chaque scope DÉCLARÉ a un consommateur réel dans src/', () => {
  for (const scope of manifeste.oauthScopes) {
    const preuve = PREUVES[scope];
    assert.ok(preuve, 'scope inconnu de ce verrou : ' + scope + ' — l\'ajouter à PREUVES avec le ' +
      'motif qui prouve son usage (et le séquencer avec Marc : §2.3)');
    assert.ok(preuve.test(SRC), 'scope DÉCLARÉ mais inutilisé : ' + scope +
      ' — privilège gratuit sur le compte de Marc, à retirer');
  }
});

test('appsscript.json : aucun code n\'utilise une API dont le scope N\'EST PAS déclaré', () => {
  const declares = new Set(manifeste.oauthScopes);
  for (const [scope, preuve] of Object.entries(PREUVES)) {
    if (declares.has(scope)) continue;
    assert.ok(!preuve.test(SRC), 'du code exige ' + scope + ' alors qu\'il n\'est PAS déclaré — ' +
      'le moteur planterait en prod (et ré-ajouter un scope GÈLE tous les déclencheurs jusqu\'à ' +
      'ré-autorisation manuelle de Marc : §2.3, à séquencer AVEC lui)');
  }
});

