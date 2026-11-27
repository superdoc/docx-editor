import type { CreateRule, ESTree, Scope, Variable } from '@oxlint/plugins';

export const COPIED_LINES = 4;
export const COPIED_MESSAGE =
  "Don't write out output by hand. Record it with toMatchFileSnapshot, or t.assert.fileSnapshot in node:test, then read the recording, so a change in behavior shows up as a diff.";

const EXACT_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toContain']);
const EXPECT_MODIFIERS = new Set(['not', 'resolves', 'rejects']);
const ASSERT_MODULES = new Set(['assert', 'node:assert', 'assert/strict', 'node:assert/strict']);
const ASSERT_COMPARISONS = new Set(['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual']);
const TEST_MODULES = new Set(['node:test']);
const BOUND_MODULES = new Set([...ASSERT_MODULES, ...TEST_MODULES]);

function propertyName(node: ESTree.MemberExpression): string | null {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

const UNKNOWN = '';

const isNullLiteral = (node: ESTree.Node) => node.type === 'Literal' && node.raw === 'null';

function writtenText(node: ESTree.Node): string {
  if (node.type === 'Literal') {
    const { value } = node;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    return isNullLiteral(node) ? 'null' : UNKNOWN;
  }
  if (node.type === 'TemplateLiteral') {
    return node.quasis
      .map((quasi, index) => {
        const value = node.expressions[index];
        return (quasi.value.cooked ?? '') + (value ? writtenText(value) : '');
      })
      .join('');
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return writtenText(node.left) + writtenText(node.right);
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'ArrayExpression' &&
    propertyName(node.callee) === 'join'
  ) {
    const [separator] = node.arguments;
    return joinedEntries(node.callee.object.elements).join(separator ? writtenText(separator) : UNKNOWN);
  }
  return UNKNOWN;
}

function joinedEntries(elements: ESTree.ArrayExpression['elements']): string[] {
  return elements.flatMap((element) => {
    if (element === null || isNullLiteral(element)) return [''];
    if (element.type !== 'SpreadElement') return [writtenText(element)];
    return element.argument.type === 'ArrayExpression' ? joinedEntries(element.argument.elements) : [];
  });
}

function outputLines(node: ESTree.Node): number {
  return writtenText(node)
    .split('\n')
    .filter((line) => line.trim() !== '').length;
}

function onExpect(node: ESTree.Node): boolean {
  let receiver = node;
  while (receiver.type === 'MemberExpression' && EXPECT_MODIFIERS.has(propertyName(receiver) ?? ''))
    receiver = receiver.object;
  if (receiver.type !== 'CallExpression') return false;
  const { callee } = receiver;
  if (callee.type === 'Identifier') return callee.name === 'expect';
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'expect' &&
    propertyName(callee) === 'soft'
  );
}

function assertImports(program: ESTree.Program) {
  const modules = new Set<string>();
  const comparisons = new Set<string>();
  const tests = new Set<string>();
  const bind = (source: string, imported: string | null, local: string) => {
    if (TEST_MODULES.has(source)) tests.add(local);
    else if (imported === null || imported === 'strict') modules.add(local);
    else if (ASSERT_COMPARISONS.has(imported)) comparisons.add(local);
  };
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration' && BOUND_MODULES.has(statement.source.value)) {
      const source = statement.source.value;
      for (const specifier of statement.specifiers) {
        if (specifier.type !== 'ImportSpecifier') bind(source, null, specifier.local.name);
        else if (specifier.imported.type === 'Identifier') bind(source, specifier.imported.name, specifier.local.name);
      }
    }
    if (statement.type !== 'VariableDeclaration') continue;
    for (const { id, init } of statement.declarations) {
      const source = init ? requiredModule(init) : null;
      if (source === null) continue;
      if (id.type === 'Identifier') bind(source, null, id.name);
      if (id.type !== 'ObjectPattern') continue;
      for (const property of id.properties) {
        if (property.type === 'Property' && property.key.type === 'Identifier' && property.value.type === 'Identifier')
          bind(source, property.key.name, property.value.name);
      }
    }
  }
  return { modules, comparisons, tests };
}

function requiredModule(node: ESTree.Expression): string | null {
  if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'require')
    return null;
  const [source] = node.arguments;
  return source?.type === 'Literal' && typeof source.value === 'string' && BOUND_MODULES.has(source.value)
    ? source.value
    : null;
}

type AssertBindings = ReturnType<typeof assertImports>;
type ScopeLookup = (node: ESTree.Node) => Scope;

function resolve(node: ESTree.Node, name: string, scopeOf: ScopeLookup): Variable | null {
  for (let scope: Scope | null = scopeOf(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable;
  }
  return null;
}

function declaredAtTopLevel(node: ESTree.Node, name: string, scopeOf: ScopeLookup): boolean {
  return resolve(node, name, scopeOf)?.scope.block.type === 'Program';
}

function isTestFunction(node: ESTree.Node, assert: AssertBindings, scopeOf: ScopeLookup): boolean {
  if (node.type === 'Identifier') return assert.tests.has(node.name) && declaredAtTopLevel(node, node.name, scopeOf);
  if (node.type !== 'MemberExpression' || node.object.type !== 'Identifier') return false;
  return isTestFunction(node.object, assert, scopeOf) || isTestContext(node.object, assert, scopeOf);
}

function isTestContext(node: ESTree.IdentifierReference, assert: AssertBindings, scopeOf: ScopeLookup): boolean {
  const definition = resolve(node, node.name, scopeOf)?.defs[0];
  if (definition?.type !== 'Parameter') return false;
  const callback = definition.node;
  if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') return false;
  const [context] = callback.params;
  if (context?.type !== 'Identifier' || context.name !== node.name) return false;
  const call = callback.parent;
  return (
    call.type === 'CallExpression' &&
    call.arguments.some((argument) => argument === callback) &&
    isTestFunction(call.callee, assert, scopeOf)
  );
}

function isAssertReceiver(node: ESTree.Node, assert: AssertBindings, scopeOf: ScopeLookup): boolean {
  if (node.type === 'Identifier') return assert.modules.has(node.name) && declaredAtTopLevel(node, node.name, scopeOf);
  if (node.type !== 'MemberExpression') return false;
  const name = propertyName(node);
  if (name === 'strict') return isAssertReceiver(node.object, assert, scopeOf);
  return name === 'assert' && node.object.type === 'Identifier' && isTestContext(node.object, assert, scopeOf);
}

function expectedArgument(node: ESTree.CallExpression, assert: AssertBindings, scopeOf: ScopeLookup) {
  const { callee } = node;
  if (callee.type === 'Identifier')
    return assert.comparisons.has(callee.name) && declaredAtTopLevel(callee, callee.name, scopeOf)
      ? node.arguments[1]
      : undefined;
  if (callee.type !== 'MemberExpression') return undefined;
  const name = propertyName(callee) ?? '';
  if (isAssertReceiver(callee.object, assert, scopeOf))
    return ASSERT_COMPARISONS.has(name) ? node.arguments[1] : undefined;
  return EXACT_MATCHERS.has(name) && onExpect(callee.object) ? node.arguments[0] : undefined;
}

export const noHandCopiedOutput = {
  meta: { type: 'suggestion' },
  create(context) {
    let assert: AssertBindings = { modules: new Set(), comparisons: new Set(), tests: new Set() };
    return {
      Program(program) {
        assert = assertImports(program);
      },
      CallExpression(node) {
        const expected = expectedArgument(node, assert, (scoped) => context.sourceCode.getScope(scoped));
        if (expected && outputLines(expected) >= COPIED_LINES)
          context.report({ node: expected, message: COPIED_MESSAGE });
      },
    };
  },
} satisfies CreateRule;

export const COPIED_PIECES = 4;
export const COPIED_PIECE_LENGTH = 40;
export const PIECES_MESSAGE =
  "Don't copy output one piece at a time. Record the whole value with toMatchFileSnapshot, or t.assert.fileSnapshot in node:test, so a change in behavior shows up as a diff.";

type Block = ESTree.Program | ESTree.BlockStatement | ESTree.StaticBlock;

function isStableValue(node: ESTree.Node): boolean {
  if (node.type === 'Identifier') return true;
  if (node.type === 'ChainExpression' || node.type === 'TSNonNullExpression') return isStableValue(node.expression);
  return (
    node.type === 'MemberExpression' &&
    (!node.computed || node.property.type === 'Literal') &&
    isStableValue(node.object)
  );
}

function copiedPiece(statement: ESTree.Node): { subject: ESTree.Node; expected: ESTree.Node } | null {
  if (statement.type !== 'ExpressionStatement') return null;
  const call = statement.expression;
  if (call.type !== 'CallExpression' || call.callee.type !== 'MemberExpression') return null;
  const receiver = call.callee.object;
  if (propertyName(call.callee) !== 'toContain' || receiver.type !== 'CallExpression' || !onExpect(receiver))
    return null;
  const [subject] = receiver.arguments;
  const [expected] = call.arguments;
  if (!subject || !expected || subject.type === 'SpreadElement' || expected.type === 'SpreadElement') return null;
  return isStableValue(subject) && writtenText(expected).length >= COPIED_PIECE_LENGTH ? { subject, expected } : null;
}

export const noPieceByPieceOutput = {
  meta: { type: 'suggestion' },
  create(context) {
    const check = (block: Block) => {
      let subject = '';
      let pieces: ESTree.Node[] = [];
      const flush = () => {
        const [first] = pieces;
        if (first && pieces.length >= COPIED_PIECES) context.report({ node: first, message: PIECES_MESSAGE });
        pieces = [];
      };
      for (const statement of block.body) {
        const piece = copiedPiece(statement);
        const text = piece ? context.sourceCode.getText(piece.subject) : '';
        if (!piece || text !== subject) flush();
        subject = text;
        if (piece) pieces.push(piece.expected);
      }
      flush();
    };
    return { Program: check, BlockStatement: check, StaticBlock: check };
  },
} satisfies CreateRule;
