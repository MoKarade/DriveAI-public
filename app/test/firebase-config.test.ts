/**
 * firebase-config.test.ts — la configuration Firebase tient ses promesses (ADR-0078) : chaque route de session de Hosting
 * pointe une fonction qui EXISTE, le coût est borné, aucun secret ni adresse dans le dépôt, les en-têtes de sécurité de
 * Vercel sont repris. Lit les fichiers tels qu'ils sont : une route renommée d'un seul côté rougit ici.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '../..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');
const firebase = JSON.parse(lire('firebase.json')) as {
  hosting: { public: string; rewrites: Array<{ source: string; destination?: string; function?: { functionId: string; region: string } }>;
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
  functions: Array<{ source: string }>;
};
const index = lire('functions/src/index.ts');
const ROUTES = ['login', 'callback', 'refresh', 'logout', 'config', 'sante'];

describe('firebase.json', () => {
  it('sert app/dist et déclare le dossier functions', () => {
    expect(firebase.hosting.public).toBe('app/dist');
    expect(firebase.functions[0].source).toBe('functions');
  });
  it('chaque route /api/<nom> pointe une fonction exportée par index.ts, dans la région déclarée', () => {
    for (const nom of ROUTES) {
      const r = firebase.hosting.rewrites.find((x) => x.source === `/api/${nom}`);
      expect(r?.function?.functionId, nom).toBe(`${nom}Fn`);
      expect(index).toContain(`export const ${nom}Fn = onRequest(`);
      expect(r?.function?.region).toBe('us-central1');
    }
    expect(index).toContain("region: 'us-central1'");
  });
  it('le repli SPA est la DERNIÈRE règle (sinon il avalerait les routes /api)', () => {
    const regles = firebase.hosting.rewrites;
    expect(regles[regles.length - 1]).toEqual({ source: '**', destination: '/index.html' });
  });
  it('reprend les en-têtes de sécurité de vercel.json', () => {
    const vercel = JSON.parse(lire('vercel.json')) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
    const repris = firebase.hosting.headers.find((h) => h.source === '**')!.headers;
    for (const h of vercel.headers[0].headers) expect(repris).toContainEqual(h);
  });
});

describe('coût borné et secrets', () => {
  it('maxInstances bas et mémoire minimale sur toutes les fonctions (options globales)', () => {
    expect(index).toMatch(/setGlobalOptions\(\{[^}]*maxInstances: [12]\b/);
    expect(index).toMatch(/memory: '256MiB'/);
  });
  it('au plus 6 secrets (les 6 versions gratuites de Secret Manager), jamais de valeur dans le dépôt', () => {
    const secrets = [...index.matchAll(/defineSecret\('([A-Z_]+)'\)/g)].map((m) => m[1]);
    expect(secrets.sort()).toEqual(['COOKIE_SECRET', 'GOOGLE_CLIENT_SECRET', 'WEBAPP_SECRET']);
    expect(lire('.gitignore')).toMatch(/^\.env\.\*$/m);
    expect(index).not.toMatch(/process\.env/);
  });
  it('functions/ ne dépend que de firebase-* (le gain du portage : aucune dépendance de plus)', () => {
    const pkg = JSON.parse(lire('functions/package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['firebase-admin', 'firebase-functions']);
  });
});
