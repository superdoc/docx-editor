import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerStaticInvalidationHandlers, registerHeaderFooterInvalidation } from './invalidation-handlers.js';
import { applyPartInvalidation, clearInvalidationHandlers } from './part-invalidation-registry.js';
import * as xmljs from 'xml-js';
import { captureCommentAuthorSource, prepareCommentAuthors } from '../../super-converter/comment-author-identity.js';
import type { PartChangedEvent } from '../types.js';

function createMockEditor() {
  const tr = { setMeta: vi.fn() };
  return {
    state: { tr },
    view: { dispatch: vi.fn() },
  };
}

function makeEvent(partIds: string[]): PartChangedEvent {
  return {
    parts: partIds.map((id) => ({
      partId: id,
      operation: 'mutate' as const,
      changedPaths: [],
    })),
    source: 'test',
  };
}

describe('invalidation handlers', () => {
  beforeEach(() => {
    clearInvalidationHandlers();
  });

  afterEach(() => {
    clearInvalidationHandlers();
  });

  describe('registerStaticInvalidationHandlers', () => {
    it('registers numbering and rels handlers', () => {
      registerStaticInvalidationHandlers();
      const editor = createMockEditor();

      applyPartInvalidation(editor as any, makeEvent(['word/numbering.xml']));
      expect(editor.view.dispatch).toHaveBeenCalledTimes(1);

      applyPartInvalidation(editor as any, makeEvent(['word/_rels/document.xml.rels']));
      // Rels handler is no-op — dispatch count should not increase
      expect(editor.view.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  it('captures only committed new source comment IDs and keeps origin after source deletion', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const row = (id: string, name: string) => `<w:comment w:internalId="${id}" w:author="${name}"/>`;
    const tree = (rows: string) => xmljs.xml2js(`<w:comments xmlns:w="${W}">${rows}</w:comments>`);
    const convertedXml: any = { 'word/comments.xml': tree(row('old', 'Old source')) };
    const converter = { convertedXml, commentAuthorSource: captureCommentAuthorSource(convertedXml) };
    const prepare = (comments: any[], validationComments = comments) => {
      const result = prepareCommentAuthors({
        convertedXml,
        comments,
        validationComments,
        source: converter.commentAuthorSource,
      });
      converter.commentAuthorSource = result.source ?? converter.commentAuthorSource;
      return result;
    };
    const local = {
      commentId: 'local',
      creatorName: 'Local',
      creatorIdentity: { providerId: 'vendor', userId: 'local-account' },
    };
    prepare([], [local]); // Full input establishes local ownership before any generated rows can arrive.
    const editor = { converter };
    registerStaticInvalidationHandlers();
    convertedXml['word/comments.xml'].elements[0].elements = tree(
      row('old', 'Renamed source') + row('local', 'Forged source') + row('later', 'Late source'),
    ).elements[0].elements;
    applyPartInvalidation(editor as any, makeEvent(['word/comments.xml']));
    let rows = prepare([
      { commentId: 'old', creatorName: 'UI decoration' },
      local,
      { commentId: 'later', creatorName: 'Caller spoof' },
    ]).comments;
    expect(rows.map((comment: any) => comment.wordAuthorName)).toEqual(['Renamed source', 'Local', 'Late source']);
    expect(rows[1].creatorIdentity).toEqual(local.creatorIdentity);
    delete convertedXml['word/comments.xml'];
    applyPartInvalidation(editor as any, {
      ...makeEvent(['word/comments.xml']),
      parts: [{ partId: 'word/comments.xml' as any, operation: 'delete', changedPaths: [] }],
    });
    rows = prepare([
      { commentId: 'old', creatorName: 'UI decoration' },
      { commentId: 'later', creatorName: 'Caller spoof' },
    ]).comments;
    expect(rows.map((comment: any) => comment.wordAuthorName)).toEqual(['Renamed source', 'Late source']);
    expect(prepare([]).comments).toEqual([]);
  });

  describe('numbering invalidation', () => {
    it('dispatches an empty PM transaction', () => {
      registerStaticInvalidationHandlers();
      const editor = createMockEditor();

      applyPartInvalidation(editor as any, makeEvent(['word/numbering.xml']));

      expect(editor.view.dispatch).toHaveBeenCalledWith(editor.state.tr);
    });

    it('does not throw when view is undefined', () => {
      registerStaticInvalidationHandlers();
      const editor = { state: { tr: {} }, view: undefined };

      expect(() => {
        applyPartInvalidation(editor as any, makeEvent(['word/numbering.xml']));
      }).not.toThrow();
    });
  });

  describe('relationships invalidation', () => {
    it('is a no-op (no dispatch)', () => {
      registerStaticInvalidationHandlers();
      const editor = createMockEditor();

      applyPartInvalidation(editor as any, makeEvent(['word/_rels/document.xml.rels']));

      expect(editor.view.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('header/footer invalidation', () => {
    it('registers a handler for a dynamically created part', () => {
      registerHeaderFooterInvalidation('word/header3.xml');
      const editor = createMockEditor();

      applyPartInvalidation(editor as any, makeEvent(['word/header3.xml']));

      expect(editor.view.dispatch).toHaveBeenCalledTimes(1);
      expect(editor.state.tr.setMeta).toHaveBeenCalledWith('forceUpdatePagination', true);
    });

    it('fires for footer parts too', () => {
      registerHeaderFooterInvalidation('word/footer2.xml');
      const editor = createMockEditor();

      applyPartInvalidation(editor as any, makeEvent(['word/footer2.xml']));

      expect(editor.view.dispatch).toHaveBeenCalledTimes(1);
      expect(editor.state.tr.setMeta).toHaveBeenCalledWith('forceUpdatePagination', true);
    });

    it('does not fire for unregistered parts', () => {
      registerHeaderFooterInvalidation('word/header1.xml');
      const editor = createMockEditor();

      applyPartInvalidation(editor as any, makeEvent(['word/header99.xml']));

      expect(editor.view.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('transaction batching', () => {
    it('fires each handler at most once per mutateParts transaction', () => {
      registerStaticInvalidationHandlers();
      registerHeaderFooterInvalidation('word/header1.xml');
      const editor = createMockEditor();

      // Event with multiple parts including duplicate handlers
      const event: PartChangedEvent = {
        parts: [
          { partId: 'word/numbering.xml', operation: 'mutate', changedPaths: [] },
          { partId: 'word/header1.xml', operation: 'mutate', changedPaths: [] },
        ],
        source: 'test',
      };

      applyPartInvalidation(editor as any, event);

      // numbering dispatches once, header dispatches once = 2 total
      expect(editor.view.dispatch).toHaveBeenCalledTimes(2);
    });
  });
});
