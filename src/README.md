# `src/` — moteur Apps Script

> Poussé tel quel dans le projet Apps Script (via `clasp push`, déploiement auto sur merge).
> Tout document est **classé** (plus de file de revue depuis le 2026-07-01) ; l'idempotence
> des documents vit dans l'**Index** de la Sheet d'état (le scope `gmail.modify` est réservé
> au tri natif dans `TriGmail.gs` : pose de libellés existants et archivage réversible uniquement).

| Module | Rôle |
|--------|------|
| `Config.gs` | Configuration centrale (aucun secret — la clé API vit en Script Properties) |
| `Version.gs` | Identifiant du commit déployé (injecté par la CI au déploiement) |
| `Main.gs` | Orchestration du tick (`tickDriveAI`, 41 étapes) + déclencheurs + chien de garde |
| `Suivi.gs` | Registre des 41 étapes et suivi LIVE (`Progression`, ventilation des coûts) |
| `WebApp.gs` | Pont HTTP (`doGet`/`doPost`) entre l'app web / GitHub Actions et le moteur |
| `Pipeline.gs` | Traitement unifié d'un document (doublon → technique → média → OCR → LLM → routage) |
| `Gmail.gs` | Source 1 : PJ des mails récents (lecture seule) et suspension sur quota Gmail |
| `TriGmail.gs` | Tri natif Gmail (libellés existants, archivage après lecture, audit sujet+corps) |
| `Intake.gs` | Source 2 : dépôt manuel `00 · À trier` (déplacement) |
| `Partages.gs` | Source 3 : fichiers partagés récents (copie, ADR-0005) |
| `Migration.gs` | Campagne de re-classement de l'existant (#8, gatée par tag) |
| `Ocr.gs` | Extraction de texte (conversion Drive + OCR, REST) |
| `Llm.gs` | Classification V2 (2 passes Sonnet) et V1 (Haiku, escalade Sonnet bornée) + parsing strict |
| `Gemini.gs` | Fournisseur Gemini (ADR-0073) : traduction Anthropic ↔ `generateContent` à la frontière réseau, clé `DriveAI_GEMINI_KEY`, sonde `sonderGemini` |
| `Router.gs` | Décision de routage/nommage + dossiers spéciaux (`_Doublons`, `_Technique`, `_Médias`) |
| `Entites.gs` | Référentiel d'entités (proposition filtrée, consolidation, validation, curation) |
| `Corrections.gs` | Apprentissage few-shot depuis l'onglet `Corrections` (ADR-0003) |
| `Formulaire.gs` | Formulaire Google de correction (find-or-create + lecture des réponses) |
| `Journal.gs` | État Sheet : Index (idempotence), Journal borné, Santé, quarantaine, Télémétrie |
| `Resume.gs` | Résumé hebdomadaire par mail |
| `Cout.gs` | Mesure du coût LLM réel (cible < 10 $/mois, plafond 20 $/mois) |
| `Prefiltre.gs` | Pré-filtres déterministes (mots-clés, zone protégée) ; l'importance est décidée par `TriGmail.gs` (ADR-0075 6b) |
| `DriveRest.gs` | Opérations Drive REST (déplacement/renommage/raccourci/métadonnées — jamais de suppression) |
| `Maintenance.gs` | Outils manuels (`dequarantaine`, `rangerToutLeDrive`) + mécanique du grand rangement |
| `Diagnostic.gs` | Diagnostic un-clic en lecture seule (`etatCampagnesRangement`) |
| `HistoriqueVrac.gs` | Série temporelle append-only (`HistoriqueVrac`) du vrac par domaine |
| `Consolidation.gs` | Génération dry-run du plan de consolidation (`PlanConsolidation`, ADR-0023) |
| `ConsolidationExec.gs` | Exécution par déplacement seul du plan de consolidation (ADR-0024) |
| `Fusion.gs` | Clustering dry-run des dossiers d'entité synonymes (`PlanFusion`, ADR-0036) |
| `FusionExec.gs` | Exécution par déplacement seul des fusions validées (ADR-0037) |
| `Missions.gs` | Missions de curation fine dossier par dossier (ADR-0039) |
| `DocumentsID.gs` | Drainage ciblé de la structure héritée `Documents ID` (ADR-0048) |
| `Doublons.gs` | Validation par empreinte de `_Doublons` (ADR-0047) |
| `RetourOrphelins.gs` | Remise en circulation des exemplaires uniques écartés dans `_Doublons` |
| `ResolutionFileId.gs` | Résolution rétroactive des `FileId` manquants dans `Index` (C49-16) |
| `Reset.gs` | Arborescence cible et routage du grand rangement complet (`_TRI 2026`, ADR-0030) |
| `DryRunV2.gs` | Banc d'essai comparatif V2 / V1 sans mutation Drive (`DryRunV2`, `DryRunV2Compare`) |
| `Reorg.gs` | Propositions de réorganisation IA à la demande depuis l'app (`Réorg`) |

Détails d'architecture : `docs/ARCHITECTURE.md` · garde-fous : `CLAUDE.md` §2.
