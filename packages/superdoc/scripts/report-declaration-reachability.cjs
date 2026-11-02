#!/usr/bin/env node
/**
 * SD-2952 step 3: report how many emitted declaration files in the published
 * dist are actually reachable from a public consumer's type graph.
 *
 * Walks every `exports[*].types` target in `package.json` and follows
 * relative-import / self-package edges through the emitted declaration
 * forest, counting how many files a consumer's TypeScript would
 * actually parse vs how many are shipped. The output is data for the
 * SD-2952 trim-emitted-types slice (step 4).
 *
 * Exit status:
 *   - 1 on script bugs, missing dist, malformed package exports, or
 *     unreadable type entry files.
 *   - 1 when a declaration under a PRIVATE_DECLARATION_DIRECTORIES entry
 *     is reachable from a typed export.
 *   - Never on a low ratio; the ratio is a measurement, not a threshold.
 *
 * Walker semantics:
 *   - Resolves relative `from '../foo.js'` and `import('../foo.js')`
 *     specifiers to dist declaration siblings.
 *   - Resolves self-package `from 'superdoc/<subpath>'` through the
 *     package's own `exports` map.
 *   - Ignores external package specifiers (vue, @tiptap/*, etc.) - those
 *     don't live in dist.
 *   - Ignores private workspace specifiers (`@superdoc/*`); they're
 *     audited separately by `audit-declarations.cjs` Rule 1, and any
 *     surviving one in dist is already a build failure.
 */

const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const { npmDistRoot: distRoot, resolvePackageOutputPath } = require('./build-output-paths.cjs');

if (!fs.existsSync(distRoot)) {
  console.error('[report-declaration-reachability] dist/ not found; run the build first.');
  process.exit(1);
}

const packageJsonPath = path.join(packageRoot, 'package.json');
let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (err) {
  console.error(`[report-declaration-reachability] cannot read package.json: ${err.message}`);
  process.exit(1);
}

const packageName = packageJson.name;
const exportsMap = packageJson.exports || {};

function collectTypesTargets(value) {
  if (typeof value !== 'object' || value === null) return [];
  if (typeof value.types === 'string') return [value.types];
  if (typeof value.types !== 'object' || value.types === null) return [];
  return Object.values(value.types).filter((target) => typeof target === 'string');
}

// Build a self-package resolver: supported subpath → absolute path of the
// `types` target in dist. Used when an emitted declaration contains
// `from 'superdoc/subpath'`.
const selfPackageTypeMap = new Map();
for (const [subpath, value] of Object.entries(exportsMap)) {
  const [target] = collectTypesTargets(value);
  if (!target) continue;
  selfPackageTypeMap.set(subpath, resolvePackageOutputPath(target));
}

// Build the seed set: every typed exports entry, resolved to a dist path.
const typedExports = [];
for (const [subpath, value] of Object.entries(exportsMap)) {
  for (const targetPath of collectTypesTargets(value)) {
    const target = resolvePackageOutputPath(targetPath);
    if (!fs.existsSync(target)) {
      console.error(`[report-declaration-reachability] exports['${subpath}'].types target missing: ${targetPath}`);
      process.exit(1);
    }
    typedExports.push({ subpath, target });
  }
}

if (typedExports.length === 0) {
  console.error('[report-declaration-reachability] package.json has no typed exports; nothing to walk.');
  process.exit(1);
}

// Collect every declaration file shipped in dist.
function findDtsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findDtsFiles(full, acc);
    else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.cts')) acc.push(full);
  }
  return acc;
}
const allDtsFiles = findDtsFiles(distRoot);
const allDtsSet = new Set(allDtsFiles);

// Match `from '...'` (top-level imports + re-exports) and `import('...')`
// (type-position dynamic imports). Both contribute edges.
const SPECIFIER_RE = /(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g;

// Per-extension fallbacks the resolver tries when a relative specifier
// has no extension. TypeScript itself accepts a wider set; keep these
// minimal because the dist files we emit are declaration files (or directories
// containing `index.d.ts`).
function resolveRelative(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);
  // Spec already points at a declaration? unusual but support it.
  if ((base.endsWith('.d.ts') || base.endsWith('.d.cts')) && fs.existsSync(base)) return base;
  // `.js` specifier → swap to `.d.ts` / `.d.cts`.
  if (base.endsWith('.js')) {
    for (const ext of ['.d.ts', '.d.cts']) {
      const cand = base.slice(0, -3) + ext;
      if (fs.existsSync(cand)) return cand;
    }
  }
  // `.ts` specifier (rare in emitted dist after ensure-types) → declaration.
  if (base.endsWith('.ts')) {
    for (const ext of ['.d.ts', '.d.cts']) {
      const cand = base.slice(0, -3) + ext;
      if (fs.existsSync(cand)) return cand;
    }
  }
  // Bare directory → look for `<dir>/index.d.ts`.
  const indexCand = path.join(base, 'index.d.ts');
  if (fs.existsSync(indexCand)) return indexCand;
  // Plain `<base>.d.ts`.
  const dtsCand = `${base}.d.ts`;
  if (fs.existsSync(dtsCand)) return dtsCand;
  return null;
}

function resolveSelfPackage(spec) {
  // spec like `superdoc` or another supported package subpath.
  if (!spec.startsWith(packageName)) return null;
  const remainder = spec.slice(packageName.length);
  const subpath = remainder === '' ? '.' : `.${remainder}`;
  return selfPackageTypeMap.get(subpath) || null;
}

function resolveSpecifier(spec, fromFile) {
  if (spec.startsWith('.')) return resolveRelative(spec, fromFile);
  if (spec.startsWith(packageName)) return resolveSelfPackage(spec);
  // External package or private workspace specifier — not in dist tree.
  return null;
}

// BFS walk.
const visited = new Set();
const queue = typedExports.map((e) => e.target);
for (const start of queue) visited.add(start);

while (queue.length > 0) {
  const file = queue.shift();
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`[report-declaration-reachability] cannot read ${file}: ${err.message}`);
    process.exit(1);
  }
  for (const match of content.matchAll(SPECIFIER_RE)) {
    const resolved = resolveSpecifier(match[1], file);
    if (!resolved) continue;
    if (visited.has(resolved)) continue;
    visited.add(resolved);
    queue.push(resolved);
  }
}

const reachableInDist = [...visited].filter((f) => allDtsSet.has(f));

const PRIVATE_DECLARATION_DIRECTORIES = ['superdoc/src/stores/'];
const toDistPath = (file) => path.relative(distRoot, file).split(path.sep).join('/');
const reachablePrivate = reachableInDist
  .map(toDistPath)
  .filter((file) => PRIVATE_DECLARATION_DIRECTORIES.some((directory) => file.startsWith(directory)))
  .sort();
const total = allDtsFiles.length;
const reachable = reachableInDist.length;
const pct = total === 0 ? 0 : ((reachable / total) * 100).toFixed(1);

// Bucket reachable + total by top-level dist directory for the trim slice.
function bucket(file) {
  const rel = path.relative(distRoot, file).split(path.sep);
  return rel[0] || '<root>';
}
const totalsByBucket = new Map();
const reachableByBucket = new Map();
for (const f of allDtsFiles) totalsByBucket.set(bucket(f), (totalsByBucket.get(bucket(f)) || 0) + 1);
for (const f of reachableInDist) reachableByBucket.set(bucket(f), (reachableByBucket.get(bucket(f)) || 0) + 1);

console.log('[report-declaration-reachability] SD-2952 step 3: declaration reachability');
console.log('='.repeat(72));
console.log(`Reachable declarations: ${reachable} / ${total} (${pct}%) from ${typedExports.length} typed exports`);
console.log();
console.log('Per top-level dist bucket (reachable / total):');
const buckets = [...new Set([...totalsByBucket.keys(), ...reachableByBucket.keys()])].sort();
for (const b of buckets) {
  const r = reachableByBucket.get(b) || 0;
  const t = totalsByBucket.get(b) || 0;
  const bp = t === 0 ? '0.0' : ((r / t) * 100).toFixed(1);
  console.log(`  ${b.padEnd(20)} ${String(r).padStart(5)} / ${String(t).padStart(5)} (${bp}%)`);
}
console.log();

if (reachablePrivate.length > 0) {
  console.error(
    `[report-declaration-reachability] Private declarations are reachable from the published types (PRIVATE_DECLARATION_DIRECTORIES: ${PRIVATE_DECLARATION_DIRECTORIES.join(', ')}):`,
  );
  for (const file of reachablePrivate) console.error(`  ${file}`);
  process.exit(1);
}
console.log(`No declaration under ${PRIVATE_DECLARATION_DIRECTORIES.join(', ')} is reachable from the published types.`);
