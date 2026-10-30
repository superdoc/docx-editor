import { defineComponent, h, onMounted, type Component } from 'vue';
import { isSyntheticTrackedChangeCommentLaneItem } from '../../helpers/tracked-change-comment-lane.js';
import { isPlainObject } from '../../helpers/object-guards.js';

export interface V2GeometryPublishOptions {
  retainMissingTrackedChangeGeometry?: boolean;
  retainedTrackedChangeIds?: Iterable<string>;
  reason?: string;
}

export interface V2GeometryPayload {
  mountContainer: HTMLElement | null;
  epoch?: number | null;
  host?: unknown;
  mount?: unknown;
}

export type V2CommittedPageWindow = Readonly<Record<string, unknown>>;

export interface V2GeometryPublisherOptions {
  getLayersContainer: () => HTMLElement | null;
  isCommentsEnabled: () => boolean;
  publishPositions: (positions: Record<string, unknown>, options?: V2GeometryPublishOptions) => void;
  clearPositions: () => void;
  readCurrentPositions?: () => Record<string, unknown>;
  setGeometryAvailable?: (value: boolean) => void;
}

export interface V2GeometryPublisher {
  publish(payload: V2GeometryPayload | null, options?: V2GeometryPublishOptions): Promise<void> | void;
  recollect(options?: V2GeometryPublishOptions): Promise<void> | void;
  noteCommittedPageWindow?(window: V2CommittedPageWindow | null | undefined): void;
  reset(): void;
  getLastEpoch(): number | null;
  getLastPayload(): V2GeometryPayload | null;
}

export interface V2ReviewWindowContext {
  superdoc: unknown;
  documentId: string;
  commentsAdapter: unknown;
  trackedChangesAdapter: unknown;
  resolveReviewWindow: (input: unknown) => unknown;
  moveFragmentWordIds: (ids: readonly string[]) => unknown;
}

export interface V2ReviewWindowResult {
  comments?: {
    items?: readonly unknown[];
    requestedIds?: readonly string[];
    unresolvedCommentIds?: readonly string[];
  };
  trackedChanges?: {
    items?: readonly unknown[];
    requestedIds?: readonly string[];
    unresolvedTargets?: readonly unknown[];
  };
  preparedReview?: unknown;
}

export interface V2ReviewWindowControllerOptions {
  applyReviewWindow?: ((context: V2ReviewWindowContext, result: V2ReviewWindowResult) => unknown) | null;
}

export interface V2ReviewMutationSettlement {
  outcome: 'aborted' | 'rejected' | 'committed';
  allResolved?: boolean;
  resumeDomains?: readonly ('comments' | 'trackedChanges')[];
  trackedRowCount?: number | null;
}

export interface V2ReviewWindowSnapshot {
  readonly status: 'pending' | 'ready' | 'stale';
  readonly [field: string]: unknown;
}

export interface V2ReviewWindowDiagnostics {
  generation: number;
  reviewEpoch: number;
  hasContext: boolean;
  inFlight: boolean;
  queued: boolean;
  mutationPaused: boolean;
  records: readonly Record<string, unknown>[];
}

export interface V2ReviewWindowController {
  setContext(context: V2ReviewWindowContext | null): void;
  onCommittedPagePaint?(commit: V2CommittedPageWindow): void;
  refreshCommittedWindow(reason?: string): void;
  invalidate(reason?: string): void;
  beginMutation(fact: string | { token?: string } | null | undefined): void;
  settleMutation(token: string | undefined, settlement?: V2ReviewMutationSettlement): void;
  reset(reason?: string): void;
  getSnapshot?(): V2ReviewWindowSnapshot | null;
  subscribe?(listener: (snapshot: V2ReviewWindowSnapshot) => void): () => void;
  getDiagnostics(): V2ReviewWindowDiagnostics | null;
}

export interface SuperDocV2Integration {
  version: number;
  capabilities: unknown;
  EditorComponent: Component;
  RulerComponent: Component | null;
  createGeometryPublisher: (options: V2GeometryPublisherOptions) => V2GeometryPublisher;
  createReviewWindowController: (options: V2ReviewWindowControllerOptions) => V2ReviewWindowController;
  isSyntheticTrackedChangeCommentLaneItem: (value: unknown) => boolean;
  isV2SyntheticTrackedChangeRow: (value: unknown) => boolean;
}

let engineModuleLoader: () => Promise<unknown> = () => import('@superdoc/docx-engine');
let engineModulePromise: Promise<void> | null = null;
let createSuperDocV2Integration: (() => unknown) | null = null;

export function configureDefaultV2IntegrationLoader(loader: () => Promise<unknown>): void {
  if (typeof loader !== 'function') {
    throw new TypeError('SuperDoc: the DOCX Engine loader must be a function');
  }
  if (engineModulePromise) {
    throw new Error('SuperDoc: the DOCX Engine loader cannot change after loading has started');
  }
  engineModuleLoader = loader;
}

export async function loadDefaultV2Integration(): Promise<void> {
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
        createSuperDocV2Integration = (): unknown => factory();
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

export async function loadDefaultV2IntegrationOrFallback(): Promise<void> {
  try {
    await loadDefaultV2Integration();
  } catch (error) {
    console.error('[SuperDoc] DOCX Engine failed to load; using the stub.', error);
  }
}

export const SUPERDOC_V2_INTEGRATION_VERSION = 1;

const V2_BODY_TRACKED_CHANGE_ANCHOR_PREFIX = 'tc::body::';

export { isSyntheticTrackedChangeCommentLaneItem };

export function isV2SyntheticTrackedChangeRow(row: unknown): boolean {
  if (!isPlainObject(row) || row.trackedChange !== true) return false;
  const anchorKey = row.trackedChangeAnchorKey;
  return typeof anchorKey === 'string' && anchorKey.startsWith(V2_BODY_TRACKED_CHANGE_ANCHOR_PREFIX);
}

function createStubGeometryPublisher(): V2GeometryPublisher {
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

function createStubReviewWindowController(): V2ReviewWindowController {
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

export function createStubV2Integration(): SuperDocV2Integration {
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

function adoptEngineIntegration(engineIntegration: unknown): SuperDocV2Integration {
  const stub = createStubV2Integration();
  if (!isPlainObject(engineIntegration) || !engineIntegration.EditorComponent) return stub;
  const engine = engineIntegration as Partial<SuperDocV2Integration>;
  return {
    version: typeof engine.version === 'number' ? engine.version : stub.version,
    capabilities: engine.capabilities ?? stub.capabilities,
    EditorComponent: engine.EditorComponent ?? stub.EditorComponent,
    RulerComponent: engine.RulerComponent ?? stub.RulerComponent,
    createGeometryPublisher: engine.createGeometryPublisher ?? stub.createGeometryPublisher,
    createReviewWindowController: engine.createReviewWindowController ?? stub.createReviewWindowController,
    isSyntheticTrackedChangeCommentLaneItem:
      engine.isSyntheticTrackedChangeCommentLaneItem ?? stub.isSyntheticTrackedChangeCommentLaneItem,
    isV2SyntheticTrackedChangeRow: engine.isV2SyntheticTrackedChangeRow ?? stub.isV2SyntheticTrackedChangeRow,
  };
}

export function createDefaultV2Integration(): SuperDocV2Integration {
  if (!createSuperDocV2Integration) return createStubV2Integration();

  try {
    return adoptEngineIntegration(createSuperDocV2Integration());
  } catch (error) {
    console.error('[SuperDoc] DOCX Engine integration failed to construct; using the stub.', error);
    return createStubV2Integration();
  }
}

export function hasRealV2Integration(integration: SuperDocV2Integration | null | undefined): boolean {
  return Boolean(integration && integration.EditorComponent && integration.EditorComponent !== StubV2EditorComponent);
}
