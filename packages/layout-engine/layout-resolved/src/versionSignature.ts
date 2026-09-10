import {
  buildLayoutSourceIdentityForFragment,
  getParagraphInlineDirection,
  inlineBoxStyleSignature,
  type DrawingBlock,
  type FieldAnnotationRun,
  type FlowBlock,
  type FlowRunLink,
  type Fragment,
  type ImageBlock,
  type ImageDrawing,
  type ImageRun,
  type LayoutSourceIdentity,
  type LayoutStoryLocator,
  type ListBlock,
  type ParagraphAttrs,
  type ParagraphBlock,
  type SdtMetadata,
  type ShapeGroupDrawing,
  type SourceAnchor,
  type TableAttrs,
  type TableBlock,
  type TableCellAttrs,
  type TableFragment,
  type TableMeasure,
  type TextboxDrawing,
  type TrackedChangeMeta,
  type TextRun,
  type VectorShapeDrawing,
  trackedChangeLayersSignature,
  trackedChangeMetaSignature,
} from '@superdoc/contracts';
import { getFontConfigVersion } from '@superdoc/font-system';
import { hashParagraphBorders } from './paragraphBorderHash.js';
import { hashCellBorders, hashTableBorders } from './hashUtils.js';

// ---------------------------------------------------------------------------
// SDT metadata helpers
// ---------------------------------------------------------------------------

const getSdtMetadataVersion = (metadata: SdtMetadata | null | undefined): string => {
  if (!metadata) return '';
  if (metadata.type === 'structuredContent') {
    return JSON.stringify([
      metadata.type,
      metadata.scope,
      metadata.id ?? '',
      metadata.tag ?? '',
      metadata.alias ?? '',
      metadata.lockMode ?? '',
      metadata.appearance ?? '',
    ]);
  }
  if (metadata.type === 'fieldAnnotation') {
    return JSON.stringify([
      metadata.type,
      metadata.fieldId,
      metadata.fieldType ?? '',
      metadata.variant ?? '',
      metadata.visibility ?? '',
      metadata.hidden ?? '',
      metadata.isLocked ?? '',
    ]);
  }
  if (metadata.type === 'documentSection') {
    return JSON.stringify([
      metadata.type,
      metadata.id ?? '',
      metadata.sdBlockId ?? '',
      metadata.title ?? '',
      metadata.sectionType ?? '',
      metadata.isLocked ?? '',
    ]);
  }
  return JSON.stringify([
    metadata.type,
    metadata.gallery ?? '',
    metadata.uniqueId ?? '',
    metadata.alias ?? '',
    metadata.instruction ?? '',
  ]);
};

const getBlockSdtVersion = (
  attrs: { sdt?: SdtMetadata | null; containerSdt?: SdtMetadata | null } | null | undefined,
): string => {
  const nearest = getSdtMetadataVersion(attrs?.sdt);
  const container = getSdtMetadataVersion(attrs?.containerSdt);
  return nearest || container ? JSON.stringify([nearest, container]) : '';
};

const getTrackedChangeLayers = (run: Pick<TextRun, 'trackedChange' | 'trackedChanges'>): TrackedChangeMeta[] => {
  if (Array.isArray(run.trackedChanges) && run.trackedChanges.length > 0) {
    return run.trackedChanges;
  }
  return run.trackedChange ? [run.trackedChange] : [];
};

const trackedChangeVersion = (run: TextRun): string => trackedChangeLayersSignature(getTrackedChangeLayers(run));

const inlineBoxesVersion = (block: ParagraphBlock): string =>
  (block.inlineBoxes ?? [])
    .map((box) => {
      const data = Object.entries(box.data ?? {}).sort(([left], [right]) => left.localeCompare(right));
      return JSON.stringify([
        box.id,
        box.from,
        box.to,
        inlineBoxStyleSignature({ ...box.layout, ...box.appearance }),
        box.className ?? '',
        data,
        box.cursor ?? '',
      ]);
    })
    .join(';');

const textRunLinkVersion = (link: FlowRunLink | undefined): string => {
  if (!link) return '';
  return JSON.stringify([
    link.version ?? '',
    link.href ?? '',
    link.anchor ?? '',
    link.docLocation ?? '',
    link.rId ?? '',
    link.target ?? '',
    link.rel ?? '',
    link.tooltip ?? '',
    link.title ?? '',
    link.name ?? '',
    typeof link.history === 'boolean' ? link.history : '',
  ]);
};

// ---------------------------------------------------------------------------
// Clip path helpers
// ---------------------------------------------------------------------------

const CLIP_PATH_PREFIXES = ['inset(', 'polygon(', 'circle(', 'ellipse(', 'path(', 'rect('];

const readClipPathValue = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (normalized.length === 0) return '';
  const lower = normalized.toLowerCase();
  if (!CLIP_PATH_PREFIXES.some((prefix) => lower.startsWith(prefix))) return '';
  return normalized;
};

const resolveClipPathFromAttrs = (attrs: unknown): string => {
  if (!attrs || typeof attrs !== 'object') return '';
  const record = attrs as Record<string, unknown>;
  return readClipPathValue(record.clipPath);
};

const resolveBlockClipPath = (block: unknown): string => {
  if (!block || typeof block !== 'object') return '';
  const record = block as Record<string, unknown>;
  return readClipPathValue(record.clipPath) || resolveClipPathFromAttrs(record.attrs);
};

const imageHyperlinkVersion = (hyperlink: ImageBlock['hyperlink'] | undefined): string => {
  if (!hyperlink) return '';
  return JSON.stringify([hyperlink.url ?? '', hyperlink.tooltip ?? '']);
};

const imageLuminanceVersion = (lum: ImageBlock['lum'] | undefined): string => {
  if (!lum) return '';
  return [lum.bright ?? '', lum.contrast ?? ''].join(':');
};

const drawingTextVersion = (block: VectorShapeDrawing | TextboxDrawing): string => {
  const textboxContentBlocks =
    'contentBlocks' in block && Array.isArray(block.contentBlocks)
      ? block.contentBlocks.map((contentBlock) => deriveBlockVersion(contentBlock)).join(';')
      : '';

  return JSON.stringify([
    block.textAlign ?? '',
    block.textVerticalAlign ?? '',
    block.textInsets ?? null,
    block.textContent ?? null,
    textboxContentBlocks,
  ]);
};

const imageAlphaModFixVersion = (alphaModFix: ImageBlock['alphaModFix'] | undefined): string => {
  if (!alphaModFix) return '';
  return String(alphaModFix.amt ?? '');
};

const renderedBlockImageVersion = (image: ImageBlock | ImageDrawing): string =>
  [
    image.src ?? '',
    image.width ?? '',
    image.height ?? '',
    image.alt ?? '',
    image.title ?? '',
    image.objectFit ?? '',
    image.display ?? '',
    image.gain ?? '',
    image.blacklevel ?? '',
    image.grayscale ? 1 : 0,
    imageLuminanceVersion(image.lum),
    imageAlphaModFixVersion(image.alphaModFix),
    image.rotation ?? '',
    image.flipH ? 1 : 0,
    image.flipV ? 1 : 0,
    imageHyperlinkVersion(image.hyperlink),
    resolveBlockClipPath(image),
    trackedChangeLayersSignature(getTrackedChangeLayers(image)),
  ].join('|');

const renderedInlineImageRunVersion = (image: ImageRun): string =>
  [
    'img',
    image.src ?? '',
    image.width ?? '',
    image.height ?? '',
    image.alt ?? '',
    image.title ?? '',
    typeof image.clipPath === 'string' ? image.clipPath.trim() : '',
    image.distTop ?? '',
    image.distBottom ?? '',
    image.distLeft ?? '',
    image.distRight ?? '',
    image.verticalAlign ?? '',
    image.gain ?? '',
    image.blacklevel ?? '',
    image.grayscale ? 1 : 0,
    imageLuminanceVersion(image.lum),
    imageAlphaModFixVersion(image.alphaModFix),
    image.rotation ?? '',
    image.flipH ? 1 : 0,
    image.flipV ? 1 : 0,
    imageHyperlinkVersion(image.hyperlink),
    stableSerializeEvidenceValue(image.sdt),
    stableSerializeEvidenceValue(image.dataAttrs),
    trackedChangeLayersSignature(getTrackedChangeLayers(image)),
  ].join('|');

// ---------------------------------------------------------------------------
// List marker validation
// ---------------------------------------------------------------------------

const hasListMarkerProperties = (
  attrs: unknown,
): attrs is {
  numberingProperties: { numId?: number | string; ilvl?: number };
  wordLayout?: { marker?: { markerText?: string; trackedChange?: TrackedChangeMeta } };
} => {
  if (!attrs || typeof attrs !== 'object') return false;
  const obj = attrs as Record<string, unknown>;

  if (!obj.numberingProperties || typeof obj.numberingProperties !== 'object') return false;
  const numProps = obj.numberingProperties as Record<string, unknown>;

  if ('numId' in numProps) {
    const numId = numProps.numId;
    if (typeof numId !== 'number' && typeof numId !== 'string') return false;
  }

  if ('ilvl' in numProps) {
    const ilvl = numProps.ilvl;
    if (typeof ilvl !== 'number') return false;
  }

  if ('wordLayout' in obj && obj.wordLayout !== undefined) {
    if (typeof obj.wordLayout !== 'object' || obj.wordLayout === null) return false;
    const wordLayout = obj.wordLayout as Record<string, unknown>;

    if ('marker' in wordLayout && wordLayout.marker !== undefined) {
      if (typeof wordLayout.marker !== 'object' || wordLayout.marker === null) return false;
      const marker = wordLayout.marker as Record<string, unknown>;

      if ('markerText' in marker && marker.markerText !== undefined) {
        if (typeof marker.markerText !== 'string') return false;
      }
    }
  }

  return true;
};

// ---------------------------------------------------------------------------
// FNV-1a hash helpers (for table block hashing)
// ---------------------------------------------------------------------------

const hashString = (seed: number, value: string): number => {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const hashNumber = (seed: number, value: number | undefined | null): number => {
  const n = Number.isFinite(value) ? (value as number) : 0;
  let hash = seed ^ n;
  hash = Math.imul(hash, 16777619);
  hash ^= hash >>> 13;
  return hash >>> 0;
};

// ---------------------------------------------------------------------------
// sourceAnchorSignature
// ---------------------------------------------------------------------------

const stableSerializeEvidenceValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializeEvidenceValue(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerializeEvidenceValue(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
};

/**
 * Stable source/evidence metadata signature for paint cache invalidation.
 *
 * Source anchors are not visual geometry. Keep them out of deriveBlockVersion()
 * and fragmentSignature(), but include this fingerprint in DomPainter's paint
 * reuse signature so metadata-only updates refresh data-source-* attributes and
 * paint snapshot anchors.
 */
export const sourceAnchorSignature = (sourceAnchor: SourceAnchor | undefined): string =>
  sourceAnchor ? stableSerializeEvidenceValue(sourceAnchor) : '';

/**
 * Resolve the editor-neutral identity for a fragment (prep-001).
 *
 * Prefers `fragment.layoutSourceIdentity` when present; otherwise constructs
 * one from the producer's existing fields (`blockId`, `kind`, fragment-local
 * line/row indices, optional `sourceAnchor`). Pure helper — does not mutate
 * the fragment, and remains safe to call for v1 layouts that never populate
 * `layoutSourceIdentity` upstream.
 */
export const resolveFragmentLayoutIdentity = (fragment: Fragment, story?: LayoutStoryLocator): LayoutSourceIdentity => {
  return buildLayoutSourceIdentityForFragment(fragment, story);
};

// ---------------------------------------------------------------------------
// deriveBlockVersion
// ---------------------------------------------------------------------------

/**
 * Derives a version string for a flow block based on its content and styling properties.
 *
 * This version string is used for cache invalidation. When any visual property of the block
 * changes, the version string changes, triggering a DOM rebuild instead of reusing cached elements.
 *
 * Kept in layout-resolved so the resolved layout stage can pre-compute block
 * versions without depending on painter-dom.
 */
export const deriveBlockVersion = (block: FlowBlock): string => {
  if (block.kind === 'paragraph') {
    const markerTrackedChangeVersion = block.attrs?.wordLayout?.marker?.trackedChange
      ? trackedChangeMetaSignature(block.attrs.wordLayout.marker.trackedChange)
      : '';
    const markerVersion = hasListMarkerProperties(block.attrs)
      ? `marker:${block.attrs.numberingProperties.numId ?? ''}:${block.attrs.numberingProperties.ilvl ?? 0}:${block.attrs.wordLayout?.marker?.markerText ?? ''}:${markerTrackedChangeVersion}`
      : '';

    const runsVersion = block.runs
      .map((run) => {
        if (run.kind === 'image') {
          return renderedInlineImageRunVersion(run as ImageRun);
        }

        if (run.kind === 'lineBreak') {
          return 'linebreak';
        }

        if (run.kind === 'tab') {
          // Include every input the painter's tab underline depends on so the paint cache is
          // not reused after a relevant change (SD-3330): underline style/color choose the
          // mark; fontSize sets its thickness; fontFamily/color feed measured line metrics and
          // the resolved underline color. The font epoch matters too: a tab's underline offset
          // is derived from measured line metrics, so when a font loads/changes (resolved family
          // unchanged, only availability) a tab-only underlined line must repaint - a mixed
          // text+tab line is already busted by its text run, but a tab-only line has none.
          // bold/italic matter for the same reason: a tab-only line's metrics now come from the
          // tab's font via getFontInfoFromRun, which feeds bold/italic into the measured ascent/
          // descent (buildFontString), so the underline offset and line height depend on them.
          // Without these a font/style/availability change can leave a stale tab underline until an
          // unrelated edit forces a rebuild.
          return [
            run.text ?? '',
            'tab',
            run.underline?.style ?? '',
            run.underline?.color ?? '',
            run.fontSize ?? '',
            run.fontFamily ?? '',
            (run as { bold?: boolean }).bold ? 1 : 0,
            (run as { italic?: boolean }).italic ? 1 : 0,
            (run as { vanish?: boolean }).vanish ? 1 : 0,
            getFontConfigVersion(),
            (run as { color?: string }).color ?? '',
          ].join(',');
        }

        if (run.kind === 'fieldAnnotation') {
          const fieldRun = run as FieldAnnotationRun;
          const size = fieldRun.size ? `${fieldRun.size.width ?? ''}x${fieldRun.size.height ?? ''}` : '';
          const highlighted = fieldRun.highlighted !== false ? 1 : 0;
          return [
            'field',
            fieldRun.variant ?? '',
            fieldRun.displayLabel ?? '',
            fieldRun.fieldColor ?? '',
            fieldRun.borderColor ?? '',
            highlighted,
            fieldRun.hidden ? 1 : 0,
            fieldRun.visibility ?? '',
            fieldRun.imageSrc ?? '',
            fieldRun.linkUrl ?? '',
            fieldRun.rawHtml ?? '',
            size,
            fieldRun.fontFamily ?? '',
            fieldRun.fontSize ?? '',
            fieldRun.textColor ?? '',
            fieldRun.textHighlight ?? '',
            fieldRun.bold ? 1 : 0,
            fieldRun.italic ? 1 : 0,
            fieldRun.underline ? 1 : 0,
            fieldRun.fieldId ?? '',
            fieldRun.fieldType ?? '',
          ].join(',');
        }

        const textRun = run as TextRun;
        const trackedVersion = trackedChangeVersion(textRun);
        return [
          textRun.text ?? '',
          textRun.fontFamily,
          // Font epoch: busts paint reuse when a font loads/changes (the resolved physical
          // family is the same, only its availability changed - logical family alone can't see it).
          getFontConfigVersion(),
          textRun.fontSize,
          textRun.bold ? 1 : 0,
          textRun.italic ? 1 : 0,
          textRun.vanish ? 1 : 0,
          textRun.textTransform ?? '',
          textRun.color ?? '',
          textRun.underline?.style ?? '',
          textRun.underline?.color ?? '',
          textRun.strike ? 1 : 0,
          // The Word 97-2003 effect flags and the double strikethrough: paint-only,
          // but this version is what the painter reuses a fragment by.
          textRun.doubleStrike ? 1 : 0,
          textRun.outline ? 1 : 0,
          textRun.shadow ? 1 : 0,
          textRun.emboss ? 1 : 0,
          textRun.imprint ? 1 : 0,
          textRun.highlight ?? '',
          textRun.letterSpacing != null ? textRun.letterSpacing : '',
          textRun.horizontalScale != null ? textRun.horizontalScale : '',
          textRun.vertAlign ?? '',
          textRun.baselineShift != null ? textRun.baselineShift : '',
          textRun.token ?? '',
          textRun.pageNumberFieldFormat ? JSON.stringify(textRun.pageNumberFieldFormat) : '',
          trackedVersion,
          textRunLinkVersion(textRun.link),
          textRun.comments
            ?.map((comment) =>
              [
                comment.commentId ?? '',
                comment.importedId ?? '',
                comment.internal === true ? '1' : '0',
                comment.trackedChange === true ? '1' : '0',
              ].join(':'),
            )
            .join('|') ?? '',
          // SD-3098: DomPainter reads run.bidi to apply dir + RLM injection; signature must include it.
          textRun.bidi ? JSON.stringify(textRun.bidi) : '',
        ].join(',');
      })
      .join('|');

    const attrs = block.attrs as ParagraphAttrs | undefined;

    const paragraphAttrsVersion = attrs
      ? [
          attrs.alignment ?? '',
          attrs.spacing?.before ?? '',
          attrs.spacing?.after ?? '',
          attrs.spacing?.line ?? '',
          attrs.spacing?.lineRule ?? '',
          attrs.indent?.left ?? '',
          attrs.indent?.right ?? '',
          attrs.indent?.firstLine ?? '',
          attrs.indent?.hanging ?? '',
          attrs.borders ? hashParagraphBorders(attrs.borders) : '',
          attrs.shading?.fill ?? '',
          attrs.shading?.color ?? '',
          getParagraphInlineDirection(attrs) ?? '',
          attrs.tabs?.length ? JSON.stringify(attrs.tabs) : '',
          attrs.paragraphMarkTrackedChange ? trackedChangeMetaSignature(attrs.paragraphMarkTrackedChange) : '',
          attrs.paragraphPropertyTrackedChange ? trackedChangeMetaSignature(attrs.paragraphPropertyTrackedChange) : '',
        ].join(':')
      : '';

    const sdtVersion = getBlockSdtVersion(block.attrs as ParagraphAttrs | undefined);

    const parts = [markerVersion, runsVersion, paragraphAttrsVersion, sdtVersion, inlineBoxesVersion(block)].filter(
      Boolean,
    );
    return parts.join('|');
  }

  if (block.kind === 'list') {
    return block.items.map((item) => `${item.id}:${item.marker.text}:${deriveBlockVersion(item.paragraph)}`).join('|');
  }

  if (block.kind === 'image') {
    const imgSdtVersion = getBlockSdtVersion((block as ImageBlock).attrs);
    return [renderedBlockImageVersion(block), imgSdtVersion].join('|');
  }

  if (block.kind === 'drawing') {
    const drawingSdtVersion = getBlockSdtVersion(
      (block as DrawingBlock & { attrs?: { sdt?: SdtMetadata | null; containerSdt?: SdtMetadata | null } }).attrs,
    );
    if (block.drawingKind === 'image') {
      const imageLike = block as ImageDrawing;
      return ['drawing:image', renderedBlockImageVersion(imageLike), drawingSdtVersion].join('|');
    }
    if (block.drawingKind === 'vectorShape' || block.drawingKind === 'textboxShape') {
      const vector = block as VectorShapeDrawing;
      return [
        block.drawingKind === 'textboxShape' ? 'drawing:textbox' : 'drawing:vector',
        vector.shapeKind ?? '',
        vector.fillColor ?? '',
        vector.strokeColor ?? '',
        vector.strokeWidth ?? '',
        vector.geometry.width,
        vector.geometry.height,
        vector.geometry.rotation ?? 0,
        vector.geometry.flipH ? 1 : 0,
        vector.geometry.flipV ? 1 : 0,
        drawingTextVersion(vector),
        block.anchor?.offsetH ?? '',
        block.anchor?.offsetV ?? '',
        drawingSdtVersion,
      ].join('|');
    }
    if (block.drawingKind === 'shapeGroup') {
      const group = block as ShapeGroupDrawing;
      const childSignature = group.shapes
        .map((child) => `${child.shapeType}:${JSON.stringify(child.attrs ?? {})}`)
        .join(';');
      return [
        'drawing:group',
        group.geometry.width,
        group.geometry.height,
        group.groupTransform ? JSON.stringify(group.groupTransform) : '',
        childSignature,
        drawingSdtVersion,
      ].join('|');
    }
    if (block.drawingKind === 'chart') {
      return [
        'drawing:chart',
        block.chartData?.chartType ?? '',
        block.chartData?.series?.length ?? 0,
        block.geometry.width,
        block.geometry.height,
        block.chartRelId ?? '',
        drawingSdtVersion,
      ].join('|');
    }
    const _exhaustive: never = block;
    return `drawing:unknown:${(block as DrawingBlock).id}`;
  }

  if (block.kind === 'table') {
    const tableBlock = block as TableBlock;

    let hash = 2166136261;
    hash = hashString(hash, block.id);
    hash = hashNumber(hash, tableBlock.rows.length);
    hash = (tableBlock.columnWidths ?? []).reduce((acc, width) => hashNumber(acc, Math.round(width * 1000)), hash);

    const rows = tableBlock.rows ?? [];
    for (const row of rows) {
      if (!row || !Array.isArray(row.cells)) continue;
      if (row.attrs?.trackedChange) {
        hash = hashString(hash, trackedChangeMetaSignature(row.attrs.trackedChange));
      }
      hash = hashNumber(hash, row.cells.length);
      for (const cell of row.cells) {
        if (!cell) continue;
        const cellBlocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
        hash = hashNumber(hash, cellBlocks.length);
        hash = hashNumber(hash, cell.rowSpan ?? 1);
        hash = hashNumber(hash, cell.colSpan ?? 1);

        if (cell.attrs) {
          const cellAttrs = cell.attrs as TableCellAttrs;
          if (cellAttrs.borders) {
            hash = hashString(hash, hashCellBorders(cellAttrs.borders));
          }
          if (cellAttrs.padding) {
            const p = cellAttrs.padding;
            hash = hashNumber(hash, p.top ?? 0);
            hash = hashNumber(hash, p.right ?? 0);
            hash = hashNumber(hash, p.bottom ?? 0);
            hash = hashNumber(hash, p.left ?? 0);
          }
          if (cellAttrs.verticalAlign) {
            hash = hashString(hash, cellAttrs.verticalAlign);
          }
          if (cellAttrs.background) {
            hash = hashString(hash, cellAttrs.background);
          }
          if (cellAttrs.trackedChange) {
            hash = hashString(hash, trackedChangeMetaSignature(cellAttrs.trackedChange));
          }
        }

        for (const cellBlock of cellBlocks) {
          hash = hashString(hash, cellBlock?.kind ?? 'unknown');
          if (cellBlock?.kind === 'paragraph') {
            // Use the same paragraph signature at every nesting depth. The
            // previous table-only copy omitted list-marker text and paragraph
            // property tracked-change metadata, leaving stale TC decoration
            // inside cells after list mutations.
            hash = hashString(hash, deriveBlockVersion(cellBlock as ParagraphBlock));
          } else if (cellBlock?.kind) {
            hash = hashString(hash, deriveBlockVersion(cellBlock as FlowBlock));
          }
        }
      }
    }

    if (tableBlock.attrs) {
      const tblAttrs = tableBlock.attrs as TableAttrs;
      if (tblAttrs.borders) {
        hash = hashString(hash, hashTableBorders(tblAttrs.borders));
      }
      if (tblAttrs.borderCollapse) {
        hash = hashString(hash, tblAttrs.borderCollapse);
      }
      if (tblAttrs.cellSpacing !== undefined) {
        const cs = tblAttrs.cellSpacing;
        if (typeof cs === 'number') {
          hash = hashNumber(hash, cs);
        } else {
          const v = (cs as { value?: number; type?: string }).value ?? 0;
          const t = (cs as { value?: number; type?: string }).type ?? 'px';
          hash = hashString(hash, `cs:${v}:${t}`);
        }
      }
      hash = hashString(hash, getBlockSdtVersion(tblAttrs));
    }

    return [block.id, tableBlock.rows.length, hash.toString(16)].join('|');
  }

  return block.id;
};

const tableBlockStructureVersionCache = new WeakMap<TableBlock, string>();
const tableMeasureStructureVersionCache = new WeakMap<TableMeasure, string>();

const hashStableValue = (seed: number, value: unknown): number => hashString(seed, stableSerializeEvidenceValue(value));

const hashMeasurementNumber = (seed: number, value: number | undefined): number =>
  hashString(seed, value == null || !Number.isFinite(value) ? '' : String(value));

const deriveTableBlockStructureVersion = (block: TableBlock): string => {
  const cached = tableBlockStructureVersionCache.get(block);
  if (cached != null) return cached;

  let hash = 2166136261;
  hash = hashString(hash, block.id);
  hash = hashNumber(hash, block.rows.length);
  hash = hashStableValue(hash, block.attrs);
  hash = hashStableValue(hash, block.columnWidths);
  hash = hashStableValue(hash, block.anchor);
  hash = hashStableValue(hash, block.wrap);
  for (const row of block.rows) {
    hash = hashStableValue(hash, row.attrs);
    hash = hashNumber(hash, row.cells.length);
    for (const cell of row.cells) {
      hash = hashNumber(hash, cell.rowSpan ?? 1);
      hash = hashNumber(hash, cell.colSpan ?? 1);
      hash = hashStableValue(hash, cell.attrs);
    }
  }

  const version = hash.toString(16);
  tableBlockStructureVersionCache.set(block, version);
  return version;
};

const deriveTableMeasureStructureVersion = (measure: TableMeasure): string => {
  const cached = tableMeasureStructureVersionCache.get(measure);
  if (cached != null) return cached;

  let hash = 2166136261;
  hash = hashStableValue(hash, measure.columnWidths);
  hash = hashMeasurementNumber(hash, measure.totalWidth);
  hash = hashMeasurementNumber(hash, measure.totalHeight);
  hash = hashMeasurementNumber(hash, measure.cellSpacingPx);
  hash = hashStableValue(hash, measure.tableBorderWidths);
  hash = hashNumber(hash, measure.rows.length);
  for (const row of measure.rows) {
    hash = hashMeasurementNumber(hash, row.height);
    hash = hashNumber(hash, row.cells.length);
    for (const cell of row.cells) {
      hash = hashMeasurementNumber(hash, cell.width);
      hash = hashMeasurementNumber(hash, cell.height);
      hash = hashNumber(hash, cell.gridColumnStart);
      hash = hashNumber(hash, cell.rowSpan ?? 1);
      hash = hashNumber(hash, cell.colSpan ?? 1);
    }
  }

  const version = hash.toString(16);
  tableMeasureStructureVersionCache.set(measure, version);
  return version;
};

const renderedTableRowIndices = (fragment: TableFragment, rowCount: number): number[] => {
  const indices = new Set<number>();
  const repeatHeaderCount = Math.min(fragment.repeatHeaderCount ?? 0, rowCount);
  for (let rowIndex = 0; rowIndex < repeatHeaderCount; rowIndex += 1) indices.add(rowIndex);
  const fromRow = Math.max(0, fragment.fromRow);
  const toRow = Math.min(fragment.toRow, rowCount);
  for (let rowIndex = fromRow; rowIndex < toRow; rowIndex += 1) indices.add(rowIndex);
  return [...indices].sort((left, right) => left - right);
};

const hashBlockPaintIdentity = (seed: number, block: FlowBlock): number => {
  let hash = hashString(hashString(seed, block.kind), block.id);
  const blockSourceAnchor = 'sourceAnchor' in block ? block.sourceAnchor : undefined;
  hash = hashString(hash, sourceAnchorSignature(blockSourceAnchor));
  if (block.kind === 'list') {
    for (const item of block.items) {
      hash = hashString(hash, item.id);
      hash = hashString(hash, sourceAnchorSignature(item.sourceAnchor ?? item.paragraph.sourceAnchor));
      hash = hashBlockPaintIdentity(hash, item.paragraph);
    }
  } else if (block.kind === 'table') {
    for (const row of block.rows) {
      hash = hashString(hash, row.id);
      hash = hashString(hash, sourceAnchorSignature(row.sourceAnchor));
      for (const cell of row.cells) {
        hash = hashString(hash, cell.id);
        hash = hashString(hash, sourceAnchorSignature(cell.sourceAnchor));
        for (const cellBlock of cell.blocks ?? (cell.paragraph ? [cell.paragraph] : [])) {
          hash = hashBlockPaintIdentity(hash, cellBlock);
        }
      }
    }
  } else if (block.kind === 'drawing') {
    const contentBlocks = (block as { contentBlocks?: FlowBlock[] }).contentBlocks;
    for (const contentBlock of contentBlocks ?? []) {
      hash = hashBlockPaintIdentity(hash, contentBlock);
    }
  }
  return hash;
};

export const deriveTableFragmentPaintVersion = (
  fragment: TableFragment,
  block: TableBlock,
  measure: TableMeasure,
): string => {
  const rowIndices = renderedTableRowIndices(fragment, block.rows.length);
  const localBlock: TableBlock = {
    ...block,
    rows: rowIndices.map((rowIndex) => block.rows[rowIndex]!),
  };
  let identityHash = 2166136261;
  for (const rowIndex of rowIndices) {
    const row = block.rows[rowIndex];
    if (!row) continue;
    identityHash = hashNumber(identityHash, rowIndex);
    for (const cell of row.cells) {
      for (const cellBlock of cell.blocks ?? (cell.paragraph ? [cell.paragraph] : [])) {
        identityHash = hashBlockPaintIdentity(identityHash, cellBlock);
      }
    }
  }
  const fragmentDataVersion = hashStableValue(
    hashStableValue(2166136261, fragment.columnWidths),
    fragment.metadata,
  ).toString(16);
  const localBlockVersion = [
    deriveTableBlockStructureVersion(block),
    deriveTableMeasureStructureVersion(measure),
    rowIndices.join(','),
    deriveBlockVersion(localBlock),
    identityHash.toString(16),
    fragmentDataVersion,
  ].join(':');
  return fragmentSignature(fragment, localBlockVersion);
};

// ---------------------------------------------------------------------------
// pmInteriorVersion (painter plan P5)
// ---------------------------------------------------------------------------

const collectRunPmPositions = (runs: readonly unknown[] | undefined, positions: number[]): void => {
  for (const run of runs ?? []) {
    const pmStart = (run as { pmStart?: unknown }).pmStart;
    const pmEnd = (run as { pmEnd?: unknown }).pmEnd;
    if (typeof pmStart === 'number') positions.push(pmStart);
    if (typeof pmEnd === 'number') positions.push(pmEnd);
  }
};

const collectBlockPmPositions = (block: FlowBlock, positions: number[]): void => {
  if (block.kind === 'paragraph') {
    collectRunPmPositions((block as ParagraphBlock).runs, positions);
    return;
  }
  if (block.kind === 'list') {
    for (const item of (block as ListBlock).items ?? []) {
      collectRunPmPositions(item.paragraph?.runs, positions);
    }
    return;
  }
  if (block.kind === 'table') {
    for (const row of (block as TableBlock).rows ?? []) {
      for (const cell of row.cells ?? []) {
        const cellBlocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
        for (const cellBlock of cellBlocks) {
          if (cellBlock) collectBlockPmPositions(cellBlock as FlowBlock, positions);
        }
      }
    }
    return;
  }
  if (block.kind === 'drawing') {
    const contentBlocks = (block as { contentBlocks?: FlowBlock[] }).contentBlocks;
    for (const contentBlock of contentBlocks ?? []) {
      collectBlockPmPositions(contentBlock, positions);
    }
    return;
  }
  // image and remaining kinds: no interior run pm — painted leaf positions
  // derive from the fragment/block-level span, which the remap tier compares
  // directly.
};

/**
 * Interior-pm signature (painter plan P5): every run pm position the block
 * carries, hashed RELATIVE to the block's first pm position. Paint stamps are
 * deliberately pm-free (positions are coordinates, not content), so a uniform
 * document shift keeps both this key AND the stamps equal — which is exactly
 * the proof the painter's window remap tier needs before shifting reused DOM
 * in place by the fragment-level delta. Any INTERIOR redistribution (a PM
 * node inserted/moved/removed inside the block without changing a single run
 * — bookmarks and comment range markers emit no runs) changes the relative
 * offsets and therefore this key, demoting the fragment to a real rebuild.
 *
 * Must cover every source of painted leaf `data-pm-*` under a fragment:
 * paragraph runs, list item runs, table cell blocks (recursive), and textbox
 * drawing contentBlocks. Kinds with no interior run pm return 'pm:none'.
 *
 * Shape: `pm:<count>:<relativeOffsetsHash>@<absoluteBase>`. The RELATIVE part
 * is drift-insensitive (a uniform shift keeps it equal — the remap proof);
 * the absolute base lets the painter verify the interior moved by EXACTLY
 * the fragment's delta, and gives pm-less fragments (no fragment-level
 * anchor) an absolute identity so unchanged content stays reusable while any
 * drift rebuilds.
 */
export const derivePmInteriorVersion = (block: FlowBlock): string => {
  const positions: number[] = [];
  collectBlockPmPositions(block, positions);
  return derivePmInteriorVersionFromPositions(positions);
};

const derivePmInteriorVersionFromPositions = (positions: readonly number[]): string => {
  if (positions.length === 0) return 'pm:none';
  const base = positions[0]!;
  let hash = 5381;
  for (const position of positions) {
    hash = hashNumber(hash, position - base);
  }
  return `pm:${positions.length}:${(hash >>> 0).toString(36)}@${base}`;
};

export const deriveTableFragmentPmInteriorVersion = (block: TableBlock, fragment: TableFragment): string => {
  const collectRows = (rowIndices: readonly number[]): string => {
    const positions: number[] = [];
    for (const rowIndex of rowIndices) {
      const row = block.rows[rowIndex];
      if (!row) continue;
      for (const cell of row.cells) {
        for (const cellBlock of cell.blocks ?? (cell.paragraph ? [cell.paragraph] : [])) {
          collectBlockPmPositions(cellBlock, positions);
        }
      }
    }
    return derivePmInteriorVersionFromPositions(positions);
  };
  const repeatHeaderCount = Math.min(fragment.repeatHeaderCount ?? 0, block.rows.length);
  const bodyRowIndices: number[] = [];
  for (
    let rowIndex = Math.max(0, fragment.fromRow);
    rowIndex < Math.min(fragment.toRow, block.rows.length);
    rowIndex += 1
  ) {
    bodyRowIndices.push(rowIndex);
  }
  const bodyVersion = collectRows(bodyRowIndices);
  if (repeatHeaderCount === 0) return bodyVersion;

  const headerRowIndices: number[] = [];
  for (let rowIndex = 0; rowIndex < repeatHeaderCount; rowIndex += 1) {
    headerRowIndices.push(rowIndex);
  }
  return `table-pm:${repeatHeaderCount}:${collectRows(headerRowIndices)}|${bodyVersion}`;
};

// ---------------------------------------------------------------------------
// fragmentSignature
// ---------------------------------------------------------------------------

/**
 * Computes a change-detection signature for a layout fragment.
 *
 * Combines the block-level version with fragment-specific data (line range,
 * continuation flags, marker width, drawing geometry, table row range, etc.)
 * so that each fragment has a unique identity for incremental re-rendering.
 *
 * Adapted from painters/dom/src/renderer.ts fragmentSignature(). The painter
 * version accepts a BlockLookup map; this version takes a pre-computed
 * blockVersion string directly.
 */
export const fragmentSignature = (fragment: Fragment, blockVersion: string): string => {
  if (fragment.kind === 'para') {
    return [
      blockVersion,
      fragment.fromLine,
      fragment.toLine,
      fragment.continuesFromPrev ? 1 : 0,
      fragment.continuesOnNext ? 1 : 0,
      fragment.markerWidth ?? '',
    ].join('|');
  }
  if (fragment.kind === 'list-item') {
    return [
      blockVersion,
      fragment.itemId,
      fragment.fromLine,
      fragment.toLine,
      fragment.continuesFromPrev ? 1 : 0,
      fragment.continuesOnNext ? 1 : 0,
    ].join('|');
  }
  if (fragment.kind === 'image') {
    return [blockVersion, fragment.width, fragment.height].join('|');
  }
  if (fragment.kind === 'drawing') {
    return [
      blockVersion,
      fragment.drawingKind,
      fragment.drawingContentId ?? '',
      fragment.width,
      fragment.height,
      fragment.geometry.width,
      fragment.geometry.height,
      fragment.geometry.rotation ?? 0,
      fragment.scale ?? 1,
      fragment.zIndex ?? '',
    ].join('|');
  }
  if (fragment.kind === 'table') {
    const partialSig = fragment.partialRow
      ? `${fragment.partialRow.fromLineByCell.join(',')}-${fragment.partialRow.toLineByCell.join(',')}-${fragment.partialRow.partialHeight}`
      : '';
    return [
      blockVersion,
      fragment.fromRow,
      fragment.toRow,
      fragment.width,
      fragment.height,
      fragment.continuesFromPrev ? 1 : 0,
      fragment.continuesOnNext ? 1 : 0,
      fragment.repeatHeaderCount ?? 0,
      partialSig,
    ].join('|');
  }
  return blockVersion;
};
