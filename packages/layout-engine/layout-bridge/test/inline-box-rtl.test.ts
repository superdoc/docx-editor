// @vitest-environment jsdom
/*
 * Layout-aware inline boxes in a right-to-left paragraph.
 *
 * Measurement used to drop every box whose paragraph declared
 * `inlineDirection: 'rtl'`, or whose runs carried `w:rtl`, because the DOM
 * painter wrote physical left/right edges and could not render such a line.
 * Both sides are direction-agnostic now, and these tests pin that: an RTL
 * paragraph must measure exactly like the same paragraph in LTR, because a box
 * advance is a width and a width does not depend on direction.
 *
 * The fixture is the one `inline-box-poc.test.ts` already relies on, so the LTR
 * side of every comparison is the behaviour this package already guarantees.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { InlineBoxSpan, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { measureBlock } from '@superdoc/measuring-dom';
import { resolveCanvas } from '../../measuring/dom/src/canvas-resolver.js';
import { installNodeCanvasPolyfill } from '../../measuring/dom/src/setup.js';

const TEXT = 'prefix boxed words should wrap across lines suffix';
/* Hebrew, same shape: a boxed phrase in the middle of text that must wrap. */
const HEBREW = 'פתיחה מוקפת מילים אמורות להישבר על פני שורות סיום';

/* Widths sampled where a test only needs "the same at any width", not a break. */
const SAMPLE_WIDTHS = [140, 200, 260, 320] as const;

const { Canvas } = resolveCanvas();

beforeAll(() => {
  installNodeCanvasPolyfill({ document, Canvas });
});

const inlineBox = (from: number, to: number): InlineBoxSpan => ({
  id: 'fixture-box',
  from,
  to,
  layout: {
    paddingInlineStart: 24,
    paddingInlineEnd: 28,
    paddingBlockStart: 4,
    paddingBlockEnd: 4,
    gapBefore: 3,
    gapAfter: 5,
    borderWidth: 2,
  },
  appearance: {
    backgroundColor: '#fff2a8',
    borderColor: '#7c5c00',
    borderStyle: 'solid',
    borderRadius: 6,
    color: '#302400',
  },
});

const boxSpanningMiddleWords = (text: string): InlineBoxSpan => inlineBox(text.indexOf(' ') + 1, text.lastIndexOf(' '));

type Direction = { rtlParagraph?: boolean; rtlRun?: boolean };

const paragraph = (text: string, direction: Direction, boxed: boolean): ParagraphBlock => ({
  kind: 'paragraph',
  id: 'inline-box-rtl-fixture',
  runs: [
    {
      text,
      fontFamily: 'Arial',
      fontSize: 16,
      pmStart: 100,
      pmEnd: 100 + text.length,
      ...(direction.rtlRun ? { bidi: { rtl: true } } : {}),
    },
  ],
  attrs: direction.rtlParagraph
    ? { directionContext: { inlineDirection: 'rtl' as const, writingMode: 'horizontal-tb' as const } }
    : {},
  ...(boxed ? { inlineBoxes: [boxSpanningMiddleWords(text)] } : {}),
});

const measure = async (block: ParagraphBlock, width: number): Promise<ParagraphMeasure> =>
  (await measureBlock(block, width)) as ParagraphMeasure;

const breaks = (measured: ParagraphMeasure): number[] => measured.lines.map((line) => line.toChar);
const boxCount = (measured: ParagraphMeasure): number =>
  measured.lines.reduce((total, line) => total + (line.inlineBoxes?.length ?? 0), 0);

/**
 * The width at which the box's inline chrome actually pushes a break.
 *
 * Modelled on `findDecisiveWidth` in `inline-box-poc.test.ts`, and for the same
 * reason: whether any single width is decisive depends on the resolved Arial
 * metrics, so asserting at a hardcoded one would pin a font metric rather than
 * the behaviour. Searching states the intent — *some* width must be decisive —
 * and fails with the full comparison when none is.
 */
const decisiveWidth = async (text: string, direction: Direction): Promise<number> => {
  const seen: string[] = [];
  for (let width = 140; width <= 320; width += 2) {
    const [plain, boxed] = await Promise.all([
      measure(paragraph(text, direction, false), width),
      measure(paragraph(text, direction, true), width),
    ]);
    if (JSON.stringify(breaks(boxed)) !== JSON.stringify(breaks(plain))) return width;
    seen.push(`${width}: ${JSON.stringify(breaks(plain))} boxes=${boxCount(boxed)}`);
  }
  throw new Error(`no width in 140..320 where the box changes wrapping\n${seen.join('\n')}`);
};

describe('inline boxes in an RTL paragraph', () => {
  it('projects boxes onto lines when the paragraph declares RTL', async () => {
    const measured = await measure(paragraph(TEXT, { rtlParagraph: true }, true), 140);
    expect(boxCount(measured)).toBeGreaterThan(0);
  });

  it('projects boxes when a run carries w:rtl', async () => {
    const measured = await measure(paragraph(TEXT, { rtlRun: true }, true), 140);
    expect(boxCount(measured)).toBeGreaterThan(0);
  });

  it('measures identically to the same paragraph in LTR, at every sampled width', async () => {
    // The precise claim, and the reason no direction clause belongs in the
    // measurement filter: same glyphs, same widths, therefore same breaks.
    for (const width of SAMPLE_WIDTHS) {
      const [ltr, rtlParagraph, rtlRun] = await Promise.all([
        measure(paragraph(TEXT, {}, true), width),
        measure(paragraph(TEXT, { rtlParagraph: true }, true), width),
        measure(paragraph(TEXT, { rtlRun: true }, true), width),
      ]);

      expect({ width, breaks: breaks(rtlParagraph) }).toEqual({ width, breaks: breaks(ltr) });
      expect({ width, breaks: breaks(rtlRun) }).toEqual({ width, breaks: breaks(ltr) });
      expect({ width, boxes: boxCount(rtlParagraph) }).toEqual({ width, boxes: boxCount(ltr) });
      expect({ width, boxes: boxCount(rtlRun) }).toEqual({ width, boxes: boxCount(ltr) });
    }
  });

  it('changes where an RTL paragraph wraps, which is the point of the tier', async () => {
    // Projection alone would be inert. What makes these boxes layout-aware is
    // that their advances enter the line budget. `decisiveWidth` throwing is
    // itself the failure: it means no width in the range was affected.
    const width = await decisiveWidth(TEXT, { rtlParagraph: true });
    const [plain, boxed] = await Promise.all([
      measure(paragraph(TEXT, { rtlParagraph: true }, false), width),
      measure(paragraph(TEXT, { rtlParagraph: true }, true), width),
    ]);

    expect(breaks(boxed)).not.toEqual(breaks(plain));
    expect(boxCount(boxed)).toBeGreaterThan(0);
  });

  it('works on Hebrew text that declares its direction', async () => {
    /*
     * Hebrew without a direction declaration already worked before this change,
     * which is what showed the gate was the flag and not the script. Every real
     * Word document declares it: `w:bidi` on the paragraph, `w:rtl` on the runs.
     */
    const direction = { rtlParagraph: true, rtlRun: true };
    const width = await decisiveWidth(HEBREW, direction);
    const [plain, boxed] = await Promise.all([
      measure(paragraph(HEBREW, direction, false), width),
      measure(paragraph(HEBREW, direction, true), width),
    ]);

    expect(boxCount(boxed)).toBeGreaterThan(0);
    expect(breaks(boxed)).not.toEqual(breaks(plain));
  });
});

describe('a box straddling a direction change', () => {
  /*
   * The limitation this PR deliberately does not fix: a logical `[from, to)`
   * range that crosses a direction change maps to more than one visual segment,
   * and the painter's first/last-leaf edges cannot express that.
   *
   * This test exists to pin *where* that limitation already lived. The clause
   * removed from the measurement filter read `block.runs.every((run) =>
   * run.bidi?.rtl !== true)` — it keyed on the **declaration**, not on the
   * script. Hebrew that declares nothing was never filtered, and the Unicode
   * Bidi Algorithm reorders it into an RTL visual run regardless, so a box
   * straddling that boundary reached the painter before this change and reaches
   * it after. Restoring the old clause does not make this test fail.
   */
  const MIXED_PREFIX = 'prefix ';
  const MIXED_HEBREW = 'שלום עולם';
  const MIXED_SUFFIX = ' suffix here';

  const mixedParagraph = (declareRtl: boolean, boxed: boolean): ParagraphBlock => ({
    kind: 'paragraph',
    id: 'mixed-bidi-fixture',
    attrs: {},
    runs: [
      { text: MIXED_PREFIX, fontFamily: 'Arial', fontSize: 16, pmStart: 100, pmEnd: 107 },
      {
        text: MIXED_HEBREW,
        fontFamily: 'Arial',
        fontSize: 16,
        pmStart: 107,
        pmEnd: 116,
        ...(declareRtl ? { bidi: { rtl: true } } : {}),
      },
      { text: MIXED_SUFFIX, fontFamily: 'Arial', fontSize: 16, pmStart: 116, pmEnd: 128 },
    ],
    /* from=3 is inside the Latin run, to=11 is inside the Hebrew one. */
    ...(boxed ? { inlineBoxes: [inlineBox(3, 11)] } : {}),
  });

  it('is already reachable when the Hebrew declares no direction', async () => {
    const measured = await measure(mixedParagraph(false, true), 200);
    expect(boxCount(measured)).toBeGreaterThan(0);
  });

  it('is reachable when the Hebrew declares w:rtl, exactly as when it does not', async () => {
    // Parity, which is what this PR chose over a narrower gate. A guard keyed on
    // the declaration would catch this case and miss the one above — the same
    // defect, undeclared — so it would buy consistency, not correctness.
    const [declared, undeclared] = await Promise.all([
      measure(mixedParagraph(true, true), 200),
      measure(mixedParagraph(false, true), 200),
    ]);

    expect(boxCount(declared)).toBe(boxCount(undeclared));
  });
});
