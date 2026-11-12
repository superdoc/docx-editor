import { describe, it, expect, mock } from 'bun:test';
import { DocumentApiValidationError } from '../errors.js';
import {
  executeBookmarksList,
  executeBookmarksGet,
  executeBookmarksInsert,
  executeBookmarksRename,
  executeBookmarksRemove,
  type BookmarksAdapter,
} from './bookmarks.js';

function makeAdapter(): BookmarksAdapter {
  return {
    list: mock().mockReturnValue({ items: [], total: 0 }),
    get: mock().mockReturnValue({}),
    insert: mock().mockReturnValue({ success: true }),
    rename: mock().mockReturnValue({ success: true }),
    remove: mock().mockReturnValue({ success: true }),
  };
}

const validTarget = { kind: 'entity', entityType: 'bookmark', name: 'bm1' };
const validStory = { kind: 'story', storyType: 'footnote', noteId: 'fn-1' } as const;

describe('bookmarks validation', () => {
  // ── Target validation ───────────────────────────────────────────────
  describe('validateBookmarkTarget', () => {
    it('throws INVALID_TARGET for null target', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksGet(adapter, { target: null as any })).toThrow(DocumentApiValidationError);
      try {
        executeBookmarksGet(adapter, { target: null as any });
      } catch (e: any) {
        expect(e.code).toBe('INVALID_TARGET');
      }
    });

    it('throws INVALID_TARGET for undefined target', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksGet(adapter, { target: undefined as any })).toThrow(DocumentApiValidationError);
    });

    it('throws INVALID_TARGET for wrong kind', () => {
      const adapter = makeAdapter();
      expect(() =>
        executeBookmarksGet(adapter, {
          target: { kind: 'block', entityType: 'bookmark', name: 'bm1' } as any,
        }),
      ).toThrow(DocumentApiValidationError);
    });

    it('throws INVALID_TARGET for wrong entityType', () => {
      const adapter = makeAdapter();
      expect(() =>
        executeBookmarksGet(adapter, {
          target: { kind: 'entity', entityType: 'link', name: 'bm1' } as any,
        }),
      ).toThrow(DocumentApiValidationError);
    });

    it('throws INVALID_TARGET when name is not a string', () => {
      const adapter = makeAdapter();
      expect(() =>
        executeBookmarksGet(adapter, {
          target: { kind: 'entity', entityType: 'bookmark', name: 123 } as any,
        }),
      ).toThrow(DocumentApiValidationError);
    });

    it('throws INVALID_INPUT when target.story is invalid', () => {
      const adapter = makeAdapter();
      expect(() =>
        executeBookmarksGet(adapter, {
          target: { kind: 'entity', entityType: 'bookmark', name: 'bm1', story: 'body' } as any,
        }),
      ).toThrow(DocumentApiValidationError);
    });
  });

  // ── Input validation ────────────────────────────────────────────────
  describe('executeBookmarksInsert', () => {
    it.each([
      'has spaces',
      '9starts_with_digit',
      'x'.repeat(60),
      'x'.repeat(41),
      '_'.concat('a'.repeat(40)),
      '_has spaces',
      '_a-b',
      'a=b',
      'a-b',
      'a\n',
      'a\u200db',
      'a\u20dd',
      '𐐀'.repeat(21),
    ])('rejects an invalid creation name %j before adapter delegation', (name) => {
      const adapter = makeAdapter();
      for (const dryRun of [false, true]) {
        const result = executeBookmarksInsert(adapter, { name } as any, { dryRun });
        expect(result).toMatchObject({ success: false, failure: { code: 'INVALID_PAYLOAD' } });
      }
      expect(adapter.insert).not.toHaveBeenCalled();
    });

    it.each([
      'A',
      'ok_name',
      '_hidden',
      '_Ref123',
      '_'.concat('a'.repeat(39)),
      'a'.repeat(40),
      'école',
      '中文',
      'αριθμός',
      'e\u0301cole',
      'a١',
      '𐐀'.repeat(20),
    ])('preserves a valid creation name %j', (name) => {
      const adapter = makeAdapter();
      const input = { name };
      executeBookmarksInsert(adapter, input as any);
      expect(adapter.insert).toHaveBeenCalledWith(input, { changeMode: 'direct', dryRun: false });
    });

    it('throws INVALID_INPUT when name is empty', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksInsert(adapter, { name: '' } as any)).toThrow(DocumentApiValidationError);
      try {
        executeBookmarksInsert(adapter, { name: '' } as any);
      } catch (e: any) {
        expect(e.code).toBe('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT when name is not a string', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksInsert(adapter, { name: 42 } as any)).toThrow(DocumentApiValidationError);
    });

    it('throws INVALID_INPUT when name is missing', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksInsert(adapter, {} as any)).toThrow(DocumentApiValidationError);
    });

    it('delegates to adapter.insert with normalized options', () => {
      const adapter = makeAdapter();
      const input = { name: 'bookmark1' };
      executeBookmarksInsert(adapter, input as any, { dryRun: true });
      expect(adapter.insert).toHaveBeenCalledWith(input, { changeMode: 'direct', dryRun: true });
    });
  });

  describe('executeBookmarksRename', () => {
    it('throws INVALID_TARGET for invalid target', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksRename(adapter, { target: null as any, newName: 'x' } as any)).toThrow(
        DocumentApiValidationError,
      );
    });

    it('throws INVALID_INPUT when newName is empty', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksRename(adapter, { target: validTarget, newName: '' } as any)).toThrow(
        DocumentApiValidationError,
      );
    });

    it('throws INVALID_INPUT when newName is not a string', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksRename(adapter, { target: validTarget, newName: 99 } as any)).toThrow(
        DocumentApiValidationError,
      );
    });

    it('delegates to adapter.rename with normalized options', () => {
      const adapter = makeAdapter();
      const input = { target: validTarget, newName: 'newBm' };
      executeBookmarksRename(adapter, input as any);
      expect(adapter.rename).toHaveBeenCalledWith(input, { changeMode: 'direct', dryRun: false });
    });
  });

  // ── Delegation tests ────────────────────────────────────────────────
  describe('executeBookmarksList', () => {
    it('delegates to adapter.list with query', () => {
      const adapter = makeAdapter();
      const query = { limit: 10 };
      executeBookmarksList(adapter, query as any);
      expect(adapter.list).toHaveBeenCalledWith(query);
    });

    it('delegates to adapter.list with a valid story filter', () => {
      const adapter = makeAdapter();
      const query = { in: validStory };
      executeBookmarksList(adapter, query);
      expect(adapter.list).toHaveBeenCalledWith(query);
    });

    it('throws INVALID_INPUT when query.in is invalid', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksList(adapter, { in: 'body' as any })).toThrow(DocumentApiValidationError);
    });

    it('delegates to adapter.list without query', () => {
      const adapter = makeAdapter();
      executeBookmarksList(adapter);
      expect(adapter.list).toHaveBeenCalledWith(undefined);
    });
  });

  describe('executeBookmarksGet', () => {
    it('delegates to adapter.get for valid target', () => {
      const adapter = makeAdapter();
      const input = { target: validTarget };
      executeBookmarksGet(adapter, input as any);
      expect(adapter.get).toHaveBeenCalledWith(input);
    });

    it('delegates to adapter.get for a story-qualified target', () => {
      const adapter = makeAdapter();
      const input = { target: { ...validTarget, story: validStory } };
      executeBookmarksGet(adapter, input);
      expect(adapter.get).toHaveBeenCalledWith(input);
    });
  });

  describe('executeBookmarksRemove', () => {
    it('throws INVALID_TARGET for invalid target', () => {
      const adapter = makeAdapter();
      expect(() => executeBookmarksRemove(adapter, { target: null as any })).toThrow(DocumentApiValidationError);
    });

    it('delegates to adapter.remove with normalized options', () => {
      const adapter = makeAdapter();
      const input = { target: validTarget };
      executeBookmarksRemove(adapter, input as any);
      expect(adapter.remove).toHaveBeenCalledWith(input, { changeMode: 'direct', dryRun: false });
    });
  });
});
