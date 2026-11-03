/**
 * Header/Footer Token Resolution Module
 *
 * Resolves dynamic page number tokens in header and footer blocks.
 * Unlike body content (which is laid out once per page), headers and footers
 * are measured once and reused across multiple pages. This module resolves
 * tokens for a specific page context.
 *
 * This module is called BEFORE header/footer measurement to ensure the correct
 * page number is used when calculating dimensions and caching layouts.
 */

import {
  formatChapterPageNumberText,
  formatPageNumberFieldValue,
  formatSectionPageNumberText,
  type DrawingBlock,
  type FlowBlock,
  type ListBlock,
  type PageNumberChapterSeparator,
  type PageNumberFormat,
  type ParagraphBlock,
  type TableBlock,
} from '@superdoc/contracts';

/**
 * Placeholder for a total-page-count field whose source document carries no
 * cached result while pagination is still provisional. An em dash reads as
 * "value not yet known" without committing to a wrong number.
 */
export const PROVISIONAL_PAGE_COUNT_PLACEHOLDER = '—';

/**
 * Options for {@link resolveHeaderFooterTokens}.
 */
export interface ResolveHeaderFooterTokensOptions {
  /**
   * When `false`, document-total fields (`NUMPAGES` / `SECTIONPAGES`) are NOT
   * substituted with the supplied totals: the run keeps its source-cached DOCX
   * result text, falling back to {@link PROVISIONAL_PAGE_COUNT_PLACEHOLDER}
   * when no cached result exists. `PAGE` always resolves — the physical page
   * a header/footer paints on is known even under partial pagination.
   * Defaults to `true` (exact totals), preserving existing caller behavior.
   */
  pageCountFieldsExact?: boolean;
  /** Page-aware STYLEREF resolver supplied after body pagination is known. */
  resolveStyleReference?: (request: {
    pageNumber: number;
    styleName: string;
    preferFollowing: boolean;
    instruction: string;
  }) => string | null;
}

/** Provisional text for a page-count field: cached DOCX result or em dash. */
function provisionalPageCountText(cachedText: string | undefined): string {
  return cachedText && cachedText.trim().length > 0 ? cachedText : PROVISIONAL_PAGE_COUNT_PLACEHOLDER;
}

/**
 * Walk every paragraph block reachable through `blocks`, including those
 * nested inside table cells (and tables nested inside cells). Used so the
 * page-number resolver finds tokens that live in footers like
 * `tableCell > paragraph > PAGE field` (SD-1332).
 */
function forEachParagraphBlock(blocks: FlowBlock[], visit: (para: ParagraphBlock) => void): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      visit(block as ParagraphBlock);
    } else if (block.kind === 'list') {
      const list = block as ListBlock;
      for (const item of list.items ?? []) {
        forEachParagraphBlock([item.paragraph], visit);
      }
    } else if (block.kind === 'table') {
      const table = block as TableBlock;
      for (const row of table.rows ?? []) {
        for (const cell of row.cells ?? []) {
          if (cell.blocks && cell.blocks.length > 0) {
            forEachParagraphBlock(cell.blocks as FlowBlock[], visit);
          } else if (cell.paragraph) {
            forEachParagraphBlock([cell.paragraph], visit);
          }
        }
      }
    } else if (block.kind === 'drawing') {
      const drawing = block as DrawingBlock;
      if (drawing.drawingKind === 'textboxShape' && Array.isArray(drawing.contentBlocks)) {
        forEachParagraphBlock(drawing.contentBlocks, visit);
      }
    }
  }
}

/**
 * Resolves page number tokens in a batch of header or footer blocks.
 *
 * Headers and footers can contain the same token types as body content
 * (pageNumber, totalPageCount, sectionPageCount), but they need to be resolved to the specific
 * page where the header/footer will appear. This function mutates the blocks
 * in-place to replace token placeholders with actual values.
 *
 * The function processes all variants in the batch (default, first, even, odd),
 * applying the same page context to all. This is correct because a single batch
 * represents headers/footers for one specific page.
 *
 * IMPORTANT: This function modifies blocks in-place. The calling code should
 * ensure that blocks are not shared between multiple page contexts, or should
 * create copies before calling this function.
 *
 * @param blocks - Array of FlowBlocks for a single header/footer variant
 * @param pageNumber - Current page number (1-indexed) where this header/footer appears
 * @param totalPages - Total number of pages in the document
 * @param pageNumberText - Optional preformatted page number string (e.g., "-1-")
 *
 * @example
 * ```typescript
 * // Resolve tokens for the header that will appear on page 3
 * const headerBlocks = adapter.getBlocks('header', 'default');
 * resolveHeaderFooterTokens(headerBlocks, 3, 10);
 * // Now headerBlocks contain "3" instead of "0" for PAGE field
 * // and "10" for NUMPAGES field
 * ```
 */
export function resolveHeaderFooterTokens(
  blocks: FlowBlock[],
  pageNumber: number,
  totalPages: number,
  pageNumberText?: string,
  displayPageNumber?: number,
  sectionPageCount?: number,
  pageNumberFormat?: PageNumberFormat,
  chapterNumberText?: string,
  chapterSeparator?: PageNumberChapterSeparator,
  options?: ResolveHeaderFooterTokensOptions,
): void {
  // Validate inputs
  if (!blocks || blocks.length === 0) {
    return;
  }

  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    console.warn('[resolveHeaderFooterTokens] Invalid pageNumber:', pageNumber, '- using 1 as fallback');
    pageNumber = 1;
  }

  if (!Number.isFinite(totalPages) || totalPages < 1) {
    console.warn('[resolveHeaderFooterTokens] Invalid totalPages:', totalPages, '- using 1 as fallback');
    totalPages = 1;
  }

  const pageCountFieldsExact = options?.pageCountFieldsExact !== false;
  const pageNumberStr = pageNumberText ?? String(pageNumber);
  const totalPagesStr = String(totalPages);
  const displayNumber = displayPageNumber ?? pageNumber;
  const sectionPageNumberFormat = pageNumberFormat ?? 'decimal';
  const sectionPageCountNumber = sectionPageCount || totalPages || 1;
  const sectionPageCountStr = String(sectionPageCountNumber);

  // Process every paragraph block, including those nested in table cells
  // (SD-1332). The page-number field can live in `tableCell > paragraph >
  // PAGE` inside a footer; the previous top-level-only walk silently
  // skipped those tokens and the digit never rendered.
  forEachParagraphBlock(blocks, (paraBlock) => {
    const resolvedStyleReferences = new Set<object>();
    for (const run of paraBlock.runs) {
      if (
        'crossReferenceMetadata' in run &&
        run.crossReferenceMetadata?.kind === 'styleRef' &&
        options?.resolveStyleReference
      ) {
        const styleReference = run.crossReferenceMetadata;
        if (resolvedStyleReferences.has(styleReference)) {
          run.text = '';
          continue;
        }
        resolvedStyleReferences.add(styleReference);
        run.text =
          options.resolveStyleReference({
            pageNumber,
            styleName: styleReference.target,
            preferFollowing: styleReference.preferFollowing === true,
            instruction: styleReference.instruction,
          }) ?? 'Error! No text of specified style in document.';
        continue;
      }
      // Type guard: only TextRun can have token property
      if ('token' in run && run.token) {
        if (run.token === 'pageNumber') {
          // Replace placeholder text with actual page number for measurement.
          // IMPORTANT: Do NOT delete run.token - the painter needs it to
          // re-resolve the correct page number at render time for each page.
          // The text here is for measurement purposes (digit width).
          run.text = run.pageNumberFieldFormat
            ? formatChapterPageNumberText({
                pageComponent: formatPageNumberFieldValue(displayNumber, run.pageNumberFieldFormat),
                chapterNumberText,
                chapterSeparator,
              })
            : chapterNumberText
              ? formatSectionPageNumberText({
                  displayNumber,
                  pageFormat: sectionPageNumberFormat,
                  chapterNumberText,
                  chapterSeparator,
                })
              : pageNumberStr;
        } else if (run.token === 'totalPageCount') {
          // Replace placeholder text with total page count for measurement.
          // IMPORTANT: Keep token for painter to re-resolve if needed.
          // Under provisional pagination the total is not authoritative:
          // preserve the source-cached DOCX result (em dash when absent).
          run.text = !pageCountFieldsExact
            ? provisionalPageCountText(run.text)
            : run.pageNumberFieldFormat
              ? formatPageNumberFieldValue(totalPages, run.pageNumberFieldFormat)
              : totalPagesStr;
        } else if (run.token === 'sectionPageCount') {
          run.text = !pageCountFieldsExact
            ? provisionalPageCountText(run.text)
            : run.pageNumberFieldFormat
              ? formatPageNumberFieldValue(sectionPageCountNumber, run.pageNumberFieldFormat)
              : sectionPageCountStr;
        }
        // Note: pageReference tokens should not appear in headers/footers typically,
        // but if they do, they'll be handled by the PAGEREF resolution logic
      }
    }
  });
}

/**
 * Creates a deep copy of header/footer blocks to avoid mutating shared data.
 *
 * Since token resolution modifies blocks in-place, and the same header/footer
 * content may be used across multiple pages (with different page numbers),
 * we need to create independent copies for each page.
 *
 * This function performs a deep clone of the block structure, including runs
 * and all nested properties, to ensure complete isolation.
 *
 * @param blocks - Original blocks to copy
 * @returns Deep copy of the blocks
 *
 * @example
 * ```typescript
 * const originalBlocks = adapter.getBlocks('header', 'default');
 * const blocksForPage1 = cloneHeaderFooterBlocks(originalBlocks);
 * const blocksForPage2 = cloneHeaderFooterBlocks(originalBlocks);
 * // Now we can resolve tokens differently for each page
 * resolveHeaderFooterTokens(blocksForPage1, 1, 10);
 * resolveHeaderFooterTokens(blocksForPage2, 2, 10);
 * ```
 */
export function cloneHeaderFooterBlocks(blocks: FlowBlock[]): FlowBlock[] {
  if (!blocks || blocks.length === 0) {
    return [];
  }

  return blocks.map(cloneHeaderFooterBlock);
}

function cloneHeaderFooterBlock(block: FlowBlock): FlowBlock {
  if (block.kind === 'paragraph') {
    const paraBlock = block as ParagraphBlock;
    return {
      ...paraBlock,
      runs: paraBlock.runs.map((run) => ({ ...run })),
      attrs: paraBlock.attrs ? { ...paraBlock.attrs } : undefined,
    };
  }
  if (block.kind === 'table') {
    // SD-1332: tables can host paragraphs with page-number tokens. Without
    // deep-cloning the table-row-cell tree the per-page mutations would
    // share state across pages and the same digit would leak between them.
    const table = block as TableBlock;
    return {
      ...table,
      rows: (table.rows ?? []).map((row) => ({
        ...row,
        cells: (row.cells ?? []).map((cell) => ({
          ...cell,
          paragraph: cell.paragraph ? (cloneHeaderFooterBlock(cell.paragraph) as ParagraphBlock) : cell.paragraph,
          blocks: cell.blocks
            ? (cell.blocks.map(cloneHeaderFooterBlock) as TableBlock['rows'][number]['cells'][number]['blocks'])
            : cell.blocks,
        })),
      })),
    } as TableBlock;
  }
  if (block.kind === 'list') {
    const list = block as ListBlock;
    return {
      ...list,
      items: (list.items ?? []).map((item) => ({
        ...item,
        paragraph: cloneHeaderFooterBlock(item.paragraph) as ParagraphBlock,
      })),
    } as ListBlock;
  }
  if (block.kind === 'drawing') {
    const drawing = block as DrawingBlock;
    if (drawing.drawingKind === 'textboxShape') {
      return {
        ...drawing,
        contentBlocks: drawing.contentBlocks.map((contentBlock) => cloneHeaderFooterBlock(contentBlock)),
        // Page-specific token text requires fresh content measurement.
        contentMeasures: undefined,
      } as DrawingBlock;
    }
  }
  // Other block types do not contain mutable paragraph-token trees.
  return { ...block };
}
