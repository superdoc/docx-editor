/**
 * SDM/1 property models: run, paragraph, table, list, image, drawing props.
 *
 * These define the direct formatting ("authored") property bags carried by
 * style-bearing nodes. Resolved/provenance fields are separate concerns
 * populated at read time by the style-engine.
 */

// ---------------------------------------------------------------------------
// Color and font primitives
// ---------------------------------------------------------------------------

import type { ST_HIGHLIGHT_VALUES } from '../inline-semantics/token-sets.js';

export type SDThemeFontRef =
  | 'majorAscii'
  | 'majorHAnsi'
  | 'majorEastAsia'
  | 'majorBidi'
  | 'minorAscii'
  | 'minorHAnsi'
  | 'minorEastAsia'
  | 'minorBidi';

export interface SDRunFonts {
  ascii?: string;
  hAnsi?: string;
  eastAsia?: string;
  cs?: string;
  asciiTheme?: SDThemeFontRef;
  hAnsiTheme?: SDThemeFontRef;
  eastAsiaTheme?: SDThemeFontRef;
  csTheme?: SDThemeFontRef;
  hint?: 'default' | 'eastAsia' | 'cs';
}

export interface SDRunLanguages {
  val?: string;
  eastAsia?: string;
  bidi?: string;
}

export type SDThemeColorName =
  | 'dk1'
  | 'dk2'
  | 'lt1'
  | 'lt2'
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6'
  | 'hyperlink'
  | 'followedHyperlink';

export type SDColorRef =
  | { model: 'rgb'; value: string }
  | { model: 'theme'; theme: SDThemeColorName; tint?: number; shade?: number }
  | { model: 'auto' };

// ---------------------------------------------------------------------------
// Inline formatting primitives
// ---------------------------------------------------------------------------

export type SDHighlightColor = (typeof ST_HIGHLIGHT_VALUES)[number];

export type SDUnderlineStyle =
  | 'none'
  | 'single'
  | 'words'
  | 'double'
  | 'thick'
  | 'dotted'
  | 'dottedHeavy'
  | 'dash'
  | 'dashedHeavy'
  | 'dashLong'
  | 'dashLongHeavy'
  | 'dotDash'
  | 'dashDotHeavy'
  | 'dotDotDash'
  | 'dashDotDotHeavy'
  | 'wave'
  | 'wavyHeavy'
  | 'wavyDouble';

export interface SDUnderline {
  style?: SDUnderlineStyle;
  color?: SDColorRef;
}

export interface SDShading {
  pattern?: string;
  fill?: SDColorRef;
  color?: SDColorRef;
}

export interface SDRunBorder {
  style?: string;
  /** Line width in points. */
  width?: number;
  /** Spacing from the content in points. */
  space?: number;
  color?: SDColorRef;
  frame?: boolean;
  shadow?: boolean;
}

// ---------------------------------------------------------------------------
// Tab stops
// ---------------------------------------------------------------------------

export type SDTabAlignment = 'left' | 'center' | 'right' | 'decimal' | 'bar' | 'clear' | 'num';

export type SDTabLeader = 'none' | 'dot' | 'hyphen' | 'underscore' | 'middleDot' | 'heavy' | 'line';

export interface SDTabStop {
  kind: 'set' | 'clear';
  /** Position in points. */
  position: number;
  alignment?: SDTabAlignment;
  leader?: SDTabLeader;
}

// ---------------------------------------------------------------------------
// Paragraph borders
// ---------------------------------------------------------------------------

export interface SDParagraphBorders {
  top?: SDRunBorder;
  left?: SDRunBorder;
  bottom?: SDRunBorder;
  right?: SDRunBorder;
  between?: SDRunBorder;
  bar?: SDRunBorder;
}

// ---------------------------------------------------------------------------
// Run properties
// ---------------------------------------------------------------------------

export interface SDRunProps {
  fonts?: SDRunFonts;
  /** Convenience alias when one family applies across scripts. */
  fontFamily?: string;
  lang?: SDRunLanguages;
  /** Font size in points. */
  fontSize?: number;
  /** Complex-script font size in points. */
  fontSizeCs?: number;
  color?: SDColorRef;
  highlight?: SDHighlightColor;
  shading?: SDShading;

  cs?: boolean;
  rtl?: boolean;
  bold?: boolean;
  boldCs?: boolean;
  italic?: boolean;
  italicCs?: boolean;
  underline?: SDUnderline;
  strikethrough?: boolean;
  doubleStrikethrough?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  outline?: boolean;
  shadow?: boolean;
  emboss?: boolean;
  imprint?: boolean;

  verticalAlign?: 'baseline' | 'superscript' | 'subscript';

  /** Character spacing in points. */
  characterSpacing?: number;
  /** Character scale as percentage. */
  characterScale?: number;
  /** Kerning threshold in points. */
  kern?: number;
  /** Baseline shift in points. */
  baselineShift?: number;
  /** Fit-text target width in points. */
  fitTextWidth?: number;

  vanish?: boolean;
  webHidden?: boolean;
  specVanish?: boolean;

  border?: SDRunBorder;
  textEffect?: string;
}

// ---------------------------------------------------------------------------
// Paragraph properties
// ---------------------------------------------------------------------------

export interface SDParagraphProps {
  alignment?:
    | 'left'
    | 'center'
    | 'right'
    | 'justify'
    | 'start'
    | 'end'
    | 'distributed'
    | 'numTab'
    | 'lowKashida'
    | 'mediumKashida'
    | 'highKashida'
    | 'thaiDistribute';
  indent?: {
    /** Start indent in points. */
    start?: number;
    /** End indent in points. */
    end?: number;
    /** Left indent in points. */
    left?: number;
    /** Right indent in points. */
    right?: number;
    /** First line indent in points. */
    firstLine?: number;
    /** Hanging indent in points. */
    hanging?: number;
    leftChars?: number;
    rightChars?: number;
    startChars?: number;
    endChars?: number;
    firstLineChars?: number;
    hangingChars?: number;
  };
  spacing?: {
    /** Space before in points. */
    before?: number;
    /** Space after in points. */
    after?: number;
    beforeLines?: number;
    afterLines?: number;
    beforeAutoSpacing?: boolean;
    afterAutoSpacing?: boolean;
    /** Line spacing: multiplier when lineRule=auto, otherwise points. */
    line?: number;
    lineRule?: 'auto' | 'multiple' | 'exact' | 'atLeast';
  };
  contextualSpacing?: boolean;
  keepWithNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;

  numbering?: {
    numId?: string;
    /** Numbering level 0..8. */
    level?: number;
  };

  tabs?: SDTabStop[];
  borders?: SDParagraphBorders;
  shading?: SDShading;

  bidi?: boolean;
  textDirection?: 'lrTb' | 'tbRl' | 'btLr' | 'lrTbV' | 'tbLrV';
  mirrorIndents?: boolean;
  adjustRightIndent?: boolean;
  textAlignment?: 'top' | 'center' | 'baseline' | 'bottom' | 'auto';

  eastAsianLineBreak?: {
    kinsoku?: boolean;
    wordWrap?: boolean;
    overflowPunctuation?: boolean;
    topLinePunctuation?: boolean;
    autoSpaceDE?: boolean;
    autoSpaceDN?: boolean;
    snapToGrid?: boolean;
  };

  markRunProps?: SDRunProps;
  outlineLevel?: number;
}

// ---------------------------------------------------------------------------
// List properties
// ---------------------------------------------------------------------------

export interface SDListProps {
  tight?: boolean;
}

// ---------------------------------------------------------------------------
// Table properties
// ---------------------------------------------------------------------------

export type SDTableWidth =
  | { kind: 'auto' }
  | { kind: 'points'; value: number }
  | { kind: 'percent'; value: number }
  | { kind: 'none' };

/** Table border lines; `width` and `space` in points. */
export interface SDTableBorders {
  top?: SDRunBorder;
  right?: SDRunBorder;
  bottom?: SDRunBorder;
  left?: SDRunBorder;
  start?: SDRunBorder;
  end?: SDRunBorder;
  insideH?: SDRunBorder;
  insideV?: SDRunBorder;
}

/** Cell padding in points. */
export interface SDCellPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  start?: number;
  end?: number;
}

export interface SDTableProps {
  width?: SDTableWidth;
  layout?: 'fixed' | 'autofit';
  alignment?: 'left' | 'center' | 'right' | 'inside' | 'outside';
  /** Normalized CSS-like edge borders retained for document and fragment compatibility. */
  borders?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
    insideH?: string;
    insideV?: string;
  };
  /** Leading-edge indent in points. */
  indent?: number;
  /** Spacing between cells in points. */
  cellSpacing?: number;
  /** Default cell padding in points. */
  cellPadding?: SDCellPadding;
  shading?: SDShading;
  /** Right-to-left visual column order (`w:bidiVisual`). */
  bidiVisual?: boolean;
}

/** Table formatting authored on a table style. Borders are structured lines, not strings. */
export interface SDTableStyleProps extends Omit<SDTableProps, 'borders'> {
  borders?: SDTableBorders;
}

export interface SDRowProps {
  /** Minimum row height in points. */
  minHeight?: number;
  cantSplit?: boolean;
  /** Repeat this row as a header row on each page (`w:tblHeader`). */
  repeatHeader?: boolean;
}

/** Cell border lines; `width` and `space` in points. */
export interface SDCellBorders extends SDTableBorders {
  /** Diagonal from top-left to bottom-right. */
  tl2br?: SDRunBorder;
  /** Diagonal from top-right to bottom-left. */
  tr2bl?: SDRunBorder;
}

export interface SDCellProps {
  verticalAlign?: 'top' | 'center' | 'bottom';
  shading?: SDColorRef;
  /** Cell padding in points. */
  padding?: SDCellPadding;
  /** Normalized CSS-like edge borders, such as `'single 1pt #000000'` or `'none'`. */
  borders?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  noWrap?: boolean;
}

/** Cell formatting authored on a table style. Borders are structured lines, not strings. */
export interface SDTableStyleCellProps extends Omit<SDCellProps, 'borders'> {
  borders?: SDCellBorders;
}

// ---------------------------------------------------------------------------
// Image and drawing properties
// ---------------------------------------------------------------------------

export interface SDImageProps {
  alignment?: 'left' | 'center' | 'right';
  /** Opacity 0..1. */
  opacity?: number;
}

export interface SDDrawingProps {
  alignment?: 'left' | 'center' | 'right';
  /** Opacity 0..1. */
  opacity?: number;
}

// ---------------------------------------------------------------------------
// Document metadata
// ---------------------------------------------------------------------------

export interface SDDocumentMeta {
  title?: string;
  subject?: string;
  author?: string;
  description?: string;
  keywords?: string[];
}
