import { describe, expect, it, mock } from 'bun:test';
import type { DocumentInfo, NodeAddress, SDNodeResult, SDFindResult } from './types/index.js';
import type {
  CommentsAdapter,
  CommentsCreateInput,
  CommentsPatchInput,
  CommentsDeleteInput,
  GetCommentInput,
} from './comments/comments.js';
import type { SelectionMutationAdapter } from './selection-mutation.js';
import type { FindAdapter } from './find/find.js';
import type { GetNodeAdapter } from './get-node/get-node.js';
import type { GetAdapter } from './get/get.js';
import type { TrackChangesAdapter } from './track-changes/track-changes.js';
import type { WriteAdapter } from './write/write.js';
import { createDocumentApi, type DocumentApiAdapters } from './index.js';
import type { CommentInfo, CommentsListQuery, CommentsListResult } from './comments/comments.types.js';
import type { CreateAdapter } from './create/create.js';
import type { ListsAdapter } from './lists/lists.js';
import type { CapabilitiesAdapter, DocumentApiCapabilities } from './capabilities/capabilities.js';
import type { HistoryAdapter } from './history/history.js';
import type { TablesAdapter } from './index.js';

function makeFindAdapter(result: SDFindResult): FindAdapter {
  return { find: mock(() => result) };
}

function makeGetAdapter(): GetAdapter {
  return {
    get: mock(() => ({ modelVersion: 'sdm/1' as const, body: [] })),
  };
}

function makeGetNodeAdapter(result: SDNodeResult): GetNodeAdapter {
  return {
    getNode: mock(() => result),
    getNodeById: mock((_input) => result),
  };
}

function makeGetTextAdapter(text = '') {
  return {
    getText: mock((_input) => text),
  };
}

function makeInfoAdapter(result?: Partial<DocumentInfo>) {
  const defaultResult: DocumentInfo = {
    counts: {
      words: 0,
      characters: 0,
      paragraphs: 0,
      headings: 0,
      tables: 0,
      images: 0,
      comments: 0,
      trackedChanges: 0,
      sdtFields: 0,
      lists: 0,
    },
    outline: [],
    capabilities: {
      canFind: true,
      canGetNode: true,
      canComment: true,
      canReplace: true,
    },
    revision: '0',
  };

  return {
    info: mock((_input) => ({
      ...defaultResult,
      ...result,
      counts: {
        ...defaultResult.counts,
        ...(result?.counts ?? {}),
      },
      capabilities: {
        ...defaultResult.capabilities,
        ...(result?.capabilities ?? {}),
      },
      outline: result?.outline ?? defaultResult.outline,
    })),
  };
}

function makeCommentsAdapter(): CommentsAdapter {
  return {
    add: mock(() => ({
      success: true as const,
      id: 'c1',
      inserted: [{ kind: 'entity' as const, entityType: 'comment' as const, entityId: 'c1' }],
    })),
    edit: mock(() => ({ success: true as const })),
    reply: mock(() => ({
      success: true as const,
      id: 'c2',
      inserted: [{ kind: 'entity' as const, entityType: 'comment' as const, entityId: 'c2' }],
    })),
    move: mock(() => ({ success: true as const })),
    resolve: mock(() => ({ success: true as const })),
    remove: mock(() => ({ success: true as const })),
    setInternal: mock(() => ({ success: true as const })),
    setActive: mock(() => ({ success: true as const })),
    goTo: mock(() => ({ success: true as const })),
    get: mock(() => ({
      address: { kind: 'entity' as const, entityType: 'comment' as const, entityId: 'c1' },
      commentId: 'c1',
      status: 'open' as const,
    })),
    list: mock(() => ({ evaluatedRevision: 'r1', total: 0, items: [], page: { limit: 0, offset: 0, returned: 0 } })),
  };
}

function makeWriteAdapter(): WriteAdapter {
  const textReceipt = {
    success: true as const,
    resolution: {
      target: { kind: 'text' as const, blockId: 'p1', range: { start: 0, end: 0 } },
      range: { from: 1, to: 1 },
      text: '',
    },
  };
  const sdReceipt = {
    success: true as const,
    resolution: {
      target: {
        kind: 'text' as const,
        blockId: 'p1',
        range: { start: 0, end: 0 },
      },
    },
  };
  return {
    write: mock(() => textReceipt),
    insertStructured: mock(() => sdReceipt),
    replaceStructured: mock(() => sdReceipt),
  };
}

function makeSelectionMutationAdapter(): SelectionMutationAdapter {
  return {
    execute: mock(() => ({
      success: true as const,
      resolution: {
        target: { kind: 'text' as const, blockId: 'p1', range: { start: 0, end: 2 } },
        range: { from: 1, to: 3 },
        text: 'Hi',
      },
    })),
  };
}

function makeTrackChangesAdapter(): TrackChangesAdapter {
  return {
    list: mock((_input) => ({
      evaluatedRevision: 'r1',
      total: 0,
      items: [],
      page: { limit: 0, offset: 0, returned: 0 },
    })),
    get: mock((input: { id: string }) => ({
      address: { kind: 'entity' as const, entityType: 'trackedChange' as const, entityId: input.id },
      id: input.id,
      type: 'insert' as const,
    })),
    accept: mock((_input) => ({ success: true as const })),
    reject: mock((_input) => ({ success: true as const })),
    acceptAll: mock((_input) => ({ success: true as const })),
    rejectAll: mock((_input) => ({ success: true as const })),
    decideRange: mock((_input) => ({ success: true as const })),
  };
}

function makeCreateAdapter(): CreateAdapter {
  return {
    paragraph: mock(() => ({
      success: true as const,
      paragraph: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'new-p' },
      insertionPoint: { kind: 'text' as const, blockId: 'new-p', range: { start: 0, end: 0 } },
    })),
    heading: mock(() => ({
      success: true as const,
      heading: { kind: 'block' as const, nodeType: 'heading' as const, nodeId: 'new-h' },
      insertionPoint: { kind: 'text' as const, blockId: 'new-h', range: { start: 0, end: 0 } },
    })),
    table: mock(() => ({
      success: true as const,
      table: { kind: 'block' as const, nodeType: 'table' as const, nodeId: 'new-t' },
    })),
  };
}

function makeListsAdapter(): ListsAdapter {
  return {
    list: mock(() => ({ evaluatedRevision: 'r1', total: 0, items: [], page: { limit: 0, offset: 0, returned: 0 } })),
    get: mock(() => ({
      address: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
      kind: 'ordered' as const,
      level: 0,
      text: 'List item',
    })),
    insert: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-2' },
      insertionPoint: { kind: 'text' as const, blockId: 'li-2', range: { start: 0, end: 0 } },
    })),
    indent: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    outdent: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    create: mock(() => ({
      success: true as const,
      listId: '99',
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    attach: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    detach: mock(() => ({
      success: true as const,
      paragraph: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' },
    })),
    join: mock(() => ({
      success: true as const,
      listId: '1',
    })),
    canJoin: mock(() => ({
      canJoin: true as const,
      adjacentListId: '2',
    })),
    separate: mock(() => ({
      success: true as const,
      listId: '99',
      numId: 99,
    })),
    setLevel: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    setValue: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    continuePrevious: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    canContinuePrevious: mock(() => ({
      canContinue: true as const,
      previousListId: '1',
    })),
    setLevelRestart: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
    })),
    convertToText: mock(() => ({
      success: true as const,
      paragraph: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' },
    })),
  };
}

const TABLE_MUTATION_RESULT = {
  success: true as const,
  table: { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' },
};

function makeTablesAdapter(): TablesAdapter {
  const mutation = mock(() => ({ ...TABLE_MUTATION_RESULT }));
  return {
    convertFromText: mutation,
    delete: mutation,
    clearContents: mutation,
    move: mutation,
    split: mutation,
    convertToText: mutation,
    setLayout: mutation,
    insertRow: mutation,
    deleteRow: mutation,
    moveRow: mutation,
    setRowHeight: mutation,
    distributeRows: mutation,
    setRowOptions: mutation,
    insertColumn: mutation,
    deleteColumn: mutation,
    moveColumn: mutation,
    setColumnWidth: mutation,
    distributeColumns: mutation,
    insertCell: mutation,
    deleteCell: mutation,
    mergeCells: mutation,
    unmergeCells: mutation,
    splitCell: mutation,
    setCellProperties: mutation,
    sort: mutation,
    setAltText: mutation,
    setStyle: mutation,
    clearStyle: mutation,
    setStyleOption: mutation,
    setBorder: mutation,
    clearBorder: mutation,
    applyBorderPreset: mutation,
    setShading: mutation,
    clearShading: mutation,
    setTablePadding: mutation,
    setCellPadding: mutation,
    setCellSpacing: mutation,
    clearCellSpacing: mutation,
    get: mock(() => ({
      nodeId: 't1',
      address: { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' },
      rows: 3,
      columns: 3,
    })),
    getCells: mock(() => ({
      nodeId: 't1',
      address: { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' },
      cells: [
        {
          nodeId: 'c1',
          address: { kind: 'block' as const, nodeType: 'tableCell' as const, nodeId: 'c1' },
          rowIndex: 0,
          columnIndex: 0,
          colspan: 1,
          rowspan: 1,
        },
      ],
    })),
    getProperties: mock(() => ({
      nodeId: 't1',
      address: { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' },
      styleId: 'TableGrid',
      alignment: 'left' as const,
    })),
  };
}

function makeHistoryAdapter(): HistoryAdapter {
  return {
    get: mock(() => ({
      undoDepth: 0,
      redoDepth: 0,
      canUndo: false,
      canRedo: false,
      historyUnsafeOperations: [],
    })),
    undo: mock(() => ({ noop: true, revision: { before: '0', after: '0' } })),
    redo: mock(() => ({ noop: true, revision: { before: '0', after: '0' } })),
  };
}

function makeCapabilitiesAdapter(overrides?: Partial<DocumentApiCapabilities>): CapabilitiesAdapter {
  const defaultCapabilities: DocumentApiCapabilities = {
    global: {
      trackChanges: { enabled: false },
      comments: { enabled: false },
      lists: { enabled: false },
      dryRun: { enabled: false },
      history: { enabled: false },
    },
    format: { supportedInlineProperties: {} as DocumentApiCapabilities['format']['supportedInlineProperties'] },
    operations: {} as DocumentApiCapabilities['operations'],
    planEngine: {
      supportedStepOps: [],
      supportedNonUniformStrategies: [],
      supportedSetMarks: [],
      regex: { maxPatternLength: 1024, maxExecutionMs: 100 },
    },
  };
  return {
    get: mock(() => ({ ...defaultCapabilities, ...overrides })),
  };
}

const PARAGRAPH_ADDRESS: NodeAddress = { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' };

const PARAGRAPH_NODE_RESULT: SDNodeResult = {
  node: { kind: 'paragraph', paragraph: { inlines: [] } },
  address: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
};

const FIND_RESULT: SDFindResult = {
  total: 1,
  limit: 1,
  offset: 0,
  items: [PARAGRAPH_NODE_RESULT],
};

describe('createDocumentApi', () => {
  it('delegates detailed projection methods through optional root adapter slots', async () => {
    const htmlResult = {
      format: 'html' as const,
      content: '<p>Hello</p>',
      status: 'success' as const,
      reviewMode: 'final' as const,
      evaluatedRevision: 'r1',
      story: { kind: 'story' as const, storyType: 'body' as const },
      scope: { kind: 'story' as const },
      lossy: false,
      diagnostics: [],
      blocks: [],
      annotations: [],
    };
    const projectHtml = { projectHtml: mock(async () => htmlResult) };
    const api = createDocumentApi({ projectHtml } as unknown as DocumentApiAdapters);

    await expect(api.projectHtml({})).resolves.toBe(htmlResult);
    expect(projectHtml.projectHtml).toHaveBeenCalledWith({});
    expect(() => api.projectMarkdown({})).toThrow(expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }));
  });

  it('delegates htmlToFragment through the optional root adapter slot', () => {
    const result = {
      fragment: [{ kind: 'paragraph' as const, paragraph: { inlines: [] } }],
      lossy: false,
      diagnostics: [],
    };
    const htmlToFragment = { htmlToFragment: mock(() => result) };
    const api = createDocumentApi({ htmlToFragment } as unknown as DocumentApiAdapters);

    expect(api.htmlToFragment({ html: '<p>Hello</p>' })).toBe(result);
    expect(htmlToFragment.htmlToFragment).toHaveBeenCalledWith({ html: '<p>Hello</p>' });
  });

  it('fails htmlToFragment at the root boundary when the optional adapter is absent', () => {
    const api = createDocumentApi({} as DocumentApiAdapters);

    expect(() => api.htmlToFragment({ html: '<p>Hello</p>' })).toThrow(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });

  it('delegates find to the find adapter', () => {
    const findAdapter = makeFindAdapter(FIND_RESULT);
    const api = createDocumentApi({
      find: findAdapter,
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const input = { select: { type: 'node' as const, nodeType: 'paragraph' as const } };
    const result = api.find(input);

    expect(result).toEqual(FIND_RESULT);
    expect(findAdapter.find).toHaveBeenCalledTimes(1);
  });

  it('delegates find with text selector', () => {
    const findAdapter = makeFindAdapter(FIND_RESULT);
    const api = createDocumentApi({
      find: findAdapter,
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const result = api.find({ select: { type: 'text', pattern: 'hello' }, limit: 5 });

    expect(result).toEqual(FIND_RESULT);
    expect(findAdapter.find).toHaveBeenCalledTimes(1);
  });

  it('delegates getNode to the getNode adapter', () => {
    const getNodeAdpt = makeGetNodeAdapter(PARAGRAPH_NODE_RESULT);
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: getNodeAdpt,
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const info = api.getNode(PARAGRAPH_ADDRESS);

    expect(info).toEqual(PARAGRAPH_NODE_RESULT);
    expect(getNodeAdpt.getNode).toHaveBeenCalledWith(PARAGRAPH_ADDRESS);
  });

  it('delegates getNodeById to the getNode adapter', () => {
    const getNodeAdpt = makeGetNodeAdapter(PARAGRAPH_NODE_RESULT);
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: getNodeAdpt,
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const info = api.getNodeById({ nodeId: 'p1', nodeType: 'paragraph' });

    expect(info).toEqual(PARAGRAPH_NODE_RESULT);
    expect(getNodeAdpt.getNodeById).toHaveBeenCalledWith({ nodeId: 'p1', nodeType: 'paragraph' });
  });

  it('delegates getText to the getText adapter', () => {
    const getTextAdpt = makeGetTextAdapter('Hello world');
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: getTextAdpt,
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const text = api.getText({});

    expect(text).toBe('Hello world');
    expect(getTextAdpt.getText).toHaveBeenCalledWith({});
  });

  it('delegates info to the info adapter', () => {
    const infoAdpt = makeInfoAdapter({
      counts: { words: 42 },
      outline: [{ level: 1, text: 'Heading', nodeId: 'h1' }],
    });
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: infoAdpt,
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const result = api.info({});

    expect(result.counts.words).toBe(42);
    expect(result.outline).toEqual([{ level: 1, text: 'Heading', nodeId: 'h1' }]);
    expect(infoAdpt.info).toHaveBeenCalledWith({});
  });

  it('delegates comments.create through the comments adapter (root comment)', () => {
    const commentsAdpt = makeCommentsAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: commentsAdpt,
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const input: CommentsCreateInput = {
      target: { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } },
      text: 'test comment',
    };
    const receipt = api.comments.create(input);

    expect(receipt.success).toBe(true);
    expect(receipt.id).toBe('c1');
    expect(commentsAdpt.add).toHaveBeenCalledWith(input, undefined);
  });

  it('delegates comments.create as reply when parentCommentId is provided', () => {
    const commentsAdpt = makeCommentsAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: commentsAdpt,
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const input: CommentsCreateInput = { parentCommentId: 'c1', text: 'reply text' };
    const receipt = api.comments.create(input);

    expect(receipt.success).toBe(true);
    expect(receipt.id).toBe('c2');
    expect(commentsAdpt.reply).toHaveBeenCalledWith({ parentCommentId: 'c1', text: 'reply text' }, undefined);
  });

  it('delegates all canonical comments operations through the comments adapter', () => {
    const commentsAdpt = makeCommentsAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: commentsAdpt,
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const patchInput: CommentsPatchInput = { commentId: 'c1', text: 'edited' };
    const deleteInput: CommentsDeleteInput = { commentId: 'c1' };
    const getInput: GetCommentInput = { commentId: 'c1' };
    const listQuery: CommentsListQuery = { includeResolved: false };

    const patchReceipt = api.comments.patch(patchInput);
    const deleteReceipt = api.comments.delete(deleteInput);
    const getResult = api.comments.get(getInput);
    const listResult = api.comments.list(listQuery);

    expect(patchReceipt.success).toBe(true);
    expect(deleteReceipt.success).toBe(true);
    expect((getResult as CommentInfo).commentId).toBe('c1');
    expect((listResult as CommentsListResult).total).toBe(0);

    expect(commentsAdpt.edit).toHaveBeenCalledWith({ commentId: 'c1', text: 'edited' }, undefined);
    expect(commentsAdpt.remove).toHaveBeenCalledWith({ commentId: 'c1' }, undefined);
    expect(commentsAdpt.get).toHaveBeenCalledWith(getInput);
    expect(commentsAdpt.list).toHaveBeenCalledWith(listQuery);
  });

  it('delegates write operations through the shared write adapter', () => {
    const writeAdpt = makeWriteAdapter();
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: writeAdpt,
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const selectionTarget = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.insert({ value: 'Hi' });
    api.insert({ target: selectionTarget, value: 'Yo' });
    api.replace({ target: selectionTarget, text: 'Hello' }, { changeMode: 'tracked' });
    api.delete({ target: selectionTarget });

    expect(writeAdpt.write).toHaveBeenNthCalledWith(
      1,
      { kind: 'insert', text: 'Hi' },
      { changeMode: 'direct', dryRun: false },
    );
    // Targeted insert now routes through selectionMutation adapter
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'insert', target: selectionTarget, ref: undefined, text: 'Yo' },
      { expectedRevision: undefined, changeMode: 'direct', dryRun: false },
    );
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'replace', target: selectionTarget, ref: undefined, text: 'Hello' },
      { changeMode: 'tracked', dryRun: false },
    );
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'delete', target: selectionTarget, ref: undefined, behavior: 'selection' },
      { expectedRevision: undefined, changeMode: 'direct', dryRun: false },
    );
  });

  it('delegates format.bold to selectionMutation.execute with inline.bold', () => {
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.format.bold({ target }, { changeMode: 'tracked' });
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'format', target, ref: undefined, inline: { bold: true } },
      { changeMode: 'tracked', dryRun: false },
    );
  });

  it('delegates format.italic to selectionMutation.execute with inline.italic', () => {
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.format.italic({ target }, { changeMode: 'direct' });
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'format', target, ref: undefined, inline: { italic: true } },
      { changeMode: 'direct', dryRun: false },
    );
  });

  it('delegates format.underline to selectionMutation.execute with inline.underline', () => {
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.format.underline({ target }, { changeMode: 'direct' });
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'format', target, ref: undefined, inline: { underline: true } },
      { changeMode: 'direct', dryRun: false },
    );
  });

  it('delegates format.strikethrough to selectionMutation.execute with inline.strike', () => {
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.format.strikethrough({ target }, { changeMode: 'tracked' });
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'format', target, ref: undefined, inline: { strike: true } },
      { changeMode: 'tracked', dryRun: false },
    );
  });

  it('delegates format.strikethrough with an explicit value: false to remove strike', () => {
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.format.strikethrough({ target, value: false }, { changeMode: 'tracked' });
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'format', target, ref: undefined, inline: { strike: false } },
      { changeMode: 'tracked', dryRun: false },
    );
  });

  it('delegates format.fontFamily to selectionMutation.execute with inline.fontFamily', () => {
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.format.fontFamily({ target, value: 'Arial' });
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'format', target, ref: undefined, inline: { fontFamily: 'Arial' } },
      { changeMode: 'direct', dryRun: false },
    );
  });

  it('delegates root formatRange to selectionMutation.execute with inline properties', () => {
    const selectionAdpt = makeSelectionMutationAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: selectionAdpt,
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const target = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
    };
    api.formatRange({ target, properties: { bold: true }, changeMode: 'tracked', dryRun: true });
    expect(selectionAdpt.execute).toHaveBeenCalledWith(
      { kind: 'format', target, ref: undefined, inline: { bold: true } },
      { changeMode: 'tracked', dryRun: true },
    );
  });

  it('delegates trackChanges read operations', () => {
    const trackAdpt = makeTrackChangesAdapter();
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '5' } as const;
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: trackAdpt,
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const listResult = api.trackChanges.list({ limit: 1 });
    const getResult = api.trackChanges.get({ id: 'tc-1' });
    api.trackChanges.list({ in: footnoteStory, type: 'insert' });
    api.trackChanges.get({ id: 'tc-2', story: footnoteStory });

    expect(listResult.total).toBe(0);
    expect(getResult.id).toBe('tc-1');
    expect(trackAdpt.list).toHaveBeenCalledWith({ limit: 1 });
    expect(trackAdpt.get).toHaveBeenCalledWith({ id: 'tc-1' });
    expect(trackAdpt.list).toHaveBeenCalledWith({ in: footnoteStory, type: 'insert' });
    expect(trackAdpt.get).toHaveBeenCalledWith({ id: 'tc-2', story: footnoteStory });
  });

  it('delegates trackChanges.decide to trackChanges adapter methods', () => {
    const trackAdpt = makeTrackChangesAdapter();
    const footnoteStory = { kind: 'story', storyType: 'footnote', noteId: '5' } as const;
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: trackAdpt,
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const acceptResult = api.trackChanges.decide({ decision: 'accept', target: { id: 'tc-1' } });
    const rejectResult = api.trackChanges.decide({ decision: 'reject', target: { id: 'tc-1' } });
    api.trackChanges.decide({ decision: 'accept', target: { id: 'tc-2', story: footnoteStory } });
    api.trackChanges.decide({
      decision: 'accept',
      target: {
        kind: 'range',
        range: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 2 } }] },
        story: footnoteStory,
      },
    });
    const acceptAllResult = api.trackChanges.decide({ decision: 'accept', target: { scope: 'all' } });
    const acceptAllInStoryResult = api.trackChanges.decide({
      decision: 'accept',
      target: { scope: 'all', story: footnoteStory },
    });
    const rejectAllResult = api.trackChanges.decide({ decision: 'reject', target: { scope: 'all' } });

    expect(acceptResult.success).toBe(true);
    expect(rejectResult.success).toBe(true);
    expect(acceptAllResult.success).toBe(true);
    expect(acceptAllInStoryResult.success).toBe(true);
    expect(rejectAllResult.success).toBe(true);
    expect(trackAdpt.accept).toHaveBeenCalledWith({ id: 'tc-1' }, undefined);
    expect(trackAdpt.reject).toHaveBeenCalledWith({ id: 'tc-1' }, undefined);
    expect(trackAdpt.accept).toHaveBeenCalledWith({ id: 'tc-2', story: footnoteStory }, undefined);
    expect(trackAdpt.decideRange).toHaveBeenCalledWith(
      {
        decision: 'accept',
        range: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 2 } }] },
        story: footnoteStory,
      },
      undefined,
    );
    expect(trackAdpt.acceptAll).toHaveBeenCalledWith({}, undefined);
    expect(trackAdpt.acceptAll).toHaveBeenCalledWith({ story: footnoteStory }, undefined);
    expect(trackAdpt.rejectAll).toHaveBeenCalledWith({}, undefined);
  });

  it('returns CAPABILITY_UNAVAILABLE when trackChanges.decide range support is missing', () => {
    const trackAdpt = makeTrackChangesAdapter();
    delete trackAdpt.decideRange;
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: trackAdpt,
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const result = api.trackChanges.decide({
      decision: 'reject',
      target: { kind: 'range', range: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 2 } }] } },
    });

    expect(result).toMatchObject({
      success: false,
      failure: {
        code: 'CAPABILITY_UNAVAILABLE',
      },
    });
  });

  it('delegates history.get to the history adapter', () => {
    const historyAdpt = makeHistoryAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
      history: historyAdpt,
    } as any);

    const result = api.history.get();

    expect(historyAdpt.get).toHaveBeenCalledOnce();
    expect(result).toEqual({
      undoDepth: 0,
      redoDepth: 0,
      canUndo: false,
      canRedo: false,
      historyUnsafeOperations: [],
    });
  });

  it('delegates history.undo and history.redo to the history adapter', () => {
    const historyAdpt = makeHistoryAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
      history: historyAdpt,
    } as any);

    const undoResult = api.history.undo();
    const redoResult = api.history.redo();

    expect(historyAdpt.undo).toHaveBeenCalledOnce();
    expect(historyAdpt.redo).toHaveBeenCalledOnce();
    expect(undoResult).toEqual({ noop: true, revision: { before: '0', after: '0' } });
    expect(redoResult).toEqual({ noop: true, revision: { before: '0', after: '0' } });
  });

  describe('trackChanges.decide input validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectError(fn: () => void, code: string, messageMatch: string) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');
        expect(e.code).toBe(code);
        expect(e.message).toContain(messageMatch);
      }
    }

    it('rejects null input', () => {
      const api = makeApi();
      expectError(() => api.trackChanges.decide(null as any), 'INVALID_INPUT', 'non-null object');
    });

    it('rejects primitive input', () => {
      const api = makeApi();
      expectError(() => api.trackChanges.decide('accept' as any), 'INVALID_INPUT', 'non-null object');
    });

    it('rejects invalid decision value', () => {
      const api = makeApi();
      expectError(
        () => api.trackChanges.decide({ decision: 'maybe', target: { id: 'tc-1' } } as any),
        'INVALID_INPUT',
        'must be one of: accept, reject',
      );
    });

    it('rejects non-object target', () => {
      const api = makeApi();
      expectError(
        () => api.trackChanges.decide({ decision: 'accept', target: 'tc-1' } as any),
        'INVALID_TARGET',
        "{ kind: 'id', id } / { kind: 'ids', ids } / { kind: 'range', range } / { kind: 'all' }",
      );
    });

    it('rejects null target', () => {
      const api = makeApi();
      expectError(
        () => api.trackChanges.decide({ decision: 'accept', target: null } as any),
        'INVALID_TARGET',
        "{ kind: 'id', id } / { kind: 'ids', ids } / { kind: 'range', range } / { kind: 'all' }",
      );
    });

    it('rejects object target without id or scope', () => {
      const api = makeApi();
      expectError(
        () => api.trackChanges.decide({ decision: 'accept', target: { foo: 'bar' } } as any),
        'INVALID_TARGET',
        'target.kind is required',
      );
    });

    it('rejects target with empty id', () => {
      const api = makeApi();
      expectError(
        () => api.trackChanges.decide({ decision: 'accept', target: { id: '' } } as any),
        'INVALID_TARGET',
        'non-empty id',
      );
    });

    it('promotes legacy id plus partial range targets into logical range targets', () => {
      const trackAdpt = makeTrackChangesAdapter();
      trackAdpt.decide = mock(() => ({ success: true as const }));
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: trackAdpt,
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.trackChanges.decide({
        decision: 'accept',
        target: { id: 'tc-1', range: { kind: 'partial', start: 0, end: 2 } },
      } as any);

      expect(trackAdpt.decide).toHaveBeenCalledWith(
        {
          decision: 'accept',
          target: {
            kind: 'range',
            range: { anchor: 'tc-1', relativeStart: 0, relativeEnd: 2 },
          },
        },
        undefined,
      );
    });

    it('rejects malformed legacy id plus range targets with INVALID_INPUT', () => {
      const api = makeApi();
      expectError(
        () =>
          api.trackChanges.decide({
            decision: 'accept',
            target: { id: 'tc-1', range: { kind: 'partial', start: 2, end: 0 } },
          } as any),
        'INVALID_INPUT',
        'legacy partial range targets',
      );
    });

    it('accepts logical range targets and forwards range disambiguators', () => {
      const trackAdpt = makeTrackChangesAdapter();
      trackAdpt.decide = mock(() => ({ success: true as const }));
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: trackAdpt,
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const result = api.trackChanges.decide({
        decision: 'reject',
        target: {
          kind: 'range',
          range: {
            anchor: 'tc-anchor-1',
            relativeStart: 1,
            relativeEnd: 4,
          },
          overlap: 'tc-child-1',
          side: 'delete',
          story: { kind: 'story', storyType: 'footnote', noteId: '12' },
          part: 'word/footnotes.xml',
        },
        expectedRevision: 'r7',
      });

      expect(result.success).toBe(true);
      expect(trackAdpt.decide).toHaveBeenCalledWith(
        {
          decision: 'reject',
          target: {
            kind: 'range',
            range: {
              anchor: 'tc-anchor-1',
              relativeStart: 1,
              relativeEnd: 4,
            },
            overlap: 'tc-child-1',
            side: 'delete',
            story: { kind: 'story', storyType: 'footnote', noteId: '12' },
            part: 'word/footnotes.xml',
          },
        },
        { expectedRevision: 'r7' },
      );
    });

    it('accepts TextTarget range targets with optional overlap and side fields', () => {
      const trackAdpt = makeTrackChangesAdapter();
      trackAdpt.decide = mock(() => ({ success: true as const }));
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: trackAdpt,
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.trackChanges.decide({
        decision: 'accept',
        target: {
          kind: 'range',
          range: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 2 } }] },
          overlap: 'tc-parent-1',
          side: 'inserted',
        },
      });

      expect(trackAdpt.decide).toHaveBeenCalledWith(
        {
          decision: 'accept',
          target: {
            kind: 'range',
            range: { kind: 'text', segments: [{ blockId: 'p1', range: { start: 0, end: 2 } }] },
            overlap: 'tc-parent-1',
            side: 'inserted',
          },
        },
        undefined,
      );
    });

    it('lets options.expectedRevision override the input expectedRevision alias', () => {
      const trackAdpt = makeTrackChangesAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: trackAdpt,
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.trackChanges.decide(
        { decision: 'accept', target: { id: 'tc-1' }, expectedRevision: 'input-r1' },
        { expectedRevision: 'options-r2' },
      );

      expect(trackAdpt.accept).toHaveBeenCalledWith({ id: 'tc-1' }, { expectedRevision: 'options-r2' });
    });

    it('passes input.expectedRevision to legacy id-target adapters when options are omitted', () => {
      const trackAdpt = makeTrackChangesAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: trackAdpt,
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.trackChanges.decide({ decision: 'reject', target: { id: 'tc-1' }, expectedRevision: 'input-r1' });

      expect(trackAdpt.reject).toHaveBeenCalledWith({ id: 'tc-1' }, { expectedRevision: 'input-r1' });
    });

    it('rejects malformed logical range target fields', () => {
      const api = makeApi();
      expectError(
        () =>
          api.trackChanges.decide({
            decision: 'accept',
            target: { kind: 'range', range: { anchor: 'tc-anchor-1', relativeStart: 3, relativeEnd: 2 } },
          } as any),
        'INVALID_TARGET',
        '0 <= relativeStart <= relativeEnd',
      );
      expectError(
        () =>
          api.trackChanges.decide({
            decision: 'accept',
            target: { kind: 'range', anchor: 'tc-anchor-1', relativeStart: 0, relativeEnd: 2, side: 'before' },
          } as any),
        'INVALID_TARGET',
        'target.side must be',
      );
    });

    it('rejects ambiguous targets that mix id and scope', () => {
      const api = makeApi();
      expectError(
        () => api.trackChanges.decide({ decision: 'accept', target: { id: 'tc-1', scope: 'all' } } as any),
        'INVALID_TARGET',
        'exactly one',
      );
    });
  });

  it('delegates create.paragraph to the create adapter', () => {
    const createAdpt = makeCreateAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: createAdpt,
      lists: makeListsAdapter(),
    });

    const result = api.create.paragraph(
      {
        at: { kind: 'documentEnd' },
        text: 'Created paragraph',
      },
      { changeMode: 'tracked' },
    );

    expect(result.success).toBe(true);
    expect(createAdpt.paragraph).toHaveBeenCalledWith(
      {
        at: { kind: 'documentEnd' },
        text: 'Created paragraph',
      },
      { changeMode: 'tracked', dryRun: false },
    );
  });

  it('delegates create.heading to the create adapter', () => {
    const createAdpt = makeCreateAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: createAdpt,
      lists: makeListsAdapter(),
    });

    const result = api.create.heading(
      {
        level: 2,
        at: { kind: 'documentEnd' },
        text: 'Created heading',
      },
      { changeMode: 'tracked' },
    );

    expect(result.success).toBe(true);
    expect(createAdpt.heading).toHaveBeenCalledWith(
      {
        level: 2,
        at: { kind: 'documentEnd' },
        text: 'Created heading',
      },
      { changeMode: 'tracked', dryRun: false },
    );
  });

  it('delegates lists namespace operations', () => {
    const listsAdpt = makeListsAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: listsAdpt,
    });

    const target = { kind: 'block', nodeType: 'listItem', nodeId: 'li-1' } as const;
    const listResult = api.lists.list({ limit: 1 });
    const getResult = api.lists.get({ address: target });
    const insertResult = api.lists.insert({ target, position: 'after', text: 'Inserted' }, { changeMode: 'tracked' });
    const indentResult = api.lists.indent({ target });
    const outdentResult = api.lists.outdent({ target });
    const createResult = api.lists.create({
      mode: 'empty',
      at: { kind: 'block', nodeType: 'paragraph', nodeId: 'p-1' },
      kind: 'ordered',
    });
    const detachResult = api.lists.detach({ target });
    const setLevelResult = api.lists.setLevel({ target, level: 2 });

    expect(listResult.total).toBe(0);
    expect(getResult.address).toEqual(target);
    expect(insertResult.success).toBe(true);
    expect(indentResult.success).toBe(true);
    expect(outdentResult.success).toBe(true);
    expect(createResult.success).toBe(true);
    expect(detachResult.success).toBe(true);
    expect(setLevelResult.success).toBe(true);

    expect(listsAdpt.list).toHaveBeenCalledWith({ limit: 1 });
    expect(listsAdpt.get).toHaveBeenCalledWith({ address: target });
    expect(listsAdpt.insert).toHaveBeenCalledWith(
      { target, position: 'after', text: 'Inserted' },
      { changeMode: 'tracked', dryRun: false },
    );
    expect(listsAdpt.indent).toHaveBeenCalledWith({ target }, { changeMode: 'direct', dryRun: false });
    expect(listsAdpt.outdent).toHaveBeenCalledWith({ target }, { changeMode: 'direct', dryRun: false });
    expect(listsAdpt.detach).toHaveBeenCalledWith({ target }, { changeMode: 'direct', dryRun: false });
    expect(listsAdpt.setLevel).toHaveBeenCalledWith({ target, level: 2 }, { changeMode: 'direct', dryRun: false });
  });

  it('exposes capabilities as a callable function with .get() alias', () => {
    const capAdpt = makeCapabilitiesAdapter();
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      capabilities: capAdpt,
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const directResult = api.capabilities();
    const getResult = api.capabilities.get();

    expect(directResult).toEqual(getResult);
    expect(capAdpt.get).toHaveBeenCalledTimes(2);
  });

  it('masks adapter-gated namespace capabilities when the adapter is absent', () => {
    const capAdpt = makeCapabilitiesAdapter({
      operations: {
        'clipboard.parse': { available: true, tracked: false, dryRun: false },
        'clipboard.insert': { available: true, tracked: true, dryRun: true },
        'clipboard.serializeSelection': { available: true, tracked: false, dryRun: false },
      } as DocumentApiCapabilities['operations'],
    });
    const api = createDocumentApi({
      find: makeFindAdapter(FIND_RESULT),
      get: makeGetAdapter(),
      getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
      getText: makeGetTextAdapter(),
      info: makeInfoAdapter(),
      capabilities: capAdpt,
      comments: makeCommentsAdapter(),
      write: makeWriteAdapter(),
      selectionMutation: makeSelectionMutationAdapter(),
      trackChanges: makeTrackChangesAdapter(),
      create: makeCreateAdapter(),
      lists: makeListsAdapter(),
    });

    const capabilities = api.capabilities();

    expect(capabilities.operations['clipboard.parse']).toMatchObject({
      available: false,
      tracked: false,
      dryRun: false,
      reasons: ['NAMESPACE_UNAVAILABLE'],
    });
    expect(capabilities.operations['clipboard.insert']).toMatchObject({
      available: false,
      tracked: false,
      dryRun: false,
      reasons: ['NAMESPACE_UNAVAILABLE'],
    });
    expect(capabilities.operations['clipboard.serializeSelection']).toMatchObject({
      available: false,
      tracked: false,
      dryRun: false,
      reasons: ['NAMESPACE_UNAVAILABLE'],
    });

    let capturedCode: string | undefined;
    try {
      api.clipboard.insert({
        payload: { source: 'api', items: [{ type: 'text/plain', kind: 'string', data: 'hello' }] },
      });
    } catch (error) {
      capturedCode = (error as { code?: string }).code;
    }
    expect(capturedCode).toBe('CAPABILITY_UNAVAILABLE');
  });

  describe('insert target validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp, expectedCode?: string) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');
        if (expectedCode) {
          expect(e.code).toBe(expectedCode);
        }
        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    // -- Truth table: valid cases --

    it('accepts no-target (default insertion point)', () => {
      const api = makeApi();
      const result = api.insert({ value: 'hello' });
      expect(result.success).toBe(true);
    });

    it('accepts canonical SelectionTarget', () => {
      const api = makeApi();
      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      };
      const result = api.insert({ target, value: 'hello' });
      expect(result.success).toBe(true);
    });

    // -- Truth table: invalid cases --

    it('rejects null target', () => {
      const api = makeApi();
      expectValidationError(
        () => api.insert({ target: null, value: 'hello' } as any),
        'target must be a SelectionTarget object',
      );
    });

    it('rejects malformed target objects', () => {
      const api = makeApi();
      expectValidationError(
        () => api.insert({ target: { kind: 'text', blockId: 'p1' }, value: 'hello' } as any),
        'target must be a SelectionTarget object',
      );
    });

    // -- Type checks --

    it('rejects non-string value', () => {
      const api = makeApi();
      expectValidationError(() => api.insert({ value: 42 } as any), 'value must be a string');
    });

    it('rejects invalid type enum', () => {
      const api = makeApi();
      expectValidationError(() => api.insert({ value: 'hi', type: 'xml' } as any), 'type must be one of');
    });

    // -- Validation error shape --

    it('throws DocumentApiValidationError (not plain Error)', () => {
      const api = makeApi();
      try {
        api.insert({ value: 42 } as any);
        expect.fail('Expected error');
      } catch (err: unknown) {
        expect((err as Error).constructor.name).toBe('DocumentApiValidationError');
        expect((err as { code: string }).code).toBe('INVALID_TARGET');
      }
    });

    // -- Input shape guard --

    it('rejects null input', () => {
      const api = makeApi();
      expectValidationError(() => api.insert(null as any), 'non-null object');
    });

    it('rejects numeric input', () => {
      const api = makeApi();
      expectValidationError(() => api.insert(42 as any), 'non-null object');
    });

    it('rejects undefined input', () => {
      const api = makeApi();
      expectValidationError(() => api.insert(undefined as any), 'non-null object');
    });

    // -- Unknown field rejection --

    it('rejects unknown top-level fields', () => {
      const api = makeApi();
      expectValidationError(() => api.insert({ value: 'hi', block_id: 'abc' } as any), 'Unknown field "block_id"');
    });

    it('rejects flat blockId as unknown field', () => {
      const api = makeApi();
      expectValidationError(() => api.insert({ blockId: 'p1', value: 'hello' } as any), 'Unknown field "blockId"');
    });

    it('rejects flat offset as unknown field', () => {
      const api = makeApi();
      expectValidationError(() => api.insert({ value: 'hello', offset: 5 } as any), 'Unknown field "offset"');
    });

    it('rejects pos as unknown field', () => {
      const api = makeApi();
      expectValidationError(() => api.insert({ value: 'hi', pos: 3 } as any), 'Unknown field "pos"');
    });

    // -- Backward compatibility parity --

    it('maps insert({ value }) to internal write request with text field', () => {
      const writeAdpt = makeWriteAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: writeAdpt,
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.insert({ value: 'hello' });
      expect(writeAdpt.write).toHaveBeenCalledWith(
        { kind: 'insert', text: 'hello' },
        { changeMode: 'direct', dryRun: false },
      );
    });

    it('maps insert({ target, value }) to selection mutation adapter', () => {
      const selectionAdpt = makeSelectionMutationAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: selectionAdpt,
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      };
      api.insert({ target, value: 'hello' });
      expect(selectionAdpt.execute).toHaveBeenCalledWith(
        { kind: 'insert', target, ref: undefined, text: 'hello' },
        { expectedRevision: undefined, changeMode: 'direct', dryRun: false },
      );
    });

    // -- Structured insert routing (markdown / html) --

    it('routes type:"markdown" insert to insertStructured instead of write', () => {
      const writeAdpt = makeWriteAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: writeAdpt,
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.insert({ value: '# Heading', type: 'markdown' });
      expect(writeAdpt.insertStructured).toHaveBeenCalledTimes(1);
      expect(writeAdpt.insertStructured).toHaveBeenCalledWith(
        { value: '# Heading', type: 'markdown' },
        { expectedRevision: undefined, changeMode: 'direct', dryRun: false },
      );
      expect(writeAdpt.write).not.toHaveBeenCalled();
    });

    it('routes type:"html" insert to insertStructured instead of write', () => {
      const writeAdpt = makeWriteAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: writeAdpt,
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.insert({ value: '<p>Hello</p>', type: 'html' });
      expect(writeAdpt.insertStructured).toHaveBeenCalledTimes(1);
      expect(writeAdpt.insertStructured).toHaveBeenCalledWith(
        { value: '<p>Hello</p>', type: 'html' },
        { expectedRevision: undefined, changeMode: 'direct', dryRun: false },
      );
      expect(writeAdpt.write).not.toHaveBeenCalled();
    });

    it('routes type:"text" (or unspecified type) insert to write, not insertStructured', () => {
      const writeAdpt = makeWriteAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: writeAdpt,
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.insert({ value: 'plain text', type: 'text' });
      expect(writeAdpt.write).toHaveBeenCalledTimes(1);
      expect(writeAdpt.insertStructured).not.toHaveBeenCalled();
    });

    it('forwards target to insertStructured for markdown insert', () => {
      const writeAdpt = makeWriteAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: writeAdpt,
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      };
      api.insert({ target, value: '**bold**', type: 'markdown' });
      expect(writeAdpt.insertStructured).toHaveBeenCalledWith(
        { target, value: '**bold**', type: 'markdown' },
        { expectedRevision: undefined, changeMode: 'direct', dryRun: false },
      );
    });

    // -- Structural insert union discrimination --

    it('rejects insert with both value and content', () => {
      const api = makeApi();
      expect(() => api.insert({ value: 'hello', content: { type: 'paragraph', content: [] } } as any)).toThrow(
        /either "value".*or "content".*not both/,
      );
    });

    it('rejects insert with neither value nor content', () => {
      const api = makeApi();
      expect(() => api.insert({} as any)).toThrow(/either "value".*or "content"/);
    });

    it('rejects structural insert with legacy "type" field', () => {
      const api = makeApi();
      expect(() => api.insert({ content: { type: 'paragraph', content: [] }, type: 'markdown' } as any)).toThrow(
        /"type" field is only valid with legacy/,
      );
    });

    it('rejects plain text insert with structural "placement" field', () => {
      const api = makeApi();
      expect(() => api.insert({ value: 'hi', placement: 'before' } as any)).toThrow(
        /"placement" is only valid with structural content input or markdown\/html/,
      );
    });

    it('accepts placement for markdown insert', () => {
      const api = makeApi();
      // Should not throw — markdown inserts route through the structural path
      expect(() => api.insert({ value: '# Hello', type: 'markdown', placement: 'insideEnd' } as any)).not.toThrow();
    });

    it('rejects invalid placement value for markdown insert', () => {
      const api = makeApi();
      expect(() => api.insert({ value: '# Hello', type: 'markdown', placement: 'end' } as any)).toThrow(
        /placement must be one of/,
      );
    });

    it('rejects legacy insert with structural "nestingPolicy" field', () => {
      const api = makeApi();
      expect(() => api.insert({ value: 'hi', nestingPolicy: { tables: 'forbid' } } as any)).toThrow(
        /"nestingPolicy" is only valid with structural/,
      );
    });

    it('routes structural content insert to insertStructured', () => {
      const writeAdpt = makeWriteAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: writeAdpt,
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.insert({ content: { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] } });
      expect(writeAdpt.insertStructured).toHaveBeenCalledTimes(1);
      expect(writeAdpt.write).not.toHaveBeenCalled();
    });

    it('rejects structural insert with empty fragment', () => {
      const api = makeApi();
      expect(() => api.insert({ content: [] } as any)).toThrow(/at least one node/);
    });

    it('rejects structural insert with invalid placement enum', () => {
      const api = makeApi();
      expect(() => api.insert({ content: { type: 'paragraph' }, placement: 'middle' } as any)).toThrow(
        /placement must be one of/,
      );
    });

    it('rejects structural insert with invalid nestingPolicy.tables', () => {
      const api = makeApi();
      expect(() => api.insert({ content: { type: 'paragraph' }, nestingPolicy: { tables: 'maybe' } } as any)).toThrow(
        /nestingPolicy\.tables must be one of/,
      );
    });

    it('rejects structural insert with unknown nestingPolicy keys', () => {
      const api = makeApi();
      expect(() => api.insert({ content: { type: 'paragraph' }, nestingPolicy: { table: 'forbid' } } as any)).toThrow(
        /Unknown field "table" on nestingPolicy/,
      );
    });
  });

  describe('replace target validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');
        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    const SELECTION_TARGET = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 5 },
    };

    // -- Truth table: valid cases --

    it('accepts canonical target', () => {
      const api = makeApi();
      const result = api.replace({ target: SELECTION_TARGET, text: 'hello' });
      expect(result.success).toBe(true);
    });

    it('allows collapsed range (start === end) through pre-apply', () => {
      const api = makeApi();
      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 3 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 3 },
      };
      const result = api.replace({ target, text: 'hello' });
      expect(result.success).toBe(true);
    });

    // -- Truth table: invalid cases --

    it('rejects no target at all', () => {
      const api = makeApi();
      expectValidationError(() => api.replace({ text: 'hello' } as any), 'requires a target or ref');
    });

    it('rejects malformed target', () => {
      const api = makeApi();
      expectValidationError(
        () => api.replace({ target: { kind: 'text', blockId: 'p1' }, text: 'hello' } as any),
        'SelectionTarget',
      );
    });

    // -- Type checks --

    it('rejects non-string text', () => {
      const api = makeApi();
      expectValidationError(() => api.replace({ target: SELECTION_TARGET, text: 42 } as any), 'text must be a string');
    });

    // -- Input shape --

    it('rejects null input', () => {
      const api = makeApi();
      expectValidationError(() => api.replace(null as any), 'non-null object');
    });

    it('rejects unknown fields', () => {
      const api = makeApi();
      expectValidationError(
        () => api.replace({ target: SELECTION_TARGET, text: 'hi', block_id: 'x' } as any),
        'Unknown field "block_id"',
      );
    });

    it('rejects flat blockId as unknown field', () => {
      const api = makeApi();
      expectValidationError(
        () => api.replace({ blockId: 'p1', start: 0, end: 5, text: 'hello' } as any),
        'Unknown field "blockId"',
      );
    });

    // -- Error shape --

    it('throws DocumentApiValidationError (not plain Error)', () => {
      const api = makeApi();
      try {
        api.replace({ text: 'hello' } as any);
        expect.fail('Expected error');
      } catch (err: unknown) {
        expect((err as Error).constructor.name).toBe('DocumentApiValidationError');
      }
    });

    // -- Canonical payload parity --

    it('sends same adapter request for replace({ target, text }) as before', () => {
      const selectionAdpt = makeSelectionMutationAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: selectionAdpt,
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.replace({ target: SELECTION_TARGET, text: 'Hello' });
      expect(selectionAdpt.execute).toHaveBeenCalledWith(
        { kind: 'replace', target: SELECTION_TARGET, ref: undefined, text: 'Hello' },
        { changeMode: 'direct', dryRun: false },
      );
    });

    // -- Structural replace union discrimination --

    it('rejects replace with both text and content', () => {
      const api = makeApi();
      expect(() =>
        api.replace({ target: SELECTION_TARGET, text: 'hi', content: { type: 'paragraph' } } as any),
      ).toThrow(/exactly one of "text", "content", or "value"/);
    });

    it('rejects replace with neither text, content, nor rich value', () => {
      const api = makeApi();
      expect(() => api.replace({ target: SELECTION_TARGET } as any)).toThrow(
        /exactly one of "text", "content", or "value"/,
      );
    });

    it('routes structural content replace to replaceStructured', () => {
      const writeAdpt = makeWriteAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: writeAdpt,
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const sdTarget = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };
      api.replace({ target: sdTarget, content: { type: 'paragraph', content: [{ type: 'text', text: 'new' }] } });
      expect(writeAdpt.replaceStructured).toHaveBeenCalledTimes(1);
      expect(writeAdpt.write).not.toHaveBeenCalled();
    });

    it('rejects structural replace with empty fragment', () => {
      const api = makeApi();
      const sdTarget = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };
      expect(() => api.replace({ target: sdTarget, content: [] } as any)).toThrow(/at least one node/);
    });

    it('rejects structural replace with invalid nestingPolicy.tables', () => {
      const api = makeApi();
      const sdTarget = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };
      expect(() =>
        api.replace({ target: sdTarget, content: { type: 'paragraph' }, nestingPolicy: { tables: 'yes' } } as any),
      ).toThrow(/nestingPolicy\.tables must be one of/);
    });
  });

  describe('delete target validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');
        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    const SELECTION_TARGET = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 5 },
    };

    // -- Truth table: valid cases --

    it('accepts canonical target', () => {
      const api = makeApi();
      const result = api.delete({ target: SELECTION_TARGET });
      expect(result.success).toBe(true);
    });

    it('allows collapsed range (start === end) through pre-apply', () => {
      const api = makeApi();
      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 3 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 3 },
      };
      const result = api.delete({ target });
      expect(result.success).toBe(true);
    });

    // -- Truth table: invalid cases --

    it('rejects no target at all', () => {
      const api = makeApi();
      expectValidationError(() => api.delete({} as any), 'Delete input must provide either "target" or "ref"');
    });

    it('rejects malformed target', () => {
      const api = makeApi();
      expectValidationError(() => api.delete({ target: { kind: 'text', blockId: 'p1' } } as any), 'SelectionTarget');
    });

    // -- Input shape --

    it('rejects null input', () => {
      const api = makeApi();
      expectValidationError(() => api.delete(null as any), 'non-null object');
    });

    it('rejects unknown fields', () => {
      const api = makeApi();
      expectValidationError(() => api.delete({ target: SELECTION_TARGET, offset: 3 } as any), 'Unknown field "offset"');
    });

    it('rejects flat blockId as unknown field', () => {
      const api = makeApi();
      expectValidationError(() => api.delete({ blockId: 'p1', start: 0, end: 5 } as any), 'Unknown field "blockId"');
    });

    // -- Canonical payload parity --

    it('sends same adapter request for delete({ target }) as before', () => {
      const selectionAdpt = makeSelectionMutationAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: selectionAdpt,
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      api.delete({ target: SELECTION_TARGET });
      expect(selectionAdpt.execute).toHaveBeenCalledWith(
        { kind: 'delete', target: SELECTION_TARGET, ref: undefined, behavior: 'selection' },
        { expectedRevision: undefined, changeMode: 'direct', dryRun: false },
      );
    });
  });

  describe('format.* target validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');
        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    const SELECTION_TARGET = {
      kind: 'selection' as const,
      start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      end: { kind: 'text' as const, blockId: 'p1', offset: 5 },
    };

    const FORMAT_METHODS = ['bold', 'italic', 'underline', 'strikethrough'] as const;

    for (const method of FORMAT_METHODS) {
      describe(`format.${method}`, () => {
        // -- Valid cases --

        it('accepts canonical target', () => {
          const api = makeApi();
          const result = api.format[method]({ target: SELECTION_TARGET });
          expect(result.success).toBe(true);
        });

        it('allows collapsed range (start === end) through pre-apply', () => {
          const api = makeApi();
          const target = {
            kind: 'selection' as const,
            start: { kind: 'text' as const, blockId: 'p1', offset: 3 },
            end: { kind: 'text' as const, blockId: 'p1', offset: 3 },
          };
          const result = api.format[method]({ target });
          expect(result.success).toBe(true);
        });

        // -- Invalid cases --

        it('rejects no target at all', () => {
          const api = makeApi();
          expectValidationError(() => api.format[method]({} as any), 'either "target" or "ref"');
        });

        it('rejects malformed target', () => {
          const api = makeApi();
          expectValidationError(
            () => api.format[method]({ target: { kind: 'text', blockId: 'p1' } } as any),
            'SelectionTarget',
          );
        });

        // -- Input shape --

        it('rejects null input', () => {
          const api = makeApi();
          // null spreads to {}, so the merged object passes shape
          // checks but fails the locator requirement
          expectValidationError(() => api.format[method](null as any), 'either "target" or "ref"');
        });

        it('rejects unknown fields', () => {
          const api = makeApi();
          expectValidationError(
            () => api.format[method]({ target: SELECTION_TARGET, offset: 3 } as any),
            'Unknown field "offset"',
          );
        });

        it('rejects flat blockId as unknown field', () => {
          const api = makeApi();
          expectValidationError(
            () => api.format[method]({ blockId: 'p1', start: 0, end: 5 } as any),
            'Unknown field "blockId"',
          );
        });
      });
    }

    // -- Canonical payload parity --

    it('passes canonical target through to adapter.execute with inline', () => {
      const selectionAdpt = makeSelectionMutationAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: selectionAdpt,
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 2 },
      };
      api.format.bold({ target });
      expect(selectionAdpt.execute).toHaveBeenCalledWith(
        { kind: 'format', target, ref: undefined, inline: { bold: true } },
        { changeMode: 'direct', dryRun: false },
      );
    });
  });

  describe('comments.create target validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');

        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    // -- Valid cases --

    it('accepts canonical target', () => {
      const api = makeApi();
      const target = { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } } as const;
      const result = api.comments.create({ target, text: 'comment' });
      expect(result.success).toBe(true);
    });

    it('accepts kindless tracked-change target shape', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
      const target = { trackedChangeId: 'tc-1', side: 'deleted' as const };
      const result = api.comments.create({ target, text: 'comment' });
      expect(result.success).toBe(true);
      expect(commentsAdpt.add).toHaveBeenCalledWith({ target, text: 'comment' }, undefined);
    });

    it('accepts SelectionTarget', () => {
      const api = makeApi();
      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 5 },
      };
      const result = api.comments.create({ target, text: 'comment' });
      expect(result.success).toBe(true);
    });

    it('accepts tracked-change target', () => {
      const api = makeApi();
      const target = { kind: 'trackedChange' as const, trackedChangeId: 'tc-1' };
      const result = api.comments.create({ target, text: 'comment' });
      expect(result.success).toBe(true);
    });

    it('accepts reply without target (parentCommentId only)', () => {
      const api = makeApi();
      const result = api.comments.create({ parentCommentId: 'c1', text: 'reply' });
      expect(result.success).toBe(true);
    });

    // -- Invalid cases --

    it('rejects null input', () => {
      const api = makeApi();
      expectValidationError(() => api.comments.create(null as any), 'non-null object');
    });

    it('rejects unknown fields', () => {
      const api = makeApi();
      const target = { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } } as const;
      expectValidationError(
        () => api.comments.create({ target, text: 'comment', offset: 3 } as any),
        'Unknown field "offset"',
      );
    });

    it('rejects flat blockId as unknown field', () => {
      const api = makeApi();
      expectValidationError(
        () => api.comments.create({ blockId: 'p1', start: 0, end: 5, text: 'comment' } as any),
        'Unknown field "blockId"',
      );
    });

    it('rejects empty parentCommentId', () => {
      const api = makeApi();
      expectValidationError(
        () => api.comments.create({ parentCommentId: '', text: 'reply' }),
        'parentCommentId must be a non-empty string',
      );
    });

    it('rejects reply with target (conflicting modes)', () => {
      const api = makeApi();
      const target = { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } } as const;
      expectValidationError(
        () => api.comments.create({ parentCommentId: 'c1', text: 'reply', target }),
        'Cannot combine parentCommentId with target',
      );
    });

    it('rejects root comment without target', () => {
      const api = makeApi();
      expectValidationError(() => api.comments.create({ text: 'comment' }), 'requires a target for root comments');
    });

    it('rejects malformed target', () => {
      const api = makeApi();
      expectValidationError(
        () => api.comments.create({ target: { kind: 'text', blockId: 'p1' }, text: 'comment' } as any),
        'TextTarget, SelectionTarget, TrackedChangeCommentTarget',
      );
    });

    // -- Canonical payload parity --

    it('sends canonical target through unchanged', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } } as const;
      api.comments.create({ target, text: 'comment' });
      expect(commentsAdpt.add).toHaveBeenCalledWith({ target, text: 'comment' }, undefined);
    });

    it('accepts a multi-segment TextTarget and forwards it unchanged', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = {
        kind: 'text',
        segments: [
          { blockId: 'p1', range: { start: 3, end: 10 } },
          { blockId: 'p2', range: { start: 0, end: 7 } },
        ],
      } as const;
      api.comments.create({ target, text: 'comment' });
      expect(commentsAdpt.add).toHaveBeenCalledWith({ target, text: 'comment' }, undefined);
    });

    it('forwards SelectionTarget unchanged', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 1 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 4 },
      };
      api.comments.create({ target, text: 'comment' });
      expect(commentsAdpt.add).toHaveBeenCalledWith({ target, text: 'comment' }, undefined);
    });

    it('forwards tracked-change target unchanged', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = {
        kind: 'trackedChange' as const,
        trackedChangeId: 'tc-1',
        story: { kind: 'story' as const, storyType: 'body' as const },
      };
      api.comments.create({ target, text: 'comment' });
      expect(commentsAdpt.add).toHaveBeenCalledWith({ target, text: 'comment' }, undefined);
    });
  });

  describe('selection adapter', () => {
    function makeApiWithoutSelection() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    it('throws SELECTION_ADAPTER_UNAVAILABLE when selection.current is called without a selection adapter', () => {
      const api = makeApiWithoutSelection();
      try {
        api.selection.current();
        expect.fail('expected SELECTION_ADAPTER_UNAVAILABLE to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string };
        expect(e.name).toBe('DocumentApiValidationError');
        expect(e.code).toBe('SELECTION_ADAPTER_UNAVAILABLE');
      }
    });
  });

  describe('comments.patch target validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');

        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    // -- Valid cases --

    it('accepts canonical target', () => {
      const api = makeApi();
      const target = { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } } as const;
      const result = api.comments.patch({ commentId: 'c1', target });
      expect(result.success).toBe(true);
    });

    it('accepts kindless tracked-change target shape', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
      const target = { trackedChangeId: 'tc-1', side: 'source' as const };
      const result = api.comments.patch({ commentId: 'c1', target });
      expect(result.success).toBe(true);
      expect(commentsAdpt.move).toHaveBeenCalledWith({ commentId: 'c1', target }, undefined);
    });

    it('accepts SelectionTarget', () => {
      const api = makeApi();
      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 5 },
      };
      const result = api.comments.patch({ commentId: 'c1', target });
      expect(result.success).toBe(true);
    });

    it('accepts tracked-change target', () => {
      const api = makeApi();
      const target = { trackedChangeId: 'tc-1' };
      const result = api.comments.patch({ commentId: 'c1', target });
      expect(result.success).toBe(true);
    });

    it('accepts text-only patch (no target needed)', () => {
      const api = makeApi();
      const result = api.comments.patch({ commentId: 'c1', text: 'updated' });
      expect(result.success).toBe(true);
    });

    it('accepts status patch (no target needed)', () => {
      const api = makeApi();
      const result = api.comments.patch({ commentId: 'c1', status: 'resolved' });
      expect(result.success).toBe(true);
    });

    // -- Invalid cases --

    it('rejects non-string commentId', () => {
      const api = makeApi();
      expectValidationError(
        () =>
          api.comments.patch({
            commentId: 42,
            target: { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } },
          } as any),
        'commentId must be a string',
      );
    });

    it('rejects non-string commentId for text-only patch', () => {
      const api = makeApi();
      expectValidationError(
        () => api.comments.patch({ commentId: 42, text: 'x' } as any),
        'commentId must be a string',
      );
    });

    it('rejects missing commentId for status patch', () => {
      const api = makeApi();
      expectValidationError(() => api.comments.patch({ status: 'resolved' } as any), 'commentId must be a string');
    });

    it('rejects invalid status value', () => {
      const api = makeApi();
      expectValidationError(
        () => api.comments.patch({ commentId: 'c1', status: 'open' as any }),
        'status must be "resolved"',
      );
    });

    it('rejects malformed target', () => {
      const api = makeApi();
      expectValidationError(
        () => api.comments.patch({ commentId: 'c1', target: { kind: 'text', blockId: 'p1' } } as any),
        'TextTarget, SelectionTarget, TrackedChangeCommentTarget',
      );
    });

    it('rejects flat blockId as unknown field', () => {
      const api = makeApi();
      expectValidationError(
        () => api.comments.patch({ commentId: 'c1', blockId: 'p1', start: 0, end: 5 } as any),
        'Unknown field "blockId"',
      );
    });

    it('rejects multiple mutation fields in a single patch call', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      try {
        api.comments.patch({ commentId: 'c1', text: 'new text', target: { kind: 'text', blockId: 'p1' } } as any);
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');
        expect(e.code).toBe('INVALID_INPUT');
        expect(e.message).toContain('exactly one mutation field per call');
      }
      expect(commentsAdpt.edit).not.toHaveBeenCalled();
    });

    // -- Canonical payload parity --

    it('sends canonical target through to adapter.move', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = { kind: 'text', blockId: 'p1', range: { start: 0, end: 5 } } as const;
      api.comments.patch({ commentId: 'c1', target });
      expect(commentsAdpt.move).toHaveBeenCalledWith(
        {
          commentId: 'c1',
          target,
        },
        undefined,
      );
    });

    it('forwards SelectionTarget to adapter.move unchanged', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 1 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 4 },
      };
      api.comments.patch({ commentId: 'c1', target });
      expect(commentsAdpt.move).toHaveBeenCalledWith({ commentId: 'c1', target }, undefined);
    });

    it('forwards tracked-change target to adapter.move unchanged', () => {
      const commentsAdpt = makeCommentsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: commentsAdpt,
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });

      const target = { kind: 'trackedChange' as const, trackedChangeId: 'tc-1' };
      api.comments.patch({ commentId: 'c1', target });
      expect(commentsAdpt.move).toHaveBeenCalledWith({ commentId: 'c1', target }, undefined);
    });
  });

  describe('create.* location validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');

        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    // -- Valid cases --

    it('accepts at.target (canonical) for create.paragraph', () => {
      const api = makeApi();
      const result = api.create.paragraph({
        at: { kind: 'before', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' } },
        text: 'Hello',
      });
      expect(result.success).toBe(true);
    });

    it('accepts documentEnd (no target needed)', () => {
      const api = makeApi();
      const result = api.create.paragraph({ at: { kind: 'documentEnd' }, text: 'Hello' });
      expect(result.success).toBe(true);
    });

    it('accepts documentStart (no target needed)', () => {
      const api = makeApi();
      const result = api.create.paragraph({ at: { kind: 'documentStart' }, text: 'Hello' });
      expect(result.success).toBe(true);
    });

    // -- Invalid cases --

    it('rejects before/after with no target', () => {
      const api = makeApi();
      expectValidationError(
        () => api.create.paragraph({ at: { kind: 'before' } as any, text: 'Hello' }),
        'requires at.target',
      );
    });

    // -- Heading --

    it('accepts at.target for create.heading', () => {
      const api = makeApi();
      const result = api.create.heading({
        level: 2,
        at: { kind: 'after', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' } },
        text: 'Hello',
      });
      expect(result.success).toBe(true);
    });

    // -- Parity --

    it('passes at.target through to adapter', () => {
      const createAdpt = makeCreateAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: createAdpt,
        lists: makeListsAdapter(),
      });

      api.create.paragraph({
        at: { kind: 'before', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'abc' } },
        text: 'Hello',
      });
      expect(createAdpt.paragraph).toHaveBeenCalledWith(
        {
          at: { kind: 'before', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'abc' } },
          text: 'Hello',
        },
        { changeMode: 'direct', dryRun: false },
      );
    });
  });

  describe('lists.* target validation', () => {
    function makeApi() {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
      });
    }

    function expectValidationError(fn: () => void, messageMatch?: string | RegExp) {
      try {
        fn();
        expect.fail('Expected DocumentApiValidationError to be thrown');
      } catch (err: unknown) {
        const e = err as { name: string; code: string; message: string };
        expect(e.name).toBe('DocumentApiValidationError');

        if (messageMatch) {
          if (typeof messageMatch === 'string') {
            expect(e.message).toContain(messageMatch);
          } else {
            expect(e.message).toMatch(messageMatch);
          }
        }
      }
    }

    const target = { kind: 'block', nodeType: 'listItem', nodeId: 'li-1' } as const;

    // -- Valid cases --

    it('accepts canonical target for lists.indent', () => {
      const api = makeApi();
      const result = api.lists.indent({ target });
      expect(result.success).toBe(true);
    });

    it('accepts canonical target for lists.insert', () => {
      const api = makeApi();
      const result = api.lists.insert({ target, position: 'after', text: 'New' });
      expect(result.success).toBe(true);
    });

    it('accepts canonical target for lists.setLevel', () => {
      const api = makeApi();
      const result = api.lists.setLevel({ target, level: 2 });
      expect(result.success).toBe(true);
    });

    // -- Invalid cases --

    it('rejects no target at all', () => {
      const api = makeApi();
      expectValidationError(() => api.lists.indent({} as any), 'requires a target');
    });

    // -- All list mutation operations validate --

    const LISTS_MUTATIONS = [
      'outdent',
      'detach',
      'setValue',
      'continuePrevious',
      'setLevelRestart',
      'convertToText',
    ] as const;
    for (const method of LISTS_MUTATIONS) {
      it(`accepts canonical target for lists.${method}`, () => {
        const api = makeApi();
        const result = (
          api.lists[method] as (input: {
            target: typeof target;
            level?: number;
            value?: number;
            restartAfterLevel?: number | null;
          }) => unknown
        )({ target, level: 0, value: 1, restartAfterLevel: null });
        expect(result).toBeDefined();
      });
    }

    // -- Parity --

    it('passes canonical target through to adapter unchanged', () => {
      const listsAdpt = makeListsAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: listsAdpt,
      });

      api.lists.indent({ target });
      expect(listsAdpt.indent).toHaveBeenCalledWith({ target }, { changeMode: 'direct', dryRun: false });
    });
  });

  // ---------------------------------------------------------------------------
  // tables namespace
  // ---------------------------------------------------------------------------

  describe('tables.* delegation', () => {
    it('delegates table mutations with normalized options', () => {
      const tablesAdpt = makeTablesAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
        tables: tablesAdpt,
      });

      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };

      // setLayout — representative table-locator mutation
      const layoutResult = api.tables.setLayout({ target, alignment: 'center' }, { changeMode: 'tracked' });
      expect(layoutResult.success).toBe(true);
      expect(tablesAdpt.setLayout).toHaveBeenCalledWith(
        { target, alignment: 'center' },
        { changeMode: 'tracked', dryRun: false },
      );

      // delete — no explicit options → defaults
      const deleteResult = api.tables.delete({ target });
      expect(deleteResult.success).toBe(true);
      expect(tablesAdpt.delete).toHaveBeenCalledWith({ target }, { changeMode: 'direct', dryRun: false });

      // setStyle — another representative mutation
      const styleResult = api.tables.setStyle({ target, styleId: 'TableGrid' });
      expect(styleResult.success).toBe(true);

      const clearViaSetStyleResult = api.tables.setStyle({ target });
      expect(clearViaSetStyleResult.success).toBe(true);
      expect(tablesAdpt.setStyle).toHaveBeenCalledWith({ target }, { changeMode: 'direct', dryRun: false });
    });

    it('delegates table reads directly without options normalization', () => {
      const tablesAdpt = makeTablesAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
        tables: tablesAdpt,
      });

      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };

      const getResult = api.tables.get({ target });
      expect(getResult.rows).toBe(3);
      expect(getResult.columns).toBe(3);

      const cellsResult = api.tables.getCells({ target });
      expect(cellsResult.nodeId).toBe('t1');
      expect(cellsResult.cells).toHaveLength(1);

      const propsResult = api.tables.getProperties({ target });
      expect(propsResult.nodeId).toBe('t1');
      expect(propsResult.styleId).toBe('TableGrid');
    });

    it('delegates create.table with at defaulting to documentEnd', () => {
      const createAdpt = makeCreateAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: createAdpt,
        lists: makeListsAdapter(),
        tables: makeTablesAdapter(),
      });

      const result = api.create.table({ rows: 3, columns: 4 });
      expect(result.success).toBe(true);
      expect(createAdpt.table).toHaveBeenCalledWith(
        { rows: 3, columns: 4, at: { kind: 'documentEnd' } },
        { changeMode: 'direct', dryRun: false },
      );
    });

    it('delegates create.table with explicit at location', () => {
      const createAdpt = makeCreateAdapter();
      const api = createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: createAdpt,
        lists: makeListsAdapter(),
        tables: makeTablesAdapter(),
      });

      const at = { kind: 'after' as const, nodeId: 'p1' };
      api.create.table({ rows: 2, columns: 2, at });
      expect(createAdpt.table).toHaveBeenCalledWith(
        { rows: 2, columns: 2, at },
        { changeMode: 'direct', dryRun: false },
      );
    });
  });

  describe('tables.* locator validation', () => {
    function makeApi(tables: TablesAdapter = makeTablesAdapter()) {
      return createDocumentApi({
        find: makeFindAdapter(FIND_RESULT),
        get: makeGetAdapter(),
        getNode: makeGetNodeAdapter(PARAGRAPH_NODE_RESULT),
        getText: makeGetTextAdapter(),
        info: makeInfoAdapter(),
        capabilities: makeCapabilitiesAdapter(),
        comments: makeCommentsAdapter(),
        write: makeWriteAdapter(),
        selectionMutation: makeSelectionMutationAdapter(),
        trackChanges: makeTrackChangesAdapter(),
        create: makeCreateAdapter(),
        lists: makeListsAdapter(),
        tables,
      });
    }

    // -- table-locator operations (target/nodeId) --

    it('accepts target for table-locator operations', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };

      expect(() => api.tables.setLayout({ target, alignment: 'center' })).not.toThrow();
      expect(() => api.tables.get({ target })).not.toThrow();
      expect(() => api.tables.getCells({ target })).not.toThrow();
      expect(() => api.tables.getProperties({ target })).not.toThrow();
    });

    it('accepts nodeId for table-locator operations', () => {
      const api = makeApi();
      expect(() => api.tables.setLayout({ nodeId: 't1', alignment: 'center' })).not.toThrow();
      expect(() =>
        api.tables.setLayout({ nodeId: 't1', autoFitMode: 'fixedWidth', preferredWidthType: 'auto' }),
      ).not.toThrow();
      expect(() =>
        api.tables.setLayout({ nodeId: 't1', preferredWidthType: 'pct', preferredWidth: 5000 }),
      ).not.toThrow();
      expect(() => api.tables.get({ nodeId: 't1' })).not.toThrow();
    });

    it('rejects non-zero preferredWidth when preferredWidthType is auto', () => {
      const api = makeApi();
      expect(() =>
        api.tables.setLayout({
          nodeId: 't1',
          autoFitMode: 'fixedWidth',
          preferredWidthType: 'auto',
          preferredWidth: 1200,
        } as any),
      ).toThrow(/preferredWidth must be omitted or 0/);
    });

    it('rejects both target + nodeId for table-locator operations', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.setLayout({ target, nodeId: 't1' } as any)).toThrow(/Cannot combine/);
    });

    it('rejects neither target nor nodeId for table-locator operations', () => {
      const api = makeApi();
      expect(() => api.tables.setLayout({ alignment: 'center' } as any)).toThrow(/requires a target/);
    });

    // -- row-locator operations (direct OR table-scoped) --

    it('accepts direct target for row-locator operations', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableRow' as const, nodeId: 'r1' };
      expect(() => api.tables.insertRow({ target, position: 'after' })).not.toThrow();
      expect(() => api.tables.deleteRow({ target })).not.toThrow();
      expect(() => api.tables.moveRow({ target, destination: { kind: 'last' } })).not.toThrow();
    });

    it('accepts table-scoped locator for row-locator operations', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.insertRow({ target, rowIndex: 0, position: 'after' })).not.toThrow();
      expect(() => api.tables.deleteRow({ nodeId: 't1', rowIndex: 0 })).not.toThrow();
      expect(() => api.tables.moveRow({ target, rowIndex: 0, destination: { kind: 'last' } })).not.toThrow();
    });

    it('returns CAPABILITY_UNAVAILABLE when legacy table adapters omit moveRow', () => {
      const tables = makeTablesAdapter();
      delete tables.moveRow;
      const api = makeApi(tables);
      const target = { kind: 'block' as const, nodeType: 'tableRow' as const, nodeId: 'r1' };

      expect(api.tables.moveRow({ target, destination: { kind: 'last' } })).toMatchObject({
        success: false,
        failure: { code: 'CAPABILITY_UNAVAILABLE' },
      });
    });

    it('rejects table-target row ops without rowIndex at the public API boundary', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };

      expect(() => api.tables.insertRow({ target, position: 'after' } as any)).toThrow(/rowIndex is required/);
      expect(() => api.tables.deleteRow({ target } as any)).toThrow(/rowIndex is required/);
      expect(() => api.tables.moveRow({ target, destination: { kind: 'last' } } as any)).toThrow(
        /rowIndex is required/,
      );
      expect(() => api.tables.setRowHeight({ target, heightPt: 12, rule: 'atLeast' } as any)).toThrow(
        /rowIndex is required/,
      );
      expect(() => api.tables.setRowOptions({ target, repeatHeader: true } as any)).toThrow(/rowIndex is required/);
    });

    it('rejects bare nodeId row ops at the public API boundary', () => {
      const api = makeApi();

      expect(() => api.tables.insertRow({ nodeId: 't1', position: 'after' } as any)).toThrow(/rowIndex is required/);
      expect(() => api.tables.deleteRow({ nodeId: 't1' } as any)).toThrow(/rowIndex is required/);
      expect(() => api.tables.moveRow({ nodeId: 't1', destination: { kind: 'last' } } as any)).toThrow(
        /rowIndex is required/,
      );
      expect(() => api.tables.setRowHeight({ nodeId: 't1', heightPt: 12, rule: 'atLeast' } as any)).toThrow(
        /rowIndex is required/,
      );
      expect(() => api.tables.setRowOptions({ nodeId: 't1', repeatHeader: true } as any)).toThrow(
        /rowIndex is required/,
      );
    });

    it('rejects redundant rowIndex on direct row targets at the public API boundary', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableRow' as const, nodeId: 'r1' };

      expect(() => api.tables.insertRow({ target, rowIndex: 0, position: 'after' } as any)).toThrow(
        /rowIndex must not be provided/,
      );
      expect(() => api.tables.deleteRow({ target, rowIndex: 0 } as any)).toThrow(/rowIndex must not be provided/);
      expect(() => api.tables.moveRow({ target, rowIndex: 0, destination: { kind: 'last' } } as any)).toThrow(
        /rowIndex must not be provided/,
      );
      expect(() => api.tables.setRowHeight({ target, rowIndex: 0, heightPt: 12, rule: 'atLeast' } as any)).toThrow(
        /rowIndex must not be provided/,
      );
      expect(() => api.tables.setRowOptions({ target, rowIndex: 0, repeatHeader: true } as any)).toThrow(
        /rowIndex must not be provided/,
      );
    });

    it('accepts row height updates without an explicit rule', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableRow' as const, nodeId: 'r1' };
      expect(() => api.tables.setRowHeight({ target, heightPt: 12 })).not.toThrow();
    });

    it('rejects tables.setCellPadding when all sides are omitted', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableCell' as const, nodeId: 'c1' };
      expect(() => api.tables.setCellPadding({ target } as any)).toThrow(
        /at least one of topPt, rightPt, bottomPt, or leftPt/,
      );
      expect(() => api.invoke({ operationId: 'tables.setCellPadding', input: { target } })).toThrow(
        /at least one of topPt, rightPt, bottomPt, or leftPt/,
      );
      try {
        api.tables.setCellPadding({ target } as any);
      } catch (error) {
        expect((error as { code?: string }).code).toBe('INVALID_ARGUMENT');
        expect((error as { details?: { fields?: string[] } }).details?.fields).toEqual([
          'topPt',
          'rightPt',
          'bottomPt',
          'leftPt',
        ]);
      }
    });

    it('rejects tables.setCellPadding null and non-finite side values', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableCell' as const, nodeId: 'c1' };
      expect(() => api.tables.setCellPadding({ target, topPt: null } as any)).toThrow(/topPt must be/);
      expect(() => api.tables.setCellPadding({ target, rightPt: Number.NaN } as any)).toThrow(/rightPt must be/);
      expect(() => api.tables.setCellPadding({ target, bottomPt: -1 } as any)).toThrow(/bottomPt must be/);
    });

    it('accepts tables.setCellPadding partial side updates', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableCell' as const, nodeId: 'c1' };
      expect(() => api.tables.setCellPadding({ target, leftPt: 12 })).not.toThrow();
      expect(() => api.tables.setCellPadding({ nodeId: 'c1', topPt: 0 })).not.toThrow();
    });

    // -- column-locator operations (target/nodeId) --

    it('accepts target for column-locator operations', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.insertColumn({ target, columnIndex: 0, position: 'after' })).not.toThrow();
      expect(() => api.tables.deleteColumn({ target, columnIndex: 0 })).not.toThrow();
      expect(() => api.tables.moveColumn({ target, columnIndex: 0, destination: { kind: 'last' } })).not.toThrow();
    });

    it('accepts nodeId for column-locator operations', () => {
      const api = makeApi();
      expect(() => api.tables.insertColumn({ nodeId: 't1', columnIndex: 0, position: 'after' })).not.toThrow();
      expect(() =>
        api.tables.moveColumn({ nodeId: 't1', columnIndex: 0, destination: { kind: 'last' } }),
      ).not.toThrow();
    });

    it('rejects both target + nodeId for column-locator operations', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.insertColumn({ target, nodeId: 't1', columnIndex: 0, position: 'after' } as any)).toThrow(
        /Cannot combine/,
      );
      expect(() =>
        api.tables.moveColumn({ target, nodeId: 't1', columnIndex: 0, destination: { kind: 'last' } } as any),
      ).toThrow(/Cannot combine/);
    });

    it('returns CAPABILITY_UNAVAILABLE when legacy table adapters omit moveColumn', () => {
      const tables = makeTablesAdapter();
      delete tables.moveColumn;
      const api = makeApi(tables);
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };

      expect(api.tables.moveColumn({ target, columnIndex: 0, destination: { kind: 'last' } })).toMatchObject({
        success: false,
        failure: { code: 'CAPABILITY_UNAVAILABLE' },
      });
    });

    // -- merge range locator (target/nodeId) --

    it('accepts target for merge range operations', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() =>
        api.tables.mergeCells({ target, startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }),
      ).not.toThrow();
    });

    // -- unmergeCells mixed cell/table-scoped locator validation --

    it('accepts direct cell nodeId for unmergeCells', () => {
      const api = makeApi();
      expect(() => api.tables.unmergeCells({ nodeId: 'cell-1' })).not.toThrow();
    });

    it('accepts direct cell target for unmergeCells', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableCell' as const, nodeId: 'c1' };
      expect(() => api.tables.unmergeCells({ target })).not.toThrow();
    });

    it('treats explicit null coordinates as absent for direct cell target on unmergeCells', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableCell' as const, nodeId: 'c1' };
      expect(() => api.tables.unmergeCells({ target, rowIndex: null, columnIndex: null } as any)).not.toThrow();
    });

    it('accepts table-scoped locator (nodeId + rowIndex + columnIndex) for unmergeCells', () => {
      const api = makeApi();
      expect(() => api.tables.unmergeCells({ nodeId: 'table-1', rowIndex: 0, columnIndex: 0 })).not.toThrow();
    });

    it('accepts table-scoped locator (target + rowIndex + columnIndex) for unmergeCells', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.unmergeCells({ target, rowIndex: 0, columnIndex: 0 })).not.toThrow();
    });

    it('treats explicit undefined coordinates as a direct cell call for unmergeCells', () => {
      const api = makeApi();
      // { nodeId, rowIndex: undefined, columnIndex: undefined } must pass validation
      // as a direct-cell call — the keys exist but the values are absent.
      expect(() =>
        api.tables.unmergeCells({ nodeId: 'cell-1', rowIndex: undefined, columnIndex: undefined } as any),
      ).not.toThrow();
    });

    it('rejects unmergeCells with only rowIndex (missing columnIndex)', () => {
      const api = makeApi();
      expect(() => api.tables.unmergeCells({ nodeId: 'table-1', rowIndex: 0 } as any)).toThrow(
        /both rowIndex and columnIndex/,
      );
    });

    it('rejects unmergeCells with only columnIndex (missing rowIndex)', () => {
      const api = makeApi();
      expect(() => api.tables.unmergeCells({ nodeId: 'table-1', columnIndex: 0 } as any)).toThrow(
        /both rowIndex and columnIndex/,
      );
    });

    it('rejects unmergeCells with cell target plus coordinates', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'tableCell' as const, nodeId: 'c1' };
      expect(() => api.tables.unmergeCells({ target, rowIndex: 0, columnIndex: 0 } as any)).toThrow(
        /must not be provided when target is a cell node/,
      );
    });

    it('rejects unmergeCells with table target without coordinates', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.unmergeCells({ target } as any)).toThrow(
        /rowIndex and columnIndex are required when target is a table/,
      );
    });

    it('rejects unmergeCells with table target and null coordinates', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.unmergeCells({ target, rowIndex: null, columnIndex: null } as any)).toThrow(
        /rowIndex and columnIndex are required when target is a table/,
      );
    });

    it('rejects unmergeCells with table target and mixed null coordinates', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'table' as const, nodeId: 't1' };
      expect(() => api.tables.unmergeCells({ target, rowIndex: null, columnIndex: 0 } as any)).toThrow(
        /both rowIndex and columnIndex/,
      );
      expect(() => api.tables.unmergeCells({ target, rowIndex: 0, columnIndex: null } as any)).toThrow(
        /both rowIndex and columnIndex/,
      );
    });

    // -- create.table locator validation --

    it('rejects ambiguous create.table at locator (both target + nodeId)', () => {
      const api = makeApi();
      const target = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };
      expect(() =>
        api.create.table({ rows: 2, columns: 2, at: { kind: 'after', target, nodeId: 'p1' } as any }),
      ).toThrow(/Cannot combine/);
    });
  });
});
