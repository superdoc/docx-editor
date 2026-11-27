#!/usr/bin/env node
/**
 * Single command to validate the published superdoc package's public
 * TypeScript surface end-to-end.
 *
 * Ordering invariant: cheap policy/config gates first, then build,
 * then packed-consumer gates, then gates that reuse the packed fixture.
 * Contributor iteration cost stays low because tier or jsdoc drift
 * fails in seconds instead of after a full build + install.
 *
 * Stage names are display labels for logs only; the rerunnable command
 * (printed on failure) is the actual cwd + cmd + args from the stage
 * definition.
 *
 * Stages:
 *   1. contract-tiers-test           - unit tests for the pure tier
 *                                      validator. ~50ms. Verifies the
 *                                      validator catches every failure
 *                                      class before stage 2 trusts it.
 *   2. contract-tiers                - package.json#exports vs
 *                                      publicContract (tier coverage,
 *                                      routing, legacy-raw allowlist).
 *                                      ~10ms; fast-fails before the
 *                                      slow build/matrix work.
 *   3. jsdoc-ratchet                 - per-file checkJs on the curated
 *                                      CHECKED_FILES list + ratchet over
 *                                      public-reachable JSDoc files.
 *                                      Fails when new public JSDoc files
 *                                      land without `// @ts-check` or
 *                                      when the allowlist carries
 *                                      empty/stale entries.
 *   4. jsdoc-hygiene-ts-test         - self-test suite for the
 *                                      jsdoc-hygiene-ts scanner; 13
 *                                      in-memory fixtures verifying
 *                                      detector correctness. Runs
 *                                      immediately before the scanner
 *                                      stage so AST-shape drift surfaces
 *                                      here, not as a silent zero-result
 *                                      downstream.
 *   5. jsdoc-hygiene-ts              - type-bearing JSDoc gate for .ts
 *                                      source under packages/superdoc/src.
 *                                      Companion to jsdoc-ratchet on the
 *                                      .ts side: enforces TS syntax as
 *                                      the single source of truth for
 *                                      shape. Strict-zero gate (no
 *                                      grandfathered baseline); fails
 *                                      on any type-bearing JSDoc. See
 *                                      packages/superdoc/scripts/type-hygiene.md.
 *   6. public-method-coverage        - strict-zero obligation gate over
 *                                      public SuperDoc methods +
 *                                      getters. For each member the
 *                                      AST computes which obligations
 *                                      are meaningful (parameters /
 *                                      returns / call); the gate fails
 *                                      on any unmet obligation. The
 *                                      only escape hatch is the
 *                                      public-method-coverage-allowlist
 *                                      (intentionally non-consumer-
 *                                      callable members). Call sites
 *                                      do NOT satisfy parameters/
 *                                      returns obligations on their own
 *                                      — that's why `search(text: string)`
 *                                      shipped under v1 of this gate.
 *   7. font-license-gate             - verifies every bundled WOFF2 has a
 *                                      legal manifest row, license notice,
 *                                      stable hash, and runtime manifest entry.
 *                                      Fails before the package build if a
 *                                      new bundled font lacks notices.
 *   8. build                         - vite build + the postbuild
 *                                      validator chain
 *                                      (check-tsconfig-type-surface,
 *                                      ensure-types, audit-bundle,
 *                                      audit-declarations,
 *                                      check-export-coverage,
 *                                      verify-public-facade-emit,
 *                                      report-declaration-reachability).
 *                                      Skipped when `--skip-build` is
 *                                      passed (CI calls `pnpm run build`
 *                                      separately in its own step).
 *   9. consumer-typecheck-matrix     - packs superdoc, or reuses the
 *                                      CI-built tarball, then installs it into
 *                                      tests/consumer-typecheck/
 *                                      node_modules/, then runs every
 *                                      consumer scenario.
 *  10. deep-type-audit-supported-root - strict gate on the supported-
 *                                      root public surface; fails on any
 *                                      `any` leak. Reuses the install
 *                                      from stage 8.
 *  11. package-shape                 - publint + attw against the packed
 *                                      manifest. Reuses the tarball
 *                                      from stage 8.
 *  12. export-snapshots              - v2-only resolution absence gate plus
 *                                      supported root export inventory.
 *                                      Reuses the install.
 *  13. root-classification-closure   - no supported-root or legacy-root
 *                                      export references an internal-
 *                                      candidate type in its public
 *                                      declared shape (SD-3212 A1b).
 *
 * Why stage 8 runs before 9-12: stage 8 packs `superdoc.tgz` and
 * installs the tarball into the consumer fixture once. Stages 9, 11,
 * and 12 reuse the installed fixture; stage 10 reuses the packed tarball
 * directly. Without this ordering each downstream stage would `--pack`
 * separately and multiply the work.
 *
 * Local usage:
 *   pnpm check:public           (umbrella, runs SuperDoc + Document API)
 *   pnpm check:public:superdoc  (SuperDoc only, this script)
 *
 * CI usage (candidate build and tarball already restored):
 *   pnpm check:public:superdoc --skip-build
 *
 * SD-3256 Phase 1 (initial wrapper) / SD-673 Phase 1 (CI wiring).
 * Extended in the typecheck-wrapper consolidation PR to subsume the
 * package-shape / snapshots / closure steps that ci-superdoc.yml previously ran
 * separately.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const flags = new Set(process.argv.slice(2));
const skipBuild = flags.has('--skip-build');
const requirePreparedCandidate = process.env.SUPERDOC_V2_CI_REQUIRE_PREPARED === '1';
const consumerMatrixArgs = skipBuild && requirePreparedCandidate
  ? ['typecheck-matrix.mjs', '--use-existing-tarball']
  : ['typecheck-matrix.mjs'];

// Stage names below are display labels for logs only; the actual rerun
// command on failure is reconstructed from `cmd` + `args`. Renaming a
// `name` is purely cosmetic.
const stages = [
  {
    name: 'v2-only-source',
    cwd: REPO_ROOT,
    cmd: 'node',
    args: ['scripts/check-v2-only-source.mjs'],
    blurb:
      'v2-only source guard: fails when active public surfaces (apps, docs, ' +
      'examples, demos, packages/superdoc/src, build config) reference v1 ' +
      'super-editor (@superdoc/super-editor, Editor.open, SuperEditor, ' +
      'PresentationEditor, packages/super-editor, editors/v1, removed legacy ' +
      'superdoc/* subpaths). Cheapest gate; runs first so v1 reintroduction ' +
      'fails in milliseconds before the build/matrix stages.',
  },
  {
    name: 'contract-tiers-test',
    cwd: REPO_ROOT,
    cmd: 'node',
    args: ['--test', 'scripts/report-public-contract.test.mjs'],
    blurb:
      'Unit tests for the pure tier validator. Cheap (~50ms); verifies ' +
      'the validator catches every failure class before the next stage ' +
      'trusts its verdict.',
  },
  {
    name: 'contract-tiers',
    cwd: REPO_ROOT,
    cmd: 'node',
    args: ['scripts/report-public-contract.mjs', '--check'],
    blurb:
      'Public-contract tier discipline: package.json#exports vs publicContract ' +
      '(tier coverage, routing, legacy-raw allowlist). Cheap; fast-fails before ' +
      'the slow build/matrix stages.',
  },
  {
    name: 'jsdoc-ratchet',
    cwd: REPO_ROOT,
    cmd: 'pnpm',
    args: ['--filter', 'superdoc', 'run', 'check:jsdoc'],
    blurb:
      'Per-file checkJs gate for the 6 hand-curated CHECKED_FILES + ratchet that ' +
      'fails when new public-reachable JSDoc files land without // @ts-check. ' +
      'Cheap; runs before the slow build so JSDoc drift fails fast.',
  },
  {
    name: 'jsdoc-hygiene-ts-test',
    cwd: REPO_ROOT,
    cmd: 'node',
    args: ['packages/superdoc/scripts/check-jsdoc-hygiene-ts-tests.cjs'],
    blurb:
      'Self-test suite for the jsdoc-hygiene-ts scanner. 13 in-memory ' +
      'fixtures verifying detector correctness across negative control, ' +
      'mixed-tag blocks, prose-vs-typed forms, and each tag class. ' +
      'Fast-fails before the scanner runs so AST-shape drift or detector ' +
      'logic bugs surface here rather than as silent zero-result ' +
      'false-passes downstream.',
  },
  {
    name: 'jsdoc-hygiene-ts',
    cwd: REPO_ROOT,
    cmd: 'node',
    args: ['packages/superdoc/scripts/check-jsdoc-hygiene-ts.cjs'],
    blurb:
      'Type-bearing JSDoc gate for .ts source under packages/superdoc/src. ' +
      'Strict-zero gate (no grandfathered baseline, ' +
      'no --write): fails on any type-bearing JSDoc tag (@param {T}, @returns {T}, ' +
      '@type, @typedef, @template, etc.). See packages/superdoc/scripts/' +
      'type-hygiene.md for the rule and fix patterns. Cheap; complements ' +
      'jsdoc-ratchet (which covers .js files) by enforcing TS-as-single-source ' +
      'on the .ts side.',
  },
  {
    name: 'public-method-coverage',
    cwd: REPO_ROOT,
    cmd: 'node',
    args: ['tests/consumer-typecheck/check-public-method-coverage.mjs'],
    blurb:
      'Strict-zero obligation gate over public SuperDoc methods + getters. ' +
      'Each member has computed obligations (parameters / returns / call) ' +
      'that must be satisfied by a typed assertion in a consumer fixture; ' +
      'the gate fails on any unmet obligation. Only escape hatch is the ' +
      'public-method-coverage-allowlist for intentionally non-consumer-callable ' +
      'members. Call sites do NOT satisfy parameters/returns on their own ' +
      '(this is why search(text: string) shipped).',
  },
  {
    name: 'font-license-gate',
    cwd: REPO_ROOT,
    cmd: 'pnpm',
    args: ['run', 'check:font-licenses'],
    blurb:
      'Bundled font compliance gate: every .woff2 under shared/font-system/assets ' +
      'must have an asset/legal manifest row, stable hash, matching runtime manifest ' +
      'entry, and required license notices. Fails before build if a new bundled font ' +
      'ships without legal metadata.',
  },
  {
    name: 'build',
    cwd: REPO_ROOT,
    cmd: 'pnpm',
    args: ['run', 'build:superdoc'],
    blurb:
      'Build dist + run postbuild validators (audit-bundle, audit-declarations, ' +
      'check-export-coverage, verify-public-facade-emit, ensure-types, ...).',
    skipIf: skipBuild,
    skipReason: '--skip-build passed; CI Build step already ran this',
  },
  {
    name: 'consumer-typecheck-matrix',
    cwd: resolve(REPO_ROOT, 'tests/consumer-typecheck'),
    cmd: 'node',
    args: consumerMatrixArgs,
    blurb:
      (skipBuild && requirePreparedCandidate
        ? 'Freshly installs the candidate tarball into the consumer fixture, '
        : 'Packs superdoc and installs the tarball into the consumer fixture, ') +
      'then runs every typecheck scenario.',
  },
  {
    name: 'collaboration-room-name-runtime',
    cwd: REPO_ROOT,
    cmd: 'node',
    args: ['--test', 'tests/consumer-typecheck/collaboration-room-name.test.ts'],
    blurb: 'Packed ESM and CommonJS room resolution works in a windowless host.',
  },
  {
    name: 'deep-type-audit-supported-root',
    cwd: resolve(REPO_ROOT, 'tests/consumer-typecheck'),
    cmd: 'node',
    args: ['deep-type-audit.mjs', '--strict-supported-root'],
    blurb:
      'Strict gate on the supported-root public surface (must be 0 findings). ' +
      'Reuses the install produced by consumer-typecheck-matrix.',
  },
  {
    name: 'package-shape',
    cwd: resolve(REPO_ROOT, 'tests/consumer-typecheck'),
    cmd: 'node',
    args: ['package-shape-gate.mjs'],
    blurb:
      'External npm-package linters (publint + attw) against the packed manifest. ' +
      'Reuses the tarball produced by consumer-typecheck-matrix (not the installed fixture).',
  },
  {
    name: 'export-snapshots',
    cwd: resolve(REPO_ROOT, 'tests/consumer-typecheck'),
    cmd: 'node',
    args: ['snapshot.mjs', '--all', '--check'],
    blurb:
      'v2-only package resolution gate plus supported root export inventory. ' +
      'Supported v2 imports must resolve; removed v1 package/subpath imports must fail.',
  },
  {
    name: 'root-classification-closure',
    cwd: resolve(REPO_ROOT, 'tests/consumer-typecheck'),
    cmd: 'node',
    args: ['check-root-classification-closure.mjs'],
    blurb:
      'Closure gate: no supported-root or legacy-root export references an ' +
      'internal-candidate type in its public declared shape (SD-3212 A1b).',
  },
];

const HR = '='.repeat(72);
const start = Date.now();

let failed = null;
let ranCount = 0;
for (const [i, s] of stages.entries()) {
  console.log('');
  console.log(HR);
  console.log(`[${i + 1}/${stages.length}] ${s.name}`);
  if (s.skipIf) {
    console.log(`SKIP: ${s.skipReason}`);
    console.log(HR);
    continue;
  }
  console.log(s.blurb);
  console.log(HR);
  const result = spawnSync(s.cmd, s.args, { cwd: s.cwd, stdio: 'inherit' });
  ranCount += 1;
  if (result.status !== 0) {
    failed = { stage: s.name, status: result.status ?? 1 };
    break;
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log('');
console.log(HR);
if (failed) {
  console.log(`FAIL: stage "${failed.stage}" exited ${failed.status} (after ${elapsed}s)`);
  console.log('');
  console.log('Re-run the failing stage directly to iterate:');
  const failedStage = stages.find((s) => s.name === failed.stage);
  console.log(`  cd ${failedStage.cwd}`);
  console.log(`  ${failedStage.cmd} ${failedStage.args.join(' ')}`);
  process.exit(failed.status);
} else {
  const skipped = stages.length - ranCount;
  const ranLabel = skipped > 0 ? `${ranCount} ran, ${skipped} skipped` : `${ranCount} stages`;
  console.log(`PASS: ${ranLabel}, ${elapsed}s`);
}
