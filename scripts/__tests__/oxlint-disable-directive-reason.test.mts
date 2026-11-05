import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directiveProblem } from '../oxlint/disable-directive-reason.mts';

const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VP = join(PUBLIC_ROOT, 'node_modules/.bin/vp');
const MISSING_REASON =
  'Disable named rules for the next line only, with a reason: `// oxlint-disable-next-line <rule> -- <reason>`.';

test('directiveProblem accepts a next-line disable that names rules and gives a reason', () => {
  for (const text of [
    '// oxlint-disable-next-line no-console -- the CLI prints its report',
    '// eslint-disable-next-line no-console -- the CLI prints its report',
    '// oxlint-disable-next-line no-console, no-debugger -- probe',
    '// oxlint-disable-next-line typescript/no-explicit-any -- untyped vendor payload',
    '// oxlint-disable-next-line @scope/plugin-rule -- reason',
    '/* oxlint-disable-next-line no-control-regex -- rejects binary input */',
    '// oxlint-disable-next-line no-console -- see superdoc/no-comments docs',
    '// oxlint-disable-next-line no-debugger -- fixture exercises superdoc/disable-directive-reason',
  ]) {
    assert.equal(directiveProblem(text), null, text);
  }
});

test('directiveProblem ignores comments that are not disable directives', () => {
  for (const text of [
    '// SD-1234: Word drops empty runs here, so we keep one.',
    '// @ts-expect-error untyped fixture',
    '// prettier-ignore',
    '/* we never use oxlint-disable here */',
    '// see eslint-disable-next-line in the docs',
  ]) {
    assert.equal(directiveProblem(text), null, text);
  }
});

test('directiveProblem rejects a directive without rules, a reason, or next-line scope', () => {
  for (const text of [
    '// oxlint-disable-next-line no-console',
    '// eslint-disable-next-line no-console',
    '// oxlint-disable-next-line',
    '// oxlint-disable-next-line -- reason',
    '// oxlint-disable-next-line no-console --',
    '// oxlint-disable-next-line no-console --   ',
    '// oxlint-disable-next-line no-console--reason',
    '// oxlint-disable-next-line no-console: reason',
    '//oxlint-disable-next-line no-console -- reason',
    '/// oxlint-disable-next-line no-console -- reason',
    '/** oxlint-disable-next-line no-console -- reason */',
    '/* oxlint-disable-next-line no-console -- */',
    '/* oxlint-disable-next-line no-console -- a\n b */',
    '// oxlint-disable-line no-console -- reason',
    '// eslint-disable-line no-console -- reason',
    '/* oxlint-disable */',
    '/* eslint-disable */',
    '/* oxlint-disable no-console -- reason */',
    '/* oxlint-enable no-console */',
    '// eslint-enable',
  ]) {
    assert.equal(directiveProblem(text), MISSING_REASON, text);
  }
});

test('directiveProblem rejects any directive that names a SuperDoc guardrail rule', () => {
  for (const [text, rule] of [
    ['// oxlint-disable-next-line superdoc/no-comments -- reason', 'superdoc/no-comments'],
    ['// eslint-disable-next-line superdoc/no-comments -- reason', 'superdoc/no-comments'],
    ['// oxlint-disable-next-line no-console, superdoc/no-comments -- reason', 'superdoc/no-comments'],
    ['// oxlint-disable-line superdoc/no-comments -- x', 'superdoc/no-comments'],
    ['/* oxlint-disable superdoc/no-comments */', 'superdoc/no-comments'],
    ['// oxlint-disable-next-line superdoc/disable-directive-reason -- x', 'superdoc/disable-directive-reason'],
    ['/* eslint-disable superdoc/disable-directive-reason */', 'superdoc/disable-directive-reason'],
    ['/* oxlint-disable superdoc/no-comments*/', 'superdoc/no-comments'],
    ['// oxlint-disable-next-line superdoc/no-comments,no-console -- reason', 'superdoc/no-comments'],
  ]) {
    assert.equal(directiveProblem(text), `Do not disable ${rule}. Change the code instead.`, text);
  }
});

interface Diagnostic {
  code?: string;
  message: string;
  filename: string;
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return typeof value === 'object' && value !== null && 'message' in value && 'filename' in value;
}

function lint(files: Record<string, string>): { status: number; problems: string[] } {
  const dir = mkdtempSync(join(PUBLIC_ROOT, 'packages/superdoc/src/__oxlint-disable-reason-test-'));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
    let status = 0;
    let output: string;
    try {
      output = execFileSync(VP, ['lint', '-f', 'json', relative(PUBLIC_ROOT, dir)], {
        cwd: PUBLIC_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      if (!(error instanceof Error) || !('stdout' in error) || typeof error.stdout !== 'string') throw error;
      status = 'status' in error && typeof error.status === 'number' ? error.status : 1;
      output = error.stdout;
    }
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== 'object' || parsed === null || !('diagnostics' in parsed)) {
      throw new Error(`Unexpected Oxlint output: ${output}`);
    }
    const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics.filter(isDiagnostic) : [];
    return {
      status,
      problems: diagnostics
        .map(({ code, message, filename }) => `${filename.split('/').at(-1)}: ${code ?? 'directive'}: ${message}`)
        .sort(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('vp lint accepts a justified disable above a real violation', () => {
  assert.deepEqual(
    lint({
      'justified.ts': 'export function f() {\n  // oxlint-disable-next-line no-debugger -- probe\n  debugger;\n}\n',
    }),
    { status: 0, problems: [] },
  );
});

test('vp lint rejects a bare disable, a file-wide disable, a stale disable, and a guardrail disable', () => {
  const { status, problems } = lint({
    'bare.ts': 'export function f() {\n  // oxlint-disable-next-line no-debugger\n  debugger;\n}\n',
    'file-wide.ts': '/* oxlint-disable */\nexport function g() {\n  debugger;\n}\n',
    'stale.ts': '// oxlint-disable-next-line no-debugger -- probe\nexport const a = 1;\n',
    'self.ts': 'export const b = 1; // oxlint-disable-line superdoc/no-comments -- x\n',
  });
  assert.notEqual(status, 0);
  assert.deepEqual(problems, [
    `bare.ts: superdoc(disable-directive-reason): ${MISSING_REASON}`,
    `file-wide.ts: superdoc(disable-directive-reason): ${MISSING_REASON}`,
    'self.ts: directive: Unused oxlint-disable directive (no problems were reported).',
    'self.ts: superdoc(disable-directive-reason): Do not disable superdoc/no-comments. Change the code instead.',
    'stale.ts: directive: Unused oxlint-disable directive (no problems were reported).',
  ]);
});
