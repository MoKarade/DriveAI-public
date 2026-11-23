// scripts/sentry-essai.mjs — envoie UNE erreur volontaire à Sentry et dit si elle est partie (#495).
//
// Lancé par le workflow « Essai Sentry » (secret SENTRY_DSN du dépôt) ou à la main avec
// SENTRY_DSN dans l'environnement. Il passe par le MÊME code que les fonctions Vercel
// (api/_sentry.ts : message réduit, aucune donnée personnelle), jamais par un envoi libre.
//
// Échec fermé : sans DSN valide, ou si Sentry ne répond pas par un code 2xx, le script sort en
// erreur. Il n'affiche jamais le DSN. Node 22.18+ lit le .ts directement (retrait des types).

import { envoyerErreur, lireDsn } from "../api/_sentry.ts";

const dsn = process.env.SENTRY_DSN;
if (!lireDsn(dsn)) {
  console.error("SENTRY_DSN absent ou invalide : rien envoyé. Définis-le puis relance.");
  process.exit(1);
}

const resultat = await envoyerErreur(
  dsn,
  new Error("Erreur d'essai volontaire (workflow Essai Sentry) : aucune panne réelle."),
  { source: "essai", environnement: "essai", plateforme: "node", delaiMs: 10_000 },
);

console.log(`Identifiant d'événement : ${resultat.id}`);
console.log(`Réponse HTTP de Sentry : ${resultat.statut ?? "aucune"}`);
console.log(`Livraison accusée par Sentry : ${resultat.livre ? "oui" : "non"}`);
process.exit(resultat.livre ? 0 : 1);
