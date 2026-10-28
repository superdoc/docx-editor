import type { FillColor, GradientFill, TextEffectColor, TextEffects } from '@superdoc/contracts';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizeCssOffset = (value: number): number => (Math.abs(value) < 1e-10 ? 0 : value);

const TEXT_REFLECTION_CLASS = 'superdoc-text-reflection';

type TextInkBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type TextInkMetrics = TextInkBounds & {
  boxWidth: number;
  boxHeight: number;
};

function cssColor(value: TextEffectColor): string {
  const alpha = value.alpha;
  if (alpha == null || alpha >= 1) return value.color;
  const normalized = value.color.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return value.color;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp01(alpha)})`;
}

function solidFillColor(fill: FillColor): TextEffectColor | null {
  if (typeof fill === 'string') return { color: fill };
  if (fill?.type === 'solidWithAlpha') return { color: fill.color, alpha: fill.alpha };
  return null;
}

function cssGradient(fill: GradientFill): string | null {
  if (fill.stops.length === 0) return null;
  const stops = fill.stops
    .map(
      (stop) =>
        `${cssColor({ color: stop.color, ...(stop.alpha != null ? { alpha: stop.alpha } : {}) })} ${clamp01(stop.position) * 100}%`,
    )
    .join(', ');
  if (fill.gradientType === 'radial') return `radial-gradient(circle, ${stops})`;
  // DrawingML measures clockwise from left-to-right; CSS measures clockwise
  // from bottom-to-top. Therefore 0deg maps to CSS 90deg and DrawingML 90deg
  // (top-to-bottom) maps to CSS 180deg.
  return `linear-gradient(${90 + fill.angle}deg, ${stops})`;
}

function applyFill(element: HTMLElement, fill: FillColor): void {
  if (fill === null) {
    element.style.color = 'transparent';
    return;
  }
  const solid = solidFillColor(fill);
  if (solid) {
    element.style.color = cssColor(solid);
    return;
  }
  if (fill === null || typeof fill === 'string') return;
  if (fill.type !== 'gradient') return;
  const gradient = cssGradient(fill);
  if (!gradient) return;
  element.style.backgroundImage = gradient;
  element.style.setProperty('--sd-text-effect-fill-image', gradient);
  element.style.backgroundClip = 'text';
  element.style.webkitBackgroundClip = 'text';
  element.style.color = 'transparent';
}

export function reflectionDirection(direction: number): 'above' | 'below' | 'left' | 'right' {
  const normalized = ((direction % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) return 'below';
  if (normalized >= 135 && normalized < 225) return 'left';
  if (normalized >= 225 && normalized < 315) return 'above';
  return 'right';
}

function parseCssPixels(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Measure the visible glyph ink independently from the CSS line box.
 *
 * CSS reflections mirror an element's full line box, including font descent
 * and leading. DrawingML reflection geometry is aligned to the text object,
 * so mirroring that extra space creates a visible gap twice its size. Canvas
 * exposes both bounds and lets paint stay metric-neutral while positioning the
 * generated reflection from the actual ink edge.
 */
function measureTextInk(element: HTMLElement): TextInkMetrics | null {
  const text = element.textContent ?? '';
  if (text.length === 0) return null;

  const fontSize = parseCssPixels(element.style.fontSize);
  if (fontSize == null || fontSize <= 0) return null;

  try {
    const context = element.ownerDocument.createElement('canvas').getContext('2d');
    if (!context) return null;

    const fontStyle = element.style.fontStyle || 'normal';
    const fontVariantCaps = element.style.fontVariantCaps || 'normal';
    const fontWeight = element.style.fontWeight || '400';
    const fontFamily = element.style.fontFamily || 'sans-serif';
    context.font = `${fontStyle} ${fontVariantCaps} ${fontWeight} ${fontSize}px ${fontFamily}`;
    const metrics = context.measureText(text);
    const actualAscent = metrics.actualBoundingBoxAscent;
    const actualDescent = metrics.actualBoundingBoxDescent;
    const fontAscent = metrics.fontBoundingBoxAscent;
    const fontDescent = metrics.fontBoundingBoxDescent;
    if (![actualAscent, actualDescent, fontAscent, fontDescent].every(Number.isFinite)) return null;

    const explicitLineHeight = parseCssPixels(element.style.lineHeight);
    const fontBoxHeight = fontAscent + fontDescent;
    const lineHeight = explicitLineHeight ?? fontBoxHeight;
    const leading = Math.max(0, lineHeight - fontBoxHeight);
    const baseline = leading / 2 + fontAscent;
    return {
      left: -metrics.actualBoundingBoxLeft,
      top: baseline - actualAscent,
      right: metrics.actualBoundingBoxRight,
      bottom: baseline + actualDescent,
      // Keep reflection geometry independent from the painted DOM. Canvas
      // advance width and the resolved line height describe the same source
      // box without triggering a layout read during paint.
      boxWidth: metrics.width,
      boxHeight: lineHeight,
    };
  } catch {
    // Some non-browser test DOMs expose canvas without a 2D implementation.
    // Failing closed leaves the authored text visible without inventing
    // reflection geometry.
    return null;
  }
}

export function resolveTextReflectionTransform(
  reflection: NonNullable<TextEffects['reflection']>,
  ink: TextInkBounds,
): { transform: string; maskDirection: 'top' | 'bottom' | 'left' | 'right' } {
  const placement = resolveTextReflectionPlacement(reflection, ink);
  return {
    transform: `translate(${placement.translateX}px, ${placement.translateY}px) scale(${reflection.scaleX}, ${reflection.scaleY})`,
    maskDirection: placement.maskDirection,
  };
}

/**
 * Resolve reflection geometry without choosing a DOM or SVG transform syntax.
 * Both ordinary HTML runs and SVG WordArt use the same DrawingML direction,
 * distance, scale, and ink-edge anchoring contract.
 */
export function resolveTextReflectionPlacement(
  reflection: NonNullable<TextEffects['reflection']>,
  ink: TextInkBounds,
): {
  translateX: number;
  translateY: number;
  maskDirection: 'top' | 'bottom' | 'left' | 'right';
} {
  const radians = (reflection.direction * Math.PI) / 180;
  const offsetX = Math.cos(radians) * reflection.distance;
  const offsetY = Math.sin(radians) * reflection.distance;
  const side = reflectionDirection(reflection.direction);
  const fadeSide = reflectionDirection(reflection.fadeDirection ?? reflection.direction);

  let translateX = offsetX;
  if (reflection.scaleX < 0) {
    const boundaryX = side === 'left' ? ink.left : ink.right;
    translateX += boundaryX - reflection.scaleX * boundaryX;
  }

  let translateY = offsetY;
  if (reflection.scaleY < 0) {
    const boundaryY = side === 'above' ? ink.top : ink.bottom;
    translateY += boundaryY - reflection.scaleY * boundaryY;
  }

  return {
    translateX,
    translateY,
    maskDirection: fadeSide === 'above' ? 'top' : fadeSide === 'below' ? 'bottom' : fadeSide,
  };
}

function cssPixel(value: number): string {
  return `${Math.round(value * 10_000) / 10_000}px`;
}

/** Resolve authored reflection opacity stops against visible glyph ink, not CSS leading. */
export function resolveTextReflectionMask(
  reflection: NonNullable<TextEffects['reflection']>,
  ink: TextInkBounds,
  box: { width: number; height: number },
): string {
  const fadeSide = reflectionDirection(reflection.fadeDirection ?? reflection.direction);
  const outputDirection = fadeSide === 'above' ? 'top' : fadeSide === 'below' ? 'bottom' : fadeSide;
  const sourceDirection =
    reflection.scaleY < 0 && outputDirection === 'bottom'
      ? 'top'
      : reflection.scaleY < 0 && outputDirection === 'top'
        ? 'bottom'
        : reflection.scaleX < 0 && outputDirection === 'right'
          ? 'left'
          : reflection.scaleX < 0 && outputDirection === 'left'
            ? 'right'
            : outputDirection;
  const vertical = sourceDirection === 'top' || sourceDirection === 'bottom';
  const inkExtent = vertical ? Math.max(0, ink.bottom - ink.top) : Math.max(0, ink.right - ink.left);
  const leadingOffset =
    sourceDirection === 'top'
      ? Math.max(0, box.height - ink.bottom)
      : sourceDirection === 'bottom'
        ? Math.max(0, ink.top)
        : sourceDirection === 'left'
          ? Math.max(0, box.width - ink.right)
          : Math.max(0, ink.left);
  const start = leadingOffset + clamp01(reflection.startPosition) * inkExtent;
  const end = leadingOffset + clamp01(reflection.endPosition) * inkExtent;
  return `linear-gradient(to ${sourceDirection}, rgba(0, 0, 0, ${clamp01(reflection.startAlpha)}) ${cssPixel(start)}, rgba(0, 0, 0, ${clamp01(reflection.endAlpha)}) ${cssPixel(end)}, transparent 100%)`;
}

function applyReflection(element: HTMLElement, reflection: NonNullable<TextEffects['reflection']>): void {
  const ink = measureTextInk(element);
  if (!ink) return;

  const placement = resolveTextReflectionTransform(reflection, ink);
  const mask = resolveTextReflectionMask(reflection, ink, {
    width: ink.boxWidth,
    height: ink.boxHeight,
  });

  element.classList.add(TEXT_REFLECTION_CLASS);
  element.dataset.superdocReflectionText = element.textContent ?? '';
  element.style.display = 'inline-block';
  element.style.position = 'relative';
  element.style.setProperty('--sd-text-reflection-transform', placement.transform);
  element.style.setProperty('--sd-text-reflection-mask', mask);
  element.style.setProperty('--sd-text-reflection-blur', `${Math.max(0, reflection.blurRadius)}px`);
}

/** Apply paint-only Word text effects without changing glyph metrics. */
export function applyTextEffects(element: HTMLElement, effects: TextEffects | undefined): void {
  if (!effects) return;

  if (effects.fill !== undefined) applyFill(element, effects.fill);

  const outlineColor = effects.outline ? solidFillColor(effects.outline.fill) : null;
  if (effects.outline && outlineColor && effects.outline.width > 0) {
    element.style.webkitTextStroke = `${effects.outline.width}px ${cssColor(outlineColor)}`;
  }

  const textShadows: string[] = [];
  if (effects.glow && effects.glow.radius > 0) {
    const color = cssColor(effects.glow.color);
    const radius = Math.max(0, effects.glow.radius);
    // Multiple concentric zero-offset shadows approximate Word's radial glow
    // while remaining paint-only and composable with an authored outer shadow.
    textShadows.push(`0px 0px ${radius}px ${color}`, `0px 0px ${radius / 2}px ${color}`);
  }

  if (effects.shadow) {
    const radians = (effects.shadow.direction * Math.PI) / 180;
    const offsetX = normalizeCssOffset(Math.cos(radians) * effects.shadow.distance);
    const offsetY = normalizeCssOffset(Math.sin(radians) * effects.shadow.distance);
    textShadows.push(`${offsetX}px ${offsetY}px ${effects.shadow.blurRadius}px ${cssColor(effects.shadow.color)}`);
  }
  if (textShadows.length > 0) element.style.textShadow = textShadows.join(', ');

  if (effects.reflection) {
    applyReflection(element, effects.reflection);
  }
}
