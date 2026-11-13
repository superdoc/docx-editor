import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// AIDEV-NOTE: Every page in the migration section, not one hardcoded file.
// A hardcoded path silently dropped 27 of 44 examples from this check when a
// page split moved them, while still reporting success.
const migrationDir = resolve(appRoot, 'content/docs/editor/migrate-from-v1');
const pages = (await readdir(migrationDir)).filter((name) => name.endsWith('.mdx')).sort();
const snippets = [];
const failures = [];

for (const page of pages) {
  const lines = (await readFile(resolve(migrationDir, page), 'utf8')).split(/\r?\n/);
  let heading = '';

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = /^#{3,4}\s+(.+)$/.exec(lines[index]);
    if (headingMatch) heading = headingMatch[1];
    if (lines[index].trim() !== '<MigrationExampleTabs>') continue;

    // AIDEV-NOTE: Read the whole tab block, not just the V2 example. An earlier
    // version scanned for V2 openers alone, so a block that lost its V1 half —
    // or a page that lost every block — still reported success. The structure
    // is the thing worth asserting: one V1 and one V2, side by side.
    const where = `${page}:${index + 1} (${heading || 'no heading'})`;
    const versions = [];
    let v2Source;

    for (index += 1; index < lines.length && lines[index].trim() !== '</MigrationExampleTabs>'; index += 1) {
      const opener = /^<MigrationExample\s+version=['"](V[12])['"][^>]*>$/.exec(lines[index].trim());
      if (!opener) continue;
      versions.push(opener[1]);

      const body = [];
      for (index += 1; index < lines.length && lines[index].trim() !== '</MigrationExample>'; index += 1) {
        body.push(lines[index]);
      }

      const fenced = body.join('\n').match(/```ts\s*\n([\s\S]*?)\n\s*```/);
      if (opener[1] !== 'V2') continue;
      if (!fenced) failures.push(`${where}: V2 example has no TypeScript fence`);
      else v2Source = fenced[1].replace(/^ {4}/gm, '');
    }

    for (const version of ['V1', 'V2']) {
      const count = versions.filter((value) => value === version).length;
      if (count !== 1) failures.push(`${where}: expected exactly one ${version} example, found ${count}`);
    }
    if (!heading) failures.push(`${where}: every example block must sit under a heading`);
    if (v2Source !== undefined) snippets.push({ heading: `${page} ${heading}`, source: v2Source });
  }
}

// Every teaching page must carry at least one example. Without this a deleted or
// emptied page passes silently: the global count stays above zero because the
// other pages still have theirs. Verified by emptying a page, which dropped its
// examples while the old check still reported success.
//
// `removed-apis.mdx` is exempt because it is generated from the catalog and is a
// lookup table by design, not a page of worked examples.
const REFERENCE_PAGES = new Set(['removed-apis.mdx', 'legacy-collaboration-server.mdx']);

// Deleting a page entirely is invisible to a loop over the pages that exist, so
// the expected set is named here. This is the one place a content change has to
// edit this file, and that is the point: removing a page from the migration
// guide should be a deliberate two-file change, not a silent loss of coverage.
const EXPECTED_PAGES = ['overview.mdx', 'removed-apis.mdx'];

for (const expected of EXPECTED_PAGES) {
  if (!pages.includes(expected)) failures.push(`${expected}: expected page is missing from the migration section`);
}

for (const page of pages) {
  if (REFERENCE_PAGES.has(page)) continue;
  if (!snippets.some((snippet) => snippet.heading.startsWith(`${page} `))) {
    failures.push(`${page}: no V1/V2 example blocks found on this page`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  throw new Error(`${failures.length} migration example block(s) are malformed.`);
}

const virtualSources = new Map(
  snippets.map((snippet, index) => [
    resolve(appRoot, `.migration-snippets/${String(index + 1).padStart(2, '0')}.ts`),
    snippet,
  ]),
);
const options = {
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.d.ts'],
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  isolatedModules: true,
  baseUrl: appRoot,
  paths: {
    superdoc: ['../../packages/superdoc/src/public/index.ts'],
    'superdoc/ui': ['../../packages/superdoc/src/public/ui.ts'],
  },
};
const host = ts.createCompilerHost(options);
const originalFileExists = host.fileExists.bind(host);
const originalReadFile = host.readFile.bind(host);
const originalGetSourceFile = host.getSourceFile.bind(host);

host.fileExists = (fileName) => virtualSources.has(fileName) || originalFileExists(fileName);
host.readFile = (fileName) => virtualSources.get(fileName)?.source ?? originalReadFile(fileName);
host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
  const snippet = virtualSources.get(fileName);
  if (snippet) return ts.createSourceFile(fileName, snippet.source, languageVersion, true, ts.ScriptKind.TS);
  return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
};

const program = ts.createProgram({ rootNames: [...virtualSources.keys()], options, host });
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter((diagnostic) => diagnostic.file && virtualSources.has(diagnostic.file.fileName));

if (diagnostics.length > 0) {
  for (const diagnostic of diagnostics) {
    const snippet = virtualSources.get(diagnostic.file.fileName);
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    console.error(`${snippet.heading}:${position.line + 1}:${position.character + 1} - ${message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Typechecked ${snippets.length} V2 migration snippets against the public SuperDoc API.`);
}
