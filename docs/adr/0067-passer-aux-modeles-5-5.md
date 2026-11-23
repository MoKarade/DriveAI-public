# ADR-0067 — Passer le moteur aux modèles 5.5 et retirer les anciens

- **Statut** : **accepté le 28/10/2026** — demande de Marc (12:39Z : « tout partout aux derniers modèles, … supprime
  les anciens, je ne veux plus qu'on les garde »). L'audit du protocole de précision sur documents réels reste à
  faire à la levée de la limite API (voir Test).
- **Portée** : `src/Config.gs`, `Cout.gs`, `Llm.gs`, `Piece.gs`, `PieceVision.gs`, `Prefiltre.gs`, `RelecturePiece.gs`,
  `TriGmail.gs`. **Révise** les choix de modèle des ADR 0061 (Haiku 4.5) et 0063 (Sonnet 5). Tâche DriveAI#734,
  mission .github#648. **Protocole** : `docs/claude/11-protocole-de-precision.md`.

## Problème et objectif

Le moteur appelait Haiku 4.5 (1 $/5 $ par million de jetons), Sonnet 4.6 (3 $/15 $) et Sonnet 5 (2 $/10 $).
Anthropic signale un taux de cache faible, et le minimum cachable de Haiku 4.5 (4 096 jetons) rend inutiles les
marqueurs des appels courts. Objectif : tout sur la génération 5.5, au même niveau de précision, pour un coût plus bas.

## Décision

1. **Modèles** : `claude-haiku-5-5` (mini-appels, classement, pièces, relecture, intentions) et `claude-sonnet-5-5`
   (repli, analyse v2, chat, lecture vision). Aucun ancien identifiant dans `src/` (verrou : `test/modeles-5-5.test.js`).
2. **Réglages de requête** (`avecReglages_`, `Config.gs`) : plus de `temperature` (la 5.5 la rejette) ; Haiku sans
   réflexion (`disabled`) et `effort: low` ; Sonnet en `between_tools` (il refuse `disabled`) et `effort: medium` ;
   le chat garde la réflexion (outils enchaînés) et ne fixe que l'effort. Les blocs `thinking` du chat sont rejoués
   tels quels (`appelAnthropicChat_` rejoue `data.content`).
3. **Plafonds de jetons relevés** d'une marge : le tokenizer de Haiku 5.5 compte ~30 % de jetons en plus, et une
   réponse JSON tronquée est un document en échec. Seule la sortie réellement produite est facturée.
4. **Coût** : compteurs propres `h55*` et `s55*` (`prefixeUsage_`) aux prix du 28/10/2026 (Haiku 5.5 0,10/0,50 ;
   Sonnet 5.5 2/10, relecture de cache 0,10). Les compteurs `h`, `s`, `s5` ne reçoivent plus d'appel mais restent :
   ils chiffrent les mois déjà écrits dans `DriveAI_COUT_AAAA-MM` et le cumul publié au hub.
5. **Étiquettes d'extracteur inchangées** (`haiku-4.5-piece-v2`, `haiku-4.5-relecture-v1`, `sonnet-5-vision-piece-v3`) :
   ce sont des noms de lignée lus par la Mémoire (ADR 0010 de MemoryAI), pas des identifiants d'API. Les renommer
   demande un changement côté Mémoire : hors périmètre ici, noté pour Marc.

## Coût et quota

Haiku ÷10 sur chaque jeton, Sonnet −33 % en entrée et en sortie. Aucun appel ajouté. Le frein budget des campagnes
lit les nouveaux compteurs au bon prix (test : 0,735 $ pour 1 M de chaque poste Haiku 5.5). Les 40,84 $ du mois
viennent surtout de la lecture vision (Sonnet) : le gain y est de un tiers.

## Risques

- **Précision** : un modèle de génération différente peut ranger autrement. Non mesurable avant le 01/11 (limite API).
- **400 de paramètre** : `disabled` sur Sonnet 5.5 ou `temperature` seraient rejetés ; verrouillés par test.
- **Réflexion qui mange `max_tokens`** : coupée sur les appels courts, plafond relevé sur le chat.
- **Mois en cours mélangé** : le mois d'octobre contient des jetons anciens et neufs ; chacun garde son prix.

## Test

- `npm test` : verrous sur les identifiants, les réglages, les prix, la relecture des mois anciens sans NaN.
- **À la levée de la limite API** : `test/audit-logique.test.js` sur ~20 documents réels (au moins 3 faux positifs
  historiques en non-régression), un appel réel par famille sans 400, `cache_read_input_tokens` > 0 sur un tour de chat.
  Tant que cet audit n'est pas lu, la tâche DriveAI#734 reste ouverte (`preuve-attendue`).

## Conséquences

- Retour arrière : remettre les anciens identifiants dans `Config.gs`, `Piece.gs`, `PieceVision.gs` ; `avecReglages_`
  ne touche pas un modèle hors 5.5. Les compteurs anciens sont encore là.
- Le choix des modèles se fait à un seul endroit par rôle ; le passage automatique aux versions suivantes est porté
  par le fil du workflow (mission .github#649).
