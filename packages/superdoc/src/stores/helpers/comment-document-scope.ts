export type DocumentScopedComment =
  | {
      fileId?: unknown;
      documentId?: unknown;
      selection?: { documentId?: unknown } | null;
    }
  | null
  | undefined;

type OpenDocument = { id?: unknown } | null | undefined;

export type OpenDocumentsSource = OpenDocument[] | { value?: OpenDocument[] | null } | null | undefined;

export type BelongsToDocumentOptions = { allowSingleDocumentMismatch?: boolean };

export const getCommentDocumentId = (comment: DocumentScopedComment): string | null => {
  if (!comment) return null;
  if (comment.fileId != null) return String(comment.fileId);
  if (comment.documentId != null) return String(comment.documentId);
  if (comment.selection?.documentId != null) return String(comment.selection.documentId);
  return null;
};

export const createCommentDocumentScope = (readOpenDocuments: () => OpenDocumentsSource) => {
  const getOpenDocuments = (): OpenDocument[] => {
    const source = readOpenDocuments();
    const docs = Array.isArray(source) ? source : source?.value;
    return Array.isArray(docs) ? docs : [];
  };

  const getSingleOpenDocumentId = (): string | null => {
    const docs = getOpenDocuments();
    if (docs.length !== 1) return null;
    return docs[0]?.id != null ? String(docs[0].id) : null;
  };

  const belongsToDocument = (
    comment: DocumentScopedComment,
    activeDocumentId: string | null | undefined,
    options: BelongsToDocumentOptions = {},
  ): boolean => {
    const { allowSingleDocumentMismatch = false } = options;
    if (!activeDocumentId) return false;

    const commentDocumentId = getCommentDocumentId(comment);
    if (commentDocumentId) {
      if (commentDocumentId === activeDocumentId) return true;

      const singleOpenDocumentId = getSingleOpenDocumentId();
      return allowSingleDocumentMismatch && singleOpenDocumentId === activeDocumentId;
    }

    return getSingleOpenDocumentId() === activeDocumentId;
  };

  const belongsToTrackedChangeSyncDocument = (
    comment: DocumentScopedComment,
    activeDocumentId: string | null | undefined,
  ): boolean => belongsToDocument(comment, activeDocumentId, { allowSingleDocumentMismatch: true });

  return { belongsToDocument, belongsToTrackedChangeSyncDocument };
};
