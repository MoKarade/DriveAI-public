/**
 * sante.test.ts — la route de santé /api/sante (api/_sante.ts, servie par api/login.ts) et le branchement de la fumée de
 * production commune (.github/workflows/fumee.yml) — tâche #775. Données FICTIVES. Les cas de refus comptent le plus : une santé
 * qui dit « ok » quand le site ne peut faire entrer personne ferait passer la fumée au vert à tort.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { repondreSante, visePartageSante } from '../../api/_sante';
import login from '../../api/login';

const racine = join(__dirname, '..', '..');
const lire = (chemin: string) => readFileSync(join(racine, chemin), 'utf8');

const CLES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'COOKIE_SECRET'] as const;
const BASE: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'id-test-sante',
  GOOGLE_CLIENT_SECRET: 'secret-test-sante',
  COOKIE_SECRET: 'cookie-secret-test-sante',
};

function fauxReq(method: string, url: string): IncomingMessage {
  return { method, url, headers: { host: 'exemple.test', 'x-forwarded-proto': 'https' } } as unknown as IncomingMessage;
}

function fauxRes() {
  const entetes: Record<string, unknown> = {};
  let corps = '';
  const res = {
    statusCode: 0,
    entetes,
    setHeader(nom: string, valeur: unknown) { entetes[nom] = valeur; },
    getHeader(nom: string) { return entetes[nom]; },
    end(texte?: string) { corps = texte ?? ''; },
    corps: () => corps,
  };
  return res as unknown as ServerResponse & { corps: () => string; entetes: Record<string, unknown> };
}

function avecEnv(vars: Record<string, string>, fn: () => void): void {
  const avant = CLES.map((k) => [k, process.env[k]] as const);
  for (const k of CLES) delete process.env[k];
  Object.assign(process.env, vars);
  try { fn(); } finally {
    for (const [k, v] of avant) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

afterEach(() => {
  for (const k of CLES) delete process.env[k];
});

describe('visePartageSante', () => {
  it('seul ?cible=sante (posé par la réécriture) vise la santé', () => {
    expect(visePartageSante(fauxReq('GET', '/api/login?cible=sante'))).toBe(true);
    expect(visePartageSante(fauxReq('GET', '/api/login?autre=1&cible=sante'))).toBe(true);
    for (const url of ['/api/login', '/api/login?cible=etat', '/api/login?cible=Sante', '/api/login?cible=', '/api/login?x=sante']) {
      expect(visePartageSante(fauxReq('GET', url))).toBe(false);
    }
  });

  it('une URL absente ou illisible ne vise pas la santé et ne plante pas', () => {
    expect(visePartageSante({ method: 'GET', headers: {} } as unknown as IncomingMessage)).toBe(false);
    expect(visePartageSante(fauxReq('GET', 'http://[::1'))).toBe(false);
  });
});

describe('repondreSante', () => {
  it('variables OAuth présentes → 200 { ok: true }, no-store, JSON', () => {
    avecEnv(BASE, () => {
      const res = fauxRes();
      repondreSante(fauxReq('GET', '/api/login?cible=sante'), res);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.corps())).toEqual({ ok: true });
      expect(res.entetes['Cache-Control']).toBe('no-store');
      expect(String(res.entetes['Content-Type'])).toMatch(/^application\/json/);
    });
  });

  it('HEAD passe aussi', () => {
    avecEnv(BASE, () => {
      const res = fauxRes();
      repondreSante(fauxReq('HEAD', '/api/login?cible=sante'), res);
      expect(res.statusCode).toBe(200);
    });
  });

  it.each(CLES)('%s manquante → 503 { ok: false, cause: "config" } : le site ne peut pas faire entrer personne', (manquante) => {
    const vars = { ...BASE };
    delete vars[manquante];
    avecEnv(vars, () => {
      const res = fauxRes();
      repondreSante(fauxReq('GET', '/api/login?cible=sante'), res);
      expect(res.statusCode).toBe(503);
      const corps = JSON.parse(res.corps()) as { ok: boolean; cause: string };
      expect(corps).toEqual({ ok: false, cause: 'config' });
      expect(corps.cause).toMatch(/^[a-z-]{1,20}$/); // la seule forme que la fumée recopie dans son journal public
      expect(res.entetes['Cache-Control']).toBe('no-store');
    });
  });

  it('variable vide = variable manquante', () => {
    avecEnv({ ...BASE, COOKIE_SECRET: '' }, () => {
      const res = fauxRes();
      repondreSante(fauxReq('GET', '/api/login?cible=sante'), res);
      expect(res.statusCode).toBe(503);
    });
  });

  it('la réponse publique ne nomme aucune variable et ne contient aucune valeur', () => {
    for (const vars of [BASE, {}]) {
      avecEnv(vars, () => {
        const res = fauxRes();
        repondreSante(fauxReq('GET', '/api/login?cible=sante'), res);
        const texte = res.corps();
        for (const secret of Object.values(BASE)) expect(texte).not.toContain(secret);
        for (const nom of CLES) expect(texte).not.toContain(nom);
      });
    }
  });

  it('POST et PUT → 405 avec Allow, sans lire la configuration', () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      avecEnv(BASE, () => {
        const res = fauxRes();
        repondreSante(fauxReq(method, '/api/login?cible=sante'), res);
        expect(res.statusCode).toBe(405);
        expect(res.entetes['Allow']).toBe('GET, HEAD');
      });
    }
  });
});

describe('api/login.ts sert la santé sans changer la connexion', () => {
  it('/api/login?cible=sante → la santé : aucune redirection, aucun cookie', () => {
    avecEnv(BASE, () => {
      const res = fauxRes();
      login(fauxReq('GET', '/api/login?cible=sante'), res);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.corps())).toEqual({ ok: true });
      expect(res.entetes['Location']).toBeUndefined();
      expect(res.entetes['Set-Cookie']).toBeUndefined();
    });
  });

  it('/api/login sans cible → toujours la redirection vers Google avec le cookie anti-CSRF (c\'est ce que la fumée lit comme « connexion »)', () => {
    avecEnv(BASE, () => {
      const res = fauxRes();
      login(fauxReq('GET', '/api/login'), res);
      expect(res.statusCode).toBe(302);
      expect(String(res.entetes['Location'])).toMatch(/^https:\/\/accounts\.google\.com\//);
      expect(res.entetes['Set-Cookie']).toBeDefined();
    });
  });

  it('/api/login sans cible et sans configuration → toujours 500 (la fumée voit rouge sur la connexion)', () => {
    avecEnv({}, () => {
      const res = fauxRes();
      login(fauxReq('GET', '/api/login'), res);
      expect(res.statusCode).toBe(500);
    });
  });
});

describe('montage : réécriture, plafond de fonctions, fumée', () => {
  it('vercel.json réécrit /api/sante vers la fonction login (pas de 13e fonction)', () => {
    const conf = JSON.parse(lire('vercel.json')) as { rewrites: { source: string; destination: string }[] };
    expect(conf.rewrites).toContainEqual({ source: '/api/sante', destination: '/api/login?cible=sante' });
  });

  it('api/ n\'a pas de fichier sante.ts : la route est servie par login.ts, sous le plafond de 12 fonctions', () => {
    const fonctions: string[] = [];
    const parcourir = (dossier: string) => {
      for (const entree of readdirSync(join(racine, dossier), { withFileTypes: true })) {
        if (entree.isDirectory()) parcourir(`${dossier}/${entree.name}`);
        else if (/\.ts$/.test(entree.name) && !entree.name.startsWith('_')) fonctions.push(`${dossier}/${entree.name}`);
      }
    };
    parcourir('api');
    expect(fonctions).not.toContain('api/sante.ts');
    expect(fonctions.length).toBeLessThanOrEqual(12);
  });

  describe('.github/workflows/fumee.yml', () => {
    const wf = lire('.github/workflows/fumee.yml');
    const sansCommentaires = wf.split('\n').filter((ligne) => !ligne.trim().startsWith('#')).join('\n');

    it('appelle le workflow commun, épinglé par SHA, après un déploiement de production réussi ou à la main', () => {
      expect(wf).toMatch(/uses: MoKarade\/\.github\/\.github\/workflows\/fumee\.yml@[0-9a-f]{40} # v\d/);
      expect(wf).toContain('deployment_status:');
      expect(wf).toContain('workflow_dispatch:');
      expect(wf).toContain("github.event.deployment_status.state == 'success'");
      expect(wf).toContain("github.event.deployment_status.environment == 'Production'");
    });

    it('l\'adresse de production vient de la variable URL_PRODUCTION (le garde PII refuse le domaine) et son absence SAUTE le job', () => {
      expect(wf).toContain('url-base: ${{ vars.URL_PRODUCTION }}');
      expect(sansCommentaires).toContain("if: vars.URL_PRODUCTION != '' &&");
      expect(sansCommentaires).not.toMatch(/https?:\/\//);
    });

    it('sonde les routes qui existent vraiment : le summary du hub et l\'entrée de la connexion', () => {
      expect(wf).toContain('chemin-summary: /api/hub/summary');
      expect(wf).toContain('chemin-connexion: /api/login');
      expect(readFileSync(join(racine, 'api/hub/summary.ts'), 'utf8')).toContain('x-hub-token');
      expect(readFileSync(join(racine, 'api/login.ts'), 'utf8')).toContain('accounts.google.com');
    });

    it('le jeton vient du secret du dépôt, jamais écrit ; pas de secrets: inherit', () => {
      expect(wf).toContain('hub-token: ${{ secrets.HUB_TOKEN }}');
      expect(wf).toContain('HUB_DISPATCH_TOKEN: ${{ secrets.HUB_DISPATCH_TOKEN }}');
      expect(sansCommentaires).not.toMatch(/secrets:\s*inherit/);
      expect(sansCommentaires).not.toMatch(/hub-token:\s*[^$\s]/);
    });
  });
});
