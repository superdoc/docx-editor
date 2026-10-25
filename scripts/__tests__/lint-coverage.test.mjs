import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORIES_THAT_LOST_THEIR_NO_EXPLICIT_ANY_EXEMPTION = [
  'packages/superdoc/src/core',
  'packages/superdoc/src/public/ui',
];

const EXPLICIT_ANY_SOURCE = 'export const probe = (value: any) => value;\n';

function lintAnExplicitAnyProbeIn(dir) {
  const probeDir = mkdtempSync(join(REPO_ROOT, dir, 'lint-coverage-'));
  const probe = join(probeDir, 'probe.ts');
  try {
    writeFileSync(probe, EXPLICIT_ANY_SOURCE, 'utf8');
    const rel = relative(REPO_ROOT, probe);
    const result = spawnSync('pnpm', ['exec', 'vp', 'lint', rel], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function assertLintRejectsAnExplicitAnyIn(dir) {
  const { status, output } = lintAnExplicitAnyProbeIn(dir);

  assert.doesNotMatch(
    output,
    /No files found to lint/,
    `vp lint matched no file for a probe inside ${dir}, so that directory is outside the linter. ` +
      `Check lint.ignorePatterns in vite.config.ts and the paths passed to the lint script.\n${output}`,
  );
  assert.match(
    output,
    /no-explicit-any/,
    `vp lint did not report typescript(no-explicit-any) for a probe inside ${dir}. Either the rule is ` +
      `no longer 'error' in vite.config.ts, or a lint.overrides entry exempted this directory again.\n${output}`,
  );
  assert.notStrictEqual(
    status,
    0,
    `vp lint reported typescript(no-explicit-any) inside ${dir} without failing, so the rule is a ` +
      `warning rather than an error.\n${output}`,
  );
}

for (const dir of DIRECTORIES_THAT_LOST_THEIR_NO_EXPLICIT_ANY_EXEMPTION) {
  test(`vp lint rejects a new explicit any anywhere in ${dir}`, () => {
    assertLintRejectsAnExplicitAnyIn(dir);
  });
}
