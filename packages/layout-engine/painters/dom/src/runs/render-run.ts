import type { FieldAnnotationRun, ImageRun, MathRun, Run, TextRun } from '@superdoc/contracts';
import { EMPTY_SDT_PLACEHOLDER_TEXT, isEmptySdtPlaceholderRun } from '@superdoc/contracts';
import type { FragmentRenderContext } from '../renderer.js';
import type { RunRenderContext, TrackedChangesRenderConfig } from './types.js';
import type { PositionRunKind } from '../pm-position-validation.js';
import { renderFieldAnnotationRun } from './field-annotation-run.js';
import { renderImageRun } from './image-run.js';
import { renderMathRun } from './math-run.js';
import { applyCheckboxGlyphMetadata, applyRunStyles, checkboxGlyphs, renderTextRun } from './text-run.js';

export const isImageRun = (run: Run): run is ImageRun => run.kind === 'image';
export const isLineBreakRun = (run: Run): run is import('@superdoc/contracts').LineBreakRun => run.kind === 'lineBreak';
export const isBreakRun = (run: Run): run is import('@superdoc/contracts').BreakRun => run.kind === 'break';
export const isFieldAnnotationRun = (run: Run): run is FieldAnnotationRun => run.kind === 'fieldAnnotation';
export const isMathRun = (run: Run): run is MathRun => run.kind === 'math';

const renderEmptySdtPlaceholderRun = (run: TextRun, renderContext: RunRenderContext): HTMLElement | null => {
  const elem = renderContext.doc.createElement('span');
  const glyph = checkboxGlyphs(run);
  elem.classList.add('superdoc-empty-sdt-placeholder');
  if (run.visualPlaceholder === 'emptyInlineSdt') {
    elem.classList.add('superdoc-empty-inline-sdt-placeholder');
  } else if (run.visualPlaceholder === 'emptyBlockSdt') {
    elem.classList.add('superdoc-empty-block-sdt-placeholder');
  }
  if (glyph) {
    elem.classList.add('superdoc-word-checkbox-glyph');
    // AIDEV-NOTE: The V2 host uses both authored symbols for immediate local
    // feedback; the source repaint remains authoritative.
    applyCheckboxGlyphMetadata(elem, run);
    elem.textContent = glyph.current;
  } else {
    elem.setAttribute('aria-hidden', 'true');
    elem.dataset.placeholderText = EMPTY_SDT_PLACEHOLDER_TEXT;
  }
  elem.dataset.layoutEpoch = String(renderContext.layoutEpoch);
  if (run.pmStart != null) elem.dataset.pmStart = String(run.pmStart);
  if (run.pmEnd != null) elem.dataset.pmEnd = String(run.pmEnd);
  renderContext.applySdtDataset(elem, run.sdt);
  applyRunStyles(elem, run, false, renderContext.resolvePhysical);
  return elem;
};

/**
 * Dynamic page fields are display-only in page furniture. Body fields remain
 * editable source content and keep the body's coordinate requirement.
 */
const PAGE_FIELD_TOKENS = new Set(['pageNumber', 'totalPageCount', 'sectionPageCount']);

const isRenderOnlyPageField = (run: Run, context: FragmentRenderContext): boolean => {
  const token = (run as { token?: string }).token;
  return context.section !== 'body' && typeof token === 'string' && PAGE_FIELD_TOKENS.has(token);
};

/**
 * Record one content-free position-coverage observation for a rendered run.
 *
 * This is the single position-validation point for rendered runs. It has both
 * the run kind and the fragment story/section, so classification is
 * story-aware. Dark by default: when the painter did not enable the collector
 * this returns after one branch, allocating nothing. Only rendered runs
 * (non-null element) are recorded, matching where the old assertions fired.
 */
const recordRunPosition = (
  renderContext: RunRenderContext,
  context: FragmentRenderContext,
  run: Run,
  runKind: PositionRunKind,
  element: HTMLElement | null,
): void => {
  const collector = renderContext.positionValidation;
  if (!collector || !collector.isEnabled || element == null) return;
  const pmStart = (run as { pmStart?: number | null }).pmStart;
  const pmEnd = (run as { pmEnd?: number | null }).pmEnd;
  collector.record({
    runKind,
    section: context.section,
    ...(context.story !== undefined ? { story: context.story } : {}),
    ...(pmStart !== undefined ? { pmStart } : {}),
    ...(pmEnd !== undefined ? { pmEnd } : {}),
    renderOnly: runKind === 'text' && isRenderOnlyPageField(run, context),
  });
};

/**
 * Render a single run as an HTML element (span or anchor).
 */
export const renderRun = (
  run: Run,
  context: FragmentRenderContext,
  renderContext: RunRenderContext,
  trackedConfig?: TrackedChangesRenderConfig,
): HTMLElement | null => {
  // Handle ImageRun
  if (isImageRun(run)) {
    const el = renderImageRun(run, renderContext, trackedConfig);
    recordRunPosition(renderContext, context, run, 'image', el);
    return el;
  }

  // Handle FieldAnnotationRun - inline pill-styled form fields
  if (isFieldAnnotationRun(run)) {
    const el = renderFieldAnnotationRun(run, renderContext);
    recordRunPosition(renderContext, context, run, 'field', el);
    return el;
  }

  // Handle MathRun - inline math rendered as MathML
  if (isMathRun(run)) {
    const el = renderMathRun(run, renderContext);
    recordRunPosition(renderContext, context, run, 'math', el);
    return el;
  }

  // Handle LineBreakRun - line breaks are handled by the measurer creating new lines,
  // so we don't render anything for them in the DOM. They exist in the run array for
  // proper PM position tracking but don't need visual representation.
  if (isLineBreakRun(run)) {
    return null;
  }

  // Handle BreakRun - similar to LineBreakRun, breaks are handled by the measurer
  if (isBreakRun(run)) {
    return null;
  }

  if (isEmptySdtPlaceholderRun(run)) {
    return renderEmptySdtPlaceholderRun(run, renderContext);
  }

  // Handle TextRun
  if (!('text' in run) || !run.text) {
    return null;
  }

  const el = renderTextRun(run as TextRun, context, renderContext, trackedConfig);
  recordRunPosition(renderContext, context, run, 'text', el);
  return el;
};
