import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PUBLIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOCS_TSCONFIG = path.join(PUBLIC_ROOT, 'apps/docs/tsconfig.json');
const SUBSCRIPTION_METHODS: readonly string[] = [
  'on',
  'once',
  'off',
  'addListener',
  'removeListener',
  'removeAllListeners',
];
const SUPERDOC_SPECIFIER = /^(?:superdoc|@superdoc\/[^/]+)(?:\/|$)/;
const SOURCE_FILE = /\.tsx?$/;
const REPLACE_WITH = /replaceWith=(.+?)(?=\s+\w+=|$)/s;

export interface DeprecatedEvent {
  name: string;
  replacement: string;
}

export interface Finding {
  file: string;
  line: number;
  method: string;
  event: string;
  replacement: string;
}

export interface CheckOptions {
  files: readonly string[];
  tsconfigPath?: string;
  root?: string;
}

export interface CheckResult {
  deprecatedEvents: DeprecatedEvent[];
  findings: Finding[];
}

export class CheckSetupError extends Error {}

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => SOURCE_FILE.test(file) && !file.split(path.sep).includes('node_modules'))
    .map((file) => path.join(dir, file));
}

export function educationalFiles(root: string = PUBLIC_ROOT): string[] {
  const examplesRoot = path.join(root, 'examples');
  const exampleSources = readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(examplesRoot, entry.name, 'src'))
    .filter((src) => ts.sys.directoryExists(src))
    .flatMap(sourceFilesUnder);
  return [...sourceFilesUnder(path.join(root, 'apps/docs/snippets')), ...exampleSources].sort();
}

function compilerOptions(tsconfigPath: string): ts.CompilerOptions {
  const read = ts.readConfigFile(tsconfigPath, (file) => ts.sys.readFile(file));
  if (read.error !== undefined) {
    throw new CheckSetupError(
      `Cannot read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'));
    throw new CheckSetupError(`Cannot parse ${tsconfigPath}: ${messages.join('; ')}`);
  }
  return { ...parsed.options, noEmit: true, incremental: false, composite: false, tsBuildInfoFile: undefined };
}

function resolveSuperDocEntry(tsconfigPath: string, options: ts.CompilerOptions): string {
  const importer = path.join(path.dirname(tsconfigPath), 'index.ts');
  const resolved = ts.resolveModuleName('superdoc', importer, options, ts.sys).resolvedModule;
  if (resolved === undefined) throw new CheckSetupError(`'superdoc' does not resolve through ${tsconfigPath}.`);
  return resolved.resolvedFileName;
}

function superDocClass(program: ts.Program, checker: ts.TypeChecker, entry: string): ts.Symbol {
  const entryFile = program.getSourceFile(entry);
  const moduleSymbol = entryFile === undefined ? undefined : checker.getSymbolAtLocation(entryFile);
  if (moduleSymbol === undefined) throw new CheckSetupError(`Cannot load the 'superdoc' entry ${entry}.`);
  const exported = checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === 'SuperDoc');
  if (exported === undefined) throw new CheckSetupError(`${entry} does not export SuperDoc.`);
  const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  if (!(target.flags & ts.SymbolFlags.Class))
    throw new CheckSetupError(`SuperDoc exported by ${entry} is not a class.`);
  return target;
}

function subscriptionDeclarations(checker: ts.TypeChecker, superDoc: ts.Symbol): Map<string, ts.Declaration[]> {
  const instance = checker.getDeclaredTypeOfSymbol(superDoc);
  const classDeclarations = new Set<ts.Node>(superDoc.declarations ?? []);
  const methods = new Map<string, ts.Declaration[]>();
  for (const name of SUBSCRIPTION_METHODS) {
    const declarations = (instance.getProperty(name)?.declarations ?? []).filter((declaration) =>
      classDeclarations.has(declaration.parent),
    );
    if (declarations.length === 0) throw new CheckSetupError(`SuperDoc does not declare its own ${name}().`);
    methods.set(name, declarations);
  }
  return methods;
}

function eventMapType(checker: ts.TypeChecker, onDeclarations: readonly ts.Declaration[]): ts.Type {
  for (const declaration of onDeclarations) {
    if (!ts.isMethodDeclaration(declaration)) continue;
    const constraint = declaration.typeParameters?.[0]?.constraint;
    if (
      constraint !== undefined &&
      ts.isTypeOperatorNode(constraint) &&
      constraint.operator === ts.SyntaxKind.KeyOfKeyword
    ) {
      return checker.getTypeFromTypeNode(constraint.type);
    }
  }
  throw new CheckSetupError(
    'Cannot find the event map: SuperDoc.on() is no longer typed `K extends keyof <EventMap>`.',
  );
}

function deprecatedEvents(checker: ts.TypeChecker, eventMap: ts.Type): DeprecatedEvent[] {
  const events: DeprecatedEvent[] = [];
  for (const property of eventMap.getProperties()) {
    const tag = property.getJsDocTags(checker).find((candidate) => candidate.name === 'deprecated');
    if (tag === undefined) continue;
    const text = ts.displayPartsToString(tag.text).trim();
    const replacement = REPLACE_WITH.exec(text)?.[1]?.trim() ?? text;
    events.push({ name: property.name, replacement });
  }
  if (events.length === 0) {
    throw new CheckSetupError('Found no @deprecated keys on the SuperDoc event map; the JSDoc reader is broken.');
  }
  return events.sort((a, b) => a.name.localeCompare(b.name));
}

function unresolvedSuperDocImports(checker: ts.TypeChecker, sourceFile: ts.SourceFile): ts.StringLiteral[] {
  const unresolved: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = typeBearingSpecifier(node);
    if (
      specifier !== undefined &&
      SUPERDOC_SPECIFIER.test(specifier.text) &&
      checker.getSymbolAtLocation(specifier) === undefined
    ) {
      unresolved.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return unresolved;
}

function typeBearingSpecifier(node: ts.Node): ts.StringLiteral | undefined {
  if (ts.isImportDeclaration(node) && node.importClause !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier;
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [argument] = node.arguments;
    if (argument !== undefined && ts.isStringLiteral(argument)) return argument;
  }
  return undefined;
}

function calledMethodName(callee: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return undefined;
}

function literalEventName(checker: ts.TypeChecker, argument: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(argument)) return argument.text;
  const type = checker.getTypeAtLocation(argument);
  return type.isStringLiteral() ? type.value : undefined;
}

export function checkDeprecatedEvents({
  files,
  tsconfigPath = DOCS_TSCONFIG,
  root = PUBLIC_ROOT,
}: CheckOptions): CheckResult {
  const options = compilerOptions(tsconfigPath);
  const entry = resolveSuperDocEntry(tsconfigPath, options);
  const program = ts.createProgram({ rootNames: [...files, entry], options });
  const checker = program.getTypeChecker();
  const methods = subscriptionDeclarations(checker, superDocClass(program, checker, entry));
  const subscriptionDeclarationSet = new Set<ts.Node>([...methods.values()].flat());
  const deprecated = deprecatedEvents(checker, eventMapType(checker, methods.get('on') ?? []));
  const replacementByEvent = new Map(deprecated.map((event) => [event.name, event.replacement]));

  const unresolved: string[] = [];
  const findings: Finding[] = [];
  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) throw new CheckSetupError(`Cannot load ${file}.`);
    const relative = path.relative(root, file);
    const lineOf = (node: ts.Node): number =>
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    for (const specifier of unresolvedSuperDocImports(checker, sourceFile)) {
      unresolved.push(`${relative}:${lineOf(specifier)} '${specifier.text}'`);
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const method = calledMethodName(node.expression);
        const [argument] = node.arguments;
        const declaration = method === undefined ? undefined : checker.getResolvedSignature(node)?.declaration;
        if (
          method !== undefined &&
          argument !== undefined &&
          declaration !== undefined &&
          subscriptionDeclarationSet.has(declaration)
        ) {
          const event = literalEventName(checker, argument);
          const replacement = event === undefined ? undefined : replacementByEvent.get(event);
          if (event !== undefined && replacement !== undefined)
            findings.push({ file: relative, line: lineOf(node), method, event, replacement });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  if (unresolved.length > 0) {
    throw new CheckSetupError(
      `SuperDoc imports do not resolve, so receivers cannot be checked:\n  ${unresolved.sort().join('\n  ')}`,
    );
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.event.localeCompare(b.event));
  return { deprecatedEvents: deprecated, findings };
}

export function formatFinding({ file, line, method, event, replacement }: Finding): string {
  return `${file}:${line} ${method}('${event}') subscribes to a deprecated SuperDoc event; use ${replacement} instead.`;
}

function main(): number {
  const started = performance.now();
  const files = educationalFiles();
  try {
    const { deprecatedEvents: events, findings } = checkDeprecatedEvents({ files });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (findings.length > 0) {
      console.error(findings.map(formatFinding).join('\n'));
      console.error(`check-deprecated-events: ${findings.length} deprecated SuperDoc event subscription(s).`);
      return 1;
    }
    console.log(
      `check-deprecated-events: ${files.length} files clean against ${events.length} deprecated events (${events.map((event) => event.name).join(', ')}) in ${seconds}s.`,
    );
    return 0;
  } catch (error) {
    console.error(`check-deprecated-events failed closed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
