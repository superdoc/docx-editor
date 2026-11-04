#!/usr/bin/env node
/*
 * check-private-core.cjs — v2-branch privacy guard.
 *
 * superdoc@2 consumes the internal v2 runtime through the stable
 * `@superdoc/docx-engine` dependency. This guard ensures implementation
 * packages never become public SuperDoc surfaces.
 *
 *   - dependencies / peerDependencies / optionalDependencies, except the
 *     documented engine dependency
 *   - exports / typesVersions subpaths
 *   - names inside emitted .d.ts declarations
 *   - unresolved bare import specifiers in emitted JS
 *
 * It inspects the built `dist/` plus `package.json`. Run after `build`.
 *
 * The guard also enforces the v2 branch package shape: customer artifacts must
 * not expose the v1 editor package, v1 editor paths, or v1-named emitted files.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PKG_DIR = path.resolve(__dirname, '..');
const { npmDistRoot: DIST } = require('./build-output-paths.cjs');
const SUPERDOC_ROOT = path.resolve(PKG_DIR, '..', '..', '..');
const V2_ROOT = path.join(SUPERDOC_ROOT, 'v2');

const DOCX_ENGINE_PACKAGE = '@superdoc/docx-engine';
const SOURCE_ENGINE_VERSION_RE = /^workspace:0\.\d+\.\d+(?:-next\.\d+)?$/;
const PUBLISHED_ENGINE_VERSION_RE = /^0\.\d+\.\d+(?:-next\.\d+)?$/;

// Internal implementation package names that must never become public surfaces.
const PRIVATE_V2_PACKAGES = [
  '@superdoc/v2', // legacy/retired root name retained for the privacy guard.
  '@superdoc/v2-host',
  '@superdoc/v2-browser-shell',
  '@superdoc/editor-core',
  '@superdoc/typed-core',
  '@superdoc/headless',
  '@superdoc/collaboration-upgrade',
  '@superdoc/collaboration-v2',
  '@superdoc/document-api-v2-adapter',
  '@superdoc/style-model',
  '@superdoc/v2-layout-adapter',
];

const PRIVATE_V2_PACKAGE_MANIFESTS = [
  'editor-core/package.json',
  'typed-core/package.json',
  'headless/package.json',
  'collaboration-upgrade/package.json',
  'collaboration-v2/package.json',
  'document-api-v2-adapter/package.json',
  'style-model/package.json',
  'v2-layout-adapter/package.json',
  'v2-host/package.json',
  'v2-browser-shell/package.json',
];

const V1_PACKAGE = '@superdoc/super-editor';
// NOTE: `./ui`, `./ui/react`, and `./ui/vue` are intentionally NOT forbidden.
// On v2 they are v2-native public exports (routing through
// `src/public/ui.ts` / `src/public/ui-react.ts` / `src/public/ui-vue.ts`),
// which import no v1 editor surface and no private v2 packages. The v1-artifact scan below still
// guarantees the emitted `ui` bundles/declarations contain no
// `@superdoc/super-editor` reference, so a regression to the v1 controller
// would fail this guard.
const V1_FORBIDDEN_SUBPATHS = [
  './super-editor',
  './types',
  './converter',
  './docx-zipper',
  './file-zipper',
  './headless-toolbar',
  './headless-toolbar/react',
  './headless-toolbar/vue',
];
const V1_ARTIFACT_PATTERNS = [
  { name: 'v1 package specifier', re: /@superdoc\/super-editor(?:\/[\w./-]*)?/g },
  { name: 'v1 editor source path', re: /(?:^|[/"'])editors\/v1(?:[/"']|$)/g },
];

const failures = [];
const fail = (msg) => failures.push(msg);

function isPrivateV2Specifier(spec) {
  return PRIVATE_V2_PACKAGES.some((name) => spec === name || spec.startsWith(`${name}/`));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// 1) package.json must not declare private v2 packages anywhere customers resolve.
function checkManifest() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
  const engineVersion = pkg.dependencies?.[DOCX_ENGINE_PACKAGE];
  const validSourceVersion = SOURCE_ENGINE_VERSION_RE.test(engineVersion ?? '');
  const validExportedVersion = !fs.existsSync(V2_ROOT) && PUBLISHED_ENGINE_VERSION_RE.test(engineVersion ?? '');
  if (!validSourceVersion && !validExportedVersion) {
    fail(
      `package.json#dependencies must pin ${DOCX_ENGINE_PACKAGE} as workspace:0.x in Orbit or exact 0.x in an exported checkout`,
    );
  }
  for (const field of ['peerDependencies', 'optionalDependencies', 'devDependencies']) {
    if (Object.prototype.hasOwnProperty.call(pkg[field] || {}, DOCX_ENGINE_PACKAGE)) {
      fail(`package.json#${field} must not declare ${DOCX_ENGINE_PACKAGE}; it is a runtime dependency`);
    }
  }
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[field] || {})) {
      if (isPrivateV2Specifier(name)) fail(`package.json#${field} declares private v2 package "${name}"`);
    }
  }
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[field] || {})) {
      if (name === V1_PACKAGE || name.startsWith(`${V1_PACKAGE}/`)) {
        fail(`package.json#${field} declares v1 editor package "${name}"`);
      }
    }
  }
  const walkStrings = (value, label) => {
    if (typeof value === 'string') {
      if (isPrivateV2Specifier(value)) fail(`package.json#${label} references private v2 package "${value}"`);
      if (value.includes(V1_PACKAGE) || value.includes('editors/v1')) {
        fail(`package.json#${label} references v1 editor surface "${value}"`);
      }
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (isPrivateV2Specifier(k)) fail(`package.json#${label} exposes private v2 subpath key "${k}"`);
        if (V1_FORBIDDEN_SUBPATHS.includes(k)) fail(`package.json#${label} exposes removed v1 subpath "${k}"`);
        walkStrings(v, `${label}.${k}`);
      }
    }
  };
  walkStrings(pkg.exports, 'exports');
  walkStrings(pkg.typesVersions, 'typesVersions');
}

function checkPrivateV2PackageManifests() {
  // Package-mode builds (public clone, release) do not require the private
  // `superdoc/v2` source tree as a sibling — the compiled v2 runtime is
  // consumed through the installed/dist `@superdoc/docx-engine` contract. Only enforce
  // the source-manifest privacy invariant when the v2 source tree is present
  // (Orbit local dev). The published-artifact privacy guarantee is enforced by
  // checkManifest()/checkDist() and the publish-artifact auditor regardless.
  if (!fs.existsSync(V2_ROOT)) {
    console.log(
      '[check-private-core] superdoc/v2 source absent (package mode) — skipping private-source manifest check',
    );
    return;
  }
  for (const rel of PRIVATE_V2_PACKAGE_MANIFESTS) {
    const manifestPath = path.join(V2_ROOT, rel);
    if (!fs.existsSync(manifestPath)) {
      fail(`private v2 package manifest missing: ${path.relative(SUPERDOC_ROOT, manifestPath)}`);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.private !== true) {
      fail(`private v2 package ${manifest.name || rel} must keep "private": true`);
    }
  }
}

// 2) emitted files must not reference private v2 names (.d.ts) or import them (JS).
function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]/g;

function checkDist() {
  if (!fs.existsSync(DIST)) {
    fail(`dist/ not found at ${DIST} — run "pnpm --filter superdoc run build" first`);
    return;
  }
  for (const file of walkFiles(DIST)) {
    if (file.endsWith('.map')) continue;
    const isDts = file.endsWith('.d.ts') || file.endsWith('.d.cts');
    const isJs = /\.(js|cjs|mjs)$/.test(file);
    if (!isDts && !isJs) continue;
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(DIST, file);
    if (/(^|[/\\])(?:super-editor|_shim-super-editor-ui)(?:[-./\\]|$)/.test(rel)) {
      fail(`dist artifact ${rel} uses a v1 editor name`);
    }
    const commentless = stripComments(src);
    for (const pattern of V1_ARTIFACT_PATTERNS) {
      const matches = commentless.match(pattern.re);
      if (matches && matches.length > 0) {
        fail(
          `${isDts ? 'declaration' : 'dist JS'} ${rel} references ${pattern.name}: ${matches.slice(0, 5).join(', ')}`,
        );
      }
    }
    if (isDts) {
      for (const name of PRIVATE_V2_PACKAGES) {
        if (src.includes(name)) fail(`declaration ${rel} references private v2 package "${name}"`);
      }
      continue;
    }
    let m;
    while ((m = IMPORT_RE.exec(src)) !== null) {
      if (isPrivateV2Specifier(m[1])) fail(`dist JS ${rel} has an unresolved private v2 import "${m[1]}"`);
    }
  }
}

checkManifest();
checkPrivateV2PackageManifests();
checkDist();

if (failures.length > 0) {
  console.error('[check-private-core] ✗ superdoc@2 package boundary violations:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `[check-private-core] ✓ v2 package boundary clean (${DOCX_ENGINE_PACKAGE} is the only engine dependency; ${PRIVATE_V2_PACKAGES.length} internal packages guarded; no v1 editor artifacts)`,
);
