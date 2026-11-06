import { describe, expect, it } from 'bun:test';
import type { FlowBlock, Fragment, Measure } from '@superdoc/contracts';
import { normalizeFragmentsForRegion } from './normalize-header-footer-fragments.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParaFragment(blockId: string, y: number): Fragment {
  return { kind: 'para', blockId, x: 0, y, fromLine: 0, toLine: 1 } as Fragment;
}

function makeAnchoredImageFragment(blockId: string, y: number, height: number): Fragment {
  return { kind: 'image', blockId, x: 0, y, height, isAnchored: true } as unknown as Fragment;
}

function makeTableFragment(
  blockId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  isAnchored?: boolean,
): Fragment {
  return { kind: 'table', blockId, x, y, width, height, fromRow: 0, toRow: 1, isAnchored } as Fragment;
}

function makeDummyMeasure(): Measure {
  return { kind: 'paragraph', lines: [], totalHeight: 0 } as Measure;
}

const PAGE_HEIGHT = 1056;
const MARGIN_BOTTOM = 72;
const FOOTER_DISTANCE = 36;

const fullConstraints = {
  width: 672,
  pageWidth: 816,
  pageHeight: PAGE_HEIGHT,
  margins: { left: 72, right: 72, top: 72, bottom: MARGIN_BOTTOM, header: 36, footer: FOOTER_DISTANCE },
};

const FOOTER_BAND_ORIGIN = PAGE_HEIGHT - FOOTER_DISTANCE; // 1020

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeFragmentsForRegion', () => {
  describe('page-covering header overlays (SD-3550)', () => {
    const pageCoverConstraints = {
      width: 695.4667,
      pageWidth: 793.7333,
      pageHeight: 1122.5333,
      margins: {
        left: 49.1333,
        right: 49.1333,
        top: 49.1333,
        bottom: 94.5333,
        header: 26.4667,
        footer: 56.7333,
      },
    };

    it('snaps a page-sized column/paragraph header background to the physical page edges', () => {
      const block: FlowBlock = {
        kind: 'drawing',
        id: 'header-background',
        drawingKind: 'shapeGroup',
        geometry: { width: 794, height: 1123 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'column',
          vRelativeFrom: 'paragraph',
          offsetH: -47.8,
          offsetV: -26.4667,
          behindDoc: true,
        },
        wrap: { type: 'None' },
        shapes: [],
      };
      const fragment = {
        kind: 'drawing',
        blockId: block.id,
        drawingKind: 'shapeGroup',
        x: -47.8,
        y: -26.4667,
        width: 794,
        height: 1123,
        isAnchored: true,
        behindDoc: true,
      } as unknown as Fragment;

      normalizeFragmentsForRegion(
        [{ number: 1, fragments: [fragment] }],
        [block],
        [makeDummyMeasure()],
        'header',
        pageCoverConstraints,
      );

      expect(fragment.x).toBeCloseTo(-pageCoverConstraints.margins.left);
      expect(fragment.y).toBeCloseTo(-pageCoverConstraints.margins.header);
    });

    it('snaps a page-sized page-relative header background to zero', () => {
      const block: FlowBlock = {
        kind: 'drawing',
        id: 'page-relative-background',
        drawingKind: 'shapeGroup',
        geometry: { width: 794, height: 1123 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
          offsetH: 1.6,
          offsetV: 0,
          behindDoc: true,
        },
        wrap: { type: 'None' },
        shapes: [],
      };
      const fragment = {
        kind: 'drawing',
        blockId: block.id,
        drawingKind: 'shapeGroup',
        x: 1.6,
        y: 0,
        width: 794,
        height: 1123,
        isAnchored: true,
        behindDoc: true,
      } as unknown as Fragment;

      normalizeFragmentsForRegion(
        [{ number: 1, fragments: [fragment] }],
        [block],
        [makeDummyMeasure()],
        'header',
        pageCoverConstraints,
      );

      expect(fragment.x).toBe(0);
      expect(fragment.y).toBe(0);
    });

    it('does not snap an ordinary behind-document header shape', () => {
      const block: FlowBlock = {
        kind: 'drawing',
        id: 'ordinary-header-shape',
        drawingKind: 'vectorShape',
        geometry: { width: 320, height: 180 },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
          offsetH: 2,
          offsetV: 1,
          behindDoc: true,
        },
        wrap: { type: 'None' },
      };
      const fragment = {
        kind: 'drawing',
        blockId: block.id,
        drawingKind: 'vectorShape',
        x: 2,
        y: 1,
        width: 320,
        height: 180,
        isAnchored: true,
        behindDoc: true,
      } as unknown as Fragment;

      normalizeFragmentsForRegion(
        [{ number: 1, fragments: [fragment] }],
        [block],
        [makeDummyMeasure()],
        'header',
        pageCoverConstraints,
      );

      expect(fragment.x).toBe(2);
      expect(fragment.y).toBe(1);
    });
  });

  describe('margin-relative anchors in header', () => {
    describe.each(['image', 'drawing'] as const)('SD-6076 behindDoc %s overlays', (kind) => {
      it.each([
        { top: 120, header: 48, relativeFrom: 'margin', expected: -47 },
        { top: 160, header: 48, relativeFrom: 'margin', expected: -7 },
        { top: 120, header: 96, relativeFrom: 'margin', expected: -95 },
        { top: 120, header: 48, relativeFrom: 'page', expected: -119 },
      ] as const)('preserves the physical anchor frame: %j', (geometry) => {
        const anchor = {
          isAnchored: true,
          hRelativeFrom: 'page' as const,
          offsetH: 0,
          vRelativeFrom: geometry.relativeFrom,
          offsetV: -119,
          behindDoc: true,
        };
        const block: FlowBlock =
          kind === 'image'
            ? {
                kind,
                id: 'background',
                src: 'data:image/png;base64,AAAA',
                width: 812,
                height: 1064,
                anchor,
                wrap: { type: 'None' },
              }
            : {
                kind,
                id: 'background',
                drawingKind: 'vectorShape',
                geometry: { width: 812, height: 1064 },
                anchor,
                wrap: { type: 'None' },
              };
        const originalBlock = structuredClone(block);
        const fragment: Fragment = {
          kind,
          blockId: block.id,
          x: 0,
          y: -119,
          width: 812,
          height: 1064,
          isAnchored: true,
          behindDoc: true,
          ...(kind === 'drawing' ? { drawingKind: 'vectorShape' as const } : {}),
        } as Fragment;

        normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], 'header', {
          width: 624,
          pageWidth: 816,
          pageHeight: 1056,
          margins: { left: 96, right: 96, top: geometry.top, bottom: 96, header: geometry.header },
        });

        expect(fragment).toMatchObject({
          x: 0,
          y: geometry.expected,
          width: 812,
          height: 1064,
          isAnchored: true,
          behindDoc: true,
        });
        expect(block).toEqual(originalBlock);
      });
    });

    it('resolves a VML text watermark against the physical page margins', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'text-watermark',
        src: 'data:image/svg+xml;base64,PHN2Zy8+',
        width: 528,
        height: 448,
        attrs: { vmlWatermark: true, vmlTextWatermark: true },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'margin',
          alignH: 'center',
          offsetH: 24,
          vRelativeFrom: 'page',
          alignV: 'center',
          offsetV: -16,
          behindDoc: true,
        },
        wrap: { type: 'None' },
      };
      const fragment = makeAnchoredImageFragment(block.id, 288, 448);
      fragment.x = 48;
      (fragment as { width?: number }).width = 528;

      normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], 'header', {
        width: 624,
        pageWidth: 816,
        pageHeight: 1056,
        margins: { left: 96, right: 96, top: 96, bottom: 96, header: 48, footer: 48 },
      });

      expect(fragment.x).toBe(72);
      expect(fragment.y).toBe(288);
    });

    it('resolves a VML picture watermark against the physical page and body margin', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'picture-watermark',
        src: 'data:image/png;base64,AAAA',
        width: 128,
        height: 64,
        attrs: { vmlWatermark: true },
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          alignH: 'right',
          offsetH: -10.667,
          vRelativeFrom: 'margin',
          alignV: 'top',
          offsetV: 18.667,
          behindDoc: true,
        },
        wrap: { type: 'None' },
      };
      const fragment = makeAnchoredImageFragment(block.id, 48, 64);
      fragment.x = 592;
      (fragment as { width?: number }).width = 128;

      normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], 'header', {
        width: 624,
        pageWidth: 816,
        pageHeight: 1056,
        margins: { left: 96, right: 96, top: 96, bottom: 96, header: 48, footer: 48 },
      });

      expect(fragment.x).toBeCloseTo(698.667, 3);
      expect(fragment.y).toBeCloseTo(66.667, 3);
    });

    it.each([
      { top: 96, header: 48, offset: 0, align: 'top', height: 892.8, expected: 48 },
      { top: 96, header: 24, offset: 0, align: 'top', height: 892.8, expected: 72 },
      { top: 144, header: 48, offset: 12, align: 'top', height: 120, expected: 108 },
      { top: 96, header: 48, offset: -12, align: 'top', height: 120, expected: 36 },
      { top: 96, header: 48, offset: 0, align: 'center', height: 120, expected: 432 },
      { top: 96, header: 48, offset: 0, align: 'bottom', height: 120, expected: 816 },
    ] as const)('places a no-wrap margin overlay in the physical margin frame: %j', (geometry) => {
      const block: FlowBlock = {
        kind: 'drawing',
        id: 'margin-overlay',
        drawingKind: 'vectorShape',
        geometry: { width: 48, height: geometry.height },
        anchor: { isAnchored: true, vRelativeFrom: 'margin', alignV: geometry.align, offsetV: geometry.offset },
        wrap: { type: 'None' },
      };
      const fragment = {
        kind: 'drawing',
        blockId: block.id,
        x: 0,
        y: 0,
        width: 48,
        height: geometry.height,
        isAnchored: true,
      } as Fragment;
      normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], 'header', {
        ...fullConstraints,
        margins: { ...fullConstraints.margins, top: geometry.top, header: geometry.header },
      });
      expect(fragment.y).toBeCloseTo(geometry.expected, 3);
    });

    it('normalizes visible margin-relative header content to header-local y', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'header-logo',
        src: 'logo.png',
        anchor: { isAnchored: true, vRelativeFrom: 'margin', alignV: 'bottom', offsetV: 0 },
        wrap: { type: 'Square' },
      };
      const fragment = makeAnchoredImageFragment('header-logo', 826.2, 68);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'header', fullConstraints);

      expect(fragment.y).toBe(0);
    });

    it.each([
      { align: 'center', expected: 432 },
      { align: 'bottom', expected: 828 },
    ] as const)('SD-6076 resolves behind-doc no-wrap header alignment: %j', ({ align, expected }) => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'header-watermark',
        src: 'watermark.png',
        anchor: { isAnchored: true, vRelativeFrom: 'margin', alignV: align, offsetV: 0, behindDoc: true },
        wrap: { type: 'None' },
      };
      const fragment = makeAnchoredImageFragment('header-watermark', 400, 120);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'header', fullConstraints);

      expect(fragment.y).toBe(expected);
    });

    it.each([undefined, 'Square', 'Tight'] as const)(
      'preserves behind-doc header overlays with wrap %s',
      (wrapType) => {
        const block: FlowBlock = {
          kind: 'image',
          id: 'wrapped-header-watermark',
          src: 'watermark.png',
          anchor: { isAnchored: true, vRelativeFrom: 'margin', alignV: 'center', offsetV: 0, behindDoc: true },
          ...(wrapType ? { wrap: { type: wrapType } } : {}),
        };
        const fragment = makeAnchoredImageFragment(block.id, 400, 120);

        normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], 'header', fullConstraints);

        expect(fragment.y).toBe(400);
      },
    );
  });

  describe('page-relative anchors in header', () => {
    it('normalizes page-relative header content to page-top-local y', () => {
      const block: FlowBlock = {
        kind: 'drawing',
        id: 'header-textbox',
        drawingKind: 'vectorShape',
        geometry: { width: 816, height: 27 },
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'top', offsetV: 20 },
        wrap: { type: 'None' },
      };
      const fragment = {
        kind: 'drawing',
        blockId: 'header-textbox',
        x: 0,
        y: -988,
        height: 27,
        isAnchored: true,
      } as unknown as Fragment;
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'header', fullConstraints);

      expect(fragment.y).toBe(20);
    });
  });

  describe('page-relative anchors in footer', () => {
    it('normalizes page-positioned floating tables against the physical page', () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'footer-table',
        rows: [],
        anchor: {
          isAnchored: true,
          hRelativeFrom: 'page',
          vRelativeFrom: 'page',
          alignH: 'right',
          alignV: 'bottom',
        },
      };
      const fragment = makeTableFragment(block.id, 572, 824, 100, 40, true);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.x).toBe(fullConstraints.pageWidth - 100);
      expect(fragment.y).toBe(PAGE_HEIGHT - 40 - FOOTER_BAND_ORIGIN);
    });

    it('keeps ordinary footer table coordinates unchanged', () => {
      const block: FlowBlock = { kind: 'table', id: 'footer-table', rows: [] };
      const fragment = makeTableFragment(block.id, 12, 18, 100, 40);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment).toMatchObject({ x: 12, y: 18 });
    });

    it('keeps inline footer table coordinates when its source table is page-anchored', () => {
      const block: FlowBlock = {
        kind: 'table',
        id: 'footer-table',
        rows: [],
        anchor: { isAnchored: true, hRelativeFrom: 'page', vRelativeFrom: 'page' },
      };
      const fragment = makeTableFragment(block.id, 12, 18, fullConstraints.width, 40);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment).toMatchObject({ x: 12, y: 18 });
    });

    it.each([
      ['right', 602, 746],
      ['center', 301, 373],
    ] as const)(
      'resolves page-anchored paragraph frame %s alignment against the physical page',
      (xAlign, x, expectedX) => {
        const block: FlowBlock = {
          kind: 'paragraph',
          id: 'footer-frame',
          runs: [],
          attrs: { frame: { wrap: 'around', hAnchor: 'page', vAnchor: 'page', xAlign, y: 988.8667 } },
        };
        const fragment = makeParaFragment('footer-frame', 988.8667);
        fragment.x = x;
        const pages = [{ number: 1, fragments: [fragment] }];

        normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

        expect(fragment.x).toBe(expectedX);
      },
    );

    it('normalizes a page-anchored paragraph frame from physical to footer-local coordinates', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-frame',
        runs: [],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: 988.8667 } },
      };
      const fragment = makeParaFragment('footer-frame', 988.8667);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.y).toBeCloseTo(988.8667 - (PAGE_HEIGHT - MARGIN_BOTTOM));
    });

    it.each([undefined, 'auto'])('keeps wrap=%s page-anchored paragraphs in ordinary flow', (wrap) => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'ordinary-footer-paragraph',
        runs: [],
        attrs: { frame: { wrap, vAnchor: 'page', y: 988.8667 } },
      };
      const fragments = [makeParaFragment(block.id, 12), makeParaFragment(block.id, 26)];
      const pages = [{ number: 1, fragments }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragments.map((fragment) => fragment.y)).toEqual([12, 26]);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY])('does not normalize a page-anchored frame with y=%s', (y) => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'non-finite-footer-frame',
        runs: [],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y } },
      };
      const fragment = makeParaFragment(block.id, 12);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.y).toBe(12);
    });

    it.each([
      ['negative', -24],
      ['non-finite', Number.NaN],
      ['missing', undefined],
    ])('uses the page bottom as the paragraph-frame origin for a %s bottom margin', (_label, bottom) => {
      const physicalY = 988.8667;
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'footer-frame-invalid-margin',
        runs: [],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: physicalY } },
      };
      const fragment = makeParaFragment(block.id, physicalY);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', {
        pageHeight: PAGE_HEIGHT,
        margins: { left: 72, right: 72, bottom },
      });

      expect(fragment.y + PAGE_HEIGHT).toBeCloseTo(physicalY);
    });

    it('normalizes a top-aligned anchor', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'top', offsetV: 0 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 0, 50);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      // physicalY = 0, bandOrigin = 1020
      expect(fragment.y).toBe(0 - FOOTER_BAND_ORIGIN);
    });

    it('normalizes a bottom-aligned anchor', () => {
      const imgHeight = 50;
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'bottom', offsetV: 0 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 0, imgHeight);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      // physicalY = 1056 - 50 = 1006, bandOrigin = 1020
      expect(fragment.y).toBe(PAGE_HEIGHT - imgHeight - FOOTER_BAND_ORIGIN);
    });

    it('normalizes a center-aligned anchor', () => {
      const imgHeight = 40;
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'center', offsetV: 0 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 0, imgHeight);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      // physicalY = (1056 - 40) / 2 = 508, bandOrigin = 1020
      expect(fragment.y).toBe((PAGE_HEIGHT - imgHeight) / 2 - FOOTER_BAND_ORIGIN);
    });

    it('applies offsetV correctly', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'top', offsetV: 20 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 0, 50);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      // physicalY = 20, bandOrigin = 1020
      expect(fragment.y).toBe(20 - FOOTER_BAND_ORIGIN);
    });

    it('normalizes drawing blocks the same as image blocks', () => {
      const block: FlowBlock = {
        kind: 'drawing',
        id: 'draw-1',
        drawingKind: 'vectorShape',
        geometry: { width: 100, height: 50 },
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'bottom', offsetV: 0 },
        shapeKind: 'Rectangle',
      };
      const fragment = {
        kind: 'drawing',
        blockId: 'draw-1',
        x: 0,
        y: 999,
        height: 50,
        isAnchored: true,
      } as unknown as Fragment;
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.y).toBe(PAGE_HEIGHT - 50 - FOOTER_BAND_ORIGIN);
    });

    it('falls back to bottom margin when footer distance is missing', () => {
      const imgHeight = 40;
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-bottom',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'bottom', offsetV: 0 },
      };
      const fragment = makeAnchoredImageFragment('img-bottom', 0, imgHeight);
      const pages = [{ number: 1, fragments: [fragment] }];

      const withoutFooter = {
        pageHeight: PAGE_HEIGHT,
        margins: { left: 72, right: 72, top: 72, bottom: MARGIN_BOTTOM, header: 36 },
      };

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', withoutFooter);

      const fallbackOrigin = PAGE_HEIGHT - MARGIN_BOTTOM;
      expect(fragment.y).toBe(PAGE_HEIGHT - imgHeight - fallbackOrigin);
    });
  });

  describe('passthrough cases — fragments that must NOT be modified', () => {
    it('keeps page-anchored paragraph frames page-top-local in headers', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'header-frame',
        runs: [],
        attrs: { frame: { wrap: 'around', vAnchor: 'page', y: 24 } },
      };
      const fragment = makeParaFragment('header-frame', 99);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'header', fullConstraints);

      expect(fragment.y).toBe(24);
    });

    it.each(['text', 'margin'])('does not modify %s-anchored paragraph frames', (vAnchor) => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'local-frame',
        runs: [],
        attrs: { frame: { wrap: 'around', vAnchor, y: 24 } },
      };
      const fragment = makeParaFragment('local-frame', 37);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.y).toBe(37);
    });

    it('does not modify non-anchored paragraph fragments', () => {
      const block: FlowBlock = {
        kind: 'paragraph',
        id: 'para-1',
        runs: [{ text: 'Hello', fontFamily: 'Arial', fontSize: 12, pmStart: 0, pmEnd: 5 }],
      };
      const fragment = makeParaFragment('para-1', 15);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.y).toBe(15);
    });

    it('does not modify paragraph-relative anchored images', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'paragraph', offsetV: 20 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 20, 30);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.y).toBe(20);
    });

    it('does not modify margin-relative anchored images', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'margin', alignV: 'top', offsetV: 5 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 42, 30);
      const pages = [{ number: 1, fragments: [fragment] }];

      normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(fragment.y).toBe(42);
    });

    it('returns early when pageHeight is null', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', offsetV: 10 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 42, 30);
      const pages = [{ number: 1, fragments: [fragment] }];

      const result = normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', {
        pageHeight: undefined,
        margins: { left: 0, right: 0 },
      });

      expect(fragment.y).toBe(42);
      expect(result).toBe(pages);
    });

    it('returns early when margins is undefined', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', offsetV: 10 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 42, 30);
      const pages = [{ number: 1, fragments: [fragment] }];

      const result = normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', { pageHeight: 1000 });

      expect(fragment.y).toBe(42);
      expect(result).toBe(pages);
    });
  });

  describe('mutation behavior', () => {
    it('mutates fragments in place and returns the same pages array', () => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'img-1',
        src: 'test.png',
        anchor: { isAnchored: true, vRelativeFrom: 'page', alignV: 'top', offsetV: 50 },
      };
      const fragment = makeAnchoredImageFragment('img-1', 999, 30);
      const pages = [{ number: 1, fragments: [fragment] }];

      const result = normalizeFragmentsForRegion(pages, [block], [makeDummyMeasure()], 'footer', fullConstraints);

      expect(result).toBe(pages);
      expect(pages[0].fragments[0].y).toBe(50 - FOOTER_BAND_ORIGIN);
    });
  });
});

describe('SD-5733 physical-page horizontal graphic anchors', () => {
  for (const kind of ['image', 'drawing'] as const) {
    for (const region of ['header', 'footer'] as const) {
      it.each([
        { alignH: 'right' as const, offsetH: 0, expected: -111.533 },
        { alignH: 'center' as const, offsetH: 6, expected: -49.7665 },
        { alignH: 'left' as const, offsetH: -14, expected: -14 },
      ])(`${region} ${kind} preserves page-relative placement: %j`, ({ alignH, offsetH, expected }) => {
        const width = 905.266;
        const anchor = {
          isAnchored: true,
          hRelativeFrom: 'page' as const,
          vRelativeFrom: 'paragraph' as const,
          alignH,
          offsetH,
          offsetV: -59,
        };
        const block: FlowBlock =
          kind === 'image'
            ? { kind, id: 'graphic', src: 'data:image/png;base64,AAAA', width, height: 160, anchor }
            : { kind, id: 'graphic', drawingKind: 'vectorShape', geometry: { width, height: 160 }, anchor };
        const fragment = {
          kind,
          blockId: block.id,
          drawingKind: 'vectorShape',
          x: alignH === 'right' ? 655.8 - width : alignH === 'center' ? (655.8 - width) / 2 + offsetH : offsetH,
          y: -59,
          width,
          height: 160,
          isAnchored: true,
        } as unknown as Fragment;
        normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], region, {
          width: 655.8,
          pageWidth: 793.733,
          pageHeight: 1122.533,
          margins: { left: 71.8, right: 66.133, top: 72, bottom: 72, header: 48, footer: 36 },
        });
        expect(fragment.x).toBeCloseTo(expected, 3);
        expect(fragment.y).toBe(-59);
        expect(fragment.width).toBe(width);
      });
    }
  }

  for (const kind of ['image', 'drawing'] as const) {
    for (const region of ['header', 'footer'] as const) {
      it.each(['Square', 'Tight', 'Through', 'TopAndBottom'] as const)(
        `${region} ${kind} keeps the horizontal position used by %s wrapping`,
        (type) => {
          const anchor = {
            isAnchored: true,
            hRelativeFrom: 'page' as const,
            vRelativeFrom: 'paragraph' as const,
            alignH: 'center' as const,
          };
          const wrap = { type, wrapText: 'right' as const };
          const block: FlowBlock =
            kind === 'image'
              ? { kind, id: 'foreground', src: 'test.png', width: 200, height: 80, anchor, wrap }
              : {
                  kind,
                  id: 'foreground',
                  drawingKind: 'vectorShape',
                  geometry: { width: 200, height: 80 },
                  anchor,
                  wrap,
                };
          const fragment = {
            kind,
            blockId: block.id,
            x: 190,
            y: 0,
            width: 200,
            height: 80,
            isAnchored: true,
          } as Fragment;
          normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], region, {
            width: 580,
            pageWidth: 800,
            pageHeight: 1000,
            margins: { left: 20, right: 200, top: 72, bottom: 72, header: 24, footer: 24 },
          });
          expect(fragment.x).toBe(190);
          expect(fragment.x + fragment.width).toBeLessThanOrEqual(410);
        },
      );
    }
  }

  it.each(['column', 'character', 'margin'] as const)(
    'preserves existing %s-relative horizontal positions',
    (hRelativeFrom) => {
      const block: FlowBlock = {
        kind: 'image',
        id: 'control',
        src: 'data:image/png;base64,AAAA',
        width: 306,
        height: 172,
        anchor: { isAnchored: true, hRelativeFrom, vRelativeFrom: 'paragraph', alignH: 'right', offsetH: 23 },
      };
      const fragment = {
        kind: 'image',
        blockId: block.id,
        x: 214,
        y: -59,
        width: 306,
        height: 172,
        isAnchored: true,
      } as Fragment;
      normalizeFragmentsForRegion([{ number: 1, fragments: [fragment] }], [block], [], 'header', fullConstraints);
      expect(fragment.x).toBe(214);
      expect(fragment.y).toBe(-59);
    },
  );
});
