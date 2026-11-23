# COUTS.md — Où part l'argent de DriveAI

> Demande Marc (2026-08-19) : « je veux avoir le détail de coût, pour tout, pour l'app et hubperso ».
> Ce document sépare ce que le moteur **mesure** de ce qu'il ne peut que **documenter**, et dit
> explicitement ce qui n'est pas vérifiable depuis le code.

## 1. La seule dépense variable : l'API du modèle (Anthropic aujourd'hui, Gemini dès l'étape 5 de l'ADR-0074)

> **05/11/2026 (ADR-0073)** : le moteur sait parler à l'API Gemini (palier payant, crédit prépayé = plafond, 20 $/mois) ; tant
> que l'étape 5 n'a pas changé les noms de modèles, tout reste chez Anthropic. Grille relevée le 05/11/2026 : 3.8 Flash 0,75 $ /
> 3,75 $ par million de jetons (1,50 $ / 7,50 $ dès le 01/01/2027) ; 3.5 Flash-Lite 0,30 $ / 2,50 $, soit 3 à 5 fois Haiku 5.5 :
> le gain ne vient que du grand modèle. Prix dans `CONFIG.LLM_PRIX` (familles `g38`, `gl35`), comptés comme les autres.

> **ADR-0075 (étape 6 ; 6b allumée le 06/11/2026, drapeau retiré, règles `r3`)** : le tri lit le corps, un fil coûte ~1 000 jetons d'entrée au lieu de
> deux mini-appels de ~150 : ≈ 1,5 $/mois sur Flash-Lite à 150 fils/j [Probable], mesuré par l'opération `tri-gmail` ; l'audit manuel
> (`auditerTriSujetCorps`, 20 fils × 2 appels, opération `audit-tri`, lancé par la CI depuis le 06/11/2026) coûte quelques cents.

> **ADR-0076 (étape 7, historique archivé sans libellé)** : au plus `TRI_FOND_MAX_FILS_JOUR` = 300 fils lus par jour pour les TROIS
> campagnes de fond (hier : 150 + 150, enveloppe inchangée), dont au plus `TRI_FOND_RESERVE_VIVANT` = 150 laissés au cyclique ;
> un mini-appel par expéditeur inconnu, ≤ 0,05 $/jour au pic sur Haiku 5.5 [Probable], zéro une fois la campagne « terminé » ;
> frein campagnes §2.6 en garde-fou. Mesuré par l'opération `tri-gmail`. Côté Sheet : une ligne `tri|` par fil archivé
> traité (≤ 150/j, ~10 000 au total), chargée en mémoire à chaque tick avec le reste de l'Index.

> **ADR-0077 (étape 8, doublons sur taille ET empreinte)** : aucun appel LLM ajouté. Un appel Drive REST (`files.get`,
> métadonnées seules, gratuit, quota UrlFetch 20 000/j) par document déposé dans Drive (aucun pour un natif ni un partage),
> plus un par EXEMPLAIRE relu par exécution (mémorisé : 150 copies du même fichier = un appel) ; pire cas, une page
> d'intake de 150 doublons d'exemplaires distincts = 300 appels. `PORTEUR_VERIF_MAX_RUN` passe à 150 `getFileById` par
> run (DriveApp, pas UrlFetch). En échange, plus aucun téléchargement du contenu pour hacher un dépôt Drive (hier :
> jusqu'à 20 Mo par fichier). Un fichier dont le doublon n'est pas PROUVÉ (exemplaire non nommé, REST en panne) est classé comme un
> document neuf : au plus un classement de plus par doublon douteux, jamais une fusion de deux contenus différents.

C'est le poste qui bouge, et le seul que DriveAI peut mesurer lui-même. Depuis C28-58, chaque
appel est **attribué à l'usage qui l'a déclenché**.

**Où le voir**
- Onglet **`Coûts`** de la Sheet d'état : total du mois en tête, puis un poste par usage, trié du
  plus cher au moins cher, avec sa part en %.
- (Jusqu'au 05/11/2026, ADR-0074) connecteur MCP : `etat_moteur` renvoyait `couts` (total, appels, `nonVentile`, et les 25 postes
  les plus chers).
- Onglet `Santé` : le total du mois et la cible.

**Comment c'est calculé** — pas une estimation : chaque réponse Anthropic porte son `usage`
(tokens d'entrée, de sortie, d'écriture et de lecture de cache), tarifé par `CONFIG.LLM_PRIX`
(prix par million de tokens, Haiku et Sonnet séparés). Le total ventilé doit toujours égaler le
total global — un test verrouille cette égalité.

**Les postes** portent le nom de l'étape du tick (`intake-gmail`, `tri-gmail` ; `intentions` n'existe plus depuis le 06/11/2026, ADR-0075 6b,
`mission-*`, `reanalyse-v2`…) — plus `reset-pilote` pour le rangement lancé par la CI, qui reste du
travail AUTOMATIQUE malgré son déclencheur externe. Et :
- `app:<action>` — ce que **tes** demandes coûtent (chat de l'assistant, recherche IA), séparé du
  travail automatique. ⚠️ Le **connecteur MCP (retiré) ne consommait aucun LLM** : il lisait des états déjà
  calculés, il n'apparaît donc pas comme poste de coût ;
- `(hors étape)` — un appel hors de tout contexte connu (ne devrait pas arriver : si ce poste
  grossit, c'est un signal, pas du bruit) ;
- `(autres)` — au-delà de 60 postes distincts, le surplus y est agrégé : le total reste juste,
  seul le détail des plus petits se perd ;
- `(non ventilé — antérieur au détail, ou non attribué)` — l'essentiel vient de ce qui a été
  dépensé **avant** la mise en place du détail (ce mois-ci : presque tout). Mais pas seulement :
  les postes sont figés au prix de l'instant de l'appel, alors que le total est recalculé aux prix
  COURANTS — changer `CONFIG.LLM_PRIX` en cours de mois creuse donc aussi cet écart. D'où un
  libellé qui n'affirme pas une cause unique.

**Garde-fou** — `CONFIG.LLM_BUDGET_CAMPAGNES` met en pause les campagnes de rattrapage au-delà du
plafond mensuel. Il ne gate **jamais** le flux vivant (intake, tri) : une facture
élevée ne peut pas arrêter le classement du courrier du jour.

## 2. Les dépenses fixes — ce qui est vérifiable, et ce qui ne l'est pas

| Poste | Coût | Vérifié comment |
|---|---|---|
| **Google Apps Script** (le moteur) | **0 $** | Aucun service payant : quotas du compte Google, pas de facturation. |
| **Google Drive / Gmail / Sheets / Forms** | **0 $** au-delà du stockage déjà payé | DriveAI n'ajoute aucun service facturé ; il consomme le quota du compte. |
| **Projet GCP `hubperso`** (Tasks + Agenda, ADR-0041, retiré le 05/11/2026 par l'ADR-0074) | **0 $** | DriveAI n'appelle plus ces API. Quand il le faisait : les API Google Tasks et Google Calendar n'ont **pas** de tarification à l'usage, et un client OAuth est gratuit. |
| **Vercel** (l'app + les endpoints `api/`) | part d'un abonnement **Pro**, ~20 $/mois | ⚠️ **Inféré, pas lu sur la facture** : `vercel.json` déclarait `maxDuration: 90` sur `api/mcp/index.ts` (retiré le 05/11/2026, ADR-0074), or le palier Hobby plafonne les fonctions à 60 s — ce réglage n'était servi que par Pro. Plan Hobby depuis le 24/09/2026. |
| **Nom de domaine `exemple.com`** | non mesurable ici | Facturé par le registrar, hors de portée du code. |

**Ce que je ne peux pas faire** : lire ta facture Vercel. L'API Vercel exposée à cette session
donne les projets et les déploiements, pas la facturation.

**La part de DriveAI dans Vercel** — l'abonnement est au niveau de l'équipe *mokarade's projects*,
qui porte **6 projets** : `driveai`, `finance-ai`, `job-ai`, `car-ai`, `batchchef`, `hubperso`.
L'abonnement Pro est donc un coût **partagé** : l'attribuer entièrement à DriveAI serait faux. À
répartir, ou à considérer comme un coût de plateforme commun à tout ton écosystème.

## 3. Lire la ventilation sans se tromper

- **Le mois en cours est incomplet.** La ligne « non ventilé » dit combien a été dépensé avant que
  le détail n'existe. Le premier mois PLEINEMENT ventilé sera le suivant.
- **Un poste cher n'est pas un poste fautif.** L'intake et la re-analyse traitent des documents
  entiers (Sonnet, deux passes) ; le tri ne voit qu'un expéditeur et un sujet (Haiku, un appel
  court). Un écart de 100× entre eux est normal.
- **Les postes `app:*` sont ton usage direct** (chat, recherche IA) : les seuls que tu contrôles à
  la minute. Le travail automatique déclenché de l'extérieur (le reset piloté par la CI) porte sa
  propre clé `reset-pilote` — il ne se cache pas dans `app:*`.
