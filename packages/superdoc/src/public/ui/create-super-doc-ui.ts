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
import { sdRunPropsToInlineRunPatch, selectionKey } from './format-painter-helpers.js';
import { getV2TrackedChangeMutationImpact } from '../../helpers/v2-review-mutation-impact.js';
import { isV2EditableTextMutationEvent } from '../../helpers/v2-typing-mutation-event.js';
import {
  BUILT_IN_COMMAND_IDS,
  ALL_BUILT_IN_COMMAND_IDS,
  getCommandDescriptor,
  type CommandDescriptor,
  type TableCommandSpec,
  type TrackDecisionSpec,
} from './commands.js';
import { SUPERDOC_UI_REASONS, type SuperDocUIReason } from './reasons.js';
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
  ContentControlFocusResult,
  ContentControlHighlightResult,
  ContentControlsHandle,
  ContentControlsSlice,
  ContextMenuHandle,
  CustomCommandContext,
  CustomCommandHandle,
  CustomCommandRegistration,
  CustomCommandRegistrationResult,
  DocumentHandle,
  DocumentSlice,
  EqualityFn,
  FontFamilyOption,
  FontSizeOption,
  FontsHandle,
  FontsSlice,
  ListPresetId,
  SelectionInfo,
  SelectionHandle,
  SelectionSlice,
  SliceStatus,
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
  SearchController,
  SearchQueryOptions,
  SearchSnapshot,
  StylesHandle,
  StylesSlice,
  ActiveParagraphStyle,
  StyleCatalogItem,
  StyleCatalogDiagnostic,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
  TablesHandle,
  TableContextInfo,
  ToolbarHandle,
  ToolbarSnapshotSlice,
  TrackChangePointHit,
  TrackChangesHandle,
  TrackChangesItem,
  TrackChangesSlice,
  ViewportContext,
  ViewportEntityAddress,
  ViewportEntityHit,
  ViewportGetRectInput,
  MetadataHandle,
  PartialLinkEditReceipt,
  Receipt,
  SuperDocUIFailureReceipt,
  SuperDocUIReceipt,
  SuperDocUIReceiptFailureCode,
  ViewportHandle,
  ViewportRect,
  ViewportRectResult,
  WorkflowActionResult,
  WorkflowReceipt,
  WorkflowScrollResult,
  ZoomHandle,
  ZoomSlice,
} from './types.js';
import { collectEntityHitsFromChain } from './entity-at.js';
import { decodeLayoutStoryDataset } from '@superdoc/dom-contract';
import { getParagraphInlineDirection } from '@superdoc/contracts';
import { INLINE_PROPERTY_BY_KEY, type InlineRunPatchKey } from '@superdoc/document-api';

// ---------------------------------------------------------------------------
// Loose runtime views over the duck-typed host. The public types keep the
// host members `unknown`; internally we read them defensively.
// ---------------------------------------------------------------------------

type AnyFn = (...args: any[]) => any;
type LooseRecord = Record<string, any>;

type WorkerMessageBenchContext = {
  token: object;
  commandId: string;
  commandKind: string;
  messageType: 'result' | 'error';
  startedAtMs: number;
};

function uiBenchNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function readUiBenchRuntime(): {
  sink: ((event: Record<string, unknown>) => void) | null;
  workerContext: WorkerMessageBenchContext | null;
} {
  const benchGlobal = globalThis as typeof globalThis & {
    __superdocV2BenchPipelineTiming?: (event: Record<string, unknown>) => void;
    __superdocV2BenchWorkerMessageContext?: WorkerMessageBenchContext;
  };
  return {
    sink:
      typeof benchGlobal.__superdocV2BenchPipelineTiming === 'function'
        ? benchGlobal.__superdocV2BenchPipelineTiming
        : null,
    workerContext: benchGlobal.__superdocV2BenchWorkerMessageContext ?? null,
  };
}

function emitUiBenchTiming(event: Record<string, unknown>): void {
  const { sink } = readUiBenchRuntime();
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // Benchmark observation cannot change UI state computation.
  }
}

type SharedUiTrackedChangesCatalogState = {
  refCount: number;
  generation: number;
  abortController: AbortController;
  inFlight: {
    generation: number;
    promise: Promise<unknown>;
  } | null;
  activeMutationTokens: Set<string>;
};

// `SuperDoc.ui` and an application-created `createSuperDocUI({ superdoc })`
// controller are intentionally independent reactive controllers over the same
// host. Their product-owned all-story tracked-change read is not independent,
// however: issuing the same paged catalog twice creates a serialized worker
// convoy immediately before Accept All / Reject All. Share only that internal
// transport per host. Public `doc.trackChanges.list()` promises remain wholly
// outside this map and retain their existing ownership/cancellation behavior.
const sharedUiTrackedChangesCatalogByHost = new WeakMap<object, SharedUiTrackedChangesCatalogState>();

function acquireSharedUiTrackedChangesCatalog(host: object): SharedUiTrackedChangesCatalogState {
  let state = sharedUiTrackedChangesCatalogByHost.get(host);
  if (!state) {
    state = {
      refCount: 0,
      generation: 0,
      abortController: new AbortController(),
      inFlight: null,
      activeMutationTokens: new Set(),
    };
    sharedUiTrackedChangesCatalogByHost.set(host, state);
  }
  state.refCount += 1;
  return state;
}

function releaseSharedUiTrackedChangesCatalog(host: object, state: SharedUiTrackedChangesCatalogState): void {
  state.refCount = Math.max(0, state.refCount - 1);
  if (state.refCount > 0) return;
  state.abortController.abort('ui-controller-destroyed');
  state.inFlight = null;
  state.activeMutationTokens.clear();
  sharedUiTrackedChangesCatalogByHost.delete(host);
}

const SUPERDOC_UI_REASON_VALUES = new Set<string>(Object.values(SUPERDOC_UI_REASONS));

function coerceSuperDocUIReason(reason: unknown, fallback: SuperDocUIReason): SuperDocUIReason {
  return typeof reason === 'string' && SUPERDOC_UI_REASON_VALUES.has(reason) ? (reason as SuperDocUIReason) : fallback;
}

/**
 * Normalize the host selection apply helper's return value for
 * `selection.apply` / `selection.restore`: host `{ ok: false, reason }`
 * results pass through (unknown reasons coerce to `target-unresolved`);
 * anything else — including legacy void/boolean returns — counts as success.
 */
function normalizeHostSelectionApplyResult(result: unknown): WorkflowActionResult {
  if (result && typeof result === 'object') {
    const ok = (result as LooseRecord).ok;
    if (ok === false) {
      const reason = (result as LooseRecord).reason;
      // Host readiness failures are retryable; report them as not-ready
      // rather than target-unresolved (mirrors getSelectionApplyHelper).
      if (reason === 'host-not-ready' || reason === 'host-disposed' || reason === 'editing-mount-required') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      }
      return {
        ok: false,
        reason: coerceSuperDocUIReason(reason, SUPERDOC_UI_REASONS.targetUnresolved),
      };
    }
  }
  return { ok: true };
}

/** Lifecycle events the controller subscribes to. */
const HOST_EVENTS = [
  // Content changed under a stable editor identity, i.e. `replaceFile()`.
  // Distinct from `active-editor-change` on purpose: the host survives, so
  // host-scoped subscriptions must not be torn down.
  'document-replaced',
  'editorCreate',
  // `editorCreate` fires after `broadcastReady()`, and nothing emits it when
  // the active editor is cleared. This covers both edges so the snapshot
  // follows the live editor rather than the last one that started.
  'active-editor-change',
  'document-mode-change',
  'zoomChange',
  // A programmatic setMeasurementUnit emits this; recompute so the
  // measurement-unit command value reflects the live unit immediately
  // rather than waiting for an unrelated event.
  'measurement-unit-change',
  'viewport-change',
  // The v2 font runtime streams `fonts-changed` (initial / config-change / late-load / render-change)
  // through the SuperDoc instance. Recompute so the font-family slice reflects the live document
  // options after a map/add/preload or a late-loaded face, not just at editor creation.
  'fonts-changed',
] as const;

/**
 * row-862 — list toolbar ids routed through the v2 editor host edit-command
 * surface (`activeEditor.editCommands.lists.apply`) rather than a raw one-off
 * `doc.lists.apply` mutation, so readiness / mount / selection / read-only
 * gating and command state stay coherent with the rest of the editor chrome.
 */
const LIST_TOGGLE_KINDS: Record<string, 'bullet' | 'ordered'> = {
  [BUILT_IN_COMMAND_IDS.bulletList]: 'bullet',
  [BUILT_IN_COMMAND_IDS.numberedList]: 'ordered',
};

function listToggleKind(id: string): 'bullet' | 'ordered' | null {
  return LIST_TOGGLE_KINDS[id] ?? null;
}

/**
 * SD-3571 — the built-in toolbar's bullet/numbered style dropdowns emit a bare
 * toolbar style-key string (e.g. `'upper-roman'`, `'decimal-paren'`) as the
 * command argument. Map each to the Document API `ListPresetId` so the chosen
 * glyph/number format actually applies instead of being dropped to the default
 * decimal/disc list. Keys mirror `internal/toolbar/built-in/list-style-buttons.js`
 * (asserted by a coverage test); the public command surface also still accepts
 * an options object with an explicit `preset`.
 */
const TOOLBAR_LIST_STYLE_PRESETS: Record<string, ListPresetId> = {
  disc: 'disc',
  circle: 'circle',
  square: 'square',
  decimal: 'decimal',
  'decimal-paren': 'decimalParenthesis',
  'upper-roman': 'upperRoman',
  'lower-roman': 'lowerRoman',
  'upper-alpha': 'upperLetter',
  'upper-alpha-paren': 'upperLetterParenthesis',
  'lower-alpha': 'lowerLetter',
  'lower-alpha-paren': 'lowerLetterParenthesis',
};

function presetFromToolbarStyleKey(styleKey: string): { preset?: ListPresetId; behavior?: 'toggleStyle' } {
  const preset = TOOLBAR_LIST_STYLE_PRESETS[styleKey];
  // Style-dropdown picks are variant-aware: re-picking the active style toggles
  // the list off, picking a different one switches the whole list to it. The
  // main split-button (non-string payload) keeps the default kind-level 'toggle'.
  return preset ? { preset, behavior: 'toggleStyle' } : {};
}
const EMPTY_SELECTION: SelectionSlice = {
  status: 'ready',
  empty: true,
  target: null,
  selectionTarget: null,
  activeMarks: [],
  activeCommentIds: [],
  activeChangeIds: [],
  quotedText: '',
};

/**
 * Heavy-read policy for the async read coordinator (source-loading deferral).
 * One shared table: the coordinator's gate and the table-driven policy tests
 * both consume THIS list, so the deferred set cannot silently drift from the
 * tested set. Keys are coordinator cache keys (exact) or key families
 * (prefix). See the gate in `readAsync` for the runtime semantics.
 */
export interface HeavyDocReadPolicyEntry {
  key: string;
  match: 'exact' | 'prefix';
  /** Audit rationale — why this key is catalog-scale (or reserved). */
  note: string;
}

export const HEAVY_DOC_READ_POLICY: readonly HeavyDocReadPolicyEntry[] = [
  // Current issuers in this controller.
  { key: 'contentControls', match: 'exact', note: 'full-document SDT catalog parse (the measured during-load cliff)' },
  {
    key: 'contentControls:inRange:',
    match: 'prefix',
    note: 'same adapter load() as the catalog, issued per settled selection',
  },
  { key: 'hyperlinks:', match: 'prefix', note: 'per-block hyperlink list over the loading story' },
  { key: 'styles:catalog:', match: 'prefix', note: 'WordStyleModel recompile from package bytes' },
  { key: 'comments', match: 'exact', note: 'audited: full comments list; stale-served during load' },
  {
    key: 'trackChanges',
    match: 'exact',
    note: 'audited: shared all-story tracked-changes catalog; stale-served during load',
  },
  {
    key: 'trackChanges:all',
    match: 'exact',
    note: 'audited: current-token validation over the shared all-story catalog; consumers fail closed on non-ready',
  },
  // No issuer in this controller today; reserved so future table/section
  // slices inherit the policy (and its tests) instead of re-opening the class.
  { key: 'tables', match: 'exact', note: 'reserved: full tables catalog' },
  { key: 'sections', match: 'exact', note: 'reserved: full sections list' },
];

const COMMENTS_CATALOG_PART_URIS: ReadonlySet<string> = new Set([
  '/word/comments.xml',
  '/word/commentsExtended.xml',
  '/word/commentsIds.xml',
]);

/** Whether a coordinator cache key falls under the heavy-read policy. */
export function isHeavyDocReadKey(key: string): boolean {
  return HEAVY_DOC_READ_POLICY.some((entry) =>
    entry.match === 'exact' ? entry.key === key : key.startsWith(entry.key),
  );
}

/** Status precedence: a combined status is as "unsettled" as its worst part. */
const STATUS_RANK: Record<SliceStatus, number> = { ready: 0, stale: 1, pending: 2 };

/** Combine read statuses; `pending` (no data yet) dominates `stale`, which dominates `ready`. */
function combineStatus(...statuses: readonly SliceStatus[]): SliceStatus {
  let worst: SliceStatus = 'ready';
  for (const status of statuses) {
    if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  }
  return worst;
}

function safeCall<T>(fn: (() => T) | undefined, fallback: T): T {
  if (typeof fn !== 'function') return fallback;
  try {
    const result = fn();
    return result === undefined ? fallback : result;
  } catch {
    return fallback;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    Boolean(value) &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Resolve a dotted path (e.g. `format.bold`) to a callable on the doc facade. */
function resolveDocOperation(doc: LooseRecord | null, path: string): AnyFn | null {
  if (!doc) return null;
  const parts = path.split('.');
  let cursor: any = doc;
  for (const part of parts) {
    if (cursor == null) return null;
    cursor = cursor[part];
  }
  return typeof cursor === 'function' ? (cursor as AnyFn) : null;
}

function failedReceipt(
  message: string,
  code: Exclude<SuperDocUIReceiptFailureCode, 'PARTIAL_LINK_EDIT'> = 'CAPABILITY_UNAVAILABLE',
): SuperDocUIFailureReceipt {
  return {
    success: false,
    failure: {
      code,
      message,
    },
  };
}

function partialLinkEditFailure(
  hyperlinkResult: CommandExecutionResult,
  textResult: CommandExecutionResult,
): PartialLinkEditReceipt {
  return {
    success: false,
    failure: {
      code: 'PARTIAL_LINK_EDIT',
      message: 'Hyperlink target was updated, but display text replacement failed.',
    },
    applied: { href: true, text: false },
    hyperlinkResult,
    textResult,
  };
}

/** Read a stable public `target` off a doc-api entity row. */
function readEntityTarget(row: unknown): unknown | null {
  if (!row || typeof row !== 'object') return null;
  const target = (row as LooseRecord).target;
  return target && typeof target === 'object' ? target : null;
}

function isHostGeometryTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const record = target as LooseRecord;
  const isTextPoint = (point: unknown): boolean => {
    if (!point || typeof point !== 'object') return false;
    const candidate = point as LooseRecord;
    return candidate.kind === 'text' && typeof candidate.blockId === 'string' && typeof candidate.offset === 'number';
  };
  const isTextSegment = (segment: unknown): boolean => {
    if (!segment || typeof segment !== 'object') return false;
    const candidate = segment as LooseRecord;
    const range = candidate.range as LooseRecord | undefined;
    return typeof candidate.blockId === 'string' && typeof range?.start === 'number' && typeof range.end === 'number';
  };

  if (Array.isArray(record.segments)) {
    const first = record.segments[0];
    const last = record.segments[record.segments.length - 1];
    return isTextSegment(first) && isTextSegment(last);
  }
  if (record.kind === 'selection') {
    return isTextPoint(record.start) && isTextPoint(record.end);
  }
  if (record.kind !== 'text' || typeof record.blockId !== 'string') return false;
  const range = record.range as LooseRecord | undefined;
  return typeof range?.start === 'number' && typeof range.end === 'number';
}

/**
 * Convert the tracked-change catalog's document-stable block address into the
 * text address accepted by the host geometry surface. Keeping the entity
 * address lets the host prefer the exact painted review carrier after the
 * containing block has been materialized.
 */
function readTrackedChangeNavigationTarget(row: unknown, options?: { preferStableBlock?: boolean }): unknown | null {
  if (!row || typeof row !== 'object') return null;
  const target = readEntityTarget(row);
  const record = row as LooseRecord;
  const navigationTarget =
    record.navigationTarget && typeof record.navigationTarget === 'object'
      ? (record.navigationTarget as LooseRecord)
      : null;
  if (
    navigationTarget?.kind === 'block' &&
    typeof navigationTarget.blockId === 'string' &&
    navigationTarget.blockId.length > 0
  ) {
    const stableBlockTarget = {
      kind: 'text',
      blockId: navigationTarget.blockId,
      range: { start: 0, end: 0 },
      ...(navigationTarget.story && typeof navigationTarget.story === 'object'
        ? { story: navigationTarget.story }
        : {}),
      ...(record.address && typeof record.address === 'object' ? { address: record.address } : {}),
    };
    if (options?.preferStableBlock || !isHostGeometryTarget(target)) return stableBlockTarget;
  }
  return target;
}

function storyLocatorSignature(story: unknown): string {
  if (!story || typeof story !== 'object') return 'story:body';
  const record = story as LooseRecord;
  const storyType = typeof record.storyType === 'string' ? record.storyType : 'body';
  switch (storyType) {
    case 'body':
      return 'story:body';
    case 'headerFooterPart':
      return `story:headerFooterPart:${typeof record.refId === 'string' ? record.refId : ''}`;
    case 'headerFooterSlot':
      return JSON.stringify({
        storyType,
        section: record.section ?? null,
        headerFooterKind: record.headerFooterKind ?? null,
        variant: record.variant ?? null,
        resolution: record.resolution ?? 'effective',
        onWrite: record.onWrite ?? 'materializeIfInherited',
      });
    case 'footnote':
      return `story:footnote:${typeof record.noteId === 'string' ? record.noteId : ''}`;
    case 'endnote':
      return `story:endnote:${typeof record.noteId === 'string' ? record.noteId : ''}`;
    case 'textbox':
      return `story:textbox:${typeof record.textboxId === 'string' ? record.textboxId : ''}`;
    default:
      return JSON.stringify(record);
  }
}

function readEntityStory(row: unknown): unknown | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as LooseRecord;
  const address = record.address && typeof record.address === 'object' ? (record.address as LooseRecord) : null;
  if (address?.story && typeof address.story === 'object') return address.story;
  if (record.storyLocator && typeof record.storyLocator === 'object') return record.storyLocator;
  if (record.trackedChangeStory && typeof record.trackedChangeStory === 'object') return record.trackedChangeStory;
  const target = readEntityTarget(row);
  if (!target || typeof target !== 'object') return null;
  const targetRecord = target as LooseRecord;
  if (targetRecord.story && typeof targetRecord.story === 'object') return targetRecord.story;
  const targetAddress =
    targetRecord.address && typeof targetRecord.address === 'object' ? (targetRecord.address as LooseRecord) : null;
  return targetAddress?.story && typeof targetAddress.story === 'object' ? targetAddress.story : null;
}

function entityRowMatchesRequest(row: unknown, id: string, story?: unknown): boolean {
  if (readEntityId(row) !== id) return false;
  if (!story) return true;
  return storyLocatorSignature(readEntityStory(row)) === storyLocatorSignature(story);
}

/**
 * Story to thread through a navigation / scroll request for a loaded list row:
 * the row's own non-body story, or `undefined` for body / story-less rows.
 * Mirrors `getAt`, which omits body stories from its hits, so body-only
 * documents keep their id-only matching byte-for-byte unchanged while a
 * non-body row (footnote / endnote / header / footer) pins target and carrier
 * resolution to its own story — an id repeated across stories can no longer
 * resolve to another story's occurrence (IT-1250).
 */
function readEntityRequestStory(row: unknown): unknown | undefined {
  const story = readEntityStory(row);
  if (!story || storyLocatorSignature(story) === storyLocatorSignature(null)) return undefined;
  return story;
}

/**
 * Bridge a painter `data-layout-story` value to the public Document API
 * {@link StoryLocator} shape the controller's story-aware matchers speak.
 *
 * The painter encodes the layout story as `"body"` or `"<kind>:<id>"`;
 * `decodeLayoutStoryDataset` turns that back into `{ kind, id }`. Tracked-change
 * rows, however, carry a Document API `StoryLocator` (`{ kind: 'story',
 * storyType, noteId | refId }`), and `storyLocatorSignature` keys on
 * `storyType`, so the two forms must be reconciled before they can be compared.
 * Body, unknown, and id-less stories all return `undefined` so callers fall back
 * to id-only matching and never stamp a story onto the public hit — that keeps
 * body-only documents byte-for-byte unchanged. Story disambiguation only kicks
 * in for the non-body stories (footnote, endnote, header/footer) that can repeat
 * a tracked-change id across stories.
 */
function layoutStoryDatasetToStoryLocator(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const decoded = decodeLayoutStoryDataset(raw);
  switch (decoded.kind) {
    case 'body':
      return undefined;
    case 'footnote':
      return decoded.id ? { kind: 'story', storyType: 'footnote', noteId: decoded.id } : undefined;
    case 'endnote':
      return decoded.id ? { kind: 'story', storyType: 'endnote', noteId: decoded.id } : undefined;
    case 'header':
    case 'footer':
      return decoded.id ? { kind: 'story', storyType: 'headerFooterPart', refId: decoded.id } : undefined;
    default:
      return undefined;
  }
}

/**
 * Bridge a painter `data-story-key` value to the public Document API
 * {@link StoryLocator} shape. PREFERRED over {@link layoutStoryDatasetToStoryLocator}
 * for tracked changes: the run/marker element carries the real owning story in
 * `data-story-key` (`'body'`, `'fn:<noteId>'`, `'en:<noteId>'`,
 * `'hf:part:<refId>'`), while the layout fragment's `data-layout-story` falls
 * back to `'body'` for the footnote/endnote band — so reading only the layout
 * story loses the story identity needed to disambiguate repeated source ids.
 *
 * Split on the FIRST delimiter group only: the `fn:`/`en:` id and the `hf:part:`
 * refId are taken verbatim after their prefix, so an id that itself contains a
 * colon survives intact. The resulting shapes match what `storyLocatorSignature`
 * keys on and what the all-story `list({ in: 'all' })` rows carry. Body, empty,
 * and unknown keys return `undefined` so callers fall back to id-only matching
 * and body-only documents stay byte-for-byte unchanged.
 */
function storyKeyToStoryLocator(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0 || raw === 'body') return undefined;
  if (raw.startsWith('hf:part:')) {
    const refId = raw.slice('hf:part:'.length);
    return refId ? { kind: 'story', storyType: 'headerFooterPart', refId } : undefined;
  }
  if (raw.startsWith('fn:')) {
    const noteId = raw.slice('fn:'.length);
    return noteId ? { kind: 'story', storyType: 'footnote', noteId } : undefined;
  }
  if (raw.startsWith('en:')) {
    const noteId = raw.slice('en:'.length);
    return noteId ? { kind: 'story', storyType: 'endnote', noteId } : undefined;
  }
  return undefined;
}

/** Read a public `selectionTarget` off a content-control row when available. */
function readSelectionTarget(row: unknown): unknown | null {
  if (!row || typeof row !== 'object') return null;
  const target = (row as LooseRecord).selectionTarget;
  return target && typeof target === 'object' ? target : null;
}

function readContentControlRequestId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const id = (input as LooseRecord).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function collapseSelectionTargetToCaret(target: unknown): SelectionTarget | null {
  if (!target || typeof target !== 'object') return null;
  const record = target as LooseRecord;
  if (record.kind !== 'selection') return target as SelectionTarget;
  const start = record.start;
  if (!start || typeof start !== 'object') return null;
  return { ...record, end: start } as SelectionTarget;
}

/** Read a stable public row id from discovery/list/detail shapes. */
function readEntityId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as LooseRecord;
  const id = record.id ?? record.commentId ?? record.changeId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function identityText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Same id/email-first OWN rule as editor-core `classifyOwnership`. */
function trackedChangeOwnedByCurrentUser(change: LooseRecord, currentUser: LooseRecord | null): boolean {
  const user = currentUser ?? {};
  const currentId = identityText(user.id).toLowerCase();
  const authorId = identityText(change.authorId).toLowerCase();
  if (currentId && authorId) return currentId === authorId;
  const currentEmail = identityText(user.email).toLowerCase();
  const authorEmail = identityText(change.authorEmail).toLowerCase();
  if (currentEmail && authorEmail) return currentEmail === authorEmail;
  if (currentId || currentEmail || authorId || authorEmail) return false;
  const authorName = identityText(change.author).replace(/\s+/g, ' ').toLowerCase();
  if (!authorName) return true;
  const currentName = identityText(user.name).replace(/\s+/g, ' ').toLowerCase();
  return Boolean(currentName && currentName === authorName);
}

/**
 * Read the tracked-change carrier shared by both ends of a collapsed host
 * selection. Unlike the public sync seed, this painted caret metadata is
 * available without a worker read and proves that the caret still belongs to
 * the same review carrier.
 */
function readCollapsedHostTrackChangeId(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const record = snapshot as LooseRecord;
  const anchor = record.anchor as LooseRecord | undefined;
  const focus = record.focus as LooseRecord | undefined;
  const anchorVisual = anchor?.visualCaret as LooseRecord | undefined;
  const focusVisual = focus?.visualCaret as LooseRecord | undefined;
  const anchorId = anchorVisual?.trackChangeId;
  const focusId = focusVisual?.trackChangeId;
  return typeof anchorId === 'string' && anchorId.length > 0 && anchorId === focusId ? anchorId : null;
}

/**
 * Resolve a painted/raw tracked-change id to the public {@link TrackChangesItem}
 * id it belongs to, and enumerate every raw alias for a public id.
 *
 * The painter can stamp a tracked-change run with a source-level *alias* rather
 * than the canonical public id: a del+ins replacement is ONE logical list item
 * (`id: "tc|…|replacement|…|27|…|28"`) but its two run spans are keyed off the
 * raw Word `w:id` (`imported:27` / `imported:28`) when the change's annotation
 * has not been threaded into the projection yet. The public `getAt`/`setActive`/
 * `entityAt` surface matches painted ids directly against the list, so without a
 * reconciliation map a click on the deleted side resolves to an id no list item
 * carries and activation silently fails. This context maps every provenance id
 * a list item exposes (`sourceIds.wordId*`, `wordRevisionIds.*`, replacement /
 * move side ids and their `wordId`s), plus the `imported:<id>` painter form, back
 * to the item's public id. Ported from v1 SD-3469 (`buildTrackedChangeCanonicalIdMap`).
 */
interface TrackedChangeIdContext {
  /** Map a painted/raw tracked-change id to the public list id, or `null`. */
  toPublicId(rawId: string): string | null;
  /** The public id plus every raw alias that resolves to it (rect fallback). */
  aliasesFor(publicId: string): readonly string[];
}

// Memoized per items-array identity: the trackChanges slice hands out a stable
// array per content revision, so the same click stream reuses one context.
const trackedChangeIdContextCache = new WeakMap<readonly unknown[], TrackedChangeIdContext>();

/**
 * Collect the raw source-provenance ids a tracked-change list item exposes,
 * reading from both the top-level row and its nested `change` payload (the
 * public projection surfaces provenance on either shape).
 */
function readTrackChangeProvenanceIds(item: unknown): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0 && !out.includes(value)) out.push(value);
  };
  const scan = (rec: unknown): void => {
    if (!rec || typeof rec !== 'object') return;
    const record = rec as LooseRecord;
    const sourceIds = record.sourceIds as LooseRecord | undefined;
    if (sourceIds && typeof sourceIds === 'object') {
      push(sourceIds.wordIdInsert);
      push(sourceIds.wordIdDelete);
      if (Array.isArray(sourceIds.wordIdOther)) for (const w of sourceIds.wordIdOther) push(w);
    }
    const wordRevisionIds = record.wordRevisionIds as LooseRecord | undefined;
    if (wordRevisionIds && typeof wordRevisionIds === 'object') {
      push(wordRevisionIds.insert);
      push(wordRevisionIds.delete);
      push(wordRevisionIds.format);
    }
    const replacement = record.replacement as LooseRecord | undefined;
    if (replacement && typeof replacement === 'object') {
      for (const side of [replacement.inserted, replacement.deleted]) {
        if (side && typeof side === 'object') {
          push((side as LooseRecord).id);
          push((side as LooseRecord).wordId);
        }
      }
    }
    const move = record.move as LooseRecord | undefined;
    if (move && typeof move === 'object') {
      for (const side of [move.source, move.destination]) {
        if (side && typeof side === 'object') {
          push((side as LooseRecord).id);
          push((side as LooseRecord).wordId);
        }
      }
    }
  };
  scan(item);
  const change = (item as LooseRecord | null)?.change;
  if (change && change !== item) scan(change);
  return out;
}

/** Build (or reuse) the alias↔canonical context for a tracked-change list slice. */
function buildTrackedChangeIdContext(items: readonly unknown[]): TrackedChangeIdContext {
  const cached = trackedChangeIdContextCache.get(items);
  if (cached) return cached;
  const itemIds = new Set<string>();
  const canonicalByAlias = new Map<string, string>();
  for (const item of items) {
    const publicId = readEntityId(item);
    if (!publicId) continue;
    itemIds.add(publicId);
    for (const raw of readTrackChangeProvenanceIds(item)) {
      // A real public id is never overridden by an alias (`toPublicId` also
      // checks `itemIds` first); the raw Word id and the painter's
      // `imported:<id>` form both point back to this item's public id.
      if (!canonicalByAlias.has(raw)) canonicalByAlias.set(raw, publicId);
      const prefixed = `imported:${raw}`;
      if (!canonicalByAlias.has(prefixed)) canonicalByAlias.set(prefixed, publicId);
    }
  }
  const context: TrackedChangeIdContext = {
    toPublicId(rawId) {
      if (itemIds.has(rawId)) return rawId;
      const canonical = canonicalByAlias.get(rawId);
      return canonical != null && itemIds.has(canonical) ? canonical : null;
    },
    aliasesFor(publicId) {
      const out: string[] = [publicId];
      for (const [alias, canonical] of canonicalByAlias) {
        if (canonical === publicId && !out.includes(alias)) out.push(alias);
      }
      return out;
    },
  };
  trackedChangeIdContextCache.set(items, context);
  return context;
}

// Per (items-array, story-signature) memo of story-scoped id contexts, so a
// click stream over the same stable slice + story reuses one context.
const storyScopedTrackedChangeIdContextCache = new WeakMap<readonly unknown[], Map<string, TrackedChangeIdContext>>();

// Keyed on the catalog it was derived from, so the filtered array keeps a stable
// identity across recomputes. Without this, filtering per recompute handed the
// caches below a fresh array every caret move and every alias map was rebuilt.
const declaredBodyItemsCache = new WeakMap<readonly unknown[], readonly unknown[]>();

/**
 * Alias↔canonical context scoped to the rows in a single `story`.
 *
 * {@link buildTrackedChangeIdContext} keys aliases purely on the raw Word
 * `w:id` / `imported:<id>` painter form, so when body / footnote / header
 * changes reuse the same `w:id`, the first row inserted wins the alias for
 * EVERY story. A click in a later story would then map through
 * `toPublicId` to the first story's public id and get dropped by the
 * subsequent `entityRowMatchesRequest(..., story)` check (or focus the wrong
 * same-story split). Restricting the alias map to same-story candidates keeps
 * each story's ids independent so the reconciliation resolves within the
 * painted story. Falls back to id-only when the row carries no comparable story.
 */
function buildStoryScopedTrackedChangeIdContext(items: readonly unknown[], story: unknown): TrackedChangeIdContext {
  const signature = storyLocatorSignature(story);
  let byStory = storyScopedTrackedChangeIdContextCache.get(items);
  if (!byStory) {
    byStory = new Map();
    storyScopedTrackedChangeIdContextCache.set(items, byStory);
  }
  const cached = byStory.get(signature);
  if (cached) return cached;
  const scoped = items.filter((item) => storyLocatorSignature(readEntityStory(item)) === signature);
  const context = buildTrackedChangeIdContext(scoped);
  byStory.set(signature, context);
  return context;
}

function isTextboxStory(story: unknown): boolean {
  return !!story && typeof story === 'object' && (story as LooseRecord).storyType === 'textbox';
}

/**
 * Resolve a textbox selection against rows that carry no story locator.
 *
 * Textbox rows arrive from the v2 adapter without a comparable locator, but body
 * rows omit theirs too (body is the documented default). A missing story is
 * therefore not proof of textbox ownership: when a textbox change and a body
 * change reuse one Word revision id, live selection can supply both canonical
 * ids, and taking the first story-less match would publish whichever the catalog
 * happened to list first.
 *
 * The signal is a shared revision id, not a count. A selection spanning several
 * independent changes in one textbox is ordinary — those ids describe different
 * revisions and the first is the right active one. Two ids tracing back to the
 * same revision id are the ambiguous case, and that fails closed.
 */
function resolveStorylessCanonicalTrackedChangeId(
  items: readonly unknown[],
  selectionIds: readonly string[],
): string | null {
  const storyless = selectionIds.filter((id) =>
    items.some((item) => readEntityId(item) === id && readEntityStory(item) == null),
  );
  if (storyless.length === 0) return null;
  if (storyless.length === 1) return storyless[0];

  // Ambiguous only when two candidates share provenance: that is the collision
  // that makes "which occurrence?" unanswerable from the catalog alone.
  const seen = new Set<string>();
  for (const id of storyless) {
    const row = items.find((item) => readEntityId(item) === id);
    if (!row) continue;
    for (const raw of readTrackChangeProvenanceIds(row)) {
      if (seen.has(raw)) return null;
      seen.add(raw);
    }
  }
  return storyless[0];
}

/**
 * Keep only rows that explicitly declare a story locator.
 *
 * A missing locator is not the same claim as `{ storyType: 'body' }`, but both
 * share the body story signature. Filtering the undeclared rows out keeps a body
 * selection from aliasing onto one of them.
 */
function declaredBodyItems(items: readonly unknown[]): readonly unknown[] {
  const cached = declaredBodyItemsCache.get(items);
  if (cached) return cached;
  const declared = items.filter((item) => readEntityStory(item) != null);
  // Reuse the input when nothing was filtered: same contents, and it keeps the
  // downstream caches keyed on an array they have already seen.
  const result = declared.length === items.length ? items : declared;
  declaredBodyItemsCache.set(items, result);
  return result;
}

/**
 * Map `selection.activeChangeIds` to a public tracked-change id for
 * `TrackChangesSlice.activeId`.
 *
 * Prefer the live selection's story against the all-story catalog so a
 * footnote/header/footer alias that reuses a Word revision id cannot resolve
 * to a colliding body change. Unscoped body mapping is only for body
 * selection. While the all-story catalog is unsettled for a non-body
 * selection, keep activeId null rather than publishing an unvalidated raw
 * painter alias or canonical-looking id.
 */
function resolveSelectionActiveChangeId(options: {
  selectionIds: readonly string[];
  /**
   * The same ids after the caller's story-scoped pre-mapping. A row already
   * resolved to a public id needs no alias lookup, so trying the pre-mapped value
   * first keeps this resolver's guards meaningful once that mapping has run.
   */
  publicIds?: readonly string[];
  selection: SelectionSlice;
  bodyItems: readonly unknown[];
  allStoryItems: readonly unknown[] | null;
}): string | null {
  const { selectionIds, publicIds, selection, bodyItems, allStoryItems } = options;
  if (selectionIds.length === 0) return null;

  const mapIds = (context: TrackedChangeIdContext): string | null => {
    for (const id of selectionIds) {
      const publicId = context.toPublicId(id);
      if (publicId) return publicId;
    }
    return null;
  };

  const story = selectionStory(selection);
  const isBodySelection = storyLocatorSignature(story) === storyLocatorSignature(null);

  if (allStoryItems) {
    // A body selection must only alias against rows that actually declare body
    // scope. `storyLocatorSignature(null)` is the body signature, so a row that
    // arrives without a locator at all — notably a textbox row from the v2
    // adapter — otherwise lands in the body bucket and a shared Word revision id
    // resolves the body selection to that textbox change.
    const scopedItems = isBodySelection ? declaredBodyItems(allStoryItems) : allStoryItems;
    const scoped = buildStoryScopedTrackedChangeIdContext(scopedItems, story);
    const fromStory = mapIds(scoped);
    if (fromStory) return fromStory;
    // A pre-mapped public id that exists in the settled catalog for this story is
    // already the answer; only fall through when it is not a real row. Search the
    // same catalog the alias mapping above used, so a body selection cannot match a
    // row this filter excluded: `entityRowMatchesRequest` treats a missing story as
    // body, which would otherwise let a story-less row back in through this path.
    const fromPublic = publicIds?.find((id) => scopedItems.some((item) => entityRowMatchesRequest(item, id, story)));
    if (fromPublic) return fromPublic;
    if (!isBodySelection) {
      // Textbox tracked-change rows currently arrive from the v2 adapter
      // without a comparable story locator. Keep a direct public-id match from
      // the settled all-story catalog, but do not run unscoped alias mapping:
      // aliases are exactly where body/non-body Word revision id collisions
      // become unsafe.
      return isTextboxStory(story) ? resolveStorylessCanonicalTrackedChangeId(allStoryItems, selectionIds) : null;
    }
    return mapIds(buildTrackedChangeIdContext(bodyItems));
  }

  if (isBodySelection) {
    return mapIds(buildTrackedChangeIdContext(bodyItems)) ?? selectionIds[0] ?? null;
  }

  return null;
}

/**
 * Resolve a requested comment activation id to its thread's canonical active
 * id. Accepts a bare `id`, the `importedId` v2 minted when it had to repair
 * a malformed/duplicated source comment id on import, or a reply's id - all
 * resolve to the same thread-root comment, matching main's accepted aliases
 * for `ui.comments.setActive`. Returns `null` when `commentId` matches no
 * currently loaded comment under either alias.
 */
function resolveActiveCommentId(items: readonly CommentInfo[], commentId: string): string | null {
  const item = items.find((candidate) => readEntityId(candidate) === commentId || candidate.importedId === commentId);
  if (!item) return null;
  // Replies only ever target an existing thread root (comments.reply takes no
  // nested parentCommentId), so a reply row's parentCommentId is itself the
  // thread root even on rows where rootCommentId wasn't populated.
  return item.rootCommentId ?? item.parentCommentId ?? readEntityId(item) ?? commentId;
}

/** Derive a `{ startBlockId, endBlockId }` block range from a selection slice. */
function selectionBlockRange(selection: SelectionSlice): { startBlockId: string; endBlockId: string } | null {
  const sel = selection.selectionTarget as LooseRecord | null;
  if (sel) {
    const start = sel.start as LooseRecord | undefined;
    const end = sel.end as LooseRecord | undefined;
    const startBlockId = typeof start?.blockId === 'string' ? start.blockId : undefined;
    const endBlockId = typeof end?.blockId === 'string' ? end.blockId : startBlockId;
    if (startBlockId) return { startBlockId, endBlockId: endBlockId ?? startBlockId };
  }
  const target = selection.target as LooseRecord | null;
  const segments = target && Array.isArray(target.segments) ? (target.segments as LooseRecord[]) : [];
  const first = segments[0]?.blockId;
  const last = segments[segments.length - 1]?.blockId;
  if (typeof first === 'string') {
    return { startBlockId: first, endBlockId: typeof last === 'string' ? last : first };
  }
  return null;
}

/**
 * Distinct block ids the selection covers, in document order. In the v2 adapter
 * the selection's `blockId` is the same identifier the public block operations
 * accept as `nodeId` (both resolve to the OOXML `paraId`), so these are valid
 * `nodeId`s for `format.paragraph.*` / `styles.paragraph.*` / `lists.*`.
 *
 * A collapsed caret still yields its containing block id (the v2
 * `selection.current` returns a zero-length text segment), so paragraph/list
 * commands work from a caret — they do not require a range selection.
 */
function selectionBlockIds(selection: SelectionSlice): string[] {
  const ids: string[] = [];
  const push = (id: unknown) => {
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
  };
  const target = selection.target as LooseRecord | null;
  const segments = target && Array.isArray(target.segments) ? (target.segments as LooseRecord[]) : [];
  for (const segment of segments) push(segment?.blockId);
  const sel = selection.selectionTarget as LooseRecord | null;
  if (sel) {
    push((sel.start as LooseRecord | undefined)?.blockId);
    push((sel.end as LooseRecord | undefined)?.blockId);
  }
  return ids;
}

// Reactive command state is recomputed on every selection update. Per-block
// metadata reads are useful for ordinary ranges, but issuing one worker request
// per block for a document-wide selection can starve the authoritative
// selection read itself. Large selections keep their range target and inline
// uniformity path; metadata that requires probing every paragraph fails closed.
const MAX_REACTIVE_SELECTION_BLOCK_READS = 64;

function canProbeEverySelectedBlock(blockIds: readonly string[]): boolean {
  return blockIds.length <= MAX_REACTIVE_SELECTION_BLOCK_READS;
}

/** Resolve the selection's story, defaulting to the main body story. */
function selectionStory(selection: SelectionSlice): LooseRecord {
  const target = selection.target as LooseRecord | null;
  const explicit = selection.selectionTarget as LooseRecord | null;
  const start = explicit?.start as LooseRecord | undefined;
  const end = explicit?.end as LooseRecord | undefined;
  const story = target?.story ?? explicit?.story ?? start?.story ?? end?.story;
  return story && typeof story === 'object' ? (story as LooseRecord) : { kind: 'story', storyType: 'body' };
}

/** Build a `ParagraphTarget` ( `format.paragraph.*` / `styles.paragraph.*` ). */
function paragraphTarget(blockId: string, story?: unknown): LooseRecord {
  return {
    kind: 'block',
    nodeType: 'paragraph',
    nodeId: blockId,
    ...(story && typeof story === 'object' ? { story } : {}),
  };
}

/** Build a `ListsBlockTarget` ( `lists.apply` / `lists.remove` / `lists.getState` ). */
function listsBlockTarget(blockId: string): LooseRecord {
  return {
    kind: 'block',
    nodeType: 'paragraph',
    nodeId: blockId,
  };
}

/** Build a `ListItemAddress` ( `lists.indent` / `lists.outdent` / `lists.applyStyle` ). */
function listItemTarget(blockId: string, story?: unknown): LooseRecord {
  return {
    kind: 'block',
    nodeType: 'listItem',
    nodeId: blockId,
    ...(story && typeof story === 'object' ? { story } : {}),
  };
}

const PARAGRAPH_INDENT_STEP_TWIPS = 720;

type ParagraphIndentationTwips = {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
};

function pointsToTwips(value: number): number {
  return Math.round(value * 20);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readParagraphIndentationFromResult(result: unknown): ParagraphIndentationTwips | null {
  if (!result || typeof result !== 'object') return null;
  const node = (result as LooseRecord).node as LooseRecord | undefined;
  if (!node || typeof node !== 'object') return null;
  const paragraphPayload =
    node.kind === 'heading'
      ? ((node.heading as LooseRecord | undefined) ?? null)
      : node.kind === 'paragraph'
        ? ((node.paragraph as LooseRecord | undefined) ?? null)
        : null;
  if (!paragraphPayload) return null;
  const resolved = paragraphPayload.resolved as LooseRecord | undefined;
  const props = paragraphPayload.props as LooseRecord | undefined;
  const indent = (resolved?.indent as LooseRecord | undefined) ?? (props?.indent as LooseRecord | undefined);
  if (!indent || typeof indent !== 'object') return null;

  const left = isFiniteNumber(indent.left)
    ? pointsToTwips(indent.left)
    : isFiniteNumber(indent.start)
      ? pointsToTwips(indent.start)
      : undefined;
  const right = isFiniteNumber(indent.right)
    ? pointsToTwips(indent.right)
    : isFiniteNumber(indent.end)
      ? pointsToTwips(indent.end)
      : undefined;
  const firstLine = isFiniteNumber(indent.firstLine) ? pointsToTwips(indent.firstLine) : undefined;
  const hanging = isFiniteNumber(indent.hanging) ? pointsToTwips(indent.hanging) : undefined;
  if (left == null && right == null && firstLine == null && hanging == null) return null;
  return {
    ...(left != null ? { left } : {}),
    ...(right != null ? { right } : {}),
    ...(firstLine != null ? { firstLine } : {}),
    ...(hanging != null ? { hanging } : {}),
  };
}

/** Build one `TextAddress` per covered text segment for `hyperlinks.wrap`. */
function selectionTextAddresses(selection: SelectionSlice): LooseRecord[] {
  const target = selection.target as LooseRecord | null;
  const segments = target && Array.isArray(target.segments) ? (target.segments as LooseRecord[]) : [];
  const story = target?.story;
  const addresses: LooseRecord[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment.blockId !== 'string') continue;
    const range = segment.range as LooseRecord | undefined;
    if (!range || typeof range.start !== 'number' || typeof range.end !== 'number' || range.start === range.end) {
      continue;
    }
    addresses.push({
      kind: 'text',
      blockId: segment.blockId,
      range: { start: range.start, end: range.end },
      ...(story ? { story } : {}),
    });
  }
  return addresses;
}

function textAddressesFromTarget(target: unknown): LooseRecord[] {
  if (!target || typeof target !== 'object') return [];
  const record = target as LooseRecord;
  const story = record.story;
  const addresses: LooseRecord[] = [];
  if (record.kind === 'text' && record.range && typeof record.blockId === 'string') {
    const range = record.range as LooseRecord;
    if (typeof range.start === 'number' && typeof range.end === 'number' && range.start !== range.end) {
      addresses.push({
        kind: 'text',
        blockId: record.blockId,
        range: { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) },
        ...(story ? { story } : {}),
      });
    }
    return addresses;
  }
  if (record.kind === 'text' && Array.isArray(record.segments)) {
    for (const segment of record.segments as LooseRecord[]) {
      const range = segment?.range as LooseRecord | undefined;
      if (
        typeof segment?.blockId === 'string' &&
        typeof range?.start === 'number' &&
        typeof range?.end === 'number' &&
        range.start !== range.end
      ) {
        addresses.push({
          kind: 'text',
          blockId: segment.blockId,
          range: { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) },
          ...(story ? { story } : {}),
        });
      }
    }
    return addresses;
  }
  if (record.kind === 'selection') {
    const start = record.start as LooseRecord | undefined;
    const end = record.end as LooseRecord | undefined;
    const blockId = typeof start?.blockId === 'string' && end?.blockId === start.blockId ? start.blockId : null;
    if (
      start?.kind === 'text' &&
      end?.kind === 'text' &&
      blockId &&
      typeof start.offset === 'number' &&
      typeof end.offset === 'number' &&
      start.offset !== end.offset
    ) {
      addresses.push({
        kind: 'text',
        blockId,
        range: { start: Math.min(start.offset, end.offset), end: Math.max(start.offset, end.offset) },
        ...((record.story ?? start.story) ? { story: record.story ?? start.story } : {}),
      });
    }
  }
  return addresses;
}

function collapsedTextAddressFromTarget(target: unknown): LooseRecord | null {
  if (!target || typeof target !== 'object') return null;
  const record = target as LooseRecord;
  const story = record.story;
  if (record.kind === 'text' && record.range && typeof record.blockId === 'string') {
    const range = record.range as LooseRecord;
    if (typeof range.start === 'number' && typeof range.end === 'number' && range.start === range.end) {
      return {
        kind: 'text',
        blockId: record.blockId,
        range: { start: range.start, end: range.end },
        ...(story ? { story } : {}),
      };
    }
  }
  if (record.kind === 'text' && Array.isArray(record.segments)) {
    const segment = (record.segments as LooseRecord[])[0];
    const range = segment?.range as LooseRecord | undefined;
    if (
      typeof segment?.blockId === 'string' &&
      typeof range?.start === 'number' &&
      typeof range?.end === 'number' &&
      range.start === range.end
    ) {
      return {
        kind: 'text',
        blockId: segment.blockId,
        range: { start: range.start, end: range.end },
        ...(story ? { story } : {}),
      };
    }
  }
  if (record.kind === 'selection') {
    const start = record.start as LooseRecord | undefined;
    const end = record.end as LooseRecord | undefined;
    const blockId = typeof start?.blockId === 'string' && end?.blockId === start.blockId ? start.blockId : null;
    if (
      start?.kind === 'text' &&
      end?.kind === 'text' &&
      blockId &&
      typeof start.offset === 'number' &&
      typeof end.offset === 'number' &&
      start.offset === end.offset
    ) {
      return {
        kind: 'text',
        blockId,
        range: { start: start.offset, end: start.offset },
        ...((record.story ?? start.story) ? { story: record.story ?? start.story } : {}),
      };
    }
  }
  return null;
}

function collapsedTextAddressFromSelection(selection: SelectionSlice): LooseRecord | null {
  return collapsedTextAddressFromTarget(selection.target) ?? collapsedTextAddressFromTarget(selection.selectionTarget);
}

type SelectionTextSegment = {
  blockId: string;
  start: number;
  end: number;
};

const PROJECTED_INLINE_SELECTION_VALUE_KEYS = ['fontFamily', 'fontSize', 'color', 'highlight'] as const;
const MIRRORED_EDIT_COMMAND_IDS = {
  undo: 'history.undo',
  redo: 'history.redo',
} as const;

type ProjectedInlineSelectionValueKey = (typeof PROJECTED_INLINE_SELECTION_VALUE_KEYS)[number];
type ProjectedInlineSelectionValues = Partial<Record<ProjectedInlineSelectionValueKey, string>>;

// Effective (cascade-resolved) toggle-mark state (SD-3860). Kept separate from
// `ProjectedInlineSelectionValues` on purpose: that type is string-valued
// (font/color swatches) with many consumers assuming a string; marks are
// booleans and only ever feed a toggle button's active state.
const EFFECTIVE_MARK_KEYS = ['bold', 'italic', 'underline', 'strikethrough'] as const;
type EffectiveMarkKey = (typeof EFFECTIVE_MARK_KEYS)[number];
type EffectiveMarkValues = Partial<Record<EffectiveMarkKey, boolean>>;
type OptimisticInlineSelectionValue = {
  selectionSignature: string;
  value: string;
};
type OptimisticInlineToggle = {
  selectionSignature: string;
  active: boolean;
  generation: number;
  settled: boolean;
};
type OptimisticParagraphAlignment = {
  selectionSignature: string;
  value: 'left' | 'center' | 'right' | 'justify';
  generation: number;
  settled: boolean;
  canReconcile: boolean;
};
type PendingInlineToggleMutation = {
  key: string;
  mutate: () => unknown;
  result: Promise<unknown>;
  resolve: (value: unknown | PromiseLike<unknown>) => void;
};

function isProjectedInlineSelectionValueKey(value: string): value is ProjectedInlineSelectionValueKey {
  return (PROJECTED_INLINE_SELECTION_VALUE_KEYS as readonly string[]).includes(value);
}

function selectionTextSegments(selection: SelectionSlice): SelectionTextSegment[] {
  const target = selection.target as LooseRecord | null;
  const segments = target && Array.isArray(target.segments) ? (target.segments as LooseRecord[]) : [];
  const out: SelectionTextSegment[] = [];

  const push = (blockId: unknown, start: unknown, end: unknown): void => {
    if (typeof blockId !== 'string' || typeof start !== 'number' || typeof end !== 'number') return;
    out.push({
      blockId,
      start: Math.min(start, end),
      end: Math.max(start, end),
    });
  };

  for (const segment of segments) {
    const range = segment?.range as LooseRecord | undefined;
    push(segment?.blockId, range?.start, range?.end);
  }
  if (out.length > 0) return out;

  const explicit = selection.selectionTarget as LooseRecord | null;
  const start = explicit?.start as LooseRecord | undefined;
  const end = explicit?.end as LooseRecord | undefined;
  if (!start || !end) return out;
  if (start.blockId !== end.blockId) return out;
  push(start.blockId, start.offset, end.offset);
  return out;
}

function selectionStoryLocator(selection: SelectionSlice): unknown | undefined {
  const target = selection.target as LooseRecord | null;
  const explicit = selection.selectionTarget as LooseRecord | null;
  const start = explicit?.start as LooseRecord | undefined;
  const end = explicit?.end as LooseRecord | undefined;
  const story = target?.story ?? explicit?.story ?? start?.story ?? end?.story;
  return story && typeof story === 'object' ? story : undefined;
}

function selectionInlineValueStorySignature(selection: SelectionSlice): string {
  const story = selectionStoryLocator(selection);
  if (!story || typeof story !== 'object') return 'body';
  const record = story as LooseRecord;
  return JSON.stringify({
    storyType: typeof record.storyType === 'string' ? record.storyType : 'body',
    refId: typeof record.refId === 'string' ? record.refId : null,
    noteId: typeof record.noteId === 'string' ? record.noteId : null,
    textboxId: typeof record.textboxId === 'string' ? record.textboxId : null,
  });
}

function selectionInlineValueSignature(selection: SelectionSlice): string | null {
  const segments = selectionTextSegments(selection);
  if (segments.length === 0) return null;
  return [
    selectionInlineValueStorySignature(selection),
    ...segments.map((segment) => `${segment.blockId}:${segment.start}-${segment.end}`),
  ].join('|');
}

/**
 * The effective-uniformity worker operation accepts the durable
 * `selectionTarget`, not the expanded segment list. Whole-story segment lists
 * grow as source coverage arrives, so using them as this cache key restarts the
 * same worker read indefinitely while the document is loading.
 */
function selectionEffectiveUniformitySignature(selection: SelectionSlice): string | null {
  const target = selection.selectionTarget;
  if (!target || typeof target !== 'object') return null;
  return selectionKey({ selectionTarget: target });
}

function normalizeOptimisticInlineSelectionValue(key: ProjectedInlineSelectionValueKey, value: unknown): string | null {
  if (key === 'fontSize') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (key === 'color' || key === 'highlight') return trimmed.toUpperCase();
  return trimmed;
}

function rangesOverlap(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

function queryMatchItemSegments(item: LooseRecord | null): SelectionTextSegment[] {
  if (!item) return [];
  const blocks = Array.isArray(item.blocks) ? (item.blocks as LooseRecord[]) : [];
  const out: SelectionTextSegment[] = [];
  for (const block of blocks) {
    const range = block?.range as LooseRecord | undefined;
    const blockId = block?.blockId;
    if (typeof blockId !== 'string' || typeof range?.start !== 'number' || typeof range?.end !== 'number') continue;
    out.push({
      blockId,
      start: Math.min(range.start, range.end),
      end: Math.max(range.start, range.end),
    });
  }
  return out;
}

function sameSelectionTextSegments(
  left: readonly SelectionTextSegment[],
  right: readonly SelectionTextSegment[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const candidate = right[index];
    return (
      candidate?.blockId === segment.blockId && candidate?.start === segment.start && candidate?.end === segment.end
    );
  });
}

/**
 * Pick the `query.match` result item that best covers the selection. Pure over
 * a settled query result so the controller's async read coordinator owns the
 * (promise-capable) `query.match` call and this stays a synchronous projection.
 */
function pickSelectionTextQueryItem(result: LooseRecord | null, selection: SelectionSlice): LooseRecord | null {
  const segments = selectionTextSegments(selection);
  if (segments.length === 0) return null;
  const items = result && Array.isArray(result.items) ? (result.items as LooseRecord[]) : [];
  if (items.length === 0) return null;

  const exact = items.find((item) => sameSelectionTextSegments(segments, queryMatchItemSegments(item)));
  if (exact) return exact;

  if (segments.length === 1) {
    const singleBlock = items.find((item) => {
      const address = item?.address as LooseRecord | undefined;
      return address?.kind === 'block' && address.nodeId === segments[0].blockId;
    });
    if (singleBlock) return singleBlock;
  }

  return items[0] ?? null;
}

function readProjectedInlineStyleValue(
  styles: LooseRecord | null | undefined,
  key: ProjectedInlineSelectionValueKey,
): string | undefined {
  const raw =
    key === 'fontSize'
      ? (styles?.fontSizePt ?? styles?.fontSize)
      : key === 'highlight'
        ? (styles?.highlight ?? styles?.backgroundColor)
        : styles?.[key];
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (key === 'color' || key === 'highlight') return trimmed.toUpperCase();
  return trimmed;
}

/** Primary named family from a resolved CSS font stack, dropping generic fallbacks (SD-3652). */
function normalizeLayoutFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const first = value
    .split(',')[0]
    ?.trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (!first) return undefined;
  const lower = first.toLowerCase();
  if (
    lower === 'serif' ||
    lower === 'sans-serif' ||
    lower === 'monospace' ||
    lower === 'cursive' ||
    lower === 'fantasy'
  ) {
    return undefined;
  }
  return first;
}

/** Convert a resolved run font size in CSS px to the toolbar's point value (SD-3652). */
function normalizeLayoutFontSizePt(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const pt = Math.round(value * 0.75 * 2) / 2;
  if (pt <= 0) return undefined;
  return String(pt);
}

function normalizeProjectedInlineStyleValueKey(key: ProjectedInlineSelectionValueKey, value: string): string {
  if (key === 'fontFamily') return value.toLowerCase();
  if (key === 'color' || key === 'highlight') return value.toUpperCase();
  return value;
}

function projectInlineValuesFromQueryItem(
  item: LooseRecord | null,
  selection: SelectionSlice,
): ProjectedInlineSelectionValues {
  if (!item) return {};

  const selectionSegmentsByBlock = new Map<string, Array<{ start: number; end: number }>>();
  for (const segment of selectionTextSegments(selection)) {
    const ranges = selectionSegmentsByBlock.get(segment.blockId) ?? [];
    ranges.push({ start: segment.start, end: segment.end });
    selectionSegmentsByBlock.set(segment.blockId, ranges);
  }
  if (selectionSegmentsByBlock.size === 0) return {};

  const blocks = Array.isArray(item.blocks) ? (item.blocks as LooseRecord[]) : [];
  const projection: ProjectedInlineSelectionValues = {};

  for (const key of PROJECTED_INLINE_SELECTION_VALUE_KEYS) {
    const seenValues = new Map<string, string>();
    let sawOverlap = false;
    let sawMissingValue = false;

    for (const block of blocks) {
      const blockId = typeof block?.blockId === 'string' ? block.blockId : null;
      if (!blockId) continue;

      const selectionRanges = selectionSegmentsByBlock.get(blockId);
      if (!selectionRanges?.length) continue;

      const runs = Array.isArray(block?.runs) ? (block.runs as LooseRecord[]) : [];
      for (const run of runs) {
        const range = run?.range as LooseRecord | undefined;
        const start = typeof range?.start === 'number' ? range.start : null;
        const end = typeof range?.end === 'number' ? range.end : null;
        if (start == null || end == null) continue;
        if (!selectionRanges.some((selectionRange) => rangesOverlap(selectionRange, { start, end }))) continue;

        sawOverlap = true;
        const value = readProjectedInlineStyleValue(run?.styles as LooseRecord | undefined, key);
        if (value === undefined) {
          sawMissingValue = true;
          continue;
        }

        const normalized = normalizeProjectedInlineStyleValueKey(key, value);
        if (!seenValues.has(normalized)) seenValues.set(normalized, value);
        if (seenValues.size > 1) break;
      }

      if (seenValues.size > 1) break;
    }

    if (sawOverlap && !sawMissingValue && seenValues.size === 1) {
      projection[key] = [...seenValues.values()][0];
    }
  }

  return projection;
}

/** A create-location `at` derived from the current block, or `documentEnd`. */
function createLocationAt(selection: SelectionSlice, mode: 'nodeId' | 'target'): LooseRecord {
  const blockId = selectionBlockIds(selection)[0];
  if (!blockId) return { kind: 'documentEnd' };
  return mode === 'nodeId' ? { kind: 'after', nodeId: blockId } : { kind: 'after', target: paragraphTarget(blockId) };
}

function normalizeCommandState(state: Partial<CommandState>, source: CommandState['source']): CommandState {
  const supported = state.supported ?? source !== 'unsupported';
  const enabled = state.enabled ?? (state.disabled !== undefined ? !state.disabled : supported);
  return {
    enabled,
    disabled: !enabled,
    active: state.active ?? false,
    supported,
    value: state.value,
    source,
    // A reason is only meaningful for a disabled command. Enabled commands never
    // carry one, so consumers can treat `reason` presence as "blocked, here is why".
    reason: enabled ? undefined : state.reason,
  };
}

function projectTrackChangesItem(item: unknown): TrackChangesItem | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as LooseRecord;
  const nested = row.change;
  const change = nested && typeof nested === 'object' ? (nested as LooseRecord) : row;
  return {
    ...row,
    id: row.id ?? change.id,
    change,
  } as TrackChangesItem;
}

function trackChangesItemPayload(item: TrackChangesItem): LooseRecord {
  const row = item as LooseRecord;
  const change = row.change;
  return change && typeof change === 'object' ? (change as LooseRecord) : row;
}

function commandResultFromOperationResult(result: unknown): CommandExecutionResult {
  if (isPromiseLike(result)) return true;
  if (result === false) return false;
  if (result === true || result == null) return true;
  if (typeof result !== 'object') return true;
  const record = result as LooseRecord;
  if ('success' in record || 'failure' in record || 'effects' in record) return result as Receipt;
  if (record.status === 'rejected') return false;
  return true;
}

function isSuccessfulReceipt(result: CommandExecutionResult): result is Extract<Receipt, { success: true }> {
  return Boolean(result) && typeof result === 'object' && (result as LooseRecord).success === true;
}

/**
 * The host also emits `mutation:committed` for previews and no-op receipts;
 * those events must not mark the document as having unsaved edits.
 */
function mutationCommittedEventChangedDocument(event: LooseRecord): boolean {
  if (event.dryRun === true) return false;
  const receipt = event.receipt;
  if (receipt && typeof receipt === 'object' && (receipt as LooseRecord).changed === false) return false;
  if (receipt && typeof receipt === 'object' && (receipt as LooseRecord).noop === true) return false;
  if (receipt && typeof receipt === 'object' && (receipt as LooseRecord).status === 'NO_OP') return false;
  return true;
}

function commandResultSucceeded(result: CommandExecutionResult): boolean {
  if (result === false) return false;
  if (result && typeof result === 'object' && (result as LooseRecord).success === false) return false;
  return true;
}

function isLooseObject(value: unknown): value is LooseRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Flatten mounted projection blocks into text-bearing blocks (those with a
 * `runs` array), descending into table rows/cells so table-cell content is
 * reachable (SD-3652). A block carries either `runs` (paragraph) or `rows`
 * (table); nested tables recurse.
 */
function collectProjectionTextBlocks(blocks: unknown): LooseRecord[] {
  const out: LooseRecord[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as LooseRecord;
    if (Array.isArray(record.runs)) out.push(record);
    if (Array.isArray(record.rows)) {
      for (const row of record.rows as unknown[]) {
        const cells = (row as LooseRecord | null)?.cells;
        if (!Array.isArray(cells)) continue;
        for (const cell of cells as unknown[]) {
          const cellRecord = cell as LooseRecord | null;
          if (Array.isArray(cellRecord?.blocks)) {
            for (const nested of cellRecord!.blocks as unknown[]) visit(nested);
          }
          if (cellRecord?.paragraph) visit(cellRecord.paragraph);
        }
      }
    }
  };
  if (Array.isArray(blocks)) {
    for (const block of blocks as unknown[]) visit(block);
  }
  return out;
}

/** A projection block matches a selection block id by `sourceAnchor.sourceNodeId` or `block.id`. */
function projectionBlockMatchesId(block: LooseRecord, id: string): boolean {
  if ((block.sourceAnchor as LooseRecord | undefined)?.sourceNodeId === id) return true;
  return block.id === id;
}

/**
 * Length of a painted run in the Document API selection-offset space.
 *
 * Review mode paints deleted revision text, but that text is not part of the
 * editable selection stream. Counting its painted characters shifts every
 * later selection onto the wrong projected run (and therefore the wrong
 * effective formatting). Insertions remain selectable and keep their length.
 */
function projectionRunSelectionLength(run: LooseRecord): number {
  const trackedChange = run.trackedChange as LooseRecord | undefined;
  if (trackedChange?.kind === 'delete') return 0;
  return typeof run.text === 'string' ? run.text.length : 0;
}

function combineCommandResults(results: readonly CommandExecutionResult[]): CommandExecutionResult {
  let last: CommandExecutionResult = false;
  let firstFailure: CommandExecutionResult | null = null;
  let lastRouted: CommandExecutionResult | null = null;
  let lastReceipt: CommandExecutionResult | null = null;
  for (const result of results) {
    last = result;
    if (!commandResultSucceeded(result) && firstFailure === null) firstFailure = result;
    if (isSuccessfulReceipt(result)) lastReceipt = result;
    if (result !== false) lastRouted = result;
  }
  return firstFailure ?? lastReceipt ?? lastRouted ?? last;
}

function hyperlinkAddressToSelectionTarget(address: LooseRecord | null | undefined): LooseRecord | null {
  const anchor = address?.anchor as LooseRecord | undefined;
  const start = anchor?.start as LooseRecord | undefined;
  const end = anchor?.end as LooseRecord | undefined;
  if (typeof start?.blockId !== 'string' || typeof end?.blockId !== 'string') return null;
  if (start.blockId !== end.blockId) return null;
  if (typeof start.offset !== 'number' || typeof end.offset !== 'number') return null;
  return {
    kind: 'selection',
    start: { kind: 'text', blockId: start.blockId, offset: start.offset },
    end: { kind: 'text', blockId: end.blockId, offset: end.offset },
  };
}

function hyperlinkTargetFromHref(href: string): LooseRecord {
  if (href.startsWith('#')) return { kind: 'anchor', anchor: href.slice(1) };
  return { kind: 'external', url: href };
}

/** Tracked-change decision spec for a command id, from the descriptor catalog. */
function trackDecisionCommand(id: string): TrackDecisionSpec | null {
  return getCommandDescriptor(id)?.trackDecision ?? null;
}

function rectResult(rects: readonly ViewportRect[]): ViewportRectResult {
  return { found: rects.length > 0, success: rects.length > 0, rects, rect: rects[0] };
}

/** Fail-closed empty geometry result carrying a stable reason. */
function rectFailure(reason: string): ViewportRectResult {
  return { found: false, success: false, rects: [], reason };
}

/** Offset client-space rects so they are relative to `relativeTo`, when given. */
function relativizeRects(result: ViewportRectResult, relativeTo?: HTMLElement): ViewportRectResult {
  if (!relativeTo || typeof relativeTo.getBoundingClientRect !== 'function' || result.rects.length === 0) {
    return result;
  }
  let origin: { left: number; top: number };
  try {
    const box = relativeTo.getBoundingClientRect();
    origin = { left: box.left, top: box.top };
  } catch {
    return result;
  }
  const rects = result.rects.map((rect) => ({
    ...rect,
    left: rect.left - origin.left,
    right: rect.right - origin.left,
    top: rect.top - origin.top,
    bottom: rect.bottom - origin.top,
  }));
  return { ...result, rects, rect: rects[0] };
}

/**
 * Whether a text-target segment carries the addressable shape AND the value
 * invariants the derived selection target relies on (`blockId` string plus a
 * `range` of valid integer bounds, `start >= 0` and `start <= end` — the
 * documented `TextTarget` contract). Captures can be stale or deserialized from
 * a host store, so entries are validated instead of trusted: a segment that is
 * malformed (missing `range`) or out of bounds (negative, non-integer, or
 * inverted) makes the caller return `null` (fail closed) rather than throw
 * mid-derivation or restore a clamped, different range than was captured.
 */
function isAddressableSegment(segment: unknown): segment is { blockId: string; range: { start: number; end: number } } {
  if (!segment || typeof segment !== 'object') return false;
  const candidate = segment as { blockId?: unknown; range?: unknown };
  if (typeof candidate.blockId !== 'string' || !candidate.range || typeof candidate.range !== 'object') return false;
  const range = candidate.range as { start?: unknown; end?: unknown };
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    (range.start as number) >= 0 &&
    (range.start as number) <= (range.end as number)
  );
}

function selectionTargetFromTextTarget(
  target: SelectionSlice['target'] | SelectionCapture['target'] | null,
): SelectionTarget | null {
  if (!target || target.kind !== 'text' || !Array.isArray(target.segments) || target.segments.length === 0) return null;
  // Validate every segment, not just the derived endpoints: a corrupt capture
  // (e.g. a bad middle segment) fails closed to `target-unresolved` rather than
  // being silently accepted as a first-to-last selection. Densify with
  // `Array.from` first — `Array.prototype.every` skips sparse-array holes, so a
  // hole at any index (including an endpoint the derivation reads) would slip
  // through as `undefined` and throw rather than fail closed.
  const segments = Array.from(target.segments);
  if (!segments.every(isAddressableSegment)) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const story = target.story;
  const start = {
    kind: 'text' as const,
    blockId: first.blockId,
    offset: first.range.start,
    ...(story ? { story } : {}),
  };
  const end = {
    kind: 'text' as const,
    blockId: last.blockId,
    offset: last.range.end,
    ...(story ? { story } : {}),
  };
  return {
    kind: 'selection',
    start,
    end,
    ...(story ? { story } : {}),
  };
}

function selectionTargetForRestore(capture: SelectionCapture): SelectionTarget | null {
  if (capture.selectionTarget) return capture.selectionTarget;
  return selectionTargetFromTextTarget(capture.target);
}

/**
 * Resolve the live selection slice to a `SelectionTarget` the inline
 * `format.*` operations accept. Returns the explicit `selectionTarget` when the
 * source provides one, otherwise derives a same-story selection target from the
 * resolved text target's first/last covered segments. Returns `null` when the
 * selection is empty or has no resolvable range — the inline command then fails closed with
 * `range-selection-required` rather than calling `format.*` with a missing
 * target (which the public Document API rejects with `INVALID_INPUT`).
 */
function resolveInlineSelectionTarget(selection: SelectionSlice): SelectionTarget | null {
  if (selection.empty) return null;
  if (selection.selectionTarget) return selection.selectionTarget;
  const fallback = selectionTargetFromTextTarget(selection.target);
  // A cross-block format target must be the host's own `selectionTarget`
  // (browser-selection offsets, resolved centrally by the adapter — SD-3706).
  // Deriving one from per-block segments would guess at offsets the host never
  // published, so a host that supplies no selectionTarget for a multi-block
  // range fails closed to the selection-required path instead.
  if (
    fallback &&
    fallback.start.kind === 'text' &&
    fallback.end.kind === 'text' &&
    fallback.start.blockId !== fallback.end.blockId
  ) {
    return null;
  }
  return fallback;
}

/**
 * The `format.*` method name a stored inline mark is keyed by (SD-3654). The
 * host store and the toggle command both address a mark by its Document API
 * method (`docRoute` minus the `format.` prefix), which differs from the inline
 * `key` for strikethrough (`key: 'strike'` vs `docRoute: 'format.strikethrough'`).
 */
function inlineFormatMethod(descriptor: CommandDescriptor): string | null {
  if (!descriptor.inline || typeof descriptor.docRoute !== 'string') return null;
  return descriptor.docRoute.startsWith('format.') ? descriptor.docRoute.slice('format.'.length) : null;
}

/** Inline run-property keys cleared by `clear-formatting` via `format.apply`. */
const CLEAR_INLINE_PATCH: Readonly<Record<string, null>> = {
  bold: null,
  italic: null,
  underline: null,
  strike: null,
  color: null,
  highlight: null,
  fontFamily: null,
  fontSize: null,
  vertAlign: null,
  smallCaps: null,
  caps: null,
  letterSpacing: null,
  dstrike: null,
};

/**
 * Subset of `CLEAR_INLINE_PATCH` whose registry entry supports tracked
 * changes. Tracked `format.apply` rejects the whole patch with
 * `CAPABILITY_UNAVAILABLE` if any key isn't `tracked: true` (e.g. `smallCaps`,
 * `dstrike`), regardless of whether the selection actually carries them, so
 * suggesting mode must send this filtered patch instead of the full one.
 */
const TRACKED_CLEAR_INLINE_PATCH: Readonly<Record<string, null>> = Object.fromEntries(
  Object.entries(CLEAR_INLINE_PATCH).filter(
    ([key]) => INLINE_PROPERTY_BY_KEY[key as InlineRunPatchKey]?.tracked === true,
  ),
);

/**
 * Build the public Document API input for an inline-format command from the
 * resolved selection target, the normalized payload, and the command's live
 * active state. Boolean mark commands can also receive an explicit boolean/null
 * payload, which is useful for hosts that know the desired state themselves.
 * Returns `null` when the payload is invalid for the spec (so the controller
 * fails closed instead of forwarding a malformed value).
 */
function buildInlineFormatInput(
  spec: { key: string; kind: 'toggle' | 'value-string' | 'value-number' | 'clear' },
  target: SelectionTarget,
  payload: unknown,
  active: boolean,
): LooseRecord | null {
  switch (spec.kind) {
    case 'toggle': {
      const value =
        typeof payload === 'object' && payload !== null && 'value' in (payload as LooseRecord)
          ? (payload as LooseRecord).value
          : payload;
      if (typeof value === 'boolean' || value === null) return { target, value };
      return { target, value: !active };
    }
    case 'value-string': {
      const value =
        typeof payload === 'object' && payload !== null && 'value' in (payload as LooseRecord)
          ? (payload as LooseRecord).value
          : payload;
      if (value === null) return { target, value: null };
      if (typeof value !== 'string' || value.trim() === '') return null;
      return { target, value };
    }
    case 'value-number': {
      const raw =
        typeof payload === 'object' && payload !== null && 'value' in (payload as LooseRecord)
          ? (payload as LooseRecord).value
          : payload;
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value) || value <= 0) return null;
      return { target, value };
    }
    case 'clear':
      return { target, inline: { ...CLEAR_INLINE_PATCH } };
    default:
      return null;
  }
}

/**
 * Normalized table context the controller derives from the host facade. Holds
 * the table node id plus the resolved row/column indices and (when present) the
 * current cell node id and a multi-cell selection range for merge.
 */
interface ResolvedTableContext {
  tableNodeId: string;
  rowIndex: number;
  columnIndex: number;
  cellNodeId: string | null;
  mergeRange: {
    start: { rowIndex: number; columnIndex: number };
    end: { rowIndex: number; columnIndex: number };
  } | null;
}

/** Read a `{ start, end }` cell-range from the host snapshot, when well-formed. */
function readMergeRange(
  range: LooseRecord | undefined,
): { start: { rowIndex: number; columnIndex: number }; end: { rowIndex: number; columnIndex: number } } | null {
  const point = (value: unknown): { rowIndex: number; columnIndex: number } | null => {
    if (!value || typeof value !== 'object') return null;
    const record = value as LooseRecord;
    const rowIndex = record.rowIndex;
    const columnIndex = record.columnIndex;
    if (typeof rowIndex !== 'number' || !Number.isInteger(rowIndex)) return null;
    if (typeof columnIndex !== 'number' || !Number.isInteger(columnIndex)) return null;
    return { rowIndex, columnIndex };
  };
  if (!range) return null;
  const start = point(range.start);
  const end = point(range.end);
  if (!start || !end) return null;
  return { start, end };
}

/**
 * Build the public `tables.*` input for a table cell-context command from the
 * resolved table context. Returns `null` when the action's required context is
 * missing (e.g. split with no resolved cell), so the controller fails closed
 * with `table-context-unavailable` rather than calling with a malformed locator.
 */
function buildTableCommandInput(action: TableCommandSpec['action'], context: ResolvedTableContext): LooseRecord | null {
  const { tableNodeId: nodeId, rowIndex, columnIndex, cellNodeId, mergeRange } = context;
  switch (action) {
    case 'insert-row-before':
      return { nodeId, rowIndex, position: 'above' };
    case 'insert-row-after':
      return { nodeId, rowIndex, position: 'below' };
    case 'delete-row':
      return { nodeId, rowIndex };
    case 'insert-column-before':
      return { nodeId, columnIndex, position: 'left' };
    case 'insert-column-after':
      return { nodeId, columnIndex, position: 'right' };
    case 'delete-column':
      return { nodeId, columnIndex };
    case 'delete-table':
      return { nodeId };
    case 'merge-cells': {
      const range = mergeRange ?? {
        start: { rowIndex, columnIndex },
        end: { rowIndex, columnIndex },
      };
      return { nodeId, start: range.start, end: range.end };
    }
    case 'split-cell':
      // Cell-level locator required; the table-context state gate guarantees it.
      return cellNodeId ? { nodeId: cellNodeId, rows: 1, columns: 2 } : null;
    case 'remove-borders':
      return { nodeId, mode: 'applyTo', applyTo: 'all', border: null };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Format-painter state types
// ---------------------------------------------------------------------------

type FormatPainterMode = 'idle' | 'armed' | 'persistent';

interface FormatPainterParagraphSnapshot {
  styleId: string | null;
  alignment: 'left' | 'right' | 'center' | 'justify' | null;
  spacing: unknown | null;
  indentation: { left?: number; right?: number; firstLine?: number; hanging?: number } | null;
  markRunProps: unknown | null;
  numbering: { numId: number; level?: number } | null;
  listStyle: unknown | null;
}

interface FormatPainterSnapshot {
  story: unknown | null;
  inline: Record<string, unknown>;
  paragraph: FormatPainterParagraphSnapshot | null;
}

interface FormatPainterState {
  mode: FormatPainterMode;
  snapshot: FormatPainterSnapshot | null;
  sourceSelectionKey: string | null;
  lastClickAt: number;
  pointerSelecting: boolean;
  keyboardSelecting: boolean;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

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
  let painterCaptureEpoch = 0;
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
      const surface = editor.contextMenu;
      if (!surface || typeof surface !== 'object' || typeof surface.open !== 'function') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      try {
        const result = surface.open();
        if (result && typeof result === 'object' && (result as LooseRecord).ok === false) {
          return {
            ok: false,
            reason: coerceSuperDocUIReason((result as LooseRecord).reason, SUPERDOC_UI_REASONS.operationUnavailable),
          };
        }
        return { ok: true };
      } catch {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
    },
    close: (): void => {
      if (disposed) return;
      const surface = getEditor()?.contextMenu;
      if (!surface || typeof surface !== 'object' || typeof surface.close !== 'function') return;
      try {
        surface.close();
      } catch {
        // Closing an unavailable surface is intentionally idempotent.
      }
    },
    contextAt,
  };

  /** Read the live browser Document API facade (or null). */
  const getDoc = (): LooseRecord | null => {
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
    const source = getV2ReviewWindowSource();
    if (!source || typeof source.getSnapshot !== 'function') return null;
    return safeCall<LooseRecord | null>(() => source.getSnapshot(), null);
  };

  const hasV2ReviewWindowFeed = (): boolean => typeof getV2ReviewWindowSource()?.getSnapshot === 'function';

  const reviewWindowSliceStatus = (snapshot: LooseRecord | null): SliceStatus => {
    const status = snapshot?.status;
    return status === 'ready' || status === 'stale' ? status : 'pending';
  };

  /** Read the live v2 editor host (inline mode only), when exposed. */
  const getHost = (): LooseRecord | null => {
    const editor = getEditor();
    const host = editor?.host;
    return host && typeof host === 'object' ? (host as LooseRecord) : null;
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
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
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

  /** Read one edit-command snapshot entry (`activeEditor.editCommands.getSnapshot().commands[id]`). */
  const readEditCommandStateEntry = (commandId: string): LooseRecord | null => {
    const editCommands = getEditCommands();
    if (!editCommands || typeof editCommands.getSnapshot !== 'function') return null;
    const snap = safeCall<LooseRecord | null>(() => editCommands.getSnapshot(), null);
    const entry = (snap?.commands as LooseRecord | undefined)?.[commandId];
    return entry && typeof entry === 'object' ? (entry as LooseRecord) : null;
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
    const host = getHost();
    if (!host || typeof host.getTableContext !== 'function') return null;
    const snapshot = safeCall<LooseRecord | null>(() => host.getTableContext(), null);
    return snapshot && typeof snapshot === 'object' ? (snapshot as LooseRecord) : null;
  };

  const resolveTableContext = (): ResolvedTableContext | null => {
    const snapshot = readHostTableContext();
    if (!snapshot || snapshot.inTable !== true) return null;
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
    return { tableNodeId, rowIndex, columnIndex, cellNodeId, mergeRange };
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
  const mirrorTrackedChangeFocusToHost = (next: ExplicitActiveChange | null): void => {
    const host = getHost();
    if (typeof host?.getHandles !== 'function') return;
    const handles = safeCall<LooseRecord | null>(() => host.getHandles(), null);
    const review = handles?.review as LooseRecord | undefined;
    if (!review) return;

    if (next) {
      if (typeof review.setActiveReviewTarget !== 'function') return;
      const layout = handles?.layout as LooseRecord | undefined;
      safeCall(
        () =>
          review.setActiveReviewTarget({
            entityType: 'trackedChange',
            entityId: next.id,
            ...(next.paintedEntityId ? { paintedEntityId: next.paintedEntityId } : {}),
            origin: 'panel',
            layoutEpoch: typeof layout?.generation === 'number' ? layout.generation : 0,
            story: next.story ?? { kind: 'story', storyType: 'body' },
          }),
        null,
      );
      return;
    }

    if (typeof review.getActiveReviewTarget !== 'function' || typeof review.clearActiveReviewTarget !== 'function') {
      return;
    }
    const activeTarget = safeCall<LooseRecord | null>(() => review.getActiveReviewTarget(), null);
    if (activeTarget?.entityType === 'trackedChange') {
      safeCall(() => review.clearActiveReviewTarget(), undefined);
    }
  };
  const setExplicitActiveChange = (
    next: ExplicitActiveChange | null,
    options?: { invalidateQueuedNavigation?: boolean },
  ): void => {
    explicitActiveChange = next;
    explicitActiveChangeRevision += 1;
    trackChangeRevealInvalidation += 1;
    if (options?.invalidateQueuedNavigation !== false) {
      queuedTrackChangeNavigationInvalidation += 1;
    }
  };

  // -- style-catalogue shape ------------------------------------------------
  // Compiling the style catalogue (`doc.styles.getCatalog`) recompiles a
  // WordStyleModel from package bytes, so we do NOT recompile on every caret
  // move. The async read coordinator caches it by content revision (editor +
  // document-mutation revision), NOT by selection, so a caret move serves the
  // cached catalogue while a document mutation re-fetches it. The active
  // paragraph style is read per selected block (also coordinator-cached) so it
  // stays correct as the selection moves.
  type StyleCatalogCache = {
    full: StylesGetCatalogResult;
    quickGallery: readonly StyleCatalogItem[];
    byId: Map<string, StyleCatalogItem>;
  };

  // -- state store ----------------------------------------------------------
  const listeners = new Set<(state: SuperDocUIState) => void>();
  let state!: SuperDocUIState;
  let disposed = false;
  // Back-reference to the controller object, set just before it is returned.
  // Lets the shared custom-command callback context expose `ui` without a
  // forward declaration; it is only read at command-execution time.
  let controllerRef: SuperDocUI | null = null;

  // -- async read coordinator ------------------------------------------------
  // The browser Document API facade settles reads asynchronously by contract
  // (`forceAsync`). The reactive store therefore NEVER reads a promise-capable
  // doc method during snapshot computation. Instead every doc read flows
  // through this coordinator, which:
  //   - serves the last settled value from a per-key cache keyed by an
  //     invalidation token (active-editor identity + document-mutation revision,
  //     plus a per-read suffix for selection- and block-scoped reads);
  //   - issues at most one in-flight read per (key, token), coalescing repeated
  //     requests within and across recomputes;
  //   - guards against stale resolutions: a settle is accepted only while its
  //     token is still the one in flight for that key, so an older read can
  //     never overwrite newer state;
  //   - schedules a single coalesced recompute when new values land, so
  //     `computeState()` always re-runs against settled cache only.
  // Synchronous (inline-mode) reads settle on the same tick and are served fresh
  // immediately, so inline behavior is preserved.
  type AsyncReadEntry = {
    token: string | null;
    value: unknown;
    hasSettled: boolean;
    inflightToken: string | null;
    failedToken?: string | null;
    failureCount?: number;
    retryAtMs?: number;
  };
  const asyncReads = new Map<string, AsyncReadEntry>();
  const coldAsyncReadDeferrals = new Set<string>();
  let lastEffectiveInlineReadKey: string | null = null;
  let pendingEffectiveInlineRead: {
    key: string;
    ready: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  let asyncRefreshScheduled = false;
  let asyncReadFailureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let asyncReadFailureRetryAtMs = 0;
  let foregroundAsyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSelectionSeedValidationToken: string | null = null;
  let typingContentInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingAsyncReadSettlements: Array<{
    key: string;
    settledAtMs: number;
    commandId: string | null;
    commandKind: string | null;
  }> = [];
  const scheduleAsyncRefresh = (): void => {
    if (asyncRefreshScheduled || disposed) return;
    asyncRefreshScheduled = true;
    const run = (): void => {
      asyncRefreshScheduled = false;
      if (!disposed) recompute('async-read-settled');
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else void Promise.resolve().then(run);
  };

  const ASYNC_READ_FAILURE_RETRY_BASE_MS = 250;
  const ASYNC_READ_FAILURE_RETRY_MAX_MS = 5_000;
  const scheduleAsyncReadFailureRetry = (retryAtMs: number): void => {
    if (disposed) return;
    if (asyncReadFailureRetryTimer && asyncReadFailureRetryAtMs <= retryAtMs) return;
    if (asyncReadFailureRetryTimer) clearTimeout(asyncReadFailureRetryTimer);
    asyncReadFailureRetryAtMs = retryAtMs;
    asyncReadFailureRetryTimer = setTimeout(
      () => {
        asyncReadFailureRetryTimer = null;
        asyncReadFailureRetryAtMs = 0;
        if (!disposed) recompute();
      },
      Math.max(0, retryAtMs - Date.now()),
    );
  };

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
    const existing = uiTrackedChangesCatalogState.inFlight;
    if (existing?.generation === generation) return existing.promise;
    const signal = uiTrackedChangesCatalogState.abortController.signal;
    const validateResult = (result: LooseRecord | undefined): LooseRecord | undefined => {
      if (
        signal.aborted ||
        generation !== uiTrackedChangesCatalogState.generation ||
        result?.reason === 'review-hydration-superseded'
      ) {
        throw new Error('ui-review-catalog-superseded');
      }
      return result;
    };
    const rawResult = (listTrackedChanges as AnyFn).call(v2TrackedChanges, {
      blocking: false,
      signal,
    }) as LooseRecord | PromiseLike<LooseRecord | undefined> | undefined;
    // Keep a synchronous bridge result synchronous so an already-loaded
    // catalog can canonicalize a story-scoped document click immediately.
    // Worker-backed reads still use the shared cancellable promise below.
    if (!isPromiseLike(rawResult)) return validateResult(rawResult);
    const promise = Promise.resolve(rawResult as PromiseLike<LooseRecord | undefined>).then(validateResult);
    uiTrackedChangesCatalogState.inFlight = { generation, promise };
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
    const revision =
      typeof host.getLocalMutationRevision === 'function'
        ? safeCall<unknown>(() => host.getLocalMutationRevision(), null)
        : null;
    const seeded = typeof revision === 'number' ? revision : 0;
    hostSeededMutationRevision.set(host, seeded);
    if (seeded > 0) dirtyHosts.add(host);
    else if (revision === 0) dirtyHosts.delete(host);
  };
  // Seeds on first read as well as on subscription: the initial state is
  // computed before the host subscription is wired.
  const hasLocalDocumentMutation = (): boolean => {
    const host = getHost();
    if (!host) return false;
    seedLocalDocumentMutation(host);
    return dirtyHosts.has(host);
  };

  /** Token shared by document-content reads (editor identity + mutation revision). */
  const contentToken = (): string => `${editorIdentityId(getEditor())}|m${documentMutationRevision}`;

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
    const record = isLooseObject(receipt) ? receipt : null;
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
      const row = item as LooseRecord;
      const author = change.author ?? change.authorEmail ?? row.author ?? row.authorEmail;
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

  // -- heavy-read policy (source-loading deferral) ----------------------------
  // While the host reports the document source as ACTIVELY LOADING, passive
  // slice recompute must not cold-start catalog-scale worker reads: the
  // measured during-load typing cliff was the cold `contentControls.list`
  // full-document parse blocking keystroke receipts in the shared kernel
  // worker. Policy semantics per key while loading: no settled value ->
  // `pending` without issuing the read; settled value (any token) -> served
  // as `stale` without cold-starting a refresh. Explicit demand
  // (`demandHeavyDocRead`) bypasses the gate for one content revision so a
  // user-opened panel can still opt into the full read. On source-complete /
  // terminal, one recompute is scheduled INPUT-IDLE-GATED so the deferred
  // reads cannot stampede into the first keystrokes after completion (the
  // migrated-cliff failure mode pinned by the W0 red run).
  //
  // Audited exclusions: `selection` must stay live for caret correctness;
  // `lists:*`, `node:*`, `query:*`, `metadata:resolve:*` are block/selection
  // scoped reads command states depend on, not full-document catalogs.
  // The policy table itself (`HEAVY_DOC_READ_POLICY`) lives at module scope so
  // the table-driven tests consume the SAME list this gate matches against.

  /** Tri-state host source-load phase derived from the loading snapshot seam. */
  const hostSourceLoadPhase = (): 'loading' | 'complete' | 'unknown' => {
    const host = getHost();
    const read = host?.getDocumentLoadingSnapshot;
    if (typeof read !== 'function') return 'unknown';
    const snapshot = safeCall<LooseRecord | null>(() => read.call(host) as LooseRecord, null);
    const stage = snapshot?.sourceStage;
    // `bootstrap-ready` means the model/API opened while the remainder of
    // the source can still be loading. Passive catalog reads must stay behind
    // that boundary: issuing them here can force a collaboration package
    // projection, advance the package revision, and invalidate the main
    // loader's in-flight coverage. The host completion watch transitions to a
    // terminal source stage even for small resident documents.
    if (stage === 'opening' || stage === 'bootstrap-ready' || stage === 'source-loading') return 'loading';
    if (stage === 'source-complete' || stage === 'source-failed' || stage === 'source-cancelled') {
      return 'complete';
    }
    // Absent or unknown host state: preserve compatibility for hosts without
    // the source-loading lifecycle seam.
    return 'unknown';
  };

  // Explicit demand: key -> content token it was demanded under. Valid for one
  // content revision so an open panel's demand survives coordinator retries
  // but does not silently pin the key hot forever.
  const demandedHeavyReads = new Map<string, string>();
  // A tracked-change directory may settle while progressive source loading is
  // still exposing only a prefix. Keep that prefix available as stale data,
  // then refresh it once when the host announces source completion. The v2
  // adapter supplies the completeness proof; passive review-window reads never
  // enter this map and therefore remain page-bounded.
  const incompleteTrackChangesDirectoryReadTokens = new Map<string, string>();
  const postSourceCompletionRefreshTokens = new Map<string, string>();
  let sourceCompletionObservedToken: string | null = null;
  type DirectoryFamily = 'comments' | 'trackChanges' | 'contentControls';
  const directoryLeaseCounts: Record<DirectoryFamily, number> = {
    comments: 0,
    trackChanges: 0,
    contentControls: 0,
  };
  const demandHeavyDocRead = (key: string): void => {
    const token = contentToken();
    if (demandedHeavyReads.get(key) === token) return;
    demandedHeavyReads.set(key, token);
    scheduleAsyncRefresh();
  };
  const commentsCatalogMayHaveRows = (): boolean => {
    const entry = asyncReads.get('comments');
    if (!entry?.hasSettled) return entry?.inflightToken != null;
    return Array.isArray(entry.value) && entry.value.length > 0;
  };
  const heavyReadDemandActive = (key: string, token: string): boolean => demandedHeavyReads.get(key) === token;

  const refreshIncompleteTrackChangesDirectories = (): void => {
    const token = contentToken();
    let invalidated = false;
    for (const [key, incompleteToken] of incompleteTrackChangesDirectoryReadTokens) {
      if (incompleteToken !== token) {
        incompleteTrackChangesDirectoryReadTokens.delete(key);
        continue;
      }
      if (postSourceCompletionRefreshTokens.get(key) === token) continue;
      const entry = asyncReads.get(key);
      if (!entry?.hasSettled || entry.token !== token || entry.inflightToken != null) continue;
      // Retain the partial value while making it stale for this token. The next
      // directory recompute starts one revision-fenced read and continues to
      // serve these rows until that read settles.
      asyncReads.set(key, { ...entry, token: null, inflightToken: null });
      postSourceCompletionRefreshTokens.set(key, token);
      invalidated = true;
    }
    if (invalidated) scheduleAsyncRefresh();
  };

  const acquireDirectoryLease = (family: DirectoryFamily): (() => void) => {
    directoryLeaseCounts[family] += 1;

    demandHeavyDocRead(family);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      directoryLeaseCounts[family] = Math.max(0, directoryLeaseCounts[family] - 1);
      if (directoryLeaseCounts[family] === 0 && demandedHeavyReads.get(family) === contentToken()) {
        demandedHeavyReads.delete(family);
      }
      scheduleAsyncRefresh();
    };
  };

  /**
   * Demand-driven route for the content-controls catalog (panel / API use).
   * Explicit demand bypasses both active-loading and post-complete idle holds.
   */
  const ensureContentControlsCatalog = (_reason: 'panel' | 'api'): void => {
    demandHeavyDocRead('contentControls');
  };

  /** Demand-driven route for an explicitly consumed tracked-change list. */
  const ensureTrackChangesCatalog = (): void => {
    const entry = asyncReads.get('trackChanges');
    // Explicit demand is a cold-start escape hatch, not permission to rerun a
    // full-document catalog on every typing revision. Once a value has settled
    // (or the first demand is already in flight), serve it stale while the
    // normal input-idle policy owns refreshes.
    if (entry?.hasSettled || entry?.inflightToken != null) return;
    demandHeavyDocRead('trackChanges');
  };

  /** Demand-driven route for an explicitly consumed comments list. */
  const ensureCommentsCatalog = (): void => {
    const entry = asyncReads.get('comments');
    // Match tracked changes: explicit public consumption can cold-start the
    // authoritative catalog, but after it settles we let the normal source /
    // typing-idle policy decide when a fresh content-token read is safe.
    if (entry?.hasSettled || entry?.inflightToken != null) return;
    demandHeavyDocRead('comments');
  };

  // Source-complete recompute, input-idle-gated. Catalog reads share the
  // kernel worker with mutations and some documents make one read take
  // seconds, so elapsed wall time is never permission to start one during a
  // live typing burst. Stale catalog state remains available until real idle.
  const HEAVY_READ_IDLE_MS = 6500;
  const HEAVY_READ_IDLE_POLL_MS = 250;
  let lastEditableMutationAtMs = 0;
  /**
   * Last burst-class mutation: a local typing command or a remote apply whose
   * originating operation is unavailable. Drives the steady-phase heavy-read
   * hold while one-off local programmatic mutations keep refreshing promptly.
   */
  let lastTypingMutationAtMs = 0;
  /**
   * True from the first deferred heavy read until the input-idle release runs.
   * Held reads stay deferred even after source-complete so a typing-driven
   * recompute cannot bypass the idle gate.
   */
  let heavyReadsHeldUntilIdle = false;
  let heavyReadCompletionRecomputeTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleHeavyReadCompletionRecompute = (): void => {
    if (disposed || heavyReadCompletionRecomputeTimer) return;
    const attempt = (): void => {
      heavyReadCompletionRecomputeTimer = null;
      if (disposed) return;
      const idleForMs = Date.now() - lastEditableMutationAtMs;
      const busy = foregroundMutationActive() || idleForMs < HEAVY_READ_IDLE_MS;
      if (busy) {
        heavyReadCompletionRecomputeTimer = setTimeout(attempt, HEAVY_READ_IDLE_POLL_MS);
        return;
      }
      heavyReadsHeldUntilIdle = false;
      recompute();
    };
    heavyReadCompletionRecomputeTimer = setTimeout(attempt, 0);
  };

  // One loading-snapshot subscription per host so deferred heavy reads are
  // re-attempted exactly when loading reaches a terminal stage.
  let sourceLoadingSubscriptionHost: LooseRecord | null = null;
  let detachSourceLoading: (() => void) | null = null;
  const armSourceLoadCompletionRecompute = (): void => {
    const host = getHost();
    if (!host || sourceLoadingSubscriptionHost === host) return;
    if (detachSourceLoading) {
      detachSourceLoading();
      detachSourceLoading = null;
    }
    sourceLoadingSubscriptionHost = host;
    const subscribe = host.subscribeDocumentLoading;
    if (typeof subscribe !== 'function') {
      // No subscription seam: fall back to the retry timer so deferred reads
      // still re-check the phase instead of staying pending forever.
      sourceLoadingSubscriptionHost = null;
      scheduleForegroundAsyncRetry(HEAVY_READ_IDLE_MS);
      return;
    }
    try {
      const handleLoadingSnapshot = (snapshot: LooseRecord | null | undefined): void => {
        const stage = snapshot?.sourceStage;
        if (stage === 'source-complete' || stage === 'source-failed' || stage === 'source-cancelled') {
          sourceCompletionObservedToken = contentToken();
          refreshIncompleteTrackChangesDirectories();
          // Opening the editing surface is not proof that the user will stay
          // idle. Give the first interaction the same quiet window as an edit
          // before starting any deferred catalog-scale worker read.
          lastEditableMutationAtMs = Math.max(lastEditableMutationAtMs, Date.now());
          scheduleHeavyReadCompletionRecompute();
        }
      };
      // Subscribe before the confirming read. The loading subscription is not
      // replaying, so checking first leaves a gap in which source-complete can
      // land permanently unseen and keep every deferred catalog cold.
      const off = (subscribe as AnyFn).call(host, handleLoadingSnapshot);
      if (typeof off === 'function') detachSourceLoading = off as () => void;
      const read = host.getDocumentLoadingSnapshot;
      if (typeof read === 'function') {
        handleLoadingSnapshot(safeCall<LooseRecord | null>(() => read.call(host) as LooseRecord, null));
      }
    } catch {
      sourceLoadingSubscriptionHost = null;
      scheduleForegroundAsyncRetry(HEAVY_READ_IDLE_MS);
    }
  };

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
      if (pendingSelectionSeedValidationToken && foregroundMutationActive()) {
        scheduleForegroundAsyncRetry();
        recompute();
        return;
      }
      const validationToken = pendingSelectionSeedValidationToken;
      pendingSelectionSeedValidationToken = null;
      if (validationToken === selectionReadToken()) {
        issueAsyncRead('selection', validationToken, selectionCurrentRun, normalizeSelectionInfo);
      }
      recompute();
    }, delayMs);
  };

  const shouldDeferColdAsyncRead = (key: string, token: string): boolean => {
    if (!foregroundMutationState()) return false;
    const deferralKey = `${key}\u0000${token}`;
    if (coldAsyncReadDeferrals.has(deferralKey)) return false;
    coldAsyncReadDeferrals.add(deferralKey);
    scheduleForegroundAsyncRetry(COLD_ASYNC_READ_START_DELAY_MS);
    return true;
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
    readiness: LooseRecord;
    afterEpoch: number | null;
  } | null = null;
  let pendingPostPaintSelectionRefresh: {
    editor: LooseRecord;
    readiness: LooseRecord;
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
    const readiness = editor?.documentMutationReadiness as LooseRecord | undefined;
    if (!editor || typeof readiness?.whenPainted !== 'function') return;
    const afterEpoch =
      typeof readiness.getRenderEpoch === 'function'
        ? safeCall<number | null>(() => readiness.getRenderEpoch.call(readiness), null)
        : null;
    pendingPostPaintContentRefresh = { editor, readiness, afterEpoch };
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
          await request.readiness.whenPainted.call(
            request.readiness,
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
    const readiness = editor?.documentMutationReadiness as LooseRecord | undefined;
    if (!editor || typeof readiness?.whenPainted !== 'function') return false;
    const afterEpoch =
      typeof readiness.getRenderEpoch === 'function'
        ? safeCall<number | null>(() => readiness.getRenderEpoch.call(readiness), null)
        : null;
    pendingPostPaintSelectionRefresh = { editor, readiness, afterEpoch };
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
          await request.readiness.whenPainted.call(
            request.readiness,
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
        seedCaretSelectionFromHost();
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
      if (!disposed) invalidateDocumentContentAndRecompute();
    }, 500);
  };

  const issueAsyncRead = (
    key: string,
    token: string,
    run: () => unknown,
    normalize: (raw: unknown) => unknown,
  ): AsyncReadEntry | null => {
    let raw: unknown;
    try {
      raw = run();
    } catch {
      raw = undefined;
    }
    if (!isPromiseLike(raw)) {
      const settled: AsyncReadEntry = {
        token,
        value: normalize(raw),
        hasSettled: true,
        inflightToken: null,
        failedToken: null,
        failureCount: 0,
        retryAtMs: 0,
      };
      asyncReads.set(key, settled);
      return settled;
    }
    const prev = asyncReads.get(key);
    const retryingSameToken = prev?.failedToken === token;
    asyncReads.set(key, {
      token: prev?.token ?? null,
      value: prev?.value ?? null,
      hasSettled: prev?.hasSettled ?? false,
      inflightToken: token,
      failedToken: retryingSameToken ? token : null,
      failureCount: retryingSameToken ? (prev.failureCount ?? 0) : 0,
      retryAtMs: 0,
    });
    Promise.resolve(raw).then(
      (resolved) => {
        const entry = asyncReads.get(key);
        if (!entry || entry.inflightToken !== token) return; // superseded by a newer read
        asyncReads.set(key, {
          token,
          value: normalize(resolved),
          hasSettled: true,
          inflightToken: null,
          failedToken: null,
          failureCount: 0,
          retryAtMs: 0,
        });
        const { sink, workerContext } = readUiBenchRuntime();
        if (sink) {
          const settledAtMs = uiBenchNowMs();
          pendingAsyncReadSettlements.push({
            key,
            settledAtMs,
            commandId: workerContext?.commandId ?? null,
            commandKind: workerContext?.commandKind ?? null,
          });
          emitUiBenchTiming({
            stage: 'superdoc-ui-async-read-settled',
            atMs: settledAtMs,
            key,
            settledAtMs,
            commandId: workerContext?.commandId ?? null,
            commandKind: workerContext?.commandKind ?? null,
          });
        }
        scheduleAsyncRefresh();
      },
      () => {
        const entry = asyncReads.get(key);
        if (!entry || entry.inflightToken !== token) return;
        const failureCount = entry.failedToken === token ? (entry.failureCount ?? 0) + 1 : 1;
        const retryDelayMs = Math.min(
          ASYNC_READ_FAILURE_RETRY_MAX_MS,
          ASYNC_READ_FAILURE_RETRY_BASE_MS * 2 ** Math.min(failureCount - 1, 8),
        );
        const retryAtMs = Date.now() + retryDelayMs;
        asyncReads.set(key, {
          ...entry,
          inflightToken: null,
          failedToken: token,
          failureCount,
          retryAtMs,
        });
        scheduleAsyncReadFailureRetry(retryAtMs);
      },
    );
    return null;
  };

  /**
   * Read a doc value through the settled cache. Returns the best-known value
   * plus a {@link SliceStatus}: `ready` (settled for this token), `stale`
   * (older settled value while a refresh runs), or `pending` (nothing settled
   * yet). Never returns or surfaces a promise.
   */
  const readAsync = <T>(
    key: string,
    token: string,
    run: () => unknown,
    normalize: (raw: unknown) => T | null,
  ): { value: T | null; status: SliceStatus } => {
    const entry = asyncReads.get(key);
    if (entry && entry.token === token && entry.hasSettled) {
      return { value: entry.value as T | null, status: 'ready' };
    }
    // Heavy-read gate: while the source is actively loading, passive recompute
    // neither cold-starts nor refreshes catalog-scale reads. Settled values
    // (from any token) serve as `stale`; nothing settled serves `pending`.
    // Explicit demand for the current content revision bypasses the gate (and
    // then flows through the normal foreground-mutation deferral below).
    // The hold PERSISTS past source-complete until the input-idle release:
    // without it, the first typing-driven recompute after completion would
    // stampede every deferred catalog read into the keystroke path (the
    // migrated-cliff failure mode the W0 red run pinned).
    if (isHeavyDocReadKey(key) && !heavyReadDemandActive(key, token)) {
      if (hostSourceLoadPhase() === 'loading') {
        heavyReadsHeldUntilIdle = true;
        armSourceLoadCompletionRecompute();
        if (entry?.hasSettled) return { value: entry.value as T | null, status: 'stale' };
        return { value: null, status: 'pending' };
      }
      if (heavyReadsHeldUntilIdle) {
        // Loading finished but the idle release has not fired yet (or the
        // loading subscription was unavailable): keep serving stale/pending
        // and make sure the release is scheduled.
        scheduleHeavyReadCompletionRecompute();
        if (entry?.hasSettled) return { value: entry.value as T | null, status: 'stale' };
        return { value: null, status: 'pending' };
      }
      // Steady-phase typing hold: catalog-scale reads re-fetch per content
      // revision, so a sustained typing burst otherwise re-issues them into
      // every inter-key gap the moment the host's foreground window lapses
      // (measured on North: comments.list occupied the worker for 7.8s and
      // starved the mutation lane). Release only after real input idle.
      const nowMs = Date.now();
      if (nowMs - lastTypingMutationAtMs < HEAVY_READ_IDLE_MS) {
        heavyReadsHeldUntilIdle = true;
        scheduleHeavyReadCompletionRecompute();
        if (entry?.hasSettled) return { value: entry.value as T | null, status: 'stale' };
        return { value: null, status: 'pending' };
      }
    }
    if (foregroundMutationActive()) {
      scheduleForegroundAsyncRetry();
      if (entry?.hasSettled) return { value: entry.value as T | null, status: 'stale' };
      return { value: null, status: 'pending' };
    }
    if (entry?.failedToken === token && entry.inflightToken == null && (entry.retryAtMs ?? 0) > Date.now()) {
      scheduleAsyncReadFailureRetry(entry.retryAtMs!);
      if (entry.hasSettled) return { value: entry.value as T | null, status: 'stale' };
      return { value: null, status: 'pending' };
    }
    if (!entry && key.startsWith('effInline:') && shouldDeferEffectiveInlineRead(key)) {
      return { value: null, status: 'pending' };
    }
    if (!entry && shouldDeferColdAsyncRead(key, token)) {
      return { value: null, status: 'pending' };
    }
    if (!entry || entry.inflightToken !== token) {
      const completed = issueAsyncRead(key, token, run, normalize as (raw: unknown) => unknown);
      if (completed) return { value: completed.value as T | null, status: 'ready' };
    }
    const current = asyncReads.get(key);
    if (current?.hasSettled) return { value: current.value as T | null, status: 'stale' };
    return { value: null, status: 'pending' };
  };

  const clearAsyncReadKeys = (predicate: (key: string) => boolean): void => {
    for (const key of asyncReads.keys()) {
      if (predicate(key)) asyncReads.delete(key);
    }
  };

  const selectionScopedAsyncReadKeys = (selection: SelectionSlice): ReadonlySet<string> => {
    const signature = selectionSignature(selection);
    const effectiveUniformitySignature = selectionEffectiveUniformitySignature(selection);
    return new Set([
      `contentControls:inRange:${signature}`,
      `query:${signature}`,
      ...(effectiveUniformitySignature ? [`effInline:${effectiveUniformitySignature}`] : []),
    ]);
  };

  const pruneSelectionScopedAsyncReads = (selection: SelectionSlice): void => {
    const retained = selectionScopedAsyncReadKeys(selection);
    clearAsyncReadKeys(
      (key) => SELECTION_SCOPED_ASYNC_READ_PREFIXES.some((prefix) => key.startsWith(prefix)) && !retained.has(key),
    );
    for (const key of coldAsyncReadDeferrals) {
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
    if (asyncReadFailureRetryTimer) clearTimeout(asyncReadFailureRetryTimer);
    asyncReadFailureRetryTimer = null;
    asyncReadFailureRetryAtMs = 0;
    if (pendingEffectiveInlineRead?.timer) clearTimeout(pendingEffectiveInlineRead.timer);
    pendingEffectiveInlineRead = null;
    lastEffectiveInlineReadKey = null;
    heldSettledInlineValues = null;
    optimisticParagraphAlignment = null;
    pendingSelectionSeedValidationToken = null;
    coldAsyncReadDeferrals.clear();
    demandedHeavyReads.clear();
    incompleteTrackChangesDirectoryReadTokens.clear();
    postSourceCompletionRefreshTokens.clear();
    sourceCompletionObservedToken = null;
    heavyReadsHeldUntilIdle = false;
    // The loading-snapshot subscription belongs to the previous editor's host;
    // re-arm lazily against the new host on the next deferred heavy read.
    if (detachSourceLoading) detachSourceLoading();
    detachSourceLoading = null;
    sourceLoadingSubscriptionHost = null;
    clearPostDecisionTrackChanges();
    allTrackedChangesResolvedToken = null;
  };

  /** Bump the document-mutation revision so content reads re-fetch on the next compute. */
  const invalidateDocumentContent = (): void => {
    documentMutationRevision += 1;
    incompleteTrackChangesDirectoryReadTokens.clear();
    postSourceCompletionRefreshTokens.clear();
    sourceCompletionObservedToken = null;
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
    if (readDocumentMode() === 'viewing') {
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
    const runtimeSnapshot = safeCall<LooseRecord | null>(
      typeof superdocRecord?.getActiveRuntime === 'function'
        ? () => {
            const runtime = superdocRecord.getActiveRuntime();
            return typeof runtime?.getSnapshot === 'function' ? (runtime.getSnapshot() as LooseRecord | null) : null;
          }
        : undefined,
      null,
    );
    const fromRuntime = normalizeDocumentMode(runtimeSnapshot?.documentMode);
    const fromOptions = normalizeDocumentMode((editor?.options as LooseRecord | undefined)?.documentMode);

    // `superdoc.setDocumentMode(...)` updates the public config synchronously
    // before the runtime snapshot settles. Prefer that public value when they
    // disagree so shell controls do not lag a mode change by one tick.
    if (fromConfig && fromRuntime && fromConfig !== fromRuntime) return fromConfig;
    return fromRuntime ?? fromConfig ?? fromOptions;
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
    if (readDocumentMode() === 'viewing') return SUPERDOC_UI_REASONS.documentReadonly;

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

  const commentMutationsAreReadOnly = (): boolean => readDocumentMode() === 'viewing' || commentsAreReadOnly();
  const trackedChangeDecisionsAreDisabled = (): boolean => trackedChangeDecisionDisabledReason() != null;

  const normalizeSelectionInfo = (raw: unknown): SelectionInfo | null =>
    raw && typeof raw === 'object' ? (raw as SelectionInfo) : null;

  const selectionSliceFromInfo = (info: SelectionInfo | null, status: SliceStatus): SelectionSlice => {
    if (!info) return { ...EMPTY_SELECTION, status };
    const target = (info.target ?? null) as SelectionSlice['target'];
    const quotedText = typeof info.text === 'string' ? info.text : '';
    return {
      status,
      empty: info.empty === true,
      target,
      selectionTarget: (info.selectionTarget ?? null) as SelectionSlice['selectionTarget'],
      activeMarks: Array.isArray(info.activeMarks) ? (info.activeMarks as string[]) : [],
      activeCommentIds: Array.isArray(info.activeCommentIds) ? (info.activeCommentIds as string[]) : [],
      activeChangeIds: Array.isArray(info.activeChangeIds) ? (info.activeChangeIds as string[]) : [],
      quotedText,
    };
  };

  const readSelectionInfoLive = (): { value: SelectionInfo | null; status: SliceStatus } => {
    const doc = getDoc();
    const selectionApi = doc?.selection as LooseRecord | undefined;
    return readAsync<SelectionInfo>(
      'selection',
      selectionReadToken(),
      () => (selectionApi?.current ? selectionApi.current({ includeText: true }) : undefined),
      normalizeSelectionInfo,
    );
  };

  const computeSelection = (): SelectionSlice => {
    // Request the model-backed quoted text so `quotedText` is truthful and the
    // emptiness comes from the selection source (`info.empty`), not from whether
    // text happened to be extracted. The read flows through the coordinator so a
    // promise-returning browser selection read settles into the cache rather
    // than collapsing the slice to empty.
    const { value: info, status } = readSelectionInfoLive();
    return selectionSliceFromInfo(info, status);
  };

  const selectionCurrentRun = (): unknown => {
    const selectionApi = getDoc()?.selection as LooseRecord | undefined;
    return selectionApi?.current ? selectionApi.current({ includeText: true }) : undefined;
  };

  /** True when a host sync snapshot is a resolved collapsed caret (not a range). */
  const isCollapsedCaretSnapshot = (info: SelectionInfo): boolean => {
    if (info.empty !== true) return false;
    const target = info.selectionTarget as LooseRecord | null;
    const start = target?.start as LooseRecord | undefined;
    const end = target?.end as LooseRecord | undefined;
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
   * (SD-3652). Only a resolvable COLLAPSED CARET is seeded - a range's snapshot
   * cannot be resolved synchronously in worker mode, so ranges defer to the async
   * read (seeding an empty value would wrongly disable range-only commands). The
   * authoritative async read still overwrites marks/text/review overlap, but
   * foreground typing defers and coalesces that worker hop through the shared
   * retry gate. Previous marks are carried forward for toolbar continuity. A
   * tracked-change id is carried only when the host's painted caret proves the
   * same carrier, or while an active typing dispatch advances the same caret by
   * one code point. Pending work alone never carries review command context.
   */
  const seedCaretSelectionFromHost = (hostSelectionSnapshot?: unknown): void => {
    const host = getHost();
    const read = host?.readLiveSelectionSyncSnapshot;
    if (typeof read !== 'function') return;
    const seed = normalizeSelectionInfo(safeCall(() => (read as AnyFn).call(host), null));
    if (!seed || !isCollapsedCaretSnapshot(seed)) return;
    const token = selectionReadToken();
    const foreground = foregroundMutationState();
    const deferAuthoritativeRead = Boolean(foreground && (foreground.active > 0 || foreground.pending > 0));
    if (!deferAuthoritativeRead) {
      pendingSelectionSeedValidationToken = null;
      const completed = issueAsyncRead('selection', token, selectionCurrentRun, normalizeSelectionInfo);
      if (completed) return;
    } else {
      pendingSelectionSeedValidationToken = token;
      scheduleForegroundAsyncRetry();
    }
    const prev = asyncReads.get('selection');
    const seedMarks =
      Array.isArray(seed.activeMarks) && seed.activeMarks.length > 0
        ? seed.activeMarks
        : Array.isArray(state.selection.activeMarks)
          ? state.selection.activeMarks
          : [];
    const seedCommentIds = Array.isArray(seed.activeCommentIds) ? seed.activeCommentIds : [];
    const paintedTrackChangeId = readCollapsedHostTrackChangeId(hostSelectionSnapshot);
    const previousCaret = collapsedTextAddressFromSelection(state.selection);
    const nextCaret =
      collapsedTextAddressFromTarget(seed.selectionTarget) ?? collapsedTextAddressFromTarget(seed.target);
    const previousRange = previousCaret?.range as LooseRecord | undefined;
    const nextRange = nextCaret?.range as LooseRecord | undefined;
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
    asyncReads.set('selection', {
      token,
      value: {
        ...seed,
        activeMarks: seedMarks,
        activeCommentIds: seedCommentIds,
        activeChangeIds: seedChangeIds,
      },
      hasSettled: true,
      inflightToken: deferAuthoritativeRead ? null : (prev?.inflightToken ?? null),
    });
  };

  const readSelectionInfoFresh = async (attempt = 0): Promise<SelectionSlice> => {
    const doc = getDoc();
    const selectionApi = doc?.selection as LooseRecord | undefined;
    const current = selectionApi?.current;
    const token = selectionReadToken();

    if (typeof current !== 'function') {
      asyncReads.set('selection', { token, value: null, hasSettled: true, inflightToken: null });
      recompute();
      return state.selection;
    }

    let raw: unknown;
    try {
      raw = current.call(selectionApi, { includeText: true });
      if (isPromiseLike(raw)) raw = await Promise.resolve(raw);
    } catch {
      raw = null;
    }

    if (disposed) return selectionSliceFromInfo(null, 'pending');
    if (selectionReadToken() !== token) {
      return attempt < 1 ? readSelectionInfoFresh(attempt + 1) : state.selection;
    }

    asyncReads.set('selection', {
      token,
      value: normalizeSelectionInfo(raw),
      hasSettled: true,
      inflightToken: null,
    });
    recompute();
    return state.selection;
  };

  const readCommentsDirectory = () => {
    const doc = getDoc();
    const commentsApi = doc?.comments as LooseRecord | undefined;
    return readAsync<CommentInfo[]>(
      'comments',
      contentToken(),
      () => (commentsApi?.list ? commentsApi.list() : undefined),
      (raw) => (raw && Array.isArray((raw as LooseRecord).items) ? ((raw as LooseRecord).items as CommentInfo[]) : []),
    );
  };

  const readTrackChangesDirectory = (key = 'trackChanges') => {
    const token = contentToken();
    const doc = getDoc();
    const tcApi = doc?.trackChanges as LooseRecord | undefined;
    const v2TrackedChanges = getV2TrackedChanges();
    const listTrackedChanges =
      typeof v2TrackedChanges?.listTrackedChanges === 'function'
        ? (v2TrackedChanges.listTrackedChanges as AnyFn)
        : null;
    const read = readAsync<LooseRecord[]>(
      key,
      token,
      () => {
        if (listTrackedChanges) return runUiTrackedChangesCatalogRead(() => tcApi?.list?.({ in: 'all' }));
        return tcApi?.list ? tcApi.list({ in: 'all' }) : undefined;
      },
      (raw) => {
        const result = raw && typeof raw === 'object' ? (raw as LooseRecord) : null;
        if (result?.complete === false || result?.sourceCoverageComplete === false) {
          incompleteTrackChangesDirectoryReadTokens.set(key, token);
          armSourceLoadCompletionRecompute();
          // Source completion can race the promise settlement: the event may
          // arrive after the adapter captured an incomplete result but before
          // this normalizer publishes it. Defer the refresh check until after
          // issueAsyncRead stores the partial entry, and cap it at one attempt
          // per content token.
          if (sourceCompletionObservedToken === token || hostSourceLoadPhase() === 'complete') {
            const refresh = (): void => {
              if (!disposed) refreshIncompleteTrackChangesDirectories();
            };
            if (typeof queueMicrotask === 'function') queueMicrotask(refresh);
            else void Promise.resolve().then(refresh);
          }
        } else if (incompleteTrackChangesDirectoryReadTokens.get(key) === token) {
          incompleteTrackChangesDirectoryReadTokens.delete(key);
        }
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
    const windowItems =
      hasWindowFeed && Array.isArray(reviewWindow?.commentItems) ? (reviewWindow.commentItems as CommentInfo[]) : null;
    const value = hasWindowFeed ? windowItems : catalog!.value;
    const listStatus = hasWindowFeed ? reviewWindowSliceStatus(reviewWindow) : catalog!.status;
    const items = value ?? [];
    const activeIds = selection.activeCommentIds;
    const directory = asyncReads.get('comments');
    const directoryItems =
      directory?.token === contentToken() && directory.hasSettled && Array.isArray(directory.value)
        ? directory.value
        : null;
    // An open document-wide consumer may focus an off-window row. Preserve it
    // while that directory is refreshing, and validate it against the settled
    // directory rather than against the painted page window.
    const activeValidationItems = directoryLeaseCounts.comments > 0 ? directoryItems : items;
    if (
      explicitActiveCommentId &&
      activeValidationItems &&
      !activeValidationItems.some((item) => readEntityId(item) === explicitActiveCommentId)
    ) {
      explicitActiveCommentId = null;
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
      const row = item as LooseRecord;
      const author = change.author ?? change.authorEmail ?? row.author ?? row.authorEmail;
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
        directory?.token === token && directory.hasSettled && Array.isArray(directory.value)
          ? filterPostDecisionTrackChanges(projectTrackChangesItems(directory.value), postDecisionIds)
          : null;
      const activeValidationItems =
        directoryLeaseCounts.trackChanges > 0 ? directoryItems : active.story ? allStoryItems : items;
      if (
        activeValidationItems &&
        !activeValidationItems.some((row) => entityRowMatchesRequest(row, active.id, active.story))
      ) {
        setExplicitActiveChange(null);
      }
    }
    const publicIdItems = allStoryItems ?? items;
    const selectionIdContext = buildStoryScopedTrackedChangeIdContext(publicIdItems, selectionStory(selection));
    const selectionActiveChangeIds =
      allTrackedChangesResolvedToken === token
        ? []
        : postDecisionIds
          ? selection.activeChangeIds.filter((id) => !postDecisionIds.has(id))
          : selection.activeChangeIds;
    const selectionPublicChangeIds = selectionActiveChangeIds.map((id) => selectionIdContext.toPublicId(id) ?? id);
    const explicitActiveIdContext = explicitActiveChange?.story
      ? buildStoryScopedTrackedChangeIdContext(publicIdItems, explicitActiveChange.story)
      : buildTrackedChangeIdContext(publicIdItems);
    const explicitActiveId = explicitActiveChange
      ? (explicitActiveIdContext.toPublicId(explicitActiveChange.id) ?? explicitActiveChange.id)
      : null;
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
    const explicitIdContext = explicitActiveChange?.story
      ? buildStoryScopedTrackedChangeIdContext(items, explicitActiveChange.story)
      : buildTrackedChangeIdContext(items);
    const activeId = explicitActiveChange
      ? (explicitIdContext.toPublicId(explicitActiveChange.id) ?? explicitActiveChange.id)
      : windowSnapshot.activeId;
    return {
      status: combineStatus(directory.status, selection.status),
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
    const { value, status: listStatus } = readAsync<ContentControlsSlice['items']>(
      'contentControls',
      contentToken(),
      () => (ccApi?.list ? ccApi.list() : undefined),
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
    if (!ccApi || typeof ccApi.listInRange !== 'function') {
      return { lockModesById: new Map(), rows: [], status: 'ready' };
    }
    const range = selectionBlockRange(selection);
    if (!range) return { lockModesById: new Map(), rows: [], status: 'ready' };
    const { value, status } = readAsync<ContentControlInfo[]>(
      `contentControls:inRange:${selectionSignature(selection)}`,
      contentToken(),
      () => ccApi.listInRange(range),
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

  const computeActiveContentControls = (
    ccApi: LooseRecord | undefined,
    selection: SelectionSlice,
  ): { items: ContentControlInfo[]; status: SliceStatus } => {
    const { rows, status } = computeActiveContentControlLockModes(ccApi, selection);
    const explicitTarget = selection.selectionTarget as LooseRecord | null;
    const selectionTarget = selection.target as LooseRecord | null;
    let selectionAnchor = explicitTarget?.start as LooseRecord | undefined;
    if (explicitTarget) {
      if (
        explicitTarget.kind !== 'selection' ||
        selectionAnchor?.kind !== 'text' ||
        typeof selectionAnchor.blockId !== 'string' ||
        typeof selectionAnchor.offset !== 'number'
      ) {
        return retainSettledActiveContentControls([], status);
      }
    } else {
      const firstSegment =
        selectionTarget?.kind === 'text' && Array.isArray(selectionTarget.segments)
          ? (selectionTarget.segments[0] as LooseRecord | undefined)
          : undefined;
      const firstRange = firstSegment?.range as LooseRecord | undefined;
      if (typeof firstSegment?.blockId !== 'string' || typeof firstRange?.start !== 'number') {
        return retainSettledActiveContentControls([], status);
      }
      selectionAnchor = {
        kind: 'text',
        blockId: firstSegment.blockId,
        offset: firstRange.start,
        story: selectionTarget?.story,
      };
    }
    const visibleSegments =
      selectionTarget?.coordinateSpace !== 'tracked' && Array.isArray(selectionTarget?.segments)
        ? (selectionTarget.segments as LooseRecord[])
        : [];
    const visibleSegment = visibleSegments.find((segment) => segment.blockId === selectionAnchor.blockId);
    const visibleRange = visibleSegment?.range as LooseRecord | undefined;
    const visibleStart =
      visibleSegment && typeof visibleSegment.blockId === 'string' && typeof visibleRange?.start === 'number'
        ? {
            kind: 'text',
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
    const selectionStartIndex = selectedBlockIds.indexOf((selectionStart ?? selectionAnchor).blockId as string);

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
    const fontsApi = superdoc?.fonts as LooseRecord | undefined;
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
      safeCall<unknown[]>(fontsApi?.getDocumentFontOptions ? () => fontsApi.getDocumentFontOptions() : undefined, []),
    );
    const pickerOptions = normalizePickerFontOptions(
      safeCall<unknown[]>(fontsApi?.getFontFamilyOptions ? () => fontsApi.getFontFamilyOptions() : undefined, []),
    );
    return {
      options: composeFontFamilyOptions(documentOptions, pickerOptions),
      sizeOptions: DEFAULT_FONT_SIZE_OPTIONS,
    };
  };

  const computeZoom = (): ZoomSlice => {
    const state = safeCall<LooseRecord | null>(
      superdoc?.getZoomState ? () => superdoc.getZoomState() : undefined,
      null,
    );
    const value = typeof state?.value === 'number' ? state.value : 100;
    const rawMode = state?.mode;
    const mode = rawMode === 'manual' || rawMode === 'fit-width' ? rawMode : rawMode === 'fixed' ? 'manual' : null;
    const min = typeof state?.min === 'number' ? state.min : 10;
    const max = typeof state?.max === 'number' ? state.max : 100;
    return { mode, value, min, max };
  };

  const readMeasurementUnit = (): 'in' | 'cm' => {
    const unit = safeCall<unknown>(
      superdoc?.getMeasurementUnit ? () => superdoc.getMeasurementUnit() : undefined,
      'in',
    );
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
    const target = selection.target as LooseRecord | null;
    const within = segments.length === 1 ? paragraphTarget(segments[0].blockId, target?.story) : undefined;
    return {
      select: { type: 'text', pattern, mode: 'contains', caseSensitive: true },
      ...(within ? { within } : {}),
      require: 'any',
    };
  };

  const resolveSelectionTextQueryItem = (selection: SelectionSlice): LooseRecord | null => {
    const doc = getDoc();
    const query = doc?.query as LooseRecord | undefined;
    if (typeof query?.match !== 'function') return null;
    const request = selectionTextQueryRequest(selection);
    if (!request) return null;
    const { value } = readAsync<LooseRecord>(
      `query:${selectionSignature(selection)}`,
      contentToken(),
      () => query.match(request),
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
  const resolveEffectiveInlineValuesFromLayout = (selection: SelectionSlice): ProjectedInlineSelectionValues => {
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
      const uniformity = resolveEffectiveInlineUniformityValues(selection);
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

  const readEffectiveInlineUniformityCached = (
    selection: SelectionSlice,
  ): { value: LooseRecord | null; status: SliceStatus } => {
    const target = selection.selectionTarget;
    if (!target) return { value: null, status: 'ready' };
    const doc = getDoc();
    const op = resolveDocOperation(doc, 'format.readEffectiveInlineUniformity');
    if (!op) return { value: null, status: 'ready' };
    const signature = selectionEffectiveUniformitySignature(selection) ?? selectionSignature(selection);
    return readAsync<LooseRecord>(
      `effInline:${signature}`,
      contentToken(),
      () => op({ target, offsetSpace: 'selection', keys: EFFECTIVE_INLINE_UNIFORMITY_KEYS }),
      (raw) => (raw && typeof raw === 'object' ? (raw as LooseRecord) : null),
    );
  };

  const resolveEffectiveInlineUniformityValues = (
    selection: SelectionSlice,
  ): {
    values: Pick<ProjectedInlineSelectionValues, 'fontFamily' | 'fontSize'> | null;
    status: SliceStatus;
  } => {
    const { value, status } = readEffectiveInlineUniformityCached(selection);
    if (!value || value.success !== true) return { values: null, status };
    const states = value.values as LooseRecord | undefined;
    const uniform = (key: 'fontFamily' | 'fontSize'): string | undefined => {
      const entry = states?.[key] as LooseRecord | undefined;
      if (!entry || entry.state !== 'uniform' || typeof entry.value !== 'string') return undefined;
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
    const { value, status } = readEffectiveInlineUniformityCached(selection);
    if (!value || value.success !== true) return { values: null, status };
    const states = value.values as LooseRecord | undefined;
    const values: EffectiveMarkValues = {};
    for (const key of EFFECTIVE_MARK_KEYS) {
      const entry = states?.[key] as LooseRecord | undefined;
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

  const readEffectiveInlineUniformityNow = async (selection: SelectionSlice): Promise<LooseRecord | null> => {
    const target = selection.selectionTarget;
    if (!target) return null;
    const op = resolveDocOperation(getDoc(), 'format.readEffectiveInlineUniformity');
    if (!op) return null;
    try {
      const raw = await Promise.resolve(op({ target, offsetSpace: 'selection' }));
      return raw && typeof raw === 'object' && (raw as LooseRecord).success === true ? (raw as LooseRecord) : null;
    } catch {
      return null;
    }
  };

  const applyEffectiveInlineUniformity = (
    projected: ProjectedInlineSelectionValues,
    direct: ProjectedInlineSelectionValues,
    result: LooseRecord,
  ): void => {
    const states = result.values as LooseRecord | undefined;
    for (const key of ['fontFamily', 'fontSize'] as const) {
      if (direct[key] !== undefined) continue;
      const entry = states?.[key] as LooseRecord | undefined;
      if (entry?.state === 'uniform' && typeof entry.value === 'string') {
        projected[key] = key === 'fontFamily' ? normalizeLayoutFontFamily(entry.value) : entry.value;
      } else {
        delete projected[key];
      }
    }
  };

  const projectSelectionInlineValuesWithStatus = (selection: SelectionSlice): ProjectedInlineValuesRead =>
    completeProjectedInlineValues(
      selection,
      projectInlineValuesFromQueryItem(resolveSelectionTextQueryItem(selection), selection),
    );

  const projectSelectionInlineValues = (selection: SelectionSlice): ProjectedInlineSelectionValues =>
    projectSelectionInlineValuesWithStatus(selection).values;

  /**
   * Read command-critical inline values for format-painter capture. Reactive
   * command state intentionally serves stale values while its worker read is
   * refreshing, but arming the painter must snapshot the mutation that just
   * settled. A direct, bounded query here makes the async capture authoritative
   * without changing the non-blocking toolbar snapshot policy.
   */
  const readFormatPainterInlineValues = async (selection: SelectionSlice): Promise<ProjectedInlineSelectionValues> => {
    const doc = getDoc();
    const query = doc?.query as LooseRecord | undefined;
    const request = selectionTextQueryRequest(selection);
    if (typeof query?.match !== 'function' || !request) {
      return projectSelectionInlineValues(selection);
    }

    try {
      const raw = await Promise.resolve(query.match(request));
      const result = raw && typeof raw === 'object' ? (raw as LooseRecord) : null;
      const direct = projectInlineValuesFromQueryItem(pickSelectionTextQueryItem(result, selection), selection);
      const completed = completeProjectedInlineValues(selection, direct);
      if (
        completed.effectiveUniformityStatus !== 'ready' &&
        (direct.fontFamily === undefined || direct.fontSize === undefined)
      ) {
        const effective = await readEffectiveInlineUniformityNow(selection);
        if (effective) applyEffectiveInlineUniformity(completed.values, direct, effective);
      }
      return completed.values;
    } catch {
      return projectSelectionInlineValues(selection);
    }
  };

  const readBlockNode = async (address: LooseRecord): Promise<LooseRecord | undefined> => {
    const doc = getDoc();
    if (!doc) return undefined;
    if (typeof (doc as LooseRecord).getNode === 'function') {
      return (await Promise.resolve((doc as LooseRecord).getNode(address))) as LooseRecord | undefined;
    }
    return (await Promise.resolve(
      (doc as LooseRecord).getNodeById?.({
        nodeId: address['nodeId'],
        nodeType: address['nodeType'],
      }),
    )) as LooseRecord | undefined;
  };

  /**
   * Returns the settled status of the query.match read backing the current
   * selection's inline-value projection. Called after resolveSelectionTextQueryItem
   * so readAsync always finds an existing cache entry — this is a status-only lookup.
   */
  const selectionQueryStatus = (selection: SelectionSlice): SliceStatus => {
    const doc = getDoc();
    const query = doc?.query as LooseRecord | undefined;
    if (typeof query?.match !== 'function') return 'ready';
    const request = selectionTextQueryRequest(selection);
    if (!request) return 'ready';
    const { status } = readAsync<LooseRecord>(
      `query:${selectionSignature(selection)}`,
      contentToken(),
      () => query.match(request),
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
    if (selection.empty) return projection;
    const signature = selectionInlineValueSignature(selection);
    if (!signature) return projection;
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
    const { lockModesById } = computeActiveContentControlLockModes(ccApi, selection);
    const states: Record<string, CommandState> = {};
    for (const id of allCommandIds()) {
      states[id] = computeCommandState(id, doc, selection, projectedInlineValues, lockModesById);
    }
    return states;
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
      return SUPERDOC_UI_REASONS.selectionRequired;
    }
    return undefined;
  };

  const findTrackChangeForPermission = (id: string): LooseRecord | null => {
    // AIDEV-NOTE: `state` is assigned from the first `computeState()` result, so
    // this lookup runs during that pass before the slice exists.
    const fromSlice = state?.trackChanges?.items?.find((item) => readEntityId(item) === id);
    if (fromSlice) return trackChangesItemPayload(fromSlice);
    const listed = safeCall<unknown>(() => (getDoc()?.trackChanges as LooseRecord | undefined)?.list?.(), null);
    if (!listed || typeof listed !== 'object' || typeof (listed as LooseRecord).then === 'function') return null;
    const items = (listed as LooseRecord).items;
    if (!Array.isArray(items)) return null;
    const row = items.find((item) => readEntityId(item) === id);
    if (!row) return null;
    const projected = projectTrackChangesItem(row);
    return projected ? trackChangesItemPayload(projected) : (row as LooseRecord);
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
    for (const id of ids) {
      const trackedChange = findTrackChangeForPermission(id) ?? { id };
      const isOwn = trackedChangeOwnedByCurrentUser(trackedChange, currentUser);
      const permission =
        kind === 'accept' ? (isOwn ? 'RESOLVE_OWN' : 'RESOLVE_OTHER') : isOwn ? 'REJECT_OWN' : 'REJECT_OTHER';
      let allowed: unknown;
      try {
        allowed = canPerform.call(superdoc, { permission, trackedChange, comment: null });
      } catch {
        return undefined;
      }
      if (allowed === false) return SUPERDOC_UI_REASONS.permissionDenied;
    }
    return undefined;
  };

  const hostCommandSupport = (command: string): LooseRecord | null => {
    const host = getHost();
    const capabilities = safeCall<LooseRecord | null>(
      typeof host?.getCapabilities === 'function' ? () => host.getCapabilities() : undefined,
      null,
    );
    const commands = capabilities?.editableSubset?.commands;
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
    const readonly = readDocumentMode() === 'viewing';
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
          { enabled, active: activeSeed === listKind, supported, value: entry?.value },
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
      if (readDocumentMode() === 'viewing') {
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
      const enabled = selectionBlockIds(selection).length > 0 || resolveInlineSelectionTarget(selection) != null;
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
    if (descriptor.inline && !resolveInlineSelectionTarget(selection)) {
      // Word parity (SD-3274): a collapsed caret is the common case for a
      // locked content control (no range to resolve a target from) — must
      // not report the button as clickable here only for `executeCommand`'s
      // matching lock check to silently no-op the click.
      const lockReason = contentControlLockReason(lockModesById);
      if (lockReason) {
        return normalizeCommandState({ enabled: false, active, supported: true, value, reason: lockReason }, 'builtin');
      }
      const canStorePending =
        selectionBlockIds(selection).length > 0 && typeof getHost()?.setPendingInlineFormat === 'function';
      return normalizeCommandState(
        canStorePending
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
    const anchor = (link.address as LooseRecord | undefined)?.anchor as LooseRecord | undefined;
    const start = anchor?.start as LooseRecord | undefined;
    const end = anchor?.end as LooseRecord | undefined;
    const linkBlockId = typeof start?.blockId === 'string' ? start.blockId : null;
    const linkEndBlockId = typeof end?.blockId === 'string' ? end.blockId : null;
    if (!linkBlockId || !linkEndBlockId) return false;
    const linkStart = typeof start?.offset === 'number' ? start.offset : null;
    const linkEnd = typeof end?.offset === 'number' ? end.offset : null;
    if (linkStart == null || linkEnd == null) return false;

    const target = selection.target as LooseRecord | null;
    const segments = target && Array.isArray(target.segments) ? (target.segments as LooseRecord[]) : [];
    for (const segment of segments) {
      const segmentBlockId = typeof segment?.blockId === 'string' ? segment.blockId : null;
      if (!segmentBlockId) continue;
      const range = segment.range as LooseRecord | undefined;
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
    const linksApi = doc?.hyperlinks as LooseRecord | undefined;
    if (!linksApi || typeof linksApi.list !== 'function') return null;
    const blockIds = selectionBlockIds(selection);
    if (!canProbeEverySelectedBlock(blockIds)) return null;
    for (const blockId of blockIds) {
      const within = { kind: 'block', nodeType: 'paragraph', nodeId: blockId };
      const { value: result } = readAsync<LooseRecord>(
        `hyperlinks:${blockId}`,
        contentToken(),
        () => linksApi.list({ within }),
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
      const { style: active } = computeActiveParagraphStyle(selection, getStyleCatalog().cache);
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
  ): { value: LooseRecord | null; status: SliceStatus } => {
    const listsApi = doc?.lists as LooseRecord | undefined;
    if (!listsApi) return { value: null, status: 'ready' };
    const isBodyStory = story.storyType === 'body';
    const readState =
      typeof listsApi.getStateInStory === 'function'
        ? () => listsApi.getStateInStory({ target: listsBlockTarget(blockId), story })
        : isBodyStory && typeof listsApi.getState === 'function'
          ? () => listsApi.getState({ target: listsBlockTarget(blockId) })
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
  const readListStateForBlock = (doc: LooseRecord | null, blockId: string, story: LooseRecord): LooseRecord | null => {
    return readListStateSnapshotForBlock(doc, blockId, story).value;
  };

  /** Read one block's list seed (`'bullet'` / `'ordered'`) in the selected story. */
  const readListSeedForBlock = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
  ): 'bullet' | 'ordered' | null => {
    const result = readListStateForBlock(doc, blockId, story);
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
  ): { value: boolean | null; status: SliceStatus } => {
    const snapshot = readListStateSnapshotForBlock(doc, blockId, story);
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
    const firstSeed = readListSeedForBlock(doc, blockIds[0], story);
    if (firstSeed !== 'bullet' && firstSeed !== 'ordered') return null;
    for (const blockId of blockIds.slice(1)) {
      if (readListSeedForBlock(doc, blockId, story) !== firstSeed) return null;
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
          ? (doc.getNodeById as AnyFn)({ nodeId: blockId, nodeType: 'paragraph' })
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
    const listsApi = doc?.lists as LooseRecord | undefined;
    if (!listsApi) return unavailable;
    const isBodyStory = story.storyType === 'body';
    const readState =
      typeof listsApi.getStateInStory === 'function'
        ? () => listsApi.getStateInStory({ target: listsBlockTarget(blockId), story })
        : isBodyStory && typeof listsApi.getState === 'function'
          ? () => listsApi.getState({ target: listsBlockTarget(blockId) })
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
            ? await (doc.getNodeById as AnyFn)({ nodeId: blockId, nodeType: 'paragraph' })
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
        const { value: isListItem, status } = readListMembershipSnapshotForBlock(doc, blockId, story);
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
        : readListMembershipSnapshotForBlock(doc, blockId, story);
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

    const snapshots = blockIds.map((blockId) => readListStateSnapshotForBlock(doc, blockId, story));
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
    const ready = context != null && (!descriptor.table!.requiresCell || context.cellNodeId != null);
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
    if (descriptor.id === 'zoom') return typeof payload === 'number' && Number.isFinite(payload) && payload > 0;
    if (descriptor.id === 'document-mode') {
      return payload === 'editing' || payload === 'suggesting' || payload === 'viewing';
    }
    if (descriptor.id === 'measurement-unit') return payload === 'in' || payload === 'cm';
    return true;
  };

  const allCommandIds = (): string[] => {
    return [...new Set([...ALL_BUILT_IN_COMMAND_IDS, ...customCommands.keys()])];
  };

  // -- styles ---------------------------------------------------------------
  // The Document API default paragraph style id when the catalogue omits one.
  const DEFAULT_PARAGRAPH_STYLE_ID = 'Normal';

  const EMPTY_STYLES_SLICE: StylesSlice = {
    ready: false,
    status: 'ready',
    catalogRevision: null,
    quickGallery: [],
    activeParagraphStyleId: null,
    activeParagraphStyleName: null,
    mixedSelection: false,
    sourceStatus: null,
    diagnostics: [],
  };

  const styleCatalogReadKey = (input?: StylesGetCatalogInput): string =>
    `styles:catalog:${JSON.stringify(input ?? {})}`;

  /**
   * Read the public Document API style catalogue (`doc.styles.getCatalog`)
   * through the async read coordinator. A promise-returning browser read
   * settles into the cache (keyed by content revision) instead of collapsing
   * the catalogue to `null`. `value` is `null` when the styles surface is
   * unreachable (worker-backed `doc` is null or the operation is missing); the
   * accompanying {@link SliceStatus} reports pending/stale/ready.
   */
  const readStyleCatalogLive = (
    input?: StylesGetCatalogInput,
  ): { value: StylesGetCatalogResult | null; status: SliceStatus } => {
    const doc = getDoc();
    const stylesApi = doc?.styles as LooseRecord | undefined;
    if (!stylesApi || typeof stylesApi.getCatalog !== 'function') return { value: null, status: 'ready' };
    return readAsync<StylesGetCatalogResult>(
      styleCatalogReadKey(input),
      contentToken(),
      () => (stylesApi.getCatalog as AnyFn)(input),
      (raw) => (raw && typeof raw === 'object' ? (raw as StylesGetCatalogResult) : null),
    );
  };

  /** Resolve the catalogue (coordinator-cached by content revision) plus its readiness. */
  const getStyleCatalog = (): { cache: StyleCatalogCache | null; status: SliceStatus } => {
    const full = readStyleCatalogLive({ includePreview: true });
    if (!full.value) return { cache: null, status: full.status };
    // The authoritative quick-gallery ordering (including the v1-style
    // alphabetical fallback for documents without `qFormat` metadata) only
    // comes from the `quickGallery` view; deriving it by filtering `styles`
    // would miss that fallback. Fall back to the visibility flag only if the
    // dedicated view read fails.
    const quickResult = readStyleCatalogLive({ view: 'quickGallery', includePreview: true });
    const quickGallery: readonly StyleCatalogItem[] = quickResult.value
      ? quickResult.value.items
      : full.value.styles.filter((item) => item.visibility.quickGallery);
    const byId = new Map<string, StyleCatalogItem>();
    for (const item of full.value.styles) byId.set(item.id, item);
    return {
      cache: { full: full.value, quickGallery, byId },
      status: combineStatus(full.status, quickResult.status),
    };
  };

  /**
   * Read one block's paragraph `styleRef` through the public `getNodeById`
   * read. `ok` distinguishes a successful read (styleRef may be null when the
   * paragraph has no explicit style) from an unavailable read (no operation, a
   * promise in worker mode, or a missing node) so active-style resolution can
   * fail closed precisely.
   */
  const readBlockStyleRef = (
    doc: LooseRecord | null,
    blockId: string,
    story: LooseRecord,
  ): { ok: boolean; styleRef: string | null; status: SliceStatus } => {
    const { value: result, status } = readNodeById(doc, blockId, story);
    if (!result) return { ok: false, styleRef: null, status };
    const node = result.node;
    if (!node || typeof node !== 'object') return { ok: false, styleRef: null, status };
    const kind = (node as LooseRecord).kind;
    const payload = typeof kind === 'string' ? ((node as LooseRecord)[kind] as LooseRecord | undefined) : undefined;
    const raw = payload && typeof payload === 'object' ? payload.styleRef : undefined;
    const styleRef = typeof raw === 'string' && raw.length > 0 ? raw : null;
    return { ok: true, styleRef, status };
  };

  /**
   * Resolve the active paragraph style from the current selection. Handles the
   * uniform, default (no explicit style → document default paragraph style),
   * and mixed cases, and fails closed with diagnostics when block reads are
   * unavailable.
   */
  const computeActiveParagraphStyle = (
    selection: SelectionSlice,
    catalog: StyleCatalogCache | null,
  ): { style: ActiveParagraphStyle; status: SliceStatus } => {
    const diagnostics: StyleCatalogDiagnostic[] = [];
    const doc = getDoc();
    if (!doc) {
      diagnostics.push({
        severity: 'warning',
        code: 'active-style-unavailable',
        message: 'Active paragraph style is unavailable: the Document API is not reachable.',
      });
      return { style: { styleId: null, styleName: null, mixed: false, diagnostics }, status: 'ready' };
    }
    const blockIds = selectionBlockIds(selection);
    if (blockIds.length === 0) {
      diagnostics.push({
        severity: 'info',
        code: 'active-style-no-selection',
        message: 'No paragraph block is resolvable from the current selection; active paragraph style is unavailable.',
      });
      return { style: { styleId: null, styleName: null, mixed: false, diagnostics }, status: 'ready' };
    }
    if (!canProbeEverySelectedBlock(blockIds)) {
      diagnostics.push({
        severity: 'info',
        code: 'active-style-selection-too-large',
        message: 'Active paragraph style is unavailable for a large multi-paragraph selection.',
      });
      return { style: { styleId: null, styleName: null, mixed: false, diagnostics }, status: 'ready' };
    }
    const defaultId = catalog?.full.defaults.paragraphStyleId ?? (catalog ? DEFAULT_PARAGRAPH_STYLE_ID : null);
    const resolvedIds = new Set<string>();
    let resolved = 0;
    let blockReadFailures = 0;
    let defaultReadFailures = 0;
    let readStatus: SliceStatus = 'ready';
    const story = selectionStory(selection);
    for (const blockId of blockIds) {
      const read = readBlockStyleRef(doc, blockId, story);
      readStatus = combineStatus(readStatus, read.status);
      if (!read.ok) {
        blockReadFailures += 1;
        continue;
      }
      if (!read.styleRef && !defaultId) {
        defaultReadFailures += 1;
        continue;
      }
      const styleId = read.styleRef ?? defaultId;
      if (!styleId) {
        defaultReadFailures += 1;
        continue;
      }
      resolved += 1;
      // No explicit style → the document default paragraph style (usually Normal).
      resolvedIds.add(styleId);
    }
    if (resolved === 0) {
      const onlyDefaultUnavailable = defaultReadFailures > 0 && blockReadFailures === 0;
      diagnostics.push({
        severity: 'warning',
        code: onlyDefaultUnavailable ? 'active-style-default-unavailable' : 'active-style-read-failed',
        message: onlyDefaultUnavailable
          ? 'Selected paragraphs have no explicit style and the style catalogue is unavailable, so the document default cannot be resolved.'
          : 'Could not read the paragraph style of any selected block; active paragraph style is unavailable.',
      });
      return { style: { styleId: null, styleName: null, mixed: false, diagnostics }, status: readStatus };
    }
    const unresolved = blockReadFailures + defaultReadFailures;
    if (unresolved > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'active-style-partial',
        message: `Active paragraph style resolved from ${resolved} of ${resolved + unresolved} selected blocks; ${unresolved} could not be read, so the active style is unavailable.`,
      });
      return { style: { styleId: null, styleName: null, mixed: false, diagnostics }, status: readStatus };
    }
    if (resolvedIds.size > 1) {
      return { style: { styleId: null, styleName: null, mixed: true, diagnostics }, status: readStatus };
    }
    const styleId = [...resolvedIds][0];
    const styleName = catalog?.byId.get(styleId)?.name ?? null;
    return { style: { styleId, styleName, mixed: false, diagnostics }, status: readStatus };
  };

  const computeStyles = (selection: SelectionSlice): StylesSlice => {
    if (!getEditor()) return EMPTY_STYLES_SLICE;
    const { cache: catalog, status: catalogStatus } = getStyleCatalog();
    const { style: active, status: activeStatus } = computeActiveParagraphStyle(selection, catalog);
    let diagnostics: readonly StyleCatalogDiagnostic[];
    if (catalog) {
      // Reuse the (stable) catalogue diagnostics reference when the active-style
      // read added none, so selection-only recomputes don't churn the slice.
      diagnostics =
        active.diagnostics.length === 0
          ? catalog.full.diagnostics
          : [...catalog.full.diagnostics, ...active.diagnostics];
    } else {
      diagnostics = [
        {
          severity: 'warning',
          code: 'catalog-unavailable',
          message:
            'The style catalogue is unavailable: the Document API styles surface is not reachable (e.g. viewing mode or a worker-backed editor).',
        },
        ...active.diagnostics,
      ];
    }
    return {
      ready: true,
      status: combineStatus(catalogStatus, activeStatus, selection.status),
      catalogRevision: catalog?.full.revision ?? null,
      quickGallery: catalog?.quickGallery ?? [],
      activeParagraphStyleId: active.styleId,
      activeParagraphStyleName: active.styleName,
      mixedSelection: active.mixed,
      sourceStatus: catalog?.full.sourceStatus ?? null,
      diagnostics,
    };
  };

  const computeState = (reason = 'direct'): SuperDocUIState => {
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
      if (!selectionSignature || optimistic.selectionSignature !== selectionSignature) {
        optimisticInlineToggles.delete(commandId);
      } else if (optimistic.settled && selection.status === 'ready') {
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
      fonts: measure('fonts', computeFonts),
      styles: measure('styles', () => computeStyles(selection)),
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
        asyncReadSettlements: pendingAsyncReadSettlements.splice(0),
      });
    }
    return nextState;
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

  // The adapter subscribes to the same host selection surface this controller
  // does and republishes on every caret move, so a direct `recompute()` here
  // would double the work per keystroke. Coalescing to a microtask collapses the
  // adapter's emission into the selection-driven recompute that is already
  // queued for the same gesture, while still guaranteeing a recompute for an
  // adapter-only emission such as the history read settling.
  let editCommandsRecomputeQueued = false;
  const requestEditCommandsRecompute = (): void => {
    if (disposed || editCommandsRecomputeQueued) return;
    editCommandsRecomputeQueued = true;
    const run = (): void => {
      // A recompute may already have run for this gesture — the selection
      // subscription recomputes synchronously — and clears the flag when it
      // does. Nothing left to do in that case.
      if (!editCommandsRecomputeQueued) return;
      editCommandsRecomputeQueued = false;
      if (disposed) return;
      recompute();
    };
    // Same fallback as `scheduleAsyncRefresh`: `queueMicrotask` is absent in
    // some runtimes, and throwing here would strand the flag set and stop every
    // later emission from scheduling anything.
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else void Promise.resolve().then(run);
  };

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
      const unsubscribe = next.subscribe(() => recompute());
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
    const editor = getEditor();
    const host = editor?.host as LooseRecord | undefined;
    const handles = safeCall<LooseRecord | null>(host?.getHandles ? () => host.getHandles() : undefined, null);
    const selection = handles?.editing?.selection;
    return selection && typeof selection.subscribe === 'function' ? (selection as LooseRecord) : null;
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
    const hadSize =
      (typeof sizeValue === 'string' && sizeValue.length > 0) ||
      (typeof sizeValue === 'number' && Number.isFinite(sizeValue));
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
      const unsubscribe = next.subscribe((snapshot: unknown) => {
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
        // ranges/empties defer to the async read inside recompute.
        seedCaretSelectionFromHost(snapshot);
        recompute('host-selection');
      });
      if (typeof unsubscribe === 'function') detachHostSelection = unsubscribe;
    } catch {
      currentHostSelectionSource = null;
    }
  };

  const readHostReviewSource = (): LooseRecord | null => {
    const editor = getEditor();
    const host = editor?.host as LooseRecord | undefined;
    const handles = safeCall<LooseRecord | null>(host?.getHandles ? () => host.getHandles() : undefined, null);
    const review = handles?.review;
    return review && typeof review.subscribe === 'function' ? (review as LooseRecord) : null;
  };

  const readHostActiveReviewTarget = (review: LooseRecord | null): unknown => {
    if (!review) return null;
    if (typeof review.getActiveReviewTarget === 'function') {
      return safeCall(() => review.getActiveReviewTarget(), null);
    }
    if (typeof review.getSnapshot === 'function') {
      const snapshot = safeCall<LooseRecord | null>(() => review.getSnapshot(), null);
      return snapshot?.activeReviewTarget ?? null;
    }
    return null;
  };

  let trackedChangeNavigationInFlight = 0;

  const syncTrackedChangeFocusFromHostReviewTarget = (rawTarget: unknown, rawSnapshot?: unknown): boolean => {
    const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? (rawSnapshot as LooseRecord) : null;
    const rejection = snapshot?.lastInteractionRejection;
    const paintInvalidation =
      rawTarget == null &&
      rejection &&
      typeof rejection === 'object' &&
      (rejection as LooseRecord).code === 'review-target-invalidated' &&
      (rejection as LooseRecord).detail === 'not-painted';
    if (paintInvalidation && explicitActiveChange) return false;
    const target = rawTarget && typeof rawTarget === 'object' ? (rawTarget as LooseRecord) : null;
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
    if (explicitActiveChangesEqual(explicitActiveChange, next)) return false;
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
    if (!next) {
      syncTrackedChangeFocusFromHostReviewTarget(null);
      return;
    }
    let attaching = true;
    try {
      const unsubscribe = next.subscribe((snapshot: unknown) => {
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
      if (typeof unsubscribe === 'function') detachHostReview = unsubscribe;
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
  const syncHostEventsSubscription = (): void => {
    const editor = getEditor();
    const host = editor?.host as LooseRecord | undefined;
    const events = host?.events as LooseRecord | undefined;
    const next = events && typeof events.subscribe === 'function' ? events : null;
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
      const off = next.subscribe((event: LooseRecord) => {
        const type = event?.type;
        const isStandaloneDocumentMutation = type === 'document:mutated' && event.hasCommitEvent !== true;
        // `document:mutated` covers every committed family, including the
        // non-receipt Document API results that never emit
        // `mutation:committed`. The receipt event stays as a fallback for
        // hosts that predate the dedicated signal.
        if (
          (type === 'document:mutated' ||
            (type === 'mutation:committed' && mutationCommittedEventChangedDocument(event))) &&
          host &&
          !dirtyHosts.has(host)
        ) {
          dirtyHosts.add(host);
          recompute('document-dirty');
        }
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
          sourceCompletionObservedToken = contentToken();
          refreshIncompleteTrackChangesDirectories();
          return;
        }
        if (isStandaloneDocumentMutation || type === 'mutation:committed' || type === 'collaboration:remote-changed') {
          // Input-idle signal for the source-complete heavy-read recompute:
          // local commits and remote applies both count as recent activity.
          lastEditableMutationAtMs = Date.now();
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
            lastTypingMutationAtMs = Date.now();
          }
          if (type === 'mutation:committed' && isTypingBurst) {
            scheduleTypingDocumentContentInvalidation();
            return;
          }
          if (impact?.removedIds.size && impact.upsertIds.size === 0) {
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
            commentsCatalogMayHaveRows();
          if (remoteCommentsPartChanged && !isTypingBurst) {
            // A part-only review update still advances the shared content
            // token. Hold passive catalogs behind the normal idle gate while
            // the demanded comments read below refreshes immediately.
            heavyReadsHeldUntilIdle = true;
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
            heavyReadsHeldUntilIdle = true;
            scheduleHeavyReadCompletionRecompute();
          }
          recompute();
        }
      });
      if (typeof off === 'function') detachHostEvents = off;
    } catch {
      currentHostEventsSource = null;
    }
  };

  const recompute = (reason = 'unspecified'): void => {
    if (disposed) return;
    const { sink } = readUiBenchRuntime();
    const startedAtMs = sink ? uiBenchNowMs() : 0;
    // Any recompute satisfies a queued edit-command refresh, whatever triggered
    // it. A caret move fires the host selection subscription (which recomputes
    // synchronously) AND the adapter's own republish; without this, the queued
    // microtask would run a second full computation for the same gesture.
    editCommandsRecomputeQueued = false;
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
                asyncReads.clear();
                invalidateDocumentContent();
                recompute();
              }
            : event === 'document-mode-change'
              ? () => {
                  recompute();
                  runDocumentModeChangeHooks();
                }
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
   * A cross-block or malformed selection fails closed. Its intermediate block
   * coverage cannot be reconstructed from two endpoints without guessing.
   */
  function trackDecisionRangeFromSelection(selection: SelectionSlice): LooseRecord | null {
    if (selection.empty) return null;
    const explicit = selection.selectionTarget as LooseRecord | null;
    const start = explicit?.start as LooseRecord | undefined;
    const end = explicit?.end as LooseRecord | undefined;
    if (
      explicit?.kind !== 'selection' ||
      start?.kind !== 'text' ||
      end?.kind !== 'text' ||
      typeof start.blockId !== 'string' ||
      start.blockId !== end.blockId ||
      !Number.isInteger(start.offset) ||
      !Number.isInteger(end.offset) ||
      (start.offset as number) < 0 ||
      (end.offset as number) < 0 ||
      start.offset === end.offset
    ) {
      return null;
    }
    const rangeStart = Math.min(start.offset as number, end.offset as number);
    const rangeEnd = Math.max(start.offset as number, end.offset as number);
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

  function activeChangePartialDecisionRoute(): 'range' | 'id' | 'unavailable' {
    const activeId = state.selection.activeChangeIds[0];
    if (!activeId) return 'unavailable';
    const story = selectionStoryLocator(state.selection);
    const bodyItem =
      state.trackChanges.status === 'ready'
        ? state.trackChanges.items.find((candidate) => entityRowMatchesRequest(candidate, activeId, story))
        : undefined;
    const item =
      bodyItem ??
      readBodyTrackChangeForDecision(activeId, story) ??
      readAllStoryTrackChanges()?.find((candidate) => entityRowMatchesRequest(candidate, activeId, story));
    if (!item) return 'unavailable';
    const change = trackChangesItemPayload(item);
    const type = change.type;
    const grouping = change.grouping;
    if (selectedTextCoversTrackChangeText(state.selection, item)) return 'id';
    if (type === 'replacement' && grouping === 'replacement-pair') return 'range';
    return (type === 'insertion' || type === 'deletion' || type === 'insert' || type === 'delete') &&
      grouping === 'standalone'
      ? 'range'
      : 'id';
  }

  function executeTrackDecisionRangeWithIdFallback(
    kind: 'accept' | 'reject',
    rangeTarget: LooseRecord,
    changeId: string,
    story?: unknown,
  ): CommandExecutionResult {
    const fallback = () => callTrackDecisionTarget(kind, trackDecisionIdTarget(changeId, story), changeId, story);
    try {
      const result = callTrackDecisionTarget(kind, rangeTarget, changeId, story);
      if (isPromiseLike(result)) {
        return settleCommandExecution(
          Promise.resolve(result).then((settled) => {
            const commandResult = commandResultFromOperationResult(settled);
            return commandResultSucceeded(commandResult) ? settled : fallback();
          }),
        );
      }
      const commandResult = commandResultFromOperationResult(result);
      return settleCommandExecution(commandResultSucceeded(commandResult) ? result : fallback());
    } catch {
      return false;
    }
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

  function executeTrackDecisionCommand(
    command: { kind: 'accept' | 'reject'; scope: 'id' | 'all' },
    payload: unknown,
  ): CommandExecutionResult {
    if (command.scope === 'id' && payload == null) {
      if (state.selection.activeChangeIds.length > 1) {
        return executeTrackDecisionTarget(command.kind, { kind: 'ids', ids: state.selection.activeChangeIds }, null);
      }
      if (state.selection.activeChangeIds.length === 1 && !state.selection.empty && state.selection.selectionTarget) {
        const route = activeChangePartialDecisionRoute();
        if (route === 'unavailable') return false;
        if (route === 'range') {
          const target = trackDecisionRangeFromSelection(state.selection);
          const story = nonBodySelectionStoryLocator(state.selection);
          return target
            ? executeTrackDecisionRangeWithIdFallback(command.kind, target, state.selection.activeChangeIds[0]!, story)
            : false;
        }
        if (route === 'id') {
          const activeId = state.selection.activeChangeIds[0];
          const selectedStory = selectionStoryLocator(state.selection);
          const story =
            selectedStory && storyLocatorSignature(selectedStory) !== storyLocatorSignature(null)
              ? selectedStory
              : undefined;
          // All whole-change ID routes need the non-body story to avoid the
          // legacy unscoped mutation path. Body routes intentionally omit it.
          return executeTrackDecision(command.kind, story ? { id: activeId, story } : activeId);
        }
      }
    }
    const resolved = resolveTrackDecisionTarget(command, payload);
    if (!resolved) return false;
    return executeTrackDecisionTarget(command.kind, resolved.target, resolved.changeId, resolved.story);
  }

  function executeListToggleCommand(kind: 'bullet' | 'ordered', payload: unknown): CommandExecutionResult {
    const editCommands = getEditCommands();
    const lists = editCommands?.lists as LooseRecord | undefined;
    const apply = lists?.apply;
    if (typeof apply !== 'function') return false;
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
    try {
      return settleCommandExecution(apply.call(lists, input));
    } catch {
      return false;
    }
  }

  let lastCommandSettlement: Promise<CommandExecutionResult> = Promise.resolve(false);
  let pendingCommandSettlement: Promise<CommandExecutionResult> | null = null;
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

  const UNSUPPORTED_TRACKED_UI_MUTATION_ROUTES = new Set(['create.tableOfContents']);

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
  ): WorkflowReceipt => {
    if (isPromiseLike(receipt)) {
      return Promise.resolve(receipt).then(
        (resolved) => settleWorkflowReceipt(resolved, fallback),
        () => fallback,
      );
    }
    const normalizedReceipt = normalizeWorkflowReceipt(receipt, fallback);
    // A workflow receipt is a document mutation (comment create/reply/delete,
    // insert, …): invalidate content reads so dependent slices re-fetch.
    invalidateDocumentContent();
    if (isSuccessfulReceipt(normalizedReceipt)) {
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

  /**
   * Call an inline `format.*` operation against the live selection. Mirrors
   * `callEditorMutation` (suggesting mode adds `changeMode: 'tracked'`), and
   * when the target is the host's own editable `selectionTarget` it also
   * carries the PRIVATE V2 option `offsetSpace: 'selection'` (browser
   * selection offsets count an inline object as one caret position). The
   * option is not part of public `MutationOptions`; this is the same cast
   * pattern the delete/replace callers use.
   */
  const callInlineFormatMutation = (
    route: string,
    op: AnyFn,
    input: unknown,
    selection: Pick<SelectionSlice, 'selectionTarget'> | SelectionInfo = state.selection,
  ): unknown => {
    const options = editorMutationOptionsForRoute(route);
    if (options && (options as LooseRecord).success === false) return options;
    if (!(selection as LooseRecord).selectionTarget) return options ? op(input, options) : op(input);
    return op(input, { ...options, offsetSpace: 'selection' });
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
  const storePendingInlineFormat = (descriptor: CommandDescriptor, payload: unknown): CommandExecutionResult => {
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
      value = !commandActiveState(descriptor, getDoc(), state.selection);
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

  const executeClearFormattingCommand = (): CommandExecutionResult => {
    const doc = getDoc();
    const { lockModesById } = computeActiveContentControlLockModes(
      doc?.contentControls as LooseRecord | undefined,
      state.selection,
    );
    if (contentControlLockReason(lockModesById)) return false;

    const immediateResults: CommandExecutionResult[] = [];
    const settledResults: Array<Promise<CommandExecutionResult>> = [];

    const record = (result: unknown): void => {
      const settled = settleOperationResult(result);
      immediateResults.push(settled.immediate);
      settledResults.push(settled.settled);
    };

    const run = (op: AnyFn, input: LooseRecord, options?: LooseRecord) => {
      try {
        record(options ? op(input, options) : op(input));
      } catch {
        immediateResults.push(false);
        settledResults.push(Promise.resolve(false));
      }
    };

    const catalog = getStyleCatalog().cache;
    const defaultStyleId = catalog?.full.defaults.paragraphStyleId ?? DEFAULT_PARAGRAPH_STYLE_ID;

    const rangeTarget = resolveInlineSelectionTarget(state.selection);
    if (rangeTarget) {
      const inlineOp = resolveDocOperation(doc, 'format.apply');
      // One cross-block-capable format.apply call for the whole selection
      // (SD-3706). Editable browser selections thread the private V2
      // `offsetSpace: 'selection'` option so painted offsets (inline objects
      // count as one caret position) land on the selected characters.
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
      if (resetOp) run(resetOp, { target });
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
      // A list selection is one user action: keep its mutation, repaint, and
      // undo history atomic just like Tab/Shift+Tab. Tracked range indentation
      // remains unsupported, so suggesting mode retains the per-item path.
      if (allListItems && readDocumentMode() !== 'suggesting') {
        const rangeRoute = mode === 'indent' ? 'lists.indentRange' : 'lists.outdentRange';
        const rangeOp = resolveDocOperation(doc, rangeRoute);
        if (rangeOp) {
          try {
            return await settleOperationResult(callEditorMutation(rangeRoute, rangeOp, { paraIds: blockIds, story }))
              .settled;
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
    const record = readLinkPayloadRecord(payload);
    const href = readLinkPayloadHref(payload);
    const payloadTarget = readLinkPayloadTarget(payload);
    const text = typeof record.text === 'string' ? record.text : undefined;
    const currentText = typeof record.currentText === 'string' ? record.currentText : undefined;
    const requestedHyperlinkTarget = isLooseObject(record.hyperlinkTarget)
      ? (record.hyperlinkTarget as LooseRecord)
      : null;
    const requestedTextTarget = isLooseObject(record.textTarget) ? (record.textTarget as LooseRecord) : null;
    const existing = resolveCurrentHyperlink(doc, state.selection);
    const hasRequestedHyperlinkTarget =
      typeof requestedHyperlinkTarget?.storyId === 'string' &&
      typeof requestedHyperlinkTarget?.hyperlinkNodeId === 'string';
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
      const remove = linksApi.remove as AnyFn | undefined;
      if (typeof remove !== 'function') return false;
      try {
        return callEditorMutation('hyperlinks.remove', remove, { target: existing.address, mode: 'unwrap' });
      } catch {
        return false;
      }
    }
    // Active link + new href → patch target, optionally replacing display text atomically when requested.
    if ((existing || requestedHyperlinkTarget) && typeof href === 'string' && href.trim() !== '') {
      const patch = linksApi.patch as AnyFn | undefined;
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
            return Promise.all([settledHyperlinkResult ?? Promise.resolve(finalHyperlinkResult), result.settled]).then(
              ([settledHyperlink, finalTextResult]) => combineSettledLinkEdit(settledHyperlink, finalTextResult),
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
      const wrap = linksApi.wrap as AnyFn | undefined;
      const textTargets = textAddressesFromTarget(payloadTarget);
      const wrapTargets = textTargets.length > 0 ? textTargets : selectionTextAddresses(state.selection);
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
      const insert = linksApi.insert as AnyFn | undefined;
      const text = readLinkPayloadText(payload, normalizedHref);
      if (typeof insert !== 'function' || text.trim() === '') return false;
      const target =
        collapsedTextAddressFromTarget(payloadTarget) ?? collapsedTextAddressFromSelection(state.selection);
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
          at = { ...at, target: { ...at.target, story: nonBodyStory } };
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
      try {
        return callEditorMutation(descriptor.docRoute!, op, input);
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
        const host = getHost();
        const handles = typeof host?.getHandles === 'function' ? host.getHandles() : null;
        const tableCommands = (handles?.editing as LooseRecord | undefined)?.tables as LooseRecord | undefined;
        if (typeof tableCommands?.insertRow !== 'function') return false;
        const options = editorMutationOptionsForRoute(descriptor.docRoute!);
        if (options && options.success === false) return options;
        return options ? tableCommands.insertRow(input, options) : tableCommands.insertRow(input);
      }
      if (spec.action === 'insert-column-before' || spec.action === 'insert-column-after') {
        const host = getHost();
        const handles = typeof host?.getHandles === 'function' ? host.getHandles() : null;
        const tableCommands = (handles?.editing as LooseRecord | undefined)?.tables as LooseRecord | undefined;
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
      readLinkPayloadTarget(payload) || isLooseObject(record.hyperlinkTarget) || isLooseObject(record.textTarget),
    );
  };

  const commandSelectionIsReady = (id: string, descriptor: CommandDescriptor | null, payload: unknown): boolean => {
    if (state.selection.status !== 'ready') return false;
    const trackCommand = trackDecisionCommand(id);
    if (trackCommand?.scope === 'id') return true;
    if (!descriptor || descriptor.disposition !== 'routed') return true;
    if (descriptor.inline?.kind === 'clear') {
      return selectionBlockIds(state.selection).length > 0 || resolveInlineSelectionTarget(state.selection) != null;
    }
    // Inline: a range mutates directly; a collapsed caret in a block stores the
    // pick (mark toggle or font/size) for the next typed text (SD-3654/SD-3652).
    if (descriptor.inline) {
      return resolveInlineSelectionTarget(state.selection) != null || selectionBlockIds(state.selection).length > 0;
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
    if (trackCommand?.scope !== 'id' && !descriptorNeedsFreshSelection(descriptor)) return false;
    return !commandSelectionIsReady(id, descriptor, payload);
  };

  const prepareCommandSelectionAsync = (id: string, payload: unknown): Promise<void> | null => {
    if (!commandNeedsFreshSelection(id, payload)) return null;
    return readSelectionInfoFresh().then(() => undefined);
  };

  const executeCommand = (id: string, payload?: unknown, context?: ViewportContext): CommandExecutionResult => {
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
      if (readDocumentMode() === 'viewing') return false;
      const editCommands = getEditCommands();
      const apply = (editCommands?.lists as LooseRecord | undefined)?.apply;
      if (typeof apply === 'function') return executeListToggleCommand(listKind, payload);
    }
    const trackCommand = trackDecisionCommand(id);
    if (trackCommand) return executeTrackDecisionCommand(trackCommand, payload);
    if (id === 'copy-format') return settleCommandExecution(executeCopyFormat());
    const descriptor = getCommandDescriptor(id);
    // Deferred / unsupported / unknown ids fail closed and never mutate.
    if (!descriptor || descriptor.disposition !== 'routed') return false;
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
      if (descriptor.mutates && readDocumentMode() === 'viewing') return false;
      return settleCommandExecution(executeClearFormattingCommand());
    }
    // Routed via a Document API operation. Mutating commands are read-only guarded.
    const route = descriptor.docRoute;
    if (!route) return false;
    if (descriptor.mutates && readDocumentMode() === 'viewing') return false;
    const doc = getDoc();
    const op = resolveDocOperation(doc, route);
    if (!op) return false;
    // Inline-format commands route through `format.*` against the live selection
    // target with an explicit `{ target, value }` input (the public Document API
    // does not default the selection). They fail closed without a range
    // selection or with an invalid payload rather than calling with a missing
    // target.
    if (descriptor.inline) {
      // Word parity (SD-3274): mirrors the read-only guard above — fail closed
      // rather than let a style change silently no-op against locked content.
      //
      // NOTE: this intentionally does NOT fail closed on `status === 'pending'`.
      // A prior attempt did, reasoning that a never-settled read carries zero
      // information about a possible lock — but `readAsync`'s cold-read path
      // deliberately defers the FIRST read for any new selection by
      // `COLD_ASYNC_READ_START_DELAY_MS` (180ms) before even issuing the
      // underlying `listInRange` call (stampede protection), so `pending` is
      // not a rare sub-millisecond race — it is the *guaranteed* status for a
      // brief but real window on every fresh selection. Failing closed on it
      // silently broke ordinary formatting (bold/font/format-painter) on
      // plain documents with no content controls at all, confirmed by
      // `format-painter.spec.ts` CI failures. Accept the narrower, purely
      // theoretical race this reverts (a mutation landing on a locked SDT
      // during that same cold-read window) as a known limitation instead.
      const { lockModesById } = computeActiveContentControlLockModes(
        doc?.contentControls as LooseRecord | undefined,
        state.selection,
      );
      if (contentControlLockReason(lockModesById)) return false;
      const target = resolveInlineSelectionTarget(state.selection);
      // Store the pick as a pending mark ONLY for a genuine collapsed caret
      // (SD-3654/SD-3652). A non-empty selection with an unresolved target is a
      // range whose async read has not settled yet - do not mis-route it to the
      // caret store (that would leave the range unstyled); fail closed so the
      // caller's fresh-selection retry applies it to the range instead.
      if (!target) {
        if (state.selection.empty === false) return settleCommandExecution(false);
        return settleCommandExecution(storePendingInlineFormat(descriptor, normalized));
      }
      const active = commandActiveState(descriptor, doc, state.selection);
      // One `format.*` call regardless of paragraph count: a cross-block
      // selection passes the host's original `selectionTarget` through and the
      // v2 adapter resolves it centrally into one multi-range transaction
      // (SD-3706) — one receipt, one repaint, one undo unit. No per-block
      // fan-out or plan composition exists in the UI.
      const input = buildInlineFormatInput(descriptor.inline, target, normalized, active);
      if (!input) return false;
      let releaseScheduledMutation: (() => void) | null = null;
      try {
        const commandEditor = getEditor();
        const commandMode = readDocumentMode();
        const mutate = () => {
          if (getEditor() !== commandEditor || getDoc() !== doc || readDocumentMode() !== commandMode) return false;
          return callInlineFormatMutation(route, op, input);
        };
        const selectionSignature = selectionInlineValueSignature(state.selection) ?? selectionKey(state.selection);
        const scheduledMutation =
          descriptor.inline.kind === 'toggle'
            ? scheduleInlineToggleMutation(`${descriptor.id}:${selectionSignature}`, mutate)
            : null;
        releaseScheduledMutation = scheduledMutation?.release ?? null;
        const mutationResult = scheduledMutation ? scheduledMutation.result : mutate();
        const optimisticGeneration = captureOptimisticInlineToggle(descriptor, state.selection, input, mutationResult);
        const result = decorateInlineCommandResult(descriptor, state.selection, input, mutationResult);
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

  const exitFormatPainter = (): void => {
    painterCaptureEpoch += 1;
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
    // Toolbar state is optimistic, but format-painter capture must snapshot the
    // authoritative source formatting. An async toolbar command may still be
    // preparing its selection before the mutation scheduler becomes active, so
    // wait for both the whole prior toggle command and the scheduler itself.
    const visibleActiveMarksAtClick = ['bold', 'italic', 'underline', 'strikethrough'].filter(
      (id) => state.toolbar.commands[id]?.active === true,
    );
    const inlineToggleSettlement = await lastInlineToggleCommandSettlement;
    await inlineToggleMutationIdle;
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
    const selTarget = ((captureSlice?.target as LooseRecord | null | undefined) ??
      (selection as LooseRecord | null)?.target) as LooseRecord | undefined;
    if (!selTarget || selTarget['kind'] !== 'text') return null;
    const segments = Array.isArray(selTarget['segments']) ? (selTarget['segments'] as LooseRecord[]) : [];
    if (segments.length === 0) return null;

    const doc = getDoc();
    if (!doc) return null;
    const sourceStory = selTarget['story'];

    // Inline capture: intersect run props across all covered blocks
    let mergedRunProps: Record<string, unknown> | null = null;
    for (const segment of segments) {
      const nodeResult = (await readBlockNode(paragraphTarget(segment['blockId'] as string, sourceStory))) as
        | LooseRecord
        | undefined;
      const node = (nodeResult?.['node'] as LooseRecord | undefined) ?? null;
      if (!node) continue;
      const para = getParagraphLikeData(node);
      const runs = (Array.isArray(para?.['inlines']) ? para!['inlines'] : []) as LooseRecord[];
      const slicedProps = sliceAndIntersectRunProps(runs, segment['range'] as { start: number; end: number });
      if (!mergedRunProps) {
        mergedRunProps = slicedProps;
      } else {
        mergedRunProps = intersectRunProps(mergedRunProps, slicedProps);
      }
    }
    const inlinePatch = mergedRunProps ? sdRunPropsToInlineRunPatch(mergedRunProps) : {};

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
      ...(captureSlice?.activeMarks ??
        (Array.isArray((selection as LooseRecord | null)?.['activeMarks'])
          ? ((selection as LooseRecord)['activeMarks'] as string[])
          : [])),
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

    // Paragraph capture: when selection is within exactly one paragraph block.
    // Word behavior: paragraph formatting is captured whenever the cursor is inside
    // a paragraph, regardless of whether the whole paragraph is selected.
    let paragraphSnapshot: FormatPainterParagraphSnapshot | null = null;
    if (segments.length === 1) {
      const segment = segments[0];
      const nodeResult = (await readBlockNode(paragraphTarget(segment['blockId'] as string, sourceStory))) as
        | LooseRecord
        | undefined;
      const node = (nodeResult?.['node'] as LooseRecord | undefined) ?? null;
      if (node) {
        const para = getParagraphLikeData(node);
        if (para) {
          paragraphSnapshot = await extractParagraphSnapshot(node, segment['blockId'] as string, doc, sourceStory);
        }
      }
    }

    return { story: sourceStory ?? null, inline: inlinePatch, paragraph: paragraphSnapshot };
  };

  const getParagraphLikeData = (node: LooseRecord): LooseRecord | null => {
    if (!node) return null;
    if (node['kind'] === 'paragraph') return (node['paragraph'] as LooseRecord) ?? null;
    if (node['kind'] === 'heading') return (node['heading'] as LooseRecord) ?? null;
    return null;
  };

  const sliceAndIntersectRunProps = (
    runs: LooseRecord[],
    range: { start: number; end: number },
  ): Record<string, unknown> => {
    // Collapsed caret: find the run at the caret position and take its props directly.
    // The empty-range loop below would skip every run via boundary conditions.
    // SDRun shape: { kind: 'run', run: { text: string, props?: SDRunProps } }
    const getRunText = (r: LooseRecord): string => {
      const inner = r['run'] as LooseRecord | undefined;
      return typeof inner?.['text'] === 'string' ? (inner!['text'] as string) : '';
    };
    const getRunProps = (r: LooseRecord): Record<string, unknown> | undefined => {
      const inner = r['run'] as LooseRecord | undefined;
      return inner?.['props'] as Record<string, unknown> | undefined;
    };

    if (range.start === range.end) {
      let offset = 0;
      for (const run of runs) {
        const text = getRunText(run);
        const runStart = offset;
        const runEnd = offset + text.length;
        offset = runEnd;
        if (range.start >= runStart && range.start <= runEnd) {
          const rPr = getRunProps(run);
          return rPr ? { ...rPr } : {};
        }
      }
      return {};
    }

    let offset = 0;
    const covered: Record<string, unknown>[] = [];
    for (const run of runs) {
      const text = getRunText(run);
      const runStart = offset;
      const runEnd = offset + text.length;
      offset = runEnd;
      if (runEnd <= range.start || runStart >= range.end) continue;
      const rPr = getRunProps(run);
      if (rPr) covered.push(rPr);
    }
    if (covered.length === 0) return {};
    if (covered.length === 1) return { ...covered[0] };
    return intersectRunProps(covered[0], ...covered.slice(1));
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
    const alignment = (props['alignment'] as FormatPainterParagraphSnapshot['alignment']) ?? null;
    const spacing = (props['spacing'] as unknown) ?? null;
    const indent = (props['indent'] as LooseRecord | undefined) ?? null;
    const indentation = indent
      ? {
          ...(indent['left'] != null ? { left: indent['left'] as number } : {}),
          ...(indent['right'] != null ? { right: indent['right'] as number } : {}),
          ...(indent['firstLine'] != null ? { firstLine: indent['firstLine'] as number } : {}),
          ...(indent['hanging'] != null ? { hanging: indent['hanging'] as number } : {}),
        }
      : null;
    const markRunProps = (props['markRunProps'] as unknown) ?? null;

    const rawNumId = (props['numbering'] as LooseRecord | undefined)?.['numId'];
    const numId = typeof rawNumId === 'string' ? parseInt(rawNumId, 10) : typeof rawNumId === 'number' ? rawNumId : NaN;
    const level = (props['numbering'] as LooseRecord | undefined)?.['level'] as number | undefined;
    const numbering = !isNaN(numId) ? { numId, ...(level != null ? { level } : {}) } : null;

    let listStyle: unknown = null;
    if (numbering && typeof doc['lists']?.['getState'] === 'function') {
      try {
        const listState = await doc['lists']['getState']({ target: paragraphTarget(blockId, story) });
        if (listState && typeof doc['lists']?.['getStyle'] === 'function') {
          listStyle = (await doc['lists']['getStyle'](listState)) ?? null;
        }
      } catch {
        /* no list state — skip */
      }
    }

    return { styleId, alignment, spacing, indentation, markRunProps, numbering, listStyle };
  };

  const maybeApply = async (): Promise<void> => {
    if (painter.mode === 'idle') return;
    if (painter.pointerSelecting || painter.keyboardSelecting) return;

    const doc = getDoc();
    const selectionApi = doc?.selection as LooseRecord | undefined;
    const readSelection = async (): Promise<SelectionInfo | null> => {
      const rawSelection =
        typeof selectionApi?.['current'] === 'function'
          ? await Promise.resolve((selectionApi['current'] as (opts: unknown) => unknown)({ includeText: true }))
          : readSelectionInfoLive().value;
      return normalizeSelectionInfo(rawSelection);
    };
    const waitForSelectionSettle = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 16));

    // After pointerup/keyup the target selection sometimes "ripens" asynchronously.
    // Poll for a settled non-empty (text) selection first.
    const MAX_SELECTION_ATTEMPTS = 8;
    let sel: SelectionInfo | null = null;
    let key = '';
    for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await waitForSelectionSettle();
      if ((painter as FormatPainterState).mode === 'idle' || painter.pointerSelecting || painter.keyboardSelecting)
        return;
      sel = await readSelection();
      if (!sel || (sel as LooseRecord)['empty']) continue; // wait for text selection to ripen
      key = selectionKey(sel);
      if (key === painter.sourceSelectionKey) continue;
      break;
    }

    // Text selection settled: apply inline + paragraph.
    if (sel && !(sel as LooseRecord)['empty'] && key !== painter.sourceSelectionKey) {
      await applyFormatPainter(sel);
      return;
    }

    // No text selection. If there is a paragraph snapshot, check for a positioned
    // caret (click) and apply paragraph formatting only.
    if (painter.snapshot?.paragraph) {
      const caretSel = await readSelection();
      if (!caretSel) return;
      const caretKey = selectionKey(caretSel);
      if (caretKey === painter.sourceSelectionKey) return;
      await applyFormatPainter(caretSel);
    }
  };

  const applyFormatPainter = async (selection: SelectionInfo): Promise<void> => {
    const snap = painter.snapshot;
    if (!snap) {
      if (painter.mode === 'armed') exitFormatPainter();
      return;
    }

    const doc = getDoc();
    if (!doc) return;

    const targetSelection = selectionSliceFromInfo(selection, 'ready');
    const { lockModesById } = computeActiveContentControlLockModes(
      doc.contentControls as LooseRecord | undefined,
      targetSelection,
    );
    if (contentControlLockReason(lockModesById)) {
      recompute();
      return;
    }

    // TextTarget (segments/blockIds) for paragraph apply; SelectionTarget for inline apply
    const selTarget = (selection as LooseRecord)['target'] as LooseRecord | undefined;
    const selectionTarget = (selection as LooseRecord)['selectionTarget'] as LooseRecord | undefined;

    const selectionIsEmpty = (selection as LooseRecord)['empty'] === true;

    // Inline apply: only when text is selected. Skip for collapsed caret —
    // paragraph formatting applies at cursor position, but character formatting
    // requires actual text to be selected (Word behavior).
    if (!selectionIsEmpty && Object.keys(snap.inline).length > 0) {
      const inlineOp = resolveDocOperation(doc, 'format.apply');
      if (inlineOp && selectionTarget) {
        try {
          const result = await Promise.resolve(
            callInlineFormatMutation(
              'format.apply',
              inlineOp,
              { target: selectionTarget, inline: snap.inline },
              selection,
            ),
          );
          if (!commandResultSucceeded(commandResultFromOperationResult(result))) {
            recompute();
            return;
          }
        } catch {
          recompute();
          return;
        }
      }
    }

    // Paragraph apply: applied to every paragraph touched by the selection.
    // Word behavior: paragraph formatting applies whenever the cursor is inside
    // a paragraph, regardless of how much of it is selected.
    if (snap.paragraph) {
      const segments = Array.isArray(selTarget?.['segments']) ? (selTarget!['segments'] as LooseRecord[]) : [];
      const targetStory = selTarget?.['story'];
      for (const segment of segments) {
        const blockAddress = paragraphTarget(segment['blockId'] as string, targetStory);
        const nodeResult = (await readBlockNode(blockAddress)) as LooseRecord | undefined;
        const node = (nodeResult?.['node'] as LooseRecord | undefined) ?? null;
        const nodeAddress = (nodeResult?.['address'] as LooseRecord | undefined) ?? null;
        if (!node) continue;

        const nodeType =
          (nodeAddress?.['nodeType'] as string | undefined) ?? (node['kind'] as string | undefined) ?? 'paragraph';
        const target = {
          kind: 'block',
          nodeType,
          nodeId: segment['blockId'],
          ...(targetStory && typeof targetStory === 'object' ? { story: targetStory } : {}),
        };
        const { styleId, alignment, spacing, indentation, markRunProps, numbering, listStyle } = snap.paragraph;

        if (styleId) await (doc as LooseRecord).styles?.paragraph?.setStyle?.({ target, styleId });
        if (alignment) await (doc as LooseRecord).format?.paragraph?.setAlignment?.({ target, alignment });
        if (spacing) {
          const sp = spacing as Record<string, unknown>;
          const rawLr = (sp['lineRule'] as string | undefined) ?? 'auto';
          // setSpacing only accepts 'auto' | 'exact' | 'atLeast'; 'multiple' (valid on read) maps to 'auto'.
          const WRITE_LINE_RULES = new Set(['auto', 'exact', 'atLeast']);
          const lr = WRITE_LINE_RULES.has(rawLr) ? rawLr : 'auto';
          const rawSpacing = {
            ...(sp['before'] != null ? { before: Math.round((sp['before'] as number) * 20) } : {}),
            ...(sp['after'] != null ? { after: Math.round((sp['after'] as number) * 20) } : {}),
            ...(sp['line'] != null
              ? {
                  line: Math.round(lr === 'auto' ? (sp['line'] as number) * 240 : (sp['line'] as number) * 20),
                  lineRule: lr,
                }
              : {}),
          };
          await (doc as LooseRecord).format?.paragraph?.setSpacing?.({ target, ...rawSpacing });
        }
        if (indentation) {
          const rawIndentation = {
            ...(indentation.left != null ? { left: pointsToTwips(indentation.left) } : {}),
            ...(indentation.right != null ? { right: pointsToTwips(indentation.right) } : {}),
            ...(indentation.firstLine != null ? { firstLine: pointsToTwips(indentation.firstLine) } : {}),
            ...(indentation.hanging != null ? { hanging: pointsToTwips(indentation.hanging) } : {}),
          };
          await (doc as LooseRecord).format?.paragraph?.setIndentation?.({ target, ...rawIndentation });
        }
        if (markRunProps) await (doc as LooseRecord).format?.paragraph?.setMarkRunProps?.({ target, markRunProps });
        if (numbering) await (doc as LooseRecord).format?.paragraph?.setNumbering?.({ target, ...numbering });

        if (listStyle) {
          const targetNodeResult = (await readBlockNode(blockAddress)) as LooseRecord | undefined;
          const blockIsListItem =
            (targetNodeResult?.['address'] as LooseRecord | undefined)?.['nodeType'] === 'listItem';
          if (blockIsListItem) {
            await (doc as LooseRecord).lists?.applyStyle?.({
              target: listItemTarget(segment['blockId'] as string, targetStory),
              style: listStyle,
            });
          } else if (numbering) {
            await (doc as LooseRecord).format?.paragraph?.setNumbering?.({ target, ...numbering });
          }
        }
      }
    }

    if (painter.mode === 'armed') exitFormatPainter();
    recompute();
  };

  const executeCommandAsync = (
    id: string,
    payload?: unknown,
    context?: ViewportContext,
  ): Promise<CommandExecutionResult> => {
    const prepared = prepareCommandSelectionAsync(id, payload);
    const settlement = prepared
      ? prepared.then(() => {
          executeCommand(id, payload, context);
          return lastCommandSettlement;
        })
      : (() => {
          executeCommand(id, payload, context);
          return lastCommandSettlement;
        })();
    if (getCommandDescriptor(id)?.inline?.kind === 'toggle') {
      lastInlineToggleCommandSettlement = settlement;
    }
    return settlement;
  };

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
   * Resolve the host-owned selection apply helper (`editing.selectionTargets`)
   * with a truthful failure reason. `host.getHandles()` throws a
   * `V2EditorHostError` with a lifecycle `reason` while the host is booting or
   * disposed — that is a readiness condition, not a missing capability, so it
   * maps to `not-ready` instead of being swallowed into
   * `host-capability-unavailable`.
   */
  const getSelectionApplyHelper = (): { helper: LooseRecord } | { reason: SuperDocUIReason } => {
    const host = getHost();
    if (typeof host?.getHandles !== 'function') {
      return { reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
    }
    let handles: LooseRecord | null = null;
    try {
      handles = host.getHandles();
    } catch (error) {
      const lifecycle = (error as { reason?: unknown } | null)?.reason;
      const notReady =
        lifecycle === 'host-not-ready' || lifecycle === 'host-disposed' || lifecycle === 'editing-mount-required';
      return { reason: notReady ? SUPERDOC_UI_REASONS.notReady : SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
    }
    const helper = (handles?.editing as LooseRecord | undefined)?.selectionTargets as LooseRecord | undefined;
    if (typeof helper?.apply !== 'function') {
      return { reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
    }
    return { helper };
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
      if (snapshot.empty || (!snapshot.target && !snapshot.selectionTarget)) return null;
      return { ...snapshot, capturedAt: Date.now() };
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
      const target = selectionTargetForRestore(capture);
      if (!target) return done({ ok: false, reason: SUPERDOC_UI_REASONS.targetUnresolved });
      const resolved = getSelectionApplyHelper();
      if (!('helper' in resolved)) return done({ ok: false, reason: resolved.reason });
      try {
        return done(normalizeHostSelectionApplyResult(resolved.helper.apply(target)));
      } catch {
        return done({ ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable });
      }
    },
    apply: (target: SelectionTarget): WorkflowActionResult => {
      if (!getEditor()) return { ok: false, reason: SUPERDOC_UI_REASONS.notReady };
      const resolved = getSelectionApplyHelper();
      if (!('helper' in resolved)) return { ok: false, reason: resolved.reason };
      try {
        const result = resolved.helper.apply(target);
        recompute();
        return normalizeHostSelectionApplyResult(result);
      } catch {
        return { ok: false, reason: SUPERDOC_UI_REASONS.hostCapabilityUnavailable };
      }
    },
    getAnchorRect: (input?: { placement?: 'start' | 'end' | 'center' }): ViewportRect | null => {
      // Prefer the v2 painted/edit-geometry selection rect from the host so the
      // anchor matches the painted layout (not the offscreen ProseMirror DOM).
      const host = getHost();
      if (typeof host?.getSelectionAnchorRect === 'function') {
        const fromHost = safeCall<LooseRecord | null>(() => host.getSelectionAnchorRect(input), null);
        if (fromHost && typeof fromHost === 'object' && (Number(fromHost.width) > 0 || Number(fromHost.height) > 0)) {
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
      if (snapshot.empty || !target) return [];
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
      () => settleWorkflowReceipt(op.call(commentsApi, { commentId, status }), fallback),
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
    const record = query && typeof query === 'object' ? (query as LooseRecord) : null;
    let filtered = Array.from(items);
    if (record?.includeResolved === false) {
      filtered = filtered.filter((item) => (item as LooseRecord).status !== 'resolved');
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
  const comments: CommentsHandle = {
    get: commentsSnap.get,
    getSnapshot: commentsSnap.getSnapshot,
    subscribe: commentsSnap.subscribe,
    observe: commentsSnap.observe,
    list: (query?: unknown): readonly CommentInfo[] => {
      ensureCommentsCatalog();
      const directory = readCommentsDirectory();
      return filterCommentsSnapshot(directory.value ?? commentsSub.get().items, query);
    },
    getById: (commentId: string): CommentInfo | null => {
      const fromSnapshot = commentsSub.get().items.find((item) => readEntityId(item) === commentId) ?? null;
      if (fromSnapshot) return fromSnapshot;
      const doc = getDoc();
      const commentsApi = doc?.comments as LooseRecord | undefined;
      const result = safeCall<CommentInfo | null>(
        commentsApi?.get ? () => commentsApi.get({ commentId }) : undefined,
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
      const snapshot = selectionSub.get();
      const target = snapshot.target ?? snapshot.selectionTarget;
      if (snapshot.empty || !target) {
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
        recompute();
        return true;
      }
      // A non-null activation needs a mounted editor to resolve the comment list.
      if (!getEditor()) return false;
      const snapshot = commentsSub.get();
      const directory = asyncReads.get('comments');
      const directoryItems =
        directory?.token === contentToken() && directory.hasSettled && Array.isArray(directory.value)
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
      explicitActiveCommentId = resolvedId;
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
  const navigateAndScrollCurrentRequest = async (
    step: 1 | -1,
    requestedAtInvalidation: number,
  ): Promise<ScrollIntoViewOutput> => {
    if (queuedTrackChangeNavigationInvalidation !== requestedAtInvalidation) return { success: false };
    const previousActiveChange = explicitActiveChange;
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
      setExplicitActiveChange(previousActiveChange, { invalidateQueuedNavigation: false });
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
          mirrorTrackedChangeFocusToHost(previousActiveChange);
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
      const previousActiveChange = explicitActiveChange;
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
          setExplicitActiveChange(previousActiveChange, { invalidateQueuedNavigation: false });
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
            mirrorTrackedChangeFocusToHost(previousActiveChange);
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
  ): CommandExecutionResult => {
    try {
      return settleCommandExecution(callTrackDecisionTarget(kind, target, changeId, story));
    } catch {
      return false;
    }
  };

  const callTrackDecisionTarget = (
    kind: 'accept' | 'reject',
    target: LooseRecord,
    changeId: string | null,
    story?: unknown,
  ): unknown => {
    if (trackedChangeDecisionsAreDisabled()) return false;
    const doc = getDoc();
    const tcApi = doc?.trackChanges as LooseRecord | undefined;
    const isAllTarget = target.kind === 'all' || target.scope === 'all';
    const isRangeTarget = target.kind === 'range';
    const isMultiIdTarget = target.kind === 'ids';
    const permissionIds = isAllTarget
      ? []
      : isMultiIdTarget && Array.isArray(target.ids)
        ? target.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : changeId
          ? [changeId]
          : [];
    if (permissionIds.length > 0 && trackedChangeDecisionPermissionReason(kind, permissionIds)) return false;
    const bulkBlocked = bulkTrackDecisionBlockedReason({ kind, scope: isAllTarget ? 'all' : 'id' }, tcApi);
    if (bulkBlocked) return false;
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

  const contentControlsSub = sliceHandle((s) => s.contentControls);
  const findContentControl = (id: string): ContentControlInfo | null => {
    const items = contentControlsSub.get().items;
    return items.find((item) => item?.id === id) ?? null;
  };

  // While a panel observes the catalog, renew demand on every content revision
  // the way the comments and tracked-change directories do. The passive slice
  // only records demand for the revision it was attached at, so a mounted
  // panel would otherwise serve a stale catalog until the idle release.
  const contentControlsDirectorySub = select((s) => {
    if (directoryLeaseCounts.contentControls > 0) demandHeavyDocRead('contentControls');
    return s.contentControls;
  });
  const contentControlsSnap = directorySnapshotHandle(
    contentControlsSub,
    contentControlsDirectorySub,
    'contentControls',
  );
  const contentControlsGet = ((input?: { id: string }): ContentControlsSlice | ContentControlInfo | null => {
    if (input === undefined) return contentControlsSnap.get();
    const id = readContentControlRequestId(input);
    return id ? findContentControl(id) : null;
  }) as ContentControlsHandle['get'];
  // Internal subscription for the core active-change bridge. It reads the
  // passive slice and never takes the directory lease, so merely enabling
  // `onContentControlActiveChange` cannot renew catalog demand on every typing
  // revision and bypass the heavy-read idle gate.
  const contentControlsPassiveSnap = snapshotHandle(contentControlsSub);
  let contentControlHighlightGeneration = 0;
  let contentControlHighlightHost: LooseRecord | null = null;
  const clearContentControlHighlight = (): void => {
    contentControlHighlightGeneration += 1;
    const host = contentControlHighlightHost ?? getHost();
    contentControlHighlightHost = null;
    safeCall(() => (host?.clearContentControlHighlight as AnyFn | undefined)?.call(host), undefined);
  };
  documentResetHooks.push(clearContentControlHighlight);
  const contentControls: ContentControlsHandle = {
    clearHighlight: clearContentControlHighlight,
    highlight: async (input): Promise<ContentControlHighlightResult> => {
      const id = readContentControlRequestId(input);
      if (!id) return { success: false, reason: 'invalid-id' };
      const host = getHost();
      const editor = getEditor();
      const controls = getDoc()?.contentControls as LooseRecord | undefined;
      if (
        disposed ||
        !host ||
        typeof host.highlightContentControl !== 'function' ||
        typeof controls?.list !== 'function'
      ) {
        return { success: false, reason: 'not-ready' };
      }
      const request = ++contentControlHighlightGeneration;
      contentControlHighlightHost = host;
      safeCall(() => (host.cancelContentControlHighlightRequest as AnyFn | undefined)?.call(host), undefined);
      const cancelled = () => disposed || request !== contentControlHighlightGeneration || editor !== getEditor();
      try {
        const catalog = await (controls.list as AnyFn).call(controls);
        if (cancelled()) return { success: false, reason: 'cancelled' };
        const control = (catalog?.items as ContentControlInfo[] | undefined)?.find((item) => item.id === id);
        if (!control) return { success: false, reason: 'not-found' };
        const target = readSelectionTarget(control);
        if (!target || control.isEmpty) return { success: false, reason: 'not-reachable' };
        const success = await (host.highlightContentControl as AnyFn).call(host, id, target);
        if (cancelled()) return { success: false, reason: 'cancelled' };
        return success ? { success: true } : { success: false, reason: 'not-reachable' };
      } catch {
        return { success: false, reason: cancelled() ? 'cancelled' : 'not-reachable' };
      }
    },
    // The read helpers below are explicit consumer demand for the catalog:
    // during source loading they stay best-effort over the (pending/stale)
    // passive slice, but flag the demand so the coordinator issues the real
    // `contentControls.list` read instead of deferring it to source-complete.
    get: ((input?: { id: string }) => {
      if (input !== undefined) ensureContentControlsCatalog('api');
      return contentControlsGet(input as never);
    }) as ContentControlsHandle['get'],
    getSnapshot: contentControlsSnap.getSnapshot,
    subscribe: contentControlsSnap.subscribe,
    observe: contentControlsSnap.observe,
    observeActivePath: contentControlsPassiveSnap.observe,
    list: () => {
      ensureContentControlsCatalog('api');
      return contentControlsSub.get().items;
    },
    getById: (id) => {
      ensureContentControlsCatalog('api');
      return findContentControl(id);
    },
    getRect: (input): ViewportRectResult => {
      const id = readContentControlRequestId(input);
      if (!id) return rectFailure('unresolved');
      ensureContentControlsCatalog('panel');
      const control = findContentControl(id);
      if (!control) return rectFailure('unresolved');
      const target = readSelectionTarget(control);
      if (!target) return rectFailure('unavailable');
      return viewport.getRect({ target: target as ViewportGetRectInput['target'] });
    },
    scrollIntoView: async (input): Promise<ScrollIntoViewOutput> => {
      const id = readContentControlRequestId(input);
      if (!id) return { success: false };
      ensureContentControlsCatalog('panel');
      const control = findContentControl(id);
      if (!control) return { success: false };
      const target = readSelectionTarget(control);
      if (!target) return { success: false };
      const result = await scrollTargetIntoView(target, { block: input.block, behavior: input.behavior });
      return { success: result.ok };
    },
    focus: async (input): Promise<ContentControlFocusResult> => {
      const id = readContentControlRequestId(input);
      if (!id) return { success: false, reason: 'invalid-id' };
      if (!getEditor()) return { success: false, reason: 'not-ready' };
      ensureContentControlsCatalog('panel');
      const control = findContentControl(id);
      if (!control) return { success: false, reason: 'not-found' };
      // The control exists but has no resolvable anchor - it can't be
      // scrolled to, the same failure mode as a routable scroll that fails,
      // not "no such control" (which `findContentControl` already covers).
      const target = readSelectionTarget(control);
      if (!target) return { success: false, reason: 'not-reachable' };
      const result = await scrollTargetIntoView(target, { block: input.block, behavior: input.behavior });
      if (!result.ok) return { success: false, reason: 'not-reachable' };
      // Place a collapsed caret through the same selection-application surface
      // as `ui.selection.apply` after scrolling; virtualized targets may not be
      // mounted until the scroll completes.
      const caretTarget = collapseSelectionTargetToCaret(target);
      if (!caretTarget) return { success: false, reason: 'not-reachable' };
      const applyResult = selection.apply(caretTarget);
      if (!applyResult.ok && applyResult.reason !== SUPERDOC_UI_REASONS.hostCapabilityUnavailable) {
        return { success: false, reason: 'not-reachable' };
      }
      activateContentControlChrome(id);
      return { success: true };
    },
  };

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
      const result = safeCall<unknown>(doc?.getText ? () => (doc.getText as AnyFn)({}) : undefined, null);
      if (typeof result === 'string') return result;
      if (result && typeof result === 'object' && typeof (result as LooseRecord).text === 'string') {
        return (result as LooseRecord).text;
      }
      return null;
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
  const pointEntityHits = (x: unknown, y: unknown): readonly ViewportEntityHit[] => {
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    // The DOM `document` is reached through `globalThis.document` because the
    // local `document: DocumentHandle` shadows it for type-checking. Guard SSR /
    // non-browser stubs explicitly so the call doesn't throw without a DOM.
    const dom = (globalThis as { document?: Document }).document;
    if (!dom || typeof dom.elementFromPoint !== 'function') return [];
    // Scope the lookup to THIS controller's visible host (mount container, else
    // the SuperDoc root) so a page with two mounted instances never cross-reads
    // the other's painted DOM. Null host (pre-mount / post-destroy / SSR) -> [].
    const container = resolveVisibleHost();
    if (!container) return [];
    const startEl = dom.elementFromPoint(x, y);
    if (!startEl || !container.contains(startEl)) return [];

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
      return rect != null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
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
      if (hit.type !== 'trackedChange') {
        const key = `${hit.type}:${hit.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(hit);
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

  function contextAt(input: { x: number; y: number }): ViewportContext {
    const validInput = !!input && typeof input.x === 'number' && typeof input.y === 'number';
    // A fresh object: callers reuse and mutate pointer coordinates, and the
    // returned point must keep describing the hits that were resolved.
    const point = validInput ? { x: input.x, y: input.y } : { x: 0, y: 0 };

    return {
      point,
      entities: validInput ? entityAt(point) : [],
      selection: state.selection,
      position: null,
      insideSelection: false,
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
      const result = host.observeGeometry(() => entry.schedule());
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

  const viewport: ViewportHandle = {
    getRect: (input: ViewportGetRectInput): ViewportRectResult => {
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
    scrollIntoView: async (input: ScrollIntoViewInput): Promise<ScrollIntoViewOutput> => {
      const rawTarget = input?.target;
      if (!rawTarget) return { success: false };

      // Resolve the input target into the segment-shaped text target the host
      // scroll surface consumes, then route through the shared helper so this
      // fails closed identically to the per-entity `scrollTo` methods.
      let target: unknown | null = null;
      if (rawTarget.kind === 'entity') {
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
          target = { kind: 'text', segments, ...(story ? { story } : {}) };
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

  /** Resolve a metadata id to its SelectionTarget, or null when unresolved. */
  const resolveMetadataTarget = (id: string): unknown | null => {
    const doc = getDoc();
    const metaApi = doc?.metadata as LooseRecord | undefined;
    if (!metaApi || typeof metaApi.resolve !== 'function') return null;
    const { value } = readAsync<unknown>(
      metadataResolveKey(id),
      contentToken(),
      () => metaApi.resolve({ id }),
      readMetadataResolvedTarget,
    );
    return value;
  };

  const resolveMetadataTargetAsync = async (id: string): Promise<unknown | null> => {
    const doc = getDoc();
    const metaApi = doc?.metadata as LooseRecord | undefined;
    if (!metaApi || typeof metaApi.resolve !== 'function') return null;
    try {
      const token = contentToken();
      const resolved = await Promise.resolve(metaApi.resolve({ id }));
      if (token !== contentToken()) return null;
      const target = readMetadataResolvedTarget(resolved);
      asyncReads.set(metadataResolveKey(id), {
        token,
        value: target,
        hasSettled: true,
        inflightToken: null,
      });
      return target;
    } catch {
      return null;
    }
  };

  const metadata: MetadataHandle = {
    getRect: (input): ViewportRectResult & { success: boolean; rect?: ViewportRect } => {
      const doc = getDoc();
      const metaApi = doc?.metadata as LooseRecord | undefined;
      if (!metaApi || typeof metaApi.resolve !== 'function') {
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
  };
  const tables: TablesHandle = {
    getContext: (): TableContextInfo => {
      const context = resolveTableContext();
      if (!context) return { ...EMPTY_TABLE_CONTEXT };
      const snapshot = readHostTableContext();
      const table = snapshot?.table as LooseRecord | undefined;
      return {
        inTable: true,
        tableNodeId: context.tableNodeId,
        rowIndex: context.rowIndex,
        columnIndex: context.columnIndex,
        cellNodeId: context.cellNodeId,
        rows: typeof table?.rows === 'number' ? table.rows : null,
        columns: typeof table?.columns === 'number' ? table.columns : null,
      };
    },
    isInTable: (): boolean => resolveTableContext() != null,
  };

  // -- search (shared search/find facade) -----------------------------------
  // Routes through the single V2 host search session (`host.search`), which
  // owns query, navigation, reveal, and replace. `replace` / `replaceAll`
  // mutate the document and fail closed in viewing/read-only mode. When the
  // host exposes no search facade the whole surface is `available: false` /
  // `search-unavailable` and never fabricates matches. Both the built-in
  // toolbar and custom UIs read/drive it.
  const SEARCH_UNAVAILABLE_SLICE: SearchSnapshot = {
    query: '',
    total: 0,
    activeIndex: -1,
    open: false,
    available: false,
    caseSensitive: false,
    includeTrackedDeletions: false,
    includeDeletedText: false,
    regex: false,
    canReplace: false,
    canReplaceAll: false,
    reason: SUPERDOC_UI_REASONS.searchUnavailable,
  };
  let searchState: SearchSnapshot = { ...SEARCH_UNAVAILABLE_SLICE };
  const searchListeners = new Set<(slice: SearchSnapshot) => void>();

  const getHostSearch = (): LooseRecord | null => {
    const host = getHost();
    const search = host?.search;
    return search && typeof search === 'object' ? (search as LooseRecord) : null;
  };
  const getEditCommandSearch = (): LooseRecord | null => {
    const editCommands = getEditCommands();
    const search = editCommands?.search;
    return search && typeof search === 'object' ? (search as LooseRecord) : null;
  };
  const searchIsAvailable = (): boolean => {
    const search = getHostSearch();
    if (search && typeof search.setSession === 'function') return true;
    const editSearch = getEditCommandSearch();
    return Boolean(editSearch) && typeof editSearch!.query === 'function' && typeof editSearch!.getState === 'function';
  };
  const emitSearch = (): void => {
    for (const listener of [...searchListeners]) {
      try {
        listener(searchState);
      } catch {
        /* a search listener failure must not break the controller */
      }
    }
  };
  const setSearchState = (patch: Partial<SearchSnapshot>): SearchSnapshot => {
    searchState = { ...searchState, ...patch };
    const includeTrackedDeletions = patch.includeTrackedDeletions ?? patch.includeDeletedText;
    if (includeTrackedDeletions !== undefined) {
      searchState.includeTrackedDeletions = includeTrackedDeletions;
      searchState.includeDeletedText = includeTrackedDeletions;
    }
    emitSearch();
    return searchState;
  };
  // Monotonic token for async fallback queries: a query result that resolves
  // after a newer find() call (or after close()) is stale and must not be
  // applied over the newer session's state.
  let searchRequestGeneration = 0;
  // The worker-backed fallback answers `find()` asynchronously. While a request
  // is outstanding the shell's `getState()` still describes the previous
  // session, which may share the query and differ only in options. Nothing
  // from the shell is trusted until the request that matches this generation
  // settles; snapshots report no matches in the interim.
  let pendingFallbackGeneration: number | null = null;

  /**
   * How to tear down the session that is currently open, captured when it was
   * opened.
   *
   * A closure rather than a reference to the facade, because the two search
   * paths are released differently: a host session ends with `host.clear()`,
   * while the worker-backed fallback ends by querying the empty string through
   * `editCommands.search`. Both bind to the editor that owned them, and by the
   * time an active-editor change reaches us `activeEditor` already points at the
   * replacement, so neither is reachable by looking it up again. Capturing the
   * teardown keeps the two paths from drifting apart: whichever one opens a
   * session is the one that says how to close it.
   */
  let releaseActiveSearchSession: (() => void) | null = null;

  /** Release whatever session is open, then forget it. */
  const releaseSearchSession = (): void => {
    const release = releaseActiveSearchSession;
    releaseActiveSearchSession = null;
    if (!release) return;
    safeCall<unknown>(() => {
      release();
      return null;
    }, null);
  };

  /**
   * Drop everything the previous active editor owned.
   *
   * Three separate hazards. An in-flight async query still holds a generation
   * that is current, so without bumping the token it would resolve and publish
   * the old document's matches into the new one. The slice itself describes a
   * document that is gone: leaving it in place reports a total and an active
   * match for content nobody is looking at any more. And the previous host still
   * holds the session it painted, so without clearing it the old document keeps
   * its highlights and switching back shows a closed slice over a host that
   * still has matches.
   *
   * This closes the session rather than re-running the query against the
   * replacement document. Re-running is a plausible product choice and arguably
   * the nicer one, but it is a feature decision, not the correctness fix, so it
   * is deliberately not made here.
   */
  const resetSearchForActiveEditorChange = (): void => {
    searchRequestGeneration += 1;
    pendingFallbackGeneration = null;
    shellFallbackOutstanding = false;
    releaseSearchSession();
    const available = searchIsAvailable();
    searchState = {
      ...SEARCH_UNAVAILABLE_SLICE,
      available,
      reason: available ? undefined : SUPERDOC_UI_REASONS.searchUnavailable,
    };
    emitSearch();
  };

  documentResetHooks.push(resetSearchForActiveEditorChange);
  // `canReplace` / `canReplaceAll` come from the host's live document mode.
  // Search publishes through `searchListeners`, not the aggregate listener set,
  // so a mode flip would otherwise leave subscribers on the previous capability
  // until the next search call.
  documentModeChangeHooks.push(() => {
    if (pendingFallbackGeneration === searchRequestGeneration) return;
    const before = searchState;
    const after = syncSearchStateFromHost();
    if (
      after.canReplace !== before.canReplace ||
      after.canReplaceAll !== before.canReplaceAll ||
      after.available !== before.available ||
      after.reason !== before.reason
    ) {
      emitSearch();
    }
  });
  const readSearchQueryError = (record: LooseRecord | null): boolean => {
    if (!record) return false;
    const queryError = record.queryError;
    if (queryError && typeof queryError === 'object' && (queryError as LooseRecord).code === 'invalid-pattern') {
      return true;
    }
    // Shell command outcomes report an invalid pattern as a typed rejection.
    const rejection = record.rejection;
    return (
      record.status === 'rejected' &&
      Boolean(rejection) &&
      typeof rejection === 'object' &&
      (rejection as LooseRecord).code === 'invalid-pattern'
    );
  };
  const normalizeHostSearchResult = (
    result: unknown,
    fallbackCanReplace = false,
    fallbackCanReplaceAll = fallbackCanReplace,
  ): {
    query?: string;
    total: number;
    activeIndex: number;
    canReplace: boolean;
    canReplaceAll: boolean;
    caseSensitive?: boolean;
    includeDeletedText?: boolean;
    regex?: boolean;
    invalidPattern?: boolean;
  } | null => {
    const record = result && typeof result === 'object' ? (result as LooseRecord) : null;
    if (!record) return null;
    const matches = Array.isArray(record.matches) ? record.matches : [];
    const total = typeof record.total === 'number' && Number.isFinite(record.total) ? record.total : matches.length;
    const activeIndex =
      typeof record.activeMatchIndex === 'number'
        ? record.activeMatchIndex
        : typeof record.activeIndex === 'number'
          ? record.activeIndex
          : -1;
    const canReplace = record.canReplace === true || fallbackCanReplace;
    return {
      ...(typeof record.query === 'string' ? { query: record.query } : {}),
      total,
      activeIndex,
      canReplace,
      // Replace all is an action, not a mode: the host reports `canReplace`
      // from document mutability alone, so an empty session must not advertise
      // it. A truncated session cannot enumerate every match, so replacing all
      // of them is refused even though the active match still can be.
      canReplaceAll:
        canReplace && total > 0 && record.truncated !== true && (record.canReplace === true || fallbackCanReplaceAll),
      ...(typeof record.caseSensitive === 'boolean' ? { caseSensitive: record.caseSensitive } : {}),
      ...(typeof record.includeDeletedText === 'boolean' ? { includeDeletedText: record.includeDeletedText } : {}),
      ...(record.regex === true ? { regex: true } : {}),
      ...(readSearchQueryError(record) ? { invalidPattern: true } : {}),
    };
  };
  // The shell reports replace and replace-all separately: a session with more
  // matches than it enumerates keeps `find.replace` enabled and disables
  // `find.replaceAll` with `search-truncated`.
  // Tracks whether find() handed the shell a query it may still be resolving
  // through the Document API fallback. Querying the empty string is how the
  // shell advances its fallback generation and releases that paint.
  let shellFallbackOutstanding = false;
  const cancelOutstandingShellFallback = (): void => {
    if (!shellFallbackOutstanding) return;
    shellFallbackOutstanding = false;
    const editSearch = getEditCommandSearch();
    if (editSearch && typeof editSearch.query === 'function') {
      safeCall<unknown>(() => editSearch.query({ query: '' }), null);
    }
  };
  const readEditCommandCanReplace = (): boolean => readEditCommandStateEntry('find.replace')?.enabled === true;
  const readEditCommandCanReplaceAll = (): boolean => readEditCommandStateEntry('find.replaceAll')?.enabled === true;
  const applyHostSearchResult = (
    result: unknown,
    fallbackCanReplace = false,
    fallbackCanReplaceAll = fallbackCanReplace,
  ): void => {
    const snapshot = normalizeHostSearchResult(result, fallbackCanReplace, fallbackCanReplaceAll);
    if (!snapshot) {
      setSearchState({ total: 0, activeIndex: -1, canReplace: false, canReplaceAll: false, reason: undefined });
      return;
    }
    setSearchState({
      ...(snapshot.query !== undefined ? { query: snapshot.query } : {}),
      total: snapshot.total,
      activeIndex: snapshot.activeIndex,
      canReplace: snapshot.canReplace,
      canReplaceAll: snapshot.canReplaceAll,
      ...(snapshot.includeDeletedText !== undefined ? { includeDeletedText: snapshot.includeDeletedText } : {}),
      ...(snapshot.regex !== undefined ? { regex: snapshot.regex } : {}),
      // The surface stays available on an invalid pattern; the reason names the
      // input error so the UI can render an inline message instead of "no results".
      reason: snapshot.invalidPattern ? SUPERDOC_UI_REASONS.searchInvalidPattern : undefined,
    });
  };
  const syncSearchStateFromHost = (): SearchSnapshot => {
    const host = getHostSearch();
    if (host && typeof host.getState !== 'function') {
      searchState = {
        ...searchState,
        available: searchIsAvailable(),
        reason: searchIsAvailable() ? undefined : SUPERDOC_UI_REASONS.searchUnavailable,
      };
      return searchState;
    }
    if (!host) {
      const editSearch = getEditCommandSearch();
      if (editSearch && typeof editSearch.getState === 'function') {
        const editSnapshot = normalizeHostSearchResult(
          safeCall<unknown>(() => editSearch.getState(), null),
          readEditCommandCanReplace(),
          readEditCommandCanReplaceAll(),
        );
        // While a worker-backed request is outstanding the shell's state
        // describes the previous session. Copying it back here would resurface
        // the old matches through getSnapshot() and new observers, so the
        // published no-match snapshot stands until that request settles.
        if (pendingFallbackGeneration === searchRequestGeneration) return searchState;
        if (editSnapshot) {
          searchState = {
            ...searchState,
            ...(editSnapshot.query !== undefined ? { query: editSnapshot.query } : {}),
            total: editSnapshot.total,
            activeIndex: editSnapshot.activeIndex,
            canReplace: editSnapshot.canReplace,
            canReplaceAll: editSnapshot.canReplaceAll,
            available: true,
            reason: editSnapshot.invalidPattern ? SUPERDOC_UI_REASONS.searchInvalidPattern : undefined,
            open: searchState.open || Boolean(editSnapshot.query),
          };
          return searchState;
        }
      }
      searchState = {
        ...SEARCH_UNAVAILABLE_SLICE,
        query: searchState.query,
        caseSensitive: searchState.caseSensitive,
        includeTrackedDeletions: searchState.includeTrackedDeletions,
        includeDeletedText: searchState.includeDeletedText,
      };
      return searchState;
    }
    const snapshot = normalizeHostSearchResult(safeCall<unknown>(() => host.getState(), null));
    if (!snapshot) return searchState;
    searchState = {
      ...searchState,
      ...(snapshot.query !== undefined ? { query: snapshot.query } : {}),
      total: snapshot.total,
      activeIndex: snapshot.activeIndex,
      canReplace: snapshot.canReplace,
      canReplaceAll: snapshot.canReplaceAll,
      ...(snapshot.includeDeletedText !== undefined ? { includeDeletedText: snapshot.includeDeletedText } : {}),
      ...(snapshot.includeDeletedText !== undefined ? { includeTrackedDeletions: snapshot.includeDeletedText } : {}),
      ...(snapshot.regex !== undefined ? { regex: snapshot.regex } : {}),
      available: true,
      reason: snapshot.invalidPattern ? SUPERDOC_UI_REASONS.searchInvalidPattern : undefined,
      open: searchState.open || Boolean(snapshot.query),
    };
    return searchState;
  };
  const mapHostReplaceResult = (result: unknown): WorkflowActionResult => {
    const record = result && typeof result === 'object' ? (result as LooseRecord) : null;
    if (record?.status === 'committed') return { ok: true };
    if (record?.status === 'rejected' && record.reason === 'read-only') {
      return { ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly };
    }
    const rejection = record?.rejection;
    if (
      record?.status === 'rejected' &&
      rejection &&
      typeof rejection === 'object' &&
      (rejection as LooseRecord).code === 'read-only-document'
    ) {
      return { ok: false, reason: SUPERDOC_UI_REASONS.documentReadonly };
    }
    // rejected (no-query/no-match/truncated/document-api-unavailable),
    // receipt-failure, or an unrecognized shape all fail closed the same way.
    return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
  };
  const searchSnap = snapshotHandle<SearchSnapshot>({
    get: () => syncSearchStateFromHost(),
    subscribe: (listener) => {
      searchListeners.add(listener);
      return () => searchListeners.delete(listener);
    },
  });
  const search: SearchController = {
    get: searchSnap.get,
    getSnapshot: searchSnap.getSnapshot,
    subscribe: searchSnap.subscribe,
    observe: searchSnap.observe,
    open: (): WorkflowActionResult => {
      if (!searchIsAvailable()) {
        setSearchState({ available: false, open: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
        return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
      }
      setSearchState({ available: true, open: true, reason: undefined });
      return { ok: true };
    },
    close: (): void => {
      // Invalidate in-flight async queries so a late result cannot write into
      // the closed session.
      searchRequestGeneration += 1;
      if (releaseActiveSearchSession) {
        // Prefer what the session recorded about itself. Re-deriving from the
        // current facade cleared the host twice and never reached a fallback
        // that had also painted, and it addresses the wrong editor entirely
        // once the active one has changed.
        releaseSearchSession();
      } else {
        // Nothing captured, so no session was opened through `find()`; clear
        // whatever the current editor exposes.
        const host = getHostSearch();
        if (host && typeof host.clear === 'function') {
          safeCall<unknown>(() => host.clear(), null);
        } else {
          const editSearch = getEditCommandSearch();
          if (editSearch && typeof editSearch.query === 'function') {
            safeCall<unknown>(() => editSearch.query({ query: '' }), null);
          }
        }
      }
      searchState = { ...SEARCH_UNAVAILABLE_SLICE, available: searchIsAvailable(), reason: undefined };
      if (!searchState.available) searchState.reason = SUPERDOC_UI_REASONS.searchUnavailable;
      emitSearch();
    },
    find: (query: string, options?: SearchQueryOptions): SearchSnapshot => {
      const host = getHostSearch();
      const caseSensitive = Boolean(options?.caseSensitive);
      const includeDeletedText = (options?.includeTrackedDeletions ?? options?.includeDeletedText) === true;
      const regex = options?.regex === true;
      const generation = ++searchRequestGeneration;
      // A previous find() may have handed the shell a Document API fallback
      // that is still running. Its generation only advances when the shell's
      // query() is called again, and a query the host answers synchronously
      // never calls it; the stale fallback would then resolve and project its
      // own session onto the host. Advance it now, before this request runs.
      cancelOutstandingShellFallback();
      if (!host || typeof host.setSession !== 'function') {
        const editSearch = getEditCommandSearch();
        if (editSearch && typeof editSearch.query === 'function' && typeof editSearch.getState === 'function') {
          // Observers run inline, so the first publication of this query must
          // already describe it: carrying the previous session's totals and
          // replace capabilities here would let a re-entrant observer act on
          // the old shell session. The request counts as pending from this
          // emit until its own result lands, synchronously or not.
          pendingFallbackGeneration = generation;
          setSearchState({
            query,
            caseSensitive,
            includeDeletedText,
            regex,
            total: 0,
            activeIndex: -1,
            canReplace: false,
            canReplaceAll: false,
            available: true,
            open: true,
            reason: undefined,
          });
          // The worker-backed fallback paints too, and it is released by querying
          // the empty string rather than by `clear()`. Captured for the same
          // reason as the host path: this facade belongs to the current editor.
          releaseActiveSearchSession = () => {
            editSearch.query({ query: '' });
          };
          const result = safeCall<unknown>(
            () => editSearch.query({ query, caseSensitive, includeDeletedText, regex }),
            null,
          );
          if (isPromiseLike(result)) {
            shellFallbackOutstanding = true;
            // The shell answers asynchronously, and until it does its state
            // describes whichever session it last settled. The production shell
            // exposes only query, total, activeIndex, and canReplace, so no
            // reading of that state can prove it belongs to this request: an
            // A -> B -> A sequence, or the same query with new options, both
            // look current. Nothing is published until this request's own
            // result settles; the session reports no matches meanwhile.
            void Promise.resolve(result).then(
              (resolved) => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                pendingFallbackGeneration = null;
                applyHostSearchResult(resolved, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
              },
              () => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                // The shell rethrows without replacing its stored session, so
                // its state still describes the previous query. Leave the
                // pending guard in place: this request's failed no-match
                // snapshot stays authoritative until the next request.
                setSearchState({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
              },
            );
            return searchState;
          }
          pendingFallbackGeneration = null;
          applyHostSearchResult(result, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
          applyHostSearchResult(
            safeCall<unknown>(() => editSearch.getState(), null),
            readEditCommandCanReplace(),
            readEditCommandCanReplaceAll(),
          );
          return searchState;
        }
        return setSearchState({
          query,
          total: 0,
          activeIndex: -1,
          available: false,
          caseSensitive,
          includeDeletedText,
          regex,
          reason: SUPERDOC_UI_REASONS.searchUnavailable,
        });
      }
      setSearchState({
        query,
        caseSensitive,
        includeDeletedText,
        regex,
        available: true,
        open: true,
        reason: undefined,
      });
      // Capture how to release this session while the host is still reachable;
      // an active-editor change has to close it after `activeEditor` has moved on.
      releaseActiveSearchSession = () => {
        if (typeof host.clear === 'function') host.clear();
      };
      const result = safeCall<unknown>(
        () =>
          host.setSession(query, {
            caseSensitive,
            includeDeletedText,
            ...(regex ? { regex: true } : {}),
            highlight: true,
          }),
        null,
      );
      applyHostSearchResult(result);
      if (
        query.length > 0 &&
        searchState.total === 0 &&
        searchState.reason !== SUPERDOC_UI_REASONS.searchInvalidPattern
      ) {
        const editSearch = getEditCommandSearch();
        if (editSearch && typeof editSearch.query === 'function' && typeof editSearch.getState === 'function') {
          // The host opened a session and found nothing, and now the fallback
          // runs and paints its own. Two backends are holding a session, so the
          // teardown has to release both: composing onto whatever the host path
          // captured, rather than replacing it, is what makes that true.
          const releaseHostSession = releaseActiveSearchSession;
          releaseActiveSearchSession = () => {
            releaseHostSession?.();
            editSearch.query({ query: '' });
          };
          const commandResult = safeCall<unknown>(
            () => editSearch.query({ query, caseSensitive, includeDeletedText, regex }),
            null,
          );
          if (isPromiseLike(commandResult)) {
            shellFallbackOutstanding = true;
            void Promise.resolve(commandResult).then(
              (resolved) => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                applyHostSearchResult(resolved, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
              },
              () => {
                if (generation !== searchRequestGeneration) return;
                shellFallbackOutstanding = false;
                setSearchState({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
              },
            );
          } else {
            applyHostSearchResult(commandResult, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
          }
          applyHostSearchResult(
            safeCall<unknown>(() => editSearch.getState(), null),
            readEditCommandCanReplace(),
            readEditCommandCanReplaceAll(),
          );
        }
      }
      return searchState;
    },
    search: (query: string, options?: SearchQueryOptions): SearchSnapshot => search.find(query, options),
    next: (): WorkflowActionResult => {
      const host = getHostSearch();
      if (!host || typeof host.next !== 'function') {
        const editSearch = getEditCommandSearch();
        if (!editSearch || typeof editSearch.next !== 'function' || typeof editSearch.getState !== 'function') {
          return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
        }
        if (searchState.total === 0) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
        const result = safeCall<unknown>(() => editSearch.next(), null);
        if (isPromiseLike(result)) {
          // Navigation continues an existing session, so the token is read
          // rather than advanced. `close()`, an active-editor change and
          // `destroy()` all move it, which is what makes a late result stale.
          const generation = searchRequestGeneration;
          // `Promise.resolve` upgrades the bare thenable so the rejection
          // handler also covers a throwing fulfillment handler, matching
          // `.then(...).catch(...)` semantics on a real promise.
          void Promise.resolve(result)
            .then((resolved) => {
              if (generation !== searchRequestGeneration) return;
              applyHostSearchResult(resolved, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
            })
            .catch(() => {
              if (generation !== searchRequestGeneration) return;
              setSearchState({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
            });
        } else {
          applyHostSearchResult(result, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
        }
        applyHostSearchResult(
          safeCall<unknown>(() => editSearch.getState(), null),
          readEditCommandCanReplace(),
          readEditCommandCanReplaceAll(),
        );
        return { ok: true };
      }
      if (searchState.total === 0) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      applyHostSearchResult(safeCall<unknown>(() => host.next(), null));
      return { ok: true };
    },
    previous: (): WorkflowActionResult => {
      const host = getHostSearch();
      if (!host || typeof host.previous !== 'function') {
        const editSearch = getEditCommandSearch();
        if (!editSearch || typeof editSearch.previous !== 'function' || typeof editSearch.getState !== 'function') {
          return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
        }
        if (searchState.total === 0) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
        const result = safeCall<unknown>(() => editSearch.previous(), null);
        if (isPromiseLike(result)) {
          // Navigation continues an existing session, so the token is read
          // rather than advanced. `close()`, an active-editor change and
          // `destroy()` all move it, which is what makes a late result stale.
          const generation = searchRequestGeneration;
          // `Promise.resolve` upgrades the bare thenable so the rejection
          // handler also covers a throwing fulfillment handler, matching
          // `.then(...).catch(...)` semantics on a real promise.
          void Promise.resolve(result)
            .then((resolved) => {
              if (generation !== searchRequestGeneration) return;
              applyHostSearchResult(resolved, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
            })
            .catch(() => {
              if (generation !== searchRequestGeneration) return;
              setSearchState({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
            });
        } else {
          applyHostSearchResult(result, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
        }
        applyHostSearchResult(
          safeCall<unknown>(() => editSearch.getState(), null),
          readEditCommandCanReplace(),
          readEditCommandCanReplaceAll(),
        );
        return { ok: true };
      }
      if (searchState.total === 0) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      applyHostSearchResult(safeCall<unknown>(() => host.previous(), null));
      return { ok: true };
    },
    clear: (): void => {
      // Same boundary as `close()`: the query and matches are gone, so an
      // in-flight continuation must not republish them. `clear()` keeps the
      // session open where `close()` releases it, but both invalidate the
      // results a late `next()`/`previous()` would write back.
      searchRequestGeneration += 1;
      cancelOutstandingShellFallback();
      const host = getHostSearch();
      if (host && typeof host.clear === 'function') safeCall<unknown>(() => host.clear(), null);
      if (!host || typeof host.clear !== 'function') {
        const editSearch = getEditCommandSearch();
        if (editSearch && typeof editSearch.query === 'function') {
          safeCall<unknown>(() => editSearch.query({ query: '' }), null);
        }
      }
      setSearchState({
        query: '',
        total: 0,
        activeIndex: -1,
        canReplace: false,
        canReplaceAll: false,
        reason: undefined,
      });
    },
    // Replace routes through the single host search session, which owns the
    // match list and read-only gating. Fail closed with a stable reason when
    // the host cannot replace rather than fabricating edits.
    replace: (replacement: string): WorkflowActionResult | Promise<WorkflowActionResult> => {
      const host = getHostSearch();
      if (!host) {
        const editSearch = getEditCommandSearch();
        if (!editSearch || typeof editSearch.replace !== 'function' || typeof editSearch.getState !== 'function') {
          return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
        }
        if (!readEditCommandCanReplace()) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
        const result = safeCall<unknown>(
          () => editSearch.replace({ replacement: typeof replacement === 'string' ? replacement : '' }),
          null,
        );
        if (isPromiseLike(result)) {
          // Worker-backed replace settles asynchronously: resolve with the real
          // mapped outcome so callers hold their pending state until the
          // mutation lands, instead of a fire-and-forget immediate ok.
          // Read, do not advance: this continues the open session. `close()`,
          // `clear()`, an active-editor change and `destroy()` move the token,
          // and a mutation that lands after any of those must not publish into
          // whatever replaced it.
          //
          // Captured BEFORE the pre-settlement emit below, because `emitSearch()`
          // runs observer callbacks synchronously and an observer is free to
          // close or clear the session in response — a find panel dismissing
          // itself when a replace starts is enough. Reading the token afterwards
          // picks up the value that boundary already advanced to, so the late
          // result compares equal, looks current, and republishes the previous
          // session's matches into whatever replaced it.
          //
          // Staleness gates the *publication*, never the reported outcome. The
          // mutation may well have committed, and this method is documented to
          // resolve with the settled outcome once it lands, so reporting
          // `operation-unavailable` would tell a caller their edit did not
          // happen when it did — inviting a duplicate replace or a skipped save.
          const generation = searchRequestGeneration;
          syncSearchStateFromHost();
          emitSearch();
          const isCurrent = () => generation === searchRequestGeneration;
          return Promise.resolve(result).then(
            (resolved) => {
              if (isCurrent()) {
                applyHostSearchResult(resolved, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
                syncSearchStateFromHost();
                emitSearch();
              }
              return mapHostReplaceResult(resolved);
            },
            () => {
              if (isCurrent()) {
                setSearchState({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
              }
              return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
            },
          );
        }
        syncSearchStateFromHost();
        emitSearch();
        return mapHostReplaceResult(result);
      }
      if (typeof host.replaceCurrent !== 'function') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      const result = safeCall<unknown>(
        () => host.replaceCurrent(typeof replacement === 'string' ? replacement : ''),
        null,
      );
      syncSearchStateFromHost();
      emitSearch();
      return mapHostReplaceResult(result);
    },
    replaceAll: (replacement: string): WorkflowActionResult | Promise<WorkflowActionResult> => {
      const host = getHostSearch();
      if (!host) {
        const editSearch = getEditCommandSearch();
        if (!editSearch || typeof editSearch.replaceAll !== 'function' || typeof editSearch.getState !== 'function') {
          return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
        }
        if (!readEditCommandCanReplaceAll()) return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
        const result = safeCall<unknown>(
          () => editSearch.replaceAll({ replacement: typeof replacement === 'string' ? replacement : '' }),
          null,
        );
        if (isPromiseLike(result)) {
          // Worker-backed replace-all settles asynchronously: resolve with the
          // real mapped outcome so callers hold their pending state until the
          // mutations land, instead of a fire-and-forget immediate ok.
          // Read, do not advance: this continues the open session. `close()`,
          // `clear()`, an active-editor change and `destroy()` move the token,
          // and a mutation that lands after any of those must not publish into
          // whatever replaced it.
          //
          // Captured BEFORE the pre-settlement emit below, because `emitSearch()`
          // runs observer callbacks synchronously and an observer is free to
          // close or clear the session in response — a find panel dismissing
          // itself when a replace starts is enough. Reading the token afterwards
          // picks up the value that boundary already advanced to, so the late
          // result compares equal, looks current, and republishes the previous
          // session's matches into whatever replaced it.
          //
          // Staleness gates the *publication*, never the reported outcome. The
          // mutation may well have committed, and this method is documented to
          // resolve with the settled outcome once it lands, so reporting
          // `operation-unavailable` would tell a caller their edit did not
          // happen when it did — inviting a duplicate replace or a skipped save.
          const generation = searchRequestGeneration;
          syncSearchStateFromHost();
          emitSearch();
          const isCurrent = () => generation === searchRequestGeneration;
          return Promise.resolve(result).then(
            (resolved) => {
              if (isCurrent()) {
                applyHostSearchResult(resolved, readEditCommandCanReplace(), readEditCommandCanReplaceAll());
                syncSearchStateFromHost();
                emitSearch();
              }
              return mapHostReplaceResult(resolved);
            },
            () => {
              if (isCurrent()) {
                setSearchState({ available: false, reason: SUPERDOC_UI_REASONS.searchUnavailable });
              }
              return { ok: false, reason: SUPERDOC_UI_REASONS.searchUnavailable };
            },
          );
        }
        syncSearchStateFromHost();
        emitSearch();
        return mapHostReplaceResult(result);
      }
      if (typeof host.replaceAll !== 'function') {
        return { ok: false, reason: SUPERDOC_UI_REASONS.operationUnavailable };
      }
      const result = safeCall<unknown>(() => host.replaceAll(typeof replacement === 'string' ? replacement : ''), null);
      syncSearchStateFromHost();
      emitSearch();
      return mapHostReplaceResult(result);
    },
  };

  // -- styles (read-only catalogue + active paragraph style) ----------------
  const stylesSub = sliceHandle((s) => s.styles);
  const stylesSnap = snapshotHandle(stylesSub);
  const styles: StylesHandle = {
    get: stylesSnap.get,
    getSnapshot: stylesSnap.getSnapshot,
    subscribe: stylesSnap.subscribe,
    observe: stylesSnap.observe,
    getCatalog: (options?: StylesGetCatalogInput): StylesGetCatalogResult | null => {
      demandHeavyDocRead(styleCatalogReadKey(options));
      return readStyleCatalogLive(options).value;
    },
    getQuickGallery: (): readonly StyleCatalogItem[] => stylesSub.get().quickGallery,
    getActiveParagraphStyle: (): ActiveParagraphStyle =>
      computeActiveParagraphStyle(state.selection, getStyleCatalog().cache).style,
  };

  // -- scopes ---------------------------------------------------------------
  const createScope = (): SuperDocUIScope => {
    const scopeUnsubs: Array<() => void> = [];
    return {
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
    if (disposed) return;
    clearContentControlHighlight();
    disposed = true;
    releaseSharedUiTrackedChangesCatalog(uiTrackedChangesCatalogHost, uiTrackedChangesCatalogState);
    if (foregroundAsyncRetryTimer) {
      clearTimeout(foregroundAsyncRetryTimer);
      foregroundAsyncRetryTimer = null;
    }
    if (asyncReadFailureRetryTimer) {
      clearTimeout(asyncReadFailureRetryTimer);
      asyncReadFailureRetryTimer = null;
      asyncReadFailureRetryAtMs = 0;
    }
    if (pendingEffectiveInlineRead?.timer) {
      clearTimeout(pendingEffectiveInlineRead.timer);
      pendingEffectiveInlineRead.timer = null;
    }
    pendingEffectiveInlineRead = null;
    if (typingContentInvalidationTimer) {
      clearTimeout(typingContentInvalidationTimer);
      typingContentInvalidationTimer = null;
    }
    if (heavyReadCompletionRecomputeTimer) {
      clearTimeout(heavyReadCompletionRecomputeTimer);
      heavyReadCompletionRecomputeTimer = null;
    }
    if (detachSourceLoading) detachSourceLoading();
    detachSourceLoading = null;
    sourceLoadingSubscriptionHost = null;
    for (const family of Object.keys(directoryLeaseCounts) as DirectoryFamily[]) {
      directoryLeaseCounts[family] = 0;
    }
    demandedHeavyReads.clear();
    incompleteTrackChangesDirectoryReadTokens.clear();
    postSourceCompletionRefreshTokens.clear();
    sourceCompletionObservedToken = null;
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
    searchListeners.clear();
    // A format-painter capture that is mid-await outlives this call. Its
    // continuation re-checks the epoch before publishing, so bumping the epoch
    // is what actually stops it; guarding the handle's entry points only blocks
    // captures that have not started. Without this, a capture begun a moment
    // before teardown still reaches its listeners and calls back into UI that
    // has already unmounted.
    painterCaptureEpoch += 1;
    painterModeListeners.clear();
    // In-flight search work outlives this call the same way a painter capture
    // does; moving the token is what stops its continuation from publishing.
    searchRequestGeneration += 1;
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
    fonts,
    zoom,
    document: documentHandle,
    viewport,
    metadata,
    tables,
    search,
    contextMenu,
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
  return controller;
}

/**
 * Default font-family offerings, used to backfill the picker when the active document resolves few
 * (or no) fonts and the runtime picker list is unavailable. Values are logical Word family names —
 * the formatting command writes them verbatim as logical `w:rFonts` intent; the runtime resolves
 * substitutes only at measure/paint time.
 */
const DEFAULT_FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
  { value: 'Arial', label: 'Arial', previewFamily: 'Arial, sans-serif' },
  { value: 'Calibri', label: 'Calibri', previewFamily: 'Calibri, sans-serif' },
  { value: 'Courier New', label: 'Courier New', previewFamily: '"Courier New", monospace' },
  { value: 'Georgia', label: 'Georgia', previewFamily: 'Georgia, serif' },
  { value: 'Times New Roman', label: 'Times New Roman', previewFamily: '"Times New Roman", serif' },
  { value: 'Verdana', label: 'Verdana', previewFamily: 'Verdana, sans-serif' },
];

/**
 * The Word-facing logical family: first family of a CSS stack, quotes stripped.
 * Document / command values sometimes carry `"Cambria, serif"`; the picker must
 * advertise `Cambria` so it dedupes against picker/default rows.
 */
function canonicalFontFamilyName(family: string): string {
  const trimmed = family.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const close = trimmed.indexOf(quote, 1);
    if (close > 0) return trimmed.slice(1, close).trim();
  }
  const comma = trimmed.indexOf(',');
  const first = comma === -1 ? trimmed : trimmed.slice(0, comma);
  return first.trim().replace(/^["']|["']$/g, '');
}

/**
 * Normalize document-only rows (`DocumentFontOption` with `logicalFamily`) into the custom-UI
 * picker shape. Raw document families may be CSS stacks, so canonicalize to the first family.
 */
function normalizeDocumentFontOptions(raw: unknown): FontFamilyOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FontFamilyOption[] = [];
  for (const option of raw) {
    if (!option || typeof option !== 'object') continue;
    const rec = option as LooseRecord;
    const logical = typeof rec.logicalFamily === 'string' ? canonicalFontFamilyName(rec.logicalFamily) : '';
    if (!logical) continue;
    const previewFamily =
      typeof rec.previewFamily === 'string' && rec.previewFamily.trim() ? rec.previewFamily.trim() : logical;
    out.push({ value: logical, label: logical, previewFamily });
  }
  return out;
}

/**
 * Normalize picker rows (`FontFamilyOption`) without treating their value as a CSS stack. The font
 * runtime has already converted quoted document stacks such as `"Acme, Inc Sans", serif` into the
 * exact apply value (`Acme, Inc Sans`), so preserving `value` avoids truncating internal commas.
 */
function normalizePickerFontOptions(raw: unknown): FontFamilyOption[] {
  if (!Array.isArray(raw)) return [];
  const out: FontFamilyOption[] = [];
  for (const option of raw) {
    if (!option || typeof option !== 'object') continue;
    const rec = option as LooseRecord;
    const value = typeof rec.value === 'string' ? rec.value.trim() : '';
    if (!value) continue;
    const label = typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : value;
    const previewFamily =
      typeof rec.previewFamily === 'string' && rec.previewFamily.trim() ? rec.previewFamily.trim() : value;
    out.push({ value, label, previewFamily });
  }
  return out;
}

/**
 * Compose document font options on top of the picker/default rows: document rows lead and win on
 * value collisions (case-insensitive), defaults backfill the rest. Order within each group is
 * preserved so document-used families stay at the front of the custom-UI picker (SD-3887).
 */
function composeFontFamilyOptions(
  documentOptions: readonly FontFamilyOption[],
  pickerOptions: readonly FontFamilyOption[] = [],
): FontFamilyOption[] {
  const out: FontFamilyOption[] = [];
  const seen = new Set<string>();
  const push = (option: FontFamilyOption): void => {
    const key = String(option.value).trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(option);
  };
  for (const option of documentOptions) push(option);
  const defaults = pickerOptions.length ? pickerOptions : DEFAULT_FONT_FAMILY_OPTIONS;
  for (const option of defaults) push(option);
  return out;
}

const DEFAULT_FONT_SIZE_OPTIONS: readonly FontSizeOption[] = [
  { value: '8', label: '8' },
  { value: '9', label: '9' },
  { value: '10', label: '10' },
  { value: '11', label: '11' },
  { value: '12', label: '12' },
  { value: '14', label: '14' },
  { value: '16', label: '16' },
  { value: '18', label: '18' },
  { value: '24', label: '24' },
  { value: '36', label: '36' },
];

/** Active state for a routed command: true when its mark is live at the selection. */
function commandIsActive(descriptor: CommandDescriptor, selection: SelectionSlice): boolean {
  return descriptor.activeMark ? selection.activeMarks.includes(descriptor.activeMark) : false;
}
