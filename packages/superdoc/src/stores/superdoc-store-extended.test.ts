import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { useSuperdocStore } from './superdoc-store.js';
import { DOCX, PDF } from '@superdoc/common';

class BlobMock {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = options.type || '';
    this.size = 0;
  }
}
globalThis.Blob ??= BlobMock;
globalThis.File ??= class extends BlobMock {
  constructor(parts, name, opts = {}) {
    super(parts, opts);
    this.name = name;
  }
};

const baseConfig = (docs = [], overrides = {}) => ({
  documents: docs,
  modules: { collaboration: false, ...(overrides.modules || {}) },
  user: { name: 'Alice', email: 'a@b.com' },
  users: [],
  ...overrides,
});

describe('SuperDoc Store - extended coverage', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSuperdocStore();
  });

  describe('reset', () => {
    it('clears documents, users, modules, and resets state flags', async () => {
      const file = new File(['x'], 'a.docx', { type: DOCX });
      await store.init(baseConfig([{ data: file, type: DOCX, name: 'a.docx' }]));
      expect(store.documents.length).toBe(1);
      expect(store.isReady).toBe(true);

      store.reset();

      expect(store.documents).toEqual([]);
      expect(store.documentBounds).toEqual([]);
      expect(store.documentUsers).toEqual([]);
      expect(store.isReady).toBe(false);
      expect(store.user.name).toBeNull();
      expect(store.user.email).toBeNull();
    });
  });

  describe('getDocument', () => {
    it('returns the matching document by id', async () => {
      const file = new File(['x'], 'doc.docx', { type: DOCX });
      await store.init(baseConfig([{ id: 'my-doc', data: file, type: DOCX, name: 'doc.docx' }]));
      const doc = store.getDocument('my-doc');
      expect(doc).toBeDefined();
      expect(doc.id).toBe('my-doc');
    });

    it('returns undefined when id is not found', () => {
      expect(store.getDocument('missing')).toBeUndefined();
    });
  });

  describe('removeDocument', () => {
    it('removes the document from store/config state and prunes document-scoped comments', async () => {
      const fileA = new File(['a'], 'a.docx', { type: DOCX });
      const fileB = new File(['b'], 'b.docx', { type: DOCX });
      const config = baseConfig([
        { id: 'doc-1', data: fileA, type: DOCX, name: 'a.docx' },
        { id: 'doc-2', data: fileB, type: DOCX, name: 'b.docx' },
      ]);

      await store.init(config);

      store.pages['doc-1'] = [{ page: 1, containerBounds: { top: 0, height: 100 } }];
      store.activeSelection = { documentId: 'doc-1', text: 'alpha' };
      store.commentsStore.commentsList = [
        { commentId: 'comment-a', fileId: 'doc-1' },
        { commentId: 'comment-b', fileId: 'doc-2' },
      ];
      store.commentsStore.editorCommentPositions = {
        'comment-a': { top: 10 },
        'comment-b': { top: 20 },
      };
      store.commentsStore.activeComment = 'comment-a';

      const removed = store.removeDocument('doc-1');

      expect(removed?.id).toBe('doc-1');
      expect(store.documents.map((doc) => doc.id)).toEqual(['doc-2']);
      expect(config.documents.map((doc) => doc.id)).toEqual(['doc-2']);
      expect(store.getDocument('doc-1')).toBeUndefined();
      expect(store.pages['doc-1']).toBeUndefined();
      expect(store.activeSelection).toBeNull();
      expect(store.commentsStore.commentsList).toEqual([{ commentId: 'comment-b', fileId: 'doc-2' }]);
      expect(store.commentsStore.editorCommentPositions).toEqual({
        'comment-b': { top: 20 },
      });
      expect(store.commentsStore.activeComment).toBeNull();
    });

    it('returns null when the document id is unknown', async () => {
      const file = new File(['x'], 'doc.docx', { type: DOCX });
      await store.init(baseConfig([{ id: 'doc-1', data: file, type: DOCX, name: 'doc.docx' }]));

      expect(store.removeDocument('missing-doc')).toBeNull();
      expect(store.documents.map((doc) => doc.id)).toEqual(['doc-1']);
    });
  });

  describe('handlePageReady', () => {
    it('creates the pages entry on first call and appends on subsequent', async () => {
      const file = new File(['x'], 'doc.docx', { type: DOCX });
      await store.init(baseConfig([{ id: 'doc-1', data: file, type: DOCX, name: 'doc.docx' }]));
      const doc = store.getDocument('doc-1');
      if (!doc.pageContainers) doc.pageContainers = [];

      store.handlePageReady('doc-1', 1, { top: 0, height: 100 });
      store.handlePageReady('doc-1', 2, { top: 100, height: 100 });

      expect(store.pages['doc-1']).toHaveLength(2);
      expect(doc.pageContainers).toHaveLength(2);
    });

    it('is a no-op on the doc side when documentId does not resolve', () => {
      store.handlePageReady('missing-doc', 1, { top: 0, height: 100 });
      expect(store.pages['missing-doc']).toEqual([{ page: 1, containerBounds: { top: 0, height: 100 } }]);
    });
  });

  describe('getPageBounds', () => {
    beforeEach(async () => {
      const file = new File(['x'], 'doc.docx', { type: DOCX });
      await store.init(baseConfig([{ id: 'doc-1', data: file, type: DOCX, name: 'doc.docx' }]));
    });

    it('returns undefined when the document has no pages recorded', () => {
      expect(store.getPageBounds('unknown', 1)).toBeUndefined();
    });

    it('returns undefined when the page has no container element', () => {
      store.pages['doc-1'] = [{ page: 1, container: null }];
      expect(store.getPageBounds('doc-1', 1)).toBeUndefined();
    });

    it('computes top offset from the page container size', () => {
      const container = { getBoundingClientRect: () => ({ height: 50, width: 100 }) };
      store.pages['doc-1'] = [
        { page: 1, container },
        { page: 2, container },
      ];
      // page 2 = (2-1) * 50 = 50
      expect(store.getPageBounds('doc-1', 2)).toEqual({ top: 50 });
    });
  });

  describe('areDocumentsReady', () => {
    it('is true when there are no PDF documents', async () => {
      const file = new File(['x'], 'doc.docx', { type: DOCX });
      await store.init(baseConfig([{ data: file, type: DOCX, name: 'doc.docx' }]));
      expect(store.areDocumentsReady).toBe(true);
    });

    it('is false when any PDF document is not ready', async () => {
      store.documents = [
        { type: 'pdf', isReady: false },
        { type: 'pdf', isReady: true },
      ];
      expect(store.areDocumentsReady).toBe(false);
    });

    it('is true when all PDF documents are ready', async () => {
      store.documents = [
        { type: 'pdf', isReady: true },
        { type: 'pdf', isReady: true },
      ];
      expect(store.areDocumentsReady).toBe(true);
    });
  });

  describe('setExceptionHandler', () => {
    it('accepts a function and receives payloads', async () => {
      const handler = vi.fn();
      store.setExceptionHandler(handler);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await store.init(baseConfig([null])); // null doc triggers exception
      expect(handler).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('clears handler when given a non-function', async () => {
      const fn = vi.fn();
      store.setExceptionHandler(fn);
      store.setExceptionHandler('not a function');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await store.init(baseConfig([null]));
      expect(fn).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('falls back to config.onException when no handler is set', async () => {
      const onException = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await store.init(baseConfig([null], { onException }));
      expect(onException).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('collaboration mode', () => {
    it('strips data/url from entries when collaboration is enabled and doc is not new', async () => {
      const file = new File(['x'], 'doc.docx', { type: DOCX });
      await store.init(
        baseConfig([{ data: file, type: DOCX, name: 'doc.docx' }], {
          modules: { collaboration: { providerUrl: 'ws://x' } },
        }),
      );
      const doc = store.documents[0];
      expect(doc.data).toBeNull();
      expect(doc.url ?? null).toBeNull();
    });
  });
});
