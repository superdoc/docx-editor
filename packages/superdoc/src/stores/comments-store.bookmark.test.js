import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia, defineStore } from 'pinia';
import { ref, reactive } from 'vue';

// End-to-end regression test for #3828. Unlike comments-store.test.js, this file does
// NOT mock `@superdoc/super-editor` — it exercises the real headless Editor and the real
// `getRichTextExtensions()` schema so the `Unknown node type: bookmarkStart` throw is
// actually reproduced. Only the peripheral store dependencies are mocked.

vi.mock('./superdoc-store.js', () => {
  const documents = ref([]);
  const user = reactive({ name: 'Alice', email: 'alice@example.com' });
  const activeSelection = reactive({ documentId: 'doc-1', selectionBounds: {} });
  const selectionPosition = reactive({ source: null });
  const getDocument = (id) => documents.value.find((doc) => doc.id === id);

  const useMockStore = defineStore('superdoc', () => ({
    documents,
    user,
    activeSelection,
    selectionPosition,
    getDocument,
  }));

  return {
    useSuperdocStore: useMockStore,
    __mockSuperdoc: {
      documents,
      user,
      activeSelection,
      selectionPosition,
      emit: vi.fn(),
      config: { isInternal: false },
    },
  };
});

vi.mock('@superdoc/components/CommentsLayer/use-comment', () => ({
  default: vi.fn((params = {}) => {
    const selection = params.selection || { source: 'mock', selectionBounds: {} };
    return {
      ...params,
      selection,
      getValues: () => ({ ...params, selection }),
      setText: vi.fn(),
    };
  }),
}));

vi.mock('../core/collaboration/helpers.js', () => ({
  syncCommentsToClients: vi.fn(),
}));

vi.mock('../helpers/group-changes.js', () => ({
  groupChanges: vi.fn(() => []),
}));

import { useCommentsStore } from './comments-store.js';
import { __mockSuperdoc } from './superdoc-store.js';

// Mirrors the issue's minimal shape: an invisible bookmark pair around visible text.
const bookmarkComment = () => ({
  commentId: 'c-bookmark',
  creatorName: 'Imported Author',
  creatorEmail: 'imported@example.com',
  createdTime: 123,
  elements: [
    {
      type: 'paragraph',
      content: [
        { type: 'run', content: [{ type: 'text', text: 'Before mention ' }] },
        { type: 'bookmarkStart', attrs: { id: '42', name: '_mention' } },
        { type: 'run', content: [{ type: 'text', text: '@Person' }] },
        { type: 'bookmarkEnd', attrs: { id: '42' } },
      ],
    },
  ],
});

const collectTypes = (nodes) => {
  const types = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.type) types.push(node.type);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(nodes);
  return types;
};

describe('processLoadedDocxComments — bookmark nodes (#3828)', () => {
  let store;
  const editor = {
    converter: { commentThreadingProfile: null },
    state: {},
    options: { documentId: 'doc-1' },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setActivePinia(createPinia());
    store = useCommentsStore();
    __mockSuperdoc.documents.value = [{ id: 'doc-1', type: 'docx' }];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('imports a comment containing bookmark boundary nodes instead of dropping it', () => {
    store.processLoadedDocxComments({
      superdoc: __mockSuperdoc,
      editor,
      comments: [bookmarkComment()],
      documentId: 'doc-1',
    });

    const comment = store.commentsList.find((c) => c.commentId === 'c-bookmark');
    expect(comment).toBeDefined();

    // Visible text (and the mention) survive in the rendered HTML.
    expect(comment.commentText).toContain('Before mention');
    expect(comment.commentText).toContain('@Person');

    // The original DOCX JSON — including the bookmark metadata — is preserved for export.
    const preservedTypes = collectTypes(comment.docxCommentJSON);
    expect(preservedTypes).toContain('bookmarkStart');
    expect(preservedTypes).toContain('bookmarkEnd');
  });
});
