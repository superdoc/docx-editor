/**
 * Structured Content Block Handler
 *
 * Processes SDT structuredContentBlock nodes, applying metadata to nested
 * paragraphs and tables while preserving their content structure.
 */

import type { FlowBlock, ListBlock, ParagraphBlock, SdtMetadata, TableBlock, TextRun } from '@superdoc/contracts';
import type { PMNode, NodeHandlerContext } from '../types.js';
import {
  resolveNodeSdtMetadata,
  applySdtMetadataToParagraphBlocks,
  applySdtMetadataToTableBlock,
  applySdtMetadataToListBlock,
} from './metadata.js';

const NON_RENDERED_STRUCTURAL_INLINE_TYPES = new Set([
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'permStart',
  'permEnd',
]);

function isVisuallyEmptyInlineNode(node: PMNode): boolean {
  if (node.type === 'text') {
    return (node.text ?? '').length === 0;
  }

  if (node.type === 'run' || node.type === 'bookmarkStart') {
    return !Array.isArray(node.content) || node.content.every(isVisuallyEmptyInlineNode);
  }

  return NON_RENDERED_STRUCTURAL_INLINE_TYPES.has(node.type);
}

function isEmptyParagraphNode(node: PMNode): boolean {
  if (node.type !== 'paragraph') return false;
  if (!Array.isArray(node.content) || node.content.length === 0) return true;

  return node.content.every(isVisuallyEmptyInlineNode);
}

function isVanishedParagraphNode(node: PMNode): boolean {
  const paragraphProperties = node.attrs?.paragraphProperties;
  if (!paragraphProperties || typeof paragraphProperties !== 'object') return false;

  const runProperties = (paragraphProperties as { runProperties?: unknown }).runProperties;
  if (!runProperties || typeof runProperties !== 'object') return false;

  return (runProperties as { vanish?: unknown }).vanish === true;
}

function asEmptyTextRun(run: unknown): TextRun | undefined {
  if (!run || typeof run !== 'object') return undefined;
  const candidate = run as TextRun;
  if (!('text' in candidate) || candidate.text !== '') return undefined;
  const kind = (candidate as { kind?: unknown }).kind;
  return kind == null || kind === 'text' ? candidate : undefined;
}

function applyPlaceholderToEmptyParagraphBlocks(
  paragraphBlocks: FlowBlock[],
  metadata: TextRun['sdt'],
  contentPos?: number,
): boolean {
  let applied = false;
  paragraphBlocks.forEach((block) => {
    if (block.kind !== 'paragraph') return;
    const run = block.runs.map(asEmptyTextRun).find(Boolean);
    if (!run) return;
    run.kind = 'text';
    run.text = '';
    run.sdt = metadata;
    run.visualPlaceholder = 'emptyBlockSdt';
    if (contentPos != null) {
      run.pmStart = contentPos;
      run.pmEnd = contentPos;
    }
    applied = true;
  });
  return applied;
}

function applyContainerSdtMetadata(blocks: FlowBlock[], metadata?: SdtMetadata): void {
  if (!metadata) return;

  blocks.forEach((block) => {
    if (block.kind === 'paragraph' || block.kind === 'table') {
      if (!block.attrs) block.attrs = {};
      block.attrs.containerSdt ??= metadata;
      return;
    }
    if (block.kind === 'list') {
      block.items.forEach((item) => {
        if (!item.paragraph.attrs) item.paragraph.attrs = {};
        item.paragraph.attrs.containerSdt ??= metadata;
      });
    }
  });
}

/**
 * Handle structured content block nodes.
 * Processes child paragraphs and tables, applying SDT metadata.
 *
 * @param node - Structured content block node to process
 * @param context - Shared handler context
 */
export function handleStructuredContentBlockNode(node: PMNode, context: NodeHandlerContext): void {
  const {
    blocks,
    recordBlockKind,
    nextBlockId,
    positions,
    defaultFont,
    defaultSize,
    trackedChangesConfig,
    bookmarks,
    hyperlinkConfig,
    converters,
    converterContext,
    enableComments,
    themeColors,
  } = context;
  const structuredContentMetadata = resolveNodeSdtMetadata(node, 'structuredContentBlock');
  const paragraphToFlowBlocks = converters?.paragraphToFlowBlocks;

  const emitPlaceholderBlock = (contentPos?: number): void => {
    if (!structuredContentMetadata) return;
    const placeholderRun: TextRun = {
      kind: 'text',
      text: '',
      fontFamily: defaultFont,
      fontSize: defaultSize,
      sdt: structuredContentMetadata,
      visualPlaceholder: 'emptyBlockSdt',
      ...(contentPos != null ? { pmStart: contentPos, pmEnd: contentPos } : {}),
    };
    const placeholderBlock: ParagraphBlock = {
      kind: 'paragraph',
      id: nextBlockId('paragraph'),
      runs: [placeholderRun],
      attrs: { sdt: structuredContentMetadata },
    };
    blocks.push(placeholderBlock);
    recordBlockKind?.(placeholderBlock.kind);
  };

  if (!Array.isArray(node.content) || node.content.length === 0) {
    const pos = positions.get(node);
    emitPlaceholderBlock(pos ? pos.start + 1 : undefined);
    return;
  }

  if (node.content.length === 1 && isEmptyParagraphNode(node.content[0])) {
    const isVanishedParagraph = isVanishedParagraphNode(node.content[0]);
    const paragraphPos = positions.get(node.content[0]);
    const blockPos = positions.get(node);
    const contentPos = paragraphPos ? paragraphPos.start + 1 : blockPos ? blockPos.start + 1 : undefined;

    if (paragraphToFlowBlocks) {
      const convertedBlocks = paragraphToFlowBlocks({
        para: node.content[0],
        nextBlockId,
        positions,
        trackedChangesConfig,
        bookmarks,
        hyperlinkConfig,
        themeColors,
        enableComments,
        converters,
        converterContext,
      });
      const paragraphBlocks = Array.isArray(convertedBlocks) ? convertedBlocks : [];
      applySdtMetadataToParagraphBlocks(
        paragraphBlocks.filter((b) => b.kind === 'paragraph') as ParagraphBlock[],
        structuredContentMetadata,
      );
      paragraphBlocks.forEach((block) => {
        if (block.kind === 'list') applySdtMetadataToListBlock(block as ListBlock, structuredContentMetadata);
      });
      if (applyPlaceholderToEmptyParagraphBlocks(paragraphBlocks, structuredContentMetadata, contentPos)) {
        paragraphBlocks.forEach((block) => {
          blocks.push(block);
          recordBlockKind?.(block.kind);
        });
        return;
      }
      paragraphBlocks.forEach((block) => {
        blocks.push(block);
        recordBlockKind?.(block.kind);
      });
      return;
    }

    if (isVanishedParagraph) return;
    emitPlaceholderBlock(contentPos);
    return;
  }

  // SD-1333: a documentPartObject is a transparent SDT wrapper. When it sits
  // as a direct child of a structuredContentBlock (e.g. a Signature SDT
  // wrapping a PAGE field), treat its inner paragraph/table children as if
  // they were direct children of the structuredContentBlock and apply the
  // outer SDT metadata to them.
  const visitChild = (child: PMNode): void => {
    if (child.type === 'paragraph') {
      if (!paragraphToFlowBlocks) {
        throw new Error('paragraphToFlowBlocks converter is required for structuredContentBlock paragraphs');
      }
      const paragraphBlocks = paragraphToFlowBlocks({
        para: child,
        nextBlockId,
        positions,
        trackedChangesConfig,
        bookmarks,
        hyperlinkConfig,
        themeColors,
        enableComments,
        converters,
        converterContext,
      });
      applySdtMetadataToParagraphBlocks(
        paragraphBlocks.filter((b) => b.kind === 'paragraph') as ParagraphBlock[],
        structuredContentMetadata,
      );
      paragraphBlocks.forEach((block) => {
        if (block.kind === 'list') applySdtMetadataToListBlock(block as ListBlock, structuredContentMetadata);
      });
      paragraphBlocks.forEach((block) => {
        blocks.push(block);
        recordBlockKind?.(block.kind);
      });
      return;
    }
    if (child.type === 'table') {
      const tableNodeToBlock = converters?.tableNodeToBlock;
      if (tableNodeToBlock) {
        const tableBlock = tableNodeToBlock(child, {
          nextBlockId,
          positions,
          trackedChangesConfig,
          bookmarks,
          hyperlinkConfig,
          themeColors,
          enableComments,
          converters,
          converterContext,
        });
        if (tableBlock) {
          applySdtMetadataToTableBlock(tableBlock as TableBlock, structuredContentMetadata);
          blocks.push(tableBlock);
          recordBlockKind?.(tableBlock.kind);
        }
      }
      return;
    }
    if (child.type === 'structuredContentBlock') {
      const blockStart = blocks.length;
      handleStructuredContentBlockNode(child, context);
      applyContainerSdtMetadata(blocks.slice(blockStart), structuredContentMetadata);
      return;
    }
    // SD-1333: documentPartObject is a transparent wrapper - recurse its content.
    // SD-3005: a block field (bibliography / index / table of authorities) generated
    // inside this content control is likewise transparent here; render its entry
    // paragraphs without advancing currentParagraphIndex, since
    // findParagraphsWithSectPr does not recurse structuredContentBlock.
    if (child.type === 'structuredContentBlock') {
      handleStructuredContentBlockNode(child, context);
      return;
    }
    if (
      Array.isArray(child.content) &&
      (child.type === 'documentPartObject' ||
        child.type === 'bibliography' ||
        child.type === 'index' ||
        child.type === 'tableOfAuthorities')
    ) {
      child.content.forEach(visitChild);
    }
  };

  node.content.forEach(visitChild);
}
