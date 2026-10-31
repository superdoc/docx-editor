import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VP = join(PUBLIC_ROOT, 'node_modules/.bin/vp');

function lintPaths(paths) {
  let output;
  try {
    output = execFileSync(VP, ['lint', '-f', 'json', ...paths], {
      cwd: PUBLIC_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    output = error.stdout;
  }
  return JSON.parse(output).diagnostics;
}

function lintDiagnostics(files) {
  const dir = mkdtempSync(join(PUBLIC_ROOT, 'packages/superdoc/src/__oxlint-plugin-test-'));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
    return lintPaths([relative(PUBLIC_ROOT, dir)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lint(files) {
  const hits = new Map();
  for (const { code, filename } of lintDiagnostics(files)) {
    const name = filename.split('/').at(-1);
    hits.set(name, [...(hits.get(name) ?? []), code]);
  }
  return hits;
}

const SUPPRESSES = {
  'line.js': '// @ts-ignore\nexport const a = 1;\n',
  'triple-slash.js': '/// @ts-ignore\nexport const a = 1;\n',
  'nocheck.js': '// @ts-nocheck\nexport const a = 1;\n',
  'jsdoc.js': '/** @ts-ignore */\nexport const a = 1;\n',
  'jsdoc-expect.js': '/** @ts-expect-error reason */\nexport const a = 1;\n',
  'block-last-line.js': '/* note\n * @ts-expect-error */\nexport const a = 1;\n',
  'block-last-line-cr.js': '/* note\r * @ts-expect-error */\nexport const a = 1;\n',
  'block-last-line-ls.js': '/* note  * @ts-expect-error */\nexport const a = 1;\n',
  'block-last-line-ps.js': '/* note  * @ts-expect-error */\nexport const a = 1;\n',
};

const NO_EFFECT = {
  'prose-line.js': '// see @ts-ignore in the docs\nexport const a = 1;\n',
  'prose-block.js': '/* we avoid @ts-ignore here */\nexport const a = 1;\n',
  'block-first-line.js': '/* @ts-ignore\n * note */\nexport const a = 1;\n',
  'block-first-line-cr.js': '/** @ts-ignore\r * note */\nexport const a = 1;\n',
  'block-first-line-ls.js': '/** @ts-ignore  * note */\nexport const a = 1;\n',
  'block-first-line-ps.js': '/** @ts-ignore  * note */\nexport const a = 1;\n',
  'jsdoc-middle-line.js': '/**\n * @ts-ignore\n * reason\n */\nexport const a = 1;\n',
  'block-nocheck.js': '/* @ts-nocheck */\nexport const a = 1;\n',
};

test('no-ts-comment-in-js flags exactly the comments TypeScript treats as suppressions', () => {
  const hits = lint({ ...SUPPRESSES, ...NO_EFFECT });
  for (const name of Object.keys(SUPPRESSES)) {
    assert.ok(hits.get(name)?.includes('superdoc(no-ts-comment-in-js)'), `${name} should be flagged`);
  }
  for (const name of Object.keys(NO_EFFECT)) {
    assert.ok(!hits.get(name)?.includes('superdoc(no-ts-comment-in-js)'), `${name} should pass`);
  }
});

test('no-local-object-guard flags a local guard and names the package helper', () => {
  const hits = lint({
    'guard.js': "export const isObj = (value) => typeof value === 'object' && value !== null;\n",
    'kind-check.js': "export const hasKind = (value) => typeof value === 'object' && value !== null && 'kind' in value;\n",
  });
  assert.deepEqual(hits.get('guard.js'), ['superdoc(no-local-object-guard)']);
  assert.equal(hits.get('kind-check.js'), undefined);
});

test('no-local-object-guard points at the TypeScript home of isPlainObject', () => {
  const diagnostics = lintDiagnostics({
    'guard.js': "export const isObj = (value) => typeof value === 'object' && value !== null;\n",
  });
  const guard = diagnostics.find(({ code }) => code === 'superdoc(no-local-object-guard)');
  assert.match(guard?.message ?? '', /'packages\/superdoc\/src\/helpers\/object-guards\.ts'/);
});

test('no-local-object-guard does not flag the isPlainObject home itself', () => {
  const diagnostics = lintPaths(['packages/superdoc/src/helpers/object-guards.ts']);
  assert.deepEqual(diagnostics, []);
});
