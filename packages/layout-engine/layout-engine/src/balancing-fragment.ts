import type { BalancingFragment, MeasureData } from './column-balancing.js';

export const FIXED_HEIGHT_FRAGMENT_KINDS: ReadonlySet<string> = new Set(['image', 'drawing', 'table']);

export function remeasuredLines(fragment: BalancingFragment): Array<{ lineHeight: number }> | undefined {
  return fragment.lines && fragment.lines.length > 0 ? fragment.lines : undefined;
}

export function isSectPrMarkerParagraph(fragment: BalancingFragment, sectPrMarkerBlockIds?: Set<string>): boolean {
  return fragment.kind === 'para' && Boolean(sectPrMarkerBlockIds && sectPrMarkerBlockIds.has(fragment.blockId));
}

function paragraphHeight(fragment: BalancingFragment, measureMap: Map<string, MeasureData>): number {
  const lines = remeasuredLines(fragment);
  if (lines) return lines.reduce((sum, line) => sum + (line.lineHeight ?? 0), 0);
  const measure = measureMap.get(fragment.blockId);
  if (!measure || measure.kind !== 'paragraph' || !measure.lines) return 0;
  let height = 0;
  const fromLine = fragment.fromLine ?? 0;
  const toLine = fragment.toLine ?? measure.lines.length;
  for (let line = fromLine; line < toLine; line++) {
    height += measure.lines[line]?.lineHeight ?? 0;
  }
  return height;
}

function fixedFragmentHeight(fragment: BalancingFragment, measureMap: Map<string, MeasureData>): number {
  if (typeof fragment.height === 'number' && fragment.height > 0) return fragment.height;
  const measure = measureMap.get(fragment.blockId);
  if (measure) {
    if (typeof measure.height === 'number' && measure.height > 0) return measure.height;
    if (fragment.kind === 'table' && typeof measure.totalHeight === 'number') return measure.totalHeight;
  }
  return typeof fragment.height === 'number' ? fragment.height : 0;
}

export function getFragmentHeight(fragment: BalancingFragment, measureMap: Map<string, MeasureData>): number {
  if (fragment.kind === 'para') return paragraphHeight(fragment, measureMap);
  if (FIXED_HEIGHT_FRAGMENT_KINDS.has(fragment.kind)) return fixedFragmentHeight(fragment, measureMap);
  return 0;
}

export function getBalancingHeight(
  fragment: BalancingFragment,
  measureMap: Map<string, MeasureData>,
  sectPrMarkerBlockIds?: Set<string>,
): number {
  return isSectPrMarkerParagraph(fragment, sectPrMarkerBlockIds) ? 0 : getFragmentHeight(fragment, measureMap);
}

export function recordedColumnIndex(fragment: BalancingFragment): unknown {
  return 'columnIndex' in fragment ? fragment.columnIndex : undefined;
}

export function setRecordedColumnIndex(fragment: BalancingFragment, columnIndex: number): void {
  if ('columnIndex' in fragment) Object.assign(fragment, { columnIndex });
}
