/**
 * Types for the `format.paragraph.*` / `styles.paragraph.*` operation namespaces.
 *
 * External API uses user-centric naming (alignment, indentation, spacing).
 * The adapter layer maps to OOXML-aligned internal keys (justification, indent, etc.).
 */

import type { BlockNodeAddress } from '../types/base.js';
import type { ReceiptFailure, ReceiptInsert } from '../types/receipt.js';
import type { SDRunProps } from '../types/sd-props.js';

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

export type ParagraphBlockType = 'paragraph' | 'heading' | 'listItem';

export type ParagraphTarget = BlockNodeAddress & { nodeType: ParagraphBlockType };

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface MutationResolution {
  target: ParagraphTarget;
}

export interface ParagraphMutationSuccess {
  success: true;
  target: ParagraphTarget;
  resolution: MutationResolution;
  /** Logical tracked-change entities created or revised by this mutation. */
  trackedChangeRefs?: ReceiptInsert[];
}

export interface ParagraphMutationFailure {
  success: false;
  failure: ReceiptFailure;
  resolution?: MutationResolution;
}

export type ParagraphMutationResult = ParagraphMutationSuccess | ParagraphMutationFailure;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PARAGRAPH_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
export type ParagraphAlignment = (typeof PARAGRAPH_ALIGNMENTS)[number];

// `clear` is the OOXML `w:tab w:val="clear"` entry: it persists a tab stop that
// suppresses an inherited (style/default) tab stop at the same position.
export const TAB_STOP_ALIGNMENTS = ['left', 'center', 'right', 'decimal', 'bar', 'clear'] as const;
export type TabStopAlignment = (typeof TAB_STOP_ALIGNMENTS)[number];

export const TAB_STOP_LEADERS = ['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middleDot'] as const;
export type TabStopLeader = (typeof TAB_STOP_LEADERS)[number];

export const BORDER_SIDES = ['top', 'bottom', 'left', 'right', 'between', 'bar'] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];

export const CLEAR_BORDER_SIDES = ['top', 'bottom', 'left', 'right', 'between', 'bar', 'all'] as const;
export type ClearBorderSide = (typeof CLEAR_BORDER_SIDES)[number];

export const LINE_RULES = ['auto', 'exact', 'atLeast'] as const;
export type LineRule = (typeof LINE_RULES)[number];

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type ParagraphSemanticStyleRole =
  | { kind: 'defaultParagraph' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }
  | { kind: 'title' }
  | { kind: 'subtitle' };

/**
 * paragraphs.setStyle — concrete catalog identity or semantic intent.
 *
 * A `role` selector that matches more than one authored style (e.g. two
 * styles both named "heading 1") normally fails with `PRECONDITION_FAILED`.
 * The one exception: if the target paragraph's current style is already one
 * of the colliding candidates, the mutation succeeds and keeps that style
 * unchanged rather than switching it to a different candidate.
 */
export type ParagraphsSetStyleInput = { target: ParagraphTarget } & (
  | { styleId: string; role?: never }
  | { styleId?: never; role: ParagraphSemanticStyleRole }
);

/** paragraphs.setStyleRef — changes only the pStyle reference, without clearing run formatting */
export interface ParagraphsSetStyleRefInput {
  target: ParagraphTarget;
  styleId: string;
}

/** paragraphs.clearStyle */
export interface ParagraphsClearStyleInput {
  target: ParagraphTarget;
}

/** paragraphs.resetDirectFormatting */
export interface ParagraphsResetDirectFormattingInput {
  target: ParagraphTarget;
}

/** paragraphs.setAlignment */
export interface ParagraphsSetAlignmentInput {
  target: ParagraphTarget;
  alignment: ParagraphAlignment;
}

/** paragraphs.clearAlignment */
export interface ParagraphsClearAlignmentInput {
  target: ParagraphTarget;
}

/** paragraphs.setIndentation */
export interface ParagraphsSetIndentationInput {
  target: ParagraphTarget;
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
}

/** paragraphs.clearIndentation */
export interface ParagraphsClearIndentationInput {
  target: ParagraphTarget;
}

/** paragraphs.setSpacing */
export interface ParagraphsSetSpacingInput {
  target: ParagraphTarget;
  before?: number;
  after?: number;
  line?: number;
  lineRule?: LineRule;
}

/** paragraphs.clearSpacing */
export interface ParagraphsClearSpacingInput {
  target: ParagraphTarget;
}

/** paragraphs.setKeepOptions */
export interface ParagraphsSetKeepOptionsInput {
  target: ParagraphTarget;
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
}

/** paragraphs.setOutlineLevel */
export interface ParagraphsSetOutlineLevelInput {
  target: ParagraphTarget;
  outlineLevel: number | null;
}

/** paragraphs.setFlowOptions */
export interface ParagraphsSetFlowOptionsInput {
  target: ParagraphTarget;
  contextualSpacing?: boolean;
  pageBreakBefore?: boolean;
  suppressAutoHyphens?: boolean;
  /** `w:autoSpaceDE` — auto-space between East-Asian and Latin text. */
  autoSpaceDE?: boolean;
  /** `w:autoSpaceDN` — auto-space between East-Asian text and numbers. */
  autoSpaceDN?: boolean;
  /** `w:adjustRightInd` — auto-adjust right indent for East-Asian grids. */
  adjustRightInd?: boolean;
  /** `w:snapToGrid` — snap the paragraph to the document grid. */
  snapToGrid?: boolean;
}

/** paragraphs.setTabStop */
export interface ParagraphsSetTabStopInput {
  target: ParagraphTarget;
  position: number;
  alignment: TabStopAlignment;
  leader?: TabStopLeader;
}

/** paragraphs.clearTabStop */
export interface ParagraphsClearTabStopInput {
  target: ParagraphTarget;
  position: number;
}

/** paragraphs.clearAllTabStops */
export interface ParagraphsClearAllTabStopsInput {
  target: ParagraphTarget;
}

/** paragraphs.setBorder */
export interface ParagraphsSetBorderInput {
  target: ParagraphTarget;
  side: BorderSide;
  style: string;
  color?: string;
  size?: number;
  space?: number;
}

/** paragraphs.clearBorder */
export interface ParagraphsClearBorderInput {
  target: ParagraphTarget;
  side: ClearBorderSide;
}

/** paragraphs.setMarkRunProps */
export interface ParagraphsSetMarkRunPropsInput {
  target: ParagraphTarget;
  /**
   * Paragraph-mark run properties (`w:pPr/w:rPr`). Stored through the same
   * internal shape used by structured paragraph materialization, so values
   * round-trip through `paragraph.props.markRunProps`.
   */
  markRunProps: SDRunProps;
}

/** paragraphs.setShading */
export interface ParagraphsSetShadingInput {
  target: ParagraphTarget;
  fill?: string;
  color?: string;
  pattern?: string;
}

/** paragraphs.clearShading */
export interface ParagraphsClearShadingInput {
  target: ParagraphTarget;
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

export const PARAGRAPH_DIRECTIONS = ['ltr', 'rtl'] as const;
export type ParagraphDirection = (typeof PARAGRAPH_DIRECTIONS)[number];

export const ALIGNMENT_POLICIES = ['preserve', 'matchDirection'] as const;
export type AlignmentPolicy = (typeof ALIGNMENT_POLICIES)[number];

/** paragraphs.setDirection */
export interface ParagraphsSetDirectionInput {
  target: ParagraphTarget;
  direction: ParagraphDirection;
  alignmentPolicy?: AlignmentPolicy;
}

/** paragraphs.clearDirection */
export interface ParagraphsClearDirectionInput {
  target: ParagraphTarget;
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/**
 * format.paragraph.setNumbering
 *
 * Attaches numbering (`w:numPr`) to an existing paragraph-shaped block so a
 * heading or paragraph can join an existing numbered sequence (the numbered-
 * heading legal-clause pattern). The underlying paragraph node and its style are
 * unchanged, though the doc-api block subtype may re-resolve afterward (a
 * numbered plain paragraph becomes a listItem; a heading stays a heading).
 * Numbering is a paragraph property (ECMA-376 §17.3.1.19), so this lives under
 * `format.paragraph.*` rather than `lists.*`.
 */
export interface ParagraphsSetNumberingInput {
  target: ParagraphTarget;
  /**
   * Positive numbering instance id (`w:numId`). numId 0 is the OOXML
   * no-numbering sentinel and is rejected.
   */
  numId: number;
  /** Numbering level (`w:ilvl`), 0-8. Defaults to 0 when omitted. */
  level?: number;
}
