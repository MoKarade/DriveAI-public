<!-- Extrait de l'ancien CLAUDE.md (§ 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

## 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Ce sont deux systèmes indépendants : la CI juge le
code, l'hébergeur construit et sert. Un merge peut passer le gate et ne jamais être déployé — la
branche reste verte, le site continue de servir l'ancien build, et rien n'est rouge nulle part.

Vécu le 31/07/2026 : quatre projets Vercel ont cessé de créer des déploiements pendant ~3 h.
DriveAI et JobAI ont rattrapé au push suivant ; Hubperso et BatchChef n'en ont pas eu — leur commit
d'en-têtes de sécurité est resté **cinq jours** en attente sans que personne ne le voie.

Donc, après un merge qui change ce qui est SERVI : vérifier qu'un déploiement de production a bien
été créé et qu'il est `READY`, puis **contrôler l'effet sur la réponse réelle** — un en-tête se lit
dans la réponse, il ne se déduit pas du fichier source.

Corollaire : un merge qui ne change QUE de la doc n'a pas de déploiement à vérifier. Le dire plutôt
que de laisser croire qu'on a vérifié.

**DriveAI a DEUX cibles, et la CI n'en garde qu'une.** Vercel déploie l'app + `api/` ; le moteur,
lui, part sur Apps Script via `deploy.yml` (`clasp push` + `clasp deploy -i $WEBAPP_DEPLOYMENT_ID` +
réinstallation des déclencheurs). Un merge qui touche `src/*.gs` n'est en ligne que quand CE
workflow-là est vert : le moteur continue sinon d'exécuter l'ancienne version, en silence, tick
après tick. Vérifier le run `deploy.yml`, pas seulement la CI ni Vercel.

### Production seule (`vercel.json`, `git.deploymentEnabled`)

Depuis #494 (2026-10-16), seule `main` se déploie : `"**": false, "*": false, "main": true`. Aucune branche
(`claude/*`, `feature/*`, `dependabot/*`, Jules) ne crée de préversion, car chaque build use le quota Vercel
partagé entre les apps. Conséquence : une PR ne se vérifie plus sur une URL de préversion, seulement par la CI ;
l'app (`app/`) se contrôle en production après le merge. Verrou : `test/structure-doc.test.js`.

### Fumée de production (`.github/workflows/fumee.yml`, #775)

Après un déploiement de production réussi (événement `deployment_status`, environnement `Production`) ou à la main (« Run workflow »), le workflow commun de MoKarade/.github sonde l'app EN LIGNE : `/api/sante` (`{ ok: true }`, `api/_sante.ts`, servie par `api/login.ts` via une réécriture de `vercel.json` : `api/` est au plafond de 12 fonctions), `/api/hub/summary` refusé sans jeton puis valide avec `HUB_TOKEN`, `/api/login` (redirection vers Google). Trois essais par contrôle ; le journal ne porte ni corps de réponse ni jeton. Rouge = ne pas dire « déployé » : lire le tableau du résumé du job, corriger par un nouveau push. L'adresse de production vient de la variable de dépôt `URL_PRODUCTION` (jamais écrite dans un fichier : le garde PII refuse le domaine) ; absente, le job est sauté. Les secrets du dépôt `HUB_TOKEN` (même valeur que Vercel) et `HUB_DISPATCH_TOKEN` (retour en arrière de la production si la fumée est rouge) sont posés par le PC, le second SEULEMENT après une première fumée verte lancée à la main.

### Erreurs de production dans Sentry (`SENTRY_DSN`, #495)

Quoi : les erreurs SERVEUR (canal moteur du résumé du hub, accès au hub) et NAVIGATEUR
(erreurs non rattrapées, rejets de promesse) partent vers le projet Sentry `driveai`. Le DSN est la
variable Vercel `SENTRY_DSN` ; le navigateur la reçoit de `/api/config` (session valide seulement).
Sans elle, Sentry est éteint et le comportement est celui d'avant.

Comment : `api/_sentry.ts` (serveur) et `app/src/sentry.ts` (navigateur) postent directement une
enveloppe à Sentry avec `fetch`, SANS SDK : `api/` n'installe aucun paquet (règle `api-sans-paquet-npm`)
et le SDK enverrait des fils d'Ariane. Deux copies parce que `src/` n'importe pas `api/` ; le test
`app/test/sentry.test.ts` vérifie qu'elles produisent le même événement.

Aucune donnée personnelle (décision de Marc, 15/10/2026) : l'événement contient le nom de l'erreur,
un message réduit (coupé au premier « : » car les messages de l'app citent parfois une réponse Google
avec des noms de fichiers, puis adresses, URL, identifiants Drive et textes entre guillemets masqués),
la pile et la source. Jamais de requête, en-tête, cookie, corps, utilisateur, fil d'Ariane ni contexte.
Le navigateur envoie au plus 5 événements par page.

Preuve : le workflow manuel « Essai Sentry » (`.github/workflows/sentry-essai.yml`) envoie une erreur
volontaire avec le secret `SENTRY_DSN` du dépôt et échoue si Sentry ne répond pas 2xx.
⚠️ Limites : la variable `SENTRY_DSN` n'est pas encore posée dans Vercel (décision de Marc du 16/10,
.github#24) donc la production n'envoie rien tant qu'elle manque ; et l'option Sentry « ne pas
stocker les adresses IP » est un réglage du projet Sentry, pas du code [À vérifier].

### En-têtes de sécurité (`vercel.json`)

Ajoutés le 2026-07-31 — DriveAI n'en avait **aucun**. Ils vivent dans `vercel.json` (SPA Vite
servi en statique, pas de config de framework où les mettre).

⚠️ **`vercel.json` REFUSE les clés de commentaire `//…`** (contrairement à `package.json`) :
son schéma rejette toute propriété additionnelle et le déploiement échoue avec
`should NOT have additional property`. D'où cette note ici plutôt que dans le fichier.

- **Enforcés** (aucun risque) : HSTS 1 an + `includeSubDomains`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **CSP en `Report-Only`**, volontairement. DriveAI est le cas le plus délicat de
  l'écosystème : par **ADR-0007**, l'app lit la Sheet d'état **depuis le NAVIGATEUR** avec le
  jeton OAuth de Marc (le serverless n'y a aucun accès). `connect-src` doit donc autoriser
  `sheets.googleapis.com` / `www.googleapis.com` / `accounts.google.com`. Une CSP trop serrée
  couperait l'app de ses propres données — **silencieusement**, sans que le build ni les tests
  ne le voient.
- ➜ **Pour passer en enforcé** : ouvrir l'app, parcourir l'explorateur, la corbeille et
  l'assistant, vérifier qu'aucune violation CSP n'apparaît en console, puis renommer la clé
  `Content-Security-Policy-Report-Only` en `Content-Security-Policy`. Tant que ce n'est pas
  fait, la CSP **observe** — elle ne protège pas.
