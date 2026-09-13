import {
  getParagraphInlineDirection,
  isNumberedNoteMarkerRun,
  trackedChangeMetaSignature,
  type DrawingBlock,
  type FlowBlock,
  type ImageBlock,
  type ImageRun,
  type ListBlock,
  type TableBlock,
  type ParagraphBlock,
  type ParagraphAttrs,
  type ParagraphFrame,
  type TableAttrs,
  type TableCellAttrs,
  type Run,
  type TextRun,
} from '@superdoc/contracts';
import type { FontMeasureCapabilities } from '@superdoc/font-system';
import { fieldAnnotationKey } from './field-annotation-key.js';
import { inlineBoxKey } from './inline-box-key.js';
import { hasTrackedChange, resolveTrackedChangesEnabled } from './tracked-changes-utils.js';
import { hashParagraphBorders, hashTableBorders, hashCellBorders } from './paragraph-hash-utils.js';
import { hashRunVisualMarks } from './run-visual-marks.js';
import { noteMarkerMeasureKey } from './note-marker-measure-key.js';

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

/**
 * Maximum cache size (number of entries)
 * Based on profiling: 500-page doc uses ~3,000 entries
 * 10K provides 3× safety margin while preventing unbounded growth
 */
const MAX_CACHE_SIZE = 10_000;

/**
 * Estimated memory per cache entry (bytes)
 * Used for memory usage reporting (rough estimate)
 */
const BYTES_PER_ENTRY_ESTIMATE = 5_000; // ~5KB per entry

/**
 * Creates a deterministic hash string for a paragraph frame.
 * Ensures consistent property ordering for reliable cache keys.
 *
 * @param frame - The paragraph frame to hash
 * @returns A deterministic hash string
 */
const hashParagraphFrame = (frame: ParagraphFrame): string => {
  const parts: string[] = [];
  if (frame.wrap !== undefined) parts.push(`w:${frame.wrap}`);
  if (frame.x !== undefined) parts.push(`x:${frame.x}`);
  if (frame.y !== undefined) parts.push(`y:${frame.y}`);
  if (frame.xAlign !== undefined) parts.push(`xa:${frame.xAlign}`);
  if (frame.yAlign !== undefined) parts.push(`ya:${frame.yAlign}`);
  if (frame.hAnchor !== undefined) parts.push(`ha:${frame.hAnchor}`);
  if (frame.vAnchor !== undefined) parts.push(`va:${frame.vAnchor}`);
  return parts.join(',');
};

/**
 * Returns the content blocks stored in a table cell.
 *
 * Table cells support both the legacy `paragraph` field and the newer `blocks`
 * collection. The cache must normalize those shapes the same way the renderer
 * does so both sides respond to the same content changes.
 *
 * @param cell - The table cell to read blocks from
 * @returns The cell's content blocks in render order
 */
const getTableCellBlocks = (cell: TableBlock['rows'][number]['cells'][number]): FlowBlock[] => {
  return cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
};

/**
 * Reads a clip path from either the block itself or its attrs record.
 *
 * @param block - The image-like block
 * @returns The clip path string, or an empty string when not present
 */
const readBlockClipPath = (block: { clipPath?: string; attrs?: Record<string, unknown> }): string => {
  if (typeof block.clipPath === 'string') {
    return block.clipPath;
  }
  if (typeof block.attrs?.clipPath === 'string') {
    return block.attrs.clipPath;
  }
  return '';
};

/**
 * Creates a compact geometry key for drawing blocks.
 *
 * @param geometry - The drawing geometry
 * @returns A deterministic geometry signature
 */
const hashDrawingGeometry = (geometry: {
  width: number;
  height: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}): string => {
  return [geometry.width, geometry.height, geometry.rotation ?? 0, geometry.flipH ? 1 : 0, geometry.flipV ? 1 : 0].join(
    ':',
  );
};

/**
 * Hashes an image-like block using the visual properties that can affect
 * measurement and rendering.
 *
 * @param block - The image or image drawing block
 * @returns A deterministic hash fragment for the block
 */
const hashImageLikeBlock = (
  block: Pick<
    ImageBlock,
    'src' | 'width' | 'height' | 'alt' | 'title' | 'objectFit' | 'rotation' | 'flipH' | 'flipV'
  > & {
    clipPath?: string;
    attrs?: Record<string, unknown>;
  },
): string => {
  return [
    block.src.slice(0, 50),
    block.width ?? '',
    block.height ?? '',
    block.alt ?? '',
    block.title ?? '',
    block.objectFit ?? '',
    readBlockClipPath(block),
    block.rotation ?? '',
    block.flipH ? 1 : 0,
    block.flipV ? 1 : 0,
  ].join(':');
};

/**
 * Hashes a list block by folding in each marker and paragraph item.
 *
 * @param block - The list block to hash
 * @returns A deterministic list hash fragment
 */
const hashListBlock = (block: ListBlock, capabilities?: FontMeasureCapabilities): string => {
  return block.items
    .map((item) => `${item.id}:${item.marker.text}:${hashRuns(item.paragraph, capabilities)}`)
    .join('|');
};

/**
 * Hashes a drawing block using the fields that affect its rendered footprint.
 *
 * @param block - The drawing block to hash
 * @returns A deterministic drawing hash fragment
 */
const hashDrawingBlock = (block: DrawingBlock, capabilities?: FontMeasureCapabilities): string => {
  if (block.drawingKind === 'image') {
    return `drawing:image:${hashImageLikeBlock(block)}`;
  }

  if (block.drawingKind === 'vectorShape') {
    return [
      'drawing:vector',
      hashDrawingGeometry(block.geometry),
      block.shapeKind ?? '',
      JSON.stringify(block.fillColor ?? null),
      JSON.stringify(block.strokeColor ?? null),
      block.strokeWidth ?? '',
      JSON.stringify(block.customGeometry ?? null),
      JSON.stringify(block.lineEnds ?? null),
      JSON.stringify(block.effectExtent ?? null),
      JSON.stringify(block.textContent ?? null),
      block.textAlign ?? '',
      block.textVerticalAlign ?? '',
      JSON.stringify(block.textInsets ?? null),
    ].join(':');
  }

  if (block.drawingKind === 'textboxShape') {
    return [
      'drawing:textbox',
      hashDrawingGeometry(block.geometry),
      block.shapeKind ?? '',
      JSON.stringify(block.fillColor ?? null),
      JSON.stringify(block.strokeColor ?? null),
      block.strokeWidth ?? '',
      JSON.stringify(block.customGeometry ?? null),
      JSON.stringify(block.lineEnds ?? null),
      JSON.stringify(block.effectExtent ?? null),
      JSON.stringify(block.textContent ?? null),
      block.textAlign ?? '',
      block.textVerticalAlign ?? '',
      JSON.stringify(block.textInsets ?? null),
      block.contentBlocks.map((contentBlock) => `${contentBlock.id}:${hashRuns(contentBlock, capabilities)}`).join('|'),
    ].join(':');
  }

  if (block.drawingKind === 'shapeGroup') {
    return [
      'drawing:shapeGroup',
      hashDrawingGeometry(block.geometry),
      JSON.stringify(block.groupTransform ?? null),
      JSON.stringify(block.shapes),
      block.size?.width ?? '',
      block.size?.height ?? '',
    ].join(':');
  }

  return [
    'drawing:chart',
    hashDrawingGeometry(block.geometry),
    block.chartData?.chartType ?? '',
    block.chartData?.subType ?? '',
    JSON.stringify(block.chartData?.series ?? []),
    block.chartRelId ?? '',
  ].join(':');
};

/**
 * Hashes a non-paragraph block embedded inside a table cell.
 *
 * The renderer versions these blocks through `deriveBlockVersion()`. The
 * measure cache must follow the same policy so parent-table repainting and
 * remeasurement stay aligned when nested tables, images, or drawings change.
 *
 * @param block - The non-paragraph cell block
 * @returns A deterministic hash fragment for the block
 */
const hashNonParagraphCellBlock = (
  block: Exclude<FlowBlock, ParagraphBlock>,
  capabilities?: FontMeasureCapabilities,
): string => {
  if (block.kind === 'table') {
    return `table:${hashRuns(block, capabilities)}`;
  }

  if (block.kind === 'image') {
    return `image:${hashImageLikeBlock(block)}`;
  }

  if (block.kind === 'drawing') {
    return hashDrawingBlock(block, capabilities);
  }

  if (block.kind === 'list') {
    return `list:${hashListBlock(block, capabilities)}`;
  }

  return `${block.kind}:${block.id}`;
};

/**
 * Generates a cache key hash from a block's content, incorporating text,
 * formatting, and embedded block data.
 *
 * Text content is preserved verbatim without whitespace normalization. Different
 * whitespace (multiple spaces, tabs, leading/trailing spaces) produces different
 * text measurements and must generate distinct cache keys to prevent incorrect
 * cache hits. See PR #1551 for context on the whitespace normalization bug.
 *
 * For image runs, includes the image source (first 50 chars) and dimensions to ensure
 * cache invalidation when image properties change. This is critical for converted
 * metafiles (WMF/EMF) where placeholder images may have different dimensions than
 * the original, preventing stale cached measurements from being served.
 *
 * @param block - The flow block to generate a hash for
 * @returns A string hash representing the block's run content and formatting
 */
/**
 * Content identity used by the measure cache's key (P8.4: also the adoption
 * key for previous-pass measures when block ids churn). Measures are a pure
 * function of (content, constraints, font signature); this hash IS the
 * content component of that key, so adopting a previous measure on hash
 * equality is exactly as sound as a cache hit.
 */
export const hashMeasureContent = (block: FlowBlock, capabilities?: FontMeasureCapabilities): string =>
  hashRuns(block, capabilities);

const hashRuns = (block: FlowBlock, capabilities?: FontMeasureCapabilities): string => {
  // FIX: For table blocks and paragraphs, include content AND formatting properties in hash.
  // Formatting properties that affect measurement: fontSize, fontFamily, bold, italic, color.
  // This ensures cache invalidation when text OR formatting changes.
  // Previously tables only included text content, causing stale measurements when changing formatting.
  if (block.kind === 'table') {
    const tableBlock = block as TableBlock;
    const cellHashes: string[] = [];

    // Safety: Check that rows array exists before iterating
    if (!tableBlock.rows) {
      return `${block.id}:table:`;
    }

    for (const row of tableBlock.rows) {
      // Safety: Check that cells array exists before iterating
      if (!row.cells) {
        continue;
      }
      if (row.attrs?.trackedChange) {
        cellHashes.push(`rtc:${trackedChangeMetaSignature(row.attrs.trackedChange)}`);
      }
      // Explicit row height (w:trHeight) drives row geometry. Like columnWidths
      // it lives on the block, not in a hashed border/text field, so a pure
      // row-height drag (setRowHeight) would otherwise yield an identical hash,
      // hit the shared header/footer measure cache, and not paint until an
      // unrelated edit. Round to absorb sub-pixel float jitter.
      if (row.attrs?.rowHeight) {
        const rh = row.attrs.rowHeight;
        cellHashes.push(`rh:${Math.round(rh.value)}:${rh.rule ?? 'auto'}`);
      }

      for (const cell of row.cells) {
        // Include cell-level attributes that affect rendering (borders, padding, etc.)
        // This ensures cache invalidation when cell formatting changes (e.g., remove borders).
        if (cell.attrs) {
          const cellAttrs = cell.attrs as TableCellAttrs;
          const cellAttrParts: string[] = [];
          if (cellAttrs.borders) {
            cellAttrParts.push(`cb:${hashCellBorders(cellAttrs.borders)}`);
          }
          if (cellAttrs.padding) {
            const p = cellAttrs.padding;
            cellAttrParts.push(`cp:${p.top ?? 0}:${p.right ?? 0}:${p.bottom ?? 0}:${p.left ?? 0}`);
          }
          if (cellAttrs.verticalAlign) {
            cellAttrParts.push(`va:${cellAttrs.verticalAlign}`);
          }
          if (cellAttrs.background) {
            cellAttrParts.push(`bg:${cellAttrs.background}`);
          }
          if (cellAttrs.trackedChange) {
            cellAttrParts.push(`tc:${trackedChangeMetaSignature(cellAttrs.trackedChange)}`);
          }
          if (cellAttrParts.length > 0) {
            cellHashes.push(`ca:${cellAttrParts.join(':')}`);
          }
        }

        // Support both new multi-block cells and legacy single paragraph cells
        const cellBlocks = getTableCellBlocks(cell);

        for (const cellBlock of cellBlocks) {
          if (cellBlock.kind !== 'paragraph') {
            cellHashes.push(`nb:${hashNonParagraphCellBlock(cellBlock, capabilities)}`);
            continue;
          }

          const paragraphBlock = cellBlock;

          // Safety: Check that runs array exists before iterating
          if (!paragraphBlock.runs) {
            continue;
          }

          for (const run of paragraphBlock.runs) {
            // Inline image / math runs carry dimensions that drive the cell's
            // content height (and therefore an auto-height row's geometry).
            // Mirror the non-table paragraph path below so resizing an in-cell
            // inline image invalidates the table measure cache; otherwise the
            // hash is identical to the pre-resize hash and the row keeps its
            // stale cached height until an unrelated edit perturbs the key.
            if (run.kind === 'image') {
              const imgRun = run as ImageRun;
              cellHashes.push(`img:${imgRun.src.slice(0, 50)}:${imgRun.width}x${imgRun.height}`);
              continue;
            }
            if (run.kind === 'math') {
              cellHashes.push(`math:${run.textContent}:${run.width}:${run.height}`);
              continue;
            }

            // Text is used verbatim without normalization - whitespace affects measurements
            // (Fix for PR #1551: previously /\s+/g normalization caused cache collisions)
            const text =
              isNumberedNoteMarkerRun(run) && 'text' in run
                ? noteMarkerMeasureKey(run as TextRun, capabilities)
                : 'text' in run && typeof run.text === 'string'
                  ? run.text
                  : '';

            const marks = hashRunVisualMarks(run);

            // Use type guard to safely access comment metadata
            const commentHash = hasComments(run)
              ? run.comments.map((c) => `${c.commentId ?? ''}:${c.internal ? '1' : '0'}`).join('|')
              : '';

            // Include tracked change metadata in hash
            let trackedKey = '';
            if (hasTrackedChange(run)) {
              trackedKey = `|tc:${trackedChangeMetaSignature(run.trackedChange)}`;
            }

            const commentKey = commentHash ? `|cm:${commentHash}` : '';
            cellHashes.push(`${text}:${marks}${trackedKey}${commentKey}`);
          }

          // Include paragraph-level attributes that affect layout/rendering in hash.
          // This ensures cache invalidation when paragraph formatting changes
          // (alignment, spacing, line height, indent, etc.) without text changes.
          // Fixes toolbar commands not updating for text inside tables.
          if (paragraphBlock.attrs) {
            const attrs = paragraphBlock.attrs as ParagraphAttrs;
            const parts: string[] = [];

            // Alignment
            if (attrs.alignment) parts.push(`al:${attrs.alignment}`);

            // Spacing (includes line height)
            if (attrs.spacing) {
              const s = attrs.spacing;
              if (s.before !== undefined) parts.push(`sb:${s.before}`);
              if (s.after !== undefined) parts.push(`sa:${s.after}`);
              if (s.line !== undefined) parts.push(`sl:${s.line}`);
              if (s.lineRule) parts.push(`sr:${s.lineRule}`);
            }

            // Indentation
            if (attrs.indent) {
              const ind = attrs.indent;
              if (ind.left !== undefined) parts.push(`il:${ind.left}`);
              if (ind.right !== undefined) parts.push(`ir:${ind.right}`);
              if (ind.firstLine !== undefined) parts.push(`if:${ind.firstLine}`);
              if (ind.hanging !== undefined) parts.push(`ih:${ind.hanging}`);
            }

            // Borders
            if (attrs.borders) {
              parts.push(`br:${hashParagraphBorders(attrs.borders)}`);
            }

            // Shading
            if (attrs.shading) {
              const sh = attrs.shading;
              if (sh.fill) parts.push(`shf:${sh.fill}`);
              if (sh.color) parts.push(`shc:${sh.color}`);
            }

            // Direction
            const cellDir = getParagraphInlineDirection(attrs);
            if (cellDir) parts.push(`dir:${cellDir}`);

            if (parts.length > 0) {
              cellHashes.push(`pa:${parts.join(':')}`);
            }
          }
          if (paragraphBlock.inlineBoxes?.length) {
            cellHashes.push(`ib:${paragraphBlock.inlineBoxes.map(inlineBoxKey).join(';')}`);
          }
        }
      }
    }
    // Include table-level attributes that affect rendering (borders, etc.)
    // This ensures cache invalidation when table formatting changes (e.g., remove borders).
    let tableAttrsKey = '';
    if (tableBlock.attrs) {
      const tblAttrs = tableBlock.attrs as TableAttrs;
      const tableAttrParts: string[] = [];
      if (tblAttrs.borders) {
        tableAttrParts.push(`tb:${hashTableBorders(tblAttrs.borders)}`);
      }
      if (tblAttrs.borderCollapse) {
        tableAttrParts.push(`bc:${tblAttrs.borderCollapse}`);
      }
      if (tblAttrs.cellSpacing !== undefined) {
        const cs = tblAttrs.cellSpacing;
        const csKey =
          typeof cs === 'number'
            ? `cs:n:${cs}`
            : `cs:${(cs as { value?: number; type?: string }).value ?? 0}:${(cs as { value?: number; type?: string }).type ?? 'px'}`;
        tableAttrParts.push(csKey);
      }
      if (tableAttrParts.length > 0) {
        tableAttrsKey = `|ta:${tableAttrParts.join(':')}`;
      }
    }

    // Column widths drive table geometry but live on the block, not block.attrs.
    // Without them in the key, a pure column-width resize (which changes no
    // border/text/attr) yields an identical hash, so the shared header/footer
    // measure cache returns a stale TableMeasure and the resize only appears
    // after an unrelated edit (e.g. typing) perturbs the hash. Round to absorb
    // sub-pixel float jitter between the resolver path (unrounded twips*px) and
    // the readTableColumnWidthsPx fallback (Math.round).
    let columnWidthsKey = '';
    if (tableBlock.columnWidths?.length) {
      columnWidthsKey = `|cw:${tableBlock.columnWidths.map((w) => Math.round(w)).join(',')}`;
    }

    const contentHash = cellHashes.join('|');
    return `${block.id}:table:${contentHash}${tableAttrsKey}${columnWidthsKey}`;
  }

  // Top-level drawings keep stable block ids across property-only mutations
  // (for example a textbox resize). Their geometry and visual payload must be
  // part of the shared measure-cache key; keying only by id reuses the old
  // DrawingMeasure after canonical OOXML has already changed. Table-cell
  // drawings take the same hash through hashNonParagraphCellBlock above.
  if (block.kind === 'drawing') return `${block.id}:${hashDrawingBlock(block, capabilities)}`;

  if (block.kind !== 'paragraph') return block.id;
  const trackedMode =
    (block.attrs && 'trackedChangesMode' in block.attrs && block.attrs.trackedChangesMode) || 'review';
  const trackedEnabled = resolveTrackedChangesEnabled(block.attrs, true);
  const runsHash = block.runs
    .map((run) => {
      // For image runs, include src hash and dimensions in the cache key.
      // This ensures cache invalidation when image source or size changes.
      if (run.kind === 'image') {
        const imgRun = run as ImageRun;
        // Hash the src (first 50 chars to keep key manageable) + dimensions
        const srcHash = imgRun.src.slice(0, 50);
        return `img:${srcHash}:${imgRun.width}x${imgRun.height}`;
      }

      if (run.kind === 'fieldAnnotation') {
        return `fa:${fieldAnnotationKey(run)}`;
      }

      // MathRun: use textContent as cache key so equation edits invalidate
      if (run.kind === 'math') {
        return `math:${run.textContent}:${run.width}:${run.height}`;
      }

      // Text is used verbatim without normalization - whitespace affects measurements
      // (Fix for PR #1551: previously /\s+/g normalization caused cache collisions)
      const text =
        'src' in run || run.kind === 'lineBreak' || run.kind === 'break'
          ? ''
          : isNumberedNoteMarkerRun(run)
            ? noteMarkerMeasureKey(run as TextRun, capabilities)
            : (run.text ?? '');
      const marks = hashRunVisualMarks(run);

      // Include tracked change metadata in hash
      let trackedKey = '';
      if (hasTrackedChange(run)) {
        trackedKey = `|tc:${trackedChangeMetaSignature(run.trackedChange)}`;
      }

      return `${text}:${marks}${trackedKey}`;
    })
    .join('|');

  // Include list/numbering properties in hash to invalidate cache when list status changes
  let numberingKey = '';
  if (block.attrs) {
    const attrs = block.attrs as {
      numberingProperties?: { numId?: number | string; ilvl?: number };
      wordLayout?: { marker?: { markerText?: string } };
    };
    if (attrs.numberingProperties) {
      const np = attrs.numberingProperties;
      // Use distinct sentinel values to avoid hash collision:
      // - "<NULL>" for missing marker (wordLayout.marker not present)
      // - "<EMPTY>" for empty marker text (marker exists but markerText is empty string)
      // - actual marker text otherwise
      let markerTextKey: string;
      if (!attrs.wordLayout?.marker) {
        markerTextKey = '<NULL>';
      } else {
        const markerText = attrs.wordLayout.marker.markerText;
        markerTextKey = markerText === '' ? '<EMPTY>' : (markerText ?? '<NULL>');
      }
      numberingKey = `|num:${np.numId ?? ''}:${np.ilvl ?? 0}:${markerTextKey}`;
    }
  }

  // Include paragraph-level attributes that affect layout/rendering in hash.
  // This ensures cache invalidation when paragraph formatting changes (alignment, spacing, etc.)
  // without text changes. Previously only runs were hashed, causing stale measurements
  // when toolbar commands like "align center" were used.
  let paragraphAttrsKey = '';
  if (block.attrs) {
    const attrs = block.attrs as ParagraphAttrs;

    // Build a deterministic hash of visual paragraph attributes
    const parts: string[] = [];

    // Alignment (most common change via toolbar)
    if (attrs.alignment) parts.push(`al:${attrs.alignment}`);

    // Spacing
    if (attrs.spacing) {
      const s = attrs.spacing;
      if (s.before !== undefined) parts.push(`sb:${s.before}`);
      if (s.after !== undefined) parts.push(`sa:${s.after}`);
      if (s.line !== undefined) parts.push(`sl:${s.line}`);
      if (s.lineRule) parts.push(`sr:${s.lineRule}`);
    }

    // Indentation
    if (attrs.indent) {
      const ind = attrs.indent;
      if (ind.left !== undefined) parts.push(`il:${ind.left}`);
      if (ind.right !== undefined) parts.push(`ir:${ind.right}`);
      if (ind.firstLine !== undefined) parts.push(`if:${ind.firstLine}`);
      if (ind.hanging !== undefined) parts.push(`ih:${ind.hanging}`);
    }

    // Borders (use deterministic hash for consistent cache keys)
    if (attrs.borders) {
      parts.push(`br:${hashParagraphBorders(attrs.borders)}`);
    }

    // Shading
    if (attrs.shading) {
      const sh = attrs.shading;
      if (sh.fill) parts.push(`shf:${sh.fill}`);
      if (sh.color) parts.push(`shc:${sh.color}`);
    }

    // Tabs
    if (attrs.tabs && attrs.tabs.length > 0) {
      const tabsHash = attrs.tabs.map((t) => `${t.val ?? ''}:${t.pos ?? ''}:${t.leader ?? ''}`).join(',');
      parts.push(`tb:${tabsHash}`);
    }

    // Direction
    const dir = getParagraphInlineDirection(attrs);
    if (dir) parts.push(`dir:${dir}`);

    // Pagination properties
    if (attrs.keepNext) parts.push('kn');
    if (attrs.keepLines) parts.push('kl');
    if (attrs.widowControl === false) parts.push('wc:0');

    // Float alignment
    if (attrs.floatAlignment) parts.push(`fa:${attrs.floatAlignment}`);

    // Contextual spacing
    if (attrs.contextualSpacing) parts.push('cs');

    // Suppress first line indent
    if (attrs.suppressFirstLineIndent) parts.push('sfi');

    // Drop cap
    if (attrs.dropCap) parts.push(`dc:${attrs.dropCap}`);
    if (attrs.dropCapDescriptor) {
      const dcd = attrs.dropCapDescriptor;
      parts.push(`dcd:${dcd.mode ?? ''}:${dcd.lines ?? ''}`);
    }

    // Frame (use deterministic hash for consistent cache keys)
    if (attrs.frame) {
      parts.push(`fr:${hashParagraphFrame(attrs.frame)}`);
    }

    // Tab settings
    if (attrs.tabIntervalTwips !== undefined) parts.push(`ti:${attrs.tabIntervalTwips}`);
    if (attrs.decimalSeparator) parts.push(`ds:${attrs.decimalSeparator}`);

    if (parts.length > 0) {
      paragraphAttrsKey = `|pa:${parts.join(':')}`;
    }
  }

  const inlineBoxesKey = block.inlineBoxes?.length ? `|ib:${block.inlineBoxes.map(inlineBoxKey).join(';')}` : '';
  return `${trackedMode}:${trackedEnabled ? 'on' : 'off'}|${runsHash}${numberingKey}${paragraphAttrsKey}${inlineBoxesKey}`;
};

/**
 * Cache statistics with LRU eviction tracking
 */
export type MeasureCacheStats = {
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
  clears: number;
  /**
   * Number of entries evicted due to LRU policy
   */
  evictions: number;
  /**
   * Current cache size (number of entries)
   */
  size: number;
  /**
   * Estimated memory usage (bytes)
   */
  memorySizeEstimate: number;
};

const createStats = (): MeasureCacheStats => ({
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
  clears: 0,
  evictions: 0,
  size: 0,
  memorySizeEstimate: 0,
});

/**
 * Maximum allowed dimension for cache keys.
 * Prevents memory exhaustion from pathological inputs.
 */
const MAX_DIMENSION = 1_000_000;

declare const preparedMeasureCacheKeyBrand: unique symbol;
export type PreparedMeasureCacheKey = string & { readonly [preparedMeasureCacheKeyBrand]: true };

/**
 * LRU-enhanced MeasureCache
 *
 * Key improvements:
 * 1. Bounded size: max 10,000 entries
 * 2. LRU eviction: Evicts least recently used when full
 * 3. O(1) access and eviction using Map insertion order
 * 4. Memory usage estimation
 * 5. Eviction statistics
 *
 * Performance characteristics:
 * - get(): O(1) - Map lookup + delete + re-insert for LRU tracking
 * - set(): O(1) - eviction (delete first key) + insert
 * - invalidate(): O(k) - where k = cached variants for the requested block IDs
 * - Memory: Bounded at 10K entries ~= 50-100MB
 */
export class MeasureCache<T> {
  private cache = new Map<string, T>();
  private keysByBlockId = new Map<string, Set<string>>();
  private blockIdByKey = new Map<string, string>();
  private stats: MeasureCacheStats = createStats();

  /**
   * Retrieve a cached measure for the given block and dimensions.
   * Returns undefined if the block is null/undefined, lacks an ID, or if no cached value exists.
   *
   * @param block - The flow block to look up (may be null/undefined)
   * @param width - The width dimension for cache key
   * @param height - The height dimension for cache key
   * @returns The cached value or undefined
   */
  public get(
    block: FlowBlock | null | undefined,
    width: number,
    height: number,
    fontSignature = '',
    capabilities?: FontMeasureCapabilities,
  ): T | undefined {
    return this.getPrepared(this.prepareKey(block, width, height, fontSignature, capabilities));
  }

  /**
   * Compose the complete content, constraint, and font key once for a cache
   * read followed by an insertion in the same measurement transaction.
   */
  public prepareKey(
    block: FlowBlock | null | undefined,
    width: number,
    height: number,
    fontSignature = '',
    capabilities?: FontMeasureCapabilities,
  ): PreparedMeasureCacheKey | undefined {
    if (!block || !block.id) return undefined;
    return this.composeKey(block, width, height, fontSignature, capabilities) as PreparedMeasureCacheKey;
  }

  public getPrepared(key: PreparedMeasureCacheKey | undefined): T | undefined {
    if (key === undefined) return undefined;
    const value = this.cache.get(key);

    if (value !== undefined) {
      this.stats.hits += 1;

      // Move to end (most recently used)
      // JavaScript Map maintains insertion order, so delete + re-insert moves to end
      this.cache.delete(key);
      this.cache.set(key, value);

      return value;
    } else {
      this.stats.misses += 1;
      return undefined;
    }
  }

  /**
   * Store a measure in the cache for the given block and dimensions.
   * Silently returns if the block is null/undefined or lacks an ID.
   *
   * @param block - The flow block to cache (may be null/undefined)
   * @param width - The width dimension for cache key
   * @param height - The height dimension for cache key
   * @param value - The value to cache
   */
  public set(
    block: FlowBlock | null | undefined,
    width: number,
    height: number,
    value: T,
    fontSignature = '',
    capabilities?: FontMeasureCapabilities,
  ): void {
    this.setPrepared(this.prepareKey(block, width, height, fontSignature, capabilities), block?.id, value);
  }

  public setPrepared(key: PreparedMeasureCacheKey | undefined, blockId: string | undefined, value: T): void {
    if (key === undefined || !blockId) return;

    // If key already exists, delete it first (will be re-added at end)
    const alreadyCached = this.cache.has(key);
    if (alreadyCached) {
      this.cache.delete(key);
    }

    // Check if cache is full (before adding new entry)
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry (first in Map)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.deleteKey(oldestKey);
        this.stats.evictions += 1;
      }
    }

    // Add new entry (goes to end of Map)
    this.cache.set(key, value);
    if (!alreadyCached) {
      this.blockIdByKey.set(key, blockId);
      const keys = this.keysByBlockId.get(blockId) ?? new Set<string>();
      keys.add(key);
      this.keysByBlockId.set(blockId, keys);
    }
    this.stats.sets += 1;

    // Update size stats
    this.updateSizeStats();
  }

  /**
   * Invalidates cached measurements for specific block IDs.
   * Removes all cache entries whose keys start with any of the provided block IDs.
   *
   * @param blockIds - Array of block IDs to invalidate from the cache
   *
   * @example
   * ```typescript
   * cache.invalidate(['block-123', 'block-456']);
   * ```
   */
  public invalidate(blockIds: string[]): void {
    let removed = 0;
    for (const id of new Set(blockIds)) {
      const keys = this.keysByBlockId.get(id);
      if (!keys) continue;
      for (const key of [...keys]) {
        if (this.deleteKey(key)) {
          removed += 1;
        }
      }
    }
    this.stats.invalidations += removed;
    this.updateSizeStats();
  }

  /**
   * Clears all cached measurements and resets statistics.
   * Use when performing a full document re-layout.
   */
  public clear(): void {
    this.cache.clear();
    this.keysByBlockId.clear();
    this.blockIdByKey.clear();
    this.stats.clears += 1;
    this.updateSizeStats();
  }

  /**
   * Resets cache statistics (hits, misses, sets) to zero.
   * Does not clear cached values.
   */
  public resetStats(): void {
    const currentSize = this.cache.size;
    const currentMemory = currentSize * BYTES_PER_ENTRY_ESTIMATE;
    this.stats = createStats();
    this.stats.size = currentSize;
    this.stats.memorySizeEstimate = currentMemory;
  }

  /**
   * Returns current cache performance statistics.
   * Useful for monitoring cache effectiveness.
   *
   * @returns Object containing hits, misses, sets, and hit rate
   */
  public getStats(): MeasureCacheStats {
    return { ...this.stats };
  }

  /**
   * Get current cache size (number of entries)
   */
  public getSize(): number {
    return this.cache.size;
  }

  /**
   * Get maximum cache size
   */
  public getMaxSize(): number {
    return MAX_CACHE_SIZE;
  }

  /**
   * Check if cache is near capacity
   */
  public isNearCapacity(threshold = 0.9): boolean {
    return this.cache.size >= MAX_CACHE_SIZE * threshold;
  }

  /**
   * Update size statistics
   */
  private updateSizeStats(): void {
    this.stats.size = this.cache.size;
    this.stats.memorySizeEstimate = this.cache.size * BYTES_PER_ENTRY_ESTIMATE;
  }

  private deleteKey(key: string): boolean {
    if (!this.cache.delete(key)) return false;
    const blockId = this.blockIdByKey.get(key);
    this.blockIdByKey.delete(key);
    if (blockId != null) {
      const keys = this.keysByBlockId.get(blockId);
      keys?.delete(key);
      if (keys?.size === 0) this.keysByBlockId.delete(blockId);
    }
    return true;
  }

  /**
   * Composes a cache key from block properties and dimensions.
   * Validates and clamps dimensions to prevent memory exhaustion.
   *
   * @param block - The flow block to create a key for
   * @param width - Width dimension (will be clamped to [0, MAX_DIMENSION])
   * @param height - Height dimension (will be clamped to [0, MAX_DIMENSION])
   * @returns Cache key string
   */
  private composeKey(
    block: FlowBlock,
    width: number,
    height: number,
    fontSignature: string,
    capabilities?: FontMeasureCapabilities,
  ): string {
    const safeWidth = Number.isFinite(width) ? Math.max(0, Math.min(Math.floor(width), MAX_DIMENSION)) : 0;
    const safeHeight = Number.isFinite(height) ? Math.max(0, Math.min(Math.floor(height), MAX_DIMENSION)) : 0;
    const hash = hashRuns(block, capabilities);
    // The font signature (the document resolver's mapping identity) is part of the key so two
    // documents with identical block content but different `fonts.map` cannot reuse each other's
    // measure. Appended AFTER the block.id prefix so invalidate(blockIds) prefix-matching holds.
    return `${block.id}@${safeWidth}x${safeHeight}:${hash}#${fontSignature}`;
  }
}
