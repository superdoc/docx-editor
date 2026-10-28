// Internal SuperDoc editor-runtime contract.
//
// This module defines the ONE internal surface shared shell code uses to talk
// to the mounted v2 document editor. It is shell-owned and
// NOT a public SDK API, NOT a shared document position model, and NOT a place to
// re-export editor internals.
//
// Boundary rules (enforced by `import-boundary.test.ts`):
// This file may import only package-local neutral helper types and
//     browser/platform types. It currently imports nothing.
// It must NEVER import ProseMirror, legacy editor packages,
//     concrete editor internals, `EditorInputManager`, `PositionHit`,
//     `TextSelection`/`NodeSelection`, the concrete v2 host implementation
//     files, or `SDPosition`/`SDRange`/Document API internals.
// Runtime positions are opaque handles. The shell may store and round-trip
//     them, but must never interpret them. Adapters keep non-serializable
//     internals in adapter-private maps keyed by `tokenId`.
//
// Outcome semantics are modeled to preserve the current v2 editor host posture:
// commit,
// history-commit, history-noop, receipt-failure, and named rejection  -  not a
// boolean success/failure collapse. The shared contract defines NEUTRAL codes;
// the concrete v2 adapter maps its own codes onto these.

// ---------------------------------------------------------------------------
// Neutral JSON-safe helper types (package-local, no external imports)
// ---------------------------------------------------------------------------

/** A structured-clone / JSON-safe primitive. */
export type RuntimeJsonPrimitive = string | number | boolean | null;

/** A structured-clone / JSON-safe value. */
export type RuntimeJsonValue = RuntimeJsonPrimitive | RuntimeJsonValue[] | { [key: string]: RuntimeJsonValue };

/** A structured-clone / JSON-safe object. */
export type RuntimeJsonObject = { [key: string]: RuntimeJsonValue };

// ---------------------------------------------------------------------------
// Identity + lifecycle
// ---------------------------------------------------------------------------

/** Which editing architecture backs a mounted runtime. */
export type EditorRuntimeKind = 'v2';

/** Opaque, registry-unique identifier for a mounted runtime. */
export type EditorRuntimeId = string;

/** Shell-owned document mode shared across editor runtimes. */
export type EditorRuntimeDocumentMode = 'editing' | 'suggesting' | 'viewing';

/**
 * Shell-level lifecycle state. Mirrors the current v2 editor host state machine
 * so the contract can describe v2 outcomes without importing v2 host types.
 */
export type EditorRuntimeState =
  | 'opening'
  | 'blocked'
  | 'review-ready'
  | 'editing-ready'
  | 'saving'
  | 'disposed'
  | 'failed';

// ---------------------------------------------------------------------------
// Opaque position tokens
// ---------------------------------------------------------------------------

/**
 * An opaque, structured-clone-safe handle to a runtime-owned position or range.
 *
 * The shell may store a token and send it back to the runtime that created it,
 * but must NEVER read `payload` internals, and must never construct a token to
 * mean a document location. The runtime may wrap an `SDPosition` or another
 * private handle; non-serializable internals stay in an
 * adapter-private map keyed by `tokenId`.
 *
 * Tokens are self-validating for staleness: a runtime that cannot prove a token
 * is current (via `revision`/epoch/map entry) must reject with
 * `stale-position-token`, and a runtime handed a token minted by a different
 * runtime must reject with `wrong-runtime-token`.
 */
export interface EditorRuntimePositionToken {
  /** Runtime that minted this token. A different runtime must reject it. */
  readonly runtimeId: EditorRuntimeId;
  /** Adapter-private map key. Opaque to the shell. */
  readonly tokenId: string;
  /** Adapter-private staleness discriminator (revision/epoch). Opaque to the shell. */
  readonly revision: string | number;
  /**
   * Optional structured-clone-safe carrier. Present so tokens survive
   * `postMessage`/`structuredClone`. The shell must not read fields from it.
   */
  readonly payload?: RuntimeJsonObject;
}

// ---------------------------------------------------------------------------
// Command dispatch (mutations)
// ---------------------------------------------------------------------------

/**
 * Shell-level, capability-scoped command kinds. This is intentionally NOT the
 * full editor command catalog: it is the coarse set the shared shell needs, grouped
 * by capability. Adapters expand each kind into concrete editor operations.
 * Detailed per-domain command signatures (comments, tracked changes, AI) are
 * owned by later adapter plans; only the coarse routing shape lives here.
 */
export type EditorRuntimeCommand =
  // text editing
  | { kind: 'text.insert'; text: string; at?: EditorRuntimePositionToken }
  | { kind: 'text.replace'; text: string; range?: EditorRuntimePositionToken }
  | { kind: 'text.deleteBackward' }
  | { kind: 'text.deleteForward' }
  | { kind: 'text.paste'; text: string; html?: string }
  // history
  | { kind: 'history.undo' }
  | { kind: 'history.redo' }
  // structural
  | { kind: 'structural.splitBlock' }
  | { kind: 'structural.indent' }
  | { kind: 'structural.outdent' }
  // formatting (coarse; adapters resolve the concrete mark/paragraph op)
  | { kind: 'formatting.applyMark'; mark: string; value?: RuntimeJsonValue }
  | { kind: 'formatting.applyParagraph'; properties: RuntimeJsonObject }
  // comments (domain group; detailed signatures owned by the concrete adapter)
  | { kind: 'comments.create'; text: string; range?: EditorRuntimePositionToken }
  | { kind: 'comments.resolve'; commentId: string }
  | { kind: 'comments.reopen'; commentId: string }
  | { kind: 'comments.delete'; commentId: string }
  | { kind: 'comments.reply'; parentCommentId: string; text: string }
  | { kind: 'comments.edit'; commentId: string; text: string }
  // tracked changes (domain group; detailed signatures owned by the concrete adapter)
  | { kind: 'trackedChanges.accept'; id: string }
  | { kind: 'trackedChanges.reject'; id: string }
  | { kind: 'trackedChanges.acceptAll' }
  | { kind: 'trackedChanges.rejectAll' }
  | { kind: 'trackedChanges.setAuthoringMode'; mode: 'direct' | 'tracked' };

/** The discriminant kind of an {@link EditorRuntimeCommand}. */
export type EditorRuntimeCommandKind = EditorRuntimeCommand['kind'];

/**
 * Reason a command made no change. Kept distinct from rejection so the shell can
 * tell "valid command, nothing to do" from "command refused".
 */
export type EditorRuntimeNoopReason =
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'no-effect'
  | 'already-applied'
  | 'empty-selection';

/**
 * Neutral rejection codes. Adapters map their concrete codes onto this
 * set; the shared contract must not import concrete runtime code unions.
 */
export type EditorRuntimeRejectionCode =
  | 'runtime-not-ready'
  | 'host-saving'
  | 'capability-unsupported'
  | 'command-unsupported'
  | 'selection-unsupported'
  | 'target-unsupported'
  | 'document-readonly'
  | 'command-failed'
  | 'stale-position-token'
  | 'wrong-runtime-token'
  | 'author-required'
  | 'selection-invalidated'
  | 'review-command-unavailable';

/**
 * Named command outcome. Mutations are async and return this envelope; the shell
 * must always await it. `receipt`/`result`/`failure` are opaque  -  receipt-driven
 * cache and position invalidation stay inside the runtime/adapter. The shell
 * must not inspect these to invalidate document state.
 */
export type EditorRuntimeCommandResult =
  | { status: 'committed'; receipt?: unknown }
  | { status: 'history-committed'; result?: unknown }
  | { status: 'noop'; reason: EditorRuntimeNoopReason }
  | { status: 'history-noop'; reason: EditorRuntimeNoopReason; result?: unknown }
  | { status: 'receipt-failure'; failure?: unknown }
  | { status: 'rejected'; reason: EditorRuntimeRejectionCode; detail?: string };

// ---------------------------------------------------------------------------
// Read snapshots (synchronous where they back existing shell APIs / computeds)
// ---------------------------------------------------------------------------

/**
 * Neutral selection snapshot. Anchor/focus endpoints are opaque position tokens.
 * `text` is the selected text the shell already reads synchronously today.
 */
export interface EditorRuntimeSelectionSnapshot {
  /** True when anchor and focus differ (a non-collapsed range). */
  readonly isRange: boolean;
  /** True when the selection is empty/collapsed or absent. */
  readonly isEmpty: boolean;
  /** Selected text, synchronous read. Empty string when collapsed/absent. */
  readonly text: string;
  /** Opaque anchor endpoint, when the runtime can mint one. */
  readonly anchor?: EditorRuntimePositionToken;
  /** Opaque focus endpoint, when the runtime can mint one. */
  readonly focus?: EditorRuntimePositionToken;
}

/**
 * Synchronous find/search session snapshot. Backs `SuperDoc.search(...)` and
 * `goToSearchResult(...)` shell computeds, which must not become async in
 * current implementation.
 */
export interface EditorRuntimeFindSessionSnapshot {
  /** Whether a search session is currently active. */
  readonly active: boolean;
  /** Current query string, or empty when no session. */
  readonly query: string;
  /** Total match count for the current query. */
  readonly matchCount: number;
  /** Active match index, or -1 when there is no active match. */
  readonly activeMatchIndex: number;
}

/** Toolbar state snapshot. Shape is intentionally permissive in current implementation. */
export interface EditorRuntimeToolbarState {
  /** Marks/commands currently active for the selection. */
  readonly activeMarks: readonly string[];
  /** Marks/commands disabled in the current context. */
  readonly disabled: readonly string[];
  /** Optional shell-readable extra state, JSON-safe. */
  readonly extra?: RuntimeJsonObject;
}

/** Page/layout metrics snapshot. */
export interface EditorRuntimeLayoutSnapshot {
  /** Total page count, when paginated. */
  readonly pageCount: number;
  /** Current page (1-based), when known. */
  readonly currentPage: number;
  /** Current zoom as a percent (100 = unscaled). */
  readonly zoom: number;
}

/** Coarse runtime snapshot the shell can read without subscribing. */
export interface EditorRuntimeSnapshot {
  readonly id: EditorRuntimeId;
  readonly kind: EditorRuntimeKind;
  readonly documentId: string;
  readonly state: EditorRuntimeState;
  readonly documentMode: EditorRuntimeDocumentMode;
  /** Stable reason string when `state` is `blocked` or `failed`. */
  readonly reason?: string;
  readonly capabilities: EditorRuntimeCapabilities;
}

// ---------------------------------------------------------------------------
// Method option / target types
// ---------------------------------------------------------------------------

export interface EditorRuntimeFocusOptions {
  /** Restore the previous selection on focus when available. */
  readonly restoreSelection?: boolean;
  /** Prevent scrolling the focus target into view. */
  readonly preventScroll?: boolean;
}

export interface EditorRuntimeSaveOptions {
  /** Optional adapter-defined save hint, JSON-safe. */
  readonly hint?: RuntimeJsonObject;
}

export interface EditorRuntimeExportOptions {
  readonly policies?: import('../../public/export-types.js').DocxExportPolicies;
  /** Optional adapter-defined export hint, JSON-safe. */
  readonly hint?: RuntimeJsonObject;
  /** Public comment export policy forwarded by `SuperDoc.export(...)`. */
  readonly commentsType?: 'external' | 'clean';
  /** Export finalization flag forwarded by `SuperDoc.export(...)`. */
  readonly isFinalDoc?: boolean;
  /** Optional field-highlight color forwarded by `SuperDoc.export(...)`. */
  readonly fieldsHighlightColor?: string | null;
}

/**
 * A navigation/reveal target. Positions are opaque tokens; page/comment targets
 * are shell-level identifiers.
 */
export type EditorRuntimeNavigationTarget =
  | { kind: 'position'; position: EditorRuntimePositionToken }
  | { kind: 'page'; page: number }
  | { kind: 'comment'; commentId: string }
  | { kind: 'search-result'; matchIndex: number };

// ---------------------------------------------------------------------------
// Capability descriptors
// ---------------------------------------------------------------------------
//
// Capabilities DESCRIBE what a runtime supports so unsupported surfaces fail
// closed without forcing every runtime to emulate every other runtime. The
// EditorRuntime methods do the work; these descriptors gate the shell.

export interface RuntimeLifecycleCapabilities {
  readonly canFocus: boolean;
  readonly canDispose: boolean;
}

export interface RuntimeSelectionCapabilities {
  /** Runtime can report selected text synchronously. */
  readonly canReadSelectedText: boolean;
  /** Runtime can report a selection snapshot synchronously. */
  readonly canReadSelectionSnapshot: boolean;
  /** Runtime can mint opaque position tokens for the current selection. */
  readonly canMintPositionTokens: boolean;
}

export interface RuntimeCommandCapabilities {
  /** Whether dispatch is accepted at all in the current state. */
  readonly canDispatch: boolean;
  /** Command kinds the runtime currently supports. */
  readonly supportedCommands: readonly EditorRuntimeCommandKind[];
}

export interface RuntimeFindReplaceCapabilities {
  readonly supported: boolean;
  /** Runtime exposes a synchronous find-session snapshot. */
  readonly hasSyncSessionSnapshot: boolean;
  readonly canReplace: boolean;
}

export interface RuntimeAiCapabilities {
  readonly supported: boolean;
}

export interface RuntimeCommentCapabilities {
  readonly supported: boolean;
  /** Whether comment mutation is currently allowed (e.g. author present). */
  readonly canMutate: boolean;
}

export interface RuntimeTrackedChangeCapabilities {
  readonly supported: boolean;
  readonly canDecide: boolean;
  readonly canToggleAuthoring: boolean;
}

export interface RuntimeToolbarCapabilities {
  readonly supported: boolean;
  /** Runtime emits `toolbar-state-change` events. */
  readonly emitsStateChange: boolean;
}

export interface RuntimeLayoutCapabilities {
  readonly supported: boolean;
  /** Runtime exposes a synchronous layout snapshot. */
  readonly hasSyncSnapshot: boolean;
}

export interface RuntimeZoomCapabilities {
  readonly supported: boolean;
  readonly min: number;
  readonly max: number;
}

export interface RuntimeNavigationCapabilities {
  readonly supported: boolean;
  /** Navigation target kinds the runtime can reveal. */
  readonly targets: readonly EditorRuntimeNavigationTarget['kind'][];
}

export interface RuntimePersistenceCapabilities {
  readonly canSave: boolean;
  readonly canExportDocx: boolean;
}

/**
 * Grouped capability descriptor. Required groups (lifecycle, selection,
 * commands, layout, zoom, navigation, persistence) are always present; optional
 * domain groups are present only when the runtime offers them.
 */
export interface EditorRuntimeCapabilities {
  readonly lifecycle: RuntimeLifecycleCapabilities;
  readonly selection: RuntimeSelectionCapabilities;
  readonly commands: RuntimeCommandCapabilities;
  readonly layout: RuntimeLayoutCapabilities;
  readonly zoom: RuntimeZoomCapabilities;
  readonly navigation: RuntimeNavigationCapabilities;
  readonly persistence: RuntimePersistenceCapabilities;
  readonly findReplace?: RuntimeFindReplaceCapabilities;
  readonly ai?: RuntimeAiCapabilities;
  readonly comments?: RuntimeCommentCapabilities;
  readonly trackedChanges?: RuntimeTrackedChangeCapabilities;
  readonly toolbar?: RuntimeToolbarCapabilities;
}

// ---------------------------------------------------------------------------
// Events + subscription
// ---------------------------------------------------------------------------

/**
 * Runtime-owned events. The registry (the editor runtime boundary) owns active-runtime changes;
 * the runtime owns editor-specific state. Events carry shell-level snapshots,
 * not raw ProseMirror or v2 session objects.
 */
export type EditorRuntimeEvent =
  | { type: 'selection-change'; selection: EditorRuntimeSelectionSnapshot }
  | { type: 'capabilities-change'; capabilities: EditorRuntimeCapabilities }
  | { type: 'toolbar-state-change'; state: EditorRuntimeToolbarState }
  | { type: 'layout-change'; layout: EditorRuntimeLayoutSnapshot }
  | { type: 'state-change'; state: EditorRuntimeState }
  | { type: 'disposed' };

export type EditorRuntimeListener = (event: EditorRuntimeEvent) => void;
export type EditorRuntimeUnsubscribe = () => void;

// ---------------------------------------------------------------------------
// The runtime contract
// ---------------------------------------------------------------------------

/**
 * The shell-owned editor runtime contract. Implementable by the current
 * internal v2 host/facade without importing v2 host types into this
 * shared module.
 *
 * Mutating operations return Promises (callers always await). Runtime-owned
 * snapshot reads (`getSelectedText`, `getSelectionSnapshot`,
 * `getFindSessionSnapshot`, `getToolbarState`, `getLayoutSnapshot`) are
 * synchronous so they can back existing synchronous shell APIs and Vue
 * computeds without forcing them async in current implementation.
 */
export interface EditorRuntime {
  readonly id: EditorRuntimeId;
  readonly kind: EditorRuntimeKind;
  readonly documentId: string;
  /** The mounted root element, used for event-target → runtime resolution. */
  readonly root: HTMLElement;

  getCapabilities(): EditorRuntimeCapabilities;
  getSnapshot(): EditorRuntimeSnapshot;
  setDocumentMode(mode: EditorRuntimeDocumentMode): void;
  getDocumentMode(): EditorRuntimeDocumentMode;
  setTrackedChangesRenderOptions(options?: { mode?: 'review' | 'original' | 'final' | 'off'; enabled?: boolean }): void;
  setShowFormattingMarks(show: boolean): void;

  /**
   * Temporary compatibility path backing `SuperDoc.activeEditor`,
   * `doc.getEditor()`, and existing public-ish callers. The v2 runtime returns
   * its facade. New shell behavior must not route through this projection.
   */
  getLegacyEditorProjection?(): unknown;

  // lifecycle / focus
  focus(options?: EditorRuntimeFocusOptions): Promise<boolean>;
  dispose(): void | Promise<void>;

  // command dispatch (mutations)
  dispatch(command: EditorRuntimeCommand): Promise<EditorRuntimeCommandResult>;

  // synchronous read snapshots
  getSelectedText(): string;
  getSelectionSnapshot(): EditorRuntimeSelectionSnapshot | null;
  getFindSessionSnapshot?(): EditorRuntimeFindSessionSnapshot | null;
  getToolbarState?(): EditorRuntimeToolbarState | null;
  getLayoutSnapshot(): EditorRuntimeLayoutSnapshot | null;

  // persistence
  save(options?: EditorRuntimeSaveOptions): Promise<ArrayBuffer>;
  exportDocx(options?: EditorRuntimeExportOptions): Promise<ArrayBuffer>;

  // zoom + navigation
  setZoom(percent: number): Promise<EditorRuntimeCommandResult>;
  reveal(target: EditorRuntimeNavigationTarget): Promise<EditorRuntimeCommandResult>;

  // events
  subscribe(listener: EditorRuntimeListener): EditorRuntimeUnsubscribe;
}
