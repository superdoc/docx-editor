/**
 * Concrete invalidation handlers for the parts system.
 *
 * Each handler defines what happens when a specific part changes.
 * Registered in `initPartsRuntime` for static parts (numbering, rels)
 * and dynamically at creation time for header/footer parts.
 */

import { captureCommentAuthorSource } from '../../super-converter/comment-author-identity.js';
import type { Doc as YDoc } from 'yjs';
import type { Editor } from '../../Editor.js';
import type { PartChangedEvent, PartId } from '../types.js';
import { registerInvalidationHandler } from './part-invalidation-registry.js';
import { readSettingsRoot, parseProtectionState } from '../../../document-api-adapters/document-settings.js';
import { applyEffectiveEditability, getProtectionStorage } from '../../../extensions/protection/editability.js';
import { decodeYjsToEnvelope } from '../../../extensions/collaboration/part-sync/json-crdt.js';
import { PARTS_MAP_KEY, SOURCE_COLLAB_REMOTE_PARTS } from '../../../extensions/collaboration/part-sync/constants.js';

// ---------------------------------------------------------------------------
// word/numbering.xml
// ---------------------------------------------------------------------------

/**
 * Dispatch an empty PM transaction to trigger list marker recomputation.
 *
 * ProseMirror decorations for list numbering recompute on each transaction.
 * After a numbering part mutation, we dispatch a no-op transaction so the
 * view re-renders with the updated numbering state.
 */
function handleNumberingInvalidation(editor: Editor, _event: PartChangedEvent): void {
  try {
    editor.view?.dispatch?.(editor.state.tr);
  } catch {
    // View may not be ready during initialization
  }
}

// ---------------------------------------------------------------------------
// word/_rels/document.xml.rels
// ---------------------------------------------------------------------------

/**
 * No-op for now. The relationships part has no runtime cache to clear.
 *
 * `findOrCreateRelationship` reads from the canonical XML tree each time,
 * so there is no stale-cache risk. If a lookup cache is added later, this
 * handler should clear it.
 */
function handleRelationshipsInvalidation(_editor: Editor, _event: PartChangedEvent): void {
  // Intentionally empty — no caches to invalidate.
}

// ---------------------------------------------------------------------------
// Header/footer parts (dynamic)
// ---------------------------------------------------------------------------

/**
 * Dispatch a `forceUpdatePagination` transaction to refresh layout.
 *
 * Registered dynamically when a header/footer part is created.
 * All header/footer parts share the same handler logic.
 */
function handleHeaderFooterInvalidation(editor: Editor, _event: PartChangedEvent): void {
  try {
    const tr = editor.state.tr;
    tr.setMeta('forceUpdatePagination', true);
    editor.view?.dispatch?.(tr);
  } catch {
    // View may not be ready
  }
}

// ---------------------------------------------------------------------------
// word/footnotes.xml and word/endnotes.xml
// ---------------------------------------------------------------------------

/**
 * Dispatch a `forceUpdatePagination` transaction after a notes part mutation.
 *
 * Footnote/endnote body changes affect page flow (the note area expands or
 * shrinks), so the layout engine must re-paginate.
 */
function handleNotesInvalidation(editor: Editor, _event: PartChangedEvent): void {
  try {
    const tr = editor.state.tr;
    tr.setMeta('forceUpdatePagination', true);
    editor.view?.dispatch?.(tr);
  } catch {
    // View may not be ready
  }
}

// ---------------------------------------------------------------------------
// word/settings.xml — protection state sync
// ---------------------------------------------------------------------------

/**
 * Reparse protection state from settings.xml after a part change,
 * recompute effective editability, and emit protectionChanged.
 *
 * Skips when the mutation originated from a protection adapter
 * (source starts with 'protection.') to avoid double-emitting
 * the protectionChanged event — the adapter already emits it.
 */
function handleSettingsInvalidation(editor: Editor, event: PartChangedEvent): void {
  // Protection adapters already update storage, apply editability, and emit
  // protectionChanged with source: 'local-mutation'. Skip to avoid duplicates.
  if (event.source.startsWith('protection.')) return;

  const converter = (editor as unknown as { converter?: { convertedXml?: Record<string, unknown> } }).converter;
  if (!converter) return;

  const settingsRoot = readSettingsRoot(converter);
  const newState = parseProtectionState(settingsRoot);

  const protStorage = getProtectionStorage(editor);
  if (protStorage) {
    protStorage.state = newState;
  }

  applyEffectiveEditability(editor);

  editor.emit('protectionChanged', {
    editor,
    state: newState,
    source: 'remote-part-sync',
  });
}

/** Refresh source ownership only after a committed comments-part change, never during export. */
function handleCommentsInvalidation(editor: Editor, event: PartChangedEvent): void {
  const converter = editor.converter as typeof editor.converter & {
    commentAuthorSource?: ReturnType<typeof captureCommentAuthorSource>;
  };
  const source = converter?.commentAuthorSource;
  // Retained old converters initialize through the scoped export guard, not from generated XML.
  if (source?.version !== 1) return;
  const envelope =
    event.source === SOURCE_COLLAB_REMOTE_PARTS
      ? decodeYjsToEnvelope(
          (editor.options.ydoc as YDoc | null | undefined)?.getMap(PARTS_MAP_KEY).get('word/comments.xml'),
        )
      : undefined;
  converter.commentAuthorSource = captureCommentAuthorSource(
    converter.convertedXml,
    [],
    source,
    envelope?.generatedCommentAuthors,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register static invalidation handlers. Called from `initPartsRuntime`. */
export function registerStaticInvalidationHandlers(): void {
  registerInvalidationHandler('word/comments.xml' as PartId, handleCommentsInvalidation);
  registerInvalidationHandler('word/numbering.xml', handleNumberingInvalidation);
  registerInvalidationHandler('word/_rels/document.xml.rels', handleRelationshipsInvalidation);
  registerInvalidationHandler('word/footnotes.xml', handleNotesInvalidation);
  registerInvalidationHandler('word/endnotes.xml', handleNotesInvalidation);
  registerInvalidationHandler('word/settings.xml' as PartId, handleSettingsInvalidation);
}

/**
 * Register an invalidation handler for a dynamically created header/footer part.
 *
 * Call this after creating a new header/footer part (e.g., `word/header3.xml`).
 * Uses the shared `handleHeaderFooterInvalidation` handler.
 */
export function registerHeaderFooterInvalidation(partId: string): void {
  registerInvalidationHandler(partId as PartId, handleHeaderFooterInvalidation);
}
