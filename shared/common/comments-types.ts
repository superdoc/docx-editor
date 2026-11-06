export type Comment = {
  commentId: string;
  parentCommentId: string;
  fileId: string;
  fileType: string;
  mentions: unknown[];
  creatorId?: string | null;
  creatorName: string;
  /** Explicit Word provider identity snapshot, independent of app ownership. */
  creatorIdentity?: { providerId: string; userId: string } | null;
  /** Original OOXML author label, separate from the UI display name. */
  wordAuthorName?: string;
  creatorEmail?: string;
  createdTime: number;
  importedId: string;
  importedAuthor: {
    name: string;
    email?: string;
  };
  isInternal: boolean;
  commentText: string;
  selection: {
    documentId: string;
    page: number;
    selectionBounds: unknown;
  };
  trackedChange: boolean;
  trackedChangeText: string | null;
  trackedChangeType: 'trackInsert' | 'trackDelete' | 'both' | 'trackFormat';
  trackedChangeDisplayType?: 'hyperlinkAdded' | 'hyperlinkModified' | null;
  deletedText: string | null;
  resolvedTime: number | null;
  resolvedById: string | null;
  resolvedByEmail: string | null;
  resolvedByName: string | null;
  commentJSON: CommentJSON;
  origin?: 'word' | 'google-docs' | 'unknown';
  threadingMethod?: 'commentsExtended' | 'range-based' | 'mixed';
  threadingStyleOverride?: CommentThreadingStyle;
  threadingParentCommentId?: string;
  originalXmlStructure?: {
    hasCommentsExtended: boolean;
    hasCommentsExtensible: boolean;
    hasCommentsIds: boolean;
  };
};

export type CommentThreadingStyle = 'commentsExtended' | 'range-based';

export type CommentThreadingProfile = {
  defaultStyle: CommentThreadingStyle;
  mixed?: boolean;
  fileSet: {
    hasCommentsExtended: boolean;
    hasCommentsExtensible: boolean;
    hasCommentsIds: boolean;
  };
};

export type CommentContent = {
  type: string;
  marks: Array<{
    type: string;
    attrs: {
      color: string;
      fontFamily: string;
      fontSize: string;
      styleId: string | null;
    };
  }>;
  text: string;
};

export type CommentJSON = {
  type: string;
  attrs: {
    lineHeight: string | null;
    textIndent: string | null;
    paraId: string | null;
    textId: string | null;
    rsidR: string | null;
    rsidRDefault: string | null;
    rsidP: string | null;
    rsidRPr: string | null;
    rsidDel: string | null;
    spacing: {
      lineSpaceAfter: number;
      lineSpaceBefore: number;
      line: number;
      lineRule: string | null;
    };
    extraAttrs: Record<string, unknown>;
    marksAttrs: unknown[] | null;
    indent: unknown;
    borders: unknown;
    class: string | null;
    styleId: string | null;
    sdBlockId: string | null;
    attributes: unknown;
    filename: string | null;
    keepLines: boolean | null;
    keepNext: boolean | null;
    paragraphProperties: Record<string, unknown> | null;
    dropcap: string | null;
    pageBreakSource: string | null;
    justify: unknown;
    tabStops: unknown;
  };
  content: CommentContent[];
};
