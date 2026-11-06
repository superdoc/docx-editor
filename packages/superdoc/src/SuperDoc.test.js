import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, defineComponent, ref, shallowRef, reactive, nextTick } from 'vue';
import { DOCX, PDF } from '@superdoc/common';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Mapping, StepMap } from 'prosemirror-transform';
import { ySyncPluginKey } from 'y-prosemirror';
import { Extension } from '../../super-editor/src/editors/v1/core/Extension.js';
import {
  CommentsPlugin,
  CommentsPluginKey,
} from '../../super-editor/src/editors/v1/extensions/comment/comments-plugin.js';
import { CommentMarkName } from '../../super-editor/src/editors/v1/extensions/comment/comments-constants.js';

const isRef = (value) => value && typeof value === 'object' && 'value' in value;

// Mock state for PresentationEditor
const mockState = { instances: new Map() };

vi.mock('pinia', async () => {
  const actual = await vi.importActual('pinia');
  return {
    ...actual,
    storeToRefs: (store) => {
      const result = {};
      for (const key of Object.keys(store)) {
        if (isRef(store[key])) {
          result[key] = store[key];
        }
      }
      return result;
    },
  };
});

let superdocStoreStub;
let commentsStoreStub;

vi.mock('@superdoc/stores/superdoc-store', () => ({
  useSuperdocStore: () => superdocStoreStub,
}));

vi.mock('@superdoc/stores/comments-store', () => ({
  useCommentsStore: () => commentsStoreStub,
}));

const useSelectionMock = vi.fn((params) => ({
  selectionBounds: params.selectionBounds || {},
  getValues: () => ({ ...params }),
}));

vi.mock('@superdoc/helpers/use-selection', () => ({
  default: useSelectionMock,
}));

const useSelectedTextMock = vi.fn(() => ({ selectedText: ref('') }));
vi.mock('@superdoc/composables/use-selected-text', () => ({
  useSelectedText: useSelectedTextMock,
}));

const useAiMock = vi.fn(() => ({
  showAiLayer: ref(false),
  showAiWriter: ref(false),
  aiWriterPosition: reactive({ top: '0px', left: '0px' }),
  aiLayer: ref(null),
  initAiLayer: vi.fn(),
  showAiWriterAtCursor: vi.fn(),
  handleAiWriterClose: vi.fn(),
  handleAiToolClick: vi.fn(),
}));

vi.mock('@superdoc/composables/use-ai', () => ({
  useAi: useAiMock,
}));

vi.mock('@superdoc/composables/use-high-contrast-mode', () => ({
  useHighContrastMode: () => ({ isHighContrastMode: ref(false) }),
}));

const stubComponent = (name) =>
  defineComponent({
    name,
    props: ['comment', 'autoFocus', 'parent', 'documentData', 'config', 'documentId', 'fileSource', 'state', 'options'],
    emits: ['pageMarginsChange', 'ready', 'selection-change', 'page-loaded', 'page-ready', 'bypass-selection'],
    setup(props, { slots }) {
      return () => h('div', { class: `${name}-stub` }, slots.default ? slots.default() : undefined);
    },
  });

const SuperEditorStub = defineComponent({
  name: 'SuperEditorStub',
  props: ['fileSource', 'state', 'documentId', 'options'],
  emits: ['pageMarginsChange', 'editor-ready'],
  setup(props) {
    return () => h('div', { class: 'super-editor-stub' }, [JSON.stringify(props.options.documentId)]);
  },
});

const AIWriterStub = stubComponent('AIWriter');
const CommentDialogStub = stubComponent('CommentDialog');
const FloatingCommentsStub = stubComponent('FloatingComments');
const CommentsLayerStub = stubComponent('CommentsLayer');
const HrbrFieldsLayerStub = stubComponent('HrbrFieldsLayer');
const AiLayerStub = stubComponent('AiLayer');
const HtmlViewerStub = stubComponent('HtmlViewer');
const PdfViewerStub = defineComponent({
  name: 'PdfViewer',
  props: ['config', 'file', 'fileId', 'initialScale'],
  emits: ['selection-raw', 'bypass-selection', 'page-rendered', 'document-ready'],
  setup(_props, { expose }) {
    expose({ updateScale: vi.fn() });
    return () => h('div', { class: 'sd-pdf-viewer pdf-viewer-stub' });
  },
});

const createTrackedChangeIndexStub = () => ({
  subscribe: vi.fn(() => () => {}),
  getAll: vi.fn(() => []),
  get: vi.fn(() => []),
  invalidate: vi.fn(),
  invalidateAll: vi.fn(),
  dispose: vi.fn(),
});

const getTrackedChangeIndexMock = vi.fn(() => createTrackedChangeIndexStub());
const resolveTrackedChangeColorMock = vi.fn(() => '#123456');
const composeAuthorColorResolverMock = vi.fn((config) => (config ? resolveTrackedChangeColorMock : undefined));

vi.mock('@superdoc/contracts', () => ({
  composeAuthorColorResolver: composeAuthorColorResolverMock,
}));

// Mock @superdoc/super-editor with stubs and PresentationEditor class
vi.mock('@superdoc/super-editor', () => ({
  SuperEditor: SuperEditorStub,
  AIWriter: AIWriterStub,
  getTrackedChangeIndex: getTrackedChangeIndexMock,
  TrackChangesBasePluginKey: 'TrackChangesBasePluginKey',
  PresentationEditor: class PresentationEditorMock {
    static getInstance(documentId) {
      return mockState.instances.get(documentId);
    }

    static setGlobalZoom(zoom) {
      mockState.instances.forEach((instance) => {
        instance?.setZoom?.(zoom);
      });
    }
  },
}));

vi.mock('./components/HtmlViewer/HtmlViewer.vue', () => ({
  default: HtmlViewerStub,
}));

vi.mock(
  './components/PdfViewer/PdfViewer.vue',
  () => ({
    // SuperDoc.vue loads PdfViewer through defineAsyncComponent, so Vue
    // receives this module namespace and interop-probes it (__isTeleport,
    // __isKeepAlive, etc.). Export the common probe surface explicitly so
    // the async resolver can take `default` without tripping over vitest's
    // strict mock proxy.
    default: PdfViewerStub,
    __isTeleport: false,
    __isKeepAlive: false,
    name: 'PdfViewer',
    displayName: 'PdfViewer',
    __name: 'PdfViewer',
    __vccOpts: PdfViewerStub,
    __esModule: true,
  }),
  { spy: false },
);

vi.mock('@superdoc/components/CommentsLayer/CommentDialog.vue', () => ({
  default: CommentDialogStub,
}));

vi.mock('@superdoc/components/CommentsLayer/FloatingComments.vue', () => ({
  default: FloatingCommentsStub,
}));

vi.mock('@superdoc/components/HrbrFieldsLayer/HrbrFieldsLayer.vue', () => ({
  default: HrbrFieldsLayerStub,
}));

vi.mock('@superdoc/components/AiLayer/AiLayer.vue', () => ({
  default: AiLayerStub,
}));

vi.mock('@superdoc/components/CommentsLayer/CommentsLayer.vue', () => ({
  default: CommentsLayerStub,
}));

const buildSuperdocStore = () => {
  const documents = ref([
    {
      id: 'doc-1',
      type: DOCX,
      data: 'mock-data',
      state: {},
      html: '<p></p>',
      markdown: '',
      isReady: false,
      rulers: false,
      editorMountNonce: ref(0),
      setEditor: vi.fn(),
      getEditor: vi.fn(() => null),
    },
  ]);

  return {
    documents,
    isReady: ref(false),
    areDocumentsReady: ref(true),
    selectionPosition: ref(null),
    activeSelection: ref(null),
    activeZoom: ref(100),
    zoomMode: ref('manual'),
    viewportMetrics: ref(null),
    modules: reactive({ comments: { readOnly: false }, ai: {}, 'hrbr-fields': [] }),
    handlePageReady: vi.fn(),
    user: { name: 'Ada', email: 'ada@example.com' },
    getDocument: vi.fn((id) => documents.value.find((d) => d.id === id)),
  };
};

const buildCommentsStore = () => ({
  init: vi.fn(),
  showAddComment: vi.fn(),
  handleEditorLocationsUpdate: vi.fn(),
  clearEditorCommentPositions: vi.fn(),
  handleTrackedChangeUpdate: vi.fn(),
  refreshTrackedChangeCommentsByIds: vi.fn(),
  syncTrackedChangePositionsWithDocument: vi.fn(),
  syncTrackedChangeComments: vi.fn(),
  removePendingComment: vi.fn(),
  setActiveComment: vi.fn(),
  addComment: vi.fn(),
  getComment: vi.fn(() => null),
  resolveCommentPositionEntry: vi.fn(() => ({ key: null, entry: null })),
  getCommentDocumentId: vi.fn((comment) => {
    if (!comment) return null;
    if (comment.fileId != null) return String(comment.fileId);
    if (comment.documentId != null) return String(comment.documentId);
    if (comment.selection?.documentId != null) return String(comment.selection.documentId);
    return null;
  }),
  belongsToDocument: vi.fn((comment, activeDocumentId) => {
    if (!activeDocumentId) return false;
    const commentDocumentId =
      comment?.fileId != null
        ? String(comment.fileId)
        : comment?.documentId != null
          ? String(comment.documentId)
          : comment?.selection?.documentId != null
            ? String(comment.selection.documentId)
            : null;
    if (commentDocumentId) return commentDocumentId === String(activeDocumentId);

    const docs = superdocStoreStub?.documents?.value;
    if (Array.isArray(docs) && docs.length === 1) {
      const onlyDocumentId = docs[0]?.id != null ? String(docs[0].id) : null;
      return onlyDocumentId === String(activeDocumentId);
    }

    return false;
  }),
  COMMENT_EVENTS: {
    ADD: 'add',
    UPDATE: 'update',
    DELETED: 'deleted',
  },
  processLoadedDocxComments: vi.fn(),
  translateCommentsForExport: vi.fn(() => []),
  syncResolvedCommentsWithDocument: vi.fn(),
  requestInstantSidebarAlignment: vi.fn(),
  peekInstantSidebarAlignment: vi.fn(() => null),
  clearInstantSidebarAlignment: vi.fn(),
  getPendingComment: vi.fn(() => ({ commentId: 'pending', selection: { getValues: () => ({}) } })),
  commentsParentElement: null,
  editorCommentIds: [],
  proxy: null,
  commentsList: ref([]),
  lastUpdate: null,
  gesturePositions: ref([]),
  suppressInternalExternal: ref(false),
  getConfig: ref({ readOnly: false }),
  activeComment: ref(null),
  floatingCommentsOffset: ref(0),
  pendingComment: ref(null),
  currentCommentText: ref('<p>Text</p>'),
  isDebugging: ref(false),
  editingCommentId: ref(null),
  editorCommentPositions: ref([]),
  skipSelectionUpdate: ref(false),
  documentsWithConverations: ref([]),
  commentsByDocument: ref(new Map()),
  isCommentsListVisible: ref(false),
  isFloatingCommentsReady: ref(false),
  generalCommentIds: ref([]),
  getFloatingComments: ref([]),
  hasSyncedCollaborationComments: ref(false),
  hasInitializedLocations: ref(true),
  isCommentHighlighted: ref(false),
});

const createCommentsStoreWithFloatingGetter = () => {
  const store = buildCommentsStore();
  const floatingCommentsState = ref([]);

  delete store.getFloatingComments;
  Object.defineProperty(store, 'getFloatingComments', {
    configurable: true,
    enumerable: true,
    get() {
      return floatingCommentsState.value;
    },
  });

  return { store, floatingCommentsState };
};

const mountComponent = async (
  superdocStub,
  { surfaceManager = null, superdocStore = null, commentsStore = null, attachTo = null } = {},
) => {
  superdocStoreStub = superdocStore ?? buildSuperdocStore();
  commentsStoreStub = commentsStore ?? buildCommentsStore();
  superdocStoreStub.modules.ai = { endpoint: '/ai' };
  commentsStoreStub.documentsWithConverations.value = [{ id: 'doc-1' }];

  const component = (await import('./SuperDoc.vue')).default;

  return mount(component, {
    ...(attachTo ? { attachTo } : {}),
    global: {
      components: {
        SuperEditor: SuperEditorStub,
        CommentDialog: CommentDialogStub,
        FloatingComments: FloatingCommentsStub,
        HrbrFieldsLayer: HrbrFieldsLayerStub,
        AIWriter: AIWriterStub,
      },
      config: {
        globalProperties: {
          $superdoc: superdocStub,
        },
      },
      directives: {
        'click-outside': {
          mounted(el, binding) {
            el.__clickOutside = binding.value;
          },
          unmounted(el) {
            delete el.__clickOutside;
          },
        },
      },
      provide: {
        surfaceManager,
      },
    },
  });
};

const createSuperdocStub = () => {
  const toolbar = { config: { aiApiKey: 'abc' }, setActiveEditor: vi.fn(), updateToolbarState: vi.fn() };
  const runtimeMap = new Map();
  const eventHandlers = new Map();
  return {
    config: {
      modules: { comments: {}, ai: {}, toolbar: {}, pdf: {} },
      isDebug: false,
      documentMode: 'editing',
      role: 'editor',
      suppressDefaultDocxStyles: false,
      disableContextMenu: false,
      layoutEngineOptions: {},
    },
    activeEditor: null,
    toolbar,
    colors: ['#111'],
    broadcastEditorBeforeCreate: vi.fn(),
    broadcastEditorCreate: vi.fn(),
    broadcastEditorDestroy: vi.fn(),
    broadcastPdfDocumentReady: vi.fn(),
    broadcastSidebarToggle: vi.fn(),
    setActiveEditor: vi.fn(function setActiveEditor(editor) {
      this.activeEditor = editor;
    }),
    registerEditorRuntime: vi.fn((runtime) => {
      if (runtime?.id) runtimeMap.set(runtime.id, runtime);
    }),
    unregisterEditorRuntime: vi.fn((runtimeId) => runtimeMap.delete(runtimeId)),
    setActiveRuntime: vi.fn(),
    getActiveRuntime: vi.fn(() => null),
    activateRuntimeFromEventTarget: vi.fn(() => false),
    lockSuperdoc: vi.fn(),
    on: vi.fn((eventName, handler) => {
      const handlers = eventHandlers.get(eventName) ?? new Set();
      handlers.add(handler);
      eventHandlers.set(eventName, handlers);
      return undefined;
    }),
    off: vi.fn((eventName, handler) => {
      eventHandlers.get(eventName)?.delete(handler);
      return undefined;
    }),
    emit: vi.fn((eventName, payload) => {
      const handlers = eventHandlers.get(eventName);
      if (handlers) {
        for (const handler of [...handlers]) handler(payload);
      }
      return true;
    }),
    listeners: vi.fn((eventName) => [...(eventHandlers.get(eventName) ?? [])]),
    captureLayoutPipelineEvent: vi.fn(),
    canPerformPermission: vi.fn(() => true),
  };
};

const createRuntimeEditorMock = (documentId = 'doc-1') => ({
  options: { documentId },
  state: {
    doc: { textBetween: vi.fn(() => '') },
    selection: { from: 0, to: 0, empty: true },
  },
  commands: {
    insertContent: vi.fn(() => true),
  },
  view: { focus: vi.fn() },
  focus: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  exportDocx: vi.fn(async () => new ArrayBuffer(0)),
});

const createPresentationEditorMock = () => ({
  focus: vi.fn(),
  setZoom: vi.fn(),
  setContextMenuDisabled: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getCommentBounds: vi.fn(() => ({})),
});

const createFloatingCommentsSchema = () =>
  new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
      text: { group: 'inline' },
    },
    marks: {
      [CommentMarkName]: {
        attrs: { commentId: { default: null }, importedId: { default: null }, internal: { default: true } },
        inclusive: false,
        toDOM: (mark) => [CommentMarkName, mark.attrs],
        parseDOM: [{ tag: CommentMarkName }],
      },
    },
  });

const createImportedCommentDoc = (threadId) => {
  const schema = createFloatingCommentsSchema();
  const importedMark = schema.marks[CommentMarkName].create({ importedId: threadId, internal: true });
  const paragraph = schema.node('paragraph', null, [schema.text('Imported', [importedMark])]);
  const doc = schema.node('doc', null, [paragraph]);

  return { schema, doc };
};

const createCommentsPluginEnvironment = ({ schema, doc }) => {
  const selection = TextSelection.create(doc, 1);
  let state = EditorState.create({ schema, doc, selection });

  const editor = {
    options: { documentId: 'doc-1' },
    emit: vi.fn(),
    view: null,
  };

  const extension = Extension.create(CommentsPlugin.config);
  extension.addCommands = CommentsPlugin.config.addCommands.bind(extension);
  extension.addPmPlugins = CommentsPlugin.config.addPmPlugins.bind(extension);
  extension.editor = editor;
  const [plugin] = extension.addPmPlugins();

  state = EditorState.create({ schema, doc, selection, plugins: [plugin] });

  const view = {
    state,
    dispatch: vi.fn((tr) => {
      state = state.apply(tr);
      view.state = state;
    }),
    focus: vi.fn(),
    coordsAtPos: vi.fn(),
  };

  editor.view = view;
  const pluginView = plugin.spec.view?.(view);

  return { editor, view, pluginView };
};

describe('SuperDoc.vue', () => {
  beforeEach(() => {
    useSelectionMock.mockClear();
    useAiMock.mockClear();
    useSelectedTextMock.mockClear();
    getTrackedChangeIndexMock.mockClear();
    getTrackedChangeIndexMock.mockImplementation(() => createTrackedChangeIndexStub());
    resolveTrackedChangeColorMock.mockClear();
    composeAuthorColorResolverMock.mockReset();
    composeAuthorColorResolverMock.mockImplementation((config) => (config ? resolveTrackedChangeColorMock : undefined));
    mockState.instances.clear();

    // Make RAF synchronous in tests — jsdom has no rendering loop, and
    // SuperDoc.vue defers selection updates via requestAnimationFrame.
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(Date.now());
      return 0;
    });

    // Set up default mock presentation editor instances for common document IDs
    const mockPresentationEditor = {
      getSelectionBounds: vi.fn(() => ({
        bounds: { top: 100, left: 10, right: 80, bottom: 160 },
        pageIndex: 0,
      })),
      getCommentBounds: vi.fn((positions) => positions),
      getRangeRects: vi.fn(() => []),
      getPages: vi.fn(() => []),
      getLayoutError: vi.fn(() => null),
      setZoom: vi.fn(),
    };
    mockState.instances.set('doc-1', mockPresentationEditor);

    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires editor lifecycle events and propagates updates', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const editorComponent = wrapper.findComponent(SuperEditorStub);
    expect(editorComponent.exists()).toBe(true);

    const options = editorComponent.props('options');
    const editorMock = {
      options: { documentId: 'doc-1' },
      commands: {
        togglePagination: vi.fn(),
        insertAiMark: vi.fn(),
        setCursorById: vi.fn(),
        search: vi.fn(),
        goToSearchResult: vi.fn(),
      },
      state: {
        doc: { content: { size: 100 } },
        selection: { $from: { pos: 1 }, $to: { pos: 3 } },
      },
      view: {
        coordsAtPos: vi.fn((pos) =>
          pos === 1 ? { top: 100, bottom: 120, left: 10, right: 20 } : { top: 130, bottom: 160, left: 60, right: 80 },
        ),
        state: { selection: { $from: { pos: 1 }, $to: { pos: 3 } } },
      },
      getPageStyles: vi.fn(() => ({ pageMargins: {} })),
    };

    // processSelectionChange needs layers to be non-null to proceed past the guard
    const layersElement = document.createElement('div');
    layersElement.getBoundingClientRect = vi.fn(() => ({
      top: 120,
      left: 0,
      right: 800,
      bottom: 1000,
      width: 800,
      height: 880,
      x: 0,
      y: 120,
      toJSON: () => ({}),
    }));
    wrapper.vm.$.setupState.layers = layersElement;

    commentsStoreStub.getComment.mockReturnValue({
      commentId: 'c1',
      fileId: 'doc-1',
    });
    commentsStoreStub.resolveCommentPositionEntry.mockReturnValue({
      key: 'c1',
      entry: {
        bounds: {
          top: 260,
        },
      },
    });

    options.onBeforeCreate({ editor: editorMock });
    expect(superdocStub.broadcastEditorBeforeCreate).toHaveBeenCalled();

    options.onCreate({ editor: editorMock });
    expect(superdocStoreStub.documents.value[0].setEditor).toHaveBeenCalledWith(editorMock);
    expect(superdocStub.setActiveEditor).toHaveBeenCalledWith(editorMock);
    expect(superdocStub.broadcastEditorCreate).toHaveBeenCalled();
    expect(useAiMock).toHaveBeenCalled();

    options.onSelectionUpdate({
      editor: editorMock,
      transaction: { selection: { $from: { pos: 1 }, $to: { pos: 3 } } },
    });
    expect(useSelectionMock).toHaveBeenCalled();

    options.onCommentsUpdate({ activeCommentId: 'c1', type: 'trackedChange' });
    expect(commentsStoreStub.handleTrackedChangeUpdate).toHaveBeenCalled();
    expect(commentsStoreStub.requestInstantSidebarAlignment).toHaveBeenCalledWith(380, 'c1');
    await nextTick();
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, 'c1');

    options.onCollaborationReady({ editor: editorMock });
    expect(superdocStub.emit).toHaveBeenCalledWith('collaboration-ready', { editor: editorMock });
    await nextTick();
    expect(superdocStoreStub.isReady.value).toBe(true);

    // SD-673: pin the list-definitions-change bridge using the actual
    // production payload shape. Both producers in super-editor's
    // numbering-part-descriptor emit `{ editor, numbering }` (see
    // packages/super-editor/src/editors/v1/core/parts/adapters/
    // numbering-part-descriptor.ts:222,242). ListDefinitionsPayload
    // itself marks all three fields optional, so this test pins the
    // current production numbering variant + the SuperDoc.vue
    // pass-through, not every possible ListDefinitionsPayload shape.
    //
    // Reference equality (.toBe) pins verbatim pass-through; the
    // separate Object.keys snapshot pins the key set in case the
    // bridge ever mutates the payload in place before forwarding (a
    // deep-equal assertion against the same reference would pass
    // trivially).
    const listDefsPayload = { editor: editorMock, numbering: { nums: [] } };
    options.onListDefinitionsChange(listDefsPayload);
    const listDefsCall = superdocStub.emit.mock.calls.find(([name]) => name === 'list-definitions-change');
    expect(listDefsCall).toBeDefined();
    const [, emittedListDefsPayload] = listDefsCall;
    expect(emittedListDefsPayload).toBe(listDefsPayload);
    expect(Object.keys(emittedListDefsPayload).sort()).toEqual(['editor', 'numbering']);

    options.onDocumentLocked({ editor: editorMock, isLocked: true, lockedBy: { name: 'A' } });
    expect(superdocStub.lockSuperdoc).toHaveBeenCalledWith(true, { name: 'A' });

    options.onException({ error: new Error('boom'), editor: editorMock, code: 'DOCX_ENCRYPTION_UNSUPPORTED' });
    expect(superdocStub.emit).toHaveBeenCalledWith('exception', {
      error: expect.any(Error),
      editor: editorMock,
      code: 'DOCX_ENCRYPTION_UNSUPPORTED',
      documentId: 'doc-1',
    });
  });

  it('bridges content-control editor events to superdoc public events', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const listeners = {};
    const editorMock = {
      options: { documentId: 'doc-1' },
      on: vi.fn((event, handler) => {
        listeners[event] = handler;
      }),
    };

    options.onCreate({ editor: editorMock });

    const activePayload = {
      active: { id: 'cc-2', controlType: 'text', scope: 'inline', tag: 'tag-2', alias: 'Alias 2' },
      previous: { id: 'cc-1', controlType: 'text', scope: 'inline', tag: 'tag-1', alias: 'Alias 1' },
      source: 'pointer',
    };
    const blurPayload = {
      active: null,
      previous: { id: 'cc-2', controlType: 'text', scope: 'inline', tag: 'tag-2', alias: 'Alias 2' },
      source: 'keyboard',
    };
    const clickPayload = {
      target: { id: 'cc-2', controlType: 'text', scope: 'inline', tag: 'tag-2', alias: 'Alias 2' },
      source: 'pointer',
    };

    listeners.contentControlFocus?.(activePayload);
    listeners.contentControlBlur?.(blurPayload);
    listeners.contentControlClick?.(clickPayload);

    expect(superdocStub.emit).toHaveBeenCalledWith('content-control:active-change', activePayload);
    expect(superdocStub.emit).toHaveBeenCalledWith('content-control:active-change', blurPayload);
    expect(superdocStub.emit).toHaveBeenCalledWith('content-control:click', clickPayload);
  });

  it('bridges content-control blur payload (active=null) as active-change event', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const listeners = {};
    const editorMock = {
      options: { documentId: 'doc-1' },
      on: vi.fn((event, handler) => {
        listeners[event] = handler;
      }),
    };

    options.onCreate({ editor: editorMock });

    const blurPayload = {
      active: null,
      previous: { id: 'cc-prev', controlType: 'text', scope: 'inline', tag: 'tag-prev', alias: 'Prev' },
      source: 'keyboard',
    };
    listeners.contentControlBlur?.(blurPayload);

    expect(superdocStub.emit).toHaveBeenCalledWith('content-control:active-change', blurPayload);
  });

  it('does not emit public exception events for recoverable password prompt errors by default', async () => {
    const superdocStub = createSuperdocStub();
    const surfaceManager = {
      activeDialog: shallowRef(null),
      activeFloating: shallowRef(null),
      open: vi.fn(() => ({
        id: 'surface-1',
        mode: 'dialog',
        close: vi.fn(),
        result: Promise.resolve({ status: 'closed' }),
      })),
    };
    const wrapper = await mountComponent(superdocStub, { surfaceManager });
    const editorOptions = wrapper.findComponent(SuperEditorStub).props('options');

    editorOptions.onException({
      error: new Error('password required'),
      editor: null,
      code: 'DOCX_PASSWORD_REQUIRED',
    });

    // The built-in password prompt lazy-imports the component before opening
    await vi.dynamicImportSettled();

    expect(surfaceManager.open).toHaveBeenCalledTimes(1);
    expect(
      superdocStub.emit.mock.calls.some(
        ([eventName, payload]) => eventName === 'exception' && payload?.code === 'DOCX_PASSWORD_REQUIRED',
      ),
    ).toBe(false);
  });

  it('intercepts Cmd+F from a document-level keydown when focus is inside SuperDoc', async () => {
    const hiddenEditorDom = document.createElement('div');
    hiddenEditorDom.className = 'ProseMirror ProseMirror-focused';

    const superdocStub = createSuperdocStub();
    superdocStub.config.modules.surfaces = { findReplace: true };
    superdocStub.activeEditor = {
      view: {
        dom: hiddenEditorDom,
      },
      commands: {
        clearSearchSession: vi.fn(),
      },
    };

    const surfaceManager = {
      activeDialog: shallowRef(null),
      activeFloating: shallowRef(null),
      open: vi.fn(() => ({
        id: 'surface-1',
        mode: 'floating',
        close: vi.fn(),
        result: Promise.resolve({ status: 'closed' }),
      })),
    };

    const wrapper = await mountComponent(superdocStub, { surfaceManager });
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(hiddenEditorDom);

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);
    await vi.dynamicImportSettled();

    expect(surfaceManager.open).toHaveBeenCalledTimes(1);
  });

  it('does not intercept Cmd+F when built-in find/replace is not enabled', async () => {
    const hiddenEditorDom = document.createElement('div');
    hiddenEditorDom.className = 'ProseMirror ProseMirror-focused';

    const superdocStub = createSuperdocStub();
    superdocStub.activeEditor = {
      view: {
        dom: hiddenEditorDom,
      },
      commands: {
        clearSearchSession: vi.fn(),
      },
    };

    const surfaceManager = {
      activeDialog: shallowRef(null),
      activeFloating: shallowRef(null),
      open: vi.fn(() => ({
        id: 'surface-1',
        mode: 'floating',
        close: vi.fn(),
        result: Promise.resolve({ status: 'closed' }),
      })),
    };

    await mountComponent(superdocStub, { surfaceManager });
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(hiddenEditorDom);

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);
    await vi.dynamicImportSettled();

    expect(surfaceManager.open).not.toHaveBeenCalled();
  });

  it('toggles formatting marks from a document-level Ctrl+Shift+8 when focus is inside SuperDoc', async () => {
    const hiddenEditorDom = document.createElement('div');
    hiddenEditorDom.className = 'ProseMirror ProseMirror-focused';

    const superdocStub = createSuperdocStub();
    superdocStub.toggleFormattingMarks = vi.fn();
    superdocStub.activeEditor = {
      view: {
        dom: hiddenEditorDom,
      },
    };

    await mountComponent(superdocStub);
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(hiddenEditorDom);

    const event = new KeyboardEvent('keydown', {
      key: '8',
      code: 'Digit8',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(superdocStub.toggleFormattingMarks).toHaveBeenCalledTimes(1);
  });

  it('does not toggle formatting marks from the document shortcut when focus is outside SuperDoc', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.toggleFormattingMarks = vi.fn();

    await mountComponent(superdocStub);
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(document.body);

    const event = new KeyboardEvent('keydown', {
      key: '8',
      code: 'Digit8',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(superdocStub.toggleFormattingMarks).not.toHaveBeenCalled();
  });

  it('toggles formatting marks from the SuperDoc container shortcut handler', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.toggleFormattingMarks = vi.fn();

    const wrapper = await mountComponent(superdocStub);
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(wrapper.element);

    const event = {
      key: '*',
      code: '',
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(function () {
        this.defaultPrevented = true;
      }),
      stopPropagation: vi.fn(),
    };

    wrapper.vm.$.setupState.handleContainerKeydown(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(superdocStub.toggleFormattingMarks).toHaveBeenCalledTimes(1);
  });

  it('removes the document shortcut listener on unmount', async () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

    const wrapper = await mountComponent(createSuperdocStub());
    wrapper.unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('routes product focus/pointer hits through activateRuntimeFromEventTarget and cleans up on unmount', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub, { attachTo: document.body });
    await nextTick();

    const subDocument = wrapper.element.querySelector('.superdoc__sub-document');
    expect(subDocument).not.toBeNull();
    const target = document.createElement('span');
    subDocument.appendChild(target);

    // Real product DOM events inside the marked runtime root activate the owning
    // runtime through the shell helper — no painter inspection or dispatch here.
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(superdocStub.activateRuntimeFromEventTarget).toHaveBeenCalledWith(target, 'focusin');

    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(superdocStub.activateRuntimeFromEventTarget).toHaveBeenCalledWith(target, 'pointerdown');

    target.dispatchEvent(new Event('mousedown', { bubbles: true }));
    expect(superdocStub.activateRuntimeFromEventTarget).toHaveBeenCalledWith(target, 'mousedown');

    const callsBeforeUnmount = superdocStub.activateRuntimeFromEventTarget.mock.calls.length;

    wrapper.unmount();

    // After unmount the capture listeners are gone: further hits do not route.
    document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(superdocStub.activateRuntimeFromEventTarget.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it('runtime hit routing outside any marked root delegates to the registry no-op (does not throw)', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub, { attachTo: document.body });
    await nextTick();

    // An event outside the document area still routes to the helper, which
    // resolves no owning runtime and is a safe no-op (returns false).
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(superdocStub.activateRuntimeFromEventTarget).toHaveBeenCalledWith(document.body, 'pointerdown');

    wrapper.unmount();
  });

  it('skips v1 runtime registration when the document host root is unavailable', async () => {
    const superdocStub = createSuperdocStub();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const doc = superdocStoreStub.documents.value[0];
    wrapper.vm.$.setupState.setSubDocumentRoot(doc, null);

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    options.onCreate({ editor: createRuntimeEditorMock('doc-1') });

    expect(warnSpy).toHaveBeenCalledWith(
      '[SuperDoc] v1 runtime host root unavailable; skipping runtime registration for',
      'doc-1',
    );
    expect(superdocStub.registerEditorRuntime).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('registers a v1 runtime, attaches the presentation editor, and activates it on focus', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const editor = createRuntimeEditorMock('doc-1');
    const presentationEditor = createPresentationEditorMock();
    const editorComponent = wrapper.findComponent(SuperEditorStub);
    const options = editorComponent.props('options');
    superdocStoreStub.documents.value[0].setPresentationEditor = vi.fn();

    options.onCreate({ editor });
    const runtime = superdocStub.registerEditorRuntime.mock.calls.at(-1)[0];

    expect(runtime.documentId).toBe('doc-1');
    expect(superdocStub.setActiveRuntime).toHaveBeenLastCalledWith(runtime.id, 'v1-editor-create');

    editorComponent.vm.$emit('editor-ready', { editor, presentationEditor });
    await nextTick();
    expect(runtime.getSnapshot().state).toBe('editing-ready');
    expect(presentationEditor.on).toHaveBeenCalledWith('paginationUpdate', expect.any(Function));
    expect(presentationEditor.setContextMenuDisabled).toHaveBeenCalledWith(false);

    superdocStub.setActiveRuntime.mockClear();
    options.onFocus({ editor });
    expect(superdocStub.setActiveRuntime).toHaveBeenCalledWith(runtime.id, 'v1-editor-focus');

    runtime.dispose();
    expect(superdocStub.unregisterEditorRuntime).toHaveBeenCalledWith(runtime.id);

    wrapper.unmount();
  });

  it('disposes an existing v1 runtime before registering a replacement for the same document', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    options.onCreate({ editor: createRuntimeEditorMock('doc-1') });
    const firstRuntime = superdocStub.registerEditorRuntime.mock.calls.at(-1)[0];
    const disposeSpy = vi.spyOn(firstRuntime, 'dispose');

    options.onCreate({ editor: createRuntimeEditorMock('doc-1') });
    const secondRuntime = superdocStub.registerEditorRuntime.mock.calls.at(-1)[0];

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(superdocStub.unregisterEditorRuntime).toHaveBeenCalledWith(firstRuntime.id);
    expect(superdocStub.registerEditorRuntime).toHaveBeenCalledTimes(2);
    expect(secondRuntime.id).not.toBe(firstRuntime.id);

    wrapper.unmount();
  });

  it('disposes registered v1 runtimes on component unmount', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    options.onCreate({ editor: createRuntimeEditorMock('doc-1') });
    const runtime = superdocStub.registerEditorRuntime.mock.calls.at(-1)[0];
    const disposeSpy = vi.spyOn(runtime, 'dispose');

    wrapper.unmount();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(superdocStub.unregisterEditorRuntime).toHaveBeenCalledWith(runtime.id);
  });

  it('forwards configured passwords to SuperEditor options', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.password = 'top-secret';

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const editorComponent = wrapper.findComponent(SuperEditorStub);
    expect(editorComponent.exists()).toBe(true);
    expect(editorComponent.props('options').password).toBe('top-secret');
  });

  it('forwards top-level proofing config into layoutEngineOptions for PresentationEditor', async () => {
    const superdocStub = createSuperdocStub();
    const proofingProvider = {
      id: 'test-proofing',
      check: vi.fn(async () => ({ issues: [] })),
    };
    const topLevelProofing = {
      enabled: true,
      provider: proofingProvider,
      defaultLanguage: 'en-US',
      maxSuggestions: 4,
    };

    superdocStub.config.proofing = topLevelProofing;
    superdocStub.config.layoutEngineOptions = {
      flowMode: 'paginated',
      proofing: {
        enabled: false,
        provider: null,
      },
    };

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    expect(options.layoutEngineOptions.proofing).toBe(topLevelProofing);
    expect(options.layoutEngineOptions.flowMode).toBe('paginated');
  });

  it('forwards modules.contentControls.chrome into layoutEngineOptions for PresentationEditor', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.modules.contentControls = { chrome: 'none' };

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    expect(options.layoutEngineOptions.contentControlsChrome).toBe('none');
  });

  it('leaves contentControlsChrome undefined when modules.contentControls is not configured', async () => {
    const superdocStub = createSuperdocStub();

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    expect(options.layoutEngineOptions.contentControlsChrome).toBeUndefined();
  });

  it('forwards modules.trackChanges.authorColors into layoutEngineOptions for PresentationEditor', async () => {
    const superdocStub = createSuperdocStub();
    const authorColors = { overrides: { Alice: '#f00' } };
    superdocStub.config.modules.trackChanges = { authorColors };

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    expect(composeAuthorColorResolverMock).toHaveBeenCalledWith(authorColors);
    expect(options.layoutEngineOptions.resolveTrackedChangeColor).toBe(resolveTrackedChangeColorMock);
  });

  it('handles replay comment update/delete events and triggers tracked-change resync', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const existingComment = { commentId: 'c-1', commentText: 'Old text' };

    commentsStoreStub.getComment.mockImplementation((id) => (id === 'c-1' ? existingComment : null));
    commentsStoreStub.commentsList.value = [
      existingComment,
      { commentId: 'c-2', parentCommentId: 'c-1', commentText: 'Reply' },
      { commentId: 'tc-child', trackedChangeParentId: 'c-1', commentText: 'Tracked thread comment' },
    ];
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    options.onCommentsUpdate({
      type: 'update',
      comment: { commentId: 'c-1', commentText: 'Updated text' },
    });
    expect(existingComment.commentText).toBe('Updated text');
    const creatorIdentity = { providerId: 'AD', userId: 'history-account' };
    options.onCommentsUpdate({
      type: 'update',
      comment: { commentId: 'c-1', creatorIdentity, wordAuthorName: 'Original label' },
    });
    expect(existingComment.creatorIdentity).toEqual(creatorIdentity);
    expect(existingComment.wordAuthorName).toBe('Original label');
    options.onCommentsUpdate({ type: 'update', comment: { commentId: 'c-1', commentText: 'Another edit' } });
    expect(existingComment.creatorIdentity).toEqual(creatorIdentity);

    options.onCommentsUpdate({
      type: 'deleted',
      comment: { commentId: 'c-1' },
    });
    expect(commentsStoreStub.commentsList.value).toEqual([]);

    options.onCommentsUpdate({ type: 'replayCompleted' });
    await nextTick();
    expect(commentsStoreStub.syncTrackedChangeComments).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: superdocStub.activeEditor,
    });
    commentsStoreStub.syncTrackedChangeComments.mockClear();

    options.onCommentLocationsUpdate({ allCommentPositions: { 'tc-new': { start: 1, end: 2 } } });
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
  });

  it('resyncs tracked-change threads on undo/redo transactions', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = { options: { documentId: 'doc-1' } };

    const makeTransaction = (inputType) => ({
      getMeta: vi.fn((key) => (key === 'inputType' ? inputType : undefined)),
    });

    options.onTransaction({
      editor: editorMock,
      transaction: makeTransaction('historyUndo'),
      duration: 4,
    });

    expect(commentsStoreStub.syncTrackedChangePositionsWithDocument).toHaveBeenCalledWith({
      documentId: 'doc-1',
      editor: editorMock,
    });
    expect(commentsStoreStub.syncResolvedCommentsWithDocument).toHaveBeenCalledWith({
      documentId: 'doc-1',
      editor: editorMock,
    });
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(commentsStoreStub.syncTrackedChangeComments).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: editorMock,
      broadcastChanges: true,
    });

    commentsStoreStub.syncTrackedChangePositionsWithDocument.mockClear();
    commentsStoreStub.syncTrackedChangeComments.mockClear();
    commentsStoreStub.syncResolvedCommentsWithDocument.mockClear();

    options.onTransaction({
      editor: editorMock,
      transaction: makeTransaction('historyRedo'),
      duration: 5,
    });

    expect(commentsStoreStub.syncTrackedChangePositionsWithDocument).toHaveBeenCalledWith({
      documentId: 'doc-1',
      editor: editorMock,
    });
    expect(commentsStoreStub.syncResolvedCommentsWithDocument).toHaveBeenCalledWith({
      documentId: 'doc-1',
      editor: editorMock,
    });
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(commentsStoreStub.syncTrackedChangeComments).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: editorMock,
      broadcastChanges: true,
    });
  });

  it('resyncs tracked-change threads on collaboration undo/redo transactions', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = { options: { documentId: 'doc-1' } };

    const makeTransaction = ({ inputType, ySyncMeta } = {}) => ({
      getMeta: vi.fn((key) => {
        if (key === 'inputType') return inputType;
        if (key === ySyncPluginKey) return ySyncMeta;
        return undefined;
      }),
    });

    options.onTransaction({
      editor: editorMock,
      transaction: makeTransaction({
        ySyncMeta: { isChangeOrigin: true, isUndoRedoOperation: true },
      }),
      duration: 4,
    });

    expect(commentsStoreStub.syncTrackedChangePositionsWithDocument).toHaveBeenCalledWith({
      documentId: 'doc-1',
      editor: editorMock,
    });
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(commentsStoreStub.syncTrackedChangeComments).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: editorMock,
      broadcastChanges: true,
    });
  });

  it('resyncs tracked-change threads on peer collaboration replays', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = { options: { documentId: 'doc-1' } };

    const makeTransaction = ({ inputType, ySyncMeta, docChanged = false } = {}) => ({
      docChanged,
      getMeta: vi.fn((key) => {
        if (key === 'inputType') return inputType;
        if (key === ySyncPluginKey) return ySyncMeta;
        return undefined;
      }),
    });

    options.onTransaction({
      editor: editorMock,
      transaction: makeTransaction({
        docChanged: true,
        ySyncMeta: { isChangeOrigin: true, isUndoRedoOperation: false },
      }),
      duration: 6,
    });

    expect(commentsStoreStub.syncTrackedChangePositionsWithDocument).toHaveBeenCalledWith({
      documentId: 'doc-1',
      editor: editorMock,
    });
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(commentsStoreStub.syncTrackedChangeComments).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: editorMock,
      broadcastChanges: false,
    });
  });

  it('does not resync tracked-change threads on meta-only collaboration updates', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = { options: { documentId: 'doc-1' } };

    const makeTransaction = ({ inputType, ySyncMeta, docChanged = false } = {}) => ({
      docChanged,
      getMeta: vi.fn((key) => {
        if (key === 'inputType') return inputType;
        if (key === ySyncPluginKey) return ySyncMeta;
        return undefined;
      }),
    });

    options.onTransaction({
      editor: editorMock,
      transaction: makeTransaction({
        docChanged: false,
        ySyncMeta: { isChangeOrigin: true, isUndoRedoOperation: false },
      }),
      duration: 7,
    });

    expect(commentsStoreStub.syncTrackedChangePositionsWithDocument).not.toHaveBeenCalled();
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
  });

  it('refreshes only touched tracked-change comments from normal body transactions', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = { options: { documentId: 'doc-1' } };
    const transaction = {
      getMeta: vi.fn((key) =>
        key === 'TrackChangesBasePluginKey'
          ? {
              insertedMark: { attrs: { id: 'tracked-insert-1' } },
              deletionMark: { attrs: { id: 'tracked-delete-1' } },
              formatMark: { attrs: { id: 'tracked-format-1' } },
            }
          : undefined,
      ),
    };

    options.onTransaction({ editor: editorMock, transaction, duration: 3 });

    expect(commentsStoreStub.syncTrackedChangePositionsWithDocument).not.toHaveBeenCalled();
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
    expect(commentsStoreStub.refreshTrackedChangeCommentsByIds).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(commentsStoreStub.refreshTrackedChangeCommentsByIds).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: editorMock,
      changeIds: ['tracked-insert-1', 'tracked-delete-1', 'tracked-format-1'],
      broadcastChanges: true,
    });
  });

  it('refreshes tracked-change comments found in changed transaction ranges', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = { options: { documentId: 'doc-1' } };
    const trackedNode = {
      marks: [{ type: { name: 'trackInsert' }, attrs: { id: 'tracked-range-1' } }],
    };
    const transaction = {
      docChanged: true,
      doc: {
        content: { size: 20 },
        nodesBetween: vi.fn((from, to, visitor) => visitor(trackedNode)),
      },
      mapping: new Mapping([new StepMap([4, 0, 1])]),
      getMeta: vi.fn(() => undefined),
    };

    options.onTransaction({ editor: editorMock, transaction, duration: 3 });

    await Promise.resolve();
    expect(transaction.doc.nodesBetween).toHaveBeenCalledWith(3, 6, expect.any(Function));
    expect(commentsStoreStub.refreshTrackedChangeCommentsByIds).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: editorMock,
      changeIds: ['tracked-range-1'],
      broadcastChanges: true,
    });
  });

  it('reconciles replay updates by importedId before commentId to avoid duplicate comments', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    const { default: useComment } = await import('./components/CommentsLayer/use-comment.js');

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const existingComment = useComment({
      commentId: 'old-runtime-id',
      importedId: 'imp-1',
      commentText: 'Old text',
      fileId: 'doc-1',
      creatorEmail: 'ada@example.com',
      creatorName: 'Ada',
    });
    const otherDocumentComment = {
      commentId: 'doc2-id',
      importedId: 'imp-1',
      commentText: 'Doc 2 text',
      fileId: 'doc-2',
    };

    // Keep the non-active-document comment first to ensure active selection does
    // not fall back to global importedId matching.
    commentsStoreStub.commentsList.value = [otherDocumentComment, existingComment];
    commentsStoreStub.addComment.mockClear();
    commentsStoreStub.setActiveComment.mockClear();
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    options.onCommentsUpdate({
      type: 'update',
      comment: {
        commentId: 'new-runtime-id',
        importedId: 'imp-1',
        commentText: 'Updated text',
      },
    });
    await nextTick();

    expect(commentsStoreStub.addComment).not.toHaveBeenCalled();
    expect(commentsStoreStub.commentsList.value).toHaveLength(2);
    expect(existingComment.commentId).toBe('old-runtime-id');
    expect(existingComment.importedId).toBe('imp-1');
    expect(existingComment.getValues().commentId).toBe('old-runtime-id');
    expect(existingComment.getValues().importedId).toBe('imp-1');
    expect(existingComment.commentText).toBe('Updated text');
    expect(otherDocumentComment.commentId).toBe('doc2-id');
    expect(otherDocumentComment.commentText).toBe('Doc 2 text');
    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalled();
  });

  it('updates docxCommentJSON from replayed elements for imported comments', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    const { default: useComment } = await import('./components/CommentsLayer/use-comment.js');

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const existingComment = useComment({
      commentId: 'old-runtime-id',
      importedId: 'imp-1',
      commentText: 'Old text',
      fileId: 'doc-1',
      docxCommentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }],
      creatorEmail: 'ada@example.com',
      creatorName: 'Ada',
    });
    commentsStoreStub.commentsList.value = [existingComment];
    commentsStoreStub.addComment.mockClear();
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    const updatedElements = [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }];
    options.onCommentsUpdate({
      type: 'update',
      comment: {
        commentId: 'new-runtime-id',
        importedId: 'imp-1',
        text: 'Updated text',
        elements: updatedElements,
      },
    });

    expect(commentsStoreStub.addComment).not.toHaveBeenCalled();
    expect(existingComment.commentText).toBe('Updated text');
    expect(existingComment.docxCommentJSON).toEqual(updatedElements);
  });

  it('updates replayed parent linkage fields for existing comments', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    const { default: useComment } = await import('./components/CommentsLayer/use-comment.js');

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const existingComment = useComment({
      commentId: 'reply-1',
      importedId: 'imp-reply-1',
      parentCommentId: 'parent-old',
      trackedChangeParentId: 'tc-parent-old',
      fileId: 'doc-1',
      commentText: 'Reply',
      creatorEmail: 'ada@example.com',
      creatorName: 'Ada',
    });
    commentsStoreStub.commentsList.value = [existingComment];
    commentsStoreStub.addComment.mockClear();
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    options.onCommentsUpdate({
      type: 'update',
      comment: {
        commentId: 'reply-1',
        importedId: 'imp-reply-1',
        parentCommentId: 'parent-new',
        trackedChangeParentId: 'tc-parent-new',
        threadingParentCommentId: 'thread-parent-new',
      },
    });

    expect(commentsStoreStub.addComment).not.toHaveBeenCalled();
    expect(existingComment.parentCommentId).toBe('parent-new');
    expect(existingComment.trackedChangeParentId).toBe('tc-parent-new');
    expect(existingComment.threadingParentCommentId).toBe('thread-parent-new');
  });

  it('updates replayed tracked-change display metadata for existing comments', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    const { default: useComment } = await import('./components/CommentsLayer/use-comment.js');

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const existingComment = useComment({
      commentId: 'tracked-change-1',
      importedId: 'imp-tracked-change-1',
      fileId: 'doc-1',
      trackedChange: true,
      trackedChangeType: 'trackFormat',
      trackedChangeText: 'underline',
      trackedChangeDisplayType: null,
      creatorEmail: 'ada@example.com',
      creatorName: 'Ada',
    });
    commentsStoreStub.commentsList.value = [existingComment];
    commentsStoreStub.addComment.mockClear();
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    options.onCommentsUpdate({
      type: 'update',
      comment: {
        commentId: 'tracked-change-1',
        importedId: 'imp-tracked-change-1',
        trackedChange: true,
        trackedChangeType: 'trackFormat',
        trackedChangeText: 'https://example.com',
        trackedChangeDisplayType: 'hyperlinkAdded',
      },
    });

    expect(commentsStoreStub.addComment).not.toHaveBeenCalled();
    expect(existingComment.trackedChangeText).toBe('https://example.com');
    expect(existingComment.trackedChangeDisplayType).toBe('hyperlinkAdded');
  });

  it('maps replayed isDone updates to resolved fields when explicit resolved metadata is missing', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    const { default: useComment } = await import('./components/CommentsLayer/use-comment.js');

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const existingComment = useComment({
      commentId: 'c-1',
      importedId: 'imp-1',
      commentText: 'Old text',
      fileId: 'doc-1',
      creatorEmail: 'ada@example.com',
      creatorName: 'Ada',
      resolvedTime: null,
      resolvedByEmail: null,
      resolvedByName: null,
    });
    commentsStoreStub.commentsList.value = [existingComment];
    commentsStoreStub.addComment.mockClear();
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    options.onCommentsUpdate({
      type: 'update',
      comment: {
        commentId: 'c-1',
        importedId: 'imp-1',
        isDone: true,
        resolvedTime: null,
        resolvedByEmail: null,
        resolvedByName: null,
        creatorEmail: 'imported@example.com',
        creatorName: 'Imported Author',
      },
    });

    expect(commentsStoreStub.addComment).not.toHaveBeenCalled();
    expect(existingComment.resolvedTime).not.toBeNull();
    expect(existingComment.resolvedByEmail).toBe('imported@example.com');
    expect(existingComment.resolvedByName).toBe('Imported Author');

    options.onCommentsUpdate({
      type: 'update',
      comment: {
        commentId: 'c-1',
        importedId: 'imp-1',
        isDone: false,
      },
    });

    expect(existingComment.resolvedTime).toBeNull();
    expect(existingComment.resolvedByEmail).toBeNull();
    expect(existingComment.resolvedByName).toBeNull();
  });

  it('maps replay-added elements to docxCommentJSON for imported comments', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.addComment.mockClear();

    const addedElements = [{ type: 'paragraph', content: [{ type: 'text', text: 'added' }] }];
    options.onCommentsUpdate({
      type: 'add',
      comment: {
        commentId: 'new-add-id',
        importedId: 'imp-add',
        text: 'Added text',
        elements: addedElements,
      },
    });

    expect(commentsStoreStub.addComment).toHaveBeenCalledTimes(1);
    const [{ comment: addedComment }] = commentsStoreStub.addComment.mock.calls[0];
    expect(addedComment.commentText).toBe('Added text');
    expect(addedComment.docxCommentJSON).toEqual(addedElements);
  });

  it('does not drop replay add when same id exists only in another document', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.commentsList.value = [
      { commentId: 'shared-id', importedId: 'shared-imported-id', fileId: 'doc-2', commentText: 'Doc 2 comment' },
    ];
    commentsStoreStub.getComment.mockImplementation((id) =>
      commentsStoreStub.commentsList.value.find((comment) => comment.commentId === id || comment.importedId === id),
    );
    commentsStoreStub.addComment.mockClear();
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    options.onCommentsUpdate({
      type: 'add',
      comment: {
        commentId: 'shared-id',
        importedId: 'shared-imported-id',
        commentText: 'Doc 1 replay add',
      },
    });

    expect(commentsStoreStub.addComment).toHaveBeenCalledTimes(1);
    const [{ comment: addedComment }] = commentsStoreStub.addComment.mock.calls[0];
    expect(addedComment.commentId).toBe('shared-id');
    expect(addedComment.importedId).toBe('shared-imported-id');
    expect(addedComment.fileId).toBe('doc-1');
  });

  it('removes replay-deleted comments when payload commentId is stale but importedId matches', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.commentsList.value = [
      { commentId: 'live-runtime-id', importedId: 'imp-1', commentText: 'Parent' },
      { commentId: 'child-1', parentCommentId: 'live-runtime-id', commentText: 'Reply' },
      { commentId: 'other', commentText: 'Unrelated' },
    ];
    commentsStoreStub.activeComment.value = 'child-1';
    commentsStoreStub.setActiveComment.mockClear();

    options.onCommentsUpdate({
      type: 'deleted',
      comment: { commentId: 'stale-runtime-id', importedId: 'imp-1' },
    });

    expect(commentsStoreStub.commentsList.value).toEqual([{ commentId: 'other', commentText: 'Unrelated' }]);
    await nextTick();
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, null);
  });

  it('clears active comment when replay deletion removes the active reply', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.commentsList.value = [
      { commentId: 'c-1', commentText: 'Parent' },
      { commentId: 'c-2', parentCommentId: 'c-1', commentText: 'Reply' },
    ];
    commentsStoreStub.activeComment.value = 'c-2';
    commentsStoreStub.setActiveComment.mockClear();

    options.onCommentsUpdate({
      type: 'deleted',
      comment: { commentId: 'c-1' },
    });

    expect(commentsStoreStub.commentsList.value).toEqual([]);
    await nextTick();
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, null);
  });

  it('removes full reply subtree when replay deletion removes a parent comment', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.commentsList.value = [
      { commentId: 'c-1', commentText: 'Parent' },
      { commentId: 'c-2', parentCommentId: 'c-1', commentText: 'Child' },
      { commentId: 'c-3', parentCommentId: 'c-2', commentText: 'Grandchild' },
      { commentId: 'c-4', trackedChangeParentId: 'c-3', commentText: 'Tracked descendant' },
      { commentId: 'c-99', commentText: 'Unrelated' },
    ];
    commentsStoreStub.activeComment.value = 'c-3';
    commentsStoreStub.setActiveComment.mockClear();

    options.onCommentsUpdate({
      type: 'deleted',
      comment: { commentId: 'c-1' },
    });

    expect(commentsStoreStub.commentsList.value).toEqual([{ commentId: 'c-99', commentText: 'Unrelated' }]);
    await nextTick();
    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, null);
  });

  it('scopes replay deletion subtree to the active document when IDs overlap across documents', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.commentsList.value = [
      { commentId: 'c-1', importedId: 'imp-1', fileId: 'doc-1', commentText: 'Doc 1 parent' },
      { commentId: 'c-2', parentCommentId: 'c-1', fileId: 'doc-1', commentText: 'Doc 1 child' },
      { commentId: 'c-1', importedId: 'imp-1', fileId: 'doc-2', commentText: 'Doc 2 parent' },
      { commentId: 'c-3', parentCommentId: 'c-1', fileId: 'doc-2', commentText: 'Doc 2 child' },
    ];
    commentsStoreStub.activeComment.value = 'c-3';
    commentsStoreStub.setActiveComment.mockClear();
    superdocStub.activeEditor = { options: { documentId: 'doc-1' } };

    options.onCommentsUpdate({
      type: 'deleted',
      comment: { commentId: 'c-1', importedId: 'imp-1' },
    });

    expect(commentsStoreStub.commentsList.value).toEqual([
      { commentId: 'c-1', importedId: 'imp-1', fileId: 'doc-2', commentText: 'Doc 2 parent' },
      { commentId: 'c-3', parentCommentId: 'c-1', fileId: 'doc-2', commentText: 'Doc 2 child' },
    ]);
    await nextTick();
    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalledWith(superdocStub, null);
  });

  it('passes slash menu and context menu options through to SuperEditor', async () => {
    const superdocStub = createSuperdocStub();
    const slashMenuConfig = {
      includeDefaultItems: false,
      items: [{ id: 'custom-section', items: [{ id: 'custom-item', label: 'Custom Item', action: vi.fn() }] }],
    };
    superdocStub.config.modules.slashMenu = slashMenuConfig;
    superdocStub.config.disableContextMenu = true;

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    expect(options.slashMenuConfig).toBe(slashMenuConfig);
    expect(options.disableContextMenu).toBe(true);
  });

  it('handles editor-ready by storing presentation editor and syncing context menu disable state', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.disableContextMenu = true;
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const doc = superdocStoreStub.documents.value[0];
    doc.setPresentationEditor = vi.fn();

    const presentationEditor = {
      setContextMenuDisabled: vi.fn(),
      on: vi.fn(),
      getCommentBounds: vi.fn(() => ({})),
    };
    const editor = { options: { documentId: 'doc-1' } };
    wrapper.findComponent(SuperEditorStub).vm.$emit('editor-ready', { editor, presentationEditor });
    await nextTick();

    expect(doc.setPresentationEditor).toHaveBeenCalledWith(presentationEditor);
    expect(presentationEditor.setContextMenuDisabled).toHaveBeenCalledWith(true);
    expect(presentationEditor.on).toHaveBeenCalledWith('commentPositions', expect.any(Function));
    expect(getTrackedChangeIndexMock).toHaveBeenCalledWith(editor);
  });

  it('resyncs tracked-change comments from non-body tracked-changes-changed events', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    superdocStoreStub.documents.value[0].setPresentationEditor = vi.fn();

    const listeners = {};
    const presentationEditor = {
      setContextMenuDisabled: vi.fn(),
      on: vi.fn((event, handler) => {
        listeners[event] = handler;
      }),
      getCommentBounds: vi.fn(() => ({})),
    };
    const bodyEditor = {
      options: { documentId: 'doc-1' },
      on: vi.fn((event, handler) => {
        listeners[`editor:${event}`] = handler;
      }),
    };
    const sourceEditor = { options: { documentId: 'header-doc' } };

    wrapper.findComponent(SuperEditorStub).vm.$emit('editor-ready', {
      editor: bodyEditor,
      presentationEditor,
    });
    await nextTick();

    listeners['editor:tracked-changes-changed']?.({ editor: sourceEditor, source: 'story-edit' });
    expect(commentsStoreStub.syncTrackedChangeComments).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor: sourceEditor,
    });

    commentsStoreStub.syncTrackedChangeComments.mockClear();
    listeners['editor:tracked-changes-changed']?.({ editor: sourceEditor, source: 'body-edit' });
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
  });

  it('forwards replacedFile comment loads to the comments store', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editor = {
      options: {
        documentId: 'doc-1',
        shouldLoadComments: false,
      },
    };

    options.onCommentsLoaded({
      editor,
      comments: [{ commentId: 'c-1' }],
      replacedFile: true,
    });
    await nextTick();

    expect(commentsStoreStub.processLoadedDocxComments).toHaveBeenCalledWith({
      superdoc: superdocStub,
      editor,
      comments: [{ commentId: 'c-1' }],
      documentId: 'doc-1',
      replacedFile: true,
    });
  });

  it('clears tracked-change positions for non-body tracked-change updates when viewing-mode comments are hidden', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.documentMode = 'viewing';
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    superdocStoreStub.documents.value[0].setPresentationEditor = vi.fn();

    const listeners = {};
    const presentationEditor = {
      setContextMenuDisabled: vi.fn(),
      on: vi.fn((event, handler) => {
        listeners[event] = handler;
      }),
      getCommentBounds: vi.fn(() => ({})),
    };
    const bodyEditor = {
      options: { documentId: 'doc-1' },
      on: vi.fn((event, handler) => {
        listeners[`editor:${event}`] = handler;
      }),
    };

    wrapper.findComponent(SuperEditorStub).vm.$emit('editor-ready', {
      editor: bodyEditor,
      presentationEditor,
    });
    await nextTick();

    listeners['editor:tracked-changes-changed']?.({ source: 'story-edit' });
    expect(commentsStoreStub.clearEditorCommentPositions).toHaveBeenCalled();
    expect(commentsStoreStub.syncTrackedChangeComments).not.toHaveBeenCalled();
  });

  it('forwards header/footer presentation events through the public update callbacks', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.onTransaction = vi.fn();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    superdocStoreStub.documents.value[0].setPresentationEditor = vi.fn();

    const listeners = {};
    const presentationEditor = {
      setContextMenuDisabled: vi.fn(),
      on: vi.fn((event, handler) => {
        listeners[event] = handler;
      }),
      getCommentBounds: vi.fn(() => ({})),
    };
    const bodyEditor = { options: { documentId: 'doc-1' } };
    const sourceEditor = { options: { documentId: 'header-doc' } };

    wrapper.findComponent(SuperEditorStub).vm.$emit('editor-ready', {
      editor: bodyEditor,
      presentationEditor,
    });
    await nextTick();

    listeners.headerFooterUpdate({
      editor: bodyEditor,
      sourceEditor,
      surface: 'header',
      headerId: 'rId-header-default',
      sectionType: 'default',
    });
    expect(superdocStub.emit).toHaveBeenCalledWith('editor-update', {
      editor: bodyEditor,
      sourceEditor,
      surface: 'header',
      headerId: 'rId-header-default',
      sectionType: 'default',
    });

    const transaction = { docChanged: true, getMeta: vi.fn(() => null) };
    listeners.headerFooterTransaction({
      editor: bodyEditor,
      sourceEditor,
      transaction,
      duration: 12,
      surface: 'footer',
      headerId: 'rId-footer-default',
      sectionType: 'default',
    });
    expect(superdocStub.config.onTransaction).toHaveBeenCalledWith({
      editor: bodyEditor,
      sourceEditor,
      transaction,
      duration: 12,
      surface: 'footer',
      headerId: 'rId-footer-default',
      sectionType: 'default',
    });
  });

  it('falls back to sourceEditor for body update and transaction payloads', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.onTransaction = vi.fn();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const bodyEditor = { options: { documentId: 'doc-1' } };
    const transaction = { docChanged: true, getMeta: vi.fn(() => null) };

    options.onUpdate({ sourceEditor: bodyEditor });
    expect(superdocStub.emit).toHaveBeenCalledWith('editor-update', {
      editor: bodyEditor,
      sourceEditor: bodyEditor,
      surface: 'body',
      headerId: null,
      sectionType: null,
    });

    options.onTransaction({
      sourceEditor: bodyEditor,
      transaction,
      duration: 7,
    });
    expect(superdocStub.config.onTransaction).toHaveBeenCalledWith({
      editor: bodyEditor,
      sourceEditor: bodyEditor,
      transaction,
      duration: 7,
      surface: 'body',
      headerId: null,
      sectionType: null,
    });
  });

  it('shows comments sidebar and tools, handles menu actions', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = {
      options: { documentId: 'doc-1' },
      commands: {
        togglePagination: vi.fn(),
        insertAiMark: vi.fn(),
      },
      state: {
        doc: { content: { size: 100 } },
        selection: { $from: { pos: 1 }, $to: { pos: 6 } },
      },
      view: {
        coordsAtPos: vi.fn((pos) =>
          pos === 1 ? { top: 100, bottom: 140, left: 10, right: 30 } : { top: 120, bottom: 160, left: 70, right: 90 },
        ),
        state: { selection: { $from: { pos: 1 }, $to: { pos: 6 } } },
      },
      getPageStyles: vi.fn(() => ({ pageMargins: {} })),
    };

    // processSelectionChange needs layers to be non-null to proceed past the guard
    wrapper.vm.$.setupState.layers = document.createElement('div');

    await nextTick();
    options.onSelectionUpdate({
      editor: editorMock,
      transaction: { selection: { $from: { pos: 1 }, $to: { pos: 6 } } },
    });
    await nextTick();
    const setupState = wrapper.vm.$.setupState;
    setupState.toolsMenuPosition.top = '12px';
    setupState.toolsMenuPosition.right = '0px';
    superdocStoreStub.selectionPosition.value = {
      left: 10,
      right: 40,
      top: 20,
      bottom: 60,
      source: 'super-editor',
    };
    await nextTick();

    const handleToolClick = wrapper.vm.$.setupState.handleToolClick;
    handleToolClick('comments');
    expect(commentsStoreStub.showAddComment).toHaveBeenCalledWith(superdocStub, 20);

    handleToolClick('ai');
    const aiMockResult = useAiMock.mock.results.at(-1)?.value;
    expect(aiMockResult?.handleAiToolClick).toHaveBeenCalled();

    commentsStoreStub.pendingComment.value = { commentId: 'new', selection: { getValues: () => ({}) } };
    await nextTick();
    const toggleArg = superdocStub.broadcastSidebarToggle.mock.calls.at(-1)[0];
    expect(toggleArg).toEqual(expect.objectContaining({ commentId: 'new' }));
    // CommentDialog is now rendered inside FloatingComments, so check for that instead
    expect(wrapper.findComponent(FloatingCommentsStub).exists()).toBe(true);

    superdocStoreStub.isReady.value = true;
    await nextTick();
    commentsStoreStub.getFloatingComments.value = [{ id: 'f1' }];
    await nextTick();
    await nextTick();
    expect(commentsStoreStub.hasInitializedLocations.value).toBe(true);
  });

  it('hides comment interactions when comments module is disabled', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.modules.comments = false;

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    superdocStoreStub.modules.comments = false;
    await nextTick();

    expect(wrapper.find('.superdoc__selection-layer').exists()).toBe(false);

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = {
      options: { documentId: 'doc-1' },
      commands: { togglePagination: vi.fn() },
      view: {
        coordsAtPos: vi.fn(() => ({ top: 100, bottom: 140, left: 10, right: 30 })),
        state: { selection: { empty: true } },
      },
      getPageStyles: vi.fn(() => ({ pageMargins: {} })),
    };

    options.onSelectionUpdate({
      editor: editorMock,
      transaction: { selection: { $from: { pos: 1 }, $to: { pos: 4 } } },
    });
    await nextTick();

    expect(superdocStoreStub.activeSelection.value).toBeNull();
    expect(wrapper.find('.superdoc__tools').exists()).toBe(false);
  });

  it('shows floating comments after imported threads and positions load', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.handleEditorLocationsUpdate.mockImplementation((positions) => {
      commentsStoreStub.getFloatingComments.value = Object.values(positions);
    });
    const importedComment = {
      commentId: null,
      importedId: 'import-1',
      documentId: 'doc-1',
      commentText: '<p>Imported</p>',
      createdTime: Date.now(),
    };

    options.onCommentsUpdate({ type: 'add', comment: importedComment });
    await nextTick();

    const { schema, doc } = createImportedCommentDoc('import-1');
    const { view, editor, pluginView } = createCommentsPluginEnvironment({ schema, doc });
    expect(pluginView).toBeDefined();

    view.coordsAtPos.mockReturnValue({ top: 20, bottom: 40, left: 10, right: 30 });
    editor.emit = vi.fn((event, payload) => {
      if (event === 'comment-positions') {
        options.onCommentLocationsUpdate({
          allCommentPositions: payload.allCommentPositions,
          allCommentIds: Object.keys(payload.allCommentPositions),
        });
      }
    });

    const forceTr = view.state.tr.setMeta(CommentsPluginKey, { type: 'force' });
    view.dispatch(forceTr);
    pluginView.update(view);

    expect(editor.emit).toHaveBeenCalledWith(
      'comment-positions',
      expect.objectContaining({
        allCommentPositions: expect.objectContaining({
          'import-1': expect.objectContaining({
            bounds: expect.objectContaining({ top: 20, left: 10 }),
          }),
        }),
      }),
    );
    expect(commentsStoreStub.handleEditorLocationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'import-1': expect.objectContaining({ threadId: 'import-1' }),
      }),
      expect.arrayContaining(['import-1']),
    );

    await nextTick();
    superdocStoreStub.isReady.value = true;
    await nextTick();

    expect(wrapper.vm.showCommentsSidebar).toBe(true);
    expect(wrapper.find('.floating-comments').exists()).toBe(true);
  });

  it('shows floating comments when the comments store exposes them through a getter', async () => {
    const superdocStub = createSuperdocStub();
    const { store, floatingCommentsState } = createCommentsStoreWithFloatingGetter();
    const wrapper = await mountComponent(superdocStub, { commentsStore: store });
    await nextTick();

    floatingCommentsState.value = [{ commentId: 'tracked-1' }];
    superdocStoreStub.isReady.value = true;
    await nextTick();

    expect(wrapper.vm.showCommentsSidebar).toBe(true);
    expect(wrapper.find('.floating-comments').exists()).toBe(true);
  });

  it('hides sidebar when comments displayMode is inline', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    commentsStoreStub.getFloatingComments.value = [{ commentId: 'c-1' }];
    commentsStoreStub.hasInitializedLocations.value = true;
    superdocStoreStub.isReady.value = true;
    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    await nextTick();

    expect(wrapper.vm.showCommentsSidebar).toBe(false);
    expect(wrapper.find('.superdoc__right-sidebar').exists()).toBe(false);
  });

  it('hides sidebar in auto mode when compact threshold is reached', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    commentsStoreStub.getFloatingComments.value = [{ commentId: 'c-1' }];
    commentsStoreStub.hasInitializedLocations.value = true;
    superdocStoreStub.isReady.value = true;
    superdocStoreStub.modules.comments.displayMode = 'auto';
    superdocStoreStub.modules.comments.compactBreakpointPx = 760;

    const rootEl = wrapper.find('.superdoc').element;
    const parentEl = rootEl.parentElement;
    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 700 });
    if (parentEl) {
      Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 700 });
    }

    wrapper.vm.recalculateCompactCommentsMode();
    await nextTick();

    expect(wrapper.vm.isCompactCommentsMode).toBe(true);
    expect(wrapper.vm.showCommentsSidebar).toBe(false);
  });

  it('closes comment bubble and suppresses immediate comment activation on right-click', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    document.body.appendChild(wrapper.element);

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    commentsStoreStub.setActiveComment.mockClear();
    commentsStoreStub.removePendingComment.mockClear();

    const layersEl = wrapper.find('.superdoc__layers').element;
    layersEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(commentsStoreStub.setActiveComment).toHaveBeenCalledWith(superdocStub, null);
    expect(commentsStoreStub.removePendingComment).toHaveBeenCalledWith(superdocStub);

    commentsStoreStub.setActiveComment.mockClear();
    options.onCommentsUpdate({ activeCommentId: 'c1', type: 'trackedChange' });
    await nextTick();

    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalledWith(superdocStub, 'c1');

    wrapper.element.remove();
  });

  it('renders compact comment popover when sidebar is disabled and there is an active thread', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    commentsStoreStub.removePendingComment.mockImplementation(() => {
      commentsStoreStub.pendingComment.value = null;
    });
    commentsStoreStub.setActiveComment.mockImplementation((_, commentId) => {
      commentsStoreStub.activeComment.value = commentId;
    });
    commentsStoreStub.pendingComment.value = { commentId: 'pending-1', selection: { selectionBounds: {} } };
    await nextTick();

    expect(wrapper.vm.showCommentsSidebar).toBe(false);
    expect(wrapper.vm.activeCompactComment).toBeTruthy();
    expect(wrapper.find('.superdoc__compact-comment-popover').exists()).toBe(true);
    expect(wrapper.findComponent(CommentDialogStub).exists()).toBe(true);
  });

  it('uses PDF DOM anchor fallback for compact popover positioning when stored bounds are unavailable', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    commentsStoreStub.pendingComment.value = {
      commentId: 'pending-1',
      selection: { source: 'pdf', selectionBounds: {} },
    };
    await nextTick();

    const rootEl = wrapper.find('.superdoc').element;
    const layersEl = wrapper.find('.superdoc__layers').element;
    const anchorEl = document.createElement('div');
    anchorEl.className = 'sd-comment-anchor';
    anchorEl.setAttribute('data-id', 'pending-1');
    rootEl.appendChild(anchorEl);

    rootEl.getBoundingClientRect = () => ({ top: 50, left: 0, right: 900, bottom: 850, width: 900, height: 800 });
    layersEl.getBoundingClientRect = () => ({ top: 100, left: 0, right: 800, bottom: 700, width: 800, height: 600 });
    anchorEl.getBoundingClientRect = () => ({ top: 180, left: 10, right: 30, bottom: 200, width: 20, height: 20 });

    superdocStoreStub.selectionPosition.value = { source: 'pdf', top: 100, left: 10, right: 20, bottom: 120 };
    await nextTick();
    await nextTick();
    const style = wrapper.vm.compactCommentPopoverStyle;
    expect(style.top).not.toBe('12px');
  });

  it('re-anchors compact popover when clicking between DOCX comment anchors', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    document.body.appendChild(wrapper.element);

    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    commentsStoreStub.pendingComment.value = {
      commentId: 'pending-1',
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    await nextTick();

    const rootEl = wrapper.find('.superdoc').element;
    const layersEl = wrapper.find('.superdoc__layers').element;
    rootEl.getBoundingClientRect = () => ({ top: 0, left: 0, right: 1000, bottom: 700, width: 1000, height: 700 });
    layersEl.getBoundingClientRect = () => ({ top: 0, left: 100, right: 900, bottom: 700, width: 800, height: 700 });

    const anchorA = document.createElement('span');
    anchorA.className = 'superdoc-comment-highlight';
    anchorA.setAttribute('data-comment-ids', 'pending');
    anchorA.getBoundingClientRect = () => ({ top: 100, left: 140, right: 200, bottom: 120, width: 60, height: 20 });

    const anchorB = document.createElement('span');
    anchorB.className = 'superdoc-comment-highlight';
    anchorB.setAttribute('data-comment-ids', 'pending');
    anchorB.getBoundingClientRect = () => ({ top: 180, left: 420, right: 500, bottom: 200, width: 80, height: 20 });

    layersEl.appendChild(anchorA);
    layersEl.appendChild(anchorB);

    const dispatchPointerDown = (target, x, y) => {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'button', { value: 0 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      Object.defineProperty(event, 'clientX', { value: x });
      Object.defineProperty(event, 'clientY', { value: y });
      target.dispatchEvent(event);
    };

    dispatchPointerDown(anchorA, 160, 112);
    await nextTick();
    const firstStyle = wrapper.vm.compactCommentPopoverStyle;

    dispatchPointerDown(anchorB, 450, 190);
    await nextTick();
    const secondStyle = wrapper.vm.compactCommentPopoverStyle;

    expect(firstStyle.left).not.toBe(secondStyle.left);
    expect(firstStyle.top).not.toBe(secondStyle.top);

    wrapper.element.remove();
  });

  it('does not early-close compact popover on DOCX pointerdown outside anchors', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();
    document.body.appendChild(wrapper.element);

    commentsStoreStub.removePendingComment.mockClear();
    commentsStoreStub.setActiveComment.mockClear();

    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    commentsStoreStub.pendingComment.value = {
      commentId: 'pending-1',
      selection: { source: 'super-editor', selectionBounds: {} },
    };
    await nextTick();

    expect(wrapper.find('.superdoc__compact-comment-popover').exists()).toBe(true);

    const layersEl = wrapper.find('.superdoc__layers').element;
    const outsideNode = document.createElement('div');
    layersEl.appendChild(outsideNode);

    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'button', { value: 0 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    Object.defineProperty(event, 'clientX', { value: 300 });
    Object.defineProperty(event, 'clientY', { value: 300 });
    outsideNode.dispatchEvent(event);
    await nextTick();

    expect(commentsStoreStub.removePendingComment).not.toHaveBeenCalled();
    expect(commentsStoreStub.setActiveComment).not.toHaveBeenCalledWith(superdocStub, null);
    expect(wrapper.find('.superdoc__compact-comment-popover').exists()).toBe(true);

    wrapper.element.remove();
  });

  it('does not render compact comment popover when sidebar remains enabled', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    commentsStoreStub.pendingComment.value = { commentId: 'pending-1', selection: { selectionBounds: {} } };
    await nextTick();

    expect(wrapper.vm.showCommentsSidebar).toBeTruthy();
    expect(wrapper.find('.superdoc__compact-comment-popover').exists()).toBe(false);
  });

  it('closes compact comment popover on Escape and restores focus', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    commentsStoreStub.pendingComment.value = { commentId: 'pending-1', selection: { selectionBounds: {} } };
    await nextTick();

    expect(wrapper.find('.superdoc__compact-comment-popover').exists()).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );
    await nextTick();
    await nextTick();

    expect(commentsStoreStub.removePendingComment).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('hides floating comments sidebar entirely in viewing mode even with comment positions', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.documentMode = 'viewing';
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    commentsStoreStub.getFloatingComments.value = [{ commentId: 'c-1' }];
    commentsStoreStub.hasInitializedLocations.value = true;
    superdocStoreStub.isReady.value = true;
    await nextTick();

    expect(wrapper.vm.showCommentsSidebar).toBe(false);
    expect(wrapper.find('.superdoc__right-sidebar').exists()).toBe(false);
  });

  it('computes compact comments mode for explicit sidebar/inline display modes', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);

    superdocStoreStub.modules.comments.displayMode = 'sidebar';
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(false);
  });

  it('computes compact comments mode in auto using compactBreakpointPx override', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const rootEl = wrapper.find('.superdoc').element;
    const parentEl = rootEl.parentElement;
    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 700 });
    if (parentEl) {
      Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 700 });
    }

    superdocStoreStub.modules.comments.displayMode = 'auto';
    superdocStoreStub.modules.comments.compactBreakpointPx = 760;
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);

    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 900 });
    if (parentEl) {
      Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 900 });
    }
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(false);
  });

  it('switches auto mode directly at compactBreakpointPx threshold', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const rootEl = wrapper.find('.superdoc').element;
    const parentEl = rootEl.parentElement;
    superdocStoreStub.modules.comments.displayMode = 'auto';
    superdocStoreStub.modules.comments.compactBreakpointPx = 760;

    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 700 });
    if (parentEl) Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 700 });
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);

    // Still compact below threshold
    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 759 });
    if (parentEl) Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 759 });
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);

    // Exits compact at/above threshold
    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 760 });
    if (parentEl) Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 760 });
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(false);
  });

  it('switches auto mode directly at measured document threshold when compactBreakpointPx is absent', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const rootEl = wrapper.find('.superdoc').element;
    const documentEl = wrapper.find('.superdoc__document').element;
    const parentEl = rootEl.parentElement;
    superdocStoreStub.modules.comments.displayMode = 'auto';
    delete superdocStoreStub.modules.comments.compactBreakpointPx;
    delete superdocStoreStub.modules.comments.compactMeasurementSelector;

    // Measured threshold = document(816) + sidebar(320) + gutter(24) = 1160
    Object.defineProperty(documentEl, 'clientWidth', { configurable: true, value: 816 });
    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 1130 });
    if (parentEl) Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 1130 });
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);

    // Still compact below threshold
    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 1159 });
    if (parentEl) Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 1159 });
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);

    Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: 1160 });
    if (parentEl) Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: 1160 });
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(false);
  });

  it('uses compactMeasurementSelector as width source in auto mode when target exists', async () => {
    const superdocStub = createSuperdocStub();
    const measurementTarget = document.createElement('div');
    measurementTarget.id = 'compact-shell';
    Object.defineProperty(measurementTarget, 'clientWidth', { configurable: true, value: 700 });
    document.body.appendChild(measurementTarget);

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    superdocStoreStub.modules.comments.displayMode = 'auto';
    superdocStoreStub.modules.comments.compactMeasurementSelector = '#compact-shell';
    superdocStoreStub.modules.comments.compactBreakpointPx = 760;
    wrapper.vm.recalculateCompactCommentsMode();

    expect(wrapper.vm.isCompactCommentsMode).toBe(true);
    measurementTarget.remove();
  });

  it('holds compact state when measured auto width is invalid (0)', async () => {
    const superdocStub = createSuperdocStub();
    const measurementTarget = document.createElement('div');
    measurementTarget.id = 'compact-shell-invalid';
    Object.defineProperty(measurementTarget, 'clientWidth', { configurable: true, value: 0 });
    document.body.appendChild(measurementTarget);

    superdocStub.config.modules.comments.compactMeasurementSelector = '#compact-shell-invalid';
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    superdocStoreStub.modules.comments.displayMode = 'inline';
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);

    superdocStoreStub.modules.comments.displayMode = 'auto';
    superdocStoreStub.modules.comments.compactBreakpointPx = 760;
    wrapper.vm.recalculateCompactCommentsMode();
    expect(wrapper.vm.isCompactCommentsMode).toBe(true);
    measurementTarget.remove();
  });

  it('ignores comment location updates while in viewing mode', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.documentMode = 'viewing';
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    options.onCommentLocationsUpdate({
      allCommentPositions: {
        'comment-1': { threadId: 'comment-1', bounds: { top: 10, left: 5, right: 20, bottom: 30 } },
      },
      allCommentIds: ['comment-1'],
    });
    await nextTick();

    expect(commentsStoreStub.handleEditorLocationsUpdate).not.toHaveBeenCalled();
    expect(commentsStoreStub.clearEditorCommentPositions).toHaveBeenCalled();
  });

  it('forwards empty comment position payloads to store-level guard', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    options.onCommentLocationsUpdate({
      allCommentPositions: {},
      allCommentIds: [],
    });
    await nextTick();

    expect(commentsStoreStub.handleEditorLocationsUpdate).toHaveBeenCalledWith({}, []);
  });

  it('clears PDF selections when viewing mode is active to keep tools hidden', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.documentMode = 'viewing';
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const setupState = wrapper.vm.$.setupState;
    setupState.toolsMenuPosition.top = '120px';
    superdocStoreStub.selectionPosition.value = {
      left: 5,
      right: 25,
      top: 50,
      bottom: 90,
      source: 'pdf',
    };
    await nextTick();

    expect(wrapper.vm.showToolsFloatingMenu).toBeTruthy();

    setupState.handleSelectionChange({
      selectionBounds: { top: 10, left: 10, right: 20, bottom: 30 },
      source: 'pdf',
    });
    await nextTick();

    expect(superdocStoreStub.selectionPosition.value).toBeNull();
    expect(setupState.toolsMenuPosition.top).toBeNull();
    expect(wrapper.vm.showToolsFloatingMenu).toBeFalsy();
  });

  it('does not crash when selectionUpdate carries stale positions after new file insert', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = {
      options: { documentId: 'doc-1' },
      view: {
        coordsAtPos: vi.fn((pos) => {
          if (pos > 5) {
            throw new RangeError('Position out of range');
          }
          return { top: pos, bottom: pos + 10, left: 0, right: 0 };
        }),
        state: { selection: { $from: { pos: 1 }, $to: { pos: 1 }, empty: false } },
      },
      getPageStyles: vi.fn(() => ({ pageMargins: {} })),
    };

    const triggerSelectionUpdate = () =>
      options.onSelectionUpdate({
        editor: editorMock,
        // Simulate a stale transaction selection that is past the new doc length
        transaction: { selection: { $from: { pos: 10 }, $to: { pos: 10 } } },
      });

    expect(triggerSelectionUpdate).not.toThrow();
  });

  // Note: The handlePresentationEditorReady test was removed because that function
  // no longer exists. PresentationEditor now registers itself automatically in the
  // constructor and manages zoom/layout data internally.

  it('clears selection updates in viewing mode to keep the tools bubble hidden', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.documentMode = 'viewing';
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const setupState = wrapper.vm.$.setupState;
    setupState.toolsMenuPosition.top = '100px';
    superdocStoreStub.selectionPosition.value = {
      left: 10,
      right: 40,
      top: 50,
      bottom: 70,
      source: 'super-editor',
    };
    await nextTick();

    expect(wrapper.vm.showToolsFloatingMenu).toBeTruthy();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = { options: { documentId: 'doc-1' } };

    options.onSelectionUpdate({
      editor: editorMock,
      transaction: { selection: { $from: { pos: 1 }, $to: { pos: 1 } } },
    });
    await nextTick();

    expect(superdocStoreStub.selectionPosition.value).toBeNull();
    expect(setupState.toolsMenuPosition.top).toBeNull();
    expect(wrapper.vm.showToolsFloatingMenu).toBeFalsy();
  });

  it('ignores queued RAF selection work if mode switches to viewing before frame runs', async () => {
    const rafQueue = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      rafQueue[id - 1] = null;
    });

    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = {
      options: { documentId: 'doc-1' },
      state: {
        doc: { content: { size: 10 } },
        selection: { $from: { pos: 1 }, $to: { pos: 6 } },
      },
      view: {
        state: {
          doc: { content: { size: 10 } },
          selection: { $from: { pos: 1 }, $to: { pos: 6 } },
        },
        coordsAtPos: vi.fn((pos) =>
          pos === 1 ? { top: 100, bottom: 140, left: 10, right: 30 } : { top: 120, bottom: 160, left: 70, right: 90 },
        ),
      },
    };

    useSelectionMock.mockClear();
    options.onSelectionUpdate({ editor: editorMock });

    expect(rafQueue).toHaveLength(1);

    superdocStub.config.documentMode = 'viewing';
    rafQueue[0](Date.now());
    await nextTick();

    expect(useSelectionMock).not.toHaveBeenCalled();
    expect(superdocStoreStub.selectionPosition.value).toBeNull();
    expect(wrapper.vm.showToolsFloatingMenu).toBeFalsy();
  });

  it('hides tools bubble when selection is cleared (SD-1241)', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const options = wrapper.findComponent(SuperEditorStub).props('options');
    const editorMock = {
      options: { documentId: 'doc-1' },
      commands: { togglePagination: vi.fn() },
      view: {
        coordsAtPos: vi.fn((pos) =>
          pos === 1 ? { top: 100, bottom: 140, left: 10, right: 30 } : { top: 120, bottom: 160, left: 70, right: 90 },
        ),
        state: { selection: { empty: true } },
      },
      getPageStyles: vi.fn(() => ({ pageMargins: {} })),
    };

    // First, make a selection to show the tools menu
    options.onSelectionUpdate({
      editor: editorMock,
      transaction: { selection: { $from: { pos: 1 }, $to: { pos: 6 } } },
    });
    await nextTick();

    const setupState = wrapper.vm.$.setupState;
    setupState.toolsMenuPosition.top = '100px';
    setupState.toolsMenuPosition.right = '0px';
    superdocStoreStub.selectionPosition.value = {
      left: 10,
      right: 90,
      top: 100,
      bottom: 160,
      source: 'super-editor',
    };
    await nextTick();

    // Verify tools menu is visible
    expect(wrapper.vm.showToolsFloatingMenu).toBe(true);

    // Clear the selection (simulating cursor change/deselection)
    setupState.resetSelection();
    await nextTick();

    // Verify both selectionPosition and toolsMenuPosition.top are cleared
    expect(superdocStoreStub.selectionPosition.value).toBeNull();
    expect(setupState.toolsMenuPosition.top).toBeNull();

    // Verify tools menu is now hidden (computed returns falsy value)
    expect(wrapper.vm.showToolsFloatingMenu).toBeFalsy();
  });

  it('showToolsFloatingMenu returns falsy when selectionPosition is null even if toolsMenuPosition.top is set', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const setupState = wrapper.vm.$.setupState;

    // Set toolsMenuPosition.top but leave selectionPosition null
    setupState.toolsMenuPosition.top = '100px';
    superdocStoreStub.selectionPosition.value = null;
    await nextTick();

    // Tools menu should be hidden because selectionPosition is null
    expect(wrapper.vm.showToolsFloatingMenu).toBeFalsy();
  });

  it('hides tools bubble when updateSelection receives no coordinates', async () => {
    const superdocStub = createSuperdocStub();
    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const setupState = wrapper.vm.$.setupState;

    // Set up initial state with selection and tools menu visible
    setupState.toolsMenuPosition.top = '100px';
    superdocStoreStub.selectionPosition.value = {
      left: 10,
      right: 90,
      top: 100,
      bottom: 160,
      source: 'super-editor',
    };
    await nextTick();

    expect(wrapper.vm.showToolsFloatingMenu).toBeTruthy();

    // Call updateSelection with no coordinates (simulates deselection)
    setupState.updateSelection({});
    await nextTick();

    // Both should be cleared
    expect(superdocStoreStub.selectionPosition.value).toBeNull();
    expect(setupState.toolsMenuPosition.top).toBeNull();
    expect(wrapper.vm.showToolsFloatingMenu).toBeFalsy();
  });

  it('merges partial trackChangeActiveHighlightColors with base colors', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.modules.comments = {
      trackChangeHighlightColors: {
        insertBorder: '#00ff00',
        deleteBackground: '#0000ff',
      },
      trackChangeActiveHighlightColors: {
        insertBorder: '#ff0000', // only override this one
      },
    };

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const styleVars = wrapper.vm.superdocStyleVars;

    // Active insertBorder should be overridden
    expect(styleVars['--sd-tracked-changes-insert-border']).toBe('#ff0000');
    // deleteBackground should be inherited from base config
    expect(styleVars['--sd-tracked-changes-delete-background']).toBe('#0000ff');
  });

  it('sets track change CSS vars from base config when no active config provided', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.modules.comments = {
      trackChangeHighlightColors: {
        insertBorder: '#11ff11',
        deleteBorder: '#ff1111',
        formatBorder: '#1111ff',
      },
    };

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const styleVars = wrapper.vm.superdocStyleVars;

    expect(styleVars['--sd-tracked-changes-insert-border']).toBe('#11ff11');
    expect(styleVars['--sd-tracked-changes-delete-border']).toBe('#ff1111');
    expect(styleVars['--sd-tracked-changes-format-border']).toBe('#1111ff');
  });

  it('sets comment highlight hover color CSS var', async () => {
    const superdocStub = createSuperdocStub();
    superdocStub.config.modules.comments = {
      highlightHoverColor: '#abcdef88',
    };

    const wrapper = await mountComponent(superdocStub);
    await nextTick();

    const styleVars = wrapper.vm.superdocStyleVars;
    expect(styleVars['--sd-comments-highlight-hover']).toBe('#abcdef88');
  });

  describe('viewport-change + fit-to-container', () => {
    // Letter page: 8.5in * 96 = 816px base width through the page-styles path.
    const stubPageStylesEditor = (superdocStub) => {
      superdocStub.activeEditor = {
        getPageStyles: vi.fn(() => ({ pageSize: { width: 8.5, height: 11 } })),
      };
    };

    const setContainerWidth = (wrapper, width) => {
      const rootEl = wrapper.find('.superdoc').element;
      const parentEl = rootEl.parentElement;
      Object.defineProperty(rootEl, 'clientWidth', { configurable: true, value: width });
      if (parentEl) Object.defineProperty(parentEl, 'clientWidth', { configurable: true, value: width });
    };

    const viewportChangeCalls = (superdocStub) =>
      superdocStub.emit.mock.calls.filter(([name]) => name === 'viewport-change');

    it('does not emit viewport-change before isReady', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);

      const wrapper = await mountComponent(superdocStub);
      superdocStoreStub.isReady.value = false;
      await nextTick();

      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      await nextTick();

      expect(viewportChangeCalls(superdocStub).length).toBe(0);
    });

    it('emits viewport-change with page-styles-derived widths when ready', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual({
        availableWidth: 1200,
        documentWidth: 816,
        fitZoom: 147,
      });
    });

    it('keeps documentWidth zoom-independent (page styles win over scaled DOM)', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);

      const wrapper = await mountComponent(superdocStub);
      // A zoom applied before the first measurement must not corrupt the base.
      superdocStoreStub.activeZoom.value = 50;
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(1);
      expect(calls[0][1].documentWidth).toBe(816);
      expect(calls[0][1].fitZoom).toBe(147);
    });

    it('falls back to page styles when laid-out pages are unavailable', async () => {
      const superdocStub = createSuperdocStub();
      superdocStub.activeEditor = {
        getPages: vi.fn(() => {
          throw new Error('layout not ready');
        }),
        getPageStyles: vi.fn(() => ({ pageSize: { width: 8.5, height: 11 } })),
      };

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual({
        availableWidth: 1200,
        documentWidth: 816,
        fitZoom: 147,
      });
    });

    it('dedupes width changes that round to the same fit', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      // 1199 / 816 rounds to the same fitZoom (147) as 1200 / 816.
      setContainerWidth(wrapper, 1199);
      wrapper.vm.recalculateCompactCommentsMode();
      await nextTick();
      await nextTick();

      expect(viewportChangeCalls(superdocStub).length).toBe(1);
      // The event dedupes, but stored metrics stay latest: reads must see
      // the 1199 measurement the deduped event skipped.
      expect(superdocStoreStub.viewportMetrics.value.availableWidth).toBe(1199);

      // A materially different width emits again.
      setContainerWidth(wrapper, 600);
      wrapper.vm.recalculateCompactCommentsMode();
      await nextTick();
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(2);
      expect(calls[1][1].fitZoom).toBe(74);
    });

    it('skips emission entirely while no document width is measurable', async () => {
      const superdocStub = createSuperdocStub();
      // No activeEditor and no laid-out DOM: base width unresolvable.

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      expect(viewportChangeCalls(superdocStub).length).toBe(0);
    });

    it('does not scan PDF page DOM for DOCX-only documents', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);

      const wrapper = await mountComponent(superdocStub);
      const rootEl = wrapper.find('.superdoc').element;
      const querySelectorAllSpy = vi.spyOn(rootEl, 'querySelectorAll');

      const pageEl = document.createElement('div');
      pageEl.className = 'sd-pdf-viewer-page';
      rootEl.appendChild(pageEl);

      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      expect(querySelectorAllSpy).not.toHaveBeenCalledWith('.sd-pdf-viewer-page');
      expect(viewportChangeCalls(superdocStub)[0][1].documentWidth).toBe(816);
    });

    const zoomChangeCalls = (superdocStub) => superdocStub.emit.mock.calls.filter(([name]) => name === 'zoomChange');

    it('stores the latest metrics for getViewportMetrics()', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      expect(superdocStoreStub.viewportMetrics.value).toEqual({
        availableWidth: 1200,
        documentWidth: 816,
        fitZoom: 147,
      });
    });

    it('fit-width mode applies the fit with default clamping (max 100)', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);
      superdocStub.config.zoom = { mode: 'fit-width' };

      const wrapper = await mountComponent(superdocStub);
      superdocStoreStub.zoomMode.value = 'fit-width';
      setContainerWidth(wrapper, 600);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      // fitZoom = 600 / 816 = 74; within [10, 100] so applied as-is. The
      // fit writes the store directly (setZoom would flip mode to manual).
      expect(superdocStoreStub.activeZoom.value).toBe(74);
      expect(zoomChangeCalls(superdocStub)).toEqual([['zoomChange', { zoom: 74, mode: 'fit-width' }]]);
      expect(viewportChangeCalls(superdocStub)[0][1].fitZoom).toBe(74);
    });

    it('clamps the applied fit but emits the raw fitZoom', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);
      superdocStub.config.zoom = { mode: 'fit-width', fitWidth: { min: 80 } };

      const wrapper = await mountComponent(superdocStub);
      superdocStoreStub.zoomMode.value = 'fit-width';
      setContainerWidth(wrapper, 408);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      // Raw fit is 50 (408 / 816); applied value clamps to min 80.
      expect(viewportChangeCalls(superdocStub)[0][1].fitZoom).toBe(50);
      expect(superdocStoreStub.activeZoom.value).toBe(80);
    });

    it('padding shapes the applied fit only, never the metrics', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);
      superdocStub.config.zoom = { mode: 'fit-width', fitWidth: { padding: 96 } };

      const wrapper = await mountComponent(superdocStub);
      superdocStoreStub.zoomMode.value = 'fit-width';
      superdocStoreStub.activeZoom.value = 50;
      setContainerWidth(wrapper, 912);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      // Metrics are policy-free: availableWidth stays 912 and fitZoom is
      // the raw ratio. The applied fit reserves the padding: (912 - 96) /
      // 816 = 100.
      expect(viewportChangeCalls(superdocStub)[0][1]).toEqual({
        availableWidth: 912,
        documentWidth: 816,
        fitZoom: 112,
      });
      expect(superdocStoreStub.activeZoom.value).toBe(100);
    });

    it('subtracts the comments sidebar width through the owned template ref', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);

      const wrapper = await mountComponent(superdocStub);
      commentsStoreStub.pendingComment.value = { commentId: 'pending-1', selection: { selectionBounds: {} } };
      await nextTick();

      const sidebarEl = wrapper.find('.superdoc__right-sidebar').element;
      Object.defineProperty(sidebarEl, 'offsetWidth', { configurable: true, value: 240 });

      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual({
        availableWidth: 960,
        documentWidth: 816,
        fitZoom: 118,
      });
    });

    it('does not re-apply zoom when the target equals the current zoom', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);
      superdocStub.config.zoom = { mode: 'fit-width' };

      const wrapper = await mountComponent(superdocStub);
      superdocStoreStub.zoomMode.value = 'fit-width';
      superdocStoreStub.activeZoom.value = 74;
      setContainerWidth(wrapper, 600);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      // Same-value guard: target 74 equals current zoom, so no write and
      // no zoomChange, while the viewport-change event still emits.
      expect(superdocStoreStub.activeZoom.value).toBe(74);
      expect(zoomChangeCalls(superdocStub).length).toBe(0);
      expect(viewportChangeCalls(superdocStub).length).toBe(1);
    });

    it('manual mode never applies the fit (metrics still emit)', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);
      superdocStub.config.zoom = { fitWidth: { min: 25 } };

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 600);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      expect(viewportChangeCalls(superdocStub).length).toBe(1);
      expect(superdocStoreStub.activeZoom.value).toBe(100);
      expect(zoomChangeCalls(superdocStub).length).toBe(0);
    });

    it('switching zoomMode to fit-width applies the fit immediately', async () => {
      const superdocStub = createSuperdocStub();
      stubPageStylesEditor(superdocStub);
      superdocStub.config.zoom = {};

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 600);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      expect(superdocStoreStub.activeZoom.value).toBe(100);

      superdocStoreStub.zoomMode.value = 'fit-width';
      await nextTick();

      expect(superdocStoreStub.activeZoom.value).toBe(74);
      expect(zoomChangeCalls(superdocStub)).toEqual([['zoomChange', { zoom: 74, mode: 'fit-width' }]]);
    });

    it('resolves documentWidth as the widest page across documents', async () => {
      const superdocStub = createSuperdocStub();

      const wrapper = await mountComponent(superdocStub);
      // Two DOCX documents: portrait letter (8.5in) and landscape (11in).
      // Zoom is global, so the fit must target the widest page.
      superdocStoreStub.documents.value = [
        {
          id: 'doc-portrait',
          type: DOCX,
          editorMountNonce: ref(0),
          getEditor: vi.fn(() => ({ getPageStyles: () => ({ pageSize: { width: 8.5, height: 11 } }) })),
          setEditor: vi.fn(),
        },
        {
          id: 'doc-landscape',
          type: DOCX,
          editorMountNonce: ref(0),
          getEditor: vi.fn(() => ({ getPageStyles: () => ({ pageSize: { width: 11, height: 8.5 } }) })),
          setEditor: vi.fn(),
        },
      ];
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(1);
      // 11in * 96 = 1056: the widest page wins over 816.
      expect(calls[0][1].documentWidth).toBe(1056);
      expect(calls[0][1].fitZoom).toBe(114);
    });

    it('prefers the widest laid-out page over body page styles (landscape sections)', async () => {
      const superdocStub = createSuperdocStub();
      // Portrait body section (8.5in) but a laid-out interior landscape
      // page: the fit must target what the renderer paints (getPages max),
      // exactly like SuperEditor's own container sizing.
      superdocStub.activeEditor = {
        getPages: vi.fn(() => [{ size: { w: 816 } }, { size: { w: 1056 } }]),
        getPageStyles: vi.fn(() => ({ pageSize: { width: 8.5, height: 11 } })),
      };

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(1);
      expect(calls[0][1].documentWidth).toBe(1056);
      expect(calls[0][1].fitZoom).toBe(114);
    });

    it('re-evaluates document width after pagination updates', async () => {
      const superdocStub = createSuperdocStub();
      let pages = [{ size: { w: 816 } }];
      superdocStub.activeEditor = {
        getPages: vi.fn(() => pages),
        getPageStyles: vi.fn(() => ({ pageSize: { width: 8.5, height: 11 } })),
      };

      const wrapper = await mountComponent(superdocStub);
      setContainerWidth(wrapper, 1200);
      wrapper.vm.recalculateCompactCommentsMode();
      superdocStoreStub.isReady.value = true;
      await nextTick();

      expect(viewportChangeCalls(superdocStub)[0][1].documentWidth).toBe(816);

      pages = [{ size: { w: 816 } }, { size: { w: 1056 } }];
      superdocStub.emit.mockClear();
      superdocStub.emit('pagination-update', { totalPages: 2, superdoc: superdocStub });

      expect(viewportChangeCalls(superdocStub).length).toBe(0);
      await nextTick();

      const calls = viewportChangeCalls(superdocStub);
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual({
        availableWidth: 1200,
        documentWidth: 1056,
        fitZoom: 114,
      });
    });

    it('resolves PDF page width scale-relatively (zoom-sync state cannot corrupt the base)', async () => {
      const superdocStub = createSuperdocStub();

      const wrapper = await mountComponent(superdocStub);
      superdocStoreStub.documents.value = [
        {
          id: 'pdf-1',
          type: PDF,
          data: { name: 'doc.pdf' },
          editorMountNonce: ref(0),
          setEditor: vi.fn(),
          getEditor: vi.fn(() => null),
        },
      ];
      await nextTick();

      // A rendered 612pt PDF page at 50% viewer zoom measures 408px with
      // --scale-factor 2/3 (zoom * 96/72). The store zoom claims 100% (a
      // seeded zoom the viewer has not applied yet); the resolver must
      // trust the page's actual scale factor and report 816 regardless.
      const pageEl = document.createElement('div');
      pageEl.className = 'sd-pdf-viewer-page';
      Object.defineProperty(pageEl, 'clientWidth', { configurable: true, value: 408 });
      wrapper.find('.superdoc').element.appendChild(pageEl);

      const originalGetComputedStyle = window.getComputedStyle.bind(window);
      const computedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
        if (el === pageEl) {
          return { getPropertyValue: (prop) => (prop === '--scale-factor' ? `${2 / 3}` : '') };
        }
        return originalGetComputedStyle(el, pseudo);
      });

      try {
        setContainerWidth(wrapper, 1200);
        wrapper.vm.recalculateCompactCommentsMode();
        superdocStoreStub.isReady.value = true;
        await nextTick();

        const calls = viewportChangeCalls(superdocStub);
        expect(calls.length).toBe(1);
        expect(calls[0][1].documentWidth).toBeCloseTo(816, 6);
        expect(calls[0][1].fitZoom).toBe(147);
      } finally {
        computedStyleSpy.mockRestore();
      }
    });
  });

  describe('DOCX rendering path', () => {
    it('renders DOCX documents through the v1 SuperEditor', async () => {
      const superdocStub = createSuperdocStub();
      const wrapper = await mountComponent(superdocStub);
      await nextTick();
      expect(wrapper.find('.super-editor-stub').exists()).toBe(true);
    });
  });
});
