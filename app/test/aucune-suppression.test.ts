/**
 * GARDE-FOU §2 PAR CONSTRUCTION — l'app ne doit exposer AUCUN chemin de suppression.
 * Ce test verrouille la SURFACE de code : si quelqu'un ajoute un DELETE HTTP, un `trashed: true`
 * ou un appel à l'endpoint de suppression Drive dans `src/`, il casse ici — et la revue doit
 * trancher en conscience (jamais par accident).
 *
 * UNIQUE exception (ADR-0014, révision ÉTROITE du §2 validée par Marc 2026-07-06) :
 * `src/corbeille.ts` — et lui seul — porte `trashed: true` (corbeille Drive d'un DOSSIER VIDE
 * validé au clic, récupérable 30 j). `DELETE` reste interdit PARTOUT, corbeille.ts inclus.
 * TRIPWIRE : la présence de cette exception et sa documentation sont vérifiées DANS LES DEUX
 * SENS — retirer l'un sans l'autre casse la CI (même patron que le tripwire oauthScopes ↔
 * CLAUDE.md du moteur).
 *
 * C28-138 : depuis la mise au modèle commun (CLAUDE.md racine réduit à 33 lignes), le texte des
 * garde-fous (dont l'ADR-0014) vit dans `docs/claude/01-principes.md` (§1) — plus dans le
 * CLAUDE.md racine, qui ne fait plus qu'y renvoyer. Ce test doit donc lire ce fichier, jamais la
 * racine : ancien piège, le contenu déménage, le test qui le vérifie doit déménager avec lui.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const FICHIER_EXCEPTION = join(ICI, '..', 'src', 'corbeille.ts');
const CLAUDE_MD = join(ICI, '..', '..', 'docs', 'claude', '01-principes.md');

function fichiersSources(dossier: string): string[] {
  const resultat: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) resultat.push(...fichiersSources(chemin));
    else if (/\.(ts|tsx)$/.test(nom)) resultat.push(chemin);
  }
  return resultat;
}

const MOTIF_CORBEILLE = /trashed['"`]?\s*:\s*true/;

const MOTIFS_INTERDITS: [string, RegExp][] = [
  ['méthode HTTP DELETE', /method:\s*['"`]DELETE['"`]/i],
  ['méthode HTTP non littérale (contournerait ce test)', /method:\s*[a-zA-Z_$]/],
  ['suppression de lignes Sheet (deleteDimension/deleteRange)', /delete(Dimension|Range)/],
  ['batchUpdate Sheets (peut supprimer des lignes)', /:batchUpdate/],
  ['effacement de plages Sheets (:clear / :batchClear)', /:(batchC|c)lear/],
  ['corbeille Drive v2 (/trash) ou vidage (emptyTrash)', /\/trash\b|emptyTrash/],
  ['suppression définitive Drive (files.delete)', /files\.delete/],
  ['annulation d’événement Calendar (status: cancelled = suppression douce)', /status['"`]?\s*:\s*['"`]cancelled/],
  ['vidage de liste Tasks (/clear)', /tasks[^\n]*\/clear\b/i],
  ['clé method entre guillemets (contournerait les motifs method:)', /['"`]method['"`]\s*:/],
  ['endpoint batch Google (DELETE embarquable en multipart)', /\/batch\b/],
  ['XMLHttpRequest (contournerait les motifs fetch)', /XMLHttpRequest/],
];

describe('surface de code sans suppression (§2)', () => {
  const sources = fichiersSources(join(ICI, '..', 'src'));

  it('couvre bien les sources de l’app', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const [libelle, motif] of MOTIFS_INTERDITS) {
    it(`aucun ${libelle} (corbeille.ts INCLUS)`, () => {
      for (const f of sources) {
        const contenu = readFileSync(f, 'utf8');
        expect(motif.test(contenu), `${libelle} trouvé dans ${f}`).toBe(false);
      }
    });
  }

  it('trashed: true — NULLE PART sauf src/corbeille.ts (exception chirurgicale ADR-0014)', () => {
    for (const f of sources) {
      if (f === FICHIER_EXCEPTION) continue;
      const contenu = readFileSync(f, 'utf8');
      expect(MOTIF_CORBEILLE.test(contenu), `trashed: true trouvé HORS corbeille.ts : ${f}`).toBe(false);
    }
  });
});

describe('TRIPWIRE ADR-0014 : corbeille.ts ⇔ docs/claude/01-principes.md §1 (cohérence des documents vivants)', () => {
  it('corbeille.ts existe et porte bien la capacité corbeille (sinon retirer l’exception des garde-fous)', () => {
    expect(existsSync(FICHIER_EXCEPTION), 'src/corbeille.ts absent — retirer l’exception ADR-0014 de docs/claude/01-principes.md ET resserrer ce test dans le MÊME commit').toBe(true);
    const contenu = readFileSync(FICHIER_EXCEPTION, 'utf8');
    expect(MOTIF_CORBEILLE.test(contenu), 'corbeille.ts ne porte plus trashed: true — resserrer ce test et les garde-fous ensemble').toBe(true);
  });

  it('docs/claude/01-principes.md §1 documente l’exception (ADR-0014, dossier vide, corbeille) — sinon retirer corbeille.ts', () => {
    const constitution = readFileSync(CLAUDE_MD, 'utf8');
    expect(constitution.includes('ADR-0014'), 'docs/claude/01-principes.md ne mentionne plus l’ADR-0014 alors que corbeille.ts existe').toBe(true);
    expect(/corbeille Drive/i.test(constitution)).toBe(true);
    expect(/DOSSIER\s*(devenu\s*)?VIDE/i.test(constitution)).toBe(true);
  });
});
