import type { Line, LineSegment, Run } from '@superdoc/contracts';
import { underlineThicknessPx } from './text-run.js';

type UnderlinePaintRun = {
  underline?: {
    style?: string;
    color?: string;
  } | null;
  fontSize?: number;
  color?: string;
};

type UnderlineSource = Run | UnderlinePaintRun;

const getRunUnderline = (run: UnderlineSource): UnderlinePaintRun['underline'] =>
  'underline' in run ? (run.underline as UnderlinePaintRun['underline']) : undefined;

const getRunFontSize = (run: UnderlineSource): number =>
  'fontSize' in run && typeof run.fontSize === 'number' ? run.fontSize : 16;

const getRunColor = (run: UnderlineSource): string | undefined =>
  'color' in run && typeof run.color === 'string' ? run.color : undefined;

const isVanishedRun = (run: UnderlineSource): boolean => 'vanish' in run && run.vanish === true;

export const underlineStyleForRun = (run: UnderlineSource): string | undefined =>
  getRunUnderline(run)?.style ?? 'single';

export const canPaintUnderlineAsBorder = (run: UnderlineSource): boolean => {
  if (isVanishedRun(run)) return false;
  if (!getRunUnderline(run)) return false;
  const style = underlineStyleForRun(run);
  return style !== 'none' && style !== 'words';
};

/**
 * Whether the line-level underline overlay may own this run's underline (SD-3330).
 *
 * Scoped to the styles a single CSS `border-top` reproduces faithfully: `single`, `double`,
 * `dotted`, `dashed`. Everything else stays on its existing path on purpose, so the overlay
 * never silently flattens a distinct style into solid inside a "continuous" line:
 * - `none` paints nothing (rejected by canPaintUnderlineAsBorder);
 * - `wave`, `thick`, and the OOXML heavy/compound spellings (`dotDash`, `dashLongHeavy`, ...) a
 *   border-top cannot draw - they keep their current (degraded) per-run rendering.
 *
 * `words` is NOT solved end-to-end here. canPaintUnderlineAsBorder rejects a literal `words`, but
 * the v1 adapter's normalizeUnderlineStyle collapses OOXML `words` to `single` BEFORE paint, so a
 * `words` underline reaches this layer as `single` and gets overlaid - it does not reproduce Word's
 * "underline the words, not the tab whitespace". Fixing that needs an importer/adapter change and is
 * out of scope for the seam fix; the guard here is only defensive for a producer that passes `words` raw.
 *
 * Color is a separate axis: this gate is style-only, and underlineBorderForRun does not resolve
 * theme/`auto` underline colors (it uses the literal color string, as the prior border path did),
 * so theme-color fidelity is out of scope here too.
 *
 * Mixed lines stay per-run: a single-underlined tab can be overlaid while an adjacent wavy run
 * keeps its native text-decoration.
 */
export const canPaintUnderlineOverlay = (run: UnderlineSource): boolean => {
  if (!canPaintUnderlineAsBorder(run)) return false;
  const style = underlineStyleForRun(run);
  return style === 'single' || style === 'double' || style === 'dotted' || style === 'dashed';
};

export const underlineBorderForRun = (run: UnderlineSource): string | undefined => {
  if (!canPaintUnderlineAsBorder(run)) return undefined;

  const underlineStyle = underlineStyleForRun(run);
  const borderStyle =
    underlineStyle === 'double' || underlineStyle === 'dotted' || underlineStyle === 'dashed'
      ? underlineStyle
      : 'solid';
  const underlineColor = getRunUnderline(run)?.color ?? getRunColor(run) ?? '#000000';
  const fontSize = getRunFontSize(run);
  return `${underlineThicknessPx(fontSize)}px ${borderStyle} ${underlineColor}`;
};

export const renderInlineTabRun = (
  run: Extract<Run, { kind: 'tab' }>,
  line: Line,
  doc: Document,
  layoutEpoch: number,
  styleId?: string,
  paintUnderline = true,
  /**
   * Measured tab width in pixels, pre-resolved by the caller from Line.tabWidths
   * keyed by block.runs index. Preferred over run.width because it survives
   * FlowBlock re-projection that creates fresh run objects (run.width not re-set).
   */
  tabWidthFromCache?: number,
): HTMLElement => {
  const tabEl = doc.createElement('span');
  tabEl.classList.add('superdoc-tab');

  if (run.vanish === true) {
    tabEl.setAttribute('aria-hidden', 'true');
    tabEl.style.display = 'inline-block';
    tabEl.style.width = '0px';
    tabEl.style.height = '0px';
    tabEl.style.overflow = 'hidden';
    if (styleId) {
      tabEl.setAttribute('styleid', styleId);
    }
    if (run.pmStart != null) tabEl.dataset.pmStart = String(run.pmStart);
    if (run.pmEnd != null) tabEl.dataset.pmEnd = String(run.pmEnd);
    tabEl.dataset.layoutEpoch = String(layoutEpoch);
    return tabEl;
  }

  const tabWidth = tabWidthFromCache ?? run.width ?? 48;

  tabEl.style.display = 'inline-block';
  tabEl.style.width = `${tabWidth}px`;
  const shouldPaintUnderline = paintUnderline && canPaintUnderlineAsBorder(run);
  if (shouldPaintUnderline) {
    // Underlined tabs render the underline as a border-bottom (the tab has no glyphs to
    // carry a text-decoration, and a transparent-filler text-decoration would become
    // selectable content and break line selection). A full-height, bottom-aligned box
    // would put the border ~descent+half-leading below the text-decoration underline of
    // adjacent text and look broken (SD-3330), so the box ends at the computed underline
    // offset with its top pinned to the line-box top, landing the border at the baseline.
    tabEl.style.height = `${underlineOffsetFromLineTop(line, getRunFontSize(run))}px`;
    tabEl.style.verticalAlign = 'top';
  } else {
    tabEl.style.height = `${line.lineHeight}px`;
    tabEl.style.verticalAlign = 'bottom';
  }

  if (shouldPaintUnderline) {
    applyTabUnderlineBorder(tabEl, run);
  }

  if (styleId) {
    tabEl.setAttribute('styleid', styleId);
  }
  if (run.pmStart != null) tabEl.dataset.pmStart = String(run.pmStart);
  if (run.pmEnd != null) tabEl.dataset.pmEnd = String(run.pmEnd);
  tabEl.dataset.layoutEpoch = String(layoutEpoch);

  return tabEl;
};

export const renderPositionedTabRun = (
  run: Extract<Run, { kind: 'tab' }>,
  line: Line,
  doc: Document,
  layoutEpoch: number,
  tabStartX: number,
  indentOffset: number,
  immediateNextSegment?: LineSegment,
  styleId?: string,
  paintUnderline = true,
  tabWidthFromCache?: number,
): { element: HTMLElement; tabEndX: number; actualTabWidth: number } => {
  if (run.vanish === true) {
    const tabEl = doc.createElement('span');
    tabEl.classList.add('superdoc-tab');
    tabEl.setAttribute('aria-hidden', 'true');
    tabEl.style.position = 'absolute';
    tabEl.style.left = `${tabStartX + indentOffset}px`;
    tabEl.style.top = '0px';
    tabEl.style.width = '0px';
    tabEl.style.height = '0px';
    tabEl.style.overflow = 'hidden';
    tabEl.style.pointerEvents = 'none';
    if (styleId) {
      tabEl.setAttribute('styleid', styleId);
    }
    if (run.pmStart != null) tabEl.dataset.pmStart = String(run.pmStart);
    if (run.pmEnd != null) tabEl.dataset.pmEnd = String(run.pmEnd);
    tabEl.dataset.layoutEpoch = String(layoutEpoch);
    return { element: tabEl, tabEndX: tabStartX, actualTabWidth: 0 };
  }

  // The tab should span from where previous content ended to where next content begins.
  // If layout supplied a tab-end boundary for the next segment, prefer it.
  // Otherwise, use the next segment's explicit X (from tab alignment) or the
  // tab's measured width.
  const measuredTabEndX = tabStartX + (tabWidthFromCache ?? run.width ?? 0);
  const tabEndX = immediateNextSegment?.precedingTabEndX ?? immediateNextSegment?.x ?? measuredTabEndX;
  const actualTabWidth = tabEndX - tabStartX;

  const tabEl = doc.createElement('span');
  tabEl.classList.add('superdoc-tab');
  tabEl.style.position = 'absolute';
  tabEl.style.left = `${tabStartX + indentOffset}px`;
  tabEl.style.top = '0px';
  tabEl.style.width = `${actualTabWidth}px`;
  // Underlined positioned tabs use the same computed offset as inline tabs, while
  // non-underlined positioned tabs keep the full line height and are hidden below.
  const shouldPaintUnderline = paintUnderline && canPaintUnderlineAsBorder(run);
  tabEl.style.height = shouldPaintUnderline
    ? `${underlineOffsetFromLineTop(line, getRunFontSize(run))}px`
    : `${line.lineHeight}px`;
  tabEl.style.display = 'inline-block';
  tabEl.style.pointerEvents = 'none';
  tabEl.style.zIndex = '1';

  if (shouldPaintUnderline) {
    applyTabUnderlineBorder(tabEl, run);
  } else {
    tabEl.style.visibility = 'hidden';
  }

  if (styleId) {
    tabEl.setAttribute('styleid', styleId);
  }
  if (run.pmStart != null) tabEl.dataset.pmStart = String(run.pmStart);
  if (run.pmEnd != null) tabEl.dataset.pmEnd = String(run.pmEnd);
  tabEl.dataset.layoutEpoch = String(layoutEpoch);

  return { element: tabEl, tabEndX, actualTabWidth };
};

/**
 * Distance, in pixels from the top of the line box, at which a tab's underline
 * (border-bottom) should be drawn so it lines up with the `text-decoration`
 * underline of adjacent text runs.
 *
 * The line box places the baseline at `half-leading + ascent` from its top
 * (the remaining `half-leading + descent` sits below). `text-decoration`
 * underlines render slightly below the baseline, so we add a small gap that
 * scales with font size (capped by the descent). This is geometry derived from
 * the resolved line metrics. The painter never measures the DOM (SD-2957).
 */
export const underlineOffsetFromLineTop = (line: Line, fallbackFontSize = 16): number => {
  // Fast remeasurement retains line height but intentionally omits ascent and descent.
  // Its zero pair is missing data, not a baseline at the center of the line box.
  const missingMetrics = line.ascent === 0 && line.descent === 0;
  const fontSize = Number.isFinite(fallbackFontSize) && fallbackFontSize > 0 ? fallbackFontSize : 16;
  const ascent = missingMetrics ? fontSize * 0.8 : line.ascent;
  const descent = missingMetrics ? fontSize * 0.2 : line.descent;
  const halfLeading = Math.max(0, (line.lineHeight - ascent - descent) / 2);
  const baselineFromTop = halfLeading + ascent;
  const underlineGap = Math.min(descent, line.lineHeight * 0.08);
  return baselineFromTop + underlineGap;
};

/**
 * Underlined tabs (signature / fill-in lines) draw the underline as a border-bottom. The
 * tab has no glyphs to carry a text-decoration, so the weight is matched to adjacent text
 * by using the same font-scaled thickness text runs apply via text-decoration-thickness
 * (underlineThicknessPx), giving a uniform line across text and tabs (SD-3330). The run
 * carries the font size even though the rendered span sets none. An explicit color is used
 * (not currentColor) because the tab has no visible text to inherit a color from.
 */
const applyTabUnderlineBorder = (tabEl: HTMLElement, run: Extract<Run, { kind: 'tab' }>): void => {
  const border = underlineBorderForRun(run);
  if (!border) return;
  tabEl.style.borderBottom = border;
};
