# ADR-0077 — Écarter un doublon seulement sur taille ET empreinte, face à un exemplaire prouvé vivant, avec la preuve écrite

- **Statut** : **accepté le 05/11/2026** par Marc (brief de la relance, DriveAI#880, repris en ADR-0074 §2 point 3 :
  « dédoublonnage infaillible : `_Doublons` seulement sur taille ET `md5Checksum` ou contenu réel, deux quasi-homonymes
  de contenu différent ne sont jamais fusionnés » ; Q15 : « oui, plein de doublons, à peaufiner »). Étape 8 du plan (§6),
  DriveAI#893. **Révise** : ADR-0070 (« dans le doute, doublon » devient « sans preuve, pas doublon » ; l'exemplaire vivant
  est nommé). **Prolonge** : ADR-0072 (une empreinte non identifiante n'existe pas, même lue par REST). **Inchangés** :
  ADR-0047 (déplacement seul vers `_Doublons`, jamais de suppression), ADR-0071 (`ignorerDoublon` à la remise), garde-fous
  §1 (zone protégée, idempotence par l'Index, aucun nouveau scope : `drive` est déjà déclaré).

## 1. Problème et objectif

Le fast-path doublon de `traiterDocument_` (`src/Pipeline.gs`) hachait lui-même les octets (`empreinteBlob_`), donc
téléchargeait chaque dépôt Drive en entier, et ne hachait RIEN au-delà de `OCR_TAILLE_MAX` (20 Mo) : une vidéo ou un gros
PDF déposé deux fois n'était jamais vu comme doublon. La décision ne regardait que « empreinte déjà à l'Index » et « un
exemplaire est encore là » (ADR-0070) : si l'exemplaire avait été **modifié en place** depuis son classement, l'empreinte de
l'Index était périmée et le dépôt partait quand même en `_Doublons` ; et « dans le doute » (exemplaire non identifiable,
lecture en échec, budget épuisé) le verdict restait « doublon ». Aucune preuve lisible : le Journal disait « doublon (sans
lecture) → _Doublons : <nom> », l'Index ne portait ni la taille ni l'exemplaire retenu.

**Objectif** : n'écarter un fichier que sur une preuve positive (empreinte ET taille identiques à celles d'un exemplaire
prouvé vivant, lues dans Drive AUJOURD'HUI), à toute taille, sans télécharger, et l'écrire.

## 2. Décision

1. **Drive calcule, DriveAI lit.** `metaFichierRest_(fileId)` (`src/DriveRest.gs`) lit `size` et `md5Checksum` par
   `files.get` (REST, champs seuls, jamais `alt=media`). Le `md5Checksum` de Drive est l'hex minuscule du MD5 des octets,
   le même que `empreinteBlob_` : les empreintes déjà à l'Index restent comparables. Un natif Google n'a ni l'un ni
   l'autre ; toute panne rend `null`.
2. **Le dépôt** (`metaDoublon_`, pure sauf les deux lectures) : métadonnées déjà lues par la liste (`src.metaRest`, fichiers
   partagés : `files.list` demande `md5Checksum`), sinon REST quand le descripteur porte `src.fileId` (dépôt Drive,
   Documents ID) ; sinon MD5 local des octets sous la borne OCR (pièce jointe Gmail, REST en panne). Un natif Google
   (`src.natif`, Drive n'a ni md5 ni taille pour lui : aucun appel) garde le MD5 de son export entier, avec
   `origine: 'texte'` et une taille `null` (un nombre de caractères n'est pas une taille). Une taille REST passe par
   `tailleOctets_` (jamais `0` à l'Index). Le blob n'est matérialisé que dans le repli, et il est rendu à l'OCR : jamais
   deux téléchargements, et un fichier technique, un média ou un doublon ne sont plus téléchargés du tout ; la borne OCR
   lit la taille REST quand `getSize` a échoué. Une panne de `files.get` est journalisée une fois par run (`Drive`).
3. **L'exemplaire** : `porteurVivantDe_` (`src/Journal.gs`, ADR-0070 révisé) rend `{ vivant, fileId }` ; `fileId` est le
   premier exemplaire PROUVÉ vivant parmi les `PORTEUR_CANDIDATS_MAX` (5) plus récents, `''` dans le doute. Un porteur
   inconnu (ancienne ligne sans fileId) ou un exemplaire récent illisible n'empêche plus de chercher un vivant parmi les
   suivants ; au-delà de 5 exemplaires connus, les 5 plus récents sont quand même contrôlés (sans ce choix, chaque copie
   classée faute de preuve ajouterait un candidat et l'empreinte ne serait plus jamais écartée). La lecture `files.get` faite par
   `etatPorteurBorne_` pour prouver la vie porte déjà taille et md5 (`porteur.meta`, mémo `metaPorteurRun_`, DriveAI#897) :
   un exemplaire = un appel par exécution, 150 copies du même fichier = un appel.
4. **Le verdict** (`jugerDoublon_`, pure) : doublon **seulement si** l'exemplaire est prouvé vivant ET lisible, ET n'est
   pas le dépôt lui-même (un fichier classé par Gmail, un partage ou Documents ID, remis dans « À trier » sans ligne
   `drive|<id>`, est une remise, ADR-0071, jamais son propre doublon), ET que son md5 Drive d'aujourd'hui est l'empreinte
   de l'Index (sinon il a changé : Index périmé), ET que les tailles coïncident quand les deux sont connues. Natif contre natif : deux exports entiers identiques font foi, la taille n'est pas
   comparée ; un dépôt binaire n'est jamais prouvé doublon d'un natif. Tout autre cas → le fichier suit le pipeline
   normal (OCR, classement, nom). **« Dans le doute » n'est plus un doublon** : écarter est l'action qui demande une
   preuve (leçon §9 de l'ADR-0047, appliquée dans le sens de l'ADR-0070 §2 mais sans son repli).
5. **La preuve écrite.** Index : colonne J « Taille » (octets, sur toute ligne documentaire dont la taille est connue) et
   K « Exemplaire » (fileId de l'exemplaire vivant, lignes `doublon`), en-têtes réparés par `chargerIndexCache_` sur un
   Index existant (même point d'attache que G et I). Journal : « doublon → _Doublons : <nom> (taille N o, empreinte …,
   exemplaire vivant <fileId>) », ou « empreinte déjà vue mais <raison> → traité normalement ». Marc peut relire chaque
   écart dans la Sheet et dans le Journal.
6. **Garde-fous tenus** : déplacement seul vers `_Doublons`, jamais de suppression ; zone protégée inchangée (le doublon
   d'une pièce sensible va toujours en `_Doublons`, §1 (c)) ; idempotence par la clé d'Index ; `ignorerDoublon` (ADR-0071,
   migration) saute le verdict mais l'empreinte (désormais lue par REST, à toute taille) est inscrite ; ADR-0072 : le MD5
   du vide ou d'un natif quasi vide n'est ni écrit ni comparé, même venu de REST.

## 3. Quotas Google et coût

- **LLM : aucun appel ajouté.** Un dépôt dont le doublon n'est pas prouvé est classé comme un document neuf : au plus un
  classement de plus par doublon douteux (quelques dixièmes de cent sur Gemini [Probable]), jamais une fusion fautive.
- **Drive REST** : un `files.get` (métadonnées, gratuit) par document déposé dans Drive (aucun pour un natif ni pour un
  partage, dont la liste porte déjà le md5), plus un par EXEMPLAIRE relu par exécution (mémo) ; au pire une page
  d'intake pleine (`INTAKE_PAGE` = 150) de doublons d'exemplaires distincts = 300 appels sur un quota UrlFetch de
  20 000/j. En échange, zéro téléchargement de contenu pour hacher un dépôt Drive (hier jusqu'à 20 Mo par fichier, et le
  temps d'exécution qui va avec).
- **DriveApp** : `PORTEUR_VERIF_MAX_RUN` passe de 15 à 150 = `INTAKE_PAGE`, pour qu'une page pleine de doublons se prouve
  en entier (sinon les 135 suivants auraient été classés : téléchargement, OCR, LLM, deux copies vivantes). Un
  `getFileById` par exemplaire contrôlé, mémorisé par run ; la borne de temps du tick couvre le reste. Au-delà, `inconnu`
  → non prouvé → traité normalement (hier : doublon) ; un dépôt classé faute de preuve porte son fileId à l'Index, et
  le dépôt suivant du même contenu est prouvé. Le cas `inconnu` d'une vieille ligne sans fileId coûte désormais jusqu'à
  5 `getFileById` là où il n'en coûtait aucun (borné). Aucune campagne ne rattrape un doublon classé faute de preuve
  (`Doublons.gs` est à l'arrêt) : c'est le prix d'« écarter sur preuve seulement ».
- **Sheet** : deux colonnes de plus par ligne (un nombre, un identifiant) ; l'Index reste chargé sur A et G seulement.
- **Ce que Marc verra** : un fichier déposé deux fois (même PDF, même taille) va en `_Doublons` avec, dans l'Index, la
  taille et l'identifiant de la copie classée ; deux fichiers du même nom mais de contenu différent sont classés tous les
  deux (nommés par leur descripteur) ; une vidéo déposée deux fois est enfin reconnue. Aucun geste de Marc.

## 4. Alternatives écartées

- **Comparer la taille à celle inscrite à l'Index** plutôt qu'à Drive : l'Index peut être périmé (fichier modifié en
  place), et c'est précisément le défaut à fermer ; la relecture REST coûte un appel gratuit par doublon candidat.
- **Remplacer `getFileById` (ADR-0070) par `files.get?fields=trashed,parents,size,md5Checksum`** en un seul appel : reporté
  ici, **fait le 06/11/2026 (DriveAI#897)** : `metaFichierRest_` rapporte aussi `trashed` et `parents`, `etatPorteurDoublon_`
  est pure sur ces métadonnées, `porteurVivantDe_` rend `meta` avec l'exemplaire nommé et `verdictDoublon_` compare le md5
  sans second appel ; `fetchDriveAvecRetry_` rejoue aussi (une fois, 1 s) un 403 dont le corps dit `rateLimitExceeded`
  (l'API Drive signale le débit en 403), jamais un 403 de droit ni `dailyLimitExceeded` (verrou `test/drive-rest.test.js`). `fileId` sur les descripteurs de `Migration`, `Reset`, `RetourOrphelins` : suite DriveAI#898.
- **Garder « dans le doute, doublon »** : contraire au brief (« jamais fusionnés ») ; le coût d'un classement de plus est
  négligeable devant un document mal rangé à vie dans `_Doublons`.
- **Relire l'export d'un natif** pour prouver qu'il n'a pas changé : un export par doublon candidat natif ; rare, coûteux
  en temps, reporté. Limite assumée : un Google Doc modifié en place depuis son classement garde l'empreinte de son
  ancien export à l'Index, et un nouveau natif au contenu de cet ancien export part en `_Doublons` (déplacement seul).
  Deuxième limite assumée, même cause : l'empreinte d'un natif est celle de son EXPORT (`Ocr.gs` : Docs → texte, Sheets →
  CSV de la première feuille, Slides → texte sans les images) ; deux Sheets identiques en première feuille mais différents
  ailleurs, ou deux présentations au même texte et aux images différentes, seraient vus comme doublons (déplacement seul,
  jamais de suppression). Les exclure du fast-path reste possible si le cas se présente.

## 5. Méthode de test et audit

- Tests purs (`test/doublon-taille.test.js`) : lecture de la réponse Drive, taille exploitable, matrice du verdict (même
  md5 et taille ; taille différente ; md5 changé ; disparu ; non prouvé ; illisible ; natif) ; `decisionPorteurVivant_`
  nomme l'exemplaire, contrôle les `max` plus récents, un inconnu ne masque pas un vivant (`test/doublon-porteur.test.js`).
- Tests REST : URL `files.get?fields=size,md5Checksum`, GET, Bearer, jamais `alt=media` ; ≠ 200, JSON cassé, exception →
  `null`, erreur journalisée une fois par run.
- Tests de source : `metaRest` avant REST, REST avant les octets, vidéo de 300 Mo jamais téléchargée, repli octets avec
  blob rendu, natif → texte sans appel Drive, `size "0"` → inconnue, ADR-0072 tenu par REST ; partages : `md5Checksum`
  demandé à la liste et passé au pipeline (`test/partages.test.js`).
- Tests de chemin : vrai doublon → `_Doublons` avec trace Index (J, K) et ligne de Journal ; homonyme de taille
  différente, exemplaire modifié, non prouvé, illisible, fichier remis qui est son propre exemplaire → classé
  normalement ; trois copies d'un exemplaire → une relecture ; fichier inédit → une seule lecture REST et la taille
  écrite ; borne OCR sur la taille REST quand `getSize` a échoué. Index : en-têtes J/K réparés, 11 colonnes écrites.
- **Audit sur du réel** (protocole §2) : cette décision ne change aucune sortie de classement (domaine, entité, nom) ; elle
  ne fait que laisser entrer dans le pipeline existant un fichier qui en était écarté, ou en écarter un sur une preuve
  plus forte. Le tableau de `test/audit-logique.test.js` est inchangé. **Preuve attendue en production** (après le merge et
  le prochain dépôt) : une ligne d'Index au statut `doublon` avec J et K remplis, ou une ligne de Journal « taille
  différente » ; les en-têtes J/K présents sur l'onglet Index après le premier tick.
