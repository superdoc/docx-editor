// Internal V2 integration module.
//
// On the v2 branch the customer `superdoc` package IS the v2 editor. The v2
// runtime is consumed through the stable `@superdoc/docx-engine` contract
// (entry `@superdoc/docx-engine`). In package mode this resolves to the
// installed engine package. In Orbit source mode it aliases to local v2 source
// for HMR. Internal implementation packages never become SuperDoc dependencies
// or exports.
//
// There is no customer-facing runtime selection: `config.editorVersion` and
// `config.editorIntegration` were removed. This module owns the single default
// integration the runtime always uses. The local stub remains only as a
// defensive fallback for environments where the v2 shell cannot be
// constructed (e.g. a non-DOM context); it never selects v1.

import { defineComponent, h, onMounted } from 'vue';
import { installWebKitCollapsedCaretRectFix } from './webkit-collapsed-caret-rect.js';
/** @type {() => Promise<unknown>} */
let engineModuleLoader = () => import('@superdoc/docx-engine');
/** @type {Promise<void> | null} */
let engineModulePromise = null;
/** @type {((...args: unknown[]) => unknown) | null} */
let createSuperDocV2Integration = null;

/**
 * Replace the package loader before engine loading starts. The CDN entry uses
 * this seam to fetch the exact engine version from its public package URL.
 *
 * @param {() => Promise<unknown>} loader
 */
export function configureDefaultV2IntegrationLoader(loader) {
  if (typeof loader !== 'function') {
    throw new TypeError('SuperDoc: the DOCX Engine loader must be a function');
  }
  if (engineModulePromise) {
    throw new Error('SuperDoc: the DOCX Engine loader cannot change after loading has started');
  }
  engineModuleLoader = loader;
}

/** Load the engine before Vue evaluates the synchronous integration seam. */
export async function loadDefaultV2Integration() {
  // Every distribution mode reaches the engine through this function, so it is
  // the one place that guarantees the workaround is installed before the engine
  // can paint a caret. The quirk probe measures a throwaway element of its own,
  // so no editor document has to exist yet. It never throws: a caret nicety must
  // not be able to reject this promise and drop the editor to its stub.
  if (typeof window !== 'undefined') installWebKitCollapsedCaretRectFix(window);
  if (!engineModulePromise) {
    const loadPromise = Promise.resolve()
      .then(() => engineModuleLoader())
      .then((module) => {
        const factory =
          module && typeof module === 'object' && 'createSuperDocV2Integration' in module
            ? module.createSuperDocV2Integration
            : null;
        if (typeof factory !== 'function') {
          throw new TypeError('SuperDoc: the DOCX Engine module does not export createSuperDocV2Integration');
        }
        createSuperDocV2Integration = factory;
      });
    engineModulePromise = loadPromise;
    void loadPromise.catch(() => {
      if (engineModulePromise === loadPromise) {
        engineModulePromise = null;
        createSuperDocV2Integration = null;
      }
    });
  }
  await engineModulePromise;
}

/** Load the engine for editor startup, preserving the fail-closed stub on failure. */
export async function loadDefaultV2IntegrationOrFallback() {
  try {
    await loadDefaultV2Integration();
  } catch (error) {
    console.error('[SuperDoc] DOCX Engine failed to load; using the stub.', error);
  }
}

/**
 * @typedef {Object} SuperDocV2Integration
 * @property {number} version Integration contract version.
 * @property {unknown} [capabilities] Optional capability snapshot/hints.
 * @property {unknown} EditorComponent Vue component that boots the V2 DOCX editor.
 * @property {unknown} [RulerComponent] Optional Vue component for the V2 ruler.
 * @property {(...args: unknown[]) => unknown} [createGeometryPublisher] Factory for the V2 geometry publisher.
 * @property {(...args: unknown[]) => unknown} [createReviewWindowController] Factory for the committed V2 review-window controller.
 * @property {(value: unknown) => boolean} [isSyntheticTrackedChangeCommentLaneItem] Predicate for synthetic tracked-change comment-lane items.
 * @property {(value: unknown) => boolean} [isV2SyntheticTrackedChangeRow] Predicate for synthesized V2 tracked-change rows.
 */

/** Default version for the local stub integration (V1-compatible). */
export const SUPERDOC_V2_INTEGRATION_VERSION = 1;

const V2_SYNTHETIC_TRACKED_CHANGE_COMMENT_ID_PREFIX = 'tc-comment:';
const V2_BODY_TRACKED_CHANGE_ANCHOR_PREFIX = 'tc::body::';

/**
 * @param {unknown} item
 * @returns {boolean}
 */
export function isSyntheticTrackedChangeCommentLaneItem(item) {
  if (!item || typeof item !== 'object') return false;
  const id = item.id ?? item.commentId;
  if (typeof id !== 'string') return false;
  return id.startsWith(V2_SYNTHETIC_TRACKED_CHANGE_COMMENT_ID_PREFIX);
}

/**
 * @param {{ trackedChange?: unknown, trackedChangeAnchorKey?: unknown } | null | undefined} row
 * @returns {boolean}
 */
export function isV2SyntheticTrackedChangeRow(row) {
  if (!row || row.trackedChange !== true) return false;
  const anchorKey = row.trackedChangeAnchorKey;
  return typeof anchorKey === 'string' && anchorKey.startsWith(V2_BODY_TRACKED_CHANGE_ANCHOR_PREFIX);
}

function createStubGeometryPublisher() {
  return {
    publish() {},
    recollect() {},
    reset() {},
    getLastEpoch() {
      return null;
    },
    getLastPayload() {
      return null;
    },
  };
}

function createStubReviewWindowController() {
  return {
    setContext() {},
    onCommittedPagePaint() {},
    refreshCommittedWindow() {},
    invalidate() {},
    beginMutation() {},
    settleMutation() {},
    reset() {},
    getSnapshot() {
      return null;
    },
    subscribe() {
      return () => undefined;
    },
    getDiagnostics() {
      return null;
    },
  };
}

const StubV2EditorComponent = defineComponent({
  name: 'SuperDocV2IntegrationMissing',
  emits: ['v2-editor-failed'],
  setup(_props, { emit }) {
    onMounted(() => {
      emit('v2-editor-failed', {
        reason: 'v2-integration-unavailable',
        detail: 'SuperDoc: the DOCX Engine runtime could not be constructed in this environment.',
      });
    });
    return () => h('div', { class: 'superdoc-v2-integration-missing' });
  },
});

/**
 * @returns {SuperDocV2Integration}
 */
export function createStubV2Integration() {
  return {
    version: SUPERDOC_V2_INTEGRATION_VERSION,
    capabilities: null,
    EditorComponent: StubV2EditorComponent,
    RulerComponent: null,
    createGeometryPublisher: createStubGeometryPublisher,
    createReviewWindowController: createStubReviewWindowController,
    isSyntheticTrackedChangeCommentLaneItem,
    isV2SyntheticTrackedChangeRow,
  };
}

/**
 * Build the default v2 integration the runtime always uses. The v2
 * browser shell is the only source of the editor runtime; no customer-provided
 * integration is consulted. Falls back to the local stub only if the engine
 * shell throws during construction (defensive, never selects v1).
 *
 * @returns {SuperDocV2Integration}
 */
export function createDefaultV2Integration() {
  if (!createSuperDocV2Integration) return createStubV2Integration();

  try {
    const stub = createStubV2Integration();
    const integration = /** @type {SuperDocV2Integration} */ (createSuperDocV2Integration());
    if (!integration || typeof integration !== 'object' || !integration.EditorComponent) {
      return stub;
    }
    return {
      version: typeof integration.version === 'number' ? integration.version : stub.version,
      capabilities: integration.capabilities ?? stub.capabilities,
      EditorComponent: integration.EditorComponent,
      RulerComponent: integration.RulerComponent ?? stub.RulerComponent,
      createGeometryPublisher: integration.createGeometryPublisher ?? stub.createGeometryPublisher,
      createReviewWindowController: integration.createReviewWindowController ?? stub.createReviewWindowController,
      isSyntheticTrackedChangeCommentLaneItem:
        integration.isSyntheticTrackedChangeCommentLaneItem ?? stub.isSyntheticTrackedChangeCommentLaneItem,
      isV2SyntheticTrackedChangeRow: integration.isV2SyntheticTrackedChangeRow ?? stub.isV2SyntheticTrackedChangeRow,
    };
  } catch (error) {
    console.error('[SuperDoc] DOCX Engine integration failed to construct; using the stub.', error);
    return createStubV2Integration();
  }
}

/**
 * Backwards-compatible alias. The v2 branch no longer reads any customer
 * config; the parameter is ignored and retained only so existing call sites do
 * not need to change in lockstep with this internalization.
 *
 * @returns {SuperDocV2Integration}
 */
export function resolveV2Integration() {
  return createDefaultV2Integration();
}

/**
 * @param {SuperDocV2Integration | null | undefined} integration
 * @returns {boolean}
 */
export function hasRealV2Integration(integration) {
  return Boolean(integration && integration.EditorComponent && integration.EditorComponent !== StubV2EditorComponent);
}
