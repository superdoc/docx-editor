import type { FlowRunLink, Run, TextRun } from '@superdoc/contracts';
import {
  DELETED_PAGE_BREAK_LABEL,
  isPageBreakDeletionAnchorRun,
  formatChapterPageNumberText,
  formatPageNumberFieldValue,
  formatSectionPageNumberText,
} from '@superdoc/contracts';
import type { FragmentRenderContext } from '../renderer.js';
import { BROWSER_DEFAULT_FONT_SIZE, CLASS_NAMES } from '../styles.js';
import type { RunRenderContext, TrackedChangesRenderConfig } from './types.js';
import { applyRunDataAttributes } from './hash.js';
import { applyLinkAttributes, applyLinkDataset, buildLinkRenderData, enhanceAccessibility } from './links.js';
import { setTextContentWithFormattingSpaceMarks } from './formatting-marks.js';
import { applyTextEffects } from './text-effects.js';
import {
  normalizeRtlDateTokenForWordParity,
  resolveRunDirectionAttribute,
} from '../features/inline-direction/index.js';
import { resolveDerivedRunText } from '../derived-run-text-plane.js';

import {
  resolveRunTypographyStyles,
  resolveRunDecorationStyles,
  type ResolvePhysicalFont,
} from './text-style-facts.js';
export { underlineThicknessPx } from './text-style-facts.js';

export type CheckboxGlyphs = { checked: string; unchecked: string; current: string };

const checkboxGlyphFromCodePoint = (value: string): string | null => {
  if (!/^[0-9a-f]{1,6}$/i.test(value)) return null;
  const codePoint = Number.parseInt(value, 16);
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : null;
};

export const checkboxGlyphs = (run: TextRun): CheckboxGlyphs | null => {
  const sdt = run.sdt;
  if (sdt?.type !== 'structuredContent' || !sdt.checkbox || sdt.appearance === 'hidden') return null;
  const checkbox = sdt.checkbox;
  const checked = checkboxGlyphFromCodePoint(checkbox.checkedSymbol.char);
  const unchecked = checkboxGlyphFromCodePoint(checkbox.uncheckedSymbol.char);
  if (!checked || !unchecked) return null;
  return { checked, unchecked, current: checkbox.checked ? checked : unchecked };
};

/** Stamps the authored states needed to reflect an accepted checkbox toggle. */
export const applyCheckboxGlyphMetadata = (element: HTMLElement, run: TextRun): CheckboxGlyphs | null => {
  const glyphs = checkboxGlyphs(run);
  if (!glyphs) return null;
  // A checkbox SDT can contain more than its state symbol. Only the run that
  // paints that authored symbol may be updated optimistically after a toggle.
  if (run.text && run.text !== glyphs.current) return null;
  element.dataset.wordCheckboxGlyph = 'true';
  element.dataset.checkboxCheckedGlyph = glyphs.checked;
  element.dataset.checkboxUncheckedGlyph = glyphs.unchecked;
  return glyphs;
};

export const applyRunTypographyStyles = (
  element: HTMLElement,
  run: TextRun,
  resolvePhysical?: ResolvePhysicalFont,
): void => {
  for (const [property, value] of Object.entries(resolveRunTypographyStyles(run, resolvePhysical))) {
    element.style.setProperty(property, value);
  }
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
  resolvePhysical?: ResolvePhysicalFont,
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

  for (const [property, value] of Object.entries(resolveRunDecorationStyles(run))) {
    element.style.setProperty(property, value);
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

const applyReviewGlyphMetadata = (element: HTMLElement, run: TextRun, marker = 'paragraph'): void => {
  const layers = getTrackedChangeLayers(run);
  const meta = run.trackedChange ?? layers[0];
  if (!meta) return;

  element.dataset.trackChangeId = meta.id;
  element.dataset.trackChangeIds = layers.map((layer) => layer.id).join(',');
  element.dataset.trackChangeKind = meta.kind;
  element.dataset.trackChangeAnchor = marker === 'paragraph' ? 'paragraph-mark' : marker;
  element.dataset.trackChangeStructural = marker === 'paragraph' ? 'paragraph-mark' : marker;
  element.dataset.trackChangeMarker = marker;
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

    const showPageBreakDeletionGlyph =
      isPageBreakDeletionAnchorRun(run) &&
      trackedConfig?.enabled === true &&
      trackedConfig.mode === 'review' &&
      getTrackedChangeLayers(run).length > 0;

    if (showPageBreakDeletionGlyph) {
      elem.removeAttribute('aria-hidden');
      elem.setAttribute('aria-label', DELETED_PAGE_BREAK_LABEL);
      elem.textContent = 'Page break';
      elem.style.position = 'absolute';
      elem.style.transform = 'translateY(-100%)';
      elem.style.whiteSpace = 'nowrap';
      elem.style.textDecorationLine = 'line-through';
      applyRunStyles(elem, run, false, renderContext.resolvePhysical);
      elem.style.height = `${run.fontSize * 1.3}px`;
      elem.style.lineHeight = elem.style.height;
    } else if (showParagraphMarkDeletionGlyph) {
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
      applyReviewGlyphMetadata(elem, run);
    }
    if (showPageBreakDeletionGlyph) applyReviewGlyphMetadata(elem, run, 'page-break');
    renderContext.applySdtDataset(elem, run.sdt);
    return elem;
  }

  const linkData = extractLinkData(run);
  const isActiveLink = !!(linkData && !linkData.blocked && linkData.href);
  const elem = isActiveLink ? renderContext.doc.createElement('a') : renderContext.doc.createElement('span');
  elem.classList.add(CLASS_NAMES.textRun);
  const text = resolveRunText(run, context);
  const bidiLanguage = run.script?.language?.complexScript;
  const effectiveText = run.bidi?.rtl === true ? normalizeRtlDateTokenForWordParity(text, bidiLanguage) : text;
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
  applyCheckboxGlyphMetadata(elem as HTMLElement, run);
  const dirAttr = resolveRunDirectionAttribute({
    runText: run.text,
    effectiveText,
    isRtlTagged: run.bidi?.rtl === true,
    bidiLanguage,
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
