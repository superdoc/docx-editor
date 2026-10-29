import type {
  FlowBlock,
  ImageBlock,
  DrawingBlock,
  ImageDrawing,
  ImageRun,
  BoxSpacing,
  ImageAnchor,
  ImageWrap,
  DrawingGeometry,
  ShapeGroupTransform,
  ShapeGroupChild,
  TextboxDrawing,
  Run,
  ParagraphAttrs,
  ParagraphSpacing,
  ParagraphIndent,
  ParagraphBorders,
  ParagraphBorder,
  ParagraphShading,
  TabStop,
  DropCapDescriptor,
  ParagraphFrame,
  TableBlock,
} from '@superdoc/contracts';
import { getParagraphInlineDirection, markerRunSignature, trackedChangeMetaSignature } from '@superdoc/contracts';
import { fieldAnnotationKey } from './field-annotation-key.js';
import { inlineBoxKey } from './inline-box-key.js';
import { hashRunVisualMarks } from './run-visual-marks.js';
import { hasTrackedChange, resolveTrackedChangesEnabled } from './tracked-changes-utils.js';

/**
 * Comment annotation structure attached to runs.
 */
type CommentAnnotation = {
  commentId?: string;
  internal?: boolean;
};

/**
 * Run type with validated comment annotations.
 */
type RunWithComments = Run & {
  comments: CommentAnnotation[];
};

/**
 * Type guard to check if a run has valid comment annotations.
 * Ensures the comments property exists, is an array, and is non-empty
 * before attempting to access comment metadata.
 *
 * @param run - The run to check for comments
 * @returns True if run has valid comments array, false otherwise
 */
function hasComments(run: Run): run is RunWithComments {
  return (
    'comments' in run &&
    Array.isArray((run as Partial<RunWithComments>).comments) &&
    (run as Partial<RunWithComments>).comments!.length > 0
  );
}

export type DirtyRegion = {
  firstDirtyIndex: number;
  lastStableIndex: number;
  insertedBlockIds: string[];
  deletedBlockIds: string[];
  /**
   * Existing blocks whose render-relevant content changed. This is distinct
   * from insertion/deletion churn and lets pagination establish the complete
   * affected frontier without guessing from only the first dirty ordinal.
   */
  changedBlockIds: string[];
  stableBlockIds: Set<string>;
};

/**
 * Computes dirty regions between two versions of a document's flow blocks.
 *
 * Identifies which blocks have changed, been added, or removed, and determines
 * the minimal region that needs to be re-laid out. Uses block IDs and tracked
 * change metadata to detect modifications.
 *
 * @param previous - Previous version of flow blocks
 * @param next - New version of flow blocks
 * @returns DirtyRegion describing the extent of changes
 *
 * @example
 * ```typescript
 * const region = computeDirtyRegions(oldBlocks, newBlocks);
 * if (region.isEntireDocument) {
 *   relayoutAll();
 * } else {
 *   relayoutRange(region.firstDirtyIndex, region.lastDirtyIndex);
 * }
 * ```
 */
export const computeDirtyRegions = (previous: FlowBlock[], next: FlowBlock[]): DirtyRegion => {
  const prevMap = new Map(previous.map((block, index) => [block.id, { block, index }]));
  const nextMap = new Map(next.map((block, index) => [block.id, { block, index }]));
  const stableBlockIds = new Set<string>();

  let firstDirtyIndex = next.length;
  let lastStableIndex = -1;
  let prevPointer = 0;
  let nextPointer = 0;

  while (prevPointer < previous.length && nextPointer < next.length) {
    const prevBlock = previous[prevPointer];
    const nextBlock = next[nextPointer];

    if (prevBlock.id === nextBlock.id && shallowEqual(prevBlock, nextBlock)) {
      lastStableIndex = nextPointer;
      stableBlockIds.add(prevBlock.id);
      prevPointer += 1;
      nextPointer += 1;
      continue;
    }

    firstDirtyIndex = Math.min(firstDirtyIndex, nextPointer);

    if (!nextMap.has(prevBlock.id)) {
      prevPointer += 1;
    } else if (!prevMap.has(nextBlock.id)) {
      nextPointer += 1;
    } else {
      prevPointer += 1;
      nextPointer += 1;
    }
  }

  const insertedBlockIds = next.filter((block) => !prevMap.has(block.id)).map((block) => block.id);

  const deletedBlockIds = previous.filter((block) => !nextMap.has(block.id)).map((block) => block.id);

  const changedBlockIds = next
    .filter((block) => prevMap.has(block.id) && !stableBlockIds.has(block.id))
    .map((block) => block.id);

  if (firstDirtyIndex === next.length && previous.length !== next.length) {
    firstDirtyIndex = Math.min(prevPointer, nextPointer);
  }

  return {
    firstDirtyIndex: firstDirtyIndex === next.length ? next.length : firstDirtyIndex,
    lastStableIndex,
    insertedBlockIds,
    deletedBlockIds,
    changedBlockIds,
    stableBlockIds,
  };
};

const shallowEqual = (a: FlowBlock, b: FlowBlock): boolean => {
  if (a.kind !== b.kind) return false;

  if (a.kind === 'image' && b.kind === 'image') {
    return imageBlocksEqual(a, b);
  }

  if (a.kind === 'paragraph' && b.kind === 'paragraph') {
    return paragraphBlocksEqual(a, b);
  }

  if (a.kind === 'drawing' && b.kind === 'drawing') {
    return drawingBlocksEqual(a, b);
  }

  if (a.kind === 'table' && b.kind === 'table') {
    return tableBlocksEqual(a, b);
  }

  return false;
};

/**
 * Compare the canonical, render-relevant table tree while deliberately
 * ignoring source anchors and paragraph PM coordinates. Those coordinates
 * shift after an earlier text edit without changing table geometry; treating
 * every unchanged table as dirty widens the affected frontier and defeats the
 * admitted table checkpoint profile.
 */
const tableBlocksEqual = (a: TableBlock, b: TableBlock): boolean => {
  if (a === b) return true;
  if (!jsonEqual(a.attrs, b.attrs)) return false;
  if (!jsonEqual(a.columnWidths, b.columnWidths)) return false;
  if (!jsonEqual(a.anchor, b.anchor)) return false;
  if (!jsonEqual(a.wrap, b.wrap)) return false;
  if (a.rows.length !== b.rows.length) return false;

  for (let rowIndex = 0; rowIndex < a.rows.length; rowIndex += 1) {
    if (!tableRowsEqual(a.rows[rowIndex]!, b.rows[rowIndex]!)) return false;
  }
  return true;
};

const tableRowsEqual = (rowA: TableBlock['rows'][number], rowB: TableBlock['rows'][number]): boolean => {
  if (rowA === rowB) return true;
  if (rowA.id !== rowB.id || !jsonEqual(rowA.attrs, rowB.attrs) || rowA.cells.length !== rowB.cells.length) {
    return false;
  }
  for (let cellIndex = 0; cellIndex < rowA.cells.length; cellIndex += 1) {
    const cellA = rowA.cells[cellIndex]!;
    const cellB = rowB.cells[cellIndex]!;
    if (
      cellA.id !== cellB.id ||
      cellA.rowSpan !== cellB.rowSpan ||
      cellA.colSpan !== cellB.colSpan ||
      !jsonEqual(cellA.attrs, cellB.attrs)
    ) {
      return false;
    }
    if (!optionalFlowBlocksEqual(cellA.blocks, cellB.blocks)) return false;
    if (!optionalFlowBlockEqual(cellA.paragraph, cellB.paragraph)) return false;
  }
  return true;
};

export type TableDirtyRowRange = {
  firstRow: number;
  previousLastRowExclusive: number;
  currentLastRowExclusive: number;
  globalGeometryInputsChanged: boolean;
  rowTopologyUnchanged: boolean;
};

export const computeTableDirtyRowRange = (previous: TableBlock, current: TableBlock): TableDirtyRowRange | null => {
  const globalGeometryInputsChanged =
    !jsonEqual(previous.attrs, current.attrs) ||
    !jsonEqual(previous.columnWidths, current.columnWidths) ||
    !jsonEqual(previous.anchor, current.anchor) ||
    !jsonEqual(previous.wrap, current.wrap);
  if (globalGeometryInputsChanged) {
    return {
      firstRow: 0,
      previousLastRowExclusive: previous.rows.length,
      currentLastRowExclusive: current.rows.length,
      globalGeometryInputsChanged: true,
      rowTopologyUnchanged: false,
    };
  }

  const sharedLength = Math.min(previous.rows.length, current.rows.length);
  let firstRow = 0;
  while (firstRow < sharedLength && tableRowsEqual(previous.rows[firstRow]!, current.rows[firstRow]!)) firstRow += 1;
  if (firstRow === sharedLength && previous.rows.length === current.rows.length) return null;

  let previousLastRowExclusive = previous.rows.length;
  let currentLastRowExclusive = current.rows.length;
  while (
    previousLastRowExclusive > firstRow &&
    currentLastRowExclusive > firstRow &&
    tableRowsEqual(previous.rows[previousLastRowExclusive - 1]!, current.rows[currentLastRowExclusive - 1]!)
  ) {
    previousLastRowExclusive -= 1;
    currentLastRowExclusive -= 1;
  }

  const rowTopologyUnchanged =
    previous.rows.length === current.rows.length &&
    previous.rows.every((row, rowIndex) => {
      const nextRow = current.rows[rowIndex];
      return (
        nextRow != null &&
        row.id === nextRow.id &&
        row.cells.length === nextRow.cells.length &&
        row.cells.every((cell, cellIndex) => {
          const nextCell = nextRow.cells[cellIndex];
          return (
            nextCell != null &&
            cell.id === nextCell.id &&
            (cell.rowSpan ?? 1) === (nextCell.rowSpan ?? 1) &&
            (cell.colSpan ?? 1) === (nextCell.colSpan ?? 1)
          );
        })
      );
    });

  return {
    firstRow,
    previousLastRowExclusive,
    currentLastRowExclusive,
    globalGeometryInputsChanged: false,
    rowTopologyUnchanged,
  };
};

const optionalFlowBlockEqual = (a: FlowBlock | undefined, b: FlowBlock | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && shallowEqual(a, b);
};

const optionalFlowBlocksEqual = (a: FlowBlock[] | undefined, b: FlowBlock[] | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (!optionalFlowBlockEqual(a[index], b[index])) return false;
  }
  return true;
};

/**
 * Generates a hash key from tracked change metadata for equality comparison.
 * Used to detect when runs have changed tracked change state.
 *
 * @param run - The run to extract tracked change key from
 * @returns Hash string, or empty string if no tracked change metadata
 */
const getTrackedChangeKey = (run: Run): string => {
  if (hasTrackedChange(run)) {
    return trackedChangeMetaSignature(run.trackedChange);
  }
  return '';
};

/**
 * Generates a hash key from comment annotations for equality comparison.
 * Includes comment IDs and internal flag to catch visibility changes.
 * Uses type guard to safely access comment metadata.
 *
 * @param run - The run to extract comment key from
 * @returns Hash string, or empty string if no comments
 */
const getCommentKey = (run: Run): string => {
  if (!hasComments(run)) return '';
  return run.comments.map((c) => `${c.commentId ?? ''}:${c.internal ? '1' : '0'}`).join('|');
};

// ============================================================================
// Paragraph Attribute Comparison Helpers
// ============================================================================
// These functions provide deep equality checks for paragraph-level attributes
// that affect visual rendering. Changes to any of these should trigger cache
// invalidation and re-layout.
//
// NOTE: When adding new visual paragraph attributes to ParagraphAttrs,
// ensure they are added to paragraphAttrsEqual below.
// ============================================================================

/**
 * Compares paragraph spacing properties for equality.
 * Spacing affects vertical layout between paragraphs and line height.
 */
const paragraphSpacingEqual = (a?: ParagraphSpacing, b?: ParagraphSpacing): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.before === b.before &&
    a.after === b.after &&
    a.line === b.line &&
    a.lineRule === b.lineRule &&
    a.beforeAutospacing === b.beforeAutospacing &&
    a.afterAutospacing === b.afterAutospacing
  );
};

/**
 * Compares paragraph indent properties for equality.
 * Indentation affects horizontal positioning of text.
 */
const paragraphIndentEqual = (a?: ParagraphIndent, b?: ParagraphIndent): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.left === b.left && a.right === b.right && a.firstLine === b.firstLine && a.hanging === b.hanging;
};

/**
 * Compares a single paragraph border for equality.
 * Checks border style, width, color, and spacing properties.
 *
 * @param a - First paragraph border to compare
 * @param b - Second paragraph border to compare
 * @returns True if borders are equal or both undefined/null
 */
const paragraphBorderEqual = (a?: ParagraphBorder, b?: ParagraphBorder): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.style === b.style && a.width === b.width && a.color === b.color && a.space === b.space;
};

/**
 * Compares paragraph borders (all four sides) for equality.
 * Borders affect the visual box around the paragraph.
 */
const paragraphBordersEqual = (a?: ParagraphBorders, b?: ParagraphBorders): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    paragraphBorderEqual(a.top, b.top) &&
    paragraphBorderEqual(a.right, b.right) &&
    paragraphBorderEqual(a.bottom, b.bottom) &&
    paragraphBorderEqual(a.left, b.left)
  );
};

/**
 * Compares paragraph shading/background for equality.
 * Shading affects the background fill of the paragraph.
 */
const paragraphShadingEqual = (a?: ParagraphShading, b?: ParagraphShading): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.fill === b.fill &&
    a.color === b.color &&
    a.val === b.val &&
    a.themeColor === b.themeColor &&
    a.themeFill === b.themeFill &&
    a.themeFillShade === b.themeFillShade &&
    a.themeFillTint === b.themeFillTint &&
    a.themeShade === b.themeShade &&
    a.themeTint === b.themeTint
  );
};

/**
 * Compares a single tab stop for equality.
 * Checks tab alignment type, position, and leader character.
 *
 * @param a - First tab stop to compare
 * @param b - Second tab stop to compare
 * @returns True if tab stops have identical properties
 */
const tabStopEqual = (a: TabStop, b: TabStop): boolean => {
  return a.val === b.val && a.pos === b.pos && a.leader === b.leader;
};

/**
 * Compares tab stop arrays for equality.
 * Tabs affect horizontal text positioning.
 */
const tabStopsEqual = (a?: TabStop[], b?: TabStop[]): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!tabStopEqual(a[i], b[i])) return false;
  }
  return true;
};

/**
 * Compares paragraph frame properties for equality.
 * Frames affect positioned/floating paragraph layout.
 */
const paragraphFrameEqual = (a?: ParagraphFrame, b?: ParagraphFrame): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.wrap === b.wrap &&
    a.x === b.x &&
    a.y === b.y &&
    a.xAlign === b.xAlign &&
    a.yAlign === b.yAlign &&
    a.hAnchor === b.hAnchor &&
    a.vAnchor === b.vAnchor
  );
};

/**
 * Compares drop cap descriptors for equality.
 * Drop caps affect the rendering of the first letter(s) of a paragraph.
 */
const dropCapDescriptorEqual = (a?: DropCapDescriptor, b?: DropCapDescriptor): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  // Compare mode and lines
  if (a.mode !== b.mode || a.lines !== b.lines) return false;
  // Compare the drop cap run
  const runA = a.run;
  const runB = b.run;
  // Safety: Check that both runs exist before accessing their properties
  if (!runA || !runB) return !runA && !runB;
  if (
    runA.text !== runB.text ||
    runA.fontFamily !== runB.fontFamily ||
    runA.fontSize !== runB.fontSize ||
    runA.bold !== runB.bold ||
    runA.italic !== runB.italic ||
    runA.color !== runB.color
  ) {
    return false;
  }
  return true;
};

/**
 * Compares all visual paragraph attributes for equality.
 *
 * This function checks every paragraph-level property that affects visual
 * rendering. When any of these change, the cache must be invalidated.
 *
 * Excluded properties (non-visual or handled separately):
 * - trackedChangesMode/trackedChangesEnabled: Handled separately in paragraphBlocksEqual
 * - wordLayout: Computed output data, not input
 * - sdt/containerSdt: Metadata that doesn't directly affect paragraph rendering
 * - styleId: Style resolution happens before FlowBlock creation
 * - numberingProperties: List handling is separate
 * - isTocEntry/tocInstruction: TOC metadata
 */
const paragraphAttrsEqual = (a?: ParagraphAttrs, b?: ParagraphAttrs): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;

  // Simple value comparisons
  if (
    a.alignment !== b.alignment ||
    a.contextualSpacing !== b.contextualSpacing ||
    a.suppressFirstLineIndent !== b.suppressFirstLineIndent ||
    a.dropCap !== b.dropCap ||
    a.decimalSeparator !== b.decimalSeparator ||
    a.tabIntervalTwips !== b.tabIntervalTwips ||
    a.keepNext !== b.keepNext ||
    a.keepLines !== b.keepLines ||
    (a.widowControl !== false) !== (b.widowControl !== false) ||
    getParagraphInlineDirection(a) !== getParagraphInlineDirection(b) ||
    a.floatAlignment !== b.floatAlignment
  ) {
    return false;
  }

  // Nested object comparisons
  if (!paragraphSpacingEqual(a.spacing, b.spacing)) return false;
  if (!paragraphIndentEqual(a.indent, b.indent)) return false;
  if (!paragraphBordersEqual(a.borders, b.borders)) return false;
  if (!paragraphShadingEqual(a.shading, b.shading)) return false;
  if (!tabStopsEqual(a.tabs, b.tabs)) return false;
  if (!paragraphFrameEqual(a.frame, b.frame)) return false;
  if (!dropCapDescriptorEqual(a.dropCapDescriptor, b.dropCapDescriptor)) return false;

  return true;
};

const paragraphBlocksEqual = (a: FlowBlock & { kind: 'paragraph' }, b: FlowBlock & { kind: 'paragraph' }): boolean => {
  // Check tracked changes mode and enabled state (handled separately from attrs)
  const aMode = (a.attrs as { trackedChangesMode?: string } | undefined)?.trackedChangesMode ?? 'review';
  const bMode = (b.attrs as { trackedChangesMode?: string } | undefined)?.trackedChangesMode ?? 'review';
  if (aMode !== bMode) return false;
  const aEnabled = resolveTrackedChangesEnabled(a.attrs, true);
  const bEnabled = resolveTrackedChangesEnabled(b.attrs, true);
  if (aEnabled !== bEnabled) return false;

  // Marker text/justification change requires a re-measure even when the
  // paragraph runs are unchanged (e.g. switching list style from decimal to
  // alpha changes "10." → "j." — different glyph widths and thus a different
  // suffix-tab width). `wordLayout` is computed output but its
  // marker.markerText is the canvas measurement input, so we treat a change
  // as a dirty signal rather than relying on `paragraphAttrsEqual`'s
  // wordLayout exclusion.
  const aMarker = a.attrs?.wordLayout?.marker;
  const bMarker = b.attrs?.wordLayout?.marker;
  if ((aMarker?.markerText ?? null) !== (bMarker?.markerText ?? null)) return false;
  if ((aMarker?.justification ?? null) !== (bMarker?.justification ?? null)) return false;
  if (markerRunSignature(aMarker?.run) !== markerRunSignature(bMarker?.run)) return false;

  // Check paragraph-level visual attributes (alignment, spacing, indent, borders, etc.)
  if (!paragraphAttrsEqual(a.attrs, b.attrs)) return false;

  const aInlineBoxes = a.inlineBoxes ?? [];
  const bInlineBoxes = b.inlineBoxes ?? [];
  if (aInlineBoxes.length !== bInlineBoxes.length) return false;
  for (let i = 0; i < aInlineBoxes.length; i += 1) {
    if (inlineBoxKey(aInlineBoxes[i]!) !== inlineBoxKey(bInlineBoxes[i]!)) return false;
  }

  // Check runs
  if (a.runs.length !== b.runs.length) return false;
  for (let i = 0; i < a.runs.length; i += 1) {
    const runA = a.runs[i];
    const runB = b.runs[i];
    if (runA.kind === 'image' || runB.kind === 'image') {
      if (runA.kind !== 'image' || runB.kind !== 'image') return false;
      if (!imageRunsEqual(runA, runB)) return false;
      continue;
    }

    // MathRun: compare textContent (derived from OMML) to detect equation changes
    if (runA.kind === 'math' || runB.kind === 'math') {
      if (runA.kind !== runB.kind) return false;
      if (runA.kind === 'math' && runB.kind === 'math') {
        if (runA.textContent !== runB.textContent) return false;
      }
      continue;
    }

    const leftText =
      'src' in runA || runA.kind === 'lineBreak' || runA.kind === 'break' || runA.kind === 'fieldAnnotation'
        ? ''
        : runA.text;
    const rightText =
      'src' in runB || runB.kind === 'lineBreak' || runB.kind === 'break' || runB.kind === 'fieldAnnotation'
        ? ''
        : runB.text;

    const mismatch =
      leftText !== rightText ||
      fieldAnnotationKey(runA) !== fieldAnnotationKey(runB) ||
      hashRunVisualMarks(runA) !== hashRunVisualMarks(runB) ||
      getTrackedChangeKey(runA) !== getTrackedChangeKey(runB) ||
      getCommentKey(runA) !== getCommentKey(runB);

    if (mismatch) return false;
  }
  return true;
};

const imageRunsEqual = (a: ImageRun, b: ImageRun): boolean => {
  return (
    a.src === b.src &&
    a.width === b.width &&
    a.height === b.height &&
    a.alt === b.alt &&
    a.title === b.title &&
    a.clipPath === b.clipPath &&
    a.distTop === b.distTop &&
    a.distBottom === b.distBottom &&
    a.distLeft === b.distLeft &&
    a.distRight === b.distRight &&
    a.verticalAlign === b.verticalAlign &&
    a.rotation === b.rotation &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    a.gain === b.gain &&
    a.blacklevel === b.blacklevel &&
    a.grayscale === b.grayscale &&
    jsonEqual(a.lum, b.lum) &&
    jsonEqual(a.hyperlink, b.hyperlink) &&
    jsonEqual(a.sdt, b.sdt) &&
    shallowRecordEqual(a.dataAttrs, b.dataAttrs)
  );
};

const imageBlocksEqual = (a: ImageBlock | ImageDrawing, b: ImageBlock | ImageDrawing): boolean => {
  return (
    a.src === b.src &&
    a.width === b.width &&
    a.height === b.height &&
    a.alt === b.alt &&
    a.title === b.title &&
    a.objectFit === b.objectFit &&
    a.display === b.display &&
    boxSpacingEqual(a.margin, b.margin) &&
    boxSpacingEqual(a.padding, b.padding) &&
    imageAnchorEqual(a.anchor, b.anchor) &&
    imageWrapEqual(a.wrap, b.wrap) &&
    shallowRecordEqual(a.attrs, b.attrs)
  );
};

const drawingBlocksEqual = (a: DrawingBlock, b: DrawingBlock): boolean => {
  if (a.drawingKind !== b.drawingKind) return false;
  if (!boxSpacingEqual(a.margin, b.margin)) return false;
  if (!boxSpacingEqual(a.padding, b.padding)) return false;
  if (!imageAnchorEqual(a.anchor, b.anchor)) return false;
  if (!imageWrapEqual(a.wrap, b.wrap)) return false;
  if (a.zIndex !== b.zIndex) return false;
  if (a.drawingContentId !== b.drawingContentId) return false;
  if (!jsonEqual(a.drawingContent, b.drawingContent)) return false;
  if (!shallowRecordEqual(a.attrs, b.attrs)) return false;

  if (a.drawingKind === 'image' && b.drawingKind === 'image') {
    return imageBlocksEqual(a, b);
  }

  if (
    (a.drawingKind === 'vectorShape' || a.drawingKind === 'textboxShape') &&
    (b.drawingKind === 'vectorShape' || b.drawingKind === 'textboxShape')
  ) {
    const textboxContentEqual =
      a.drawingKind !== 'textboxShape' ||
      b.drawingKind !== 'textboxShape' ||
      jsonEqual((a as TextboxDrawing).contentBlocks, (b as TextboxDrawing).contentBlocks);

    return (
      drawingGeometryEqual(a.geometry, b.geometry) &&
      a.shapeKind === b.shapeKind &&
      a.fillColor === b.fillColor &&
      a.strokeColor === b.strokeColor &&
      a.strokeWidth === b.strokeWidth &&
      a.textAlign === b.textAlign &&
      a.textVerticalAlign === b.textVerticalAlign &&
      jsonEqual(a.textInsets, b.textInsets) &&
      jsonEqual(a.textContent, b.textContent) &&
      jsonEqual(a.customGeometry, b.customGeometry) &&
      jsonEqual(a.lineEnds, b.lineEnds) &&
      jsonEqual(a.effectExtent, b.effectExtent) &&
      textboxContentEqual
    );
  }

  if (a.drawingKind === 'shapeGroup' && b.drawingKind === 'shapeGroup') {
    return (
      drawingGeometryEqual(a.geometry, b.geometry) &&
      shapeGroupTransformEqual(a.groupTransform, b.groupTransform) &&
      shapeGroupSizeEqual(a.size, b.size) &&
      shapeGroupChildrenEqual(a.shapes, b.shapes)
    );
  }

  if (a.drawingKind === 'chart' && b.drawingKind === 'chart') {
    return (
      drawingGeometryEqual(a.geometry, b.geometry) &&
      a.chartRelId === b.chartRelId &&
      jsonEqual(a.chartData, b.chartData)
    );
  }

  return true;
};

const boxSpacingEqual = (a?: BoxSpacing, b?: BoxSpacing): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
};

const imageAnchorEqual = (a?: ImageAnchor, b?: ImageAnchor): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.isAnchored === b.isAnchored &&
    a.hRelativeFrom === b.hRelativeFrom &&
    a.vRelativeFrom === b.vRelativeFrom &&
    a.alignH === b.alignH &&
    a.alignV === b.alignV &&
    a.offsetH === b.offsetH &&
    a.offsetV === b.offsetV &&
    a.behindDoc === b.behindDoc
  );
};

const imageWrapEqual = (a?: ImageWrap, b?: ImageWrap): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.type === b.type &&
    a.wrapText === b.wrapText &&
    a.distTop === b.distTop &&
    a.distBottom === b.distBottom &&
    a.distLeft === b.distLeft &&
    a.distRight === b.distRight &&
    a.behindDoc === b.behindDoc &&
    polygonEqual(a.polygon, b.polygon)
  );
};

const polygonEqual = (a?: number[][], b?: number[][]): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const rowA = a[i];
    const rowB = b[i];
    if (!rowA || !rowB) return false;
    if (rowA.length !== rowB.length) return false;
    for (let j = 0; j < rowA.length; j += 1) {
      if (rowA[j] !== rowB[j]) {
        return false;
      }
    }
  }
  return true;
};

const drawingGeometryEqual = (a?: DrawingGeometry, b?: DrawingGeometry): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.width === b.width &&
    a.height === b.height &&
    (a.rotation ?? 0) === (b.rotation ?? 0) &&
    Boolean(a.flipH) === Boolean(b.flipH) &&
    Boolean(a.flipV) === Boolean(b.flipV)
  );
};

const shapeGroupTransformEqual = (a?: ShapeGroupTransform, b?: ShapeGroupTransform): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.childX === b.childX &&
    a.childY === b.childY &&
    a.childWidth === b.childWidth &&
    a.childHeight === b.childHeight &&
    a.childOriginXEmu === b.childOriginXEmu &&
    a.childOriginYEmu === b.childOriginYEmu
  );
};

const shapeGroupSizeEqual = (
  a?: { width?: number; height?: number },
  b?: { width?: number; height?: number },
): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.width === b.width && a.height === b.height;
};

const shapeGroupChildrenEqual = (a: ShapeGroupChild[], b: ShapeGroupChild[]): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const childA = a[i];
    const childB = b[i];
    if (!childA || !childB) return false;
    if (childA.shapeType !== childB.shapeType) return false;
    if (!jsonEqual(childA.attrs, childB.attrs)) return false;
  }
  return true;
};

const shallowRecordEqual = (a?: Record<string, unknown>, b?: Record<string, unknown>): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const jsonEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};
