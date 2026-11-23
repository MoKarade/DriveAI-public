# ADR-0066 — Envoyer l'agenda du jour à la Mémoire (lecture étroite)

- **Statut** : **accepté et allumé le 26/10/2026** — accord étroit de Marc (« Oui, étroit », 12:15Z), puis son oui
  final (« oui agenda », 13:07Z) une fois la porte en prod côté Mémoire (MemoryAI#259).
- **Portée** : `src/AgendaMemoire.gs`, trois clés `AGENDA_*`, un appel dans le tick, une ligne de Santé.
  **Révise** ADR-0022 (le moteur ne lit pas l'agenda de Marc). **Amont** : ADR 0029 de MemoryAI
  (`POST /api/agenda`) ; tâche DriveAI#679, mission #677.

## Contexte

La Mémoire veut connaître la journée de Marc. Le moteur ne faisait que CRÉER des événements (scope
`calendar.events`) ; sa seule lecture était une sonde sur un identifiant inexistant. Lire l'agenda sort une
donnée personnelle du compte de Marc : il fallait son accord, donné le 26/10/2026 12:15Z, limité aux
événements d'aujourd'hui (titre, heure, durée).

## Décision

1. **UN seul GET**, les événements du jour du Québec, `fields=items(summary,status,start,end)` : jamais lieu,
   invités, description, lien, identifiant. Verrou : `test/surface-tasks-calendar.test.js`.
2. **Lecture seule** : aucune création, modification ni suppression ajoutée.
3. **Corps de la porte** : `{ source: 'agenda', jour, lu_le, evenements: [{ debut, duree_min, titre,
   journee_entiere }] }`, 50 au plus, titre sur une ligne de 120 caractères. Une liste vide est valide.
4. **Idempotent** : un envoi remplace le jour ; on ne renvoie que si le jour ou le contenu change
   (empreinte hors `lu_le`). Lecture au plus toutes les 10 minutes.
5. **Échec fermé** : jeton absent, agenda illisible ou porte en panne = rien d'envoyé, nouvel essai espacé
   (1 h en panne). `401`/`403` sont des gestes du propriétaire. Indépendant du drapeau de suspension partagé.
6. **Le journal ne dit que des nombres**, jamais un titre ; la Property d'état ne garde ni titre ni texte.
7. **Interrupteur** : `CONFIG.AGENDA_PUSH` (allumé le 26/10/2026) ; `false` = l'étape ne lit rien.

## Conséquences

- Les titres d'événements passent chez la Mémoire (chiffrés de son côté, ADR 0029).
- Un événement créé par DriveAI (intentions) reparaît dans la lecture : la Mémoire le dédoublonne par jour.
- Retour arrière : remettre `AGENDA_PUSH` à `false` ; la Mémoire garde le dernier jour envoyé.
