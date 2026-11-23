# ADR-0070 — Ne pas jeter en `_Doublons` un fichier dont plus aucun exemplaire n'est vivant

- **Statut** : **accepté le 29/10/2026** par le fil DriveAI, sans attendre Marc : changement réversible (aucun coût LLM,
  aucune suppression, déplacement seul), et Marc a dit le 28/10 à 20:51Z que les décisions pas importantes se prennent sans lui.
  **Amont** : ADR-0047 (la campagne `Doublons` a constaté le défaut sur du réel, le 2026-08-20) ; protocole de précision
  (`docs/claude/11-protocole-de-precision.md`). Tâche DriveAI#809, mission DriveAI#800.
  **Révisé par ADR-0077 (05/11/2026)** : `empreinteAUnPorteurVivant_` devient `porteurVivantDe_` et NOMME l'exemplaire
  prouvé vivant ; « dans le doute » (exemplaire inconnu, lecture en échec, budget épuisé) n'est plus un doublon, le
  fichier est classé normalement ; l'empreinte ET la taille de l'exemplaire sont relues dans Drive avant d'écarter.

## 1. Problème et objectif

`estDoublon_` (`Journal.gs`) répond à « ce contenu a-t-il DÉJÀ ÉTÉ VU ? » sur un ensemble d'empreintes sans lieu
(`Doublons.gs:3-8` l'avoue). `traiterDocument_` (`Pipeline.gs:44`) l'applique sans demander si l'exemplaire qui porte cette
empreinte existe encore. Scénario : un fichier est classé, Marc le met à la corbeille (ou le retire), puis dépose le même
contenu. L'empreinte est dans l'Index, le nouveau fichier part en `_Doublons` sans AUCUNE copie classée. Rien n'est détruit
(déplacement seul), mais le document n'existe plus dans l'arborescence.

**Objectif** : une empreinte déjà vue ne vaut « doublon » que si au moins un exemplaire est vivant (ou si on ne peut pas
l'exclure). Sinon le fichier suit le pipeline normal.

## 2. Décision

Avant le fast-path doublon, `traiterDocument_` appelle `empreinteAUnPorteurVivant_(empreinte)` (`Journal.gs`) :

1. **Lecture paresseuse, une fois par run, seulement au premier doublon** : colonnes A (clé), F (statut), G (empreinte) et
   I (fileId) de l'Index. Le chemin chaud (`chargerIndexCache_`, colonnes A et G) ne change pas.
2. **Candidats** (fonction pure `candidatsPorteurs_`) : les lignes qui portent cette empreinte, SAUF celles au statut
   `doublon` (leur fichier est dans `_Doublons` par construction : ce n'est pas un exemplaire classé). Un candidat est un
   fileId (colonne I, sinon déduit de la clé). Une ligne sans fileId déductible (ancienne pièce jointe Gmail) est un
   candidat **inconnu**.
3. **Décision** (fonction pure `decisionPorteurVivant_`) : doublon (`true`) s'il n'y a aucun candidat, s'il y a un
   candidat inconnu, ou si un candidat n'est pas prouvé mort. Pas doublon (`false`) seulement si TOUS les candidats sont
   prouvés morts.
4. **Preuve de mort** (`etatPorteurDoublon_`) : `trashed` vrai, ou tous les parents du fichier sont `_Doublons` (id lu
   sans création, `idDoublonsSansCreer_`). Depuis le 06/11/2026 (DriveAI#897), `trashed` et `parents` viennent du MÊME
   `files.get` REST (`metaFichierRest_`) que la taille et le md5 de l'ADR-0077 : une lecture par exemplaire et par run,
   plus aucun `DriveApp.getFileById`, et la fonction est pure. Toute autre issue (réponse illisible, 403 de droit, 404,
   budget épuisé) = `inconnu`, donc non prouvé (ADR-0077 : traité normalement).

**Dans le doute, on garde le comportement d'avant.** C'est la règle de la leçon §9 de l'ADR-0047 (« le prédicat qui déclenche
l'action est STRICT et dans le doute REFUSE ») appliquée ici au sens inverse : écarter un doublon est la décision qui
demande une preuve.

## 3. Quotas Google et coût LLM

- **LLM : aucun appel ajouté.** Un fichier jugé non-doublon repasse par l'OCR et le classement normaux, comme tout nouveau
  fichier : c'est le coût d'un document neuf, payé seulement dans le cas où l'exemplaire a réellement disparu.
- **Sheet** : trois à quatre lectures de colonne (environ 26 000 lignes, ~100 000 cellules) **une seule fois par run et
  seulement si un doublon se présente**. Le cache de chaque tick en lit 52 000 en continu ; ce coût s'y ajoute rarement.
- **Drive** : au plus `CONFIG.PORTEUR_VERIF_MAX_RUN` (150 depuis l'ADR-0077) lectures `files.get` par run, mémorisées par
  fileId (preuve de vie et empreinte en un appel depuis DriveAI#897) ; au-delà, `inconnu` donc non prouvé. Au plus `CONFIG.PORTEUR_CANDIDATS_MAX` (5) candidats par empreinte, les plus récents d'abord ; au-delà, les candidats restants ne sont pas lus (`incertain`), donc aucun exemplaire vivant prouvé et le fichier est classé normalement (ADR-0077).

## 4. Risques

- **Une empreinte à nombreux exemplaires** : on s'arrête au premier exemplaire vivant, et le plafond par run borne le pire cas.
- **Faux « pas doublon »** : exigerait qu'un exemplaire vivant soit jugé mort. Les deux preuves sont positives (corbeille
  confirmée, ou seul parent `_Doublons`) ; une lecture qui échoue ne prouve rien.
- **Fichier re-présenté qui est lui-même le porteur** : il est vivant, le verdict reste « doublon » (comportement d'avant ;
  c'est le cas « doublon de soi-même » de l'ADR-0047, traité par `ignorerDoublon`, hors de cette décision).
- **Exemplaire supprimé pour de bon** : `files.get` répond 404, donc `inconnu`, donc non prouvé (traité normalement depuis
  l'ADR-0077). La correction ne couvre
  que la corbeille et `_Doublons` ; l'élargir demanderait de distinguer « supprimé » d'une panne de lecture, ce que
  l'API ne permet pas proprement. Limite assumée.
- **Une écriture en double dans l'arborescence** si l'exemplaire « mort » réapparaît (restauration de la corbeille) : le
  rangement normal pose le nouveau fichier, la réconciliation Index/Drive (C28-07) constate le reste. Pas de perte.

## 5. Méthode de test et audit

- Tests purs (`test/doublon-porteur.test.js`) : candidats, décision, preuve de mort, plafond.
- Tests de chemin : porteur corbeillé ⇒ le fichier n'est pas jugé doublon et poursuit le pipeline ; porteur vivant ⇒
  `_Doublons` ; porteur inconnu ⇒ `_Doublons` ; aucune lecture Drive pour un contenu jamais vu. Chaque test est rouge si on
  retire la décision (vérifié).
- **Audit sur du réel** (protocole §2) : cette décision ne change AUCUNE sortie de classement (domaine, entité, nom) ; elle
  ne fait que laisser un fichier entrer dans le pipeline existant. Le tableau de `test/audit-logique.test.js` est donc
  inchangé. L'effet en production se lit au journal (`Pipeline` : « exemplaire disparu → traité normalement »).

## 6. Suite

`#808` (re-dépôt d'un fichier classé) et `#814` (empreinte d'un natif vide) touchent le même couloir (`Pipeline.gs`,
`Journal.gs`) et se prennent après cette tâche, jamais en même temps.
