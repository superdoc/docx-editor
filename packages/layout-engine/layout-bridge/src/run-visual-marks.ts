import type { Run } from '@superdoc/contracts';

/**
 * Builds a deterministic substring for measure-cache keys and dirty-run comparison.
 *
 * Include every run property that affects text measurement or painted output but is not
 * covered elsewhere (e.g. tracked-change / comment keys). When adding a new visual
 * property, update this function only — `cache.ts` and `diff.ts` both depend on it.
 * Paragraph-scoped inline boxes are deliberately keyed by `inline-box-key.ts`,
 * not by this run-scoped helper.
 *
 * @param run - Flow run (text, tab, image, etc.); unknown fields are ignored safely.
 * @returns Stable string encoding every visual mark listed in the body below.
 */
export const hashRunVisualMarks = (run: Run): string => {
  const bold = 'bold' in run ? run.bold : false;
  const italic = 'italic' in run ? run.italic : false;
  const underline = 'underline' in run ? run.underline : undefined;
  const strike = 'strike' in run ? run.strike : false;
  const color = 'color' in run ? run.color : undefined;
  const fontSize = 'fontSize' in run ? run.fontSize : undefined;
  const fontFamily = 'fontFamily' in run ? run.fontFamily : undefined;
  const highlight = 'highlight' in run ? run.highlight : undefined;
  const link = 'link' in run ? run.link : undefined;
  const textTransform = 'textTransform' in run ? run.textTransform : undefined;
  const vanish = 'vanish' in run ? run.vanish : undefined;
  const horizontalScale = 'horizontalScale' in run ? run.horizontalScale : undefined;
  // SD-3098: DomPainter now reads `bidi.rtl` to apply dir="rtl"/dir="ltr" and the
  // RLM separator injection for date-like tokens. Include it here so dirty-run
  // detection picks up rtl-only changes; otherwise an edit that flips just
  // <w:rtl/> could reuse stale measure/DOM.
  const bidi = 'bidi' in run ? run.bidi : undefined;
  // The Word 97-2003 effect flags and the double strikethrough. Paint-only, but
  // dirty-run detection is what decides whether the painted DOM is reused: an
  // edit that flips just `<w:emboss/>` would otherwise keep the old span.
  const doubleStrike = 'doubleStrike' in run ? run.doubleStrike : false;
  const outline = 'outline' in run ? run.outline : false;
  const shadow = 'shadow' in run ? run.shadow : false;
  const emboss = 'emboss' in run ? run.emboss : false;
  const imprint = 'imprint' in run ? run.imprint : false;

  return [
    bold ? 'b' : '',
    italic ? 'i' : '',
    underline ? `u:${JSON.stringify(underline)}` : '',
    strike ? 's' : '',
    doubleStrike ? 'ds' : '',
    outline ? 'ol' : '',
    shadow ? 'sh' : '',
    emboss ? 'em' : '',
    imprint ? 'im' : '',
    color ?? '',
    fontSize !== undefined ? `fs:${fontSize}` : '',
    fontFamily ? `ff:${fontFamily}` : '',
    highlight ? `hl:${highlight}` : '',
    link ? `ln:${JSON.stringify(link)}` : '',
    textTransform ? `tt:${textTransform}` : '',
    vanish ? 'v:1' : '',
    horizontalScale != null ? `hs:${horizontalScale}` : '',
    bidi ? `bd:${JSON.stringify(bidi)}` : '',
  ].join('');
};
