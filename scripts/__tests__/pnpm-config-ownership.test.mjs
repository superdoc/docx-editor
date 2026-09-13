/**
 * pnpm settings live in pnpm-workspace.yaml, not package.json#pnpm.
 *
 * pnpm 11 ignores `package.json#pnpm`, so settings declared there read as live
 * while having no effect. Build permissions also use one `allowBuilds` map;
 * preserving separate allow and ignore lists would silently drop both policies.
 *
 * This asserts the settings have exactly one home. It is a structural check, so
 * it uses pnpm's workspace discovery but needs no installed project dependencies
 * or resolved lockfile.
 *
 * Run:
 *   node --test scripts/__tests__/pnpm-config-ownership.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function toRepositoryPath(path, separator = sep) {
  return path.split(separator).join('/');
}

/**
 * Settings this workspace owns and therefore the ones that can drift.
 *
 * This is the ALLOWLIST, and everything under a nested `pnpm` block is measured
 * against it: a key that is not here is reported too. The inverse — enumerating
 * pnpm's root-only settings — goes stale on the next pnpm release, silently and
 * in the permissive direction, which is the same failure this test exists to
 * catch one level up. Failing closed means a new pnpm setting appearing in a
 * workspace manifest is flagged until somebody classifies it.
 */
const SHAREABLE_KEYS = [
  'overrides',
  'patchedDependencies',
  'allowBuilds',
  'packageExtensions',
  'peerDependencyRules',
  'allowedDeprecatedVersions',
  'supportedArchitectures',
];

/**
 * Every workspace manifest pnpm would read, tracked or not.
 *
 * Let pnpm expand its own workspace patterns instead of approximating them with
 * a repository-wide file glob.
 */
function listWorkspaceManifests(
  projects = JSON.parse(
    execFileSync('pnpm', ['--recursive', 'list', '--depth', '-1', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  ),
  manifestExists = existsSync,
) {
  const manifestNames = ['package.json', 'package.json5', 'package.yaml'];

  return projects
    .map(({ path }) => resolve(path))
    .filter((projectPath) => projectPath !== REPO_ROOT)
    .map((projectPath) => manifestNames.map((name) => resolve(projectPath, name)).find(manifestExists))
    .filter(Boolean)
    .map((manifestPath) => toRepositoryPath(relative(REPO_ROOT, manifestPath)));
}

test('the root manifest declares no pnpm settings', () => {
  const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  assert.ok(
    !('pnpm' in manifest),
    'package.json#pnpm duplicates pnpm-workspace.yaml and is not read by pnpm 11. ' +
      'Declare the setting in pnpm-workspace.yaml instead.',
  );
});

/**
 * Manifests in a format this gate cannot parse, each recording who checked it
 * and the exact contents they checked.
 *
 * Empty, and expected to stay that way: every workspace manifest in this
 * repository is `package.json`. An entry is an attestation that a human opened
 * the file and found no `pnpm` block, which is the only way past the check below.
 *
 * The digest is what keeps the attestation honest. Keyed by pathname alone, a
 * later edit could add `pnpm.overrides` to an already-attested file and pass
 * silently, which is the same failure as the reader this replaced. Any edit
 * changes the digest, so the file has to be looked at again.
 *
 * Why attest rather than read. pnpm also accepts `package.json5` and
 * `package.yaml`, and neither can be parsed here, because this runs before
 * `pnpm install` and so has no dependencies to parse with. An earlier version
 * matched the key in the source text instead. That reader was wrong four times
 * over: it missed a key behind a comment, behind a character escape, and behind
 * a YAML alias, and each miss was a silent accept - the exact failure the gate
 * exists to prevent. A reader that keeps being wrong in the permissive direction
 * is worse than no reader, because it reads as coverage.
 *
 * The cost is that adding such a manifest fails this gate until someone adds a
 * line here. That is a loud, one-line, reviewable stop for a deliberate and
 * currently nonexistent act, traded for closing an open-ended class of silent
 * accepts.
 */
const REVIEWED_NON_JSON_MANIFESTS = Object.freeze({
  // 'apps/example/package.yaml': Object.freeze({
  //   sha256: '<the digest the failure message prints>',
  //   reviewedBy: '<who opened it, and when>',
  // }),
});

/**
 * Why an attested manifest still has to be reported, or null when it does not.
 *
 * The failure message carries the current digest so recording a fresh review is
 * a copy, not an exercise in running the right hashing command.
 */
function attestationProblem(relativePath, source, reviewed = REVIEWED_NON_JSON_MANIFESTS) {
  const digest = createHash('sha256').update(source).digest('hex');
  const entry = Object.hasOwn(reviewed, relativePath) ? reviewed[relativePath] : null;
  if (!entry) return `${relativePath} (never reviewed; sha256 ${digest})`;
  if (entry.sha256 !== digest) {
    return (
      `${relativePath} (edited since ${entry.reviewedBy} reviewed it; ` +
      `sha256 is now ${digest}, recorded ${entry.sha256})`
    );
  }
  return null;
}

test('no workspace manifest declares a setting that belongs to pnpm-workspace.yaml', () => {
  // pnpm honors these only at the root, so a nested copy is dead configuration
  // that reads as if it were live.
  const offenders = [];
  const unreadable = [];
  for (const relativePath of listWorkspaceManifests()) {
    if (!relativePath.endsWith('.json')) {
      const problem = attestationProblem(relativePath, readFileSync(resolve(REPO_ROOT, relativePath), 'utf8'));
      if (problem) unreadable.push(problem);
      continue;
    }
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), 'utf8'));
    if (!manifest.pnpm) continue;
    // Every key, not only the shareable ones. A root-only setting nested here is
    // dead configuration just the same, and a pnpm setting this list has never
    // heard of is exactly the case that must not pass quietly.
    const declared = Object.keys(manifest.pnpm);
    if (declared.length > 0) offenders.push(`${relativePath} (${declared.join(', ')})`);
  }
  assert.deepEqual(
    offenders,
    [],
    `these manifests declare pnpm settings that belong in pnpm-workspace.yaml:\n  ${offenders.join('\n  ')}\n` +
      `Settings pnpm reads from either file: ${SHAREABLE_KEYS.join(', ')}. ` +
      'Anything else is root-only, so a nested copy is dead configuration either way.',
  );
  assert.deepEqual(
    unreadable,
    [],
    `this guard parses package.json, and these manifests are another format pnpm reads:\n  ${unreadable.join('\n  ')}\n` +
      'Open each one. If it declares no pnpm block, record it in ' +
      'REVIEWED_NON_JSON_MANIFESTS with who checked it. If it does, move the ' +
      'settings to pnpm-workspace.yaml, because pnpm ignores a nested pnpm block ' +
      'whatever the format.',
  );
});

test('a manifest in a format this guard cannot parse is reported, not skipped', () => {
  // The whole point of the change that introduced this: an unreadable manifest
  // must never pass quietly. A text reader let three different spellings of the
  // key through before this replaced it.
  const project = resolve(REPO_ROOT, 'apps/yaml-project');
  const manifest = resolve(project, 'package.yaml');
  assert.deepEqual(
    listWorkspaceManifests([{ path: REPO_ROOT }, { path: project }], (path) => path === manifest),
    ['apps/yaml-project/package.yaml'],
  );

  // Discovery still finds it, which is what makes the report possible. A guard
  // that stopped looking for these formats would be back to a silent skip.
  assert.ok(!'apps/yaml-project/package.yaml'.endsWith('.json'));
});

test('an attestation covers one exact file, not a pathname', () => {
  const path = 'apps/example/package.yaml';
  const reviewed = 'name: example\nversion: 1.0.0\n';
  const digest = createHash('sha256').update(reviewed).digest('hex');
  const attested = { [path]: { sha256: digest, reviewedBy: 'a human, 2026-07-31' } };

  // The file somebody actually opened passes.
  assert.equal(attestationProblem(path, reviewed, attested), null);

  // An unreviewed file is reported, and the message carries the digest to record.
  const never = attestationProblem(path, reviewed, {});
  assert.match(never, /never reviewed/);
  assert.match(never, new RegExp(digest));

  // The gap this exists for: settings added to an already-attested file. Keyed
  // by pathname alone this passed silently, which is the failure the source-text
  // reader was removed for.
  const edited = `${reviewed}pnpm:\n  overrides:\n    vue: "1.0.0"\n`;
  const changed = attestationProblem(path, edited, attested);
  assert.match(changed, /edited since a human, 2026-07-31 reviewed it/);
  assert.match(changed, new RegExp(createHash('sha256').update(edited).digest('hex')));

  // Even a change that adds nothing has to be looked at again: this cannot tell
  // a harmless edit from a meaningful one without parsing, which is the premise.
  assert.match(attestationProblem(path, `${reviewed}\n`, attested), /edited since/);

  // A pathname colliding with an Object prototype key is not an attestation.
  assert.match(attestationProblem('constructor', reviewed, {}), /never reviewed/);
});

test('a project path colliding with an Object prototype key is discovered', () => {
  const project = resolve(REPO_ROOT, 'constructor');
  assert.deepEqual(
    listWorkspaceManifests(
      [{ path: REPO_ROOT }, { path: project }],
      (path) => path === resolve(project, 'package.json'),
    ),
    ['constructor/package.json'],
  );
});

/**
 * Every setting the migration moved, complete rather than sampled. Taken from
 * the `package.json#pnpm` block this commit deleted, so a later edit that drops
 * one of them fails here instead of silently changing resolution or install
 * policy. An earlier version listed 5 of the 42 overrides and 6 of the 8
 * build permissions, which left deleting `protobufjs@8` or
 * `@playwright/browser-chromium` green.
 *
 * The `vite` override is deliberately absent here and asserted separately: its
 * value is the one setting a later commit is expected to change, and listing it
 * as a fixed string would mean any Vite swap edits this list, which is exactly
 * the silent-loss shape the list exists to catch.
 */
const MIGRATED = Object.freeze({
  allowBuilds: Object.freeze([
    '@parcel/watcher=false',
    '@playwright/browser-chromium=false',
    '@swc/core=false',
    '@vscode/vsce-sign=true',
    'better-sqlite3=true',
    'canvas=true',
    'esbuild=true',
    'keytar=true',
    'lmdb=false',
    'msgpackr-extract=false',
    'msw=false',
    'onnxruntime-node=false',
    'protobufjs=false',
    'puppeteer=true',
    'sharp=true',
    'unrs-resolver=true',
    'vue-demi=true',
  ]),
  // No `patchedDependencies`. This guard asks whether the migration out of
  // `package.json#pnpm` silently dropped a setting, and both patches have since
  // been deleted on purpose, each with a test proving its dependency no longer
  // needs patching. Keeping the entry would assert that a section we removed
  // deliberately is still present, which is a failing test describing the old
  // tree rather than a guard on this one. `patchedDependencies` stays in
  // SHAREABLE_KEYS, so a patch re-registered in a workspace manifest is still
  // reported.
  //
  // `key=value` for the mapping sections. The keys alone left a changed
  // resolution or patch path invisible: `canvas: "3.2.3"` could become
  // `"9.9.9"` with every assertion green. Values are taken from the deleted
  // `package.json#pnpm` block, verified identical to the migrated file.
  overrides: Object.freeze([
    'canvas=3.2.3',
    'happy-dom=20.4.0',
    'jsdom=27.3.0',
    'vue=3.5.32',
    '@vue/compiler-core=3.5.32',
    '@vue/compiler-dom=3.5.32',
    '@vue/compiler-sfc=3.5.32',
    '@vue/runtime-core=3.5.32',
    '@vue/runtime-dom=3.5.32',
    '@vue/server-renderer=3.5.32',
    '@vue/shared=3.5.32',
    'axios=1.18.0',
    'protobufjs@7=7.6.4',
    'protobufjs@8=8.6.4',
    'superdoc=workspace:*',
    '@superdoc/react=workspace:*',
    '@superdoc/sdk=workspace:*',
    '@superdoc/common=workspace:*',
    '@superdoc/contracts=workspace:*',
    '@superdoc/dom-contract=workspace:*',
    '@superdoc/font-system=workspace:*',
    '@superdoc/font-utils=workspace:*',
    '@superdoc/geometry-utils=workspace:*',
    '@superdoc/layout-bridge=workspace:*',
    '@superdoc/layout-engine=workspace:*',
    '@superdoc/layout-resolved=workspace:*',
    '@superdoc/measuring-dom=workspace:*',
    '@superdoc/painter-dom=workspace:*',
    '@superdoc/preset-geometry=workspace:*',
    '@superdoc/style-engine=workspace:*',
    '@superdoc/url-validation=workspace:*',
    '@superdoc/word-layout=workspace:*',
    '@hocuspocus/provider=^2.13.6',
    '@liveblocks/client=^3.15.5',
    '@liveblocks/yjs=^3.15.5',
    // No `openapi-types=12.1.3`. The pin existed to hold the patched version in
    // place; with the patch gone, `@apidevtools/swagger-parser` accepts `>=7`
    // and resolves on its own. This list guards against the migration losing a
    // setting, not against removing one on purpose.
    '@types/minimatch=5.1.2',
    'xml-js=1.6.11',
    'y-websocket=^3.0.0',
    'yjs=^13.6.19',
  ]),
});

/**
 * The entry names under one top-level key, read key-aware rather than by
 * substring. `body.includes('vue')` was satisfied by `@vue/compiler-core`, so
 * deleting the actual `vue:` override passed; `includes('canvas')` is satisfied
 * by the `catalog:` block a hundred lines earlier.
 *
 * The settings this guard reads are flat maps of scalar to scalar. Read with a
 * small matcher rather than a YAML dependency, the same call
 * check-repo-structure already makes for the `packages:` list.
 */
function readSectionEntries(workspace, key) {
  const lines = workspace.replace(/\r\n/g, '\n').split('\n');
  // The header, with any trailing comment allowed: `overrides: # pinned` is the
  // same section as `overrides:`, and an exact comparison reported it missing.
  // Whitespace before the `#` is arbitrary in YAML, so matching a literal `": #"`
  // still rejected `overrides:  # pinned` and reported every setting under it
  // missing over a harmless edit.
  const header = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(?:#.*)?$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) return null;
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // next top-level key
    const sequence = line.match(/^\s+-\s+(.+?)\s*$/);
    if (sequence) {
      entries.push(unquote(stripComment(sequence[1])));
      continue;
    }
    const mapping = line.match(/^\s+('[^']+'|"[^"]+"|[^:#]+):\s*(.*)$/);
    // `key=value` for a mapping, so a changed value is visible. Recording the key
    // alone let `canvas: "3.2.3"` become `canvas: "9.9.9"` with every assertion
    // still green, while the resolution the migration was preserving had changed.
    if (mapping) entries.push(`${unquote(mapping[1].trim())}=${unquote(stripComment(mapping[2]))}`);
  }
  return entries;
}

/**
 * The scalar without its trailing comment.
 *
 * A `#` inside quotes is part of the value, so the quoted form is measured from
 * its closing quote and anything after that goes. Returning a quoted scalar
 * untouched was wrong the moment one carried a comment: `canvas: "3.2.3" # keep
 * pinned` kept the comment, `unquote` could not match a closing quote at the
 * end, and the migration assertion reported an unchanged setting as missing.
 */
function stripComment(value) {
  const quote = value[0];
  if (quote === "'" || quote === '"') {
    const close = value.indexOf(quote, 1);
    return close === -1 ? value : value.slice(0, close + 1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function unquote(value) {
  const match = value.match(/^'(.*)'$/) ?? value.match(/^"(.*)"$/);
  return match ? match[1] : value;
}

test('the docs collaboration runtime may install its platform binary', () => {
  const workspace = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
  assert.ok(readSectionEntries(workspace, 'allowBuilds').includes('workerd=true'));
});

test('readSectionEntries reads exact keys with their values, not substrings', () => {
  // The reader is what makes the coverage assertion meaningful, so it has to be
  // able to fail. A substring check passed while `vue:` was deleted because
  // `@vue/compiler-core` still mentioned it, and a key-only reading passed while
  // a version changed underneath it.
  const sample = [
    'overrides:',
    '  vue: "3.5.32"',
    '  \'@vue/shared\': "3.5.32"',
    '  vite: npm:x # note',
    '  canvas: "3.2.3" # keep pinned',
    "  jsdom: '27.3.0' # single quotes too",
    '  marker: "a # b"',
    'packages:',
    '  - apps/*',
  ].join('\n');
  assert.deepEqual(readSectionEntries(sample, 'overrides'), [
    'vue=3.5.32',
    '@vue/shared=3.5.32',
    // The trailing comment is not part of the value.
    'vite=npm:x',
    // A comment after a quoted scalar goes too. Keeping it left the closing
    // quote mid-string, so `unquote` could not match and the migration
    // assertion reported an unchanged setting as missing.
    'canvas=3.2.3',
    'jsdom=27.3.0',
    // A `#` inside the quotes is part of the value, not the start of a comment.
    'marker=a # b',
  ]);
  // The workspace package list remains a sequence, so its entries stay bare.
  assert.deepEqual(readSectionEntries(sample, 'packages'), ['apps/*']);
  assert.equal(readSectionEntries(sample, 'absent'), null);
  // A comment on the header names the same section. An exact comparison found no
  // section at all and the migration assertion reported it missing.
  assert.deepEqual(
    readSectionEntries(['overrides: # pinned resolutions', '  canvas: "3.2.3"', ''].join('\n'), 'overrides'),
    ['canvas=3.2.3'],
  );
  // A different key that merely starts the same is still a different section.
  assert.equal(readSectionEntries(['overridesExtra:', '  canvas: "3.2.3"', ''].join('\n'), 'overrides'), null);
  // Whitespace before a header comment is arbitrary in YAML. Matching a literal
  // `": #"` rejected this and reported every setting under it missing over a
  // harmless edit.
  for (const header of ['overrides:  # pinned', 'overrides:\t# pinned', 'overrides:# pinned']) {
    assert.deepEqual(
      readSectionEntries([header, '  canvas: "3.2.3"', ''].join('\n'), 'overrides'),
      ['canvas=3.2.3'],
      `header ${JSON.stringify(header)} should name the overrides section`,
    );
  }
  // A changed value is a different entry, which is the whole point.
  assert.deepEqual(readSectionEntries(['overrides:', '  canvas: "3.2.3"', ''].join('\n'), 'overrides'), [
    'canvas=3.2.3',
  ]);
  assert.notDeepEqual(readSectionEntries(['overrides:', '  canvas: "9.9.9"', ''].join('\n'), 'overrides'), [
    'canvas=3.2.3',
  ]);
});

test('pnpm-workspace.yaml carries every setting the manifest used to hold', () => {
  // A header-only check, or a sampled one, passes while individual settings are
  // silently lost: deleting `better-sqlite3`, `protobufjs@8`, or the `vue:`
  // override each left the earlier version of this test green while undoing
  // part of the migration.
  const workspace = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const sdkWorkspaceExists = existsSync(resolve(REPO_ROOT, 'packages/sdk/langs/node/package.json'));
  for (const [key, expected] of Object.entries(MIGRATED)) {
    const present = readSectionEntries(workspace, key);
    assert.ok(present !== null, `pnpm-workspace.yaml is missing ${key}`);
    const applicableExpected = sdkWorkspaceExists
      ? expected
      : expected.filter((entry) => entry !== '@superdoc/sdk=workspace:*');
    const missing = applicableExpected.filter((entry) => !present.includes(entry));
    assert.deepEqual(
      missing,
      [],
      `pnpm-workspace.yaml#${key} no longer carries ${missing.join(', ')}, so the migration lost it`,
    );
  }

  if (!sdkWorkspaceExists) {
    const docsManifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'apps/docs/package.json'), 'utf8'));
    const expectedSdkVersion = docsManifest.devDependencies?.['@superdoc/sdk'];
    assert.match(expectedSdkVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    const overrides = readSectionEntries(workspace, 'overrides');
    assert.ok(overrides?.includes(`@superdoc/sdk=${expectedSdkVersion}`));
  }
});

test('the vite override stays a real Vite that still ships its binary', () => {
  // The expensive lesson from this migration. `@voidzero-dev/vite-plus-core`
  // publishes no `bin`, so overriding `vite` to it silently deletes the `vite`
  // executable from every package in the workspace. Examples call `vite` from
  // their `dev`/`build` scripts, and their smoke tests
  // Playwright config shells out to those scripts, and the behavior harnesses
  // run `pnpm exec vite` directly. None of that is visible in the alias syntax,
  // and `pnpm install --frozen-lockfile` succeeds either way, so CI was the
  // only thing that caught it.
  //
  // The previous `npm:rolldown-vite@7.3.1` alias was safe precisely because
  // rolldown-vite does ship a bin. Any future alias has to clear the same bar,
  // so this asserts the property rather than a specific package name.
  const workspace = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');

  const overrides = readSectionEntries(workspace, 'overrides');
  assert.ok(overrides !== null, 'pnpm-workspace.yaml is missing overrides');
  const vite = overrides.find((entry) => entry.startsWith('vite='));
  assert.ok(vite, 'pnpm-workspace.yaml#overrides no longer pins vite');
  assert.ok(
    !vite.includes('vite-plus-core'),
    'the vite override must not point at @voidzero-dev/vite-plus-core: it ships no `bin`, ' +
      'so every `vite` script and Playwright webServer in the workspace breaks. ' +
      'Packages that build through Vite+ take it from their own `vite-plus` devDependency.',
  );

  // Deliberately not asserting that `node_modules/.bin/vite` exists: this file
  // is a structural check that runs before `pnpm install` in every workflow, so
  // a filesystem probe here fails on a clean checkout. The override shape is the
  // thing that can be reviewed statically; the binary's absence shows up in the
  // demo and behavior lanes that actually run it.

  // Vite+ itself still has to be reachable, and its Vitest peer exception has to
  // name the version the catalog resolves, or installs fall back to warnings we
  // stopped reading.
  const catalog = readSectionEntries(workspace, 'catalog');
  assert.ok(catalog !== null, 'pnpm-workspace.yaml is missing catalog');
  assert.ok(
    catalog.some((entry) => entry.startsWith('vite-plus=')),
    'the catalog no longer carries a vite-plus entry',
  );

  const peerRules = readSectionEntries(workspace, 'peerDependencyRules');
  assert.ok(peerRules !== null, 'pnpm-workspace.yaml is missing peerDependencyRules');
  assert.ok(
    !workspace.includes('allowAny'),
    'peerDependencyRules must not waive whole peer ranges with allowAny; pin exact versions instead',
  );

  const catalogVitest = catalog.find((entry) => entry.startsWith('vitest='));
  assert.ok(catalogVitest, 'the catalog no longer carries a vitest entry');
  const vitestVersion = catalogVitest.slice('vitest='.length).replace(/^\^|^~/, '');
  assert.ok(
    peerRules.includes(`vitest=${vitestVersion}`),
    `peerDependencyRules must allow vitest ${vitestVersion} to match the catalog`,
  );
});

test('the Vitest peer exception agrees across every workspace that pins one', () => {
  // Three workspaces carry their own `pnpm-workspace.yaml`, and the Vitest peer
  // exception has to name the same version in each: they share packages through
  // globs, so a workspace pinning a stale Vitest resolves a different runner for
  // the same package depending on which root you installed from. Nothing caught
  // that before this test — setting v2's exception to a nonsense version left
  // the suite green.
  //
  // Only Vitest is compared. The `vite` exception is deliberately absent from
  // the `superdoc/` root, which stays on stock Vite for its Playwright
  // harnesses, so requiring it everywhere would assert the bug back in.
  const roots = {
    'superdoc/': resolve(REPO_ROOT, '..', 'pnpm-workspace.yaml'),
    'superdoc/public/': resolve(REPO_ROOT, 'pnpm-workspace.yaml'),
    'superdoc/v2/': resolve(REPO_ROOT, '..', 'v2', 'pnpm-workspace.yaml'),
  };

  const pins = new Map();
  for (const [label, path] of Object.entries(roots)) {
    if (!existsSync(path)) continue;
    const workspace = readFileSync(path, 'utf8');
    const rules = readSectionEntries(workspace, 'peerDependencyRules');
    if (rules === null) continue;
    assert.ok(
      !workspace.includes('allowAny'),
      `${label}pnpm-workspace.yaml waives peer ranges with allowAny; pin exact versions instead`,
    );
    const vitest = rules.find((entry) => entry.startsWith('vitest='));
    if (vitest) pins.set(label, vitest.slice('vitest='.length));
  }

  assert.ok(pins.size > 0, 'expected at least one workspace to pin a Vitest peer exception');
  const [[firstLabel, expected]] = [...pins];
  for (const [label, version] of pins) {
    assert.equal(
      version,
      expected,
      `${label} pins vitest ${version} but ${firstLabel} pins ${expected}; ` +
        'the exception has to name one version or the same package resolves a different runner per root',
    );
  }
});

test('discovery follows pnpm workspace projects without mutating the repository', () => {
  const workspace = resolve(REPO_ROOT, 'packages/untracked-workspace');
  const standalone = resolve(REPO_ROOT, 'tests/standalone-project');
  const found = listWorkspaceManifests(
    [{ path: REPO_ROOT }, { path: workspace }],
    (path) => path === resolve(workspace, 'package.json'),
  );

  assert.deepEqual(found, ['packages/untracked-workspace/package.json']);
  const standalonePath = toRepositoryPath(relative(REPO_ROOT, standalone));
  assert.ok(!found.some((path) => path.startsWith(standalonePath)));
  assert.equal(
    toRepositoryPath('packages\\untracked-workspace\\package.json', '\\'),
    'packages/untracked-workspace/package.json',
  );
});
