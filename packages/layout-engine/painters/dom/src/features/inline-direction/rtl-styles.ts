/**
 * RTL paragraph style helpers for DomPainter.
 *
 * All RTL-aware rendering decisions live here so the main renderer
 * doesn't need to re-derive direction in multiple places.
 *
 * @ooxml w:pPr/w:bidi — paragraph bidirectional flag
 * @spec  ECMA-376 §17.3.1.1 (bidi)
 */
import { getParagraphInlineDirection, type ParagraphAttrs } from '@superdoc/contracts';

/**
 * Returns true when the paragraph attributes indicate right-to-left direction.
 */
export const isRtlParagraph = (attrs: ParagraphAttrs | undefined): boolean =>
  getParagraphInlineDirection(attrs) === 'rtl';

/**
 * Compute the effective CSS text-align for a paragraph.
 *
 * DomPainter handles justify via per-line word-spacing, so 'justify'
 * becomes 'left' (LTR) or 'right' (RTL) to align the last line correctly.
 * When no explicit alignment is set the default follows the paragraph direction.
 */
export const resolveTextAlign = (alignment: ParagraphAttrs['alignment'], isRtl: boolean, isAuto = false): string => {
  switch (alignment) {
    case 'center':
    case 'right':
    case 'left':
      return alignment;
    case 'justify':
    default:
      // For auto-direction paragraphs we don't know the resolved side at paint
      // time — `start` follows the browser-resolved `dir="auto"`.
      if (isAuto) return 'start';
      return isRtl ? 'right' : 'left';
  }
};

/**
 * Apply `dir` and `text-align` to an element based on paragraph attributes.
 * Used by both `renderLine` (line elements) and `applyParagraphBlockStyles`
 * (fragment wrappers) so the logic stays in one place.
 *
 * `inheritAuto` is set for per-line elements: a paragraph with no explicit
 * direction must resolve its base direction ONCE (on the paragraph wrapper via
 * `dir="auto"`); the individual visual lines then inherit it. Stamping
 * `dir="auto"` on each line would make every wrapped line re-detect from its
 * own first strong character, so an RTL paragraph whose continuation line
 * begins with Latin text would wrongly flip to LTR.
 */
export const applyRtlStyles = (
  element: HTMLElement,
  attrs: ParagraphAttrs | undefined,
  inheritAuto = false,
): boolean => {
  const dir = getParagraphInlineDirection(attrs); // 'rtl' | 'ltr' | undefined
  const rtl = dir === 'rtl';
  if (dir === 'rtl') {
    element.setAttribute('dir', 'rtl');
    element.style.direction = 'rtl';
  } else if (dir === 'ltr') {
    element.setAttribute('dir', 'ltr');
    element.style.direction = 'ltr';
  } else if (inheritAuto) {
    // Line-level: inherit the paragraph wrapper's resolved auto direction
    // rather than independently auto-detecting per visual line.
    element.removeAttribute('dir');
    element.style.direction = '';
  } else {
    // Paragraph wrapper: let the browser detect base direction from content
    // (dir="auto"). An absent dir would inherit the container direction instead.
    element.setAttribute('dir', 'auto');
    element.style.direction = '';
  }
  element.style.textAlign = resolveTextAlign(attrs?.alignment, rtl, dir === undefined);
  return rtl;
};

/**
 * Whether the renderer should use absolute-positioned segment layout for a line.
 *
 * Returns false for RTL paragraphs: the layout engine computes tab X positions
 * in LTR order, so for RTL we fall through to inline-flow rendering where the
 * browser's native bidi algorithm handles tab positioning via dir="rtl".
 */
export const shouldUseSegmentPositioning = (
  hasExplicitPositioning: boolean,
  hasSegments: boolean,
  isRtl: boolean,
): boolean => hasExplicitPositioning && hasSegments && !isRtl;
