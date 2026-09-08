import '../style.css';

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { markRaw, nextTick, toRaw } from 'vue';
import type { HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { ContentControlType } from '@superdoc/document-api';
import JSZip from 'jszip';

import { DOCX, PDF, HTML, getActorIdentityKey, normalizeActorEmail } from '@superdoc/common';
import { DOM_CLASS_NAMES } from '@superdoc/dom-contract';
import { SuperComments } from '../components/CommentsLayer/commentsList/super-comments-list.js';
import { computeAppliedFitZoom, resolveFitWidthOptions } from '../composables/use-viewport-fit.js';
import { createSuperdocVueApp } from './create-app.js';
import { shuffleArray } from '@superdoc/common/collaboration/awareness';
import { createDownload, cleanName } from './helpers/export.js';
import { initCollaborationComments } from './collaboration/helpers.js';
import { setupAwarenessHandler } from './collaboration/collaboration.js';
import {
  resolveV2CollaborationTarget,
  type LegacyCollaborationLike,
  type NormalizedV2CollaborationTarget,
} from './collaboration/resolve-v2-collaboration-target.js';
import { createV2AwarenessDiffer, type V2AwarenessSnapshotLike } from './collaboration/v2-awareness-bridge.js';
import { documentByteSourceToBlob, isDocumentByteSource, normalizeDocumentEntry } from './helpers/file.js';
import { isAllowed } from './collaboration/permissions.js';
import { Whiteboard } from './whiteboard/Whiteboard';
import { WhiteboardRenderer } from './whiteboard/WhiteboardRenderer';
import { SurfaceManager } from './surface-manager.js';
import { createDeprecatedEditorProxy } from '../helpers/deprecation.js';
import { normalizeTrackChangesConfig } from './helpers/normalize-track-changes-config.js';
import { DEFAULT_SUPERDOC_USER as DEFAULT_USER, normalizeSuperDocUser } from './helpers/normalize-user.js';
import { normalizeUiConfig } from './config/normalize-ui-config.js';
import { normalizeInteractionConfig } from './config/normalize-interaction-config.js';
import { normalizeSurfacesConfig } from './config/normalize-surfaces-config.js';
import { normalizeCommentsUiConfig } from '../helpers/comment-small-screen.js';
import { EditorRuntimeRegistry } from './editor-runtime/editor-runtime-registry.js';
import type { EditorRuntimeFocusOptions } from './editor-runtime/types.js';
import { createBuiltInToolbar } from '../internal/toolbar/index.js';
import { translateExportDiagnostic } from '../internal/diagnostics/translate-diagnostic.js';
import { createSuperDocUI } from '../public/ui/create-super-doc-ui.js';
import type { BorrowedSuperDocUI, SelectionSlice, SuperDocUI } from '../public/ui/types.js';
import { loadDefaultV2IntegrationOrFallback } from './v2-integration/v2-integration.js';

/**
 * Matches painted structured-content frames by either primary or container
 * identity. DomPainter stamps `data-sdt-type` / `data-sdt-id` from attrs.sdt and
 * `data-sdt-container-type` / `data-sdt-container-id` from attrs.containerSdt;
 * chrome from containerSdt alone omits the primary keys.
 */
const STRUCTURED_CONTENT_FRAME_SELECTOR = [
  '[data-sdt-type="structuredContent"][data-sdt-id]',
  '[data-sdt-type="structuredContent"][data-sdt-container-id]',
  '[data-sdt-container-type="structuredContent"][data-sdt-container-id]',
].join(', ');

const CONTENT_CONTROL_POINTER_END_WINDOW_MS = 800;

const nativeBlobSizeGetter =
  typeof Blob === 'function' ? Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get : undefined;

const isBlobAcrossRealms = (value: unknown): value is Blob => {
  if (!nativeBlobSizeGetter) return false;

  try {
    nativeBlobSizeGetter.call(value);
    return true;
  } catch {
    return false;
  }
};

function isContentControlNonSelectionKeyDown(event: KeyboardEvent): boolean {
  if (event.key === 'Alt' || event.key === 'Control' || event.key === 'Meta' || event.key === 'Shift') return true;

  if (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    !event.altKey &&
    (event.code === 'Digit8' || event.key === '8' || event.key === '*')
  ) {
    return true;
  }

  return (event.ctrlKey || event.metaKey) && ['b', 'c', 'f', 'i', 's', 'u'].includes(event.key.toLowerCase());
}

// 24 visually distinct hex colors for awareness cursor assignment.
// Large enough to minimize collisions (~4% for two users) while staying
// within the hex color format expected by awareness cursor consumers.
const DEFAULT_AWARENESS_PALETTE = Object.freeze([
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#FFA07A',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E2',
  '#F1948A',
  '#82E0AA',
  '#F8C471',
  '#AED6F1',
  '#D7BDE2',
  '#A3E4D7',
  '#F0B27A',
  '#AEB6BF',
  '#E74C3C',
  '#2ECC71',
  '#3498DB',
  '#E67E22',
  '#1ABC9C',
  '#9B59B6',
  '#34495E',
  '#F39C12',
]);

// Structural shape of the `superdoc.toolbar` handle. On V2 this is backed by
// the internal toolbar authority (`src/internal/toolbar`), which projects the
// single command controller and maps legacy built-in item names through the one
// compatibility catalog. The members stay optional + permissive so the field
// can hold the authority without leaking its internal types into the public
// surface, and so the phase-3 rendered shell can extend it. `destroy` is
// required — every toolbar authority implements it and `SuperDoc.destroy()`
// calls it unconditionally on a non-null handle.
type ToolbarLike = {
  activeEditor?: unknown;
  setActiveEditor?: (editor: unknown) => void;
  getToolbarItemByName?: (name: string) => unknown;
  getToolbarItemByGroup?: (group: string) => unknown;
  updateToolbarState?: () => void;
  on?: (event: string, handler: (payload?: unknown) => void) => void;
  off?: (event: string, handler: (payload?: unknown) => void) => void;
  destroy: () => void;
};

type ProviderEventHandler = (...args: unknown[]) => void;

type TrackedChangesRenderMode = 'review' | 'original' | 'final' | 'off';

const VIEWING_TRACKED_CHANGES_MODES: readonly ViewingTrackedChangesMode[] = ['original', 'markup', 'final'];
const TRACKED_CHANGES_RENDER_MODES: readonly TrackedChangesRenderMode[] = ['review', 'original', 'final', 'off'];

function isViewingTrackedChangesMode(value: unknown): value is ViewingTrackedChangesMode {
  return VIEWING_TRACKED_CHANGES_MODES.includes(value as ViewingTrackedChangesMode);
}

function viewingModeToRenderMode(mode: ViewingTrackedChangesMode): 'review' | 'original' | 'final' {
  return mode === 'markup' ? 'review' : mode;
}

function isTrackedChangesRenderMode(value: unknown): value is TrackedChangesRenderMode {
  return TRACKED_CHANGES_RENDER_MODES.includes(value as TrackedChangesRenderMode);
}

function getConfiguredTrackedChangesRenderMode(config: Config): TrackedChangesRenderMode | null {
  const moduleMode = config.modules?.trackChanges?.mode;
  if (isTrackedChangesRenderMode(moduleMode)) return moduleMode;

  const layoutMode = (config.layoutEngineOptions?.trackedChanges as { mode?: unknown } | undefined)?.mode;
  return isTrackedChangesRenderMode(layoutMode) ? layoutMode : null;
}

function resolveViewingState(config: Config, compatibilityRenderMode: TrackedChangesRenderMode | null) {
  const viewing = config.viewing;
  const canonicalTrackedChanges = isViewingTrackedChangesMode(viewing?.trackedChanges) ? viewing.trackedChanges : null;
  const renderMode = canonicalTrackedChanges
    ? viewingModeToRenderMode(canonicalTrackedChanges)
    : compatibilityRenderMode
      ? compatibilityRenderMode
      : config.trackChanges?.visible === true
        ? 'review'
        : 'original';

  return {
    comments: typeof viewing?.comments === 'boolean' ? viewing.comments : config.comments?.visible === true,
    renderMode,
    trackChangesVisible: canonicalTrackedChanges
      ? canonicalTrackedChanges === 'markup'
      : config.trackChanges?.visible === true,
  };
}

async function createZip(blobs: Blob[], fileNames: string[]): Promise<Blob> {
  const zip = new JSZip();
  blobs.forEach((blob, index) => {
    zip.file(fileNames[index], blob);
  });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function isCollaborationProviderSynced(provider: CollaborationProvider | null | undefined): boolean {
  return Boolean(provider && (provider.synced === true || provider.isSynced === true));
}

function markProviderSynced(provider: CollaborationProvider): void {
  try {
    provider.synced = true;
  } catch {
    // Some providers expose readonly getters.
  }
  try {
    provider.isSynced = true;
  } catch {
    // Some providers expose readonly getters.
  }
}

function onCollaborationProviderSynced(
  provider: CollaborationProvider | null | undefined,
  onSynced: () => void,
): () => void {
  if (!provider) return () => {};

  if (isCollaborationProviderSynced(provider)) {
    onSynced();
    return () => {};
  }

  const on = typeof provider.on === 'function' ? provider.on.bind(provider) : null;
  const off = typeof provider.off === 'function' ? provider.off.bind(provider) : null;
  if (!on) {
    onSynced();
    return () => {};
  }

  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    off?.('synced', handleSynced as ProviderEventHandler);
    off?.('sync', handleSync as ProviderEventHandler);
  };
  const finish = () => {
    if (settled) return;
    cleanup();
    onSynced();
  };
  const handleSynced = () => {
    markProviderSynced(provider);
    finish();
  };
  const handleSync = (synced?: unknown) => {
    if (synced === false) return;
    if (synced === true || isCollaborationProviderSynced(provider)) {
      markProviderSynced(provider);
      finish();
    }
  };

  on('synced', handleSynced as ProviderEventHandler);
  on('sync', handleSync as ProviderEventHandler);

  if (isCollaborationProviderSynced(provider)) {
    finish();
  }

  return cleanup;
}

// TS-native type imports for the types this file annotates against.
// The corresponding payload shapes for the SuperDocEventMap are
// declared as interfaces below.
import type {
  AwarenessState,
  AwarenessUser,
  CanPerformPermissionParams,
  CollaborationConfig,
  CollaborationProvider,
  Comment,
  Config,
  ContentControlActiveChangePayload,
  ContentControlClickPayload,
  ContentControlRef,
  DocumentMode,
  DocumentFontOption,
  Editor,
  EditorUpdateEvent,
  ExportParams,
  FontFamilyOption,
  FontResolutionRecord,
  FontsChangedPayload,
  FontsResolvedPayload,
  FontFamilyConfig,
  InternalConfig,
  ListDefinitionsPayload,
  Modules,
  NavigableAddress,
  DocumentRendererRuntime,
  RuntimeDocument,
  SearchMatch,
  SuperDocAwarenessUpdatePayload,
  SuperDocCommentsUpdatePayload,
  SuperDocCommentsListChangePayload,
  SuperDocDocumentModeChangePayload,
  SuperDocDocumentReplacedPayload,
  SuperDocEditorPayload,
  SuperDocExceptionPayload,
  SuperDocExceptionStorePayload,
  SuperDocFontsApi,
  SuperDocFormattingMarksChangePayload,
  SuperDocLockedPayload,
  SuperDocMeasurementUnit,
  SuperDocMeasurementUnitChangePayload,
  SuperDocPageMarginsChangePayload,
  SuperDocPaginationUpdatePayload,
  SuperDocReadyPayload,
  SuperDocState,
  SuperDocTrackedChangesBulkDecisionPayload,
  SuperDocViewportChangePayload,
  SuperDocViewportMetrics,
  SuperDocZoomMode,
  SuperDocZoomPayload,
  SuperDocZoomState,
  SurfaceHandle,
  SurfaceRequest,
  UpgradeToCollaborationOptions,
  User,
  V2AuthoringFacade,
  V2CollaborationConfig,
  ViewingOptions,
  ViewingTrackedChangesMode,
} from './types/index.js';
import type { SuperDocActiveEditorExtensions } from './extensions/index.js';
import type { EditorRuntime, EditorRuntimeId } from './editor-runtime/index.js';
import type { EditorRuntimeRegistryUnsubscribe } from './editor-runtime/editor-runtime-registry.js';
import type * as Y from 'yjs';
// `Whiteboard` is already imported as a value above (line 19); reuse it
// as a type here without a separate `import type` declaration.
import type { WhiteboardData } from './whiteboard/Whiteboard.js';

type ContentControlCatalogItem = {
  id?: unknown;
  kind?: unknown;
  controlType?: ContentControlType;
  properties?: {
    alias?: unknown;
    tag?: unknown;
  };
};

function getClickedContentControlId(event: MouseEvent, root: HTMLElement): string | null {
  const path = event.composedPath();
  if (!path.includes(root)) return null;

  const control = path.find(
    (target): target is HTMLElement =>
      target instanceof HTMLElement && target.matches(STRUCTURED_CONTENT_FRAME_SELECTOR),
  );
  if (!control) return null;

  // Block chrome is painted for the container/ancestor SDT. Prefer
  // `data-sdt-container-id` on label clicks — the same frame's `data-sdt-id`
  // names the nearest child. Container-only fragments may omit `data-sdt-id`.
  // Body clicks keep nearest-child precedence with a container-id fallback.
  // Mirrors V2 host block-label selection and drag identity resolution.
  const onBlockLabel = path.some(
    (target) => target instanceof HTMLElement && target.classList.contains(DOM_CLASS_NAMES.BLOCK_SDT_LABEL),
  );
  const containerId = control.getAttribute('data-sdt-container-id')?.trim() || null;
  const sdtId = control.getAttribute('data-sdt-id')?.trim() || null;
  return onBlockLabel ? (containerId ?? sdtId) : (sdtId ?? containerId);
}

function getContentControlItems(result: unknown): ContentControlCatalogItem[] {
  if (!result || typeof result !== 'object') return [];
  const items = (result as { items?: unknown }).items;
  return Array.isArray(items) ? (items as ContentControlCatalogItem[]) : [];
}

function toContentControlRef(item: ContentControlCatalogItem | undefined): ContentControlRef | null {
  if (
    !item ||
    typeof item.id !== 'string' ||
    (item.kind !== 'inline' && item.kind !== 'block') ||
    typeof item.controlType !== 'string'
  ) {
    return null;
  }

  const tag = item.properties?.tag;
  const alias = item.properties?.alias;
  return {
    id: item.id,
    controlType: item.controlType,
    scope: item.kind,
    ...(typeof tag === 'string' && tag ? { tag } : {}),
    ...(typeof alias === 'string' && alias ? { alias } : {}),
  };
}

function contentControlSelectionKey(selection: SelectionSlice): string | null {
  const target = selection.selectionTarget ?? selection.target;
  if (!target) return null;
  try {
    return JSON.stringify(target);
  } catch {
    return null;
  }
}

type V2ActiveEditorFacade = {
  editorVersion: 2;
  documentId?: string;
  host?: unknown;
  mount?: unknown;
  options?: {
    documentId?: string;
    documentMode?: DocumentMode;
    [key: string]: unknown;
  };
  capabilities?: unknown;
  /**
   * The public, read-only-guarded browser Document API facade for the active
   * editor. In the browser this surface is async-capable and may return
   * promises, including the default worker-backed runtime; SDK/headless
   * document automation stays synchronous on its own surface.
   */
  doc?: Record<string, any> | null;
  /** Stable reason `doc` is unavailable; null when live. */
  documentApiUnavailableReason?: string | null;
  save?: (...args: unknown[]) => Promise<unknown>;
  exportDocx?: (...args: unknown[]) => Promise<Blob>;
  replaceFile?: (source: File | Blob | ArrayBuffer | Uint8Array) => Promise<unknown>;
  upgradeToCollaboration?: (
    source: File | Blob | ArrayBuffer | Uint8Array,
    collaboration: V2CollaborationConfig,
  ) => Promise<unknown>;
  focus?: (options?: EditorRuntimeFocusOptions) => unknown;
  authoring?: V2AuthoringFacade | null;
  v2Comments?: unknown;
  v2TrackedChanges?: unknown;
  contextMenu?: {
    open?(): unknown;
    close?(): unknown;
  } | null;
  presence?: {
    getSnapshot?: () => V2AwarenessSnapshotLike;
    subscribe?: (listener: (snapshot: V2AwarenessSnapshotLike) => void) => () => void;
  } | null;
  lock?: {
    getSnapshot?: () => { isLocked?: boolean; lockedBy?: Record<string, unknown> | null };
    setLocked?: (isLocked: boolean, lockedBy?: Record<string, unknown> | null) => void;
    subscribe?: (
      listener: (snapshot: { isLocked?: boolean; lockedBy?: Record<string, unknown> | null }) => void,
    ) => () => void;
  } | null;
  pageMetrics?: unknown;
  pageLayout?: unknown;
  pageFurniture?: unknown;
  reviewWindow?: unknown;
  commands?: null;
  state?: null;
  view?: null;
  setHighContrastMode?: (isHighContrast: boolean) => void;
  /** Narrow v2 extension facet (commands + diagnostics); null when no extensions registered. */
  extensions?: SuperDocActiveEditorExtensions | null;
  /** v2 host-owned font runtime facet powering `superdoc.fonts.*`; null when boot failed. */
  fonts?: NormalizedFontRuntime | null;
  [key: string]: unknown;
};

type ActiveEditor = Editor | V2ActiveEditorFacade;

type V2UpgradeRollbackState = {
  isCollaborative: boolean;
  configV2Collaboration: RuntimeDocument['v2Collaboration'] | null;
  configData: RuntimeDocument['data'];
  storeDoc: RuntimeDocument | null;
  storeV2Collaboration: RuntimeDocument['v2Collaboration'] | null;
  storeData: RuntimeDocument['data'];
};

type ValidatedV2UpgradePrerequisites = {
  target: NormalizedV2CollaborationTarget;
};

type V2UpgradePromotionState = {
  configDoc: RuntimeDocument;
  storeDoc: RuntimeDocument;
};

type V2LockSeed = {
  isLocked: boolean;
  lockedBy: User | null;
};

function isV2ActiveEditorFacade(editor: unknown): editor is V2ActiveEditorFacade {
  return Boolean(editor && typeof editor === 'object' && (editor as { editorVersion?: unknown }).editorVersion === 2);
}

function normalizeActiveEditorDocumentId(documentId: unknown): string | null {
  return typeof documentId === 'string' && documentId.length > 0 ? documentId : null;
}

function getActiveEditorDocumentId(editor: ActiveEditor | null | undefined): string | null {
  if (!editor) return null;
  if (isV2ActiveEditorFacade(editor)) {
    return normalizeActiveEditorDocumentId(editor.documentId ?? editor.options?.documentId ?? null);
  }
  const documentId = typeof editor.getDocumentId === 'function' ? editor.getDocumentId() : editor.options?.documentId;
  return normalizeActiveEditorDocumentId(documentId);
}

function getActiveDocumentRenderer(editor: ActiveEditor | null | undefined): DocumentRendererRuntime | null {
  if (!editor || isV2ActiveEditorFacade(editor)) return null;
  const projected = editor as {
    documentRenderer?: DocumentRendererRuntime | null;
    [key: string]: unknown;
  };
  return (
    projected.documentRenderer ??
    (projected['presentation' + 'Editor'] as DocumentRendererRuntime | null | undefined) ??
    null
  );
}

/**
 * Renderer-neutral font runtime facet. v1 exposes it as the document renderer (`getFontReport`,
 * `mapFonts`, ...); v2 exposes a host-owned font facet (`getReport`, `map`, ...). This normalizes both
 * onto one shape so `superdoc.fonts.*` and the `fonts-changed` relay work regardless of runtime.
 */
interface NormalizedFontRuntime {
  getReport(): FontResolutionRecord[];
  getMissingFonts(): string[];
  getDocumentFonts(): string[];
  getDocumentFontOptions(): DocumentFontOption[];
  getFontFamilyOptions(): FontFamilyOption[];
  getLastFontsChangedPayload(): FontsChangedPayload | null;
  map(mappings: Record<string, string>): void;
  unmap(families: string | readonly string[]): void;
  add(families: readonly FontFamilyConfig[] | FontFamilyConfig): void;
  preload(families: readonly string[]): Promise<void>;
  /** v2 host facet only: subscribe to report changes (v1 streams via `editor.on('fonts-changed')`). */
  onChanged?(listener: (payload: FontsChangedPayload) => void): () => void;
}

/**
 * The active editor's font runtime, normalized. For v2 the active facade carries a `fonts` facet
 * (already in the normalized shape); for v1 the document renderer is adapted to it. Returns null when
 * no editor is active or the runtime is not yet available.
 */
function getActiveFontRuntime(editor: ActiveEditor | null | undefined): NormalizedFontRuntime | null {
  if (!editor) return null;
  if (isV2ActiveEditorFacade(editor)) {
    const facet = (editor as { fonts?: NormalizedFontRuntime | null }).fonts;
    return facet ?? null;
  }
  // The v1 document renderer is loosely typed (DocumentRendererRuntime); view it through the font
  // method surface it actually exposes so the adapter stays callable and type-checked.
  const r = getActiveDocumentRenderer(editor) as
    | (DocumentRendererRuntime & {
        getFontReport?: () => FontResolutionRecord[];
        getMissingFonts?: () => string[];
        getDocumentFontOptions?: () => DocumentFontOption[];
        getFontFamilyOptions?: () => FontFamilyOption[];
        getLastFontsChangedPayload?: () => FontsChangedPayload | null;
        mapFonts: (mappings: Record<string, string>) => void;
        unmapFonts: (families: string | readonly string[]) => void;
        addFonts: (families: readonly FontFamilyConfig[]) => void;
        preloadFonts: (families: readonly string[]) => Promise<void>;
      })
    | null;
  if (!r) return null;
  return {
    getReport: () => r.getFontReport?.() ?? [],
    getMissingFonts: () => r.getMissingFonts?.() ?? [],
    getDocumentFonts: () => [...new Set((r.getFontReport?.() ?? []).map((record) => record.logicalFamily))],
    getDocumentFontOptions: () => r.getDocumentFontOptions?.() ?? [],
    getFontFamilyOptions: () => r.getFontFamilyOptions?.() ?? [],
    getLastFontsChangedPayload: () => r.getLastFontsChangedPayload?.() ?? null,
    map: (mappings) => r.mapFonts(mappings),
    unmap: (families) => r.unmapFonts(families),
    add: (families) => r.addFonts(Array.isArray(families) ? families : [families]),
    preload: (families) => r.preloadFonts(families),
  };
}

// Internal-only event payload shapes (consumer-facing payloads are
// exported from `core/types/index.ts` and imported above).
interface SuperDocWhiteboardPayload {
  whiteboard: Whiteboard;
}
/** Raw editor event enriched by `onContentError` before it reaches the Config callback. */
interface EditorContentErrorPayload {
  error: unknown;
  editor: Editor;
}

/**
 * SuperDoc lifecycle event registry. Keys are event names emitted via
 * `this.emit(...)`; each value is the tuple of arguments. Used as the
 * generic parameter of `EventEmitter<SuperDocEventMap>` so `superdoc.on`
 * / `superdoc.emit` reject unknown event names at compile time.
 */
interface SuperDocEventMap {
  ready: [SuperDocReadyPayload];
  editorBeforeCreate: [SuperDocEditorPayload];
  editorCreate: [SuperDocEditorPayload];
  editorDestroy: [];
  'pdf:document-ready': [];
  'sidebar-toggle': [boolean];
  'comments-list-change': [SuperDocCommentsListChangePayload];
  /** Requests the shell open its find/replace surface (e.g. the toolbar search button). */
  'search:open': [];
  zoomChange: [SuperDocZoomPayload];
  'measurement-unit-change': [SuperDocMeasurementUnitChangePayload];
  'page-margins-change': [SuperDocPageMarginsChangePayload];
  'formatting-marks-change': [SuperDocFormattingMarksChangePayload];
  'document-mode-change': [SuperDocDocumentModeChangePayload];
  /**
   * The active editor was assigned or cleared. Internal: the UI controller
   * listens so its snapshot follows the live editor. `editorCreate` only
   * covers assignment, and it is emitted after `broadcastReady()`, so
   * neither a pre-ready read nor a clear would refresh without this.
   */
  'active-editor-change': [];
  /**
   * `replaceFile()` swapped the content under a stable editor identity.
   *
   * Deliberately distinct from `active-editor-change`: the editor object and its
   * host both survive a replace, so anything bound to the HOST — geometry
   * observers, for one — is still attached to the thing now rendering the
   * replacement and must not be torn down. Only state describing the previous
   * document's content is stale.
   *
   * Emitted only after the replacement is confirmed, and carrying the editor
   * whose replacement completed: a replace is asynchronous, so the active editor
   * can move while it is in flight, and a consumer must ignore an event naming an
   * editor it is not bound to.
   */
  'document-replaced': [SuperDocDocumentReplacedPayload];
  'editor-update': [EditorUpdateEvent];
  'tracked-changes:bulk-decision': [SuperDocTrackedChangesBulkDecisionPayload];
  'content-error': [EditorContentErrorPayload];
  'fonts-resolved': [FontsResolvedPayload];
  'fonts-changed': [FontsChangedPayload];
  'pagination-update': [SuperDocPaginationUpdatePayload];
  'list-definitions-change': [ListDefinitionsPayload];
  'comments-update': [SuperDocCommentsUpdatePayload];
  'content-control:active-change': [ContentControlActiveChangePayload];
  'content-control:click': [ContentControlClickPayload];
  'collaboration-ready': [SuperDocEditorPayload];
  'awareness-update': [SuperDocAwarenessUpdatePayload];
  locked: [SuperDocLockedPayload];
  'whiteboard:init': [SuperDocWhiteboardPayload];
  'whiteboard:ready': [SuperDocWhiteboardPayload];
  'whiteboard:change': [WhiteboardData];
  'whiteboard:enabled': [boolean];
  'whiteboard:tool': [string];
  exception: [SuperDocExceptionPayload];
  'viewport-change': [SuperDocViewportChangePayload];
  'source:complete': [];
  'source:signals-complete': [];
}
// Notes on the event map above:
//
// `exception` is typed as `SuperDocExceptionPayload`, a union of
// producer-specific payloads. Consumers narrow by `stage`, `code`,
// `itemName`, `source`, or `diagnosticCode` before reading other fields.
//
// `fonts-resolved` uses a listener-transport pattern: SuperDoc never
// emits it directly. `SuperDoc.vue:719` reads
// `superdoc.listeners('fonts-resolved')[0]` and threads it into the new
// editor's `onFontsResolved` option. Cleanup of this transport (relay
// through SuperDoc instead) is a follow-up; typing it here matches the
// current consumer-visible contract.

/**
 * SuperDoc class
 * Expects a config object
 *
 * @class
 */
export class SuperDoc extends EventEmitter<SuperDocEventMap> {
  static allowedTypes = [DOCX, PDF, HTML];

  #destroyed = false;

  #isUpgrading = false;

  /** Aborts an in-flight upgrade (sync wait or ready wait). */
  #abortUpgrade: (() => void) | null = null;

  /**
   * Unsubscribe handle for the v2 presence → `awareness-update` bridge. Set
   * while a v2 collaborative editor is mounted and torn down on remount,
   * destroy, failed upgrade, and rollback so the public event source always
   * tracks the live v2 runtime and never leaks listeners.
   */
  #v2AwarenessUnsub: (() => void) | null = null;

  /** Unsubscribe handle for the v2 root-doc lock observer. */
  #v2LockUnsub: (() => void) | null = null;

  /** Lock state captured before a local → v2 collaboration promotion remount. */
  #pendingV2LockSeed: V2LockSeed | null = null;

  #mountWrapper: HTMLDivElement | null = null;

  #contentControlClickRoot: HTMLElement | null = null;

  #contentControlActiveChangeUnsub: (() => void) | null = null;

  #contentControlActiveChangeInstalling = false;

  #contentControlEventBridgeReady = false;

  #pendingContentControlInputSource: 'keyboard' | 'pointer' | null = null;

  #pendingContentControlInputExpiresAt: number | null = null;

  #contentControlPointerActive = false;

  #contentControlPointerId: number | null = null;

  #contentControlSelectionSource: {
    editor: Editor | null;
    key: string;
    source: 'keyboard' | 'pointer';
  } | null = null;

  #handleContentControlPointerDown = (event: PointerEvent) => {
    if (this.listenerCount('content-control:active-change') > 0) {
      if (!this.#contentControlPointerActive) this.#contentControlPointerId = event.pointerId;
      this.#contentControlPointerActive = true;
      this.#pendingContentControlInputSource = 'pointer';
      this.#pendingContentControlInputExpiresAt = null;
    }
  };

  #handleContentControlPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.#contentControlPointerId) return;
    this.#contentControlPointerActive = false;
    this.#contentControlPointerId = null;
    this.#pendingContentControlInputSource ??= 'pointer';
    if (this.#pendingContentControlInputSource === 'pointer') {
      this.#pendingContentControlInputExpiresAt = Date.now() + CONTENT_CONTROL_POINTER_END_WINDOW_MS;
    }
  };

  #handleContentControlKeyDown = (event: KeyboardEvent) => {
    if (this.listenerCount('content-control:active-change') > 0 && !isContentControlNonSelectionKeyDown(event)) {
      this.#pendingContentControlInputSource = 'keyboard';
      this.#pendingContentControlInputExpiresAt = null;
    }
  };

  #handleContentControlClick = (event: MouseEvent) => {
    void this.#emitContentControlClick(event);
  };

  /**
   * Backing store for the SuperDoc-owned UI controller. Created by the first
   * `ui` read and never replaced, so the identity survives document
   * replacement, editor remounts, and active-editor changes.
   */
  #ui: SuperDocUI | null = null;

  /**
   * Effective built-in UI profile, resolved once during init from `Config.ui`
   * and the legacy `modules.*` spellings. Read it instead of asking the raw
   * config which surfaces are on.
   */
  #uiConfig: ReturnType<typeof normalizeUiConfig> = normalizeUiConfig({});

  /**
   * Which built-in surfaces this instance renders.
   *
   * Resolved from {@link Config.ui}, falling back to the historical defaults
   * when it is omitted. Read-only: changing what SuperDoc renders after mount
   * is a per-surface concern, not a config swap.
   */
  get uiConfig(): ReturnType<typeof normalizeUiConfig> {
    return this.#uiConfig;
  }

  /**
   * Backing store for the resolved interaction policy.
   */
  #interactionConfig: ReturnType<typeof normalizeInteractionConfig> = normalizeInteractionConfig({});

  /**
   * Which interactions this Editor allows, separate from what SuperDoc draws.
   *
   * Resolved from {@link Config.interaction}. Stays meaningful when the
   * application renders its own UI: `ui: false` removes the built-in comment
   * dialog but not the policy that rejects a mutation.
   */
  get interactionConfig(): ReturnType<typeof normalizeInteractionConfig> {
    return this.#interactionConfig;
  }

  /**
   * Backing store for the resolved surface infrastructure config.
   */
  #surfacesConfig: ReturnType<typeof normalizeSurfacesConfig> = normalizeSurfacesConfig({});

  /**
   * Shared plumbing for dialogs and floating overlays, including ones the
   * application opens itself through `openSurface()`.
   *
   * Resolved from {@link Config.surfaces}. Unaffected by `ui: false`, which
   * turns off SuperDoc's own surfaces without disabling the mechanism.
   */
  get surfacesConfig(): ReturnType<typeof normalizeSurfacesConfig> {
    return this.#surfacesConfig;
  }

  #surfaceManager;
  /**
   * Build-time SuperDoc version string. Initialized to `'0.0.0'` so the
   * field is structurally assigned before the constructor runs, then
   * overwritten with the injected `__APP_VERSION__` constant inside
   * `#init` (the existing `@ts-expect-error` keeps the injected global
   * out of the JSDoc type graph). Consumers reading `superdoc.version`
   * immediately after `new SuperDoc(...)` see the real version because
   * `#init` runs synchronously through the overwrite before returning.
   */
  version = '0.0.0';

  /**
   * Local copy of the shared users list. Initialized to `[]` so direct
   * reads (`superdoc.users`) are stable before the async `#init`
   * re-seeds from `config.users`. Pre-ready `addSharedUser` /
   * `removeSharedUser` mutations would be silently overwritten by the
   * re-seed, so those methods guard with `#requireReady('addSharedUser')`
   * and throw a clear lifecycle error instead.
   */
  users: User[] = [];

  /** Yjs document for collaboration; set in `#init` when collaboration is enabled, otherwise undefined. */
  ydoc: Y.Doc | undefined;

  /**
   * Provider for the SuperDoc-level collaboration room (separate from
   * per-document providers). Widened to `CollaborationProvider` to match
   * the runtime, which stores whatever provider the consumer passed via
   * `Config.modules.collaboration.provider`. Consumers needing Hocuspocus-
   * specific members must narrow before use.
   *
   */
  provider: CollaborationProvider | undefined;

  /**
   * Whiteboard instance, created by `#initWhiteboard()` after the
   * collaboration await. Initialized to `null` so consumers reading
   * `superdoc.whiteboard` before the `whiteboard:init` event fires get
   * a stable null, not `undefined`.
   */
  whiteboard: Whiteboard | null = null;

  /**
   * Awareness palette assigned to local users when no explicit color is set.
   * Defaults to an empty array so `#assignUserColor` falls back to the
   * built-in `DEFAULT_AWARENESS_PALETTE`.
   */
  colors: string[] = [];

  /**
   * Pinia stores and Vue runtime references. Populated by `#initVueApp`
   * inside the async `#init`, which runs *after* `await #initCollaboration`,
   * so these fields are `undefined` between `new SuperDoc(config)`
   * returning and the `ready` event firing. Typed as `T | undefined` so
   * @ts-check forces every access path to either narrow or use the
   * `#requireSuperdocStore` / `#requireCommentsStore` helpers below
   * (which throw a clear "wait for ready" error). SD-2916 PR-B closed
   * the delayed-init soundness gap.
   *
   * `@private` is a TypeScript-surface hide, not runtime privacy: the
   * fields still exist on the runtime instance and internal callers
   * across the package keep working. Consumers can no longer reach into
   * them via `.d.ts`, which collapses the Pinia type graph from the
   * public surface (SD-3213f). The headless-toolbar host contract was
   * refactored in the same PR to replace raw store reach with narrow
   * host methods, so SuperDoc instances satisfy
   * `HeadlessToolbarSuperdocHost` directly without exposing
   * `superdocStore` publicly.
   *
   * @private
   */
  declare private superdocStore: ReturnType<typeof createSuperdocVueApp>['superdocStore'] | undefined;

  /**
   * @private
   */
  declare private commentsStore: ReturnType<typeof createSuperdocVueApp>['commentsStore'] | undefined;

  /**
   * @private
   */
  declare private highContrastModeStore: ReturnType<typeof createSuperdocVueApp>['highContrastModeStore'] | undefined;

  /**
   * Internal mount handle for the `SuperComments` Vue component, created
   * lazily by `addCommentsList()` and torn down by `removeCommentsList()`.
   * Not consumer API: `SuperComments` is not publicly exported, no docs
   * or examples reference `superdoc.commentsList`, and the inner fields
   * (`element`, `superdoc` backref, `container` Vue ComponentPublicInstance)
   * are internal mount state.
   *
   * Typed as `SuperComments | null | undefined` so the runtime states
   * stay type-clean: `undefined` before `addCommentsList()` runs (e.g.
   * when the viewer role skips initialization; see SuperDoc.test.js
   * for the assertion), `SuperComments` after `addCommentsList()`, and
   * `null` after `removeCommentsList()` tears down. No initializer, to
   * match the convention used by the adjacent `@private` store fields.
   *
   * @private
   */
  // `declare` (no runtime initializer): the legacy JS code only sets
  // `this.commentsList` when role !== 'viewer', and a test asserts the
  // field is `undefined` in the viewer path. An `= null` initializer
  // would create an own runtime property up front and flip that to `null`.
  // `private`: matches the original `@private` JSDoc; not part of the
  // SuperDoc public type surface (consumer-typecheck fixture asserts this).
  declare private commentsList: SuperComments | null;

  /**
   * Internal Vue app handle created in `#initVueApp()` and used for
   * mount/unmount, `provide()`, and `config.globalProperties` setup.
   * Not consumer API: no docs or examples reference `superdoc.app`,
   * and the only cross-file reader (`SuperComments.createVueApp()`
   * at `super-comments-list.js:35`) is a `.js` file under
   * `checkJs: false`, so the `@private` boundary does not break
   * internal source compilation.
   *
   * Same SD-3213f-style TS surface hide as
   * `superdocStore` / `commentsStore` / `highContrastModeStore` /
   * `commentsList`; not runtime privacy.
   *
   * @private
   */
  declare private app: ReturnType<typeof createSuperdocVueApp>['app'] | undefined;

  /** Pinia store root for the SuperDoc Vue app. Set in `#initVueApp`. */
  pinia: ReturnType<typeof createSuperdocVueApp>['pinia'] | undefined;

  /** Count of editors that have signaled `editorCreate`. */
  readyEditors = 0;

  // ─── Runtime fields populated by `#init` ──────────────────────────────
  // Declared with `declare` so TS knows the field shape without emitting a
  // runtime own-property initializer. Each is assigned during `#init`
  // (called synchronously from the constructor), so by the time any
  // external callsite reads them they exist.
  declare activeEditor: Editor | null;
  declare editorVersion: 2;
  declare toolbar: ToolbarLike | null;
  declare toolbarElement: string | HTMLElement | undefined;
  declare userColorMap: Map<string, string>;
  declare colorIndex: number;
  declare isCollaborative: boolean;
  declare isLocked: boolean;
  declare lockedBy: User | null;
  declare isDev: boolean;
  declare superdocId: string;
  declare comments: unknown[];
  declare socket: HocuspocusProviderWebsocket | null;
  declare user: AwarenessUser;
  declare _cleanupAwareness: (() => void) | null;
  declare _commentsCollabInitialized: boolean;

  /**
   * SuperDoc-owned editor runtime registry. This is the internal place to ask
   * which mounted editor runtime is active and which runtime owns a DOM event
   * target. It stays private so it never widens the public SDK type surface.
   */
  readonly #editorRuntimeRegistry = new EditorRuntimeRegistry();

  /** Unsubscribe handle for the registry active-change bridge. */
  #editorRuntimeRegistryUnsub: EditorRuntimeRegistryUnsubscribe | null = null;

  /**
   * Re-entrancy guard. True while the registry active-change bridge is applying
   * a projection through `#setActiveEditorCompatibilityProjection(...)`, so
   * that call applies the projection directly instead of routing back into
   * runtime activation (which would recurse). The compatibility projection
   * stays centralized in one writer.
   */
  #applyingRuntimeActiveChange = false;

  #compatibilityViewingRenderMode: TrackedChangesRenderMode | null = null;

  /**
   * The active configuration. Typed as `InternalConfig` because `#init` runs
   * synchronously in the constructor and normalizes the consumer-provided
   * `Config` into the wider shape (`documents` filled, `modules` defaulted,
   * `user` spread with `DEFAULT_USER`, etc.). Any callsite reading
   * `this.config` runs after `#init`, so it sees the normalized shape.
   *
   * Public consumer input shape: `Config` (re-exported from `superdoc`).
   * Internal post-normalize shape: `InternalConfig`.
   */
  config: InternalConfig = {
    selector: '#superdoc',
    documentMode: 'editing',
    allowSelectionInViewMode: false,
    role: 'editor',
    documents: [],
    editorExtensions: [],

    colors: [],
    // `user` is intentionally not initialized here. `#init` always
    // normalizes `this.config.user` (spreading `DEFAULT_USER` over the
    // consumer-supplied user, or using `DEFAULT_USER` outright when the
    // consumer passes nothing). The previous `{ name: null, email: null }`
    // placeholder was overwritten unconditionally before any consumer
    // could observe it.
    users: [],

    // `user` and `layoutEngineOptions` are also set in `#init` (where `user`
    // is spread with `DEFAULT_USER` and `layoutEngineOptions` defaults to
    // `{}` if the consumer passes nothing). Initializing them here too keeps
    // the field literal satisfying `InternalConfig` directly, with no
    // pre-init gap.
    user: { ...DEFAULT_USER },
    layoutEngineOptions: {},

    modules: {},

    // License key (resolved downstream; undefined means "not explicitly set")
    licenseKey: undefined,

    // Telemetry settings
    telemetry: { enabled: true },

    title: 'SuperDoc',
    conversations: [],
    isInternal: false,
    comments: { visible: false },

    // toolbar config
    toolbarGroups: ['left', 'center', 'right'],
    toolbarIcons: {},
    toolbarTexts: {},

    // UI font for SuperDoc surfaces (toolbar, comments UI, etc.)
    uiDisplayFallbackFont: 'Arial, Helvetica, sans-serif',

    isDev: false,

    disablePiniaDevtools: false,

    // Events
    onEditorBeforeCreate: () => null,
    onEditorCreate: () => null,
    onEditorDestroy: () => null,
    onSourceComplete: () => null,
    onSourceSignalsComplete: () => null,
    onContentError: () => null,
    onReady: () => null,
    onCommentsUpdate: () => null,
    onContentControlActiveChange: () => null,
    onContentControlClick: () => null,
    onAwarenessUpdate: () => null,
    onLocked: () => null,
    onPdfDocumentReady: () => null,
    onSidebarToggle: () => null,
    onCollaborationReady: () => null,
    onEditorUpdate: () => null,
    onCommentsListChange: () => null,
    onException: () => null,
    onListDefinitionsChange: () => null,
    onPaginationUpdate: () => null,
    onTransaction: () => null,
    // The following optional consumer-supplied fields are intentionally
    // NOT initialized here: `superdocId`, `format`, `toolbar` (selector),
    // `permissionResolver`, `onFontsResolved`, `handleImageUpload`,
    // `onTrackedChangeBubbleAccept`, `onTrackedChangeBubbleReject`.
    // For the first six, the public `Config` typedef declares them
    // optional; omitting them from the initializer keeps
    // `superdoc.config.<field>` as `undefined` post-init when the consumer
    // does not pass them, matching the typedef. The two
    // `onTrackedChangeBubble*` callbacks are not yet on the public `Config`
    // typedef (a typedef gap that predates this change); consumers pass
    // them and they are read with `typeof handler === 'function'` guards.
    // Bubble handler signature: `(comment, editor) => void`.
    // Image upload handler signature: `async (file) => url`.

    // Disable context menus (slash and right-click) globally
    disableContextMenu: false,

    // Document view options (OOXML ST_View compatible)
    // - 'print': Print Layout View - displays document as it prints (default)
    // - 'web': Web Page View - content reflows to fit container (mobile/accessibility)
    viewOptions: { layout: 'print' },

    // Internal: toggle layout-engine-powered DocumentRendererRuntime in dev shells
    useLayoutEngine: true,
  };
  constructor(config: Config) {
    super();

    if (!config.selector) {
      throw new Error('SuperDoc: selector is required');
    }

    const container = typeof config.selector === 'string' ? document.querySelector(config.selector) : config.selector;

    if (!(container instanceof HTMLElement)) {
      throw new Error('SuperDoc: selector must be a valid CSS selector string or DOM element');
    }

    // SurfaceManager must exist before `#init` returns control to the
    // caller — `openSurface()` can be called immediately after
    // construction while async init is still in flight. The manager's
    // constructor only stores the `getModuleConfig` thunk, so reading the
    // resolved surfaces config lazily later works even though `#init` has
    // not run yet. Infrastructure only: built-in surface intents live in the
    // UI profile, so this stays live under `ui: false`.
    this.#surfaceManager = new SurfaceManager({
      getModuleConfig: () => this.#surfacesConfig,
    });

    this.#contentControlClickRoot = container;
    container.addEventListener('pointerdown', this.#handleContentControlPointerDown, true);
    container.ownerDocument.addEventListener('pointerup', this.#handleContentControlPointerEnd, true);
    container.ownerDocument.addEventListener('pointercancel', this.#handleContentControlPointerEnd, true);
    container.addEventListener('keydown', this.#handleContentControlKeyDown, true);
    container.addEventListener('click', this.#handleContentControlClick, true);
    this.#onConfig('content-control:active-change', config.onContentControlActiveChange);
    this.#init(config, container);
    this.#contentControlEventBridgeReady = true;
    if (this.listenerCount('content-control:active-change') > 0) void this.ui;
  }

  async #emitContentControlClick(event: MouseEvent): Promise<void> {
    const root = this.#contentControlClickRoot;
    if (!root) return;

    const id = getClickedContentControlId(event, root);
    const list = this.activeEditor?.doc?.contentControls?.list;
    if (!id || typeof list !== 'function') return;

    try {
      const result = await list();
      if (this.#destroyed) return;
      const target = toContentControlRef(getContentControlItems(result).find((item) => item.id === id));
      if (target) this.emit('content-control:click', { target, source: 'pointer' });
    } catch {
      return;
    }
  }

  async #init(config: Config, container: HTMLElement) {
    this.#compatibilityViewingRenderMode = getConfiguredTrackedChangesRenderMode(config);
    this.config = {
      ...this.config,
      ...config,
      modules: { ...this.config.modules, ...config.modules },
      layoutEngineOptions: { ...this.config.layoutEngineOptions, ...config.layoutEngineOptions },
    };
    if (typeof this.config.viewing?.comments === 'boolean') {
      this.config.comments = { ...this.config.comments, visible: this.config.viewing.comments };
    }
    if (!this.config.comments || typeof this.config.comments !== 'object') {
      this.config.comments = { visible: false };
    } else if (typeof this.config.comments.visible !== 'boolean') {
      this.config.comments.visible = false;
    }
    normalizeTrackChangesConfig(this.config);

    // Defensive defaults so the `InternalConfig` runtime invariants hold
    // for every reachable code path. The class-field initializer seeds
    // both `documents: []` and `layoutEngineOptions` is filled in by
    // `normalizeTrackChangesConfig` above, but a consumer that explicitly
    // passes `{ documents: undefined }` or omits `layoutEngineOptions`
    // when track-changes hasn't initialized it yet would otherwise leave
    // these undefined and break later non-null casts.
    this.config.documents = this.config.documents || [];
    this.config.layoutEngineOptions = this.config.layoutEngineOptions || {};

    // The view posture selects the V2 presentation surface. Legacy layout
    // engine toggles remain accepted inputs but cannot divert a web mount.
    const isWebLayout = this.config.viewOptions?.layout === 'web';
    const requestedFlowMode = this.config.layoutEngineOptions?.flowMode;
    const isSemanticFlow = requestedFlowMode === 'semantic';
    if (!isWebLayout && isSemanticFlow) {
      console.warn("[SuperDoc] flowMode 'semantic' is only valid with web layout. Coercing to 'paginated'.");
      this.config.layoutEngineOptions.flowMode = 'paginated';
    }

    // v2-only branch: the DOCX runtime is always v2. `editorVersion` is
    // instance-level runtime evidence; any legacy `config.editorVersion` input
    // is ignored and cannot select a legacy runtime.
    this.editorVersion = 2;
    this.#validateLegacyConfig();

    this.config.user = normalizeSuperDocUser(this.config.user);

    // Enable virtualization by default for better performance on large documents.
    // Only renders visible pages (~5) instead of all pages.
    if (!this.config.layoutEngineOptions.virtualization) {
      this.config.layoutEngineOptions.virtualization = {
        enabled: true,
        window: 5,
        overscan: 1,
      };
    }

    this.config.modules = this.config.modules || {};
    if (!Object.prototype.hasOwnProperty.call(this.config.modules, 'comments')) {
      this.config.modules.comments = {};
    }
    this.config.modules.comments = normalizeCommentsUiConfig(this.config.modules.comments);

    // Resolve the built-in UI profile once, before anything reads it. Every
    // surface decision downstream comes from here rather than re-deriving
    // precedence from `modules.*` and the top-level aliases.
    this.#uiConfig = normalizeUiConfig(this.config);
    this.#interactionConfig = normalizeInteractionConfig(this.config);
    this.#surfacesConfig = normalizeSurfacesConfig(this.config);
    // Seed the live suppression flag from the resolved profile. `editorOptions`
    // ORs this in so a post-mount `setDisableContextMenu()` survives a remount,
    // which means it has to start as the profile's answer rather than the raw
    // consumer value — otherwise a leftover `disableContextMenu: true` would
    // re-disable a surface that `ui.contextMenu: true` just enabled.
    this.config.disableContextMenu = !this.#uiConfig.contextMenu.enabled;
    // Same seeding for the ruler, which needs it for the opposite reason.
    // `config.rulers` is the live visibility state: `useDocument` copies it
    // onto every document and `toggleRuler()` writes it. The profile is the
    // only thing that knows about `ui.ruler`, so without this an explicit
    // `ui: { ruler: true }` resolved as enabled and still started hidden,
    // because the live flag it is read from was never set.
    //
    // Assigned rather than OR'd: the profile already folded the legacy
    // `rulers` value in, and `ui.ruler: false` has to win over a leftover
    // `rulers: true` the same way it does for every other surface.
    this.config.rulers = this.#uiConfig.ruler.enabled;
    // Keep the legacy field consistent with the resolved profile in both
    // directions so the comments store, collaboration sync, and export path
    // stay in agreement while both spellings are accepted. The shell's
    // `isCommentsEnabled` reads this field, so an explicit `ui.comments: true`
    // over a leftover `modules.comments: false` would otherwise resolve as
    // enabled and still render nothing. Runs before the policy assign below,
    // which needs a block to write onto.
    if (!this.#uiConfig.comments.enabled) {
      this.config.modules.comments = false;
    } else if (this.config.modules.comments === false) {
      this.config.modules.comments = {};
    }

    // Interaction policy outlives the built-in comments UI. Copy the resolved
    // comment booleans to the legacy block read by the comments store and
    // dialog.
    // `modules.comments` is `true | false | object | undefined`. `Object.assign`
    // onto the `true` sentinel silently discards the policy, so coerce it to a
    // block first — the sentinel only ever meant "enabled with no options".
    if (this.#uiConfig.comments.enabled) {
      // The declared type is `false | object | undefined`, but JS callers do
      // pass the `true` sentinel (see `collaboration.test.js`), and
      // `Object.assign` onto a primitive silently discards every value. Compare
      // through `unknown` so the runtime guard survives the narrower type.
      if ((this.config.modules.comments as unknown) === true) this.config.modules.comments = {};
      const commentsBlock = this.config.modules.comments;
      if (commentsBlock) {
        commentsBlock.readOnly = this.#interactionConfig.comments.readOnly;
        commentsBlock.allowResolve = this.#interactionConfig.comments.allowResolve;
      }
    }

    this.config.colors = shuffleArray(this.config.colors as `#${string}`[]);
    this.userColorMap = new Map();
    this.colorIndex = 0;

    // @ts-expect-error - __APP_VERSION__ is injected at build time
    this.version = __APP_VERSION__;
    this.#log('🦋 [superdoc] Using SuperDoc version:', this.version);

    this.superdocId = config.superdocId || uuidv4();
    // Default to an empty palette when no colors are configured so downstream
    // assignment logic doesn't have to null-check on every access.
    this.colors = this.config.colors ?? [];

    // Preprocess document
    this.#initDocuments();

    // CDN builds fetch the exact engine package here. npm consumers resolve
    // the same gate through their installed dependency before Vue mounts.
    await loadDefaultV2IntegrationOrFallback();

    if (this.#destroyed) return;

    // SurfaceManager is constructed in the constructor body (before
    // `#init` is called) so it exists for any `openSurface()` call
    // that lands while async init is still in flight.

    // Initialize collaboration if configured
    await this.#initCollaboration(this.config.modules);

    // Check if destroy() was called while we were initializing
    if (this.#destroyed) {
      this.#cleanupCollaboration();
      return;
    }

    // --- One-time shell setup (survives upgrade) ---
    this.user = this.config.user;
    this.users = this.config.users || [];
    this.socket = null;
    this.isDev = this.config.isDev || false;

    this.activeEditor = null;
    this.comments = [];

    // Bridge active runtime changes onto the legacy `activeEditor` projection.
    // The registry never writes `activeEditor` directly; it surfaces the next
    // runtime's compatibility projection and SuperDoc routes that through
    // `setActiveEditor(...)` so existing toolbar side effects stay centralized.
    if (!this.#editorRuntimeRegistryUnsub) {
      this.#editorRuntimeRegistryUnsub = this.#editorRuntimeRegistry.subscribe((change) => {
        this.#applyActiveRuntimeChange(change.nextRuntimeId, change.legacyEditorProjection);
      });
    }

    this.isLocked = this.config.isLocked || false;
    this.lockedBy = this.config.lockedBy || null;

    // Mount wrapper created once — Vue apps mount into it on each runtime start
    const mountWrapper = document.createElement('div');
    mountWrapper.style.display = 'contents';
    container.appendChild(mountWrapper);
    this.#mountWrapper = mountWrapper;

    this.#initListeners();
    this.#initWhiteboard();
    this.#addToolbar();

    // Mount the runtime once the outer shell is ready.
    this.#startRuntime();
  }

  // ---------------------------------------------------------------------------
  // Runtime mount lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Mount the Vue app, stores, and editor runtime.
   */
  #startRuntime() {
    this.#initVueApp();
    this.readyEditors = 0;
    // `#initVueApp()` assigns `this.app`, but TS can't follow the side
    // effect; assert non-null here so the mount call type-checks.
    if (!this.app) {
      throw new Error('SuperDoc: #startRuntime called before #initVueApp populated this.app');
    }
    this.app.mount(this.#mountWrapper);
  }

  #initWhiteboard() {
    const config = this.config.modules?.whiteboard;
    const enabled = config !== false && (config?.enabled ?? false);

    this.whiteboard = new Whiteboard({
      Renderer: WhiteboardRenderer,
      superdoc: this,
      enabled,
    });
    this.emit('whiteboard:init', { whiteboard: this.whiteboard });
  }

  /**
   * Get the number of editors that are required for this superdoc
   * @returns The number of required editors
   */
  get requiredNumberOfEditors() {
    return this.#requireSuperdocStore('requiredNumberOfEditors').documents.filter(
      (d: RuntimeDocument) => d.type === DOCX,
    ).length;
  }

  /**
   * The UI controller for this instance: the single place to read command
   * state and drive comments, track changes, selection, zoom, and the other
   * UI surfaces from application code.
   *
   * SuperDoc owns exactly one controller per instance. Every internal
   * consumer — the built-in toolbar, the link popover, keyboard command
   * routing, and the React bindings — reads this same object, so command
   * state never diverges between built-in and custom UI. The controller is
   * created by the first read and its identity never changes afterwards:
   * replacing the document, remounting an editor, or switching the active
   * editor in a multi-document instance all keep the same controller.
   *
   * Reading it is safe before the document is ready. Slices report a `pending`
   * status and commands report themselves disabled instead of throwing, so a
   * custom UI can subscribe in the same tick as the constructor and will start
   * receiving real values once an editor mounts.
   *
   * `SuperDoc.destroy()` destroys the controller. The returned type is
   * {@link BorrowedSuperDocUI}, which omits `destroy()`, so a consumer tearing
   * down state that other readers of this instance still observe is a compile
   * error rather than a rule in a comment. The instance keeps the owning
   * reference privately.
   *
   * This is an observation and command surface, not a permission boundary.
   * Anything it exposes is reachable by the page that hosts SuperDoc.
   *
   * @example
   * const superdoc = new SuperDoc({ selector: '#editor', document: file });
   * const stop = superdoc.ui.comments.observe((comments) => render(comments));
   * superdoc.ui.commands.get('bold').getState(); // { enabled, active, ... }
   */
  get ui(): BorrowedSuperDocUI {
    if (!this.#ui) {
      this.#ui = createSuperDocUI({ superdoc: this });
      // A first read after destroy() must not resurrect live subscriptions.
      // The controller is still returned (and still readable) so callers get
      // a stable object instead of a null check, but it is inert.
      if (this.#destroyed) this.#ui.destroy();
    }
    this.#ensureContentControlActiveChangeBridge();
    return this.#ui;
  }

  override on<K extends keyof SuperDocEventMap>(
    event: K,
    fn: EventEmitter.EventListener<SuperDocEventMap, K>,
    context?: unknown,
  ): this {
    super.on(event, fn, context);
    if (event === 'content-control:active-change' && this.#contentControlEventBridgeReady) void this.ui;
    return this;
  }

  override addListener<K extends keyof SuperDocEventMap>(
    event: K,
    fn: EventEmitter.EventListener<SuperDocEventMap, K>,
    context?: unknown,
  ): this {
    super.addListener(event, fn, context);
    if (event === 'content-control:active-change' && this.#contentControlEventBridgeReady) void this.ui;
    return this;
  }

  override once<K extends keyof SuperDocEventMap>(
    event: K,
    fn: EventEmitter.EventListener<SuperDocEventMap, K>,
    context?: unknown,
  ): this {
    super.once(event, fn, context);
    if (event === 'content-control:active-change' && this.#contentControlEventBridgeReady) void this.ui;
    return this;
  }

  override removeListener<K extends keyof SuperDocEventMap>(
    event: K,
    fn?: EventEmitter.EventListener<SuperDocEventMap, K>,
    context?: unknown,
    once?: boolean,
  ): this {
    super.removeListener(event, fn, context, once);
    this.#detachContentControlActiveChangeBridgeIfUnused();
    return this;
  }

  override off<K extends keyof SuperDocEventMap>(
    event: K,
    fn?: EventEmitter.EventListener<SuperDocEventMap, K>,
    context?: unknown,
    once?: boolean,
  ): this {
    super.off(event, fn, context, once);
    this.#detachContentControlActiveChangeBridgeIfUnused();
    return this;
  }

  override removeAllListeners(event?: keyof SuperDocEventMap): this {
    super.removeAllListeners(event);
    this.#detachContentControlActiveChangeBridgeIfUnused();
    return this;
  }

  #detachContentControlActiveChangeBridgeIfUnused(): void {
    if (this.listenerCount('content-control:active-change') > 0) return;
    this.#contentControlActiveChangeUnsub?.();
    this.#contentControlActiveChangeUnsub = null;
    this.#contentControlSelectionSource = null;
    this.#pendingContentControlInputSource = null;
    this.#pendingContentControlInputExpiresAt = null;
    this.#contentControlPointerActive = false;
    this.#contentControlPointerId = null;
  }

  #ensureContentControlActiveChangeBridge(): void {
    if (
      this.#contentControlActiveChangeUnsub ||
      this.#contentControlActiveChangeInstalling ||
      !this.#ui ||
      this.#destroyed ||
      this.listenerCount('content-control:active-change') === 0
    ) {
      return;
    }

    let previousEditor: Editor | null = null;
    let previousPath: ContentControlRef[] = [];
    let selectionUnsub: (() => void) | null = null;
    let contentControlsUnsub: (() => void) | null = null;
    let skipInitialSelection = true;
    this.#contentControlActiveChangeInstalling = true;
    try {
      selectionUnsub = this.#ui.selection.observe((selection) => {
        if (skipInitialSelection) {
          skipInitialSelection = false;
          return;
        }
        if (selection.status !== 'ready') return;
        const key = contentControlSelectionKey(selection);
        if (!key) return;
        if (
          this.#pendingContentControlInputSource === 'pointer' &&
          this.#pendingContentControlInputExpiresAt !== null &&
          Date.now() > this.#pendingContentControlInputExpiresAt
        ) {
          this.#pendingContentControlInputSource = null;
          this.#pendingContentControlInputExpiresAt = null;
        }
        const source = this.#pendingContentControlInputSource ?? (this.#contentControlPointerActive ? 'pointer' : null);
        const editor = this.activeEditor;
        if (
          source ||
          this.#contentControlSelectionSource?.editor !== editor ||
          this.#contentControlSelectionSource.key !== key
        ) {
          this.#contentControlSelectionSource = {
            editor,
            key,
            source: source ?? 'keyboard',
          };
        }
        this.#pendingContentControlInputSource = null;
        this.#pendingContentControlInputExpiresAt = null;
      });

      // Passive: the bridge only needs the active path. Taking the directory
      // lease here would renew catalog demand on every typing revision for any
      // consumer that merely listens for the event.
      contentControlsUnsub = this.#ui.contentControls.observeActivePath((snapshot) => {
        const editor = this.activeEditor;
        const activePath = snapshot.activeIds.map((id) =>
          toContentControlRef(snapshot.items.find((item) => item.id === id)),
        );
        if (activePath.some((item) => item === null)) return;

        const nextPath = activePath as ContentControlRef[];
        const sameEditor = editor === previousEditor;
        const samePath =
          nextPath.length === previousPath.length &&
          nextPath.every((item, index) => item.id === previousPath[index]?.id);
        if (sameEditor && samePath) return;
        if (nextPath.length === 0 && previousPath.length === 0) {
          previousEditor = editor;
          return;
        }

        const previous = sameEditor ? (previousPath[0] ?? null) : null;
        previousEditor = editor;
        previousPath = nextPath;
        const selectionKey = contentControlSelectionKey(this.#ui!.selection.getSnapshot());
        const selectionSource = this.#contentControlSelectionSource;
        this.emit('content-control:active-change', {
          active: nextPath[0] ?? null,
          previous,
          activePath: nextPath,
          source:
            selectionKey && selectionSource?.editor === editor && selectionSource.key === selectionKey
              ? selectionSource.source
              : 'keyboard',
        });
      });

      const unsubscribe = () => {
        selectionUnsub?.();
        contentControlsUnsub?.();
      };
      if (this.#destroyed || this.listenerCount('content-control:active-change') === 0) unsubscribe();
      else this.#contentControlActiveChangeUnsub = unsubscribe;
    } catch (error) {
      selectionUnsub?.();
      contentControlsUnsub?.();
      throw error;
    } finally {
      this.#contentControlActiveChangeInstalling = false;
    }
  }

  /**
   * Snapshot of the current SuperDoc state. Always reflects the most
   * recent values from the Pinia store; consumers must re-read on
   * change rather than caching.
   *
   * @see {@link SuperDocState} for the public return shape. The runtime
   * still walks `RuntimeDocument[]` internally, but `state.documents`
   * is exposed as the public `Document[]` view - consumers should not
   * rely on the richer runtime fields (`getEditor`, etc.).
   */
  get state(): SuperDocState {
    const documents = this.#requireSuperdocStore('state').documents.map((document: RuntimeDocument) => {
      if (!isDocumentByteSource(document.data)) return document;

      return {
        ...document,
        data: documentByteSourceToBlob(document.data, document.type || DOCX),
      };
    });

    return {
      documents,
      users: this.users,
    };
  }

  /**
   * Look up the DocumentRendererRuntime associated with a given documentId.
   * Returns null if no document matches or the document has no
   * renderer runtime. Replaces raw store reach for `custom UI` host routing
   * (SD-3213f).
   *
   */
  getDocumentRuntimeForDocument(documentId: string): DocumentRendererRuntime | null {
    if (typeof documentId !== 'string' || documentId.length === 0) return null;
    const documents = this.superdocStore?.documents ?? [];
    const matched = documents.find((doc: RuntimeDocument) => doc?.getEditor?.()?.options?.documentId === documentId);
    return matched?.getDocumentRuntime?.() ?? null;
  }

  /**
   * Look up a comment by id. Returns null if not found. Replaces the
   * legacy `superdoc.commentsStore.getComment(id)` reach for
   * `custom UI` helpers (SD-3213f). The return type is
   * intentionally wide (`Record<string, unknown> | null`) so the public
   * surface does not pull the Pinia comment model type graph.
   *
   */
  getComment(commentId: string) {
    if (typeof commentId !== 'string' || commentId.length === 0) return null;
    return this.commentsStore?.getComment?.(commentId) ?? null;
  }

  /**
   * Get the SuperDoc container element
   */
  get element() {
    if (typeof this.config.selector === 'string') {
      return document.querySelector(this.config.selector);
    }
    return this.config.selector;
  }

  #initDocuments() {
    const doc = this.config.document;
    const hasDocumentObject =
      !!doc &&
      typeof doc === 'object' &&
      (isDocumentByteSource(doc) || (typeof Blob === 'function' && doc instanceof Blob) || Object.keys(doc).length > 0);
    const hasDocumentUrl = typeof doc === 'string' && doc.length > 0;
    const hasListOfDocuments = this.config.documents && this.config.documents?.length;
    if ((hasDocumentObject || hasDocumentUrl) && hasListOfDocuments) {
      console.warn('🦋 [superdoc] You can only provide one of document or documents');
    }

    if (hasDocumentObject) {
      const normalized = normalizeDocumentEntry(doc);
      this.config.documents = [
        {
          id: uuidv4(),
          ...normalized,
        },
      ];
    } else if (hasDocumentUrl) {
      this.config.documents = [
        {
          id: uuidv4(),
          type: DOCX,
          url: this.config.document as string,
          name: 'document.docx',
        },
      ];
    }

    // Also normalize any provided documents array entries (e.g., when consumer passes uploader wrappers directly)
    if (Array.isArray(this.config.documents) && this.config.documents.length > 0) {
      this.config.documents = this.config.documents.map((d) => {
        const normalized = normalizeDocumentEntry(d);

        if (!normalized || typeof normalized !== 'object') {
          return normalized;
        }

        const existingId =
          (typeof normalized === 'object' && 'id' in normalized && normalized.id) ||
          (d && typeof d === 'object' && 'id' in d && d.id);

        return {
          ...normalized,
          id: existingId || uuidv4(),
        };
      });
    }
  }

  #initVueApp() {
    const { app, pinia, superdocStore, commentsStore, highContrastModeStore } = createSuperdocVueApp({
      disablePiniaDevtools: Boolean(this.config.disablePiniaDevtools),
    });
    this.app = app;
    this.pinia = pinia;
    this.app.config.globalProperties.$config = this.config;
    this.app.config.globalProperties.$documentMode = this.config.documentMode;

    this.app.config.globalProperties.$superdoc = this;

    // Provide surface manager to Vue components via app-level provide
    this.app.provide('surfaceManager', this.#surfaceManager);

    this.superdocStore = superdocStore;
    this.commentsStore = commentsStore;
    this.highContrastModeStore = highContrastModeStore;
    if (typeof this.superdocStore.setExceptionHandler === 'function') {
      this.superdocStore.setExceptionHandler((payload: SuperDocExceptionStorePayload) =>
        this.emit('exception', payload),
      );
    }
    this.superdocStore.init(this.config);
    const commentsModuleConfig = this.config.modules.comments;
    // `commentsModuleConfig` is `false | object | undefined`. A truthy
    // check already rules out both `false` and `undefined`, so an
    // explicit `!== false` afterwards is redundant.
    this.commentsStore.init(commentsModuleConfig || {});
    if (this.isCollaborative) {
      initCollaborationComments(this);
    }
    this.#syncViewingVisibility();
  }

  /**
   * Register an optional `Config` callback as a listener for the matching
   * SuperDoc event. The event key constrains `K`, so TypeScript checks
   * that the consumer-typed `Config.onX` is assignable to
   * `SuperDocEventMap[event]` at the registration site. No-ops on
   * `undefined`, so optional callbacks do not register dead listeners.
   *
   * This catches most event/callback drift at registration sites; the
   * earlier `any → any` bridge let mismatches like `lockedBy: User` vs
   * runtime `User | null` ship undetected. It does not catch overly
   * wide callback types: `(p: {}) => void` is contravariantly
   * assignable to any narrower payload, so consumer fixtures still
   * need to lock the exact emitted payload shape per callback (see
   * `tests/consumer-typecheck/src/config-callback-payloads.ts`).
   */
  #onConfig<K extends keyof SuperDocEventMap>(
    event: K,
    listener: EventEmitter.EventListener<SuperDocEventMap, K> | undefined,
  ): void {
    if (listener) this.on(event, listener);
  }

  #initListeners() {
    this.#onConfig('editorBeforeCreate', this.config.onEditorBeforeCreate);
    this.#onConfig('editorCreate', this.config.onEditorCreate);
    this.#onConfig('editorDestroy', this.config.onEditorDestroy);
    this.#onConfig('source:complete', this.config.onSourceComplete);
    this.#onConfig('source:signals-complete', this.config.onSourceSignalsComplete);
    this.#onConfig('ready', this.config.onReady);
    this.#onConfig('comments-update', this.config.onCommentsUpdate);
    this.#onConfig('content-control:click', this.config.onContentControlClick);
    this.#onConfig('awareness-update', this.config.onAwarenessUpdate);
    this.#onConfig('locked', this.config.onLocked);
    this.#onConfig('pdf:document-ready', this.config.onPdfDocumentReady);
    this.#onConfig('sidebar-toggle', this.config.onSidebarToggle);
    this.#onConfig('collaboration-ready', this.config.onCollaborationReady);
    this.on('collaboration-ready', (payload) => this.#startV2CollaborationEventBridge(payload?.editor ?? null));
    this.#onConfig('editor-update', this.config.onEditorUpdate);
    this.#onConfig('tracked-changes:bulk-decision', this.config.onTrackedChangesBulkDecision);
    this.on('content-error', this.onContentError);
    this.#onConfig('exception', this.config.onException);
    this.#onConfig('list-definitions-change', this.config.onListDefinitionsChange);
    this.#onConfig('pagination-update', this.config.onPaginationUpdate);
    this.#onConfig('fonts-resolved', this.config.onFontsResolved);
    this.#onConfig('fonts-changed', this.config.onFontsChanged);
    this.#onConfig('zoomChange', this.config.onZoomChange);
    this.#onConfig('viewport-change', this.config.onViewportChange);
    this.#onConfig('page-margins-change', this.config.onPageMarginsChange);
  }

  /**
   * Initialize collaboration if configured. Accepts the full
   * `Config.modules` block so it can read both the collaboration
   * subkey and the comments subkey at once.
   * @returns The processed documents with collaboration enabled. Caller awaits for side effects; the return value is informational.
   */
  async #initCollaboration({ collaboration: collaborationModuleConfig }: Modules = {} as Modules) {
    if (!collaborationModuleConfig) return this.config.documents;

    // `modules.collaboration` is the v1 collaboration API. In the v2-only
    // package, touching it would attach an externally supplied Y.Doc/provider
    // before the v2 runtime can classify the room. Fail before any Yjs shared
    // type lookup, provider creation, awareness listener, or comments binding.
    this.isCollaborative = false;
    if (this.config.documents.length === 0) {
      // Preserve the legacy API's implicit blank-document mount solely so the
      // v2 shell can surface the terminal compatibility message. This does not
      // read from or write to the supplied collaboration objects.
      this.config.documents = [{ id: uuidv4(), type: DOCX, name: 'document.docx' }];
    }
    this.config.v2CollaborationPreflightFailure = {
      code: 'collaboration-v1-config-unsupported',
      message:
        'SuperDoc v2 cannot use modules.collaboration because it is the SuperDoc v1 collaboration API. ' +
        'SuperDoc did not attach the provider or change the document. Configure Document.v2Collaboration with a v2 room instead.',
    };
    return this.config.documents;
  }

  // ---------------------------------------------------------------------------
  // Collaboration attachment / detachment
  // ---------------------------------------------------------------------------

  /**
   * Attach an external ydoc/provider pair to this instance and all documents.
   *
   * Shared by constructor-time initialization and late upgrade.
   * Does NOT initialize collaboration comments — that happens in `#initVueApp()`
   * or explicitly after this call during construction.
   *
   */
  #attachExternalCollaboration(ydoc: Y.Doc, provider: CollaborationProvider) {
    this.isCollaborative = true;

    // Reset comments observer flag so a new observer is created for the new ydoc
    this._commentsCollabInitialized = false;

    // Mark as raw to prevent Vue's deep reactive traversal from hitting
    // circular references inside Y.js internals (causes stack overflow).
    this.ydoc = markRaw(ydoc);
    this.provider = markRaw(provider);

    this.#assignUserColor();
    const internalConfig = this.config;
    this._cleanupAwareness = setupAwarenessHandler(provider, this, internalConfig.user);

    internalConfig.documents.forEach((doc: RuntimeDocument) => {
      doc.ydoc = ydoc;
      doc.provider = provider;
      doc.role = this.config.role;
    });
  }

  /**
   * Undo `#attachExternalCollaboration()` so the instance can fall back
   * to non-collaborative mode (used during best-effort rollback).
   */
  #detachCollaboration() {
    this.#pendingV2LockSeed = null;
    this.#stopV2CollaborationEventBridge();
    // Remove the awareness listener so the discarded provider cannot emit
    // awareness-update events into this SuperDoc instance after rollback.
    if (typeof this._cleanupAwareness === 'function') {
      this._cleanupAwareness();
      this._cleanupAwareness = null;
    }

    this.isCollaborative = false;
    this._commentsCollabInitialized = false;
    this.ydoc = undefined;
    this.provider = undefined;
    const cfg = this.config;
    delete cfg.modules.collaboration;

    cfg.documents.forEach((doc: RuntimeDocument) => {
      delete doc.ydoc;
      delete doc.provider;
    });
  }

  #stopV2CollaborationEventBridge() {
    if (this.#v2AwarenessUnsub) {
      try {
        this.#v2AwarenessUnsub();
      } catch {
        /* ignore */
      }
      this.#v2AwarenessUnsub = null;
    }
    if (this.#v2LockUnsub) {
      try {
        this.#v2LockUnsub();
      } catch {
        /* ignore */
      }
      this.#v2LockUnsub = null;
    }
  }

  #startV2CollaborationEventBridge(editor: unknown) {
    this.#stopV2CollaborationEventBridge();
    if (!isV2ActiveEditorFacade(editor)) return;
    this.#startV2AwarenessBridge(editor);
    this.#startV2LockBridge(editor);
  }

  #startV2AwarenessBridge(editor: V2ActiveEditorFacade) {
    const presence = editor.presence;
    if (!presence || typeof presence.subscribe !== 'function') return;
    const differ = createV2AwarenessDiffer(() => this.user);
    const publish = (snapshot: V2AwarenessSnapshotLike) => {
      if (this.#destroyed) return;
      const payload = differ.next(snapshot);
      this.emit('awareness-update', { ...payload, superdoc: this });
    };
    try {
      const initialSnapshot = presence.getSnapshot?.();
      if (initialSnapshot) publish(initialSnapshot);
      this.#v2AwarenessUnsub = presence.subscribe(publish);
    } catch (err) {
      console.warn('[SuperDoc] v2 awareness bridge failed to subscribe', err);
    }
  }

  #startV2LockBridge(editor: V2ActiveEditorFacade) {
    const lock = editor.lock;
    if (!lock || typeof lock.subscribe !== 'function') return;
    const publish = (snapshot: { isLocked?: boolean; lockedBy?: Record<string, unknown> | null }) => {
      if (this.#destroyed) return;
      this.#applyLockState(Boolean(snapshot.isLocked), this.#normalizeLockedBy(snapshot.lockedBy ?? null));
    };
    try {
      if (this.#pendingV2LockSeed && typeof lock.setLocked === 'function') {
        const seed = this.#pendingV2LockSeed;
        lock.setLocked(seed.isLocked, seed.isLocked ? seed.lockedBy : null);
        this.#pendingV2LockSeed = null;
      }
      const initialSnapshot = lock.getSnapshot?.();
      if (initialSnapshot) publish(initialSnapshot);
      this.#v2LockUnsub = lock.subscribe(publish);
    } catch (err) {
      console.warn('[SuperDoc] v2 lock bridge failed to subscribe', err);
    }
  }

  #normalizeLockedBy(value: unknown): User | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return { ...(value as User) };
  }

  #sameLockedBy(a: User | null, b: User | null): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  #applyLockState(isLocked: boolean, lockedBy: User | null) {
    if (this.isLocked === isLocked && this.#sameLockedBy(this.lockedBy, lockedBy)) return;
    this.isLocked = isLocked;
    this.lockedBy = lockedBy;
    this.#log('🦋 [superdoc] Locking superdoc:', isLocked, lockedBy, '\n\n\n');
    this.emit('locked', { isLocked, lockedBy });
  }

  /**
   * Assign a deterministic color to the local user for awareness broadcasts.
   *
   * Without this, provider cursor rendering can fall back to a shared/default
   * color, causing color flickering. The color is derived from a hash of the
   * user's identity so different users get different colors.
   */
  #assignUserColor() {
    // `#init` always populates `this.config.user` (defaults to DEFAULT_USER
    // when the consumer didn't pass one). The guard is here for the
    // strictNullChecks contract on the public Config.user typedef, which
    // must stay optional because consumers should not be required to pass
    // a user up front.
    const user = this.config.user;
    if (!user || user.color) return;

    const palette = this.colors.length > 0 ? this.colors : DEFAULT_AWARENESS_PALETTE;
    const userKey = user.id || user.email || user.name || '';
    let hash = 5381;
    for (let i = 0; i < userKey.length; i++) {
      hash = ((hash << 5) + hash) ^ userKey.charCodeAt(i);
    }
    user.color = palette[Math.abs(hash) % palette.length];
  }

  // ---------------------------------------------------------------------------
  // Late collaboration upgrade
  // ---------------------------------------------------------------------------

  /**
   * Upgrade a local SuperDoc instance into collaboration by creating the
   * supplied room from the current local document and comment state, then
   * attaching collaboration to the live editor instance in place.
   *
   * The target room must not already exist. This is not the API for joining
   * an existing room or merging its content.
   *
   * Currently limited to:
   * - A single DOCX document
   * - A supported v2 single-doc `v2Collaboration` target
   * - Create-and-upgrade only (no merge semantics)
   *
   * @returns Resolves once the collaborative runtime is ready
   */
  async upgradeToCollaboration(options: UpgradeToCollaborationOptions): Promise<void> {
    const { target } = this.#validateUpgradePrerequisites(options);
    this.#isUpgrading = true;

    try {
      const localSource = await this.#captureCurrentDocxSourceForUpgrade();
      const rollback = this.#snapshotV2UpgradeState();
      const lockSeed = this.#snapshotV2LockSeed();
      this.#assertNotDestroyed();
      try {
        this.#pendingV2LockSeed = lockSeed;
        const promotion = await this.#promoteSingleDocumentToV2Collaboration(target, localSource);
        this.#finalizeSingleDocumentV2Collaboration(promotion, target);
        this.#pendingV2LockSeed = null;
      } catch (err) {
        this.#rollbackV2UpgradeState(rollback);
        throw err;
      }
    } finally {
      this.#abortUpgrade = null;
      this.#isUpgrading = false;
    }
  }

  #snapshotV2LockSeed(): V2LockSeed {
    return {
      isLocked: this.isLocked,
      lockedBy: this.lockedBy ? { ...this.lockedBy } : null,
    };
  }

  #snapshotV2UpgradeState() {
    const configDoc = this.config.documents.find((d: RuntimeDocument) => d.type === DOCX) as RuntimeDocument;
    const storeDoc = this.superdocStore?.documents.find((d: RuntimeDocument) => d.id === configDoc.id) ?? null;
    const rawStoreDoc = storeDoc ? toRaw(storeDoc) : null;
    return {
      isCollaborative: this.isCollaborative,
      configV2Collaboration: configDoc.v2Collaboration ?? null,
      configData: configDoc.data,
      storeDoc,
      storeV2Collaboration: this.#readStoreDocV2Collaboration(rawStoreDoc),
      storeData: storeDoc?.data,
    };
  }

  #rollbackV2UpgradeState(rollback: V2UpgradeRollbackState) {
    this.#pendingV2LockSeed = null;
    const configDoc = this.config.documents.find((d: RuntimeDocument) => d.type === DOCX) as RuntimeDocument;
    configDoc.v2Collaboration = rollback.configV2Collaboration;
    configDoc.data = rollback.configData;
    this.isCollaborative = rollback.isCollaborative;
    if (rollback.storeDoc) {
      rollback.storeDoc.data = rollback.storeData;
      this.#writeStoreDocV2Collaboration(rollback.storeDoc, rollback.storeV2Collaboration);
    }
  }

  /**
   * Throw if the instance has been destroyed. Used as a checkpoint after
   * async waits inside upgradeToCollaboration().
   */
  #assertNotDestroyed() {
    if (this.#destroyed) {
      throw new Error('SuperDoc: instance was destroyed during upgrade');
    }
  }

  /**
   * Return the superdoc store, throwing a clear lifecycle error if
   * `#initVueApp` hasn't populated it yet. Use from public methods
   * that genuinely require the runtime to be ready (state-reading,
   * mutation, export, focus). Pre-ready safe-no-op paths
   * (`navigateTo`, `getZoom`, etc.) keep their existing optional-chain pattern
   * instead.
   *
   * SD-2916 PR-B: `superdocStore` is typed `T | undefined` so every
   * non-optional access goes through this helper, which makes the
   * "instance not yet ready" failure mode explicit instead of a
   * generic TypeError on `.documents`.
   *
   * @param methodName The public method name surfaced in
   *   the error so consumers know which call needed the ready state.
   */
  #requireSuperdocStore(methodName: string) {
    if (!this.superdocStore) {
      throw new Error(
        `SuperDoc: ${methodName} requires the instance to be ready; wait for the "ready" event before calling.`,
      );
    }
    return this.superdocStore;
  }

  /**
   * Counterpart to `#requireSuperdocStore` for the comments store.
   * Used by paths that read `commentsStore.commentsList` or other
   * non-optional store members. Pre-ready safe paths (`getComment`,
   * `setActiveComment`, etc.) keep their existing `?.` pattern.
   *
   */
  #requireCommentsStore(methodName: string) {
    if (!this.commentsStore) {
      throw new Error(
        `SuperDoc: ${methodName} requires the instance to be ready; wait for the "ready" event before calling.`,
      );
    }
    return this.commentsStore;
  }

  /**
   * Lightweight readiness guard for fields whose only access is
   * mutation (e.g. `users` via `addSharedUser`/`removeSharedUser`).
   * The store fields are the most reliable "ready" proxy since they
   * are the last things `#init` populates.
   *
   */
  #requireReady(methodName: string) {
    if (!this.superdocStore) {
      throw new Error(
        `SuperDoc: ${methodName} requires the instance to be ready; wait for the "ready" event before calling.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Late-upgrade helpers
  // ---------------------------------------------------------------------------

  /**
   * Set ydoc/provider on live store document composables.
   * Each composable uses shallowRef for these fields (use-document.js:28-29),
   * so we assign to `.value` directly. Vue's reactive proxy auto-unwraps
   * shallowRefs on property access, so we must use `toRaw()` to reach the
   * underlying ref objects.
   *
   */
  #setStoreDocumentCollaboration(ydoc: Y.Doc | null, provider: CollaborationProvider | null) {
    const storeDocs = this.superdocStore?.documents;
    if (!Array.isArray(storeDocs)) return;
    for (const doc of storeDocs) {
      const raw = toRaw(doc);
      if (raw.ydoc && typeof raw.ydoc === 'object' && 'value' in raw.ydoc) {
        raw.ydoc.value = ydoc;
      }
      if (raw.provider && typeof raw.provider === 'object' && 'value' in raw.provider) {
        raw.provider.value = provider;
      }
    }
  }

  #readStoreDocV2Collaboration(rawStoreDoc: RuntimeDocument | null): RuntimeDocument['v2Collaboration'] | null {
    if (!rawStoreDoc) return null;
    const rawValue = rawStoreDoc.v2Collaboration;
    if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
      return (rawValue as { value: RuntimeDocument['v2Collaboration'] | null }).value;
    }
    return rawValue ?? null;
  }

  #writeStoreDocV2Collaboration(storeDoc: RuntimeDocument, value: RuntimeDocument['v2Collaboration'] | null) {
    const raw = toRaw(storeDoc);
    const rawValue = raw.v2Collaboration;
    if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
      (rawValue as { value: RuntimeDocument['v2Collaboration'] | null }).value = value;
      return;
    }
    storeDoc.v2Collaboration = value;
  }

  #toV2CollaborationConfig(target: NormalizedV2CollaborationTarget): V2CollaborationConfig {
    if (target.providerFamily === 'extension') {
      return {
        providerType: 'extension',
        adapterId: target.adapterId as string,
        documentId: target.documentId,
        roomMode: target.roomMode,
        ...(target.providerOptions !== undefined ? { providerOptions: target.providerOptions } : {}),
        ...(target.token ? { token: target.token } : {}),
      };
    }
    if (target.providerFamily === 'liveblocks') {
      return {
        providerType: 'liveblocks',
        documentId: target.documentId,
        roomMode: target.roomMode,
        ...(target.publicApiKey ? { publicApiKey: target.publicApiKey } : {}),
        ...(target.authEndpoint ? { authEndpoint: target.authEndpoint } : {}),
      };
    }
    if (target.providerFamily === 'hocuspocus') {
      return {
        providerType: 'hocuspocus',
        documentId: target.documentId,
        roomMode: target.roomMode,
        ...(target.serverUrl ? { serverUrl: target.serverUrl } : {}),
        ...(target.params ? { params: target.params } : {}),
        ...(target.token ? { token: target.token } : {}),
      };
    }
    return {
      providerType: 'y-websocket',
      documentId: target.documentId,
      roomMode: target.roomMode,
      ...(target.serverUrl ? { serverUrl: target.serverUrl } : {}),
      ...(target.params ? { params: target.params } : {}),
    };
  }

  async #promoteSingleDocumentToV2Collaboration(
    target: NormalizedV2CollaborationTarget,
    localSource: Blob,
  ): Promise<V2UpgradePromotionState> {
    const configDoc = this.config.documents.find((d: RuntimeDocument) => d.type === DOCX) as RuntimeDocument;
    const storeDoc = this.#requireSuperdocStore('upgradeToCollaboration').documents.find(
      (d: RuntimeDocument) => d.id === configDoc.id,
    );
    if (!storeDoc) {
      throw new Error('SuperDoc: source document store entry is not available for upgrade');
    }

    const editor = storeDoc.getEditor?.();
    if (!isV2ActiveEditorFacade(editor) || typeof editor.upgradeToCollaboration !== 'function') {
      throw new Error('SuperDoc: live v2 editor cannot attach collaboration in place');
    }

    // Publish the create target before the stable shell facade is refreshed so
    // the normal ready bridge recognizes the replacement as collaborative.
    // Source data changes only after the host completes its visible handoff.
    const v2Collaboration = this.#toV2CollaborationConfig({ ...target, roomMode: 'create' });
    configDoc.v2Collaboration = v2Collaboration;
    this.#writeStoreDocV2Collaboration(storeDoc, v2Collaboration);
    this.isCollaborative = true;
    await editor.upgradeToCollaboration(localSource, v2Collaboration);
    configDoc.data = localSource;
    storeDoc.data = localSource;
    return { configDoc, storeDoc };
  }

  #finalizeSingleDocumentV2Collaboration(promotion: V2UpgradePromotionState, target: NormalizedV2CollaborationTarget) {
    // Creation is the one-shot operation that promoted this live editor. Once
    // the collaborative runtime is ready, durable state must describe how all
    // subsequent opens behave: they join the room that now exists. Do not bump
    // the mount nonce here; the current successful session stays attached.
    const v2Collaboration = this.#toV2CollaborationConfig({ ...target, roomMode: 'join' });
    promotion.configDoc.v2Collaboration = v2Collaboration;
    this.#writeStoreDocV2Collaboration(promotion.storeDoc, v2Collaboration);
  }

  async #captureCurrentDocxSourceForUpgrade(): Promise<Blob> {
    const activeEditor = this.activeEditor as ActiveEditor | null;
    if (isV2ActiveEditorFacade(activeEditor) && typeof activeEditor.save === 'function') {
      const saved = await activeEditor.save();
      return this.#savedDocxToBlob(saved);
    }

    const configDoc = this.config.documents.find((d: RuntimeDocument) => d.type === DOCX) as RuntimeDocument;
    const storeDoc = this.superdocStore?.documents.find((d: RuntimeDocument) => d.id === configDoc.id) ?? null;
    const source = storeDoc?.data ?? configDoc.data;
    if (source instanceof Blob) return source;
    if (isDocumentByteSource(source)) return this.#savedDocxToBlob(source);
    throw new Error('SuperDoc: upgradeToCollaboration() requires a live v2 editor save or DOCX Blob source');
  }

  #savedDocxToBlob(saved: unknown): Blob {
    if (saved instanceof Blob) return saved;
    if (isDocumentByteSource(saved)) return documentByteSourceToBlob(saved, DOCX);
    throw new Error('SuperDoc: active v2 editor returned an unsupported DOCX save payload');
  }

  #replaceActiveDocumentData(activeEditor: ActiveEditor | null, source: File | Blob | ArrayBuffer | Uint8Array): void {
    const activeDocumentId = getActiveEditorDocumentId(activeEditor);
    const configDoc =
      (activeDocumentId ? this.config.documents.find((d: RuntimeDocument) => d.id === activeDocumentId) : null) ??
      this.config.documents.find((d: RuntimeDocument) => d.type === DOCX);
    if (!configDoc) return;
    const nextData = this.#savedDocxToBlob(source);
    const nextV2Collaboration =
      configDoc.v2Collaboration &&
      typeof configDoc.v2Collaboration === 'object' &&
      (configDoc.v2Collaboration as { roomMode?: unknown }).roomMode === 'create'
        ? ({ ...configDoc.v2Collaboration, roomMode: 'join' } as RuntimeDocument['v2Collaboration'])
        : null;
    configDoc.data = nextData;
    if (nextV2Collaboration) configDoc.v2Collaboration = nextV2Collaboration;
    const storeDoc = this.superdocStore?.documents.find((d: RuntimeDocument) => d.id === configDoc.id) ?? null;
    if (storeDoc) {
      storeDoc.data = nextData;
      if (nextV2Collaboration) this.#writeStoreDocV2Collaboration(storeDoc, nextV2Collaboration);
    }
  }

  /**
   * Resolve the editor instance that supports `attachCollaboration`.
   * Prefers DocumentRendererRuntime (has cursor/layout support); falls back to raw Editor.
   *
   */
  #resolveUpgradeTarget() {
    const storeDocs = this.superdocStore?.documents;
    if (!storeDocs?.length) {
      throw new Error('SuperDoc: no store documents available for upgrade');
    }
    const target = storeDocs[0].getDocumentRuntime?.() || storeDocs[0].getEditor?.();
    if (!target?.attachCollaboration) {
      throw new Error('SuperDoc: editor does not support attachCollaboration');
    }
    return target;
  }

  /**
   * Undo config/store/awareness mutations if `editor.attachCollaboration()` fails.
   * The editor itself is still in local mode (the throw happened before or during
   * reconfigure), so we only need to undo the SuperDoc-layer changes.
   */
  #rollbackCollaborationAttach() {
    this.#detachCollaboration();
    this.#setStoreDocumentCollaboration(null, null);
  }

  /**
   * Wait for the backing editor to emit `collaborationReady` after a live
   * attach. Resolves immediately if the editor has already fired the event.
   *
   * This wait is **non-fatal**: if it times out or is aborted by `destroy()`,
   * the promise still resolves (not rejects). The attach already succeeded,
   * so the editor IS collaborative. A timeout only means secondary setup
   * (cursors, presence) is delayed — rolling back would be worse.
   *
   */
  #waitForCollaborationReady(editorInstance: Editor | DocumentRendererRuntime) {
    const TIMEOUT_MS = 10_000;

    // DocumentRendererRuntime wraps Editor; get the underlying editor for event
    // listening. DocumentRendererRuntime exposes a `get editor(): Editor`
    // accessor; plain Editor has no such property, so the runtime `??`
    // fallback returns the instance itself in that case. The structural
    // `{ editor? }` cast names the lookup without claiming the field
    // exists on the Editor arm of the union.
    const editor = ((editorInstance as { editor?: Editor }).editor ?? editorInstance) as Editor;

    // If collaborationReady already fired (options flag set by collaboration extension)
    if (editor.options?.collaborationIsReady) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (typeof editor.off === 'function') editor.off('collaborationReady', onReady);
      };

      const timer = setTimeout(() => {
        cleanup();
        console.warn(
          '[SuperDoc] collaborationReady did not fire within 10 s after collaboration attach. Continuing — collaboration is active but cursor/presence setup may be delayed.',
        );
        resolve(undefined);
      }, TIMEOUT_MS);

      const onReady = () => {
        cleanup();
        resolve(undefined);
      };

      // Allow destroy() to abort this wait immediately.
      this.#abortUpgrade = () => {
        cleanup();
        resolve(undefined);
      };

      if (typeof editor.on === 'function') {
        editor.on('collaborationReady', onReady);
      } else {
        cleanup();
        resolve(undefined);
      }
    });
  }

  /**
   * Wait for the provider to report synced, with a timeout.
   *
   * Mirrors the timeout + cleanup pattern from Editor.replaceFile() so a
   * provider that exposes on/off but never emits sync cannot hang forever.
   * destroy() can abort this wait early via #abortUpgrade.
   *
   */
  #waitForProviderSync(provider: CollaborationProvider) {
    const SYNC_TIMEOUT_MS = 10_000;

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      // Initial no-op; reassigned below to the real cleanup once the
      // sync observer is registered.
      // oxlint-disable-next-line @typescript-eslint/no-empty-function
      let syncCleanup = () => {};

      const settle = () => {
        settled = true;
        clearTimeout(timer);
        syncCleanup();
      };

      syncCleanup = onCollaborationProviderSynced(provider, () => {
        if (settled) return;
        settle();
        resolve();
      });

      if (!settled) {
        timer = setTimeout(() => {
          settle();
          reject(
            new Error(
              `SuperDoc: collaboration provider did not sync within ${SYNC_TIMEOUT_MS} ms. ` +
                `The provider exposes on/off but never emitted sync(true) or synced.`,
            ),
          );
        }, SYNC_TIMEOUT_MS);
      }

      // Allow destroy() to abort the sync wait immediately
      this.#abortUpgrade = () => {
        if (settled) return;
        settle();
        reject(new Error('SuperDoc: instance was destroyed during upgrade'));
      };
    });
  }

  /**
   * Validate that the instance is in a valid state for a collaboration upgrade.
   * Throws descriptive errors for each invalid condition.
   *
   * @param options
   */
  #validateUpgradePrerequisites(options: UpgradeToCollaborationOptions): ValidatedV2UpgradePrerequisites {
    if (this.#destroyed) {
      throw new Error('SuperDoc: cannot upgrade a destroyed instance');
    }
    if (this.#isUpgrading) {
      throw new Error('SuperDoc: upgrade already in progress');
    }
    if (this.isCollaborative) {
      throw new Error('SuperDoc: instance is already collaborative');
    }

    const cfg = this.config;
    const docxDocs = cfg.documents.filter((d: RuntimeDocument) => d.type === DOCX);
    if (docxDocs.length === 0) {
      throw new Error('SuperDoc: no DOCX document found for upgrade');
    }
    if (docxDocs.length > 1) {
      throw new Error('SuperDoc: upgradeToCollaboration() only supports a single DOCX document');
    }
    if (cfg.documents.length !== docxDocs.length) {
      throw new Error('SuperDoc: upgradeToCollaboration() only supports single-DOCX instances');
    }
    const sourceEditor = this.#resolveSourceEditor();
    if (!isV2ActiveEditorFacade(sourceEditor)) {
      throw new Error('SuperDoc: upgradeToCollaboration() requires a ready v2 DOCX editor');
    }

    const configDoc = docxDocs[0] as RuntimeDocument;
    const mountedDocumentId = configDoc.id;
    if (typeof mountedDocumentId !== 'string' || mountedDocumentId.length === 0) {
      throw new Error('SuperDoc: source document is missing its mounted document identity');
    }
    const collaborationModule = cfg.modules?.collaboration as
      | (CollaborationConfig & { v2?: unknown; v2Collaboration?: unknown })
      | undefined;
    const legacyCollaboration: LegacyCollaborationLike | null =
      options.ydoc || options.provider
        ? { ydoc: options.ydoc, provider: options.provider }
        : collaborationModule
          ? ({ ...collaborationModule } as LegacyCollaborationLike)
          : null;
    const v2Collaboration =
      options.v2Collaboration ??
      this.#unwrapMaybeRef(configDoc.v2Collaboration) ??
      collaborationModule?.v2Collaboration ??
      collaborationModule?.v2 ??
      null;

    const resolution = resolveV2CollaborationTarget({
      collaboration: options.collaboration,
      v2Collaboration,
      legacyCollaboration,
      documentType: DOCX,
      documentCount: cfg.documents.length,
      ...(typeof window !== 'undefined' ? { authEndpointBaseUrl: window.location.href } : {}),
    });
    if (!resolution.ok) {
      throw new Error(`SuperDoc: upgradeToCollaboration() ${resolution.reason}: ${resolution.message}`);
    }
    return { target: resolution.target };
  }

  #unwrapMaybeRef<T = unknown>(value: T): T | unknown {
    if (value && typeof value === 'object' && 'value' in value) {
      return (value as { value: unknown }).value;
    }
    return value;
  }

  /**
   * Resolve the source editor from the DOCX document entry.
   *
   * @returns The editor instance for the source document
   * @throws {Error} If the editor is not yet created
   */
  #resolveSourceEditor() {
    // Upstream `#assertCanUpgrade` already verified at least one DOCX
    // document exists; cast the find result to assert non-null without
    // changing runtime behavior.
    const docxDoc = this.config.documents.find((d: RuntimeDocument) => d.type === DOCX) as RuntimeDocument;
    const storeDoc = this.#requireSuperdocStore('upgradeToCollaboration').documents.find(
      (d: RuntimeDocument) => d.id === docxDoc.id,
    );
    const editor = storeDoc?.getEditor?.();

    if (!editor) {
      throw new Error('SuperDoc: source editor not yet created — wait for the ready event before upgrading');
    }
    return editor;
  }

  /**
   * Add a user to the shared users list. Requires the instance to be
   * ready; pre-ready mutations would be silently overwritten by the
   * `this.users = this.config.users || []` re-seed inside `#init`.
   *
   * @param user The user to add
   */
  addSharedUser(user: User) {
    this.#requireReady('addSharedUser');
    const userKey = getActorIdentityKey({ actor: user });
    if (userKey && this.users.some((u) => getActorIdentityKey({ actor: u }) === userKey)) return;
    this.users.push(user);
  }

  /**
   * Remove a user from the shared users list. Requires the instance
   * to be ready for the same reason as `addSharedUser`. Accepts
   * either a user-like object or a legacy email string.
   *
   * @param userOrEmail The user or email of the user to remove
   */
  removeSharedUser(userOrEmail: User | string) {
    this.#requireReady('removeSharedUser');
    const legacyEmail = typeof userOrEmail === 'string' ? normalizeActorEmail(userOrEmail) : '';
    const targetKey =
      typeof userOrEmail === 'string' ? `email:${legacyEmail}` : getActorIdentityKey({ actor: userOrEmail });

    this.users = this.users.filter((u) => {
      const existingKey = getActorIdentityKey({ actor: u });
      if (targetKey) return existingKey !== targetKey;
      if (legacyEmail) return normalizeActorEmail(u.email) !== legacyEmail;
      return true;
    });
  }

  /** Report an editor content error with its document ID and source file. */
  onContentError({ error, editor }: EditorContentErrorPayload) {
    const documentId = editor.options?.documentId;
    // Teardown or a foreign editor can make the expected store lookup miss.
    const doc = this.#requireSuperdocStore('onContentError').documents.find(
      (d: RuntimeDocument) => d.id === documentId,
    );
    const resolvedId = typeof doc?.id === 'string' ? doc.id : typeof documentId === 'string' ? documentId : '';
    const source = doc?.data;
    const file = isBlobAcrossRealms(source)
      ? source
      : isDocumentByteSource(source)
        ? this.#savedDocxToBlob(source)
        : source == null
          ? source
          : undefined;
    this.config.onContentError?.({
      error,
      editor,
      documentId: resolvedId,
      file,
    });
  }

  /**
   * Triggered when the PDF document is ready
   */
  broadcastPdfDocumentReady() {
    this.emit('pdf:document-ready');
  }

  /**
   * Triggered when the superdoc is ready
   */
  broadcastReady() {
    if (this.readyEditors === this.requiredNumberOfEditors) {
      this.emit('ready', { superdoc: this });
    }
  }

  /**
   * Triggered before an editor is created
   * @param editor The editor that is about to be created
   */
  broadcastEditorBeforeCreate(editor: Editor) {
    this.emit('editorBeforeCreate', { editor: createDeprecatedEditorProxy(editor) });
  }

  /**
   * Triggered when an editor is created
   * @param editor The editor that was created
   */
  broadcastEditorCreate(editor: Editor) {
    this.readyEditors++;
    this.broadcastReady();
    this.#wireFontsChangedRelay(editor);
    this.emit('editorCreate', { editor: createDeprecatedEditorProxy(editor) });
  }

  broadcastSourceComplete() {
    this.emit('source:complete');
  }

  broadcastSourceSignalsComplete() {
    this.emit('source:signals-complete');
  }

  /** Editors whose `fonts-changed` we already relay, so a repeated create wires once. */
  #fontsRelayEditors = new WeakSet<Editor>();

  /**
   * Relay an editor's authoritative `fonts-changed` up to the SuperDoc surface, so
   * `superdoc.on('fonts-changed')` / `onFontsChanged` fire without the legacy
   * `fonts-resolved` SuperDoc.vue listener-transport. Two robustness rules the happy
   * path missed: (1) guard `editor.on` - test stubs and pre-layout editors lack it;
   * (2) the DocumentRendererRuntime may have emitted its first report BEFORE this relay
   * subscribed (a fast or swapped document), so replay the cached payload once on wire,
   * matching what `superdoc.fonts.getReport()` returns for the active document. Wired at
   * most once per editor (a create can fire twice).
   */
  #wireFontsChangedRelay(editor: Editor): void {
    if (!editor || typeof editor.on !== 'function') return;
    if (this.#fontsRelayEditors.has(editor)) return;
    this.#fontsRelayEditors.add(editor);
    editor.on('fonts-changed', (payload: FontsChangedPayload) => {
      if (this.#fontReportSurfaces(editor)) this.#deliverFontsChanged(payload);
    });
    // Replay the editor's already-emitted report once on wire (a fast or swapped document may
    // have emitted before this relay subscribed), under the SAME active-editor rule as the
    // live path so creating an inactive editor cannot replay a stale report into the cache.
    const renderer =
      (editor as { documentRenderer?: DocumentRendererRuntime | null; [key: string]: unknown }).documentRenderer ??
      ((editor as Record<string, unknown>)['presentation' + 'Editor'] as DocumentRendererRuntime | null | undefined);
    const cached = renderer?.getLastFontsChangedPayload?.();
    if (cached && this.#fontReportSurfaces(editor)) this.#deliverFontsChanged(cached);
  }

  /**
   * Whether a wired editor's font report may surface on the SuperDoc instance. Only the
   * active editor's report surfaces; before any editor is marked active, the sole editor's
   * does. After a document swap an old editor can still emit `fonts-changed` (e.g. a
   * timed-out font finishing later) or be re-created with a cached payload - the payload has
   * no document id to disambiguate, so surfacing it would poison the `onReport` cache for the
   * new document. Both the live event and the cached replay gate on this single rule.
   */
  #fontReportSurfaces(editor: Editor): boolean {
    return !this.activeEditor || editor === this.activeEditor;
  }

  /** Last font report delivered on this instance, so `fonts.onReport` can replay it. */
  #lastFontsChangedPayload: FontsChangedPayload | null = null;

  /** Cache then emit a font report, so a later `onReport` subscriber gets the current one. */
  #deliverFontsChanged(payload: FontsChangedPayload): void {
    this.#lastFontsChangedPayload = payload;
    this.emit('fonts-changed', payload);
  }

  /**
   * Triggered when an editor is destroyed
   */
  broadcastEditorDestroy() {
    this.emit('editorDestroy');
  }

  /**
   * Triggered when the comments sidebar is toggled
   */
  broadcastSidebarToggle(isOpened: boolean) {
    this.emit('sidebar-toggle', isOpened);
  }

  /** Warn when deprecated configuration has no current runtime behavior. */
  #validateLegacyConfig(): void {
    const hasLegacyExtensions = Array.isArray(this.config.editorExtensions) && this.config.editorExtensions.length > 0;

    if (hasLegacyExtensions) {
      console.warn(
        '[SuperDoc] `editorExtensions` is ignored by superdoc@2. ' +
          'Use `extensions` with `defineSuperDocExtension`. ProseMirror APIs such as `Node.create`, ' +
          '`Mark.create`, `addPmPlugins`, and custom schemas do not run in v2.',
      );
    }

    if (this.config.modules.ai) {
      console.warn(
        '[SuperDoc] `modules.ai` is deprecated and will be removed in v3. ' +
          'Use `ui.toolbar.customItems` for the action, make the model request in your application, ' +
          'and apply the result with `doc.insert()` or `doc.replace()`.',
      );
    }
  }

  /** @param args */
  #log(...args: unknown[]) {
    (console.debug ? console.debug : console.log)('🦋 🦸‍♀️ [superdoc]', ...args);
  }

  #fontsApi: SuperDocFontsApi | null = null;

  /**
   * Read-only font surface: the substitution- and load-aware report for the active
   * editor's document. Pulls on demand (the same report streams via `fonts-changed`).
   * Stable identity; the closures always read the current `activeEditor`. Returns empty
   * arrays when no editor is active or layout mode is off.
   */
  get fonts(): SuperDocFontsApi {
    if (!this.#fontsApi) {
      this.#fontsApi = {
        getReport: () => getActiveFontRuntime(this.activeEditor)?.getReport() ?? [],
        getMissingFonts: () => getActiveFontRuntime(this.activeEditor)?.getMissingFonts() ?? [],
        getDocumentFontOptions: () => getActiveFontRuntime(this.activeEditor)?.getDocumentFontOptions() ?? [],
        getFontFamilyOptions: () => getActiveFontRuntime(this.activeEditor)?.getFontFamilyOptions() ?? [],
        getDocumentFonts: () => getActiveFontRuntime(this.activeEditor)?.getDocumentFonts() ?? [],
        onReport: (callback) => {
          // Snapshot-then-subscribe: the report may already have resolved (it fires during
          // load, before a consumer subscribes - and a document swap creates a fresh editor),
          // so deliver the current one immediately, then stream future changes. The active
          // editor is the source of truth for "current": use ITS cached report so a snapshot
          // matches `getReport()` for the active document. The instance-level cache can hold a
          // PRIOR document's payload after an active-editor switch, so it is only a fallback
          // for when no editor is active. When an active editor exists but has not produced a
          // report yet, deliver nothing (the subscription catches its first one) rather than
          // replaying a stale prior-editor payload. Returns an unsubscribe.
          const activeEditor = this.activeEditor;
          const current = activeEditor
            ? (getActiveFontRuntime(activeEditor)?.getLastFontsChangedPayload?.() ?? null)
            : (this.#lastFontsChangedPayload ?? null);
          if (current) callback(current);
          this.on('fonts-changed', callback);
          return () => this.off('fonts-changed', callback);
        },
        // Active-editor scoped like the read methods, but these are WRITES. Route through the active
        // font runtime (v1 document renderer or v2 host facet); with no active editor, fail loudly
        // rather than silently no-op.
        map: (mappings) => {
          if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
            throw new TypeError("superdoc.fonts.map requires a mapping object, for example { Aptos: 'Carlito' }");
          }
          const rt = getActiveFontRuntime(this.activeEditor);
          if (!rt) throw new Error('superdoc.fonts.map requires an active editor');
          rt.map(mappings);
        },
        unmap: (families) => {
          const rt = getActiveFontRuntime(this.activeEditor);
          if (!rt) throw new Error('superdoc.fonts.unmap requires an active editor');
          rt.unmap(families);
        },
        add: (families) => {
          const rt = getActiveFontRuntime(this.activeEditor);
          if (!rt) throw new Error('superdoc.fonts.add requires an active editor');
          rt.add(families);
        },
        preload: (families) => {
          const rt = getActiveFontRuntime(this.activeEditor);
          if (!rt) throw new Error('superdoc.fonts.preload requires an active editor');
          return rt.preload(families);
        },
      };
    }
    return this.#fontsApi!;
  }

  /**
   * Clear the compatibility `activeEditor` projection and detach toolbar state.
   */
  #clearActiveEditorProjection() {
    // One transition, one notification. `removeDocument()` reaches this twice
    // for a single removal — once through the registry's synchronous
    // `active-runtime-unregistered` bridge, then again from its own check
    // against an `activeEditor` it captured before unregistering. Gating on
    // real state change keeps that, and any future double-clear, to a single
    // controller recompute instead of two rounds of observer updates.
    const hadActiveEditor = this.activeEditor !== null;

    this.#teardownV2FontsRelay();
    this.activeEditor = null;
    if (this.toolbar?.setActiveEditor) {
      this.toolbar.setActiveEditor(null as unknown as Editor);
    } else if (this.toolbar) {
      this.toolbar.activeEditor = null;
    }

    // Emitted from the shared primitive rather than its callers: runtime
    // unregistration and `removeDocument()` clear the projection directly,
    // and `HOST_EVENTS` carries no other signal for those paths, so a
    // caller-level emit would leave the controller reporting a document
    // that is already gone.
    if (hadActiveEditor) this.emit('active-editor-change');
  }

  /** Active v2 font facet `onChanged` unsubscribe, so a document swap never double-delivers. */
  #v2FontsUnsub: (() => void) | null = null;

  #teardownV2FontsRelay() {
    if (this.#v2FontsUnsub) {
      try {
        this.#v2FontsUnsub();
      } catch {
        /* ignore */
      }
      this.#v2FontsUnsub = null;
    }
  }

  /**
   * Relay a v2 active editor's font report up to the SuperDoc surface. v2 has no `editor.on`; the
   * host facet exposes `onChanged`, so subscribe to it (and replay its current payload once) so
   * `superdoc.on('fonts-changed')` / `superdoc.fonts.onReport()` behave the same as v1.
   */
  #wireV2FontsRelay(facade: ActiveEditor | null) {
    this.#teardownV2FontsRelay();
    const runtime = getActiveFontRuntime(facade);
    if (!runtime?.onChanged) return;
    const current = runtime.getLastFontsChangedPayload?.();
    if (current) this.#deliverFontsChanged(current);
    this.#v2FontsUnsub = runtime.onChanged((payload) => this.#deliverFontsChanged(payload));
  }

  /**
   * Reconcile the compatibility `activeEditor` projection with a registry
   * active-runtime change. SuperDoc owns the invariant that `activeEditor` is
   * either the active runtime's v2 facade, or `null` when the active runtime has
   * no supported projection.
   *
   * @param nextRuntimeId The newly active runtime id, or `null` when cleared.
   * @param projection The next runtime's legacy projection, if any.
   */
  #applyActiveRuntimeChange(nextRuntimeId: EditorRuntimeId | null, projection: unknown) {
    this.#applyingRuntimeActiveChange = true;
    try {
      if (nextRuntimeId === null) {
        this.#clearActiveEditorProjection();
        return;
      }
      const runtime = this.#editorRuntimeRegistry.get(nextRuntimeId);
      if (runtime?.kind === 'v2' && isV2ActiveEditorFacade(projection)) {
        this.#setActiveEditorCompatibilityProjection(projection);
      } else {
        // Fail closed: an unsupported projection must not leave a stale facade
        // attached to the wrong runtime.
        this.#clearActiveEditorProjection();
      }
    } finally {
      this.#applyingRuntimeActiveChange = false;
    }
  }

  /**
   * Centralized compatibility projection writer used by both the public entry
   * point and the registry-driven activation bridge.
   */
  #setActiveEditorCompatibilityProjection(editor: ActiveEditor | null) {
    if (isV2ActiveEditorFacade(editor)) {
      if (!this.#applyingRuntimeActiveChange && this.#editorRuntimeRegistry.getActive()) {
        this.#editorRuntimeRegistry.setActive(null, 'set-active-v2-facade');
      }
      // One transition, one notification. `setDocumentMode('editing')` and
      // `setDocumentMode('suggesting')` re-activate the first document's editor
      // unconditionally, so this runs with an unchanged identity on an ordinary
      // mode toggle. Consumers of the event release per-editor work, which for a
      // redundant emit would mean discarding a live search session and rebinding
      // every viewport observer for nothing.
      const previous = this.activeEditor;
      this.activeEditor = editor as unknown as Editor;
      // Re-wired unconditionally: both are idempotent and only ever reattach to
      // whatever is current, so they are safe on a repeat activation.
      // Stream the v2 document's font report into the SuperDoc `fonts-changed` surface.
      this.#wireV2FontsRelay(editor);
      // Keep the built-in toolbar authority tracking the active editor so its
      // projected command state refreshes when the active runtime changes.
      this.toolbar?.setActiveEditor?.(editor);
      if (previous !== this.activeEditor) this.emit('active-editor-change');
      return;
    }
    // `#clearActiveEditorProjection()` emits `active-editor-change` itself,
    // so every clear path is covered, not just this one.
    this.#clearActiveEditorProjection();
  }

  /**
   * Set the active editor compatibility projection. Registered runtimes route
   * through the registry so the active runtime and `activeEditor` cannot drift.
   *
   * @param editor The editor to set as active
   */
  setActiveEditor(editor: Editor | null): void {
    this.#setActiveEditorCompatibilityProjection(editor);
  }

  getV2FeatureMatrix() {
    return [
      {
        feature: 'source.docx-bytes',
        status: 'supported',
        reason:
          'SuperDoc normalizes File/Blob/ArrayBuffer/Uint8Array DOCX inputs for the separate DOCX Engine dependency',
      },
      {
        feature: 'source.url',
        status: 'supported',
        reason:
          'shell-owned source normalization resolves URL-backed DOCX inputs before opening the injected v2 editor',
      },
      {
        feature: 'source.blank',
        status: 'supported',
        reason: 'shell-owned blank-document seeding resolves to DOCX bytes before mounting the injected v2 editor',
      },
      {
        feature: 'execution.browser-worker',
        status: 'supported',
        reason:
          'the shipped public v2 shell opens DOCX documents through the browser-worker path by default when collaboration is not active',
      },
      {
        feature: 'distribution.cdn-iife',
        status: 'supported',
        reason:
          'the CDN/IIFE distribution ships the public bundle plus the emitted v2 browser-worker asset and opens DOCX documents through the worker-backed v2 runtime',
      },
      {
        feature: 'docx.open-render',
        status: 'supported',
        reason: 'superdoc@2 opens and renders DOCX documents through its DOCX Engine dependency',
      },
      {
        feature: 'docx.review-handles',
        status: 'supported',
        reason: 'Comment/tracked-change list + decide via v2 host handles',
      },
      {
        feature: 'shell.toolbar',
        status: 'supported',
        reason:
          'new SuperDoc({ toolbar }) mounts the rendered built-in toolbar shell and the superdoc.toolbar handle, both backed by the V2 command controller and the internal compatibility catalog. Explicit item-level limits stay fail-closed in the shared command matrix (for example search replace and copyFormat).',
      },
      {
        feature: 'shell.rich-formatting',
        status: 'supported',
        reason:
          'Rich inline, paragraph, and list formatting route through the V2 command controller and public Document API (format.* / styles.* / lists.*): bold, italic, underline, strikethrough, font family/size, text/highlight color, alignment, line spacing, linked styles, bullet/numbered lists, indent, and clear formatting.',
      },
      {
        feature: 'shell.comments-sidebar',
        status: 'supported',
        reason:
          'ui-phase3-002: v2 comments adapter routes create/reply/edit/resolve/delete through V2EditorHost.dispatch',
      },
      {
        feature: 'shell.comments-sidebar.reopen',
        status: 'supported',
        reason:
          'ui-phase3-002: v2 comments sidebar reopens resolved threads through the v2 comments adapter (activeEditor.doc.comments.patch({ status: "active" }))',
      },
      {
        feature: 'shell.tracked-change-sidebar',
        status: 'supported',
        reason: 'SD-3722: v2 tracked-change adapter lists and decides exact body, header/footer-part, and note targets',
      },
      {
        feature: 'shell.tracked-change-sidebar.bulk',
        status: 'supported',
        reason:
          "SD-4039/SD-4040: the shipped v2 command posture exposes all-story Accept All and Reject All through the canonical doc.trackChanges.decide({ target: { kind: 'all' } }) mutation",
      },
      {
        feature: 'shell.tracked-change-sidebar.non-body',
        status: 'supported',
        reason: 'SD-3722: public v2 shell hydrates and targets header/footer-part and note tracked changes',
      },
      {
        feature: 'shell.comments-sidebar.persistence',
        status: 'supported',
        reason:
          'ui-phase3-004: comment create/reply/edit/resolve/delete persist through SuperDoc.export() → re-mount via the v2 host save bridge',
      },
      {
        feature: 'shell.tracked-change-sidebar.persistence',
        status: 'supported',
        reason:
          'ui-phase3-004: tracked-change accept/reject persist through SuperDoc.export() → re-mount via the v2 host save bridge',
      },
      {
        feature: 'shell.comments-sidebar.author-required',
        status: 'supported',
        reason:
          'ui-phase3-004: v2 comments adapter surfaces commentCommandsReason=author-required from the host capability matrix; write controls disable and forced dispatch reports ok:false',
      },
      {
        feature: 'shell.find-replace',
        status: 'supported',
        reason:
          'Ctrl/Cmd+F opens the SuperDoc find/replace surface in v2; find/navigation/replace/replaceAll route through the single host search session (host.search) via ui.search, with replace failing closed in viewing/read-only mode',
      },
      {
        feature: 'shell.ai-writer',
        status: 'supported',
        reason:
          'built-in toolbar renders the modules.ai-gated AI writer and applies generated text through the public Document API facade',
      },
      {
        feature: 'shell.collaboration',
        status: 'supported',
        reason:
          'v2 single-doc y-websocket collaboration is wired through document.v2Collaboration, including collaboration-ready, awareness-update, and locked event bridges; arbitrary external { ydoc, provider } adapters remain unsupported',
      },
      {
        feature: 'shell.context-menu',
        status: 'supported',
        reason:
          'v2 renders the built-in right-click and slash context menu, forwards ui.contextMenu custom items, and honors ui.contextMenu: false for application-owned replacements',
      },
      {
        feature: 'shell.page-metrics',
        status: 'supported',
        reason:
          'ui-phase4-001: v2 page metrics snapshot ' +
          '(editorVersion: 2, documentId, renderEpoch, layoutGeneration, zoom, pages[], capabilities) ' +
          'available via superdoc.activeEditor.pageMetrics.{ getSnapshot, subscribe, setZoom, scrollToPage, ' +
          'revealBodyTarget, pageIndexForBodyTarget }',
      },
      {
        feature: 'shell.zoom',
        status: 'supported',
        reason:
          'ui-phase4-001: SuperDoc.setZoom routes to V2EditorHost.setZoom in v2 mode; ' +
          'single CSS-transform wrapper applies scale to the painted document, page metrics ' +
          'viewport coords scale with the same zoom value',
      },
      {
        feature: 'shell.ruler-page-margins',
        status: 'supported',
        reason:
          'ui-phase4-002: v2 ruler renders against the V2PageMetricsSnapshot and dispatches margin drags through ' +
          'a narrow v2 page-layout bridge (`activeEditor.pageLayout.setMargins(...)`) backed by ' +
          '`doc.sections.setPageMargins(...)`. The v2 page metrics snapshot now reports ' +
          '`capabilities.marginEdit = { supported: true }`',
      },
      {
        feature: 'shell.custom-extensions',
        status: 'supported',
        reason:
          'superdoc@2 supports customer extensions through `extensions` + `defineSuperDocExtension`; ' +
          'command execution and diagnostics are exposed through the narrow `activeEditor.extensions` facet. ' +
          'Legacy ProseMirror `editorExtensions` are ignored in v2.',
      },
      { feature: 'pdf.viewer', status: 'supported', reason: 'editorVersion ignored for PDF documents' },
      { feature: 'html.viewer', status: 'supported', reason: 'editorVersion ignored for HTML documents' },
    ];
  }

  get v2() {
    if (this.editorVersion !== 2) return null;
    return {
      version: 2,
      featureMatrix: this.getV2FeatureMatrix(),
    };
  }

  /**
   * Register a mounted editor runtime with the shell-owned registry.
   *
   * @param runtime
   * @internal
   */
  private registerEditorRuntime(runtime: EditorRuntime): void {
    this.#editorRuntimeRegistry.register(runtime);
  }

  /**
   * Unregister a mounted editor runtime by id. If it was active, active state
   * clears and the registry does not auto-promote a different runtime.
   *
   * @param runtimeId
   * @returns Whether a runtime was removed.
   * @internal
   */
  private unregisterEditorRuntime(runtimeId: EditorRuntimeId): boolean {
    return this.#editorRuntimeRegistry.unregister(runtimeId);
  }

  /**
   * Return the active editor runtime, or null.
   *
   * @internal
   */
  private getActiveRuntime(): EditorRuntime | null {
    return this.#editorRuntimeRegistry.getActive();
  }

  /**
   * Select the active editor runtime, or clear it with null.
   *
   * @param runtimeId
   * @param reason
   * @internal
   */
  private setActiveRuntime(runtimeId: EditorRuntimeId | null, reason: string): void {
    this.#editorRuntimeRegistry.setActive(runtimeId, reason);
  }

  /**
   * Resolve which mounted runtime owns a DOM event target.
   *
   * @param target
   * @internal
   */
  private resolveRuntimeFromEventTarget(target: EventTarget | null): EditorRuntime | null {
    return this.#editorRuntimeRegistry.resolveFromEventTarget(target);
  }

  /**
   * Resolve and activate the runtime that owns a DOM event target.
   *
   * @param target
   * @param reason
   * @returns Whether a runtime was resolved and activated.
   * @internal
   */
  private activateRuntimeFromEventTarget(target: EventTarget | null, reason: string): boolean {
    const runtime = this.#editorRuntimeRegistry.resolveFromEventTarget(target);
    if (!runtime) return false;
    this.#editorRuntimeRegistry.setActive(runtime.id, reason);
    return true;
  }

  /**
   * Toggle the ruler visibility for document editors.
   *
   */
  toggleRuler(): void {
    // Guard before mutating `this.config.rulers` so a pre-ready call
    // throws without partially flipping the config.
    const store = this.#requireSuperdocStore('toggleRuler');
    this.config.rulers = !this.config.rulers;
    store.documents.forEach((doc: RuntimeDocument) => {
      // In Pinia store, refs are auto-unwrapped, so rulers is a plain boolean
      doc.rulers = this.config.rulers;
    });
    this.toolbar?.updateToolbarState?.();
  }

  /**
   * Determine whether the current configuration allows a given permission.
   * Used by downstream consumers (toolbar, context menu, commands) to keep
   * tracked-change affordances consistent with customer overrides.
   *
   * The `comment` and `trackedChange` fields on the input carry open
   * index signatures because the function forwards the full payload to
   * `isAllowed()`; tracked-change payloads from the editor include
   * `type`, `attrs`, `from`, `to`, `segments`, and consumer comment
   * shapes vary. The fields read directly here are documented on the
   * input type itself.
   *
   * @see {@link CanPerformPermissionParams} for the input shape.
   */
  canPerformPermission({
    permission,
    role = this.config.role,
    isInternal = this.config.isInternal,
    comment = null,
    trackedChange = null,
  }: CanPerformPermissionParams = {}): boolean {
    if (!permission) return false;

    let resolvedComment = comment ?? trackedChange?.comment ?? null;

    const commentId = trackedChange?.commentId || trackedChange?.id;
    if (!resolvedComment && commentId && this.commentsStore?.getComment) {
      const storeComment = this.commentsStore.getComment(commentId);
      const getValues = storeComment?.getValues;
      resolvedComment = typeof getValues === 'function' ? getValues.call(storeComment) : storeComment;
    }

    const context = {
      superdoc: this,
      currentUser: this.config.user,
      comment: resolvedComment ?? null,
      trackedChange: trackedChange ?? null,
    };

    return isAllowed(permission, role as string, isInternal as boolean, context);
  }

  #addToolbar() {
    const toolbarModuleConfig = this.config.modules?.toolbar;
    const toolbarModule = toolbarModuleConfig && typeof toolbarModuleConfig === 'object' ? toolbarModuleConfig : {};
    const toolbarUi = this.#uiConfig.toolbar;
    this.toolbarElement = toolbarUi.container ?? undefined;

    // A toolbar is requested when the resolved profile says the surface is on
    // AND the consumer named it somewhere: a container, `modules.toolbar`, or
    // a `ui.toolbar` entry. `ui.toolbar` alone stays enabled-by-default, so
    // asking the profile on its own would create a handle for every instance.
    const uiBlock = this.config.ui;
    const namedInUiBlock = typeof uiBlock === 'object' && uiBlock !== null && uiBlock.toolbar !== undefined;
    const toolbarRequested =
      toolbarUi.enabled &&
      (Boolean(toolbarUi.container) ||
        toolbarModuleConfig === true ||
        (toolbarModuleConfig != null && typeof toolbarModuleConfig === 'object') ||
        namedInUiBlock);
    if (!toolbarRequested) {
      this.toolbar = null;
      return;
    }

    // V2 toolbar parity (phase 3): mount the real rendered built-in toolbar
    // shell. It renders the legacy built-in toolbar DOM (preserving item names
    // and `data-item="btn-*"` selectors) and exposes the documented
    // `superdoc.toolbar` handle (`getToolbarItemByName`,
    // `getToolbarItemByGroup`, `updateToolbarState`, `destroy`, `on`/`off`).
    //
    // The shell does not own command truth, nor the controller: it subscribes
    // to `this.ui` for every command's enable/active/value state and routes
    // every execution through it, mapping legacy item names onto canonical V2
    // command ids through the one compatibility catalog. `superdoc.toolbar.ui`
    // is an alias of `superdoc.ui`, not a second controller.
    //
    // Construction is defensive: a toolbar failure must never regress document
    // mount, so the handle falls back to `null` rather than throwing out of
    // `#init`.
    try {
      this.toolbar = createBuiltInToolbar({
        ...toolbarModule,
        ...toolbarUi.options,
        selector: this.toolbarElement,
        superdoc: this,
        editor: this.activeEditor,
        role: this.config.role,
        isDev: this.isDev,
        documentMode: this.config.documentMode,
        // Composition and ordering are separate settings with separate shapes.
        // Feeding one normalized field to both is what emptied the toolbar.
        groups: toolbarUi.options.groups,
        toolbarGroups: toolbarUi.options.toolbarGroups,
        icons: toolbarUi.options.icons,
        texts: toolbarUi.options.texts,
        uiDisplayFallbackFont: this.config.uiDisplayFallbackFont,
      }) as unknown as ToolbarLike;
    } catch (error) {
      console.warn('[SuperDoc] built-in toolbar mount failed', error);
      this.toolbar = null;
    }
  }

  /**
   * Add a comments list to the superdoc
   * Requires the comments module to be enabled
   * @param element The DOM element to render the comments list in
   */
  addCommentsList(element: HTMLElement) {
    if (!this.config?.modules?.comments || this.config.role === 'viewer') return;
    this.commentsList?.close();
    if (element) this.config.modules.comments.element = element;
    this.commentsList = new SuperComments(this.config.modules?.comments, this);
    if (this.config.onCommentsListChange) this.config.onCommentsListChange({ isRendered: true });
    this.emit('comments-list-change', { isRendered: true });
  }

  /**
   * Remove the comments list from the superdoc
   */
  removeCommentsList() {
    if (this.commentsList) {
      this.commentsList.close();
      this.commentsList = null;
      if (this.config.onCommentsListChange) this.config.onCommentsListChange({ isRendered: false });
      this.emit('comments-list-change', { isRendered: false });
    }
  }

  /**
   * Scroll the document to a given comment by id.
   *
   * @param commentId The comment id
   * @param [options]
   * @returns Whether a matching element was found
   */
  scrollToComment(commentId: string, options: { behavior?: ScrollBehavior; block?: ScrollLogicalPosition } = {}) {
    const commentsConfig = this.config?.modules?.comments;
    // `commentsConfig` can be `false | object | undefined`; `!commentsConfig`
    // already covers both `false` and `undefined`, so the secondary
    // `=== false` check below is redundant.
    if (!commentsConfig) return false;
    if (!commentId || typeof commentId !== 'string') return false;

    const root = this.element || document;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(commentId) : commentId.replace(/"/g, '\\"');
    const element = root.querySelector(`[data-comment-ids*="${escaped}"]`);
    if (!element) return false;

    const { behavior = 'smooth', block = 'start' } = options ?? {};
    element.scrollIntoView({ behavior, block });
    this.commentsStore?.setActiveComment?.(this, commentId);
    return true;
  }

  /**
   * Navigate to a block, bookmark, comment, or tracked change target.
   *
   * Story-aware navigation is currently supported for bookmark and tracked
   * change targets. Block and comment targets are body-only.
   *
   * @deprecated Use the target-specific navigation APIs on `superdoc.ui`. This method will be removed in v3.
   * @returns Whether the target was found and navigated to.
   */
  async navigateTo(target: NavigableAddress): Promise<boolean> {
    const storeDocs = this.superdocStore?.documents;
    if (!storeDocs?.length) return false;
    const documentRuntime = storeDocs[0].getDocumentRuntime?.();
    if (!documentRuntime?.navigateTo) return false;
    return documentRuntime.navigateTo(target);
  }

  /**
   * Scroll to any document element by its ID.
   *
   * Pass any element ID — paragraph nodeId, comment entityId, or tracked
   * change entityId. The method resolves the element type automatically
   * and scrolls to it.
   *
   * @param elementId - The element's stable ID.
   * @returns Whether the element was found and scrolled to.
   *
   * @example
   * // Navigate to a paragraph by its nodeId
   * await superdoc.scrollToElement('5AF80E61');
   *
   * // Navigate to a comment by its entityId
   * await superdoc.scrollToElement('imported-25def254');
   */
  async scrollToElement(elementId: string): Promise<boolean> {
    const storeDocs = this.superdocStore?.documents;
    if (!storeDocs?.length) return false;
    const documentRuntime = storeDocs[0].getDocumentRuntime?.();
    if (!documentRuntime?.scrollToElement) return false;
    return documentRuntime.scrollToElement(elementId);
  }

  /**
   * Toggle the custom context menu globally.
   * Updates both flow editors and DocumentRendererRuntime instances so downstream listeners can short-circuit early.
   */
  setDisableContextMenu(disabled = true) {
    // The profile is a veto, not a starting point: under `ui: false` or
    // `ui.contextMenu: false` the consumer forbade the surface, so re-enabling
    // it at runtime would push `false` past a decision they already made. The
    // suppressing direction stays available either way.
    if (!disabled && this.#uiConfig.contextMenu.suppressed) return;
    const nextValue = Boolean(disabled);
    if (this.config.disableContextMenu === nextValue) return;
    this.config.disableContextMenu = nextValue;

    this.superdocStore?.documents?.forEach((doc: RuntimeDocument) => {
      const documentRuntime = doc.getDocumentRuntime?.();
      if (documentRuntime?.setContextMenuDisabled) {
        documentRuntime.setContextMenuDisabled(nextValue);
      }
      const editor = doc.getEditor?.();
      if (editor?.setOptions) {
        editor.setOptions({ disableContextMenu: nextValue });
      }
    });
  }

  /**
   * SD-2454: Toggle bookmark bracket indicators (opt-in, off by default).
   * Matches Word's "Show bookmarks" option. Triggers a re-layout on change
   * because the brackets are visible characters participating in text flow.
   */
  setShowBookmarks(show = true) {
    const nextValue = Boolean(show);
    const layoutOptions = (this.config.layoutEngineOptions = this.config.layoutEngineOptions || {});
    if (layoutOptions.showBookmarks === nextValue) return;
    layoutOptions.showBookmarks = nextValue;

    this.superdocStore?.documents?.forEach((doc: RuntimeDocument) => {
      const documentRuntime = doc.getDocumentRuntime?.();
      documentRuntime?.setShowBookmarks?.(nextValue);
    });
  }

  /**
   * Toggle nonprinting formatting marks (spaces, tabs, paragraph marks) in the
   * rendered layout. This is a view-only setting and is not exported to DOCX.
   */
  setShowFormattingMarks(show = true) {
    const nextValue = Boolean(show);
    const layoutOptions = (this.config.layoutEngineOptions = this.config.layoutEngineOptions || {});
    if (layoutOptions.showFormattingMarks === nextValue) return;
    layoutOptions.showFormattingMarks = nextValue;

    this.superdocStore?.documents?.forEach((doc: RuntimeDocument) => {
      const documentRuntime = doc.getDocumentRuntime?.();
      documentRuntime?.setShowFormattingMarks?.(nextValue);
    });

    this.emit('formatting-marks-change', { showFormattingMarks: nextValue, superdoc: this });
    this.toolbar?.updateToolbarState?.();
  }

  /**
   * Toggle nonprinting formatting marks from their current state.
   */
  toggleFormattingMarks() {
    const currentValue = Boolean(this.config.layoutEngineOptions?.showFormattingMarks);
    this.setShowFormattingMarks(!currentValue);
  }

  /**
   * Set the document mode.
   */
  setDocumentMode(type: DocumentMode) {
    if (!type) return;

    // Guard before mutating `this.config.documentMode` so a pre-ready
    // call throws without partially advancing the mode and triggering
    // `#syncViewingVisibility` / tracked-change preference writes.
    this.#requireReady('setDocumentMode');

    const requestedMode = type.toLowerCase() as DocumentMode;
    const effectiveMode =
      this.config.role === 'viewer'
        ? 'viewing'
        : this.config.role === 'suggester' && requestedMode === 'editing'
          ? 'suggesting'
          : requestedMode;
    this.config.documentMode = effectiveMode;
    normalizeTrackChangesConfig(this.config);
    this.#syncViewingVisibility();

    const types = {
      viewing: () => this.#setModeViewing(),
      editing: () => this.#setModeEditing(),
      suggesting: () => this.#setModeSuggesting(),
    };

    if (types[effectiveMode]) {
      types[effectiveMode]();
      this.emit('document-mode-change', { documentMode: effectiveMode });
    }
  }

  /**
   * Set the document mode on a document's editor (DocumentRendererRuntime or Editor).
   * Tries DocumentRendererRuntime first, falls back to Editor for backward compatibility.
   * @param doc - The document object
   * @param mode - The document mode ('editing', 'viewing', 'suggesting')
   */
  #applyDocumentMode(doc: RuntimeDocument, mode: DocumentMode) {
    const documentId = typeof doc.id === 'string' && doc.id.length > 0 ? doc.id : null;
    if (documentId) {
      const runtimes = this.#editorRuntimeRegistry.getAllByDocumentId(documentId);
      if (runtimes.length > 0) {
        for (const runtime of runtimes) {
          runtime.setDocumentMode(mode);
        }
        return;
      }
    }

    const documentRuntime = typeof doc.getDocumentRuntime === 'function' ? doc.getDocumentRuntime() : null;
    if (typeof documentRuntime?.setDocumentMode === 'function') {
      documentRuntime.setDocumentMode(mode);
      return;
    }
    const editor = typeof doc.getEditor === 'function' ? doc.getEditor() : null;
    // v2 facades omit setDocumentMode (mode changes ride the runtime registry
    // above), so this legacy fallback only fires for editors that carry it.
    if (editor && typeof editor.setDocumentMode === 'function') {
      editor.setDocumentMode(mode);
    }
  }

  /**
   * Update tracked-change rendering for mounted documents.
   * @deprecated replaceWith=`setViewingOptions()` for viewer projection compat-indefinitely=v2 API compatibility
   * @param [preferences]
   */
  setTrackedChangesPreferences(preferences?: { mode?: 'review' | 'original' | 'final' | 'off'; enabled?: boolean }) {
    if (typeof preferences?.enabled === 'boolean') {
      this.config.modules.trackChanges = {
        ...this.config.modules.trackChanges,
        enabled: preferences.enabled,
      };
    }
    this.#applyTrackedChangesRenderOptions(preferences);
  }

  #applyTrackedChangesRenderOptions(options?: { mode?: 'review' | 'original' | 'final' | 'off'; enabled?: boolean }) {
    const normalized = options && Object.keys(options).length ? { ...options } : undefined;
    if (!this.config.layoutEngineOptions) {
      this.config.layoutEngineOptions = {};
    }
    this.config.layoutEngineOptions.trackedChanges = normalized;
    this.superdocStore?.documents?.forEach((doc: RuntimeDocument) => {
      let appliedToRuntime = false;
      const documentId = typeof doc.id === 'string' && doc.id.length > 0 ? doc.id : null;
      if (documentId) {
        for (const runtime of this.#editorRuntimeRegistry.getAllByDocumentId(documentId)) {
          runtime.setTrackedChangesRenderOptions(normalized);
          appliedToRuntime = true;
        }
      }
      if (appliedToRuntime) return;
      const documentRuntime = typeof doc.getDocumentRuntime === 'function' ? doc.getDocumentRuntime() : null;
      if (documentRuntime?.setTrackedChangesOverrides) {
        documentRuntime.setTrackedChangesOverrides(normalized);
      }
    });
  }

  /** Update what viewing mode shows. Omitted fields keep their current values. */
  setViewingOptions(options: ViewingOptions) {
    if (!options || typeof options !== 'object') return;
    this.#requireReady('setViewingOptions');

    const previousViewing = resolveViewingState(this.config, this.#compatibilityViewingRenderMode);
    const next: ViewingOptions = { ...this.config.viewing };
    const hasCommentsUpdate = typeof options.comments === 'boolean';
    const hasTrackedChangesUpdate = isViewingTrackedChangesMode(options.trackedChanges);
    if (!hasCommentsUpdate && !hasTrackedChangesUpdate) return;
    if (hasCommentsUpdate) next.comments = options.comments;
    if (hasTrackedChangesUpdate) next.trackedChanges = options.trackedChanges;

    this.config.viewing = next;
    if (typeof next.comments === 'boolean') {
      this.config.comments = { ...this.config.comments, visible: next.comments };
    }
    if (hasTrackedChangesUpdate) normalizeTrackChangesConfig(this.config);

    this.#syncViewingVisibility();
    if (this.config.documentMode === 'viewing') {
      const nextViewing = resolveViewingState(this.config, this.#compatibilityViewingRenderMode);
      const hadVisibleReviewInfo = previousViewing.comments || previousViewing.trackChangesVisible;
      const hasVisibleReviewInfo = nextViewing.comments || nextViewing.trackChangesVisible;
      this.#setModeViewing({
        updateTrackedChangesProjection: hasTrackedChangesUpdate,
        updateCommentVisibility: hadVisibleReviewInfo !== hasVisibleReviewInfo,
      });
    }
  }

  #setModeEditing() {
    if (this.config.role !== 'editor') return this.#setModeSuggesting();
    const store = this.#requireSuperdocStore('setDocumentMode');
    if (store.documents.length > 0) {
      const firstEditor = store.documents[0]?.getEditor();
      if (firstEditor) this.setActiveEditor(firstEditor);
    }

    // Enable tracked changes for editing mode
    this.#applyTrackedChangesRenderOptions({ mode: 'review', enabled: true });

    store.documents.forEach((doc: RuntimeDocument) => {
      doc.restoreComments?.();
      this.#applyDocumentMode(doc, 'editing');
    });
  }

  #setModeSuggesting() {
    if (!['editor', 'suggester'].includes(this.config.role ?? '')) return this.#setModeViewing();
    const store = this.#requireSuperdocStore('setDocumentMode');
    if (store.documents.length > 0) {
      const firstEditor = store.documents[0]?.getEditor();
      if (firstEditor) this.setActiveEditor(firstEditor);
    }

    // Enable tracked changes for suggesting mode
    this.#applyTrackedChangesRenderOptions({ mode: 'review', enabled: true });

    store.documents.forEach((doc: RuntimeDocument) => {
      doc.restoreComments?.();
      this.#applyDocumentMode(doc, 'suggesting');
    });
  }

  #setModeViewing(options: { updateTrackedChangesProjection?: boolean; updateCommentVisibility?: boolean } = {}) {
    // Capture the store at the top so a pre-ready call (either direct
    // or through `setDocumentMode`) throws before tracked-change render options
    // mutates `config.layoutEngineOptions.trackedChanges`.
    const store = this.#requireSuperdocStore('setDocumentMode');

    // `this.toolbar` infers as a concrete toolbar type from the field's
    // first assignment in `#addToolbar` (the `null` placeholder before
    // the toolbar is constructed). `#addToolbar` runs once during
    // init and unconditionally installs the instance, so by the time
    // mode changes are reachable the toolbar is non-null. The guard
    // keeps TS satisfied and stays a no-op if a future destroy/teardown
    // ever clears the field.
    if (this.toolbar?.setActiveEditor) {
      this.toolbar.setActiveEditor(null as unknown as Editor);
    } else if (this.toolbar) {
      this.toolbar.activeEditor = null;
    }

    const viewing = resolveViewingState(this.config, this.#compatibilityViewingRenderMode);
    const commentsVisible = viewing.comments;
    const trackChangesVisible = viewing.trackChangesVisible;

    if (options.updateTrackedChangesProjection !== false) {
      this.#applyTrackedChangesRenderOptions({
        mode: viewing.renderMode,
        enabled: this.config.modules.trackChanges?.enabled ?? true,
      });
    }

    if (options.updateCommentVisibility !== false && !commentsVisible && !trackChangesVisible) {
      this.commentsStore?.clearEditorCommentPositions?.();
    }

    store.documents.forEach((doc: RuntimeDocument) => {
      if (options.updateCommentVisibility !== false) {
        if (commentsVisible || trackChangesVisible) {
          doc.restoreComments?.();
        } else {
          doc.removeComments?.();
        }
      }
      this.#applyDocumentMode(doc, 'viewing');
    });
  }

  #syncViewingVisibility() {
    const viewing = resolveViewingState(this.config, this.#compatibilityViewingRenderMode);
    const commentsVisible = viewing.comments;
    const trackChangesVisible = viewing.trackChangesVisible;
    const isViewingMode = this.config.documentMode === 'viewing';
    const shouldRenderCommentsInViewing = commentsVisible || trackChangesVisible;
    if (this.commentsStore?.setViewingVisibility) {
      this.commentsStore.setViewingVisibility({
        documentMode: this.config.documentMode,
        commentsVisible,
        trackChangesVisible,
      });
    }

    const docs = this.superdocStore?.documents;
    if (Array.isArray(docs) && docs.length > 0) {
      docs.forEach((doc) => {
        const documentRuntime = typeof doc.getDocumentRuntime === 'function' ? doc.getDocumentRuntime() : null;
        if (documentRuntime?.setViewingCommentOptions) {
          documentRuntime.setViewingCommentOptions({
            emitCommentPositionsInViewing: isViewingMode && shouldRenderCommentsInViewing,
            enableCommentsInViewing: isViewingMode && commentsVisible,
          });
        }
      });
    }
  }
  /**
   * Search for text or regex in the active editor.
   *
   * Returns `undefined` when there is no active editor; otherwise
   * returns the array of matches the underlying search command produced
   * (possibly empty).
   *
   * @param text The text or regex to search for
   * @returns The search results, or `undefined` when there is no active editor
   *   or the active legacy projection exposes no `search` command (e.g. a
   *   v2-shaped runtime with `commands: null`).
   */
  search(text: string | RegExp): SearchMatch[] | undefined {
    const commands = this.activeEditor?.commands;
    const search = commands?.search;
    if (typeof search !== 'function') return undefined;
    return search.call(commands, text, { searchModel: 'visible' });
  }

  /**
   * Go to the next search result.
   *
   * Pass back a match returned by `superdoc.search()` unchanged; the
   * runtime resolves its current document position via the embedded
   * tracker ids.
   *
   * @param match The match object returned by `superdoc.search()`.
   * @returns Whether the command dispatched, or `undefined` when there is no
   *   active editor or the active legacy projection exposes no
   *   `goToSearchResult` command (e.g. a v2-shaped runtime with `commands:
   *   null`).
   */
  goToSearchResult(match: SearchMatch): boolean | undefined {
    const commands = this.activeEditor?.commands;
    const goToSearchResult = commands?.goToSearchResult;
    if (typeof goToSearchResult !== 'function') return undefined;
    return Boolean(goToSearchResult.call(commands, match));
  }

  /**
   * Get the current zoom level as a percentage (e.g., 100 for 100%)
   * @returns The current zoom level as a percentage
   * @example
   * const zoom = superdoc.getZoom(); // Returns 100, 150, 200, etc.
   */
  getZoom() {
    return this.superdocStore?.activeZoom ?? 100;
  }

  /**
   * Set the zoom level for all documents and switch the zoom mode to
   * `manual` (an explicit numeric zoom expresses intent to leave
   * `fit-width`; use `setZoomMode('fit-width')` to re-enter fitting).
   * Updates the centralized activeZoom state, which propagates to all
   * presentation editors, PDF viewers, and whiteboard layers via the Vue watcher.
   * @param percent - The zoom level as a percentage (e.g., 100, 150, 200)
   * @example
   * superdoc.setZoom(150); // Set zoom to 150%, mode becomes 'manual'
   * superdoc.setZoom(50);  // Set zoom to 50%
   */
  setZoom(percent: number) {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) {
      console.warn('[SuperDoc] setZoom expects a positive number representing percentage');
      return;
    }
    // Before async init attaches the store there is nothing to write, and
    // emitting anyway would tell listeners about a zoom that never
    // happened. Use config.zoom.initial for pre-init zoom instead.
    if (!this.superdocStore) {
      console.warn('[SuperDoc] setZoom called before initialization; use config.zoom.initial for the starting zoom');
      return;
    }

    // Update store — SuperDoc.vue's activeZoom watcher propagates the zoom
    // to all DocumentRendererRuntime instances via DocumentRendererRuntime.setGlobalZoom().
    this.superdocStore.activeZoom = percent;
    this.superdocStore.zoomMode = 'manual';

    this.emit('zoomChange', { zoom: percent, mode: 'manual' });
  }

  /**
   * Switch the zoom mode. `fit-width` continuously re-fits the
   * document to the available container width (clamped by
   * `config.zoom.fitWidth`); `manual` holds the current value.
   * Switching to `fit-width` applies the fit immediately when
   * viewport metrics are available. Emits `zoomChange` (with the
   * current value) so zoom UIs observe mode-only transitions; a
   * same-mode call is a no-op.
   * @param mode - The zoom mode: `'manual'` or `'fit-width'`
   * @example
   * superdoc.setZoomMode('fit-width'); // start fitting to the container
   * superdoc.setZoomMode('manual');    // hold the current zoom value
   */
  setZoomMode(mode: SuperDocZoomMode) {
    if (mode !== 'manual' && mode !== 'fit-width') {
      console.warn("[SuperDoc] setZoomMode expects 'manual' or 'fit-width'");
      return;
    }
    // Before async init attaches the store the mode cannot persist, and
    // emitting anyway would advertise a mode change that never happened.
    // Use config.zoom.mode for the starting mode instead.
    if (!this.superdocStore) {
      console.warn('[SuperDoc] setZoomMode called before initialization; use config.zoom.mode for the starting mode');
      return;
    }
    if (this.superdocStore.zoomMode === mode) return;
    this.superdocStore.zoomMode = mode;

    if (mode === 'fit-width') {
      const metrics = this.superdocStore.viewportMetrics;
      if (metrics) {
        const target = computeAppliedFitZoom(
          metrics.availableWidth,
          metrics.documentWidth,
          resolveFitWidthOptions(this.config.zoom?.fitWidth),
        );
        if (target !== null) this.superdocStore.activeZoom = target;
      }
    }

    this.emit('zoomChange', { zoom: this.getZoom(), mode });
  }

  /**
   * Get a snapshot of the current zoom state: mode, value, the latest
   * computed fit zoom (null before the first viewport measurement),
   * and the effective fit bounds.
   * @returns The current zoom state snapshot
   * @example
   * const { mode, value, fitZoom } = superdoc.getZoomState();
   */
  getZoomState(): SuperDocZoomState {
    // Same resolver the fit policy applies, so the reported bounds cannot
    // drift from the clamping behavior.
    const fit = resolveFitWidthOptions(this.config.zoom?.fitWidth);
    return {
      mode: this.superdocStore?.zoomMode ?? 'manual',
      value: this.superdocStore?.activeZoom ?? 100,
      fitZoom: this.superdocStore?.viewportMetrics?.fitZoom ?? null,
      min: fit.min,
      max: fit.max,
    };
  }

  /**
   * Get the latest viewport measurements: the width available to the
   * document, the document's base page width at 100% zoom, and the
   * unclamped fit zoom. Returns `null` until the first measurement
   * (editors still mounting). Subscribe to `viewport-change` (or pass
   * `Config.onViewportChange`) for updates.
   * @returns The latest viewport metrics, or `null` before the first measurement
   * @example
   * const metrics = superdoc.getViewportMetrics();
   * if (metrics) superdoc.setZoom(Math.min(100, metrics.fitZoom));
   */
  getViewportMetrics(): SuperDocViewportMetrics | null {
    return this.superdocStore?.viewportMetrics ?? null;
  }

  /**
   * Get the current measurement unit for rulers and measurement fields
   * (`'in'` or `'cm'`). Defaults to `'in'` before initialization.
   * @returns The current measurement unit
   * @example
   * const unit = superdoc.getMeasurementUnit(); // 'in' | 'cm'
   */
  getMeasurementUnit(): SuperDocMeasurementUnit {
    return this.superdocStore?.measurementUnit ?? 'in';
  }

  /**
   * Set the document-wide measurement unit for rulers and measurement fields
   * (Word's "measurement units" preference). Updates the centralized state,
   * which propagates to the ruler and header/footer measurement fields via the
   * Vue watcher in `SuperDoc.vue`.
   * @param unit - `'in'` for inches or `'cm'` for centimetres
   * @example
   * superdoc.setMeasurementUnit('cm'); // ruler + measurement fields switch to cm
   */
  setMeasurementUnit(unit: SuperDocMeasurementUnit): void {
    if (unit !== 'in' && unit !== 'cm') {
      console.warn("[SuperDoc] setMeasurementUnit expects 'in' or 'cm'");
      return;
    }
    // Before async init attaches the store there is nothing to write. Use
    // config.measurementUnit for the starting unit instead.
    if (!this.superdocStore) {
      console.warn(
        '[SuperDoc] setMeasurementUnit called before initialization; use config.measurementUnit for the starting unit',
      );
      return;
    }
    if (this.superdocStore.measurementUnit === unit) return;
    this.superdocStore.measurementUnit = unit;
    // Notify UI subscribers (toolbar / custom-UI command state) so a
    // programmatic change reflects immediately, mirroring setZoom's
    // 'zoomChange' emit rather than waiting for an unrelated event.
    this.emit('measurement-unit-change', { unit });
  }

  /**
   * Set the document to locked or unlocked
   */
  setLocked(lock = true): void {
    const activeEditor = this.activeEditor as ActiveEditor | null;
    if (isV2ActiveEditorFacade(activeEditor) && typeof activeEditor.lock?.setLocked === 'function') {
      activeEditor.lock.setLocked(lock, lock ? { ...this.user } : null);
      const snapshot = activeEditor.lock.getSnapshot?.();
      if (snapshot) {
        this.#applyLockState(Boolean(snapshot.isLocked), this.#normalizeLockedBy(snapshot.lockedBy ?? null));
      }
      return;
    }

    this.config.documents.forEach((doc: RuntimeDocument) => {
      // setLocked is a collaboration-only API; the surrounding flow only
      // calls it once each document has a Yjs doc attached. Cast away the
      // optional shape on the public Document typedef without changing
      // runtime behavior.
      const ydoc = doc.ydoc as Y.Doc | undefined;
      if (!ydoc) return;
      const metaMap = ydoc.getMap('meta');
      ydoc.transact(() => {
        metaMap.set('locked', lock);
        if (lock) metaMap.set('lockedBy', this.user);
        else metaMap.delete('lockedBy');
      });
    });
    this.#applyLockState(lock, lock ? this.user : null);
  }

  /**
   * Get the HTML content of all editors
   * @returns The HTML content of all editors
   */
  getHTML(options: Parameters<Editor['getHTML']>[0] = {}) {
    const editors: Editor[] = [];
    this.#requireSuperdocStore('getHTML').documents.forEach((doc: RuntimeDocument) => {
      const editor = doc.getEditor?.();
      if (editor) {
        editors.push(editor);
      }
    });

    return editors.map((editor) => editor.getHTML(options));
  }

  /**
   * Lock the current superdoc and emit the `locked` event.
   *
   * @param [isLocked] Whether the superdoc is locked. Defaults to `false`.
   * @param [lockedBy] The user who locked the superdoc, or `null`
   *   when unlocking (or when no user is known). Defaults to `null`.
   */
  lockSuperdoc(isLocked: boolean = false, lockedBy: User | null = null): void {
    this.#applyLockState(isLocked, lockedBy);
  }

  /**
   * Export the superdoc to a file
   * @param params - Export configuration
   */
  async export(
    {
      exportType = ['docx'],
      commentsType = 'external',
      exportedName,
      additionalFiles = [],
      additionalFileNames = [],
      isFinalDoc = false,
      triggerDownload = true,
      fieldsHighlightColor = null,
    }: ExportParams = {} as ExportParams,
  ) {
    if (!Array.isArray(exportType) || exportType.length !== 1 || exportType[0] !== 'docx') {
      throw new TypeError('SuperDoc.export() only supports exportType: ["docx"].');
    }

    // Get the docx files first
    const baseFileName = exportedName ? cleanName(exportedName) : cleanName(this.config.title as string);
    const docxFiles = await this.exportEditorsToDOCX({ commentsType, isFinalDoc, fieldsHighlightColor });
    const blobsToZip = [...additionalFiles];
    const filenames = [...additionalFileNames];

    // If we are exporting docx files, add them to the zip
    if (exportType.includes('docx')) {
      docxFiles.forEach((blob) => {
        // exportDocx default overload returns Blob; the wider `string | Blob | null`
        // shows up only when callers opt into other export modes (not used here).
        blobsToZip.push(blob as Blob);
        filenames.push(`${baseFileName}.docx`);
      });
    }

    // If we only have one blob, just download it. Otherwise, zip them up.
    if (blobsToZip.length === 1) {
      if (triggerDownload) {
        return createDownload(blobsToZip[0], baseFileName, exportType[0]);
      }

      return blobsToZip[0];
    }

    const zip = await createZip(blobsToZip, filenames);

    if (triggerDownload) {
      return createDownload(zip, baseFileName, 'zip');
    }

    return zip;
  }

  /**
   * Replace the active document with a new file while preserving the mounted
   * editor instance when the active runtime supports it.
   *
   * V2 collaboration routes this through the host-owned replace-file command so
   * the room can be atomically cleared and reseeded instead of tearing down the
   * SuperDoc instance and racing an empty Y.Doc against imported DOCX bytes.
   */
  async replaceFile(source: File | Blob | ArrayBuffer | Uint8Array): Promise<unknown> {
    const activeEditor = this.activeEditor as ActiveEditor | null;
    if (isV2ActiveEditorFacade(activeEditor) && typeof activeEditor.replaceFile === 'function') {
      const result = await activeEditor.replaceFile(source);
      const state = result && typeof result === 'object' ? (result as { state?: unknown }).state : null;
      if (state === null || state === 'review-ready' || state === 'editing-ready') {
        this.#replaceActiveDocumentData(activeEditor, source);
        this.emit('document-replaced', { editor: activeEditor, host: (activeEditor as { host?: unknown })?.host });
      }
      return result;
    }

    const legacyReplaceFile =
      activeEditor && !isV2ActiveEditorFacade(activeEditor)
        ? (activeEditor as { replaceFile?: (source: File | Blob | ArrayBuffer | Uint8Array) => Promise<unknown> })
            .replaceFile
        : null;
    if (typeof legacyReplaceFile === 'function') {
      const result = await legacyReplaceFile.call(activeEditor, source);
      // Same confirmation gate as the v2 branch, and covering the same two
      // effects. A legacy adapter that reports a non-ready state without
      // throwing should neither have its bytes persisted into config and the
      // store nor trigger a UI reset — v2 has always gated both together, and
      // gating only the emit here would ship a half-applied rule that reads as
      // if the data write were covered too.
      //
      // A result carrying no `state` counts as confirmed, which is what every
      // adapter predating that field returns, so existing legacy behaviour is
      // unchanged for them.
      const legacyState = result && typeof result === 'object' ? (result as { state?: unknown }).state : undefined;
      const legacyConfirmed =
        legacyState === undefined ||
        legacyState === null ||
        legacyState === 'review-ready' ||
        legacyState === 'editing-ready';
      if (legacyConfirmed) {
        this.#replaceActiveDocumentData(activeEditor, source);
        this.emit('document-replaced', { editor: activeEditor, host: (activeEditor as { host?: unknown })?.host });
      }
      return result;
    }

    throw new Error('SuperDoc: replaceFile is unavailable for the active editor');
  }

  /**
   * Export editors to DOCX format.
   * @param [options]
   */
  async exportEditorsToDOCX({
    commentsType,
    isFinalDoc,
    fieldsHighlightColor,
  }: { commentsType?: string; isFinalDoc?: boolean; fieldsHighlightColor?: string | null } = {}) {
    // The export's job is to pick the correct source of truth for
    // comments. There are three branches; the third had a latent
    // ambiguity that resurrected deleted comments and is the
    // reason this logic looks so fiddly.
    //
    // 1. `commentsType === 'clean'`: strip everything. Pass `[]`,
    //    which `Editor.exportDocx`'s
    //    `effectiveComments = comments ?? this.converter.comments ?? []`
    //    treats as authoritative-empty (`??` falls through on
    //    `null`/`undefined` only).
    //
    // 2. `modules.comments === false` (UI store NEVER hydrates).
    //    The store is not the source of truth because it never
    //    held comments at all. Pass `undefined` so the engine
    //    fallback to `converter.comments` fires and
    //    DOCX-imported comments survive the round-trip. This is
    //    the Custom UI story: consumers driving `ui.comments` from
    //    their own React tree shouldn't lose imports just because
    //    the built-in floating UI is hidden.
    //
    // 3. UI store IS hydrated (`modules.comments` truthy or
    //    omitted). The store is authoritative: a user who deleted
    //    every comment through the built-in UI ends up with an
    //    empty store, and the export MUST honor that as
    //    "no comments" rather than silently resurrect them from
    //    `converter.comments` (which the legacy delete path doesn't
    //    clear today; tracked separately under SD-2839). Pass
    //    whatever the store returns, including `[]`.
    // v1 and v2 own comment export differently:
    //
    //  - v1/legacy editors keep the legacy `comments` payload built from the
    //    sidebar store (`translateCommentsForExport()`), which can instantiate
    //    the disabled v1 `Editor` shim. That payload is computed LAZILY and
    //    only for v1 editors so a pure-v2 export never touches it.
    //  - v2 editors own comment export inside the v2 session serializer. They
    //    receive `commentsType` directly and never get a legacy `comments`
    //    payload (`comments-spec.md` §14; the plan's Workstream 2). Passing the
    //    legacy array would route v2 comments through the disabled v1 path.
    const commentsModuleConfig = this.config?.modules?.comments;
    const uiStoreHydrated = commentsModuleConfig !== false;
    let legacyComments: unknown[] | undefined;
    let legacyCommentsComputed = false;
    const getLegacyCommentsForV1 = (): unknown[] | undefined => {
      if (legacyCommentsComputed) return legacyComments;
      legacyCommentsComputed = true;
      if (commentsType === 'clean') {
        // Clean export: strip everything. `[]` is authoritative-empty for the
        // v1 engine fallback (`comments ?? converter.comments ?? []`).
        legacyComments = [];
      } else if (
        uiStoreHydrated &&
        this.commentsStore &&
        typeof this.commentsStore.translateCommentsForExport === 'function'
      ) {
        // UI store is the source of truth; trust whatever it says,
        // including an authoritative-empty array.
        legacyComments = this.commentsStore.translateCommentsForExport();
        if (!Array.isArray(legacyComments)) legacyComments = [];
      }
      // else: UI store unhydrated → leave undefined and let the engine's
      // `converter.comments` fallback fire.
      return legacyComments;
    };

    const bridgedExportErrors = new WeakSet<object>();
    const rememberBridgedExportError = (payload: SuperDocExceptionPayload) => {
      if ('editor' in payload && payload.error && typeof payload.error === 'object') {
        bridgedExportErrors.add(payload.error);
      }
    };

    this.on('exception', rememberBridgedExportError);
    try {
      const docxPromises = this.#requireSuperdocStore('exportEditorsToDOCX').documents.map(
        async (doc: RuntimeDocument) => {
          if (!doc || doc.type !== DOCX) return null;

          const editor = typeof doc.getEditor === 'function' ? doc.getEditor() : null;
          const fallbackDocx = () => {
            if (isBlobAcrossRealms(doc.data)) {
              if (doc.data.type && doc.data.type !== DOCX) return null;
              return doc.data;
            }
            if (isDocumentByteSource(doc.data)) return this.#savedDocxToBlob(doc.data);
            return null;
          };

          if (!editor || typeof editor.exportDocx !== 'function') return fallbackDocx();

          const isV2Editor = editor.editorVersion === 2;
          try {
            const exported = await editor.exportDocx(
              isV2Editor
                ? {
                    // v2 export authority is the v2 session serializer. No
                    // legacy `comments` payload — `commentsType` is the policy.
                    isFinalDoc,
                    commentsType,
                    fieldsHighlightColor,
                  }
                : {
                    isFinalDoc,
                    comments: getLegacyCommentsForV1() as Comment[] | undefined,
                    commentsType,
                    fieldsHighlightColor,
                  },
            );
            if (exported) return exported;
          } catch (error) {
            if (!error || typeof error !== 'object' || !bridgedExportErrors.has(error)) {
              this.emit('exception', { error, document: doc });
              this.emit('exception', translateExportDiagnostic(error, { documentId: doc.id, editor: null }));
            }
            if (isV2Editor) {
              throw error;
            }
          }

          return fallbackDocx();
        },
      );

      const docxFiles = await Promise.all(docxPromises);
      // Type-predicate filter so callers see `Blob[]` instead of `(Blob | null)[]`.
      // `filter(Boolean)` narrows at runtime but not in the type system.
      return docxFiles.filter((file): file is Blob => file != null);
    } finally {
      this.off('exception', rememberBridgedExportError);
    }
  }

  /**
   * Run each DOCX editor's save, including its V2 collaboration barrier.
   * Resolves after serialization; rejects if an editor cannot save.
   * Backend storage persistence is controlled by the collaboration server
   * and is not acknowledged by this method. Use export() to obtain DOCX bytes.
   */
  async save(): Promise<void> {
    const documents = this.#requireSuperdocStore('save').documents;
    await Promise.all(
      documents.map(async (doc: RuntimeDocument) => {
        if (doc.type !== DOCX) return;
        const editor = doc.getEditor?.();
        if (!isV2ActiveEditorFacade(editor) || typeof editor.save !== 'function') {
          throw new Error(`SuperDoc: save is unavailable for document "${doc.id}"`);
        }
        await editor.save();
      }),
    );
  }

  /**
   * Clean up collaboration resources owned only by a removed document.
   *
   * Shared instance-level providers/ydocs stay alive; `destroy()` remains the
   * one place that tears down shell-wide collaboration state.
   */
  #cleanupRemovedDocumentCollaboration(
    removedDocument: RuntimeDocument,
    remainingDocuments: readonly RuntimeDocument[],
  ) {
    const removedProvider = removedDocument.provider;
    if (
      removedProvider &&
      removedProvider !== this.provider &&
      !remainingDocuments.some((doc) => doc.provider === removedProvider)
    ) {
      removedProvider.disconnect?.();
      removedProvider.destroy?.();
    }

    const removedYDoc = removedDocument.ydoc;
    if (removedYDoc && removedYDoc !== this.ydoc && !remainingDocuments.some((doc) => doc.ydoc === removedYDoc)) {
      removedYDoc.destroy?.();
    }
  }

  /**
   * Clean up collaboration resources (providers, ydocs, sockets)
   */
  #cleanupCollaboration() {
    this.#pendingV2LockSeed = null;
    this.#stopV2CollaborationEventBridge();
    // Remove the awareness listener so the provider cannot emit events
    // into a destroyed SuperDoc instance.
    if (typeof this._cleanupAwareness === 'function') {
      this._cleanupAwareness();
      this._cleanupAwareness = null;
    }

    const cfg = this.config;
    // `cancelWebsocketRetry` is set on `HocuspocusProviderWebsocket` only
    // while a reconnect timer is pending, and Hocuspocus clears it back to
    // `undefined` after firing. Destroy from the "already connected, no
    // pending retry" path lands here with the method absent, so the
    // optional chain on the method is required to avoid a `TypeError`.
    cfg.socket?.cancelWebsocketRetry?.();
    cfg.socket?.disconnect();
    cfg.socket?.destroy();

    this.ydoc?.destroy();
    this.provider?.disconnect?.();
    this.provider?.destroy?.();

    cfg.documents.forEach((doc: RuntimeDocument) => {
      doc.provider?.disconnect?.();
      doc.provider?.destroy?.();
      doc.ydoc?.destroy();
    });
  }

  // ---------------------------------------------------------------------------
  // Surface system — generic dialog/floating UI above document content
  // ---------------------------------------------------------------------------

  /**
   * Open a surface (dialog or floating) above the document content.
   *
   */
  openSurface<TResult = unknown>(request: SurfaceRequest): SurfaceHandle<TResult> {
    return this.#surfaceManager.open(request) as SurfaceHandle<TResult>;
  }

  /**
   * Close a surface by id, or the topmost surface if no id is given.
   */
  closeSurface(id?: string) {
    this.#surfaceManager.close(id);
  }

  /**
   * Remove one mounted document from the shell by document id.
   *
   * Clears any registered runtimes for that document without silently
   * promoting another runtime, prunes shell-owned comment state for the
   * document, and resolves after Vue flushes the unmount so DOM-based callers
   * can observe the root disappearing.
   *
   * @param documentId The document id to remove.
   * @returns `true` when a document was removed, `false` when none matched.
   */
  async removeDocument(documentId: string): Promise<boolean> {
    const normalizedDocumentId = typeof documentId === 'string' ? documentId : String(documentId ?? '');
    if (!normalizedDocumentId) return false;

    const store = this.#requireSuperdocStore('removeDocument');
    const activeEditor = this.activeEditor as ActiveEditor | null;
    const activeDocumentId = getActiveEditorDocumentId(activeEditor);

    for (const runtime of this.#editorRuntimeRegistry.getAllByDocumentId(normalizedDocumentId)) {
      this.#editorRuntimeRegistry.unregister(runtime.id);
    }

    if (activeDocumentId === normalizedDocumentId && activeEditor !== null) {
      this.#clearActiveEditorProjection();
    }

    const removedDocument = store.removeDocument(normalizedDocumentId);
    if (!removedDocument) return false;

    this.#cleanupRemovedDocumentCollaboration(removedDocument, store.documents);

    await nextTick();
    return true;
  }

  /**
   * Destroy the superdoc instance
   */
  destroy() {
    // Mark as destroyed early to prevent in-flight init from mounting
    this.#destroyed = true;

    this.#contentControlClickRoot?.removeEventListener('click', this.#handleContentControlClick, true);
    this.#contentControlClickRoot?.removeEventListener('pointerdown', this.#handleContentControlPointerDown, true);
    this.#contentControlClickRoot?.ownerDocument.removeEventListener(
      'pointerup',
      this.#handleContentControlPointerEnd,
      true,
    );
    this.#contentControlClickRoot?.ownerDocument.removeEventListener(
      'pointercancel',
      this.#handleContentControlPointerEnd,
      true,
    );
    this.#contentControlClickRoot?.removeEventListener('keydown', this.#handleContentControlKeyDown, true);
    this.#contentControlClickRoot = null;

    this.#contentControlActiveChangeUnsub?.();
    this.#contentControlActiveChangeUnsub = null;

    // Abort any in-flight upgrade (sync wait or ready wait) so it settles
    // immediately instead of hanging for the full timeout duration.
    if (this.#abortUpgrade) {
      this.#abortUpgrade();
      this.#abortUpgrade = null;
    }

    // Settle all active surfaces before Vue unmount
    if (this.#surfaceManager) {
      this.#surfaceManager.destroy();
    }

    this.toolbar?.destroy?.();
    this.commentsList?.close();
    this.commentsList = null;

    // Unmount the app FIRST so editors are destroyed — this triggers each
    // extension's onDestroy() which cancels debounced Y.js writes and
    // unobserves Y.js maps. Only then is it safe to destroy the ydoc/provider.
    if (this.app) {
      this.#log('[superdoc] Unmounting app');
      // `superdocStore` is populated in `#initVueApp` alongside `this.app`,
      // so the guard above also asserts the store is ready.
      this.superdocStore?.reset();
      this.app.unmount();
      this.removeAllListeners();
      delete this.app.config.globalProperties.$config;
      delete this.app.config.globalProperties.$superdoc;
    }

    // SuperDoc owns the UI controller, so it is the only place that destroys
    // it. This runs after the Vue unmount because the shell's teardown still
    // reads the controller. The reference is kept so a later `ui` read
    // returns the same (inert) object rather than building a new one, and the
    // controller's own destroy() is idempotent.
    this.#ui?.destroy();

    this.#cleanupCollaboration();

    this.#editorRuntimeRegistryUnsub?.();
    this.#editorRuntimeRegistryUnsub = null;
    this.#editorRuntimeRegistry.clear();

    // Remove the internal wrapper element from the user's container
    if (this.#mountWrapper) {
      this.#mountWrapper.remove();
      this.#mountWrapper = null;
    }
  }

  /**
   * Focus the active editor or the first editor in the superdoc
   */
  focus(options: EditorRuntimeFocusOptions = {}) {
    const runtime = this.getActiveRuntime();
    if (runtime?.getCapabilities().lifecycle.canFocus) {
      void runtime.focus(options).catch((err) => {
        console.warn('[SuperDoc] active editor runtime focus failed', err);
      });
      return;
    }
    if (this.activeEditor) {
      if (isV2ActiveEditorFacade(this.activeEditor)) {
        this.activeEditor.focus?.(options);
      } else {
        this.activeEditor.focus?.();
      }
    } else {
      this.#requireSuperdocStore('focus').documents.find((doc: RuntimeDocument) => {
        const editor = doc.getEditor?.();
        if (!editor) return false;
        if (isV2ActiveEditorFacade(editor)) {
          editor.focus?.(options);
        } else {
          editor.focus?.();
        }
        return true;
      });
    }
  }

  /**
   * Set the high contrast mode
   */
  setHighContrastMode(isHighContrast: boolean) {
    if (!this.activeEditor) return;
    // `setHighContrastMode` is typed as optional on Editor because the
    // method is only present once the editor's mount hooks run. By the
    // time this entry point is reachable the editor is fully constructed
    // and the method is installed, so the optional chain is a no-op.
    this.activeEditor.setHighContrastMode?.(isHighContrast);
    // `activeEditor` is only set after the editor's mount completes, which
    // happens after `#initVueApp` populates `highContrastModeStore`. The
    // `if (!this.activeEditor) return` above is the runtime guarantee;
    // the optional chain expresses that to TS without a redundant throw.
    this.highContrastModeStore?.setHighContrastMode(isHighContrast);
  }
}
