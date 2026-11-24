import { describe, expect, it } from 'vite-plus/test';
import { buildFloatingCommentInstances } from './floating-comment-instances.js';

describe('buildFloatingCommentInstances', () => {
  it('skips missing rect entries when grouping repeated header/footer pages', () => {
    const comment = {
      commentId: 'tracked-change-holes',
      trackedChange: true,
      trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
    };
    const positionEntry = {
      pageIndex: 1,
      rects: [
        null,
        { pageIndex: 0, top: 20, left: 12, right: 50, bottom: 40 },
        undefined,
        { pageIndex: 1, top: 120, left: 8, right: 32, bottom: 136 },
      ],
    };

    const instances = buildFloatingCommentInstances({
      comment,
      positionKey: 'tc::hf:part:rId-footer::tracked-change-holes',
      positionEntry,
      fallbackId: 'fallback-thread-id',
    });

    expect(instances.map(({ pageIndex, isPrimary }) => ({ pageIndex, isPrimary }))).toEqual([
      { pageIndex: 0, isPrimary: false },
      { pageIndex: 1, isPrimary: true },
    ]);
  });

  it('treats a string trackedChangeStory as a single instance, not a repeated header/footer change', () => {
    const comment = {
      commentId: 'tracked-change-string-story',
      trackedChange: true,
      trackedChangeStory: 'headerFooterPart',
    };

    const instances = buildFloatingCommentInstances({
      comment,
      positionKey: 'tc::string-story',
      positionEntry: {
        pageIndex: 1,
        rects: [
          { pageIndex: 0, top: 20, left: 12, right: 50, bottom: 40 },
          { pageIndex: 1, top: 120, left: 8, right: 32, bottom: 136 },
        ],
      },
      fallbackId: 'fallback-thread-id',
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ id: 'tc::string-story', isPrimary: true });
  });

  it.each([
    { label: 'a missing position entry', positionEntry: undefined },
    { label: 'a missing rect collection', positionEntry: {} },
    { label: 'a malformed rect collection', positionEntry: { rects: { pageIndex: 0 } } },
  ])('treats $label as optional geometry for a tracked header/footer row', ({ positionEntry }) => {
    const comment = {
      commentId: 'tracked-change-header-geometry-pending',
      trackedChange: true,
      trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' },
    };

    expect(
      buildFloatingCommentInstances({
        comment,
        positionKey: 'tc::hf:part:rId-header::tracked-change-header-geometry-pending',
        positionEntry,
        fallbackId: comment.commentId,
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'tc::hf:part:rId-header::tracked-change-header-geometry-pending',
        threadId: comment.commentId,
        positionEntry: positionEntry ?? null,
        pageIndex: null,
        isPrimary: true,
      }),
    ]);
  });

  it('hydrates repeated-page geometry onto the same primary tracked-change row', () => {
    const canonicalId = 'tc|move|1%7C101';
    const rowId = `${canonicalId}::move-to`;
    const positionKey = `tc::hf:part:rId-footer::${canonicalId}`;
    const comment = {
      commentId: rowId,
      trackedChange: true,
      trackedChangeCanonicalId: canonicalId,
      trackedChangeSubtype: 'move-to',
      trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
    };
    const [geometryFreeInstance] = buildFloatingCommentInstances({
      comment,
      positionKey,
      positionEntry: { rects: undefined },
      fallbackId: rowId,
    });

    const hydratedInstances = buildFloatingCommentInstances({
      comment,
      positionKey,
      positionEntry: {
        pageIndex: 1,
        rects: [
          { pageIndex: 0, top: 20, left: 12, right: 50, bottom: 40 },
          { pageIndex: 1, top: 120, left: 8, right: 72, bottom: 142 },
        ],
      },
      fallbackId: rowId,
    });

    expect(hydratedInstances).toHaveLength(2);
    expect(hydratedInstances.filter((instance) => instance.isPrimary)).toEqual([
      expect.objectContaining({
        id: geometryFreeInstance.id,
        threadId: geometryFreeInstance.threadId,
        pageIndex: 1,
      }),
    ]);
    expect(new Set(hydratedInstances.map((instance) => instance.id)).size).toBe(2);
    expect(new Set(hydratedInstances.map((instance) => instance.threadId))).toEqual(new Set([rowId]));
  });

  it('namespaces repeated pages by row when move sides share a canonical anchor', () => {
    const canonicalId = 'tc|move|1%7C101';
    const positionKey = `tc::hf:part:rId-footer::${canonicalId}`;
    const positionEntry = {
      pageIndex: 1,
      rects: [
        { pageIndex: 0, top: 20, left: 12, right: 50, bottom: 40 },
        { pageIndex: 1, top: 120, left: 8, right: 72, bottom: 142 },
      ],
    };
    const buildMoveSideInstances = (subtype) => {
      const rowId = `${canonicalId}::${subtype}`;
      return buildFloatingCommentInstances({
        comment: {
          commentId: rowId,
          trackedChange: true,
          trackedChangeCanonicalId: canonicalId,
          trackedChangeSubtype: subtype,
          trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
        },
        positionKey,
        positionEntry,
        fallbackId: rowId,
      });
    };

    const moveFromInstances = buildMoveSideInstances('move-from');
    const moveToInstances = buildMoveSideInstances('move-to');

    expect(moveFromInstances.map((instance) => instance.id)).toEqual([
      `${canonicalId}::move-from::page:0`,
      `${canonicalId}::move-from`,
    ]);
    expect(moveToInstances.map((instance) => instance.id)).toEqual([
      `${canonicalId}::move-to::page:0`,
      `${canonicalId}::move-to`,
    ]);
    expect(new Set([...moveFromInstances, ...moveToInstances].map((instance) => instance.id)).size).toBe(4);
  });

  it.each([
    {
      label: 'body tracked change',
      comment: {
        commentId: 'tracked-change-body-without-geometry',
        trackedChange: true,
        trackedChangeStory: { kind: 'story', storyType: 'body' },
      },
    },
    {
      label: 'non-tracked header/footer comment',
      comment: {
        commentId: 'header-footer-comment-without-geometry',
        trackedChange: false,
        trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-header' },
      },
    },
  ])('retains a geometry-free $label control as one primary row', ({ comment }) => {
    const [instance] = buildFloatingCommentInstances({
      comment,
      positionKey: `position::${comment.commentId}`,
      positionEntry: { rects: undefined },
      fallbackId: comment.commentId,
    });

    expect(instance).toMatchObject({
      id: `position::${comment.commentId}`,
      threadId: comment.commentId,
      pageIndex: null,
      isPrimary: true,
    });
  });

  it('keeps the logical primary when fewer than two repeated pages have usable bounds', () => {
    const comment = {
      commentId: 'tracked-change-partial-repeat',
      trackedChange: true,
      trackedChangeStory: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' },
    };

    expect(
      buildFloatingCommentInstances({
        comment,
        positionKey: 'tc::hf:part:rId-footer::tracked-change-partial-repeat',
        positionEntry: {
          pageIndex: 1,
          rects: [
            { pageIndex: 0, top: 20, left: null, right: 60, bottom: 40 },
            { pageIndex: 1, top: 120, left: 16, right: 80, bottom: 146 },
          ],
          bounds: { top: 120, left: 16, right: 80, bottom: 146, width: 64, height: 26 },
        },
        fallbackId: 'fallback-thread-id',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'tc::hf:part:rId-footer::tracked-change-partial-repeat',
        threadId: comment.commentId,
        pageIndex: 1,
        isPrimary: true,
      }),
    ]);
  });

  it('derives pageIndex from selection.page - 1 for PDF comments without a position entry', () => {
    const comment = { commentId: 'pdf-1', selection: { source: 'pdf', page: 2 } };
    const [instance] = buildFloatingCommentInstances({
      comment,
      positionKey: null,
      positionEntry: null,
      fallbackId: 'pdf-1',
    });
    expect(instance).toMatchObject({ id: 'pdf-1', pageIndex: 1, positionEntry: null, isPrimary: true });
  });

  it('prefers editor geometry pageIndex over selection.page when both are present', () => {
    const comment = { commentId: 'pdf-2', selection: { source: 'pdf', page: 5 } };
    const [instance] = buildFloatingCommentInstances({
      comment,
      positionKey: 'comment-position-2',
      positionEntry: { pageIndex: 0, bounds: { top: 12 } },
      fallbackId: 'pdf-2',
    });
    expect(instance.pageIndex).toBe(0);
  });

  it('leaves pageIndex null when neither geometry nor selection.page is finite', () => {
    const comment = { commentId: 'pdf-3', selection: { source: 'pdf' } };
    const [instance] = buildFloatingCommentInstances({
      comment,
      positionKey: null,
      positionEntry: null,
      fallbackId: 'pdf-3',
    });
    expect(instance.pageIndex).toBeNull();
  });

  it('leaves pageIndex null when PDF selection.page is not a valid one-based page number', () => {
    for (const page of [0, -1, 1.5, '']) {
      const [instance] = buildFloatingCommentInstances({
        comment: { commentId: `pdf-page-${page}`, selection: { source: 'pdf', page } },
        positionKey: null,
        positionEntry: null,
        fallbackId: `pdf-page-${page}`,
      });
      expect(instance.pageIndex).toBeNull();
    }
  });

  it('does not duplicate threads that are not repeated header/footer tracked changes', () => {
    expect(
      buildFloatingCommentInstances({
        comment: {
          commentId: 'tracked-change-body',
          trackedChange: true,
          trackedChangeStory: { kind: 'story', storyType: 'body' },
        },
        positionKey: 'tc::body::tracked-change-body',
        positionEntry: {
          pageIndex: 0,
          rects: [
            { pageIndex: 0, top: 20, left: 12, right: 50, bottom: 40 },
            { pageIndex: 1, top: 120, left: 12, right: 50, bottom: 140 },
          ],
          bounds: { top: 20, left: 12, right: 50, bottom: 40, width: 38, height: 20 },
        },
        fallbackId: 'fallback-thread-id',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'tc::body::tracked-change-body',
        pageIndex: 0,
        isPrimary: true,
      }),
    ]);
  });

  it('uses a row-specific instance id when a synthetic tracked-change side shares a canonical anchor', () => {
    const [instance] = buildFloatingCommentInstances({
      comment: {
        commentId: 'tc|move|1%7C101::move-to',
        trackedChange: true,
        trackedChangeCanonicalId: 'tc|move|1%7C101',
      },
      positionKey: 'tc::body::tc|move|1%7C101',
      positionEntry: {
        pageIndex: 0,
        bounds: { top: 80, left: 12, right: 64, bottom: 100, width: 52, height: 20 },
      },
      fallbackId: 'tc|move|1%7C101::move-to',
    });

    expect(instance).toMatchObject({
      id: 'tc|move|1%7C101::move-to',
      threadId: 'tc|move|1%7C101::move-to',
      positionKey: 'tc::body::tc|move|1%7C101',
      pageIndex: 0,
      isPrimary: true,
    });
  });

  it('keeps canonical tracked-change rows unique when they share a story-scoped RSID position alias', () => {
    const rawPositionAlias = '00000029';
    const positionKey = `tc::body::${rawPositionAlias}`;
    const positionEntry = {
      pageIndex: 0,
      bounds: { top: 80, left: 12, right: 64, bottom: 100, width: 52, height: 20 },
    };
    const buildCanonicalInstance = (commentId) =>
      buildFloatingCommentInstances({
        comment: {
          commentId,
          trackedChange: true,
          trackedChangePositionAliases: [rawPositionAlias],
        },
        positionKey,
        positionEntry,
        fallbackId: commentId,
      })[0];

    const firstInstance = buildCanonicalInstance('tc-canonical-first');
    const secondInstance = buildCanonicalInstance('tc-canonical-second');

    expect(firstInstance).toMatchObject({
      id: 'tc-canonical-first',
      threadId: 'tc-canonical-first',
      positionKey,
      positionEntry,
    });
    expect(secondInstance).toMatchObject({
      id: 'tc-canonical-second',
      threadId: 'tc-canonical-second',
      positionKey,
      positionEntry,
    });
    expect(new Set([firstInstance.id, secondInstance.id]).size).toBe(2);
  });
});

function record(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) => (field === undefined ? '<undefined>' : field), 2);
}

const headerFooterStory = { kind: 'story', storyType: 'headerFooterPart', refId: 'rId-footer' };
const moveRowId = 'tc|move|1%7C101::move-to';

const recordedScenarios = [
  {
    name: 'no-position-key-or-fallback',
    input: { comment: { commentId: null }, positionKey: null, positionEntry: null, fallbackId: null },
  },
  {
    name: 'single-primary-thread',
    input: {
      comment: { commentId: 'thread-1', trackedChange: false },
      positionKey: 'comment-position-1',
      positionEntry: {
        pageIndex: 4,
        bounds: { top: 80, left: 12, right: 64, bottom: 100, width: 52, height: 20 },
      },
      fallbackId: 'fallback-thread-1',
    },
  },
  {
    name: 'fallback-id-without-position-key',
    input: {
      comment: { commentId: null, trackedChange: false },
      positionKey: null,
      positionEntry: null,
      fallbackId: 'fallback-thread-id',
    },
  },
  {
    name: 'repeated-header-footer-tracked-change',
    input: {
      comment: { commentId: 'tracked-change-repeat', trackedChange: true, trackedChangeStory: headerFooterStory },
      positionKey: 'tc::hf:part:rId-footer::tracked-change-repeat',
      positionEntry: {
        pageIndex: 2,
        rects: [
          { pageIndex: 0, top: 20, left: 12, right: 50, bottom: 40 },
          { pageIndex: 1, top: 120, left: 8, right: 32, bottom: 136 },
          { pageIndex: 1, top: 122, left: 32, right: 72, bottom: 142 },
          { pageIndex: 2, top: 240, left: 16, right: 80, bottom: 266 },
        ],
        bounds: { top: 240, left: 16, right: 80, bottom: 266, width: 64, height: 26 },
      },
      fallbackId: 'fallback-thread-id',
    },
  },
  {
    name: 'geometry-free-header-footer-move-row',
    input: {
      comment: {
        commentId: moveRowId,
        trackedChange: true,
        trackedChangeCanonicalId: 'tc|move|1%7C101',
        trackedChangeSubtype: 'move-to',
        trackedChangeStory: headerFooterStory,
        selection: { page: 1 },
      },
      positionKey: 'tc::hf:part:rId-footer::tc|move|1%7C101',
      positionEntry: { rects: undefined },
      fallbackId: moveRowId,
    },
  },
  {
    name: 'repeated-pages-without-usable-bounds',
    input: {
      comment: {
        commentId: 'tracked-change-invalid-repeat',
        trackedChange: true,
        trackedChangeStory: headerFooterStory,
      },
      positionKey: 'tc::hf:part:rId-footer::tracked-change-invalid-repeat',
      positionEntry: {
        pageIndex: 1,
        rects: [
          { pageIndex: 0, top: 20, left: null, right: 60, bottom: 40 },
          { pageIndex: 1, top: 120, left: undefined, right: 72, bottom: 142 },
        ],
        bounds: { top: 120, left: 16, right: 80, bottom: 146, width: 64, height: 26 },
      },
      fallbackId: 'fallback-thread-id',
    },
  },
];

describe('buildFloatingCommentInstances recordings', () => {
  it.each(recordedScenarios)('$name', async ({ name, input }) => {
    const recording = `input:\n${record(input)}\n\ninstances:\n${record(buildFloatingCommentInstances(input))}\n`;
    await expect(recording).toMatchFileSnapshot(`./__snapshots__/floating-comment-instances/${name}.txt`);
  });
});
