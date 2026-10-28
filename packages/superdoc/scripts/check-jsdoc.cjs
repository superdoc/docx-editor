#!/usr/bin/env node
/**
 * SD-2833 / typecheck-jsdoc-ratchet: per-file checkJs gate for the
 * SuperDoc public-contract surface PLUS a ratchet that prevents new
 * public JSDoc files from accumulating without `// @ts-check`.
 *
 * Why this script exists (rather than turning on project-wide checkJs):
 *
 * The gate here is "files in CHECKED_FILES must stay clean, and new
 * public-reachable JSDoc files must either opt into @ts-check or be
 * allowlisted with a reason."
 *
 * Two gates run here:
 *
 *   1. CHECKED_FILES — Hand-curated list of files explicitly gated by
 *      this script. Each must have `// @ts-check` at the top. The script
 *      runs tsc, filters errors to these paths, and fails if any are
 *      present. New entries are added intentionally — adding a file
 *      means committing to keep it clean and fixing whatever surfaces.
 *      The list is small on purpose. Per-file `// @ts-check` directives
 *      elsewhere (e.g. the broader SuperDoc.js work) are still useful
 *      for IDE feedback but are not enforced through this script; they
 *      are checked by the main `pnpm check:types` (`tsc -b`) run.
 *
 *   2. RATCHET — Discover every public-reachable .js file with JSDoc
 *      type annotations (transitively from the supported `superdoc` root
 *      package entry). The committed debt snapshot at
 *      `jsdoc-debt-snapshot.json` is the set of public JSDoc files that
 *      do NOT yet have `// @ts-check`. The ratchet fails if:
 *        - A NEW public JSDoc file lands without `// @ts-check` and
 *          isn't on the explicit allowlist. The contributor must
 *          either add the directive (preferred) or add an entry to
 *          `jsdoc-allowlist.cjs` with a one-line reason.
 *        - A STALE entry remains in the snapshot (file was deleted,
 *          left the public surface, or gained `// @ts-check`). Rerun
 *          with `--write` to refresh.
 *      Existing files with `// @ts-check` already get IDE / build-time
 *      type-checking from the main `tsc -b` run. They don't need a
 *      second gate here.
 *
 * Adding a file to CHECKED_FILES:
 *   1. Add `// @ts-check` as the first line.
 *   2. Append the file's repo-relative path to the `CHECKED_FILES`
 *      array in `./jsdoc-checked-files.cjs` (the shared source of
 *      truth consumed by both this gate and
 *      `report-js-contract-owners.cjs`).
 *   3. Run `pnpm --filter superdoc run check:jsdoc` and fix what
 *      surfaces. If the file was on the debt snapshot, also rerun
 *      with `--write` to drop the stale entry.
 *
 * Refreshing the snapshot after intentional changes:
 *   pnpm --filter superdoc run check:jsdoc -- --write
 *
 * Adding to the allowlist (rare):
 *   Edit `packages/superdoc/scripts/jsdoc-allowlist.cjs`. Each entry must
 *   document WHY the file is exempt (e.g. third-party shim, vendored
 *   code, intentionally untyped boundary). The script enforces the
 *   contract: every entry must carry a non-empty string reason, point at
 *   a file that exists on disk, and still resolve to a public-reachable
 *   JSDoc file. Empty reasons, typo paths, and dead entries all fail.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const packageDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageDir, '..', '..');

const tsconfigPath = path.join(packageDir, 'tsconfig.json');

const DEBT_SNAPSHOT_PATH = path.join(__dirname, 'jsdoc-debt-snapshot.json');
const ALLOWLIST_PATH = path.join(__dirname, 'jsdoc-allowlist.cjs');

// Hand-curated set of files explicitly gated by this script lives in
// `./jsdoc-checked-files.cjs` so it's shared with
// `report-js-contract-owners.cjs` (which classifies these files as
// `checked-files` rather than `unaccounted`). Keep both consumers
// reading from one place; edits go in the shared module.
const {
  CHECKED_FILES,
  REACHABILITY_EXEMPT_CHECKED_FILES: REACHABILITY_EXEMPT_LIST,
} = require('./jsdoc-checked-files.cjs');

const REACHABILITY_EXEMPT_CHECKED_FILES = new Set(REACHABILITY_EXEMPT_LIST);

// PUBLIC entry points used by the ratchet's public-surface walk. The v2
// package exposes only the root entry plus stylesheet assets; removed v1
// compatibility subpaths are intentionally absent.
const PUBLIC_ENTRY_FILES = [
  'packages/superdoc/src/public/index.ts',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.vue'];

const PACKAGE_EXPORT_SOURCES = {};

const SOURCE_ALIASES = [
  ['@shared/', 'shared/'],
];

const HR = '='.repeat(72);
const flags = new Set(process.argv.slice(2));
const writeMode = flags.has('--write');

const toRepoRelative = (abs) => path.relative(repoRoot, abs).split(path.sep).join('/');

const TS_CHECK_DIRECTIVE_RE = /^\s*\/\/\s*@ts-check\b/m;
const hasTsCheckDirective = (abs) => {
  if (!abs.endsWith('.js')) return false;
  // 4 KiB margin for a leading license/doc block before the directive.
  const head = fs.readFileSync(abs, 'utf8').slice(0, 4096);
  return TS_CHECK_DIRECTIVE_RE.test(head);
};

const JSDOC_TYPE_TAG_RE = /\/\*\*[\s\S]*?@(typedef|param|returns|template|callback|property|type)\b/;
const hasJSDocTypeSurface = (abs) => {
  if (!abs.endsWith('.js')) return false;
  const source = fs.readFileSync(abs, 'utf8');
  return JSDOC_TYPE_TAG_RE.test(source);
};

const tryResolveSourcePath = (basePath) => {
  if (path.extname(basePath)) {
    if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) return basePath;
    if (basePath.endsWith('.js')) {
      for (const extension of ['.ts', '.tsx']) {
        const sourcePath = `${basePath.slice(0, -3)}${extension}`;
        if (fs.existsSync(sourcePath)) return sourcePath;
      }
    }
    return null;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const sourcePath = `${basePath}${extension}`;
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const sourcePath = path.join(basePath, `index${extension}`);
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  return null;
};

const resolveSourceSpecifier = (specifier, containingFile) => {
  if (Object.prototype.hasOwnProperty.call(PACKAGE_EXPORT_SOURCES, specifier)) {
    return path.join(repoRoot, PACKAGE_EXPORT_SOURCES[specifier]);
  }
  if (specifier.startsWith('.')) {
    return tryResolveSourcePath(path.resolve(path.dirname(containingFile), specifier));
  }
  for (const [alias, target] of SOURCE_ALIASES) {
    if (specifier === alias.replace(/\/$/, '')) return tryResolveSourcePath(path.join(repoRoot, target));
    if (specifier.startsWith(alias)) {
      return tryResolveSourcePath(path.join(repoRoot, target, specifier.slice(alias.length)));
    }
  }
  return null;
};

const createSourceFile = (filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : filePath.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
};

const findExportReachableTargets = (filePath) => {
  if (!/\.[jt]sx?$/.test(filePath)) return [];
  const sourceFile = createSourceFile(filePath);
  const importedBindings = new Map();
  const reachableTargets = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = resolveSourceSpecifier(statement.moduleSpecifier.text, filePath);
    const clause = statement.importClause;
    if (!target || !clause) continue;
    if (clause.name) importedBindings.set(clause.name.text, target);
    const namedBindings = clause.namedBindings;
    if (!namedBindings) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      importedBindings.set(namedBindings.name.text, target);
      continue;
    }
    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        importedBindings.set(element.name.text, target);
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveSourceSpecifier(statement.moduleSpecifier.text, filePath);
      if (target) reachableTargets.push(target);
      continue;
    }
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const localName = (element.propertyName || element.name).text;
      const target = importedBindings.get(localName);
      if (target) reachableTargets.push(target);
    }
  }
  return [...new Set(reachableTargets)];
};

const collectPublicExportSurface = () => {
  const seen = new Set();
  const stack = PUBLIC_ENTRY_FILES.map((file) => path.join(repoRoot, file));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const target of findExportReachableTargets(current)) {
      if (!seen.has(target)) stack.push(target);
    }
  }
  return seen;
};

// ─── Snapshot + allowlist I/O ─────────────────────────────────────────

function loadDebtSnapshot() {
  if (!fs.existsSync(DEBT_SNAPSHOT_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(DEBT_SNAPSHOT_PATH, 'utf8'));
  if (!Array.isArray(raw.knownUngated)) {
    console.error(`[check-jsdoc] invalid snapshot at ${DEBT_SNAPSHOT_PATH} (missing "knownUngated" array)`);
    process.exit(1);
  }
  return raw.knownUngated.slice().sort();
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return {};
  const mod = require(ALLOWLIST_PATH);
  if (typeof mod !== 'object' || mod === null) return {};
  return mod;
}

function writeDebtSnapshot(knownUngated) {
  const payload = {
    $comment:
      'Auto-managed by packages/superdoc/scripts/check-jsdoc.cjs. ' +
      'Run with --write to refresh after intentionally adding/removing public JSDoc files. ' +
      'Each entry is a public-reachable .js file with JSDoc that does not yet have // @ts-check.',
    knownUngated: knownUngated.slice().sort(),
  };
  fs.writeFileSync(DEBT_SNAPSHOT_PATH, JSON.stringify(payload, null, 2) + '\n');
}

function typeCheckGatedFiles(gatedFiles) {
  const configErrors = [];
  const config = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => configErrors.push(diagnostic),
  });
  const ambientDeclarations = config ? config.fileNames.filter((file) => file.endsWith('.d.ts')) : [];
  const program = config
    ? ts.createProgram({ rootNames: [...gatedFiles, ...ambientDeclarations], options: config.options })
    : null;
  const diagnostics = program
    ? [
        ...config.errors,
        ...program.getOptionsDiagnostics(),
        ...gatedFiles.flatMap((file) => {
          const sourceFile = program.getSourceFile(file);
          return [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
        }),
      ]
    : configErrors;
  return diagnostics.map((diagnostic) =>
    ts.formatDiagnostic(diagnostic, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '',
    }),
  );
}

// ─── Main ────────────────────────────────────────────────────────────

const publicSurface = collectPublicExportSurface();
const publicJsdocAbs = [...publicSurface].filter(hasJSDocTypeSurface).sort();
const publicJsdoc = publicJsdocAbs.map(toRepoRelative);
const publicJsdocSet = new Set(publicJsdoc);

const checkedFileSet = new Set(CHECKED_FILES);
const allowlist = loadAllowlist();
const allowlistedSet = new Set(Object.keys(allowlist));

// Validate the allowlist contract up-front. Every entry must:
//   1. Carry a non-empty string reason (the whole point of the allowlist
//      is to leave an explanation).
//   2. Point at a file that exists on disk (a path-typo silently widening
//      the exclusion set is exactly what this gate is meant to prevent).
//   3. Still resolve to a public-reachable JSDoc file (an allowlist entry
//      for a file that left the public surface is dead weight that hides
//      what's actually being excluded).
const allowlistFailures = [];
for (const [rel, reason] of Object.entries(allowlist)) {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    allowlistFailures.push(`  - ${rel}: missing or empty reason (each entry must explain the exemption)`);
    continue;
  }
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    allowlistFailures.push(`  - ${rel}: file does not exist on disk`);
    continue;
  }
  if (!publicJsdocSet.has(rel)) {
    allowlistFailures.push(
      `  - ${rel}: no longer a public-reachable JSDoc file (allowlist entry is dead; remove it)`,
    );
  }
}

// A public JSDoc file is "accounted for" when it has `// @ts-check`
// (we trust the per-file directive — broader checkJs catches drift),
// or is on the allowlist, or is in CHECKED_FILES. The debt snapshot
// is the catch-all for everything else.
function isAccountedFor(rel) {
  if (allowlistedSet.has(rel)) return true;
  if (checkedFileSet.has(rel)) return true;
  return hasTsCheckDirective(path.join(repoRoot, rel));
}

const expectedKnownUngated = publicJsdoc.filter((rel) => !isAccountedFor(rel)).sort();

if (writeMode) {
  writeDebtSnapshot(expectedKnownUngated);
  console.log(`[check-jsdoc] wrote ${path.relative(repoRoot, DEBT_SNAPSHOT_PATH)} (${expectedKnownUngated.length} entries).`);
  process.exit(0);
}

const debtSnapshot = loadDebtSnapshot();
const debtSet = new Set(debtSnapshot);

// Ratchet 1: new public JSDoc files that aren't accounted for AND aren't already in the snapshot.
const newUngated = expectedKnownUngated.filter((rel) => !debtSet.has(rel));
// Ratchet 2: snapshot entries that no longer apply (file gone, file gained @ts-check, allowlist, moved out of public surface, etc.).
const staleDebt = debtSnapshot.filter((rel) => !expectedKnownUngated.includes(rel));

// Pre-flight: every entry in CHECKED_FILES must exist on disk and carry
// the `// @ts-check` directive. Without this, removing or forgetting
// the directive makes the gate silently stop covering the file.
const missingDirective = [];
const missingFiles = [];
const nonPublicCheckedFiles = CHECKED_FILES.filter(
  (rel) => !publicJsdocSet.has(rel) && !REACHABILITY_EXEMPT_CHECKED_FILES.has(rel),
);
for (const rel of CHECKED_FILES) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    missingFiles.push(rel);
    continue;
  }
  if (!hasTsCheckDirective(abs)) missingDirective.push(rel);
}

const preflightFailures = [];
if (nonPublicCheckedFiles.length > 0) {
  preflightFailures.push('CHECKED_FILES contains entries not on the public superdoc export surface:');
  for (const f of nonPublicCheckedFiles) preflightFailures.push(`  - ${f}`);
  preflightFailures.push(
    'Gated files must be exported from the supported superdoc root entry ' +
      '(or listed in REACHABILITY_EXEMPT_CHECKED_FILES with an explicit reason).',
  );
}
if (missingFiles.length > 0) {
  if (preflightFailures.length > 0) preflightFailures.push('');
  preflightFailures.push('CHECKED_FILES entries do not exist:');
  for (const f of missingFiles) preflightFailures.push(`  - ${f}`);
}
if (missingDirective.length > 0) {
  if (preflightFailures.length > 0) preflightFailures.push('');
  preflightFailures.push('CHECKED_FILES entries are missing the `// @ts-check` directive:');
  for (const f of missingDirective) preflightFailures.push(`  - ${f}`);
  preflightFailures.push('Each gated file must opt into checkJs explicitly. Add `// @ts-check` and re-run.');
}

const ratchetFailures = [];
if (newUngated.length > 0) {
  ratchetFailures.push(
    `${newUngated.length} new public JSDoc file(s) without // @ts-check and not on the allowlist:`,
  );
  for (const rel of newUngated) ratchetFailures.push(`  + ${rel}`);
  ratchetFailures.push(
    'Either add `// @ts-check` to the file (preferred), or add an entry to ' +
      `${path.relative(repoRoot, ALLOWLIST_PATH)} with a one-line reason.`,
  );
}
if (staleDebt.length > 0) {
  if (ratchetFailures.length > 0) ratchetFailures.push('');
  ratchetFailures.push(`${staleDebt.length} stale entry/entries in the debt snapshot:`);
  for (const rel of staleDebt) ratchetFailures.push(`  - ${rel}`);
  ratchetFailures.push(
    'These files have been deleted, moved out of the public surface, or gained // @ts-check / allowlist. ' +
      'Run `pnpm --filter superdoc run check:jsdoc -- --write` to refresh the snapshot.',
  );
}

if (preflightFailures.length > 0 || allowlistFailures.length > 0 || ratchetFailures.length > 0) {
  console.log('[check-jsdoc] SuperDoc JSDoc ratchet');
  console.log(HR);
  if (preflightFailures.length > 0) {
    console.log('FAIL  CHECKED_FILES preflight:');
    for (const line of preflightFailures) console.log(line);
    console.log();
  }
  if (allowlistFailures.length > 0) {
    console.log('FAIL  jsdoc-allowlist.cjs contract violations:');
    for (const line of allowlistFailures) console.log(line);
    console.log();
  }
  if (ratchetFailures.length > 0) {
    console.log('FAIL  ratchet drift detected:');
    for (const line of ratchetFailures) console.log(line);
  }
  process.exit(1);
}

// ─── Drift check on CHECKED_FILES (the original gate) ────────────────

const checkedAbsolute = CHECKED_FILES.map((rel) => path.join(repoRoot, rel));
const checkedErrors = typeCheckGatedFiles(checkedAbsolute);

console.log('[check-jsdoc] SuperDoc JSDoc ratchet');
console.log(HR);
console.log(`Public JSDoc files discovered:        ${publicJsdoc.length}`);
console.log(`  - CHECKED_FILES (hand-curated):     ${publicJsdoc.filter((p) => checkedFileSet.has(p)).length} (+${REACHABILITY_EXEMPT_CHECKED_FILES.size} reachability-exempt)`);
console.log(`  - // @ts-check (informational):     ${publicJsdoc.filter((p) => hasTsCheckDirective(path.join(repoRoot, p))).length}`);
console.log(`  - allowlisted (with reason):        ${publicJsdoc.filter((p) => allowlistedSet.has(p)).length}`);
console.log(`  - tracked as known debt:            ${expectedKnownUngated.length}`);
console.log(`Snapshot at:                          ${path.relative(repoRoot, DEBT_SNAPSHOT_PATH)}`);
console.log();

if (checkedErrors.length === 0) {
  console.log(`OK    ${CHECKED_FILES.length} CHECKED_FILES clean; ratchet snapshot in sync.`);
  process.exit(0);
}

console.log(`FAIL  ${checkedErrors.length} error(s) in CHECKED_FILES:`);
for (const line of checkedErrors) console.log(`        ${line}`);
console.log();
console.log('Each error means a CHECKED_FILES entry has drifted from its JSDoc.');
console.log('Fix the type or the code so they match. Adding `// @ts-ignore` is not the answer.');
process.exit(1);
