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
  if (run.strike) {
    decorations.push('line-through');
  }
  if (decorations.length > 0) {
    element.style.textDecorationLine = decorations.join(' ');
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
