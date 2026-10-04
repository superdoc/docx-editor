import { describe, it, expect } from 'vite-plus/test';
import { collectSegmentGeometry } from '../src/index.ts';
import { LAYOUT_SEGMENT_GEOMETRY_SCHEMA } from '@superdoc/contracts';
import type {
  FlowBlock,
  Layout,
  Line,
  LineSegment,
  Measure,
  ParaFragment,
  ParagraphAttrs,
  ParagraphBlock,
  ParagraphMeasure,
  Run,
  TableBlock,
  TableFragment,
  TableMeasure,
} from '@superdoc/contracts';

// ---------------------------------------------------------------------------
// Fixture helpers — geometry is fully controlled so assertions are exact.
// Segment widths stand in for the canvas-measured widths the real measurer
// produces; the readback consumes them as data (no canvas in the node test env).
// ---------------------------------------------------------------------------

const textRun = (text: string, pmStart: number, extra?: Partial<Run>): Run =>
  ({ kind: 'text', text, fontFamily: 'Arial', fontSize: 16, pmStart, pmEnd: pmStart + text.length, ...extra }) as Run;

const makeLine = (over: Partial<Line> & { segments?: LineSegment[] }): Line => ({
  fromRun: 0,
  fromChar: 0,
  toRun: 0,
  toChar: 0,
  width: 0,
  ascent: 12,
  descent: 4,
  lineHeight: 20,
  maxWidth: 500,
  ...over,
});

const paragraphBlock = (id: string, runs: Run[], attrs?: ParagraphAttrs): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs,
  ...(attrs ? { attrs } : {}),
});

const paragraphMeasure = (lines: Line[], marker?: ParagraphMeasure['marker']): Measure => ({
  kind: 'paragraph',
  lines,
  totalHeight: lines.reduce((s, l) => s + l.lineHeight, 0),
  ...(marker ? { marker } : {}),
});

const paraFragment = (over: Partial<ParaFragment> & { blockId: string }): ParaFragment => ({
  kind: 'para',
  fromLine: 0,
  toLine: 1,
  x: 0,
  y: 0,
  width: 500,
  ...over,
});

const singlePageLayout = (fragments: ParaFragment[] | TableFragment[], over?: Partial<Layout>): Layout => ({
  pageSize: { w: 600, h: 800 },
  pages: [{ number: 1, fragments: fragments as Layout['pages'][number]['fragments'] }],
  layoutEpoch: 7,
  ...over,
});

describe('collectSegmentGeometry', () => {
  it('resolves absolute segment x by accumulating measured widths (LTR, left-aligned)', () => {
    const block = paragraphBlock('p1', [textRun('Hello world', 1)]);
    const line = makeLine({
      toChar: 11,
      width: 90,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 6, width: 50 },
        { runIndex: 0, fromChar: 6, toChar: 11, width: 40 },
      ],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'p1', x: 30, y: 10, width: 400 })]);

    const out = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]);

    expect(out.schema).toBe(LAYOUT_SEGMENT_GEOMETRY_SCHEMA);
    expect(out.layoutRevision).toBe(7);
    expect(out.fragments).toHaveLength(1);

    const frag = out.fragments[0];
    expect(frag.fragmentKind).toBe('para');
    expect(frag.diagnostics).toBeUndefined();
    expect(frag.lines).toHaveLength(1);

    const l = frag.lines[0];
    expect(l.lineIndex).toBe(0);
    expect(l.contentLeft).toBe(30); // fragment.x + indent(0) + alignment(0)
    expect(l.contentWidth).toBe(90);
    expect(l.direction).toBe('ltr');
    // top = fragment.y(10) + pageTop(0); baseline = top + halfLeading + ascent
    // halfLeading = (20 - 12 - 4)/2 = 2 -> baseline = 10 + 2 + 12 = 24
    expect(l.top).toBe(10);
    expect(l.baseline).toBe(24);

    expect(l.segments).toEqual([
      { segmentIndex: 0, runIndex: 0, fromChar: 0, toChar: 6, x: 30, width: 50 },
      { segmentIndex: 1, runIndex: 0, fromChar: 6, toChar: 11, x: 80, width: 40 },
    ]);
  });

  it('joins every record back to neutral identity (story / blockRef / fragmentId)', () => {
    const block = paragraphBlock('blk-7', [textRun('abc', 1)]);
    const line = makeLine({ toChar: 3, width: 30, segments: [{ runIndex: 0, fromChar: 0, toChar: 3, width: 30 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'blk-7', width: 300 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];

    expect(frag.story).toEqual({ kind: 'body' });
    expect(frag.blockRef).toBe('blk-7');
    expect(frag.fragmentId).toContain('blk-7');
    expect(frag.identity.schema).toBeDefined();
    expect(frag.identity.fragmentId).toBe(frag.fragmentId);
  });

  it('accumulates line top across a wrapped (multi-line) paragraph', () => {
    const block = paragraphBlock('w1', [textRun('line one line two', 1)]);
    const lines = [
      makeLine({
        toChar: 8,
        width: 80,
        lineHeight: 20,
        segments: [{ runIndex: 0, fromChar: 0, toChar: 8, width: 80 }],
      }),
      makeLine({
        fromChar: 8,
        toChar: 17,
        width: 90,
        lineHeight: 24,
        segments: [{ runIndex: 0, fromChar: 8, toChar: 17, width: 90 }],
      }),
    ];
    const layout = singlePageLayout([paraFragment({ blockId: 'w1', y: 100, fromLine: 0, toLine: 2 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure(lines)]).fragments[0];

    expect(frag.lines.map((l) => l.lineIndex)).toEqual([0, 1]);
    expect(frag.lines[0].top).toBe(100);
    expect(frag.lines[1].top).toBe(120); // 100 + first line height (20)
    expect(frag.bounds.height).toBe(44); // 20 + 24
  });

  it('centers and right-aligns content within the available width', () => {
    const seg = (w: number): LineSegment[] => [{ runIndex: 0, fromChar: 0, toChar: 4, width: w }];
    const centerBlock = paragraphBlock('c1', [textRun('test', 1)], { alignment: 'center' } as ParagraphAttrs);
    const rightBlock = paragraphBlock('r1', [textRun('test', 1)], { alignment: 'right' } as ParagraphAttrs);
    const line = () => makeLine({ toChar: 4, width: 100, maxWidth: 300, segments: seg(100) });

    const centered = collectSegmentGeometry(
      singlePageLayout([paraFragment({ blockId: 'c1', x: 0, width: 300 })]),
      [centerBlock],
      [paragraphMeasure([line()])],
    ).fragments[0];
    // alignmentOffset = (300 - 100) / 2 = 100
    expect(centered.lines[0].contentLeft).toBe(100);
    expect(centered.lines[0].segments[0].x).toBe(100);

    const rightAligned = collectSegmentGeometry(
      singlePageLayout([paraFragment({ blockId: 'r1', x: 0, width: 300 })]),
      [rightBlock],
      [paragraphMeasure([line()])],
    ).fragments[0];
    // alignmentOffset = 300 - 100 = 200
    expect(rightAligned.lines[0].contentLeft).toBe(200);
    expect(rightAligned.lines[0].segments[0].x).toBe(200);
  });

  it('honors explicit tab/segment positioning and flags the line', () => {
    const block = paragraphBlock('t1', [textRun('a', 1, { pmEnd: 2 }), textRun('b', 3, { pmEnd: 4 })]);
    const line = makeLine({
      toRun: 1,
      toChar: 1,
      width: 210,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 1, width: 10 },
        // explicit x (tab-aligned) resets the running cursor
        { runIndex: 1, fromChar: 0, toChar: 1, width: 10, x: 200 },
      ],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 't1', x: 5, toRun: 1 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];

    expect(frag.lines[0].flags?.tabAligned).toBe(true);
    expect(frag.lines[0].segments[0].x).toBe(5); // fragment.x + 0
    expect(frag.lines[0].segments[1].x).toBe(205); // fragment.x + explicit 200
  });

  it('preserves run-relative offsets for surrogate pairs and combining marks', () => {
    // "a" + combining acute, then an emoji surrogate pair.
    const combining = 'á'; // 2 UTF-16 code units
    const emoji = '😀'; // 2 UTF-16 code units (1 grapheme)
    const block = paragraphBlock('u1', [textRun(combining + emoji, 1)]);
    const line = makeLine({
      toChar: 4,
      width: 60,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 2, width: 20 },
        { runIndex: 0, fromChar: 2, toChar: 4, width: 40 },
      ],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'u1' })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines[0].segments.map((s) => [s.fromChar, s.toChar])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(frag.lines[0].segments[1].x).toBe(20);
  });

  it('handles mixed-font segments with differing measured widths', () => {
    const block = paragraphBlock('m1', [textRun('big', 1, { fontSize: 24 }), textRun('small', 4, { fontSize: 10 })]);
    const line = makeLine({
      toRun: 1,
      toChar: 5,
      width: 95,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 3, width: 60 },
        { runIndex: 1, fromChar: 0, toChar: 5, width: 35 },
      ],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'm1', x: 0, toRun: 1 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines[0].segments[0].x).toBe(0);
    expect(frag.lines[0].segments[1].x).toBe(60);
  });

  it('emits a line for a soft line-break run without segments', () => {
    const block = paragraphBlock('b1', [textRun('x', 1), { kind: 'lineBreak', pmStart: 2, pmEnd: 3 } as Run]);
    const lines = [
      makeLine({ toChar: 1, width: 10, segments: [{ runIndex: 0, fromChar: 0, toChar: 1, width: 10 }] }),
      makeLine({ fromRun: 1, toRun: 1, width: 0, segments: [] }),
    ];
    const layout = singlePageLayout([paraFragment({ blockId: 'b1', toLine: 2 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure(lines)]).fragments[0];
    expect(frag.lines).toHaveLength(2);
    expect(frag.lines[1].segments).toEqual([]);
    expect(frag.lines[1].contentWidth).toBe(0);
  });

  it('resolves a simple RTL paragraph with mirrored, right-aligned geometry', () => {
    // Pure Hebrew, single run/segment of width 40 in a 300px fragment.
    const block = paragraphBlock('rtl1', [textRun('שלום', 1)], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({ toChar: 4, width: 40, segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 40 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtl1', x: 0, width: 300 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];

    expect(frag.diagnostics).toBeUndefined();
    const l = frag.lines[0];
    expect(l.direction).toBe('rtl');
    // RTL defaults to visual-right alignment: alignmentOffset = 300 - 40 = 260.
    expect(l.contentLeft).toBe(260);
    expect(l.contentWidth).toBe(40);
    // The single segment's logical box mirrors about the content box: its visual
    // left edge is contentLeft + contentWidth - (0 + 40) = 260.
    expect(l.segments).toEqual([{ segmentIndex: 0, runIndex: 0, fromChar: 0, toChar: 4, x: 260, width: 40 }]);
  });

  it('emits RTL segments in visual (left-to-right paint) order, mirrored', () => {
    // Two logical segments; the visual order is their reverse.
    const block = paragraphBlock('rtl2', [textRun('שלום', 1)], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({
      toChar: 4,
      width: 40,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 2, width: 20 },
        { runIndex: 0, fromChar: 2, toChar: 4, width: 20 },
      ],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtl2', x: 0, width: 300 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.diagnostics).toBeUndefined();
    // contentLeft 260, contentWidth 40. Logical seg0 [0..2] mirrors to x=280,
    // logical seg1 [2..4] mirrors to x=260; array is in visual l-to-r order.
    expect(frag.lines[0].segments).toEqual([
      { segmentIndex: 1, runIndex: 0, fromChar: 2, toChar: 4, x: 260, width: 20 },
      { segmentIndex: 0, runIndex: 0, fromChar: 0, toChar: 2, x: 280, width: 20 },
    ]);
  });

  it('keeps simple RTL with leading/trailing neutral punctuation supported', () => {
    const block = paragraphBlock('rtl3', [textRun('«שלום!»', 1)], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({ toChar: 7, width: 50, segments: [{ runIndex: 0, fromChar: 0, toChar: 7, width: 50 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtl3', x: 0, width: 300 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.diagnostics).toBeUndefined();
    expect(frag.lines[0].direction).toBe('rtl');
  });

  it('fails closed on complex mixed-bidi RTL lines with a named diagnostic', () => {
    const block = paragraphBlock('rtlmix', [textRun('שלום World', 1)], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({ toChar: 10, width: 90, segments: [{ runIndex: 0, fromChar: 0, toChar: 10, width: 90 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtlmix' })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines).toEqual([]);
    expect(frag.diagnostics).toEqual([{ code: 'unsupported-complex-bidi' }]);
    expect(frag.blockRef).toBe('rtlmix');
  });

  it('fails closed on RTL lines containing digits (weak-LTR numbers)', () => {
    const block = paragraphBlock('rtlnum', [textRun('שלום 2026', 1)], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({ toChar: 9, width: 80, segments: [{ runIndex: 0, fromChar: 0, toChar: 9, width: 80 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtlnum' })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.diagnostics).toEqual([{ code: 'unsupported-complex-bidi' }]);
  });

  it('fails closed on RTL lines containing non-ASCII Unicode numbers', () => {
    const block = paragraphBlock('rtlarabicindic', [textRun('שלום ٢٠٢٦', 1)], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({ toChar: 9, width: 80, segments: [{ runIndex: 0, fromChar: 0, toChar: 9, width: 80 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtlarabicindic' })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines).toEqual([]);
    expect(frag.diagnostics).toEqual([{ code: 'unsupported-complex-bidi' }]);
  });

  it('fails closed on a vertical writing mode with a named diagnostic', () => {
    const block = paragraphBlock('vert1', [textRun('縦書き', 1)], {
      directionContext: { writingMode: 'vertical-rl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({ toChar: 3, width: 30, segments: [{ runIndex: 0, fromChar: 0, toChar: 3, width: 30 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'vert1' })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines).toEqual([]);
    expect(frag.diagnostics).toEqual([{ code: 'unsupported-vertical-direction', writingMode: 'vertical-rl' }]);
  });

  it('fails closed on RTL list-item fragments (marker geometry not mirrored yet)', () => {
    const block = paragraphBlock('rtllist', [textRun('שלום', 1)], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({ toChar: 4, width: 40, segments: [{ runIndex: 0, fromChar: 0, toChar: 4, width: 40 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtllist', x: 0, width: 300, markerWidth: 18 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines).toEqual([]);
    expect(frag.diagnostics).toEqual([{ code: 'unsupported-direction', direction: 'rtl' }]);
  });

  it('fails closed on tab-aligned RTL lines', () => {
    const block = paragraphBlock('rtltab', [textRun('של', 1, { pmEnd: 3 }), textRun('ום', 3, { pmEnd: 5 })], {
      directionContext: { inlineDirection: 'rtl' },
    } as unknown as ParagraphAttrs);
    const line = makeLine({
      toRun: 1,
      toChar: 2,
      width: 220,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 2, width: 20 },
        { runIndex: 1, fromChar: 0, toChar: 2, width: 20, x: 200 },
      ],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'rtltab', x: 0, width: 300, toRun: 1 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines).toEqual([]);
    expect(frag.diagnostics).toEqual([{ code: 'unsupported-direction', direction: 'rtl' }]);
  });

  it('flags justified lines without an approximation diagnostic (exact painter-consistent slack)', () => {
    // "justify me" as the true (only) line of its paragraph is never stretched —
    // Word never justifies the last line of a paragraph.
    const block = paragraphBlock('j1', [textRun('justify me', 1)], { alignment: 'justify' } as ParagraphAttrs);
    const line = makeLine({
      toChar: 10,
      width: 100,
      maxWidth: 300,
      segments: [{ runIndex: 0, fromChar: 0, toChar: 10, width: 100 }],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'j1', x: 0, width: 300 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    expect(frag.lines[0].flags?.justified).toBe(true);
    // justify anchors content at the left edge (pre-justify natural widths)
    expect(frag.lines[0].contentLeft).toBe(0);
    // Last line of the paragraph: shouldApplyJustify is false, so no slack.
    expect(frag.lines[0].segments[0].x).toBe(0);
    expect(frag.lines[0].segments[0].width).toBe(100);
    expect(frag.diagnostics).toBeUndefined();
  });

  it('stretches a non-last justified line by the exact painter word-spacing slack, and leaves the true last line natural', () => {
    // "aa bb cc dd" split across two lines of one run: line 1 = "aa bb " (2
    // spaces, natural width 60 in a 100px available column -> 40px slack over 2
    // spaces = 20px/space); line 2 = "cc dd" is the true last line of the
    // paragraph, so Word never stretches it.
    const text = 'aa bb cc dd';
    const block = paragraphBlock('j2', [textRun(text, 1)], { alignment: 'justify' } as ParagraphAttrs);
    const line1 = makeLine({
      fromChar: 0,
      toChar: 6,
      width: 60,
      maxWidth: 100,
      segments: [{ runIndex: 0, fromChar: 0, toChar: 6, width: 60 }],
    });
    const line2 = makeLine({
      fromChar: 6,
      toChar: text.length,
      width: 50,
      maxWidth: 100,
      segments: [{ runIndex: 0, fromChar: 6, toChar: text.length, width: 50 }],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'j2', x: 0, width: 100, fromLine: 0, toLine: 2 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line1, line2])]).fragments[0];
    expect(frag.diagnostics).toBeUndefined();

    // Line 1 (justified, stretched): one segment covering the whole line, so
    // its stretched width fills the full available width exactly. contentWidth
    // tracks the rendered (stretched) span, not the natural 60px — consumers
    // (host hit-test) rely on this to clamp/scale a click correctly.
    expect(frag.lines[0].flags?.justified).toBe(true);
    expect(frag.lines[0].contentWidth).toBe(100);
    expect(frag.lines[0].segments[0].x).toBe(0);
    expect(frag.lines[0].segments[0].width).toBe(100);

    // Line 2 (true last line): natural, unstretched geometry.
    expect(frag.lines[1].flags?.justified).toBe(true);
    expect(frag.lines[1].contentWidth).toBe(50);
    expect(frag.lines[1].segments[0].x).toBe(0);
    expect(frag.lines[1].segments[0].width).toBe(50);
  });

  it('accumulates justify slack across multiple segments on one justified line', () => {
    // Three runs: "aa bb " (bold, 2 spaces) + "cc " (plain, 1 space) share
    // line 1 (not the true last line); "dd" alone is line 2, the true last
    // line of the paragraph (never stretched). The second segment's x on
    // line 1 must include the full slack from segment 0's two spaces, not
    // just its own single space.
    const block = paragraphBlock('j3', [textRun('aa bb ', 1, { bold: true }), textRun('cc ', 7), textRun('dd', 10)], {
      alignment: 'justify',
    } as ParagraphAttrs);
    const line1 = makeLine({
      fromRun: 0,
      fromChar: 0,
      toRun: 1,
      toChar: 3,
      width: 90,
      maxWidth: 120,
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 6, width: 60 },
        { runIndex: 1, fromChar: 0, toChar: 3, width: 30 },
      ],
    });
    const line2 = makeLine({
      fromRun: 2,
      fromChar: 0,
      toRun: 2,
      toChar: 2,
      width: 20,
      maxWidth: 120,
      segments: [{ runIndex: 2, fromChar: 0, toChar: 2, width: 20 }],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'j3', x: 0, width: 120, fromLine: 0, toLine: 2 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line1, line2])]).fragments[0];
    expect(frag.diagnostics).toBeUndefined();

    // slack = 120 - 90 = 30 over 3 spaces (2 in segment 0, 1 in segment 1) = 10px/space.
    const segments = frag.lines[0].segments;
    expect(segments[0]!.x).toBe(0);
    expect(segments[0]!.width).toBe(60 + 10 * 2); // both spaces are inside segment 0
    expect(segments[1]!.x).toBe(60 + 10 * 2); // full slack from segment 0's spaces precedes segment 1
    expect(segments[1]!.width).toBe(30 + 10 * 1); // segment 1's own space also stretches its width

    // True last line of the paragraph: natural, unstretched.
    expect(frag.lines[1].segments[0]!.x).toBe(0);
    expect(frag.lines[1].segments[0]!.width).toBe(20);
  });

  it('stretches segment width, not just x, for inter-character (no-space, e.g. CJK) justify boundaries inside a segment', () => {
    // "ABCDEF" (no spaces) is line 1, split into two segments of 3 chars each,
    // not the true last line ("X" alone is line 2). An inter-character
    // justification plan stretches after every character (boundaries 1..6).
    // Each 3-char segment straddles THREE of those boundaries internally, so
    // its width — not just its start x — must grow by their combined slack.
    const block = paragraphBlock('j4', [textRun('ABCDEF', 1), textRun('X', 7)], {
      alignment: 'justify',
    } as ParagraphAttrs);
    const line1 = makeLine({
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 6,
      width: 60,
      maxWidth: 90,
      justificationPlan: { type: 'inter-character', boundaries: [1, 2, 3, 4, 5, 6] },
      segments: [
        { runIndex: 0, fromChar: 0, toChar: 3, width: 30 },
        { runIndex: 0, fromChar: 3, toChar: 6, width: 30 },
      ],
    });
    const line2 = makeLine({
      fromRun: 1,
      fromChar: 0,
      toRun: 1,
      toChar: 1,
      width: 10,
      maxWidth: 90,
      segments: [{ runIndex: 1, fromChar: 0, toChar: 1, width: 10 }],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'j4', x: 0, width: 90, fromLine: 0, toLine: 2 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line1, line2])]).fragments[0];
    expect(frag.diagnostics).toBeUndefined();
    expect(frag.lines[0].flags?.justified).toBe(true);
    expect(frag.lines[0].contentWidth).toBe(90);

    // slack = (90 - 60) / 6 boundaries = 5px/boundary. Segment 0 (chars 0-3)
    // straddles boundaries 1,2,3 -> +15px; segment 1 (chars 3-6) straddles
    // boundaries 4,5,6 -> +15px. Each segment's OWN width grows by its share,
    // not just its start x, and the two segments still tile contiguously.
    const segments = frag.lines[0].segments;
    expect(segments[0]!.x).toBe(0);
    expect(segments[0]!.width).toBe(30 + 15);
    expect(segments[1]!.x).toBe(45);
    expect(segments[1]!.width).toBe(30 + 15);

    // True last line: natural, unstretched.
    expect(frag.lines[1].segments[0]!.x).toBe(0);
    expect(frag.lines[1].segments[0]!.width).toBe(10);
  });

  it('applies paragraph left indent to content start and segment x', () => {
    const block = paragraphBlock('ind1', [textRun('indented', 1)], { indent: { left: 40 } } as ParagraphAttrs);
    const line = makeLine({ toChar: 8, width: 70, segments: [{ runIndex: 0, fromChar: 0, toChar: 8, width: 70 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'ind1', x: 5, width: 400 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]).fragments[0];
    // contentLeft = fragment.x(5) + indent.left(40) + alignment(0)
    expect(frag.lines[0].contentLeft).toBe(45);
    expect(frag.lines[0].segments[0].x).toBe(45);
  });

  it('applies a regular paragraph hanging indent only to its first line', () => {
    const block = paragraphBlock('hanging1', [textRun('first line second line', 1)], {
      indent: { left: 48, hanging: 24 },
    } as ParagraphAttrs);
    const lines = [
      makeLine({
        toChar: 10,
        width: 80,
        segments: [{ runIndex: 0, fromChar: 0, toChar: 10, width: 80 }],
      }),
      makeLine({
        fromChar: 10,
        toChar: 22,
        width: 90,
        segments: [{ runIndex: 0, fromChar: 10, toChar: 22, width: 90 }],
      }),
    ];
    const layout = singlePageLayout([paraFragment({ blockId: 'hanging1', x: 5, width: 400, fromLine: 0, toLine: 2 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure(lines)]).fragments[0];

    expect(frag.lines.map((line) => line.contentLeft)).toEqual([29, 53]);
    expect(frag.lines.map((line) => line.segments[0].x)).toEqual([29, 53]);
  });

  it('keeps list geometry at the paragraph text start for the same hanging indent', () => {
    const block = paragraphBlock('list1', [textRun('list item', 1)], {
      indent: { left: 48, hanging: 24 },
      numberingProperties: { numId: 5, level: 0 },
    } as unknown as ParagraphAttrs);
    const line = makeLine({
      toChar: 9,
      width: 70,
      segments: [{ runIndex: 0, fromChar: 0, toChar: 9, width: 70 }],
    });
    const layout = singlePageLayout([paraFragment({ blockId: 'list1', x: 5, width: 400, markerWidth: 12 })]);

    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([line], { markerWidth: 12 })]).fragments[0];

    expect(frag.lines[0].contentLeft).toBe(53);
    expect(frag.lines[0].segments[0].x).toBe(53);
  });

  // NOTE: A word-layout list-paragraph text-start case from the source branch is
  // intentionally omitted here. Its expected first-line text-start (56px) depends
  // on the `resolveListMarkerGeometry` rework in
  // `superdoc/public/shared/common/list-marker-utils.ts`, which is explicitly out
  // of scope for the caret-placement port (the two promoted click-caret proofs use
  // plain body / header / footer / footnote targets, never list items). Porting the
  // shared list-marker change would broaden the diff beyond the approved surface.

  it('accounts for page top on a later page', () => {
    const block = paragraphBlock('p2', [textRun('second page', 1)]);
    const line = makeLine({ toChar: 11, width: 80, segments: [{ runIndex: 0, fromChar: 0, toChar: 11, width: 80 }] });
    const layout: Layout = {
      pageSize: { w: 600, h: 800 },
      pageGap: 10,
      layoutEpoch: 1,
      pages: [
        { number: 1, fragments: [] },
        { number: 2, fragments: [paraFragment({ blockId: 'p2', y: 50 })] },
      ],
    };

    const out = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])]);
    const frag = out.fragments[0];
    expect(frag.pageIndex).toBe(1);
    // pageTop = 800 + pageGap(10) = 810; top = 810 + fragment.y(50) = 860
    expect(frag.lines[0].top).toBe(860);
    expect(frag.bounds.y).toBe(860);
  });

  it('emits missing-measure when the block/measure cannot be resolved', () => {
    const block = paragraphBlock('present', [textRun('x', 1)]);
    const layout = singlePageLayout([paraFragment({ blockId: 'absent' })]);

    // blockId 'absent' has no matching block.
    const frag = collectSegmentGeometry(layout, [block], [paragraphMeasure([makeLine({})])]).fragments[0];
    expect(frag.lines).toEqual([]);
    expect(frag.diagnostics).toEqual([{ code: 'missing-measure' }]);
  });

  it('labels a non-body story when provided via options', () => {
    const block = paragraphBlock('hf1', [textRun('header', 1)]);
    const line = makeLine({ toChar: 6, width: 60, segments: [{ runIndex: 0, fromChar: 0, toChar: 6, width: 60 }] });
    const layout = singlePageLayout([paraFragment({ blockId: 'hf1' })]);

    const out = collectSegmentGeometry(layout, [block], [paragraphMeasure([line])], {
      story: { kind: 'header', id: 'rId7' },
    });
    expect(out.fragments[0].story).toEqual({ kind: 'header', id: 'rId7' });
  });

  it('fails closed on table fragments with identity + unsupported diagnostic', () => {
    const tableBlock: FlowBlock = {
      kind: 'table',
      id: 'tbl1',
      rows: [
        { id: 'r0', cells: [{ id: 'c0', paragraph: paragraphBlock('cp', [textRun('cell', 1)]) as ParagraphBlock }] },
      ],
    } as TableBlock;
    const tableMeasure: Measure = {
      kind: 'table',
      rows: [
        {
          cells: [{ width: 100, height: 20, paragraph: paragraphMeasure([makeLine({})]) as ParagraphMeasure }],
          height: 20,
        },
      ],
      columnWidths: [100],
      totalWidth: 100,
      totalHeight: 20,
    } as TableMeasure;
    const tableFragment: TableFragment = {
      kind: 'table',
      blockId: 'tbl1',
      fromRow: 0,
      toRow: 1,
      x: 12,
      y: 24,
      width: 100,
      height: 20,
    };
    const layout = singlePageLayout([tableFragment]);

    const frag = collectSegmentGeometry(layout, [tableBlock], [tableMeasure]).fragments[0];
    expect(frag.fragmentKind).toBe('table');
    expect(frag.lines).toEqual([]);
    expect(frag.blockRef).toBe('tbl1');
    expect(frag.bounds).toEqual({ x: 12, y: 24, width: 100, height: 20 });
    expect(frag.diagnostics).toEqual([{ code: 'unsupported-fragment-kind', fragmentKind: 'table' }]);
  });
});
