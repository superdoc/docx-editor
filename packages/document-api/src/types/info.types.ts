export interface DocumentInfoCounts {
  words: number;
  /**
   * Length of the Document API plain-text projection.
   *
   * This is a "characters with spaces" metric derived from
   * `doc.textBetween(0, size, '\n', '\n')`. It includes whitespace,
   * inter-block newline separators, and one `'\n'` per non-text leaf node
   * (images, tabs, breaks). It is neither Word's `ap:Characters` nor
   * `ap:CharactersWithSpaces`.
   */
  characters: number;
  paragraphs: number;
  headings: number;
  tables: number;
  images: number;
  comments: number;
  /** Count of grouped tracked-change entities (insertions, deletions, format changes). */
  trackedChanges: number;
  /** Count of field-like SDT/content-control nodes (text/date/checkbox/choice controls). */
  sdtFields: number;
  /** Count of unique list sequences, not individual list items. */
  lists: number;
  /** Number of layout pages. Absent when pagination is inactive or layout hasn't completed. */
  pages?: number;
}

export interface DocumentInfoOutlineItem {
  level: number;
  text: string;
  nodeId: string;
}

export interface DocumentInfoCapabilities {
  canFind: boolean;
  canGetNode: boolean;
  canComment: boolean;
  canReplace: boolean;
}

/** A paragraph style discovered in the document. */
export interface DocumentStyleInfo {
  /** Style identifier (e.g. 'Normal', 'Heading1', 'BodyText'). */
  styleId: string;
  /** Number of paragraphs using this style. */
  count: number;
  /** Font family used by text in this style (from actual text marks). */
  fontFamily?: string;
  /** Font size in half-points used by text in this style. */
  fontSize?: number;
}

/** Style information collected from the document. */
export interface DocumentStyles {
  /** Paragraph styles currently in use, sorted by frequency (most common first). */
  paragraphStyles: DocumentStyleInfo[];
}

/** Default formatting detected from the document's body text. */
export interface DocumentDefaults {
  /** Most common body text font family. */
  fontFamily?: string;
  /** Most common body text font size in half-points. */
  fontSize?: number;
  /** Most common body paragraph styleId. */
  styleId?: string;
}

/** A block in the document snapshot with its formatting. */
export interface DocumentSnapshotBlock {
  /** Block index in document order. */
  ordinal: number;
  /** Block ID for targeting (pass to superdoc_create, superdoc_format, etc.). */
  nodeId: string;
  /** Block type: paragraph, heading, table, listItem, image, etc. */
  nodeType: string;
  /** First 80 chars of text content. */
  textPreview: string | null;
  /** True if the block has no text content. */
  isEmpty: boolean;
  /** Named paragraph style ID (e.g. 'Normal', 'Heading1'). Null if implicit. */
  styleId?: string | null;
  /** Font family from the block's first text run. */
  fontFamily?: string;
  /** Font size from the block's first text run. */
  fontSize?: number;
  /** True if the block's text is bold. */
  bold?: boolean;
  /** Paragraph alignment: left, center, right, justify. */
  alignment?: string;
  /** Heading level (1-9). Only present for headings. */
  headingLevel?: number;
}

/** Full document snapshot: structure, blocks with formatting, and defaults. */
export interface DocumentSnapshot {
  /** Total block count. */
  total: number;
  /** All blocks in document order with IDs, types, text, and formatting. */
  blocks: DocumentSnapshotBlock[];
  /** Default formatting detected from body text. */
  defaults: DocumentDefaults;
  /** Document revision. */
  revision: string;
}

export interface DocumentInfo {
  counts: DocumentInfoCounts;
  outline: DocumentInfoOutlineItem[];
  capabilities: DocumentInfoCapabilities;
  /** Monotonic decimal-string revision counter. Increments on every document change. */
  revision: string;
  /** Styles currently in use in the document. */
  styles?: DocumentStyles;
  /** Default formatting detected from the document's most common body text. */
  defaults?: DocumentDefaults;
}
