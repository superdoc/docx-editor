import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Comment, Context, CreateRule, ESTree, Plugin } from '@oxlint/plugins';
import { noComments } from './no-comments.mts';

type MaybeNode = ESTree.Node | null | undefined;
type GuardedFunction = ESTree.Function | ESTree.ArrowFunctionExpression;

interface GuardAtHome {
  name: string;
  home: string;
  from?: string | undefined;
}

interface GuardFromPackage {
  name: string;
  from: string;
}

type ObjectGuard = GuardAtHome | GuardFromPackage;

interface PackageGuard {
  scope: string;
  guard: GuardAtHome;
}

const PUBLIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const toPosix = (file: string): string => file.replaceAll('\\', '/');

const PACKAGE_GUARDS: readonly PackageGuard[] = [
  { scope: 'packages/document-api/', guard: { home: 'packages/document-api/src/object-guards.ts', name: 'isRecord' } },
  { scope: 'packages/sdk/', guard: { home: 'packages/sdk/langs/node/src/guards.ts', name: 'isRecord' } },
  { scope: 'apps/cli/', guard: { home: 'apps/cli/src/lib/guards.ts', name: 'isRecord' } },
  {
    scope: 'packages/layout-engine/contracts/',
    guard: { home: 'packages/layout-engine/contracts/src/ooxml-z-index.ts', name: 'isPlainObject' },
  },
  {
    scope: 'packages/superdoc/',
    guard: { home: 'packages/superdoc/src/helpers/object-guards.ts', name: 'isPlainObject' },
  },
];

const CONTRACTS_GUARD: GuardFromPackage = { name: 'isPlainObject', from: '@superdoc/contracts' };

function packageGuardFor(filename: string): ObjectGuard {
  const relativeFile = toPosix(path.relative(PUBLIC_ROOT, filename));
  return PACKAGE_GUARDS.find(({ scope }) => relativeFile.startsWith(scope))?.guard ?? CONTRACTS_GUARD;
}

function configuredGuard(options: Context['options']): ObjectGuard | undefined {
  const [configured] = options;
  if (configured === undefined) return undefined;
  if (typeof configured !== 'object' || configured === null || Array.isArray(configured)) {
    throw new Error('superdoc/no-local-object-guard options must be an object.');
  }
  const { name, home, from } = configured;
  if (typeof name !== 'string') throw new Error('superdoc/no-local-object-guard needs a name option.');
  const source = typeof from === 'string' ? from : undefined;
  if (typeof home === 'string') return { name, home, from: source };
  if (source !== undefined) return { name, from: source };
  throw new Error('superdoc/no-local-object-guard needs a home or a from option.');
}

function guardLocation(guard: ObjectGuard, base: string, cwd: string): { homeFile: string | null; source: string } {
  if (!('home' in guard)) return { homeFile: null, source: guard.from };
  const homeFile = path.resolve(base, guard.home);
  return { homeFile, source: guard.from ?? toPosix(path.relative(cwd, homeFile)) };
}

function unwrap(node: MaybeNode): MaybeNode {
  if (node?.type === 'TSAsExpression' || node?.type === 'ParenthesizedExpression') return unwrap(node.expression);
  if (
    node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'Boolean' &&
    node.arguments.length === 1
  ) {
    return unwrap(node.arguments[0]);
  }
  return node;
}

function conjuncts(node: MaybeNode): MaybeNode[] {
  const inner = unwrap(node);
  if (inner?.type === 'LogicalExpression' && inner.operator === '&&')
    return [...conjuncts(inner.left), ...conjuncts(inner.right)];
  return [inner];
}

function hasName(node: ESTree.Node, name: string): boolean {
  return 'name' in node && node.name === name;
}

function isParam(node: MaybeNode, name: string): boolean {
  const inner = unwrap(node);
  return inner?.type === 'Identifier' && inner.name === name;
}

function isNull(node: MaybeNode): boolean {
  return node?.type === 'Literal' && node.raw === 'null';
}

function isTypeofParam(node: ESTree.Node, name: string): boolean {
  return node.type === 'UnaryExpression' && node.operator === 'typeof' && isParam(node.argument, name);
}

function isObjectString(node: ESTree.Node): boolean {
  return node.type === 'Literal' && node.value === 'object';
}

function isTypeofObject(node: MaybeNode, name: string): boolean {
  if (node?.type !== 'BinaryExpression' || !['===', '=='].includes(node.operator)) return false;
  return (
    (isTypeofParam(node.left, name) && isObjectString(node.right)) ||
    (isTypeofParam(node.right, name) && isObjectString(node.left))
  );
}

function isArrayIsArrayOfParam(node: ESTree.Node, name: string): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'Array' &&
    hasName(node.callee.property, 'isArray') &&
    isParam(node.arguments[0], name)
  );
}

function isGuardTerm(node: MaybeNode, name: string): boolean {
  if (isTypeofObject(node, name) || isParam(node, name)) return true;
  if (node?.type === 'BinaryExpression' && ['!==', '!='].includes(node.operator)) {
    return (isParam(node.left, name) && isNull(node.right)) || (isParam(node.right, name) && isNull(node.left));
  }
  if (node?.type !== 'UnaryExpression' || node.operator !== '!') return false;
  const inner = node.argument;
  if (inner.type === 'UnaryExpression' && inner.operator === '!') return isParam(inner.argument, name);
  return isArrayIsArrayOfParam(inner, name);
}

function returnedExpression(fn: GuardedFunction): MaybeNode {
  if (fn.body === null) return null;
  if (fn.body.type !== 'BlockStatement') return fn.body;
  const [statement, ...rest] = fn.body.body;
  return rest.length === 0 && statement?.type === 'ReturnStatement' ? statement.argument : null;
}

function isObjectGuard(fn: GuardedFunction): boolean {
  const [param] = fn.params;
  if (fn.params.length !== 1 || param?.type !== 'Identifier') return false;
  const terms = conjuncts(returnedExpression(fn));
  return terms.some((term) => isTypeofObject(term, param.name)) && terms.every((term) => isGuardTerm(term, param.name));
}

const noLocalObjectGuard = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: { home: { type: 'string' }, name: { type: 'string' }, from: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const configured = configuredGuard(context.options);
    const guard = configured ?? packageGuardFor(context.filename);
    const { homeFile, source } = guardLocation(guard, configured ? context.cwd : PUBLIC_ROOT, context.cwd);
    if (context.filename === homeFile) return {};
    const reportObjectGuard = (fn: GuardedFunction): void => {
      if (isObjectGuard(fn)) {
        context.report({
          node: fn,
          message: `Import ${guard.name} from '${source}' instead of defining another object guard.`,
        });
      }
    };
    return {
      FunctionDeclaration: reportObjectGuard,
      VariableDeclarator(node) {
        if (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression')
          reportObjectGuard(node.init);
      },
    };
  },
} satisfies CreateRule;

const LINE_DIRECTIVE = /^\/?\s*@ts-(?:expect-error|ignore|nocheck)\b/;
const BLOCK_DIRECTIVE = /^[/*]*\s*@ts-(?:expect-error|ignore)\b/;
const LINE_BREAK = /\r\n?|[\n\u2028\u2029]/;
const JAVASCRIPT_FILE = /\.[cm]?jsx?$/;

function tsDirective(comment: Comment): string | undefined {
  if (comment.type === 'Line') return comment.value.match(LINE_DIRECTIVE)?.[0];
  const lines = comment.value.split(LINE_BREAK);
  const directiveLine = lines.length === 1 ? `/*${comment.value}` : (lines.at(-1) ?? '').trimStart();
  return directiveLine.match(BLOCK_DIRECTIVE)?.[0];
}

const noTsCommentInJs = {
  meta: { type: 'problem' },
  create(context) {
    if (!JAVASCRIPT_FILE.test(context.filename)) return {};
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const directive = tsDirective(comment);
          if (directive) {
            const name = directive.slice(directive.indexOf('@'));
            context.report({ loc: comment.loc, message: `Fix the type instead of suppressing it with ${name}.` });
          }
        }
      },
    };
  },
} satisfies CreateRule;

export default {
  meta: { name: 'superdoc' },
  rules: {
    'no-comments': noComments,
    'no-local-object-guard': noLocalObjectGuard,
    'no-ts-comment-in-js': noTsCommentInJs,
  },
} satisfies Plugin;
