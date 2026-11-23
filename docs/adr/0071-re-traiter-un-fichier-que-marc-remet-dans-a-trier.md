# ADR-0071 — Re-traiter une fois un fichier classé que Marc remet dans `00 · À trier`

- **Statut** : **accepté le 29/10/2026** par le fil DriveAI, sans attendre Marc : changement réversible (aucune suppression,
  déplacement seul, budget LLM inchangé en ordre de grandeur), et Marc a dit le 28/10 à 20:51Z que les décisions pas
  importantes se prennent sans lui. **Amont** : ADR-0026 (note du 2026-07, « le re-tri est le comportement voulu ») ;
  protocole de précision (`docs/claude/11-protocole-de-precision.md`). Tâche DriveAI#808, mission DriveAI#800.

## 1. Problème et objectif

`traiterDepots_` (`Intake.gs`) saute tout fichier dont la clé `drive|<id>` est déjà à l'Index. Le commentaire de l'intake et
l'ADR-0026 disent qu'un fichier que Marc remet à la main dans `00 · À trier` doit se RE-TRIER, mais ce filtre l'en empêche :
le fichier reste dans `00 · À trier`, jamais présenté au pipeline. Aucun test ne couvrait le cas.

**Objectif** : un fichier classé que Marc remet dans `00 · À trier` est re-traité UNE fois par remise, sans jamais toucher
aux résidents légitimes de ce dossier (quarantaine, Google natifs sans export, zone protégée), qui doivent rester en place.

## 2. Le signal de la tâche ne tient pas, et ce qu'on prend à la place

La tâche proposait « `getLastUpdated` postérieur à l'inscription d'Index ». **[Probable]** Un simple déplacement dans Drive ne
change pas `modifiedTime` (retours d'usage concordants ; aucune doc Google ne le dit noir sur blanc) : Marc qui glisse le
fichier de son dossier vers `00 · À trier` ne produirait aucune date plus récente, et le signal ne se déclencherait que s'il
modifie aussi le fichier. Le moteur, lui, renomme puis déplace AVANT d'écrire la ligne d'Index : sa propre date est toujours
antérieure à l'inscription.

Signal retenu : **la dernière ligne d'Index du fichier dit qu'il a été PLACÉ ailleurs, et il est pourtant dans `00 · À trier`.**
Un résident légitime porte, lui, une ligne `quarantaine`, `natif` ou `zone protégée`, sans chemin. Statuts de placement posés
par le pipeline : `classé`, `à vérifier`, `doublon`, `technique`, `média` (tous avec un chemin non vide). Le reste
est ignoré (échec fermé : un statut inconnu n'est jamais re-traité).

## 3. Décision

1. **Clé d'une remise** : `redepot|<fileId>|<n>`, `n` = 1, 2, 3… (la première absente de l'Index). La tâche disait `<ts>` ;
   un compteur se sonde sans lire la Sheet (`indexContient_`) et rend le « une fois » exact : la clé existe, donc
   `traiterDocument_` sort sur son idempotence (`indexContient_(src.cle)`). Plafond de 20 remises par fichier.
2. **Dernière ligne du fichier** : `drive|<id>` si aucune remise n'a eu lieu, sinon `redepot|<id>|<n-1>`. Son numéro de ligne
   vient d'un cache posé pendant la lecture de la colonne A que `chargerIndexCache_` fait déjà à chaque run (aucune cellule
   de plus). La ligne est relue (6 cellules) et sa clé vérifiée : si l'onglet a bougé (purge `tri|`), on ne décide pas.
3. **Un résident est examiné une fois.** `id:ligne` est mémorisé dans la Script Property `DriveAI_REDEPOT_RESIDENTS`
   (300 entrées, les plus récentes). Un résident ne coûte donc plus aucune lecture aux ticks suivants. Au plus
   `REDEPOT_VERIF_MAX_RUN` (10) lectures de ligne par run ; au-delà, le fichier attend le tick suivant.
4. **Traitement** : `traiterFichierDepose_(id, cleRedepot)` passe par `traiterDocument_` avec la clé de remise et
   `ignorerDoublon: true` (patron `RetourOrphelins.gs`) : son empreinte est déjà à l'Index, sans ce bypass il repartirait
   en `_Doublons`. Garde §1, zone protégée et routage ne changent pas ; échec, quarantaine et panne de compte se comptent
   sous la clé de remise.
5. **Panne ≠ remise** : si la lecture de la ligne échoue ou si le cache est incertain, le fichier est laissé en place et
   l'erreur est journalisée. Jamais de re-traitement sur un doute.

## 4. Impact quotas et coût

- Sheets : aucune lecture de plus sur le chemin chaud ; au pire 10 lectures de 6 cellules par run, uniquement pour un
  résident jamais examiné.
- LLM : un appel de classement par remise réelle (comme un dépôt neuf). Aucune campagne, aucune boucle : la clé de remise
  est écrite à l'Index au premier passage réussi ou en quarantaine.
- Propriétés Apps Script : une écriture par résident nouvellement examiné.

## 5. Risques

- **Faux positif** (re-traiter ce qu'il fallait laisser) : possible seulement si le moteur lui-même remet dans
  `00 · À trier` un fichier déjà placé. Les cinq écrivains de ce dossier ont été relus : le grand rangement ne renvoie que des
  fichiers SANS clé `drive|` (`estAReclasserLeger_`), les garde-fous de `Reorg.gs` refusent `00 · À trier` comme cible,
  `Main.gs` en sort seulement. Si ce n'est plus vrai un jour, le plafond de 20 remises et la page d'intake limitent la casse.
- **Classement** : la logique de classement n'est pas modifiée, seule l'éligibilité d'un fichier l'est ; le protocole de
  précision (audit sur du réel) n'a donc rien de nouveau à mesurer. La preuve est le comportement : une remise est traitée
  une fois, un résident jamais.
- **Non vérifié en production** : aucune remise réelle n'a encore eu lieu. La première sera lue dans l'Index
  (ligne `redepot|<id>|1`) et dans le Journal (« Re-dépôt »).

## 6. Méthode de test

`test/redepot.test.js` : fonctions pures (clés, statuts), lecture de ligne vérifiée, mémo des résidents, plafond de lectures,
et le chemin complet de `traiterDepots_` jusqu'au descripteur passé au pipeline. Chaque garde est retirée une à une pour
vérifier qu'un test rougit.
