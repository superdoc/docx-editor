import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { FlowBlock, Line, Measure, ParagraphBlock, SectionBreakBlock } from '@superdoc/contracts';
import { clearIncrementalModuleState, incrementalLayout, type IncrementalLayoutResult } from '../src/index.js';

const CHARS_PER_LINE = 3;
const LINE_HEIGHT = 10;
const PAGE = { pageSize: { w: 100, h: 140 }, margins: { top: 20, right: 20, bottom: 20, left: 20 } };

const blockText = (block: ParagraphBlock): string =>
  block.runs.map((run) => ('text' in run && typeof run.text === 'string' ? run.text : '')).join('');

const line = (fromChar: number, toChar: number): Line => ({
  fromRun: 0,
  fromChar,
  toRun: 0,
  toChar,
  width: (toChar - fromChar) * 10,
  ascent: 8,
  descent: 2,
  lineHeight: LINE_HEIGHT,
});

const measureByText = async (block: FlowBlock): Promise<Measure> => {
  if (block.kind === 'sectionBreak') return { kind: 'sectionBreak' };
  if (block.kind !== 'paragraph') throw new Error(`unexpected block kind ${block.kind}`);
  const length = Math.max(1, blockText(block).length);
  const lines = Array.from({ length: Math.ceil(length / CHARS_PER_LINE) }, (_, index) =>
    line(index * CHARS_PER_LINE, Math.min(length, (index + 1) * CHARS_PER_LINE)),
  );
  return { kind: 'paragraph', lines, totalHeight: lines.length * LINE_HEIGHT };
};

const filler = (id: string, lineCount: number): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ kind: 'text', text: 'x'.repeat(lineCount * CHARS_PER_LINE) }],
  attrs: { widowControl: false },
});

const pageField = (id: string, cachedText: string): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ kind: 'text', text: cachedText, token: 'pageNumber' }],
  attrs: { widowControl: false },
});

const heading = (id: string, markerText: string): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ kind: 'text', text: 'H' }],
  attrs: { styleId: 'Heading1', widowControl: false, wordLayout: { marker: { markerText } } },
});

const sectionCarrierHeading = (id: string, markerText: string): ParagraphBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ kind: 'text', text: '' }],
  attrs: { styleId: 'Heading1', sectPrMarker: true, widowControl: false, wordLayout: { marker: { markerText } } },
});

const continuousTwoColumnBreak = (id: string): SectionBreakBlock => ({
  kind: 'sectionBreak',
  id,
  type: 'continuous',
  margins: {},
  columns: { count: 2, gap: 10 },
  attrs: { source: 'sectPr', sectionIndex: 0 },
});

const describePages = ({ layout, blocks }: IncrementalLayoutResult): string => {
  const textById = new Map(
    blocks.flatMap((block) => (block.kind === 'paragraph' ? [[block.id, blockText(block)]] : [])),
  );
  return layout.pages
    .map((page) => {
      const fragments = page.fragments.map((fragment) => {
        const lines = fragment.kind === 'para' ? ` lines ${fragment.fromLine}-${fragment.toLine}` : '';
        const text = fragment.blockId.startsWith('page-field') ? ` text "${textById.get(fragment.blockId)}"` : '';
        return `  ${fragment.blockId}${lines} at x ${fragment.x}, y ${fragment.y}${text}`;
      });
      return [`page ${page.number}`, ...fragments].join('\n');
    })
    .join('\n');
};

describe('page token convergence', () => {
  beforeEach(() => {
    clearIncrementalModuleState();
  });

  it('keeps resolving until every PAGE field shows the page it finally lands on', async () => {
    const result = await incrementalLayout(
      [],
      null,
      [
        filler('filler-1', 7),
        pageField('page-field-1', '0000000'),
        pageField('page-field-2', '0'),
        filler('filler-2', 9),
      ],
      PAGE,
      measureByText,
    );

    expect(result.layout.pages).toHaveLength(2);
    await expect(`${describePages(result)}\n`).toMatchFileSnapshot(
      './__snapshots__/pageTokenConvergence/field-moves-to-earlier-page.txt',
    );
  });

  it('recomputes the chapter of a page when a heading moves onto it between passes', async () => {
    const result = await incrementalLayout(
      [],
      null,
      [
        heading('heading-1', '1.'),
        filler('filler-a', 6),
        pageField('page-field-1', '0000000'),
        filler('filler-b', 8),
        pageField('page-field-2', '0'),
        filler('filler-c', 1),
        heading('heading-2', '2.'),
        filler('filler-d', 9),
      ],
      { ...PAGE, sectionMetadata: [{ sectionIndex: 0, numbering: { chapterStyle: 1 } }] },
      measureByText,
    );

    await expect(`${describePages(result)}\n`).toMatchFileSnapshot(
      './__snapshots__/pageTokenConvergence/heading-moves-onto-field-page.txt',
    );
  });

  it('recomputes the chapter when a heading appears mid-page without changing the page boundary fragments', async () => {
    const result = await incrementalLayout(
      [],
      null,
      [
        heading('heading-1', '1.'),
        filler('filler-a', 6),
        pageField('page-field-1', '0000000'),
        pageField('page-field-2', ''),
        sectionCarrierHeading('heading-2', '2.'),
        continuousTwoColumnBreak('section-1'),
        filler('filler-tail', 1),
      ],
      {
        pageSize: { w: 100, h: 100 },
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        columns: { count: 2, gap: 10 },
        sectionMetadata: [{ sectionIndex: 0, numbering: { chapterStyle: 1 } }],
      },
      measureByText,
    );

    await expect(`${describePages(result)}\n`).toMatchFileSnapshot(
      './__snapshots__/pageTokenConvergence/heading-appears-mid-page.txt',
    );
  });
});
