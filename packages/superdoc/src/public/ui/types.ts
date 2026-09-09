/**
 * v2-native `superdoc/ui` controller types.
 *
 * This is the public type surface for the browser-only UI controller
 * (`createSuperDocUI`) and its React bindings. It is deliberately
 * SELF-CONTAINED: it imports nothing from the v1 editor surface and nothing
 * from the private v2 runtime packages (the v2 host / editor-core / browser
 * shell). The controller is a thin, duck-typed layer over:
 *
 *   - `superdoc.activeEditor` (the public v2 active-editor facade),
 *   - `activeEditor.doc` (the public, read-only-guarded Document API facade),
 *   - SuperDoc lifecycle events (`editorCreate`, `document-mode-change`,
 *     `zoomChange`, `viewport-change`),
 *   - public SuperDoc instance methods (`export`, `setDocumentMode`, zoom).
 *
 * `activeEditor.doc` is the browser-facing Document API facade. Browser reads
 * and mutations may settle asynchronously there; SDK/headless document
 * automation remains synchronous on its own surface.
 *
 * The only `@superdoc/*` import is `@superdoc/document-api`, whose public
 * Document API shapes are surfaced to consumers directly so they don't have to
 * reach into that package themselves. The published-declaration pipeline
 * relocates `@superdoc/document-api` into superdoc's own dist tree
 * (`scripts/ensure-types.cjs` `rewriteDocApiPaths`), so no bare private
 * specifier leaks into the emitted `.d.ts`.
 */

// Public Document API shapes re-surfaced through `superdoc/ui`. These are the
// canonical document-api types; re-exporting them (rather than re-declaring
// them) keeps `superdoc/ui` structurally identical to `@superdoc/document-api`.
export type {
  Receipt,
  SelectionInfo,
  SelectionTarget,
  SelectionPoint,
  TextTarget,
  TextAddress,
  ScrollIntoViewInput,
  ScrollIntoViewOutput,
  DocumentApi,
  EntityAddress,
  CommentsListQuery as DocumentApiCommentsListQuery,
  CommentsListResult,
  TrackChangesListResult,
  ContentControlsListResult,
  ContentControlInfo,
  RichContentInsertInput,
  SDHtmlMarkdownSupportCheckResult,
} from '@superdoc/document-api';

// Public style-catalogue shapes (`styles.getCatalog`) re-surfaced through
// `superdoc/ui` so custom-UI consumers can type the `ui.styles` slice/handle
// without importing `@superdoc/document-api` directly. These are the canonical
// document-api catalogue types; re-exporting (rather than re-declaring) them
// keeps `superdoc/ui` structurally identical to `@superdoc/document-api`.
export type {
  StyleCatalogView,
  StyleCatalogItemType,
  StyleCatalogFilterType,
  StyleProvenance,
  StyleCatalogItemVisibility,
  StyleCatalogItemUsage,
  StyleCatalogItemPreview,
  StyleCatalogItem,
  StyleCatalogDefaults,
  StyleCatalogDiagnostic,
  StyleCatalogSourceStatus,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
} from '@superdoc/document-api';

// Canonical list-style preset id (`lists.apply` / `lists.applyPreset`), re-surfaced
// through `superdoc/ui` so the toolbar list-style route can map to it without
// importing `@superdoc/document-api` directly.
export type { ListPresetId } from '@superdoc/document-api';

// The browser shape of `activeEditor.doc`, which is what `CustomCommandContext.doc`
// hands a custom command. Surfaced here so custom-UI code can annotate it without
// reaching into the package's internals.
export type { BrowserDocumentApi, PartialBrowserDocumentApi } from '../browser-document-api.js';

import type {
  CommentsListQuery as DocumentApiCommentsListQuery,
  CommentsListResult,
  TrackChangesListResult,
  EntityAddress,
  TextAddress,
  TextTarget,
  ScrollIntoViewInput,
  ScrollIntoViewOutput,
  SelectionInfo,
  SelectionTarget,
  Receipt,
  ReceiptFailureCode,
  ContentControlInfo,
  StyleCatalogItem,
  StyleCatalogDiagnostic,
  StyleCatalogSourceStatus,
  StylesGetCatalogInput,
  StylesGetCatalogResult,
} from '@superdoc/document-api';

import type { PartialBrowserDocumentApi } from '../browser-document-api.js';
import type { ExportParams } from '../export-types.js';

import type { SuperDocUIReason } from './reasons.js';
import type { BuiltInCommandId } from './commands.js';

// Stable public reason taxonomy. Re-exported here so `superdoc/ui` consumers
// can import the reason type alongside the handle/slice types it annotates.
export type { SuperDocUIReason } from './reasons.js';
export type { BuiltInCommandId } from './commands.js';

// ---------------------------------------------------------------------------
// Reactive substrate
// ---------------------------------------------------------------------------

/** Equality predicate used to suppress redundant slice notifications. */
export type EqualityFn<T> = (a: T, b: T) => boolean;

/** Pure projection from controller state to a derived slice. */
export type SelectorFn<TState, TSlice> = (state: TState) => TSlice;

/**
 * Minimal observable contract returned by `ui.select(...)` and by each
 * domain handle's slice subscriptions. Reading is synchronous; `subscribe`
 * returns an unsubscribe function.
 */
export interface Subscribable<T> {
  /** Current value. */
  get(): T;
  /** Subscribe to value changes; returns an unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void;
}

/**
 * Snapshot-shaped subscription contract shared by every customer-facing domain
 * handle (`ui.selection`, `ui.comments`, `ui.trackChanges`, ...). Mirrors the
 * main SuperDoc surface so custom-UI code written against main runs unchanged:
 *
 * - `getSnapshot()` reads the current slice synchronously.
 * - `observe(listener)` fires once immediately with the current snapshot, then
 *   again on each change. The listener receives the snapshot value directly.
 * - `subscribe(listener)` is the event-shaped alias of `observe`: the listener
 *   receives `{ snapshot }` and likewise fires immediately then on change.
 *
 * The generic `ui.select(selector)` substrate keeps its raw-value
 * {@link Subscribable} shape; only the domain handles use this contract.
 */
export interface SnapshotSubscribable<T> {
  /** Read the current snapshot synchronously. */
  getSnapshot(): T;
  /**
   * Undocumented retained alias of {@link getSnapshot}, kept so existing v2
   * callers using `handle.get()` keep working; `getSnapshot()` is the canonical,
   * main-compatible name.
   */
  get(): T;
  /**
   * Subscribe to snapshot changes. The listener fires once immediately with the
   * current snapshot wrapped as `{ snapshot }`, then again on each change.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (event: { snapshot: T }) => void): () => void;
  /**
   * Value-shaped alias of {@link subscribe}: the listener receives the snapshot
   * directly, firing once immediately then on each change. Returns an
   * unsubscribe function.
   */
  observe(listener: (snapshot: T) => void): () => void;
}

// ---------------------------------------------------------------------------
// Addresses (document-anchored references the UI surfaces)
// ---------------------------------------------------------------------------

/** Address of a comment thread anchor. */
export type CommentAddress = { kind: 'comment'; commentId: string };

/** Address of a tracked change. */
export type TrackedChangeAddress = { kind: 'trackedChange'; changeId: string };

/** Address of a content control, as exposed to viewport lookups. */
export type ContentControlViewportAddress = {
  kind: 'contentControl';
  /** Stable content-control id. */
  id: string;
  /** Optional internal node id, when the control is also addressable by node. */
  internalId?: string;
};

/**
 * Anything the viewport layer can resolve to a painted rectangle: a raw
 * Document API entity address, or a content-control address.
 */
export type ViewportEntityAddress = EntityAddress | ContentControlViewportAddress;

// ---------------------------------------------------------------------------
// Derived item shapes (projected from the canonical doc-api list results)
// ---------------------------------------------------------------------------

/** A single comment, as returned by the Document API comments list. */
export type CommentInfo = CommentsListResult['items'][number];

/** A single tracked change, as returned by the Document API list. */
export type TrackChangeInfo = TrackChangesListResult['items'][number];

/**
 * UI-facing tracked-change list row.
 *
 * The flat fields mirror the Document API list item while `change` preserves
 * the v1 custom-UI row contract. New consumers can read the flat row; existing
 * custom UI code can continue to pass `row.change` to detail renderers.
 */
export type TrackChangesItem = TrackChangeInfo & { change: TrackChangeInfo };

/** A point hit-test result mapping a viewport point to a tracked-change row. */
export interface TrackChangePointHit {
  /** Public tracked-change id of the resolved occurrence. */
  id: string;
  /** The matching tracked-change item. */
  item: TrackChangesItem;
  /**
   * Painted story locator of the occurrence under the point, mirroring
   * {@link ViewportEntityHit.story}: present for a story-scoped occurrence
   * (footnote, endnote, header/footer, textbox), absent for body / story-less
   * hits. `id` alone already identifies this exact occurrence; `story` is
   * informational and can be passed through `setActive`/`accept`/`reject` for
   * convenience.
   */
  story?: unknown;
}

/** Filter/query options accepted by the Document API comments list surface. */
export type CommentsListQuery = DocumentApiCommentsListQuery;

// ---------------------------------------------------------------------------
// Font options
// ---------------------------------------------------------------------------

/** A selectable font family option for a font picker UI. */
export interface FontFamilyOption {
  /** Stable value forwarded to the formatting command. */
  value: string;
  /** Human-readable label. */
  label: string;
  /** Optional CSS font-family preview value. */
  previewFamily?: string;
}

/** A selectable font-size option for a font-size picker UI. */
export interface FontSizeOption {
  /** Stable value forwarded to the formatting command. */
  value: string;
  /** Human-readable label. */
  label: string;
}

// ---------------------------------------------------------------------------
// Command surface
// ---------------------------------------------------------------------------

/** Observable enable/active state for a toolbar-style command. */
export interface CommandState {
  /** The command can run against the current selection / mode. */
  enabled: boolean;
  /** Compatibility inverse of `enabled` for demo code that models commands as disabled. */
  disabled?: boolean;
  /** The command's formatting is currently applied at the selection. */
  active: boolean;
  /** The controller recognizes this command id and can route it. */
  supported: boolean;
  /** Optional command value, such as a selected font family. */
  value?: unknown;
  /** Whether this state comes from a built-in, custom, or unsupported command. */
  source?: 'builtin' | 'custom' | 'unsupported';
  /**
   * Stable public reason explaining why the command is disabled / unsupported.
   * Present only when the command cannot run (`enabled === false`); omitted when
   * the command is enabled. Lets consumers distinguish unsupported-by-v2,
   * deferred-by-product, not-ready, read-only, and missing-context cases instead
   * of treating every disabled command as opaque.
   *
   * Host/lower-level reason strings are normalized into this stable public
   * taxonomy before reaching consumers.
   */
  reason?: SuperDocUIReason;
}

/** A built-in command id, or an application id registered through `ui.commands.register()`. */
export type CommandId = BuiltInCommandId | (string & {});

/** Command id accepted by toolbar APIs. Equivalent to {@link CommandId}. */
export type ToolbarCommandId = CommandId;

/**
 * Failure code carried by a receipt that the UI controller mints itself
 * (rather than relaying from the Document API). Extends the Document API's
 * {@link ReceiptFailureCode} vocabulary with the controller-level failure
 * modes that have no Document API equivalent:
 *
 *   - `DOCUMENT_READONLY`  — a mutating workflow was invoked while the
 *     document is in viewing / read-only mode;
 *   - `NO_SELECTION`       — a selection-scoped workflow (e.g.
 *     `comments.createFromSelection`) ran with no range selection;
 *   - `PARTIAL_LINK_EDIT`  — a combined link edit updated the hyperlink
 *     target but failed to replace the display text (see
 *     {@link PartialLinkEditReceipt}).
 */
export type SuperDocUIReceiptFailureCode =
  | ReceiptFailureCode
  | 'DOCUMENT_READONLY'
  | 'NO_SELECTION'
  | 'PARTIAL_LINK_EDIT';

/**
 * Failure receipt minted by the UI controller itself. Shaped exactly like the
 * Document API's failure receipt so consumers can branch on
 * `receipt.failure.code` uniformly, but with the controller-level
 * {@link SuperDocUIReceiptFailureCode} vocabulary.
 *
 * `PARTIAL_LINK_EDIT` is excluded here because that failure always carries
 * the richer {@link PartialLinkEditReceipt} shape; keeping the codes disjoint
 * lets `receipt.failure.code === 'PARTIAL_LINK_EDIT'` narrow a
 * {@link SuperDocUIReceipt} to {@link PartialLinkEditReceipt}.
 */
export interface SuperDocUIFailureReceipt {
  success: false;
  failure: {
    code: Exclude<SuperDocUIReceiptFailureCode, 'PARTIAL_LINK_EDIT'>;
    message: string;
    details?: unknown;
  };
}

/**
 * Failure receipt for a combined link edit (`link` command with both a target
 * and display text) where the hyperlink target was updated but the display
 * text replacement failed. Carries per-part context so consumers can tell
 * which half applied and why the other failed.
 *
 * Deliberately does not extend {@link SuperDocUIFailureReceipt}: that shape
 * excludes the `PARTIAL_LINK_EDIT` code so the two receipt kinds stay
 * discriminable by `failure.code` within {@link SuperDocUIReceipt}.
 *
 * TypeScript does not narrow a parent union from a nested discriminant, so
 * `receipt.failure.code === 'PARTIAL_LINK_EDIT'` alone narrows only
 * `receipt.failure`. To reach `applied` / `hyperlinkResult` / `textResult`,
 * narrow the receipt itself:
 *
 * ```ts
 * if (!receipt.success && 'applied' in receipt) {
 *   receipt; // PartialLinkEditReceipt
 * }
 * ```
 */
export interface PartialLinkEditReceipt {
  success: false;
  failure: {
    code: 'PARTIAL_LINK_EDIT';
    message: string;
    details?: unknown;
  };
  /** Which halves of the combined edit were applied. */
  applied: { href: boolean; text: boolean };
  /** Result of the hyperlink-target half of the edit. */
  hyperlinkResult: CommandExecutionResult;
  /** Result of the display-text half of the edit. */
  textResult: CommandExecutionResult;
}

/**
 * A receipt surfaced by the UI controller: a Document API {@link Receipt}
 * relayed as-is, a controller-minted {@link SuperDocUIFailureReceipt} for
 * failures the controller detects before (or while) routing to the Document
 * API, or a {@link PartialLinkEditReceipt} for half-applied combined link
 * edits.
 */
export type SuperDocUIReceipt = Receipt | SuperDocUIFailureReceipt | PartialLinkEditReceipt;

/**
 * Result returned by command execution.
 *
 * `false` means the controller could not route the command. A receipt
 * preserves the public Document API facade result (or a controller-minted
 * failure), including read-only / unsupported failures and mutation effects.
 * `true` is returned for legacy command handlers that do not produce a
 * structured result, or when the host reports only that an async browser
 * operation was scheduled. Use `executeAsync(...)` to await the settled result
 * when the browser Document API / host runs asynchronously.
 */
export type CommandExecutionResult = boolean | SuperDocUIReceipt;

/**
 * Direct workflow helpers return the Document API receipt (or a
 * controller-minted failure receipt). Browser `activeEditor.doc` facades
 * settle those operations asynchronously by contract; SDK/headless
 * document-automation facades may still return the receipt synchronously.
 */
export type WorkflowReceipt = SuperDocUIReceipt | Promise<SuperDocUIReceipt>;

/**
 * Result of a best-effort workflow action that either performs real
 * public-surface behavior (`ok: true`) or fails closed (`ok: false`) carrying a
 * stable {@link SuperDocUIReason}. Returned by scroll/focus helpers that route
 * through host-owned navigation. Never throws and never silently no-ops.
 */
export interface WorkflowActionResult {
  /** The action reached and ran a public host/Document API surface. */
  ok: boolean;
  /**
   * Stable reason when `ok` is false. Omitted on success. Host/lower-level
   * reason strings are normalized into this stable public taxonomy before
   * reaching consumers.
   */
  reason?: SuperDocUIReason;
}

/**
 * Scroll helpers keep the v1/main `{ success }` shape while retaining v2's
 * fail-closed `{ ok, reason }` details for existing v2 consumers.
 */
export type WorkflowScrollResult = ScrollIntoViewOutput & WorkflowActionResult;

/**
 * `selection.restore` keeps the v1/main `{ success }` shape while retaining
 * v2's fail-closed `{ ok, reason }` details for existing v2 consumers.
 * `success` always mirrors `ok`.
 */
export type SelectionRestoreResult = { success: boolean } & WorkflowActionResult;

/**
 * Handle for a single command id. `execute` routes through the public
 * Document API / SuperDoc instance; `getState` reflects the live enable/active
 * snapshot; `observe` notifies on state change.
 */
export interface CommandHandle<Id extends CommandId = CommandId> {
  /** The command id this handle wraps. */
  readonly id: Id;
  /** Current enable/active state. */
  getState(): CommandState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  observe(listener: (state: CommandState) => void): () => void;
  /**
   * Run the command. Returns the Document API receipt when the host facade
   * provides one, or `false` for unsupported / disabled commands rather than
   * throwing. When the browser operation settles asynchronously this returns
   * the immediate routed result (`true` or a sync receipt); use
   * `executeAsync(...)` to await settlement.
   */
  execute(payload?: unknown): CommandExecutionResult;
  /**
   * Run the command and resolve once the routed operation has settled. On
   * browser-backed hosts this includes the post-mutation paint observation
   * boundary when available.
   */
  executeAsync(payload?: unknown): Promise<CommandExecutionResult>;
}

/** Registration descriptor for a consumer-defined command. */
export interface CustomCommandHandleState<TValue = unknown> extends CommandState {
  disabled: boolean;
  value: TValue | undefined;
  source: 'builtin' | 'custom' | 'unsupported';
}

export interface ContextMenuItem {
  id: string;
  label: string;
  group?: string;
  order?: number;
  /**
   * Invoke the contributed command. Returns the immediate routed result for the
   * synchronous menu-click path; the command's document work still settles
   * asynchronously and refreshes controller slices.
   */
  invoke(): CommandExecutionResult;
}

export interface ViewportEntityHit {
  type: 'trackedChange' | 'comment' | 'contentControl' | 'citation' | (string & {});
  id: string;
  tag?: string;
  scope?: 'block' | 'inline';
  /**
   * Painted story locator for a tracked-change hit. Meaningful only for
   * `type: 'trackedChange'`; absent for body-only content and for comment,
   * content-control, and citation hits. Lets point hit-testing disambiguate a tracked-change
   * id that repeats across stories (body, footnote, header/footer, textbox) by
   * resolving to the occurrence actually under the point.
   */
  story?: unknown;
}

export interface ViewportContext {
  /**
   * The viewport-relative coordinate the consumer asked about. Echoed back so
   * handlers that anchor floating UI to the click point don't have to remember
   * it separately. Optional/additive: the producer (`contextAt`) always sets it,
   * but it stays optional so consumer-constructed `ViewportContext` values built
   * against the older shape (without `point`) keep type-checking.
   */
  point?: { x: number; y: number };
  entities: readonly ViewportEntityHit[];
  selection: SelectionSlice;
  position: { target: SelectionTarget | null } | null;
  insideSelection: boolean;
}

/**
 * Shared, V2-truthful execution context handed to a custom command / custom
 * toolbar button callback.
 *
 * This is the single callback contract both the built-in toolbar shell and
 * custom UIs use. It deliberately does NOT expose `superdoc.activeEditor.commands`
 * (which is `null` on v2). Instead it routes everything through public surfaces:
 *
 *   - `execute` / `executeAsync` run any catalog command id through the shared
 *     controller (the same command-state truth the toolbar uses);
 *   - `ui` is the live controller, so a callback can read slices or drive any
 *     handle (`ui.comments`, `ui.trackChanges`, `ui.zoom`, `ui.search`, ...);
 *   - `doc` is the public Document API facade (read-only-guarded,
 *     async-capable in browser), the sanctioned mutation surface, or `null`
 *     when unavailable;
 *   - `insertText` is a narrow insertion helper routed through the Document API;
 *   - `selection` and `documentMode` are read-only document context;
 *   - `superdoc` and `editor` remain available for public instance methods.
 *
 * Callback failures are caught by the controller / built-in toolbar authority
 * and surfaced through the toolbar exception channel rather than throwing.
 */
export interface CustomCommandContext<TPayload = unknown> {
  payload?: TPayload;
  state: SuperDocUIState;
  editor: SuperDocEditorLike | null;
  superdoc: SuperDocLike;
  context?: ViewportContext;
  /**
   * The live UI controller (shared command-state truth).
   *
   * Borrowed: a custom command runs against whichever controller invoked it,
   * which for `superdoc.ui.commands.register(...)` is the instance-owned
   * singleton the built-in toolbar also reads. Typing this as the owned form
   * would let a command callback destroy it, which is the hole the borrowed
   * handle exists to close.
   *
   * Borrowed unconditionally, including for a controller you built with
   * `createSuperDocUI()`. That costs an owner nothing: you necessarily hold the
   * owned reference already, since you called `.commands.register(...)` on it,
   * so tear it down through that instead of through the context. Varying this
   * by ownership would mean `SuperDocUI` and {@link BorrowedSuperDocUI} needing
   * different `commands` handles, and the borrowed form is derived from the
   * owned one precisely so the two cannot drift.
   */
  ui: BorrowedSuperDocUI;
  /** Run a catalog command id through the shared controller. */
  execute(id: CommandId, payload?: unknown): CommandExecutionResult;
  /** Run a catalog command id and await its settled result. */
  executeAsync(id: CommandId, payload?: unknown): Promise<CommandExecutionResult>;
  /**
   * The host's browser Document API facade (read-only-guarded, async-capable),
   * or `null` when unavailable.
   *
   * Partial for the same reason {@link SuperDocEditorLike.doc} is: this is the
   * host's own object handed straight through, and a duck-typed host is only
   * required to carry the operations it implements. Typing it as the complete
   * facade would promise operations a custom adapter or stub never defines.
   *
   * Prefer {@link CustomCommandContext.execute}, `executeAsync`, and
   * `insertText` where they cover the work: those route through the controller
   * and fail closed with a reason or a receipt when an operation is missing.
   * Reach for `doc` when you need an operation the controller does not route,
   * and guard the call.
   */
  doc: PartialBrowserDocumentApi | null;
  /** Read-only selection snapshot at invocation time. */
  selection: SelectionSlice;
  /** Current document mode. */
  documentMode: 'editing' | 'suggesting' | 'viewing' | null;
  /**
   * Insert plain text through the public Document API (a narrow built-in/custom
   * insertion helper). Fails closed with a failure receipt when the Document API
   * is unavailable or the document is read-only.
   */
  insertText(text: string): WorkflowReceipt;
}

export interface CustomCommandRegistration<TPayload = unknown, TValue = unknown> {
  /** Unique command id. */
  id: CommandId;
  /** Implementation invoked when the command runs. */
  execute(context: CustomCommandContext<TPayload>): unknown;
  /** Optional live-state provider. */
  getState?(context: CustomCommandContext<TPayload>): Partial<CustomCommandHandleState<TValue>>;
  /** Optional keyboard shortcut metadata for consumer UIs. */
  shortcut?: string;
  /** Optional context-menu contribution metadata. */
  contextMenu?: {
    label: string;
    group?: string;
    order?: number;
    when?(context: ViewportContext): boolean;
  };
}

export interface CustomCommandHandle<TPayload = unknown, TValue = unknown> extends Omit<
  CommandHandle<CommandId>,
  'execute' | 'executeAsync' | 'getState' | 'observe'
> {
  /** Current custom-command state. */
  getState(): CustomCommandHandleState<TValue>;
  /** Subscribe to custom-command state changes; returns an unsubscribe function. */
  observe(listener: (state: CustomCommandHandleState<TValue>) => void): () => void;
  /** Run the custom command with its payload shape. */
  execute(payload?: TPayload): CommandExecutionResult;
  /** Await the custom command's settled result. */
  executeAsync(payload?: TPayload): Promise<CommandExecutionResult>;
}

export type CustomCommandRegistrationResult<TPayload = unknown, TValue = unknown> = (() => void) & {
  handle: CustomCommandHandle<TPayload, TValue>;
  unregister(): void;
};

/** Aggregate command surface. */
export interface CommandsHandle {
  /** All known command ids (built-in plus registered). */
  readonly ids: readonly CommandId[];
  /** Whether a command id is known to the controller. */
  has(id: CommandId): boolean;
  /** Resolve a handle for a command id. */
  get<Id extends CommandId = CommandId>(id: Id): CommandHandle<Id>;
  /** Execute a command by id. */
  execute(id: CommandId, payload?: unknown): CommandExecutionResult;
  /** Execute a command by id and resolve once the routed work has settled. */
  executeAsync(id: CommandId, payload?: unknown): Promise<CommandExecutionResult>;
  /** Register a consumer-defined command; returns an unregister function. */
  register<TPayload = unknown, TValue = unknown>(
    registration: CustomCommandRegistration<TPayload, TValue>,
  ): CustomCommandRegistrationResult<TPayload, TValue>;
  /** Resolve context-menu contributions for a viewport context. */
  getContextMenuItems(context: ViewportContext): readonly ContextMenuItem[];
}

// ---------------------------------------------------------------------------
// Slices (immutable snapshots derived from controller state)
// ---------------------------------------------------------------------------

/**
 * Readiness of an async-backed slice. The browser Document API settles reads
 * asynchronously, so the reactive store distinguishes three cases that an
 * `empty` list alone cannot:
 *
 *   - `ready`  — the underlying read has settled; the slice reflects live truth
 *     (an empty list here means genuinely empty);
 *   - `pending` — no value has settled yet for the current editor/selection, so
 *     the slice is showing its initial empty default while a read is in flight;
 *   - `stale`  — a previously settled value is being shown while a refresh runs
 *     (selection moved or the document mutated); the data is best-known, not
 *     current.
 *
 * The same vocabulary is used across every async-backed slice for consistency.
 */
export type SliceStatus = 'ready' | 'pending' | 'stale';

/** Selection state slice. */
export interface SelectionSlice {
  /**
   * Readiness of the underlying async selection read. `ready` once the browser
   * selection read has settled; `pending` before the first settle; `stale`
   * while a re-read is in flight after a selection/document change.
   */
  status: SliceStatus;
  /** No selection / collapsed-empty. */
  empty: boolean;
  /** Resolved text target for the selection, when available. */
  target: TextTarget | null;
  /** Explicit start/end selection target, when available. */
  selectionTarget: SelectionTarget | null;
  /** Marks currently active at the selection. */
  activeMarks: readonly string[];
  /** Comment ids overlapping the selection. */
  activeCommentIds: readonly string[];
  /** Tracked-change ids overlapping the selection. */
  activeChangeIds: readonly string[];
  /** Plain-text of the current selection. */
  quotedText: string;
}

/** Toolbar snapshot slice. */
export interface ToolbarSnapshotSlice {
  /** Document mode context the toolbar should reflect. */
  context: 'editing' | 'suggesting' | 'viewing' | null;
  /** Per-command enable/active state keyed by command id. */
  commands: Readonly<Record<string, CommandState>>;
  /** True when the format-painter is armed (single or persistent mode). */
  copyFormatActive: boolean;
}

/** Format-painter controller surface exposed on {@link SuperDocUI}. */
export interface FormatPainterHandle {
  /** Notify the controller that a pointer-drag selection has started. */
  setPointerSelecting(flag: boolean): void;
  /** Notify the controller that the pointer was released; triggers apply if a non-source selection exists. */
  notifyPointerUp(): void;
  /** Notify the controller that a keyboard selection key is held. */
  setKeyboardSelecting(flag: boolean): void;
  /** Notify the controller that the keyboard selection key was released; triggers apply. */
  notifyKeyUp(): void;
  /** Cancel an active painter (Esc or programmatic cancel). */
  cancel(): void;
  /** Subscribe to painter mode changes. Returns a detach function. */
  onModeChange(cb: (mode: 'idle' | 'armed' | 'persistent') => void): () => void;
}

/** Comments slice. */
export interface CommentsSlice {
  /**
   * Readiness of the underlying async comments read, combined with the live
   * selection read ({@link SliceStatus}). Checks that only need the comment
   * list itself (e.g. `setActive`'s membership check) should gate on
   * {@link listStatus} instead, since an unrelated selection re-read can hold
   * this combined status at `pending`/`stale` even though the list is ready.
   */
  status: SliceStatus;
  /** Readiness of the comment list read alone, independent of selection. */
  listStatus: SliceStatus;
  /** All comments currently loaded. */
  items: readonly CommentInfo[];
  /** Total comment count. */
  total: number;
  /** Comment ids active at the current selection. */
  activeIds: readonly string[];
  /**
   * The single comment a consumer UI should treat as focused: an explicit
   * `setActive(id)` when set, otherwise the first comment overlapping the live
   * selection. `null` when neither is present.
   */
  activeId: string | null;
}

/** Track-changes slice. */
export interface TrackChangesSlice {
  /** Readiness of the underlying async tracked-change read ({@link SliceStatus}). */
  status: SliceStatus;
  /** All tracked changes currently loaded. */
  items: readonly TrackChangesItem[];
  /** Total tracked-change count. */
  total: number;
  /** Tracked-change id active at the current selection, if any. */
  activeId: string | null;
  /** Distinct authors across the loaded changes. */
  authors: readonly string[];
}

/** Content-controls slice. */
export interface ContentControlsSlice {
  /** Readiness of the underlying async content-control read ({@link SliceStatus}). */
  status: SliceStatus;
  /** All content controls currently loaded. */
  items: readonly ContentControlInfo[];
  /** Total content-control count. */
  total: number;
  /** First content-control id active at the current selection, if any. */
  activeId: string | null;
  /** Content-control ids active at the current selection. */
  activeIds: readonly string[];
}

/** Font picker slice. */
export interface FontsSlice {
  /** Font family options. */
  options: readonly FontFamilyOption[];
  /** Font size options. */
  sizeOptions: readonly FontSizeOption[];
}

/** Zoom slice. */
export interface ZoomSlice {
  /** Current zoom mode. */
  mode: 'manual' | 'fit-width' | null;
  /** Current zoom value as a percentage (100 = 100%). */
  value: number;
  /** Minimum allowed zoom percentage. */
  min: number;
  /** Maximum allowed zoom percentage. */
  max: number;
}

/** Document-level state slice. */
export interface DocumentSlice {
  /** The active editor is ready. */
  ready: boolean;
  /** Current document mode. */
  mode: 'editing' | 'suggesting' | 'viewing' | null;
  /** The current document has local changes. */
  dirty: boolean;
}

// ---------------------------------------------------------------------------
// Styles (read-only style catalogue + active paragraph style)
// ---------------------------------------------------------------------------

/**
 * Style-catalogue state slice.
 *
 * A truthful, fail-closed projection of the public Document API style
 * catalogue (`doc.styles.getCatalog`) plus the active paragraph style derived
 * from the current selection's block reads. When the catalogue surface is
 * unreachable (viewing mode, worker-backed editor, pre-ready editor) the slice
 * degrades to empty lists / null fields and carries diagnostics rather than
 * guessing.
 */
export interface StylesSlice {
  /** The active editor is ready and the styles surface was queried. */
  ready: boolean;
  /**
   * Readiness of the underlying async catalogue / active-style reads
   * ({@link SliceStatus}). `pending` before the first settle, `stale` while a
   * refresh is in flight, `ready` once settled. Distinct from {@link ready},
   * which only reports whether an editor is mounted.
   */
  status: SliceStatus;
  /** Opaque catalogue revision token, or null when unavailable. */
  catalogRevision: string | null;
  /** Word-style quick gallery items (ordered), or empty when unavailable. */
  quickGallery: readonly StyleCatalogItem[];
  /**
   * Stable style id active across the selected paragraph(s): the uniform
   * explicit style, or the document default paragraph style when no explicit
   * style is set. `null` for a mixed selection or when block reads fail closed.
   */
  activeParagraphStyleId: string | null;
  /** Display name for {@link activeParagraphStyleId}, when resolvable from the catalogue. */
  activeParagraphStyleName: string | null;
  /** The selection spans paragraphs with more than one distinct style. */
  mixedSelection: boolean;
  /** Per-source status from the catalogue, or null when the catalogue is unavailable. */
  sourceStatus: StyleCatalogSourceStatus | null;
  /** Catalogue and active-style diagnostics (fallbacks, missing parts, fail-closed reads). */
  diagnostics: readonly StyleCatalogDiagnostic[];
}

/**
 * The active paragraph style resolved from the current selection. `styleId` is
 * the uniform style across the selected paragraphs (or the document default
 * when none is set); `mixed` is true when the selection spans multiple styles;
 * both `styleId` and `styleName` are null when reads fail closed, in which case
 * `diagnostics` explains why.
 */
export interface ActiveParagraphStyle {
  /** Uniform / default style id, or null for mixed / unavailable. */
  styleId: string | null;
  /** Display name for {@link styleId}, when resolvable. */
  styleName: string | null;
  /** The selection spans more than one distinct paragraph style. */
  mixed: boolean;
  /** Diagnostics explaining a fail-closed or partial active-style read. */
  diagnostics: readonly StyleCatalogDiagnostic[];
}

/**
 * Styles surface shared by the built-in toolbar (WS5) and custom UIs. Reads the
 * public Document API style catalogue and the active paragraph style; it never
 * imports private v2 runtime/style-model packages.
 */
export interface StylesHandle extends SnapshotSubscribable<StylesSlice> {
  /** Read the current styles snapshot. */
  getSnapshot(): StylesSlice;
  /**
   * Read the style catalogue through the public Document API, with optional
   * view / type / visibility filters. Returns `null` (fail-closed) when the
   * catalogue surface is unreachable or no best-known value has settled yet.
   */
  getCatalog(options?: StylesGetCatalogInput): StylesGetCatalogResult | null;
  /** Read the current Word-style quick gallery (ordered), or empty when unavailable. */
  getQuickGallery(): readonly StyleCatalogItem[];
  /** Resolve the active paragraph style for the current selection. */
  getActiveParagraphStyle(): ActiveParagraphStyle;
}

// ---------------------------------------------------------------------------
// Viewport geometry
// ---------------------------------------------------------------------------

/**
 * A painted document rectangle. Coordinates use browser client space by
 * default, or the element-relative space requested through `relativeTo`.
 */
export interface ViewportRect {
  /** Zero-based page index the rect belongs to. */
  pageIndex: number;
  /** Left edge in pixels. */
  left: number;
  /** Right edge in pixels. */
  right: number;
  /** Top edge in pixels. */
  top: number;
  /** Bottom edge in pixels. */
  bottom: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/**
 * Address the viewport layer can resolve to painted geometry: a v2 text /
 * selection target (resolved through the v2 host geometry surface), or an
 * entity / content-control address (legacy entity-rect path).
 */
export type ViewportGetRectTarget = SelectionTarget | TextAddress | TextTarget | ViewportEntityAddress;

/** Input to `ui.viewport.getRect`. */
export interface ViewportGetRectInput {
  /** Target to resolve to painted geometry. */
  target: ViewportGetRectTarget;
  /** Return coordinates relative to this element instead of browser client space. */
  relativeTo?: HTMLElement;
}

/** Result of `ui.viewport.getRect`. */
export interface ViewportRectResult {
  /** Whether the target resolved to any painted geometry. */
  found: boolean;
  /** Compatibility alias for `found`. */
  success?: boolean;
  /** Resolved rectangles (one per painted line/fragment). */
  rects: readonly ViewportRect[];
  /** First resolved rectangle, when present. */
  rect?: ViewportRect;
  /**
   * Stable fail-closed reason when `found` is false (e.g. `not-mounted`,
   * `unresolved`, `invalid-target`, `not-ready`, `unavailable`). Omitted on
   * success.
   */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Domain handles
// ---------------------------------------------------------------------------

/** Selection handle. */
export interface SelectionHandle extends SnapshotSubscribable<SelectionSlice> {
  /** Read the current selection snapshot. */
  getSnapshot(): SelectionSlice;
  /**
   * Read the best-known Document API selection, when the editor exposes it.
   * Returns `null` before the first async browser read settles.
   */
  current(): SelectionInfo | null;
  /** Preserve the current non-empty selection for work that moves focus into application UI. */
  capture(): SelectionCapture | null;
  /**
   * Restore a previously captured selection, best-effort. Never throws;
   * failures are reported through the result instead: `not-ready` (no editor
   * mounted), `target-unresolved` (the capture carries no usable target),
   * `host-capability-unavailable` (the host does not expose the selection
   * apply helper), or the host apply helper's own failure reason.
   */
  restore(capture: SelectionCapture): SelectionRestoreResult;
  /**
   * Apply a public selection target through the host-owned selection helper.
   * Fails closed with a stable reason when the host cannot honor the target.
   */
  apply(target: SelectionTarget): WorkflowActionResult;
  /** Resolve a painted anchor rect for the current selection, when available. */
  getAnchorRect(input?: { placement?: 'start' | 'end' | 'center' }): ViewportRect | null;
  /**
   * Resolve every painted rectangle covering the current selection (one per
   * line/fragment) through the host geometry surface. Returns an empty array
   * when geometry is host-unavailable or the selection has no painted target —
   * it never fabricates rectangles.
   */
  getRects(input?: { relativeTo?: HTMLElement }): readonly ViewportRect[];
}

/** A non-empty selection snapshot preserved independently of browser focus. */
export interface SelectionCapture extends SelectionSlice {
  /** Unix time in milliseconds when the selection was captured. */
  capturedAt: number;
}

/**
 * Minimal anchor `ui.comments.createFromCapture` needs. A full
 * {@link SelectionCapture} works, but callers can also pass the v1/main shape
 * carrying only a captured target.
 */
export type CommentAnchorCapture =
  | { target: TextTarget | SelectionTarget | null; selectionTarget?: SelectionTarget | null }
  | { target?: TextTarget | SelectionTarget | null; selectionTarget: SelectionTarget | null };

/** Comments handle. */
export interface CommentsHandle extends SnapshotSubscribable<CommentsSlice> {
  /** Read the passive page-window snapshot without starting a document-wide read. Observers receive the complete directory separately. */
  getSnapshot(): CommentsSlice;
  /** List comments through the best-known controller/Document API state. */
  list(query?: CommentsListQuery): readonly CommentInfo[];
  /** Resolve a single comment by id from the best-known loaded state. */
  getById(commentId: string): CommentInfo | null;
  /**
   * Create a comment from a frozen selection capture.
   *
   * A capture carrying neither `target` nor `selectionTarget` fails closed with
   * the same `NO_SELECTION` receipt {@link createFromSelection} mints for an
   * empty selection, because both describe the same user-visible mistake:
   * commenting with nothing selected. A capture that *has* a target which no
   * longer resolves is a different failure, and keeps the Document API's own
   * receipt so the reason stays specific.
   *
   * `capturedAt` is provenance for the consumer, not an expiry. A capture stays
   * usable while its target resolves; elapsed time alone never invalidates it.
   */
  createFromCapture(capture: CommentAnchorCapture, input: { text: string }): WorkflowReceipt;
  /**
   * Create a comment anchored to the live selection. Fails closed with a
   * failure receipt when there is no range selection or the Document API
   * comments surface is unavailable.
   */
  createFromSelection(input: { text: string }): WorkflowReceipt;
  /** Reply to a comment thread, when supported by the Document API. */
  reply(commentId: string, input: { text: string }): WorkflowReceipt;
  /**
   * Replace a comment's body text through the Document API
   * (`comments.patch({ commentId, text })`).
   *
   * Gated by the comments `readOnly` policy like every other comment write.
   * `allowResolve` is deliberately NOT consulted: that policy forbids only the
   * resolve/reopen transition, and an application that may not resolve threads
   * can still let an author correct their own wording.
   */
  edit(commentId: string, input: { text: string }): WorkflowReceipt;
  /** Mark a comment resolved. */
  resolve(commentId: string): WorkflowReceipt;
  /** Reopen a resolved comment. */
  reopen(commentId: string): WorkflowReceipt;
  /**
   * Delete a comment (and its replies) through the Document API. Fails closed
   * with a failure receipt when deletion is unavailable / blocked.
   */
  delete(commentId: string): WorkflowReceipt;
  /**
   * Mark a comment focused in consumer UI; reflected by `activeId`. Accepts a
   * bare id, an `importedId` alias, or a reply's id - all resolve to the
   * thread-root comment, which becomes `activeId`. Returns `true` when the
   * activation request was accepted (including an idempotent re-activation
   * of the already-active id), or `false` when no editor is mounted / not
   * ready or the id matches no current comment under any alias. `null`
   * clears and is always accepted.
   */
  setActive(commentId: string | null): boolean;
  /**
   * Scroll the comment anchor into view through the host navigation surface.
   * Resolves with both v1/main `{ success }` and v2 `{ ok, reason? }` fields
   * so copied custom-UI code can use either shape. Never silently no-ops.
   */
  scrollTo(commentId: string): Promise<WorkflowScrollResult>;
}

/** Track-changes handle. */
export interface TrackChangesHandle extends SnapshotSubscribable<TrackChangesSlice> {
  /** Read the passive page-window snapshot without starting a document-wide read. Observers receive the complete directory separately. */
  getSnapshot(): TrackChangesSlice;
  /** List tracked changes through the best-known controller state. */
  list(): readonly TrackChangesItem[];
  /**
   * Accept a change. The id is sufficient on its own (a tracked-change id
   * already identifies one occurrence, anywhere in the document). A
   * `{ id, story }` record (e.g. a {@link getAt}/{@link setActive} hit) is
   * also accepted for convenience, so a hit can be passed straight through.
   * Returns the immediate routed result. Use {@link acceptAsync} when later UI
   * depends on the settled document operation.
   */
  accept(changeId: string | { id: string; story?: unknown }): CommandExecutionResult;
  /** Accept a change and resolve after the document operation settles. */
  acceptAsync(changeId: string | { id: string; story?: unknown }): Promise<CommandExecutionResult>;
  /**
   * Reject a change. The id is sufficient on its own (a tracked-change id
   * already identifies one occurrence, anywhere in the document). A
   * `{ id, story }` record (e.g. a {@link getAt}/{@link setActive} hit) is
   * also accepted for convenience, so a hit can be passed straight through.
   * Returns the immediate routed result. Use {@link rejectAsync} when later UI
   * depends on the settled document operation.
   */
  reject(changeId: string | { id: string; story?: unknown }): CommandExecutionResult;
  /** Reject a change and resolve after the document operation settles. */
  rejectAsync(changeId: string | { id: string; story?: unknown }): Promise<CommandExecutionResult>;
  /**
   * Accept every active tracked change. Returns the Document API receipt, or
   * `false` when bulk decisions are unavailable / disabled on the host.
   */
  acceptAll(): CommandExecutionResult;
  /** Accept every active tracked change and resolve after the operation settles. */
  acceptAllAsync(): Promise<CommandExecutionResult>;
  /**
   * Reject every active tracked change. Returns the Document API receipt, or
   * `false` when bulk decisions are unavailable / disabled on the host.
   */
  rejectAll(): CommandExecutionResult;
  /** Reject every active tracked change and resolve after the operation settles. */
  rejectAllAsync(): Promise<CommandExecutionResult>;
  /**
   * Move focus to the next tracked change in document order (relative to the
   * active change). Returns the id that became active, or `null` when there are
   * no tracked changes.
   */
  next(): string | null;
  /**
   * Move focus to the previous tracked change in document order. Returns the id
   * that became active, or `null` when there are no tracked changes.
   */
  previous(): string | null;
  /**
   * Atomically move `activeId` to the next tracked change (as {@link next})
   * and await viewport navigation to it, scrolling instantly. Resolves
   * `{ success: false }` when there are no tracked changes; if the target
   * can't be resolved or the scroll can't be routed, the `activeId` move
   * rolls back before resolving `{ success: false }`. If the target resolves
   * but cannot be made visible, `activeId` stays on the requested change.
   */
  navigateNext(): Promise<ScrollIntoViewOutput>;
  /**
   * Atomically move `activeId` to the previous tracked change (as
   * {@link previous}) and await viewport navigation to it, scrolling
   * instantly. Resolves `{ success: false }` when there are no tracked
   * changes; if the target can't be resolved or the scroll can't be routed,
   * the `activeId` move rolls back before resolving `{ success: false }`. If
   * the target resolves but cannot be made visible, `activeId` stays on the
   * requested change.
   */
  navigatePrevious(): Promise<ScrollIntoViewOutput>;
  /**
   * Resolve the tracked change under viewport coordinates into the matching
   * public track-changes item. Coordinates are `MouseEvent` clientX/clientY
   * space. Resolves a tracked change wherever it is painted — body, footnotes,
   * or headers/footers — returning the occurrence under the point. Returns
   * `null` for invalid input, no editor, a point outside this controller's
   * host, no tracked change, or a change that no longer exists.
   */
  getAt(input: { x: number; y: number }): TrackChangePointHit | null;
  /**
   * Mark a tracked change focused in consumer UI; reflected by `activeId`.
   * The id is sufficient on its own; a `{ id, story }` record (e.g. a
   * {@link getAt} hit) is also accepted for convenience, so a hit can be
   * passed straight through. `null` clears; `activeId` stays the simple id.
   * Returns `true` when the activation request was accepted (including an
   * idempotent re-activation of the already-active id), or `false` when no
   * editor is mounted / not ready or a non-null id matches no current item.
   */
  setActive(input: string | { id: string; story?: unknown } | null): boolean;
  /**
   * Scroll the tracked-change anchor into view through the host navigation
   * surface. Resolves with both v1/main `{ success }` and v2 `{ ok, reason? }`
   * fields. A bare id resolves its story from the loaded rows; a
   * `{ id, story }` record pins the occurrence when the same id repeats across
   * the body and a footnote, header, or footer.
   */
  scrollTo(input: string | { id: string; story?: unknown }): Promise<WorkflowScrollResult>;
}

/** Content-controls handle. */
export interface ContentControlsHandle extends SnapshotSubscribable<ContentControlsSlice> {
  /**
   * Observe the document-wide content-control catalog and active field IDs.
   * The catalog remains requested until the returned disposer runs.
   */
  observe(listener: (snapshot: ContentControlsSlice) => void): () => void;
  /**
   * Observe the passive content-controls slice without requesting the
   * document-wide catalog. Meant for consumers that only need the active
   * field path, such as the core active-change event bridge; a field panel
   * should use {@link observe}.
   */
  observeActivePath(listener: (snapshot: ContentControlsSlice) => void): () => void;
  /** Event-shaped alias of {@link observe}. */
  subscribe(listener: (event: { snapshot: ContentControlsSlice }) => void): () => void;
  /** Read the current content-controls snapshot. */
  getSnapshot(): ContentControlsSlice;
  /** Read the current content-controls snapshot. */
  get(): ContentControlsSlice;
  /** Resolve a single content control by id from the loaded list. */
  get(input: { id: string }): ContentControlInfo | null;
  /** List content controls through the best-known controller state. */
  list(): readonly ContentControlInfo[];
  /**
   * Previous positional form for resolving one content control by id.
   * @deprecated replaceWith=`get({ id })` compat-indefinitely=v2 UI compatibility
   */
  getById(id: string): ContentControlInfo | null;
  /**
   * Temporarily highlight this control's text without moving focus, selection,
   * or scroll. A successful request replaces the current highlight. The default
   * yellow background inherits `--sd-content-controls-highlight-bg` from CSS.
   * Offscreen text paints when mounted; empty controls fail with `not-reachable`.
   */
  highlight(input: { id: string }): Promise<ContentControlHighlightResult>;
  /** Clear the transient highlight and cancel pending requests. */
  clearHighlight(): void;
  /**
   * Resolve the control's painted geometry through its public `selectionTarget`
   * when the runtime exposes one. Unknown controls fail closed with
   * `unresolved`; loaded controls without a resolvable selection target fail
   * closed with geometry reason `unavailable`.
   */
  getRect(input: { id: string }): ViewportRectResult;
  /**
   * Scroll the control into view through its public `selectionTarget` when the
   * runtime exposes one. `block` defaults to `'center'`, `behavior` to
   * `'smooth'`. Unknown controls resolve `{ success: false }`; loaded controls
   * without a resolvable selection target or host scroll capability resolve
   * `{ success: false }` the same way.
   */
  scrollIntoView(input: {
    id: string;
    block?: ScrollIntoViewInput['block'];
    behavior?: ScrollIntoViewInput['behavior'];
  }): Promise<ScrollIntoViewOutput>;
  /**
   * Focus the control identified by `id`: place the caret inside it (best
   * effort, via the same selection-application surface as `ui.selection.apply`)
   * and scroll it into view - the "take me there and let me edit" counterpart
   * to {@link scrollIntoView} (which is scroll-only). `block` defaults to
   * `'center'`, `behavior` to `'smooth'`.
   *
   * Resolves to `{ success: false, reason }` only for real navigation
   * problems - `'invalid-id'` (empty id), `'not-ready'` (no editor mounted),
   * `'not-found'` (no such control in the loaded list), or `'not-reachable'`
   * (found, but its page couldn't be scrolled into view). Lock mode and
   * viewing mode never make it fail - placing the caret is selection, not
   * mutation.
   */
  focus(input: {
    id: string;
    block?: ScrollIntoViewInput['block'];
    behavior?: ScrollIntoViewInput['behavior'];
  }): Promise<ContentControlFocusResult>;
}

/**
 * Result of {@link ContentControlsHandle.focus}. Fails only for real
 * navigation problems, never for lock mode or viewing mode (focus is
 * selection, not mutation).
 */
export type ContentControlFocusResult =
  | { success: true }
  | { success: false; reason: 'invalid-id' | 'not-ready' | 'not-found' | 'not-reachable' };

export type ContentControlHighlightResult =
  | { success: true }
  | { success: false; reason: 'invalid-id' | 'not-ready' | 'not-found' | 'not-reachable' | 'cancelled' };

/** Font picker handle. */
export interface FontsHandle extends SnapshotSubscribable<FontsSlice> {
  /** Available font family options. */
  getFamilyOptions(): readonly FontFamilyOption[];
  /** Available font size options. */
  getSizeOptions(): readonly FontSizeOption[];
}

/** Toolbar handle. */
export interface ToolbarHandle extends SnapshotSubscribable<ToolbarSnapshotSlice> {
  /** Read the current toolbar snapshot. */
  getSnapshot(): ToolbarSnapshotSlice;
  /** Execute a toolbar command by id. */
  execute(id: ToolbarCommandId, payload?: unknown): CommandExecutionResult;
  /** Execute a toolbar command by id and await its settled result. */
  executeAsync(id: ToolbarCommandId, payload?: unknown): Promise<CommandExecutionResult>;
}

/** Zoom handle. */
export interface ZoomHandle extends SnapshotSubscribable<ZoomSlice> {
  /** Set an absolute zoom percentage (100 = 100%). */
  set(value: number): void;
  /** Set a zoom mode. */
  setMode(mode: 'manual' | 'fit-width'): void;
}

/** Document handle. */
export interface DocumentHandle extends SnapshotSubscribable<DocumentSlice> {
  /** Read the current document snapshot. */
  getSnapshot(): DocumentSlice;
  /** Set the document mode (editing / suggesting / viewing). */
  setMode(mode: 'editing' | 'suggesting' | 'viewing'): void;
  /** Export the document and return the produced Blob, optionally downloading it. */
  export(input?: ExportParams): Promise<Blob> | undefined;
  /** Read text through the Document API; `null` when unavailable. */
  getText(): string | null;
  /** Replace the active document file, when supported by the host. */
  replaceFile(file: File | Blob | ArrayBuffer | Uint8Array): Promise<unknown> | undefined;
}

/** Viewport handle. */
export interface ViewportHandle {
  /** Resolve current painted geometry for a selection, text target, or supported entity address. */
  getRect(input: ViewportGetRectInput): ViewportRectResult;
  /**
   * Subscribe to geometry invalidation after selection, zoom, scroll, resize,
   * layout, or repaint changes. The callback is coalesced to one per frame.
   */
  observe(listener: () => void): () => void;
  /** Painted editor host element, when available. */
  getHost(): HTMLElement | null;
  /**
   * Legacy positional form. Fails closed (returns `null`) because the entity
   * addresses it would produce are not resolvable by `getRect`; prefer the
   * object form below.
   */
  entityAt(x: number, y: number): ViewportEntityAddress | null;
  /**
   * Resolve the public entities painted under a viewport point, innermost
   * first. Coordinates are `MouseEvent` clientX/clientY space. This object form
   * is the supported point-lookup: switch on the returned `ViewportEntityHit[]`
   * (and use `trackChanges.getAt` when you need the full tracked-change row).
   */
  entityAt(input: { x: number; y: number }): readonly ViewportEntityHit[];
  /** Resolve context at a viewport point for context menus. */
  contextAt(input: { x: number; y: number }): ViewportContext;
  /** Scroll the viewport so a document target is visible */
  scrollIntoView(input: ScrollIntoViewInput): Promise<ScrollIntoViewOutput>;
}

export interface MetadataHandle {
  getRect(input: { id: string }): ViewportRectResult & { success: boolean; rect?: ViewportRect };
  /**
   * Scroll the viewport to the anchored span identified by metadata `id`.
   * `block` defaults to `'center'`, `behavior` to `'smooth'`. Resolves
   * `{ success: false }` for an unknown id or when the host can't route the
   * scroll, rather than silently no-oping.
   */
  scrollIntoView(input: {
    id: string;
    block?: ScrollIntoViewInput['block'];
    behavior?: ScrollIntoViewInput['behavior'];
  }): Promise<ScrollIntoViewOutput>;
}

// ---------------------------------------------------------------------------
// Table context surface (shared table-context facade)
// ---------------------------------------------------------------------------

/**
 * The current selection's table context, resolved from the V2 host
 * table-context facade. `inTable` is false (and the rest `null`) when the caret
 * is not inside a table, the host does not expose the facade, or the context is
 * incomplete. This is the shared surface the `table-*` command family routes
 * through; custom UIs read it to enable / label their own table controls.
 */
export interface TableContextInfo {
  /** Whether the current selection is inside a table. */
  inTable: boolean;
  /** Stable node id of the enclosing table, when resolved. */
  tableNodeId: string | null;
  /** Zero-based row index of the current cell, when resolved. */
  rowIndex: number | null;
  /** Zero-based column index of the current cell, when resolved. */
  columnIndex: number | null;
  /** Stable node id of the current cell, when resolved. */
  cellNodeId: string | null;
  /** Row count of the enclosing table, when the host projects it. */
  rows: number | null;
  /** Column count of the enclosing table, when the host projects it. */
  columns: number | null;
}

/** Table-context surface shared by the built-in toolbar and custom UIs. */
export interface TablesHandle {
  /** Read the current table context snapshot. */
  getContext(): TableContextInfo;
  /** Convenience: whether the current selection is inside a table. */
  isInTable(): boolean;
}

// ---------------------------------------------------------------------------
// Search surface
// ---------------------------------------------------------------------------

/**
 * Previously published Search snapshot.
 * @deprecated replaceWith=`SearchSnapshot` removeIn=v3.0
 */
export interface SearchSlice {
  /** Current query string. */
  query: string;
  /** Total match count for the current query. */
  total: number;
  /** Zero-based index of the active match, or -1 when none. */
  activeIndex: number;
  /** Whether a search session is open. */
  open: boolean;
  /** Whether the host exposes a usable search facade. */
  available: boolean;
  /** Whether the query is case-sensitive. */
  caseSensitive: boolean;
  /**
   * Whether the session includes pending tracked deletions in match discovery.
   * @deprecated replaceWith=`includeTrackedDeletions` removeIn=v3.0
   */
  includeDeletedText: boolean;
  /** Whether the query is a regular expression (V2 runtime only). */
  regex: boolean;
  /**
   * Whether `replace()` can mutate the active match right now. False in
   * viewing / read-only mode or when replace is host-unavailable.
   */
  canReplace: boolean;
  /**
   * Whether `replaceAll()` can mutate right now. Everything that disables
   * `canReplace` disables this too. It also requires at least one match, and
   * it is false for a truncated match set: when more matches exist than the
   * session enumerates, replacing all of them cannot be applied, while
   * replacing the active match still can.
   *
   * Optional here so existing implementations of the deprecated
   * {@link SearchHandle} keep compiling; {@link SearchSnapshot} requires it.
   */
  canReplaceAll?: boolean;
  /** Stable reason when the surface (or an action) is unavailable. */
  reason?: SuperDocUIReason;
}

/** State shared by the built-in Search surface and application-owned Search controls. */
export interface SearchSnapshot extends SearchSlice {
  /** Whether the session includes pending tracked deletions in match discovery. */
  includeTrackedDeletions: boolean;
  /** Whether `replaceAll()` can mutate right now. See {@link SearchSlice.canReplaceAll}. */
  canReplaceAll: boolean;
}

/** Options for `superdoc.ui.search.find()`. */
export interface SearchQueryOptions {
  /** Match uppercase and lowercase letters exactly (default: false). */
  caseSensitive?: boolean;
  /** Include text from pending tracked deletions (default: false). */
  includeTrackedDeletions?: boolean;
  /**
   * Include text from pending tracked deletions (default: false).
   * @deprecated replaceWith=`includeTrackedDeletions` removeIn=v3.0
   */
  includeDeletedText?: boolean;
  /** Treat the query as a regular expression (default: false). */
  regex?: boolean;
}

/**
 * Previously published Search controller.
 * @deprecated replaceWith=`SearchController` removeIn=v3.0
 */
export interface SearchHandle extends SnapshotSubscribable<SearchSlice> {
  /** Read the current search snapshot. */
  getSnapshot(): SearchSlice;
  /** Open a search session. Returns a failed result when the current Editor cannot search. */
  open(): WorkflowActionResult;
  /** Close the current search session and clear highlights. */
  close(): void;
  /**
   * Find `query` in the open document.
   * @deprecated replaceWith=`find` removeIn=v3.0
   */
  search(query: string, options?: SearchQueryOptions): SearchSlice;
  /** Move to the next match. Returns a failed result when Search is unavailable or has no matches. */
  next(): WorkflowActionResult;
  /** Move to the previous match. Returns a failed result when Search is unavailable or has no matches. */
  previous(): WorkflowActionResult;
  /** Clear the current query and matches. */
  clear(): void;
  /**
   * Replace the active match through the host search session, then re-query.
   * Fails closed with `document-readonly` in viewing mode, `search-unavailable`
   * when the host exposes no search facade, and `operation-unavailable` when
   * there is no active match / replace cannot be applied.
   *
   * Worker-backed (async Document API) sessions return a promise that resolves
   * with the settled outcome once the mutation lands; hold any pending UI state
   * until it resolves.
   */
  replace(replacement: string): WorkflowActionResult | Promise<WorkflowActionResult>;
  /**
   * Replace every current match exactly once through the host search session.
   * Fails closed with `document-readonly` in viewing mode, `search-unavailable`
   * when unavailable, and `operation-unavailable` when the full match set
   * cannot be enumerated (truncated) or replace cannot be applied.
   *
   * Worker-backed (async Document API) sessions return a promise that resolves
   * with the settled outcome once the mutation lands; hold any pending UI state
   * until it resolves.
   */
  replaceAll(replacement: string): WorkflowActionResult | Promise<WorkflowActionResult>;
}

/** Search controller shared by the built-in surface and custom UI. */
export interface SearchController
  extends Omit<SearchHandle, keyof SnapshotSubscribable<SearchSlice> | 'search'>, SnapshotSubscribable<SearchSnapshot> {
  /**
   * Find `query` in the open document. Returns the latest snapshot with the
   * match total and active index. When a worker finishes later, `observe()`
   * publishes the settled result.
   */
  find(query: string, options?: SearchQueryOptions): SearchSnapshot;
  /**
   * Find `query` in the open document.
   * @deprecated replaceWith=`find` removeIn=v3.0
   */
  search(query: string, options?: SearchQueryOptions): SearchSnapshot;
}

// ---------------------------------------------------------------------------
// Context menu surface
// ---------------------------------------------------------------------------

/** Runtime control and document context for context menus. */
export interface ContextMenuHandle {
  /** Open the menu at the active selection or caret. */
  open(): WorkflowActionResult;
  /** Close the menu when it is open. */
  close(): void;
  /**
   * Resolve the public document context at a viewport point. Coordinates use
   * `MouseEvent.clientX` and `MouseEvent.clientY`. This remains available when
   * the built-in context menu is disabled.
   */
  contextAt(input: { x: number; y: number }): ViewportContext;
}

// ---------------------------------------------------------------------------
// Host-like structural contracts (duck-typed)
// ---------------------------------------------------------------------------

/**
 * Structural shape of the active editor the controller reads. Every member is
 * optional so a non-browser / pre-ready stub still satisfies it. The
 * controller reads `doc` (the public Document API facade) and a few public
 * instance methods; it never imports a concrete editor class.
 */
export interface SuperDocEditorLike {
  /** Runtime evidence of the bundled v2 editor. */
  editorVersion?: number;
  /**
   * Public, read-only-guarded browser Document API facade (async-capable in
   * browser). Partial by design: this is what a host supplies, and a stub or
   * custom adapter carries only the operations it implements.
   *
   * `CustomCommandContext.doc` is the same partial type, because the controller
   * passes this object straight through and can promise no more than the host
   * does. {@link BrowserDocumentApi}, the complete facade, is the type of
   * `activeEditor.doc` on a real `Editor`.
   */
  doc?: PartialBrowserDocumentApi | null;
  /** Stable reason the Document API is unavailable. */
  documentApiUnavailableReason?: string | null;
  /** Runtime control for the built-in context menu. */
  contextMenu?: {
    open?(): unknown;
    close?(): unknown;
  } | null;
  /** Editor-scoped event subscription. */
  on?(event: string, handler: (...args: unknown[]) => void): unknown;
  /** Editor-scoped event unsubscription. */
  off?(event: string, handler: (...args: unknown[]) => void): unknown;
  /** Export the active editor's document. */
  exportDocx?(...args: unknown[]): Promise<unknown>;
  /** Save the active editor's document. */
  save?(...args: unknown[]): Promise<unknown>;
}

/**
 * Structural shape of the SuperDoc instance (or host stub) the controller
 * binds to. `on`/`off` are declared as methods so a host typed to the exact
 * event union the controller subscribes to, the closed `SuperDocEventMap`-typed
 * SuperDoc instance, and a broad `(event: string, ...)` stub are all
 * assignable.
 */
export interface SuperDocLike {
  /** The routed active editor, when one is mounted. */
  activeEditor?: SuperDocEditorLike | null;
  /**
   * The host-owned UI controller. A real `SuperDoc` instance always exposes
   * one and owns its lifecycle; bare structural stubs may not, which is why
   * this is optional. Consumers should read it rather than build their own.
   *
   * Borrowed, not owned: the host tears this down, so the type omits
   * `destroy()` and a reader cannot call it.
   */
  ui?: BorrowedSuperDocUI;
  /** Lifecycle event subscription. */
  on?(event: string, handler: (...args: unknown[]) => void): unknown;
  /** Lifecycle event unsubscription. */
  off?(event: string, handler: (...args: unknown[]) => void): unknown;
  /** Set the document mode across the instance. */
  setDocumentMode?(mode: string): unknown;
  /** Export the active document. */
  export?(params?: ExportParams): Promise<Blob> | Blob;
  /** Set an absolute zoom value. */
  setZoom?(value: number): unknown;
  /** Set a zoom mode. */
  setZoomMode?(mode: 'manual' | 'fit-width'): unknown;
  /** Read the current zoom state. */
  getZoomState?(): unknown;
  /** Instance-level config bag; the controller reads it defensively. */
  config?: unknown;
}

// ---------------------------------------------------------------------------
// Controller state, options, and the controller itself
// ---------------------------------------------------------------------------

/** Aggregate controller state; the source for every derived slice. */
export interface SuperDocUIState {
  /** The active editor is ready. */
  ready: boolean;
  /** Current document mode. */
  documentMode: 'editing' | 'suggesting' | 'viewing' | null;
  /** Document-level slice. */
  document: DocumentSlice;
  /** Selection slice. */
  selection: SelectionSlice;
  /** Toolbar snapshot slice. */
  toolbar: ToolbarSnapshotSlice;
  /** Comments slice. */
  comments: CommentsSlice;
  /** Track-changes slice. */
  trackChanges: TrackChangesSlice;
  /** Content-controls slice. */
  contentControls: ContentControlsSlice;
  /** Zoom slice. */
  zoom: ZoomSlice;
  /** Fonts slice. */
  fonts: FontsSlice;
  /** Styles slice (read-only catalogue + active paragraph style). */
  styles: StylesSlice;
}

/** Options accepted by {@link createSuperDocUI}. */
export interface SuperDocUIOptions {
  /** The SuperDoc instance (or structural host) to bind to. */
  superdoc: SuperDocLike;
}

/**
 * A disposable subscription scope. Subscriptions created inside the scope are
 * released together when the scope is disposed.
 */
export interface SuperDocUIScope {
  /** Subscribe within the scope. */
  select<TSlice>(selector: SelectorFn<SuperDocUIState, TSlice>, equality?: EqualityFn<TSlice>): Subscribable<TSlice>;
  /** Dispose every subscription created within the scope. */
  dispose(): void;
}

/**
 * The browser-only UI controller. A small, truthful, v2-native layer over the
 * public active-editor / Document API facade and SuperDoc events. Supported
 * operations call public v2-backed surfaces; unsupported operations are
 * disabled or return stable failure / noop results.
 */
export interface SuperDocUI {
  /** Subscribe to a derived slice of controller state. */
  select<TSlice>(selector: SelectorFn<SuperDocUIState, TSlice>, equality?: EqualityFn<TSlice>): Subscribable<TSlice>;
  /** Read the current aggregate state. */
  readonly state: SuperDocUIState;
  /** Selection surface. */
  readonly selection: SelectionHandle;
  /** Command surface. */
  readonly commands: CommandsHandle;
  /** Toolbar surface. */
  readonly toolbar: ToolbarHandle;
  /** Comments surface. */
  readonly comments: CommentsHandle;
  /** Track-changes surface. */
  readonly trackChanges: TrackChangesHandle;
  /** Content-controls surface. */
  readonly contentControls: ContentControlsHandle;
  /** Fonts surface. */
  readonly fonts: FontsHandle;
  /** Zoom surface. */
  readonly zoom: ZoomHandle;
  /** Document surface. */
  readonly document: DocumentHandle;
  /** Viewport / geometry surface. */
  readonly viewport: ViewportHandle;
  /** Metadata geometry/navigation convenience surface. */
  readonly metadata: MetadataHandle;
  /** Table-context surface (shared `table-*` routing truth). */
  readonly tables: TablesHandle;
  /** Search surface. */
  readonly search: SearchController;
  /** Built-in context menu runtime control. */
  readonly contextMenu: ContextMenuHandle;
  /** Styles surface (read-only catalogue + active paragraph style). */
  readonly styles: StylesHandle;
  /** Format-painter surface (DOM listener coordination). */
  readonly formatPainter: FormatPainterHandle;
  /** Create a disposable subscription scope. */
  createScope(): SuperDocUIScope;
  /**
   * Tear down all subscriptions and detach from the host.
   *
   * Only the owner calls this. A controller obtained from `createSuperDocUI()`
   * is owned by its caller. The one at `superdoc.ui` is owned by the instance
   * and is typed {@link BorrowedSuperDocUI}, which does not carry this method.
   */
  destroy(): void;
}

/**
 * The controller as a *consumer* sees it: everything except `destroy()`.
 *
 * This is what `superdoc.ui` and the React hooks return. The instance owns that
 * controller and tears it down in `superdoc.destroy()`, so a consumer calling
 * `destroy()` would freeze command state for the built-in toolbar and every
 * other reader of the same instance. Omitting the method makes that a compile
 * error rather than a documented convention nobody reads.
 *
 * Derived from {@link SuperDocUI} rather than declared separately so the two
 * cannot drift: every handle added there appears here automatically.
 */
export type BorrowedSuperDocUI = Omit<SuperDocUI, 'destroy'>;
