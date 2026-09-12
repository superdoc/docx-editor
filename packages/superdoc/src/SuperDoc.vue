<script setup>
import '@superdoc/common/styles/common-styles.css';
import { superdocIcons } from './icons.js';
//prettier-ignore
import {
  getCurrentInstance,
  inject,
  ref,
  shallowRef,
  unref,
  onMounted,
  onBeforeUnmount,
  nextTick,
  computed,
  reactive,
  watch,
  defineAsyncComponent,
  markRaw,
} from 'vue';
import { storeToRefs } from 'pinia';

import CommentDialog from '@superdoc/components/CommentsLayer/CommentDialog.vue';
import FloatingComments from '@superdoc/components/CommentsLayer/FloatingComments.vue';
import PdfCommentsLayer from '@superdoc/components/CommentsLayer/PdfCommentsLayer.vue';
import { useWhiteboard } from './components/Whiteboard/use-whiteboard';
import WhiteboardLayer from './components/Whiteboard/WhiteboardLayer.vue';
import useSelection from '@superdoc/helpers/use-selection';

import { useSuperdocStore } from '@superdoc/stores/superdoc-store';
import { useCommentsStore } from '@superdoc/stores/comments-store';

import { DOCX, PDF, HTML } from '@superdoc/common';
import { composeAuthorColorResolver } from '@superdoc/contracts';
import HtmlViewer from './components/HtmlViewer/HtmlViewer.vue';
import useComment from './components/CommentsLayer/use-comment';
import { collectRemovedCommentIds } from './components/CommentsLayer/collect-removed-comment-ids.js';
import { useHighContrastMode } from './composables/use-high-contrast-mode';
import { useCommentSmallScreen } from './composables/use-comment-small-screen.js';
import { useCompactCommentPopover } from './composables/use-compact-comment-popover.js';
import { getVisibleThreadAnchorClientY } from './helpers/comment-focus.js';
import { mergeCommentsConfig } from './core/config/merge-comments-config.js';
import { normalizeHyperlinksConfig } from './core/config/normalize-hyperlinks-config.js';
import {
  applyV2CommentInvalidationFromMutation,
  getV2TrackedChangeMutationImpact,
} from './helpers/v2-review-mutation-impact.js';
import { resolveV2ReviewTargetCommentId } from './helpers/v2-review-target.js';
import {
  createV2AuthorRequiredNotificationGate,
  isV2AuthorRequiredRejection,
  V2_AUTHOR_REQUIRED_CODE,
  V2_AUTHOR_REQUIRED_MESSAGE,
} from './helpers/v2-author-required-rejection.js';
import { toV2BulkDecisionEvent } from './helpers/v2-bulk-decision-event.js';
import {
  createV2KeyboardEditRejectionException,
  createV2KeyboardEditRejectionNotificationGate,
} from './helpers/v2-keyboard-edit-rejection.js';
import { createV2MutationRejectionCause } from './helpers/v2-mutation-exception.js';
import { DOCUMENT_EDITOR_SELECTION_SOURCE } from './helpers/selection-source.js';
import { hasOutsideV2DomRangeSelection, shouldPreserveHostV2Selection } from './helpers/v2-selection-sync.js';
import { useUiFontFamily } from './composables/useUiFontFamily.js';
import { usePasswordPrompt } from './composables/use-password-prompt.js';
import { useFindReplace } from './composables/use-find-replace.js';
import { claimFindShortcut, releaseFindShortcut, shouldHandleFindShortcut } from './composables/find-shortcut-owner.js';
import { useViewportFit } from './composables/use-viewport-fit.js';
import { useLinkPopover } from './composables/use-link-popover.js';
import { createV2EditorRuntimeAdapter } from './core/editor-runtime/v2/v2-editor-runtime-adapter.js';
import { createV2SessionShortcutRoutes } from './core/editor-runtime/v2/v2-session-shortcut-routes.js';
import { createV2SaveQueue } from './core/editor-runtime/v2/v2-save-queue.js';
import { markRuntimeRoot, unmarkRuntimeRoot } from './core/editor-runtime/root-marker.js';
import { resolveV2Integration } from './core/v2-integration/v2-integration.js';
import { resolveV2CollaborationTarget } from './core/collaboration/resolve-v2-collaboration-target.js';
import { createCollaborationException } from './core/collaboration/collaboration-exception.js';
import { createDocumentOpenTelemetry } from './core/document-open-telemetry.js';
import {
  translateUnzipDiagnostic,
  translateRenderReadinessDiagnostic,
  translateBootFailureReason,
  translateSsigParseDiagnostic,
} from './internal/diagnostics/translate-diagnostic.js';
import {
  getV2DiagnosticGeneration,
  createV2DiagnosticDedupe,
  isBootDiagnosticRedundant,
} from './internal/diagnostics/diagnostic-dedupe.js';
import SurfaceHost from './components/surfaces/SurfaceHost.vue';
import {
  DEFAULT_COMMENTS_LAYOUT,
  isActiveTrackedChangeContextMenuTarget,
  RIGHT_CLICK_COMMENT_SUPPRESS_MS,
  VALID_COMMENTS_LAYOUTS,
} from './helpers/comment-small-screen.js';

const PdfViewer = defineAsyncComponent(() => import('./components/PdfViewer/PdfViewer.vue'));
const getDocumentLoadPassword = (doc) => doc.password ?? proxy.$superdoc.config.password;
// Preserve the distinction between no collaboration request and a malformed
// request. Invalid input is a terminal preflight failure; it must never be
// silently reinterpreted as a local editor boot.
const resolveDocumentV2Collaboration = (doc) => {
  const rawConfig = doc?.v2Collaboration;
  const config = rawConfig && typeof rawConfig === 'object' && 'value' in rawConfig ? rawConfig.value : rawConfig;
  if (config == null) return { state: 'absent' };
  const resolution = resolveV2CollaborationTarget({
    v2Collaboration: config,
    documentType: doc?.type ?? null,
    documentCount: documents.value.length,
    ...(typeof window !== 'undefined' ? { authEndpointBaseUrl: window.location.href } : {}),
  });
  if (!resolution.ok) {
    return {
      state: 'invalid',
      failure: {
        code:
          resolution.reason === 'invalid-room-mode'
            ? 'collaboration-open-intent-invalid'
            : 'collaboration-config-invalid',
        message: `SuperDoc rejected the v2 collaboration configuration (${resolution.reason}).`,
      },
    };
  }
  const { providerFamily: providerType, ...target } = resolution.target;
  return {
    state: 'valid',
    config: { providerType, ...target },
  };
};

// Stores
const superdocStore = useSuperdocStore();
const commentsStore = useCommentsStore();
const emit = defineEmits(['selection-update']);

//prettier-ignore
const {
  documents,
  isReady,
  areDocumentsReady,
  selectionPosition,
  activeSelection,
  activeZoom,
  zoomMode,
  measurementUnit,
  viewportMetrics,
} = storeToRefs(superdocStore);
const { handlePageReady, modules, user, getDocument } = superdocStore;

// Password prompt coordinator — uses surfaces to show a dialog for encrypted DOCX files.
const surfaceManager = inject('surfaceManager', null);
const passwordPrompt = usePasswordPrompt({
  getSurfaceManager: () => surfaceManager,
  getPasswordPromptConfig: () => proxy.$superdoc?.config?.modules?.surfaces?.passwordPrompt,
  onUnhandled: (doc, errorCode, originalException) => {
    // The password prompt initially claimed this error but could not show a dialog
    // (resolver returned { type: 'none' }, config was invalid, or resolver threw).
    // Re-emit the original exception event so the app can handle it.
    proxy.$superdoc?.emit('exception', {
      error: originalException?.error ?? new Error(`Password prompt unhandled: ${errorCode}`),
      editor: originalException?.editor ?? null,
      code: errorCode,
      documentId: doc?.id,
    });
  },
});

/*
NOTE: new PdfViewer does not emit page-loaded. Hrbr fields/annotations
rely on handlePageReady; revisit when wiring fields for PDF.

From the old code:
const containerBounds = container.getBoundingClientRect();
containerBounds.originalWidth = width;
containerBounds.originalHeight = height;
emit('page-loaded', documentId, index, containerBounds);
*/

//prettier-ignore
const {
  getConfig,
  documentsWithConverations,
  commentsList,
  pendingComment,
  activeComment,
  skipSelectionUpdate,
  commentsByDocument,
  isCommentsListVisible,
  isFloatingCommentsReady,
  generalCommentIds,
  hasSyncedCollaborationComments,
  editorCommentPositions,
  hasInitializedLocations,
  isCommentHighlighted,
  hasOpenTrackedChanges,
} = storeToRefs(commentsStore);
const {
  showAddComment,
  handleEditorLocationsUpdate,
  handleTrackedChangeUpdate,
  refreshTrackedChangeCommentsByIds,
  syncTrackedChangePositionsWithDocument,
  syncTrackedChangeComments,
  addComment,
  addHydratedComment,
  getComment,
  resolveCommentPositionEntry,
  belongsToDocument,
  COMMENT_EVENTS,
  requestInstantSidebarAlignment,
  peekInstantSidebarAlignment,
  clearInstantSidebarAlignment,
} = commentsStore;
const { proxy } = getCurrentInstance();
commentsStore.proxy = proxy;
const documentOpenTelemetry = createDocumentOpenTelemetry(proxy.$superdoc.config);

// Resolve the single v2 integration object. superdoc@2 source-resolves the
// private v2 browser shell locally; customers do not provide a runtime switch.
const resolvedEditorIntegration = resolveV2Integration(proxy.$superdoc.config);
// ui-phase2-001: the v2 DOCX editor wrapper comes from the private integration.
const V2DocumentEditor = markRaw(resolvedEditorIntegration.EditorComponent);
// ui-phase4-002: v2 ruler (optional). Falls back to the stub editor component's
// sibling null when the integration does not provide one.
const V2Ruler = resolvedEditorIntegration.RulerComponent ? markRaw(resolvedEditorIntegration.RulerComponent) : null;

const floatingComments = computed(() => {
  const currentFloatingComments = unref(commentsStore.getFloatingComments);
  return Array.isArray(currentFloatingComments) ? currentFloatingComments : [];
});

const { isHighContrastMode } = useHighContrastMode();
const { uiFontFamily } = useUiFontFamily();

// Review visibility reads the comments-store reactive authority
// (`viewingVisibility`), updated by `SuperDoc.ts#syncViewingVisibility` on init
// and on every `setDocumentMode`. Reading the reactive state instead of polling
// `proxy.$superdoc.config` keeps V2 geometry/layout-engine options and
// `shouldRenderCommentsInViewing` from running on stale computed values after a
// mode transition (the document-mode-change split-source-of-truth bug).
const isViewingMode = () => commentsStore.viewingVisibility.documentMode === 'viewing';
const allowSelectionInViewMode = () => !!proxy?.$superdoc?.config?.allowSelectionInViewMode;
const isViewingCommentsVisible = computed(
  () => isViewingMode() && commentsStore.viewingVisibility.commentsVisible === true,
);
const isFindReplaceEnabled = computed(() => {
  // Single source of truth: the profile already folds in `ui.search`,
  // `modules.surfaces.findReplace`, and `ui: false`.
  return proxy?.$superdoc?.uiConfig?.search?.enabled === true;
});
const isViewingTrackChangesVisible = computed(
  () => isViewingMode() && commentsStore.viewingVisibility.trackChangesVisible === true,
);
// One source of truth for "emit review geometry in viewing": the comments-store
// computed derived from the same reactive `viewingVisibility` state. Pinia
// auto-unwraps the store computed to its boolean value on access.
const shouldRenderCommentsInViewing = computed(() => commentsStore.shouldRenderReviewInViewing);

const resolvedProofingConfig = computed(() => {
  if (proxy.$superdoc.config.proofing !== undefined) {
    return proxy.$superdoc.config.proofing;
  }
  return proxy.$superdoc.config.layoutEngineOptions?.proofing;
});

const commentsModuleConfig = computed(() => {
  const config = modules.comments;
  if (config === false || config == null) return null;
  // `modules.comments` is the live object: the runtime writes interaction
  // policy onto it and collaboration keeps reading it, so it stays the base
  // layer and only the profile's presentation options are layered over it.
  // Merging in this direction (rather than copying `ui` options back onto the
  // shared object) keeps policy and collaboration state untouched.
  const presentation = proxy.$superdoc?.uiConfig?.comments?.options;
  if (!presentation || Object.keys(presentation).length === 0) return config;
  return mergeCommentsConfig(config, presentation);
});

const superdocStyleVars = computed(() => {
  const vars = {
    '--sd-ui-font-family': uiFontFamily.value,
  };

  const commentsConfig = commentsModuleConfig.value;
  if (!commentsConfig) return vars;

  if (commentsConfig.highlightHoverColor) {
    vars['--sd-comments-highlight-hover'] = commentsConfig.highlightHoverColor;
  }

  const trackChangeColors = commentsConfig.trackChangeHighlightColors || {};
  const activeTrackChangeColors = {
    ...trackChangeColors,
    ...(commentsConfig.trackChangeActiveHighlightColors || {}),
  };
  if (activeTrackChangeColors.insertBorder)
    vars['--sd-tracked-changes-insert-border'] = activeTrackChangeColors.insertBorder;
  if (activeTrackChangeColors.insertBackground)
    vars['--sd-tracked-changes-insert-background'] = activeTrackChangeColors.insertBackground;
  if (activeTrackChangeColors.deleteBorder)
    vars['--sd-tracked-changes-delete-border'] = activeTrackChangeColors.deleteBorder;
  if (activeTrackChangeColors.deleteBackground)
    vars['--sd-tracked-changes-delete-background'] = activeTrackChangeColors.deleteBackground;
  if (activeTrackChangeColors.formatBorder)
    vars['--sd-tracked-changes-format-border'] = activeTrackChangeColors.formatBorder;

  return vars;
});

// Refs
const superdocRoot = ref(null);
const layers = ref(null);
const rightSidebarRef = ref(null);
const pdfViewerRef = ref(null);
const pendingReplayTrackedChangeSync = ref(false);
const toolsMenuPosition = reactive({ top: null, right: '-25px', zIndex: 101 });
const {
  superdocContainerWidth,
  isCompactCommentsMode,
  recalculateCompactCommentsMode,
  ensureCompactMeasurementObserver,
} = useCommentSmallScreen({
  commentsModuleConfig,
  superdocRoot,
  layers,
});

// V2 branch: DOCX is always routed through the v2 host shell wrapper
// (`V2DocumentEditor`). PDF / HTML keep their viewer-specific paths.
const isV2Mode = computed(() => true);

// ui-phase3-001: v2 geometry bridge state. `v2GeometryRender` holds the
// latest payload reported by `V2DocumentEditor` after each render-epoch change;
// `v2GeometryEpoch` is the last epoch we successfully published into the
// comments store so the RAF batcher can drop duplicate ticks. `v2Geometry-
// Available` flips true once we've published at least one geometry
// snapshot — it gates first appearance of `showCommentsSidebar` in v2 mode so
// the sidebar does not appear before painted carriers exist.
// `v2ReviewSidebarUnlocked` latches after that first publish so a transient
// remount on Enter cannot unmount the sidebar via the geometry gate.
const v2GeometryRender = shallowRef(null);
const v2GeometryAvailable = ref(false);
const v2ReviewSidebarUnlocked = ref(false);
const v2GeometryEpoch = ref(null);
let v2GeometryRafHandle = 0;
let v2TrackedChangeRestampRetainPaints = 0;
let v2TrackedChangeRestampRetentionReason = null;
const TRACKED_CHANGE_CARRIERS_RESTAMPED_EVENT = 'superdoc:v2-tracked-change-carriers-restamped';

// Create a ref to pass to the composable
const activeEditorRef = computed(() => proxy.$superdoc.activeEditor);

// The SuperDoc-owned UI controller (`superdoc.ui`). The shell is a consumer:
// SuperDoc creates it and destroys it, so nothing here may tear it down.
const getSuperDocUI = () => proxy.$superdoc?.ui ?? null;
const UNAVAILABLE_COMMAND_STATE = Object.freeze({ enabled: false, active: false, supported: false });
/** `CommandExecutionResult` is `boolean | receipt`, so `false` reads as "did not run". */
const UNAVAILABLE_COMMAND_RESULT = false;

// Find/replace controller — uses surfaces to show a floating find/replace popover.
const findReplace = useFindReplace({
  getSurfaceManager: () => surfaceManager,
  getActiveEditor: () => proxy.$superdoc?.activeEditor,
  activeEditorRef,
  // The profile folds `ui.search` over `modules.surfaces.findReplace`. Reading
  // the legacy field directly is what made `ui: { search: true }` draw the
  // toolbar button while `resolveConfig()` still saw `undefined` and refused to
  // open. `enabled` is the switch; `options` carries texts, placement, and the
  // custom renderer, so both have to come from the same resolved profile.
  getFindReplaceConfig: () =>
    proxy.$superdoc?.uiConfig?.search?.enabled ? proxy.$superdoc.uiConfig.search.options : false,
  // V2 find/replace routes through the shared UI controller's search slice,
  // which is backed by the single host search session (`host.search`).
  getSuperDocUI,
});
const getLinkPopoverSurfaceManager = () => {
  if (surfaceManager) return surfaceManager;
  if (typeof proxy.$superdoc?.openSurface !== 'function') return null;
  return {
    open: (request) => proxy.$superdoc.openSurface(request),
  };
};
const getHyperlinkActivationHandler = () => {
  const config = normalizeHyperlinksConfig(proxy.$superdoc?.config);
  return config.editableActivationDisabled ? () => ({ type: 'none' }) : config.handler;
};
const getHyperlinkActivationSource = () => normalizeHyperlinksConfig(proxy.$superdoc?.config).handlerSource;
const getBuiltInLinkEditorDisabled = () => normalizeHyperlinksConfig(proxy.$superdoc?.config).builtInEditorDisabled;
const shouldInterceptNavigationOnlyHyperlinks = () =>
  normalizeHyperlinksConfig(proxy.$superdoc?.config).interceptsNavigationOnly;
const linkPopover = useLinkPopover({
  getSurfaceManager: getLinkPopoverSurfaceManager,
  getActiveEditor: () => proxy.$superdoc?.activeEditor,
  getUi: getSuperDocUI,
  getActivationHandler: getHyperlinkActivationHandler,
  getActivationHandlerSource: getHyperlinkActivationSource,
  getBuiltInEditorDisabled: getBuiltInLinkEditorDisabled,
  shouldInterceptNavigationOnlyHyperlinks,
  getLayerElement: () => layers.value,
  emitException: (payload) => {
    proxy.$superdoc?.emit('exception', {
      ...payload,
      editor: proxy.$superdoc?.activeEditor ?? null,
    });
  },
});

const pdfConfig = proxy.$superdoc.config.modules?.pdf || {};

const flushPendingReplayTrackedChangeSync = () => {
  if (!pendingReplayTrackedChangeSync.value) return;
  pendingReplayTrackedChangeSync.value = false;
  syncTrackedChangeComments({ superdoc: proxy.$superdoc, editor: proxy.$superdoc?.activeEditor });
};

let queuedTrackedChangeCommentResync = null;
let isTrackedChangeCommentResyncQueued = false;

const flushQueuedTrackedChangeCommentResync = () => {
  isTrackedChangeCommentResyncQueued = false;

  const pendingResync = queuedTrackedChangeCommentResync;
  queuedTrackedChangeCommentResync = null;
  if (!pendingResync?.editor) return;

  if (pendingResync.fullResync) {
    syncTrackedChangeComments({
      superdoc: proxy.$superdoc,
      editor: pendingResync.editor,
      broadcastChanges: pendingResync.broadcastChanges,
    });
    return;
  }

  refreshTrackedChangeCommentsByIds({
    superdoc: proxy.$superdoc,
    editor: pendingResync.editor,
    changeIds: Array.from(pendingResync.changeIds ?? []),
    broadcastChanges: pendingResync.broadcastChanges,
  });
};

const queueTrackedChangeCommentResync = ({ editor, changeIds = null, broadcastChanges = true } = {}) => {
  if (!editor || (changeIds && !changeIds.size)) return;

  const existingChangeIds = queuedTrackedChangeCommentResync?.changeIds ?? new Set();
  queuedTrackedChangeCommentResync = {
    editor,
    fullResync: !changeIds || Boolean(queuedTrackedChangeCommentResync?.fullResync),
    changeIds: changeIds ? new Set([...existingChangeIds, ...changeIds]) : existingChangeIds,
    broadcastChanges: Boolean(queuedTrackedChangeCommentResync?.broadcastChanges) || Boolean(broadcastChanges),
  };

  if (isTrackedChangeCommentResyncQueued) return;
  isTrackedChangeCommentResyncQueued = true;
  queueMicrotask(flushQueuedTrackedChangeCommentResync);
};

const scheduleReplayTrackedChangeSync = () => {
  pendingReplayTrackedChangeSync.value = true;
  nextTick(() => {
    flushPendingReplayTrackedChangeSync();
  });
};

const handleDocumentReady = (documentId, container) => {
  const doc = getDocument(documentId);
  doc.isReady = true;
  doc.container = container;
  if (areDocumentsReady.value) {
    if (!proxy.$superdoc.config.collaboration) isReady.value = true;
  }

  ensureInitialFallbackZoom();
  isFloatingCommentsReady.value = true;
  hasInitializedLocations.value = true;
  proxy.$superdoc.broadcastPdfDocumentReady();
};

const getPendingCommentTargetClientY = () => {
  if (!selectionPosition.value || !layers.value) return null;

  const isPdf = selectionPosition.value.source === 'pdf';
  const zoom = isPdf ? (activeZoom.value ?? 100) / 100 : 1;
  const top = Number(selectionPosition.value.top);
  if (!Number.isFinite(top)) return null;

  return layers.value.getBoundingClientRect().top + top * zoom;
};

const handleCommentToolClick = async () => {
  const result = await showAddComment(proxy.$superdoc, getPendingCommentTargetClientY());
  if (result?.ok === false) return;
  if (!isV2Mode.value) return;

  const pendingPosition = buildV2PendingPositionEntry();
  if (pendingPosition) publishV2PendingPositionEntry(pendingPosition);
};

const handleToolClick = async (tool) => {
  const toolOptions = {
    comments: () => handleCommentToolClick(),
  };

  if (tool in toolOptions) {
    await toolOptions[tool](activeSelection.value, selectionPosition.value);
  }

  activeSelection.value = null;
  toolsMenuPosition.top = null;
};

const handleHighlightClick = () => (toolsMenuPosition.top = null);

// Shell-owned per-document state for the v2 runtime adapter.
const subDocumentRoots = new Map();
const v2Runtimes = new Map();
const v2CommandShortcutBindings = new Map();
const v2SessionShortcutBindings = new Map();
let v2RuntimeSeq = 0;

const clearV2CommandShortcutBinding = (documentId) => {
  const entry = v2CommandShortcutBindings.get(documentId);
  if (!entry) return;
  v2CommandShortcutBindings.delete(documentId);
  try {
    entry.unbind?.();
  } catch (err) {
    console.warn('[SuperDoc] v2 command-shortcut unbind failed', err);
  }
};

const resolveV2LinkWorkflowOpener = () => {
  const toolbar = proxy.$superdoc?.toolbar;
  if (!toolbar || typeof toolbar.getToolbarItemByName !== 'function') return null;
  return () => {
    const linkItem = toolbar.getToolbarItemByName('link');
    if (!linkItem || linkItem.disabled?.value === true) return;
    if (linkItem.expand && typeof linkItem.expand === 'object' && 'value' in linkItem.expand) {
      linkItem.expand.value = true;
    }
    toolbar.updateToolbarState?.();
  };
};

const installV2CommandShortcutBinding = ({ documentId, bindEditShortcuts }) => {
  if (!documentId) return;
  clearV2CommandShortcutBinding(documentId);
  if (typeof bindEditShortcuts !== 'function') return;
  const openLinkWorkflow = resolveV2LinkWorkflowOpener();
  const unbind = bindEditShortcuts({
    commandRoute: {
      // Fail closed, and keep the promise shape: a queued shortcut that
      // settles after teardown still gets an awaitable result rather than
      // `undefined`, which would throw for any caller chaining `.then()`.
      executeAsync: (commandId, payload) => {
        const ui = getSuperDocUI();
        if (!ui) return Promise.resolve(UNAVAILABLE_COMMAND_RESULT);
        return ui.commands.executeAsync(commandId, payload);
      },
      // Fail closed: a shortcut must never read as enabled when the shell has
      // outlived its SuperDoc instance.
      getState: (commandId) => getSuperDocUI()?.commands.get(commandId).getState() ?? UNAVAILABLE_COMMAND_STATE,
    },
    ...(openLinkWorkflow ? { openLinkWorkflow } : {}),
  });
  v2CommandShortcutBindings.set(documentId, { unbind });
};

const clearV2SessionShortcutBinding = (documentId) => {
  const entry = v2SessionShortcutBindings.get(documentId);
  if (!entry) return;
  v2SessionShortcutBindings.delete(documentId);
  try {
    entry.unbind?.();
  } catch (err) {
    console.warn('[SuperDoc] v2 session-shortcut unbind failed', err);
  }
};

// v2-keyboard-005: install the shell/session/reference shortcut binding. Toolbar
// focus routes to the built-in toolbar chrome; field update and page-field
// insertion route through the public Document API facade. Header/footer focus
// and Escape session exit stay unprovided (no public host seam), so the binder
// fails closed for those rather than reaching V1 internals. Mutating reference
// shortcuts honor viewing/read-only suppression.
const installV2SessionShortcutBinding = ({ documentId, bindSessionShortcuts, documentApi }) => {
  if (!documentId) return;
  clearV2SessionShortcutBinding(documentId);
  if (typeof bindSessionShortcuts !== 'function') return;
  const routes = createV2SessionShortcutRoutes({
    resolveToolbarElement: () => proxy.$superdoc?.toolbar?.toolbarContainer ?? null,
    getDocumentApi: () => documentApi ?? null,
  });
  const unbind = bindSessionShortcuts({
    routes,
    isMutationAllowed: () => !isViewingMode(),
  });
  v2SessionShortcutBindings.set(documentId, { unbind });
};

/**
 * Store the shell-owned wrapper for a document editor. This wrapper is outside
 * painter DOM and is the only element stamped with the runtime marker.
 * @param {Object} doc - the document model
 * @param {HTMLElement|null} el - the wrapper element, or null on unmount
 */
const setSubDocumentRoot = (doc, el) => {
  if (!doc?.id) return;
  if (el) subDocumentRoots.set(doc.id, el);
  else subDocumentRoots.delete(doc.id);
};

const clearV2RuntimeRegistration = (documentId) => {
  clearV2CommandShortcutBinding(documentId);
  clearV2SessionShortcutBinding(documentId);
  const document = getDocument(documentId);
  const provider = document?.provider ?? null;
  if (provider && proxy.$superdoc.provider === provider) {
    proxy.$superdoc.provider = undefined;
  }
  if (document && provider?.sendStateless) {
    document.provider = null;
  }
  const entry = v2Runtimes.get(documentId);
  if (!entry) return;
  proxy.$superdoc.unregisterEditorRuntime(entry.runtimeId);
  v2Runtimes.delete(documentId);
  const hostRoot = subDocumentRoots.get(documentId);
  if (hostRoot) unmarkRuntimeRoot(hostRoot);
};

const registerV2Runtime = ({ documentId, host, mount, facade }) => {
  const root = subDocumentRoots.get(documentId);
  if (!root) {
    console.warn('[SuperDoc] v2 runtime host root unavailable; skipping runtime registration for', documentId);
    return false;
  }

  if (v2Runtimes.has(documentId)) {
    clearV2RuntimeRegistration(documentId);
  }

  const runtimeId = `v2:${documentId}:${++v2RuntimeSeq}`;
  const adapter = createV2EditorRuntimeAdapter({
    id: runtimeId,
    documentId,
    root,
    host,
    getLegacyEditorProjection: () => facade,
    onUnregister: (id) => {
      proxy.$superdoc.unregisterEditorRuntime(id);
      const current = v2Runtimes.get(documentId);
      if (current && current.runtimeId === id) v2Runtimes.delete(documentId);
      const hostRoot = subDocumentRoots.get(documentId);
      if (hostRoot) unmarkRuntimeRoot(hostRoot);
    },
  });

  adapter.attachMountHandle(mount ?? null);
  markRuntimeRoot(root, runtimeId);
  proxy.$superdoc.registerEditorRuntime(adapter.runtime);
  v2Runtimes.set(documentId, { runtimeId, adapter });
  proxy.$superdoc.setActiveRuntime(runtimeId, 'v2-editor-ready');
  return true;
};

// ui-phase2-001: V2 ready / failure handlers. These DO NOT impersonate the v1
// `Editor` / `DocumentRendererRuntime` surface. Instead, the shell publishes a
// small v2 facade on `proxy.$superdoc.activeEditor` so existing read-only
// access patterns (`activeEditor.options.documentId`) keep working while
// v1-only methods (`commands`, `state`, `view`, `chain`, `can`) are absent by
// design. Visible shell chrome that previously called those v1-only methods
// is gated by `isV2Mode` and the editorVersion=2 capability surface.
// One committed paint carries the exact review identities for its mounted
// window. The isolated review worker resolves comments and tracked changes at
// one canonical coordinate; this controller applies both row families in one
// Pinia patch while the existing presentation owner remains in place.
// Rows and geometry stay separate: review work never delays canonical paint.
const v2ReviewWindowController = resolvedEditorIntegration.createReviewWindowController({
  applyReviewWindow: (ctx, result) =>
    commentsStore.applyReviewWindowFromV2?.({
      superdoc: ctx?.superdoc,
      commentsAdapter: ctx?.commentsAdapter,
      trackedChangesAdapter: ctx?.trackedChangesAdapter,
      documentId: ctx?.documentId,
      commentItems: result?.comments?.items,
      trackedChangeItems: result?.trackedChanges?.items,
      requestedCommentIds: result?.comments?.requestedIds,
      requestedTrackedChangeIds: result?.trackedChanges?.requestedIds,
      unresolvedCommentIds: result?.comments?.unresolvedCommentIds,
      trackedList: {
        complete: false,
        visibleWindowSource: 'visible-window',
      },
      patch: (callback) => commentsStore.$patch(callback),
    }) ?? { ok: false, reason: 'store-action-missing' },
});

// ui-phase2-001 / plan §Workstream 3: renderable V2 terminal failure state for
// the active document surface, keyed by documentId. The visible failure UI is
// owned by the V2 browser shell overlay; this store lets shell chrome read the
// last typed failure (reason + content-safe detail) without re-deriving it.
const v2EditorFailures = ref({});

// SuperDoc Diagnostics MVP: dedupe/generation logic lives in
// internal/diagnostics/diagnostic-dedupe.js (unit-tested there) so it's
// testable without mounting this whole component. `generation` is a
// per-attempt number the v2 shell stamps on `v2-editor-failed` /
// `v2-open-diagnostics` / `v2-render-readiness` payloads (bumped at the
// START of every `boot()` / `replaceFile()` / `collaboration:document-replaced`
// attempt in `V2SuperEditor.vue`) -- it must come from the shell, not be
// inferred here from `onV2EditorReady` timing: that event only fires on
// success, fires AFTER the diagnostics events on the success path, and
// never fires at all for a failed attempt.
const v2DiagnosticDedupe = createV2DiagnosticDedupe();

const v2AuthorRequiredGate = createV2AuthorRequiredNotificationGate();
const v2EditRejectedGate = createV2KeyboardEditRejectionNotificationGate();
const v2MutationNoticeScope = (documentId) =>
  typeof documentId === 'string' && documentId.length > 0 ? `document:${documentId}` : 'document:default';

const clearV2MutationRejectionNotifications = (documentId) => {
  const scope = v2MutationNoticeScope(documentId);
  v2AuthorRequiredGate.clear(scope);
  v2EditRejectedGate.clear(scope);
};

const maybeNotifyV2AuthorRequired = (documentId, event) => {
  if (!v2AuthorRequiredGate.shouldNotify(v2MutationNoticeScope(documentId), event)) return;
  proxy.$superdoc.emit('exception', {
    error: new Error(V2_AUTHOR_REQUIRED_MESSAGE, { cause: createV2MutationRejectionCause(event) }),
    code: V2_AUTHOR_REQUIRED_CODE,
    editor: null,
    ...(typeof documentId === 'string' && documentId.length > 0 ? { documentId } : {}),
  });
};

const maybeNotifyV2EditRejected = (documentId, event) => {
  if (!v2EditRejectedGate.shouldNotify(v2MutationNoticeScope(documentId), event)) return;
  proxy.$superdoc.emit('exception', createV2KeyboardEditRejectionException(documentId, event));
};

const getV2EditorFailure = (documentId) =>
  documentId && v2EditorFailures.value[documentId] ? v2EditorFailures.value[documentId] : null;

const setV2EditorFailure = (documentId, failure) => {
  if (!documentId) return;
  v2EditorFailures.value = { ...v2EditorFailures.value, [documentId]: failure };
};

const clearV2EditorFailure = (documentId) => {
  if (!documentId || !v2EditorFailures.value[documentId]) return;
  const next = { ...v2EditorFailures.value };
  delete next[documentId];
  v2EditorFailures.value = next;
};

const clearActiveV2EditorFacade = (documentId = null) => {
  const activeEditor = proxy.$superdoc?.activeEditor;
  const activeDocumentId = documentId ?? activeEditor?.documentId ?? activeEditor?.options?.documentId ?? null;
  if (!activeDocumentId) {
    if (activeEditor?.editorVersion === 2) {
      proxy.$superdoc.setActiveEditor(null);
    }
    return;
  }

  if (documentId && activeEditor?.editorVersion === 2) {
    const currentDocumentId = activeEditor.documentId ?? activeEditor.options?.documentId ?? null;
    if (currentDocumentId && currentDocumentId !== documentId) return;
  }

  const doc = activeDocumentId ? getDocument(activeDocumentId) : null;
  if (doc) {
    doc.isReady = false;
    if (typeof doc.setEditor === 'function') doc.setEditor(null);
  }
  const hadRegisteredRuntime = v2Runtimes.has(activeDocumentId);
  clearV2RuntimeRegistration(activeDocumentId);
  if (!hadRegisteredRuntime && activeEditor?.editorVersion === 2) {
    const currentDocumentId = activeEditor.documentId ?? activeEditor.options?.documentId ?? null;
    if (currentDocumentId === activeDocumentId) {
      proxy.$superdoc.setActiveEditor(null);
    }
  }
};

// Build the narrow public `activeEditor.extensions` facet from the v2 host's
// extension manager. Exposes command execution + diagnostics without leaking
// the raw private manager or its command handles. Returns null when no
// extensions are registered on the active document.
const createV2ExtensionsFacet = (host) => {
  const manager = typeof host?.getExtensionManager === 'function' ? host.getExtensionManager() : null;
  if (!manager) return null;
  const registry = manager.commands;
  return {
    commands: {
      execute: (id, payload) => registry.execute(id, payload),
      getState: (id) => {
        const handle = registry.get(id);
        if (!handle) return null;
        const state = handle.getState() ?? {};
        // The runtime command state has no dedicated reason channel; expose the
        // enabled flag and leave `reason` null until one is surfaced.
        return { enabled: !state.disabled, reason: null };
      },
      list: () =>
        registry.list().map((handle) => {
          const state = handle.getState() ?? {};
          return state.label ? { id: handle.id, label: state.label } : { id: handle.id };
        }),
    },
    diagnostics: {
      getSnapshot: () => manager.diagnostics(),
    },
  };
};

const clearDocumentFieldContext = (documentId) => {
  const document = documents.value.find((entry) => entry.id === documentId);
  const configDocument = proxy.$superdoc.config.documents.find((entry) => entry.id === documentId);
  if (document) document.fieldContext = {};
  if (configDocument) configDocument.fieldContext = {};
};

const onV2EditorReady = (payload) => {
  if (!payload) return;
  // A successful open clears any prior terminal failure for this surface.
  clearV2EditorFailure(payload.documentId ?? null);
  clearV2MutationRejectionNotifications(payload.documentId ?? null);
  const {
    host,
    mount,
    documentId,
    capabilities,
    editCommands,
    bindEditShortcuts,
    bindSessionShortcuts,
    commentsAdapter,
    trackedChangesAdapter,
    contextMenu,
    documentApi,
    documentMutationReadiness,
    documentApiUnavailableReason,
    pageMetrics,
    pageLayout,
    pageFurniture,
    presence,
    lock,
    collaborationProvider,
    fonts,
    replaceFile,
    upgradeToCollaboration,
    documentOpenToken,
  } = payload;
  documentOpenTelemetry?.trackDocumentOpen(documentOpenToken ?? null, documentId ?? null);
  const saveV2Bytes = createV2SaveQueue(async (saveOptions = {}) => {
    if (!host || typeof host.save !== 'function') {
      throw new Error('v2-editor: save unavailable');
    }
    return host.save(saveOptions);
  });
  // Map the public `commentsType` contract onto the v2 serializer's comment
  // export policy. `clean` strips comments; everything else (default /
  // `external`) preserves them. v2 export authority lives in the v2 session
  // serializer — we never route v2 comments through the disabled v1
  // editor-backed comment serialization path.
  const exportV2Docx = async (options = {}) => {
    const commentExportMode = options?.commentsType === 'clean' ? 'strip' : 'preserve';
    const bytes = await saveV2Bytes({ format: 'docx', commentExportMode });
    return new Blob([bytes], { type: DOCX });
  };
  const replaceV2File = async (source) => {
    if (typeof replaceFile !== 'function') {
      throw new Error('v2-editor: replaceFile unavailable');
    }
    const result = await replaceFile(source);
    if (result?.state === 'review-ready' || result?.state === 'editing-ready') clearDocumentFieldContext(documentId);
    return result;
  };
  const upgradeV2ToCollaboration = async (source, collaboration) => {
    if (typeof upgradeToCollaboration !== 'function') {
      throw new Error('v2-editor: upgradeToCollaboration unavailable');
    }
    return upgradeToCollaboration(source, collaboration);
  };
  const focusV2Editable = (options = {}) => {
    if (mount?.focus && typeof mount.focus.focus === 'function') {
      return mount.focus.focus(options);
    }
    return false;
  };
  const createV2AuthoringFailure = (reason, detail = undefined) => {
    const result = { ok: false, reason };
    if (detail) result.detail = detail;
    return result;
  };
  const readV2QueryItems = (result) => (Array.isArray(result?.items) ? result.items : []);
  const normalizeV2Occurrence = (occurrence) => {
    const value = Number(occurrence);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };
  const resolveV2TextMatch = async ({ text, occurrence = 0 } = {}) => {
    if (typeof text !== 'string' || text.length === 0) {
      return createV2AuthoringFailure('invalid-text', 'text must be a non-empty string');
    }
    if (!documentApi?.query || typeof documentApi.query.match !== 'function') {
      return createV2AuthoringFailure('query-unavailable', 'activeEditor.doc.query.match is not available');
    }
    const occurrenceIndex = normalizeV2Occurrence(occurrence);
    const result = await documentApi.query.match({
      select: { type: 'text', pattern: text },
      limit: occurrenceIndex + 1,
    });
    const items = readV2QueryItems(result);
    const item = items[occurrenceIndex] ?? null;
    if (!item?.target) {
      return createV2AuthoringFailure('text-not-found', `text not found: ${text}`);
    }
    return {
      ok: true,
      item,
      target: item.target,
      ref: typeof item?.handle?.ref === 'string' ? item.handle.ref : null,
      text,
      occurrence: occurrenceIndex,
      total: Number.isFinite(Number(result?.total)) ? Number(result.total) : items.length,
    };
  };
  const collapseV2SelectionTarget = (target, collapse) => {
    if (!target || typeof target !== 'object' || target.kind !== 'selection') return target;
    if (collapse !== 'start' && collapse !== 'end') return target;
    const point = collapse === 'start' ? target.start : target.end;
    if (!point) return target;
    return {
      kind: 'selection',
      start: point,
      end: point,
      ...(target.story ? { story: target.story } : {}),
    };
  };
  const applyV2SelectionTarget = async ({ target, collapse = null, focus = true } = {}) => {
    if (!target || typeof target !== 'object') {
      return createV2AuthoringFailure('invalid-target', 'target must be a SelectionTarget object');
    }
    const selectionTarget = collapseV2SelectionTarget(target, collapse);
    const editing = host?.getHandles?.()?.editing ?? null;
    const selectionTargets = editing?.selectionTargets ?? null;
    if (typeof selectionTargets?.apply !== 'function') {
      return createV2AuthoringFailure(
        'selection-target-unavailable',
        'editing.selectionTargets.apply is not available',
      );
    }
    let result;
    try {
      result = selectionTargets.apply(selectionTarget);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createV2AuthoringFailure('selection-target-threw', message);
    }
    if (!result?.ok) {
      return createV2AuthoringFailure(result?.reason ?? 'selection-target-rejected', result?.detail);
    }
    if (focus !== false) await Promise.resolve(focusV2Editable());
    return { ok: true, mode: result.mode ?? 'range' };
  };
  const currentV2AuthoringMode = () => (proxy.$superdoc.config.documentMode === 'suggesting' ? 'tracked' : 'direct');
  const readV2CurrentSelectionTarget = () => {
    const editing = host?.getHandles?.()?.editing ?? null;
    const selection = editing?.selection ?? null;
    if (typeof selection?.toSelectionTarget !== 'function') {
      return createV2AuthoringFailure(
        'selection-target-unavailable',
        'editing.selection.toSelectionTarget is not available',
      );
    }
    const result = selection.toSelectionTarget();
    if (!result || result.kind === 'rejected') {
      const rejection = result?.rejection ?? {};
      return createV2AuthoringFailure(
        rejection.reason ?? rejection.code ?? 'selection-target-rejected',
        rejection.detail,
      );
    }
    if (!result.target || typeof result.target !== 'object') {
      return createV2AuthoringFailure('selection-target-rejected', 'selection target was not produced');
    }
    return {
      ok: true,
      target: result.target,
      mode: result.mode ?? 'range',
      story: result.story,
    };
  };
  const failureFromV2Receipt = (receipt, fallbackReason) => {
    const failure = receipt?.failure ?? receipt;
    return createV2AuthoringFailure(
      failure?.code ?? receipt?.reason ?? fallbackReason,
      failure?.message ?? failure?.detail ?? receipt?.detail,
    );
  };
  const v2Authoring = {
    focusEditable: focusV2Editable,
    readBlocks: (input = { includeText: true }) => documentApi?.blocks?.list?.(input),
    setSelectionTarget: (input = {}) => applyV2SelectionTarget(input),
    setSelectionByText: async (input = {}) => {
      const resolved = await resolveV2TextMatch(input);
      if (!resolved.ok) return resolved;
      const applied = await applyV2SelectionTarget({
        target: resolved.target,
        collapse: input?.collapse ?? null,
        focus: input?.focus,
      });
      if (!applied.ok) return applied;
      return {
        ok: true,
        mode: applied.mode,
        text: resolved.text,
        occurrence: resolved.occurrence,
        target: resolved.target,
      };
    },
    replaceTextByText: async ({ findText, replacement, occurrence = 0, mode = 'direct' } = {}) => {
      if (typeof replacement !== 'string') {
        return createV2AuthoringFailure('invalid-replacement', 'replacement must be a string');
      }
      if (!documentApi?.text || typeof documentApi.text.replace !== 'function') {
        return createV2AuthoringFailure('text-replace-unavailable', 'activeEditor.doc.text.replace is not available');
      }
      const resolved = await resolveV2TextMatch({ text: findText, occurrence });
      if (!resolved.ok) return resolved;
      const input = resolved.ref
        ? { ref: resolved.ref, text: replacement, mode }
        : { target: resolved.target, text: replacement, mode };
      const receipt = await documentApi.text.replace(input);
      if (receipt?.ok === false) {
        return createV2AuthoringFailure(receipt.reason ?? 'text-replace-failed', receipt.detail);
      }
      await Promise.resolve(documentMutationReadiness?.whenPainted?.(receipt));
      return {
        ok: true,
        receipt,
        text: replacement,
        replacedText: findText,
        occurrence: normalizeV2Occurrence(occurrence),
      };
    },
    replaceSelection: async ({ target, replacement = '', mode = 'direct' } = {}) => {
      if (!target || typeof target !== 'object') {
        return createV2AuthoringFailure('invalid-target', 'target must be a SelectionTarget object');
      }
      if (typeof replacement !== 'string') {
        return createV2AuthoringFailure('invalid-replacement', 'replacement must be a string');
      }
      if (!documentApi?.text || typeof documentApi.text.replace !== 'function') {
        return createV2AuthoringFailure('text-replace-unavailable', 'activeEditor.doc.text.replace is not available');
      }
      const receipt = await documentApi.text.replace({ target, text: replacement, mode });
      if (receipt?.ok === false) {
        return createV2AuthoringFailure(receipt.reason ?? 'text-replace-failed', receipt.detail);
      }
      await Promise.resolve(documentMutationReadiness?.whenPainted?.(receipt));
      return {
        ok: true,
        receipt,
        text: replacement,
      };
    },
    serializeSelectionToClipboard: async ({ includeHtml = true } = {}) => {
      if (!documentApi?.clipboard || typeof documentApi.clipboard.serializeSelection !== 'function') {
        return createV2AuthoringFailure(
          'clipboard-serialize-unavailable',
          'activeEditor.doc.clipboard.serializeSelection is not available',
        );
      }
      const selected = readV2CurrentSelectionTarget();
      if (!selected.ok) return selected;
      let serialized;
      try {
        serialized = await documentApi.clipboard.serializeSelection({
          target: selected.target,
          includeHtml: includeHtml !== false,
        });
      } catch (error) {
        return createV2AuthoringFailure(
          'clipboard-serialize-threw',
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!serialized?.payload) {
        return createV2AuthoringFailure(
          'clipboard-serialize-failed',
          'clipboard serialization did not return a payload',
        );
      }
      return {
        ok: true,
        payload: serialized.payload,
        plan: serialized.plan,
        target: selected.target,
        mode: selected.mode,
      };
    },
    pasteClipboardPayload: async ({
      payload,
      target = null,
      mode = currentV2AuthoringMode(),
      fallback = undefined,
    } = {}) => {
      if (!payload || typeof payload !== 'object') {
        return createV2AuthoringFailure('invalid-clipboard-payload', 'payload must be a ClipboardPayload object');
      }
      if (!documentApi?.clipboard || typeof documentApi.clipboard.insert !== 'function') {
        return createV2AuthoringFailure(
          'clipboard-insert-unavailable',
          'activeEditor.doc.clipboard.insert is not available',
        );
      }
      let pasteTarget = target;
      let selectionMode = null;
      if (!pasteTarget) {
        const selected = readV2CurrentSelectionTarget();
        if (!selected.ok) return selected;
        pasteTarget = selected.target;
        selectionMode = selected.mode;
      }
      if (!pasteTarget || typeof pasteTarget !== 'object') {
        return createV2AuthoringFailure('invalid-target', 'target must be a SelectionTarget or ClipboardTarget object');
      }
      const input = {
        payload,
        target: pasteTarget,
        changeMode: mode === 'tracked' ? 'tracked' : 'direct',
        ...(fallback !== undefined ? { fallback } : {}),
      };
      const receipt = await documentApi.clipboard.insert(input);
      if (!receipt || receipt.success === false || receipt.ok === false) {
        return failureFromV2Receipt(receipt, 'clipboard-insert-failed');
      }
      await Promise.resolve(documentMutationReadiness?.whenPainted?.(receipt));
      return {
        ok: true,
        receipt,
        target: pasteTarget,
        mode: selectionMode,
      };
    },
    pastePlainText: async ({ text, target = null, mode = currentV2AuthoringMode() } = {}) => {
      if (typeof text !== 'string') {
        return createV2AuthoringFailure('invalid-text', 'text must be a string');
      }
      return v2Authoring.pasteClipboardPayload({
        payload: {
          source: 'api',
          items: [{ type: 'text/plain', kind: 'string', data: text }],
        },
        target,
        mode,
      });
    },
  };
  const facade = {
    editorVersion: 2,
    documentId,
    host,
    mount,
    options: {
      documentId,
      documentMode: proxy.$superdoc.config.documentMode,
    },
    // Stable disabled / not-shipped status mirror — the host capability
    // snapshot is the source of truth; this is a convenience surface for the
    // shell so it does not have to re-read `host.getCapabilities()` on every
    // toolbar tick.
    capabilities: capabilities ?? host?.getCapabilities?.() ?? null,
    save: saveV2Bytes,
    exportDocx: exportV2Docx,
    replaceFile: replaceV2File,
    upgradeToCollaboration: upgradeV2ToCollaboration,
    // Mutation-plane consolidation: `activeEditor.doc` is the SuperDoc-facing
    // browser Document API surface. It is the host-provided,
    // contract-classified facade emitted by the v2 browser shell
    // (`host.getDocumentFacade().doc`). The host facade is the single read-only
    // enforcement plane: mutations fail closed in viewing/review mode, reads
    // pass through, and `doc.selection.current` is the host-owned live
    // selection. Worker-backed browser facades return promises; SDK/headless
    // inline callers keep the synchronous Document API.
    doc: documentApi ?? null,
    // Visual readiness helper emitted beside the document facade. Callers that
    // need painted overlay/sidebar/geometry evidence await
    // `documentMutationReadiness.whenPainted(...)` after a committed receipt.
    documentMutationReadiness: documentMutationReadiness ?? null,
    // Stable reason when the browser Document API facade is unavailable. Null
    // when `doc.comments` / `doc.trackChanges` are live.
    documentApiUnavailableReason: documentApiUnavailableReason ?? null,
    focus: focusV2Editable,
    // Bounded authoring bridge for browser proof/setup code. This is not a v1
    // ProseMirror compatibility projection; it resolves public Document API
    // targets and applies them through the v2 host's editable selection handle.
    authoring: v2Authoring,
    editCommands: editCommands ?? null,
    // ui-phase3-002: v2 comments adapter — used by comments-store and
    // CommentDialog to route create / reply / edit / resolve / delete through
    // v2 host APIs. Always present in v2 mode; null when the v2 editor host
    // boot failed.
    v2Comments: commentsAdapter ?? null,
    // ui-phase3-003: v2 tracked-change adapter — used by comments-store and
    // CommentDialog to list / focus / accept / reject tracked changes through
    // v2 host APIs. Always present in v2 mode; null when the v2 editor host
    // boot failed.
    v2TrackedChanges: trackedChangesAdapter ?? null,
    contextMenu: contextMenu ?? null,
    // ui-phase4-001: v2 page metrics + zoom runtime. Always present in v2
    // mode (null only if the v2 editor host boot failed). Consumers:
    //   - SuperDoc.vue's `activeZoom` watcher calls `pageMetrics.setZoom`
    //   - rulers, floating layers, whiteboard overlays consume
    //     `pageMetrics.getSnapshot()` / `subscribe(...)`.
    pageMetrics: pageMetrics ?? null,
    // ui-phase4-002: narrow v2 page-layout bridge for ruler / margin chrome.
    // Always present in v2 mode (null only if the v2 editor host boot failed).
    // Routes margin edits through `doc.sections.setPageMargins(...)` under
    // the hood; never exposes raw host/session/adapter handles to Vue.
    pageLayout: pageLayout ?? null,
    // Host-visible page-furniture geometry
    // readback. Always present in v2 mode (null only if the v2 editor host
    // boot failed). Host-visible proofs read
    // `superdoc.activeEditor.pageFurniture.getSnapshot()` to associate painted
    // header/footer regions with their story ref ids.
    pageFurniture: pageFurniture ?? null,
    // v2 collaboration cursor UI readback. Product-owned browser shell
    // facade; exposes normalized presence/overlay state only, never raw
    // provider/awareness/Yjs handles.
    presence: presence ?? null,
    // v2 collaboration lock metadata facade. Backed by the same single-doc
    // collaborative root Y.Doc as document content/presence.
    lock: lock ?? null,
    provider: collaborationProvider ?? null,
    // Read-only review sidecar facet. The snapshot contains only rows from the
    // currently committed page window; custom UI consumes it without starting
    // an independent whole-document comments/track-changes catalog read.
    reviewWindow: {
      getDiagnostics: () => v2ReviewWindowController.getDiagnostics(),
      getSnapshot: () => v2ReviewWindowController.getSnapshot?.() ?? null,
      subscribe: (listener) => v2ReviewWindowController.subscribe?.(listener) ?? (() => undefined),
    },
    // Narrow public v2 extension facet (commands + diagnostics). Null when no
    // `config.extensions` are registered on the active document. Backed by the
    // host extension manager; never exposes the raw manager or command handles.
    extensions: createV2ExtensionsFacet(host),
    // Font parity: the active document's font runtime facet (read/write font API + report stream).
    // `SuperDoc.ts` routes `superdoc.fonts.*` and the `fonts-changed` relay through this for v2.
    fonts: fonts ?? host?.getFontRuntime?.() ?? null,
    /**
     * The v2 active-editor facade explicitly does NOT carry v1 commands /
     * state / view / chain / can. Document mutations (comments, tracked
     * changes, history) go through `activeEditor.doc.*` — the browser
     * Document API facade above. Narrow read / focus / reveal / active-target
     * controls use their explicit bridge surfaces (`v2Comments` /
     * `v2TrackedChanges`); those are not review mutation routes. Chrome that
     * still expects the old surface must fail closed in superdoc@2.
     */
    commands: null,
    state: null,
    view: null,
  };

  const doc = getDocument(documentId);
  if (doc) {
    doc.isReady = true;
    if (typeof doc.setEditor === 'function') doc.setEditor(facade);
  }
  const runtimeRegistered = registerV2Runtime({ documentId, host, mount, facade });
  if (!runtimeRegistered) {
    proxy.$superdoc.setActiveEditor(facade);
  }
  if (collaborationProvider) {
    const provider = markRaw(collaborationProvider);
    proxy.$superdoc.provider = provider;
    if (doc) doc.provider = provider;
  }
  proxy.$superdoc.broadcastEditorCreate(facade);
  installV2CommandShortcutBinding({ documentId, bindEditShortcuts });
  installV2SessionShortcutBinding({ documentId, bindSessionShortcuts, documentApi });
  if (resolveDocumentV2Collaboration(getDocument(documentId)).state === 'valid') {
    onEditorCollaborationReady({ editor: facade });
  }
  // ui-phase4-002: flip the reactive readiness signal so the ruler template
  // re-evaluates `shouldShowV2Ruler(doc)` now that pageMetrics + pageLayout
  // are attached to the active editor facade.
  if (pageMetrics && pageLayout) {
    syncV2RulerActiveEditor();
  }

  // ui-phase3-002 / ui-phase3-003: register the v2 comment + tracked-change
  // adapters on the store so its adapter-identity guard
  // (`isCurrentV2TrackedChangesAdapter`) can drop stale async results, then
  // hand the committed-window controller its context. Committed page windows
  // are the sole passive source for built-in review presentation.
  const commentsModuleEnabled = proxy.$superdoc.config.modules?.comments !== false;
  if (commentsAdapter && commentsModuleEnabled) {
    commentsStore.setV2CommentsAdapter?.(commentsAdapter);
  }
  if (trackedChangesAdapter && commentsModuleEnabled) {
    commentsStore.setV2TrackedChangesAdapter?.(trackedChangesAdapter);
  }
  // Surface ownership is not capability ownership. `ui.comments: false`
  // suppresses the built-in sidebar but custom UI still consumes the bounded
  // review feed, so the controller must attach whenever either adapter exists.
  if (commentsAdapter || trackedChangesAdapter) {
    v2ReviewWindowController.setContext({
      superdoc: proxy.$superdoc,
      documentId,
      commentsAdapter: commentsAdapter ?? null,
      trackedChangesAdapter: trackedChangesAdapter ?? null,
      resolveReviewWindow: (input) => host.resolveReviewWindow(input),
    });
  }
  if (areDocumentsReady.value && !proxy.$superdoc.config.collaboration) {
    isReady.value = true;
  }
  // Mark floating-comments fallback so the v2-mode shell does not idle on
  // the v1-only locations-update event.
  isFloatingCommentsReady.value = true;
  hasInitializedLocations.value = true;
};

// ui-phase3-002: v2 selection mirror used to gate the create-comment
// affordance in v2 mode. v1's `selectionPosition` is fed by PM coordsAtPos
// which v2 never emits, so we maintain a separate flag and feed the floating
// "+" tool from the v2 selection snapshot instead.
const v2HasRangeSelection = ref(false);
const v2SelectionSnapshot = shallowRef(null);
/** True after a viewing-mode range was mirrored from the browser DOM selection. */
const v2DomMirroredRange = ref(false);
let v2SelectionToolbarRafHandle = 0;
let v2SelectionToolbarTimeoutHandle = 0;
let v2DomSelectionRafHandle = 0;
const V2_SELECTION_TOOLBAR_SYNC_RETRY_FRAMES = 3;
const buildV2EditorUpdatePayload = ({
  editor,
  sourceEditor,
  surface = 'body',
  headerId = null,
  sectionType = null,
} = {}) => {
  const activeEditor = proxy.$superdoc?.activeEditor ?? null;
  const effectiveEditor = editor ?? sourceEditor ?? activeEditor ?? undefined;
  return {
    editor: effectiveEditor,
    sourceEditor: sourceEditor ?? effectiveEditor,
    surface,
    headerId,
    sectionType,
  };
};

const emitV2EditorUpdate = (payload = {}) => {
  proxy.$superdoc.emit('editor-update', buildV2EditorUpdatePayload(payload));
};

const cancelScheduledV2SelectionToolbarSync = () => {
  if (v2SelectionToolbarRafHandle && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(v2SelectionToolbarRafHandle);
  }
  if (v2SelectionToolbarTimeoutHandle) {
    clearTimeout(v2SelectionToolbarTimeoutHandle);
  }
  v2SelectionToolbarRafHandle = 0;
  v2SelectionToolbarTimeoutHandle = 0;
};

const scheduleV2SelectionToolbarStateSync = (remainingAttempts = V2_SELECTION_TOOLBAR_SYNC_RETRY_FRAMES) => {
  cancelScheduledV2SelectionToolbarSync();

  const run = () => {
    v2SelectionToolbarRafHandle = 0;
    v2SelectionToolbarTimeoutHandle = 0;
    syncV2SelectionToolbarState();

    if (v2HasRangeSelection.value && isCommentsEnabled.value && !selectionPosition.value && remainingAttempts > 0) {
      scheduleV2SelectionToolbarStateSync(remainingAttempts - 1);
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    v2SelectionToolbarRafHandle = requestAnimationFrame(run);
    return;
  }

  v2SelectionToolbarTimeoutHandle = setTimeout(run, 0);
};

const cancelScheduledV2DomSelectionSync = () => {
  if (v2DomSelectionRafHandle && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(v2DomSelectionRafHandle);
  }
  v2DomSelectionRafHandle = 0;
};

const clearV2SelectionToolbarState = () => {
  v2HasRangeSelection.value = false;
  v2SelectionSnapshot.value = null;
  cancelScheduledV2SelectionToolbarSync();
  syncV2SelectionToolbarState();
};

const isV2DomRangeSelection = (selection, root) => {
  if (!selection || selection.rangeCount < 1 || selection.isCollapsed || !root) return false;
  const range = selection.getRangeAt(0);
  return root.contains(range.startContainer) && root.contains(range.endContainer);
};

const applyCurrentV2DomSelection = () => {
  v2DomSelectionRafHandle = 0;
  if (!isV2Mode.value) return;

  let handles = null;
  try {
    handles = proxy.$superdoc?.activeEditor?.host?.getHandles?.() ?? null;
  } catch {
    handles = null;
  }

  const documentMode = proxy.$superdoc?.config?.documentMode;
  if (documentMode === 'editing' || documentMode === 'suggesting') {
    // ui-phase3-002: In editable modes the v2 host owns pointer text selection
    // and cancels the browser's native selectstart (see editable-input.ts), so
    // a held host range must never be overwritten by a leftover DOM slice.
    // When the host holds NO range, a native DOM range may still be the source
    // of truth (programmatic selection APIs and test scaffolding create one
    // without going through the host pointer path), so only then fall through
    // to the DOM-selection mirror below.
    const hostSnapshot = handles?.editing?.selection?.getSnapshot?.() ?? null;
    // Prefer the controller's tracked-space-aware range check over the raw
    // blockOffset comparison in `shouldPreserveHostV2Selection`: a selection
    // wholly inside a tracked deletion has zero visible width, so anchor and
    // focus land at the same blockOffset even though it is a real range.
    const renderedHostTarget = handles?.editing?.selection?.toSelectionTarget?.();
    const hasHostRange = renderedHostTarget
      ? renderedHostTarget.kind === 'ok' && renderedHostTarget.mode === 'range'
      : shouldPreserveHostV2Selection(documentMode, hostSnapshot);
    if (hasHostRange) {
      const root = getActiveV2MountContainer();
      const selection = window.getSelection?.() ?? null;
      if (hasOutsideV2DomRangeSelection(selection, root)) {
        clearV2SelectionToolbarState();
        return;
      }

      v2HasRangeSelection.value = true;
      v2SelectionSnapshot.value = hostSnapshot;
      scheduleV2SelectionToolbarStateSync();
      return;
    }
  } else if (documentMode !== 'viewing') {
    clearV2SelectionToolbarState();
    return;
  }

  const root = getActiveV2MountContainer();
  const selection = window.getSelection?.() ?? null;

  if (!isV2DomRangeSelection(selection, root)) {
    // Viewing suppresses native ::selection and paints the host overlay. Keep
    // that overlay while a pending comment dialog owns the selection. A
    // DOM-mirrored range that collapses (chrome click / focus loss) must clear
    // so the blue overlay does not stick. A programmatic SelectionTarget apply
    // never mirrored through the DOM must keep the model range so custom UI
    // createFromSelection still sees it (SD-4470).
    const renderedHostTarget = handles?.selection?.toSelectionTarget?.();
    const hasHostRange = renderedHostTarget?.kind === 'ok' && renderedHostTarget.mode === 'range';
    if (hasHostRange && pendingComment.value) {
      v2HasRangeSelection.value = true;
      v2SelectionSnapshot.value = handles?.selection?.getSnapshot?.() ?? null;
      handles?.selection?.syncVisibleOverlay?.();
      scheduleV2SelectionToolbarStateSync();
      return;
    }
    if (hasHostRange && v2DomMirroredRange.value) {
      handles?.selection?.clear?.();
      v2DomMirroredRange.value = false;
    }
    clearV2SelectionToolbarState();
    return;
  }

  const result = handles?.selection?.applyDomSelection?.(selection);
  if (!result?.ok || result.mode !== 'range') {
    clearV2SelectionToolbarState();
    return;
  }

  v2DomMirroredRange.value = true;
  v2HasRangeSelection.value = true;
  v2SelectionSnapshot.value = handles?.selection?.getSnapshot?.() ?? null;
  scheduleV2SelectionToolbarStateSync();
};

const scheduleV2DomSelectionSync = () => {
  if (!isV2Mode.value) return;
  cancelScheduledV2DomSelectionSync();
  if (typeof requestAnimationFrame !== 'function') {
    applyCurrentV2DomSelection();
    return;
  }
  v2DomSelectionRafHandle = requestAnimationFrame(applyCurrentV2DomSelection);
};

const handleDocumentSelectionChange = () => {
  scheduleV2DomSelectionSync();
};

const onV2SelectionChanged = ({ hasRangeSelection, snapshot } = {}) => {
  v2HasRangeSelection.value = hasRangeSelection === true;
  v2SelectionSnapshot.value = hasRangeSelection === true ? (snapshot ?? null) : null;
  if (v2HasRangeSelection.value) {
    scheduleV2SelectionToolbarStateSync();
    return;
  }

  cancelScheduledV2SelectionToolbarSync();
  syncV2SelectionToolbarState();
};

const getActiveV2MountContainer = () => {
  return v2GeometryRender.value?.mountContainer ?? proxy.$superdoc?.activeEditor?.mount?.container ?? null;
};

const escapeCssIdent = (value) => {
  const raw = String(value);
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(raw);
  return raw.replace(/["\\]/g, '\\$&');
};

const findV2SelectionAnchorElement = () => {
  const snapshot = v2SelectionSnapshot.value;
  const root = getActiveV2MountContainer();
  if (!snapshot || !root?.querySelector) return null;
  const anchor = snapshot.anchor ?? null;
  const ids = [anchor?.fragmentId, anchor?.blockId, anchor?.position?.anchor?.nativeId].filter(
    (id) => id != null && id !== '',
  );

  for (const id of ids) {
    const escaped = escapeCssIdent(id);
    const match =
      root.querySelector(`[data-source-node-id="${escaped}"]`) ??
      root.querySelector(`[data-layout-block-ref="${escaped}"]`) ??
      root.querySelector(`[data-layout-fragment-id="${escaped}"]`);
    if (match instanceof HTMLElement) return match;
  }
  return null;
};

function getSelectionBoundingBox(root = null) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!range) return null;

  if (root) {
    const { startContainer, endContainer } = range;
    if (!root.contains(startContainer) || !root.contains(endContainer)) return null;
  }

  try {
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
    return rect;
  } catch {
    return null;
  }
}

const rectToLayerBounds = (rect) => {
  if (!rect || !layers.value) return null;
  const layerRect = layers.value.getBoundingClientRect();
  return {
    top: rect.top - layerRect.top,
    left: rect.left - layerRect.left,
    right: rect.right - layerRect.left,
    bottom: rect.bottom - layerRect.top,
    width: rect.width,
    height: rect.height,
  };
};

const readV2PageIndex = (element) => {
  let current = element;
  while (current && current.nodeType === 1) {
    const raw = current.dataset?.pageIndex;
    if (raw != null && raw !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    current = current.parentElement;
  }
  return null;
};

const buildV2FloatingSelection = () => {
  if (!v2HasRangeSelection.value || !isCommentsEnabled.value) return null;

  const selectionRect = getSelectionBoundingBox(getActiveV2MountContainer());
  const bounds = rectToLayerBounds(selectionRect) ?? buildV2PendingPositionEntry()?.bounds ?? null;
  if (!bounds) return null;

  const documentId = proxy.$superdoc?.activeEditor?.options?.documentId ?? proxy.$superdoc?.activeEditor?.documentId;
  if (!documentId) return null;

  const pageIndex = readV2PageIndex(findV2SelectionAnchorElement());
  return useSelection({
    selectionBounds: bounds,
    page: pageIndex != null ? pageIndex + 1 : 1,
    documentId,
    // Reuse the document editor selection path so the comments shell can keep
    // using the same floating comment tool in v2 mode.
    source: DOCUMENT_EDITOR_SELECTION_SOURCE,
  });
};

const buildV2PendingPositionEntry = () => {
  if (!layers.value) return null;
  const target = findV2SelectionAnchorElement();
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
  const layerRect = layers.value.getBoundingClientRect();
  const bounds = {
    top: rect.top - layerRect.top,
    left: rect.left - layerRect.left,
    right: rect.right - layerRect.left,
    bottom: rect.bottom - layerRect.top,
    width: rect.width,
    height: rect.height,
  };
  const pageIndex = readV2PageIndex(target);
  return {
    threadId: 'pending',
    key: 'pending',
    kind: 'pending',
    storyKey: 'body',
    bounds,
    ...(pageIndex != null ? { pageIndex } : {}),
    ...(v2GeometryEpoch.value != null ? { generation: v2GeometryEpoch.value } : {}),
  };
};

const syncV2SelectionToolbarState = () => {
  if (!isV2Mode.value) return;
  if (!v2HasRangeSelection.value) {
    activeSelection.value = null;
    resetSelection();
    return;
  }

  const selection = buildV2FloatingSelection();
  if (!selection) {
    activeSelection.value = null;
    resetSelection();
    return;
  }

  handleSelectionChange(selection);
};

const publishV2PendingPositionEntry = (entry) => {
  if (!entry) return;
  handleEditorLocationsUpdate({
    ...(editorCommentPositions.value ?? {}),
    pending: entry,
  });
};

// TCS Phase 0 / 002: framework-agnostic geometry publisher. Owns alias
// caching, pending-row preservation, missing-mount/layers clearing, and
// scroll/resize/zoom recollection (see `v2-geometry-publisher.js`). The
// SuperDoc.vue side only feeds payloads and observes the published state.
const v2GeometryPublisher = resolvedEditorIntegration.createGeometryPublisher({
  getLayersContainer: () => layers.value ?? null,
  isCommentsEnabled: () => shouldRenderCommentsInViewing.value,
  publishPositions: (positions, options) => handleEditorLocationsUpdate(positions, options),
  clearPositions: () => {
    commentsStore.clearEditorCommentPositions?.();
  },
  readCurrentPositions: () => editorCommentPositions.value ?? {},
  setGeometryAvailable: (value) => {
    const next = Boolean(value);
    v2GeometryAvailable.value = next;
    if (next) {
      v2ReviewSidebarUnlocked.value = true;
      v2GeometryEpoch.value = v2GeometryPublisher.getLastEpoch();
    }
  },
});

const armV2TrackedChangeRestampGeometryRetention = (reason = 'tracked-change-restamp') => {
  v2TrackedChangeRestampRetainPaints = Math.max(v2TrackedChangeRestampRetainPaints, 3);
  v2TrackedChangeRestampRetentionReason = reason;
};

const takeV2TrackedChangeRestampGeometryRetention = () => {
  // Render epochs and worker mutation events cross separate async channels.
  // Firefox can observe the new paint before its receipt reaches this shell,
  // so every render-epoch publish is a geometry handoff: retain last-known
  // positions for still-open TC rows. Scroll/resize/page-window recollects call
  // the publisher without this option and continue to clear stale geometry.
  const reason =
    v2TrackedChangeRestampRetainPaints > 0
      ? (v2TrackedChangeRestampRetentionReason ?? 'tracked-change-restamp')
      : 'render-epoch-handoff';
  if (v2TrackedChangeRestampRetainPaints > 0) v2TrackedChangeRestampRetainPaints -= 1;
  if (v2TrackedChangeRestampRetainPaints <= 0) {
    v2TrackedChangeRestampRetentionReason = null;
  }
  return {
    retainMissingTrackedChangeGeometry: true,
    reason,
  };
};

const clearV2TrackedChangeRestampGeometryRetention = () => {
  v2TrackedChangeRestampRetainPaints = 0;
  v2TrackedChangeRestampRetentionReason = null;
};

const resolveV2GeometryPublishOptions = (options) => (typeof options === 'function' ? options() : options);

const scheduleV2GeometryPublish = (payload, options = undefined) => {
  v2GeometryRender.value = payload;
  if (v2GeometryRafHandle && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(v2GeometryRafHandle);
  }
  if (typeof requestAnimationFrame !== 'function') {
    void v2GeometryPublisher.publish(v2GeometryRender.value, resolveV2GeometryPublishOptions(options));
    return;
  }
  v2GeometryRafHandle = requestAnimationFrame(() => {
    v2GeometryRafHandle = 0;
    void v2GeometryPublisher.publish(v2GeometryRender.value, resolveV2GeometryPublishOptions(options));
  });
};

const onV2Render = (payload) => {
  if (!payload) return;
  scheduleV2GeometryPublish(payload, () => takeV2TrackedChangeRestampGeometryRetention());
  if (v2HasRangeSelection.value) scheduleV2SelectionToolbarStateSync();
};

// ui-phase4-001: receive v2 page metrics snapshots from V2DocumentEditor so
// SuperDoc consumers receive a stable `pagination-update` event. Snapshot shape:
//   `{ snapshot: V2PageMetricsSnapshot, host, mount, stage }`.
const v2PageMetricsSnapshot = shallowRef(null);
const v2MountStagesByDocumentId = new Map();
let latestV2MountStage = null;
const onV2PageMetrics = (payload) => {
  if (!payload?.snapshot) return;
  const snapshot = payload.snapshot;
  const metricStage = payload.stage;
  if (typeof HTMLElement !== 'undefined' && metricStage instanceof HTMLElement) {
    latestV2MountStage = metricStage;
    const stageDocumentId = metricStage.dataset?.superdocV2DocumentId;
    if (stageDocumentId) v2MountStagesByDocumentId.set(stageDocumentId, metricStage);
  }
  v2PageMetricsSnapshot.value = snapshot;
  const totalPages = Array.isArray(snapshot.pages) ? snapshot.pages.length : 0;
  // The pagination-update event payload mirrors the v1 shape
  // (`{ totalPages, superdoc }`) so existing consumers don't need to
  // discriminate on editor version. The richer snapshot is reachable
  // through `superdoc.activeEditor.pageMetrics.getSnapshot()`.
  proxy.$superdoc.emit('pagination-update', { totalPages, superdoc: proxy.$superdoc });
  // ui-phase4-002: keep the ruler container offset aligned with the v2 paint
  // wrapper. Repaint may shift the wrapper bounds (zoom changes, page count
  // changes, scroll); sync once per snapshot so the ruler stays glued to the
  // page stack.
  nextTick(() => {
    syncV2RulerOffset();
    setupV2RulerObservers();
  });
};

const onV2RenderCleared = (payload) => {
  linkPopover.destroy();
  cancelScheduledV2DomSelectionSync();
  cancelScheduledV2SelectionToolbarSync();
  if (v2GeometryRafHandle && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(v2GeometryRafHandle);
  }
  v2GeometryRafHandle = 0;
  v2GeometryRender.value = null;
  v2GeometryEpoch.value = null;
  v2GeometryAvailable.value = false;
  v2ReviewSidebarUnlocked.value = false;
  clearV2TrackedChangeRestampGeometryRetention();
  v2GeometryPublisher.reset();
  v2HasRangeSelection.value = false;
  v2SelectionSnapshot.value = null;
  activeSelection.value = null;
  resetSelection();
  v2PageMetricsSnapshot.value = null;
  const clearedDocumentId = payload?.documentId == null ? null : String(payload.documentId);
  clearV2MutationRejectionNotifications(clearedDocumentId);
  commentsStore.cancelImportedTrackedChangeBootstrap?.(clearedDocumentId ?? undefined);
  if (clearedDocumentId) v2MountStagesByDocumentId.delete(clearedDocumentId);
  if (
    latestV2MountStage &&
    (clearedDocumentId == null || latestV2MountStage.dataset?.superdocV2DocumentId === clearedDocumentId)
  ) {
    latestV2MountStage = null;
  }
  // Invalidate the in-flight committed window before adapter teardown. The
  // controller's generation fence drops any late sidecar result.
  v2ReviewWindowController.reset('render-cleared');
  commentsStore.setV2CommentsAdapter?.(null);
  commentsStore.setV2TrackedChangesAdapter?.(null);
  commentsStore.clearEditorCommentPositions?.();
  clearActiveV2EditorFacade(payload?.documentId ?? null);
  syncV2RulerActiveEditor();
};

const onV2HostEvent = (document, event) => {
  if (!event) return;
  const documentId = document?.id ?? null;
  if (event.type === 'collaboration:document-replaced') clearDocumentFieldContext(documentId);
  if (event.type === 'review-mutation:started') {
    v2ReviewWindowController.beginMutation(event.reviewMutation);
    return;
  }
  if (event.type === 'review-mutation:aborted') {
    v2ReviewWindowController.settleMutation(event.reviewMutation?.token, {
      outcome: 'aborted',
      resumeDomains: ['comments', 'trackedChanges'],
      trackedRowCount: commentsStore.getV2TrackedChangeRowCount?.(documentId) ?? null,
    });
    return;
  }
  if (event.type === 'reviewTarget:changed') {
    syncSidebarActiveCommentFromV2ReviewTarget(event.next);
    return;
  }
  if (event.type === 'collaboration:remote-changed') {
    if (event.reviewChanged !== false) {
      v2ReviewWindowController.invalidate('collaboration:remote-review-changed');
      // Comment-only remote commits do not necessarily repaint the document.
      // Re-read the last committed target set at the sidecar's latest exact
      // coordinate; the controller still coalesces rapid remote updates.
      v2ReviewWindowController.refreshCommittedWindow('collaboration:remote-review-changed');
    }
    return;
  }
  if (event.type === 'source:complete') {
    proxy.$superdoc.broadcastSourceComplete();
    return;
  }
  if (event.type === 'source:signals-complete') {
    // SuperDoc Diagnostics: the first stage-'parse' diagnostics ever
    // emitted. Additive -- the existing bare broadcastSourceSignalsComplete()
    // call below is unchanged.
    const generation = getV2DiagnosticGeneration(event);
    for (const record of event.diagnostics ?? []) {
      const diagnostic = translateSsigParseDiagnostic(record, { documentId, editor: null });
      if (!diagnostic) continue;
      if (!v2DiagnosticDedupe.shouldEmit(documentId, generation, diagnostic.internalCode)) continue;
      proxy.$superdoc.emit('exception', diagnostic);
    }
    proxy.$superdoc.broadcastSourceSignalsComplete();
    return;
  }
  if (event.type === 'mutation:rejected') {
    if (event.reviewMutation?.token) {
      v2ReviewWindowController.settleMutation(event.reviewMutation.token, {
        outcome: 'rejected',
        resumeDomains: ['comments', 'trackedChanges'],
        trackedRowCount: commentsStore.getV2TrackedChangeRowCount?.(documentId) ?? null,
      });
    }
    if (isV2AuthorRequiredRejection(event)) {
      maybeNotifyV2AuthorRequired(documentId, event);
    } else {
      maybeNotifyV2EditRejected(documentId, event);
    }
    return;
  }
  if (event.type === 'mutation:committed') {
    const bulkDecisionEvent = toV2BulkDecisionEvent(documentId, event.trackedChangeBulkDecision);
    if (bulkDecisionEvent) {
      proxy.$superdoc.emit('tracked-changes:bulk-decision', bulkDecisionEvent);
    }
    emitV2EditorUpdate();
  }
  if (event.type !== 'mutation:committed') return;
  // Review-metadata-only commits do not produce a canonical page paint, so
  // explicitly refresh the last committed bounded window. Ordinary document
  // typing does paint again: the window controller compares the exact IDs and
  // keeps an identical in-flight/applied read instead of restarting it for
  // every fresh route id. Tracked-edit receipts reconcile their affected rows
  // below. A changed painted ID set naturally starts a new bounded read.
  // History can restore review metadata and a painted carrier in separate
  // scheduling turns. Re-read only the last committed target set at the
  // sidecar's latest exact coordinate so undo/redo cannot leave an active
  // highlight paired with a stale resolved sidebar row. This is one bounded
  // worker read per history action; typing continues to rely on committed
  // paints and does not take this path.
  if (event.origin === 'history') {
    v2ReviewWindowController.refreshCommittedWindow(`history-${event.direction}`);
  } else if (event.reviewSidecarOnly === true) {
    v2ReviewWindowController.refreshCommittedWindow('review-sidecar-committed');
  }
  const reviewImpact = getV2TrackedChangeMutationImpact(event);
  applyV2CommentInvalidationFromMutation({
    event,
    commentsStore,
    superdoc: proxy.$superdoc,
    documentId,
  });
  if (Array.isArray(reviewImpact?.remappedPairs) && reviewImpact.remappedPairs.length > 0) {
    // Keep the comments-list row continuous across review-group identity remaps
    // (common on the first keystroke after Enter in suggesting mode).
    commentsStore.remapTrackedChangeIdentities?.(reviewImpact.remappedPairs, { documentId });
  }
  if (reviewImpact) {
    // Typing/Enter in suggesting mode can repaint the remounted DOM before TC
    // annotation carriers are restamped. Render-epoch geometry publishes in
    // that window may legitimately be carrier-less; keep last-known TC geometry
    // there, while viewport scroll/resize recollects remain strict.
    armV2TrackedChangeRestampGeometryRetention('tracked-change-mutation');
  }
  const activeEditor = proxy.$superdoc?.activeEditor ?? null;
  const reconciliation = reviewImpact
    ? commentsStore.reconcileTrackedChangeMutationFromV2?.({
        superdoc: proxy.$superdoc,
        adapter: activeEditor?.v2TrackedChanges ?? null,
        documentId,
        ...reviewImpact,
      })
    : Promise.resolve({ ok: true });
  if (event.reviewMutation?.token) {
    const reviewMutation = event.reviewMutation;
    const allResolved = Boolean(reviewImpact?.allResolved ?? event.trackedChangeAllResolved);
    const settleReviewMutation = (result) => {
      const reconciledAllResolved = allResolved && result?.ok === true && result?.allResolved === true;
      v2ReviewWindowController.settleMutation(reviewMutation.token, {
        outcome: 'committed',
        allResolved: reconciledAllResolved,
        resumeDomains: reconciledAllResolved ? ['comments'] : ['comments', 'trackedChanges'],
        trackedRowCount: commentsStore.getV2TrackedChangeRowCount?.(documentId) ?? null,
      });
    };
    void Promise.resolve(reconciliation).then(settleReviewMutation, () => settleReviewMutation(null));
    return;
  }
  void Promise.resolve(reconciliation).catch(() => undefined);
};

const onV2LinkClick = (payload) => {
  linkPopover.handleLinkClick(payload);
};

const onV2CommentCreated = async (payload) => {
  try {
    await commentsStore.announceV2CommentCreated?.({
      superdoc: proxy.$superdoc,
      commentId: payload?.commentId,
    });
  } catch (err) {
    console.warn('[SuperDoc][v2] context-menu comment reconciliation failed', err);
  }
};

const recollectV2GeometryIfActive = (options = undefined) => {
  if (!isV2Mode.value) return;
  if (!v2GeometryPublisher.getLastPayload()) return;
  // Scroll / resize / zoom may change layer-relative coords without advancing
  // the v2 paint epoch. The publisher reuses the per-epoch alias cache so a
  // recollect does not call `comments.list()` again (plan §4).
  if (v2GeometryRafHandle && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(v2GeometryRafHandle);
  }
  if (typeof requestAnimationFrame !== 'function') {
    void v2GeometryPublisher.recollect(resolveV2GeometryPublishOptions(options));
    return;
  }
  v2GeometryRafHandle = requestAnimationFrame(() => {
    v2GeometryRafHandle = 0;
    void v2GeometryPublisher.recollect(resolveV2GeometryPublishOptions(options));
  });
};

// Coordinate the V2 review surface across `setDocumentMode` transitions as one
// coherent step. By the time `document-mode-change` fires, SuperDoc.ts has
// already updated the reactive viewing-visibility authority and applied the
// tracked-change render preferences to the host runtime. We then refresh the
// last committed review window and republish floating geometry after repaint.
// Review rows and geometry stay separate; neither can delay canonical paint.
const handleV2DocumentModeChange = () => {
  if (!isV2Mode.value) return;
  try {
    v2ReviewWindowController.refreshCommittedWindow('document-mode-change');
  } catch (err) {
    console.warn('[SuperDoc][v2] document-mode review-window refresh failed', err);
  }

  const republishGeometry = () => {
    if (!isV2Mode.value) return;
    if (shouldRenderCommentsInViewing.value) {
      // Force a fresh publish against the freshly painted carriers (anchors may
      // have moved when the inline tracked-change projection switched).
      if (v2GeometryRender.value) {
        scheduleV2GeometryPublish(v2GeometryRender.value);
      } else {
        recollectV2GeometryIfActive();
      }
    } else {
      // Both comments and tracked changes hidden in viewing mode: clear stale
      // floating geometry so cards do not hover over removed anchors.
      commentsStore.clearEditorCommentPositions?.();
      v2GeometryAvailable.value = false;
    }
  };

  // Wait for the host repaint that `setDocumentMode` triggered before reading
  // layer-relative bounds. nextTick flushes Vue's reactive update; a following
  // animation frame lets the v2 surface finish its repaint.
  void nextTick(() => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => republishGeometry());
    } else {
      republishGeometry();
    }
  });
};

const getV2EditorFailureMessage = (reason) => {
  switch (reason) {
    case 'editing-mount-required':
      return 'SuperDoc could not load the document editor because the page did not provide a mount container.';
    case 'source-load-failed':
      return 'SuperDoc could not load the document editor because the document source could not be prepared.';
    case 'unsupported-cdn-v2-editor':
      return 'SuperDoc could not load the document editor because this build does not include the V2 runtime.';
    case 'v2-integration-unavailable':
      return 'SuperDoc could not load the document editor because the bundled V2 runtime is unavailable in this environment.';
    case 'worker-init-failed':
      return 'SuperDoc could not load the document editor because the browser worker failed to start.';
    case 'input-too-large-for-inline-review':
      return 'SuperDoc could not load the document editor because this document is too large to open without the browser worker.';
    case 'collaboration-unsupported-huge-document':
      return 'SuperDoc could not load the document editor because large documents cannot be opened with collaboration enabled yet.';
    case 'collaboration-v1-config-unsupported':
      return 'SuperDoc v2 cannot use modules.collaboration because it is the SuperDoc v1 collaboration API. SuperDoc did not attach the provider or change the document. Configure Document.collaboration with a v2 room instead.';
    case 'collaboration-room-format-unsupported':
      return 'SuperDoc v2 cannot open this collaboration state because it is not stored in the SuperDoc v2 room format. No changes were made.';
    case 'collaboration-room-format-conflict':
      return 'SuperDoc v2 found conflicting room formats in one collaboration document. No changes were made.';
    case 'collaboration-room-corrupt':
      return 'SuperDoc v2 found a structurally invalid collaboration room. No changes were made.';
    case 'collaboration-v2-room-missing':
      return 'SuperDoc v2 could not find a committed v2 collaboration room. No changes were made. Use roomMode: "create" only when creating a new room.';
    case 'collaboration-v2-room-already-exists':
      return 'SuperDoc v2 was asked to create a collaboration room that already exists. Use roomMode: "join" to open it.';
    case 'collaboration-v2-room-initializing':
      return 'The SuperDoc v2 collaboration room is still initializing. Join mode did not modify it.';
    case 'collaboration-open-intent-invalid':
      return 'SuperDoc v2 received an invalid collaboration room mode. No provider was connected.';
    case 'collaboration-config-invalid':
      return 'SuperDoc v2 received an invalid collaboration configuration. No provider was connected.';
    default:
      return 'SuperDoc could not load the document editor.';
  }
};

const normalizeV2EditorFailureDetail = (detail) =>
  typeof detail === 'string' && detail.trim().length > 0 ? detail.trim() : null;

const onV2EditorFailed = (payload) => {
  clearActiveV2EditorFacade(payload?.documentId ?? null);
  const reason = typeof payload?.reason === 'string' && payload.reason.length > 0 ? payload.reason : 'open-failed';
  const detail = normalizeV2EditorFailureDetail(payload?.detail);
  const documentId =
    typeof payload?.documentId === 'string' && payload.documentId.length > 0 ? payload.documentId : null;
  const collaborationException = createCollaborationException(reason, documentId);
  const message = collaborationException?.error.message ?? getV2EditorFailureMessage(reason);
  // plan §Workstream 3: store a renderable terminal failure state for the
  // active document surface. The worker failure detail is content-safe (typed
  // phase/reason, no document bytes or sensitive paths).
  const workerFailure =
    payload?.workerFailure && typeof payload.workerFailure === 'object' ? payload.workerFailure : null;
  setV2EditorFailure(documentId, {
    reason,
    message,
    detail,
    ...(workerFailure ? { workerFailure } : {}),
  });
  const logContext = {
    ...(detail ? { detail } : {}),
    ...(documentId ? { documentId } : {}),
    ...(workerFailure ? { workerFailure } : {}),
    reason,
  };
  if (
    reason === 'collaboration-v1-config-unsupported' ||
    reason === 'collaboration-room-format-unsupported' ||
    reason === 'collaboration-room-format-conflict' ||
    reason === 'collaboration-room-corrupt' ||
    reason === 'collaboration-v2-room-missing' ||
    reason === 'collaboration-v2-room-already-exists' ||
    reason === 'collaboration-v2-room-initializing' ||
    reason === 'collaboration-open-intent-invalid' ||
    reason === 'collaboration-config-invalid'
  ) {
    console.warn(`[SuperDoc] ${message}`, logContext);
  } else {
    console.error(`[SuperDoc] ${message}`, logContext);
  }
  proxy.$superdoc.emit(
    'exception',
    collaborationException ?? {
      error: new Error(message),
      code: reason,
      ...(documentId ? { documentId } : {}),
      editor: null,
      ...(workerFailure ? { workerFailure } : {}),
    },
  );
  // SuperDoc Diagnostics MVP: additive, structured diagnostics alongside the legacy payload above.
  // A single boot failure can produce 1 legacy payload + 0..N diagnostic
  // payloads (one per in-scope SDDiagnosticRecord the host returned), never
  // a synthetic aggregate.
  const bootErrorName = typeof payload?.bootErrorName === 'string' ? payload.bootErrorName : undefined;
  const bootDiagnostic = translateBootFailureReason(reason, detail, { documentId, editor: null, bootErrorName });
  const openDiagnostics = Array.isArray(payload?.diagnostics) ? payload.diagnostics : [];
  const generation = getV2DiagnosticGeneration(payload);
  const translatedRecords = openDiagnostics
    .map((record) => ({ record, diagnostic: translateUnzipDiagnostic(record, { documentId, editor: null }) }))
    .filter((entry) => entry.diagnostic);
  // `bootDiagnostic.internalCode === reason` means it came from the generic
  // reason-string branch (e.g. `source-load-failed`), which is always a
  // proxy for a package-integrity failure that already has its own specific
  // `SDDiagnosticRecord` (confirmed by tracing `readiness.readiness ===
  // 'blocked'` — never anything else). Emitting both would produce two
  // PARSE_ERROR callbacks for one root cause, one strictly less specific
  // than the other. A `bootErrorName`-classified diagnostic is a distinct
  // render-pipeline signal, not redundant with package diagnostics, and is
  // always emitted regardless of `translatedRecords`.
  const bootDiagnosticIsRedundant = isBootDiagnosticRedundant(bootDiagnostic, reason, translatedRecords);
  if (bootDiagnostic && !bootDiagnosticIsRedundant) proxy.$superdoc.emit('exception', bootDiagnostic);
  for (const { diagnostic } of translatedRecords) {
    if (!v2DiagnosticDedupe.shouldEmit(documentId, generation, diagnostic.internalCode)) continue;
    proxy.$superdoc.emit('exception', diagnostic);
  }
};

// SuperDoc Diagnostics MVP: the v2 shell already emits `v2-render-readiness`
// on every render-readiness transition (debug-only console forwarding
// exists internally), but nothing here listened for it. Mid-session
// render/layout diagnostics reach `onException` through this handler.
const onV2RenderReadiness = (doc, payload) => {
  const documentId = doc?.id ?? null;
  const diagnostics = payload?.snapshot?.diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return;
  const generation = getV2DiagnosticGeneration(payload);
  for (const diag of diagnostics) {
    const diagnostic = translateRenderReadinessDiagnostic(diag, { documentId, editor: null });
    if (!diagnostic) continue;
    if (!v2DiagnosticDedupe.shouldEmit(documentId, generation, diagnostic.internalCode)) continue;
    proxy.$superdoc.emit('exception', diagnostic);
  }
};

// SuperDoc Diagnostics MVP: non-fatal open/replacement diagnostics
// (`v2-open-diagnostics`, emitted only on success — failed opens route
// through `onV2EditorFailed` instead so one incident never produces both).
const onV2OpenDiagnostics = (doc, payload) => {
  const documentId = doc?.id ?? (typeof payload?.documentId === 'string' ? payload.documentId : null);
  const diagnostics = payload?.diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return;
  const generation = getV2DiagnosticGeneration(payload);
  for (const record of diagnostics) {
    const diagnostic = translateUnzipDiagnostic(record, { documentId, editor: null });
    if (!diagnostic) continue;
    if (!v2DiagnosticDedupe.shouldEmit(documentId, generation, diagnostic.internalCode)) continue;
    proxy.$superdoc.emit('exception', diagnostic);
  }
};

// Shell-owned product DOM hit capture. Real focus/pointer hits inside a marked
// runtime root activate the owning runtime through the registry. This handler
// stays deliberately minimal: it resolves a runtime from the event target and
// does nothing editor-semantic — no painter DOM inspection, no coordinate
// mapping, no command dispatch, no selection semantics. Activation outside any
// marked root is a no-op (the registry returns no owner).
const activateRuntimeFromEvent = (event, reason) => {
  proxy.$superdoc?.activateRuntimeFromEventTarget?.(event.target, reason);
};
const handleRuntimeFocusIn = (event) => activateRuntimeFromEvent(event, 'focusin');
const handleRuntimePointerDown = (event) => activateRuntimeFromEvent(event, 'pointerdown');
// `mousedown` is a fallback for environments that do not dispatch pointer
// events consistently; it routes through the same idempotent activation path.
const handleRuntimeMouseDown = (event) => activateRuntimeFromEvent(event, 'mousedown');

const onEditorCollaborationReady = ({ editor }) => {
  proxy.$superdoc.emit('collaboration-ready', { editor });

  nextTick(() => {
    isReady.value = true;

    const urlParams = new URLSearchParams(window.location.search);
    const commentId = urlParams.get('commentId');
    if (commentId) scrollToComment(commentId);
  });
};

let suppressCommentActivationUntilTs = 0;

const markContextMenuOpen = () => {
  suppressCommentActivationUntilTs = Date.now() + RIGHT_CLICK_COMMENT_SUPPRESS_MS;
};

const shouldSuppressCommentActivation = () => Date.now() < suppressCommentActivationUntilTs;

const handleDocumentContextMenu = (event) => {
  const root = superdocRoot.value;
  if (!root) return;
  if (!(event.target instanceof Node) || !root.contains(event.target)) return;
  if (layers.value?.contains(event.target)) {
    if (!isActiveTrackedChangeContextMenuTarget(event.target)) {
      commentsStore.setActiveComment(proxy.$superdoc, null);
    }
    commentsStore.removePendingComment(proxy.$superdoc);
    resetClickAnchor();
  }
  markContextMenuOpen();
};

const editorOptions = (doc) => {
  // We only want to run the font check if the user has provided a callback
  // The font check might request extra permissions, and we don't want to run it unless the developer has requested it
  // So, if the callback is not defined, we won't run the font check
  const onFontsResolvedFn =
    proxy.$superdoc.listeners?.('fonts-resolved')?.length > 0 ? proxy.$superdoc.listeners('fonts-resolved')[0] : null;
  const useLayoutEngine = proxy.$superdoc.config.useLayoutEngine !== false;

  const isNewFile = doc.isNewFile;
  // INTERNAL / TEST-ONLY (WS6): `benchmarkExecutionMode` is NOT part of the
  // typed public `Config` — it only reaches here because `SuperDoc#init`
  // spreads the raw config object. It exists solely for bench/dev/behavior
  // harnesses to pin the v2 execution realm. Customer browser execution is
  // worker-only (the named collab-inline exception is decided inside the v2
  // shell); do not type, document, or advertise this key publicly.
  const benchmarkExecutionMode = proxy.$superdoc.config?.benchmarkExecutionMode;
  const benchmarkTraceEnabled = proxy.$superdoc.config?.benchmarkTraceEnabled === true;
  const collaborationResolution = resolveDocumentV2Collaboration(doc);
  const v2Collaboration = collaborationResolution.state === 'valid' ? collaborationResolution.config : null;
  const collaborationPreflightFailure =
    proxy.$superdoc.config.v2CollaborationPreflightFailure ??
    (collaborationResolution.state === 'invalid' ? collaborationResolution.failure : null);
  const options = {
    isDebug: proxy.$superdoc.config.isDebug || false,
    documentId: doc.id,
    user: proxy.$superdoc.user,
    users: proxy.$superdoc.users,
    colors: proxy.$superdoc.colors,
    role: proxy.$superdoc.config.role,
    interaction: proxy.$superdoc.interactionConfig,
    html: doc.html,
    markdown: doc.markdown,
    documentMode: proxy.$superdoc.config.documentMode,
    ...(benchmarkExecutionMode ? { benchmarkExecutionMode } : {}),
    ...(benchmarkTraceEnabled ? { benchmarkTraceEnabled: true } : {}),
    allowSelectionInViewMode: proxy.$superdoc.config.allowSelectionInViewMode,
    rulers: doc.rulers,
    rulerContainer: resolvedRulerContainer.value,
    isInternal: proxy.$superdoc.config.isInternal,
    annotations: proxy.$superdoc.config.annotations,
    isCommentsEnabled: Boolean(commentsModuleConfig.value),
    isAiEnabled: proxy.$superdoc.config.modules?.ai,
    contextMenuConfig: (() => {
      if (proxy.$superdoc.config.modules?.slashMenu && !proxy.$superdoc.config.modules?.contextMenu) {
        console.warn('[SuperDoc] modules.slashMenu is deprecated. Use modules.contextMenu instead.');
      }
      // The profile already folded `ui.contextMenu` over both legacy spellings,
      // so reading `modules.*` here is what dropped `ui.contextMenu.sections`
      // on the floor. Boolean legacy forms carry no items and resolve to `{}`,
      // which the menu treats the same as the absent config it saw before.
      return proxy.$superdoc.uiConfig.contextMenu.options;
    })(),
    /** @deprecated Use contextMenuConfig instead */
    slashMenuConfig: proxy.$superdoc.config.modules?.contextMenu ?? proxy.$superdoc.config.modules?.slashMenu,
    comments: {
      highlightColors: commentsModuleConfig.value?.highlightColors,
      highlightOpacity: commentsModuleConfig.value?.highlightOpacity,
    },
    trackedChanges: proxy.$superdoc.config.modules?.trackChanges,
    experimental: proxy.$superdoc.config.experimental,
    ...(v2Collaboration ? { v2Collaboration } : {}),
    ...(collaborationPreflightFailure ? { collaborationPreflightFailure } : {}),
    onCollaborationReady: onEditorCollaborationReady,
    onCommentsUpdate: onEditorCommentsUpdate,
    onFontsResolved: onFontsResolvedFn,
    // Painter plan P7 §1: page-count seam (layout-end; v2 vertical only).
    onPageCountKnown: proxy.$superdoc.config.onPageCountKnown ?? null,
    onReviewWindowCommitted: (payload) => {
      v2ReviewWindowController.onCommittedPagePaint?.({ ...payload, documentId: doc.id });
    },
    // `fonts-changed` is relayed through SuperDoc.ts from the active v2 font facet.
    // Passing the config callback directly here would double-deliver every v2 report.
    fontAssets: proxy.$superdoc.config.fonts,
    workerUrls: proxy.$superdoc.config.workerUrls,
    fieldContext: doc.fieldContext,
    fieldUpdatePolicy: proxy.$superdoc.config.fieldUpdatePolicy,
    workerStartupTimeoutMs: proxy.$superdoc.config.workerStartupTimeoutMs,
    proofing: resolvedProofingConfig.value,
    isNewFile,
    password: getDocumentLoadPassword(doc),
    handleImageUpload: proxy.$superdoc.config.handleImageUpload,
    externalExtensions: proxy.$superdoc.config.editorExtensions || [],
    // v2 extension runtime input. Forwarded to the v2 browser shell, which
    // passes the array into createV2EditorHost. Legacy v1 `editorExtensions`
    // (above) are not v2 extensions and are ignored by the v2 runtime.
    extensions: proxy.$superdoc.config.extensions || [],
    // PDF.js stays an optional public-shell dependency. When configured, V2
    // lends the module lazily to the narrow PDF-in-EMF rendition strategy;
    // the private document engine never imports or bundles PDF.js itself.
    ...(pdfConfig?.pdfLib ? { pdfLib: pdfConfig.pdfLib } : {}),
    suppressDefaultDocxStyles: proxy.$superdoc.config.suppressDefaultDocxStyles,
    // The profile can forbid the surface, but it is not the live state:
    // `setDisableContextMenu()` writes `config.disableContextMenu` after
    // mount, and `editorOptions` is re-evaluated per document, so reading only
    // the profile would revert the toggle on every remount.
    disableContextMenu:
      !proxy.$superdoc.uiConfig.contextMenu.enabled || proxy.$superdoc.config.disableContextMenu === true,
    jsonOverride: proxy.$superdoc.config.jsonOverride,
    viewOptions: proxy.$superdoc.config.viewOptions,
    contained: proxy.$superdoc.config.contained,
    styleNonce: proxy.$superdoc.config.cspNonce,
    // Presentation only: the shell resolves this to `enabled` and the host
    // keeps owning when the loader would be visible. `false` is what the shell
    // reads as "draw nothing", so pass the flag straight through rather than
    // omitting it, which resolves back to on.
    documentLoading: proxy.$superdoc.uiConfig.loading.enabled,
    // The editor host receives the same resolved activation handler as the shell.
    linkPopoverResolver: getHyperlinkActivationHandler(),
    layoutEngineOptions: useLayoutEngine
      ? {
          ...(proxy.$superdoc.config.layoutEngineOptions || {}),
          proofing: resolvedProofingConfig.value,
          debugLabel: proxy.$superdoc.config.layoutEngineOptions?.debugLabel ?? doc.name ?? doc.id,
          zoom: (activeZoom.value ?? 100) / 100,
          emitCommentPositionsInViewing: isViewingMode() && shouldRenderCommentsInViewing.value,
          enableCommentsInViewing: isViewingCommentsVisible.value,
          // Already resolved across both spellings by `normalizeUiConfig`. Do
          // not reach back into `config.modules.contentControls.chrome` here:
          // that legacy field carries `'none'` as a disable sentinel, and
          // re-reading it would let it outrank an explicit `ui.contentControls`.
          contentControlsChrome: proxy.$superdoc.uiConfig.contentControls.options.chrome,
          resolveTrackedChangeColor: composeAuthorColorResolver(
            proxy.$superdoc.config.modules?.trackChanges?.authorColors,
          ),
        }
      : undefined,
    permissionResolver: (payload = {}) =>
      proxy.$superdoc.canPerformPermission({
        role: proxy.$superdoc.config.role,
        isInternal: proxy.$superdoc.config.isInternal,
        ...payload,
      }),
  };

  return options;
};

// Replay updates should only patch mutable comment state.
// Identity and construction-time metadata are intentionally excluded.
const REPLAY_MUTABLE_COMMENT_FIELDS = new Set([
  'commentText',
  'isInternal',
  'parentCommentId',
  'trackedChangeParentId',
  'trackedChangeThreadParentId',
  'threadingParentCommentId',
  'trackedChange',
  'trackedChangeType',
  'trackedChangeText',
  'trackedChangeDisplayType',
  'semanticColorKey',
  'semanticColor',
  'trackedChangeStory',
  'trackedChangeStoryKind',
  'trackedChangeStoryLabel',
  'trackedChangeAnchorKey',
  'trackedChangeLabel',
  'trackedChangeDetailLines',
  'deletedText',
  'resolvedTime',
  'resolvedById',
  'resolvedByEmail',
  'resolvedByName',
  'importedAuthor',
  'docxCommentJSON',
]);

const applyReplayIsDoneResolutionFallback = (target, payload = {}) => {
  if (!target || payload.isDone === undefined) return;
  if (
    payload.resolvedTime != null ||
    payload.resolvedById != null ||
    payload.resolvedByEmail != null ||
    payload.resolvedByName != null
  ) {
    return;
  }

  // Imported replay payloads often use `isDone` while resolved fields remain null.
  // When resolved fields are not explicitly populated, derive sidebar/export state from `isDone`.
  if (payload.isDone) {
    target.resolvedTime = target.resolvedTime || Date.now();
    target.resolvedById = target.resolvedById || payload.creatorId || null;
    target.resolvedByEmail = target.resolvedByEmail || payload.creatorEmail || null;
    target.resolvedByName = target.resolvedByName || payload.creatorName || null;
    return;
  }

  target.resolvedTime = null;
  target.resolvedById = null;
  target.resolvedByEmail = null;
  target.resolvedByName = null;
};

const applyReplayUpdateToComment = (commentModel, payload, resolvedText) => {
  if (!commentModel || !payload) return;

  if (Array.isArray(payload.elements)) {
    commentModel.docxCommentJSON = payload.elements;
  }

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === 'text') return;
    if (key === 'elements') return;
    if (!REPLAY_MUTABLE_COMMENT_FIELDS.has(key)) return;
    commentModel[key] = value;
  });

  if (resolvedText !== undefined) {
    commentModel.commentText = resolvedText;
  }

  applyReplayIsDoneResolutionFallback(commentModel, payload);
};

const normalizeReplayCommentModelPayload = (payload = {}) => {
  const normalizedPayload = { ...payload };
  if (!normalizedPayload.commentText && normalizedPayload.text) {
    normalizedPayload.commentText = normalizedPayload.text;
  }
  if (!normalizedPayload.docxCommentJSON && Array.isArray(normalizedPayload.elements)) {
    normalizedPayload.docxCommentJSON = normalizedPayload.elements;
  }
  applyReplayIsDoneResolutionFallback(normalizedPayload, normalizedPayload);
  return normalizedPayload;
};

const syncInstantSidebarAlignmentFromEditorSelection = (commentId) => {
  if (Number.isFinite(peekInstantSidebarAlignment())) {
    return;
  }

  if (commentId == null) {
    clearInstantSidebarAlignment();
    return;
  }

  const layersElement = layers.value;
  const { key, entry } = resolveCommentPositionEntry(commentId);
  const targetClientY = getVisibleThreadAnchorClientY(layersElement, entry);

  if (Number.isFinite(targetClientY)) {
    requestInstantSidebarAlignment(targetClientY, commentId, key ?? commentId);
    return;
  }

  clearInstantSidebarAlignment();
};

const isSameActiveCommentSelection = (commentId) => {
  if (commentId == null || activeComment.value == null) {
    return false;
  }

  return String(activeComment.value) === String(commentId);
};

const syncSidebarActiveCommentFromV2ReviewTarget = (target) => {
  if (target?.origin !== 'document') return;
  if (shouldSuppressCommentActivation()) return;

  const commentId = resolveV2ReviewTargetCommentId(target, getComment);
  if (!commentId) return;

  syncInstantSidebarAlignmentFromEditorSelection(commentId);
  activeComment.value = commentId;
  isCommentHighlighted.value = true;
  setTimeout(() => {
    isCommentHighlighted.value = false;
  }, 0);
};

const onEditorCommentsUpdate = (params = {}) => {
  // Set the active comment in the store
  let { activeCommentId, type, comment: commentPayload } = params;
  // Only sync active state when the event explicitly requests it.
  // Replay add/update events often omit activeCommentId; inferring it here can
  // cause repeated focus toggles while replay emits batched updates.
  let shouldSyncActiveComment = Object.prototype.hasOwnProperty.call(params, 'activeCommentId');
  const resolveCommentEventIds = (payload) => {
    const ids = [payload?.importedId, payload?.commentId].filter(Boolean).map((value) => String(value));
    return [...new Set(ids)];
  };
  const resolveDocumentScopedCommentMatch = (payload) => {
    const candidateIds = [payload?.importedId, payload?.commentId].filter(Boolean).map((value) => String(value));
    const activeDocumentId =
      proxy.$superdoc?.activeEditor?.options?.documentId != null
        ? String(proxy.$superdoc.activeEditor.options.documentId)
        : null;

    for (const candidateId of candidateIds) {
      const existingComment = commentsList.value.find((comment) => {
        const commentId = comment?.commentId != null ? String(comment.commentId) : null;
        const importedId = comment?.importedId != null ? String(comment.importedId) : null;
        const isIdMatch = commentId === candidateId || importedId === candidateId;
        if (!isIdMatch) return false;
        if (!activeDocumentId || typeof belongsToDocument !== 'function') return true;
        return belongsToDocument(comment, activeDocumentId);
      });

      if (existingComment) {
        const matchedCommentId = existingComment?.commentId ?? existingComment?.importedId ?? candidateId;
        return {
          id: matchedCommentId != null ? String(matchedCommentId) : null,
          existingComment,
        };
      }
    }
    return {
      id: candidateIds[0] || null,
      existingComment: null,
    };
  };

  if (type === 'replayCompleted') {
    scheduleReplayTrackedChangeSync();
  }

  if (COMMENT_EVENTS?.ADD && type === COMMENT_EVENTS.ADD && commentPayload) {
    commentPayload = normalizeReplayCommentModelPayload(commentPayload);

    const currentUser = proxy.$superdoc?.user;
    if (currentUser) {
      if (!commentPayload.creatorId) commentPayload.creatorId = currentUser.id;
      if (!commentPayload.creatorName) commentPayload.creatorName = currentUser.name;
      if (!commentPayload.creatorEmail) commentPayload.creatorEmail = currentUser.email;
    }

    if (!commentPayload.createdTime) commentPayload.createdTime = Date.now();

    const primaryDocumentId = commentPayload.documentId || documents.value?.[0]?.id;
    if (!commentPayload.documentId && primaryDocumentId) {
      commentPayload.documentId = primaryDocumentId;
    }

    if (!commentPayload.fileId && primaryDocumentId) {
      commentPayload.fileId = primaryDocumentId;
    }

    const { id, existingComment } = resolveDocumentScopedCommentMatch(commentPayload);
    if (id && !existingComment) {
      const commentModel = useComment(commentPayload);
      addHydratedComment({
        superdoc: proxy.$superdoc,
        comment: commentModel,
        skipEditorUpdate: true,
      });
    }
  }

  if (COMMENT_EVENTS?.UPDATE && type === COMMENT_EVENTS.UPDATE && commentPayload) {
    const { id, existingComment } = resolveDocumentScopedCommentMatch(commentPayload);
    if (id) {
      const resolvedText = commentPayload.commentText || commentPayload.text;

      if (existingComment) {
        applyReplayUpdateToComment(existingComment, commentPayload, resolvedText);
      } else {
        const normalizedPayload = normalizeReplayCommentModelPayload(commentPayload);
        const commentModel = useComment(normalizedPayload);
        addHydratedComment({
          superdoc: proxy.$superdoc,
          comment: commentModel,
          skipEditorUpdate: true,
        });
      }
    }
  }

  if (COMMENT_EVENTS?.DELETED && type === COMMENT_EVENTS.DELETED && commentPayload) {
    const targetIds = resolveCommentEventIds(commentPayload);
    if (targetIds.length) {
      const activeDocumentId =
        proxy.$superdoc?.activeEditor?.options?.documentId != null
          ? String(proxy.$superdoc.activeEditor.options.documentId)
          : null;
      const isInActiveDocument = (comment) => {
        if (!activeDocumentId || typeof belongsToDocument !== 'function') return true;
        return belongsToDocument(comment, activeDocumentId);
      };

      // Remove the entire thread subtree (parent + all descendants), not only direct replies.
      const removedCommentIds = collectRemovedCommentIds(commentsList.value, targetIds, isInActiveDocument);

      if (removedCommentIds.size) {
        const previousComments = [...commentsList.value];
        commentsList.value = commentsList.value.filter((comment) => {
          if (!isInActiveDocument(comment)) return true;
          const commentId = comment.commentId != null ? String(comment.commentId) : null;
          const importedId = comment.importedId != null ? String(comment.importedId) : null;
          return !(
            (commentId && removedCommentIds.has(commentId)) ||
            (importedId && removedCommentIds.has(importedId))
          );
        });

        const activeCommentKey = activeComment.value != null ? String(activeComment.value) : null;
        const activeCommentModel =
          activeCommentKey != null
            ? previousComments.find((comment) => {
                const commentId = comment.commentId != null ? String(comment.commentId) : null;
                const importedId = comment.importedId != null ? String(comment.importedId) : null;
                return commentId === activeCommentKey || importedId === activeCommentKey;
              })
            : null;
        const activeCommentInActiveDocument = activeCommentModel ? isInActiveDocument(activeCommentModel) : false;
        if (activeCommentKey && removedCommentIds.has(activeCommentKey) && activeCommentInActiveDocument) {
          activeCommentId = null;
          shouldSyncActiveComment = true;
        }
      }
    }
  }

  if (type === 'trackedChange') {
    handleTrackedChangeUpdate({ superdoc: proxy.$superdoc, params });
  }

  if (shouldSyncActiveComment && activeCommentId != null && shouldSuppressCommentActivation()) {
    shouldSyncActiveComment = false;
  }

  if (shouldSyncActiveComment && (activeCommentId == null || !isSameActiveCommentSelection(activeCommentId))) {
    syncInstantSidebarAlignmentFromEditorSelection(activeCommentId);
  }

  nextTick(() => {
    if (pendingComment.value) return;
    if (shouldSyncActiveComment) {
      commentsStore.setActiveComment(proxy.$superdoc, activeCommentId);
    }
    // Briefly suppress click-outside so the same click that selected the comment
    // highlight in the editor doesn't immediately deactivate it via the sidebar.
    // Reset after the event loop settles so subsequent outside clicks work normally.
    if (shouldSyncActiveComment) {
      isCommentHighlighted.value = true;
      setTimeout(() => {
        isCommentHighlighted.value = false;
      }, 0);
    }
  });

  // Bubble up the event to the user, if handled
  if (typeof proxy.$superdoc.config.onCommentsUpdate === 'function') {
    proxy.$superdoc.config.onCommentsUpdate(params);
  }
};

const isCommentsEnabled = computed(() => Boolean(commentsModuleConfig.value));

// PDF surface predicates (SD-3497). These are keyed off the document type, NOT
// off `isV2Mode`. `isV2Mode` means the DOCX host is v2; it must not be read as
// "remove every non-DOCX overlay". PDF documents are rendered by PdfViewer (not
// V2DocumentEditor) and own their overlay adapters (PdfCommentsLayer +
// WhiteboardLayer).
const pdfDocuments = computed(() =>
  Array.isArray(documents.value) ? documents.value.filter((doc) => doc?.type === PDF) : [],
);
const hasPdfDocument = computed(() => pdfDocuments.value.length > 0);
const shouldRenderPdfCommentAnchors = computed(() => hasPdfDocument.value && isCommentsEnabled.value);
const openPdfDocumentIds = computed(() => new Set(pdfDocuments.value.map((doc) => String(doc.id))));
const isFinitePdfBound = (value) => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
  return false;
};
const hasFinitePdfSelectionBounds = (comment) => {
  const bounds = comment?.selection?.selectionBounds;
  return (
    !!bounds &&
    isFinitePdfBound(bounds.top) &&
    isFinitePdfBound(bounds.left) &&
    isFinitePdfBound(bounds.right) &&
    isFinitePdfBound(bounds.bottom)
  );
};
const getPdfCommentDocumentId = (comment) => {
  const id = comment?.fileId ?? comment?.documentId ?? comment?.selection?.documentId;
  return id != null ? String(id) : null;
};
const belongsToOpenPdfDocument = (comment) => {
  const ids = openPdfDocumentIds.value;
  if (!ids.size) return false;
  const documentId = getPdfCommentDocumentId(comment);
  if (documentId) return ids.has(documentId);
  return ids.size === 1;
};
const isPositionablePdfComment = (comment) =>
  comment?.selection?.source === 'pdf' && hasFinitePdfSelectionBounds(comment) && belongsToOpenPdfDocument(comment);
// Any submitted or pending PDF comment that can position from selection bounds.
const hasPdfFloatingComments = computed(() => {
  if (!hasPdfDocument.value) return false;
  const fromSubmitted = floatingComments.value.some((comment) => isPositionablePdfComment(comment));
  const fromPending = isPositionablePdfComment(pendingComment.value);
  return fromSubmitted || fromPending;
});

const shouldUseSidebarComments = computed(() => {
  const layout = commentsModuleConfig.value?.layout ?? DEFAULT_COMMENTS_LAYOUT;
  if (!VALID_COMMENTS_LAYOUTS.has(layout)) return true;
  if (layout === 'sidebar') return true;
  if (layout === 'inline') return false;
  // Backward-compatible default: keep sidebar unless integrator explicitly opts into auto.
  if (layout !== 'auto') return true;
  return !isCompactCommentsMode.value;
});
const showCommentsSidebar = computed(() => {
  // ui-phase3-001: v2 mode is no longer a hard gate. The sidebar may render
  // once `V2DocumentEditor` has published at least one render-epoch-checked
  // geometry snapshot into `editorCommentPositions`. The v1 path is
  // unchanged.
  //
  // DOCX v2 on-document overlays remain blocked until they have v2 adapters; the
  // v2 geometry gate below keeps the sidebar from appearing before painted
  // carriers exist. SD-3497: PDF is rendered by PdfViewer (not V2DocumentEditor)
  // and positions its sidebar/floating comments from PDF selection bounds, so it
  // must NOT be blocked by DOCX v2 geometry availability. Only apply the v2
  // geometry gate when there are no PDF comment rows that can self-position.
  if (isV2Mode.value && !v2GeometryAvailable.value && !v2ReviewSidebarUnlocked.value && !hasPdfFloatingComments.value) {
    return false;
  }
  if (!shouldRenderCommentsInViewing.value) return false;
  if (!shouldUseSidebarComments.value) return false;
  return (
    pendingComment.value ||
    ((floatingComments.value.length > 0 || hasOpenTrackedChanges.value) &&
      isReady.value &&
      layers.value &&
      isCommentsEnabled.value &&
      !isCommentsListVisible.value)
  );
});
const activeCompactComment = computed(() => {
  if (showCommentsSidebar.value) return null;
  if (!isCommentsEnabled.value) return null;
  if (pendingComment.value) return pendingComment.value;
  if (!activeComment.value) return null;
  const comment = getComment(activeComment.value) ?? null;
  if (isV2Mode.value && shouldUseSidebarComments.value && comment?.trackedChange && !hasPdfFloatingComments.value) {
    return null;
  }
  return comment;
});
const { compactCommentPopoverStyle, closeCompactCommentPopover, resetClickAnchor } = useCompactCommentPopover({
  activeComment,
  pendingComment,
  activeCompactComment,
  showCommentsSidebar,
  superdocRoot,
  layers,
  documents,
  resolveCommentPositionEntry,
  selectionPosition,
  activeZoom,
  clearActiveComment: () => commentsStore.setActiveComment(proxy.$superdoc, null),
  clearPendingComment: () => commentsStore.removePendingComment(proxy.$superdoc),
});
const showToolsFloatingMenu = computed(() => {
  if (!isCommentsEnabled.value) return false;
  return selectionPosition.value && toolsMenuPosition.top && !getConfig.value?.readOnly;
});
const showActiveSelection = computed(() => {
  if (!isCommentsEnabled.value) return false;
  return !getConfig.value?.readOnly && selectionPosition.value;
});
watch(showCommentsSidebar, (value) => {
  proxy.$superdoc.broadcastSidebarToggle(value);
});

// Viewport fit tracking: maintains viewport metrics, emits `viewport-change`,
// and applies the fit-width zoom policy. See composables/use-viewport-fit.js.
useViewportFit({
  getSuperdoc: () => proxy.$superdoc,
  superdocContainerWidth,
  isReady,
  activeZoom,
  zoomMode,
  viewportMetrics,
  showCommentsSidebar,
  rightSidebarRef,
  superdocRoot,
  documents,
});
/**
 * Scroll the page to a given commentId
 *
 * @param {String} commentId The commentId to scroll to
 */
const scrollToComment = (commentId) => {
  proxy.$superdoc.scrollToComment(commentId);
};

// ui-phase3-001: viewport listeners for v2 geometry refresh. The immediate
// scroll recollection keeps cards anchor-coupled in contained layouts where
// the document scrolls independently of the sidebar. When scrolling also
// replaces the virtualized page window, the geometry publisher follows with
// one bounded recollection at the painter's canonical post-commit stamp.
const handleViewportScrollOrResize = () => {
  recollectV2GeometryIfActive();
};

const handleV2TrackedChangeCarriersRestamped = (event) => {
  if (!isV2Mode.value) return;
  const itemIds = Array.isArray(event?.detail?.itemIds)
    ? event.detail.itemIds.map((id) => (id == null ? '' : String(id))).filter(Boolean)
    : [];
  armV2TrackedChangeRestampGeometryRetention(event?.detail?.refreshReason ?? 'tracked-change-restamp');
  recollectV2GeometryIfActive({
    retainMissingTrackedChangeGeometry: true,
    ...(itemIds.length > 0 ? { retainedTrackedChangeIds: itemIds } : {}),
    reason: 'tracked-change-restamp',
  });
};

onMounted(() => {
  document.addEventListener('contextmenu', handleDocumentContextMenu, true);
  document.addEventListener('keydown', handleDocumentShortcut, true);
  proxy.$superdoc?.on?.('search:open', handleOpenFindRequest);
  // Ambient find-shortcut ownership: the most recently mounted instance owns
  // it initially; any interaction inside this instance re-claims it.
  claimFindShortcut(findShortcutOwner);
  superdocRoot.value?.addEventListener('pointerdown', handleFindOwnershipInteraction, true);
  superdocRoot.value?.addEventListener('focusin', handleFindOwnershipInteraction, true);
  superdocRoot.value?.addEventListener(TRACKED_CHANGE_CARRIERS_RESTAMPED_EVENT, handleV2TrackedChangeCarriersRestamped);
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', handleViewportScrollOrResize, true);
    window.addEventListener('resize', handleViewportScrollOrResize, true);
  }

  // Capture-phase product hit routing: activate the owning runtime from real
  // focus/pointer hits. Capture so a marked root nested under shells that stop
  // propagation still resolves; the handler is idempotent and a no-op outside
  // any marked runtime root.
  document.addEventListener('focusin', handleRuntimeFocusIn, true);
  document.addEventListener('pointerdown', handleRuntimePointerDown, true);
  document.addEventListener('mousedown', handleRuntimeMouseDown, true);
  document.addEventListener('pointerup', handleDocumentSelectionChange, true);
  document.addEventListener('mouseup', handleDocumentSelectionChange, true);
  document.addEventListener('selectionchange', handleDocumentSelectionChange);

  // Refresh the committed review window and republish geometry as one transition on every
  // document-mode change (viewing/editing/suggesting). See handler comment.
  proxy.$superdoc?.on?.('document-mode-change', handleV2DocumentModeChange);
  proxy.$superdoc?.on?.('active-editor-change', syncV2RulerActiveEditor);

  recalculateCompactCommentsMode();
  ensureCompactMeasurementObserver();
});

// ui-phase3-001: when comments / track-changes are hidden in viewing mode
// (or the layers / v2 mount disappears), clear the published v2 geometry so
// the sidebar does not float over stale bounds. The recompute path picks up
// again on the next render epoch after the user re-enables them.
watch(shouldRenderCommentsInViewing, (value) => {
  if (!isV2Mode.value) return;
  if (value) {
    if (v2GeometryRender.value) {
      scheduleV2GeometryPublish(v2GeometryRender.value);
    }
  } else {
    commentsStore.clearEditorCommentPositions?.();
    v2GeometryAvailable.value = false;
  }
});

// ui-phase3-001: contained-mode and layout-shell repositioning use the
// `.superdoc--contained` / `--web-layout` class toggles which can shift the
// layers element. Re-collect geometry whenever the layers ref reattaches.
watch(layers, () => {
  recollectV2GeometryIfActive();
});

function isFindShortcutEvent(e) {
  return (e.metaKey || e.ctrlKey) && !e.altKey && e.key?.toLowerCase?.() === 'f';
}

function isFormattingMarksShortcutEvent(e) {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.code === 'Digit8' || e.key === '8' || e.key === '*');
}

function isFocusInsideSuperDoc() {
  const root = superdocRoot.value;
  const activeElement = document.activeElement;
  if (!(activeElement instanceof Node)) return false;

  if (root?.contains(activeElement)) {
    return true;
  }

  const activeEditorDom = proxy.$superdoc?.activeEditor?.view?.dom;
  return (
    activeEditorDom instanceof Node && (activeElement === activeEditorDom || activeEditorDom.contains?.(activeElement))
  );
}

/**
 * Find (Cmd/Ctrl+F) should open the SuperDoc find bar whenever the editor is
 * the page's active surface, matching Word/Docs. That means focus inside
 * SuperDoc OR no specific element focused (fresh load, or a click on the page
 * chrome), but NOT when the user is typing in some other input/editable outside
 * SuperDoc — there the browser's native find must win. With several SuperDoc
 * instances mounted, the ambient (no-focus) case is gated through the shared
 * find-shortcut owner registry so only the last-interacted instance opens.
 */
const findShortcutOwner = {};

function handleFindShortcut(e) {
  if (!isFindShortcutEvent(e)) return;
  if (!isFindReplaceEnabled.value) return;
  if (!shouldHandleFindShortcut(e, { focusInside: isFocusInsideSuperDoc(), owner: findShortcutOwner })) return;

  // Only steal the shortcut if the composable will actually open a surface.
  // `wouldOpen()` is the single guard for both V1 (command-backed) and V2
  // (`host.search`-backed) drivers: for V2 it returns false unless the host
  // exposes a usable search facade, so Cmd+F still falls through to the
  // browser on worker/pre-ready hosts or when a resolver returns `none`.
  if (!findReplace.wouldOpen()) return;

  e.preventDefault();
  e.stopPropagation();
  claimFindShortcut(findShortcutOwner);
  findReplace.open();
}

// The instance the user last touched owns the ambient (no-focus) shortcut.
function handleFindOwnershipInteraction() {
  claimFindShortcut(findShortcutOwner);
}

// The toolbar search button (shell-owned) requests the find bar via a
// `search:open` event on the SuperDoc instance so both the built-in and any
// external toolbar open the same surface as Cmd/Ctrl+F.
function handleOpenFindRequest() {
  if (!isFindReplaceEnabled.value) return;
  findReplace.open();
}

function handleFormattingMarksShortcut(e) {
  if (!isFormattingMarksShortcutEvent(e)) return;
  // ui-phase2-001: formatting-marks toggling is a v1 layout-engine
  // preference. The v2 host does not expose a formatting-marks layout
  // toggle in this phase; leave the shortcut to the browser.
  if (isV2Mode.value) return;
  if (!isFocusInsideSuperDoc()) return;

  e.preventDefault();
  e.stopPropagation();
  proxy.$superdoc.toggleFormattingMarks?.();
}

/**
 * Handle document-level shortcuts before browser or shell handlers.
 * Use a capture listener because the dev shell and presentation-mode bridge
 * do not always leave keyboard focus on a node that bubbles through the root.
 */
function handleDocumentShortcut(e) {
  if (e.key === 'Escape' && activeCompactComment.value) {
    e.preventDefault();
    e.stopPropagation();
    closeCompactCommentPopover();
    return;
  }
  handleFindShortcut(e);
  if (e.defaultPrevented) return;
  handleFormattingMarksShortcut(e);
}

function handleContainerKeydown(e) {
  handleFindShortcut(e);
  if (e.defaultPrevented) return;
  handleFormattingMarksShortcut(e);
}

onBeforeUnmount(() => {
  commentsStore.cancelImportedTrackedChangeBootstrap?.();
  passwordPrompt.destroy();
  findReplace.destroy();
  linkPopover.destroy();
  cancelScheduledV2DomSelectionSync();
  cancelScheduledV2SelectionToolbarSync();
  cleanupV2RulerObservers();
  cleanupV2RulerContextSubscription();
  for (const documentId of Array.from(v2Runtimes.keys())) {
    clearV2RuntimeRegistration(documentId);
  }
  for (const documentId of Array.from(v2CommandShortcutBindings.keys())) {
    clearV2CommandShortcutBinding(documentId);
  }
  for (const documentId of Array.from(v2SessionShortcutBindings.keys())) {
    clearV2SessionShortcutBinding(documentId);
  }
  v2Runtimes.clear();
  subDocumentRoots.clear();
  document.removeEventListener('contextmenu', handleDocumentContextMenu, true);
  document.removeEventListener('keydown', handleDocumentShortcut, true);
  proxy.$superdoc?.off?.('search:open', handleOpenFindRequest);
  superdocRoot.value?.removeEventListener('pointerdown', handleFindOwnershipInteraction, true);
  superdocRoot.value?.removeEventListener('focusin', handleFindOwnershipInteraction, true);
  superdocRoot.value?.removeEventListener(
    TRACKED_CHANGE_CARRIERS_RESTAMPED_EVENT,
    handleV2TrackedChangeCarriersRestamped,
  );
  releaseFindShortcut(findShortcutOwner);
  if (typeof window !== 'undefined') {
    window.removeEventListener('scroll', handleViewportScrollOrResize, true);
    window.removeEventListener('resize', handleViewportScrollOrResize, true);
  }
  if (v2GeometryRafHandle && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(v2GeometryRafHandle);
    v2GeometryRafHandle = 0;
  }
  document.removeEventListener('focusin', handleRuntimeFocusIn, true);
  document.removeEventListener('pointerdown', handleRuntimePointerDown, true);
  document.removeEventListener('mousedown', handleRuntimeMouseDown, true);
  document.removeEventListener('pointerup', handleDocumentSelectionChange, true);
  document.removeEventListener('mouseup', handleDocumentSelectionChange, true);
  document.removeEventListener('selectionchange', handleDocumentSelectionChange);
  proxy.$superdoc?.off?.('document-mode-change', handleV2DocumentModeChange);
  proxy.$superdoc?.off?.('active-editor-change', syncV2RulerActiveEditor);
});

const selectionLayer = ref(null);
const isDragging = ref(false);

const getSelectionPosition = computed(() => {
  if (!selectionPosition.value || selectionPosition.value.source === DOCUMENT_EDITOR_SELECTION_SOURCE) {
    return { x: null, y: null };
  }

  const isPdf = selectionPosition.value.source === 'pdf';
  const zoom = isPdf ? (activeZoom.value ?? 100) / 100 : 1;
  const top = selectionPosition.value.top * zoom;
  const left = selectionPosition.value.left * zoom;
  const right = selectionPosition.value.right * zoom;
  const bottom = selectionPosition.value.bottom * zoom;
  const style = {
    zIndex: 500,
    borderRadius: '4px',
    top: top + 'px',
    left: left + 'px',
    height: Math.abs(top - bottom) + 'px',
    width: Math.abs(left - right) + 'px',
  };
  return style;
});

const handleSelectionChange = (selection) => {
  if (isViewingMode() && !allowSelectionInViewMode()) {
    resetSelection();
    return;
  }
  if (!selection.selectionBounds || !isCommentsEnabled.value) return;

  resetSelection();

  const isMobileView = window.matchMedia('(max-width: 768px)').matches;

  updateSelection({
    startX: selection.selectionBounds.left,
    startY: selection.selectionBounds.top,
    x: selection.selectionBounds.right,
    y: selection.selectionBounds.bottom,
    source: selection.source,
  });

  if (!selectionPosition.value) return;
  const selectionIsWideEnough = Math.abs(selectionPosition.value.left - selectionPosition.value.right) > 5;
  const selectionIsTallEnough = Math.abs(selectionPosition.value.top - selectionPosition.value.bottom) > 5;
  if (!selectionIsWideEnough || !selectionIsTallEnough) {
    if (selectionLayer.value?.style) selectionLayer.value.style.pointerEvents = 'none';
    resetSelection();
    return;
  }

  activeSelection.value = selection;

  // Place the tools menu at the level of the selection
  const isPdf = selection.source === 'pdf' || selection.source?.value === 'pdf';
  const zoom = isPdf ? (activeZoom.value ?? 100) / 100 : 1;
  const top = selection.selectionBounds.top * zoom;
  toolsMenuPosition.top = top + 'px';
  toolsMenuPosition.right = isMobileView ? '0' : '-25px';
};

const resetSelection = () => {
  selectionPosition.value = null;
  toolsMenuPosition.top = null;
};

const updateSelection = ({ startX, startY, x, y, source, page }) => {
  const hasStartCoords = typeof startX === 'number' || typeof startY === 'number';
  const hasEndCoords = typeof x === 'number' || typeof y === 'number';

  if (!hasStartCoords && !hasEndCoords) {
    resetSelection();
    return;
  }

  // Initialize the selection position
  if (!selectionPosition.value) {
    if (startY == null || startX == null) return;
    selectionPosition.value = {
      top: startY,
      left: startX,
      right: startX,
      bottom: startY,
      startX,
      startY,
      source,
      page: page ?? null,
    };
  }

  if (typeof startX === 'number') selectionPosition.value.startX = startX;
  if (typeof startY === 'number') selectionPosition.value.startY = startY;

  // Reverse the selection if the user drags up or left
  if (typeof y === 'number') {
    const selectionTop = selectionPosition.value.startY;
    if (y < selectionTop) {
      selectionPosition.value.top = y;
    } else {
      selectionPosition.value.bottom = y;
    }
  }

  if (typeof x === 'number') {
    const selectionLeft = selectionPosition.value.startX;
    if (x < selectionLeft) {
      selectionPosition.value.left = x;
    } else {
      selectionPosition.value.right = x;
    }
  }
};

const getPdfPageNumberFromEvent = (event) => {
  const x = event?.clientX;
  const y = event?.clientY;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const elements = document.elementsFromPoint(x, y);
  const pageEl = elements.find((el) => el?.dataset?.pdfPage != null);
  if (pageEl) {
    const pageNumber = Number(pageEl.dataset?.pageNumber);
    return Number.isFinite(pageNumber) ? pageNumber : null;
  }
  return null;
};

const handleSelectionStart = (e) => {
  resetSelection();
  selectionLayer.value.style.pointerEvents = 'auto';

  nextTick(() => {
    isDragging.value = true;
    selectionLayer.value.style.pointerEvents = 'none';
    const pageNumber = getPdfPageNumberFromEvent(e);
    selectionLayer.value.style.pointerEvents = 'auto';
    if (!pageNumber) {
      isDragging.value = false;
      selectionLayer.value.style.pointerEvents = 'none';
      return;
    }
    const layerBounds = selectionLayer.value.getBoundingClientRect();
    const zoom = activeZoom.value / 100;
    const x = (e.clientX - layerBounds.left) / zoom;
    const y = (e.clientY - layerBounds.top) / zoom;
    updateSelection({ startX: x, startY: y, page: pageNumber, source: 'pdf' });
    selectionLayer.value.addEventListener('mousemove', handleDragMove);
  });
};

const handleDragMove = (e) => {
  if (!isDragging.value) return;
  const layerBounds = selectionLayer.value.getBoundingClientRect();
  const zoom = activeZoom.value / 100;
  const x = (e.clientX - layerBounds.left) / zoom;
  const y = (e.clientY - layerBounds.top) / zoom;
  updateSelection({ x, y });
};

const handleDragEnd = (e) => {
  if (!isDragging.value) return;
  selectionLayer.value.removeEventListener('mousemove', handleDragMove);

  if (!selectionPosition.value) return;
  const pageNumber = selectionPosition.value.page ?? getPdfPageNumberFromEvent(e);
  const selection = useSelection({
    selectionBounds: {
      top: selectionPosition.value.top,
      left: selectionPosition.value.left,
      right: selectionPosition.value.right,
      bottom: selectionPosition.value.bottom,
    },
    page: pageNumber ?? 1,
    documentId: documents.value[0].id,
    source: 'pdf',
  });

  handleSelectionChange(selection);
  selectionLayer.value.style.pointerEvents = 'none';
};

const shouldShowSelection = computed(() => {
  if (!proxy.$superdoc.uiConfig.comments.enabled) return false;
  const config = proxy.$superdoc.config.modules?.comments;
  if (!config || config === false) return false;
  return !config.readOnly;
});

// ui-phase4-002: reactive ruler state. `proxy.$superdoc.activeEditor` itself is
// a plain property (no Vue tracking), so readiness and active-document changes
// are shadowed through refs for template updates.
const v2RulerReady = ref(false);
const v2RulerActiveDocumentId = ref(null);

const unwrapDocField = (value) => {
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value;
};

const shouldShowV2Ruler = (doc) => {
  if (!isV2Mode.value) return false;
  if (!doc || doc.type !== DOCX) return false;
  // Parity contract (plan WS1): the ruler is paginated-only. v1 hid the ruler
  // in web layout, and v2 has no dedicated web-layout ruler contract yet, so
  // suppress it there until one is deliberately designed.
  if (proxy.$superdoc.config.viewOptions?.layout === 'web') return false;
  // `doc.rulers` is a Ref produced by `useDocument`; unwrap defensively in
  // case the proxy access surface ever changes. It stays the live source
  // because `toggleRuler` writes to it. The profile can only veto when the
  // consumer forbade the surface — `enabled` alone would also veto the
  // historical default, where `rulers` starts false and the toolbar button
  // is what turns the ruler on.
  if (proxy.$superdoc.uiConfig.ruler.suppressed) return false;
  const rulersOn = Boolean(unwrapDocField(doc.rulers));
  if (!rulersOn) return false;
  // Re-evaluate when v2RulerReady changes.
  if (!v2RulerReady.value) return false;
  const editor = proxy.$superdoc?.activeEditor;
  if (!editor || editor.editorVersion !== 2) return false;
  const docId = unwrapDocField(doc.id);
  const activeDocumentId = v2RulerActiveDocumentId.value;
  if (docId && activeDocumentId && docId !== activeDocumentId) return false;
  return Boolean(editor.pageMetrics && editor.pageLayout);
};

// ui-phase4-002: ruler container alignment. Mirrors v1 document editor's
// `syncRulerOffset` but anchors to the active v2 page instead of a
// v1-specific viewport class.
const v2RulerHostStyle = ref({});
const v2RulerPageRect = ref(null);
let v2RulerEditorObserver = null;
let v2RulerContainerObserver = null;
let v2RulerActivePageIndex = 0;
let v2RulerContextPageLayout = null;
let unsubscribeV2RulerContext = null;

// Where the ruler mounts, resolved once from the built-in UI profile. The
// profile folds `ui.ruler.container` over the legacy `rulerContainer` alias and
// reports `null` for a suppressed ruler, so reading the raw config here would
// both ignore the newer spelling and hand back a target for a surface that must
// not render.
const resolvedRulerContainer = computed(() => proxy.$superdoc?.uiConfig?.ruler?.container ?? null);

const resolveV2RulerContainer = () => {
  const container = resolvedRulerContainer.value;
  if (!container) return null;
  if (typeof container === 'string') {
    const doc = typeof document !== 'undefined' ? document : globalThis.document;
    return doc?.querySelector(container) ?? null;
  }
  return typeof HTMLElement !== 'undefined' && container instanceof HTMLElement ? container : null;
};

const getActiveV2DocumentId = () =>
  proxy.$superdoc?.activeEditor?.documentId ?? proxy.$superdoc?.activeEditor?.options?.documentId ?? null;

const resolveV2RulerAlignmentContainer = () => {
  if (resolvedRulerContainer.value) return resolveV2RulerContainer();
  const activeDocumentId = getActiveV2DocumentId();
  if (activeDocumentId == null) return null;
  return subDocumentRoots.get(activeDocumentId) ?? subDocumentRoots.get(String(activeDocumentId)) ?? null;
};

const getV2ActivePageRect = () => {
  const activeDocumentId = getActiveV2DocumentId();
  const stage =
    activeDocumentId == null ? latestV2MountStage : (v2MountStagesByDocumentId.get(String(activeDocumentId)) ?? null);
  if (!stage?.isConnected) return null;
  const wrapper = Array.from(stage.children).find((element) => element.dataset?.v2PaintWrapper === 'true') ?? stage;
  const pages = Array.from(wrapper.children).filter((element) => element.classList?.contains('superdoc-page'));
  const activePage = pages.find((element) => Number(element.dataset?.pageIndex) === v2RulerActivePageIndex) ?? pages[0];
  return (activePage ?? wrapper).getBoundingClientRect();
};

const syncV2RulerOffset = () => {
  if (!isV2Mode.value) {
    v2RulerHostStyle.value = {};
    v2RulerPageRect.value = null;
    return;
  }
  const alignmentContainer = resolveV2RulerAlignmentContainer();
  if (!alignmentContainer) {
    v2RulerHostStyle.value = {};
    v2RulerPageRect.value = null;
    return;
  }
  const pageRect = getV2ActivePageRect();
  if (!pageRect) {
    v2RulerHostStyle.value = {};
    v2RulerPageRect.value = null;
    return;
  }
  const containerRect = alignmentContainer.getBoundingClientRect();
  const paddingLeft = Math.max(0, pageRect.left - containerRect.left);
  const paddingRight = Math.max(0, containerRect.right - pageRect.right);
  v2RulerHostStyle.value = {
    paddingLeft: `${paddingLeft}px`,
    paddingRight: `${paddingRight}px`,
  };
  v2RulerPageRect.value = {
    left: pageRect.left,
    top: pageRect.top,
    width: pageRect.width,
    height: pageRect.height,
  };
};

const cleanupV2RulerContextSubscription = () => {
  const unsubscribe = unsubscribeV2RulerContext;
  unsubscribeV2RulerContext = null;
  v2RulerContextPageLayout = null;
  v2RulerActivePageIndex = 0;
  try {
    unsubscribe?.();
  } catch {
    /* ignore */
  }
};

const setupV2RulerContextSubscription = (pageLayout) => {
  cleanupV2RulerContextSubscription();
  if (!pageLayout) return;
  v2RulerContextPageLayout = pageLayout;
  try {
    v2RulerActivePageIndex = pageLayout.getActiveRulerContext?.()?.pageIndex ?? 0;
    unsubscribeV2RulerContext =
      pageLayout.subscribeActiveRulerContext?.((context) => {
        if (v2RulerContextPageLayout !== pageLayout) return;
        const pageIndex = context?.pageIndex ?? 0;
        if (pageIndex === v2RulerActivePageIndex) return;
        v2RulerActivePageIndex = pageIndex;
        nextTick(() => syncV2RulerOffset());
      }) ?? null;
  } catch {
    cleanupV2RulerContextSubscription();
  }
};

const syncV2RulerActiveEditor = () => {
  const editor = proxy.$superdoc?.activeEditor;
  const activeDocumentId = editor?.documentId ?? editor?.options?.documentId ?? null;
  v2RulerActiveDocumentId.value = activeDocumentId;

  if (editor?.editorVersion !== 2 || !editor.pageMetrics || !editor.pageLayout) {
    cleanupV2RulerObservers();
    cleanupV2RulerContextSubscription();
    v2RulerHostStyle.value = {};
    v2RulerReady.value = false;
    return;
  }

  if (v2RulerContextPageLayout !== editor.pageLayout) {
    setupV2RulerContextSubscription(editor.pageLayout);
  }
  v2RulerReady.value = true;
  nextTick(() => {
    syncV2RulerOffset();
    setupV2RulerObservers();
  });
};

const cleanupV2RulerObservers = () => {
  if (typeof window !== 'undefined') window.removeEventListener('scroll', syncV2RulerOffset, true);
  try {
    v2RulerEditorObserver?.disconnect();
  } catch {
    /* ignore */
  }
  v2RulerEditorObserver = null;
  try {
    v2RulerContainerObserver?.disconnect();
  } catch {
    /* ignore */
  }
  v2RulerContainerObserver = null;
};

const setupV2RulerObservers = () => {
  cleanupV2RulerObservers();
  if (typeof window !== 'undefined') window.addEventListener('scroll', syncV2RulerOffset, true);
  if (typeof ResizeObserver === 'undefined') return;
  const layersEl = layers.value;
  const alignmentContainer = resolveV2RulerAlignmentContainer();
  if (layersEl) {
    v2RulerEditorObserver = new ResizeObserver(() => syncV2RulerOffset());
    v2RulerEditorObserver.observe(layersEl);
  }
  if (alignmentContainer) {
    v2RulerContainerObserver = new ResizeObserver(() => syncV2RulerOffset());
    v2RulerContainerObserver.observe(alignmentContainer);
  }
};

// ui-phase4-002: handle margin change events from V2Ruler. Mirrors the v1
// `handledocument editorPageMarginsChange` path so existing consumers reading
// `doc.documentMarginsLastChange` keep working without per-version branching.
const handleV2PageMarginsChange = (doc, event) => {
  if (!doc || !event) return;
  doc.documentMarginsLastChange = event.pageMargins ?? null;
  // Emit a `page-margins-change` event so external listeners can react. The
  // payload includes the section that was edited for v2 multi-section
  // discoverability.
  proxy.$superdoc.emit('page-margins-change', {
    documentId: doc.id,
    editorVersion: 2,
    sectionId: event.sectionId,
    sectionIndex: event.sectionIndex,
    side: event.side,
    value: event.value,
    pageMargins: event.pageMargins,
  });
};

const handlePdfClick = (e) => {
  if (!isCommentsEnabled.value) return;
  resetSelection();
  isDragging.value = true;
  handleSelectionStart(e);
};

const handlePdfSelectionRaw = ({ selectionBounds, documentId, page }) => {
  if (!selectionBounds || !documentId) return;
  const selection = useSelection({
    selectionBounds,
    documentId,
    page,
    source: 'pdf',
  });
  handleSelectionChange(selection);
};

// Web layout without layout engine - apply CSS transform directly
// to non-PDF sub-document containers so zoom works for PM fallback rendering.
// PDF documents are excluded because pdfViewer.updateScale() handles their zoom
// separately; applying both would result in double-zoom.
const applyFallbackZoomStyles = (zoomFactor) => {
  const subDocs = layers.value?.querySelectorAll('.superdoc__sub-document');
  subDocs?.forEach((el) => {
    if (el.querySelector('.sd-pdf-viewer')) return;
    if (zoomFactor === 1) {
      el.style.transformOrigin = '';
      el.style.transform = '';
      el.style.width = '';
    } else {
      el.style.transformOrigin = 'top left';
      el.style.transform = `scale(${zoomFactor})`;
      el.style.width = `${100 / zoomFactor}%`;
    }
  });
};

// One-time initial application for surfaces that only consume zoom
// imperatively. A seeded `zoom.initial` never fires the activeZoom watcher
// (the ref starts at the seeded value), and the fallback transform targets
// elements that do not exist until documents render - so apply once from
// the per-document ready hooks. DocumentRendererRuntime and PdfViewer take
// their initial value at creation (layoutEngineOptions.zoom /
// :initial-scale) and need nothing here.
let initialFallbackZoomApplied = false;
const ensureInitialFallbackZoom = () => {
  if (initialFallbackZoomApplied) return;
  if (proxy.$superdoc.config.useLayoutEngine !== false) return;
  const zoomFactor = (activeZoom.value ?? 100) / 100;
  if (zoomFactor === 1) return;
  initialFallbackZoomApplied = true;
  nextTick(() => applyFallbackZoomStyles(zoomFactor));
};

watch(
  () => activeZoom.value,
  (zoom) => {
    const zoomFactor = (zoom ?? 100) / 100;
    const zoomPercent = zoom ?? 100;

    // Route DOCX zoom through the v2 page metrics runtime. PDF and HTML
    // viewers stay on their existing paths (still set below).
    const v2PageMetrics = proxy.$superdoc?.activeEditor?.pageMetrics ?? null;
    const v2FacadeActive = isV2Mode.value && proxy.$superdoc?.activeEditor?.editorVersion === 2;

    if (v2FacadeActive && v2PageMetrics?.setZoom) {
      try {
        v2PageMetrics.setZoom(zoomPercent);
      } catch (err) {
        console.warn('[SuperDoc][v2] setZoom failed', err);
      }
    } else {
      initialFallbackZoomApplied = true;
      applyFallbackZoomStyles(zoomFactor);
    }

    const pdfViewer = getPDFViewer();
    pdfViewer?.updateScale(zoomFactor);

    nextTick(() => {
      updateWhiteboardPageSizes();
      updateWhiteboardPageOffsets();
    });
  },
);

// Ensure hasInitializedLocations is set when comments arrive (backup for cases
// where handleDocumentReady hasn't fired yet). Never toggle false→true→false —
// the virtualized FloatingComments reacts to comment changes via computed properties.
watch(floatingComments, () => {
  if (!hasInitializedLocations.value) {
    hasInitializedLocations.value = true;
  }
});

const {
  whiteboardModuleConfig,
  whiteboard,
  whiteboardPages,
  whiteboardPageSizes,
  whiteboardPageOffsets,
  whiteboardEnabled,
  whiteboardOpacity,
  handleWhiteboardPageReady,
  updateWhiteboardPageSizes,
  updateWhiteboardPageOffsets,
} = useWhiteboard({
  proxy,
  layers,
  documents,
  modules,
});

const getPDFViewer = () => {
  return Array.isArray(pdfViewerRef.value) ? pdfViewerRef.value[0] : pdfViewerRef.value;
};

// SD-3497: mount the whiteboard overlay only for PDF documents with the
// whiteboard module configured. `whiteboardInteractive` separates "show the
// overlay" (driven by data + module config) from "the overlay owns pointer
// events": when the whiteboard is disabled the layer stays visible but
// pointer-inert so PDF text/comment selection is not blocked. When the
// whiteboard is enabled it intentionally owns the PDF surface (documented mode
// tradeoff; see plan section 3 pointer ownership).
const shouldRenderPdfWhiteboard = computed(() => hasPdfDocument.value && Boolean(whiteboardModuleConfig.value));
const whiteboardInteractive = computed(() => whiteboardEnabled.value);
</script>

<template>
  <div
    ref="superdocRoot"
    class="superdoc"
    :class="{
      'superdoc--with-sidebar': showCommentsSidebar,
      'superdoc--web-layout': proxy.$superdoc.config.viewOptions?.layout === 'web',
      'superdoc--contained': proxy.$superdoc.config.contained,
      'high-contrast': isHighContrastMode,
    }"
    :style="superdocStyleVars"
    @keydown="handleContainerKeydown"
  >
    <div class="superdoc__layers layers" ref="layers" role="group">
      <!-- Floating tools menu (shows up when user has text selection)-->
      <!-- ui-phase3-002: v2 reuses the existing shell comment tool by
           synthesizing the same selection state the v1 path consumes. -->
      <div v-if="showToolsFloatingMenu" class="superdoc__tools tools" :style="toolsMenuPosition">
        <div class="tools-item" data-id="is-tool" @mousedown.stop.prevent="handleToolClick('comments')">
          <div class="superdoc__tools-icon" v-html="superdocIcons.comment"></div>
        </div>
      </div>

      <div class="superdoc__document document">
        <div
          v-if="isCommentsEnabled"
          class="superdoc__selection-layer selection-layer"
          @mousedown="handleSelectionStart"
          @mouseup="handleDragEnd"
          ref="selectionLayer"
        >
          <div
            :style="getSelectionPosition"
            class="superdoc__temp-selection temp-selection sd-highlight sd-initial-highlight"
            v-if="selectionPosition && shouldShowSelection"
          ></div>
        </div>

        <div
          class="superdoc__sub-document sub-document"
          v-for="doc in documents"
          :key="`${doc.id}:${doc.editorMountNonce}`"
          :ref="(el) => setSubDocumentRoot(doc, el)"
        >
          <!-- PDF renderer -->
          <PdfViewer
            v-if="doc.type === PDF"
            :file="doc.data"
            :file-id="doc.id"
            :initial-scale="(activeZoom ?? 100) / 100"
            :config="pdfConfig"
            @selection-raw="handlePdfSelectionRaw"
            @bypass-selection="handlePdfClick"
            @page-rendered="handleWhiteboardPageReady"
            @document-ready="({ documentId, viewerContainer }) => handleDocumentReady(documentId, viewerContainer)"
            ref="pdfViewerRef"
          />

          <!-- V2 DOCX editor branch. The wrapper owns createV2EditorHost/open/mount/save/dispose. -->
          <!-- ui-phase4-002: v2 ruler. Teleported to `rulerContainer` when
               supplied; rendered inline above the v2 stage otherwise. Visibility tracks the existing
               `rulers` setting per document. -->
          <template v-if="doc.type === DOCX && V2Ruler && shouldShowV2Ruler(doc)">
            <Teleport v-if="resolvedRulerContainer" :to="resolvedRulerContainer">
              <div class="v2-ruler-host" :style="v2RulerHostStyle">
                <V2Ruler
                  :page-layout="proxy.$superdoc.activeEditor.pageLayout"
                  :measurement-unit="measurementUnit"
                  :active-page-rect="v2RulerPageRect"
                  @page-margins-change="(event) => handleV2PageMarginsChange(doc, event)"
                />
              </div>
            </Teleport>
            <div v-else class="v2-ruler-host" :style="v2RulerHostStyle">
              <V2Ruler
                :page-layout="proxy.$superdoc.activeEditor.pageLayout"
                :measurement-unit="measurementUnit"
                :active-page-rect="v2RulerPageRect"
                @page-margins-change="(event) => handleV2PageMarginsChange(doc, event)"
              />
            </div>
          </template>

          <V2DocumentEditor
            v-if="doc.type === DOCX"
            :file-source="doc.data"
            :document-id="doc.id"
            :options="editorOptions(doc)"
            :measurement-unit="measurementUnit"
            @v2-editor-ready="onV2EditorReady"
            @v2-editor-failed="onV2EditorFailed"
            @v2-render="onV2Render"
            @v2-render-cleared="onV2RenderCleared"
            @v2-selection-changed="onV2SelectionChanged"
            @v2-host-event="(event) => onV2HostEvent(doc, event)"
            @v2-link-click="onV2LinkClick"
            @v2-comment-created="onV2CommentCreated"
            @v2-page-metrics="onV2PageMetrics"
            @v2-render-readiness="(payload) => onV2RenderReadiness(doc, payload)"
            @v2-open-diagnostics="(payload) => onV2OpenDiagnostics(doc, payload)"
          />

          <!-- omitting field props -->
          <HtmlViewer
            v-if="doc.type === HTML"
            @ready="(id) => handleDocumentReady(id, null)"
            @selection-change="handleSelectionChange"
            :file-source="doc.data"
            :document-id="doc.id"
          />
        </div>

        <!-- SD-3497: PDF-scoped overlays. WhiteboardLayer mounts under the
             comment anchors so anchors stay clickable even when the whiteboard
             owns pointer events. PdfCommentsLayer renders the durable, clickable
             PDF comment anchors. Neither renders for DOCX v2 documents. -->
        <WhiteboardLayer
          v-if="shouldRenderPdfWhiteboard"
          class="superdoc__whiteboard-layer"
          :whiteboard="whiteboard"
          :pages="whiteboardPages"
          :page-sizes="whiteboardPageSizes"
          :page-offsets="whiteboardPageOffsets"
          :enabled="whiteboardEnabled"
          :interactive="whiteboardInteractive"
          :opacity="whiteboardOpacity"
        />

        <PdfCommentsLayer v-if="shouldRenderPdfCommentAnchors" @anchor-activate="handleHighlightClick" />
      </div>
    </div>

    <div ref="rightSidebarRef" class="superdoc__right-sidebar right-sidebar" v-if="showCommentsSidebar">
      <div class="floating-comments">
        <FloatingComments
          v-if="hasInitializedLocations && (floatingComments.length > 0 || pendingComment)"
          v-for="doc in documentsWithConverations"
          :parent="layers"
          :current-document="doc"
        />
      </div>
    </div>

    <div v-if="activeCompactComment" class="superdoc__compact-comment-popover" :style="compactCommentPopoverStyle">
      <CommentDialog :comment="activeCompactComment" :parent="layers" />
    </div>

    <!-- Surface host — generic dialog/floating overlay system -->
    <SurfaceHost :geometry-target="layers" />
  </div>
</template>

<style scoped>
.superdoc {
  display: flex;
  position: relative;
}

.right-sidebar {
  min-width: 320px;
  height: 100%;
}

.floating-comments {
  min-width: 300px;
  width: 300px;
  height: 100%;
  overflow: visible;
}

.superdoc__layers {
  height: 100%;
  position: relative;
  box-sizing: border-box;
}

.superdoc__document {
  width: 100%;
  position: relative;
}

.superdoc__sub-document {
  width: 100%;
  position: relative;
}

.superdoc__selection-layer {
  position: absolute;
  min-width: 100%;
  min-height: 100%;
  z-index: 10;
  pointer-events: none;
}

/* SD-3497: PDF whiteboard overlay sits above the rendered PDF canvas but below
   the PDF comment anchors (z-index 6 in PdfCommentsLayer) so anchors stay
   clickable, and below the selection layer (z-index 10). */
.superdoc__whiteboard-layer {
  z-index: 4;
}

.superdoc__temp-selection {
  position: absolute;
}

.superdoc__right-sidebar {
  width: 320px;
  min-width: 320px;
  padding: 0 10px;
  min-height: 100%;
  position: relative;
  z-index: 2;
}

.superdoc__compact-comment-popover {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 11;
  width: min(320px, calc(100% - 24px));
}

/* Tools styles */
.tools {
  position: absolute;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: var(--sd-ui-tools-gap, 6px);
}

.tools-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--sd-ui-tools-item-size, 50px);
  height: var(--sd-ui-tools-item-size, 50px);
  background-color: var(--sd-ui-tools-item-bg, rgba(219, 219, 219, 0.6));
  border-radius: var(--sd-ui-tools-item-radius, 12px);
  cursor: pointer;
  position: relative;
}

.tools-item i {
  cursor: pointer;
}

.superdoc__tools-icon {
  width: var(--sd-ui-tools-icon-size, 20px);
  height: var(--sd-ui-tools-icon-size, 20px);
  flex-shrink: 0;
}

/* Tools styles - end */

/* .docx {
  border: 1px solid #dfdfdf;
  pointer-events: auto;
} */

/* 834px is iPad screen size in portrait orientation */
@media (max-width: 834px) {
  .superdoc .superdoc__layers {
    margin: 0;
    border: 0 !important;
    box-shadow: none;
  }

  .superdoc__sub-document {
    max-width: 100%;
  }

  .superdoc__right-sidebar {
    padding: 10px;
    position: relative;
  }
}

/* AI Writer styles */
.ai-writer-container {
  position: fixed;
  z-index: 1000;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
}

/* Remove the AI Sidebar styles */
/* .ai-sidebar-container {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 50;
} */

.ai-tool > svg {
  fill: transparent;
}

.ai-tool::before {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;

  z-index: 1;
  background: linear-gradient(
    270deg,
    rgba(218, 215, 118, 0.5) -20%,
    rgba(191, 100, 100, 1) 30%,
    rgba(77, 82, 217, 1) 60%,
    rgb(255, 219, 102) 150%
  );
  -webkit-mask: url("data:image/svg+xml;charset=utf-8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><path d='M224 96l16-32 32-16-32-16-16-32-16 32-32 16 32 16 16 32zM80 160l26.7-53.3L160 80l-53.3-26.7L80 0 53.3 53.3 0 80l53.3 26.7L80 160zm352 128l-26.7 53.3L352 368l53.3 26.7L432 448l26.7-53.3L512 368l-53.3-26.7L432 288zm70.6-193.8L417.8 9.4C411.5 3.1 403.3 0 395.2 0c-8.2 0-16.4 3.1-22.6 9.4L9.4 372.5c-12.5 12.5-12.5 32.8 0 45.3l84.9 84.9c6.3 6.3 14.4 9.4 22.6 9.4 8.2 0 16.4-3.1 22.6-9.4l363.1-363.2c12.5-12.5 12.5-32.8 0-45.2zM359.5 203.5l-50.9-50.9 86.6-86.6 50.9 50.9-86.6 86.6z'/></svg>")
    center / contain no-repeat;
  mask: url("data:image/svg+xml;charset=utf-8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><path d='M224 96l16-32 32-16-32-16-16-32-16 32-32 16 32 16 16 32zM80 160l26.7-53.3L160 80l-53.3-26.7L80 0 53.3 53.3 0 80l53.3 26.7L80 160zm352 128l-26.7 53.3L352 368l53.3 26.7L432 448l26.7-53.3L512 368l-53.3-26.7L432 288zm70.6-193.8L417.8 9.4C411.5 3.1 403.3 0 395.2 0c-8.2 0-16.4 3.1-22.6 9.4L9.4 372.5c-12.5 12.5-12.5 32.8 0 45.3l84.9 84.9c6.3 6.3 14.4 9.4 22.6 9.4 8.2 0 16.4-3.1 22.6-9.4l363.1-363.2c12.5-12.5 12.5-32.8 0-45.2zM359.5 203.5l-50.9-50.9 86.6-86.6 50.9 50.9-86.6 86.6z'/></svg>")
    center / contain no-repeat;
  filter: brightness(1.2);
  transition: filter 0.2s ease;
}

.ai-tool:hover::before {
  filter: brightness(1.3);
}

/* Tools styles - end */
</style>
