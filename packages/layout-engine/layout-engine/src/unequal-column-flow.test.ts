import { describe, expect, it, mock } from 'bun:test';
import type {
  Line,
  ParagraphBlock,
  ParagraphMeasure,
  ParaFragment,
  TextRun,
  FlowBlock,
  Measure,
} from '@superdoc/contracts';
import { computeLinePmRange, sliceRunsForLine, shouldSkipParagraphDuringLayout } from '@superdoc/contracts';
import { remeasureParagraph } from '../../layout-bridge/src/remeasure.js';
import { layoutDocument } from './index.js';
import { paragraphContinuation } from './paragraph-continuation.js';

// A fixed 5px glyph and 20px line make column capacity independent of fonts.
function measureText(block: ParagraphBlock, width: number): ParagraphMeasure {
  const capacity = Math.floor(width / 5);
  const characters = block.runs.flatMap((run, runIndex) =>
    'text' in run ? [...run.text].map((text, char) => ({ text, runIndex, char })) : [],
  );
  const lines: Line[] = [];
  for (let start = 0; start < characters.length; start += capacity) {
    const slice = characters.slice(start, start + capacity);
    const first = slice[0];
    const last = slice.at(-1)!;
    const segments = slice.reduce<NonNullable<Line['segments']>>((result, char) => {
      const previous = result.at(-1);
      if (previous?.runIndex === char.runIndex) {
        previous.toChar = char.char + 1;
        previous.width += 5;
      } else result.push({ runIndex: char.runIndex, fromChar: char.char, toChar: char.char + 1, width: 5 });
      return result;
    }, []);
    lines.push({
      fromRun: first.runIndex,
      fromChar: first.char,
      toRun: last.runIndex,
      toChar: last.char + 1,
      width: slice.length * 5,
      maxWidth: width,
      ascent: 16,
      descent: 4,
      lineHeight: 20,
      segments,
    });
  }
  return { kind: 'paragraph', measuredAtMaxWidth: width, lines, totalHeight: lines.length * 20 };
}

const block: ParagraphBlock = {
  kind: 'paragraph',
  id: 'column-flow',
  attrs: { widowControl: false },
  runs: ['a'.repeat(73), 'b'.repeat(87), 'c'.repeat(80)].map((text, index, texts) => {
    const start = 1 + texts.slice(0, index).reduce((sum, part) => sum + part.length, 0);
    return { text, fontFamily: 'Arial', fontSize: 12, pmStart: start, pmEnd: start + text.length };
  }),
};

describe('SD-5282 natural paragraph overflow through unequal columns', () => {
  it('preserves every paint character when a multi-digit note label crosses a column boundary', () => {
    const runs: TextRun[] = [
      { kind: 'text', text: 'a'.repeat(25), fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 26 },
      {
        kind: 'text',
        text: '12',
        fontFamily: 'Arial',
        fontSize: 12,
        pmStart: 26,
        pmEnd: 27,
        dataAttrs: { 'data-v2-note-ref': 'fn1' },
      },
      { kind: 'text', text: 'b'.repeat(25), fontFamily: 'Arial', fontSize: 12, pmStart: 27, pmEnd: 52 },
    ];
    const paragraph: ParagraphBlock = { kind: 'paragraph', id: 'note-boundary', attrs: { widowControl: false }, runs };
    const originalRuns = structuredClone(runs);
    const measure = remeasureParagraph(paragraph, 100);
    const layout = layoutDocument([paragraph], [measure], {
      pageSize: { w: 540, h: 28 },
      margins: { left: 0, right: 0, top: 0, bottom: 0 },
      columns: { count: 3, gap: 20, widths: [100, 200, 200], equalWidth: false },
      balanceColumns: false,
      remeasureParagraph,
    });
    const lines = layout.pages
      .flatMap((page) => page.fragments)
      .filter((fragment): fragment is ParaFragment => fragment.kind === 'para')
      .flatMap((fragment) => fragment.lines ?? measure.lines.slice(fragment.fromLine, fragment.toLine));
    const painted = lines
      .flatMap((line) => sliceRunsForLine(paragraph, line))
      .filter((run): run is TextRun => 'text' in run);
    expect(painted.map((run) => run.text).join('')).toBe(runs.map((run) => run.text).join(''));
    expect(
      painted
        .filter((run) => run.dataAttrs?.['data-v2-note-ref'])
        .map((run) => run.text)
        .join(''),
    ).toBe('12');
    expect(runs).toEqual(originalRuns);
  });

  for (const widths of [
    [100, 200, 200],
    [200, 100, 200],
    [100, 100, 100],
  ]) {
    it(`uses destination widths ${widths.join('/')} and preserves run/PM continuity`, () => {
      const remeasure = mock(measureText);
      const originalMeasure = measureText(block, widths[0]);
      const layout = layoutDocument([block], [originalMeasure], {
        pageSize: { w: widths.reduce((a, b) => a + b, 0) + 40, h: 60 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        columns: { count: 3, gap: 20, widths, equalWidth: false },
        remeasureParagraph: remeasure,
        balanceColumns: false,
      });
      expect(layout.pages).toHaveLength(widths[0] === 100 && widths[1] === 100 ? 2 : 1);
      const fragments = layout.pages
        .flatMap((page) => page.fragments)
        .filter((f): f is ParaFragment => f.kind === 'para');
      const ranges: Array<{ pmStart?: number; pmEnd?: number }> = [];
      const painted = fragments
        .flatMap((fragment) => {
          expect(fragment.width).toBe(widths[fragment.columnIndex!]);
          const lines = fragment.lines ?? originalMeasure.lines.slice(fragment.fromLine, fragment.toLine);
          ranges.push(...lines.map((line) => computeLinePmRange(block, line)));
          return lines.flatMap((line) =>
            line.segments!.map((segment) =>
              (block.runs[segment.runIndex] as TextRun).text.slice(segment.fromChar, segment.toChar),
            ),
          );
        })
        .join('');
      expect(painted).toBe(block.runs.map((run) => (run as TextRun).text).join(''));
      expect(ranges[0].pmStart).toBe(1);
      expect(ranges.at(-1)!.pmEnd).toBe(241);
      for (let i = 1; i < ranges.length; i++) expect(ranges[i].pmStart).toBe(ranges[i - 1].pmEnd);
      if (widths.every((width) => width === widths[0])) expect(remeasure).not.toHaveBeenCalled();
    });
  }

  it('unwraps a following paragraph premeasured for a narrower column', () => {
    const preceding: ParagraphBlock = {
      ...block,
      id: 'preceding',
      runs: [{ text: 'x'.repeat(60), fontFamily: 'Arial', fontSize: 12 }],
    };
    const remeasure = mock(measureText);
    const layout = layoutDocument([preceding, block], [measureText(preceding, 100), measureText(block, 100)], {
      pageSize: { w: 540, h: 60 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      columns: { count: 3, gap: 20, widths: [100, 200, 200], equalWidth: false },
      remeasureParagraph: remeasure,
      balanceColumns: false,
    });
    expect(layout.pages).toHaveLength(1);
    expect(remeasure).toHaveBeenCalled();
    expect(layout.pages[0].fragments.filter((f) => f.blockId === block.id).map((f) => f.width)).toEqual([200, 200]);
  });
});

describe('SD-5282 continuous unequal-column section ending', () => {
  it('keeps the following list on the page below a compact reflowed region', () => {
    const columns = { count: 3, gap: 20, widths: [100, 200, 200], equalWidth: false };
    const tail: ParagraphBlock = {
      kind: 'paragraph',
      id: 'formatting-list',
      attrs: { widowControl: false },
      runs: [{ text: 'bold italic underline', fontFamily: 'Arial', fontSize: 12 }],
    };
    const blocks: FlowBlock[] = [
      {
        kind: 'sectionBreak',
        id: 'columns-start',
        type: 'continuous',
        columns,
        attrs: { sectionIndex: 0, isFirstSection: true, typeIsExplicit: true },
      },
      block,
      {
        kind: 'sectionBreak',
        id: 'columns-end',
        type: 'continuous',
        columns: { count: 1, gap: 0 },
        attrs: { sectionIndex: 1, typeIsExplicit: true },
      },
      tail,
    ];
    const measures: Measure[] = [
      { kind: 'sectionBreak' },
      measureText(block, 100),
      { kind: 'sectionBreak' },
      measureText(tail, 540),
    ];
    const layout = layoutDocument(blocks, measures, {
      pageSize: { w: 540, h: 120 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      remeasureParagraph: measureText,
    });
    expect(layout.pages).toHaveLength(1);
    const fragments = layout.pages[0].fragments.filter((f): f is ParaFragment => f.kind === 'para');
    const region = fragments.filter((f) => f.blockId === block.id);
    expect(new Set(region.map((f) => f.columnIndex)).size).toBe(3);
    const bottom = Math.max(
      ...region.map(
        (f) =>
          f.y +
          (f.lines ?? measureText(block, 100).lines.slice(f.fromLine, f.toLine)).reduce((h, l) => h + l.lineHeight, 0),
      ),
    );
    expect(bottom).toBeLessThan(100);
    expect(fragments.find((f) => f.blockId === tail.id)!.y).toBeGreaterThanOrEqual(bottom);
    expect(
      region
        .flatMap((f) => f.lines ?? measureText(block, 100).lines.slice(f.fromLine, f.toLine))
        .flatMap((l) => sliceRunsForLine(block, l))
        .map((r) => ('text' in r ? r.text : ''))
        .join(''),
    ).toBe(block.runs.map((r) => ('text' in r ? r.text : '')).join(''));
    for (const f of region) expect(f.width).toBe(columns.widths[f.columnIndex!]);
  });
});

it('preserves terminal-tab paint geometry when unequal section replay is unsupported', () => {
  const paragraph: ParagraphBlock = {
    kind: 'paragraph',
    id: 'tab-control',
    attrs: { widowControl: false },
    runs: [
      { kind: 'text', text: 'a'.repeat(368), fontFamily: 'Arial', fontSize: 12, pmStart: 1, pmEnd: 369 },
      { kind: 'tab', fontFamily: 'Arial', fontSize: 12, pmStart: 369, pmEnd: 370 },
    ],
  };
  const tail: ParagraphBlock = {
    kind: 'paragraph',
    id: 'tail',
    runs: [{ text: 'tail', fontFamily: 'Arial', fontSize: 12 }],
  };
  const blocks: FlowBlock[] = [
    {
      kind: 'sectionBreak',
      id: 'begin',
      type: 'continuous',
      columns: { count: 3, gap: 20, widths: [100, 200, 200], equalWidth: false },
      attrs: { sectionIndex: 0, isFirstSection: true, typeIsExplicit: true },
    },
    paragraph,
    {
      kind: 'sectionBreak',
      id: 'end',
      type: 'continuous',
      columns: { count: 1, gap: 0 },
      attrs: { sectionIndex: 1, typeIsExplicit: true },
    },
    tail,
  ];
  const measure = remeasureParagraph(paragraph, 100);
  const result = layoutDocument(
    blocks,
    [{ kind: 'sectionBreak' }, measure, { kind: 'sectionBreak' }, remeasureParagraph(tail, 540)],
    {
      pageSize: { w: 540, h: 120 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      remeasureParagraph,
    },
  );
  const fragment = result.pages
    .flatMap((p) => p.fragments)
    .filter((f): f is ParaFragment => f.kind === 'para' && f.blockId === paragraph.id)
    .at(-1)!;
  const line = (fragment.lines ?? measure.lines.slice(fragment.fromLine, fragment.toLine)).at(-1)!;
  const tabWidth = line.width - (line.segments ?? []).reduce((width, segment) => width + segment.width, 0);
  expect(paragraph.runs[1].kind === 'tab' && paragraph.runs[1].width).toBeCloseTo(tabWidth, 5);
});

it('addresses continuation tab paint widths by original run index', () => {
  const paragraph: ParagraphBlock = {
    kind: 'paragraph',
    id: 'tab-cache',
    runs: [
      { text: 'prefix', fontFamily: 'Arial', fontSize: 12, pmStart: 100, pmEnd: 106 },
      { text: 'suffix', fontFamily: 'Arial', fontSize: 12, pmStart: 106, pmEnd: 112 },
      { kind: 'tab', width: 0, pmStart: 112, pmEnd: 113 },
    ],
  };
  const first: Line = {
    fromRun: 1,
    fromChar: 0,
    toRun: 2,
    toChar: 1,
    width: 100,
    lineHeight: 20,
    ascent: 16,
    descent: 4,
  };
  const mapped = paragraphContinuation(paragraph, first).mapLine({
    ...first,
    fromRun: 0,
    toRun: 1,
    tabWidths: { 1: 48 },
  });
  expect(mapped.tabWidths?.[2]).toBe(48);
  expect(mapped.tabWidths?.[1]).toBeUndefined();
  expect(paragraph.runs[2].pmStart).toBe(112);
});

it('keeps a heading-styled invisible unequal-column closing marker off a separate blank page', () => {
  const columns = { count: 3, gap: 20, widths: [100, 200, 200], equalWidth: false };
  const marker: ParagraphBlock = {
    kind: 'paragraph',
    id: 'closing-marker',
    attrs: { sectPrMarker: true, keepNext: true, keepLines: true, spacing: { before: 20 } },
    runs: [{ text: '', fontFamily: 'Arial', fontSize: 18 }],
  };
  const following: ParagraphBlock = {
    kind: 'paragraph',
    id: 'picture-intro',
    runs: [{ text: 'Picture section', fontFamily: 'Arial', fontSize: 12 }],
  };
  const blocks: FlowBlock[] = [
    {
      kind: 'sectionBreak',
      id: 'begin',
      type: 'continuous',
      columns,
      attrs: { source: 'sectPr', sectionIndex: 0, isFirstSection: true, typeIsExplicit: true },
    },
    block,
    marker,
    {
      kind: 'sectionBreak',
      id: 'end',
      type: 'continuous',
      columns: { count: 1, gap: 0 },
      attrs: { source: 'sectPr', sectionIndex: 1, typeIsExplicit: true },
    },
    { kind: 'pageBreak', id: 'authored-picture-break', attrs: { source: 'pageBreakBefore' } },
    following,
  ];
  const blank: ParagraphMeasure = {
    kind: 'paragraph',
    measuredAtMaxWidth: 100,
    totalHeight: 20,
    lines: [
      { fromRun: 0, fromChar: 0, toRun: 0, toChar: 0, width: 0, maxWidth: 100, lineHeight: 20, ascent: 16, descent: 4 },
    ],
  };
  const result = layoutDocument(
    blocks,
    [
      { kind: 'sectionBreak' },
      measureText(block, 100),
      blank,
      { kind: 'sectionBreak' },
      { kind: 'pageBreak' },
      measureText(following, 540),
    ],
    {
      pageSize: { w: 540, h: 60 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      remeasureParagraph: measureText,
    },
  );
  expect(result.pages).toHaveLength(2);
  expect(result.pages[1].fragments.some((f) => f.blockId === following.id)).toBe(true);
  expect(result.pages.flatMap((p) => p.fragments).some((f) => f.blockId === marker.id)).toBe(false);
});

describe('SD-5282 invisible closing-carrier eligibility controls', () => {
  function boundary(): FlowBlock[] {
    return [
      {
        kind: 'sectionBreak',
        id: 'begin',
        type: 'continuous',
        columns: { count: 3, gap: 20, widths: [100, 200, 200], equalWidth: false },
        attrs: { source: 'sectPr' },
      },
      { kind: 'paragraph', id: 'body', runs: [{ text: 'Body' }] },
      { kind: 'paragraph', id: 'marker', runs: [{ text: '' }], attrs: { sectPrMarker: true } },
      {
        kind: 'sectionBreak',
        id: 'end',
        type: 'continuous',
        columns: { count: 1, gap: 0 },
        attrs: { source: 'sectPr' },
      },
      { kind: 'pageBreak', id: 'authored', attrs: { source: 'pageBreakBefore' } },
      { kind: 'paragraph', id: 'following', runs: [{ text: 'Following' }] },
    ];
  }
  it('omits only the empty invisible carrier ending a readable unequal section', () => {
    expect(shouldSkipParagraphDuringLayout(boundary(), 2)).toBe(true);
  });
  it('preserves ordinary blank paragraphs and numbered, framed, inline, and reviewable carriers', () => {
    for (const attrs of [
      {},
      { sectPrMarker: true, numberingProperties: { numId: 1 } },
      { sectPrMarker: true, wordLayout: { marker: { text: '1.' } } },
      { sectPrMarker: true, frame: { width: 20 } },
      { sectPrMarker: true, paragraphMarkTrackedChange: { targetKind: 'section-break' } },
    ]) {
      const blocks = boundary();
      (blocks[2] as ParagraphBlock).attrs = attrs as ParagraphBlock['attrs'];
      expect(shouldSkipParagraphDuringLayout(blocks, 2)).toBe(false);
    }
    const blocks = boundary();
    (blocks[2] as ParagraphBlock).inlineBoxes = [{}] as ParagraphBlock['inlineBoxes'];
    expect(shouldSkipParagraphDuringLayout(blocks, 2)).toBe(false);
  });
  it('stops at the nearest section and preserves equal, malformed, and implicit section boundaries', () => {
    for (const widths of [
      [100, 100, 100],
      [100, NaN, 200],
      [100, 200],
    ]) {
      const blocks = boundary();
      if (blocks[0].kind === 'sectionBreak') blocks[0].columns!.widths = widths;
      expect(shouldSkipParagraphDuringLayout(blocks, 2)).toBe(false);
    }
    const blocks = boundary();
    blocks.splice(1, 0, {
      kind: 'sectionBreak',
      id: 'nearest',
      type: 'continuous',
      columns: { count: 1, gap: 0 },
      attrs: { source: 'sectPr' },
    });
    expect(shouldSkipParagraphDuringLayout(blocks, 3)).toBe(false);
    const implicit = boundary();
    if (implicit[3].kind === 'sectionBreak') implicit[3].type = undefined;
    expect(shouldSkipParagraphDuringLayout(implicit, 2)).toBe(true);
    const nonSource = boundary();
    if (nonSource[3].kind === 'sectionBreak') nonSource[3].attrs = {};
    expect(shouldSkipParagraphDuringLayout(nonSource, 2)).toBe(false);
  });
  it('preserves explicit and fallback drawing or table anchor owners', () => {
    for (const kind of ['drawing', 'image', 'table'] as const) {
      const explicit = boundary();
      explicit.push({ kind, id: 'anchored', attrs: { anchorParagraphId: 'marker' } } as FlowBlock);
      expect(shouldSkipParagraphDuringLayout(explicit, 2)).toBe(false);
      const fallback = boundary();
      fallback.splice(5, 0, { kind, id: 'fallback', anchor: { isAnchored: true } } as FlowBlock);
      expect(shouldSkipParagraphDuringLayout(fallback, 2)).toBe(false);
    }
  });
});

it('preserves a closing carrier when remote anchored objects have uncertain fallback owners', () => {
  const begin: FlowBlock = {
    kind: 'sectionBreak',
    id: 'begin',
    type: 'continuous',
    columns: { count: 2, gap: 0, widths: [100, 200], equalWidth: false },
    attrs: { source: 'sectPr' },
  };
  const marker: ParagraphBlock = {
    kind: 'paragraph',
    id: 'marker',
    attrs: { sectPrMarker: true },
    runs: [{ text: '' }],
  };
  const end: FlowBlock = {
    kind: 'sectionBreak',
    id: 'end',
    type: 'continuous',
    columns: { count: 1, gap: 0 },
    attrs: { source: 'sectPr' },
  };
  const owner: ParagraphBlock = { kind: 'paragraph', id: 'remote-owner', runs: [{ text: '' }] };
  const anchored: FlowBlock = {
    kind: 'drawing',
    id: 'anchored',
    anchor: { isAnchored: true },
    attrs: { anchorParagraphId: owner.id },
  } as FlowBlock;
  const ordinary: FlowBlock[] = [begin, marker, end, owner, anchored];
  expect(shouldSkipParagraphDuringLayout(ordinary, 1)).toBe(true);
  expect(shouldSkipParagraphDuringLayout(ordinary, 3)).toBe(false);
  const skipped: FlowBlock[] = [{ kind: 'pageBreak', id: 'before-owner' }, owner, begin, marker, end, anchored];
  expect(shouldSkipParagraphDuringLayout(skipped, 3)).toBe(false);
  owner.attrs = { sectPrMarker: true };
  expect(shouldSkipParagraphDuringLayout(ordinary, 1)).toBe(false);
  owner.attrs = undefined;
  marker.sourceAnchor = { sourceRef: { partUri: '/word/document.xml', xpathLikePath: 'body/w:p[ordinal=2]' } };
  anchored.sourceAnchor = {
    sourceRef: { partUri: '/word/document.xml', xpathLikePath: 'body/w:p[ordinal=2]/drawing[10]' },
  };
  expect(shouldSkipParagraphDuringLayout(ordinary, 1)).toBe(false);
});
