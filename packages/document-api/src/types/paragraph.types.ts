import type { BaseNodeInfo } from './base.js';

export type SemanticHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ParagraphNodeInfo extends BaseNodeInfo {
  nodeType: 'paragraph';
  kind: 'block';
  properties: ParagraphProperties;
}

export interface HeadingNodeInfo extends BaseNodeInfo {
  nodeType: 'heading';
  kind: 'block';
  properties: HeadingProperties;
}

export interface ListItemNodeInfo extends BaseNodeInfo {
  nodeType: 'listItem';
  kind: 'block';
  properties: ListItemProperties;
}

export type ParagraphIndentation = {
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
  unit?: 'twip' | 'pt' | 'px';
};

export type ParagraphSpacing = {
  before?: number;
  after?: number;
  line?: number;
  unit?: 'twip' | 'pt' | 'px';
};

export type ParagraphNumbering = {
  numId?: number;
  level?: number;
};

export type ListNumbering = {
  marker?: string;
  path?: number[];
  ordinal?: number;
  listIndex?: number;
};

export interface ParagraphProperties {
  styleId?: string;
  alignment?: 'left' | 'right' | 'center' | 'justify' | 'start' | 'end' | 'distributed';
  indentation?: ParagraphIndentation;
  spacing?: ParagraphSpacing;
  keepWithNext?: boolean;
  outlineLevel?: number;
  paragraphNumbering?: ParagraphNumbering;
}

export interface HeadingProperties extends ParagraphProperties {
  /**
   * Headings are paragraphs with a heading style.
   */
  headingLevel: SemanticHeadingLevel;
}

export interface ListItemProperties extends ParagraphProperties {
  /**
   * List items are paragraphs with numbering.
   * This keeps list semantics explicit without creating a separate structure.
   */
  numbering?: ListNumbering;
}
