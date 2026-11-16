import type {
  DrawingBlock,
  DrawingFragment,
  FlowBlock,
  Fragment,
  HeaderFooterKind,
  HeaderFooterLayout,
  ImageBlock,
  ImageFragment,
  ImageWrap,
  Layout,
  Measure,
} from '@superdoc/contracts';
import {
  buildLayoutSourceIdentityForFragment,
  isPagePositionedFloatingTable,
  isPagePositionedParagraphFrame,
  isPageRelativeAnchor,
  resolveFooterPageFrameOriginY,
} from '@superdoc/contracts';
import { normalizeFragmentsForRegion, type RegionConstraints } from './normalize-header-footer-fragments.js';

export type HeaderFooterMeasurementConstraints = RegionConstraints & { width: number };

type Span = { start: number; end: number };

type VerticalExtent = { minY: number; maxY: number };

const TEXT_WRAPPING_BESIDE_TYPES: ReadonlySet<ImageWrap['type']> = new Set(['Square', 'Tight', 'Through']);

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function spansIntersect(startA: number, endA: number, startB: number, endB: number): boolean {
  return endA > startB && startA < endB;
}

function isOutsideMeasurementCanvas(top: number, bottom: number, canvasHeight: number): boolean {
  return bottom <= 0 || top >= canvasHeight;
}

function sumLineHeights(lines: readonly { lineHeight: number }[], fromLine: number, toLine: number): number {
  let sum = 0;
  for (let index = fromLine; index < toLine; index += 1) {
    sum += lines[index]?.lineHeight ?? 0;
  }
  return sum;
}

function measuredGraphicHeight(measure: Measure | undefined): number {
  return measure?.kind === 'image' || measure?.kind === 'drawing' ? (measure.height ?? 0) : 0;
}

export function computeFragmentBottom(fragment: Fragment, block: FlowBlock, measure: Measure | undefined): number {
  if (fragment.kind === 'para') {
    if (measure?.kind !== 'paragraph') return fragment.y;
    const linesBottom = fragment.y + sumLineHeights(measure.lines, fragment.fromLine, fragment.toLine);
    const spacingAfter = block.kind === 'paragraph' ? block.attrs?.spacing?.after : undefined;
    return spacingAfter && fragment.toLine === measure.lines.length
      ? linesBottom + Math.max(0, Number(spacingAfter))
      : linesBottom;
  }
  if (fragment.kind === 'image' || fragment.kind === 'drawing') {
    return fragment.y + (typeof fragment.height === 'number' ? fragment.height : measuredGraphicHeight(measure));
  }
  if (fragment.kind === 'table') {
    return fragment.y + (typeof fragment.height === 'number' ? fragment.height : 0);
  }
  if (measure?.kind !== 'list') return fragment.y;
  const item = measure.items.find((candidate) => candidate.itemId === fragment.itemId);
  return item?.paragraph
    ? fragment.y + sumLineHeights(item.paragraph.lines, fragment.fromLine, fragment.toLine)
    : fragment.y;
}

function regionMarginBand(
  kind: HeaderFooterKind | undefined,
  constraints: HeaderFooterMeasurementConstraints,
): Span | null {
  if (!kind || !constraints.margins) return null;
  const bandSize = kind === 'header' ? constraints.margins.top : constraints.margins.bottom;
  return isPositiveFinite(bandSize) ? { start: 0, end: bandSize } : null;
}

function pageFrameStaysOutOfFlow(
  frameWrap: 'around' | 'none',
  kind: HeaderFooterKind | undefined,
  marginBand: () => Span | null,
  verticalFootprint: () => Span,
): boolean {
  if (!kind) return false;
  if (frameWrap === 'none') return true;
  const band = marginBand();
  if (!band) return false;
  const footprint = verticalFootprint();
  return !spansIntersect(footprint.start, footprint.end, band.start, band.end);
}

export function collectNonFlowPagePositionedParagraphFrameIds(
  blocks: FlowBlock[],
  measures: Measure[],
  kind: HeaderFooterKind | undefined,
  constraints: HeaderFooterMeasurementConstraints,
): Set<string> {
  const ids = new Set<string>();
  const marginBand = regionMarginBand(kind, constraints);
  const pageHeight = constraints.pageHeight;
  if (!kind || typeof pageHeight !== 'number' || !Number.isFinite(pageHeight)) {
    return ids;
  }

  const regionOrigin = kind === 'footer' ? resolveFooterPageFrameOriginY(pageHeight, constraints.margins?.bottom) : 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const measure = measures[index];
    if (block.kind !== 'paragraph' || measure?.kind !== 'paragraph') continue;

    const frame = block.attrs?.frame;
    if (!isPagePositionedParagraphFrame(frame)) continue;

    const frameFootprint = (): Span => {
      const frameTop = frame.y - regionOrigin;
      const lineHeight = measure.lines.reduce((total, line) => total + (line.lineHeight ?? 0), 0);
      const spacingAfter = Math.max(0, Number(block.attrs?.spacing?.after ?? 0));
      return { start: frameTop, end: frameTop + lineHeight + spacingAfter };
    };
    if (pageFrameStaysOutOfFlow(frame.wrap, kind, () => marginBand, frameFootprint)) {
      ids.add(block.id);
    }
  }

  return ids;
}

function isFloatingFooterPageTable(fragment: Fragment, block: FlowBlock, kind: HeaderFooterKind | undefined): boolean {
  return (
    kind === 'footer' &&
    fragment.kind === 'table' &&
    fragment.isAnchored === true &&
    isPagePositionedFloatingTable(block)
  );
}

function horizontalTextBand(
  block: ImageBlock | DrawingBlock,
  constraints: HeaderFooterMeasurementConstraints,
): Span | null {
  const pageRelativeX = block.anchor?.hRelativeFrom === 'page';
  if (pageRelativeX && !isPositiveFinite(constraints.pageWidth)) return null;
  if (!isPositiveFinite(constraints.width)) return null;
  const left = pageRelativeX ? (constraints.margins?.left ?? 0) : 0;
  return Number.isFinite(left) ? { start: left, end: left + constraints.width } : null;
}

function sitsBesideTextBand(
  fragment: ImageFragment | DrawingFragment,
  block: ImageBlock | DrawingBlock,
  kind: HeaderFooterKind | undefined,
  constraints: HeaderFooterMeasurementConstraints,
): boolean {
  const wrap = block.wrap;
  if (!kind || !wrap || !TEXT_WRAPPING_BESIDE_TYPES.has(wrap.type)) return false;
  if (wrap.wrapText != null && wrap.wrapText !== 'bothSides') return false;
  const distLeft = wrap.distLeft ?? 0;
  const distRight = wrap.distRight ?? 0;
  if (!isNonNegativeFinite(distLeft) || !isNonNegativeFinite(distRight)) return false;
  const band = horizontalTextBand(block, constraints);
  if (!band || !Number.isFinite(fragment.x) || !isPositiveFinite(fragment.width)) return false;
  const left = fragment.x - distLeft;
  const right = fragment.x + fragment.width + distRight;
  return Number.isFinite(left) && Number.isFinite(right) && !spansIntersect(left, right, band.start, band.end);
}

function anchoredGraphicReservesNoHeight(
  fragment: ImageFragment | DrawingFragment,
  block: ImageBlock | DrawingBlock,
  fragmentBottom: number,
  canvasHeight: number,
  kind: HeaderFooterKind | undefined,
  constraints: HeaderFooterMeasurementConstraints,
): boolean {
  if (sitsBesideTextBand(fragment, block, kind, constraints)) return true;
  if (block.anchor?.behindDoc) return true;
  if (kind && block.wrap?.type === 'None') return true;
  if (isPageRelativeAnchor(block) && isOutsideMeasurementCanvas(fragment.y, fragmentBottom, canvasHeight)) {
    return true;
  }
  if (block.anchor?.vRelativeFrom !== 'page') return false;
  const band = regionMarginBand(kind, constraints);
  return band != null && !spansIntersect(fragment.y, fragmentBottom, band.start, band.end);
}

export function shouldExcludeFromMeasurement(
  fragment: Fragment,
  block: FlowBlock,
  fragmentBottom: number,
  canvasHeight: number,
  kind: HeaderFooterKind | undefined,
  constraints: HeaderFooterMeasurementConstraints,
): boolean {
  if (isFloatingFooterPageTable(fragment, block, kind)) return true;

  if (fragment.kind === 'para' && block.kind === 'paragraph') {
    const frame = block.attrs?.frame;
    if (isPagePositionedParagraphFrame(frame)) {
      return pageFrameStaysOutOfFlow(
        frame.wrap,
        kind,
        () => regionMarginBand(kind, constraints),
        () => ({ start: fragment.y, end: fragmentBottom }),
      );
    }
  }

  if ((fragment.kind !== 'image' && fragment.kind !== 'drawing') || fragment.isAnchored !== true) return false;

  if (block.kind !== 'image' && block.kind !== 'drawing') {
    throw new Error(
      `Type mismatch: fragment kind is ${fragment.kind} but block kind is ${block.kind} for block ${block.id}`,
    );
  }

  return anchoredGraphicReservesNoHeight(fragment, block, fragmentBottom, canvasHeight, kind, constraints);
}

function extendExtent(extent: VerticalExtent, top: number, bottom: number): void {
  if (top < extent.minY) extent.minY = top;
  if (bottom > extent.maxY) extent.maxY = bottom;
}

function emptyExtent(): VerticalExtent {
  return { minY: 0, maxY: 0 };
}

export function finalizeHeaderFooterLayout(
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  constraints: HeaderFooterMeasurementConstraints,
  height: number,
  kind: HeaderFooterKind | undefined,
): HeaderFooterLayout {
  if (kind && constraints.pageHeight != null) {
    normalizeFragmentsForRegion(layout.pages, blocks, measures, kind, constraints);
  }

  if (kind) {
    const story = { kind };
    for (const page of layout.pages) {
      page.fragments = page.fragments.map((fragment) => ({
        ...fragment,
        layoutSourceIdentity: buildLayoutSourceIdentityForFragment(fragment, story),
      }));
    }
  }

  const idToIndex = new Map<string, number>();
  for (let i = 0; i < blocks.length; i += 1) {
    idToIndex.set(blocks[i].id, i);
  }

  const storyMeasurement = emptyExtent();
  const storyRender = emptyExtent();
  const pageExtents = layout.pages.map(() => ({ measurement: emptyExtent(), render: emptyExtent() }));

  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
    const page = layout.pages[pageIndex];
    const pageExtent = pageExtents[pageIndex];
    for (const fragment of page.fragments) {
      const idx = idToIndex.get(fragment.blockId);
      if (idx == null) continue;
      const block = blocks[idx];
      const bottom = computeFragmentBottom(fragment, block, measures[idx]);

      extendExtent(storyRender, fragment.y, bottom);
      extendExtent(pageExtent.render, fragment.y, bottom);

      if (shouldExcludeFromMeasurement(fragment, block, bottom, height, kind, constraints)) continue;

      extendExtent(storyMeasurement, fragment.y, bottom);
      extendExtent(pageExtent.measurement, fragment.y, bottom);
    }
  }

  return {
    height: storyMeasurement.maxY - storyMeasurement.minY,
    minY: storyRender.minY,
    maxY: storyRender.maxY,
    renderHeight: storyRender.maxY - storyRender.minY,
    pages: layout.pages.map((page, pageIndex) => {
      const { measurement, render } = pageExtents[pageIndex];
      return {
        number: page.number,
        fragments: page.fragments,
        measurementHeight: measurement.maxY - measurement.minY,
        minY: render.minY,
        maxY: render.maxY,
        renderHeight: render.maxY - render.minY,
      };
    }),
  };
}
