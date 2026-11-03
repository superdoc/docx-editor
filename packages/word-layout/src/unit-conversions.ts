/**
 * Shared unit conversion helpers (twips, pixels, points).
 *
 * Word stores most layout values in twips (1/20th of a point). We convert
 * to/from CSS pixels to keep the pipeline consistent across DOM, canvas,
 * and PDF renderers.
 */

export const TWIPS_PER_INCH = 1440;
export const PIXELS_PER_INCH = 96;

export const TWIPS_PER_POINT = 20;
export const POINTS_PER_TWIP = 1 / TWIPS_PER_POINT;

export const TWIPS_PER_PIXEL = Math.round(TWIPS_PER_INCH / PIXELS_PER_INCH); // 15
export const PIXELS_PER_TWIP = 1 / TWIPS_PER_PIXEL;

/**
 * Validates and converts a value to a finite number.
 *
 * This helper ensures that conversion functions handle invalid inputs
 * consistently by filtering out null, undefined, NaN, and Infinity values.
 *
 * @param value - The value to validate and convert
 * @returns The validated number if finite, otherwise null
 * @internal
 */
const toFiniteNumber = (value?: number | null): number | null => {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Converts CSS pixels to twips (twentieths of a point).
 *
 * Word documents store most measurements in twips, while web rendering uses pixels.
 * This function performs the conversion with proper rounding to maintain precision.
 * Invalid inputs (null, undefined, NaN, Infinity) return 0.
 *
 * @param px - The value in CSS pixels to convert. May be null or undefined.
 * @returns The equivalent value in twips, or 0 if input is invalid
 *
 * @example
 * ```typescript
 * pixelsToTwips(96);  // 1440 (1 inch = 96px = 1440 twips)
 * pixelsToTwips(24);  // 360
 * pixelsToTwips(null); // 0
 * pixelsToTwips(NaN);  // 0
 * ```
 */
export const pixelsToTwips = (px?: number | null): number => {
  const numeric = toFiniteNumber(px);
  if (numeric == null) return 0;
  return Math.round(numeric * TWIPS_PER_PIXEL);
};

/**
 * Converts twips (twentieths of a point) to CSS pixels.
 *
 * This is the inverse of pixelsToTwips. Invalid inputs return 0.
 *
 * @param twips - The value in twips to convert. May be null or undefined.
 * @returns The equivalent value in CSS pixels, or 0 if input is invalid
 *
 * @example
 * ```typescript
 * twipsToPixels(1440); // 96 (1 inch)
 * twipsToPixels(720);  // 48 (half inch)
 * twipsToPixels(null); // 0
 * ```
 */
export const twipsToPixels = (twips?: number | null): number => {
  const numeric = toFiniteNumber(twips);
  if (numeric == null) return 0;
  return numeric * PIXELS_PER_TWIP;
};

/**
 * Converts points to twips (twentieths of a point).
 *
 * Points are a standard typographic unit (72 points = 1 inch).
 * This function converts them to twips for Word document storage.
 * Invalid inputs (null, undefined, NaN, Infinity) return 0.
 *
 * @param points - The value in points to convert. May be null or undefined.
 * @returns The equivalent value in twips, or 0 if input is invalid
 *
 * @example
 * ```typescript
 * pointsToTwips(72);   // 1440 (1 inch = 72 points = 1440 twips)
 * pointsToTwips(12);   // 240
 * pointsToTwips(null); // 0
 * ```
 */
export const pointsToTwips = (points?: number | null): number => {
  const numeric = toFiniteNumber(points);
  if (numeric == null) return 0;
  return numeric * TWIPS_PER_POINT;
};

/**
 * Converts twips (twentieths of a point) to points.
 *
 * This is the inverse of pointsToTwips. Points are a standard typographic
 * unit where 72 points equals 1 inch. Invalid inputs return 0.
 *
 * @param twips - The value in twips to convert. May be null or undefined.
 * @returns The equivalent value in points, or 0 if input is invalid
 *
 * @example
 * ```typescript
 * twipsToPoints(1440); // 72 (1 inch)
 * twipsToPoints(240);  // 12
 * twipsToPoints(null); // 0
 * ```
 */
export const twipsToPoints = (twips?: number | null): number => {
  const numeric = toFiniteNumber(twips);
  if (numeric == null) return 0;
  return numeric * POINTS_PER_TWIP;
};

/**
 * Converts half-points to points.
 *
 * Word documents sometimes store measurements in half-points for finer
 * granularity. This function converts them to standard points by dividing by 2.
 * Invalid inputs (null, undefined, NaN, Infinity) return 0.
 *
 * @param halfPoints - The value in half-points to convert. May be null or undefined.
 * @returns The equivalent value in points, or 0 if input is invalid
 *
 * @example
 * ```typescript
 * halfPointsToPoints(24); // 12
 * halfPointsToPoints(5);  // 2.5
 * halfPointsToPoints(null); // 0
 * ```
 */
export const halfPointsToPoints = (halfPoints?: number | null): number => {
  const numeric = toFiniteNumber(halfPoints);
  if (numeric == null) return 0;
  return numeric / 2;
};

/**
 * Converts points to half-points.
 *
 * This is the inverse of halfPointsToPoints. Half-points provide finer
 * granularity for measurements in Word documents (2 half-points = 1 point).
 * Invalid inputs (null, undefined, NaN, Infinity) return 0.
 *
 * @param points - The value in points to convert. May be null or undefined.
 * @returns The equivalent value in half-points, or 0 if input is invalid
 *
 * @example
 * ```typescript
 * pointsToHalfPoints(12);   // 24
 * pointsToHalfPoints(2.5);  // 5
 * pointsToHalfPoints(null); // 0
 * ```
 */
export const pointsToHalfPoints = (points?: number | null): number => {
  const numeric = toFiniteNumber(points);
  if (numeric == null) return 0;
  return numeric * 2;
};
