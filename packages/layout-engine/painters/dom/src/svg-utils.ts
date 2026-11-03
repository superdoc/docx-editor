/**
 * Shared utility functions for SVG shape rendering
 * Shared with the layout-engine rendering pipeline.
 */

import type { GradientFill, GradientStop, SolidFillWithAlpha } from '@superdoc/contracts';

/**
 * Validates and sanitizes a hex color string to prevent XSS attacks.
 *
 * Accepts hex colors in the following formats:
 * - 3-digit hex: #RGB (e.g., #F00)
 * - 6-digit hex: #RRGGBB (e.g., #FF0000)
 * - 3-digit hex without #: RGB (e.g., F00)
 * - 6-digit hex without #: RRGGBB (e.g., FF0000)
 *
 * @param color - The color string to validate
 * @returns The validated and normalized hex color with # prefix, or undefined if invalid
 *
 * @example
 * ```typescript
 * validateHexColor('#FF0000'); // '#FF0000'
 * validateHexColor('FF0000'); // '#FF0000'
 * validateHexColor('#F00'); // '#F00'
 * validateHexColor('F00'); // '#F00'
 * validateHexColor('javascript:alert(1)'); // undefined (XSS attempt)
 * validateHexColor('#GGGGGG'); // undefined (invalid hex)
 * validateHexColor('red'); // undefined (named colors not supported)
 * ```
 */
export function validateHexColor(color: string): string | undefined {
  if (typeof color !== 'string') return undefined;

  const trimmed = color.trim();
  if (!trimmed) return undefined;

  // Remove # prefix if present
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;

  // Validate hex format: exactly 3 or 6 hexadecimal characters
  const hexPattern = /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/;
  if (!hexPattern.test(withoutHash)) {
    return undefined;
  }

  // Return normalized color with # prefix
  return `#${withoutHash}`;
}

/**
 * Validates and adds gradient stops to an SVG gradient element.
 *
 * Validates each stop's position (clamped to 0-1), color (hex format), and alpha (clamped to 0-1).
 * Skips stops with invalid colors to prevent XSS attacks.
 *
 * @param gradient - The SVG gradient element to add stops to
 * @param stops - Array of gradient stops to validate and add
 *
 * @example
 * ```typescript
 * const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
 * addValidatedGradientStops(gradient, [
 *   { position: 0, color: '#FF0000', alpha: 1 },
 *   { position: 1, color: '#0000FF', alpha: 0.5 }
 * ]);
 * ```
 */
function addValidatedGradientStops(
  gradient: SVGLinearGradientElement | SVGRadialGradientElement,
  stops: GradientStop[],
): void {
  stops.forEach((stop: GradientStop) => {
    // Validate and clamp position to 0-1 range
    const position =
      typeof stop.position === 'number' && Number.isFinite(stop.position) ? Math.max(0, Math.min(1, stop.position)) : 0;

    // Validate color format to prevent XSS
    const validatedColor = validateHexColor(stop.color);
    if (!validatedColor) {
      // Skip invalid color stops
      return;
    }

    // Validate and clamp alpha to 0-1 range
    const alpha =
      typeof stop.alpha === 'number' && Number.isFinite(stop.alpha) ? Math.max(0, Math.min(1, stop.alpha)) : 1;

    const stopElement = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stopElement.setAttribute('offset', `${position * 100}%`);
    stopElement.setAttribute('stop-color', validatedColor);
    if (alpha < 1) {
      stopElement.setAttribute('stop-opacity', alpha.toString());
    }
    gradient.appendChild(stopElement);
  });
}

/**
 * Creates an SVG gradient element (linear or radial)
 */
export function createGradient(
  gradientData: GradientFill,
  gradientId: string,
): SVGLinearGradientElement | SVGRadialGradientElement | null {
  const { gradientType, stops, angle } = gradientData;

  // Ensure we have stops
  if (!stops || stops.length === 0) {
    return null;
  }

  let gradient: SVGLinearGradientElement | SVGRadialGradientElement;

  if (gradientType === 'linear') {
    gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', gradientId);

    // DrawingML measures the color-change vector clockwise: 0deg travels
    // left-to-right and 90deg travels top-to-bottom in the page coordinate
    // system (ECMA-376-1 20.1.8.41).
    const radians = (angle * Math.PI) / 180;
    const x1 = 50 - 50 * Math.cos(radians);
    const y1 = 50 - 50 * Math.sin(radians);
    const x2 = 50 + 50 * Math.cos(radians);
    const y2 = 50 + 50 * Math.sin(radians);

    gradient.setAttribute('x1', `${x1}%`);
    gradient.setAttribute('y1', `${y1}%`);
    gradient.setAttribute('x2', `${x2}%`);
    gradient.setAttribute('y2', `${y2}%`);
  } else {
    gradient = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('cx', '50%');
    gradient.setAttribute('cy', '50%');
    gradient.setAttribute('r', '50%');
  }

  // Add validated gradient stops
  addValidatedGradientStops(gradient, stops);

  return gradient;
}

/**
 * Applies a gradient to all filled elements in an SVG.
 *
 * Creates a gradient definition using the provided gradient data and applies it
 * to all filled elements in the SVG. Uses the shared createGradient utility to
 * ensure consistent gradient creation with validation.
 *
 * Gracefully handles DOM errors to prevent crashes.
 *
 * @param svg - The SVG element to apply the gradient to
 * @param gradientData - The gradient fill configuration
 *
 * @example
 * ```typescript
 * const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 * applyGradientToSVG(svg, {
 *   type: 'gradient',
 *   gradientType: 'linear',
 *   angle: 90,
 *   stops: [
 *     { position: 0, color: '#FF0000', alpha: 1 },
 *     { position: 1, color: '#0000FF', alpha: 1 }
 *   ]
 * });
 * ```
 */
export function applyGradientToSVG(svg: SVGElement, gradientData: GradientFill): void {
  try {
    // Generate unique gradient ID
    const gradientId = generateGradientId('gradient');

    // Create gradient element using shared utility
    const gradient = createGradient(gradientData, gradientId);
    if (!gradient) {
      // No valid gradient could be created (e.g., no stops)
      return;
    }

    // Create defs if it doesn't exist
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }

    defs.appendChild(gradient);

    // Apply gradient to all filled elements
    const filledElements = svg.querySelectorAll('[fill]:not([fill="none"])');
    filledElements.forEach((el) => {
      el.setAttribute('fill', `url(#${gradientId})`);
    });
  } catch (error) {
    // Gracefully handle DOM manipulation errors
    console.error('Failed to apply gradient to SVG:', error);
  }
}

/**
 * Applies alpha transparency to all filled elements in an SVG.
 *
 * Validates the color format before applying to prevent XSS attacks.
 * Clamps alpha value to the 0-1 range.
 * Gracefully handles DOM errors to prevent crashes.
 *
 * @param svg - The SVG element to apply the fill to
 * @param alphaData - The solid fill with alpha configuration
 *
 * @example
 * ```typescript
 * const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 * applyAlphaToSVG(svg, { type: 'solidWithAlpha', color: '#FF0000', alpha: 0.5 });
 * ```
 */
export function applyAlphaToSVG(svg: SVGElement, alphaData: SolidFillWithAlpha): void {
  try {
    const { color, alpha } = alphaData;

    // Validate color format to prevent XSS
    const validatedColor = validateHexColor(color);
    if (!validatedColor) {
      // Skip if color is invalid
      return;
    }

    // Validate and clamp alpha to 0-1 range
    const clampedAlpha = typeof alpha === 'number' && Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;

    // Apply color with opacity to all filled elements
    const filledElements = svg.querySelectorAll('[fill]:not([fill="none"])');
    filledElements.forEach((el) => {
      el.setAttribute('fill', validatedColor);
      el.setAttribute('fill-opacity', clampedAlpha.toString());
    });
  } catch (error) {
    // Gracefully handle DOM manipulation errors
    console.error('Failed to apply alpha to SVG:', error);
  }
}

/**
 * Counter for ensuring unique gradient IDs even when generated in the same millisecond.
 * Prevents ID collisions during rapid gradient creation.
 */
let gradientIdCounter = 0;

/**
 * Generates a unique gradient ID with optional prefix.
 *
 * Uses a combination of timestamp, counter, and random string to ensure uniqueness
 * even when multiple gradients are created in the same millisecond.
 *
 * @param prefix - Optional prefix for the gradient ID (defaults to 'gradient')
 * @returns A unique gradient ID string
 *
 * @example
 * ```typescript
 * generateGradientId(); // 'gradient-1700000000000-0-abc123def'
 * generateGradientId('linear'); // 'linear-1700000000000-1-xyz789ghi'
 * ```
 */
export function generateGradientId(prefix: string = 'gradient'): string {
  return `${prefix}-${Date.now()}-${gradientIdCounter++}-${Math.random().toString(36).substring(2, 11)}`;
}
