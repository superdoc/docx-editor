#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatTypeScriptLaunchError, runTypeScript } = require('./typescript-runner.cjs');

// SD-2864: canonical taxonomy for the published type surface. Mirrors
// vite.config.js, tsconfig.json, and audit-declarations.cjs from a single
// data file so contributors only edit one place to add a new relocation.
const typeSurface = require('./type-surface.config.cjs');

// Verify that vite-plugin-dts generated the expected type entry points.
// Path aliases are resolved by vite-plugin-dts via tsconfig.json paths.
const { npmDistRoot: distRoot, isRelocatedSharedCommonSpecifier, sharedCommonDistRoot } = require('./build-output-paths.cjs');
const repoRoot = path.resolve(__dirname, '..', '..', '..');

// SD-2893: adding shared/ to vite-plugin-dts's `include` would shift the
// common-ancestor of all source files to the repo root and reorganise the
// entire dist tree, so we run tsc directly for the shared/common modules the
// emitted declarations name.
const sharedCommonSourceRoot = path.join(repoRoot, 'shared/common');
const declarationSourceMirrorRoot = path.resolve(__dirname, '..', '..');

function emitSharedCommonDeclarations(sources) {
  fs.mkdirSync(sharedCommonDistRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superdoc-ensure-types-'));
  const tempTsconfig = path.join(tempDir, 'tsconfig.shared-common.json');
  // Keep this packaging-only emit independent of whichever @types packages pnpm hoists.
  fs.writeFileSync(
    tempTsconfig,
    `${JSON.stringify(
      {
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          types: [],
          outDir: sharedCommonDistRoot,
          rootDir: sharedCommonSourceRoot,
        },
        files: sources,
      },
      null,
      2,
    )}\n`,
  );
  let tscResult;
  try {
    tscResult = runTypeScript(['-p', tempTsconfig], { stdio: 'inherit' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const launchError = formatTypeScriptLaunchError(tscResult, 'shared/common declarations');
  if (launchError) {
    console.error(`[ensure-types] ${launchError}`);
    process.exit(1);
  }
  if (tscResult.status !== 0) {
    console.error('[ensure-types] tsc failed emitting shared/common declarations');
    process.exit(1);
  }
  console.log(`[ensure-types] ✓ Emitted ${sources.length} shared/common declarations`);
}

// Emit @superdoc/font-system public declarations into the published dist tree. Its font
// report types surface on `superdoc.fonts` / `fonts-changed`. Like shared/common, adding
// it to vite-plugin-dts would shift the common-ancestor, so emit it standalone from the
// package's `index.ts` (which has no asset imports). The relocation rule rewrites bare
// `@superdoc/font-system` specifiers in other dist files to `shared/font-system/src/index.d.ts`.
{
  const fontSystemSrc = path.join(repoRoot, 'shared/font-system/src');
  const fontSystemDistDir = path.join(distRoot, 'shared/font-system/src');
  fs.mkdirSync(fontSystemDistDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superdoc-ensure-types-fs-'));
  const tempTsconfig = path.join(tempDir, 'tsconfig.font-system.json');
  fs.writeFileSync(
    tempTsconfig,
    `${JSON.stringify(
      {
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          types: [],
          lib: ['ES2022', 'DOM'],
          outDir: fontSystemDistDir,
          rootDir: fontSystemSrc,
        },
        files: [path.join(fontSystemSrc, 'index.ts')],
      },
      null,
      2,
    )}\n`,
  );
  let tscResult;
  try {
    tscResult = runTypeScript(['-p', tempTsconfig], { stdio: 'inherit' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const launchError = formatTypeScriptLaunchError(tscResult, '@superdoc/font-system declarations');
  if (launchError) {
    console.error(`[ensure-types] ${launchError}`);
    process.exit(1);
  }
  if (tscResult.status !== 0) {
    console.error('[ensure-types] tsc failed emitting @superdoc/font-system declarations');
    process.exit(1);
  }
  console.log('[ensure-types] ✓ Emitted @superdoc/font-system declarations');
}

// The package advertises CJS runtime entry points for `.`. Node16/NodeNext
// TypeScript consumers resolving those entries through `require` need CJS
// declaration entry points (`.d.cts`) so the type graph is honest about the
// runtime module kind. Generate named CJS declaration shims from the ESM entry
// declarations. A plain
// `export * from './entry.js'` is not valid here: TypeScript still treats that
// as a CJS declaration importing an ESM declaration and raises TS1479.
const cjsDeclarationShims = [
  {
    file: path.join(distRoot, 'superdoc/src/public/index.d.cts'),
    source: path.join(distRoot, 'superdoc/src/public/index.d.ts'),
    target: './index.js',
  },
  // v2-native public UI facade entries. The `./ui` and `./ui/react` exports
  // advertise CJS `require` conditions, so emit named CJS declaration shims
  // alongside the ESM `.d.ts` so a `require('superdoc/ui')` consumer resolves
  // the same named exports.
  {
    file: path.join(distRoot, 'superdoc/src/public/ui.d.cts'),
    source: path.join(distRoot, 'superdoc/src/public/ui.d.ts'),
    target: './ui.js',
  },
  {
    file: path.join(distRoot, 'superdoc/src/public/ui-react.d.cts'),
    source: path.join(distRoot, 'superdoc/src/public/ui-react.d.ts'),
    target: './ui-react.js',
  },
  {
    file: path.join(distRoot, 'superdoc/src/public/ui-vue.d.cts'),
    source: path.join(distRoot, 'superdoc/src/public/ui-vue.d.ts'),
    target: './ui-vue.js',
  },
  {
    file: path.join(distRoot, 'superdoc/src/public/collaboration-upgrade-engine.d.cts'),
    source: path.join(distRoot, 'superdoc/src/public/collaboration-upgrade-engine.d.ts'),
    target: './collaboration-upgrade-engine.js',
  },
  {
    file: path.join(distRoot, 'superdoc/src/public/collaboration-worker.d.cts'),
    source: path.join(distRoot, 'superdoc/src/public/collaboration-worker.d.ts'),
    target: './collaboration-worker.js',
  },
];

function isValidIdentifier(name) {
  return /^[$A-Z_a-z][$\w]*$/.test(name);
}

function emitCjsDeclarationShim({ file, source, target, typeOnly = false }) {
  const ts = require('typescript');
  const program = ts.createProgram([source], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(source);
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) {
    console.error(`[ensure-types] Could not inspect exports for ${path.relative(distRoot, source)}`);
    process.exit(1);
  }

  const importRef = `import('${target}', { with: { "resolution-mode": "import" } })`;
  const importLines = [
    '// Generated by scripts/ensure-types.cjs. Do not edit by hand.',
  ];
  const exportLines = [];

  for (const symbol of checker.getExportsOfModule(moduleSymbol).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = symbol.getName();
    if (name === 'default' || !isValidIdentifier(name)) continue;

    const resolved = (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
    const hasValue = Boolean(resolved.flags & ts.SymbolFlags.Value);
    const hasType = Boolean(resolved.flags & ts.SymbolFlags.Type);

    // typeOnly: re-export every name as a type, regardless of upstream
    // origin. Some generated type-only shims need value-origin names to stay
    // type-only; otherwise they would advertise runtime values that the
    // corresponding runtime bundle does not provide.
    if (typeOnly) {
      const typeAlias = `__Cjs_${name}`;
      importLines.push(`import type { ${name} as ${typeAlias} } from '${target}' with { "resolution-mode": "import" };`);
      exportLines.push(`export type { ${typeAlias} as ${name} };`);
      continue;
    }

    if (hasType) {
      const typeAlias = `__Cjs_${name}`;
      importLines.push(`import type { ${name} as ${typeAlias} } from '${target}' with { "resolution-mode": "import" };`);
      if (hasValue) {
        exportLines.push(`export type ${name} = ${typeAlias};`);
      } else {
        exportLines.push(`export type { ${typeAlias} as ${name} };`);
      }
    }

    if (hasValue) {
      exportLines.push(`export declare const ${name}: typeof ${importRef}.${name};`);
    }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${importLines.concat(exportLines).join('\n')}\n`);
}

const indexPath = path.join(distRoot, 'superdoc/src/public/index.d.ts');
let content = fs.readFileSync(indexPath, 'utf8');

const hasSuperDocExport = /export\s+\{[^}]*\bSuperDoc\b[^}]*\}/m.test(content);
if (!hasSuperDocExport) {
  console.error(`[ensure-types] SuperDoc export missing in superdoc/src/public/index.d.ts`);
  process.exit(1);
}

// @superdoc/common is a private workspace package, so consumers can't resolve
// bare or deep `@superdoc/common` imports from emitted declarations. The root
// entry exposes a small set of runtime values from common (DOCX/PDF/HTML
// constants, getFileObject, compareVersions, BlankDOCX). Strip those imports
// and inline declarations for the exported names. Every other declaration
// that names common is rewritten per symbol by relocateSharedCommonImports.
const INLINED_COMMON_RUNTIME_NAMES = new Set(['DOCX', 'PDF', 'HTML', 'getFileObject', 'compareVersions', 'BlankDOCX']);

function inlineCommonRuntimeDeclarations(filePath) {
  let fileContent = fs.readFileSync(filePath, 'utf8');
  const commonRuntimeImportPatterns = [
    /import\s*\{[^}]*\}\s*from\s*['"]@superdoc\/common['"];?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*['"]@superdoc\/common\/document-types['"];?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*['"]@superdoc\/common\/helpers\/get-file-object['"];?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*['"]@superdoc\/common\/helpers\/compare-superdoc-versions['"];?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*['"][^'"]*\/shared\/common(?:\/index)?(?:\.js)?['"];?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*['"][^'"]*\/shared\/common\/document-types(?:\.js)?['"];?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*['"][^'"]*\/shared\/common\/helpers\/get-file-object(?:\.js)?['"];?\s*\n?/g,
    /import\s*\{[^}]*\}\s*from\s*['"][^'"]*\/shared\/common\/helpers\/compare-superdoc-versions(?:\.js)?['"];?\s*\n?/g,
  ];

  const hasCommonRuntimeImport = commonRuntimeImportPatterns.some((pattern) => pattern.test(fileContent));
  if (!hasCommonRuntimeImport) return false;

  for (const pattern of commonRuntimeImportPatterns) {
    fileContent = fileContent.replace(pattern, (statement) => {
      const [, quote, specifier] = statement.match(/from\s*(['"])([^'"]+)\1/);
      const remaining = statement
        .slice(statement.indexOf('{') + 1, statement.indexOf('}'))
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry && !INLINED_COMMON_RUNTIME_NAMES.has(entry.replace(/^type\s+/, '').split(/\s+as\s+/)[0]));
      return remaining.length ? `import { ${remaining.join(', ')} } from ${quote}${specifier}${quote};\n` : '';
    });
  }

  const hasExportedBlankDocxDeclaration = /\bexport\s+declare\s+const\s+BlankDOCX\b/.test(fileContent);
  const declarations = [
    fileContent.includes('DOCX') && "declare const DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';",
    fileContent.includes('PDF') && "declare const PDF: 'application/pdf';",
    fileContent.includes('HTML') && "declare const HTML: 'text/html';",
    fileContent.includes('getFileObject') && 'declare function getFileObject(fileUrl: string, name: string, type: string): Promise<File>;',
    fileContent.includes('compareVersions') && 'declare function compareVersions(version1: string, version2: string): -1 | 0 | 1;',
    fileContent.includes('BlankDOCX') && !hasExportedBlankDocxDeclaration && '/** URL to the blank DOCX template */',
    fileContent.includes('BlankDOCX') && !hasExportedBlankDocxDeclaration && 'declare const BlankDOCX: string;',
  ].filter(Boolean);

  fs.writeFileSync(filePath, `${declarations.join('\n')}\n${fileContent}`);
  return true;
}

const commonInlineTargets = [path.join(distRoot, 'superdoc/src/public/index.d.ts')];
const inlinedCommonTargets = commonInlineTargets.filter((target) => fs.existsSync(target) && inlineCommonRuntimeDeclarations(target));
if (inlinedCommonTargets.length) {
  console.log(`[ensure-types] ✓ Inlined @superdoc/common runtime declarations in ${inlinedCommonTargets.length} entry point(s)`);
}

function failSharedCommon(filePath, message) {
  console.error(`[ensure-types] ${path.relative(distRoot, filePath)}: ${message}`);
  process.exit(1);
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function mentionsSharedCommon(specifier) {
  return specifier.includes('shared/common') || specifier === '@superdoc/common' || specifier.startsWith('@superdoc/common/');
}

function declarationSourceMirror(filePath) {
  const rel = path.relative(distRoot, filePath);
  return path.join(rel.startsWith(`shared${path.sep}`) ? repoRoot : declarationSourceMirrorRoot, rel);
}

function relocateSharedCommonImports(dtsFiles) {
  const ts = require('typescript');
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const references = [];
  const leftmostIdentifier = (name) => (ts.isIdentifier(name) ? name : leftmostIdentifier(name.left));

  for (const filePath of dtsFiles) {
    if (isInside(sharedCommonDistRoot, filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.includes('shared/common') && !text.includes('@superdoc/common')) continue;
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

    const resolveSpecifier = (literal) => {
      const specifier = literal.text;
      if (!mentionsSharedCommon(specifier) || isRelocatedSharedCommonSpecifier(specifier, filePath)) return null;
      const { resolvedModule } = ts.resolveModuleName(specifier, declarationSourceMirror(filePath), compilerOptions, ts.sys);
      const resolved = resolvedModule && fs.realpathSync(resolvedModule.resolvedFileName);
      if (!resolved || !isInside(sharedCommonSourceRoot, resolved) || resolved.endsWith('.d.ts')) {
        failSharedCommon(filePath, `cannot resolve '${specifier}' to a shared/common source module`);
      }
      return resolved;
    };

    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const sourceModule = resolveSpecifier(node.moduleSpecifier);
        if (sourceModule) {
          const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
          const elements = bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) ? bindings.elements : null;
          if (!elements || (ts.isImportDeclaration(node) && node.importClause.name)) {
            failSharedCommon(filePath, `'${node.getText()}' must name each symbol it takes from '${node.moduleSpecifier.text}'`);
          }
          references.push({ kind: 'statement', filePath, node, sourceModule, elements: [...elements] });
        }
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        const sourceModule = resolveSpecifier(node.argument.literal);
        if (sourceModule) {
          if (!node.qualifier) {
            failSharedCommon(filePath, `'${node.getText()}' must name the symbol it takes from '${node.argument.literal.text}'`);
          }
          references.push({ kind: 'importType', filePath, node, sourceModule, head: leftmostIdentifier(node.qualifier) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const alwaysEmitted = typeSurface.sharedCommonDtsTargets.map((file) => path.join(sharedCommonSourceRoot, file));
  if (!references.length) {
    emitSharedCommonDeclarations(alwaysEmitted);
    return 0;
  }

  const program = ts.createProgram([...new Set(references.map((reference) => reference.sourceModule))], compilerOptions);
  const checker = program.getTypeChecker();
  const exportsOf = (fileName) => {
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(fileName));
    return moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
  };
  const resolveAlias = (symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);

  const locate = (filePath, sourceModule, name) => {
    const exported = exportsOf(sourceModule).find((symbol) => symbol.name === name);
    if (!exported) {
      failSharedCommon(filePath, `'${name}' is not exported by ${path.relative(repoRoot, sourceModule)}`);
    }
    const target = resolveAlias(exported);
    const declaringFiles = [...new Set((target.declarations ?? []).map((declaration) => declaration.getSourceFile().fileName))];
    const declaringFile = declaringFiles.length === 1 ? fs.realpathSync(declaringFiles[0]) : null;
    if (!declaringFile || !isInside(sharedCommonSourceRoot, declaringFile) || !/(?<!\.d)\.ts$/.test(declaringFile)) {
      failSharedCommon(filePath, `'${name}' from ${path.relative(repoRoot, sourceModule)} has no shared/common TypeScript declaration to publish`);
    }
    const ownExport = exportsOf(declaringFile).find((symbol) => resolveAlias(symbol) === target);
    if (!ownExport) {
      failSharedCommon(filePath, `'${name}' is declared in ${path.relative(repoRoot, declaringFile)} but not exported there`);
    }
    return { declaringFile, exportName: ownExport.name };
  };

  const edits = new Map();
  const declaringFiles = new Set();
  const addEdit = (filePath, start, end, replacement) => {
    if (!edits.has(filePath)) edits.set(filePath, []);
    edits.get(filePath).push({ start, end, replacement });
  };
  const specifierFor = (filePath, declaringFile) => {
    const target = path.join(sharedCommonDistRoot, path.relative(sharedCommonSourceRoot, declaringFile)).replace(/\.ts$/, '.js');
    const rel = path.relative(path.dirname(filePath), target).split(path.sep).join('/');
    return rel.startsWith('.') ? rel : `./${rel}`;
  };

  for (const reference of references) {
    const { filePath, node, sourceModule } = reference;
    if (reference.kind === 'importType') {
      const { declaringFile, exportName } = locate(filePath, sourceModule, reference.head.text);
      declaringFiles.add(declaringFile);
      const literal = node.argument.literal;
      const quote = literal.getText()[0];
      addEdit(filePath, literal.getStart(), literal.getEnd(), `${quote}${specifierFor(filePath, declaringFile)}${quote}`);
      if (exportName !== reference.head.text) addEdit(filePath, reference.head.getStart(), reference.head.getEnd(), exportName);
      continue;
    }

    const groups = new Map();
    for (const element of reference.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      const { declaringFile, exportName } = locate(filePath, sourceModule, importedName);
      declaringFiles.add(declaringFile);
      const elementText = exportName === importedName
        ? element.getText()
        : `${element.isTypeOnly ? 'type ' : ''}${exportName} as ${element.name.text}`;
      if (!groups.has(declaringFile)) groups.set(declaringFile, []);
      groups.get(declaringFile).push(elementText);
    }
    const statement = node.getText();
    const literal = node.moduleSpecifier;
    const quote = literal.getText()[0];
    const bindings = ts.isImportDeclaration(node) ? node.importClause.namedBindings : node.exportClause;
    const before = statement.slice(0, bindings.getStart() - node.getStart());
    const between = statement.slice(bindings.getEnd() - node.getStart(), literal.getStart() - node.getStart());
    const after = statement.slice(literal.getEnd() - node.getStart());
    const originalBindings = bindings.getText();
    const replacement = [...groups]
      .map(([declaringFile, elementTexts]) => {
        const rewrittenBindings = groups.size === 1 && elementTexts.every((elementText, index) => elementText === reference.elements[index].getText())
          ? originalBindings
          : `{ ${elementTexts.join(', ')} }`;
        return `${before}${rewrittenBindings}${between}${quote}${specifierFor(filePath, declaringFile)}${quote}${after}`;
      })
      .join('\n');
    addEdit(filePath, node.getStart(), node.getEnd(), replacement);
  }

  emitSharedCommonDeclarations([...new Set([...alwaysEmitted, ...[...declaringFiles].sort()])]);

  for (const [filePath, fileEdits] of edits) {
    let fileContent = fs.readFileSync(filePath, 'utf8');
    for (const { start, end, replacement } of fileEdits.sort((a, b) => b.start - a.start)) {
      fileContent = `${fileContent.slice(0, start)}${replacement}${fileContent.slice(end)}`;
    }
    fs.writeFileSync(filePath, fileContent);
  }
  return edits.size;
}

const relocatedSharedCommonFiles = relocateSharedCommonImports(findDtsFiles(distRoot));
console.log(`[ensure-types] ✓ Relocated shared/common imports per symbol in ${relocatedSharedCommonFiles} .d.ts files`);

// ---------------------------------------------------------------------------
// Fix pnpm node_modules paths in ALL .d.ts files (SD-2227)
//
// vite-plugin-dts resolves bare specifiers like 'some-package' to physical
// pnpm paths like '../../node_modules/.pnpm/some-package@1.2.3/node_modules/some-package/dist/index.js'.
// Consumers don't have these paths — rewrite them back to bare specifiers.
// ---------------------------------------------------------------------------

/**
 * Recursively find all .d.ts files under a directory.
 */
function findDtsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDtsFiles(fullPath));
    } else if (entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// Match pnpm node_modules paths in both `from '...'` and `import('...')` contexts.
// Captures the bare package name from the pnpm structure:
//   .../node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/dist/index.js
//                                                    ^^^^^ capture this
const PNPM_PATH_RE = /(['"])([^'"]*\/node_modules\/\.pnpm\/[^/]+\/node_modules\/(@[^/]+\/[^/]+|[^/]+)\/dist\/index\.js)\1/g;

// Match broken absolute-looking paths like 'packages/superdoc/src/types.js'
// that vite-plugin-dts sometimes emits from path alias resolution.
const BAD_ABSOLUTE_PATH_RE = /(['"])packages\/superdoc\/src\/([^'"]+)\1/g;

// vite-plugin-dts can incorrectly resolve subpath exports by appending the
// subpath to the main entry, e.g. '../../entry/index.js/types'.
// Fix: rewrite index.(js|ts)/<subpath> → <subpath>.js
const BAD_SUBPATH_RE = /(['"])([^'"]*\/index\.(?:js|ts))(\/[^'"]+)\1/g;

let fixedFiles = 0;
let totalReplacements = 0;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendJsExtensionToRelativeSpecifier(specifier, filePath) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
  if (specifier.includes('?') || specifier.includes('#')) return specifier;
  const targetBase = path.resolve(path.dirname(filePath), specifier);
  if (path.posix.extname(specifier) === '.vue') {
    // `./Foo.vue.js` is the Node16/NodeNext-friendly declaration specifier:
    // TypeScript strips the trailing `.js` and resolves it to `Foo.vue.d.ts`.
    return fs.existsSync(`${targetBase}.d.ts`) ? `${specifier}.js` : specifier;
  }
  if (path.posix.extname(specifier)) return specifier;
  if (fs.existsSync(`${targetBase}.d.ts`)) return `${specifier}.js`;
  if (fs.existsSync(path.join(targetBase, 'index.d.ts'))) return `${specifier}/index.js`;
  return specifier;
}

// SD-2815: rewrite `@superdoc/document-api` bare specifiers to point
// at the document-api dist that vite-plugin-dts now emits at
// `dist/document-api/`. Without this, packed consumers see the bare
// specifier in the .d.ts files, fail to resolve it, and fall through
// to the `_internal-shims.d.ts` `any` shim that is generated below.
// Without this, the doc-api types reached from public SuperDoc declarations
// would fall through to an `any` shim and lose checking.
const DOC_API_PATH_RE = /(['"])@superdoc\/document-api(\/[^'"]+)?\1/g;
function rewriteDocApiPaths(fileContent, filePath) {
  return fileContent.replace(DOC_API_PATH_RE, (_match, quote, subpath = '') => {
    const target = path.join(distRoot, 'document-api/src/index.d.ts');
    let rel = path.relative(path.dirname(filePath), target).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    // Drop the trailing `.d.ts` so the import path follows the
    // module-resolution convention used everywhere else in the dist
    // (`...index.js` form, which TS resolves to `index.d.ts`).
    rel = rel.replace(/\.d\.ts$/, '.js');
    if (subpath) rel = rel.replace(/\/index\.js$/, subpath);
    return `${quote}${rel}${quote}`;
  });
}

// SD-2842 / SD-2864: relocate workspace packages whose types appear on the
// public surface. Each rule redirects bare/subpath specifiers in emitted
// .d.ts files to a relative path inside dist. The canonical list lives in
// type-surface.config.cjs; this script picks the fields it needs.
const RELOCATION_RULES = typeSurface.relocations.map(({ pkg, distEntry, matchSubpaths }) => ({
  pkg,
  distEntry,
  matchSubpaths,
}));

function isRelocatedSpecifier(mod) {
  return RELOCATION_RULES.some((rule) =>
    rule.matchSubpaths
      ? mod === rule.pkg || mod.startsWith(rule.pkg + '/')
      : mod === rule.pkg,
  );
}

function makeRelocationRewriter({ pkg, distEntry, matchSubpaths }) {
  // Match the package name with optional subpath, e.g. `@superdoc/contracts` or
  // `@superdoc/contracts/engines/tabs.js`. Anchored to either side of the
  // package segment so `@superdoc/contracts-something` is not matched.
  const escaped = escapeRegExp(pkg);
  const subpathPattern = matchSubpaths ? `(\\/[^'"]+)?` : '';
  const re = new RegExp(`(['"])${escaped}${subpathPattern}\\1`, 'g');
  return (fileContent, filePath) => {
    return fileContent.replace(re, (_match, quote, subpath = '') => {
      const target = path.join(distRoot, distEntry);
      let rel = path.relative(path.dirname(filePath), target).split(path.sep).join('/');
      if (!rel.startsWith('.')) rel = './' + rel;
      rel = rel.replace(/\.d\.ts$/, '.js');
      if (matchSubpaths && subpath) rel = rel.replace(/\/index\.js$/, subpath);
      return `${quote}${rel}${quote}`;
    });
  };
}

const RELOCATION_REWRITERS = RELOCATION_RULES.map((rule) => ({
  pkg: rule.pkg,
  rewrite: makeRelocationRewriter(rule),
}));

// Any root specifier added here should also be listed in
// RELOCATION_GUARD_PACKAGES so it cannot fall back to an ambient `any`
// shim after we intentionally skip shim generation. List source:
// type-surface.config.cjs (`unshimmedPrivateSpecifiers`).
const UNSHIMMED_PRIVATE_SPECIFIERS = new Set(typeSurface.unshimmedPrivateSpecifiers);

function shouldSkipWorkspaceShim(mod) {
  return (
    mod.startsWith('.') ||
    mod.startsWith('@superdoc/document-api') ||
    isRelocatedSpecifier(mod) ||
    UNSHIMMED_PRIVATE_SPECIFIERS.has(mod)
  );
}

const dtsFiles = findDtsFiles(distRoot);
for (const filePath of dtsFiles) {
  let fileContent = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Rewrite @superdoc/document-api → relative path to dist/document-api.
  // Run BEFORE the pnpm path rewrite so imports surface as bare paths
  // pointing at the dist tree, not at node_modules.
  const beforeDocApi = fileContent;
  fileContent = rewriteDocApiPaths(fileContent, filePath);
  if (fileContent !== beforeDocApi) {
    changed = true;
    totalReplacements++;
  }

  // SD-2842: apply each relocation rewriter in turn. Each one redirects
  // its own private-package specifier to a relative path in the local dist.
  for (const { rewrite } of RELOCATION_REWRITERS) {
    const before = fileContent;
    fileContent = rewrite(fileContent, filePath);
    if (fileContent !== before) {
      changed = true;
      totalReplacements++;
    }
  }

  // Fix pnpm node_modules paths → bare specifiers
  fileContent = fileContent.replace(PNPM_PATH_RE, (match, quote, _fullPath, packageName) => {
    changed = true;
    totalReplacements++;
    return `${quote}${packageName}${quote}`;
  });

  // Fix broken absolute-looking paths → relative paths
  const relDir = path.relative(path.dirname(filePath), path.join(distRoot, 'superdoc/src'));
  fileContent = fileContent.replace(BAD_ABSOLUTE_PATH_RE, (match, quote, rest) => {
    changed = true;
    totalReplacements++;
    let relativePath = path.posix.join(
      relDir.split(path.sep).join('/'),
      rest,
    );
    // Ensure relative paths start with ./ (bare names are treated as package specifiers)
    if (!relativePath.startsWith('.') && !relativePath.startsWith('/')) {
      relativePath = './' + relativePath;
    }
    return `${quote}${relativePath}${quote}`;
  });

  // Fix broken subpath exports (index.js/types → types.js)
  fileContent = fileContent.replace(BAD_SUBPATH_RE, (match, quote, basePath, subpath) => {
    changed = true;
    totalReplacements++;
    // Replace 'foo/index.js/types' or 'foo/index.ts/types' with 'foo/types.js'
    const dir = basePath.replace(/\/index\.(?:js|ts)$/, '');
    return `${quote}${dir}${subpath}.js${quote}`;
  });

  // Fix .ts extensions in import specifiers → .js
  // vite-plugin-dts preserves .ts extensions from the source when the entry
  // point is a .ts file. TypeScript expects .js extensions in .d.ts files.
  fileContent = fileContent.replace(
    /(?<=from\s+['"]|import\(['"])([^'"]+)\.ts(?=['"])/g,
    (match, pathWithoutExt) => {
      changed = true;
      totalReplacements++;
      return `${pathWithoutExt}.js`;
    },
  );

  // Node16/NodeNext consumers run stricter ESM declaration resolution than
  // bundler consumers. vite-plugin-dts and tsup can emit relative imports like
  // `export * from './foo'` and Vue SFC imports like `./Foo.vue`; rewrite those
  // to `.js` specifiers that TypeScript maps back to the sibling `.d.ts` file.
  fileContent = fileContent.replace(
    /(?<=from\s+['"]|import\(['"])(\.{1,2}\/[^'"]+)(?=['"])/g,
    (specifier) => {
      const rewritten = appendJsExtensionToRelativeSpecifier(specifier, filePath);
      if (rewritten === specifier) return specifier;
      changed = true;
      totalReplacements++;
      return rewritten;
    },
  );

  if (changed) {
    fs.writeFileSync(filePath, fileContent);
    fixedFiles++;
  }
}

if (fixedFiles > 0) {
  console.log(`[ensure-types] ✓ Fixed ${totalReplacements} import paths in ${fixedFiles} .d.ts files`);
}

for (const shim of cjsDeclarationShims) {
  emitCjsDeclarationShim(shim);
}
console.log(`[ensure-types] ✓ Emitted ${cjsDeclarationShims.length} CJS declaration shims`);

const requiredEntryPoints = typeSurface.requiredEntryPoints;

for (const entry of requiredEntryPoints) {
  const fullPath = path.join(distRoot, entry);
  if (!fs.existsSync(fullPath)) {
    console.error(`[ensure-types] Missing ${entry}`);
    process.exit(1);
  }
}
console.log('[ensure-types] ✓ Verified type entry points');

// ---------------------------------------------------------------------------
// SD-2942: the auto-generated `_internal-shims.d.ts` mechanism was removed
// after SD-2893 drained every shim entry to zero. Previously this script
// scanned dist d.ts files for `from '@superdoc/...'` patterns and wrote a
// `declare module 'X' { export type Y = any; }` block for each unrelocated
// specifier — the "soft landing" path that quietly collapsed new private
// types to `any`. With SD-2893 complete, every reachable workspace type
// resolves through `RELOCATION_RULES` or stays bare for audit Rule 1 to
// reject. A future PR that introduces a new private `@superdoc/*` import
// is expected to fail the build at `audit-declarations.cjs` rather than
// ride through silently as `any`. The triple-slash reference directive
// previously injected into entry-point d.ts is also dropped; vite-plugin-dts
// emits clean entries and the next build overwrites any stale references.
// ---------------------------------------------------------------------------

// `shouldSkipWorkspaceShim` is intentionally retained: it is no longer used
// by shim generation, but kept as documentation for the relocation policy
// (relocated specifiers + UNSHIMMED_PRIVATE_SPECIFIERS + document-api public
// surface). Future audit rules that need to
// classify workspace specifiers can reuse it.
void shouldSkipWorkspaceShim;

// Clean up artifacts from the old shim mechanism. vite-plugin-dts overwrites
// entry-point d.ts on each build, so the triple-slash references injected by
// the old code are wiped automatically; only the shim file itself persists
// across builds and needs an explicit unlink.
const legacyShimPath = path.join(distRoot, '_internal-shims.d.ts');
if (fs.existsSync(legacyShimPath)) {
  fs.unlinkSync(legacyShimPath);
  console.log('[ensure-types] ✓ Removed legacy _internal-shims.d.ts');
}
