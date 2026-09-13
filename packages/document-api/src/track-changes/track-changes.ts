import type { Receipt, TrackChangeInfo, TrackChangesListQuery, TrackChangesListResult } from '../types/index.js';
import type { StoryLocator } from '../types/story.types.js';
import type { TextCoordinateSpace, TextTarget } from '../types/address.js';
import type { RevisionGuardOptions } from '../write/write.js';
import { DocumentApiValidationError } from '../errors.js';
import { validateStoryLocator } from '../validation/story-validator.js';
export type TrackChangesListInput = TrackChangesListQuery;
export interface TrackChangesGetInput {
  id: string;
  /** Story containing the tracked change. Omit for body (backward compatible). */
  story?: StoryLocator;
}
export interface TrackChangesAcceptInput {
  id: string;
  /** Story containing the tracked change. Omit for body (backward compatible). */
  story?: StoryLocator;
}
export interface TrackChangesRejectInput {
  id: string;
  /** Story containing the tracked change. Omit for body (backward compatible). */
  story?: StoryLocator;
}
export interface TrackChangesAcceptAllInput {
  story?: StoryLocator | 'all';
}
export interface TrackChangesRejectAllInput {
  story?: StoryLocator | 'all';
}
export interface TrackChangesRangeInput {
  range: TextTarget;
  story?: StoryLocator;
  /** Coordinate space of the TextTarget offsets. Omitted preserves legacy tracked-space behavior. */
  coordinateSpace?: TextCoordinateSpace;
}
// ---------------------------------------------------------------------------
// trackChanges.decide: consolidated accept/reject operation
//
// The semantic target shape is the canonical discriminated union
// per `tracked-changes-spec.md` §20. Revision guards stay in
// {@link RevisionGuardOptions} (the second mutation argument), not on the
// input object. For backward compatibility, callers may pass
// `input.expectedRevision` as an alias for `options.expectedRevision`.
// Callers may still pass the legacy `{ id, story? }` /
// `{ scope: 'all' }` shapes; the validator transparently promotes them to
// `{ kind: 'id' }` / `{ kind: 'all' }`.
// ---------------------------------------------------------------------------
export type ReviewDecideTargetSide = 'insert' | 'inserted' | 'delete' | 'deleted' | 'source' | 'destination';
export type ReviewDecideIdTargetSide = 'insert' | 'inserted' | 'delete' | 'deleted';
/**
 * Tracked-move pairing assertion for a decide target. Callers that resolved an
 * ambiguous shape (e.g. surface guesses a paragraph delete+insert might be a
 * move) can ask the decide adapter to verify the projection before applying
 * the decision. `'pair'` asserts the resolved entry must be a paired move;
 * `'source'` / `'destination'` further narrow to a specific half. When the
 * assertion does not hold the adapter fails closed with an explicit failure
 * code instead of silently treating the target as a non-move decision.
 */
export type ReviewDecideTargetMoveRole = 'pair' | 'source' | 'destination';
export interface ReviewDecideRangeTargetOptions {
  /**
   * Optional logical overlap selector for callers that already resolved an
   * ambiguous overlap surface. The adapter owns interpretation.
   */
  overlap?: string;
  /** Optional revision side for grouped replacement or move targets. */
  side?: ReviewDecideTargetSide;
  /** Optional story containing the range. */
  story?: StoryLocator;
  /** Compatibility alias used by older range callers; interpretation is adapter-owned. */
  part?: string;
}
export type ReviewDecideTextRangeTarget = ReviewDecideRangeTargetOptions & {
  kind: 'range';
  range: TextTarget;
  /** Coordinate space of `range`. Omitted preserves legacy tracked-space behavior. */
  coordinateSpace?: TextCoordinateSpace;
};
export type ReviewDecideLogicalRangeTarget = ReviewDecideRangeTargetOptions & {
  kind: 'range';
  range: {
    anchor: string;
    relativeStart: number;
    relativeEnd: number;
  };
};
/** Semantic target for {@link ReviewDecideInput}. */
export type ReviewDecideTarget =
  | {
      kind: 'id';
      id: string;
      story?: StoryLocator;
      side?: ReviewDecideIdTargetSide;
      moveRole?: ReviewDecideTargetMoveRole;
    }
  | {
      /** Resolve several whole logical changes in one atomic history unit. */
      kind: 'ids';
      ids: string[];
    }
  | ReviewDecideTextRangeTarget
  | ReviewDecideLogicalRangeTarget
  | { kind: 'all'; story?: StoryLocator | 'all' };
/** Legacy compatibility shapes accepted by the validator. */
export type LegacyReviewDecideTarget =
  | { id: string; story?: StoryLocator; moveRole?: ReviewDecideTargetMoveRole }
  | { scope: 'all'; story?: StoryLocator | 'all' };
export type ReviewDecisionTarget = ReviewDecideTarget | LegacyReviewDecideTarget;
export interface ReviewDecideInput {
  decision: 'accept' | 'reject';
  target: ReviewDecideTarget | LegacyReviewDecideTarget;
  /**
   * Backward-compatible alias for `options.expectedRevision`. Explicit options
   * take precedence when both are supplied.
   */
  expectedRevision?: string;
}
/**
 * Internal canonical decide target — the legacy shapes have been promoted to
 * `{ kind: 'id' }` / `{ kind: 'all' }`. Adapters consume this normalized
 * form so the kernel side does not need to re-handle legacy aliases.
 */
export interface ReviewDecideRangeInput {
  decision: 'accept' | 'reject';
  target: ReviewDecideTarget;
}
export interface TrackChangesAdapter {
  /** List tracked changes matching the given query. */
  list(input?: TrackChangesListInput): TrackChangesListResult;
  /** Retrieve full information for a single tracked change. */
  get(input: TrackChangesGetInput): TrackChangeInfo;
  /**
   * Apply an accept / reject decision against the document. By-id, range,
   * routes by-id, range, and bulk targets through this single entrypoint;
   * legacy `accept` / `reject` / `acceptAll` / `rejectAll` adapter methods
   * remain as compatibility shims until callers migrate.
   */
  decide?(input: ReviewDecideRangeInput, options?: RevisionGuardOptions): Receipt;
  /** Accept a tracked change, applying it to the document. */
  accept(input: TrackChangesAcceptInput, options?: RevisionGuardOptions): Receipt;
  /** Reject a tracked change, reverting it from the document. */
  reject(input: TrackChangesRejectInput, options?: RevisionGuardOptions): Receipt;
  /** Accept all tracked changes matching the requested bulk filter. */
  acceptAll(input: TrackChangesAcceptAllInput, options?: RevisionGuardOptions): Receipt;
  /** Reject all tracked changes matching the requested bulk filter. */
  rejectAll(input: TrackChangesRejectAllInput, options?: RevisionGuardOptions): Receipt;
  /**
   * Compatibility range entrypoint for adapters that predate the canonical
   * `decide` method but can still resolve TextTarget range decisions.
   */
  decideRange?(
    input: { decision: 'accept' | 'reject' } & TrackChangesRangeInput,
    options?: RevisionGuardOptions,
  ): Receipt;
}
/** Public surface for trackChanges on DocumentApi. */
export interface TrackChangesApi {
  list(input?: TrackChangesListInput): TrackChangesListResult;
  get(input: TrackChangesGetInput): TrackChangeInfo;
  decide(input: ReviewDecideInput, options?: RevisionGuardOptions): Receipt;
}
/**
 * Execute wrappers below are the canonical interception point for input
 * normalization and validation before delegating to the adapter.
 */
export function executeTrackChangesList(
  adapter: TrackChangesAdapter,
  input?: TrackChangesListInput,
): TrackChangesListResult {
  return adapter.list(input);
}
export function executeTrackChangesGet(adapter: TrackChangesAdapter, input: TrackChangesGetInput): TrackChangeInfo {
  const raw = input as unknown;
  if (typeof raw !== 'object' || raw == null) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'trackChanges.get input must be a non-null object.', {
      value: raw,
    });
  }
  const { id } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'trackChanges.get id must be a non-empty string.', {
      field: 'id',
      value: id,
    });
  }
  return adapter.get(input);
}
/**
 * Executes the consolidated `trackChanges.decide` operation by routing to the
 * appropriate adapter method based on the discriminated input.
 *
 * Accepting/rejecting changes is a resolution action, not a content mutation -
 * changeMode and dryRun are not applicable, so this accepts
 * {@link RevisionGuardOptions} rather than `MutationOptions`.
 *
 * Validates the canonical discriminated target shape
 * (`{ kind: 'id' | 'ids' | 'range' | 'all' }`) and transparently promotes the
 * legacy `{ id, story? }` / `{ scope: 'all' }` shapes. Adapters that
 * implement the new {@link TrackChangesAdapter.decide} entrypoint receive
 * the normalized canonical input; older adapters that only expose
 * accept/reject/acceptAll/rejectAll still work for id targets without a side
 * selector and all targets.
 */
export function executeTrackChangesDecide(
  adapter: TrackChangesAdapter,
  rawInput: ReviewDecideInput,
  options?: RevisionGuardOptions,
): Receipt {
  if (typeof adapter.decide !== 'function' && isValidLegacyPartialIdRangeTarget(rawInput)) {
    return {
      success: false,
      failure: {
        code: 'INVALID_INPUT',
        message:
          'trackChanges.decide does not support a partial range on an id target without decide() support; the change is not safely divisible.',
        details: { target: rawInput.target },
      },
    };
  }
  const canonical = validateReviewDecideInput(rawInput);
  const revisionOptions = normalizeReviewDecideOptions(rawInput, options);
  if (typeof adapter.decide === 'function') {
    return adapter.decide(canonical, revisionOptions);
  }
  // Legacy adapter fallback: range and multi-id targets are not representable through
  // accept/reject/acceptAll/rejectAll. Use the older decideRange hook for
  // TextTarget ranges when available; logical ranges still require decide().
  if (canonical.target.kind === 'range') {
    if (isReviewDecideTextRangeTarget(canonical.target) && typeof adapter.decideRange === 'function') {
      const { range, story, coordinateSpace } = canonical.target;
      return adapter.decideRange(
        {
          decision: canonical.decision,
          range,
          ...(story ? { story } : {}),
          ...(coordinateSpace ? { coordinateSpace } : {}),
        },
        revisionOptions,
      );
    }
    return {
      success: false,
      failure: {
        code: 'CAPABILITY_UNAVAILABLE',
        message:
          'trackChanges.decide range targets require the v2 adapter or a compatible decideRange() adapter method.',
      },
    };
  }
  if (canonical.target.kind === 'ids') {
    return {
      success: false,
      failure: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'trackChanges.decide multi-id targets require an adapter that implements decide().',
      },
    };
  }
  if (canonical.target.kind === 'all') {
    const { story } = canonical.target;
    const input = story ? { story } : {};
    if (canonical.decision === 'accept') return adapter.acceptAll(input, revisionOptions);
    return adapter.rejectAll(input, revisionOptions);
  }
  if (canonical.target.side !== undefined) {
    return {
      success: false,
      failure: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'trackChanges.decide id target.side requires an adapter that implements decide().',
      },
    };
  }
  const { id, story } = canonical.target;
  if (canonical.decision === 'accept') {
    return adapter.accept({ id, ...(story ? { story } : {}) }, revisionOptions);
  }
  return adapter.reject({ id, ...(story ? { story } : {}) }, revisionOptions);
}
function isValidLegacyPartialIdRangeTarget(input: ReviewDecideInput): boolean {
  if (typeof input !== 'object' || input == null) return false;
  const target = (input as { target?: unknown }).target;
  if (typeof target !== 'object' || target == null) return false;
  const record = target as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) return false;
  const range = record.range;
  if (typeof range !== 'object' || range == null) return false;
  const partial = range as Record<string, unknown>;
  return (
    partial.kind === 'partial' &&
    Number.isInteger(partial.start) &&
    Number.isInteger(partial.end) &&
    (partial.start as number) >= 0 &&
    (partial.end as number) >= (partial.start as number)
  );
}
/**
 * Validate and normalize a `trackChanges.decide` input into the canonical
 * `{ kind: 'id' | 'ids' | 'range' | 'all' }` target shape. Exposed for adapters /
 * tests that need to share the same validation surface.
 */
export function validateReviewDecideInput(rawInput: ReviewDecideInput): ReviewDecideRangeInput {
  const raw = rawInput as unknown;
  if (typeof raw !== 'object' || raw == null) {
    throw new DocumentApiValidationError('INVALID_INPUT', 'trackChanges.decide input must be a non-null object.', {
      value: raw,
    });
  }
  const input = raw as Record<string, unknown>;
  validateInputExpectedRevision(input);
  if (input.decision !== 'accept' && input.decision !== 'reject') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      `track-changes decide:decision must be one of: accept, reject. Got "${String(input.decision)}".`,
      { field: 'decision', value: input.decision },
    );
  }
  if (typeof input.target !== 'object' || input.target == null) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      "trackChanges.decide target must be { kind: 'id', id } / { kind: 'ids', ids } / { kind: 'range', range } / { kind: 'all' }.",
      { field: 'target', value: input.target },
    );
  }
  const target = input.target as Record<string, unknown>;
  const decision = input.decision;
  const normalized = normalizeReviewDecideTarget(target);
  return { decision, target: normalized };
}
function normalizeReviewDecideTarget(target: Record<string, unknown>): ReviewDecideTarget {
  const kind = target.kind;
  // Canonical discriminated shape.
  if (kind === 'id') {
    const id = target.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        "trackChanges.decide target.kind 'id' must include a non-empty `id` string.",
        { field: 'target.id', value: id },
      );
    }
    const story = readOptionalStory(target, 'target.story', false);
    const side = readOptionalReplacementReviewDecideTargetSide(target, 'target.side');
    const moveRole = readOptionalMoveRole(target);
    return {
      kind: 'id',
      id,
      ...(story ? { story } : {}),
      ...(side ? { side } : {}),
      ...(moveRole ? { moveRole } : {}),
    };
  }
  if (kind === 'ids') {
    const ids = target.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string' || id.length === 0)) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        "trackChanges.decide target.kind 'ids' must include a non-empty `ids` array of non-empty strings.",
        { field: 'target.ids', value: ids },
      );
    }
    return { kind: 'ids', ids: [...new Set(ids)] };
  }
  if (kind === 'range') {
    const options = normalizeRangeTargetOptions(target);
    if ('range' in target) {
      const range = target.range as unknown;
      if (isLogicalRangeDescriptor(range)) {
        validateLogicalRangeTarget(range, 'target.range');
        return {
          kind: 'range',
          range: {
            anchor: range.anchor,
            relativeStart: range.relativeStart,
            relativeEnd: range.relativeEnd,
          },
          ...options,
        };
      }
      validateTextTarget(range, 'target.range');
      const outerCoordinateSpace = readOptionalTextCoordinateSpace(target);
      const innerCoordinateSpace = readOptionalTextCoordinateSpace(range as Record<string, unknown>);
      if (outerCoordinateSpace && innerCoordinateSpace && outerCoordinateSpace !== innerCoordinateSpace) {
        throw new DocumentApiValidationError(
          'INVALID_INPUT',
          'trackChanges.decide range coordinateSpace aliases must agree.',
          { outerCoordinateSpace, innerCoordinateSpace },
        );
      }
      const coordinateSpace = outerCoordinateSpace ?? innerCoordinateSpace;
      return {
        kind: 'range',
        range: range as TextTarget,
        ...options,
        ...(coordinateSpace ? { coordinateSpace } : {}),
      };
    }
    validateLogicalRangeTarget(target, 'target');
    return {
      kind: 'range',
      range: {
        anchor: target.anchor as string,
        relativeStart: target.relativeStart as number,
        relativeEnd: target.relativeEnd as number,
      },
      ...options,
    };
  }
  if (kind === 'all') {
    const story = readOptionalStory(target, 'target.story', true);
    return { kind: 'all', ...(story ? { story } : {}) };
  }
  // Legacy compatibility shapes.
  if (kind === undefined) {
    if (target.scope === 'all') {
      if (typeof target.id === 'string' || 'range' in target || 'moveRole' in target) {
        throw new DocumentApiValidationError(
          'INVALID_TARGET',
          'trackChanges.decide target must choose exactly one selector: { id }, { range }, or { scope: "all" }.',
          { field: 'target', value: target },
        );
      }
      const story = readOptionalStory(target, 'target.story', true);
      return { kind: 'all', ...(story ? { story } : {}) };
    }
    if ('id' in target && (typeof target.id !== 'string' || target.id.length === 0)) {
      throw new DocumentApiValidationError('INVALID_TARGET', 'trackChanges.decide id targets require a non-empty id.', {
        field: 'target.id',
        value: target.id,
      });
    }
    if (typeof target.id === 'string' && target.id.length > 0 && target.range !== undefined) {
      const range = target.range as Record<string, unknown>;
      const story = readOptionalStory(target, 'target.story', false);
      if (
        typeof range === 'object' &&
        range != null &&
        range.kind === 'partial' &&
        Number.isInteger(range.start) &&
        Number.isInteger(range.end)
      ) {
        const relativeStart = range.start as number;
        const relativeEnd = range.end as number;
        if (relativeStart < 0 || relativeEnd < relativeStart) {
          throw new DocumentApiValidationError(
            'INVALID_INPUT',
            'trackChanges.decide legacy partial range targets must satisfy 0 <= start <= end.',
            { field: 'target.range', value: target.range },
          );
        }
        return {
          kind: 'range',
          range: {
            anchor: target.id,
            relativeStart,
            relativeEnd,
          },
          ...(story ? { story } : {}),
        };
      }
      throw new DocumentApiValidationError(
        'INVALID_INPUT',
        'trackChanges.decide legacy id range targets must use { kind: "partial", start, end }.',
        { field: 'target.range', value: target.range },
      );
    }
    if (typeof target.id === 'string' && target.id.length > 0) {
      const story = readOptionalStory(target, 'target.story', false);
      const side = readOptionalReplacementReviewDecideTargetSide(target, 'target.side');
      const moveRole = readOptionalMoveRole(target);
      return {
        kind: 'id',
        id: target.id,
        ...(story ? { story } : {}),
        ...(side ? { side } : {}),
        ...(moveRole ? { moveRole } : {}),
      };
    }
  }
  // Reject raw OOXML / XPath / package-part / rsid-style targets explicitly.
  const REJECTED_KEYS = ['xml', 'xpath', 'rsid', 'wId', 'wordId', 'wordRevisionId', 'byteRange'];
  for (const key of REJECTED_KEYS) {
    if (key in target) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `trackChanges.decide target field "${key}" is not a supported public target. Use logical ids, a range, or 'all'.`,
        { field: `target.${key}`, value: (target as Record<string, unknown>)[key] },
      );
    }
  }
  if (kind === undefined) {
    throw new DocumentApiValidationError('INVALID_TARGET', 'track-changes decide:target.kind is required.', {
      field: 'target.kind',
      value: kind,
    });
  }
  throw new DocumentApiValidationError(
    'INVALID_TARGET',
    "trackChanges.decide target must be { kind: 'id', id } / { kind: 'ids', ids } / { kind: 'range', range } / { kind: 'all' }.",
    { field: 'target', value: target },
  );
}
function isReviewDecideTextRangeTarget(target: ReviewDecideTarget): target is ReviewDecideTextRangeTarget {
  return target.kind === 'range' && 'segments' in target.range;
}
function validateTextTarget(value: unknown, field: string): void {
  if (typeof value !== 'object' || value == null) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `trackChanges.decide ${field} must be a TextTarget object.`,
      { field, value },
    );
  }
  const v = value as Record<string, unknown>;
  if (v.kind !== 'text') {
    throw new DocumentApiValidationError('INVALID_TARGET', `trackChanges.decide ${field}.kind must be "text".`, {
      field: `${field}.kind`,
      value: v.kind,
    });
  }
  if (!Array.isArray(v.segments) || v.segments.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `trackChanges.decide ${field}.segments must be a non-empty array.`,
      { field: `${field}.segments`, value: v.segments },
    );
  }
  for (let i = 0; i < v.segments.length; i += 1) {
    const seg = v.segments[i] as Record<string, unknown> | null;
    if (typeof seg !== 'object' || seg == null) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `trackChanges.decide ${field}.segments[${i}] must be a non-null object.`,
        { field: `${field}.segments[${i}]`, value: seg },
      );
    }
    if (typeof seg.blockId !== 'string' || seg.blockId.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `trackChanges.decide ${field}.segments[${i}].blockId must be a non-empty string.`,
        { field: `${field}.segments[${i}].blockId`, value: seg.blockId },
      );
    }
    const range = seg.range as Record<string, unknown> | null;
    if (typeof range !== 'object' || range == null) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `trackChanges.decide ${field}.segments[${i}].range must be a Range object.`,
        { field: `${field}.segments[${i}].range`, value: range },
      );
    }
    if (
      typeof range.start !== 'number' ||
      typeof range.end !== 'number' ||
      range.start < 0 ||
      range.end < range.start
    ) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        `trackChanges.decide ${field}.segments[${i}].range must have integer 0 <= start <= end.`,
        { field: `${field}.segments[${i}].range`, value: range },
      );
    }
  }
}
function isLogicalRangeDescriptor(value: unknown): value is {
  anchor: string;
  relativeStart: number;
  relativeEnd: number;
} {
  return (
    typeof value === 'object' &&
    value != null &&
    'anchor' in value &&
    'relativeStart' in value &&
    'relativeEnd' in value
  );
}
function validateLogicalRangeTarget(target: Record<string, unknown>, field: string): void {
  if (typeof target.anchor !== 'string' || target.anchor.length === 0) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      `trackChanges.decide ${field} must include a non-empty \`anchor\` string.`,
      { field: `${field}.anchor`, value: target.anchor },
    );
  }
  if (!Number.isInteger(target.relativeStart) || !Number.isInteger(target.relativeEnd)) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'trackChanges.decide logical range targets require integer relativeStart and relativeEnd.',
      {
        field,
        value: { relativeStart: target.relativeStart, relativeEnd: target.relativeEnd },
      },
    );
  }
  const relativeStart = target.relativeStart as number;
  const relativeEnd = target.relativeEnd as number;
  if (relativeStart < 0 || relativeEnd < relativeStart) {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'trackChanges.decide logical range targets must have 0 <= relativeStart <= relativeEnd.',
      { field, value: { relativeStart, relativeEnd } },
    );
  }
}
function normalizeRangeTargetOptions(target: Record<string, unknown>): ReviewDecideRangeTargetOptions {
  const options: ReviewDecideRangeTargetOptions = {};
  if (target.overlap !== undefined) {
    if (typeof target.overlap !== 'string' || target.overlap.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'trackChanges.decide target.overlap must be a non-empty string when provided.',
        { field: 'target.overlap', value: target.overlap },
      );
    }
    options.overlap = target.overlap;
  }
  if (target.side !== undefined) {
    validateRangeTargetSide(target.side);
    options.side = target.side;
  }
  const story = readOptionalStory(target, 'target.story', false);
  if (story) options.story = story;
  if (target.part !== undefined) {
    if (typeof target.part !== 'string' || target.part.length === 0) {
      throw new DocumentApiValidationError(
        'INVALID_TARGET',
        'trackChanges.decide target.part must be a non-empty string when provided.',
        { field: 'target.part', value: target.part },
      );
    }
    options.part = target.part;
  }
  return options;
}

function readOptionalTextCoordinateSpace(target: Record<string, unknown>): TextCoordinateSpace | undefined {
  const coordinateSpace = target.coordinateSpace;
  if (coordinateSpace === undefined) return undefined;
  if (coordinateSpace !== 'visible' && coordinateSpace !== 'tracked') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'trackChanges.decide target.coordinateSpace must be "visible" or "tracked" when provided.',
      { field: 'target.coordinateSpace', value: coordinateSpace },
    );
  }
  return coordinateSpace;
}

function readOptionalStory(
  target: Record<string, unknown>,
  field: string,
  allowAll: true,
): StoryLocator | 'all' | undefined;
function readOptionalStory(target: Record<string, unknown>, field: string, allowAll: false): StoryLocator | undefined;
function readOptionalStory(
  target: Record<string, unknown>,
  field: string,
  allowAll: boolean,
): StoryLocator | 'all' | undefined {
  const story = target.story;
  if (story === undefined || story === null) return undefined;
  if (story === 'all') {
    if (allowAll) return story;
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'trackChanges.decide target.story must not be "all" for this target kind.',
      { field, value: story },
    );
  }
  validateStoryLocator(story, field);
  return story as StoryLocator;
}
function readOptionalMoveRole(target: Record<string, unknown>): ReviewDecideTargetMoveRole | undefined {
  if (!('moveRole' in target)) return undefined;
  const moveRole = target.moveRole;
  if (moveRole === undefined || moveRole === null) return undefined;
  if (moveRole !== 'pair' && moveRole !== 'source' && moveRole !== 'destination') {
    throw new DocumentApiValidationError(
      'INVALID_TARGET',
      'trackChanges.decide target.moveRole must be "pair", "source", or "destination" when provided.',
      { field: 'target.moveRole', value: moveRole },
    );
  }
  return moveRole;
}
function readOptionalReplacementReviewDecideTargetSide(
  target: Record<string, unknown>,
  field: string,
): 'insert' | 'inserted' | 'delete' | 'deleted' | undefined {
  if (!('side' in target) || target.side === undefined || target.side === null) return undefined;
  validateReplacementTargetSide(target.side);
  return target.side;
}
function validateReplacementTargetSide(side: unknown): asserts side is 'insert' | 'inserted' | 'delete' | 'deleted' {
  if (side === 'insert' || side === 'inserted' || side === 'delete' || side === 'deleted') return;
  throw new DocumentApiValidationError(
    'INVALID_TARGET',
    'trackChanges.decide id target.side must be "insert", "inserted", "delete", or "deleted" when provided.',
    { field: 'target.side', value: side },
  );
}
function validateRangeTargetSide(side: unknown): asserts side is ReviewDecideTargetSide {
  if (
    side === 'insert' ||
    side === 'inserted' ||
    side === 'delete' ||
    side === 'deleted' ||
    side === 'source' ||
    side === 'destination'
  ) {
    return;
  }
  throw new DocumentApiValidationError(
    'INVALID_TARGET',
    'trackChanges.decide target.side must be "insert", "inserted", "delete", "deleted", "source", or "destination" when provided.',
    { field: 'target.side', value: side },
  );
}
function validateInputExpectedRevision(input: Record<string, unknown>): void {
  if (input.expectedRevision !== undefined && typeof input.expectedRevision !== 'string') {
    throw new DocumentApiValidationError(
      'INVALID_INPUT',
      'trackChanges.decide expectedRevision must be a string when provided.',
      { field: 'expectedRevision', value: input.expectedRevision },
    );
  }
}
function normalizeReviewDecideOptions(
  rawInput: ReviewDecideInput,
  options?: RevisionGuardOptions,
): RevisionGuardOptions | undefined {
  const inputExpectedRevision = (rawInput as { expectedRevision?: unknown }).expectedRevision;
  if (options?.expectedRevision !== undefined) return options;
  if (inputExpectedRevision === undefined) return options;
  return { ...options, expectedRevision: inputExpectedRevision as string };
}
