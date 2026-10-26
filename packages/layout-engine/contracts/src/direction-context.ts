/**
 * Direction Context Types
 *
 * Typed direction information that propagates from section to paragraph to run
 * during pm-adapter conversion. Each container has its own context type so the
 * orthogonal axes do not collapse:
 *
 *   - section page direction (page numbers, columns) is independent of
 *   - paragraph inline base direction (ind, jc, tab) which is independent of
 *   - table visual direction (cell ordering) which is independent of
 *   - writing mode (horizontal vs vertical text flow).
 *
 * Per ECMA-376:
 *   - Section w:bidi affects section chrome only (§17.6.1).
 *   - Paragraph w:bidi affects paragraph-level properties only (§17.3.1.6).
 *   - Table w:bidiVisual affects cell ordering only (§17.4.1).
 *   - Writing mode (w:textDirection) inherits across containers when absent
 *     (§17.3.1.41) — the one exception that does propagate.
 *
 * The resolver chain in `pm-adapter/src/direction/` produces these contexts.
 * Downstream consumers (DomPainter, layout-bridge, hit testing) read the
 * resolved fields and never re-derive direction from raw attributes.
 */

/**
 * Inline base direction of text within a container.
 * Maps to OOXML w:bidi (paragraph) and w:rtl (run).
 */
export type BaseDirection = 'ltr' | 'rtl';

/**
 * Text flow direction ("writing mode").
 * Maps to OOXML w:textDirection (ST_TextDirection §17.18.93).
 *
 * Limited to the values SuperDoc renders today; the full OOXML enum has
 * twelve values for vertical-text variants (Wave 4 expands this).
 */
export type WritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';

/**
 * Direction context for a section.
 * Used by section-level chrome only (page numbers, columns, gutters).
 * MUST NOT be used to determine paragraph inline direction.
 */
export type SectionDirectionContext = {
  /** Section page direction; from w:sectPr/w:bidi. */
  pageDirection: BaseDirection;
  /** Default writing mode for paragraphs and cells in the section. */
  writingMode: WritingMode;
  /** Whether the page gutter is on the right; from w:sectPr/w:rtlGutter. */
  rtlGutter: boolean;
};

/**
 * Direction context for a table.
 * Carries visual cell ordering only. Cell paragraph direction is independent.
 */
export type TableDirectionContext = {
  /**
   * Visual direction of cell ordering; from w:tblPr/w:bidiVisual.
   * Undefined when not specified.
   *
   * This is the single load-bearing field: `getTableVisualDirection` and all
   * downstream consumers (layout-table, DomPainter) read only `visualDirection`.
   */
  visualDirection: BaseDirection | undefined;
  /**
   * Inherited from the parent section. Optional: producers that resolve only
   * the table's own visual axis (e.g. the v2 layout adapter, which derives
   * `visualDirection` from inline `w:bidiVisual` evidence) populate just
   * `visualDirection`. Section inheritance is an orthogonal axis resolved
   * elsewhere; no consumer reads `parentSection` today.
   */
  parentSection?: SectionDirectionContext;
};

/**
 * Direction context for a table cell.
 * Carries cell-level writing mode (vertical text). Cell paragraph inline
 * direction is decided per-paragraph, not by the cell.
 */
export type CellDirectionContext = {
  /**
   * Cell text flow direction; from w:tcPr/w:textDirection.
   * Falls back to the section writing mode when absent.
   */
  writingMode: WritingMode;
  /** Inherited from the parent table. */
  parentTable: TableDirectionContext;
};

/**
 * Direction context for a paragraph.
 * The single source of truth for paragraph direction-aware decisions.
 *
 * Consumers (logical-side resolution, alignment, indent, hit testing,
 * DomPainter direction styling) read from here. They do NOT re-derive
 * direction from raw attributes.
 */
export type ParagraphDirectionContext = {
  /**
   * Paragraph inline base direction; from w:pPr/w:bidi.
   * Undefined when no explicit bidi is set; consumers should let the browser
   * apply the Unicode Bidi Algorithm via missing or empty `dir` attribute.
   *
   * Section page direction MUST NOT propagate into this field. Per §17.6.1,
   * section bidi only affects section chrome, not paragraph layout.
   */
  inlineDirection: BaseDirection | undefined;
  /**
   * Writing mode (text flow) for the paragraph; from w:pPr/w:textDirection.
   * Inherits from the section when absent. This is the one OOXML direction
   * field that propagates across containers per §17.3.1.41.
   */
  writingMode: WritingMode;
};

/**
 * Run-level bidi signals: explicit overrides and embeddings.
 * Direction signals only — script formatting lives in RunScriptContext.
 *
 * Maps to OOXML w:rPr/w:rtl (§17.3.2.30), w:dir (§17.3.2.8 embedding),
 * w:bdo (§17.3.2.3 override).
 */
export type RunBidiContext = {
  /**
   * w:rPr/w:rtl. Preserves the source OOXML signal that the run carries
   * the `w:rtl` flag. Per §17.3.2.30, `w:rtl` does two things at the model
   * level:
   *   1. Forces the complex-script formatting stack (bCs, iCs, szCs,
   *      rFonts/@cs). See RunScriptContext for the formatting half.
   *   2. Acts as a Character Directionality Override for weak/neutral
   *      characters in the run (NOT a forced visual flip of strong-LTR text;
   *      §17.3.2.30 explicitly says behavior on strong-LTR is unspecified).
   *
   * `rtl: true` is the source signal, NOT a directive that every consumer
   * must project to `dir="rtl"` in the rendered DOM. The painter decides
   * the DOM projection per its Word-parity rules (see
   * `features/inline-direction/resolveRunDirectionAttribute`). Exporters
   * must preserve `rtl: true` on round-trip regardless of paint decisions,
   * since dropping it would lose the source `w:rPr/w:rtl` semantics.
   */
  rtl: boolean;
  /** w:dir; bidi embedding direction (RLE/LRE). Wave 1c. */
  embedding?: BaseDirection;
  /** w:bdo; bidi override direction (RLO/LRO). Wave 1c. */
  override?: BaseDirection;
};

/**
 * Run-level script context: which formatting stack applies.
 *
 * Per ECMA Annex I, when w:rtl is set or w:cs is set, the run's formatting
 * comes from the complex-script variants (bCs, iCs, szCs, rFonts/@cs).
 * Otherwise it comes from the Latin variants (b, i, sz, rFonts/@ascii).
 *
 * This context is preservation-only in Wave 1a. Wave 1b implements the
 * stack-selection logic (resolveRunScriptContext returns whether to render
 * with the CS or Latin stack).
 */
export type RunScriptContext = {
  /**
   * w:rPr/w:cs (§17.3.2.7). Forces complex-script formatting regardless of Unicode.
   * Per the spec, absence != false: when omitted, the value inherits from the style
   * hierarchy and ultimately falls back to Unicode-based script detection. Only set
   * this field when the source explicitly carries w:cs - leave undefined otherwise so
   * downstream consumers can distinguish "not set" from "explicitly off".
   */
  complexScript?: boolean;
  /**
   * Per-script language metadata, kept on separate fields per ECMA §17.3.2.20
   * because each maps to a different formatting stack (Latin / CS / East Asian).
   * Wave 1b consumes these to gate spellcheck and font-stack selection.
   */
  language?: {
    /** w:rPr/w:lang/@val. Default (Latin) language tag. */
    default?: string;
    /** w:rPr/w:lang/@bidi. Complex-script language tag. */
    complexScript?: string;
    /** w:rPr/w:lang/@eastAsia. East Asian language tag. */
    eastAsian?: string;
  };
};

/**
 * Read a paragraph's inline base direction from its attributes.
 *
 * Prefers the resolved {@link ParagraphDirectionContext} (SD-2776) when
 * present. Falls back to `paragraphProperties.rightToLeft` for PM-node /
 * editor paths that store direction on the raw OOXML properties rather
 * than the typed direction context.
 *
 * Consumers should call this instead of inspecting attrs ad hoc so the
 * direction source check stays in one place.
 */
export function getParagraphInlineDirection(
  attrs:
    | {
        directionContext?: { inlineDirection?: BaseDirection | null } | null;
        paragraphProperties?: { rightToLeft?: boolean | null } | null;
      }
    | null
    | undefined,
): BaseDirection | undefined {
  const fromContext = attrs?.directionContext?.inlineDirection;
  if (fromContext != null) return fromContext;
  const ppRtl = attrs?.paragraphProperties?.rightToLeft;
  if (ppRtl === true) return 'rtl';
  if (ppRtl === false) return 'ltr';
  return undefined;
}

/**
 * Read a table's visual direction (cell ordering axis) from its attributes.
 *
 * Prefers the resolved {@link TableDirectionContext} when present, falls
 * back to the legacy `tableProperties.rightToLeft` (or `bidiVisual` alias)
 * for compatibility.
 *
 * Per ECMA-376 §17.4.1, `w:bidiVisual` affects only cell ordering and
 * table-visual properties. Cell paragraph inline direction is independent;
 * use {@link getParagraphInlineDirection} for that axis.
 *
 * Consumers should call this instead of reading `tableProperties.rightToLeft`
 * directly so the source check stays in one place and the resolver can take
 * over once pm-adapter populates `tableDirectionContext` everywhere.
 */
export function getTableVisualDirection(
  attrs:
    | {
        tableDirectionContext?: { visualDirection?: BaseDirection | null } | null;
        tableProperties?: { rightToLeft?: boolean | null; bidiVisual?: boolean | null } | null;
      }
    | null
    | undefined,
): BaseDirection | undefined {
  const fromContext = attrs?.tableDirectionContext?.visualDirection;
  if (fromContext != null) return fromContext;
  const tp = attrs?.tableProperties;
  if (tp?.rightToLeft === true || tp?.bidiVisual === true) return 'rtl';
  if (tp?.rightToLeft === false || tp?.bidiVisual === false) return 'ltr';
  return undefined;
}
