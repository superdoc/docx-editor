import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import PdfCommentsLayer from './PdfCommentsLayer.vue';
import useComment from './use-comment.js';
import { useCommentsStore } from '../../stores/comments-store.js';
import { useSuperdocStore } from '../../stores/superdoc-store.js';
import { DOCUMENT_EDITOR_SELECTION_SOURCE } from '../../helpers/selection-source.js';

const PDF_TYPE = 'application/pdf';

const makePdfComment = (overrides = {}) =>
  useComment({
    commentId: 'pdf-c1',
    fileId: 'pdf-doc',
    fileType: PDF_TYPE,
    commentText: 'PDF comment body',
    selection: {
      source: 'pdf',
      page: 1,
      documentId: 'pdf-doc',
      selectionBounds: { top: 100, left: 50, right: 150, bottom: 130 },
    },
    ...overrides,
  });

const makeDocxComment = (overrides = {}) =>
  useComment({
    commentId: 'docx-c1',
    fileId: 'docx-doc',
    fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    commentText: 'DOCX comment body',
    selection: {
      source: DOCUMENT_EDITOR_SELECTION_SOURCE,
      page: 1,
      documentId: 'docx-doc',
      selectionBounds: { top: 10, left: 10, right: 60, bottom: 30 },
    },
    ...overrides,
  });

describe('PdfCommentsLayer', () => {
  let commentsStore;
  let superdocStore;
  let superdocStub;

  const mountLayer = () =>
    mount(PdfCommentsLayer, {
      global: { config: { globalProperties: { $superdoc: superdocStub } } },
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    commentsStore = useCommentsStore();
    superdocStore = useSuperdocStore();
    superdocStore.documents = [{ id: 'pdf-doc', type: PDF_TYPE }];
    superdocStore.activeZoom = 100;
    superdocStub = { activeEditor: null, emit: vi.fn(), config: {} };
  });

  it('renders one .sd-comment-anchor with data ids and page metadata for a PDF comment', () => {
    commentsStore.commentsList = [makePdfComment()];
    const wrapper = mountLayer();
    const anchors = wrapper.findAll('.sd-comment-anchor');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    expect(anchor.classes()).toContain('sd-highlight');
    expect(anchor.attributes('data-id')).toBe('pdf-c1');
    expect(anchor.attributes('data-comment-id')).toBe('pdf-c1');
    expect(anchor.attributes('data-page-number')).toBe('1');
  });

  it('ignores DOCX editor-backed comments', () => {
    commentsStore.commentsList = [makeDocxComment()];
    superdocStore.documents = [
      { id: 'pdf-doc', type: PDF_TYPE },
      { id: 'docx-doc', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];
    const wrapper = mountLayer();
    expect(wrapper.findAll('.sd-comment-anchor')).toHaveLength(0);
  });

  it('ignores resolved PDF comments', () => {
    commentsStore.commentsList = [makePdfComment({ resolvedTime: Date.now() })];
    const wrapper = mountLayer();
    expect(wrapper.findAll('.sd-comment-anchor')).toHaveLength(0);
  });

  it('ignores PDF comments without finite selection bounds', () => {
    commentsStore.commentsList = [
      makePdfComment({ selection: { source: 'pdf', page: 1, documentId: 'pdf-doc', selectionBounds: {} } }),
    ];
    const wrapper = mountLayer();
    expect(wrapper.findAll('.sd-comment-anchor')).toHaveLength(0);
  });

  it('ignores PDF comments with null selection bounds', () => {
    commentsStore.commentsList = [
      makePdfComment({
        selection: {
          source: 'pdf',
          page: 1,
          documentId: 'pdf-doc',
          selectionBounds: { top: null, left: 50, right: 150, bottom: 130 },
        },
      }),
    ];
    const wrapper = mountLayer();
    expect(wrapper.findAll('.sd-comment-anchor')).toHaveLength(0);
  });

  it('ignores PDF comments without a stable comment id', () => {
    const comment = makePdfComment();
    comment.commentId = null;
    comment.importedId = null;
    commentsStore.commentsList = [comment];
    const wrapper = mountLayer();
    expect(wrapper.findAll('.sd-comment-anchor')).toHaveLength(0);
  });

  it('does not render anchors for comments belonging to a different document', () => {
    commentsStore.commentsList = [makePdfComment({ commentId: 'pdf-other', fileId: 'other-pdf' })];
    const wrapper = mountLayer();
    expect(wrapper.findAll('.sd-comment-anchor')).toHaveLength(0);
  });

  it('positions the anchor from selection bounds at the current zoom', () => {
    commentsStore.commentsList = [makePdfComment()];
    superdocStore.activeZoom = 200;
    const wrapper = mountLayer();
    const style = wrapper.find('.sd-comment-anchor').attributes('style');
    // top 100 * 2, left 50 * 2, width (150-50) * 2, height (130-100) * 2
    expect(style).toContain('top: 200px');
    expect(style).toContain('left: 100px');
    expect(style).toContain('width: 200px');
    expect(style).toContain('height: 60px');
  });

  it('activates the real comment through setActiveComment on click', async () => {
    commentsStore.commentsList = [makePdfComment()];
    const setActiveSpy = vi.spyOn(commentsStore, 'setActiveComment');
    const wrapper = mountLayer();
    await wrapper.find('.sd-comment-anchor').trigger('click');
    expect(setActiveSpy).toHaveBeenCalledTimes(1);
    expect(setActiveSpy.mock.calls[0][1]).toBe('pdf-c1');
    expect(commentsStore.activeComment).toBe('pdf-c1');
  });

  it('activates the comment via keyboard (Enter)', async () => {
    commentsStore.commentsList = [makePdfComment()];
    const wrapper = mountLayer();
    await wrapper.find('.sd-comment-anchor').trigger('keydown.enter');
    expect(commentsStore.activeComment).toBe('pdf-c1');
  });
});
