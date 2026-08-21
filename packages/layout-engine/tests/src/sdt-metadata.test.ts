import { describe, expect, it } from 'vitest';
import { toFlowBlocks } from './test-helpers/to-flow-blocks.js';
import type { FlowBlock, SdtMetadata } from '@superdoc/contracts';
import docFixture from '../fixtures/sdt-flow-input.json' assert { type: 'json' };

type BlockSummary = {
  blockId: string;
  isTocEntry?: boolean;
  tocInstruction?: string;
  blockMetadata?: SdtMetadata;
  runMetadata: Array<{
    text: string;
    metadata: SdtMetadata;
  }>;
};

const summarizeBlocks = (blocks: FlowBlock[]): BlockSummary[] =>
  blocks
    .map((block): BlockSummary | null => {
      if (block.kind !== 'paragraph') return null;

      const blockSdt = block.attrs?.sdt;
      const isToc = block.attrs?.isTocEntry ?? false;
      const runSummaries =
        block.runs
          ?.filter((run) => run.kind !== 'tab' && run.sdt)
          .map((run) => ({
            text: run.text,
            metadata: run.sdt,
          })) ?? [];

      if (!blockSdt && !runSummaries.length && !isToc) {
        return null;
      }

      return {
        blockId: block.id,
        isTocEntry: isToc || undefined,
        tocInstruction: block.attrs?.tocInstruction,
        blockMetadata: blockSdt,
        runMetadata: runSummaries,
      };
    })
    .filter((b): b is BlockSummary => b !== null);

describe('SDT metadata integration', () => {
  const { blocks } = toFlowBlocks(docFixture);
  const summary = summarizeBlocks(blocks);

  it('preserves inline structuredContent metadata', () => {
    const inlineScBlock = summary.find((b) => b.blockId === '0-paragraph');
    const inlineScRun = inlineScBlock?.runMetadata.find((r) => r.metadata?.type === 'structuredContent');

    expect(inlineScRun).toBeDefined();
    expect(inlineScRun?.metadata).toMatchObject({
      type: 'structuredContent',
      scope: 'inline',
      id: 'inline-sc-1',
      tag: 'inline_client_data',
      alias: 'Inline Client Data',
    });
    expect(inlineScRun?.text).toBe('ACME Corporation');
  });

  it('preserves fieldAnnotation metadata with full styling', () => {
    const paragraph = summary.find((b) => b.blockId === '0-paragraph');
    const clientNameRun = paragraph?.runMetadata.find((r) => r.metadata?.fieldId === 'CLIENT_NAME');

    expect(clientNameRun).toBeDefined();
    expect(clientNameRun?.metadata).toMatchObject({
      type: 'fieldAnnotation',
      variant: 'text',
      fieldId: 'CLIENT_NAME',
      fieldType: 'text',
      displayLabel: 'Client Name',
      defaultDisplayLabel: 'Client Name',
      fieldColor: '#980043',
      fontFamily: 'Calibri',
      fontSize: '12pt',
      hash: 'FA-CLIENT',
      sdtId: '1001',
      hidden: false,
      highlighted: true,
      isLocked: false,
      visibility: 'visible',
    });
  });

  it('preserves fieldAnnotation hidden and locked flags', () => {
    const paragraph = summary.find((b) => b.blockId === '0-paragraph');
    const hiddenRun = paragraph?.runMetadata.find((r) => r.metadata?.fieldId === 'HIDDEN_FIELD');

    expect(hiddenRun).toBeDefined();
    expect(hiddenRun?.metadata).toMatchObject({
      type: 'fieldAnnotation',
      fieldId: 'HIDDEN_FIELD',
      hash: 'FA-HIDDEN',
      hidden: true,
      isLocked: true,
      visibility: 'hidden',
    });
  });

  it('preserves block structuredContent metadata', () => {
    const blockScParagraph = summary.find((b) => b.blockId === '1-paragraph');

    expect(blockScParagraph?.blockMetadata).toBeDefined();
    expect(blockScParagraph?.blockMetadata).toMatchObject({
      type: 'structuredContent',
      scope: 'block',
      id: 'block-sc-1',
      tag: 'custom_block',
      alias: 'Custom Block',
    });
  });

  it('supports fieldAnnotation inside block structuredContent', () => {
    const blockScParagraph = summary.find((b) => b.blockId === '1-paragraph');
    const blockFieldRun = blockScParagraph?.runMetadata.find((r) => r.metadata?.fieldId === 'BLOCK_FIELD');

    expect(blockFieldRun).toBeDefined();
    expect(blockFieldRun?.metadata).toMatchObject({
      type: 'fieldAnnotation',
      fieldId: 'BLOCK_FIELD',
      fieldColor: '#00857A',
      sdtId: '2001',
    });
  });

  it('preserves nested block structuredContent content and metadata', () => {
    const nestedBlockDoc = {
      type: 'doc',
      content: [
        {
          type: 'structuredContentBlock',
          attrs: {
            id: 'outer-block-sdt',
            tag: 'outer_block',
            alias: 'Outer Block',
          },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Outer paragraph' }],
            },
            {
              type: 'structuredContentBlock',
              attrs: {
                id: 'inner-block-sdt',
                tag: 'inner_block',
                alias: 'Inner Block',
              },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Inner paragraph' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const { blocks: nestedBlocks } = toFlowBlocks(nestedBlockDoc);
    const innerParagraph = nestedBlocks.find(
      (block) => block.kind === 'paragraph' && block.runs?.some((run) => run.text === 'Inner paragraph'),
    );

    expect(innerParagraph).toBeDefined();
    expect(innerParagraph?.attrs?.sdt).toMatchObject({
      type: 'structuredContent',
      scope: 'block',
      id: 'inner-block-sdt',
      tag: 'inner_block',
      alias: 'Inner Block',
    });
  });

  it('handles nested structuredContent (inline within inline)', () => {
    const nestedBlock = summary.find((b) => b.blockId === '2-paragraph');
    const outerRun = nestedBlock?.runMetadata.find((r) => r.metadata?.id === 'nested-outer');
    const innerRun = nestedBlock?.runMetadata.find((r) => r.metadata?.id === 'nested-inner');

    expect(outerRun).toBeDefined();
    expect(outerRun?.metadata).toMatchObject({
      type: 'structuredContent',
      scope: 'inline',
      id: 'nested-outer',
      tag: 'outer_container',
      alias: 'Outer Container',
    });

    expect(innerRun).toBeDefined();
    expect(innerRun?.metadata).toMatchObject({
      type: 'structuredContent',
      scope: 'inline',
      id: 'nested-inner',
      tag: 'inner_container',
      alias: 'Inner Container',
    });
  });

  it('preserves documentSection metadata', () => {
    const sectionParagraph = summary.find((b) => b.blockId === '3-paragraph');

    expect(sectionParagraph?.blockMetadata).toBeDefined();
    expect(sectionParagraph?.blockMetadata).toMatchObject({
      type: 'documentSection',
      id: 'section-locked',
      title: 'Locked Section',
      description: 'Contains confidential terms',
      sectionType: 'locked',
      isLocked: true,
    });
  });

  it('supports fieldAnnotation inside documentSection', () => {
    const sectionParagraph = summary.find((b) => b.blockId === '3-paragraph');
    const sectionFieldRun = sectionParagraph?.runMetadata.find((r) => r.metadata?.fieldId === 'SECTION_FIELD');

    expect(sectionFieldRun).toBeDefined();
    expect(sectionFieldRun?.metadata).toMatchObject({
      type: 'fieldAnnotation',
      fieldId: 'SECTION_FIELD',
      displayLabel: 'Field in Section',
      hash: 'FA-SECTION',
      sdtId: '3001',
    });

    // Ensure both block-level and run-level metadata coexist
    expect(sectionParagraph?.blockMetadata?.type).toBe('documentSection');
    expect(sectionFieldRun?.metadata?.type).toBe('fieldAnnotation');
  });

  it('preserves docPartObject (TOC) metadata with correct uniqueId', () => {
    // Find standalone TOC (not inside a section) - should have unique ID 'docpart-toc'
    const tocParagraph = summary.find(
      (b) =>
        b.isTocEntry === true &&
        b.blockMetadata?.type === 'docPartObject' &&
        b.blockMetadata?.uniqueId === 'docpart-toc',
    );

    expect(tocParagraph).toBeDefined();
    expect(tocParagraph?.blockMetadata).toBeDefined();
    expect(tocParagraph?.blockMetadata).toMatchObject({
      type: 'docPartObject',
      gallery: 'Table of Contents',
      uniqueId: 'docpart-toc', // Should source from attrs.id
      instruction: 'TOC \\o "1-3" \\h \\z \\u',
    });
    expect(tocParagraph?.isTocEntry).toBe(true);
  });

  it.skip('preserves documentSection metadata on list items inside section', () => {
    // SKIPPED: List handling has been moved out of layout-engine (pm-adapter)
    // orderedList and bulletList are no longer converted to FlowBlocks
    // The rich content section contains a list - verify list items have section metadata
    // List items are embedded inside ListBlock.items[], not as separate FlowBlocks
    const listBlocks = blocks.filter((b) => b.kind === 'list');

    expect(listBlocks.length).toBeGreaterThanOrEqual(1);

    const sectionList = listBlocks.find((lb) =>
      lb.items?.some((item) => item.paragraph?.attrs?.sdt?.id === 'section-rich'),
    );

    expect(sectionList).toBeDefined();
    expect(sectionList?.items).toBeDefined();
    expect(sectionList?.items?.length).toBe(2);

    const firstItem = sectionList?.items?.[0];
    const secondItem = sectionList?.items?.[1];

    expect(firstItem?.paragraph?.runs?.[0]?.text).toBe('First list item');
    expect(firstItem?.paragraph?.attrs?.sdt).toMatchObject({
      type: 'documentSection',
      id: 'section-rich',
      title: 'Rich Content Section',
      sectionType: 'standard',
    });

    expect(secondItem?.paragraph?.runs?.[0]?.text).toBe('Second list item');
    expect(secondItem?.paragraph?.attrs?.sdt).toMatchObject({
      type: 'documentSection',
      id: 'section-rich',
    });
  });

  it('preserves documentSection metadata on images inside section', () => {
    // Find image blocks with section metadata
    const imageBlock = blocks.find(
      (b) => b.kind === 'image' && b.attrs?.sdt?.type === 'documentSection' && b.attrs?.sdt?.id === 'section-rich',
    );

    expect(imageBlock).toBeDefined();
    expect(imageBlock?.attrs?.sdt).toMatchObject({
      type: 'documentSection',
      id: 'section-rich',
      title: 'Rich Content Section',
    });
  });

  it('chains metadata for nested structuredContent inside documentSection', () => {
    // Find nested structured content paragraph inside section
    // The nested structuredContentBlock's paragraph gets section metadata applied
    const nestedBlock = blocks.find((b) => b.kind === 'paragraph' && b.runs?.[0]?.text === 'Nested structured content');

    expect(nestedBlock).toBeDefined();
    // Should have section metadata at block level
    expect(nestedBlock?.attrs?.sdt).toMatchObject({
      type: 'documentSection',
      id: 'section-rich',
      title: 'Rich Content Section',
    });
    // Note: Currently only outermost (section) metadata is preserved on block.
    // Nested structuredContent metadata is overwritten by section metadata.
    // In the future, we may want to support metadata chaining (array of SDT metadata).
  });

  it('preserves BOTH docPart and section metadata for TOC paragraphs inside documentSection', () => {
    // TOC paragraphs inside a documentSection should have BOTH metadata:
    // - attrs.sdt = docPartObject (for TOC functionality: gallery, instruction, uniqueId)
    // - attrs.containerSdt = documentSection (for painters: isLocked, title, sectionType)
    const tocInSectionBlocks = blocks.filter(
      (b) =>
        b.kind === 'paragraph' &&
        b.attrs?.isTocEntry === true &&
        b.attrs?.sdt?.type === 'docPartObject' &&
        b.attrs?.sdt?.uniqueId === 'toc-in-section',
    );

    // Should have 2 TOC entries from the nested TOC inside the section
    expect(tocInSectionBlocks.length).toBe(2);

    const firstTocEntry = tocInSectionBlocks.find((b) => b.runs?.[0]?.text === 'TOC Entry 1');
    const secondTocEntry = tocInSectionBlocks.find((b) => b.runs?.[0]?.text === 'TOC Entry 2');

    expect(firstTocEntry).toBeDefined();
    // Should have docPart metadata in attrs.sdt
    expect(firstTocEntry?.attrs?.sdt).toMatchObject({
      type: 'docPartObject',
      gallery: 'Table of Contents',
      uniqueId: 'toc-in-section',
    });
    // Should ALSO have section metadata in attrs.containerSdt
    expect(firstTocEntry?.attrs?.containerSdt).toMatchObject({
      type: 'documentSection',
      id: 'section-with-toc',
      title: 'Section with TOC',
      sectionType: 'locked',
      isLocked: true,
    });
    expect(firstTocEntry?.attrs?.isTocEntry).toBe(true);

    expect(secondTocEntry).toBeDefined();
    expect(secondTocEntry?.attrs?.sdt).toMatchObject({
      type: 'docPartObject',
      gallery: 'Table of Contents',
    });
    expect(secondTocEntry?.attrs?.containerSdt).toMatchObject({
      type: 'documentSection',
      id: 'section-with-toc',
      isLocked: true,
    });
    expect(secondTocEntry?.attrs?.isTocEntry).toBe(true);
  });

  it('applies section metadata to non-TOC paragraphs inside section with TOC', () => {
    // The introduction paragraph inside the section-with-toc should have section metadata
    // (only TOC paragraphs preserve their docPart metadata)
    const introParagraph = summary.find((b) =>
      blocks.find((bl) => bl.id === b.blockId && bl.runs?.[0]?.text === 'Introduction to locked TOC section'),
    );

    expect(introParagraph).toBeDefined();
    expect(introParagraph?.blockMetadata).toMatchObject({
      type: 'documentSection',
      id: 'section-with-toc',
      title: 'Section with TOC',
      sectionType: 'locked',
      isLocked: true,
    });
    // Should NOT be marked as TOC entry
    expect(introParagraph?.isTocEntry).toBeUndefined();
  });
});
