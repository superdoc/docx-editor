import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const INDEX_PATH = join(__dirname, 'index.ts');

// The pinned internal type-name surface of the contract barrel. Update this
// list deliberately when the contract changes.
const EXPECTED_TYPE_NAMES = [
  // identity + lifecycle
  'EditorRuntimeId',
  'EditorRuntimeDocumentMode',
  'EditorRuntimeUser',
  'EditorRuntimeState',
  // the runtime
  'EditorRuntime',
  'EditorRuntimeSnapshot',
  // capabilities
  'EditorRuntimeCapabilities',
  // commands + results
  'EditorRuntimeCommand',
  'EditorRuntimeCommandKind',
  'EditorRuntimeCommandResult',
  'EditorRuntimeRejectionCode',
  // reads + snapshots
  'EditorRuntimeSelectionSnapshot',
  'EditorRuntimeFindSessionSnapshot',
  'EditorRuntimeToolbarState',
  'EditorRuntimeLayoutSnapshot',
  // positions
  'EditorRuntimePositionToken',
  // options + targets
  'EditorRuntimeFocusOptions',
  'EditorRuntimeExportOptions',
  'EditorRuntimeNavigationTarget',
  // events
  'EditorRuntimeEvent',
  'EditorRuntimeListener',
  'EditorRuntimeUnsubscribe',
].sort();

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
  it('index.ts re-exports exactly the pinned type-name set', () => {
    const actual = parseExportedTypeNames(readFileSync(INDEX_PATH, 'utf8'));
    expect(actual).toEqual(EXPECTED_TYPE_NAMES);
  });
});
