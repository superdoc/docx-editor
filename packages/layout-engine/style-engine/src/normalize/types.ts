/**
 * Editor-neutral run/paragraph attribute output types for the normalize layer.
 *
 * These mirror the visual subset of `@superdoc/contracts` `TextRun` and
 * `ParagraphAttrs` that the v2 adapter can safely emit from resolved OOXML
 * properties. Defining them here (style-engine, editor-neutral) lets both
 * v1 pm-adapter and v2 review-layout-adapter consume one canonical typed
 * shape without depending on each other.
 */

import type { ParagraphAttrs, TextRun } from '@superdoc/contracts';

/**
 * Visual text-run style attributes the adapter is allowed to emit safely.
 * This is the **partial** typed shape — every field is optional because
 * the resolver may only know a subset and must not invent defaults.
 *
 * Caller responsibility:
 * - `fontFamily` / `fontSize` are visual defaults; only emit when resolved.
 * - Run text is always built with a non-empty `fontFamily` and a positive
 *   `fontSize` at the projection layer; partial attrs only override.
 */
export interface TextRunStyleAttrs {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: NonNullable<TextRun['underline']>;
  strike?: boolean;
  doubleStrike?: boolean;
  outline?: boolean;
  shadow?: boolean;
  emboss?: boolean;
  imprint?: boolean;
  color?: string;
  highlight?: string;
  textTransform?: TextRun['textTransform'];
  allCaps?: boolean;
  smallCaps?: boolean;
  vertAlign?: TextRun['vertAlign'];
  baselineShift?: number;
  letterSpacing?: number;
  horizontalScale?: number;
  script?: TextRun['script'];
  vanish?: boolean;
  specVanish?: boolean;
  noProof?: boolean;
  bidi?: NonNullable<TextRun['bidi']>;
}

/** Re-export so v2 adapter can consume one paragraph attrs type. */
export type { ParagraphAttrs };
