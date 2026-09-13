import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const SRC_ROOT = join(__dirname, '..', '..');

// V2 branch invariant: the customer `superdoc` package consumes the internal v2
// runtime through the separate `@superdoc/docx-engine` package, but it must only be
// reached through three approved internal seams: the browser integration, the
// Node-only collaboration-upgrade facade, and the collaboration Worker facade.
// Every other source file in the package must not import any internal v2
// implementation package directly.
// The publish-artifact audit enforces the packed boundary. This map keeps each
// source seam explicit and auditable.
const APPROVED_SEAMS = new Map([
  ['core/v2-integration/v2-integration.js', '@superdoc/docx-engine'],
  ['public/collaboration-upgrade-engine.ts', '@superdoc/docx-engine/collaboration-upgrade-engine'],
  ['public/collaboration-worker.ts', '@superdoc/docx-engine/collaboration-worker'],
]);

const FORBIDDEN_IMPORT_FRAGMENTS = [
  '@superdoc/v2-browser-shell',
  '@superdoc/v2-host',
  '@superdoc/headless',
  '@superdoc/collaboration-v2',
  '@superdoc/editor-core',
  '@superdoc/document-api-v2-adapter',
  '@superdoc/style-model',
  '@superdoc/v2-layout-adapter',
  '@superdoc/docx-engine/',
  '@superdoc/v2/',
];

function* walkSourceFiles(dir: string): IterableIterator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkSourceFiles(full);
      continue;
    }
    if (!/\.(js|ts|vue|jsx|tsx)$/.test(full)) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(full)) continue;
    yield full;
  }
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const fromRe = /\b(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g;
  const bareRe = /\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
  for (const re of [fromRe, bareRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe('public v2 import boundary', () => {
  it('only approved public facades may import the DOCX Engine runtime', () => {
    const offenders: { file: string; spec: string; fragment: string }[] = [];
    for (const file of walkSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split(sep).join('/');
      const source = readFileSync(file, 'utf8');
      for (const spec of importSpecifiers(source)) {
        for (const fragment of FORBIDDEN_IMPORT_FRAGMENTS) {
          if (!spec.includes(fragment)) continue;
          if (APPROVED_SEAMS.get(rel) === spec) continue;
          offenders.push({ file: rel, spec, fragment });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('each approved facade imports exactly its allowed engine entrypoint', () => {
    for (const [file, specifier] of APPROVED_SEAMS) {
      const seam = readFileSync(join(SRC_ROOT, file), 'utf8');
      expect(importSpecifiers(seam)).toContain(specifier);
    }
  });

  it('self-test: scanner flags a forbidden v2 implementation import outside the seam', () => {
    const synthetic = `import { x } from '@superdoc/v2-host';\nimport y from './ok.js';`;
    const hits = importSpecifiers(synthetic).filter((spec) => FORBIDDEN_IMPORT_FRAGMENTS.some((f) => spec.includes(f)));
    expect(hits).toEqual(['@superdoc/v2-host']);
  });

  it('self-test: scanner allows a neutral local module specifier', () => {
    const synthetic = `import { createDefaultV2Integration } from './core/v2-integration/v2-integration.js';`;
    const hits = importSpecifiers(synthetic).filter((spec) => FORBIDDEN_IMPORT_FRAGMENTS.some((f) => spec.includes(f)));
    expect(hits).toEqual([]);
  });
});
