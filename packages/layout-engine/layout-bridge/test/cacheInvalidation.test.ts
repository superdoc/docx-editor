/**
 * Cache Invalidation Tests
 *
 * Tests for cache invalidation logic for headers/footers and body content.
 */

import { describe, it, expect, beforeEach } from 'vite-plus/test';
import type { FlowBlock, Measure, ParagraphBlock, SectionMetadata, TextRun } from '@superdoc/contracts';
import type { HeaderFooterConstraints } from '../../layout-engine';
import {
  computeHeaderFooterContentHash,
  computeSectionMetadataHash,
  computeConstraintsHash,
  HeaderFooterCacheState,
  invalidateHeaderFooterCache,
} from '../src/cacheInvalidation';
import { HeaderFooterLayoutCache } from '../src/layoutHeaderFooter';

describe('Cache Invalidation', () => {
  describe('Hash Functions', () => {
    describe('computeHeaderFooterContentHash', () => {
      it('should return empty string for empty blocks', () => {
        expect(computeHeaderFooterContentHash([])).toBe('');
      });

      it.each<[string, Partial<TextRun>]>([
        ['text', { text: 'World' }],
        ['bold', { bold: true }],
        ['italic', { italic: true }],
        ['page-number token', { token: 'pageNumber' }],
      ])('should produce different hashes when only run %s changes', (_field, change) => {
        const paragraph = (run: Partial<TextRun>): FlowBlock[] => [
          { kind: 'paragraph', id: 'p1', runs: [{ text: 'Hello', ...run }] } as ParagraphBlock,
        ];

        expect(computeHeaderFooterContentHash(paragraph(change))).not.toBe(
          computeHeaderFooterContentHash(paragraph({})),
        );
      });

      it('should produce different hashes when only the block id changes', () => {
        const paragraph = (id: string): FlowBlock[] => [
          { kind: 'paragraph', id, runs: [{ text: 'Hello' }] } as ParagraphBlock,
        ];

        expect(computeHeaderFooterContentHash(paragraph('p2'))).not.toBe(
          computeHeaderFooterContentHash(paragraph('p1')),
        );
      });

      it('should include page number token format in hash', () => {
        const decimalBlocks: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: '0', token: 'pageNumber', pageNumberFieldFormat: { format: 'decimal' } }],
          } as ParagraphBlock,
        ];
        const romanBlocks: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: '0', token: 'pageNumber', pageNumberFieldFormat: { format: 'upperRoman' } }],
          } as ParagraphBlock,
        ];

        expect(computeHeaderFooterContentHash(decimalBlocks)).not.toBe(computeHeaderFooterContentHash(romanBlocks));
      });

      it('should produce different hashes for different content', () => {
        const blocks1: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Hello' }],
          } as ParagraphBlock,
        ];

        const blocks2: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'World' }],
          } as ParagraphBlock,
        ];

        const hash1 = computeHeaderFooterContentHash(blocks1);
        const hash2 = computeHeaderFooterContentHash(blocks2);

        expect(hash1).not.toBe(hash2);
      });
    });

    describe('computeSectionMetadataHash', () => {
      it('should return empty string for empty sections', () => {
        expect(computeSectionMetadataHash([])).toBe('');
      });

      it.each<[string, SectionMetadata]>([
        ['section index', { sectionIndex: 2, numbering: { format: 'decimal', start: 1 } }],
        ['numbering start', { sectionIndex: 1, numbering: { format: 'decimal', start: 5 } }],
      ])('should produce different hashes when only the %s changes', (_field, changed) => {
        const base: SectionMetadata = { sectionIndex: 1, numbering: { format: 'decimal', start: 1 } };

        expect(computeSectionMetadataHash([changed])).not.toBe(computeSectionMetadataHash([base]));
      });

      it('should produce different hashes for different metadata', () => {
        const sections1: SectionMetadata[] = [
          {
            sectionIndex: 1,
            numbering: { format: 'decimal', start: 1 },
          },
        ];

        const sections2: SectionMetadata[] = [
          {
            sectionIndex: 1,
            numbering: { format: 'lowerRoman', start: 1 },
          },
        ];

        const hash1 = computeSectionMetadataHash(sections1);
        const hash2 = computeSectionMetadataHash(sections2);

        expect(hash1).not.toBe(hash2);
      });
    });

    describe('computeConstraintsHash', () => {
      it.each<[string, Partial<HeaderFooterConstraints>]>([
        ['height', { height: 120 }],
        ['pageWidth', { pageWidth: 620 }],
        ['pageHeight', { pageHeight: 820 }],
        ['left margin', { margins: { left: 55, right: 50, top: 40, bottom: 60, header: 30, footer: 20 } }],
        ['right margin', { margins: { left: 50, right: 55, top: 40, bottom: 60, header: 30, footer: 20 } }],
        ['top margin', { margins: { left: 50, right: 50, top: 45, bottom: 60, header: 30, footer: 20 } }],
        ['bottom margin', { margins: { left: 50, right: 50, top: 40, bottom: 65, header: 30, footer: 20 } }],
        ['header margin', { margins: { left: 50, right: 50, top: 40, bottom: 60, header: 35, footer: 20 } }],
        ['footer margin', { margins: { left: 50, right: 50, top: 40, bottom: 60, header: 30, footer: 25 } }],
      ])('should produce different hashes when only the %s changes', (_field, change) => {
        const base: HeaderFooterConstraints = {
          width: 500,
          height: 100,
          pageWidth: 600,
          pageHeight: 800,
          margins: { left: 50, right: 50, top: 40, bottom: 60, header: 30, footer: 20 },
        };

        expect(computeConstraintsHash({ ...base, ...change })).not.toBe(computeConstraintsHash(base));
      });

      it('should produce different hashes for different constraints', () => {
        const constraints1: HeaderFooterConstraints = {
          width: 500,
          height: 100,
        };

        const constraints2: HeaderFooterConstraints = {
          width: 600,
          height: 100,
        };

        const hash1 = computeConstraintsHash(constraints1);
        const hash2 = computeConstraintsHash(constraints2);

        expect(hash1).not.toBe(hash2);
      });

      it('should produce different hashes when overflowBaseHeight changes', () => {
        const constraints1: HeaderFooterConstraints = {
          width: 500,
          height: 100,
          overflowBaseHeight: 50,
        };

        const constraints2: HeaderFooterConstraints = {
          width: 500,
          height: 100,
          overflowBaseHeight: 75,
        };

        const hash1 = computeConstraintsHash(constraints1);
        const hash2 = computeConstraintsHash(constraints2);

        expect(hash1).not.toBe(hash2);
      });

      it('should produce different hashes when overflowBaseHeight is added', () => {
        const constraints: HeaderFooterConstraints = { width: 500, height: 100 };

        expect(computeConstraintsHash({ ...constraints, overflowBaseHeight: 50 })).not.toBe(
          computeConstraintsHash(constraints),
        );
      });
    });
  });

  describe('HeaderFooterCacheState', () => {
    let cacheState: HeaderFooterCacheState;

    beforeEach(() => {
      cacheState = new HeaderFooterCacheState();
    });

    describe('hasContentChanged', () => {
      it('should return false on first check', () => {
        const blocks: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Hello' }],
          } as ParagraphBlock,
        ];

        const changed = cacheState.hasContentChanged('header-default', blocks);
        expect(changed).toBe(false);
      });

      it('should return false when content has not changed', () => {
        const blocks: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Hello' }],
          } as ParagraphBlock,
        ];

        cacheState.hasContentChanged('header-default', blocks);
        const changed = cacheState.hasContentChanged('header-default', blocks);

        expect(changed).toBe(false);
      });

      it('should return true when content has changed', () => {
        const blocks1: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Hello' }],
          } as ParagraphBlock,
        ];

        const blocks2: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'World' }],
          } as ParagraphBlock,
        ];

        cacheState.hasContentChanged('header-default', blocks1);
        const changed = cacheState.hasContentChanged('header-default', blocks2);

        expect(changed).toBe(true);
      });

      it('should track variants independently', () => {
        const blocks1: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Default' }],
          } as ParagraphBlock,
        ];

        const blocks2: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p2',
            runs: [{ text: 'First' }],
          } as ParagraphBlock,
        ];

        cacheState.hasContentChanged('header-default', blocks1);
        cacheState.hasContentChanged('header-first', blocks2);

        // Checking same variant again should return false
        expect(cacheState.hasContentChanged('header-default', blocks1)).toBe(false);
        expect(cacheState.hasContentChanged('header-first', blocks2)).toBe(false);

        // Changing one variant should not affect the other
        const blocks1Modified: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Modified' }],
          } as ParagraphBlock,
        ];

        expect(cacheState.hasContentChanged('header-default', blocks1Modified)).toBe(true);
        expect(cacheState.hasContentChanged('header-first', blocks2)).toBe(false);
      });
    });

    describe('hasConstraintsChanged', () => {
      it('should return false on first check', () => {
        const constraints: HeaderFooterConstraints = {
          width: 500,
          height: 100,
        };

        const changed = cacheState.hasConstraintsChanged(constraints);
        expect(changed).toBe(false);
      });

      it('should return false when constraints have not changed', () => {
        const constraints: HeaderFooterConstraints = {
          width: 500,
          height: 100,
        };

        cacheState.hasConstraintsChanged(constraints);
        const changed = cacheState.hasConstraintsChanged(constraints);

        expect(changed).toBe(false);
      });

      it('should return true when constraints have changed', () => {
        const constraints1: HeaderFooterConstraints = {
          width: 500,
          height: 100,
        };

        const constraints2: HeaderFooterConstraints = {
          width: 600,
          height: 100,
        };

        cacheState.hasConstraintsChanged(constraints1);
        const changed = cacheState.hasConstraintsChanged(constraints2);

        expect(changed).toBe(true);
      });
    });

    describe('hasSectionMetadataChanged', () => {
      it('should return false on first check', () => {
        const sections: SectionMetadata[] = [
          {
            sectionIndex: 1,
            numbering: { format: 'decimal', start: 1 },
          },
        ];

        const changed = cacheState.hasSectionMetadataChanged(sections);
        expect(changed).toBe(false);
      });

      it('should return true when metadata has changed', () => {
        const sections1: SectionMetadata[] = [
          {
            sectionIndex: 1,
            numbering: { format: 'decimal', start: 1 },
          },
        ];

        const sections2: SectionMetadata[] = [
          {
            sectionIndex: 1,
            numbering: { format: 'lowerRoman', start: 1 },
          },
        ];

        cacheState.hasSectionMetadataChanged(sections1);
        const changed = cacheState.hasSectionMetadataChanged(sections2);

        expect(changed).toBe(true);
      });
    });

    describe('reset', () => {
      it('should clear all cached state', () => {
        const blocks: FlowBlock[] = [
          {
            kind: 'paragraph',
            id: 'p1',
            runs: [{ text: 'Hello' }],
          } as ParagraphBlock,
        ];

        const constraints: HeaderFooterConstraints = {
          width: 500,
          height: 100,
        };

        const sections: SectionMetadata[] = [
          {
            sectionIndex: 1,
            numbering: { format: 'decimal', start: 1 },
          },
        ];

        cacheState.hasContentChanged('header-default', blocks);
        cacheState.hasConstraintsChanged(constraints);
        cacheState.hasSectionMetadataChanged(sections);

        cacheState.reset();

        // After reset, should return false (first check)
        expect(cacheState.hasContentChanged('header-default', blocks)).toBe(false);
        expect(cacheState.hasConstraintsChanged(constraints)).toBe(false);
        expect(cacheState.hasSectionMetadataChanged(sections)).toBe(false);
      });
    });
  });

  describe('invalidateHeaderFooterCache', () => {
    let cache: HeaderFooterLayoutCache;
    let cacheState: HeaderFooterCacheState;

    const helloBlocks = { default: [{ kind: 'paragraph', id: 'p1', runs: [{ text: 'Hello' }] } as ParagraphBlock] };

    const remeasuredHelloBlocks = async (): Promise<number> => {
      let calls = 0;
      await cache.measureBlocks(helloBlocks.default, { width: 500, height: 100 }, async () => {
        calls += 1;
        return { kind: 'paragraph', lines: [], totalHeight: 0 } as Measure;
      });
      return calls;
    };

    beforeEach(() => {
      cache = new HeaderFooterLayoutCache();
      cacheState = new HeaderFooterCacheState();
    });

    it('should drop the cached measure when content changes', async () => {
      expect(await remeasuredHelloBlocks()).toBe(1);

      invalidateHeaderFooterCache(cache, cacheState, helloBlocks, undefined, undefined, undefined);
      expect(await remeasuredHelloBlocks()).toBe(0);

      const worldBlocks = { default: [{ kind: 'paragraph', id: 'p1', runs: [{ text: 'World' }] } as ParagraphBlock] };
      invalidateHeaderFooterCache(cache, cacheState, worldBlocks, undefined, undefined, undefined);
      expect(await remeasuredHelloBlocks()).toBe(1);
    });

    it.each<
      [string, Pick<HeaderFooterConstraints, 'overflowBaseHeight' | 'margins' | 'pageHeight'> & { width?: number }]
    >([
      ['width', { width: 600 }],
      ['overflowBaseHeight', { overflowBaseHeight: 75 }],
      [
        'top margin of a page-relative header',
        { pageHeight: 900, margins: { left: 50, right: 50, top: 96, bottom: 72, header: 36 } },
      ],
    ])('should drop the cached measure when the constraint %s changes', async (_field, change) => {
      const before: HeaderFooterConstraints = {
        width: 500,
        height: 100,
        overflowBaseHeight: 50,
        pageHeight: 900,
        margins: { left: 50, right: 50, top: 72, bottom: 72, header: 36 },
      };
      invalidateHeaderFooterCache(cache, cacheState, helloBlocks, undefined, before, undefined);
      expect(await remeasuredHelloBlocks()).toBe(1);

      invalidateHeaderFooterCache(cache, cacheState, helloBlocks, undefined, { ...before, ...change }, undefined);
      expect(await remeasuredHelloBlocks()).toBe(1);
    });

    it('should drop the cached measure when section metadata changes', async () => {
      const decimal: SectionMetadata[] = [{ sectionIndex: 1, numbering: { format: 'decimal', start: 1 } }];
      const roman: SectionMetadata[] = [{ sectionIndex: 1, numbering: { format: 'lowerRoman', start: 1 } }];
      invalidateHeaderFooterCache(cache, cacheState, helloBlocks, undefined, undefined, decimal);
      expect(await remeasuredHelloBlocks()).toBe(1);

      invalidateHeaderFooterCache(cache, cacheState, helloBlocks, undefined, undefined, roman);
      expect(await remeasuredHelloBlocks()).toBe(1);
    });

    it('should keep the cached measure when nothing has changed', async () => {
      const constraints: HeaderFooterConstraints = { width: 500, height: 100 };
      invalidateHeaderFooterCache(cache, cacheState, helloBlocks, undefined, constraints, undefined);
      expect(await remeasuredHelloBlocks()).toBe(1);

      invalidateHeaderFooterCache(cache, cacheState, helloBlocks, undefined, constraints, undefined);
      expect(await remeasuredHelloBlocks()).toBe(0);
    });
  });
});
