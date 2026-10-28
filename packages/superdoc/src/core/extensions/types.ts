/**
 * Public, author-facing contract for v2 SuperDoc extensions.
 *
 * This is the type surface customers program against when they call
 * {@link defineSuperDocExtension} and pass the result to
 * `new SuperDoc({ selector, document, extensions: [...] })`.
 *
 * `superdoc@2` IS the v2 editor — there is no customer-facing `editorVersion`
 * or `editorIntegration` runtime selection. Extensions are always interpreted
 * against the DOCX Engine runtime.
 *
 * These types are intentionally a self-contained, public-package-owned mirror
 * of the internal v2 extension runtime contract. The published `superdoc`
 * package and the internal runtime source live in different workspaces and must not
 * import each other, so the public surface owns its own structural copy and the
 * two connect at the {@link SuperDocExtension} boundary: authors write
 * `defineSuperDocExtension({...})` typed against this copy; the resulting opaque
 * object is activated by the engine runtime typed against its own copy.
 * Keeping the mirror self-contained also keeps internal v2 runtime and
 * Document API workspace packages out of the published `Config` declaration
 * graph.
 *
 * V2 extensions are NOT v1 ProseMirror extensions. The legacy
 * `editorExtensions` config key is a v1/ProseMirror concept and is ignored in
 * `superdoc@2`; v2 uses {@link SuperDocExtension} through `extensions`. None of
 * these types expose raw XML, package bytes, kernel state, ProseMirror state,
 * raw host dispatch, or mutable document DOM nodes — customer writes go through
 * `ctx.doc.*` only.
 */

/**
 * Story locator mirror. Structurally compatible with the Document API
 * `StoryLocator` discriminated union (body, header/footer, footnote, endnote,
 * textbox), so a Document API target such as a comment's `target` can be
 * painted directly. Variant fields are optional because `storyType` decides
 * which one is present.
 */
export interface SuperDocStoryLocator {
  kind: 'story';
  storyType: 'body' | 'headerFooterSlot' | 'headerFooterPart' | 'footnote' | 'endnote' | 'textbox';
  section?: { kind: 'section'; sectionId: string };
  headerFooterKind?: 'header' | 'footer';
  variant?: 'default' | 'first' | 'even';
  resolution?: 'effective' | 'explicit';
  onWrite?: 'materializeIfInherited' | 'editResolvedPart' | 'error';
  refId?: string;
  noteId?: string;
  textboxId?: string;
}

/** Char range within a story's flattened text model (UTF-16 code units). */
export interface SuperDocCharRange {
  start: number;
  end: number;
}

/**
 * Success receipt mirror. Structurally compatible with the Document API
 * `ReceiptSuccess`; only the load-bearing fields are named, the rest is left
 * open so the public surface stays decoupled from the private receipt type.
 */
export interface SuperDocReceiptSuccess {
  success: true;
  /** Convenience id for operations that create exactly one primary entity. */
  id?: string;
  /** Transaction id of the successful commit, when the engine tracks one. */
  txId?: string;
  /** Stories whose content revision changed because of the operation. */
  affectedStories?: SuperDocStoryLocator[];
  [key: string]: unknown;
}

/** Text address mirror (single block + range). */
export interface SuperDocTextAddress {
  kind: 'text';
  blockId: string;
  range: { start: number; end: number };
  story?: SuperDocStoryLocator;
}

/** Multi-segment text target mirror. */
export interface SuperDocTextTarget {
  kind: 'text';
  segments: ReadonlyArray<{ blockId: string; range: { start: number; end: number } }>;
  /** Omitted means visible; tracked includes pending deleted text. */
  coordinateSpace?: 'visible' | 'tracked';
  story?: SuperDocStoryLocator;
}

/** A single point within a {@link SuperDocSelectionTarget}. */
export type SuperDocSelectionPoint =
  | { kind: 'text'; blockId: string; offset: number; story?: SuperDocStoryLocator }
  | {
      kind: 'nodeEdge';
      node: { kind: 'block'; nodeType?: string; nodeId: string; story?: SuperDocStoryLocator };
      edge: 'before' | 'after';
    };

/**
 * Structural selection target. Compatible with the `SelectionTarget` returned
 * by `ctx.doc.query.match(...).items[].target` and `ctx.doc.selection.current()`.
 */
export interface SuperDocSelectionTarget {
  kind: 'selection';
  start: SuperDocSelectionPoint;
  end: SuperDocSelectionPoint;
  story?: SuperDocStoryLocator;
  /** Coordinate space for text endpoint offsets. Omitted means `visible`. */
  coordinateSpace?: 'visible' | 'tracked';
}

/** Visible or tracked locations; markup-hidden tracked ranges stay active but unpainted. */
export type SuperDocAnchorTarget = SuperDocSelectionTarget | SuperDocTextTarget | SuperDocTextAddress;

/** Lifecycle status of a {@link SuperDocAnchor}. */
export type SuperDocAnchorStatus = 'active' | 'stale' | 'disposed' | 'pending';

/**
 * A session-stable location handle. The runtime rebases anchors from
 * block-local Document API receipt data; an anchor that cannot be rebased
 * safely fails closed to `stale` and never silently points at the wrong range.
 */
export interface SuperDocAnchor {
  readonly id: string;
  readonly status: SuperDocAnchorStatus;
  readonly story: SuperDocStoryLocator;
  readonly blockId: string | null;
  current(): SuperDocAnchorTarget | null;
  segments(): ReadonlyArray<{ blockId: string; range: SuperDocCharRange }>;
  onChange(listener: (anchor: SuperDocAnchor) => void): () => void;
  dispose(): void;
}

/** A named, mutable collection of anchors. */
export interface SuperDocAnchorCollection {
  readonly id: string;
  replace(anchors: readonly SuperDocAnchor[]): void;
  add(anchors: readonly SuperDocAnchor[]): void;
  items(): SuperDocAnchor[];
  active(): SuperDocAnchor[];
  visibleIn(visible: SuperDocVisibleRange): SuperDocAnchor[];
  clear(): void;
}

/** Anchor factory + named collection registry. */
export interface SuperDocAnchorApi {
  from(target: SuperDocAnchorTarget): SuperDocAnchor;
  collection(id: string): SuperDocAnchorCollection;
}

/** The set of currently visible/painted blocks (null = unknown / all). */
export interface SuperDocVisibleRange {
  blockIds: ReadonlySet<string> | null;
}

/** Sanitized data payload a decoration may carry onto the painted DOM. */
export type SuperDocDecorationData = Record<string, string | number | boolean>;

/** A render-only decoration. MVP: class/data-only, text or block. */
export type SuperDocDecoration =
  | { type: 'text'; anchor: SuperDocAnchor; className?: string; data?: SuperDocDecorationData }
  | { type: 'block'; anchor: SuperDocAnchor; className?: string; data?: SuperDocDecorationData };

/** Context passed to a decoration provider on each apply pass. */
export interface SuperDocDecorationContext {
  visible: SuperDocVisibleRange;
  snapshot: SuperDocExtensionSnapshot;
}

/** A declarative, render-only decoration provider. */
export interface SuperDocDecorationProvider {
  id: string;
  provide(context: SuperDocDecorationContext): SuperDocDecoration[];
}

export type SuperDocMutationOrigin = 'local' | 'history' | 'extension' | 'remote';
export type SuperDocMutationAffect = 'text' | 'block' | 'comment' | 'trackedChange' | 'bookmark';

/** Synchronous filter applied before a mutation handler runs. */
export interface SuperDocMutationFilter {
  origin?: SuperDocMutationOrigin;
  affects?: SuperDocMutationAffect[];
  stories?: 'affected' | SuperDocStoryLocator[];
  anchors?: SuperDocAnchor | SuperDocAnchorCollection;
  sourceComplete?: boolean;
}

/** Simplified mutation event delivered to named/filtered handlers. */
export interface SuperDocMutationEvent {
  /** Additive operation cause; existing origin filters retain their meanings. */
  cause?: 'user' | 'api' | 'undo' | 'redo' | 'remote' | 'preview';
  /** Caller correlation on the current commit only. */
  changeTag?: string;
  id: string;
  origin: SuperDocMutationOrigin;
  affects: Set<SuperDocMutationAffect>;
  stories: SuperDocStoryLocator[];
  /** Advanced: the raw success receipt, when the mutation produced one. */
  receipt?: SuperDocReceiptSuccess;
}

export interface SuperDocSelectionEvent {
  story: SuperDocStoryLocator | null;
  blockId: string | null;
  collapsed: boolean;
}

export interface SuperDocPaintEvent {
  epoch: number;
  visible: SuperDocVisibleRange;
}

export interface SuperDocSaveEvent {
  phase: 'started' | 'completed' | 'failed';
  saveId: string;
  byteLength?: number;
  message?: string;
}

export type SuperDocExtensionDisposable = (() => void) | { dispose(): void };

export interface SuperDocDisposableBag {
  add(disposable: SuperDocExtensionDisposable): void;
}

export interface SuperDocExtensionDiagnostics {
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/** Per-host capability flags. Headless reports `canRender: false`. */
export interface SuperDocExtensionCapabilities {
  readonly canRender: boolean;
  readonly canUseShortcuts: boolean;
  readonly canMutate: boolean;
}

/** Per-extension, per-document snapshot read by handlers/providers. */
export interface SuperDocExtensionSnapshot {
  ready: boolean;
  sourceComplete: boolean;
  capabilities: SuperDocExtensionCapabilities;
}

/**
 * Read-only Document API query surface available to extension commands.
 * Mirrors the documented `ctx.doc.query.match(...)` flow; the query input is
 * left open so the public surface stays decoupled from the private query DSL.
 */
export interface SuperDocGuardedDocQuery {
  match(input: unknown): Promise<{ items: ReadonlyArray<{ target: SuperDocAnchorTarget }> }>;
}

/** Read-only selection surface available to extension commands. */
export interface SuperDocGuardedSelectionInfo {
  empty: boolean;
  target?: SuperDocAnchorTarget | null;
  text?: string;
}

export interface SuperDocGuardedDocSelection {
  current(input?: { includeText?: boolean }): SuperDocGuardedSelectionInfo | Promise<SuperDocGuardedSelectionInfo>;
}

type SuperDocGuardedDocOperationResult =
  | SuperDocReceiptSuccess
  | { success: false; [key: string]: unknown }
  | Record<string, unknown>
  | void;

type SuperDocGuardedDocOperation = (
  input?: unknown,
  options?: unknown,
) => SuperDocGuardedDocOperationResult | Promise<SuperDocGuardedDocOperationResult>;

interface SuperDocGuardedDocComments {
  create: SuperDocGuardedDocOperation;
  patch: SuperDocGuardedDocOperation;
  delete: SuperDocGuardedDocOperation;
  get: SuperDocGuardedDocOperation;
  list: SuperDocGuardedDocOperation;
  readonly [key: string]: SuperDocGuardedDocOperation;
}

interface SuperDocGuardedDocTrackChanges {
  list: SuperDocGuardedDocOperation;
  get: SuperDocGuardedDocOperation;
  decide: SuperDocGuardedDocOperation;
  readonly [key: string]: SuperDocGuardedDocOperation;
}

interface SuperDocGuardedDocText {
  replace: SuperDocGuardedDocOperation;
  readonly [key: string]: SuperDocGuardedDocOperation;
}

interface SuperDocGuardedDocHistory {
  get: SuperDocGuardedDocOperation;
  undo: SuperDocGuardedDocOperation;
  redo: SuperDocGuardedDocOperation;
  readonly [key: string]: SuperDocGuardedDocOperation;
}

/**
 * Guarded Document API surface passed to commands as `ctx.doc`. Browser
 * facades are worker-compatible, so command handlers should `await` Document
 * API calls. Reads are always allowed; writes are blocked during synchronous
 * event fanout to prevent mutation waterfalls — mutate from commands, not from
 * event handlers.
 *
 * The documented read entry points ({@link SuperDocGuardedDocQuery},
 * {@link SuperDocGuardedDocSelection}) and the common v2 mutation namespaces
 * are typed structurally. This is a public-package-owned mirror, intentionally
 * decoupled from the private Document API package; cast to your own richer
 * operation types when you need stricter input/output contracts.
 */
export interface SuperDocGuardedDoc {
  readonly query: SuperDocGuardedDocQuery;
  readonly selection: SuperDocGuardedDocSelection;
  readonly comments: SuperDocGuardedDocComments;
  readonly trackChanges: SuperDocGuardedDocTrackChanges;
  readonly text: SuperDocGuardedDocText;
  readonly history: SuperDocGuardedDocHistory;
  readonly [key: string]: unknown;
}

export interface SuperDocCommandState {
  disabled?: boolean;
  active?: boolean;
  label?: string;
}

export interface SuperDocCommandExecuteContext<TStorage = Record<string, unknown>> {
  payload?: unknown;
  doc: SuperDocGuardedDoc;
  storage: TStorage;
  snapshot: SuperDocExtensionSnapshot;
}

export interface SuperDocCommandStateContext<TStorage = Record<string, unknown>> {
  storage: TStorage;
  snapshot: SuperDocExtensionSnapshot;
}

/** A command an extension registers. Command ids must be namespaced. */
export interface SuperDocExtensionCommandRegistration<TStorage = Record<string, unknown>> {
  id: string;
  label?: string;
  /** Accelerator hint (e.g. `Mod-Shift-H`). Typed but inert in headless. */
  shortcut?: string;
  execute(context: SuperDocCommandExecuteContext<TStorage>): void | boolean | Promise<void | boolean>;
  getState?(context: SuperDocCommandStateContext<TStorage>): SuperDocCommandState;
}

export interface SuperDocExtensionCommandHandle {
  readonly id: string;
  execute(payload?: unknown): Promise<boolean | void>;
  getState(): SuperDocCommandState;
  observe(listener: (state: SuperDocCommandState) => void): () => void;
  invalidate(): void;
  unregister(): void;
}

export interface SuperDocCommandApi<TStorage = Record<string, unknown>> {
  register(registration: SuperDocExtensionCommandRegistration<TStorage>): SuperDocExtensionCommandHandle;
  execute(id: string, payload?: unknown): Promise<boolean | void>;
  get(id: string): SuperDocExtensionCommandHandle | null;
}

export interface SuperDocDecorationApi {
  register(provider: SuperDocDecorationProvider): SuperDocExtensionDisposable;
  invalidate(providerId: string): void;
}

// ---------------------------------------------------------------------------
// Visuals (easy authoring layer over the decoration provider runtime)
// ---------------------------------------------------------------------------

/**
 * A target a visual handle can paint. Accepts a live {@link SuperDocAnchor}, a
 * raw Document API location ({@link SuperDocAnchorTarget}) returned by
 * `ctx.doc.query.match(...)`, or a per-target override wrapper that layers a
 * custom class/data onto one target without changing the handle's defaults.
 */
export type SuperDocVisualTarget =
  | SuperDocAnchor
  | SuperDocAnchorTarget
  | {
      target: SuperDocAnchor | SuperDocAnchorTarget;
      className?: string;
      data?: SuperDocDecorationData;
    };

/**
 * A handle to one named visual layer. Owns an anchor collection and a
 * render-only decoration provider. Render-only and byte-neutral by
 * construction: visuals never persist to DOCX, bookmarks, comments, tracked
 * changes, raw XML, package parts, or save/reopen identity.
 */
export interface SuperDocVisualHandle {
  /** Fully-namespaced provider id this handle owns. */
  readonly id: string;
  /** Replace the painted targets and schedule a re-apply. */
  replace(targets: readonly SuperDocVisualTarget[]): void;
  /** Append targets and schedule a re-apply. */
  add(targets: readonly SuperDocVisualTarget[]): void;
  /** Drop all targets and schedule a re-apply. */
  clear(): void;
  /** Schedule a re-apply without changing targets (e.g. after a mutation). */
  invalidate(): void;
  /** Unregister the provider and dispose any anchors this handle created. */
  dispose(): void;
}

/** Options for {@link SuperDocVisualApi.highlight} / `decorate`. */
export interface SuperDocVisualOptions {
  /**
   * Paint-only class applied to matched content. Use background, color,
   * text-decoration, outline, or box-shadow — not layout properties such as
   * font-size, font-weight, display, position, margin, or padding.
   */
  className?: string;
  /** Sanitized data payload applied to matched content. */
  data?: SuperDocDecorationData;
  /**
   * `'text'` paints exact visible text ranges (default). `'block'` paints the
   * resolved block element. Text scope fails closed when the painted range
   * cannot be resolved safely; it never silently paints the whole block.
   */
  scope?: 'text' | 'block';
}

/**
 * Layout-affecting inline-box values in non-negative integer CSS pixels.
 * Padding, gaps, and borders participate in wrapping and pagination.
 */
export interface SuperDocInlineBoxLayout {
  paddingInline?: number | { start: number; end: number };
  paddingBlock?: number | { start: number; end: number };
  /** Logical spacing outside the range, paid once at each boundary. */
  gapBefore?: number;
  gapAfter?: number;
  /** Border width consumes layout space. */
  borderWidth?: number;
}

/** Paint-only appearance for a layout-aware inline box. */
export interface SuperDocInlineBoxAppearance {
  backgroundColor?: string;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  borderRadius?: number;
  color?: string;
}

/**
 * Options for {@link SuperDocVisualApi.inlineBox}. Inline boxes are
 * render-only and byte-neutral. They currently support LTR visible-text
 * targets only; unsupported directions and overlapping boxes fail closed.
 */
export interface SuperDocInlineBoxOptions {
  layout?: SuperDocInlineBoxLayout;
  appearance?: SuperDocInlineBoxAppearance;
  /** Additive paint-only class. It must not alter geometry. */
  className?: string;
  /** Sanitized data attributes stamped on the painted text leaves. */
  data?: SuperDocDecorationData;
  /** Paint-only cursor. */
  cursor?: 'default' | 'pointer' | 'text' | 'help';
  /** Wrapped ranges clone their box edges on every line. */
  wrap?: 'clone';
}

/**
 * The easy, beginner-facing visual authoring layer exposed as `ctx.visuals`.
 * Backed by the same render-only decoration runtime as
 * {@link SuperDocDecorationApi}, so visuals are SuperDoc-only and byte-neutral.
 *
 * @example
 * ```ts
 * const risks = ctx.visuals.highlight('risks', { className: 'acme-risk' });
 * const result = await ctx.doc.query.match({ select: { type: 'text', pattern: /risk/i } });
 * risks.replace(result.items.map((item) => item.target));
 *
 * const pills = ctx.visuals.inlineBox('citations', {
 *   layout: { paddingInline: 4, paddingBlock: 2, borderWidth: 1 },
 *   appearance: { backgroundColor: '#eef4ff', borderColor: '#8aa8d8', borderRadius: 8 },
 *   cursor: 'pointer',
 * });
 * pills.replace(citationTargets);
 * ```
 */
export interface SuperDocVisualApi {
  /** Create a highlight visual layer. The common beginner path. */
  highlight(id: string, options?: SuperDocVisualOptions): SuperDocVisualHandle;
  /** Create a neutral class/data visual layer (synonym of highlight). */
  decorate(id: string, options?: SuperDocVisualOptions): SuperDocVisualHandle;
  /**
   * Create a layout-aware box over anchored visible text. Local typing,
   * undo, and redo rebase its anchors; dispose the returned handle on cleanup.
   */
  inlineBox(id: string, options?: SuperDocInlineBoxOptions): SuperDocVisualHandle;
}

/** Advanced escape-hatch generic event surface. */
export interface SuperDocExtensionEventApi {
  on(
    type: 'mutation',
    filter: SuperDocMutationFilter,
    handler: (event: SuperDocMutationEvent) => void,
  ): SuperDocExtensionDisposable;
  on(type: 'ready' | 'sourceComplete' | 'disposed', handler: () => void): SuperDocExtensionDisposable;
  on(type: 'selection', handler: (event: SuperDocSelectionEvent) => void): SuperDocExtensionDisposable;
  on(type: 'paint', handler: (event: SuperDocPaintEvent) => void): SuperDocExtensionDisposable;
  on(type: 'save', handler: (event: SuperDocSaveEvent) => void): SuperDocExtensionDisposable;
}

/**
 * The context passed to {@link SuperDocExtension.activate}. Exposes isolated
 * storage, named event hooks, anchors, commands, decorations, diagnostics, and
 * a guarded Document API surface.
 */
export interface SuperDocExtensionContext<TStorage = Record<string, unknown>> {
  readonly id: string;
  readonly storage: TStorage;
  readonly disposables: SuperDocDisposableBag;
  readonly capabilities: SuperDocExtensionCapabilities;
  readonly diagnostics: SuperDocExtensionDiagnostics;
  readonly doc: SuperDocGuardedDoc;
  readonly anchors: SuperDocAnchorApi;
  readonly commands: SuperDocCommandApi<TStorage>;
  /** Easy visual authoring layer. Beginner path: `ctx.visuals.highlight(...)`. */
  readonly visuals: SuperDocVisualApi;
  /** Advanced render-only decoration provider surface. */
  readonly decorations: SuperDocDecorationApi;
  readonly events: SuperDocExtensionEventApi;
  getSnapshot(): SuperDocExtensionSnapshot;
  onReady(handler: () => void): SuperDocExtensionDisposable;
  onSourceComplete(handler: () => void): SuperDocExtensionDisposable;
  onSelection(handler: (event: SuperDocSelectionEvent) => void): SuperDocExtensionDisposable;
  onMutation(
    filter: SuperDocMutationFilter,
    handler: (event: SuperDocMutationEvent) => void,
  ): SuperDocExtensionDisposable;
  onPaint(handler: (event: SuperDocPaintEvent) => void): SuperDocExtensionDisposable;
  onSave(handler: (event: SuperDocSaveEvent) => void): SuperDocExtensionDisposable;
}

export type SuperDocExtensionActivateReturn =
  | void
  | SuperDocExtensionDisposable
  | SuperDocExtensionDisposable[]
  | Promise<void | SuperDocExtensionDisposable | SuperDocExtensionDisposable[]>;

/**
 * A v2 SuperDoc extension. Create one with {@link defineSuperDocExtension} and
 * pass it to `new SuperDoc({ selector, document, extensions: [...] })`.
 */
export interface SuperDocExtension<TStorage = Record<string, unknown>> {
  /** Namespaced extension id, e.g. `acme.highlights`. */
  id: string;
  /** Optional factory for the extension's isolated per-document storage. */
  storage?: () => TStorage;
  /** Called once per opened document after the Document API host is ready. */
  activate(context: SuperDocExtensionContext<TStorage>): SuperDocExtensionActivateReturn;
}

/** Alias retained for naming symmetry with other config storage types. */
export type SuperDocExtensionStorage<TStorage = Record<string, unknown>> = TStorage;

// ---------------------------------------------------------------------------
// Active-editor extension facet (public command/diagnostics access)
// ---------------------------------------------------------------------------

/** Diagnostic phase reported by the extension runtime. */
export type SuperDocExtensionPhase = 'activate' | 'event' | 'command' | 'decoration';

/**
 * Public, normalized extension diagnostic record exposed through
 * {@link SuperDocActiveEditorExtensionsDiagnostics.getSnapshot}. A
 * public-package-owned mirror of the runtime diagnostic record.
 */
export interface SuperDocExtensionDiagnostic {
  extensionId: string;
  phase: SuperDocExtensionPhase;
  level: 'warn' | 'error';
  message: string;
  /** event/command/provider id when applicable. */
  subjectId?: string;
  occurrences: number;
  /** Slow handler/provider duration in ms, when measured. */
  durationMs?: number;
  disabled?: boolean;
  data?: Record<string, unknown>;
}

/** Public read-only view of a registered command's enabled state. */
export interface SuperDocExtensionCommandStateView {
  enabled: boolean;
  reason?: string | null;
}

/** Public list entry describing a registered extension command. */
export interface SuperDocExtensionCommandListEntry {
  id: string;
  label?: string;
}

/**
 * Narrow command surface exposed on `activeEditor.extensions.commands`. Backed
 * internally by the private extension manager's command registry; command
 * handles stay private.
 */
export interface SuperDocActiveEditorExtensionsCommands {
  /** Execute a registered command by id, resolving with its result. */
  execute(id: string, payload?: unknown): Promise<boolean | void>;
  /** Read a command's enabled state, or null when the command is unknown. */
  getState(id: string): SuperDocExtensionCommandStateView | null;
  /** List the currently registered commands. */
  list(): readonly SuperDocExtensionCommandListEntry[];
}

/** Narrow diagnostics surface exposed on `activeEditor.extensions.diagnostics`. */
export interface SuperDocActiveEditorExtensionsDiagnostics {
  /** Snapshot of the extension runtime diagnostics produced so far. */
  getSnapshot(): readonly SuperDocExtensionDiagnostic[];
}

/**
 * Narrow, public active-editor extension facet exposed at
 * `superdoc.activeEditor.extensions`. Provides command execution and
 * diagnostics without binding consumers to the raw private extension manager.
 * `null` when no extensions are registered on the active document.
 */
export interface SuperDocActiveEditorExtensions {
  commands: SuperDocActiveEditorExtensionsCommands;
  diagnostics: SuperDocActiveEditorExtensionsDiagnostics;
}
