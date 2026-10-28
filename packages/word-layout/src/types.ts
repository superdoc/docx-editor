/**
 * Shared type definitions for Word paragraph + list layout contracts.
 */

export type WordListSuffix = 'tab' | 'space' | 'nothing' | undefined;

export type WordListJustification = 'left' | 'center' | 'right';

export type ParagraphIndent = {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
};

export type ParagraphSpacing = {
  before?: number;
  after?: number;
  line?: number;
  lineRule?: 'auto' | 'exact' | 'atLeast';
};

export type ResolvedTabStop = {
  position: number;
  alignment: 'start' | 'center' | 'end' | 'decimal' | 'bar' | 'num';
  leader?: 'none' | 'dot' | 'heavy' | 'hyphen' | 'middleDot' | 'underscore';
  decimalChar?: string;
};

type TabStop = {
  val: 'start' | 'end' | 'center' | 'decimal' | 'bar' | 'clear';
  pos: number; // Twips from paragraph start (after left indent)
  leader?: 'none' | 'dot' | 'hyphen' | 'heavy' | 'underscore' | 'middleDot';
};

export type ResolvedRunProperties = {
  fontFamily: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  underline?: {
    style?: 'single' | 'double' | 'dotted' | 'dashed' | 'wavy';
    color?: string;
  } | null;
  strike?: boolean;
  color?: string;
  highlight?: string;
  smallCaps?: boolean;
  allCaps?: boolean;
  baselineShift?: number;
  vertAlign?: 'superscript' | 'subscript' | 'baseline';
  letterSpacing?: number;
  scale?: number;
  lang?: string;
  vanish?: boolean;
};

export type NumberingProperties = {
  numId?: number;
  ilvl?: number;
};

export type ResolvedParagraphProperties = {
  styleId?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indent?: ParagraphIndent;
  spacing?: ParagraphSpacing;
  tabs?: TabStop[];
  tabIntervalTwips?: number;
  decimalSeparator?: string;
  numberingProperties?: NumberingProperties | null;
};

export type WordLayoutMeasurementAdapter = {
  measureText?: (text: string, fontCss: string, options?: { letterSpacing?: number }) => number;
};

export type ListRenderingAttrs = {
  markerText: string;
  justification: WordListJustification;
  path: number[];
  numberingType: string;
  suffix: 'tab' | 'space' | 'nothing';
};

export type WordParagraphLayoutInput = {
  paragraph: ResolvedParagraphProperties;
  listRenderingAttrs: ListRenderingAttrs;
  markerRun: ResolvedRunProperties;
};

export type WordListMarkerLayout = {
  markerText: string;
  markerBoxWidthPx?: number;
  glyphWidthPx?: number;
  gutterWidthPx?: number;
  justification: WordListJustification;
  markerX?: number;
  suffix: WordListSuffix;
  textStartX?: number;
  run: ResolvedRunProperties;
};

export type WordParagraphLayoutOutput = {
  textStartMode?: 'paragraph';
  indentLeftPx: number;
  hangingPx: number;
  firstLinePx?: number;
  tabsPx: number[];
  textStartPx: number;
  marker?: WordListMarkerLayout;
  defaultTabIntervalPx?: number;
  /**
   * True when list uses firstLine indent pattern (marker at left+firstLine)
   * instead of standard hanging pattern (marker at left-hanging).
   */
  firstLineIndentMode?: boolean;
};
