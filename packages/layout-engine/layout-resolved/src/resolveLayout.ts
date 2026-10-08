import type {
  Layout,
  Page,
  FlowMode,
  FlowBlock,
  Measure,
  Fragment,
  DrawingFragment,
  ImageFragment,
  ListItemFragment,
  ParaFragment,
  TableFragment,
  Line,
  ParagraphBorders,
  ResolvedLayout,
  ResolvedPage,
  ResolvedPaintItem,
  ResolvedFragmentItem,
  ResolvedParagraphContent,
  ListMeasure,
  ListBlock,
  ParagraphBlock,
  ParagraphMeasure,
  TableMeasure,
  LayoutStoryLocator,
  LineSegment,
  PageRefLocation,
  Run,
  SdtMetadata,
  TableBlock,
  TextRun,
} from '@superdoc/contracts';
import { buildPageRefAnchorMap, getSdtContainerKey, inlineBoxStyleSignature } from '@superdoc/contracts';
import { resolveParagraphContent } from './resolveParagraph.js';
import { resolveTableItem } from './resolveTable.js';
import { resolveImageItem } from './resolveImage.js';
import { resolveDrawingItem } from './resolveDrawing.js';
import type { BlockMapEntry } from './resolvedBlockLookup.js';
import { hashParagraphBorders } from './paragraphBorderHash.js';
import {
  deriveBlockVersion,
  derivePmInteriorVersion,
  deriveTableFragmentPaintVersion,
  deriveTableFragmentPmInteriorVersion,
  fragmentSignature,
  resolveFragmentLayoutIdentity,
  sourceAnchorSignature,
} from './versionSignature.js';
import { resolvePageRefText } from './resolvePageRefText.js';

const V2_RENDER_DIAGNOSTIC_RESOLVE_OWNER = Symbol.for('superdoc.v2.render-diagnostic.resolve-owner');

type V2RenderDiagnosticResolveOwner = (input: {
  blockIds: readonly string[];
  debugDetail: unknown;
  sourcePageRange: { firstPage: number; lastPage: number };
}) => Error | null;

export type ResolveLayoutInput = {
  layout: Layout;
  flowMode: FlowMode;
  blocks: FlowBlock[];
  measures: Measure[];
  /**
   * Whether body NUMPAGES / SECTIONPAGES fields may paint computed totals.
   * `false` is copied onto every resolved page so both dense and page-window
   * painters preserve the provisional text used during measurement.
   */
  pageCountFieldsExact?: boolean;
  /**
   * The document's font-mapping signature, folded into each block's paint-reuse version so a
   * runtime `fonts.map` change repaints (the same way a font load busts reuse via the global
   * epoch). Omitted/'' for default documents, leaving the version unchanged from before.
   */
  fontSignature?: string;
  bookmarks?: Map<string, number>;
  onProgress?: (stage: ResolveLayoutProgressStage) => void;
};

export type ResolveLayoutProgressStage =
  | 'block-map-complete'
  | 'page-ref-map-complete'
  | 'pages-25'
  | 'pages-50'
  | 'pages-75'
  | 'pages-complete'
  | 'block-versions-25'
  | 'block-versions-50'
  | 'block-versions-75'
  | 'block-versions-complete';

export function buildBlockMap(blocks: FlowBlock[], measures: Measure[]): Map<string, BlockMapEntry> {
  const map = new Map<string, BlockMapEntry>();
  for (let i = 0; i < blocks.length; i++) {
    map.set(blocks[i].id, { block: blocks[i], measure: measures[i] });
  }
  return map;
}

type PageRefResolutionContext = {
  sourcePage: number;
  anchorMap?: Map<string, PageRefLocation>;
};

type ParagraphPageRefResolution = {
  block: ParagraphBlock;
  fragment: ParaFragment;
  changed: boolean;
};

type ResolvedPageRefRunText = {
  text: string;
  originalLength: number;
};

function resolveParagraphPageRefs(
  fragment: ParaFragment,
  block: ParagraphBlock,
  measure: ParagraphMeasure,
  context?: PageRefResolutionContext,
): ParagraphPageRefResolution {
  const runTexts = collectResolvedPageRefRunTexts(block, context);

  if (runTexts.size === 0) {
    return { block, fragment, changed: false };
  }

  const nextRuns = resolvePageRefRuns(block, runTexts);
  const sourceLines = fragment.lines ?? measure.lines.slice(fragment.fromLine, fragment.toLine);
  const nextLines = sourceLines.map((line) => adjustLineForResolvedPageRefs(line, runTexts));

  return {
    block: { ...block, runs: nextRuns },
    fragment: { ...fragment, lines: nextLines },
    changed: true,
  };
}

function resolveParagraphPageRefBlock(
  block: ParagraphBlock,
  measure?: ParagraphMeasure,
  context?: PageRefResolutionContext,
): { block: ParagraphBlock; measure?: ParagraphMeasure; changed: boolean } {
  const runTexts = collectResolvedPageRefRunTexts(block, context);
  if (runTexts.size === 0) return { block, changed: false };
  return {
    block: { ...block, runs: resolvePageRefRuns(block, runTexts) },
    measure: measure
      ? { ...measure, lines: measure.lines.map((line) => adjustLineForResolvedPageRefs(line, runTexts)) }
      : undefined,
    changed: true,
  };
}

function collectResolvedPageRefRunTexts(
  block: ParagraphBlock,
  context?: PageRefResolutionContext,
): Map<number, ResolvedPageRefRunText> {
  const runTexts = new Map<number, ResolvedPageRefRunText>();
  if (!context?.anchorMap?.size) return runTexts;

  block.runs.forEach((run, index) => {
    if (!isPageReferenceTextRun(run)) return;
    const target = context.anchorMap?.get(run.pageRefMetadata.bookmarkId);
    if (!target) return;
    const resolvedText = resolvePageRefText({
      sourcePage: context.sourcePage,
      sourcePmPosition: run.pmStart,
      target,
      metadata: run.pageRefMetadata,
    });
    if (resolvedText !== run.text) {
      runTexts.set(index, { text: resolvedText, originalLength: run.text.length });
    }
  });

  return runTexts;
}

function resolvePageRefRuns(
  block: ParagraphBlock,
  runTexts: Map<number, ResolvedPageRefRunText>,
): ParagraphBlock['runs'] {
  return block.runs.map((run, index) =>
    runTexts.has(index) && isTextRun(run) ? { ...run, text: runTexts.get(index)!.text } : run,
  );
}

function resolveTablePageRefs(
  block: TableBlock,
  measure?: TableMeasure,
  context?: PageRefResolutionContext,
): { block: TableBlock; measure?: TableMeasure; changed: boolean } {
  if (!context?.anchorMap?.size) return { block, changed: false };

  let changed = false;
  let measureChanged = false;
  const measureRows = measure?.rows.slice();
  const rows = block.rows.map((row, rowIndex) => {
    let rowChanged = false;
    const measureRow = measureRows?.[rowIndex];
    const measureCells = measureRow?.cells.slice();
    const cells = row.cells.map((cell, cellIndex) => {
      let cellChanged = false;
      let nextParagraph = cell.paragraph;
      let nextCellMeasure = measureCells?.[cellIndex];
      if (cell.paragraph) {
        const resolved = resolveParagraphPageRefBlock(cell.paragraph, nextCellMeasure?.paragraph, context);
        nextParagraph = resolved.block;
        if (resolved.measure && nextCellMeasure) {
          nextCellMeasure = { ...nextCellMeasure, paragraph: resolved.measure };
        }
        cellChanged ||= resolved.changed;
      }

      let nextBlocks = cell.blocks;
      let nextBlockMeasures = nextCellMeasure?.blocks;
      if (cell.blocks) {
        nextBlocks = cell.blocks.map((childBlock, childIndex) => {
          const childMeasure = nextBlockMeasures?.[childIndex];
          if (childBlock.kind === 'paragraph') {
            const resolved = resolveParagraphPageRefBlock(
              childBlock,
              childMeasure?.kind === 'paragraph' ? (childMeasure as ParagraphMeasure) : undefined,
              context,
            );
            if (resolved.measure && nextBlockMeasures) {
              nextBlockMeasures = nextBlockMeasures.slice();
              nextBlockMeasures[childIndex] = resolved.measure;
            }
            cellChanged ||= resolved.changed;
            return resolved.block;
          }
          if (childBlock.kind === 'table') {
            const resolved = resolveTablePageRefs(
              childBlock,
              childMeasure?.kind === 'table' ? (childMeasure as TableMeasure) : undefined,
              context,
            );
            if (resolved.measure && nextBlockMeasures) {
              nextBlockMeasures = nextBlockMeasures.slice();
              nextBlockMeasures[childIndex] = resolved.measure;
            }
            cellChanged ||= resolved.changed;
            return resolved.block;
          }
          return childBlock;
        });
      }

      if (!cellChanged) return cell;
      rowChanged = true;
      if (nextCellMeasure && measureCells) {
        if (nextBlockMeasures && nextBlockMeasures !== nextCellMeasure.blocks) {
          nextCellMeasure = { ...nextCellMeasure, blocks: nextBlockMeasures };
        }
        measureCells[cellIndex] = nextCellMeasure;
        measureChanged = true;
      }
      return {
        ...cell,
        ...(nextParagraph ? { paragraph: nextParagraph } : {}),
        ...(nextBlocks ? { blocks: nextBlocks } : {}),
      };
    });

    if (!rowChanged) return row;
    changed = true;
    if (measureRow && measureCells && measureCells !== measureRow.cells) {
      measureRows![rowIndex] = { ...measureRow, cells: measureCells };
    }
    return { ...row, cells };
  });

  return changed
    ? {
        block: { ...block, rows },
        measure: measure && measureChanged && measureRows ? { ...measure, rows: measureRows } : measure,
        changed: true,
      }
    : { block, changed: false };
}

function resolveListItemPageRefs(
  block: ListBlock,
  itemId: string,
  measure?: ListMeasure,
  context?: PageRefResolutionContext,
): { block: ListBlock; measure?: ListMeasure; changed: boolean } {
  if (!context?.anchorMap?.size) return { block, changed: false };

  let changed = false;
  let measureChanged = false;
  const measureItems = measure?.items.slice();
  const items = block.items.map((item) => {
    if (item.id !== itemId) return item;
    const itemMeasureIndex = measureItems?.findIndex((candidate) => candidate.itemId === itemId) ?? -1;
    const itemMeasure = itemMeasureIndex >= 0 ? measureItems?.[itemMeasureIndex] : undefined;
    const resolved = resolveParagraphPageRefBlock(item.paragraph, itemMeasure?.paragraph, context);
    if (!resolved.changed) return item;
    if (resolved.measure && itemMeasure && measureItems) {
      measureItems[itemMeasureIndex] = { ...itemMeasure, paragraph: resolved.measure };
      measureChanged = true;
    }
    changed = true;
    return { ...item, paragraph: resolved.block };
  });

  return changed
    ? {
        block: { ...block, items },
        measure: measure && measureChanged && measureItems ? { ...measure, items: measureItems } : measure,
        changed: true,
      }
    : { block, changed: false };
}

function isTextRun(run: Run): run is TextRun {
  return (run.kind === 'text' || run.kind === undefined) && 'text' in run;
}

function isPageReferenceTextRun(
  run: Run,
): run is TextRun & { pageRefMetadata: NonNullable<TextRun['pageRefMetadata']> } {
  return isTextRun(run) && run.token === 'pageReference' && run.pageRefMetadata != null;
}

function adjustLineForResolvedPageRefs(line: Line, runTexts: Map<number, ResolvedPageRefRunText>): Line {
  let changed = false;
  const nextLine: Line = { ...line };

  for (const [runIndex, resolved] of runTexts) {
    if (runIndex < line.fromRun || runIndex > line.toRun) continue;
    changed = true;
    if (line.fromRun === runIndex) nextLine.fromChar = clampResolvedRunBoundary(line.fromChar, resolved);
    if (line.toRun === runIndex) nextLine.toChar = clampResolvedRunBoundary(line.toChar, resolved);
  }

  if (line.segments?.length) {
    const segments = line.segments.map((segment) => {
      const resolved = runTexts.get(segment.runIndex);
      if (resolved == null) return segment;
      changed = true;
      return {
        ...segment,
        fromChar: clampResolvedRunBoundary(segment.fromChar, resolved),
        toChar: clampResolvedRunBoundary(segment.toChar, resolved),
      } satisfies LineSegment;
    });
    nextLine.segments = segments;

    if (line.inlineBoxes?.length) {
      const remapLineOffset = (offset: number): number => {
        let originalCursor = 0;
        let resolvedCursor = 0;
        for (const segment of line.segments ?? []) {
          const originalLength = segment.toChar - segment.fromChar;
          const resolved = runTexts.get(segment.runIndex);
          const resolvedFrom = resolved ? clampResolvedRunBoundary(segment.fromChar, resolved) : segment.fromChar;
          const resolvedTo = resolved ? clampResolvedRunBoundary(segment.toChar, resolved) : segment.toChar;
          const resolvedLength = resolvedTo - resolvedFrom;
          if (offset <= originalCursor + originalLength) {
            if (offset === originalCursor + originalLength) return resolvedCursor + resolvedLength;
            return resolvedCursor + Math.min(offset - originalCursor, resolvedLength);
          }
          originalCursor += originalLength;
          resolvedCursor += resolvedLength;
        }
        return resolvedCursor;
      };
      nextLine.inlineBoxes = line.inlineBoxes
        .map((box) => ({ ...box, from: remapLineOffset(box.from), to: remapLineOffset(box.to) }))
        .filter((box) => box.to > box.from);
    }
  }

  return changed ? nextLine : line;
}

function clampResolvedRunBoundary(offset: number, resolved: ResolvedPageRefRunText): number {
  if (offset === resolved.originalLength) return resolved.text.length;
  return Math.min(offset, resolved.text.length);
}

function sumLineHeights(lines: Line[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to && i < lines.length; i++) {
    total += lines[i].lineHeight;
  }
  return total;
}

function computeFragmentHeight(fragment: Fragment, blockMap: Map<string, BlockMapEntry>): number {
  if (fragment.kind === 'image' || fragment.kind === 'drawing' || fragment.kind === 'table') {
    return fragment.height;
  }

  const entry = blockMap.get(fragment.blockId);
  if (!entry) return 0;

  if (fragment.kind === 'para') {
    if (fragment.lines) {
      return fragment.lines.reduce((sum, line) => sum + line.lineHeight, 0);
    }
    if (entry.measure.kind === 'paragraph') {
      return sumLineHeights(entry.measure.lines, fragment.fromLine, fragment.toLine);
    }
    return 0;
  }

  if (fragment.kind === 'list-item') {
    const listMeasure = entry.measure as ListMeasure;
    if (listMeasure.kind !== 'list') return 0;
    const item = listMeasure.items.find((it) => it.itemId === fragment.itemId);
    if (!item) return 0;
    return sumLineHeights(item.paragraph.lines, fragment.fromLine, fragment.toLine);
  }

  return 0;
}

function isAnchoredMediaFragment(fragment: Fragment): fragment is ImageFragment | DrawingFragment {
  return (fragment.kind === 'image' || fragment.kind === 'drawing') && fragment.isAnchored === true;
}

/**
 * Resolved layout only serializes wrapper stacking for anchored media.
 * Inline media intentionally keep their legacy DOM-order paint behavior.
 */
function resolveFragmentZIndex(fragment: Fragment): number | undefined {
  if (!isAnchoredMediaFragment(fragment)) {
    return undefined;
  }

  return fragment.zIndex;
}

/** Mirrors fragmentKey() from painter-dom renderer.ts for stable identity. */
function resolveFragmentId(fragment: Fragment): string {
  switch (fragment.kind) {
    case 'para':
      return `para:${fragment.blockId}:${fragment.fromLine}:${fragment.toLine}`;
    case 'list-item':
      return `list-item:${fragment.blockId}:${fragment.itemId}:${fragment.fromLine}:${fragment.toLine}`;
    case 'image':
      return `image:${fragment.blockId}:${fragment.x}:${fragment.y}`;
    case 'drawing':
      return `drawing:${fragment.blockId}:${fragment.x}:${fragment.y}`;
    case 'table': {
      const partialKey = fragment.partialRow
        ? `:${fragment.partialRow.fromLineByCell.join(',')}-${fragment.partialRow.toLineByCell.join(',')}`
        : '';
      return `table:${fragment.blockId}:${fragment.fromRow}:${fragment.toRow}${partialKey}`;
    }
  }
}

function resolveParagraphContentIfApplicable(
  fragment: Fragment,
  blockMap: Map<string, BlockMapEntry>,
  pageRefContext?: PageRefResolutionContext,
): ResolvedParagraphContent | undefined {
  if (fragment.kind !== 'para') return undefined;

  const entry = blockMap.get(fragment.blockId);
  if (!entry || entry.block.kind !== 'paragraph' || entry.measure.kind !== 'paragraph') return undefined;

  const paragraphBlock = entry.block as ParagraphBlock;
  const paragraphMeasure = entry.measure as ParagraphMeasure;
  const resolvedPageRefs = resolveParagraphPageRefs(
    fragment as ParaFragment,
    paragraphBlock,
    paragraphMeasure,
    pageRefContext,
  );

  return resolveParagraphContent(resolvedPageRefs.fragment, resolvedPageRefs.block, paragraphMeasure);
}

function resolveFragmentParagraphBorders(
  fragment: Fragment,
  blockMap: Map<string, BlockMapEntry>,
): ParagraphBorders | undefined {
  const entry = blockMap.get(fragment.blockId);
  if (!entry) return undefined;

  if (fragment.kind === 'para' && entry.block.kind === 'paragraph') {
    return (entry.block as ParagraphBlock).attrs?.borders;
  }

  if (fragment.kind === 'list-item' && entry.block.kind === 'list') {
    const block = entry.block as ListBlock;
    const item = block.items.find((listItem) => listItem.id === fragment.itemId);
    return item?.paragraph.attrs?.borders;
  }

  return undefined;
}

function resolveFragmentSdtContainerKey(fragment: Fragment, blockMap: Map<string, BlockMapEntry>): string | null {
  const entry = blockMap.get(fragment.blockId);
  if (!entry) return null;
  const block = entry.block;

  if (fragment.kind === 'para' && block.kind === 'paragraph') {
    return getSdtContainerKey(block.attrs?.sdt, block.attrs?.containerSdt);
  }

  if (fragment.kind === 'list-item' && block.kind === 'list') {
    const listBlock = block as ListBlock;
    const item = listBlock.items.find((listItem) => listItem.id === fragment.itemId);
    return getSdtContainerKey(item?.paragraph.attrs?.sdt, item?.paragraph.attrs?.containerSdt);
  }

  if (fragment.kind === 'table' && block.kind === 'table') {
    return getSdtContainerKey(block.attrs?.sdt, block.attrs?.containerSdt);
  }

  // An image/drawing fragment inside a block SDT must join that SDT's
  // boundary group like any other fragment kind — otherwise its extent is
  // invisible to computeSdtBoundaries() and the wrapper is sized from text
  // line heights alone, rendering too short when the image extends past
  // them (SD-3303).
  if (fragment.kind === 'image' && block.kind === 'image') {
    return getSdtContainerKey(block.attrs?.sdt, block.attrs?.containerSdt);
  }
  if (fragment.kind === 'drawing' && block.kind === 'drawing') {
    const attrs = block.attrs as { sdt?: SdtMetadata | null; containerSdt?: SdtMetadata | null } | undefined;
    return getSdtContainerKey(attrs?.sdt, attrs?.containerSdt);
  }

  return null;
}

export function computeBlockVersion(
  blockId: string,
  blockMap: Map<string, BlockMapEntry>,
  cache: Map<string, string>,
  fontSignature = '',
  fontConfigVersion?: number,
): string {
  const cached = cache.get(blockId);
  if (cached !== undefined) return cached;
  const entry = blockMap.get(blockId);
  if (!entry) {
    cache.set(blockId, 'missing');
    return 'missing';
  }
  // Prepend the document's font-mapping signature so a `fonts.map` change busts paint reuse the
  // same way a font load (getFontConfigVersion, folded inside deriveBlockVersion) does. The cache
  // is per resolveLayout pass, so the signature is constant here; '' leaves the version unchanged.
  const versioned = deriveFontAwareBlockVersion(entry.block, fontSignature, fontConfigVersion);
  cache.set(blockId, versioned);
  return versioned;
}

function deriveFontAwareBlockVersion(block: FlowBlock, fontSignature = '', fontConfigVersion?: number): string {
  const version = deriveBlockVersion(block, fontConfigVersion);
  return fontSignature ? `${fontSignature}|${version}` : version;
}

function applyPaintVersions(
  item: Extract<ResolvedPaintItem, { kind: 'fragment' }>,
  visualVersion: string,
  paintVersion = visualVersion,
): void {
  const evidenceVersion = sourceAnchorSignature(item.sourceAnchor);
  item.version = visualVersion;
  if (evidenceVersion) {
    item.evidenceVersion = evidenceVersion;
    item.paintCacheVersion = `${paintVersion}|source:${evidenceVersion}`;
  } else {
    item.paintCacheVersion = paintVersion;
  }
}

// Interior-pm keys are pure functions of the block's run pm layout; blocks are
// stable objects within (and usually across) resolves, so a WeakMap keyed on
// block identity makes the stamp O(1) for retained blocks.
const pmInteriorCache = new WeakMap<object, string>();

/**
 * Painter plan P5: stamp the interior-pm signature next to the (pm-free)
 * paint stamps. The painter's window remap tier shifts reused DOM in place
 * only when this key matched — equal stamps + equal fragment span + equal
 * interior offsets prove the drift is uniform; anything else rebuilds.
 */
function stampPmInteriorVersion(
  item: Extract<ResolvedPaintItem, { kind: 'fragment' }>,
  blockMap: Map<string, BlockMapEntry>,
  blockId: string,
  fragment: Fragment,
): void {
  const block = (item as { block?: FlowBlock }).block ?? blockMap.get(blockId)?.block;
  if (!block) return;
  if (block.kind === 'table' && fragment.kind === 'table') {
    item.pmInteriorVersion = deriveTableFragmentPmInteriorVersion(block, fragment);
    return;
  }
  let interior = pmInteriorCache.get(block);
  if (interior == null) {
    interior = derivePmInteriorVersion(block);
    pmInteriorCache.set(block, interior);
  }
  item.pmInteriorVersion = interior;
}

function lineInlineImageAlignmentSignature(lines: Line[] | undefined, fromLine: number, toLine: number): string {
  if (!lines || lines.length === 0) return '';
  const parts: string[] = [];
  for (let lineIndex = fromLine; lineIndex < toLine && lineIndex < lines.length; lineIndex += 1) {
    const alignments = lines[lineIndex]?.inlineImageAlignments;
    if (!alignments || alignments.length === 0) continue;
    const alignmentSignature = alignments
      .map(({ runIndex, verticalAlign }) => `${runIndex}:${verticalAlign}`)
      .join(',');
    parts.push(`${lineIndex}:${alignmentSignature}`);
  }
  return parts.length > 0 ? `inlineImageAlignments:${parts.join(';')}` : '';
}

function lineInlineBoxSignature(lines: Line[] | undefined, fromLine: number, toLine: number): string {
  if (!lines || lines.length === 0) return '';
  const parts: string[] = [];
  for (let lineIndex = fromLine; lineIndex < toLine && lineIndex < lines.length; lineIndex += 1) {
    const boxes = lines[lineIndex]?.inlineBoxes;
    if (!boxes || boxes.length === 0) continue;
    const boxSignature = JSON.stringify(
      boxes.map((box) => [
        box.id,
        box.from,
        box.to,
        box.x,
        box.width,
        box.top,
        box.height,
        box.startsRange ? 1 : 0,
        box.endsRange ? 1 : 0,
        inlineBoxStyleSignature(box.style),
        box.className ?? '',
        Object.entries(box.data ?? {}).sort(([left], [right]) => left.localeCompare(right)),
        box.cursor ?? '',
      ]),
    );
    parts.push(`${lineIndex}:${boxSignature}`);
  }
  return parts.length > 0 ? `inlineBoxes:${parts.join(';')}` : '';
}

function linePaintSignature(lines: Line[] | undefined, fromLine: number, toLine: number): string {
  return [lineInlineImageAlignmentSignature(lines, fromLine, toLine), lineInlineBoxSignature(lines, fromLine, toLine)]
    .filter(Boolean)
    .join('|');
}

function paragraphLinePaintSignature(fragment: ParaFragment, measure: ParagraphMeasure | undefined): string {
  if (fragment.lines) {
    return linePaintSignature(fragment.lines, 0, fragment.lines.length);
  }
  return linePaintSignature(measure?.lines, fragment.fromLine, fragment.toLine);
}

function listItemLinePaintSignature(fragment: ListItemFragment, measure: ListMeasure | undefined): string {
  const item = measure?.items.find((candidate) => candidate.itemId === fragment.itemId);
  return linePaintSignature(item?.paragraph.lines, fragment.fromLine, fragment.toLine);
}

function fragmentMeasurePaintSignature(
  fragment: Fragment,
  measure: Measure | undefined,
  listItemMeasure?: ListMeasure,
): string {
  if (fragment.kind === 'para' && measure?.kind === 'paragraph') {
    return paragraphLinePaintSignature(fragment as ParaFragment, measure as ParagraphMeasure);
  }
  if (fragment.kind === 'list-item') {
    const measureForList = listItemMeasure ?? (measure?.kind === 'list' ? (measure as ListMeasure) : undefined);
    return listItemLinePaintSignature(fragment as ListItemFragment, measureForList);
  }
  return '';
}

function appendMeasurePaintSignature(version: string, signature: string): string {
  return signature ? `${version}|measure:${signature}` : version;
}

export function resolveFragmentItem(
  fragment: Fragment,
  fragmentIndex: number,
  pageIndex: number,
  blockMap: Map<string, BlockMapEntry>,
  blockVersionCache: Map<string, string>,
  story?: LayoutStoryLocator,
  fontSignature = '',
  pageRefContext?: PageRefResolutionContext,
): ResolvedPaintItem {
  const sdtContainerKey = resolveFragmentSdtContainerKey(fragment, blockMap);
  const blockVer = computeBlockVersion(fragment.blockId, blockMap, blockVersionCache, fontSignature);
  const version = fragmentSignature(fragment, blockVer);
  const layoutSourceIdentity = resolveFragmentLayoutIdentity(fragment, story);

  // Route to kind-specific resolvers for types that carry extracted block/measure data.
  switch (fragment.kind) {
    case 'table': {
      const item = resolveTableItem(fragment as TableFragment, fragmentIndex, pageIndex, blockMap);
      const tablePageRefs = resolveTablePageRefs(item.block, item.measure, pageRefContext);
      if (tablePageRefs.changed) {
        item.block = tablePageRefs.block;
        if (tablePageRefs.measure) item.measure = tablePageRefs.measure;
      }
      if (sdtContainerKey != null) item.sdtContainerKey = sdtContainerKey;
      if (fragment.sourceAnchor != null) item.sourceAnchor = fragment.sourceAnchor;
      item.layoutSourceIdentity = layoutSourceIdentity;
      const tableVisualVersion = tablePageRefs.changed
        ? fragmentSignature(fragment, deriveFontAwareBlockVersion(tablePageRefs.block, fontSignature))
        : version;
      const tableFragmentPaintVersion = deriveTableFragmentPaintVersion(fragment, item.block, item.measure);
      applyPaintVersions(
        item,
        tableVisualVersion,
        fontSignature ? `${fontSignature}|${tableFragmentPaintVersion}` : tableFragmentPaintVersion,
      );
      stampPmInteriorVersion(item, blockMap, fragment.blockId, fragment);
      return item;
    }
    case 'image': {
      const item = resolveImageItem(fragment as ImageFragment, fragmentIndex, pageIndex, blockMap);
      if (sdtContainerKey != null) item.sdtContainerKey = sdtContainerKey;
      if (fragment.sourceAnchor != null) item.sourceAnchor = fragment.sourceAnchor;
      item.layoutSourceIdentity = layoutSourceIdentity;
      applyPaintVersions(item, version);
      stampPmInteriorVersion(item, blockMap, fragment.blockId, fragment);
      return item;
    }
    case 'drawing': {
      const item = resolveDrawingItem(fragment as DrawingFragment, fragmentIndex, pageIndex, blockMap);
      if (sdtContainerKey != null) item.sdtContainerKey = sdtContainerKey;
      if (fragment.sourceAnchor != null) item.sourceAnchor = fragment.sourceAnchor;
      item.layoutSourceIdentity = layoutSourceIdentity;
      applyPaintVersions(item, version);
      stampPmInteriorVersion(item, blockMap, fragment.blockId, fragment);
      return item;
    }
    default: {
      const entry = blockMap.get(fragment.blockId);
      const paragraphPageRefs =
        fragment.kind === 'para' && entry?.block.kind === 'paragraph' && entry.measure.kind === 'paragraph'
          ? resolveParagraphPageRefs(
              fragment as ParaFragment,
              entry.block as ParagraphBlock,
              entry.measure as ParagraphMeasure,
              pageRefContext,
            )
          : null;
      const listPageRefs =
        fragment.kind === 'list-item' && entry?.block.kind === 'list'
          ? resolveListItemPageRefs(
              entry.block as ListBlock,
              (fragment as ListItemFragment).itemId,
              entry.measure.kind === 'list' ? (entry.measure as ListMeasure) : undefined,
              pageRefContext,
            )
          : null;
      const itemVersion = paragraphPageRefs?.changed
        ? fragmentSignature(
            paragraphPageRefs.fragment,
            deriveFontAwareBlockVersion(paragraphPageRefs.block, fontSignature),
          )
        : listPageRefs?.changed
          ? fragmentSignature(fragment, deriveFontAwareBlockVersion(listPageRefs.block, fontSignature))
          : version;
      const measurePaintSignature = fragmentMeasurePaintSignature(
        paragraphPageRefs?.fragment ?? fragment,
        entry?.measure,
        listPageRefs?.measure,
      );
      // para, list-item — existing generic resolution
      const item: ResolvedFragmentItem = {
        kind: 'fragment',
        id: resolveFragmentId(fragment),
        pageIndex,
        x: fragment.x,
        y: fragment.y,
        width: fragment.width,
        height: computeFragmentHeight(fragment, blockMap),
        zIndex: resolveFragmentZIndex(fragment),
        fragmentKind: fragment.kind,
        fragment,
        blockId: fragment.blockId,
        fragmentIndex,
        content: paragraphPageRefs
          ? resolveParagraphContent(
              paragraphPageRefs.fragment,
              paragraphPageRefs.block,
              (entry as BlockMapEntry).measure as ParagraphMeasure,
            )
          : resolveParagraphContentIfApplicable(fragment, blockMap, pageRefContext),
        layoutSourceIdentity,
      };
      if (sdtContainerKey != null) item.sdtContainerKey = sdtContainerKey;
      if (fragment.sourceAnchor != null) item.sourceAnchor = fragment.sourceAnchor;

      // Pre-extract block/measure for para and list-item fragments so the painter
      // can prefer resolved data over a blockLookup read.
      if (entry) {
        if (fragment.kind === 'para' && entry.block.kind === 'paragraph' && entry.measure.kind === 'paragraph') {
          item.block = paragraphPageRefs?.block ?? (entry.block as ParagraphBlock);
          item.measure = entry.measure as ParagraphMeasure;
          if (item.sourceAnchor == null) item.sourceAnchor = (entry.block as ParagraphBlock).sourceAnchor;
        } else if (fragment.kind === 'list-item' && entry.block.kind === 'list' && entry.measure.kind === 'list') {
          const listBlock = listPageRefs?.block ?? (entry.block as ListBlock);
          const listItem = listBlock.items.find((candidate) => candidate.id === (fragment as ListItemFragment).itemId);
          item.block = listBlock;
          item.measure = listPageRefs?.measure ?? (entry.measure as ListMeasure);
          if (item.sourceAnchor == null) {
            item.sourceAnchor = listItem?.sourceAnchor ?? listItem?.paragraph.sourceAnchor ?? listBlock.sourceAnchor;
          }
        }
      }

      // Pre-compute paragraph border data for between-border grouping
      const borders = resolveFragmentParagraphBorders(fragment, blockMap);
      if (borders) {
        item.paragraphBorders = borders;
        item.paragraphBorderHash = hashParagraphBorders(borders);
      }

      if (fragment.kind === 'para') {
        const para = fragment as ParaFragment;
        if (para.pmStart != null) item.pmStart = para.pmStart;
        if (para.pmEnd != null) item.pmEnd = para.pmEnd;
        if (para.continuesFromPrev != null) item.continuesFromPrev = para.continuesFromPrev;
        if (para.continuesOnNext != null) item.continuesOnNext = para.continuesOnNext;
        if (para.markerWidth != null) item.markerWidth = para.markerWidth;
      } else if (fragment.kind === 'list-item') {
        const listItem = fragment as ListItemFragment;
        if (listItem.continuesFromPrev != null) item.continuesFromPrev = listItem.continuesFromPrev;
        if (listItem.continuesOnNext != null) item.continuesOnNext = listItem.continuesOnNext;
        if (listItem.markerWidth != null) item.markerWidth = listItem.markerWidth;
      }
      applyPaintVersions(item, itemVersion, appendMeasurePaintSignature(itemVersion, measurePaintSignature));
      stampPmInteriorVersion(item, blockMap, fragment.blockId, fragment);
      return item;
    }
  }
}

export type ResolvePageInput = {
  layout: Layout;
  page: Page;
  pageIndex: number;
  blockMap: Map<string, BlockMapEntry>;
  blockVersionCache: Map<string, string>;
  fontSignature?: string;
  pageRefAnchorMap?: Map<string, PageRefLocation>;
  pageCountFieldsExact?: boolean;
};

function contiguousFragmentPageRange(
  layout: Layout,
  pageIndex: number,
  blockId: string,
): { firstPage: number; lastPage: number } {
  const pageContainsBlock = (index: number): boolean =>
    layout.pages[index]?.fragments.some((fragment) => fragment.blockId === blockId) === true;
  let firstPage = pageIndex;
  let lastPage = pageIndex;
  while (firstPage > 0 && pageContainsBlock(firstPage - 1)) firstPage -= 1;
  while (lastPage + 1 < layout.pages.length && pageContainsBlock(lastPage + 1)) lastPage += 1;
  return { firstPage, lastPage };
}

/** Resolve one page without scanning or resolving sibling pages. */
export function resolvePage(input: ResolvePageInput): ResolvedPage {
  const { layout, page, pageIndex, blockMap, blockVersionCache, pageRefAnchorMap } = input;
  const fontSignature = input.fontSignature ?? '';
  const renderDiagnosticOwner = (
    input as ResolvePageInput & {
      [V2_RENDER_DIAGNOSTIC_RESOLVE_OWNER]?: V2RenderDiagnosticResolveOwner;
    }
  )[V2_RENDER_DIAGNOSTIC_RESOLVE_OWNER];
  return {
    id: `page-${pageIndex}`,
    index: pageIndex,
    // Painter plan P5x: every page carries its resolve pass's epoch so the
    // window painter can prove packets and extents share one layout pass.
    ...(layout.layoutEpoch != null ? { layoutEpoch: layout.layoutEpoch } : {}),
    columns: page.columns,
    columnRegions: page.columnRegions,
    number: page.number,
    width: page.size?.w ?? layout.pageSize.w,
    height: page.size?.h ?? layout.pageSize.h,
    items: page.fragments.map((fragment, fragmentIndex) => {
      try {
        return resolveFragmentItem(
          fragment,
          fragmentIndex,
          pageIndex,
          blockMap,
          blockVersionCache,
          undefined,
          fontSignature,
          pageRefAnchorMap ? { sourcePage: page.number, anchorMap: pageRefAnchorMap } : undefined,
        );
      } catch (error) {
        const owned = renderDiagnosticOwner?.({
          blockIds: [fragment.blockId],
          debugDetail: error,
          sourcePageRange: contiguousFragmentPageRange(layout, pageIndex, fragment.blockId),
        });
        if (owned) throw owned;
        throw error;
      }
    }),
    ...(input.pageCountFieldsExact === false ? { pageCountFieldsExact: false } : {}),
    margins: page.margins,
    pageBorders: page.pageBorders,
    footnoteReserved: page.footnoteReserved,
    displayNumber: page.displayNumber,
    numberText: page.numberText,
    effectivePageNumber: page.effectivePageNumber,
    sectionPageNumber: page.sectionPageNumber,
    pageNumberFormat: page.pageNumberFormat,
    pageNumberChapterText: page.pageNumberChapterText,
    pageNumberChapterSeparator: page.pageNumberChapterSeparator,
    vAlign: page.vAlign,
    baseMargins: page.baseMargins,
    sectionIndex: page.sectionIndex,
    sectionRefs: page.sectionRefs,
    orientation: page.orientation,
  };
}

export function resolveLayout(input: ResolveLayoutInput): ResolvedLayout {
  const { layout, flowMode, blocks, measures, bookmarks } = input;
  const fontSignature = input.fontSignature ?? '';
  const blockMap = buildBlockMap(blocks, measures);
  input.onProgress?.('block-map-complete');
  const blockVersionCache = new Map<string, string>();
  const pageRefAnchorMap = bookmarks?.size ? buildPageRefAnchorMap(bookmarks, layout, blocks, measures) : undefined;
  input.onProgress?.('page-ref-map-complete');

  const sectionPageCounts: Record<string, number> = {};
  const pages: ResolvedPage[] = [];
  const pageProgress = createQuartileProgress(layout.pages.length, 'pages');
  const renderDiagnosticOwner = (
    input as ResolveLayoutInput & {
      [V2_RENDER_DIAGNOSTIC_RESOLVE_OWNER]?: V2RenderDiagnosticResolveOwner;
    }
  )[V2_RENDER_DIAGNOSTIC_RESOLVE_OWNER];
  layout.pages.forEach((page, pageIndex) => {
    const sectionKey = String(page.sectionIndex ?? 0);
    sectionPageCounts[sectionKey] = (sectionPageCounts[sectionKey] ?? 0) + 1;
    const pageInput: ResolvePageInput = {
      layout,
      page,
      pageIndex,
      blockMap,
      blockVersionCache,
      fontSignature,
      pageRefAnchorMap,
      pageCountFieldsExact: input.pageCountFieldsExact,
    };
    if (renderDiagnosticOwner) {
      Object.defineProperty(pageInput, V2_RENDER_DIAGNOSTIC_RESOLVE_OWNER, {
        configurable: true,
        value: renderDiagnosticOwner,
      });
    }
    pages.push(resolvePage(pageInput));
    pageProgress(pageIndex + 1, input.onProgress);
  });

  const resolved: ResolvedLayout = {
    version: 1,
    flowMode,
    pageGap: layout.pageGap ?? 0,
    pages,
    ...(pages.length > 0 ? { sectionPageCounts } : {}),
    ...(layout.documentBackground ? { documentBackground: layout.documentBackground } : {}),
  };

  if (blocks.length > 0) {
    const versions: Record<string, string> = {};
    const blockProgress = createQuartileProgress(blocks.length, 'block-versions');
    blocks.forEach((block, index) => {
      versions[block.id] = computeBlockVersion(block.id, blockMap, blockVersionCache, fontSignature);
      blockProgress(index + 1, input.onProgress);
    });
    resolved.blockVersions = versions;
  }
  if (layout.layoutEpoch != null) {
    resolved.layoutEpoch = layout.layoutEpoch;
  }

  return resolved;
}

function createQuartileProgress(
  total: number,
  prefix: 'pages' | 'block-versions',
): (completed: number, notify: ResolveLayoutInput['onProgress']) => void {
  const thresholds = [0.25, 0.5, 0.75, 1].map((fraction) => Math.max(1, Math.ceil(total * fraction)));
  const labels = [`${prefix}-25`, `${prefix}-50`, `${prefix}-75`, `${prefix}-complete`] as const;
  let next = 0;
  return (completed, notify) => {
    while (next < thresholds.length && completed >= thresholds[next]!) {
      notify?.(labels[next]!);
      next += 1;
    }
  };
}
