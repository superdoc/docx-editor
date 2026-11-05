import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import type { ReceiptSuccess } from '@superdoc/document-api';
import { useCommentsStore } from './comments-store.js';
import { useSuperdocStore } from './superdoc-store.js';
import useComment from '../components/CommentsLayer/use-comment.js';
import { DOCUMENT_EDITOR_SELECTION_SOURCE } from '../helpers/selection-source.js';

type CommentsStore = ReturnType<typeof useCommentsStore>;
type StoreHost = NonNullable<Parameters<CommentsStore['setActiveComment']>[0]>;
type TrackedChangeParams = Parameters<CommentsStore['handleTrackedChangeUpdate']>[0]['params'];

const host = (activeEditor: StoreHost['activeEditor'] = null): StoreHost => ({
  activeEditor,
  config: {},
  emit: vi.fn(),
});

const trackedChange = (changeId: string | number, event = 'add'): TrackedChangeParams => ({
  event,
  changeId,
  documentId: 'doc-1',
  trackedChangeText: 'inserted',
  trackedChangeType: 'trackInsert',
  author: 'Author',
  authorEmail: 'author@example.com',
  date: 1,
});

describe('comments-store inputs its types guard', () => {
  let store: CommentsStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    const superdocStore = useSuperdocStore();
    superdocStore.documents.push({
      id: 'doc-1',
      type: 'docx',
      isReady: true,
      pageContainers: [],
      getEditor: () => null,
      getDocumentRuntime: () => null,
    });
    store = useCommentsStore();
  });

  it('skips a legacy editor command the editor does not provide', () => {
    expect(() => store.setActiveComment(host({ commands: {} }), null)).not.toThrow();
  });

  it('stores a numeric tracked-change id as a string comment id', () => {
    store.handleTrackedChangeUpdate({ superdoc: host(), params: trackedChange(42) });

    expect(store.commentsList.map((row) => row.commentId)).toEqual(['42']);
  });

  it('emits a null pending selection when the editor reports a non-object selection', () => {
    useSuperdocStore().activeSelection = {
      source: DOCUMENT_EDITOR_SELECTION_SOURCE,
      documentId: 'doc-1',
      selectionBounds: {},
    };
    const superdoc = host({
      options: { documentId: 'doc-1' },
      // @ts-expect-error current() returns a string, which the snapshot guard rejects
      doc: { selection: { current: () => 'text' } },
      commands: { insertComment: vi.fn() },
    });

    void store.showAddComment(superdoc);

    expect(superdoc.emit).toHaveBeenCalledWith(
      'comments-update',
      expect.objectContaining({ type: 'pending', pendingSelection: null }),
    );
  });

  it('rejects an invalid tracked-change story before calling the Document API', async () => {
    const decide = vi.fn(async (): Promise<ReceiptSuccess> => ({ success: true }));
    const comment = useComment({ trackedChange: true, commentId: 'tc-1' });
    comment.trackedChangeStory = { kind: 'story', storyType: 'not-a-story' };

    const outcome = await store.decideTrackedChangeFromSidebar({
      superdoc: host({ doc: { trackChanges: { decide } }, commands: {} }),
      comment,
      decision: 'accept',
    });

    expect(decide).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, error: expect.any(TypeError) });
  });

  it('throws before resolving a tracked change when no host is given', () => {
    store.handleTrackedChangeUpdate({ superdoc: host(), params: trackedChange('tc-9') });

    expect(() => store.handleTrackedChangeUpdate({ superdoc: null, params: trackedChange('tc-9', 'resolve') })).toThrow(
      'handleTrackedChangeUpdate requires superdoc',
    );
    expect(store.commentsList.find((row) => row.commentId === 'tc-9')?.resolvedTime).toBeNull();
  });
});
