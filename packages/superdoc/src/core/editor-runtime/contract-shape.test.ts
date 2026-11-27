import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const INDEX_PATH = join(__dirname, 'index.ts');

/** Extract the identifiers inside the `export type {... } from './types.js'` block. */
function parseExportedTypeNames(indexSource: string): string[] {
  const match = indexSource.match(/export\s+type\s*\{([\s\S]*?)\}\s*from/);
  if (!match) throw new Error('could not find `export type {... } from` block in index.ts');
  return match[1]
    .split(',')
    .map((s) => s.replace(/\/\/.*$/gm, '').trim())
    .filter((s) => s.length > 0)
    .sort();
}

describe('editor-runtime contract  -  exported type-name drift', () => {
  it('index.ts re-exports exactly the pinned type-name set', async () => {
    const actual = parseExportedTypeNames(readFileSync(INDEX_PATH, 'utf8'));
    await expect(`${actual.join('\n')}\n`).toMatchFileSnapshot(
      './__snapshots__/contract-shape/exported-type-names.txt',
    );
  });
});
