// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { InlineBoxSpan, ParagraphBlock, ParagraphMeasure } from '@superdoc/contracts';
import { layoutDocument } from '@superdoc/layout-engine';
import { measureBlock } from '@superdoc/measuring-dom';
import { resolveCanvas } from '../../measuring/dom/src/canvas-resolver.js';
import { installNodeCanvasPolyfill } from '../../measuring/dom/src/setup.js';
import { findCharacterAtX, measureCharacterX } from '../src/text-measurement.js';
import { findLineIndexAtY } from '../src/position-hit.js';
import { renderLine } from '../../painters/dom/src/runs/render-line.js';
import type { RunRenderContext } from '../../painters/dom/src/runs/types.js';

const TEXT = 'prefix boxed words should wrap across lines suffix';
const BOX_FROM = TEXT.indexOf('boxed');
const BOX_TO = TEXT.indexOf(' suffix');

const { Canvas } = resolveCanvas();

beforeAll(() => {
  installNodeCanvasPolyfill({ document, Canvas });
});

const inlineBox = (paddingBlock = 4): InlineBoxSpan => ({
  id: 'fixture-box',
  from: BOX_FROM,
  to: BOX_TO,
  layout: {
    paddingInlineStart: 24,
    paddingInlineEnd: 28,
    paddingBlockStart: paddingBlock,
    paddingBlockEnd: paddingBlock,
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

const paragraph = (box: InlineBoxSpan | null = inlineBox()): ParagraphBlock => ({
  kind: 'paragraph',
  id: 'inline-box-fixture',
  runs: [{ text: TEXT, fontFamily: 'Arial', fontSize: 16, pmStart: 100, pmEnd: 100 + TEXT.length }],
  attrs: {},
  ...(box ? { inlineBoxes: [box] } : {}),
});

const expectParagraphMeasure = async (block: ParagraphBlock, width: number): Promise<ParagraphMeasure> => {
  const measure = await measureBlock(block, width);
  expect(measure.kind).toBe('paragraph');
  return measure as ParagraphMeasure;
};

const findDecisiveWidth = async (): Promise<number> => {
  let lastComparison = '';
  for (let width = 140; width <= 320; width += 2) {
    const [plain, boxed] = await Promise.all([
      expectParagraphMeasure(paragraph(null), width),
      expectParagraphMeasure(paragraph(), width),
    ]);
    const plainBreaks = plain.lines.map((line) => line.toChar);
    const boxedBreaks = boxed.lines.map((line) => line.toChar);
    lastComparison = `${width}: ${JSON.stringify(plainBreaks)} / ${JSON.stringify(boxedBreaks)} boxes=${boxed.lines.flatMap((line) => line.inlineBoxes ?? []).length}`;
    if (JSON.stringify(boxedBreaks) !== JSON.stringify(plainBreaks)) return width;
  }
  throw new Error(`fixture did not find a width where inline geometry changes wrapping (${lastComparison})`);
};

const makeRunContext = (): RunRenderContext => ({
  doc: document,
  layoutEpoch: 0,
  showFormattingMarks: false,
  contentControlsChrome: 'default',
  resolvePhysical: (family) => family,
  pendingTooltips: new WeakMap<HTMLElement, string>(),
  getNextLinkId: () => 'link-1',
  applySdtDataset: () => {},
  buildImageHyperlinkAnchor: (child) => child,
  resolveTrackedChangesConfig: () => ({ mode: 'final', enabled: false }),
  applyTrackedChangeDecorations: () => {},
  resolveRunSdtId: () => null,
  createInlineSdtWrapper: () => document.createElement('span'),
  syncInlineSdtWrapperTypography: () => {},
  expandSdtWrapperPmRange: () => {},
});

describe('fixture-only inline box proof', () => {
  it('wraps at the measured padded boundary and paints canonical leaves', async () => {
    const width = await findDecisiveWidth();
    const block = paragraph();
    const [plain, boxed] = await Promise.all([
      expectParagraphMeasure(paragraph(null), width),
      expectParagraphMeasure(block, width),
    ]);

    expect(boxed.lines.map((line) => line.toChar)).not.toEqual(plain.lines.map((line) => line.toChar));
    expect(boxed.lines.some((line) => line.inlineBoxes?.length)).toBe(true);

    const line = boxed.lines.find((candidate) => candidate.inlineBoxes?.length);
    expect(line).toBeDefined();
    const lineElement = renderLine({
      block,
      line: line!,
      lineIndex: boxed.lines.indexOf(line!),
      context: { pageNumber: 1, totalPages: 1, section: 'body' },
      runContext: makeRunContext(),
    });
    const styledLeaves = lineElement.querySelectorAll<HTMLElement>('[data-superdoc-inline-box-id="fixture-box"]');

    expect(styledLeaves.length).toBeGreaterThan(0);
    expect(styledLeaves[0]!.classList.contains('superdoc-text-run')).toBe(true);
    // Logical, not physical: the painter writes inline-start/end so the same
    // call is correct on an RTL line. See inline-box-rtl.test.ts.
    expect(styledLeaves[0]!.style.paddingInlineStart).toBe('24px');
    // The shorthand, because jsdom does not expand it into the longhand.
    expect(styledLeaves[0]!.style.borderInlineStart).toContain('2px');
    expect(styledLeaves[0]!.style.backgroundColor).not.toBe('');
    expect(styledLeaves[0]!.dataset.pmStart).toBeDefined();
    expect(lineElement.querySelector('[aria-hidden="true"][data-superdoc-inline-box-id]')).toBeNull();
  });

  it('moves the following paragraph when block padding expands line height', async () => {
    const width = await findDecisiveWidth();
    const noBlockPadding = paragraph(inlineBox(0));
    const withBlockPadding = paragraph(inlineBox(8));
    const below: ParagraphBlock = {
      kind: 'paragraph',
      id: 'below',
      runs: [{ text: 'below', fontFamily: 'Arial', fontSize: 16 }],
    };
    const [flatMeasure, paddedMeasure, belowMeasure] = await Promise.all([
      expectParagraphMeasure(noBlockPadding, width),
      expectParagraphMeasure(withBlockPadding, width),
      expectParagraphMeasure(below, width),
    ]);
    const options = {
      pageSize: { w: width + 40, h: 1000 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const flatLayout = layoutDocument([noBlockPadding, below], [flatMeasure, belowMeasure], options);
    const paddedLayout = layoutDocument([withBlockPadding, below], [paddedMeasure, belowMeasure], options);
    const flatBelow = flatLayout.pages[0]!.fragments.find((fragment) => fragment.blockId === 'below');
    const paddedBelow = paddedLayout.pages[0]!.fragments.find((fragment) => fragment.blockId === 'below');

    const flatBoxLine = flatMeasure.lines.find((line) => line.inlineBoxes?.length)!;
    const paddedBoxLine = paddedMeasure.lines.find((line) => line.inlineBoxes?.length)!;
    expect(paddedBoxLine.ascent).toBe(flatBoxLine.ascent);
    expect(paddedBoxLine.descent).toBe(flatBoxLine.descent);
    expect(paddedBoxLine.lineHeight).toBeGreaterThan(flatBoxLine.lineHeight);
    expect(paddedBelow!.y).toBeGreaterThan(flatBelow!.y);
  });

  it('maps clicks before, inside, and after inline padding to text boundaries', async () => {
    const width = 320;
    const block = paragraph();
    const measure = await expectParagraphMeasure(block, width);
    const startLine = measure.lines.find((candidate) => candidate.inlineBoxes?.some((box) => box.startsRange));
    const startBox = startLine?.inlineBoxes?.find((candidate) => candidate.startsRange);
    const endLine = measure.lines.find((candidate) => candidate.inlineBoxes?.some((box) => box.endsRange));
    const endBox = endLine?.inlineBoxes?.find((candidate) => candidate.endsRange);
    expect(startLine).toBeDefined();
    expect(startBox).toBeDefined();
    expect(endLine).toBeDefined();
    expect(endBox).toBeDefined();

    expect(measureCharacterX(block, startLine!, startBox!.from)).toBeCloseTo(
      startBox!.x + startBox!.style.paddingInlineStart + startBox!.style.borderWidth,
    );
    expect(measureCharacterX(block, endLine!, endBox!.to)).toBeCloseTo(
      endBox!.x + endBox!.width + endBox!.style.gapAfter,
    );

    const beforeOffset = startBox!.from - 1;
    const afterOffset = endBox!.to + 1;
    expect(
      findCharacterAtX(block, startLine!, measureCharacterX(block, startLine!, beforeOffset), 100).charOffset,
    ).toBe(beforeOffset);
    expect(findCharacterAtX(block, startLine!, startBox!.x + 1, 100).charOffset).toBe(startBox!.from);
    expect(findCharacterAtX(block, endLine!, endBox!.x + endBox!.width - 1, 100).charOffset).toBe(endBox!.to);
    expect(findCharacterAtX(block, endLine!, measureCharacterX(block, endLine!, afterOffset), 100).charOffset).toBe(
      afterOffset,
    );
  });

  it('maps vertical box padding to the nearest measured line caret', async () => {
    const measure = await expectParagraphMeasure(paragraph(), 320);
    const lineIndex = measure.lines.findIndex((candidate) => candidate.inlineBoxes?.length);
    const lineTop = measure.lines.slice(0, lineIndex).reduce((sum, line) => sum + line.lineHeight, 0);
    const boxLine = measure.lines[lineIndex]!;

    expect(findLineIndexAtY(measure.lines, lineTop + 1, 0, measure.lines.length)).toBe(lineIndex);
    expect(findLineIndexAtY(measure.lines, lineTop + boxLine.lineHeight - 1, 0, measure.lines.length)).toBe(lineIndex);
  });

  it('keeps multiple inline boxes within the measured line width', async () => {
    const first = { ...inlineBox(), id: 'first-box', from: 0, to: 6 };
    const second = { ...inlineBox(), id: 'second-box', from: 7, to: 12 };
    const block = { ...paragraph(null), inlineBoxes: [first, second] };
    const width = 320;
    const measure = await expectParagraphMeasure(block, width);

    expect(measure.lines.some((line) => line.inlineBoxes?.length)).toBe(true);
    expect(measure.lines.every((line) => line.width <= width)).toBe(true);
  });

  it('keeps box offsets immutable through drag-selection and typing coordinate probes', async () => {
    const width = await findDecisiveWidth();
    const block = paragraph();
    const originalOffsets = block.inlineBoxes!.map(({ from, to }) => ({ from, to }));
    const measure = await expectParagraphMeasure(block, width);
    const line = measure.lines.find((candidate) => candidate.inlineBoxes?.length)!;
    const box = line.inlineBoxes![0]!;

    const dragStart = findCharacterAtX(block, line, box.x + 1, 100);
    const dragEnd = findCharacterAtX(block, line, box.x + box.width - 1, 100);
    const typedBlock: ParagraphBlock = {
      ...block,
      runs: [{ ...block.runs[0]!, text: `${TEXT.slice(0, dragStart.charOffset)}X${TEXT.slice(dragStart.charOffset)}` }],
    };
    await expectParagraphMeasure(typedBlock, width);

    expect(dragStart.charOffset).toBe(box.from);
    expect(dragEnd.charOffset).toBe(box.to);
    expect(block.inlineBoxes!.map(({ from, to }) => ({ from, to }))).toEqual(originalOffsets);
    expect(typedBlock.inlineBoxes!.map(({ from, to }) => ({ from, to }))).toEqual(originalOffsets);
  });

  it('keeps paginated and semantic web flow on identical measured line breaks', async () => {
    const width = await findDecisiveWidth();
    const block = paragraph();
    const measure = await expectParagraphMeasure(block, width);
    const options = {
      pageSize: { w: width + 40, h: 1000 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const paginated = layoutDocument([block], [measure], { ...options, flowMode: 'paginated' });
    const semantic = layoutDocument([block], [measure], { ...options, flowMode: 'semantic' });
    const lineRanges = (layout: typeof paginated) =>
      layout.pages.flatMap((page) =>
        page.fragments
          .filter((fragment) => fragment.kind === 'para')
          .map((fragment) => [fragment.fromLine, fragment.toLine]),
      );

    expect(lineRanges(semantic)).toEqual(lineRanges(paginated));
    expect(measure.lines.length).toBeGreaterThan(1);
  });
});
