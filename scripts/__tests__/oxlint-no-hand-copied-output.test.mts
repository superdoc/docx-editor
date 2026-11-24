import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPIED_MESSAGE, COPIED_PIECE_LENGTH, PIECES_MESSAGE } from '../oxlint/no-hand-copied-output.mts';
import { SOURCE_TEXT_MESSAGE } from '../oxlint/no-source-text-assertions.mts';

const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VP = join(PUBLIC_ROOT, 'node_modules/.bin/vp');
const HEADER = "import { expect } from 'vite-plus/test';\n";
const COPIED = "expect('x').toBe('one\\ntwo\\nthree\\nfour\\n');\n";
const FOUR_LINES = "'one\\ntwo\\nthree\\nfour\\n'";

const ALLOWED: Record<string, string> = {
  'one-line.test.ts': "expect('x').toBe('one line');\n",
  'three-lines.test.ts': "expect('x').toContain('first\\nsecond\\nthird\\n');\n",
  'three-joined.test.ts': "expect('x').toBe(['a', 'b', 'c'].join('\\n'));\n",
  'trailing-empty-entry.test.ts': "expect('x').toBe(['one', 'two', 'three', ''].join('\\n'));\n",
  'dynamic-entry.test.ts':
    "declare const middle: string;\nexpect('x').toBe(['one', middle, 'three', ''].join('\\n'));\n",
  'not-an-assertion.test.ts':
    "declare const fixture: { toContain(text: string): void };\nfixture.toContain('one\\ntwo\\nthree\\nfour\\n');\n",
  'array-value.test.ts': "expect(['a', 'b', 'c', 'd']).toEqual(['a', 'b', 'c', 'd']);\n",
  'only-values.test.ts':
    'declare const a: string, b: string, c: string, d: string;\nexpect(a).toBe(`${a}\\n${b}\\n${c}\\n${d}`);\n',
  'template-value-line.test.ts': "declare const middle: string;\nexpect('x').toBe(`one\\n${middle}\\nthree\\nfour`);\n",
  'joined-value-line.test.ts':
    "declare const middle: string;\nexpect('x').toBe(['one', middle, 'three', 'four'].join('\\n'));\n",
  'interpolated-separator.test.ts':
    "declare const indent: string;\nexpect('x').toBe(['one', 'two', 'three'].join(`\\n${indent}\\n`));\n",
  'implicit-separator.test.ts':
    "declare const first: string, last: string;\nexpect('x').toBe(['Names:', [first, last].join(), 'Status:', 'Ready'].join('\\n'));\n",
  'null-join-entry.test.ts': "expect('x').toBe(['one', null, 'three', 'four'].join('\\n'));\n",
  'spread-join-entry.test.ts':
    "declare const rows: string[];\nexpect('x').toBe(['one', 'two\\nthree', ...rows].join('\\n- '));\n",
  'recorded.test.ts': "await expect('x').toMatchFileSnapshot('__snapshots__/x.txt');\n",
  'assert-one-line.test.ts': "import assert from 'node:assert';\nassert.equal('x', 'one line');\n",
  'assert-three-lines.test.ts':
    "import assert from 'node:assert/strict';\nassert.equal('x', 'one\\ntwo\\nthree\\n');\n",
  'assert-not-equal.test.ts': `import assert from 'node:assert/strict';\nassert.notEqual('x', ${FOUR_LINES});\n`,
  'assert-not-deep-equal.test.ts': `import { notDeepEqual } from 'node:assert';\nnotDeepEqual('x', ${FOUR_LINES});\n`,
  'assert-match.test.ts': "import assert from 'node:assert/strict';\nassert.match('x', /one\\ntwo\\nthree\\nfour/);\n",
  'assert-actual-only.test.ts': `import assert from 'node:assert/strict';\nassert.equal(${FOUR_LINES}, 'x');\n`,
  'assert-message.test.ts': `import assert from 'node:assert/strict';\nassert.equal('x', 'x', ${FOUR_LINES});\n`,
  'assert-local-helper.test.ts': `const assert = { equal(actual: string, expected: string) {} };\nassert.equal('x', ${FOUR_LINES});\n`,
  'assert-shadowed-module.test.ts': `import assert from 'node:assert/strict';\nfunction check(assert: { equal(a: string, b: string): void }) {\n  assert.equal('x', ${FOUR_LINES});\n}\n`,
  'assert-shadowed-named.test.ts': `import { equal } from 'node:assert/strict';\nfunction check(equal: (a: string, b: string) => void) {\n  equal('x', ${FOUR_LINES});\n}\n`,
  'assert-shadowed-local.test.ts': `import assert from 'node:assert';\n{\n  const assert = { strictEqual(a: string, b: string) {} };\n  assert.strictEqual('x', ${FOUR_LINES});\n}\n`,
  'assert-unrelated-property.test.ts': `declare const fixture: { assert: { equal(a: string, b: string): void } };\nfixture.assert.equal('sample', ${FOUR_LINES});\n`,
  'assert-unrelated-callback.test.ts': `import { test } from 'node:test';\ndeclare function build(run: (t: { assert: { equal(a: string, b: string): void } }) => void): void;\nbuild((t) => {\n  t.assert.equal('x', ${FOUR_LINES});\n});\n`,
  'assert-other-module.test.ts': `const check = require('node:test');\ncheck.equal('x', ${FOUR_LINES});\n`,
  'source-file.ts': COPIED,
};

const REJECTED: Record<string, string> = {
  'assert-default.test.ts': `import assert from 'node:assert';\nassert.equal('x', ${FOUR_LINES});\n`,
  'assert-bare-module.test.ts': `import assert from 'assert';\nassert.deepEqual('x', ${FOUR_LINES});\n`,
  'assert-strict-module.test.ts': `import assert from 'node:assert/strict';\nassert.strictEqual('x', ${FOUR_LINES});\n`,
  'assert-bare-strict-module.test.ts': `import assert from 'assert/strict';\nassert.deepStrictEqual('x', ${FOUR_LINES});\n`,
  'assert-named.test.ts': `import { equal } from 'node:assert/strict';\nequal('x', ${FOUR_LINES});\n`,
  'assert-renamed.test.ts': `import { deepStrictEqual as same } from 'node:assert';\nsame('x', ${FOUR_LINES});\n`,
  'assert-strict-named.test.ts': `import { strict as check } from 'node:assert';\ncheck.deepEqual('x', ${FOUR_LINES});\n`,
  'assert-namespace.test.ts': `import * as check from 'node:assert';\ncheck.strictEqual('x', ${FOUR_LINES});\n`,
  'assert-required.test.ts': `const assert = require('node:assert/strict');\nassert.equal('x', ${FOUR_LINES});\n`,
  'assert-required-named.test.ts': `const { deepEqual } = require('assert');\ndeepEqual('x', ${FOUR_LINES});\n`,
  'assert-strict-property.test.ts': `import assert from 'node:assert';\nassert.strict.equal('x', ${FOUR_LINES});\n`,
  'assert-test-context.test.ts': `import { test } from 'node:test';\ntest('x', (t) => {\n  t.assert.deepStrictEqual('x', ${FOUR_LINES});\n});\n`,
  'assert-nested-call.test.ts': `import assert from 'node:assert/strict';\nfunction check() {\n  assert.equal('x', ${FOUR_LINES});\n}\n`,
  'assert-subtest-context.test.ts': `import test from 'node:test';\ntest('x', async (t) => {\n  await t.test('y', (u) => {\n    u.assert.equal('x', ${FOUR_LINES});\n  });\n});\n`,
  'assert-test-options.test.ts': `import { it } from 'node:test';\nit('x', { timeout: 1 }, (t) => {\n  t.assert.strictEqual('x', ${FOUR_LINES});\n});\n`,
  'assert-joined.test.ts':
    "import assert from 'node:assert/strict';\nassert.equal('x', ['a', 'b', 'c', 'd'].join('\\n'));\n",
  'inline-spread-join.test.ts': "expect('x').toBe(['one', 'two\\nthree', ...['four']].join('\\n- '));\n",
  'string.test.ts': COPIED,
  'joined.test.ts': "expect('x').toContain(['a', 'b', 'c', 'd'].join('\\n'));\n",
  'joined-with-newlines.test.ts': "expect('x').toBe(['one\\ntwo', 'three\\nfour'].join('\\n'));\n",
  'template.test.ts': "expect('x').toEqual(`one\ntwo\nthree\nfour`);\n",
  'negated.test.ts': "expect('x').not.toBe('one\\ntwo\\nthree\\nfour\\n');\n",
  'soft.test.ts': "expect.soft('x').toEqual('one\\ntwo\\nthree\\nfour\\n');\n",
  'resolved.test.ts': "await expect(Promise.resolve('x')).resolves.toBe('one\\ntwo\\nthree\\nfour\\n');\n",
  'template-with-value.test.ts': "expect('x').toStrictEqual(`one\n${'two'}\nthree\nfour`);\n",
  'concatenated.test.ts': "expect('x').toBe('one\\n' + 'two\\n' + 'three\\n' + 'four\\n');\n",
  'interpolated-entry.test.ts':
    "declare const name: string;\nexpect('x').toBe([`one\\ntwo ${name}`, 'three', 'four'].join('\\n'));\n",
  'written-nul.test.ts': "expect('x').toBe('one\\ntwo\\nthree\\n\\0');\n",
  'template-with-number.test.ts': "expect('x').toBe(`one\\n${42}\\nthree\\nfour`);\n",
};

interface Diagnostic {
  code?: string;
  message: string;
  filename: string;
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return typeof value === 'object' && value !== null && 'message' in value && 'filename' in value;
}

function flagged(files: Record<string, string>, message = COPIED_MESSAGE): string[] {
  const dir = mkdtempSync(join(PUBLIC_ROOT, 'packages/superdoc/src/__oxlint-hand-copied-test-'));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), `${HEADER}${source}`);
    let output: string;
    try {
      output = execFileSync(VP, ['lint', '-f', 'json', relative(PUBLIC_ROOT, dir)], {
        cwd: PUBLIC_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      if (!(error instanceof Error) || !('stdout' in error) || typeof error.stdout !== 'string') throw error;
      output = error.stdout;
    }
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== 'object' || parsed === null || !('diagnostics' in parsed)) {
      throw new Error(`Unexpected Oxlint output: ${output}`);
    }
    const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics.filter(isDiagnostic) : [];
    return diagnostics
      .filter((diagnostic) => diagnostic.message === message)
      .map(({ filename }) => filename.split('/').at(-1) ?? filename)
      .filter((name, index, names) => names.indexOf(name) === index)
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('vp lint flags hand-written output of four or more lines in SuperDoc tests, and nothing else', () => {
  assert.deepEqual(flagged({ ...ALLOWED, ...REJECTED }), Object.keys(REJECTED).sort());
});

const PIECE = `'${'p'.repeat(COPIED_PIECE_LENGTH)}'`;
const SHORT = `'${'s'.repeat(COPIED_PIECE_LENGTH - 1)}'`;
const pieces = (count: number, subject = 'css', piece = PIECE) =>
  `declare const ${subject}: string;\n${Array.from({ length: count }, () => `expect(${subject}).toContain(${piece});\n`).join('')}`;

const WHOLE_PIECES: Record<string, string> = {
  'three-pieces.test.ts': pieces(3),
  'short-pieces.test.ts': pieces(4, 'css', SHORT),
  'value-pieces.test.ts': pieces(4, 'css', 'css'),
  'negated-pieces.test.ts': `declare const css: string;\n${Array.from({ length: 4 }, () => `expect(css).not.toContain(${PIECE});\n`).join('')}`,
  'other-subjects.test.ts': `declare const a: string, b: string;\n${pieces(2, 'a').split('\n').slice(1).join('\n')}${pieces(2, 'b').split('\n').slice(1).join('\n')}`,
  'call-subjects.test.ts': `declare const tokens: Iterator<string>;\n${Array.from({ length: 4 }, () => `expect(tokens.next().value).toContain(${PIECE});\n`).join('')}`,
  'interrupted.test.ts': `declare const css: string;\n${pieces(2).split('\n').slice(1).join('\n')}expect(css).toContain('short');\n${pieces(2).split('\n').slice(1).join('\n')}`,
};

const COPIED_PIECES_CASES: Record<string, string> = {
  'four-pieces.test.ts': pieces(4),
  'soft-pieces.test.ts': `declare const css: string;\n${Array.from({ length: 4 }, () => `expect.soft(css).toContain(${PIECE});\n`).join('')}`,
  'member-subject.test.ts': `declare const style: { textContent: string };\n${Array.from({ length: 4 }, () => `expect(style.textContent).toContain(${PIECE});\n`).join('')}`,
  'nested-block.test.ts': `test('x', () => {\n${pieces(5)}});\n`,
};

test('vp lint flags four or more consecutive long toContain pieces of one value, and nothing else', () => {
  assert.deepEqual(
    flagged({ ...WHOLE_PIECES, ...COPIED_PIECES_CASES }, PIECES_MESSAGE),
    Object.keys(COPIED_PIECES_CASES).sort(),
  );
});

const SOURCE_IMPORTS = [
  "import assert from 'node:assert/strict';",
  "import { promises as fs, mkdtempSync, readFileSync } from 'node:fs';",
  "import { tmpdir } from 'node:os';",
  "import path from 'node:path';",
  "import { beforeAll, test } from 'vite-plus/test';",
  '',
].join('\n');
const READ = "const source = readFileSync(new URL('./editor.ts', import.meta.url), 'utf8');\n";

const SOURCE_ALLOWED: Record<string, string> = {
  'source-negated.test.ts': `${READ}expect(source).not.toContain('innerHTML');\nexpect(source).not.toMatch(/cloneNode\\(/);\n`,
  'source-assert-negated.test.ts': `${READ}assert.doesNotMatch(source, /innerHTML/);\nassert.ok(!source.includes('innerHTML'));\n`,
  'source-includes-false.test.ts': `${READ}expect(source.includes('innerHTML')).toBe(false);\n`,
  'source-not-text.test.ts': `${READ}expect(source.length).toBeGreaterThan(0);\n`,
  'temporary-output.test.ts':
    "const dir = mkdtempSync(path.join(tmpdir(), 'build-'));\nconst output = readFileSync(path.join(dir, 'index.js'), 'utf8');\nexpect(output).toContain('export');\n",
  'data-file.test.ts':
    "const data = readFileSync(new URL('./fixture.json', import.meta.url), 'utf8');\nexpect(data).toContain('name');\n",
  'markdown-file.test.ts':
    "const guide = readFileSync(new URL('./README.md', import.meta.url), 'utf8');\nassert.match(guide, /## Usage/);\n",
  'copied-to-fixture.test.ts': [
    'async function fixture() {',
    "  const root = mkdtempSync(path.join(tmpdir(), 'copy-'));",
    "  await fs.writeFile(path.join(root, 'tool.mjs'), await fs.readFile(new URL('./tool.mjs', import.meta.url)));",
    '  return { run: () => ({ stdout: root }) };',
    '}',
    'const { run } = await fixture();',
    'assert.match(run().stdout, /copy-/);',
    '',
  ].join('\n'),
  'literal-subject.test.ts': "expect('editor.ts').toContain('editor');\n",
  'output-ends-with-source.test.ts': `declare function wrap(text: string): string;\n${READ}assert.ok(wrap(source).endsWith(source));\n`,
  'overwritten-source.test.ts': [
    'declare function compile(text: string): string;',
    "let text = readFileSync(new URL('./editor.ts', import.meta.url), 'utf8');",
    'text = compile(text);',
    'assert.match(text, /expected output/);',
    '',
  ].join('\n'),
  'built-bundle.test.ts': [
    'const ROOT = path.dirname(new URL(import.meta.url).pathname);',
    "const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(ROOT, 'dist');",
    "const bundle = readFileSync(path.join(OUT, 'document-host.js'), 'utf8');",
    'assert.match(bundle, /document-runtime/);',
    "const cdn = readFileSync(path.join(ROOT, 'dist-cdn/superdoc.js'), 'utf8');",
    "const app = readFileSync(__dirname + '/dist/app.js', 'utf8');",
    'assert.match(app, /createApp/);',
    "expect(cdn).toContain('export');",
    '',
  ].join('\n'),
  'transformed-source.test.ts': `declare function compile(text: string): { code: string };\n${READ}assert.match(compile(source).code, /export default/);\n`,
  'shadowed-reader.test.ts': [
    'const ROOT = path.dirname(new URL(import.meta.url).pathname);',
    "function readText(relative: string) { return readFileSync(path.join(ROOT, relative), 'utf8'); }",
    "expect(readText('editor.ts')).not.toContain('innerHTML');",
    'function check(dir: string) {',
    "  const readText = (name: string) => readFileSync(path.join(dir, name), 'utf8');",
    "  assert.match(readText('bundle.js'), /export/);",
    '}',
    "check(mkdtempSync(path.join(tmpdir(), 'out-')));",
    '',
  ].join('\n'),
};

const SOURCE_REJECTED: Record<string, string> = {
  'source-contain.test.ts': `${READ}expect(source).toContain('fragment.animate(');\n`,
  'source-match.test.ts': `${READ}expect(source).toMatch(/fragment\\.animate\\(/);\n`,
  'source-soft.test.ts': `${READ}expect.soft(source).toContain('fragment.animate(');\n`,
  'source-assert-match.test.ts': `${READ}assert.match(source, /fragment\\.animate\\(/);\n`,
  'source-regex-test.test.ts': `${READ}assert.ok(/fragment\\.animate\\(/.test(source));\n`,
  'source-assert-includes.test.ts': `${READ}assert.ok(source.includes('fragment.animate('));\n`,
  'source-includes-true.test.ts': `${READ}expect(source.includes('fragment.animate(')).toBe(true);\n`,
  'source-match-count.test.ts': `${READ}expect(source.match(/:stage="stage"/g)).toHaveLength(4);\n`,
  'source-slice.test.ts': `${READ}const section = source.slice(source.indexOf('function a'));\nassert.match(section, /return 1/);\n`,
  'source-reader.test.ts': [
    'const ROOT = path.dirname(new URL(import.meta.url).pathname);',
    'async function readSource(relative: string): Promise<string> {',
    "  return fs.readFile(path.resolve(ROOT, relative), 'utf8');",
    '}',
    "expect(await readSource('worker/main-mount.ts')).toContain('isReadOnly');",
    '',
  ].join('\n'),
  'source-cwd.test.ts':
    "const vue = readFileSync(path.resolve(process.cwd(), 'src/Editor.vue'), 'utf8');\nexpect(vue).toContain('outline: none');\n",
  'source-dirname.test.ts':
    "const script = readFileSync(path.join(__dirname, 'build.mjs'), 'utf8');\nassert.match(script, /stages\\.push/);\n",
  'source-raw-import.test.ts': "import raw from './Editor.vue?raw';\nexpect(raw).toContain('outline: none');\n",
  'source-assigned.test.ts': [
    "let source = '';",
    "beforeAll(() => { source = readFileSync(new URL('./editor.ts', import.meta.url), 'utf8'); });",
    "test('x', () => { expect(source).toContain('fragment.animate('); });",
    '',
  ].join('\n'),
  'source-hoisted.test.ts': `function check() { expect(source).toContain('fragment.animate('); }\n${READ}check();\n`,
  'source-path-alias.test.ts':
    "const file = new URL('./editor.ts', import.meta.url);\nconst text = readFileSync(file, 'utf8');\nexpect(text).toContain('fragment.animate(');\n",
  'source-returned-local.test.ts': [
    'function readEditor() {',
    "  const text = readFileSync(new URL('./editor.ts', import.meta.url), 'utf8');",
    '  return text;',
    '}',
    'assert.match(readEditor(), /fragment/);',
    '',
  ].join('\n'),
  'source-before-overwrite.test.ts': [
    'declare function compile(text: string): string;',
    "let text = readFileSync(new URL('./editor.ts', import.meta.url), 'utf8');",
    'assert.match(text, /fragment/);',
    'text = compile(text);',
    '',
  ].join('\n'),
  'source-trimmed.test.ts': `${READ.replace('const', 'let')}source = source.trim();\nexpect(source).toContain('fragment.animate(');\n`,
  'source-env-selected.test.ts': [
    "const production = process.env.NODE_ENV === 'production';",
    "const editor = readFileSync(new URL(production ? './editor.ts' : './editor-dev.ts', import.meta.url), 'utf8');",
    "expect(editor).toContain('fragment.animate(');",
    '',
  ].join('\n'),
  'source-for-of.test.ts': `${READ}for (const text of [source]) expect(text).toContain('fragment.animate(');\n`,
};

const withSourceImports = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([name, source]) => [name, `${SOURCE_IMPORTS}${source}`]));

test('vp lint flags positive assertions on repository source text, and leaves bans, outputs and data alone', () => {
  assert.deepEqual(
    flagged(withSourceImports({ ...SOURCE_ALLOWED, ...SOURCE_REJECTED }), SOURCE_TEXT_MESSAGE),
    Object.keys(SOURCE_REJECTED).sort(),
  );
});
