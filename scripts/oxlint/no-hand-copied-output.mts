import type { CreateRule, ESTree } from '@oxlint/plugins';

export const COPIED_LINES = 4;
export const COPIED_MESSAGE =
  "Don't write out output by hand. Record it with toMatchFileSnapshot, then read the recording, so a change in behavior shows up as a diff.";

const EXACT_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toContain']);
const EXPECT_MODIFIERS = new Set(['not', 'resolves', 'rejects']);

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

export const noHandCopiedOutput = {
  meta: { type: 'suggestion' },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return;
        if (!EXACT_MATCHERS.has(propertyName(node.callee) ?? '')) return;
        if (!onExpect(node.callee.object)) return;
        const [expected] = node.arguments;
        if (expected && outputLines(expected) >= COPIED_LINES)
          context.report({ node: expected, message: COPIED_MESSAGE });
      },
    };
  },
} satisfies CreateRule;
