# ADR-0069 — Partager l'état de LIA avec le hub : relais serveur par jeton d'app

- **Statut** : **Abrogé** le 05/11/2026 par l'ADR-0074 (LIA est retirée de l'app, `api/lia/*` avec elle). Était : **accepté le 28/10/2026** par le fil DriveAI, sans attendre Marc : c'est une décision réversible (aucun coût,
  aucune suppression, rien de public), et Marc a dit à 20:51Z que les décisions pas importantes se prennent sans lui.
  **Amont** : « une seule LIA, un seul état » (Marc, 23/10/2026), « LIA hébergée dans MemoryAI » (Marc, 28/10/2026), ADR
  « maison de LIA » du hub (le hub est le seul détenteur des jetons). **Portée** : cadrage seulement ; le code est dans
  deux tâches (voir la fin). Tâche DriveAI#696, mission MoKarade/.github#557.

## Contexte

LIA garde son état (humeur, envies, discussion, mémoire lente) à un seul endroit : MemoryAI (`GET|PUT /api/etat-lia`,
contrat `commun/assistant/CONTRAT-etat-lia.md`). Le hub le relaie à la page par `/api/lia/etat`, et les autres apps font
de même avec **le cookie de session du hub**, qui est partagé sur le domaine commun des apps (même `AUTH_SECRET`). DriveAI est à part :
son cookie `driveai_rt` est le sien (chiffré par son propre secret, il porte le jeton Google de Drive) et le cookie du hub ne
lui dit rien. Résultat aujourd'hui : DriveAI démarre LIA sans l'option `etat` (`app/src/main.tsx`), donc sa LIA vit seule
dans le navigateur, et la discussion de Marc ne la suit pas.

Ce qui existe déjà et pèse dans le choix [Certain, lu dans le code du 28/10/2026] :

- `POST /api/lia/ask` du hub accepte DEUX appelants : une app (`x-hub-token`, identifiée par le jeton, qui déclare
  elle-même si la personne est le propriétaire) ou la page du hub (session). `GET|PUT /api/lia/etat` du hub n'accepte
  QUE la session : un `x-hub-token` n'y ouvre rien.
- DriveAI relaie déjà `ask` ainsi : session `driveai_rt` revérifiée à chaque appel (`aLeDroitDEntrer`), puis le hub avec
  `HUB_TOKEN` (`api/_lia.ts`). Ce chemin est audité et en production.
- `etatHttp` de `@mokarade/lia-ui` n'accepte qu'une adresse de MÊME origine.

## Options

1. **Relais serveur par jeton d'app (retenu).** DriveAI ajoute `api/lia/etat.ts` (GET, PUT), qui revérifie la session comme
   `ask` puis appelle `/api/lia/etat` du hub avec `x-hub-token` et `x-lia-proprietaire: 1`. Le hub apprend à accepter ce
   jeton sur cette route, comme sur `ask`.
   Pour : même modèle de confiance que `ask` (déjà audité), aucun jeton côté navigateur, MemoryAI jamais appelée par
   l'app, accès retiré = refusé à la lecture suivante, état de MemoryAI inchangé. Sert aussi FinanceAI, qui ne partage pas
   non plus la session [À vérifier].
   Contre : deux changements (hub, puis DriveAI), une fonction Vercel de plus, une lecture par minute et par onglet visible.
2. **Navigateur vers le hub, cookie du hub, d'un autre sous-domaine.** `drive.` et `www.` sont du même site, donc le cookie
   du hub partirait avec un `fetch` `credentials: 'include'`.
   Pour : aucun code serveur côté DriveAI.
   Contre : il faut ouvrir le CORS du hub avec identifiants à un autre domaine (surface nouvelle sur la route la plus
   sensible), écrire un adaptateur à la main (`etatHttp` refuse une autre origine), et l'état ne se partage que si Marc
   est aussi connecté au hub : sans cookie, LIA retombe en silence sur son état local. Rejeté.
3. **Attendre la migration vers Next 16 (DriveAI#496).** DriveAI prendrait alors la session du hub et copierait la route de
   BatchChef sans changement. Rejeté pour maintenant : #496 attend #492, qui attend le passage en public (.github#16).
   Marc veut une seule LIA maintenant. Le relais de l'option 1 se remplace alors par la route de BatchChef sans rien
   perdre (même URL côté page).
4. **App vers MemoryAI directement.** Casse l'ADR « maison de LIA » (le hub seul détient les jetons) et donnerait à DriveAI un
   jeton vers la Mémoire. Rejeté.

## Décision

L'option 1.

1. **DriveAI → hub** : `GET|PUT {hub}/api/lia/etat`, en-têtes `x-hub-token: HUB_TOKEN` et `x-lia-proprietaire: 1`, ce dernier
   posé SEULEMENT après `estProprietaire(session.email, ALLOWED_EMAIL)` ; un invité de DriveAI reçoit 403 sans aucun
   appel. Aucun `appId` dans le corps. https obligatoire, délai court, `no-store`, jamais l'état ni le jeton au journal.
2. **Navigateur → DriveAI** : `etatHttp('/api/lia/etat')` (même origine) passé à `demarrerLia`. Mêmes codes que les autres
   apps : 200 + l'état, 204 s'il n'y en a pas, 409 + l'état plus récent, 400/413 corps refusé, 401 sans session, 403 accès
   retiré, 429, 503 hub ou Mémoire muets (LIA garde son état local et vit quand même).
3. **Le corps est jugé avant tout saut réseau** par la fonction même de LIA (`validerEtat`), comme au hub : un état hors
   contrat n'atteint pas le hub, jamais réparé, jamais inventé. Taille bornée comme au hub.
4. **Onglet caché = aucune lecture** (adaptateur `etatHorsFond` du hub, recopié) : un onglet oublié coûtait 1 440 appels par
   jour chez le hub (Vercel, octobre 2026). Sans lecture gardée, une vraie lecture, jamais un état inventé.
5. **Aucun nouveau secret** : `HUB_TOKEN` sert déjà dans les deux sens.

## Conséquences et points à vérifier à l'écriture du code

- **Ordre** : le hub d'abord (accepter le jeton sur `/api/lia/etat`, tests : jeton connu sans en-tête propriétaire = 403,
  jeton faux = 401 sans repli sur la session, route toujours derrière le garde), puis DriveAI. D'ici là DriveAI n'appelle
  rien : la tâche DriveAI attend celle du hub.
- **Fonctions Vercel** : DriveAI en compte 11 dans `api/` (hors fichiers `_`), la route fait 12, le plafond du plan Hobby
  [À vérifier au moment du code, le passage en Hobby étant prévu avant le 24/11]. Si le compte déborde, faire passer
  `ask` et `etat` par une seule fonction plutôt que d'en créer une.
- Ne pas toucher à `vercel.json` (chemin protégé) : la route n'attend pas plus que la valeur par défaut.
- Pin lia-ui : demandé à v0.39.0 dans la tâche d'origine ; DriveAI est déjà sur v0.47.0 (DriveAI#768), rien à faire.
- Cette décision ne touche ni le moteur Apps Script ni le canal Mémoire des papiers.

## Tâches qui suivent

- Hubperso : le hub accepte le jeton d'une app sur `/api/lia/etat`.
- DriveAI : `api/lia/etat.ts`, branchement dans `app/src/main.tsx`, tests à données fictives. Attend la tâche du hub.

## Mise en œuvre (28/10/2026, DriveAI#771)

Le hub accepte le jeton d'une app sur `/api/lia/etat` (Hubperso#685). Écart avec le cadrage : `api/` compte déjà 12 fonctions
(plafond du plan Hobby), donc la route n'est PAS une 13e fonction : `api/lia/ask.ts` l'aiguille (`?cible=etat`, réécriture de
`vercel.json`). Autre écart : `validerEtat` n'étant pas importable depuis `api/`, DriveAI juge la FORME du corps (objet, `version`
et `maj` numériques, 16 Ko) et le hub juge l'état en entier avant MemoryAI. Détail : `docs/claude/07-hub.md`.
