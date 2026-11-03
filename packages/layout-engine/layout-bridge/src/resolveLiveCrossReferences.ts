import type {
  CrossReferenceMetadata,
  DrawingBlock,
  FlowBlock,
  Layout,
  ListBlock,
  ParagraphBlock,
  Run,
  TableBlock,
  TextRun,
} from '@superdoc/contracts';

const BROKEN_REFERENCE_RESULT = 'Error! Reference source not found.';
const MISSING_STYLE_RESULT = 'Error! No text of specified style in document.';
const liveCrossReferenceSourceBlocks = new WeakMap<FlowBlock, FlowBlock>();

export function isLiveCrossReferenceFieldCloneOf(block: unknown, source: FlowBlock): block is FlowBlock {
  return (
    typeof block === 'object' && block !== null && liveCrossReferenceSourceBlocks.get(block as FlowBlock) === source
  );
}

export interface PageStyleReferenceRequest {
  pageNumber: number;
  styleName: string;
  preferFollowing: boolean;
  instruction?: string;
}

export type PageStyleReferenceResolver = (request: PageStyleReferenceRequest) => string | null;

export function flowBlocksContainCrossReferenceMetadata(
  blocks: readonly FlowBlock[],
  kind?: CrossReferenceMetadata['kind'],
): boolean {
  const contains = (block: FlowBlock): boolean => {
    if (block.kind === 'paragraph')
      return (block as ParagraphBlock).runs.some((run) => {
        const metadata = asTextRun(run)?.crossReferenceMetadata;
        return metadata != null && (kind == null || metadata.kind === kind);
      });
    if (block.kind === 'list') return ((block as ListBlock).items ?? []).some((item) => contains(item.paragraph));
    if (block.kind === 'table')
      return ((block as TableBlock).rows ?? []).some((row) =>
        (row.cells ?? []).some((cell) =>
          cell.blocks ? cell.blocks.some(contains) : !!cell.paragraph && contains(cell.paragraph),
        ),
      );
    if (block.kind === 'drawing') {
      const drawing = block as DrawingBlock;
      return (
        drawing.drawingKind === 'textboxShape' &&
        Array.isArray(drawing.contentBlocks) &&
        drawing.contentBlocks.some(contains)
      );
    }
    return false;
  };
  return blocks.some(contains);
}

type ParagraphEntry = {
  paragraph: ParagraphBlock;
  order: number;
};

type BookmarkValue = {
  text: string;
  paragraphOrder: number;
  paragraph: ParagraphBlock;
};

type StyleCandidate = {
  paragraph: ParagraphBlock;
  order: number;
  text: string;
};

type FieldRunGroup = {
  metadata: CrossReferenceMetadata;
  runs: TextRun[];
  host: ParagraphEntry;
  paragraphOrders: Set<number>;
};

/**
 * Copy only block paths that contain live cross-reference result runs. Stable
 * source blocks may be shared with the previous render plane; resolving into a
 * shared run would mutate the diff baseline and incorrectly retain its measure.
 */
export function cloneLiveCrossReferenceFieldBlocks<T extends FlowBlock>(blocks: readonly T[]): T[] {
  // The clone preserves every block's discriminant; keep the caller's
  // narrower table-cell/textbox content union instead of widening it to the
  // top-level FlowBlock union.
  return blocks.map((block) => cloneLiveCrossReferenceFieldBlock(block) as T);
}

function cloneLiveCrossReferenceFieldBlock(block: FlowBlock): FlowBlock {
  const clone = cloneLiveCrossReferenceFieldBlockContents(block);
  if (clone !== block) liveCrossReferenceSourceBlocks.set(clone, block);
  return clone;
}

function cloneLiveCrossReferenceFieldBlockContents(block: FlowBlock): FlowBlock {
  if (block.kind === 'paragraph') {
    const paragraph = block as ParagraphBlock;
    if (!paragraph.runs.some((run) => asTextRun(run)?.crossReferenceMetadata != null)) return block;
    return { ...paragraph, runs: paragraph.runs.map((run) => ({ ...run })) };
  }
  if (block.kind === 'list') {
    const list = block as ListBlock;
    let changed = false;
    const items = (list.items ?? []).map((item) => {
      const paragraph = cloneLiveCrossReferenceFieldBlock(item.paragraph) as ParagraphBlock;
      if (paragraph === item.paragraph) return item;
      changed = true;
      return { ...item, paragraph };
    });
    return changed ? { ...list, items } : block;
  }
  if (block.kind === 'table') {
    const table = block as TableBlock;
    let changed = false;
    const rows = (table.rows ?? []).map((row) => {
      let rowChanged = false;
      const cells = (row.cells ?? []).map((cell) => {
        const priorBlocks = cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []);
        const blocks = cloneLiveCrossReferenceFieldBlocks(priorBlocks);
        const cellChanged = blocks.some((candidate, index) => candidate !== priorBlocks[index]);
        if (!cellChanged) return cell;
        rowChanged = true;
        return {
          ...cell,
          ...(cell.blocks ? { blocks } : { paragraph: blocks[0] as ParagraphBlock }),
        };
      });
      if (!rowChanged) return row;
      changed = true;
      return { ...row, cells };
    });
    return changed ? { ...table, rows } : block;
  }
  if (block.kind === 'drawing') {
    const drawing = block as DrawingBlock;
    if (drawing.drawingKind !== 'textboxShape' || !Array.isArray(drawing.contentBlocks)) return block;
    const contentBlocks = cloneLiveCrossReferenceFieldBlocks(drawing.contentBlocks);
    const changed = contentBlocks.some((candidate, index) => candidate !== drawing.contentBlocks?.[index]);
    return changed ? { ...drawing, contentBlocks } : block;
  }
  return block;
}

/**
 * Resolve live cross-reference results from the current editor-neutral flow
 * graph. This happens before measurement, so changed result text participates
 * in line wrapping and pagination without creating a second document mutation.
 */
export function resolveLiveCrossReferences(bodyBlocks: FlowBlock[]): boolean {
  const paragraphs = collectParagraphs(bodyBlocks);
  const groups = collectFieldRunGroups(paragraphs).filter((group) => group.paragraphOrders.size === 1);
  if (!groups.length) return false;
  const bookmarks = groups.some(({ metadata }) => metadata.kind === 'ref')
    ? collectBookmarks(paragraphs)
    : new Map<string, BookmarkValue>();
  const numberTargets = new Set(
    groups.flatMap(({ metadata }) => {
      const target =
        metadata.kind === 'ref' && /\\w\b/i.test(metadata.instruction)
          ? bookmarks.get(metadata.target)?.paragraph
          : null;
      return target ? [target] : [];
    }),
  );
  const paragraphNumbers = numberTargets.size
    ? collectFullContextParagraphNumbers(paragraphs, numberTargets)
    : new Map<ParagraphBlock, string>();
  const styleCandidates = groups.some(({ metadata }) => metadata.kind !== 'ref' && metadata.kind !== 'noteRef')
    ? collectStyleCandidates(paragraphs)
    : [];
  const noteReferences = groups.some(({ metadata }) => metadata.kind === 'noteRef')
    ? collectBookmarkedNoteReferenceMarkers(paragraphs)
    : new Map<string, { text: string; paragraphOrder: number }>();
  let changed = false;

  for (const group of groups) {
    // text-run substitution cannot reproduce. Preserve its imported cache
    // until a structure-aware field-result projector owns that case.
    if (group.paragraphOrders.size > 1) continue;
    const result = resolveFieldGroup({
      group,
      host: group.host,
      bookmarks,
      paragraphNumbers,
      styleCandidates,
      noteReferences,
    });
    changed = writeFieldResult(group.runs, result) || changed;
  }
  return changed;
}

/** Build the page-aware STYLEREF resolver used by repeated headers/footers. */
export function buildPageStyleReferenceResolver(
  bodyBlocks: readonly FlowBlock[],
  layout: Layout,
): PageStyleReferenceResolver {
  const paragraphs = collectParagraphs(bodyBlocks);
  const paragraphById = new Map(paragraphs.map((entry) => [entry.paragraph.id, entry] as const));
  const pageByBlockId = new Map<string, number>();
  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
    for (const fragment of layout.pages[pageIndex]?.fragments ?? []) {
      const blockId = (fragment as { blockId?: string }).blockId;
      if (blockId && !pageByBlockId.has(blockId)) pageByBlockId.set(blockId, pageIndex + 1);
    }
  }

  const candidates = [...paragraphById.values()]
    .map((entry) => {
      const pageNumber = pageByBlockId.get(entry.paragraph.id);
      const styleId = entry.paragraph.attrs?.styleId;
      if (pageNumber == null || !styleId) return null;
      return {
        ...entry,
        pageNumber,
        normalizedStyle: normalizeStyleName(styleId),
        text: paragraphText(entry.paragraph),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);

  return ({ pageNumber, styleName, preferFollowing, instruction }) => {
    const normalizedStyle = normalizeStyleName(styleName);
    const matching = candidates.filter((candidate) => candidate.normalizedStyle === normalizedStyle);
    if (matching.length === 0) return null;
    const onPage = matching.filter((candidate) => candidate.pageNumber === pageNumber);
    const selected = preferFollowing
      ? (onPage.at(-1) ?? matching.find((candidate) => candidate.pageNumber > pageNumber) ?? matching.at(-1))
      : (onPage[0] ?? [...matching].reverse().find((candidate) => candidate.pageNumber < pageNumber) ?? matching[0]);
    if (!selected) return null;
    return projectParagraphResult(selected.paragraph, selected.text, instruction ?? '');
  };
}

function resolveFieldGroup(input: {
  group: FieldRunGroup;
  host: ParagraphEntry;
  bookmarks: ReadonlyMap<string, BookmarkValue>;
  paragraphNumbers: ReadonlyMap<ParagraphBlock, string>;
  styleCandidates: readonly StyleCandidate[];
  noteReferences: ReadonlyMap<string, { text: string; paragraphOrder: number }>;
}): string {
  const { metadata } = input.group;
  if (metadata.kind === 'ref') {
    const target = input.bookmarks.get(metadata.target);
    if (!target) return BROKEN_REFERENCE_RESULT;
    if (/\\p\b/i.test(metadata.instruction) && target.paragraphOrder !== input.host.order) {
      return target.paragraphOrder < input.host.order ? 'above' : 'below';
    }
    if (/\\w\b/i.test(metadata.instruction)) {
      const fullContextNumber = input.paragraphNumbers.get(target.paragraph);
      if (fullContextNumber) {
        return /\\t\b/i.test(metadata.instruction) ? trimNumberingDelimiters(fullContextNumber) : fullContextNumber;
      }
    }
    return projectParagraphResult(target.paragraph, target.text, metadata.instruction);
  }

  if (metadata.kind === 'noteRef') {
    const reference = input.noteReferences.get(metadata.target);
    if (!reference) return BROKEN_REFERENCE_RESULT;
    if (/\\p\b/i.test(metadata.instruction) && reference.paragraphOrder !== input.host.order) {
      return reference.paragraphOrder < input.host.order ? 'above' : 'below';
    }
    return reference.text;
  }

  const normalizedStyle = normalizeStyleName(metadata.target);
  const matches = input.styleCandidates.filter(
    (candidate) =>
      normalizeStyleName(candidate.paragraph.attrs?.styleId ?? '') === normalizedStyle &&
      candidate.paragraph !== input.host.paragraph,
  );
  const candidate = metadata.preferFollowing
    ? (matches.find((entry) => entry.order > input.host.order) ??
      [...matches].reverse().find((entry) => entry.order < input.host.order))
    : ([...matches].reverse().find((entry) => entry.order < input.host.order) ??
      matches.find((entry) => entry.order > input.host.order));
  if (!candidate) return MISSING_STYLE_RESULT;
  if (/\\p\b/i.test(metadata.instruction) && candidate.order !== input.host.order) {
    return candidate.order < input.host.order ? 'above' : 'below';
  }
  return projectParagraphResult(candidate.paragraph, candidate.text, metadata.instruction);
}

function projectParagraphResult(paragraph: ParagraphBlock, content: string, instruction: string): string {
  if (/\\(?:n|r|w)\b/i.test(instruction)) {
    const marker = paragraph.attrs?.wordLayout?.marker;
    const markerText = marker?.markerText ?? '';
    if (markerText) return /\\t\b/i.test(instruction) ? trimNumberingDelimiters(markerText) : markerText;
  }
  return content;
}

function collectFullContextParagraphNumbers(
  paragraphs: readonly ParagraphEntry[],
  targets: ReadonlySet<ParagraphBlock>,
): Map<ParagraphBlock, string> {
  const result = new Map<ParagraphBlock, string>();
  const levelsByNumberingId = new Map<number, string[]>();

  let lastTarget = paragraphs.length - 1;
  while (lastTarget >= 0 && !targets.has(paragraphs[lastTarget]!.paragraph)) lastTarget--;
  for (let index = 0; index <= lastTarget; index++) {
    const { paragraph } = paragraphs[index]!;
    const numbering = paragraph.attrs?.numberingProperties;
    const markerText = paragraph.attrs?.wordLayout?.marker?.markerText ?? '';
    const numId = numbering?.numId;
    const level = numbering?.ilvl;
    if (!markerText || numId == null || level == null || !Number.isInteger(level) || level < 0) continue;

    const levels = levelsByNumberingId.get(numId) ?? [];
    levels.length = level + 1;
    let parentNumber = '';
    for (let parent = level - 1; parent >= 0; parent--) {
      if (levels[parent]) {
        parentNumber = levels[parent]!;
        break;
      }
    }
    const fullContextNumber =
      parentNumber && !markerText.startsWith(parentNumber) ? `${parentNumber}${markerText}` : markerText;
    levels[level] = fullContextNumber;
    levelsByNumberingId.set(numId, levels);
    if (targets.has(paragraph)) result.set(paragraph, fullContextNumber);
  }
  return result;
}

function trimNumberingDelimiters(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function collectParagraphs(blocks: readonly FlowBlock[]): ParagraphEntry[] {
  const result: ParagraphEntry[] = [];
  const visit = (items: readonly FlowBlock[]): void => {
    for (const block of items) {
      if (block.kind === 'paragraph') {
        result.push({ paragraph: block as ParagraphBlock, order: result.length });
      } else if (block.kind === 'list') {
        for (const item of (block as ListBlock).items ?? []) visit([item.paragraph]);
      } else if (block.kind === 'table') {
        for (const row of (block as TableBlock).rows ?? []) {
          for (const cell of row.cells ?? []) {
            visit(cell.blocks ?? (cell.paragraph ? [cell.paragraph] : []));
          }
        }
      } else if (block.kind === 'drawing') {
        const drawing = block as DrawingBlock;
        if (drawing.drawingKind === 'textboxShape' && Array.isArray(drawing.contentBlocks)) {
          visit(drawing.contentBlocks);
        }
      }
    }
  };
  visit(blocks);
  return result;
}

function collectBookmarks(paragraphs: readonly ParagraphEntry[]): Map<string, BookmarkValue> {
  const result = new Map<string, BookmarkValue>();
  const active = new Map<
    string,
    {
      name: string;
      text: string[];
      paragraph: ParagraphBlock;
      paragraphOrder: number;
    }
  >();
  for (const entry of paragraphs) {
    for (const run of entry.paragraph.runs) {
      const text = asTextRun(run);
      if (!text) continue;
      const marker = text.dataAttrs?.['data-bookmark-marker'];
      const bookmarkId = text.dataAttrs?.['data-bookmark-id'];
      if (marker === 'start' && bookmarkId) {
        active.set(bookmarkId, {
          name: text.dataAttrs?.['data-bookmark-name'] ?? '',
          text: [],
          paragraph: entry.paragraph,
          paragraphOrder: entry.order,
        });
        continue;
      }
      if (marker === 'end' && bookmarkId) {
        const pending = active.get(bookmarkId);
        active.delete(bookmarkId);
        if (pending?.name && !result.has(pending.name)) {
          const selectedText = pending.text.join('').trim() || paragraphText(pending.paragraph);
          result.set(pending.name, {
            text: selectedText,
            paragraphOrder: pending.paragraphOrder,
            paragraph: pending.paragraph,
          });
        }
        continue;
      }
      if (text.text) {
        for (const pending of active.values()) pending.text.push(text.text);
      }
    }
  }
  return result;
}

function collectStyleCandidates(paragraphs: readonly ParagraphEntry[]): StyleCandidate[] {
  return paragraphs
    .filter((entry) => Boolean(entry.paragraph.attrs?.styleId))
    .map((entry) => ({ ...entry, text: paragraphText(entry.paragraph) }));
}

function collectBookmarkedNoteReferenceMarkers(
  paragraphs: readonly ParagraphEntry[],
): Map<string, { text: string; paragraphOrder: number }> {
  const result = new Map<string, { text: string; paragraphOrder: number }>();
  const active = new Map<string, string>();
  for (const entry of paragraphs) {
    for (const run of entry.paragraph.runs) {
      const text = asTextRun(run);
      const bookmarkMarker = text?.dataAttrs?.['data-bookmark-marker'];
      const bookmarkId = text?.dataAttrs?.['data-bookmark-id'];
      if (bookmarkMarker === 'start' && bookmarkId) {
        active.set(bookmarkId, text?.dataAttrs?.['data-bookmark-name'] ?? '');
        continue;
      }
      if (bookmarkMarker === 'end' && bookmarkId) {
        active.delete(bookmarkId);
        continue;
      }
      const marker = text?.dataAttrs?.['data-v2-note-ref'];
      if (!text || !marker) continue;
      for (const name of active.values()) {
        if (name && !result.has(name)) result.set(name, { text: text.text, paragraphOrder: entry.order });
      }
    }
  }
  return result;
}

function collectFieldRunGroups(paragraphs: readonly ParagraphEntry[]): FieldRunGroup[] {
  const groups = new Map<CrossReferenceMetadata, FieldRunGroup>();
  for (const entry of paragraphs) {
    for (const run of entry.paragraph.runs) {
      const text = asTextRun(run);
      const metadata = text?.crossReferenceMetadata;
      if (!text || !metadata) continue;
      const existing = groups.get(metadata);
      if (existing) {
        existing.runs.push(text);
        existing.paragraphOrders.add(entry.order);
      } else {
        groups.set(metadata, {
          metadata,
          runs: [text],
          host: entry,
          paragraphOrders: new Set([entry.order]),
        });
      }
    }
  }
  return [...groups.values()];
}

function writeFieldResult(runs: readonly TextRun[], result: string): boolean {
  let changed = false;
  for (let index = 0; index < runs.length; index += 1) {
    const text = index === 0 ? result : '';
    if (runs[index]!.text !== text) changed = true;
    runs[index]!.text = text;
  }
  return changed;
}

function paragraphText(paragraph: ParagraphBlock): string {
  return paragraph.runs
    .map(asTextRun)
    .filter((run): run is TextRun => Boolean(run))
    .filter((run) => run.dataAttrs?.['data-bookmark-marker'] == null)
    .filter((run) => run.crossReferenceMetadata == null)
    .map((run) => run.text)
    .join('')
    .trim();
}

function normalizeStyleName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLocaleLowerCase();
}

function asTextRun(run: Run): TextRun | null {
  return run.kind == null || run.kind === 'text' ? run : null;
}
