import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const SRC_ROOT = join(__dirname, '..', '..');
const BASELINE_PATH = join(__dirname, 'document-api-boundary.baseline.json');
const UPDATE = process.env.UPDATE_DOCUMENT_API_BOUNDARY === '1';

// UI code should read and change the document only through the public
// Document API (`activeEditor.doc`). Each route below bypasses it. The baseline
// records how many access points each file still has; the count may only move
// together with the baseline, so it cannot grow and every removal is recorded.
// This is a syntactic count: a new call through an existing alias is not seen.
const ROUTES: Record<string, RegExp> = {
  host: /(?<!\.\.)\??\.host\b|\bgetHost\s*\(/g,
  handles: /\bgetHandles\s*(?:\?\.)?\(|'getHandles'/g,
  editCommands: /\beditCommands\b/g,
  reviewBridge: /\b(?:v2Comments|v2TrackedChanges|reviewWindow)\b/g,
  firstParty: /\b(?:\w+FirstParty|firstParty[A-Z])\w*/g,
  v1: /\b\w*[eE]ditor(?:Ref)?(?:\??\.value)?\??\.(?:commands|state|view)\b|\{[^{}]*\b(?:commands|state|view)\b[^{}]*\}\s*=\s*\w*[eE]ditor(?:Ref)?\b/g,
};

// Not editor access: the bound SuperDoc instance, the public painted host
// element accessor, and strings that only name a path in a warning.
const EXEMPT =
  /\b(?:useContextValue|useBinding)\(\)\.host\b|^\s*getHost\(\): HTMLElement \| null;|'editor\.\w+(?:\(\))?'/gm;

type Counts = Record<string, Record<string, number>>;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function countRoutes(source: string): Record<string, number> {
  const code = stripComments(source).replace(EXEMPT, '');
  const counts: Record<string, number> = {};
  for (const [route, pattern] of Object.entries(ROUTES)) {
    const n = code.match(pattern)?.length ?? 0;
    if (n > 0) counts[route] = n;
  }
  return counts;
}

function findIncreases(before: Counts, after: Counts): string[] {
  return Object.entries(after).flatMap(([file, routes]) =>
    Object.entries(routes)
      .filter(([route, count]) => count > (before[file]?.[route] ?? 0))
      .map(([route, count]) => `${file} ${route}: ${before[file]?.[route] ?? 0} -> ${count}`),
  );
}

function recordLowerCounts(baselinePath: string, current: Counts): void {
  const increases = findIncreases(JSON.parse(readFileSync(baselinePath, 'utf8')) as Counts, current);
  if (increases.length > 0) {
    throw new Error(
      `The update only records removed bypasses; route new code through activeEditor.doc.\n${increases.join('\n')}`,
    );
  }
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
}

function* walkSourceFiles(dir: string): IterableIterator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'dev' || entry === 'tests') continue;
      yield* walkSourceFiles(full);
      continue;
    }
    if (!/\.(js|ts|vue|jsx|tsx)$/.test(full) || full.endsWith('.d.ts')) continue;
    if (/\.(test|spec)\.[jt]sx?$/.test(full)) continue;
    yield full;
  }
}

function inventory(): Counts {
  const result: Counts = {};
  for (const file of walkSourceFiles(SRC_ROOT)) {
    const counts = countRoutes(readFileSync(file, 'utf8'));
    if (Object.keys(counts).length > 0) result[relative(SRC_ROOT, file).split(sep).join('/')] = counts;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

describe('Document API boundary', () => {
  it('lets an update lower counts but not raise them', () => {
    const baselinePath = join(mkdtempSync(join(tmpdir(), 'document-api-boundary-')), 'baseline.json');
    const recorded = `${JSON.stringify({ 'a.ts': { host: 1 } }, null, 2)}\n`;
    writeFileSync(baselinePath, recorded);

    expect(() => recordLowerCounts(baselinePath, { 'a.ts': { host: 2 }, 'b.ts': { host: 1 } })).toThrow(
      /a\.ts host: 1 -> 2\nb\.ts host: 0 -> 1/,
    );
    expect(readFileSync(baselinePath, 'utf8')).toBe(recorded);

    recordLowerCounts(baselinePath, {});
    expect(JSON.parse(readFileSync(baselinePath, 'utf8'))).toEqual({});
  });

  it('matches the recorded inventory of non-Document-API access', () => {
    const current = inventory();
    if (UPDATE) recordLowerCounts(BASELINE_PATH, current);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Counts;
    expect(
      current,
      'Run with UPDATE_DOCUMENT_API_BOUNDARY=1 after removing a bypass; route new code through activeEditor.doc.',
    ).toEqual(baseline);
  });

  it('ignores spreads, comments, label strings, and non-editor hosts', () => {
    expect(countRoutes('[...host.querySelectorAll("a")]')).toEqual({});
    expect(countRoutes('// editor.commands.search is v1\n/* getHandles() */')).toEqual({});
    expect(countRoutes("const label = 'editor.state';")).toEqual({});
    expect(countRoutes('return useContextValue().host;')).toEqual({});
    expect(countRoutes('  getHost(): HTMLElement | null;')).toEqual({});
  });

  it('counts access in code, templates, and between imports', () => {
    expect(countRoutes('const url = "https://x"; editor?.host?.getHandles?.()')).toEqual({ host: 1, handles: 1 });
    expect(countRoutes("import './a.css';\neditor.host.getHandles();\nimport { b } from './b.js';")).toEqual({
      host: 1,
      handles: 1,
    });
    expect(countRoutes('<button @click="editor.commands.foo()" />')).toEqual({ v1: 1 });
    expect(countRoutes("const s = `It's ${editor.state ? 'y' : 'n'}`;")).toEqual({ v1: 1 });
  });

  it('counts a host method read by name, once per access point', () => {
    expect(countRoutes("hostMethod(getHost(), 'getHandles')")).toEqual({ host: 1, handles: 1 });
    expect(countRoutes("const readHandles = hostMethod(h, 'getHandles');\nreadHandles();")).toEqual({ handles: 1 });
  });

  it('counts optional calls and destructured v1 access', () => {
    expect(countRoutes('host?.getHandles?.()')).toEqual({ handles: 1 });
    expect(countRoutes('const { view } = editor;')).toEqual({ v1: 1 });
    expect(countRoutes('const { view } = activeEditorRef.value;')).toEqual({ v1: 1 });
    expect(countRoutes('activeEditorRef.value.view.dom')).toEqual({ v1: 1 });
  });
});
