import type { FlowBlock, ParagraphBlock } from '@superdoc/contracts';
import type { LayoutWorkCheckpoint } from './execution.js';
import type { FootnoteAnchorRef } from './layout-paragraph.js';

export type FootnoteAnchorIndexInput = {
  /** Use proved native paragraph/run ownership in the coupled page path. */
  nativeRunOwnership?: boolean;
  refs?: Array<{ id: string; pos: number; blockId?: string; runOrdinal?: number | null }>;
  bodyHeightById?: Map<string, number>;
  firstLineHeightById?: Map<string, number>;
};

const V2_RENDER_DIAGNOSTIC_BLOCK = Symbol.for('superdoc.v2.render-diagnostic.block');

export type FootnoteAnchorIndexDiagnostics = {
  rangeComparisons: number;
  lowerBoundComparisons: number;
  legacyComparisons: number;
};

type PmRange = { pmStart: number; pmEnd: number };

const MAX_SYNCHRONOUS_SORT_ITEMS = 1024;
// These work units are scalar lookups/comparisons, not measured body blocks.
// Yielding after each one makes scheduling dominate large reference indexes.
// Keep batches bounded without changing the paginator's block/page cadence.
const MIN_SCALAR_CHECKPOINT_INTERVAL = 64;

const validBodyHeight = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function* buildFootnoteAnchorIndexSteps(
  blocks: FlowBlock[],
  footnotes: FootnoteAnchorIndexInput | undefined,
  checkpointEveryBlocks: number | null,
  diagnostics?: FootnoteAnchorIndexDiagnostics,
): Generator<LayoutWorkCheckpoint, Map<string, FootnoteAnchorRef[]>, void> {
  const out = new Map<string, FootnoteAnchorRef[]>();
  if (diagnostics) {
    diagnostics.rangeComparisons = 0;
    diagnostics.lowerBoundComparisons = 0;
    diagnostics.legacyComparisons = 0;
  }

  const refs = footnotes?.refs;
  const bodyHeights = footnotes?.bodyHeightById;
  const firstLineHeights = footnotes?.firstLineHeightById;
  if (!Array.isArray(refs) || refs.length === 0 || !bodyHeights) return out;

  let operationIndex = 0;
  const scalarCheckpointInterval =
    checkpointEveryBlocks == null ? null : Math.max(MIN_SCALAR_CHECKPOINT_INTERVAL, checkpointEveryBlocks);
  const nextCheckpoint = (): LayoutWorkCheckpoint | null => {
    const index = operationIndex;
    operationIndex += 1;
    return scalarCheckpointInterval != null && index % scalarCheckpointInterval === 0 ? { index } : null;
  };

  function* sortAscendingSteps<T>(
    values: T[],
    compare: (left: T, right: T) => number,
  ): Generator<LayoutWorkCheckpoint, T[], void> {
    if (values.length < 2) return values.slice();
    if (values.length <= MAX_SYNCHRONOUS_SORT_ITEMS) return values.slice().sort(compare);
    let source = values.slice();
    let target = new Array<T>(values.length);
    for (let width = 1; width < source.length; width *= 2) {
      for (let start = 0; start < source.length; start += width * 2) {
        const middle = Math.min(start + width, source.length);
        const end = Math.min(start + width * 2, source.length);
        let left = start;
        let right = middle;
        for (let outputIndex = start; outputIndex < end; outputIndex += 1) {
          const checkpoint = nextCheckpoint();
          if (checkpoint) yield checkpoint;
          if (left < middle && (right >= end || compare(source[left]!, source[right]!) <= 0)) {
            target[outputIndex] = source[left++]!;
          } else {
            target[outputIndex] = source[right++]!;
          }
        }
      }
      [source, target] = [target, source];
    }
    return source;
  }

  function* resolveBlockPmRangeSteps(block: FlowBlock): Generator<LayoutWorkCheckpoint, PmRange | null, void> {
    const attrsRange = (block as { attrs?: { pmStart?: number; pmEnd?: number } }).attrs;
    let pmStart = typeof attrsRange?.pmStart === 'number' ? attrsRange.pmStart : undefined;
    let pmEnd = typeof attrsRange?.pmEnd === 'number' ? attrsRange.pmEnd : undefined;
    if (pmStart == null && block.kind === 'paragraph') {
      const runs = block.runs;
      if (Array.isArray(runs)) {
        for (const run of runs) {
          const checkpoint = nextCheckpoint();
          if (checkpoint) yield checkpoint;
          const runStart = (run as { pmStart?: number }).pmStart;
          const runEnd = (run as { pmEnd?: number }).pmEnd;
          if (typeof runStart === 'number') pmStart = pmStart == null ? runStart : Math.min(pmStart, runStart);
          if (typeof runEnd === 'number') pmEnd = pmEnd == null ? runEnd : Math.max(pmEnd, runEnd);
        }
      }
    }
    if (pmStart == null) return null;
    return { pmStart, pmEnd: pmEnd ?? pmStart + 1 };
  }

  // Native references already prove their paragraph/run owner. Their positions
  // can be synthetic or shared by zero-width markers, so do not key them by PM
  // position. Nested table references keep the conservative table-level path.
  const paragraphsById = new Map<string, ParagraphBlock>();
  for (const block of footnotes?.nativeRunOwnership ? blocks : []) {
    const checkpoint = nextCheckpoint();
    if (checkpoint) yield checkpoint;
    if (block.kind === 'paragraph') paragraphsById.set(block.id, block);
  }
  const appendAnchor = (position: number, refId: string, ownerId: string, runOrdinal?: number): boolean => {
    const fullHeight = bodyHeights.get(refId);
    if (!validBodyHeight(fullHeight)) return false;
    const firstLineRaw = firstLineHeights?.get(refId);
    const firstLineHeight = validBodyHeight(firstLineRaw) ? Math.min(firstLineRaw, fullHeight) : fullHeight;
    const list = out.get(ownerId) ?? [];
    list.push({ pmPos: position, refId, fullHeight, firstLineHeight, ...(runOrdinal == null ? {} : { runOrdinal }) });
    out.set(ownerId, list);
    return true;
  };

  const refByPos = new Map<number, string>();
  const seenIds = new Set<string>();
  let canUseIndexedLookup = true;
  for (const ref of refs) {
    const checkpoint = nextCheckpoint();
    if (checkpoint) yield checkpoint;
    if (seenIds.has(ref.id)) continue;
    seenIds.add(ref.id);
    const owner = ref.blockId == null ? undefined : paragraphsById.get(ref.blockId);
    if (
      owner &&
      typeof ref.runOrdinal === 'number' &&
      Number.isInteger(ref.runOrdinal) &&
      ref.runOrdinal >= 0 &&
      ref.runOrdinal < owner.runs.length
    ) {
      appendAnchor(ref.pos, ref.id, owner.id, ref.runOrdinal);
      continue;
    }
    refByPos.set(ref.pos, ref.id);
    if (!Number.isFinite(ref.pos)) canUseIndexedLookup = false;
  }

  const indexablePositions: number[] = [];
  if (canUseIndexedLookup) {
    for (const [position, id] of refByPos) {
      const checkpoint = nextCheckpoint();
      if (checkpoint) yield checkpoint;
      if (validBodyHeight(bodyHeights.get(id))) indexablePositions.push(position);
    }
  }
  const sortedRefPositions = yield* sortAscendingSteps(indexablePositions, (left, right) => left - right);
  const diagnosticRefsByBlockId = new Map<string, Array<{ id: string; pos: number }>>();
  for (const ref of refs) {
    const checkpoint = nextCheckpoint();
    if (checkpoint) yield checkpoint;
    if (
      typeof ref.blockId !== 'string' ||
      refByPos.get(ref.pos) !== ref.id ||
      !validBodyHeight(bodyHeights.get(ref.id))
    ) {
      continue;
    }
    const entries = diagnosticRefsByBlockId.get(ref.blockId) ?? [];
    entries.push({ id: ref.id, pos: ref.pos });
    diagnosticRefsByBlockId.set(ref.blockId, entries);
  }
  const sortedIndexByPosition = new Map<number, number>();
  const nextActiveIndex = new Int32Array(sortedRefPositions.length + 1);
  for (let index = 0; index < nextActiveIndex.length; index += 1) {
    const checkpoint = nextCheckpoint();
    if (checkpoint) yield checkpoint;
    nextActiveIndex[index] = index;
    if (index < sortedRefPositions.length) sortedIndexByPosition.set(sortedRefPositions[index]!, index);
  }

  const findNextActiveIndex = (input: number): number => {
    let root = input;
    while (nextActiveIndex[root] !== root) root = nextActiveIndex[root]!;
    let cursor = input;
    while (nextActiveIndex[cursor] !== cursor) {
      const parent = nextActiveIndex[cursor]!;
      nextActiveIndex[cursor] = root;
      cursor = parent;
    }
    return root;
  };

  const removeIndexedPosition = (position: number): void => {
    const index = sortedIndexByPosition.get(position);
    if (index == null || findNextActiveIndex(index) !== index) return;
    nextActiveIndex[index] = findNextActiveIndex(index + 1);
  };

  function* lowerBoundRefPositionSteps(value: number): Generator<LayoutWorkCheckpoint, number, void> {
    let low = 0;
    let high = sortedRefPositions.length;
    while (low < high) {
      const checkpoint = nextCheckpoint();
      if (checkpoint) yield checkpoint;
      const middle = low + Math.floor((high - low) / 2);
      if (diagnostics) {
        diagnostics.rangeComparisons += 1;
        diagnostics.lowerBoundComparisons += 1;
      }
      if (sortedRefPositions[middle]! < value) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  const record = (position: number, refId: string, topLevelId: string): boolean => {
    if (!appendAnchor(position, refId, topLevelId)) return false;
    refByPos.delete(position);
    removeIndexedPosition(position);
    return true;
  };

  function* recordIfHitSteps(range: PmRange, topLevelId: string): Generator<LayoutWorkCheckpoint, void, void> {
    if (canUseIndexedLookup && Number.isFinite(range.pmStart) && Number.isFinite(range.pmEnd)) {
      let refIndex = findNextActiveIndex(yield* lowerBoundRefPositionSteps(range.pmStart));
      while (refIndex < sortedRefPositions.length) {
        const checkpoint = nextCheckpoint();
        if (checkpoint) yield checkpoint;
        const position = sortedRefPositions[refIndex]!;
        if (diagnostics) diagnostics.rangeComparisons += 1;
        if (position > range.pmEnd) break;
        const refId = refByPos.get(position);
        if (refId != null) record(position, refId, topLevelId);
        else removeIndexedPosition(position);
        refIndex = findNextActiveIndex(refIndex);
      }
      return;
    }

    for (const [position, refId] of refByPos.entries()) {
      const checkpoint = nextCheckpoint();
      if (checkpoint) yield checkpoint;
      if (diagnostics) {
        diagnostics.rangeComparisons += 1;
        diagnostics.legacyComparisons += 1;
      }
      if (position < range.pmStart || position > range.pmEnd) continue;
      record(position, refId, topLevelId);
    }
  }

  for (const block of blocks) {
    const checkpoint = nextCheckpoint();
    if (checkpoint) yield checkpoint;
    if (refByPos.size === 0) break;
    if ((block as unknown as Record<PropertyKey, unknown>)[V2_RENDER_DIAGNOSTIC_BLOCK] === true) {
      for (const ref of diagnosticRefsByBlockId.get(block.id) ?? []) {
        const diagnosticCheckpoint = nextCheckpoint();
        if (diagnosticCheckpoint) yield diagnosticCheckpoint;
        if (refByPos.get(ref.pos) === ref.id) record(ref.pos, ref.id, block.id);
      }
    }
    const range = yield* resolveBlockPmRangeSteps(block);
    if (range) yield* recordIfHitSteps(range, block.id);

    if (block.kind !== 'table') continue;
    for (const row of block.rows ?? []) {
      for (const cell of row.cells ?? []) {
        const cellChildren: FlowBlock[] = cell.blocks
          ? (cell.blocks as FlowBlock[])
          : cell.paragraph
            ? [cell.paragraph as FlowBlock]
            : [];
        for (const child of cellChildren) {
          const childCheckpoint = nextCheckpoint();
          if (childCheckpoint) yield childCheckpoint;
          const childRange = yield* resolveBlockPmRangeSteps(child);
          if (childRange) yield* recordIfHitSteps(childRange, block.id);
        }
      }
    }
  }

  for (const [topLevelId, list] of out) {
    const checkpoint = nextCheckpoint();
    if (checkpoint) yield checkpoint;
    out.set(topLevelId, yield* sortAscendingSteps(list, (left, right) => left.pmPos - right.pmPos));
  }
  return out;
}
