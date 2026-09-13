/**
 * Test utilities for section break testing.
 *
 * Provides helper functions to create synthetic PM JSON documents with section breaks,
 * convert them to flow blocks, measure them, and layout them into pages.
 *
 * @module section-test-utils
 */

import type { PMNode, FlowBlock, SectionBreakBlock, Measure, Layout, Page } from '@superdoc/contracts';
import { toFlowBlocks } from './to-flow-blocks.js';
import { layoutDocument } from '@superdoc/layout-engine';
import { measureBlock } from '@superdoc/measuring-dom';
import type { NumberingProperties, StylesDocumentProperties } from '@superdoc/style-engine/ooxml';

/**
 * Section properties for creating test documents.
 */
export type TestSectionProps = {
  type?: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage';
  orientation?: 'portrait' | 'landscape';
  pageSize?: { w: number; h: number };
  columns?: { count: number; gap: number };
  /**
   * Section page direction (`w:sectPr/w:bidi`). RTL puts the FIRST column against the right margin
   * and fills right to left, the way Word lays out a Hebrew or Arabic multi-column section.
   */
  bidi?: boolean;
  margins?: { header?: number; footer?: number };
  /** Vertical alignment of content within the section's pages */
  vAlign?: 'top' | 'center' | 'bottom' | 'both';
};

/**
 * Standard page sizes in pixels (at 96 DPI).
 */
export const PAGE_SIZES = {
  LETTER_PORTRAIT: { w: 612, h: 792 },
  LETTER_LANDSCAPE: { w: 792, h: 612 },
  LEGAL_PORTRAIT: { w: 612, h: 1008 },
  LEGAL_LANDSCAPE: { w: 1008, h: 612 },
  A4_PORTRAIT: { w: 595, h: 842 },
  A4_LANDSCAPE: { w: 842, h: 595 },
} as const;

/**
 * Default margins in pixels.
 */
export const DEFAULT_MARGINS = {
  header: 72,
  footer: 72,
} as const;

const DEFAULT_TRANSLATED_LINKED_STYLES: StylesDocumentProperties = {
  docDefaults: {},
  latentStyles: {},
  styles: {},
};

const DEFAULT_TRANSLATED_NUMBERING: NumberingProperties = {
  abstracts: {},
  definitions: {},
};

export const DEFAULT_CONVERTER_CONTEXT = {
  translatedLinkedStyles: DEFAULT_TRANSLATED_LINKED_STYLES,
  translatedNumbering: DEFAULT_TRANSLATED_NUMBERING,
};

/**
 * Counter for generating unique block IDs.
 */
let blockIdCounter = 0;

/**
 * Reset the block ID counter (useful for deterministic tests).
 */
export function resetBlockIdCounter(): void {
  blockIdCounter = 0;
}

/**
 * Generate a unique block ID.
 *
 * @returns Unique block ID string
 */
function generateBlockId(): string {
  blockIdCounter += 1;
  return `test-block-${blockIdCounter}`;
}

/**
 * Create a simple paragraph PM node.
 *
 * @param text - Paragraph text content
 * @param attrs - Optional paragraph attributes
 * @returns PM paragraph node
 */
export function createPMParagraph(text: string, attrs?: Record<string, unknown>): PMNode {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'run',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
    attrs: attrs ?? {},
  };
}

/**
 * Convert pixels to twips (twentieths of a point).
 * 96 pixels = 1440 twips (1 inch)
 *
 * @param pixels - Value in pixels
 * @returns Value in twips
 */
function pixelsToTwips(pixels: number): number {
  return Math.round((pixels / 96) * 1440);
}

/**
 * Create OOXML-style sectPr elements from section properties.
 *
 * @param sectionProps - Section properties
 * @returns OOXML elements array
 */
function createSectPrElements(sectionProps: TestSectionProps): Array<Record<string, unknown>> {
  const elements: Array<Record<string, unknown>> = [];

  // Add w:type element
  if (sectionProps.type) {
    elements.push({
      type: 'element',
      name: 'w:type',
      attributes: {
        'w:val': sectionProps.type,
      },
    });
  }

  // Add w:pgSz element (page size in twips)
  if (sectionProps.pageSize) {
    elements.push({
      type: 'element',
      name: 'w:pgSz',
      attributes: {
        'w:w': pixelsToTwips(sectionProps.pageSize.w).toString(),
        'w:h': pixelsToTwips(sectionProps.pageSize.h).toString(),
        ...(sectionProps.orientation ? { 'w:orient': sectionProps.orientation } : {}),
      },
    });
  }

  // Add w:pgMar element (margins in twips)
  if (sectionProps.margins) {
    const attrs: Record<string, string> = {
      'w:top': '1440',
      'w:right': '1440',
      'w:bottom': '1440',
      'w:left': '1440',
    };

    if (sectionProps.margins.header !== undefined) {
      attrs['w:header'] = pixelsToTwips(sectionProps.margins.header).toString();
    }

    if (sectionProps.margins.footer !== undefined) {
      attrs['w:footer'] = pixelsToTwips(sectionProps.margins.footer).toString();
    }

    elements.push({
      type: 'element',
      name: 'w:pgMar',
      attributes: attrs,
    });
  }

  // Add w:cols element (columns)
  if (sectionProps.columns) {
    elements.push({
      type: 'element',
      name: 'w:cols',
      attributes: {
        'w:num': sectionProps.columns.count.toString(),
        'w:space': pixelsToTwips(sectionProps.columns.gap).toString(),
      },
    });
  }

  // Add w:bidi element (section page direction). Emitted after w:cols on purpose: the two are
  // siblings in any order, and the reader must not depend on seeing the direction first.
  if (sectionProps.bidi !== undefined) {
    elements.push({
      type: 'element',
      name: 'w:bidi',
      attributes: sectionProps.bidi ? {} : { 'w:val': '0' },
    });
  }

  // Add w:vAlign element (vertical alignment)
  if (sectionProps.vAlign) {
    elements.push({
      type: 'element',
      name: 'w:vAlign',
      attributes: {
        'w:val': sectionProps.vAlign,
      },
    });
  }

  return elements;
}

/**
 * Create a sectPr element compatible with the adapter.
 */
export function createSectPrElement(sectionProps: TestSectionProps): Record<string, unknown> {
  return {
    type: 'element',
    name: 'w:sectPr',
    attributes: {},
    elements: createSectPrElements(sectionProps),
  };
}

/**
 * Create a PM paragraph with section properties (sectPr).
 *
 * This simulates Word's end-tagged section semantics where section properties
 * are attached to the last paragraph of a section.
 *
 * @param text - Paragraph text content
 * @param sectionProps - Section properties for this section
 * @returns PM paragraph node with sectPr
 */
export function createPMParagraphWithSection(text: string, sectionProps: TestSectionProps): PMNode {
  const sectPrElements = createSectPrElements(sectionProps);

  return {
    type: 'paragraph',
    content: [
      {
        type: 'run',
        content: [
          {
            type: 'text',
            text,
          },
        ],
      },
    ],
    attrs: {
      paragraphProperties: {
        sectPr: {
          type: 'element',
          name: 'w:sectPr',
          attributes: {},
          elements: sectPrElements,
        },
      },
    },
  };
}

/**
 * Create a PM document with multiple sections.
 *
 * Each section is defined by an array of paragraph texts and optional section properties.
 * The section properties are attached to the last paragraph of each section (Word semantics).
 *
 * @param sections - Array of section definitions
 * @param bodySectPr - Optional body section properties (final section)
 * @returns PM document node
 *
 * @example
 * ```typescript
 * const pmDoc = createPMDocWithSections([
 *   {
 *     paragraphs: ['Section 1 Para 1', 'Section 1 Para 2'],
 *     props: { type: 'nextPage', orientation: 'portrait' }
 *   },
 *   {
 *     paragraphs: ['Section 2 Para 1'],
 *     props: { type: 'nextPage', orientation: 'landscape' }
 *   }
 * ]);
 * ```
 */
export function createPMDocWithSections(
  sections: Array<{
    paragraphs: string[];
    props?: TestSectionProps;
  }>,
  bodySectPr?: TestSectionProps,
): PMNode {
  const content: PMNode[] = [];

  sections.forEach((section, sectionIndex) => {
    section.paragraphs.forEach((text, paraIndex) => {
      const isLastParagraphInSection = paraIndex === section.paragraphs.length - 1;
      const isLastSection = sectionIndex === sections.length - 1;

      if (isLastParagraphInSection && !isLastSection && section.props) {
        // Attach section properties to last paragraph of non-final sections
        content.push(createPMParagraphWithSection(text, section.props));
      } else {
        // Regular paragraph
        content.push(createPMParagraph(text));
      }
    });
  });

  // Ensure there is at least one paragraph so the layout engine produces a page
  if (content.length === 0) {
    content.push(createPMParagraph(''));
  }

  // Create doc attrs with body sectPr (final section properties)
  const docAttrs: Record<string, unknown> = {};

  if (bodySectPr) {
    const sectPr = createSectPrElement(bodySectPr);
    docAttrs.sectPr = sectPr;
    docAttrs.bodySectPr = sectPr;
  }

  return {
    type: 'doc',
    content,
    attrs: docAttrs,
  };
}

/**
 * Create a section break block for testing.
 *
 * @param props - Section break properties
 * @returns Section break block
 */
export function createSectionBreak(props: TestSectionProps): SectionBreakBlock {
  const block: SectionBreakBlock = {
    kind: 'sectionBreak',
    id: generateBlockId(),
  };

  if (props.type) {
    block.type = props.type;
  }

  if (props.orientation) {
    block.orientation = props.orientation;
  }

  if (props.pageSize) {
    block.pageSize = { w: props.pageSize.w, h: props.pageSize.h };
  }

  if (props.columns) {
    block.columns = {
      count: props.columns.count,
      gap: props.columns.gap,
      ...(props.bidi ? { direction: 'rtl' as const } : {}),
    };
  }

  if (props.margins) {
    block.margins = {
      header: props.margins.header,
      footer: props.margins.footer,
    };
  }

  if (props.vAlign) {
    block.vAlign = props.vAlign;
  }

  return block;
}

/**
 * Convert PM JSON to flow blocks with section break emission enabled.
 *
 * @param pmDoc - ProseMirror document
 * @returns Flow blocks and bookmarks
 */
export function pmToFlowBlocks(pmDoc: PMNode): {
  blocks: FlowBlock[];
  bookmarks: Map<string, number>;
} {
  return toFlowBlocks(pmDoc, {
    emitSectionBreaks: true,
    converterContext: DEFAULT_CONVERTER_CONTEXT,
  });
}

/**
 * Measure all flow blocks.
 *
 * @param blocks - Flow blocks to measure
 * @param contentWidth - Content width in pixels (default: 468 = 612 - 72*2)
 * @returns Array of measures
 */
export async function measureBlocks(blocks: FlowBlock[], contentWidth = 468): Promise<Measure[]> {
  return Promise.all(blocks.map((block) => measureBlock(block, contentWidth)));
}

/**
 * Convert PM JSON to blocks, measure them, and layout into pages.
 *
 * This is the full pipeline: PM JSON -> Flow Blocks -> Measures -> Layout
 *
 * @param pmDoc - ProseMirror document
 * @param options - Optional layout options
 * @returns Layout result with pages
 */
export async function convertAndLayout(
  pmDoc: PMNode,
  options?: {
    contentWidth?: number;
    pageSize?: { w: number; h: number };
    margins?: { top: number; right: number; bottom: number; left: number };
  },
): Promise<Layout> {
  const { blocks } = pmToFlowBlocks(pmDoc);
  const measures = await measureBlocks(blocks, options?.contentWidth);
  return layoutDocument(blocks, measures, {
    pageSize: options?.pageSize,
    margins: options?.margins,
  });
}

/**
 * Assert that a layout has the expected number of pages.
 *
 * @param layout - Layout result
 * @param expected - Expected page count
 * @throws AssertionError if page count doesn't match
 */
export function assertPageCount(layout: Layout, expected: number): void {
  if (layout.pages.length !== expected) {
    throw new Error(`Expected ${expected} pages but got ${layout.pages.length}`);
  }
}

/**
 * Assert that a page has the expected orientation.
 *
 * @param page - Page to check
 * @param expected - Expected orientation
 * @throws AssertionError if orientation doesn't match
 */
export function assertPageOrientation(page: Page, expected: 'portrait' | 'landscape'): void {
  if (page.orientation !== expected) {
    throw new Error(`Expected orientation '${expected}' but got '${page.orientation}'`);
  }
}

/**
 * Assert that a page has the expected size.
 *
 * @param page - Page to check
 * @param expected - Expected page size
 * @throws AssertionError if page size doesn't match
 */
export function assertPageSize(page: Page, expected: { w: number; h: number }): void {
  const actual = page.pageSize;
  if (!actual) {
    throw new Error(`Page has no pageSize`);
  }

  if (actual.w !== expected.w || actual.h !== expected.h) {
    throw new Error(`Expected page size ${expected.w}x${expected.h} but got ${actual.w}x${actual.h}`);
  }
}

/**
 * Count section break blocks in a flow block array.
 *
 * @param blocks - Flow blocks to analyze
 * @returns Number of section break blocks
 */
export function countSectionBreaks(blocks: FlowBlock[]): number {
  return blocks.filter((b) => b.kind === 'sectionBreak').length;
}

/**
 * Assert that blocks contain the expected number of section breaks.
 *
 * @param blocks - Flow blocks to check
 * @param expected - Expected section break count
 * @throws AssertionError if section break count doesn't match
 */
export function assertSectionBreakCount(blocks: FlowBlock[], expected: number): void {
  const actual = countSectionBreaks(blocks);
  if (actual !== expected) {
    throw new Error(`Expected ${expected} section breaks but got ${actual}`);
  }
}

/**
 * Get all section break blocks from a flow block array.
 *
 * @param blocks - Flow blocks to filter
 * @returns Array of section break blocks
 */
export function getSectionBreaks(blocks: FlowBlock[]): SectionBreakBlock[] {
  return blocks.filter((b) => b.kind === 'sectionBreak') as SectionBreakBlock[];
}

/**
 * Assert that a section break has the expected type.
 *
 * @param sectionBreak - Section break block to check
 * @param expected - Expected section type
 * @throws AssertionError if type doesn't match
 */
export function assertSectionType(
  sectionBreak: SectionBreakBlock,
  expected: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage',
): void {
  if (sectionBreak.type !== expected) {
    throw new Error(`Expected section type '${expected}' but got '${sectionBreak.type}'`);
  }
}

/**
 * Assert that a section break has the expected orientation.
 *
 * @param sectionBreak - Section break block to check
 * @param expected - Expected orientation
 * @throws AssertionError if orientation doesn't match
 */
export function assertSectionOrientation(sectionBreak: SectionBreakBlock, expected: 'portrait' | 'landscape'): void {
  if (sectionBreak.orientation !== expected) {
    throw new Error(`Expected section orientation '${expected}' but got '${sectionBreak.orientation}'`);
  }
}

/**
 * Create a simple single-section document.
 *
 * @param paragraphCount - Number of paragraphs
 * @param sectionProps - Optional section properties
 * @returns PM document
 */
export function createSingleSectionDoc(paragraphCount: number, sectionProps?: TestSectionProps): PMNode {
  const paragraphs = Array.from({ length: paragraphCount }, (_, i) => `Paragraph ${i + 1}`);

  return createPMDocWithSections(
    [{ paragraphs: [] }],
    sectionProps ?? { orientation: 'portrait', pageSize: PAGE_SIZES.LETTER_PORTRAIT },
  );
}
