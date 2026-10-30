import { createDocumentLoadScope } from '../core/helpers/document-load.js';
import { defineStore } from 'pinia';
import { ref, reactive, computed, markRaw } from 'vue';
import type { Ref } from 'vue';
import type { MimeType } from '@superdoc/common';
import { v4 as uuidv4 } from 'uuid';
import { useCommentsStore } from './comments-store';
import { getFileObject, DOCX, PDF, HTML } from '@superdoc/common';
import { normalizeDocumentEntry } from '../core/helpers/file.js';
import { isFiniteNumber } from '../helpers/is-finite-number.js';
import useDocument from '../composables/use-document.js';
import BlankDOCX from '@superdoc/common/data/blank.docx?url';
import type {
  InternalConfig,
  Modules,
  RuntimeDocument,
  SuperDocExceptionStorePayload,
  SuperDocMeasurementUnit,
  SuperDocViewportMetrics,
  SuperDocZoomMode,
  User,
} from '../core/types/index.js';

type DocumentLoadScope = NonNullable<ReturnType<typeof createDocumentLoadScope>>;

type PageEntry = {
  page: number;
  containerBounds?: unknown;
  container?: Element | null;
};

type StoreDocument = RuntimeDocument &
  Required<Pick<RuntimeDocument, 'getEditor' | 'getDocumentRuntime'>> & {
    isReady: boolean;
    pageContainers: PageEntry[];
  };

type StoreDocumentSource = RuntimeDocument & {
  html?: string;
  markdown?: string;
};

type StoreExceptionPayload = SuperDocExceptionStorePayload & {
  code?: string;
  documentId?: string;
};

type StoreExceptionHandler = (payload: SuperDocExceptionStorePayload) => void;

type ActiveSelection = {
  documentId?: string | number | null;
  [key: string]: unknown;
};

type SelectionPosition = {
  left: number;
  top: number;
  width?: number;
  height?: number;
  right?: number;
  bottom?: number;
  startX?: number;
  startY?: number;
  page?: number | null;
  source: string | null;
};

// Default measurement unit for rulers and measurement fields (Word's en-US
// default). Shared by init() and reset() so a fresh load always starts at
// inches, even after a prior document switched to cm.
const DEFAULT_MEASUREMENT_UNIT = 'in';

export const useSuperdocStore = defineStore('superdoc', () => {
  const currentConfig: Ref<InternalConfig | null> = ref(null);
  let exceptionHandler: StoreExceptionHandler | null = null;
  const commentsStore = useCommentsStore();
  const documents: Ref<StoreDocument[]> = ref([]);
  const documentBounds: Ref<unknown[]> = ref([]);
  const pages: Record<string, PageEntry[]> = reactive({});
  const documentUsers: Ref<User[]> = ref([]);
  const activeZoom = ref(100);
  const zoomMode: Ref<SuperDocZoomMode> = ref('manual');
  // Document-wide measurement unit for rulers and measurement fields (Word's
  // "measurement units" preference). Defaults to inches (Word's en-US default).
  const measurementUnit: Ref<SuperDocMeasurementUnit> = ref(DEFAULT_MEASUREMENT_UNIT);
  // Latest viewport measurements (availableWidth / documentWidth / fitZoom),
  // written by the viewport-fit composable; null until editors mount.
  const viewportMetrics: Ref<SuperDocViewportMetrics | null> = ref(null);
  const isReady = ref(false);
  const isInternal = ref(false);

  const users: Ref<User[]> = ref([]);

  const user: User = reactive({ name: null, email: null });
  const modules: Modules = reactive({});

  const activeSelection: Ref<ActiveSelection | null> = ref(null);
  const selectionPosition: Ref<SelectionPosition | null> = ref({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    source: null,
  });

  const pendingLoads = new Set<DocumentLoadScope>();

  const reset = () => {
    for (const scope of pendingLoads) scope.cancel();
    pendingLoads.clear();
    documents.value = [];
    documentBounds.value = [];
    Object.assign(pages, {});
    documentUsers.value = [];
    isReady.value = false;
    user.name = null;
    user.email = null;
    Object.assign(modules, {});
    activeSelection.value = null;
    // Restore the measurement unit to its default so a prior 'cm' does not
    // survive into a later default document. init() re-applies any explicit
    // config.measurementUnit after this reset. This intentionally diverges
    // from zoom (which persists) to honor the documented reset-to-inches
    // behavior for measurement units.
    measurementUnit.value = DEFAULT_MEASUREMENT_UNIT;
  };

  const documentScroll = reactive({
    scrollTop: 0,
    scrollLeft: 0,
  });

  const setExceptionHandler = (handler: StoreExceptionHandler | null | undefined) => {
    exceptionHandler = typeof handler === 'function' ? handler : null;
  };

  const emitException = (payload: StoreExceptionPayload) => {
    const handler = exceptionHandler || currentConfig.value?.onException;
    if (typeof handler === 'function') handler(payload);
  };

  const init = async (config: InternalConfig) => {
    reset();
    currentConfig.value = config;

    // Seed the initial zoom before documents initialize so editor creation
    // reads it (SuperDoc.vue passes activeZoom into layoutEngineOptions) and
    // the first paint renders directly at the configured zoom.
    if (config.zoom?.initial !== undefined) {
      const initialZoom = config.zoom.initial;
      if (isFiniteNumber(initialZoom) && initialZoom > 0) {
        activeZoom.value = initialZoom;
      } else {
        console.warn('[SuperDoc] zoom.initial expects a positive number representing percentage');
      }
    }

    if (config.zoom?.mode !== undefined) {
      const mode = config.zoom.mode;
      if (mode === 'manual' || mode === 'fit-width') {
        zoomMode.value = mode;
      } else {
        console.warn("[SuperDoc] zoom.mode expects 'manual' or 'fit-width'");
      }
    }

    if (config.measurementUnit !== undefined) {
      const unit = config.measurementUnit;
      if (unit === 'in' || unit === 'cm') {
        measurementUnit.value = unit;
      } else {
        console.warn("[SuperDoc] measurementUnit expects 'in' or 'cm'");
      }
    }

    const { documents: configDocs, modules: configModules, user: configUser, users: configUsers } = config;

    documentUsers.value = configUsers || [];

    // Init current user
    Object.assign(user, configUser);

    // Set up module config
    Object.assign(modules, configModules);
    if (!Object.prototype.hasOwnProperty.call(modules, 'comments')) {
      modules.comments = {};
    }

    // For shorthand 'format' key, we can initialize a blank docx
    if (!configDocs?.length && !config.modules.collaboration) {
      const newDoc = await getFileObject(BlankDOCX, 'blank.docx', DOCX);
      const newDocConfig: StoreDocumentSource = {
        id: uuidv4(),
        type: DOCX,
        data: newDoc,
        name: 'blank.docx',
        isNewFile: true,
      };

      if (config.html) newDocConfig.html = config.html;
      if (config.markdown) newDocConfig.markdown = config.markdown;
      configDocs.push(newDocConfig);
    }

    // Initialize documents
    const initialDocs =
      configDocs?.length === 1 && configDocs[0] && configDocs[0].fieldContext === undefined
        ? [{ ...configDocs[0], fieldContext: config.fieldContext }]
        : configDocs;
    await initializeDocuments(initialDocs);
    isReady.value = true;
  };

  /**
   * Initialize the documents for this SuperDoc. Changes the store's documents array ref directly.
   */
  const initializeDocuments = async (docsToProcess: Array<StoreDocumentSource | null | undefined> = []) => {
    if (!docsToProcess) return [];

    for (let doc of docsToProcess) {
      if (!doc) {
        emitException({
          error: new Error('Received empty document entry during initialization.'),
          stage: 'document-init',
          document: doc,
        });
        console.warn('[superdoc] Skipping empty document entry.');
        continue;
      }

      let loadScope: DocumentLoadScope | undefined;
      let loadFailureReported = false;
      try {
        const createdScope = doc.load === undefined ? undefined : createDocumentLoadScope(doc.load, doc.id);
        loadScope = createdScope ? markRaw(createdScope) : undefined;
        if (loadScope) {
          const activeScope = loadScope;
          pendingLoads.add(activeScope);
          activeScope.onSettled(() => pendingLoads.delete(activeScope));
          activeScope.onFailure((error) => {
            loadFailureReported = true;
            pendingLoads.delete(activeScope);
            documents.value = documents.value.filter((entry) => entry.loadScope !== activeScope);
            emitException({ error, code: error.code, stage: 'document-init', document: doc, documentId: doc.id });
          });
          activeScope.assertActive();
        }
        // Ensure the document object has data (ie: if loading from URL)
        const dataTask = _initializeDocumentData(doc, loadScope);
        let docWithData = await (loadScope ? loadScope.wait(dataTask) : dataTask);
        loadScope?.assertActive();

        if (!docWithData) {
          loadScope?.finish();
          emitException({
            error: new Error('Document could not be initialized with the provided configuration.'),
            stage: 'document-init',
            document: doc,
          });
          console.warn('[superdoc] Skipping document due to invalid configuration:', doc);
          continue;
        }

        // Create composable and append to our documents
        const smartDoc = useDocument({ ...docWithData, loadScope }, currentConfig.value);
        documents.value.push(reactive(smartDoc));
      } catch (e) {
        loadScope?.finish();
        if (loadScope) pendingLoads.delete(loadScope);
        if (!loadFailureReported) emitException({ error: e, stage: 'document-init', document: doc });
        console.warn('[superdoc] Error initializing document:', doc, 'with error:', e, 'Skipping document.');
      }
    }
  };

  /**
   * Convert a Blob to a File object when a filename is required
   */
  const _blobToFile = (blob: Blob, name: string, type: string): File => {
    return new File([blob], name, { type });
  };

  /**
   * Initialize the document data by fetching the file if necessary
   */
  const _initializeDocumentData = async (doc: StoreDocumentSource, loadScope: DocumentLoadScope | undefined) => {
    // Normalize any uploader-specific wrapper to a native File/Blob upfront
    doc = normalizeDocumentEntry(doc);
    const documentType = doc.data?.type || doc.type;
    if (typeof documentType === 'string') {
      const mimeType = documentType.split(';', 1)[0].trim().toLowerCase();
      if (mimeType === HTML || mimeType === 'html') {
        throw new Error('SuperDoc: HTML document viewing is not supported. Open a DOCX or PDF document.');
      }
    }
    if (currentConfig.value?.html) doc.html = currentConfig.value.html;

    // Use docx as default if no type provided
    if (!doc.data && doc.url && !doc.type) doc.type = DOCX;

    // If in collaboration mode, return the document as is
    if (currentConfig.value?.modules.collaboration && !doc.isNewFile) {
      return { ...doc, data: null, url: null };
    }

    // If we already have data (File/Blob), ensure it has the expected metadata
    if (doc.data instanceof File) {
      let fileName = doc.name;
      const extension = doc.type === DOCX ? '.docx' : doc.type === PDF ? '.pdf' : '.bin';
      if (!fileName) {
        fileName = `document${extension}`;
      } else if (!fileName.includes('.')) {
        fileName = `${fileName}${extension}`;
      }

      if (doc.data.name !== fileName) {
        const fileObject = _blobToFile(doc.data, fileName, doc.data.type || doc.type);
        return { ...doc, name: fileName, data: fileObject };
      }

      if (!doc.name) return { ...doc, name: fileName };

      return doc;
    }
    // If we have a Blob object, convert it to a File with appropriate name
    else if (doc.data instanceof Blob) {
      // Use provided name or generate a default name based on type
      let fileName = doc.name;
      if (!fileName) {
        const extension = doc.type === DOCX ? '.docx' : doc.type === PDF ? '.pdf' : '.bin';
        fileName = `document${extension}`;
      }
      const fileObject = _blobToFile(doc.data, fileName, doc.data.type || doc.type);
      return { ...doc, data: fileObject };
    }
    // If we have any other data object, return it as is (for backward compatibility)
    else if (doc.data) return doc;
    // If we have a URL, fetch the file and return it
    else if (doc.url && doc.type) {
      if (doc.type.toLowerCase() === 'docx') doc.type = DOCX;
      else if (doc.type.toLowerCase() === 'pdf') doc.type = PDF;
      try {
        const fileObject = await getFileObject(
          doc.url,
          doc.name || 'document',
          doc.type as MimeType,
          ...(loadScope ? [{ signal: loadScope.signal }] : []),
        );
        return { ...doc, data: fileObject };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.debug('[SuperDoc] Failed to fetch document from URL:', message);
        throw err;
      }
    }
    // Invalid configuration
    return null;
  };

  const areDocumentsReady = computed(() => {
    for (let obj of documents.value.filter((doc) => doc.type === 'pdf')) {
      if (!obj.isReady) return false;
    }
    return true;
  });

  const getDocument = (documentId: string) => documents.value.find((doc) => doc.id === documentId);

  /**
   * Remove one mounted document by id and prune shell-owned state tied to it.
   */
  const removeDocument = (documentId: string): RuntimeDocument | null => {
    const normalizedDocumentId = documentId != null ? String(documentId) : null;
    if (!normalizedDocumentId) return null;

    const docIndex = documents.value.findIndex((doc) => String(doc?.id ?? '') === normalizedDocumentId);
    if (docIndex === -1) return null;

    commentsStore.removeCommentsForDocument?.(normalizedDocumentId);

    if (
      activeSelection.value?.documentId != null &&
      String(activeSelection.value.documentId) === normalizedDocumentId
    ) {
      activeSelection.value = null;
      selectionPosition.value = {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        source: null,
      };
    }

    delete pages[normalizedDocumentId];

    const [removed] = documents.value.splice(docIndex, 1);
    removed?.loadScope?.cancel();

    const configDocs = currentConfig.value?.documents;
    if (Array.isArray(configDocs)) {
      const configIndex = configDocs.findIndex((doc) => String(doc?.id ?? '') === normalizedDocumentId);
      if (configIndex !== -1) configDocs.splice(configIndex, 1);
    }

    return removed ?? null;
  };
  const getPageBounds = (documentId: string, page: number) => {
    const matchedPage = pages[documentId];
    if (!matchedPage) return;
    const pageInfo = matchedPage.find((p) => p.page == page);
    if (!pageInfo || !pageInfo.container) return;

    const containerBounds = pageInfo.container.getBoundingClientRect();
    const { height } = containerBounds;
    const totalHeight = height * (page - 1);
    return {
      top: totalHeight,
    };
  };

  const handlePageReady = (documentId: string, index: number, containerBounds: unknown) => {
    if (!pages[documentId]) pages[documentId] = [];
    pages[documentId].push({ page: index, containerBounds });

    const doc = getDocument(documentId);
    if (!doc) return;

    doc.pageContainers.push({
      page: index,
      containerBounds,
    });
  };

  return {
    commentsStore,
    documents,
    documentBounds,
    pages,
    documentUsers,
    users,
    activeZoom,
    zoomMode,
    measurementUnit,
    viewportMetrics,
    documentScroll,
    isInternal,

    selectionPosition,
    activeSelection,

    isReady,

    user,
    modules,

    // Getters
    areDocumentsReady,

    // Actions
    init,
    setExceptionHandler,
    reset,
    handlePageReady,
    getDocument,
    removeDocument,
    getPageBounds,
  };
});
