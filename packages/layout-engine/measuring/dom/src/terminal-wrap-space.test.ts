import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { expandRunsForInlineNewlines } from '@superdoc/contracts';
import type { FlowBlock, Measure, ParagraphMeasure, Run } from '@superdoc/contracts';
import { clearMeasurementCache, measureBlock } from './index.js';

const RUN_STYLE = { fontFamily: 'Arial', fontSize: 12 } as const;
const BOUNDARY_TEXT = 'P10 abc abc abc abc abc dddddddddd';
const AFTER_BREAK_TEXT = 'AFTER the break';

const expectParagraphMeasure = (measure: Measure): ParagraphMeasure => {
  expect(measure.kind).toBe('paragraph');
  return measure as ParagraphMeasure;
};

const paragraph = (id: string, runs: Run[]): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs,
  attrs: { alignment: 'justify' },
});

const textRun = (text: string): Run => ({ ...RUN_STYLE, text });

const lineText = (block: FlowBlock, line: ParagraphMeasure['lines'][number]): string => {
  if (block.kind !== 'paragraph') return '';
  const expandedRuns = expandRunsForInlineNewlines(block.runs);
  return (line.segments ?? [])
    .map((segment) => {
      const run = expandedRuns[segment.runIndex];
      return run && 'text' in run ? run.text.slice(segment.fromChar, segment.toChar) : '';
    })
    .join('');
};

const measureBoundaryText = async (suffix = ''): Promise<ParagraphMeasure> => {
  const block = paragraph(`boundary-width-${suffix.length}`, [textRun(`${BOUNDARY_TEXT}${suffix}`)]);
  return expectParagraphMeasure(await measureBlock(block, 10_000));
};

const measureAtTerminalSpaceOverflow = async (
  block: FlowBlock,
): Promise<{ measure: ParagraphMeasure; textWidth: number }> => {
  const textWidth = (await measureBoundaryText()).lines[0].width;
  const textAndSpaceWidth = (await measureBoundaryText(' ')).lines[0].width;
  const spaceWidth = textAndSpaceWidth - textWidth;
  expect(spaceWidth).toBeGreaterThan(1);

  const maxWidth = textWidth + spaceWidth / 2;
  return {
    measure: expectParagraphMeasure(await measureBlock(block, maxWidth)),
    textWidth,
  };
};

describe('SD-4772 terminal wrap spaces', () => {
  beforeEach(() => {
    clearMeasurementCache();
  });

  describe('line-boundary finalization', () => {
    it('does not create a space-only line before an explicit line break', async () => {
      const block = paragraph('terminal-space-before-line-break', [
        textRun(`${BOUNDARY_TEXT} `),
        { kind: 'lineBreak' },
        textRun(AFTER_BREAK_TEXT),
      ]);

      const { measure, textWidth } = await measureAtTerminalSpaceOverflow(block);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines.map((line) => lineText(block, line))).toEqual([`${BOUNDARY_TEXT} `, AFTER_BREAK_TEXT]);
      expect(measure.lines[0].width).toBeCloseTo(textWidth, 5);
    });

    it('does not create a space-only final line at paragraph end', async () => {
      const block = paragraph('terminal-space-at-paragraph-end', [textRun(`${BOUNDARY_TEXT} `)]);

      const { measure, textWidth } = await measureAtTerminalSpaceOverflow(block);

      expect(measure.lines).toHaveLength(1);
      expect(lineText(block, measure.lines[0])).toBe(`${BOUNDARY_TEXT} `);
      expect(measure.lines[0].width).toBeCloseTo(textWidth, 5);
    });

    it('does not create a space-only line before an expanded inline newline', async () => {
      const block = paragraph('terminal-space-before-inline-newline', [
        textRun(`${BOUNDARY_TEXT} \n${AFTER_BREAK_TEXT}`),
      ]);

      const { measure, textWidth } = await measureAtTerminalSpaceOverflow(block);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines.map((line) => lineText(block, line))).toEqual([`${BOUNDARY_TEXT} `, AFTER_BREAK_TEXT]);
      expect(measure.lines[0].width).toBeCloseTo(textWidth, 5);
    });
  });

  describe('run-shape invariants', () => {
    it.each([
      {
        name: 'the content run',
        runs: [textRun(`${BOUNDARY_TEXT} `)],
      },
      {
        name: 'a dedicated space run',
        runs: [textRun(BOUNDARY_TEXT), textRun(' ')],
      },
    ])('collapses a terminal space stored in $name', async ({ name, runs }) => {
      const block = paragraph(`terminal-space-in-${name.replaceAll(' ', '-')}`, [
        ...runs,
        { kind: 'lineBreak' },
        textRun(AFTER_BREAK_TEXT),
      ]);

      const { measure, textWidth } = await measureAtTerminalSpaceOverflow(block);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines[0].width).toBeCloseTo(textWidth, 5);
      expect(measure.lines[0].spaceCount).toBe(6);
    });

    it('collapses a terminal space through empty and vanished runs', async () => {
      const transparentRuns: Run[][] = [
        [textRun('')],
        [{ ...RUN_STYLE, text: 'hidden', vanish: true }],
        [textRun(''), { ...RUN_STYLE, text: 'hidden', vanish: true }],
      ];

      for (const [index, transparent] of transparentRuns.entries()) {
        const block = paragraph(`terminal-space-before-transparent-runs-${index}`, [
          textRun(`${BOUNDARY_TEXT} `),
          ...transparent,
          { kind: 'lineBreak' },
          textRun(AFTER_BREAK_TEXT),
        ]);
        const { measure, textWidth } = await measureAtTerminalSpaceOverflow(block);

        expect([index, measure.lines.length]).toEqual([index, 2]);
        expect([index, measure.lines[0].width]).toEqual([index, textWidth]);
      }
    });

    it('collapses a terminal space through transparent runs at paragraph end', async () => {
      const transparentRuns: Run[][] = [
        [textRun('')],
        [{ ...RUN_STYLE, text: 'hidden', vanish: true }],
        [textRun(''), { ...RUN_STYLE, text: 'hidden', vanish: true }],
      ];

      for (const [index, transparent] of transparentRuns.entries()) {
        const block = paragraph(`terminal-space-before-transparent-end-${index}`, [
          textRun(`${BOUNDARY_TEXT} `),
          ...transparent,
        ]);
        const { measure, textWidth } = await measureAtTerminalSpaceOverflow(block);

        expect([index, measure.lines.length]).toEqual([index, 1]);
        expect([index, measure.lines[0].width]).toEqual([index, textWidth]);
      }
    });

    it('collapses a multi-space cluster independently of run fragmentation', async () => {
      const textWidth = (await measureBoundaryText()).lines[0].width;
      const twoSpacesWidth = (await measureBoundaryText('  ')).lines[0].width;
      const spaceWidth = (twoSpacesWidth - textWidth) / 2;
      const maxWidth = textWidth + spaceWidth * 1.5;
      const tail: Run[] = [{ kind: 'lineBreak' }, textRun(AFTER_BREAK_TEXT)];
      const shapes: Record<string, FlowBlock> = {
        embedded: paragraph('terminal-cluster-embedded', [textRun(`${BOUNDARY_TEXT}   `), ...tail]),
        dedicated: paragraph('terminal-cluster-dedicated', [textRun(BOUNDARY_TEXT), textRun('   '), ...tail]),
        fragmented: paragraph('terminal-cluster-fragmented', [
          textRun(BOUNDARY_TEXT),
          textRun(' '),
          textRun(' '),
          textRun(' '),
          ...tail,
        ]),
      };

      for (const [name, block] of Object.entries(shapes)) {
        const measure = expectParagraphMeasure(await measureBlock(block, maxWidth));

        expect([name, measure.lines.length]).toEqual([name, 2]);
        expect([name, measure.lines[0].width]).toEqual([name, textWidth]);
        expect([name, measure.lines[0].spaceCount]).toEqual([name, 6]);
      }
    });
  });

  describe('source ranges', () => {
    it.each([
      { name: 'paragraph end', tail: [] as Run[], expectedLines: 1 },
      {
        name: 'line break',
        tail: [{ kind: 'lineBreak' } as Run, textRun(AFTER_BREAK_TEXT)],
        expectedLines: 2,
      },
    ])('keeps a collapsed terminal space addressable at $name', async ({ name, tail, expectedLines }) => {
      const runText = `${BOUNDARY_TEXT} `;
      const block = paragraph(`terminal-space-range-${name.replaceAll(' ', '-')}`, [textRun(runText), ...tail]);

      const { measure } = await measureAtTerminalSpaceOverflow(block);

      expect(measure.lines).toHaveLength(expectedLines);
      expect(measure.lines[0]).toMatchObject({ toRun: 0, toChar: runText.length });
      expect(lineText(block, measure.lines[0])).toBe(runText);
    });
  });

  describe('preservation controls', () => {
    it('preserves an overflowing nonterminal space for following text', async () => {
      const block = paragraph('nonterminal-space', [textRun(`${BOUNDARY_TEXT} `), textRun('more')]);

      const { measure, textWidth } = await measureAtTerminalSpaceOverflow(block);

      expect(measure.lines).toHaveLength(2);
      expect(measure.lines.map((line) => lineText(block, line))).toEqual([BOUNDARY_TEXT, ' more']);
      expect(measure.lines[0].width).toBeCloseTo(textWidth, 5);
    });

    it('preserves intentionally space-only paragraph content', async () => {
      const block = paragraph('space-only-paragraph', [textRun(' ')]);

      const measure = expectParagraphMeasure(await measureBlock(block, 1));

      expect(measure.lines).toHaveLength(1);
      expect(lineText(block, measure.lines[0])).toBe(' ');
      expect(measure.lines[0].width).toBeGreaterThan(0);
    });

    it('preserves a terminal space when it fits', async () => {
      const block = paragraph('fitting-terminal-space', [textRun(`${BOUNDARY_TEXT} `)]);
      const textWidth = (await measureBoundaryText()).lines[0].width;
      const textAndSpaceWidth = (await measureBoundaryText(' ')).lines[0].width;

      const measure = expectParagraphMeasure(await measureBlock(block, textAndSpaceWidth + 1));

      expect(measure.lines).toHaveLength(1);
      expect(lineText(block, measure.lines[0])).toBe(`${BOUNDARY_TEXT} `);
      expect(measure.lines[0].width).toBeCloseTo(textAndSpaceWidth, 5);
      expect(measure.lines[0].width).toBeGreaterThan(textWidth);
    });
  });
});
