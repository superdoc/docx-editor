/**
 * Editor-neutral paragraph-attribute normalization.
 *
 * Maps the typed style-engine `ParagraphProperties` into the visual subset
 * of `@superdoc/contracts` `ParagraphAttrs` that the v2 review adapter is
 * allowed to emit from resolved properties alone.
 *
 * Out of scope by design:
 *  - list-marker / wordLayout layout (owned by the numbering-marker resolver)
 *  - drop-cap PM-node traversal (out of scope here, lives in pm-adapter)
 *
 * The mapping is intentionally narrow: features the resolver cannot
 * faithfully emit without extra context (numbering markers, drop caps,
 * cell direction context) are NOT inferred here — they remain pm-adapter
 * or downstream concerns.
 *
 * Paragraph indent is the main exception: the shared layout contract is still
 * V1-shaped for RTL paragraphs, so we emit the legacy visual carrier here
 * instead of leaving a logical `w:ind` shape for the painter.
 */

import type {
  BorderProperties,
  ParagraphBorders,
  ParagraphFrameProperties,
  ParagraphProperties,
  ParagraphSpacing as OoxmlParagraphSpacing,
  ParagraphTabStop,
  ShadingProperties,
} from '../ooxml/types.js';
import type {
  ParagraphAttrs,
  ParagraphBorder,
  ParagraphBorders as LayoutParagraphBorders,
  ParagraphFrame,
  ParagraphIndent,
  ParagraphShading,
  ParagraphSpacing as LayoutParagraphSpacing,
} from '@superdoc/contracts';
import { twipsToPx } from './units.js';
import { normalizeHexColor } from './colors.js';

const AUTO_SPACING_LINE_DEFAULT = 240;
const AUTO_PARAGRAPH_SPACING_MULTIPLIER = 1.15;

export function normalizeParagraphAttrsFromOoxml(
  props: ParagraphProperties | null | undefined,
): Partial<ParagraphAttrs> {
  if (!props) return {};
  const attrs: Partial<ParagraphAttrs> = {};
  if (props.textDirection != null) attrs.textDirection = props.textDirection;

  if (props.styleId) attrs.styleId = String(props.styleId);

  const alignment = mapAlignment(props.justification, props.rightToLeft === true);
  if (alignment) attrs.alignment = alignment;

  const spacing = mapSpacing(props.spacing, props.numberingProperties != null);
  if (spacing) attrs.spacing = spacing;

  const indent = mapIndent(props);
  if (indent) attrs.indent = indent;

  const directionContext = mapDirectionContext(props);
  if (directionContext) attrs.directionContext = directionContext;

  if (props.keepNext) attrs.keepNext = true;
  if (props.keepLines) attrs.keepLines = true;
  if (props.widowControl != null) attrs.widowControl = props.widowControl;
  if (props.pageBreakBefore) attrs.pageBreakBefore = true;
  if (props.contextualSpacing) attrs.contextualSpacing = true;
  if (props.runProperties?.vanish === true) {
    attrs.suppressParagraphBreak = true;
  }
  if (
    typeof props.outlineLvl === 'number' &&
    Number.isInteger(props.outlineLvl) &&
    props.outlineLvl >= 0 &&
    props.outlineLvl < 9
  ) {
    attrs.headingLevel = props.outlineLvl + 1;
  }

  const borders = mapParagraphBorders(props.borders);
  if (borders) attrs.borders = borders;

  const shading = mapParagraphShading(props.shading);
  if (shading) attrs.shading = shading;

  const tabs = mapTabStops(props.tabStops);
  if (tabs && tabs.length > 0) attrs.tabs = tabs;

  const frame = mapFrame(props.framePr);
  if (frame) attrs.frame = frame;

  if (props.numberingProperties && props.numberingProperties.numId !== 0) {
    attrs.numberingProperties = {
      ...(props.numberingProperties.numId != null ? { numId: props.numberingProperties.numId } : {}),
      ...(props.numberingProperties.ilvl != null ? { ilvl: props.numberingProperties.ilvl } : {}),
    };
  }

  return attrs;
}

function mapDirectionContext(props: ParagraphProperties): ParagraphAttrs['directionContext'] | undefined {
  if (props.rightToLeft !== true) return undefined;
  return {
    inlineDirection: 'rtl',
    writingMode: 'horizontal-tb',
  };
}

function mapAlignment(value: string | undefined, isRightToLeft: boolean): ParagraphAttrs['alignment'] | undefined {
  if (value === 'left') return isRightToLeft ? 'right' : 'left';
  if (value === 'right') return isRightToLeft ? 'left' : 'right';
  if (value === 'center' || value === 'justify') return value;
  if (
    value === 'both' ||
    value === 'distribute' ||
    value === 'numTab' ||
    value === 'thaiDistribute' ||
    value === 'lowKashida' ||
    value === 'mediumKashida' ||
    value === 'highKashida'
  ) {
    return 'justify';
  }
  // start/end without explicit direction default to left.
  if (value === 'start') return 'left';
  if (value === 'end') return 'right';
  return undefined;
}

function mapSpacing(spacing: OoxmlParagraphSpacing | undefined, isList: boolean): LayoutParagraphSpacing | undefined {
  if (!spacing) return undefined;
  const out: LayoutParagraphSpacing = {};
  let before = spacing.before;
  let after = spacing.after;
  if (spacing.beforeAutospacing) {
    before = isList ? undefined : (spacing.line ?? AUTO_SPACING_LINE_DEFAULT) * AUTO_PARAGRAPH_SPACING_MULTIPLIER;
  }
  if (spacing.afterAutospacing) {
    after = isList ? undefined : (spacing.line ?? AUTO_SPACING_LINE_DEFAULT) * AUTO_PARAGRAPH_SPACING_MULTIPLIER;
  }
  if (before != null) out.before = twipsToPx(before);
  if (after != null) out.after = twipsToPx(after);
  if (spacing.line != null) {
    const rule = spacing.lineRule;
    if (rule === 'exact' || rule === 'atLeast') {
      out.line = twipsToPx(spacing.line);
      out.lineUnit = 'px';
      out.lineRule = rule;
    } else if (rule === 'auto') {
      out.line = spacing.line / AUTO_SPACING_LINE_DEFAULT;
      out.lineUnit = 'multiplier';
      out.lineRule = 'auto';
    } else {
      out.line = spacing.line / AUTO_SPACING_LINE_DEFAULT;
      out.lineUnit = 'multiplier';
    }
  }
  if (spacing.beforeAutospacing) out.beforeAutospacing = true;
  if (spacing.afterAutospacing) out.afterAutospacing = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapIndent(props: ParagraphProperties): ParagraphIndent | undefined {
  const indent = props.indent;
  if (!indent) return undefined;
  const isRightToLeft = props.rightToLeft === true;
  const out: ParagraphIndent = {};
  // For RTL paragraphs the layout contract still expects the legacy
  // V1-compatible visual carriers: leading indent on the right, trailing on
  // the left, and first-line / hanging offsets negated into the visual flow.
  if (indent.left != null) {
    const value = twipsToPx(indent.left);
    if (isRightToLeft) out.right = value;
    else out.left = value;
  } else if (indent.start != null) {
    const value = twipsToPx(indent.start);
    if (isRightToLeft) out.right = value;
    else out.left = value;
  }
  if (indent.right != null) {
    const value = twipsToPx(indent.right);
    if (isRightToLeft) out.left = value;
    else out.right = value;
  } else if (indent.end != null) {
    const value = twipsToPx(indent.end);
    if (isRightToLeft) out.left = value;
    else out.right = value;
  }
  if (indent.firstLine != null) {
    const value = twipsToPx(indent.firstLine);
    out.firstLine = isRightToLeft ? -value : value;
  }
  if (indent.hanging != null) {
    const value = twipsToPx(indent.hanging);
    out.hanging = isRightToLeft ? -value : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapParagraphBorders(borders: ParagraphBorders | undefined): LayoutParagraphBorders | undefined {
  if (!borders) return undefined;
  const out: LayoutParagraphBorders = {};
  for (const side of ['top', 'right', 'bottom', 'left', 'between'] as const) {
    const mapped = mapParagraphBorder(borders[side]);
    if (mapped) out[side] = mapped;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapParagraphBorder(border: BorderProperties | undefined): ParagraphBorder | undefined {
  if (!border) return undefined;
  const style = mapBorderStyle(border.val);
  if (style === 'none') return { style: 'none' };
  const out: ParagraphBorder = {};
  if (style) out.style = style;
  if (border.size != null) {
    const widthPx = (border.size / 8) * (96 / 72); // eighth-points -> px
    if (widthPx > 0) out.width = Math.max(0.5, Math.min(100, widthPx));
  }
  const color = normalizeHexColor(border.color);
  if (color) out.color = color;
  if (border.space != null) out.space = Math.max(0, border.space);
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapBorderStyle(value: string | undefined): ParagraphBorder['style'] {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'nil' || lower === 'none') return 'none';
  if (lower === 'double') return 'double';
  if (lower === 'dashed' || lower === 'dashsmallgap' || lower === 'dashlargegap') return 'dashed';
  if (lower === 'dotted' || lower === 'dot') return 'dotted';
  return 'solid';
}

function mapParagraphShading(shading: ShadingProperties | undefined): ParagraphShading | undefined {
  if (!shading) return undefined;
  const out: ParagraphShading = {};
  const fill = normalizeHexColor(shading.fill);
  if (fill) out.fill = fill;
  const color = normalizeHexColor(shading.color);
  if (color) out.color = color;
  if (shading.val) out.val = shading.val;
  if (shading.themeColor) out.themeColor = shading.themeColor;
  if (shading.themeFill) out.themeFill = shading.themeFill;
  if (shading.themeFillShade) out.themeFillShade = shading.themeFillShade;
  if (shading.themeFillTint) out.themeFillTint = shading.themeFillTint;
  if (shading.themeShade) out.themeShade = shading.themeShade;
  if (shading.themeTint) out.themeTint = shading.themeTint;
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapTabStops(stops: ParagraphTabStop[] | undefined): ParagraphAttrs['tabs'] | undefined {
  if (!stops || stops.length === 0) return undefined;
  const out: NonNullable<ParagraphAttrs['tabs']> = [];
  for (const ts of stops) {
    const tab = ts.tab;
    if (!tab) continue;
    const val = mapTabVal(tab.tabType);
    if (!val) continue;
    if (tab.pos == null) continue;
    const entry: NonNullable<ParagraphAttrs['tabs']>[number] = {
      val,
      pos: tab.pos,
    };
    const leader = mapTabLeader(tab.leader);
    if (leader) entry.leader = leader;
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

function mapTabVal(value: string | undefined): NonNullable<ParagraphAttrs['tabs']>[number]['val'] | undefined {
  switch (value) {
    case 'start':
    case 'center':
    case 'end':
    case 'decimal':
    case 'bar':
    case 'clear':
      return value;
    case 'left':
    case 'num':
      return 'start';
    case 'right':
      return 'end';
    case 'dec':
      return 'decimal';
    default:
      return value == null ? 'start' : undefined;
  }
}

function mapTabLeader(value: string | undefined): NonNullable<ParagraphAttrs['tabs']>[number]['leader'] | undefined {
  switch (value) {
    case 'none':
    case 'dot':
    case 'hyphen':
    case 'heavy':
    case 'underscore':
    case 'middleDot':
      return value;
    case 'thick':
      return 'heavy';
    default:
      return undefined;
  }
}

function mapFrame(frame: ParagraphFrameProperties | undefined): ParagraphFrame | undefined {
  if (!frame) return undefined;
  const out: Record<string, unknown> = {};
  if (frame.wrap) out.wrap = frame.wrap;
  if (frame.x != null) out.x = twipsToPx(frame.x);
  if (frame.y != null) out.y = twipsToPx(frame.y);
  if (frame.xAlign) out.xAlign = frame.xAlign;
  if (frame.yAlign) out.yAlign = frame.yAlign;
  if (frame.hAnchor) out.hAnchor = frame.hAnchor;
  if (frame.vAnchor) out.vAnchor = frame.vAnchor;
  return Object.keys(out).length > 0 ? (out as ParagraphFrame) : undefined;
}
