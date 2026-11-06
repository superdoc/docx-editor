import type { User } from './EditorConfig.js';
import type { Transaction } from 'prosemirror-state';
import type { Editor } from '../Editor.js';
import type { DefaultEventMap } from '../EventEmitter.js';
import type { PartChangedEvent } from '../parts/types.js';
import type { DocumentProtectionState, StoryLocator } from '@superdoc/document-api';
import type { FontResolutionRecord, FontLoadSummary } from '@superdoc/font-system';

/** Source of a protection state change. */
export type ProtectionChangeSource = 'init' | 'local-mutation' | 'remote-part-sync';

/**
 * Payload for `fonts-resolved` events.
 *
 * LEGACY / EARLY signal: emitted once at editor init, before any font has loaded, from
 * `converter.getDocumentFonts()` + a browser `canRenderFont()` probe. It answers "which
 * font names did the document declare, and which can't this browser render natively" - it
 * is NOT substitution- or load-aware. `unsupportedFonts` will list families (Calibri,
 * Arial, ...) that in fact render faithfully through a bundled substitute. For the
 * authoritative, load-settled picture listen to `fonts-changed` instead. Kept unchanged
 * for backward compatibility.
 */
export interface FontsResolvedPayload {
  documentFonts: string[];
  unsupportedFonts: string[];
}

/**
 * Payload for `fonts-changed` events: the authoritative, substitution- and load-aware
 * font report for the current document. Emitted after the load-before-measure gate
 * settles (`source: 'initial'`), again when a face arrives after a timed-out first paint
 * (`'late-load'`). `version` is the document's font-config epoch; it increases on every change.
 *
 * `documentFonts` are the document's DECLARED logical families (font table + theme +
 * defaults), deduped - not only the fonts visible on screen. (A separate rendered-fonts
 * view may follow.) `resolutions` maps each to its physical render family, the reason,
 * and its load status; `missingFonts` are the declared families with no faithful render
 * font loaded (the substitution-aware replacement for the legacy `unsupportedFonts`).
 */
export interface FontsChangedPayload {
  documentFonts: string[];
  resolutions: FontResolutionRecord[];
  missingFonts: string[];
  loadSummary: FontLoadSummary;
  /**
   * Why the report changed: `initial` (first resolve), `late-load` (a font finished loading and
   * bumped the font-config epoch), `config-change` (a runtime `superdoc.fonts` mutation - map/unmap/
   * add - on this document), or `render-change` (the set of rendered faces changed from ordinary
   * editing - e.g. the first Bold of a family introduces a new face - with no font load or config
   * mutation). Consumers filtering on `late-load` to mean "a font just loaded" should treat
   * `render-change` separately.
   */
  source: 'initial' | 'late-load' | 'config-change' | 'render-change';
  version: number;
}

/**
 * A structured element within a comment body.
 *
 * Comment bodies are stored as an array of elements, each representing
 * a paragraph or nested content node. This mirrors ProseMirror-style
 * node structure used throughout SuperDoc.
 */
export interface CommentElement {
  /** Node type (e.g. 'paragraph', 'text') */
  type: string;
  /** Text content for leaf nodes */
  text?: string;
  /** Nested child elements */
  content?: CommentElement[];
  /** Additional element properties */
  [key: string]: unknown;
}

/**
 * A comment object as emitted through editor events and accepted by `exportDocx()`.
 *
 * This is the canonical comment shape used across SuperDoc:
 * - Emitted via `commentsLoaded` and `commentsUpdate` events
 * - Accepted by `exportDocx({ comments })` for saving
 * - Produced by DOCX import in SuperConverter
 */
export interface Comment {
  /** Unique identifier for this comment */
  commentId: string;
  /** Timestamp when the comment was created (ms since epoch) */
  createdTime: number | null;
  /** Stable actor id of the comment author */
  creatorId?: string | null;
  /** Display name of the comment author */
  creatorName: string | null;
  /** Snapshot of the author's explicitly asserted Word identity. */
  creatorIdentity?: User['wordIdentity'];
  /** Original OOXML author label retained on import. */
  wordAuthorName?: string;
  /** Email address of the comment author */
  creatorEmail: string | null;
  /** Stable actor id of the resolver */
  resolvedById?: string | null;
  /** Avatar URL of the comment author */
  creatorImage?: string | null;
  /** Structured body content of the comment */
  elements: CommentElement[];
  /** Whether the comment thread is resolved/done */
  isDone: boolean;
  /** Parent comment ID for threaded replies */
  parentCommentId?: string | null;
  /** Original ID from the imported DOCX (used for round-trip fidelity) */
  importedId?: string | null;
  /** ProseMirror JSON representation of the comment body */
  commentJSON?: unknown;
  /** Plain text content of the comment */
  commentText?: string | null;
  /** Whether this is an internal/private comment */
  isInternal?: boolean;
  /** Whether this comment is associated with a tracked change */
  trackedChange?: boolean;
  /** The document/file ID this comment belongs to */
  fileId?: string | null;
  /** The document ID this comment belongs to */
  documentId?: string | null;
  /** Additional fields from the host application */
  [key: string]: unknown;
}

/**
 * Payload for comment-related events
 */
export interface CommentsPayload {
  /** A created comment or partial lifecycle/replay update. */
  comment?: Partial<Comment>;
  comments?: Comment[];
  [key: string]: unknown;
}

/**
 * Payload for comment locations/positions
 */
export interface CommentLocationsPayload {
  locations: Array<{
    commentId: string;
    position: { top: number; left: number; height: number; width: number };
    [key: string]: unknown;
  }>;
}

/**
 * Payload for pagination events
 */
export interface PaginationPayload {
  pages?: number;
  currentPage?: number;
  [key: string]: unknown;
}

/**
 * Payload for document mode change events
 */
export interface DocumentModeChangePayload {
  editor: Editor;
  documentMode: 'editing' | 'viewing' | 'suggesting';
}

/**
 * Payload for list definitions change
 */
export interface ListDefinitionsPayload {
  change?: unknown;
  numbering?: unknown;
  editor?: unknown;
}

/** Payload emitted with the `tracked-changes-changed` event. */
export interface TrackedChangesChangedPayload {
  editor: Editor;
  /** Stories whose tracked-change snapshot has changed. `undefined` means full rebuild. */
  stories?: StoryLocator[];
  /** Optional origin hint. */
  source?: string;
}

export interface SdtRef {
  id: string;
  tag?: string;
  alias?: string;
  controlType: string;
  scope: 'inline' | 'block';
}

export interface ContentControlFocusPayload {
  active: SdtRef;
  previous: SdtRef | null;
  /** Active control stack, innermost first (matches ui.contentControls activeIds). */
  activePath: SdtRef[];
  source: 'keyboard' | 'pointer';
}

export interface ContentControlBlurPayload {
  active: null;
  previous: SdtRef;
  /** Empty on blur: selection left all controls. */
  activePath: SdtRef[];
  source: 'keyboard' | 'pointer';
}

export interface ContentControlClickPayload {
  target: SdtRef;
  source: 'pointer';
}

/**
 * Event map for the Editor class
 */
export interface EditorEventMap extends DefaultEventMap {
  /** Called before editor creation */
  beforeCreate: [{ editor: Editor }];

  /** Called after editor creation */
  create: [{ editor: Editor }];

  /** Called when editor content updates */
  update: [{ editor: Editor; transaction: Transaction }];

  /** Called when selection updates */
  selectionUpdate: [{ editor: Editor; transaction: Transaction }];

  /** Called when a transaction is processed */
  transaction: [{ editor: Editor; transaction: Transaction; duration?: number }];

  /** Called when editor gets focus */
  focus: [{ editor: Editor; event: FocusEvent; transaction: Transaction }];

  /** Called when editor loses focus */
  blur: [{ editor: Editor; event: FocusEvent; transaction: Transaction }];

  /** Called when editor is destroyed */
  destroy: [];

  /**
   * Called when there's a content error. `error` is `unknown` because
   * the emit sites do not normalize uniformly (see `EditorConfig.onContentError`).
   * `disableCollaboration` is provided by the `insertContentAt` emit
   * path and absent on `Editor.ts`'s emit.
   */
  contentError: [{ editor: Editor; error: unknown; disableCollaboration?: () => void }];

  /** Called when tracked changes update */
  trackedChangesUpdate: [{ changes: unknown }];

  /** Called when comments update */
  commentsUpdate: [CommentsPayload];

  /** Called when comments are loaded */
  commentsLoaded: [{ editor: Editor; replacedFile?: boolean; comments: Comment[] }];

  /** Called when a comment is clicked */
  commentClick: [{ commentId: string; event?: MouseEvent }];

  /** Called when comment locations update */
  'comment-positions': [CommentLocationsPayload];

  /** Called when document is locked */
  locked: [{ locked: boolean; lockedBy?: string }];

  /** Called when collaboration is ready */
  collaborationReady: [{ editor: Editor; ydoc: unknown }];

  /** Called when pagination updates */
  paginationUpdate: [PaginationPayload];

  /** Called when document mode changes */
  documentModeChange: [DocumentModeChangePayload];

  /** Called when an exception occurs */
  exception: [{ error: Error; editor: Editor }];

  /** Called when list definitions change */
  'list-definitions-change': [ListDefinitionsPayload];

  /** Called once at init with declared font names + a native-render probe (legacy/early). */
  'fonts-resolved': [FontsResolvedPayload];

  /** Called with the authoritative substitution + load-aware font report once it settles and on change. */
  'fonts-changed': [FontsChangedPayload];

  /** Called when active content control changes to a new control (or A -> B). */
  contentControlFocus: [ContentControlFocusPayload];

  /** Called when selection leaves content controls (A -> null). */
  contentControlBlur: [ContentControlBlurPayload];

  /** Called on pointer click inside an active content control. */
  contentControlClick: [ContentControlClickPayload];

  // Document Lifecycle Events

  /** Called when a document is opened via editor.open() */
  documentOpen: [{ editor: Editor; sourcePath: string | null }];

  /** Called when a document is closed via editor.close() */
  documentClose: [{ editor: Editor }];

  /**
   * Called when the underlying document file has been replaced via `Editor.replaceFile()`.
   *
   * In collaboration mode, `replaceFile` writes the new converter snapshot directly
   * to the Y.Doc parts map without going through the local `mutateParts` pipeline,
   * so no `partChanged` event fires on the importing client. Other clients receive
   * the parts via the consumer → `mutateParts` → `partChanged` and refresh
   * automatically. The importer relies on this signal to refresh derived state
   * (such as the header/footer registry) that was bound to the previous document.
   */
  documentReplaced: [{ editor: Editor }];

  /** Called when page styles are updated */
  pageStyleUpdate: [{ pageMargins?: Record<string, unknown>; pageStyles: Record<string, unknown> }];

  /** Called when non-document.xml parts are mutated via the parts system. */
  partChanged: [PartChangedEvent];

  /** Called when document protection state changes (init, local mutation, or remote sync). */
  protectionChanged: [{ editor: Editor; state: DocumentProtectionState; source: ProtectionChangeSource }];

  /**
   * Story-aware tracked-change invalidation signal.
   *
   * Emitted by the host-level `TrackedChangeIndex` service whenever one or
   * more story caches are invalidated.
   */
  'tracked-changes-changed': [TrackedChangesChangedPayload];

  /** Called on pointer down (local only, not broadcast via collaboration) */
  pointerDown: [{ editor: Editor; event: PointerEvent }];

  /** Called on pointer up (local only, not broadcast via collaboration) */
  pointerUp: [{ editor: Editor; event: PointerEvent }];

  /** Called on right-click (local only, not broadcast via collaboration) */
  rightClick: [{ editor: Editor; event: PointerEvent }];
}
