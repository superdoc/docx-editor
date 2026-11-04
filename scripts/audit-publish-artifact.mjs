#!/usr/bin/env node
//
// audit-publish-artifact.mjs - shared publish-artifact auditor.
//
// One reusable gate for every SuperDoc publish surface: the public browser
// package tarball/dist, the browser CDN dir, the private `@superdoc/docx-engine`
// dist/dist-cdn, CLI dist/stage dirs, the Node SDK tarball, and Python wheels.
//
// The goal of the v2 publishing boundary is narrow and explicit:
//   - compiled / browser-delivered v2 code IS allowed in published artifacts;
//   - private *source* (raw .ts/.tsx/.vue, private v2 source paths, source
//     export conditions) is NOT;
//   - source maps are NEVER allowed in published artifacts.
//
// This module exposes a programmatic API (`auditDirectory`, `auditTarball`,
// `auditWheel`, `assertArtifactClean`) plus a CLI so package/build/release
// scripts can fail closed before anything is published.
//
// Important nuance (from the accepted plan): do NOT globally ban every path
// containing `src/`. Public declaration output legitimately lives under paths
// like `dist/superdoc/src/public/index.d.ts`. The strict bans target source
// maps, raw source files, and PRIVATE v2 source-path markers only.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Detection rules ---------------------------------------------------------

const SOURCE_MAPPING_URL_RE = /[#@]\s*sourceMappingURL\s*=/;

// Private v2 source-path markers. These are path fragments that only appear if
// raw private v2 source (or a source-resolving alias) leaked into an artifact.
// Each is specific enough not to collide with public `dist/**/src/**` outputs.
export const PRIVATE_SOURCE_PATH_MARKERS = [
  '../v2/src',
  '/v2/src/',
  'v2-browser-shell/src',
  'editor-core/src',
  'typed-core/src',
  'collaboration-upgrade/src',
  'collaboration-v2/src',
  'document-api-v2-adapter/src',
  'style-model/src',
  'v2-layout-adapter/src',
  'v2-host/src',
];

// Private implementation package specifiers that must never survive as an
// unresolved bare import in published JS, nor be named in published .d.ts.
const PRIVATE_IMPL_PACKAGES = [
  '@superdoc/v2-browser-shell',
  '@superdoc/editor-core',
  '@superdoc/typed-core',
  '@superdoc/collaboration-upgrade',
  '@superdoc/collaboration-v2',
  '@superdoc/document-api-v2-adapter',
  '@superdoc/style-model',
  '@superdoc/v2-layout-adapter',
  '@superdoc/v2-host',
  '@superdoc/headless',
];

// Text file extensions whose contents we scan for sourceMappingURL / markers.
const TEXT_SCAN_RE = /\.(?:[cm]?jsx?|[cm]?tsx?|d\.[cm]?ts|css|json|map)$/;
const IMPORT_RE = /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function isRawSourceEntry(relPath) {
  if (relPath.endsWith('.d.ts') || relPath.endsWith('.d.cts') || relPath.endsWith('.d.mts')) {
    return false;
  }
  return /\.(?:[cm]?tsx?|vue)$/.test(relPath);
}

function isMapEntry(relPath) {
  return relPath.endsWith('.map');
}

function stripJsComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Local absolute-path markers (developer machine / CI workspace). These should
// never be embedded in a published artifact and usually signal a leaked source
// map content or an un-rewritten alias.
export const ABSOLUTE_PATH_MARKERS = [
  /\/Users\/[^/"'\s]+\//,
  /\/home\/[^/"'\s]+\//,
  // Both a literal Windows path (C:\Users\...) and one that has been escaped
  // into a JS or JSON string (C:\\Users\\...). The pattern previously required
  // two literal backslashes, so it matched only the escaped form and let a real
  // path through.
  /[A-Za-z]:\\{1,2}Users\\{1,2}/,
  /\/private\/var\/folders\//,
];

const BINARY_ABSOLUTE_PATH_RES = [
  /\/Users\/[^/\s"'\x00]+(?:\/[^\s"'\x00]*)?/g,
  /\/home\/[^/\s"'\x00]+(?:\/[^\s"'\x00]*)?/g,
];
const BINARY_ALLOWED_ABSOLUTE_PATH_PREFIXES = [
  // Bun native binaries embed WebKit/JSC build paths from Bun's own release
  // build. These are toolchain metadata, not local source paths from this repo.
  '/Users/runner/work/_temp/webkit-release/',
  '/Users/administrator/Library/Services/buildkite-agent/builds/bun-release/',
  '/Users/administrator/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/',
  '/usr/local/etc/buildkite-agent/builds/darwin-x64-mini-2-1/bun/bun/',
];
const BINARY_ALLOWED_ABSOLUTE_PATH_RES = [
  /^\/Users\/administrator\/Library\/Services\/buildkite-agent\/builds\/darwin-(?:aarch64|x64)(?:-[a-z0-9]+)+\/bun\/bun\//,
];

function isAllowedBinaryAbsolutePath(candidate) {
  return (
    BINARY_ALLOWED_ABSOLUTE_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)) ||
    BINARY_ALLOWED_ABSOLUTE_PATH_RES.some((re) => re.test(candidate))
  );
}

function shouldScanBinaryEntry(relPath) {
  const basename = path.basename(relPath).toLowerCase();
  return basename === 'superdoc' || basename === 'superdoc.exe' || /(?:^|\/)bin\/[^/]+$/.test(relPath);
}

function scanBinaryContent(relPath, content) {
  const body = Buffer.isBuffer(content) ? content.toString('latin1') : String(content);
  const violations = [];
  const offenders = new Set();

  for (const marker of PRIVATE_SOURCE_PATH_MARKERS) {
    if (body.includes(marker)) offenders.add(marker);
  }
  for (const re of BINARY_ABSOLUTE_PATH_RES) {
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const matchedPath = m[0];
      if (isAllowedBinaryAbsolutePath(matchedPath)) continue;
      offenders.add(matchedPath);
    }
  }

  for (const offender of offenders) {
    if (PRIVATE_SOURCE_PATH_MARKERS.includes(offender)) {
      violations.push(`${relPath}: native binary embeds private v2 source-path marker "${offender}"`);
    } else {
      violations.push(`${relPath}: native binary embeds local absolute filesystem path "${offender}"`);
    }
  }
  return violations;
}

/**
 * Inspect one text entry's content and collect violations.
 *
 * @param {string} relPath relative entry path (for messages)
 * @param {string} content file contents
 * @param {object} opts
 * @returns {string[]} violation messages
 */
function scanTextContent(relPath, content, opts) {
  const violations = [];
  const isDeclaration = /\.d\.[cm]?ts$/.test(relPath);
  const isManifest = path.basename(relPath) === 'package.json';

  if (SOURCE_MAPPING_URL_RE.test(content)) {
    violations.push(`${relPath}: contains a sourceMappingURL reference`);
  }

  // Path markers / private package names. For JS we strip comments first so a
  // descriptive comment does not trip the gate; declarations are scanned raw
  // (they should never contain these regardless).
  const scanBody = isDeclaration ? content : stripJsComments(content);
  for (const marker of PRIVATE_SOURCE_PATH_MARKERS) {
    if (scanBody.includes(marker)) {
      violations.push(`${relPath}: contains private v2 source-path marker "${marker}"`);
    }
  }
  for (const marker of ABSOLUTE_PATH_MARKERS) {
    if (marker.test(scanBody)) {
      violations.push(`${relPath}: embeds a local absolute filesystem path`);
      break;
    }
  }

  // The private `@superdoc/docx-engine` package legitimately imports its own bundled
  // implementation packages (e.g. `@superdoc/editor-core` resolved via
  // bundledDependencies). The public superdoc/CLI/SDK artifacts must NOT - for
  // those, an unresolved private import is a leak. `allowPrivateImplImports`
  // scopes that distinction.
  if (!opts.allowPrivateImplImports) {
    if (isDeclaration) {
      for (const name of PRIVATE_IMPL_PACKAGES) {
        if (content.includes(name)) {
          violations.push(`${relPath}: declaration references private implementation package "${name}"`);
        }
      }
    } else if (!isManifest && /\.[cm]?jsx?$/.test(relPath)) {
      let m;
      IMPORT_RE.lastIndex = 0;
      while ((m = IMPORT_RE.exec(scanBody)) !== null) {
        const spec = m[1];
        for (const name of PRIVATE_IMPL_PACKAGES) {
          if (spec === name || spec.startsWith(`${name}/`)) {
            violations.push(`${relPath}: unresolved private implementation import "${spec}"`);
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Validate a packed package.json manifest: no workspace:/file: deps, no source
 * export conditions, not private.
 *
 * @param {string} relPath
 * @param {string} content raw package.json text
 * @returns {string[]}
 */
function scanManifest(relPath, content) {
  const violations = [];
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    return [`${relPath}: manifest is not valid JSON (${error.message})`];
  }

  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = manifest[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && (spec.startsWith('workspace:') || spec.startsWith('file:'))) {
        violations.push(`${relPath}: ${section}.${name} uses local spec "${spec}"`);
      }
    }
  }

  const visitExport = (value, parts) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => visitExport(item, [...parts, String(i)]));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'source') {
        violations.push(`${relPath}: exports.${[...parts, key].join('.')} uses a "source" export condition`);
        continue;
      }
      visitExport(nested, [...parts, key]);
    }
  };
  if (manifest.exports) visitExport(manifest.exports, []);

  return violations;
}

/**
 * @typedef {object} AuditOptions
 * @property {string} [label] human label for messages
 * @property {boolean} [allowMaps] permit *.map entries (default false)
 * @property {boolean} [allowPrivateImplImports] permit imports/declarations of
 *   private implementation packages (only for the private `@superdoc/docx-engine`
 *   surface, which bundles them; never for public artifacts) (default false)
 * @property {(relPath: string) => boolean} [ignore] skip entries matching this
 */

function shouldIgnore(relPath, opts) {
  if (typeof opts.ignore === 'function' && opts.ignore(relPath)) return true;
  return false;
}

/**
 * Audit a list of {relPath, getContent} entries.
 *
 * @param {Array<{ relPath: string, getContent: () => string | Buffer }>} entries
 * @param {AuditOptions} opts
 * @returns {{ ok: boolean, violations: string[] }}
 */
function auditEntries(entries, opts = {}) {
  const violations = [];
  for (const entry of entries) {
    const relPath = entry.relPath.split(path.sep).join('/');
    if (shouldIgnore(relPath, opts)) continue;

    if (isMapEntry(relPath) && !opts.allowMaps) {
      violations.push(`${relPath}: source map files are not allowed in published artifacts`);
      continue;
    }
    if (isRawSourceEntry(relPath)) {
      violations.push(`${relPath}: raw source file (.ts/.tsx/.mts/.cts/.vue) is not allowed in published artifacts`);
      continue;
    }
    const shouldTextScan = TEXT_SCAN_RE.test(relPath);
    if (!shouldTextScan && !shouldScanBinaryEntry(relPath)) continue;

    let content;
    try {
      content = entry.getContent();
    } catch {
      continue; // unreadable; nothing scannable here
    }
    if (!shouldTextScan) {
      violations.push(...scanBinaryContent(relPath, content));
      continue;
    }
    if (path.basename(relPath) === 'package.json') {
      violations.push(...scanManifest(relPath, content));
    }
    violations.push(...scanTextContent(relPath, content, opts));
  }
  return { ok: violations.length === 0, violations };
}

function walkDir(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() || statSync(abs).isFile()) out.push(abs);
    }
  };
  walk(rootDir);
  return out;
}

/**
 * Audit a directory tree (dist/, dist-cdn/, staged package dir, etc.).
 * @param {string} dir
 * @param {AuditOptions} opts
 */
export function auditDirectory(dir, opts = {}) {
  if (!existsSync(dir)) {
    return { ok: false, violations: [`${opts.label ?? dir}: directory does not exist`] };
  }
  const files = walkDir(dir);
  const entries = files.map((abs) => ({
    relPath: path.relative(dir, abs),
    getContent: () => {
      const relPath = path.relative(dir, abs).split(path.sep).join('/');
      return TEXT_SCAN_RE.test(relPath) ? readFileSync(abs, 'utf8') : readFileSync(abs);
    },
  }));
  return auditEntries(entries, opts);
}

/**
 * Audit a native binary file directly.
 * @param {string} binaryPath
 * @param {AuditOptions} opts
 */
export function auditNativeBinary(binaryPath, opts = {}) {
  if (!existsSync(binaryPath)) {
    return { ok: false, violations: [`${opts.label ?? binaryPath}: native binary does not exist`] };
  }
  const relPath = opts.label ?? path.basename(binaryPath);
  const violations = scanBinaryContent(relPath, readFileSync(binaryPath));
  return { ok: violations.length === 0, violations };
}

/**
 * Audit a native binary file directly and THROW on violations.
 * @param {string} binaryPath
 * @param {AuditOptions} opts
 */
export function assertNativeBinaryClean(binaryPath, opts = {}) {
  const result = auditNativeBinary(binaryPath, opts);
  const label = opts.label ?? binaryPath;
  if (!result.ok) {
    const detail = result.violations.map((v) => `  - ${v}`).join('\n');
    throw new Error(`[audit-publish-artifact] FAIL ${label} failed native-binary audit:\n${detail}`);
  }
  return result;
}

function listTarballEntries(tarballPath) {
  return execFileSync('tar', ['-tf', tarballPath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function readTarballEntry(tarballPath, entry) {
  return execFileSync('tar', ['-xOf', tarballPath, entry], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Audit an npm tarball (.tgz). npm tarballs nest everything under `package/`.
 * @param {string} tarballPath
 * @param {AuditOptions} opts
 */
export function auditTarball(tarballPath, opts = {}) {
  if (!existsSync(tarballPath)) {
    return { ok: false, violations: [`${opts.label ?? tarballPath}: tarball does not exist`] };
  }
  const rawEntries = listTarballEntries(tarballPath).filter((e) => !e.endsWith('/'));
  const entries = rawEntries.map((entry) => ({
    relPath: entry.replace(/^package\//, ''),
    getContent: () => readTarballEntry(tarballPath, entry),
  }));
  return auditEntries(entries, opts);
}

function listWheelEntries(wheelPath) {
  // `unzip -Z1` lists archive members one per line.
  return execFileSync('unzip', ['-Z1', wheelPath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function readWheelEntry(wheelPath, entry) {
  return execFileSync('unzip', ['-p', wheelPath, entry], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Audit a Python wheel (.whl, a zip archive). Python sources (.py) are the
 * legitimate payload, so raw-source banning is scoped to TS/Vue only (already
 * the case). Maps, sourceMappingURL, and private v2 path markers are still
 * rejected - these would only appear if a bundled JS/CLI artifact leaked them.
 * @param {string} wheelPath
 * @param {AuditOptions} opts
 */
export function auditWheel(wheelPath, opts = {}) {
  if (!existsSync(wheelPath)) {
    return { ok: false, violations: [`${opts.label ?? wheelPath}: wheel does not exist`] };
  }
  const entries = listWheelEntries(wheelPath)
    .filter((e) => !e.endsWith('/'))
    .map((entry) => ({
      relPath: entry,
      getContent: () => readWheelEntry(wheelPath, entry),
    }));
  return auditEntries(entries, opts);
}

/**
 * Run the appropriate audit for a path (dir, .tgz, or .whl) and THROW on any
 * violation. Use this from build/pack/release scripts to fail closed.
 *
 * @param {string} target
 * @param {AuditOptions} opts
 */
export function assertArtifactClean(target, opts = {}) {
  const result = auditArtifact(target, opts);
  const label = opts.label ?? target;
  if (!result.ok) {
    const detail = result.violations.map((v) => `  - ${v}`).join('\n');
    throw new Error(`[audit-publish-artifact] FAIL ${label} failed publish-artifact audit:\n${detail}`);
  }
  return result;
}

export function auditArtifact(target, opts = {}) {
  if (target.endsWith('.tgz') || target.endsWith('.tar.gz')) return auditTarball(target, opts);
  if (target.endsWith('.whl')) return auditWheel(target, opts);
  return auditDirectory(target, opts);
}

const DOCX_ENGINE_PACKAGE = '@superdoc/docx-engine';
const EXACT_ENGINE_VERSION_RE = /^0\.\d+\.\d+(?:-next\.\d+)?$/;
const EXACT_ENGINE_SPECIFIER_RE = /["']@superdoc\/docx-engine["']/u;
const ENGINE_BANNER_MARKERS = [
  ['version banner', /DOCX Engine v\d+\.\d+\.\d+/u],
  ['license title', /DOCX Engine \S+ License Agreement/u],
  ['license filename', /DOCX-ENGINE-LICENSE\.md/u],
];
const ENGINE_WORKER_RE = /^(?:browser|dom|collaboration)-worker-entry-[A-Za-z0-9_-]+\.js$/;

function superdocArtifact(target) {
  if (target.endsWith('.tgz') || target.endsWith('.tar.gz')) {
    const rawEntries = listTarballEntries(target).filter((entry) => !entry.endsWith('/'));
    const entries = rawEntries.map((entry) => entry.replace(/^package\//, ''));
    const sourceByEntry = new Map(rawEntries.map((entry, index) => [entries[index], entry]));
    return {
      entries,
      read: (entry) => readTarballEntry(target, sourceByEntry.get(entry)),
      tarball: true,
    };
  }
  if (!existsSync(target)) return { entries: [], read: () => '', tarball: false };
  const files = walkDir(target);
  const byEntry = new Map(files.map((file) => [path.relative(target, file).split(path.sep).join('/'), file]));
  return {
    entries: [...byEntry.keys()],
    read: (entry) => readFileSync(byEntry.get(entry), 'utf8'),
    tarball: false,
  };
}

export function auditSuperdocPackageArtifact(target, opts = {}) {
  const base = auditArtifact(target, opts);
  const artifact = superdocArtifact(target);
  const entries = new Set(artifact.entries);
  const violations = [...base.violations];
  const distPrefix = artifact.tarball ? 'dist/' : '';

  if (artifact.tarball) {
    for (const required of ['LICENSE', 'NOTICE', 'README.md', 'package.json']) {
      if (!entries.has(required)) violations.push(`missing SuperDoc package file ${required}`);
    }
    for (const forbidden of [
      'DOCX-ENGINE-LICENSE.md',
      'THIRD_PARTY_NOTICES',
      'build/license-banner.txt',
      'scripts/verify-package.mjs',
    ]) {
      if (entries.has(forbidden)) violations.push(`${forbidden} belongs to the separate DOCX Engine package`);
    }
    if (entries.has('package.json')) {
      const manifest = JSON.parse(artifact.read('package.json'));
      if (manifest.license !== 'AGPL-3.0') violations.push('package.json must keep license AGPL-3.0');
      const engineVersion = manifest.dependencies?.[DOCX_ENGINE_PACKAGE];
      if (!EXACT_ENGINE_VERSION_RE.test(engineVersion ?? '')) {
        violations.push(`package.json dependencies.${DOCX_ENGINE_PACKAGE} must be an exact 0.x version`);
      }
      for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        if (Object.prototype.hasOwnProperty.call(manifest[section] ?? {}, 'rollup-plugin-copy')) {
          violations.push(`package.json ${section}.rollup-plugin-copy is build-only and must not be published`);
        }
      }
    }
  }

  const jsEntries = artifact.entries.filter((entry) => /\.[cm]?js$/.test(entry));
  for (const entry of jsEntries) {
    const source = artifact.read(entry);
    for (const [label, marker] of ENGINE_BANNER_MARKERS) {
      if (marker.test(source)) violations.push(`${entry} contains DOCX Engine package ${label}`);
    }
  }

  for (const entry of artifact.entries) {
    if (ENGINE_WORKER_RE.test(path.basename(entry))) violations.push(`${entry} is a DOCX Engine worker asset`);
  }

  const esmEntry = `${distPrefix}superdoc.es.js`;
  const cjsEntry = `${distPrefix}superdoc.cjs`;
  if (!entries.has(esmEntry)) violations.push(`missing SuperDoc ESM entry ${esmEntry}`);
  if (!entries.has(cjsEntry)) violations.push(`missing SuperDoc CJS entry ${cjsEntry}`);
  const esmGraph = [...entries].filter((entry) => entry.endsWith('.es.js'));
  const cjsGraph = [...entries].filter((entry) => entry.endsWith('.cjs'));
  if (!esmGraph.some((entry) => EXACT_ENGINE_SPECIFIER_RE.test(artifact.read(entry)))) {
    violations.push('SuperDoc ESM output must import the separate DOCX Engine package');
  }
  if (!cjsGraph.some((entry) => EXACT_ENGINE_SPECIFIER_RE.test(artifact.read(entry)))) {
    violations.push('SuperDoc CJS output must import the separate DOCX Engine package');
  }

  const iifeEntry = `${distPrefix}superdoc.min.js`;
  if (entries.has(iifeEntry)) violations.push(`${iifeEntry} is a CDN artifact and must not ship in the npm package`);

  const styleEntry = `${distPrefix}style.css`;
  if (!entries.has(styleEntry)) violations.push(`missing SuperDoc stylesheet ${styleEntry}`);
  else {
    const styles = artifact.read(styleEntry);
    if (!styles.includes('@superdoc/docx-engine/style.css')) {
      violations.push(`${styleEntry} must reference the separate DOCX Engine stylesheet`);
    }
    if (styles.includes('v2-document-loading-overlay')) {
      violations.push(`${styleEntry} contains inlined DOCX Engine styles`);
    }
  }

  return { ok: violations.length === 0, violations };
}

// --- CLI ---------------------------------------------------------------------

function isCliEntry() {
  return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    process.stdout.write(
      [
        'audit-publish-artifact - fail closed on maps / private source leakage',
        '',
        'Usage:',
        '  node scripts/audit-publish-artifact.mjs <dir|tarball.tgz|wheel.whl> [more...] [--label NAME] [--superdoc]',
        '',
        'Rejects: *.map, sourceMappingURL, raw .ts/.tsx/.vue, private v2 source',
        'path markers, workspace:/file: deps, "source" export conditions, and',
        'unresolved private implementation imports in published JS.',
        '',
      ].join('\n'),
    );
    process.exit(args.length === 0 ? 1 : 0);
  }
  const allowPrivateImplImports = args.includes('--allow-private-impl-imports');
  const allowMaps = args.includes('--allow-maps');
  const superdocPackage = args.includes('--superdoc');
  const flagless = args.filter(
    (a) => a !== '--allow-private-impl-imports' && a !== '--allow-maps' && a !== '--superdoc',
  );
  const labelIdx = flagless.indexOf('--label');
  let label;
  let targets = flagless;
  if (labelIdx >= 0) {
    label = flagless[labelIdx + 1];
    targets = flagless.filter((_, i) => i !== labelIdx && i !== labelIdx + 1);
  }
  let failed = false;
  for (const target of targets) {
    const result = superdocPackage
      ? auditSuperdocPackageArtifact(target, { label: label ?? target, allowPrivateImplImports, allowMaps })
      : auditArtifact(target, { label: label ?? target, allowPrivateImplImports, allowMaps });
    if (result.ok) {
      console.log(`[audit-publish-artifact] OK ${label ?? target} clean`);
    } else {
      failed = true;
      console.error(`[audit-publish-artifact] FAIL ${label ?? target}:`);
      for (const v of result.violations) console.error(`  - ${v}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
