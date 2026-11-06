/**
 * Part-sync publisher: local part mutations → Yjs `parts` map.
 *
 * Subscribes to `partChanged` events from the mutation core. Writes
 * `{ v, clientId, data }` envelopes to the Yjs `parts` map.
 *
 * During compound mutations (`_compoundDepth > 0`), events are buffered
 * and flushed in a single Yjs transaction on compound success.
 */

import * as Y from 'yjs';
import type { Editor } from '../../../core/Editor.js';
import type { PartChangedEvent } from '../../../core/parts/types.js';
import type { BufferedPartEvent, ConcurrentOverwriteTelemetry } from './types.js';
import { decodeYjsToEnvelope, encodeEnvelopeToYjs, readEnvelopeVersion } from './json-crdt.js';
import {
  PARTS_MAP_KEY,
  EXCLUDED_PART_IDS,
  SOURCE_COLLAB_REMOTE_PREFIX,
  DEFAULT_STALENESS_WINDOW_MS,
} from './constants.js';
import { getPart } from '../../../core/parts/index.js';
import {
  generatedCommentAuthorRows,
  type captureCommentAuthorSource,
} from '../../../core/super-converter/comment-author-identity.js';

// ---------------------------------------------------------------------------
// Publisher State
// ---------------------------------------------------------------------------

export interface PartPublisher {
  /** Publish immediately or buffer depending on compound depth. */
  handlePartChanged(event: PartChangedEvent): void;
  /** Flush buffered compound events to Yjs. Called on compound success. */
  flush(): void;
  /** Drop buffered compound events. Called on compound failure. */
  drop(): void;
  /** Tear down listeners. */
  destroy(): void;
}

interface LastPublish {
  v: number;
  time: number;
}

interface PublisherState {
  buffer: BufferedPartEvent[];
  /** Tracks last local publish version+time per partId for conflict detection. */
  lastPublishes: Map<string, LastPublish>;
  destroyed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldSkipEvent(event: PartChangedEvent): boolean {
  return event.source.startsWith(SOURCE_COLLAB_REMOTE_PREFIX);
}

function computeNextVersion(partsMap: Y.Map<unknown>, partId: string): number {
  return readEnvelopeVersion(partsMap, partId) + 1;
}

// ---------------------------------------------------------------------------
// Single-Part Publish
// ---------------------------------------------------------------------------

function publishPart(
  partsMap: Y.Map<unknown>,
  ydoc: Y.Doc,
  partId: string,
  operation: 'mutate' | 'create' | 'delete',
  data: unknown,
  state: PublisherState,
  editor: Editor,
): void {
  if (operation === 'delete') {
    partsMap.delete(partId);
    state.lastPublishes.delete(partId);
  } else {
    const v = computeNextVersion(partsMap, partId);
    const converter = editor.converter as typeof editor.converter & {
      commentAuthorSource?: ReturnType<typeof captureCommentAuthorSource>;
    };
    const envelope = encodeEnvelopeToYjs({
      v,
      clientId: ydoc.clientID,
      data,
      ...(partId === 'word/comments.xml'
        ? {
            generatedCommentAuthors: generatedCommentAuthorRows(data, converter?.commentAuthorSource),
          }
        : {}),
    });
    partsMap.set(partId, envelope);
    state.lastPublishes.set(partId, { v, time: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// Conflict Detection Telemetry
// ---------------------------------------------------------------------------

function checkConcurrentOverwrite(
  partsMap: Y.Map<unknown>,
  partId: string,
  ydoc: Y.Doc,
  state: PublisherState,
  stalenessWindowMs: number,
): ConcurrentOverwriteTelemetry | null {
  const last = state.lastPublishes.get(partId);
  if (!last) return null;

  const gapMs = Date.now() - last.time;
  if (gapMs > stalenessWindowMs) return null;

  const currentV = readEnvelopeVersion(partsMap, partId);

  // Read the current envelope's clientId to detect foreign writes
  const envelopeClientId = decodeYjsToEnvelope(partsMap.get(partId))?.clientId ?? 0;

  // Detect concurrent overwrite in two cases:
  // 1. Version advanced beyond our last write (remote published a newer version)
  // 2. Same version but different clientId (race: both wrote the same v)
  const versionAdvanced = currentV > last.v;
  const sameVersionDifferentWriter = currentV === last.v && envelopeClientId !== ydoc.clientID;

  if (versionAdvanced || sameVersionDifferentWriter) {
    return {
      partId,
      localVersion: last.v,
      remoteVersion: currentV,
      remoteClientId: envelopeClientId,
      gapMs,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Telemetry Emission
// ---------------------------------------------------------------------------

function emitOverwriteTelemetry(
  partsMap: Y.Map<unknown>,
  partId: string,
  ydoc: Y.Doc,
  state: PublisherState,
  stalenessWindowMs: number,
  editor: Editor,
): void {
  const telemetry = checkConcurrentOverwrite(partsMap, partId, ydoc, state, stalenessWindowMs);
  if (telemetry) {
    editor.emit('parts:concurrent-overwrite', telemetry);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPartPublisher(
  editor: Editor,
  ydoc: Y.Doc,
  options: { stalenessWindowMs?: number } = {},
): PartPublisher {
  const partsMap = ydoc.getMap(PARTS_MAP_KEY) as Y.Map<unknown>;
  const stalenessWindowMs = options.stalenessWindowMs ?? DEFAULT_STALENESS_WINDOW_MS;

  const state: PublisherState = {
    buffer: [],
    lastPublishes: new Map(),
    destroyed: false,
  };

  function getCompoundDepth(): number {
    return (editor as unknown as { _compoundDepth?: number })._compoundDepth ?? 0;
  }

  function handlePartChanged(event: PartChangedEvent): void {
    if (state.destroyed) return;
    if (shouldSkipEvent(event)) return;

    for (const part of event.parts) {
      if (EXCLUDED_PART_IDS.has(part.partId)) continue;

      if (getCompoundDepth() > 0) {
        // Buffer for later flush
        const data = part.operation === 'delete' ? undefined : getPart(editor, part.partId);
        state.buffer.push({ partId: part.partId, operation: part.operation, data });
      } else {
        // Publish immediately
        const data = part.operation === 'delete' ? undefined : getPart(editor, part.partId);
        emitOverwriteTelemetry(partsMap, part.partId, ydoc, state, stalenessWindowMs, editor);
        ydoc.transact(
          () => {
            publishPart(partsMap, ydoc, part.partId, part.operation, data, state, editor);
          },
          { event: 'parts-update', user: (editor.options as Record<string, unknown>).user },
        );
      }
    }
  }

  function flush(): void {
    if (state.destroyed || state.buffer.length === 0) return;

    const buffered = state.buffer.splice(0);

    for (const entry of buffered) {
      emitOverwriteTelemetry(partsMap, entry.partId, ydoc, state, stalenessWindowMs, editor);
    }

    ydoc.transact(
      () => {
        for (const entry of buffered) {
          const data = entry.operation === 'delete' ? undefined : getPart(editor, entry.partId);
          publishPart(partsMap, ydoc, entry.partId, entry.operation, data ?? entry.data, state, editor);
        }
      },
      { event: 'parts-update', user: (editor.options as Record<string, unknown>).user },
    );
  }

  function drop(): void {
    state.buffer.length = 0;
  }

  function destroy(): void {
    state.destroyed = true;
    state.buffer.length = 0;
    state.lastPublishes.clear();
  }

  return { handlePartChanged, flush, drop, destroy };
}
