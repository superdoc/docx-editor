/**
 * SDM/1 canonical node model: content nodes and inline nodes.
 *
 * Every structural node follows the discriminated union pattern:
 *   { kind: '<nodeKind>'; <nodeKind>: { ...payload } }
 *
 * This file defines all concrete node interfaces and the two primary unions:
 *   SDContentNode: block-level document body nodes
 *   SDInlineNode : inline nodes within paragraph-like containers
 */

import type {
  SDRunProps,
  SDParagraphProps,
  SDListProps,
  SDTableProps,
  SDRowProps,
  SDCellProps,
  SDImageProps,
  SDDrawingProps,
} from './sd-props.js';
import type {
  SDObjectLayout,
  SDObjectGeometry,
  SDObjectMediaRef,
  SDObjectCompat,
  SDAccessibilityInfo,
  SDDrawingSource,
  SDResolvedProvenance,
  SDResolvedTableLayout,
} from './sd-objects.js';
import type { SDSection } from './sd-sections.js';
import type { SemanticHeadingLevel } from './paragraph.types.js';

// ---------------------------------------------------------------------------
// Base interfaces
// ---------------------------------------------------------------------------

export interface SDNodeBase {
  id?: string;
  ext?: Record<string, unknown>;
}

export interface SDParagraphLikeIds {
  /** OOXML paragraph identity (w14:paraId), when available. */
  paraId?: string;
  /** OOXML text identity (w14:textId), when available. */
  textId?: string;
}

/** Base for paragraph-derived semantic nodes. */
export interface SDParagraphLikeBase extends SDNodeBase {
  paragraphIds?: SDParagraphLikeIds;
}

// ---------------------------------------------------------------------------
// Content nodes: block-level
// ---------------------------------------------------------------------------

export interface SDParagraph extends SDParagraphLikeBase {
  kind: 'paragraph';
  paragraph: {
    inlines: SDInlineNode[];
    styleRef?: string;
    props?: SDParagraphProps;
    resolved?: Partial<SDParagraphProps>;
    provenance?: SDResolvedProvenance<SDParagraphProps>;
  };
}

export interface SDHeading extends SDParagraphLikeBase {
  kind: 'heading';
  heading: {
    level: SemanticHeadingLevel;
    inlines: SDInlineNode[];
    styleRef?: string;
    props?: SDParagraphProps;
    resolved?: Partial<SDParagraphProps>;
    provenance?: SDResolvedProvenance<SDParagraphProps>;
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface SDListLevelDef {
  /** Level 0..8. */
  level: number;
  kind: 'ordered' | 'bullet';
  format?: string;
  text?: string;
  start?: number;
  restartAfterLevel?: number | null;
}

export interface SDListItem extends SDParagraphLikeBase {
  level: number;
  path?: number[];
  marker?: string;
  content: SDContentNode[];
}

export interface SDList extends SDParagraphLikeBase {
  kind: 'list';
  list: {
    styleRef?: string;
    props?: SDListProps;
    resolved?: Partial<SDListProps>;
    provenance?: SDResolvedProvenance<SDListProps>;
    levels?: SDListLevelDef[];
    items: SDListItem[];
  };
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface SDTableColumn {
  /** Preferred/authored grid width in points; omit for auto/unspecified. */
  width?: number;
}

export interface SDTableRow {
  props?: SDRowProps;
  cells: SDTableCell[];
}

export interface SDTableCell {
  props?: SDCellProps;
  colSpan?: number;
  rowSpan?: number;
  /** Marks a semantic table header cell. */
  header?: boolean;
  content: SDContentNode[];
}

export interface SDTable extends SDNodeBase {
  kind: 'table';
  table: {
    styleRef?: string;
    props?: SDTableProps;
    resolved?: Partial<SDTableProps>;
    provenance?: SDResolvedProvenance<SDTableProps>;
    resolvedLayout?: SDResolvedTableLayout;
    columns?: SDTableColumn[];
    rows: SDTableRow[];
  };
}

// ---------------------------------------------------------------------------
// TOC
// ---------------------------------------------------------------------------

export interface SDToc extends SDNodeBase {
  kind: 'toc';
  toc: {
    /** Raw TOC field instruction for lossless round-trip. */
    instruction?: string;
    sourceConfig?: {
      outlineLevels?: { from: number; to: number };
      useAppliedOutlineLevel?: boolean;
      tcFieldIdentifier?: string;
      tcFieldLevels?: { from: number; to: number };
    };
    displayConfig?: {
      hyperlinks?: boolean;
      hideInWebView?: boolean;
      includePageNumbers?: boolean;
      omitPageNumberLevels?: { from: number; to: number };
      rightAlignPageNumbers?: boolean;
      tabLeader?: 'none' | 'dot' | 'hyphen' | 'underscore' | 'middleDot';
      separator?: string;
    };
    preservedSwitches?: {
      customStyles?: Array<{ styleName: string; level: number }>;
      bookmarkName?: string;
      captionType?: string;
      seqFieldIdentifier?: string;
      chapterSeparator?: string;
      chapterNumberSource?: string;
      preserveTabEntries?: boolean;
      rawExtensions?: string[];
    };
    fieldState?: {
      locked?: boolean;
      dirty?: boolean;
    };
    entryCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Index, bibliography, authorities blocks
// ---------------------------------------------------------------------------

export interface SDDocumentIndex extends SDNodeBase {
  kind: 'index';
  index: {
    instruction?: string;
    config?: Record<string, unknown>;
  };
}

export interface SDBibliography extends SDNodeBase {
  kind: 'bibliography';
  bibliography: {
    style?: string;
    instruction?: string;
  };
}

export interface SDTableOfAuthorities extends SDNodeBase {
  kind: 'tableOfAuthorities';
  tableOfAuthorities: {
    instruction?: string;
    config?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Breaks and section boundaries
// ---------------------------------------------------------------------------

export interface SDBreak extends SDNodeBase {
  kind: 'break';
  break: {
    type: 'page' | 'column';
  };
}

/** A semantic horizontal rule; the destination chooses its durable representation. */
export interface SDHorizontalRule {
  id?: string;
  kind: 'horizontalRule';
  horizontalRule: Record<string, never>;
}

export interface SDSectionBreak extends SDNodeBase {
  kind: 'sectionBreak';
  sectionBreak: {
    targetSectionId: string;
  };
}

export interface SDSectPr extends SDNodeBase {
  kind: 'sectPr';
  sectPr: {
    section: SDSection;
  };
}

// ---------------------------------------------------------------------------
// Image and drawing
// ---------------------------------------------------------------------------

export interface SDImage extends SDNodeBase {
  kind: 'image';
  image: {
    src: string;
    styleRef?: string;
    accessibility?: SDAccessibilityInfo;
    /** Convenience alias for accessibility.alt in simple workflows. */
    alt?: string;
    layout?: SDObjectLayout;
    geometry?: SDObjectGeometry;
    media?: SDObjectMediaRef;
    compat?: SDObjectCompat;
    props?: SDImageProps;
    resolved?: Partial<SDImageProps>;
    provenance?: SDResolvedProvenance<SDImageProps>;
  };
}

export interface SDDrawing extends SDNodeBase {
  kind: 'drawing';
  drawing: {
    source: SDDrawingSource;
    accessibility?: SDAccessibilityInfo;
    layout?: SDObjectLayout;
    geometry?: SDObjectGeometry;
    compat?: SDObjectCompat;
    props?: SDDrawingProps;
    resolved?: Partial<SDDrawingProps>;
    provenance?: SDResolvedProvenance<SDDrawingProps>;
  };
}

// ---------------------------------------------------------------------------
// SDT and customXml
// ---------------------------------------------------------------------------

export interface SDSdt extends SDNodeBase {
  kind: 'sdt';
  sdt: {
    tag?: string;
    alias?: string;
    type?: string;
    appearance?: string;
    placeholder?: string;
    lock?: 'none' | 'content' | 'sdt' | 'both';
    scope?: 'inline' | 'block' | 'row' | 'cell';
    inlines?: SDInlineNode[];
    content?: SDContentNode[];
  };
}

export interface SDCustomXml extends SDNodeBase {
  kind: 'customXml';
  customXml: {
    element?: string;
    uri?: string;
    itemId?: string;
    scope?: 'inline' | 'block' | 'row' | 'cell';
    attributes?: Record<string, string>;
    inlines?: SDInlineNode[];
    content?: SDContentNode[];
  };
}

// ---------------------------------------------------------------------------
// altChunk, math, field
// ---------------------------------------------------------------------------

export interface SDAltChunk extends SDNodeBase {
  kind: 'altChunk';
  altChunk: {
    relationshipId?: string;
    format?: 'docx' | 'html' | 'rtf' | 'text' | string;
    sourceUri?: string;
    sourceBase64?: string;
  };
}

export interface SDMath extends SDNodeBase {
  kind: 'math';
  math: {
    placement?: 'inline' | 'block';
    omml?: string;
    latex?: string;
    mathml?: string;
  };
}

export interface SDField extends SDNodeBase {
  kind: 'field';
  field: {
    fieldType?: string;
    instruction?: string;
    instructionTokens?: string[];
    resultText?: string;
    placement?: 'inline' | 'block';
    locked?: boolean;
    dirty?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export interface SDRun extends SDNodeBase {
  kind: 'run';
  run: {
    text: string;
    styleRef?: string;
    props?: SDRunProps;
    resolved?: Partial<SDRunProps>;
    provenance?: SDResolvedProvenance<SDRunProps>;
  };
}

export interface SDHyperlink extends SDNodeBase {
  kind: 'hyperlink';
  hyperlink: {
    href?: string;
    anchor?: string;
    docLocation?: string;
    tooltip?: string;
    targetFrame?: '_self' | '_blank' | '_parent' | '_top' | string;
    history?: boolean;
    inlines: Exclude<SDInlineNode, SDHyperlink>[];
  };
}

export interface SDCrossRef extends SDNodeBase {
  kind: 'crossRef';
  crossRef: {
    instruction?: string;
    fieldType?: 'REF' | 'PAGEREF' | 'NOTEREF' | 'STYLEREF';
    target?: string;
    display?: string;
    resolvedText?: string;
  };
}

export interface SDIndexEntry extends SDNodeBase {
  kind: 'indexEntry';
  indexEntry: {
    instruction?: string;
    mainEntry?: string;
    subEntry?: string;
    bold?: boolean;
    italic?: boolean;
    crossReference?: string;
  };
}

export interface SDSequenceField extends SDNodeBase {
  kind: 'sequenceField';
  sequenceField: {
    instruction?: string;
    identifier?: string;
    format?: string;
    restartLevel?: number;
  };
}

export interface SDCitation extends SDNodeBase {
  kind: 'citation';
  citation: {
    instruction?: string;
    sourceIds?: string[];
    displayText?: string;
  };
}

export interface SDAuthorityEntry extends SDNodeBase {
  kind: 'authorityEntry';
  authorityEntry: {
    instruction?: string;
    longCitation?: string;
    shortCitation?: string;
    category?: string;
    bold?: boolean;
    italic?: boolean;
  };
}

export interface SDTocEntry extends SDNodeBase {
  kind: 'tocEntry';
  tocEntry: {
    instruction?: string;
    text?: string;
    level?: number;
    tableIdentifier?: string;
    omitPageNumber?: boolean;
  };
}

export interface SDTab extends SDNodeBase {
  kind: 'tab';
  tab: Record<string, never>;
}

export interface SDLineBreak extends SDNodeBase {
  kind: 'lineBreak';
  lineBreak: Record<string, never>;
}

export interface SDFootnoteRef extends SDNodeBase {
  kind: 'footnoteRef';
  footnoteRef: { noteId?: string };
}

export interface SDEndnoteRef extends SDNodeBase {
  kind: 'endnoteRef';
  endnoteRef: { noteId?: string };
}

// ---------------------------------------------------------------------------
// Extension nodes
// ---------------------------------------------------------------------------

export interface SDExtContentNode extends SDNodeBase {
  kind: `ext.${string}`;
  [key: string]: unknown;
}

export interface SDExtInlineNode extends SDNodeBase {
  kind: `ext.${string}`;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Content node union
// ---------------------------------------------------------------------------

export type SDContentNode =
  | SDParagraph
  | SDHeading
  | SDList
  | SDTable
  | SDToc
  | SDDocumentIndex
  | SDBibliography
  | SDTableOfAuthorities
  | SDBreak
  | SDHorizontalRule
  | SDSectionBreak
  | SDSectPr
  | SDImage
  | SDDrawing
  | SDSdt
  | SDCustomXml
  | SDAltChunk
  | SDMath
  | SDField
  | SDExtContentNode;

// ---------------------------------------------------------------------------
// Inline node union
// ---------------------------------------------------------------------------

export type SDInlineNode =
  | SDRun
  | SDHyperlink
  | SDCrossRef
  | SDIndexEntry
  | SDSequenceField
  | SDCitation
  | SDAuthorityEntry
  | SDTocEntry
  | SDImage
  | SDDrawing
  | SDSdt
  | SDCustomXml
  | SDMath
  | SDField
  | SDTab
  | SDLineBreak
  | SDFootnoteRef
  | SDEndnoteRef
  | SDExtInlineNode;
