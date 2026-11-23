# ADR-0065 — Relire les papiers à l'aveugle pour la Mémoire (seconde lecture)

- **Statut** : **accepté** — code livré éteint (PR #680), allumé le 25/10/2026 pour une tranche de 50 papiers
  (lot 10 par tick, plafond 50).
- **Portée** : `src/RelecturePiece.gs`, deux clés `RELECTURE_PIECES_*`, un appel dans le tick, une ligne de
  Santé. **Amont** : ADR 0026 de MemoryAI (MemoryAI#219), ADR-0061 ; tâche DriveAI#678, mission #677.

## Contexte

La Mémoire garde 2 295 papiers dans sa pile « vrai / faux » sans pouvoir les vérifier (elle ne tient pas le
document). Marc a choisi (24/10/2026) qu'une seconde lecture par DriveAI, comparée à la première par du code,
juge seule les papiers qui concordent. Seul DriveAI tient le Drive et l'OCR.

## Décision

1. **Aveugle** : le modèle ne reçoit que le texte OCR du papier, sous une consigne qui ne demande que
   quatre champs (titulaire, émetteur, date du document, échéance). La première lecture n'est jamais
   passée au modèle, et la réponse de la porte ne la rend pas non plus (des nombres seulement).
2. **La Mémoire dit quoi relire** : `GET /api/pieces/relecture?canal=texte&limite=50` rend les papiers vivants,
   lus, de niveau 0-1, jamais relus, lisibles par notre canal, et la répartition de leurs extracteurs (des
   nombres, affichés à la Santé). Sans cette liste, des appels seraient payés pour des papiers que la porte
   refuse.
3. **Un autre canal, ou rien** : la porte refuse `meme_canal` (OCR contre OCR jamais). Notre étiquette,
   `haiku-4.5-relecture-v1`, dit la vérité : Haiku sur OCR ne confirme que les papiers lus en vision ; les
   autres demandent une vision d'un autre modèle, plus chère, à chiffrer pour Marc.
4. **Éteinte à 0** (`RELECTURE_PIECES_LOT`) : l'étape ne fait alors rien, pas même lire une Property. Livrée éteinte, puis allumée à 10 par tick avec un plafond de 50.
5. **Le plafond cumulé remplace le frein mensuel** : sur le « Ok pour frein » de Marc (25/10/2026), l'étape ne
   consulte pas `LLM_BUDGET_CAMPAGNES` (40,80 $ pour 40 $). `RELECTURE_PIECES_PLAFOND` (papiers lus au
   total, ~0,004 $ chacun) est son seul frein ; le relever est un geste de Marc.
6. **Ce qui ne part pas** : un papier sans texte, illisible ou inaccessible reste à Marc ; il est compté,
   jamais nommé, et retenu (`DriveAI_RELECTURE_ECARTES`, qui refuse de tronquer) pour ne pas repayer son OCR.
7. **Nombres seulement, réponses distinctes** : rien de nominatif au journal ni à la Santé. `401`/`403` sont
   des gestes de Marc (pas de suspension) ; `400`/`422` refusent la demande ; `503`, un autre code ou le
   réseau suspendent le canal partagé (`suspendreMemoire_`).
8. **Un refus du modèle n'est pas une lecture** (DriveAI#678, 27/10/2026) : une réponse non 200 du modèle (limite
   d'usage, HTTP 400) ne coûte rien et ne lit rien ; elle ne compte pas vers le plafond (`erreursModele` à part).
   Après 3 refus d'affilée la passe s'arrête (`modele-refuse`) et le papier est retenté au tick suivant. Le cumul
   passe à `DriveAI_RELECTURE_COMPTE_V2` pour effacer les 50 « lues » comptées à tort.

## Ce qui reste ouvert

- La répartition des extracteurs de la première lecture (Santé, après le premier passage) décide combien de
  papiers cette relecture peut confirmer ; le coût réel par papier (0,004 $ estimé) se remesure alors.
