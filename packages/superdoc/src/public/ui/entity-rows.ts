import { readRecord } from './loose-record.js';
import { decodeLayoutStoryDataset } from '@superdoc/dom-contract';

export function readEntityTarget(row: unknown): unknown | null {
  return readRecord(readRecord(row)?.target) ?? null;
}

export type TrackedChangeMoveSide = { canonicalId: string; side: 'move-from' | 'move-to' };

export function readTrackedChangeMoveSide(row: unknown): TrackedChangeMoveSide | null {
  const record = readRecord(row);
  if (record?.type !== 'move' || typeof record.trackedChangeCanonicalId !== 'string') return null;
  if (record.subtype !== 'move-from' && record.subtype !== 'move-to') return null;
  return { canonicalId: record.trackedChangeCanonicalId, side: record.subtype };
}

const moveSidesByRows = new WeakMap<readonly unknown[], ReadonlyMap<string, TrackedChangeMoveSide>>();

export function trackedChangeMoveSidesById(rows: readonly unknown[]): ReadonlyMap<string, TrackedChangeMoveSide> {
  const cached = moveSidesByRows.get(rows);
  if (cached) return cached;
  const sides = new Map<string, TrackedChangeMoveSide>();
  for (const row of rows) {
    const side = readTrackedChangeMoveSide(row);
    const id = readRecord(row)?.id;
    if (side && typeof id === 'string') sides.set(id, side);
  }
  moveSidesByRows.set(rows, sides);
  return sides;
}

export function readMoveSideTarget(moveTarget: unknown, side: TrackedChangeMoveSide['side']): unknown | null {
  const record = readRecord(moveTarget);
  if (record?.kind !== 'move') return null;
  const sideTarget = side === 'move-to' ? record.destination : record.source;
  return isHostGeometryTarget(sideTarget) ? sideTarget : null;
}

export function isHostGeometryTarget(target: unknown): boolean {
  const record = readRecord(target);
  if (!record) return false;
  const isTextPoint = (point: unknown): boolean => {
    const candidate = readRecord(point);
    return candidate?.kind === 'text' && typeof candidate.blockId === 'string' && typeof candidate.offset === 'number';
  };
  const isTextSegment = (segment: unknown): boolean => {
    const candidate = readRecord(segment);
    const range = readRecord(candidate?.range);
    return typeof candidate?.blockId === 'string' && typeof range?.start === 'number' && typeof range.end === 'number';
  };

  if (Array.isArray(record.segments)) {
    const first = record.segments[0];
    const last = record.segments[record.segments.length - 1];
    return isTextSegment(first) && isTextSegment(last);
  }
  if (record.kind === 'selection') {
    return isTextPoint(record.start) && isTextPoint(record.end);
  }
  if (record.kind !== 'text' || typeof record.blockId !== 'string') return false;
  const range = readRecord(record.range);
  return typeof range?.start === 'number' && typeof range.end === 'number';
}

export function readTrackedChangeNavigationTarget(
  row: unknown,
  options?: { preferStableBlock?: boolean },
): unknown | null {
  const record = readRecord(row);
  if (!record) return null;
  const target = readEntityTarget(row);
  const navigationTarget = readRecord(record.navigationTarget);
  if (
    navigationTarget?.kind === 'block' &&
    typeof navigationTarget.blockId === 'string' &&
    navigationTarget.blockId.length > 0
  ) {
    const stableBlockTarget = {
      kind: 'text',
      blockId: navigationTarget.blockId,
      range: { start: 0, end: 0 },
      ...(navigationTarget.story && typeof navigationTarget.story === 'object'
        ? { story: navigationTarget.story }
        : {}),
      ...(record.address && typeof record.address === 'object' ? { address: record.address } : {}),
    };
    if (options?.preferStableBlock || !isHostGeometryTarget(target)) return stableBlockTarget;
  }
  return target;
}

export function storyLocatorSignature(story: unknown): string {
  const record = readRecord(story);
  if (!record) return 'story:body';
  const storyType = typeof record.storyType === 'string' ? record.storyType : 'body';
  switch (storyType) {
    case 'body':
      return 'story:body';
    case 'headerFooterPart':
      return `story:headerFooterPart:${typeof record.refId === 'string' ? record.refId : ''}`;
    case 'headerFooterSlot':
      return JSON.stringify({
        storyType,
        section: record.section ?? null,
        headerFooterKind: record.headerFooterKind ?? null,
        variant: record.variant ?? null,
        resolution: record.resolution ?? 'effective',
        onWrite: record.onWrite ?? 'materializeIfInherited',
      });
    case 'footnote':
      return `story:footnote:${typeof record.noteId === 'string' ? record.noteId : ''}`;
    case 'endnote':
      return `story:endnote:${typeof record.noteId === 'string' ? record.noteId : ''}`;
    case 'textbox':
      return `story:textbox:${typeof record.textboxId === 'string' ? record.textboxId : ''}`;
  }
  return JSON.stringify(record);
}

export function readEntityStory(row: unknown): unknown | null {
  const record = readRecord(row);
  if (!record) return null;
  const target = readRecord(readEntityTarget(row));
  return (
    readRecord(readRecord(record.address)?.story) ??
    readRecord(record.storyLocator) ??
    readRecord(record.trackedChangeStory) ??
    readRecord(target?.story) ??
    readRecord(readRecord(target?.address)?.story) ??
    null
  );
}

export function entityRowMatchesRequest(row: unknown, id: string, story?: unknown): boolean {
  if (readEntityId(row) !== id) return false;
  if (!story) return true;
  return storyLocatorSignature(readEntityStory(row)) === storyLocatorSignature(story);
}

export function readEntityRequestStory(row: unknown): unknown | undefined {
  const story = readEntityStory(row);
  if (!story || storyLocatorSignature(story) === storyLocatorSignature(null)) return undefined;
  return story;
}

export function layoutStoryDatasetToStoryLocator(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const decoded = decodeLayoutStoryDataset(raw);
  switch (decoded.kind) {
    case 'body':
      return undefined;
    case 'footnote':
      return decoded.id ? { kind: 'story', storyType: 'footnote', noteId: decoded.id } : undefined;
    case 'endnote':
      return decoded.id ? { kind: 'story', storyType: 'endnote', noteId: decoded.id } : undefined;
    case 'header':
    case 'footer':
      return decoded.id ? { kind: 'story', storyType: 'headerFooterPart', refId: decoded.id } : undefined;
    case 'textbox':
      return decoded.id ? { kind: 'story', storyType: 'textbox', textboxId: decoded.id } : undefined;
    case 'unknown':
      return undefined;
    default: {
      const exhaustive: never = decoded.kind;
      void exhaustive;
      return undefined;
    }
  }
}

export function storyKeyToStoryLocator(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0 || raw === 'body') return undefined;
  if (raw.startsWith('hf:part:')) {
    const refId = raw.slice('hf:part:'.length);
    return refId ? { kind: 'story', storyType: 'headerFooterPart', refId } : undefined;
  }
  if (raw.startsWith('fn:')) {
    const noteId = raw.slice('fn:'.length);
    return noteId ? { kind: 'story', storyType: 'footnote', noteId } : undefined;
  }
  if (raw.startsWith('en:')) {
    const noteId = raw.slice('en:'.length);
    return noteId ? { kind: 'story', storyType: 'endnote', noteId } : undefined;
  }
  return undefined;
}

export function readSelectionTarget(row: unknown): unknown | null {
  return readRecord(readRecord(row)?.selectionTarget) ?? null;
}

export function readContentControlRequestId(input: unknown): string | null {
  const id = readRecord(input)?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function readEntityId(row: unknown): string | null {
  const record = readRecord(row);
  const id = record?.id ?? record?.commentId ?? record?.changeId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
