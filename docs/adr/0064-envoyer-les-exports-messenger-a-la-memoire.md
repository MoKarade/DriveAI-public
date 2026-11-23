# ADR-0064 — Envoyer les exports Messenger à la Mémoire, par lots, allumé le 24/10/2026

- **Statut** : **accepté** — code livré éteint (PR #665) ; ALLUMÉ le 24/10/2026 sur le « Autorisé » du
  propriétaire, dans une PR à part.
- **Portée** : `src/EnvoiMessenger.gs` (nouveau), `src/Config.gs` (trois clés `MESSENGER_*`),
  `src/Main.gs` (un appel enveloppé dans le tick), `src/Journal.gs` (une ligne de Santé).
  Aucun changement au classement ni au pipeline.
- **Amont** : l'ADR 0020 de MemoryAI (« les messages deviennent des événements », tâche MemoryAI#70),
  l'ADR-0061 (le contenu des documents quitte le compte). Tâche DriveAI#664, mission #663.

## Contexte

Environ 187 exports Facebook et Messenger dorment dans `_Technique`. La Mémoire a ouvert une porte
d'entrée pour eux, `POST /api/evenements` : elle lit le HTML elle-même (code pur, sans modèle), chiffre le
texte et ne rend que des nombres. Elle n'a aucun jeton Google : seul DriveAI tient le Drive et peut lui
tendre les fichiers.

## Décision

1. **DriveAI envoie le HTML brut**, un fichier par appel : `{ source: "messenger", file_id, html }`, avec le
   même jeton d'écrivain que les pièces (`DriveAI_MEMORYAI_TOKEN`). La limite est de 4 000 000 caractères ;
   un fichier plus gros n'est ni lu ni envoyé, il est écarté et compté.
2. **Livré ÉTEINT, allumé sur autorisation** (`CONFIG.MESSENGER_PUSH`). Ce sont des conversations de tiers :
   rien n'est parti avant le « Autorisé » du propriétaire. Éteint, l'étape ne fait rien, pas même une lecture de Property. La
   ligne de Santé « Envoi Messenger » dit « désactivé, N envoyé(s) » : c'est elle qui prouve que rien n'est
   sorti.
3. **Lot borné** : `CONFIG.MESSENGER_LOT` (2) exports par tick, sous le garde-temps du tick, sans budget
   quotidien propre (aucun appel LLM, la Mémoire ne coûte rien ici).
4. **Quels fichiers** : les `.html` de `_Technique` dont le nom porte `facebook` ou `messenger`. Lecture
   seule du Drive, dossier jamais créé (verrouillé par un test sur le source).
5. **Le journal ne dit que des nombres.** Un motif de refus n'est relayé que s'il fait partie de la liste
   fermée de la Mémoire (`source_inconnue`, `file_id_invalide`, `html_absent`).
6. **Les réponses ne se confondent pas.** `401` (jeton faux) et `403` (périmètre retiré) sont des gestes du
   propriétaire : on s'arrête sans suspendre, rien n'est marqué rendu. `413` et `422` refusent CE fichier :
   il est écarté, compté, et les suivants passent. `503`, un autre code ou le réseau suspendent le canal
   avec la même suspension que les deux autres canaux vers la Mémoire (un seul serveur).
7. **Idempotence des deux côtés.** La Mémoire dédoublonne par (fichier, position) : rejouer un export ne crée
   rien. Ici, la liste des fichiers rendus (`DriveAI_MESSENGER_FAITS`) évite de relire des mégaoctets ; la
   perdre coûte du temps, jamais un doublon. Elle REFUSE de tronquer : pleine, l'envoi s'arrête (`liste-pleine`).

**Renvoi unique (DriveAI#720, 28/10/2026)** : pour que la Mémoire prouve qu'elle n'écrit pas deux fois (MemoryAI#70),
le moteur renvoie les plus petits exports déjà rendus (`MESSENGER_RENVOI_UNIQUE`), un à un, jusqu'au premier que la
Mémoire lit (`lus` ≥ 1 : un export lu en 0 message ne prouve rien). Cinq essais par tick, puis la suite au tick suivant
(`DriveAI_MESSENGER_RENVOI_PAS`) ; les 5 plus petits, lus en 0 message le 28/10 (`_V2`), ne sont pas retentés. Il garde
`essais`, `lus`, `ecrits`, `dejaPresents`, `datesIllisibles` dans `DriveAI_MESSENGER_RENVOI_V3` (sa présence interdit
tout second renvoi) et les montre à la Santé. Rendus et cumul restent intacts.

## Ce qui reste ouvert

- Allumé le 24/10/2026 (PR à part) sur le « Autorisé » du propriétaire. Tant que la Mémoire répond 503
  `sauvetage_en_cours` ou refuse le jeton (401/403), l'envoi se suspend ou s'arrête seul et la Santé le dit.
- Si les exports ne portent pas tous `facebook` ou `messenger` dans leur nom, élargir `MESSENGER_MOTS`.
