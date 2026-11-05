import { isObjectRecord, isPlainObject } from '../../helpers/object-guards.js';
import type { SelectionSlice, SelectionTarget, SuperDocUIState } from './types.js';
import { readRecord, readRecordList, type LooseRecord } from './loose-record.js';
import { selectionKey } from './format-painter-helpers.js';
import { isFiniteNumber } from '../../helpers/is-finite-number.js';
import type { CommandDescriptor } from './commands.js';
import { CLEAR_INLINE_FORMATTING_KEYS, INLINE_PROPERTY_BY_KEY } from '@superdoc/document-api';

export type EffectiveInlineUniformityState =
  | { state: 'uniform'; value: string }
  | { state: 'mixed' | 'unresolvable' | 'absent' };

export function readEffectiveInlineUniformityStates(
  raw: unknown,
): Record<string, EffectiveInlineUniformityState> | null {
  if (!isPlainObject(raw) || raw.success !== true) return null;
  const states: Record<string, EffectiveInlineUniformityState> = {};
  if (!isPlainObject(raw.values)) return states;
  for (const [key, entry] of Object.entries(raw.values)) {
    if (!entry) continue;
    states[key] =
      isPlainObject(entry) && entry.state === 'uniform' && typeof entry.value === 'string'
        ? { state: 'uniform', value: entry.value }
        : {
            state:
              isPlainObject(entry) && (entry.state === 'mixed' || entry.state === 'absent')
                ? entry.state
                : 'unresolvable',
          };
  }
  return states;
}

export type SelectionTextSegment = {
  blockId: string;
  start: number;
  end: number;
};

export const PROJECTED_INLINE_SELECTION_VALUE_KEYS = ['fontFamily', 'fontSize', 'color', 'highlight'] as const;

export type ProjectedInlineSelectionValueKey = (typeof PROJECTED_INLINE_SELECTION_VALUE_KEYS)[number];

export type ProjectedInlineSelectionValues = Partial<Record<ProjectedInlineSelectionValueKey, string>>;

export const EFFECTIVE_MARK_KEYS = ['bold', 'italic', 'underline', 'strikethrough'] as const;

export type EffectiveMarkKey = (typeof EFFECTIVE_MARK_KEYS)[number];

export type EffectiveMarkValues = Partial<Record<EffectiveMarkKey, boolean>>;

export type OptimisticInlineSelectionValue = {
  selectionSignature: string;
  value: string;
};

export type OptimisticInlineToggle = {
  selectionSignature: string;
  active: boolean;
  generation: number;
  settled: boolean;
  editorSource: unknown;
  documentSource: unknown;
  documentMode: SuperDocUIState['documentMode'];
};

export type OptimisticParagraphAlignment = {
  selectionSignature: string;
  value: 'left' | 'center' | 'right' | 'justify';
  generation: number;
  settled: boolean;
  canReconcile: boolean;
};

export type PendingInlineToggleMutation = {
  key: string;
  mutate: () => unknown;
  result: Promise<unknown>;
  resolve: (value: unknown | PromiseLike<unknown>) => void;
};

export function isProjectedInlineSelectionValueKey(value: string): value is ProjectedInlineSelectionValueKey {
  return PROJECTED_INLINE_SELECTION_VALUE_KEYS.some((key) => key === value);
}

export function selectionTextSegments(selection: SelectionSlice): SelectionTextSegment[] {
  const target = readRecord(selection.target) ?? null;
  const segments = readRecordList(target?.segments);
  const out: SelectionTextSegment[] = [];

  const push = (blockId: unknown, start: unknown, end: unknown): void => {
    if (typeof blockId !== 'string' || typeof start !== 'number' || typeof end !== 'number') return;
    out.push({
      blockId,
      start: Math.min(start, end),
      end: Math.max(start, end),
    });
  };

  for (const segment of segments) {
    const range = readRecord(segment?.range);
    push(segment?.blockId, range?.start, range?.end);
  }
  if (out.length > 0) return out;

  const explicit = readRecord(selection.selectionTarget) ?? null;
  const start = readRecord(explicit?.start);
  const end = readRecord(explicit?.end);
  if (!start || !end) return out;
  if (start.blockId !== end.blockId) return out;
  push(start.blockId, start.offset, end.offset);
  return out;
}

export function selectionStoryLocator(selection: SelectionSlice): unknown | undefined {
  const target = readRecord(selection.target) ?? null;
  const explicit = readRecord(selection.selectionTarget) ?? null;
  const start = readRecord(explicit?.start);
  const end = readRecord(explicit?.end);
  const story = target?.story ?? explicit?.story ?? start?.story ?? end?.story;
  return story && typeof story === 'object' ? story : undefined;
}

export function selectionInlineValueStorySignature(selection: SelectionSlice): string {
  const story = selectionStoryLocator(selection);
  const record = readRecord(story);
  if (!record) return 'body';
  return JSON.stringify({
    storyType: typeof record.storyType === 'string' ? record.storyType : 'body',
    refId: typeof record.refId === 'string' ? record.refId : null,
    noteId: typeof record.noteId === 'string' ? record.noteId : null,
    textboxId: typeof record.textboxId === 'string' ? record.textboxId : null,
  });
}

export function selectionInlineValueSignature(selection: SelectionSlice): string | null {
  const segments = selectionTextSegments(selection);
  if (segments.length === 0) return null;
  return [
    selectionInlineValueStorySignature(selection),
    ...segments.map((segment) => `${segment.blockId}:${segment.start}-${segment.end}`),
  ].join('|');
}

export function selectionEffectiveUniformitySignature(selection: SelectionSlice): string | null {
  const target = selection.selectionTarget;
  if (!target || typeof target !== 'object') return null;
  return selectionKey({ selectionTarget: target });
}

export function normalizeOptimisticInlineSelectionValue(
  key: ProjectedInlineSelectionValueKey,
  value: unknown,
): string | null {
  if (key === 'fontSize') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (key === 'color' || key === 'highlight') return trimmed.toUpperCase();
  return trimmed;
}

export function rangesOverlap(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

export function queryMatchItemSegments(item: LooseRecord | null | undefined): SelectionTextSegment[] {
  if (!item) return [];
  const blocks = readRecordList(item?.blocks);
  const out: SelectionTextSegment[] = [];
  for (const block of blocks) {
    const range = readRecord(block?.range);
    const blockId = block?.blockId;
    if (typeof blockId !== 'string' || typeof range?.start !== 'number' || typeof range?.end !== 'number') continue;
    out.push({
      blockId,
      start: Math.min(range.start, range.end),
      end: Math.max(range.start, range.end),
    });
  }
  return out;
}

export function sameSelectionTextSegments(
  left: readonly SelectionTextSegment[],
  right: readonly SelectionTextSegment[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const candidate = right[index];
    return (
      candidate?.blockId === segment.blockId && candidate?.start === segment.start && candidate?.end === segment.end
    );
  });
}

export function pickSelectionTextQueryItem(result: LooseRecord | null, selection: SelectionSlice): LooseRecord | null {
  const segments = selectionTextSegments(selection);
  if (segments.length === 0) return null;
  const items = readRecordList(result?.items);
  if (items.length === 0) return null;

  const exact = items.find((item) => sameSelectionTextSegments(segments, queryMatchItemSegments(item)));
  if (exact) return exact;

  if (segments.length === 1) {
    const singleBlock = items.find((item) => {
      const address = readRecord(item?.address);
      return address?.kind === 'block' && address.nodeId === segments[0].blockId;
    });
    if (singleBlock) return singleBlock;
  }

  return items[0] ?? null;
}

export function readProjectedInlineStyleValue(
  styles: LooseRecord | null | undefined,
  key: ProjectedInlineSelectionValueKey,
): string | undefined {
  const raw =
    key === 'fontSize'
      ? (styles?.fontSizePt ?? styles?.fontSize)
      : key === 'highlight'
        ? (styles?.highlight ?? styles?.backgroundColor)
        : styles?.[key];
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (key === 'color' || key === 'highlight') return trimmed.toUpperCase();
  return trimmed;
}

export function normalizeLayoutFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const first = value
    .split(',')[0]
    ?.trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (!first) return undefined;
  const lower = first.toLowerCase();
  if (
    lower === 'serif' ||
    lower === 'sans-serif' ||
    lower === 'monospace' ||
    lower === 'cursive' ||
    lower === 'fantasy'
  ) {
    return undefined;
  }
  return first;
}

export function normalizeLayoutFontSizePt(value: unknown): string | undefined {
  if (!isFiniteNumber(value) || value <= 0) return undefined;
  const pt = Math.round(value * 0.75 * 2) / 2;
  if (pt <= 0) return undefined;
  return String(pt);
}

export function normalizeProjectedInlineStyleValueKey(key: ProjectedInlineSelectionValueKey, value: string): string {
  if (key === 'fontFamily') return value.toLowerCase();
  if (key === 'color' || key === 'highlight') return value.toUpperCase();
  return value;
}

export function projectInlineValuesFromQueryItem(
  item: LooseRecord | null,
  selection: SelectionSlice,
): ProjectedInlineSelectionValues {
  if (!item) return {};

  const selectionSegmentsByBlock = new Map<string, Array<{ start: number; end: number }>>();
  for (const segment of selectionTextSegments(selection)) {
    const ranges = selectionSegmentsByBlock.get(segment.blockId) ?? [];
    ranges.push({ start: segment.start, end: segment.end });
    selectionSegmentsByBlock.set(segment.blockId, ranges);
  }
  if (selectionSegmentsByBlock.size === 0) return {};

  const blocks = readRecordList(item?.blocks);
  const projection: ProjectedInlineSelectionValues = {};

  for (const key of PROJECTED_INLINE_SELECTION_VALUE_KEYS) {
    const seenValues = new Map<string, string>();
    let sawOverlap = false;
    let sawMissingValue = false;

    for (const block of blocks) {
      const blockId = typeof block?.blockId === 'string' ? block.blockId : null;
      if (!blockId) continue;

      const selectionRanges = selectionSegmentsByBlock.get(blockId);
      if (!selectionRanges?.length) continue;

      const runs = readRecordList(block?.runs);
      for (const run of runs) {
        const range = readRecord(run?.range);
        const start = typeof range?.start === 'number' ? range.start : null;
        const end = typeof range?.end === 'number' ? range.end : null;
        if (start == null || end == null) continue;
        if (!selectionRanges.some((selectionRange) => rangesOverlap(selectionRange, { start, end }))) continue;

        sawOverlap = true;
        const value = readProjectedInlineStyleValue(readRecord(run?.styles), key);
        if (value === undefined) {
          sawMissingValue = true;
          continue;
        }

        const normalized = normalizeProjectedInlineStyleValueKey(key, value);
        if (!seenValues.has(normalized)) seenValues.set(normalized, value);
        if (seenValues.size > 1) break;
      }

      if (seenValues.size > 1) break;
    }

    if (sawOverlap && !sawMissingValue && seenValues.size === 1) {
      projection[key] = [...seenValues.values()][0];
    }
  }

  return projection;
}

export function collectProjectionTextBlocks(blocks: unknown): LooseRecord[] {
  const out: LooseRecord[] = [];
  const visit = (node: unknown): void => {
    const record = readRecord(node);
    if (!record) return;
    if (Array.isArray(record.runs)) out.push(record);
    if (Array.isArray(record.rows)) {
      for (const row of record.rows) {
        const cells = readRecord(row)?.cells;
        if (!Array.isArray(cells)) continue;
        for (const cell of cells) {
          const cellRecord = readRecord(cell);
          if (Array.isArray(cellRecord?.blocks)) {
            for (const nested of cellRecord.blocks) visit(nested);
          }
          if (cellRecord?.paragraph) visit(cellRecord.paragraph);
        }
      }
    }
  };
  if (Array.isArray(blocks)) {
    for (const block of blocks) visit(block);
  }
  return out;
}

export function projectionBlockMatchesId(block: LooseRecord, id: string): boolean {
  if (readRecord(block.sourceAnchor)?.sourceNodeId === id) return true;
  return block.id === id;
}

export function projectionRunSelectionLength(run: LooseRecord): number {
  const trackedChange = readRecord(run.trackedChange);
  if (trackedChange?.kind === 'delete') return 0;
  return typeof run.text === 'string' ? run.text.length : 0;
}

export function inlineFormatMethod(descriptor: CommandDescriptor): string | null {
  if (!descriptor.inline || typeof descriptor.docRoute !== 'string') return null;
  return descriptor.docRoute.startsWith('format.') ? descriptor.docRoute.slice('format.'.length) : null;
}

export const CLEAR_INLINE_PATCH: Readonly<Record<string, null>> = Object.fromEntries(
  CLEAR_INLINE_FORMATTING_KEYS.map((key) => [key, null]),
);

export const TRACKED_CLEAR_INLINE_PATCH: Readonly<Record<string, null>> = Object.fromEntries(
  CLEAR_INLINE_FORMATTING_KEYS.filter((key) => INLINE_PROPERTY_BY_KEY[key]?.tracked === true).map((key) => [key, null]),
);

export function buildInlineFormatInput(
  spec: { key: string; kind: 'toggle' | 'value-string' | 'value-number' | 'clear' },
  target: SelectionTarget,
  payload: unknown,
  active: boolean,
): LooseRecord | null {
  switch (spec.kind) {
    case 'toggle': {
      const value = isObjectRecord(payload) && 'value' in payload ? payload.value : payload;
      if (typeof value === 'boolean' || value === null) return { target, value };
      return { target, value: !active };
    }
    case 'value-string': {
      const value = isObjectRecord(payload) && 'value' in payload ? payload.value : payload;
      if (value === null) return { target, value: null };
      if (typeof value !== 'string' || value.trim() === '') return null;
      return { target, value };
    }
    case 'value-number': {
      const raw = isObjectRecord(payload) && 'value' in payload ? payload.value : payload;
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value) || value <= 0) return null;
      return { target, value };
    }
    case 'clear':
      return { target, inline: { ...CLEAR_INLINE_PATCH } };
    default: {
      const exhaustive: never = spec.kind;
      void exhaustive;
      return null;
    }
  }
}
