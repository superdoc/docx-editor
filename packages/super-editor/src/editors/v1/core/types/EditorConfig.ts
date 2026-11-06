import type { EditorState, Transaction } from 'prosemirror-state';
import type { XmlFragment as YXmlFragment } from 'yjs';
import type { Editor } from '../Editor.js';
import type { Extension } from '../Extension.js';
import type { Node as EditorNode } from '../Node.js';
import type { Mark as EditorMark } from '../Mark.js';
import type { EditorRenderer } from '../renderers/EditorRenderer.js';
import type {
  FontsResolvedPayload,
  FontsChangedPayload,
  Comment,
  CommentsPayload,
  CommentLocationsPayload,
  ListDefinitionsPayload,
} from './EditorEvents.js';
import type { BundledFontSelection, FontAssetUrlResolver } from '@superdoc/font-system';

/**
 * One physical font face to register from a URL source.
 */
export interface FontFaceConfig {
  /** Plain URL the browser loads, e.g. `/fonts/Gelasio-Regular.woff2` or `https://cdn/...`. */
  source: string;
  /** Font weight (for example 400, 700, or `bold`); defaults to 400. */
  weight?: number | string;
  /** Font style, such as `normal` or `italic`; defaults to `normal`. */
  style?: string;
}

/**
 * Physical font family a document can map to and render with.
 */
export interface FontFamilyConfig {
  /** Physical family name used by CSS and the font resolver, e.g. `Gelasio`. */
  family: string;
  /** URL-backed faces available for this family. */
  faces: FontFaceConfig[];
}

/**
 * Configuration for SuperDoc's font system.
 */
export interface FontsConfig {
  /** Custom physical families to register before the first layout measure. */
  families?: FontFamilyConfig[];
  /** Logical Word family -> physical render family mappings for this document. */
  map?: Record<string, string>;
  /**
   * Base URL the bundled font `.woff2` are served from, e.g. `/fonts/` or
   * `https://cdn.example.com/superdoc-fonts/v1/`, when you self-host the
   * `@superdoc-dev/fonts` faces. Prefer `@superdoc-dev/fonts` (bundler) or its
   * `superdoc-fonts.min.js` browser build (CDN), which resolve these URLs for you.
   */
  assetBaseUrl?: string;
  /**
   * Resolve each bundled asset's URL for signed / versioned / tenant-specific hosting.
   * Synchronous (font resolution stays deterministic). Takes precedence over `assetBaseUrl`.
   */
  resolveAssetUrl?: FontAssetUrlResolver;
  /**
   * Curate which bundled families this document advertises and substitutes to, by LOGICAL Word name
   * (e.g. `"Calibri"`). Applies only when the pack is configured; it narrows the rich set, it does
   * not enable it. Prefer setting this with `createSuperDocFonts({ include / exclude })` from
   * `@superdoc-dev/fonts` rather than by hand. Does not affect customer fonts ({@link families} /
   * {@link map}), which are always honored.
   */
  bundled?: BundledFontSelection;
}
import type { ProseMirrorJSON } from './EditorTypes.js';

/**
 * Context provided to a link popover resolver when a link is clicked.
 * Contains all information needed to decide which popover to show.
 */
export interface LinkPopoverContext {
  /** The editor instance */
  editor: Editor;
  /** The href attribute of the clicked link */
  href: string;
  /** The target attribute of the clicked link */
  target: string | null;
  /** The rel attribute of the clicked link */
  rel: string | null;
  /** The title/tooltip attribute of the clicked link */
  tooltip: string | null;
  /** The clicked anchor DOM element */
  element: HTMLAnchorElement;
  /** X coordinate of the click */
  clientX: number;
  /** Y coordinate of the click */
  clientY: number;
  /** Whether this is an anchor link (href starts with #) */
  isAnchorLink: boolean;
  /** Current document mode ('editing', 'viewing', 'suggesting') */
  documentMode: string;
  /** Computed popover position relative to editor surface */
  position: { left: string; top: string };
  /** Close the popover programmatically */
  closePopover: () => void;
}

/**
 * Context passed to an external (framework-agnostic) popover renderer.
 * The `render` function receives a raw DOM container and is responsible for
 * mounting its own UI (React, Svelte, vanilla JS, etc.).
 */
export interface ExternalPopoverRenderContext {
  /** Empty DOM container positioned where the popover should appear */
  container: HTMLElement;
  /** Call to close the popover and clean up */
  closePopover: () => void;
  /** The editor instance */
  editor: Editor;
  /** The href of the clicked link */
  href: string;
}

/**
 * Resolution returned by a link popover resolver.
 * - `{ type: 'default' }` — use the built-in LinkInput popover.
 * - `{ type: 'none' }` — suppress the popover entirely (resolver can perform side effects like navigation).
 * - `{ type: 'custom', component, props }` — render a Vue component in the popover.
 *   `editor` and `closePopover` are auto-injected into props.
 * - `{ type: 'external', render }` — mount framework-agnostic UI into a raw DOM container.
 *   Return `{ destroy }` for cleanup when the popover closes.
 */
export type LinkPopoverResolution =
  | { type: 'default' }
  | { type: 'none' }
  | { type: 'custom'; component: unknown; props?: Record<string, unknown> }
  | { type: 'external'; render: (ctx: ExternalPopoverRenderContext) => { destroy?: () => void } | void };

/**
 * Resolver function for customizing the link click popover.
 * Must be synchronous — do not return a Promise.
 *
 * @returns A resolution object, or `null`/`undefined` to use the default popover.
 */
export type LinkPopoverResolver = (ctx: LinkPopoverContext) => LinkPopoverResolution | null | undefined;

/**
 * Configuration for a font option in the toolbar font picker.
 *
 * Each entry represents a selectable font that appears in the toolbar dropdown.
 * `label` is the value applied to the selected text and used for active-state
 * matching, so it must equal the first family name in `key`. `key` is the
 * stable option identity and drives the row's preview `font-family` so each
 * row renders in its own typeface.
 */
export interface FontConfig {
  /**
   * Stable identity for the option. Used as the preview font-family for the
   * dropdown row. Typically a full CSS stack (e.g. `'Cambria, serif'`).
   */
  key: string;
  /**
   * Display name shown in the dropdown, and the value applied to the selected
   * text. Must match the first family name in `key` for active-state tracking.
   */
  label: string;
  /** Font weight (e.g. 400 for normal, 700 for bold) */
  fontWeight?: number;
  /**
   * Optional per-row render overrides. `props.style.fontFamily` overrides the
   * row's preview font independently of `key`.
   */
  props?: {
    style?: {
      fontFamily?: string;
    };
    'data-item'?: string;
  };
}

/**
 * User information for collaboration
 */
export interface User {
  /** Stable actor id for authorship and ownership checks. */
  id?: string | null;
  /** The user's name */
  name?: string;

  /**
   * The user's email. Optional, and may be `null` when SuperDoc fell back
   * to the built-in default user without an email; the runtime has always
   * exposed `null` here, so the typedef accepts it explicitly. Consumers
   * must narrow before performing string operations on this field.
   */
  email?: string | null;

  /** Opaque Word provider identity for new comments. Null opts out; never inferred from id or email. */
  wordIdentity?: { providerId: string; userId: string } | null;

  /** The user's photo URL */
  image?: string | null;

  /**
   * Explicit permission-range principal identifiers for this user.
   * When set, these are used to match against `w:ed` values on permission range
   * markers instead of deriving principals from the email address.
   *
   * Each entry should match the exact string used in the document's
   * `w:permStart` `w:ed` attribute (e.g., `"contoso.com\\jdoe"`).
   */
  permissionPrincipals?: string[];
}

/**
 * Field value for document fields
 */
export interface FieldValue {
  /** The id of the input field */
  input_id: string;

  /** The value to insert into the field */
  input_value: string;
}

/**
 * A JSON representation of a docx node
 */
export interface DocxNode {
  [key: string]: unknown;
}

/**
 * Single docx file entry extracted from the archive
 */
export interface DocxFileEntry {
  name: string;
  content: string;
}

/**
 * Document view layout values - mirrors OOXML ST_View (ECMA-376 §17.18.102)
 * - 'print': Print Layout View - displays document as it prints (default)
 * - 'web': Web Page View - content reflows to fit container (mobile/accessibility)
 */
export type ViewLayout = 'print' | 'web';

/**
 * Document view options for controlling how the document is displayed.
 * Mirrors OOXML document view settings.
 */
export interface ViewOptions {
  /**
   * Document view layout (OOXML ST_View compatible)
   * - 'print': Fixed page width, displays document as it prints (default)
   * - 'web': Content reflows to fit container width
   * @default 'print'
   */
  layout?: ViewLayout;
}

/**
 * Awareness interface - matches y-protocols Awareness.
 * All properties optional to support various provider implementations.
 */
export interface Awareness {
  clientID?: number;
  getStates?(): Map<number, Record<string, unknown>>;
  setLocalStateField?(field: string, value: unknown): void;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Collaboration provider interface.
 * Accepts any Yjs-compatible provider (HocuspocusProvider, LiveblocksYjsProvider, TiptapCollabProvider, etc.)
 *
 * `on`/`off` use `(event: string, handler: (...args: unknown[]) => void)`
 * to match the established pattern on `Awareness` above and the internal
 * `ProviderEventHandler` cast in `helpers/collaboration-provider-sync.ts`.
 * Consumers narrow `args` before reading; this is a TS-only tightening
 * (no runtime change) that drains 32 SD-3213 supported-root any[]
 * findings on EditorConfig.d.ts in a single source edit.
 */
export interface CollaborationProvider {
  awareness?: Awareness | null;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
  disconnect?(): void;
  destroy?(): void;
  /** Whether provider is synced - some use `synced`, others `isSynced` */
  synced?: boolean;
  isSynced?: boolean;
}

/**
 * Any extension supported by the editor (node, mark, or extension)
 */
export type EditorExtension =
  | Extension<Record<string, unknown>, Record<string, unknown>>
  | EditorNode<Record<string, unknown>, Record<string, unknown>>
  | EditorMark<Record<string, unknown>, Record<string, unknown>>;

/**
 * Permission resolver parameters
 */
export interface PermissionParams {
  permission: string;
  role?: string;
  isInternal?: boolean;
  comment?: Comment | null;
  trackedChange?: unknown | null;
}

/**
 * Comment highlight color configuration
 */
export interface CommentHighlightColors {
  /** Base highlight color for internal comments */
  internal?: string;
  /** Base highlight color for external comments */
  external?: string;
  /** Active highlight color override for internal comments */
  activeInternal?: string;
  /** Active highlight color override for external comments */
  activeExternal?: string;
}

/**
 * Comment highlight opacity configuration
 */
export interface CommentHighlightOpacity {
  /** Opacity for active comment highlight (0-1) */
  active?: number;
  /** Opacity for inactive comment highlight (0-1) */
  inactive?: number;
}

/**
 * Comment configuration options
 */
export interface CommentConfig {
  /** Comment highlight colors */
  highlightColors?: CommentHighlightColors;
  /** Comment highlight opacity values */
  highlightOpacity?: CommentHighlightOpacity;
}

/**
 * Editor configuration options
 */
export interface EditorOptions {
  /** The container element for the editor */
  element?: HTMLElement | null;

  /** CSS selector for the editor container */
  selector?: string | null;

  /** Whether the editor is running in headless mode */
  isHeadless?: boolean;

  /** Optional Document instance for HTML/Markdown import/export in headless environments (e.g. JSDOM) */
  document?: Document | null;

  /** Mock document for testing */
  mockDocument?: Document | null;

  /** Mock window for testing */
  mockWindow?: Window | null;

  /** XML/JSON/HTML content */
  content?: string | DocxFileEntry[] | Record<string, unknown> | null;

  /** Current user information */
  user?: User | null;

  /** List of users for collaboration */
  users?: User[];

  /** Media configuration */
  media?: Record<string, unknown>;

  /** Media files */
  mediaFiles?: Record<string, unknown>;

  /** Font configuration */
  fonts?: Record<string, unknown>;

  /** Document mode ('editing', 'viewing', 'suggesting') */
  documentMode?: string;

  /** Editor mode ('docx', 'text', 'html') */
  mode?: 'docx' | 'text' | 'html';

  /** User role ('editor', 'viewer', 'suggester') */
  role?: string;

  /** Available colors */
  colors?: string[];

  /** Document converter */
  converter?: unknown | null;

  /** Source of the file (File/Blob in browser, Buffer/Uint8Array in Node.js) */
  fileSource?: File | Blob | Buffer | Uint8Array | null;

  /** Initial editor state */
  initialState?: EditorState | null;

  /** Unique document identifier */
  documentId?: string | null;

  /** Editor extensions */
  extensions?: EditorExtension[];

  /** Whether the editor is editable */
  editable?: boolean;

  /**
   * Allow text selection in viewing mode.
   * When true, users can select and copy text while in viewing mode,
   * but editing (typing, paste, delete) remains blocked.
   * @default false
   */
  allowSelectionInViewMode?: boolean;

  /** Editor properties */
  editorProps?: Record<string, unknown>;

  /** Parsing options */
  parseOptions?: Record<string, unknown>;

  /** Core extension options */
  coreExtensionOptions?: Record<string, unknown>;

  /** Whether to enable input rules */
  enableInputRules?: boolean;

  /** Whether comments are enabled */
  isCommentsEnabled?: boolean;

  /** Comment highlight configuration */
  comments?: CommentConfig;

  /**
   * Public SuperDoc module configuration accepted by direct/headless
   * `Editor.open()` callers. SuperDoc app config normalizes this before it
   * reaches the editor; CLI/SDK headless callers pass it directly.
   */
  modules?: {
    trackChanges?: EditorOptions['trackedChanges'] | null;
  };

  /**
   * Track-changes runtime configuration forwarded from the SuperDoc-level
   * `modules.trackChanges` config. Read by the TrackChanges extension and
   * by the SuperConverter during import. Fields are all optional; missing
   * ones fall back to defaults resolved at SuperDoc construction time.
   */
  trackedChanges?: {
    visible?: boolean;
    mode?: 'review' | 'original' | 'final' | 'off';
    enabled?: boolean;
    /**
     * How a tracked replacement (ins + del) surfaces in the UI and API.
     * `'paired'` (default) groups both halves under one id and resolves them
     * together. `'independent'` gives each half its own id, matching the
     * Microsoft Word / ECMA-376 §17.13.5 revision model.
     */
    replacements?: 'paired' | 'independent';
  };

  /** Whether this is a new file */
  isNewFile?: boolean;

  /** Editor scale/zoom */
  scale?: number;

  /**
   * Document view options (OOXML ST_View compatible).
   * Controls how the document is displayed.
   * @example { layout: 'web' } // Content reflows to fit container
   */
  viewOptions?: ViewOptions | null;

  /** Whether annotations are enabled */
  annotations?: boolean;

  /** Whether this is an internal editor */
  isInternal?: boolean;

  /** External extensions */
  externalExtensions?: EditorExtension[];

  /** Whether this editor runs as a linked child editor */
  isChildEditor?: boolean;

  /** Whether the document content was generated from schema */
  loadFromSchema?: boolean;

  /** Whether to skip creating the ProseMirror view (layout mode) */
  skipViewCreation?: boolean;

  /** Optional renderer implementation (defaults to ProseMirrorRenderer in DOM environments) */
  renderer?: EditorRenderer | null;

  /** Numbering configuration */
  numbering?: Record<string, unknown>;

  /** Whether this is a header or footer editor */
  isHeaderOrFooter?: boolean;

  /** Concrete header/footer surface kind for child editors */
  headerFooterType?: 'header' | 'footer';

  /** OOXML relationship id for this header/footer part (e.g. `rId7`). */
  headerFooterRefId?: string;

  /** Current page number for PAGE field rendering in story editors */
  currentPageNumber?: number;

  /** Current formatted PAGE display text for story editors */
  currentPageNumberText?: string;

  /** Current numeric PAGE display value for story editor field-local formatting */
  currentPageDisplayNumber?: number;

  /** Current PAGE chapter prefix for story editor field-local formatting */
  currentPageChapterNumberText?: string;

  /** Current PAGE chapter separator for story editor field-local formatting */
  currentPageChapterSeparator?: 'hyphen' | 'period' | 'colon' | 'emDash' | 'enDash';

  /** Total document page count for NUMPAGES field rendering in story editors */
  totalPageCount?: number;

  /** Current section page count for SECTIONPAGES field rendering in story editors */
  sectionPageCount?: number;

  /** Optional pagination metadata */
  lastSelection?: unknown | null;

  /** Prevent default styles from being applied in docx mode */
  suppressDefaultDocxStyles?: boolean;

  /** Provided JSON to override content with */
  jsonOverride?: ProseMirrorJSON | null;

  /** HTML content to initialize the editor with */
  html?: string;

  /** Markdown content to initialize the editor with */
  markdown?: string;

  /**
   * Callback invoked with unsupported HTML elements that were dropped during import.
   * When provided, `console.warn` is NOT emitted automatically.
   */
  onUnsupportedContent?: ((items: { tagName: string; outerHTML: string; count: number }[]) => void) | null;

  /**
   * When true and no `onUnsupportedContent` callback is provided,
   * emits a `console.warn` with unsupported items dropped during import.
   * Default: false (silent).
   */
  warnOnUnsupportedContent?: boolean;

  /** Whether to enable debug mode */
  isDebug?: boolean;

  /** Whether to disable the context menu (slash menu and right-click menu) */
  disableContextMenu?: boolean;

  /** Docx xml updated by User */
  customUpdatedFiles?: Record<string, string>;

  /** Whether header/footer has changed */
  isHeaderFooterChanged?: boolean;

  /** Whether custom XML has changed */
  isCustomXmlChanged?: boolean;

  /** Focus target element */
  focusTarget?: HTMLElement | null;

  /** Parent editor (for header/footer editors) */
  parentEditor?: Editor | null;

  /** Collaborative Y.Doc reference - accepts any yjs Doc instance */
  ydoc?: unknown;

  /** Y.js XML fragment for collaborative editing */
  fragment?: YXmlFragment | null;

  /** Collaboration provider */
  collaborationProvider?: CollaborationProvider | null;

  /** Whether the collaboration provider finished syncing */
  collaborationIsReady?: boolean;

  /** Whether comments should be loaded after collaboration replace */
  shouldLoadComments?: boolean;

  /** Whether the current file was replaced */
  replacedFile?: boolean;

  /** Called before editor creation */
  onBeforeCreate?: (params: { editor: Editor }) => void;

  /** Called after editor creation */
  onCreate?: (params: { editor: Editor }) => void;

  /** Called when editor content updates */
  onUpdate?: (params: { editor: Editor; transaction: Transaction }) => void;

  /** Called when selection updates */
  onSelectionUpdate?: (params: { editor: Editor }) => void;

  /** Called when a transaction is processed */
  onTransaction?: (params: { editor: Editor; transaction: Transaction }) => void;

  /** Called when editor gets focus */
  onFocus?: (params: { editor: Editor; event: FocusEvent }) => void;

  /** Called when editor loses focus */
  onBlur?: (params: { editor: Editor; event: FocusEvent }) => void;

  /** Called when editor is destroyed */
  onDestroy?: () => void;

  /**
   * Called when there's a content error. `error` is `unknown` because
   * the emit sites do not normalize uniformly: `Editor.ts` wraps caught
   * values in `Error`, but `insertContentAt` forwards the raw caught
   * value. `disableCollaboration` is provided by the insertion path so
   * callers can recover by detaching collaboration; absent on the
   * Editor.ts emit.
   */
  onContentError?: (params: { editor: Editor; error: unknown; disableCollaboration?: () => void }) => void;

  /** Called when tracked changes update */
  onTrackedChangesUpdate?: (params: { changes: unknown }) => void;

  /** Called when comments update */
  onCommentsUpdate?: (params: CommentsPayload) => void;

  /** Called when comments are loaded */
  onCommentsLoaded?: (params: { editor: Editor; replacedFile?: boolean; comments: Comment[] }) => void;

  /** Called when a comment is clicked */
  onCommentClicked?: (params: { commentId: string; event?: MouseEvent }) => void;

  /** Called when comment locations update */
  onCommentLocationsUpdate?: (params: CommentLocationsPayload) => void;

  /** Called when document is locked */
  onDocumentLocked?: (params: { locked: boolean; lockedBy?: string }) => void;

  /** Called on first render */
  onFirstRender?: () => void;

  /** Called when collaboration is ready */
  onCollaborationReady?: (params: { editor: Editor; ydoc: unknown }) => void;

  /**
   * Called when an exception occurs.
   * Return `true` to mark the exception as handled and suppress default logging
   * for recoverable flows such as password prompts.
   */
  onException?: (params: { error: Error; editor: Editor; code?: string }) => boolean | void;

  /** Called when list definitions change */
  onListDefinitionsChange?: (params: ListDefinitionsPayload) => void;

  /** Called when all fonts used in the document are determined */
  onFontsResolved?: ((payload: FontsResolvedPayload) => void) | null;

  /** Called with the authoritative substitution + load-aware font report once it settles and on change. */
  onFontsChanged?: ((payload: FontsChangedPayload) => void) | null;

  /** Handler for image uploads - async (file) => url */
  handleImageUpload?: ((file: File) => Promise<string>) | null;

  /** Host-provided permission hook */
  permissionResolver?: ((params: PermissionParams) => boolean | undefined) | null;

  /** Called on pointer down events (local only, not broadcast via collaboration) */
  onPointerDown?: (params: { editor: Editor; event: PointerEvent }) => void;

  /** Called on pointer up events (local only, not broadcast via collaboration) */
  onPointerUp?: (params: { editor: Editor; event: PointerEvent }) => void;

  /** Called on right-click (local only, not broadcast via collaboration) */
  onRightClick?: (params: { editor: Editor; event: PointerEvent }) => void;

  /**
   * Custom resolver for the link click popover.
   * Called when a user clicks a link to determine which popover to show.
   * Must be synchronous.
   */
  linkPopoverResolver?: LinkPopoverResolver;

  /** Password for opening encrypted .docx files. Not stored after initial load. */
  password?: string;

  /**
   * When true, defers document initialization until open() is called.
   * This enables the new document lifecycle API where:
   * - Constructor only initializes core services (extensions, schema)
   * - open() loads the document
   * - close() unloads the document
   * - Editor instance can be reused for multiple documents
   *
   * Default is false for backward compatibility.
   * The static Editor.open() factory sets this automatically.
   */
  deferDocumentLoad?: boolean;

  /**
   * License key for billing and telemetry authentication.
   */
  licenseKey?: string | null;

  /**
   * Telemetry configuration for tracking document opens.
   * When enabled, sends document open events for usage-based billing.
   */
  telemetry?: {
    /** Whether telemetry is enabled */
    enabled: boolean;
    /** Custom telemetry endpoint (optional) */
    endpoint?: string;
    /** Custom metadata to include with telemetry events (optional) */
    metadata?: Record<string, unknown>;
    /**
     * @deprecated Use root-level `licenseKey` instead. If both are provided, root-level has priority.
     */
    licenseKey?: string | null;
  } | null;
}
