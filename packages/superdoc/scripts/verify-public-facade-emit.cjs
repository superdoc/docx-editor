#!/usr/bin/env node
/**
 * SD-3178 (Phase 3 of SD-3175): verify the explicit public facade entries
 * emit declaration trees that are safe to ship.
 *
 * Runs as a postbuild step under `packages/superdoc/`. For each entry in
 * the `FACADE_ENTRIES` config below, loads the emitted `.d.ts` and `.d.cts`
 * with the TypeScript compiler API and asserts:
 *
 *   1. The expected symbol set is exported from each declaration file.
 *   2. The ESM and CJS declarations agree on the exported names.
 *   3. (Root entry only) **Legacy command-signature compatibility check.**
 *      `editor.commands.*` and `EditorCommands` are deprecated per
 *      `Editor.ts` `@deprecated` tags and `AGENTS.md` — the supported
 *      programmatic surface is the Document API (`editor.doc.*`). They
 *      remain typed and exported under legacy/public-compat so existing
 *      TS consumers keep compiling. This probe protects against silent
 *      augmentation-drop regressions on that legacy surface (SD-2965):
 *      `EditorCommands` is `CoreCommands & ExtensionCommands &
 *      AllCommandSignatures & Record<string, AnyCommand>`, so the
 *      trailing `Record<string, AnyCommand>` makes any indexer lookup
 *      resolve even when the specific signatures are missing. The probe
 *      asserts the RETURN TYPE of two commands (`setBold`,
 *      `insertComment`) is `boolean`, not the `AnyCommand` fallback's
 *      `unknown`. Two commands from two signature sources (formatting +
 *      comments) catch partial drops a single-command probe would miss.
 *      The probe is a backward-compat regression detector, not a
 *      supported-API guarantee.
 *   4. The emitted declarations contain no private workspace specifiers
 *      (`@superdoc/*`), no package-manager internals (`.pnpm/`), and no
 *      absolute local paths into the repo or `node_modules`.
 *
 *      Note: relative declaration references into the per-package dist tree
 *      are expected when the root facade exposes relocated private types.
 *
 * Adding a new facade file:
 *   - Create `packages/superdoc/src/public/<name>.ts` with named exports.
 *     The source file IS the contract; no wildcard re-exports.
 *   - Wire it into `vite.config.js` (`rollupOptions.input`).
 *   - If the new entry is intended to ship with both ESM and CJS type
 *     declarations (i.e. `package.json#exports` will use a `types.import` /
 *     `types.require` pair), also add it to `cjsDeclarationShims` in
 *     `scripts/ensure-types.cjs` and set `cjs` on the `FACADE_ENTRIES`
 *     entry below. If the entry will use a single `types` string instead
 *     (matching the SD-3180 legacy leaf entries), leave `cjs: null` and
 *     the parity check is skipped. Phase 4 of SD-3175 owns the contract
 *     flip and decides per-entry which shape ships.
 *   - Append a `FACADE_ENTRIES` entry below pointing at the source file
 *     and the emitted ESM/CJS paths. No expected-names list to maintain:
 *     the verifier parses the source file directly.
 *   - If the new entry re-exports `EditorCommands`, set
 *     `runsCommandSignatureProbe: true`.
 *
 * Exits non-zero on any failure. Designed to fail loud and early.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { npmDistRoot: distRoot } = require('./build-output-paths.cjs');
const PUBLIC_DIST = path.join(distRoot, 'superdoc', 'src', 'public');
const PUBLIC_SRC = path.resolve(__dirname, '..', 'src', 'public');

let ts;
try {
  ts = require('typescript');
} catch (err) {
  console.error('[verify-public-facade-emit] typescript is not available in this package.');
  process.exit(1);
}

// AIDEV-NOTE: The facade source file under `packages/superdoc/src/public/**`
// IS the export contract. The verifier parses it for named exports and
// checks the emitted declarations match. No second hand-maintained list
// to keep in sync. `export *` and `export * as X` are rejected in facade
// sources so the contract stays explicit and reviewable.
//
// Source of truth: the .ts file at FACADE_ENTRIES[*].source.
// What this script enforces: the emitted .d.ts / .d.cts match it.
// What it does NOT enforce: no-growth (handled by snapshot.mjs + the
// closure gate; see packages/superdoc/scripts/README.md).
const FACADE_ENTRIES = [
  // SD-3212: root facade re-curated from the classification artifact at
  // tests/consumer-typecheck/snapshots/superdoc-root-classification.json.
  // The root entry keeps supported public API, legacy public compatibility,
  // and internal-candidate compat names typed until a major-version cleanup.
  // The command-signature probe continues to run on this entry: it is a
  // *legacy command-signature compatibility check* (catches SD-2965-style
  // augmentation drops on the deprecated surface) rather than a guarantee
  // about supported API.
  {
    name: 'root (./index)',
    esm: path.join(PUBLIC_DIST, 'index.d.ts'),
    cjs: path.join(PUBLIC_DIST, 'index.d.cts'),
    source: path.join(PUBLIC_SRC, 'index.ts'),
    runsCommandSignatureProbe: false,
    ticket: 'SD-3212',
  },
  // v2-native public UI facade entries. Self-contained: re-export the local
  // `./ui/**` controller plus relocated public Document API shapes. No v1
  // editor surface, no private v2 packages. The expected named export set is
  // derived from the source `.ts` (no hand-maintained name list).
  {
    name: 'ui (./ui)',
    esm: path.join(PUBLIC_DIST, 'ui.d.ts'),
    cjs: path.join(PUBLIC_DIST, 'ui.d.cts'),
    source: path.join(PUBLIC_SRC, 'ui.ts'),
    runsCommandSignatureProbe: false,
    ticket: 'SD-3178',
  },
  {
    name: 'ui-react (./ui/react)',
    esm: path.join(PUBLIC_DIST, 'ui-react.d.ts'),
    cjs: path.join(PUBLIC_DIST, 'ui-react.d.cts'),
    source: path.join(PUBLIC_SRC, 'ui-react.ts'),
    runsCommandSignatureProbe: false,
    ticket: 'SD-3182',
  },
  {
    name: 'ui-vue (./ui/vue)',
    esm: path.join(PUBLIC_DIST, 'ui-vue.d.ts'),
    cjs: path.join(PUBLIC_DIST, 'ui-vue.d.cts'),
    source: path.join(PUBLIC_SRC, 'ui-vue.ts'),
    runsCommandSignatureProbe: false,
    ticket: null,
  },
  {
    name: 'collaboration-upgrade-engine (./collaboration-upgrade-engine)',
    esm: path.join(PUBLIC_DIST, 'collaboration-upgrade-engine.d.ts'),
    cjs: path.join(PUBLIC_DIST, 'collaboration-upgrade-engine.d.cts'),
    source: path.join(PUBLIC_SRC, 'collaboration-upgrade-engine.ts'),
    runsCommandSignatureProbe: false,
    ticket: 'collaboration-upgrade',
  },
  {
    name: 'collaboration-worker (./collaboration-worker)',
    esm: path.join(PUBLIC_DIST, 'collaboration-worker.d.ts'),
    cjs: path.join(PUBLIC_DIST, 'collaboration-worker.d.cts'),
    source: path.join(PUBLIC_SRC, 'collaboration-worker.ts'),
    runsCommandSignatureProbe: false,
    ticket: 'SD-4815',
  },
];

function loadFile(file) {
  if (!fs.existsSync(file)) {
    console.error(`[verify-public-facade-emit] missing facade declaration: ${file}`);
    console.error('Run `pnpm --filter superdoc run build` first.');
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8');
}

function formatDiagnostic(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start == null) return message;
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const relative = path.relative(repoRoot, diagnostic.file.fileName);
  return `${relative}:${line + 1}:${character + 1} ${message}`;
}

/**
 * Parse a facade source file (a `.ts` under `packages/superdoc/src/public/**`)
 * and return the sorted set of publicly exported names plus any rejected
 * constructs. The facade contract is *explicit named exports only*; this
 * function rejects `export *` / `export * as X` so the contract stays
 * reviewable as source diff.
 *
 * Supported export shapes:
 *   - `export { A, B } from '...'` / `export { A } from '...'`
 *   - `export type { A, B } from '...'`
 *   - `export { foo as bar }`             → publishes `bar`
 *   - `export { default } from '...'`     → publishes `default`
 *   - `export const X = ...`              → publishes `X`
 *   - `export function/class/interface/type/enum X`
 *   - `export default ...`                → publishes `default`
 *
 * Rejected:
 *   - `export *` (bare or `export * from '...'`)
 *   - `export * as Y from '...'`
 */
function parseFacadeSourceExports(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const src = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set();
  const rejections = [];
  const reject = (msg, node) => {
    const { line, character } = src.getLineAndCharacterOfPosition(node.getStart(src));
    rejections.push(`${path.relative(repoRoot, filePath)}:${line + 1}:${character + 1} ${msg}`);
  };
  const hasModifier = (node, kind) => (node.modifiers ?? []).some((m) => m.kind === kind);

  for (const stmt of src.statements) {
    if (ts.isExportDeclaration(stmt)) {
      const clause = stmt.exportClause;
      if (clause === undefined) {
        reject('`export *` is not allowed in a public facade source; list every name explicitly', stmt);
        continue;
      }
      if (ts.isNamespaceExport(clause)) {
        reject('`export * as ...` is not allowed in a public facade source; list every name explicitly', stmt);
        continue;
      }
      if (ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          names.add(el.name.text);
        }
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      names.add('default');
      continue;
    }
    if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) {
      names.add('default');
      continue;
    }
    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      if (stmt.name) names.add(stmt.name.text);
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
      }
      continue;
    }
  }
  return { names: [...names].sort(), rejections };
}

function listExportedNames(entry, file) {
  const program = ts.createProgram({
    rootNames: [file],
    options: {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      noEmit: true,
      skipLibCheck: true,
    },
  });
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getDeclarationDiagnostics(),
  ];
  if (diagnostics.length > 0) {
    console.error(`[verify-public-facade-emit] ${entry.name}: facade declaration has TypeScript diagnostics.`);
    for (const diagnostic of diagnostics.slice(0, 10)) {
      console.error('  - ' + formatDiagnostic(diagnostic));
    }
    if (diagnostics.length > 10) {
      console.error(`  ... ${diagnostics.length - 10} more diagnostics`);
    }
    return { ok: false, names: [] };
  }
  const checker = program.getTypeChecker();
  const src = program.getSourceFile(file);
  const symbol = checker.getSymbolAtLocation(src) ?? (src && src.symbol);
  if (!symbol) return { ok: true, names: [] };
  return {
    ok: true,
    names: [...new Set(checker.getExportsOfModule(symbol).map((s) => s.getName()))].sort(),
  };
}

function checkSymbolSet(entry) {
  if (!fs.existsSync(entry.source)) {
    console.error(
      `[verify-public-facade-emit] ${entry.name}: facade source missing at ${path.relative(repoRoot, entry.source)}`,
    );
    return { ok: false, actual: [] };
  }
  const parsed = parseFacadeSourceExports(entry.source);
  if (parsed.rejections.length > 0) {
    console.error(
      `[verify-public-facade-emit] ${entry.name}: facade source uses constructs not allowed in a public facade:`,
    );
    for (const r of parsed.rejections) console.error('  - ' + r);
    return { ok: false, actual: [] };
  }
  const expected = parsed.names;
  const result = listExportedNames(entry, entry.esm);
  if (!result.ok) return { ok: false, actual: result.names };
  const actual = result.names;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return { ok: true, actual };
  }
  const missingFromEmit = expected.filter((n) => !actual.includes(n));
  const extraInEmit = actual.filter((n) => !expected.includes(n));
  console.error(`[verify-public-facade-emit] ${entry.name}: emitted declarations drifted from facade source.`);
  console.error(`  source: ${path.relative(repoRoot, entry.source)}`);
  console.error(`  emit:   ${path.relative(repoRoot, entry.esm)}`);
  if (missingFromEmit.length) console.error('  missing from emit: ' + missingFromEmit.join(', '));
  if (extraInEmit.length) console.error('  extra in emit:     ' + extraInEmit.join(', '));
  console.error(
    `  The facade source is the contract. Either fix the dts pipeline (ensure-types.cjs, tsconfig include, vite.config.js)`,
  );
  console.error(`  or update the source file under packages/superdoc/src/public/** to match the intended surface.`);
  return { ok: false, actual };
}

function checkEsmCjsParity(entry, esmNames) {
  const result = listExportedNames(entry, entry.cjs);
  if (!result.ok) return false;
  const cjsNames = result.names;
  if (JSON.stringify(esmNames) === JSON.stringify(cjsNames)) return true;
  const importOnly = esmNames.filter((n) => !cjsNames.includes(n));
  const requireOnly = cjsNames.filter((n) => !esmNames.includes(n));
  console.error(`[verify-public-facade-emit] ${entry.name}: ESM/CJS facade declarations disagree on exports.`);
  if (importOnly.length) console.error('  ESM-only:  ' + importOnly.join(', '));
  if (requireOnly.length) console.error('  CJS-only:  ' + requireOnly.join(', '));
  console.error('  Fix the CJS shim generator (packages/superdoc/scripts/ensure-types.cjs).');
  return false;
}

function checkCommandSignatureProbe(entry) {
  const probe = `
    import type { EditorCommands } from ${JSON.stringify(entry.esm)};
    type ReturnsBoolean<F> = F extends (...args: any[]) => boolean ? true : false;
    // Direct assignment of literal \`true\` to the conditional result. If the
    // signature is missing and the indexer falls back to AnyCommand, the
    // conditional resolves to \`false\` and the assignment fails with TS2322.
    // Casts of the form \`true as Result\` would mask the failure by
    // laundering through \`never\`, so the literal stays un-cast on purpose.
    // setBold comes from FormattingCommandAugmentations.
    const __setBoldOk: ReturnsBoolean<EditorCommands['setBold']> = true;
    void __setBoldOk;
    // insertComment comes from CommentCommands. Two sources catches partial
    // drops a single-command probe would miss.
    const __insertCommentOk: ReturnsBoolean<EditorCommands['insertComment']> = true;
    void __insertCommentOk;
  `;
  const probePath = path.join(distRoot, '__public-facade-command-signature-probe.ts');
  fs.writeFileSync(probePath, probe, 'utf8');
  try {
    const program = ts.createProgram({
      rootNames: [probePath],
      options: {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
    });
    const diagnostics = [...program.getSemanticDiagnostics(), ...program.getDeclarationDiagnostics()];
    if (diagnostics.length === 0) return true;
    console.error(`[verify-public-facade-emit] ${entry.name}: legacy command-signature compatibility check failed.`);
    console.error('  A command (setBold or insertComment) does not return `boolean` through the facade.');
    console.error(
      '  This is the SD-2965 regression vector: specific command signatures were dropped or failed to flow through the facade, and EditorCommands fell back to the `AnyCommand` indexer.',
    );
    console.error(
      '  Note: `editor.commands.*` is deprecated (use `editor.doc.*`). This check guards backward compatibility of the legacy typed surface; it is not a supported-API guarantee.',
    );
    for (const d of diagnostics) {
      const msg =
        typeof d.messageText === 'string' ? d.messageText : ts.flattenDiagnosticMessageText(d.messageText, '\n');
      console.error('  - ' + msg);
    }
    return false;
  } finally {
    try {
      fs.unlinkSync(probePath);
    } catch (_) {}
  }
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const LEAK_PATTERNS = [
  { name: 'private workspace specifier', re: /(?:from\s+['"]|require\(['"])@superdoc\//g },
  { name: 'pnpm internal path', re: /\.pnpm\//g },
  { name: 'absolute source path', re: /['"][\/\\][^'"\n]*\/(packages|node_modules)\//g },
];

function checkLeaks(entry) {
  let ok = true;
  const files = [entry.esm];
  if (entry.cjs) files.push(entry.cjs);
  for (const file of files) {
    const code = stripComments(loadFile(file));
    for (const pattern of LEAK_PATTERNS) {
      const matches = code.match(pattern.re);
      if (matches && matches.length > 0) {
        console.error(`[verify-public-facade-emit] ${entry.name}: leak in ${path.relative(repoRoot, file)}:`);
        console.error(`  ${pattern.name}: ${matches.slice(0, 5).join(', ')}`);
        ok = false;
      }
    }
  }
  return ok;
}

let failed = false;
const summaryLines = [];

function checkTypeOnlyShape(entry) {
  if (!entry.typeOnly || !entry.cjs) return true;
  if (!fs.existsSync(entry.cjs)) return true;
  const content = fs.readFileSync(entry.cjs, 'utf8');
  // `export declare const NAME` (or `let`/`var`) in a typeOnly entry's
  // shim means the generator emitted a value declaration despite the
  // type-only contract. The empty runtime bundle would not back it.
  const valueDecls = content.match(/^\s*export\s+declare\s+(?:const|let|var)\s+\w+/gm);
  if (!valueDecls || valueDecls.length === 0) return true;
  console.error(`[verify-public-facade-emit] ${entry.name}: typeOnly entry shim contains value declarations.`);
  for (const decl of valueDecls.slice(0, 10)) {
    console.error('  - ' + decl.trim());
  }
  console.error(
    '  Fix `emitCjsDeclarationShim` in `packages/superdoc/scripts/ensure-types.cjs` so the typeOnly branch emits `export type` for every name.',
  );
  return false;
}

for (const entry of FACADE_ENTRIES) {
  const symbolResult = checkSymbolSet(entry);
  if (!symbolResult.ok) failed = true;

  // Entries with `cjs: null` (e.g. SD-3180 legacy leaf entries that match
  // the existing single-types pattern) skip the parity check until Phase 4
  // decides whether to add proper CJS shims.
  if (entry.cjs && !checkEsmCjsParity(entry, symbolResult.actual)) failed = true;

  if (entry.runsCommandSignatureProbe && !checkCommandSignatureProbe(entry)) {
    failed = true;
  }

  if (!checkLeaks(entry)) failed = true;
  if (!checkTypeOnlyShape(entry)) failed = true;

  summaryLines.push(`${entry.name}: ${symbolResult.actual.length} exports`);
}

if (failed) {
  console.error('');
  console.error('[verify-public-facade-emit] FAILED. The public facade emit is not safe to advance.');
  process.exit(1);
}

console.log(
  `[verify-public-facade-emit] OK. Facade emits cleanly across ${FACADE_ENTRIES.length} entries (${summaryLines.join('; ')}).`,
);
