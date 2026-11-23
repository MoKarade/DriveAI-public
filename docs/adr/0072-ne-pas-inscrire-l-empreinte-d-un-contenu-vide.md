# ADR-0072 — Ne pas inscrire à l'Index l'empreinte d'un contenu qui n'identifie rien

- **Statut** : **accepté le 29/10/2026** par le fil DriveAI, sans attendre Marc : changement réversible (aucune suppression,
  aucun coût LLM) et Marc a dit le 28/10 à 20:51Z que les décisions pas importantes se prennent sans lui.
  **Amont** : ADR-0070 (même couloir : `Pipeline.gs`, `Journal.gs`) ; protocole de précision
  (`docs/claude/11-protocole-de-precision.md`). Tâche DriveAI#814 (ancien BACKLOG, C28-40), mission DriveAI#800.

## 1. Problème et objectif

L'empreinte d'un fichier Google natif (Doc, Sheet, Slides) est le MD5 de son TEXTE EXPORTÉ (`Intake.gs`). Quand ce texte est
vide ou presque, deux natifs sans rapport partagent la même empreinte : MD5 du vide pour les exports vides. Aujourd'hui l'intake
met `ignorerDoublon` sur le natif quasi vide, donc lui-même n'est pas jugé doublon, MAIS son empreinte est quand même écrite à
l'Index (`Pipeline.gs`, `indexAjouter_(src.cle, decision, empreinte)`). Le drapeau ne survit pas dans l'Index (le code de
`Reset.gs` le dit déjà) : tout fichier dont le contenu produit la même empreinte plus tard (un fichier de 0 octet, une pièce
jointe vide, un autre natif vide qui reviendrait par un chemin sans le drapeau) est jugé « déjà vu » et part en `_Doublons`
sans qu'aucun exemplaire identifiable existe.

**Objectif** : une empreinte qui n'identifie rien n'est ni écrite à l'Index ni utilisée pour juger un doublon.

## 2. Décision

1. **`src.empreinteNonIdentifiante`** (nouveau, posé par l'intake pour un natif dont le texte exporté a moins de
   `OCR_MIN_CARS_EXPLOITABLE` caractères). `traiterDocument_` passe l'empreinte calculée par `empreinteUtilisable_` (fonction
   pure, `Pipeline.gs`) : `''` si le drapeau est posé, si l'empreinte est vide, ou si elle vaut le MD5 du contenu vide
   (`CONFIG.EMPREINTE_CONTENU_VIDE`). Une empreinte `''` ne sert pas au fast-path doublon et n'est pas écrite (colonne G vide).
2. **Lecture** : `estDoublon_` (`Journal.gs`) répond `false` pour le MD5 du contenu vide, même s'il traîne dans l'Index
   (lignes écrites avant ce correctif). Le chemin chaud (`chargerIndexCache_`) ne change pas.
3. `ignorerDoublon` reste posé par l'intake sur ce même cas : double garde, aucun risque de régression.
4. **Un fichier de 0 octet** (ou une pièce jointe vide) n'est donc plus jamais un « doublon » d'un autre fichier vide. Il suit le
   pipeline normal. C'est voulu : deux contenus vides ne sont pas le même document.

## 3. Ce que cette décision ne règle pas

Les lignes déjà écrites pour un natif court non vide (de 1 à 19 caractères) ne peuvent pas être reconnues dans l'Index : on ne
sait plus la longueur du texte d'où vient l'empreinte. Seul le MD5 du contenu vide est reconnu à la lecture. Le risque résiduel
est un contenu identique mot pour mot, très court, déposé plus tard par un autre chemin : accepté, et il ne grandit plus.

## 4. Impact quotas, coût et risques

- Aucun appel Google ou LLM de plus : une comparaison de chaînes.
- Le classement n'est pas modifié (domaine, entité, nom) : le fichier suit le pipeline normal. Pas d'audit sur documents réels.
- Risque : un doublon vide réel (deux fichiers vides) est maintenant classé deux fois au lieu d'être écarté. Moins grave que
  l'inverse (un document sans exemplaire classé), et réversible (déplacement seul).

## 5. Méthode de test

`test/empreinte-vide.test.js` : fonction pure, lecture (MD5 du vide connu mais jamais doublon, témoin : une autre empreinte
connue reste doublon) et chemin (`traiterDocument_` n'écrit aucune empreinte pour un natif vide et ne l'envoie pas en
`_Doublons`). Chaque garde est retirée une à une pour vérifier qu'un test rougit.
