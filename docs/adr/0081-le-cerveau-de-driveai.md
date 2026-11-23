# ADR-0081 — Le « cerveau » de DriveAI : fiche apprise, autonomie encadrée, mémoire des décisions

- **Statut** : **Accepté** (23/11/2026 — plan validé par le propriétaire, livraison en vagues mission `#5`).
  **Complète** : ADR-0003 (apprentissage), ADR-0075 (tri sur sujet et corps), ADR-0076 (historique Gmail), ADR-0080 (9 piliers). **Révise** : ADR-0079 (gel des règles de tri, levé par paliers) et la décision du 19/11/2026 « aucune retouche de l'ancien ». **Inchangés** : ADR-0007 (vie privée), ADR-0016 (fail-safe), zéro suppression.

## 1. Contexte

Le propriétaire juge le tri des mails et le classement « pas assez intelligents ». Constat dans le code : le tri lit expéditeur + sujet + 3000 caractères avec un petit modèle, ne range que dans les libellés existants et met « À vérifier » au moindre doute ; la table apprise ne retient que ses corrections manuelles ; le classement Drive lit chaque document seul, sans historique ni lien entre documents, et ne retouche jamais l'ancien.

## 2. Décisions (propriétaire, 23/11/2026)

1. **Budget** : cible 25 $/mois, **frein automatique à 30 $** (repli en mode économique). Remplace la cible de 10 $ ; le plafond dur de 20 $ des règles de projet est relevé à 30 $ par cette décision.
2. **Fiche du propriétaire** : fichier privé sur Drive (comme `driveai-profil-prive.json`, jamais dans Git), mis à jour par un apprenti quotidien à partir de ses signaux d'usage (lu, répondu, archivé, étoilé, envoyés, agenda), de ses pièces jointes et de ses documents Drive. **Seuls des faits dérivés y sont écrits** (« cet expéditeur = important »), jamais le contenu d'un mail (ADR-0007 inchangé).
3. **Autonomie complète** : création, renommage et réorganisation de libellés et dossiers sans validation ; déplacement de l'ancien, y compris les cas douteux. **Jamais de suppression.** Chaque action est journalisée avec l'état d'avant et annulable.
4. **04 · Immigration** : la protection contre les déplacements automatiques est **levée** (décision explicite et confirmée). Mise en œuvre **par paliers** : un lot test de 20 documents réels (ancien contre nouveau) est audité avant d'ouvrir 04 en grand.
5. **Actions sur les mails** : résumé d'une ligne par mail important ; brouillons de réponse (**jamais d'envoi sans le propriétaire**) ; événements d'agenda sur échéance (**requiert un nouveau droit Google : oui explicite du propriétaire et ré-autorisation avant code**) ; lien mails ↔ documents Drive ; rangement des infolettres (désabonnement seulement par lien officiel, journalisé).

## 3. Garde-fous non négociables

Zéro suppression ; journal + Annuler pour toute écriture ; aucun envoi de mail ; aucun contenu de mail copié hors de Gmail ; aucun nouveau scope OAuth sans accord écrit ; frein de budget ; protocole de précision (`docs/claude/11-protocole-de-precision.md`) avant tout changement de règle : audit sur ~20 documents ou fils réels, tests de non-régression, puis changement.

## 4. Livraison

Vague 0 : mesure de référence (taux de « À vérifier », de ⏰ corrects, de documents mal rangés). Vague 1 : fiche + mémoire. Vague 2 : mails. Vague 3 : libellés et dossiers autonomes. Vague 4 : dossiers de vie et relecture de l'ancien. Vague 5 : agenda et actions. Une tâche, une issue, une PR (≈ 400 lignes), preuve en production, mesure avant/après.

## 5. Conséquences

Coût IA plus élevé (suivi dans `Santé`) ; plus de risque d'erreur d'autonomie, borné par le journal, Annuler et les paliers ; la protection de `04` ne repose plus que sur le journal et le lot test, ce que le propriétaire accepte.

## 6. Alternatives écartées

Rester sur les règles fixes (ne répond pas à « il devrait me connaître ») ; autonomie sur validation par lot (refusée par le propriétaire) ; garder 04 intouchable (refusé après confirmation).
