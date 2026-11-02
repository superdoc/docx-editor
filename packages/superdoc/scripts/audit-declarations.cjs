#!/usr/bin/env node
/**
 * Audit the published declaration surface for leaks the package boundary RFC
 * (SD-2829) classifies as forbidden. Walks every declaration file under `dist/`
 * and reports:
 *
 *  Rule 1 (FAIL in strict mode): private workspace specifier in an emitted
 *    declaration that is NOT in `RULE1_ALLOWLIST`. After SD-2942 there is no
 *    `_internal-shims.d.ts` fallback, so any unrelocated `@superdoc/*`
 *    specifier on the public surface fails the build instead of riding
 *    through silently as `any`. If the file is present (a stale dist from
 *    before SD-2942), its `declare module` entries still suppress Rule 1
 *    for backward compatibility.
 *
 *  Rule 2 (FAIL in strict mode): package-manager-internal paths.
 *    `node_modules/.pnpm/...` paths leak the local install layout into a
 *    declaration that consumers cannot resolve.
 *
 *  Rule 3 (FAIL in strict mode): a relocated package reappears in
 *    `_internal-shims.d.ts`. With SD-2942 the file is no longer emitted
 *    by the build, so this rule is a no-op in steady state — kept as a
 *    defense if a future change re-introduces the file or runs against
 *    a stale tarball.
 *
 *  Rule 4 (FAIL in strict mode): a `shared/common` specifier that does not
 *    end in `.js` and resolve to a declaration under `dist/shared/common/`.
 *    ensure-types rewrites each imported name to the file that declares it;
 *    anything left over is unresolvable for packed consumers.
 *
 *  Informational: the set of modules still declared in `_internal-shims.d.ts`
 *    when the file exists. After SD-2942 the file is not emitted, so this
 *    section is normally absent.
 *
 * Default mode is strict: findings exit non-zero so a regression cannot
 * ship silently. Pass `--informational` (or set
 * `SUPERDOC_AUDIT_INFORMATIONAL=1`) for an explicit opt-out when iterating
 * locally on a known leak before the fix is ready.
 */

const fs = require('node:fs');
const path = require('node:path');

// SD-2864: canonical taxonomy for the published type surface. The lists
// below previously duplicated data from ensure-types.cjs; both now derive
// from the same config so the two scripts cannot drift.
const typeSurface = require('./type-surface.config.cjs');

const { npmDistRoot: distRoot, isRelocatedSharedCommonSpecifier } = require('./build-output-paths.cjs');

// SD-2859: strict is the default. The audit fails the build on any
// FAIL-level finding so a regression in the published declaration
// surface cannot ship silently. Pass `--informational` (or set
// `SUPERDOC_AUDIT_INFORMATIONAL=1`) for an explicit opt-out — useful
// when iterating locally on a known leak before the fix is ready.
const isInformational =
  process.argv.includes('--informational') || process.env.SUPERDOC_AUDIT_INFORMATIONAL === '1';
const isStrict = !isInformational;

if (!fs.existsSync(distRoot)) {
  console.error(`[audit-declarations] dist/ not found at ${distRoot}; run the build first.`);
  process.exit(1);
}

// Packages that must NEVER appear as a `declare module` block in
// `_internal-shims.d.ts`. After SD-2942 the file is no longer emitted, so
// this list is a defense against stale tarballs and future re-introduction.
// Source: type-surface.config.cjs `relocationGuardPackages`.
const RELOCATION_GUARD_PACKAGES = typeSurface.relocationGuardPackages;

// Specifiers that may appear as bare imports in published d.ts files even
// though they are private workspace packages. Each entry has a documented
// reason; anything outside this allowlist is a real leak per Rule 1.
// Source: type-surface.config.cjs `rule1Allowlist`.
const RULE1_ALLOWLIST = typeSurface.rule1Allowlist;

function isRule1Allowed(specifier, shimmedSet) {
  if (RULE1_ALLOWLIST[specifier]) return true;
  if (shimmedSet.has(specifier)) return true;
  // Subpaths of allowlisted top-level packages are NOT auto-allowed.
  // Subpaths of shimmed modules also need their own shim entry, so do not
  // implicitly allow them here.
  return false;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectDtsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDtsFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.cts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const PRIVATE_SPECIFIER_RE = /['"](@superdoc\/[^'"]+)['"]/g;
const PNPM_PATH_RE = /['"]([^'"]*node_modules\/\.pnpm\/[^'"]+)['"]/g;
const SHIM_DECLARED_MODULE_RE = /declare module ['"]([^'"]+)['"]/g;
const SHARED_COMMON_SPECIFIER_RE = /(?:from\s*|import\(\s*)['"]([^'"]*shared\/common[^'"]*)['"]/g;

const privateSpecifierFindings = new Map(); // file -> Set<specifier>
const pnpmPathFindings = new Map(); // file -> Set<path>
const sharedCommonFindings = new Map();
const shimmedModules = new Set(); // module specifiers declared in the shim file

const internalShimsPath = path.join(distRoot, '_internal-shims.d.ts');
const internalShimsPresent = fs.existsSync(internalShimsPath);
if (internalShimsPresent) {
  const shimContent = fs.readFileSync(internalShimsPath, 'utf8');
  for (const match of shimContent.matchAll(SHIM_DECLARED_MODULE_RE)) {
    shimmedModules.add(match[1]);
  }
}

const dtsFiles = collectDtsFiles(distRoot);

for (const file of dtsFiles) {
  const rel = path.relative(distRoot, file);
  // The shim file itself is allowed to declare private modules; that is its
  // entire reason for existing. Counting its contents would double-report.
  if (rel === '_internal-shims.d.ts') continue;

  const content = fs.readFileSync(file, 'utf8');

  for (const match of content.matchAll(PRIVATE_SPECIFIER_RE)) {
    const specifier = match[1];
    if (isRule1Allowed(specifier, shimmedModules)) continue;
    if (!privateSpecifierFindings.has(rel)) {
      privateSpecifierFindings.set(rel, new Set());
    }
    privateSpecifierFindings.get(rel).add(specifier);
  }

  for (const match of content.matchAll(SHARED_COMMON_SPECIFIER_RE)) {
    const specifier = match[1];
    if (isRelocatedSharedCommonSpecifier(specifier, file)) continue;
    if (!sharedCommonFindings.has(rel)) {
      sharedCommonFindings.set(rel, new Set());
    }
    sharedCommonFindings.get(rel).add(specifier);
  }

  for (const match of content.matchAll(PNPM_PATH_RE)) {
    const fullPath = match[1];
    if (!pnpmPathFindings.has(rel)) {
      pnpmPathFindings.set(rel, new Set());
    }
    pnpmPathFindings.get(rel).add(fullPath);
  }
}

const totalPrivateFiles = privateSpecifierFindings.size;
const totalPrivateOccurrences = [...privateSpecifierFindings.values()].reduce(
  (sum, set) => sum + set.size,
  0,
);
const totalPnpmFiles = pnpmPathFindings.size;
const totalPnpmOccurrences = [...pnpmPathFindings.values()].reduce(
  (sum, set) => sum + set.size,
  0,
);

const relocatedInShim = RELOCATION_GUARD_PACKAGES.filter((pkg) =>
  [...shimmedModules].some((mod) => mod === pkg || mod.startsWith(pkg + '/')),
);

console.log('[audit-declarations] Declaration surface audit');
console.log('='.repeat(72));
console.log(`Scanned: ${dtsFiles.length} declaration files under ${path.relative(process.cwd(), distRoot)}/`);
console.log();

const violations = [];

// Rule 1: private workspace specifiers
if (totalPrivateFiles > 0) {
  violations.push('private-specifiers');
  console.log(`FAIL  Private @superdoc/* specifiers: ${totalPrivateFiles} files / ${totalPrivateOccurrences} occurrences`);
  const distinctSpecifiers = new Set();
  for (const set of privateSpecifierFindings.values()) {
    for (const s of set) distinctSpecifiers.add(s);
  }
  console.log(`      distinct: ${[...distinctSpecifiers].sort().join(', ')}`);
} else {
  console.log('OK    Private @superdoc/* specifiers: none');
}

// Rule 2: pnpm paths
if (totalPnpmFiles > 0) {
  violations.push('pnpm-paths');
  console.log(`FAIL  Package-manager-internal paths: ${totalPnpmFiles} files / ${totalPnpmOccurrences} occurrences`);
} else {
  console.log('OK    Package-manager-internal paths: none');
}

// Rule 3: relocated packages must not reappear in the shim file
if (relocatedInShim.length > 0) {
  violations.push('relocated-in-shim');
  console.log(`FAIL  Relocated packages reappeared in _internal-shims.d.ts: ${relocatedInShim.join(', ')}`);
  console.log('      These packages have dedicated relocation rules in ensure-types.cjs and must not fall back to ambient any shims.');
} else {
  console.log(`OK    Relocated packages do not appear in shim file (${RELOCATION_GUARD_PACKAGES.length} guarded)`);
}

if (sharedCommonFindings.size > 0) {
  violations.push('unrelocated-shared-common');
  console.log(`FAIL  Unrelocated shared/common specifiers: ${sharedCommonFindings.size} files`);
  for (const [file, specifiers] of [...sharedCommonFindings].sort()) {
    console.log(`      ${file}: ${[...specifiers].sort().join(', ')}`);
  }
} else {
  console.log('OK    shared/common specifiers: all resolve to dist/shared/common declarations');
}

// Informational: remaining shimmed modules
if (internalShimsPresent && shimmedModules.size > 0) {
  console.log();
  console.log(`INFO  _internal-shims.d.ts declares ${shimmedModules.size} module${shimmedModules.size === 1 ? '' : 's'}:`);
  for (const mod of [...shimmedModules].sort()) {
    console.log(`        ${mod}`);
  }
  console.log('      These types are not on the public surface today. Tightening the surface (relocate, publish, or remove) shrinks this list.');
}

console.log();
console.log('='.repeat(72));

if (violations.length === 0) {
  console.log('No FAIL-level findings. Declaration surface is clean against current rules.');
  process.exit(0);
}

console.log(`FAIL findings: ${violations.join(', ')}`);
console.log();

if (isStrict) {
  console.log('Exiting non-zero (strict mode is the default since SD-2859).');
  console.log('Review the findings above for the violated declaration-surface rules.');
  console.log('Pass --informational (or SUPERDOC_AUDIT_INFORMATIONAL=1) to opt out for local iteration on a known leak.');
  process.exit(1);
}

console.log('Exiting zero (informational mode).');
console.log('Review the findings above for the violated declaration-surface rules.');
process.exit(0);
