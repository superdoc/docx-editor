import type { TextRun } from '@superdoc/contracts';
import { normalizeBaselineShift, resolveBaseFontSizeForVerticalText } from '@superdoc/contracts';
import { resolvePhysicalFamily } from '@superdoc/font-system';

export type ResolvePhysicalFont = (
  family: string,
  face: { weight: '400' | '700'; style: 'normal' | 'italic' },
) => string;

/** The same paint-ready typography is consumed by the DOM painter and worker sinks. */
export function resolveRunTypographyStyles(
  run: TextRun,
  resolvePhysical: ResolvePhysicalFont = resolvePhysicalFamily,
): Record<string, string> {
  const styles: Record<string, string> = {
    'font-family': resolvePhysical(run.fontFamily, {
      weight: run.bold ? '700' : '400',
      style: run.italic ? 'italic' : 'normal',
    }),
    'font-size': `${run.fontSize}px`,
    'font-variant-caps': run.smallCaps ? 'small-caps' : 'normal',
    'font-kerning': 'none',
    'font-synthesis': run.smallCaps ? 'weight style small-caps' : 'weight style',
  };
  if (run.bold) styles['font-weight'] = 'bold';
  if (run.italic) styles['font-style'] = 'italic';
  if (run.letterSpacing != null) styles['letter-spacing'] = `${run.letterSpacing}px`;
  if (
    run.horizontalScale != null &&
    Number.isFinite(run.horizontalScale) &&
    run.horizontalScale >= 0 &&
    run.horizontalScale !== 1
  ) {
    styles.display = 'inline-block';
    styles.transform = `scaleX(${run.horizontalScale})`;
    styles['transform-origin'] = run.bidi?.rtl ? 'right center' : 'left center';
  }
  const shift = normalizeBaselineShift(run.baselineShift);
  if (shift != null || run.vertAlign === 'superscript' || run.vertAlign === 'subscript') styles['line-height'] = '1';
  if (shift != null) styles['vertical-align'] = `${shift}pt`;
  else if (run.vertAlign === 'superscript')
    styles['vertical-align'] = `${resolveBaseFontSizeForVerticalText(run.fontSize, run) * 0.33}px`;
  else if (run.vertAlign === 'subscript')
    styles['vertical-align'] = `${-resolveBaseFontSizeForVerticalText(run.fontSize, run) * 0.14}px`;
  else if (run.vertAlign === 'baseline') styles['vertical-align'] = 'baseline';
  return styles;
}

export const underlineThicknessPx = (fontSize: number): number => Math.max(1, Math.round(fontSize / 14));

export function resolveRunDecorationStyles(run: TextRun): Record<string, string> {
  const styles: Record<string, string> = {};
  const decorations: string[] = [];
  if (run.underline) {
    decorations.push('underline');
    styles['text-decoration-style'] =
      run.underline.style && run.underline.style !== 'single' ? run.underline.style : 'solid';
    styles['text-decoration-thickness'] = `${underlineThicknessPx(run.fontSize)}px`;
    if (run.underline.color) styles['text-decoration-color'] = run.underline.color;
  }
  if (run.strike) decorations.push('line-through');
  if (decorations.length) styles['text-decoration-line'] = decorations.join(' ');
  return styles;
}
