# Guide utilisateur — DriveAI (pour Marc)

> DriveAI range ton Google Drive tout seul et trie tes mails. Ce guide dit comment l'alimenter,
> comment le corriger, et ce que fait chaque écran de l'app (**https://drive.exemple.com**).
> App v7 (2026-09-09) : trois écrans depuis le 05/11/2026 (l'Agenda est parti), une action par ligne, pas de blabla.

## En bref
Les **pièces jointes de tes mails** et les fichiers que tu **déposes** sont lus, renommés
(`AAAA-MM-JJ_Type_Émetteur`) et rangés dans le bon domaine — **sans jamais rien supprimer**.
Tes mails sont triés (libellés) et les fils lus sont archivés ; un mail qui demande ta main reçoit le
libellé ⏰ « À traiter » (depuis le 05/11/2026, DriveAI ne crée plus ni tâche ni rendez-vous).

## Déposer un document
- Glisse-le dans **`00 · À trier`** de ton Drive → traité au passage suivant.
- Ou envoie-le en pièce jointe par mail → détecté tout seul.

## Où vont tes fichiers
- Dans les **domaines** (`01 · Administratif` … `09 · Voyages`), sous l'**entité** (banque, école,
  employeur…), avec un **nom clair**.
- Les **doublons** → `_Doublons` (jamais supprimés). Le code → `_Technique`, les médias → `_Médias`.
- `04 · Immigration` : rangé comme le reste, **jamais sorti** de son dossier.

## L'app : trois écrans et un engrenage
| Écran | Ce que tu y fais |
|---|---|
| **Aujourd'hui** | La liste **À faire** — chaque ligne, un bouton : mail suspect → *Pas suspect* ; document à vérifier → s'ouvre dans Drive ; mail ⏰ à traiter → s'ouvre dans Gmail, *Fait* quand c'est réglé. Puis les **derniers classements**. |
| **Documents** | **Un champ** : nom d'un fichier ou d'un dossier dans le Drive. Dossiers et fichiers en liste ; **+** crée un dossier ; **✥** déplace un fichier (ou glisse-le sur un dossier). Les rangements que le moteur propose arrivent en bandeau **À valider** : *Valider* ou *Écarter* — rien n'est appliqué sans toi. (La question en langage naturel et l'onglet Assistant sont retirés depuis le 05/11/2026, ADR-0074.) |
| **Réglages** (engrenage) | L'état du moteur, trois chiffres (documents classés, mails triés, coût du mois), la fréquence des passages, la langue, la synchro, le retour au hub, la déconnexion. « Avancé » replié : campagnes en cours, quotas, erreurs des 7 derniers jours. |

Ce que l'app **ne fait jamais** : supprimer un fichier ou un mail, sortir un document de
`04 · Immigration`, appliquer une réorganisation sans ta validation. Seule exception : un **dossier
devenu vide** peut être mis à la corbeille Drive (récupérable 30 jours) — par toi, dans le bandeau « À valider ».

## Corriger une erreur de classement
Le formulaire [DriveAI — Corriger un classement](https://docs.google.com/forms/d/<id Drive>/viewform) :
tu nommes l'émetteur et le bon domaine → les prochains documents de cet émetteur seront bien classés.
Ou déplace le fichier toi-même (Drive ou écran Documents) : une fois le grand rangement terminé
(Réglages → Avancé), DriveAI ne le re-déplace pas.

## Si quelque chose cloche
La pastille en haut (téléphone) ou en bas du rail (PC) : vert = moteur en marche, ambre = en retard,
rouge = silencieux. Le détail est dans **Réglages → Avancé**. En général ça reprend tout seul ;
sinon `docs/RUNBOOK.md`.
