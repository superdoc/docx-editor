import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  auditEntryGzipBudgets,
  checkEntryBudget,
  gzipSize,
  measureStaticClosure,
  staticImportSpecifiers,
} from './entry-closure-size.ts';

const roots: string[] = [];

function seedDist(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superdoc-entry-closure-test-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

function gzipOf(content: string): number {
  return gzipSize(Buffer.from(content));
}

function closureFiles(root: string, entry: string): string[] {
  return measureStaticClosure(root, entry)
    .files.map((file) => file.file)
    .sort();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('staticImportSpecifiers', () => {
  it('reads import, side-effect import, and re-export declarations but not strings or dynamic imports', () => {
    const source = [
      "import { a } from './a.js';",
      "import './side-effect.js';",
      "export { b } from './b.js';",
      "export * from './star.js';",
      "import Vue from 'vue';",
      "const lazy = () => import('./lazy.js');",
      "const snippet = `import { createTheme } from './template.js'`;",
      "// import './commented.js';",
    ].join('\n');

    expect(staticImportSpecifiers(source, 'entry.js')).toEqual([
      './a.js',
      './side-effect.js',
      './b.js',
      './star.js',
      'vue',
    ]);
  });
});

describe('measureStaticClosure', () => {
  it('counts static imports and leaves out dynamic imports and bare packages', () => {
    const root = seedDist({
      'entry.es.js':
        "import { a } from './chunks/a.js';\nimport 'vue';\nexport const load = () => import('./chunks/lazy.js');\n",
      'chunks/a.js': 'export const a = 1;\n',
      'chunks/lazy.js': 'export const lazy = 1;\n'.repeat(50),
    });

    expect(closureFiles(root, 'entry.es.js')).toEqual(['chunks/a.js', 'entry.es.js']);
  });

  it('counts a dependency shared by two importers once', () => {
    const files = {
      'entry.es.js': "import './left.js';\nimport './right.js';\n",
      'left.js': "import { shared } from './shared.js';\n",
      'right.js': "import { shared } from './shared.js';\n",
      'shared.js': 'export const shared = 1;\n'.repeat(20),
    };
    const root = seedDist(files);

    const size = measureStaticClosure(root, 'entry.es.js');

    expect(size.files.map((file) => file.file).sort()).toEqual(['entry.es.js', 'left.js', 'right.js', 'shared.js']);
    expect(size.gzipBytes).toBe(Object.values(files).reduce((total, content) => total + gzipOf(content), 0));
  });

  it('terminates on an import cycle', () => {
    const root = seedDist({
      'entry.es.js': "import './a.js';\n",
      'a.js': "import './b.js';\n",
      'b.js': "import './a.js';\nimport './entry.es.js';\n",
    });

    expect(closureFiles(root, 'entry.es.js')).toEqual(['a.js', 'b.js', 'entry.es.js']);
  });

  it('counts re-exported modules', () => {
    const root = seedDist({
      'public/ui.es.js': "export { a } from '../chunks/a.js';\nexport * from '../chunks/b.js';\n",
      'chunks/a.js': 'export const a = 1;\n',
      'chunks/b.js': 'export const b = 2;\n',
    });

    expect(closureFiles(root, 'public/ui.es.js')).toEqual(['chunks/a.js', 'chunks/b.js', 'public/ui.es.js']);
  });

  it('fails when a reachable local file is missing', () => {
    const root = seedDist({ 'entry.es.js': "import './chunks/gone.js';\n" });

    expect(() => measureStaticClosure(root, 'entry.es.js')).toThrow(
      'entry.es.js imports ./chunks/gone.js, which does not exist',
    );
  });

  it('fails when the entry is missing', () => {
    const root = seedDist({});

    expect(() => measureStaticClosure(root, 'superdoc.es.js')).toThrow('entry superdoc.es.js does not exist');
  });

  it('measures a stylesheet as one file without following its imports', () => {
    const css = '@import "@superdoc/docx-engine/style.css";\n.sd { color: red; }\n';
    const root = seedDist({ 'style.css': css });

    expect(measureStaticClosure(root, 'style.css')).toEqual({
      entry: 'style.css',
      files: [{ file: 'style.css', gzipBytes: gzipOf(css) }],
      gzipBytes: gzipOf(css),
    });
  });
});

describe('budget checks', () => {
  it('passes at the exact limit and fails one byte over', () => {
    const root = seedDist({ 'entry.es.js': "import './chunk.js';\n", 'chunk.js': 'export const value = 1;\n' });
    const size = measureStaticClosure(root, 'entry.es.js');

    expect(checkEntryBudget(size, size.gzipBytes)).toBeNull();
    expect(checkEntryBudget(size, size.gzipBytes - 1)).toContain(
      `entry.es.js static-closure gzip size is ${size.gzipBytes} B`,
    );
  });

  it('names the size, limit, and largest files when an entry is over budget', () => {
    const big = Array.from({ length: 200 }, (_, index) => `export const v${index} = ${index};`).join('\n');
    const root = seedDist({ 'entry.es.js': "import './big.js';\n", 'big.js': big });
    const size = measureStaticClosure(root, 'entry.es.js');

    const failure = checkEntryBudget(size, 10);

    expect(failure).toContain(`over its 10 B (0.0 KiB) limit by ${size.gzipBytes - 10} B across 2 file(s)`);
    expect(failure).toContain(`big.js: ${gzipOf(big)} B`);
  });

  it('reports a summary line per passing entry and fails a missing entry', () => {
    const entry = 'export const value = 1;\n';
    const root = seedDist({ 'entry.es.js': entry });

    const report = auditEntryGzipBudgets(root, [
      { entry: 'entry.es.js', limitBytes: 1_000 },
      { entry: 'public/missing.es.js', limitBytes: 1_000 },
    ]);

    const percent = ((gzipOf(entry) / 1_000) * 100).toFixed(1);
    expect(report.summaries).toEqual([
      `entry.es.js: ${gzipOf(entry)} B gzip across 1 file(s), limit 1000 B (${percent}%)`,
    ]);
    expect(report.failures).toEqual([
      'public/missing.es.js static closure could not be measured: entry public/missing.es.js does not exist',
    ]);
  });
});
