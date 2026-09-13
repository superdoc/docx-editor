/**
 * SD-2864: single source of truth for the published superdoc type surface.
 *
 * The same taxonomy was previously duplicated across four files:
 *   - packages/superdoc/scripts/ensure-types.cjs
 *   - packages/superdoc/scripts/audit-declarations.cjs
 *   - packages/superdoc/vite.config.js
 *   - packages/superdoc/tsconfig.json
 *
 * Adding a new public-surface relocation required coordinated edits to all
 * four. PR #3144 (pm-adapter) and several SD-2893 stack PRs each shipped a
 * regression caused by drift between these lists. This config consolidates
 * the canonical data so each consumer derives what it needs from a single
 * place.
 *
 * Shape:
 *   - `requiredEntryPoints`: dist d.ts paths that must exist after build.
 *   - `handwrittenDtsBlocklist`: filenames in source that must NOT be
 *     copied into dist (internal-only ambient declarations).
 *   - `relocations`: workspace packages whose types appear on the public
 *     surface. Each entry pairs the rewriter rule with the source paths
 *     vite-plugin-dts and tsconfig.json need to include for the
 *     declarations to be emitted into superdoc/dist.
 *   - `sharedCommonDtsTargets`: filenames in `shared/common/` that the
 *     postbuild step compiles via tsc. Used for relocations whose source
 *     lives outside `packages/` and would otherwise shift the
 *     vite-plugin-dts common-ancestor.
 *   - `relocationGuardPackages`: packages that must never appear as a
 *     `declare module` block in `_internal-shims.d.ts` (audit Rule 3).
 *     SD-2942 removed the shim mechanism; this list is kept as defense
 *     against stale tarballs and future re-introduction.
 *   - `unshimmedPrivateSpecifiers`: bare specifiers that, if a future
 *     mechanism re-introduces shim generation, must not be auto-shimmed.
 *     They should fail audit Rule 1 instead.
 *   - `rule1Allowlist`: bare `@superdoc/*` specifiers permitted in
 *     published d.ts. Empty for the v2 public package surface.
 *   - `publicContract`: SD-3256 Phase 2. Tier metadata for every
 *     `package.json#exports` subpath. Describes what each subpath is
 *     (supported / asset / deprecated), not yet enforced.
 *     `scripts/report-public-contract.mjs` prints this for review.
 *
 * Adding a new relocation: append one entry to `relocations` with the
 * package specifier, the dist target the rewriter should point at, and
 * the source-include patterns vite + tsconfig need. Every consumer picks
 * up the new entry without further edits.
 *
 * Adding a new public subpath: append an entry to `publicContract` with
 * the correct tier. Keep it in sync with `package.json#exports`.
 */

const requiredEntryPoints = [
  'superdoc/src/index.d.ts',
  'superdoc/src/index.d.cts',
  // v2-native public UI facade entries (`./ui`, `./ui/react`, `./ui/vue`).
  // Both the ESM `.d.ts` (emitted by vite-plugin-dts) and the CJS `.d.cts`
  // shim (emitted by ensure-types) must exist after build so the conditional
  // `types` targets resolve.
  'superdoc/src/public/ui.d.ts',
  'superdoc/src/public/ui.d.cts',
  'superdoc/src/public/ui-react.d.ts',
  'superdoc/src/public/ui-react.d.cts',
  'superdoc/src/public/ui-vue.d.ts',
  'superdoc/src/public/ui-vue.d.cts',
  'superdoc/src/public/collaboration-upgrade-engine.d.ts',
  'superdoc/src/public/collaboration-upgrade-engine.d.cts',
  'superdoc/src/public/collaboration-worker.d.ts',
  'superdoc/src/public/collaboration-worker.d.cts',
];

/**
 * Foundational source roots tsconfig.json must include but `relocations`
 * does not own. These are the public-package sources themselves
 * (`superdoc/src`, `document-api/src`), distinct from the workspace-internal
 * packages relocated via `relocations`. The
 * tsconfig parity check expects exactly this base set plus the union of
 * `relocations[*].tsconfigIncludes`.
 */
const baseTsconfigIncludes = ['src', '../document-api/src'];

const handwrittenDtsBlocklist = [
  // Ambient module declarations for internal converter subpaths. Nothing in
  // superdoc@2's shipped surface imports those subpaths, so the declarations
  // would only leak the bare specifiers into published d.ts.
  'converter-internal.d.ts',
];

/**
 * Each relocation describes a private workspace package whose types appear
 * on the public surface, plus the source patterns needed to emit those
 * declarations into superdoc/dist.
 *
 * - `pkg`: the bare specifier consumers' d.ts files reference.
 * - `distEntry`: the file path (relative to dist root) that the rewriter
 *   redirects bare specifiers to. Must be emitted by either vite-plugin-dts
 *   (full-glob include) or the postbuild tsc step (sharedCommonDtsTargets).
 * - `matchSubpaths`: when true, the rewriter also rewrites
 *   `pkg/<subpath>` → `distEntry` with `/index.js` swapped for `/<subpath>`.
 *   When false, only the exact `pkg` specifier is rewritten; subpaths
 *   fall through to audit Rule 1 (used for narrow relocations like
 *   pm-adapter where only specific subpaths are emitted).
 * - `viteIncludes`: glob/file patterns added to vite-plugin-dts's
 *   `include` array. Multiple entries are allowed when the relocation
 *   needs sibling files (e.g. style-engine/ooxml depends on cascade.ts).
 * - `tsconfigIncludes`: parallel paths added to tsconfig.json's
 *   `include` array. The check-tsconfig script verifies parity.
 */
const relocations = [
  {
    pkg: '@superdoc/contracts',
    distEntry: 'layout-engine/contracts/src/index.d.ts',
    matchSubpaths: true,
    viteIncludes: ['../layout-engine/contracts/src/**/*'],
    tsconfigIncludes: ['../layout-engine/contracts/src'],
  },
  {
    pkg: '@superdoc/dom-contract',
    distEntry: 'layout-engine/dom-contract/src/index.d.ts',
    matchSubpaths: true,
    viteIncludes: ['../layout-engine/dom-contract/src/**/*'],
    tsconfigIncludes: ['../layout-engine/dom-contract/src'],
  },
  {
    pkg: '@superdoc/layout-bridge',
    distEntry: 'layout-engine/layout-bridge/src/index.d.ts',
    matchSubpaths: true,
    viteIncludes: ['../layout-engine/layout-bridge/src/**/*'],
    tsconfigIncludes: ['../layout-engine/layout-bridge/src'],
  },
  {
    pkg: '@superdoc/layout-engine',
    distEntry: 'layout-engine/layout-engine/src/index.d.ts',
    matchSubpaths: true,
    viteIncludes: ['../layout-engine/layout-engine/src/**/*'],
    tsconfigIncludes: ['../layout-engine/layout-engine/src'],
  },
  {
    pkg: '@superdoc/painter-dom',
    distEntry: 'layout-engine/painters/dom/src/index.d.ts',
    matchSubpaths: true,
    viteIncludes: ['../layout-engine/painters/dom/src/**/*'],
    tsconfigIncludes: ['../layout-engine/painters/dom/src'],
  },
  // style-engine/ooxml: subpath-only. Includes the ooxml subtree plus the
  // sibling cascade.ts dependency it imports.
  {
    pkg: '@superdoc/style-engine/ooxml',
    distEntry: 'layout-engine/style-engine/src/ooxml/index.d.ts',
    matchSubpaths: false,
    viteIncludes: ['../layout-engine/style-engine/src/ooxml/**/*', '../layout-engine/style-engine/src/cascade.ts'],
    tsconfigIncludes: ['../layout-engine/style-engine/src/ooxml', '../layout-engine/style-engine/src/cascade.ts'],
  },
  // Layout/style declaration leaves reachable from the v2 root facade are
  // relocated into superdoc's dist tree so the package does not publish bare,
  // unpublished `@superdoc/*` specifiers.
  {
    pkg: '@superdoc/style-engine',
    distEntry: 'layout-engine/style-engine/src/index.d.ts',
    matchSubpaths: false,
    viteIncludes: ['../layout-engine/style-engine/src/**/*'],
    tsconfigIncludes: ['../layout-engine/style-engine/src'],
  },
  {
    pkg: '@superdoc/word-layout',
    distEntry: 'word-layout/src/index.d.ts',
    matchSubpaths: true,
    viteIncludes: ['../word-layout/src/**/*'],
    tsconfigIncludes: ['../word-layout/src'],
  },
  // common/list-marker-utils and common (bare): emitted via tsc-postbuild
  // (see sharedCommonDtsTargets) because the source lives in shared/, which
  // would shift the vite-plugin-dts common-ancestor if added to vite include.
  // Empty viteIncludes/tsconfigIncludes are deliberate: ensure-types.cjs's
  // tsc-postbuild step handles emit; no vite/tsconfig participation needed.
  {
    pkg: '@superdoc/common/list-marker-utils',
    distEntry: 'shared/common/list-marker-utils.d.ts',
    matchSubpaths: false,
    viteIncludes: [], // emitted via sharedCommonDtsTargets tsc-postbuild
    tsconfigIncludes: [],
  },
  {
    pkg: '@superdoc/common',
    distEntry: 'shared/common/comments-types.d.ts',
    matchSubpaths: false,
    viteIncludes: [], // emitted via sharedCommonDtsTargets tsc-postbuild
    tsconfigIncludes: [],
  },
  // Emit the leaf list-numbering module via tsc-postbuild like
  // list-marker-utils.
  {
    pkg: '@superdoc/common/list-numbering',
    distEntry: 'shared/common/list-numbering/index.d.ts',
    matchSubpaths: false,
    viteIncludes: [], // emitted via sharedCommonDtsTargets tsc-postbuild
    tsconfigIncludes: [],
  },
  // The font report types (FontResolutionRecord, FontLoadStatus, FontLoadSummary, ...)
  // surface on `superdoc.fonts` / `fonts-changed`. font-system lives in shared/ like
  // @superdoc/common, so it is emitted standalone via tsc-postbuild (ensure-types.cjs)
  // rather than vite includes, which would shift the dts common-ancestor.
  {
    pkg: '@superdoc/font-system',
    distEntry: 'shared/font-system/src/index.d.ts',
    matchSubpaths: true,
    viteIncludes: [], // emitted via the font-system tsc-postbuild in ensure-types
    tsconfigIncludes: [],
  },
];

/**
 * Filenames in `shared/common/` that the postbuild tsc step compiles into
 * `dist/shared/common/`. Each filename pairs with a `relocations` entry
 * whose `distEntry` lives at `shared/common/<filename without .ts>.d.ts`.
 */
const sharedCommonDtsTargets = [
  'list-marker-utils.ts',
  'layout-constants.ts', // dependency of list-marker-utils
  'comments-types.ts',
  'list-numbering/index.ts', // SD-3222: re-exported by the v1 layout-adapter's list-helpers
];

/**
 * Packages that must NEVER appear as a `declare module` entry in
 * `_internal-shims.d.ts`. After SD-2942 the shim file is no longer emitted,
 * so this list is a defense against stale tarballs and future
 * re-introduction. Mirrored automatically by ensure-types and audit.
 */
const relocationGuardPackages = [
  '@superdoc/document-api',
  '@superdoc/contracts',
  '@superdoc/dom-contract',
  '@superdoc/layout-bridge',
  '@superdoc/layout-engine',
  '@superdoc/painter-dom',
  '@superdoc/style-engine',
  '@superdoc/word-layout',
  '@superdoc/common',
  '@superdoc/common/list-marker-utils',
  '@superdoc/common/list-numbering',
];

/**
 * Bare specifiers that any future shim-generation mechanism must NOT
 * shim. They should fail audit Rule 1 instead. Used today only as
 * forward-compat documentation; the SD-2942 removal made shim
 * generation a no-op.
 */
const unshimmedPrivateSpecifiers = [
  '@superdoc/style-engine',
  '@superdoc/word-layout',
  '@superdoc/common/list-numbering',
];

/**
 * Bare `@superdoc/*` specifiers permitted in published d.ts beyond the
 * relocation rules. Empty for `superdoc@2`: removed v1 package surfaces are
 * no longer customer package surfaces.
 */
const rule1Allowlist = {};

/**
 * Tier metadata for every `package.json#exports` subpath. Describes what each
 * entry is, not what CI enforces.
 *
 * Tier policies (target end state, not all enforced today):
 *
 *   - `supported`: fully typed, no `any`, no accidental internals;
 *     supported-root strict gate hard-fails regressions. Routes
 *     through `src/public/**`.
 *   - `asset`: non-type asset (e.g. CSS). Not covered by the type
 *     contract.
 *   - `deprecated`: scheduled for removal. None today.
 *
 * The `internal` tier is implicit: anything not exported here is
 * internal and not part of the consumer promise.
 *
 * Sync rule: keep this list aligned with `package.json#exports`.
 * Adding a new export means adding an entry here too.
 *
 * Headless-toolbar migration posture (migration-only): the v1
 * `superdoc/headless-toolbar`, `superdoc/headless-toolbar/react`, and
 * `superdoc/headless-toolbar/vue` subpaths are intentionally NOT exported and
 * carry NO `deprecated`-tier entry here. Custom UI migrates to the canonical
 * `./ui` / `./ui/react` surfaces. Adding a headless-toolbar compatibility tier
 * is a reviewed package-contract change paired with the absence gates
 * (`tests/consumer-typecheck/snapshot/v2-only-resolution.mjs`,
 * `scripts/check-private-core.cjs`).
 */
const publicContract = {
  supported: [
    { subpath: '.', tier: 'supported', note: 'root facade; routes through src/public/index.ts' },
    { subpath: './ui', tier: 'supported', note: 'v2-native UI controller; routes through src/public/ui.ts' },
    {
      subpath: './ui/react',
      tier: 'supported',
      note: 'v2-native UI React bindings; routes through src/public/ui-react.ts',
    },
    {
      subpath: './ui/vue',
      tier: 'supported',
      note: 'v2-native UI Vue bindings; routes through src/public/ui-vue.ts',
    },
    {
      subpath: './collaboration-upgrade-engine',
      tier: 'supported',
      note: 'Node-only collaboration upgrade builder and validator; routes through src/public/collaboration-upgrade-engine.ts',
    },
    {
      subpath: './collaboration-worker',
      tier: 'supported',
      note: 'Browser worker bootstrap for customer collaboration provider adapters; routes through src/public/collaboration-worker.ts',
    },
  ],
  legacy: [],
  legacyRaw: [],
  asset: [
    { subpath: './style.css', tier: 'asset', note: 'CSS bundle; no types' },
    { subpath: './style.layered.css', tier: 'asset', note: 'Layered CSS bundle; no types' },
  ],
  deprecated: [],
};

module.exports = {
  requiredEntryPoints,
  handwrittenDtsBlocklist,
  baseTsconfigIncludes,
  relocations,
  sharedCommonDtsTargets,
  relocationGuardPackages,
  unshimmedPrivateSpecifiers,
  rule1Allowlist,
  publicContract,
};
