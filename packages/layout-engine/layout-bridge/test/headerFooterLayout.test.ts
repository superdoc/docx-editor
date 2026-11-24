import { describe, expect, it, vi } from 'vite-plus/test';
import type { FlowBlock, Measure } from '@superdoc/contracts';
import { layoutHeaderFooterWithCache, HeaderFooterLayoutCache } from '../src/layoutHeaderFooter';

const makeBlock = (id: string, text = 'Hello'): FlowBlock => ({
  kind: 'paragraph',
  id,
  runs: [{ text, fontFamily: 'Arial', fontSize: 16 }],
});

const makeMeasure = (height: number): Measure => ({
  kind: 'paragraph',
  lines: [
    {
      fromRun: 0,
      fromChar: 0,
      toRun: 0,
      toChar: 1,
      width: 100,
      ascent: height * 0.8,
      descent: height * 0.2,
      lineHeight: height,
    },
  ],
  totalHeight: height,
});

describe('layoutHeaderFooterWithCache', () => {
  it('measures and lays out each section variant', async () => {
    const sections = {
      default: [makeBlock('a')],
      first: [makeBlock('b')],
    };

    const measureBlock = vi.fn(async () => makeMeasure(20));
    const result = await layoutHeaderFooterWithCache(sections, { width: 400, height: 80 }, measureBlock);

    expect(measureBlock).toHaveBeenCalledTimes(2);
    expect(result.default?.layout.pages[0].fragments).toHaveLength(1);
    expect(result.first?.layout.height).toBeGreaterThan(0);
  });

  it('caches measurements across runs', async () => {
    const cache = new HeaderFooterLayoutCache();
    const sections = { default: [makeBlock('a')] };
    const measureBlock = vi.fn(async () => makeMeasure(10));

    await layoutHeaderFooterWithCache(sections, { width: 300, height: 40 }, measureBlock, cache);
    await layoutHeaderFooterWithCache(sections, { width: 300, height: 40 }, measureBlock, cache);

    expect(measureBlock).toHaveBeenCalledTimes(1);
  });

  it('returns no layouts when the body layout has zero pages', async () => {
    const sections = {
      default: [
        {
          kind: 'paragraph',
          id: 'page-token-footer',
          runs: [
            { text: 'Page ', fontFamily: 'Arial', fontSize: 16 },
            { text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 16 },
          ],
        } satisfies FlowBlock,
      ],
    };
    const measureBlock = vi.fn(async () => makeMeasure(12));

    const result = await layoutHeaderFooterWithCache(
      sections,
      { width: 300, height: 40 },
      measureBlock,
      undefined,
      undefined,
      () => ({ displayText: '1', totalPages: 0 }),
      'footer',
    );

    expect(result).toEqual({});
    expect(measureBlock).not.toHaveBeenCalled();
  });

  it('stores page-local block clones for tokenized header/footer pages', async () => {
    const sections = {
      default: [
        {
          kind: 'paragraph',
          id: 'page-token-header',
          runs: [
            { text: 'Page ', fontFamily: 'Arial', fontSize: 16 },
            { text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 16 },
          ],
        } satisfies FlowBlock,
      ],
    };
    const measureBlock = vi.fn(async () => makeMeasure(12));

    const result = await layoutHeaderFooterWithCache(
      sections,
      { width: 300, height: 40 },
      measureBlock,
      undefined,
      undefined,
      (pageNumber) => ({ displayText: String(pageNumber), totalPages: 2 }),
      'header',
    );

    expect(result.default?.layout.pages).toHaveLength(2);
    expect(result.default?.layout.pages[0].blocks?.[0].runs[1]?.text).toBe('1');
    expect(result.default?.layout.pages[1].blocks?.[0].runs[1]?.text).toBe('2');
    expect(result.default?.layout.pages[0].measures).toHaveLength(1);
    expect(result.default?.layout.pages[1].measures).toHaveLength(1);
  });

  it('checks the cooperative execution budget while preparing page-local furniture', async () => {
    const sections = {
      default: [
        {
          kind: 'paragraph',
          id: 'cooperative-page-token-header',
          runs: [
            { text: 'Page ', fontFamily: 'Arial', fontSize: 16 },
            { text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 16 },
          ],
        } satisfies FlowBlock,
      ],
    };
    const measureBlock = vi.fn(async () => makeMeasure(12));
    const checkpointIfDue = vi.fn<() => Promise<void> | null>(() => null);

    const result = await layoutHeaderFooterWithCache(
      sections,
      { width: 300, height: 40 },
      measureBlock,
      new HeaderFooterLayoutCache(),
      undefined,
      (pageNumber) => ({ displayText: String(pageNumber), totalPages: 12 }),
      'header',
      '',
      undefined,
      undefined,
      { checkpointIfDue },
    );

    expect(result.default?.layout.pages).toHaveLength(12);
    expect(checkpointIfDue.mock.calls.length).toBeGreaterThanOrEqual(12);
  });

  it('lays out only the requested missing PAGE contexts', async () => {
    const sections = {
      default: [
        {
          kind: 'paragraph',
          id: 'retained-page-token-footer',
          runs: [
            { text: 'Page ', fontFamily: 'Arial', fontSize: 16 },
            { text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 16 },
          ],
        } satisfies FlowBlock,
      ],
    };
    const measureBlock = vi.fn(async () => makeMeasure(12));

    const result = await layoutHeaderFooterWithCache(
      sections,
      { width: 300, height: 40 },
      measureBlock,
      new HeaderFooterLayoutCache(),
      undefined,
      (pageNumber) => ({ displayText: String(pageNumber), totalPages: 5 }),
      'footer',
      '',
      undefined,
      undefined,
      { pageNumbers: [3] },
    );

    expect(measureBlock).toHaveBeenCalledTimes(1);
    expect(result.default?.layout.pages.map((page) => page.number)).toEqual([3]);
    expect(result.default?.layout.pages[0].blocks?.[0].runs[1]?.text).toBe('3');
  });

  it.each([
    ['duplicate', [2, 2]],
    ['out-of-range', [0]],
  ])('rejects a %s retained PAGE context set', async (_label, pageNumbers) => {
    const sections = {
      default: [
        {
          kind: 'paragraph',
          id: 'invalid-retained-page-token-footer',
          runs: [{ text: '0', token: 'pageNumber', fontFamily: 'Arial', fontSize: 16 }],
        } satisfies FlowBlock,
      ],
    };

    await expect(
      layoutHeaderFooterWithCache(
        sections,
        { width: 300, height: 40 },
        async () => makeMeasure(12),
        new HeaderFooterLayoutCache(),
        undefined,
        (pageNumber) => ({ displayText: String(pageNumber), totalPages: 5 }),
        'footer',
        '',
        undefined,
        undefined,
        { pageNumbers },
      ),
    ).rejects.toThrow('header/footer retained PAGE extension received an invalid physical-page set');
  });

  it('uses the largest page-specific metrics when section page counts change layout height', async () => {
    const sections = {
      default: [
        {
          kind: 'paragraph',
          id: 'section-pages-footer',
          runs: [
            { text: 'Section pages ', fontFamily: 'Arial', fontSize: 16 },
            { text: '0', token: 'sectionPageCount', fontFamily: 'Arial', fontSize: 16 },
          ],
        } satisfies FlowBlock,
      ],
    };
    const measureBlock = vi.fn(async (block: FlowBlock) => {
      const sectionPageText = block.kind === 'paragraph' ? block.runs[1]?.text : undefined;
      return makeMeasure(sectionPageText === '100' ? 36 : 12);
    });

    const result = await layoutHeaderFooterWithCache(
      sections,
      { width: 300, height: 80 },
      measureBlock,
      undefined,
      undefined,
      (pageNumber) => ({
        displayText: String(pageNumber),
        totalPages: 2,
        sectionPageCount: pageNumber === 1 ? 1 : 100,
      }),
      'footer',
    );

    expect(result.default?.layout.pages).toHaveLength(2);
    expect(result.default?.layout.pages[0].measures?.[0]?.totalHeight).toBe(12);
    expect(result.default?.layout.pages[1].measures?.[0]?.totalHeight).toBe(36);
    expect(result.default?.layout.height).toBe(36);
    expect(result.default?.layout.renderHeight).toBe(36);
  });

  describe('integration test', () => {
    it('lays out a header with page tokens and keeps the tokens for the painter', async () => {
      const headerBlock: FlowBlock = {
        kind: 'paragraph',
        id: 'header-default-0-paragraph',
        runs: [
          { kind: 'text', text: 'Page ', fontFamily: 'Arial', fontSize: 12 },
          { kind: 'text', text: '0', fontFamily: 'Arial', fontSize: 12, token: 'pageNumber' },
          { kind: 'text', text: ' of ', fontFamily: 'Arial', fontSize: 12 },
          { kind: 'text', text: '0', fontFamily: 'Arial', fontSize: 12, token: 'totalPageCount' },
        ],
      };

      const headerMeasure: Measure = {
        kind: 'paragraph',
        lines: [
          {
            fromRun: 0,
            fromChar: 0,
            toRun: 3,
            toChar: 1,
            width: 150,
            ascent: 12,
            descent: 4,
            lineHeight: 20,
          },
        ],
        totalHeight: 20,
      };

      const measureFn = vi.fn(async (block: FlowBlock): Promise<Measure> => {
        if (block.id === headerBlock.id) return headerMeasure;
        throw new Error(`No measure for block ${block.id}`);
      });

      const result = await layoutHeaderFooterWithCache(
        { default: [headerBlock] },
        { width: 400, height: 50 },
        measureFn,
      );

      expect(result.default).toBeDefined();
      expect(result.default?.layout.pages).toHaveLength(1);
      expect(result.default?.layout.pages[0].fragments).toHaveLength(1);
      expect(result.default?.layout.height).toBeGreaterThan(0);
      expect(result.default?.layout.height).toBeLessThanOrEqual(50);

      expect(result.default?.blocks).toHaveLength(1);
      expect(result.default?.measures).toHaveLength(1);
      expect(result.default?.blocks[0].id).toBe('header-default-0-paragraph');

      const firstBlock = result.default?.blocks[0];
      expect(firstBlock?.runs.some((run) => run.token === 'pageNumber')).toBe(true);
      expect(firstBlock?.runs.some((run) => run.token === 'totalPageCount')).toBe(true);
      expect(firstBlock?.runs[1]?.text).toBe('1');
      expect(firstBlock?.runs[3]?.text).toBe('1');
    });
  });
});
