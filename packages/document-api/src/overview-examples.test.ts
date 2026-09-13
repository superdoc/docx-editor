import { describe, expect, it, mock } from 'bun:test';
import { createDocumentApi, type DocumentApiAdapters } from './index.js';
import type { DocumentApiCapabilities } from './capabilities/capabilities.js';
import type { SelectionTarget } from './types/index.js';

// ---------------------------------------------------------------------------
// Shared mock-adapter factories (mirrors index.test.ts patterns)
// ---------------------------------------------------------------------------

const SELECTION_TARGET: SelectionTarget = {
  kind: 'selection',
  start: { kind: 'text', blockId: 'p1', offset: 0 },
  end: { kind: 'text', blockId: 'p1', offset: 3 },
};

function makeTextMutationReceipt() {
  return {
    success: true as const,
    resolution: {
      target: { kind: 'text' as const, blockId: 'p1', range: { start: 0, end: 3 } },
      range: { from: 1, to: 4 },
      text: 'foo',
    },
    inserted: [{ kind: 'entity' as const, entityType: 'trackedChange' as const, entityId: 'tc-1' }],
  };
}

function makeFindAdapter() {
  return {
    find: mock(() => ({
      evaluatedRevision: '',
      total: 1,
      items: [
        {
          id: 'p1',
          handle: { ref: 'p1', refStability: 'ephemeral' as const, targetKind: 'text' as const },
          matchKind: 'text' as const,
          address: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' },
          target: SELECTION_TARGET,
          snippet: 'foo',
          highlightRange: { start: 0, end: 3 },
          blocks: [
            {
              blockId: 'p1',
              nodeType: 'paragraph',
              range: { start: 0, end: 3 },
              text: 'foo',
              ref: 'ref:block-1',
              runs: [
                {
                  range: { start: 0, end: 3 },
                  text: 'foo',
                  styles: {
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                  },
                  ref: 'ref:run-1',
                },
              ],
            },
          ],
          context: { target: SELECTION_TARGET, textRanges: [SELECTION_TARGET] },
        },
      ],
      page: { limit: 1, offset: 0, returned: 1 },
    })),
  };
}

function makeGetNodeAdapter() {
  return {
    getNode: mock(() => ({ nodeType: 'paragraph', kind: 'block', properties: {} })),
    getNodeById: mock(() => ({ nodeType: 'paragraph', kind: 'block', properties: {} })),
  };
}

function makeGetTextAdapter() {
  return { getText: mock(() => 'hello') };
}

function makeInfoAdapter() {
  return {
    info: mock(() => ({
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
      capabilities: { canFind: true, canGetNode: true, canComment: true, canReplace: true },
      revision: '0',
    })),
  };
}

function makeSDMutationReceipt() {
  return {
    success: true as const,
    resolution: {
      target: {
        kind: 'text' as const,
        blockId: 'p1',
        range: { start: 0, end: 3 },
      },
    },
  };
}

function makeWriteAdapter() {
  return {
    write: mock(() => makeTextMutationReceipt()),
    insertStructured: mock(() => makeSDMutationReceipt()),
    replaceStructured: mock(() => makeSDMutationReceipt()),
  };
}

function makeSelectionMutationAdapter() {
  return {
    execute: mock(() => makeTextMutationReceipt()),
  };
}

function makeParagraphsAdapter() {
  const ok = () => ({
    success: true as const,
    target: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' },
    resolution: { target: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' } },
  });

  return {
    setStyle: mock(ok),
    clearStyle: mock(ok),
    resetDirectFormatting: mock(ok),
    setAlignment: mock(ok),
    clearAlignment: mock(ok),
    setIndentation: mock(ok),
    clearIndentation: mock(ok),
    setSpacing: mock(ok),
    clearSpacing: mock(ok),
    setKeepOptions: mock(ok),
    setOutlineLevel: mock(ok),
    setFlowOptions: mock(ok),
    setTabStop: mock(ok),
    clearTabStop: mock(ok),
    clearAllTabStops: mock(ok),
    setBorder: mock(ok),
    clearBorder: mock(ok),
    setShading: mock(ok),
    clearShading: mock(ok),
  };
}

function makeCommentsAdapter() {
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
      text: 'Review this section.',
    })),
    list: mock(() => ({
      evaluatedRevision: 'r1',
      total: 1,
      items: [
        {
          id: 'c1',
          handle: { ref: 'comment:c1', refStability: 'stable' as const, targetKind: 'comment' as const },
          address: { kind: 'entity' as const, entityType: 'comment' as const, entityId: 'c1' },
          commentId: 'c1',
          status: 'open' as const,
          text: 'Review this section.',
        },
      ],
      page: { limit: 1, offset: 0, returned: 1 },
    })),
  };
}

function makeTrackChangesAdapter() {
  return {
    list: mock(() => ({ evaluatedRevision: 'r1', total: 0, items: [], page: { limit: 0, offset: 0, returned: 0 } })),
    get: mock((input: { id: string }) => ({
      address: { kind: 'entity' as const, entityType: 'trackedChange' as const, entityId: input.id },
      id: input.id,
      type: 'insert' as const,
    })),
    accept: mock(() => ({ success: true as const })),
    reject: mock(() => ({ success: true as const })),
    acceptAll: mock(() => ({ success: true as const })),
    rejectAll: mock(() => ({ success: true as const })),
  };
}

function makeCreateAdapter() {
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
  };
}

function makeListsAdapter() {
  const mutateResult = () => ({
    success: true as const,
    item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
  });

  return {
    list: mock(() => ({
      evaluatedRevision: 'r1',
      total: 1,
      items: [
        {
          id: 'li-1',
          handle: { ref: 'li-1', refStability: 'stable' as const, targetKind: 'list' as const },
          address: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
          kind: 'ordered' as const,
          level: 0,
          text: 'List item',
        },
      ],
      page: { limit: 1, offset: 0, returned: 1 },
    })),
    get: mock(() => ({
      address: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-1' },
      listId: 'list-1',
      kind: 'ordered' as const,
      level: 0,
      text: 'List item',
    })),
    insert: mock(() => ({
      success: true as const,
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-2' },
      insertionPoint: { kind: 'text' as const, blockId: 'li-2', range: { start: 0, end: 0 } },
    })),
    indent: mock(mutateResult),
    outdent: mock(mutateResult),
    create: mock(() => ({
      success: true as const,
      listId: 'list-new',
      item: { kind: 'block' as const, nodeType: 'listItem' as const, nodeId: 'li-new' },
    })),
    attach: mock(mutateResult),
    detach: mock(() => ({
      success: true as const,
      paragraph: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' },
    })),
    join: mock(() => ({ success: true as const, listId: 'list-1' })),
    canJoin: mock(() => ({ canJoin: true })),
    separate: mock(() => ({ success: true as const, listId: 'list-new', numId: 2 })),
    setLevel: mock(mutateResult),
    setValue: mock(mutateResult),
    continuePrevious: mock(mutateResult),
    canContinuePrevious: mock(() => ({ canContinue: true })),
    setLevelRestart: mock(mutateResult),
    convertToText: mock(() => ({
      success: true as const,
      paragraph: { kind: 'block' as const, nodeType: 'paragraph' as const, nodeId: 'p1' },
    })),
    applyTemplate: mock(mutateResult),
    applyPreset: mock(mutateResult),
    captureTemplate: mock(() => ({
      success: true as const,
      template: { version: 1, levels: [] },
    })),
    setLevelNumbering: mock(mutateResult),
    setLevelBullet: mock(mutateResult),
    setLevelPictureBullet: mock(mutateResult),
    setLevelAlignment: mock(mutateResult),
    setLevelIndents: mock(mutateResult),
    setLevelTrailingCharacter: mock(mutateResult),
    setLevelMarkerFont: mock(mutateResult),
    clearLevelOverrides: mock(mutateResult),
  };
}

function makeCapabilitiesAdapter(): { get: ReturnType<typeof mock> } {
  const caps: DocumentApiCapabilities = {
    global: {
      trackChanges: { enabled: true },
      comments: { enabled: true },
      lists: { enabled: true },
      dryRun: { enabled: true },
    },
    format: { supportedInlineProperties: {} as DocumentApiCapabilities['format']['supportedInlineProperties'] },
    operations: Object.fromEntries(
      [
        'find',
        'getNode',
        'getNodeById',
        'getText',
        'info',
        'insert',
        'replace',
        'delete',
        'format.apply',
        'create.paragraph',
        'create.heading',
        'lists.list',
        'lists.get',
        'lists.insert',
        'lists.create',
        'lists.indent',
        'lists.outdent',
        'lists.detach',
        'lists.attach',
        'comments.create',
        'comments.patch',
        'comments.delete',
        'comments.get',
        'comments.list',
        'trackChanges.list',
        'trackChanges.get',
        'trackChanges.decide',
        'capabilities.get',
        'query.match',
        'mutations.preview',
        'mutations.apply',
      ].map((id) => [id, { available: true, tracked: true, dryRun: true }]),
    ) as DocumentApiCapabilities['operations'],
    planEngine: {
      supportedStepOps: [],
      supportedNonUniformStrategies: [],
      supportedSetMarks: [],
      regex: { maxPatternLength: 1024, maxExecutionMs: 100 },
    },
  };
  return { get: mock(() => caps) };
}

function makeApi(overrides: Partial<DocumentApiAdapters> = {}) {
  return createDocumentApi({
    find: makeFindAdapter(),
    getNode: makeGetNodeAdapter(),
    getText: makeGetTextAdapter(),
    info: makeInfoAdapter(),
    capabilities: makeCapabilitiesAdapter(),
    comments: makeCommentsAdapter(),
    write: makeWriteAdapter(),
    selectionMutation: makeSelectionMutationAdapter(),
    paragraphs: makeParagraphsAdapter(),
    trackChanges: makeTrackChangesAdapter(),
    create: makeCreateAdapter(),
    lists: makeListsAdapter(),
    query: {
      match: mock(() => ({
        evaluatedRevision: 'r1',
        total: 1,
        items: [
          {
            id: 'm:1',
            handle: {
              ref: 'ref:match-1',
              refStability: 'stable' as const,
              targetKind: 'text' as const,
            },
            matchKind: 'text' as const,
            address: {
              kind: 'block' as const,
              nodeType: 'paragraph' as const,
              nodeId: 'p1',
            },
            target: SELECTION_TARGET,
            snippet: 'foo',
            highlightRange: { start: 0, end: 3 },
            blocks: [
              {
                blockId: 'p1',
                nodeType: 'paragraph',
                range: { start: 0, end: 3 },
                text: 'foo',
                ref: 'ref:block-1',
                runs: [
                  {
                    range: { start: 0, end: 3 },
                    text: 'foo',
                    styles: {
                      bold: false,
                      italic: false,
                      underline: false,
                      strike: false,
                    },
                    ref: 'ref:run-1',
                  },
                ],
              },
            ],
          },
        ],
        page: { limit: 1, offset: 0, returned: 1 },
      })),
    },
    mutations: {
      preview: mock(async () => ({ evaluatedRevision: 'r1', steps: [], valid: true })),
      apply: mock(async () => ({
        success: true as const,
        revision: { before: 'r1', after: 'r2' },
        steps: [],
        trackedChanges: [],
        timing: { totalMs: 0 },
      })),
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// overview.mdx — "Common workflows"
// ---------------------------------------------------------------------------

describe('overview.mdx examples', () => {
  describe('Plan with query.match, then apply with mutations', () => {
    // Mirrors the exact code block from overview.mdx § "Plan with query.match, then apply with mutations"
    it('matches, previews, and applies a deterministic plan', async () => {
      const doc = makeApi();

      const match = doc.query.match({
        select: { type: 'text', pattern: 'foo' },
        require: 'first',
      });

      const ref = match.items?.[0]?.handle?.ref;
      if (!ref) return;

      const plan = {
        expectedRevision: match.evaluatedRevision,
        atomic: true as const,
        changeMode: 'direct' as const,
        steps: [
          {
            id: 'replace-foo',
            op: 'text.rewrite',
            where: { by: 'ref' as const, ref },
            args: { replacement: { text: 'bar' } },
          },
        ],
      };

      const preview = await doc.mutations.preview(plan);
      if (preview.valid) {
        await doc.mutations.apply(plan);
      }

      expect(ref).toBeDefined();
      expect(preview.valid).toBe(true);
    });
  });

  describe('Run multiple edits as one plan', () => {
    // Mirrors the exact code block from overview.mdx § "Run multiple edits as one plan"
    it('runs multiple steps through preview + apply', async () => {
      const doc = makeApi();

      const match = doc.query.match({
        select: { type: 'text', pattern: 'payment terms' },
        require: 'first',
      });

      const ref = match.items?.[0]?.handle?.ref;
      if (!ref) return;

      const plan = {
        expectedRevision: match.evaluatedRevision,
        atomic: true as const,
        changeMode: 'direct' as const,
        steps: [
          {
            id: 'rewrite-terms',
            op: 'text.rewrite',
            where: { by: 'ref' as const, ref },
            args: {
              replacement: { text: 'updated payment terms' },
            },
          },
          {
            id: 'style-terms',
            op: 'format.apply',
            where: { by: 'ref' as const, ref },
            args: { inline: { bold: true } },
          },
        ],
      };

      const preview = await doc.mutations.preview(plan);
      if (preview.valid) {
        await doc.mutations.apply(plan);
      }

      expect(ref).toBeDefined();
      expect(preview.valid).toBe(true);
    });
  });

  describe('Quick search and single edit', () => {
    // Mirrors the exact code block from overview.mdx § "Quick search and single edit"
    it('finds and replaces with direct operations', () => {
      const doc = makeApi();

      const result = doc.find({
        select: { type: 'text', pattern: 'foo' },
        require: 'first',
      });

      const target = result.items?.[0]?.context?.textRanges?.[0];
      if (target) {
        doc.replace({ target, text: 'bar' });
      }

      expect(target).toBeDefined();
      expect(target?.kind).toBe('selection');
    });
  });

  describe('Tracked-mode insert', () => {
    // Mirrors the exact code block from overview.mdx § "Tracked-mode insert"
    it('insert text with changeMode tracked', () => {
      const doc = makeApi();

      const receipt = doc.insert({ value: 'new content' }, { changeMode: 'tracked' });

      expect(receipt.resolution).toBeDefined();
      expect(receipt.resolution.target).toBeDefined();
    });
  });

  describe('Check capabilities before acting', () => {
    // Mirrors the exact code block from overview.mdx § "Check capabilities before acting"
    it('branch on capabilities', () => {
      const doc = makeApi();

      const caps = doc.capabilities();
      const target = SELECTION_TARGET;

      if (caps.operations['format.apply'].available) {
        doc.format.apply({ target, inline: { bold: true } });
      }

      if (caps.global.trackChanges.enabled) {
        doc.insert({ value: 'tracked' }, { changeMode: 'tracked' });
      }

      // Both branches should execute with our fully-capable mock
      expect(caps.operations['format.apply'].available).toBe(true);
      expect(caps.global.trackChanges.enabled).toBe(true);
    });
  });

  describe('Dry-run preview', () => {
    // Mirrors the exact code block from overview.mdx § "Dry-run preview"
    it('insert with dryRun true', () => {
      const doc = makeApi();
      const target = {
        kind: 'selection' as const,
        start: { kind: 'text' as const, blockId: 'p1', offset: 0 },
        end: { kind: 'text' as const, blockId: 'p1', offset: 0 },
      };

      const preview = doc.insert({ target, value: 'hello' }, { dryRun: true });
      // preview.success tells you whether the insert would succeed
      // preview.resolution shows the resolved target (TextAddress)

      expect(preview).toHaveProperty('success');
      expect(preview).toHaveProperty('resolution');
      expect(preview.resolution).toHaveProperty('target');
    });
  });
});

// ---------------------------------------------------------------------------
// common-workflows.mdx — "Find text and insert at position"
// ---------------------------------------------------------------------------

describe('common-workflows.mdx: Find text and insert at position', () => {
  it('query.match → create.paragraph with at: after', () => {
    const doc = makeApi();

    // Step 1: Find the heading by text content
    const match = doc.query.match({
      select: { type: 'text', pattern: 'Materials and methods' },
      require: 'first',
    });

    const address = match.items?.[0]?.address;
    if (!address) return;

    // Step 2: Insert a paragraph after the heading
    const result = doc.create.paragraph({
      at: { kind: 'after', target: address },
      text: 'New section content goes here.',
    });

    expect(address.kind).toBe('block');
    expect(result.success).toBe(true);
  });

  it('query.match → create.paragraph with tracked changes', () => {
    const doc = makeApi();

    const match = doc.query.match({
      select: { type: 'text', pattern: 'Materials and methods' },
      require: 'first',
    });

    const address = match.items?.[0]?.address;
    if (!address) return;

    const result = doc.create.paragraph(
      { at: { kind: 'after', target: address }, text: 'Suggested addition.' },
      { changeMode: 'tracked' },
    );

    expect(result.success).toBe(true);
  });

  it('query.match accepts flat TextSelector shorthand', () => {
    const doc = makeApi();

    // Shorthand: pass TextSelector directly instead of { select: ... }
    const match = doc.query.match({ type: 'text', pattern: 'Materials and methods' });

    expect(match.items).toBeDefined();
  });

  it('query.match accepts flat NodeSelector shorthand', () => {
    const doc = makeApi();

    // Shorthand: pass NodeSelector directly instead of { select: ... }
    const match = doc.query.match({ type: 'node', nodeType: 'paragraph' });

    expect(match.items).toBeDefined();
  });

  it('query.match promotes flat query options out of shorthand selectors', () => {
    const queryMatch = mock(() => ({
      evaluatedRevision: 'r1',
      total: 0,
      items: [],
      page: { limit: 0, offset: 0, returned: 0 },
      meta: { effectiveResolved: true },
    }));
    const doc = makeApi({ query: { match: queryMatch } as DocumentApiAdapters['query'] });

    doc.query.match({
      type: 'text',
      pattern: 'Materials and methods',
      wholeWord: true,
      require: 'first',
      limit: 1,
    } as any);

    expect(queryMatch).toHaveBeenCalledWith({
      select: { type: 'text', pattern: 'Materials and methods', wholeWord: true },
      require: 'first',
      limit: 1,
    });
  });

  it('query.match promotes query options out of type-less node shorthand', () => {
    const queryMatch = mock(() => ({
      evaluatedRevision: 'r1',
      total: 0,
      items: [],
      page: { limit: 0, offset: 0, returned: 0 },
      meta: { effectiveResolved: true },
    }));
    const doc = makeApi({ query: { match: queryMatch } as DocumentApiAdapters['query'] });

    doc.query.match({ nodeType: 'paragraph', require: 'first', limit: 1 } as any);

    expect(queryMatch).toHaveBeenCalledWith({
      select: { type: 'node', nodeType: 'paragraph' },
      require: 'first',
      limit: 1,
    });
  });
});

describe('Document API workflow examples', () => {
  describe('Workflow: Find + Mutate', () => {
    it('find then replace', () => {
      const doc = makeApi();

      const match = doc.query.match({
        select: { type: 'text', pattern: 'foo' },
        require: 'first',
      });

      const target = match.items?.[0]?.target;
      if (target) {
        doc.replace({ target, text: 'bar' });
      }

      expect(target).toBeDefined();
    });
  });

  describe('Workflow: Tracked-Mode Insert', () => {
    it('insert in tracked mode and access receipt properties', () => {
      const doc = makeApi();

      const receipt = doc.insert({ value: 'new content' }, { changeMode: 'tracked' });
      // receipt.resolution.target contains the resolved insertion point (TextAddress)
      // receipt.success tells you whether the tracked insert applied

      expect(receipt.resolution).toBeDefined();
      expect(receipt.resolution!.target).toBeDefined();
      expect(receipt.success).toBe(true);
    });
  });

  describe('Workflow: Comment Thread Lifecycle', () => {
    it('create comment, reply, then resolve', () => {
      const doc = makeApi();

      // Simulate having a comment target
      const target = { kind: 'text' as const, blockId: 'p1', range: { start: 0, end: 3 } };
      const createReceipt = doc.comments.create({ target, text: 'Review this section.' });
      // Use the comment ID from the receipt to reply
      const comments = doc.comments.list();
      const thread = comments.items[0];
      doc.comments.create({ parentCommentId: thread.id, text: 'Looks good.' });
      doc.comments.patch({ commentId: thread.id, status: 'resolved' });

      expect(createReceipt.success).toBe(true);
      expect(thread.id).toBeDefined();
    });
  });

  describe('Workflow: List Manipulation', () => {
    it('insert list item, set type, indent', () => {
      const doc = makeApi();

      const lists = doc.lists.list();
      const firstItem = lists.items[0].address;
      const insertResult = doc.lists.insert({ target: firstItem, position: 'after', text: 'New item' });
      if (insertResult.success) {
        doc.lists.indent({ target: insertResult.item });
      }

      expect(insertResult.success).toBe(true);
      if (insertResult.success) {
        expect(insertResult.item).toBeDefined();
      }
    });
  });

  describe('Workflow: Capabilities-Aware Branching', () => {
    it('branch on per-operation capabilities', () => {
      const doc = makeApi();
      const target = SELECTION_TARGET;

      const caps = doc.capabilities();
      if (caps.operations['format.apply'].available) {
        doc.format.apply({ target, inline: { bold: true } });
      }
      if (caps.global.trackChanges.enabled) {
        doc.insert({ value: 'tracked' }, { changeMode: 'tracked' });
      }
      if (caps.operations['create.heading'].dryRun) {
        const preview = doc.create.heading({ level: 2, text: 'Preview' }, { dryRun: true });
        expect(preview).toBeDefined();
      }

      expect(caps.operations['format.apply'].available).toBe(true);
      expect(caps.global.trackChanges.enabled).toBe(true);
      expect(caps.operations['create.heading'].dryRun).toBe(true);
    });
  });
});
