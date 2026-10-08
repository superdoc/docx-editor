import type { ColumnLayout, FlowBlock, SectionVerticalAlign } from '@superdoc/contracts';
import { cloneColumnLayout } from './column-utils.js';

/**
 * Section-level formatting properties that control page layout.
 *
 * Used to apply Word-style section breaks with custom page dimensions,
 * margins, columns, and orientation. Each section can have independent
 * formatting, enabling mixed layouts within a single document.
 *
 * @property margins - Page margin distances from page edges (in pixels)
 * @property pageSize - Page dimensions in pixels (width and height)
 * @property columns - Multi-column layout configuration
 * @property orientation - Page orientation (portrait or landscape)
 * @property vAlign - Vertical alignment of content within the section's pages
 */
export type SectionProps = {
  margins?: { header?: number; footer?: number; top?: number; right?: number; bottom?: number; left?: number };
  pageSize?: { w: number; h: number };
  columns?: ColumnLayout;
  orientation?: 'portrait' | 'landscape';
  vAlign?: SectionVerticalAlign;
};

const snapshotColumns = (columns?: ColumnLayout): ColumnLayout | undefined => {
  if (!columns) return undefined;
  return cloneColumnLayout(columns);
};

/**
 * Extracts section properties from a section break block if any are present.
 * Returns null if the block has no section-related properties.
 *
 * @param block - The section break block to extract section properties from
 * @returns SectionProps object if any properties exist, otherwise null
 */
const _snapshotSectionProps = (block: FlowBlock): SectionProps | null => {
  // Only SectionBreakBlock has section properties
  if (block.kind !== 'sectionBreak') return null;

  let hasProps = false;
  const props: SectionProps = {};
  if (
    block.margins &&
    (block.margins.header != null ||
      block.margins.footer != null ||
      block.margins.top != null ||
      block.margins.right != null ||
      block.margins.bottom != null ||
      block.margins.left != null)
  ) {
    hasProps = true;
    props.margins = {
      header: block.margins.header,
      footer: block.margins.footer,
      top: block.margins.top,
      right: block.margins.right,
      bottom: block.margins.bottom,
      left: block.margins.left,
    };
  }
  if (block.pageSize) {
    hasProps = true;
    props.pageSize = { w: block.pageSize.w, h: block.pageSize.h };
  }
  if (block.columns) {
    hasProps = true;
    props.columns = snapshotColumns(block.columns);
  }
  if (block.orientation) {
    hasProps = true;
    props.orientation = block.orientation;
  }
  if (block.vAlign) {
    hasProps = true;
    props.vAlign = block.vAlign;
  }
  return hasProps ? props : null;
};

/**
 * Pre-scans sectionBreak blocks to map each DOCX-derived boundary to the next section's properties.
 *
 * Word uses "end-tagged" sectPr semantics: the properties that apply to a section are stored
 * at the END of that section (on the following sectPr node). This function walks backwards
 * through the block list to build a lookahead map that tells the layout engine which properties
 * to use when starting a new page after each section break.
 *
 * Special cases:
 * - The first section (`isFirstSection=true`) keeps its own properties (no lookahead)
 * - Non-DOCX section breaks (`attrs.source !== 'sectPr'`) are ignored
 * - The final section break falls back to its own properties when there's no following sectPr
 *
 * Guard for PM-adapter blocks with sectionIndex:
 * The layout engine only applies this lookahead when a sectionBreak lacks `attrs.sectionIndex`.
 * PM-adapter blocks that have a sectionIndex already embed the upcoming section's metadata
 * directly on the block, so they don't need the map-based lookahead. This prevents double-
 * application and ensures the map is only used for synthetic test fixtures or legacy structures.
 *
 * @param blocks - Array of FlowBlocks to scan for section breaks
 * @returns Map from block index to the section properties that should apply AFTER that break
 *
 * @example
 * ```typescript
 * import { computeNextSectionPropsAtBreak } from './section-props';
 *
 * const map = computeNextSectionPropsAtBreak(blocks);
 * const propsForNextPage = map.get(sectionBreakIndex);
 * if (propsForNextPage) {
 *   // Apply these properties when starting the page after this break
 * }
 * ```
 */
export type SectionPropsScanCheckpoint = {
  index: number;
  total: number;
};

export function* computeNextSectionPropsAtBreakSteps(
  blocks: FlowBlock[],
  checkpointEveryBlocks: number | null = null,
  candidateIndices?: readonly number[],
): Generator<SectionPropsScanCheckpoint, Map<number, SectionProps>, void> {
  const nextSectionPropsAtBreak = new Map<number, SectionProps>();
  const docxBreakIndexes: number[] = [];

  for (const i of candidateIndices ?? Array.from({ length: blocks.length }, (_, index) => index)) {
    if (checkpointEveryBlocks != null && i % checkpointEveryBlocks === 0) {
      yield { index: i, total: blocks.length };
    }
    const block = blocks[i];
    if (!block || block.kind !== 'sectionBreak') continue;
    if (block.attrs?.source !== 'sectPr') continue;
    docxBreakIndexes.push(i);
  }

  const snapshotProps = (source: FlowBlock): SectionProps => {
    const props: SectionProps = {};
    // Type narrowing: only section breaks have these properties
    if (source.kind !== 'sectionBreak') return props;

    if (source.margins) {
      props.margins = {
        header: source.margins.header,
        footer: source.margins.footer,
        top: source.margins.top,
        right: source.margins.right,
        bottom: source.margins.bottom,
        left: source.margins.left,
      };
    }
    if (source.pageSize) {
      props.pageSize = { w: source.pageSize.w, h: source.pageSize.h };
    }
    if (source.columns) {
      props.columns = snapshotColumns(source.columns);
    }
    if (source.orientation) {
      props.orientation = source.orientation;
    }
    if (source.vAlign) {
      props.vAlign = source.vAlign;
    }
    return props;
  };

  for (let ordinal = 0; ordinal < docxBreakIndexes.length; ordinal += 1) {
    if (checkpointEveryBlocks != null && ordinal % checkpointEveryBlocks === 0) {
      yield { index: ordinal, total: docxBreakIndexes.length };
    }
    const index = docxBreakIndexes[ordinal]!;
    const current = blocks[index];
    const nextIndex = docxBreakIndexes[ordinal + 1];
    // Type narrowing: we know current is a section break from the earlier filter
    const useCurrent = current?.kind === 'sectionBreak' && current.attrs?.isFirstSection;
    const source = useCurrent || typeof nextIndex !== 'number' ? current : blocks[nextIndex];
    nextSectionPropsAtBreak.set(index, snapshotProps(source));
  }

  return nextSectionPropsAtBreak;
}

export function computeNextSectionPropsAtBreak(blocks: FlowBlock[]): Map<number, SectionProps> {
  const steps = computeNextSectionPropsAtBreakSteps(blocks);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
