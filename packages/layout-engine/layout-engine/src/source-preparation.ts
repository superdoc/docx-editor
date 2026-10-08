import type { FlowBlock, Measure, TableBlock } from '@superdoc/contracts';

export type CanonicalPaginationSourceSplice = {
  readonly previous: readonly FlowBlock[];
  readonly current: readonly FlowBlock[];
  readonly authoredChangedBlockIds: readonly string[];
  readonly replacements: readonly { start: number; deleteCount: number; insertCount: number }[];
};

export type PaginationSourceScan = {
  readonly blocks: FlowBlock[];
  readonly measures: Measure[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly candidateIds: readonly string[];
  readonly dependencyIds?: readonly string[];
  readonly offset: number;
  readonly isCurrent?: () => boolean;
};

const readers = new WeakMap<
  object,
  {
    read: (previous: readonly FlowBlock[], current: readonly FlowBlock[]) => CanonicalPaginationSourceSplice | null;
    owns: (source: readonly FlowBlock[]) => boolean;
  }
>();
const scans = new WeakMap<object, PaginationSourceScan>();
const tablePreparationBySource = new WeakMap<
  object,
  ReadonlyMap<
    number,
    {
      readonly table: TableBlock;
      readonly reusable: boolean;
    }
  >
>();

function tablePreparationSnapshot(
  block: TableBlock,
  id = block.id,
  rewrites?: ReadonlyMap<string, string> | null,
): TableBlock {
  // Preparation reads row count and shallow floating geometry. Current rows and
  // PM coordinates are resolved only when this table is actually dispatched.
  const anchorParagraphId = (block.attrs as { anchorParagraphId?: unknown } | undefined)?.anchorParagraphId;
  const currentAnchorId =
    typeof anchorParagraphId === 'string' ? (rewrites?.get(anchorParagraphId) ?? anchorParagraphId) : anchorParagraphId;
  const attrs =
    currentAnchorId === anchorParagraphId
      ? block.attrs
      : Object.freeze({ ...block.attrs, anchorParagraphId: currentAnchorId });
  return Object.freeze({
    kind: 'table',
    id,
    rows: Object.freeze(new Array(block.rows.length)),
    ...(attrs ? { attrs } : {}),
    ...(block.anchor ? { anchor: block.anchor } : {}),
    ...(block.wrap ? { wrap: block.wrap } : {}),
    ...(block.columnWidths ? { columnWidths: block.columnWidths } : {}),
  }) as unknown as TableBlock;
}
function sourceCurrentness(
  owner: { owns: (source: readonly FlowBlock[]) => boolean },
  source: FlowBlock[],
): () => boolean {
  return () => owner.owns(source);
}

/**
 * Trusted internal dependency injection for the canonical host source issuer.
 * This constructor is intentionally absent from the engine's main exports;
 * opaque tokens offered by generic bridge callers have no authority here.
 */
export function createCanonicalPaginationSourceReader(
  read: (previous: readonly FlowBlock[], current: readonly FlowBlock[]) => CanonicalPaginationSourceSplice | null,
  owns: (source: readonly FlowBlock[]) => boolean,
): object {
  const token = Object.freeze({});
  readers.set(token, { read, owns });
  return token;
}

export function isPaginationPreparationCandidate(block: FlowBlock): boolean {
  return (
    block.kind !== 'paragraph' ||
    block.attrs?.keepNext === true ||
    block.attrs?.frame != null ||
    block.runs?.some((run) => run.kind === 'lineBreak') === true
  );
}

/** Only the engine's completed input validation issues a scan plan. */
export function retainPaginationSourceScan(
  blocks: FlowBlock[],
  measures: Measure[],
  indexById: ReadonlyMap<string, number>,
  candidateIds: readonly string[],
): void {
  scans.set(blocks, { blocks, measures, indexById, candidateIds: Object.freeze([...candidateIds]), offset: 0 });
}

export function readPaginationSourceScan(
  blocks: FlowBlock[],
  measures: Measure[],
  requirePrepared = true,
): PaginationSourceScan | null {
  const scan = scans.get(blocks);
  return scan?.measures === measures && (!requirePrepared || scan.isCurrent?.() === true) ? scan : null;
}

/**
 * The canonical owner certifies the exact immutable source recipe. The bridge
 * separately proves its current dirty measures and index rewrites before calling.
 * Foreign/copy tokens and mismatched source or measure vectors lose the shortcut.
 */
export function prepareCanonicalPaginationSource(input: {
  reader: object;
  previousBlocks: FlowBlock[];
  blocks: FlowBlock[];
  previousMeasures: Measure[];
  measures: Measure[];
  dirtyBlockIds: readonly string[];
  currentIndexById: ReadonlyMap<string, number>;
  previousToCurrentBlockId?: ReadonlyMap<string, string> | null;
  onReject?: (reason: string) => void;
}): boolean {
  const reject = (reason: string) => {
    input.onReject?.(reason);
    return false;
  };
  const owner = readers.get(input.reader);
  const previous = scans.get(input.previousBlocks);
  if (!owner) return reject('unknown-owner');
  if (!previous) return reject('previous-engine-scan-missing');
  if (previous.offset !== 0 || previous.measures !== input.previousMeasures)
    return reject('previous-engine-plane-mismatch');
  if (previous.isCurrent && !previous.isCurrent()) return reject('previous-source-revoked');
  const source = owner.read(input.previousBlocks, input.blocks);
  if (
    !source ||
    source.previous !== input.previousBlocks ||
    source.current !== input.blocks ||
    input.blocks.length !== input.measures.length ||
    input.currentIndexById.size !== input.blocks.length
  )
    return reject('source-recipe-mismatch');
  const dirty = new Set(input.dirtyBlockIds);
  if (source.authoredChangedBlockIds.some((id) => !dirty.has(id)))
    return reject(
      `authored-change-not-dirty:${source.authoredChangedBlockIds.filter((id) => !dirty.has(id)).join(',')}`,
    );
  let length = input.previousBlocks.length;
  for (const replacement of source.replacements) {
    if (
      !Number.isSafeInteger(replacement.start) ||
      !Number.isSafeInteger(replacement.deleteCount) ||
      !Number.isSafeInteger(replacement.insertCount) ||
      replacement.start < 0 ||
      replacement.deleteCount < 0 ||
      replacement.insertCount < 0 ||
      replacement.start + replacement.deleteCount > length
    )
      return false;
    length += replacement.insertCount - replacement.deleteCount;
  }
  if (length !== input.blocks.length) return false;
  const candidateIds = new Set<string>();
  for (const oldId of previous.dependencyIds ?? previous.candidateIds) {
    const id = input.previousToCurrentBlockId?.get(oldId) ?? oldId;
    if (input.currentIndexById.has(id)) candidateIds.add(id);
  }
  for (const id of dirty) {
    const index = input.currentIndexById.get(id);
    const block = index == null ? null : input.blocks[index];
    if (!block || block.id !== id) return false;
    if (isPaginationPreparationCandidate(block)) candidateIds.add(id);
  }
  const ordered = [...candidateIds].sort(
    (left, right) => input.currentIndexById.get(left)! - input.currentIndexById.get(right)!,
  );
  const validation = [...new Set([...ordered, ...dirty])].sort(
    (left, right) => input.currentIndexById.get(left)! - input.currentIndexById.get(right)!,
  );
  const currentSource = input.blocks;
  const previousTables = new Map(tablePreparationBySource.get(input.previousBlocks));
  for (const id of previous.dependencyIds ?? previous.candidateIds) {
    const oldIndex = previous.indexById.get(id);
    if (oldIndex == null || previousTables.has(oldIndex)) continue;
    const block = input.previousBlocks[oldIndex];
    if (block?.kind === 'table')
      previousTables.set(oldIndex, {
        table: tablePreparationSnapshot(block),
        reusable: true,
      });
  }
  const tablePreparation = new Map<number, { readonly table: TableBlock; readonly reusable: boolean }>();
  for (const [, { table }] of previousTables) {
    const id = input.previousToCurrentBlockId?.get(table.id) ?? table.id;
    const index = input.currentIndexById.get(id);
    if (index != null && !dirty.has(id))
      tablePreparation.set(index, {
        table: tablePreparationSnapshot(table, id, input.previousToCurrentBlockId),
        reusable: true,
      });
  }
  for (const id of dirty) {
    const index = input.currentIndexById.get(id);
    const block = index == null ? null : input.blocks[index];
    if (index != null && block?.kind === 'table')
      tablePreparation.set(index, {
        table: tablePreparationSnapshot(block),
        reusable: false,
      });
  }
  scans.set(input.blocks, {
    blocks: input.blocks,
    measures: input.measures,
    indexById: input.currentIndexById,
    candidateIds: Object.freeze(validation),
    dependencyIds: Object.freeze(ordered),
    offset: 0,
    isCurrent: sourceCurrentness(owner, currentSource),
  });
  tablePreparationBySource.set(input.blocks, tablePreparation);
  return true;
}

/** Only an owned prepared scan may substitute metadata for a clean table preflight read. */
export function createPreparedPaginationMetadataView(blocks: FlowBlock[], measures: Measure[]): FlowBlock[] {
  const scan = readPaginationSourceScan(blocks, measures);
  const tables = tablePreparationBySource.get(blocks);
  if (!scan || !tables?.size) return blocks;
  const target = new Array<FlowBlock>(blocks.length);
  const indexOf = (key: PropertyKey): number | null => {
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) return null;
    const index = Number(key);
    return index < target.length ? index : null;
  };
  const read = (index: number): FlowBlock =>
    (scan.isCurrent?.() === true && tables.get(index + scan.offset)?.reusable
      ? tables.get(index + scan.offset)!.table
      : null) ?? blocks[index]!;
  return new Proxy(target, {
    get(array, key, receiver) {
      const index = indexOf(key);
      return index == null ? Reflect.get(array, key, receiver) : read(index);
    },
    has(array, key) {
      return indexOf(key) != null || Reflect.has(array, key);
    },
    getOwnPropertyDescriptor(array, key) {
      const index = indexOf(key);
      return index == null
        ? Reflect.getOwnPropertyDescriptor(array, key)
        : { configurable: true, enumerable: true, writable: false, value: read(index) };
    },
    set() {
      throw new Error('Canonical pagination preparation is immutable');
    },
    defineProperty() {
      throw new Error('Canonical pagination preparation is immutable');
    },
    deleteProperty() {
      throw new Error('Canonical pagination preparation is immutable');
    },
    setPrototypeOf() {
      throw new Error('Canonical pagination preparation is immutable');
    },
    preventExtensions() {
      throw new Error('Canonical pagination preparation is immutable');
    },
  });
}

function immutableSlice<T>(source: T[], start: number, end: number): T[] {
  const target = new Array<T>(end - start);
  const indexOf = (key: PropertyKey): number | null => {
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) return null;
    const index = Number(key);
    return index < target.length ? index : null;
  };
  return new Proxy(target, {
    get(array, key, receiver) {
      const index = indexOf(key);
      return index == null ? Reflect.get(array, key, receiver) : source[start + index];
    },
    has(array, key) {
      return indexOf(key) != null || Reflect.has(array, key);
    },
    getOwnPropertyDescriptor(array, key) {
      const index = indexOf(key);
      return index == null
        ? Reflect.getOwnPropertyDescriptor(array, key)
        : { configurable: true, enumerable: true, writable: false, value: source[start + index] };
    },
    set() {
      throw new Error('Canonical pagination suffix is immutable');
    },
    defineProperty() {
      throw new Error('Canonical pagination suffix is immutable');
    },
    deleteProperty() {
      throw new Error('Canonical pagination suffix is immutable');
    },
    setPrototypeOf() {
      throw new Error('Canonical pagination suffix is immutable');
    },
    preventExtensions() {
      throw new Error('Canonical pagination suffix is immutable');
    },
  });
}

export function createPreparedPaginationSuffix(
  blocks: FlowBlock[],
  measures: Measure[],
  start: number,
  end: number,
): { blocks: FlowBlock[]; measures: Measure[] } | null {
  const scan = readPaginationSourceScan(blocks, measures);
  if (!scan || scan.offset !== 0 || start < 0 || end > blocks.length || end < start) return null;
  const suffixBlocks = immutableSlice(blocks, start, end);
  const suffixMeasures = immutableSlice(measures, start, end);
  scans.set(suffixBlocks, { ...scan, measures: suffixMeasures, offset: start });
  const tables = tablePreparationBySource.get(blocks);
  if (tables) tablePreparationBySource.set(suffixBlocks, tables);
  return { blocks: suffixBlocks, measures: suffixMeasures };
}
