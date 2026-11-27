import { describe, expect, it } from 'vite-plus/test';
import { layoutDocument } from '@superdoc/layout-engine';
import type { FlowBlock, Layout, Measure, ParagraphBlock, SectionBreakBlock } from '@superdoc/contracts';

const LINE_HEIGHT = 20;
const LETTER = { w: 816, h: 1056 };
const LETTER_LANDSCAPE = { w: 1056, h: 816 };
const LEGAL = { w: 816, h: 1344 };
const SMALL = { w: 480, h: 288 };
const MARGINS_1IN = { top: 96, right: 96, bottom: 96, left: 96, header: 48, footer: 48 };
const MARGINS_HALF_IN = { top: 48, right: 48, bottom: 48, left: 48, header: 24, footer: 24 };

type SectionProps = Omit<SectionBreakBlock, 'kind' | 'id' | 'margins'> & { margins?: SectionBreakBlock['margins'] };

let sectionCount = 0;

const section = (props: SectionProps): SectionBreakBlock => {
  const sectionIndex = sectionCount++;
  return {
    kind: 'sectionBreak',
    id: `section-${sectionIndex}`,
    margins: MARGINS_1IN,
    ...props,
    attrs: { source: 'sectPr', sectionIndex, ...(sectionIndex === 0 ? { isFirstSection: true } : {}), ...props.attrs },
  };
};

const smallSection = (props: SectionProps): SectionBreakBlock =>
  section({ pageSize: SMALL, orientation: 'landscape', margins: MARGINS_HALF_IN, ...props });

const paragraph = (text: string): ParagraphBlock => ({
  kind: 'paragraph',
  id: text,
  runs: [{ kind: 'text', text, fontFamily: 'Arial', fontSize: 12 }],
});

const paragraphs = (prefix: string, count: number): ParagraphBlock[] =>
  Array.from({ length: count }, (_, index) => paragraph(`${prefix}${index + 1}`));

const measureOneLine = (block: FlowBlock): Measure => {
  if (block.kind === 'sectionBreak') return { kind: 'sectionBreak' };
  return {
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 0,
        width: 100,
        ascent: LINE_HEIGHT * 0.8,
        descent: LINE_HEIGHT * 0.2,
        lineHeight: LINE_HEIGHT,
      },
    ],
    totalHeight: LINE_HEIGHT,
  };
};

const formatRecord = (value: object | undefined): string => {
  if (value === undefined) return '-';
  return Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .map(
      ([key, entry]) =>
        `${key}=${typeof entry === 'object' && entry !== null ? `{${formatRecord(entry)}}` : String(entry)}`,
    )
    .join(' ');
};

const describeLayout = (layout: Layout): string => {
  const lines: string[] = [];
  for (const page of layout.pages) {
    lines.push(
      [
        `page ${page.number}`,
        `size=${page.size ? `${page.size.w}x${page.size.h}` : '-'}`,
        `orientation=${page.orientation ?? '-'}`,
        `margins={${formatRecord(page.margins)}}`,
        `vAlign=${page.vAlign ?? '-'}`,
        `baseMargins={${formatRecord(page.baseMargins)}}`,
        `sectionIndex=${String(page.sectionIndex ?? '-')}`,
        `sectionRefs={${formatRecord(page.sectionRefs)}}`,
      ].join(' '),
    );
    for (const fragment of page.fragments) {
      lines.push(`  "${fragment.blockId}" x=${fragment.x} y=${fragment.y}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

const SCENARIOS: ReadonlyArray<{ name: string; blocks: () => FlowBlock[] }> = [
  {
    name: 'next-page-orientation-and-size',
    blocks: () => [
      section({ type: 'continuous', pageSize: LETTER, orientation: 'portrait' }),
      ...paragraphs('Letter ', 2),
      section({ type: 'nextPage', pageSize: LETTER_LANDSCAPE, orientation: 'landscape' }),
      paragraph('Landscape 1'),
      section({ type: 'nextPage', pageSize: LEGAL, orientation: 'portrait' }),
      paragraph('Legal 1'),
    ],
  },
  {
    name: 'continuous-same-geometry',
    blocks: () => [
      section({ type: 'continuous', pageSize: LETTER, orientation: 'portrait' }),
      paragraph('First 1'),
      section({ type: 'continuous', pageSize: LETTER, orientation: 'portrait' }),
      paragraph('Second 1'),
    ],
  },
  {
    name: 'continuous-orientation-change',
    blocks: () => [
      section({ type: 'continuous', pageSize: LETTER, orientation: 'portrait' }),
      paragraph('Portrait 1'),
      section({ type: 'continuous', pageSize: LETTER_LANDSCAPE, orientation: 'landscape' }),
      paragraph('Landscape 1'),
    ],
  },
  {
    name: 'continuous-orientation-change-requiring-page-boundary',
    blocks: () => [
      section({ type: 'continuous', pageSize: LETTER, orientation: 'portrait' }),
      paragraph('Portrait 1'),
      section({
        type: 'continuous',
        pageSize: LETTER_LANDSCAPE,
        orientation: 'landscape',
        attrs: { requirePageBoundary: true },
      }),
      paragraph('Landscape 1'),
    ],
  },
  {
    name: 'odd-and-even-page',
    blocks: () => [
      section({ type: 'continuous', pageSize: LETTER }),
      paragraph('Page one'),
      section({ type: 'oddPage', pageSize: LETTER }),
      paragraph('Odd section'),
      section({ type: 'evenPage', pageSize: LETTER }),
      paragraph('Even section'),
      section({ type: 'evenPage', pageSize: LETTER }),
      paragraph('Last even section'),
    ],
  },
  {
    name: 'only-a-section-break',
    blocks: () => [section({ type: 'nextPage', pageSize: LETTER_LANDSCAPE, orientation: 'landscape' })],
  },
  {
    name: 'columns-continuous',
    blocks: () => [
      smallSection({ type: 'continuous' }),
      ...paragraphs('Single ', 2),
      smallSection({ type: 'continuous', columns: { count: 2, gap: 48 } }),
      ...paragraphs('Two-column ', 6),
      smallSection({ type: 'continuous' }),
      paragraph('Single again'),
    ],
  },
  {
    name: 'columns-next-page-gap-change',
    blocks: () => [
      smallSection({ type: 'continuous', columns: { count: 2, gap: 48 } }),
      ...paragraphs('Two ', 10),
      smallSection({ type: 'nextPage', columns: { count: 3, gap: 24 } }),
      ...paragraphs('Three ', 10),
    ],
  },
  {
    name: 'column-reduction-after-overflow',
    blocks: () => [
      smallSection({ type: 'continuous', columns: { count: 3, gap: 24 } }),
      ...paragraphs('Three ', 30),
      smallSection({ type: 'continuous', columns: { count: 2, gap: 24 } }),
      ...paragraphs('Two ', 2),
    ],
  },
  {
    name: 'column-reduction-from-first-column',
    blocks: () => [
      smallSection({ type: 'continuous', columns: { count: 3, gap: 24 } }),
      ...paragraphs('Three ', 2),
      smallSection({ type: 'continuous', columns: { count: 2, gap: 24 } }),
      paragraph('Two 1'),
    ],
  },
  {
    name: 'column-reduction-four-to-one',
    blocks: () => [
      smallSection({ type: 'continuous', columns: { count: 4, gap: 16 } }),
      ...paragraphs('Four ', 12),
      smallSection({ type: 'continuous' }),
      paragraph('One 1'),
    ],
  },
  {
    name: 'rtl-columns',
    blocks: () => [
      smallSection({ type: 'continuous', columns: { count: 2, gap: 48, direction: 'rtl' } }),
      ...paragraphs('P', 12),
    ],
  },
  {
    name: 'rtl-continuous-after-ltr',
    blocks: () => [
      smallSection({ type: 'continuous', columns: { count: 2, gap: 48 } }),
      paragraph('LTR'),
      smallSection({ type: 'continuous', columns: { count: 2, gap: 48, direction: 'rtl' } }),
      paragraph('RTL'),
    ],
  },
  {
    name: 'rtl-balanced-before-continuous-break',
    blocks: () => [
      smallSection({ type: 'continuous', columns: { count: 2, gap: 48, direction: 'rtl' } }),
      ...paragraphs('P', 8),
      smallSection({ type: 'continuous' }),
      paragraph('Tail'),
    ],
  },
  {
    name: 'vertical-alignment',
    blocks: () => [
      section({ type: 'continuous', pageSize: LETTER, vAlign: 'center' }),
      ...paragraphs('Centered ', 2),
      section({ type: 'nextPage', pageSize: LETTER, vAlign: 'bottom' }),
      paragraph('Bottom'),
      section({ type: 'nextPage', pageSize: LETTER, vAlign: 'both' }),
      paragraph('Both'),
      section({ type: 'nextPage', pageSize: LETTER }),
      paragraph('Top'),
    ],
  },
  {
    name: 'header-footer-refs',
    blocks: () => [
      smallSection({ type: 'continuous', headerRefs: { default: 'header-1' }, footerRefs: { default: 'footer-1' } }),
      paragraph('Both refs'),
      smallSection({ type: 'nextPage', headerRefs: { default: 'header-2' } }),
      paragraph('Header only'),
      smallSection({ type: 'nextPage', footerRefs: { first: 'footer-first', even: 'footer-even' } }),
      paragraph('Footer variants'),
      smallSection({ type: 'nextPage', headerRefs: {}, footerRefs: {} }),
      paragraph('Empty refs'),
      smallSection({ type: 'continuous', headerRefs: { default: 'header-3' } }),
      ...paragraphs('Continuous header ', 9),
    ],
  },
];

describe('layoutDocument section breaks', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      sectionCount = 0;
      const blocks = scenario.blocks();
      const layout = layoutDocument(blocks, blocks.map(measureOneLine), { pageSize: LETTER, margins: MARGINS_1IN });
      await expect(describeLayout(layout)).toMatchFileSnapshot(
        `./__snapshots__/section-breaks-layout/${scenario.name}.txt`,
      );
    });
  }
});
