import { describe, expect, it, vi } from 'vite-plus/test';
import { computed, ref } from 'vue';
import { createCommentDocumentScope, getCommentDocumentId } from './comment-document-scope.js';
import type { OpenDocumentsSource } from './comment-document-scope.js';

const scopeOver = (documents: OpenDocumentsSource) => createCommentDocumentScope(() => documents);

describe('getCommentDocumentId', () => {
  it('prefers fileId, then documentId, then the selection document id', () => {
    expect(getCommentDocumentId({ fileId: 7, documentId: 'doc-2', selection: { documentId: 'doc-3' } })).toBe('7');
    expect(getCommentDocumentId({ fileId: null, documentId: 'doc-2', selection: { documentId: 'doc-3' } })).toBe(
      'doc-2',
    );
    expect(getCommentDocumentId({ selection: { documentId: 'doc-3' } })).toBe('doc-3');
  });

  it('returns null for a missing comment or one without document metadata', () => {
    expect(getCommentDocumentId(null)).toBeNull();
    expect(getCommentDocumentId(undefined)).toBeNull();
    expect(getCommentDocumentId({})).toBeNull();
    expect(getCommentDocumentId({ selection: null })).toBeNull();
  });
});

describe('belongsToDocument', () => {
  it('is false without an active document id', () => {
    const { belongsToDocument } = scopeOver([{ id: 'doc-1' }]);
    expect(belongsToDocument({ fileId: 'doc-1' }, null)).toBe(false);
    expect(belongsToDocument({ fileId: 'doc-1' }, '')).toBe(false);
  });

  it('matches a comment whose document id equals the active one', () => {
    const { belongsToDocument } = scopeOver([{ id: 'doc-1' }, { id: 'doc-2' }]);
    expect(belongsToDocument({ fileId: 'doc-2' }, 'doc-2')).toBe(true);
    expect(belongsToDocument({ fileId: 'doc-1' }, 'doc-2')).toBe(false);
  });

  it('accepts a mismatched comment only when allowed and the active document is the only one open', () => {
    const single = scopeOver([{ id: 'doc-1' }]);
    expect(single.belongsToDocument({ fileId: 'peer-doc' }, 'doc-1')).toBe(false);
    expect(single.belongsToDocument({ fileId: 'peer-doc' }, 'doc-1', { allowSingleDocumentMismatch: true })).toBe(true);
    expect(single.belongsToDocument({ fileId: 'peer-doc' }, 'doc-9', { allowSingleDocumentMismatch: true })).toBe(
      false,
    );

    const multiple = scopeOver([{ id: 'doc-1' }, { id: 'doc-2' }]);
    expect(multiple.belongsToDocument({ fileId: 'peer-doc' }, 'doc-1', { allowSingleDocumentMismatch: true })).toBe(
      false,
    );
  });

  it('assigns a comment without document metadata to the only open document', () => {
    expect(scopeOver([{ id: 'doc-1' }]).belongsToDocument({}, 'doc-1')).toBe(true);
    expect(scopeOver([{ id: 'doc-1' }]).belongsToDocument(null, 'doc-2')).toBe(false);
    expect(scopeOver([{ id: 'doc-1' }, { id: 'doc-2' }]).belongsToDocument({}, 'doc-1')).toBe(false);
    expect(scopeOver([{}]).belongsToDocument({}, 'doc-1')).toBe(false);
    expect(scopeOver([{ id: 4 }]).belongsToDocument({}, '4')).toBe(true);
  });

  it('reads open documents from an array, a ref-like value, or nothing', () => {
    expect(scopeOver({ value: [{ id: 'doc-1' }] }).belongsToDocument({}, 'doc-1')).toBe(true);
    expect(scopeOver({ value: null }).belongsToDocument({}, 'doc-1')).toBe(false);
    expect(scopeOver(null).belongsToDocument({}, 'doc-1')).toBe(false);
    expect(scopeOver(undefined).belongsToDocument({}, 'doc-1')).toBe(false);
  });

  it('reads the open documents on each call, not when the scope is created', () => {
    const readOpenDocuments = vi.fn((): OpenDocumentsSource => [{ id: 'doc-1' }]);
    const { belongsToDocument } = createCommentDocumentScope(readOpenDocuments);
    expect(readOpenDocuments).not.toHaveBeenCalled();
    expect(belongsToDocument({ fileId: 'doc-1' }, 'doc-1')).toBe(true);
    expect(readOpenDocuments).not.toHaveBeenCalled();
    belongsToDocument({}, 'doc-1');
    belongsToDocument({}, 'doc-1');
    expect(readOpenDocuments).toHaveBeenCalledTimes(2);
  });

  it('makes a computed depend on the open documents only when it needs them', () => {
    const documents = ref([{ id: 'doc-1' }]);
    const unrelated = ref(0);
    const { belongsToDocument } = createCommentDocumentScope(() => documents.value);
    const evaluate = vi.fn(() => belongsToDocument({}, 'doc-1'));
    const scoped = computed(evaluate);

    expect(scoped.value).toBe(true);
    unrelated.value += 1;
    expect(scoped.value).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);

    documents.value = [{ id: 'doc-1' }, { id: 'doc-2' }];
    expect(scoped.value).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(2);

    const matchOnly = vi.fn(() => belongsToDocument({ fileId: 'doc-1' }, 'doc-1'));
    const matched = computed(matchOnly);
    expect(matched.value).toBe(true);
    documents.value = [];
    expect(matched.value).toBe(true);
    expect(matchOnly).toHaveBeenCalledTimes(1);
  });
});

describe('belongsToTrackedChangeSyncDocument', () => {
  it('allows the single-document mismatch', () => {
    const { belongsToTrackedChangeSyncDocument } = scopeOver([{ id: 'doc-1' }]);
    expect(belongsToTrackedChangeSyncDocument({ fileId: 'peer-doc' }, 'doc-1')).toBe(true);
    expect(belongsToTrackedChangeSyncDocument({ fileId: 'doc-1' }, 'doc-1')).toBe(true);
    expect(belongsToTrackedChangeSyncDocument({ fileId: 'peer-doc' }, null)).toBe(false);
  });

  it('rejects a mismatch when more than one document is open', () => {
    const { belongsToTrackedChangeSyncDocument } = scopeOver([{ id: 'doc-1' }, { id: 'doc-2' }]);
    expect(belongsToTrackedChangeSyncDocument({ fileId: 'peer-doc' }, 'doc-1')).toBe(false);
  });
});
