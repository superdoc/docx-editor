import type { FlowRunLink, Run, TextRun } from '@superdoc/contracts';
import {
  formatChapterPageNumberText,
  formatPageNumberFieldValue,
  formatSectionPageNumberText,
  normalizeBaselineShift,
  resolveBaseFontSizeForVerticalText,
} from '@superdoc/contracts';
import { resolvePhysicalFamily } from '@superdoc/font-system';
import type { FragmentRenderContext } from '../renderer.js';
import { BROWSER_DEFAULT_FONT_SIZE, CLASS_NAMES } from '../styles.js';
import type { RunRenderContext, TrackedChangesRenderConfig } from './types.js';
import { applyRunDataAttributes } from './hash.js';
import { applyLinkAttributes, applyLinkDataset, buildLinkRenderData, enhanceAccessibility } from './links.js';
import { setTextContentWithFormattingSpaceMarks } from './formatting-marks.js';
import { allowFontSynthesis } from './font-synthesis.js';
import { applyTextEffects } from './text-effects.js';
import {
  normalizeRtlDateTokenForWordParity,
  resolveRunDirectionAttribute,
} from '../features/inline-direction/index.js';
import { resolveDerivedRunText } from '../derived-run-text-plane.js';

const DEFAULT_SUPERSCRIPT_RAISE_RATIO = 0.33;
const DEFAULT_SUBSCRIPT_LOWER_RATIO = 0.14;

/**
 * Underline thickness in px, scaled to font size. Shared by text runs
 * (`text-decoration-thickness`) and tab underlines (border width) so a run's
 * underline renders as a single uniform weight across text and tab characters,
 * matching Word, on any display density (SD-3330). The divisor approximates the
 * font's natural underline weight (≈ what `text-decoration-thickness: auto`
 * produces) while staying deterministic across platforms.
 *
 * Rounded to an integer px because CSS borders snap to integer device pixels
 * while `text-decoration-thickness` keeps fractional values; using an integer
 * makes the tab border and the text underline rasterize to the same line weight.
 */
export const underlineThicknessPx = (fontSize: number): number => Math.max(1, Math.round(fontSize / 14));

/**
 * Stroke weight for `w:outline`, scaled to font size.
 *
 * Word draws the legacy outline as a hairline around the glyph, not as the
 * authored-width stroke `w14:textOutline` carries. The divisor keeps it hairline
 * at body sizes and lets it grow with display type; the floor keeps it visible
 * on a low-density screen, where a sub-half-pixel stroke rounds away to nothing.
 */
const outlineStrokePx = (fontSize: number): number => Math.max(0.5, Math.round((fontSize / 24) * 100) / 100);

/**
 * Offset for the `w:shadow` / `w:emboss` / `w:imprint` shading, scaled to font size.
 *
 * One device pixel at body size, matching the offset Word draws, and growing
 * with the glyph so a heading does not carry a shadow that reads as a fringe.
 */
const effectOffsetPx = (fontSize: number): number => Math.max(1, Math.round(fontSize / 16));

/** Highlight side of the emboss/imprint pair. */
const EFFECT_LIGHT = 'rgba(255, 255, 255, 0.85)';
/** Shaded side of the emboss/imprint pair, and the color of a legacy drop shadow. */
const EFFECT_DARK = 'rgba(0, 0, 0, 0.45)';

/**
 * The Word 97-2003 run effects: `w:outline`, `w:shadow`, `w:emboss`, `w:imprint`.
 *
 * These predate the `w14:` effect family and Word still honours them — they are
 * exactly what the Font dialog's "Effects" group writes, so a document can carry
 * them with no `w14:` counterpart anywhere. Word draws them inside its typography
 * engine, so CSS can only approximate; that is the same trade `applyTextEffects`
 * already makes for `w14:glow`, and it is stated rather than hidden:
 *
 * - **outline** is faithful — a hairline stroke with the fill removed is what
 *   Word draws, and `-webkit-text-stroke` draws exactly that.
 * - **shadow** is a hard-edged offset copy, as in Word; the blur Word applies at
 *   large sizes is not reproduced.
 * - **emboss / imprint** keep the authored glyph color and add a light edge on
 *   one side and a dark edge on the other, the direction being what separates
 *   the two. Word instead paints the glyph itself near the page color and lets
 *   the edges carry the shape. Doing that here would need the resolved page
 *   background, which paint does not have — and guessing it wrong turns the
 *   text invisible. Legibility wins over the last of the fidelity.
 *
 * Paint-only: no metric changes, so a run that gains an effect does not reflow.
 * Called **after** `applyTextEffects`, so this function sees what the authored
 * `w14:` effects already wrote and can compose with them or stand aside — see
 * the two comments inside.
 */
const applyLegacyRunEffects = (element: HTMLElement, run: TextRun): void => {
  /*
   * The newer `w14:textOutline` / `w14:textFill` are the authored form of the
   * same intent, so the legacy flag steps aside for them explicitly rather than
   * being overwritten by declaration order — order would have left this
   * function's empty fill behind on a run whose `w14:textOutline` carries no
   * fill of its own, turning an authored outline into a hollow glyph.
   *
   * The test is **what `applyTextEffects` actually wrote**, not whether the
   * object exists. `applyTextEffects` paints a stroke only for an outline that
   * has a solid fill and a positive width, so
   * `<w14:textOutline w14:w="0"><w14:noFill/></w14:textOutline>` — what Word
   * writes for "no outline" — is a present object that paints nothing. Standing
   * aside for it would leave the run with no stroke and no legacy fallback:
   * blank space, which is the failure this whole change exists to remove.
   */
  // `Boolean(...)` and not `!== ''`: an unset property reads back as `''` in a
  // browser but as `undefined` in a DOM that does not implement the prefixed
  // property, and both mean "nothing was painted".
  const authoredOutline = Boolean(element.style.webkitTextStroke) || run.textEffects?.fill !== undefined;
  if (run.outline && !authoredOutline) {
    /*
     * `-webkit-text-fill-color`, and deliberately **not** `color`.
     *
     * The stroke is `currentColor`, and `currentColor` resolves against the
     * element's own `color`. Emptying the glyph through `color: transparent`
     * would take the stroke with it, and a run carrying `<w:outline/>` with
     * Automatic color — which is exactly what Word's Font dialog writes — would
     * paint nothing at all. `-webkit-text-fill-color` empties only the fill and
     * leaves `color` intact for the stroke to read.
     */
    element.style.webkitTextStroke = `${outlineStrokePx(run.fontSize)}px currentColor`;
    element.style.webkitTextFillColor = 'transparent';
  }

  const offset = effectOffsetPx(run.fontSize);
  const shadows: string[] = [];
  /*
   * `w14:shadow` is the authored form of this same drop shadow, so the legacy
   * flag steps aside for it — exactly as the outline does above. Emboss and
   * imprint have no `w14:` counterpart at all and are not drop shadows, so they
   * keep composing with whatever `applyTextEffects` wrote.
   */
  if (run.shadow && run.textEffects?.shadow == null) shadows.push(`${offset}px ${offset}px 0 ${EFFECT_DARK}`);
  if (run.emboss)
    shadows.push(`-${offset}px -${offset}px 0 ${EFFECT_LIGHT}`, `${offset}px ${offset}px 0 ${EFFECT_DARK}`);
  if (run.imprint)
    shadows.push(`${offset}px ${offset}px 0 ${EFFECT_LIGHT}`, `-${offset}px -${offset}px 0 ${EFFECT_DARK}`);
  if (shadows.length > 0) {
    /*
     * Appended, not assigned: `w14:glow` is a different effect from an embossed
     * edge and the two compose as two shadow layers, exactly as glow and
     * `w14:shadow` already do inside `applyTextEffects`. Assigning here would
     * make a glow silently erase the emboss on the same run.
     */
    const authored = element.style.textShadow;
    element.style.textShadow = authored ? `${authored}, ${shadows.join(', ')}` : shadows.join(', ');
  }
};

/**
 * The strike a run's own element should carry, and its line style.
 *
 * Shared because `render-line.ts` re-derives the decoration after painting on
 * the paths where an underline is lifted onto a line overlay — and a second
 * copy of the rule there would drift from this one. It already had: reading the
 * line off `strike` alone left a run carrying only `w:dstrike` undecorated on
 * exactly those lines.
 *
 * The style is `double` whenever the element itself carries no underline. On the
 * overlay paths that is always true — the underline was moved off the run — so a
 * run that is both underlined and double-struck gets a genuine double strike
 * there, while on an ordinary line CSS's single `text-decoration-style` forces
 * the underline's style to win and the strike stays single.
 */
export const runStrikeDecoration = (run: TextRun): { line: 'line-through' | 'none'; style?: 'double' } => {
  if (!run.strike && !run.doubleStrike) return { line: 'none' };
  return run.doubleStrike && !run.underline ? { line: 'line-through', style: 'double' } : { line: 'line-through' };
};

const hasVerticalPositioning = (run: TextRun): boolean =>
  normalizeBaselineShift(run.baselineShift) != null || run.vertAlign === 'superscript' || run.vertAlign === 'subscript';

const applyRunVerticalPositioning = (element: HTMLElement, run: TextRun): void => {
  // Vertically shifted runs should use a tight inline box. If they inherit the
  // parent line's full line-height, the glyph remains visually low inside an
  // oversized inline box even when the superscript/subscript offset is correct.
  if (hasVerticalPositioning(run)) {
    element.style.lineHeight = '1';
  }

  const explicitBaselineShift = normalizeBaselineShift(run.baselineShift);
  if (explicitBaselineShift != null) {
    element.style.verticalAlign = `${explicitBaselineShift}pt`;
    return;
  }

  if (run.vertAlign === 'superscript') {
    const baseFontSize = resolveBaseFontSizeForVerticalText(run.fontSize, run);
    element.style.verticalAlign = `${baseFontSize * DEFAULT_SUPERSCRIPT_RAISE_RATIO}px`;
    return;
  }

  if (run.vertAlign === 'subscript') {
    const baseFontSize = resolveBaseFontSizeForVerticalText(run.fontSize, run);
    element.style.verticalAlign = `${-(baseFontSize * DEFAULT_SUBSCRIPT_LOWER_RATIO)}px`;
    return;
  }

  if (run.vertAlign === 'baseline') {
    element.style.verticalAlign = 'baseline';
  }
};

type ResolvePhysicalFont = (
  cssFontFamily: string,
  face: { weight: '400' | '700'; style: 'normal' | 'italic' },
) => string;

export const applyRunTypographyStyles = (
  element: HTMLElement,
  run: TextRun,
  resolvePhysical: ResolvePhysicalFont = resolvePhysicalFamily,
): void => {
  // Use the same per-document physical family used during measurement so late
  // font substitution cannot make painted glyph metrics diverge from layout.
  element.style.fontFamily = resolvePhysical(run.fontFamily, {
    weight: run.bold ? '700' : '400',
    style: run.italic ? 'italic' : 'normal',
  });
  element.style.fontSize = `${run.fontSize}px`;
  // OOXML leaves kerning disabled unless w:kern opts the run in.
  element.style.fontKerning = 'none';
  allowFontSynthesis(element);
  if (run.bold) element.style.fontWeight = 'bold';
  if (run.italic) element.style.fontStyle = 'italic';

  if (run.letterSpacing != null) {
    element.style.letterSpacing = `${run.letterSpacing}px`;
  }
  if (
    run.horizontalScale != null &&
    Number.isFinite(run.horizontalScale) &&
    run.horizontalScale >= 0 &&
    run.horizontalScale !== 1
  ) {
    // CSS font-stretch does not reliably condense ordinary fonts; layout has
    // already measured this scale, so paint the glyph box with the same transform.
    element.style.display = 'inline-block';
    element.style.transform = `scaleX(${run.horizontalScale})`;
    element.style.transformOrigin = run.bidi?.rtl ? 'right center' : 'left center';
  }

  applyRunVerticalPositioning(element, run);
};

/**
 * Applies run styling properties to a DOM element.
 *
 * @param element - The HTML element to style
 * @param run - The run object containing styling information
 * @param _isLink - Whether this run is part of a hyperlink. Note: This parameter
 *                  is kept for API compatibility but no longer affects behavior -
 *                  inline colors are now applied to all runs (including links) to
 *                  ensure OOXML hyperlink character styles appear correctly.
 */
export const applyRunStyles = (
  element: HTMLElement,
  run: Run,
  _isLink = false,
  resolvePhysical: ResolvePhysicalFont = resolvePhysicalFamily,
): void => {
  if (
    run.kind === 'tab' ||
    run.kind === 'image' ||
    run.kind === 'lineBreak' ||
    run.kind === 'break' ||
    run.kind === 'fieldAnnotation' ||
    run.kind === 'math'
  ) {
    // Non-text visual runs don't have text styling properties.
    return;
  }

  applyRunTypographyStyles(element, run, resolvePhysical);

  // Apply inline color even for links so OOXML hyperlink styles appear when CSS is absent
  if (run.color) element.style.color = run.color;
  if (run.highlight) {
    element.style.backgroundColor = run.highlight;
  }
  if (run.textTransform) {
    element.style.textTransform = run.textTransform;
  }
  applyTextEffects(element, run.textEffects);
  applyLegacyRunEffects(element, run);

  // Apply text decorations from the run. Even for links, inline decorations should reflect
  // the document styling (tests assert underline presence on anchors).
  const decorations: string[] = [];
  if (run.underline) {
    decorations.push('underline');
    const u = run.underline;
    element.style.textDecorationStyle = u.style && u.style !== 'single' ? u.style : 'solid';
    // Pin the thickness to an explicit, font-scaled value (instead of `auto`, which
    // browsers render at the font's underline weight). Tab underlines reuse the same
    // value for their border width, so a run's underline is one uniform weight across
    // text and tab characters (SD-3330). See underlineThicknessPx.
    element.style.textDecorationThickness = `${underlineThicknessPx(run.fontSize)}px`;
    if (u.color) {
      element.style.textDecorationColor = u.color;
    }
  }
  // `doubleStrike` stands on its own: it is a separate `RunMarks` field and a
  // separately settable run attribute, so a run that carries only `w:dstrike`
  // still has a strikethrough to draw.
  if (run.strike || run.doubleStrike) {
    decorations.push('line-through');
  }
  if (decorations.length > 0) {
    element.style.textDecorationLine = decorations.join(' ');
    /*
     * `w:dstrike` is two lines rather than one. CSS carries a single
     * `text-decoration-style` for the whole decoration set, so a run that is
     * both underlined and double-struck can keep only one of the two: the
     * underline already claimed it above, and it claimed it from an authored
     * value (`w:u/@w:val`), while `w:dstrike` has no style to lose. So the
     * underline keeps its style and the strike stays single — a visible
     * shortfall on a rare combination, rather than a wrong underline on a
     * common one.
     */
    if (run.doubleStrike && !run.underline) {
      element.style.textDecorationStyle = 'double';
    }
  }
};

const PARAGRAPH_MARK_DELETION_ANCHOR_ATTR = 'data-paragraph-mark-deletion-anchor';

const getTrackedChangeLayers = (run: TextRun) => {
  if (Array.isArray(run.trackedChanges) && run.trackedChanges.length > 0) return run.trackedChanges;
  return run.trackedChange ? [run.trackedChange] : [];
};

const isReviewableParagraphMarkDeletionAnchor = (
  run: TextRun,
  renderContext: RunRenderContext,
  trackedConfig?: TrackedChangesRenderConfig,
): boolean =>
  renderContext.showFormattingMarks === true &&
  trackedConfig?.enabled === true &&
  trackedConfig.mode !== 'off' &&
  run.dataAttrs?.[PARAGRAPH_MARK_DELETION_ANCHOR_ATTR] === 'true' &&
  getTrackedChangeLayers(run).length > 0;

const applyParagraphMarkDeletionGlyphMetadata = (element: HTMLElement, run: TextRun): void => {
  const layers = getTrackedChangeLayers(run);
  const meta = run.trackedChange ?? layers[0];
  if (!meta) return;

  element.dataset.trackChangeId = meta.id;
  element.dataset.trackChangeIds = layers.map((layer) => layer.id).join(',');
  element.dataset.trackChangeKind = meta.kind;
  element.dataset.trackChangeAnchor = 'paragraph-mark';
  element.dataset.trackChangeStructural = 'paragraph-mark';
  element.dataset.trackChangeMarker = 'paragraph';
  if (meta.type) element.dataset.trackChangeType = meta.type;
  if (meta.subtype) element.dataset.trackChangeSubtype = meta.subtype;
  if (meta.targetKind) element.dataset.trackChangeTargetKind = meta.targetKind;
  if (meta.storyKey) element.dataset.storyKey = meta.storyKey;
  if (meta.author) element.dataset.trackChangeAuthor = meta.author;
  if (meta.authorEmail) element.dataset.trackChangeAuthorEmail = meta.authorEmail;
  if (meta.color) element.dataset.trackChangeAuthorColor = meta.color;
  if (meta.date) element.dataset.trackChangeDate = meta.date;
};

export const resolveRunText = (run: Run, context: FragmentRenderContext): string => {
  const derivedText = resolveDerivedRunText(run, context.derivedRunTextPlane);
  if (derivedText !== undefined) return derivedText;
  const runToken = 'token' in run ? run.token : undefined;

  if (run.kind === 'tab') {
    return run.text;
  }
  if (run.kind === 'image') {
    // Image runs don't have text content
    return '';
  }
  if (run.kind === 'lineBreak') {
    // Line break runs don't render text - the measurer creates new lines for them
    return '';
  }
  if (run.kind === 'break') {
    // Break runs don't render text - the measurer creates new lines for them
    return '';
  }
  if (!('text' in run)) {
    // Safety check - if run doesn't have text property, return empty string
    return '';
  }
  if (!runToken) {
    return run.text ?? '';
  }
  const pageNumberFieldFormat = 'pageNumberFieldFormat' in run ? run.pageNumberFieldFormat : undefined;
  if (runToken === 'pageNumber') {
    if (pageNumberFieldFormat) {
      return formatChapterPageNumberText({
        pageComponent: formatPageNumberFieldValue(
          context.displayPageNumber ?? context.pageNumber,
          pageNumberFieldFormat,
        ),
        chapterNumberText: context.pageNumberChapterText,
        chapterSeparator: context.pageNumberChapterSeparator,
      });
    }
    if (context.pageNumberChapterText) {
      return formatSectionPageNumberText({
        displayNumber: context.displayPageNumber ?? context.pageNumber,
        pageFormat: context.pageNumberFormat ?? 'decimal',
        chapterNumberText: context.pageNumberChapterText,
        chapterSeparator: context.pageNumberChapterSeparator,
      });
    }
    return context.pageNumberText ?? String(context.pageNumber);
  }
  if (runToken === 'totalPageCount') {
    // Provisional pagination: the document total is not authoritative yet.
    // Render the pre-resolved provisional text (source-cached DOCX result,
    // em dash when absent) rather than the partial page count.
    if (context.pageCountFieldsExact === false) {
      return provisionalPageCountText(run.text);
    }
    if (pageNumberFieldFormat) {
      return formatPageNumberFieldValue(context.totalPages || 1, pageNumberFieldFormat);
    }
    return context.totalPages ? String(context.totalPages) : (run.text ?? '');
  }
  if (runToken === 'sectionPageCount') {
    if (context.pageCountFieldsExact === false) {
      return provisionalPageCountText(run.text);
    }
    const sectionPageCount = context.sectionPageCount;
    if (sectionPageCount == null) {
      return run.text ?? '';
    }
    if (pageNumberFieldFormat) {
      return formatPageNumberFieldValue(sectionPageCount, pageNumberFieldFormat);
    }
    return String(sectionPageCount);
  }
  return run.text ?? '';
};

/**
 * Placeholder for a total-page-count field with no source-cached result while
 * pagination is provisional (matches the layout-bridge resolver policy).
 */
const PROVISIONAL_PAGE_COUNT_PLACEHOLDER = '—';

const provisionalPageCountText = (cachedText: string | undefined): string =>
  cachedText && cachedText.trim().length > 0 ? cachedText : PROVISIONAL_PAGE_COUNT_PLACEHOLDER;

export const extractLinkData = (run: Run) => {
  if (run.kind === 'tab' || run.kind === 'image' || run.kind === 'lineBreak' || run.kind === 'math') {
    return null;
  }
  const link = (run as TextRun).link as FlowRunLink | undefined;
  if (!link) {
    return null;
  }
  return buildLinkRenderData(link);
};

export const renderTextRun = (
  run: TextRun,
  context: FragmentRenderContext,
  renderContext: RunRenderContext,
  trackedConfig?: TrackedChangesRenderConfig,
): HTMLElement | null => {
  if (!run.text) {
    return null;
  }

  if (run.vanish === true) {
    const elem = renderContext.doc.createElement('span');
    elem.classList.add(CLASS_NAMES.textRun);
    elem.setAttribute('aria-hidden', 'true');
    const showParagraphMarkDeletionGlyph = isReviewableParagraphMarkDeletionAnchor(run, renderContext, trackedConfig);

    if (showParagraphMarkDeletionGlyph) {
      elem.classList.add('superdoc-formatting-paragraph-mark', 'superdoc-tracked-paragraph-mark');
      elem.textContent = '¶';
      elem.style.display = 'inline';
      elem.style.textDecorationColor = 'currentColor';
      elem.style.textDecorationLine = 'line-through';
      applyRunStyles(elem, run, false, renderContext.resolvePhysical);
    } else {
      elem.textContent = '';
      elem.style.display = 'inline-block';
      elem.style.width = '0px';
      elem.style.maxWidth = '0px';
      elem.style.overflow = 'hidden';
      elem.style.lineHeight = '0';
      elem.style.fontSize = '0px';
      elem.style.zIndex = '1';
    }

    const linkData = extractLinkData(run);
    if (linkData?.dataset) {
      applyLinkDataset(elem, linkData.dataset);
    }

    const commentAnnotations = run.comments;
    if (commentAnnotations?.length) {
      elem.dataset.commentIds = commentAnnotations.map((c) => c.commentId).join(',');
      if (commentAnnotations.some((c) => c.internal)) {
        elem.dataset.commentInternal = 'true';
      }
      const internalIds = commentAnnotations.filter((c) => c.internal).map((c) => c.commentId);
      if (internalIds.length > 0) {
        elem.dataset.commentInternalIds = internalIds.join(',');
      }
      const importedEntries = commentAnnotations
        .filter((c) => c.importedId && c.importedId !== c.commentId)
        .map((c) => `${c.importedId}=${c.commentId}`);
      if (importedEntries.length > 0) {
        elem.dataset.commentImportedIds = importedEntries.join(',');
      }
      const threadedIds = commentAnnotations.filter((c) => c.trackedChangeThreadParentId).map((c) => c.commentId);
      if (threadedIds.length > 0) {
        elem.dataset.commentThreadIds = threadedIds.join(',');
      }
      elem.classList.add('superdoc-comment-highlight');
    }

    applyRunDataAttributes(elem, run.dataAttrs);
    if (run.pmStart != null) elem.dataset.pmStart = String(run.pmStart);
    if (run.pmEnd != null) elem.dataset.pmEnd = String(run.pmEnd);
    elem.dataset.layoutEpoch = String(renderContext.layoutEpoch);
    if (trackedConfig) {
      renderContext.applyTrackedChangeDecorations(elem, run, trackedConfig);
    }
    if (showParagraphMarkDeletionGlyph) {
      applyParagraphMarkDeletionGlyphMetadata(elem, run);
    }
    renderContext.applySdtDataset(elem, run.sdt);
    return elem;
  }

  const linkData = extractLinkData(run);
  const isActiveLink = !!(linkData && !linkData.blocked && linkData.href);
  const elem = isActiveLink ? renderContext.doc.createElement('a') : renderContext.doc.createElement('span');
  elem.classList.add(CLASS_NAMES.textRun);
  const text = resolveRunText(run, context);
  const effectiveText =
    run.bidi?.rtl === true && typeof text === 'string' ? normalizeRtlDateTokenForWordParity(text) : text;
  setTextContentWithFormattingSpaceMarks(elem, effectiveText, renderContext.doc, renderContext.showFormattingMarks);

  if (linkData?.dataset) {
    applyLinkDataset(elem, linkData.dataset);
  }
  if (linkData?.blocked) {
    elem.dataset.linkBlocked = 'true';
    // For blocked links rendered as spans, set appropriate role
    elem.setAttribute('role', 'text');
    elem.setAttribute('aria-label', 'Invalid link - not clickable');
  }
  if (isActiveLink && linkData) {
    applyLinkAttributes(elem as HTMLAnchorElement, linkData);
    // Enhance accessibility with ARIA labels for ambiguous text
    enhanceAccessibility(elem as HTMLAnchorElement, linkData, text);

    // Note: Tooltip accessibility (aria-describedby) will be applied after
    // the element is added to the DOM in renderLine, since it creates a sibling element
    // Store tooltip for later processing
    if (linkData.tooltip) {
      renderContext.pendingTooltips.set(elem, linkData.tooltip);
    }
  }

  // Pass isLink flag to skip applying inline color/decoration styles for links
  applyRunStyles(elem as HTMLElement, run, isActiveLink, renderContext.resolvePhysical);
  const dirAttr = resolveRunDirectionAttribute({
    runText: run.text,
    effectiveText,
    isRtlTagged: run.bidi?.rtl === true,
  });
  if (dirAttr) {
    elem.setAttribute('dir', dirAttr);
  }
  const commentAnnotations = run.comments;
  const hasAnyComment = !!commentAnnotations?.length;
  // Comment highlight styles are applied post-paint by CommentHighlightDecorator.
  // The painter only stamps metadata attributes below.
  // We still need to preserve the comment ids
  if (hasAnyComment) {
    elem.dataset.commentIds = commentAnnotations.map((c) => c.commentId).join(',');
    if (commentAnnotations.some((c) => c.internal)) {
      elem.dataset.commentInternal = 'true';
    }
    // Per-comment internal flag so the editor-side decorator can pick the right color
    const internalIds = commentAnnotations.filter((c) => c.internal).map((c) => c.commentId);
    if (internalIds.length > 0) {
      elem.dataset.commentInternalIds = internalIds.join(',');
    }
    // importedId aliases so the decorator can match by either ID
    const importedEntries = commentAnnotations
      .filter((c) => c.importedId && c.importedId !== c.commentId)
      .map((c) => `${c.importedId}=${c.commentId}`);
    if (importedEntries.length > 0) {
      elem.dataset.commentImportedIds = importedEntries.join(',');
    }
    const threadedIds = commentAnnotations.filter((c) => c.trackedChangeThreadParentId).map((c) => c.commentId);
    if (threadedIds.length > 0) {
      elem.dataset.commentThreadIds = threadedIds.join(',');
    }
    elem.classList.add('superdoc-comment-highlight');
  }
  // Ensure text renders above tab leaders (leaders are z-index: 0)
  elem.style.zIndex = '1';
  applyRunDataAttributes(elem as HTMLElement, run.dataAttrs);

  // SD-2454: bookmark marker runs carry a data-bookmark-name attribute.
  // Surface the bookmark name as a native `title` tooltip so hovering the
  // opening bracket identifies which bookmark is being marked.
  const bookmarkName = run.dataAttrs?.['data-bookmark-name'];
  if (bookmarkName) {
    (elem as HTMLElement).title = bookmarkName;
  }

  if (run.pmStart != null) elem.dataset.pmStart = String(run.pmStart);
  if (run.pmEnd != null) elem.dataset.pmEnd = String(run.pmEnd);
  elem.dataset.layoutEpoch = String(renderContext.layoutEpoch);
  if (trackedConfig) {
    renderContext.applyTrackedChangeDecorations(elem, run, trackedConfig);
  }
  renderContext.applySdtDataset(elem, run.sdt);

  return elem;
};

export { BROWSER_DEFAULT_FONT_SIZE };
