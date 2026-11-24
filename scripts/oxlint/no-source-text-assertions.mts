import type { CreateRule, ESTree, Scope, Variable } from '@oxlint/plugins';

export const SOURCE_TEXT_MESSAGE =
  "Don't assert that source code contains text. Test what the code does. To ban a pattern, use not.toContain or not.toMatch, or a lint rule.";

const SOURCE_PATH = /\.(?:[cm]?[jt]sx?|vue)(?:\?raw)?$/;
const RAW_SOURCE_IMPORT = /\.(?:[cm]?[jt]sx?|vue)\?raw$/;
const READERS = new Set(['readFileSync', 'readFile']);
const TEMPORARY = new Set(['mkdtempSync', 'mkdtemp', 'tmpdir']);
const LOCATION_GLOBALS = new Set(['__dirname', '__filename']);
const EXPECT_MODIFIERS = new Set(['resolves', 'rejects']);
const TEXT_MATCHERS = new Set(['toContain', 'toMatch']);
const TRUE_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);
const TEXT_QUERIES = new Set(['includes', 'match', 'test', 'startsWith', 'endsWith', 'search']);
const ASSERT_NAMES = new Set(['assert', 'ok']);

type Node = ESTree.Node;
type ScopeLookup = (node: Node) => Scope;

function propertyName(node: ESTree.MemberExpression): string | null {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

function children(node: Node): Node[] {
  const found: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || value === null || typeof value !== 'object') continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && typeof item === 'object' && typeof item.type === 'string') found.push(item);
    }
  }
  return found;
}

function some(node: Node, test: (node: Node) => boolean): boolean {
  if (test(node)) return true;
  return children(node).some((child) => some(child, test));
}

function each(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const child of children(node)) each(child, visit);
}

function calleeName(node: ESTree.CallExpression): string | null {
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name;
  return callee.type === 'MemberExpression' ? propertyName(callee) : null;
}

const isReadCall = (node: Node): node is ESTree.CallExpression =>
  node.type === 'CallExpression' && READERS.has(calleeName(node) ?? '');

const isImportMeta = (node: Node) =>
  node.type === 'MemberExpression' && node.object.type === 'MetaProperty' && node.object.meta.name === 'import';

const isProcessCwd = (node: Node) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === 'process' &&
  propertyName(node.callee) === 'cwd';

const isLocation = (node: Node) =>
  isImportMeta(node) || isProcessCwd(node) || (node.type === 'Identifier' && LOCATION_GLOBALS.has(node.name));

const isTemporary = (node: Node) => node.type === 'CallExpression' && TEMPORARY.has(calleeName(node) ?? '');

const BUILD_OUTPUT = /(?:^|[\\/])dist(?:-[\w.-]+)?(?:[\\/]|$)/;

const isBuildOutputMarker = (node: Node) =>
  (node.type === 'Literal' && typeof node.value === 'string' && BUILD_OUTPUT.test(node.value)) ||
  (node.type === 'TemplateElement' && BUILD_OUTPUT.test(node.value.cooked ?? '')) ||
  (node.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === 'process' &&
    propertyName(node) === 'env');

const isPlaceholder = (node: Node | null | undefined) =>
  !node ||
  node.type === 'Literal' ||
  (node.type === 'TemplateLiteral' && node.expressions.length === 0) ||
  (node.type === 'Identifier' && node.name === 'undefined');

const isSourcePathText = (node: Node) =>
  (node.type === 'Literal' && typeof node.value === 'string' && SOURCE_PATH.test(node.value)) ||
  (node.type === 'TemplateElement' && SOURCE_PATH.test(node.value.cooked ?? ''));

const isFunction = (node: Node): node is ESTree.Function | ESTree.ArrowFunctionExpression =>
  node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';

function returnedValues(fn: ESTree.Function | ESTree.ArrowFunctionExpression): Node[] {
  const returned: Node[] = [];
  if (fn.type === 'ArrowFunctionExpression' && fn.expression) returned.push(fn.body);
  each(fn, (node) => {
    if (node.type === 'ReturnStatement' && node.argument) returned.push(node.argument);
  });
  return returned;
}

function expectSubject(node: ESTree.MemberExpression): { subject: Node; negated: boolean } | null {
  let receiver: Node = node.object;
  let negated = false;
  while (receiver.type === 'MemberExpression') {
    const name = propertyName(receiver) ?? '';
    if (name === 'not') negated = !negated;
    else if (!EXPECT_MODIFIERS.has(name)) return null;
    receiver = receiver.object;
  }
  if (receiver.type !== 'CallExpression') return null;
  const { callee } = receiver;
  const isExpect =
    (callee.type === 'Identifier' && callee.name === 'expect') ||
    (callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'expect' &&
      propertyName(callee) === 'soft');
  const [subject] = receiver.arguments;
  return isExpect && subject ? { subject, negated } : null;
}

const isTrue = (node: Node | undefined) => node?.type === 'Literal' && node.value === true;

const isTextQuery = (node: Node): boolean =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  TEXT_QUERIES.has(propertyName(node.callee) ?? '');

function assertedText(node: ESTree.CallExpression): Node | null {
  const { callee } = node;
  const [first] = node.arguments;
  if (!first) return null;
  if (callee.type === 'Identifier') return ASSERT_NAMES.has(callee.name) && isTextQuery(first) ? first : null;
  if (callee.type !== 'MemberExpression') return null;
  const name = propertyName(callee) ?? '';
  const matcher = expectSubject(callee);
  if (matcher) {
    if (matcher.negated) return null;
    if (TEXT_MATCHERS.has(name)) return matcher.subject;
    const affirms =
      (TRUE_MATCHERS.has(name) && isTrue(first)) ||
      (name === 'toHaveLength' && !(first.type === 'Literal' && first.value === 0));
    return affirms && isTextQuery(matcher.subject) ? matcher.subject : null;
  }
  if (callee.object.type !== 'Identifier' || callee.object.name !== 'assert') return null;
  if (name === 'match') return first;
  return name === 'ok' && isTextQuery(first) ? first : null;
}

function sourceTextFacts(program: ESTree.Program, scopeOf: ScopeLookup, declaredBy: (node: Node) => Variable[]) {
  const variableOf = (node: Node) => (node.type === 'Identifier' ? resolve(node, node.name, scopeOf) : null);
  const declarators: ESTree.VariableDeclarator[] = [];
  const assignments: ESTree.AssignmentExpression[] = [];
  const loops: ESTree.ForOfStatement[] = [];
  const calls: ESTree.CallExpression[] = [];
  const functions = new Map<Variable, ESTree.Function | ESTree.ArrowFunctionExpression>();
  const anchored = new Set<Variable>();
  const outputs = new Set<Variable>();
  const sourcePaths = new Set<Variable>();
  const tainted = new Set<Variable>();
  each(program, (node) => {
    if (node.type === 'VariableDeclarator') declarators.push(node);
    if (node.type === 'AssignmentExpression' && node.operator === '=') assignments.push(node);
    if (node.type === 'ForOfStatement') loops.push(node);
    if (node.type === 'CallExpression') calls.push(node);
    if (node.type === 'FunctionDeclaration') for (const variable of declaredBy(node)) functions.set(variable, node);
    if (node.type === 'VariableDeclarator' && node.init && isFunction(node.init)) {
      const variable = variableOf(node.id);
      if (variable) functions.set(variable, node.init);
    }
  });

  const references = (node: Node, variables: Set<Variable>) =>
    some(node, (child) => {
      const variable = variableOf(child);
      return variable !== null && variables.has(variable);
    });
  const isAnchored = (node: Node) => !some(node, isTemporary) && (some(node, isLocation) || references(node, anchored));
  const namesSourcePath = (node: Node) => some(node, isSourcePathText) || references(node, sourcePaths);
  const isBuildOutput = (node: Node): boolean => {
    if (node.type === 'ConditionalExpression') return isBuildOutput(node.consequent) || isBuildOutput(node.alternate);
    if (node.type === 'BinaryExpression')
      return node.operator === '+' && (isBuildOutput(node.left) || isBuildOutput(node.right));
    if (node.type === 'UnaryExpression') return false;
    if (isBuildOutputMarker(node)) return true;
    const variable = variableOf(node);
    if (variable !== null) return outputs.has(variable);
    return children(node).some(isBuildOutput);
  };
  const fixpoint = (step: () => boolean) => {
    while (step());
  };
  const mark = (variables: Set<Variable>, variable: Variable | null) => {
    if (variable === null || variables.has(variable)) return false;
    variables.add(variable);
    return true;
  };
  fixpoint(() =>
    declarators.reduce(
      (changed, { id, init }) =>
        (!!init && isAnchored(init) && mark(anchored, variableOf(id))) ||
        (!!init && isBuildOutput(init) && mark(outputs, variableOf(id))) ||
        (!!init && namesSourcePath(init) && mark(sourcePaths, variableOf(id))) ||
        changed,
      false,
    ),
  );

  const repositoryPath = (node: Node): Node | null => {
    const [path] = isReadCall(node) ? node.arguments : [];
    if (!path || isBuildOutput(path)) return null;
    return isAnchored(path) || (path.type === 'Literal' && isSourcePathText(path)) ? path : null;
  };
  const readsSourcePath = (node: Node) => {
    const path = repositoryPath(node);
    return path !== null && namesSourcePath(path);
  };
  const declaredValue = (node: Node) => {
    const definition = variableOf(node)?.defs[0]?.node;
    return definition?.type === 'VariableDeclarator' && definition.init ? definition.init : node;
  };
  const readers = new Map<Variable, boolean>();
  for (const [variable, fn] of functions) {
    const returned = returnedValues(fn).map(declaredValue);
    if (returned.some((value) => some(value, (child) => repositoryPath(child) !== null)))
      readers.set(
        variable,
        returned.some((value) => some(value, readsSourcePath)),
      );
  }
  const readsSource = (node: ESTree.CallExpression): boolean => {
    if (repositoryPath(node) !== null) return readsSourcePath(node);
    const callee = variableOf(node.callee);
    const reader = callee ? readers.get(callee) : undefined;
    return reader !== undefined && (reader || node.arguments.some(namesSourcePath));
  };

  const writes = new Map<Variable, { at: number; value: Node | null | undefined }[]>();
  const write = (variable: Variable | null, at: number, value: Node | null | undefined) => {
    if (variable) writes.set(variable, [...(writes.get(variable) ?? []), { at, value }]);
  };
  for (const declarator of declarators) write(variableOf(declarator.id), declarator.start, declarator.init);
  for (const assignment of assignments) write(variableOf(assignment.left), assignment.start, assignment.right);

  const isTainted = (node: Node, at = Infinity, assumed: Variable | null = null): boolean => {
    const carries = (child: Node) => isTainted(child, at, assumed);
    switch (node.type) {
      case 'Identifier': {
        const variable = variableOf(node);
        if (variable === null) return false;
        if (variable === assumed) return true;
        return tainted.has(variable) && !replacedBefore(variable, at);
      }
      case 'CallExpression':
        if (readsSource(node)) return true;
        if (node.callee.type !== 'MemberExpression') return false;
        if (carries(node.callee.object)) return true;
        return propertyName(node.callee) === 'test' && node.arguments.some(carries);
      case 'MemberExpression':
        return carries(node.object);
      case 'Property':
        return carries(node.value);
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'FunctionDeclaration':
        return false;
      default:
        return children(node).some(carries);
    }
  };
  const replacedBefore = (variable: Variable, at: number) => {
    const last = (writes.get(variable) ?? [])
      .filter((entry) => entry.at < at)
      .reduce<{ at: number; value: Node | null | undefined } | null>(
        (latest, entry) => (latest === null || entry.at > latest.at ? entry : latest),
        null,
      );
    if (last === null || !last.value || isPlaceholder(last.value)) return false;
    return !isTainted(last.value, last.at, variable);
  };
  const taintAll = (variables: Variable[]) =>
    variables.reduce((changed, variable) => mark(tainted, variable) || changed, false);
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration' && RAW_SOURCE_IMPORT.test(statement.source.value))
      taintAll(declaredBy(statement));
  }
  fixpoint(() => {
    let changed = false;
    for (const declarator of declarators) {
      if (declarator.init && isTainted(declarator.init)) changed = taintAll(declaredBy(declarator)) || changed;
    }
    for (const { left, right } of assignments) {
      if (left.type === 'Identifier' && isTainted(right)) changed = mark(tainted, variableOf(left)) || changed;
    }
    for (const loop of loops) {
      if (loop.left.type === 'VariableDeclaration' && isTainted(loop.right))
        changed = taintAll(declaredBy(loop.left)) || changed;
    }
    for (const call of calls) {
      if (call.callee.type !== 'MemberExpression' || !isTainted(call.callee.object)) continue;
      for (const argument of call.arguments) {
        if (argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression')
          changed =
            taintAll(declaredBy(argument).filter((variable) => variable.defs[0]?.type === 'Parameter')) || changed;
      }
    }
    return changed;
  });
  return { isTaintedAt: (node: Node, at: number) => isTainted(node, at) };
}

function resolve(node: Node, name: string, scopeOf: ScopeLookup): Variable | null {
  for (let scope: Scope | null = scopeOf(node); scope; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable) return variable;
  }
  return null;
}

export const noSourceTextAssertions = {
  meta: { type: 'suggestion' },
  create(context) {
    let facts: ReturnType<typeof sourceTextFacts> | null = null;
    return {
      Program(program) {
        facts = sourceTextFacts(
          program,
          (node) => context.sourceCode.getScope(node),
          (node) => context.sourceCode.getDeclaredVariables(node),
        );
      },
      CallExpression(node) {
        const subject = assertedText(node);
        if (subject && facts?.isTaintedAt(subject, node.start)) context.report({ node, message: SOURCE_TEXT_MESSAGE });
      },
    };
  },
} satisfies CreateRule;
