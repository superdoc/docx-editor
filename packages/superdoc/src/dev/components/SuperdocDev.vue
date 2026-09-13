<script setup>
import '@superdoc/common/styles/common-styles.css';
import '../dev-styles.css';
import '../themes/neon-night.css';
import { nextTick, onMounted, onBeforeUnmount, ref, shallowRef, computed, watch } from 'vue';

import { SuperDoc } from '@superdoc/index.js';
import { DOCX } from '@superdoc/common';
import { getFileObject } from '@superdoc/common';
import { superdocFonts } from '@superdoc/fonts';
import BasicUpload from '@superdoc/common/components/BasicUpload.vue';
import SuperdocLogo from './superdoc-logo.webp?url';
import BlankDOCX from '@superdoc/common/data/blank.docx?url';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import SidebarSearch from './sidebar/SidebarSearch.vue';
import SidebarCollaboration from './sidebar/SidebarCollaboration.vue';
import SidebarLayout from './sidebar/SidebarLayout.vue';
import {
  createDevCollaborationAutoUrl,
  createDevDocumentConfig,
  createDevV2CollaborationConfig,
  resolveDevCollaborationRoomMode,
  resolveDevCollaborationServerUrl,
} from '../collaboration-config';
import {
  applyCompareWithWs09Fallback,
  captureCompareApplyDebugSnapshot,
  compareApplyFallbackMessage,
  settleCompareApplyPaint,
} from '../compare-apply';

// note:
// Or set worker globally outside the component.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

/* For local dev */
const superdoc = shallowRef(null);
const activeEditor = shallowRef(null);
const bulkDecisionToast = ref(null);
let bulkDecisionToastTimeout = 0;

const dismissBulkDecisionToast = () => {
  bulkDecisionToast.value = null;
  window.clearTimeout(bulkDecisionToastTimeout);
  bulkDecisionToastTimeout = 0;
};

const pluralizeChanges = (count) => (count === 1 ? 'change' : 'changes');

// Example of how one might handle the bulk tracked change event
const formatBulkDecisionToast = (event) => {
  const action = event.decision === 'accept' ? 'Accepted' : 'Rejected';
  const deniedVerb = event.permissionDeniedCount === 1 ? 'was' : 'were';
  const successfulChanges = pluralizeChanges(event.successfulCount);
  const deniedChanges = pluralizeChanges(event.permissionDeniedCount);
  const successfulSummary = `${action} ${event.successfulCount} ${successfulChanges}.`;
  const deniedSummary = `${event.permissionDeniedCount} ${deniedChanges} ${deniedVerb} left because you don't have permission.`;
  return `${successfulSummary} ${deniedSummary}`;
};

const onTrackedChangesBulkDecision = (event) => {
  dismissBulkDecisionToast();
  if (event.permissionDeniedCount === 0) return;

  bulkDecisionToast.value = formatBulkDecisionToast(event);
  bulkDecisionToastTimeout = window.setTimeout(dismissBulkDecisionToast, 8000);
};

const currentFile = ref(null);
const sidebarInstanceKey = ref(0);
const compareInput = ref(null);

const urlParams = new URLSearchParams(window.location.search);
const isInternal = urlParams.has('internal');
const ensureStableDevTabId = () => {
  const storageKey = 'superdoc-dev-tab-id';
  const existingId = window.sessionStorage.getItem(storageKey);
  if (existingId) return existingId;
  const nextId = `dev-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(storageKey, nextId);
  return nextId;
};
const stableDevTabId = ensureStableDevTabId();
const testUserId = urlParams.get('userId') || urlParams.get('id') || stableDevTabId;
const testUserEmail = urlParams.get('email') || `${stableDevTabId}@dev.superdoc`;
const testUserName = urlParams.get('name') || `SuperDoc ${Math.floor(1000 + Math.random() * 9000)}`;
const userRole = urlParams.get('role') || 'editor';
const useLayoutEngine = ref(urlParams.get('layout') !== '0');
const showBookmarks = ref(urlParams.get('bookmarks') === '1');
const useWebLayout = ref(urlParams.get('view') === 'web');
const useWhiteboardModule = ['1', 'true', 'on'].includes((urlParams.get('whiteboard') || '').toLowerCase());
const normalizeBooleanParam = (raw, fallback = true) => {
  const value = (raw || '').toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(value)) return false;
  if (['1', 'true', 'on', 'yes'].includes(value)) return true;
  return fallback;
};
// Painter plan P7: the windowed paint owner IS vertical-paginated flow (no
// flag). `?v2Hud=1`: per-paint counter HUD + dark reuse tripwire.
const paintHud = normalizeBooleanParam(urlParams.get('v2Hud'), false);
// WS6.2 — DEV-ONLY HARNESS CONTROLS. The URL params `v2exec`,
// `executionMode`, and `workerMode` (and the streaming/HUD params above) are
// parsed only by this dev app. `src/dev/**` is unreachable from every library
// build: the lib entries (`src/index.js`, `src/public/ui*.ts` in
// vite.config.js) never import it, the dts/coverage configs exclude
// `src/dev/**`, and vite.config.devapp.js — the only build that bundles this
// file — is explicitly NOT a library build. No customer bundle can reach
// these overrides. They feed the internal/test-only `benchmarkExecutionMode`
// config key; product/customer browser execution stays worker-only.
const normalizeV2ExecutionModeParam = (raw) => {
  if (raw === 'worker' || raw === 'inline' || raw === 'auto') return raw;
  return null;
};
const requestedV2ExecutionMode = normalizeV2ExecutionModeParam(
  urlParams.get('v2exec') ?? urlParams.get('executionMode') ?? urlParams.get('workerMode'),
);
const trackChangesReplacementMode = ref(
  urlParams.get('replacementMode') === 'separate' || urlParams.get('replacements') === 'independent'
    ? 'separate'
    : 'grouped',
);
const useCollaboration = urlParams.get('collab') === '1';
const collabRoom = urlParams.get('room') || 'superdoc-dev-room';
const collabUrl = resolveDevCollaborationServerUrl(urlParams.get('collabUrl'));
const collabRoomMode = ref(useCollaboration ? resolveDevCollaborationRoomMode(urlParams.get('collabRoomMode')) : null);
const activeCollaborationRoomMode = ref(
  useCollaboration && collabRoomMode.value === 'auto' ? 'join' : collabRoomMode.value,
);
const selectedTheme = ref('default');

// Collaboration state
const collaborationEvents = ref([]);
const collaborationProviderStatus = ref(useCollaboration ? 'connecting' : 'disabled');
const COLLABORATION_EVENT_LOG_LIMIT = 250;
const collaborationFallbackAttempts = new Set();
let lastAwarenessActorsKey = '';
const superdocLogo = SuperdocLogo;
const uploadedFileName = ref('');
const uploadDisplayName = computed(() => uploadedFileName.value || 'No file chosen');
const exportFileStem = computed(() => {
  const rawName = uploadedFileName.value?.trim();
  if (!rawName) return 'document';
  return rawName.replace(/\.[^.]+$/, '') || 'document';
});
const resolvedV2ExecutionMode = computed(() => {
  if (useCollaboration) return null;
  if (requestedV2ExecutionMode === 'worker' || requestedV2ExecutionMode === 'inline') {
    return requestedV2ExecutionMode;
  }
  return null;
});
const headerCollapsed = ref(false);
const documentApiUnavailableMessage = computed(
  () => activeEditor.value?.documentApiUnavailableReason || 'Document API unavailable in the current execution mode.',
);
const baseEditorSignalsReady = ref(false);
const canCompareDocuments = computed(() => {
  const diff = activeEditor.value?.doc?.diff;
  return Boolean(
    baseEditorSignalsReady.value &&
    diff &&
    typeof diff.capture === 'function' &&
    typeof diff.compare === 'function' &&
    typeof diff.apply === 'function',
  );
});
const compareButtonTitle = computed(() =>
  canCompareDocuments.value
    ? 'Compare against another DOCX and apply tracked changes to the current document.'
    : documentApiUnavailableMessage.value,
);

const DEV_THEME_CLASSES = ['sd-theme-docs', 'sd-theme-word', 'sd-theme-blueprint', 'sd-theme-neon-night'];

const applyDevTheme = (theme) => {
  const html = document.documentElement;
  DEV_THEME_CLASSES.forEach((cls) => html.classList.remove(cls));
  if (theme !== 'default') html.classList.add(`sd-theme-${theme}`);
};

// URL loading
const documentUrl = ref('');
const isLoadingUrl = ref(false);

const handleLoadFromUrl = async () => {
  if (useCollaboration) {
    console.warn('[collab] URL loading is disabled for the V2 blank-room dev harness.');
    return;
  }

  const url = documentUrl.value.trim();
  if (!url) return;

  isLoadingUrl.value = true;
  try {
    const file = await getFileObject(url, 'document.docx', DOCX);
    await handleNewFile(file);
  } catch (err) {
    console.error('Failed to load from URL:', err);
    const message = err instanceof Error ? err.message : String(err);
    alert(`Failed to load document: ${message}`);
  } finally {
    isLoadingUrl.value = false;
  }
};

const user = {
  id: testUserId,
  name: testUserName,
  email: testUserEmail,
};

const commentPermissionResolver = ({ permission, comment, defaultDecision }) => {
  if (!comment) return defaultDecision;

  // Example: hide tracked-change buttons for matching author email domain
  if (
    comment.trackedChange &&
    comment.creatorEmail?.endsWith('@example.com') &&
    ['RESOLVE_OWN', 'REJECT_OWN'].includes(permission)
  ) {
    return false;
  }

  // Allow default behaviour for everything else
  return defaultDecision;
};

const handleNewFile = async (file) => {
  uploadedFileName.value = file?.name || '';

  // Detect file type by extension
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  const isMarkdown = fileExtension === 'md';
  const isHtml = fileExtension === 'html' || fileExtension === 'htm';

  if (isMarkdown || isHtml) {
    // For text-based files, read the content and use a blank DOCX as base
    const content = await readFileAsText(file);
    currentFile.value = await getFileObject(BlankDOCX, 'blank.docx', DOCX);

    // Store the content to be passed to SuperDoc
    if (isMarkdown) {
      currentFile.value.markdownContent = content;
    } else if (isHtml) {
      currentFile.value.htmlContent = content;
    }
  } else {
    // For binary files (DOCX, PDF), keep the browser File as-is. Re-fetching a
    // blob URL clones large uploads before SuperDoc sees them and can fail for
    // huge DOCX files.
    currentFile.value = file;
  }

  if (useCollaboration) {
    if (isMarkdown || isHtml) {
      console.warn('[collab] Text document uploads are not supported by the V2 replace-file dev harness.');
      return;
    }
    if (superdoc.value && typeof superdoc.value.replaceFile === 'function') {
      try {
        await superdoc.value.replaceFile(currentFile.value);
        console.log('[collab] Replaced file via superdoc.replaceFile()');
      } catch (err) {
        console.error('[collab] replaceFile failed:', err);
      }
    } else {
      console.warn('[collab] superdoc.replaceFile is unavailable.');
    }
  } else {
    nextTick(() => init());
  }

  sidebarInstanceKey.value += 1;
};

const createHiddenCompareMount = () => {
  const element = document.createElement('div');
  element.id = `superdoc-dev-compare-${crypto.randomUUID()}`;
  element.style.position = 'fixed';
  element.style.left = '-9999px';
  element.style.top = '0';
  element.style.width = '1px';
  element.style.height = '1px';
  element.style.opacity = '0';
  element.style.pointerEvents = 'none';
  document.body.appendChild(element);
  return element;
};

const captureDiffSnapshotFromFile = async (file) => {
  const mount = createHiddenCompareMount();
  let tempSuperdoc = null;

  try {
    const snapshot = await new Promise((resolve, reject) => {
      const MAX_WAIT_MS = 15000;
      let settled = false;
      let capturedEditor = null;

      const timeoutId = setTimeout(() => {
        doReject(new Error(`Compare document did not reach source-ready state within ${MAX_WAIT_MS / 1000}s.`));
      }, MAX_WAIT_MS);

      const doResolve = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(value);
      };
      const doReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      };

      tempSuperdoc = new SuperDoc({
        superdocId: `superdoc-dev-compare-${crypto.randomUUID()}`,
        selector: `#${mount.id}`,
        documentMode: 'editing',
        benchmarkExecutionMode: 'inline',
        licenseKey: 'public_license_key_superdocinternal_ad7035140c4b',
        telemetry: {
          enabled: true,
          metadata: {
            source: 'superdoc-dev-compare',
          },
        },
        user,
        document: {
          data: file,
          id: 'compare-target',
        },
        trackChanges: { replacementMode: trackChangesReplacementMode.value },
        viewing: { trackedChanges: 'markup' },
        modules: {
          pdf: {
            pdfLib: pdfjsLib,
            setWorker: false,
          },
        },
        onEditorCreate: ({ editor }) => {
          capturedEditor = editor;
        },
        onSourceSignalsComplete: () => {
          try {
            const capture = capturedEditor?.doc?.diff?.capture;
            if (typeof capture !== 'function') {
              doReject(new Error('Compare document did not expose the inline v2 diff capture API.'));
              return;
            }
            doResolve(capture());
          } catch (error) {
            doReject(error);
          }
        },
        onContentError: ({ error, documentId }) => {
          doReject(
            new Error(`Failed to load compare document ${documentId ?? ''}: ${error?.message ?? String(error)}`),
          );
        },
      });

      tempSuperdoc.on('exception', (error) => {
        doReject(error);
      });
    });

    return snapshot;
  } finally {
    tempSuperdoc?.destroy?.();
    mount.remove();
  }
};

const resolvePreferredCompareApplyDocApi = (editor) => {
  const hostFacade = editor?.host?.getDocumentFacade?.();
  if (hostFacade?.available === true) {
    return {
      ...hostFacade.doc,
      doc: hostFacade.doc,
      host: editor?.host ?? null,
      documentMutationReadiness: editor?.documentMutationReadiness ?? null,
    };
  }
  return editor?.doc ? { ...editor.doc } : null;
};

const handleCompareClick = () => {
  if (!canCompareDocuments.value) {
    alert(documentApiUnavailableMessage.value);
    return;
  }
  compareInput.value?.click();
};

const handleCompareFile = async (event) => {
  const input = event.target;
  const file = input?.files?.[0] ?? null;
  input.value = '';
  if (!file) return;

  if (!canCompareDocuments.value) {
    alert(documentApiUnavailableMessage.value);
    return;
  }

  try {
    const targetSnapshot = await captureDiffSnapshotFromFile(file);

    const liveCompareDocApi = resolvePreferredCompareApplyDocApi(activeEditor.value);
    if (!liveCompareDocApi?.diff?.compare || !liveCompareDocApi?.diff?.apply) {
      throw new Error('Compare document API is unavailable on the active editor.');
    }

    const diff = await liveCompareDocApi.diff.compare({ targetSnapshot });

    if (!diff?.summary?.hasChanges) {
      alert('No differences found between the current document and the comparison DOCX.');
      return;
    }

    const { applyResult, changeMode, fallbackFromTracked, fallbackReason } = await applyCompareWithWs09Fallback(
      liveCompareDocApi,
      diff,
    );
    await settleCompareApplyPaint(liveCompareDocApi);

    console.info('[SuperDoc Dev] Compare result', { applyResult, changeMode, fallbackFromTracked, fallbackReason });
    console.info('[SuperDoc Dev] Compare debug snapshot', captureCompareApplyDebugSnapshot(activeEditor.value));

    const diagnosticsSuffix =
      Array.isArray(applyResult?.diagnostics) && applyResult.diagnostics.length > 0
        ? ` Diagnostics: ${applyResult.diagnostics.join(' | ')}`
        : '';
    const fallbackPrefix = compareApplyFallbackMessage({
      applyResult,
      changeMode,
      fallbackFromTracked,
      fallbackReason,
    });
    alert(
      `${fallbackPrefix}Applied ${applyResult?.appliedOperations ?? 0} ${changeMode} compare operations.${diagnosticsSuffix}`,
    );
  } catch (error) {
    console.error('[SuperDoc Dev] Compare failed', error);
    const message = error instanceof Error ? error.message : String(error);
    alert(`Compare failed: ${message}`);
  }
};

/**
 * Read a file as text content
 * @param {File} file - The file to read
 * @returns {Promise<string>} The file content as text
 */
const readFileAsText = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
};

const createClientEventId = () => `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const appendCollaborationEvent = (event) => {
  collaborationEvents.value = [event, ...collaborationEvents.value].slice(0, COLLABORATION_EVENT_LOG_LIMIT);
};

const clearCollaborationEvents = () => {
  collaborationEvents.value = [];
  lastAwarenessActorsKey = '';
};

const getCollaborationOpenRoomMode = () => {
  if (!useCollaboration) return null;
  return collabRoomMode.value === 'auto' ? activeCollaborationRoomMode.value : collabRoomMode.value;
};

const onCollaborationReady = () => {
  const openedWithRoomMode = getCollaborationOpenRoomMode();
  collaborationProviderStatus.value = 'connected';
  appendCollaborationEvent({
    id: createClientEventId(),
    source: 'client',
    at: new Date().toISOString(),
    origin: 'v2-runtime',
    summary: `V2 collaboration ready (${openedWithRoomMode})`,
  });

  // Creation is a one-shot operation. Keep copied/reloaded dev URLs in auto
  // mode so they join live rooms but can recreate rooms after server restarts.
  if (openedWithRoomMode === 'create') {
    collabRoomMode.value = 'auto';
    activeCollaborationRoomMode.value = 'join';
    window.history.replaceState(window.history.state, '', createDevCollaborationAutoUrl(window.location.href));
  }
};

const retryCollaborationOpen = (nextRoomMode, summary, { promoteToAuto = false } = {}) => {
  const currentRoomMode = getCollaborationOpenRoomMode();
  const retryKey = `${collabRoom}:${currentRoomMode ?? 'none'}:${nextRoomMode}`;
  if (collaborationFallbackAttempts.has(retryKey)) return false;
  collaborationFallbackAttempts.add(retryKey);
  if (promoteToAuto) {
    collabRoomMode.value = 'auto';
    window.history.replaceState(window.history.state, '', createDevCollaborationAutoUrl(window.location.href));
  }
  activeCollaborationRoomMode.value = nextRoomMode;
  appendCollaborationEvent({
    id: createClientEventId(),
    source: 'client',
    at: new Date().toISOString(),
    origin: 'v2-runtime',
    summary,
  });
  void init();
  return true;
};

const handleCollaborationException = (error) => {
  if (!useCollaboration) return false;
  const code = typeof error?.code === 'string' ? error.code : null;
  const currentRoomMode = getCollaborationOpenRoomMode();
  if (code === 'collaboration-v2-room-missing' && currentRoomMode === 'join') {
    const isRecoverableJoinUrl = collabRoomMode.value === 'join';
    if (collabRoomMode.value === 'auto' || isRecoverableJoinUrl) {
      return retryCollaborationOpen('create', 'V2 collaboration room missing; retrying with create', {
        promoteToAuto: isRecoverableJoinUrl,
      });
    }
  }
  if (
    code === 'collaboration-v2-room-already-exists' &&
    currentRoomMode === 'create' &&
    collabRoomMode.value === 'auto'
  ) {
    return retryCollaborationOpen('join', 'V2 collaboration room already exists; retrying with join');
  }
  return false;
};

const onAwarenessUpdate = ({ states = [], added = [], removed = [] }) => {
  const actors = states
    .map((state) => state?.name || state?.email || (state?.clientId != null ? String(state.clientId) : null))
    .filter(Boolean);
  const actorsKey = JSON.stringify([...actors].sort());
  if (added.length === 0 && removed.length === 0 && actorsKey === lastAwarenessActorsKey) return;
  lastAwarenessActorsKey = actorsKey;
  appendCollaborationEvent({
    id: createClientEventId(),
    source: 'client',
    at: new Date().toISOString(),
    origin: 'awareness',
    summary: `Awareness: ${states.length} present, +${added.length}, -${removed.length}`,
    actors,
  });
};

const init = async () => {
  // If the dev shell re-initializes (e.g. on file upload), tear down the previous instance first.
  superdoc.value?.destroy?.();
  superdoc.value = null;
  activeEditor.value = null;
  baseEditorSignalsReady.value = false;
  dismissBulkDecisionToast();
  window.superdoc = null;
  window.editor = null;

  const testId = 'document-123';

  // V2 collaboration is document-owned, so the dev harness must provide an
  // explicit DOCX even when the user has not uploaded one. Non-collaborative
  // opens retain the normal implicit-blank behavior.
  const documentSource = useCollaboration
    ? currentFile.value || (await getFileObject(BlankDOCX, 'blank.docx', DOCX))
    : currentFile.value;
  const v2Collaboration = createDevV2CollaborationConfig({
    enabled: useCollaboration,
    serverUrl: collabUrl,
    documentId: collabRoom,
    roomMode: getCollaborationOpenRoomMode(),
    userId: user.id || user.email || user.name,
  });
  const documentConfig = createDevDocumentConfig({
    source: documentSource,
    id: testId,
    v2Collaboration,
  });

  const config = {
    superdocId: 'superdoc-dev',
    selector: '#superdoc',
    toolbar: 'toolbar',
    role: userRole,
    // Dev-shell render lifecycle diagnostics are forwarded once per named
    // code/reason so large-document failures are visible without DOM probes.
    isDebug: true,
    documentMode: 'editing',
    // Explicit dev-only override. The default execution path is product-owned
    // by the v2 shell and should run here without harness configuration.
    ...(resolvedV2ExecutionMode.value ? { benchmarkExecutionMode: resolvedV2ExecutionMode.value } : {}),
    licenseKey: 'public_license_key_superdocinternal_ad7035140c4b',
    // Word-parity QA must load reviewed metric-compatible substitutes before
    // the first measurement pass. Production consumers opt into the same pack
    // with `@superdoc/fonts`; the dev harness enables it by default.
    fonts: superdocFonts,
    telemetry: {
      enabled: true,
      metadata: {
        source: 'superdoc-dev',
      },
    },
    comments: {
      visible: true,
    },
    toolbarGroups: ['left', 'center', 'right'],
    pagination: useLayoutEngine.value && !useWebLayout.value,
    viewOptions: { layout: useWebLayout.value ? 'web' : 'print' },
    // Web layout + layout engine now uses semantic flow mode.
    useLayoutEngine: useLayoutEngine.value,
    layoutEngineOptions: {
      flowMode: useWebLayout.value ? 'semantic' : 'paginated',
      ...(useWebLayout.value ? { semanticOptions: { marginsMode: 'none' } } : {}),
      showBookmarks: showBookmarks.value,
      ...(paintHud ? { paintHud: true } : {}),
    },
    rulers: true,
    rulerContainer: '#ruler-container',
    annotations: true,
    // Diagnostic kill switch for parity runs; product behavior defaults on.
    ...(urlParams.get('deferDerived') === '0' ? { experimental: { deferDerivedInvalidations: false } } : {}),
    isInternal,
    // disableContextMenu: true,
    // format: 'docx',
    // html: '<p>Hello world</p>',
    // isDev: true,
    // allowSelectionInViewMode: true,
    user,
    title: 'Test document',
    users: [
      { name: 'Internal Reviewer', email: 'internal@example.com', access: 'internal' },
      { name: 'External Reviewer', email: 'external@example.com', access: 'external' },
    ],
    // Collaboration always supplies a concrete blank DOCX so the V2 room can
    // be created or joined through document.v2Collaboration.
    ...(documentConfig ? { document: documentConfig } : {}),
    // documents: [
    //   {
    //     data: currentFile.value,
    //     id: testId,
    //   },
    // ],
    // cspNonce: 'testnonce123',
    trackChanges: { replacementMode: trackChangesReplacementMode.value },
    viewing: { trackedChanges: 'markup' },
    modules: {
      comments: {
        // comments: sampleComments,
        // overflow: true,
        // selector: 'comments-panel',
        // useInternalExternalComments: true,
        // suppressInternalExternal: true,
        permissionResolver: commentPermissionResolver,
        layout: 'auto',
        // responsive: { target: '#superdoc', breakpoint: 1400 },
      },
      toolbar: {
        selector: 'toolbar',
        toolbarGroups: ['left', 'center', 'right'],
        // groups: {
        //   center: ['bold'],
        //   right: ['documentMode']
        // },
        // fonts: null,
        // hideButtons: false,
        // responsiveToContainer: true,
        excludeItems: [], // ['italic', 'bold'],
        // texts: {},
      },
      surfaces: {
        findReplace: true,
      },
      // Test custom context menu configuration
      contextMenu: {
        // defaultItems: true, // Include default items
        // sections: [
        //   {
        //     id: 'custom-section',
        //     items: [
        //       {
        //         id: 'show-context',
        //         label: 'Show Context',
        //         showWhen: (context) => context.trigger === 'click',
        //         render: (context) => {
        //           const container = document.createElement('div');
        //           container.style.display = 'flex';
        //           container.style.alignItems = 'center';
        //           container.innerHTML = `
        //             <span style="margin-right: 8px;">🔍</span>
        //             <span>Show Context</span>
        //           `;
        //           return container;
        //         },
        //         action: (editor, context) => {
        //           console.log('context', context);
        //         }
        //       },
        //       {
        //         id:'delete table',
        //         label: 'Delete Table',
        //         render: (context) => {
        //           const container = document.createElement('div');
        //           container.style.display = 'flex';
        //           container.style.alignItems = 'center';
        //           container.innerHTML = `
        //             <span style="margin-right: 8px;">🗑️</span>
        //             <span>Delete Table</span>
        //           `;
        //           return container;
        //         },
        //         action: (editor) => {
        //           editor.commands.deleteTable();
        //         },
        //         showWhen: (context) => context.isInTable
        //       },
        //       {
        //         id: 'highlight-text',
        //         label: 'Highlight Selection',
        //         showWhen: (context) => ['slash', 'click'].includes(context.trigger),
        //         render: (context) => {
        //           const container = document.createElement('div');
        //           container.style.display = 'flex';
        //           container.style.alignItems = 'center';
        //           container.innerHTML = `
        //             <span style="margin-right: 8px; color: #ffa500;">✨</span>
        //             <span>Highlight "${context.selectedText || 'text'}"</span>
        //           `;
        //           return container;
        //         },
        //         action: (editor) => {
        //           editor.commands.setHighlight('#ffff00');
        //         },
        //         showWhen: (context) => context.hasSelection
        //       },
        //       {
        //         id: 'insert-emoji',
        //         label: 'Insert Emoji',
        //         showWhen: (context) => (context.trigger === 'click' || context.trigger === 'slash') && context.hasSelection,
        //         render: (context) => {
        //           const container = document.createElement('div');
        //           container.style.display = 'flex';
        //           container.style.alignItems = 'center';
        //           container.innerHTML = `
        //             <span style="margin-right: 8px;">😀</span>
        //             <span>Insert Emoji</span>
        //           `;
        //           return container;
        //         },
        //         action: (editor) => {
        //           editor.commands.insertContent('¯\\_(ツ)_/¯');
        //         }
        //       },
        //     ]
        //   }
        // ],
        // // Alternative: use menuProvider function
        // // @todo: decide if we want to expose this in the documentation or not for simplicity?
        // menuProvider: (context, defaultSections) => {
        //   return [
        //     ...defaultSections,
        //     {
        //       id: 'dynamic-section',
        //       items: [
        //         {
        //           id: 'dynamic-item',
        //           label: `Custom for ${context.documentMode}`,
        //           showWhen: (context) => ['slash', 'click'].includes(context.trigger),
        //           action: (editor) => {
        //             editor.commands.insertContent(`Mode: ${context.documentMode} `);
        //           }
        //         }
        //       ]
        //     }
        //   ];
        // }

      },
      // 'hrbr-fields': {},

      ai: {
        // Provide your Harbour API key here for direct endpoint access
        // apiKey: 'test',
        // Optional: Provide a custom endpoint for AI services
        // endpoint: 'https://sd-dev-express-gateway-i6xtm.ondigitalocean.app/insights',

      },
      pdf: {
        pdfLib: pdfjsLib,
        setWorker: false,
        // workerSrc: getWorkerSrcFromCDN(pdfjsLib.version),
        // textLayer: true,
        // outputScale: 1.5,
      },
      ...(useWhiteboardModule
        ? {
            whiteboard: {
              enabled: true,
            },
          }
        : {}),
    },
    onEditorCreate,
    onTrackedChangesBulkDecision,
    onCollaborationReady,
    onAwarenessUpdate,
    onSourceSignalsComplete: () => {
      baseEditorSignalsReady.value = true;
    },
    onContentError,
    // handleImageUpload: async (file) => url,

    // Tracked change bubble button handlers - replace default accept/reject behavior
    // Only fires from bubble buttons, not toolbar or context menu
    // onTrackedChangeBubbleAccept: (comment, editor) => {
    //   console.log('Custom accept handler', comment);
    //   editor.commands.acceptTrackedChangeById(comment.commentId);
    // },
    // onTrackedChangeBubbleReject: (comment, editor) => {
    //   console.log('Custom reject handler', comment);
    //   editor.commands.rejectTrackedChangeById(comment.commentId);
    // },
    // Override icons.
    toolbarIcons: {},
  };

  superdoc.value = new SuperDoc(config);
  superdoc.value?.on('exception', (error) => {
    if (handleCollaborationException(error)) return;
    // SuperDoc Diagnostics MVP: the structured diagnostic payload is emitted IN ADDITION to whatever
    // legacy `exception` payload a given failure already produces, so this
    // handler fires once for each. Narrow with 'diagnosticCode in error' to
    // tell them apart -- upload a corrupt/non-DOCX file (e.g. a .docx that
    // isn't actually a zip) to see a PARSE_ERROR/unzip diagnostic here.
    if (error && typeof error === 'object' && 'diagnosticCode' in error) {
      console.warn(`[SuperDoc Diagnostics] ${error.diagnosticCode}`, {
        diagnosticCode: error.diagnosticCode,
        diagnosticStage: error.diagnosticStage,
        severity: error.severity,
        internalCode: error.internalCode,
        message: error.message,
        documentId: error.documentId ?? null,
        editor: error.editor ?? null,
        error: error.error,
      });
      return;
    }
    console.error('SuperDoc exception:', error);
  });

  superdoc.value?.on('zoomChange', ({ zoom }) => {
    currentZoom.value = zoom;
  });

  superdoc.value?.on('viewport-change', ({ availableWidth, documentWidth, fitZoom }) => {
    // Passive demo: custom consumers clamp and apply fitZoom themselves via
    // setZoom(). For automatic behavior, configure `zoom: { mode: 'fit-width' }`.
    console.log('[viewport-change]', { availableWidth, documentWidth, fitZoom });
  });

  window.superdoc = superdoc.value;
};

const onContentError = ({ error, documentId }) => {
  console.debug('Content error on', documentId, error);
};

const exportHTML = async () => {
  // Get HTML content from SuperDoc
  const htmlArray = superdoc.value.getHTML();
  const html = htmlArray.join('');

  // Create a Blob from the HTML
  const blob = new Blob([html], { type: 'text/html' });

  // Create a download link and trigger the download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${exportFileStem.value}.html`;

  // Trigger the download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL
  URL.revokeObjectURL(url);
};

const exportDocx = async (commentsType) => {
  console.debug('Exporting docx', { commentsType });
  await superdoc.value.export({ commentsType });
};

const exportDocxBlob = async () => {
  const blob = await superdoc.value.export({ commentsType: 'external', triggerDownload: false });
  downloadBlob(blob, `${exportFileStem.value}-blob.docx`);
};

const downloadBlob = (blob, fileName) => {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const onEditorCreate = ({ editor }) => {
  activeEditor.value = editor;
  window.editor = editor;

  if (typeof editor?.on !== 'function') {
    console.log('[SuperDoc Dev] v2 editor facade ready', editor);
    return;
  }

  // SD-2494: Pointer event observability for debugging trackpad/right-click selection issues
  editor.on('pointerDown', (params) => {
    console.log('pointerDown', { params });
  });

  editor.on('pointerUp', (params) => {
    console.log('pointerUp', { params });
  });

  editor.on('rightClick', (params) => {
    console.log('rightClick', { params });
  });
};

watch(selectedTheme, (theme) => {
  applyDevTheme(theme);
});

onMounted(async () => {
  applyDevTheme(selectedTheme.value);

  if (useCollaboration) {
    clearCollaborationEvents();
  }

  await init();
});

onBeforeUnmount(() => {
  applyDevTheme('default');
  dismissBulkDecisionToast();

  // Ensure SuperDoc tears down global listeners (e.g., DocumentRendererRuntime input bridge)
  superdoc.value?.destroy?.();
  superdoc.value = null;
  activeEditor.value = null;
  baseEditorSignalsReady.value = false;
  window.superdoc = null;
  window.editor = null;
});

const toggleLayoutEngine = () => {
  const nextValue = !useLayoutEngine.value;
  const url = new URL(window.location.href);
  url.searchParams.set('layout', nextValue ? '1' : '0');
  window.location.href = url.toString();
};

const toggleShowBookmarks = () => {
  showBookmarks.value = !showBookmarks.value;
  superdoc.value?.setShowBookmarks?.(showBookmarks.value);
};

const toggleViewLayout = () => {
  const nextValue = !useWebLayout.value;
  const url = new URL(window.location.href);
  url.searchParams.set('view', nextValue ? 'web' : 'print');
  window.location.href = url.toString();
};

const setReplacementMode = (mode) => {
  if (mode !== 'grouped' && mode !== 'separate') return;
  if (mode === trackChangesReplacementMode.value) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('replacements');
  if (mode === 'grouped') {
    url.searchParams.delete('replacementMode');
  } else {
    url.searchParams.set('replacementMode', mode);
  }
  window.location.href = url.toString();
};

const currentZoom = ref(100);
const ZOOM_STEP = 10;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

const zoomIn = () => {
  const next = Math.min(ZOOM_MAX, currentZoom.value + ZOOM_STEP);
  currentZoom.value = next;
  superdoc.value?.setZoom(next);
};

const zoomOut = () => {
  const next = Math.max(ZOOM_MIN, currentZoom.value - ZOOM_STEP);
  currentZoom.value = next;
  superdoc.value?.setZoom(next);
};
const showExportMenu = ref(false);
const closeExportMenu = () => {
  showExportMenu.value = false;
};

const sidebarOptions = [
  {
    id: 'off',
    label: 'Off',
    component: null,
  },
  {
    id: 'search',
    label: 'Search',
    component: SidebarSearch,
  },
  ...(useCollaboration
    ? [
        {
          id: 'collaboration',
          label: 'Collaboration',
          component: SidebarCollaboration,
        },
      ]
    : []),
  {
    id: 'layout',
    label: 'Layout',
    component: SidebarLayout,
  },
];
const activeSidebarId = ref('off');
const activeSidebar = computed(
  () => sidebarOptions.find((option) => option.id === activeSidebarId.value) ?? sidebarOptions[0],
);
const activeSidebarComponent = computed(() => activeSidebar.value?.component ?? null);
const activeSidebarLabel = computed(() => activeSidebar.value?.label ?? 'None');
const activeSidebarProps = computed(() => {
  if (activeSidebarId.value === 'layout') {
    return {
      useWebLayout: useWebLayout.value,
    };
  }

  if (activeSidebarId.value === 'collaboration') {
    return {
      events: collaborationEvents.value,
      providerStatus: collaborationProviderStatus.value,
      collabRoom,
      roomMode: collabRoomMode.value,
    };
  }

  return {};
});
const showSidebarMenu = ref(false);
const closeSidebarMenu = () => {
  showSidebarMenu.value = false;
};
const setActiveSidebar = (id) => {
  activeSidebarId.value = id;
  closeSidebarMenu();
};

// Scroll test mode - adds content above editor to make page scrollable (for testing focus scroll bugs)
const scrollTestMode = ref(urlParams.get('scrolltest') === '1');

// Debug: Track all scroll changes when in scroll test mode
if (scrollTestMode.value) {
  let lastScrollY = 0;
  window.addEventListener('scroll', () => {
    if (Math.abs(window.scrollY - lastScrollY) > 10) {
      console.log('[SCROLL-DEBUG] Scroll changed:', lastScrollY, '→', window.scrollY);
      console.trace('[SCROLL-DEBUG] Stack trace:');
      lastScrollY = window.scrollY;
    }
  });

  // Also intercept scrollTo calls
  const originalScrollTo = window.scrollTo.bind(window);
  window.scrollTo = function (...args) {
    console.log('[SCROLL-DEBUG] scrollTo called:', args);
    console.trace('[SCROLL-DEBUG] scrollTo stack:');
    return originalScrollTo(...args);
  };
}
</script>

<template>
  <div class="dev-app" :class="{ 'dev-app--scroll-test': scrollTestMode }">
    <div
      v-if="bulkDecisionToast"
      class="dev-app__bulk-decision-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>{{ bulkDecisionToast }}</span>
      <button type="button" aria-label="Dismiss notification" @click="dismissBulkDecisionToast">×</button>
    </div>
    <div class="dev-app__layout">
      <div v-if="!headerCollapsed" class="dev-app__header">
        <button class="dev-app__header-toggle" title="Hide header" @click="headerCollapsed = true">▲</button>
        <div class="dev-app__brand">
          <div class="dev-app__logo">
            <img :src="superdocLogo" alt="SuperDoc logo" />
          </div>
          <div class="dev-app__brand-meta">
            <div class="dev-app__meta-row">
              <span class="dev-app__pill">SUPERDOC LABS</span>
            </div>
            <h2 class="dev-app__title">SuperDoc Dev</h2>
            <div class="dev-app__header-layout-toggle">
              <div class="dev-app__upload-control">
                <div class="dev-app__upload-button">
                  <span class="dev-app__upload-btn">Upload file</span>
                  <BasicUpload class="dev-app__upload-input" @file-change="handleNewFile" />
                </div>
                <span class="dev-app__upload-filename">{{ uploadDisplayName }}</span>
              </div>
              <div class="dev-app__url-control">
                <input
                  v-model="documentUrl"
                  type="text"
                  class="dev-app__url-input"
                  placeholder="Paste document URL..."
                  @keydown.enter="handleLoadFromUrl"
                />
                <button
                  class="dev-app__url-btn"
                  :disabled="isLoadingUrl || !documentUrl.trim()"
                  @click="handleLoadFromUrl"
                >
                  {{ isLoadingUrl ? 'Loading...' : 'Load URL' }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="dev-app__header-actions">
          <div class="dev-app__header-buttons">
            <label class="dev-app__theme-control">
              <span>Theme</span>
              <select v-model="selectedTheme" class="dev-app__theme-select">
                <option value="default">Default</option>
                <option value="docs">Docs</option>
                <option value="word">Word</option>
                <option value="blueprint">Blueprint</option>
                <option value="neon-night">Neon Night</option>
              </select>
            </label>
            <label class="dev-app__theme-control" title="Tracked replacement model (reloads on change)">
              <span>Tracked replacements</span>
              <select
                :value="trackChangesReplacementMode"
                class="dev-app__theme-select"
                @change="setReplacementMode($event.target.value)"
              >
                <option value="grouped">Grouped</option>
                <option value="separate">Separate</option>
              </select>
            </label>
            <div class="dev-app__dropdown" @mouseleave="closeSidebarMenu">
              <button
                class="dev-app__header-export-btn dev-app__dropdown-trigger"
                :class="{ 'is-open': showSidebarMenu }"
                @click="showSidebarMenu = !showSidebarMenu"
              >
                <span>Sidebar: {{ activeSidebarLabel }}</span>
                <span class="caret">▾</span>
              </button>
              <div v-if="showSidebarMenu" class="dev-app__dropdown-menu">
                <button
                  v-for="option in sidebarOptions"
                  :key="option.id"
                  class="dev-app__dropdown-item"
                  @click="setActiveSidebar(option.id)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="dev-app__dropdown" @mouseleave="closeExportMenu">
              <button
                class="dev-app__header-export-btn dev-app__dropdown-trigger"
                :class="{ 'is-open': showExportMenu }"
                @click="showExportMenu = !showExportMenu"
              >
                <span>Export</span>
                <span class="caret">▾</span>
              </button>
              <div v-if="showExportMenu" class="dev-app__dropdown-menu">
                <button
                  class="dev-app__dropdown-item"
                  @click="
                    exportHTML();
                    closeExportMenu();
                  "
                >
                  Export HTML
                </button>
                <button
                  class="dev-app__dropdown-item"
                  @click="
                    exportDocx();
                    closeExportMenu();
                  "
                >
                  Export Docx
                </button>
                <button
                  class="dev-app__dropdown-item"
                  @click="
                    exportDocx('clean');
                    closeExportMenu();
                  "
                >
                  Export clean Docx
                </button>
                <button
                  class="dev-app__dropdown-item"
                  @click="
                    exportDocx('external');
                    closeExportMenu();
                  "
                >
                  Export external Docx
                </button>
                <button
                  class="dev-app__dropdown-item"
                  @click="
                    exportDocxBlob();
                    closeExportMenu();
                  "
                >
                  Export Docx Blob
                </button>
              </div>
            </div>
            <div class="dev-app__zoom-controls">
              <button class="dev-app__header-export-btn" @click="zoomOut">−</button>
              <span class="dev-app__zoom-label">{{ currentZoom }}%</span>
              <button class="dev-app__header-export-btn" @click="zoomIn">+</button>
            </div>
            <div class="dev-app__compare-control">
              <button
                class="dev-app__header-export-btn"
                :disabled="!canCompareDocuments"
                :title="compareButtonTitle"
                @click="handleCompareClick"
              >
                Compare documents
              </button>
              <input
                ref="compareInput"
                class="dev-app__compare-input"
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                @change="handleCompareFile"
              />
            </div>
            <button class="dev-app__header-export-btn" @click="toggleShowBookmarks">
              {{ showBookmarks ? 'Hide' : 'Show' }} bookmarks
            </button>
            <button class="dev-app__header-export-btn" @click="toggleLayoutEngine">
              Turn Layout Engine {{ useLayoutEngine ? 'off' : 'on' }} (reloads)
            </button>
          </div>
        </div>
      </div>

      <!-- Spacer to push content down and make page scrollable (for testing focus scroll bugs) -->
      <div v-if="scrollTestMode" class="dev-app__scroll-test-spacer">
        <div class="dev-app__scroll-test-notice">
          <strong>⚠️ SCROLL TEST MODE</strong>
          <p>
            Scroll down to see the editor. This mode tests that clicking/typing in the editor doesn't cause page jumps.
          </p>
          <p>If clicking or typing causes the page to scroll back up here, the bug is present.</p>
        </div>
      </div>

      <button v-if="headerCollapsed" class="dev-app__header-show" title="Show header" @click="headerCollapsed = false">
        ▼ SuperDoc Dev
      </button>
      <div class="dev-app__toolbar-ruler-container">
        <div id="toolbar" class="sd-toolbar"></div>
        <div id="ruler-container" class="sd-ruler"></div>
      </div>

      <div class="dev-app__main">
        <div class="dev-app__view">
          <div class="dev-app__content">
            <div class="dev-app__content-container" :class="{ 'dev-app__content-container--web-layout': useWebLayout }">
              <div id="superdoc"></div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="activeSidebarComponent" class="dev-app__sidebar">
        <div class="dev-app__sidebar-content">
          <component
            :is="activeSidebarComponent"
            :key="`${activeSidebarId}-${sidebarInstanceKey}`"
            v-bind="activeSidebarProps"
            @close="setActiveSidebar('off')"
            @toggle-web-layout="toggleViewLayout"
            @clear-collaboration-events="clearCollaborationEvents"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.dev-app__toolbar-ruler-container {
  position: sticky;
  top: 0;
  z-index: 100;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.sd-toolbar {
  width: 100%;
  background: white;
  position: relative;
  z-index: 1;
}

.sd-ruler {
  display: flex;
  justify-content: center;
  background: #f5f5f5;
  border-top: 1px solid #e0e0e0;
  padding: 0;
  min-height: 25px;
}

/* Hide the ruler container only when it is truly empty. The v1 editor mounts a
   `.ruler` root; the v2 shell teleports a `.v2-ruler-host` instead, so recognize
   both — otherwise the v2 ruler renders into a `display: none` container. */
.sd-ruler:not(:has(.ruler)):not(:has(.v2-ruler-host)) {
  display: none;
}

@media screen and (max-width: 1024px) {
  .superdoc {
    max-width: calc(100vw - 10px);
  }
}
</style>

<style scoped>
#superdoc {
  display: flex;
  justify-content: center;
  width: 100%;
}

.dev-app {
  background-color: #b9bfce;
  --header-height: 154px;
  --toolbar-height: 39px;

  width: 100%;
  height: 100vh;
}

.dev-app__bulk-decision-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, calc(100% - 32px));
  padding: 12px 16px;
  transform: translateX(-50%);
  border: 1px solid #cbd5e1;
  border-left: 4px solid #1355ff;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
  color: #212121;
  font:
    14px/20px Inter,
    sans-serif;
}

.dev-app__bulk-decision-toast button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.dev-app__layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  position: relative;
}

.dev-app__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  background-color: #0f172a;
  color: #e2e8f0;
  padding: 24px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  position: relative;
  z-index: 120;
}

.dev-app__header-toggle {
  position: absolute;
  right: 12px;
  top: 8px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  z-index: 1;
}

.dev-app__header-toggle:hover {
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.1);
}

.dev-app__header-show {
  background: #0f172a;
  color: #94a3b8;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  font-size: 11px;
  padding: 4px 16px;
  text-align: center;
  width: 100%;
}

.dev-app__header-show:hover {
  color: #e2e8f0;
  background: #1e293b;
}

.dev-app__header::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 12px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.7), rgba(15, 23, 42, 0));
  pointer-events: none;
}

.dev-app__brand {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1 1 auto;
}

.dev-app__logo {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  overflow: hidden;
  background: radial-gradient(circle at 30% 30%, #38bdf8, #6366f1);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.dev-app__logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 14px;
}

.dev-app__brand-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dev-app__pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
  font-weight: 600;
  letter-spacing: 0.08em;
  font-size: 10px;
  width: fit-content;
}

.dev-app__meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dev-app__title {
  margin: 0;
  color: #f8fafc;
  font-size: 22px;
  line-height: 1.2;
}

.dev-app__subtitle {
  margin: 0;
  color: #cbd5e1;
  font-size: 14px;
}

.dev-app__header-layout-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.dev-app__upload-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.dev-app__upload-label {
  color: #cbd5e1;
  font-size: 13px;
}

.dev-app__upload-control {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.dev-app__upload-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.dev-app__upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.2);
  color: #e2e8f0;
  border: 1px solid rgba(59, 130, 246, 0.35);
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.4);
}

.dev-app__upload-btn:hover {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.5);
}

.dev-app__upload-input {
  position: absolute;
  inset: 0;
}

:deep(.dev-app__upload-input input[type='file']) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  appearance: none;
  border: none;
  background: transparent;
  color: transparent;
  z-index: 2;
}

.dev-app__upload-hint {
  color: #94a3b8;
  font-size: 12px;
}

.dev-app__url-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.dev-app__url-input {
  flex: 1;
  min-width: 280px;
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  font-size: 13px;
}

.dev-app__url-input::placeholder {
  color: #64748b;
}

.dev-app__url-input:focus {
  outline: none;
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(15, 23, 42, 0.8);
}

.dev-app__url-btn {
  padding: 8px 14px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.2);
  color: #e2e8f0;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
  white-space: nowrap;
}

.dev-app__url-btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
}

.dev-app__url-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dev-app__header-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-end;
}

.dev-app__header-upload {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dev-app__upload-label {
  color: #cbd5e1;
  font-size: 14px;
}

.dev-app__header-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.dev-app__header-export-btn {
  background: rgba(148, 163, 184, 0.12);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.2);
  padding: 8px 12px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.1s ease;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.25);
}

.dev-app__header-export-btn:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.2);
  border-color: rgba(148, 163, 184, 0.35);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.28);
}

.dev-app__header-export-btn:active:not(:disabled) {
  transform: translateY(1px);
  background: rgba(148, 163, 184, 0.28);
}

.dev-app__header-export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.dev-app__zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dev-app__theme-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #e2e8f0;
  font-size: 12px;
  margin-right: 6px;
}

.dev-app__theme-select {
  background: rgba(148, 163, 184, 0.12);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
}

.dev-app__theme-select:focus {
  outline: none;
  border-color: rgba(147, 197, 253, 0.75);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}

.dev-app__theme-select option {
  color: #111827;
}

.dev-app__zoom-controls .dev-app__header-export-btn {
  min-width: 32px;
  padding: 6px 8px;
  font-size: 16px;
  font-weight: 600;
}

.dev-app__zoom-label {
  color: #e2e8f0;
  font-size: 13px;
  min-width: 42px;
  text-align: center;
  user-select: none;
}

.dev-app__dropdown {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.dev-app__dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dev-app__dropdown-trigger .caret {
  display: inline-block;
  transition: transform 0.15s ease;
}

.dev-app__dropdown-trigger.is-open .caret {
  transform: rotate(180deg);
}

.dev-app__dropdown-menu {
  position: absolute;
  top: 105%;
  right: 0;
  min-width: 180px;
  background: #0b1221;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  padding: 6px;
  z-index: 200;
  display: grid;
  gap: 4px;
}

.dev-app__dropdown-item {
  background: transparent;
  color: #e2e8f0;
  border: 1px solid transparent;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: left;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.dev-app__dropdown-item:hover {
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.25);
}

.dev-app__compare-control {
  display: inline-flex;
  align-items: center;
}

.dev-app__compare-input {
  display: none;
}

.dev-app__main {
  display: flex;
  justify-content: center;
  overflow: auto;
  /* Test: creates a containing block for position:fixed elements (like context menu) */
  backdrop-filter: blur(0.5px);
}

.dev-app__sidebar {
  position: absolute;
  top: 0;
  right: 0;
  height: 100vh;
  width: 350px;
  max-width: 350px;
  background: #f8fafc;
  border-left: 1px solid rgba(15, 23, 42, 0.12);
  box-shadow: -12px 0 28px rgba(15, 23, 42, 0.2);
  z-index: 200;
  display: flex;
  flex-direction: column;
}

.dev-app__sidebar-content {
  flex: 1 1 auto;
  overflow: auto;
  padding: 16px;
}

.dev-app__view {
  display: flex;
  padding-top: 20px;
  width: 100%;
}

.dev-app__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.dev-app__content-container {
  width: 100%;
  /* width: auto; */
}

/* Web layout mode: dev app container styling */
.dev-app__content-container--web-layout {
  width: 100%;
  max-width: 100%;
  padding: 0 16px;
  box-sizing: border-box;
  overflow-x: hidden;
}

/* Web layout mode: prevent centering to allow full-width layout */
.dev-app__content:has(.dev-app__content-container--web-layout) {
  align-items: stretch;
}

.dev-app__view:has(.dev-app__content-container--web-layout) {
  width: 100%;
}

.dev-app__main:has(.dev-app__content-container--web-layout) {
  overflow-x: hidden;
}

.dev-app__inputs-panel {
  display: grid;
  height: calc(100vh - var(--header-height) - var(--toolbar-height));
  background: #fff;
  border-right: 1px solid #dbdbdb;
}

.dev-app__inputs-panel-content {
  display: grid;
  overflow-y: auto;
  scrollbar-width: none;
}

/* Scroll Test Mode - makes page scrollable to test focus scroll bugs */
.dev-app--scroll-test {
  height: auto;
  min-height: 100vh;
}

.dev-app--scroll-test .dev-app__layout {
  height: auto;
  min-height: 100vh;
}

.dev-app--scroll-test .dev-app__main {
  overflow: visible;
}

.dev-app__scroll-test-spacer {
  height: 120vh;
  background: linear-gradient(180deg, #1e293b 0%, #334155 50%, #475569 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dev-app__scroll-test-notice {
  background: rgba(251, 191, 36, 0.15);
  border: 2px solid rgba(251, 191, 36, 0.5);
  border-radius: 12px;
  padding: 24px 32px;
  max-width: 500px;
  text-align: center;
  color: #fcd34d;
}

.dev-app__scroll-test-notice strong {
  font-size: 18px;
  display: block;
  margin-bottom: 12px;
}

.dev-app__scroll-test-notice p {
  margin: 8px 0;
  font-size: 14px;
  line-height: 1.5;
  color: #fde68a;
}

/* Mobile responsive styles */
@media screen and (max-width: 768px) {
  .dev-app {
    --header-height: auto;
    overflow-x: hidden;
  }

  .dev-app__layout {
    overflow-x: hidden;
  }

  .dev-app__header {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    padding: 16px;
  }

  .dev-app__brand {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .dev-app__logo {
    width: 48px;
    height: 48px;
  }

  .dev-app__title {
    font-size: 18px;
  }

  .dev-app__meta-row {
    flex-wrap: wrap;
    gap: 6px;
  }

  .dev-app__header-actions {
    align-items: stretch;
    width: 100%;
  }

  .dev-app__header-buttons {
    flex-direction: column;
    gap: 8px;
  }

  .dev-app__header-export-btn {
    width: 100%;
    text-align: center;
  }

  .dev-app__upload-control {
    flex-direction: column;
    align-items: stretch;
  }

  .dev-app__url-form {
    flex-direction: column;
  }

  .dev-app__url-input {
    width: 100%;
  }

  .dev-app__main {
    overflow-x: hidden;
  }

  .dev-app__view {
    padding-top: 10px;
    overflow-x: hidden;
  }
}
</style>
