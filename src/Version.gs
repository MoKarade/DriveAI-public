/**
 * Commit déployé — rempli par `deploy.yml` (étape « Dater le code poussé »), JAMAIS à la main.
 *
 * Le dépôt porte la valeur de repli ci-dessous ; la CI la remplace par le SHA court du commit
 * qu'elle pousse, juste avant `clasp push`. `versionPilote_()` (WebApp.gs) la renvoie, et la CI
 * vérifie que `/exec` sert bien CE commit : c'est le seul signal qui VARIE à chaque déploiement
 * (BACKLOG C49-24 — `5min|t7` ne bougeait pas depuis des semaines).
 */
var COMMIT_DEPLOYE = 'non-deploye-par-ci';
