// Contract-shape + exported-type-name drift guard.
//
// Two layers:
//   1. A runtime drift snapshot: parse the public type names re-exported from
//      `index.ts` and pin them to an explicit expected set, so the contract
//      barrel and implementation can't silently diverge.
//   2. Compile-time shape assertions on the load-bearing types (command result
//      statuses, opaque token fields, runtime method surface), so a rename or
//      field change fails the type build.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import type {
  EditorRuntime,
  EditorRuntimeCapabilities,
  EditorRuntimeCommand,
  EditorRuntimeCommandResult,
  EditorRuntimeDocumentMode,
  EditorRuntimeEvent,
  EditorRuntimePositionToken,
  EditorRuntimeSelectionSnapshot,
} from './index.js';

const INDEX_PATH = join(__dirname, 'index.ts');

// The pinned internal type-name surface of the contract barrel. Update this
// list deliberately when the contract changes.
const EXPECTED_TYPE_NAMES = [
  // identity + lifecycle
  'EditorRuntimeKind',
  'EditorRuntimeId',
  'EditorRuntimeDocumentMode',
  'EditorRuntimeState',
  // the runtime
  'EditorRuntime',
  'EditorRuntimeSnapshot',
  // capabilities
  'EditorRuntimeCapabilities',
  'RuntimeLifecycleCapabilities',
  'RuntimeSelectionCapabilities',
  'RuntimeCommandCapabilities',
  'RuntimeFindReplaceCapabilities',
  'RuntimeAiCapabilities',
  'RuntimeCommentCapabilities',
  'RuntimeTrackedChangeCapabilities',
  'RuntimeToolbarCapabilities',
  'RuntimeLayoutCapabilities',
  'RuntimeZoomCapabilities',
  'RuntimeNavigationCapabilities',
  'RuntimePersistenceCapabilities',
  // commands + results
  'EditorRuntimeCommand',
  'EditorRuntimeCommandKind',
  'EditorRuntimeCommandResult',
  'EditorRuntimeRejectionCode',
  'EditorRuntimeNoopReason',
  // reads + snapshots
  'EditorRuntimeSelectionSnapshot',
  'EditorRuntimeFindSessionSnapshot',
  'EditorRuntimeToolbarState',
  'EditorRuntimeLayoutSnapshot',
  // positions
  'EditorRuntimePositionToken',
  // options + targets
  'EditorRuntimeFocusOptions',
  'EditorRuntimeSaveOptions',
  'EditorRuntimeExportOptions',
  'EditorRuntimeNavigationTarget',
  // events
  'EditorRuntimeEvent',
  'EditorRuntimeListener',
  'EditorRuntimeUnsubscribe',
  // neutral JSON helpers
  'RuntimeJsonPrimitive',
  'RuntimeJsonValue',
  'RuntimeJsonObject',
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

describe('editor-runtime contract  -  compile-time shape', () => {
  it('EditorRuntimeCommandResult carries the named statuses', () => {
    type Status = EditorRuntimeCommandResult['status'];
    expectTypeOf<Status>().toEqualTypeOf<
      'selected' | 'committed' | 'history-committed' | 'noop' | 'history-noop' | 'receipt-failure' | 'rejected'
    >();
  });

  it('EditorRuntimePositionToken exposes only opaque handle fields', () => {
    expectTypeOf<EditorRuntimePositionToken['runtimeId']>().toEqualTypeOf<string>();
    expectTypeOf<EditorRuntimePositionToken['tokenId']>().toEqualTypeOf<string>();
    expectTypeOf<EditorRuntimePositionToken['revision']>().toEqualTypeOf<string | number>();
    // No `pos`/`from`/`to`/`blockId` on the opaque token.
    // @ts-expect-error  -  opaque token must not expose a numeric document position.
    type _NoPos = EditorRuntimePositionToken['pos'];
  });

  it('EditorRuntime mutations are async and reads are synchronous', () => {
    expectTypeOf<EditorRuntime['dispatch']>().returns.resolves.toEqualTypeOf<EditorRuntimeCommandResult>();
    expectTypeOf<EditorRuntime['save']>().returns.resolves.toEqualTypeOf<ArrayBuffer>();
    expectTypeOf<EditorRuntime['getSelectedText']>().returns.toEqualTypeOf<string>();
    expectTypeOf<EditorRuntime['setDocumentMode']>().parameters.toEqualTypeOf<[EditorRuntimeDocumentMode]>();
    expectTypeOf<EditorRuntime['getDocumentMode']>().returns.toEqualTypeOf<EditorRuntimeDocumentMode>();
    expectTypeOf<EditorRuntime['setTrackedChangesRenderOptions']>().parameters.toEqualTypeOf<
      [options?: { mode?: 'review' | 'original' | 'final' | 'off'; enabled?: boolean }]
    >();
    expectTypeOf<
      EditorRuntime['getSelectionSnapshot']
    >().returns.toEqualTypeOf<EditorRuntimeSelectionSnapshot | null>();
  });

  it('EditorRuntimeSnapshot carries the current document mode', () => {
    expectTypeOf<ReturnType<EditorRuntime['getSnapshot']>>().toHaveProperty('documentMode');
    expectTypeOf<ReturnType<EditorRuntime['getSnapshot']>['documentMode']>().toEqualTypeOf<EditorRuntimeDocumentMode>();
  });

  it('EditorRuntimeCommand is capability-grouped, not the full editor catalog', () => {
    type Kind = EditorRuntimeCommand['kind'];
    // Spot-check representative kinds exist...
    expectTypeOf<'text.insert'>().toMatchTypeOf<Kind>();
    expectTypeOf<'comments.create'>().toMatchTypeOf<Kind>();
    expectTypeOf<'trackedChanges.acceptAll'>().toMatchTypeOf<Kind>();
  });

  it('required capability groups are non-optional; domain groups are optional', () => {
    expectTypeOf<EditorRuntimeCapabilities>().toHaveProperty('lifecycle');
    expectTypeOf<EditorRuntimeCapabilities>().toHaveProperty('commands');
    expectTypeOf<EditorRuntimeCapabilities>().toHaveProperty('persistence');
    // Optional domain group: present in the type, allowed to be undefined.
    expectTypeOf<EditorRuntimeCapabilities['comments']>().toMatchTypeOf<object | undefined>();
  });

  it('EditorRuntimeEvent enumerates the runtime-owned event types', () => {
    type EventType = EditorRuntimeEvent['type'];
    expectTypeOf<EventType>().toEqualTypeOf<
      | 'selection-change'
      | 'capabilities-change'
      | 'toolbar-state-change'
      | 'layout-change'
      | 'state-change'
      | 'disposed'
    >();
  });
});
