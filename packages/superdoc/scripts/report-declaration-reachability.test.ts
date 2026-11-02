import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson: { exports: Record<string, { types?: string | Record<string, string> }> } = JSON.parse(
  readFileSync(path.join(scriptsDir, '..', 'package.json'), 'utf8'),
);
const typesTargets = Object.values(packageJson.exports).flatMap(({ types }) =>
  typeof types === 'string' ? [types] : Object.values(types ?? {}),
);
const STORE = 'superdoc/src/stores/comments-store.d.ts';
const distRoots: string[] = [];

function seedDist(entry: string, files: Record<string, string> = {}) {
  const distRoot = mkdtempSync(path.join(tmpdir(), 'superdoc-reachability-test-'));
  distRoots.push(distRoot);
  const entries = Object.fromEntries(typesTargets.map((target) => [target.replace(/^\.\/dist\//, ''), 'export {};\n']));
  const all: Record<string, string> = {
    ...entries,
    'superdoc/src/public/index.d.ts': entry,
    'superdoc/src/helpers/util.d.ts': 'export type Util = string;\n',
    [STORE]: 'export type Store = number;\n',
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(distRoot, file)), { recursive: true });
    writeFileSync(path.join(distRoot, file), content);
  }
  return distRoot;
}

function run(distRoot: string) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, 'report-declaration-reachability.cjs')], {
    encoding: 'utf8',
    env: { ...process.env, SUPERDOC_PUBLIC_NPM_OUT_DIR: distRoot },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  for (const distRoot of distRoots.splice(0)) rmSync(distRoot, { recursive: true, force: true });
});

describe('report-declaration-reachability store gate', () => {
  it('passes when no store declaration is reachable', () => {
    const result = run(seedDist("export type { Util } from '../helpers/util.js';\n"));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('No declaration under superdoc/src/stores/ is reachable');
  });

  it('fails and names a store declaration a types entry imports', () => {
    const result = run(seedDist("export type { Store } from '../stores/comments-store.js';\n"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`  ${STORE}`);
  });

  it('fails when the store declaration is reachable only through another declaration', () => {
    const result = run(
      seedDist("export type { Util } from '../helpers/util.js';\n", {
        'superdoc/src/helpers/util.d.ts': "export type Util = import('../stores/comments-store.js').Store;\n",
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`  ${STORE}`);
  });
});
