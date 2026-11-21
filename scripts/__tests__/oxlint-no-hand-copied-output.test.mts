import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPIED_MESSAGE } from '../oxlint/no-hand-copied-output.mts';

const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VP = join(PUBLIC_ROOT, 'node_modules/.bin/vp');
const HEADER = "import { expect } from 'vite-plus/test';\n";
const COPIED = "expect('x').toBe('one\\ntwo\\nthree\\nfour\\n');\n";

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
  'source-file.ts': COPIED,
};

const REJECTED: Record<string, string> = {
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

function flagged(files: Record<string, string>): string[] {
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
      .filter(({ message }) => message === COPIED_MESSAGE)
      .map(({ filename }) => filename.split('/').at(-1) ?? filename)
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('vp lint flags hand-written output of four or more lines in SuperDoc tests, and nothing else', () => {
  assert.deepEqual(flagged({ ...ALLOWED, ...REJECTED }), Object.keys(REJECTED).sort());
});
