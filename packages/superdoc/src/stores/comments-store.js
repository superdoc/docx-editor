import { defineStore } from 'pinia';
import { ref, shallowRef, reactive, computed, watch, isReactive } from 'vue';
import { comments_module_events } from '@superdoc/common';
import { useSuperdocStore } from '@superdoc/stores/superdoc-store';
import { syncCommentsToClients } from '../core/collaboration/helpers.js';
import useComment, { COMMENT_RECONCILIATION_TOKEN } from '@superdoc/components/CommentsLayer/use-comment';
import { DOCUMENT_EDITOR_SELECTION_SOURCE } from '../helpers/selection-source.js';
import { buildFloatingCommentInstances } from './helpers/floating-comment-instances.js';
import {
  isSyntheticTrackedChangeCommentLaneItem,
  isV2SyntheticTrackedChangeRow,
} from '../core/v2-integration/v2-integration.js';
import { endInteractionSpan, startInteractionSpan, withInteractionSpan } from '../helpers/interaction-trace.js';
import {
  buildTrackedChangeDecisionLinkIndex,
  buildTrackedChangeThreadOwnerIndex,
  buildTrackedChangeThreadIndex,
} from './helpers/tracked-change-thread-index.js';
import { trackedChangeThreadParentIdForComment as resolveTrackedChangeThreadParentId } from '../components/CommentsLayer/tracked-change-threading.js';
import { normalizeV2CommentDraftText } from './helpers/comment-draft-text.js';
import {
  cloneV2TrackedChangeStory,
  makeTrackedChangeAnchorKey,
  normalizeTrackedChangeCustomAttributes,
  normalizeTrackedChangeDetailLines,
  normalizeTrackedChangeImagePreview,
  shallowEqual,
  trackedChangeCustomAttributesEqual,
  trackedChangeDetailLinesEqual,
} from './helpers/tracked-change-row-values.js';

export const useCommentsStore = defineStore('comments', () => {
  const BODY_TRACKED_CHANGE_STORY = { kind: 'story', storyType: 'body' };

  const isBodyTrackedChangeComment = (comment) => {
    if (!comment?.trackedChange) return false;
    const storyType = comment?.trackedChangeStory?.storyType;
    if (storyType == null || storyType === 'body') return true;
    return comment?.trackedChangeAnchorKey?.startsWith?.('tc::body::') === true;
  };

  const buildBodyTrackedChangeAnchorKey = (rawId) => {
    if (rawId === undefined || rawId === null) return null;
    return makeTrackedChangeAnchorKey({ storyKey: 'body', rawId: String(rawId) });
  };

  const parseTrackedChangeAnchorKey = (anchorKey) => {
    const normalized = normalizeCommentId(anchorKey);
    if (!normalized?.startsWith('tc::')) return null;
    const separatorIndex = normalized.indexOf('::', 'tc::'.length);
    if (separatorIndex <= 'tc::'.length) return null;
    const storyKey = normalized.slice('tc::'.length, separatorIndex);
    const rawId = normalized.slice(separatorIndex + 2);
    if (!storyKey || !rawId) return null;
    return { storyKey, rawId };
  };

  const buildTrackedChangeAnchorKeyForStory = (storyKey, rawId) => {
    if (rawId === undefined || rawId === null) return null;
    return makeTrackedChangeAnchorKey({ storyKey: storyKey || 'body', rawId: String(rawId) });
  };

  const superdocStore = useSuperdocStore();
  const commentsConfig = reactive({
    name: 'comments',
    readOnly: false,
    allowResolve: true,
    showResolved: false,
  });
  const readOnlyMutationOutcome = () => ({ ok: false, reason: 'read-only-document' });
  // `allowResolve: false` is a policy, not a presentation choice: the built-in
  // dialog and header already hide the affordance, but a custom comment UI
  // drives these same mutations directly and has to be refused too.
  const resolveDisabledOutcome = () => ({ ok: false, reason: 'resolve-disabled' });
  const resolveIsDisabled = () => commentsConfig.allowResolve === false;
  const commentsAreReadOnly = () => commentsConfig.readOnly === true;
  const trackedChangeDecisionDisabledReason = (superdoc) => {
    const allowDecisions = superdoc?.interactionConfig?.trackedChanges?.allowDecisions;
    if (allowDecisions === true) return null;
    if (allowDecisions === false) {
      return commentsAreReadOnly() ? 'read-only-document' : 'tracked-change-decisions-disabled';
    }
    return commentsAreReadOnly() ? 'read-only-document' : null;
  };
  const viewingVisibility = reactive({
    documentMode: 'editing',
    commentsVisible: false,
    trackChangesVisible: false,
  });

  const debounceTimers = {};
  const trackedChangeResolutionSnapshots = new WeakMap();

  const isBenchmarkCommentsDebugEnabled = () => {
    if (typeof window === 'undefined') return false;
    return '__labsSuperDocV2BenchmarkDebug' in window;
  };

  const traceBenchmarkComments = (label, payload = null) => {
    if (!isBenchmarkCommentsDebugEnabled()) return;
    if (payload !== null) {
      console.debug('[SuperDoc][comments-store]', label, payload);
      return;
    }
    console.debug('[SuperDoc][comments-store]', label);
  };

  const COMMENT_EVENTS = comments_module_events;
  const hasSyncedCollaborationComments = ref(false);
  const commentsParentElement = ref(null);
  const hasInitializedLocations = ref(false);
  const activeComment = ref(null);
  const activeFloatingCommentInstanceId = ref(null);
  const editingCommentId = ref(null);
  const suppressInternalExternal = ref(true);
  const currentCommentText = ref('');
  const currentCommentMentions = ref([]);
  let commentDraftRevision = 0;
  watch([currentCommentText, currentCommentMentions], () => commentDraftRevision++, { deep: true, flush: 'sync' });
  const commentsList = ref([]);
  // Complete review inventory for the explicit document panel only. Floating
  // presentation and geometry continue to consume the bounded commentsList.
  const reviewDirectoryList = shallowRef([]);
  let priorTrackedChangeThreadIndex = new Map();
  const trackedChangeThreadIndex = computed(() => {
    const next = buildTrackedChangeThreadIndex(commentsList.value, priorTrackedChangeThreadIndex);
    priorTrackedChangeThreadIndex = next;
    return next;
  });
  const getTrackedChangeThread = (parentComment) => {
    const id = parentComment?.commentId ?? null;
    return (id != null ? trackedChangeThreadIndex.value.get(id) : null) ?? [parentComment].filter(Boolean);
  };
  let priorTrackedChangeDecisionLinkIndex = new Map();
  const trackedChangeDecisionLinkIndex = computed(() => {
    const next = buildTrackedChangeDecisionLinkIndex(commentsList.value, priorTrackedChangeDecisionLinkIndex);
    priorTrackedChangeDecisionLinkIndex = next;
    return next;
  });
  const isCommentsListVisible = ref(false);
  const isReviewDirectoryActive = ref(false);
  const isReviewDirectoryLoading = ref(false);
  const editorCommentIds = ref([]);
  const editorCommentPositions = ref({});
  const isCommentHighlighted = ref(false);

  // Floating comments
  const floatingCommentsOffset = ref(0);
  const committedReviewPresentations = shallowRef({});
  const skipSelectionUpdate = ref(false);
  const isFloatingCommentsReady = ref(false);
  const generalCommentIds = ref([]);
  const instantSidebarAlignmentTargetY = ref(null);
  const instantSidebarAlignmentThreadId = ref(null);
  const instantSidebarAlignmentInstanceId = ref(null);

  const pendingComment = ref(null);
  const pendingV2CommentTarget = shallowRef(null);
  let pendingCommentRequest = 0;
  const isViewingMode = computed(() => viewingVisibility.documentMode === 'viewing');

  // Single reactive authority for whether review (comment / tracked-change)
  // geometry should be emitted in the current mode. In viewing mode this is true
  // only when comments or tracked changes are explicitly visible; in editing /
  // suggesting it is always true. SuperDoc.vue consumes this instead of polling
  // mutable `config` reads, so V2 geometry/layout decisions and the comments
  // store stay on one source of truth across `setDocumentMode` transitions.
  const shouldRenderReviewInViewing = computed(() => {
    if (!isViewingMode.value) return true;
    return viewingVisibility.commentsVisible || viewingVisibility.trackChangesVisible;
  });

  // ui-phase3-002: SuperDoc-facing v2 comments adapter. Populated by
  // SuperDoc.vue on `v2-editor-ready` so the store can route create / reply
  // / edit / resolve / delete through the v2 host APIs instead of v1
  // `activeEditor.commands`.
  // shallowRef: preserve object identity. Vue's `ref()` deep-wraps assigned
  // objects via `reactive()`, which would break the stamping identity check
  // (`v2CommentsAdapter.value === adapter`). The adapter is opaque to the
  // store; we never read reactive properties off it.
  const v2CommentsAdapter = shallowRef(null);
  const setV2CommentsAdapter = (adapter) => {
    if (v2CommentsAdapter.value !== (adapter ?? null)) pendingCommentRequest += 1;
    v2CommentsAdapter.value = adapter ?? null;
  };
  const getV2CommentsAdapter = (superdoc) => {
    const fromFacade = superdoc?.activeEditor?.v2Comments ?? null;
    if (fromFacade) return fromFacade;
    return v2CommentsAdapter.value;
  };
  const isV2EditorActive = (superdoc) =>
    superdoc?.activeEditor?.editorVersion === 2 || v2CommentsAdapter.value !== null;

  // ui-phase3-003: SuperDoc-facing v2 tracked-change adapter. Populated by
  // SuperDoc.vue on `v2-editor-ready` so the store can list / focus / decide
  // tracked changes. Mutation-plane consolidation: sidebar accept/reject route
  // through the adapter's temporary compatibility wrappers, which delegate to
  // `activeEditor.doc.trackChanges.decide(...)` — not `host.dispatch(...)`.
  // shallowRef: preserve object identity for stamping. See note on
  // `v2CommentsAdapter` above.
  const v2TrackedChangesAdapter = shallowRef(null);
  const setV2TrackedChangesAdapter = (adapter) => {
    v2TrackedChangesAdapter.value = adapter ?? null;
  };
  const getV2TrackedChangesAdapter = (superdoc) => {
    const fromFacade = superdoc?.activeEditor?.v2TrackedChanges ?? null;
    if (fromFacade) return fromFacade;
    return v2TrackedChangesAdapter.value;
  };
  /**
   * Initialize the store
   *
   * @param {Object} config The comments module config from SuperDoc
   * @returns {void}
   */
  const init = (config = {}) => {
    const updatedConfig = { ...commentsConfig, ...config };
    Object.assign(commentsConfig, updatedConfig);

    suppressInternalExternal.value = commentsConfig.suppressInternalExternal || false;

    // Map initial comments state
    if (config.comments && config.comments.length) {
      commentsList.value = config.comments?.map((c) => useComment(c)) || [];
    }
  };

  const normalizeCommentId = (id) => (id === undefined || id === null ? null : String(id));

  const normalizeTrackedChangePositionAliases = (aliases) => {
    if (!Array.isArray(aliases)) return [];
    return [...new Set(aliases.map((id) => normalizeCommentId(id)).filter(Boolean))];
  };

  const getTrackedChangeStoryKey = (comment) => {
    if (!comment?.trackedChange) return null;

    const anchorParts = parseTrackedChangeAnchorKey(comment.trackedChangeAnchorKey);
    if (anchorParts?.storyKey) return anchorParts.storyKey;

    const story = comment.trackedChangeStory;
    switch (story?.storyType) {
      case 'body':
        return 'body';
      case 'headerFooterPart':
        return story.refId ? `hf:${story.refId}` : null;
      case 'footnote':
        return story.noteId ? `fn:${story.noteId}` : null;
      case 'endnote':
        return story.noteId ? `en:${story.noteId}` : null;
      case 'textbox':
        return story.textboxId ? `textbox:${story.textboxId}` : null;
      default:
        return null;
    }
  };

  const normalizeTrackedChangeStoryKey = (storyKey) => {
    if (storyKey?.startsWith('hf:part:')) return `hf:${storyKey.slice('hf:part:'.length)}`;
    if (storyKey?.startsWith('headerFooterPart:')) return `hf:${storyKey.slice('headerFooterPart:'.length)}`;
    return storyKey;
  };

  const trackedChangeStoryKeysAreCompatible = (leftStoryKey, rightStoryKey) => {
    const left = normalizeTrackedChangeStoryKey(leftStoryKey);
    const right = normalizeTrackedChangeStoryKey(rightStoryKey);
    return !left || !right || left === right;
  };

  const positionEntryMatchesTrackedChangeStory = (entry, comment) => {
    const expectedStoryKey = normalizeTrackedChangeStoryKey(getTrackedChangeStoryKey(comment));
    const entryStoryKey = normalizeTrackedChangeStoryKey(normalizeCommentId(entry?.storyKey));
    return trackedChangeStoryKeysAreCompatible(expectedStoryKey, entryStoryKey);
  };

  const buildTrackedChangeImportedPositionId = (id) => {
    const normalizedId = normalizeCommentId(id);
    if (!normalizedId) return null;
    return normalizedId.startsWith('imported:') ? normalizedId : `imported:${normalizedId}`;
  };

  const positionEntriesByAlias = computed(() => {
    const aliases = new Map();
    for (const [key, entry] of Object.entries(editorCommentPositions.value || {})) {
      for (const alias of [normalizeCommentId(entry?.key), normalizeCommentId(entry?.threadId)]) {
        if (alias && !aliases.has(alias)) aliases.set(alias, { key, entry });
      }
    }
    return aliases;
  });

  const getPositionEntryByAlias = (id) => {
    const normalizedId = normalizeCommentId(id);
    if (!normalizedId) return { key: null, entry: null };

    const positions = editorCommentPositions.value || {};
    if (positions[normalizedId] !== undefined) {
      return { key: normalizedId, entry: positions[normalizedId] };
    }

    return positionEntriesByAlias.value.get(normalizedId) ?? { key: null, entry: null };
  };

  const boundsOverlap = (a, b) => {
    if (!a || !b) return false;
    const left = Math.max(Number(a.left), Number(b.left));
    const right = Math.min(Number(a.right), Number(b.right));
    const top = Math.max(Number(a.top), Number(b.top));
    const bottom = Math.min(Number(a.bottom), Number(b.bottom));
    return [left, right, top, bottom].every(Number.isFinite) && right > left && bottom > top;
  };

  const isEquivalentTrackedChangePosition = (candidate, existing) => {
    if (!candidate || !existing) return false;
    if (candidate.kind !== 'trackedChange' || existing.kind !== 'trackedChange') return false;
    if (candidate.storyKey && existing.storyKey && candidate.storyKey !== existing.storyKey) return false;
    const candidatePage = Number(candidate.pageIndex);
    const existingPage = Number(existing.pageIndex);
    if (Number.isFinite(candidatePage) && Number.isFinite(existingPage) && candidatePage !== existingPage) {
      return false;
    }

    if (boundsOverlap(candidate.bounds, existing.bounds)) return true;

    const candidateStart = Number(candidate.start);
    const candidateEnd = Number(candidate.end);
    const existingStart = Number(existing.start);
    const existingEnd = Number(existing.end);
    return (
      [candidateStart, candidateEnd, existingStart, existingEnd].every(Number.isFinite) &&
      candidateStart === existingStart &&
      candidateEnd === existingEnd
    );
  };

  const getTrackedChangeCommentByPositionAlias = (id) => {
    const { entry: targetEntry } = getPositionEntryByAlias(id);
    if (!targetEntry) return null;

    const matches = commentsList.value.filter((comment) => {
      if (!comment?.trackedChange) return false;

      return getCommentAliasIds(comment).some((alias) => {
        const { entry } = getPositionEntryByAlias(alias);
        return isEquivalentTrackedChangePosition(targetEntry, entry);
      });
    });

    return matches.length === 1 ? matches[0] : null;
  };

  const commentIdentityIndex = computed(() => {
    const list = commentsList.value;
    if (!isReactive(list)) return null;
    const primary = new Map();
    const aliases = new Map();
    for (const comment of list) {
      if (!isReactive(comment)) return null;
      for (const key of ['commentId', 'importedId', 'trackedChangeAnchorKey', 'trackedChange']) {
        const descriptor = Object.getOwnPropertyDescriptor(comment, key);
        if (descriptor?.get || descriptor?.set || (!descriptor && key in comment)) return null;
      }
      const ids = [comment.commentId, comment.importedId, comment.trackedChangeAnchorKey];
      if (ids.some((id) => id != null && typeof id !== 'string')) return null;
      if (ids[0] != null && !primary.has(ids[0])) primary.set(ids[0], comment);
      const importedPositionId = comment.trackedChange ? buildTrackedChangeImportedPositionId(ids[1]) : null;
      for (const alias of [ids[1], ids[2], importedPositionId]) {
        if (alias != null && !aliases.has(alias)) aliases.set(alias, comment);
      }
    }
    return { primary, aliases };
  });

  /**
   * Get a comment by either ID or imported ID
   *
   * @param {string} id The comment ID
   * @returns {Record<string, unknown> | null | undefined} The comment object, `null` if no id was provided, or `undefined` if not found.
   */
  const getComment = (id) => {
    if (id === undefined || id === null) return null;
    // Real Word comment ids and tracked-change rows' raw OOXML `w:id` (exposed
    // here as `importedId`) are independent numbering sequences that commonly
    // collide on the same small integer (e.g. comment "2" and tracked-change
    // insert w:id="2" in the same document). Resolve primary ids before alias
    // ids inside each backing list so a tracked-change alias never wins over a
    // real comment that lives in that same list, while preserving the existing
    // cross-list precedence of commentsList before reviewDirectoryList.
    const byPrimaryId = (c) => c.commentId == id;
    const byAliasId = (c) =>
      c.importedId == id ||
      c.trackedChangeAnchorKey == id ||
      (c?.trackedChange && buildTrackedChangeImportedPositionId(c.importedId) == id);
    const findIn = (list) => list.find(byPrimaryId) ?? list.find(byAliasId);
    const index = typeof id === 'string' ? commentIdentityIndex.value : null;
    const comment = index ? (index.primary.get(id) ?? index.aliases.get(id)) : findIn(commentsList.value);
    return comment ?? findIn(reviewDirectoryList.value) ?? getTrackedChangeCommentByPositionAlias(id);
  };

  const getThreadParent = (comment) => {
    if (!comment?.parentCommentId) return comment;
    return getComment(comment.parentCommentId);
  };

  const trackedChangeThreadParentIdForComment = (comment) => {
    if (comment?.trackedChangeThreadParentId) return comment.trackedChangeThreadParentId;
    if (isV2SyntheticTrackedChangeRow(comment) && comment?.trackedChange === true) return null;
    return resolveTrackedChangeThreadParentId(comment);
  };

  /**
   * Extract the position lookup key from a comment or comment ID.
   * Prefers whichever key currently exists in editorCommentPositions.
   *
   * @param {Object | string | null | undefined} commentOrId The comment object or comment ID
   * @returns {string | null} The position key
   */
  const getCommentPositionKey = (commentOrId) => {
    if (!commentOrId) return null;

    const positions = editorCommentPositions.value || {};

    if (typeof commentOrId === 'string') {
      if (positions[commentOrId]) {
        return commentOrId;
      }

      const resolvedComment = getComment(commentOrId);
      if (!resolvedComment) {
        return commentOrId;
      }

      const commentId = resolvedComment.commentId ?? null;
      const importedId = resolvedComment.importedId ?? null;
      const importedPositionId = resolvedComment.trackedChange
        ? buildTrackedChangeImportedPositionId(importedId)
        : null;
      const trackedChangeAnchorKey = resolvedComment.trackedChangeAnchorKey ?? null;
      if (trackedChangeAnchorKey && positions[trackedChangeAnchorKey]) return trackedChangeAnchorKey;
      if (commentId && positions[commentId]) return commentId;
      if (importedId && positions[importedId]) return importedId;
      if (importedPositionId && positions[importedPositionId]) return importedPositionId;
      return trackedChangeAnchorKey ?? commentId ?? importedPositionId ?? importedId ?? null;
    }

    const commentId = commentOrId.commentId ?? null;
    const importedId = commentOrId.importedId ?? null;
    const importedPositionId = commentOrId.trackedChange ? buildTrackedChangeImportedPositionId(importedId) : null;
    const trackedChangeAnchorKey = commentOrId.trackedChangeAnchorKey ?? null;
    if (trackedChangeAnchorKey && positions[trackedChangeAnchorKey]) return trackedChangeAnchorKey;
    if (commentId && positions[commentId]) return commentId;
    if (importedId && positions[importedId]) return importedId;
    if (importedPositionId && positions[importedPositionId]) return importedPositionId;
    return trackedChangeAnchorKey ?? commentId ?? importedPositionId ?? importedId ?? null;
  };

  // Comments can be referenced by the imported DOCX id, the internal commentId, or a raw id
  // coming from UI/editor events. Normalize everything to strings and keep all aliases so every
  // lookup path resolves against the same set of ids.
  const getCommentAliasIds = (commentOrId) => {
    if (commentOrId === undefined || commentOrId === null) return [];

    const rawId = typeof commentOrId === 'object' ? null : commentOrId;
    const comment = typeof commentOrId === 'object' ? commentOrId : getComment(commentOrId);
    const trackedChangePositionAliases = comment?.trackedChange
      ? normalizeTrackedChangePositionAliases(comment?.trackedChangePositionAliases)
      : [];
    const trackedChangeStoryKey = normalizeTrackedChangeStoryKey(getTrackedChangeStoryKey(comment));
    const seen = new Set();

    return [
      rawId,
      getCommentPositionKey(comment),
      comment?.trackedChangeAnchorKey,
      comment?.commentId,
      comment?.importedId,
      comment?.trackedChange ? buildTrackedChangeImportedPositionId(comment?.importedId) : null,
      ...trackedChangePositionAliases.flatMap((id) => [
        trackedChangeStoryKey && !id.startsWith('tc::')
          ? makeTrackedChangeAnchorKey({ storyKey: trackedChangeStoryKey, rawId: id })
          : null,
        id,
      ]),
    ]
      .map((id) => normalizeCommentId(id))
      .filter((id) => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  };

  const resolveCommentPositionEntry = (commentOrId, preferredId) => {
    const currentPositions = editorCommentPositions.value || {};
    const comment = typeof commentOrId === 'object' ? commentOrId : getComment(commentOrId);
    const seen = new Set();

    for (const key of [preferredId, ...getCommentAliasIds(commentOrId)]
      .map((id) => normalizeCommentId(id))
      .filter(Boolean)) {
      if (seen.has(key)) continue;
      seen.add(key);

      const entry = currentPositions[key];
      if (entry !== undefined && positionEntryMatchesTrackedChangeStory(entry, comment)) {
        return { key, entry };
      }
    }

    return { key: null, entry: null };
  };

  const clearResolvedMetadata = (comment) => {
    if (!comment) return;
    if (
      comment.resolvedTime != null ||
      comment.resolvedById != null ||
      comment.resolvedByEmail != null ||
      comment.resolvedByName != null
    ) {
      trackedChangeResolutionSnapshots.set(comment, {
        resolvedTime: comment.resolvedTime ?? null,
        resolvedById: comment.resolvedById ?? null,
        resolvedByEmail: comment.resolvedByEmail ?? null,
        resolvedByName: comment.resolvedByName ?? null,
        trackedChangeDecision: comment.trackedChangeDecision ?? null,
      });
    }
    // Sets the resolved state to null so it can be restored in the comments sidebar
    comment.resolvedTime = null;
    comment.resolvedById = null;
    comment.resolvedByEmail = null;
    comment.resolvedByName = null;
    comment.trackedChangeDecision = null;
  };

  const getCommentEventPayload = (comment) =>
    typeof comment?.getValues === 'function' ? comment.getValues() : { ...comment };

  /**
   * Check if a comment originated from the document editor (or has no explicit source).
   * Comments without a source are assumed to be editor-backed for backward compatibility.
   *
   * @param {Object} comment - The comment to check
   * @returns {boolean} True if the comment is editor-backed
   */
  const isEditorBackedComment = (comment) => {
    const source = comment?.selection?.source;
    if (source == null) return true;
    return source === DOCUMENT_EDITOR_SELECTION_SOURCE;
  };

  const isTrackedChangeThread = (comment) =>
    Boolean(comment?.trackedChange) || Boolean(trackedChangeThreadParentIdForComment(comment));

  const syncResolvedCommentsWithDocument = () => {
    // V2 comment lifecycle is owned by the browser Document API list refresh
    // after a committed mutation. The legacy DOM/position heuristic can lag a
    // paint behind and clear only the root, creating an open-root/resolved-reply
    // split after a coherent v2 refresh.
    if (v2CommentsAdapter.value) return 0;
    const docPositions = editorCommentPositions.value || {};
    const activeKeys = new Set(Object.keys(docPositions));
    if (!activeKeys.size) return 0;

    let changed = 0;
    commentsList.value.forEach((comment) => {
      if (!isEditorBackedComment(comment) || isTrackedChangeThread(comment)) return;

      const { key } = resolveCommentPositionEntry(comment);
      if (!key) return;

      const hasActiveAnchor = activeKeys.has(String(key));
      if (hasActiveAnchor && comment.resolvedTime != null) {
        clearResolvedMetadata(comment);
        changed += 1;
      }
    });

    return changed;
  };

  /* The watchers below are used to sync the resolved state of comments with the document.
   *  This is especially useful for undo/redo operations that are not handled by the editor.
   */
  watch(editorCommentPositions, () => {
    syncResolvedCommentsWithDocument();
  });

  watch(
    commentsList,
    () => {
      canonicalizeActiveCommentAlias();
      syncResolvedCommentsWithDocument();
    },
    { deep: false },
  );

  /**
   * Get the editor position data for a comment.
   *
   * @param {Object | string} commentOrId The comment object or comment ID
   * @returns {Object | null} The position data from editorCommentPositions
   */
  const getCommentPosition = (commentOrId) => {
    return resolveCommentPositionEntry(commentOrId).entry ?? null;
  };

  const isThreadVisible = (comment) => {
    if (!isViewingMode.value) return true;
    const parent = getThreadParent(comment);
    if (!parent && comment?.parentCommentId) return false;
    const isTrackedChange = Boolean(parent?.trackedChange) || Boolean(trackedChangeThreadParentIdForComment(comment));
    return isTrackedChange ? viewingVisibility.trackChangesVisible : viewingVisibility.commentsVisible;
  };

  /**
   * Set the active comment or clear all active comments
   *
   * @param {Object | undefined | null} superdoc The SuperDoc instance holding the active editor
   * @param {string | undefined | null} id The comment ID
   * @returns {void}
   */
  const setActiveComment = (superdoc, id) => {
    const activeEditor = superdoc?.activeEditor;
    const v2Adapter = getV2CommentsAdapter(superdoc);

    // If no ID, we clear any focused comments
    if (id === undefined || id === null) {
      clearActiveCommentSelection();
      if (v2Adapter) {
        void v2Adapter.setActiveComment(null);
        return;
      }
      activeEditor?.commands?.setActiveComment({ commentId: null });
      return;
    }

    const comment = getComment(id);
    if (!comment) {
      return;
    }

    activeComment.value = comment.commentId;
    syncActiveFloatingInstanceWithComment(comment.commentId);
    if (v2Adapter) {
      // v2 mode: route through the review state target. Never touch v1 commands.
      void v2Adapter.setActiveComment(comment.commentId);
      return;
    }
    activeEditor?.commands?.setActiveComment({ commentId: activeComment.value });
  };

  /**
   * Called when a tracked change is updated. Creates a new comment if necessary,
   * or updates an existing tracked-change comment.
   *
   * @param {Object} param0
   * @param {Object} param0.superdoc The SuperDoc instance
   * @param {Object} param0.params The tracked change params
   * @returns {void}
   */
  const handleTrackedChangeUpdate = ({
    superdoc,
    params,
    broadcastChanges = true,
    trackedChangeIdentityIndex = null,
  }) => {
    const span = startInteractionSpan('store.trackedChanges.handleUpdate', 'store-reconciliation', {
      event: params?.event ?? null,
      changeId: params?.changeId ?? null,
      documentId: params?.documentId ?? null,
    });
    try {
      const {
        event,
        changeId,
        trackedChangeText,
        trackedChangeType,
        trackedChangeDisplayType,
        semanticColorKey,
        semanticColor,
        deletedText,
        trackedChangeLabel,
        trackedChangeDetailLines,
        trackedChangeImagePreview,
        customAttributes,
        authorId,
        authorEmail,
        authorImage,
        date,
        author: authorName,
        importedAuthor,
        documentId,
        coords,
        trackedChangeStory,
        trackedChangeStoryKind,
        trackedChangeStoryLabel,
        trackedChangeAnchorKey,
        trackedChangeCanonicalId,
        trackedChangePositionAliases,
        importedId,
      } = params;
      const normalizedChangeId = changeId != null ? String(changeId) : null;
      const normalizedTrackedChangeCanonicalId =
        trackedChangeCanonicalId != null ? String(trackedChangeCanonicalId) : null;
      const hasTrackedChangePositionAliases = Object.prototype.hasOwnProperty.call(
        params,
        'trackedChangePositionAliases',
      );
      const normalizedTrackedChangePositionAliases = hasTrackedChangePositionAliases
        ? normalizeTrackedChangePositionAliases(trackedChangePositionAliases)
        : undefined;
      const hasImportedId = Object.prototype.hasOwnProperty.call(params, 'importedId');
      const hasCustomAttributes = Object.prototype.hasOwnProperty.call(params, 'customAttributes');
      const normalizedCustomAttributes = hasCustomAttributes
        ? normalizeTrackedChangeCustomAttributes(customAttributes)
        : undefined;
      const normalizedImportedId = hasImportedId ? (importedId != null ? String(importedId) : null) : undefined;
      const normalizedDocumentId = documentId != null ? String(documentId) : null;

      const hasStoryMetadata =
        trackedChangeStory !== undefined ||
        trackedChangeStoryKind !== undefined ||
        trackedChangeStoryLabel !== undefined ||
        trackedChangeAnchorKey !== undefined;
      const normalizedTrackedChangeStory = hasStoryMetadata ? (trackedChangeStory ?? null) : BODY_TRACKED_CHANGE_STORY;
      const normalizedTrackedChangeStoryKind = hasStoryMetadata ? (trackedChangeStoryKind ?? null) : 'body';
      const normalizedTrackedChangeStoryLabel =
        hasStoryMetadata && trackedChangeStoryLabel !== undefined ? trackedChangeStoryLabel : '';
      const normalizedTrackedChangeAnchorKey =
        trackedChangeAnchorKey !== undefined
          ? (trackedChangeAnchorKey ?? null)
          : hasStoryMetadata
            ? null
            : buildBodyTrackedChangeAnchorKey(normalizedChangeId);
      const normalizedTrackedChangeLabel =
        typeof trackedChangeLabel === 'string' && trackedChangeLabel.length > 0 ? trackedChangeLabel : null;
      const normalizedTrackedChangeDetailLines = normalizeTrackedChangeDetailLines(trackedChangeDetailLines);
      const normalizedTrackedChangeImagePreview = normalizeTrackedChangeImagePreview(trackedChangeImagePreview);

      const comment = getPendingComment({
        documentId,
        commentId: changeId,
        trackedChange: true,
        trackedChangeText,
        trackedChangeType,
        trackedChangeDisplayType,
        semanticColorKey,
        semanticColor,
        deletedText,
        trackedChangeLabel: normalizedTrackedChangeLabel,
        trackedChangeDetailLines: normalizedTrackedChangeDetailLines,
        trackedChangeImagePreview: normalizedTrackedChangeImagePreview,
        ...(hasCustomAttributes ? { customAttributes: normalizedCustomAttributes } : {}),
        createdTime: date,
        creatorId: authorId ?? null,
        creatorName: authorName,
        creatorEmail: authorEmail,
        creatorImage: authorImage,
        isInternal: false,
        importedAuthor,
        ...(hasImportedId ? { importedId: normalizedImportedId } : {}),
        trackedChangeStory: normalizedTrackedChangeStory,
        trackedChangeStoryKind: normalizedTrackedChangeStoryKind,
        trackedChangeStoryLabel: normalizedTrackedChangeStoryLabel,
        trackedChangeAnchorKey: normalizedTrackedChangeAnchorKey,
        trackedChangeCanonicalId: normalizedTrackedChangeCanonicalId,
        ...(hasTrackedChangePositionAliases
          ? { trackedChangePositionAliases: normalizedTrackedChangePositionAliases }
          : {}),
        selection: {
          source: DOCUMENT_EDITOR_SELECTION_SOURCE,
          selectionBounds: coords,
        },
      });

      const findTrackedChangeById = () => {
        const normalizedAnchorKey =
          normalizedTrackedChangeAnchorKey != null ? String(normalizedTrackedChangeAnchorKey) : null;
        if (!normalizedChangeId) return null;
        const incomingStoryKey = getTrackedChangeStoryKey(comment);

        const matchesId = (trackedComment) => {
          if (!trackedComment) return false;
          const commentAnchorKey =
            trackedComment.trackedChangeAnchorKey != null ? String(trackedComment.trackedChangeAnchorKey) : null;
          const commentId = trackedComment.commentId != null ? String(trackedComment.commentId) : null;
          const importedId = trackedComment.importedId != null ? String(trackedComment.importedId) : null;
          const commentCanonicalId =
            trackedComment.trackedChangeCanonicalId != null ? String(trackedComment.trackedChangeCanonicalId) : null;
          if (
            normalizedTrackedChangeCanonicalId &&
            commentCanonicalId &&
            normalizedTrackedChangeCanonicalId !== commentCanonicalId
          ) {
            return false;
          }
          const hasCompatibleStory = trackedChangeStoryKeysAreCompatible(
            getTrackedChangeStoryKey(trackedComment),
            incomingStoryKey,
          );
          const commentAliasIds = hasCompatibleStory
            ? (trackedChangeIdentityIndex?.aliasesFor?.(trackedComment) ?? getCommentAliasIds(trackedComment))
            : [];
          if (hasCompatibleStory && commentAliasIds.includes(normalizedChangeId)) return true;
          const incomingAliasIds = new Set(normalizedTrackedChangePositionAliases ?? []);
          if (
            hasCompatibleStory &&
            incomingAliasIds.size > 0 &&
            [commentId, importedId, commentCanonicalId, commentAnchorKey, ...commentAliasIds]
              .filter(Boolean)
              .some((id) => incomingAliasIds.has(id))
          ) {
            return true;
          }

          const hasSyntheticSideIdentity =
            (normalizedTrackedChangeCanonicalId && normalizedTrackedChangeCanonicalId !== normalizedChangeId) ||
            (commentCanonicalId && commentCanonicalId !== commentId);
          if (hasCompatibleStory && commentId === normalizedChangeId) return true;
          if (
            hasCompatibleStory &&
            !hasSyntheticSideIdentity &&
            (importedId === normalizedChangeId ||
              (normalizedImportedId !== undefined &&
                normalizedImportedId != null &&
                importedId === normalizedImportedId))
          ) {
            return true;
          }
          if (hasSyntheticSideIdentity) return false;

          if (normalizedAnchorKey && commentAnchorKey) {
            return commentAnchorKey === normalizedAnchorKey;
          }
          return false;
        };

        if (trackedChangeIdentityIndex) {
          const candidates = trackedChangeIdentityIndex.candidates({
            changeId: normalizedChangeId,
            importedId: normalizedImportedId,
            anchorKey: normalizedAnchorKey,
            canonicalId: normalizedTrackedChangeCanonicalId,
            positionAliases: normalizedTrackedChangePositionAliases,
          });
          for (const trackedComment of candidates) {
            if (
              matchesId(trackedComment) &&
              (!normalizedDocumentId || belongsToTrackedChangeSyncDocument(trackedComment, normalizedDocumentId))
            ) {
              return trackedComment;
            }
          }
          return null;
        }

        if (normalizedDocumentId) {
          return commentsList.value.find(
            (trackedComment) =>
              matchesId(trackedComment) && belongsToTrackedChangeSyncDocument(trackedComment, normalizedDocumentId),
          );
        }

        return commentsList.value.find(matchesId);
      };

      const emitTrackedChangeEvent = (event) => {
        if (!broadcastChanges) return;
        syncCommentsToClients(superdoc, event);
        debounceEmit(changeId, event, superdoc);
      };

      const setIfChanged = (target, key, value) => {
        if (target?.[key] == null && value == null) return false;
        if (!target || shallowEqual(target[key], value)) return false;
        target[key] = value;
        return true;
      };

      const applyStoryMetadata = (target) => {
        if (!target) return false;
        let didChange = false;
        if (normalizedTrackedChangeStory !== undefined && normalizedTrackedChangeStory !== null) {
          didChange = setIfChanged(target, 'trackedChangeStory', normalizedTrackedChangeStory) || didChange;
        }
        if (normalizedTrackedChangeStoryKind !== undefined && normalizedTrackedChangeStoryKind !== null) {
          didChange = setIfChanged(target, 'trackedChangeStoryKind', normalizedTrackedChangeStoryKind) || didChange;
        }
        if (normalizedTrackedChangeStoryLabel !== undefined && normalizedTrackedChangeStoryLabel !== '') {
          didChange = setIfChanged(target, 'trackedChangeStoryLabel', normalizedTrackedChangeStoryLabel) || didChange;
        }
        if (normalizedTrackedChangeAnchorKey !== undefined && normalizedTrackedChangeAnchorKey !== null) {
          didChange = setIfChanged(target, 'trackedChangeAnchorKey', normalizedTrackedChangeAnchorKey) || didChange;
        }
        return didChange;
      };

      const applyChangedFields = (target) => {
        const fields = {
          trackedChangeText: trackedChangeText ?? null,
          trackedChangeType: trackedChangeType ?? null,
          trackedChangeDisplayType: trackedChangeDisplayType ?? null,
          semanticColorKey: semanticColorKey ?? null,
          semanticColor: semanticColor ?? null,
          deletedText: deletedText ?? null,
          trackedChangeLabel: normalizedTrackedChangeLabel,
          trackedChangeImagePreview: normalizedTrackedChangeImagePreview,
          trackedChangeCanonicalId: normalizedTrackedChangeCanonicalId,
          creatorId: authorId ?? null,
          creatorName: authorName ?? null,
          creatorEmail: authorEmail ?? null,
          creatorImage: authorImage ?? null,
          createdTime: date ?? null,
        };
        if (hasImportedId) {
          fields.importedId = normalizedImportedId;
        }
        if (hasTrackedChangePositionAliases) {
          const targetIdentityIds = new Set(
            [
              target?.commentId,
              target?.importedId,
              target?.trackedChangeCanonicalId,
              target?.trackedChangeAnchorKey,
              ...getCommentAliasIds(target),
            ]
              .map((id) => normalizeCommentId(id))
              .filter(Boolean),
          );
          const retainsCurrentIdentity = normalizedTrackedChangePositionAliases.some((alias) =>
            targetIdentityIds.has(alias),
          );
          fields.trackedChangePositionAliases = retainsCurrentIdentity
            ? normalizeTrackedChangePositionAliases([
                ...(Array.isArray(target?.trackedChangePositionAliases) ? target.trackedChangePositionAliases : []),
                ...normalizedTrackedChangePositionAliases,
              ])
            : normalizedTrackedChangePositionAliases;
        }

        let didChange = false;
        for (const [key, value] of Object.entries(fields)) {
          didChange = setIfChanged(target, key, value) || didChange;
        }
        // Detail lines are rebuilt arrays on every refresh pass; compare
        // element-wise so unchanged payloads never rebroadcast the sidebar.
        if (
          target &&
          !(target.trackedChangeDetailLines == null && normalizedTrackedChangeDetailLines == null) &&
          !trackedChangeDetailLinesEqual(target.trackedChangeDetailLines, normalizedTrackedChangeDetailLines)
        ) {
          target.trackedChangeDetailLines = normalizedTrackedChangeDetailLines;
          didChange = true;
        }
        if (
          hasCustomAttributes &&
          target &&
          !trackedChangeCustomAttributesEqual(target.customAttributes, normalizedCustomAttributes)
        ) {
          target.customAttributes = normalizedCustomAttributes;
          didChange = true;
        }
        return applyStoryMetadata(target) || didChange;
      };

      const updateExistingTrackedChange = (trackedComment) => {
        const wasResolved = Boolean(
          trackedComment.resolvedTime ||
          trackedComment.resolvedById ||
          trackedComment.resolvedByEmail ||
          trackedComment.resolvedByName,
        );
        if (wasResolved) clearResolvedMetadata(trackedComment);
        return applyChangedFields(trackedComment) || wasResolved;
      };

      if (event === 'add') {
        const existing = findTrackedChangeById();
        if (existing) {
          if (!updateExistingTrackedChange(existing)) return;
          trackedChangeIdentityIndex?.add(existing);

          const emitData = {
            type: COMMENT_EVENTS.UPDATE,
            comment: getCommentEventPayload(existing),
          };

          emitTrackedChangeEvent(emitData);
          return;
        }
        addHydratedComment({ superdoc, comment, broadcastChanges });
        trackedChangeIdentityIndex?.add(comment);
      } else if (event === 'update') {
        // If we have an update event, simply update the composable comment
        const existingTrackedChange = findTrackedChangeById();
        if (!existingTrackedChange) return;
        if (!updateExistingTrackedChange(existingTrackedChange)) return;
        trackedChangeIdentityIndex?.add(existingTrackedChange);

        const emitData = {
          type: COMMENT_EVENTS.UPDATE,
          comment: getCommentEventPayload(existingTrackedChange),
        };

        emitTrackedChangeEvent(emitData);
      } else if (event === 'resolve') {
        const existingTrackedChange = findTrackedChangeById();
        const resolveArgs = {
          id: params.resolvedById ?? superdoc?.user?.id ?? null,
          email: params.resolvedByEmail ?? superdoc?.user?.email ?? null,
          name: params.resolvedByName ?? superdoc?.user?.name ?? null,
          decision: params.decision ?? null,
          superdoc,
        };

        if (existingTrackedChange && !existingTrackedChange.resolvedTime) {
          // Selection/toolbar reject emits tracked-change resolve events. Use the same
          // resolution path as the comment dialog so one method owns state + sync + emit.
          // This is canonical reconciliation, not a user mutation: read-only viewers
          // must still reflect a decision authored by another client/API.
          existingTrackedChange.resolveComment({
            ...resolveArgs,
            reconciliationToken: COMMENT_RECONCILIATION_TOKEN,
          });
        }

        // User comments linked to tracked content are no longer blanket-cascaded
        // here. The decision engine emits explicit standard comment update/delete
        // events for each affected thread so accepted insertions can keep their
        // comments while rejected/removed coverage still deletes the right ones.
      }
    } finally {
      endInteractionSpan(span);
    }
  };

  const requestInstantSidebarAlignment = (targetY = null, threadId = null, instanceId = null) => {
    const hasTargetY = Number.isFinite(targetY);
    instantSidebarAlignmentTargetY.value = hasTargetY ? targetY : null;
    instantSidebarAlignmentThreadId.value = hasTargetY && threadId != null ? String(threadId) : null;
    const resolvedInstanceId = instanceId ?? threadId;
    instantSidebarAlignmentInstanceId.value =
      hasTargetY && resolvedInstanceId != null ? String(resolvedInstanceId) : null;
  };

  const peekInstantSidebarAlignment = () => {
    const targetY = instantSidebarAlignmentTargetY.value;
    return Number.isFinite(targetY) ? targetY : null;
  };

  const clearInstantSidebarAlignment = () => {
    instantSidebarAlignmentTargetY.value = null;
    instantSidebarAlignmentThreadId.value = null;
    instantSidebarAlignmentInstanceId.value = null;
  };

  const debounceEmit = (commentId, event, superdoc, delay = 1000) => {
    if (debounceTimers[commentId]) {
      clearTimeout(debounceTimers[commentId]);
    }

    debounceTimers[commentId] = setTimeout(() => {
      if (superdoc) {
        superdoc.emit('comments-update', event);
      }
      delete debounceTimers[commentId];
    }, delay);
  };

  const getPendingSelectionSnapshot = (superdoc, activeSelection) => {
    if (activeSelection?.source !== DOCUMENT_EDITOR_SELECTION_SOURCE) return null;

    const selectionDocumentId = activeSelection?.documentId ?? null;
    const editorDocumentId = superdoc?.activeEditor?.options?.documentId ?? null;
    if (!selectionDocumentId || !editorDocumentId || selectionDocumentId !== editorDocumentId) {
      return null;
    }

    let currentSelection;
    try {
      currentSelection = superdoc?.activeEditor?.doc?.selection?.current;
    } catch {
      return null;
    }

    if (typeof currentSelection !== 'function') return null;

    try {
      const snapshot = currentSelection();
      return typeof snapshot?.then === 'function' ? Promise.resolve(snapshot).catch(() => null) : snapshot;
    } catch {
      return null;
    }
  };

  const showAddComment = (superdoc, targetClientY = null) => {
    const request = ++pendingCommentRequest;
    const editor = superdoc?.activeEditor;
    const v2Adapter = getV2CommentsAdapter(superdoc);
    const ownsRequest = () => pendingCommentRequest === request;
    const emitPending = (snapshot) => {
      if (!ownsRequest()) return;
      superdoc.emit('comments-update', {
        type: COMMENT_EVENTS.PENDING,
        pendingSelection: superdoc?.activeEditor === editor ? snapshot : null,
      });
    };

    if (v2Adapter) {
      // ui-phase3-002: v2 mode uses a Vue-only pending sidebar row backed by
      // the v2 selection snapshot. We do not insert a fake 'pending' mark
      // through v1 `insertComment`; commit later dispatches
      // `comments.createFromSelection` after the user submits text.
      const cap = v2Adapter.getCapabilityState?.();
      if (cap && cap.canWrite === false) return { ok: false, reason: cap.reason };
      return Promise.resolve(
        v2Adapter.captureCurrentSelection?.({
          beforeReady: (snapshot) => {
            if (superdoc?.activeEditor === editor && getV2CommentsAdapter(superdoc) === v2Adapter)
              emitPending(snapshot);
          },
        }),
      )
        .then((capture) => {
          if (!ownsRequest()) return { ok: false, reason: 'pending-comment-superseded' };
          if (superdoc?.activeEditor !== editor || getV2CommentsAdapter(superdoc) !== v2Adapter)
            return { ok: false, reason: 'document-replaced' };
          if (!capture?.ok)
            return { ok: false, reason: capture?.reason ?? 'editing-range-required', detail: capture?.detail };
          pendingV2CommentTarget.value = capture.target ?? null;
          const docId = v2Adapter.documentId ?? superdoc?.activeEditor?.options?.documentId ?? null;
          pendingComment.value = getPendingComment({
            selection: {
              source: DOCUMENT_EDITOR_SELECTION_SOURCE,
              documentId: docId,
              page: 1,
              selectionBounds: {},
            },
            documentId: docId,
            parentCommentId: null,
          });
          if (!superdoc.config.isInternal) pendingComment.value.isInternal = false;
          requestInstantSidebarAlignment(targetClientY, 'pending');
          setActiveFloatingCommentInstance(null);
          activeComment.value = pendingComment.value.commentId;
          return { ok: true };
        })
        .catch((err) => ({ ok: false, reason: 'selection-capture-failed', detail: err?.message ?? String(err) }));
    }

    const pendingSelection = getPendingSelectionSnapshot(superdoc, superdocStore.activeSelection);
    const asyncSnapshot = typeof pendingSelection?.then === 'function';
    if (!asyncSnapshot) emitPending(pendingSelection);

    const showLegacyPending = (selection) => {
      selection.selectionBounds = { ...selection.selectionBounds };

      if (superdocStore.selectionPosition?.source && superdocStore.selectionPosition.source !== 'pdf') {
        superdocStore.selectionPosition.source = null;
      }

      pendingComment.value = getPendingComment({ selection, documentId: selection.documentId, parentCommentId: null });
      if (!superdoc.config.isInternal) pendingComment.value.isInternal = false;

      if (superdoc.activeEditor?.commands) {
        superdoc.activeEditor.commands.insertComment({
          ...pendingComment.value.getValues(),
          commentId: 'pending',
          skipEmit: true,
        });
      }

      if (
        pendingComment.value.selection.source === DOCUMENT_EDITOR_SELECTION_SOURCE &&
        superdocStore.selectionPosition
      ) {
        superdocStore.selectionPosition.source = DOCUMENT_EDITOR_SELECTION_SOURCE;
      }

      requestInstantSidebarAlignment(targetClientY, 'pending');
      setActiveFloatingCommentInstance(null);
      activeComment.value = pendingComment.value.commentId;
      return { ok: true };
    };
    if (asyncSnapshot) {
      const selection = { ...superdocStore.activeSelection };
      selection.selectionBounds = { ...selection.selectionBounds };
      return pendingSelection.then((snapshot) => {
        if (!ownsRequest()) return { ok: false, reason: 'pending-comment-superseded' };
        emitPending(snapshot);
        if (!ownsRequest()) return { ok: false, reason: 'pending-comment-superseded' };
        return superdoc?.activeEditor === editor
          ? showLegacyPending(selection)
          : { ok: false, reason: 'document-replaced' };
      });
    }
    return ownsRequest()
      ? showLegacyPending({ ...superdocStore.activeSelection })
      : { ok: false, reason: 'pending-comment-superseded' };
  };

  /**
   * Comparator that sorts comments by creation time (ascending).
   *
   * @param {Object} a - First comment
   * @param {Object} b - Second comment
   * @returns {number} Comparison result
   */
  const compareByCreatedTime = (a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0);

  /**
   * Generate the comments list separating resolved and active.
   * We only return parent comments here, since CommentDialog.vue will handle threaded comments.
   *
   * @param {(a: Object, b: Object) => number} sorter - Comparator function for sorting comments
   * @returns {{parentComments: Array, resolvedComments: Array}} Grouped and sorted comments
   */
  const buildGroupedCommentsFrom = (source, sorter) => {
    const parentComments = [];
    const resolvedComments = [];
    const childCommentMap = new Map();
    const trackedChangeThreadOwnerIndex = buildTrackedChangeThreadOwnerIndex(source);

    source.forEach((comment) => {
      if (!isThreadVisible(comment)) return;
      const trackedChangeThreadParentId = trackedChangeThreadOwnerIndex.get(comment)?.commentId ?? null;
      const parentId = comment.trackedChange ? null : comment.parentCommentId || trackedChangeThreadParentId;
      // Track resolved comments
      if (comment.resolvedTime) {
        resolvedComments.push(comment);
      }

      // Track parent comments
      else if (!parentId && !comment.resolvedTime) {
        parentComments.push({ ...comment });
      }

      // Track child comments (threaded comments)
      else if (parentId) {
        if (!childCommentMap.has(parentId)) {
          childCommentMap.set(parentId, []);
        }
        childCommentMap.get(parentId).push(comment);
      }
    });

    // Return only parent comments
    const sortedParentComments = parentComments.sort(sorter);
    const sortedResolvedComments = resolvedComments.sort(sorter);

    return {
      parentComments: sortedParentComments,
      resolvedComments: sortedResolvedComments,
    };
  };

  const buildGroupedComments = (sorter) => {
    const presentations = committedReviewPresentations.value;
    if (!Object.keys(presentations).length) return buildGroupedCommentsFrom(commentsList.value, sorter);
    const rows = new Map(
      commentsList.value.map((row) => [JSON.stringify([String(row.fileId), String(row.commentId)]), row]),
    );
    const legacy = buildGroupedCommentsFrom(
      commentsList.value.filter((row) => !presentations[String(row.fileId)]),
      sorter,
    );
    for (const [documentId, presentation] of Object.entries(presentations)) {
      legacy.parentComments.push(
        ...presentation.groupOrder.open
          .map((id) => rows.get(JSON.stringify([documentId, String(id)])))
          .filter((row) => row && isThreadVisible(row)),
      );
      legacy.resolvedComments.push(
        ...presentation.groupOrder.resolved
          .map((id) => rows.get(JSON.stringify([documentId, String(id)])))
          .filter((row) => row && isThreadVisible(row)),
      );
    }
    return legacy;
  };

  /** @type {import('vue').ComputedRef<{parentComments: Array, resolvedComments: Array}>} Comments grouped and sorted by creation time */
  const getGroupedComments = computed(() => buildGroupedComments(compareByCreatedTime));
  const getGroupedReviewDirectory = computed(() =>
    buildGroupedCommentsFrom(reviewDirectoryList.value, compareByCreatedTime),
  );

  const hasOpenTrackedChanges = computed(
    () =>
      getGroupedComments.value?.parentComments.some((comment) => comment.trackedChange && !comment.resolvedTime) ??
      false,
  );

  const documentsWithConverations = computed(() => {
    return superdocStore.documents;
  });

  const getConfig = computed(() => {
    return commentsConfig;
  });

  /**
   * Get a new pending comment
   *
   * @param {Object} param0
   * @param {Object} [param0.selection] The selection object
   * @param {string | null} [param0.documentId] The document ID
   * @param {string | null} [param0.parentCommentId] The parent comment
   * @returns {ReturnType<typeof useComment>} The new comment object
   */
  const getPendingComment = ({ selection, documentId, parentCommentId, ...options }) => {
    return _getNewcomment({ selection, documentId, parentCommentId, ...options });
  };

  /**
   * Get the new comment object
   *
   * @param {Object} param0
   * @param {Object} param0.selection The selection object
   * @param {String} param0.documentId The document ID
   * @param {String} param0.parentCommentId The parent comment ID
   * @returns {Object} The new comment object
   */
  const _getNewcomment = ({ selection, documentId, parentCommentId, ...options }) => {
    let activeDocument;
    if (documentId) activeDocument = superdocStore.getDocument(documentId);
    else if (selection) activeDocument = superdocStore.getDocument(selection.documentId);

    if (!activeDocument) activeDocument = superdocStore.documents[0];

    return useComment({
      fileId: activeDocument.id,
      fileType: activeDocument.type,
      parentCommentId,
      creatorId: superdocStore.user.id,
      creatorEmail: superdocStore.user.email,
      creatorName: superdocStore.user.name,
      creatorImage: superdocStore.user.image,
      commentText: currentCommentText.value,
      selection,
      ...options,
    });
  };

  /**
   * Remove the pending comment
   *
   * @returns {void}
   */
  const resetPendingCommentState = (superdoc, clearViewingSelection = true) => {
    const hadPending = !!pendingComment.value;
    currentCommentText.value = '';
    currentCommentMentions.value = [];
    pendingComment.value = null;
    pendingV2CommentTarget.value = null;
    superdocStore.selectionPosition = null;

    // Only clear active comment when removing an actual pending comment.
    // Replies and edits also call this to reset currentCommentText, but
    // clearing activeComment would deactivate the thread (SD-2035).
    if (hadPending) {
      clearActiveCommentSelection();
    }

    // ui-phase3-002: in v2 mode the pending comment is Vue-only (no fake
    // 'pending' document mark was inserted), so there is nothing to remove
    // from the document. Calling v1 `removeComment` against the v2 facade
    // would touch a null `commands` surface. Still clear the retained viewing
    // selection so the host overlay does not linger under the new decoration.
    if (isV2EditorActive(superdoc)) {
      // Editable selection belongs to native input. Creation may finish after
      // the user has already selected another range for their next edit.
      if (hadPending && clearViewingSelection && isViewingMode.value) {
        try {
          superdoc?.activeEditor?.host?.getHandles?.()?.selection?.clear?.();
        } catch {
          /* host may already be torn down */
        }
      }
      return;
    }
    superdoc?.activeEditor?.commands?.removeComment({ commentId: 'pending' });
  };

  const removePendingComment = (superdoc) => {
    pendingCommentRequest += 1;
    resetPendingCommentState(superdoc);
  };

  const getV2CreatedComment = ({ outcome, reconciled, documentId }) => {
    const createdId = normalizeCommentId(outcome?.createdCommentId);
    if (!createdId) return reconciled?.added ?? null;
    return (
      commentsList.value.find(
        (row) =>
          String(row.commentId) === createdId && (documentId == null || String(row.fileId) === String(documentId)),
      ) ?? null
    );
  };

  /**
   * Add a new comment to the document
   *
   * @param {Object} param0
   * @param {Object} param0.superdoc The SuperDoc instance
   * @param {ReturnType<typeof useComment>} param0.comment The comment to add
   * @param {boolean} [param0.skipEditorUpdate] Skip writing the comment into the editor
   * @param {boolean} [param0.broadcastChanges] Emit and sync the change
   * @param {boolean} [param0.isHydration] The comment comes from import or collaboration
   * @returns {{ ok: boolean, reason?: string, detail?: string, code?: string } | Promise<{ ok: boolean, reason?: string, detail?: string, code?: string }>} The mutation outcome
   */
  const addCommentInternal = ({
    superdoc,
    comment,
    skipEditorUpdate = false,
    broadcastChanges = true,
    isHydration = false,
  }) => {
    // Imported/collaboration hydration must remain visible in a read-only
    // review surface. All user-originated store calls fail closed before the
    // document, Vue rows, or public events are mutated.
    if (commentsAreReadOnly() && !isHydration) {
      return readOnlyMutationOutcome();
    }

    const v2Adapter = !skipEditorUpdate && !isHydration ? getV2CommentsAdapter(superdoc) : null;
    if (v2Adapter && !comment.trackedChange) {
      const pendingDraft = pendingComment.value;
      const draftRevision = commentDraftRevision;
      const draftActiveComment = activeComment.value;
      const draftActiveInstance = activeFloatingCommentInstanceId.value;
      // ui-phase3-002: in v2 mode the create / reply path delegates to the
      // Document API compatibility adapter. Vue state is not mutated until
      // the synchronous receipt commits and we refresh from
      // `host.getHandles().comments.list()`. This keeps the sidebar
      // receipt-driven; rejected mutations never produce orphan sidebar rows.
      const submittedPendingRequest = pendingCommentRequest;
      const text = normalizeV2CommentDraftText(pendingDraft ? currentCommentText.value : comment.commentText);
      const mentions = pendingComment.value ? currentCommentMentions.value : (comment.mentions ?? []);
      const target = pendingComment.value ? pendingV2CommentTarget.value : null;
      const parentCommentId = comment.parentCommentId
        ? String(comment.parentCommentId)
        : pendingComment.value
          ? null
          : null;
      const invocation = (async () => {
        try {
          return await (parentCommentId
            ? v2Adapter.reply({ parentCommentId, text, ...(mentions.length ? { mentions } : {}) })
            : v2Adapter.commitPendingComment({ text, target, ...(mentions.length ? { mentions } : {}) }));
        } catch (err) {
          return { ok: false, reason: 'adapter-threw', detail: err?.message ?? String(err) };
        }
      })();
      return invocation.then((outcome) => {
        // Stamped-adapter guard: drop late results after teardown/remount.
        if (!isCurrentV2CommentsAdapter(v2Adapter)) {
          return { ok: false, reason: 'adapter-stale' };
        }
        if (!outcome?.ok) {
          // Receipt / rejection / refresh-failure / adapter-threw: preserve
          // the pending row/text so the user can retry or cancel explicitly.
          // Do not invent a durable sidebar row, and do not call the v1
          // pending-mark remover.
          if (broadcastChanges) {
            superdoc.emit('comments-update', {
              type: COMMENT_EVENTS.PENDING,
              rejected: true,
              reason: outcome?.reason ?? 'v2-create-failed',
              ...(outcome?.committed ? { committed: true } : {}),
            });
          }
          return outcome;
        }
        const ownsActiveDraftBeforeReconcile =
          activeComment.value === draftActiveComment && activeFloatingCommentInstanceId.value === draftActiveInstance;
        const reconciled = reconcileCommentsFromV2({
          superdoc,
          adapter: v2Adapter,
          documentId: v2Adapter.documentId,
          items: outcome.items,
        });
        const created = getV2CreatedComment({ outcome, reconciled, documentId: v2Adapter.documentId });
        const createdId = created?.commentId ?? null;
        const createdIsActive = createdId !== null && activeComment.value === createdId;
        const createdInstance = createdIsActive ? activeFloatingCommentInstanceId.value : null;
        const ownsSubmittedRequest = pendingCommentRequest === submittedPendingRequest;
        const reconciliationClearedActiveDraft =
          ownsActiveDraftBeforeReconcile &&
          activeComment.value === null &&
          activeFloatingCommentInstanceId.value === null;
        const ownsPendingDraft =
          pendingDraft !== null &&
          pendingComment.value === pendingDraft &&
          commentDraftRevision === draftRevision &&
          (createdIsActive ||
            reconciliationClearedActiveDraft ||
            (activeComment.value === draftActiveComment &&
              activeFloatingCommentInstanceId.value === draftActiveInstance));
        if (ownsPendingDraft) {
          if (ownsSubmittedRequest) removePendingComment(superdoc);
          else resetPendingCommentState(superdoc, false);
        }
        // Hand off activeComment/instance to the newly created comment instead
        // of leaving it null, so the floating sidebar keeps treating this row
        // as active (viewport exemption, dialog mount, collision pinning) and
        // never observes an intermediate null in the same reactive flush.
        if (ownsPendingDraft && ownsSubmittedRequest && createdId) {
          setActiveComment(superdoc, createdId);
          setActiveFloatingCommentInstance(createdInstance ?? createdId);
        }
        if (broadcastChanges) {
          superdoc.emit('comments-update', {
            type: COMMENT_EVENTS.ADD,
            comment: created?.getValues?.() ?? null,
          });
        }
        return { ok: true, comment: created };
      });
    }

    let parentComment = commentsList.value.find((c) => c.commentId === activeComment.value);
    if (!parentComment) parentComment = comment;

    const newComment = useComment(comment.getValues());

    if (pendingComment.value) newComment.setText({ text: currentCommentText.value, suppressUpdate: true });
    else newComment.setText({ text: comment.commentText, suppressUpdate: true });
    newComment.selection.source = pendingComment.value?.selection?.source ?? newComment.selection.source;

    // Set isInternal flag
    if (parentComment) {
      const isParentInternal = parentComment.isInternal;
      newComment.isInternal = isParentInternal;
    }

    // If the current user is not internal, set the comment to external
    if (!superdoc.config.isInternal) newComment.isInternal = false;

    // Add the new comments to our global list
    commentsList.value.push(newComment);

    // Clean up the pending comment
    const hadPendingComment = !!pendingComment.value;
    removePendingComment(superdoc);
    // Hand off activeComment/instance to the newly created comment instead of
    // leaving it null, so the floating sidebar keeps treating this row as
    // active (viewport exemption, dialog mount, collision pinning) and never
    // observes an intermediate null in the same reactive flush.
    if (hadPendingComment) {
      activeComment.value = newComment.commentId;
      setActiveFloatingCommentInstance(newComment.commentId);
    }

    // If this is not a tracked change, and it belongs to a Super Editor, and its not a child comment
    // We need to let the editor know about the new comment
    if (!skipEditorUpdate && !comment.trackedChange && superdoc.activeEditor?.commands && !comment.parentCommentId) {
      // Add the comment to the active editor
      superdoc.activeEditor.commands.insertComment({ ...newComment.getValues(), skipEmit: true });
    }

    const event = { type: COMMENT_EVENTS.ADD, comment: newComment.getValues() };

    if (broadcastChanges) {
      // If collaboration is enabled, sync the comments to all clients
      syncCommentsToClients(superdoc, event);

      // Emit event for end users
      superdoc.emit('comments-update', event);
    }
    return { ok: true, comment: newComment };
  };

  const addComment = ({ superdoc, comment, skipEditorUpdate = false, broadcastChanges = true }) =>
    addCommentInternal({ superdoc, comment, skipEditorUpdate, broadcastChanges });

  const addHydratedComment = ({ superdoc, comment, skipEditorUpdate = false, broadcastChanges = true }) =>
    addCommentInternal({ superdoc, comment, skipEditorUpdate, broadcastChanges, isHydration: true });

  const deleteComment = ({ commentId: commentIdToDelete, superdoc }) => {
    if (commentsAreReadOnly()) return Promise.resolve(readOnlyMutationOutcome());

    const commentIndex = commentsList.value.findIndex((c) => c.commentId === commentIdToDelete);
    const comment = commentsList.value[commentIndex];
    if (!comment) {
      return Promise.resolve({ ok: false, reason: 'comment-not-found' });
    }
    const { commentId, importedId } = comment;
    const { fileId } = comment;

    const v2Adapter = getV2CommentsAdapter(superdoc);
    if (v2Adapter && !comment.trackedChange) {
      // ui-phase3-002: route delete through the v2 host. Vue state is not
      // mutated until the receipt commits and we refresh from the v2 list.
      const invocation = (async () => {
        try {
          return await v2Adapter.delete({ commentId });
        } catch (err) {
          return { ok: false, reason: 'adapter-threw', detail: err?.message ?? String(err) };
        }
      })();
      return invocation.then((outcome) => {
        // Stamped-adapter guard.
        if (!isCurrentV2CommentsAdapter(v2Adapter)) {
          return { ok: false, reason: 'adapter-stale' };
        }
        if (!outcome?.ok) {
          superdoc.emit('comments-update', {
            type: COMMENT_EVENTS.DELETED,
            rejected: true,
            comment: comment.getValues(),
            reason: outcome?.reason ?? 'v2-delete-failed',
            ...(outcome?.code !== undefined ? { code: outcome.code } : {}),
            ...(outcome?.detail !== undefined ? { detail: outcome.detail } : {}),
            ...(outcome?.committed ? { committed: true } : {}),
          });
          return outcome;
        }
        const removedIds = new Set(
          (Array.isArray(outcome.removedCommentIds) ? outcome.removedCommentIds : [])
            .map(normalizeCommentId)
            .filter(Boolean),
        );
        if (removedIds.has(normalizeCommentId(commentId))) {
          if (importedId != null) removedIds.add(normalizeCommentId(importedId));
          let addedChild = true;
          while (addedChild) {
            addedChild = false;
            for (const row of commentsList.value) {
              const parentId = normalizeCommentId(row?.parentCommentId);
              if (!parentId || !removedIds.has(parentId)) continue;
              for (const alias of [row?.commentId, row?.importedId].map(normalizeCommentId).filter(Boolean)) {
                if (removedIds.has(alias)) continue;
                removedIds.add(alias);
                addedChild = true;
              }
            }
          }
          commentsList.value = commentsList.value.filter((row) => {
            const aliases = [row?.commentId, row?.importedId].map(normalizeCommentId).filter(Boolean);
            return !aliases.some((alias) => removedIds.has(alias));
          });
          if (removedIds.has(normalizeCommentId(activeComment.value))) clearActiveCommentSelection();
        } else {
          reconcileCommentsFromV2({
            superdoc,
            adapter: v2Adapter,
            documentId: v2Adapter.documentId ?? fileId,
            items: outcome.items ?? [],
            pruneStale: outcome.complete !== false,
          });
        }
        superdoc.emit('comments-update', {
          type: COMMENT_EVENTS.DELETED,
          comment: comment.getValues(),
          changes: [{ key: 'deleted', commentId, fileId }],
        });
        return { ok: true };
      });
    }

    superdoc.activeEditor?.commands?.removeComment({ commentId, importedId });

    // Remove the current comment
    commentsList.value.splice(commentIndex, 1);

    // Remove any child comments of the removed comment
    const childCommentIds = commentsList.value
      .filter((c) => c.parentCommentId === commentId)
      .map((c) => c.commentId || c.importedId);
    commentsList.value = commentsList.value.filter((c) => !childCommentIds.includes(c.commentId));

    // Clear active state so floating layout doesn't reference a deleted comment
    if (activeComment.value === commentId || childCommentIds.includes(activeComment.value)) {
      clearActiveCommentSelection();
    }

    const event = {
      type: COMMENT_EVENTS.DELETED,
      comment: comment.getValues(),
      changes: [{ key: 'deleted', commentId, fileId }],
    };

    superdoc.emit('comments-update', event);
    syncCommentsToClients(superdoc, event);
    return Promise.resolve({ ok: true });
  };

  /**
   * Drop comment cards retired by a document mutation (cut of a fully covered
   * comment). Visible-window hydration does not prune, so the sidebar would
   * otherwise keep the source bubble after the document comment is gone.
   */
  const dropCommentsFromMutationImpact = ({ superdoc, documentId, removedIds } = {}) => {
    const seedIds = new Set(
      [...(removedIds instanceof Set ? removedIds : (removedIds ?? []))]
        .map((id) => normalizeCommentId(id))
        .filter(Boolean),
    );
    if (!seedIds.size) return { ok: true, removedIds: [] };

    const normalizedDocumentId = documentId != null ? String(documentId) : null;
    const belongsToDocument = (comment) => {
      if (normalizedDocumentId == null) return true;
      const fid = comment?.fileId != null ? String(comment.fileId) : null;
      if (fid == null) return true;
      return fid === normalizedDocumentId;
    };
    const isDroppableCommentRow = (comment) => {
      if (!comment || comment.trackedChange === true || isV2SyntheticTrackedChangeRow(comment)) return false;
      return belongsToDocument(comment);
    };

    const droppedIds = new Set(seedIds);
    let added = true;
    while (added) {
      added = false;
      for (const row of commentsList.value) {
        if (!isDroppableCommentRow(row)) continue;
        const aliases = getCommentAliasIds(row);
        const alreadyDropped = aliases.some((alias) => droppedIds.has(alias));
        const parentDropped =
          droppedIds.has(normalizeCommentId(row?.parentCommentId)) ||
          droppedIds.has(normalizeCommentId(row?.threadingParentCommentId));
        if (!alreadyDropped && !parentDropped) continue;
        for (const alias of aliases) {
          if (droppedIds.has(alias)) continue;
          droppedIds.add(alias);
          added = true;
        }
      }
    }

    const previous = [...commentsList.value];
    commentsList.value = commentsList.value.filter((row) => {
      if (!isDroppableCommentRow(row)) return true;
      return !getCommentAliasIds(row).some((alias) => droppedIds.has(alias));
    });
    const removedComments = previous.filter((comment) => !commentsList.value.includes(comment));
    if (removedComments.length === 0) return { ok: true, removedIds: [] };

    const activeId = normalizeCommentId(activeComment.value);
    if (activeId && droppedIds.has(activeId)) clearActiveCommentSelection();

    const adapter = getV2CommentsAdapter(superdoc);
    removedComments.forEach((comment) => {
      const payload = typeof comment.getValues === 'function' ? comment.getValues() : comment;
      // The pending creation owns its public outcome; canonical removal still
      // retires the hydrated row immediately when undo invalidates its receipt.
      if (isCurrentV2CommentsAdapter(adapter) && adapter.isPendingCommentCreation?.(payload?.commentId)) return;
      const event = {
        type: COMMENT_EVENTS.DELETED,
        comment: payload,
        changes: [{ key: 'deleted', commentId: payload?.commentId, fileId: payload?.fileId }],
      };
      superdoc?.emit?.('comments-update', event);
    });
    return { ok: true, removedIds: [...droppedIds] };
  };

  // TCS Phase 0 / 004: store-owned v2 comment mutation helpers for reply,
  // edit, and resolve. The store owns: adapter identity stamping, capability
  // gating, success/rejection event emission, active-row clearing semantics,
  // and reconciliation from v2 list results. Dialog code only owns transient
  // input state (`isReplying`, `editingCommentId`, `currentCommentText`) and
  // clears that state on success outcomes; rejected outcomes preserve it.
  // Delete already routes through `deleteComment` above; that branch follows
  // the same contract.
  //
  // Failure semantics for all helpers:
  //   - empty / missing inputs reject before mutation with a named reason
  //   - capability gate (`canWrite === false`) returns the cap.reason without
  //     mutating; success-shaped events are not emitted
  //   - adapter throws are normalized to `{ ok: false, reason: 'adapter-threw' }`
  //   - stale-adapter (teardown/remount) returns `{ ok: false, reason: 'adapter-stale' }`
  //   - rejected outcomes emit a single `comments-update` event with
  //     `rejected: true` and a stable `reason`; rows are not mutated
  //   - committed-but-refresh-failed (`outcome.committed === true`) is
  //     surfaced honestly; we do NOT reconcile with `[]`
  //   - successful lifecycle receipts update only their hydrated thread;
  //     outcomes that require replica data reconcile through
  //     `reconcileCommentsFromV2(...)`
  //   - both paths emit UPDATE / RESOLVED / DELETED using existing shapes
  const applyV2ThreadLifecycleReceipt = ({ superdoc, documentId, lifecycle } = {}) => {
    const commentId = normalizeCommentId(lifecycle?.commentId);
    const status = lifecycle?.status;
    if (!commentId || (status !== 'open' && status !== 'resolved')) return null;

    const normalizedDocumentId = normalizeCommentId(documentId);
    const rows = commentsList.value.filter((comment) => {
      if (!comment || comment.trackedChange === true || isV2SyntheticTrackedChangeRow(comment)) return false;
      const rowDocumentId = normalizeCommentId(comment.fileId);
      return normalizedDocumentId == null || rowDocumentId == null || rowDocumentId === normalizedDocumentId;
    });
    const byAlias = new Map();
    const childrenByParentAlias = new Map();
    for (const row of rows) {
      for (const alias of [row.commentId, row.importedId].map(normalizeCommentId).filter(Boolean)) {
        if (!byAlias.has(alias)) byAlias.set(alias, row);
      }
      const parentId = normalizeCommentId(row.parentCommentId);
      if (parentId) {
        const children = childrenByParentAlias.get(parentId) ?? [];
        children.push(row);
        childrenByParentAlias.set(parentId, children);
      }
    }

    let root = byAlias.get(commentId) ?? null;
    const seenParents = new Set();
    while (root?.parentCommentId != null) {
      const parentId = normalizeCommentId(root.parentCommentId);
      if (!parentId || seenParents.has(parentId)) break;
      seenParents.add(parentId);
      const parent = byAlias.get(parentId);
      if (!parent) break;
      root = parent;
    }
    if (!root) return null;

    const family = [];
    const queue = [root];
    const visited = new Set();
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row || visited.has(row)) continue;
      visited.add(row);
      family.push(row);
      for (const alias of [row.commentId, row.importedId].map(normalizeCommentId).filter(Boolean)) {
        queue.push(...(childrenByParentAlias.get(alias) ?? []));
      }
    }

    const isResolved = status === 'resolved';
    const resolvedAt = Date.now();
    for (const row of family) {
      row.resolvedTime = isResolved ? (row.resolvedTime ?? resolvedAt) : null;
      row.resolvedById = isResolved ? (superdoc?.user?.id ?? null) : null;
      row.resolvedByEmail = isResolved ? (superdoc?.user?.email ?? null) : null;
      row.resolvedByName = isResolved ? (superdoc?.user?.name ?? null) : null;
    }
    return { added: null, lifecycleUpdated: family.length };
  };

  const runV2CommentMutation = async ({
    superdoc,
    adapter,
    fileId,
    operation,
    eventType,
    rejectionFallbackReason,
    rejectionEventExtras = {},
    validateOutcome,
    successEventBuilder,
  }) => {
    let outcome;
    try {
      outcome = await operation();
    } catch (err) {
      outcome = { ok: false, reason: 'adapter-threw', detail: err?.message ?? String(err) };
    }

    // Stamped-adapter guard: drop late results after teardown/remount. We
    // intentionally do not emit anything in this case — the previous mount
    // (and its dialog) is gone, and the new mount owns its own events.
    if (!isCurrentV2CommentsAdapter(adapter)) {
      return { ok: false, reason: 'adapter-stale' };
    }

    if (!outcome?.ok) {
      const rejectedEvent = {
        type: eventType,
        rejected: true,
        reason: outcome?.reason ?? rejectionFallbackReason,
        ...(outcome?.committed ? { committed: true } : {}),
        ...(outcome?.code !== undefined ? { code: outcome.code } : {}),
        ...(outcome?.detail !== undefined ? { detail: outcome.detail } : {}),
        ...rejectionEventExtras,
      };
      superdoc?.emit?.('comments-update', rejectedEvent);
      return outcome;
    }

    const validation = validateOutcome?.({ outcome });
    if (validation?.ok === false) {
      const failedOutcome = {
        ok: false,
        committed: validation.committed ?? true,
        reason: validation.reason ?? rejectionFallbackReason,
        ...(validation.code !== undefined ? { code: validation.code } : {}),
        ...(validation.detail !== undefined ? { detail: validation.detail } : {}),
      };
      const rejectedEvent = {
        type: eventType,
        rejected: true,
        reason: failedOutcome.reason,
        ...(failedOutcome.committed ? { committed: true } : {}),
        ...(failedOutcome.code !== undefined ? { code: failedOutcome.code } : {}),
        ...(failedOutcome.detail !== undefined ? { detail: failedOutcome.detail } : {}),
        ...rejectionEventExtras,
      };
      superdoc?.emit?.('comments-update', rejectedEvent);
      return failedOutcome;
    }

    const documentId = adapter.documentId ?? fileId;
    const reconciled =
      applyV2ThreadLifecycleReceipt({
        superdoc,
        documentId,
        lifecycle: outcome.threadLifecycle,
      }) ??
      reconcileCommentsFromV2({
        superdoc,
        adapter,
        documentId,
        items: outcome.items ?? [],
        pruneStale: outcome.complete !== false,
      });

    const successEvent = successEventBuilder?.({ outcome, reconciled }) ?? null;
    if (successEvent) {
      superdoc?.emit?.('comments-update', successEvent);
    }
    return {
      ok: true,
      items: outcome.items ?? [],
      reconciled,
      ...(outcome.complete === false ? { complete: false } : {}),
      ...(outcome.visibleWindowSource != null ? { visibleWindowSource: outcome.visibleWindowSource } : {}),
      ...(outcome.threadLifecycle != null ? { threadLifecycle: outcome.threadLifecycle } : {}),
      ...(outcome.mutationPath != null ? { mutationPath: outcome.mutationPath } : {}),
    };
  };

  const mapV2OutcomeCommentInputs = ({ outcome, adapter, fileId }) => {
    return (outcome.items ?? [])
      .map((item) =>
        adapter.mapV2CommentToUseCommentInput(item, {
          fileId,
          fileType: null,
        }),
      )
      .filter(Boolean);
  };

  const isBlankDirectoryCommentText = (value) =>
    typeof value !== 'string' ||
    value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .trim().length === 0;

  const trackedChangeDirectoryComment = (params) => {
    if (!params || params.event === 'omit' || params.changeId == null) return null;
    return getPendingComment({
      documentId: params.documentId,
      commentId: params.changeId,
      trackedChange: true,
      trackedChangeText: params.trackedChangeText,
      trackedChangeType: params.trackedChangeType,
      trackedChangeDisplayType: params.trackedChangeDisplayType,
      semanticColorKey: params.semanticColorKey,
      semanticColor: params.semanticColor,
      deletedText: params.deletedText,
      trackedChangeLabel:
        typeof params.trackedChangeLabel === 'string' && params.trackedChangeLabel.length > 0
          ? params.trackedChangeLabel
          : null,
      trackedChangeDetailLines: normalizeTrackedChangeDetailLines(params.trackedChangeDetailLines),
      trackedChangeImagePreview: normalizeTrackedChangeImagePreview(params.trackedChangeImagePreview),
      ...(Object.prototype.hasOwnProperty.call(params, 'customAttributes')
        ? { customAttributes: normalizeTrackedChangeCustomAttributes(params.customAttributes) }
        : {}),
      createdTime: params.date,
      creatorId: params.authorId ?? null,
      creatorName: params.author,
      creatorEmail: params.authorEmail,
      creatorImage: params.authorImage,
      isInternal: false,
      importedAuthor: params.importedAuthor,
      ...(Object.prototype.hasOwnProperty.call(params, 'importedId')
        ? { importedId: params.importedId != null ? String(params.importedId) : null }
        : {}),
      trackedChangeStory: params.trackedChangeStory ?? null,
      trackedChangeStoryKind: params.trackedChangeStoryKind ?? null,
      trackedChangeStoryLabel: params.trackedChangeStoryLabel ?? '',
      trackedChangeAnchorKey: params.trackedChangeAnchorKey ?? null,
      trackedChangeCanonicalId: params.trackedChangeCanonicalId ?? null,
      trackedChangePositionAliases: normalizeTrackedChangePositionAliases(params.trackedChangePositionAliases),
      selection: {
        source: DOCUMENT_EDITOR_SELECTION_SOURCE,
        selectionBounds: params.coords ?? null,
      },
    });
  };

  const setReviewDirectoryFromV2 = ({ superdoc, commentItems = [], trackedChangeItems = [] } = {}) => {
    const commentsAdapter = getV2CommentsAdapter(superdoc);
    const trackedChangesAdapter = getV2TrackedChangesAdapter(superdoc);
    if (
      !commentsAdapter ||
      !trackedChangesAdapter ||
      typeof commentsAdapter.mapV2CommentToUseCommentInput !== 'function' ||
      typeof trackedChangesAdapter.mapV2TrackedChangeToCommentParams !== 'function'
    ) {
      reviewDirectoryList.value = [];
      return { ok: false, reason: 'adapter-unavailable' };
    }

    const documentId =
      superdoc?.activeEditor?.documentId ??
      superdoc?.activeEditor?.options?.documentId ??
      commentsAdapter.documentId ??
      trackedChangesAdapter.documentId ??
      null;
    const document = documentId != null ? superdocStore.getDocument(String(documentId)) : null;
    const mappedCommentInputs = commentItems
      .filter((item) => !isSyntheticTrackedChangeCommentLaneItem(item))
      .map((item) =>
        commentsAdapter.mapV2CommentToUseCommentInput(item, {
          fileId: documentId,
          fileType: document?.type ?? null,
        }),
      )
      .filter(Boolean);
    const trackedParentBySidecarId = new Map();
    for (const input of mappedCommentInputs) {
      if (
        input.trackedChange !== true &&
        input.trackedChangeThreadParentId &&
        !input.parentCommentId &&
        isBlankDirectoryCommentText(input.commentText)
      ) {
        trackedParentBySidecarId.set(String(input.commentId), String(input.trackedChangeThreadParentId));
      }
    }
    const commentRows = mappedCommentInputs
      .filter((input) => !trackedParentBySidecarId.has(String(input.commentId)))
      .map((input) => {
        const trackedParent = input.parentCommentId
          ? trackedParentBySidecarId.get(String(input.parentCommentId))
          : null;
        if (trackedParent) {
          input.threadingParentCommentId = trackedParent;
          input.trackedChangeThreadParentId ??= trackedParent;
        }
        return useComment(input);
      });
    const trackedRows = trackedChangeItems
      .map((item) => trackedChangesAdapter.mapV2TrackedChangeToCommentParams(item))
      .map((params) => trackedChangeDirectoryComment(params))
      .filter(Boolean);

    reviewDirectoryList.value = [...commentRows, ...trackedRows];
    return { ok: true, count: reviewDirectoryList.value.length };
  };

  const clearReviewDirectory = () => {
    reviewDirectoryList.value = [];
  };

  const commentInputId = (input) => {
    const id = input?.commentId ?? input?.importedId;
    return id != null ? String(id) : null;
  };

  const commentInputParentId = (input) => (input?.parentCommentId != null ? String(input.parentCommentId) : null);

  const validateV2ThreadLifecycleRefresh = ({ outcome, adapter, fileId, commentId, expectedResolved, operation }) => {
    const id = commentId != null ? String(commentId) : null;
    const receiptLifecycle = outcome?.threadLifecycle;
    if (receiptLifecycle != null) {
      const observedId = normalizeCommentId(receiptLifecycle.commentId);
      const observedResolved = receiptLifecycle.status === 'resolved';
      if (observedId === id && observedResolved === expectedResolved) return { ok: true };
      return {
        ok: false,
        reason: `v2-${operation}-receipt-lifecycle-mismatch`,
        detail: {
          expected: { commentId: id, status: expectedResolved ? 'resolved' : 'open' },
          observed: receiptLifecycle,
        },
      };
    }
    const inputs = mapV2OutcomeCommentInputs({ outcome, adapter, fileId });
    const target = inputs.find((input) => commentInputId(input) === id) ?? null;
    const root = target?.parentCommentId
      ? (inputs.find((input) => commentInputId(input) === commentInputParentId(target)) ?? null)
      : target;
    const rootId = commentInputId(root);
    if (!root || !rootId) {
      return {
        ok: false,
        reason: `v2-${operation}-refresh-missing`,
        detail: `comment ${id} was absent from the refreshed v2 comment list after ${operation}`,
      };
    }

    const directReplies = inputs.filter((input) => commentInputParentId(input) === rootId);
    const family = [root, ...directReplies];
    const isResolved = (input) => Boolean(input?.resolvedTime);
    const mismatched = family.filter((input) => isResolved(input) !== expectedResolved);
    if (mismatched.length === 0) {
      return { ok: true };
    }

    const rootResolved = isResolved(root);
    const hasMixedLifecycle = family.some((input) => isResolved(input) !== rootResolved);
    if (hasMixedLifecycle) {
      return {
        ok: false,
        reason: `v2-${operation}-refresh-split-thread`,
        detail: {
          rootId,
          expected: expectedResolved ? 'resolved' : 'open',
          observed: family.map((input) => ({
            commentId: commentInputId(input),
            parentCommentId: commentInputParentId(input),
            status: isResolved(input) ? 'resolved' : 'open',
          })),
        },
      };
    }

    return {
      ok: false,
      reason: expectedResolved ? `v2-${operation}-refresh-still-open` : `v2-${operation}-refresh-still-resolved`,
      detail: `comment ${rootId} remained ${rootResolved ? 'resolved' : 'open'} after ${operation}`,
    };
  };

  /**
   * Reply to an existing comment or tracked-change review row through the v2 adapter.
   *
   * Plan §4.1 rules:
   *   - empty text rejects before mutation with `comment-text-empty`
   *   - missing parent rejects before mutation with `parent-comment-id-missing`
   *   - a tracked-change row creates its first anchored root only after a
   *     canonical-id reply reports `TARGET_NOT_FOUND`
   *   - successful mutation refreshes from v2 list and reconciles
   *   - rejection preserves rows and emits a rejected `comments-update` event
   *   - committed-but-refresh-failed surfaces honestly (no reconcile with `[]`)
   *
   * @param {Object} [param0]
   * @param {Object} [param0.superdoc] The SuperDoc instance.
   * @param {string | null} [param0.parentCommentId] The comment or tracked-change row being replied to.
   * @param {string} [param0.text] The reply text.
   * @param {Array<{ name?: string | null, email?: string | null }>} [param0.mentions] Users mentioned in the reply.
   * @param {{ kind: 'trackedChange', trackedChangeId: string, story?: unknown, side?: 'source' | 'destination' }} [param0.trackedChangeTarget] The tracked change a first reply anchors to.
   */
  const replyCommentV2 = async ({ superdoc, parentCommentId, text, mentions = [], trackedChangeTarget } = {}) => {
    if (commentsAreReadOnly()) return readOnlyMutationOutcome();

    const v2Adapter = getV2CommentsAdapter(superdoc);
    if (!v2Adapter) return { ok: false, reason: 'v2-comments-adapter-missing' };

    const normalizedParent = parentCommentId != null ? String(parentCommentId) : null;
    if (!normalizedParent) return { ok: false, reason: 'parent-comment-id-missing' };
    const plainText = normalizeV2CommentDraftText(text);
    if (plainText.trim().length === 0) {
      return { ok: false, reason: 'comment-text-empty' };
    }

    let normalizedTrackedChangeTarget = null;
    if (trackedChangeTarget != null) {
      const trackedChangeId =
        trackedChangeTarget?.trackedChangeId != null ? String(trackedChangeTarget.trackedChangeId) : null;
      if (!trackedChangeId) return { ok: false, reason: 'tracked-change-id-missing' };
      if (trackedChangeId !== normalizedParent) {
        return { ok: false, reason: 'tracked-change-target-mismatch' };
      }
      const story = cloneV2TrackedChangeStory(trackedChangeTarget.story);
      normalizedTrackedChangeTarget = {
        kind: 'trackedChange',
        trackedChangeId,
        ...(trackedChangeTarget.side != null ? { side: trackedChangeTarget.side } : {}),
        ...(story ? { story } : {}),
      };
    }

    const parent = commentsList.value.find(
      (c) =>
        String(c.commentId) === normalizedParent ||
        (c.trackedChange === true && String(c.trackedChangeCanonicalId) === normalizedParent),
    );
    const fileId = parent?.fileId ?? v2Adapter.documentId ?? null;

    return runV2CommentMutation({
      superdoc,
      adapter: v2Adapter,
      fileId,
      operation: async () => {
        const replyOutcome = await v2Adapter.reply({
          parentCommentId: normalizedParent,
          text: plainText,
          ...(mentions.length ? { mentions } : {}),
        });
        if (replyOutcome?.ok || replyOutcome?.code !== 'TARGET_NOT_FOUND' || !normalizedTrackedChangeTarget) {
          return replyOutcome;
        }
        return v2Adapter.commitPendingComment({
          text: plainText,
          target: normalizedTrackedChangeTarget,
          ...(mentions.length ? { mentions } : {}),
        });
      },
      eventType: COMMENT_EVENTS.ADD,
      rejectionFallbackReason: 'v2-reply-failed',
      rejectionEventExtras: parent ? { comment: getCommentEventPayload(parent) } : {},
      successEventBuilder: ({ outcome, reconciled }) => ({
        type: COMMENT_EVENTS.ADD,
        comment: getV2CreatedComment({ outcome, reconciled, documentId: v2Adapter.documentId })?.getValues?.() ?? null,
      }),
    });
  };

  /**
   * Edit an existing comment through the v2 adapter.
   *
   * Plan §4.2 rules:
   *   - empty replacement text rejects with `comment-text-empty` before mutation
   *   - successful edit refreshes from v2 list and reconciles row text
   *   - rejection leaves original row + editing state intact, emits a
   *     rejected `comments-update` event with a stable reason
   */
  const editCommentV2 = async ({ superdoc, commentId, text } = {}) => {
    if (commentsAreReadOnly()) return readOnlyMutationOutcome();

    const v2Adapter = getV2CommentsAdapter(superdoc);
    if (!v2Adapter) return { ok: false, reason: 'v2-comments-adapter-missing' };

    const id = commentId != null ? String(commentId) : null;
    if (!id) return { ok: false, reason: 'comment-id-missing' };
    const plainText = normalizeV2CommentDraftText(text);
    if (plainText.trim().length === 0) {
      return { ok: false, reason: 'comment-text-empty' };
    }

    const existing = commentsList.value.find((c) => String(c.commentId) === id);
    const fileId = existing?.fileId ?? v2Adapter.documentId ?? null;

    return runV2CommentMutation({
      superdoc,
      adapter: v2Adapter,
      fileId,
      operation: () => v2Adapter.edit({ commentId: id, text: plainText }),
      eventType: COMMENT_EVENTS.UPDATE,
      rejectionFallbackReason: 'v2-edit-failed',
      rejectionEventExtras: existing
        ? { comment: getCommentEventPayload(existing), changes: [{ key: 'text', value: plainText }] }
        : {},
      successEventBuilder: () => {
        const refreshed = commentsList.value.find((c) => String(c.commentId) === id) ?? existing;
        if (!refreshed) return null;
        return {
          type: COMMENT_EVENTS.UPDATE,
          comment: getCommentEventPayload(refreshed),
          changes: [{ key: 'text', value: refreshed.commentText ?? plainText }],
        };
      },
    });
  };

  /**
   * Resolve an existing comment through the v2 adapter.
   *
   * Plan §4.3 rules:
   *   - successful resolve applies the committed lifecycle receipt to the
   *     hydrated thread and clears the active comment / dialog target
   *   - rejection leaves the row active, emits a rejected event
   *   - active state must never reference a deleted/missing anchor — the
   *     reconciler is already family-scoped (see TCS 001 §5)
   */
  const resolveCommentV2 = async ({ superdoc, commentId } = {}) => {
    if (commentsAreReadOnly()) return readOnlyMutationOutcome();
    if (resolveIsDisabled()) return resolveDisabledOutcome();

    const v2Adapter = getV2CommentsAdapter(superdoc);
    if (!v2Adapter) return { ok: false, reason: 'v2-comments-adapter-missing' };

    const id = commentId != null ? String(commentId) : null;
    if (!id) return { ok: false, reason: 'comment-id-missing' };

    const existing = commentsList.value.find((c) => String(c.commentId) === id);
    const fileId = existing?.fileId ?? v2Adapter.documentId ?? null;

    const result = await runV2CommentMutation({
      superdoc,
      adapter: v2Adapter,
      fileId,
      operation: () => v2Adapter.resolve({ commentId: id }),
      eventType: COMMENT_EVENTS.RESOLVED,
      rejectionFallbackReason: 'v2-resolve-failed',
      rejectionEventExtras: existing ? { comment: getCommentEventPayload(existing) } : {},
      validateOutcome: ({ outcome }) =>
        validateV2ThreadLifecycleRefresh({
          outcome,
          adapter: v2Adapter,
          fileId,
          commentId: id,
          expectedResolved: true,
          operation: 'resolve',
        }),
      successEventBuilder: () => {
        const refreshed = commentsList.value.find((c) => String(c.commentId) === id) ?? existing;
        if (!refreshed) return null;
        return {
          type: COMMENT_EVENTS.RESOLVED,
          comment: getCommentEventPayload(refreshed),
        };
      },
    });

    if (result?.ok) {
      // Clear the active target only after the mutation outcome has applied
      // the resolved lifecycle to the hydrated thread (plan §4.3).
      const refreshed = commentsList.value.find((c) => String(c.commentId) === id);
      const isResolved = Boolean(refreshed?.resolvedTime);
      const activeKey = activeComment.value != null ? String(activeComment.value) : null;
      if (isResolved && activeKey === id) {
        clearActiveCommentSelection();
      }
    }

    return result;
  };

  /**
   * Reopen a previously-resolved comment through the v2 adapter.
   *
   * Symmetric inverse of {@link resolveCommentV2}. The adapter routes the
   * reopen through `activeEditor.doc.comments.patch({ status: 'active' })`,
   * which removes the resolved anchors and restores the live comment mark.
   * The successful receipt updates the hydrated thread immediately while
   * normal review hydration remains the eventual reconciliation path. Rules:
   *   - the store owns mutation gating (via the adapter capability state),
   *     adapter identity stamping, local lifecycle projection, and event emission
   *   - there is no dedicated REOPENED event in the comment event enum, so a
   *     successful reopen emits an UPDATE event with the now-open
   *     comment payload
   *   - rejection is non-mutating and emits the same rejected-event shape as
   *     the other v2 comment mutations; the row stays resolved so the user can
   *     retry
   *   - body / replies / anchor identity are preserved; only lifecycle metadata
   *     changes on the hydrated thread
   */
  const reopenCommentV2 = async ({ superdoc, commentId } = {}) => {
    if (commentsAreReadOnly()) return readOnlyMutationOutcome();
    if (resolveIsDisabled()) return resolveDisabledOutcome();

    const v2Adapter = getV2CommentsAdapter(superdoc);
    if (!v2Adapter) return { ok: false, reason: 'v2-comments-adapter-missing' };

    const id = commentId != null ? String(commentId) : null;
    if (!id) return { ok: false, reason: 'comment-id-missing' };

    const existing = commentsList.value.find((c) => String(c.commentId) === id);
    const fileId = existing?.fileId ?? v2Adapter.documentId ?? null;

    return runV2CommentMutation({
      superdoc,
      adapter: v2Adapter,
      fileId,
      operation: () => v2Adapter.reopen({ commentId: id }),
      eventType: COMMENT_EVENTS.UPDATE,
      rejectionFallbackReason: 'v2-reopen-failed',
      rejectionEventExtras: existing
        ? { comment: getCommentEventPayload(existing), changes: [{ key: 'resolvedTime', value: null }] }
        : {},
      validateOutcome: ({ outcome }) =>
        validateV2ThreadLifecycleRefresh({
          outcome,
          adapter: v2Adapter,
          fileId,
          commentId: id,
          expectedResolved: false,
          operation: 'reopen',
        }),
      successEventBuilder: () => {
        // Only emit the open-state event after the refreshed list confirms the
        // thread is open again (resolvedTime cleared). If the row is missing or
        // still resolved we surface nothing rather than claim a false reopen.
        const refreshed = commentsList.value.find((c) => String(c.commentId) === id);
        if (!refreshed || refreshed.resolvedTime) return null;
        return {
          type: COMMENT_EVENTS.UPDATE,
          comment: getCommentEventPayload(refreshed),
          changes: [{ key: 'resolvedTime', value: null }],
        };
      },
    });
  };

  // Async results are stamped with the adapter that produced them so late
  // results after `onV2RenderCleared` (which calls
  // `setV2CommentsAdapter(null)`) cannot mutate durable rows. The "current"
  // adapter is the one resolved through `getV2CommentsAdapter(...)` at apply
  // time; if it no longer matches the stamped adapter we drop the result.
  //
  // Adapter throws are caught at the store boundary and surfaced as
  // `{ ok: false, reason: 'adapter-threw' }` so a buggy adapter cannot leave
  // the store in an inconsistent state.

  // Stamping signal: the store ref is authoritative for "v2 adapter is
  // mounted on this store". `onV2RenderCleared` in `SuperDoc.vue` always
  // calls `setV2CommentsAdapter(null)` / `setV2TrackedChangesAdapter(null)`
  // on teardown / remount, so a late async result whose stamped adapter no
  // longer matches the store ref is dropped without mutating durable rows.
  // We intentionally do not consult the `activeEditor` facade here — plan
  // §4 explicitly scopes teardown to the store/shell, not the facade.
  const isCurrentV2CommentsAdapter = (adapter) => {
    if (!adapter) return false;
    return v2CommentsAdapter.value === adapter;
  };
  const isCurrentV2TrackedChangesAdapter = (adapter) => {
    if (!adapter) return false;
    return v2TrackedChangesAdapter.value === adapter;
  };

  const reviewPresentationIdentityIds = (row) =>
    new Set(
      [
        ...getCommentAliasIds(row),
        row?.commentId,
        row?.importedId,
        row?.trackedChangeCanonicalId,
        row?.trackedChangeAnchorKey,
        row?.parentCommentId,
        row?.threadingParentCommentId,
        row?.trackedChangeParentId,
        row?.trackedChangeThreadParentId,
      ]
        .map((value) => normalizeCommentId(value))
        .filter(Boolean),
    );

  /** Keep one mounted review window plus rows whose interaction is still live. */
  const boundReviewPresentationRows = ({ documentId, visibleIds }) => {
    const currentRows = commentsList.value;
    const identityIdsByRow = new Map();
    const identityIdsFor = (row) => {
      let ids = identityIdsByRow.get(row);
      if (!ids) {
        ids = reviewPresentationIdentityIds(row);
        identityIdsByRow.set(row, ids);
      }
      return ids;
    };
    const retainedIds = new Set(
      [
        ...visibleIds,
        activeComment.value,
        activeFloatingCommentInstanceId.value,
        editingCommentId.value,
        pendingComment.value?.commentId,
        instantSidebarAlignmentThreadId.value,
        instantSidebarAlignmentInstanceId.value,
      ]
        .map((value) => normalizeCommentId(value))
        .filter(Boolean),
    );

    // Retain a complete active/visible thread. The fixed point handles a reply
    // that names its root as well as a tracked-change root that owns comments.
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of currentRows) {
        if (!belongsToTrackedChangeSyncDocument(row, documentId)) continue;
        const ids = identityIdsFor(row);
        if (![...ids].some((id) => retainedIds.has(id))) continue;
        for (const id of ids) {
          if (retainedIds.has(id)) continue;
          retainedIds.add(id);
          changed = true;
        }
      }
    }

    const nextRows = currentRows.filter((row) => {
      if (!belongsToTrackedChangeSyncDocument(row, documentId)) return true;
      if (row === pendingComment.value) return true;
      return [...identityIdsFor(row)].some((id) => retainedIds.has(id));
    });
    if (nextRows.length !== currentRows.length) commentsList.value = nextRows;
  };

  /**
   * Synchronously reconcile one host-validated committed review window. The caller
   * wraps this action in one Pinia `$patch`; all fallible mapping completes
   * before either row family mutates.
   */
  const applyReviewWindowFromV2 = ({
    superdoc,
    commentsAdapter,
    trackedChangesAdapter,
    documentId,
    commentItems,
    trackedChangeItems,
    preparedReview,
    requestedCommentIds,
    requestedTrackedChangeIds,
    unresolvedCommentIds,
    trackedList,
    sourceCoverageRevision,
    evaluatedRevision,
    patch,
  } = {}) =>
    withInteractionSpan(
      'store.reviewWindow.apply',
      'store-reconciliation',
      {
        commentItemCount: Array.isArray(commentItems) ? commentItems.length : null,
        trackedItemCount: Array.isArray(trackedChangeItems) ? trackedChangeItems.length : null,
      },
      () => {
        if (!isCurrentV2CommentsAdapter(commentsAdapter)) {
          return { ok: false, reason: 'comments-adapter-stale' };
        }
        if (!isCurrentV2TrackedChangesAdapter(trackedChangesAdapter)) {
          return { ok: false, reason: 'tracked-changes-adapter-stale' };
        }
        const normalizedDocumentId = documentId != null ? String(documentId) : null;
        const activeDocumentId =
          superdoc?.activeEditor?.documentId ?? superdoc?.activeEditor?.options?.documentId ?? null;
        if (!normalizedDocumentId) return { ok: false, reason: 'document-mismatch' };
        for (const candidate of [commentsAdapter.documentId, trackedChangesAdapter.documentId, activeDocumentId]) {
          if (candidate == null || String(candidate) !== normalizedDocumentId) {
            return { ok: false, reason: 'document-mismatch' };
          }
        }
        if (
          preparedReview &&
          (!Array.isArray(preparedReview.comments) ||
            !Array.isArray(preparedReview.trackedChanges) ||
            preparedReview.comments.length > 4096 ||
            preparedReview.trackedChanges.length > 4096)
        )
          return { ok: false, reason: 'items-invalid' };
        if (!Array.isArray(commentItems) || !Array.isArray(trackedChangeItems)) {
          return { ok: false, reason: 'items-invalid' };
        }
        if (trackedList?.complete !== false || trackedList?.visibleWindowSource !== 'visible-window') {
          return { ok: false, reason: 'tracked-list-not-partial-visible-window' };
        }
        if (preparedReview?.reuseCatalog === true && committedReviewPresentations.value[normalizedDocumentId]) {
          const previous = committedReviewPresentations.value[normalizedDocumentId];
          const next = preparedReview.presentation;
          if (
            !next ||
            !Number.isSafeInteger(preparedReview.catalogVersion) ||
            preparedReview.catalogVersion < 1 ||
            previous.catalogVersion > preparedReview.catalogVersion ||
            next.catalogVersion !== preparedReview.catalogVersion ||
            previous.coordinate?.documentEpoch !== next.coordinate?.documentEpoch ||
            previous.coordinate?.mountId !== next.coordinate?.mountId ||
            next.coordinate?.reviewVersion <= previous.coordinate?.reviewVersion ||
            next.coordinate?.commitSequence < previous.coordinate?.commitSequence
          ) {
            return { ok: false, reason: 'review-catalog-stale' };
          }
          if (typeof patch !== 'function') return { ok: false, reason: 'patch-missing' };
          if (previous.catalogVersion === preparedReview.catalogVersion) {
            // A changed font generation must wake card measurement even when
            // the worker reports unchanged geometry.
            if (
              next.unchanged === true &&
              next.fontRevision === previous.fontRevision &&
              next.epoch === previous.epoch &&
              next.baseVersion === previous.version &&
              next.version === next.baseVersion + 1
            ) {
              previous.version = next.version;
              previous.coordinate = next.coordinate;
              previous.readPaintOrigin = next.readPaintOrigin;
              previous.readFontRevision = next.readFontRevision;
              previous.updateContext = next.updateContext;
              return { ok: true, geometryOnly: true };
            }
            patch(() => {
              committedReviewPresentations.value = {
                ...committedReviewPresentations.value,
                [normalizedDocumentId]: next,
              };
            });
            return { ok: true, geometryOnly: true };
          }
          // Mutation pauses can coalesce the first catalog publication. The
          // host also supplies its validated retained payload for this recovery.
        }
        if (
          typeof commentsAdapter.mapV2CommentToUseCommentInput !== 'function' ||
          typeof trackedChangesAdapter.mapV2TrackedChangeToCommentParams !== 'function'
        ) {
          return { ok: false, reason: 'adapter-mapper-missing' };
        }

        const presentation = preparedReview?.presentation;
        const previousPresentation = committedReviewPresentations.value[normalizedDocumentId];
        if (
          preparedReview?.catalogVersion == null &&
          presentation?.unchanged === true &&
          previousPresentation &&
          presentation.fontRevision === previousPresentation.fontRevision &&
          presentation.epoch === previousPresentation.epoch &&
          presentation.baseVersion === previousPresentation.version &&
          presentation.version === presentation.baseVersion + 1
        ) {
          // The worker's acknowledged delta proves all rows, threads, aliases,
          // order and card geometry unchanged. Advance the paint capability
          // without replacing reactive collections or overwriting local drafts.
          previousPresentation.version = presentation.version;
          previousPresentation.coordinate = presentation.coordinate;
          previousPresentation.readPaintOrigin = presentation.readPaintOrigin;
          previousPresentation.readFontRevision = presentation.readFontRevision;
          previousPresentation.updateContext = presentation.updateContext;
          return {
            ok: true,
            commentItems: preparedReview.comments.length,
            trackedItems: preparedReview.trackedChanges.length,
          };
        }

        let effectiveCommentItems = commentItems;
        if (!preparedReview && typeof commentsAdapter.seedReviewCatalog === 'function') {
          const seeded = commentsAdapter.seedReviewCatalog(commentItems, {
            sourceCoverageRevision,
            evaluatedRevision,
          });
          if (seeded?.ok !== true) return { ok: false, reason: seeded?.reason ?? 'comment-catalog-seed-failed' };
          const selected = commentsAdapter.selectVisibleReviewComments?.();
          if (
            selected?.ok === true &&
            Array.isArray(selected.items) &&
            (!Array.isArray(selected.unresolvedIds) || selected.unresolvedIds.length === 0)
          ) {
            effectiveCommentItems = selected.items;
          }
        }

        const document = normalizedDocumentId ? superdocStore.getDocument(normalizedDocumentId) : null;
        const fileType = document?.type ?? null;
        let preparedInputs;
        let preparedParams;
        try {
          preparedInputs = preparedReview
            ? preparedReview.comments.map((input) => ({
                ...input,
                fileId: normalizedDocumentId,
                fileType,
                selection: { ...input.selection, documentId: normalizedDocumentId },
              }))
            : effectiveCommentItems
                .filter((item) => !isSyntheticTrackedChangeCommentLaneItem(item))
                .map((item) =>
                  commentsAdapter.mapV2CommentToUseCommentInput(item, {
                    fileId: normalizedDocumentId,
                    fileType,
                  }),
                )
                .filter(Boolean);
          preparedParams = preparedReview
            ? preparedReview.trackedChanges.map((params) => ({ ...params, documentId: normalizedDocumentId }))
            : trackedChangeItems
                .map((item) => trackedChangesAdapter.mapV2TrackedChangeToCommentParams(item))
                .filter(Boolean);
        } catch (error) {
          return { ok: false, reason: 'mapper-failed', detail: error?.message ?? String(error) };
        }
        if (typeof patch !== 'function') return { ok: false, reason: 'patch-missing' };
        const visibleIds = new Set(
          [
            ...(Array.isArray(requestedCommentIds) ? requestedCommentIds : []),
            ...(Array.isArray(requestedTrackedChangeIds) ? requestedTrackedChangeIds : []),
            ...(Array.isArray(unresolvedCommentIds) ? unresolvedCommentIds : []),
            ...effectiveCommentItems.flatMap((item) => [item?.id, item?.commentId, item?.importedId]),
            ...trackedChangeItems.flatMap((item) => [item?.id, item?.changeId]),
            ...preparedInputs.flatMap((input) => [
              input?.commentId,
              input?.importedId,
              input?.parentCommentId,
              input?.trackedChangeThreadParentId,
            ]),
            ...preparedParams.flatMap((params) => [
              params?.changeId,
              params?.trackedChangeCanonicalId,
              params?.trackedChangeAnchorKey,
            ]),
          ]
            .map((value) => normalizeCommentId(value))
            .filter(Boolean),
        );
        patch(() => {
          const previousPreparedPresentation = committedReviewPresentations.value[normalizedDocumentId] ?? null;
          if (preparedReview?.presentation)
            committedReviewPresentations.value = {
              ...committedReviewPresentations.value,
              [normalizedDocumentId]: preparedReview.presentation,
            };
          reconcileTrackedChangesFromV2({
            superdoc,
            adapter: trackedChangesAdapter,
            documentId: normalizedDocumentId,
            items: trackedChangeItems,
            preparedParams,
            preparedPresentation: preparedReview?.presentation ?? null,
            previousPreparedPresentation,
            pruneStale: false,
          });
          reconcileCommentsFromV2({
            superdoc,
            adapter: commentsAdapter,
            documentId: normalizedDocumentId,
            items: effectiveCommentItems,
            preparedInputs,
            pruneStale: false,
          });
          boundReviewPresentationRows({
            documentId: normalizedDocumentId,
            visibleIds,
          });
        });
        return {
          ok: true,
          commentItems: preparedInputs.length,
          trackedItems: preparedParams.length,
        };
      },
    );

  const reconcileCommentsFromV2 = ({
    superdoc,
    adapter,
    documentId,
    items,
    preparedInputs = null,
    pruneStale = true,
    hydrationGeneration,
  } = {}) =>
    withInteractionSpan(
      'store.comments.reconcile',
      'store-reconciliation',
      {
        documentId: documentId ?? null,
        itemCount: Array.isArray(items) ? items.length : null,
        hydrationGeneration: hydrationGeneration ?? null,
      },
      () => {
        if (!adapter || !Array.isArray(items)) return { added: null };
        // Late results after teardown/remount are dropped — durable rows for the
        // previous mount must not be mutated by a stale adapter result.
        if (!isCurrentV2CommentsAdapter(adapter)) return { added: null, dropped: 'adapter-stale' };

        const effectiveDocumentId = documentId ?? adapter.documentId ?? null;
        const normalizedEffectiveDocumentId = effectiveDocumentId != null ? String(effectiveDocumentId) : null;
        const document = effectiveDocumentId ? superdocStore.getDocument(effectiveDocumentId) : null;
        const fileType = document?.type ?? null;
        const isBlankV2CommentText = (value) => {
          if (typeof value !== 'string') return true;
          return (
            value
              .replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/gi, ' ')
              .trim().length === 0
          );
        };
        const isV2TrackedChangeSidecarCommentInput = (input) => {
          if (!input || input.trackedChange === true) return false;
          if (!input.trackedChangeThreadParentId || input.parentCommentId) return false;
          return isBlankV2CommentText(input.commentText);
        };

        // Capture active row family BEFORE mutation so active-row clearing is
        // family-scoped: comment reconciliation must not clear an active
        // tracked-change row (TCS Phase 0 §5).
        const activeKey = activeComment.value != null ? String(activeComment.value) : null;
        const previousActiveRow = activeKey
          ? (commentsList.value.find((c) => String(c.commentId) === activeKey) ?? null)
          : null;
        const previousActivePendingMatch =
          previousActiveRow != null &&
          pendingComment.value != null &&
          (previousActiveRow === pendingComment.value ||
            (pendingComment.value.commentId != null &&
              String(previousActiveRow.commentId ?? '') === String(pendingComment.value.commentId)));
        const activeWasRealCommentInThisDoc =
          previousActiveRow != null &&
          !previousActivePendingMatch &&
          previousActiveRow.trackedChange !== true &&
          !isV2SyntheticTrackedChangeRow(previousActiveRow) &&
          (normalizedEffectiveDocumentId == null ||
            previousActiveRow.fileId == null ||
            String(previousActiveRow.fileId) === normalizedEffectiveDocumentId);

        // Build the next comment-family rows for the effective document.
        // Synthetic tracked-change comment-lane items are filtered out at the
        // store boundary; the real tracked-change family is owned by
        // `reconcileTrackedChangesFromV2(...)`.
        const incomingByCommentId = new Map();
        const trackedChangeSidecarParentByCommentId = new Map();
        const mappedInputs = [];
        const candidateInputs = Array.isArray(preparedInputs)
          ? preparedInputs
          : items
              .filter((item) => !isSyntheticTrackedChangeCommentLaneItem(item))
              .map((item) =>
                adapter.mapV2CommentToUseCommentInput(item, {
                  fileId: effectiveDocumentId,
                  fileType,
                }),
              )
              .filter(Boolean);
        for (const input of candidateInputs) {
          if (isV2TrackedChangeSidecarCommentInput(input)) {
            trackedChangeSidecarParentByCommentId.set(
              String(input.commentId),
              String(input.trackedChangeThreadParentId),
            );
            traceBenchmarkComments('hydrate:drop-v2-sidecar-comment', {
              commentId: input.commentId ?? null,
              importedId: input.importedId ?? null,
              parentCommentId: input.parentCommentId ?? null,
              trackedChangeParentId: input.trackedChangeParentId ?? null,
              trackedChangeThreadParentId: input.trackedChangeThreadParentId ?? null,
              trackedChangeSide: input.trackedChangeSide ?? null,
              commentText: input.commentText ?? null,
            });
            continue;
          }
          mappedInputs.push(input);
        }

        for (const input of mappedInputs) {
          const parentId = input.parentCommentId != null ? String(input.parentCommentId) : null;
          const trackedChangeThreadId = parentId ? trackedChangeSidecarParentByCommentId.get(parentId) : null;
          if (trackedChangeThreadId) {
            input.threadingParentCommentId = trackedChangeThreadId;
            if (input.trackedChangeThreadParentId == null) {
              input.trackedChangeThreadParentId = trackedChangeThreadId;
            }
          }
          const cid = input.commentId != null ? String(input.commentId) : null;
          if (!cid) continue;
          incomingByCommentId.set(cid, input);
        }

        const belongsToReconciledDocument = (comment) => {
          if (normalizedEffectiveDocumentId == null) return true;
          const fid = comment?.fileId != null ? String(comment.fileId) : null;
          if (fid == null) return true;
          return fid === normalizedEffectiveDocumentId;
        };

        // Pinia/Vue can hand back distinct proxy wrappers for the same target
        // when an object is referenced from two refs, so identity (`===`) alone
        // is not sufficient — compare on commentId too.
        const pendingCommentId =
          pendingComment.value?.commentId != null ? String(pendingComment.value.commentId) : null;
        const isPendingRow = (comment) => {
          if (!comment || !pendingComment.value) return false;
          if (comment === pendingComment.value) return true;
          if (pendingCommentId != null && String(comment.commentId ?? '') === pendingCommentId) return true;
          return false;
        };

        const isRealCommentFamilyRow = (comment) => {
          if (!comment) return false;
          if (isPendingRow(comment)) return false;
          if (comment.trackedChange === true) return false;
          if (isV2SyntheticTrackedChangeRow(comment)) return false;
          return comment.commentId != null;
        };

        const applyUpdate = (existing, input) => {
          existing.commentText = input.commentText ?? existing.commentText;
          existing.mentions = Array.isArray(input.mentions) ? input.mentions : [];
          existing.isInternal = typeof input.isInternal === 'boolean' ? input.isInternal : existing.isInternal;
          const hasResolvedTime = typeof input.resolvedTime === 'number';
          if (hasResolvedTime) {
            const preserveExistingResolvedTime =
              input.resolvedTimeWasSynthesized === true && typeof existing.resolvedTime === 'number';
            existing.resolvedTime = preserveExistingResolvedTime ? existing.resolvedTime : input.resolvedTime;
            existing.resolvedByEmail = input.resolvedByEmail ?? null;
            existing.resolvedByName = input.resolvedByName ?? null;
          } else {
            existing.resolvedTime = null;
            existing.resolvedByEmail = null;
            existing.resolvedByName = null;
          }
          if (input.parentCommentId !== undefined) {
            existing.parentCommentId = input.parentCommentId;
          } else {
            delete existing.parentCommentId;
          }
          if (input.trackedChangeParentId !== undefined) {
            existing.trackedChangeParentId = input.trackedChangeParentId;
          } else {
            delete existing.trackedChangeParentId;
          }
          if (input.trackedChangeThreadParentId !== undefined) {
            existing.trackedChangeThreadParentId = input.trackedChangeThreadParentId;
          } else {
            existing.trackedChangeThreadParentId = undefined;
          }
          if (input.trackedChangeSide !== undefined) {
            existing.trackedChangeSide = input.trackedChangeSide;
          } else {
            existing.trackedChangeSide = undefined;
          }
          if (input.threadingParentCommentId !== undefined) {
            existing.threadingParentCommentId = input.threadingParentCommentId;
          } else {
            delete existing.threadingParentCommentId;
          }
        };

        const nextList = [];
        const seenIncoming = new Set();
        const addedComments = [];

        for (const existing of commentsList.value) {
          if (!isRealCommentFamilyRow(existing) || !belongsToReconciledDocument(existing)) {
            // Preserve tracked-change rows, pending UI rows, and rows for other
            // open documents. These are owned by other reconciliation paths.
            nextList.push(existing);
            continue;
          }
          const cid = String(existing.commentId);
          const input = incomingByCommentId.get(cid);
          if (input) {
            applyUpdate(existing, input);
            seenIncoming.add(cid);
            nextList.push(existing);
          }
          // A visible-window merge is deliberately non-destructive. Only an
          // authoritative full catalog may remove rows that are absent.
          if (!input && !pruneStale) nextList.push(existing);
        }

        for (const [cid, input] of incomingByCommentId.entries()) {
          if (seenIncoming.has(cid)) continue;
          const created = useComment(input);
          nextList.push(created);
          addedComments.push(created);
        }

        if (
          mappedInputs.length > 0 ||
          nextList.length !== commentsList.value.length ||
          nextList.some((row, index) => row !== commentsList.value[index])
        ) {
          commentsList.value = nextList;
        }

        // Family-scoped active-row clearing: only clear when the active row was
        // a real-comment-family row in this document AND it's no longer present.
        if (activeWasRealCommentInThisDoc && activeKey && !nextList.some((c) => String(c.commentId) === activeKey)) {
          clearActiveCommentSelection();
        }

        void superdoc; // reserved for future emit (e.g., per-item RESOLVED events)
        return { added: addedComments[addedComments.length - 1] ?? null };
      },
    );

  /**
   * Reconcile and publish a root comment created by the private V2 context menu.
   * That path owns selection capture, while this store remains the sole owner
   * of shared comment rows and public comments-update events.
   */
  const announceV2CommentCreated = async ({ superdoc, commentId } = {}) => {
    const id = normalizeCommentId(commentId);
    const adapter = getV2CommentsAdapter(superdoc);
    const commentsApi = superdoc?.activeEditor?.doc?.comments;
    if (!id) return { ok: false, reason: 'comment-id-missing' };
    if (!adapter || !isCurrentV2CommentsAdapter(adapter)) {
      return { ok: false, reason: 'comments-adapter-stale' };
    }
    if (typeof commentsApi?.get !== 'function') {
      return { ok: false, reason: 'document-api-unavailable' };
    }

    let item;
    try {
      item = await commentsApi.get({ commentId: id });
    } catch (err) {
      return { ok: false, reason: 'comment-read-failed', detail: err?.message ?? String(err) };
    }
    if (!isCurrentV2CommentsAdapter(adapter)) {
      return { ok: false, reason: 'comments-adapter-stale' };
    }

    const reconciled = reconcileCommentsFromV2({
      superdoc,
      adapter,
      documentId: adapter.documentId,
      items: [item],
      pruneStale: false,
    });
    const comment =
      reconciled?.added ??
      commentsList.value.find(
        (candidate) => String(candidate?.commentId ?? '') === id || String(candidate?.importedId ?? '') === id,
      ) ??
      null;
    const event = {
      type: COMMENT_EVENTS.ADD,
      comment: comment?.getValues?.() ?? null,
    };
    superdoc?.emit?.('comments-update', event);
    return { ok: true, comment };
  };

  /**
   * Cancel the pending comment
   *
   * @returns {void}
   */
  const cancelComment = (superdoc) => {
    removePendingComment(superdoc);
  };

  /**
   * Drop imported threads and cached positions for one document id.
   *
   * Replace-file swaps call this before hydrating the replacement so stale
   * comments never survive long enough to render beside the new content.
   *
   * @param {string | null | undefined} documentId
   * @returns {void}
   */
  function removeCommentsForDocument(documentId) {
    const activeDocumentId = documentId != null ? String(documentId) : null;
    if (!activeDocumentId) return;
    if (committedReviewPresentations.value[activeDocumentId]) {
      const next = { ...committedReviewPresentations.value };
      delete next[activeDocumentId];
      committedReviewPresentations.value = next;
    }

    const removedComments = commentsList.value.filter((comment) =>
      belongsToDocument(comment, activeDocumentId, { allowSingleDocumentMismatch: true }),
    );
    if (!removedComments.length) return;

    const removedAliasIds = new Set();
    removedComments.forEach((comment) => {
      getCommentAliasIds(comment).forEach((id) => removedAliasIds.add(id));
    });

    commentsList.value = commentsList.value.filter((comment) => !removedComments.includes(comment));

    if (removedAliasIds.size) {
      const nextPositions = { ...editorCommentPositions.value };
      removedAliasIds.forEach((id) => {
        delete nextPositions[id];
      });
      editorCommentPositions.value = nextPositions;
    }

    const activeCommentId = activeComment.value != null ? String(activeComment.value) : null;
    if (activeCommentId && removedAliasIds.has(activeCommentId)) {
      clearActiveCommentSelection();
    }
  }

  const getCommentDocumentId = (comment) => {
    if (!comment) return null;
    if (comment.fileId != null) return String(comment.fileId);
    if (comment.documentId != null) return String(comment.documentId);
    if (comment.selection?.documentId != null) return String(comment.selection.documentId);
    return null;
  };

  const getOpenDocuments = () => {
    const docs = Array.isArray(superdocStore.documents) ? superdocStore.documents : superdocStore.documents?.value;
    return Array.isArray(docs) ? docs : [];
  };

  const getSingleOpenDocumentId = () => {
    const docs = getOpenDocuments();
    if (docs.length !== 1) return null;
    return docs[0]?.id != null ? String(docs[0].id) : null;
  };

  const belongsToDocument = (comment, activeDocumentId, options = {}) => {
    const { allowSingleDocumentMismatch = false } = options;
    if (!activeDocumentId) return false;

    const commentDocumentId = getCommentDocumentId(comment);
    if (commentDocumentId) {
      if (commentDocumentId === activeDocumentId) return true;

      const singleOpenDocumentId = getSingleOpenDocumentId();
      return allowSingleDocumentMismatch && singleOpenDocumentId === activeDocumentId;
    }

    // Legacy fallback: in single-document sessions, comments may not carry explicit
    // document metadata yet. Treat them as belonging to the only open document.
    return getSingleOpenDocumentId() === activeDocumentId;
  };

  const belongsToTrackedChangeSyncDocument = (comment, activeDocumentId) => {
    // Collaboration replay can surface the same logical tracked-change thread with
    // a peer's equivalent single-document id. During tracked-change reconciliation
    // there is only one valid target document, so treat that mismatch as in-scope.
    return belongsToDocument(comment, activeDocumentId, { allowSingleDocumentMismatch: true });
  };

  const normalizeTrackedChangeDecisionType = (value) => {
    const lower = typeof value === 'string' ? value.toLowerCase() : '';
    if (!lower) return null;
    if (
      lower === 'insert' ||
      lower === 'insertion' ||
      lower === 'trackinsert' ||
      lower === 'tableinsert' ||
      lower === 'paragraphsplit'
    ) {
      return 'insertion';
    }
    if (lower === 'delete' || lower === 'deletion' || lower === 'trackdelete' || lower === 'tabledelete') {
      return 'deletion';
    }
    return lower;
  };

  const trackedChangeDecisionKeepsCommentAnchor = ({ comment, decision } = {}) => {
    const normalizedDecision = decision === 'accept' || decision === 'reject' ? decision : null;
    if (!normalizedDecision) return false;
    const type =
      normalizeTrackedChangeDecisionType(comment?.trackedChangeDisplayType) ??
      normalizeTrackedChangeDecisionType(comment?.trackedChangeType);
    return (
      (normalizedDecision === 'accept' && type === 'insertion') ||
      (normalizedDecision === 'reject' && type === 'deletion')
    );
  };

  // SD-4689: One logical body tracked change must produce one sidebar card.
  // Canonical rows only join on commentId: imported IDs and position aliases
  // can belong to distinct changes, and move sides share one canonical ID.
  // Legacy rows without canonical identity still compact through their aliases.
  const getBodyTrackedChangeIdentityIds = (comment) => {
    const commentId = normalizeCommentId(comment.commentId);
    const canonicalId = normalizeCommentId(comment.trackedChangeCanonicalId);
    return [
      commentId,
      ...(!canonicalId
        ? [
            comment.importedId,
            comment.trackedChangeAnchorKey,
            ...normalizeTrackedChangePositionAliases(comment.trackedChangePositionAliases),
          ]
        : []),
    ]
      .map((id) => normalizeCommentId(id))
      .filter(Boolean);
  };

  const groupBodyTrackedChangeCommentsByIdentity = (comments) => {
    const parents = comments.map((_, index) => index);
    const findRoot = (index) => {
      let root = index;
      while (parents[root] !== root) root = parents[root];
      while (parents[index] !== index) {
        const next = parents[index];
        parents[index] = root;
        index = next;
      }
      return root;
    };
    const join = (left, right) => {
      const leftRoot = findRoot(left);
      const rightRoot = findRoot(right);
      if (leftRoot === rightRoot) return;
      parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    };
    const identityOwner = new Map();
    comments.forEach((comment, index) => {
      getBodyTrackedChangeIdentityIds(comment).forEach((identityId) => {
        const owner = identityOwner.get(identityId);
        if (owner === undefined) identityOwner.set(identityId, index);
        else join(index, owner);
      });
    });
    const groups = new Map();
    comments.forEach((comment, index) => {
      const root = findRoot(index);
      const group = groups.get(root) ?? [];
      group.push(comment);
      groups.set(root, group);
    });
    return groups;
  };

  const mergeDuplicateBodyTrackedChangeComments = (groups) => {
    const duplicates = new Map();
    groups.forEach(([survivor, ...duplicateRows]) => {
      if (!survivor || duplicateRows.length === 0) return;
      const resolvedDuplicate = duplicateRows.find((comment) => comment.resolvedTime != null);
      if (survivor.resolvedTime == null && resolvedDuplicate) {
        survivor.resolvedTime = resolvedDuplicate.resolvedTime;
        survivor.resolvedById = resolvedDuplicate.resolvedById;
        survivor.resolvedByEmail = resolvedDuplicate.resolvedByEmail;
        survivor.resolvedByName = resolvedDuplicate.resolvedByName;
        survivor.trackedChangeDecision = resolvedDuplicate.trackedChangeDecision;
      }
      survivor.trackedChangePositionAliases = normalizeTrackedChangePositionAliases([
        ...normalizeTrackedChangePositionAliases(survivor.trackedChangePositionAliases),
        ...duplicateRows.flatMap((comment) => [
          comment.commentId,
          comment.importedId,
          comment.trackedChangeCanonicalId,
          ...normalizeTrackedChangePositionAliases(comment.trackedChangePositionAliases),
        ]),
      ]);
      duplicateRows.forEach((comment) => duplicates.set(comment, survivor));
    });
    return duplicates;
  };

  const createDroppedCommentIdMap = (duplicates) => {
    const droppedCommentIds = new Map();
    duplicates.forEach((survivor, duplicate) => {
      const fromId = normalizeCommentId(duplicate.commentId);
      const toId = normalizeCommentId(survivor.commentId);
      if (fromId && toId) droppedCommentIds.set(fromId, toId);
    });
    return droppedCommentIds;
  };

  const remapTrackedChangeReferences = (droppedCommentIds, activeDocumentId) => {
    const remapSelection = (selection) => {
      const selectedId = normalizeCommentId(selection.value);
      if (selectedId && droppedCommentIds.has(selectedId)) selection.value = droppedCommentIds.get(selectedId);
    };
    remapSelection(activeComment);
    remapSelection(activeFloatingCommentInstanceId);
    commentsList.value.forEach((row) => {
      if (!belongsToTrackedChangeSyncDocument(row, activeDocumentId)) return;
      const rowIdentityUpdates = {};
      for (const field of [
        'trackedChangeThreadParentId',
        'trackedChangeParentId',
        'threadingParentCommentId',
        'parentCommentId',
      ]) {
        const replacementId = droppedCommentIds.get(normalizeCommentId(row?.[field]));
        if (!replacementId) continue;
        row[field] = replacementId;
        rowIdentityUpdates[field] = replacementId;
      }
      if (Object.keys(rowIdentityUpdates).length && typeof row.updateIdentityValues === 'function') {
        row.updateIdentityValues(rowIdentityUpdates);
      }
    });
  };

  const compactDuplicateBodyTrackedChangeComments = (activeDocumentId) => {
    const candidates = commentsList.value.filter(
      (comment) => isBodyTrackedChangeComment(comment) && belongsToTrackedChangeSyncDocument(comment, activeDocumentId),
    );
    const groups = groupBodyTrackedChangeCommentsByIdentity(candidates);
    const duplicates = mergeDuplicateBodyTrackedChangeComments(groups);

    if (!duplicates.size) return 0;
    commentsList.value = commentsList.value.filter((comment) => !duplicates.has(comment));
    // Remap by dropped commentId only. Position aliases include Word w:id
    // tokens ('1'/'2') that collide with real comment ids; getComment prefers
    // primary ids, so alias-based remap would steal that selection.
    remapTrackedChangeReferences(createDroppedCommentIdMap(duplicates), activeDocumentId);
    return duplicates.size;
  };

  /**
   * Remove tracked-change comments that no longer have a corresponding mark in the editor.
   * Also removes any replies linked to those removed tracked-change threads.
   *
   * Pruning is scoped to the active editor document so replay in one document does not
   * delete tracked-change comments from other open documents.
   *
   * @param {Set<string>} liveTrackedChangeIds IDs currently present in editor marks.
   * @param {string | null} activeDocumentId Document currently being synced.
   * @returns {void}
   */
  const pruneStaleTrackedChangeComments = (
    liveTrackedChangeIds,
    liveTrackedChangeAnchorKeys,
    activeDocumentId,
    superdoc = null,
    { broadcastChanges = true } = {},
  ) =>
    withInteractionSpan(
      'store.trackedChanges.pruneStaleComments',
      'store-reconciliation',
      {
        activeDocumentId: activeDocumentId ?? null,
        liveIdCount: liveTrackedChangeIds instanceof Set ? liveTrackedChangeIds.size : null,
        liveAnchorKeyCount: liveTrackedChangeAnchorKeys instanceof Set ? liveTrackedChangeAnchorKeys.size : null,
      },
      () => {
        if (!(liveTrackedChangeIds instanceof Set) || !activeDocumentId) return;

        const removedIds = new Set();
        const restoredComments = [];
        const previousComments = [...commentsList.value];

        commentsList.value = commentsList.value.filter((comment) => {
          if (!comment?.trackedChange) return true;
          if (!belongsToTrackedChangeSyncDocument(comment, activeDocumentId)) return true;

          const commentId = comment.commentId != null ? String(comment.commentId) : null;
          const importedId = comment.importedId != null ? String(comment.importedId) : null;
          const anchorKey = comment.trackedChangeAnchorKey != null ? String(comment.trackedChangeAnchorKey) : null;
          const hasLiveCommentId = Boolean(commentId && liveTrackedChangeIds.has(commentId));
          const hasLiveImportedId = Boolean(importedId && liveTrackedChangeIds.has(importedId));
          const hasLiveAnchorKey = Boolean(anchorKey && liveTrackedChangeAnchorKeys?.has(anchorKey));

          if ((!commentId && !importedId && !anchorKey) || hasLiveCommentId || hasLiveImportedId || hasLiveAnchorKey) {
            return true;
          }
          if (comment.resolvedTime) return true;

          const resolutionSnapshot = trackedChangeResolutionSnapshots.get(comment);
          if (resolutionSnapshot) {
            comment.resolvedTime = resolutionSnapshot.resolvedTime ?? Date.now();
            comment.resolvedById = resolutionSnapshot.resolvedById ?? null;
            comment.resolvedByEmail = resolutionSnapshot.resolvedByEmail ?? null;
            comment.resolvedByName = resolutionSnapshot.resolvedByName ?? null;
            comment.trackedChangeDecision = resolutionSnapshot.trackedChangeDecision ?? null;
            restoredComments.push(comment);
            return true;
          }

          if (commentId) removedIds.add(commentId);
          if (importedId) removedIds.add(importedId);
          return false;
        });

        compactDuplicateBodyTrackedChangeComments(activeDocumentId);

        restoredComments.forEach((comment) => {
          // Compact may have dropped this restored duplicate; skip so we do not
          // rebroadcast an UPDATE that would recreate the phantom sidebar card.
          if (!commentsList.value.includes(comment)) return;
          const payload = getCommentEventPayload(comment);
          const event = {
            type: COMMENT_EVENTS.UPDATE,
            comment: payload,
          };
          if (broadcastChanges) {
            syncCommentsToClients(superdoc, event);
            superdoc?.emit?.('comments-update', event);
          }
        });

        if (!removedIds.size) return;

        let didRemoveDescendants = true;
        while (didRemoveDescendants) {
          didRemoveDescendants = false;
          commentsList.value = commentsList.value.filter((comment) => {
            if (!belongsToTrackedChangeSyncDocument(comment, activeDocumentId)) return true;

            const parentCommentId = comment.parentCommentId != null ? String(comment.parentCommentId) : null;
            const trackedChangeThreadParentId =
              trackedChangeThreadParentIdForComment(comment) != null
                ? String(trackedChangeThreadParentIdForComment(comment))
                : null;
            const isLinkedToRemovedParent =
              (parentCommentId && removedIds.has(parentCommentId)) ||
              (trackedChangeThreadParentId && removedIds.has(trackedChangeThreadParentId));

            if (!isLinkedToRemovedParent) return true;
            if (comment.resolvedTime) return true;

            const commentId = comment.commentId != null ? String(comment.commentId) : null;
            const importedId = comment.importedId != null ? String(comment.importedId) : null;
            if (commentId) removedIds.add(commentId);
            if (importedId) removedIds.add(importedId);
            didRemoveDescendants = true;
            return false;
          });
        }

        const removedComments = previousComments.filter((comment) => {
          if (!belongsToTrackedChangeSyncDocument(comment, activeDocumentId)) return false;
          const commentId = comment.commentId != null ? String(comment.commentId) : null;
          const importedId = comment.importedId != null ? String(comment.importedId) : null;
          return (commentId && removedIds.has(commentId)) || (importedId && removedIds.has(importedId));
        });

        removedComments.forEach((comment) => {
          const payload = getCommentEventPayload(comment);
          const event = {
            type: COMMENT_EVENTS.DELETED,
            comment: payload,
            changes: [{ key: 'deleted', commentId: payload.commentId, fileId: payload.fileId }],
          };
          if (broadcastChanges) {
            syncCommentsToClients(superdoc, event);
            superdoc?.emit?.('comments-update', event);
          }
        });

        const activeCommentId = activeComment.value != null ? String(activeComment.value) : null;
        const activeCommentBelongsToActiveDocument = previousComments.some((comment) => {
          const commentId = comment.commentId != null ? String(comment.commentId) : null;
          const importedId = comment.importedId != null ? String(comment.importedId) : null;
          return (
            belongsToTrackedChangeSyncDocument(comment, activeDocumentId) &&
            ((commentId && commentId === activeCommentId) || (importedId && importedId === activeCommentId))
          );
        });
        if (activeCommentId && removedIds.has(activeCommentId) && activeCommentBelongsToActiveDocument) {
          clearActiveCommentSelection();
        }
      },
    );

  const resolveLinkedCommentsForTrackedChangeDecision = ({ superdoc, comment, decision } = {}) => {
    if (!comment?.trackedChange) return 0;
    if (trackedChangeDecisionKeepsCommentAnchor({ comment, decision })) return 0;
    const trackedChangeIds = collectTrackedChangeDecisionIds(comment);
    if (!trackedChangeIds.size) return 0;

    const resolveArgs = {
      email: superdoc?.user?.email ?? null,
      name: superdoc?.user?.name ?? null,
      superdoc,
      reconciliationToken: COMMENT_RECONCILIATION_TOKEN,
    };
    let resolvedCount = 0;

    getTrackedChangeDecisionLinks(comment).forEach((linkedComment) => {
      if (!linkedComment || linkedComment === comment) return;
      if (linkedComment.resolvedTime) return;
      const parentKeys = [
        trackedChangeThreadParentIdForComment(linkedComment),
        linkedComment.threadingParentCommentId,
        linkedComment.parentCommentId,
      ]
        .map((id) => normalizeCommentId(id))
        .filter(Boolean);
      if (!parentKeys.some((id) => trackedChangeIds.has(id))) return;
      if (typeof linkedComment.resolveComment === 'function') {
        linkedComment.resolveComment(resolveArgs);
        resolvedCount += 1;
      }
    });

    return resolvedCount;
  };

  const collectTrackedChangeDecisionIds = (comment) => {
    const trackedChangeIds = new Set(getCommentAliasIds(comment));
    if (comment?.trackedChangeCanonicalId != null) {
      trackedChangeIds.add(String(comment.trackedChangeCanonicalId));
    }
    const anchorKey = comment?.trackedChangeAnchorKey != null ? String(comment.trackedChangeAnchorKey) : null;
    if (anchorKey) {
      trackedChangeIds.add(anchorKey);
      if (anchorKey.startsWith('tc::')) {
        const rawId = anchorKey.slice(anchorKey.lastIndexOf('::') + 2);
        if (rawId) trackedChangeIds.add(rawId);
      }
    }
    return trackedChangeIds;
  };

  const getTrackedChangeDecisionLinks = (comment) => {
    const linked = [];
    const seen = new Set();
    for (const id of collectTrackedChangeDecisionIds(comment)) {
      for (const candidate of trackedChangeDecisionLinkIndex.value.get(String(id)) ?? []) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        linked.push(candidate);
      }
    }
    return linked;
  };

  const collectTrackedChangeEntityIdsFromReceipt = (receipt) => {
    const record = receipt && typeof receipt === 'object' ? receipt : null;
    if (!record?.success) return new Set();
    const ids = new Set();
    const collect = (entry) => {
      const ref = entry && typeof entry === 'object' ? entry : null;
      if (ref?.kind !== 'entity' || ref.entityType !== 'trackedChange') return;
      if (ref.entityId != null && String(ref.entityId).length > 0) ids.add(String(ref.entityId));
    };
    if (Array.isArray(record.removed)) record.removed.forEach(collect);
    if (Array.isArray(record.invalidatedRefs)) record.invalidatedRefs.forEach(collect);
    return ids;
  };

  const collectReliableDecidedTrackedChangeIds = (outcome) => {
    const ids = new Set();
    if (outcome?.decidedId != null && String(outcome.decidedId).length > 0) {
      ids.add(String(outcome.decidedId));
    }
    if (Array.isArray(outcome?.decidedIds)) {
      outcome.decidedIds.forEach((id) => {
        if (id != null && String(id).length > 0) ids.add(String(id));
      });
    }
    collectTrackedChangeEntityIdsFromReceipt(outcome?.receipt).forEach((id) => ids.add(id));
    return ids;
  };

  const detachLinkedCommentsForTrackedChangeDecision = ({ comment, decision } = {}) => {
    if (!comment?.trackedChange) return 0;
    if (!trackedChangeDecisionKeepsCommentAnchor({ comment, decision })) return 0;
    const trackedChangeIds = collectTrackedChangeDecisionIds(comment);
    if (!trackedChangeIds.size) return 0;
    let detachedCount = 0;
    getTrackedChangeDecisionLinks(comment).forEach((linkedComment) => {
      if (!linkedComment || linkedComment === comment) return;
      const trackedChangeParentId = normalizeCommentId(linkedComment.trackedChangeParentId);
      const trackedChangeThreadParentId = normalizeCommentId(linkedComment.trackedChangeThreadParentId);
      const threadingParentCommentId = normalizeCommentId(linkedComment.threadingParentCommentId);
      const parentCommentId = normalizeCommentId(linkedComment.parentCommentId);
      const isLinked =
        (trackedChangeParentId && trackedChangeIds.has(trackedChangeParentId)) ||
        (trackedChangeThreadParentId && trackedChangeIds.has(trackedChangeThreadParentId)) ||
        (threadingParentCommentId && trackedChangeIds.has(threadingParentCommentId)) ||
        (parentCommentId && trackedChangeIds.has(parentCommentId));
      if (!isLinked) return;
      delete linkedComment.trackedChangeParentId;
      linkedComment.trackedChangeThreadParentId = undefined;
      linkedComment.trackedChangeSide = undefined;
      delete linkedComment.threadingParentCommentId;
      if (parentCommentId && trackedChangeIds.has(parentCommentId)) delete linkedComment.parentCommentId;
      detachedCount += 1;
    });
    return detachedCount;
  };

  /**
   * Apply receipt remappedRefs as in-place identity updates so the comments
   * list does not drop the live TC row between `from` prune and `to` upsert.
   * Geometry position keys, active selection, and reply-thread parent links
   * follow the new id. Scoped to `documentId` so repeated imported ids in
   * another open document are never rewritten.
   */
  const remapTrackedChangeIdentities = (pairs = [], { documentId } = {}) => {
    const normalizedDocumentId = normalizeCommentId(documentId);
    if (!Array.isArray(pairs) || pairs.length === 0 || !normalizedDocumentId) return;
    const positions = editorCommentPositions.value || {};
    let positionsChanged = false;

    const rewriteIfMatch = (target, field, fromId, toId) => {
      if (normalizeCommentId(target?.[field]) !== fromId) return false;
      target[field] = toId;
      return true;
    };

    const matchesRemapSource = (row, fromId) =>
      row?.trackedChange &&
      belongsToTrackedChangeSyncDocument(row, normalizedDocumentId) &&
      [row.commentId, row.importedId, row.trackedChangeCanonicalId, ...getCommentAliasIds(row)]
        .map((id) => normalizeCommentId(id))
        .includes(fromId);

    for (const pair of pairs) {
      const fromId = normalizeCommentId(pair?.from);
      const toId = normalizeCommentId(pair?.to);
      if (!fromId || !toId || fromId === toId) continue;

      const comment = commentsList.value.find((row) => matchesRemapSource(row, fromId));
      if (!comment) continue;
      // Worker publications own stable row/thread keys and advance canonical
      // decision identities together. A receipt must not rename that row first.
      const presentation = committedReviewPresentations.value[normalizedDocumentId];
      if (
        normalizeCommentId(comment.fileId) === normalizedDocumentId &&
        presentation &&
        Object.prototype.hasOwnProperty.call(presentation.rowVersions ?? {}, String(comment.commentId))
      )
        continue;

      const previousCommentId = normalizeCommentId(comment.commentId);
      const previousCanonicalId = normalizeCommentId(comment.trackedChangeCanonicalId);
      const previousPositionEntry = resolveCommentPositionEntry(comment).entry;
      const directIdentityMatch = [comment.commentId, comment.importedId, comment.trackedChangeCanonicalId]
        .map((id) => normalizeCommentId(id))
        .includes(fromId);
      const advancesRemapLineage =
        !directIdentityMatch &&
        previousCommentId != null &&
        previousCanonicalId != null &&
        previousCommentId === previousCanonicalId;
      const commentIdentityUpdates = {};
      for (const field of ['commentId', 'importedId']) {
        if (rewriteIfMatch(comment, field, fromId, toId)) commentIdentityUpdates[field] = toId;
      }
      if (rewriteIfMatch(comment, 'trackedChangeCanonicalId', fromId, toId)) {
        commentIdentityUpdates.trackedChangeCanonicalId = toId;
      }
      if (advancesRemapLineage) {
        comment.commentId = toId;
        comment.trackedChangeCanonicalId = toId;
        commentIdentityUpdates.commentId = toId;
        commentIdentityUpdates.trackedChangeCanonicalId = toId;
      }
      const currentAnchorParts = parseTrackedChangeAnchorKey(comment.trackedChangeAnchorKey);
      const storyKey =
        currentAnchorParts?.storyKey ?? normalizeTrackedChangeStoryKey(getTrackedChangeStoryKey(comment));
      const toAnchor = buildTrackedChangeAnchorKeyForStory(storyKey, toId);
      const anchorSourceIds = new Set([fromId]);
      if (advancesRemapLineage) {
        if (previousCommentId) anchorSourceIds.add(previousCommentId);
        if (previousCanonicalId) anchorSourceIds.add(previousCanonicalId);
      }
      if (comment.trackedChangeAnchorKey == null || anchorSourceIds.has(currentAnchorParts?.rawId)) {
        comment.trackedChangeAnchorKey = toAnchor;
      }
      // Receipt remaps repeatedly originate from the stable source identity
      // while the grouped target changes after each Enter/typing mutation.
      // Retain that source as lineage so the next receipt can advance the
      // already-remapped row instead of leaving it stranded on the prior id.
      comment.trackedChangePositionAliases = normalizeTrackedChangePositionAliases([
        ...(Array.isArray(comment.trackedChangePositionAliases) ? comment.trackedChangePositionAliases : []),
        fromId,
      ]);

      const identitySourceIds = new Set([fromId]);
      if (advancesRemapLineage) {
        if (previousCommentId) identitySourceIds.add(previousCommentId);
        if (previousCanonicalId) identitySourceIds.add(previousCanonicalId);
      }

      // Rewire replies that still point at the pre-remap parent id.
      commentsList.value.forEach((row) => {
        if (row === comment) return;
        if (!belongsToTrackedChangeSyncDocument(row, normalizedDocumentId)) return;
        const rowIdentityUpdates = {};
        for (const field of [
          'trackedChangeThreadParentId',
          'trackedChangeParentId',
          'threadingParentCommentId',
          'parentCommentId',
        ]) {
          if (!identitySourceIds.has(normalizeCommentId(row?.[field]))) continue;
          row[field] = toId;
          rowIdentityUpdates[field] = toId;
        }
        if (Object.keys(rowIdentityUpdates).length && typeof row.updateIdentityValues === 'function') {
          row.updateIdentityValues(rowIdentityUpdates);
        }
      });

      if (Object.keys(commentIdentityUpdates).length && typeof comment.updateIdentityValues === 'function') {
        comment.updateIdentityValues(commentIdentityUpdates);
      }

      const previousEntry =
        previousPositionEntry ??
        [positions[fromId], positions[buildBodyTrackedChangeAnchorKey(fromId)]].find(
          (entry) => entry && positionEntryMatchesTrackedChangeStory(entry, comment),
        );
      if (previousEntry) {
        for (const key of [toId, toAnchor]) {
          if (positions[key] === undefined) {
            positions[key] = previousEntry;
            positionsChanged = true;
          }
        }
      }

      if (identitySourceIds.has(normalizeCommentId(activeComment.value))) activeComment.value = toId;
      if (identitySourceIds.has(normalizeCommentId(activeFloatingCommentInstanceId.value))) {
        activeFloatingCommentInstanceId.value = toId;
      }
    }

    if (positionsChanged) {
      editorCommentPositions.value = { ...positions };
    }
  };

  const pruneDecidedTrackedChangeRow = ({
    superdoc,
    comment: targetComment,
    decidedId,
    decidedIds,
    documentId,
  } = {}) => {
    const normalizedDecidedIds = new Set(
      (Array.isArray(decidedIds) || decidedIds instanceof Set ? Array.from(decidedIds) : [decidedId])
        .map((id) => normalizeCommentId(id))
        .filter(Boolean),
    );
    const normalizedDocumentId = normalizeCommentId(documentId);
    if (!normalizedDecidedIds.size || !normalizedDocumentId) return { removed: false, removedIds: new Set() };

    const removedIds = new Set();
    let removed = false;
    const targetIndex = targetComment ? commentsList.value.indexOf(targetComment) : -1;
    const targetIds = targetComment?.trackedChange ? collectTrackedChangeDecisionIds(targetComment) : new Set();
    const targetMatches =
      targetIndex >= 0 &&
      belongsToTrackedChangeSyncDocument(targetComment, normalizedDocumentId) &&
      Array.from(targetIds).some((id) => normalizedDecidedIds.has(id));
    if (targetMatches) {
      targetIds.forEach((id) => removedIds.add(id));
      commentsList.value.splice(targetIndex, 1);
      removed = true;
    } else {
      commentsList.value = commentsList.value.filter((comment) => {
        if (!comment?.trackedChange) return true;
        if (!belongsToTrackedChangeSyncDocument(comment, normalizedDocumentId)) return true;
        const ids = collectTrackedChangeDecisionIds(comment);
        if (!Array.from(ids).some((id) => normalizedDecidedIds.has(id))) return true;
        removed = true;
        ids.forEach((id) => removedIds.add(id));
        return false;
      });
    }

    if (!removed) return { removed: false, removedIds };

    const activeCommentId = activeComment.value != null ? String(activeComment.value) : null;
    if (activeCommentId && removedIds.has(activeCommentId)) {
      clearActiveCommentSelection();
    }

    void superdoc; // local UI convergence only; sync is handled by the committed receipt.
    return { removed: true, removedIds };
  };

  const clearAllResolvedTrackedChangeRows = ({ adapter, documentId } = {}) => {
    const normalizedDocumentId = normalizeCommentId(documentId);
    if (!adapter || !normalizedDocumentId) return { removed: 0, removedIds: new Set() };
    const removedIds = new Set();
    const activeId = normalizeCommentId(activeComment.value);
    let activeWasRemoved = false;
    const next = commentsList.value.filter((comment) => {
      if (!comment?.trackedChange || !belongsToTrackedChangeSyncDocument(comment, normalizedDocumentId)) {
        return true;
      }
      const aliases = collectTrackedChangeDecisionIds(comment);
      aliases.forEach((id) => removedIds.add(id));
      if (activeId && aliases.has(activeId)) activeWasRemoved = true;
      return false;
    });
    const removed = commentsList.value.length - next.length;
    if (removed > 0) commentsList.value = next;
    if (activeWasRemoved) clearActiveCommentSelection();
    return { removed, removedIds };
  };

  const clearV2ActiveTrackedChangeTarget = (adapter, decidedId) => {
    if (!decidedId || typeof adapter?.clearActiveTrackedChangeTargetIfMatches !== 'function') return;
    try {
      adapter.clearActiveTrackedChangeTargetIfMatches(decidedId);
    } catch {
      /* best-effort host clear */
    }
  };

  const waitForTrackedDecisionCanonicalPaint = async ({ superdoc, receipt } = {}) => {
    const readiness = superdoc?.activeEditor?.documentMutationReadiness;
    if (
      receipt?.success !== true ||
      typeof receipt?.txId !== 'string' ||
      !receipt.txId ||
      typeof readiness?.whenPainted !== 'function'
    ) {
      return;
    }
    try {
      await readiness.whenPainted(receipt);
      const requestFrame = globalThis.requestAnimationFrame;
      if (typeof requestFrame === 'function') {
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(fallback);
            resolve();
          };
          const fallback = setTimeout(finish, 250);
          requestFrame(() => requestFrame(() => setTimeout(finish, 0)));
        });
      }
    } catch {
      // The decision is already committed. If the exact paint waiter becomes
      // unavailable during teardown, converge the local sidebar immediately.
    }
  };

  /**
   * Accept or reject the tracked change behind a sidebar row.
   *
   * @param {Object} param0
   * @param {Object} param0.superdoc The SuperDoc instance.
   * @param {Object} param0.comment The tracked-change row.
   * @param {string} param0.decision `'accept'` or `'reject'`.
   * @returns {{ ok: boolean, success?: boolean, reason?: string } | Promise<{ ok: boolean, success?: boolean, reason?: string }>} The decision outcome.
   */
  const decideTrackedChangeFromSidebar = ({ superdoc, comment, decision }) => {
    const disabledReason = trackedChangeDecisionDisabledReason(superdoc);
    if (disabledReason) return { ok: false, reason: disabledReason };
    if (!comment?.trackedChange) return { ok: false };

    // ui-phase3-003: v2 mode keeps this compatibility adapter for row identity,
    // focus, and refresh behavior, but decisions delegate to the browser
    // Document API (`activeEditor.doc.trackChanges.decide`) rather than host
    // dispatch. v1 callers fall through to the existing document-api / command
    // path below.
    const v2Adapter = getV2TrackedChangesAdapter(superdoc);
    if (v2Adapter) {
      // Plan §4.2: invalid decision values reject before mutation. The
      // adapter would also reject, but doing it here avoids misleading
      // event-call ordering in callers that key off the return value.
      if (decision !== 'accept' && decision !== 'reject') {
        return Promise.resolve({ ok: false, reason: 'decision-invalid' });
      }
      // Capture the decided tracked-change id before mutation so we can
      // compare against the v2 host's active target after a successful
      // refresh, even if the comment row has been pruned from the store
      // by the reconcile step.
      const decidedId =
        comment?.trackedChangeCanonicalId != null
          ? String(comment.trackedChangeCanonicalId)
          : comment?.commentId != null
            ? String(comment.commentId)
            : comment?.trackedChangeAnchorKey?.startsWith?.('tc::body::')
              ? comment.trackedChangeAnchorKey.slice('tc::body::'.length)
              : null;
      const wasActiveBeforeDecide = decidedId != null && String(activeComment.value ?? '') === decidedId;
      return withInteractionSpan('store.trackedChanges.sidebarDecision', 'command', { decision, decidedId }, () => {
        const invocation = (async () => {
          try {
            return await (decision === 'accept' ? v2Adapter.accept(comment) : v2Adapter.reject(comment));
          } catch (err) {
            return { ok: false, reason: 'adapter-threw', detail: err?.message ?? String(err) };
          }
        })();
        return invocation.then(async (outcome) => {
          // Stamped-adapter guard: drop late decisions after teardown/remount.
          if (!isCurrentV2TrackedChangesAdapter(v2Adapter)) {
            return { ok: false, reason: 'adapter-stale' };
          }
          if (!outcome?.ok) return { ok: false, reason: outcome?.reason, detail: outcome?.detail };

          const receiptDecidedIds = collectReliableDecidedTrackedChangeIds(outcome);
          const localDecidedIds = receiptDecidedIds.size ? receiptDecidedIds : collectTrackedChangeDecisionIds(comment);
          const effectiveDocumentId =
            outcome?.documentId ??
            v2Adapter.documentId ??
            superdoc?.activeEditor?.documentId ??
            superdoc?.activeEditor?.options?.documentId ??
            null;
          if (!localDecidedIds.size || !effectiveDocumentId) {
            return { ok: false, committed: true, reason: 'decision-scope-missing' };
          }

          localDecidedIds.forEach((id) => clearV2ActiveTrackedChangeTarget(v2Adapter, id));

          // Receipt-local sidebar convergence can invalidate every mounted
          // review-card effect. Wait for this exact mutation's canonical frame
          // and presentation boundary before pruning the row so Vue work cannot
          // interrupt the narrow render pass. The returned decision promise
          // still resolves only after the local sidebar is converged.
          await waitForTrackedDecisionCanonicalPaint({ superdoc, receipt: outcome.receipt });
          resolveLinkedCommentsForTrackedChangeDecision({ superdoc, comment, decision });
          detachLinkedCommentsForTrackedChangeDecision({ comment, decision });
          pruneDecidedTrackedChangeRow({
            superdoc,
            comment,
            decidedIds: localDecidedIds,
            documentId: effectiveDocumentId,
          });
          if (wasActiveBeforeDecide) clearActiveCommentSelection();

          return { ok: true, success: true };
        });
      });
    }

    const activeEditor = superdoc?.activeEditor;
    if (!activeEditor) return { ok: false };

    const id = comment.commentId ?? comment.importedId;
    if (!id) return { ok: false };

    const story = comment.trackedChangeStory ?? undefined;
    const documentApi = typeof activeEditor.doc === 'object' ? activeEditor.doc : null;

    if (documentApi?.trackChanges?.decide) {
      try {
        const target = story ? { id, story } : { id };
        return Promise.resolve(documentApi.trackChanges.decide({ decision, target })).then((receipt) => ({
          ok: true,
          success: Boolean(receipt?.success),
        }));
      } catch (error) {
        if (story) {
          return { ok: false, error };
        }
      }
    }

    const commandName = decision === 'accept' ? 'acceptTrackedChangeById' : 'rejectTrackedChangeById';
    const command = activeEditor.commands?.[commandName];
    if (typeof command !== 'function') return { ok: false };
    return { ok: true, success: Boolean(command(id)) };
  };

  // ui-phase3-003: hydrate / reconcile tracked-change rows from the v2 host.
  // On first hydration we populate the sidebar with comment-style rows. On
  // subsequent reconciliations (post-decision refresh) we add new rows and
  // prune rows whose tracked-change id is no longer reported by the v2
  // `trackChanges.list()` result.
  /**
   * Apply only receipt-owned removals. Remaps are updated in place by the
   * caller; surviving/new rows arrive with the next committed review window.
   */
  const reconcileTrackedChangeMutationFromV2 = async ({
    superdoc,
    adapter,
    documentId,
    upsertIds = [],
    removedIds = [],
    remappedPairs = [],
    allResolved,
  } = {}) => {
    const effectiveAdapter = adapter ?? getV2TrackedChangesAdapter(superdoc);
    if (!effectiveAdapter) return { ok: false, reason: 'adapter-missing' };
    if (!isCurrentV2TrackedChangesAdapter(effectiveAdapter)) {
      return { ok: false, reason: 'adapter-stale' };
    }

    const effectiveDocumentId = documentId ?? effectiveAdapter.documentId ?? superdoc?.activeEditor?.documentId ?? null;
    if (allResolved && effectiveDocumentId == null) {
      // Never acknowledge an all-resolved reconciliation unless its row
      // ownership scope is known. Returning success here would let the shell
      // suppress authoritative tracked hydration while stale rows remain.
      return { ok: false, reason: 'document-id-missing' };
    }
    if (allResolved) {
      const cleared = withInteractionSpan(
        'store.trackedChanges.allResolved',
        'store-reconciliation',
        {
          documentId: String(effectiveDocumentId),
          logicalTargetCount: allResolved.logicalTargetCount ?? null,
          physicalCarrierCount: allResolved.physicalCarrierCount ?? null,
        },
        () =>
          clearAllResolvedTrackedChangeRows({
            adapter: effectiveAdapter,
            documentId: effectiveDocumentId,
          }),
      );
      return {
        ok: true,
        items: [],
        resolvedIds: [],
        unresolvedIds: [],
        allResolved: true,
        removedRows: cleared.removed,
      };
    }
    const normalizedRemovedIds = new Set(
      Array.from(removedIds ?? [])
        .map((id) => normalizeCommentId(id))
        .filter(Boolean),
    );
    const normalizedUpsertIds = [
      ...new Set(
        Array.from(upsertIds ?? [])
          .map((id) => normalizeCommentId(id))
          .filter(Boolean),
      ),
    ];
    const remappedSourceIds = new Set(
      (Array.isArray(remappedPairs) ? remappedPairs : []).map((pair) => normalizeCommentId(pair?.from)).filter(Boolean),
    );
    const locallyRemovedIds = new Set([...normalizedRemovedIds].filter((id) => !remappedSourceIds.has(id)));
    if (locallyRemovedIds.size > 0 && effectiveDocumentId != null) {
      pruneDecidedTrackedChangeRow({
        superdoc,
        decidedIds: locallyRemovedIds,
        documentId: effectiveDocumentId,
      });
    }
    return {
      ok: true,
      items: [],
      resolvedIds: [],
      unresolvedIds: normalizedUpsertIds,
      removedIds: [...locallyRemovedIds],
    };
  };

  const createTrackedChangeBatchIdentityIndex = (documentId) => {
    // A grouped row can identify an existing row through any of its position
    // aliases (for example, a coalesced delete replacing its first child row).
    // One unified alias index preserves that relationship without restoring the
    // previous O(existing rows × incoming rows) scan.
    const byIdentityAlias = new Map();
    const aliasesByRow = new Map();
    const indexedRows = new Set();
    let aliasLookups = 0;
    let candidateVisits = 0;
    let rowAliasBuilds = 0;
    let rowAliasCacheHits = 0;
    const aliasesFor = (comment) => {
      const cached = aliasesByRow.get(comment);
      if (cached) {
        rowAliasCacheHits += 1;
        return cached;
      }
      rowAliasBuilds += 1;
      const aliases = getCommentAliasIds(comment);
      aliasesByRow.set(comment, aliases);
      return aliases;
    };
    const addAlias = (index, value, comment) => {
      const alias = normalizeCommentId(value);
      if (!alias) return;
      const bucket = index.get(alias) ?? new Set();
      bucket.add(comment);
      index.set(alias, bucket);
    };
    const add = (comment) => {
      if (!comment?.trackedChange) return;
      if (documentId && !belongsToTrackedChangeSyncDocument(comment, documentId)) return;
      indexedRows.add(comment);
      addAlias(byIdentityAlias, comment.commentId, comment);
      addAlias(byIdentityAlias, comment.importedId, comment);
      addAlias(byIdentityAlias, comment.trackedChangeCanonicalId, comment);
      addAlias(byIdentityAlias, comment.trackedChangeAnchorKey, comment);
      const aliases = getCommentAliasIds(comment);
      rowAliasBuilds += 1;
      aliasesByRow.set(comment, aliases);
      aliases.forEach((alias) => addAlias(byIdentityAlias, alias, comment));
    };
    commentsList.value.forEach(add);
    return {
      add,
      aliasesFor,
      work: () => ({
        trackedRowsIndexed: indexedRows.size,
        invalidatedIdMembershipChecks: 0,
        incomingAliasLookups: aliasLookups,
        candidateVisits,
        rowAliasBuilds,
        rowAliasCacheHits,
      }),
      candidates({ changeId, importedId, anchorKey, canonicalId, positionAliases = [] } = {}) {
        const out = new Set();
        const include = (value) => {
          const alias = normalizeCommentId(value);
          if (!alias) return;
          aliasLookups += 1;
          const bucket = byIdentityAlias.get(alias);
          if (!bucket) return;
          candidateVisits += bucket.size;
          bucket.forEach((comment) => out.add(comment));
        };
        new Set([changeId, importedId, canonicalId, anchorKey, ...positionAliases]).forEach(include);
        return out;
      },
    };
  };

  const reconcileTrackedChangesFromV2 = ({
    superdoc,
    adapter,
    documentId,
    items,
    pruneStale = true,
    preparedParams = null,
    preparedPresentation = null,
    previousPreparedPresentation = null,
    liveIds: suppliedLiveIds = null,
    liveAnchorKeys: suppliedLiveAnchorKeys = null,
    hydrationGeneration,
  } = {}) =>
    withInteractionSpan(
      'store.trackedChanges.reconcile',
      'store-reconciliation',
      {
        documentId: documentId ?? null,
        itemCount: Array.isArray(items) ? items.length : null,
        pruneStale,
        hydrationGeneration: hydrationGeneration ?? null,
      },
      () => {
        if (!adapter || !Array.isArray(items)) return;
        // Late results after teardown/remount are dropped.
        if (!isCurrentV2TrackedChangesAdapter(adapter)) return;
        const effectiveDocumentId = documentId ?? adapter.documentId ?? superdoc?.activeEditor?.documentId ?? null;
        const liveAnchorKeys = suppliedLiveAnchorKeys instanceof Set ? suppliedLiveAnchorKeys : new Set();
        const liveIds = suppliedLiveIds instanceof Set ? suppliedLiveIds : new Set();
        let appliedCount = 0;
        const trackedChangeIdentityIndex = createTrackedChangeBatchIdentityIndex(
          effectiveDocumentId == null ? null : String(effectiveDocumentId),
        );
        const identitySpan = startInteractionSpan('store.trackedChanges.batchIdentity', 'store-reconciliation', {
          itemCount: items.length,
        });

        const paramsList = Array.isArray(preparedParams)
          ? preparedParams
          : items.map((item) => adapter.mapV2TrackedChangeToCommentParams(item));
        const previousCoordinate = previousPreparedPresentation?.coordinate;
        const coordinate = preparedPresentation?.coordinate;
        const retainUnchangedRows =
          !pruneStale &&
          previousCoordinate &&
          coordinate &&
          coordinate.documentEpoch === preparedPresentation.epoch &&
          coordinate.documentEpoch === previousPreparedPresentation.epoch &&
          coordinate.documentEpoch === previousCoordinate.documentEpoch &&
          typeof coordinate.mountId === 'string' &&
          coordinate.mountId.length > 0 &&
          coordinate.mountId === previousCoordinate.mountId &&
          preparedPresentation.baseVersion === previousPreparedPresentation.version &&
          preparedPresentation.version === preparedPresentation.baseVersion + 1 &&
          coordinate.reviewVersion === preparedPresentation.version &&
          previousCoordinate.reviewVersion === previousPreparedPresentation.version &&
          Number.isSafeInteger(coordinate.commitSequence) &&
          Number.isSafeInteger(previousCoordinate.commitSequence) &&
          coordinate.commitSequence >= previousCoordinate.commitSequence;
        try {
          for (const params of paramsList) {
            if (!params) continue;
            let retainUnchangedRow = false;
            if (preparedPresentation) {
              if (preparedPresentation !== committedReviewPresentations.value[String(effectiveDocumentId)]) continue;
              if (params.documentId != null && String(params.documentId) !== String(effectiveDocumentId)) continue;
              const id = normalizeCommentId(params.changeId);
              const version = preparedPresentation.rowVersions?.[id];
              if (!id || !Number.isSafeInteger(version) || version < 1) continue;
              const existing = [...trackedChangeIdentityIndex.candidates({ changeId: id })].filter(
                (row) => String(row.fileId) === String(effectiveDocumentId) && String(row.commentId) === id,
              );
              if (existing.length > 1) continue;
              const row = existing[0];
              if (row && row.trackedChangeCanonicalId !== params.trackedChangeCanonicalId) {
                const previousVersion = previousPreparedPresentation?.rowVersions?.[id];
                if (
                  !row.trackedChange ||
                  params.event !== 'add' ||
                  typeof params.trackedChangeCanonicalId !== 'string' ||
                  !params.trackedChangeCanonicalId ||
                  !Number.isSafeInteger(previousVersion) ||
                  previousVersion < 1 ||
                  version <= previousVersion ||
                  getTrackedChangeStoryKey(row) !==
                    parseTrackedChangeAnchorKey(params.trackedChangeAnchorKey)?.storyKey ||
                  row.trackedChangeType !== params.trackedChangeType ||
                  row.trackedChangeDisplayType !== params.trackedChangeDisplayType
                )
                  continue;
                // This publication owns the stable row and its newer canonical
                // decision identity; generic alias refresh keeps its strict guard.
                row.trackedChangeCanonicalId = params.trackedChangeCanonicalId;
                row.updateIdentityValues?.({ trackedChangeCanonicalId: params.trackedChangeCanonicalId });
                trackedChangeIdentityIndex.add(row);
              }
              retainUnchangedRow =
                retainUnchangedRows &&
                row?.trackedChange === true &&
                previousPreparedPresentation.rowVersions?.[id] === version &&
                row.trackedChangeCanonicalId === params.trackedChangeCanonicalId &&
                row.trackedChangeType === params.trackedChangeType &&
                row.trackedChangeDisplayType === params.trackedChangeDisplayType &&
                getTrackedChangeStoryKey(row) ===
                  parseTrackedChangeAnchorKey(params.trackedChangeAnchorKey)?.storyKey &&
                !row.resolvedTime &&
                !row.resolvedById &&
                !row.resolvedByEmail &&
                !row.resolvedByName;
            }
            // TCS Phase 0 / 005 §5: adapters may surface canonical v2 types that
            // do not map to a Phase 0 dialog variant (`move` / `structural` /
            // unknown). They return `{ event: 'omit', reason }` so callers can
            // record the omission without rendering a blank row. We still treat
            // the change as live for pruning so we don't churn the row out and
            // back in across refreshes.
            if (params.event === 'omit') {
              if (params.changeId != null) liveIds.add(String(params.changeId));
              continue;
            }
            if (effectiveDocumentId && params.documentId == null) {
              params.documentId = effectiveDocumentId;
            }
            if (params.changeId != null) liveIds.add(String(params.changeId));
            if (params.trackedChangeAnchorKey != null) {
              liveAnchorKeys.add(String(params.trackedChangeAnchorKey));
            }

            if (retainUnchangedRow) continue;
            // Reuse the existing tracked-change comment synthesis path. It maps
            // params → useComment row, threads child comments, and emits the
            // sidebar update event consistent with v1 behavior.
            handleTrackedChangeUpdate({
              superdoc,
              params,
              broadcastChanges: false,
              trackedChangeIdentityIndex,
            });
            appliedCount += 1;
          }
        } finally {
          endInteractionSpan(identitySpan, trackedChangeIdentityIndex.work());
        }

        if (!effectiveDocumentId || !pruneStale) {
          if (effectiveDocumentId) compactDuplicateBodyTrackedChangeComments(String(effectiveDocumentId));
          return { liveIds, liveAnchorKeys, appliedCount };
        }
        // TCS Phase 0 §5: prune stale tracked-change rows after every successful
        // refresh so accept/reject removals don't leave orphan sidebar rows. We
        // feed both live raw id sets and live anchor-key sets. The helper is
        // already scoped to `trackedChange === true` rows for the active
        // document, so real comment rows and other documents are preserved.
        pruneStaleTrackedChangeComments(liveIds, liveAnchorKeys, String(effectiveDocumentId), superdoc, {
          broadcastChanges: false,
        });
        return { liveIds, liveAnchorKeys, appliedCount };
      },
    );

  const getV2TrackedChangeRowCount = (documentId = null) => {
    const normalizedDocumentId = documentId == null ? null : String(documentId);
    return commentsList.value.filter((comment) => {
      if (comment?.trackedChange !== true) return false;
      if (normalizedDocumentId == null) return true;
      const rowDocumentId = comment?.documentId ?? comment?.fileId ?? null;
      return rowDocumentId != null && String(rowDocumentId) === normalizedDocumentId;
    }).length;
  };

  /**
   * Triggered when the editor locations are updated
   * Updates floating comment locations from the editor
   *
   * @param {Object} allCommentPositions The collected geometry keyed by comment / tracked-change id
   * @param {{ retainMissingTrackedChangeGeometry?: boolean, retainedTrackedChangeIds?: Iterable<string> }} options Geometry reconciliation options
   * @returns {void}
   */
  const handleEditorLocationsUpdate = (allCommentPositions, options = {}) => {
    if (allCommentPositions == null) {
      return;
    }
    // Enter / structural remounts can publish a carrier-less snapshot before
    // annotation ids are restamped. Only the publisher can identify that
    // transient gap; ordinary scroll/resize recollects must be allowed to drop
    // stale coordinates for unmounted carriers.
    const retainMissingTrackedChangeGeometry = options?.retainMissingTrackedChangeGeometry === true;
    const retainedTrackedChangeIds =
      retainMissingTrackedChangeGeometry && options?.retainedTrackedChangeIds != null
        ? new Set(Array.from(options.retainedTrackedChangeIds, (id) => normalizeCommentId(id)).filter(Boolean))
        : null;
    const previousPositions = editorCommentPositions.value || {};
    const normalizedPositions = {};
    Object.entries(allCommentPositions).forEach(([key, entry]) => {
      normalizedPositions[key] = entry;
      const rawTrackedChangeKey =
        entry?.kind === 'trackedChange' && entry?.storyKey === 'body' && entry?.threadId != null
          ? String(entry.threadId)
          : null;
      if (rawTrackedChangeKey && normalizedPositions[rawTrackedChangeKey] === undefined) {
        normalizedPositions[rawTrackedChangeKey] = entry;
      }
      const canonicalKey = typeof entry?.key === 'string' ? entry.key : null;
      if (canonicalKey && normalizedPositions[canonicalKey] === undefined) {
        normalizedPositions[canonicalKey] = entry;
      }
    });

    const aliases = new Map();
    const aliasesFor = (comment) => {
      let ids = aliases.get(comment);
      if (!ids) {
        ids = getCommentAliasIds(comment);
        aliases.set(comment, ids);
      }
      return ids;
    };

    const findTrackedChangePosition = (comment, positions) => {
      for (const aliasId of aliasesFor(comment)) {
        const entry = positions[aliasId];
        if (entry !== undefined && positionEntryMatchesTrackedChangeStory(entry, comment)) return entry;
      }
      return null;
    };

    const writeTrackedChangeAliases = (entry, comment, extraKeys = []) => {
      const keys = [...aliasesFor(comment), ...extraKeys.map((id) => normalizeCommentId(id)).filter(Boolean)];
      for (const key of new Set(keys)) {
        if (normalizedPositions[key] === undefined) normalizedPositions[key] = entry;
      }
    };

    commentsList.value.forEach((comment) => {
      if (!comment?.trackedChange || comment.resolvedTime) return;
      const live = findTrackedChangePosition(comment, normalizedPositions);
      if (live) {
        writeTrackedChangeAliases(live, comment);
        return;
      }
      if (!retainMissingTrackedChangeGeometry) return;
      if (retainedTrackedChangeIds && !aliasesFor(comment).some((id) => retainedTrackedChangeIds.has(id))) {
        return;
      }
      const previous = findTrackedChangePosition(comment, previousPositions);
      if (!previous) return;
      writeTrackedChangeAliases(previous, comment, [previous.key, previous.threadId]);
    });

    editorCommentPositions.value = normalizedPositions;
  };

  /**
   * Clear editor comment positions (used when entering viewing mode to hide comment bubbles)
   */
  const clearEditorCommentPositions = () => {
    editorCommentPositions.value = {};
  };

  const getFloatingComments = computed(() => {
    const comments = getGroupedComments.value?.parentComments
      .filter((c) => !c.resolvedTime)
      .filter((c) => {
        // Non-editor comments (e.g. PDF) are always shown.
        if (!isEditorBackedComment(c)) return true;
        // Tracked-change threads are logical review rows whose lifecycle is
        // owned by the tracked-change catalog, not by painted geometry.
        // Virtualized painting only emits position entries for mounted DOM
        // carriers, so a missing entry means "not painted yet", not "gone
        // from the document". Geometry stays a positioning enhancement
        // (SD-3772 §7).
        if (isTrackedChangeThread(c)) return true;
        // Ordinary editor-backed comments must have a live position in the
        // document (undo can orphan a bubble by removing its anchored text).
        return Boolean(resolveCommentPositionEntry(c).entry);
      });
    return comments;
  });

  const getFloatingCommentInstances = computed(() => {
    const instances = getFloatingComments.value.flatMap((comment) => {
      const { key, entry } = resolveCommentPositionEntry(comment);
      const fallbackId = normalizeCommentId(comment?.commentId) ?? getCommentAliasIds(comment)[0] ?? null;

      return buildFloatingCommentInstances({
        comment,
        positionKey: key,
        positionEntry: entry,
        fallbackId,
      });
    });
    return instances;
  });

  const normalizeFloatingCommentInstanceId = (instanceId) => {
    return instanceId == null ? null : String(instanceId);
  };

  const setActiveFloatingCommentInstance = (instanceId = null) => {
    activeFloatingCommentInstanceId.value = normalizeFloatingCommentInstanceId(instanceId);
  };

  const clearActiveCommentSelection = () => {
    activeComment.value = null;
    setActiveFloatingCommentInstance(null);
  };

  const doesFloatingInstanceBelongToComment = (instanceId, commentId) => {
    if (instanceId == null || commentId == null) {
      return false;
    }

    return getFloatingCommentInstances.value.some(
      (instance) =>
        String(instance.id) === String(instanceId) &&
        String(instance.comment?.commentId ?? instance.threadId ?? '') === String(commentId),
    );
  };

  const syncActiveFloatingInstanceWithComment = (commentId) => {
    if (!doesFloatingInstanceBelongToComment(activeFloatingCommentInstanceId.value, commentId)) {
      setActiveFloatingCommentInstance(null);
    }
  };

  function canonicalizeActiveCommentAlias() {
    const activeId = normalizeCommentId(activeComment.value);
    if (!activeId) return false;

    const comment = getComment(activeId);
    const canonicalId = normalizeCommentId(comment?.commentId);
    if (!canonicalId || canonicalId === activeId) return false;

    activeComment.value = canonicalId;
    syncActiveFloatingInstanceWithComment(canonicalId);
    return true;
  }

  const setViewingVisibility = ({ documentMode, commentsVisible, trackChangesVisible } = {}) => {
    if (typeof documentMode === 'string') {
      viewingVisibility.documentMode = documentMode;
    }
    if (typeof commentsVisible === 'boolean') {
      viewingVisibility.commentsVisible = commentsVisible;
    }
    if (typeof trackChangesVisible === 'boolean') {
      viewingVisibility.trackChangesVisible = trackChangesVisible;
    }
  };

  return {
    COMMENT_EVENTS,
    hasSyncedCollaborationComments,
    editingCommentId,
    activeComment,
    activeFloatingCommentInstanceId,
    suppressInternalExternal,
    pendingComment,
    currentCommentText,
    currentCommentMentions,
    commentsList,
    reviewDirectoryList,
    isCommentsListVisible,
    isReviewDirectoryActive,
    isReviewDirectoryLoading,
    generalCommentIds,
    editorCommentIds,
    commentsParentElement,
    editorCommentPositions,
    hasInitializedLocations,
    isCommentHighlighted,

    // Floating comments
    floatingCommentsOffset,
    committedReviewPresentations,
    skipSelectionUpdate,
    isFloatingCommentsReady,
    instantSidebarAlignmentTargetY,
    instantSidebarAlignmentThreadId,
    instantSidebarAlignmentInstanceId,
    // Getters
    getConfig,
    documentsWithConverations,
    getGroupedComments,
    getGroupedReviewDirectory,
    hasOpenTrackedChanges,
    getFloatingComments,
    getFloatingCommentInstances,
    getCommentAliasIds,
    getTrackedChangeThread,
    getCommentPositionKey,
    getCommentPosition,
    resolveCommentPositionEntry,
    getCommentDocumentId,
    belongsToDocument,

    // Reactive review-visibility authority (shared with SuperDoc.vue so V2
    // geometry/layout decisions read one source of truth, not mutable config).
    viewingVisibility,
    isViewingMode,
    shouldRenderReviewInViewing,

    // Actions
    init,
    setViewingVisibility,
    getComment,
    setActiveComment,
    getPendingComment,
    showAddComment,
    addComment,
    addHydratedComment,
    cancelComment,
    deleteComment,
    removePendingComment,
    removeCommentsForDocument,
    setReviewDirectoryFromV2,
    clearReviewDirectory,
    handleEditorLocationsUpdate,
    clearEditorCommentPositions,
    handleTrackedChangeUpdate,
    syncResolvedCommentsWithDocument,
    setActiveFloatingCommentInstance,
    requestInstantSidebarAlignment,
    peekInstantSidebarAlignment,
    clearInstantSidebarAlignment,
    decideTrackedChangeFromSidebar,

    // ui-phase3-002: v2 comments adapter helpers
    v2CommentsAdapter,
    setV2CommentsAdapter,
    getV2CommentsAdapter,
    applyReviewWindowFromV2,
    reconcileCommentsFromV2,
    announceV2CommentCreated,
    dropCommentsFromMutationImpact,
    isV2EditorActive,

    // TCS Phase 0 / 004: store-owned v2 comment mutation helpers.
    replyCommentV2,
    editCommentV2,
    resolveCommentV2,
    reopenCommentV2,

    // ui-phase3-003: v2 tracked-change adapter helpers
    v2TrackedChangesAdapter,
    setV2TrackedChangesAdapter,
    getV2TrackedChangesAdapter,
    getV2TrackedChangeRowCount,
    reconcileTrackedChangeMutationFromV2,
    reconcileTrackedChangesFromV2,
    remapTrackedChangeIdentities,
  };
});
