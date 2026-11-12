import {
  PARAGRAPH_BATCH_MAX_TARGETS,
  PARAGRAPH_BATCH_MAX_EXPANDED_WRITES,
  PARAGRAPH_BATCH_MAX_PAYLOAD_BYTES,
  type DocumentApiCapabilities,
  type ParagraphBatchOperation,
  type SDRunProps,
} from '@superdoc/document-api';
import { readViewportBatch } from './viewport-batch.js';
import { readBuiltInTrackedChangePermissionPolicy } from '../../core/collaboration/permissions.js';
import { beginInteraction, recordInteraction } from '../../internal/diagnostics/interaction-history.js';
/**
 * v2-native `createSuperDocUI` controller.
 *
 * A small, truthful layer over the public v2 active-editor facade
 * (`superdoc.activeEditor`), its read-only-guarded Document API
 * (`activeEditor.doc`), and SuperDoc lifecycle events. No v1 editor imports,
 * no private v2 runtime imports. In browser mode the underlying Document API
 * facade is async-capable, so the controller normalizes it into live slices
 * plus promise-capable workflow helpers. Every document read/mutation is
 * attempted through the public Document API and degrades to a stable noop /
 * `false` when the surface is unavailable (view mode, a pre-ready editor, or a
 * host that has not exposed a Document API facade) rather than throwing.
 */

import { shallowEqual } from './equality.js';
import { createWatermarkController } from './watermark-controller.js';
import { captureParagraphPaintOperations } from './format-painter-paragraph.js';
import { sdRunPropsToInlineRunPatch, selectionKey } from './format-painter-helpers.js';
import {
  getV2TrackedChangeMutationImpact,
  mutationCommittedEventChangedDocument,
  mutationCommittedEventChangedVisibleContent,
} from '../../helpers/v2-review-mutation-impact.js';
import { isV2EditableTextMutationEvent } from '../../helpers/v2-typing-mutation-event.js';
import { isSyntheticTrackedChangeCommentLaneItem } from '../../helpers/tracked-change-comment-lane.js';
import { ALL_BUILT_IN_COMMAND_IDS, getCommandDescriptor, type CommandDescriptor, type UiDocRoute } from './commands.js';
import { SUPERDOC_UI_REASONS, type SuperDocUIReason } from './reasons.js';
import { remoteChangeRecordsOf, remoteDocumentChange } from './document-change-records.js';
import type { ChangeRecord } from '@superdoc/document-api';
import type {
  CommandHandle,
  CommandExecutionResult,
  CommandState,
  CommandsHandle,
  FormatPainterHandle,
  CommentInfo,
  CommentsHandle,
  CommentsSlice,
  ContextMenuItem,
  ContentControlInfo,
  BookmarksHandle,
  BookmarkAddress,
  ContentControlsSlice,
  ContextMenuHandle,
  CustomCommandContext,
  CustomCommandHandle,
  CustomCommandRegistration,
  CustomCommandRegistrationResult,
  DocumentHandle,
  DocumentSlice,
  DocumentVersion,
  SuperDocDocumentChange,
  EqualityFn,
  FontsHandle,
  FontsSlice,
  SelectionInfo,
  SelectionHandle,
  SelectionSlice,
  SliceStatus,
  ReviewAnalysisProgress,
  SelectorFn,
  SelectionCapture,
  SelectionRestoreResult,
  SelectionTarget,
  ScrollIntoViewInput,
  ScrollIntoViewOutput,
  TextAddress,
  TextTarget,
  SnapshotSubscribable,
  Subscribable,
  SuperDocUI,
  SuperDocUIOptions,
  SuperDocUIScope,
  SuperDocUIState,
  TablesHandle,
  TableContextInfo,
  ToolbarHandle,
  TrackChangeInfo,
  TrackChangePointHit,
  TrackChangesHandle,
  TrackChangesItem,
  TrackChangesSlice,
  ViewportContext,
  ViewportEntityAddress,
  ViewportEntityHit,
  ViewportGetRectInput,
  ViewportPositionAtInput,
  ViewportPositionAtResult,
  MetadataHandle,
  Receipt,
  SuperDocUIFailureReceipt,
  SuperDocUIReceipt,
  ViewportHandle,
  DecorationsHandle,
  DecorationPointerEvent,
  ViewportRect,
  ViewportRectResult,
  WorkflowActionResult,
  WorkflowReceipt,
  WorkflowScrollResult,
  ZoomHandle,
  ZoomSlice,
  HistoryHandle,
  HistorySlice,
} from './types.js';
import { collectDecorationProvidersFromChain, collectEntityHitsFromChain } from './entity-at.js';

import { getParagraphInlineDirection } from '@superdoc/contracts';
import { isPlainObject } from '../../helpers/object-guards.js';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import type { SurfaceHandle } from '../../core/types/index.js';
import { type TextSegment } from '@superdoc/document-api';
import type { AnyFn, LooseRecord } from './loose-record.js';
import {
  CLEAR_INLINE_PATCH,
  EFFECTIVE_MARK_KEYS,
  TRACKED_CLEAR_INLINE_PATCH,
  buildInlineFormatInput,
  collectProjectionTextBlocks,
  inlineFormatMethod,
  isProjectedInlineSelectionValueKey,
  normalizeLayoutFontFamily,
  normalizeLayoutFontSizePt,
  normalizeOptimisticInlineSelectionValue,
  pickSelectionTextQueryItem,
  projectInlineValuesFromQueryItem,
  projectionBlockMatchesId,
  projectionRunSelectionLength,
  readEffectiveInlineUniformityStates,
  selectionEffectiveUniformitySignature,
  selectionInlineValueSignature,
  selectionStoryLocator,
  selectionTextSegments,
  type EffectiveInlineUniformityState,
  type EffectiveMarkKey,
  type EffectiveMarkValues,
  type OptimisticInlineSelectionValue,
  type OptimisticInlineToggle,
  type OptimisticParagraphAlignment,
  type PendingInlineToggleMutation,
  type ProjectedInlineSelectionValueKey,
  type ProjectedInlineSelectionValues,
} from './inline-values.js';
import {
  FORMAT_PAINTER_BOOLEAN_KEYS,
  type FormatPainterMode,
  type FormatPainterParagraphSnapshot,
  type FormatPainterSnapshot,
  type FormatPainterState,
} from './format-painter-state.js';
import {
  MIRRORED_EDIT_COMMAND_IDS,
  coerceSuperDocUIReason,
  combineCommandResults,
  commandIsActive,
  commandResultFromOperationResult,
  commandResultSucceeded,
  failedReceipt,
  hasAbortedFlag,
  hostMethod,
  isPromiseLike,
  isSuccessfulReceipt,
  listToggleKind,
  normalizeCommandState,
  normalizeHostSelectionApplyResult,
  partialLinkEditFailure,
  presetFromToolbarStyleKey,
  rectFailure,
  rectResult,
  relativizeRects,
  resolveDocOperation,
  safeCall,
  trackDecisionCommand,
} from './command-results.js';
import {
  PARAGRAPH_INDENT_STEP_TWIPS,
  buildTableCommandInput,
  readMergeRange,
  readParagraphIndentationFromResult,
  type ParagraphIndentationTwips,
  type ResolvedTableContext,
} from './block-commands.js';
import {
  entityRowMatchesRequest,
  isHostGeometryTarget,
  layoutStoryDatasetToStoryLocator,
  readEntityId,
  readEntityRequestStory,
  readEntityStory,
  readEntityTarget,
  readTrackedChangeNavigationTarget,
  storyKeyToStoryLocator,
  storyLocatorSignature,
} from './entity-rows.js';
import {
  acquireSharedUiTrackedChangesCatalog,
  releaseSharedUiTrackedChangesCatalog,
} from './shared-tracked-changes-catalog.js';
import {
  buildStoryScopedTrackedChangeIdContext,
  buildTrackedChangeIdContext,
  isNonCollapsedHostSelection,
  isTextboxStory,
  readCollapsedHostTrackChangeId,
  resolveActiveCommentId,
  resolveSelectionActiveChangeId,
  trackChangesItemPayload,
  trackedChangeOwnedByCurrentUser,
  type SelectionTrackDecisionPlan,
} from './tracked-change-ids.js';
import { emitUiBenchTiming, readUiBenchRuntime, uiBenchNowMs } from './ui-bench-timing.js';
import { createAsyncReadCache, type AsyncReadEntry } from './async-read-cache.js';
import { COMMENTS_CATALOG_PART_URIS, combineStatus } from './heavy-read-policy.js';
import { createHeavyReadGate, HEAVY_READ_IDLE_POLL_MS, type DirectoryFamily } from './heavy-read-gate.js';
import {
  EMPTY_SELECTION,
  canProbeEverySelectedBlock,
  capturedTableCellTarget,
  collapsedTextAddressFromSelection,
  collapsedTextAddressFromTarget,
  createLocationAt,
  hyperlinkAddressToSelectionTarget,
  hyperlinkTargetFromHref,
  isHeaderFooterCaret,
  listItemTarget,
  listsBlockTarget,
  paragraphTarget,
  resolveInlineSelectionTarget,
  selectionTouchesDeletedText,
  selectionHasOnlyDeletedText,
  selectionBlockIds,
  selectionBlockRange,
  selectionStory,
  selectionTargetForRestore,
  selectionTextAddresses,
  selectionTargetFromTextTarget,
  textAddressesFromTarget,
  textTargetSegments,
  type CellSelectionCapture,
  type TextSelectionTarget,
} from './selection-targets.js';
import {
  DEFAULT_FONT_SIZE_OPTIONS,
  composeFontFamilyOptions,
  normalizeDocumentFontOptions,
  normalizePickerFontOptions,
} from './font-options.js';
import { HOST_EVENTS } from './host-events.js';
import { createContentControlsHandle } from './content-controls-handle.js';
import { createSearchHandle } from './search-handle.js';
import { createStyleReads, createStylesHandle, documentDefaultParagraphStyleId } from './styles-handle.js';

type FirstPartyCommandMutation = {
  selectionReader?: {
    capture: () => { read: () => Promise<unknown>; isCurrent: (info: unknown) => boolean } | null;
  };
  supports: (memberPath: string) => boolean;
  run: (memberPath: string, args: readonly unknown[]) => unknown;
  runListApply: (input: unknown) => Promise<unknown>;
};

const firstPartyCommandMutations = new WeakMap<object, WeakMap<object, FirstPartyCommandMutation>>();
const firstPartyCommandExecutors = new WeakMap<
  object,
  (id: string, payload?: unknown, requireEnabled?: boolean) => Promise<CommandExecutionResult>
>();

export function registerFirstPartyCommandMutation(
  superdoc: object,
  host: object,
  mutation: FirstPartyCommandMutation,
): void {
  let hosts = firstPartyCommandMutations.get(superdoc);
  if (!hosts) {
    hosts = new WeakMap();
    firstPartyCommandMutations.set(superdoc, hosts);
  }
  hosts.set(host, mutation);
}

const firstPartyPageNumberReaders = new WeakMap<object, () => Promise<unknown>>();

/**
 * Read the page numbers of the caret's section for the built-in popover. Resolves
 * null when the controller has no page-number support or no section yet.
 */
export function readFirstPartyPageNumbers(ui: object): Promise<unknown> {
  return firstPartyPageNumberReaders.get(ui)?.() ?? Promise.resolve(null);
}

export function executeFirstPartyCommandAsync(
  ui: Pick<SuperDocUI, 'commands'>,
  id: string,
  payload?: unknown,
): Promise<CommandExecutionResult> {
  return firstPartyCommandExecutors.get(ui)?.(id, payload) ?? ui.commands.executeAsync(id, payload);
}

export function executeFirstPartyShortcutAsync(
  ui: object,
  id: string,
  payload?: unknown,
): Promise<CommandExecutionResult> {
  return firstPartyCommandExecutors.get(ui)?.(id, payload, true) ?? Promise.resolve(false);
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

type DocumentChangeFacts = Omit<SuperDocDocumentChange, 'documentEpoch' | 'seq'>;

function readTxId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function documentChangeScope(stories: unknown): SuperDocDocumentChange['scope'] {
  return Array.isArray(stories) && stories.length > 0
    ? { kind: 'known', stories: stories as Extract<SuperDocDocumentChange['scope'], { kind: 'known' }>['stories'] }
    : { kind: 'unknown' };
}

function documentChangeFromHostEvent(event: LooseRecord): DocumentChangeFacts | null {
  if (event.type !== 'mutation:committed') return null;
  if (event.origin === 'history') {
    const result = isPlainObject(event.result) ? event.result : null;
    if (!result || result.noop === true) return null;
    const history = isPlainObject(result.history) ? result.history : null;
    return {
      cause: event.direction === 'redo' ? 'redo' : 'undo',
      changeTag: null,
      txId: readTxId(history?.txId),
      scope: documentChangeScope(result.affectedStories),
    };
  }
  if (!mutationCommittedEventChangedDocument(event)) return null;
  const receipt = isPlainObject(event.receipt) ? event.receipt : {};
  return {
    cause: event.cause === 'user' ? 'user' : 'api',
    changeTag: typeof receipt.changeTag === 'string' ? receipt.changeTag : null,
    txId: readTxId(receipt.txId),
    scope: documentChangeScope(receipt.affectedStories),
  };
}

function projectTrackChangesItem(item: unknown): TrackChangesItem | null {
  if (!isPlainObject(item)) return null;
  const change = isPlainObject(item.change) ? item.change : item;
  const projected: Record<string, unknown> = { ...item, id: item.id ?? change.id, change };
  return projected as unknown as TrackChangesItem;
}

const FRAME_RECOMPUTE_FALLBACK_MS = 100;

export function createSuperDocUI(options: SuperDocUIOptions): SuperDocUI {
  const superdoc = options.superdoc as unknown as LooseRecord;
  const optimisticInlineValues = new Map<ProjectedInlineSelectionValueKey, OptimisticInlineSelectionValue>();
  const optimisticInlineToggles = new Map<string, OptimisticInlineToggle>();
  let optimisticParagraphAlignment: OptimisticParagraphAlignment | null = null;
  let optimisticParagraphAlignmentGeneration = 0;
  const pendingInlineToggleMutations: PendingInlineToggleMutation[] = [];
  let lastOptimisticInlineSelectionSignature: string | null = null;
  let optimisticInlineToggleGeneration = 0;
  let inlineToggleMutationActive = false;
  let inlineToggleMutationIdle: Promise<void> = Promise.resolve();
  let resolveInlineToggleMutationIdle: (() => void) | null = null;

  let painter: FormatPainterState = {
    mode: 'idle',
    snapshot: null,
    sourceSelectionKey: null,
    lastClickAt: 0,
    pointerSelecting: false,
    keyboardSelecting: false,
  };
  const paintedInlineTargets = new WeakSet<object>();
  let painterCaptureEpoch = 0;
  let painterCommandDoc: LooseRecord | null = null;
  const painterModeListeners = new Set<(mode: FormatPainterMode) => void>();
  // Projected inline values frozen at the last settled, non-empty selection recompute,
  // paired with the selection key they were computed for. captureFormatPainter uses
  // them only when the key matches the current source selection, guarding against
  // stale values from an unrelated earlier selection.
  let frozenProjectedValues: ProjectedInlineSelectionValues = {};
  let frozenProjectedValuesKey = '';
  let heldSettledInlineValues: { key: string; values: ProjectedInlineSelectionValues } | null = null;

  /** Read the live active editor (or null). */
  const getEditor = (): LooseRecord | null => {
    const editor = superdoc?.activeEditor;
    return editor && typeof editor === 'object' ? (editor as LooseRecord) : null;
  };

  const contextMenu: ContextMenuHandle = {
    open: (): WorkflowActionResult => {
      if (disposed) return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      const editor = getEditor();
      if (!editor) return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      const open = hostMethod(editor.contextMenu, 'open');
      if (!open) {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      try {
        const result = open();
        if (isPlainObject(result) && result.ok === false) {
          return {
            ok: false,
            reason: coerceSuperDocUIReason(result.reason, SUPERDOC_UI_REASONS.operationUnavailable),
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
    },
    close: (): void => {
      if (disposed) return;
      const close = hostMethod(getEditor()?.contextMenu, 'close');
      if (!close) return;
      try {
        close();
      } catch {
        // Closing an unavailable surface is intentionally idempotent.
      }
    },
    contextAt,
  };

  let firstPartyCommandDoc: LooseRecord | null | undefined;

  /** Read the live browser Document API facade (or null). */
  const getDoc = (): LooseRecord | null => {
    if (firstPartyCommandDoc !== undefined) return firstPartyCommandDoc;
    const editor = getEditor();
    const doc = editor?.doc;
    return doc && typeof doc === 'object' ? (doc as LooseRecord) : null;
  };

  /** Read the live v2 tracked-change facade, when exposed. */
  const getV2TrackedChanges = (): LooseRecord | null => {
    const editor = getEditor();
    const trackedChanges = editor?.v2TrackedChanges;
    return trackedChanges && typeof trackedChanges === 'object' ? (trackedChanges as LooseRecord) : null;
  };

  /** Read the committed V2 page-window review feed (never a document catalog). */
  const getV2ReviewWindowSource = (): LooseRecord | null => {
    const editor = getEditor();
    if (editor?.editorVersion !== 2) return null;
    const reviewWindow = editor.reviewWindow;
    return reviewWindow && typeof reviewWindow === 'object' ? (reviewWindow as LooseRecord) : null;
  };

  const getV2ReviewWindowSnapshot = (): LooseRecord | null => {
    const getSnapshot = hostMethod(getV2ReviewWindowSource(), 'getSnapshot');
    if (!getSnapshot) return null;
    const snapshot = safeCall<unknown>(() => getSnapshot(), null);
    return isPlainObject(snapshot) ? snapshot : null;
  };

  const hasV2ReviewWindowFeed = (): boolean => typeof getV2ReviewWindowSource()?.getSnapshot === 'function';

  const reviewWindowSliceStatus = (snapshot: LooseRecord | null): SliceStatus => {
    const status = snapshot?.status;
    return status === 'ready' || status === 'stale' ? status : 'pending';
  };
  const reviewWindowAnalysis = (snapshot: LooseRecord | null): ReviewAnalysisProgress | null => {
    const analysis = snapshot?.analysis;
    if (!isPlainObject(analysis)) return null;
    const done = analysis.done;
    const total = analysis.total;
    if (typeof done !== 'number' || typeof total !== 'number' || total <= 0) return null;
    return { done, total, stage: typeof analysis.stage === 'string' ? analysis.stage : null };
  };

  /** Read the live v2 editor host (inline mode only), when exposed. */
  const getHost = (): LooseRecord | null => {
    const editor = getEditor();
    const host = editor?.host;
    return host && typeof host === 'object' ? (host as LooseRecord) : null;
  };

  /**
   * The host selection snapshot a selection read, slice, or capture was
   * resolved from. The host replaces its snapshot object on every selection
   * change, so an identical object means the selection has not moved since.
   */
  const selectionHostSnapshots = new WeakMap<object, object>();
  const reviewWarmingSelections = new WeakSet<SelectionSlice>();
  const selectionInfoReviewWarming = (info: SelectionInfo): boolean => Reflect.get(info, 'reviewWarming') === true;
  let wholeTableParagraphSeed: {
    editor: LooseRecord;
    host: LooseRecord;
    doc: unknown;
    mount: unknown;
    lifetime: { readonly aborted: boolean };
    sourceToken: string;
    mode: string;
    info: SelectionInfo;
    nativeSelection: object | null;
  } | null = null;
  const readHostSelectionSnapshot = (): object | null => {
    const handles = safeCall<unknown>(() => hostMethod(getHost(), 'getHandles')?.() ?? null, null);
    const editing = isPlainObject(handles) ? handles.editing : undefined;
    const getSnapshot =
      hostMethod(isPlainObject(editing) ? editing.selection : undefined, 'getSnapshot') ??
      hostMethod(isPlainObject(handles) ? handles.selection : undefined, 'getSnapshot');
    if (!getSnapshot) return null;
    const snapshot = safeCall<unknown>(() => getSnapshot(), null);
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
  };

  const createFirstPartyCommandDoc = (): LooseRecord | null => {
    const editor = getEditor();
    const doc = editor?.doc as LooseRecord | null;
    if (editor?.editorVersion !== 2) return doc;
    const host = getHost();
    const mutation = host ? firstPartyCommandMutations.get(superdoc)?.get(host) : null;
    if (!doc || !host || !mutation) return null;
    const wrap = (source: LooseRecord, prefix: string): LooseRecord =>
      new Proxy(source, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (typeof key !== 'string') return value;
          const memberPath = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'function' && mutation.supports(memberPath)) {
            return (...args: unknown[]) => {
              if (getEditor() !== editor || getHost() !== host || editor.doc !== doc) return false;
              return mutation.run(memberPath, args);
            };
          }
          return value && (typeof value === 'object' || typeof value === 'function')
            ? wrap(value as LooseRecord, memberPath)
            : value;
        },
      });
    return wrap(doc, '');
  };

  const resolveActiveHeaderFooterSlot = (story: LooseRecord): LooseRecord | null => {
    if (story.storyType !== 'headerFooterPart' || typeof story.refId !== 'string') return null;
    const editor = getEditor();
    const host = getHost();
    const pageLayout = editor?.pageLayout ?? host?.pageLayout;
    if (!pageLayout || typeof pageLayout !== 'object') return null;
    const getActiveRulerContext = (pageLayout as LooseRecord).getActiveRulerContext;
    const resolveEditTarget = host?.resolveHeaderFooterEditTarget;
    if (typeof getActiveRulerContext !== 'function' || typeof resolveEditTarget !== 'function') return null;

    const active = safeCall<LooseRecord | null>(
      () => getActiveRulerContext.call(pageLayout) as LooseRecord | null,
      null,
    );
    if (!active || typeof active.pageIndex !== 'number') return null;

    for (const headerFooterKind of ['header', 'footer'] as const) {
      const resolved = safeCall<LooseRecord | null>(
        () => resolveEditTarget.call(host, { pageIndex: active.pageIndex, kind: headerFooterKind }) as LooseRecord,
        null,
      );
      if (
        resolved?.status !== 'ready' ||
        resolved.refId !== story.refId ||
        typeof resolved.sectionId !== 'string' ||
        !['default', 'first', 'even'].includes(String(resolved.slotVariant))
      ) {
        continue;
      }
      return {
        kind: 'story',
        storyType: 'headerFooterSlot',
        section: { kind: 'section', sectionId: resolved.sectionId },
        headerFooterKind,
        variant: resolved.slotVariant,
      };
    }
    return null;
  };

  /** Read the host's stored inline marks (SD-3654/SD-3652), when any pending. */
  const readPendingInlineFormat = (): LooseRecord | null => {
    const host = getHost();
    const fn = host?.getPendingInlineFormat;
    if (typeof fn !== 'function') return null;
    const pending = safeCall<LooseRecord | null>(() => fn.call(host), null);
    return pending && typeof pending === 'object' ? (pending as LooseRecord) : null;
  };

  /**
   * Active state contributed by a stored inline mark for this command, or null
   * when nothing is pending for it (SD-3654). Only meaningful for a collapsed
   * caret; the store is cleared on any selection move, so a range never has one.
   */
  const pendingInlineActive = (descriptor: CommandDescriptor): boolean | null => {
    const method = inlineFormatMethod(descriptor);
    if (!method) return null;
    const pending = readPendingInlineFormat();
    if (!pending || !(method in pending)) return null;
    const value = pending[method];
    if (descriptor.inline?.kind === 'toggle') return value === true;
    return value != null && value !== '';
  };

  /** The pending caret font/size value for this command's `format.*` method, if any (SD-3652). */
  const pendingInlineValueFor = (descriptor: CommandDescriptor): string | undefined => {
    const method = inlineFormatMethod(descriptor);
    if (!method) return undefined;
    const pending = readPendingInlineFormat();
    if (!pending || !(method in pending)) return undefined;
    const value = pending[method];
    if (typeof value === 'string' && value !== '') return value;
    if (isFiniteNumber(value)) return String(value);
    return undefined;
  };

  /** Record / clear the stored inline mark for a collapsed-caret pick (SD-3654/SD-3652). */
  const setPendingInlineFormatOnHost = (method: string, value: boolean | string | number | null): void => {
    const host = getHost();
    const fn = host?.setPendingInlineFormat;
    if (typeof fn === 'function') safeCall(() => fn.call(host, method, value), undefined);
  };

  const clearPendingInlineFormatOnHost = (method?: string): void => {
    const host = getHost();
    const fn = host?.clearPendingInlineFormat;
    if (typeof fn === 'function') safeCall(() => fn.call(host, method), undefined);
  };

  /** Inline `format.*` methods whose active state is a boolean mark (name === method). */
  const BOOLEAN_INLINE_FORMAT_METHODS: ReadonlySet<string> = new Set(['bold', 'italic', 'underline', 'strikethrough']);

  /**
   * Retire a stored inline mark (SD-3654/SD-3652) once the selection's own
   * formatting has caught up to it: a boolean mark when the live activeMarks
   * match, a font/size when the projection matches. Runs each recompute so the
   * toolbar hands off from "pending" to the real marks/value without a gap.
   */
  const reconcilePendingInlineFormat = (selection: SelectionSlice): void => {
    const pending = readPendingInlineFormat();
    if (!pending) return;
    const activeMarks = Array.isArray(selection.activeMarks) ? (selection.activeMarks as string[]) : [];
    let projected: ProjectedInlineSelectionValues | null = null;
    for (const method of Object.keys(pending)) {
      const value = pending[method];
      let matched: boolean;
      if (BOOLEAN_INLINE_FORMAT_METHODS.has(method)) {
        // An empty caret omits inactive marks, so absence cannot prove that an
        // explicit off override was consumed. The insert or caret-move path
        // retires it after the authored run carries the override.
        if (value === false) continue;
        matched = activeMarks.includes(method) === (value === true);
      } else if (isProjectedInlineSelectionValueKey(method)) {
        // A pending null value-key ("None") is an explicit clear-on-next-insert.
        // The caret projection can't confirm it (a collapsed caret projects no
        // value, so `current == null` is spuriously true and would retire it
        // before the insert applies it), so leave it for the insert / caret-move
        // paths to retire (SD-3654).
        if (value == null) continue;
        if (!projected) projected = projectSelectionInlineValues(selection);
        const current = projected[method];
        matched = current === value;
      } else {
        matched = false;
      }
      if (matched) clearPendingInlineFormatOnHost(method);
    }
  };

  /** Read the live v2 edit-command adapters (`activeEditor.editCommands`), when exposed. */
  const getEditCommands = (): LooseRecord | null => {
    const editor = getEditor();
    const editCommands = editor?.editCommands;
    return editCommands && typeof editCommands === 'object' ? (editCommands as LooseRecord) : null;
  };

  let editCommandReadScope: { source: LooseRecord | null; snapshot: unknown; read: boolean } | null = null;

  const readEditCommandSnapshot = (): unknown => {
    const source = getEditCommands();
    const getSnapshot = hostMethod(source, 'getSnapshot');
    if (!getSnapshot) return null;
    const scope = editCommandReadScope;
    const snap = scope?.read && scope.source === source ? scope.snapshot : safeCall<unknown>(() => getSnapshot(), null);
    if (scope) {
      scope.source = source;
      scope.snapshot = snap;
      scope.read = true;
    }
    return snap;
  };

  /** Read one edit-command snapshot entry (`activeEditor.editCommands.getSnapshot().commands[id]`). */
  const readEditCommandStateEntry = (commandId: string): LooseRecord | null => {
    const snap = readEditCommandSnapshot();
    const commands = isPlainObject(snap) ? snap.commands : undefined;
    const entry = isPlainObject(commands) ? commands[commandId] : undefined;
    return isPlainObject(entry) ? entry : null;
  };

  /** Read the `lists.apply` command state surfaced by the v2 edit-command snapshot. */
  const readListApplyStateEntry = (): LooseRecord | null => {
    return readEditCommandStateEntry('lists.apply');
  };

  /** Read the additive list active state surfaced by the edit-command snapshot. */
  const readListActiveSeed = (entry: LooseRecord | null): 'bullet' | 'ordered' | null => {
    const seed = (entry?.value as LooseRecord | undefined)?.seed;
    return seed === 'bullet' || seed === 'ordered' ? seed : null;
  };

  /** Read the lower host-state entry mirrored into the public `undo` / `redo` ids. */
  const readMirroredEditCommandStateEntry = (commandId: string): LooseRecord | null => {
    const mirrored = (MIRRORED_EDIT_COMMAND_IDS as Record<string, string | undefined>)[commandId];
    return mirrored ? readEditCommandStateEntry(mirrored) : null;
  };

  /**
   * Shared table-context resolution. Reads the V2 host table-context facade
   * (`host.getTableContext()`) — the single public surface that resolves the
   * current selection's enclosing table without private editor internals — and
   * normalizes it to the locator inputs the `tables.*` operations need. Returns
   * `null` when the caret is not inside a table, the host does not expose the
   * facade, or the snapshot is missing the table node id / indices. Both the
   * built-in toolbar authority and custom UIs consume this same resolution.
   */
  const readHostTableContext = (): LooseRecord | null => {
    const getTableContext = hostMethod(getHost(), 'getTableContext');
    if (!getTableContext) return null;
    const snapshot = safeCall<unknown>(() => getTableContext(), null);
    return isPlainObject(snapshot) ? snapshot : null;
  };

  const resolveTableContext = (): ResolvedTableContext | null => {
    const snapshot = readHostTableContext();
    if (!snapshot || snapshot.inTable !== true || (snapshot.status && snapshot.status !== 'ready')) return null;
    const table = snapshot.table as LooseRecord | undefined;
    const tableNodeId = typeof table?.nodeId === 'string' && table.nodeId.length > 0 ? table.nodeId : null;
    if (!tableNodeId) return null;
    const row = snapshot.row as LooseRecord | undefined;
    const column = snapshot.column as LooseRecord | undefined;
    const cell = snapshot.cell as LooseRecord | undefined;
    const rowIndex = typeof row?.index === 'number' && Number.isInteger(row.index) ? row.index : null;
    const columnIndex = typeof column?.index === 'number' && Number.isInteger(column.index) ? column.index : null;
    if (rowIndex == null || columnIndex == null) return null;
    const cellNodeId = typeof cell?.nodeId === 'string' && cell.nodeId.length > 0 ? cell.nodeId : null;
    const range = snapshot.cellRange as LooseRecord | undefined;
    const mergeRange = readMergeRange(range);
    const metadata = snapshot.tableSelection as SelectionInfo['tableSelection'];
    const canMerge = metadata == null || (metadata.selectionMode === 'cells' && metadata.isRectangular === true);
    return { tableNodeId, rowIndex, columnIndex, cellNodeId, mergeRange, canMerge };
  };

  // -- consumer-registered commands -----------------------------------------
  const customCommands = new Map<string, CustomCommandRegistration>();

  // -- authoritative focus state --------------------------------------------
  // An explicit `setActive(id)` or host review target takes precedence over
  // the selection-derived active id so panel navigation and document clicks
  // can drive focus independently of the caret. `next`/`previous` also write
  // here. Cleared when the targeted id leaves the loaded list so focus never
  // points at a stale entity.
  let explicitActiveCommentId: string | null = null;
  // Tracked-change focus carries the optional painted story so a story-scoped
  // occurrence (footnote/header) from `getAt` is validated against the fresh
  // all-story lookup, and an id duplicated across stories stays on the clicked
  // occurrence. The public `activeId` stays the simple id.
  type ExplicitActiveChange = { id: string; story?: unknown; paintedEntityId?: string };
  let explicitActiveChange: ExplicitActiveChange | null = null;
  let explicitActiveChangeRevision = 0;
  let queuedTrackChangeNavigationInvalidation = 0;
  // Target resolution crosses an async boundary, so every newer focus or
  // reveal invalidates unresolved panel reveals before they can restore stale UI.
  let trackChangeRevealInvalidation = 0;
  // A panel-driven reveal can temporarily unmount the old review carrier
  // before the target window paints. Ignore only that transient host `null`
  // while the exact explicit focus is still driving an in-flight reveal.
  // A non-null host target (for example a document click) still supersedes it.
  const pendingTrackChangeRevealFocuses = new Set<ExplicitActiveChange>();
  const explicitActiveChangesEqual = (
    left: ExplicitActiveChange | null,
    right: ExplicitActiveChange | null,
  ): boolean => {
    if (left === right) return true;
    if (!left || !right) return false;
    return (
      left.id === right.id &&
      left.paintedEntityId === right.paintedEntityId &&
      storyLocatorSignature(left.story) === storyLocatorSignature(right.story)
    );
  };
  const hasPendingTrackChangeRevealFocus = (focus: ExplicitActiveChange): boolean =>
    Array.from(pendingTrackChangeRevealFocuses).some((pendingFocus) => explicitActiveChangesEqual(pendingFocus, focus));
  const mirrorReviewFocusToHost = (
    entityType: 'comment' | 'trackedChange',
    next: { id: string; paintedEntityId?: string; story?: unknown } | null,
  ): void => {
    const readHandles = hostMethod(getHost(), 'getHandles');
    if (!readHandles) return;
    const handles = safeCall<unknown>(() => readHandles(), null);
    if (!isPlainObject(handles)) return;
    const review = handles.review;

    if (next) {
      const setActiveReviewTarget = hostMethod(review, 'setActiveReviewTarget');
      if (!setActiveReviewTarget) return;
      const layout = isPlainObject(handles.layout) ? handles.layout : undefined;
      safeCall(
        () =>
          setActiveReviewTarget({
            entityType,
            entityId: next.id,
            ...(next.paintedEntityId ? { paintedEntityId: next.paintedEntityId } : {}),
            origin: 'panel',
            layoutEpoch: typeof layout?.generation === 'number' ? layout.generation : 0,
            ...(entityType === 'trackedChange' ? { story: next.story ?? { kind: 'story', storyType: 'body' } } : {}),
          }),
        null,
      );
      return;
    }

    const getActiveReviewTarget = hostMethod(review, 'getActiveReviewTarget');
    const clearActiveReviewTarget = hostMethod(review, 'clearActiveReviewTarget');
    if (!getActiveReviewTarget || !clearActiveReviewTarget) return;
    const activeTarget = safeCall<unknown>(() => getActiveReviewTarget(), null);
    if (isPlainObject(activeTarget) && activeTarget.entityType === entityType) {
      safeCall(() => clearActiveReviewTarget(), undefined);
    }
  };
  const mirrorTrackedChangeFocusToHost = (next: ExplicitActiveChange | null): void =>
    mirrorReviewFocusToHost('trackedChange', next);
  type ReviewFocus = { change: ExplicitActiveChange | null; commentId: string | null };
  const readReviewFocus = (): ReviewFocus => ({ change: explicitActiveChange, commentId: explicitActiveCommentId });
  const restoreReviewFocus = (previous: ReviewFocus): void => {
    setExplicitActiveChange(previous.change, { invalidateQueuedNavigation: false });
    explicitActiveCommentId = previous.commentId;
    if (previous.commentId) mirrorReviewFocusToHost('comment', { id: previous.commentId });
    else mirrorTrackedChangeFocusToHost(previous.change);
  };
  const setExplicitActiveChange = (
    next: ExplicitActiveChange | null,
    options?: { invalidateQueuedNavigation?: boolean },
  ): void => {
    explicitActiveChange = next;
    if (next) explicitActiveCommentId = null;
    explicitActiveChangeRevision += 1;
    trackChangeRevealInvalidation += 1;
    if (options?.invalidateQueuedNavigation !== false) {
      queuedTrackChangeNavigationInvalidation += 1;
    }
  };

  // -- state store ----------------------------------------------------------
  const listeners = new Set<(state: SuperDocUIState) => void>();
  let state!: SuperDocUIState;
  let disposed = false;
  // Back-reference to the controller object, set just before it is returned.
  // Lets the shared custom-command callback context expose `ui` without a
  // forward declaration; it is only read at command-execution time.
  let controllerRef: SuperDocUI | null = null;

  let frameRecompute: { cancel: () => void } | null = null;
  const cancelFrameRecompute = (): void => {
    frameRecompute?.cancel();
    frameRecompute = null;
  };
  const requestFrameRecompute = (reason: string): void => {
    if (disposed || frameRecompute) return;
    const requestFrame = globalThis.requestAnimationFrame;
    const cancelFrame = globalThis.cancelAnimationFrame;
    let frame: number | null = null;
    const run = (): void => {
      if (frameRecompute !== scheduled) return;
      recompute(reason);
    };
    const fallback = setTimeout(run, FRAME_RECOMPUTE_FALLBACK_MS);
    const scheduled = {
      cancel: () => {
        clearTimeout(fallback);
        if (frame !== null && typeof cancelFrame === 'function') cancelFrame(frame);
      },
    };
    frameRecompute = scheduled;
    if (typeof requestFrame === 'function') frame = requestFrame(run);
  };
  let microtaskRecomputeQueued = false;
  const requestMicrotaskRecompute = (reason: string): void => {
    if (disposed || microtaskRecomputeQueued) return;
    microtaskRecomputeQueued = true;
    const run = (): void => {
      if (!microtaskRecomputeQueued || disposed) return;
      recompute(reason);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else void Promise.resolve().then(run);
  };

  const asyncReadCache = createAsyncReadCache({
    isDisposed: () => disposed,
    recomputeAfterSettle: () => requestMicrotaskRecompute('async-read-settled'),
    recomputeWhenRetryDue: () => recompute(),
  });
  const asyncReads = asyncReadCache.entries;
  const coldAsyncReadDeferrals = new Map<string, 'armed' | 'released'>();
  let lastEffectiveInlineReadKey: string | null = null;
  let pendingEffectiveInlineRead: {
    key: string;
    ready: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  let foregroundAsyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSelectionSeedValidationToken: string | null = null;
  let typedCaretValidationHeld = false;
  let typingContentInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleAsyncRefresh = asyncReadCache.scheduleRefresh;
  const scheduleAsyncReadFailureRetry = asyncReadCache.scheduleFailureRetry;

  // Invalidation tokens.
  const editorIdentityIds = new WeakMap<object, number>();
  let editorIdentityCounter = 0;
  const editorIdentityId = (editor: LooseRecord | null): string => {
    if (!editor) return 'none';
    let id = editorIdentityIds.get(editor);
    if (id == null) {
      id = editorIdentityCounter += 1;
      editorIdentityIds.set(editor, id);
    }
    return `e${id}`;
  };
  let documentMutationRevision = 0;
  let remoteCommentsRevision = 0;
  // Explicit custom-UI list/navigation consumers share one paged directory
  // transport. Legacy hosts without the committed-window feed also use this
  // coordinator as their compatibility presentation source. A foreground
  // review mutation may supersede the paged read at a page boundary; direct
  // public `doc.trackChanges.list()` calls never receive this signal.
  const uiTrackedChangesCatalogHost = options.superdoc as object;
  const uiTrackedChangesCatalogState = acquireSharedUiTrackedChangesCatalog(uiTrackedChangesCatalogHost);

  const supersedeUiTrackedChangesCatalogRead = (): void => {
    uiTrackedChangesCatalogState.abortController.abort('review-mutation-started');
    uiTrackedChangesCatalogState.inFlight = null;
  };

  const renewUiTrackedChangesCatalogRead = (): void => {
    uiTrackedChangesCatalogState.generation += 1;
    uiTrackedChangesCatalogState.abortController = new AbortController();
    uiTrackedChangesCatalogState.inFlight = null;
  };

  const noteUiTrackedChangesCatalogCommit = (event: object): void => {
    if (uiTrackedChangesCatalogState.countedCommitEvents.has(event)) return;
    uiTrackedChangesCatalogState.countedCommitEvents.add(event);
    uiTrackedChangesCatalogState.commitSeq += 1;
  };

  const beginUiReviewMutation = (token: unknown): void => {
    const activeTokens = uiTrackedChangesCatalogState.activeMutationTokens;
    if (typeof token !== 'string' || token.length === 0 || activeTokens.has(token)) return;
    const firstToken = activeTokens.size === 0;
    activeTokens.add(token);
    if (firstToken) supersedeUiTrackedChangesCatalogRead();
  };

  const settleUiReviewMutation = (token: unknown): void => {
    const activeTokens = uiTrackedChangesCatalogState.activeMutationTokens;
    if (typeof token !== 'string' || !activeTokens.delete(token)) return;
    if (activeTokens.size === 0) renewUiTrackedChangesCatalogRead();
  };

  const runUiTrackedChangesCatalogRead = (fallback: () => unknown): unknown => {
    const v2TrackedChanges = getV2TrackedChanges();
    const listTrackedChanges = v2TrackedChanges?.listTrackedChanges;
    if (typeof listTrackedChanges !== 'function') {
      // A v2 bridge attaches asynchronously during editor boot. Do not launch
      // an unpaged raw fallback in that gap: it can monopolize the serialized
      // worker for seconds and is immediately redundant once the bridge lands.
      if (getEditor()?.editorVersion === 2) {
        return Promise.reject(new Error('v2-tracked-changes-bridge-pending'));
      }
      return fallback();
    }
    if (uiTrackedChangesCatalogState.activeMutationTokens.size > 0) {
      return Promise.reject(new Error('ui-review-catalog-superseded'));
    }
    const generation = uiTrackedChangesCatalogState.generation;
    const commitSeq = uiTrackedChangesCatalogState.commitSeq;
    const existing = uiTrackedChangesCatalogState.inFlight;
    if (existing?.generation === generation && existing.commitSeq === commitSeq) return existing.promise;
    const signal = uiTrackedChangesCatalogState.abortController.signal;
    const validateResult = (result: unknown): unknown => {
      const record = isPlainObject(result) ? result : undefined;
      if (
        signal.aborted ||
        generation !== uiTrackedChangesCatalogState.generation ||
        record?.reason === 'review-hydration-superseded'
      ) {
        throw new Error('ui-review-catalog-superseded');
      }
      if (record?.ok === false) {
        throw new Error(typeof record.reason === 'string' ? record.reason : 'ui-review-catalog-read-failed');
      }
      return result;
    };
    type CatalogRead = (input: {
      blocking: boolean;
      signal: AbortSignal;
    }) => LooseRecord | PromiseLike<LooseRecord | undefined> | undefined;
    let rawResult: ReturnType<CatalogRead>;
    try {
      rawResult = (listTrackedChanges as CatalogRead).call(v2TrackedChanges, { blocking: false, signal });
    } catch (error) {
      return Promise.reject(error);
    }
    // Keep a synchronous bridge result synchronous so an already-loaded
    // catalog can canonicalize a story-scoped document click immediately.
    // Worker-backed reads still use the shared cancellable promise below.
    if (!isPromiseLike(rawResult)) {
      try {
        return validateResult(rawResult);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const promise = Promise.resolve(rawResult).then(validateResult);
    uiTrackedChangesCatalogState.inFlight = { generation, commitSeq, promise };
    void promise.then(
      () => {
        if (uiTrackedChangesCatalogState.inFlight?.promise === promise) {
          uiTrackedChangesCatalogState.inFlight = null;
        }
      },
      () => {
        if (uiTrackedChangesCatalogState.inFlight?.promise === promise) {
          uiTrackedChangesCatalogState.inFlight = null;
        }
      },
    );
    return promise;
  };
  let postDecisionTrackChangesToken: string | null = null;
  let postDecisionTrackChangeIds = new Set<string>();
  let allTrackedChangesResolvedToken: string | null = null;
  let selectionEpoch = 0;
  let lastCoordinatorEditor: LooseRecord | null = null;
  /**
   * Fallback dirty state for editors that do not expose `isDirty` (V2). Kept
   * per host so switching the active editor away and back does not forget an
   * edit, and seeded from the host's local mutation revision so a controller
   * created after the first edit still reports it. A document replacement or
   * a verified zero revision clears an entry: `save:completed` fires for every DOCX export,
   * including a download, and producing bytes is not persistence.
   */
  const dirtyHosts = new WeakSet<object>();
  const hostSeededMutationRevision = new WeakMap<object, number>();
  const seedLocalDocumentMutation = (host: LooseRecord): void => {
    if (hostSeededMutationRevision.has(host)) return;
    const getLocalMutationRevision = hostMethod(host, 'getLocalMutationRevision');
    const revision = getLocalMutationRevision ? safeCall<unknown>(() => getLocalMutationRevision(), null) : null;
    const seeded = typeof revision === 'number' ? revision : 0;
    hostSeededMutationRevision.set(host, seeded);
    if (seeded > 0) dirtyHosts.add(host);
    else if (revision === 0) dirtyHosts.delete(host);
  };
  // Seeds on first read as well as on subscription: the initial state is
  // computed before the host subscription is wired.
  const savedPoint = () => {
    const host = getHost();
    return {
      host,
      isDirty: hostMethod(host, 'isDirty'),
      getDocumentVersion: hostMethod(host, 'getDocumentVersion'),
      markSaved: hostMethod(host, 'markSaved'),
    };
  };
  const hasLocalDocumentMutation = (): boolean => {
    const { host, isDirty } = savedPoint();
    if (!host) return false;
    if (isDirty) return Boolean(safeCall<unknown>(() => isDirty(), false));
    seedLocalDocumentMutation(host);
    return dirtyHosts.has(host);
  };

  /** Token shared by document-content reads (editor identity + mutation revision). */
  const contentToken = (): string => `${editorIdentityId(getEditor())}|m${documentMutationRevision}`;
  const commentsDirectoryToken = (): string => `${contentToken()}|r${remoteCommentsRevision}`;

  const clearPostDecisionTrackChanges = (): void => {
    postDecisionTrackChangesToken = null;
    postDecisionTrackChangeIds = new Set();
  };

  const applyPostDecisionTrackChangesToCache = (ids: ReadonlySet<string>): void => {
    for (const key of ['trackChanges', 'trackChanges:all']) {
      const entry = asyncReads.get(key);
      if (!entry?.hasSettled || !Array.isArray(entry.value)) continue;
      const nextValue = entry.value.filter((item) => {
        const id = readEntityId(item);
        return !id || !ids.has(id);
      });
      if (nextValue.length === entry.value.length) continue;
      asyncReads.set(key, { ...entry, value: nextValue });
    }
  };

  const notifyPostDecisionTrackChanges = (receipt?: unknown): void => {
    const notify = (): void => {
      if (disposed) return;
      for (const listener of [...listeners]) listener(state);
    };
    const record = isPlainObject(receipt) ? receipt : null;
    const readiness = getEditor()?.documentMutationReadiness as LooseRecord | undefined;
    const waitForPostPaintTask = (): Promise<void> => {
      const requestFrame = globalThis.requestAnimationFrame;
      if (typeof requestFrame !== 'function') return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(fallback);
          resolve();
        };
        const fallback = setTimeout(finish, 250);
        requestFrame(() => requestFrame(() => setTimeout(finish, 0)));
      });
    };
    if (
      record?.success === true &&
      typeof record.txId === 'string' &&
      record.txId.length > 0 &&
      typeof readiness?.whenPainted === 'function'
    ) {
      try {
        // Updating the snapshot/cache is cheap and synchronous, but notifying
        // an open review surface can schedule hundreds of Vue component
        // effects. Keep those effects behind the exact receipt paint and its
        // two-frame presentation boundary so they cannot preempt the
        // canonical decision frame.
        void Promise.resolve(readiness.whenPainted.call(readiness, record))
          .then(waitForPostPaintTask, () => undefined)
          .then(notify, notify);
        return;
      } catch {
        // Inline/legacy readiness implementations may reject the receipt
        // shape synchronously. Preserve their existing immediate delivery.
      }
    }
    notify();
  };

  const publishPostDecisionTrackChanges = (ids: ReadonlySet<string>, receipt?: unknown): void => {
    const previous = state.trackChanges;
    const items = previous.items.filter((item) => {
      const id = readEntityId(item);
      return !id || !ids.has(id);
    });
    if (items.length === previous.items.length) return;
    if (explicitActiveChange && ids.has(explicitActiveChange.id)) {
      setExplicitActiveChange(null);
    }
    const authors = new Set<string>();
    for (const item of items) {
      const change = trackChangesItemPayload(item);
      const author = change.author ?? change.authorEmail ?? item.author ?? item.authorEmail;
      if (typeof author === 'string') authors.add(author);
    }
    const removedCount = previous.items.length - items.length;
    state = {
      ...state,
      trackChanges: {
        ...previous,
        items,
        total: Math.max(items.length, previous.total - removedCount),
        activeId: previous.activeId && ids.has(previous.activeId) ? null : previous.activeId,
        authors: [...authors],
      },
    };
    notifyPostDecisionTrackChanges(receipt);
  };

  /**
   * Publish the exact empty catalog proved by an all-resolved receipt.
   * Reject All does not carry one removed ref per logical change, so the
   * ordinary identity-pruning path cannot clear selection-derived focus or
   * the slice total. Keep this proof scoped to the current content token: the
   * next independent document mutation advances the token and resumes normal
   * catalog/selection reads.
   */
  const publishAllTrackedChangesResolved = (receipt?: unknown): void => {
    const previous = state.trackChanges;
    const changed =
      previous.items.length > 0 || previous.total !== 0 || previous.activeId !== null || previous.authors.length > 0;
    allTrackedChangesResolvedToken = contentToken();
    if (explicitActiveChange !== null) setExplicitActiveChange(null);
    state = {
      ...state,
      trackChanges: {
        ...previous,
        items: [],
        total: 0,
        activeId: null,
        authors: [],
      },
    };
    if (changed) notifyPostDecisionTrackChanges(receipt);
  };

  const markPostDecisionTrackChanges = (ids: Set<string>, receipt?: unknown): void => {
    if (ids.size === 0) return;
    const token = contentToken();
    const alreadyRemoved = postDecisionTrackChangesToken === token ? postDecisionTrackChangeIds : new Set<string>();
    const newlyRemoved = new Set([...ids].filter((id) => !alreadyRemoved.has(id)));
    if (newlyRemoved.size === 0) return;
    postDecisionTrackChangesToken = token;
    postDecisionTrackChangeIds = new Set([...alreadyRemoved, ...newlyRemoved]);
    applyPostDecisionTrackChangesToCache(postDecisionTrackChangeIds);
    // A decision receipt already proves these exact identities are gone.
    // Publish that one bounded delta without rebuilding every document slice;
    // the next independent content invalidation clears this suppression and
    // refreshes the catalog under its new token.
    publishPostDecisionTrackChanges(newlyRemoved, receipt);
  };

  const postDecisionTrackChangeIdsForToken = (token: string): ReadonlySet<string> | null =>
    postDecisionTrackChangesToken === token && postDecisionTrackChangeIds.size > 0 ? postDecisionTrackChangeIds : null;

  const replaceTrackedChangeItemsInCache = (items: readonly unknown[]): void => {
    const token = contentToken();
    const suppressedIds = postDecisionTrackChangeIdsForToken(token);
    const projected = items.map(projectTrackChangesItem).filter((item): item is TrackChangesItem => {
      if (item == null) return false;
      const id = readEntityId(item);
      return id != null && !suppressedIds?.has(id);
    });
    for (const key of ['trackChanges', 'trackChanges:all']) {
      asyncReads.set(key, {
        token,
        value: [...projected],
        hasSettled: true,
        inflightToken: null,
      });
    }
  };

  /** Token for the live selection read, including the mode that controls its public projection. */
  const selectionReadToken = (): string => `${contentToken()}|m${readDocumentMode()}|s${selectionEpoch}`;

  /** Stable signature of a settled selection, used to key selection-scoped reads. */
  const selectionSignature = (selection: SelectionSlice): string =>
    JSON.stringify({ t: selection.target ?? null, s: selection.selectionTarget ?? null });

  const SELECTION_SCOPED_ASYNC_READ_PREFIXES = ['contentControls:inRange:', 'query:', 'effInline:'] as const;
  const FOREGROUND_ASYNC_RETRY_MS = 120;
  const COLD_ASYNC_READ_START_DELAY_MS = 180;

  const heavyReadGate = createHeavyReadGate({
    isDisposed: () => disposed,
    currentHost: getHost,
    contentToken,
    readAsyncEntry: (key) => asyncReads.get(key),
    replaceAsyncEntry: (key, entry) => {
      asyncReads.set(key, entry);
    },
    scheduleAsyncRefresh,
    recompute: () => recompute(),
    foregroundMutationActive: () => foregroundMutationActive(),
    scheduleForegroundAsyncRetry: (delayMs) => scheduleForegroundAsyncRetry(delayMs),
  });
  const {
    directoryLeaseCounts,
    incompleteTrackChangesDirectoryReadTokens,
    holdsHeavyRead,
    typingIsRecent,
    demandHeavyDocRead,
    acquireDirectoryLease,
    ensureTrackChangesCatalog,
  } = heavyReadGate;

  const foregroundMutationState = (): { active: number; pending: number } | null => {
    const host = getEditor()?.host as LooseRecord | undefined;
    const read = host?.getForegroundMutationState;
    if (typeof read !== 'function') return null;
    const state = safeCall<LooseRecord | null>(() => read.call(host) as LooseRecord, null);
    const active = typeof state?.active === 'number' ? state.active : 0;
    const pending = typeof state?.pending === 'number' ? state.pending : 0;
    return { active, pending };
  };

  const foregroundMutationActive = (): boolean => {
    const state = foregroundMutationState();
    return Boolean(state && (state.active > 0 || state.pending > 0));
  };

  const scheduleForegroundAsyncRetry = (delayMs = FOREGROUND_ASYNC_RETRY_MS): void => {
    if (disposed || foregroundAsyncRetryTimer) return;
    foregroundAsyncRetryTimer = setTimeout(() => {
      foregroundAsyncRetryTimer = null;
      if (disposed) return;
      if (foregroundMutationActive()) {
        scheduleForegroundAsyncRetry();
        return;
      }
      if (typedCaretValidationHeld && typingIsRecent()) {
        const token = selectionReadToken();
        if (asyncReads.get('selection')?.token !== token) {
          refreshSelectionFromHost(undefined, true);
          if (asyncReads.get('selection')?.token === token) recompute();
        }
        scheduleForegroundAsyncRetry(HEAVY_READ_IDLE_POLL_MS);
        return;
      }
      typedCaretValidationHeld = false;
      const validationToken = pendingSelectionSeedValidationToken;
      pendingSelectionSeedValidationToken = null;
      if (validationToken === selectionReadToken()) {
        issueAsyncRead('selection', validationToken, selectionCurrentRun, normalizeSelectionInfo);
      }
      releaseColdAsyncReads();
      recompute();
    }, delayMs);
  };

  const shouldDeferColdAsyncRead = (key: string, token: string): boolean => {
    if (!foregroundMutationState()) return false;
    const deferralKey = `${key}\u0000${token}`;
    if (coldAsyncReadDeferrals.get(deferralKey) === 'released') return false;
    coldAsyncReadDeferrals.set(deferralKey, 'armed');
    scheduleForegroundAsyncRetry(COLD_ASYNC_READ_START_DELAY_MS);
    return true;
  };
  const releaseColdAsyncReads = (): void => {
    for (const key of coldAsyncReadDeferrals.keys()) coldAsyncReadDeferrals.set(key, 'released');
  };

  /**
   * A large-selection uniformity read walks every covered paragraph. The first
   * settled selection reads immediately; later distinct selection keys debounce
   * so pointer-drag/autoscroll updates supersede one another before worker work
   * starts. Refreshes of the same selection stay immediate.
   */
  const shouldDeferEffectiveInlineRead = (key: string): boolean => {
    if (lastEffectiveInlineReadKey == null || key === lastEffectiveInlineReadKey) {
      if (pendingEffectiveInlineRead?.timer) clearTimeout(pendingEffectiveInlineRead.timer);
      pendingEffectiveInlineRead = null;
      lastEffectiveInlineReadKey = key;
      return false;
    }
    if (pendingEffectiveInlineRead?.key === key) {
      if (!pendingEffectiveInlineRead.ready) return true;
      pendingEffectiveInlineRead = null;
      lastEffectiveInlineReadKey = key;
      return false;
    }
    if (pendingEffectiveInlineRead?.timer) clearTimeout(pendingEffectiveInlineRead.timer);
    const pending = {
      key,
      ready: false,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    pending.timer = setTimeout(() => {
      if (disposed || pendingEffectiveInlineRead !== pending) return;
      pending.timer = null;
      pending.ready = true;
      recompute();
    }, COLD_ASYNC_READ_START_DELAY_MS);
    pendingEffectiveInlineRead = pending;
    return true;
  };

  const isEditableTextMutationEvent = (event: LooseRecord): boolean => {
    return isV2EditableTextMutationEvent(event);
  };

  const invalidateDocumentContentAndRecompute = (): void => {
    invalidateDocumentContent();
    recompute();
  };

  let pendingPostPaintContentRefresh: {
    editor: LooseRecord;
    whenPainted: (...args: unknown[]) => unknown;
    afterEpoch: number | null;
  } | null = null;
  let pendingPostPaintSelectionRefresh: {
    editor: LooseRecord;
    whenPainted: (...args: unknown[]) => unknown;
    afterEpoch: number | null;
  } | null = null;
  let postPaintContentRefreshRunning = false;
  let postPaintContentRefreshDrainToken = 0;
  let postPaintSelectionRefreshRunning = false;
  let postPaintSelectionRefreshDrainToken = 0;

  const resetPostPaintContentRefresh = (): void => {
    pendingPostPaintContentRefresh = null;
    postPaintContentRefreshRunning = false;
    postPaintContentRefreshDrainToken += 1;
  };

  const resetPostPaintSelectionRefresh = (): void => {
    pendingPostPaintSelectionRefresh = null;
    postPaintSelectionRefreshRunning = false;
    postPaintSelectionRefreshDrainToken += 1;
  };

  const schedulePostPaintContentRefresh = (): void => {
    const editor = getEditor();
    const readiness = editor?.documentMutationReadiness;
    const whenPainted = hostMethod(readiness, 'whenPainted');
    if (!editor || !whenPainted) return;
    const getRenderEpoch = hostMethod(readiness, 'getRenderEpoch');
    const epoch = getRenderEpoch ? safeCall<unknown>(() => getRenderEpoch(), null) : null;
    const afterEpoch = typeof epoch === 'number' ? epoch : null;
    pendingPostPaintContentRefresh = { editor, whenPainted, afterEpoch };
    if (postPaintContentRefreshRunning) return;
    postPaintContentRefreshRunning = true;
    const drainToken = postPaintContentRefreshDrainToken;

    const drain = async (): Promise<void> => {
      while (!disposed && drainToken === postPaintContentRefreshDrainToken) {
        const request = pendingPostPaintContentRefresh;
        pendingPostPaintContentRefresh = null;
        if (!request) {
          postPaintContentRefreshRunning = false;
          return;
        }
        let paintCompleted = false;
        try {
          await request.whenPainted(
            typeof request.afterEpoch === 'number' ? { afterEpoch: request.afterEpoch } : undefined,
          );
          paintCompleted = true;
        } catch {
          // The immediate refresh already published the latest source state.
          // A failed readiness observation must not strand later mutation events.
        }
        if (disposed || drainToken !== postPaintContentRefreshDrainToken) return;
        if (getEditor() !== request.editor) {
          resetPostPaintContentRefresh();
          return;
        }
        if (paintCompleted) invalidateDocumentContentAndRecompute();
      }
    };

    void drain();
  };

  const schedulePostPaintSelectionRefresh = (): boolean => {
    const editor = getEditor();
    const readiness = editor?.documentMutationReadiness;
    const whenPainted = hostMethod(readiness, 'whenPainted');
    if (!editor || !whenPainted) return false;
    const getRenderEpoch = hostMethod(readiness, 'getRenderEpoch');
    const epoch = getRenderEpoch ? safeCall<unknown>(() => getRenderEpoch(), null) : null;
    const afterEpoch = typeof epoch === 'number' ? epoch : null;
    pendingPostPaintSelectionRefresh = { editor, whenPainted, afterEpoch };
    if (postPaintSelectionRefreshRunning) return true;
    postPaintSelectionRefreshRunning = true;
    const drainToken = postPaintSelectionRefreshDrainToken;

    const drain = async (): Promise<void> => {
      while (!disposed && drainToken === postPaintSelectionRefreshDrainToken) {
        const request = pendingPostPaintSelectionRefresh;
        pendingPostPaintSelectionRefresh = null;
        if (!request) {
          postPaintSelectionRefreshRunning = false;
          return;
        }
        let paintCompleted = false;
        try {
          await request.whenPainted(
            typeof request.afterEpoch === 'number' ? { afterEpoch: request.afterEpoch } : undefined,
          );
          paintCompleted = true;
        } catch {
          // Fall through to the ordinary immediate selection refresh.
        }
        if (disposed || drainToken !== postPaintSelectionRefreshDrainToken) return;
        if (getEditor() !== request.editor) {
          resetPostPaintSelectionRefresh();
          return;
        }
        if (pendingPostPaintSelectionRefresh) continue;
        selectionEpoch += 1;
        refreshSelectionFromHost(undefined, true);
        recompute(paintCompleted ? 'post-paint-selection' : 'post-paint-selection-failed');
      }
    };

    void drain();
    return true;
  };

  const scheduleTypingDocumentContentInvalidation = (): void => {
    if (typingContentInvalidationTimer) clearTimeout(typingContentInvalidationTimer);
    typingContentInvalidationTimer = setTimeout(() => {
      typingContentInvalidationTimer = null;
      if (!disposed) {
        invalidateDocumentContent();
        if (typedCaretValidationHeld && !foregroundMutationActive()) refreshSelectionFromHost(undefined, true);
        recompute();
      }
    }, 500);
  };

  const issueAsyncRead = asyncReadCache.issue;

  const holdsTypedCaretSelection = (key: string): boolean =>
    key === 'selection' && typedCaretValidationHeld && typingIsRecent();

  const waitingForFailureRetry = (
    entry: AsyncReadEntry | undefined,
    token: string,
  ): entry is AsyncReadEntry & { retryAtMs: number } =>
    entry?.failedToken === token && entry.inflightToken == null && (entry.retryAtMs ?? 0) > Date.now();

  const readAsync = <T>(
    key: string,
    token: string,
    run: () => unknown,
    normalize: (raw: unknown) => T | null,
    immediate = false,
    gateToken = token,
  ): { value: T | null; status: SliceStatus } => {
    const serve = (
      entry: AsyncReadEntry | null | undefined,
      status: SliceStatus,
    ): { value: T | null; status: SliceStatus } =>
      entry?.hasSettled ? { value: entry.value as T | null, status } : { value: null, status: 'pending' };
    const entry = asyncReads.get(key);
    if (entry && entry.token === token && entry.hasSettled) return serve(entry, 'ready');
    if (holdsTypedCaretSelection(key)) {
      scheduleForegroundAsyncRetry(HEAVY_READ_IDLE_POLL_MS);
      return serve(entry, 'stale');
    }
    if (!immediate && holdsHeavyRead(key, gateToken)) return serve(entry, 'stale');
    if (!immediate && foregroundMutationActive()) {
      scheduleForegroundAsyncRetry();
      return serve(entry, 'stale');
    }
    if (waitingForFailureRetry(entry, token)) {
      scheduleAsyncReadFailureRetry(entry.retryAtMs);
      return serve(entry, 'stale');
    }
    if (!entry && key.startsWith('effInline:') && shouldDeferEffectiveInlineRead(key)) return serve(entry, 'pending');
    if (!immediate && !entry && shouldDeferColdAsyncRead(key, gateToken)) return serve(entry, 'pending');
    if (!entry || entry.inflightToken !== token) {
      const completed = issueAsyncRead(key, token, run, normalize);
      if (completed) return serve(completed, 'ready');
    }
    return serve(asyncReads.get(key), 'stale');
  };

  const clearAsyncReadKeys = asyncReadCache.clearKeys;
  const seedAsyncRead = asyncReadCache.seed;

  const selectionValidationSnapshot = (): { held: boolean; pendingToken: string | null } => ({
    held: typedCaretValidationHeld,
    pendingToken: pendingSelectionSeedValidationToken,
  });

  const setSelectionValidation = (next: { held: boolean; pendingToken: string | null }): void => {
    typedCaretValidationHeld = next.held;
    pendingSelectionSeedValidationToken = next.pendingToken;
  };

  const selectionScopedAsyncReadKeys = (selection: SelectionSlice): ReadonlySet<string> => {
    const signature = selectionSignature(selection);
    const effectiveUniformityKey = effectiveInlineUniformityCacheKey(selection);
    return new Set([
      `contentControls:inRange:${signature}`,
      `query:${signature}`,
      ...(effectiveUniformityKey ? [effectiveUniformityKey] : []),
    ]);
  };

  const pruneSelectionScopedAsyncReads = (selection: SelectionSlice): void => {
    const retained = selectionScopedAsyncReadKeys(selection);
    clearAsyncReadKeys(
      (key) => SELECTION_SCOPED_ASYNC_READ_PREFIXES.some((prefix) => key.startsWith(prefix)) && !retained.has(key),
    );
    for (const key of [...coldAsyncReadDeferrals.keys()]) {
      const readKey = key.split('\u0000', 1)[0]!;
      if (SELECTION_SCOPED_ASYNC_READ_PREFIXES.some((prefix) => readKey.startsWith(prefix)) && !retained.has(readKey)) {
        coldAsyncReadDeferrals.delete(key);
      }
    }
  };

  /** Drop cached reads when the active editor identity changes (avoids cross-editor leakage). */
  const syncCoordinatorEditor = (): void => {
    const editor = getEditor();
    if (editor === lastCoordinatorEditor) return;
    resetPostPaintContentRefresh();
    resetPostPaintSelectionRefresh();
    lastCoordinatorEditor = editor;
    asyncReads.clear();
    asyncReadCache.cancelFailureRetry();
    if (pendingEffectiveInlineRead?.timer) clearTimeout(pendingEffectiveInlineRead.timer);
    pendingEffectiveInlineRead = null;
    lastEffectiveInlineReadKey = null;
    heldSettledInlineValues = null;
    optimisticParagraphAlignment = null;
    pendingSelectionSeedValidationToken = null;
    typedCaretValidationHeld = false;
    coldAsyncReadDeferrals.clear();
    heavyReadGate.resetForEditor();
    clearPostDecisionTrackChanges();
    allTrackedChangesResolvedToken = null;
  };

  /** Bump the document-mutation revision so content reads re-fetch on the next compute. */
  const invalidateDocumentContent = (): void => {
    documentMutationRevision += 1;
    heavyReadGate.invalidateSourceCoverage();
    clearPostDecisionTrackChanges();
  };

  /**
   * Refresh command-derived document slices without discarding an exact
   * all-resolved catalog received while the async command was settling. Host
   * mutation events arrive before the command promise resolves; a generic
   * invalidation at that later boundary would otherwise advance the cache
   * token and immediately re-list the catalog we already know is empty.
   */
  const invalidateAfterCommandSettlement = (): void => {
    const carryAllResolvedCatalog = allTrackedChangesResolvedToken === contentToken();
    invalidateDocumentContent();
    if (carryAllResolvedCatalog) {
      replaceTrackedChangeItemsInCache([]);
      allTrackedChangesResolvedToken = contentToken();
    }
    recompute();
  };

  /**
   * Insert plain text through the public Document API. The narrow built-in /
   * custom insertion helper exposed on the custom-command callback context.
   * Fails closed (failure receipt) in viewing mode or when `doc.insert` is
   * unavailable — never reaching into `activeEditor.commands`.
   */
  const insertText = (text: string): WorkflowReceipt => {
    if (typeof text !== 'string' || text.length === 0) {
      return failedReceipt('insertText requires a non-empty string.', 'INVALID_INPUT');
    }
    if (documentIsReadOnly()) {
      return failedReceipt('The document is read-only.', 'DOCUMENT_READONLY');
    }
    const doc = getDoc();
    const op = doc?.insert as AnyFn | undefined;
    if (!doc || typeof op !== 'function') return failedReceipt('insert is unavailable.');
    const currentSelection = (doc.selection as LooseRecord | undefined)?.current;
    if (typeof currentSelection !== 'function') {
      return failedReceipt('selection.current is unavailable.');
    }
    const insertAtLiveSelection = (selection: unknown): WorkflowReceipt => {
      const record = selection && typeof selection === 'object' ? (selection as LooseRecord) : null;
      const target = record?.selectionTarget ?? record?.target ?? null;
      if (!target || typeof target !== 'object') {
        return failedReceipt('insertText requires a live selection target.', 'PRECONDITION_FAILED');
      }
      return safeCall<WorkflowReceipt>(
        () =>
          settleWorkflowReceipt(op.call(doc, { type: 'text', value: text, target }), failedReceipt('insert failed.')),
        failedReceipt('insert failed.'),
      );
    };
    let selection: unknown;
    try {
      selection = currentSelection.call(doc.selection);
    } catch {
      return failedReceipt('insertText could not resolve the live selection.', 'PRECONDITION_FAILED');
    }
    if (isPromiseLike(selection)) {
      return Promise.resolve(selection).then(insertAtLiveSelection, () =>
        failedReceipt('insertText could not resolve the live selection.', 'PRECONDITION_FAILED'),
      );
    }
    return insertAtLiveSelection(selection);
  };

  /** Build the shared V2-truthful callback context for a custom command / button. */
  const buildCustomCommandContext = (payload: unknown, context?: ViewportContext): CustomCommandContext => ({
    payload,
    state,
    editor: getEditor() as unknown as CustomCommandContext['editor'],
    superdoc: superdoc as unknown as CustomCommandContext['superdoc'],
    context,
    ui: controllerRef as SuperDocUI,
    execute: (commandId: string, commandPayload?: unknown) => executeCommand(commandId, commandPayload),
    executeAsync: (commandId: string, commandPayload?: unknown) => executeCommandAsync(commandId, commandPayload),
    doc: getDoc() as unknown as CustomCommandContext['doc'],
    selection: state.selection,
    documentMode: readDocumentMode(),
    insertText,
  });

  const normalizeDocumentMode = (value: unknown): SuperDocUIState['documentMode'] => {
    return value === 'editing' || value === 'suggesting' || value === 'viewing' ? value : null;
  };

  const readDocumentMode = (): SuperDocUIState['documentMode'] => {
    const editor = getEditor();
    const superdocRecord = superdoc && typeof superdoc === 'object' ? (superdoc as LooseRecord) : null;
    const fromConfig = normalizeDocumentMode((superdocRecord?.config as LooseRecord | undefined)?.documentMode);
    // The public config wins while a mode change is settling. Avoid building
    // a complete runtime capability snapshot merely to read that same mode.
    if (fromConfig) return fromConfig;
    const getActiveRuntime = hostMethod(superdocRecord, 'getActiveRuntime');
    const runtimeSnapshot = safeCall<unknown>(
      getActiveRuntime ? () => hostMethod(getActiveRuntime(), 'getSnapshot')?.() ?? null : undefined,
      null,
    );
    const fromRuntime = normalizeDocumentMode(
      isPlainObject(runtimeSnapshot) ? runtimeSnapshot.documentMode : undefined,
    );
    const fromOptions = normalizeDocumentMode((editor?.options as LooseRecord | undefined)?.documentMode);

    return fromRuntime ?? fromOptions;
  };

  const documentIsReadOnly = (): boolean => {
    if (readDocumentMode() === 'viewing') return true;
    const connection = safeCall<unknown>(() => hostMethod(superdoc, 'getCollaborationConnectionState')?.(), null);
    return isPlainObject(connection) && connection.state === 'failed';
  };

  const commentsAreReadOnly = (): boolean => {
    const superdocRecord = superdoc && typeof superdoc === 'object' ? (superdoc as LooseRecord) : null;
    // Interaction policy outlives the built-in comment UI. With `ui: false` or
    // `ui: { comments: false }` there is no `modules.comments` block left to
    // carry it — the field is `false` — so reading only the legacy block makes
    // the guard fail open for exactly the custom UI the policy exists for.
    const resolved = (superdocRecord?.interactionConfig as LooseRecord | undefined)?.comments as
      | LooseRecord
      | undefined;
    if (resolved && typeof resolved.readOnly === 'boolean') return resolved.readOnly === true;
    const modules = (superdocRecord?.config as LooseRecord | undefined)?.modules as LooseRecord | undefined;
    const comments = modules?.comments;
    return !!comments && typeof comments === 'object' && (comments as LooseRecord).readOnly === true;
  };

  const trackedChangeDecisionDisabledReason = (): SuperDocUIReason | undefined => {
    if (documentIsReadOnly()) return SUPERDOC_UI_REASONS.documentReadonly;

    const superdocRecord = superdoc && typeof superdoc === 'object' ? (superdoc as LooseRecord) : null;
    const trackedChanges = (superdocRecord?.interactionConfig as LooseRecord | undefined)?.trackedChanges as
      | LooseRecord
      | undefined;
    if (trackedChanges && typeof trackedChanges.allowDecisions === 'boolean') {
      return trackedChanges.allowDecisions ? undefined : SUPERDOC_UI_REASONS.trackedChangeDecisionsDisabled;
    }

    // Older SuperDoc hosts exposed only the dual-purpose comments.readOnly
    // field. Keep that fallback for callers constructing the UI controller
    // around an existing v2 host.
    return commentsAreReadOnly() ? SUPERDOC_UI_REASONS.documentReadonly : undefined;
  };

  /**
   * Whether the resolved comment policy forbids resolve and reopen actions.
   * Read the resolved policy first, then fall back to the legacy block.
   */
  const resolveIsForbidden = (): boolean => {
    const superdocRecord = superdoc && typeof superdoc === 'object' ? (superdoc as LooseRecord) : null;
    const resolved = (superdocRecord?.interactionConfig as LooseRecord | undefined)?.comments as
      | LooseRecord
      | undefined;
    if (resolved && typeof resolved.allowResolve === 'boolean') return resolved.allowResolve === false;
    const modules = (superdocRecord?.config as LooseRecord | undefined)?.modules as LooseRecord | undefined;
    const comments = modules?.comments;
    return !!comments && typeof comments === 'object' && (comments as LooseRecord).allowResolve === false;
  };

  // Document viewing keeps the body immutable. Comment writes follow
  // `interaction.comments.readOnly` (and the legacy modules.comments flag), so
  // a customer can keep selection-backed comments writable while the document
  // stays in viewing mode (SD-4470).
  const commentMutationsAreReadOnly = (): boolean => commentsAreReadOnly();
  const trackedChangeDecisionsAreDisabled = (): boolean => trackedChangeDecisionDisabledReason() != null;

  const normalizeSelectionInfo = (raw: unknown): SelectionInfo | null =>
    raw && typeof raw === 'object' ? (raw as SelectionInfo) : null;

  const selectionContentLocks = new WeakMap<SelectionSlice, boolean>();

  const selectionSliceFromInfo = (info: SelectionInfo | null, status: SliceStatus): SelectionSlice => {
    if (!info) return { ...EMPTY_SELECTION, status };
    const slice = buildSelectionSlice(info, status);
    if (isPlainObject(info) && typeof info.contentControlLocked === 'boolean') {
      selectionContentLocks.set(slice, info.contentControlLocked);
    }
    if (selectionInfoReviewWarming(info) && !slice.empty && slice.activeChangeIds.length === 0) {
      reviewWarmingSelections.add(slice);
    }
    const hostSelection = selectionHostSnapshots.get(info);
    if (hostSelection) selectionHostSnapshots.set(slice, hostSelection);
    return slice;
  };

  const buildSelectionSlice = (info: SelectionInfo, status: SliceStatus): SelectionSlice => {
    const target = (info.target ?? null) as SelectionSlice['target'];
    const quotedText = typeof info.text === 'string' ? info.text : '';
    return {
      status,
      empty: info.empty === true,
      target,
      trackedTarget: info.trackedTarget ?? null,
      trackedChangeRangeDecisionSupported: info.trackedChangeRangeDecisionSupported,
      trackedChangesWhollySelected: info.trackedChangesWhollySelected,
      selectionTarget: (info.selectionTarget ?? null) as SelectionSlice['selectionTarget'],
      tableSelection: info.tableSelection ?? null,
      activeMarks: Array.isArray(info.activeMarks) ? (info.activeMarks as string[]) : [],
      activeCommentIds: Array.isArray(info.activeCommentIds) ? (info.activeCommentIds as string[]) : [],
      activeChangeIds: Array.isArray(info.activeChangeIds) ? (info.activeChangeIds as string[]) : [],
      quotedText,
    };
  };

  const readSelectionInfoLive = (): { value: SelectionInfo | null; status: SliceStatus } =>
    readAsync<SelectionInfo>('selection', selectionReadToken(), selectionCurrentRun, normalizeSelectionInfo);

  const computeSelection = (): SelectionSlice => {
    // Request the model-backed quoted text so `quotedText` is truthful and the
    // emptiness comes from the selection source (`info.empty`), not from whether
    // text happened to be extracted. The read flows through the coordinator so a
    // promise-returning browser selection read settles into the cache rather
    // than collapsing the slice to empty.
    const { value: info, status } = readSelectionInfoLive();
    return selectionSliceFromInfo(info, status);
  };

  function selectionCurrentRun(): unknown {
    const current = hostMethod(getDoc()?.selection, 'current');
    if (!current) return undefined;
    // Record the host selection this read resolves, before any await.
    const hostSelection = readHostSelectionSnapshot();
    const tag = (info: unknown): unknown => {
      if (hostSelection && info && typeof info === 'object') selectionHostSnapshots.set(info, hostSelection);
      return info;
    };
    const result = current({
      includeText: true,
      ...(getEditor()?.editorVersion === 2 ? { offsetSpace: 'selection' } : {}),
    });
    return isPromiseLike(result) ? Promise.resolve(result).then(tag) : tag(result);
  }

  /** True when a host sync snapshot is a resolved collapsed caret (not a range). */
  const isCollapsedCaretSnapshot = (info: SelectionInfo): boolean => {
    if (info.empty !== true) return false;
    const start = info.selectionTarget?.start;
    const end = info.selectionTarget?.end;
    return (
      start?.kind === 'text' &&
      end?.kind === 'text' &&
      typeof start.blockId === 'string' &&
      start.blockId === end.blockId &&
      typeof start.offset === 'number' &&
      start.offset === end.offset
    );
  };

  /**
   * On a caret move, seed the `selection` read cache synchronously from the
   * host's local snapshot so the toolbar reflects the NEW caret's block (and the
   * effective font resolved from it) on the next recompute, instead of serving
   * the previous selection until the worker `selection.current` round-trip lands
   * (SD-3652). A resolvable collapsed caret is seeded; a range's snapshot
   * cannot be resolved synchronously in worker mode, so a new range starts an
   * authoritative async read without waiting for the input-idle gate (SD-5394).
   * Seeding an empty value would wrongly disable range-only commands. The
   * authoritative async read still overwrites marks/text/review overlap, but
   * foreground typing defers and coalesces that worker hop through the shared
   * retry gate. Previous marks are carried forward for toolbar continuity. A
   * tracked-change id is carried only when the host's painted caret proves the
   * same carrier, or while an active typing dispatch advances the same caret by
   * one code point. Pending work alone never carries review command context.
   * Explicit whole-table changes have a complete local source range and also
   * seed clears, so a delayed worker read cannot retain a cleared table target.
   */
  function captureWholeTableParagraphSeed(
    host: LooseRecord | null,
    seed: SelectionInfo,
    nativeSelection: object | null,
  ): boolean {
    const editor = getEditor();
    const rawLifetime = safeCall<unknown>(() => hostMethod(host, 'getForegroundInteractionLifetime')?.() ?? null, null);
    const lifetime = hasAbortedFlag(rawLifetime) ? rawLifetime : null;
    const mount = safeCall<unknown>(() => hostMethod(host, 'getMountedHandle')?.() ?? null, null);
    const mode = readDocumentMode();
    if (
      !host ||
      !editor ||
      !mount ||
      !lifetime ||
      lifetime.aborted ||
      mode === null ||
      seed.empty ||
      seed.tableSelection?.kind !== 'tableCells' ||
      seed.tableSelection.type !== 'table' ||
      seed.target?.kind !== 'text' ||
      !seed.target.segments.length
    )
      return false;
    if (nativeSelection) {
      const presentation = safeCall<unknown>(() => hostMethod(host, 'readAppliedSelectionPresentation')?.(), null);
      const applied = normalizeSelectionInfo(isPlainObject(presentation) ? presentation.selection : null);
      if (
        readHostSelectionSnapshot() !== nativeSelection ||
        !isNonCollapsedHostSelection(nativeSelection) ||
        !applied ||
        selectionSignature(selectionSliceFromInfo(applied, 'ready')) !==
          selectionSignature(selectionSliceFromInfo(seed, 'ready')) ||
        JSON.stringify(applied.tableSelection) !== JSON.stringify(seed.tableSelection)
      )
        return false;
      const snapshot = nativeSelection as LooseRecord;
      const first = seed.target.segments[0]?.blockId,
        last = seed.target.segments.at(-1)?.blockId;
      const matches = (point: unknown, blockId: string | undefined): boolean =>
        !!blockId &&
        isPlainObject(point) &&
        point.blockId === blockId &&
        storyLocatorSignature(point.story ?? snapshot.story) === storyLocatorSignature(seed.target?.story);
      if (
        !(
          (matches(snapshot.anchor, first) && matches(snapshot.focus, last)) ||
          (matches(snapshot.focus, first) && matches(snapshot.anchor, last))
        )
      )
        return false;
    }
    wholeTableParagraphSeed = {
      editor,
      host,
      doc: editor.doc,
      mount,
      lifetime,
      sourceToken: contentToken(),
      mode,
      info: seed,
      nativeSelection,
    };
    return true;
  }

  const refreshSelectionFromHost = (
    hostSelectionSnapshot?: unknown,
    afterTypingPaint = false,
    wholeTableSelectionChanged = false,
    initialTableSelection: object | null = null,
  ): void => {
    const host = getHost();
    const foreground = foregroundMutationState();
    const currentSelection =
      hostSelectionSnapshot ?? (wholeTableSelectionChanged ? undefined : readHostSelectionSnapshot());
    if (isNonCollapsedHostSelection(currentSelection) && readHostSelectionSnapshot() === currentSelection) {
      const presentation = safeCall<unknown>(
        () => hostMethod(host, 'readAppliedSelectionPresentation')?.({ tableOnly: true }),
        null,
      );
      const applied = normalizeSelectionInfo(isPlainObject(presentation) ? presentation.selection : null);
      if (applied?.tableSelection?.kind === 'tableCells' && applied.tableSelection.type === 'table') {
        const seed = normalizeSelectionInfo(
          safeCall(() => hostMethod(host, 'readLiveSelectionSyncSnapshot')?.(), null),
        );
        if (
          seed &&
          !seed.selectionTarget &&
          captureWholeTableParagraphSeed(host, seed, isPlainObject(currentSelection) ? currentSelection : null)
        ) {
          seedAsyncRead('selection', asyncReads.get('selection')?.token ?? null, seed);
        }
      }
    }
    if (isNonCollapsedHostSelection(currentSelection)) {
      if (!(foreground && foreground.active > 0)) {
        setSelectionValidation({ held: false, pendingToken: null });
        issueAsyncRead('selection', selectionReadToken(), selectionCurrentRun, normalizeSelectionInfo);
      }
      return;
    }
    const read = host?.readLiveSelectionSyncSnapshot;
    if (typeof read !== 'function') return;
    const seed = normalizeSelectionInfo(safeCall(() => (read as AnyFn).call(host), null));
    if (!seed) return;
    if (wholeTableSelectionChanged) {
      setSelectionValidation({ held: false, pendingToken: null });
      wholeTableParagraphSeed = null;
      captureWholeTableParagraphSeed(host, seed, initialTableSelection);
      const token = selectionReadToken();
      seedAsyncRead('selection', token, seed);
      issueAsyncRead('selection', token, selectionCurrentRun, normalizeSelectionInfo);
      return;
    }
    if (!isCollapsedCaretSnapshot(seed)) return;
    const previousCaret = collapsedTextAddressFromSelection(state.selection);
    const nextCaret =
      collapsedTextAddressFromTarget(seed.selectionTarget) ?? collapsedTextAddressFromTarget(seed.target);
    const previousRange = previousCaret?.range as LooseRecord | undefined;
    const nextRange = nextCaret?.range as LooseRecord | undefined;
    const sameSeedCaret = Boolean(
      previousCaret &&
      nextCaret &&
      previousCaret.blockId === nextCaret.blockId &&
      storyLocatorSignature(previousCaret.story) === storyLocatorSignature(nextCaret.story) &&
      previousRange?.start === nextRange?.start,
    );
    const validation = selectionValidationSnapshot();
    const held =
      Boolean(foreground && foreground.active > 0) || (validation.held && (afterTypingPaint || sameSeedCaret));
    setSelectionValidation({ held, pendingToken: validation.pendingToken });
    const token = selectionReadToken();
    const deferAuthoritativeRead =
      Boolean(foreground && (foreground.active > 0 || foreground.pending > 0)) || (held && typingIsRecent());
    if (!deferAuthoritativeRead) {
      setSelectionValidation({ held, pendingToken: null });
      const completed = issueAsyncRead('selection', token, selectionCurrentRun, normalizeSelectionInfo);
      if (completed) return;
    } else {
      setSelectionValidation({ held, pendingToken: token });
      scheduleForegroundAsyncRetry();
    }
    const prev = asyncReads.get('selection');
    const sameActiveTypingCaret = Boolean(
      foreground &&
      foreground.active > 0 &&
      previousCaret &&
      nextCaret &&
      previousCaret.blockId === nextCaret.blockId &&
      storyLocatorSignature(previousCaret.story) === storyLocatorSignature(nextCaret.story) &&
      typeof previousRange?.start === 'number' &&
      typeof nextRange?.start === 'number' &&
      Math.abs(nextRange.start - previousRange.start) <= 2,
    );
    const seedMarks =
      Array.isArray(seed.activeMarks) && seed.activeMarks.length > 0
        ? seed.activeMarks
        : (sameSeedCaret || sameActiveTypingCaret) && Array.isArray(state.selection.activeMarks)
          ? state.selection.activeMarks
          : [];
    const seedCommentIds = Array.isArray(seed.activeCommentIds) ? seed.activeCommentIds : [];
    const paintedTrackChangeId = readCollapsedHostTrackChangeId(hostSelectionSnapshot);
    const mayCarryTrackedChange = paintedTrackChangeId != null || sameActiveTypingCaret;
    const carriedChangeIds = mayCarryTrackedChange
      ? state.selection.activeChangeIds.filter(
          (id) =>
            paintedTrackChangeId == null ||
            buildTrackedChangeIdContext(state.trackChanges.items).aliasesFor(id).includes(paintedTrackChangeId),
        )
      : [];
    const seedChangeIds =
      Array.isArray(seed.activeChangeIds) && seed.activeChangeIds.length > 0 ? seed.activeChangeIds : carriedChangeIds;
    seedAsyncRead(
      'selection',
      token,
      {
        ...seed,
        activeMarks: seedMarks,
        activeCommentIds: seedCommentIds,
        activeChangeIds: seedChangeIds,
      },
      deferAuthoritativeRead ? null : (prev?.inflightToken ?? null),
    );
  };

  const selectionInfoMatchesHost = (info: SelectionInfo | null): boolean => {
    const snapshot = readHostSelectionSnapshot() as LooseRecord | null;
    const target = info?.selectionTarget as LooseRecord | undefined;
    if (!snapshot || target?.kind !== 'selection') return false;
    const matches = (rawPoint: unknown, rawEndpoint: unknown): boolean => {
      const point = isPlainObject(rawPoint) ? rawPoint : undefined;
      const endpoint = isPlainObject(rawEndpoint) ? rawEndpoint : undefined;
      const offset = target.coordinateSpace === 'tracked' ? endpoint?.trackedBlockOffset : endpoint?.blockOffset;
      return (
        point?.kind === 'text' &&
        typeof point.blockId === 'string' &&
        point.blockId === endpoint?.blockId &&
        typeof point.offset === 'number' &&
        point.offset === offset &&
        storyLocatorSignature(point.story ?? target.story) === storyLocatorSignature(endpoint?.story ?? snapshot.story)
      );
    };
    return (
      (matches(target.start, snapshot.anchor) && matches(target.end, snapshot.focus)) ||
      (matches(target.start, snapshot.focus) && matches(target.end, snapshot.anchor))
    );
  };

  const readSelectionInfoFresh = async (attempt = 0): Promise<SelectionSlice> => {
    const doc = getDoc();
    const selectionApi = doc?.selection as LooseRecord | undefined;
    const current = selectionApi?.current;
    const token = selectionReadToken();
    const sourceToken = contentToken();
    const mode = readDocumentMode();

    if (typeof current !== 'function') {
      seedAsyncRead('selection', token, null);
      recompute();
      return selectionSliceFromInfo(null, 'pending');
    }

    let raw: unknown;
    try {
      raw = current.call(selectionApi, {
        includeText: true,
        ...(getEditor()?.editorVersion === 2 ? { offsetSpace: 'selection' } : {}),
      });
      if (isPromiseLike(raw)) raw = await Promise.resolve(raw);
    } catch {
      raw = null;
    }

    if (disposed) return selectionSliceFromInfo(null, 'pending');
    const info = normalizeSelectionInfo(raw);
    // Native ACK and applied-frame notifications can advance the local epoch
    // while the ordered worker read already describes their final selection.
    // Accept that advance only when the current host endpoints prove the read.
    if (
      selectionReadToken() !== token &&
      !(
        getDoc() === doc &&
        contentToken() === sourceToken &&
        readDocumentMode() === mode &&
        selectionInfoMatchesHost(info)
      )
    ) {
      return attempt < 1 ? readSelectionInfoFresh(attempt + 1) : selectionSliceFromInfo(null, 'pending');
    }

    seedAsyncRead('selection', selectionReadToken(), info);
    const selection = selectionSliceFromInfo(info, info ? 'ready' : 'pending');
    recompute();
    return selection;
  };

  const realComments = (items: readonly unknown[]): CommentInfo[] =>
    items.filter((item) => !isSyntheticTrackedChangeCommentLaneItem(item)) as CommentInfo[];
  let lastWindowComments: { source: readonly unknown[]; rows: readonly unknown[]; real: CommentInfo[] } | null = null;
  const realCommentsOfWindow = (window: LooseRecord | null): CommentInfo[] | null => {
    const items: unknown = window?.commentItems;
    if (!Array.isArray(items)) return null;
    const last = lastWindowComments;
    if (last?.source === items && shallowEqual(last.rows, items)) return last.real;
    lastWindowComments = { source: items, rows: [...items], real: realComments(items) };
    return lastWindowComments.real;
  };

  const readCommentsDirectory = (immediate = false) => {
    const doc = getDoc();
    const listComments = hostMethod(doc?.comments, 'list');
    return readAsync<CommentInfo[]>(
      'comments',
      commentsDirectoryToken(),
      () => (listComments ? listComments() : undefined),
      (raw) => {
        const items: unknown = isPlainObject(raw) ? raw.items : undefined;
        return Array.isArray(items) ? realComments(items) : [];
      },
      immediate,
      contentToken(),
    );
  };

  const readTrackChangesDirectory = (key = 'trackChanges') => {
    const token = contentToken();
    const doc = getDoc();
    const listTrackChanges = hostMethod(doc?.trackChanges, 'list');
    const v2TrackedChanges = getV2TrackedChanges();
    const listTrackedChanges = hostMethod(v2TrackedChanges, 'listTrackedChanges');
    const read = readAsync<LooseRecord[]>(
      key,
      token,
      () => {
        if (listTrackedChanges) return runUiTrackedChangesCatalogRead(() => listTrackChanges?.({ in: 'all' }));
        return listTrackChanges ? listTrackChanges({ in: 'all' }) : undefined;
      },
      (raw) => {
        const result = raw && typeof raw === 'object' ? (raw as LooseRecord) : null;
        heavyReadGate.noteTrackChangesDirectoryRead(
          key,
          token,
          result?.complete === false || result?.sourceCoverageComplete === false ? 'partial' : 'complete',
        );
        return result && Array.isArray(result.items) ? (result.items as LooseRecord[]) : [];
      },
    );
    return incompleteTrackChangesDirectoryReadTokens.get(key) === token && read.status === 'ready'
      ? { ...read, status: 'stale' as const }
      : read;
  };

  const computeComments = (selection: SelectionSlice): CommentsSlice => {
    const reviewWindow = getV2ReviewWindowSnapshot();
    const hasWindowFeed = hasV2ReviewWindowFeed();
    const catalog = !hasWindowFeed ? readCommentsDirectory() : null;
    const windowItems = hasWindowFeed ? realCommentsOfWindow(reviewWindow) : null;
    const value = hasWindowFeed ? windowItems : catalog!.value;
    const listStatus = hasWindowFeed ? reviewWindowSliceStatus(reviewWindow) : catalog!.status;
    const items = value ?? [];
    const activeIds = selection.activeCommentIds;
    const directory = asyncReads.get('comments');
    const directoryItems =
      directory?.token === commentsDirectoryToken() && directory.hasSettled && Array.isArray(directory.value)
        ? directory.value
        : null;
    // An open document-wide consumer may focus an off-window row. Preserve it
    // while that directory is refreshing, and validate it against the settled
    // directory rather than against the painted page window.
    const activeValidationItems = directoryLeaseCounts.comments > 0 ? directoryItems : items;
    if (
      explicitActiveCommentId &&
      activeValidationItems &&
      (activeValidationItems !== items || listStatus === 'ready')
    ) {
      explicitActiveCommentId = resolveActiveCommentId(activeValidationItems, explicitActiveCommentId);
    }
    const activeId = explicitActiveCommentId ?? activeIds[0] ?? null;
    return {
      status: combineStatus(listStatus, selection.status),
      listStatus,
      items,
      total: items.length,
      activeIds,
      activeId,
    };
  };

  const projectedTrackChangesCache = new WeakMap<object, readonly TrackChangesItem[]>();
  const projectTrackChangesItems = (source: readonly unknown[]): readonly TrackChangesItem[] => {
    const cached = projectedTrackChangesCache.get(source as object);
    if (cached) return cached;
    const projected = source.map(projectTrackChangesItem).filter((item): item is TrackChangesItem => item != null);
    projectedTrackChangesCache.set(source as object, projected);
    return projected;
  };
  const filteredTrackChangesCache = new WeakMap<
    object,
    { suppressedIds: ReadonlySet<string> | null; value: readonly TrackChangesItem[] }
  >();
  const filterPostDecisionTrackChanges = (
    source: readonly TrackChangesItem[],
    suppressedIds: ReadonlySet<string> | null,
  ): readonly TrackChangesItem[] => {
    const cached = filteredTrackChangesCache.get(source as object);
    if (cached?.suppressedIds === suppressedIds) return cached.value;
    const filtered = suppressedIds
      ? source.filter((item) => {
          const id = readEntityId(item);
          return !id || !suppressedIds.has(id);
        })
      : source;
    filteredTrackChangesCache.set(source as object, { suppressedIds, value: filtered });
    return filtered;
  };

  const trackChangeAuthorsCache = new WeakMap<object, readonly string[]>();
  const trackChangeAuthors = (items: readonly TrackChangesItem[]): readonly string[] => {
    const cached = trackChangeAuthorsCache.get(items as object);
    if (cached) return cached;
    const authors = new Set<string>();
    for (const item of items) {
      const change = trackChangesItemPayload(item);
      const author = change.author ?? change.authorEmail ?? item.author ?? item.authorEmail;
      if (typeof author === 'string') authors.add(author);
    }
    const value = [...authors];
    trackChangeAuthorsCache.set(items as object, value);
    return value;
  };

  // Story-scoped interactions validate against the committed window. If an
  // explicit all-changes consumer has already loaded the current directory,
  // that directory is also safe to use; this helper never starts a read.
  const readAllStoryTrackChanges = (): readonly TrackChangesItem[] | null => {
    const token = contentToken();
    if (hasV2ReviewWindowFeed()) {
      const directory = asyncReads.get('trackChanges');
      const source =
        directory?.token === token && directory.hasSettled && Array.isArray(directory.value)
          ? directory.value
          : getV2ReviewWindowSnapshot()?.trackedChangeItems;
      if (!Array.isArray(source)) return null;
      return projectTrackChangesItems(source);
    }
    const { value, status } = readTrackChangesDirectory('trackChanges:all');
    return status === 'ready' ? projectTrackChangesItems(value ?? []) : null;
  };

  const computeTrackChanges = (selection: SelectionSlice): TrackChangesSlice => {
    const token = contentToken();
    const postDecisionIds = postDecisionTrackChangeIdsForToken(token);
    const reviewWindow = getV2ReviewWindowSnapshot();
    const hasWindowFeed = hasV2ReviewWindowFeed();
    const catalog = !hasWindowFeed ? readTrackChangesDirectory() : null;
    const windowItems =
      hasWindowFeed && Array.isArray(reviewWindow?.trackedChangeItems)
        ? (reviewWindow.trackedChangeItems as LooseRecord[])
        : null;
    const value = hasWindowFeed ? windowItems : catalog!.value;
    const listStatus = hasWindowFeed ? reviewWindowSliceStatus(reviewWindow) : catalog!.status;
    const items = filterPostDecisionTrackChanges(projectTrackChangesItems(value ?? []), postDecisionIds);
    const allStoryItems = readAllStoryTrackChanges();
    // Drop an explicit focus that no longer exists. A story-scoped active is
    // validated against the current-token set with the same id+story matcher
    // `getAt` uses. Never clear it while that read is unsettled (`null`) so a
    // transient refresh cannot drop focus.
    const active = explicitActiveChange;
    if (active && !pendingTrackChangeRevealFocuses.has(active)) {
      const directory = asyncReads.get('trackChanges');
      const directoryItems =
        directory?.token === token &&
        directory.hasSettled &&
        Array.isArray(directory.value) &&
        incompleteTrackChangesDirectoryReadTokens.get('trackChanges') !== token
          ? filterPostDecisionTrackChanges(projectTrackChangesItems(directory.value), postDecisionIds)
          : null;
      const activeValidationItems =
        directoryItems ?? (directoryLeaseCounts.trackChanges > 0 ? null : active.story ? allStoryItems : items);
      if (
        activeValidationItems &&
        !activeValidationItems.some((row) => entityRowMatchesRequest(row, active.id, active.story))
      ) {
        setExplicitActiveChange(null);
      }
    }
    const publicIdItems = allStoryItems ?? items;
    const selectionActiveChangeIds =
      allTrackedChangesResolvedToken === token
        ? []
        : postDecisionIds
          ? selection.activeChangeIds.filter((id) => !postDecisionIds.has(id))
          : selection.activeChangeIds;
    let selectionPublicChangeIds: string[] = [];
    if (selectionActiveChangeIds.length > 0) {
      const selectionIdContext = buildStoryScopedTrackedChangeIdContext(publicIdItems, selectionStory(selection));
      selectionPublicChangeIds = selectionActiveChangeIds.map((id) => selectionIdContext.toPublicId(id) ?? id);
    }
    let explicitActiveId: string | null = null;
    if (explicitActiveChange) {
      const explicitActiveIdContext = explicitActiveChange.story
        ? buildStoryScopedTrackedChangeIdContext(publicIdItems, explicitActiveChange.story)
        : buildTrackedChangeIdContext(publicIdItems);
      explicitActiveId = explicitActiveIdContext.toPublicId(explicitActiveChange.id) ?? explicitActiveChange.id;
    }
    // #939 maps selection ids to public ids through the selection's own story.
    // This resolver then applies the story guards on top: a non-body selection
    // must not fall back to unscoped body aliasing, and a body selection must not
    // alias onto a row that never declared a story.
    const selectionActiveId = resolveSelectionActiveChangeId({
      selectionIds: selectionActiveChangeIds,
      publicIds: selectionPublicChangeIds,
      selection,
      bodyItems: items,
      allStoryItems,
    });
    const activeId = explicitActiveId ?? selectionActiveId;
    return {
      status: combineStatus(listStatus, selection.status),
      listStatus,
      analysis: reviewWindowAnalysis(getV2ReviewWindowSnapshot()),
      items,
      total: items.length,
      activeId,
      authors: trackChangeAuthors(items),
    };
  };

  const computeCommentsDirectorySnapshot = (
    selection: SelectionSlice,
    windowSnapshot: CommentsSlice,
  ): CommentsSlice => {
    if (!hasV2ReviewWindowFeed()) return windowSnapshot;
    demandHeavyDocRead('comments');
    const directory = readCommentsDirectory();
    const items = directory.value ?? windowSnapshot.items;
    return {
      status: combineStatus(directory.status, selection.status),
      listStatus: directory.status,
      items,
      total: items.length,
      activeIds: selection.activeCommentIds,
      activeId: explicitActiveCommentId ?? selection.activeCommentIds[0] ?? null,
    };
  };

  const computeTrackChangesDirectorySnapshot = (
    selection: SelectionSlice,
    windowSnapshot: TrackChangesSlice,
  ): TrackChangesSlice => {
    if (!hasV2ReviewWindowFeed()) return windowSnapshot;
    demandHeavyDocRead('trackChanges');
    const directory = readTrackChangesDirectory();
    const postDecisionIds = postDecisionTrackChangeIdsForToken(contentToken());
    const items = filterPostDecisionTrackChanges(
      projectTrackChangesItems(directory.value ?? windowSnapshot.items),
      postDecisionIds,
    );
    let activeId = windowSnapshot.activeId;
    if (explicitActiveChange) {
      const explicitIdContext = explicitActiveChange.story
        ? buildStoryScopedTrackedChangeIdContext(items, explicitActiveChange.story)
        : buildTrackedChangeIdContext(items);
      activeId = explicitIdContext.toPublicId(explicitActiveChange.id) ?? explicitActiveChange.id;
    }
    return {
      status: combineStatus(directory.status, selection.status),
      listStatus: directory.status,
      items,
      total: items.length,
      activeId,
      authors: trackChangeAuthors(items),
    };
  };

  let settledActiveContentControlsToken: string | null = null;
  let settledActiveContentControls: ContentControlInfo[] = [];

  const retainSettledActiveContentControls = (
    items: ContentControlInfo[],
    status: SliceStatus,
  ): { items: ContentControlInfo[]; status: SliceStatus } => {
    const token = contentToken();
    if (status === 'ready') {
      settledActiveContentControlsToken = token;
      settledActiveContentControls = items;
      return { items, status };
    }
    if (status === 'pending' && settledActiveContentControlsToken === token) {
      return { items: settledActiveContentControls, status: 'stale' };
    }
    return { items, status };
  };

  const computeContentControls = (selection: SelectionSlice): ContentControlsSlice => {
    const doc = getDoc();
    const ccApi = doc?.contentControls as LooseRecord | undefined;
    const listContentControls = hostMethod(ccApi, 'list');
    const { value, status: listStatus } = readAsync<ContentControlsSlice['items']>(
      'contentControls',
      contentToken(),
      () => (listContentControls ? listContentControls() : undefined),
      (raw) =>
        raw && Array.isArray((raw as LooseRecord).items)
          ? ((raw as LooseRecord).items as ContentControlsSlice['items'])
          : [],
    );
    const catalogItems = value ?? [];
    const { items: activeItems, status: rangeStatus } = computeActiveContentControls(ccApi, selection);
    const activeById = new Map(activeItems.map((item) => [item.id, item]));
    const catalogIds = new Set(catalogItems.map((item) => item.id));
    const items = [
      ...catalogItems.map((item) => activeById.get(item.id) ?? item),
      ...activeItems.filter((item) => !catalogIds.has(item.id)),
    ];
    const activeIds = activeItems.map((item) => item.id);
    return {
      status: combineStatus(listStatus, rangeStatus, selection.status),
      items,
      total: items.length,
      activeId: activeIds[0] ?? null,
      activeIds,
    };
  };

  /**
   * Lock mode of every content control overlapping the current selection's
   * block range, keyed by control id. Powers `contentControlLockReason` so the
   * toolbar can disable styling controls when the selection touches a
   * `contentLocked`/`sdtContentLocked` control (SD-3274) — block-range scoped.
   */
  const computeActiveContentControlLockModes = (
    ccApi: LooseRecord | undefined,
    selection: SelectionSlice,
  ): { lockModesById: ReadonlyMap<string, string>; rows: readonly ContentControlInfo[]; status: SliceStatus } => {
    const listInRange = hostMethod(ccApi, 'listInRange');
    if (!listInRange) {
      return { lockModesById: new Map(), rows: [], status: 'ready' };
    }
    const range = selectionBlockRange(selection);
    if (!range) return { lockModesById: new Map(), rows: [], status: 'ready' };
    const { value, status } = readAsync<ContentControlInfo[]>(
      `contentControls:inRange:${selectionSignature(selection)}`,
      contentToken(),
      () => listInRange(range),
      (raw) =>
        raw && Array.isArray((raw as LooseRecord).items) ? ((raw as LooseRecord).items as ContentControlInfo[]) : [],
    );
    const rows = value ?? [];
    const lockModesById = new Map<string, string>();
    for (const row of rows) {
      if (typeof row?.id === 'string')
        lockModesById.set(row.id, typeof row.lockMode === 'string' ? row.lockMode : 'unlocked');
    }
    return { lockModesById, rows, status };
  };

  const computeSelectionContentControlLockModes = (
    ccApi: LooseRecord | undefined,
    selection: SelectionSlice,
  ): { lockModesById: ReadonlyMap<string, string> } => {
    const locked = selectionContentLocks.get(selection);
    return locked === undefined
      ? computeActiveContentControlLockModes(ccApi, selection)
      : { lockModesById: new Map(locked ? [['selection', 'contentLocked']] : []) };
  };

  const computeActiveContentControls = (
    ccApi: LooseRecord | undefined,
    selection: SelectionSlice,
  ): { items: ContentControlInfo[]; status: SliceStatus } => {
    const { rows, status } = computeActiveContentControlLockModes(ccApi, selection);
    const explicitTarget = selection.selectionTarget;
    const selectionTarget = selection.target;
    let selectionAnchor: { blockId: string; offset: number; story?: unknown };
    if (explicitTarget) {
      const explicitStart = isPlainObject(explicitTarget.start) ? explicitTarget.start : undefined;
      if (
        explicitTarget.kind !== 'selection' ||
        explicitStart?.kind !== 'text' ||
        typeof explicitStart.blockId !== 'string' ||
        typeof explicitStart.offset !== 'number'
      ) {
        return retainSettledActiveContentControls([], status);
      }
      selectionAnchor = { blockId: explicitStart.blockId, offset: explicitStart.offset, story: explicitStart.story };
    } else {
      const firstSegment = selectionTarget?.kind === 'text' ? textTargetSegments(selectionTarget)[0] : undefined;
      const firstRange = firstSegment?.range;
      if (typeof firstSegment?.blockId !== 'string' || typeof firstRange?.start !== 'number') {
        return retainSettledActiveContentControls([], status);
      }
      selectionAnchor = { blockId: firstSegment.blockId, offset: firstRange.start, story: selectionTarget?.story };
    }
    const visibleSegments = selectionTarget?.coordinateSpace !== 'tracked' ? textTargetSegments(selectionTarget) : [];
    const visibleSegment = visibleSegments.find((segment) => segment.blockId === selectionAnchor.blockId);
    const visibleRange = visibleSegment?.range;
    const visibleStart =
      visibleSegment && typeof visibleSegment.blockId === 'string' && typeof visibleRange?.start === 'number'
        ? {
            blockId: visibleSegment.blockId,
            offset: visibleRange.start,
            story: selectionTarget?.story ?? selectionAnchor.story,
          }
        : null;
    const targetCoordinateSpace =
      (explicitTarget ? explicitTarget.coordinateSpace : selectionTarget?.coordinateSpace) === 'tracked'
        ? 'tracked'
        : 'visible';
    const selectionStart = targetCoordinateSpace === 'tracked' ? visibleStart : selectionAnchor;
    const selectedBlockIds = selectionBlockIds(selection);
    const selectionStartIndex = selectedBlockIds.indexOf((selectionStart ?? selectionAnchor).blockId);

    const activeItems = rows
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const itemTarget = item.selectionTarget as LooseRecord | null | undefined;
        const itemCoordinateSpace = itemTarget?.coordinateSpace === 'tracked' ? 'tracked' : 'visible';
        if (itemCoordinateSpace === 'tracked' && targetCoordinateSpace !== 'tracked') return false;
        const start = itemCoordinateSpace === 'tracked' ? selectionAnchor : selectionStart;
        if (!start) return false;
        const itemStart = itemTarget?.start as LooseRecord | undefined;
        const itemEnd = itemTarget?.end as LooseRecord | undefined;
        if (
          itemTarget?.kind !== 'selection' ||
          itemStart?.kind !== 'text' ||
          itemEnd?.kind !== 'text' ||
          typeof itemStart.blockId !== 'string' ||
          typeof itemEnd.blockId !== 'string' ||
          typeof itemStart.offset !== 'number' ||
          typeof itemEnd.offset !== 'number'
        ) {
          return false;
        }
        if (
          storyLocatorSignature(itemTarget.story ?? itemStart.story ?? itemEnd.story) !==
          storyLocatorSignature(explicitTarget?.story ?? start.story)
        ) {
          return false;
        }
        if (itemStart.blockId === itemEnd.blockId) {
          if (start.blockId !== itemStart.blockId) return false;
          const low = Math.min(itemStart.offset, itemEnd.offset);
          const high = Math.max(itemStart.offset, itemEnd.offset);
          return low === high ? start.offset === low : start.offset >= low && start.offset < high;
        }
        if (start.blockId === itemStart.blockId) return start.offset >= itemStart.offset;
        if (start.blockId === itemEnd.blockId) return start.offset < itemEnd.offset;
        if (selectionStartIndex === -1) return false;
        const itemStartIndex = selectedBlockIds.indexOf(itemStart.blockId);
        const itemEndIndex = selectedBlockIds.indexOf(itemEnd.blockId);
        if (itemStartIndex !== -1 && itemEndIndex !== -1) {
          const low = Math.min(itemStartIndex, itemEndIndex);
          const high = Math.max(itemStartIndex, itemEndIndex);
          return selectionStartIndex > low && selectionStartIndex < high;
        }
        if (itemStartIndex !== -1) return selectionStartIndex > itemStartIndex;
        if (itemEndIndex !== -1) return selectionStartIndex < itemEndIndex;
        return true;
      })
      .sort((left, right) => {
        const leftTarget = left.item.selectionTarget!;
        const rightTarget = right.item.selectionTarget!;
        const leftSameBlock =
          leftTarget.start.kind === 'text' &&
          leftTarget.end.kind === 'text' &&
          leftTarget.start.blockId === leftTarget.end.blockId;
        const rightSameBlock =
          rightTarget.start.kind === 'text' &&
          rightTarget.end.kind === 'text' &&
          rightTarget.start.blockId === rightTarget.end.blockId;
        if (leftSameBlock !== rightSameBlock) return leftSameBlock ? -1 : 1;
        if (left.item.kind !== right.item.kind) return left.item.kind === 'inline' ? -1 : 1;
        if (
          leftSameBlock &&
          rightSameBlock &&
          leftTarget.start.kind === 'text' &&
          leftTarget.end.kind === 'text' &&
          rightTarget.start.kind === 'text' &&
          rightTarget.end.kind === 'text'
        ) {
          const leftSpan = Math.abs(leftTarget.end.offset - leftTarget.start.offset);
          const rightSpan = Math.abs(rightTarget.end.offset - rightTarget.start.offset);
          if (leftSpan !== rightSpan) return leftSpan - rightSpan;
        }
        return right.index - left.index;
      })
      .map(({ item }) => item);
    return retainSettledActiveContentControls(activeItems, status);
  };

  const computeFonts = (): FontsSlice => {
    const getDocumentFontOptions = hostMethod(superdoc?.fonts, 'getDocumentFontOptions');
    const getFontFamilyOptions = hostMethod(superdoc?.fonts, 'getFontFamilyOptions');
    // Merge document-used families ahead of the runtime picker list (first wins
    // on case-insensitive value). `getFontFamilyOptions()` remains the source
    // for the default picker rows; the static defaults below are only an older
    // host / unavailable-runtime fallback.
    //
    //  1. Document-used families (`getDocumentFontOptions`) — e.g. theme Cambria (SD-3887)
    //  2. Runtime picker rows (`getFontFamilyOptions`) — the existing default picker list
    //
    // `getDocumentFontOptions` returns `{ logicalFamily, previewFamily }`; normalize before
    // compose so those rows are not dropped (the old `option.value` check caused SD-3887).
    const documentOptions = normalizeDocumentFontOptions(
      safeCall<unknown>(getDocumentFontOptions ? () => getDocumentFontOptions() : undefined, []),
    );
    const pickerOptions = normalizePickerFontOptions(
      safeCall<unknown>(getFontFamilyOptions ? () => getFontFamilyOptions() : undefined, []),
    );
    return {
      options: composeFontFamilyOptions(documentOptions, pickerOptions),
      sizeOptions: DEFAULT_FONT_SIZE_OPTIONS,
    };
  };

  const EMPTY_HISTORY: HistorySlice = { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 };
  let historySlice = EMPTY_HISTORY;
  let historySource: LooseRecord | null = null;
  const computeHistory = (): HistorySlice => {
    const source = getEditCommands();
    if (source !== historySource) {
      historySource = source;
      historySlice = EMPTY_HISTORY;
    }
    const snapshot = readEditCommandSnapshot();
    const read = isPlainObject(snapshot) && isPlainObject(snapshot.history) ? snapshot.history : null;
    const { undoDepth, redoDepth } = read ?? {};
    if (typeof undoDepth !== 'number' || typeof redoDepth !== 'number') return historySlice;
    const next = { canUndo: undoDepth > 0, canRedo: redoDepth > 0, undoDepth, redoDepth };
    if (!shallowEqual(next, historySlice)) historySlice = next;
    return historySlice;
  };

  let zoomFitWidth: ZoomSlice['fitWidth'] | undefined;
  const computeZoom = (): ZoomSlice => {
    const getZoomState = hostMethod(superdoc, 'getZoomState');
    const rawState = safeCall<unknown>(getZoomState ? () => getZoomState() : undefined, null);
    const state = isPlainObject(rawState) ? rawState : null;
    const value = typeof state?.value === 'number' ? state.value : 100;
    const rawMode = state?.mode;
    const mode = rawMode === 'manual' || rawMode === 'fit-width' ? rawMode : rawMode === 'fixed' ? 'manual' : null;
    const fit = isPlainObject(state?.fitWidth) ? state.fitWidth : undefined;
    const min = typeof fit?.min === 'number' ? fit.min : typeof state?.min === 'number' ? state.min : 10;
    const max = typeof fit?.max === 'number' ? fit.max : typeof state?.max === 'number' ? state.max : 100;
    // Slice subscriptions use shallow equality. Reuse unchanged policy metadata
    // so unrelated editor updates do not notify every zoom consumer.
    if (!zoomFitWidth || zoomFitWidth.min !== min || zoomFitWidth.max !== max) zoomFitWidth = { min, max };
    return { mode, value, fitWidth: zoomFitWidth, min, max };
  };

  const readMeasurementUnit = (): 'in' | 'cm' => {
    const getMeasurementUnit = hostMethod(superdoc, 'getMeasurementUnit');
    const unit = safeCall<unknown>(getMeasurementUnit ? () => getMeasurementUnit() : undefined, 'in');
    return unit === 'cm' ? 'cm' : 'in';
  };

  const computeDocument = (): DocumentSlice => {
    const editor = getEditor();
    const editorDirty = editor ? (editor as LooseRecord).isDirty : undefined;
    return {
      ready: editor != null,
      mode: readDocumentMode(),
      dirty: editor ? (editorDirty === undefined ? hasLocalDocumentMutation() : Boolean(editorDirty)) : false,
    };
  };

  /**
   * Resolve the `query.match` row covering the current selection through the
   * async read coordinator. The promise-capable browser `query.match` is read
   * via the cache (keyed by selection signature + content revision), so inline
   * value projection no longer collapses to empty when the read is async.
   */
  const selectionTextQueryRequest = (selection: SelectionSlice): LooseRecord | null => {
    const pattern = selection.quotedText;
    if (typeof pattern !== 'string' || pattern.length === 0) return null;
    const segments = selectionTextSegments(selection);
    if (segments.length === 0 || !canProbeEverySelectedBlock(segments.map((segment) => segment.blockId))) return null;
    const within = segments.length === 1 ? paragraphTarget(segments[0].blockId, selection.target?.story) : undefined;
    return {
      select: { type: 'text', pattern, mode: 'contains', caseSensitive: true },
      ...(within ? { within } : {}),
      require: 'any',
    };
  };

  const resolveSelectionTextQueryItem = (selection: SelectionSlice): LooseRecord | null => {
    const match = hostMethod(getDoc()?.query, 'match');
    if (!match) return null;
    const request = selectionTextQueryRequest(selection);
    if (!request) return null;
    const { value } = readAsync<LooseRecord>(
      `query:${selectionSignature(selection)}`,
      contentToken(),
      () => match(request),
      (raw) => (raw && typeof raw === 'object' ? (raw as LooseRecord) : null),
    );
    return pickSelectionTextQueryItem(value, selection);
  };

  /**
   * Effective (cascade-resolved) font family / size for the selection, read from
   * the mounted layout and matched by source node id (SD-3652). The Document API
   * query surfaces only DIRECT run properties, so inherited fonts have no
   * projected value; the layout has already resolved them for painting.
   */
  const appliedSelectionPresentation = (selection: SelectionSlice): LooseRecord | null => {
    const read =
      hostMethod(getDoc()?.selection, 'readPresentation') ?? hostMethod(getHost(), 'readAppliedSelectionPresentation');
    if (!read) return null;
    const raw = safeCall<unknown>(read, null);
    const value = isPlainObject(raw) ? raw : null;
    const info = normalizeSelectionInfo(value?.selection);
    return value && info && selectionSignature(selectionSliceFromInfo(info, 'ready')) === selectionSignature(selection)
      ? value
      : null;
  };

  const resolveEffectiveInlineValuesFromLayout = (selection: SelectionSlice): ProjectedInlineSelectionValues => {
    const applied = appliedSelectionPresentation(selection);
    if (applied) return applied.inlineStyle ?? {};
    const host = getHost();
    const blockIds = new Set(selectionBlockIds(selection));
    if (blockIds.size === 0) return {};
    const readByIds = host?.readMountedProjectionBlocksByIds;
    const readAll = host?.readMountedProjectionBlocks;
    if (typeof readByIds !== 'function' && typeof readAll !== 'function') return {};
    const blocks = safeCall<unknown>(() => {
      if (typeof readByIds !== 'function') return (readAll as AnyFn).call(host);
      const story = selectionStoryLocator(selection);
      return story ? readByIds.call(host, [...blockIds], story) : readByIds.call(host, [...blockIds]);
    }, null);
    if (!Array.isArray(blocks)) return {};
    // Flatten nested (table-cell) blocks and match by sourceNodeId OR block.id.
    const flatBlocks = collectProjectionTextBlocks(blocks);
    const runFontValues = (run: LooseRecord): ProjectedInlineSelectionValues => {
      const out: ProjectedInlineSelectionValues = {};
      const family = normalizeLayoutFontFamily(run.fontFamily);
      if (family) out.fontFamily = family;
      const size = normalizeLayoutFontSizePt(run.fontSize as number);
      if (size) out.fontSize = size;
      // Color / highlight resolved effective-at-caret like font/size, so the swatch
      // reflects the caret's run after a pending mark is consumed (SD-3654).
      // Uppercased to match the direct-query normalization.
      if (typeof run.color === 'string' && run.color.trim() !== '') out.color = run.color.trim().toUpperCase();
      if (typeof run.highlight === 'string' && run.highlight.trim() !== '')
        out.highlight = run.highlight.trim().toUpperCase();
      return out;
    };

    // Collapsed caret: use the font of the run AT the caret, not whole-block
    // uniformity (a caret in a mixed-font paragraph would otherwise blank).
    // Text and tab runs both carry a `text` payload (a tab is `'\t'`, one
    // selectable char). Deleted revision runs are painted but occupy zero
    // selection offsets; projectionRunSelectionLength keeps later runs aligned.
    const caret = collapsedTextAddressFromSelection(selection);
    const caretOffset =
      caret && typeof (caret.range as LooseRecord)?.start === 'number'
        ? ((caret.range as LooseRecord).start as number)
        : null;
    if (caret && caretOffset !== null && blockIds.has(caret.blockId as string)) {
      const block = flatBlocks.find((b) => projectionBlockMatchesId(b, caret.blockId as string));
      const runs = block && Array.isArray(block.runs) ? (block.runs as LooseRecord[]) : null;
      if (runs && runs.length > 0 && runs.every((r) => r?.kind === 'text' || r?.kind === 'tab')) {
        // Half-open run intervals [start, end) for all but the final run: a
        // caret at a run boundary reports the FOLLOWING run. At the boundary
        // after a leading tab this deliberately diverges from Word's
        // preceding-character rule (the tab is list-marker chrome, not text
        // the user formatted); at paragraph end the caret reports the final
        // text-bearing run.
        let acc = 0;
        let chosen: LooseRecord | null = null;
        for (const run of runs) {
          const len = projectionRunSelectionLength(run);
          if (caretOffset >= acc && caretOffset < acc + len) {
            chosen = run;
            break;
          }
          acc += len;
        }
        if (!chosen) {
          for (let i = runs.length - 1; i >= 0 && !chosen; i -= 1) {
            if (runs[i]?.kind === 'text') chosen = runs[i]!;
          }
          chosen ??= runs[runs.length - 1] ?? null;
        }
        if (!chosen) return {};
        return runFontValues(chosen);
      }
    }

    // Range selection: uniformity across only the runs WITHIN the selected offset
    // range per block, not the whole block (a paragraph can mix fonts around the
    // selection). Painted deletions occupy zero selection offsets.
    const segments = selectionTextSegments(selection);
    if (segments.length > 0) {
      const rangeFamilies = new Set<string>();
      const rangeSizes = new Set<string>();
      let rangeSawRun = false;
      let offsetSafe = true;
      for (const seg of segments) {
        const block = flatBlocks.find((b) => projectionBlockMatchesId(b, seg.blockId));
        // A selected block absent from the mounted projection (e.g. only part
        // of a long selection is materialized) makes uniformity unknowable
        // HERE - fail closed rather than report the mounted subset as
        // representative of the full selection. The async effective-inline
        // uniformity read (worker-side, layout-independent) is the authority
        // for those selections (SD-3706).
        if (!block) return {};
        const runs = Array.isArray(block.runs) ? (block.runs as LooseRecord[]) : [];
        if (runs.length === 0) continue;
        // Text and tab runs both carry a `text` payload so offsets stay aligned
        // (SD-3706); any other run kind (object/field/break) is offset-unsafe.
        if (!runs.every((r) => r?.kind === 'text' || r?.kind === 'tab')) {
          offsetSafe = false;
          break;
        }
        let acc = 0;
        for (const run of runs) {
          const len = projectionRunSelectionLength(run);
          const runStart = acc;
          const runEnd = acc + len;
          // Run overlaps the selected [start, end) range.
          if (runStart < seg.end && runEnd > seg.start) {
            rangeSawRun = true;
            const values = runFontValues(run);
            if (values.fontFamily) rangeFamilies.add(values.fontFamily);
            if (values.fontSize) rangeSizes.add(values.fontSize);
          }
          acc = runEnd;
        }
      }
      if (offsetSafe && rangeSawRun) {
        const projection: ProjectedInlineSelectionValues = {};
        if (rangeFamilies.size === 1) projection.fontFamily = [...rangeFamilies][0];
        if (rangeSizes.size === 1) projection.fontSize = [...rangeSizes][0];
        return projection;
      }
    }

    // Fallback (object-bearing block / unresolved segments): whole-block uniformity.
    const families = new Set<string>();
    const sizes = new Set<string>();
    let sawRun = false;
    for (const block of flatBlocks) {
      const matchesSelection = [...blockIds].some((id) => projectionBlockMatchesId(block, id));
      if (!matchesSelection) continue;
      const runs = Array.isArray(block.runs) ? (block.runs as LooseRecord[]) : [];
      for (const run of runs) {
        if (run?.kind !== 'text') continue;
        sawRun = true;
        const values = runFontValues(run);
        if (values.fontFamily) families.add(values.fontFamily);
        if (values.fontSize) sizes.add(values.fontSize);
      }
    }
    if (!sawRun) return {};
    const projection: ProjectedInlineSelectionValues = {};
    if (families.size === 1) projection.fontFamily = [...families][0];
    if (sizes.size === 1) projection.fontSize = [...sizes][0];
    return projection;
  };

  /**
   * Effective (cascade-resolved) toggle-mark state read from the mounted
   * projection (SD-3860). `run.bold`/`run.italic`/`run.strike`/`run.underline`
   * on a projected run are already the FINAL merged value (style cascade +
   * any direct rPr override) — the same values `DomPainter` paints with — so
   * unlike the raw-rPr-only `selection.activeMarks` scan, this correctly
   * reports `false` for an explicit `<w:b w:val="0"/>` override even when a
   * paragraph/table style says bold. A key is left `undefined` when the
   * covered runs disagree (genuine mixed selection) or nothing could be read,
   * so the caller falls through to the worker-side uniformity read rather
   * than guessing. Mounted-projection `underline` is an object (`{}` /
   * `{ style: 'single' }`) when active, never a bare `true` — check presence.
   */
  const resolveEffectiveMarkValuesFromLayout = (selection: SelectionSlice): EffectiveMarkValues => {
    const applied = appliedSelectionPresentation(selection);
    if (applied) return applied.inlineStyle ?? {};
    const host = getHost();
    const blockIds = new Set(selectionBlockIds(selection));
    if (blockIds.size === 0) return {};
    const readByIds = host?.readMountedProjectionBlocksByIds;
    const readAll = host?.readMountedProjectionBlocks;
    if (typeof readByIds !== 'function' && typeof readAll !== 'function') return {};
    const blocks = safeCall<unknown>(() => {
      if (typeof readByIds !== 'function') return (readAll as AnyFn).call(host);
      const story = selectionStoryLocator(selection);
      return story ? readByIds.call(host, [...blockIds], story) : readByIds.call(host, [...blockIds]);
    }, null);
    if (!Array.isArray(blocks)) return {};
    const flatBlocks = collectProjectionTextBlocks(blocks);
    const runMarkValues = (run: LooseRecord): EffectiveMarkValues => ({
      bold: run.bold === true,
      italic: run.italic === true,
      underline: run.underline != null,
      strikethrough: run.strike === true,
    });
    const collapseMarkSets = (sets: Record<EffectiveMarkKey, Set<boolean>>): EffectiveMarkValues => {
      const out: EffectiveMarkValues = {};
      for (const key of EFFECTIVE_MARK_KEYS) {
        const set = sets[key];
        if (set.size === 1) out[key] = [...set][0];
      }
      return out;
    };

    // Collapsed caret: the run AT the caret, mirroring the font caret pick
    // above (same run-boundary rule, same tab/hanging-indent handling).
    const caret = collapsedTextAddressFromSelection(selection);
    const caretOffset =
      caret && typeof (caret.range as LooseRecord)?.start === 'number'
        ? ((caret.range as LooseRecord).start as number)
        : null;
    if (caret && caretOffset !== null && blockIds.has(caret.blockId as string)) {
      const block = flatBlocks.find((b) => projectionBlockMatchesId(b, caret.blockId as string));
      const runs = block && Array.isArray(block.runs) ? (block.runs as LooseRecord[]) : null;
      if (runs && runs.length > 0 && runs.every((r) => r?.kind === 'text' || r?.kind === 'tab')) {
        let acc = 0;
        let chosen: LooseRecord | null = null;
        for (const run of runs) {
          const len = projectionRunSelectionLength(run);
          if (caretOffset >= acc && caretOffset < acc + len) {
            chosen = run;
            break;
          }
          acc += len;
        }
        if (!chosen) {
          for (let i = runs.length - 1; i >= 0 && !chosen; i -= 1) {
            if (runs[i]?.kind === 'text') chosen = runs[i]!;
          }
          chosen ??= runs[runs.length - 1] ?? null;
        }
        if (!chosen) return {};
        return runMarkValues(chosen);
      }
    }

    // Range selection: uniformity across only the runs WITHIN the selected
    // offset range per block (mirrors the font range pass above).
    const segments = selectionTextSegments(selection);
    if (segments.length > 0) {
      const rangeSets: Record<EffectiveMarkKey, Set<boolean>> = {
        bold: new Set(),
        italic: new Set(),
        underline: new Set(),
        strikethrough: new Set(),
      };
      let rangeSawRun = false;
      let offsetSafe = true;
      for (const seg of segments) {
        const block = flatBlocks.find((b) => projectionBlockMatchesId(b, seg.blockId));
        if (!block) return {};
        const runs = Array.isArray(block.runs) ? (block.runs as LooseRecord[]) : [];
        if (runs.length === 0) continue;
        if (!runs.every((r) => r?.kind === 'text' || r?.kind === 'tab')) {
          offsetSafe = false;
          break;
        }
        let acc = 0;
        for (const run of runs) {
          const len = projectionRunSelectionLength(run);
          const runStart = acc;
          const runEnd = acc + len;
          if (runStart < seg.end && runEnd > seg.start) {
            rangeSawRun = true;
            const values = runMarkValues(run);
            for (const key of EFFECTIVE_MARK_KEYS) rangeSets[key].add(values[key]!);
          }
          acc = runEnd;
        }
      }
      if (offsetSafe && rangeSawRun) return collapseMarkSets(rangeSets);
    }

    // Fallback (object-bearing block / unresolved segments): whole-block uniformity.
    const wholeSets: Record<EffectiveMarkKey, Set<boolean>> = {
      bold: new Set(),
      italic: new Set(),
      underline: new Set(),
      strikethrough: new Set(),
    };
    let sawWholeRun = false;
    for (const block of flatBlocks) {
      const matchesSelection = [...blockIds].some((id) => projectionBlockMatchesId(block, id));
      if (!matchesSelection) continue;
      const runs = Array.isArray(block.runs) ? (block.runs as LooseRecord[]) : [];
      for (const run of runs) {
        if (run?.kind !== 'text') continue;
        sawWholeRun = true;
        const values = runMarkValues(run);
        for (const key of EFFECTIVE_MARK_KEYS) wholeSets[key].add(values[key]!);
      }
    }
    if (!sawWholeRun) return {};
    return collapseMarkSets(wholeSets);
  };

  type ProjectedInlineValuesRead = {
    values: ProjectedInlineSelectionValues;
    effectiveUniformityStatus: SliceStatus;
  };

  const completeProjectedInlineValues = (
    selection: SelectionSlice,
    direct: ProjectedInlineSelectionValues,
    effectiveInput = effectiveInlineUniformityInput(selection),
  ): ProjectedInlineValuesRead => {
    // Direct run overrides win; fill inherited font/size/color/highlight from the
    // resolved layout (so a caret reflects its run's effective values). The
    // direct query returns nothing at a collapsed caret, so the resolver is the
    // only source there.
    if (
      direct.fontFamily !== undefined &&
      direct.fontSize !== undefined &&
      direct.color !== undefined &&
      direct.highlight !== undefined
    ) {
      return { values: direct, effectiveUniformityStatus: 'ready' };
    }
    const resolved = resolveEffectiveInlineValuesFromLayout(selection);
    const combined: ProjectedInlineSelectionValues = {
      ...(resolved.fontFamily !== undefined ? { fontFamily: resolved.fontFamily } : {}),
      ...(resolved.fontSize !== undefined ? { fontSize: resolved.fontSize } : {}),
      ...(resolved.color !== undefined ? { color: resolved.color } : {}),
      ...(resolved.highlight !== undefined ? { highlight: resolved.highlight } : {}),
      ...direct,
    };
    // Full-selection resolution for unmounted blocks (SD-3706): effective
    // fonts are only readable from the mounted layout, and a large selection
    // never mounts its tail. When neither the direct query nor the layout
    // resolves font family/size, consult the internal worker-side
    // effective-inline uniformity read - uniform fills the value; a settled
    // mixed verdict stays blank (never a mounted subset as representative).
    if (!selection.empty && (combined.fontFamily === undefined || combined.fontSize === undefined)) {
      const uniformity = resolveEffectiveInlineUniformityValues(selection, effectiveInput);
      if (uniformity.values) {
        if (combined.fontFamily === undefined && uniformity.values.fontFamily !== undefined) {
          combined.fontFamily = uniformity.values.fontFamily;
        }
        if (combined.fontSize === undefined && uniformity.values.fontSize !== undefined) {
          combined.fontSize = uniformity.values.fontSize;
        }
      }
      return { values: combined, effectiveUniformityStatus: uniformity.status };
    }
    // A strict worker presentation read can be unavailable between native
    // input acceptance and its paint. An unresolved caret is still pending.
    if (
      selection.empty &&
      typeof getHost()?.readAppliedSelectionPresentation === 'function' &&
      !appliedSelectionPresentation(selection)
    ) {
      return { values: combined, effectiveUniformityStatus: 'pending' };
    }
    return { values: combined, effectiveUniformityStatus: 'ready' };
  };

  /**
   * Cached async access to the INTERNAL `format.readEffectiveInlineUniformity`
   * read (duck-typed; absent on hosts that do not provide it). Returns only
   * settled UNIFORM values - mixed and unresolvable keys stay undefined so the
   * toolbar renders its mixed/blank state, and a pending read serves nothing
   * (the held-value logic covers the transition).
   */
  // Full superset of keys the shared `effInline:` cache entry is always
  // populated with (SD-3860). The cache below (`readAsync`) is keyed only by
  // selection signature + content token, NOT by which `keys` were requested —
  // every caller MUST request this same fixed superset, or whichever caller
  // settles the cache first would starve a later caller of fields it never
  // asked for (e.g. a font-only read settling before a marks read needs it).
  const EFFECTIVE_INLINE_UNIFORMITY_KEYS = [
    'fontFamily',
    'fontSize',
    'bold',
    'italic',
    'underline',
    'strikethrough',
  ] as const;

  function effectiveInlineUniformityInput(selection: SelectionSlice): LooseRecord | null {
    const cellTarget = currentCellSelectionTarget();
    const paintedTarget = cellTarget ? null : currentUnrepresentableSelectionTarget(selection);
    const target = cellTarget ?? paintedTarget ?? selection.selectionTarget;
    if (!target) return null;
    const tableCellSelection = cellTarget ? tableCellSelectionForTarget(cellTarget) : null;
    return {
      target,
      offsetSpace: cellTarget || paintedTarget ? 'selection' : 'kernel',
      ...(tableCellSelection ? { tableCellSelection } : {}),
    };
  }

  function effectiveInlineUniformityCacheKey(
    selection: SelectionSlice,
    input = effectiveInlineUniformityInput(selection),
  ): string | null {
    if (!input) return null;
    const signature = input.tableCellSelection
      ? `${selectionKey({ selectionTarget: input.target })}|cells:${JSON.stringify(input.tableCellSelection)}`
      : (selectionEffectiveUniformitySignature(selection) ?? selectionSignature(selection));
    return `effInline:${signature}`;
  }

  const readEffectiveInlineUniformityCached = (
    selection: SelectionSlice,
    input = effectiveInlineUniformityInput(selection),
  ): { value: Record<string, EffectiveInlineUniformityState> | null; status: SliceStatus } => {
    const key = effectiveInlineUniformityCacheKey(selection, input);
    if (!input || key === null) return { value: null, status: 'ready' };
    const doc = getDoc();
    const op = resolveDocOperation(doc, 'format.readEffectiveInlineUniformity');
    if (!op) return { value: null, status: 'ready' };
    return readAsync(
      key,
      contentToken(),
      () => op({ ...input, keys: EFFECTIVE_INLINE_UNIFORMITY_KEYS }),
      readEffectiveInlineUniformityStates,
    );
  };

  const resolveEffectiveInlineUniformityValues = (
    selection: SelectionSlice,
    input = effectiveInlineUniformityInput(selection),
  ): {
    values: Pick<ProjectedInlineSelectionValues, 'fontFamily' | 'fontSize'> | null;
    status: SliceStatus;
  } => {
    const { value: states, status } = readEffectiveInlineUniformityCached(selection, input);
    if (!states) return { values: null, status };
    const uniform = (key: 'fontFamily' | 'fontSize'): string | undefined => {
      const entry = states[key];
      if (entry?.state !== 'uniform') return undefined;
      return key === 'fontFamily' ? normalizeLayoutFontFamily(entry.value) : entry.value;
    };
    return {
      values: { fontFamily: uniform('fontFamily'), fontSize: uniform('fontSize') },
      status,
    };
  };

  /** Worker-side cascade-resolved mark uniformity, for selections whose tail isn't mounted (SD-3860). */
  const resolveEffectiveMarkUniformityValues = (
    selection: SelectionSlice,
  ): { values: EffectiveMarkValues | null; status: SliceStatus } => {
    const { value: states, status } = readEffectiveInlineUniformityCached(selection);
    if (!states) return { values: null, status };
    const values: EffectiveMarkValues = {};
    for (const key of EFFECTIVE_MARK_KEYS) {
      const entry = states[key];
      if (entry?.state === 'uniform' && (entry.value === 'true' || entry.value === 'false')) {
        values[key] = entry.value === 'true';
      }
    }
    return { values, status };
  };

  /**
   * Effective active state for a toggle-mark command (bold/italic/underline/
   * strikethrough), SD-3860: the mounted-layout read is tried first (fast,
   * synchronous), then the worker uniformity read for unmounted content.
   * Returns `null` (no opinion) only when neither source has resolved yet,
   * in which case the caller falls back to the raw direct-only check.
   */
  const effectiveMarkActiveState = (descriptor: CommandDescriptor, selection: SelectionSlice): boolean | null => {
    const mark = descriptor.activeMark;
    if (!mark || !(EFFECTIVE_MARK_KEYS as readonly string[]).includes(mark)) return null;
    const key = mark as EffectiveMarkKey;
    const fromLayout = resolveEffectiveMarkValuesFromLayout(selection)[key];
    if (fromLayout !== undefined) return fromLayout;
    const { values } = resolveEffectiveMarkUniformityValues(selection);
    const fromWorker = values?.[key];
    return fromWorker !== undefined ? fromWorker : null;
  };

  const inlineToggleStateIsCurrent = (commandId: string, selection: SelectionSlice): boolean => {
    const descriptor = getCommandDescriptor(commandId);
    const mark = descriptor?.activeMark;
    if (!mark || !(EFFECTIVE_MARK_KEYS as readonly string[]).includes(mark)) return true;
    if (resolveEffectiveMarkValuesFromLayout(selection)[mark as EffectiveMarkKey] !== undefined) return true;
    if (!resolveDocOperation(getDoc(), 'format.readEffectiveInlineUniformity')) return true;
    // Selection readiness does not certify formatting. A prior content token's
    // uniformity result can remain cached while the committed selection is ready.
    // Hand off only to this revision's verdict, including mixed/failed reads.
    const { status } = readEffectiveInlineUniformityCached(selection);
    const key = effectiveInlineUniformityCacheKey(selection);
    return status === 'ready' || (key != null && asyncReads.get(key)?.failedToken === contentToken());
  };

  const readEffectiveInlineUniformityNow = async (
    input: LooseRecord | null,
  ): Promise<Record<string, EffectiveInlineUniformityState> | null> => {
    if (!input) return null;
    const op = resolveDocOperation(getDoc(), 'format.readEffectiveInlineUniformity');
    if (!op) return null;
    try {
      return readEffectiveInlineUniformityStates(await Promise.resolve(op(input)));
    } catch {
      return null;
    }
  };

  const applyEffectiveInlineUniformity = (
    projected: ProjectedInlineSelectionValues,
    direct: ProjectedInlineSelectionValues,
    states: Record<string, EffectiveInlineUniformityState>,
  ): void => {
    for (const key of ['fontFamily', 'fontSize'] as const) {
      if (direct[key] !== undefined) continue;
      const entry = states[key];
      if (entry?.state === 'uniform') {
        projected[key] = key === 'fontFamily' ? normalizeLayoutFontFamily(entry.value) : entry.value;
      } else {
        delete projected[key];
      }
    }
  };

  const projectSelectionInlineValuesWithStatus = (
    selection: SelectionSlice,
    effectiveInput = effectiveInlineUniformityInput(selection),
  ): ProjectedInlineValuesRead => {
    if (!selection.empty && hostMethod(getDoc()?.selection, 'readPresentation')) {
      if (!appliedSelectionPresentation(selection)) return { values: {}, effectiveUniformityStatus: 'pending' };
      return completeProjectedInlineValues(selection, {}, effectiveInput);
    }
    return completeProjectedInlineValues(
      selection,
      projectInlineValuesFromQueryItem(resolveSelectionTextQueryItem(selection), selection),
      effectiveInput,
    );
  };

  const projectSelectionInlineValues = (
    selection: SelectionSlice,
    effectiveInput = effectiveInlineUniformityInput(selection),
  ): ProjectedInlineSelectionValues => projectSelectionInlineValuesWithStatus(selection, effectiveInput).values;

  /**
   * Read command-critical inline values for format-painter capture. Reactive
   * command state intentionally serves stale values while its worker read is
   * refreshing, but arming the painter must snapshot the mutation that just
   * settled. A direct, bounded query here makes the async capture authoritative
   * without changing the non-blocking toolbar snapshot policy.
   */
  const readFormatPainterInlineValues = async (selection: SelectionSlice): Promise<ProjectedInlineSelectionValues> => {
    const effectiveInput = effectiveInlineUniformityInput(selection);
    const doc = getDoc();
    const queryMatch = hostMethod(doc?.query, 'match');
    const request = selectionTextQueryRequest(selection);
    if (!queryMatch || !request) {
      return projectSelectionInlineValues(selection, effectiveInput);
    }

    try {
      const raw = await Promise.resolve(queryMatch(request));
      const result = raw && typeof raw === 'object' ? (raw as LooseRecord) : null;
      const direct = projectInlineValuesFromQueryItem(pickSelectionTextQueryItem(result, selection), selection);
      const completed = completeProjectedInlineValues(selection, direct, effectiveInput);
      if (
        completed.effectiveUniformityStatus !== 'ready' &&
        (direct.fontFamily === undefined || direct.fontSize === undefined)
      ) {
        const effective = await readEffectiveInlineUniformityNow(effectiveInput);
        if (effective) applyEffectiveInlineUniformity(completed.values, direct, effective);
      }
      return completed.values;
    } catch {
      return projectSelectionInlineValues(selection, effectiveInput);
    }
  };

  const readBlockNode = async (address: LooseRecord): Promise<LooseRecord | undefined> => {
    const doc = getDoc();
    if (!doc) return undefined;
    const getNode = hostMethod(doc, 'getNode');
    const getNodeById = hostMethod(doc, 'getNodeById');
    const raw = await Promise.resolve(
      getNode
        ? getNode(address)
        : getNodeById?.({
            nodeId: address['nodeId'],
            nodeType: address['nodeType'],
            story: address['story'] ?? { kind: 'story', storyType: 'body' },
          }),
    );
    return isPlainObject(raw) ? raw : undefined;
  };

  /**
   * Returns the settled status of the query.match read backing the current
   * selection's inline-value projection. Called after resolveSelectionTextQueryItem
   * so readAsync always finds an existing cache entry — this is a status-only lookup.
   */
  const selectionQueryStatus = (selection: SelectionSlice): SliceStatus => {
    if (!selection.empty && hostMethod(getDoc()?.selection, 'readPresentation'))
      return appliedSelectionPresentation(selection) ? 'ready' : 'pending';
    const doc = getDoc();
    const queryMatch = hostMethod(doc?.query, 'match');
    if (!queryMatch) return 'ready';
    const request = selectionTextQueryRequest(selection);
    if (!request) return 'ready';
    const { status } = readAsync<LooseRecord>(
      `query:${selectionSignature(selection)}`,
      contentToken(),
      () => queryMatch(request),
      (raw) => (raw && typeof raw === 'object' ? (raw as LooseRecord) : null),
    );
    return status;
  };

  /**
   * Last fully-settled inline projection, keyed by the selection's inline
   * signature (content-token-free: the SAME selection across content
   * revisions keeps its key). While a refresh of the same selection is
   * pending/stale, settled values fill keys the in-flight projection has not
   * resolved yet, so the toolbar font field does not flicker blank mid-edit.
   * A NEW selection never reads a previous selection's held values, and a
   * SETTLED mixed selection overwrites the hold (blank is then correct).
   */
  const projectInlineValuesWithSettledHold = (selection: SelectionSlice): ProjectedInlineValuesRead => {
    const projection = projectSelectionInlineValuesWithStatus(selection);
    const projected = projection.values;
    const signature = selectionInlineValueSignature(selection);
    if (!signature) return projection;
    if (heldSettledInlineValues?.key !== signature) heldSettledInlineValues = null;
    // NOTE: called after projectSelectionInlineValues so the query read is
    // seeded; this is a status-only lookup.
    if (
      selection.status === 'ready' &&
      selectionQueryStatus(selection) === 'ready' &&
      projection.effectiveUniformityStatus === 'ready'
    ) {
      heldSettledInlineValues = { key: signature, values: projected };
      return projection;
    }
    if (heldSettledInlineValues && heldSettledInlineValues.key === signature) {
      return { ...projection, values: { ...heldSettledInlineValues.values, ...projected } };
    }
    return projection;
  };

  const computeCommandStates = (selection: SelectionSlice): Record<string, CommandState> => {
    const doc = getDoc();
    const projectedInlineRead = projectInlineValuesWithSettledHold(selection);
    const projectedInlineValues = projectedInlineRead.values;
    // Freeze for format painter capture: only when both the selection read AND the
    // backing query.match read are fully settled for the current content revision.
    // Including contentToken() in the key ensures stale frozen values from a prior
    // content revision are not reused after an edit.
    if (
      selection.status === 'ready' &&
      !selection.empty &&
      selectionQueryStatus(selection) === 'ready' &&
      projectedInlineRead.effectiveUniformityStatus === 'ready'
    ) {
      frozenProjectedValues = projectedInlineValues;
      frozenProjectedValuesKey = `${selectionKey(selection)}:${contentToken()}`;
    }
    const ccApi = doc?.contentControls as LooseRecord | undefined;
    const { lockModesById } = computeSelectionContentControlLockModes(ccApi, selection);
    const states: Record<string, CommandState> = {};
    const previous = state?.toolbar.commands;
    for (const id of allCommandIds()) {
      const computed = computeCommandState(id, doc, selection, projectedInlineValues, lockModesById);
      const prior = previous?.[id];
      const value = computed.value;
      if (
        prior?.source === 'builtin' &&
        computed.source === 'builtin' &&
        value &&
        typeof value === 'object' &&
        Object.getPrototypeOf(value) === Object.prototype &&
        Object.values(value).every((field) => field === null || typeof field !== 'object') &&
        shallowEqual(prior.value, value)
      )
        computed.value = prior.value;
      states[id] = prior && shallowEqual(prior, computed) ? prior : computed;
    }
    // Selection coordinates change on each key; toolbar consumers only need a
    // notification when the computed command facts actually change.
    return previous && shallowEqual(previous, states) ? (previous as Record<string, CommandState>) : states;
  };

  /** Stable reason a routed command cannot reach its Document API operation. */
  const unavailableRouteReason = (doc: LooseRecord | null): SuperDocUIReason => {
    if (doc) return SUPERDOC_UI_REASONS.operationUnavailable;
    return getEditor() ? SUPERDOC_UI_REASONS.documentApiUnavailable : SUPERDOC_UI_REASONS.notReady;
  };

  /**
   * Lock modes that block run-level styling mutations (bold/italic/font/etc.),
   * mirroring the content-mutation axis the content-controls adapter's
   * `guardContentUnlocked` enforces server-side (`contentLocked` /
   * `sdtContentLocked`). `sdtLocked` protects only the wrapper, not styling.
   */
  const blocksContentStyling = (lockMode: string | undefined): boolean =>
    lockMode === 'contentLocked' || lockMode === 'sdtContentLocked';

  /**
   * Stable reason an inline (run-level) styling command is disabled because the
   * selection overlaps a content control whose lock forbids styling it — Word
   * parity (SD-3274): SuperDoc must not leave styling controls clickable when
   * the mutation cannot apply. Block-range scoped (same precision as
   * `computeActiveContentControlLockModes`), so this can over-disable when an
   * unrelated selection shares a block with a locked control — accepted for
   * now; alignment/paragraph-level commands are never gated here.
   */
  const contentControlLockReason = (lockModesById: ReadonlyMap<string, string>): SuperDocUIReason | undefined => {
    for (const lockMode of lockModesById.values()) {
      if (blocksContentStyling(lockMode)) return SUPERDOC_UI_REASONS.contentControlLocked;
    }
    return undefined;
  };

  /** Stable reason a tracked-change decision command is disabled, or undefined when enabled. */
  const trackDecisionReason = (
    command: { kind: 'accept' | 'reject'; scope: 'id' | 'all' },
    supported: boolean,
    disabledReason: SuperDocUIReason | undefined,
    selection: SelectionSlice,
    doc: LooseRecord | null,
  ): SuperDocUIReason | undefined => {
    if (!supported) {
      // Bulk accept/reject is opt-in on the v2 host; single decisions need a real route.
      return command.scope === 'all' ? SUPERDOC_UI_REASONS.bulkDecisionsDisabled : unavailableRouteReason(doc);
    }
    if (disabledReason) return disabledReason;
    if (command.scope !== 'all' && selection.activeChangeIds.length === 0) {
      if (reviewWarmingSelections.has(selection)) return undefined;
      return SUPERDOC_UI_REASONS.selectionRequired;
    }
    if (command.scope !== 'all') {
      const plan = planSelectionTrackDecision(selection, true);
      if (plan?.kind === 'blocked') return plan.reason;
    }
    return undefined;
  };

  const firstRowsById = <T>(rows: readonly T[] | null | undefined): Map<unknown, T> => {
    const byId = new Map<unknown, T>();
    for (const row of rows ?? []) {
      const id = readEntityId(row);
      if (!byId.has(id)) byId.set(id, row);
    }
    return byId;
  };
  const permissionCurrentRowsById = new WeakMap<readonly TrackChangesItem[], Map<unknown, TrackChangesItem>>();
  const permissionDirectoryRowsById = new WeakMap<readonly unknown[], Map<unknown, unknown>>();
  const rowsByIdForRevision = <T>(
    cache: WeakMap<readonly T[], Map<unknown, T>>,
    rows: readonly T[] | null | undefined,
  ): Map<unknown, T> => {
    if (!rows) return new Map();
    const cached = cache.get(rows);
    if (cached) return cached;
    const byId = firstRowsById(rows);
    cache.set(rows, byId);
    return byId;
  };

  const trackChangePermissionLookup = (): ((id: string) => TrackChangeInfo | null) => {
    syncCoordinatorEditor();
    let current: Map<unknown, TrackChangesItem> | null = null;
    let items: readonly unknown[] | null;
    if (hasV2ReviewWindowFeed()) {
      current = rowsByIdForRevision(permissionCurrentRowsById, readAllStoryTrackChanges());
      // An explicit directory consumer may know an off-window author while
      // its catalog refreshes. Passive permission checks must not start I/O.
      const directory = asyncReads.get('trackChanges');
      items = directory?.hasSettled && Array.isArray(directory.value) ? directory.value : null;
    } else {
      // Retain known ownership during refresh; treating it as unknown can
      // change OWN to OTHER and incorrectly enable a denied decision.
      items = readTrackChangesDirectory('trackChanges:all').value;
    }
    let rows: Map<unknown, unknown> | null = null;
    return (id) => {
      const found = current?.get(id);
      if (found) return trackChangesItemPayload(found);
      rows ??= rowsByIdForRevision(permissionDirectoryRowsById, items);
      const projected = projectTrackChangesItem(rows.get(id));
      return projected ? trackChangesItemPayload(projected) : null;
    };
  };

  const trackedChangeDecisionPermissionReason = (
    kind: 'accept' | 'reject',
    ids: readonly string[],
  ): SuperDocUIReason | undefined => {
    const canPerform = superdoc.canPerformPermission;
    if (typeof canPerform !== 'function' || ids.length === 0) return undefined;
    const currentUser =
      superdoc.config && typeof superdoc.config === 'object'
        ? ((superdoc.config as LooseRecord).user as LooseRecord | null)
        : null;
    const builtInPolicy = readBuiltInTrackedChangePermissionPolicy(superdoc, canPerform);
    const builtInDecisions = builtInPolicy
      ? {
          ownAllowed: builtInPolicy(kind === 'accept' ? 'RESOLVE_OWN' : 'REJECT_OWN'),
          otherAllowed: builtInPolicy(kind === 'accept' ? 'RESOLVE_OTHER' : 'REJECT_OTHER'),
        }
      : null;
    if (builtInDecisions && builtInDecisions.ownAllowed === builtInDecisions.otherAllowed) {
      return builtInDecisions.ownAllowed ? undefined : SUPERDOC_UI_REASONS.permissionDenied;
    }
    const findTrackChangeForPermission = trackChangePermissionLookup();
    if (builtInDecisions) {
      const { ownAllowed, otherAllowed } = builtInDecisions;
      for (const id of ids) {
        const trackedChange = findTrackChangeForPermission(id);
        if (!trackedChange) return SUPERDOC_UI_REASONS.permissionDenied;
        const allowed = trackedChangeOwnedByCurrentUser(trackedChange, currentUser) ? ownAllowed : otherAllowed;
        if (!allowed) return SUPERDOC_UI_REASONS.permissionDenied;
      }
      return undefined;
    }
    for (const id of ids) {
      const trackedChange = findTrackChangeForPermission(id);
      const isOwn = trackedChange ? trackedChangeOwnedByCurrentUser(trackedChange, currentUser) : false;
      const permission =
        kind === 'accept' ? (isOwn ? 'RESOLVE_OWN' : 'RESOLVE_OTHER') : isOwn ? 'REJECT_OWN' : 'REJECT_OTHER';
      const permissions = trackedChange
        ? [permission]
        : kind === 'accept'
          ? ['RESOLVE_OWN', 'RESOLVE_OTHER']
          : ['REJECT_OWN', 'REJECT_OTHER'];
      for (const candidate of permissions) {
        let allowed: unknown;
        try {
          const permissionChange = trackedChange ?? { id };
          allowed = canPerform.call(superdoc, {
            permission: candidate,
            trackedChange: permissionChange,
            comment: null,
          });
        } catch {
          return trackedChange ? undefined : SUPERDOC_UI_REASONS.permissionDenied;
        }
        if (allowed === false || (!trackedChange && allowed !== true)) return SUPERDOC_UI_REASONS.permissionDenied;
      }
    }
    return undefined;
  };

  const hostCommandSupport = (command: string): LooseRecord | null => {
    const getCapabilities = hostMethod(getHost(), 'getCapabilities');
    const capabilities = safeCall<unknown>(getCapabilities ?? undefined, null);
    const editableSubset = isPlainObject(capabilities) ? capabilities.editableSubset : undefined;
    const commands = isPlainObject(editableSubset) ? editableSubset.commands : undefined;
    if (Array.isArray(commands)) {
      return (commands as LooseRecord[]).find((entry) => entry?.command === command || entry?.id === command) ?? null;
    }
    if (commands && typeof commands === 'object') {
      const record = (commands as LooseRecord)[command];
      return record && typeof record === 'object' ? (record as LooseRecord) : null;
    }
    return null;
  };

  const bulkTrackDecisionBlockedReason = (
    command: { kind: 'accept' | 'reject'; scope: 'id' | 'all' },
    tcApi?: LooseRecord,
  ): SuperDocUIReason | undefined => {
    if (command.scope !== 'all') return undefined;
    if (typeof tcApi?.[`${command.kind}All`] === 'function') return undefined;
    const support = hostCommandSupport(`trackedChanges.${command.kind}All`);
    if (support && (support.status === 'supported' || support.enabled === true)) return undefined;
    return SUPERDOC_UI_REASONS.bulkDecisionsDisabled;
  };

  const canStorePendingInlineFormat = (selection: SelectionSlice): boolean =>
    selection.empty &&
    collapsedTextAddressFromSelection(selection) != null &&
    typeof getHost()?.setPendingInlineFormat === 'function';

  type PendingListRequest = {
    editor: ReturnType<typeof getEditor>;
    doc: unknown;
    mode: ReturnType<typeof readDocumentMode>;
    kind: 'bullet' | 'ordered';
    optionsKey: string;
    scope: string | null;
    scopePromise: Promise<string | null>;
    decisionSettled: Promise<void>;
    repeatIntent: {
      acceptsRepeats: boolean;
      sourceResult: (() => Promise<CommandExecutionResult>) | null;
      state: Promise<unknown> | null;
    };
    result: Promise<CommandExecutionResult>;
    cancelled: boolean;
    cancel: (reason?: unknown) => void;
  };
  const pendingListRequests = new Set<PendingListRequest>();
  const listCommandSourceSettlements = new WeakMap<SelectionSlice, Promise<CommandExecutionResult>>();
  const capturedListApplications = new WeakMap<SelectionSlice, (input: unknown) => unknown>();
  let nextListRequest = 0;
  const listTableSelection = (
    selection: SelectionSlice,
  ): { tableId: string; story: { kind: 'story'; storyType: 'body' }; cellIds: string[] } | null => {
    const table = selection.tableSelection;
    if (
      table?.kind !== 'tableCells' ||
      table.selectionMode !== 'cells' ||
      !table.tableId ||
      !Array.isArray(table.cells) ||
      table.cells.length === 0 ||
      table.cells.some((cell) => !cell || typeof cell.nodeId !== 'string' || !cell.nodeId)
    )
      return null;
    const story = table.story ?? selectionStory(selection);
    if (story.kind !== 'story' || story.storyType !== 'body') return null;
    const cellIds = table.cells.map((cell) => cell.nodeId).sort();
    return new Set(cellIds).size === cellIds.length
      ? { tableId: table.tableId, story: { kind: 'story', storyType: 'body' }, cellIds }
      : null;
  };
  const listSelectionScope = (selection: SelectionSlice): string | null => {
    if (selection.tableSelection?.selectionMode === 'cells') {
      const table = listTableSelection(selection);
      return table
        ? JSON.stringify([storyLocatorSignature(table.story), { tableId: table.tableId, cellIds: table.cellIds }])
        : null;
    }
    const blocks = selectionBlockIds(selection);
    return blocks.length ? JSON.stringify([storyLocatorSignature(selectionStory(selection)), blocks]) : null;
  };
  const listCommandIsPending = (kind: 'bullet' | 'ordered', selection: SelectionSlice): boolean => {
    const scope = listSelectionScope(selection);
    return [...pendingListRequests].some(
      (request) =>
        !request.cancelled &&
        request.editor === getEditor() &&
        request.doc === getEditor()?.doc &&
        request.mode === readDocumentMode() &&
        request.kind === kind &&
        (request.scope == null || scope == null || request.scope === scope),
    );
  };

  const inlineFormattingRefused = (descriptor: CommandDescriptor, selection: SelectionSlice): boolean => {
    if (!descriptor.inline) return false;
    if (selectionHasOnlyDeletedText(selection)) return true;
    return descriptor.inline.kind === 'clear' && selectionTouchesDeletedText(selection);
  };

  const computeCommandState = (
    id: string,
    doc: LooseRecord | null,
    selection: SelectionSlice,
    projectedInlineValues: ProjectedInlineSelectionValues,
    lockModesById: ReadonlyMap<string, string> = new Map(),
  ): CommandState => {
    if (customCommands.has(id)) {
      const partial = safeCall<Partial<CommandState>>(
        customCommands.get(id)!.getState
          ? () => customCommands.get(id)!.getState!(buildCustomCommandContext(undefined))
          : undefined,
        {},
      );
      return normalizeCommandState({ supported: true, enabled: true, ...partial }, 'custom');
    }
    const readonly = documentIsReadOnly();
    const listKind = listToggleKind(id);
    if (listKind) {
      const editCommands = getEditCommands();
      const lists = editCommands?.lists as LooseRecord | undefined;
      const apply = lists?.apply;
      if (typeof apply === 'function') {
        const entry = readListApplyStateEntry();
        const shippedStatus = typeof entry?.shippedStatus === 'string' ? entry.shippedStatus : null;
        const supported = shippedStatus !== 'not-shipped' && shippedStatus !== 'disabled';
        const enabled = supported && (typeof entry?.enabled === 'boolean' ? entry.enabled : true);
        const activeSeed = supported ? readListActiveSeed(entry) : null;
        if (readonly) {
          return normalizeCommandState(
            {
              enabled: false,
              active: activeSeed === listKind,
              supported,
              value: entry?.value,
              reason: SUPERDOC_UI_REASONS.documentReadonly,
            },
            'builtin',
          );
        }
        return normalizeCommandState(
          {
            enabled,
            active: activeSeed === listKind,
            supported,
            value: entry?.value,
            pending: listCommandIsPending(listKind, selection),
          },
          'builtin',
        );
      }
    }
    const trackCommand = trackDecisionCommand(id);
    if (trackCommand) {
      const tcApi = doc?.trackChanges as LooseRecord | undefined;
      const supportsSingle = typeof tcApi?.decide === 'function' || typeof tcApi?.[trackCommand.kind] === 'function';
      const supportsAll =
        typeof tcApi?.decide === 'function' || typeof tcApi?.[`${trackCommand.kind}All`] === 'function';
      const supported = trackCommand.scope === 'all' ? supportsAll : supportsSingle;
      const reason =
        bulkTrackDecisionBlockedReason(trackCommand, tcApi) ??
        trackDecisionReason(trackCommand, supported, trackedChangeDecisionDisabledReason(), selection, doc) ??
        // SD-3845 option A — Accept All / Reject All stay enabled.
        // Denied items are skipped at decide, not by greying the bulk command.
        (trackCommand.scope === 'all'
          ? undefined
          : trackedChangeDecisionPermissionReason(trackCommand.kind, selection.activeChangeIds));
      return normalizeCommandState({ enabled: reason == null, active: false, supported, reason }, 'builtin');
    }
    if (id === 'copy-format') {
      if (readonly) {
        return normalizeCommandState({ supported: true, enabled: false, active: false }, 'builtin');
      }
      if (!getEditor()) {
        return normalizeCommandState(
          { supported: true, enabled: false, active: false, reason: SUPERDOC_UI_REASONS.notReady },
          'builtin',
        );
      }
      return normalizeCommandState({ supported: true, enabled: true, active: painter.mode !== 'idle' }, 'builtin');
    }
    const descriptor = getCommandDescriptor(id);
    // Unknown id → unsupported by v2.
    if (!descriptor) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: false, reason: SUPERDOC_UI_REASONS.commandUnsupported },
        'unsupported',
      );
    }
    // Recognized but not routed. Surfaced visibly in the catalog and failing
    // closed with a stable reason: `table-context-unavailable` for the table
    // context-facade gap, `command-unsupported` for product decisions with no
    // clear v2 equivalent.
    if (descriptor.disposition !== 'routed') {
      return normalizeCommandState(
        {
          enabled: false,
          active: false,
          supported: false,
          reason: descriptor.reason ?? SUPERDOC_UI_REASONS.commandUnsupported,
        },
        // `deferred` / `context-gap` are recognized v2 commands (builtin source);
        // only `unsupported` (product decision / unknown) is non-v2.
        descriptor.disposition === 'unsupported' ? 'unsupported' : 'builtin',
      );
    }
    // Routed via a public SuperDoc-instance method (zoom, document mode, ruler,
    // formatting marks). These are controls / host chrome, not document
    // mutations, so they stay enabled in viewing mode.
    if (inlineFormattingRefused(descriptor, selection)) {
      return normalizeCommandState(
        {
          enabled: false,
          active: false,
          supported: true,
          reason: readonly
            ? SUPERDOC_UI_REASONS.documentReadonly
            : SUPERDOC_UI_REASONS.deletedTextFormattingUnsupported,
        },
        'builtin',
      );
    }
    if (descriptor.instanceRoute) {
      return computeInstanceCommandState(descriptor);
    }
    // Table cell-context commands route through `tables.*` once the shared
    // table-context facade resolves the current table. They are real v2
    // operations, so `supported` is true; with no resolvable context (or no
    // resolved cell for split) they fail closed with `table-context-unavailable`.
    if (descriptor.table) {
      return computeTableCommandState(descriptor, doc, readonly);
    }
    // The clear-formatting command resolves its own operations internally and
    // does not need a single docRoute op to be available. Gate only on whether
    // there is a block or range to act on.
    if (descriptor.inline?.kind === 'clear') {
      if (descriptor.mutates && readonly) {
        return normalizeCommandState(
          { enabled: false, active: false, supported: true, reason: SUPERDOC_UI_REASONS.documentReadonly },
          'builtin',
        );
      }
      const lockReason = contentControlLockReason(lockModesById);
      if (lockReason) {
        return normalizeCommandState({ enabled: false, active: false, supported: true, reason: lockReason }, 'builtin');
      }
      const enabled = selectionBlockIds(selection).length > 0 || resolveInlineCommandTarget(selection) != null;
      return normalizeCommandState(
        {
          enabled,
          active: false,
          supported: true,
          reason: enabled ? undefined : SUPERDOC_UI_REASONS.selectionRequired,
        },
        'builtin',
      );
    }
    // Routed Document-API-backed command. Distinguish not-ready / missing API /
    // missing operation / read-only so the disabled state is never opaque.
    const route = descriptor.docRoute;
    if (!route) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: false, reason: SUPERDOC_UI_REASONS.commandUnsupported },
        'unsupported',
      );
    }
    const op = resolveDocOperation(doc, route);
    if (op == null) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: false, reason: unavailableRouteReason(doc) },
        'builtin',
      );
    }
    const mirroredEditCommandState = readMirroredEditCommandStateEntry(id);
    if (mirroredEditCommandState) {
      const shippedStatus = mirroredEditCommandState.shippedStatus;
      const supported = shippedStatus !== 'not-shipped' && shippedStatus !== 'disabled';
      // The lower host reports an empty history stack as `reason: null` — the
      // absence of a blocking cause, not an unsupported command (see
      // `withHistoryEnabledState` in the v2 edit-command adapters, which relies
      // on that null to let history no-ops through `rejectIfBlocked`). Coercing
      // it would surface `command-unsupported`, the reason reserved for
      // permanently-unavailable commands like `table-fix`, and a consumer
      // branching on it would hide undo/redo forever instead of re-enabling
      // them once the user edits.
      //
      // Every part of the empty-stack shape is required before claiming it: a
      // history command that the host reported as unsupported, or one that is
      // enabled, is not an empty stack, and must not borrow that reason just
      // because its `reason` field happens to be null.
      //
      // `historyResolved` is the last part. A pending, unavailable, or failed
      // history read also lands here as `{ enabled: false, reason: null }`, and
      // calling that "empty" would tell the application the stack is genuinely
      // exhausted when it was never read. Those fall through to `not-ready`,
      // which is retryable and clears when the read settles.
      const mirroredEnabled =
        typeof mirroredEditCommandState.enabled === 'boolean' ? mirroredEditCommandState.enabled : true;
      const isHistoryCommand = id === 'undo' || id === 'redo';
      const historyUnread = isHistoryCommand && mirroredEditCommandState.historyResolved === false;
      const isEmptyHistoryStack =
        isHistoryCommand &&
        supported &&
        mirroredEnabled === false &&
        mirroredEditCommandState.reason === null &&
        !historyUnread;
      const reason =
        mirroredEditCommandState.reason === undefined
          ? undefined
          : isEmptyHistoryStack
            ? SUPERDOC_UI_REASONS.historyEmpty
            : historyUnread
              ? SUPERDOC_UI_REASONS.notReady
              : coerceSuperDocUIReason(mirroredEditCommandState.reason, SUPERDOC_UI_REASONS.commandUnsupported);
      if (descriptor.mutates && readonly) {
        return normalizeCommandState(
          { enabled: false, active: false, supported, reason: SUPERDOC_UI_REASONS.documentReadonly },
          'builtin',
        );
      }
      return normalizeCommandState(
        {
          enabled: supported && mirroredEnabled,
          active: false,
          supported,
          reason,
        },
        'builtin',
      );
    }
    const active = commandActiveState(descriptor, doc, selection);
    const value = routedCommandValue(descriptor, doc, selection, projectedInlineValues);
    if (descriptor.list?.mode === 'indent' || descriptor.list?.mode === 'outdent') {
      return computeHybridIndentCommandState(descriptor, doc, readonly, selection, active, value);
    }
    if (descriptor.list?.mode === 'toggle-seed') {
      return computeListToggleCommandState(descriptor, doc, readonly, selection, active, value);
    }
    if (descriptor.mutates && readonly) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, value, reason: SUPERDOC_UI_REASONS.documentReadonly },
        'builtin',
      );
    }
    // Inline-format commands operate on the live selection target. With a range
    // they mutate it directly; with a collapsed caret in a block they store the
    // pick for the next typed text (stored marks, SD-3654/SD-3652) - a mark
    // toggle or a font/size - so they stay enabled at a caret. The combobox shows
    // the effective font (the `value` below), so font/size are never blank.
    if (descriptor.inline && !resolveInlineCommandTarget(selection)) {
      // Word parity (SD-3274): a collapsed caret is the common case for a
      // locked content control (no range to resolve a target from) — must
      // not report the button as clickable here only for `executeCommand`'s
      // matching lock check to silently no-op the click.
      const lockReason = contentControlLockReason(lockModesById);
      if (lockReason) {
        return normalizeCommandState({ enabled: false, active, supported: true, value, reason: lockReason }, 'builtin');
      }
      return normalizeCommandState(
        canStorePendingInlineFormat(selection)
          ? { enabled: true, active, supported: true, value }
          : { enabled: false, active, supported: true, value, reason: SUPERDOC_UI_REASONS.rangeSelectionRequired },
        'builtin',
      );
    }
    // Block-level paragraph / list commands resolve the current paragraph
    // block(s) from the selection. A caret is enough (it still has a block id);
    // with no resolvable block they fail closed with `selection-required`.
    if ((descriptor.blockParagraph || descriptor.list) && selectionBlockIds(selection).length === 0) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, value, reason: SUPERDOC_UI_REASONS.selectionRequired },
        'builtin',
      );
    }
    // Field commands insert at a collapsed caret in the active header or
    // footer. The body and ranges have no field target.
    if (descriptor.field && !isHeaderFooterCaret(selection)) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, reason: SUPERDOC_UI_REASONS.contextUnavailable },
        'builtin',
      );
    }
    // Page numbers add header/footer structure, which has no tracked-change
    // form, so they are unavailable while suggesting.
    if (descriptor.pageNumbers && readDocumentMode() === 'suggesting') {
      return normalizeCommandState(
        { enabled: false, active, supported: true, reason: SUPERDOC_UI_REASONS.operationUnavailable },
        'builtin',
      );
    }
    // Link commands need a range selection (to wrap), an active link (to patch /
    // remove), or a collapsed text target (to insert linked text from payload).
    if (
      descriptor.link &&
      !active &&
      selectionTextAddresses(selection).length === 0 &&
      !collapsedTextAddressFromSelection(selection)
    ) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, reason: SUPERDOC_UI_REASONS.rangeSelectionRequired },
        'builtin',
      );
    }
    // Word parity (SD-3274): a range/caret selection that resolved an inline
    // target (the branch above only covers the no-target case) must not leave
    // run-level styling controls clickable when the selection overlaps a
    // content control whose lock forbids styling — alignment/paragraph-level
    // commands (`descriptor.blockParagraph`/`descriptor.list`) are never
    // reached here and stay unaffected.
    if (descriptor.inline) {
      const lockReason = contentControlLockReason(lockModesById);
      if (lockReason) {
        return normalizeCommandState({ enabled: false, active, supported: true, value, reason: lockReason }, 'builtin');
      }
    }
    return normalizeCommandState({ enabled: true, active, supported: true, value }, 'builtin');
  };

  function hyperlinkOverlapsSelection(link: LooseRecord, selection: SelectionSlice): boolean {
    if (storyLocatorSignature(readEntityStory(link)) !== storyLocatorSignature(selectionStoryLocator(selection))) {
      return false;
    }
    const anchor = (link.address as LooseRecord | undefined)?.anchor as LooseRecord | undefined;
    const start = anchor?.start as LooseRecord | undefined;
    const end = anchor?.end as LooseRecord | undefined;
    const linkBlockId = typeof start?.blockId === 'string' ? start.blockId : null;
    const linkEndBlockId = typeof end?.blockId === 'string' ? end.blockId : null;
    if (!linkBlockId || !linkEndBlockId) return false;
    const linkStart = typeof start?.offset === 'number' ? start.offset : null;
    const linkEnd = typeof end?.offset === 'number' ? end.offset : null;
    if (linkStart == null || linkEnd == null) return false;

    for (const segment of textTargetSegments(selection.target)) {
      const segmentBlockId = typeof segment?.blockId === 'string' ? segment.blockId : null;
      if (!segmentBlockId) continue;
      const range = segment.range;
      const rangeStart = typeof range?.start === 'number' ? range.start : null;
      const rangeEnd = typeof range?.end === 'number' ? range.end : null;
      if (rangeStart == null || rangeEnd == null) continue;
      if (linkBlockId !== linkEndBlockId) {
        if (segmentBlockId === linkBlockId && rangeEnd > linkStart) return true;
        if (segmentBlockId === linkEndBlockId && rangeStart < linkEnd) return true;
        continue;
      }
      if (segmentBlockId !== linkBlockId) continue;
      if (rangeStart === rangeEnd) {
        if (rangeStart >= linkStart && rangeStart <= linkEnd) return true;
        continue;
      }
      if (Math.max(rangeStart, linkStart) < Math.min(rangeEnd, linkEnd)) return true;
    }
    return false;
  }

  /**
   * Resolve the hyperlink overlapping the current selection/caret via
   * `hyperlinks.list({ within })` scoped to the selection's covered blocks.
   * Returns the first overlapping list row (`{ address, properties }`) or null.
   */
  const resolveCurrentHyperlink = (doc: LooseRecord | null, selection: SelectionSlice): LooseRecord | null => {
    const listLinks = hostMethod(doc?.hyperlinks, 'list');
    if (!listLinks) return null;
    const blockIds = selectionBlockIds(selection);
    if (!canProbeEverySelectedBlock(blockIds)) return null;
    const story = selectionStoryLocator(selection);
    for (const blockId of blockIds) {
      const within = paragraphTarget(blockId, story);
      const { value: result } = readAsync<LooseRecord>(
        story ? `hyperlinks:${storyLocatorSignature(story)}:${blockId}` : `hyperlinks:${blockId}`,
        contentToken(),
        () => listLinks({ within }),
        (raw) => (raw && typeof raw === 'object' ? (raw as LooseRecord) : null),
      );
      const items = result && Array.isArray(result.items) ? (result.items as LooseRecord[]) : [];
      const hit = items.find((item) => hyperlinkOverlapsSelection(item, selection));
      if (hit) return hit;
    }
    return null;
  };

  /**
   * Active state for a routed command. Links resolve by public hyperlink
   * address overlap; list commands read the current block's list state and
   * match the seeded kind. Other inline marks use the selection mark set when
   * the host exposes it.
   */
  const commandActiveState = (
    descriptor: CommandDescriptor,
    doc: LooseRecord | null,
    selection: SelectionSlice,
  ): boolean => {
    if (descriptor.link) return resolveCurrentHyperlink(doc, selection) != null;
    if (descriptor.list?.mode === 'toggle-seed' && descriptor.list.seed) {
      return readListSeed(doc, selection) === descriptor.list.seed;
    }
    // A stored inline mark (SD-3654) drives the button's active state whenever one
    // is pending — not gated on `selection.empty`. The store is only ever set for
    // a collapsed-caret toggle and is cleared on a genuine caret move, so while it
    // is present it is authoritative. Checking it unconditionally keeps the button
    // stable across the insert that consumes it: the format apply briefly retargets
    // a range (selection not empty), and an `empty`-gated check would blink the
    // button inactive mid-keystroke.
    const pending = pendingInlineActive(descriptor);
    if (pending !== null) return pending;
    const optimistic = optimisticInlineToggles.get(descriptor.id);
    const selectionSignature = selectionInlineValueSignature(selection);
    if (selectionSignature && optimistic?.selectionSignature === selectionSignature) return optimistic.active;
    // Cascade-resolved mark state (SD-3860): a style-inherited bold/italic/
    // underline/strikethrough must show active even with no direct rPr on the
    // run, and must NOT show active when a direct override turns off a
    // style-inherited mark. Falls back to the raw direct-only check below only
    // when neither the mounted projection nor a settled worker read has an
    // opinion yet (first paint / degraded host).
    const effective = effectiveMarkActiveState(descriptor, selection);
    if (effective !== null) return effective;
    return commandIsActive(descriptor, selection);
  };

  /** Live `value` for a routed command, when modeled (current paragraph style / link href). */
  const routedCommandValue = (
    descriptor: CommandDescriptor,
    doc: LooseRecord | null,
    selection: SelectionSlice,
    projectedInlineValues: ProjectedInlineSelectionValues,
  ): unknown => {
    if (descriptor.inline && isProjectedInlineSelectionValueKey(descriptor.inline.key)) {
      // A pending caret pick wins over the projection (which lags until the next
      // insert repaints), so the combobox reflects the choice immediately (SD-3652).
      const pending = pendingInlineValueFor(descriptor);
      if (pending !== undefined) return pending;
      const projected = projectedInlineValues[descriptor.inline.key];
      if (projected !== undefined) return projected;
      const signature = selectionInlineValueSignature(selection);
      const cached = signature ? optimisticInlineValues.get(descriptor.inline.key) : undefined;
      if (signature && cached?.selectionSignature === signature) return cached.value;
    }
    if (descriptor.id === 'linked-style') {
      const { style: active } = styleReads.activeParagraphStyle(selection);
      if (!active.styleId || active.mixed) return undefined;
      return { styleId: active.styleId, styleName: active.styleName };
    }
    if (descriptor.id === 'text-align') return readToolbarParagraphAlignment(doc, selection);
    if (descriptor.id === 'link') return readActiveLinkHref(doc, selection) ?? undefined;
    return undefined;
  };

  /** Read one block's list state and cache status through the selected story's list-state seam. */
  const readListStateSnapshotForBlock = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
    selection: SelectionSlice,
  ): { value: LooseRecord | null; status: SliceStatus } => {
    const applied = doc === getDoc() ? appliedSelectionPresentation(selection)?.listState : null;
    const appliedValue = isPlainObject(applied) ? applied.value : undefined;
    if (
      isPlainObject(applied) &&
      applied.blockId === blockId &&
      isPlainObject(applied.story) &&
      storyLocatorSignature(applied.story) === storyLocatorSignature(story) &&
      isPlainObject(appliedValue) &&
      appliedValue.success === true
    ) {
      return { value: appliedValue, status: 'ready' };
    }
    const getStateInStory = hostMethod(doc?.lists, 'getStateInStory');
    const getState = hostMethod(doc?.lists, 'getState');
    if (!getStateInStory && !getState) return { value: null, status: 'ready' };
    const isBodyStory = story.storyType === 'body';
    const readState = getStateInStory
      ? () => getStateInStory({ target: listsBlockTarget(blockId), story })
      : isBodyStory && getState
        ? () => getState({ target: listsBlockTarget(blockId) })
        : null;
    if (!readState) return { value: null, status: 'ready' };
    const { value: result, status } = readAsync<LooseRecord>(
      `lists:${storyLocatorSignature(story)}:${blockId}`,
      contentToken(),
      readState,
      (raw) => (raw && typeof raw === 'object' ? (raw as LooseRecord) : null),
    );
    return { value: result?.success === true ? result : null, status };
  };

  /** Read one block's settled list state through the selected story's list-state seam. */
  const readListStateForBlock = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
    selection: SelectionSlice,
  ): LooseRecord | null => {
    return readListStateSnapshotForBlock(doc, blockId, story, selection).value;
  };

  /** Read one block's list seed (`'bullet'` / `'ordered'`) in the selected story. */
  const readListSeedForBlock = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
    selection: SelectionSlice,
  ): 'bullet' | 'ordered' | null => {
    const result = readListStateForBlock(doc, blockId, story, selection);
    if (!result || result.isListItem !== true) return null;
    return result.seed === 'bullet' || result.seed === 'ordered' ? result.seed : null;
  };

  /**
   * Read whether a block is a list item. `null` means the authoritative state is
   * unavailable or has not settled yet; it must never be interpreted as a plain
   * paragraph. A list item may legitimately have no bullet/ordered seed (for
   * example, a linked Word numbering definition).
   */
  const readListMembershipSnapshotForBlock = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
    selection: SelectionSlice,
  ): { value: boolean | null; status: SliceStatus } => {
    const snapshot = readListStateSnapshotForBlock(doc, blockId, story, selection);
    const result = snapshot.value;
    return {
      value: result && typeof result.isListItem === 'boolean' ? result.isListItem : null,
      status: snapshot.status,
    };
  };

  /** Read a uniform list seed across the covered blocks, or null when mixed / non-list. */
  const readListSeed = (doc: LooseRecord | null, selection: SelectionSlice): 'bullet' | 'ordered' | null => {
    const blockIds = selectionBlockIds(selection);
    if (blockIds.length === 0 || !canProbeEverySelectedBlock(blockIds)) return null;
    const story = selectionStory(selection);
    const firstSeed = readListSeedForBlock(doc, blockIds[0], story, selection);
    if (firstSeed !== 'bullet' && firstSeed !== 'ordered') return null;
    for (const blockId of blockIds.slice(1)) {
      if (readListSeedForBlock(doc, blockId, story, selection) !== firstSeed) return null;
    }
    return firstSeed;
  };

  /** Read a paragraph node in its story through the async read coordinator. */
  const readNodeById = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
  ): { value: LooseRecord | null; status: SliceStatus; refreshing: boolean } => {
    if (!doc) return { value: null, status: 'ready', refreshing: false };
    const storySignature = storyLocatorSignature(story);
    const isBodyStory = storySignature === 'story:body';
    if (isBodyStory && typeof doc.getNodeById !== 'function') {
      return { value: null, status: 'ready', refreshing: false };
    }
    if (!isBodyStory && typeof doc.getNode !== 'function') {
      return { value: null, status: 'ready', refreshing: false };
    }
    const key = `node:${storySignature}:${blockId}`;
    const token = contentToken();
    const read = readAsync<LooseRecord>(
      key,
      token,
      () =>
        isBodyStory
          ? (doc.getNodeById as AnyFn)({ nodeId: blockId, nodeType: 'paragraph', story })
          : (doc.getNode as AnyFn)(paragraphTarget(blockId, story)),
      (raw) => (raw && typeof raw === 'object' ? (raw as LooseRecord) : null),
    );
    const entry = asyncReads.get(key);
    return {
      ...read,
      refreshing: read.status === 'stale' && entry?.inflightToken === token && entry.failedToken !== token,
    };
  };

  type ParagraphAlignment = 'left' | 'center' | 'right' | 'justify';

  type ParagraphAlignmentResolution =
    | { status: 'uniform'; value: ParagraphAlignment }
    | { status: 'mixed' | 'pending' | 'unavailable' };

  const normalizeParagraphAlignment = (value: unknown): ParagraphAlignment | undefined => {
    return value === 'left' || value === 'center' || value === 'right' || value === 'justify' ? value : undefined;
  };

  const isProjectionResolvedParagraphAlignment = (value: unknown): boolean => {
    return (
      value === 'start' ||
      value === 'end' ||
      value === 'distributed' ||
      value === 'numTab' ||
      value === 'lowKashida' ||
      value === 'mediumKashida' ||
      value === 'highKashida' ||
      value === 'thaiDistribute'
    );
  };

  /** Read effective paragraph alignments from the mounted, style-resolved layout. */
  const readEffectiveParagraphAlignments = (
    selection: SelectionSlice,
    blockIds: readonly string[],
  ): Map<string, ParagraphAlignment> | null => {
    const applied = appliedSelectionPresentation(selection);
    if (applied)
      return new Map(
        blockIds.flatMap((id) => {
          const alignments = applied.paragraphAlignments;
          const alignment = normalizeParagraphAlignment(isPlainObject(alignments) ? alignments[id] : undefined);
          return alignment ? [[id, alignment] as const] : [];
        }),
      );
    const host = getHost();
    const readByIds = host?.readMountedProjectionBlocksByIds;
    if (typeof readByIds !== 'function') return null;
    const story = selectionStoryLocator(selection);
    const blocks = safeCall<unknown>(
      () => (story ? readByIds.call(host, [...blockIds], story) : readByIds.call(host, [...blockIds])),
      null,
    );
    if (!Array.isArray(blocks)) return new Map();
    const projectionBlocks = collectProjectionTextBlocks(blocks);
    const alignments = new Map<string, ParagraphAlignment>();
    for (const blockId of blockIds) {
      const block = projectionBlocks.find((candidate) => projectionBlockMatchesId(candidate, blockId));
      if (!block) continue;
      const attrs = block.attrs as LooseRecord | undefined;
      const alignment = normalizeParagraphAlignment(attrs?.alignment);
      const inlineDirection = getParagraphInlineDirection(attrs);
      alignments.set(blockId, alignment ?? (inlineDirection === 'rtl' ? 'right' : 'left'));
    }
    return alignments;
  };

  /** Read public paragraph alignment, then fall back to the resolved projection. */
  const readParagraphAlignment = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
    effectiveAlignments: Map<string, ParagraphAlignment> | null,
  ): ParagraphAlignmentResolution => {
    const { value: result, status, refreshing } = readNodeById(doc, blockId, story);
    const effective = effectiveAlignments?.get(blockId);
    if (status === 'pending') {
      return effective ? { status: 'uniform', value: effective } : { status: 'pending' };
    }
    // A promise-backed node refresh still carries the last settled node. Keep
    // that value only for the active first attempt; failed retries and a new
    // selection must fail closed instead of extending an obsolete alignment.
    if (status === 'stale' && !refreshing) return { status: 'pending' };
    // The mounted projection may already reflect the new commit while its node
    // read is in flight, so its effective value (including mixed selections)
    // remains authoritative over the stale direct-formatting payload.
    if (status === 'stale' && effective) {
      return { status: 'uniform', value: effective };
    }
    if (status === 'stale' && effectiveAlignments && !effective) return { status: 'unavailable' };
    if (!result) return { status: 'unavailable' };
    const node = result.node as LooseRecord | undefined;
    if (!node) return { status: 'unavailable' };
    const kind = node.kind;
    if (kind !== 'paragraph' && kind !== 'heading') return { status: 'unavailable' };
    const payload = node[kind] as LooseRecord | undefined;
    if (!payload || typeof payload !== 'object') return { status: 'unavailable' };
    const directAlignment = (payload.props as LooseRecord | undefined)?.alignment;
    if (directAlignment == null) {
      return effective ? { status: 'uniform', value: effective } : { status: 'unavailable' };
    }
    const alignment = normalizeParagraphAlignment(directAlignment);
    if (alignment) {
      return { status: 'uniform', value: alignment };
    }
    if (isProjectionResolvedParagraphAlignment(directAlignment) && effective) {
      return { status: 'uniform', value: effective };
    }
    return { status: 'unavailable' };
  };

  /** Resolve a uniform effective alignment across every selected paragraph. */
  const readUniformParagraphAlignment = (
    doc: LooseRecord | null,
    selection: SelectionSlice,
  ): ParagraphAlignmentResolution => {
    const blockIds = selectionBlockIds(selection);
    if (blockIds.length === 0 || !canProbeEverySelectedBlock(blockIds)) return { status: 'unavailable' };
    const story = selectionStory(selection);
    const effectiveAlignments = readEffectiveParagraphAlignments(selection, blockIds);
    const first = readParagraphAlignment(doc, blockIds[0], story, effectiveAlignments);
    if (first.status !== 'uniform') return first;
    for (const blockId of blockIds.slice(1)) {
      const next = readParagraphAlignment(doc, blockId, story, effectiveAlignments);
      if (next.status !== 'uniform') return next;
      if (next.value !== first.value) return { status: 'mixed' };
    }
    return first;
  };

  const paragraphAlignmentSelectionSignature = (selection: SelectionSlice): string | null => {
    const blockIds = selectionBlockIds(selection);
    if (blockIds.length === 0) return null;
    return `${storyLocatorSignature(selectionStory(selection))}:${blockIds.join(',')}`;
  };

  /** Keep a toolbar pick stable until its painted paragraph state is readable. */
  const readToolbarParagraphAlignment = (
    doc: LooseRecord | null,
    selection: SelectionSlice,
  ): ParagraphAlignment | undefined => {
    const resolution = readUniformParagraphAlignment(doc, selection);
    const resolved = resolution.status === 'uniform' ? resolution.value : undefined;
    const optimistic = optimisticParagraphAlignment;
    if (!optimistic) return resolved;
    const selectionSignature = paragraphAlignmentSelectionSignature(selection);
    if (selectionSignature && selectionSignature !== optimistic.selectionSignature) {
      optimisticParagraphAlignment = null;
      return resolved;
    }
    // Toolbar focus can briefly make the editor selection unreadable. Retain
    // only the value; command enablement still fails closed as selection-required.
    if (!selectionSignature) return optimistic.value;
    if (!optimistic.settled) return optimistic.value;
    if (resolution.status !== 'pending') {
      optimisticParagraphAlignment = null;
      return resolved;
    }
    return optimistic.value;
  };

  const armOptimisticParagraphAlignment = (selection: SelectionSlice, payload: unknown): number | null => {
    const alignment = normalizeParagraphAlignment(payload);
    const selectionSignature = paragraphAlignmentSelectionSignature(selection);
    const blockIds = selectionBlockIds(selection);
    if (!alignment || !selectionSignature || blockIds.length === 0) return null;
    const generation = ++optimisticParagraphAlignmentGeneration;
    optimisticParagraphAlignment = {
      selectionSignature,
      value: alignment,
      generation,
      settled: false,
      canReconcile: canProbeEverySelectedBlock(blockIds),
    };
    recompute();
    return generation;
  };

  const settleOptimisticParagraphAlignment = (generation: number | null, result: CommandExecutionResult): void => {
    if (generation == null) return;
    const optimistic = optimisticParagraphAlignment;
    if (!optimistic || optimistic.generation !== generation) return;
    if (!commandResultSucceeded(result)) {
      optimisticParagraphAlignment = null;
      return;
    }
    if (!optimistic.canReconcile) {
      optimisticParagraphAlignment = null;
      return;
    }
    optimistic.settled = true;
  };

  /**
   * Await a block's list membership authoritatively. Membership comes from
   * `isListItem`, not `seed`: linked/custom Word numbering can be a valid list
   * item while returning `seed: null`. Command execution must also fail closed
   * when membership cannot be resolved instead of assuming a plain paragraph.
   *
   * The read resolves directly instead of peeking at the async cache. Only the
   * first selected block is warmed by the command-state snapshot, so command
   * execution cannot depend on that cache being warm (SD-3659).
   */
  const resolveListMembershipForBlockAsync = async (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
  ): Promise<boolean | null> => {
    const listsApi = doc?.lists as LooseRecord | undefined;
    if (!listsApi) return null;
    try {
      const isBodyStory = story.storyType === 'body';
      const raw =
        typeof listsApi.getStateInStory === 'function'
          ? await listsApi.getStateInStory({ target: listsBlockTarget(blockId), story })
          : isBodyStory && typeof listsApi.getState === 'function'
            ? await listsApi.getState({ target: listsBlockTarget(blockId) })
            : null;
      const result = raw && typeof raw === 'object' ? (raw as LooseRecord) : null;
      if (!result || result.success !== true || typeof result.isListItem !== 'boolean') return null;
      return result.isListItem;
    } catch {
      return null;
    }
  };

  type ResolvedListSeed = {
    resolved: boolean;
    seed: 'bullet' | 'ordered' | null;
  };

  /** Read a list seed directly for mutation planning instead of trusting the reactive cache. */
  const resolveListSeedForBlock = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
  ): ResolvedListSeed | Promise<ResolvedListSeed> => {
    const unavailable: ResolvedListSeed = { resolved: false, seed: null };
    const getStateInStory = hostMethod(doc?.lists, 'getStateInStory');
    const getState = hostMethod(doc?.lists, 'getState');
    if (!getStateInStory && !getState) return unavailable;
    const isBodyStory = story.storyType === 'body';
    const readState = getStateInStory
      ? () => getStateInStory({ target: listsBlockTarget(blockId), story })
      : isBodyStory && getState
        ? () => getState({ target: listsBlockTarget(blockId) })
        : null;
    if (!readState) return unavailable;

    const normalize = (raw: unknown): ResolvedListSeed => {
      const result = raw && typeof raw === 'object' ? (raw as LooseRecord) : null;
      if (!result || result.success !== true || typeof result.isListItem !== 'boolean') return unavailable;
      const seed =
        result.isListItem === true && (result.seed === 'bullet' || result.seed === 'ordered') ? result.seed : null;
      return { resolved: true, seed };
    };

    try {
      const raw = readState();
      return isPromiseLike(raw) ? Promise.resolve(raw).then(normalize, () => unavailable) : normalize(raw);
    } catch {
      return unavailable;
    }
  };

  /** Await a block's current paragraph indentation authoritatively. */
  const resolveParagraphIndentationForBlockAsync = async (
    doc: LooseRecord | null,
    blockId: string,
    story?: unknown,
  ): Promise<ParagraphIndentationTwips | null> => {
    if (!doc) return null;
    try {
      const isBodyStory = !story || (story as LooseRecord).storyType === 'body';
      const raw =
        story && typeof doc.getNode === 'function'
          ? await (doc.getNode as AnyFn)(paragraphTarget(blockId, story))
          : isBodyStory && typeof doc.getNodeById === 'function'
            ? await (doc.getNodeById as AnyFn)({
                nodeId: blockId,
                nodeType: 'paragraph',
                story: { kind: 'story', storyType: 'body' },
              })
            : null;
      return readParagraphIndentationFromResult(raw && typeof raw === 'object' ? raw : null);
    } catch {
      return null;
    }
  };

  const computeHybridIndentCommandState = (
    descriptor: CommandDescriptor,
    doc: LooseRecord | null,
    readonly: boolean,
    selection: SelectionSlice,
    active: boolean,
    value: unknown,
  ): CommandState => {
    if (descriptor.mutates && readonly) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, value, reason: SUPERDOC_UI_REASONS.documentReadonly },
        'builtin',
      );
    }

    const blockIds = selectionBlockIds(selection);
    if (blockIds.length === 0) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, value, reason: SUPERDOC_UI_REASONS.selectionRequired },
        'builtin',
      );
    }

    const listOp = descriptor.docRoute ? resolveDocOperation(doc, descriptor.docRoute) : null;
    const paragraphSetIndent = resolveDocOperation(doc, 'format.paragraph.setIndentation');
    const paragraphClearIndent = resolveDocOperation(doc, 'format.paragraph.clearIndentation');
    const mode = descriptor.list?.mode;
    const paragraphOpAvailable =
      mode === 'indent' ? paragraphSetIndent != null : paragraphSetIndent != null || paragraphClearIndent != null;
    const story = selectionStory(selection);
    let listMembership: Array<boolean | null> | null = null;
    if (story.storyType !== 'body') {
      listMembership = [];
      for (const blockId of blockIds) {
        const { value: isListItem, status } = readListMembershipSnapshotForBlock(doc, blockId, story, selection);
        // A pending read will invalidate command state when it settles. Until
        // then, preserve the existing available posture without probing later
        // blocks or guessing which mutation family applies.
        if (isListItem === null) {
          if (status !== 'ready' && (listOp != null || paragraphOpAvailable)) {
            return normalizeCommandState({ enabled: true, active, supported: true, value }, 'builtin');
          }
          return normalizeCommandState(
            { enabled: false, active, supported: false, value, reason: unavailableRouteReason(doc) },
            'builtin',
          );
        }
        listMembership.push(isListItem);
      }
    }

    if (listMembership?.some((isListItem) => isListItem === true)) {
      const rangeRoute = mode === 'indent' ? 'lists.indentRange' : 'lists.outdentRange';
      const canUseRange =
        readDocumentMode() !== 'suggesting' &&
        listMembership.every((isListItem) => isListItem === true) &&
        resolveDocOperation(doc, rangeRoute) != null;
      const canUseStoryOutdent = mode === 'outdent' && resolveDocOperation(doc, 'lists.outdentInStory') != null;
      if (!canUseRange && !canUseStoryOutdent) {
        return normalizeCommandState(
          { enabled: false, active, supported: false, value, reason: unavailableRouteReason(doc) },
          'builtin',
        );
      }
    }

    for (const [index, blockId] of blockIds.entries()) {
      const membership = listMembership
        ? { value: listMembership[index] ?? null, status: 'ready' as const }
        : readListMembershipSnapshotForBlock(doc, blockId, story, selection);
      const isListItem = membership.value;
      if (isListItem === true) {
        if (listOp != null) {
          return normalizeCommandState({ enabled: true, active, supported: true, value }, 'builtin');
        }
        continue;
      }
      if (isListItem === false && paragraphOpAvailable) {
        if (story.storyType !== 'body' && typeof doc?.getNode !== 'function') continue;
        return normalizeCommandState({ enabled: true, active, supported: true, value }, 'builtin');
      }
      if (isListItem === null) {
        // Pending membership is resolved authoritatively on execute. Keep the
        // control available when either route exists, but never treat a settled
        // unavailable read as a plain paragraph.
        if (membership.status !== 'ready' && (listOp != null || paragraphOpAvailable)) {
          return normalizeCommandState({ enabled: true, active, supported: true, value }, 'builtin');
        }
        return normalizeCommandState(
          { enabled: false, active, supported: false, value, reason: unavailableRouteReason(doc) },
          'builtin',
        );
      }
    }

    return normalizeCommandState(
      { enabled: false, active, supported: false, value, reason: unavailableRouteReason(doc) },
      'builtin',
    );
  };

  const computeListToggleCommandState = (
    descriptor: CommandDescriptor,
    doc: LooseRecord | null,
    readonly: boolean,
    selection: SelectionSlice,
    active: boolean,
    value: unknown,
  ): CommandState => {
    if (descriptor.mutates && readonly) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, value, reason: SUPERDOC_UI_REASONS.documentReadonly },
        'builtin',
      );
    }

    const blockIds = selectionBlockIds(selection);
    if (blockIds.length === 0) {
      return normalizeCommandState(
        { enabled: false, active, supported: true, value, reason: SUPERDOC_UI_REASONS.selectionRequired },
        'builtin',
      );
    }

    const story = selectionStory(selection);
    const listsApi = doc?.lists as LooseRecord | undefined;
    const canReadState =
      typeof listsApi?.getStateInStory === 'function' ||
      (story.storyType === 'body' && typeof listsApi?.getState === 'function');
    if (!canReadState) {
      return normalizeCommandState(
        { enabled: false, active, supported: false, value, reason: SUPERDOC_UI_REASONS.operationUnavailable },
        'builtin',
      );
    }

    if (!canProbeEverySelectedBlock(blockIds)) {
      const everyOutcomeSupported = story.storyType === 'body' && resolveDocOperation(doc, 'lists.remove') != null;
      return normalizeCommandState(
        everyOutcomeSupported
          ? { enabled: true, active, supported: true, value }
          : { enabled: false, active, supported: false, value, reason: SUPERDOC_UI_REASONS.operationUnavailable },
        'builtin',
      );
    }

    const snapshots = blockIds.map((blockId) => readListStateSnapshotForBlock(doc, blockId, story, selection));
    if (snapshots.some(({ status }) => status !== 'ready')) {
      return normalizeCommandState({ enabled: true, active, supported: true, value }, 'builtin');
    }

    if (snapshots.some(({ value: state }) => state === null)) {
      return normalizeCommandState(
        { enabled: false, active, supported: false, value, reason: SUPERDOC_UI_REASONS.operationUnavailable },
        'builtin',
      );
    }

    const seed = descriptor.list?.seed;
    const shouldRemove = snapshots.every(({ value: state }) => state?.isListItem === true && state.seed === seed);
    if (story.storyType === 'body') {
      const routeAvailable = !shouldRemove || resolveDocOperation(doc, 'lists.remove') != null;
      return normalizeCommandState(
        routeAvailable
          ? { enabled: true, active, supported: true, value }
          : { enabled: false, active, supported: false, value, reason: SUPERDOC_UI_REASONS.operationUnavailable },
        'builtin',
      );
    }

    const removeInStory = resolveDocOperation(doc, 'lists.removeInStory');
    if (shouldRemove && removeInStory) {
      return normalizeCommandState({ enabled: true, active, supported: true, value }, 'builtin');
    }

    return normalizeCommandState(
      { enabled: false, active, supported: false, value, reason: SUPERDOC_UI_REASONS.operationUnavailable },
      'builtin',
    );
  };

  /** Read the active hyperlink's href overlapping the selection, when present. */
  const readActiveLinkHref = (doc: LooseRecord | null, selection: SelectionSlice): string | null => {
    const link = resolveCurrentHyperlink(doc, selection);
    const href = (link?.properties as LooseRecord | undefined)?.href;
    return typeof href === 'string' ? href : null;
  };

  /** State for a command routed through a public SuperDoc-instance method. */
  const computeInstanceCommandState = (descriptor: CommandDescriptor): CommandState => {
    if (!getEditor()) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: false, reason: SUPERDOC_UI_REASONS.notReady },
        'builtin',
      );
    }
    const method = descriptor.instanceRoute as string;
    const available = typeof (superdoc as LooseRecord)?.[method] === 'function';
    if (!available) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: false, reason: SUPERDOC_UI_REASONS.operationUnavailable },
        'builtin',
      );
    }
    return normalizeCommandState(
      { enabled: true, active: chromeActiveState(descriptor), supported: true, value: descriptorValue(descriptor) },
      'builtin',
    );
  };

  /** Live active state for a host-owned chrome control (`ruler`, `formatting-marks`). */
  const chromeActiveState = (descriptor: CommandDescriptor): boolean => {
    const config = (superdoc?.config as LooseRecord | undefined) ?? undefined;
    if (descriptor.valueFrom === 'ruler') return Boolean(config?.rulers);
    if (descriptor.valueFrom === 'formattingMarks') {
      return Boolean((config?.layoutEngineOptions as LooseRecord | undefined)?.showFormattingMarks);
    }
    return false;
  };

  /** State for a table cell-context command routed through `tables.*`. */
  const computeTableCommandState = (
    descriptor: CommandDescriptor,
    doc: LooseRecord | null,
    readonly: boolean,
  ): CommandState => {
    // A mutating table command is read-only guarded first.
    if (readonly) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: true, reason: SUPERDOC_UI_REASONS.documentReadonly },
        'builtin',
      );
    }
    // The defining fail-closed reason for the table family is the absence of a
    // resolvable table context (caret not in a table, host facade absent, or no
    // resolved cell for split). Report it before the route-availability check so
    // a custom UI sees the precise, named context reason.
    const context = resolveTableContext();
    const ready =
      context != null &&
      (!descriptor.table!.requiresCell || context.cellNodeId != null) &&
      (descriptor.table!.action !== 'merge-cells' || context.canMerge);
    if (!ready) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: true, reason: SUPERDOC_UI_REASONS.tableContextUnavailable },
        'builtin',
      );
    }
    // Context resolved but the Document API tables operation is missing on this host.
    const op = descriptor.docRoute ? resolveDocOperation(doc, descriptor.docRoute) : null;
    if (op == null) {
      return normalizeCommandState(
        { enabled: false, active: false, supported: false, reason: unavailableRouteReason(doc) },
        'builtin',
      );
    }
    return normalizeCommandState({ enabled: true, active: false, supported: true }, 'builtin');
  };

  /** Resolve a descriptor's live `value` from public controller state, when modeled. */
  const descriptorValue = (descriptor: CommandDescriptor): unknown => {
    if (descriptor.valueFrom === 'zoom') return computeZoom().value;
    if (descriptor.valueFrom === 'documentMode') return readDocumentMode();
    if (descriptor.valueFrom === 'measurementUnit') return readMeasurementUnit();
    if (descriptor.valueFrom === 'ruler' || descriptor.valueFrom === 'formattingMarks') {
      return chromeActiveState(descriptor);
    }
    return undefined;
  };

  /** Validate normalized payloads before invoking public SuperDoc-instance methods. */
  const instanceCommandPayloadIsValid = (descriptor: CommandDescriptor, payload: unknown): boolean => {
    if (descriptor.id === 'zoom') return isFiniteNumber(payload) && payload > 0;
    if (descriptor.id === 'document-mode') {
      return payload === 'editing' || payload === 'suggesting' || payload === 'viewing';
    }
    if (descriptor.id === 'measurement-unit') return payload === 'in' || payload === 'cm';
    return true;
  };

  const allCommandIds = (): string[] => {
    return [...new Set([...ALL_BUILT_IN_COMMAND_IDS, ...customCommands.keys()])];
  };

  const styleReads = createStyleReads({
    hasEditor: () => getEditor() !== null,
    getDoc,
    contentToken,
    readAsync,
    readNodeById,
  });

  const computeStateSnapshot = (reason: string): SuperDocUIState => {
    const { sink } = readUiBenchRuntime();
    const startedAtMs = sink ? uiBenchNowMs() : 0;
    const phaseMs: Record<string, number> = {};
    const measure = <T>(phase: string, run: () => T): T => {
      if (!sink) return run();
      const phaseStartedAtMs = uiBenchNowMs();
      try {
        return run();
      } finally {
        phaseMs[phase] = uiBenchNowMs() - phaseStartedAtMs;
      }
    };
    const documentMode = measure('documentMode', readDocumentMode);
    const selection = measure('selection', computeSelection);
    if (selection.status === 'ready') {
      pruneSelectionScopedAsyncReads(selection);
    }
    // Retire stored inline marks (SD-3654/SD-3652) once the live selection
    // reflects them, so the toolbar hands off from pending to real marks/value.
    reconcilePendingInlineFormat(selection);
    const selectionSignature = selectionInlineValueSignature(selection);
    for (const [commandId, optimistic] of optimisticInlineToggles) {
      if (
        !selectionSignature ||
        optimistic.selectionSignature !== selectionSignature ||
        optimistic.editorSource !== getEditor() ||
        optimistic.documentSource !== getEditor()?.doc ||
        optimistic.documentMode !== documentMode
      ) {
        optimisticInlineToggles.delete(commandId);
      } else if (
        optimistic.settled &&
        selection.status === 'ready' &&
        inlineToggleStateIsCurrent(commandId, selection)
      ) {
        optimisticInlineToggles.delete(commandId);
      }
    }
    const nextState: SuperDocUIState = {
      ready: getEditor() != null,
      documentMode,
      document: measure('document', computeDocument),
      selection,
      toolbar: {
        context: documentMode,
        commands: measure('toolbarCommands', () => computeCommandStates(selection)),
        copyFormatActive: painter.mode !== 'idle',
      },
      comments: measure('comments', () => computeComments(selection)),
      trackChanges: measure('trackChanges', () => computeTrackChanges(selection)),
      contentControls: measure('contentControls', () => computeContentControls(selection)),
      zoom: measure('zoom', computeZoom),
      history: measure('history', computeHistory),
      fonts: measure('fonts', computeFonts),
      styles: measure('styles', () => styleReads.computeSlice(selection)),
    };
    if (sink) {
      const completedAtMs = uiBenchNowMs();
      emitUiBenchTiming({
        stage: 'superdoc-ui-compute-state',
        atMs: completedAtMs,
        reason,
        startedAtMs,
        completedAtMs,
        durationMs: completedAtMs - startedAtMs,
        phaseMs,
        asyncReadSettlements: asyncReadCache.drainSettlements(),
      });
    }
    return nextState;
  };

  const computeState = (reason = 'direct'): SuperDocUIState => {
    const previous = editCommandReadScope;
    editCommandReadScope = { source: null, snapshot: null, read: false };
    try {
      return computeStateSnapshot(reason);
    } finally {
      editCommandReadScope = previous;
    }
  };

  const syncOptimisticInlineSelection = (selection: SelectionSlice): void => {
    const nextSignature = selectionInlineValueSignature(selection);
    if (
      nextSignature &&
      lastOptimisticInlineSelectionSignature &&
      nextSignature !== lastOptimisticInlineSelectionSignature
    ) {
      optimisticInlineValues.clear();
      optimisticInlineToggles.clear();
    }
    if (nextSignature) lastOptimisticInlineSelectionSignature = nextSignature;
  };

  let currentHostSelectionSource: LooseRecord | null = null;
  let detachHostSelection: (() => void) | null = null;

  // The v2 edit-command adapters own state the controller mirrors but does not
  // drive: undo/redo enablement comes from an async `history.get()` read that
  // settles on its own schedule. The adapter recomputes its snapshot when that
  // read lands, but none of the SuperDoc lifecycle events above fire for it, so
  // without this subscription a freshly opened document could sit on the
  // pre-read reason until something unrelated forced a recompute.
  let currentEditCommandsSource: LooseRecord | null = null;
  let detachEditCommands: (() => void) | null = null;
  let currentV2ReviewWindowSource: LooseRecord | null = null;
  let detachV2ReviewWindow: (() => void) | null = null;

  const requestEditCommandsRecompute = (): void => requestMicrotaskRecompute('edit-commands');

  const syncEditCommandsSubscription = (): void => {
    const next = getEditCommands();
    if (next === currentEditCommandsSource) return;
    if (detachEditCommands) {
      detachEditCommands();
      detachEditCommands = null;
    }
    currentEditCommandsSource = next;
    if (!next || typeof next.subscribe !== 'function') return;
    try {
      const unsubscribe = (next.subscribe as (listener: () => void) => unknown)(() => requestEditCommandsRecompute());
      if (typeof unsubscribe === 'function') detachEditCommands = unsubscribe as () => void;
    } catch {
      currentEditCommandsSource = null;
    }
  };

  const syncV2ReviewWindowSubscription = (): void => {
    const next = getV2ReviewWindowSource();
    if (next === currentV2ReviewWindowSource) return;
    if (detachV2ReviewWindow) {
      detachV2ReviewWindow();
      detachV2ReviewWindow = null;
    }
    currentV2ReviewWindowSource = next;
    if (!next || typeof next.subscribe !== 'function') return;
    try {
      const unsubscribe = next.subscribe(() => requestFrameRecompute('review-window'));
      if (typeof unsubscribe === 'function') detachV2ReviewWindow = unsubscribe;
    } catch {
      currentV2ReviewWindowSource = null;
    }
  };
  let currentHostReviewSource: LooseRecord | null = null;
  let detachHostReview: (() => void) | null = null;
  let currentHostEventsSource: LooseRecord | null = null;
  let detachHostEvents: (() => void) | null = null;
  let currentDocumentSelectionSource: Document | null = null;
  let detachDocumentSelection: (() => void) | null = null;

  const readHostSelectionSource = (): LooseRecord | null => {
    const readHandles = hostMethod(getEditor()?.host, 'getHandles');
    const handles = safeCall<unknown>(readHandles ?? undefined, null);
    const editing = isPlainObject(handles) ? handles.editing : undefined;
    const selection = isPlainObject(editing) ? editing.selection : undefined;
    return isPlainObject(selection) && typeof selection.subscribe === 'function' ? selection : null;
  };

  const caretSelectionNeedsProjectionPaint = (): boolean => {
    const host = getHost();
    const read = host?.readLiveSelectionSyncSnapshot;
    if (typeof read !== 'function') return false;
    const info = normalizeSelectionInfo(safeCall(() => (read as AnyFn).call(host), null));
    if (!info || !isCollapsedCaretSnapshot(info)) return false;
    const nextSelection = selectionSliceFromInfo(info, 'ready');
    const previousCaret = collapsedTextAddressFromSelection(state.selection);
    const nextCaret = collapsedTextAddressFromSelection(nextSelection);
    if (
      previousCaret &&
      nextCaret &&
      previousCaret.blockId === nextCaret.blockId &&
      storyLocatorSignature(previousCaret.story) === storyLocatorSignature(nextCaret.story)
    ) {
      return false;
    }
    const projected = resolveEffectiveInlineValuesFromLayout(nextSelection);
    const familyValue = state.toolbar.commands['font-family']?.value;
    const sizeValue = state.toolbar.commands['font-size']?.value;
    const hadFamily = typeof familyValue === 'string' && familyValue.length > 0;
    const hadSize = (typeof sizeValue === 'string' && sizeValue.length > 0) || isFiniteNumber(sizeValue);
    return (hadFamily && projected.fontFamily === undefined) || (hadSize && projected.fontSize === undefined);
  };

  const syncHostSelectionSubscription = (): void => {
    const next = readHostSelectionSource();
    if (next === currentHostSelectionSource) return;
    if (detachHostSelection) {
      detachHostSelection();
      detachHostSelection = null;
    }
    currentHostSelectionSource = next;
    if (!next) return;
    try {
      const unsubscribeCallbacks: Array<() => void> = [];
      detachHostSelection = () => {
        for (const detach of unsubscribeCallbacks) detach();
      };
      const unsubscribe = hostMethod(
        next,
        'subscribe',
      )?.((snapshot: unknown) => {
        // A foreground text mutation can move the caret before its new block is
        // in the mounted projection. Publish that selection after the exact
        // paint boundary so command state never describes unpainted content.
        if (foregroundMutationActive() && caretSelectionNeedsProjectionPaint() && schedulePostPaintSelectionRefresh()) {
          return;
        }
        // A caret/selection move invalidates the live selection read (and the
        // selection-scoped reads keyed off its signature) without changing the
        // document-content revision.
        selectionEpoch += 1;
        // Seed a collapsed caret synchronously so the toolbar reflects the new
        // caret immediately instead of after the worker round-trip (SD-3652);
        // ranges refresh authoritatively without seeding unresolved worker data.
        refreshSelectionFromHost(snapshot);
        recompute('host-selection');
      });
      if (typeof unsubscribe === 'function') unsubscribeCallbacks.push(() => unsubscribe());
      const readHandles = hostMethod(getHost(), 'getHandles');
      const handles = safeCall<unknown>(readHandles ?? undefined, null);
      const tableSelection = isPlainObject(handles) ? handles.selection : undefined;
      const subscribeWholeTable = hostMethod(tableSelection, 'subscribeWholeTable');
      if (subscribeWholeTable) {
        const refreshWholeTable = (initial = false): void => {
          const native = initial ? readHostSelectionSnapshot() : null;
          selectionEpoch += 1;
          refreshSelectionFromHost(undefined, false, true, native);
          recompute('host-selection');
        };
        const detach = subscribeWholeTable(() => refreshWholeTable());
        if (typeof detach === 'function') unsubscribeCallbacks.push(() => detach());
        const nodeId = hostMethod(tableSelection, 'getWholeTableNodeId')?.();
        if (nodeId) refreshWholeTable(true);
      }
    } catch {
      currentHostSelectionSource = null;
    }
  };

  const readHostReviewSource = (): LooseRecord | null => {
    const readHandles = hostMethod(getEditor()?.host, 'getHandles');
    const handles = safeCall<unknown>(readHandles ?? undefined, null);
    const review = isPlainObject(handles) ? handles.review : undefined;
    return isPlainObject(review) && typeof review.subscribe === 'function' ? review : null;
  };

  const readHostActiveReviewTarget = (review: LooseRecord | null): unknown => {
    const getActiveReviewTarget = hostMethod(review, 'getActiveReviewTarget');
    if (getActiveReviewTarget) return safeCall(() => getActiveReviewTarget(), null);
    const getSnapshot = hostMethod(review, 'getSnapshot');
    if (!getSnapshot) return null;
    const snapshot = safeCall<unknown>(() => getSnapshot(), null);
    return isPlainObject(snapshot) ? (snapshot.activeReviewTarget ?? null) : null;
  };

  let trackedChangeNavigationInFlight = 0;
  let lastPublishedHostReviewTarget:
    | {
        raw: unknown;
        focus: ExplicitActiveChange | null;
        origin: unknown;
      }
    | undefined;
  const isRepublishedHostReviewTarget = (left: unknown, right: unknown): boolean =>
    left === right ||
    (isPlainObject(left) &&
      isPlainObject(right) &&
      left.layoutEpoch !== right.layoutEpoch &&
      left.origin === right.origin &&
      left.entityType === right.entityType &&
      left.entityId === right.entityId &&
      left.paintedEntityId === right.paintedEntityId &&
      storyLocatorSignature(left.story) === storyLocatorSignature(right.story));

  const syncTrackedChangeFocusFromHostReviewTarget = (rawTarget: unknown, rawSnapshot?: unknown): boolean => {
    const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? (rawSnapshot as LooseRecord) : null;
    const rejection = snapshot?.lastInteractionRejection;
    const paintInvalidation =
      rawTarget == null &&
      rejection &&
      typeof rejection === 'object' &&
      (rejection as LooseRecord).code === 'review-target-invalidated' &&
      (rejection as LooseRecord).detail === 'not-painted';
    if (paintInvalidation && (explicitActiveChange || explicitActiveCommentId)) return false;
    const target = rawTarget && typeof rawTarget === 'object' ? (rawTarget as LooseRecord) : null;
    if (target?.entityType === 'comment' && typeof target.entityId === 'string' && target.entityId.length > 0) {
      const commentId = resolveActiveCommentId(state?.comments.items ?? [], target.entityId) ?? target.entityId;
      const republished = isRepublishedHostReviewTarget(rawTarget, lastPublishedHostReviewTarget?.raw);
      lastPublishedHostReviewTarget = { raw: rawTarget, focus: null, origin: target.origin };
      if (republished || (explicitActiveCommentId === commentId && !explicitActiveChange)) return false;
      setExplicitActiveChange(null);
      explicitActiveCommentId = commentId;
      return true;
    }
    const previousTarget = lastPublishedHostReviewTarget?.raw;
    if (!target && isPlainObject(previousTarget) && previousTarget.entityType === 'comment') {
      lastPublishedHostReviewTarget = { raw: rawTarget, focus: null, origin: undefined };
      if (!explicitActiveCommentId) return false;
      explicitActiveCommentId = null;
      return true;
    }
    let next: ExplicitActiveChange | null = null;
    if (target?.entityType === 'trackedChange' && typeof target.entityId === 'string' && target.entityId.length > 0) {
      const targetStory = target.story && typeof target.story === 'object' ? target.story : undefined;
      // Body clicks remain id-only. Retaining an explicit body
      // story would unnecessarily make focus depend on the all-story read.
      const story =
        targetStory && storyLocatorSignature(targetStory) !== storyLocatorSignature(null) ? targetStory : undefined;
      const rawPaintedEntityId =
        typeof target.paintedEntityId === 'string' && target.paintedEntityId.length > 0 ? target.paintedEntityId : null;
      const lookupEntityId = rawPaintedEntityId ?? target.entityId;
      const publicId = (() => {
        if (story) {
          const allStoryItems = readAllStoryTrackChanges();
          const storyContext = allStoryItems ? buildStoryScopedTrackedChangeIdContext(allStoryItems, story) : null;
          return (
            storyContext?.toPublicId(lookupEntityId) ?? storyContext?.toPublicId(target.entityId) ?? target.entityId
          );
        }
        const bodyItems = Array.isArray(state?.trackChanges.items) ? state.trackChanges.items : [];
        const bodyContext = buildTrackedChangeIdContext(bodyItems);
        return bodyContext.toPublicId(lookupEntityId) ?? bodyContext.toPublicId(target.entityId) ?? target.entityId;
      })();
      const paintedEntityId = rawPaintedEntityId ?? (lookupEntityId !== publicId ? lookupEntityId : null);
      next = {
        id: publicId,
        ...(story ? { story } : {}),
        ...(paintedEntityId && paintedEntityId !== publicId ? { paintedEntityId } : {}),
      };
    }
    if (
      rawTarget == null &&
      next == null &&
      explicitActiveChange != null &&
      hasPendingTrackChangeRevealFocus(explicitActiveChange)
    ) {
      return false;
    }
    // Capability and paint notifications can republish the unchanged held
    // target while panel navigation is awaiting its new target. That same
    // host publication is not a newer focus request.
    const previousPublication = lastPublishedHostReviewTarget;
    if (
      previousPublication &&
      (isRepublishedHostReviewTarget(rawTarget, previousPublication.raw) ||
        (target?.origin === 'panel' &&
          previousPublication.origin === 'panel' &&
          next &&
          previousPublication.focus &&
          explicitActiveChangesEqual(previousPublication.focus, next)))
    )
      return false;
    lastPublishedHostReviewTarget = { raw: rawTarget, focus: next, origin: target?.origin };
    if (explicitActiveChangesEqual(explicitActiveChange, next)) return false;
    if (
      target?.origin === 'panel' &&
      explicitActiveChange &&
      next &&
      explicitActiveChange.id === next.id &&
      storyLocatorSignature(explicitActiveChange.story) === storyLocatorSignature(next.story) &&
      !explicitActiveChange.paintedEntityId &&
      next.paintedEntityId
    ) {
      // Resolving the same panel target to its painted carrier enriches the
      // held request; it does not supersede that request or its queued steps.
      explicitActiveChange.paintedEntityId = next.paintedEntityId;
      return false;
    }
    setExplicitActiveChange(next);
    return true;
  };

  const syncHostReviewSubscription = (): void => {
    const next = readHostReviewSource();
    if (next === currentHostReviewSource) return;
    if (detachHostReview) {
      detachHostReview();
      detachHostReview = null;
    }
    currentHostReviewSource = next;
    lastPublishedHostReviewTarget = undefined;
    if (!next) {
      syncTrackedChangeFocusFromHostReviewTarget(null);
      return;
    }
    let attaching = true;
    try {
      const unsubscribe = hostMethod(
        next,
        'subscribe',
      )?.((snapshot: unknown) => {
        const snapshotRecord = snapshot && typeof snapshot === 'object' ? (snapshot as LooseRecord) : null;
        const target =
          snapshotRecord && Object.prototype.hasOwnProperty.call(snapshotRecord, 'activeReviewTarget')
            ? snapshotRecord.activeReviewTarget
            : readHostActiveReviewTarget(next);
        // Deleted paint is not editable model content, so its caret can resolve
        // to an adjacent insertion. The review target is the click authority;
        // only a semantic target change needs a controller recompute.
        if (!syncTrackedChangeFocusFromHostReviewTarget(target, snapshot) || attaching) return;
        recompute();
      });
      if (typeof unsubscribe === 'function') detachHostReview = () => unsubscribe();
      syncTrackedChangeFocusFromHostReviewTarget(readHostActiveReviewTarget(next));
    } catch {
      currentHostReviewSource = null;
    } finally {
      attaching = false;
    }
  };

  const readDocumentSelectionFallbackSource = (): Document | null => {
    if (currentHostSelectionSource || readDocumentMode() !== 'viewing') return null;
    const editor = getEditor();
    const container = (editor?.mount as LooseRecord | undefined)?.container;
    const ownerDocument =
      container && typeof container === 'object' && 'ownerDocument' in container
        ? ((container as { ownerDocument?: Document }).ownerDocument ?? null)
        : null;
    const doc = ownerDocument ?? (globalThis as { document?: Document }).document ?? null;
    return doc && typeof doc.addEventListener === 'function' ? doc : null;
  };

  const syncDocumentSelectionFallbackSubscription = (): void => {
    const next = readDocumentSelectionFallbackSource();
    if (next === currentDocumentSelectionSource) return;
    if (detachDocumentSelection) {
      detachDocumentSelection();
      detachDocumentSelection = null;
    }
    currentDocumentSelectionSource = next;
    if (!next) return;
    const handler = (): void => {
      selectionEpoch += 1;
      recompute();
    };
    next.addEventListener('selectionchange', handler);
    next.addEventListener('pointerup', handler, true);
    next.addEventListener('mouseup', handler, true);
    detachDocumentSelection = () => {
      next.removeEventListener('selectionchange', handler);
      next.removeEventListener('pointerup', handler, true);
      next.removeEventListener('mouseup', handler, true);
    };
  };

  syncCoordinatorEditor();
  syncTrackedChangeFocusFromHostReviewTarget(readHostActiveReviewTarget(readHostReviewSource()));
  state = computeState('initial');
  lastOptimisticInlineSelectionSignature = selectionInlineValueSignature(state.selection);

  // Recompute document-derived slices (comments, tracked changes, content
  // controls, selection) when the v2 host commits a document mutation. This is
  // the doc-changed signal — distinct from geometry invalidation (scroll /
  // resize / zoom), which only drives overlay re-measurement via
  // `viewport.observe`. Without it, slices like contentControls never tick
  // after a programmatic mutation (e.g. `metadata.attach`), so consumer UI that
  // re-lists on slice change would stay stale.
  let scheduleActiveSearchRefresh = (): void => {};
  const documentChangeListeners = new Set<(change: SuperDocDocumentChange) => void>();
  type DocumentChangeCounter = { epoch: string; seq: number; replacement: unknown };
  const documentChangeCounters = new WeakMap<object, DocumentChangeCounter>();
  let documentEpochCount = 0;
  const readDocumentReplacement = (host: object): unknown =>
    safeCall<unknown>(() => hostMethod(host as LooseRecord, 'getDocumentReplacementVersion')?.(), null);
  const startDocumentChangeEpoch = (host: object): DocumentChangeCounter => {
    documentEpochCount += 1;
    const counter = { epoch: `document-${documentEpochCount}`, seq: 0, replacement: readDocumentReplacement(host) };
    documentChangeCounters.set(host, counter);
    return counter;
  };
  const currentDocumentChangeCounter = (host: object): DocumentChangeCounter => {
    const counter = documentChangeCounters.get(host);
    return counter && counter.replacement === readDocumentReplacement(host) ? counter : startDocumentChangeEpoch(host);
  };
  const pendingRemoteChangeRecords = new WeakMap<object, ChangeRecord[]>();
  const emitDocumentChange = (host: object, facts: DocumentChangeFacts): void => {
    if (documentChangeListeners.size === 0) return;
    const counter = currentDocumentChangeCounter(host);
    counter.seq += 1;
    const change: SuperDocDocumentChange = { documentEpoch: counter.epoch, seq: counter.seq, ...facts };
    for (const listener of Array.from(documentChangeListeners)) safeCall(() => listener(change), undefined);
  };
  const takePendingRemoteChangeRecords = (host: object): ChangeRecord[] => {
    const records = pendingRemoteChangeRecords.get(host) ?? [];
    pendingRemoteChangeRecords.delete(host);
    return records;
  };
  const flushPendingRemoteChangeRecords = (host: object): void => {
    const records = takePendingRemoteChangeRecords(host);
    if (records.length > 0) emitDocumentChange(host, remoteDocumentChange(records));
  };
  const holdRemoteChangeRecords = (host: object, records: ChangeRecord[]): void => {
    const pending = pendingRemoteChangeRecords.get(host);
    if (pending) {
      pending.push(...records);
      return;
    }
    pendingRemoteChangeRecords.set(host, records);
    const flush = () => flushPendingRemoteChangeRecords(host);
    if (typeof queueMicrotask === 'function') queueMicrotask(flush);
    else void Promise.resolve().then(flush);
  };
  const publishDocumentChange = (host: object, event: LooseRecord): void => {
    if (event.type === 'collaboration:document-replaced' || event.documentReplaced === true) {
      pendingRemoteChangeRecords.delete(host);
      startDocumentChangeEpoch(host);
      return;
    }
    if (documentChangeListeners.size === 0) {
      pendingRemoteChangeRecords.delete(host);
      return;
    }
    if (event.type === 'changes:recorded') {
      const records = remoteChangeRecordsOf(event);
      if (records.length > 0) holdRemoteChangeRecords(host, records);
      return;
    }
    if (event.type === 'collaboration:remote-changed') {
      emitDocumentChange(host, remoteDocumentChange(takePendingRemoteChangeRecords(host)));
      return;
    }
    const facts = documentChangeFromHostEvent(event);
    if (facts) emitDocumentChange(host, facts);
  };
  const syncHostEventsSubscription = (): void => {
    const editor = getEditor();
    const host = editor?.host as LooseRecord | undefined;
    const events = host?.events;
    const next = isPlainObject(events) && typeof events.subscribe === 'function' ? events : null;
    if (next === currentHostEventsSource) return;
    if (detachHostEvents) {
      detachHostEvents();
      detachHostEvents = null;
    }
    currentHostEventsSource = next;
    if (!next) return;
    if (host) {
      // The host can commit edits while another editor owns this subscription.
      hostSeededMutationRevision.delete(host);
      seedLocalDocumentMutation(host);
    }
    try {
      const off = hostMethod(
        next,
        'subscribe',
      )?.((event: LooseRecord) => {
        const type = event?.type;
        if (type === 'collaboration:remote-comments-changed') {
          remoteCommentsRevision += 1;
          if (asyncReads.has('comments')) demandHeavyDocRead('comments');
          recompute('remote-comments');
          return;
        }
        if (host) publishDocumentChange(host, event);
        const isStandaloneDocumentMutation = type === 'document:mutated' && event.hasCommitEvent !== true;
        if (
          type === 'collaboration:document-replaced' ||
          isStandaloneDocumentMutation ||
          (type === 'mutation:committed' && mutationCommittedEventChangedVisibleContent(event)) ||
          type === 'collaboration:remote-changed'
        ) {
          noteUiTrackedChangesCatalogCommit(event);
          // A confirmed toggle belongs to its source revision. A later actual
          // mutation must not inherit it while that revision's read is pending.
          for (const [commandId, optimistic] of optimisticInlineToggles) {
            if (optimistic.settled || type === 'collaboration:document-replaced') {
              optimisticInlineToggles.delete(commandId);
            }
          }
        }
        if (
          isStandaloneDocumentMutation ||
          (type === 'mutation:committed' && mutationCommittedEventChangedVisibleContent(event)) ||
          (type === 'collaboration:remote-changed' &&
            Array.isArray(event.changedStoryIds) &&
            event.changedStoryIds.length > 0)
        ) {
          scheduleActiveSearchRefresh();
        }
        // `document:mutated` covers every committed family, including the
        // non-receipt Document API results that never emit
        // `mutation:committed`. The receipt event stays as a fallback for
        // hosts that predate the dedicated signal.
        const documentEdited =
          type === 'document:mutated' ||
          (type === 'mutation:committed' && mutationCommittedEventChangedDocument(event));
        if (documentEdited && host && hostMethod(host, 'isDirty')) {
          recompute('document-dirty');
        } else if (documentEdited && host && !dirtyHosts.has(host)) {
          dirtyHosts.add(host);
          recompute('document-dirty');
        }
        if (type === 'document:saved-point-changed') recompute('document-dirty');
        if (type === 'collaboration:document-replaced' && host) {
          // The host reopened the authoritative remote document under the
          // same identity and reset its local revision. Local edits made to
          // the previous document are gone with it.
          dirtyHosts.delete(host);
          hostSeededMutationRevision.delete(host);
          seedLocalDocumentMutation(host);
          recompute('document-dirty');
        }
        if (type === 'review-mutation:started') {
          beginUiReviewMutation((event.reviewMutation as LooseRecord | undefined)?.token);
          return;
        }
        if (type === 'review-mutation:aborted') {
          settleUiReviewMutation((event.reviewMutation as LooseRecord | undefined)?.token);
          scheduleAsyncRefresh();
          return;
        }
        if (type === 'mutation:rejected' && event.reviewMutation) {
          settleUiReviewMutation((event.reviewMutation as LooseRecord).token);
          scheduleAsyncRefresh();
        }
        if (type === 'mutation:committed' && event.reviewMutation) {
          settleUiReviewMutation((event.reviewMutation as LooseRecord).token);
        }
        if (type === 'source:complete' || type === 'source:signals-complete') {
          heavyReadGate.noteSourceComplete();
          return;
        }
        if (isStandaloneDocumentMutation || type === 'mutation:committed' || type === 'collaboration:remote-changed') {
          heavyReadGate.noteEditableActivity();
        }
        if (
          isStandaloneDocumentMutation ||
          type === 'mutation:committed' ||
          type === 'save:completed' ||
          type === 'collaboration:remote-changed'
        ) {
          // A document mutation can change content reads (comments, tracked
          // changes, content controls, styles catalogue, node/list/hyperlink
          // reads), so bump the content revision before recomputing; the
          // coordinator then re-fetches them. Remote collaboration applies
          // are document mutations too, but do not emit `mutation:committed`.
          const impact = type === 'mutation:committed' ? getV2TrackedChangeMutationImpact(event) : null;
          if (impact?.allResolved) {
            // The exact receipt proves the complete cross-story catalog is
            // empty. Seed both cached projections and publish that bounded
            // delta directly. Falling through to generic content invalidation
            // would immediately start the redundant full list that this proof
            // makes unnecessary (notably for Reject All, whose receipt does
            // not enumerate every removed logical identity).
            replaceTrackedChangeItemsInCache([]);
            publishAllTrackedChangesResolved(event.receipt);
            if (event.cause === 'preview') invalidateDocumentContent();
            return;
          }
          if (impact?.removedIds.size) {
            // Decision rows disappear synchronously; they do not need a paint
            // barrier because their canonical identity is no longer live.
            markPostDecisionTrackChanges(new Set(impact.removedIds), event.receipt);
          }
          const isTypingBurst =
            (type === 'mutation:committed' && isEditableTextMutationEvent(event)) ||
            (type === 'collaboration:remote-changed' &&
              Array.isArray(event.changedStoryIds) &&
              event.changedStoryIds.length > 0);
          if (isTypingBurst) {
            // Remote story changes do not identify the originating operation.
            // Treat them as typing-class for heavy catalogs while allowing
            // part-only review updates (for example comments.xml) to refresh
            // promptly. Preserve the immediate recompute below for lightweight
            // selection/block state such as paragraph alignment.
            heavyReadGate.noteTypingBurst();
          }
          if (type === 'mutation:committed' && isTypingBurst) {
            scheduleTypingDocumentContentInvalidation();
            return;
          }
          if (impact?.removedIds.size && impact.upsertIds.size === 0) {
            if (event.cause === 'preview') invalidateDocumentContent();
            return;
          }
          if (
            isStandaloneDocumentMutation ||
            type === 'collaboration:remote-changed' ||
            (type === 'mutation:committed' && !isTypingBurst)
          ) {
            // These events follow source application but precede the scheduler
            // paint. Refresh immediately for direct source values, then once
            // more after mounted projection catches up so inherited paragraph
            // formatting cannot remain stale.
            schedulePostPaintContentRefresh();
          }
          const remoteCommentsPartChanged =
            type === 'collaboration:remote-changed' &&
            Array.isArray(event.changedPartUris) &&
            event.changedPartUris.some(
              (partUri) => typeof partUri === 'string' && COMMENTS_CATALOG_PART_URIS.has(partUri),
            );
          const loadedCommentAnchorsMayHaveChanged =
            type === 'collaboration:remote-changed' &&
            Array.isArray(event.changedStoryIds) &&
            event.changedStoryIds.length > 0 &&
            heavyReadGate.commentsCatalogMayHaveRows();
          if (remoteCommentsPartChanged && !isTypingBurst) {
            // A part-only review update still advances the shared content
            // token. Hold passive catalogs behind the normal idle gate while
            // the demanded comments read below refreshes immediately.
            heavyReadGate.holdHeavyReadsUntilIdle();
          }
          invalidateDocumentContent();
          if (remoteCommentsPartChanged && !isTypingBurst) {
            // Comments-part changes are authoritative for the catalog. Story
            // edits also require a refresh when loaded rows may carry shifted
            // anchors, but that refresh must stay behind the typing-idle gate:
            // on annotation-heavy documents a rich comments.list can occupy
            // the shared mutation worker for seconds. A comments-part-only
            // update is not a typing burst and remains prompt.
            demandHeavyDocRead('comments');
          } else if (loadedCommentAnchorsMayHaveChanged) {
            heavyReadGate.holdHeavyReadsUntilIdle();
            heavyReadGate.scheduleHeavyReadCompletionRecompute();
          }
          recompute();
        }
      });
      if (typeof off === 'function') detachHostEvents = () => off();
    } catch {
      currentHostEventsSource = null;
    }
  };

  const recompute = (reason = 'unspecified'): void => {
    cancelFrameRecompute();
    microtaskRecomputeQueued = false;
    if (disposed) return;
    for (const request of pendingListRequests) {
      if (request.editor !== getEditor() || request.doc !== getEditor()?.doc) request.cancel('owner-changed');
      else if (!request.cancelled && request.mode !== readDocumentMode()) request.cancel();
    }
    const { sink } = readUiBenchRuntime();
    const startedAtMs = sink ? uiBenchNowMs() : 0;
    syncCoordinatorEditor();
    syncHostSelectionSubscription();
    syncEditCommandsSubscription();
    syncV2ReviewWindowSubscription();
    syncHostReviewSubscription();
    syncDocumentSelectionFallbackSubscription();
    syncHostEventsSubscription();
    const nextState = computeState(reason);
    syncOptimisticInlineSelection(nextState.selection);
    state = nextState;
    let listenerTotalMs = 0;
    let listenerMaxMs = 0;
    for (const listener of [...listeners]) {
      if (!sink) {
        listener(state);
        continue;
      }
      const listenerStartedAtMs = uiBenchNowMs();
      listener(state);
      const listenerMs = uiBenchNowMs() - listenerStartedAtMs;
      listenerTotalMs += listenerMs;
      listenerMaxMs = Math.max(listenerMaxMs, listenerMs);
    }
    if (sink) {
      const completedAtMs = uiBenchNowMs();
      emitUiBenchTiming({
        stage: 'superdoc-ui-recompute',
        atMs: completedAtMs,
        reason,
        startedAtMs,
        completedAtMs,
        durationMs: completedAtMs - startedAtMs,
        listenerCount: listeners.size,
        listenerTotalMs,
        listenerMaxMs,
      });
    }
  };

  // -- event wiring ---------------------------------------------------------
  /**
   * Work that is bound to one specific active editor and cannot survive a swap.
   * Recomputing aggregate state is not enough for these: a geometry
   * subscription points at a DOM host that is going away, and an in-flight
   * async query would publish the old document's result into the new one.
   *
   * Populated by the viewport and search handles further down. The handler only
   * runs on a host event, which cannot happen during construction, so
   * registering later than `attach` is safe.
   */
  const activeEditorResetHooks: Array<() => void> = [];
  /**
   * The subset bound to the DOCUMENT rather than to the editor.
   *
   * `replaceFile()` swaps content in place: the editor object and its host both
   * survive, so a geometry subscription is still attached to the thing now
   * rendering the replacement and must be left alone. Search state describes
   * content that is gone and must not be.
   *
   * Measured rather than assumed — after an in-place replace the geometry
   * subscription is never detached and keeps firing, while `search.total` still
   * reports the previous document's match count.
   */
  const documentResetHooks: Array<() => void> = [];
  /**
   * Slices that publish through their own listener set rather than the
   * aggregate `listeners`. `recompute()` never reaches them, so a mode change
   * that alters what the host reports must republish them explicitly.
   */
  const documentModeChangeHooks: Array<() => void> = [];

  const runHooks = (hooks: Array<() => void>): void => {
    for (const reset of hooks) {
      try {
        reset();
      } catch {
        /* one stale subscription must not stop the others from being released */
      }
    }
  };
  const runActiveEditorResetHooks = (): void => runHooks(activeEditorResetHooks);
  const runDocumentResetHooks = (): void => runHooks(documentResetHooks);
  const runDocumentModeChangeHooks = (): void => runHooks(documentModeChangeHooks);

  const detachers: Array<() => void> = [];
  const attach = (source: LooseRecord | null, events: readonly string[]): void => {
    if (!source || typeof source.on !== 'function') return;
    for (const event of events) {
      const handler =
        event === 'active-editor-change'
          ? () => {
              // An editor swap invalidates everything scoped to the old editor,
              // documents included.
              runActiveEditorResetHooks();
              runDocumentResetHooks();
              recompute();
            }
          : event === 'document-replaced'
            ? (payload?: unknown) => {
                // A replace is asynchronous, so the active editor can move while
                // it is in flight. Reset only on a positive identity match: an
                // event that does not name THIS controller's editor cannot be
                // confirmed as ours, and acting on it would clear a search the
                // user just opened on something else.
                // Match on either identity, because which one survives depends
                // on the path. A plain in-place replace keeps the editor object.
                // The V2 browser path does not: it emits its ready payload before
                // `replaceFile()` resolves, so the shell installs a new facade
                // first and the captured facade is one this controller no longer
                // holds — matching on the editor alone makes the reset a no-op
                // exactly where it matters most. The HOST survives both.
                const detail = payload && typeof payload === 'object' ? (payload as LooseRecord) : null;
                const replacedEditor = detail?.['editor'];
                const replacedHost = detail?.['host'];
                const matchesEditor = Boolean(replacedEditor) && replacedEditor === getEditor();
                const matchesHost = Boolean(replacedHost) && replacedHost === getHost();
                // Still a positive match: an event naming neither is not ours.
                if (!matchesEditor && !matchesHost) return;
                // The replaced document starts clean. This is not part of
                // `documentResetHooks`: those also run on `active-editor-change`,
                // where the previous editor's unsaved edits must survive.
                const replacedDirtyHost = (matchesHost ? replacedHost : getHost()) as object | null;
                if (replacedDirtyHost) {
                  dirtyHosts.delete(replacedDirtyHost);
                  hostSeededMutationRevision.delete(replacedDirtyHost);
                }

                // Search state is the visible half; the async read caches are the
                // quiet half. They are keyed by `contentToken()` — editor identity
                // plus mutation revision — and a replace changes neither, so
                // comments and the rest keep serving the previous document.
                // Measured: without the clear, `doc.comments.list` is never called
                // again after a replace, and `readAsync()` serves a settled entry
                // from any token as `stale` while its replacement is in flight.
                runDocumentResetHooks();
                optimisticInlineToggles.clear();
                asyncReads.clear();
                invalidateDocumentContent();
                recompute();
              }
            : event === 'document-mode-change'
              ? () => {
                  recompute();
                  runDocumentModeChangeHooks();
                }
              : event === 'viewport-change'
                ? () => requestFrameRecompute('viewport-change')
                : () => recompute();
      try {
        source.on(event, handler);
        detachers.push(() => {
          try {
            if (typeof source.off === 'function') source.off(event, handler);
          } catch {
            /* ignore */
          }
        });
      } catch {
        /* ignore unsupported event names */
      }
    }
  };
  attach(superdoc, HOST_EVENTS);
  attach(superdoc, ['collaboration-connection-change']);
  syncHostSelectionSubscription();
  syncEditCommandsSubscription();
  syncV2ReviewWindowSubscription();
  syncHostReviewSubscription();
  syncDocumentSelectionFallbackSubscription();
  syncHostEventsSubscription();

  // -- select / subscribe ---------------------------------------------------
  const select = <TSlice>(
    selector: SelectorFn<SuperDocUIState, TSlice>,
    equality: EqualityFn<TSlice> = shallowEqual as EqualityFn<TSlice>,
  ): Subscribable<TSlice> => {
    return {
      get: () => selector(state),
      subscribe: (cb: (value: TSlice) => void) => {
        let last = selector(state);
        const listener = (next: SuperDocUIState) => {
          const value = selector(next);
          if (!equality(last, value)) {
            last = value;
            cb(value);
          }
        };
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  };

  const sliceHandle = <TSlice>(selector: SelectorFn<SuperDocUIState, TSlice>): Subscribable<TSlice> => select(selector);

  /**
   * Wrap an underlying selector {@link Subscribable} (raw `get` + value
   * `subscribe`) in the main-compatible domain-handle subscription shape so
   * every customer-facing handle exposes the same contract main does:
   *
   *   - `getSnapshot()` reads the current slice;
   *   - `observe(listener)` emits the current value immediately, then on each
   *     change (the listener receives the snapshot directly);
   *   - `subscribe(listener)` is the `{ snapshot }`-shaped alias of `observe`,
   *     likewise emitting immediately then on change.
   *
   * The generic `select(...)` substrate stays raw-value and unchanged; only the
   * domain handles are composed from this.
   */
  const snapshotHandle = <TSlice>(sub: Subscribable<TSlice>): SnapshotSubscribable<TSlice> => {
    const observe = (listener: (snapshot: TSlice) => void): (() => void) => {
      // Isolate listener errors on BOTH the immediate emit and subsequent change
      // emits: the raw substrate notify loop (`recompute`) does not guard
      // per-listener, so a throwing observer would otherwise break its siblings
      // on a change.
      const safe = (snapshot: TSlice): void => {
        try {
          listener(snapshot);
        } catch {
          /* isolate listener errors, matching select() */
        }
      };
      // Subscribe BEFORE the immediate emit so a synchronous recompute
      // triggered by the first listener (e.g. an observer whose first callback
      // calls `setActive`) is not missed: the raw substrate's own `subscribe`
      // does not emit on attach, so this yields exactly one immediate emit plus
      // future change emits.
      const unsubscribe = sub.subscribe(safe);
      safe(sub.get());
      return unsubscribe;
    };
    return {
      // `get` is an undocumented retained alias of `getSnapshot` for existing v2
      // callers; `getSnapshot` is the canonical, main-compatible name.
      get: () => sub.get(),
      getSnapshot: () => sub.get(),
      observe,
      subscribe: (listener) => observe((snapshot) => listener({ snapshot })),
    };
  };

  const directorySnapshotHandle = <TSlice>(
    passiveSub: Subscribable<TSlice>,
    directorySub: Subscribable<TSlice>,
    family: DirectoryFamily,
  ): SnapshotSubscribable<TSlice> => {
    const passive = snapshotHandle(passiveSub);
    const directory = snapshotHandle(directorySub);
    const observe = (listener: (snapshot: TSlice) => void): (() => void) => {
      const release = acquireDirectoryLease(family);
      // Refresh host/editor bindings before the first directory selector runs.
      // React observers can attach during V2 bridge installation; without this
      // sync they can cold-start a catalog against the bootstrap editor and
      // retain that partial result after source streaming completes.
      recompute();
      const unsubscribe = directory.observe(listener);
      return () => {
        unsubscribe();
        release();
      };
    };
    return {
      get: passive.get,
      getSnapshot: passive.getSnapshot,
      observe,
      subscribe: (listener) => observe((snapshot) => listener({ snapshot })),
    };
  };

  // -- command execution ----------------------------------------------------
  function readTrackDecisionTargetId(target: unknown): string | null {
    return target && typeof target === 'object' && typeof (target as LooseRecord).id === 'string'
      ? String((target as LooseRecord).id)
      : null;
  }

  function nonBodySelectionStoryLocator(selection: SelectionSlice): unknown | undefined {
    const story = selectionStoryLocator(selection);
    return story && storyLocatorSignature(story) !== storyLocatorSignature(null) ? story : undefined;
  }

  function trackDecisionIdTarget(changeId: string, story?: unknown): LooseRecord {
    return { kind: 'id', id: changeId, ...(story ? { story } : {}) };
  }

  /**
   * Build the Document API range target for a partial tracked-change decision.
   * The explicit selection target is authoritative and labels its coordinates:
   * ordinary/insertion selections are visible-space, while a selection that
   * reaches painted deleted text is projected in tracked space by the host.
   *
   * Cross-block and object-containing coverage use the model-backed tracked
   * target when the explicit text selection cannot represent the range.
   */
  function trackDecisionRangeFromSelection(selection: SelectionSlice): LooseRecord | null {
    if (selection.empty) return null;
    if (!selection.selectionTarget && selection.trackedTarget) {
      return { kind: 'range', coordinateSpace: 'tracked', range: selection.trackedTarget };
    }
    const explicit = selection.selectionTarget;
    const start = explicit?.start;
    const end = explicit?.end;
    if (start?.kind === 'text' && end?.kind === 'text' && start.blockId !== end.blockId) {
      const range = selection.trackedTarget;
      return range ? { kind: 'range', coordinateSpace: 'tracked', range } : null;
    }
    if (
      explicit?.kind !== 'selection' ||
      start?.kind !== 'text' ||
      end?.kind !== 'text' ||
      typeof start.blockId !== 'string' ||
      start.blockId !== end.blockId ||
      !Number.isInteger(start.offset) ||
      !Number.isInteger(end.offset) ||
      start.offset < 0 ||
      end.offset < 0 ||
      start.offset === end.offset
    ) {
      return null;
    }
    const rangeStart = Math.min(start.offset, end.offset);
    const rangeEnd = Math.max(start.offset, end.offset);
    const story = selectionStoryLocator(selection);
    return {
      kind: 'range',
      coordinateSpace: explicit.coordinateSpace === 'tracked' ? 'tracked' : 'visible',
      range: {
        kind: 'text',
        ...(story ? { story } : {}),
        segments: [{ blockId: start.blockId, range: { start: rangeStart, end: rangeEnd } }],
      },
    };
  }

  function readBodyTrackChangeForDecision(activeId: string, story: unknown): TrackChangesItem | undefined {
    if (storyLocatorSignature(story) !== storyLocatorSignature(null)) return undefined;
    if (getEditor()?.editorVersion === 2) return undefined;
    const trackChanges = getDoc()?.trackChanges as LooseRecord | undefined;
    const list = trackChanges?.list;
    if (typeof list !== 'function') return undefined;
    const raw = safeCall(() => list.call(trackChanges), null);
    if (isPromiseLike(raw) || !raw || typeof raw !== 'object') return undefined;
    const items = (raw as LooseRecord).items;
    if (!Array.isArray(items)) return undefined;
    return items
      .map(projectTrackChangesItem)
      .find((item): item is TrackChangesItem => item != null && entityRowMatchesRequest(item, activeId, story));
  }

  function selectedTextCoversTrackChangeText(selection: SelectionSlice, item: TrackChangesItem): boolean {
    const selected = normalizeTrackDecisionText(selection.quotedText);
    if (!selected) return false;
    const payload = trackChangesItemPayload(item);
    return [payload.insertedText, payload.deletedText, payload.excerpt].some(
      (value) => normalizeTrackDecisionText(value) === selected,
    );
  }

  function normalizeTrackDecisionText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function activeChangePartialDecisionRoute(
    selection: SelectionSlice = state.selection,
  ): 'range' | 'id' | 'unavailable' {
    const activeId = selection.activeChangeIds[0];
    if (!activeId) return 'unavailable';
    const story = selectionStoryLocator(selection);
    // The command gate can run during the first state computation, before
    // `state` exists; the catalog reads below cover that case.
    const trackChanges = state?.trackChanges;
    const bodyItem =
      trackChanges?.status === 'ready'
        ? trackChanges.items.find((candidate) => entityRowMatchesRequest(candidate, activeId, story))
        : undefined;
    const item =
      bodyItem ??
      readBodyTrackChangeForDecision(activeId, story) ??
      readAllStoryTrackChanges()?.find((candidate) => entityRowMatchesRequest(candidate, activeId, story));
    if (!item) return 'unavailable';
    const change = trackChangesItemPayload(item);
    const type = change.type;
    const grouping = change.grouping;
    if (selectedTextCoversTrackChangeText(selection, item)) return 'id';
    if (type === 'replacement' && grouping === 'replacement-pair') return 'range';
    return (type === 'insertion' || type === 'deletion' || type === 'insert' || type === 'delete') &&
      grouping === 'standalone'
      ? 'range'
      : 'id';
  }

  /** A decision target carried by the payload itself, independent of the selection. */
  function explicitTrackDecisionTarget(
    payload: unknown,
  ): { target: LooseRecord; changeId: string | null; story?: unknown } | null {
    if (typeof payload === 'string' && payload.length > 0) {
      return { target: { kind: 'id', id: payload }, changeId: payload };
    }
    if (payload && typeof payload === 'object') {
      const record = payload as LooseRecord;
      if (record.target && typeof record.target === 'object') {
        const target = record.target as LooseRecord;
        return { target, changeId: readTrackDecisionTargetId(target), story: target.story };
      }
      const id = typeof record.changeId === 'string' ? record.changeId : record.id;
      if (typeof id === 'string' && id.length > 0) {
        return { target: trackDecisionIdTarget(id, record.story), changeId: id, story: record.story };
      }
    }
    return null;
  }

  function resolveTrackDecisionTarget(
    command: { kind: 'accept' | 'reject'; scope: 'id' | 'all' },
    payload: unknown,
  ): { target: LooseRecord; changeId: string | null; story?: unknown } | null {
    if (command.scope === 'all') return { target: { kind: 'all' }, changeId: null };
    const explicit = explicitTrackDecisionTarget(payload);
    if (explicit) return explicit;
    const selectedId = state.selection.activeChangeIds[0];
    const story = nonBodySelectionStoryLocator(state.selection);
    return selectedId ? { target: trackDecisionIdTarget(selectedId, story), changeId: selectedId, story } : null;
  }

  /**
   * The selection-derived decision for a review command. The command gate and
   * execution share these rules so an enabled command always has a target.
   * `null` means the selection does not drive the decision (no active change
   * or a collapsed caret) and the caller falls back to the active change id.
   * `gateOnly` stops after the blocking rules and returns only a block or null.
   */
  function planSelectionTrackDecision(selection: SelectionSlice, gateOnly = false): SelectionTrackDecisionPlan | null {
    if (
      selection.tableSelection?.kind === 'tableCells' &&
      (selection.tableSelection.type === 'cells' || selection.tableSelection.type === 'table')
    ) {
      return { kind: 'blocked', reason: SUPERDOC_UI_REASONS.operationUnavailable };
    }
    const ids = selection.activeChangeIds;
    if (ids.length > 1) {
      // Wholly selected changes are decided by id so move and grouped
      // revisions keep their atomic id semantics; a range would refuse them.
      if (selection.empty || selection.trackedChangesWhollySelected === true) return { kind: 'ids', ids };
      if (selection.trackedChangeRangeDecisionSupported === false) {
        return { kind: 'blocked', reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      const target = trackDecisionRangeFromSelection(selection);
      return target
        ? { kind: 'range', target, changeId: null, permissionIds: ids }
        : { kind: 'blocked', reason: SUPERDOC_UI_REASONS.targetUnresolved };
    }
    if (ids.length !== 1 || selection.empty) return null;
    const activeId = ids[0]!;
    // The route may read the catalog, so the gate resolves it only when a
    // blocking rule depends on it.
    let routeValue: 'range' | 'id' | 'unavailable' | undefined;
    const route = () =>
      (routeValue ??=
        selection.trackedChangesWhollySelected === true ? 'id' : activeChangePartialDecisionRoute(selection));
    if (selection.trackedChangeRangeDecisionSupported === false && route() !== 'id') {
      return { kind: 'blocked', reason: SUPERDOC_UI_REASONS.operationUnavailable };
    }
    if (!selection.selectionTarget && !selection.trackedTarget && selection.target?.kind !== 'text') return null;
    const target = trackDecisionRangeFromSelection(selection);
    if (!target && route() !== 'id') {
      return { kind: 'blocked', reason: SUPERDOC_UI_REASONS.targetUnresolved };
    }
    if (gateOnly) return null;
    if (route() === 'id') {
      const selectedStory = selectionStoryLocator(selection);
      // Whole-change id routes need the non-body story to avoid the legacy
      // unscoped mutation path. Body routes intentionally omit it.
      const story =
        selectedStory && storyLocatorSignature(selectedStory) !== storyLocatorSignature(null)
          ? selectedStory
          : undefined;
      return { kind: 'id', id: activeId, story };
    }
    if (route() === 'unavailable' && !selection.trackedTarget) return { kind: 'unavailable' };
    return target
      ? { kind: 'range', target, changeId: activeId, story: nonBodySelectionStoryLocator(selection) }
      : { kind: 'blocked', reason: SUPERDOC_UI_REASONS.targetUnresolved };
  }

  function executeTrackDecisionCommand(
    command: { kind: 'accept' | 'reject'; scope: 'id' | 'all' },
    payload: unknown,
  ): CommandExecutionResult {
    if (command.scope === 'id' && payload == null && reviewWarmingSelections.has(state.selection)) {
      return settleCommandExecution(decideSelectionAfterReviewWarmup(command));
    }
    if (command.scope === 'id' && payload == null) {
      const plan = planSelectionTrackDecision(state.selection);
      switch (plan?.kind) {
        case 'blocked':
        case 'unavailable':
          return false;
        case 'ids':
          return executeTrackDecisionTarget(command.kind, { kind: 'ids', ids: plan.ids }, null, undefined, plan.ids);
        case 'range':
          return executeTrackDecisionTarget(command.kind, plan.target, plan.changeId, plan.story, plan.permissionIds);
        case 'id':
          return executeTrackDecision(command.kind, plan.story ? { id: plan.id, story: plan.story } : plan.id);
      }
    }
    const resolved = resolveTrackDecisionTarget(command, payload);
    if (!resolved) return false;
    return executeTrackDecisionTarget(command.kind, resolved.target, resolved.changeId, resolved.story);
  }

  async function decideSelectionAfterReviewWarmup(command: {
    kind: 'accept' | 'reject';
    scope: 'id' | 'all';
  }): Promise<CommandExecutionResult> {
    const list = hostMethod(getDoc()?.trackChanges, 'list');
    if (list) await list({ in: 'all', limit: 1, offset: 0 });
    const current = hostMethod(getDoc()?.selection, 'current');
    if (!current) return false;
    const info = normalizeSelectionInfo(
      await current({
        includeText: true,
        ...(getEditor()?.editorVersion === 2 ? { offsetSpace: 'selection' } : {}),
      }),
    );
    if (!info || selectionInfoReviewWarming(info)) return false;
    const plan = planSelectionTrackDecision(buildSelectionSlice(info, 'ready'));
    const settledResult = (result: CommandExecutionResult): Promise<CommandExecutionResult> =>
      result === false ? Promise.resolve(false) : lastCommandSettlement;
    switch (plan?.kind) {
      case undefined:
      case 'blocked':
      case 'unavailable':
        return false;
      case 'ids':
        return settledResult(
          executeTrackDecisionTarget(command.kind, { kind: 'ids', ids: plan.ids }, null, undefined, plan.ids),
        );
      case 'range':
        return settledResult(
          executeTrackDecisionTarget(command.kind, plan.target, plan.changeId, plan.story, plan.permissionIds),
        );
      case 'id':
        return settledResult(
          executeTrackDecision(command.kind, plan.story ? { id: plan.id, story: plan.story } : plan.id),
        );
    }
  }

  const hasInactiveTextSelection = (): boolean => {
    const host = getHost();
    const read = host?.readLiveSelectionSyncSnapshot;
    if (typeof read !== 'function') return false;
    // Public active text can be empty while the worker retains a resumable
    // body caret. Toolbar block targets must not borrow that private caret.
    const info = safeCall<LooseRecord | null>(() => read.call(host), null);
    return !info || (info.empty === true && !info.target && !info.selectionTarget);
  };

  function executeListToggleCommand(
    kind: 'bullet' | 'ordered',
    payload: unknown,
    preparedSelection?: SelectionSlice,
  ): CommandExecutionResult {
    if (hasInactiveTextSelection()) return false;
    const editCommands = getEditCommands();
    const apply = hostMethod(editCommands?.lists, 'apply');
    const host = getHost();
    const requiresRegisteredMutation = firstPartyCommandDoc !== undefined && getEditor()?.editorVersion === 2;
    const firstPartyMutation =
      requiresRegisteredMutation && host ? firstPartyCommandMutations.get(superdoc)?.get(host) : null;
    if (requiresRegisteredMutation && !firstPartyMutation) return false;
    if (!firstPartyMutation && !apply) return false;
    // The style dropdowns emit a bare style-key string (e.g. 'upper-roman');
    // the public command surface also accepts an options object. Normalize both
    // into { behavior?, preset?, continuity? }. The command id owns `kind`.
    const overrides: LooseRecord =
      typeof payload === 'string'
        ? presetFromToolbarStyleKey(payload)
        : payload && typeof payload === 'object'
          ? (payload as LooseRecord)
          : {};
    const { behavior, preset, continuity } = overrides;
    const input: LooseRecord = { kind, behavior: behavior ?? 'toggle' };
    if (preset !== undefined) input.preset = preset;
    if (continuity !== undefined) input.continuity = continuity;
    if (preparedSelection && getEditor()?.editorVersion === 2) {
      if (preparedSelection.tableSelection?.selectionMode === 'cells') {
        const table = listTableSelection(preparedSelection);
        if (!table) return false;
        input.tableSelection = table;
      } else {
        const target = preparedSelection.selectionTarget ?? selectionTargetFromTextTarget(preparedSelection.target);
        if (!target) return false;
        input.target = target;
      }
    }
    const candidateReadiness = getEditor()?.documentMutationReadiness;
    const readiness = isPlainObject(candidateReadiness) ? candidateReadiness : undefined;
    try {
      const capturedApply = preparedSelection ? capturedListApplications.get(preparedSelection) : undefined;
      const operation = capturedApply
        ? capturedApply(input)
        : firstPartyMutation
          ? firstPartyMutation.runListApply(input)
          : apply?.(input);
      if (!preparedSelection) return settleCommandExecution(operation);
      const source = Promise.resolve(operation).then((raw) => {
        const mapped = commandResultFromOperationResult(raw);
        if (!commandResultSucceeded(mapped)) return { result: mapped, receipt: undefined };
        const nestedResult = commandResultFromOperationResult(isPlainObject(raw) ? raw.receipt : undefined);
        const receipt = isSuccessfulReceipt(nestedResult)
          ? nestedResult
          : isSuccessfulReceipt(mapped)
            ? mapped
            : undefined;
        return { result: firstPartyMutation ? true : mapped, receipt };
      });
      listCommandSourceSettlements.set(
        preparedSelection,
        source.then(
          ({ result }) => result,
          () => false,
        ),
      );
      return settleCommandExecution(
        source.then(async ({ result, receipt }) => {
          if (!commandResultSucceeded(result)) return result;
          const whenPainted = readiness?.whenPainted;
          if (typeof whenPainted === 'function') {
            try {
              await whenPainted.call(readiness, receipt);
            } catch {}
          }
          return result;
        }),
      );
    } catch {
      return false;
    }
  }

  let lastCommandSettlement: Promise<CommandExecutionResult> = Promise.resolve(false);
  let pendingCommandSettlement: Promise<CommandExecutionResult> | null = null;
  let pendingFieldInsertion: Promise<CommandExecutionResult> | null = null;
  let pendingPageNumbering: Promise<CommandExecutionResult> | null = null;
  let lastInlineToggleCommandSettlement: Promise<CommandExecutionResult> = Promise.resolve(false);

  const awaitMutationReadiness = async (result: CommandExecutionResult): Promise<CommandExecutionResult> => {
    if (!isSuccessfulReceipt(result)) return result;
    const readiness = getEditor()?.documentMutationReadiness as LooseRecord | undefined;
    const whenPainted = readiness?.whenPainted;
    if (typeof whenPainted !== 'function') return result;
    const txId = typeof result.txId === 'string' ? result.txId : undefined;
    try {
      await whenPainted.call(readiness, txId ? { txId } : undefined);
    } catch {
      // The document mutation already committed. Readiness is an observation
      // boundary, so a paint-wait failure must not turn a success receipt into
      // an execution failure.
    }
    return result;
  };

  const settleOperationResult = (
    result: unknown,
  ): {
    immediate: CommandExecutionResult;
    committed: Promise<CommandExecutionResult>;
    settled: Promise<CommandExecutionResult>;
  } => {
    if (isPromiseLike(result)) {
      const operation = Promise.resolve(result);
      const committed = operation.then(
        (resolved) => commandResultFromOperationResult(resolved),
        () => false,
      );
      return {
        immediate: true,
        committed,
        settled: operation.then(
          (resolved) => awaitMutationReadiness(commandResultFromOperationResult(resolved)),
          () => false,
        ),
      };
    }
    const immediate = commandResultFromOperationResult(result);
    return { immediate, committed: Promise.resolve(immediate), settled: awaitMutationReadiness(immediate) };
  };

  const releaseInlineToggleMutation = (): void => {
    const next = pendingInlineToggleMutations.shift();
    if (!next) {
      inlineToggleMutationActive = false;
      resolveInlineToggleMutationIdle?.();
      resolveInlineToggleMutationIdle = null;
      return;
    }
    try {
      next.resolve(disposed ? false : next.mutate());
    } catch {
      next.resolve(false);
    }
  };

  const releaseInlineToggleMutationOnce = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseInlineToggleMutation();
    };
  };

  const scheduleInlineToggleMutation = (
    key: string,
    mutate: () => unknown,
  ): { result: unknown; release: () => void } => {
    if (!inlineToggleMutationActive) {
      inlineToggleMutationActive = true;
      inlineToggleMutationIdle = new Promise<void>((resolve) => {
        resolveInlineToggleMutationIdle = resolve;
      });
      try {
        return { result: mutate(), release: releaseInlineToggleMutationOnce() };
      } catch (error) {
        inlineToggleMutationActive = false;
        resolveInlineToggleMutationIdle?.();
        resolveInlineToggleMutationIdle = null;
        throw error;
      }
    }

    // Canonical rendering intentionally coalesces adjacent receipts. Keep one
    // latest-wins request per command and selection behind the active paint so
    // alternating shortcuts cannot build a long visual replay queue, while
    // retaining the target captured at each command's most recent gesture.
    const pending = pendingInlineToggleMutations.find((mutation) => mutation.key === key);
    if (pending) {
      pending.mutate = mutate;
      return { result: pending.result, release: () => undefined };
    }

    let resolve!: PendingInlineToggleMutation['resolve'];
    const result = new Promise<unknown>((settle) => {
      resolve = settle;
    });
    pendingInlineToggleMutations.push({ key, mutate, result, resolve });
    return { result, release: releaseInlineToggleMutationOnce() };
  };

  const UNSUPPORTED_TRACKED_UI_MUTATION_ROUTES = new Set([
    'create.tableOfContents',
    'headerFooters.pageNumbers.set',
    'headerFooters.pageNumbers.remove',
  ]);

  const unsupportedTrackedMutationReceipt = (route: string): SuperDocUIFailureReceipt =>
    failedReceipt(`Tracked authoring is not supported for ${route}.`);

  const editorMutationOptionsForRoute = (route: string): LooseRecord | SuperDocUIFailureReceipt | undefined => {
    if (readDocumentMode() !== 'suggesting') return undefined;
    if (UNSUPPORTED_TRACKED_UI_MUTATION_ROUTES.has(route)) return unsupportedTrackedMutationReceipt(route);
    return { changeMode: 'tracked' };
  };

  /** Clear-patch to send for the current document mode (see TRACKED_CLEAR_INLINE_PATCH). */
  const clearInlinePatchForMode = (): Readonly<Record<string, null>> =>
    readDocumentMode() === 'suggesting' ? TRACKED_CLEAR_INLINE_PATCH : CLEAR_INLINE_PATCH;

  const callEditorMutation = (route: string, op: AnyFn, input: unknown): unknown => {
    if (
      (route.startsWith('format.paragraph.') || route.startsWith('lists.') || route.startsWith('styles.paragraph.')) &&
      hasInactiveTextSelection()
    )
      return false;
    const options = editorMutationOptionsForRoute(route);
    if (options && options.success === false) return options;
    return options ? op(input, options) : op(input);
  };

  const captureOptimisticInlineValueResult = (
    descriptor: CommandDescriptor,
    selection: SelectionSlice,
    input: LooseRecord,
    result: unknown,
  ): void => {
    const inline = descriptor.inline;
    if (!inline) return;
    const commandResult = commandResultFromOperationResult(result);
    if (commandResult === false) return;
    if (typeof commandResult === 'object' && commandResult && (commandResult as LooseRecord).success === false) return;
    if (inline.kind === 'clear') {
      optimisticInlineValues.clear();
      return;
    }
    if (inline.kind === 'toggle' || !isProjectedInlineSelectionValueKey(inline.key)) return;
    const selectionSignature = selectionInlineValueSignature(selection);
    if (!selectionSignature) return;
    const value = normalizeOptimisticInlineSelectionValue(inline.key, input.value);
    if (value == null) {
      optimisticInlineValues.delete(inline.key);
      return;
    }
    optimisticInlineValues.set(inline.key, { selectionSignature, value });
  };

  const decorateInlineCommandResult = (
    descriptor: CommandDescriptor,
    selection: SelectionSlice,
    input: LooseRecord,
    result: unknown,
  ): unknown => {
    if (!descriptor.inline || descriptor.inline.kind === 'toggle') return result;
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then((resolved) => {
        captureOptimisticInlineValueResult(descriptor, selection, input, resolved);
        return resolved;
      });
    }
    // Synchronous results settle inside this call; the authoritative re-read
    // comes from finalizeCommandSettlement's invalidate + recompute, so the
    // optimistic capture applies only after a promise-backed receipt resolves
    // (a failed async mutation then never publishes an optimistic value).
    return result;
  };

  const captureOptimisticInlineToggle = (
    descriptor: CommandDescriptor,
    selection: SelectionSlice,
    input: LooseRecord,
    result: unknown,
  ): number | null => {
    if (descriptor.inline?.kind !== 'toggle') return null;
    const commandResult = commandResultFromOperationResult(result);
    if (!commandResultSucceeded(commandResult)) return null;
    if (typeof input.value !== 'boolean' && input.value !== null) return null;
    const selectionSignature = selectionInlineValueSignature(selection);
    if (!selectionSignature) return null;
    const generation = ++optimisticInlineToggleGeneration;
    optimisticInlineToggles.set(descriptor.id, {
      selectionSignature,
      active: input.value === true,
      generation,
      settled: false,
      editorSource: getEditor(),
      documentSource: getEditor()?.doc,
      documentMode: readDocumentMode(),
    });
    recompute();
    return generation;
  };

  const settleOptimisticInlineToggle = (
    descriptor: CommandDescriptor,
    generation: number | null,
    result: CommandExecutionResult,
  ): void => {
    if (generation == null) return;
    const optimistic = optimisticInlineToggles.get(descriptor.id);
    if (!optimistic || optimistic.generation !== generation) return;
    if (!commandResultSucceeded(result)) {
      optimisticInlineToggles.delete(descriptor.id);
      return;
    }
    optimistic.settled = true;
  };

  const finalizeCommandSettlement = (
    promise: Promise<CommandExecutionResult>,
    onSettled?: (result: CommandExecutionResult) => void,
  ): Promise<CommandExecutionResult> =>
    promise.then(
      (settled) => {
        onSettled?.(settled);
        // A command settled: its document work may have changed content reads, so
        // refresh dependent slices while retaining any exact all-resolved
        // tracked-change catalog published by the host event for this command.
        invalidateAfterCommandSettlement();
        return settled;
      },
      () => {
        onSettled?.(false);
        invalidateAfterCommandSettlement();
        return false;
      },
    );

  const settleCommandExecution = (
    result: unknown,
    onSettled?: (result: CommandExecutionResult) => void,
  ): CommandExecutionResult => {
    const pending = pendingCommandSettlement;
    pendingCommandSettlement = null;
    if (pending) {
      lastCommandSettlement = finalizeCommandSettlement(pending, onSettled);
      return commandResultFromOperationResult(result);
    }
    if (isPromiseLike(result)) {
      lastCommandSettlement = finalizeCommandSettlement(settleOperationResult(result).settled, onSettled);
      return true;
    }
    const settled = commandResultFromOperationResult(result);
    if (isSuccessfulReceipt(settled)) {
      const readiness = getEditor()?.documentMutationReadiness as LooseRecord | undefined;
      if (typeof readiness?.whenPainted === 'function') {
        lastCommandSettlement = finalizeCommandSettlement(awaitMutationReadiness(settled), onSettled);
        return settled;
      }
    }
    onSettled?.(settled);
    lastCommandSettlement = Promise.resolve(settled);
    invalidateAfterCommandSettlement();
    return settled;
  };

  const normalizeWorkflowReceipt = (value: unknown, fallback: SuperDocUIReceipt): SuperDocUIReceipt => {
    if (!value || typeof value !== 'object') return fallback;
    return value as Receipt;
  };

  const settleWorkflowReceipt = (
    receipt: unknown,
    fallback = failedReceipt('Document API operation failed.'),
    refreshComments = false,
  ): WorkflowReceipt => {
    if (isPromiseLike(receipt)) {
      return Promise.resolve(receipt).then(
        (resolved) => settleWorkflowReceipt(resolved, fallback, refreshComments),
        () => fallback,
      );
    }
    const normalizedReceipt = normalizeWorkflowReceipt(receipt, fallback);
    // A workflow receipt is a document mutation (comment create/reply/delete,
    // insert, …): invalidate content reads so dependent slices re-fetch.
    invalidateDocumentContent();
    if (isSuccessfulReceipt(normalizedReceipt)) {
      if (refreshComments) {
        const catalog = asyncReads.get('comments');
        if (catalog?.hasSettled || catalog?.inflightToken != null) demandHeavyDocRead('comments');
      }
      const readiness = getEditor()?.documentMutationReadiness as LooseRecord | undefined;
      if (typeof readiness?.whenPainted === 'function') {
        void finalizeCommandSettlement(awaitMutationReadiness(normalizedReceipt));
        recompute();
        return normalizedReceipt;
      }
    }
    recompute();
    return normalizedReceipt;
  };

  /**
   * Apply a Document API operation once per covered block, building the input
   * from the block id. Returns the last success receipt (or `true`), else the
   * last result (or `false`). Recompute is the caller's responsibility.
   */
  const applyPerBlock = (
    route: string,
    op: AnyFn,
    blockIds: readonly string[],
    buildInput: (blockId: string) => LooseRecord | null,
  ): CommandExecutionResult => {
    const immediateResults: CommandExecutionResult[] = [];
    const settledResults: Array<Promise<CommandExecutionResult>> = [];
    for (const blockId of blockIds) {
      const input = buildInput(blockId);
      if (!input) continue;
      try {
        const result = settleOperationResult(callEditorMutation(route, op, input));
        immediateResults.push(result.immediate);
        settledResults.push(result.settled);
      } catch {
        immediateResults.push(false);
        settledResults.push(Promise.resolve(false));
      }
    }
    pendingCommandSettlement = settledResults.length
      ? Promise.all(settledResults).then((results) => combineCommandResults(results))
      : null;
    return combineCommandResults(immediateResults);
  };

  /** Apply a Document API operation once per covered text segment. */
  const applyPerTextAddress = (
    route: string,
    op: AnyFn,
    targets: readonly LooseRecord[],
    buildInput: (target: LooseRecord) => LooseRecord | null,
  ): CommandExecutionResult => {
    const immediateResults: CommandExecutionResult[] = [];
    const settledResults: Array<Promise<CommandExecutionResult>> = [];
    for (const target of targets) {
      const input = buildInput(target);
      if (!input) continue;
      try {
        const result = settleOperationResult(callEditorMutation(route, op, input));
        immediateResults.push(result.immediate);
        settledResults.push(result.settled);
      } catch {
        immediateResults.push(false);
        settledResults.push(Promise.resolve(false));
      }
    }
    pendingCommandSettlement = settledResults.length
      ? Promise.all(settledResults).then((results) => combineCommandResults(results))
      : null;
    return combineCommandResults(immediateResults);
  };

  function currentCellSelectionTarget(): TextSelectionTarget | null {
    return captureInputSelectionTarget(true);
  }

  function captureInputSelectionTarget(requireTableCells = false): TextSelectionTarget | null {
    const handles = safeCall<unknown>(() => hostMethod(getHost(), 'getHandles')?.(), null);
    const selection = isPlainObject(handles) ? handles.selection : undefined;
    const held = hostMethod(selection, 'getSnapshot')?.();
    if (requireTableCells && (!isPlainObject(held) || !held.tableCells)) return null;
    const resolved = hostMethod(selection, 'toSelectionTarget')?.();
    return isPlainObject(resolved) && resolved.kind === 'ok' && resolved.mode === 'range'
      ? capturedTableCellTarget(resolved.target)
      : null;
  }

  function currentUnrepresentableSelectionTarget(selection: SelectionSlice): TextSelectionTarget | null {
    if (selection.empty || selection.selectionTarget || selection.target?.kind !== 'text') return null;
    return heldPaintedTextSelectionTarget();
  }

  function heldPaintedTextSelectionTarget(): TextSelectionTarget | null {
    const target = captureInputSelectionTarget();
    if (target) paintedInlineTargets.add(target);
    return target;
  }

  function resolveInlineCommandTarget(selection: SelectionSlice): SelectionTarget | null {
    const cells = currentCellSelectionTarget();
    if (cells) return cells;
    if (!selection.empty && !selection.selectionTarget && selection.target?.kind === 'text') {
      const snapshot = readHostSelectionSnapshot();
      const painted = currentUnrepresentableSelectionTarget(selection);
      if (painted)
        return snapshot && appliedSelectionPresentation(selection) && readHostSelectionSnapshot() === snapshot
          ? painted
          : null;
    }
    return resolveInlineSelectionTarget(selection);
  }

  function tableCellSelectionForTarget(
    target: unknown,
  ): Readonly<{ anchorBlockId: string; focusBlockId: string }> | null {
    const cellTarget = currentCellSelectionTarget();
    const start = isPlainObject(target) && isPlainObject(target.start) ? target.start : undefined;
    const end = isPlainObject(target) && isPlainObject(target.end) ? target.end : undefined;
    if (
      !cellTarget ||
      start?.blockId !== cellTarget.start.blockId ||
      end?.blockId !== cellTarget.end.blockId ||
      start?.offset !== cellTarget.start.offset ||
      end?.offset !== cellTarget.end.offset
    )
      return null;
    return { anchorBlockId: cellTarget.start.blockId, focusBlockId: cellTarget.end.blockId };
  }

  const callInlineFormatMutation = (
    route: string,
    op: AnyFn,
    input: unknown,
    selection: Pick<SelectionSlice, 'selectionTarget'> | SelectionInfo = state.selection,
    tableCellSelection = tableCellSelectionForTarget((input as LooseRecord)?.target),
  ): unknown => {
    const options = editorMutationOptionsForRoute(route);
    if (options && (options as LooseRecord).success === false) return options;
    if (tableCellSelection)
      return op(input, {
        ...options,
        offsetSpace: 'selection',
        tableCellSelection,
      });
    const paintedTarget = (input as LooseRecord)?.target;
    if (
      paintedTarget !== null &&
      typeof paintedTarget === 'object' &&
      (paintedInlineTargets.has(paintedTarget) || (paintedTarget as LooseRecord).coordinateSpace === 'tracked')
    )
      return op(input, { ...options, offsetSpace: 'selection' });
    if (!(selection as LooseRecord).selectionTarget) return options ? op(input, options) : op(input);
    return op(input, { ...options, offsetSpace: 'kernel' });
  };

  /** Build the `format.paragraph.*` / `styles.paragraph.*` input for a block. */
  const buildBlockParagraphInput = (
    spec: NonNullable<CommandDescriptor['blockParagraph']>,
    blockId: string,
    payload: unknown,
    story?: unknown,
  ): LooseRecord | null => {
    const target = paragraphTarget(blockId, story);
    switch (spec.kind) {
      case 'alignment': {
        const alignment = payload;
        if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right' && alignment !== 'justify') {
          return null;
        }
        return { target, alignment };
      }
      case 'spacing-line': {
        const line = typeof payload === 'number' ? payload : Number(payload);
        if (!Number.isFinite(line) || line <= 0) return null;
        return { target, line, lineRule: 'auto' };
      }
      case 'style': {
        if (payload && typeof payload === 'object') {
          const role = (payload as LooseRecord).role;
          if (role && typeof role === 'object') return { target, role };
        }
        if (typeof payload !== 'string' || payload.trim() === '') return null;
        return { target, styleId: payload };
      }
      case 'direction': {
        const direction = spec.fixedValue;
        if (direction !== 'ltr' && direction !== 'rtl') return null;
        return { target, direction };
      }
      default:
        return null;
    }
  };

  /**
   * Store a caret pick as a pending mark (SD-3654/SD-3652) so the next typed text
   * carries it. Mirrors ProseMirror `storedMarks`: a toggle flips the stored
   * value against the current active state; a value command (color/font/size)
   * stores the value or clears it on a null/empty ("None") payload; a clear
   * command drops all stored marks. The host applies the store to the created
   * span on the next insert; settleCommandExecution drives the recompute.
   */
  const storePendingInlineFormat = (
    descriptor: CommandDescriptor,
    payload: unknown,
    selection = state.selection,
  ): CommandExecutionResult => {
    const spec = descriptor.inline;
    const method = inlineFormatMethod(descriptor);
    const host = getHost();
    if (!spec || typeof host?.setPendingInlineFormat !== 'function') return false;

    if (spec.kind === 'clear') {
      clearPendingInlineFormatOnHost();
      return true;
    }
    if (!method) return false;

    let value: boolean | string | number | null;
    if (spec.kind === 'toggle') {
      value = !commandActiveState(descriptor, getDoc(), selection);
    } else {
      const raw =
        payload && typeof payload === 'object' && 'value' in (payload as LooseRecord)
          ? (payload as LooseRecord).value
          : payload;
      if (spec.kind === 'value-number') {
        const n = typeof raw === 'number' ? raw : Number(raw);
        value = Number.isFinite(n) && n > 0 ? n : null;
      } else {
        value = typeof raw === 'string' && raw.trim() !== '' ? raw : null;
      }
      if (value === null) {
        // A "None" / cleared value command (e.g. color -> None) at a caret stores
        // a pending null so the next typed text is explicitly cleared, rather than
        // inheriting the neighbouring run's value (SD-3654).
        setPendingInlineFormatOnHost(method, null);
        return true;
      }
    }
    setPendingInlineFormatOnHost(method, value);
    return true;
  };

  const acceptUnchangedReset = (result: CommandExecutionResult): CommandExecutionResult =>
    isPlainObject(result) &&
    result.success === false &&
    isPlainObject(result.failure) &&
    result.failure.code === 'NO_OP'
      ? true
      : result;

  const applyClearFormattingCommand = (doc: LooseRecord | null): CommandExecutionResult => {
    const immediateResults: CommandExecutionResult[] = [];
    const settledResults: Array<Promise<CommandExecutionResult>> = [];

    const record = (result: unknown, unchangedResetIsSuccess = false): void => {
      const settled = settleOperationResult(result);
      immediateResults.push(unchangedResetIsSuccess ? acceptUnchangedReset(settled.immediate) : settled.immediate);
      settledResults.push(unchangedResetIsSuccess ? settled.settled.then(acceptUnchangedReset) : settled.settled);
    };

    const run = (op: AnyFn, input: LooseRecord, unchangedResetIsSuccess = false) => {
      try {
        record(op(input), unchangedResetIsSuccess);
      } catch {
        immediateResults.push(false);
        settledResults.push(Promise.resolve(false));
      }
    };

    const defaultStyleId = documentDefaultParagraphStyleId(styleReads.catalog().cache);

    const selectedTarget = resolveInlineCommandTarget(state.selection);
    const rangeTarget =
      selectedTarget?.coordinateSpace === 'tracked' &&
      !currentCellSelectionTarget() &&
      !selectionTouchesDeletedText(state.selection)
        ? (selectionTargetFromTextTarget(state.selection.target) ?? selectedTarget)
        : selectedTarget;
    if (rangeTarget) {
      const inlineOp = resolveDocOperation(doc, 'format.apply');
      // One cross-block-capable format.apply call for the whole selection
      if (inlineOp) {
        try {
          record(
            callInlineFormatMutation('format.apply', inlineOp, {
              target: rangeTarget,
              inline: { ...clearInlinePatchForMode() },
            }),
          );
        } catch {
          immediateResults.push(false);
          settledResults.push(Promise.resolve(false));
        }
      }
    }

    const resetOp = resolveDocOperation(doc, 'format.paragraph.resetDirectFormatting');
    const setStyleRefOp = resolveDocOperation(doc, 'styles.paragraph.setStyleRef');
    const story = selectionStoryLocator(state.selection);
    const isBodyStory = !story || (story as LooseRecord).storyType === 'body';
    const listsRemoveOp = resolveDocOperation(doc, isBodyStory ? 'lists.remove' : 'lists.removeInStory');

    for (const blockId of selectionBlockIds(state.selection)) {
      const target = paragraphTarget(blockId, story);
      if (resetOp) run(resetOp, { target }, true);
      // List removal is best-effort: non-list paragraphs are rejected by the kernel with
      // 'list-not-a-list-item'. Filter failures at the settled level so that both sync
      // and promise-backed (worker) implementations cannot surface as a command failure —
      // for promise-backed ops r.immediate is always `true` regardless of outcome.
      if (listsRemoveOp) {
        try {
          const listTarget = listsBlockTarget(blockId);
          const input = isBodyStory ? { target: listTarget } : { target: listTarget, story };
          const r = settleOperationResult(listsRemoveOp(input));
          settledResults.push(r.settled.then((s) => (commandResultSucceeded(s) ? s : true)));
        } catch {
          /* ignore */
        }
      }
      if (setStyleRefOp) run(setStyleRefOp, { target, styleId: defaultStyleId });
    }

    // Option E: clear paragraph mark run props so future typing at a caret does not
    // inherit old rPr. Skipped in suggesting mode — setMarkRunProps is not tracked-capable.
    // SDRunProps does not accept null, so booleans use `false` (explicit off) and vertAlign
    // uses 'baseline'. Non-boolean props (color, fontFamily, fontSize, letterSpacing) cannot
    // be cleared via this path and remain a known limitation.
    if (!rangeTarget && readDocumentMode() !== 'suggesting') {
      const setMarkRunPropsOp = resolveDocOperation(doc, 'format.paragraph.setMarkRunProps');
      if (setMarkRunPropsOp) {
        for (const blockId of selectionBlockIds(state.selection)) {
          run(setMarkRunPropsOp, {
            target: paragraphTarget(blockId, story),
            markRunProps: {
              bold: false,
              italic: false,
              strikethrough: false,
              doubleStrikethrough: false,
              smallCaps: false,
              caps: false,
              verticalAlign: 'baseline',
            },
          });
        }
      }
    }

    pendingCommandSettlement = settledResults.length
      ? Promise.all(settledResults).then((results) => combineCommandResults(results))
      : null;
    return combineCommandResults(immediateResults.length ? immediateResults : [false]);
  };

  const executeClearFormattingCommand = (): CommandExecutionResult => {
    const doc = getDoc();
    const { lockModesById } = computeSelectionContentControlLockModes(
      doc?.contentControls as LooseRecord | undefined,
      state.selection,
    );
    if (contentControlLockReason(lockModesById)) return false;

    const editor = getEditor();
    const sourceDoc = editor?.doc;
    const reset = resolveDocOperation(doc, 'format.paragraph.resetDirectFormatting');
    const blockIds = selectionBlockIds(state.selection);
    if (editor?.editorVersion !== 2 || !reset || blockIds.length === 0) return applyClearFormattingCommand(doc);
    const sourceToken = contentToken(),
      mode = readDocumentMode(),
      selectionToken = selectionKey(state.selection);
    const story = selectionStoryLocator(state.selection);
    const normalize = (result: unknown) => acceptUnchangedReset(commandResultFromOperationResult(result));
    const checks = blockIds.map((blockId): CommandExecutionResult | Promise<CommandExecutionResult> => {
      try {
        const result: unknown = reset({ target: paragraphTarget(blockId, story) }, { dryRun: true });
        return isPromiseLike(result) ? Promise.resolve(result).then(normalize, () => false) : normalize(result);
      } catch {
        return false;
      }
    });
    const isCurrent = () =>
      !disposed &&
      getEditor() === editor &&
      editor?.doc === sourceDoc &&
      contentToken() === sourceToken &&
      readDocumentMode() === mode &&
      selectionKey(state.selection) === selectionToken;
    if (!checks.some(isPromiseLike)) {
      const result = combineCommandResults(checks.map(commandResultFromOperationResult));
      if (!commandResultSucceeded(result)) return result;
      return isCurrent() ? applyClearFormattingCommand(doc) : false;
    }
    pendingCommandSettlement = Promise.all(checks).then((results) => {
      const result = combineCommandResults(results);
      if (!commandResultSucceeded(result)) return result;
      if (!isCurrent()) return false;
      const previousSettlement = pendingCommandSettlement;
      pendingCommandSettlement = null;
      try {
        const immediate = applyClearFormattingCommand(doc);
        return pendingCommandSettlement ?? immediate;
      } finally {
        pendingCommandSettlement = previousSettlement;
      }
    });
    return true;
  };

  /** Route a block-level paragraph command (`format.paragraph.*` / `styles.paragraph.*`). */

  const executeBlockParagraph = (
    descriptor: CommandDescriptor,
    op: AnyFn,
    payload: unknown,
  ): CommandExecutionResult => {
    const blockIds = selectionBlockIds(state.selection);
    if (blockIds.length === 0) return false;
    const story = selectionStoryLocator(state.selection);
    return applyPerBlock(descriptor.docRoute!, op, blockIds, (blockId) =>
      buildBlockParagraphInput(descriptor.blockParagraph!, blockId, payload, story),
    );
  };

  const executeHybridIndentCommand = (
    descriptor: CommandDescriptor,
    listOp: AnyFn,
    blockIds: readonly string[],
  ): CommandExecutionResult => {
    const doc = getDoc();
    const paragraphSetIndent = resolveDocOperation(doc, 'format.paragraph.setIndentation');
    const paragraphClearIndent = resolveDocOperation(doc, 'format.paragraph.clearIndentation');
    const mode = descriptor.list?.mode;
    const story = selectionStory(state.selection);
    const targetStory = selectionStoryLocator(state.selection);

    type HybridIndentPlan =
      | { kind: 'list'; routeToCall: string; opToCall: AnyFn; input: LooseRecord }
      | { kind: 'paragraph'; routeToCall: string; opToCall: AnyFn; input: LooseRecord };

    // Resolve each selected block's routing family (list item vs paragraph) by
    // awaiting the authoritative Document API reads before dispatching, rather
    // than peeking at the synchronous read cache.
    // Only the first block is warmed by the command-state snapshot, so a sync
    // decision misroutes every later block of a multi-item list selection to a
    // paragraph indent that a list item ignores - the SD-3659 symptom. Awaiting
    // makes routing correct regardless of cache warmth or block count. The
    // command-critical reads use the story-aware host route, which is not held
    // behind the passive `lists.getState` idle delay.
    const planBlock = async (blockId: string): Promise<HybridIndentPlan | null> => {
      const isListItem = await resolveListMembershipForBlockAsync(doc, blockId, story);
      if (isListItem === true) {
        return {
          kind: 'list',
          routeToCall: descriptor.docRoute!,
          opToCall: listOp,
          input: { target: listItemTarget(blockId) },
        };
      }
      // An unavailable/malformed list-state read is not evidence that this is a
      // plain paragraph. Fail this block closed so toolbar indent cannot write a
      // direct paragraph indent onto a list item.
      if (isListItem === null) return null;
      if (targetStory && (targetStory as LooseRecord).storyType !== 'body' && typeof doc?.getNode !== 'function') {
        return null;
      }
      const current = await resolveParagraphIndentationForBlockAsync(doc, blockId, targetStory);
      const preserved: LooseRecord = {};
      if (current?.right != null) preserved.right = current.right;
      if (current?.firstLine != null) preserved.firstLine = current.firstLine;
      if (current?.hanging != null) preserved.hanging = current.hanging;

      if (mode === 'indent') {
        if (!paragraphSetIndent) return null;
        return {
          kind: 'paragraph',
          routeToCall: 'format.paragraph.setIndentation',
          opToCall: paragraphSetIndent,
          input: {
            target: paragraphTarget(blockId, targetStory),
            left: Math.max(0, current?.left ?? 0) + PARAGRAPH_INDENT_STEP_TWIPS,
            ...preserved,
          },
        };
      }
      const nextLeft = Math.max(0, (current?.left ?? 0) - PARAGRAPH_INDENT_STEP_TWIPS);
      if (nextLeft > 0) preserved.left = nextLeft;
      if (Object.keys(preserved).length === 0) {
        if (paragraphClearIndent) {
          return {
            kind: 'paragraph',
            routeToCall: 'format.paragraph.clearIndentation',
            opToCall: paragraphClearIndent,
            input: { target: paragraphTarget(blockId, targetStory) },
          };
        }
        if (paragraphSetIndent) {
          return {
            kind: 'paragraph',
            routeToCall: 'format.paragraph.setIndentation',
            opToCall: paragraphSetIndent,
            input: { target: paragraphTarget(blockId, targetStory), left: 0 },
          };
        }
        return null;
      }
      if (paragraphSetIndent) {
        return {
          kind: 'paragraph',
          routeToCall: 'format.paragraph.setIndentation',
          opToCall: paragraphSetIndent,
          input: { target: paragraphTarget(blockId, targetStory), ...preserved },
        };
      }
      return null;
    };

    pendingCommandSettlement = (async (): Promise<CommandExecutionResult> => {
      const plans = await Promise.all(blockIds.map((blockId) => planBlock(blockId).catch(() => null)));
      const allListItems = plans.length === blockIds.length && plans.every((plan) => plan?.kind === 'list');
      const preserveFirstItemLevel = blockIds.length === 1 && story.storyType === 'body';
      if (allListItems && (readDocumentMode() !== 'suggesting' || preserveFirstItemLevel)) {
        const rangeRoute = mode === 'indent' ? 'lists.indentRange' : 'lists.outdentRange';
        const rangeOp = resolveDocOperation(doc, rangeRoute);
        if (rangeOp) {
          try {
            return await settleOperationResult(
              callEditorMutation(rangeRoute, rangeOp, {
                paraIds: blockIds,
                story,
                ...(preserveFirstItemLevel ? { preserveFirstItemLevel: true } : {}),
              }),
            ).settled;
          } catch {
            return false;
          }
        }
      }
      const nonBodyListPlans = story.storyType !== 'body' && plans.some((plan) => plan?.kind === 'list');
      const outdentInStory =
        nonBodyListPlans && mode === 'outdent' ? resolveDocOperation(doc, 'lists.outdentInStory') : null;
      if (nonBodyListPlans && !outdentInStory) return false;
      const settledResults = plans.map((plan) => {
        if (!plan) return Promise.resolve<CommandExecutionResult>(false);
        try {
          if (plan.kind === 'list' && outdentInStory) {
            return settleOperationResult(
              callEditorMutation('lists.outdentInStory', outdentInStory, { target: plan.input.target, story }),
            ).settled;
          }
          return settleOperationResult(callEditorMutation(plan.routeToCall, plan.opToCall, plan.input)).settled;
        } catch {
          return Promise.resolve<CommandExecutionResult>(false);
        }
      });
      return combineCommandResults(await Promise.all(settledResults));
    })();

    return true;
  };

  /** Route a list command (`lists.apply` / `lists.remove` / list level changes). */
  const executeListCommand = (descriptor: CommandDescriptor, op: AnyFn): CommandExecutionResult => {
    const spec = descriptor.list!;
    const doc = getDoc();
    const blockIds = selectionBlockIds(state.selection);
    if (blockIds.length === 0) return false;
    const story = selectionStory(state.selection);
    const isBodyStory = story.storyType === 'body';
    if (spec.mode === 'indent' || spec.mode === 'outdent') {
      // Indent buttons mirror the legacy toolbar posture: an all-list selection
      // uses one range mutation (with per-item compatibility fallback), while
      // plain paragraphs change direct indentation through `format.paragraph.*`.
      return executeHybridIndentCommand(descriptor, op, blockIds);
    }
    // toggle-seed: when every covered block is already this list kind, remove;
    // otherwise seed only the blocks that are not already that kind.
    const seed = spec.seed!;
    const executeResolved = (
      states: readonly ResolvedListSeed[],
    ): { immediate: CommandExecutionResult; settled: Promise<CommandExecutionResult> | null } => {
      if (states.some((listState) => !listState.resolved)) return { immediate: false, settled: null };
      const shouldRemove = states.every((listState) => listState.seed === seed);
      if (!shouldRemove && !isBodyStory) return { immediate: false, settled: null };

      const route = shouldRemove ? (isBodyStory ? 'lists.remove' : 'lists.removeInStory') : descriptor.docRoute!;
      const operation = shouldRemove ? resolveDocOperation(doc, route) : op;
      if (!operation) return { immediate: false, settled: null };

      const immediateResults: CommandExecutionResult[] = [];
      const settledResults: Array<Promise<CommandExecutionResult>> = [];
      blockIds.forEach((blockId, index) => {
        if (!shouldRemove && states[index]?.seed === seed) return;
        const input = shouldRemove
          ? { target: listsBlockTarget(blockId), ...(!isBodyStory ? { story } : {}) }
          : { target: listsBlockTarget(blockId), seed };
        try {
          const result = settleOperationResult(callEditorMutation(route, operation, input));
          immediateResults.push(result.immediate);
          settledResults.push(result.settled);
        } catch {
          immediateResults.push(false);
          settledResults.push(Promise.resolve(false));
        }
      });
      return {
        immediate: combineCommandResults(immediateResults),
        settled: settledResults.length
          ? Promise.all(settledResults).then((results) => combineCommandResults(results))
          : null,
      };
    };

    const stateReads = blockIds.map((blockId) => resolveListSeedForBlock(doc, blockId, story));
    if (stateReads.some(isPromiseLike)) {
      pendingCommandSettlement = Promise.all(stateReads).then(async (states) => {
        const result = executeResolved(states);
        return result.settled ? await result.settled : result.immediate;
      });
      return true;
    }
    const result = executeResolved(stateReads as ResolvedListSeed[]);
    pendingCommandSettlement = result.settled;
    return result.immediate;
  };

  function readLinkPayloadRecord(payload: unknown): LooseRecord {
    return payload && typeof payload === 'object' ? (payload as LooseRecord) : {};
  }

  function readLinkPayloadHref(payload: unknown): unknown {
    if (typeof payload === 'string') return payload;
    const record = readLinkPayloadRecord(payload);
    if (Object.prototype.hasOwnProperty.call(record, 'href')) return record.href;
    if (Object.prototype.hasOwnProperty.call(record, 'value')) return record.value;
    return undefined;
  }

  function readLinkPayloadText(payload: unknown, href: string): string {
    const record = readLinkPayloadRecord(payload);
    const text = record.text;
    return typeof text === 'string' && text.trim() !== '' ? text : href;
  }

  function readLinkPayloadTarget(payload: unknown): unknown | null {
    const record = readLinkPayloadRecord(payload);
    const capture = record.capture && typeof record.capture === 'object' ? (record.capture as LooseRecord) : null;
    return (
      record.target ??
      capture?.target ??
      capture?.selectionTarget ??
      record.selectionTarget ??
      record.textTarget ??
      null
    );
  }

  /** Route a link command (`hyperlinks.wrap` / `insert` / `patch` / `remove`). */
  const executeLinkCommand = (payload: unknown): unknown => {
    const doc = getDoc();
    const linksApi = doc?.hyperlinks as LooseRecord | undefined;
    if (!linksApi) return false;
    const hyperlinkHandles = hostMethod(getHost(), 'getHandles')?.();
    const hyperlinkEditing = isPlainObject(hyperlinkHandles) ? hyperlinkHandles.editing : undefined;
    const trustedHyperlinks = isPlainObject(hyperlinkEditing) ? hyperlinkEditing.hyperlinks : undefined;
    const trustedLinksApi = firstPartyCommandDoc
      ? isPlainObject(trustedHyperlinks)
        ? trustedHyperlinks
        : undefined
      : linksApi;
    const record = readLinkPayloadRecord(payload);
    const href = readLinkPayloadHref(payload);
    const payloadTarget = readLinkPayloadTarget(payload);
    const text = typeof record.text === 'string' ? record.text : undefined;
    const currentText = typeof record.currentText === 'string' ? record.currentText : undefined;
    const requestedHyperlinkTarget = isPlainObject(record.hyperlinkTarget)
      ? (record.hyperlinkTarget as LooseRecord)
      : null;
    const requestedTextTarget = isPlainObject(record.textTarget) ? (record.textTarget as LooseRecord) : null;
    const hasRequestedHyperlinkTarget =
      typeof requestedHyperlinkTarget?.storyId === 'string' &&
      typeof requestedHyperlinkTarget?.hyperlinkNodeId === 'string';
    const textTargets = textAddressesFromTarget(payloadTarget);
    const caretTarget = collapsedTextAddressFromTarget(payloadTarget);
    if (payloadTarget !== null && !textTargets.length && !caretTarget && !hasRequestedHyperlinkTarget) return false;
    const addresses = textTargets.length ? textTargets : caretTarget ? [caretTarget] : [];
    // An explicit target supplies the command's context as well as its mutation
    // address. Cached live selection must never select a different hyperlink.
    const linkSelection: SelectionSlice =
      payloadTarget !== null
        ? {
            ...EMPTY_SELECTION,
            empty: textTargets.length === 0,
            target: {
              kind: 'text',
              segments: addresses.map((address) => ({ blockId: address.blockId, range: address.range })),
              ...(addresses[0]?.story ? { story: addresses[0].story } : {}),
            } as SelectionSlice['target'],
          }
        : state.selection;
    const executeMutation = (existing: LooseRecord | null): unknown => {
      if (hasRequestedHyperlinkTarget && href === null) {
        const remove = linksApi.remove as AnyFn | undefined;
        if (typeof remove !== 'function') return false;
        try {
          return callEditorMutation('hyperlinks.remove', remove, {
            storyId: requestedHyperlinkTarget.storyId,
            hyperlinkNodeId: requestedHyperlinkTarget.hyperlinkNodeId,
            keepText: true,
          });
        } catch {
          return false;
        }
      }
      // Active link + explicit null href → unwrap.
      if (existing && href === null) {
        const remove = trustedLinksApi?.remove as AnyFn | undefined;
        if (typeof remove !== 'function') return false;
        try {
          return callEditorMutation('hyperlinks.remove', remove, { target: existing.address, mode: 'unwrap' });
        } catch {
          return false;
        }
      }
      // Active link + new href → patch target, optionally replacing display text atomically when requested.
      if ((existing || requestedHyperlinkTarget) && typeof href === 'string' && href.trim() !== '') {
        const patch = trustedLinksApi?.patch as AnyFn | undefined;
        const updateTarget = linksApi.updateTarget as AnyFn | undefined;
        const canPatchExisting = !hasRequestedHyperlinkTarget && existing && typeof patch === 'function';
        const canUpdateRequested = hasRequestedHyperlinkTarget && typeof updateTarget === 'function';
        if (!canPatchExisting && !canUpdateRequested) return false;
        const shouldReplaceText =
          typeof text === 'string' &&
          text !== (hasRequestedHyperlinkTarget ? currentText : (existing?.text ?? currentText));
        const replace = (doc?.text as LooseRecord | undefined)?.replace as AnyFn | undefined;
        const target = shouldReplaceText
          ? hasRequestedHyperlinkTarget
            ? requestedTextTarget
            : hyperlinkAddressToSelectionTarget(existing?.address as LooseRecord | undefined)
          : null;
        const canReplaceText = shouldReplaceText && Boolean(target) && typeof replace === 'function';
        if (shouldReplaceText && !canReplaceText) return false;
        const results: CommandExecutionResult[] = [];
        const settledResults: Array<Promise<CommandExecutionResult>> = [];
        let hyperlinkResult: CommandExecutionResult | null = null;
        let committedHyperlinkResult: Promise<CommandExecutionResult> | null = null;
        let settledHyperlinkResult: Promise<CommandExecutionResult> | null = null;
        let hyperlinkWasDeferred = false;
        try {
          if (hasRequestedHyperlinkTarget) {
            if (typeof updateTarget !== 'function') return false;
            const operationResult = callEditorMutation('hyperlinks.updateTarget', updateTarget, {
              storyId: requestedHyperlinkTarget.storyId,
              hyperlinkNodeId: requestedHyperlinkTarget.hyperlinkNodeId,
              newTarget: hyperlinkTargetFromHref(href),
            });
            hyperlinkWasDeferred = isPromiseLike(operationResult);
            const result = settleOperationResult(operationResult);
            if (!commandResultSucceeded(result.immediate)) return false;
            results.push(result.immediate);
            settledResults.push(result.settled);
            hyperlinkResult = result.immediate;
            committedHyperlinkResult = result.committed;
            settledHyperlinkResult = result.settled;
          } else if (existing) {
            if (typeof patch !== 'function') return false;
            const operationResult = callEditorMutation('hyperlinks.patch', patch, {
              target: existing.address,
              patch: { href },
            });
            hyperlinkWasDeferred = isPromiseLike(operationResult);
            const result = settleOperationResult(operationResult);
            if (!commandResultSucceeded(result.immediate)) return false;
            results.push(result.immediate);
            settledResults.push(result.settled);
            hyperlinkResult = result.immediate;
            committedHyperlinkResult = result.committed;
            settledHyperlinkResult = result.settled;
          }
        } catch {
          return false;
        }
        if (canReplaceText) {
          const combineSettledLinkEdit = (
            finalHyperlinkResult: CommandExecutionResult,
            finalTextResult: CommandExecutionResult,
          ): CommandExecutionResult => {
            if (!commandResultSucceeded(finalTextResult)) {
              return commandResultSucceeded(finalHyperlinkResult)
                ? partialLinkEditFailure(finalHyperlinkResult, finalTextResult)
                : finalTextResult;
            }
            return combineCommandResults([finalHyperlinkResult, finalTextResult]);
          };
          const replaceTextAfterHyperlinkCommit = (
            finalHyperlinkResult: CommandExecutionResult,
          ): Promise<CommandExecutionResult> | CommandExecutionResult => {
            if (!commandResultSucceeded(finalHyperlinkResult)) return finalHyperlinkResult;
            try {
              const result = settleOperationResult(callEditorMutation('text.replace', replace, { target, text }));
              if (!commandResultSucceeded(result.immediate)) {
                return partialLinkEditFailure(finalHyperlinkResult, result.immediate);
              }
              return Promise.all([
                settledHyperlinkResult ?? Promise.resolve(finalHyperlinkResult),
                result.settled,
              ]).then(([settledHyperlink, finalTextResult]) =>
                combineSettledLinkEdit(settledHyperlink, finalTextResult),
              );
            } catch {
              return partialLinkEditFailure(finalHyperlinkResult, false);
            }
          };
          if (hyperlinkWasDeferred) {
            pendingCommandSettlement = (committedHyperlinkResult ?? Promise.resolve(hyperlinkResult ?? false)).then(
              replaceTextAfterHyperlinkCommit,
            );
            return combineCommandResults(results);
          }
          try {
            const result = settleOperationResult(callEditorMutation('text.replace', replace, { target, text }));
            if (!commandResultSucceeded(result.immediate)) {
              return hyperlinkResult ? partialLinkEditFailure(hyperlinkResult, result.immediate) : result.immediate;
            }
            results.push(result.immediate);
            settledResults.push(result.settled);
            pendingCommandSettlement = Promise.all([
              settledHyperlinkResult ?? Promise.resolve(hyperlinkResult ?? false),
              result.settled,
            ]).then(([finalHyperlinkResult, finalTextResult]) => {
              return combineSettledLinkEdit(finalHyperlinkResult, finalTextResult);
            });
          } catch {
            return hyperlinkResult ? partialLinkEditFailure(hyperlinkResult, false) : false;
          }
        }
        if (!canReplaceText && settledResults.length > 0) {
          pendingCommandSettlement = Promise.all(settledResults).then((settled) => combineCommandResults(settled));
        }
        return combineCommandResults(results);
      }
      // No active link + range selection + href → wrap the selected text.
      if (typeof href === 'string' && href.trim() !== '') {
        const normalizedHref = href.trim();
        const wrap = trustedLinksApi?.wrap as AnyFn | undefined;
        const wrapTargets = payloadTarget !== null ? textTargets : selectionTextAddresses(state.selection);
        if (wrapTargets.length > 0) {
          if (typeof wrap !== 'function') return false;
          try {
            return applyPerTextAddress('hyperlinks.wrap', wrap, wrapTargets, (target) => ({
              target,
              link: { destination: { href: normalizedHref } },
            }));
          } catch {
            return false;
          }
        }
        if (requestedTextTarget && !collapsedTextAddressFromTarget(requestedTextTarget)) return false;
        const insert = trustedLinksApi?.insert as AnyFn | undefined;
        const text = readLinkPayloadText(payload, normalizedHref);
        if (typeof insert !== 'function' || text.trim() === '') return false;
        const target = payloadTarget !== null ? caretTarget : collapsedTextAddressFromSelection(state.selection);
        if (!target) return false;
        try {
          return callEditorMutation('hyperlinks.insert', insert, {
            target,
            text,
            link: { destination: { href: normalizedHref } },
          });
        } catch {
          return false;
        }
      }
      return false;
    };
    const executeResolved = (
      existing: LooseRecord | null,
    ): {
      immediate: unknown;
      settled: Promise<CommandExecutionResult> | null;
    } => {
      const previousSettlement = pendingCommandSettlement;
      pendingCommandSettlement = null;
      try {
        const immediate = executeMutation(existing);
        return { immediate, settled: pendingCommandSettlement };
      } finally {
        pendingCommandSettlement = previousSettlement;
      }
    };
    const finish = (existing: LooseRecord | null) => {
      const result = executeResolved(existing);
      pendingCommandSettlement = result.settled;
      return result.immediate;
    };
    if (requestedHyperlinkTarget) return finish(null);
    if (payloadTarget === null) return finish(resolveCurrentHyperlink(doc, linkSelection));
    const blockIds = selectionBlockIds(linkSelection);
    const listLinks = hostMethod(linksApi, 'list');
    if (!canProbeEverySelectedBlock(blockIds) || !listLinks) return false;
    const commandEditor = getEditor(),
      commandDocSource = commandEditor?.doc;
    const commandMode = readDocumentMode(),
      commandContent = contentToken();
    const story = selectionStoryLocator(linkSelection);
    try {
      // A user command reads its explicit target now; passive toolbar read
      // deferral must not turn an unknown hyperlink into a plain-text wrap.
      const reads = blockIds.map((blockId) => listLinks({ within: paragraphTarget(blockId, story) }));
      const validReports = (reports: unknown[]) =>
        reports.every((report) => isPlainObject(report) && Array.isArray(report.items));
      const existingFrom = (reports: unknown[]): LooseRecord | null => {
        for (const report of reports) {
          const items = isPlainObject(report) && Array.isArray(report.items) ? (report.items as LooseRecord[]) : [];
          const hit = items.find((item) => hyperlinkOverlapsSelection(item, linkSelection));
          if (hit) return hit;
        }
        return null;
      };
      if (!reads.some(isPromiseLike)) return validReports(reads) ? finish(existingFrom(reads)) : false;
      return Promise.all(reads).then(
        async (reports) => {
          if (
            disposed ||
            getEditor() !== commandEditor ||
            commandEditor?.doc !== commandDocSource ||
            readDocumentMode() !== commandMode ||
            contentToken() !== commandContent ||
            !validReports(reports)
          )
            return false;
          const result = executeResolved(existingFrom(reports));
          return result.settled ? await result.settled : result.immediate;
        },
        () => false,
      );
    } catch {
      return false;
    }
  };

  /** Route a create command (`create.table` / `create.image` / `create.tableOfContents`). */
  const executeCreateCommand = (descriptor: CommandDescriptor, op: AnyFn, payload: unknown): unknown => {
    const kind = descriptor.create!.kind;
    const record = payload && typeof payload === 'object' ? (payload as LooseRecord) : {};
    if (kind === 'table') {
      const rows = Number(record.rows ?? (record as LooseRecord).rowCount);
      const columns = Number(record.columns ?? record.cols ?? (record as LooseRecord).colCount);
      if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) return false;
      // A caret inserts the table at the text offset (Word parity): the
      // target paragraph splits and the table lands between the head/tail
      // halves. Suggesting mode splits the same way (mirrors the image
      // branch's caret-vs-block split below) — the table's rows are marked
      // as tracked insertions and the split reviews as one `paragraph-split`
      // structural change for 2+ row tables (a 1-row table stays a plain
      // `table-row-insertion` — a pre-existing `detectFullTableRowGroup`
      // limitation, not specific to this path).
      const caret = collapsedTextAddressFromSelection(state.selection);
      const at =
        caret && typeof caret.blockId === 'string'
          ? {
              kind: 'inParagraph',
              target: paragraphTarget(caret.blockId),
              offset: (caret.range as LooseRecord | undefined)?.start ?? 0,
            }
          : createLocationAt(state.selection, 'nodeId');
      try {
        return callEditorMutation(descriptor.docRoute!, op, { rows, columns, at });
      } catch {
        return false;
      }
    }
    if (kind === 'image') {
      const src = record.src ?? record.value;
      if (typeof src !== 'string' || src.trim() === '') return false;
      // A caret inserts INLINE at the text offset (Word parity, and matching
      // the drag-drop/paste path); without a usable text caret the insert
      // falls back to the block-level location (a new paragraph after the
      // current block, or documentEnd).
      const caret = collapsedTextAddressFromSelection(state.selection);
      const story = selectionStory(state.selection);
      const nonBodyStory = story.storyType === 'body' ? null : story;
      let at: LooseRecord;
      if (caret && typeof caret.blockId === 'string') {
        at = {
          kind: 'inParagraph',
          target: paragraphTarget(caret.blockId, nonBodyStory),
          offset: (caret.range as LooseRecord | undefined)?.start ?? 0,
        };
      } else {
        at = createLocationAt(state.selection, 'target');
        if (nonBodyStory && at.kind === 'after') {
          at = { ...at, target: { ...(isPlainObject(at.target) ? at.target : {}), story: nonBodyStory } };
        }
      }
      const input: LooseRecord = { src, at };
      if (nonBodyStory) {
        input.in =
          at.kind === 'inParagraph' ? (resolveActiveHeaderFooterSlot(nonBodyStory) ?? nonBodyStory) : nonBodyStory;
      }
      if (typeof record.alt === 'string') input.alt = record.alt;
      if (typeof record.title === 'string') input.title = record.title;
      if (record.size && typeof record.size === 'object') input.size = record.size;
      const imageHost = getHost();
      const imageHandles = typeof imageHost?.getHandles === 'function' ? imageHost.getHandles() : null;
      const trustedImageCommands = firstPartyCommandDoc
        ? ((imageHandles?.editing as LooseRecord | undefined)?.images as LooseRecord | undefined)
        : null;
      const create = firstPartyCommandDoc ? trustedImageCommands?.create : op;
      if (typeof create !== 'function') return false;
      try {
        return callEditorMutation(descriptor.docRoute!, create as AnyFn, input);
      } catch {
        return false;
      }
    }
    // toc
    const input: LooseRecord = { at: createLocationAt(state.selection, 'target') };
    if (typeof record.instruction === 'string') input.instruction = record.instruction;
    if (record.config && typeof record.config === 'object') input.config = record.config;
    try {
      return callEditorMutation(descriptor.docRoute!, op, input);
    } catch {
      return false;
    }
  };

  /**
   * Header/footer field commands owned by the host. They insert in the same
   * lane as typing and leave the caret after the new field. A built-in control
   * gets the human-attributed handle; a public call gets the code one.
   */
  const fieldEditingCommands = (): LooseRecord | null => {
    if (firstPartyCommandDoc === null) return null;
    const host = getHost();
    if (!host) return null;
    if (firstPartyCommandDoc !== undefined) {
      const handles = hostMethod(host, 'getHandles')?.();
      const editing = isPlainObject(handles) ? handles.editing : undefined;
      const commands = isPlainObject(editing) ? editing.fields : undefined;
      return isPlainObject(commands) ? commands : null;
    }
    const commands = hostMethod(host, 'getCodeFieldEditingCommands')?.();
    return isPlainObject(commands) ? commands : null;
  };

  /**
   * Route a header/footer field command (`fields.insert` at the active caret).
   * It never waits for a selection read. The host checks its own caret when the
   * command leaves its queue, so text typed after the command lands after the field.
   */
  const executeFieldCommand = (descriptor: CommandDescriptor): unknown => {
    if (state.selection.status === 'ready' && !isHeaderFooterCaret(state.selection)) return false;
    const options = editorMutationOptionsForRoute(descriptor.docRoute!);
    if (options && options.success === false) return options;
    const input = { instruction: descriptor.field!.instruction };
    try {
      // `getHandles()` throws while the host boots or after it is disposed.
      const fieldCommands = fieldEditingCommands();
      if (typeof fieldCommands?.insertAtSelection !== 'function') return false;
      return options ? fieldCommands.insertAtSelection(input, options) : fieldCommands.insertAtSelection(input);
    } catch {
      return false;
    }
  };

  /**
   * Page numbering owned by the host. It resolves the section under the caret
   * when it runs. A built-in control gets the human-attributed handle; a public
   * call gets the code one.
   */
  const pageNumberCommands = (): LooseRecord | null => {
    if (firstPartyCommandDoc === null) return null;
    const host = getHost();
    if (!host) return null;
    if (firstPartyCommandDoc !== undefined) {
      const handles = hostMethod(host, 'getHandles')?.();
      const editing = isPlainObject(handles) ? handles.editing : undefined;
      const commands = isPlainObject(editing) ? editing.pageNumbers : undefined;
      return isPlainObject(commands) ? commands : null;
    }
    const commands = hostMethod(host, 'getCodePageNumberEditingCommands')?.();
    return isPlainObject(commands) ? commands : null;
  };

  /** Route a page-numbers command (`headerFooters.pageNumbers.set` or `.remove` for the caret's section). */
  const executePageNumbersCommand = (descriptor: CommandDescriptor, input: unknown): unknown => {
    if (!input) return false;
    const options = editorMutationOptionsForRoute(descriptor.docRoute!);
    if (options && options.success === false) return options;
    const method = descriptor.pageNumbers!;
    try {
      // `getHandles()` throws while the host boots or after it is disposed.
      const commands = pageNumberCommands();
      if (typeof commands?.[method] !== 'function') return false;
      const run = commands[method] as (input: unknown, options?: unknown) => unknown;
      return options ? run(input, options) : run(input);
    } catch {
      return false;
    }
  };

  /** The caret section's page numbers for the built-in popover, or null when unknown. */
  const readPageNumbers = async (): Promise<unknown> => {
    try {
      const commands = pageNumberCommands();
      if (typeof commands?.get !== 'function') return null;
      return (await (commands.get as () => unknown)()) ?? null;
    } catch {
      return null;
    }
  };

  const tableInsertionCommands = (): LooseRecord | null => {
    if (firstPartyCommandDoc === null) return null;
    const host = getHost();
    if (!host) return null;
    if (firstPartyCommandDoc !== undefined) {
      const handles = hostMethod(host, 'getHandles')?.();
      const editing = isPlainObject(handles) ? handles.editing : undefined;
      const commands = isPlainObject(editing) ? editing.tables : undefined;
      return isPlainObject(commands) ? commands : null;
    }
    const commands = hostMethod(host, 'getCodeTableEditingCommands')?.();
    return isPlainObject(commands) ? commands : null;
  };

  /**
   * Route a table cell-context command (`tables.*`) against the live table
   * context resolved from the shared facade. Fails closed (`false`) when the
   * caret is not in a table, the context is incomplete, or the action's
   * required cell is missing — never calling the operation with a malformed
   * locator.
   */
  const executeTableCommand = (descriptor: CommandDescriptor, op: AnyFn): unknown => {
    const spec = descriptor.table!;
    const context = resolveTableContext();
    if (!context) return false;
    if (spec.requiresCell && !context.cellNodeId) return false;
    const input = buildTableCommandInput(spec.action, context);
    if (!input) return false;
    try {
      if (spec.action === 'insert-row-before' || spec.action === 'insert-row-after') {
        const tableCommands = tableInsertionCommands();
        if (typeof tableCommands?.insertRow !== 'function') return false;
        const options = editorMutationOptionsForRoute(descriptor.docRoute!);
        if (options && options.success === false) return options;
        return options ? tableCommands.insertRow(input, options) : tableCommands.insertRow(input);
      }
      if (spec.action === 'insert-column-before' || spec.action === 'insert-column-after') {
        const tableCommands = tableInsertionCommands();
        if (typeof tableCommands?.insertColumn !== 'function') return false;
        const options = editorMutationOptionsForRoute(descriptor.docRoute!);
        if (options && options.success === false) return options;
        return options
          ? tableCommands.insertColumn(input, context.rowIndex, options)
          : tableCommands.insertColumn(input, context.rowIndex);
      }
      return callEditorMutation(descriptor.docRoute!, op, input);
    } catch {
      return false;
    }
  };

  const descriptorNeedsFreshSelection = (descriptor: CommandDescriptor | null): boolean => {
    if (!descriptor || descriptor.disposition !== 'routed') return false;
    return Boolean(
      descriptor.inline || descriptor.blockParagraph || descriptor.list || descriptor.link || descriptor.create,
    );
  };

  const linkPayloadHasExplicitTarget = (payload: unknown): boolean => {
    const record = readLinkPayloadRecord(payload);
    return Boolean(
      readLinkPayloadTarget(payload) || isPlainObject(record.hyperlinkTarget) || isPlainObject(record.textTarget),
    );
  };

  const currentWholeTableParagraphOwner = () => {
    const owner = wholeTableParagraphSeed,
      host = getHost();
    if (
      !owner ||
      disposed ||
      owner.lifetime.aborted ||
      owner.host !== host ||
      owner.editor !== getEditor() ||
      owner.editor.doc !== owner.doc ||
      owner.sourceToken !== contentToken() ||
      owner.mode !== readDocumentMode() ||
      safeCall<unknown>(() => hostMethod(host, 'getMountedHandle')?.(), null) !== owner.mount
    )
      return null;
    const tableId = owner.info.tableSelection?.tableId;
    const activeTable = safeCall<unknown>(() => {
      const handles = hostMethod(host, 'getHandles')?.();
      return hostMethod(isPlainObject(handles) ? handles.selection : undefined, 'getWholeTableNodeId')?.();
    }, null);
    if (
      !tableId ||
      activeTable !== tableId ||
      state.selection.tableSelection?.type !== 'table' ||
      state.selection.tableSelection.tableId !== tableId ||
      selectionSignature(state.selection) !== selectionSignature(selectionSliceFromInfo(owner.info, 'ready'))
    )
      return null;
    // This host read is available only at its current applied source/input
    // frontier. A delayed quoted-text read does not invalidate that paragraph scope.
    const applied = appliedSelectionPresentation(state.selection);
    const info = normalizeSelectionInfo(applied?.selection);
    return info && JSON.stringify(info.tableSelection) === JSON.stringify(owner.info.tableSelection)
      ? { owner, info }
      : null;
  };

  const currentWholeTableParagraphSelection = (): boolean => {
    const current = currentWholeTableParagraphOwner();
    if (!current) return false;
    return current.owner.info.selectionTarget
      ? selectionInfoMatchesHost(current.info)
      : current.owner.nativeSelection !== null && readHostSelectionSnapshot() === current.owner.nativeSelection;
  };

  const commandSelectionIsReady = (id: string, descriptor: CommandDescriptor | null, payload: unknown): boolean => {
    if (descriptorNeedsFreshSelection(descriptor) && selectionRequestGate() !== 'open') return false;
    const foreground = foregroundMutationState();
    // A cached painted caret can precede an already captured native range.
    // Resolve through the ordered worker reader before choosing range vs marks.
    if (foreground && (foreground.active > 0 || foreground.pending > 0)) return false;
    if (descriptor?.blockParagraph && currentWholeTableParagraphSelection()) return true;
    if (
      descriptor?.blockParagraph &&
      state.selection.tableSelection?.type === 'table' &&
      !state.selection.selectionTarget
    )
      return false;
    if (state.selection.status !== 'ready') return false;
    const trackCommand = trackDecisionCommand(id);
    if (trackCommand?.scope === 'id') return true;
    if (!descriptor || descriptor.disposition !== 'routed') return true;
    if (descriptor.inline?.kind === 'clear') {
      return selectionBlockIds(state.selection).length > 0 || resolveInlineCommandTarget(state.selection) != null;
    }
    // Inline: a range mutates directly; a collapsed caret in a block stores the
    // pick (mark toggle or font/size) for the next typed text (SD-3654/SD-3652).
    if (descriptor.inline) {
      return resolveInlineCommandTarget(state.selection) != null || canStorePendingInlineFormat(state.selection);
    }
    if (descriptor.blockParagraph || descriptor.list) return selectionBlockIds(state.selection).length > 0;
    if (descriptor.link) {
      return (
        linkPayloadHasExplicitTarget(payload) ||
        selectionTextAddresses(state.selection).length > 0 ||
        collapsedTextAddressFromSelection(state.selection) != null ||
        commandActiveState(descriptor, getDoc(), state.selection)
      );
    }
    return true;
  };

  const commandNeedsFreshSelection = (id: string, payload: unknown): boolean => {
    const trackCommand = trackDecisionCommand(id);
    const descriptor = getCommandDescriptor(id);
    // An explicit change id is a complete target. Only a selection-derived
    // decision has to wait for the selection read to settle.
    if (trackCommand?.scope === 'id' && explicitTrackDecisionTarget(payload)) return false;
    // Link popovers retain their own target after the live selection is gone.
    if (descriptor?.link && linkPayloadHasExplicitTarget(payload)) return false;
    if (trackCommand?.scope !== 'id' && !descriptorNeedsFreshSelection(descriptor)) return false;
    return !commandSelectionIsReady(id, descriptor, payload);
  };

  const executeCommandInternal = (
    id: string,
    payload?: unknown,
    context?: ViewportContext,
    preparedSelection?: SelectionSlice,
  ): CommandExecutionResult => {
    pendingCommandSettlement = null;
    lastCommandSettlement = Promise.resolve(false);
    if (disposed) return false;
    const custom = customCommands.get(id);
    if (custom) {
      try {
        const result = custom.execute(buildCustomCommandContext(payload, context));
        return settleCommandExecution(result);
      } catch {
        return false;
      }
    }
    const listKind = listToggleKind(id);
    if (listKind) {
      if (documentIsReadOnly()) return false;
      const editCommands = getEditCommands();
      const apply = (editCommands?.lists as LooseRecord | undefined)?.apply;
      if (typeof apply === 'function') return executeListToggleCommand(listKind, payload, preparedSelection);
    }
    const trackCommand = trackDecisionCommand(id);
    if (trackCommand) return executeTrackDecisionCommand(trackCommand, payload);
    if (id === 'copy-format') return documentIsReadOnly() ? false : settleCommandExecution(executeCopyFormat());
    const descriptor = getCommandDescriptor(id);
    // Deferred / unsupported / unknown ids fail closed and never mutate.
    if (!descriptor || descriptor.disposition !== 'routed') return false;
    if (inlineFormattingRefused(descriptor, preparedSelection ?? state.selection)) return false;
    const normalized = descriptor.normalizePayload ? descriptor.normalizePayload(payload) : payload;
    // Routed via a public SuperDoc-instance method (zoom, document mode). These
    // are controls, not mutations, so they are not blocked in viewing mode.
    if (descriptor.instanceRoute) {
      if (!getEditor()) return false;
      if (!instanceCommandPayloadIsValid(descriptor, normalized)) return false;
      const method = (superdoc as LooseRecord)?.[descriptor.instanceRoute];
      if (typeof method !== 'function') return false;
      try {
        const arg = descriptor.fixedArg !== undefined ? descriptor.fixedArg : normalized;
        const result = method.call(superdoc, arg);
        return settleCommandExecution(result);
      } catch {
        return false;
      }
    }
    // The clear-formatting command resolves its own sub-operations internally.
    if (descriptor.inline?.kind === 'clear') {
      if (descriptor.mutates && documentIsReadOnly()) return false;
      return settleCommandExecution(executeClearFormattingCommand());
    }
    // Routed via a Document API operation. Mutating commands are read-only guarded.
    const route = descriptor.docRoute;
    if (!route) return false;
    if (descriptor.mutates && documentIsReadOnly()) return false;
    const doc = getDoc();
    const op = resolveDocOperation(doc, route);
    if (!op) return false;
    // Inline-format commands route through `format.*` against the live selection
    // target with an explicit `{ target, value }` input (the public Document API
    // does not default the selection). They fail closed without a range
    // selection or with an invalid payload rather than calling with a missing
    // target.
    if (descriptor.inline) {
      const selection = preparedSelection ?? state.selection;
      // Word parity (SD-3274): mirrors the read-only guard above — fail closed
      // rather than let a style change silently no-op against locked content.
      const { lockModesById } = computeSelectionContentControlLockModes(
        doc?.contentControls as LooseRecord | undefined,
        selection,
      );
      if (contentControlLockReason(lockModesById)) return false;
      const target = resolveInlineCommandTarget(selection);
      // Pending formatting belongs to a resolved collapsed text caret.
      // Missing or unresolved selections must not arm the next insertion.
      if (!target) {
        if (!canStorePendingInlineFormat(selection)) return settleCommandExecution(false);
        return settleCommandExecution(storePendingInlineFormat(descriptor, normalized, selection));
      }
      const active = commandActiveState(descriptor, doc, selection);
      // One `format.*` call regardless of paragraph count: a cross-block
      // selection passes the host's original `selectionTarget` through and the
      // v2 adapter resolves it centrally into one multi-range transaction
      // (SD-3706) — one receipt, one repaint, one undo unit. No per-block
      // fan-out or plan composition exists in the UI.
      const input = buildInlineFormatInput(descriptor.inline, target, normalized, active);
      if (!input) return false;
      // A queued toggle must retain the accepted scope even when the user
      // moves the caret or selects a different cell rectangle before paint.
      const commandSelection = selection;
      const tableCellSelection = tableCellSelectionForTarget(target);
      let releaseScheduledMutation: (() => void) | null = null;
      try {
        const commandEditor = getEditor();
        const commandDocSource = commandEditor?.doc;
        const commandMode = readDocumentMode();
        const mutate = () => {
          if (
            getEditor() !== commandEditor ||
            commandEditor?.doc !== commandDocSource ||
            readDocumentMode() !== commandMode
          )
            return false;
          return callInlineFormatMutation(route, op, input, commandSelection, tableCellSelection);
        };
        const selectionSignature = selectionInlineValueSignature(selection) ?? selectionKey(selection);
        const scheduledMutation =
          descriptor.inline.kind === 'toggle'
            ? scheduleInlineToggleMutation(`${descriptor.id}:${selectionSignature}`, mutate)
            : null;
        releaseScheduledMutation = scheduledMutation?.release ?? null;
        const mutationResult = scheduledMutation ? scheduledMutation.result : mutate();
        const optimisticGeneration = captureOptimisticInlineToggle(descriptor, selection, input, mutationResult);
        const result = decorateInlineCommandResult(descriptor, selection, input, mutationResult);
        const immediate = settleCommandExecution(result, (settled) => {
          settleOptimisticInlineToggle(descriptor, optimisticGeneration, settled);
          releaseScheduledMutation?.();
          releaseScheduledMutation = null;
        });
        if (descriptor.inline.kind === 'toggle') {
          lastInlineToggleCommandSettlement = lastCommandSettlement;
        }
        return immediate;
      } catch {
        releaseScheduledMutation?.();
        return false;
      }
    }
    // Block-level paragraph / list / link / create commands resolve their target
    // and context from the live selection rather than forwarding the raw payload.
    if ((descriptor.blockParagraph || descriptor.list) && hasInactiveTextSelection()) return false;
    if (descriptor.blockParagraph) {
      const result = executeBlockParagraph(descriptor, op, normalized);
      const optimisticAlignmentGeneration =
        descriptor.blockParagraph.kind === 'alignment' && commandResultSucceeded(result)
          ? armOptimisticParagraphAlignment(state.selection, normalized)
          : null;
      return settleCommandExecution(result, (settled) => {
        settleOptimisticParagraphAlignment(optimisticAlignmentGeneration, settled);
      });
    }
    if (descriptor.list) {
      const result = executeListCommand(descriptor, op);
      return settleCommandExecution(result);
    }
    if (descriptor.link) {
      const result = executeLinkCommand(normalized);
      return settleCommandExecution(result);
    }
    if (descriptor.create) {
      const result = executeCreateCommand(descriptor, op, normalized);
      return settleCommandExecution(result);
    }
    if (descriptor.field) {
      // A second click or shortcut while the insertion is still pending is
      // treated as a repeat of the same request, not a request for a second field.
      if (pendingFieldInsertion) return false;
      const immediate = settleCommandExecution(executeFieldCommand(descriptor));
      const settlement = lastCommandSettlement;
      pendingFieldInsertion = settlement;
      void settlement.finally(() => {
        if (pendingFieldInsertion === settlement) pendingFieldInsertion = null;
      });
      return immediate;
    }
    if (descriptor.pageNumbers) {
      // A repeated activation while numbering is still pending is the same
      // request, not a request for a second number.
      if (pendingPageNumbering) return false;
      const immediate = settleCommandExecution(executePageNumbersCommand(descriptor, normalized));
      const settlement = lastCommandSettlement;
      pendingPageNumbering = settlement;
      void settlement.finally(() => {
        if (pendingPageNumbering === settlement) pendingPageNumbering = null;
      });
      return immediate;
    }
    if (descriptor.table) {
      const result = executeTableCommand(descriptor, op);
      return settleCommandExecution(result);
    }
    try {
      return settleCommandExecution(descriptor.mutates ? callEditorMutation(route, op, normalized) : op(normalized));
    } catch {
      return false;
    }
  };

  // ---------------------------------------------------------------------------
  // Format-painter state machine
  // ---------------------------------------------------------------------------

  const runCommand = (
    id: string,
    payload: unknown,
    context: ViewportContext | undefined,
    firstParty: boolean,
    preparedSelection?: SelectionSlice,
  ): CommandExecutionResult => {
    if (commandNeedsFreshSelection(id, payload) && selectionRequestGate() !== 'open') return false;
    const actionId = beginInteraction(superdoc, 'command:started', () => ({
      commandId: id,
      selection: preparedSelection ?? state.selection,
    }));
    let result: CommandExecutionResult;
    const previousCommandDoc = firstPartyCommandDoc;
    firstPartyCommandDoc = firstParty && !customCommands.has(id) ? createFirstPartyCommandDoc() : undefined;
    try {
      result = executeCommandInternal(id, payload, context, preparedSelection);
    } catch (error) {
      recordInteraction(superdoc, 'command:settled', () => ({ actionId, commandId: id, outcome: 'threw' }));
      throw error;
    } finally {
      firstPartyCommandDoc = previousCommandDoc;
    }
    const settled = (value: CommandExecutionResult) =>
      recordInteraction(superdoc, 'command:settled', () => ({
        actionId,
        commandId: id,
        outcome: commandResultSucceeded(value) ? 'succeeded' : 'rejected',
        result: value,
      }));
    // Observe the real settlement without replacing either return value or promise.
    if (result === false) settled(result);
    else {
      try {
        void lastCommandSettlement.then(settled, () => settled(false));
      } catch {
        /* Capture is optional. */
      }
    }
    return result;
  };

  const executeCommand = (id: string, payload?: unknown, context?: ViewportContext): CommandExecutionResult =>
    runCommand(id, payload, context, false);

  const exitFormatPainter = (): void => {
    painterCaptureEpoch += 1;
    painterCommandDoc = null;
    painter = {
      mode: 'idle',
      snapshot: null,
      sourceSelectionKey: null,
      lastClickAt: painter.lastClickAt,
      pointerSelecting: false,
      keyboardSelecting: false,
    };
    for (const cb of painterModeListeners) cb('idle');
    recompute();
  };

  const executeCopyFormat = async (): Promise<boolean> => {
    const commandDoc = firstPartyCommandDoc ?? null;
    const editor = getEditor();
    const doc = editor?.doc;
    const host = editor?.host;
    const mode = readDocumentMode();
    const rawLifetime = safeCall<unknown>(() => hostMethod(host, 'getForegroundInteractionLifetime')?.(), undefined);
    const lifetime = hasAbortedFlag(rawLifetime) ? rawLifetime : undefined;
    const isCurrent = () =>
      !disposed &&
      getEditor() === editor &&
      editor?.doc === doc &&
      editor?.host === host &&
      readDocumentMode() === mode &&
      !lifetime?.aborted;
    // Toolbar state is optimistic, but format-painter capture must snapshot the
    // authoritative source formatting. An async toolbar command may still be
    // preparing its selection before the mutation scheduler becomes active, so
    // wait for both the whole prior toggle command and the scheduler itself.
    const visibleActiveMarksAtClick = ['bold', 'italic', 'underline', 'strikethrough'].filter(
      (id) => state.toolbar.commands[id]?.active === true,
    );
    const inlineToggleSettlement = await lastInlineToggleCommandSettlement;
    await inlineToggleMutationIdle;
    if (!isCurrent()) return false;
    const visibleActiveMarks = commandResultSucceeded(inlineToggleSettlement) ? visibleActiveMarksAtClick : [];
    const DOUBLE_CLICK_MS = 500;
    const now = Date.now();
    if (painter.mode !== 'idle') {
      // Second click within the double-click window while armed → upgrade to persistent.
      if (painter.mode === 'armed' && now - painter.lastClickAt < DOUBLE_CLICK_MS) {
        painter = { ...painter, mode: 'persistent', lastClickAt: now };
        for (const cb of painterModeListeners) cb('persistent');
        recompute();
        return true;
      }
      // Otherwise cancel (re-click cancels any active painter).
      exitFormatPainter();
      return false;
    }
    const persistent = now - painter.lastClickAt < DOUBLE_CLICK_MS;
    const captureEpoch = ++painterCaptureEpoch;
    // Record the click before capture yields. A real browser double-click can
    // dispatch its second click while the first async snapshot is still being
    // collected; leaving this at the prior value makes both executions arm
    // independently instead of upgrading the newest one to persistent mode.
    painter = { ...painter, lastClickAt: now };

    const captureSlice = await readSelectionInfoFresh();
    // Key includes both selection position and content revision so that frozen values
    // from a prior edit (different contentToken) are never used for the current source.
    const sourceKey = `${selectionKey(captureSlice)}:${contentToken()}`;
    const captureProjected = sourceKey && sourceKey === frozenProjectedValuesKey ? frozenProjectedValues : undefined;
    const painterSnapshot = await captureFormatPainter(null, captureSlice, captureProjected, visibleActiveMarks);
    if (!isCurrent()) return false;
    // Only the newest overlapping capture may publish painter state. Without
    // this guard, whichever async click settles last can overwrite a newer
    // persistent capture with stale armed state.
    if (captureEpoch !== painterCaptureEpoch) return true;

    painter = {
      ...painter,
      mode: persistent ? 'persistent' : 'armed',
      snapshot: painterSnapshot,
      sourceSelectionKey: selectionKey(captureSlice),
      lastClickAt: now,
    };
    painterCommandDoc = commandDoc;

    for (const cb of painterModeListeners) cb(painter.mode);
    recompute();
    return true;
  };

  const captureFormatPainter = async (
    selection: SelectionInfo | null,
    captureSlice?: SelectionSlice,
    captureProjected?: ProjectedInlineSelectionValues,
    visibleActiveMarks: readonly string[] = [],
  ): Promise<FormatPainterSnapshot | null> => {
    // Prefer captureSlice.target (frozen at executeCopyFormat call time from
    // state.selection) over the fresh live sel, which may be null or no longer a
    // text selection after the toolbar click shifts focus.
    const selTarget = captureSlice?.target ?? selection?.target;
    if (!selTarget || selTarget.kind !== 'text') return null;
    const segments: readonly TextSegment[] = Array.isArray(selTarget.segments) ? selTarget.segments : [];
    if (segments.length === 0) return null;

    const doc = getDoc();
    if (!doc) return null;
    const sourceStory = selTarget.story;

    const sourceSelection = captureSlice ?? selectionSliceFromInfo(selection, 'ready');
    const effectiveInput = effectiveInlineUniformityInput(sourceSelection);
    const sourceWholeCells = Boolean(effectiveInput?.tableCellSelection);
    const coveredRunProps: Record<string, unknown>[] = [];
    // A terminal zero-width segment locates the selected paragraph mark; its
    // following paragraph contributes neither text nor formatting to the source.
    for (const segment of formatPainterTextSegments(segments)) {
      const nodeResult = (await readBlockNode(paragraphTarget(segment.blockId, sourceStory))) as
        | LooseRecord
        | undefined;
      const node = (nodeResult?.['node'] as LooseRecord | undefined) ?? null;
      if (!node) return null;
      const para = getParagraphLikeData(node);
      const runs = (Array.isArray(para?.['inlines']) ? para!['inlines'] : []) as LooseRecord[];
      coveredRunProps.push(...sliceRunProps(runs, segment.range));
    }
    const mergedRunProps = coveredRunProps.length
      ? intersectRunProps(coveredRunProps[0], ...coveredRunProps.slice(1))
      : {};
    const inlinePatch = sdRunPropsToInlineRunPatch(mergedRunProps);
    const presentKeys = new Set(coveredRunProps.flatMap((props) => Object.keys(sdRunPropsToInlineRunPatch(props))));
    // A mixed value is intentionally omitted. Uniform absence instead permits
    // clearing the corresponding target property when the snapshot is applied.
    const mixedInlineKeys = new Set([...presentKeys].filter((key) => !(key in inlinePatch)));

    // Backfill inline marks that are cascade-resolved by the controller but may
    // be absent from raw run props (style-inherited formatting).
    const MARK_TO_PATCH: Record<string, string> = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strikethrough: 'strike',
    };
    // Prefer captureSlice.activeMarks — same freeze-time snapshot used for target above.
    const activeMarks = new Set([
      ...(captureSlice?.activeMarks ?? (Array.isArray(selection?.activeMarks) ? selection.activeMarks : [])),
      ...visibleActiveMarks,
    ]);
    for (const [markName, patchKey] of Object.entries(MARK_TO_PATCH)) {
      if (activeMarks.has(markName)) inlinePatch[patchKey] = true;
    }

    // Value properties (fontFamily, fontSize, color, highlight) from projected inline
    // values, which are cascade-resolved from the document's text query.
    // Use captureProjected when provided — it was verified by the caller to match
    // the current source selection key, avoiding stale values from an unrelated
    // selection. Fall back to live re-computation when unavailable.
    const projectedInlineValues =
      captureProjected ??
      (await readFormatPainterInlineValues(captureSlice ?? selectionSliceFromInfo(selection, 'ready')));
    if (projectedInlineValues.fontFamily) inlinePatch['fontFamily'] = projectedInlineValues.fontFamily;
    if (projectedInlineValues.color) inlinePatch['color'] = projectedInlineValues.color;
    if (projectedInlineValues.highlight) inlinePatch['highlight'] = projectedInlineValues.highlight;
    if (projectedInlineValues.fontSize) {
      const fontSize = Number.parseFloat(projectedInlineValues.fontSize);
      if (!Number.isNaN(fontSize)) inlinePatch['fontSize'] = fontSize;
    }

    const effective = await readEffectiveInlineUniformityNow(
      effectiveInput
        ? { ...effectiveInput, keys: [...EFFECTIVE_INLINE_UNIFORMITY_KEYS, 'highlight'], includeCaret: true }
        : null,
    );
    for (const [markName, patchKey] of Object.entries(MARK_TO_PATCH)) {
      const entry = effective?.[markName];
      if (!entry) continue;
      if (entry.state === 'uniform' && (entry.value === 'true' || entry.value === 'false')) {
        inlinePatch[patchKey] = entry.value === 'true';
        mixedInlineKeys.delete(patchKey);
      } else {
        delete inlinePatch[patchKey];
        mixedInlineKeys.add(patchKey);
      }
    }

    const fontFamily = effective?.fontFamily;
    if (fontFamily?.state === 'uniform' && typeof fontFamily.value === 'string') {
      inlinePatch.fontFamily = fontFamily.value;
      mixedInlineKeys.delete('fontFamily');
    } else if (fontFamily) {
      delete inlinePatch.fontFamily;
      delete inlinePatch.rFonts;
      mixedInlineKeys.add('fontFamily');
      mixedInlineKeys.add('rFonts');
    }

    // getNode may expose text-only runs. Resolve highlight absence explicitly
    // rather than relying on raw target properties to discover its reset key.
    const highlight = effective?.highlight;
    if (highlight?.state === 'uniform') {
      // Explicit none suppresses inherited highlighting; null would restore it.
      inlinePatch.highlight = highlight.value;
      mixedInlineKeys.delete('highlight');
    } else if (highlight) {
      delete inlinePatch.highlight;
      mixedInlineKeys.add('highlight');
    }

    // Paragraph properties belong to a caret, whole-cell source, or selected paragraph mark.
    // Selecting visible characters alone must not copy paragraph formatting.
    let paragraphSnapshot: FormatPainterParagraphSnapshot | null = null;
    const paragraphSegments = formatPainterParagraphSegments(segments, sourceWholeCells);
    if (paragraphSegments.length > 0) {
      const segment = paragraphSegments[0];
      const nodeResult = (await readBlockNode(paragraphTarget(segment.blockId, sourceStory))) as
        | LooseRecord
        | undefined;
      const node = (nodeResult?.['node'] as LooseRecord | undefined) ?? null;
      if (node && getParagraphLikeData(node)) {
        paragraphSnapshot = await extractParagraphSnapshot(node, segment.blockId, doc, sourceStory);
      }
    }
    if (paragraphSnapshot?.styleId && effectiveInput) {
      const authored = await readEffectiveInlineUniformityNow({
        ...effectiveInput,
        keys: ['fontFamily', 'fontSize'],
        includeCaret: true,
        includeDefaultFloor: false,
      });
      paragraphSnapshot.inheritedFontKeys = (['fontFamily', 'fontSize'] as const).filter(
        (key) => authored?.[key]?.state === 'absent',
      );
    }

    return {
      story: sourceStory ?? null,
      inline: inlinePatch,
      mixedInlineKeys: [...mixedInlineKeys],
      paragraph: paragraphSnapshot,
    };
  };

  const getParagraphLikeData = (node: LooseRecord): LooseRecord | null => {
    if (!node) return null;
    if (node['kind'] === 'paragraph') return (node['paragraph'] as LooseRecord) ?? null;
    if (node['kind'] === 'heading') return (node['heading'] as LooseRecord) ?? null;
    return null;
  };

  const formatPainterTextSegments = (segments: readonly TextSegment[]): readonly TextSegment[] =>
    segments.length > 1 && segments.at(-1)?.range?.start === segments.at(-1)?.range?.end
      ? segments.slice(0, -1)
      : segments;

  const formatPainterParagraphSegments = (
    segments: readonly TextSegment[],
    wholeCells = false,
  ): readonly TextSegment[] => {
    if (wholeCells) return formatPainterTextSegments(segments);
    if (segments.length === 1 && segments[0].range?.start === segments[0].range?.end) return segments;
    // Every segment before the endpoint crosses its paragraph mark. The final
    // segment has no selected paragraph mark, even when all its text is selected.
    return segments.slice(0, -1);
  };

  const sliceRunProps = (runs: LooseRecord[], range: { start: number; end: number }): Record<string, unknown>[] => {
    let offset = 0;
    const covered: Record<string, unknown>[] = [];
    for (const run of runs) {
      const inner = run['run'] as LooseRecord | undefined;
      const text = typeof inner?.['text'] === 'string' ? inner['text'] : '';
      const start = offset;
      const end = offset + text.length;
      offset = end;
      const props = (inner?.['props'] as Record<string, unknown> | undefined) ?? {};
      if (range.start === range.end) {
        if (range.start >= start && range.start <= end) return [{ ...props }];
      } else if (end > range.start && start < range.end) {
        // Plain runs are part of the intersection too; missing props is not a
        // missing run and must not make a mixed source look uniformly formatted.
        covered.push(props);
      }
    }
    return covered;
  };

  const intersectRunProps = (
    base: Record<string, unknown>,
    ...rest: Record<string, unknown>[]
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...base };
    for (const other of rest) {
      for (const key of Object.keys(result)) {
        if (!(key in other)) {
          delete result[key];
          continue;
        }
        const a = result[key];
        const b = other[key];
        if (typeof a !== typeof b || JSON.stringify(a) !== JSON.stringify(b)) {
          delete result[key];
        }
      }
    }
    return result;
  };

  const extractParagraphSnapshot = async (
    node: LooseRecord,
    blockId: string,
    doc: LooseRecord,
    story?: unknown,
  ): Promise<FormatPainterParagraphSnapshot> => {
    const para = getParagraphLikeData(node)!;
    const props = (para['props'] as LooseRecord | undefined) ?? {};
    const styleId = (para['styleRef'] as string | null) ?? null;
    const operations = captureParagraphPaintOperations(props, (operationId) =>
      Boolean(resolveDocOperation(doc, operationId)),
    );
    const markRunProps = (props['markRunProps'] as SDRunProps | undefined) ?? null;

    const rawNumId = (props['numbering'] as LooseRecord | undefined)?.['numId'];
    const numId = typeof rawNumId === 'string' ? parseInt(rawNumId, 10) : typeof rawNumId === 'number' ? rawNumId : NaN;
    const level = (props['numbering'] as LooseRecord | undefined)?.['level'] as number | undefined;
    const numbering = !isNaN(numId) ? { numId, ...(level != null ? { level } : {}) } : null;

    let listStyle: unknown = null;
    const getListState = resolveDocOperation(doc, 'lists.getState');
    if (numbering && getListState) {
      try {
        const listState = await getListState({ target: paragraphTarget(blockId, story) });
        const getListStyle = resolveDocOperation(doc, 'lists.getStyle');
        if (listState && getListStyle) {
          listStyle = (await getListStyle(listState)) ?? null;
        }
      } catch {
        /* no list state — skip */
      }
    }

    return { styleId, operations, markRunProps, numbering, listStyle };
  };

  const maybeApply = async (): Promise<void> => {
    if (painter.mode === 'idle') return;
    if (painter.pointerSelecting || painter.keyboardSelecting) return;

    const doc = getDoc();
    const selectionApi = doc?.selection as LooseRecord | undefined;
    const readSelection = async () => {
      // Capture the held rectangle before an asynchronous selection read can
      // resolve after the user has moved the caret to a different target.
      const cellTarget = currentCellSelectionTarget();
      const tableCellSelection = tableCellSelectionForTarget(cellTarget);
      const rawSelection =
        typeof selectionApi?.['current'] === 'function'
          ? await Promise.resolve((selectionApi['current'] as (opts: unknown) => unknown)({ includeText: true }))
          : readSelectionInfoLive().value;
      const selection = normalizeSelectionInfo(rawSelection);
      let paintedTarget: TextSelectionTarget | null = null;
      if (
        selection &&
        !selection.empty &&
        !selection.selectionTarget &&
        selection.target?.kind === 'text' &&
        !cellTarget
      ) {
        const nativeSelection = readHostSelectionSnapshot();
        paintedTarget = heldPaintedTextSelectionTarget();
        if (
          paintedTarget &&
          (!nativeSelection ||
            !appliedSelectionPresentation(selectionSliceFromInfo(selection, 'ready')) ||
            readHostSelectionSnapshot() !== nativeSelection)
        )
          return { selection: null, cellTarget: null, tableCellSelection: null, paintedTarget: null };
      }
      return { selection, cellTarget, tableCellSelection, paintedTarget };
    };
    const waitForSelectionSettle = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 16));

    // After pointerup/keyup the target selection sometimes "ripens" asynchronously.
    // Poll for a settled non-empty (text) selection first.
    const MAX_SELECTION_ATTEMPTS = 8;
    let selectionRead: Awaited<ReturnType<typeof readSelection>> | null = null;
    let key = '';
    for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await waitForSelectionSettle();
      if ((painter as FormatPainterState).mode === 'idle' || painter.pointerSelecting || painter.keyboardSelecting)
        return;
      selectionRead = await readSelection();
      const sel = selectionRead.selection;
      if (!sel || sel.empty) continue; // wait for text selection to ripen
      key = selectionKey(sel);
      if (key === painter.sourceSelectionKey) continue;
      break;
    }

    // Text selection settled: apply inline + paragraph.
    if (selectionRead?.selection && !selectionRead.selection.empty && key !== painter.sourceSelectionKey) {
      await applyFormatPainter(
        selectionRead.selection,
        selectionRead.cellTarget,
        selectionRead.tableCellSelection,
        selectionRead.paintedTarget,
      );
      return;
    }

    // No text selection. If there is a paragraph snapshot, check for a positioned
    // caret (click) and apply paragraph formatting only.
    if (painter.snapshot?.paragraph) {
      const caretRead = await readSelection();
      const caretSel = caretRead.selection;
      if (!caretSel) return;
      const caretKey = selectionKey(caretSel);
      if (caretKey === painter.sourceSelectionKey) return;
      await applyFormatPainter(caretSel, caretRead.cellTarget, caretRead.tableCellSelection, caretRead.paintedTarget);
    }
  };

  const applyFormatPainter = async (
    selection: SelectionInfo,
    cellTarget: TextSelectionTarget | null,
    tableCellSelection: ReturnType<typeof tableCellSelectionForTarget>,
    paintedTarget: TextSelectionTarget | null,
  ): Promise<void> => {
    const snap = painter.snapshot;
    if (!snap) {
      if (painter.mode === 'armed') exitFormatPainter();
      return;
    }

    const doc = painterCommandDoc ?? getDoc();
    if (!doc) return;
    const ownerEditor = getEditor();
    const ownerDoc = ownerEditor?.doc;
    const ownerMode = readDocumentMode();

    const targetSelection = selectionSliceFromInfo(selection, 'ready');
    const { lockModesById } = computeSelectionContentControlLockModes(
      doc.contentControls as LooseRecord | undefined,
      targetSelection,
    );
    if (contentControlLockReason(lockModesById)) {
      recompute();
      return;
    }

    // TextTarget (segments/blockIds) for paragraph apply; SelectionTarget for inline apply
    const selTarget = selection.target;
    const selectionTarget = cellTarget ?? paintedTarget ?? selection.selectionTarget;

    const selectionIsEmpty = selection.empty === true;

    const segments: readonly TextSegment[] = Array.isArray(selTarget?.segments) ? selTarget.segments : [];
    const targetStory = selTarget?.story;
    const inline = { ...snap.inline };
    const contiguousTextLengths = new Map<string, number>();
    if (!selectionIsEmpty) {
      for (const segment of formatPainterTextSegments(segments)) {
        const result = await readBlockNode(paragraphTarget(segment.blockId, targetStory));
        const node = result?.node as LooseRecord | undefined;
        const para = node ? getParagraphLikeData(node) : null;
        const runs = (Array.isArray(para?.inlines) ? para.inlines : []) as LooseRecord[];
        if (runs.every((run) => typeof (run.run as LooseRecord | undefined)?.text === 'string')) {
          contiguousTextLengths.set(
            segment.blockId,
            runs.reduce((length, run) => length + ((run.run as LooseRecord).text as string).length, 0),
          );
        }
        for (const props of sliceRunProps(runs, segment.range)) {
          for (const key of Object.keys(sdRunPropsToInlineRunPatch(props))) {
            const fontAlias = key === 'rFonts' ? 'fontFamily' : key === 'fontFamily' ? 'rFonts' : null;
            const capturedFontAlias = fontAlias && (fontAlias in inline || snap.mixedInlineKeys.includes(fontAlias));
            if (!(key in inline) && !snap.mixedInlineKeys.includes(key) && !capturedFontAlias) {
              inline[key] = FORMAT_PAINTER_BOOLEAN_KEYS.has(key) ? false : null;
            }
          }
        }
      }
      if (
        disposed ||
        painter.snapshot !== snap ||
        getEditor() !== ownerEditor ||
        ownerEditor?.doc !== ownerDoc ||
        readDocumentMode() !== ownerMode
      )
        return;
    }

    const entries: Array<{ operationId: UiDocRoute; input: LooseRecord; options?: unknown }> = [];
    const options = editorMutationOptionsForRoute('format.apply');
    if (options?.success === false) return;
    const inlineOptions = {
      ...options,
      ...(tableCellSelection || paintedTarget || (selectionTarget as LooseRecord | null)?.coordinateSpace === 'tracked'
        ? { offsetSpace: 'selection' }
        : selection.selectionTarget
          ? { offsetSpace: 'kernel' }
          : {}),
      ...(tableCellSelection ? { tableCellSelection } : {}),
    };
    const add = (operationId: UiDocRoute, input: LooseRecord, entryOptions: unknown = options) => {
      entries.push({ operationId, input, ...(entryOptions ? { options: entryOptions } : {}) });
    };
    if (
      !selectionIsEmpty &&
      Object.keys(inline).length > 0 &&
      selectionTarget &&
      resolveDocOperation(doc, 'format.apply')
    ) {
      const inheritedFontKeys = snap.paragraph?.inheritedFontKeys ?? [];
      const styledBlocks = new Set(
        formatPainterParagraphSegments(segments, Boolean(tableCellSelection)).map((segment) => segment.blockId),
      );
      if (inheritedFontKeys.length > 0 && styledBlocks.size > 0 && !tableCellSelection) {
        const textSegments = formatPainterTextSegments(segments);
        const original = selectionTarget as LooseRecord;
        const start = original.start as LooseRecord | undefined;
        const end = original.end as LooseRecord | undefined;
        const first = segments[0];
        const last = segments.at(-1);
        const canonical =
          original.kind === 'selection' &&
          start?.kind === 'text' &&
          end?.kind === 'text' &&
          start.blockId === first?.blockId &&
          start.offset === first?.range.start &&
          end.blockId === last?.blockId &&
          end.offset === last?.range.end &&
          JSON.stringify(original.story ?? null) === JSON.stringify(targetStory ?? null) &&
          new Set(segments.map((segment) => segment.blockId)).size === segments.length &&
          segments.every(
            (segment, index) =>
              segment.range.start >= 0 &&
              segment.range.end >= segment.range.start &&
              (index === 0 || segment.range.start === 0) &&
              (index === segments.length - 1 || contiguousTextLengths.get(segment.blockId) === segment.range.end),
          );
        if (canonical) {
          const styledInline = { ...inline };
          for (const key of inheritedFontKeys) styledInline[key] = null;
          const partial = textSegments.at(-1);
          if (partial && !styledBlocks.has(partial.blockId)) {
            const marked = textSegments.slice(0, -1);
            const markedEnd = marked.at(-1);
            if (markedEnd)
              add(
                'format.apply',
                {
                  target: { ...original, end: { ...end, blockId: markedEnd.blockId, offset: markedEnd.range.end } },
                  inline: styledInline,
                },
                inlineOptions,
              );
            add(
              'format.apply',
              {
                target: { ...original, start: { ...start, blockId: partial.blockId, offset: partial.range.start } },
                inline,
              },
              inlineOptions,
            );
          } else {
            add('format.apply', { target: selectionTarget, inline: styledInline }, inlineOptions);
          }
        } else {
          for (const segment of textSegments) {
            const segmentInline = { ...inline };
            if (styledBlocks.has(segment.blockId)) for (const key of inheritedFontKeys) segmentInline[key] = null;
            add(
              'format.apply',
              {
                target: {
                  kind: 'selection',
                  ...(targetStory ? { story: targetStory } : {}),
                  start: { kind: 'text', blockId: segment.blockId, offset: segment.range.start },
                  end: { kind: 'text', blockId: segment.blockId, offset: segment.range.end },
                },
                inline: segmentInline,
              },
              { ...options, offsetSpace: 'kernel' },
            );
          }
        }
      } else {
        if (tableCellSelection && styledBlocks.size > 0) for (const key of inheritedFontKeys) inline[key] = null;
        add('format.apply', { target: selectionTarget, inline }, inlineOptions);
      }
    }
    if (snap.paragraph) {
      const capabilities = (await resolveDocOperation(doc, 'capabilities.get')?.()) as
        | DocumentApiCapabilities
        | undefined;
      const batchSupported =
        capabilities?.operations?.['format.paragraph.applyBatch']?.available === true &&
        Boolean(resolveDocOperation(doc, 'format.paragraph.applyBatch'));
      const batchTargets: LooseRecord[] = [];
      const { styleId, operations, markRunProps, numbering, listStyle } = snap.paragraph;
      const batchOperations: ParagraphBatchOperation[] = [
        ...(styleId
          ? [{ operationId: 'styles.paragraph.setStyleRef' as const, input: { styleId } }]
          : [{ operationId: 'styles.paragraph.clearStyle' as const, input: {} }]),
        ...operations,
        ...(markRunProps
          ? [{ operationId: 'format.paragraph.setMarkRunProps' as const, input: { markRunProps } }]
          : []),
      ];
      for (const segment of formatPainterParagraphSegments(segments, Boolean(tableCellSelection))) {
        const blockAddress = paragraphTarget(segment.blockId, targetStory);
        const nodeResult = await readBlockNode(blockAddress);
        const node = nodeResult?.node as LooseRecord | undefined;
        const para = node ? getParagraphLikeData(node) : null;
        if (!para) continue;
        const target = {
          ...blockAddress,
          nodeType: (nodeResult?.address as LooseRecord | undefined)?.nodeType ?? node?.kind ?? 'paragraph',
        };
        if (batchSupported) batchTargets.push(target);
        else {
          if (styleId) add('styles.paragraph.setStyleRef', { target, styleId });
          else if (para.styleRef) add('styles.paragraph.clearStyle', { target });
          for (const operation of operations) add(operation.operationId, { target, ...operation.input });
          if (markRunProps) add('format.paragraph.setMarkRunProps', { target, markRunProps });
        }
        if (numbering) add('format.paragraph.setNumbering', { target, ...numbering });
        if (listStyle && target.nodeType === 'listItem')
          add('lists.applyStyle', {
            target: listItemTarget(segment.blockId, targetStory),
            style: listStyle,
          });
      }
      if (batchSupported) {
        if (batchTargets.length * batchOperations.length > PARAGRAPH_BATCH_MAX_EXPANDED_WRITES) {
          recompute();
          return;
        }
        let payloadBytes = 0;
        for (let index = 0; index < batchTargets.length; index += PARAGRAPH_BATCH_MAX_TARGETS) {
          const input = {
            targets: batchTargets.slice(index, index + PARAGRAPH_BATCH_MAX_TARGETS),
            operations: batchOperations,
          };
          payloadBytes += new TextEncoder().encode(JSON.stringify(input)).length;
          if (payloadBytes > PARAGRAPH_BATCH_MAX_PAYLOAD_BYTES) {
            recompute();
            return;
          }
          add('format.paragraph.applyBatch', input);
        }
      }
    }
    if (
      disposed ||
      painter.snapshot !== snap ||
      getEditor() !== ownerEditor ||
      ownerEditor?.doc !== ownerDoc ||
      readDocumentMode() !== ownerMode ||
      readDocumentMode() === 'viewing'
    )
      return;
    const currentLocks = computeSelectionContentControlLockModes(
      doc.contentControls as LooseRecord | undefined,
      targetSelection,
    );
    if (contentControlLockReason(currentLocks.lockModesById)) return;
    try {
      const execute = resolveDocOperation(doc, 'plan.execute');
      if (entries.length === 1 && entries[0].operationId === 'format.apply') {
        const apply = resolveDocOperation(doc, 'format.apply');
        if (!apply) return;
        const result = await apply(entries[0].input, entries[0].options);
        if (!commandResultSucceeded(commandResultFromOperationResult(result))) {
          recompute();
          return;
        }
      } else if (execute) {
        const result = await execute({ atomic: true, entries });
        if (!result || (result as LooseRecord).failure || (result as LooseRecord).success === false) {
          recompute();
          return;
        }
      } else {
        if (ownerEditor?.editorVersion === 2) return;
        for (const entry of entries) {
          const operation = resolveDocOperation(doc, entry.operationId);
          if (!operation) continue;
          const result = entry.options ? await operation(entry.input, entry.options) : await operation(entry.input);
          if (!commandResultSucceeded(commandResultFromOperationResult(result))) {
            recompute();
            return;
          }
        }
      }
    } catch {
      recompute();
      return;
    }
    if (
      disposed ||
      painter.snapshot !== snap ||
      getEditor() !== ownerEditor ||
      ownerEditor?.doc !== ownerDoc ||
      readDocumentMode() !== ownerMode
    )
      return;

    if (painter.mode === 'armed') exitFormatPainter();
    recompute();
  };

  const runListCommandAsync = (
    id: string,
    kind: 'bullet' | 'ordered',
    payload: unknown,
    context: ViewportContext | undefined,
    firstParty: boolean,
    requireEnabled: boolean,
    invocation: {
      editor: ReturnType<typeof getEditor>;
      doc: ReturnType<typeof getDoc>;
      mode: ReturnType<typeof readDocumentMode>;
      host: LooseRecord | undefined;
    },
  ): Promise<CommandExecutionResult> => {
    const { editor, doc, mode, host } = invocation;
    const lifetime = safeCall<unknown>(() => hostMethod(host, 'getForegroundInteractionLifetime')?.(), undefined);
    const capture = hostMethod(host, 'captureListCommand');
    const captured = safeCall<unknown>(() => capture?.(lifetime), null);
    const admission = isPlainObject(captured) ? captured : undefined;
    const readCaptured = hostMethod(admission, 'read');
    const submit = hostMethod(admission, 'run');
    const release = hostMethod(admission, 'release');
    const sourceResult = hostMethod(admission, 'sourceResult');
    const repeatState = hostMethod(admission, 'repeatState');
    const canRepeat = hostMethod(admission, 'canRepeat');
    if (capture && (!admission || !readCaptured || !submit || !release)) {
      release?.();
      return Promise.resolve(false);
    }
    const releaseAdmission = () => safeCall(() => release?.(), undefined);
    const selectionPromise = (async () => {
      try {
        if (admission) await admission.ready;
        const api = doc?.selection;
        const current = isPlainObject(api) ? api.current : undefined;
        if (typeof current !== 'function') return selectionSliceFromInfo(null, 'pending');
        const input = {
          includeText: false,
          ...(editor?.editorVersion === 2 ? { offsetSpace: 'selection' } : {}),
        };
        const read = () => current.call(api, input);
        const raw = await (readCaptured ? readCaptured(input, read) : read());
        const info = normalizeSelectionInfo(raw);
        return selectionSliceFromInfo(info, info ? 'ready' : 'pending');
      } catch {
        return selectionSliceFromInfo(null, 'pending');
      }
    })();
    const overrides: LooseRecord =
      typeof payload === 'string' ? presetFromToolbarStyleKey(payload) : isPlainObject(payload) ? payload : {};
    const optionsKey =
      safeCall(
        () =>
          JSON.stringify({
            behavior: overrides.behavior ?? 'toggle',
            preset: overrides.preset,
            continuity: overrides.continuity,
          }),
        null,
      ) ?? `invalid:${++nextListRequest}`;
    const earlier = [...pendingListRequests];
    let settleDecision!: () => void;
    const decisionSettled = new Promise<void>((settle) => {
      settleDecision = settle;
    });
    let resolve!: (result: CommandExecutionResult) => void;
    const result = new Promise<CommandExecutionResult>((settle) => {
      resolve = settle;
    });
    let cancelSettlement!: () => void;
    const cancelled = new Promise<false>((settle) => {
      cancelSettlement = () => settle(false);
    });
    let detachRetirement = () => {};
    let cancelledWithSourceResult = false;
    const request: PendingListRequest = {
      editor,
      doc,
      mode,
      kind,
      optionsKey,
      scope: null,
      scopePromise: Promise.resolve(null),
      decisionSettled,
      repeatIntent: {
        acceptsRepeats: true,
        sourceResult: sourceResult
          ? () =>
              Promise.resolve(safeCall(() => sourceResult(), false)).then(commandResultFromOperationResult, () => false)
          : null,
        state: repeatState ? Promise.resolve(safeCall(() => repeatState(), null)).catch(() => null) : null,
      },
      result,
      cancelled: false,
      cancel: (reason) => {
        if (request.cancelled && reason !== 'ui-destroy' && reason !== 'owner-changed') return;
        cancelledWithSourceResult =
          reason !== 'ui-destroy' &&
          !disposed &&
          (sourceResult != null || (getEditor() === editor && getEditor()?.doc === doc && readDocumentMode() !== mode));
        request.cancelled = true;
        detachRetirement();
        releaseAdmission();
        settleDecision();
        cancelSettlement();
        if (!cancelledWithSourceResult) {
          pendingListRequests.delete(request);
          resolve(false);
        } else {
          void (request.repeatIntent.sourceResult?.() ?? Promise.resolve(false)).then((value) => {
            pendingListRequests.delete(request);
            if (!disposed) recompute();
            resolve(disposed || getEditor() !== editor || getEditor()?.doc !== doc ? false : value);
          });
        }
      },
    };
    const lifetimeRecord = isPlainObject(lifetime) ? lifetime : undefined;
    const removeRetirement = hostMethod(lifetimeRecord, 'removeEventListener');
    detachRetirement = () => safeCall(() => removeRetirement?.('abort', request.cancel), undefined);
    safeCall(
      () => hostMethod(lifetimeRecord, 'addEventListener')?.('abort', request.cancel, { once: true }),
      undefined,
    );
    if (lifetimeRecord?.aborted === true) request.cancel();
    request.scopePromise = selectionPromise.then((selection) => {
      request.scope = listSelectionScope(selection);
      if (!disposed && !request.cancelled) recompute();
      return request.scope;
    });
    if (!request.cancelled) pendingListRequests.add(request);
    recompute();
    void selectionPromise
      .then(async (selection) => {
        try {
          if (
            disposed ||
            request.cancelled ||
            getEditor() !== editor ||
            getEditor()?.doc !== doc ||
            readDocumentMode() !== mode
          )
            return false;
          const scope = await request.scopePromise;
          if (!scope) return false;
          for (const previous of earlier.reverse()) {
            if (
              previous.cancelled ||
              previous.editor !== editor ||
              previous.doc !== doc ||
              previous.mode !== mode ||
              (await previous.scopePromise) !== scope
            )
              continue;
            await previous.decisionSettled;
            if (
              disposed ||
              request.cancelled ||
              getEditor() !== editor ||
              getEditor()?.doc !== doc ||
              readDocumentMode() !== mode
            )
              return false;
            if (previous.cancelled) continue;
            let repeat =
              previous.repeatIntent.acceptsRepeats && previous.kind === kind && previous.optionsKey === optionsKey;
            if (repeat && previous.repeatIntent.state) {
              const state = await previous.repeatIntent.state;
              if (state) {
                const verified = canRepeat ? await canRepeat(state) : null;
                if (verified == null) return false;
                repeat = verified === true;
              } else {
                const outcome = previous.repeatIntent.sourceResult ? await previous.repeatIntent.sourceResult() : null;
                if (outcome == null || commandResultSucceeded(outcome)) return false;
                repeat = false;
              }
            }
            if (
              disposed ||
              request.cancelled ||
              getEditor() !== editor ||
              getEditor()?.doc !== doc ||
              readDocumentMode() !== mode
            )
              return false;
            if (previous.cancelled) continue;
            if (repeat && previous.repeatIntent.acceptsRepeats) {
              request.repeatIntent = previous.repeatIntent;
              releaseAdmission();
              return previous.result;
            }
            previous.repeatIntent.acceptsRepeats = false;
            break;
          }
          const execute = (signal?: AbortSignal) => {
            if (
              disposed ||
              request.cancelled ||
              signal?.aborted ||
              getEditor() !== editor ||
              getEditor()?.doc !== doc ||
              readDocumentMode() !== mode
            )
              return false;
            if (requireEnabled) {
              const command = computeCommandState(id, doc, selection, projectSelectionInlineValues(selection));
              if (!command.supported || !command.enabled) return false;
            }
            const capturedApply = hostMethod(admission, 'apply');
            if (capturedApply) capturedListApplications.set(selection, (input) => capturedApply(input, firstParty));
            const dispatch = () => runCommand(id, payload, context, firstParty, selection);
            try {
              if (submit) submit(dispatch);
              else dispatch();
            } finally {
              capturedListApplications.delete(selection);
            }
            const source = listCommandSourceSettlements.get(selection) ?? Promise.resolve(false);
            request.repeatIntent.sourceResult ??= () => source;
            signal?.addEventListener('abort', request.cancel, { once: true });
            return Promise.race([lastCommandSettlement, cancelled]).finally(() =>
              signal?.removeEventListener('abort', request.cancel),
            );
          };
          const runForeground = admission?.ownsHistory === true ? null : hostMethod(host, 'runForegroundInteraction');
          return runForeground ? runForeground(execute, lifetime) : execute();
        } finally {
          settleDecision();
        }
      })
      .then(
        (value) => commandResultFromOperationResult(value),
        () => {
          settleDecision();
          return false;
        },
      )
      .then(async (value) => {
        releaseAdmission();
        if (
          sourceResult &&
          commandResultSucceeded(value) &&
          !commandResultSucceeded(await (request.repeatIntent.sourceResult?.() ?? Promise.resolve(false)))
        )
          value = false;
        if (cancelledWithSourceResult) {
          value = await (request.repeatIntent.sourceResult?.() ?? Promise.resolve(false));
          if (disposed || getEditor() !== editor || getEditor()?.doc !== doc) value = false;
        }
        if (!commandResultSucceeded(value)) request.repeatIntent.acceptsRepeats = false;
        detachRetirement();
        pendingListRequests.delete(request);
        if (!disposed) recompute();
        resolve(value);
      });
    return result;
  };

  const runCommandAsync = (
    id: string,
    payload: unknown,
    context: ViewportContext | undefined,
    firstParty: boolean,
    requireEnabled = false,
  ): Promise<CommandExecutionResult> => {
    const listKind = !customCommands.has(id) ? listToggleKind(id) : null;
    const editor = getEditor();
    const listDoc = listKind ? getDoc() : null;
    const doc = listKind ? listDoc : editor?.doc;
    const mode = readDocumentMode();
    const host = editor?.host as LooseRecord | undefined;
    if (listKind)
      return runListCommandAsync(id, listKind, payload, context, firstParty, requireEnabled, {
        editor,
        doc: listDoc,
        mode,
        host,
      });
    const reader =
      firstParty && getCommandDescriptor(id)?.inline?.kind === 'toggle' && !customCommands.has(id) && host
        ? firstPartyCommandMutations.get(superdoc)?.get(host)?.selectionReader?.capture()
        : null;
    let rawSelection: unknown;
    const needsSelection = !!reader || commandNeedsFreshSelection(id, payload);
    const needsForeground = needsSelection || (id === 'copy-format' && !customCommands.has(id));
    const selectionGeneration = needsSelection ? selectionRequestGeneration() : undefined;
    const selectionConfirmation =
      needsSelection && selectionRequestGate() !== 'open' ? whenSelectionRequestSettled() : null;
    const execute = async () => {
      if (selectionConfirmation && (await selectionConfirmation) !== 'open') return false;
      if (needsSelection && selectionGeneration !== selectionRequestGeneration()) return false;
      // Ordered reads participate in the same admitted task as their mutation.
      const prepared = reader
        ? reader.read().then(
            (raw) => {
              rawSelection = raw;
              const info = reader.isCurrent(raw) ? normalizeSelectionInfo(raw) : null;
              return selectionSliceFromInfo(info, info ? 'ready' : 'pending');
            },
            () => selectionSliceFromInfo(null, 'pending'),
          )
        : needsSelection
          ? readSelectionInfoFresh()
          : null;
      return prepared
        ? prepared.then((selection) => {
            if (
              disposed ||
              getEditor() !== editor ||
              editor?.doc !== doc ||
              readDocumentMode() !== mode ||
              selection.status !== 'ready' ||
              (reader && !reader.isCurrent(rawSelection))
            )
              return false;
            if (requireEnabled) {
              const command = computeCommandState(id, getDoc(), selection, projectSelectionInlineValues(selection));
              if (!command.supported || !command.enabled) return false;
            }
            if (needsSelection && selectionGeneration !== selectionRequestGeneration()) return false;
            const result = runCommand(id, payload, context, firstParty, selection);
            return result === false ? false : lastCommandSettlement;
          })
        : (() => {
            if (requireEnabled) {
              const command = computeCommandState(
                id,
                getDoc(),
                state.selection,
                projectSelectionInlineValues(state.selection),
              );
              if (!command.supported || !command.enabled) return false;
            }
            const result = runCommand(id, payload, context, firstParty);
            return result === false ? false : lastCommandSettlement;
          })();
    };
    const runForeground = hostMethod(host, 'runForegroundInteraction');
    const lifetime = safeCall<unknown>(() => hostMethod(host, 'getForegroundInteractionLifetime')?.(), undefined);
    const settlement =
      needsForeground && runForeground
        ? (Promise.resolve(runForeground(execute, lifetime)) as Promise<CommandExecutionResult>)
        : Promise.resolve(execute());
    if (getCommandDescriptor(id)?.inline?.kind === 'toggle') {
      lastInlineToggleCommandSettlement = settlement;
    }
    return settlement;
  };
  const executeCommandAsync = (
    id: string,
    payload?: unknown,
    context?: ViewportContext,
  ): Promise<CommandExecutionResult> => runCommandAsync(id, payload, context, false);
  const executeFirstPartyCommandAsync = (
    id: string,
    payload?: unknown,
    requireEnabled = false,
  ): Promise<CommandExecutionResult> => runCommandAsync(id, payload, undefined, true, requireEnabled);

  const makeCommandHandle = <Id extends string>(id: Id): CommandHandle<Id> => ({
    id,
    getState: () =>
      state.toolbar.commands[id] ??
      computeCommandState(id, getDoc(), state.selection, projectSelectionInlineValues(state.selection)),
    observe: (listener) => {
      const inner = select(
        (s) =>
          s.toolbar.commands[id] ?? {
            enabled: false,
            active: false,
            supported: false,
            source: 'unsupported' as const,
            reason: SUPERDOC_UI_REASONS.commandUnsupported,
          },
      );
      return inner.subscribe(listener);
    },
    execute: (payload) => executeCommand(id, payload),
    executeAsync: (payload) => executeCommandAsync(id, payload),
  });

  const registerCommand = <TPayload = unknown, TValue = unknown>(
    registration: CustomCommandRegistration<TPayload, TValue>,
  ): CustomCommandRegistrationResult<TPayload, TValue> => {
    customCommands.set(registration.id, registration as CustomCommandRegistration);
    recompute();
    const unregister = () => {
      customCommands.delete(registration.id);
      recompute();
    };
    return Object.assign(unregister, {
      handle: makeCommandHandle(registration.id) as unknown as CustomCommandHandle<TPayload, TValue>,
      unregister,
    });
  };

  // -- handles --------------------------------------------------------------
  const selectionSub = sliceHandle((s) => s.selection);
  const selectionSnap = snapshotHandle(selectionSub);
  /**
   * Resolve the host-owned selection apply helper. Prefer the editable mount
   * (`editing.selectionTargets`); fall back to review-safe `selection.apply`
   * so viewing-mode restore / select still works for comment create (SD-4470).
   * `host.getHandles()` throws a `V2EditorHostError` with a lifecycle `reason`
   * while the host is booting or disposed — that is a readiness condition, not
   * a missing capability, so it maps to `not-ready` instead of being swallowed
   * into `host-capability-unavailable`.
   */
  const getSelectionApplyHelper = (): { helper: Record<string, unknown> } | { reason: SuperDocUIReason } => {
    const readHandles = hostMethod(getHost(), 'getHandles');
    if (!readHandles) {
      return { reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
    }
    let handles: unknown = null;
    try {
      handles = readHandles();
    } catch (error) {
      const lifecycle = (error as { reason?: unknown } | null)?.reason;
      const notReady =
        lifecycle === 'host-not-ready' || lifecycle === 'host-disposed' || lifecycle === 'editing-mount-required';
      return { reason: notReady ? SUPERDOC_UI_REASONS.notReady : SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
    }
    const editing = isPlainObject(handles) ? handles.editing : undefined;
    const editingHelper = isPlainObject(editing) ? editing.selectionTargets : undefined;
    if (isPlainObject(editingHelper) && typeof editingHelper.apply === 'function') {
      return { helper: editingHelper };
    }
    const reviewHelper = isPlainObject(handles) ? handles.selection : undefined;
    if (isPlainObject(reviewHelper) && typeof reviewHelper.apply === 'function') {
      return { helper: reviewHelper };
    }
    return { reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
  };
  const selectionRequestGate = (): 'open' | 'pending' | 'blocked' => {
    const resolved = getSelectionApplyHelper();
    if (!('helper' in resolved)) return 'open';
    const gate = hostMethod(resolved.helper, 'selectionRequestGate');
    const state = safeCall<unknown>(() => gate?.(), 'open');
    return state === 'pending' || state === 'blocked' ? state : 'open';
  };
  const selectionRequestGeneration = (): unknown => {
    const resolved = getSelectionApplyHelper();
    return 'helper' in resolved ? hostMethod(resolved.helper, 'selectionRequestGeneration')?.() : undefined;
  };
  const whenSelectionRequestSettled = async (): Promise<'open' | 'blocked'> => {
    const resolved = getSelectionApplyHelper();
    if (!('helper' in resolved)) return 'open';
    const wait = hostMethod(resolved.helper, 'whenSelectionRequestSettled');
    if (!wait) return 'open';
    try {
      return (await wait()) === 'open' ? 'open' : 'blocked';
    } catch {
      return 'blocked';
    }
  };
  const refreshSelectionAfterRequest = (): void => {
    void whenSelectionRequestSettled().then(recompute);
  };

  /** Live host SelectionTarget from editable or review-safe selection handles. */
  const readHostSelectionTarget = (): SelectionTarget | null => {
    const readHandles = hostMethod(getHost(), 'getHandles');
    if (!readHandles) return null;
    let handles: unknown = null;
    try {
      handles = readHandles();
    } catch {
      return null;
    }
    const editing = isPlainObject(handles) ? handles.editing : undefined;
    const rendered =
      hostMethod(isPlainObject(editing) ? editing.selection : undefined, 'toSelectionTarget')?.() ??
      hostMethod(isPlainObject(handles) ? handles.selection : undefined, 'toSelectionTarget')?.();
    if (!isPlainObject(rendered) || rendered.kind !== 'ok') return null;
    return isPlainObject(rendered.target) ? (rendered.target as SelectionTarget) : null;
  };
  const activateContentControlChrome = (id: string): void => {
    const host = getHost();
    if (typeof host?.getHandles !== 'function') return;
    try {
      const handles = host.getHandles();
      const contentControls = (handles?.editing as LooseRecord | undefined)?.contentControls as LooseRecord | undefined;
      if (typeof contentControls?.activate === 'function') {
        contentControls.activate({ id });
      }
    } catch {
      // Native chrome is best-effort for hosts that predate this capability.
    }
  };
  const selection: SelectionHandle = {
    get: selectionSnap.get,
    getSnapshot: selectionSnap.getSnapshot,
    subscribe: selectionSnap.subscribe,
    observe: selectionSnap.observe,
    current: () => readSelectionInfoLive().value,
    capture: (): SelectionCapture | null => {
      const snapshot = selectionSub.get();
      if (snapshot.empty) return null;
      const cells = currentCellSelectionTarget();
      const painted = cells ? null : currentUnrepresentableSelectionTarget(snapshot);
      const hostSelection = selectionHostSnapshots.get(snapshot);
      if (
        (cells || painted || (hostSelection && !snapshot.selectionTarget)) &&
        (!hostSelection || readHostSelectionSnapshot() !== hostSelection)
      )
        return null;
      if (!snapshot.target && !snapshot.selectionTarget && !cells) return null;
      const capture: SelectionCapture = {
        ...snapshot,
        capturedAt: Date.now(),
        ...(cells ? { _tableCellSelectionTarget: cells } : {}),
        ...(painted ? { _paintedSelectionTarget: painted } : {}),
      };
      // Record the host selection the captured slice was resolved from, not
      // the current one: a pending refresh can leave the slice behind the host.
      if (hostSelection) selectionHostSnapshots.set(capture, hostSelection);
      return capture;
    },
    restore: (capture: SelectionCapture): SelectionRestoreResult => {
      // Best-effort: re-apply the captured selection target onto the live v2
      // selection controller through the product-owned host helper. Failures
      // are reported through the v1/main-parity `{ success }` result (with
      // v2's `{ ok, reason }` detail) instead of thrown, and recompute() runs
      // on every path so the snapshot stays fresh for non-v2 / pre-ready
      // hosts (SD-3607).
      const done = (result: WorkflowActionResult): SelectionRestoreResult => {
        recompute();
        return { ...result, success: result.ok };
      };
      if (!capture || typeof capture !== 'object') {
        return done({ ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved });
      }
      if (!getEditor()) return done({ ok: false, reason: SUPERDOC_UI_REASONS.notReady });
      const hasCellTarget = '_tableCellSelectionTarget' in capture;
      const cellTarget = hasCellTarget
        ? capturedTableCellTarget((capture as CellSelectionCapture)._tableCellSelectionTarget)
        : null;
      if (hasCellTarget && !cellTarget) return done({ ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved });
      const hasPaintedTarget = '_paintedSelectionTarget' in capture;
      const paintedTarget = hasPaintedTarget
        ? capturedTableCellTarget((capture as CellSelectionCapture)._paintedSelectionTarget)
        : null;
      if (hasPaintedTarget && !paintedTarget) return done({ ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved });
      const target = cellTarget ?? paintedTarget ?? selectionTargetForRestore(capture);
      if (!target) return done({ ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved });
      // A tracked-space range whose host selection is still the one it was
      // resolved from is already restored. Rebuilding it from public offsets
      // would drop the dual visible/tracked endpoints the host keeps for a
      // range that touches deleted text. Any host movement fails the identity
      // check and falls through to a normal re-apply.
      const heldHostSelection = selectionHostSnapshots.get(capture);
      if (
        !hasCellTarget &&
        target.coordinateSpace === 'tracked' &&
        selectionRequestGate() === 'open' &&
        heldHostSelection !== undefined &&
        readHostSelectionSnapshot() === heldHostSelection
      ) {
        return done({ ok: true });
      }
      const resolved = getSelectionApplyHelper();
      if (!('helper' in resolved)) return done({ ok: false, reason: resolved.reason });
      try {
        const applied = done(
          normalizeHostSelectionApplyResult(
            hostMethod(resolved.helper, 'apply')?.(
              target,
              ...(cellTarget ? [{ tableCells: true }] : paintedTarget ? [{ offsetSpace: 'selection' }] : []),
            ),
          ),
        );
        if (applied.ok) refreshSelectionAfterRequest();
        return applied;
      } catch {
        return done({ ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable });
      }
    },
    apply: (target: SelectionTarget): WorkflowActionResult => {
      if (!getEditor()) return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      const resolved = getSelectionApplyHelper();
      if (!('helper' in resolved)) return { ok: false, reason: resolved.reason };
      try {
        const apply = hostMethod(resolved.helper, 'requestApply') ?? hostMethod(resolved.helper, 'apply');
        const result = apply?.(target);
        recompute();
        const applied = normalizeHostSelectionApplyResult(result);
        if (applied.ok) refreshSelectionAfterRequest();
        return applied;
      } catch {
        return { ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
      }
    },
    applyAndWait: async (target: SelectionTarget): Promise<WorkflowActionResult> => {
      if (!getEditor()) return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      const resolved = getSelectionApplyHelper();
      if (!('helper' in resolved)) return { ok: false, reason: resolved.reason };
      const apply = hostMethod(resolved.helper, 'applyAndWait');
      if (!apply) return { ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
      try {
        const result = await apply(target);
        recompute();
        return normalizeHostSelectionApplyResult(result);
      } catch {
        return { ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
      }
    },
    placeAroundContentControl: async (input) => {
      if (!getEditor()) return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      const resolved = getSelectionApplyHelper();
      if (!('helper' in resolved)) return { ok: false, reason: resolved.reason };
      const placeAroundContentControl = hostMethod(resolved.helper, 'placeAroundContentControl');
      if (!placeAroundContentControl) {
        return { ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
      }
      try {
        const result = await placeAroundContentControl(input);
        recompute();
        return normalizeHostSelectionApplyResult(result);
      } catch {
        return { ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved };
      }
    },
    getAnchorRect: (input?: { placement?: 'start' | 'end' | 'center' }): ViewportRect | null => {
      // Prefer the v2 painted/edit-geometry selection rect from the host so the
      // anchor matches the painted layout (not the offscreen ProseMirror DOM).
      const getSelectionAnchorRect = hostMethod(getHost(), 'getSelectionAnchorRect');
      if (getSelectionAnchorRect) {
        const fromHost = safeCall<unknown>(() => getSelectionAnchorRect(input), null);
        if (isPlainObject(fromHost) && (Number(fromHost.width) > 0 || Number(fromHost.height) > 0)) {
          return fromHost as unknown as ViewportRect;
        }
        return null;
      }
      // Geometry is host-owned in this public v2 surface. Hosts without the
      // hook fail closed instead of deriving a potentially stale DOM selection.
      return null;
    },
    getRects: (input?: { relativeTo?: HTMLElement }): readonly ViewportRect[] => {
      // Resolve every painted rect covering the live selection through the
      // host target-geometry surface. Fails closed to [] (never fabricates).
      const snapshot = selectionSub.get();
      const target = snapshot.selectionTarget ?? snapshot.target;
      // Explicit targets can retain valid painted geometry while this live
      // selection snapshot still describes the previous range.
      if (snapshot.status !== 'ready' || snapshot.empty || !target) return [];
      const result = viewport.getRect({
        target: target as ViewportGetRectInput['target'],
        relativeTo: input?.relativeTo,
      });
      return result.found ? result.rects : [];
    },
  };

  const commands: CommandsHandle = {
    get ids() {
      return allCommandIds();
    },
    has: (id) => getCommandDescriptor(id) != null || customCommands.has(id),
    get: (id) => makeCommandHandle(id),
    execute: executeCommand,
    executeAsync: executeCommandAsync,
    register: registerCommand,
    getContextMenuItems: (context: ViewportContext): readonly ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      for (const registration of customCommands.values()) {
        const contribution = registration.contextMenu;
        if (!contribution) continue;
        const visible = safeCall<boolean>(contribution.when ? () => contribution.when!(context) : undefined, true);
        if (!visible) continue;
        items.push({
          id: registration.id,
          label: contribution.label,
          group: contribution.group,
          order: contribution.order,
          invoke: () => executeCommand(registration.id, undefined, context),
        });
      }
      return items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label));
    },
  };

  const toolbarSub = sliceHandle((s) => s.toolbar);
  const toolbarSnap = snapshotHandle(toolbarSub);
  const toolbar: ToolbarHandle = {
    get: toolbarSnap.get,
    getSnapshot: () => state.toolbar,
    subscribe: toolbarSnap.subscribe,
    observe: toolbarSnap.observe,
    execute: executeCommand,
    executeAsync: executeCommandAsync,
  };

  /**
   * Scroll a resolved document target into view through the host navigation
   * surface (`host.scrollTargetIntoView`). Shared by comments / tracked changes /
   * content controls and the generic `viewport.scrollIntoView`. Alignment
   * defaults to `block: 'center'` / `behavior: 'smooth'` (matching the generic
   * method and v1) so every scroll path lands consistently; callers may
   * override. Fails closed with a stable reason rather than a no-op recompute;
   * a resolved target that cannot be made visible is `target-not-visible`, not
   * `target-unresolved`.
   */
  const scrollTargetIntoView = async (
    target: unknown,
    options?: {
      block?: ScrollIntoViewInput['block'];
      behavior?: ScrollIntoViewInput['behavior'];
      shouldContinue?: () => boolean;
    },
  ): Promise<WorkflowScrollResult> => {
    if (!getEditor()) return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.notReady };
    if (!target) return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved };
    const host = getHost();
    const scroll = host?.scrollTargetIntoView;
    if (typeof scroll !== 'function') {
      return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
    }
    try {
      const input = {
        target,
        block: options?.block ?? 'center',
        behavior: options?.behavior ?? 'smooth',
      };
      const result = await Promise.resolve(
        options?.shouldContinue ? scroll.call(host, input, options.shouldContinue) : scroll.call(host, input),
      );
      if (result && typeof result === 'object' && (result as LooseRecord).success === false) {
        return {
          success: false,
          ok: false,
          reason: coerceSuperDocUIReason((result as LooseRecord).reason, SUPERDOC_UI_REASONS.targetUnresolved),
        };
      }
      return { success: true, ok: true };
    } catch {
      return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
    }
  };

  let bookmarkNavigationGeneration = 0;
  documentResetHooks.push(() => {
    bookmarkNavigationGeneration += 1;
  });
  const bookmarks: BookmarksHandle = {
    navigateTo: async (input, options) => {
      const generation = ++bookmarkNavigationGeneration;
      const unresolved = (): WorkflowScrollResult => ({
        success: false,
        ok: false,
        reason: SUPERDOC_UI_REASONS.targetUnresolved,
      });
      const address: BookmarkAddress =
        typeof input === 'string' ? { kind: 'entity', entityType: 'bookmark', name: input } : input;
      if (
        !address ||
        address.kind !== 'entity' ||
        address.entityType !== 'bookmark' ||
        typeof address.name !== 'string' ||
        address.name.length === 0 ||
        (address.story !== undefined &&
          (!address.story || address.story.kind !== 'story' || address.story.storyType !== 'body'))
      )
        return unresolved();
      const editor = getEditor();
      if (!editor || disposed) return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      const doc = getDoc();
      const listBookmarks = hostMethod(doc?.bookmarks, 'list');
      const getBookmark = hostMethod(doc?.bookmarks, 'get');
      if (!listBookmarks || !getBookmark) {
        return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      const helper = getSelectionApplyHelper();
      if (!('helper' in helper)) return { success: false, ok: false, reason: helper.reason };
      const host = getHost();
      if (typeof host?.scrollTargetIntoView !== 'function') {
        return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
      }
      const token = localContentToken();
      let active = true;
      const current = (): boolean =>
        active &&
        !disposed &&
        generation === bookmarkNavigationGeneration &&
        getEditor() === editor &&
        getDoc() === doc &&
        getHost() === host &&
        localContentToken() === token;
      const run = async (): Promise<WorkflowScrollResult> => {
        try {
          // bookmarks.get picks the first duplicate; navigation must not silently
          // choose a different occurrence when an imported name is ambiguous.
          const directory = await listBookmarks(address.story ? { in: address.story } : {});
          if (!current()) return unresolved();
          const items: unknown[] = isPlainObject(directory) && Array.isArray(directory.items) ? directory.items : [];
          if (items.filter((item) => isPlainObject(item) && item.name === address.name).length !== 1) {
            return unresolved();
          }
          const info = await getBookmark({ target: address });
          if (!current() || !isPlainObject(info)) return unresolved();
          const range = isPlainObject(info.range) ? info.range : undefined;
          const infoAddress = isPlainObject(info.address) ? info.address : undefined;
          const infoStory: unknown = infoAddress?.story;
          const storyOutsideBody = Boolean(infoStory) && !(isPlainObject(infoStory) && infoStory.storyType === 'body');
          const textPoint = (point: unknown): { blockId: string; offset: number } | null =>
            isPlainObject(point) &&
            typeof point.blockId === 'string' &&
            point.blockId.length > 0 &&
            typeof point.offset === 'number' &&
            Number.isInteger(point.offset) &&
            point.offset >= 0
              ? { blockId: point.blockId, offset: point.offset }
              : null;
          const from = textPoint(range?.from);
          const to = textPoint(range?.to);
          if (
            info.name !== address.name ||
            storyOutsideBody ||
            info.tableColumn ||
            !from ||
            !to ||
            (from.blockId === to.blockId && from.offset > to.offset)
          )
            return unresolved();
          const result = await scrollTargetIntoView(
            { kind: 'text', segments: [{ blockId: from.blockId, range: { start: from.offset, end: from.offset } }] },
            { block: options?.block ?? 'center', behavior: options?.behavior ?? 'instant', shouldContinue: current },
          );
          if (!current()) return unresolved();
          if (!result.ok) return result;
          const applied = selection.apply({
            kind: 'selection',
            start: { kind: 'text', blockId: from.blockId, offset: from.offset },
            end: { kind: 'text', blockId: to.blockId, offset: to.offset },
          });
          return { ...applied, success: applied.ok };
        } catch {
          return unresolved();
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<WorkflowScrollResult>((resolve) => {
        timer = setTimeout(() => {
          active = false;
          resolve(unresolved());
        }, 15_000);
      });
      try {
        return await Promise.race([run(), timeout]);
      } finally {
        active = false;
        clearTimeout(timer);
      }
    },
  };

  /**
   * Derive the browser-shell's `importedId` carrier-lookup alias from a
   * public list row's `wordRevisionIds` / `sourceIds` provenance fields,
   * mirroring `create-v2-tracked-changes-adapter.js`'s own derivation
   * (`wordRevisionIds.insert ?? .delete ?? .format ?? sourceIds.wordIdInsert
   * ?? .wordIdDelete ?? .wordIdOther[0]`). A carrier imported from a legacy
   * Word revision id is painted with THIS id, not the canonical public id —
   * `focusTrackedChange`'s carrier lookup only tries it when explicitly
   * passed as `importedId` on an object input (see `scrollTrackChangeIntoView`).
   */
  const deriveTrackedChangeImportedId = (row: unknown): string | null => {
    if (!row || typeof row !== 'object') return null;
    const record = row as LooseRecord;
    const wordRevisionIds =
      record.wordRevisionIds && typeof record.wordRevisionIds === 'object'
        ? (record.wordRevisionIds as LooseRecord)
        : null;
    const sourceIds =
      record.sourceIds && typeof record.sourceIds === 'object' ? (record.sourceIds as LooseRecord) : null;
    const wordIdOther = Array.isArray(sourceIds?.wordIdOther) ? sourceIds.wordIdOther : undefined;
    const candidate =
      wordRevisionIds?.insert ??
      wordRevisionIds?.delete ??
      wordRevisionIds?.format ??
      sourceIds?.wordIdInsert ??
      sourceIds?.wordIdDelete ??
      wordIdOther?.[0];
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  };

  /**
   * Scroll a tracked-change target into view, falling back to the v2
   * browser-shell's `focusTrackedChange` (the same mechanism the built-in
   * comments/tracked-changes sidebar uses via `CommentDialog.vue`'s
   * `setFocus`) when the shared host geometry path can't resolve the target.
   * The host's `normalizeGeometryTarget` only understands `text`/`replacement`
   * targets (enriched with painted `segments`) and never `structural`/
   * `formatting` targets, so those always fail the primary path and need this
   * fallback.
   *
   * `story`, when present, is threaded into the fallback input as
   * `trackedChangeStory` — a bare id always resolves to the body story in
   * `focusTrackedChange`'s target resolver, which would collapse a non-body
   * (footnote/header/footer) occurrence onto its body counterpart sharing the
   * same raw id. `importedId`, when present, is threaded in too: the carrier
   * lookup (`buildTrackChangeCarrierLookupIds`) tries it as an ADDITIONAL alias
   * alongside the canonical id, for rows whose painted carrier only matches
   * through a legacy-imported Word revision id, not the canonical public id
   * (`create-v2-tracked-changes-adapter.test.js` pins this alias path as
   * necessary for some rows).
   */
  const scrollTrackChangeIntoView = async (
    changeId: string,
    target: unknown,
    story: unknown,
    importedId: string | null,
    options?: {
      block?: ScrollIntoViewInput['block'];
      behavior?: ScrollIntoViewInput['behavior'];
      shouldContinue?: () => boolean;
    },
  ): Promise<WorkflowScrollResult> => {
    const primary = await scrollTargetIntoView(target, options);
    if (primary.ok) return primary;
    const trackedChanges = getV2TrackedChanges();
    const focusTrackedChange = trackedChanges?.focusTrackedChange;
    if (typeof focusTrackedChange !== 'function') return primary;
    const fallbackInput =
      story || importedId
        ? {
            commentId: changeId,
            ...(story ? { trackedChangeStory: story } : {}),
            ...(importedId ? { importedId } : {}),
          }
        : changeId;
    try {
      const fallbackResult = await Promise.resolve(focusTrackedChange.call(trackedChanges, fallbackInput));
      if (fallbackResult && typeof fallbackResult === 'object' && (fallbackResult as LooseRecord).ok === true) {
        return { success: true, ok: true };
      }
    } catch {
      // Fall through to the primary path's failure below.
    }
    return primary;
  };

  /**
   * Resolve a document entity (comment / tracked change) to its anchor target.
   * Prefers the already-loaded list row, falling back to a live `get({ id })`
   * read when the list does not carry the row.
   */
  const resolveEntityTarget = async (
    namespace: 'comments' | 'trackChanges',
    id: string,
    loaded: readonly unknown[],
    request?: { story?: unknown; matchStory?: unknown },
  ): Promise<unknown | null> => {
    const requestedStory = namespace === 'trackChanges' ? request?.story : undefined;
    // Row matching may use a stricter locator than the one stamped onto the
    // target: an explicit body request must select the body row even though
    // body is never threaded into host calls.
    const rowStory = namespace === 'trackChanges' ? (request?.matchStory ?? requestedStory) : undefined;
    // Stamp the requested story onto a story-less resolved target so the host
    // scroll surface resolves the target (and its painted carriers) within the
    // requested story instead of defaulting to body. A target that already
    // carries a story (directly or via its address) is returned unchanged, so
    // body / story-less requests stay byte-for-byte identical.
    const withRequestedStory = (target: unknown): unknown => {
      if (!requestedStory || !target || typeof target !== 'object') return target;
      const record = target as LooseRecord;
      const address = record.address && typeof record.address === 'object' ? (record.address as LooseRecord) : null;
      if (record.story || address?.story) return target;
      return { ...record, story: requestedStory };
    };
    const readTarget = namespace === 'trackChanges' ? readTrackedChangeNavigationTarget : readEntityTarget;
    const loadedRow = loaded.find((row) => entityRowMatchesRequest(row, id, rowStory));
    const loadedRecord = loadedRow && typeof loadedRow === 'object' ? (loadedRow as LooseRecord) : null;
    const moveSide =
      namespace === 'trackChanges' &&
      loadedRecord?.type === 'move' &&
      (loadedRecord.subtype === 'move-to' || loadedRecord.subtype === 'move-from')
        ? loadedRecord.subtype
        : null;
    const trackedChangeLookupId =
      moveSide && typeof loadedRecord?.trackedChangeCanonicalId === 'string'
        ? loadedRecord.trackedChangeCanonicalId
        : id;
    const readResolvedTarget = (row: unknown): unknown | null => {
      if (!moveSide) {
        return namespace === 'trackChanges'
          ? readTrackedChangeNavigationTarget(row, { preferStableBlock: true })
          : readTarget(row);
      }
      const moveTarget = readEntityTarget(row) as LooseRecord | null;
      if (moveTarget?.kind !== 'move') return null;
      const sideTarget = moveSide === 'move-to' ? moveTarget.destination : moveTarget.source;
      return isHostGeometryTarget(sideTarget) ? sideTarget : null;
    };
    const fromList = readTarget(loadedRow);
    // A tracked-change list can settle while a large document is still
    // streaming. Its semantic row stays valid, but a list-only block anchor
    // can reflect the then-mounted carrier instead of the logical change's
    // authoritative start. Synthetic move-side rows can likewise inherit
    // stale streamed geometry and need their side selected from the canonical
    // move. Keep other geometric targets fast and use narrow per-change reads.
    const listTargetIsAuthoritative =
      namespace !== 'trackChanges' || (!moveSide && isHostGeometryTarget(readEntityTarget(loadedRow)));
    if (fromList && listTargetIsAuthoritative) return withRequestedStory(fromList);
    const doc = getDoc();
    const api = doc?.[namespace] as LooseRecord | undefined;
    // `comments.get` takes `{ commentId }`; `trackChanges.get` takes `{ id }`.
    const input =
      namespace === 'comments'
        ? { commentId: id }
        : { id: trackedChangeLookupId, ...(requestedStory ? { story: requestedStory } : {}) };
    const get = api?.get;
    if (typeof get !== 'function') return withRequestedStory(fromList);
    try {
      const info = await Promise.resolve(get.call(api, input));
      return withRequestedStory(readResolvedTarget(info) ?? fromList);
    } catch {
      return withRequestedStory(fromList);
    }
  };

  function patchCommentStatus(commentId: string, status: string): WorkflowReceipt {
    // Both `resolve` and `reopen` route through here, so the policy checks
    // belong on the helper rather than on each caller.
    if (commentMutationsAreReadOnly()) return failedReceipt('Comments are read-only.', 'DOCUMENT_READONLY');
    if (resolveIsForbidden()) {
      return failedReceipt('Resolving comments is disabled.', 'DOCUMENT_READONLY');
    }
    const doc = getDoc();
    const commentsApi = doc?.comments as LooseRecord | undefined;
    const op = commentsApi?.patch;
    if (typeof op !== 'function') return failedReceipt('comments.patch is unavailable.');
    const fallback = failedReceipt('comments.patch failed.');
    return safeCall<WorkflowReceipt>(
      () => settleWorkflowReceipt(op.call(commentsApi, { commentId, status }), fallback, true),
      fallback,
    );
  }

  /**
   * The refusal every comment write shares, or `null` when the policy permits.
   *
   * The resolved read-only flag is policy rather than presentation, so the
   * built-in dialog cannot enforce it alone. A custom comment UI calls
   * `createFromCapture`, `createFromSelection`, `reply`, and `delete` directly,
   * and the Document API underneath carries no policy of its own. Missing one
   * route fails open on exactly the surface the policy exists for.
   *
   * `allowResolve` is deliberately not checked here — it forbids only the
   * resolve/reopen transition, which `patchCommentStatus` owns.
   */
  const commentWriteRefusal = (): WorkflowReceipt | null =>
    commentMutationsAreReadOnly() ? failedReceipt('Comments are read-only.', 'DOCUMENT_READONLY') : null;

  const filterCommentsSnapshot = (items: readonly CommentInfo[], query?: unknown): readonly CommentInfo[] => {
    const record = isPlainObject(query) ? query : null;
    let filtered = Array.from(items);
    if (record?.includeResolved === false) {
      filtered = filtered.filter((item) => item.status !== 'resolved');
    }
    const rawOffset = Number(record?.offset);
    const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const rawLimit = Number(record?.limit);
    const end = Number.isInteger(rawLimit) && rawLimit >= 0 ? offset + rawLimit : undefined;
    return filtered.slice(offset, end);
  };

  const commentsSub = sliceHandle((s) => s.comments);
  const commentsDirectorySub = select((s) => computeCommentsDirectorySnapshot(s.selection, s.comments));
  const commentsSnap = directorySnapshotHandle(commentsSub, commentsDirectorySub, 'comments');
  documentResetHooks.push(() => {
    setExplicitActiveChange(null);
    explicitActiveCommentId = null;
  });
  const comments: CommentsHandle = {
    get: commentsSnap.get,
    getSnapshot: commentsSnap.getSnapshot,
    subscribe: commentsSnap.subscribe,
    observe: commentsSnap.observe,
    list: (query?: unknown): readonly CommentInfo[] => {
      const commentsApi = getDoc()?.comments;
      const readRecords = hostMethod(commentsApi, 'readCommittedItems');
      const records: unknown = readRecords ? safeCall<unknown>(readRecords, undefined) : undefined;
      const committed = Array.isArray(records) ? realComments(records) : null;
      const directory = committed === null ? readCommentsDirectory(true) : null;
      const cached = asyncReads.get('comments')?.value;
      const derivedItems = directory?.value ?? (Array.isArray(cached) ? realComments(cached) : commentsSub.get().items);
      const derived = new Map(derivedItems.map((item) => [readEntityId(item), item]));
      return filterCommentsSnapshot(
        committed?.map((item) => ({ ...derived.get(readEntityId(item)), ...item })) ??
          directory?.value ??
          commentsSub.get().items,
        query,
      );
    },
    getById: (commentId: string): CommentInfo | null => {
      const fromSnapshot = commentsSub.get().items.find((item) => readEntityId(item) === commentId) ?? null;
      if (fromSnapshot) return fromSnapshot;
      const doc = getDoc();
      const getComment = hostMethod(doc?.comments, 'get');
      const result = safeCall<CommentInfo | null>(
        getComment ? () => getComment({ commentId }) as CommentInfo | null : undefined,
        null,
      );
      return isPromiseLike(result) ? null : result;
    },
    createFromCapture: (capture, input): WorkflowReceipt => {
      const refusal = commentWriteRefusal();
      if (refusal) return refusal;
      const doc = getDoc();
      const commentsApi = doc?.comments as LooseRecord | undefined;
      const op = commentsApi?.create;
      if (typeof op !== 'function') return failedReceipt('comments.create is unavailable.');
      // Read the capture inside `safeCall` like every other route on this
      // handle. A hostile or revoked capture (throwing getter, Proxy) must come
      // back as a receipt, not as an exception through a public method that
      // consumers are told never throws.
      const fallback = failedReceipt('comments.create failed.');
      return safeCall<WorkflowReceipt>(() => {
        // A capture with no target at all is the same user-visible mistake as
        // commenting with an empty selection, so it mints the same NO_SELECTION
        // receipt `createFromSelection` does rather than letting the Document
        // API reject it as INVALID_TARGET.
        //
        // A target that IS present but no longer resolves deliberately falls
        // through: the Document API's own receipt names that failure precisely,
        // and re-labelling it here would lose the distinction.
        const target = capture && typeof capture === 'object' ? (capture.target ?? capture.selectionTarget) : null;
        if (target == null) {
          return failedReceipt('A range selection is required to comment.', 'NO_SELECTION');
        }
        return settleWorkflowReceipt(op.call(commentsApi, { target, text: input.text }), fallback);
      }, fallback);
    },
    createFromSelection: (input): WorkflowReceipt => {
      const refusal = commentWriteRefusal();
      if (refusal) return refusal;
      const doc = getDoc();
      const commentsApi = doc?.comments as LooseRecord | undefined;
      const op = commentsApi?.create;
      if (typeof op !== 'function') return failedReceipt('comments.create is unavailable.');
      if (selectionRequestGate() !== 'open') {
        return (async () => {
          const resolved = getSelectionApplyHelper();
          const confirm = 'helper' in resolved ? hostMethod(resolved.helper, 'confirmedSelectionTarget') : null;
          if (!confirm) return failedReceipt('Selection is not confirmed.', 'NO_SELECTION');
          try {
            const selected = await confirm();
            if (
              !isPlainObject(selected) ||
              selected.ok !== true ||
              selected.mode !== 'range' ||
              !isPlainObject(selected.target)
            ) {
              return failedReceipt('Selection is not confirmed.', 'NO_SELECTION');
            }
            return await settleWorkflowReceipt(
              op.call(commentsApi, { target: selected.target, text: input.text }),
              failedReceipt('comments.create failed.'),
            );
          } catch {
            return failedReceipt('Selection is not confirmed.', 'NO_SELECTION');
          }
        })();
      }
      const snapshot = selectionSub.get();
      let target = snapshot.target ?? snapshot.selectionTarget;
      // Viewing-mode programmatic SelectionTarget applies update the host
      // controller before the UI selection slice necessarily refreshes. Prefer
      // the live host range so createFromSelection stays available (SD-4470).
      if (snapshot.empty || !target) {
        const hostTarget = readHostSelectionTarget();
        if (hostTarget) target = hostTarget;
      }
      if (!target) {
        return failedReceipt('A range selection is required to comment.', 'NO_SELECTION');
      }
      const fallback = failedReceipt('comments.create failed.');
      return safeCall<WorkflowReceipt>(
        () => settleWorkflowReceipt(op.call(commentsApi, { target, text: input.text }), fallback),
        fallback,
      );
    },
    reply: (commentId, input): WorkflowReceipt => {
      const refusal = commentWriteRefusal();
      if (refusal) return refusal;
      const doc = getDoc();
      const commentsApi = doc?.comments as LooseRecord | undefined;
      const op = commentsApi?.reply ?? commentsApi?.create;
      if (typeof op !== 'function') return failedReceipt('comments.reply is unavailable.');
      const fallback = failedReceipt('comments.reply failed.');
      return safeCall<WorkflowReceipt>(
        () =>
          settleWorkflowReceipt(
            op === commentsApi?.reply
              ? op.call(commentsApi, { parentCommentId: commentId, text: input.text })
              : op.call(commentsApi, { parentCommentId: commentId, text: input.text }),
            fallback,
          ),
        fallback,
      );
    },
    edit: (commentId, input): WorkflowReceipt => {
      // Shares `commentWriteRefusal` with create/reply/delete, so `readOnly`
      // blocks a body edit too. `resolveIsForbidden` is intentionally not
      // consulted: `allowResolve: false` forbids the resolve/reopen transition
      // only (see `patchCommentStatus`), and an author correcting their own
      // wording is not that transition.
      const refusal = commentWriteRefusal();
      if (refusal) return refusal;
      const doc = getDoc();
      const commentsApi = doc?.comments as LooseRecord | undefined;
      const op = commentsApi?.patch;
      if (typeof op !== 'function') return failedReceipt('comments.patch is unavailable.');
      const fallback = failedReceipt('comments.patch failed.');
      return safeCall<WorkflowReceipt>(
        () => settleWorkflowReceipt(op.call(commentsApi, { commentId, text: input.text }), fallback),
        fallback,
      );
    },
    resolve: (commentId): WorkflowReceipt => patchCommentStatus(commentId, 'resolved'),
    reopen: (commentId): WorkflowReceipt => patchCommentStatus(commentId, 'active'),
    delete: (commentId): WorkflowReceipt => {
      const refusal = commentWriteRefusal();
      if (refusal) return refusal;
      const doc = getDoc();
      const commentsApi = doc?.comments as LooseRecord | undefined;
      const op = commentsApi?.delete ?? commentsApi?.remove;
      if (typeof op !== 'function') return failedReceipt('comments.delete is unavailable.');
      const fallback = failedReceipt('comments.delete failed.');
      return safeCall<WorkflowReceipt>(
        () => settleWorkflowReceipt(op.call(commentsApi, { commentId }), fallback),
        fallback,
      );
    },
    setActive: (commentId): boolean => {
      // `null` clears the explicit focus; clearing is always accepted.
      if (commentId == null) {
        explicitActiveCommentId = null;
        mirrorReviewFocusToHost('comment', null);
        recompute();
        return true;
      }
      // A non-null activation needs a mounted editor to resolve the comment list.
      if (!getEditor()) return false;
      const snapshot = commentsSub.get();
      const directory = asyncReads.get('comments');
      const directoryItems =
        directory?.token === commentsDirectoryToken() && directory.hasSettled && Array.isArray(directory.value)
          ? (directory.value as CommentInfo[])
          : null;
      const items = directoryItems ?? snapshot.items;
      // Gate on the comment list's own readiness, not the combined `status`
      // (which also factors in the live selection read). A selection change
      // can hold the combined status at `pending`/`stale` even though the
      // comment list itself is loaded, which would otherwise block activating
      // an already-loaded comment until the unrelated selection read settles.
      if (!directoryItems && snapshot.listStatus !== 'ready') return false;
      // Resolve a bare id, an `importedId` alias, or a reply's id to the
      // thread-root comment id, matching main's accepted aliases. A request
      // that matches no currently loaded comment under either alias fails
      // closed without touching the explicit focus.
      const resolvedId = resolveActiveCommentId(items, commentId);
      if (!resolvedId) return false;
      // Decide acceptance from this synchronous snapshot (the same items
      // recompute's computeComments will read, since the content token
      // hasn't changed) BEFORE calling recompute. recompute() notifies
      // subscribers synchronously, and a listener can reentrantly call
      // setActive again before this call returns; reading the shared
      // `explicitActiveCommentId` after recompute would then reflect that
      // reentrant call's outcome instead of this request's own acceptance.
      const accepted = items.some((entry) => readEntityId(entry) === resolvedId);
      if (!accepted) return false;
      setExplicitActiveChange(null);
      explicitActiveCommentId = resolvedId;
      mirrorReviewFocusToHost('comment', { id: resolvedId });
      recompute();
      return true;
    },
    scrollTo: async (commentId): Promise<WorkflowScrollResult> => {
      const doc = getDoc();
      if (!doc) {
        return {
          success: false,
          ok: false,
          reason: getEditor() ? SUPERDOC_UI_REASONS.documentApiUnavailable : SUPERDOC_UI_REASONS.notReady,
        };
      }
      const target = await resolveEntityTarget('comments', commentId, commentsSub.get().items);
      if (!target) return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved };
      return scrollTargetIntoView(target);
    },
  };

  const trackChangesSub = sliceHandle((s) => s.trackChanges);
  const navigateTrackChange = (step: 1 | -1, options?: { invalidateQueuedNavigation?: boolean }): string | null => {
    ensureTrackChangesCatalog();
    const directory = readTrackChangesDirectory();
    const allRows = (directory.value ?? trackChangesSub.get().items)
      .map(projectTrackChangesItem)
      .filter((item): item is TrackChangesItem => item != null && readEntityId(item) !== null);
    if (allRows.length === 0) return null;
    const currentId = state.trackChanges.activeId;
    // Locate the CURRENT occurrence story-scoped when the explicit focus carries
    // a story, so an id repeated across stories steps from THIS occurrence
    // rather than the first row sharing the raw id. A stale story (occurrence
    // no longer loaded) falls back to id-only matching, like main.
    const currentStory = explicitActiveChange?.id === currentId ? explicitActiveChange.story : undefined;
    const bodyRows = allRows.filter((row) => readEntityRequestStory(row) == null);
    // Preserve IT-1250's body-navigation contract when a document has body
    // changes and no non-body occurrence is explicitly focused. A story-only
    // document, or a user who clicked a header/footer/note change, navigates the
    // complete feed with each row's story threaded through target resolution.
    const rows = currentStory || bodyRows.length === 0 ? allRows : bodyRows;
    let currentIdx = currentId ? rows.findIndex((row) => entityRowMatchesRequest(row, currentId, currentStory)) : -1;
    if (currentIdx === -1 && currentId && currentStory) {
      currentIdx = rows.findIndex((row) => entityRowMatchesRequest(row, currentId));
    }
    const nextIdx =
      currentIdx === -1 ? (step > 0 ? 0 : rows.length - 1) : (currentIdx + step + rows.length) % rows.length;
    const nextRow = rows[nextIdx];
    const activeId = readEntityId(nextRow) as string;
    // Carry the resolved row's non-body story so the follow-up target / carrier
    // resolution stays scoped to THIS occurrence (matching getAt / setActive).
    const story = readEntityRequestStory(nextRow);
    setExplicitActiveChange(story ? { id: activeId, story } : { id: activeId }, options);
    recompute();
    return activeId;
  };

  const restampVisibleTrackedChangeCarrierAliases = async (publicId: string): Promise<void> => {
    const v2TrackedChanges = getV2TrackedChanges() as LooseRecord | null;
    const listTrackedChanges = v2TrackedChanges?.listTrackedChanges;
    if (typeof listTrackedChanges !== 'function') return;
    try {
      await Promise.resolve(
        (listTrackedChanges as AnyFn).call(v2TrackedChanges, {
          mode: 'visible-window',
          targetIds: [publicId],
          refreshReason: 'ui-track-change-reveal-restamp',
          blocking: true,
        }),
      );
    } catch {
      // Best-effort alias restamp: the host focus mirror below still fails
      // closed if the carrier is not painted/resolvable.
    }
  };

  // Atomically advance `activeId` (via `navigateTrackChange`, preserving the
  // synchronous `next`/`previous` contract) and await viewport navigation to the
  // freshly-active change, scrolling instantly (`behavior: 'auto'`). Navigation
  // calls are serialized so overlapping failures cannot strand an optimistic
  // active id. Each async boundary is also revision-guarded so a newer
  // `setActive` / `next` / `previous` focus update prevents stale scrolls and
  // stale rollbacks.
  let trackChangeNavigationTail: Promise<void> = Promise.resolve();
  const navigateAndScrollNow = (step: 1 | -1): Promise<ScrollIntoViewOutput> => {
    const requestedAtInvalidation = queuedTrackChangeNavigationInvalidation;
    return trackChangeNavigationTail
      .catch(() => undefined)
      .then(() => navigateAndScrollCurrentRequest(step, requestedAtInvalidation));
  };
  const waitForTrackChangeNavigationDirectory = async (requestedAtInvalidation: number): Promise<boolean> => {
    const editor = getEditor(),
      deadline = Date.now() + 15_000;
    if (!editor) return false;
    while (
      !disposed &&
      getEditor() === editor &&
      queuedTrackChangeNavigationInvalidation === requestedAtInvalidation &&
      Date.now() < deadline
    ) {
      if (readTrackChangesDirectory().status === 'ready') return true;
      if (asyncReads.get('trackChanges')?.failedToken === contentToken()) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(16, deadline - Date.now())));
    }
    return false;
  };
  const navigateAndScrollCurrentRequest = async (
    step: 1 | -1,
    requestedAtInvalidation: number,
  ): Promise<ScrollIntoViewOutput> => {
    if (queuedTrackChangeNavigationInvalidation !== requestedAtInvalidation) return { success: false };
    const release = acquireDirectoryLease('trackChanges');
    try {
      if (!(await waitForTrackChangeNavigationDirectory(requestedAtInvalidation))) return { success: false };
      return await navigateAndScrollReadyRequest(step, requestedAtInvalidation);
    } finally {
      release();
    }
  };
  const navigateAndScrollReadyRequest = async (
    step: 1 | -1,
    requestedAtInvalidation: number,
  ): Promise<ScrollIntoViewOutput> => {
    if (queuedTrackChangeNavigationInvalidation !== requestedAtInvalidation) return { success: false };
    const previousFocus = readReviewFocus();
    const activeId = navigateTrackChange(step, { invalidateQueuedNavigation: false });
    if (activeId == null) return { success: false };
    const optimisticActiveChange = explicitActiveChange;
    const optimisticRevision = explicitActiveChangeRevision;
    const isCurrent = (): boolean =>
      queuedTrackChangeNavigationInvalidation === requestedAtInvalidation &&
      explicitActiveChange === optimisticActiveChange &&
      explicitActiveChangeRevision === optimisticRevision;
    const rollback = (): void => {
      if (!isCurrent()) return;
      restoreReviewFocus(previousFocus);
      recompute();
    };
    if (optimisticActiveChange) pendingTrackChangeRevealFocuses.add(optimisticActiveChange);
    try {
      const target = await resolveEntityTarget(
        'trackChanges',
        activeId,
        trackChangesSub.get().items,
        optimisticActiveChange?.story ? { story: optimisticActiveChange.story } : undefined,
      );
      if (!isCurrent()) return { success: false };
      if (!target) {
        rollback();
        return { success: false };
      }
      const activeRow =
        trackChangesSub
          .get()
          .items.find((item) => entityRowMatchesRequest(item, activeId, optimisticActiveChange?.story)) ??
        trackChangesSub.get().items.find((item) => readEntityId(item) === activeId);
      const importedId = deriveTrackedChangeImportedId(activeRow);
      trackedChangeNavigationInFlight += 1;
      try {
        const result = await scrollTrackChangeIntoView(activeId, target, optimisticActiveChange?.story, importedId, {
          behavior: 'auto',
          shouldContinue: isCurrent,
        });
        if (!isCurrent()) return { success: false };
        if (!result.ok && result.reason !== SUPERDOC_UI_REASONS.targetNotVisible) {
          rollback();
        } else {
          if (result.ok) await restampVisibleTrackedChangeCarrierAliases(activeId);
          if (!isCurrent()) return { success: false };
          mirrorTrackedChangeFocusToHost(optimisticActiveChange);
        }
        return { success: result.ok };
      } finally {
        trackedChangeNavigationInFlight = Math.max(0, trackedChangeNavigationInFlight - 1);
        if (trackedChangeNavigationInFlight === 0) {
          if (!isCurrent()) {
            mirrorTrackedChangeFocusToHost(explicitActiveChange);
          } else if (currentHostReviewSource) {
            syncTrackedChangeFocusFromHostReviewTarget(readHostActiveReviewTarget(currentHostReviewSource));
          }
        }
      }
    } finally {
      if (optimisticActiveChange) pendingTrackChangeRevealFocuses.delete(optimisticActiveChange);
    }
  };
  const navigateAndScroll = (step: 1 | -1): Promise<ScrollIntoViewOutput> => {
    const run = navigateAndScrollNow(step);
    trackChangeNavigationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const trackChangesDirectorySub = select((s) => computeTrackChangesDirectorySnapshot(s.selection, s.trackChanges));
  const trackChangesSnap = directorySnapshotHandle(trackChangesSub, trackChangesDirectorySub, 'trackChanges');
  const trackChanges: TrackChangesHandle = {
    // Snapshot reads remain passive. A domain observer is an explicit request
    // for a reactive document inventory, so it holds directory demand until
    // its disposer runs; the generic select() substrate remains page-bounded.
    get: trackChangesSnap.get,
    getSnapshot: trackChangesSnap.getSnapshot,
    subscribe: trackChangesSnap.subscribe,
    observe: trackChangesSnap.observe,
    list: () => {
      ensureTrackChangesCatalog();
      const directory = readTrackChangesDirectory();
      const source = directory.value ?? trackChangesSub.get().items;
      const suppressed = postDecisionTrackChangeIdsForToken(contentToken());
      return source
        .map(projectTrackChangesItem)
        .filter((item): item is TrackChangesItem => item != null)
        .filter((item) => {
          const id = readEntityId(item);
          return !id || !suppressed?.has(id);
        });
    },
    accept: (changeId) => executeTrackDecision('accept', changeId),
    acceptAsync: (changeId) => settleTrackDecision(() => executeTrackDecision('accept', changeId)),
    reject: (changeId) => executeTrackDecision('reject', changeId),
    rejectAsync: (changeId) => settleTrackDecision(() => executeTrackDecision('reject', changeId)),
    acceptAll: () => executeTrackDecisionTarget('accept', { kind: 'all' }, null),
    acceptAllAsync: () => settleTrackDecision(() => executeTrackDecisionTarget('accept', { kind: 'all' }, null)),
    rejectAll: () => executeTrackDecisionTarget('reject', { kind: 'all' }, null),
    rejectAllAsync: () => settleTrackDecision(() => executeTrackDecisionTarget('reject', { kind: 'all' }, null)),
    next: (): string | null => navigateTrackChange(1),
    previous: (): string | null => navigateTrackChange(-1),
    navigateNext: (): Promise<ScrollIntoViewOutput> => navigateAndScroll(1),
    navigatePrevious: (): Promise<ScrollIntoViewOutput> => navigateAndScroll(-1),
    getAt: (input): TrackChangePointHit | null => {
      // Fail closed on malformed input. `entityAt` routes a non-object argument
      // to its number overload (returns an address/null), so without this guard
      // `hits.length` below would throw on e.g. `getAt('x' as any)`.
      if (!input || typeof input !== 'object' || typeof input.x !== 'number' || typeof input.y !== 'number') {
        return null;
      }
      const hits = entityAt(input);
      if (hits.length === 0) return null;
      const items = trackChangesSub.get().items;
      // Story-carrying hits resolve against the current-token validation set.
      // Read once (cached), and only when a hit actually carries a story.
      let allStoryItems: readonly TrackChangesItem[] | null | undefined;
      for (const hit of hits) {
        if (hit.type !== 'trackedChange') continue;
        // Match by id AND painted story so a tracked-change id that repeats
        // across stories (body, footnote, header/footer) resolves to the row
        // under the point. Falls back to id-only when the hit carries no story.
        let candidates: readonly TrackChangesItem[];
        if (hit.story) {
          if (allStoryItems === undefined) allStoryItems = readAllStoryTrackChanges();
          // Fail closed: skip while the all-story read is unsettled (`null`) so
          // getAt returns null rather than fabricating a body-row fallback.
          if (!allStoryItems) continue;
          candidates = allStoryItems;
        } else {
          candidates = items;
        }
        const item = candidates.find((candidate) => entityRowMatchesRequest(candidate, hit.id, hit.story));
        // Surface the story the hit resolved with so a follow-up
        // `setActive({ id, story })` activates THIS occurrence. Body / story-less
        // hits omit it; the returned `item` is unchanged either way.
        if (item) return hit.story ? { id: item.id, item, story: hit.story } : { id: item.id, item };
      }
      return null;
    },
    setActive: (input): boolean => {
      // `null` clears the explicit focus; clearing is always accepted.
      if (input == null) {
        setExplicitActiveChange(null);
        mirrorTrackedChangeFocusToHost(null);
        recompute();
        return true;
      }
      // A non-null activation needs a mounted editor to resolve the change list.
      if (!getEditor()) return false;
      // A `{ id, story }` input pins an exact painted occurrence. A bare
      // canonical id (the common custom-panel case) resolves its story from the
      // public all-story feed before focus is mirrored to the host.
      const requested: ExplicitActiveChange =
        typeof input === 'string' ? { id: input } : { id: input.id, story: input.story };
      if (typeof requested.id !== 'string' || requested.id.length === 0) return false;
      const paintedEntityId = requested.id;
      // Reconcile a source-level alias (e.g. a painted `imported:<w:id>` id, or
      // one Word side id of a replacement) to the public list id before
      // validating, so a consumer can `setActive` whatever id the DOM handed it.
      // Falls back to the raw id (a genuine public id, or one still to validate).
      if (requested.story) {
        const allStoryItems = readAllStoryTrackChanges();
        if (!allStoryItems) return false;
        // Reconcile the alias within the requested story's rows so a `w:id`
        // reused across stories resolves to THIS story's public id, not the
        // first story that happened to expose the same raw id.
        const publicId =
          buildStoryScopedTrackedChangeIdContext(allStoryItems, requested.story).toPublicId(requested.id) ??
          requested.id;
        if (!allStoryItems.some((row) => entityRowMatchesRequest(row, publicId, requested.story))) return false;
        requested.id = publicId;
      } else {
        // A document-wide panel activates rows outside the painted window.
        // Validate against its already-settled directory without starting a
        // new read; pointer-originated aliases still resolve from the bounded
        // window when no directory is available.
        const items = readAllStoryTrackChanges() ?? trackChangesSub.get().items;
        const publicId = buildTrackedChangeIdContext(items).toPublicId(requested.id) ?? requested.id;
        const item = items.find((candidate) => readEntityId(candidate) === publicId);
        if (!item) return false;
        requested.id = publicId;
        requested.story = readEntityRequestStory(item);
      }
      if (paintedEntityId !== requested.id) requested.paintedEntityId = paintedEntityId;
      setExplicitActiveChange(requested);
      mirrorTrackedChangeFocusToHost(requested);
      recompute();
      return true;
    },
    scrollTo: async (input): Promise<WorkflowScrollResult> => {
      const doc = getDoc();
      if (!doc) {
        return {
          success: false,
          ok: false,
          reason: getEditor() ? SUPERDOC_UI_REASONS.documentApiUnavailable : SUPERDOC_UI_REASONS.notReady,
        };
      }
      const changeId = typeof input === 'string' ? input : input.id;
      // A supplied locator, body included, is kept for row matching so an
      // explicit body request cannot land on a same-id footnote or header row
      // that happens to be listed first. Only host calls drop the body story,
      // which is their documented default.
      const matchStory =
        typeof input === 'string' || !input.story || typeof input.story !== 'object' ? undefined : input.story;
      const requestedStory = matchStory ? readEntityRequestStory({ address: { story: matchStory } }) : undefined;
      if (typeof changeId !== 'string' || changeId.length === 0) {
        return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved };
      }
      queuedTrackChangeNavigationInvalidation += 1;
      trackChangeRevealInvalidation += 1;
      const requestedAtInvalidation = trackChangeRevealInvalidation;
      // Scope the request to the row's own (non-body) story so a
      // header/footer/footnote row scrolls to ITS occurrence, matching the
      // story threading in navigateNext / navigatePrevious. A requested story
      // wins; otherwise the story comes from the first matching loaded row.
      // Rows outside the painted window are only in the directory, so a
      // story-scoped request also consults it.
      const loadedItems = matchStory
        ? (readAllStoryTrackChanges() ?? trackChangesSub.get().items)
        : trackChangesSub.get().items;
      // Custom review panels commonly retain the nested change/source id
      // (`item.change.id`) instead of the canonical row id (`item.id`). Keep
      // the raw id as the painter alias, but use the canonical id for target
      // resolution and explicit focus so recompute does not discard the
      // pending reveal as an unknown change.
      const publicId = matchStory
        ? (buildStoryScopedTrackedChangeIdContext(loadedItems, matchStory).toPublicId(changeId) ?? changeId)
        : (buildTrackedChangeIdContext(loadedItems).toPublicId(changeId) ?? changeId);
      const matchingRow = matchStory
        ? loadedItems.find((item) => entityRowMatchesRequest(item, publicId, matchStory))
        : loadedItems.find((item) => readEntityId(item) === publicId);
      // Thread the requested story when it is non-body; otherwise the matched
      // row's own story (undefined for an explicit or implicit body request).
      const story = matchStory ? requestedStory : readEntityRequestStory(matchingRow);
      const importedId = deriveTrackedChangeImportedId(matchingRow);
      const previousFocus = readReviewFocus();
      const requestedActiveChange: ExplicitActiveChange = {
        id: publicId,
        ...(story ? { story } : {}),
        ...(publicId !== changeId ? { paintedEntityId: changeId } : {}),
      };
      pendingTrackChangeRevealFocuses.add(requestedActiveChange);
      try {
        const target = await resolveEntityTarget(
          'trackChanges',
          publicId,
          loadedItems,
          story || matchStory ? { story, matchStory } : undefined,
        );
        if (trackChangeRevealInvalidation !== requestedAtInvalidation) {
          return { success: false, ok: false };
        }
        if (!target) return { success: false, ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved };
        setExplicitActiveChange(requestedActiveChange);
        const revealInvalidation = trackChangeRevealInvalidation;
        const optimisticActiveChange = explicitActiveChange;
        const optimisticRevision = explicitActiveChangeRevision;
        const isCurrent = (): boolean =>
          trackChangeRevealInvalidation === revealInvalidation &&
          explicitActiveChange === optimisticActiveChange &&
          explicitActiveChangeRevision === optimisticRevision;
        const rollback = (): void => {
          if (!isCurrent()) return;
          restoreReviewFocus(previousFocus);
          recompute();
        };
        recompute();
        trackedChangeNavigationInFlight += 1;
        try {
          const result = await scrollTrackChangeIntoView(publicId, target, story, importedId, {
            behavior: 'auto',
            shouldContinue: isCurrent,
          });
          if (!isCurrent()) return { success: false, ok: false };
          if (!result.ok && result.reason !== SUPERDOC_UI_REASONS.targetNotVisible) {
            rollback();
          } else {
            if (result.ok) await restampVisibleTrackedChangeCarrierAliases(publicId);
            if (!isCurrent()) return { success: false, ok: false };
            mirrorTrackedChangeFocusToHost(requestedActiveChange);
          }
          return result;
        } finally {
          trackedChangeNavigationInFlight = Math.max(0, trackedChangeNavigationInFlight - 1);
          if (trackedChangeNavigationInFlight === 0) {
            if (!isCurrent()) {
              mirrorTrackedChangeFocusToHost(explicitActiveChange);
            } else if (currentHostReviewSource) {
              syncTrackedChangeFocusFromHostReviewTarget(readHostActiveReviewTarget(currentHostReviewSource));
            }
          }
        }
      } finally {
        pendingTrackChangeRevealFocuses.delete(requestedActiveChange);
      }
    },
  };

  const executeTrackDecision = (
    kind: 'accept' | 'reject',
    input: string | { id: string; story?: unknown },
  ): CommandExecutionResult => {
    // Normalize the widened input the same way `setActive` does: a canonical id
    // is globally unique; a `{ id, story }` record (e.g. a `getAt`/`setActive`
    // hit) additionally pins the painted occurrence when a source id repeats
    // across stories.
    const { id, story } = typeof input === 'string' ? { id: input, story: undefined } : input;
    // An empty id names nothing. Fail closed rather than let a later resolver
    // substitute whichever change happens to be selected.
    if (typeof id !== 'string' || id.length === 0) return false;
    const target: LooseRecord = { kind: 'id', id, ...(story ? { story } : {}) };
    return executeTrackDecisionTarget(kind, target, id, story);
  };

  /**
   * Run a domain decision and resolve with its settled result. The domain
   * helpers call the decision route directly so an application command that
   * reuses a built-in tracked-change id cannot intercept them; only the command
   * registry (`commands.execute*`) honours those overrides.
   */
  const settleTrackDecision = (run: () => CommandExecutionResult): Promise<CommandExecutionResult> => {
    pendingCommandSettlement = null;
    lastCommandSettlement = Promise.resolve(false);
    if (disposed) return Promise.resolve(false);
    const immediate = run();
    if (immediate === false) return Promise.resolve(false);
    return lastCommandSettlement;
  };

  const executeTrackDecisionTarget = (
    kind: 'accept' | 'reject',
    target: LooseRecord,
    changeId: string | null,
    story?: unknown,
    selectionChangeIds?: readonly string[],
  ): CommandExecutionResult => {
    try {
      return settleCommandExecution(callTrackDecisionTarget(kind, target, changeId, story, selectionChangeIds));
    } catch {
      return false;
    }
  };

  const callTrackDecisionTarget = (
    kind: 'accept' | 'reject',
    target: LooseRecord,
    changeId: string | null,
    story?: unknown,
    selectionChangeIds?: readonly string[],
  ): unknown => {
    if (trackedChangeDecisionsAreDisabled()) return false;
    const doc = getDoc();
    const tcApi = doc?.trackChanges as LooseRecord | undefined;
    const isAllTarget = target.kind === 'all' || target.scope === 'all';
    const isRangeTarget = target.kind === 'range';
    const isMultiIdTarget = target.kind === 'ids';
    const permissionIds = isAllTarget
      ? []
      : (selectionChangeIds ??
        (isMultiIdTarget && Array.isArray(target.ids)
          ? target.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
          : changeId
            ? [changeId]
            : []));
    if (permissionIds.length > 0 && trackedChangeDecisionPermissionReason(kind, permissionIds)) return false;
    const bulkBlocked = bulkTrackDecisionBlockedReason({ kind, scope: isAllTarget ? 'all' : 'id' }, tcApi);
    if (bulkBlocked) return false;
    if (firstPartyCommandDoc) {
      const readHandles = hostMethod(getHost(), 'getHandles');
      const handles = safeCall<unknown>(readHandles ?? undefined, null);
      const decide = hostMethod(isPlainObject(handles) ? handles.trackChanges : undefined, 'decide');
      return decide ? decide({ decision: kind, target }) : false;
    }
    const legacyName = isAllTarget ? `${kind}All` : kind;
    // A story-scoped per-id decision MUST go through `decide`: the legacy
    // `tcApi[kind](id)` method takes only a bare id and would silently drop the
    // story, deciding a same-id body occurrence instead of the painted one. With
    // no story the legacy-preferred path is kept exactly as before.
    const op =
      !isRangeTarget && !isMultiIdTarget && !story && tcApi && typeof tcApi[legacyName] === 'function'
        ? (tcApi[legacyName] as AnyFn)
        : null;
    const decide = tcApi && typeof tcApi.decide === 'function' ? (tcApi.decide as AnyFn) : null;
    if (!op && !decide) return false;
    return op
      ? op.call(tcApi, changeId ?? {})
      : decide!.call(tcApi, {
          decision: kind,
          target,
        });
  };

  const {
    handle: contentControls,
    clearHighlight: clearContentControlHighlight,
    clearClickListeners: clearContentControlClickListeners,
  } = createContentControlsHandle({
    superdoc,
    select: sliceHandle,
    snapshotHandle,
    leasedDirectorySnapshot: (passive, directory) => directorySnapshotHandle(passive, directory, 'contentControls'),
    directoryLeaseHeld: () => directoryLeaseCounts.contentControls > 0,
    demandCatalog: () => demandHeavyDocRead('contentControls'),
    isDisposed: () => disposed,
    currentEditor: getEditor,
    currentHost: getHost,
    documentContentControls: () => getDoc()?.contentControls,
    rectOf: (target) => viewport.getRect({ target }),
    scrollIntoView: scrollTargetIntoView,
    applySelection: (target) => selection.apply(target),
    activateChrome: activateContentControlChrome,
    onDocumentReset: (hook) => documentResetHooks.push(hook),
    onDestroy: (detach) => detachers.push(detach),
  });

  const fontsSub = sliceHandle((s) => s.fonts);
  const fontsSnap = snapshotHandle(fontsSub);
  const fonts: FontsHandle = {
    get: fontsSnap.get,
    getSnapshot: fontsSnap.getSnapshot,
    subscribe: fontsSnap.subscribe,
    observe: fontsSnap.observe,
    getFamilyOptions: () => state.fonts.options,
    getSizeOptions: () => state.fonts.sizeOptions,
  };

  const history: HistoryHandle = snapshotHandle(sliceHandle((s) => s.history));

  const zoomSub = sliceHandle((s) => s.zoom);
  const zoomSnap = snapshotHandle(zoomSub);
  const zoom: ZoomHandle = {
    get: zoomSnap.get,
    getSnapshot: zoomSnap.getSnapshot,
    subscribe: zoomSnap.subscribe,
    observe: zoomSnap.observe,
    set: (value) => {
      if (typeof superdoc?.setZoom === 'function') {
        try {
          superdoc.setZoom(value);
          recompute();
        } catch {
          /* ignore */
        }
      }
    },
    setMode: (mode) => {
      if (typeof superdoc?.setZoomMode === 'function') {
        try {
          superdoc.setZoomMode(mode);
          recompute();
        } catch {
          /* ignore */
        }
      }
    },
  };

  const documentSub = sliceHandle((s) => s.document);
  const documentSnap = snapshotHandle(documentSub);
  const documentHandle: DocumentHandle = {
    get: documentSnap.get,
    getSnapshot: documentSnap.getSnapshot,
    subscribe: documentSnap.subscribe,
    observe: documentSnap.observe,
    setMode: (mode) => {
      if (typeof superdoc?.setDocumentMode === 'function') {
        try {
          superdoc.setDocumentMode(mode);
          recompute();
        } catch {
          /* ignore */
        }
      }
    },
    export: (input) => {
      if (typeof superdoc?.export === 'function') {
        try {
          return Promise.resolve(superdoc.export(input));
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    getText: () => {
      const doc = getDoc();
      const getText = hostMethod(doc, 'getText');
      const result = safeCall<unknown>(getText ? () => getText({}) : undefined, null);
      if (typeof result === 'string') return result;
      if (isPlainObject(result) && typeof result.text === 'string') {
        return result.text;
      }
      return null;
    },
    replaceDocument: async (file) => {
      const host = options.superdoc;
      if (typeof host.replaceDocument !== 'function') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      return host.replaceDocument(file);
    },
    replaceFile: (file: File | Blob | ArrayBuffer | Uint8Array) => {
      const op = superdoc?.replaceFile ?? superdoc?.loadDocument ?? superdoc?.reload;
      if (typeof op === 'function') {
        try {
          return Promise.resolve(op.call(superdoc, file));
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    onChange: (listener) => {
      if (disposed) return () => {};
      documentChangeListeners.add(listener);
      return () => documentChangeListeners.delete(listener);
    },
    getVersion: () => {
      const { getDocumentVersion } = savedPoint();
      const version = getDocumentVersion ? safeCall<unknown>(() => getDocumentVersion(), null) : null;
      return typeof version === 'string' ? (version as DocumentVersion) : null;
    },
    markClean: (version) => {
      const { markSaved } = savedPoint();
      if (!markSaved) return { ok: false, reason: 'unavailable' };
      const result = safeCall<unknown>(() => markSaved(version), null);
      return isPlainObject(result) && result.ok === true
        ? { ok: true }
        : {
            ok: false,
            reason: isPlainObject(result) && result.reason === 'document-changed' ? 'document-changed' : 'unavailable',
          };
    },
  };

  // Resolve THIS controller's visible host element: the editor mount container
  // when the host exposes one, else the SuperDoc root element. Scopes point
  // hit-testing (and geometry) to this instance so a page with two mounted
  // SuperDocs never cross-reads the other's painted DOM. Returns null when no
  // DOM host exists (pre-mount / post-destroy / SSR). Mirrors viewport.getHost.
  const resolveVisibleHost = (): HTMLElement | null => {
    if (typeof HTMLElement === 'undefined') return null;
    const mountContainer = (getEditor()?.mount as LooseRecord | undefined)?.container;
    if (mountContainer instanceof HTMLElement) return mountContainer;
    const root = superdoc?.element;
    if (root instanceof HTMLElement) return root;
    return null;
  };

  // Point hit-test. The painter stamps `data-track-change-id` (and, when
  // present, `data-comment-ids` / `data-sdt-*`) on each painted run; reading
  // them back is what consumers were doing imperatively from
  // `event.target.closest(...)` in contextmenu handlers. Centralizing the
  // lookup here keeps the painter's attribute names an implementation detail
  // and surfaces a typed `ViewportEntityHit[]` consumers can switch on.
  const pointHitElements = (
    x: unknown,
    y: unknown,
  ): { container: HTMLElement; elements: Element[]; x: number; y: number } | null => {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    // The DOM `document` is reached through `globalThis.document` because the
    // local `document: DocumentHandle` shadows it for type-checking. Guard SSR /
    // non-browser stubs explicitly so the call doesn't throw without a DOM.
    const dom = (globalThis as { document?: Document }).document;
    if (!dom || typeof dom.elementFromPoint !== 'function') return null;
    // Scope the lookup to THIS controller's visible host (mount container, else
    // the SuperDoc root) so a page with two mounted instances never cross-reads
    // the other's painted DOM. Null host (pre-mount / post-destroy / SSR) -> [].
    const container = resolveVisibleHost();
    if (!container) return null;
    const startEl = dom.elementFromPoint(x, y);
    if (!startEl || !container.contains(startEl)) return null;

    // Primary start elements to walk: the `elementFromPoint` hit plus any stacked
    // hittable carriers `elementsFromPoint` reports inside the host. All scoped to
    // the host and de-duped. Every extra DOM probe is guarded so a non-browser /
    // stub env fails closed to the single primary element (existing behavior).
    const primaryEls: Element[] = [startEl];
    const addPrimaryEl = (el: Element | null | undefined): void => {
      if (el && container.contains(el) && !primaryEls.includes(el)) primaryEls.push(el);
    };
    const elementsFromPoint = (
      dom as {
        elementsFromPoint?: (x: number, y: number) => Element[];
      }
    ).elementsFromPoint;
    if (typeof elementsFromPoint === 'function') {
      let stacked: Element[] = [];
      try {
        stacked = elementsFromPoint.call(dom, x, y) ?? [];
      } catch {
        stacked = [];
      }
      for (const el of stacked) addPrimaryEl(el);
    }
    return { container, elements: primaryEls, x, y };
  };

  const pointEntityHits = (x: unknown, y: unknown): readonly ViewportEntityHit[] => {
    const point = pointHitElements(x, y);
    if (!point) return [];
    const { container, elements: primaryEls } = point;
    // Pointer-inert markers (e.g. list-marker glyphs with `pointer-events:none`)
    // are skipped by BOTH elementFromPoint and elementsFromPoint, yet they carry
    // the tracked-change dataset, so find them geometrically: any
    // `[data-track-change-marker]` in a primary start element's subtree whose box
    // contains the point. Guarded rect reads fail closed to no extra hit.
    const markerEls: Element[] = [];
    const addMarkerEl = (el: Element | null | undefined): void => {
      if (el && container.contains(el) && !markerEls.includes(el) && !primaryEls.includes(el)) {
        markerEls.push(el);
      }
    };
    const pointInRect = (el: Element): boolean => {
      const getRect = (el as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
      if (typeof getRect !== 'function') return false;
      let rect: DOMRect;
      try {
        rect = getRect.call(el);
      } catch {
        return false;
      }
      return (
        rect != null && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
      );
    };
    for (const el of primaryEls) {
      const queryAll = (
        el as {
          querySelectorAll?: (selector: string) => ArrayLike<Element>;
        }
      ).querySelectorAll;
      if (typeof queryAll !== 'function') continue;
      let markers: ArrayLike<Element>;
      try {
        markers = queryAll.call(el, '[data-track-change-marker]');
      } catch {
        continue;
      }
      for (let i = 0; i < markers.length; i += 1) {
        if (pointInRect(markers[i])) addMarkerEl(markers[i]);
      }
    }
    // Marker carriers are pointer-inert DESCENDANTS of the primary element they
    // were found under, so they are deeper / more specific and must be walked
    // BEFORE the primary chain: walking up from a marker yields its tracked change
    // FIRST, then the outer comment / content-control, which the `${type}:${id}`
    // de-dupe below keeps — so `hits[0]` stays the marker's tracked change even
    // when the marker sits inside a commented / SDT block. Reverse to deepest-
    // first among markers: `querySelectorAll` yields document order (an ancestor
    // always precedes its descendants), so reversing walks a nested marker before
    // its ancestor marker. With no markers found, `startEls` collapses to the
    // primary list, so the non-marker path's ordering is unchanged.
    markerEls.reverse();
    const startEls: Element[] = [...markerEls, ...primaryEls];

    // Walk each start element's chain (bounded to the host so app-wrapper data-*
    // above it never leaks) and merge, innermost-first; the validation loop's
    // `${type}:${id}` de-dupe below keeps the first occurrence of each entity.
    const rawHits = collectEntityHitsFromChain(startEls[0], container);
    for (let i = 1; i < startEls.length; i += 1) {
      for (const hit of collectEntityHitsFromChain(startEls[i], container)) rawHits.push(hit);
    }
    if (rawHits.length === 0) return rawHits;

    // Map each painted tracked-change id to the public TrackChangesItem id it
    // belongs to. The painter usually stamps the public id directly, but for a
    // replacement (or before a change's annotation is threaded into the
    // projection) a run can carry a source-level alias (`imported:<w:id>`); the
    // id context reconciles both to the canonical id so a click on the deleted
    // side of a replacement resolves the SAME item as the inserted side (and as
    // the sidebar card). Ids that resolve to no current item drop (stale /
    // already-decided). Comment and content-control hits pass through (deduped)
    // — they carry their own public ids.
    const items = trackChangesSub.get().items;
    const idContext = buildTrackedChangeIdContext(items);
    // Lazily-read internal all-story items, consulted only when a hit carries a
    // (non-body) story. `undefined` until first read; the items / `null` after.
    // The SAME read `getAt` resolves against, matched with the SAME id+story
    // matcher, so `entityAt` and `getAt` agree on story hits.
    let allStoryItems: readonly TrackChangesItem[] | null | undefined;
    const seen = new Set<string>();
    const hits: ViewportEntityHit[] = [];
    for (const hit of rawHits) {
      if (hit.type === 'decoration') {
        const owner = decorationOwnerForProvider(hit.id);
        if (!owner) continue;
        const key = `decoration:${owner.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ type: 'decoration', id: owner.id });
        continue;
      }
      if (hit.type !== 'trackedChange') {
        const layoutStory = hit.type === 'contentControl' ? layoutStoryDatasetToStoryLocator(hit.story) : undefined;
        const story =
          hit.type === 'contentControl'
            ? isTextboxStory(layoutStory)
              ? layoutStory
              : (storyKeyToStoryLocator(hit.storyKey) ?? layoutStory)
            : undefined;
        const key = `${hit.type}:${hit.id}:${JSON.stringify(story ?? null)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hit.type === 'contentControl') {
          const { storyKey: _storyKey, story: _paintedStory, ...publicHit } = hit;
          hits.push(story ? { ...publicHit, story } : publicHit);
        } else {
          hits.push(hit);
        }
        continue;
      }
      // The DOM walk attaches the raw painted story strings; map them to the
      // public StoryLocator shape so id+story matching can disambiguate a
      // tracked-change id repeated across stories. PREFER the run/marker
      // `data-story-key` (carries the real footnote/endnote/header-footer story)
      // over the layout-story (which falls back to `body` for note bands).
      // Absent / body / unknown stays story-less (id-only matching).
      const story = storyKeyToStoryLocator(hit.storyKey) ?? layoutStoryDatasetToStoryLocator(hit.story);
      let publicId: string | null;
      if (story) {
        // Story-scoped change: reconcile + validate against the fresh all-story
        // items with the SAME id+story matcher `getAt` uses. Fail closed (drop)
        // while the validation read is unsettled (`null`).
        // Reconcile the alias within THIS story's rows so a `w:id` reused across
        // stories can't resolve to another story's public id (then get dropped).
        if (allStoryItems === undefined) {
          allStoryItems = readAllStoryTrackChanges();
        }
        if (!allStoryItems) continue;
        publicId = buildStoryScopedTrackedChangeIdContext(allStoryItems, story).toPublicId(hit.id);
        if (!publicId || !allStoryItems.some((item) => entityRowMatchesRequest(item, publicId!, story))) {
          continue;
        }
      } else {
        // A story-less painted change reconciles against the public feed.
        publicId = idContext.toPublicId(hit.id);
        if (!publicId) continue;
      }
      const key = `trackedChange:${publicId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(story ? { type: 'trackedChange', id: publicId, story } : { type: 'trackedChange', id: publicId });
    }
    return hits;
  };

  function entityAt(x: number, y: number): ViewportEntityAddress | null;
  function entityAt(input: { x: number; y: number }): readonly ViewportEntityHit[];
  function entityAt(
    xOrInput: number | { x: number; y: number },
    _y?: number,
  ): ViewportEntityAddress | readonly ViewportEntityHit[] | null {
    // Object form is the v1-compatible path: the painted entity hits under the
    // point. `typeof null === 'object'`, so a null/garbage object-form arg lands
    // here too; optional-chain the property read so it fails closed to `[]` (via
    // `pointEntityHits`' non-number guard) instead of throwing on `.x` / `.y`.
    if (typeof xOrInput === 'object') return pointEntityHits(xOrInput?.x, xOrInput?.y);
    // Number form: every current entity hit (comment / trackedChange /
    // contentControl) maps to an entity address `viewport.getRect` cannot
    // resolve — getRect supports only text/selection targets and fails closed
    // otherwise — so returning one would hand back an address that never
    // resolves to a rect. Return null instead of an unresolvable address. Full
    // entity-address geometry (number form + getRect) is a deliberate follow-up.
    return null;
  }

  const pointInVisibleHost = (x: number, y: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const host = resolveVisibleHost();
    if (!host) return false;
    const rect = host.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const isPointSelectionTarget = (value: unknown): value is SelectionTarget => {
    if (!isPlainObject(value) || value.kind !== 'selection') return false;
    return [value.start, value.end].every(
      (point) =>
        isPlainObject(point) &&
        point.kind === 'text' &&
        typeof point.blockId === 'string' &&
        typeof point.offset === 'number' &&
        Number.isSafeInteger(point.offset) &&
        point.offset >= 0,
    );
  };

  async function positionAt(input: ViewportPositionAtInput): Promise<ViewportPositionAtResult> {
    if (disposed) return { status: 'disposed' };
    if (input?.signal?.aborted) return { status: 'cancelled' };
    if (!input || typeof input.x !== 'number' || typeof input.y !== 'number' || !pointInVisibleHost(input.x, input.y))
      return { status: 'no-target' };
    const editor = getEditor(),
      viewportQuery = editor?.viewportQuery,
      token = contentToken();
    const getTargetAtPoint = hostMethod(viewportQuery, 'getTargetAtPoint');
    if (!getTargetAtPoint) return { status: 'unavailable' };
    const result = await getTargetAtPoint({ clientX: input.x, clientY: input.y });
    if (disposed) return { status: 'disposed' };
    if (input.signal?.aborted) return { status: 'cancelled' };
    if (editor !== getEditor() || viewportQuery !== getEditor()?.viewportQuery || token !== contentToken())
      return { status: 'stale' };
    if (!isPlainObject(result)) throw new Error('Viewport point query returned an invalid host result');
    if (result.status === 'resolved') {
      if (!isPointSelectionTarget(result.target)) throw new Error('Viewport point query returned an invalid target');
      return { status: 'resolved', target: result.target };
    }
    if (result.status === 'no-target' || result.status === 'stale' || result.status === 'disposed')
      return { status: result.status };
    throw new Error('Viewport point query returned an invalid host result');
  }

  function contextAt(input: { x: number; y: number }): ViewportContext {
    const validInput = !!input && typeof input.x === 'number' && typeof input.y === 'number';
    // A fresh object: callers reuse and mutate pointer coordinates, and the
    // returned point must keep describing the hits that were resolved.
    const point = validInput ? { x: input.x, y: input.y } : { x: 0, y: 0 };

    return {
      point,
      entities: validInput ? entityAt(point) : [],
      selection: (() => {
        const current = computeSelection();
        return current.status === 'ready' ? current : { ...current, tableSelection: null };
      })(),
      position: null,
      insideSelection:
        validInput && pointInVisibleHost(point.x, point.y)
          ? safeCall(
              () =>
                hostMethod(
                  getEditor()?.viewportQuery,
                  'isPointInPaintedSelection',
                )?.({
                  clientX: point.x,
                  clientY: point.y,
                }) === true,
              false,
            )
          : false,
    };
  }

  /**
   * One live `viewport.observe()` subscription. `detach` releases the geometry
   * binding only; the state subscription is owned by the closure in `observe`.
   */
  interface GeometryObserver {
    schedule: () => void;
    detach: (() => void) | null;
    /** The host this observer is currently attached to, or null when unbound. */
    boundHost: LooseRecord | null;
  }

  const geometryObservers = new Set<GeometryObserver>();
  let geometryReleaseScheduled = false;

  const bindGeometryObserver = (entry: GeometryObserver): void => {
    const host = getHost();
    if (typeof host?.observeGeometry !== 'function') return;
    // Recorded only when the subscription actually took effect. Setting it
    // unconditionally means a throwing `observeGeometry()` still looks bound, and
    // the rebind skip below then never retries it — leaving the observer
    // permanently without geometry updates on that host.
    //
    // Tracked separately from `detach` because the two differ: a host may
    // subscribe successfully and return no unsubscribe function, and treating
    // that as a failed bind would rebind on top of a live subscription.
    let subscribed = false;
    const off = safeCall<unknown>(() => {
      const result = hostMethod(host, 'observeGeometry')?.(() => entry.schedule());
      subscribed = true;
      return result;
    }, null);
    entry.detach = typeof off === 'function' ? (off as () => void) : null;
    entry.boundHost = subscribed ? host : null;
  };

  const detachGeometryObserver = (entry: GeometryObserver): void => {
    if (entry.detach) {
      try {
        entry.detach();
      } catch {
        /* a host that already tore itself down is not an error here */
      }
      entry.detach = null;
    }
    // Cleared regardless of whether there was an unsubscribe to call. A host may
    // subscribe successfully and return nothing, so a null `detach` does not mean
    // there is no binding state — and leaving a stale host here makes the rebind
    // skip suppress a genuinely needed rebind later.
    entry.boundHost = null;
  };

  /**
   * Move every live geometry subscription to the editor that is now active.
   * Without this, scroll and repaint on the replacement editor never reach a
   * listener that was registered against the previous one, so overlays stop
   * tracking the document while still responding to selection and zoom.
   */
  /**
   * Release every geometry subscription once a hostless moment turns out to be
   * permanent. Deferred rather than immediate because a null host is ambiguous
   * at the instant it arrives: `registerV2Runtime` unregisters the outgoing
   * runtime and installs the replacement in ONE synchronous block, so a refresh
   * shows up here as a null followed by the new host with nothing in between.
   * By the time a microtask runs, a refresh has already installed its host and a
   * true clear (`removeDocument()`, a fail-closed projection) still has none.
   */
  const releaseGeometryObserversIfStillHostless = (): void => {
    geometryReleaseScheduled = false;
    if (disposed || getHost()) return;
    for (const entry of geometryObservers) detachGeometryObserver(entry);
  };

  const scheduleGeometryRelease = (): void => {
    if (geometryReleaseScheduled) return;
    geometryReleaseScheduled = true;
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(releaseGeometryObserversIfStillHostless);
      return;
    }
    void Promise.resolve().then(releaseGeometryObserversIfStillHostless);
  };

  const rebindGeometryObservers = (): void => {
    const host = getHost();
    // Nothing to bind to right now, and no way to tell yet whether that is
    // permanent. Detaching immediately is wrong for a refresh: measured on the
    // real sequence, detach fired on the null step and `observeGeometry` ran
    // again on the next, which is the churn the same-host guard exists to
    // prevent. Keeping the binding forever is wrong for a true clear: measured,
    // the departed host went on driving `ui.viewport.observe()` consumers. So
    // hold the subscription and let the deferred check above settle it.
    if (!host) {
      scheduleGeometryRelease();
      return;
    }
    for (const entry of geometryObservers) {
      // Only when the host actually changed. A V2 facade refresh installs a new
      // editor object over the SAME host and fires `active-editor-change`, which
      // lands here before `document-replaced` does — so rebinding unconditionally
      // tore a live subscription off its own host and put it straight back,
      // defeating the preservation this split exists to provide. The re-measure
      // below is justified by "the new host's geometry has nothing to do with the
      // old one's", which is simply untrue when the host is unchanged.
      if (entry.boundHost && entry.boundHost === host) continue;
      detachGeometryObserver(entry);
      bindGeometryObserver(entry);
      entry.schedule();
    }
  };

  activeEditorResetHooks.push(rebindGeometryObservers);

  const resolveEntityGeometryTarget = (address: LooseRecord): { target: unknown } | { reason: string } => {
    const comment = address.entityType === 'comment';
    const get = hostMethod(comment ? getDoc()?.comments : getDoc()?.trackChanges, 'get');
    if (!get) return { reason: 'unavailable' };
    const id = address.entityId as string;
    const story = comment ? undefined : readEntityRequestStory({ address });
    const input = comment ? { commentId: id } : { id, ...(story ? { story } : {}) };
    const { value, status } = readAsync<unknown>(
      `${address.entityType}:geometry:${id}:${storyLocatorSignature(story ?? null)}`,
      localContentToken(),
      () =>
        Promise.resolve()
          .then(() => get(input))
          .catch(() => null),
      (info) => {
        const target = readEntityTarget(info) as LooseRecord | null;
        if (!target || !Array.isArray(target.segments) || target.segments.length === 0) return null;
        const navigationAnchorOnly =
          !comment &&
          (target.segments as Array<{ range?: { start?: unknown; end?: unknown } }>).every(
            (segment) => segment.range?.start === segment.range?.end,
          );
        if (navigationAnchorOnly) return null;
        return story && !target.story ? { ...target, story } : target;
      },
    );
    if (status !== 'ready') return { reason: 'not-ready' };
    return value ? { target: value } : { reason: 'unresolved' };
  };

  type HostVisuals = {
    highlight(id: string, options?: unknown): ReturnType<DecorationsHandle['highlight']>;
    generation(): number;
  };
  type DecorationOwnership = { visuals: HostVisuals; generation: number };
  const liveDecorations = new Map<ReturnType<DecorationsHandle['highlight']>, DecorationOwnership>();
  const decorationOwnerForProvider = (providerId: string): { id: string; data?: unknown } | null => {
    const owner = (currentHostVisuals() as { providerOwner?: (id: string) => unknown } | null)?.providerOwner?.(
      providerId,
    );
    return isPlainObject(owner) && typeof owner.id === 'string' ? (owner as { id: string; data?: unknown }) : null;
  };
  const currentHostVisuals = (): HostVisuals | null => (getEditor()?.visuals as HostVisuals | null | undefined) ?? null;
  const decorationListeners = new Set<(event: DecorationPointerEvent) => void>();
  let detachDecorationPointer: (() => void) | null = null;
  let hoveredDecorations: ReadonlyArray<{ id: string; data?: DecorationPointerEvent['data'] }> = [];
  let lastPointer = { clientX: 0, clientY: 0 };
  const decorationIdsAt = (x: number, y: number): string[] => {
    const point = pointHitElements(x, y);
    if (!point) return [];
    const ids = new Set<string>();
    for (const element of point.elements) {
      for (const provider of collectDecorationProvidersFromChain(element, point.container)) {
        const owner = decorationOwnerForProvider(provider);
        if (owner) ids.add(owner.id);
      }
    }
    return [...ids];
  };
  const decorationData = (id: string): DecorationPointerEvent['data'] | undefined => {
    const owner = (
      currentHostVisuals() as { ownerById?: (id: string) => { data?: unknown } | null } | null
    )?.ownerById?.(id);
    return isPlainObject(owner?.data) ? (owner!.data as DecorationPointerEvent['data']) : undefined;
  };
  const emitDecorationEvent = (
    type: DecorationPointerEvent['type'],
    decoration: { id: string; data?: DecorationPointerEvent['data'] },
    point: { clientX: number; clientY: number },
  ): void => {
    const payload: DecorationPointerEvent = {
      type,
      id: decoration.id,
      ...(decoration.data ? { data: decoration.data } : {}),
      clientX: point.clientX,
      clientY: point.clientY,
    };
    for (const listener of Array.from(decorationListeners)) safeCall(() => listener(payload), undefined);
  };
  const leaveHoveredDecorations = (onlyId?: string): void => {
    const leaving = hoveredDecorations.filter((decoration) => onlyId === undefined || decoration.id === onlyId);
    hoveredDecorations = hoveredDecorations.filter((decoration) => !leaving.includes(decoration));
    for (const decoration of leaving) emitDecorationEvent('hover-leave', decoration, lastPointer);
  };
  const attachDecorationPointer = (): void => {
    if (detachDecorationPointer || decorationListeners.size === 0) return;
    const host = resolveVisibleHost();
    if (!host) return;
    const onClick = (event: MouseEvent): void => {
      for (const id of decorationIdsAt(event.clientX, event.clientY)) {
        emitDecorationEvent('click', { id, data: decorationData(id) }, event);
      }
    };
    const onMove = (event: MouseEvent): void => {
      lastPointer = { clientX: event.clientX, clientY: event.clientY };
      const nextIds = decorationIdsAt(event.clientX, event.clientY);
      const leaving = hoveredDecorations.filter((decoration) => !nextIds.includes(decoration.id));
      const kept = hoveredDecorations.filter((decoration) => nextIds.includes(decoration.id));
      const entering = nextIds
        .filter((id) => !kept.some((decoration) => decoration.id === id))
        .map((id) => ({ id, data: decorationData(id) }));
      hoveredDecorations = [...kept, ...entering];
      for (const decoration of leaving) emitDecorationEvent('hover-leave', decoration, event);
      for (const decoration of entering) emitDecorationEvent('hover-enter', decoration, event);
    };
    const onLeave = (event: MouseEvent): void => {
      lastPointer = { clientX: event.clientX, clientY: event.clientY };
      leaveHoveredDecorations();
    };
    host.addEventListener('click', onClick);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    detachDecorationPointer = () => {
      host.removeEventListener('click', onClick);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      leaveHoveredDecorations();
      detachDecorationPointer = null;
    };
  };
  const subscribeDecorationPointer = (listener: (event: DecorationPointerEvent) => void): (() => void) => {
    if (disposed) throw new Error('ui.decorations.subscribe called on a destroyed UI controller.');
    decorationListeners.add(listener);
    attachDecorationPointer();
    return () => {
      decorationListeners.delete(listener);
      if (decorationListeners.size === 0) detachDecorationPointer?.();
    };
  };
  documentResetHooks.push(() => {
    leaveHoveredDecorations();
    const current = currentHostVisuals();
    for (const [handle, owner] of Array.from(liveDecorations)) {
      if (owner.visuals !== current || owner.generation !== current.generation()) handle.dispose();
    }
  });
  activeEditorResetHooks.push(() => {
    detachDecorationPointer?.();
    attachDecorationPointer();
  });

  const createDecorationsHandle = (track?: (handle: { dispose(): void }) => void): DecorationsHandle => ({
    subscribe: (listener) => {
      const unsubscribe = subscribeDecorationPointer(listener);
      track?.({ dispose: unsubscribe });
      return unsubscribe;
    },
    highlight: (id, options) => {
      if (disposed) throw new Error('ui.decorations.highlight called on a destroyed UI controller.');
      const visuals = currentHostVisuals();
      if (!visuals) throw new Error('ui.decorations.highlight requires a ready document.');
      const inner = visuals.highlight(id, options);
      let handleDisposed = false;
      const handle: ReturnType<DecorationsHandle['highlight']> = {
        id: inner.id,
        replace: (targets) => inner.replace(targets),
        add: (targets) => inner.add(targets),
        clear: () => {
          if (handleDisposed) return;
          inner.clear();
          leaveHoveredDecorations(inner.id);
        },
        invalidate: () => inner.invalidate(),
        dispose: () => {
          if (handleDisposed) return;
          handleDisposed = true;
          liveDecorations.delete(handle);
          inner.dispose();
          leaveHoveredDecorations(inner.id);
        },
      };
      liveDecorations.set(handle, { visuals, generation: visuals.generation() });
      track?.(handle);
      return handle;
    },
  });
  const decorations = createDecorationsHandle();

  const viewport: ViewportHandle = {
    getRects: async (input) => {
      const initialHost = getHost();
      let geometryRevision = 0;
      let unsubscribe: unknown;
      let observationFailed = false;
      try {
        unsubscribe =
          typeof initialHost?.observeGeometry === 'function'
            ? initialHost.observeGeometry(() => {
                geometryRevision++;
              })
            : undefined;
      } catch {
        observationFailed = true;
      }
      const generation = (): string | null => {
        if (observationFailed) return null;
        const host = getHost();
        const metrics = typeof host?.getPageMetricsSnapshot === 'function' ? host.getPageMetricsSnapshot() : null;
        const localRevision =
          typeof host?.getLocalMutationRevision === 'function' ? host.getLocalMutationRevision() : null;
        const relative = input.relativeTo?.getBoundingClientRect();
        return JSON.stringify([
          contentToken(),
          host === initialHost,
          localRevision,
          metrics?.documentId,
          metrics?.renderEpoch,
          metrics?.layoutGeneration,
          geometryRevision,
          relative?.left,
          relative?.top,
          relative?.width,
          relative?.height,
        ]);
      };
      try {
        return await readViewportBatch(
          input,
          (target) => viewport.getRect({ target, relativeTo: input.relativeTo }),
          generation,
          () => disposed,
        );
      } finally {
        if (typeof unsubscribe === 'function') safeCall(() => unsubscribe(), undefined);
      }
    },
    getRect: (input: ViewportGetRectInput): ViewportRectResult => {
      const requested = input.target as LooseRecord | undefined;
      if (
        requested?.kind === 'entity' &&
        (requested.entityType === 'trackedChange' || requested.entityType === 'comment') &&
        typeof requested.entityId === 'string'
      ) {
        const resolved = resolveEntityGeometryTarget(requested);
        if ('reason' in resolved) return rectFailure(resolved.reason);
        return viewport.getRect({
          target: resolved.target as ViewportGetRectInput['target'],
          relativeTo: input.relativeTo,
        });
      }
      // v2 path: resolve through the v2 host target-geometry surface. This
      // replaces the old v1 entity-rect probe and fails closed (no synthesized
      // boxes) for unmounted / unresolved / unpainted targets.
      const host = getHost();
      const getTargetRects = host?.getTargetRects;
      if (typeof getTargetRects === 'function') {
        const res = safeCall<LooseRecord | null>(() => getTargetRects.call(host, { target: input.target }), null);
        if (res && typeof res === 'object') {
          if (res.success === true && Array.isArray(res.rects)) {
            const rects = (res.rects as unknown[]).filter((r): r is ViewportRect => r != null && typeof r === 'object');
            return relativizeRects(rectResult(rects), input.relativeTo);
          }
          return rectFailure(typeof res.reason === 'string' ? res.reason : 'unresolved');
        }
        return rectFailure('unresolved');
      }
      // v2-native: geometry is host-owned. There is NO v1 entity-rect fallback
      // (the v1 presentation runtime is not restored in superdoc@2), so a host
      // without the geometry surface fails closed (`unavailable`) rather than
      // DOM-scraping or reaching into v1 internals.
      return rectFailure('unavailable');
    },
    observe: (listener: () => void): (() => void) => {
      // Coalesce geometry invalidations into one callback per animation frame so
      // a burst of repaint/scroll/resize/zoom events triggers a single re-measure.
      const unsubs: Array<() => void> = [];
      let frame = 0;
      const hasRaf = typeof requestAnimationFrame === 'function';
      const schedule = (): void => {
        if (!hasRaf) {
          listener();
          return;
        }
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          listener();
        });
      };
      const sub = select((s) => ({ ready: s.ready, selection: s.selection, zoom: s.zoom }));
      unsubs.push(sub.subscribe(() => schedule()));
      // Registered rather than bound inline: the geometry half of this
      // subscription belongs to one host, so an active-editor swap has to move
      // it. The state half above keeps firing on its own, which is why a stale
      // binding degrades quietly instead of failing.
      const entry: GeometryObserver = { schedule, detach: null, boundHost: null };
      bindGeometryObserver(entry);
      geometryObservers.add(entry);
      return () => {
        geometryObservers.delete(entry);
        detachGeometryObserver(entry);
        if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        for (const unsub of unsubs.splice(0)) {
          try {
            unsub();
          } catch {
            /* ignore */
          }
        }
      };
    },
    getHost: (): HTMLElement | null => resolveVisibleHost(),
    entityAt,
    contextAt,
    positionAt,
    scrollIntoView: async (input: ScrollIntoViewInput): Promise<ScrollIntoViewOutput> => {
      const rawTarget = input?.target;
      if (!rawTarget) return { success: false };

      let target: unknown | null = null;
      if (rawTarget.kind === 'entity' && rawTarget.entityType === 'footnote') {
        target = rawTarget;
      } else if (rawTarget.kind === 'entity') {
        // Resolve the input target into the segment-shaped text target the host
        // scroll surface consumes, then route through the shared helper so this
        // fails closed identically to the per-entity `scrollTo` methods.
        // Comment / tracked-change id — resolve to its stored target exactly as
        // `comments.scrollTo` / `trackChanges.scrollTo` do.
        const namespace = rawTarget.entityType === 'comment' ? 'comments' : 'trackChanges';
        const items = namespace === 'comments' ? commentsSub.get().items : trackChangesSub.get().items;
        const request =
          rawTarget.entityType === 'trackedChange' && rawTarget.story ? { story: rawTarget.story } : undefined;
        target = await resolveEntityTarget(namespace, rawTarget.entityId, items, request);
      } else {
        // Text range. A `TextTarget` is already segment-shaped; a single-block
        // `TextAddress` wraps into one segment (the same discrimination v1 used).
        const asTarget = rawTarget as TextTarget;
        const asAddress = rawTarget as TextAddress;
        const segments =
          Array.isArray(asTarget.segments) && asTarget.segments.length > 0
            ? asTarget.segments
            : asAddress.blockId && asAddress.range
              ? [{ blockId: asAddress.blockId, range: asAddress.range }]
              : null;
        if (segments) {
          const story = (rawTarget as TextTarget | TextAddress).story;
          target = {
            kind: 'text',
            segments,
            ...(asTarget.coordinateSpace ? { coordinateSpace: asTarget.coordinateSpace } : {}),
            story: story ?? { kind: 'story', storyType: 'body' },
          };
        }
      }

      if (!target) return { success: false };
      // Match the v1 viewport defaults: center alignment, smooth scrolling.
      const result = await scrollTargetIntoView(target, {
        block: input.block ?? 'center',
        behavior: input.behavior ?? 'smooth',
      });
      return { success: result.ok };
    },
  };

  const readMetadataResolvedTarget = (resolved: unknown): unknown | null => {
    const record = resolved && typeof resolved === 'object' ? (resolved as LooseRecord) : null;
    const target = record?.target;
    return target && typeof target === 'object' ? target : null;
  };

  const metadataResolveKey = (id: string): string => `metadata:resolve:${id}`;

  const localContentToken = (): string => {
    const host = getHost();
    const localRevision = safeCall<unknown>(() => hostMethod(host, 'getLocalMutationRevision')?.(), null);
    return `${contentToken()}|local:${typeof localRevision === 'number' ? localRevision : 'unknown'}`;
  };

  /** Resolve a metadata id to its SelectionTarget, or null when unresolved. */
  const resolveMetadataTarget = (id: string): unknown | null => {
    const doc = getDoc();
    const resolveMetadata = hostMethod(doc?.metadata, 'resolve');
    if (!resolveMetadata) return null;
    const { value, status } = readAsync<unknown>(
      metadataResolveKey(id),
      localContentToken(),
      () => resolveMetadata({ id }),
      readMetadataResolvedTarget,
    );
    return status === 'ready' ? value : null;
  };

  const resolveMetadataTargetAsync = async (id: string): Promise<unknown | null> => {
    const doc = getDoc();
    const resolveMetadata = hostMethod(doc?.metadata, 'resolve');
    if (!resolveMetadata) return null;
    try {
      const token = localContentToken();
      const resolved = await Promise.resolve(resolveMetadata({ id }));
      if (token !== localContentToken()) return null;
      const target = readMetadataResolvedTarget(resolved);
      seedAsyncRead(metadataResolveKey(id), token, target);
      return target;
    } catch {
      return null;
    }
  };

  const metadata: MetadataHandle = {
    getRect: (input): ViewportRectResult & { success: boolean; rect?: ViewportRect } => {
      const doc = getDoc();
      if (!hostMethod(doc?.metadata, 'resolve')) {
        return rectFailure('unavailable') as ViewportRectResult & { success: boolean; rect?: ViewportRect };
      }
      const target = resolveMetadataTarget(input.id);
      if (!target) {
        return rectFailure('unresolved') as ViewportRectResult & { success: boolean; rect?: ViewportRect };
      }
      return viewport.getRect({ target: target as ViewportGetRectInput['target'] }) as ViewportRectResult & {
        success: boolean;
        rect?: ViewportRect;
      };
    },
    scrollIntoView: async (input): Promise<ScrollIntoViewOutput> => {
      const target = await resolveMetadataTargetAsync(input.id);
      if (!target) return { success: false };
      const result = await scrollTargetIntoView(target, { block: input.block, behavior: input.behavior });
      return { success: result.ok };
    },
  };

  // -- tables (shared table-context facade) ---------------------------------
  const EMPTY_TABLE_CONTEXT: TableContextInfo = {
    inTable: false,
    tableNodeId: null,
    rowIndex: null,
    columnIndex: null,
    cellNodeId: null,
    rows: null,
    columns: null,
    status: 'ready',
    cellRange: null,
    tableSelection: null,
  };
  const publicTableContext = (snapshot: LooseRecord | null): TableContextInfo => {
    const status: SliceStatus =
      snapshot?.status === 'pending' || snapshot?.status === 'stale' ? snapshot.status : 'ready';
    if (!snapshot || snapshot.inTable !== true || status !== 'ready') return { ...EMPTY_TABLE_CONTEXT, status };
    const table = snapshot.table as LooseRecord | undefined;
    const row = snapshot.row as LooseRecord | undefined;
    const column = snapshot.column as LooseRecord | undefined;
    const cell = snapshot.cell as LooseRecord | undefined;
    if (typeof table?.nodeId !== 'string') return { ...EMPTY_TABLE_CONTEXT, status };
    return {
      inTable: true,
      status,
      tableNodeId: table.nodeId,
      rowIndex: typeof row?.index === 'number' ? row.index : null,
      columnIndex: typeof column?.index === 'number' ? column.index : null,
      cellNodeId: typeof cell?.nodeId === 'string' ? cell.nodeId : null,
      rows: typeof table.rows === 'number' ? table.rows : null,
      columns: typeof table.columns === 'number' ? table.columns : null,
      cellRange: readMergeRange(snapshot.cellRange as LooseRecord | undefined),
      tableSelection: (snapshot.tableSelection as SelectionInfo['tableSelection']) ?? null,
    };
  };
  const tables: TablesHandle = {
    getContext: () => publicTableContext(readHostTableContext()),
    getContextAsync: async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = selectionReadToken();
        const editor = getEditor(),
          doc = editor?.doc,
          content = contentToken(),
          mode = readDocumentMode();
        const host = getHost();
        const read = host?.getTableContextAsync;
        if (typeof read !== 'function') return publicTableContext(readHostTableContext());
        let snapshot: LooseRecord | null = null;
        try {
          snapshot = await read.call(host);
        } catch {
          return { ...EMPTY_TABLE_CONTEXT, status: 'pending' };
        }
        if (disposed) return { ...EMPTY_TABLE_CONTEXT, status: 'pending' };
        if (
          host !== getHost() ||
          editor !== getEditor() ||
          doc !== getEditor()?.doc ||
          content !== contentToken() ||
          mode !== readDocumentMode()
        )
          continue;
        const context = publicTableContext(snapshot);
        if (context.status === 'stale') continue;
        if (token !== selectionReadToken()) {
          // Queued selection paints can catch up while an ordered worker read
          // resolves. Accept it only when current fenced facts prove the same context.
          const appliedSnapshot = readHostTableContext();
          if (appliedSnapshot?.status !== 'ready') continue;
          const applied = publicTableContext(appliedSnapshot);
          if (
            context.status !== 'ready' ||
            applied.status !== 'ready' ||
            JSON.stringify(context) !== JSON.stringify(applied)
          )
            continue;
        }
        return context;
      }
      return { ...EMPTY_TABLE_CONTEXT, status: 'stale' };
    },
    isInTable: (): boolean => resolveTableContext() != null,
  };

  const {
    handle: search,
    scheduleRefresh: scheduleSearchRefresh,
    stopRefresh: stopSearchRefresh,
    clearListeners: clearSearchListeners,
    invalidateInFlightRequests: invalidateInFlightSearchRequests,
  } = createSearchHandle({
    hostSearch: () => getHost()?.search,
    editCommandSearch: () => getEditCommands()?.search,
    editCommandState: readEditCommandStateEntry,
    snapshotHandle,
    isDisposed: () => disposed,
    onDocumentReset: (hook) => documentResetHooks.push(hook),
    onDocumentModeChange: (hook) => documentModeChangeHooks.push(hook),
  });
  scheduleActiveSearchRefresh = scheduleSearchRefresh;

  const styles = createStylesHandle({
    reads: styleReads,
    select: sliceHandle,
    snapshotHandle,
    currentSelection: () => state.selection,
    isDisposed: () => disposed,
    getDoc,
    contentToken,
    demandHeavyDocRead: (key) => {
      coldAsyncReadDeferrals.set(`${key}\u0000${contentToken()}`, 'released');
      demandHeavyDocRead(key);
    },
    readAsyncEntry: (key) => asyncReads.get(key),
    readDocumentMode,
    readHostSelectionSnapshot,
    readSelectionInfoFresh: () => readSelectionInfoFresh(),
    settleWorkflowReceipt,
  });

  const openWatermarkSurface = hostMethod(superdoc, 'openSurface');
  const watermark = createWatermarkController({
    getEditor: getEditor as Parameters<typeof createWatermarkController>[0]['getEditor'],
    getMode: readDocumentMode,
    getFonts: () => fonts.getFamilyOptions(),
    getContainer: () => (superdoc.element ?? null) as HTMLElement | null,
    openSurface: openWatermarkSurface ? (request) => openWatermarkSurface(request) as SurfaceHandle : null,
  });
  documentResetHooks.push(watermark.close);
  documentModeChangeHooks.push(watermark.close);

  // -- scopes ---------------------------------------------------------------
  const createScope = (): SuperDocUIScope => {
    const scopeUnsubs: Array<() => void> = [];
    return {
      decorations: createDecorationsHandle((handle) => scopeUnsubs.push(() => handle.dispose())),
      document: {
        onChange: (listener) => {
          const unsub = documentHandle.onChange(listener);
          scopeUnsubs.push(unsub);
          return unsub;
        },
      },
      select: (selector, equality) => {
        const sub = select(selector, equality);
        return {
          get: sub.get,
          subscribe: (cb) => {
            const unsub = sub.subscribe(cb);
            scopeUnsubs.push(unsub);
            return unsub;
          },
        };
      },
      dispose: () => {
        for (const unsub of scopeUnsubs.splice(0)) unsub();
      },
    };
  };

  const destroy = (): void => {
    for (const request of pendingListRequests) request.cancel('ui-destroy');
    if (disposed) return;
    watermark.destroy();
    clearContentControlHighlight();
    for (const handle of Array.from(liveDecorations.keys())) handle.dispose();
    detachDecorationPointer?.();
    decorationListeners.clear();
    disposed = true;
    cancelFrameRecompute();
    stopSearchRefresh();
    releaseSharedUiTrackedChangesCatalog(uiTrackedChangesCatalogHost, uiTrackedChangesCatalogState);
    if (foregroundAsyncRetryTimer) {
      clearTimeout(foregroundAsyncRetryTimer);
      foregroundAsyncRetryTimer = null;
    }
    asyncReadCache.cancelFailureRetry();
    if (pendingEffectiveInlineRead?.timer) {
      clearTimeout(pendingEffectiveInlineRead.timer);
      pendingEffectiveInlineRead.timer = null;
    }
    pendingEffectiveInlineRead = null;
    if (typingContentInvalidationTimer) {
      clearTimeout(typingContentInvalidationTimer);
      typingContentInvalidationTimer = null;
    }
    heavyReadGate.dispose();
    coldAsyncReadDeferrals.clear();
    for (const detach of detachers.splice(0)) detach();
    if (detachHostSelection) detachHostSelection();
    detachHostSelection = null;
    currentHostSelectionSource = null;
    if (detachEditCommands) detachEditCommands();
    detachEditCommands = null;
    currentEditCommandsSource = null;
    if (detachV2ReviewWindow) detachV2ReviewWindow();
    detachV2ReviewWindow = null;
    currentV2ReviewWindowSource = null;
    if (detachHostReview) detachHostReview();
    detachHostReview = null;
    currentHostReviewSource = null;
    if (detachHostEvents) detachHostEvents();
    detachHostEvents = null;
    currentHostEventsSource = null;
    if (detachDocumentSelection) detachDocumentSelection();
    detachDocumentSelection = null;
    currentDocumentSelectionSource = null;
    // Geometry was never released here. `observe()` hands back a disposer, but a
    // consumer that simply drops the controller left its subscription live on
    // the host: measured, destroy() with an active host detached nothing.
    for (const entry of geometryObservers) detachGeometryObserver(entry);
    geometryObservers.clear();
    listeners.clear();
    clearSearchListeners();
    // A format-painter capture that is mid-await outlives this call. Its
    // continuation re-checks the epoch before publishing, so bumping the epoch
    // is what actually stops it; guarding the handle's entry points only blocks
    // captures that have not started. Without this, a capture begun a moment
    // before teardown still reaches its listeners and calls back into UI that
    // has already unmounted.
    painterCaptureEpoch += 1;
    painterCommandDoc = null;
    painterModeListeners.clear();
    documentChangeListeners.clear();
    clearContentControlClickListeners();
    invalidateInFlightSearchRequests();
    customCommands.clear();
  };

  const controller: SuperDocUI = {
    select,
    get state() {
      return state;
    },
    selection,
    commands,
    toolbar,
    comments,
    trackChanges,
    contentControls,
    bookmarks,
    fonts,
    zoom,
    history,
    document: documentHandle,
    viewport,
    decorations,
    metadata,
    tables,
    search,
    contextMenu,
    watermark,
    styles,
    // Every entry point is disposal-guarded. This handle is the one place a
    // destroyed controller could still call back into application code:
    // `onModeChange` retains a listener and `cancel()` invokes it, so an
    // unguarded pair means a torn-down controller firing into a component that
    // has already unmounted.
    formatPainter: {
      setPointerSelecting(flag: boolean) {
        if (disposed) return;
        painter = { ...painter, pointerSelecting: flag };
      },
      notifyPointerUp() {
        if (disposed) return;
        painter = { ...painter, pointerSelecting: false };
        void maybeApply();
      },
      setKeyboardSelecting(flag: boolean) {
        if (disposed) return;
        painter = { ...painter, keyboardSelecting: flag };
      },
      notifyKeyUp() {
        if (disposed) return;
        painter = { ...painter, keyboardSelecting: false };
        void maybeApply();
      },
      cancel() {
        if (disposed) return;
        exitFormatPainter();
      },
      onModeChange(cb: (mode: FormatPainterMode) => void) {
        // Still returns an unsubscribe so callers need no disposal branch.
        if (disposed) return () => {};
        painterModeListeners.add(cb);
        return () => painterModeListeners.delete(cb);
      },
    } satisfies FormatPainterHandle,
    createScope,
    destroy,
  };
  controllerRef = controller;
  firstPartyCommandExecutors.set(controller, executeFirstPartyCommandAsync);
  firstPartyPageNumberReaders.set(controller, readPageNumbers);
  return controller;
}
