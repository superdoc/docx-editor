import { copyFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const snippetRoot = join(fixtureRoot, '..', '..', 'apps', 'docs', 'snippets');
const destination = join(fixtureRoot, 'src', 'docs-snippets');

export const DOCS_SNIPPETS = ['editor/selected-content-controls.ts'];

export function syncDocsSnippets() {
  rmSync(destination, { recursive: true, force: true });
  for (const snippet of DOCS_SNIPPETS) {
    const target = join(destination, snippet.replaceAll('/', '__'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(snippetRoot, snippet), target);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) syncDocsSnippets();
