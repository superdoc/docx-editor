import {
  doesFlowBlockProduceLayoutFragment,
  resolveColumnCount,
  type ColumnLayout,
  type FlowBlock,
  type Measure,
  type ParagraphBlock,
  type ParagraphMeasure,
} from '@superdoc/contracts';
import { findLineIndexForRunOrdinal, type LayoutOptions } from '@superdoc/layout-engine';

export type CoupledFootnoteReference = {
  id: string;
  pos: number;
  blockId?: string;
  runOrdinal?: number | null;
};

export type CoupledFootnoteProfileRejection =
  | 'no-footnote-references'
  | 'partial-or-semantic-flow'
  | 'multiple-sections'
  | 'invalid-page-geometry'
  | 'unsupported-columns'
  | 'unsupported-vertical-alignment'
  | 'unsupported-section-boundary'
  | 'unsupported-body-block'
  | 'unsupported-paragraph-geometry'
  | 'body-page-token'
  | 'measure-mismatch'
  | 'duplicate-block-id'
  | 'duplicate-reference-id'
  | 'missing-native-owner'
  | 'unresolved-reference-line'
  | 'unordered-native-references'
  | 'retained-profile-unproved'
  | 'reference-topology-changed';

export type CoupledFootnoteParagraphUpdate = {
  block: FlowBlock;
  measure: Measure;
  refs: readonly CoupledFootnoteReference[];
  previousRefs: readonly CoupledFootnoteReference[];
  /** Immediate CURRENT neighbors; null only at a true story boundary. */
  predecessor: FlowBlock | null;
  successor: FlowBlock | null;
};

export type CoupledFootnoteLocalProfileProof = {
  baselineProfileExact: true;
  referenceTopologyExact: true;
};

/**
 * Revalidates only changed paragraphs beneath a bridge-owned retained global
 * profile and exact current note topology. The bridge must prove those owners
 * and supply all affected paragraphs, including referenced neighbors whose
 * skip context changed. These flags do not mint a global/profile certificate.
 */
export const getCoupledFootnoteParagraphUpdatesUnsupportedReason = (
  updates: readonly CoupledFootnoteParagraphUpdate[],
  proof: CoupledFootnoteLocalProfileProof | null | undefined,
): CoupledFootnoteProfileRejection | null => {
  if (proof?.baselineProfileExact !== true || proof.referenceTopologyExact !== true) return 'retained-profile-unproved';
  const blockIds = new Set<string>();
  const referenceIds = new Set<string>();
  for (const update of updates) {
    const { block, measure } = update;
    if (!block.id || blockIds.has(block.id)) return 'duplicate-block-id';
    blockIds.add(block.id);
    if (block.kind !== 'paragraph') return 'unsupported-body-block';
    if (measure.kind !== 'paragraph') return 'measure-mismatch';
    const paragraphReason = getParagraphUnsupportedReason(block, measure);
    if (paragraphReason) return paragraphReason;
    if (update.refs.length !== update.previousRefs.length) return 'reference-topology-changed';

    // The canonical omission predicate reads only this paragraph and its
    // immediate neighbors. No section seed or document-wide scan is required.
    const context: FlowBlock[] = update.predecessor === null ? [block] : [update.predecessor, block];
    const owner: ParagraphReferenceOwner = { block, measure, index: context.length - 1 };
    if (update.successor !== null) context.push(update.successor);
    for (let index = 0; index < update.refs.length; index += 1) {
      const ref = update.refs[index];
      const previous = update.previousRefs[index];
      if (ref.id !== previous.id || ref.blockId !== block.id || previous.blockId !== block.id) {
        return 'reference-topology-changed';
      }
      // Native carrier/note order is stable under the caller's topology proof;
      // run ordinals and synthetic PM positions can change after text splitting.
      const referenceReason = getNativeReferenceUnsupportedReason(context, ref, owner, referenceIds);
      if (referenceReason) return referenceReason;
    }
  }
  return null;
};

export const supportsCoupledFootnoteParagraphUpdates = (
  updates: readonly CoupledFootnoteParagraphUpdate[],
  proof: CoupledFootnoteLocalProfileProof | null | undefined,
): boolean => getCoupledFootnoteParagraphUpdatesUnsupportedReason(updates, proof) === null;

const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

const validPageGeometry = (
  size: LayoutOptions['pageSize'] | null | undefined,
  margins: Partial<NonNullable<LayoutOptions['margins']>> | null | undefined,
): boolean =>
  (!size || (Number.isFinite(size.w) && size.w > 0 && Number.isFinite(size.h) && size.h > 0)) &&
  (!margins || Object.values(margins).every((value) => value === undefined || finiteNonNegative(value)));

const isSingleColumn = (columns: ColumnLayout | undefined): boolean =>
  !columns ||
  (Number.isSafeInteger(columns.count) &&
    columns.count > 0 &&
    resolveColumnCount(columns) === 1 &&
    finiteNonNegative(columns.gap) &&
    !columns.withSeparator &&
    (!columns.widths || columns.widths.every((width) => Number.isFinite(width) && width > 0)) &&
    (!columns.gaps || columns.gaps.every(finiteNonNegative)));

const getParagraphUnsupportedReason = (
  block: ParagraphBlock,
  measure: ParagraphMeasure,
): CoupledFootnoteProfileRejection | null => {
  if (!finiteNonNegative(measure.totalHeight) || measure.lines.some((line) => !finiteNonNegative(line.lineHeight))) {
    return 'measure-mismatch';
  }
  const attrs = block.attrs;
  if (
    attrs?.frame ||
    attrs?.floatAlignment ||
    attrs?.borders ||
    attrs?.dropCap ||
    attrs?.dropCapDescriptor ||
    measure.dropCap ||
    attrs?.textboxId ||
    (attrs?.directionContext && attrs.directionContext.writingMode !== 'horizontal-tb')
  )
    return 'unsupported-paragraph-geometry';
  for (const run of block.runs) {
    if (
      (run.kind === undefined || run.kind === 'text') &&
      (run.token === 'pageNumber' ||
        run.token === 'totalPageCount' ||
        run.token === 'pageReference' ||
        run.token === 'sectionPageCount')
    )
      return 'body-page-token';
    if (run.kind === 'break' && run.breakType !== undefined && run.breakType !== 'line' && run.breakType !== 'page') {
      return 'unsupported-paragraph-geometry';
    }
  }
  return null;
};

type ParagraphReferenceOwner = {
  block: ParagraphBlock;
  measure: ParagraphMeasure;
  index: number;
  lastRunOrdinal?: number;
};

const getNativeReferenceUnsupportedReason = (
  blocks: FlowBlock[],
  ref: CoupledFootnoteReference,
  owner: ParagraphReferenceOwner | undefined,
  referenceIds: Set<string>,
): CoupledFootnoteProfileRejection | null => {
  if (!ref.id || referenceIds.has(ref.id)) return 'duplicate-reference-id';
  referenceIds.add(ref.id);
  const runOrdinal = ref.runOrdinal;
  if (
    !owner ||
    !doesFlowBlockProduceLayoutFragment(blocks, owner.index) ||
    typeof runOrdinal !== 'number' ||
    !Number.isSafeInteger(runOrdinal) ||
    runOrdinal < 0 ||
    runOrdinal >= owner.block.runs.length
  )
    return 'missing-native-owner';
  // The native anchor index preserves per-paragraph reference order. Its
  // last-anchor minimum must therefore agree with source run order.
  if (owner.lastRunOrdinal !== undefined && runOrdinal < owner.lastRunOrdinal) return 'unordered-native-references';
  owner.lastRunOrdinal = runOrdinal;
  // Native refs may share synthetic PM positions. Their exact owner is the
  // paragraph/run pair, using the same first-containing-line rule as layout.
  const lineIndex = findLineIndexForRunOrdinal(owner.measure.lines, runOrdinal);
  if (lineIndex === null) return 'unresolved-reference-line';
  const line = owner.measure.lines[lineIndex];
  if (
    !Number.isSafeInteger(line.fromRun) ||
    !Number.isSafeInteger(line.toRun) ||
    line.fromRun < 0 ||
    line.toRun >= owner.block.runs.length ||
    line.fromRun > line.toRun
  )
    return 'unresolved-reference-line';
  return null;
};

/**
 * Admission for fresh, single-section body/note flow. This does not certify
 * note-content inventories or retained pages; their owners validate those.
 * Rejection codes carry no document text and are suitable for diagnostics.
 */
export const getCoupledFootnotePaginationUnsupportedReason = (
  blocks: FlowBlock[],
  measures: readonly Measure[],
  options: LayoutOptions,
  refs: readonly CoupledFootnoteReference[],
): CoupledFootnoteProfileRejection | null => {
  if (refs.length === 0) return 'no-footnote-references';
  if (
    (options.flowMode !== undefined && options.flowMode !== 'paginated') ||
    options.startContext !== undefined ||
    options.pageBoundary?.shouldStopBeforeNewPage !== undefined
  )
    return 'partial-or-semantic-flow';
  if ((options.sectionMetadata?.length ?? 0) > 1) return 'multiple-sections';
  if (!isSingleColumn(options.columns)) return 'unsupported-columns';
  if (!validPageGeometry(options.pageSize, options.margins)) return 'invalid-page-geometry';
  const section = options.sectionMetadata?.[0];
  const sectionIndex = section?.sectionIndex ?? 0;
  if (!Number.isSafeInteger(sectionIndex) || sectionIndex < 0) return 'multiple-sections';
  if (section?.vAlign !== undefined && section.vAlign !== 'top') return 'unsupported-vertical-alignment';
  if (!validPageGeometry(section?.pageSize, section?.margins)) return 'invalid-page-geometry';
  if (options.nonFlowPositionedParagraphFrameIds?.size) return 'unsupported-paragraph-geometry';
  if (blocks.length !== measures.length) return 'measure-mismatch';

  const blockIds = new Set<string>();
  const owners = new Map<string, ParagraphReferenceOwner>();
  let hasSectionBreak = false;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const measure = measures[index];
    if (!block.id || blockIds.has(block.id)) return 'duplicate-block-id';
    blockIds.add(block.id);
    if (block.kind === 'sectionBreak') {
      if (hasSectionBreak) return 'multiple-sections';
      hasSectionBreak = true;
      // The native adapter places its one geometry seed before all body
      // content. This strict first-section flag at index zero implies the
      // engine's isInitialSectionBreak(block, false) predicate.
      const isInitialSeed =
        index === 0 &&
        block.attrs?.isFirstSection === true &&
        block.type === 'continuous' &&
        block.attrs.sectionIndex === sectionIndex;
      const isTerminal = index === blocks.length - 1 && block.attrs?.isFirstSection !== true;
      if (
        (!isInitialSeed && !isTerminal) ||
        (block.attrs?.sectionIndex !== undefined && block.attrs.sectionIndex !== sectionIndex) ||
        (block.type !== undefined && block.type !== 'continuous') ||
        block.requiredPageParity !== undefined ||
        block.attrs?.requirePageBoundary === true
      )
        return 'unsupported-section-boundary';
      if (measure?.kind !== 'sectionBreak') return 'measure-mismatch';
      if (!isSingleColumn(block.columns)) return 'unsupported-columns';
      if (block.vAlign !== undefined && block.vAlign !== 'top') return 'unsupported-vertical-alignment';
      if (!validPageGeometry(block.pageSize, block.margins)) return 'invalid-page-geometry';
      continue;
    }
    if (block.kind !== 'paragraph') return 'unsupported-body-block';
    if (measure?.kind !== 'paragraph') return 'measure-mismatch';
    const paragraphReason = getParagraphUnsupportedReason(block, measure);
    if (paragraphReason) return paragraphReason;
    owners.set(block.id, { block, measure, index });
  }

  const referenceIds = new Set<string>();
  for (const ref of refs) {
    const owner = ref.blockId ? owners.get(ref.blockId) : undefined;
    const referenceReason = getNativeReferenceUnsupportedReason(blocks, ref, owner, referenceIds);
    if (referenceReason) return referenceReason;
  }
  return null;
};

export const supportsCoupledFootnotePagination = (
  blocks: FlowBlock[],
  measures: readonly Measure[],
  options: LayoutOptions,
  refs: readonly CoupledFootnoteReference[],
): boolean => getCoupledFootnotePaginationUnsupportedReason(blocks, measures, options, refs) === null;
