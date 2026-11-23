# ADR-0076 — Trier tout l'historique Gmail (lus, archivés, sans libellé) sous UN plafond quotidien qui n'affame jamais l'intake

- **Statut** : **accepté le 05/11/2026** par Marc (brief de la relance, DriveAI#880, repris en ADR-0074 §2 point 4 :
  le tri « couvre tout l'historique (lus, archivés, sans libellé) par balayage cyclique sous un seul plafond quotidien
  qui n'affame jamais l'intake »). Étape 7 du plan (§6), DriveAI#891. **Révise** : C28-21 (plafond du cyclique) et
  C28-22 (ADR-0022, abrogé : plafond du nettoyage profond), soit deux plafonds de 150 fondus en un ; ADR-0020 (scan
  cyclique borné à la fenêtre de 30 j, désormais sous le plafond commun avec une réserve) ; ADR-0050 (le chemin
  « un fil LU sort de la boîte » ne s'applique qu'EN boîte). **Inchangés** : ADR-0012 (libellés existants seuls, jamais
  de retrait), ADR-0007 (rien du corps dans la Sheet), ADR-0075 (portes « à traiter »), ADR-0016 (fail-safe), garde-fous §1.

## 1. Problème et objectif

Trois scans couvrent la boîte (`TriGmail.gs`) : le scan AVANT (courrier neuf), le cyclique (`newer_than:30d in:inbox`)
et le nettoyage profond (`in:inbox before:<ancre −29 j>`). Le scan ARRIÈRE saute tout fil hors boîte. Résultat : des
années de mails lus et archivés à la main, ou par l'ancien Cowork, n'ont **aucun libellé** et aucun scan ne les verra
jamais. Chaque campagne de fond a son propre plafond de 150 fils/jour (C28-21, C28-22) : deux vérités, deux
compteurs, et un troisième plafond en ajouterait une. **Objectif** : un balayage de l'historique archivé sans libellé,
sous UN SEUL plafond quotidien partagé par les campagnes de fond, qui ne touche jamais au courrier neuf ni à l'intake.

## 2. Décision

1. **Un plafond, trois compteurs, une réserve pour le vivant.** `TRI_FOND_MAX_FILS_JOUR` (300 = 150 + 150 d'hier,
   enveloppe inchangée) borne la SOMME des fils lus aujourd'hui par le cyclique, le nettoyage profond et l'historique
   (`filsFondLusJour_`, pure : somme de `DriveAI_TRI_{CYCLIQUE,BOITE,HISTO}_FILS_JOUR` quand leur `_JOUR` est
   aujourd'hui). L'ordre du tick ne donne la priorité que DANS le tick, pas sur la journée (revue de flotte, leçon
   C28-21 : « un quota partagé se répartit par priorité ») : les deux campagnes NON vivantes (nettoyage profond,
   historique) ne prennent ensemble que `TRI_FOND_MAX_FILS_JOUR − TRI_FOND_RESERVE_VIVANT` = 150 fils/j
   (`reliquatFondNonVivant_`, une seule définition) ; le cyclique, fenêtre vivante de 30 j qui ne se termine jamais,
   garde donc au moins ses 150 d'hier, plus tout ce que les autres n'ont pas pris. Chaque campagne garde SON compteur
   (Télémétrie : `tri_cyclique_fils_jour`, `tri_boite_fils_jour`, nouveau `tri_histo_fils_jour`, Détail « Plafond
   commun 300/j ») ; le reliquat est commun. `TRI_CYCLIQUE_MAX_FILS_JOUR` et `TRI_BOITE_MAX_FILS_JOUR` disparaissent
   (jamais deux vérités, verrou `test/tri-historique.test.js`).
2. **L'intake n'est jamais affamé.** Le plafond ne borne que les campagnes de FOND ; le scan AVANT (courrier neuf) reste
   hors plafond, et l'intake des PJ passe AVANT le tri dans le tick (`Tick.gs`) avec son propre budget. La leçon C28-21
   tient : 1 page × 288 ticks ≈ 5 760 lectures/jour sans plafond, sur le quota Gmail PARTAGÉ avec l'intake.
3. **Nouvelle campagne `trierHistoriqueArchive_`**, en TOUT dernier du tri, gatée comme le nettoyage profond sur le
   garde-temps et le frein campagnes §2.6 (elle coûte des mini-appels de catégorie). Requête figée
   `TRI_HISTO_REQUETE` = `has:nouserlabels -in:inbox -in:sent -in:drafts -in:chats` (opérateur Gmail documenté,
   support.google.com/mail/answer/7190) : tout ce qui n'a aucun libellé utilisateur et n'est pas en boîte. Gmail
   évalue ces opérateurs PAR MESSAGE [Probable] : un fil où Marc a répondu reste candidat (seul un fil composé
   uniquement d'envoyés est exclu), et un fil dont un vieux message est archivé mais dont la réponse récente est EN
   boîte sort aussi dans le résultat ; celui-là est laissé aux scans de la boîte (`isInInbox()` → compté restant,
   jamais de clé `tri|` posée hors boîte : l'ADR-0050 doit pouvoir l'archiver). Pas d'ancre : l'ensemble n'est pas
   borné par des dates, un mail archivé sans libellé y entre tant que la campagne n'est pas terminée ; après, au
   prochain ré-armement (§2.7).
4. **File mouvante** (patron C28-24) : `decisionTri_` pose toujours au moins un libellé (catégorie ou « À vérifier »),
   donc un fil traité QUITTE le résultat ; l'offset n'avance que des fils restés sans libellé (`'deja'`). Page
   interrompue (garde-temps) ou fil en erreur : offset inchangé, rejeu au tick suivant, jamais un fil sauté. Les fils
   LUS comptent au plafond, page complétée ou non (coût quota réel).
5. **Hors boîte, rien ne bouge** : `trierFil_(…, verifierBoite = false, horsBoite = true)` pose les libellés EXISTANTS
   (catégorie, « À vérifier », ⚠️) et rend `'traite'`, **jamais** `moveToArchive` (un fil archivé ne se ré-archive pas,
   et rien ne le ramène en boîte), jamais de retrait de libellé, idempotence par la clé `tri|` de l'Index. **Jamais
   d'apprentissage d'expéditeur** hors boîte (`apprendreTri_`) : un mail lu en 2021 n'est pas « Marc vient d'ouvrir ce
   courrier », et 300 expéditeurs/jour appris sur sujet seul pollueraient la table `TriAppris` d'un coup.
6. **Jamais de ⏰ hors fenêtre** : nouvelle porte `ancien` (`estHorsFenetreIntentions_`) dans `besoinATraiter_` /
   `portesFermees_` (« hors fenêtre ») : un « répondez avant vendredi » de 2024 reste une catégorie, pas un ⏰ (le
   drapeau `TRI_SUJET_CORPS` et le cas « analyse absente » de l'ADR-0043 sont retirés depuis 6b, 06/11/2026). L'audit
   (`auditerTriSujetCorps`) porte la même porte, mais sa requête (`newer_than:30d`) ne la rend jamais vraie : la passe
   d'audit sur `TRI_HISTO_REQUETE` n'a PAS été faite avant 6b (06/11/2026) ; elle est reportée avec le ré-audit après la
   bascule Gemini (ADR-0075 §6, DriveAI#892 pour l'entrée `auditerTriHistorique`).
7. **Terminaison et ré-armement** : deux passes complètes sans activité ⇒ `DriveAI_TRI_HISTO = terminé` (coût nul
   ensuite, jusqu'au prochain ré-armement) ; le bump de `TRI_REGLES_VERSION` (6b : `r3`) ré-arme la campagne, comme le
   nettoyage profond (`rearmerCampagneTri_`, `finaliserPasseCampagne_` : les helpers du nettoyage profond généralisés
   par préfixe, les enveloppes `rearmerBoiteHistorique_` / `finaliserPasseBoite_` conservées ; le premier armement
   n'écrit pas de ligne « RÉ-ARMÉ », rien n'a encore passé). Au ré-armement, seuls les fils ENCORE sans libellé
   repassent (les fils étiquetés sous `r2` ont quitté `has:nouserlabels`) ; un fil dont Marc a retiré le libellé à
   la main garde sa clé `r2` (respecté : `'deja'`) jusqu'au bump, où il est ré-étiqueté — jamais de retrait, mais un
   geste de Marc écrasé une fois par version de règles ; le nettoyage profond fait déjà pareil, l'historique le
   généralise à toute l'archive.
8. **Aucune minute prélevée sur l'enveloppe des campagnes** (ADR-0074 §2.6, verrou `test/orchestration.test.js`) : la
   campagne est bornée en FILS, dans le budget du tick `tri-gmail` déjà compté, sans runtime neuf ; l'enveloppe de
   fond reste 300 fils/j. Les campagnes à budget de MINUTES (doublons, fusions) entreront, elles, dans l'enveloppe.

## 3. Ce que ça coûte, et ce qui reste à Marc

- **Quota Gmail** [Certain] : au plus 300 fils lus par jour pour les trois campagnes (hier : 300 aussi, en deux
  enveloppes séparées), dont au plus 150 pour le nettoyage profond et l'historique ensemble ; une recherche par page
  de 20. L'historique se draine donc à ≤ 150 fils/jour (le nettoyage profond est probablement « terminé »
  [Supposition] : à lire dans `DriveAI_TRI_BOITE` et le Journal, aucune trace écrite) ; 10 000 archives sans libellé
  ≈ 67 jours [Probable]. Le tour du cyclique ne ralentit pas (réserve de 150, `tri_cyclique_fils_jour` inchangé).
- **Coût LLM** [Probable] : un mini-appel (sujet seul, OFF) par expéditeur inconnu ; sur Haiku 5.5 ≈ 0,0003 $/appel,
  ≤ 300/j ⇒ ≤ 0,1 $/jour au pic, puis zéro (« terminé »). Sous 6b (sujet + corps), ~1 000 jetons/fil : ≤ 0,3 $/jour
  au pic sur Flash-Lite. Frein campagnes §2.6 : la campagne s'arrête d'elle-même si le mois dépasse.
- **App** : le nouveau compteur `tri_histo_fils_jour` est ignoré par l'écran d'état tant qu'une jauge n'y est pas
  ajoutée (petit geste séparé, avec `app/src/mockData.ts` qui dit encore « Plafond 150/j ») ; les deux jauges
  existantes lisent « Plafond commun 300/j » sans changement, mais affichent « x / 300 » chacune alors que c'est la
  SOMME qui est bornée : la jauge unique « fond : somme/300 » est dans le même geste.
- **Index** : une ligne `tri|` par fil archivé traité (≤ 150/j, ~10 000 au total), chargée en mémoire à chaque tick
  comme le reste de la colonne A ; même mécanique que la boîte, coût de lecture qui croît d'autant (`docs/COUTS.md`).
- **Ce que Marc verra dans Gmail** : des centaines de vieux mails recevront un libellé de catégorie ; « À vérifier »
  grossira de tout expéditeur inconnu à catégorie douteuse (c'est le but : rien n'est inventé, Marc tranche quand il
  veut, jamais d'urgence) ; ⚠️ Suspect recevra d'anciens hameçonnages (sans désarchivage, visibles dans le libellé) ;
  les compteurs de libellés de la barre Gmail bondiront pendant la campagne. Aucun mail ne bouge, aucun ⏰ ancien.
- **Fil malade en écriture** : un `addToThread` qui échoue durablement sur UN fil est traité comme une panne
  systémique (`signalerPanneEcriture_`, offset figé, page rejouée à chaque tick, ≤ 288 lignes « PANNE D'ÉCRITURE »/j),
  même patron que le nettoyage profond ; sur 10 000 archives anciennes, plus probable qu'en boîte. Rien n'est perdu ;
  une ligne « PANNE D'ÉCRITURE » qui se répète chaque tick = un fil à regarder, pas une panne de scope (RUNBOOK).
- **Geste de Marc** : aucun. Observer dans Télémétrie `tri_histo_fils_jour` monter, puis `DriveAI_TRI_HISTO = terminé`
  dans le Journal (« Tri de l'historique archivé TERMINÉ »).

## 4. Alternatives écartées

- **Un troisième plafond de 150** : trois vérités, et 450 lectures/jour de fond sur un quota partagé (C28-21).
- **Étendre le cyclique à `newer_than:3650d`** : il archiverait les fils LUS (ADR-0050) et poserait des ⏰ sur des
  fils de 2019 ; il perdrait sa latence sur la fenêtre vivante.
- **Un libellé « DriveAI vu » pour marquer les fils passés** : un libellé de plus pour Marc, et une écriture Gmail par
  fil même sans décision ; la file mouvante `has:nouserlabels` fait le même travail sans trace.
