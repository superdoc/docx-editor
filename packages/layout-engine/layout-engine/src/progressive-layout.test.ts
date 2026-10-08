import { describe, expect, it } from 'bun:test';
import type {
  DrawingMeasure,
  FlowBlock,
  Measure,
  ParagraphMeasure,
  TableBlock,
  TableMeasure,
} from '@superdoc/contracts';
import * as engine from './index.js';

const options = {
  pageSize: { w: 200, h: 120 },
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
};

function paragraph(lines: number): { blocks: FlowBlock[]; measures: Measure[] } {
  return {
    blocks: [{ kind: 'paragraph', id: 'long', attrs: { widowControl: false }, runs: [{ text: 'x'.repeat(lines) }] }],
    measures: [
      {
        kind: 'paragraph',
        totalHeight: lines * 10,
        lines: Array.from({ length: lines }, (_, index) => ({
          fromRun: 0,
          toRun: 0,
          fromChar: index,
          toChar: index + 1,
          width: 20,
          ascent: 8,
          descent: 2,
          lineHeight: 10,
        })),
      } satisfies ParagraphMeasure,
    ],
  };
}

function nonFlowAnchor(
  kind: 'image' | 'drawing',
  behindDoc = false,
  vRelativeFrom: 'paragraph' | 'insideMargin' | 'page' = 'paragraph',
): { block: FlowBlock; measure: Measure } {
  const anchor = { isAnchored: true, hRelativeFrom: 'column' as const, vRelativeFrom, offsetV: 0, behindDoc };
  if (kind === 'image')
    return {
      block: {
        kind,
        id: 'overlay',
        src: 'fixture.png',
        width: 30,
        height: 12,
        anchor,
        wrap: { type: 'None' },
        attrs: { anchorParagraphId: 'carrier' },
      },
      measure: { kind, width: 30, height: 12 },
    };
  return {
    block: {
      kind,
      id: 'overlay',
      drawingKind: 'vectorShape',
      geometry: { width: 30, height: 12 },
      anchor,
      wrap: { type: 'None' },
      attrs: { anchorParagraphId: 'carrier' },
    },
    measure: {
      kind,
      drawingKind: 'vectorShape',
      width: 30,
      height: 12,
      scale: 1,
      naturalWidth: 30,
      naturalHeight: 12,
      geometry: { width: 30, height: 12, rotation: 0, flipH: false, flipV: false },
    } satisfies DrawingMeasure,
  };
}

describe('progressive page continuation', () => {
  it('keeps trailing empty pages out of every published sealed prefix', async () => {
    const input = paragraph(25);
    for (let index = 0; index < 3; index++) {
      input.blocks.push({ kind: 'pageBreak', id: `trailing-break-${index}` });
      input.measures.push({ kind: 'pageBreak' });
    }
    const cold = engine.layoutDocument(input.blocks, input.measures, options);
    const continuation = engine.createLayoutDocumentContinuation(input.blocks, input.measures, options);
    let published = 0;
    while (true) {
      const batch = await continuation.advance({ pageCount: 1 });
      expect(batch.layout.pages.length).toBeGreaterThanOrEqual(published);
      expect(batch.layout.pages).toEqual(cold.pages.slice(0, batch.layout.pages.length));
      published = batch.layout.pages.length;
      if (batch.status === 'complete') {
        expect(batch.layout).toEqual(cold);
        break;
      }
    }
  });

  it('preserves interior blank pages before later content', async () => {
    const input = paragraph(5);
    for (let index = 0; index < 3; index++) {
      input.blocks.push({ kind: 'pageBreak', id: `interior-break-${index}` });
      input.measures.push({ kind: 'pageBreak' });
    }
    const tail = paragraph(5);
    tail.blocks[0]!.id = 'tail';
    input.blocks.push(...tail.blocks);
    input.measures.push(...tail.measures);
    const cold = engine.layoutDocument(input.blocks, input.measures, options);
    expect(cold.pages.filter((page) => page.fragments.length === 0)).toHaveLength(2);
    const continuation = engine.createLayoutDocumentContinuation(input.blocks, input.measures, options);
    let published = 0;
    while (true) {
      const batch = await continuation.advance({ pageCount: 1 });
      expect(batch.layout.pages.length).toBeGreaterThanOrEqual(published);
      expect(batch.layout.pages).toEqual(cold.pages.slice(0, batch.layout.pages.length));
      published = batch.layout.pages.length;
      if (batch.status === 'complete') {
        expect(batch.layout).toEqual(cold);
        break;
      }
    }
  });

  it.each(['image', 'drawing'] as const)('seals unaffected pages before a late wrap-none %s carrier', async (kind) => {
    for (const { behindDoc, vRelativeFrom } of [
      { behindDoc: false, vRelativeFrom: 'paragraph' as const },
      { behindDoc: true, vRelativeFrom: 'paragraph' as const },
      { behindDoc: true, vRelativeFrom: 'insideMargin' as const },
      { behindDoc: false, vRelativeFrom: 'page' as const },
    ]) {
      const before = paragraph(25);
      const carrier = paragraph(40);
      carrier.blocks[0] = { ...carrier.blocks[0], id: 'carrier' };
      const after = paragraph(25);
      after.blocks[0] = { ...after.blocks[0], id: 'tail' };
      const overlay = nonFlowAnchor(kind, behindDoc, vRelativeFrom);
      const blocks = [...before.blocks, overlay.block, ...carrier.blocks, ...after.blocks];
      const measures = [...before.measures, overlay.measure, ...carrier.measures, ...after.measures];
      const cold = engine.layoutDocument(blocks, measures, options);
      const continuation = engine.createLayoutDocumentContinuation(blocks, measures, options);
      let batch = await continuation.advance({ pageCount: 1 });
      expect(batch.status).toBe('pending');
      expect(batch.layout.pages).toHaveLength(1);
      const first = structuredClone(batch.layout.pages[0]);
      while (batch.status === 'pending') {
        batch.layout.pages.forEach((page, index) => expect(page).toEqual(cold.pages[index]));
        batch = await continuation.advance({ pageCount: 1 });
        expect(batch.layout.pages[0]).toEqual(first);
      }
      expect(batch.layout).toEqual(cold);
      expect(
        batch.layout.pages.flatMap((page) => page.fragments).filter((fragment) => fragment.blockId === 'overlay'),
      ).toHaveLength(1);
    }
  });

  it('keeps flowing anchored overlays on the complete path', async () => {
    const body = paragraph(40);
    body.blocks[0] = { ...body.blocks[0], id: 'carrier' };
    const overlay = nonFlowAnchor('image');
    if (overlay.block.kind !== 'image') throw new Error('expected image');
    overlay.block.wrap = { type: 'Square' };
    const blocks = [overlay.block, ...body.blocks];
    const measures = [overlay.measure, ...body.measures];
    const batch = await engine.createLayoutDocumentContinuation(blocks, measures, options).advance();
    expect(batch.status).toBe('complete');
    expect(batch.completeReason).toBe('post-pagination-dependency:image-wrap');
    expect(batch.layout).toEqual(engine.layoutDocument(blocks, measures, options));
  });

  it.each([8, 16])('seals paragraph-relative %i-row floating tables after carrier relocation', async (rowCount) => {
    for (const wrap of ['None', 'Square'] as const) {
      const before = paragraph(29);
      const carrier = paragraph(1);
      carrier.blocks[0] = {
        ...carrier.blocks[0],
        id: 'carrier',
        attrs: { spacing: { before: 16 }, widowControl: false },
      };
      const tail = paragraph(25);
      tail.blocks[0] = { ...tail.blocks[0], id: 'tail' };
      const table: TableBlock = {
        kind: 'table',
        id: 'floating',
        rows: Array.from({ length: rowCount }, (_, index) => ({
          id: `row-${index}`,
          cells: [{ id: `cell-${index}`, blocks: [] }],
        })),
        anchor: { isAnchored: true, hRelativeFrom: 'margin', vRelativeFrom: 'paragraph', offsetV: 7 },
        wrap: { type: wrap, distLeft: 5, distRight: 5 },
        attrs: { anchorParagraphId: 'carrier' },
      };
      const measure: TableMeasure = {
        kind: 'table',
        columnWidths: [150],
        totalWidth: 150,
        totalHeight: rowCount * 9,
        rows: table.rows.map(() => ({ height: 9, cells: [{ width: 150, height: 9, gridColumnStart: 0, blocks: [] }] })),
      };
      const blocks = [...before.blocks, table, ...carrier.blocks, ...tail.blocks];
      const measures = [...before.measures, measure, ...carrier.measures, ...tail.measures];
      const cold = engine.layoutDocument(blocks, measures, options);
      const continuation = engine.createLayoutDocumentContinuation(blocks, measures, options);
      let batch = await continuation.advance({ pageCount: 1 });
      expect(batch.status).toBe('pending');
      while (batch.status === 'pending') {
        batch.layout.pages.forEach((page, index) => expect(page).toEqual(cold.pages[index]));
        batch = await continuation.advance({ pageCount: 1 });
      }
      expect(batch.layout).toEqual(cold);
      expect(
        batch.layout.pages.flatMap((page) => page.fragments).filter((fragment) => fragment.blockId === 'floating'),
      ).toHaveLength(1);
    }
  });

  it('keeps deferred spaced split-carrier anchors on the complete path', async () => {
    const before = paragraph(25);
    const sourceAnchor = { sourceRef: { partUri: '/word/document.xml', xpathLikePath: 'body/w:p[ordinal=1]' } };
    const carrier: FlowBlock = {
      kind: 'paragraph',
      id: 'carrier',
      runs: [{ kind: 'lineBreak' }],
      attrs: { spacing: { before: 16 } },
      sourceAnchor,
    };
    const trailing = paragraph(40);
    trailing.blocks[0] = { ...trailing.blocks[0], id: 'trailing', sourceAnchor };
    const overlay = nonFlowAnchor('image');
    const blocks = [...before.blocks, carrier, overlay.block, ...trailing.blocks];
    const measures: Measure[] = [...before.measures, paragraph(1).measures[0], overlay.measure, ...trailing.measures];
    const batch = await engine.createLayoutDocumentContinuation(blocks, measures, options).advance();
    expect(batch.status).toBe('complete');
    expect(batch.completeReason).toBe('post-pagination-dependency:deferred-spaced-anchor-carrier');
    expect(batch.layout).toEqual(engine.layoutDocument(blocks, measures, options));
  });

  it('keeps page-relative floating tables on the complete path', async () => {
    const body = paragraph(40);
    const table: TableBlock = {
      kind: 'table',
      id: 'page-float',
      rows: [],
      anchor: { isAnchored: true, vRelativeFrom: 'page', offsetV: 10 },
      wrap: { type: 'None' },
    };
    const measure: TableMeasure = { kind: 'table', columnWidths: [100], rows: [], totalWidth: 100, totalHeight: 20 };
    const blocks = [table, ...body.blocks];
    const measures = [measure, ...body.measures];
    const batch = await engine.createLayoutDocumentContinuation(blocks, measures, options).advance();
    expect(batch.status).toBe('complete');
    expect(batch.completeReason).toBe('post-pagination-dependency:page-relative-anchored-table');
    expect(batch.layout).toEqual(engine.layoutDocument(blocks, measures, options));
  });

  it('treats an explicitly empty footnote plane as dependency free', async () => {
    const input = paragraph(200);
    const settings = { ...options, footnotes: { refs: [], blocksById: new Map() } };
    const continuation = engine.createLayoutDocumentContinuation(input.blocks, input.measures, settings);
    let result = await continuation.advance({ pageCount: 1 });
    expect(result.status).toBe('pending');
    expect(result.layout.pages).toHaveLength(1);
    while (result.status === 'pending') result = await continuation.advance({ pageCount: 2 });
    expect(result.layout).toEqual(engine.layoutDocument(input.blocks, input.measures, settings));
  });

  it('publishes one sealed page of a long paragraph before traversing its tail and never replays preparation', async () => {
    const input = paragraph(200);
    const checkpoints: engine.LayoutExecutionCheckpoint[] = [];
    const continuation = engine.createLayoutDocumentContinuation(input.blocks, input.measures, options, {
      yieldToHost: async (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });
    const first = await continuation.advance({ pageCount: 1 });
    expect(first.status).toBe('pending');
    expect(first.layout.pages).toHaveLength(1);
    expect(first.pageRange).toEqual({ startPageIndex: 0, endPageIndexExclusive: 1 });
    expect(first.resume.nextBlockIndex).toBe(0);
    expect(first.resume.paragraphLineIndex).toBeGreaterThan(0);
    expect(first.resume.paragraphLineIndex).toBeLessThan(200);
    const sealed = structuredClone(first.layout.pages[0]);
    const identity = first.resume.checkpointIdentity;
    let result = first;
    while (result.status === 'pending') {
      result = await continuation.advance({ pageCount: 2 });
      expect(result.resume.checkpointIdentity).toBe(identity);
      expect(first.layout.pages[0]).toEqual(sealed);
    }
    expect(result.layout).toEqual(engine.layoutDocument(input.blocks, input.measures, options));
    expect(
      checkpoints.filter((checkpoint) => checkpoint.phase === 'layout-document:prepare' && checkpoint.index === 0),
    ).toHaveLength(1);
  });

  it('rejects an obsolete continuation without reading the document source', async () => {
    const input = paragraph(20);
    let reads = 0;
    const source = new Proxy(
      Array.from({ length: 3500 }, (_, index) => ({ ...input.blocks[0], id: `p-${index}` })),
      {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const controller = new AbortController();
    const revoked = new Error('document generation already revoked');
    controller.abort(revoked);
    const continuation = engine.createLayoutDocumentContinuation(
      source,
      Array.from({ length: source.length }, () => input.measures[0]),
      options,
      { signal: controller.signal },
    );
    try {
      expect(reads).toBe(0);
      await expect(continuation.advance()).rejects.toBe(revoked);
      expect(reads).toBe(0);
    } finally {
      continuation.dispose();
    }
  });

  it('can revoke ownership between fragments of one paragraph', async () => {
    const input = paragraph(200);
    const controller = new AbortController();
    const revoked = new Error('paragraph generation revoked');
    let visited = 0;
    const result = engine.layoutDocumentCooperatively(input.blocks, input.measures, options, {
      signal: controller.signal,
      yieldToHost: async (checkpoint) => {
        if (checkpoint.phase !== 'layout-document:paragraph-fragment') return;
        visited += 1;
        if (visited === 2) controller.abort(revoked);
      },
    });
    await expect(result).rejects.toBe(revoked);
    expect(visited).toBe(2);
  });

  it('continues a table from its row cursor and preserves every row exactly once', async () => {
    const block: TableBlock = {
      kind: 'table',
      id: 'table',
      rows: Array.from({ length: 80 }, (_, index) => ({
        id: `row-${index}`,
        cells: [{ id: `cell-${index}`, blocks: [] }],
      })),
    };
    const measure: TableMeasure = {
      kind: 'table',
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: 1600,
      rows: block.rows.map(() => ({ height: 20, cells: [{ width: 100, height: 20, gridColumnStart: 0, blocks: [] }] })),
    };
    const continuation = engine.createLayoutDocumentContinuation([block], [measure], options);
    let result = await continuation.advance({ pageCount: 1 });
    expect(result.status).toBe('pending');
    expect(result.resume.nextBlockIndex).toBe(0);
    expect(result.resume.tableRowIndex).toBeGreaterThan(0);
    expect(result.layout.pages).toHaveLength(1);
    while (result.status === 'pending') result = await continuation.advance({ pageCount: 3 });
    expect(result.layout).toEqual(engine.layoutDocument([block], [measure], options));
  });

  it('does not advertise unfinished section alignment as a sealed page', async () => {
    const input = paragraph(25);
    const aligned = { ...options, sectionMetadata: [{ sectionIndex: 0, vAlign: 'center' as const }] };
    const continuation = engine.createLayoutDocumentContinuation(input.blocks, input.measures, aligned);
    const result = await continuation.advance({ pageCount: 1 });
    expect(result.status).toBe('complete');
    expect(result.layout).toEqual(engine.layoutDocument(input.blocks, input.measures, aligned));
  });

  it('seals stable pages across section geometry changes with the same final layout', async () => {
    const first = paragraph(25);
    const last = paragraph(30);
    last.blocks[0] = { ...last.blocks[0], id: 'second-section' };
    const blocks: FlowBlock[] = [
      first.blocks[0],
      {
        kind: 'sectionBreak',
        id: 'section',
        type: 'nextPage',
        attrs: { sectionIndex: 0 },
        pageSize: { w: 240, h: 140 },
        margins: { top: 15, right: 15, bottom: 15, left: 15 },
      },
      last.blocks[0],
    ];
    const measures: Measure[] = [first.measures[0], { kind: 'sectionBreak' }, last.measures[0]];
    const cold = engine.layoutDocument(blocks, measures, options);
    const continuation = engine.createLayoutDocumentContinuation(blocks, measures, options);
    let batch = await continuation.advance();
    expect(batch.status).toBe('pending');
    while (batch.status === 'pending') {
      batch.layout.pages.forEach((page, index) => expect(page).toEqual(cold.pages[index]));
      batch = await continuation.advance();
    }
    expect(batch.layout).toEqual(cold);
  });
});
