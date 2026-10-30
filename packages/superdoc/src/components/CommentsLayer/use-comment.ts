import { ref, reactive } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { TrackChangeCustomAttribute, TrackChangeImagePreview } from '@superdoc/document-api';

import { syncCommentsToClients } from '../../core/collaboration/helpers.js';
import {
  comments_module_events,
  type CommentEvent,
  type Comment as CommonComment,
  type CommentThreadingStyle,
} from '@superdoc/common';
import useSelection from '../../helpers/use-selection.js';
import { DOCUMENT_EDITOR_SELECTION_SOURCE } from '../../helpers/selection-source.js';
import type { Modules, StoryLocator } from '../../core/types/index.js';

export const COMMENT_RECONCILIATION_TOKEN = Symbol('comment-reconciliation');

type ReadOnlyMutationOutcome = { ok: false; reason: 'read-only-document' };

type TrackedChangeDecision = 'accept' | 'reject';

type SelectionBounds = { top: number; left: number; right: number; bottom: number };

type CommentMention = { name?: string | null; email?: string | null };

type CommentAuthor = { name?: string | null; email?: string | null };

type TrackedChangeDetailLine = { excerpt: string; label: string };

type CommentSelectionParams = {
  documentId?: string | null;
  page?: number;
  selectionBounds?: Partial<SelectionBounds> | null;
  source?: string | null;
};

type SelectionState = ReturnType<typeof useSelection>;

type CommentSelection = Omit<SelectionState, 'source'> & { source: SelectionState['source'] | string };

type CommentChange = { key: string; value: unknown; previousValue?: unknown };

type CommentsUpdateEvent = {
  type: CommentEvent;
  changes?: CommentChange[];
  comment: unknown;
};

type CommentsHost = {
  emit: (event: 'comments-update', payload: CommentsUpdateEvent) => unknown;
  commentsStore?: { getConfig?: { readOnly?: boolean } };
  config?: { modules?: Modules };
};

type CommentIdentity = {
  commentId?: string;
  importedId?: string | null;
  parentCommentId?: string | null;
  trackedChangeParentId?: string | null;
  trackedChangeThreadParentId?: string | null;
  threadingParentCommentId?: string | null;
};

export type UseCommentParams = CommentIdentity & {
  uid?: string;
  trackedChangeSide?: string | null;
  fileId?: string | null;
  fileType?: string | null;
  createdAtVersionNumber?: number | null;
  isInternal?: boolean;
  mentions?: CommentMention[];
  isFocused?: boolean;
  creatorId?: string | null;
  creatorEmail?: string | null;
  creatorName?: string | null;
  creatorImage?: string | null;
  createdTime?: number;
  importedAuthor?: CommentAuthor | null;
  docxCommentJSON?: unknown;
  origin?: CommonComment['origin'];
  threadingMethod?: CommonComment['threadingMethod'];
  threadingStyleOverride?: CommentThreadingStyle;
  originalXmlStructure?: CommonComment['originalXmlStructure'];
  commentText?: string;
  selection?: CommentSelectionParams;
  trackedChange?: boolean;
  trackedChangeType?: string | null;
  trackedChangeText?: string | null;
  trackedChangeDisplayType?: string | null;
  semanticColorKey?: string | null;
  semanticColor?: string | null;
  trackedChangeStory?: StoryLocator | null;
  trackedChangeStoryKind?: string | null;
  trackedChangeStoryLabel?: string;
  trackedChangeAnchorKey?: string | null;
  trackedChangeCanonicalId?: string | null;
  trackedChangePositionAliases?: string[];
  deletedText?: string | null;
  trackedChangeLabel?: string | null;
  trackedChangeDetailLines?: TrackedChangeDetailLine[] | null;
  trackedChangeImagePreview?: TrackChangeImagePreview | null;
  customAttributes?: readonly TrackChangeCustomAttribute[] | null;
  resolvedTime?: number | null;
  resolvedById?: string | null;
  resolvedByEmail?: string | null;
  resolvedByName?: string | null;
  trackedChangeDecision?: TrackedChangeDecision | null;
};

type ResolveCommentParams = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  superdoc: CommentsHost;
  decision?: TrackedChangeDecision;
  reconciliationToken?: symbol;
};

type SetTextParams =
  | { text: string; superdoc?: CommentsHost; suppressUpdate: true }
  | { text: string; superdoc: CommentsHost; suppressUpdate?: false };

const readOnlyMutationOutcome = (): ReadOnlyMutationOutcome => ({ ok: false, reason: 'read-only-document' });
const commentsModuleIsReadOnly = (comments: Modules['comments']) => comments !== false && comments?.readOnly === true;
const commentsAreReadOnly = (superdoc: CommentsHost | undefined) =>
  superdoc?.commentsStore?.getConfig?.readOnly === true ||
  commentsModuleIsReadOnly(superdoc?.config?.modules?.comments);

/**
 * Comment composable
 */
export default function useComment(params: UseCommentParams) {
  const uid = ref(params.uid);
  let commentId: string | undefined = params.commentId || uuidv4();
  let importedId = params.importedId;
  let parentCommentId = params.parentCommentId;
  let trackedChangeParentId = params.trackedChangeParentId;
  const trackedChangeThreadParentId = ref(params.trackedChangeThreadParentId);
  const trackedChangeSide = ref(params.trackedChangeSide);
  const fileId = params.fileId;
  const fileType = params.fileType;
  const createdAtVersionNumber = params.createdAtVersionNumber;
  const isInternal = ref(params.isInternal !== undefined ? params.isInternal : true);

  const mentions = ref<CommentMention[]>(Array.isArray(params.mentions) ? params.mentions : []);

  const commentElement = ref<HTMLElement | null>(null);
  const isFocused = ref(params.isFocused || false);

  const creatorId = ref(params.creatorId ?? null);
  const creatorEmail = ref(params.creatorEmail ?? null);
  const creatorName = ref(params.creatorName ?? null);
  const creatorImage = ref(params.creatorImage ?? null);
  const createdTime = ref(params.createdTime || Date.now());
  const importedAuthor = ref(params.importedAuthor || null);
  const docxCommentJSON = ref(params.docxCommentJSON || null);
  const origin = params.origin;
  const threadingMethod = params.threadingMethod;
  const threadingStyleOverride = params.threadingStyleOverride;
  let threadingParentCommentId = params.threadingParentCommentId;
  const originalXmlStructure = params.originalXmlStructure;

  const commentText = ref(params.commentText || '');

  const selection: CommentSelection = params.selection
    ? useSelection(params.selection)
    : useSelection({
        documentId: fileId,
        page: 1,
        selectionBounds: {},
      });

  const floatingPosition: Partial<SelectionBounds> = params.selection?.selectionBounds
    ? { ...params.selection.selectionBounds }
    : { top: 0, left: 0, right: 0, bottom: 0 };

  // Tracked changes aka suggestions
  const trackedChange = ref(params.trackedChange);
  const trackedChangeType = ref(params.trackedChangeType || null);
  const trackedChangeText = ref(params.trackedChangeText || null);
  const trackedChangeDisplayType = ref(params.trackedChangeDisplayType || null);
  const semanticColorKey = ref(params.semanticColorKey || null);
  const semanticColor = ref(params.semanticColor || null);
  const trackedChangeStory = ref(params.trackedChangeStory || null);
  const trackedChangeStoryKind = ref(params.trackedChangeStoryKind || null);
  const trackedChangeStoryLabel = ref(params.trackedChangeStoryLabel || '');
  const trackedChangeAnchorKey = ref(params.trackedChangeAnchorKey || null);
  const trackedChangeCanonicalId = ref(params.trackedChangeCanonicalId || null);
  const trackedChangePositionAliases = ref(params.trackedChangePositionAliases || []);
  const deletedText = ref(params.deletedText || null);
  // Signed semantic label + optional per-member detail lines
  // (`[{ excerpt, label }]`) for list tracked changes (TCS-LIST-005). When
  // absent the dialog keeps its legacy per-variant copy.
  const trackedChangeLabel = ref(params.trackedChangeLabel || null);
  const trackedChangeDetailLines = ref(params.trackedChangeDetailLines || null);
  const trackedChangeImagePreview = ref(params.trackedChangeImagePreview || null);
  const customAttributes = ref(params.customAttributes ?? null);

  const resolvedTime = ref(params.resolvedTime || null);
  const resolvedById = ref<string | null>(params.resolvedById || null);
  const resolvedByEmail = ref<string | null | undefined>(params.resolvedByEmail || null);
  const resolvedByName = ref<string | null | undefined>(params.resolvedByName || null);
  // For tracked-change threads: which decision resolved the thread
  // ('accept' | 'reject'). Null for plain comments and legacy payloads.
  const trackedChangeDecision = ref(params.trackedChangeDecision || null);

  /**
   * Mark this conversation as resolved with UTC date
   */
  const resolveComment = ({
    id,
    email,
    name,
    superdoc,
    decision,
    reconciliationToken,
  }: ResolveCommentParams): ReadOnlyMutationOutcome | undefined => {
    const isCanonicalReconciliation = reconciliationToken === COMMENT_RECONCILIATION_TOKEN;
    if (commentsAreReadOnly(superdoc) && !isCanonicalReconciliation) return readOnlyMutationOutcome();
    if (resolvedTime.value) return;
    resolvedTime.value = Date.now();
    resolvedById.value = id ?? null;
    resolvedByEmail.value = email;
    resolvedByName.value = name;
    if (decision === 'accept' || decision === 'reject') {
      trackedChangeDecision.value = decision;
    }

    const emitData = { type: comments_module_events.RESOLVED, comment: getValues() };
    propagateUpdate(superdoc, emitData);
  };

  /**
   * Update the isInternal value of this comment
   */
  const setIsInternal = ({
    isInternal: newIsInternal,
    superdoc,
  }: {
    isInternal: boolean;
    superdoc: CommentsHost;
  }): ReadOnlyMutationOutcome | undefined => {
    if (commentsAreReadOnly(superdoc)) return readOnlyMutationOutcome();
    const previousValue = isInternal.value;
    if (previousValue === newIsInternal) return;

    // Update the isInternal value
    isInternal.value = newIsInternal;

    const emitData = {
      type: comments_module_events.UPDATE,
      changes: [{ key: 'isInternal', value: newIsInternal, previousValue }],
      comment: getValues(),
    };
    propagateUpdate(superdoc, emitData);
  };

  /**
   *  Update the text value of this comment
   */
  const setText = ({ text, superdoc, suppressUpdate }: SetTextParams): ReadOnlyMutationOutcome | undefined => {
    if (!suppressUpdate && commentsAreReadOnly(superdoc)) return readOnlyMutationOutcome();
    commentText.value = text;

    // Track mentions
    mentions.value = extractMentions(text);

    if (suppressUpdate) return;

    const emitData = {
      type: comments_module_events.UPDATE,
      changes: [{ key: 'text', value: text }],
      comment: getValues(),
    };
    propagateUpdate(superdoc, emitData);
  };

  /**
   * Extract mentions from comment contents
   */
  const extractMentions = (htmlString: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const mentionElements = Array.from(doc.querySelectorAll('span[data-type="mention"]'));

    const uniqueMentions: CommentMention[] = [];
    mentionElements.forEach((span) => {
      const alreadyExists = uniqueMentions.some((m) => {
        const hasEmail = m.email === span.getAttribute('email');
        const hasName = m.name === span.getAttribute('name');
        return hasEmail && hasName;
      });

      if (!alreadyExists) {
        uniqueMentions.push({
          name: span.getAttribute('name'),
          email: span.getAttribute('email'),
        });
      }
    });

    return uniqueMentions;
  };

  /**
   * Update the selection bounds of this comment
   */
  const updatePosition = (coords: SelectionBounds, parentElement: Pick<Element, 'getBoundingClientRect'>) => {
    selection.source = DOCUMENT_EDITOR_SELECTION_SOURCE;
    const parentTop = parentElement?.getBoundingClientRect()?.top;

    const newCoords: SelectionBounds = {
      top: coords.top - parentTop,
      left: coords.left,
      right: coords.right,
      bottom: coords.bottom - parentTop,
    };
    selection.selectionBounds = newCoords;
  };

  const getCommentUser = () => {
    const user = importedAuthor.value
      ? { name: importedAuthor.value.name || '(Imported)', email: importedAuthor.value.email }
      : { id: creatorId.value, name: creatorName.value, email: creatorEmail.value, image: creatorImage.value };

    return user;
  };

  /**
   * Emit updates to the end client, and sync with collaboration if necessary
   */
  const propagateUpdate = (superdoc: CommentsHost, event: CommentsUpdateEvent) => {
    superdoc.emit('comments-update', event);
    syncCommentsToClients(superdoc, event);
  };

  const updateIdentityValues = (updates: CommentIdentity = {}) => {
    if (Object.prototype.hasOwnProperty.call(updates, 'commentId')) commentId = updates.commentId;
    if (Object.prototype.hasOwnProperty.call(updates, 'importedId')) importedId = updates.importedId;
    if (Object.prototype.hasOwnProperty.call(updates, 'parentCommentId')) parentCommentId = updates.parentCommentId;
    if (Object.prototype.hasOwnProperty.call(updates, 'trackedChangeParentId')) {
      trackedChangeParentId = updates.trackedChangeParentId;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'trackedChangeThreadParentId')) {
      trackedChangeThreadParentId.value = updates.trackedChangeThreadParentId;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'threadingParentCommentId')) {
      threadingParentCommentId = updates.threadingParentCommentId;
    }
  };

  /**
   * Get the raw values of this comment
   */
  const getValues = () => {
    return {
      uid: uid.value,
      commentId,
      importedId,
      parentCommentId,
      trackedChangeParentId,
      trackedChangeThreadParentId: trackedChangeThreadParentId.value,
      trackedChangeSide: trackedChangeSide.value,
      fileId,
      fileType,
      mentions: mentions.value.map((u) => {
        return { ...u, name: u.name ? u.name : u.email };
      }),
      createdAtVersionNumber,
      creatorId: creatorId.value,
      creatorEmail: creatorEmail.value,
      creatorName: creatorName.value,
      creatorImage: creatorImage.value,
      createdTime: createdTime.value,
      importedAuthor: importedAuthor.value,
      docxCommentJSON: docxCommentJSON.value,
      isInternal: isInternal.value,
      commentText: commentText.value,
      selection: selection ? selection.getValues() : null,
      trackedChange: trackedChange.value,
      trackedChangeText: trackedChangeText.value,
      trackedChangeType: trackedChangeType.value,
      trackedChangeDisplayType: trackedChangeDisplayType.value,
      semanticColorKey: semanticColorKey.value,
      semanticColor: semanticColor.value,
      trackedChangeStory: trackedChangeStory.value,
      trackedChangeStoryKind: trackedChangeStoryKind.value,
      trackedChangeStoryLabel: trackedChangeStoryLabel.value,
      trackedChangeAnchorKey: trackedChangeAnchorKey.value,
      trackedChangeCanonicalId: trackedChangeCanonicalId.value,
      trackedChangePositionAliases: trackedChangePositionAliases.value,
      trackedChangeDecision: trackedChangeDecision.value,
      trackedChangeLabel: trackedChangeLabel.value,
      trackedChangeDetailLines: trackedChangeDetailLines.value,
      trackedChangeImagePreview: trackedChangeImagePreview.value,
      customAttributes: customAttributes.value,
      deletedText: deletedText.value,
      resolvedTime: resolvedTime.value,
      resolvedById: resolvedById.value,
      resolvedByEmail: resolvedByEmail.value,
      resolvedByName: resolvedByName.value,
      origin,
      threadingMethod,
      threadingStyleOverride,
      threadingParentCommentId,
      originalXmlStructure,
    };
  };

  return reactive({
    uid,
    commentId,
    importedId,
    parentCommentId,
    trackedChangeParentId,
    trackedChangeThreadParentId,
    trackedChangeSide,
    fileId,
    fileType,
    mentions,
    commentElement,
    isFocused,
    creatorId,
    creatorEmail,
    creatorName,
    creatorImage,
    createdTime,
    isInternal,
    commentText,
    selection,
    floatingPosition,
    trackedChange,
    deletedText,
    trackedChangeType,
    trackedChangeText,
    trackedChangeDisplayType,
    semanticColorKey,
    semanticColor,
    trackedChangeStory,
    trackedChangeStoryKind,
    trackedChangeStoryLabel,
    trackedChangeAnchorKey,
    trackedChangeCanonicalId,
    trackedChangePositionAliases,
    trackedChangeDecision,
    trackedChangeLabel,
    trackedChangeDetailLines,
    trackedChangeImagePreview,
    customAttributes,
    resolvedTime,
    resolvedById,
    resolvedByEmail,
    resolvedByName,
    importedAuthor,
    docxCommentJSON,
    origin,
    threadingMethod,
    threadingStyleOverride,
    threadingParentCommentId,
    originalXmlStructure,

    // Actions
    setText,
    getValues,
    resolveComment,
    setIsInternal,
    updatePosition,
    getCommentUser,
    updateIdentityValues,
  });
}

export type CommentModel = ReturnType<typeof useComment>;
