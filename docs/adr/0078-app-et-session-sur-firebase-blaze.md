# ADR-0078 — L'écran et la session de DriveAI sur Firebase (plan Blaze, plafonds bas)

**Statut** : Accepté (18/11/2026). Complète 0074 (§2 point 5, « app et `api/` vers Firebase »). Code livré par étapes ; l'état
courant est dans `HANDOVER.md`.

## Contexte

L'app (`app/`) et ses fonctions (`api/`) sont sur Vercel, bloqué jusqu'au 03/12/2026 (dépassement du CPU gratuit). Marc a
choisi Firebase (05/11 puis 18/11/2026) et, le 18/11/2026, le plan **Blaze** (carte) plutôt que Spark, après avoir lu le
comparatif du 18/11 (`/mnt/project-files/driveai/2026-11-18_firebase-spark-vs-blaze.md`, sources officielles lues ce jour-là).
Faits qui tranchent : sans carte, Cloud Functions ne se déploie pas ; or la session durable (C28-14) repose sur un jeton de
rafraîchissement qu'un navigateur seul ne peut pas détenir (sans serveur : jeton d'une heure, un clic pour le renouveler).
La clé Gemini n'a aucun lien avec ce chantier : elle vit dans les propriétés Apps Script du moteur.

## Décision

1. **Hosting** sert `app/dist` ; **Cloud Functions v2** porte les six routes de `api/` qui servent encore
   (`login`, `callback`, `refresh`, `logout`, `config`, `sante`), dans `functions/src/` (portage de `api/_lib.ts`, mêmes
   comportements, même périmètre OAuth Sheets + Drive, jamais Gmail).
2. **Un seul cookie, `__session`** : derrière Hosting, tout autre cookie est retiré de la requête (doc Firebase « Manage
   cache behavior »). Il porte tour à tour l'état anti-CSRF (10 min) puis la session (1 an), chiffré AES-256-GCM, HttpOnly,
   Secure, SameSite=Lax (Strict casserait le retour de Google, puisque c'est le même cookie).
3. **Propriétaire seul** : le hub est retiré (ADR-0074), donc plus de lecture de `/api/acces` ni d'invité ; `ALLOWED_EMAIL`
   est la seule adresse admise, vérifiée au callback et à chaque `refresh` / `config`. `api/hub/summary` et `_accesHub` ne
   sont PAS portés ; ils restent dans `api/` tant que Marc n'a pas dit oui à leur suppression.
4. **Secrets** dans Secret Manager (`GOOGLE_CLIENT_SECRET`, `COOKIE_SECRET`, `WEBAPP_SECRET`, trois versions sur les six
   gratuites) ; le reste (identifiant client, adresse, Sheet, URL de la web app) en paramètres, fichier `.env.<projet>` non
   versionné. Aucune valeur dans le dépôt.
5. **Coût borné** : `maxInstances` bas et mémoire minimale sur chaque fonction, alerte de budget à 5 $ (courriels à 50, 90 et
   100 %) et plafond de dépense Cloud Functions à 5 $, posés par Marc dès Blaze actif (gestes ci-dessous).

## Conséquences

- Coût attendu ≈ 0 $ (quotas gratuits Functions : 2 M appels, 400 000 Go-s, 200 000 CPU-s par mois) [Probable, à mesurer sur
  la première facture]. Blaze n'a **pas de plafond dur** : les alertes n'arrêtent rien et le plafond de dépense Functions est
  en Preview, non instantané (doc « spend caps »).
- La session reste durable (un an, renouvelée sans clic). Une ancienne session Vercel (cookie `driveai_rt`) n'est pas reprise :
  une reconnexion, une seule fois.
- Le verrou `tests/auth` d'avant (« `/hub/summary` hors proxy ») disparaît avec le hub ; remplacé par
  `app/test/functions-session.test.ts` (cookie unique, verrou d'identité, 401 muet).
- Gestes de Marc : passer le projet en Blaze, poser l'alerte de budget et le plafond, donner l'identifiant du projet Firebase,
  ajouter l'adresse `https://<domaine>/api/callback` aux URI de redirection du client OAuth Google, poser les trois secrets.

## Alternatives écartées

- **Spark seul** : 0 $ garanti, mais jeton d'une heure renouvelé par un clic (pas de jeton de rafraîchissement dans un
  navigateur) et plus de lieu sûr pour le secret de la web app. Écarté par Marc le 18/11/2026.
- **Écran servi par Apps Script** : session Google durable sans serveur ; écarté par Marc au profit de Firebase.
