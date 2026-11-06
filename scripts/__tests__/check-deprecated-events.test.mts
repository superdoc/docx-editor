import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import {
  CheckSetupError,
  checkDeprecatedEvents,
  educationalFiles,
  formatFinding,
} from '../check-deprecated-events.mts';
import type { CheckResult } from '../check-deprecated-events.mts';

function checkSources(sources: Record<string, string>, useOwnTsconfig = false): CheckResult {
  const dir = mkdtempSync(join(os.tmpdir(), 'check-deprecated-events-'));
  try {
    for (const [name, source] of Object.entries(sources)) writeFileSync(join(dir, name), source);
    const files = Object.keys(sources)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(dir, name));
    const tsconfigPath = useOwnTsconfig ? join(dir, 'tsconfig.json') : undefined;
    return checkDeprecatedEvents({ files, tsconfigPath, root: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeSuperDoc(superDocSource: string): Record<string, string> {
  return {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        paths: { superdoc: ['./fake-superdoc.ts'] },
      },
    }),
    'fake-superdoc.ts': superDocSource,
    'uses.ts': "import { SuperDoc } from 'superdoc';\nexport { SuperDoc };\n",
  };
}

const lines = (...source: string[]): string => `${source.join('\n')}\n`;

const fixtures = checkSources({
  'forms.ts': lines(
    "import { SuperDoc } from 'superdoc';",
    'declare const superdoc: SuperDoc;',
    'declare const maybe: SuperDoc | undefined;',
    'const handler = () => {};',
    "superdoc.on('document-mode-change', handler);",
    "superdoc.once('zoomChange', handler);",
    "superdoc.off('content-control:click', handler);",
    "superdoc.addListener('list-definitions-change', handler);",
    "superdoc.removeListener('zoomChange', handler);",
    "superdoc.removeAllListeners('zoomChange');",
    "maybe?.on('document-mode-change', handler);",
    "superdoc['on']('document-mode-change', handler);",
    "maybe?.['once']('zoomChange', handler);",
  ),
  'const.ts': lines(
    "import { SuperDoc } from 'superdoc';",
    "const superdoc = new SuperDoc({ selector: '#editor' });",
    "const event = 'document-mode-change';",
    'superdoc.on(event, () => {});',
  ),
  'current.ts': lines(
    "import { SuperDoc } from 'superdoc';",
    'declare const superdoc: SuperDoc;',
    "superdoc.on('ready', () => {});",
    "superdoc.once('editorCreate', () => {});",
  ),
  'forwarded.ts': lines(
    "import { SuperDoc } from 'superdoc';",
    'declare const superdoc: SuperDoc;',
    'declare const anyEvent: Parameters<SuperDoc["on"]>[0];',
    "declare const someEvent: 'ready' | 'document-mode-change';",
    'superdoc.on(anyEvent, () => {});',
    'superdoc.off(someEvent, () => {});',
  ),
  'other.ts': lines(
    "import { EventEmitter } from 'node:events';",
    'class SuperDoc { on(event: string, handler: () => void): this { return this; } }',
    "new EventEmitter().on('document-mode-change', () => {});",
    "new SuperDoc().on('document-mode-change', () => {});",
  ),
});

const reportedIn = (file: string): string[] =>
  fixtures.findings
    .filter((finding) => finding.file === file)
    .map(({ line, method, event }) => `${line} ${method} ${event}`);

test('reads the deprecated keys and their replacements from the SuperDoc event map', () => {
  const byName = new Map(fixtures.deprecatedEvents.map((event) => [event.name, event.replacement]));
  assert.equal(byName.get('document-mode-change'), '`superdoc.ui.document.observe`');
  assert.equal(byName.get('list-definitions-change'), '`editor-update` and `doc.lists.list`');
  assert.equal(byName.has('ready'), false);
});

test('reports a deprecated event through every subscription form', () => {
  assert.deepEqual(reportedIn('forms.ts'), [
    '5 on document-mode-change',
    '6 once zoomChange',
    '7 off content-control:click',
    '8 addListener list-definitions-change',
    '9 removeListener zoomChange',
    '10 removeAllListeners zoomChange',
    '11 on document-mode-change',
    '12 on document-mode-change',
    '13 once zoomChange',
  ]);
  assert.equal(
    formatFinding(fixtures.findings.find((finding) => finding.file === 'forms.ts') ?? assert.fail('no finding')),
    "forms.ts:5 on('document-mode-change') subscribes to a deprecated SuperDoc event; use `superdoc.ui.document.observe` instead.",
  );
});

test('reports a const holding a deprecated event name', () => {
  assert.deepEqual(reportedIn('const.ts'), ['4 on document-mode-change']);
});

test('ignores current events', () => {
  assert.deepEqual(reportedIn('current.ts'), []);
});

test('ignores an event whose type is a union of names, such as a forwarded event', () => {
  assert.deepEqual(reportedIn('forwarded.ts'), []);
});

test('ignores receivers that are not the SuperDoc class', () => {
  assert.deepEqual(reportedIn('other.ts'), []);
});

test('sorts findings by file and line', () => {
  const keys = fixtures.findings.map(({ file, line }) => `${file}:${String(line).padStart(4, '0')}`);
  assert.deepEqual(keys, [...keys].sort());
});

function assertSetupError(run: () => unknown, message: string): void {
  assert.throws(run, (error: unknown) => error instanceof CheckSetupError && error.message.includes(message));
}

test('fails when a superdoc import in a checked file does not resolve', () => {
  assertSetupError(
    () =>
      checkSources({
        'unresolved.ts': lines("import { SuperDoc } from 'superdoc/not-an-entry';", 'export { SuperDoc };'),
      }),
    "unresolved.ts:1 'superdoc/not-an-entry'",
  );
});

test('fails when the tsconfig cannot resolve superdoc', () => {
  assertSetupError(
    () =>
      checkSources(
        {
          'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', module: 'esnext' } }),
          'plain.ts': 'export {};\n',
        },
        true,
      ),
    "'superdoc' does not resolve",
  );
});

test('fails when SuperDoc.on() no longer exposes its event map', () => {
  const methods = ['on', 'once', 'off', 'addListener', 'removeListener', 'removeAllListeners']
    .map((name) => `  ${name}(event: string): this { return this; }`)
    .join('\n');
  assertSetupError(
    () => checkSources(fakeSuperDoc(`export class SuperDoc {\n${methods}\n}\n`), true),
    'Cannot find the event map',
  );
});

test('fails when the event map has no deprecated keys', () => {
  const methods = ['on', 'once', 'off', 'addListener', 'removeListener', 'removeAllListeners']
    .map((name) => `  ${name}<K extends keyof Events>(event: K): this { return this; }`)
    .join('\n');
  assertSetupError(
    () => checkSources(fakeSuperDoc(`interface Events { ready: [] }\nexport class SuperDoc {\n${methods}\n}\n`), true),
    'Found no @deprecated keys',
  );
});

test('the docs snippets and examples subscribe to no deprecated event', () => {
  const files = educationalFiles();
  assert.ok(files.some((file) => file.includes('/apps/docs/snippets/')));
  assert.ok(files.some((file) => file.includes('/examples/')));
  assert.deepEqual(checkDeprecatedEvents({ files }).findings.map(formatFinding), []);
});
