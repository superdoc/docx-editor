import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORIES_THAT_LOST_THEIR_NO_EXPLICIT_ANY_EXEMPTION = [
  'packages/superdoc/src/core',
  'packages/superdoc/src/public/ui',
];

const EXPLICIT_ANY_SOURCE = 'export const probe = (value: any) => value;\n';

const SUPERDOC_TEST_AND_VUE_PROBES = [
  { dir: 'packages/superdoc/src/core', file: 'probe.test.ts', source: EXPLICIT_ANY_SOURCE },
  {
    dir: 'packages/superdoc/src/components',
    file: 'Probe.vue',
    source: `<script setup lang="ts">\n${EXPLICIT_ANY_SOURCE}</script>\n`,
  },
];

const COMMENTS_LAYER = 'packages/superdoc/src/components/CommentsLayer';

const COMMENTS_LAYER_FILES = readdirSync(join(REPO_ROOT, COMMENTS_LAYER), { recursive: true })
  .map((file) => join(COMMENTS_LAYER, String(file)))
  .sort();

const REAL_FILES_THAT_MUST_BE_LINTED = {
  'SuperDoc.vue': ['packages/superdoc/src/SuperDoc.vue'],
  'every CommentsLayer Vue component': COMMENTS_LAYER_FILES.filter((file) => file.endsWith('.vue')),
  'every CommentsLayer test': COMMENTS_LAYER_FILES.filter((file) => /\.test\./.test(file)),
};

const DESCRIBED_EXPECT_ERROR = '// @ts-expect-error the string is not a number\nexport const probe: number = "x";\n';

function lintProbe(dir, file, source) {
  const probeDir = mkdtempSync(join(REPO_ROOT, dir, 'lint-coverage-'));
  const probe = join(probeDir, file);
  try {
    writeFileSync(probe, source, 'utf8');
    const rel = relative(REPO_ROOT, probe);
    const result = spawnSync('pnpm', ['exec', 'vp', 'lint', rel], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

function assertLintRejects(dir, file, source, rule) {
  const { status, output } = lintProbe(dir, file, source);

  assert.doesNotMatch(
    output,
    /No files found to lint/,
    `vp lint matched no file for a ${file} probe inside ${dir}, so it is outside the linter. ` +
      `Check lint.ignorePatterns in vite.config.ts and the paths passed to the lint script.\n${output}`,
  );
  assert.match(
    output,
    new RegExp(rule),
    `vp lint did not report ${rule} for a ${file} probe inside ${dir}. Either the rule is no longer ` +
      `'error' in vite.config.ts, or a lint.overrides entry exempted this path again.\n${output}`,
  );
  assert.notStrictEqual(status, 0, `vp lint reported ${rule} inside ${dir} without failing.\n${output}`);
}

function assertLintAccepts(dir, file, source) {
  const { status, output } = lintProbe(dir, file, source);
  assert.doesNotMatch(output, /No files found to lint/, `vp lint matched no file inside ${dir}.\n${output}`);
  assert.strictEqual(status, 0, `vp lint rejected a ${file} probe inside ${dir}.\n${output}`);
}

function lintedFileCount(files) {
  const result = spawnSync('pnpm', ['exec', 'vp', 'lint', '--format', 'json', ...files], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (/No files found to lint/.test(output)) return { count: 0, output };
  return { count: JSON.parse(result.stdout).number_of_files, output };
}

for (const [label, files] of Object.entries(REAL_FILES_THAT_MUST_BE_LINTED)) {
  test(`vp lint reaches ${label}`, () => {
    assert.ok(files.length > 0, `found nothing for ${label}; update REAL_FILES_THAT_MUST_BE_LINTED.`);
    const { count, output } = lintedFileCount(files);
    assert.strictEqual(
      count,
      files.length,
      `vp lint linted ${count} of ${files.length} files for ${label}. Check lint.ignorePatterns in vite.config.ts ` +
        `for an entry that excludes them again:\n${files.join('\n')}\n${output}`,
    );
  });
}

for (const dir of DIRECTORIES_THAT_LOST_THEIR_NO_EXPLICIT_ANY_EXEMPTION) {
  test(`vp lint rejects a new explicit any anywhere in ${dir}`, () => {
    assertLintRejects(dir, 'probe.ts', EXPLICIT_ANY_SOURCE, 'no-explicit-any');
  });
}

for (const { dir, file, source } of SUPERDOC_TEST_AND_VUE_PROBES) {
  test(`vp lint rejects a new explicit any in a ${file} inside ${dir}`, () => {
    assertLintRejects(dir, file, source, 'no-explicit-any');
  });
}

test('vp lint accepts a described @ts-expect-error in a superdoc test file', () => {
  assertLintAccepts('packages/superdoc/src/core', 'probe.test.ts', DESCRIBED_EXPECT_ERROR);
});

test('vp lint rejects a bare @ts-expect-error in a superdoc test file', () => {
  assertLintRejects(
    'packages/superdoc/src/core',
    'probe.test.ts',
    '// @ts-expect-error\nexport const probe: number = "x";\n',
    'ban-ts-comment',
  );
});

test('vp lint rejects @ts-ignore and @ts-nocheck in a superdoc test file', () => {
  for (const directive of ['// @ts-ignore the string is not a number', '// @ts-nocheck the file is unchecked']) {
    assertLintRejects(
      'packages/superdoc/src/core',
      'probe.test.ts',
      `${directive}\nexport const probe: number = "x";\n`,
      'ban-ts-comment',
    );
  }
});

test('vp lint rejects a described @ts-expect-error in a superdoc source file', () => {
  assertLintRejects('packages/superdoc/src/core', 'probe.ts', DESCRIBED_EXPECT_ERROR, 'ban-ts-comment');
});
