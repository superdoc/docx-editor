import type { EditorState, Transaction, Plugin } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, Transform } from 'prosemirror-transform';
import type { EditorView as PmEditorView } from 'prosemirror-view';
import type { Mark as PmMark, Node as PmNode, Schema, Slice as PmSlice } from 'prosemirror-model';
import type { Doc as YDoc, XmlFragment as YXmlFragment } from 'yjs';
import type { EditorOptions, User, FieldValue, DocxFileEntry } from './types/EditorConfig.js';
import type { EditorHelpers, ExtensionStorage, ProseMirrorJSON, PageStyles, Toolbar } from './types/EditorTypes.js';
import type { ChainableCommandObject, CanObject, EditorCommands } from './types/ChainedCommands.js';
import type { EditorEventMap, FontsResolvedPayload, Comment, SdtRef } from './types/EditorEvents.js';
import type { SchemaSummaryJSON } from './types/EditorSchema.js';

import { EditorState as PmEditorState, NodeSelection as PmNodeSelection } from 'prosemirror-state';
import { DOMSerializer as PmDOMSerializer } from 'prosemirror-model';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as helpers from './helpers/index.js';
import { EventEmitter } from './EventEmitter.js';
import { ExtensionService } from './ExtensionService.js';
import { CommandService } from './CommandService.js';
import { Attribute } from './Attribute.js';
import { SuperConverter } from '@core/super-converter/SuperConverter.js';
import { pruneSessionDeletedNotesPart } from '@core/super-converter/v2/exporter/footnotesExporter.js';
import type {
  ConvertedXmlPart,
  EditorConverterSurface,
  EditorExtensionServiceSurface,
} from './types/EditorPublicSurfaces.js';
import {
  Commands,
  Editable,
  EditorFocus,
  Keymap,
  PositionTrackerExtension,
  SelectionHandleExtension,
} from './extensions/index.js';
import { createDocument } from './helpers/createDocument.js';
import { isActive } from './helpers/isActive.js';
import {
  trackedTransaction,
  isCompositionTransaction,
} from '@extensions/track-changes/trackChangesHelpers/trackedTransaction.js';
import { markInsertion } from '@extensions/track-changes/trackChangesHelpers/markInsertion.js';
import { markDeletion } from '@extensions/track-changes/trackChangesHelpers/markDeletion.js';
import { CanonicalChangeType } from '@extensions/track-changes/review-model/mark-metadata.js';
import {
  createWordIdAllocator,
  isDecimalWordId,
  TRACKED_CHANGE_SOURCE_ID_MAP_PROPERTY,
} from '@extensions/track-changes/review-model/word-id-allocator.js';
import { TrackDeleteMarkName, TrackFormatMarkName, TrackInsertMarkName } from '@extensions/track-changes/constants.js';
import { TrackChangesBasePluginKey } from '@extensions/track-changes/plugins/index.js';
import { CommentsPluginKey } from '@extensions/comment/comments-plugin.js';
import { getNecessaryMigrations } from '@core/migrations/index.js';
import { getStarterExtensions, getRichTextExtensions } from '../extensions/index.js';
import {
  InvalidStateError,
  NoSourcePathError,
  FileSystemNotAvailableError,
  DocumentLoadError,
  DocxEncryptionError,
} from './errors/index.js';
import { AnnotatorHelpers } from '@helpers/annotator.js';
import { prepareCommentsForExport, prepareCommentsForImport } from '@extensions/comment/comments-helpers.js';
import DocxZipper from '@core/DocxZipper.js';
import { generateCollaborationData, cleanupCollaborationSideEffects } from '@extensions/collaboration/collaboration.js';
import { normalizeYjsFragmentForSchema } from '@extensions/collaboration/normalize-yjs-fragment.js';
import { seedPartsFromEditor } from '@extensions/collaboration/part-sync/seed-parts.js';
import { onCollaborationProviderSynced } from './helpers/collaboration-provider-sync.js';
import { useHighContrastMode } from '../composables/use-high-contrast-mode.js';
import { setImageNodeSelection } from './helpers/setImageNodeSelection.js';
import { canRenderFont } from './helpers/canRenderFont.js';
import {
  migrateListsToV2IfNecessary,
  migrateParagraphFieldsListsV2,
} from '@core/migrations/0.14-listsv2/listsv2migration.js';
import { createLinkedChildEditor } from '@core/child-editor/index.js';
import { unflattenListsInHtml } from './inputRules/html/html-helpers.js';
import { SuperValidator } from '@core/super-validator/index.js';
import { createDocFromMarkdown, createDocFromHTML } from '@core/helpers/index.js';
import { COMMENT_FILE_BASENAMES } from '@core/super-converter/constants.js';
import { isHeadless } from '../utils/headless-helpers.js';
import { canUseDOM } from '../utils/canUseDOM.js';
import { buildCommentJsonFromText } from '../utils/comment-content.js';
import { buildSchemaSummary } from './schema-summary.js';
import type { PresentationEditor } from './presentation-editor/index.js';
import type { EditorRenderer } from './renderers/EditorRenderer.js';
import { ProseMirrorRenderer } from './renderers/ProseMirrorRenderer.js';
import { BLANK_DOCX_DATA_URI } from './blank-docx.js';
import { getArrayBufferFromUrl } from '@core/super-converter/helpers.js';
import { Telemetry, COMMUNITY_LICENSE_KEY } from '@superdoc/common';
import type { DocumentApi, ResolveRangeOutput } from '@superdoc/document-api';
import { createDocumentApi, DEFAULT_PROTECTION_STATE } from '@superdoc/document-api';
import { getDocumentApiAdapters } from '../document-api-adapters/index.js';
import {
  resolveCurrentEditorSelectionRange,
  resolveEffectiveEditorSelectionRange,
  selectCurrentPmSelection,
  selectEffectivePmSelection,
  resolvePmSelectionToRange,
} from '../document-api-adapters/helpers/selection-range-resolver.js';
import { captureSelectionHandle, resolveHandleToSelection, releaseSelectionHandle } from './selection-state.js';
import type { SelectionHandle } from './selection-state.js';
import { initPartsRuntime } from './parts/init-parts-runtime.js';
import { syncPackageMetadata } from './opc/sync-package-metadata.js';
import { readSettingsRoot, parseProtectionState } from '../document-api-adapters/document-settings.js';
import { applyEffectiveEditability, getProtectionStorage } from '../extensions/protection/editability.js';
import { getViewModeSelectionWithoutStructuredContent } from './helpers/getViewModeSelectionWithoutStructuredContent.js';
import { resolveMainBodyEditor } from '../document-api-adapters/helpers/word-statistics.js';
import { commitLiveStorySessionRuntimes } from '../document-api-adapters/story-runtime/live-story-session-runtime-registry.js';
import { buildFilteredMetadataXml } from '../document-api-adapters/plan-engine/anchored-metadata-wrappers.js';

type TrackChangesRuntimeConfig = NonNullable<EditorOptions['trackedChanges']>;

function normalizeEditorTrackChangesOptions(options: Partial<EditorOptions>): Partial<EditorOptions> {
  const canonical = options.modules?.trackChanges;
  const legacy = options.trackedChanges;

  if (!canonical && !legacy) return options;

  const normalized: TrackChangesRuntimeConfig = {
    ...(legacy ?? {}),
    ...(canonical ?? {}),
  };

  return {
    ...options,
    trackedChanges: normalized,
  };
}

type ConverterWithInternalWordIdAllocator = EditorConverterSurface & {
  wordIdAllocator?: {
    getSourceIdMap?: () => Record<string, Record<string, string>>;
  } | null;
};

declare const __APP_VERSION__: string | undefined;
declare const version: string | undefined;

const CURRENT_APP_VERSION =
  (typeof __APP_VERSION__ === 'string' && __APP_VERSION__) || (typeof version === 'string' && version) || '0.0.0';

/**
 * Constants for layout calculations
 */
const PIXELS_PER_INCH = 96;
const MAX_HEIGHT_BUFFER_PX = 50;
const MAX_WIDTH_BUFFER_PX = 20;
const TRACKED_REVIEW_MARK_NAMES = new Set([TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName]);

const isTrackedReviewMark = (mark: { type?: { name?: string } } | null | undefined): boolean =>
  Boolean(mark?.type?.name && TRACKED_REVIEW_MARK_NAMES.has(mark.type.name));

const trackedReviewMarkKey = (mark: { type?: { name?: string }; attrs?: Record<string, unknown> }): string | null => {
  if (!isTrackedReviewMark(mark)) return null;
  const id = typeof mark.attrs?.id === 'string' ? mark.attrs.id : '';
  return `${mark.type?.name ?? ''}:${id}`;
};

const trackedReviewMarkKeysForNode = (node: PmNode | null | undefined): Set<string> => {
  const keys = new Set<string>();
  if (!node) return keys;
  for (const mark of node.marks ?? []) {
    const key = trackedReviewMarkKey(mark);
    if (key) keys.add(key);
  }
  return keys;
};

const inlineNodeHasTrackedReviewMark = (node: PmNode): boolean =>
  Boolean(node.isInline && node.marks?.some(isTrackedReviewMark));

const rangeHasTrackedReviewMark = (doc: PmNode, from: number, to: number): boolean => {
  if (from >= to) return false;

  const docStart = 0;
  const docEnd = doc.content.size;
  const clampedFrom = Math.max(docStart, Math.min(docEnd, from));
  const clampedTo = Math.max(docStart, Math.min(docEnd, to));
  if (clampedFrom >= clampedTo) return false;

  let found = false;
  doc.nodesBetween(clampedFrom, clampedTo, (node) => {
    if (inlineNodeHasTrackedReviewMark(node)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
};

const rangeIsTrackedInsertionOnly = (doc: PmNode, from: number, to: number): boolean => {
  if (from >= to) return false;

  const docStart = 0;
  const docEnd = doc.content.size;
  const clampedFrom = Math.max(docStart, Math.min(docEnd, from));
  const clampedTo = Math.max(docStart, Math.min(docEnd, to));
  if (clampedFrom >= clampedTo) return false;

  let sawTrackedInsertion = false;
  let sawUntrackedInline = false;
  let sawNonInsertionTrackedMark = false;

  doc.nodesBetween(clampedFrom, clampedTo, (node, pos) => {
    if (!node.isInline || !node.isLeaf) return;
    if (pos + node.nodeSize <= clampedFrom || pos >= clampedTo) return;

    const trackedMarks = (node.marks ?? []).filter(isTrackedReviewMark);
    if (!trackedMarks.length) {
      sawUntrackedInline = true;
      return;
    }

    sawTrackedInsertion = true;
    if (!trackedMarks.every((mark) => mark.type?.name === TrackInsertMarkName)) {
      sawNonInsertionTrackedMark = true;
    }
  });

  return sawTrackedInsertion && !sawUntrackedInline && !sawNonInsertionTrackedMark;
};

const getSingleTrackedInsertionMarkInRange = (doc: PmNode, from: number, to: number): PmMark | null => {
  if (!rangeIsTrackedInsertionOnly(doc, from, to)) return null;

  const insertionMarks: PmMark[] = [];
  const seenIds = new Set<string>();
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline || !node.isLeaf) return;
    if (pos + node.nodeSize <= from || pos >= to) return;

    const insertionMark = (node.marks ?? []).find((mark) => mark.type?.name === TrackInsertMarkName);
    const id = typeof insertionMark?.attrs?.id === 'string' ? insertionMark.attrs.id : null;
    if (!insertionMark || !id || seenIds.has(id)) return;
    seenIds.add(id);
    insertionMarks.push(insertionMark);
  });

  return insertionMarks.length === 1 ? insertionMarks[0] : null;
};

const getSingleTrackedInsertionMarkAtCollapsedPosition = (doc: PmNode, pos: number): PmMark | null => {
  const boundedPos = Math.max(0, Math.min(doc.content.size, pos));
  const $pos = doc.resolve(boundedPos);
  const beforeInsert = $pos.nodeBefore?.marks?.find((mark) => mark.type?.name === TrackInsertMarkName) ?? null;
  const afterInsert = $pos.nodeAfter?.marks?.find((mark) => mark.type?.name === TrackInsertMarkName) ?? null;
  const beforeId = typeof beforeInsert?.attrs?.id === 'string' ? beforeInsert.attrs.id : null;
  const afterId = typeof afterInsert?.attrs?.id === 'string' ? afterInsert.attrs.id : null;
  if (!beforeInsert || !afterInsert || !beforeId || beforeId !== afterId) return null;
  return beforeInsert;
};

const resolveDirectInsertionMutationCommentMeta = (
  state: EditorState,
  tr: Transaction,
): {
  insertedMark: PmMark;
  deletionMark: null;
  formatMark: null;
  deletionNodes: [];
  step: ReplaceStep;
  emitCommentEvent: true;
} | null => {
  if (!tr.docChanged || tr.steps.length !== 1) return null;

  const [step] = tr.steps;
  if (!(step instanceof ReplaceStep)) return null;

  const docs = (tr as unknown as { docs?: PmNode[] }).docs ?? [];
  const docBeforeStep = docs[0] ?? state.doc;
  const insertedMark =
    step.from !== step.to && step.slice.content.size === 0
      ? getSingleTrackedInsertionMarkInRange(docBeforeStep, step.from, step.to)
      : step.from === step.to && step.slice.content.size > 0
        ? getSingleTrackedInsertionMarkAtCollapsedPosition(docBeforeStep, step.from)
        : null;
  if (!insertedMark) return null;

  return {
    insertedMark,
    deletionMark: null,
    formatMark: null,
    deletionNodes: [],
    step,
    emitCommentEvent: true,
  };
};

const collapsedPositionIsInsideTrackedReviewMark = (doc: PmNode, pos: number): boolean => {
  const boundedPos = Math.max(0, Math.min(doc.content.size, pos));
  const $pos = doc.resolve(boundedPos);
  const beforeKeys = trackedReviewMarkKeysForNode($pos.nodeBefore);
  if (!beforeKeys.size) return false;

  const afterKeys = trackedReviewMarkKeysForNode($pos.nodeAfter);
  for (const key of beforeKeys) {
    if (afterKeys.has(key)) return true;
  }
  return false;
};

const fragmentHasTrackedReviewMark = (fragment: {
  descendants?: (fn: (node: PmNode) => false | void) => void;
}): boolean => {
  let found = false;
  fragment.descendants?.((node) => {
    if (inlineNodeHasTrackedReviewMark(node)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
};

const collapsedInsertionExtendsTrackedInsertion = (
  doc: PmNode,
  pos: number,
  slice: { content?: { descendants?: (fn: (node: PmNode) => false | void) => void } },
): boolean => {
  const enclosingInsert = getSingleTrackedInsertionMarkAtCollapsedPosition(doc, pos);
  if (!enclosingInsert) return false;
  if (!slice.content) return true;

  const enclosingInsertId = typeof enclosingInsert.attrs?.id === 'string' ? enclosingInsert.attrs.id : null;
  if (!enclosingInsertId) return false;

  let compatible = true;
  slice.content.descendants?.((node) => {
    if (!compatible || !node.isInline) return compatible ? undefined : false;
    const trackedMarks = (node.marks ?? []).filter(isTrackedReviewMark);
    if (!trackedMarks.length) return;

    const allMatchEnclosingInsertion = trackedMarks.every(
      (mark) => mark.type?.name === TrackInsertMarkName && mark.attrs?.id === enclosingInsertId,
    );
    if (!allMatchEnclosingInsertion) {
      compatible = false;
      return false;
    }
    return undefined;
  });

  return compatible;
};

const collapsedInsertionExtendsTrackedReviewMark = (
  doc: PmNode,
  pos: number,
  slice: { content?: { descendants?: (fn: (node: PmNode) => false | void) => void } },
): boolean => {
  if (!slice.content || !fragmentHasTrackedReviewMark(slice.content)) return false;
  const boundedPos = Math.max(0, Math.min(doc.content.size, pos));
  const $pos = doc.resolve(boundedPos);
  return (
    trackedReviewMarkKeysForNode($pos.nodeBefore).size > 0 || trackedReviewMarkKeysForNode($pos.nodeAfter).size > 0
  );
};

const stepTouchesTrackedReviewState = (step: unknown, doc: PmNode): boolean => {
  if (step instanceof ReplaceStep) {
    // Direct deletes wholly inside an unresolved insertion mutate that
    // insertion in place to match Word. They should not be rerouted into a
    // synthetic tracked delete.
    if (
      step.from !== step.to &&
      step.slice.content.size === 0 &&
      rangeIsTrackedInsertionOnly(doc, step.from, step.to)
    ) {
      return false;
    }
    // Direct typing strictly inside a single unresolved insertion should
    // extend that insertion in place. Re-routing through trackedTransaction
    // would create a child insertion and split the parent suggestion.
    if (
      step.from === step.to &&
      step.slice.content.size > 0 &&
      collapsedInsertionExtendsTrackedInsertion(doc, step.from, step.slice)
    ) {
      return false;
    }
    // Editing mode (tracking off): a collapsed direct insertion strictly
    // inside ANY tracked review span (insertion or deletion) stays direct.
    // Typing destroys nothing - the existing suggestion is just split around
    // the new text - so it must not be force-rerouted into a tracked change.
    // The insertion-interior case already returns false above; this also
    // covers the deletion-interior case. Safe in suggesting mode because
    // shouldTrackForComposition is already true there, so the protect path is
    // irrelevant. The inherited mark is stripped from the new text in
    // #dispatchTransaction so the typed chars stay plain.
    if (
      step.from === step.to &&
      step.slice.content.size > 0 &&
      collapsedPositionIsInsideTrackedReviewMark(doc, step.from)
    ) {
      return false;
    }
    if (rangeHasTrackedReviewMark(doc, step.from, step.to)) return true;
    if (step.from === step.to && step.slice.content.size > 0) {
      return (
        collapsedPositionIsInsideTrackedReviewMark(doc, step.from) ||
        collapsedInsertionExtendsTrackedReviewMark(doc, step.from, step.slice)
      );
    }
    return false;
  }

  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    return rangeHasTrackedReviewMark(doc, step.from, step.to);
  }

  if (step instanceof ReplaceAroundStep) {
    return (
      rangeHasTrackedReviewMark(doc, step.from, step.to) || rangeHasTrackedReviewMark(doc, step.gapFrom, step.gapTo)
    );
  }

  return false;
};

const transactionTouchesTrackedReviewState = (state: EditorState, tr: Transaction): boolean => {
  if (!tr.docChanged || !tr.steps.length) return false;

  const docs = (tr as unknown as { docs?: PmNode[] }).docs ?? [];
  return tr.steps.some((step, index) => stepTouchesTrackedReviewState(step, docs[index] ?? state.doc));
};

// The tracked-review mark instances that ENCLOSE a collapsed position (present on
// both nodeBefore and nodeAfter). These are exactly the marks PM mark-inheritance
// copies onto text inserted strictly inside the span. Returning the specific
// instances (matched by type + attrs) lets the cleanup strip only the inherited
// marks - marks a pasted slice carries in (a different review id) are left intact.
const enclosingTrackedReviewMarksAtCollapsedPosition = (doc: PmNode, pos: number): PmMark[] => {
  const boundedPos = Math.max(0, Math.min(doc.content.size, pos));
  const $pos = doc.resolve(boundedPos);
  const afterKeys = trackedReviewMarkKeysForNode($pos.nodeAfter);
  if (!afterKeys.size) return [];
  const enclosing: PmMark[] = [];
  for (const mark of $pos.nodeBefore?.marks ?? []) {
    const key = trackedReviewMarkKey(mark);
    if (key && afterKeys.has(key)) enclosing.push(mark);
  }
  return enclosing;
};

// Editing-mode collapsed insert strictly inside a tracked review span: returns
// the inserted range (in the post-step doc) plus the enclosing mark instances so
// the inherited suggestion mark can be stripped from the new text. Marks are
// inclusive:false, so a strictly-interior insert still inherits the neighbour's
// trackInsert/trackDelete via PM mark inheritance; without the strip the typed
// chars would silently join the suggestion (struck-through inside a deletion /
// counted as someone else's insert).
const collapsedInsertInsideTrackedReviewMarkRange = (
  state: EditorState,
  tr: Transaction,
): { from: number; to: number; marks: PmMark[] } | null => {
  if (!tr.docChanged || tr.steps.length !== 1) return null;

  const [step] = tr.steps;
  if (!(step instanceof ReplaceStep)) return null;
  if (step.from !== step.to || step.slice.content.size === 0) return null;

  const docs = (tr as unknown as { docs?: PmNode[] }).docs ?? [];
  const docBeforeStep = docs[0] ?? state.doc;
  const marks = enclosingTrackedReviewMarksAtCollapsedPosition(docBeforeStep, step.from);
  if (!marks.length) return null;

  // Use slice.size (content.size - openStart - openEnd) - the size ProseMirror
  // actually maps the inserted range to (ReplaceStep.getMap uses slice.size). For
  // an open slice (a multi-paragraph / rich-HTML collapsed paste) content.size
  // overshoots, so the mark cleanup would strip trackInsert/trackDelete from the
  // existing suggestion text after the paste.
  return { from: step.from, to: step.from + step.slice.size, marks };
};

// Best-effort heuristic for labeling a content-control event's `source`. A
// click sets `uiEvent: 'click'` on its selection transaction (the precise
// signal); this window is the fallback for selection changes that don't carry
// that meta but follow a recent pointerDown. It is deliberately generous (a
// click can be followed by async selection settling); the trade-off is that a
// keyboard move within this window of a click is labeled 'pointer'. Source is
// advisory metadata, not a correctness guarantee.
const CONTENT_CONTROL_POINTER_WINDOW_MS = 800;

type ExtensionInstanceLike = {
  type?: string;
  config?: Record<string, unknown>;
};

const cloneExtensionInstance = <T>(extension: T): T => {
  const extensionLike = extension as ExtensionInstanceLike & {
    constructor?: new (config: Record<string, unknown>) => unknown;
  };
  const config = extensionLike?.config;
  const ExtensionCtor = extensionLike?.constructor;

  if (!config || typeof config !== 'object' || typeof ExtensionCtor !== 'function') {
    return extension;
  }

  try {
    return new ExtensionCtor(config) as T;
  } catch {
    return extension;
  }
};

/**
 * Given a table cell node, returns the total cell content width in pixels.
 * Sums all colwidth values and subtracts left/right cell margins (padding).
 */
function getCellContentWidthPx(cellNode: PmNode): number {
  const colwidth: number[] = cellNode.attrs?.colwidth ?? [];
  const totalWidth = colwidth.reduce((sum: number, w: number) => sum + (w || 0), 0);
  const margins = cellNode.attrs?.cellMargins;
  const leftMargin = margins?.left ?? 0;
  const rightMargin = margins?.right ?? 0;
  return Math.max(totalWidth - leftMargin - rightMargin, 0);
}

/**
 * Image storage structure used by the image extension
 */
interface ImageStorage {
  media: Record<string, unknown>;
  pendingRelativeRegistrations: Set<string>;
}

/**
 * Editor lifecycle state.
 *
 * State machine:
 * ```
 * initialized -> documentLoading -> ready <-> saving
 *                                     |
 *                                     v
 *                                  closed -> documentLoading -> ready
 *                                     |
 *                                     v
 *                                 destroyed
 * ```
 */
export type EditorLifecycleState = 'initialized' | 'documentLoading' | 'ready' | 'saving' | 'closed' | 'destroyed';

/**
 * Options for opening a document.
 */
export interface OpenOptions {
  /** Document mode ('docx', 'text', 'html') */
  mode?: 'docx' | 'text' | 'html';

  /** HTML content to initialize with (for text/html mode) */
  html?: string;

  /** Markdown content to initialize with */
  markdown?: string;

  /** JSON content to initialize with */
  json?: ProseMirrorJSON | null;

  /** Y.js XML fragment to hydrate from */
  fragment?: YXmlFragment | null;

  /** Whether comments are enabled */
  isCommentsEnabled?: boolean;

  /** Prevent default styles from being applied in docx mode */
  suppressDefaultDocxStyles?: boolean;

  /** Document mode ('editing', 'viewing', 'suggesting') */
  documentMode?: 'editing' | 'viewing' | 'suggesting';

  /** Pre-parsed docx content (for when document is already loaded) */
  content?: unknown;

  /** Media files from docx */
  mediaFiles?: Record<string, unknown>;

  /** Font data from docx */
  fonts?: Record<string, unknown>;

  /**
   * Optional override for "new file" semantics on this open call.
   * When omitted, Editor infers the value from the source type.
   */
  isNewFile?: boolean;

  /** Password for opening encrypted .docx files. Cleared from memory after use. */
  password?: string;
}

/**
 * Options for saving a document.
 */
export interface SaveOptions {
  /** Whether this is the final document version */
  isFinalDoc?: boolean;

  /** Comment export type */
  commentsType?: string;

  /** Comments to include in export */
  comments?: Comment[];

  /** Highlight color for fields */
  fieldsHighlightColor?: string | null;

  /** ZIP compression method for docx export. Defaults to 'DEFLATE'. Use 'STORE' for faster exports without compression. */
  compression?: 'DEFLATE' | 'STORE';
}

/**
 * Options for exporting a document.
 * Currently identical to SaveOptions, but may be extended in the future
 * with format-specific options (e.g., format?: 'docx' | 'json' | 'xml').
 */
export type ExportOptions = SaveOptions;

/**
 * Full parameter set for `Editor.exportDocx()`.
 * Extends SaveOptions with internal export format flags.
 */
export interface ExportDocxParams extends SaveOptions {
  /** Return raw XML string instead of a binary blob */
  exportXmlOnly?: boolean;
  /** Return JSON string instead of a binary blob */
  exportJsonOnly?: boolean;
  /** Return the updated file map instead of a binary blob */
  getUpdatedDocs?: boolean;
}

/**
 * Main editor class that manages document state, extensions, and user interactions
 */
export class Editor extends EventEmitter<EditorEventMap> {
  /**
   * Command service for handling editor commands
   */
  #commandService!: CommandService;

  /** Extension service. See `EditorExtensionServiceSurface`. SD-3240. */
  extensionService!: EditorExtensionServiceSurface;

  /**
   * Storage for extension data
   */
  extensionStorage: ExtensionStorage = {};

  /**
   * ProseMirror schema for the editor.
   *
   * Typed as `Schema<string, string>` rather than bare `Schema` to
   * drop the implicit `Schema<any, any>` default through the SD-3213
   * supported-root audit. Node and mark name spaces are typed as
   * `string` (the established ProseMirror constraint shape); consumer
   * schemas with literal-typed names like `Schema<'paragraph', 'em'>`
   * remain assignable.
   *
   * @deprecated Direct ProseMirror access will be removed in a future version. Use the Document API (`editor.doc`) instead.
   */
  schema!: Schema<string, string>;

  /**
   * ProseMirror view instance.
   * Undefined in headless mode or before the editor is mounted.
   * @deprecated Direct ProseMirror access will be removed in a future version. Use the Document API (`editor.doc`) instead.
   */
  view?: PmEditorView;

  /**
   * Renderer responsible for attaching/destroying the editing surface.
   */
  #renderer: EditorRenderer | null = null;

  /**
   * ProseMirror editor state (exists with or without a view)
   */
  private _state!: EditorState;

  /**
   * Whether the editor instance has been destroyed.
   */
  #isDestroyed = false;

  /**
   * Editor lifecycle state.
   * Tracks the current phase of the editor's document lifecycle.
   */
  #editorLifecycleState: EditorLifecycleState = 'initialized';

  /**
   * Document API instance (lazy-initialized).
   */
  #documentApi: DocumentApi | null = null;

  /**
   * Source path of the currently opened document.
   * Set when opening from a file path, null when opening from Blob/Buffer or blank.
   */
  #sourcePath: string | null = null;

  /**
   * Active PresentationEditor instance when layout mode is enabled.
   * Set by PresentationEditor constructor to enable renderer-neutral helpers.
   */
  presentationEditor: PresentationEditor | null = null;

  /**
   * Returns the current total number of pages when pagination is active.
   * Delegates to the PresentationEditor's layout state.
   * Returns `undefined` before the first layout completes or when pagination is off.
   */
  get currentTotalPages(): number | undefined {
    if (this.presentationEditor) {
      const pages = this.presentationEditor.getPages();
      return pages.length > 0 ? pages.length : undefined;
    }
    return undefined;
  }

  /**
   * Whether the editor currently has focus
   */
  isFocused: boolean = false;

  /**
   * All the embedded fonts that were imported by the Editor
   */
  fontsImported: string[] = [];

  /**
   * The document converter instance
   */
  /** Document converter handle. See `EditorConverterSurface`. SD-3240. */
  converter!: EditorConverterSurface;

  /**
   * Toolbar instance (if attached)
   */
  toolbar?: Toolbar;

  /**
   * Original state for preview mode
   */
  originalState?: EditorState;

  /**
   * High contrast mode setter
   */
  setHighContrastMode?: (enabled: boolean) => void;

  /**
   * Telemetry instance for tracking document opens
   */
  #telemetry: Telemetry | null = null;

  /**
   * Guard flag to prevent double-tracking document open
   */
  #documentOpenTracked = false;
  #lastActiveContentControlRef: SdtRef | null = null;
  #lastPointerDownAt = 0;

  /**
   * Fragment configured at construction time. This is reusable default config,
   * unlike document-scoped fragments supplied to a single open() call.
   */
  #constructorFragment: YXmlFragment | null = null;

  options: EditorOptions = {
    element: null,
    selector: null,
    isHeadless: false,
    document: null,
    mockDocument: null,
    mockWindow: null,
    content: '', // XML content
    user: null,
    users: [],
    media: {},
    mediaFiles: {},
    fonts: {},
    documentMode: 'editing',
    mode: 'docx',
    role: 'editor',
    colors: [],
    converter: null,
    fileSource: null,
    initialState: null,
    documentId: null,
    extensions: [],
    editable: true,
    editorProps: {},
    parseOptions: {},
    coreExtensionOptions: {},
    enableInputRules: true,
    isCommentsEnabled: false,
    isNewFile: false,
    scale: 1,
    viewOptions: { layout: 'print' },
    annotations: false,
    isInternal: false,
    externalExtensions: [],
    isChildEditor: false,
    numbering: {},
    isHeaderOrFooter: false,
    lastSelection: null,
    suppressDefaultDocxStyles: false,
    jsonOverride: null,
    loadFromSchema: false,
    fragment: null,
    skipViewCreation: false,
    onBeforeCreate: () => null,
    onCreate: () => null,
    onUpdate: () => null,
    onSelectionUpdate: () => null,
    onTransaction: () => null,
    onFocus: () => null,
    onBlur: () => null,
    onDestroy: () => null,
    onContentError: ({ error }: { editor: Editor; error: unknown; disableCollaboration?: () => void }) => {
      throw error;
    },
    onTrackedChangesUpdate: () => null,
    onCommentsUpdate: () => null,
    onCommentsLoaded: () => null,
    onCommentClicked: () => null,
    onCommentLocationsUpdate: () => null,
    onPointerDown: () => null,
    onPointerUp: () => null,
    onRightClick: () => null,
    onDocumentLocked: () => null,
    onFirstRender: () => null,
    onCollaborationReady: () => null,
    onException: () => null,
    onListDefinitionsChange: () => null,
    onFontsResolved: null,
    // async (file) => url;
    handleImageUpload: null,

    // Docx xml updated by User
    customUpdatedFiles: {},

    isHeaderFooterChanged: false,
    isCustomXmlChanged: false,
    ydoc: null,
    collaborationProvider: null,
    collaborationIsReady: false,
    shouldLoadComments: false,
    replacedFile: false,

    focusTarget: null,
    permissionResolver: null,

    // header/footer editors may have parent(main) editor set
    parentEditor: null,

    // License key (resolved in #initTelemetry; undefined means "not explicitly set")
    licenseKey: undefined,

    // Telemetry configuration
    telemetry: { enabled: true },
  };

  /**
   * Create a new Editor instance.
   *
   * **Legacy mode (backward compatible):**
   * When `content` or `fileSource` is provided, the editor initializes synchronously
   * with the document loaded immediately. This preserves existing behavior where
   * `editor.view` is available right after construction.
   *
   * **New mode (document lifecycle API):**
   * When no `content` or `fileSource` is provided, only core services (extensions,
   * commands, schema) are initialized. Call `editor.open()` to load a document.
   *
   * @param options - Editor configuration options
   *
   * @example
   * ```typescript
   * // Legacy mode (still works)
   * const editor = new Editor({ content: docx, element: el });
   * console.log(editor.view.state.doc); // Works immediately
   *
   * // New mode
   * const editor = new Editor({ element: el });
   * await editor.open('/path/to/doc.docx');
   * ```
   */
  constructor(options: Partial<EditorOptions>) {
    super();

    const resolvedOptions = normalizeEditorTrackChangesOptions(options);
    const domAvailable = canUseDOM();
    const isHeadlessRequested = Boolean(resolvedOptions.isHeadless);
    const mountRequested = Boolean(resolvedOptions.element || resolvedOptions.selector);
    const domDocumentForImport =
      resolvedOptions.document ?? resolvedOptions.mockDocument ?? (domAvailable ? document : null);

    const requiresDomForImport =
      Boolean(resolvedOptions.html || resolvedOptions.markdown) ||
      ((resolvedOptions.mode === 'text' || resolvedOptions.mode === 'html') &&
        typeof resolvedOptions.content === 'string');

    if (!domDocumentForImport && requiresDomForImport) {
      throw new Error(
        '[super-editor] HTML/Markdown import requires a DOM. Provide { document } (e.g. from JSDOM), set DOM globals, or run in a browser environment.',
      );
    }

    if (!domAvailable && mountRequested && !isHeadlessRequested) {
      throw new Error(
        '[super-editor] Cannot mount an editor without a DOM. Provide DOM globals (e.g. via JSDOM) or pass { isHeadless: true }.',
      );
    }

    if (!domAvailable && !isHeadlessRequested) {
      resolvedOptions.isHeadless = true;
    }

    if (resolvedOptions.isHeadless) {
      resolvedOptions.element = null;
      resolvedOptions.selector = null;
    }

    this.#constructorFragment = resolvedOptions.fragment ?? null;

    this.#checkHeadless(resolvedOptions);
    this.setOptions(resolvedOptions);
    this.#renderer = resolvedOptions.renderer ?? (domAvailable ? new ProseMirrorRenderer() : null);
    this.#initTelemetry();

    const { setHighContrastMode } = useHighContrastMode();
    this.setHighContrastMode = setHighContrastMode;

    // New API mode: only when explicitly requested via deferDocumentLoad option
    // This preserves 100% backward compatibility - the original editor ALWAYS created a view
    const useNewApiMode = resolvedOptions.deferDocumentLoad === true;

    if (useNewApiMode) {
      // NEW MODE: Initialize core only, wait for open()
      // This is opt-in to ensure zero breaking changes
      this.#initCore();
      this.#editorLifecycleState = 'initialized';
    } else {
      // LEGACY MODE (default): Exact current behavior - synchronous, view created immediately
      const modes: Record<string, () => void> = {
        docx: () => this.#init(),
        text: () => this.#initRichText(),
        html: () => this.#initRichText(),
        default: () => {
          console.log('Not implemented.');
        },
      };

      const initMode = modes[this.options.mode!] ?? modes.default;
      initMode();
      this.#editorLifecycleState = 'ready';
    }
  }

  /**
   * Getter which indicates if any changes happen in Editor
   */
  get docChanged(): boolean {
    return (
      this.options.isHeaderFooterChanged ||
      this.options.isCustomXmlChanged ||
      !this.options.initialState!.doc.eq(this.state.doc)
    );
  }

  /**
   * Initialize the container element for the editor
   */
  #initContainerElement(options: Partial<EditorOptions>): void {
    this.#renderer?.initContainerElement?.(options);
  }

  #shouldMountRenderer(): boolean {
    return canUseDOM() && !this.options.isHeadless;
  }

  #getDomDocument(): Document | null {
    return this.options.document ?? this.options.mockDocument ?? (canUseDOM() ? document : null);
  }

  #emitCreateAsync(): void {
    setTimeout(() => {
      if (this.isDestroyed) return;
      this.emit('create', { editor: this });
    }, 0);

    // Generate metadata and track telemetry (non-blocking)
    this.#trackDocumentOpen();
  }

  /**
   * Initialize telemetry if configured
   */
  #initTelemetry(): void {
    const { telemetry: telemetryConfig, licenseKey } = this.options;

    // Skip in test environments and when telemetry is not enabled
    if (typeof process !== 'undefined' && (process.env?.VITEST || process.env?.NODE_ENV === 'test')) {
      return;
    }

    // Skip for sub-editors that are not primary document editors
    if (this.options.mode === 'text' || this.options.isHeaderOrFooter || this.options.isChildEditor) {
      return;
    }

    if (!telemetryConfig?.enabled) {
      return;
    }

    // Root-level licenseKey has a priority; fall back to deprecated telemetry.licenseKey
    const resolvedLicenseKey =
      licenseKey !== undefined ? licenseKey : (telemetryConfig.licenseKey ?? COMMUNITY_LICENSE_KEY);

    try {
      this.#telemetry = new Telemetry({
        enabled: true,
        endpoint: telemetryConfig.endpoint,
        licenseKey: resolvedLicenseKey,
        metadata: telemetryConfig.metadata,
      });
      console.debug('[super-editor] Telemetry: enabled');
    } catch {
      // Fail silently - telemetry should never break the app
    }
  }

  /**
   * Ensure document metadata is generated and track telemetry if enabled
   */
  #trackDocumentOpen(): void {
    // Always generate metadata (GUID, timestamp) regardless of telemetry
    this.getDocumentIdentifier().then((documentId) => {
      // Only track if telemetry enabled and not already tracked
      if (!this.#telemetry || this.#documentOpenTracked) return;

      try {
        const documentCreatedAt = this.converter?.getDocumentCreatedTimestamp?.() ?? null;
        this.#telemetry.trackDocumentOpen(documentId, documentCreatedAt);
        this.#documentOpenTracked = true;
      } catch {
        // Fail silently - telemetry should never break the app
      }
    });
  }

  /**
   * Assert that the editor is in one of the allowed states.
   * Throws InvalidStateError if not.
   */
  #assertState(...allowed: EditorLifecycleState[]): void {
    if (!allowed.includes(this.#editorLifecycleState)) {
      throw new InvalidStateError(
        `Invalid operation: editor is in '${this.#editorLifecycleState}' state, expected one of: ${allowed.join(', ')}`,
      );
    }
  }

  /**
   * Wraps an async operation with state transitions for safe lifecycle management.
   *
   * This method ensures atomic state transitions during async operations:
   * 1. Sets state to `during` before executing the operation
   * 2. On success: sets state to `success` and returns the operation result
   * 3. On error: sets state to `failure` and re-throws the error
   *
   * This prevents race conditions and ensures the editor is always in a valid state,
   * even when operations fail.
   *
   * @param during - State to set while the operation is running
   * @param success - State to set if the operation succeeds
   * @param failure - State to set if the operation fails
   * @param operation - Async operation to execute
   * @returns Promise resolving to the operation's return value
   * @throws Re-throws any error from the operation after setting failure state
   *
   * @example
   * ```typescript
   * // Used internally for save operations:
   * await this.#withState('saving', 'ready', 'ready', async () => {
   *   const data = await this.exportDocument();
   *   await this.#writeToPath(path, data);
   * });
   * ```
   */
  async #withState<T>(
    during: EditorLifecycleState,
    success: EditorLifecycleState,
    failure: EditorLifecycleState,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.#editorLifecycleState = during;
    try {
      const result = await operation();
      this.#editorLifecycleState = success;
      return result;
    } catch (error) {
      this.#editorLifecycleState = failure;
      throw error;
    }
  }

  /**
   * Initialize core editor services for new lifecycle API mode.
   *
   * When `deferDocumentLoad: true` is set, this method initializes only the
   * document-independent components:
   * - Extension service (loads and configures all extensions)
   * - Command service (registers all editor commands)
   * - ProseMirror schema (derived from extensions, reusable across documents)
   *
   * These services are created once during construction and reused when opening
   * different documents via the `open()` method. This enables efficient document
   * switching without recreating the entire editor infrastructure.
   *
   * Called exclusively from the constructor when `deferDocumentLoad` is true.
   *
   * @remarks
   * This is part of the new lifecycle API that separates editor initialization
   * from document loading. The schema and extensions remain constant while
   * documents can be opened, closed, and reopened.
   *
   * @see #loadDocument - Loads document-specific state after core initialization
   */
  #initCore(): void {
    // Apply default extensions if none provided
    if (!this.options.extensions?.length) {
      this.options.extensions = this.options.mode === 'docx' ? getStarterExtensions() : getRichTextExtensions();
    }

    this.#createExtensionService();
    this.#createCommandService();
    this.#createSchema();

    // Register event listeners once during core init (not per-document)
    this.#registerEventListeners();
  }

  /**
   * Register all event listeners from options.
   *
   * Called once during core initialization. These listeners persist across
   * document open/close cycles since the callbacks are set at construction time.
   */
  #registerEventListeners(): void {
    this.on('create', this.options.onCreate!);
    this.on('update', this.options.onUpdate!);
    this.on('selectionUpdate', this.options.onSelectionUpdate!);
    this.on('transaction', this.options.onTransaction!);
    this.on('focus', this.#onFocus.bind(this));
    this.on('blur', this.options.onBlur!);
    this.on('destroy', this.options.onDestroy!);
    this.on('trackedChangesUpdate', this.options.onTrackedChangesUpdate!);
    this.on('commentsLoaded', this.options.onCommentsLoaded!);
    this.on('commentClick', this.options.onCommentClicked!);
    this.on('commentsUpdate', this.options.onCommentsUpdate!);
    this.on('locked', this.options.onDocumentLocked!);
    this.on('collaborationReady', this.#onCollaborationReady.bind(this));
    this.on('comment-positions', this.options.onCommentLocationsUpdate!);
    this.on('list-definitions-change', this.options.onListDefinitionsChange!);
    this.on('fonts-resolved', this.options.onFontsResolved!);
    // Emitted unconditionally by PresentationEditor, so only register a real callback -
    // a bare `this.on('fonts-changed', undefined)` would make `emit` call undefined.
    if (this.options.onFontsChanged) this.on('fonts-changed', this.options.onFontsChanged);
    this.on('exception', this.options.onException!);
    this.on('pointerDown', this.options.onPointerDown!);
    this.#trackContentControlPointer();
    this.on('pointerUp', this.options.onPointerUp!);
    this.on('rightClick', this.options.onRightClick!);
  }

  /**
   * Record the most recent pointerDown timestamp for content-control event
   * source detection. Registered on every init path (#registerEventListeners,
   * #init, #initRichText) so source detection works regardless of
   * deferDocumentLoad - the default PresentationEditor path uses #init /
   * #initRichText, not #registerEventListeners.
   */
  #trackContentControlPointer(): void {
    this.on('pointerDown', () => {
      this.#lastPointerDownAt = Date.now();
    });
  }

  /**
   * Load a document into the editor from various source types.
   *
   * This method handles the complete document loading pipeline:
   * 1. **Source resolution**: Determines source type (path/File/Blob/Buffer/blank)
   * 2. **Content loading**:
   *    - String path: Reads file from disk (Node.js) or fetches URL (browser)
   *    - File/Blob: Extracts docx archive data
   *    - Buffer: Processes binary data (Node.js)
   *    - undefined/null: Creates blank document
   * 3. **Document initialization**: Creates converter, media, fonts, initial state
   * 4. **View mounting**: Attaches ProseMirror view (unless headless)
   * 5. **Event wiring**: Connects all lifecycle event handlers
   *
   * Called by `open()` after state validation, wrapped in `#withState()` for
   * atomic state transitions.
   *
   * @param source - Document source:
   *   - `string`: File path (Node.js reads from disk, browser fetches as URL)
   *   - `File | Blob`: Browser file object or blob
   *   - `Buffer`: Node.js buffer containing docx data
   *   - `undefined | null`: Creates a blank document
   * @param options - Document-level options (mode, comments, styles, etc.)
   * @returns Promise that resolves when document is fully loaded and ready
   * @throws {DocumentLoadError} If any step of document loading fails. The error
   *   wraps the underlying cause for debugging.
   *
   * @remarks
   * - Sets `#sourcePath` for path-based sources (enables `save()`)
   * - Sets `#sourcePath = null` for Blob/Buffer sources (requires `saveTo()`)
   * - In browser, string paths are treated as URLs to fetch
   * - In Node.js, string paths are read from the filesystem
   *
   * @see open - Public API that calls this method
   * @see #unloadDocument - Cleanup counterpart that reverses this process
   */
  async #loadDocument(source?: string | File | Blob | Buffer, options?: OpenOptions): Promise<void> {
    try {
      // Merge options with defaults
      const resolvedMode = options?.mode ?? this.options.mode ?? 'docx';
      const explicitIsNewFile = options?.isNewFile;
      const hasOpenFragment = Object.prototype.hasOwnProperty.call(options ?? {}, 'fragment');
      const resolvedOptions = {
        ...this.options,
        mode: resolvedMode,
        isCommentsEnabled: options?.isCommentsEnabled ?? this.options.isCommentsEnabled,
        suppressDefaultDocxStyles: options?.suppressDefaultDocxStyles ?? this.options.suppressDefaultDocxStyles,
        documentMode: options?.documentMode ?? this.options.documentMode ?? 'editing',
        html: options?.html,
        markdown: options?.markdown,
        jsonOverride: options?.json ?? null,
        fragment: hasOpenFragment ? (options?.fragment ?? null) : (this.options.fragment ?? this.#constructorFragment),
      };

      // Password for encrypted .docx — threaded to loadXmlData, then cleared
      const loadOptions = options?.password ? { password: options.password } : undefined;

      // Determine source type and load XML data
      if (typeof source === 'string') {
        // Node.js: read file from path
        if (typeof process !== 'undefined' && process.versions?.node) {
          // Dynamic require to avoid bundler issues
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require('fs') as typeof import('fs');
          const buffer = fs.readFileSync(source);
          const [docx, _media, mediaFiles, fonts, decryptedData] = (await Editor.loadXmlData(
            buffer,
            true,
            loadOptions,
          ))!;
          resolvedOptions.content = docx;
          resolvedOptions.mediaFiles = mediaFiles;
          resolvedOptions.fonts = fonts;
          resolvedOptions.fileSource = decryptedData ?? buffer;
          resolvedOptions.isNewFile = explicitIsNewFile ?? false;
          // When the file was encrypted, clear sourcePath so that save()
          // cannot silently overwrite the protected original with an
          // unencrypted ZIP. Callers must use saveTo() or exportDocument().
          this.#sourcePath = decryptedData ? null : source;
        } else {
          // Browser: fetch the file
          const response = await fetch(source);
          if (!response.ok) {
            console.debug('[SuperDoc] Fetch failed:', response.status, response.statusText);
            throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
          }
          const blob = await response.blob();
          const [docx, _media, mediaFiles, fonts, decryptedData] = (await Editor.loadXmlData(
            blob,
            false,
            loadOptions,
          ))!;
          resolvedOptions.content = docx;
          resolvedOptions.mediaFiles = mediaFiles;
          resolvedOptions.fonts = fonts;
          resolvedOptions.fileSource = decryptedData ?? blob;
          resolvedOptions.isNewFile = explicitIsNewFile ?? false;
          // In browser, path is just a suggested filename
          this.#sourcePath = source.split('/').pop() || null;
        }
      } else if (source != null && typeof source === 'object') {
        // File, Blob, Buffer, or ArrayBuffer-like object
        // Check for Buffer in Node.js (Buffer.isBuffer is more reliable than instanceof)
        const isNodeBuffer = typeof Buffer !== 'undefined' && (Buffer.isBuffer(source) || source instanceof Buffer);
        const isBlob = typeof Blob !== 'undefined' && source instanceof Blob;
        const isArrayBuffer = source instanceof ArrayBuffer;
        const hasArrayBuffer = typeof source === 'object' && 'buffer' in source && source.buffer instanceof ArrayBuffer;

        if (isNodeBuffer || isBlob || isArrayBuffer || hasArrayBuffer) {
          const [docx, _media, mediaFiles, fonts, decryptedData] = (await Editor.loadXmlData(
            source as File | Blob | Buffer,
            isNodeBuffer,
            loadOptions,
          ))!;
          resolvedOptions.content = docx;
          resolvedOptions.mediaFiles = mediaFiles;
          resolvedOptions.fonts = fonts;
          resolvedOptions.fileSource = decryptedData ?? (source as File | Blob | Buffer);
          resolvedOptions.isNewFile = explicitIsNewFile ?? false;
          this.#sourcePath = null;
        } else {
          // Unknown object type - try to load it anyway
          const [docx, _media, mediaFiles, fonts, decryptedData] = (await Editor.loadXmlData(
            source as File | Blob | Buffer,
            false,
            loadOptions,
          ))!;
          resolvedOptions.content = docx;
          resolvedOptions.mediaFiles = mediaFiles;
          resolvedOptions.fonts = fonts;
          resolvedOptions.fileSource = decryptedData ?? (source as File | Blob | Buffer);
          resolvedOptions.isNewFile = explicitIsNewFile ?? false;
          this.#sourcePath = null;
        }
      } else {
        // Blank document (source is undefined or null)
        // For docx mode without pre-parsed content, load the blank.docx template
        const shouldLoadBlankDocx =
          resolvedMode === 'docx' && !options?.content && !options?.html && !options?.markdown;

        if (shouldLoadBlankDocx) {
          const { content, mediaFiles, fonts, fileSource } = await this.#loadBlankDocxTemplate();
          resolvedOptions.content = content;
          resolvedOptions.mediaFiles = {
            ...mediaFiles,
            ...(options?.mediaFiles ?? {}),
          };
          resolvedOptions.fonts = {
            ...fonts,
            ...(options?.fonts ?? {}),
          };
          resolvedOptions.fileSource = fileSource;
          resolvedOptions.isNewFile = explicitIsNewFile ?? true;
          this.#sourcePath = null;
        } else {
          // Use pre-parsed content from options if provided, otherwise create minimal structure
          resolvedOptions.content = (options?.content ?? []) as string | Record<string, unknown> | DocxFileEntry[];
          resolvedOptions.mediaFiles = options?.mediaFiles ?? {};
          resolvedOptions.fonts = options?.fonts ?? {};
          resolvedOptions.fileSource = null;
          // Pre-parsed content means "existing document", otherwise this is a new blank file.
          resolvedOptions.isNewFile = explicitIsNewFile ?? !options?.content;
          this.#sourcePath = null;
        }
      }

      // Update options
      this.setOptions(resolvedOptions);

      // Create converter
      this.#createConverter();
      initPartsRuntime(this);
      this.#initProtectionState();

      // Initialize media
      this.#initMedia();

      // Initialize fonts (if not headless)
      const shouldMountRenderer = this.#shouldMountRenderer();
      if (shouldMountRenderer) {
        this.#initContainerElement(this.options);
        this.#initFonts();
      }

      // Create initial state
      this.#createInitialState({ includePlugins: !shouldMountRenderer });

      // In headless mode, run synthetic transaction pass
      if (!shouldMountRenderer) {
        const tr = this.state.tr.setMeta('forcePluginPass', true).setMeta('addToHistory', false);
        this.#dispatchTransaction(tr);
      }

      // Mount if not headless
      if (shouldMountRenderer) {
        this.mount(this.options.element!);
        this.#configureStateWithExtensionPlugins();
      }

      // Emit create event
      if (!shouldMountRenderer) {
        this.#emitCreateAsync();
      }

      // Initialize default styles (if not headless)
      if (shouldMountRenderer) {
        this.initDefaultStyles();
        this.#checkFonts();
      }

      // Migrate lists if needed
      const shouldMigrateListsOnInit = Boolean(
        this.options.markdown ||
          this.options.html ||
          this.options.loadFromSchema ||
          this.options.jsonOverride ||
          this.options.mode === 'html' ||
          this.options.mode === 'text',
      );
      if (shouldMigrateListsOnInit) {
        this.migrateListsToV2();
      }

      // Set document mode
      this.setDocumentMode(this.options.documentMode!, 'init');

      // Emit protectionChanged with source 'init' for the loaded document
      this.#emitProtectionInit();

      // Initialize collaboration data for new files
      this.initializeCollaborationData();

      // Initialize comments
      if (!this.options.ydoc && !this.options.isChildEditor) {
        this.#initComments();
      }

      // Initialize dev tools and copy handler
      if (shouldMountRenderer) {
        this.#initDevTools();
        this.#registerCopyHandler();
      }
    } catch (error) {
      // Encryption errors are structured and recoverable — surface them directly
      // so consumers can inspect error.code (PASSWORD_REQUIRED, PASSWORD_INVALID, etc.)
      if (error instanceof DocxEncryptionError) {
        console.debug('[SuperDoc] Document load error:', error.message);
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      console.debug('[SuperDoc] Document load error:', err.message);
      throw new DocumentLoadError(`Failed to load document: ${err.message}`, err);
    }
  }

  /**
   * Unload the current document and clean up all document-specific resources.
   *
   * This method performs a complete cleanup of document state while preserving
   * the core editor services (schema, extensions, commands) for reuse:
   *
   * **Resources cleaned up:**
   * - ProseMirror view (unmounted from DOM)
   * - Header/footer editors (destroyed)
   * - Document converter instance
   * - Media references and image storage
   * - Source path reference
   * - Document-specific options (content, fileSource, initialState)
   * - ProseMirror editor state
   *
   * **Resources preserved:**
   * - ProseMirror schema
   * - Extension service and registered extensions
   * - Command service and registered commands
   * - Event listeners (registered once during core init, reused across documents)
   *
   * After cleanup, the editor transitions to 'closed' state and can be reopened
   * with a new document via `open()`.
   *
   * Called by `close()` after emitting the `documentClose` event.
   *
   * @remarks
   * This is a critical part of the document lifecycle API that enables efficient
   * document switching. By preserving schema and extensions, we avoid expensive
   * reinitialization when opening multiple documents sequentially.
   *
   * @see close - Public API that calls this method
   * @see #loadDocument - Counterpart method that loads document resources
   */
  #unloadDocument(): void {
    // Unmount the view
    this.unmount();

    // Destroy header/footer editors
    this.destroyHeaderFooterEditors();

    // Reset converter
    this.converter = undefined!;

    // Clear media references
    if (this.storage.image) {
      (this.storage.image as ImageStorage).media = {};
    }

    // Reset protection state
    const protStorageToReset = getProtectionStorage(this);
    if (protStorageToReset) {
      protStorageToReset.state = { ...DEFAULT_PROTECTION_STATE };
      protStorageToReset.initialized = false;
      protStorageToReset.editableBaseline = null;
    }

    // Clear source path
    this.#sourcePath = null;

    // Clear document-specific state
    this.options.initialState = null;
    this.options.content = '';
    this.options.fileSource = null;
    this.options.fragment = null;

    // Reset internal state
    this._state = undefined!;

    // Reset content-control event tracking. These track the active SDT and the
    // last pointer-down for the *current* document; leaving them set would leak
    // a stale `previous` into the first content-control event of the next
    // document opened on this instance (or skip the first focus if ids collide).
    this.#lastActiveContentControlRef = null;
    this.#lastPointerDownAt = 0;
  }

  /**
   * Bootstrap protection state from word/settings.xml into editor.storage.protection.
   * Must be called after converter and parts runtime are ready, before #createInitialState().
   */
  #initProtectionState(): void {
    const protStorage = getProtectionStorage(this);
    if (!protStorage) return;
    // SD-3240: readSettingsRoot accepts a narrow `ConverterWithDocumentSettings`
    // shape that overlaps with EditorConverterSurface but uses a
    // different `pageStyles` typing (alternateHeaders flag). Cast to
    // the local narrow interface. Both shapes are honest no-`any`
    // contracts on the same runtime instance.
    const settingsRoot = this.converter
      ? readSettingsRoot(this.converter as unknown as Parameters<typeof readSettingsRoot>[0])
      : null;
    protStorage.state = parseProtectionState(settingsRoot);
    protStorage.initialized = true;
  }

  /**
   * Emit protectionChanged with source 'init' so consumers can react to the
   * initial protection state. Called after event listeners are registered.
   */
  #emitProtectionInit(): void {
    const protStorage = getProtectionStorage(this);
    if (!protStorage?.initialized) return;
    this.emit('protectionChanged', {
      editor: this,
      state: protStorage.state,
      source: 'init',
    });
  }

  /**
   * Initialize the editor with the given options
   */
  #init(): void {
    this.#createExtensionService();
    this.#createCommandService();
    this.#createSchema();
    this.#createConverter();
    initPartsRuntime(this);
    this.#initProtectionState();
    this.#initMedia();

    this.on('beforeCreate', this.options.onBeforeCreate!);
    this.emit('beforeCreate', { editor: this });
    this.on('contentError', this.options.onContentError!);

    const shouldMountRenderer = this.#shouldMountRenderer();
    this.#createInitialState({ includePlugins: !shouldMountRenderer });
    // In headless mode the view never dispatches an initial transaction,
    // so run one synthetic pass to let appendTransaction hooks (e.g. numbering) populate derived attrs.
    if (!shouldMountRenderer) {
      const tr = this.state.tr.setMeta('forcePluginPass', true).setMeta('addToHistory', false);
      this.#dispatchTransaction(tr);
    }
    if (shouldMountRenderer) {
      this.#initContainerElement(this.options);
      this.#initFonts();
      this.mount(this.options.element!);
      this.#configureStateWithExtensionPlugins();
    }

    this.on('create', this.options.onCreate!);
    this.on('update', this.options.onUpdate!);
    this.on('selectionUpdate', this.options.onSelectionUpdate!);
    this.on('transaction', this.options.onTransaction!);
    this.on('focus', this.#onFocus.bind(this));
    this.on('blur', this.options.onBlur!);
    this.on('destroy', this.options.onDestroy!);
    this.on('trackedChangesUpdate', this.options.onTrackedChangesUpdate!);
    this.on('commentsLoaded', this.options.onCommentsLoaded!);
    this.on('commentClick', this.options.onCommentClicked!);
    this.on('commentsUpdate', this.options.onCommentsUpdate!);
    this.on('locked', this.options.onDocumentLocked!);
    this.on('collaborationReady', this.#onCollaborationReady.bind(this));
    this.on('comment-positions', this.options.onCommentLocationsUpdate!);
    this.on('list-definitions-change', this.options.onListDefinitionsChange!);
    this.on('fonts-resolved', this.options.onFontsResolved!);
    // Emitted unconditionally by PresentationEditor, so only register a real callback -
    // a bare `this.on('fonts-changed', undefined)` would make `emit` call undefined.
    if (this.options.onFontsChanged) this.on('fonts-changed', this.options.onFontsChanged);
    this.on('exception', this.options.onException!);
    this.on('pointerDown', this.options.onPointerDown!);
    this.#trackContentControlPointer();
    this.on('pointerUp', this.options.onPointerUp!);
    this.on('rightClick', this.options.onRightClick!);

    if (!shouldMountRenderer) {
      this.#emitCreateAsync();
    }

    this.initializeCollaborationData();

    if (shouldMountRenderer) {
      this.initDefaultStyles();
      this.#checkFonts();
    }

    const shouldMigrateListsOnInit = Boolean(
      this.options.markdown ||
        this.options.html ||
        this.options.loadFromSchema ||
        this.options.jsonOverride ||
        this.options.mode === 'html' ||
        this.options.mode === 'text',
    );

    if (shouldMigrateListsOnInit) {
      this.migrateListsToV2();
    }

    this.setDocumentMode(this.options.documentMode!, 'init');

    // Emit protectionChanged with source 'init' so consumers can react
    // to the initial protection state after all listeners are registered.
    this.#emitProtectionInit();

    if (!this.options.ydoc && !this.options.isChildEditor) {
      this.#initComments();
    }

    if (shouldMountRenderer) {
      this.#initDevTools();
      this.#registerCopyHandler();
    }
  }

  /**
   * Initialize the editor in rich text mode
   */
  #initRichText(): void {
    if (!this.options.extensions || !this.options.extensions.length) {
      this.options.extensions = getRichTextExtensions();
    }

    this.#createExtensionService();
    this.#createCommandService();
    this.#createSchema();

    this.on('beforeCreate', this.options.onBeforeCreate!);
    this.emit('beforeCreate', { editor: this });
    this.on('contentError', this.options.onContentError!);

    const shouldMountRenderer = this.#shouldMountRenderer();
    this.#createInitialState({ includePlugins: !shouldMountRenderer });
    if (shouldMountRenderer) {
      this.#initContainerElement(this.options);
      this.mount(this.options.element!);
      this.#configureStateWithExtensionPlugins();
    }

    this.on('create', this.options.onCreate!);
    this.on('update', this.options.onUpdate!);
    this.on('selectionUpdate', this.options.onSelectionUpdate!);
    this.on('transaction', this.options.onTransaction!);
    this.on('focus', this.#onFocus.bind(this));
    this.on('blur', this.options.onBlur!);
    this.on('destroy', this.options.onDestroy!);
    this.on('commentsLoaded', this.options.onCommentsLoaded!);
    this.on('commentClick', this.options.onCommentClicked!);
    this.on('locked', this.options.onDocumentLocked!);
    this.on('list-definitions-change', this.options.onListDefinitionsChange!);
    this.on('pointerDown', this.options.onPointerDown!);
    this.#trackContentControlPointer();
    this.on('pointerUp', this.options.onPointerUp!);
    this.on('rightClick', this.options.onRightClick!);

    if (!shouldMountRenderer) {
      this.#emitCreateAsync();
    }
  }

  mount(el: HTMLElement | null): void {
    this.#createView(el);

    setTimeout(() => {
      if (this.isDestroyed) return;
      this.emit('create', { editor: this });
    }, 0);

    // Generate metadata and track telemetry (non-blocking)
    this.#trackDocumentOpen();
  }

  unmount(): void {
    this.view?.dom?.removeEventListener('compositionend', this.#handleDomCompositionEnd);
    this.view?.dom?.removeEventListener('blur', this.#handleDomCompositionEnd);
    this.#deferredCompositionRange = null;
    this.#deferredCompositionDeletions = [];
    this.#deferredCompositionId = undefined;
    if (this.#renderer) {
      this.#renderer.destroy();
    } else if (this.view) {
      this.view.destroy();
    }
    this.view = undefined;
  }

  /**
   * Handle focus event
   */
  #onFocus({ editor, event }: { editor: Editor; event: FocusEvent }): void {
    this.toolbar?.setActiveEditor?.(editor);
    this.options.onFocus?.({ editor, event });
  }

  /**
   * Set the toolbar for this editor
   */
  setToolbar(toolbar: Toolbar): void {
    this.toolbar = toolbar;
  }

  /**
   * Check if the editor should run in headless mode
   */
  #checkHeadless(options: Partial<EditorOptions>): void {
    if (!options.isHeadless) return;

    // Set up minimal navigator for Node.js environments
    if (typeof navigator === 'undefined') {
      // Create a minimal navigator object with required properties
      // @ts-expect-error - Partial navigator object for headless mode
      (global as typeof globalThis & { navigator?: unknown }).navigator = {
        platform: 'node',
        userAgent: 'Node.js',
      };
    }

    // Deprecation warnings for legacy mock options
    if (options.mockDocument) {
      console.warn(
        '[super-editor] `mockDocument` is deprecated and will be removed in a future version. ' +
          'Use `document` instead (e.g., `new Editor({ document: jsdomDocument })`). ' +
          'See https://docs.superdoc.dev/guide/headless for migration guidance.',
      );
      (global as typeof globalThis).document = options.mockDocument;
    }
    if (options.mockWindow) {
      console.warn(
        '[super-editor] `mockWindow` is deprecated and will be removed in a future version. ' +
          'Prefer passing `document` only. Global window assignment is no longer required for headless mode.',
      );
      (global as typeof globalThis).window = options.mockWindow as Window & typeof globalThis;
    }
  }

  /**
   * Check if web layout mode is enabled (OOXML ST_View 'web')
   */
  isWebLayout(): boolean {
    return this.options.viewOptions?.layout === 'web';
  }

  /**
   * Focus the editor.
   */
  focus(): void {
    this.view?.focus();
  }

  /**
   * Get the editor state.
   * @deprecated Direct ProseMirror state access will be removed in a future version. Use the Document API (`editor.doc`) instead.
   */
  get state(): EditorState {
    return this._state;
  }

  /**
   * Get the current editor lifecycle state.
   *
   * @returns The current lifecycle state ('initialized', 'documentLoading', 'ready', 'saving', 'closed', 'destroyed')
   */
  get lifecycleState(): EditorLifecycleState {
    return this.#editorLifecycleState;
  }

  /**
   * Get the source path of the currently opened document.
   *
   * Returns the file path if the document was opened from a path (Node.js),
   * or null if opened from a Blob/Buffer or created as a blank document.
   *
   * In browsers, this is only a suggested filename, not an actual filesystem path.
   */
  get sourcePath(): string | null {
    return this.#sourcePath;
  }

  /**
   * Replace the editor state entirely.
   *
   * Use this method when you need to set a completely new EditorState
   * (e.g., in tests or when loading a new document). For incremental
   * changes, prefer using transactions via `editor.dispatch()` or commands.
   *
   * **Important:** This method bypasses the transaction system entirely.
   * No transaction events will be emitted, no history entries will be created,
   * and plugins will not receive transaction metadata. Use `editor.dispatch()`
   * with transactions for changes that should be undoable or tracked.
   *
   * @param newState - The new EditorState to set
   *
   * @example
   * ```typescript
   * const newState = EditorState.create({
   *   schema: editor.schema,
   *   doc: newDoc,
   *   plugins: editor.state.plugins,
   * });
   * editor.setState(newState);
   * ```
   */
  setState(newState: EditorState): void {
    this._state = newState;
    if (this.view && !this.view.isDestroyed) {
      this.view.updateState(newState);
    }
  }

  /**
   * Get the editor storage.
   */
  get storage(): ExtensionStorage {
    return this.extensionStorage;
  }

  /**
   * Get object of registered commands.
   * @deprecated Editor commands will be removed in a future version. Use the Document API (`editor.doc`) instead.
   */
  get commands(): EditorCommands {
    return this.#commandService?.commands;
  }

  /**
   * Programmatic document API for querying and mutating the document.
   *
   * Lazily creates a {@link DocumentApi} backed by the editor's adapter graph.
   * The instance is cached for the current document session and
   * invalidated on {@link close} so a fresh adapter set is created on reopen.
   *
   * @throws {InvalidStateError} If the editor is not in `ready` or `saving` state.
   *
   * @example
   * ```ts
   * const result = editor.doc.find({ nodeType: 'paragraph' });
   *
   * // Fetch node info for the first match
   * const info = editor.doc.getNode(result.matches[0]);
   * ```
   */
  get doc(): DocumentApi {
    this.#assertState('ready', 'saving');
    if (!this.#documentApi) {
      this.#documentApi = createDocumentApi(getDocumentApiAdapters(this));
    }
    return this.#documentApi;
  }

  // -------------------------------------------------------------------
  // Selection bridge — tracked handles + snapshot convenience
  // -------------------------------------------------------------------

  /**
   * Infers the default capture surface for this editor instance.
   *
   * Body editors report `body`. Header/footer child editors created by the
   * pagination helpers persist their concrete surface kind in
   * `options.headerFooterType`, allowing direct calls on
   * `presentationEditor.getActiveEditor()` to produce handles with the
   * correct surface label without requiring every caller to pass it manually.
   */
  #getDefaultSelectionHandleSurface(): 'body' | 'header' | 'footer' {
    const explicitType = this.options.headerFooterType;
    return explicitType === 'header' || explicitType === 'footer' ? explicitType : 'body';
  }

  /**
   * Capture the live PM selection as a tracked handle.
   *
   * The handle's bookmark is automatically mapped through every subsequent
   * transaction, so it always reflects the current document. When ready,
   * call {@link resolveSelectionHandle} to get a fresh `ResolveRangeOutput`.
   *
   * Use this for deferred UI flows (AI, confirmation dialogs, async chains)
   * where a delay exists between selection capture and mutation.
   *
   * Local-only — captures from **this** editor's `state.selection`.
   */
  captureCurrentSelectionHandle(surface?: 'body' | 'header' | 'footer'): SelectionHandle {
    this.#assertState('ready', 'saving');
    const selection = selectCurrentPmSelection(this);
    return captureSelectionHandle(this, selection, surface ?? this.#getDefaultSelectionHandleSurface());
  }

  /**
   * Capture the "effective" selection as a tracked handle.
   *
   * Uses the same fallback chain as {@link getEffectiveSelectionRange}:
   * live non-collapsed → preserved → live. The resulting bookmark is then
   * mapped through every subsequent transaction.
   *
   * Local-only — captures from **this** editor.
   */
  captureEffectiveSelectionHandle(surface?: 'body' | 'header' | 'footer'): SelectionHandle {
    this.#assertState('ready', 'saving');
    const selection = selectEffectivePmSelection(this);
    return captureSelectionHandle(this, selection, surface ?? this.#getDefaultSelectionHandleSurface());
  }

  /**
   * Resolve a previously captured handle into a fresh `ResolveRangeOutput`.
   *
   * The handle's bookmark has been mapped through all intervening transactions
   * in the owning editor's plugin state, so the returned target reflects the
   * current document — no revision plumbing needed.
   *
   * The handle is always resolved against its owning editor (the one that
   * captured it), regardless of which editor is currently active. This
   * ensures correct behavior when header/footer sessions change.
   *
   * Returns `null` when:
   * - the handle was released
   * - a previously non-empty selection collapsed (content was deleted)
   *
   * Always release handles when done via {@link releaseSelectionHandle}.
   */
  resolveSelectionHandle(handle: SelectionHandle): ResolveRangeOutput | null {
    this.#assertState('ready', 'saving');
    const selection = resolveHandleToSelection(handle);
    if (!selection) return null;
    // Use the owning editor for range resolution, not `this`. The bookmark
    // positions are relative to the owner's document — interpreting them
    // against a different editor's doc would produce wrong results.
    return resolvePmSelectionToRange(handle._owner as Editor, selection);
  }

  /**
   * Release a tracked selection handle, removing it from plugin state.
   *
   * Always call this when the handle is no longer needed to avoid
   * unbounded accumulation of bookmarks.
   */
  releaseSelectionHandle(handle: SelectionHandle): void {
    this.#assertState('ready', 'saving');
    releaseSelectionHandle(handle);
  }

  /**
   * Snapshot convenience: resolve the live PM `state.selection` into a
   * canonical Document API range immediately.
   *
   * Equivalent to `captureCurrentSelectionHandle()` + `resolveSelectionHandle()`
   * in one call. Use this for immediate mutations where no delay exists
   * between reading the selection and acting on it.
   *
   * Local-only — always resolves against **this** editor.
   */
  getCurrentSelectionRange(): ResolveRangeOutput {
    this.#assertState('ready', 'saving');
    return resolveCurrentEditorSelectionRange(this);
  }

  /**
   * Snapshot convenience: resolve the "effective" selection into a
   * canonical Document API range immediately.
   *
   * Uses the same fallback chain as `captureEffectiveSelectionHandle`:
   * live non-collapsed → preserved → live.
   *
   * Local-only — always resolves against **this** editor.
   */
  getEffectiveSelectionRange(): ResolveRangeOutput {
    this.#assertState('ready', 'saving');
    return resolveEffectiveEditorSelectionRange(this);
  }

  /**
   * Get extension helpers.
   */
  get helpers(): EditorHelpers {
    return this.extensionService.helpers;
  }

  /**
   * Check if the editor is editable.
   */
  get isEditable(): boolean {
    return Boolean(this.options.editable && this.view && this.view.editable);
  }

  /**
   * Check if editor is destroyed.
   */
  get isDestroyed(): boolean {
    return Boolean(this.#isDestroyed || this.view?.isDestroyed);
  }

  /**
   * Get the editor element
   */
  get element(): HTMLElement | null {
    return this.options.element!;
  }

  /**
   * Get possible users of the editor.
   */
  get users(): User[] {
    return this.options.users!;
  }

  /**
   * Create a chain of commands to call multiple commands at once.
   * @deprecated Editor commands will be removed in a future version. Use the Document API (`editor.doc`) instead.
   */
  chain(): ChainableCommandObject {
    return this.#commandService.chain();
  }

  /**
   * Check if a command or a chain of commands can be executed. Without executing it.
   * @deprecated Editor commands will be removed in a future version. Use the Document API (`editor.doc`) instead.
   */
  can(): CanObject {
    return this.#commandService.can();
  }

  /**
   * Set the document mode
   * @param documentMode - The document mode ('editing', 'viewing', 'suggesting')
   * @param _caller - Calling context (unused)
   */
  setDocumentMode(documentMode: string, _caller?: string): void {
    if (this.options.isHeaderOrFooter || this.options.isChildEditor) return;

    let cleanedMode = documentMode?.toLowerCase() || 'editing';
    if (!this.extensionService || !this.state) return;

    const pm = this.view?.dom || this.options.element?.querySelector?.('.ProseMirror');

    if (this.options.role === 'viewer') cleanedMode = 'viewing';
    if (this.options.role === 'suggester' && cleanedMode === 'editing') cleanedMode = 'suggesting';

    // Viewing mode: Not editable, no tracked changes, no comments
    if (cleanedMode === 'viewing') {
      this.commands.toggleTrackChangesShowOriginal?.();
      const normalizedSelection = getViewModeSelectionWithoutStructuredContent(this.state);
      if (normalizedSelection) {
        this.view?.dispatch(this.state.tr.setSelection(normalizedSelection));
      }
      this.setEditable(false, false);
      this.setOptions({ documentMode: 'viewing' });
      if (pm) pm.classList.add('view-mode');
    }

    // Suggesting: Editable, tracked changes plugin enabled, comments
    else if (cleanedMode === 'suggesting') {
      this.commands.disableTrackChangesShowOriginal?.();
      this.commands.enableTrackChanges?.();
      this.setOptions({ documentMode: 'suggesting' });
      this.setEditable(true, false);
      if (pm) pm.classList.remove('view-mode');
    }

    // Editing: Editable, tracked changes plugin disabled, comments
    else if (cleanedMode === 'editing') {
      this.commands.disableTrackChangesShowOriginal?.();
      this.commands.disableTrackChanges?.();
      this.setEditable(true, false);
      this.setOptions({ documentMode: 'editing' });
      if (pm) pm.classList.remove('view-mode');
    }

    // Apply protection-aware editability override.
    // This may override the setEditable calls above when read-only protection
    // is enforced or when permission ranges allow editing in protected docs.
    applyEffectiveEditability(this);

    this.emit('documentModeChange', {
      editor: this,
      documentMode: cleanedMode as 'editing' | 'viewing' | 'suggesting',
    });
  }

  /**
   * Blur the editor.
   */
  blur(): void {
    this.view?.dom?.blur();
  }

  /**
   * Check if editor has focus
   */
  hasFocus(): boolean {
    if (this.view) {
      return this.view.hasFocus();
    }
    return false;
  }

  /**
   * Get viewport coordinates for a document position.
   * In presentation mode the ProseMirror view is hidden off-screen, so we
   * delegate to PresentationEditor which uses visual layout coordinates.
   */
  coordsAtPos(pos: number): ReturnType<PmEditorView['coordsAtPos']> | null {
    if (this.presentationEditor) {
      return this.presentationEditor.coordsAtPos(pos);
    }

    if (this.view) {
      return this.view.coordsAtPos(pos);
    }

    return null;
  }

  /**
   * Get the DOM element for a document position.
   * In presentation mode, returns the painted element.
   */
  getElementAtPos(
    pos: number,
    options: { forceRebuild?: boolean; fallbackToCoords?: boolean } = {},
  ): HTMLElement | null {
    if (this.presentationEditor) {
      return this.presentationEditor.getElementAtPos(pos, options);
    }

    if (!this.view) return null;
    if (!Number.isFinite(pos)) return null;

    const maxPos = this.view.state.doc.content.size;
    const clampedPos = Math.max(0, Math.min(pos, maxPos));

    try {
      const { node } = this.view.domAtPos(clampedPos);
      if (node && node.nodeType === 1) {
        return node as HTMLElement;
      }
      if (node && node.nodeType === 3) {
        return node.parentElement;
      }
      return node?.parentElement ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get position from client-space coordinates.
   * In layout/presentation mode, uses PresentationEditor hit testing for accurate coordinate mapping.
   * Falls back to ProseMirror view for standard editing mode.
   */
  posAtCoords(coords: Parameters<PmEditorView['posAtCoords']>[0]): ReturnType<PmEditorView['posAtCoords']> {
    // In presentation/layout mode, use the layout engine's hit testing
    // which properly converts visible surface coordinates to document positions
    if (typeof this.presentationEditor?.hitTest === 'function') {
      // Extract coordinates from various possible coordinate formats
      const coordsObj = coords as {
        clientX?: number;
        clientY?: number;
        left?: number;
        top?: number;
        x?: number;
        y?: number;
      };
      const clientX = coordsObj?.clientX ?? coordsObj?.left ?? coordsObj?.x ?? null;
      const clientY = coordsObj?.clientY ?? coordsObj?.top ?? coordsObj?.y ?? null;
      if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
        const hit = this.presentationEditor.hitTest(clientX as number, clientY as number);
        if (hit) {
          return {
            pos: hit.pos,
            inside: hit.pos,
          };
        }
      }
    }

    // Fall back to ProseMirror view for standard editing mode
    if (this.view) {
      return this.view.posAtCoords(coords);
    }

    return null;
  }

  #registerCopyHandler(): void {
    this.#renderer?.registerCopyHandler?.(this);
  }

  /**
   * Export the yjs binary from the current state.
   */
  async generateCollaborationUpdate(): Promise<Uint8Array> {
    return await generateCollaborationData(this);
  }

  /**
   * Initialize data for collaborative editing
   * If we are replacing data and have a valid provider, wait for provider sync
   * before inserting data into the shared Yjs document.
   */
  initializeCollaborationData(): void {
    if (!this.options.isNewFile || !this.options.collaborationProvider) return;
    onCollaborationProviderSynced(this.options.collaborationProvider, () => {
      this.#insertNewFileData();
    });
  }

  /**
   * Replace content of editor that was created with loadFromSchema option
   * Used to replace content of other header/footer when one of it was edited
   *
   * @param content - new editor content json (retrieved from editor.getUpdatedJson)
   */
  replaceContent(content: ProseMirrorJSON): void {
    this.setOptions({
      content: content as unknown as Record<string, unknown>,
    });

    this.#createConverter();
    this.initDefaultStyles();

    this.#createConverter();
    initPartsRuntime(this);
    this.#initMedia();

    const doc = this.#generatePmData();
    const tr = this.state.tr.replaceWith(0, this.state.doc.content.size, doc);
    tr.setMeta('replaceContent', true);
    this.#dispatchTransaction(tr);
  }

  /**
   * Sync root-level document attrs without mutating the first top-level node.
   */
  #syncDocumentAttrs(nextAttrs: Record<string, unknown> = {}): void {
    const currentAttrs = (this.state.doc?.attrs ?? {}) as Record<string, unknown>;
    const docAttrSpecs = (this.schema?.topNodeType?.spec?.attrs ?? {}) as Record<string, { default?: unknown }>;
    const attrKeys = new Set([...Object.keys(docAttrSpecs), ...Object.keys(currentAttrs), ...Object.keys(nextAttrs)]);

    if (attrKeys.size === 0) return;

    const valuesMatch = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

    const tr = this.state.tr.setMeta('addToHistory', false);
    let changed = false;

    for (const key of attrKeys) {
      const hasNextValue = Object.prototype.hasOwnProperty.call(nextAttrs, key);
      const nextValue = hasNextValue ? nextAttrs[key] : docAttrSpecs[key]?.default;

      if (valuesMatch(currentAttrs[key], nextValue)) {
        continue;
      }

      tr.setDocAttribute(key, nextValue);
      changed = true;
    }

    if (changed) {
      this.#dispatchTransaction(tr);
    }
  }

  /**
   * Replace the current document with new data. Necessary for initializing a new collaboration file,
   * since we need to insert the data only after the provider has synced.
   */
  #insertNewFileData(): void {
    if (!this.options.isNewFile) return;
    this.options.isNewFile = false;
    const doc = this.#generatePmData();
    const nextBodySectPr = JSON.parse(JSON.stringify(doc.attrs?.bodySectPr ?? null));
    // hiding this transaction from history so it doesn't appear in undo stack
    const tr = this.state.tr.replaceWith(0, this.state.doc.content.size, doc).setMeta('addToHistory', false);
    this.#dispatchTransaction(tr);

    const ydoc = this.options.ydoc as YDoc | null;
    if (ydoc) {
      ydoc.getMap('meta').set('bodySectPr', nextBodySectPr);
    }

    this.#syncDocumentAttrs((doc.attrs ?? {}) as Record<string, unknown>);

    setTimeout(() => {
      this.#initComments();
    }, 50);
  }

  /**
   * Set editor options and update state.
   */
  setOptions(options: Partial<EditorOptions> = {}): void {
    const previousOptions = this.options ?? {};
    const nextOptions = {
      ...previousOptions,
      ...options,
    };

    // Preserve non-enumerable option metadata (for example the story editor's
    // `parentEditor` getter) across option updates. Plain object spreading drops
    // those descriptors, which breaks commit routing for child/story editors.
    const previousDescriptors = Object.getOwnPropertyDescriptors(previousOptions);
    for (const [key, descriptor] of Object.entries(previousDescriptors)) {
      if (descriptor.enumerable) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        continue;
      }
      Object.defineProperty(nextOptions, key, descriptor);
    }

    this.options = nextOptions;

    if ((this.options.isNewFile || !this.options.ydoc) && this.options.isCommentsEnabled) {
      this.options.shouldLoadComments = true;
    }

    if (!this.view || !this.state || this.isDestroyed) {
      return;
    }

    if (this.options.editorProps) {
      this.view.setProps(this.options.editorProps);
    }

    this.view.updateState(this.state);
  }

  /**
   * Set whether the editor is editable.
   *
   * When setting to non-editable, this method:
   * - Forces ProseMirror to re-evaluate the editable prop from the Editable plugin
   * - Blurs the editor to remove the cursor
   *
   * @param editable - Whether the editor should accept user input (default: true)
   * @param emitUpdate - Whether to emit an update event after changing editability (default: true)
   */
  setEditable(editable: boolean = true, emitUpdate: boolean = true): void {
    this.setOptions({ editable });

    // Force ProseMirror to re-evaluate the editable prop from the Editable plugin.
    // ProseMirror only updates the editable state when setProps is called,
    // even if the underlying editor.options.editable value has changed.
    if (this.view) {
      this.view.setProps({});

      // When setting to non-editable, blur the editor to remove cursor
      if (!editable && this.view.dom) {
        this.view.dom.blur();
      }
    }

    if (emitUpdate && this.state) {
      this.emit('update', { editor: this, transaction: this.state.tr });
    }
  }

  /**
   * Register PM plugin.
   *
   * `PluginState` is a call-site generic so the incoming plugin's
   * state shape is preserved into the `handlePlugins` callback's
   * `plugin` argument. The existing plugin list is heterogeneous
   * (each entry can have a different state type) so it stays as
   * `Plugin<unknown>[]` instead of being inferred under one specific
   * state. Default `PluginState = unknown` removes the previous
   * implicit `Plugin<any>` SD-3213 supported-root finding.
   *
   * @param plugin PM plugin.
   * @param handlePlugins Optional function for handling plugin merge.
   */
  registerPlugin<PluginState = unknown>(
    plugin: Plugin<PluginState>,
    handlePlugins?: (plugin: Plugin<PluginState>, plugins: Plugin<unknown>[]) => Plugin<unknown>[],
  ): void {
    if (this.isDestroyed) return;
    if (!this.state?.plugins) return;
    const plugins =
      typeof handlePlugins === 'function'
        ? handlePlugins(plugin, [...this.state.plugins])
        : [...this.state.plugins, plugin];

    this._state = this.state.reconfigure({ plugins });
    this.view?.updateState(this._state);
  }

  /**
   * Safely resolve the plugin key string for a plugin instance.
   */
  #getPluginKeyName(plugin: Plugin): string {
    const pluginKey = (plugin as Plugin & { key?: { key: string } }).key;
    return typeof pluginKey?.key === 'string' ? pluginKey.key : '';
  }

  /**
   * Unregister a PM plugin
   */
  unregisterPlugin(nameOrPluginKey: string | { key?: string }): void {
    if (this.isDestroyed) return;

    const name =
      typeof nameOrPluginKey === 'string'
        ? `${nameOrPluginKey}$`
        : ((nameOrPluginKey?.key as string | undefined) ?? '');

    this._state = this.state.reconfigure({
      plugins: this.state.plugins.filter((plugin) => !this.#getPluginKeyName(plugin).startsWith(name)),
    });

    this.view?.updateState(this._state);
  }

  /**
   * Late-attach collaboration to a running editor instance.
   *
   * Updates editor options so the Collaboration, CollaborationCursor, and
   * History extensions produce their collaborative plugins on the next
   * `extensionService.plugins` access, then reconfigures the PM state in place.
   *
   * Prerequisites:
   * - The ydoc must already be seeded with this editor's current state
   * - The provider must already be synced
   * - Editor must be mounted (not headless, not destroyed)
   *
   * @param options.ydoc  The Y.Doc to bind
   * @param options.collaborationProvider  The synced collaboration provider
   */
  attachCollaboration({
    ydoc,
    collaborationProvider,
  }: {
    ydoc: YDoc;
    collaborationProvider: NonNullable<EditorOptions['collaborationProvider']>;
  }): void {
    if (this.isDestroyed) {
      throw new Error('[super-editor] Cannot attach collaboration to a destroyed editor');
    }
    if (this.options.ydoc) {
      throw new Error('[super-editor] Editor already has collaboration attached');
    }
    if (this.options.isHeadless) {
      throw new Error('[super-editor] attachCollaboration is not supported in headless mode');
    }

    // Snapshot mutable state so we can restore on failure.
    const prevProvider = this.options.collaborationProvider;
    const prevShouldLoadComments = this.options.shouldLoadComments;
    const prevCollaborationIsReady = this.options.collaborationIsReady;
    const prevState = this._state;

    const rollback = () => {
      cleanupCollaborationSideEffects(this);
      this.options.ydoc = undefined;
      this.options.collaborationProvider = prevProvider;
      this.options.shouldLoadComments = prevShouldLoadComments;
      this.options.collaborationIsReady = prevCollaborationIsReady;
      this._state = prevState;
      this.view?.updateState(prevState);
    };

    // 1. Update options so extensions see ydoc/provider on next plugin generation.
    this.options.ydoc = ydoc;
    this.options.collaborationProvider = collaborationProvider;

    // 2. Suppress DOCX comment re-import on collaborationReady.
    //    In local mode shouldLoadComments was set to true (see setOptions()).
    //    Without this, #onCollaborationReady → #initComments() would re-emit
    //    commentsLoaded from DOCX data, duplicating the Yjs comment hydration
    //    that initCollaborationComments() performs at the SuperDoc layer.
    this.options.shouldLoadComments = false;

    // 3. Regenerate all plugins and reconfigure PM state.
    //    Side effects (Y.js observers, part-sync, initSyncListener) run during
    //    the extensionService.plugins getter. On failure, rollback cleans them up.
    let plugins: Plugin[];
    try {
      plugins = [...this.extensionService.plugins];
    } catch (err) {
      rollback();
      throw err;
    }

    // 4. Reconfigure state with the new plugin set. ProseMirror diffs old vs new.
    //    Since the ydoc was seeded from this editor's state, doc content is identical
    //    → no content DOM mutations. Selection is preserved by reconfigure().
    try {
      this._state = this.state.reconfigure({ plugins });
      this.view?.updateState(this._state);
    } catch (err) {
      rollback();
      throw err;
    }
  }

  /**
   * Creates extension service.
   */
  #createExtensionService(): void {
    const allowedExtensions = ['extension', 'node', 'mark'];

    const coreExtensions = [
      Editable,
      Commands,
      EditorFocus,
      Keymap,
      PositionTrackerExtension,
      SelectionHandleExtension,
    ];
    const externalExtensions = this.options.externalExtensions || [];

    const allExtensions = [...coreExtensions, ...this.options.extensions!]
      .filter((extension) => {
        const extensionType = typeof extension?.type === 'string' ? extension.type : undefined;
        return extensionType ? allowedExtensions.includes(extensionType) : false;
      })
      .map((extension) => cloneExtensionInstance(extension));

    const isolatedExternalExtensions = externalExtensions.map((extension) => cloneExtensionInstance(extension));

    // SD-3240: ExtensionService.d.ts uses a `[key: string]: any` catchall
    // for internal-implementation members. The runtime instance has the
    // surface members; the cast bridges the structural gap without
    // reintroducing `any` on the public field type.
    this.extensionService = ExtensionService.create(
      allExtensions,
      isolatedExternalExtensions,
      this,
    ) as unknown as EditorExtensionServiceSurface;
  }

  /**
   * Creates a command service.
   */
  #createCommandService(): void {
    this.#commandService = CommandService.create({
      editor: this,
    });
  }

  /**
   * Create the document converter as this.converter.
   */
  #createConverter(): void {
    // SD-3240: SuperConverter.d.ts uses a `[key: string]: any` catchall
    // for internal-implementation members. The runtime instance has the
    // surface members; the cast bridges the structural gap without
    // reintroducing `any` on the public field type.
    if (this.options.converter) {
      this.converter = this.options.converter as unknown as EditorConverterSurface;
    } else {
      this.converter = new SuperConverter({
        docx: this.options.content,
        media: this.options.mediaFiles,
        fonts: this.options.fonts,
        debug: true,
        fileSource: this.options.fileSource,
        documentId: this.options.documentId,
        mockWindow: this.options.mockWindow ?? null,
        mockDocument: this.options.mockDocument ?? null,
        isNewFile: this.options.isNewFile ?? false,
        trackedChangesOptions: this.options.trackedChanges ?? null,
      }) as unknown as EditorConverterSurface;
    }
  }

  async #loadBlankDocxTemplate(): Promise<{
    content: DocxFileEntry[];
    mediaFiles: Record<string, unknown>;
    fonts: Record<string, unknown>;
    fileSource: File | Blob | Buffer;
  }> {
    const arrayBuffer = await getArrayBufferFromUrl(BLANK_DOCX_DATA_URI);
    const isNodeRuntime = typeof process !== 'undefined' && !!process.versions?.node;
    const canUseBuffer = isNodeRuntime && typeof Buffer !== 'undefined';
    const uint8Array = new Uint8Array(arrayBuffer);

    let fileSource: File | Blob | Buffer;
    if (canUseBuffer) {
      fileSource = Buffer.from(uint8Array);
    } else if (typeof Blob !== 'undefined') {
      fileSource = new Blob([uint8Array as BlobPart]);
    } else {
      throw new Error('Blob is not available to create blank DOCX');
    }

    const [content, _media, mediaFiles, fonts] = (await Editor.loadXmlData(fileSource, canUseBuffer))!;
    return { content, mediaFiles, fonts, fileSource };
  }

  async #getBaseDocxEntriesForExport(): Promise<DocxFileEntry[]> {
    if (Array.isArray(this.options.content)) {
      return this.options.content as DocxFileEntry[];
    }

    const blankDocx = await this.#loadBlankDocxTemplate();
    this.options.content = blankDocx.content;
    this.options.mediaFiles = {
      ...blankDocx.mediaFiles,
      ...(this.options.mediaFiles ?? {}),
    };
    this.options.fonts = {
      ...blankDocx.fonts,
      ...(this.options.fonts ?? {}),
    };

    return blankDocx.content;
  }

  /**
   * Initialize media.
   */
  #initMedia(): void {
    if (this.options.isChildEditor) return;
    if (!this.options.ydoc) {
      (this.storage.image as ImageStorage).media = this.options.mediaFiles!;
      return;
    }

    const mediaMap = (this.options.ydoc as { getMap: (name: string) => Map<string, unknown> }).getMap('media');

    // We are creating a new file and need to set the media
    if (this.options.isNewFile) {
      Object.entries(this.options.mediaFiles!).forEach(([key, value]) => {
        mediaMap.set(key, value);
      });

      // Set the storage to the imported media files
      (this.storage.image as ImageStorage).media = this.options.mediaFiles!;
    }

    // If we are opening an existing file, we need to get the media from the ydoc
    else {
      (this.storage.image as ImageStorage).media = Object.fromEntries(mediaMap.entries());
    }
  }

  /**
   * Initialize fonts
   */
  #initFonts(): void {
    this.#renderer?.initFonts?.(this);
  }

  /**
   * Determines the fonts used in the document and the unsupported ones and triggers the `onFontsResolved` callback.
   */
  async #checkFonts(): Promise<void> {
    // We only want to run the algorithm to resolve the fonts if the user has asked for it
    if (!this.options.onFontsResolved || typeof this.options.onFontsResolved !== 'function') {
      return;
    }

    if (this.options.isHeadless) {
      return;
    }

    try {
      const fontsUsedInDocument = this.converter.getDocumentFonts();
      const unsupportedFonts = this.#determineUnsupportedFonts(fontsUsedInDocument);

      const payload: FontsResolvedPayload = {
        documentFonts: fontsUsedInDocument,
        unsupportedFonts,
      };

      this.emit('fonts-resolved', payload);
    } catch {
      console.warn('[SuperDoc] Could not determine document fonts and unsupported fonts');
    }
  }

  /**
   * Determines which fonts used in the document are not supported
   * by attempting to render them on a canvas.
   * Fonts are considered unsupported if they cannot be rendered
   * and are not already imported in the document via @font-face.
   *
   * @param fonts - Array of font family names used in the document.
   * @returns Array of unsupported font family names.
   */
  #determineUnsupportedFonts(fonts: string[]): string[] {
    const unsupportedFonts = fonts.filter((font) => {
      const canRender = canRenderFont(font);
      const isFontImported = this.fontsImported.includes(font);

      return !canRender && !isFontImported;
    });

    return unsupportedFonts;
  }

  /**
   * Load the data from DOCX to be used in the schema.
   * Expects a DOCX file.
   * @param fileSource - The DOCX file to load (File/Blob in browser, Buffer in Node.js)
   * @param isNode - Whether the method is being called in a Node.js environment
   * @returns A promise that resolves to an array containing:
   *   - [0] xmlFiles - Array of XML files extracted from the DOCX
   *   - [1] mediaFiles - Object containing media files with URLs (browser only)
   *   - [2] mediaFiles - Object containing media files with base64 data
   *   - [3] fonts - Object containing font files from the DOCX
   */
  static async loadXmlData(
    fileSource: File | Blob | Buffer | ArrayBuffer,
    isNode?: boolean,
    options?: { password?: string },
  ): Promise<
    [DocxFileEntry[], Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Uint8Array | null]
  >;
  static async loadXmlData(
    fileSource: File | Blob | Buffer | ArrayBuffer | null | undefined,
    isNode?: boolean,
    options?: { password?: string },
  ): Promise<
    | [DocxFileEntry[], Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Uint8Array | null]
    | undefined
  >;
  static async loadXmlData(
    fileSource: File | Blob | Buffer | ArrayBuffer | null | undefined,
    isNode: boolean = false,
    options?: { password?: string },
  ): Promise<
    | [DocxFileEntry[], Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Uint8Array | null]
    | undefined
  > {
    if (!fileSource) return;

    const zipper = new DocxZipper();
    const xmlFiles = await zipper.getDocxData(fileSource, isNode, {
      password: options?.password,
    });
    const mediaFiles = zipper.media;

    // Return decrypted file data (if any) so callers can store the decrypted
    // bytes instead of the original encrypted source for later export.
    return [xmlFiles, mediaFiles, zipper.mediaFiles, zipper.fonts, zipper.decryptedFileData];
  }

  /**
   * Get the document version
   */
  static getDocumentVersion(doc: DocxFileEntry[]): string {
    return SuperConverter.getStoredSuperdocVersion(doc);
  }

  /**
   * Set the document version
   */
  static setDocumentVersion(doc: DocxFileEntry[], version: string): string {
    const result = SuperConverter.setStoredSuperdocVersion(doc, version);
    if (typeof result === 'string') {
      return result;
    }
    return version;
  }

  /**
   * Get the document GUID
   */
  static getDocumentGuid(doc: DocxFileEntry[]): string | null {
    return SuperConverter.extractDocumentGuid(doc);
  }

  /**
   * @deprecated use setDocumentVersion instead
   */
  static updateDocumentVersion(doc: DocxFileEntry[], version: string): string {
    console.warn('updateDocumentVersion is deprecated, use setDocumentVersion instead');
    return Editor.setDocumentVersion(doc, version);
  }

  /**
   * Generates a schema summary for the current runtime schema.
   */
  async getSchemaSummaryJSON(): Promise<SchemaSummaryJSON> {
    if (!this.schema) {
      throw new Error('Schema is not initialized.');
    }

    const schemaVersion = this.converter?.getSuperdocVersion?.() || 'current';

    const suppressedNames = new Set(
      (this.extensionService?.extensions || [])
        .filter((ext) => {
          // SD-3240: extension entries are typed but `excludeFromSummaryJSON`
          // is a runtime opt-in on the config record (Options/Storage generics
          // hide it). Cast at the read site to access the optional flag.
          const config = (ext as { config?: { excludeFromSummaryJSON?: boolean } })?.config;
          const suppressFlag = config?.excludeFromSummaryJSON;
          return Boolean(suppressFlag);
        })
        .map((ext: { name: string }) => ext.name),
    );

    const summary = buildSchemaSummary(this.schema, schemaVersion);

    if (!suppressedNames.size) {
      return summary;
    }

    return {
      ...summary,
      nodes: summary.nodes.filter((node) => !suppressedNames.has(node.name)),
      marks: summary.marks.filter((mark) => !suppressedNames.has(mark.name)),
    };
  }

  /**
   * Validates a ProseMirror JSON document against the current schema.
   */
  validateJSON(doc: ProseMirrorJSON | ProseMirrorJSON[]): PmNode | PmNode[] {
    if (!this.schema) {
      throw new Error('Schema is not initialized.');
    }

    try {
      if (Array.isArray(doc)) return doc.map((d) => this.schema!.nodeFromJSON(d));
      return this.schema.nodeFromJSON(doc as ProseMirrorJSON);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const validationError = new Error(`Invalid document for current schema: ${detail}`);
      if (error instanceof Error) {
        (validationError as Error & { cause?: Error }).cause = error;
      }
      throw validationError;
    }
  }

  /**
   * Creates document PM schema.
   */
  #createSchema(): void {
    this.schema = this.extensionService.schema;
  }

  /**
   * Generate ProseMirror data from file
   */
  #generatePmData(): PmNode {
    let doc: PmNode;

    try {
      const { mode, content, fragment, loadFromSchema } = this.options;
      const domDocument = this.#getDomDocument();
      const hasJsonContent = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value);

      if (mode === 'docx') {
        if (loadFromSchema && hasJsonContent(content)) {
          doc = this.schema.nodeFromJSON(content);
          doc = this.#prepareDocumentForImport(doc);
        } else {
          doc = createDocument(this.converter, this.schema, this);
          // Perform any additional document processing prior to finalizing the doc here
          doc = this.#prepareDocumentForImport(doc);

          // Check for markdown BEFORE html (since markdown gets converted to HTML)
          if (this.options.markdown) {
            doc = createDocFromMarkdown(this.options.markdown, this, {
              isImport: true,
              document: domDocument,
              onUnsupportedContent: this.options.onUnsupportedContent,
              warnOnUnsupportedContent: this.options.warnOnUnsupportedContent,
            });
          }
          // If we have a new doc, and have html data, we initialize from html
          else if (this.options.html)
            doc = createDocFromHTML(this.options.html, this, {
              isImport: true,
              document: domDocument,
              onUnsupportedContent: this.options.onUnsupportedContent,
              warnOnUnsupportedContent: this.options.warnOnUnsupportedContent,
            });
          else if (this.options.jsonOverride) doc = this.schema.nodeFromJSON(this.options.jsonOverride);

          if (fragment) {
            normalizeYjsFragmentForSchema(fragment);
            doc = yXmlFragmentToProseMirrorRootNode(fragment, this.schema);
          }
        }
      }

      // If we are in HTML mode, we initialize from either content or html (or blank)
      else if (mode === 'text' || mode === 'html') {
        if (loadFromSchema && hasJsonContent(content)) doc = this.schema.nodeFromJSON(content);
        else if (typeof content === 'string')
          doc = createDocFromHTML(content, this, {
            document: domDocument,
            onUnsupportedContent: this.options.onUnsupportedContent,
            warnOnUnsupportedContent: this.options.warnOnUnsupportedContent,
          });
        else doc = this.schema.topNodeType.createAndFill()!;
      }
    } catch (err) {
      console.error(err);
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('contentError', { editor: this, error });
    }

    return doc!;
  }

  /**
   * Create the PM editor view
   */
  #createInitialState({ includePlugins = false }: { includePlugins?: boolean } = {}): void {
    if (this._state) return;

    const doc = this.#generatePmData();

    // Only initialize the doc if we are not using Yjs/collaboration.
    const config: { schema: Schema; doc?: PmNode } = { schema: this.schema };
    if (!this.options.ydoc) config.doc = doc;

    let initialState = PmEditorState.create(config);

    if (includePlugins) {
      initialState = initialState.reconfigure({
        plugins: [...this.extensionService.plugins],
      });
    }

    this.options.initialState = initialState;
    this._state = initialState;
  }

  #configureStateWithExtensionPlugins(): void {
    const configuredState = this.state.reconfigure({
      plugins: [...this.extensionService.plugins],
    });

    this._state = configuredState;
    this.view?.updateState(configuredState);
  }

  /**
   * Create the PM editor view
   */
  #createView(element: HTMLElement | null): void {
    if (!this._state) {
      this.#createInitialState();
    }

    if (!this.#renderer) {
      if (!canUseDOM()) {
        throw new Error('[super-editor] Cannot create an editor view without a renderer.');
      }
      this.#renderer = new ProseMirrorRenderer();
    }

    this.view = this.#renderer.attach({
      element,
      editorProps: this.options.editorProps,
      dispatchTransaction: this.#dispatchTransaction.bind(this),
      state: this.state,
      handleClick: this.#handleNodeSelection.bind(this),
    });

    // SD-2368: flush deferred composition tracking once the IME commits.
    // blur covers compositions abandoned without a compositionend.
    this.view?.dom?.addEventListener('compositionend', this.#handleDomCompositionEnd);
    this.view?.dom?.addEventListener('blur', this.#handleDomCompositionEnd);

    this.createNodeViews();
  }

  /**
   * Creates all node views.
   */
  createNodeViews(): void {
    if (this.options.skipViewCreation || typeof this.view?.setProps !== 'function') {
      return;
    }
    this.view.setProps({
      nodeViews: this.extensionService.nodeViews,
    });
  }

  /**
   * Get the maximum content size based on page dimensions and margins.
   *
   * When the cursor is inside a table cell, the max width is constrained to that
   * cell's width (derived from `colwidth` minus cell margins) so that newly inserted
   * images are never wider than their containing cell.
   *
   * @returns Size object with width and height in pixels, or empty object if no page size.
   * @note In web layout mode, returns empty object to skip content constraints unless
   *       the cursor is inside a table cell, in which case the cell width is returned.
   */
  getMaxContentSize(): { width?: number; height?: number } {
    const localPageStyles = this.converter?.pageStyles;
    const parentPageStyles = this.options.parentEditor?.converter?.pageStyles;
    const localPageSize = localPageStyles?.pageSize;
    const pageStyles =
      localPageSize?.width && localPageSize?.height ? localPageStyles : (parentPageStyles ?? localPageStyles);
    if (!pageStyles) return {};

    // When the cursor is inside a table cell, constrain width to the cell's content
    // width so images inserted into a cell are never wider than that cell.
    // This applies to both print and web layout modes.
    let cellConstraintWidth = 0;
    const { $head } = this.state.selection;
    for (let d = $head.depth; d > 0; d--) {
      const node = $head.node(d);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        cellConstraintWidth = getCellContentWidthPx(node);
        break;
      }
    }

    // In web layout mode there are no page dimensions. Return cell width constraint
    // if inside a table cell, otherwise skip constraints entirely (CSS handles display).
    if (this.isWebLayout()) {
      if (cellConstraintWidth > 0) {
        // Infinity lets getAllowedImageDimensions() skip the height check while
        // still applying the width constraint (web layout has no page height).
        return { width: cellConstraintWidth, height: Infinity };
      }
      return {};
    }

    const { pageSize = {}, pageMargins = {} } = pageStyles;
    const { width, height } = pageSize;

    if (!width || !height) return {};

    // Print layout mode: use document margins (inches converted to pixels)
    const getMarginPx = (side: 'top' | 'bottom' | 'left' | 'right'): number => {
      return (pageMargins?.[side] ?? 0) * PIXELS_PER_INCH;
    };

    const topPx = getMarginPx('top');
    const bottomPx = getMarginPx('bottom');
    const leftPx = getMarginPx('left');
    const rightPx = getMarginPx('right');

    // All sizes are in inches so we multiply by PIXELS_PER_INCH to get pixels
    const maxHeight = height * PIXELS_PER_INCH - topPx - bottomPx - MAX_HEIGHT_BUFFER_PX;
    const maxWidth = width * PIXELS_PER_INCH - leftPx - rightPx - MAX_WIDTH_BUFFER_PX;

    if (cellConstraintWidth > 0) {
      return { width: cellConstraintWidth, height: maxHeight };
    }

    return {
      width: maxWidth,
      height: maxHeight,
    };
  }

  /**
   * Attach styles and attributes to the editor element
   */
  updateEditorStyles(element: HTMLElement, proseMirror: HTMLElement): void {
    this.#renderer?.updateEditorStyles?.(this, element, proseMirror);
  }

  /**
   * Initialize default styles for the editor container and ProseMirror.
   * Get page size and margins from the converter.
   * Set document default font and font size.
   *
   * @param element - The DOM element to apply styles to
   */
  initDefaultStyles(element: HTMLElement | null = this.element): void {
    if (this.options.isHeadless || this.options.suppressDefaultDocxStyles) return;
    this.#renderer?.initDefaultStyles?.(this, element);
  }

  /**
   * Initializes responsive styles for mobile devices.
   * Sets up scaling based on viewport width and handles orientation changes.
   */
  initMobileStyles(element: HTMLElement | null): void {
    this.#renderer?.initMobileStyles?.(this, element);
  }

  /**
   * Handler called when collaboration is ready.
   * Initializes comments if not a new file.
   */
  #onCollaborationReady({ editor, ydoc }: { editor: Editor; ydoc: unknown }): void {
    if (this.options.collaborationIsReady) return;

    // Collaboration callbacks can arrive after close()/unload. In that state
    // the converter and editor state are intentionally cleared, so there is
    // nothing valid to initialize.
    if (this.isDestroyed || !this.converter || !this.state) return;

    console.debug('🔗 [super-editor] Collaboration ready');

    this.#validateDocumentInit();

    if (this.options.ydoc) {
      this.migrateListsToV2();
    }

    this.options.onCollaborationReady!({ editor, ydoc });
    this.options.collaborationIsReady = true;
    this.options.initialState = this.state;

    const { tr } = this.state;
    tr.setMeta('collaborationReady', true);
    this.#dispatchTransaction(tr);

    if (!this.options.isNewFile) {
      this.#initComments();
    }
  }

  /**
   * Initialize comments plugin
   */
  #initComments(): void {
    if (!this.options.isCommentsEnabled) return;
    if (!this.options.shouldLoadComments) return;
    if (!this.converter) return;
    const replacedFile = this.options.replacedFile;
    this.emit('commentsLoaded', {
      editor: this,
      replacedFile,
      comments: this.converter.comments || [],
    });

    // Reset replacedFile synchronously in both headless and mounted paths
    // to ensure consistent behavior for consumers reading this flag after commentsLoaded.
    this.options.replacedFile = false;

    // In headless mode we support comment data (for export and server-side workflows),
    // but skip comment UI behaviors that rely on a mounted view.
    if (this.options.isHeadless) {
      return;
    }

    // Force comment plugin update after a short delay to allow DOM to settle.
    setTimeout(() => {
      const st = this.state;
      if (!st) return;
      const tr = st.tr.setMeta(CommentsPluginKey, { type: 'force' });
      this.#dispatchTransaction(tr);
    }, 50);
  }

  /**
   * Dispatch a transaction to update the editor state
   */
  /**
   * SD-2368: doc range inserted by the in-flight IME composition while
   * tracked-transaction rewriting is deferred. Mapped through every applied
   * transaction; converted into a tracked insert by
   * {@link #flushDeferredCompositionTracking} after compositionend.
   */
  #deferredCompositionRange: { from: number; to: number } | null = null;
  #deferredCompositionDeletions: Array<{ pos: number; slice: PmSlice }> = [];
  /**
   * `composition` meta of the most recent deferred composition transaction
   * (prosemirror-view's composition id). Re-stamped onto the flush transaction
   * so prosemirror-history groups it with the composed text into one undo
   * event — the flush's mark-only steps have empty step maps, so without the
   * shared id the adjacency check fails and the flush becomes its own undo
   * step (first undo would strip suggestion marks but keep the text).
   */
  #deferredCompositionId: unknown = undefined;

  /**
   * Whether tracked-transaction rewriting of this composition transaction can
   * be deferred until compositionend. Rewriting preedit updates immediately
   * wraps the composing DOM text node in mark spans and decoration elements,
   * which kills the native composition on every keystroke (SD-2368).
   *
   * Deletions outside the already-composed range are deferred only when the
   * deleted content can be restored as a tracked deletion at compositionend.
   */
  #canDeferCompositionTracking(tr: Transaction, state: EditorState): boolean {
    if (!tr.steps.length) return false;
    const range = this.#deferredCompositionRange;
    for (let index = 0; index < tr.steps.length; index += 1) {
      const step = tr.steps[index];
      if (!(step instanceof ReplaceStep)) return false;
      if (step.from < step.to && (!range || step.from < range.from || step.to > range.to)) {
        const sourceDoc = tr.docs[index] ?? state.doc;
        if (!this.#canRestoreDeferredCompositionDeletion(step, sourceDoc)) return false;
      }
    }
    return true;
  }

  #canRestoreDeferredCompositionDeletion(step: ReplaceStep, doc: PmNode): boolean {
    if (step.slice.size === 0) return false;

    let hasText = false;
    let hasUnsupportedContent = false;
    doc.nodesBetween(step.from, step.to, (node) => {
      if (hasUnsupportedContent) return false;
      if (node.type.name.includes('table') || (node.isLeaf && !node.isText)) {
        hasUnsupportedContent = true;
        return false;
      }
      if (node.isText && node.text) {
        hasText = true;
      }
      return true;
    });

    return hasText && !hasUnsupportedContent;
  }

  #collectDeferredCompositionDeletions(tr: Transaction): Array<{ pos: number; slice: PmSlice }> {
    const deletions: Array<{ pos: number; slice: PmSlice }> = [];
    const range = this.#deferredCompositionRange;
    tr.steps.forEach((step, index) => {
      if (!(step instanceof ReplaceStep) || step.from >= step.to) return;
      if (range && step.from >= range.from && step.to <= range.to) return;
      const sourceDoc = tr.docs[index] ?? this.state.doc;
      if (!this.#canRestoreDeferredCompositionDeletion(step, sourceDoc)) return;
      const rest = tr.mapping.slice(index + 1);
      deletions.push({
        pos: rest.map(step.from + step.slice.size, 1),
        slice: sourceDoc.slice(step.from, step.to),
      });
    });
    return deletions;
  }

  /**
   * True when every step replaces content strictly inside the deferred
   * composition range. Such transactions rewrite this user's raw, not-yet-
   * tracked composed text, so they are part of the composition even when they
   * were built by an input handler instead of ProseMirror's DOM reader (e.g.
   * editable.js's beforeinput insertText path replacing the preedit at
   * commit). Tracking them immediately would turn the raw preedit into a
   * tracked deletion.
   */
  #replacesWithinDeferredRange(tr: Transaction): boolean {
    const range = this.#deferredCompositionRange;
    if (!range || !tr.steps.length) return false;
    return tr.steps.every(
      (step) => step instanceof ReplaceStep && step.from < step.to && step.from >= range.from && step.to <= range.to,
    );
  }

  /**
   * Maps {@link #deferredCompositionRange} through the transactions just
   * applied and unions in the content inserted by a deferred composition
   * transaction.
   */
  #updateDeferredCompositionRange(applied: readonly Transaction[], deferredSource: Transaction | null): void {
    if (!this.#deferredCompositionRange && !deferredSource) return;

    let range = this.#deferredCompositionRange;
    for (const tr of applied) {
      if (range) {
        const from = tr.mapping.map(range.from, -1);
        const to = tr.mapping.map(range.to, 1);
        range = from < to ? { from, to } : null;
      }
      if (tr === deferredSource) {
        tr.steps.forEach((step, index) => {
          if (!(step instanceof ReplaceStep) || step.slice.size === 0) return;
          const rest = tr.mapping.slice(index + 1);
          const from = rest.map(step.from, -1);
          const to = rest.map(step.from + step.slice.size, 1);
          range = range ? { from: Math.min(range.from, from), to: Math.max(range.to, to) } : { from, to };
        });
      }
    }
    this.#deferredCompositionRange = range;
  }

  #mapDeferredCompositionDeletions(applied: readonly Transaction[]): void {
    if (!this.#deferredCompositionDeletions.length) return;
    this.#deferredCompositionDeletions = this.#mapCompositionDeletions(this.#deferredCompositionDeletions, applied);
  }

  #mapCompositionDeletions(
    deletions: Array<{ pos: number; slice: PmSlice }>,
    applied: readonly Transaction[],
  ): Array<{ pos: number; slice: PmSlice }> {
    if (!deletions.length || !applied.length) return deletions;
    return deletions.map((deletion) => {
      let pos = deletion.pos;
      for (const tr of applied) {
        pos = tr.mapping.map(pos, -1);
      }
      return { ...deletion, pos };
    });
  }

  /**
   * Converts the deferred composition range into a tracked insertion. Runs
   * after compositionend (microtask-deferred so ProseMirror's own
   * compositionend handling and the run-wrapping flush land first).
   */
  #flushDeferredCompositionTracking(): void {
    const range = this.#deferredCompositionRange;
    const deletions = this.#deferredCompositionDeletions;
    const compositionId = this.#deferredCompositionId;
    this.#deferredCompositionRange = null;
    this.#deferredCompositionDeletions = [];
    this.#deferredCompositionId = undefined;
    if (!range || this.isDestroyed || !this.view) return;

    const state = this.state;
    const trackChangesState = TrackChangesBasePluginKey.getState(state);
    if (!trackChangesState?.isTrackChangesActive) return;

    const from = Math.max(0, Math.min(range.from, state.doc.content.size));
    const to = Math.max(from, Math.min(range.to, state.doc.content.size));
    if (from >= to) return;

    // Text composed inside an existing insertion inherits the trackInsert
    // mark via mark inheritance; re-marking it would split the parent
    // suggestion with a new revision id.
    const insertMarkType = state.schema.marks[TrackInsertMarkName];
    if (!insertMarkType) return;
    let fullyMarked = true;
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && !insertMarkType.isInSet(node.marks)) fullyMarked = false;
      return !node.isText;
    });
    if (fullyMarked && !deletions.length) return;

    const tr = state.tr;
    const fixedTimeTo10Mins = Math.floor(Date.now() / 600000) * 600000;
    const date = new Date(fixedTimeTo10Mins).toISOString();
    const user = (this.options.user ?? {}) as User;
    let insertedMark = fullyMarked ? null : markInsertion({ tr, from, to, user, date });
    const replacementGroupId =
      insertedMark && deletions.length && this.options.trackedChanges?.replacements !== 'independent'
        ? insertedMark.attrs.id
        : '';
    if (insertedMark && replacementGroupId) {
      const replacementInsertMark = insertedMark.type.create({
        ...insertedMark.attrs,
        changeType: CanonicalChangeType.Replacement,
        replacementGroupId,
        replacementSideId: `${replacementGroupId}#inserted`,
      });
      tr.removeMark(from, to, insertedMark);
      tr.addMark(from, to, replacementInsertMark);
      insertedMark = replacementInsertMark;
    }
    let deletionMeta: {
      deletionMark: ReturnType<typeof markDeletion>['deletionMark'];
      deletionNodes: ReturnType<typeof markDeletion>['nodes'];
    } | null = null;

    deletions.forEach((deletion) => {
      const deleteFrom = tr.mapping.map(deletion.pos, -1);
      const beforeSize = tr.doc.content.size;
      tr.replace(deleteFrom, deleteFrom, deletion.slice);
      const deleteTo = deleteFrom + (tr.doc.content.size - beforeSize);
      if (deleteTo <= deleteFrom) return;
      const deletionResult = markDeletion({
        tr,
        from: deleteFrom,
        to: deleteTo,
        user,
        date,
        id: replacementGroupId || undefined,
      });
      const deletionMark = replacementGroupId
        ? deletionResult.deletionMark.type.create({
            ...deletionResult.deletionMark.attrs,
            changeType: CanonicalChangeType.Replacement,
            replacementGroupId,
            replacementSideId: `${replacementGroupId}#deleted`,
          })
        : deletionResult.deletionMark;
      if (deletionMark !== deletionResult.deletionMark) {
        tr.removeMark(deleteFrom, deleteTo, deletionResult.deletionMark);
        tr.addMark(deleteFrom, deleteTo, deletionMark);
      }
      deletionMeta = {
        deletionMark,
        deletionNodes: deletionResult.nodes,
      };
    });

    tr.setMeta('skipTrackChanges', true);
    tr.setMeta('compositionTrackingFlush', true);
    // Share the composition id with the deferred text transactions so
    // prosemirror-history merges this flush into the same undo event — undo
    // must remove the composed text and its suggestion marks together, and the
    // unified history coordinator must not see a second undoable event.
    if (compositionId !== undefined) tr.setMeta('composition', compositionId);
    // Surface the insertion to the sidebar bubble pipeline: mark-only steps
    // have empty step maps, so collectTouchedTrackedChangeIds can only learn
    // the new change id from this meta (same contract as replaceStep).
    tr.setMeta(TrackChangesBasePluginKey, {
      ...(insertedMark ? { insertedMark } : {}),
      ...(deletionMeta ?? {}),
    });
    this.view.dispatch(tr);
  }

  /**
   * DOM compositionend/blur handler on the editor view. Stable reference so
   * unmount() can remove it.
   */
  #handleDomCompositionEnd = (event?: Event): void => {
    const forceFlush = event?.type === 'blur';
    queueMicrotask(() => {
      // Nothing deferred — common for blur events outside composition. A
      // pending trailing composition read will reschedule via the dispatch
      // path once it applies.
      if (!this.#deferredCompositionRange) return;
      // A new composition can chain immediately after the previous commit
      // (common with CJK IMEs); keep deferring until that one ends too.
      if (this.view?.composing && !forceFlush) return;
      // The final composition DOM read can still be pending in ProseMirror's
      // observer; force it so the commit transaction (deferred, extends the
      // range) applies before the range is converted to a tracked insert.
      try {
        (this.view as unknown as { domObserver?: { flush?: () => void } })?.domObserver?.flush?.();
      } catch {
        // A failed forced flush only risks marking the range one tick early.
      }
      if (this.view?.composing && !forceFlush) return;
      this.#flushDeferredCompositionTracking();
    });
  };

  #dispatchTransaction(transaction: Transaction): void {
    if (this.isDestroyed) return;
    const perf = this.view?.dom?.ownerDocument?.defaultView?.performance ?? globalThis.performance;
    const perfNow = () => (perf?.now ? perf.now() : Date.now());
    const perfStart = perfNow();

    const prevState = this.state;
    let nextState: EditorState;
    let transactionToApply = transaction;
    // appendTransaction plugins (e.g. numberingPlugin) may produce transactions that
    // change the doc even when the original transaction does not. We resolve the
    // effective doc-carrying tr after applyTransaction so the 'update' event is
    // emitted with `docChanged` / `mapping` that consumers (notably
    // PresentationEditor.handleUpdate) actually need.
    let effectiveTransaction: Transaction = transaction;
    const forceTrackChanges = transactionToApply.getMeta('forceTrackChanges') === true;
    try {
      const trackChangesState = TrackChangesBasePluginKey.getState(prevState);
      const isTrackChangesActive = trackChangesState?.isTrackChangesActive ?? false;
      const skipTrackChanges = transactionToApply.getMeta('skipTrackChanges') === true;
      const directInsertionMutationCommentMeta = resolveDirectInsertionMutationCommentMeta(
        prevState,
        transactionToApply,
      );
      const protectsExistingTrackedReviewState = transactionTouchesTrackedReviewState(prevState, transactionToApply);
      if (protectsExistingTrackedReviewState && skipTrackChanges) {
        transactionToApply.setMeta('protectTrackedReviewState', true);
      }

      const shouldTrackForComposition = (isTrackChangesActive || forceTrackChanges) && !skipTrackChanges;
      const shouldTrack = shouldTrackForComposition || protectsExistingTrackedReviewState;
      // Editing-mode collapsed insert strictly inside a tracked review span: the
      // typed text is made plain below, so it does NOT mutate the surrounding
      // suggestion. Resolve it up front so the direct-insertion comment-mutation
      // event is suppressed for this case (otherwise it would emit a stale
      // commentsUpdate for an insertion that was not actually expanded). A
      // delete-range edit still fires that event - plainInsertRange is null for
      // it, since it is not a collapsed insert.
      const plainInsertRange = !shouldTrack
        ? collapsedInsertInsideTrackedReviewMarkRange(prevState, transactionToApply)
        : null;
      if (
        !shouldTrack &&
        !plainInsertRange &&
        directInsertionMutationCommentMeta &&
        !transactionToApply.getMeta(TrackChangesBasePluginKey)
      ) {
        transactionToApply.setMeta(TrackChangesBasePluginKey, directInsertionMutationCommentMeta);
      }
      // PM mark inheritance (inclusive:false) still copies the neighbour
      // suggestion's trackInsert/trackDelete/trackFormat onto a strictly-interior
      // insert. Strip ONLY those enclosing mark instances from the inserted range
      // (matched by type + attrs) so the typed chars stay plain and the existing
      // suggestion is simply split around them. Removing by instance - not by type -
      // preserves review marks a pasted SuperDoc slice carries in (a different
      // review id), which a blanket type-strip would silently drop. Stored marks are
      // cleared by type so continued typing stays plain; that only affects the next
      // typed char, never the already-inserted content. Composition-meta-agnostic:
      // deferral never runs in editing mode, so this normalizes IME and non-IME inserts.
      if (plainInsertRange) {
        for (const mark of plainInsertRange.marks) {
          transactionToApply.removeMark(plainInsertRange.from, plainInsertRange.to, mark);
        }
        const schemaMarks = prevState.schema.marks;
        for (const markName of [TrackInsertMarkName, TrackDeleteMarkName, TrackFormatMarkName]) {
          const markType = schemaMarks[markName];
          if (markType) transactionToApply.removeStoredMark(markType);
        }
      }
      if (shouldTrack && forceTrackChanges && !this.options.user) {
        throw new Error('forceTrackChanges requires a user to be configured on the editor instance.');
      }

      // SD-2368: while a native IME composition is in flight, apply
      // composition transactions raw and convert the composed range into a
      // tracked insert after compositionend (#flushDeferredCompositionTracking).
      // Composition-meta transactions can land after compositionend (ProseMirror
      // flushes the final DOM read asynchronously), so composition transactions
      // are deferred regardless of the live composing flag.
      const deferTrackingForComposition =
        shouldTrackForComposition &&
        (isCompositionTransaction(transactionToApply) ||
          (this.view?.composing === true && this.#replacesWithinDeferredRange(transactionToApply))) &&
        this.#canDeferCompositionTracking(transactionToApply, prevState);
      const deferredCompositionDeletions = deferTrackingForComposition
        ? this.#collectDeferredCompositionDeletions(transactionToApply)
        : [];
      if (deferTrackingForComposition) {
        const compositionMeta = transactionToApply.getMeta('composition');
        if (compositionMeta !== undefined) this.#deferredCompositionId = compositionMeta;
      }

      const trackedUser = this.options.user ?? {};
      transactionToApply =
        shouldTrack && !deferTrackingForComposition
          ? trackedTransaction({
              tr: transactionToApply,
              state: prevState,
              user: trackedUser,
              replacements: this.options.trackedChanges?.replacements === 'independent' ? 'independent' : 'paired',
            })
          : transactionToApply;

      const { state: appliedState, transactions: appliedTransactions } = prevState.applyTransaction(transactionToApply);
      nextState = appliedState;
      this.#updateDeferredCompositionRange(
        appliedTransactions,
        deferTrackingForComposition ? transactionToApply : null,
      );
      this.#mapDeferredCompositionDeletions(appliedTransactions);
      if (deferredCompositionDeletions.length) {
        this.#deferredCompositionDeletions.push(
          ...this.#mapCompositionDeletions(deferredCompositionDeletions, appliedTransactions.slice(1)),
        );
      }
      if (deferTrackingForComposition && this.view?.composing !== true) {
        // Trailing composition read landed after compositionend (possibly after
        // the flush already ran) — schedule another flush for the new range.
        this.#handleDomCompositionEnd();
      }
      // Pick whichever applied tr carries the doc delta — when the input tr is empty an
      // appendTransaction plugin (e.g. numberingPlugin) may have produced the real change,
      // and downstream listeners read `transaction.docChanged`/`mapping` off this tr.
      effectiveTransaction = appliedTransactions.find((t) => t.docChanged) ?? transactionToApply;
    } catch (error) {
      if (forceTrackChanges) throw error;
      // just in case
      nextState = prevState.apply(transactionToApply);
      console.log(error);
    }

    const selectionHasChanged = !prevState.selection.eq(nextState.selection);

    this._state = nextState;
    if (this.view) {
      this.view.updateState(nextState);
    }

    const end = perfNow();

    this.emit('transaction', {
      editor: this,
      transaction: transactionToApply,
      duration: end - perfStart,
    });

    if (selectionHasChanged) {
      this.emit('selectionUpdate', {
        editor: this,
        transaction: transactionToApply,
      });
    }
    this.#emitContentControlEvents({
      transaction: transactionToApply,
      nextState,
      selectionHasChanged,
    });

    const focus = transactionToApply.getMeta('focus');
    if (focus) {
      this.emit('focus', {
        editor: this,
        event: focus.event,
        transaction: transactionToApply,
      });
    }

    const blur = transactionToApply.getMeta('blur');
    if (blur) {
      this.emit('blur', {
        editor: this,
        event: blur.event,
        transaction: transactionToApply,
      });
    }

    if (effectiveTransaction.docChanged) {
      // Track document modifications and promote to GUID if needed.
      // Only count user-initiated (original) transactions as document modifications.
      if (transaction.docChanged && this.converter) {
        if (!this.converter.documentGuid) {
          this.converter.promoteToGuid();
          console.debug('Document modified - assigned GUID:', this.converter.documentGuid);
        }
        this.converter.documentModified = true;
      }

      this.emit('update', {
        editor: this,
        transaction: effectiveTransaction,
      });
    }
  }

  #emitContentControlEvents({
    transaction,
    nextState,
    selectionHasChanged,
  }: {
    transaction: Transaction;
    nextState: EditorState;
    selectionHasChanged: boolean;
  }): void {
    const uiEvent = transaction.getMeta('uiEvent');
    const recentPointerDown = Date.now() - this.#lastPointerDownAt <= CONTENT_CONTROL_POINTER_WINDOW_MS;
    const source: 'keyboard' | 'pointer' = uiEvent === 'click' || recentPointerDown ? 'pointer' : 'keyboard';
    // Full active stack (innermost first), matching ui.contentControls
    // activeIds. `active` is the deepest control; `activePath` lets nested-aware
    // custom UI read the surrounding controls without combining with observe().
    const activePath = nextState.selection ? this.#collectActiveSdtRefs(nextState.selection) : [];
    const activeContentControl = activePath[0] ?? null;

    if (selectionHasChanged) {
      const previous = this.#lastActiveContentControlRef;
      const activeChanged = previous?.id !== activeContentControl?.id;
      if (activeChanged) {
        if (activeContentControl) {
          this.emit('contentControlFocus', {
            active: activeContentControl,
            previous,
            activePath,
            source,
          });
        } else if (previous) {
          this.emit('contentControlBlur', {
            active: null,
            previous,
            activePath: [],
            source,
          });
        }
        this.#lastActiveContentControlRef = activeContentControl;
      }
    }

    if (uiEvent === 'click' && activeContentControl) {
      this.emit('contentControlClick', {
        target: activeContentControl,
        source: 'pointer',
      });
    }
  }

  #collectActiveSdtRefs(selection: EditorState['selection']): SdtRef[] {
    const refs: SdtRef[] = [];
    const seenIds = new Set<string>();
    const selectedNode = selection instanceof PmNodeSelection ? selection.node : null;
    if (
      selectedNode &&
      (selectedNode.type?.name === 'structuredContent' || selectedNode.type?.name === 'structuredContentBlock')
    ) {
      const ref = this.#toSdtRef(selectedNode);
      if (ref) {
        refs.push(ref);
        seenIds.add(ref.id);
      }
    }

    const anchor = selection.$anchor;
    if (anchor && typeof anchor.depth === 'number' && typeof anchor.node === 'function') {
      for (let depth = anchor.depth; depth >= 0; depth -= 1) {
        const node = anchor.node(depth) as PmNode | null | undefined;
        if (!node) continue;
        const typeName = node?.type?.name;
        if (typeName !== 'structuredContent' && typeName !== 'structuredContentBlock') continue;
        const ref = this.#toSdtRef(node);
        if (!ref) continue;
        if (seenIds.has(ref.id)) continue;
        refs.push(ref);
        seenIds.add(ref.id);
      }
    }
    return refs;
  }

  #toSdtRef(node: PmNode): SdtRef | null {
    const attrs = node.attrs as { id?: unknown; tag?: unknown; alias?: unknown; controlType?: unknown };
    const id = attrs?.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const scope = node.type.name === 'structuredContent' ? 'inline' : 'block';
    return {
      id,
      tag: typeof attrs.tag === 'string' ? attrs.tag : undefined,
      alias: typeof attrs.alias === 'string' ? attrs.alias : undefined,
      controlType: typeof attrs.controlType === 'string' ? attrs.controlType : 'unknown',
      scope,
    };
  }

  /**
   * Public dispatch method for transaction dispatching.
   *
   * Allows external callers (e.g., SuperDoc stores, headless workflows) to dispatch
   * transactions without accessing editor.view directly. This method works in both
   * mounted and headless modes.
   *
   * In headless mode, this is the primary way to apply state changes since there is
   * no ProseMirror view to dispatch through.
   *
   * @deprecated Direct ProseMirror dispatch will be removed in a future version. Use the Document API (`editor.doc`) instead.
   *
   * @param tr - The ProseMirror transaction to dispatch
   *
   * @example
   * ```typescript
   * // Headless mode: insert text without a view
   * const editor = new Editor({ isHeadless: true, content: docx });
   * editor.dispatch(editor.state.tr.insertText('Hello'));
   * ```
   */
  dispatch(tr: Transaction): void {
    this.#dispatchTransaction(tr);
  }

  /**
   * Get document unique identifier (async)
   * Returns a stable identifier for the document (identifierHash or contentHash)
   */
  async getDocumentIdentifier(): Promise<string | null> {
    return (await this.converter?.getDocumentIdentifier()) || null;
  }

  /**
   * Get permanent document GUID (sync - only for modified documents)
   */
  getDocumentGuid(): string | null {
    return this.converter?.documentGuid || null;
  }

  /**
   * Check if document has been modified
   */
  isDocumentModified(): boolean {
    return this.converter?.documentModified || false;
  }

  /**
   * @deprecated use getDocumentGuid instead
   */
  getDocumentId(): string | null {
    console.warn('getDocumentId is deprecated, use getDocumentGuid instead');
    return this.getDocumentGuid();
  }

  /**
   * Get attrs of the currently selected node or mark.
   * @example
   * editor.getAttributes('textStyle').color
   */
  getAttributes(nameOrType: string): Record<string, unknown> {
    return Attribute.getAttributes(this.state, nameOrType);
  }

  /**
   * Returns if the currently selected node or mark is active.
   * @param nameOrAttributes - The name of the node/mark or an attributes object
   * @param attributesOrUndefined - Optional attributes to check when first parameter is a name
   * @example
   * editor.isActive('bold')
   * editor.isActive('textStyle', { color: 'purple' })
   * editor.isActive({ textAlign: 'center' })
   */
  isActive(
    nameOrAttributes: string | Record<string, unknown>,
    attributesOrUndefined?: Record<string, unknown>,
  ): boolean {
    const name = typeof nameOrAttributes === 'string' ? nameOrAttributes : null;
    const attributes = typeof nameOrAttributes === 'string' ? attributesOrUndefined : nameOrAttributes;
    return isActive(this.state, name, attributes);
  }

  /**
   * Get the editor content as JSON
   */
  getJSON(): ProseMirrorJSON {
    const json = this.state.doc.toJSON();
    try {
      // Always sync converter bodySectPr into doc attrs so layout/export see latest section defaults
      const jsonObj = json as ProseMirrorJSON;
      const attrs = jsonObj.attrs as Record<string, unknown> | undefined;
      const converter = this.converter as unknown as { bodySectPr?: unknown };
      if (converter && converter.bodySectPr) {
        jsonObj.attrs = attrs || {};
        (jsonObj.attrs as Record<string, unknown>).bodySectPr = converter.bodySectPr;
      }
    } catch {
      // Non-fatal: leave json as-is if anything unexpected occurs
    }
    return json as ProseMirrorJSON;
  }

  /**
   * Get document metadata including GUID, modification status, and version
   */
  getMetadata(): {
    documentGuid: string | null;
    isModified: boolean;
    version: string | null;
  } {
    return {
      documentGuid: this.converter?.documentGuid || null,
      isModified: this.isDocumentModified(),
      version: this.converter?.getSuperdocVersion() || null,
    };
  }

  /**
   * Get the editor content as HTML
   */
  getHTML({ unflattenLists = false }: { unflattenLists?: boolean } = {}): string {
    const domDocument = this.#getDomDocument();
    if (!domDocument) {
      throw new Error(
        '[super-editor] getHTML() requires a DOM. Provide { document } (e.g. from JSDOM), set DOM globals, or run in a browser environment.',
      );
    }

    const container = domDocument.createElement('div');
    const fragment = PmDOMSerializer.fromSchema(this.schema).serializeFragment(this.state.doc.content, {
      document: domDocument,
    });
    container.appendChild(fragment);
    let html = container.innerHTML;
    if (unflattenLists) {
      html = unflattenListsInHtml(html, domDocument);
    }
    return html;
  }

  /**
   * Get the editor content as Markdown
   */
  async getMarkdown(): Promise<string> {
    const domDocument = this.#getDomDocument();
    if (!domDocument) {
      throw new Error(
        '[super-editor] getMarkdown() requires a DOM. Provide { document } (e.g. from JSDOM), set DOM globals, or run in a browser environment.',
      );
    }

    // Type alias to avoid repeated verbose casts when manipulating DOM globals
    type MutableGlobals = Record<string, unknown> & {
      document?: Document;
      window?: Window & typeof globalThis;
      navigator?: Navigator;
    };
    const globals = globalThis as unknown as MutableGlobals;

    const shouldInjectGlobals = globals.document === undefined;
    const savedGlobals = shouldInjectGlobals
      ? {
          document: globals.document,
          window: globals.window,
          navigatorDescriptor: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
        }
      : null;

    if (shouldInjectGlobals) {
      globals.document = domDocument;
      if (!globals.window && domDocument.defaultView) {
        globals.window = domDocument.defaultView as Window & typeof globalThis;
      }
      if (!globals.navigator && domDocument.defaultView?.navigator) {
        globals.navigator = domDocument.defaultView.navigator;
      }
    }

    // Lazy-load markdown libraries to avoid requiring 'document' at import time
    // These libraries (specifically rehype) execute code that accesses document.createElement()
    // during module initialization, which breaks Node.js compatibility
    try {
      const [
        { unified },
        { default: rehypeParse },
        { default: rehypeRemark },
        { default: remarkStringify },
        { default: remarkGfm },
      ] = await Promise.all([
        import('unified'),
        import('rehype-parse'),
        import('rehype-remark'),
        import('remark-stringify'),
        import('remark-gfm'),
      ]);

      const html = this.getHTML();
      const file = unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeRemark)
        .use(remarkGfm)
        .use(remarkStringify, {
          bullet: '-',
          fences: true,
        })
        .processSync(html);

      return String(file);
    } finally {
      if (savedGlobals) {
        // Restore or delete each global based on its original state
        if (savedGlobals.document === undefined) {
          delete globals.document;
        } else {
          globals.document = savedGlobals.document;
        }

        if (savedGlobals.window === undefined) {
          delete globals.window;
        } else {
          globals.window = savedGlobals.window;
        }

        if (savedGlobals.navigatorDescriptor) {
          Object.defineProperty(globalThis, 'navigator', savedGlobals.navigatorDescriptor);
        } else {
          delete globals.navigator;
        }
      }
    }
  }

  /**
   * Get the document version from the converter
   */
  getDocumentVersion(): string | null {
    return this.converter?.getSuperdocVersion() || null;
  }

  /**
   * Create a child editor linked to this editor.
   * This is useful for creating header/footer editors that are linked to the main editor.
   * Or paragraph fields that rely on the same underlying document and list defintions
   */
  createChildEditor(options: Partial<EditorOptions>): Editor {
    return createLinkedChildEditor(this, options);
  }

  /**
   * Get page styles
   */
  getPageStyles(): PageStyles {
    return this.converter?.pageStyles || {};
  }

  /**
   * Update page styles
   */
  updatePageStyle({ pageMargins }: { pageMargins?: Record<string, unknown> }): void {
    if (!this.converter) return;

    let hasMadeUpdate = false;
    if (pageMargins) {
      this.converter.pageStyles.pageMargins = pageMargins;
      this.initDefaultStyles();
      hasMadeUpdate = true;
    }

    if (hasMadeUpdate && this.view && !isHeadless()) {
      const newTr = this.view.state.tr;
      newTr.setMeta('forceUpdatePagination', true);
      this.#dispatchTransaction(newTr);

      // Emit dedicated event for page style updates
      // This provides a clearer semantic signal for consumers that need to react
      // to page style changes (margins, size, orientation) without content modifications
      this.emit('pageStyleUpdate', {
        pageMargins,
        pageStyles: this.converter.pageStyles,
      });
    }
  }

  /**
   * Handles image node selection for header/footer editor
   */
  #handleNodeSelection(view: PmEditorView, pos: number): boolean | void {
    this.setOptions({
      lastSelection: null,
    });

    if (this.options.isHeaderOrFooter) {
      return setImageNodeSelection(view, pos);
    }
  }

  /**
   * Perform any post conversion pre prosemirror import processing.
   * Comments are processed here.
   * @param doc The prosemirror document
   * @returns The updated prosemirror document
   */
  #prepareDocumentForImport(doc: PmNode): PmNode {
    const newState = PmEditorState.create({
      schema: this.schema,
      doc,
    });

    const { tr, doc: newDoc } = newState;

    // Perform comments processing (replaces comment nodes with marks)
    prepareCommentsForImport(newDoc, tr, this.schema, this.converter);

    const updatedState = newState.apply(tr);
    return updatedState.doc;
  }

  migrateListsToV2(): Array<{ from: number; to: number; slice: unknown }> {
    if (this.options.isHeaderOrFooter) return [];
    const replacements = migrateListsToV2IfNecessary(this);
    return replacements;
  }

  /**
   * Prepare the document for export. Any necessary pre-export processing to the state
   * can happen here.
   * @returns The updated document in JSON
   */
  #prepareDocumentForExport(comments: Comment[] = []): ProseMirrorJSON {
    // Use Transform directly instead of creating a throwaway EditorState.
    // EditorState.create() calls Plugin.init() for every plugin, and
    // yUndoPlugin.init() registers persistent observers on the shared ydoc
    // that are never cleaned up — causing an observer leak that degrades
    // collaboration performance over time.
    const doc = this.state.doc;
    const tr = new Transform(doc);
    prepareCommentsForExport(doc, tr, this.schema, comments);
    return tr.doc.toJSON();
  }

  getUpdatedJson(): ProseMirrorJSON {
    return this.#prepareDocumentForExport();
  }

  /**
   * Install a fresh Word revision id allocator on the converter. Walks the
   * current document and reserves every decimal `sourceId` so newly minted ids
   * never collide with imported revisions.
   */
  #installWordIdAllocatorIfNeeded(): void {
    if (!this.converter) return;

    const allocator = createWordIdAllocator();

    const reserveAttrs = (attrs: { sourceId?: unknown } | undefined, path: string): void => {
      const sourceId = attrs?.sourceId;
      if (isDecimalWordId(sourceId)) {
        allocator.reserve(path, sourceId as string | number);
      }
    };

    const reserveFromDoc = (doc: PmNode | undefined | null, path: string): void => {
      if (!doc) return;
      doc.descendants((node) => {
        if (!Array.isArray(node.marks)) return;
        for (const mark of node.marks) {
          const name = mark.type.name;
          if (name !== 'trackInsert' && name !== 'trackDelete' && name !== 'trackFormat') continue;
          reserveAttrs(mark.attrs as { sourceId?: unknown }, path);
        }
      });
    };

    const reserveFromJson = (node: unknown, path: string): void => {
      if (!node || typeof node !== 'object') return;
      const current = node as { marks?: Array<{ type?: string; attrs?: { sourceId?: unknown } }>; content?: unknown[] };
      if (Array.isArray(current.marks)) {
        for (const mark of current.marks) {
          if (mark.type !== 'trackInsert' && mark.type !== 'trackDelete' && mark.type !== 'trackFormat') continue;
          reserveAttrs(mark.attrs, path);
        }
      }
      if (Array.isArray(current.content)) {
        for (const child of current.content) reserveFromJson(child, path);
      }
    };

    const wordPartPath = (target: unknown, fallback: string): string => {
      if (typeof target !== 'string' || !target) return fallback;
      const stripped = target.replace(/^\/+/, '');
      return stripped.startsWith('word/') ? stripped : `word/${stripped}`;
    };

    const relsRoot = this.converter.convertedXml?.['word/_rels/document.xml.rels']?.elements?.find(
      (node: { name?: string }) => node.name === 'Relationships',
    );
    const resolveRelationshipTarget = (relationshipId: string, fallback: string): string => {
      const target = relsRoot?.elements?.find(
        (node: { attributes?: { Id?: string; Target?: string } }) => node.attributes?.Id === relationshipId,
      )?.attributes?.Target;
      return wordPartPath(target, fallback);
    };

    reserveFromDoc(this.state?.doc as PmNode, 'word/document.xml');
    for (const [id, header] of Object.entries(this.converter.headers || {})) {
      const partPath = resolveRelationshipTarget(id, 'word/header1.xml');
      const headerEditor = this.converter.headerEditors?.find((item: { id?: string }) => item.id === id);
      reserveFromDoc(headerEditor?.editor?.state?.doc as PmNode | undefined, partPath);
      reserveFromJson(header, partPath);
    }
    for (const [id, footer] of Object.entries(this.converter.footers || {})) {
      const partPath = resolveRelationshipTarget(id, 'word/footer1.xml');
      const footerEditor = this.converter.footerEditors?.find((item: { id?: string }) => item.id === id);
      reserveFromDoc(footerEditor?.editor?.state?.doc as PmNode | undefined, partPath);
      reserveFromJson(footer, partPath);
    }
    reserveFromJson(this.converter.footnotes, 'word/footnotes.xml');
    reserveFromJson(this.converter.endnotes, 'word/endnotes.xml');

    (this.converter as ConverterWithInternalWordIdAllocator).wordIdAllocator = allocator;
  }

  #persistTrackedChangeSourceIdMap(): void {
    if (!this.converter) return;

    const allocator = (this.converter as ConverterWithInternalWordIdAllocator).wordIdAllocator;
    const sourceIdMap = allocator?.getSourceIdMap?.() ?? {};
    if (Object.keys(sourceIdMap).length === 0 && !this.#hasTrackedChangeSourceIdMapProperty()) return;

    const payload = JSON.stringify({ version: 1, parts: sourceIdMap });
    SuperConverter.setStoredCustomProperty(
      this.converter.convertedXml,
      TRACKED_CHANGE_SOURCE_ID_MAP_PROPERTY,
      payload,
      false,
    );
  }

  #hasTrackedChangeSourceIdMapProperty(): boolean {
    const customXml = this.converter?.convertedXml?.['docProps/custom.xml'];
    const properties = customXml?.elements?.find((node: { name?: string }) => {
      const name = node?.name;
      return name === 'Properties' || name?.endsWith(':Properties');
    });
    return Boolean(
      properties?.elements?.some((node: { name?: string; attributes?: { name?: string } }) => {
        const name = node?.name;
        return (
          (name === 'property' || name?.endsWith(':property')) &&
          node.attributes?.name === TRACKED_CHANGE_SOURCE_ID_MAP_PROPERTY
        );
      }),
    );
  }

  /**
   * Export the editor document to DOCX.
   *
   * Return type depends on flags:
   * - `exportXmlOnly: true` → `string` (raw XML)
   * - `exportJsonOnly: true` → `ConvertedXmlPart` (the xml-js intermediate
   *   tree; recursive `name` / `attributes` / `elements` shape, NOT a JSON
   *   string). SD-3248: this overload previously typed as `Promise<string>`,
   *   which did not match runtime. Consumers should walk the returned tree
   *   directly; calling `JSON.parse` on it would never have worked.
   * - `getUpdatedDocs: true` → `Record<string, string | null>` (file map)
   * - Default → `Blob` (browser) or `Buffer` (Node.js headless). The runtime
   *   value is determined by the editor's `isHeadless` option at construction
   *   time, which the type system cannot see, so the default overload is
   *   generic with `Blob` as the default. Browser consumers get `Blob`
   *   automatically; Node headless consumers opt in with `exportDocx<Buffer>()`.
   */
  async exportDocx(params: ExportDocxParams & { exportXmlOnly: true }): Promise<string>;
  async exportDocx(params: ExportDocxParams & { exportJsonOnly: true }): Promise<ConvertedXmlPart>;
  async exportDocx(params: ExportDocxParams & { getUpdatedDocs: true }): Promise<Record<string, string | null>>;
  async exportDocx<T extends Blob | Buffer = Blob>(
    params?: ExportDocxParams & { exportXmlOnly?: false; exportJsonOnly?: false; getUpdatedDocs?: false },
  ): Promise<T>;
  async exportDocx({
    isFinalDoc = false,
    commentsType = 'external',
    exportJsonOnly = false,
    exportXmlOnly = false,
    comments,
    getUpdatedDocs = false,
    fieldsHighlightColor = null,
    compression,
  }: ExportDocxParams = {}): Promise<Blob | Buffer | Record<string, string | null> | string | ConvertedXmlPart> {
    try {
      const exportHostEditor = resolveMainBodyEditor(this);
      commitLiveStorySessionRuntimes(exportHostEditor);

      // Use provided comments, or fall back to imported comments from converter
      const effectiveComments = comments ?? this.converter.comments ?? [];

      // Normalize commentJSON property (imported comments provide `elements`)
      const preparedComments = effectiveComments.map((comment: Comment) => {
        const elements = Array.isArray(comment.elements) && comment.elements.length ? comment.elements : undefined;
        const commentJson =
          comment.commentJSON ??
          elements ??
          (typeof comment.commentText === 'string' ? buildCommentJsonFromText(comment.commentText) : undefined);
        return {
          ...comment,
          commentJSON: commentJson,
        };
      });

      // Pre-process the document state to prepare for export
      const json = this.#prepareDocumentForExport(preparedComments);

      // Set up the Word revision id allocator on the converter so
      // ins/del/rPrChange decoders can mint
      // Word-compatible decimal `w:id` values without overwriting preserved
      // imported `sourceId` values. The allocator is reset per export so the
      // reserved set always reflects the current document state.
      this.#installWordIdAllocatorIfNeeded();

      // Export the document to DOCX
      // GUID will be handled automatically in converter.exportToDocx if document was modified
      const documentXml = await this.converter.exportToDocx(
        json,
        this.schema,
        (this.storage.image as ImageStorage).media,
        isFinalDoc,
        commentsType,
        preparedComments,
        this,
        exportJsonOnly,
        fieldsHighlightColor,
      );

      this.#validateDocumentExport();

      if (exportXmlOnly || exportJsonOnly) return documentXml;

      this.#persistTrackedChangeSourceIdMap();

      const customXml = this.converter.schemaToXml(this.converter.convertedXml['docProps/custom.xml'].elements[0]);
      const styles = this.converter.schemaToXml(this.converter.convertedXml['word/styles.xml'].elements[0]);
      const hasCustomSettings = !!this.converter.convertedXml['word/settings.xml']?.elements?.length;
      const customSettings = hasCustomSettings
        ? this.converter.schemaToXml(this.converter.convertedXml['word/settings.xml']?.elements?.[0])
        : null;

      const rels = this.converter.schemaToXml(this.converter.convertedXml['word/_rels/document.xml.rels'].elements[0]);
      // SD-3400 tombstones: session-deleted notes stay in the live part store
      // (undo restores them) but must not reach the exported file. Pruning is
      // a pure zip-time transform on a COPY; convertedXml keeps the elements.
      const footnotesData = pruneSessionDeletedNotesPart(this.converter.convertedXml['word/footnotes.xml'], {
        converter: this.converter,
        documentXml: this.converter.convertedXml['word/document.xml'],
        type: 'footnote',
      });
      const footnotesXml = footnotesData?.elements?.[0] ? this.converter.schemaToXml(footnotesData.elements[0]) : null;
      const footnotesRelsData = this.converter.convertedXml['word/_rels/footnotes.xml.rels'];
      const footnotesRelsXml = footnotesRelsData?.elements?.[0]
        ? this.converter.schemaToXml(footnotesRelsData.elements[0])
        : null;
      const endnotesData = pruneSessionDeletedNotesPart(this.converter.convertedXml['word/endnotes.xml'], {
        converter: this.converter,
        documentXml: this.converter.convertedXml['word/document.xml'],
        type: 'endnote',
      });
      const endnotesXml = endnotesData?.elements?.[0] ? this.converter.schemaToXml(endnotesData.elements[0]) : null;
      const endnotesRelsData = this.converter.convertedXml['word/_rels/endnotes.xml.rels'];
      const endnotesRelsXml = endnotesRelsData?.elements?.[0]
        ? this.converter.schemaToXml(endnotesRelsData.elements[0])
        : null;

      const settingsRelsData = this.converter.convertedXml['word/_rels/settings.xml.rels'];
      const settingsRelsXml = settingsRelsData?.elements?.[0]
        ? this.converter.schemaToXml(settingsRelsData.elements[0])
        : null;

      const media = this.converter.addedMedia;

      const updatedHeadersFooters: Record<string, string> = {};
      Object.entries(this.converter.convertedXml).forEach(([name, json]) => {
        if (name.includes('header') || name.includes('footer')) {
          const jsonObj = json as { elements?: unknown[] };
          const resultXml = this.converter.schemaToXml(jsonObj.elements?.[0]);
          updatedHeadersFooters[name] = String(resultXml.replace(/\[\[sdspace\]\]/g, ''));
        }
      });

      const numberingData = this.converter.convertedXml['word/numbering.xml'];
      const numbering = numberingData?.elements?.[0] ? this.converter.schemaToXml(numberingData.elements[0]) : null;

      const appXmlData = this.converter.convertedXml['docProps/app.xml'];
      const appXml = appXmlData?.elements?.[0] ? this.converter.schemaToXml(appXmlData.elements[0]) : null;

      // Export core.xml (contains dcterms:created timestamp)
      const coreXmlData = this.converter.convertedXml['docProps/core.xml'];
      const coreXml = coreXmlData?.elements?.[0] ? this.converter.schemaToXml(coreXmlData.elements[0]) : null;

      const updatedDocs: Record<string, string | null> = {
        ...this.options.customUpdatedFiles,
        'word/document.xml': String(documentXml),
        'docProps/custom.xml': String(customXml),
        'word/_rels/document.xml.rels': String(rels),
        ...(numbering ? { 'word/numbering.xml': String(numbering) } : {}),
        'word/styles.xml': String(styles),
        ...updatedHeadersFooters,
        ...(appXml ? { 'docProps/app.xml': String(appXml) } : {}),
        ...(coreXml ? { 'docProps/core.xml': String(coreXml) } : {}),
      };

      if (hasCustomSettings) {
        let settingsXml = String(customSettings);
        if (settingsRelsXml) {
          updatedDocs['word/_rels/settings.xml.rels'] = String(settingsRelsXml);
        } else if (/<\w+:attachedTemplate\b/i.test(settingsXml)) {
          // settings.xml references r:id on attachedTemplate via word/_rels/settings.xml.rels.
          // If that part is missing (e.g. collab joiner), omit the element so the package stays valid.
          settingsXml = settingsXml.replace(/<\w+:attachedTemplate\b[^>]*\/?>/gi, '');
        }
        updatedDocs['word/settings.xml'] = settingsXml;
      }

      if (footnotesXml) {
        updatedDocs['word/footnotes.xml'] = String(footnotesXml);
      }

      if (footnotesRelsXml) {
        updatedDocs['word/_rels/footnotes.xml.rels'] = String(footnotesRelsXml);
      }

      if (endnotesXml) {
        updatedDocs['word/endnotes.xml'] = String(endnotesXml);
      }

      if (endnotesRelsXml) {
        updatedDocs['word/_rels/endnotes.xml.rels'] = String(endnotesRelsXml);
      }

      // Serialize each comment file if it exists in convertedXml, otherwise mark as null
      // for deletion from the zip (removes stale originals).
      const commentFiles = COMMENT_FILE_BASENAMES.map((name) => `word/${name}`);
      for (const path of commentFiles) {
        const data = this.converter.convertedXml[path];
        if (data?.elements?.[0]) {
          updatedDocs[path] = String(this.converter.schemaToXml(data.elements[0]));
        } else {
          updatedDocs[path] = null;
        }
      }

      const bibliographyPartPaths =
        typeof this.converter.getBibliographyPartExportPaths === 'function'
          ? this.converter.getBibliographyPartExportPaths()
          : [];

      for (const path of bibliographyPartPaths) {
        const partData = this.converter.convertedXml[path];
        if (partData?.elements?.[0]) {
          updatedDocs[path] = String(this.converter.schemaToXml(partData.elements[0]));
        }
      }

      const peopleExport = this.converter as EditorConverterSurface & {
        getCommentPeopleUpdatedFiles?: () => Record<string, string>;
      };
      Object.assign(updatedDocs, peopleExport.getCommentPeopleUpdatedFiles?.());

      if (isFinalDoc) {
        const filteredMetadataParts = buildFilteredMetadataXml(this, this.converter.convertedXml, { finalDoc: true });
        for (const [path, xml] of Object.entries(filteredMetadataParts)) {
          updatedDocs[path] = xml;
        }
      }

      for (const path of Object.keys(this.converter.convertedXml)) {
        if (!path.startsWith('customXml/')) continue;
        if (!path.endsWith('.xml') && !path.endsWith('.rels')) continue;
        if (Object.prototype.hasOwnProperty.call(updatedDocs, path)) continue;
        const partData = this.converter.convertedXml[path] as { elements?: unknown[] } | undefined;
        if (partData?.elements?.[0]) {
          updatedDocs[path] = String(this.converter.schemaToXml(partData.elements[0]));
        }
      }

      // templates.apply: serialize substrate parts copied from a source package
      // (theme, fontTable, webSettings) so they survive save/export. These parts
      // have no dedicated serialization above; mirror the customXml passthrough.
      // Also re-serialize [Content_Types].xml and word/_rels/document.xml.rels
      // from convertedXml when the adapter added Overrides/Relationships there,
      // so the copied parts are registered in the package.
      const templateSubstratePaths = Object.keys(this.converter.convertedXml).filter(
        (path) =>
          /^word\/theme\/[^/]+\.xml$/.test(path) ||
          path === 'word/fontTable.xml' ||
          path === 'word/_rels/fontTable.xml.rels' ||
          path === 'word/webSettings.xml',
      );
      for (const path of templateSubstratePaths) {
        if (Object.prototype.hasOwnProperty.call(updatedDocs, path)) continue;
        const partData = this.converter.convertedXml[path] as { elements?: unknown[] } | undefined;
        if (partData?.elements?.[0]) {
          updatedDocs[path] = String(this.converter.schemaToXml(partData.elements[0]));
        }
      }
      for (const path of ['[Content_Types].xml', 'word/_rels/document.xml.rels']) {
        if (Object.prototype.hasOwnProperty.call(updatedDocs, path)) continue;
        const partData = this.converter.convertedXml[path] as { elements?: unknown[] } | undefined;
        if (partData?.elements?.[0]) {
          updatedDocs[path] = String(this.converter.schemaToXml(partData.elements[0]));
        }
      }

      // Emit ZIP tombstones for custom XML parts that were removed via the
      // Document API but originated in the imported DOCX. Without this,
      // the exporter would copy the original zip entry through, and the
      // removed part would reappear on the next import.
      // AIDEV-NOTE: `removedCustomXmlPaths` is set by `removeCustomXmlPart`
      // (super-converter/custom-xml-parts.js) on the converter instance.
      // Typed via cast rather than on SuperConverter.d.ts because adding
      // an explicit field there triggers weak-type errors against
      // ConverterWithDocumentSettings / ConverterLike structural types in
      // sibling files that don't reference this field.
      const removedCustomXmlPaths = (this.converter as unknown as { removedCustomXmlPaths?: Set<string> })
        .removedCustomXmlPaths;
      if (removedCustomXmlPaths instanceof Set) {
        for (const path of removedCustomXmlPaths) {
          updatedDocs[path] = null;
        }
      }

      const zipper = new DocxZipper();
      // A room-only join has no imported font files in options. Read the room's
      // current bytes at export time so replacements do not leave a stale cache.
      const roomMeta = (this.options.ydoc as YDoc | null)?.getMap('meta');
      const fonts = roomMeta?.has('fonts')
        ? ((roomMeta.get('fonts') ?? {}) as Record<string, unknown>)
        : this.options.fonts;

      if (getUpdatedDocs) {
        updatedDocs['[Content_Types].xml'] = await zipper.updateContentTypes(
          {
            files: this.options.content,
          },
          media,
          true,
          updatedDocs,
          fonts,
        );

        // Reconcile package-level singleton metadata (content-type overrides
        // and root relationships) against the final set of output entries.
        // this.options.content is DocxFileEntry[] | Record<string, unknown> | string | null.
        // The synchronizer accepts an array of {name, content} or a key→content map.
        const content = this.options.content;
        const baseFiles = Array.isArray(content) || (content && typeof content === 'object') ? content : null;
        const { contentTypesXml, relsXml } = syncPackageMetadata({
          baseFiles: baseFiles as Parameters<typeof syncPackageMetadata>[0]['baseFiles'],
          updatedDocs,
        });
        updatedDocs['[Content_Types].xml'] = contentTypesXml;
        updatedDocs['_rels/.rels'] = relsXml;

        return updatedDocs;
      }

      const baseDocxEntries =
        !this.options.fileSource && !Array.isArray(this.options.content)
          ? await this.#getBaseDocxEntriesForExport()
          : this.options.content;

      const result = await zipper.updateZip({
        docx: baseDocxEntries,
        updatedDocs: updatedDocs,
        originalDocxFile: this.options.fileSource,
        media,
        fonts,
        isHeadless: this.options.isHeadless,
        compression,
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('exception', { error: err, editor: this });
      console.error(err);
      throw err;
    }
  }

  /**
   * Destroy collaboration provider and ydoc
   */
  #endCollaboration(): void {
    if (!this.options.ydoc) return;
    try {
      console.debug('🔗 [super-editor] Ending collaboration');
      this.options.collaborationProvider?.disconnect?.();
      (this.options.ydoc as { destroy: () => void }).destroy();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('exception', { error: err, editor: this });
      console.error(err);
    }
  }

  // ============================================================================
  // Document Lifecycle API
  // ============================================================================

  /**
   * Open a document in the editor.
   *
   * @param source - Document source:
   *   - `string` - File path (Node.js reads from disk, browser fetches URL)
   *   - `File | Blob` - Browser file object
   *   - `Buffer` - Node.js buffer
   *   - `undefined` - Creates a blank document
   * @param options - Document options (mode, comments, etc.)
   * @returns Promise that resolves when document is loaded
   *
   * @throws {InvalidStateError} If editor is not in 'initialized' or 'closed' state
   * @throws {DocumentLoadError} If document loading fails
   *
   * @example
   * ```typescript
   * const editor = new Editor({ element: myDiv });
   *
   * // Open from file path (Node.js)
   * await editor.open('/path/to/document.docx');
   *
   * // Open from File object (browser)
   * await editor.open(fileInput.files[0]);
   *
   * // Open blank document
   * await editor.open();
   *
   * // Open with options
   * await editor.open('/path/to/doc.docx', { isCommentsEnabled: true });
   * ```
   */
  async open(source?: string | File | Blob | Buffer, options?: OpenOptions): Promise<void> {
    this.#assertState('initialized', 'closed');

    await this.#withState('documentLoading', 'ready', 'closed', async () => {
      await this.#loadDocument(source, options);
    });

    this.emit('documentOpen', { editor: this, sourcePath: this.#sourcePath });
  }

  /**
   * Static factory method for one-liner document opening.
   * Creates an Editor instance and opens the document in one call.
   *
   * Smart defaults enable minimal configuration:
   * - No element/selector → headless mode
   * - No extensions → uses getStarterExtensions() for docx, getRichTextExtensions() for text/html
   * - No mode → defaults to 'docx'
   *
   * @param source - Document source (path, File, Blob, Buffer, or undefined for blank)
   * @param config - Combined editor and document options (all optional)
   * @returns Promise resolving to the ready Editor instance
   *
   * @example
   * ```typescript
   * // Minimal headless usage - just works!
   * const editor = await Editor.open('/path/to/doc.docx');
   *
   * // With options
   * const editor = await Editor.open('/path/to/doc.docx', {
   *   isCommentsEnabled: true,
   * });
   *
   * // With UI element (automatically not headless)
   * const editor = await Editor.open('/path/to/doc.docx', {
   *   element: document.getElementById('editor'),
   * });
   *
   * // Blank document
   * const editor = await Editor.open();
   * ```
   */
  static async open(
    source?: string | File | Blob | Buffer,
    config?: Partial<EditorOptions> & OpenOptions,
  ): Promise<Editor> {
    // Apply smart defaults
    const hasElement = config?.element != null || config?.selector != null;
    const resolvedConfig: Partial<EditorOptions> & OpenOptions = {
      mode: 'docx',
      isHeadless: !hasElement,
      ...config,
    };

    // Separate editor-level config from document-level options
    const {
      // OpenOptions (document-level)
      html,
      markdown,
      json,
      fragment,
      isCommentsEnabled,
      suppressDefaultDocxStyles,
      documentMode,
      content,
      mediaFiles,
      fonts,
      isNewFile,
      password,
      // Everything else is EditorOptions
      ...editorConfig
    } = resolvedConfig;

    const openOptions: OpenOptions = {
      mode: resolvedConfig.mode as 'docx' | 'text' | 'html',
      html,
      markdown,
      json,
      fragment,
      isCommentsEnabled,
      suppressDefaultDocxStyles,
      documentMode: documentMode as 'editing' | 'viewing' | 'suggesting' | undefined,
      content,
      mediaFiles,
      fonts,
      isNewFile,
      password,
    };

    // Use new API mode for static factory
    const editor = new Editor({ ...editorConfig, deferDocumentLoad: true });
    await editor.open(source, openOptions);
    return editor;
  }

  /**
   * Close the current document.
   *
   * This unloads the document but keeps the editor instance alive.
   * The editor can be reused by calling `open()` again.
   *
   * This method is idempotent - calling it when already closed is a no-op.
   *
   * @example
   * ```typescript
   * await editor.open('/doc1.docx');
   * // ... work with document ...
   * editor.close();
   *
   * await editor.open('/doc2.docx');  // Reuse the same editor
   * ```
   */
  close(): void {
    // Idempotent: calling close() when already closed is a no-op
    if (this.#editorLifecycleState === 'closed' || this.#editorLifecycleState === 'initialized') {
      return;
    }

    if (this.#editorLifecycleState === 'destroyed') {
      return;
    }

    this.#assertState('ready');
    this.emit('documentClose', { editor: this });
    this.#unloadDocument();
    this.#documentApi = null;
    this.#editorLifecycleState = 'closed';
  }

  /**
   * Save the document to the original source path.
   *
   * Only works if the document was opened from a file path.
   * If opened from Blob/Buffer or created blank, use `saveTo()` or `exportDocument()`.
   *
   * @param options - Save options (comments, final doc, etc.)
   * @throws {InvalidStateError} If editor is not in 'ready' state
   * @throws {NoSourcePathError} If no source path is available
   * @throws {FileSystemNotAvailableError} If file system access is not available
   *
   * @example
   * ```typescript
   * const editor = await Editor.open('/path/to/doc.docx');
   * // ... make changes ...
   * await editor.save();  // Saves back to /path/to/doc.docx
   * ```
   */
  async save(options?: SaveOptions): Promise<void> {
    this.#assertState('ready');

    if (!this.#sourcePath) {
      throw new NoSourcePathError('No source path. Use saveTo(path) or exportDocument() instead.');
    }

    await this.#withState('saving', 'ready', 'ready', async () => {
      const data = await this.exportDocument(options);
      await this.#writeToPath(this.#sourcePath!, data);
    });
  }

  /**
   * Save the document to a specific path.
   *
   * Updates the source path to the new location after saving.
   *
   * @param path - File path to save to
   * @param options - Save options
   * @throws {InvalidStateError} If editor is not in 'ready' state
   * @throws {FileSystemNotAvailableError} If file system access is not available
   *
   * @example
   * ```typescript
   * const editor = await Editor.open(blobData);  // No source path
   * await editor.saveTo('/path/to/new-doc.docx');
   * await editor.save();  // Now saves to /path/to/new-doc.docx
   * ```
   */
  async saveTo(path: string, options?: SaveOptions): Promise<void> {
    this.#assertState('ready');

    await this.#withState('saving', 'ready', 'ready', async () => {
      const data = await this.exportDocument(options);
      await this.#writeToPath(path, data);
      this.#sourcePath = path;
    });
  }

  /**
   * Export the document as a Blob or Buffer.
   *
   * This is a convenience wrapper around `exportDocx()` that returns
   * the document data without writing to a file.
   *
   * @param options - Export options
   * @returns Promise resolving to Blob (browser) or Buffer (Node.js)
   * @throws {InvalidStateError} If editor is not in 'ready' state
   *
   * @example
   * ```typescript
   * const blob = await editor.exportDocument();
   *
   * // Create download link in browser
   * const url = URL.createObjectURL(blob);
   * const a = document.createElement('a');
   * a.href = url;
   * a.download = 'document.docx';
   * a.click();
   * ```
   */
  async exportDocument(options?: ExportOptions): Promise<Blob | Buffer> {
    // Allow exporting from 'ready' or 'saving' state (saving calls exportDocument internally)
    this.#assertState('ready', 'saving');

    const result = await this.exportDocx({
      isFinalDoc: options?.isFinalDoc,
      commentsType: options?.commentsType,
      comments: options?.comments,
      fieldsHighlightColor: options?.fieldsHighlightColor,
      compression: options?.compression,
    });

    return result as Blob | Buffer;
  }

  /**
   * Writes document data to a file path.
   *
   * **Browser behavior:**
   * In browsers, the `path` parameter is only used as a suggested filename.
   * The File System Access API shows a save dialog and the user chooses the actual location.
   *
   * **Node.js behavior:**
   * The path is an actual filesystem path, written directly.
   */
  async #writeToPath(path: string, data: Blob | Buffer): Promise<void> {
    // Detect Node.js environment more reliably
    const isNode =
      typeof globalThis !== 'undefined' &&
      typeof globalThis.process !== 'undefined' &&
      globalThis.process.versions?.node != null;

    // Also check for Buffer which is Node.js specific
    const hasNodeBuffer = typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function';

    if (isNode || hasNodeBuffer) {
      try {
        // Dynamic require to avoid bundler issues
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs') as typeof import('fs');
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(await (data as Blob).arrayBuffer());
        fs.writeFileSync(path, buffer);
        return;
      } catch {
        // Fall through to browser methods if require fails
      }
    }

    // Browser with File System Access API
    // NOTE: path is only used as suggestedName; user picks actual location via dialog
    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      const handle = await (
        window as Window & { showSaveFilePicker: (options: unknown) => Promise<FileSystemFileHandle> }
      ).showSaveFilePicker({
        suggestedName: path.split('/').pop() || 'document.docx',
        types: [
          {
            description: 'Word Document',
            accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(data as Blob);
      await writable.close();
      return;
    }

    // Browser without File System Access API
    throw new FileSystemNotAvailableError(
      'File System Access API not available. Use exportDocument() to get the document data and handle the download manually.',
    );
  }

  /**
   * Destroy the editor and clean up resources
   */
  destroy(): void {
    // Close document if open
    if (this.#editorLifecycleState === 'ready') {
      this.close();
    }

    // Already destroyed - idempotent
    if (this.#editorLifecycleState === 'destroyed') {
      return;
    }

    this.#isDestroyed = true;
    this.emit('destroy');

    this.unmount();

    this.destroyHeaderFooterEditors();
    this.#endCollaboration();
    this.removeAllListeners();

    // Clear references
    this.extensionService = undefined!;
    this.schema = undefined!;
    this.#commandService = undefined!;
    this.#documentApi = null;

    this.#editorLifecycleState = 'destroyed';
  }

  destroyHeaderFooterEditors(): void {
    try {
      const headerEditors = this.converter?.headerEditors ?? [];
      const footerEditors = this.converter?.footerEditors ?? [];
      if (!headerEditors.length && !footerEditors.length) return;

      const editors = [...headerEditors, ...footerEditors].filter(Boolean);
      for (const editorData of editors) {
        editorData?.editor?.destroy?.();
      }
      if (headerEditors.length) headerEditors.length = 0;
      if (footerEditors.length) footerEditors.length = 0;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('exception', { error: err, editor: this });
      console.error(err);
    }
  }

  /**
   * Check if migrations are needed for the data
   */
  static checkIfMigrationsNeeded(): boolean {
    const dataVersion = version ?? 'initial';
    const migrations = getNecessaryMigrations(dataVersion) || [];
    console.debug('[checkVersionMigrations] Migrations needed:', dataVersion, migrations.length);
    return migrations.length > 0;
  }

  /**
   * Process collaboration migrations
   */
  processCollaborationMigrations(): unknown | void {
    console.debug('[checkVersionMigrations] Current editor version', CURRENT_APP_VERSION);
    if (!this.options.ydoc) return;

    const metaMap = (this.options.ydoc as { getMap: (name: string) => Map<string, unknown> }).getMap('meta');
    let docVersion = metaMap.get('version');
    if (!docVersion) docVersion = 'initial';
    console.debug('[checkVersionMigrations] Document version', docVersion);
    const migrations = getNecessaryMigrations(docVersion) || [];

    const plugins = this.state.plugins;
    const syncPlugin = plugins.find((plugin) => this.#getPluginKeyName(plugin).startsWith('y-sync'));
    if (!syncPlugin) return this.options.ydoc;

    let hasRunMigrations = false;
    for (const migration of migrations) {
      console.debug('🏃‍♂️ Running migration', migration.name);
      const result = migration(this);
      if (!result) throw new Error('Migration failed at ' + migration.name);
      else hasRunMigrations = true;
    }

    // If no migrations were run, return undefined (no updated ydoc).
    if (!hasRunMigrations) return;

    // Return the updated ydoc
    const pluginState = syncPlugin?.getState(this.state);
    return pluginState.doc;
  }

  /**
   * Replace the current file
   */
  async replaceFile(newFile: File | Blob | Buffer | ArrayBuffer, options?: { password?: string }): Promise<void> {
    this.setOptions({ annotations: true });
    const [docx, media, mediaFiles, fonts, decryptedData] = (await Editor.loadXmlData(newFile, false, options))!;
    this.setOptions({
      fileSource: decryptedData ?? (newFile instanceof ArrayBuffer ? new Blob([newFile]) : newFile),
      content: docx,
      media,
      mediaFiles,
      fonts,
      isNewFile: true,
    });
    this.options.shouldLoadComments = true;
    this.options.replacedFile = true;

    this.#createConverter();
    initPartsRuntime(this);
    this.#initMedia();
    this.initDefaultStyles();

    if (this.options.ydoc && this.options.collaborationProvider) {
      const ydoc = this.options.ydoc as import('yjs').Doc;
      const provider = this.options.collaborationProvider;

      const doReplaceFileSync = () => {
        // 1. Insert new PM doc into Y fragment (must happen first)
        this.options.fragment = null;
        this.#insertNewFileData();

        // 2. Seed parts from new converter snapshot (prunes stale parts)
        seedPartsFromEditor(this, ydoc, { replaceExisting: true });

        // 3. Replace media map (prune stale + upsert new)
        const mediaFiles = this.options.mediaFiles ?? {};
        const mediaMap = ydoc.getMap('media');
        for (const key of mediaMap.keys()) {
          if (!(key in mediaFiles)) mediaMap.delete(key);
        }
        Object.entries(mediaFiles).forEach(([key, value]) => {
          mediaMap.set(key, value);
        });
      };

      const SYNC_TIMEOUT_MS = 10_000;

      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;

        const cleanup = onCollaborationProviderSynced(provider, () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            doReplaceFileSync();
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        if (!settled) {
          timer = setTimeout(() => {
            settled = true;
            cleanup();
            reject(
              new Error(
                `replaceFile(): collaboration provider did not sync within ${SYNC_TIMEOUT_MS}ms. ` +
                  `The provider exposes on/off but never emitted sync(true) or synced.`,
              ),
            );
          }, SYNC_TIMEOUT_MS);
        }
      });
    } else {
      this.#insertNewFileData();
    }

    if (!this.options.ydoc) {
      this.#initComments();
    }

    // AIDEV-NOTE: In collaboration mode, parts are seeded into Y.Doc directly
    // (not through `mutateParts`), so no `partChanged` fires on this client.
    // Remote tabs refresh via the consumer → `mutateParts` → `partChanged` path,
    // but the importer relies on this signal to rebuild header/footer state
    // bound to the previous document (SD-2643).
    this.emit('documentReplaced', { editor: this });
  }

  /**
   * Get internal docx file content
   * @param name - File name
   * @param type - type of result (json, string)
   */
  getInternalXmlFile(name: string, type: 'json' | 'string' = 'json'): unknown | string | null {
    if (!this.converter.convertedXml[name]) {
      console.warn('Cannot find file in docx');
      return null;
    }

    if (type === 'json') {
      return this.converter.convertedXml[name].elements[0] || null;
    }
    return this.converter.schemaToXml(this.converter.convertedXml[name].elements[0]);
  }

  /**
   * Update internal docx file content
   * @param name - File name
   * @param updatedContent - new file content
   */
  updateInternalXmlFile(name: string, updatedContent: string | unknown): void {
    if (typeof updatedContent === 'string') {
      this.options.customUpdatedFiles![name] = String(updatedContent);
    } else {
      const internalFileXml = this.converter.schemaToXml(updatedContent);
      this.options.customUpdatedFiles![name] = String(internalFileXml);
    }
    this.options.isCustomXmlChanged = true;
  }

  /**
   * Get all nodes of a specific type
   */
  getNodesOfType(type: string): Array<{ node: PmNode; pos: number }> {
    const { findChildren } = helpers;
    return findChildren(this.state.doc, (node: PmNode) => node.type.name === type);
  }

  /**
   * Replace a node with HTML content
   */
  replaceNodeWithHTML(targetNode: { node: PmNode; pos: number }, html: string): void {
    const { tr } = this.state;

    if (!targetNode || !html) return;
    const start = targetNode.pos;
    const end = start + targetNode.node.nodeSize;
    const htmlNode = createDocFromHTML(html, this);
    tr.replaceWith(start, end, htmlNode);
    this.dispatch(tr);
  }

  /**
   * A command to prepare the editor to receive annotations. This will
   * pre-process the document as needed prior to running in the annotator.
   *
   * Currently this is only used for table generation but additional pre-processing can be done here.
   */
  prepareForAnnotations(annotationValues: FieldValue[] = []): void {
    const { tr } = this.state;
    const newTr = AnnotatorHelpers.processTables({ state: this.state, tr, annotationValues });
    this.dispatch(newTr);
  }

  /**
   * Migrate paragraph fields to lists V2 structure if necessary.
   * @param annotationValues - List of field values to migrate.
   * @returns Returns a promise that resolves to the migrated values
   */
  async migrateParagraphFields(annotationValues: FieldValue[] = []): Promise<FieldValue[]> {
    if (!Array.isArray(annotationValues) || !annotationValues.length) return annotationValues;
    const result = await migrateParagraphFieldsListsV2(annotationValues, this);
    return result;
  }

  /**
   * Annotate the document with the given annotation values.
   */
  annotate(annotationValues: FieldValue[] = [], hiddenIds: string[] = [], removeEmptyFields: boolean = false): void {
    const { state, schema } = this;
    let tr = state.tr;

    tr = AnnotatorHelpers.processTables({ state: this.state, tr, annotationValues });
    tr = AnnotatorHelpers.annotateDocument({
      tr,
      schema,
      annotationValues,
      hiddenFieldIds: hiddenIds,
      removeEmptyFields,
      editor: this,
    });

    // Dispatch everything in a single transaction, which makes this undo-able in a single undo
    if (tr.docChanged) {
      const finalTr = tr.scrollIntoView();
      this.dispatch(finalTr);
    }
  }

  /**
   * Preview annotations in the editor. It stores a copy of the original state.
   * This can be reverted via closePreview()
   */
  previewAnnotations(annotationValues: FieldValue[] = [], hiddenIds: string[] = []): void {
    this.originalState = this.state;
    this.annotate(annotationValues, hiddenIds);
  }

  /**
   * If there is a preview active, this will revert the editor to the original state.
   */
  closePreview(): void {
    if (!this.originalState) return;
    if (this.view) {
      this.view.updateState(this.originalState);
    } else {
      this._state = this.originalState;
    }
  }

  /**
   * Run the SuperValidator's active document validation to check and fix potential known issues.
   */
  #validateDocumentInit(): void {
    if (this.options.isHeaderOrFooter || this.options.isChildEditor) return;

    const validator = new SuperValidator({ editor: this, dryRun: false, debug: false });
    validator.validateActiveDocument();
  }

  /**
   * Run the SuperValidator's on document upon export to check and fix potential known issues.
   */
  #validateDocumentExport(): void {
    if (this.options.isHeaderOrFooter || this.options.isChildEditor) return;

    const validator = new SuperValidator({ editor: this, dryRun: false, debug: false });
    validator.validateDocumentExport();
  }

  #initDevTools(): void {
    this.#renderer?.initDevTools?.(this);
  }
}
