import type { SelectionCapture, SelectionPoint, SelectionSlice, SelectionTarget, TextTarget } from './types.js';
import { readRecord, readRecordList, type LooseRecord } from './loose-record.js';
import { isObjectRecord, isPlainObject } from '../../helpers/object-guards.js';
import { isStoryLocator, type StoryLocator, type TextAddress, type TextSegment } from '@superdoc/document-api';

export const EMPTY_SELECTION: SelectionSlice = {
  status: 'ready',
  empty: true,
  target: null,
  selectionTarget: null,
  activeMarks: [],
  activeCommentIds: [],
  activeChangeIds: [],
  quotedText: '',
};

export function textTargetSegments(target: TextTarget | null | undefined): readonly TextSegment[] {
  return target && Array.isArray(target.segments) ? target.segments : [];
}

export function selectionPointWithBlockId(
  point: SelectionPoint | null | undefined,
): Extract<SelectionPoint, { kind: 'text' }> | undefined {
  return isObjectRecord(point) && 'blockId' in point ? point : undefined;
}

function selectionPointBlockId(point: SelectionPoint | undefined): string | undefined {
  const blockId = selectionPointWithBlockId(point)?.blockId;
  return typeof blockId === 'string' ? blockId : undefined;
}

function selectionPointStory(point: SelectionPoint | undefined): StoryLocator | undefined {
  return isObjectRecord(point) && 'story' in point ? point.story : undefined;
}

export function selectionBlockRange(selection: SelectionSlice): { startBlockId: string; endBlockId: string } | null {
  const sel = selection.selectionTarget;
  if (sel) {
    const startBlockId = selectionPointBlockId(sel.start);
    const endBlockId = selectionPointBlockId(sel.end) ?? startBlockId;
    if (startBlockId) return { startBlockId, endBlockId: endBlockId ?? startBlockId };
  }
  const segments = textTargetSegments(selection.target);
  const first = segments[0]?.blockId;
  const last = segments[segments.length - 1]?.blockId;
  if (typeof first === 'string') {
    return { startBlockId: first, endBlockId: typeof last === 'string' ? last : first };
  }
  return null;
}

export function selectionBlockIds(selection: SelectionSlice): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: unknown) => {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const segment of textTargetSegments(selection.target)) push(segment?.blockId);
  const sel = selection.selectionTarget;
  if (sel) {
    push(selectionPointBlockId(sel.start));
    push(selectionPointBlockId(sel.end));
  }
  return ids;
}

export const MAX_REACTIVE_SELECTION_BLOCK_READS = 64;

export function canProbeEverySelectedBlock(blockIds: readonly string[]): boolean {
  return blockIds.length <= MAX_REACTIVE_SELECTION_BLOCK_READS;
}

export function selectionStoryLocator(selection: SelectionSlice): unknown | undefined {
  const explicit = selection.selectionTarget;
  const story =
    selection.target?.story ??
    explicit?.story ??
    selectionPointStory(explicit?.start) ??
    selectionPointStory(explicit?.end);
  return story && typeof story === 'object' ? story : undefined;
}

export function selectionStory(selection: SelectionSlice): LooseRecord {
  return readRecord(selectionStoryLocator(selection)) ?? { kind: 'story', storyType: 'body' };
}

export function paragraphTarget(blockId: string, story?: unknown): LooseRecord {
  return {
    kind: 'block',
    nodeType: 'paragraph',
    nodeId: blockId,
    ...(story && typeof story === 'object' ? { story } : {}),
  };
}

export function listsBlockTarget(blockId: string): LooseRecord {
  return {
    kind: 'block',
    nodeType: 'paragraph',
    nodeId: blockId,
  };
}

export function listItemTarget(blockId: string, story?: unknown): LooseRecord {
  return {
    kind: 'block',
    nodeType: 'listItem',
    nodeId: blockId,
    ...(story && typeof story === 'object' ? { story } : {}),
  };
}

export function selectionTextAddresses(selection: SelectionSlice): TextAddress[] {
  const target = selection.target;
  const story = target?.story;
  const addresses: TextAddress[] = [];
  for (const segment of textTargetSegments(target)) {
    if (!segment || typeof segment.blockId !== 'string') continue;
    const range = segment.range;
    if (!range || typeof range.start !== 'number' || typeof range.end !== 'number' || range.start === range.end) {
      continue;
    }
    addresses.push({
      kind: 'text',
      blockId: segment.blockId,
      range: { start: range.start, end: range.end },
      ...(story ? { story } : {}),
    });
  }
  return addresses;
}

export function textAddressesFromTarget(target: unknown): LooseRecord[] {
  const record = readRecord(target);
  if (!record) return [];
  const story = record.story;
  const addresses: LooseRecord[] = [];
  if (record.kind === 'text' && record.range && typeof record.blockId === 'string') {
    const range = readRecord(record.range);
    if (typeof range?.start === 'number' && typeof range.end === 'number' && range.start !== range.end) {
      addresses.push({
        kind: 'text',
        blockId: record.blockId,
        range: { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) },
        ...(story ? { story } : {}),
      });
    }
    return addresses;
  }
  if (record.kind === 'text' && Array.isArray(record.segments)) {
    for (const segment of readRecordList(record.segments)) {
      const range = readRecord(segment?.range);
      if (
        typeof segment?.blockId === 'string' &&
        typeof range?.start === 'number' &&
        typeof range?.end === 'number' &&
        range.start !== range.end
      ) {
        addresses.push({
          kind: 'text',
          blockId: segment.blockId,
          range: { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) },
          ...(story ? { story } : {}),
        });
      }
    }
    return addresses;
  }
  if (record.kind === 'selection') {
    const start = readRecord(record.start);
    const end = readRecord(record.end);
    const blockId = typeof start?.blockId === 'string' && end?.blockId === start.blockId ? start.blockId : null;
    if (
      start?.kind === 'text' &&
      end?.kind === 'text' &&
      blockId &&
      typeof start.offset === 'number' &&
      typeof end.offset === 'number' &&
      start.offset !== end.offset
    ) {
      addresses.push({
        kind: 'text',
        blockId,
        range: { start: Math.min(start.offset, end.offset), end: Math.max(start.offset, end.offset) },
        ...((record.story ?? start.story) ? { story: record.story ?? start.story } : {}),
      });
    }
  }
  return addresses;
}

export function collapsedTextAddressFromTarget(target: unknown): LooseRecord | null {
  const record = readRecord(target);
  if (!record) return null;
  const story = record.story;
  if (record.kind === 'text' && record.range && typeof record.blockId === 'string') {
    const range = readRecord(record.range);
    if (typeof range?.start === 'number' && typeof range.end === 'number' && range.start === range.end) {
      return {
        kind: 'text',
        blockId: record.blockId,
        range: { start: range.start, end: range.end },
        ...(story ? { story } : {}),
      };
    }
  }
  if (record.kind === 'text' && Array.isArray(record.segments)) {
    const segment = readRecordList(record.segments)[0];
    const range = readRecord(segment?.range);
    if (
      typeof segment?.blockId === 'string' &&
      typeof range?.start === 'number' &&
      typeof range?.end === 'number' &&
      range.start === range.end
    ) {
      return {
        kind: 'text',
        blockId: segment.blockId,
        range: { start: range.start, end: range.end },
        ...(story ? { story } : {}),
      };
    }
  }
  if (record.kind === 'selection') {
    const start = readRecord(record.start);
    const end = readRecord(record.end);
    const blockId = typeof start?.blockId === 'string' && end?.blockId === start.blockId ? start.blockId : null;
    if (
      start?.kind === 'text' &&
      end?.kind === 'text' &&
      blockId &&
      typeof start.offset === 'number' &&
      typeof end.offset === 'number' &&
      start.offset === end.offset
    ) {
      return {
        kind: 'text',
        blockId,
        range: { start: start.offset, end: start.offset },
        ...((record.story ?? start.story) ? { story: record.story ?? start.story } : {}),
      };
    }
  }
  return null;
}

export function collapsedTextAddressFromSelection(selection: SelectionSlice): LooseRecord | null {
  return collapsedTextAddressFromTarget(selection.target) ?? collapsedTextAddressFromTarget(selection.selectionTarget);
}

export function isHeaderFooterCaret(selection: SelectionSlice): boolean {
  const story = readRecord(collapsedTextAddressFromSelection(selection)?.story);
  return story?.storyType === 'headerFooterPart' || story?.storyType === 'headerFooterSlot';
}

export function createLocationAt(selection: SelectionSlice, mode: 'nodeId' | 'target'): LooseRecord {
  const blockId = selectionBlockIds(selection)[0];
  if (!blockId) return { kind: 'documentEnd' };
  return mode === 'nodeId' ? { kind: 'after', nodeId: blockId } : { kind: 'after', target: paragraphTarget(blockId) };
}

export function hyperlinkAddressToSelectionTarget(address: LooseRecord | null | undefined): LooseRecord | null {
  const anchor = readRecord(address?.anchor);
  const start = readRecord(anchor?.start);
  const end = readRecord(anchor?.end);
  if (typeof start?.blockId !== 'string' || typeof end?.blockId !== 'string') return null;
  if (start.blockId !== end.blockId) return null;
  if (typeof start.offset !== 'number' || typeof end.offset !== 'number') return null;
  return {
    kind: 'selection',
    start: { kind: 'text', blockId: start.blockId, offset: start.offset },
    end: { kind: 'text', blockId: end.blockId, offset: end.offset },
  };
}

export function hyperlinkTargetFromHref(href: string): LooseRecord {
  if (href.startsWith('#')) return { kind: 'anchor', anchor: href.slice(1) };
  return { kind: 'external', url: href };
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

export function isAddressableSegment(
  segment: unknown,
): segment is { blockId: string; range: { start: number; end: number } } {
  const candidate = readRecord(segment);
  const range = readRecord(candidate?.range);
  if (typeof candidate?.blockId !== 'string' || !range) return false;
  const { start, end } = range;
  return isInteger(start) && isInteger(end) && start >= 0 && start <= end;
}

export function selectionTargetFromTextTarget(
  target: SelectionSlice['target'] | SelectionCapture['target'] | null,
): SelectionTarget | null {
  if (!target || target.kind !== 'text' || !Array.isArray(target.segments) || target.segments.length === 0) return null;
  const segments = Array.from(target.segments);
  if (!segments.every(isAddressableSegment)) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const story = target.story;
  const start = {
    kind: 'text' as const,
    blockId: first.blockId,
    offset: first.range.start,
    ...(story ? { story } : {}),
  };
  const end = {
    kind: 'text' as const,
    blockId: last.blockId,
    offset: last.range.end,
    ...(story ? { story } : {}),
  };
  return {
    kind: 'selection',
    start,
    end,
    ...(story ? { story } : {}),
  };
}

export type CellSelectionCapture = SelectionCapture & {
  _tableCellSelectionTarget?: unknown;
  _paintedSelectionTarget?: unknown;
};

export type TextSelectionTarget = SelectionTarget & {
  start: Extract<SelectionTarget['start'], { kind: 'text' }>;
  end: Extract<SelectionTarget['end'], { kind: 'text' }>;
};

export function capturedTableCellTarget(value: unknown): TextSelectionTarget | null {
  return isCapturedTextSelectionTarget(value) ? value : null;
}

function isCapturedTextSelectionTarget(value: unknown): value is TextSelectionTarget {
  return (
    isPlainObject(value) &&
    value.kind === 'selection' &&
    (value.coordinateSpace === undefined ||
      value.coordinateSpace === 'visible' ||
      value.coordinateSpace === 'tracked') &&
    (value.story === undefined || isStoryLocator(value.story)) &&
    isCapturedTextPoint(value.start) &&
    isCapturedTextPoint(value.end)
  );
}

function isCapturedTextPoint(point: unknown): point is TextSelectionTarget['start'] {
  return (
    isPlainObject(point) &&
    point.kind === 'text' &&
    typeof point.blockId === 'string' &&
    point.blockId.length > 0 &&
    isInteger(point.offset) &&
    point.offset >= 0 &&
    (point.story === undefined || isStoryLocator(point.story))
  );
}

export function selectionTargetForRestore(capture: SelectionCapture): SelectionTarget | null {
  if (capture.selectionTarget) return capture.selectionTarget;
  return selectionTargetFromTextTarget(capture.target);
}

export function resolveInlineSelectionTarget(selection: SelectionSlice): SelectionTarget | null {
  if (selection.empty) return null;
  if (selection.selectionTarget) return selection.selectionTarget;
  const fallback = selectionTargetFromTextTarget(selection.target);
  if (
    fallback &&
    fallback.start.kind === 'text' &&
    fallback.end.kind === 'text' &&
    fallback.start.blockId !== fallback.end.blockId
  ) {
    return null;
  }
  return fallback;
}

export function selectionHasOnlyDeletedText(selection: SelectionSlice): boolean {
  const target = selection.target;
  const selected = selection.selectionTarget;
  return (
    !selection.empty &&
    selected?.kind === 'selection' &&
    selected.coordinateSpace === 'tracked' &&
    target?.kind === 'text' &&
    target.segments.length > 0 &&
    target.segments.every((segment) => segment.range.start === segment.range.end)
  );
}

export function selectionTouchesDeletedText(selection: SelectionSlice): boolean {
  const target = selection.target;
  if (selection.empty || target?.kind !== 'text' || !Array.isArray(target.segments) || target.segments.length === 0)
    return false;
  const visibleLength = target.segments.reduce(
    (length, segment) => length + Math.abs(segment.range.end - segment.range.start),
    0,
  );
  const selected = selection.selectionTarget;
  const trackedSegments = selection.trackedTarget?.segments;
  const trackedLength =
    (Array.isArray(trackedSegments)
      ? trackedSegments.reduce((length, segment) => length + Math.abs(segment.range.end - segment.range.start), 0)
      : undefined) ??
    (selected?.coordinateSpace === 'tracked' &&
    selected.start.kind === 'text' &&
    selected.end.kind === 'text' &&
    selected.start.blockId === selected.end.blockId
      ? Math.abs(selected.end.offset - selected.start.offset)
      : 0);
  return trackedLength > visibleLength;
}
