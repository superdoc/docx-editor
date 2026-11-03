import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const toPosix = (file) => file.replaceAll('\\', '/');

// Each package defines its object guard once. `scope` is a path from ROOT;
// the first match wins, and the last entry covers the rest.
const OBJECT_GUARD_HOMES = [
  { scope: 'packages/document-api/', home: 'packages/document-api/src/object-guards.ts', name: 'isRecord' },
  { scope: 'packages/sdk/', home: 'packages/sdk/langs/node/src/guards.ts', name: 'isRecord' },
  { scope: 'apps/cli/', home: 'apps/cli/src/lib/guards.ts', name: 'isRecord' },
  { scope: 'packages/layout-engine/contracts/', home: 'packages/layout-engine/contracts/src/ooxml-z-index.ts', name: 'isPlainObject' },
  { scope: 'packages/superdoc/', home: 'packages/superdoc/src/helpers/object-guards.ts', name: 'isPlainObject' },
  { scope: '', home: null, name: 'isPlainObject', from: '@superdoc/contracts' },
];

function unwrap(node) {
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

function conjuncts(node) {
  node = unwrap(node);
  if (node?.type === 'LogicalExpression' && node.operator === '&&') return [...conjuncts(node.left), ...conjuncts(node.right)];
  return [node];
}

const isParam = (node, name) => unwrap(node)?.type === 'Identifier' && unwrap(node).name === name;
const isNull = (node) => node?.type === 'Literal' && node.raw === 'null';

function isTypeofObject(node, name) {
  if (node?.type !== 'BinaryExpression' || !['===', '=='].includes(node.operator)) return false;
  const typeofParam = (n) => n.type === 'UnaryExpression' && n.operator === 'typeof' && isParam(n.argument, name);
  const objectString = (n) => n.type === 'Literal' && n.value === 'object';
  return (typeofParam(node.left) && objectString(node.right)) || (typeofParam(node.right) && objectString(node.left));
}

function isGuardTerm(node, name) {
  if (isTypeofObject(node, name) || isParam(node, name)) return true;
  if (node?.type === 'BinaryExpression' && ['!==', '!='].includes(node.operator)) {
    return (isParam(node.left, name) && isNull(node.right)) || (isParam(node.right, name) && isNull(node.left));
  }
  if (node?.type !== 'UnaryExpression' || node.operator !== '!') return false;
  const inner = node.argument;
  if (inner.type === 'UnaryExpression' && inner.operator === '!') return isParam(inner.argument, name);
  return (
    inner.type === 'CallExpression' &&
    inner.callee.type === 'MemberExpression' &&
    inner.callee.object.type === 'Identifier' &&
    inner.callee.object.name === 'Array' &&
    inner.callee.property.name === 'isArray' &&
    isParam(inner.arguments[0], name)
  );
}

function returnedExpression(fn) {
  if (fn.body.type !== 'BlockStatement') return fn.body;
  const [statement, ...rest] = fn.body.body;
  return rest.length === 0 && statement?.type === 'ReturnStatement' ? statement.argument : null;
}

// Matches a one-parameter function whose whole body is `typeof x === 'object'`
// plus null and Array.isArray checks, in any order or spelling.
function isObjectGuard(fn) {
  if (fn.params.length !== 1 || fn.params[0].type !== 'Identifier') return false;
  const name = fn.params[0].name;
  const terms = conjuncts(returnedExpression(fn));
  return terms.some((term) => isTypeofObject(term, name)) && terms.every((term) => isGuardTerm(term, name));
}

const noLocalObjectGuard = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: { home: { type: 'string' }, name: { type: 'string' } },
        required: ['home', 'name'],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [configured] = context.options;
    const guard = configured ?? OBJECT_GUARD_HOMES.find(({ scope }) => toPosix(path.relative(ROOT, context.filename)).startsWith(scope));
    const home = guard.home && path.resolve(configured ? context.cwd : ROOT, guard.home);
    if (context.filename === home) return {};
    const source = guard.from ?? toPosix(path.relative(context.cwd, home));
    const check = (fn) => {
      if (isObjectGuard(fn)) {
        context.report({ node: fn, message: `Import ${guard.name} from '${source}' instead of defining another object guard.` });
      }
    };
    return {
      FunctionDeclaration: check,
      VariableDeclarator(node) {
        if (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression') check(node.init);
      },
    };
  },
};

const LINE_DIRECTIVE = /^\/?\s*@ts-(?:expect-error|ignore|nocheck)\b/;
const BLOCK_DIRECTIVE = /^[/*]*\s*@ts-(?:expect-error|ignore)\b/;

function tsDirective(comment) {
  if (comment.type === 'Line') return comment.value.match(LINE_DIRECTIVE)?.[0];
  const lines = comment.value.split(/\r\n?|[\n\u2028\u2029]/);
  const text = lines.length === 1 ? `/*${comment.value}` : lines.at(-1).trimStart();
  return text.match(BLOCK_DIRECTIVE)?.[0];
}

const noTsCommentInJs = {
  meta: { type: 'problem' },
  create(context) {
    if (!/\.[cm]?jsx?$/.test(context.filename)) return {};
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
};

export default {
  meta: { name: 'superdoc' },
  rules: { 'no-local-object-guard': noLocalObjectGuard, 'no-ts-comment-in-js': noTsCommentInJs },
};
