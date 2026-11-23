# ADR-0068 — Relire 20 papiers « illisibles » par leur image (essai)

- **Statut** : **accepté le 28/10/2026** — « go pour les recos » de Marc (14:28Z), sur sa page des gestes : l'essai de
  20 papiers en Haiku 5.5 proposé sur MemoryAI#374 (environ 2 ¢). **Rien de plus sans un nouveau go de Marc.**
- **Portée** : `src/RelectureImage.gs` (nouveau), deux clés `RELECTURE_IMAGE_*` de `Config.gs`, un appel dans le tick,
  la ligne de Santé « Seconde lecture (pièces) » étendue. **Amont** : ADR-0065, ADR 0026 de MemoryAI. Tâche DriveAI#740,
  mission #739.

## Contexte

La seconde lecture par le texte (ADR-0065) a écarté 28 papiers sur 50 comme « illisibles » : leur OCR est trop pauvre,
ce sont surtout des scans que la première lecture a pu lire en vision. Aucun modèle ne garantit zéro illisible, et la
Mémoire ne juge que les papiers qu'une seconde lecture confirme. Avant d'engager un budget, Marc a retenu un petit essai
pour mesurer le taux de lecture et le coût réel (estimation : ≈ 1,6 $ pour les ~1 600 papiers, à confirmer).

## Décision

1. **Haiku 5.5 regarde le fichier** (`blocsVision_` en image forcée : jamais le texte d'un PDF), avec la même consigne
   aveugle à quatre champs que ADR-0065. La première lecture n'est jamais passée au modèle.
2. **20 papiers au plus, 5 par tick**, parmi ceux que la lecture du texte a écartés (`DriveAI_RELECTURE_ECARTES`). Les
   candidats sont choisis une seule fois (l'Index se lit une fois) et gardés ; l'essai **s'arrête seul** après les 20
   (`RELECTURE_IMAGE_PLAFOND`) ; le relever est un geste de Marc. `RELECTURE_IMAGE_LOT` à 0 l'éteint.
3. **Hors sensibles** : les domaines `01` (identité), `02` (finances) et `04` (immigration) ne partent jamais, ni un
   papier dont le domaine est inconnu (échec fermé). Si moins de 20 papiers sont éligibles, l'essai en lit moins : on
   ne l'élargit pas aux sensibles.
4. **L'étiquette dit la vérité** : `haiku-5.5-vision-relecture-v1` (canal « vision », modèle `haiku`). La première
   lecture de ces papiers est `sonnet-5-vision-piece-v3` : deux visions de deux modèles différents, que la porte
   accepte (`lecturesIndependantes`). Même porte, même jeton, même corps strict que ADR-0065.
5. **Le coût est mesuré, pas estimé** : jetons lus et écrits et dollars sont cumulés dans `DriveAI_RELECTURE_IMAGE_V1`
   (grille interne `h55*`) et lus à la Santé.
6. **Refus du modèle** : un refus n'est pas une lecture. Un 400/413 sans mot de limite, de crédit ou de quota vise le
   papier (PDF protégé, image refusée) et l'écarte ; tout autre refus vise l'API et le papier est retenté. Trois refus
   d'affilée arrêtent la passe sans rien écarter. Un envoi raté à la Mémoire rend les lectures au tick suivant.
7. **Nombres seulement** au journal (`RelectureImage`), à la Santé et dans la Property ; les identifiants des
   candidats viennent de la liste déjà tenue par `DriveAI_RELECTURE_ECARTES`.

## Ce qui reste ouvert

- Si l'essai est concluant, la suite (≈ 1 600 papiers, ≈ 1,6 $) est une décision de budget de Marc, sur MemoryAI#374.
- La grille interne chiffre Haiku 5.5 à 0,10 $ / 0,50 $ (ADR-0067) : la Santé doit montrer le même ordre de grandeur
  que le coût réel de cet essai.
