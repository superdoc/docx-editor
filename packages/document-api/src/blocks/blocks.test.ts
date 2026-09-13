import { describe, expect, it, mock } from 'bun:test';
import {
  executeBlocksDelete,
  executeBlocksDeleteRange,
  executeBlocksList,
  executeBlocksMerge,
  executeBlocksMove,
  executeBlocksSplit,
  type BlocksAdapter,
} from './blocks.js';
import type {
  BlocksDeleteInput,
  BlocksDeleteResult,
  BlocksDeleteRangeInput,
  BlocksDeleteRangeResult,
  BlocksListInput,
  BlocksListResult,
} from '../types/blocks.types.js';
import { DocumentApiValidationError } from '../errors.js';
import type { StoryLocator } from '../types/story.types.js';

type ReviewAwareBlocksListInput = BlocksListInput & {
  reviewMode?: 'final' | 'original' | 'redline';
};

function executeReviewAwareBlocksList(adapter: BlocksAdapter, input?: ReviewAwareBlocksListInput): BlocksListResult {
  return (
    executeBlocksList as unknown as (value: BlocksAdapter, request?: ReviewAwareBlocksListInput) => BlocksListResult
  )(adapter, input);
}

function makeAdapter(result?: BlocksDeleteResult): BlocksAdapter {
  const defaultResult: BlocksDeleteResult = {
    success: true,
    deleted: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' },
  };
  const defaultRangeResult: BlocksDeleteRangeResult = {
    success: true,
    deletedCount: 0,
    deletedBlocks: [],
    revision: { before: '1', after: '1' },
    dryRun: false,
  };
  return {
    delete: mock(() => result ?? defaultResult),
    list: mock(() => ({ total: 0, blocks: [], revision: '1' })),
    deleteRange: mock(() => defaultRangeResult),
  };
}

function makeListAdapter(): BlocksAdapter & { list: ReturnType<typeof mock> } {
  const defaultResult: BlocksListResult = {
    total: 0,
    blocks: [],
    revision: '1',
  };
  return {
    delete: mock(() => ({ success: true, deleted: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' } })),
    list: mock(() => defaultResult),
    deleteRange: mock(() => ({
      success: true,
      deletedCount: 0,
      deletedBlocks: [],
      revision: { before: '1', after: '1' },
      dryRun: false,
    })),
  } as BlocksAdapter & { list: ReturnType<typeof mock> };
}

function makeInput(nodeType: string, nodeId: string): BlocksDeleteInput {
  return { target: { kind: 'block', nodeType: nodeType as BlocksDeleteInput['target']['nodeType'], nodeId } };
}

function makeDeleteRangeInput(
  start: BlocksDeleteRangeInput['start'],
  end: BlocksDeleteRangeInput['end'],
): BlocksDeleteRangeInput {
  return { start, end };
}

const footerStory: StoryLocator = {
  kind: 'story',
  storyType: 'headerFooterSlot',
  section: { kind: 'section', sectionId: 's1' },
  headerFooterKind: 'footer',
  variant: 'default',
  resolution: 'explicit',
  onWrite: 'materializeIfInherited',
};

describe('executeBlocksDelete', () => {
  describe('input validation', () => {
    it('rejects null input', () => {
      expect(() => executeBlocksDelete(makeAdapter(), null as any)).toThrow(DocumentApiValidationError);
    });

    it('rejects input without target', () => {
      expect(() => executeBlocksDelete(makeAdapter(), {} as any)).toThrow(DocumentApiValidationError);
    });

    it.each([
      ['changeMode', 'bogus'],
      ['dryRun', true],
      ['totallyBogusKey', 1],
    ])('rejects unknown input field %s before mutation', (field, value) => {
      const adapter = makeAdapter();
      const input = { ...makeInput('paragraph', 'p1'), [field]: value };

      try {
        executeBlocksDelete(adapter, input as BlocksDeleteInput);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentApiValidationError);
        expect((error as DocumentApiValidationError).code).toBe('INVALID_INPUT');
        expect((error as DocumentApiValidationError).message).toContain(`Unknown field "${field}"`);
      }
      expect(adapter.delete).not.toHaveBeenCalled();
    });

    it('rejects target with wrong kind', () => {
      expect(() =>
        executeBlocksDelete(makeAdapter(), {
          target: { kind: 'text' as any, blockId: 'p1', range: { start: 0, end: 1 } },
        } as any),
      ).toThrow(DocumentApiValidationError);
    });

    it('rejects target without nodeId', () => {
      expect(() =>
        executeBlocksDelete(makeAdapter(), {
          target: { kind: 'block', nodeType: 'paragraph' },
        } as any),
      ).toThrow(DocumentApiValidationError);
    });

    it('rejects tableRow target', () => {
      try {
        executeBlocksDelete(makeAdapter(), makeInput('tableRow', 'tr1'));
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentApiValidationError);
        expect((error as DocumentApiValidationError).code).toBe('INVALID_TARGET');
        expect((error as DocumentApiValidationError).message).toContain('tableRow');
      }
    });

    it('rejects tableCell target', () => {
      try {
        executeBlocksDelete(makeAdapter(), makeInput('tableCell', 'tc1'));
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentApiValidationError);
        expect((error as DocumentApiValidationError).code).toBe('INVALID_TARGET');
      }
    });

    it('rejects unknown node type', () => {
      try {
        executeBlocksDelete(makeAdapter(), makeInput('footnote', 'fn1'));
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentApiValidationError);
        expect((error as DocumentApiValidationError).code).toBe('INVALID_TARGET');
      }
    });
  });

  describe('valid input', () => {
    it('accepts paragraph target', () => {
      const adapter = makeAdapter();
      const result = executeBlocksDelete(adapter, makeInput('paragraph', 'p1'));
      expect(result.success).toBe(true);
      expect(adapter.delete).toHaveBeenCalledWith(
        makeInput('paragraph', 'p1'),
        expect.objectContaining({ changeMode: 'direct' }),
      );
    });

    it('accepts heading target', () => {
      const adapter = makeAdapter({ success: true, deleted: { kind: 'block', nodeType: 'heading', nodeId: 'h1' } });
      const result = executeBlocksDelete(adapter, makeInput('heading', 'h1'));
      expect(result.success).toBe(true);
    });

    it('accepts listItem target', () => {
      const adapter = makeAdapter({ success: true, deleted: { kind: 'block', nodeType: 'listItem', nodeId: 'li1' } });
      const result = executeBlocksDelete(adapter, makeInput('listItem', 'li1'));
      expect(result.success).toBe(true);
    });

    it('accepts table target', () => {
      const adapter = makeAdapter({ success: true, deleted: { kind: 'block', nodeType: 'table', nodeId: 't1' } });
      const result = executeBlocksDelete(adapter, makeInput('table', 't1'));
      expect(result.success).toBe(true);
    });

    it('rejects image target (inline-only in ProseMirror schema)', () => {
      expect(() => executeBlocksDelete(makeAdapter(), makeInput('image', 'img1'))).toThrow(DocumentApiValidationError);
    });

    it('accepts sdt target', () => {
      const adapter = makeAdapter({ success: true, deleted: { kind: 'block', nodeType: 'sdt', nodeId: 'sdt1' } });
      const result = executeBlocksDelete(adapter, makeInput('sdt', 'sdt1'));
      expect(result.success).toBe(true);
    });
  });

  describe('mutation options normalization', () => {
    it('defaults changeMode to direct when omitted', () => {
      const adapter = makeAdapter();
      executeBlocksDelete(adapter, makeInput('paragraph', 'p1'));
      expect(adapter.delete).toHaveBeenCalledWith(
        makeInput('paragraph', 'p1'),
        expect.objectContaining({ changeMode: 'direct' }),
      );
    });

    it('passes through dryRun option', () => {
      const adapter = makeAdapter();
      executeBlocksDelete(adapter, makeInput('paragraph', 'p1'), { dryRun: true });
      expect(adapter.delete).toHaveBeenCalledWith(
        makeInput('paragraph', 'p1'),
        expect.objectContaining({ dryRun: true }),
      );
    });

    it('passes through changeMode option', () => {
      const adapter = makeAdapter();
      executeBlocksDelete(adapter, makeInput('paragraph', 'p1'), { changeMode: 'direct' });
      expect(adapter.delete).toHaveBeenCalledWith(
        makeInput('paragraph', 'p1'),
        expect.objectContaining({ changeMode: 'direct' }),
      );
    });
  });
});

describe('structural block capability fallbacks', () => {
  it('returns CAPABILITY_UNAVAILABLE when legacy adapters omit split/merge/move hooks', () => {
    const adapter = makeAdapter();
    const target = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' };
    const destination = { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p2' };

    expect(executeBlocksSplit(adapter, { target, offset: 1 })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(executeBlocksMerge(adapter, { first: target, second: destination })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
    expect(executeBlocksMove(adapter, { source: target, destination, placement: 'after' })).toMatchObject({
      success: false,
      failure: { code: 'CAPABILITY_UNAVAILABLE' },
    });
  });
});

describe('executeBlocksList', () => {
  const footerStory: StoryLocator = {
    kind: 'story',
    storyType: 'headerFooterSlot',
    section: { kind: 'section', sectionId: 's1' },
    headerFooterKind: 'footer',
    variant: 'default',
    resolution: 'explicit',
    onWrite: 'materializeIfInherited',
  };

  describe('normalizeBlocksListInput', () => {
    it('passes undefined through unchanged', () => {
      const adapter = makeListAdapter();
      executeBlocksList(adapter, undefined);
      expect(adapter.list).toHaveBeenCalledWith(undefined);
    });

    it('normalizes limit=0 to undefined when no other fields', () => {
      const adapter = makeListAdapter();
      executeBlocksList(adapter, { limit: 0 });
      expect(adapter.list).toHaveBeenCalledWith(undefined);
    });

    it('removes limit=0 but keeps other fields', () => {
      const adapter = makeListAdapter();
      executeBlocksList(adapter, { limit: 0, offset: 5 });
      expect(adapter.list).toHaveBeenCalledWith({ offset: 5 });
    });

    it('normalizes empty nodeTypes to undefined when no other fields', () => {
      const adapter = makeListAdapter();
      executeBlocksList(adapter, { nodeTypes: [] });
      expect(adapter.list).toHaveBeenCalledWith(undefined);
    });

    it('removes empty nodeTypes but keeps other fields', () => {
      const adapter = makeListAdapter();
      executeBlocksList(adapter, { nodeTypes: [], offset: 2 });
      expect(adapter.list).toHaveBeenCalledWith({ offset: 2 });
    });

    it('normalizes both limit=0 and empty nodeTypes to undefined', () => {
      const adapter = makeListAdapter();
      executeBlocksList(adapter, { limit: 0, nodeTypes: [] });
      expect(adapter.list).toHaveBeenCalledWith(undefined);
    });

    it('passes through valid limit and nodeTypes unchanged', () => {
      const adapter = makeListAdapter();
      const input: BlocksListInput = { limit: 5, nodeTypes: ['paragraph'] };
      executeBlocksList(adapter, input);
      expect(adapter.list).toHaveBeenCalledWith(input);
    });

    it('passes through valid limit unchanged', () => {
      const adapter = makeListAdapter();
      const input: BlocksListInput = { limit: 10 };
      executeBlocksList(adapter, input);
      expect(adapter.list).toHaveBeenCalledWith(input);
    });

    it('passes through includeText unchanged', () => {
      const adapter = makeListAdapter();
      const input: BlocksListInput = { includeText: true, offset: 1 };
      executeBlocksList(adapter, input);
      expect(adapter.list).toHaveBeenCalledWith(input);
    });

    it('passes through a story locator unchanged', () => {
      const adapter = makeListAdapter();
      const input: BlocksListInput = { in: footerStory, includeText: true };
      executeBlocksList(adapter, input);
      expect(adapter.list).toHaveBeenCalledWith(input);
    });

    it.each(['final', 'original', 'redline'] as const)('passes through reviewMode=%s unchanged', (reviewMode) => {
      const adapter = makeListAdapter();
      const input: ReviewAwareBlocksListInput = { reviewMode };
      executeReviewAwareBlocksList(adapter, input);
      expect(adapter.list).toHaveBeenCalledWith(input);
    });
  });

  describe('input validation', () => {
    it('rejects non-boolean includeText', () => {
      expect(() => executeBlocksList(makeListAdapter(), { includeText: 'yes' as any })).toThrow(
        DocumentApiValidationError,
      );
    });

    it('rejects an invalid story locator with an unknown kind', () => {
      expect(() => executeBlocksList(makeListAdapter(), { in: { kind: 'bogus' } as any })).toThrow(
        DocumentApiValidationError,
      );
    });

    it('rejects invalid story locators with a malformed shape', () => {
      expect(() => executeBlocksList(makeListAdapter(), { in: { storyType: 'body' } as any })).toThrow(
        DocumentApiValidationError,
      );
    });

    it('rejects an invalid reviewMode before calling the adapter', () => {
      const adapter = makeListAdapter();
      expect(() => executeReviewAwareBlocksList(adapter, { reviewMode: 'markup' as 'final' })).toThrow(
        DocumentApiValidationError,
      );
      expect(adapter.list).not.toHaveBeenCalled();
    });
  });
});

describe('story-aware blocks.delete validation', () => {
  it('accepts a story-scoped block target', () => {
    const adapter = makeAdapter();
    executeBlocksDelete(adapter, {
      target: {
        kind: 'block',
        nodeType: 'paragraph',
        nodeId: 'p1',
        story: footerStory,
      },
    });
    expect(adapter.delete).toHaveBeenCalled();
  });

  it('rejects invalid story-scoped block targets', () => {
    expect(() =>
      executeBlocksDelete(makeAdapter(), {
        target: {
          kind: 'block',
          nodeType: 'paragraph',
          nodeId: 'p1',
          story: { storyType: 'body' } as any,
        },
      }),
    ).toThrow(DocumentApiValidationError);
  });
});

describe('executeBlocksDeleteRange', () => {
  it('passes through matching story-scoped endpoints', () => {
    const adapter = makeAdapter();
    const locator = { kind: 'story', storyType: 'footnote', noteId: 'fn1' } as const;
    const input = makeDeleteRangeInput(
      {
        kind: 'block',
        nodeType: 'paragraph',
        nodeId: 'p1',
        story: locator,
      },
      {
        kind: 'block',
        nodeType: 'paragraph',
        nodeId: 'p2',
        story: locator,
      },
    );

    executeBlocksDeleteRange(adapter, input, { dryRun: true });

    expect(adapter.deleteRange).toHaveBeenCalledWith(input, expect.objectContaining({ dryRun: true }));
  });

  it('rejects invalid story locators on endpoints', () => {
    expect(() =>
      executeBlocksDeleteRange(
        makeAdapter(),
        makeDeleteRangeInput(
          {
            kind: 'block',
            nodeType: 'paragraph',
            nodeId: 'p1',
            story: { storyType: 'body' } as any,
          },
          {
            kind: 'block',
            nodeType: 'paragraph',
            nodeId: 'p2',
          },
        ),
      ),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects body/default vs non-body story mismatches', () => {
    expect(() =>
      executeBlocksDeleteRange(
        makeAdapter(),
        makeDeleteRangeInput(
          {
            kind: 'block',
            nodeType: 'paragraph',
            nodeId: 'p1',
          },
          {
            kind: 'block',
            nodeType: 'paragraph',
            nodeId: 'p2',
            story: { kind: 'story', storyType: 'footnote', noteId: 'fn1' },
          },
        ),
      ),
    ).toThrow(DocumentApiValidationError);
  });

  it('rejects cross-story endpoint mismatches', () => {
    try {
      executeBlocksDeleteRange(
        makeAdapter(),
        makeDeleteRangeInput(
          {
            kind: 'block',
            nodeType: 'paragraph',
            nodeId: 'p1',
            story: { kind: 'story', storyType: 'footnote', noteId: 'fn1' },
          },
          {
            kind: 'block',
            nodeType: 'paragraph',
            nodeId: 'p2',
            story: { kind: 'story', storyType: 'endnote', noteId: 'en1' },
          },
        ),
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentApiValidationError);
      expect((error as DocumentApiValidationError).code).toBe('STORY_MISMATCH');
    }
  });
});

describe('blocks.list execution fact filters', () => {
  const blocks: BlocksListResult['blocks'] = Array.from({ length: 503 }, (_, ordinal) => ({
    nodeId: `p${ordinal}`,
    nodeType: 'paragraph',
    ordinal,
    text: ordinal === 3 ? 'needle needle first' : ordinal === 501 ? 'NEEDLE second' : 'unrelated',
  }));
  function pagedAdapter(): BlocksAdapter {
    return {
      ...makeAdapter(),
      list: (input) => ({
        blocks: blocks.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? blocks.length)),
        total: blocks.length,
        revision: '7',
      }),
    };
  }
  it('filters before pagination, counts matching blocks, and omits unrequested text', () => {
    const page = executeBlocksList(pagedAdapter(), { textSearch: { terms: ['needle'] }, offset: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0]).toMatchObject({ nodeId: 'p501', ordinal: 501 });
    expect(page.blocks[0]).not.toHaveProperty('text');
    expect(executeBlocksList(pagedAdapter(), { nodeIds: ['p501'], includeText: true }).blocks[0].text).toBe(
      'NEEDLE second',
    );
    expect(executeBlocksList(pagedAdapter(), { nodeIds: [] }).total).toBe(0);
  });
  it('rejects a changed revision or incomplete scan instead of returning partial matches', () => {
    for (const fault of ['revision', 'empty']) {
      const adapter = pagedAdapter();
      const original = adapter.list;
      adapter.list = (input) => {
        const page = original(input);
        return input?.offset ? { ...page, ...(fault === 'revision' ? { revision: '8' } : { blocks: [] }) } : page;
      };
      expect(() => executeBlocksList(adapter, { textSearch: { terms: ['needle'] }, limit: 1 })).toThrow(
        DocumentApiValidationError,
      );
    }
  });
});
