import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedComment } from '../oxlint/no-comments.mts';
import type { CommentFacts } from '../oxlint/no-comments.mts';

const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = join(PUBLIC_ROOT, 'scripts/oxlint/superdoc-plugin.mts');
const PUBLIC_TYPES = 'packages/superdoc/src/core/types/index.ts';
const PUBLIC_UI_TYPES = 'packages/superdoc/src/public/ui/types.ts';
const requireFromVitePlus = createRequire(
  createRequire(join(PUBLIC_ROOT, 'package.json')).resolve('vite-plus/package.json'),
);
const OXLINT = join(dirname(requireFromVitePlus.resolve('oxlint/package.json')), 'bin/oxlint');
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/;

interface Label {
  span: { offset: number; length: number };
}

interface Diagnostic {
  code: string;
  filename: string;
  labels: Label[];
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return typeof value === 'object' && value !== null && 'code' in value && 'filename' in value && 'labels' in value;
}

function runOxlint(cwd: string, paths: string[], plugin = PLUGIN): Diagnostic[] {
  writeFileSync(
    join(cwd, 'oxlintrc.json'),
    JSON.stringify({
      jsPlugins: [{ name: 'superdoc', specifier: plugin }],
      categories: { correctness: 'off' },
      rules: { 'superdoc/no-comments': 'warn' },
    }),
  );
  const output = execFileSync(process.execPath, [OXLINT, '-c', 'oxlintrc.json', '--format=json', ...paths], {
    cwd,
    encoding: 'utf8',
  });
  const parsed: unknown = JSON.parse(output);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('diagnostics' in parsed) ||
    !Array.isArray(parsed.diagnostics)
  ) {
    throw new Error(`Unexpected Oxlint output: ${output}`);
  }
  return parsed.diagnostics.filter(isDiagnostic);
}

function lintFiles(files: Record<string, string>): Map<string, number> {
  const dir = mkdtempSync(join(os.tmpdir(), 'oxlint-no-comments-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), source);
    }
    const lines = new Map<string, number>(Object.keys(files).map((name) => [name, 0]));
    for (const { code, filename, labels } of runOxlint(dir, Object.keys(files))) {
      assert.equal(code, 'superdoc(no-comments)');
      const [label] = labels;
      if (label === undefined) throw new Error(`No span for ${filename}`);
      const text = Buffer.from(files[filename] ?? '')
        .subarray(label.span.offset, label.span.offset + label.span.length)
        .toString('utf8');
      lines.set(filename, (lines.get(filename) ?? 0) + text.split(LINE_BREAK).length);
    }
    return lines;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function countLines(cases: readonly (readonly [string, string, number])[]): void {
  const files = Object.fromEntries(cases.map(([source, extension], index) => [`case-${index}.${extension}`, source]));
  const lines = lintFiles(files);
  cases.forEach(([source, extension, expected], index) => {
    assert.equal(lines.get(`case-${index}.${extension}`), expected, JSON.stringify(source));
  });
}

function lintInPublicLayout(file: string, sources: readonly string[]): number[] {
  const root = mkdtempSync(join(os.tmpdir(), 'oxlint-no-comments-public-'));
  try {
    mkdirSync(join(root, 'scripts/oxlint'), { recursive: true });
    for (const name of ['superdoc-plugin.mts', 'no-comments.mts']) {
      copyFileSync(join(PUBLIC_ROOT, 'scripts/oxlint', name), join(root, 'scripts/oxlint', name));
    }
    symlinkSync(join(PUBLIC_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
    mkdirSync(dirname(join(root, file)), { recursive: true });
    return sources.map((source) => {
      writeFileSync(join(root, file), source);
      return runOxlint(root, [file], join(root, 'scripts/oxlint/superdoc-plugin.mts')).length;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const facts = (text: string, overrides: Partial<CommentFacts> = {}): CommentFacts => ({
  text,
  standalone: true,
  documentsDeclaration: false,
  inPublicTypeSurface: false,
  ...overrides,
});

test('isAllowedComment rejects ordinary line, block, and doc comments', () => {
  assert.equal(isAllowedComment(facts('// real')), false);
  assert.equal(isAllowedComment(facts('/* real */')), false);
  assert.equal(isAllowedComment(facts('/** doc */')), false);
  assert.equal(isAllowedComment(facts('/** doc */', { documentsDeclaration: true })), false);
});

test('isAllowedComment allows tool directives', () => {
  for (const text of [
    '/// <reference types="vite/client" />',
    '// @vitest-environment jsdom',
    '// @ts-expect-error untyped fixture',
    '/*#__PURE__*/',
    '/* @__PURE__ */',
    '/* @__NO_SIDE_EFFECTS__ */',
    '// eslint-disable-next-line no-console',
    '// oxlint-disable-next-line no-console',
    '/* @vite-ignore */',
    '/* webpackChunkName: "a" */',
    '/** @jsxImportSource preact */',
    '// prettier-ignore',
    '// @ts-ignore',
    '/* eslint-disable */',
  ]) {
    assert.equal(isAllowedComment(facts(text, { standalone: false })), true, text);
  }
});

test('isAllowedComment rejects a disable directive aimed at this rule', () => {
  for (const text of [
    '// oxlint-disable-next-line superdoc/no-comments',
    '// eslint-disable-next-line superdoc/no-comments',
    '/* oxlint-disable superdoc/no-comments */',
    '// oxlint-disable-line no-console, superdoc/no-comments',
  ]) {
    assert.equal(isAllowedComment(facts(text)), false, text);
  }
});

test('isAllowedComment allows a standalone SD ticket line and nothing near it', () => {
  assert.equal(isAllowedComment(facts('// SD-1234: Word drops empty runs here, so we keep one.')), true);
  assert.equal(
    isAllowedComment(facts('// SD-1234: Word drops empty runs here, so we keep one.', { standalone: false })),
    false,
  );
  for (const text of [
    '/* SD-1234: Word drops empty runs here. */',
    '/** SD-1234: Word drops empty runs here. */',
    '// SD-1234',
    '// SD-1234:',
    '// (SD-1234): Word drops empty runs here.',
    '// See SD-1234: Word drops empty runs here.',
    '// LIN-1234: Word drops empty runs here.',
    '// Word drops empty runs here.',
  ]) {
    assert.equal(isAllowedComment(facts(text)), false, text);
  }
});

test('isAllowedComment allows JSDoc on a declaration only in a public type surface', () => {
  assert.equal(
    isAllowedComment(facts('/** The config. */', { documentsDeclaration: true, inPublicTypeSurface: true })),
    true,
  );
  assert.equal(
    isAllowedComment(facts('/**\n * Multi-line.\n */', { documentsDeclaration: true, inPublicTypeSurface: true })),
    true,
  );
  assert.equal(
    isAllowedComment(facts('/** The config. */', { documentsDeclaration: false, inPublicTypeSurface: true })),
    false,
  );
  assert.equal(
    isAllowedComment(facts('/** The config. */', { documentsDeclaration: true, inPublicTypeSurface: false })),
    false,
  );
  assert.equal(
    isAllowedComment(facts('/* folded */', { documentsDeclaration: true, inPublicTypeSurface: true })),
    false,
  );
  assert.equal(isAllowedComment(facts('// folded', { documentsDeclaration: true, inPublicTypeSurface: true })), false);
  assert.equal(isAllowedComment(facts('/**/', { documentsDeclaration: true, inPublicTypeSurface: true })), false);
});

test('reports line, block, and doc comments in every supported language', () => {
  countLines([
    ['const u = "http://x"; // real', 'ts', 1],
    ['if (a) { b(); } // real\nconst o = { k: 1 }; /* real */', 'js', 2],
    ['type T = { a: string; /** doc */ b: number };', 'ts', 1],
    ['function f(a /* p */, b) { return a; }', 'cjs', 1],
    ['const a = [1, /* x */ 2, // y\n 3];', 'mjs', 2],
    ['const a = 1;\n// trailing at EOF\n', 'ts', 1],
    ['const el = <div>{/* real */}</div>;', 'tsx', 1],
    ['<template><div/></template>\n<script setup lang="ts">\n// s\nconst x = 1;\n</script>', 'vue', 1],
    ['<script setup lang="ts">\nconst identity = <T>(value: T) => value;\n// real\n</script>', 'vue', 1],
    [
      '<template><div /></template>\n<script>const a = 1;</script>\n<script setup lang="ts">// s\nconst b = 2;</script>',
      'vue',
      1,
    ],
  ]);
});

test('ignores comment-like text that is not a comment, and the shebang', () => {
  countLines([
    ['const s = `x ${a} y // no ${`in ${b} /* no */`} z`;', 'ts', 0],
    ['const r = /\\/\\/not/g; const s = "/* no */";', 'js', 0],
    ['const el = <div>// text http://x</div>;', 'jsx', 0],
    ['#!/usr/bin/env node\nconst a = 1;', 'mjs', 0],
    ['#!/usr/bin/env node\n// SD-1234: Word drops empty runs here.\nconst a = 1;', 'mjs', 0],
    ['<script setup>const s = "<!-- not a comment -->";</script>', 'vue', 0],
  ]);
});

test('allows tool directives', () => {
  countLines([
    [
      [
        '/// <reference types="vite/client" />',
        '// @vitest-environment jsdom',
        '// @ts-expect-error untyped fixture',
        'const a = /*#__PURE__*/ f();',
        '// eslint-disable-next-line no-console',
        '// oxlint-disable-next-line no-console',
        'import(/* @vite-ignore */ path);',
        '// prettier-ignore',
        'x();',
      ].join('\n'),
      'ts',
      0,
    ],
  ]);
});

test('allows a one-line SD ticket reference with its reason', () => {
  countLines([
    ['// SD-1234: Word drops empty runs here, so we keep one.\nkeepEmptyRun();', 'ts', 0],
    ['keepEmptyRun(); // SD-1234: Word drops empty runs here, so we keep one.', 'ts', 0],
    [
      'function f() {\n  if (a) {\n    // SD-1234: Word drops empty runs here, so we keep one.\n    keepEmptyRun();\n  }\n}',
      'ts',
      0,
    ],
    ['function f() {\r\n\t// SD-1234: Word drops empty runs here, so we keep one.\r\n\tkeepEmptyRun();\r\n}', 'ts', 0],
    ['<script setup lang="ts">\n// SD-1234: Word drops empty runs here.\nconst x = 1;\n</script>', 'vue', 0],
  ]);
});

test('reports ticket comments that are not a single SD reference line', () => {
  countLines([
    ['// SD-1234: Word drops empty runs here,\n// so we keep one.\nx();', 'ts', 2],
    ['/* SD-1234: Word drops empty runs here. */ x();', 'ts', 1],
    ['/** SD-1234: Word drops empty runs here. */\nfunction x() {}', 'ts', 1],
    ['// SD-1234\nx();', 'ts', 1],
    ['// SD-1234:\nx();', 'ts', 1],
    ['// (SD-1234): Word drops empty runs here.\nx();', 'ts', 1],
    ['// See SD-1234: Word drops empty runs here.\nx();', 'ts', 1],
    ['// LIN-1234: Word drops empty runs here.\nx();', 'ts', 1],
    ['// Word drops empty runs here.\nx();', 'ts', 1],
  ]);
});

test('each diagnostic spans every line of its comment', () => {
  countLines([
    ['/*\n one\n two\n*/\nx();', 'ts', 4],
    ['/* one\n two\n three */\nx();', 'ts', 3],
    ['/**\n * one\n * two\n */\nfunction x() {}', 'ts', 4],
    ['/* one line */ x();', 'ts', 1],
    ['// one\n// two\n// three\nx();', 'ts', 3],
    ['/* one\r\n two */\nx();', 'ts', 2],
    ['/* one\r two */\nx();', 'ts', 2],
    ['/* one\u2028 two */\nx();', 'ts', 2],
    ['/* one\u2029 two */\nx();', 'ts', 2],
    ['<script setup>\n/* one\n two */\nconst a = 1;\n</script>', 'vue', 2],
  ]);
});

test('a ticket line is free only when no other comment touches it', () => {
  countLines([
    ['// SD-1234: Word drops empty runs here.\nx();', 'ts', 0],
    ['x(); // SD-1234: Word drops empty runs here.\ny();', 'ts', 0],
    ['// SD-1234: Word drops empty runs here.\n// SD-5678: And here.\nx();', 'ts', 2],
    ['// Word drops empty runs here.\n// SD-1234: So we keep one.\nx();', 'ts', 2],
    ['// SD-1234: Word drops empty runs here.\n// So we keep one.\nx();', 'ts', 2],
    ['// Before.\n// SD-1234: Word drops empty runs here.\n// After.\nx();', 'ts', 3],
    ['// Word drops empty runs here.\n\n// SD-1234: So we keep one.\nx();', 'ts', 1],
    ['// SD-1234: Word drops empty runs here.\n\n// So we keep one.\nx();', 'ts', 1],
    ['// @ts-expect-error untyped fixture\n// SD-1234: Word drops empty runs here.\nx();', 'ts', 1],
    ['/* why */ // SD-1234: Word drops empty runs here.\nx();', 'ts', 2],
  ]);
});

test('each Vue script block judges ticket adjacency on its own', () => {
  countLines([
    [
      '<script>\n// SD-1234: One reason.\nconst a = 1;\n</script>\n<script setup>\n// SD-5678: Another reason.\nconst b = 2;\n</script>',
      'vue',
      0,
    ],
    ['<script setup>\n// SD-1234: One reason.\n// SD-5678: Another reason.\nconst a = 1;\n</script>', 'vue', 2],
  ]);
});

test('suppression directives are not reported, as the ratchet counts them separately', () => {
  countLines([
    ['// @ts-ignore\nx();', 'ts', 0],
    ['/* @ts-ignore */ x();', 'mjs', 0],
    ['// @ts-nocheck\nx();', 'js', 0],
    ['// eslint-disable-next-line no-console\nx();', 'tsx', 0],
    ['// oxlint-disable-line no-console\nx();', 'cjs', 0],
    ['<script setup lang="ts">\n// @ts-ignore\nconst x: number = "a";\n</script>', 'vue', 0],
  ]);
});

test('a disable directive for superdoc/no-comments is reported, so it is no escape hatch', () => {
  countLines([
    ['// oxlint-disable-next-line superdoc/no-comments\n// hidden\nx();', 'ts', 1],
    ['// eslint-disable-next-line superdoc/no-comments\n// hidden\nx();', 'ts', 1],
  ]);
});

const DOCUMENTED_TYPES = [
  '/** The editor config. */',
  'export interface Config {',
  '  /**',
  '   * Called when the editor is ready.',
  '   */',
  '  onReady?: () => void;',
  '  /** Look up a value. */',
  '  get(key: string): string;',
  '  /** Any extra field. */',
  '  [key: string]: unknown;',
  '}',
  '/** A document id. */',
  'export type DocumentId = string;',
  '/** An internal shape. */',
  'interface Internal {}',
].join('\n');

test('JSDoc on a type declaration or member is free in a public type surface', () => {
  assert.deepEqual(lintInPublicLayout(PUBLIC_TYPES, [DOCUMENTED_TYPES]), [0]);
  assert.deepEqual(lintInPublicLayout(PUBLIC_UI_TYPES, [DOCUMENTED_TYPES]), [0]);
});

test('line and block comments still count in a public type surface, and so does JSDoc off a declaration', () => {
  const cases = [
    'export interface Config {\n  // folded rationale\n  a?: string;\n}',
    'export interface Config {\n  /* folded rationale */\n  a?: string;\n}',
    'export interface Config {\n  a?: string; /** trailing */\n}',
    '/** folded rationale */\n/** The config. */\nexport interface Config {}',
    '// section\n/** The config. */\nexport interface Config {}',
    'export interface Config {\n  a?: string;\n  /** dangling */\n}',
    '/** not a type */\nexport const value = 1;',
    'export type { A } from "./a";\n/** re-export note */\nexport type { B } from "./b";',
  ];
  assert.deepEqual(lintInPublicLayout(PUBLIC_TYPES, cases), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test('JSDoc outside the public type surfaces still counts', () => {
  const source =
    '/** The config. */\nexport interface Config {\n  /** Called when ready. */\n  onReady?: () => void;\n}';
  for (const file of ['a.ts', 'packages/superdoc/src/core/types/other.ts', 'packages/superdoc/src/core/SuperDoc.ts']) {
    assert.deepEqual(lintInPublicLayout(file, [source]), [2], file);
  }
});
