/**
 * Editor-neutral measured segment-geometry substrate (Phase 1 / 001).
 *
 * Promotes the per-line and per-segment geometry that the measure/layout
 * pipeline already computes to a first-class, editor-neutral output. The point
 * of this contract is that a host can answer:
 *
 *   - point -> inline offset (which segment, which run-relative char)
 *   - inline offset -> caret rect (x / baseline / height)
 *   - line-relative selection rect materialization
 *
 * without re-deriving geometry from the painted DOM and without block-level
 * ratio math.
 *
 * Hard rules (mirrors `neutral-hit` / `layout-identity`):
 *
 *  - Geometry is sourced from the measure/layout pipeline, never from
 *    paint-time DOM measurement.
 *  - The surface is editor-neutral and story-aware. `pmStart`/`pmEnd` may
 *    remain as legacy/diagnostic data on the producer types, but nothing here
 *    requires them.
 *  - The contract is explicit about cases it cannot represent yet: a fragment
 *    or line that the substrate cannot resolve fails closed with a stable
 *    {@link NeutralGeometryDiagnostic}, it does not silently emit a wrong
 *    caret/rect.
 *
 * Versioned via {@link LAYOUT_SEGMENT_GEOMETRY_SCHEMA} so DOM datasets,
 * snapshots, and host adapters can negotiate a single shape over time. This is
 * a sibling of `LAYOUT_BOUNDARY_SCHEMA` (identity), kept separate so geometry
 * can evolve without reopening identity.
 */
import type { SourceAnchor } from './index.js';
import type { LayoutBlockRef, LayoutFragmentId, LayoutSourceIdentity, LayoutStoryLocator } from './layout-identity.js';

/**
 * Schema version for the neutral segment-geometry substrate.
 *
 * Bump when a load-bearing field changes semantics. Pure additive growth
 * (new optional fields) does not require a bump.
 */
export const LAYOUT_SEGMENT_GEOMETRY_SCHEMA = 'layout-segment-geometry/1';

/** Resolved inline direction for a measured line. */
export type NeutralTextDirection = 'ltr' | 'rtl';

/**
 * Geometry for a single measured run-segment within a line.
 *
 * `x` is **load-bearing**: it is the resolved container-space left edge of the
 * segment, with paragraph indent, list text-start, alignment offset, and
 * explicit tab positioning already applied. The producer's `LineSegment.x` is
 * intentionally optional (it only carries an explicit override for tab-aligned
 * runs); the readback resolves it to a concrete value here so the host never
 * needs fallback positioning logic.
 *
 * `fromChar` / `toChar` are visible-text offsets **within the segment's run**
 * (`runIndex`), matching the producer's `LineSegment` semantics. Joined with
 * `runIndex` they address the exact visible text the segment paints.
 */
export type NeutralSegmentGeometry = {
  /** Index of this segment within the line's segment list. */
  segmentIndex: number;
  /** Run index (into the source block's runs) this segment belongs to. */
  runIndex: number;
  /** Visible-text start offset within the run (inclusive). */
  fromChar: number;
  /** Visible-text end offset within the run (exclusive). */
  toChar: number;
  /** Resolved container-space x of the segment's start edge (px). Always present. */
  x: number;
  /** Measured width of the segment (px). */
  width: number;
};

/**
 * Per-line advisory flags. Present only when the corresponding condition holds,
 * so consumers can treat an absent flag as "false" without ambiguity.
 */
export type NeutralLineGeometryFlags = {
  /**
   * Line participates in justified alignment. When the line actually stretches
   * (not the true last line of its paragraph, not tab-aligned), segment
   * `x`/`width` already carry the exact painter-consistent slack — the same
   * shared word-spacing / inter-character distribution the painter applies at
   * paint time — so downstream caret math is exact, not approximate.
   */
  justified?: boolean;
  /** Line uses explicit tab/segment positioning (at least one segment has an explicit x). */
  tabAligned?: boolean;
};

/**
 * Geometry for a single measured line within a fragment.
 *
 * Vertical metrics follow the painter's line-box model (see DomPainter
 * `tab-run.ts`): the baseline sits at `top + halfLeading + ascent`, where
 * `halfLeading = max(0, (lineHeight - ascent - descent) / 2)`. `baseline` is
 * precomputed with that formula so the host does not reimplement it.
 */
export type NeutralLineGeometry = {
  /** 0-based line index within the source block's measure. */
  lineIndex: number;
  /** Container-space top edge of the line box (px). */
  top: number;
  /** Container-space baseline y (px) — `top + halfLeading + ascent`. */
  baseline: number;
  /** Ascent above the baseline (px). */
  ascent: number;
  /** Descent below the baseline (px). */
  descent: number;
  /** Total line-box height (px). */
  lineHeight: number;
  /** Container-space x where line content starts after indent + alignment (px). */
  contentLeft: number;
  /**
   * Content width of the line (px), matching what the painter actually
   * renders: the natural measured width for an unstretched line, or the full
   * available (post-slack) width for a justified line that is actually
   * stretched (see {@link NeutralLineGeometryFlags.justified}). Consumers use
   * this both as the coordinate-space bound for a point on the line and as
   * the available width fed back into justify math, so it must track the
   * rendered span, not always the natural one.
   */
  contentWidth: number;
  /** Resolved inline direction for the line. */
  direction: NeutralTextDirection;
  /** Advisory flags; omitted when none apply. */
  flags?: NeutralLineGeometryFlags;
  /** Per-segment geometry in visual (left-to-right paint) order. */
  segments: NeutralSegmentGeometry[];
};

/**
 * Diagnostics describing a case the substrate cannot fully represent.
 *
 * Emitted at the fragment level so a consumer can fail closed (skip caret/rect
 * placement) instead of trusting partial geometry.
 */
export type NeutralGeometryDiagnostic =
  /** Fragment kind has no per-line text geometry in this version (table, image, drawing). */
  | { code: 'unsupported-fragment-kind'; fragmentKind: string }
  /**
   * Inline direction is RTL but the line is not a proven simple-RTL case (e.g.
   * tab-aligned, justified, or a rendered list marker whose RTL geometry is not
   * mirrored yet). Per-segment x is not resolved for this fragment.
   *
   * Simple horizontal RTL paragraph fragments DO resolve and carry no diagnostic
   * (V2 RTL Plan 004). Mixed-script bidi uses {@link 'unsupported-complex-bidi'}
   * and vertical writing modes use {@link 'unsupported-vertical-direction'}.
   */
  | { code: 'unsupported-direction'; direction: NeutralTextDirection }
  /**
   * The paragraph uses a vertical writing mode (`w:textDirection` tbRl/btLr,
   * resolved to a vertical `WritingMode`). Horizontal text geometry cannot place
   * carets here, so the fragment fails closed. (V2 RTL Plan 004 scope boundary.)
   */
  | { code: 'unsupported-vertical-direction'; writingMode: string }
  /**
   * An RTL paragraph line mixes strong-LTR letters or Unicode numbers into the
   * RTL flow, so the visual order is not a single-level reverse of the logical order.
   * Resolving it needs per-segment visual-order data the substrate does not have
   * yet, so the fragment fails closed rather than emit a mirrored-twice rect.
   * (V2 RTL Plan 004 scope boundary; Plan 005+ may extend.)
   */
  | { code: 'unsupported-complex-bidi' }
  /**
   * Reserved for a justified-line case whose exact position cannot be proven
   * (mirrors the fail-closed posture of the other diagnostics here). LTR
   * justify is resolved exactly (see {@link NeutralLineGeometryFlags.justified})
   * and RTL+justify fails closed with `unsupported-direction` before reaching
   * per-line geometry, so no producer currently emits this code — kept for
   * schema stability in case a future unresolved variant needs it.
   */
  | { code: 'approximate-justify' }
  /** The block measure was missing or mismatched; no geometry was produced. */
  | { code: 'missing-measure' }
  /** Fragment carried remeasured lines (narrow-column re-wrap); geometry used those lines. */
  | { code: 'remeasured-lines' };

/**
 * Geometry for one rendered fragment, joined back to neutral identity.
 *
 * Every record is addressable without ProseMirror: `identity` carries the
 * story, source block ref, stable fragment id, and (when available) the DOCX
 * source anchor. `bounds` is the fragment's container-space box; `lines` is the
 * resolved per-line/per-segment geometry (empty for unsupported fragments,
 * which carry a diagnostic instead).
 */
export type NeutralFragmentGeometry = {
  schema: typeof LAYOUT_SEGMENT_GEOMETRY_SCHEMA;
  /** Composite editor-neutral identity for the fragment. */
  identity: LayoutSourceIdentity;
  /** Story locator for the fragment. */
  story: LayoutStoryLocator;
  /** Source block reference. */
  blockRef: LayoutBlockRef;
  /** Stable opaque fragment id. */
  fragmentId: LayoutFragmentId;
  /** Optional cross-reference to the DOCX source anchor. */
  sourceAnchor?: SourceAnchor;
  /** 0-based page index containing the fragment. */
  pageIndex: number;
  /** Producer fragment kind (`para`, `list-item`, `table`, `image`, `drawing`). */
  fragmentKind: string;
  /** Container-space bounding box of the fragment (px). */
  bounds: { x: number; y: number; width: number; height: number };
  /** Resolved per-line geometry, in paint order. */
  lines: NeutralLineGeometry[];
  /** Per-fragment diagnostics; omitted when fully represented. */
  diagnostics?: NeutralGeometryDiagnostic[];
};

/**
 * Result of a neutral segment-geometry readback over a layout.
 *
 * `layoutRevision` mirrors `layout.layoutEpoch` so a consumer can detect stale
 * geometry. `fragments` is in page-then-fragment order.
 */
export type NeutralSegmentGeometryReadback = {
  schema: typeof LAYOUT_SEGMENT_GEOMETRY_SCHEMA;
  layoutRevision: number;
  fragments: NeutralFragmentGeometry[];
  /** Top-level diagnostics not attributable to a single fragment; omitted when none. */
  diagnostics?: NeutralGeometryDiagnostic[];
};
