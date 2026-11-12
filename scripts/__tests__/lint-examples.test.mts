import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXAMPLES = 'examples';
const PROBE_DIR = 'examples/vanilla/src';
const UNBUILT_PACKAGE_HINT =
  'A TS2307 on superdoc, @superdoc/react or @superdoc/sdk means that package has no built types, so ' +
  'typescript/no-deprecated cannot see its deprecations. Build them first, as the CI Examples lane does.';

interface LintRun {
  status: number | null;
  stdout: string;
  output: string;
}

function typeCheckedLint(...args: string[]): LintRun {
  const result = spawnSync('pnpm', ['exec', 'vp', 'lint', '--type-check', ...args], {
    cwd: PUBLIC_ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}` };
}

function lintProbe(source: string): LintRun {
  const probeDir = mkdtempSync(join(PUBLIC_ROOT, PROBE_DIR, 'lint-examples-'));
  try {
    const probe = join(probeDir, 'probe.ts');
    writeFileSync(probe, source, 'utf8');
    return typeCheckedLint(relative(PUBLIC_ROOT, probe));
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

const DEPRECATED_CONFIG_KEY =
  "import { SuperDoc } from 'superdoc';\n\n" +
  "export const superdoc = new SuperDoc({ selector: '#editor', onEditorDestroy: () => {} });\n";

const NO_DEPRECATED_API =
  "import { SuperDoc } from 'superdoc';\n\nexport const superdoc = new SuperDoc({ selector: '#editor' });\n";

test('every example source file lints clean against resolved SuperDoc types', () => {
  const run = typeCheckedLint('--format', 'json', EXAMPLES);
  const parsed: unknown = JSON.parse(run.stdout);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('number_of_files' in parsed) ||
    typeof parsed.number_of_files !== 'number' ||
    !('diagnostics' in parsed) ||
    !Array.isArray(parsed.diagnostics)
  ) {
    throw new Error(`Unexpected vp lint output:\n${run.output}`);
  }
  assert.ok(parsed.number_of_files > 0, `vp lint linted nothing under ${EXAMPLES}.\n${run.output}`);
  assert.deepStrictEqual(
    parsed.diagnostics,
    [],
    `Example sources have lint findings. ${UNBUILT_PACKAGE_HINT}\n${JSON.stringify(parsed.diagnostics, null, 2)}`,
  );
  assert.strictEqual(run.status, 0, run.output);
});

test('vp lint rejects a deprecated SuperDoc config key in an example', () => {
  const { status, output } = lintProbe(DEPRECATED_CONFIG_KEY);
  assert.match(
    output,
    /no-deprecated\).*onEditorDestroy/,
    `vp lint did not report onEditorDestroy in ${PROBE_DIR}. Either typescript/no-deprecated no longer covers ` +
      `the example sources in vite.config.ts, or the SuperDoc types did not resolve. ${UNBUILT_PACKAGE_HINT}\n${output}`,
  );
  assert.notStrictEqual(status, 0, `vp lint reported no-deprecated without failing.\n${output}`);
});

test('vp lint accepts an example that uses no deprecated API', () => {
  const { status, output } = lintProbe(NO_DEPRECATED_API);
  assert.doesNotMatch(output, /No files found to lint/, `vp lint matched no probe in ${PROBE_DIR}.\n${output}`);
  assert.strictEqual(status, 0, `vp lint rejected a clean probe in ${PROBE_DIR}.\n${output}`);
});
