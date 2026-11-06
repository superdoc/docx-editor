import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

export interface ClosureFile {
  file: string;
  gzipBytes: number;
}

export interface ClosureSize {
  entry: string;
  files: ClosureFile[];
  gzipBytes: number;
}

export interface EntryGzipBudget {
  entry: string;
  limitBytes: number;
}

export interface BudgetReport {
  failures: string[];
  summaries: string[];
}

const LARGEST_FILES_SHOWN = 5;

export function gzipSize(contents: Buffer): number {
  return gzipSync(contents, { level: 9 }).length;
}

export function staticImportSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

export function eagerRequireSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassElement(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const [argument] = node.arguments;
      if (node.arguments.length === 1 && argument !== undefined && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

type ModuleKind = 'stylesheet' | 'esm' | 'commonjs';

function packageTypeIsCommonJs(packageJsonPath: string): boolean {
  const manifest: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return !(typeof manifest === 'object' && manifest !== null && 'type' in manifest && manifest.type === 'module');
}

function nearestPackageIsCommonJs(root: string, file: string): boolean {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const packageJsonPath = path.join(directory, 'package.json');
    if (existsSync(packageJsonPath)) return packageTypeIsCommonJs(packageJsonPath);
    if (directory === root) return false;
  }
}

function moduleKind(root: string, file: string): ModuleKind {
  const extension = path.extname(file);
  if (extension === '.css') return 'stylesheet';
  if (extension === '.cjs') return 'commonjs';
  if (extension === '.js' && nearestPackageIsCommonJs(root, file)) return 'commonjs';
  return 'esm';
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
}

function displayPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function requireFileInRoot(root: string, absolute: string, reference: string): void {
  const relative = path.relative(root, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${reference} resolves outside ${root}`);
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${reference} does not exist`);
  }
}

export function measureStaticClosure(root: string, entry: string): ClosureSize {
  const resolvedRoot = path.resolve(root);
  const entryPath = path.resolve(resolvedRoot, entry);
  requireFileInRoot(resolvedRoot, entryPath, `entry ${entry}`);

  const visited = new Set<string>([entryPath]);
  const pending = [entryPath];
  const files: ClosureFile[] = [];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    const contents = readFileSync(current);
    files.push({ file: displayPath(resolvedRoot, current), gzipBytes: gzipSize(contents) });
    const kind = moduleKind(resolvedRoot, current);
    if (kind === 'stylesheet') continue;
    const source = contents.toString('utf8');
    const specifiers =
      kind === 'commonjs' ? eagerRequireSpecifiers(source, current) : staticImportSpecifiers(source, current);
    const verb = kind === 'commonjs' ? 'requires' : 'imports';
    for (const specifier of specifiers) {
      if (!isLocalSpecifier(specifier)) continue;
      const target = path.resolve(path.dirname(current), specifier);
      requireFileInRoot(resolvedRoot, target, `${displayPath(resolvedRoot, current)} ${verb} ${specifier}, which`);
      if (visited.has(target)) continue;
      visited.add(target);
      pending.push(target);
    }
  }

  files.sort((left, right) => right.gzipBytes - left.gzipBytes || left.file.localeCompare(right.file));
  return { entry, files, gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0) };
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function checkEntryBudget(size: ClosureSize, limitBytes: number): string | null {
  if (size.gzipBytes <= limitBytes) return null;
  const largest = size.files
    .slice(0, LARGEST_FILES_SHOWN)
    .map((file) => `      ${file.file}: ${file.gzipBytes} B (${formatKiB(file.gzipBytes)})`);
  return [
    `${size.entry} static-closure gzip size is ${size.gzipBytes} B (${formatKiB(size.gzipBytes)}), ` +
      `over its ${limitBytes} B (${formatKiB(limitBytes)}) limit by ${size.gzipBytes - limitBytes} B ` +
      `across ${size.files.length} file(s). Largest files:`,
    ...largest,
  ].join('\n');
}

export function auditEntryGzipBudgets(root: string, budgets: readonly EntryGzipBudget[]): BudgetReport {
  const failures: string[] = [];
  const summaries: string[] = [];
  for (const budget of budgets) {
    let size: ClosureSize;
    try {
      size = measureStaticClosure(root, budget.entry);
    } catch (error) {
      failures.push(
        `${budget.entry} static closure could not be measured: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const failure = checkEntryBudget(size, budget.limitBytes);
    if (failure !== null) failures.push(failure);
    else {
      summaries.push(
        `${budget.entry}: ${size.gzipBytes} B gzip across ${size.files.length} file(s), ` +
          `limit ${budget.limitBytes} B (${((size.gzipBytes / budget.limitBytes) * 100).toFixed(1)}%)`,
      );
    }
  }
  return { failures, summaries };
}
